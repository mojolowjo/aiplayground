// A small UPnP client: asks the home router to forward a port to this PC.
//
// Three steps, all plain UDP and HTTP, no dependencies:
//   1. SSDP: shout "is there an internet gateway here?" on the local network and read the reply's
//      LOCATION, the address of the router's description file.
//   2. Read that description and find the control URL of its WANIPConnection (or WANPPPConnection) service.
//   3. SOAP: call AddPortMapping / GetExternalIPAddress / DeletePortMapping on that URL.
import dgram from 'node:dgram';
import http from 'node:http';

const SSDP = { address: '239.255.255.250', port: 1900 };
const TARGETS = [
  'urn:schemas-upnp-org:device:InternetGatewayDevice:1',
  'urn:schemas-upnp-org:device:InternetGatewayDevice:2',
  'urn:schemas-upnp-org:service:WANIPConnection:1',
];
const SERVICE = /urn:schemas-upnp-org:service:WAN(?:IP|PPP)Connection:\d/;

// Step 1. Resolves with the description URL of the first gateway that answers.
// `to` lets a test point the search at a stand-in router instead of the multicast address.
export function discover({ timeout = 3000, to = SSDP } = {}) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const done = (err, url) => { clearTimeout(timer); try { sock.close(); } catch { /* already closed */ } err ? reject(err) : resolve(url); };
    const timer = setTimeout(() => done(new Error('no UPnP router answered')), timeout);
    sock.on('error', e => done(new Error('could not search the network for a router: ' + e.message)));
    sock.on('message', buf => {
      const text = buf.toString(), loc = /^location:\s*(\S+)/im.exec(text);
      if (loc && /InternetGatewayDevice|WAN(IP|PPP)Connection/i.test(text)) done(null, loc[1]);
    });
    sock.bind(0, () => {
      for (const st of TARGETS) {
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP.address}:${SSDP.port}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        for (let i = 0; i < 2; i++) sock.send(msg, to.port, to.address, () => {});   // UDP can drop one
      }
    });
  });
}

function request(url, { method = 'GET', headers = {}, body, timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout }, res => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => { data += c; if (data.length > 1e6) req.destroy(new Error('reply too large')); });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('the router did not reply in time')));
    req.on('error', reject);
    req.end(body);
  });
}

// The LAN address this PC uses to reach `host`: what the router must forward the port to.
function localAddressFor(host, port) {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('error', reject);
    s.connect(port, host, () => { const a = s.address().address; s.close(); resolve(a); });
  });
}

// Step 2. Read the router's description and pick out the service that controls port mappings.
export async function gateway(location) {
  const res = await request(location);
  if (res.status !== 200) throw new Error(`the router's description could not be read (HTTP ${res.status})`);
  const base = (/<URLBase>\s*([^<\s]+)\s*<\/URLBase>/i.exec(res.body) || [])[1] || location;
  for (const block of res.body.match(/<service>[\s\S]*?<\/service>/gi) || []) {
    const type = (/<serviceType>\s*([^<]+?)\s*<\/serviceType>/i.exec(block) || [])[1];
    const control = (/<controlURL>\s*([^<]+?)\s*<\/controlURL>/i.exec(block) || [])[1];
    if (type && control && SERVICE.test(type)) {
      const controlUrl = new URL(control, base), u = new URL(location);
      return { controlUrl: controlUrl.href, serviceType: type, localAddress: await localAddressFor(u.hostname, +u.port || 80) };
    }
  }
  throw new Error('the router does not offer port mapping over UPnP');
}

const esc = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Pull the <New...> fields out of a SOAP reply. Routers differ in how they write them, so this accepts a
// namespace prefix (<u:NewExternalIPAddress>), attributes on the tag (dt:dt="string"), whitespace around
// the value and either letter case in the tag name. Keys are returned without the prefix.
export function parseFields(xml) {
  const out = {}, unescape = v => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  for (const m of String(xml).matchAll(/<(?:[\w.-]+:)?(New\w+)(?:\s[^>]*)?>([^<]*)<\/(?:[\w.-]+:)?\1\s*>/gi)) out[m[1]] = unescape(m[2].trim());
  return out;
}

