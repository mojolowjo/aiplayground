// Web server + WebSocket rooms. One Game per room.
//
// Settings (environment variables):
//   PORT            port to listen on and to open on the router        default 3000
//   UPNP            "off" to leave the router alone                    default on
//   DUCKDNS_DOMAIN  a DuckDNS name to show as the join address         optional
//   DUCKDNS_TOKEN   with the domain: keep that name pointed at this network   optional
//   UPNP_DEBUG      "1" prints every UPnP request and the router's raw replies     optional
//   UPNP_GATEWAY    the router's UPnP description URL, to skip the search     optional, rarely needed
//   PUBLIC_IP_URL   the "what is my IP" service used if the router will not say     default https://api.ipify.org
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, TICK, MAP, RULES } from './game/sim.js';
import { HEROES, SPELLS, ITEMS } from './game/data.js';
import { PortMapping, isPublicAddress } from './net/upnp.js';
import { duckName, startDuck } from './net/duckdns.js';
import { publicIp, PUBLIC_IP_SERVICE } from './net/publicip.js';
import { LIMITS, RateLimiter, PerIp, plainIp, isThisMachine, lanAddress, staticFiles } from './net/guard.js';

const PORT = +process.env.PORT || 3000;
const UPNP = !['off', '0', 'false', 'no'].includes(String(process.env.UPNP ?? 'on').trim().toLowerCase());
const UPNP_LEASE = 3600;                               // seconds; renewed at half time for as long as the server runs
const DUCK_EVERY = 300;                                // seconds between DuckDNS updates
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = staticFiles(path.join(HERE, 'public'), { '/shared': path.join(HERE, 'shared') });   // shared/ holds rules the browser runs too

