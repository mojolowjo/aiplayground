// Banner Clash server: serves the game and referees friend 1v1s over WebSocket.
// Bot matches never touch it after the page loads; they run entirely in the browser.
//
// The battle is deterministic, so the server only relays card plays: it checks each play, fixes the tick it
// happens on, sends it to both players and runs the same simulation itself to decide the winner.
//
// Settings (environment variables), the same as Lane Duel's:
//   PORT            port to listen on and to open on the router        default 3000
//   UPNP            "off" to leave the router alone                    default on
//   DUCKDNS_DOMAIN  a DuckDNS name to show as the join address         optional
//   DUCKDNS_TOKEN   with the domain: keep that name pointed at this network   optional
//   UPNP_DEBUG      "1" prints every UPnP request and the router's raw replies     optional
//   UPNP_GATEWAY    the router's UPnP description URL, to skip the search     optional, rarely needed
//   PUBLIC_IP_URL   the "what is my IP" service used if the router will not say     default https://api.ipify.org
//   ACCOUNTS_FILE   where player accounts and saves are kept                default saves/accounts.json
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Battle, TPS, DEFAULT_SETTINGS } from './shared/sim.js';
import { CARDS, CARD_IDS, MAX_LEVEL } from './shared/cards.js';
import { PortMapping, isPublicAddress } from './net/upnp.js';
import { duckName, startDuck } from './net/duckdns.js';
import { publicIp, PUBLIC_IP_SERVICE } from './net/publicip.js';
import { LIMITS, RateLimiter, PerIp, plainIp, isThisMachine, lanAddress, staticFiles } from './net/guard.js';
import { Accounts } from './accounts.js';

const PORT = +process.env.PORT || 3000;
const UPNP = !['off', '0', 'false', 'no'].includes(String(process.env.UPNP ?? 'on').trim().toLowerCase());
const UPNP_LEASE = 3600;
const DUCK_EVERY = 300;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = staticFiles(path.join(HERE, 'public'), { '/shared': path.join(HERE, 'shared') });
const accounts = new Accounts(process.env.ACCOUNTS_FILE || path.join(HERE, 'saves', 'accounts.json'));
const MAX_ROOMS = 10;                     // a few friends: far fewer rooms than Lane Duel's 50 (guess)
const HOLD_SEAT = 60;                     // seconds a dropped player's seat is held (guess)
const COUNTDOWN = 3000;                   // ms before the first tick, hides any clock difference
const MAX_LEAD = 20;                      // ticks ahead a play may be scheduled