// Step 3. One SOAP call, written the way miniupnpc writes it (the client routers are most often tested
// against; checked against soapPostSubmit and simpleUPnPcommand in its source): the same headers in the same
// order, the same envelope with the action element in the service's namespace, and a final CRLF.
// Resolves with the reply's fields; rejects with the router's error code and text. The raw reply is kept on
// the result (`.raw`, not listed among the fields) and on the error, so a caller can show it.
// `debug`, if given, is called with every request and every raw reply.
export async function soap(gw, action, args = {}, debug) {
  const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${gw.serviceType}">${Object.entries(args).map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>\r\n`;
  const u = new URL(gw.controlUrl);
  const headers = { Host: u.hostname + (u.port && u.port !== '80' ? ':' + u.port : ''), 'User-Agent': 'LaneDuel/1.0 UPnP/1.1', 'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.serviceType}#${action}"`, Connection: 'close' };
  if (debug) debug(`UPnP >> POST ${gw.controlUrl}\n${Object.entries(headers).map(([k, v]) => `   ${k}: ${v}`).join('\n')}\n   ${body.trim()}`);
  let res;
  try { res = await request(gw.controlUrl, { method: 'POST', body, headers }); }
  catch (e) { if (debug) debug(`UPnP << no reply to ${action}: ${e.message}`); throw e; }
  if (debug) debug(`UPnP << HTTP ${res.status} for ${action}\n   ${res.body.trim() || '(empty reply)'}`);
  if (res.status !== 200) {
    const code = +(/<(?:[\w.-]+:)?errorCode[^>]*>\s*(\d+)\s*</i.exec(res.body) || [])[1] || 0, text = (/<(?:[\w.-]+:)?errorDescription[^>]*>\s*([^<]*?)\s*</i.exec(res.body) || [])[1];
    const err = new Error(`the router refused ${action}` + (code ? ` (error ${code}${text ? ': ' + text : ''})` : ` (HTTP ${res.status})`));
    err.code = code; err.raw = res.body; throw err;
  }
  const out = parseFields(res.body);
  Object.defineProperty(out, 'raw', { value: res.body, enumerable: false });
  return out;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const isIpv4 = ip => { const m = IPV4.exec(String(ip || '').trim()); return !!m && m.slice(1).every(n => +n <= 255) && String(ip).trim() !== '0.0.0.0'; };

// Is this address one the public internet can reach? A router whose own "external" address is private is
// sitting behind another router or a carrier's shared address, and a mapping on it will not help.
export function isPublicAddress(ip) {
  if (!isIpv4(ip)) return false;
  const p = String(ip).trim().split('.').map(Number);
  const [a, b] = p;
  return !(a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
}

// A port mapping that keeps itself alive: open() creates it, a timer renews it at half its lease, and
// close() removes it. `find` is how the router is located (replaced in tests).
export class PortMapping {
  constructor({ port, description = 'Lane Duel', lease = 3600, retry = 60, askAgainAfter = 1, log = () => {}, debug = null, find = () => discover() }) {
    Object.assign(this, { port, description, lease, retry, askAgainAfter, log, debug, find, gw: null, timer: null, active: false });
  }
  async add() {
    const args = lease => ({ NewRemoteHost: '', NewExternalPort: this.port, NewProtocol: 'TCP', NewInternalPort: this.port, NewInternalClient: this.gw.localAddress,
      NewEnabled: 1, NewPortMappingDescription: this.description, NewLeaseDuration: lease });
    try { await soap(this.gw, 'AddPortMapping', args(this.lease), this.debug); return this.lease; }
    catch (e) {
      if (e.code !== 725) throw e;                     // 725 = this router only does permanent mappings
      await soap(this.gw, 'AddPortMapping', args(0), this.debug); return 0;
    }
  }
  // Ask the router for its public address. Every failure is logged with what the router actually sent back.
  // Resolves with the address, or null if the router would not give one.
  async askExternalIp() {
    const shown = raw => { const t = String(raw ?? '').trim(); return t ? t.slice(0, 500) + (t.length > 500 ? ' …' : '') : '(empty reply)'; };
    try {
      const res = await soap(this.gw, 'GetExternalIPAddress', {}, this.debug), ip = (res.NewExternalIPAddress || '').trim();
      if (isIpv4(ip)) return ip;
      this.log(`UPnP: the router answered GetExternalIPAddress without a usable address${ip ? ` ("${ip}")` : ''}. Its reply was:\n   ${shown(res.raw)}`);
    } catch (e) {
      this.log(`UPnP: GetExternalIPAddress failed: ${e.message}.` + (e.raw !== undefined ? ` The router's reply was:\n   ${shown(e.raw)}` : ''));
    }
    return null;
  }
  // Resolves with { externalIp, localAddress, lease } (lease 0 = permanent; externalIp null if the router would
  // not say, after asking twice). Rejects if the router cannot be found or refuses the mapping.
  async open() {
    this.gw = await gateway(await this.find());
    if (this.debug) this.debug(`UPnP: control URL ${this.gw.controlUrl}, service ${this.gw.serviceType}, this PC is ${this.gw.localAddress}`);
    const lease = await this.add(); this.active = true;
    if (lease > 0) this.schedule(lease / 2);
    let externalIp = await this.askExternalIp();
    if (!externalIp) { await new Promise(r => setTimeout(r, this.askAgainAfter * 1000)); externalIp = await this.askExternalIp(); }
    return { externalIp, localAddress: this.gw.localAddress, lease };
  }
  schedule(seconds) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.renew(), seconds * 1000); this.timer.unref();   // never keeps the process alive on its own
  }
  async renew() {
    if (!this.active) return;
    try { const lease = await this.add(); if (lease > 0) this.schedule(lease / 2); }
    catch (e) { this.log(`UPnP: could not renew the port mapping (${e.message}); trying again in ${this.retry}s.`); this.schedule(this.retry); }
  }
  async close() {
    clearTimeout(this.timer);
    if (!this.active) return false;
    this.active = false;
    await soap(this.gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: this.port, NewProtocol: 'TCP' }, this.debug);
    return true;
  }
}