// Only the game's own files are served (public/ and shared/): a fixed list read at start, GET and HEAD only.
const server = http.createServer((req, res) => {
  let rel = null; try { rel = decodeURIComponent(String(req.url).split('?')[0]); } catch { /* bad escape: not a file */ }
  // A quick "are you there": the desktop app's server list times this to show each server's ping.
  if (rel === '/ping' && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); return res.end(); }
  const hit = (req.method === 'GET' || req.method === 'HEAD') && FILES.get(rel);
  if (!hit) { res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 404 : 405, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
  fs.readFile(hit.file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.on('clientError', (err, socket) => socket.destroy());

// The address friends should use, once known. Shown in the lobby to the host only.
let join = { url: null, public: false, note: 'Working out the join address…' };
function setJoin(j) { join = j; for (const room of rooms.values()) lobby(room); }

const rooms = new Map();
let nextPid = 1;
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

const sizeOf = room => RULES.modes[room.mode];
const count = (room, team) => room.players.filter(p => p.team === team).length;
function lobby(room) {
  const players = room.players.map(p => ({ id: p.id, name: p.name, team: p.team, hero: p.hero })), size = sizeOf(room);
  const link = join.url && room.id !== 'main' ? `${join.url}/?room=${encodeURIComponent(room.id)}` : join.url;
  for (const p of room.players) send(p.ws, { t: 'lobby', players, inGame: !!room.game, mode: room.mode, size,
    goal: { kills: RULES.kills * size, cs: RULES.cs * size }, ...(p.host ? { join: { ...join, url: link } } : {}) });
}
const OPPONENTS = ['dummy', ...Object.keys(RULES.bot).filter(k => typeof RULES.bot[k] === 'object')];   // dummy, easy, normal, hard
function start(room, opp) {
  const ps = room.players.filter(p => p.hero).map(p => ({ id: p.id, team: p.team, hero: p.hero, name: p.name }));
  if (!ps.length || ps.length < room.players.length) return;
  // Empty seats are filled with the chosen practice opponent, on both teams.
  const keys = Object.keys(HEROES); let botId = -1;
  for (const team of ['blue', 'red']) while (ps.filter(p => p.team === team).length < sizeOf(room))
    ps.push({ id: botId--, team, hero: keys[Math.random() * keys.length | 0],
      name: opp === 'dummy' ? 'Dummy' : `Bot (${opp})`, bot: true, ai: opp === 'dummy' ? null : opp });
  room.game = new Game(ps, { seed: (Math.random() * 2 ** 32) >>> 0 });   // a fresh seed per match; the match itself never calls Math.random
  clearInterval(room.timer);
  let last = performance.now(), acc = 0;
  room.timer = setInterval(() => {
    const now = performance.now(); acc = Math.min(acc + now - last, 250); last = now;
    let stepped = false;
    while (acc >= 1000 / TICK) { room.game.step(); acc -= 1000 / TICK; stepped = true; }
    if (!stepped) return;
    for (const p of room.players) send(p.ws, room.game.snapshot(p.id));
    room.game.events = [];
    if (room.game.over) clearInterval(room.timer);
  }, 1000 / TICK / 2);
  lobby(room);
}

const perIp = new PerIp();
const own = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);     // a real entry, not something inherited like "constructor"
const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: LIMITS.maxMessageBytes });
wss.on('error', () => {});
wss.on('connection', (ws, req) => {
  const ip = plainIp(req.socket.remoteAddress);
  ws.on('error', () => {});                             // e.g. an oversized message: ws closes the connection itself
  if (!perIp.add(ip)) return ws.close(1013, 'too many connections from this address');
  const limiter = new RateLimiter();
  let room = null, me = null, dropped = false;
  const handle = m => {
    if (m.t === 'ping') return send(ws, { t: 'pong', c: Number.isFinite(m.c) ? m.c : 0 });
    if (m.t === 'join' && !me) {
      const id = String(m.room || 'main').slice(0, 24);
      if (!rooms.has(id) && rooms.size >= LIMITS.maxRooms) return send(ws, { t: 'full' });
      room = rooms.get(id) || { id, players: [], game: null, timer: null, mode: '1v1' };
      rooms.set(id, room);
      if (room.players.length >= 2 * sizeOf(room)) { room = null; return send(ws, { t: 'full' }); }
      const team = count(room, 'blue') <= count(room, 'red') ? 'blue' : 'red';
      me = { id: nextPid++, ws, team, hero: null, name: String(m.name || 'Player').slice(0, 16) || 'Player', host: isThisMachine(ip) };
      room.players.push(me);
      const strip = o => JSON.parse(JSON.stringify(o));
      send(ws, { t: 'hello', id: me.id, team, heroes: strip(HEROES), spells: strip(SPELLS), items: ITEMS, map: MAP, rules: RULES });
      return lobby(room);
    }
    if (!me) return;
    if (m.t === 'pick' && !room.game && own(HEROES, m.hero)) { me.hero = m.hero; lobby(room); }
    else if (m.t === 'mode' && !room.game && own(RULES.modes, m.mode)) {
      // Switching to a smaller mode only works if everyone still fits, one team each side.
      const size = RULES.modes[m.mode];
      if (count(room, 'blue') <= size && count(room, 'red') <= size) room.mode = m.mode;
      lobby(room);                                    // also when refused, so the asker's dropdown snaps back
    } else if (m.t === 'team' && !room.game) {
      const to = me.team === 'blue' ? 'red' : 'blue';
      if (count(room, to) < sizeOf(room)) { me.team = to; lobby(room); }
    }
    else if (m.t === 'start' && !room.game) start(room, OPPONENTS.includes(m.opp) ? m.opp : 'dummy');
    else if (m.t === 'rematch' && room.game && room.game.over) {
      room.game = null; for (const p of room.players) p.hero = null; lobby(room);
    } else if (m.t === 'cmd' && room.game) room.game.command(me.id, m);
  };
  ws.on('message', raw => {
    // Too many messages: this is not a player. Stop listening to it, say why, and cut it off if it lingers.
    if (dropped) return;
    if (!limiter.allow()) { dropped = true; ws.close(1008, 'too many messages'); setTimeout(() => ws.terminate(), 1000).unref(); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }             // not JSON: ignore
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;   // not a message: ignore
    try { handle(m); } catch (e) { console.error('Ignored a message that caused an error:', e.message); }
  });
  ws.on('close', () => {
    perIp.remove(ip);
    if (!room || !me) return;
    room.players = room.players.filter(p => p !== me);
    if (!room.players.length) { clearInterval(room.timer); rooms.delete(room.id); }
    else { if (room.game && !room.game.over) { clearInterval(room.timer); room.game = null; for (const p of room.players) { p.hero = null; send(p.ws, { t: 'left' }); } } lobby(room); }
  });
});

