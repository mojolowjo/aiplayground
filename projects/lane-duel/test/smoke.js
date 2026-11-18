// Headless rules check: runs the simulation directly, no network.
import assert from 'node:assert';
import { Game, TICK, MAP } from '../game/sim.js';
import { HEROES } from '../game/data.js';

const run = (g, secs) => { for (let i = 0; i < secs * TICK; i++) g.step(); };
const mk = (a, b) => new Game([{ id: 1, team: 'blue', hero: a, name: 'A' }, { id: 2, team: 'red', hero: b, name: 'B' }]);

// 1. movement + minions meet + last hits give gold
{
  const g = mk('vesk', 'oriel'), h = g.heroes.get(1);
  g.command(1, { c: 'lvl', s: 0 }); assert.equal(h.ranks[0], 1);
  g.command(1, { c: 'move', x: 2600, y: 800 }); run(g, 10);
  assert(Math.abs(h.x - 2600) < 5, 'hero walked to target: ' + h.x);
  g.command(1, { c: 'amove', x: 3300, y: 800 }); run(g, 50);
  const minions = [...g.units.values()].filter(u => u.type === 'minion');
  assert(minions.length > 0, 'minions exist');
  assert(h.cs > 0 && h.gold > 500, `attack-move farmed: cs=${h.cs} gold=${h.gold | 0}`);
  assert(h.lvl > 1, 'levelled up');
  console.log(`farm ok: cs=${h.cs} lvl=${h.lvl} gold=${h.gold | 0} t=${g.time | 0}s`);
}
// 2. every ability of every hero casts without throwing and spends its cooldown
for (const key of Object.keys(HEROES)) {
  const g = mk(key, 'brakk'), h = g.heroes.get(1), e = g.heroes.get(2);
  h.lvl = 6; h.points = 4; g.refresh(h); h.mp = h.mmp;
  h.x = 3000; h.y = 800; e.x = 3300; e.y = 800; e.hp = e.mhp = 5000;
  for (let s = 0; s < 4; s++) {
    g.command(1, { c: 'lvl', s }); const hp = e.hp;
    if (HEROES[key].abilities[s].charge) { g.command(1, { c: 'charge', s }); run(g, 0.2); }
    g.command(1, { c: 'cast', s, x: e.x, y: e.y, id: e.id });
    assert(h.cds[s] > g.time, `${key} ${s} went on cooldown`);
    g.command(1, { c: 'atk', id: e.id }); run(g, 2.5);
    console.log(`  ${key} ${HEROES[key].abilities[s].name}: enemy lost ${Math.round(hp - e.hp)} hp`);
  }
  g.command(1, { c: 'spell', s: 'd', x: h.x + 1000, y: h.y }); g.command(1, { c: 'spell', s: 'f' }); run(g, 1);
}
// 3. kills end the game; tower dive hurts; snapshots hide brush
{
  const g = mk('sliv', 'oriel'), h = g.heroes.get(1), e = g.heroes.get(2);
  h.x = 3000; e.x = 3100; h.y = e.y = 800;
  for (let k = 0; k < 2; k++) { e.hp = 1; g.command(1, { c: 'atk', id: e.id }); run(g, 3); e.dead = false; e.x = h.x + 100; e.y = h.y; }
  assert.equal(h.kills, 2); assert(g.over && g.over.winner === 'blue', 'game over on kills');
  const g2 = mk('vesk', 'oriel'), a = g2.heroes.get(1), b = g2.heroes.get(2);
  b.x = MAP.brush[0].x + 100; b.y = MAP.brush[0].y + 50; a.x = 3000; a.y = 800;
  assert(!g2.snapshot(1).units.some(u => u.id === b.id), 'enemy in brush hidden');
  a.x = b.x + 80; a.y = b.y;
  assert(g2.snapshot(1).units.some(u => u.id === b.id), 'visible once you enter the brush');
  a.x = MAP.tower.red.x - 300; a.y = 800; b.x = a.x + 200; b.y = 800; const hp = a.hp;
  g2.command(1, { c: 'atk', id: b.id }); run(g2, 4);
  assert(a.hp < hp - 200, 'tower punished the dive');
  JSON.stringify(g2.snapshot(1));
}
// 4. Kessa: every ability is telegraph -> delay -> resolve, driven by the ability state machine
{
  const g = mk('kessa', 'brakk'), h = g.heroes.get(1), e = g.heroes.get(2);
  h.lvl = 6; h.points = 4; g.refresh(h); for (let s = 0; s < 4; s++) g.command(1, { c: 'lvl', s });
  const reset = dx => { h.x = 3000; e.x = 3000 + dx; h.y = e.y = 800; e.hp = e.mhp = 5000; e.stunUntil = 0; e.buffs = []; h.mp = h.mmp; h.cds = [0, 0, 0, 0]; h.order = null; };
  const beam = () => g.zones.find(z => z.shape === 'line');

  // W: nothing happens during the delay; the centre hits harder and slows harder than the rim
  reset(800); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); run(g, 0.6);
  assert.equal(e.hp, 5000, 'W does nothing during its delay'); run(g, 0.5);
  const centre = 5000 - e.hp; assert(centre > 0 && g.buffMax(e, 'slow') === 0.6, 'W centre hit: ' + centre);
  reset(800); g.command(1, { c: 'cast', s: 1, x: e.x + 200, y: e.y }); run(g, 1.1);
  const rim = 5000 - e.hp; assert(rim > 0 && g.buffMax(e, 'slow') === 0.25, 'W rim hit: ' + rim);
  assert(Math.abs(centre / rim - 1.5) < 0.01, 'centre deals 50% more');

  // E: the stun grows with the distance the shell flew
  const stunAt = dx => { reset(dx); g.command(1, { c: 'cast', s: 2, x: e.x, y: e.y }); run(g, 0.25); while (e.stunUntil <= g.time && g.shots.length) g.step(); return e.stunUntil - g.time; };
  const near = stunAt(200), far = stunAt(1000);
  assert(near > 0.5 && near < 0.9 && far > 1.6 && far <= 2, `E stun scales with distance: ${near.toFixed(2)}s near, ${far.toFixed(2)}s far`);

  // Q: IDLE -> CHARGING -> FIRING. Range grows with hold time, she is slowed while charging, too long cancels.
  reset(1100); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y });
  assert(!h.state && !beam(), 'Q does not fire without charging');
  g.command(1, { c: 'charge', s: 0 }); assert.equal(h.state.name, 'charging');
  assert.equal(g.speed(h), h.baseMs * 0.5, 'slowed while charging');
  run(g, 0.3); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y });
  const short = beam().len; assert.equal(h.state.name, 'firing'); run(g, 0.5);
  assert(short > 600 && short < 800 && e.hp === 5000 && !h.state, 'a short charge falls short: ' + (short | 0));
  reset(1100); g.command(1, { c: 'charge', s: 0 }); run(g, 1.6); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y });
  assert.equal(beam().len, 1150); run(g, 0.3); assert.equal(e.hp, 5000, 'beam waits for its delay'); run(g, 0.2);
  assert(e.hp < 5000 && h.cds[0] > g.time, 'a full charge reaches 1150');
  reset(1100); const mp = h.mp; g.command(1, { c: 'charge', s: 0 }); run(g, 3.1);
  assert(!h.state && h.cds[0] <= g.time && h.mp >= mp, 'held too long: cancelled, nothing spent');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(!beam(), 'releasing after a cancel fires nothing');
  g.command(1, { c: 'charge', s: 0 }); g.stun(h, 0.1); assert(!h.state, 'a stun cancels the charge'); run(g, 0.2);

  // R: rooted, a counted number of long-range shots, ends when they run out, on Stop, or on time
  reset(1700); g.command(1, { c: 'cast', s: 3 }); assert.equal(h.state.shots, 3);
  g.command(1, { c: 'move', x: 2000, y: 800 }); run(g, 0.5); assert.equal(h.x, 3000, 'rooted during the barrage');
  g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y });
  assert.equal(h.state.shots, 2, 'shots cannot be fired faster than the interval'); run(g, 0.7);
  assert(e.hp < 5000, 'barrage shot landed at 1700 range');
  g.command(1, { c: 'cast', s: 3, x: 9000, y: 800 }); assert(g.zones.at(-1).x - h.x <= 1800.01, 'shot clamped to barrage range'); run(g, 0.7);
  g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); assert(!h.state, 'barrage ends with the last shot'); run(g, 1);
  assert(h.x < 3000, 'free to move again');
  reset(1700); g.command(1, { c: 'cast', s: 3 }); g.command(1, { c: 'stop' }); assert(!h.state, 'Stop ends the barrage');
  reset(1700); g.command(1, { c: 'cast', s: 3 }); run(g, 10.1); assert(!h.state, 'barrage times out');

  // Passive: a ready attack restores mana, then waits; kills shorten the wait
  for (const u of [...g.units.values()]) if (u.type === 'minion') g.units.delete(u.id);
  g.shots = []; g.nextWave = Infinity; reset(300); h.mp = 100; h.surgeAt = 0; g.command(1, { c: 'atk', id: e.id }); run(g, 1);
  assert(h.mp > 100 + 2 * (40 + 5 * h.lvl) - 1, 'ready attack restored mana: ' + (h.mp | 0));
  const wait = HEROES.kessa.passive.wait(g, h); assert(wait > 10, 'passive went on its wait');
  g.command(1, { c: 'stop' }); const m = g.add({ type: 'minion', team: 'red', x: 3100, y: 900, radius: 32, hp: 1, mhp: 1, ad: 0, armor: 0, mr: 0, ms: 0, range: 0, as: 1, gold: 1, xp: 1 });
  g.damage(h, m, 5, 'true');
  assert(Math.abs(wait - HEROES.kessa.passive.wait(g, h) - 2) < 0.01, 'a kill shortens the wait by 2s');
  JSON.stringify(g.snapshot(1));
  console.log('kessa ok');
}
console.log('all checks passed');
