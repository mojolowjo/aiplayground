// Starts the real server, joins two players, plays cards, and checks both players' simulations
// match the server's checksums. Also checks the abuse limits and a held seat on disconnect.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { Battle } from '../shared/sim.js';

const PORT = 3400 + Math.floor(Math.random() * 500);
const srv = spawn(process.execPath, ['server.js'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: String(PORT), UPNP: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(20); } throw new Error('timed out\n' + log); };
try {
  await until(() => log.includes('running'));
  const res = await fetch(`http://localhost:${PORT}/shared/sim.js`); assert.equal(res.status, 200);
  assert.equal((await fetch(`http://localhost:${PORT}/../server.js`)).status, 404);
  assert.equal((await fetch(`http://localhost:${PORT}/net/guard.js`)).status, 404, 'only game files are served');

  const deck = ['imps', 'fox', 'hedge', 'slingers', 'moths', 'shower', 'gust', 'turret'];
  const mk = name => new Promise(ok => {
    const ws = new WebSocket(`ws://localhost:${PORT}`), c = { ws, name, msgs: [], cmds: [], syncs: [] };
    ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 'cmd') c.cmds.push(m.c); if (m.t === 'sync') c.syncs.push(m); if (m.t === 'start') c.start = m; if (m.t === 'end') c.end = m; if (m.t === 'token') c.token = m.token; });
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'join', room: 'test', name, coins: 500 })); ws.send(JSON.stringify({ t: 'deck', deck, levels: {} })); ok(c); });
  });
  const A = await mk('Ann'), B = await mk('Ben');
  const send = (c, m) => c.ws.send(JSON.stringify(m));
  await until(() => B.msgs.some(m => m.t === 'lobby' && m.players[1]));
  send(A, { t: 'settings', settings: { length: 120, spark: 'triple', tie: 'tiebreak', level: 'shared5' } });
  send(A, { t: 'bet', amount: 100, coins: 500 }); send(B, { t: 'bet', amount: 50, coins: 500 });
  await until(() => A.msgs.some(m => m.t === 'lobby' && m.players[0].bet === 100 && m.players[1].bet === 50));
  send(A, { t: 'ready', ready: true }); send(B, { t: 'ready', ready: true });
  await until(() => A.start && B.start);
  assert.equal(A.start.side, 0); assert.equal(B.start.side, 1); assert.equal(A.start.seed, B.start.seed);
  assert.equal(A.start.settings.spark, 'triple'); assert.deepEqual(A.start.bets, [100, 50]); assert.equal(A.start.levels[0].imps, 5);
  // Play: each side drops cards as Spark allows.
  await wait(3500);
  for (let k = 0; k < 6; k++) {
    for (const [i, c] of [A, B].entries()) for (const card of deck) send(c, { t: 'play', card, x: 4000 + k * 1000, y: i ? 10000 : 22000, want: 0 });
    await wait(700);
  }
  send(A, { t: 'play', card: 'nope', x: 1, y: 1 });
  await until(() => A.msgs.some(m => m.t === 'rejected'));
  await until(() => A.syncs.length >= 8 && A.cmds.length >= 2);
  // Re-run each player's view of the match and compare with the server's checksums.
  for (const c of [A, B]) {
    const b = new Battle(c.start); for (const cmd of c.cmds) b.schedule(cmd);
    let checked = 0;
    for (const sy of c.syncs) { while (b.tick < sy.tick) b.step(); assert.equal(b.hash(), sy.hash, `${c.name} in sync at ${sy.tick}`); checked++; }
    assert.ok(checked >= 8);
  }
  // Disconnect and come back to the held seat.
  B.ws.close(); await until(() => A.msgs.some(m => m.t === 'opp' && m.status === 'dropped'));
  const B2 = await new Promise(ok => { const ws = new WebSocket(`ws://localhost:${PORT}`), c = { ws, msgs: [] }; ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 'start') c.start = m; }); ws.on('open', () => { ws.send(JSON.stringify({ t: 'join', room: 'test', name: 'Ben', token: B.token })); ok(c); }); });
  await until(() => B2.start && B2.start.resume && B2.start.state);
  assert.equal(B2.start.side, 1);
  // Forfeit ends it and pays the pot to the winner.
  B2.ws.send(JSON.stringify({ t: 'leave' }));
  await until(() => A.end);
  assert.equal(A.end.winner, 0); assert.equal(A.end.pot, 150); assert.equal(A.end.reason, 'forfeit');
  // Flooding gets a connection cut.
  const F = await mk('Flood'); for (let i = 0; i < 200; i++) F.ws.send('{"t":"ping","c":1}');
  await until(() => F.ws.readyState === 3);
  for (const c of [A, F]) c.ws.close();
  console.log('server tests passed');
} finally { srv.kill(); }
