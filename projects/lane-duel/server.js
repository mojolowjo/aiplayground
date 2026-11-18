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

const sizeOf = room => RULES.modes[room.mode];
const count = (room, team) => room.players.filter(p => p.team === team).length;
function lobby(room) {
  const players = room.players.map(p => ({ id: p.id, name: p.name, team: p.team, hero: p.hero })), size = sizeOf(room);
  for (const p of room.players) send(p.ws, { t: 'lobby', players, inGame: !!room.game, mode: room.mode, size,
    goal: { kills: RULES.kills * size, cs: RULES.cs * size } });
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
      room = rooms.get(id) || { id, players: [], game: null, timer: null, mode: '1v1' };
      rooms.set(id, room);
      if (room.players.length >= 2 * sizeOf(room)) { room = null; return send(ws, { t: 'full' }); }
      const team = count(room, 'blue') <= count(room, 'red') ? 'blue' : 'red';
      me = { id: nextPid++, ws, team, hero: null, name: String(m.name || 'Player').slice(0, 16) || 'Player' };
      room.players.push(me);
      const strip = o => JSON.parse(JSON.stringify(o));
      send(ws, { t: 'hello', id: me.id, team, heroes: strip(HEROES), spells: strip(SPELLS), items: ITEMS, map: MAP, rules: RULES });
      return lobby(room);
    }
    if (!me) return;
    if (m.t === 'pick' && !room.game && HEROES[m.hero]) { me.hero = m.hero; lobby(room); }
    else if (m.t === 'mode' && !room.game && RULES.modes[m.mode]) {
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
  });
  ws.on('close', () => {
    if (!room || !me) return;
    room.players = room.players.filter(p => p !== me);
    if (!room.players.length) { clearInterval(room.timer); rooms.delete(room.id); }
    else { if (room.game && !room.game.over) { clearInterval(room.timer); room.game = null; for (const p of room.players) { p.hero = null; send(p.ws, { t: 'left' }); } } lobby(room); }
  });
});

server.listen(PORT, () => console.log(`Lane Duel running: http://localhost:${PORT}`));
