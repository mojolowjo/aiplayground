// Hosting checks: the limits, the UPnP client against a stand-in router, the DuckDNS updater against a
// stand-in fetch, and the real server started as a child process. Nothing here leaves this machine.
import assert from 'node:assert';
import http from 'node:http';
import dgram from 'node:dgram';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { LIMITS, RateLimiter, PerIp, plainIp, isThisMachine, staticFiles } from '../net/guard.js';
import { discover, gateway, PortMapping, isPublicAddress, parseFields, isIpv4 } from '../net/upnp.js';
import { publicIp } from '../net/publicip.js';
import { duckName, updateDuck, startDuck } from '../net/duckdns.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await sleep(20); } };
const rejects = async (p, re) => { try { await p; } catch (e) { assert(re.test(e.message), `"${e.message}" should match ${re}`); return e; } assert.fail('should have failed'); };

// 1. Limits
{
  let now = 0; const rl = new RateLimiter({ perSec: 10, burst: 5, now: () => now });
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(() => rl.allow()), [true, true, true, true, true, false], 'a burst is allowed, then it stops');
  now = 0.25; assert.deepEqual([rl.allow(), rl.allow(), rl.allow()], [true, true, false], 'tokens come back at the set rate');
  now = 100; let n = 0; while (rl.allow()) n++; assert.equal(n, 5, 'and never pile up past the burst');
  const real = new RateLimiter(); let ok = 0; for (let i = 0; i < 1000; i++) if (real.allow()) ok++;
  assert(ok >= LIMITS.burst && ok <= LIMITS.burst + 5, `the default lets ${LIMITS.burst} through at once, not 1000: ${ok}`);
  const ips = new PerIp(2); assert.deepEqual([ips.add('a'), ips.add('a'), ips.add('a'), ips.add('b')], [true, true, false, true], 'connections are capped per address');
  ips.remove('a'); assert(ips.add('a'), 'a slot frees up when one closes'); ips.remove('b'); assert(!ips.n.has('b'));
  assert(plainIp('::ffff:1.2.3.4') === '1.2.3.4' && isThisMachine('::ffff:127.0.0.1') && isThisMachine('::1') && !isThisMachine('203.0.113.9'));
  const files = staticFiles(fileURLToPath(new URL('../public', import.meta.url)));
  assert(files.has('/') && files.has('/client.js') && files.has('/predict.js') && !files.has('/../server.js') && [...files.keys()].every(k => /^\/[\w.-]*$/.test(k)), 'only the files in public/ are on the list');
  assert.deepEqual(['8.8.8.8', '203.0.113.7', '192.168.1.1', '10.0.0.1', '172.20.1.1', '100.64.0.1', '127.0.0.1', 'nonsense'].map(isPublicAddress), [true, true, false, false, false, false, false, false]);
  console.log('limits ok');
}

// A stand-in router: answers the SSDP search, serves a description, and records the SOAP calls it gets.
// externalReply(ip, n): overrides the body of the n-th GetExternalIPAddress reply; return { status, body } to answer with an error.
async function fakeRouter({ externalIp = '203.0.113.7', permanentOnly = false, refuse = 0, externalReply = null } = {}) {
  const calls = []; let asked = 0;
  const web = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; }); req.on('end', () => {
      if (req.url === '/desc.xml') return res.end(`<?xml version="1.0"?><root><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><serviceList>
        <service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service></serviceList><deviceList><device><serviceList>
        <service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/ip</controlURL></service></serviceList></device></deviceList></device></root>`);
      if (req.url !== '/ctl/ip') { res.statusCode = 404; return res.end(); }
      const action = /#(\w+)"/.exec(req.headers.soapaction || '')[1], args = Object.fromEntries([...body.matchAll(/<(New\w+)>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]]));
      calls.push({ action, args });
      const fail = (code, text) => { res.statusCode = 500; res.end(`<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode><errorDescription>${text}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`); };
      if (action === 'AddPortMapping' && refuse) return fail(refuse, 'ConflictInMappingEntry');
      if (action === 'AddPortMapping' && permanentOnly && args.NewLeaseDuration !== '0') return fail(725, 'OnlyPermanentLeasesSupported');
      calls.at(-1).headers = req.headers; calls.at(-1).body = body;
      if (action === 'GetExternalIPAddress' && externalReply) { const r = externalReply(externalIp, ++asked); if (r) { if (r.status) res.statusCode = r.status; return res.end(r.body); } }
      res.end(`<s:Envelope><s:Body><u:${action}Response>${action === 'GetExternalIPAddress' ? `<NewExternalIPAddress>${externalIp}</NewExternalIPAddress>` : ''}</u:${action}Response></s:Body></s:Envelope>`);
    });
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const location = `http://127.0.0.1:${web.address().port}/desc.xml`;
  const ssdp = dgram.createSocket('udp4');
  ssdp.on('message', (msg, from) => { if (/M-SEARCH/.test(msg)) ssdp.send(`HTTP/1.1 200 OK\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\nLOCATION: ${location}\r\n\r\n`, from.port, from.address); });
  await new Promise(r => ssdp.bind(0, '127.0.0.1', r));
  return { calls, location, to: { address: '127.0.0.1', port: ssdp.address().port }, close: () => { web.close(); ssdp.close(); }, count: a => calls.filter(c => c.action === a).length };
}

