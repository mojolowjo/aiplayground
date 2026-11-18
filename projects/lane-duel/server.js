// HTTP static server + WebSocket rooms. One Game per room.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, TICK, MAP, RULES } from './game/sim.js';
import { HEROES, SPELLS, ITEMS } from './game/data.js';

const PORT = process.env.PORT || 3000;
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(PUB, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();
let nextPid = 1;
const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));

function lobby(room) {
  const players = room.players.map(p => ({ id: p.id, name: p.name, team: p.team, hero: p.hero }));
  for (const p of room.players) send(p.ws, { t: 'lobby', players, inGame: !!room.game });
}
const OPPONENTS = ['dummy', ...Object.keys(RULES.bot).filter(k => typeof RULES.bot[k] === 'object')];   // dummy, easy, normal, hard
function start(room, opp) {
  const ps = room.players.filter(p => p.hero).map(p => ({ id: p.id, team: p.team, hero: p.hero, name: p.name }));
  if (!ps.length || ps.length < room.players.length) return;
  if (ps.length === 1) {
    const keys = Object.keys(HEROES);
    ps.push({ id: -1, team: ps[0].team === 'blue' ? 'red' : 'blue', hero: keys[Math.random() * keys.length | 0],
      name: opp === 'dummy' ? 'Dummy' : `Bot (${opp})`, bot: true, ai: opp === 'dummy' ? null : opp });
  }
  room.game = new Game(ps);
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

new WebSocketServer({ server, perMessageDeflate: false }).on('connection', ws => {
  let room = null, me = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c });
    if (m.t === 'join' && !me) {
      const id = String(m.room || 'main').slice(0, 24);
      room = rooms.get(id) || { id, players: [], game: null, timer: null };
      rooms.set(id, room);
      if (room.players.length >= 2) { room = null; return send(ws, { t: 'full' }); }
      const team = room.players.some(p => p.team === 'blue') ? 'red' : 'blue';
      me = { id: nextPid++, ws, team, hero: null, name: String(m.name || 'Player').slice(0, 16) || 'Player' };
      room.players.push(me);
      const strip = o => JSON.parse(JSON.stringify(o));
      send(ws, { t: 'hello', id: me.id, team, heroes: strip(HEROES), spells: strip(SPELLS), items: ITEMS, map: MAP, rules: RULES });
      return lobby(room);
    }
    if (!me) return;
    if (m.t === 'pick' && !room.game && HEROES[m.hero]) { me.hero = m.hero; lobby(room); }
    else if (m.t === 'start' && !room.game) start(room, OPPONENTS.includes(m.opp) ? m.opp : 'dummy');
    else if (m.t === 'rematch' && room.game && room.game.over) {
      room.game = null; for (const p of room.players) p.hero = null; lobby(room);
    } else if (m.t === 'cmd' && room.game) room.game.command(me.id, m);
  });
  ws.on('close', () => {
    if (!room || !me) return;
    room.players = room.players.filter(p => p !== me);
    if (!room.players.length) { clearInterval(room.timer); rooms.delete(room.id); }
    else { if (room.game && !room.game.over) { clearInterval(room.timer); room.game = null; for (const p of room.players) { p.hero = null; send(p.ws, { t: 'left' }); } } lobby(room); }
  });
});

server.listen(PORT, () => console.log(`Lane Duel running: http://localhost:${PORT}`));