const server = http.createServer((req, res) => {
  let rel = null; try { rel = decodeURIComponent(String(req.url).split('?')[0]); } catch { /* bad escape */ }
  if (rel === '/ping' && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); return res.end(); }
  if (rel && accounts.handle(req, res, rel, plainIp(req.socket.remoteAddress))) return;
  const hit = (req.method === 'GET' || req.method === 'HEAD') && FILES.get(rel);
  if (!hit) { res.writeHead(req.method === 'GET' || req.method === 'HEAD' ? 404 : 405, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
  fs.readFile(hit.file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.on('clientError', (err, socket) => socket.destroy());

let join = { url: null, public: false, note: 'Working out the join address…' };
function setJoin(j) { join = j; for (const room of rooms.values()) lobby(room); }

// ---------- rooms ----------
export const DEFAULT_ROOM_SETTINGS = { level: 'shared9', length: 180, spark: 'normal', startSpark: 5, towers: 100, deckRule: 'own', tie: 'extend', bets: 'on' };
const ALLOWED = {
  level: ['own', ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => 'shared' + n)], length: ['120', '180', '300'], spark: ['normal', 'double', 'triple'],
  startSpark: ['5', '7', '10'], towers: ['50', '100', '200'], deckRule: ['own', 'mirror', 'random'], tie: ['extend', 'tiebreak', 'draw'], bets: ['on', 'off'],
};
const NUMERIC = new Set(['length', 'startSpark', 'towers']);
const rooms = new Map();
const send = (ws, m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
const both = (room, m) => { for (const p of room.seats) if (p) send(p.ws, m); };

function lobby(room) {
  const players = room.seats.map(p => p && { name: p.name, ready: p.ready, bet: p.bet, away: p.away });
  for (let i = 0; i < 2; i++) {
    const p = room.seats[i]; if (!p) continue;
    const link = join.url && room.id !== 'main' ? `${join.url}/?room=${encodeURIComponent(room.id)}` : join.url;
    send(p.ws, { t: 'lobby', room: room.id, you: i, players, settings: room.settings, inGame: !!room.battle && !room.battle.s.over, ...(p.host ? { join: { ...join, url: link } } : {}) });
  }
}
function cleanDeck(deck) {
  if (!Array.isArray(deck)) return null;
  const d = [...new Set(deck.filter(id => typeof id === 'string' && Object.hasOwn(CARDS, id)))];
  return d.length === 8 ? d : null;
}
function cleanLevels(levels) {
  const out = {};
  if (levels && typeof levels === 'object') for (const id of CARD_IDS) { const v = levels[id] | 0; if (v >= 1) out[id] = Math.min(MAX_LEVEL, v); }
  return out;
}
function shuffled(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function start(room) {
  const [a, b] = room.seats, S = room.settings;
  let decks = [a.deck, b.deck];
  if (S.deckRule === 'mirror') decks = [a.deck.slice(), a.deck.slice()];
  if (S.deckRule === 'random') decks = [shuffled(CARD_IDS).slice(0, 8), shuffled(CARD_IDS).slice(0, 8)];
  let levels, towerLevels, levelText;
  if (S.level === 'own') {
    levels = [a.levels, b.levels];
    towerLevels = decks.map((d, i) => Math.max(1, Math.floor(d.reduce((s, id) => s + (levels[i][id] || 1), 0) / 8)));
    levelText = 'own levels';
  } else {
    const L = +S.level.slice(6) || 9;
    levels = decks.map(d => Object.fromEntries(d.map(id => [id, L])));
    towerLevels = [L, L]; levelText = 'Lv ' + L;
  }
  const bets = S.bets === 'on' ? [a.bet, b.bet] : [0, 0];
  const settings = { ...DEFAULT_SETTINGS, length: S.length, spark: S.spark, startSpark: S.startSpark, towerPct: S.towers, tie: S.tie };
  const seed = crypto.randomInt(1, 2 ** 31);
  room.start = { seed, decks, levels, towerLevels, settings, names: [a.name, b.name], bets, levelText };
  room.battle = new Battle(room.start);
  room.cmds = []; room.ended = false;
  for (const p of room.seats) p.ready = false;
  room.t0 = performance.now() + COUNTDOWN;
  for (let i = 0; i < 2; i++) send(room.seats[i].ws, { t: 'start', side: i, ...room.start, countdown: COUNTDOWN });
  clearInterval(room.timer);
  room.timer = setInterval(() => run(room), 10);
  console.log(`Room ${room.id}: ${a.name} vs ${b.name} started.`);
}

function run(room) {
  const b = room.battle; if (!b) return;
  const target = Math.floor((performance.now() - room.t0) / (1000 / TPS));
  let steps = 0;
  while (b.tick < target && !b.s.over && steps++ < 10) {
    b.step(); b.events = [];
    if (b.tick % 5 === 0) both(room, { t: 'tk', n: b.tick });
    if (b.tick % 20 === 0) both(room, { t: 'sync', tick: b.tick, hash: b.hash() });
  }
  if (b.s.over && !room.ended) finish(room);
}

function finish(room) {
  const b = room.battle, s = b.s;
  room.ended = true; clearInterval(room.timer);
  const bets = room.start.bets;
  const pot = s.winner === -1 ? 0 : bets[0] + bets[1];
  both(room, { t: 'end', winner: s.winner, reason: s.reason, banners: s.players.map(p => p.banners), pot });
  for (const p of room.seats) if (p) { clearTimeout(p.awayTimer); p.bet = 0; }
  console.log(`Room ${room.id}: ended (${s.reason}), winner ${s.winner === -1 ? 'none' : room.start.names[s.winner]}.`);
  // Drop seats whose players never came back.
  room.seats = room.seats.map(p => p && p.away ? null : p);
  lobby(room);
  if (!room.seats.some(Boolean)) rooms.delete(room.id);
}

const perIp = new PerIp();
const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: LIMITS.maxMessageBytes });
wss.on('error', () => {});
wss.on('connection', (ws, req) => {
  const ip = plainIp(req.socket.remoteAddress);
  ws.on('error', () => {});
  if (!perIp.add(ip)) return ws.close(1013, 'too many connections from this address');
  const limiter = new RateLimiter({ perSec: 20, burst: 40 });   // a card game sends far less than Lane Duel (guess)
  let room = null, me = null, seat = -1, dropped = false, lastResync = 0, lastEmote = 0;
  const handle = m => {
    if (m.t === 'ping') return send(ws, { t: 'pong', c: Number.isFinite(m.c) ? m.c : 0 });
    if (m.t === 'join' && !me) {
      const id = String(m.room || 'main').replace(/[^\w-]/g, '').slice(0, 24) || 'main';
      if (!rooms.has(id) && rooms.size >= MAX_ROOMS) return send(ws, { t: 'full' });
      room = rooms.get(id) || { id, seats: [null, null], settings: { ...DEFAULT_ROOM_SETTINGS }, battle: null, cmds: [], timer: null };
      rooms.set(id, room);
      // Coming back to a held seat?
      const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
      const back = token && room.seats.findIndex(p => p && p.token === token && p.away);
      if (token && back >= 0) {
        seat = back; me = room.seats[seat]; me.ws = ws; me.away = false; clearTimeout(me.awayTimer);
        if (room.battle && !room.battle.s.over) {
          send(ws, { t: 'start', side: seat, ...room.start, resume: true, state: room.battle.snapshot(), cmds: room.cmds, countdown: 0 });
          send(room.seats[1 - seat]?.ws, { t: 'opp', status: 'back' });
        }
        return lobby(room);
      }
      seat = room.seats.findIndex(p => !p);
      if (seat < 0) { const r = room; room = null; if (!r.seats.some(Boolean)) rooms.delete(r.id); return send(ws, { t: 'full' }); }
      me = { ws, name: String(m.name || 'Player').slice(0, 16) || 'Player', token: crypto.randomBytes(12).toString('hex'), ready: false, bet: 0,
        coins: Math.max(0, m.coins | 0), deck: null, levels: {}, away: false, host: isThisMachine(ip) };
      room.seats[seat] = me;
      send(ws, { t: 'token', token: me.token });
      return lobby(room);
    }
    if (!me) return;
    const b = room.battle, live = b && !b.s.over;
    if (m.t === 'deck' && !live) { me.deck = cleanDeck(m.deck) || me.deck; me.levels = cleanLevels(m.levels); }
    else if (m.t === 'settings' && !live && seat === 0 && m.settings && typeof m.settings === 'object') {
      for (const [k, v] of Object.entries(m.settings)) if (Object.hasOwn(ALLOWED, k) && ALLOWED[k].includes(String(v))) room.settings[k] = NUMERIC.has(k) ? +v : String(v);
      for (const p of room.seats) if (p) p.ready = false;
      lobby(room);
    } else if (m.t === 'bet' && !live) {
      if (Number.isFinite(m.coins)) me.coins = Math.max(0, m.coins | 0);
      me.bet = Math.max(0, Math.min(me.coins, m.amount | 0));
      for (const p of room.seats) if (p) p.ready = false;
      lobby(room);
    } else if (m.t === 'ready' && !live) {
      me.ready = !!m.ready && !!me.deck;
      lobby(room);
      if (room.seats.every(p => p && p.ready && p.deck && !p.away)) start(room);
    } else if (m.t === 'play' && live && b.tick >= 0) {
      const card = typeof m.card === 'string' && Object.hasOwn(CARDS, m.card) ? m.card : null;
      if (!card || !Number.isFinite(m.x) || !Number.isFinite(m.y) || !b.canPlay(seat, card) || b.s.pending.some(c => c.side === seat && c.card === card))
        return send(ws, { t: 'rejected', card: m.card });
      const tick = Math.max(b.tick, Math.min(b.tick + MAX_LEAD, m.want | 0));
      const c = { tick, side: seat, type: 'play', card, x: Math.round(m.x), y: Math.round(m.y) };
      room.cmds.push(c); b.schedule(c); both(room, { t: 'cmd', c });
    } else if (m.t === 'extend' && live && b.s.vote) {
      const c = { tick: b.tick, side: seat, type: 'extend', yes: !!m.yes };
      room.cmds.push(c); b.schedule(c); both(room, { t: 'cmd', c });
    } else if (m.t === 'resync' && live) {
      const now = performance.now(); if (now - lastResync < 1000) return; lastResync = now;
      send(ws, { t: 'state', state: b.snapshot(), cmds: room.cmds });
    } else if (m.t === 'emote' && live) {
      const now = performance.now(); if (now - lastEmote < 2000) return; lastEmote = now;
      both(room, { t: 'emote', side: seat, text: String(m.text || '').slice(0, 40) });
    } else if (m.t === 'rematch' && b && b.s.over) {
      room.battle = null; lobby(room);
    } else if (m.t === 'leave') {
      if (live) b.end(1 - seat, 'forfeit');
      ws.close();
    }
  };
  ws.on('message', raw => {
    if (dropped) return;
    if (!limiter.allow()) { dropped = true; ws.close(1008, 'too many messages'); setTimeout(() => ws.terminate(), 1000).unref(); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
    try { handle(m); } catch (e) { console.error('Ignored a message that caused an error:', e.message); }
  });
  ws.on('close', () => {
    perIp.remove(ip);
    if (!room || !me || me.ws !== ws) return;
    const b = room.battle;
    if (b && !b.s.over) {
      // Hold the seat: the match runs on, and the player can come back with their token.
      me.away = true;
      send(room.seats[1 - seat]?.ws, { t: 'opp', status: 'dropped' });
      me.awayTimer = setTimeout(() => { if (me.away && room.battle === b && !b.s.over) { b.end(1 - seat, 'forfeit'); run(room); } }, HOLD_SEAT * 1000);
      if (room.seats.every(p => p && p.away)) { b.end(-1, 'abandoned'); run(room); }
      return;
    }
    room.seats[seat] = null;
    if (seat === 0 && room.seats[1]) { room.seats[0] = room.seats[1]; room.seats[1] = null; }      // the guest becomes the host
    for (const p of room.seats) if (p) p.ready = false;
    if (!room.seats.some(Boolean)) { clearInterval(room.timer); rooms.delete(room.id); } else lobby(room);
  });
});

// ---------- going public: UPnP port mapping, the join address, DuckDNS (from Lane Duel) ----------
const duck = duckName(process.env.DUCKDNS_DOMAIN), duckToken = process.env.DUCKDNS_TOKEN || '';
const duckUrl = duck ? `http://${duck}.duckdns.org:${PORT}` : null;
const UPNP_DEBUG = ['1', 'on', 'true', 'yes'].includes(String(process.env.UPNP_DEBUG || '').trim().toLowerCase());
const mapping = new PortMapping({ port: PORT, description: 'Banner Clash', lease: UPNP_LEASE, log: m => console.log(m), debug: UPNP_DEBUG ? m => console.log(m) : null,
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
  let ip = res.externalIp, source = 'your router';
  if (ip && !isPublicAddress(ip)) {
    console.log(`WARNING: Port ${PORT} is open on this router, but the router's own address (${ip}) is not a public one (CGNAT or a second router).\n         Friends probably cannot get through. See "If friends cannot connect" in the README.`);
    return setJoin({ url: lanUrl, public: false, note: `The router's own address (${ip}) is not public; friends outside your network probably cannot connect. See the README.` });
  }
  if (!ip) {
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
  try { accounts.flush(); } catch (e) { console.log('Could not write accounts: ' + e.message); }
  if (duckJob) duckJob.stop();
  try {
    const removed = await Promise.race([mapping.close(), new Promise((_, no) => setTimeout(() => no(new Error('the router did not answer')), 3000))]);
    if (removed) console.log('UPnP: port mapping removed.');
  } catch (e) { console.log(`WARNING: could not remove the UPnP port mapping (${e.message}). It will expire on its own.`); }
  process.exit(0);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); process.on('SIGBREAK', shutdown); // SIGBREAK: Ctrl+Break or closing the console window on Windows

server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other program or set PORT to something else.` : e.message); process.exit(1); });
server.listen(PORT, () => { console.log(`Banner Clash running: http://localhost:${PORT}`); goPublic(); });