// 2. UPnP: find the router, open the port, renew the lease, remove the mapping; and the ways it can fail
{
  const r = await fakeRouter();
  assert.equal(await discover({ to: r.to, timeout: 2000 }), r.location, 'SSDP search finds the router\'s description');
  const gw = await gateway(r.location);
  assert(gw.controlUrl.endsWith('/ctl/ip') && /WANIPConnection:1$/.test(gw.serviceType) && gw.localAddress === '127.0.0.1', 'the port-mapping service is picked out of the description');
  const logs = [], m = new PortMapping({ port: 3000, lease: 0.4, log: s => logs.push(s), find: () => discover({ to: r.to }) });
  const res = await m.open();
  assert.deepEqual(res, { externalIp: '203.0.113.7', localAddress: '127.0.0.1', lease: 0.4 });
  assert.deepEqual({ action: r.calls[0].action, args: r.calls[0].args }, { action: 'AddPortMapping', args: { NewRemoteHost: '', NewExternalPort: '3000', NewProtocol: 'TCP', NewInternalPort: '3000', NewInternalClient: '127.0.0.1',
    NewEnabled: '1', NewPortMappingDescription: 'Lane Duel', NewLeaseDuration: '0.4' } }, 'TCP 3000 -> this PC:3000, described as "Lane Duel", with a lease');
  await until(() => r.count('AddPortMapping') >= 3); assert(true, 'the lease is renewed at half time, again and again');
  assert.equal(await m.close(), true); assert.deepEqual({ action: r.calls.at(-1).action, args: r.calls.at(-1).args }, { action: 'DeletePortMapping', args: { NewRemoteHost: '', NewExternalPort: '3000', NewProtocol: 'TCP' } }, 'closing removes the mapping');
  const n = r.count('AddPortMapping'); await sleep(500); assert.equal(r.count('AddPortMapping'), n, 'and stops renewing'); assert.equal(await m.close(), false);
  r.close();

  const p = await fakeRouter({ permanentOnly: true }), m2 = new PortMapping({ port: 3000, lease: 3600, find: async () => p.location });
  assert.equal((await m2.open()).lease, 0, 'a router that only does permanent mappings gets one'); assert.deepEqual(p.calls.filter(c => c.action === 'AddPortMapping').map(c => c.args.NewLeaseDuration), ['3600', '0']);
  await m2.close(); p.close();

  const no = await fakeRouter({ refuse: 718 }), m3 = new PortMapping({ port: 3000, find: async () => no.location });
  await rejects(m3.open(), /refused AddPortMapping \(error 718: ConflictInMappingEntry\)/); assert.equal(await m3.close(), false, 'nothing to remove after a refusal'); no.close();

  const quiet = dgram.createSocket('udp4'); await new Promise(r2 => quiet.bind(0, '127.0.0.1', r2));
  await rejects(discover({ to: { address: '127.0.0.1', port: quiet.address().port }, timeout: 300 }), /no UPnP router answered/); quiet.close();
  await rejects(new PortMapping({ port: 3000, find: async () => 'http://127.0.0.1:9/desc.xml' }).open(), /ECONNREFUSED|connect/);

  // The request is written the way miniupnpc writes it.
  { const q = await fakeRouter(), mq = new PortMapping({ port: 3000, find: async () => q.location }); await mq.open(); const c = q.calls.find(x => x.action === 'GetExternalIPAddress');
    const svc = 'urn:schemas-upnp-org:service:WANIPConnection:1';
    assert.equal(c.headers.soapaction, `"${svc}#GetExternalIPAddress"`); assert.equal(c.headers['content-type'], 'text/xml; charset="utf-8"'); assert.equal(c.headers.connection, 'close'); assert(c.headers['user-agent'] && c.headers.host.startsWith('127.0.0.1:'));
    assert.equal(c.body, `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="${svc}"></u:GetExternalIPAddress></s:Body></s:Envelope>\r\n`);
    assert.equal(+c.headers['content-length'], Buffer.byteLength(c.body)); await mq.close(); q.close(); }

  // Replies come in many shapes: namespace prefixes, attributes on the tag, whitespace, either letter case.
  assert.deepEqual(parseFields('<NewExternalIPAddress>1.2.3.4</NewExternalIPAddress>'), { NewExternalIPAddress: '1.2.3.4' });
  assert.deepEqual(parseFields('<u:NewExternalIPAddress>1.2.3.4</u:NewExternalIPAddress>'), { NewExternalIPAddress: '1.2.3.4' });
  assert.deepEqual(parseFields('<NewExternalIPAddress xmlns:dt="urn:schemas-microsoft-com:datatypes" dt:dt="string">\r\n   1.2.3.4\n </NewExternalIPAddress >'), { NewExternalIPAddress: '1.2.3.4' });
  assert.deepEqual(parseFields('<m:NewExternalIPAddress\n  dt:dt="string">1.2.3.4</m:NewExternalIPAddress><NewLeaseDuration>0</NewLeaseDuration><NewPortMappingDescription>a &amp; b</NewPortMappingDescription>'),
    { NewExternalIPAddress: '1.2.3.4', NewLeaseDuration: '0', NewPortMappingDescription: 'a & b' });
  assert.deepEqual(parseFields('<NewExternalIPAddress></NewExternalIPAddress>'), { NewExternalIPAddress: '' }); assert.deepEqual(parseFields('<Other>1</Other>'), {});
  assert.deepEqual(['1.2.3.4', ' 1.2.3.4 ', '0.0.0.0', '', '1.2.3', '999.1.1.1', 'abc'].map(isIpv4), [true, true, false, false, false, false, false]);
  const wrap = inner => `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:GetExternalIPAddressResponse xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">${inner}</u:GetExternalIPAddressResponse></s:Body></s:Envelope>`;
  { const q = await fakeRouter({ externalReply: ip => ({ body: wrap(`\r\n<u:NewExternalIPAddress xmlns:dt="urn:schemas-microsoft-com:datatypes" dt:dt="string">\r\n  ${ip}\r\n</u:NewExternalIPAddress>\r\n`) }) });
    const lg = [], mq = new PortMapping({ port: 3000, log: s => lg.push(s), find: async () => q.location });
    assert.equal((await mq.open()).externalIp, '203.0.113.7', 'a namespaced tag with attributes and whitespace is read'); assert.equal(lg.length, 0); assert.equal(q.count('GetExternalIPAddress'), 1); await mq.close(); q.close(); }
  // An error the first time, an answer the second: one retry, and the failure is logged with the router's raw reply.
  { const q = await fakeRouter({ externalReply: (ip, n) => (n === 1 ? { status: 500, body: '<s:Envelope><s:Body><s:Fault><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>501</errorCode><errorDescription>Action Failed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>' } : null) });
    const lg = [], mq = new PortMapping({ port: 3000, askAgainAfter: 0.05, log: s => lg.push(s), find: async () => q.location }), t0 = Date.now();
    assert.equal((await mq.open()).externalIp, '203.0.113.7', 'it asks again and gets the address'); assert(q.count('GetExternalIPAddress') === 2 && Date.now() - t0 >= 45);
    assert(lg.length === 1 && /GetExternalIPAddress failed: the router refused GetExternalIPAddress \(error 501: Action Failed\)/.test(lg[0]) && /reply was:[\s\S]*<errorCode>501<\/errorCode>/.test(lg[0]), 'the error and the raw reply are logged:\n' + lg[0]);
    assert.equal(new PortMapping({ port: 1 }).askAgainAfter, 1, 'the real wait before asking again is 1 second'); await mq.close(); q.close(); }
  // Never an address: asked twice, both replies logged (cut to 500 characters), the mapping still stands.
  { const junk = wrap('<NewExternalIPAddress></NewExternalIPAddress>' + '<!-- padding -->'.repeat(60)), q = await fakeRouter({ externalReply: () => ({ body: junk }) });
    const lg = [], mq = new PortMapping({ port: 3000, askAgainAfter: 0.05, log: s => lg.push(s), find: async () => q.location }), got = await mq.open();
    assert(got.externalIp === null && got.lease === 3600 && mq.active && q.count('GetExternalIPAddress') === 2, 'no address, but the port is open');
    assert(lg.length === 2 && lg.every(l => /without a usable address/.test(l) && /Envelope/.test(l) && l.length < 700 && l.includes('…')), 'both replies are logged, shortened');
    const zero = await fakeRouter({ externalIp: '0.0.0.0' }), mz = new PortMapping({ port: 3000, askAgainAfter: 0.01, log: s => lg.push(s), find: async () => zero.location });
    assert.equal((await mz.open()).externalIp, null, '0.0.0.0 is not an address'); assert(/"0\.0\.0\.0"/.test(lg.at(-1))); await mz.close(); zero.close(); await mq.close(); q.close(); }
  // UPNP_DEBUG output: every request and every raw reply.
  { const q = await fakeRouter(), dbg = [], mq = new PortMapping({ port: 3000, debug: s => dbg.push(s), find: async () => q.location }); await mq.open(); await mq.close(); q.close(); const all = dbg.join('\n');
    assert(/control URL http:\/\/127\.0\.0\.1:\d+\/ctl\/ip/.test(all) && ['AddPortMapping', 'GetExternalIPAddress', 'DeletePortMapping'].every(a => all.includes(`#${a}"`) && all.includes(`<< HTTP 200 for ${a}`)) && /<NewExternalIPAddress>203\.0\.113\.7</.test(all) && /<u:AddPortMapping xmlns:u=/.test(all), 'debug shows requests and raw replies'); }
  // The "what is my IP" fallback
  { const ok = async url => ({ ok: true, status: 200, text: async () => ' 198.51.100.9\n' }); assert.deepEqual(await publicIp({ fetchImpl: ok }), { ip: '198.51.100.9', source: 'api.ipify.org' });
    await rejects(publicIp({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>captive portal</html>' }) }), /did not answer with an address/);
    await rejects(publicIp({ fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) }), /HTTP 503/); }

  // a renewal that fails is logged and retried, not thrown
  const f = await fakeRouter(), m4 = new PortMapping({ port: 3000, lease: 0.2, retry: 0.1, log: s => logs.push(s), find: async () => f.location });
  await m4.open(); f.close(); await until(() => logs.some(l => /could not renew/.test(l))); m4.active = false; clearTimeout(m4.timer);
  console.log('upnp ok');
}

// 3. DuckDNS: the right request, failures reported without the token
{
  assert.deepEqual(['MyName', 'myname.duckdns.org', 'https://my-name.duckdns.org/', 'bad name', '', undefined].map(duckName), ['myname', 'myname', 'my-name', null, null, null]);
  const token = 'secret-token-12345', seen = [];
  const reply = (text, ok = true) => async url => { seen.push(url); return { ok, status: ok ? 200 : 500, text: async () => text }; };
  assert.equal(await updateDuck({ name: 'myname', token, fetchImpl: reply('OK') }), true);
  assert.equal(seen[0], 'https://www.duckdns.org/update?domains=myname&token=secret-token-12345&ip=');
  const errs = [await rejects(updateDuck({ name: 'myname', token, fetchImpl: reply('KO') }), /answered "KO"/), await rejects(updateDuck({ name: 'myname', token, fetchImpl: reply('', false) }), /HTTP 500/),
    await rejects(updateDuck({ name: 'myname', token, fetchImpl: async url => { throw new Error('request to ' + url + ' failed'); } }), /failed/)];
  assert(errs.every(e => !e.message.includes(token)), 'no error message contains the token');
  const logs = []; let calls = 0;
  const job = startDuck({ name: 'myname', token, every: 0.05, log: s => logs.push(s), fetchImpl: async url => { if (++calls === 2) throw new Error('offline ' + url); return { ok: true, status: 200, text: async () => 'OK' }; } });
  await job.first; await until(() => calls >= 4); job.stop();
  assert(/now points at this network/.test(logs[0]) && logs.some(l => /WARNING: DuckDNS update failed/.test(l)) && logs.every(l => !l.includes(token)), 'it keeps going after a failure, logs it, and never logs the token');
  console.log('duckdns ok');
}

// 4. The real server, as a child process
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
async function startServer(env) {
  const port = await freePort(), out = [];
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], { env: { ...process.env, DUCKDNS_DOMAIN: '', DUCKDNS_TOKEN: '', UPNP_GATEWAY: '', ...env, PORT: String(port) } });
  for (const s of [child.stdout, child.stderr]) s.on('data', d => out.push(String(d)));
  const exited = new Promise(r => child.on('exit', code => r(code)));
  const text = () => out.join('');
  await until(() => /Lane Duel running/.test(text()));
  return { port, child, text, exited, stop: async () => { child.kill('SIGTERM'); return exited; } };
}
const get = (port, path, method = 'GET') => new Promise((res, rej) => { const req = http.request({ host: '127.0.0.1', port, path, method }, r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res({ status: r.statusCode, type: r.headers['content-type'], body: b })); }); req.on('error', rej); req.end(); });
const connect = port => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${port}`), msgs = []; ws.msgs = msgs; ws.closed = null;
  ws.on('message', d => msgs.push(JSON.parse(d))); ws.on('close', code => { ws.closed = code; }); ws.on('open', () => res(ws)); ws.on('error', () => {}); setTimeout(() => rej(new Error('no connection')), 3000); });
{
  const r = await fakeRouter(), s = await startServer({ UPNP_GATEWAY: r.location });
  await until(() => /Friends join at/.test(s.text()));
  assert(s.text().includes(`Friends join at: http://203.0.113.7:${s.port}`) && /router now forwards TCP port/.test(s.text()) && s.text().includes('Public address: 203.0.113.7 (from your router).'), 'the public join address and where it came from are printed:\n' + s.text());
  assert(!/UPnP >>/.test(s.text()), 'no debug output unless asked for');
  assert.deepEqual([r.calls[0].action, r.calls[0].args.NewExternalPort, r.calls[0].args.NewLeaseDuration, r.calls[0].args.NewPortMappingDescription], ['AddPortMapping', String(s.port), '3600', 'Lane Duel']);

  // only the game's own files
  const page = await get(s.port, '/'); assert(page.status === 200 && /text\/html/.test(page.type) && /<canvas/.test(page.body));
  assert.equal((await get(s.port, '/client.js')).status, 200); assert.equal((await get(s.port, '/predict.js?v=1')).status, 200);
  for (const path of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/game/sim.js', '/server.js', '/public', '/public/', '/nope.js', '/%zz', '/.', '//client.js', '/index.html/'])
    assert.equal((await get(s.port, path)).status, 404, path + ' is not served');
  assert.equal((await get(s.port, '/', 'POST')).status, 405);

  // the host sees the join address; rubbish is ignored; the server keeps running
  const ws = await connect(s.port); ws.send(JSON.stringify({ t: 'join', room: 'r1', name: 'Host' })); await until(() => ws.msgs.some(m => m.t === 'lobby'));
  const lobby = ws.msgs.find(m => m.t === 'lobby'); assert.deepEqual(lobby.join, { url: `http://203.0.113.7:${s.port}/?room=r1`, public: true, note: '' }, 'the lobby tells the host the join address');
  for (const junk of ['garbage', '[]', 'null', '42', '{"t":5}', '{"t":"pick","hero":"constructor"}', '{"t":"pick","hero":"__proto__"}', '{"t":"mode","mode":"toString"}', '{"t":"start","opp":{"a":1}}'])
    ws.send(junk);
  ws.send(JSON.stringify({ t: 'pick', hero: 'wren' })); ws.send(JSON.stringify({ t: 'start', opp: 'dummy' })); await until(() => ws.msgs.some(m => m.t === 'snap'));
  for (const junk of [{ t: 'cmd', c: 'spell', s: 'constructor' }, { t: 'cmd', c: 'buy', item: 'constructor' }, { t: 'cmd', c: 'buy', item: '__proto__' }, { t: 'cmd', c: 'cast', s: 'x', x: 'NaN', y: {} },
    { t: 'cmd', c: 'move', x: 1e308, y: -1e308 }, { t: 'cmd', c: 'atk', id: 'abc' }, { t: 'cmd', c: 'sell', i: -5 }, { t: 'cmd', c: 'lvl', s: 99 }, { t: 'cmd' }, { t: 'cmd', c: 'constructor' }])
    ws.send(JSON.stringify(junk));
  ws.msgs.length = 0; ws.send(JSON.stringify({ t: 'ping', c: 7 })); await until(() => ws.msgs.some(m => m.t === 'pong' && m.c === 7));
  await sleep(150); const snap = ws.msgs.filter(m => m.t === 'snap').at(-1);
  assert(snap && Number.isFinite(snap.me.gold) && snap.me.items.length === 0 && ws.closed === null && s.child.exitCode === null, 'malformed messages are ignored and the game carries on');

  // message size cap
  const big = await connect(s.port); big.send(JSON.stringify({ t: 'join', name: 'x'.repeat(LIMITS.maxMessageBytes + 100) })); await until(() => big.closed !== null);
  assert.equal(big.closed, 1009, 'an oversized message closes that connection');
  // message rate limit
  const flood = await connect(s.port); for (let i = 0; i < LIMITS.burst + 200; i++) flood.send('{"t":"ping","c":1}'); await until(() => flood.closed !== null);
  assert(flood.closed === 1008 && flood.msgs.length <= LIMITS.burst + 2, `a flood is cut off after the burst allowance: ${flood.msgs.length} answered, closed with ${flood.closed}`);
  // connections per address
  const many = []; for (let i = 0; i < LIMITS.maxConnsPerIp + 2; i++) many.push(await connect(s.port)); await sleep(200);
  assert.equal(many.filter(c => c.closed === 1013).length, 3, `only ${LIMITS.maxConnsPerIp} connections per address stay open`);   // `ws` is still open, so 7 more fit
  for (const c of many) c.close(); await sleep(100);
  const again = await connect(s.port); await sleep(100); assert.equal(again.closed, null, 'slots free up when connections close'); again.close();
  assert(ws.closed === null && s.child.exitCode === null, 'the first player was never disturbed');

  // clean shutdown removes the mapping
  assert.equal(await s.stop(), 0); assert(/port mapping removed/.test(s.text()) && r.calls.at(-1).action === 'DeletePortMapping', 'Ctrl+C / SIGTERM removes the port mapping');
  r.close();
  console.log('server ok');
}
// 5. When going public does not work, the server still runs and says so
{
  const dead = await startServer({ UPNP_GATEWAY: 'http://127.0.0.1:9/desc.xml' }); await until(() => /WARNING/.test(dead.text()));
  assert(/UPnP could not open port/.test(dead.text()) && /only reachable on your local network: http:\/\//.test(dead.text()) && !/Friends join at/.test(dead.text()), dead.text());
  assert.equal((await get(dead.port, '/')).status, 200, 'still serving');
  const ws = await connect(dead.port); ws.send(JSON.stringify({ t: 'join' })); await until(() => ws.msgs.some(m => m.t === 'lobby'));
  const j = ws.msgs.find(m => m.t === 'lobby').join; assert(j && j.public === false && /Local network only/.test(j.note), 'and the lobby says local network only');
  assert.equal(await dead.stop(), 0);

  const nat = await fakeRouter({ externalIp: '192.168.0.2' }), behind = await startServer({ UPNP_GATEWAY: nat.location }); await until(() => /WARNING/.test(behind.text()));
  assert(/is not a public one/.test(behind.text()) && !/Friends join at/.test(behind.text()) && !/only reachable on your local network/.test(behind.text()), 'a router behind another router is called out'); await behind.stop(); nat.close();

  // The router opens the port but never gives an address: the "what is my IP" service is used instead...
  const ipService = http.createServer((req, res) => res.end('198.51.100.9\n')); await new Promise(r2 => ipService.listen(0, '127.0.0.1', r2)); const ipUrl = `http://127.0.0.1:${ipService.address().port}/`;
  const mute = () => fakeRouter({ externalReply: () => ({ status: 500, body: '<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>501</errorCode><errorDescription>Action Failed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>' }) });
  const m1 = await mute(), fb = await startServer({ UPNP_GATEWAY: m1.location, PUBLIC_IP_URL: ipUrl, UPNP_DEBUG: '1' }); await until(() => /Friends join at/.test(fb.text()), 8000);
  assert(fb.text().includes(`Friends join at: http://198.51.100.9:${fb.port}`) && fb.text().includes(`Public address: 198.51.100.9 (from 127.0.0.1:${ipService.address().port}).`), 'the fallback address is used and its source logged:\n' + fb.text());
  assert(/GetExternalIPAddress failed: .*error 501/.test(fb.text()) && /reply was:\s+<s:Envelope>/.test(fb.text()) && m1.count('GetExternalIPAddress') === 2, 'after the router was asked twice and its replies logged');
  assert(/UPnP >> POST http/.test(fb.text()) && /UPnP << HTTP 500 for GetExternalIPAddress/.test(fb.text()) && /UPnP << HTTP 200 for AddPortMapping/.test(fb.text()), 'UPNP_DEBUG=1 prints the SOAP traffic');
  assert(!/only reachable on your local network/.test(fb.text())); await fb.stop(); m1.close(); ipService.close();
  // ...and if that fails too, the message says the port is open and how to finish by hand.
  const m2 = await mute(), lost = await startServer({ UPNP_GATEWAY: m2.location, PUBLIC_IP_URL: 'http://127.0.0.1:9/' }); await until(() => /Couldn't find your public address/.test(lost.text()), 8000);
  assert(lost.text().includes(`Port ${lost.port} is open on the router. Couldn't find your public address automatically; look it up and give friends http://<that address>:${lost.port}.`), lost.text());
  assert(!/only reachable on your local network/.test(lost.text()) && !/Friends join at/.test(lost.text()) && /router now forwards TCP port/.test(lost.text()), 'never "local network only" once the mapping succeeded');
  const wl = await connect(lost.port); wl.send(JSON.stringify({ t: 'join' })); await until(() => wl.msgs.some(m => m.t === 'lobby'));
  const jl = wl.msgs.find(m => m.t === 'lobby').join; assert(jl.url === null && /Port \d+ is open on the router/.test(jl.note), 'the lobby shows the same message'); await lost.stop(); m2.close();

  const off = await startServer({ UPNP: 'off' }); await until(() => /UPnP is off/.test(off.text())); assert(!/Friends join at/.test(off.text())); assert.equal(await off.stop(), 0);

  const r = await fakeRouter(), duck = await startServer({ UPNP_GATEWAY: r.location, DUCKDNS_DOMAIN: 'MyGame.duckdns.org' }); await until(() => /Friends join at/.test(duck.text()));
  assert(duck.text().includes(`Friends join at: http://mygame.duckdns.org:${duck.port}`) && /DUCKDNS_TOKEN is not set/.test(duck.text()), 'with DUCKDNS_DOMAIN set, that name is the join address'); await duck.stop(); r.close();
  console.log('fallbacks ok');
}
console.log('all hosting checks passed');