// ---------- going public: UPnP port mapping, the join address, DuckDNS ----------
const duck = duckName(process.env.DUCKDNS_DOMAIN), duckToken = process.env.DUCKDNS_TOKEN || '';
const duckUrl = duck ? `http://${duck}.duckdns.org:${PORT}` : null;
const UPNP_DEBUG = ['1', 'on', 'true', 'yes'].includes(String(process.env.UPNP_DEBUG || '').trim().toLowerCase());
const mapping = new PortMapping({ port: PORT, description: 'Lane Duel', lease: UPNP_LEASE, log: m => console.log(m), debug: UPNP_DEBUG ? m => console.log(m) : null,
  ...(process.env.UPNP_GATEWAY ? { find: async () => process.env.UPNP_GATEWAY } : {}) });
let duckJob = null;

async function goPublic() {
  const lan = lanAddress(), lanUrl = lan ? `http://${lan}:${PORT}` : `http://localhost:${PORT}`;
  const localOnly = why => { console.log(`WARNING: ${why}\n         The game is only reachable on your local network: ${lanUrl}`); setJoin({ url: lanUrl, public: false, note: 'Local network only: ' + why }); };
  if (process.env.DUCKDNS_DOMAIN && !duck) console.log('WARNING: DUCKDNS_DOMAIN is not a valid DuckDNS name; ignoring it.');
  if (duck && duckToken) duckJob = startDuck({ name: duck, token: duckToken, every: DUCK_EVERY, log: m => console.log(m) });
  else if (duck) console.log('DuckDNS: DUCKDNS_TOKEN is not set, so the name will not be updated if your IP changes.');
  if (!UPNP) {
    console.log(`UPnP is off. Forward TCP port ${PORT} on your router to this PC yourself.`);
    return setJoin(duckUrl ? { url: duckUrl, public: true, note: 'UPnP is off: this only works if you forwarded the port yourself.' }
      : { url: lanUrl, public: false, note: `UPnP is off. On your local network use this address; from outside, forward TCP port ${PORT} and give friends your public IP.` });
  }
  let res;
  try { res = await mapping.open(); }
  catch (e) { return localOnly(`UPnP could not open port ${PORT} on your router (${e.message}).`); }
  console.log(`UPnP: router now forwards TCP port ${PORT} to this PC (${res.localAddress}), ` + (res.lease ? `lease ${Math.round(res.lease / 60)} min, renewed automatically.` : 'as a permanent mapping (this router does not do leases).'));
  // From here on the port IS open on the router; what is left is finding the address to hand out.
  let ip = res.externalIp, source = 'your router';
  if (ip && !isPublicAddress(ip)) {
    console.log(`WARNING: Port ${PORT} is open on this router, but the router's own address (${ip}) is not a public one, so it sits behind another router or a shared\n         address from your provider. Friends probably cannot get through; if they cannot, use the tunnel instead (see README).`);
    return setJoin({ url: lanUrl, public: false, note: `The router's own address (${ip}) is not public; friends outside your network probably cannot connect. See the tunnel in the README.` });
  }
  if (!ip) {
    // The router would not say (its replies are logged above). Ask a "what is my IP" service instead.
    try { const found = await publicIp({ url: process.env.PUBLIC_IP_URL || PUBLIC_IP_SERVICE }); ip = found.ip; source = found.source; }
    catch (e) { console.log(`Public address: could not get one from ${new URL(process.env.PUBLIC_IP_URL || PUBLIC_IP_SERVICE).host} either (${e.message}).`); }
  }
  if (ip) console.log(`Public address: ${ip} (from ${source}).`);
  const url = duckUrl || (ip ? `http://${ip}:${PORT}` : null);
  if (!url) {
    const msg = `Port ${PORT} is open on the router. Couldn't find your public address automatically; look it up and give friends http://<that address>:${PORT}.`;
    console.log(msg); return setJoin({ url: null, public: true, note: msg });
  }
  console.log(`Friends join at: ${url}`);
  setJoin({ url, public: true, note: '' });
}

let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  if (duckJob) duckJob.stop();
  try {
    const removed = await Promise.race([mapping.close(), new Promise((_, no) => setTimeout(() => no(new Error('the router did not answer')), 3000))]);
    if (removed) console.log('UPnP: port mapping removed.');
  } catch (e) { console.log(`WARNING: could not remove the UPnP port mapping (${e.message}). It will expire on its own.`); }
  process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other program or set PORT to something else.` : e.message); process.exit(1); });
server.listen(PORT, () => { console.log(`Lane Duel running: http://localhost:${PORT}`); goPublic(); });
