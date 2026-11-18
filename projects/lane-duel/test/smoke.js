// Headless rules check: runs the simulation directly, no network.
import assert from 'node:assert';
import { Game, TICK, MAP } from '../game/sim.js';
import { HEROES } from '../game/data.js';

const run = (g, secs) => { for (let i = 0; i < secs * TICK; i++) g.step(); };
const mk = (a, b) => new Game([{ id: 1, team: 'blue', hero: a, name: 'A' }, { id: 2, team: 'red', hero: b, name: 'B' }]);

// 1. movement + minions meet + last hits give gold
{
  const g = mk('wren', 'oriel'), h = g.heroes.get(1);
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
  const g = mk(key, 'gorrum'), h = g.heroes.get(1), e = g.heroes.get(2);
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
  const g = mk('sable', 'oriel'), h = g.heroes.get(1), e = g.heroes.get(2);
  h.x = 3000; e.x = 3100; h.y = e.y = 800;
  for (let k = 0; k < 2; k++) { e.hp = 1; g.command(1, { c: 'atk', id: e.id }); run(g, 3); e.dead = false; e.x = h.x + 100; e.y = h.y; }
  assert.equal(h.kills, 2); assert(g.over && g.over.winner === 'blue', 'game over on kills');
  const g2 = mk('wren', 'oriel'), a = g2.heroes.get(1), b = g2.heroes.get(2);
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
  const g = mk('kessa', 'gorrum'), h = g.heroes.get(1), e = g.heroes.get(2);
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
// Shared setup for the kit checks: level 6, everything learned, no minions, a 5000 hp target.
const duel = (a, b = 'oriel') => {
  const g = mk(a, b), h = g.heroes.get(1), e = g.heroes.get(2);
  g.nextWave = Infinity; h.lvl = 6; h.points = 4; g.refresh(h); for (let s = 0; s < 4; s++) g.command(1, { c: 'lvl', s });
  const reset = dx => { h.x = 3000; e.x = 3000 + dx; h.y = e.y = 800; e.hp = e.mhp = 5000; e.stunUntil = e.silenceUntil = 0; e.buffs = []; e.mark = null; e.push = null;
    h.hp = h.mhp; h.mp = h.mmp; h.cds = [0, 0, 0, 0]; h.order = null; h.emp = null; g.pickups = []; g.shots = []; };
  const minion = (x, y, hp = 300) => g.add({ type: 'minion', team: 'red', melee: true, x, y, laneY: y, radius: 32, hp, mhp: hp, ad: 0, armor: 0, mr: 0, ms: 0, range: 0, as: 0.1, gold: 1, xp: 1, targetId: 0, aggroUntil: 0 });
  return { g, h, e, reset, minion };
};
// 5. Gorrum: forced movement, chained buffs, empowered attack, passive/active ability, threshold shield
{
  const { g, h, e, reset } = duel('gorrum');
  h.cds[3] = 1e9;                                   // keep the R zaps out of the other checks
  reset(800); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.8); g.command(2, { c: 'move', x: 6000, y: 800 });
  assert(e.stunUntil > g.time && e.x < 3800 && e.x > 3300, 'hooked target is being dragged: ' + (e.x | 0)); run(g, 0.35);
  assert(Math.abs(e.x - h.x) < h.radius + e.radius + 40 && e.hp < 5000, 'Harpoon Line pulled the enemy to Gorrum: ' + (e.x | 0));
  reset(2000); const base = g.speed(h); g.command(1, { c: 'cast', s: 1 });
  assert(g.speed(h) > base * 1.49, 'Boiler Vent speeds him up'); run(g, 4.1);
  assert.equal(g.speed(h), base * 0.7, 'then slows him when it ends'); run(g, 1.6); assert.equal(g.speed(h), base, 'and the slow wears off');
  reset(150); g.command(1, { c: 'cast', s: 2 }); g.command(1, { c: 'atk', id: e.id }); run(g, 0.5);
  assert(e.airUntil > g.time && e.stunUntil > g.time && !h.emp, 'Anchor Fist knocked the enemy up and was used up');
  const hp1 = e.hp; run(g, 2); const plain = hp1 - e.hp; g.command(1, { c: 'stop' });
  assert(5000 - hp1 > plain / 2 + 100, 'the empowered attack hit harder than the plain ones after it');
  reset(300); h.cds[3] = 0; h.zapAt = 0; run(g, 0.2); assert(e.hp < 5000 && h.zapAt > g.time, 'R zaps a nearby enemy while ready');
  const hp2 = e.hp; g.command(1, { c: 'cast', s: 3 }); run(g, 0.4);
  assert(e.hp < hp2 - 100 && e.silenceUntil > g.time, 'Pressure Pulse damages and silences');
  e.ranks = [1, 1, 1, 1]; e.mp = 999; g.command(2, { c: 'cast', s: 0, x: h.x, y: h.y }); assert(!(e.cds[0] > g.time), 'a silenced hero cannot cast');
  const hp3 = e.hp; run(g, 6); assert(e.hp >= hp3, 'no zaps while R is on cooldown');
  h.hp = h.mhp * 0.25; g.damage(e, h, 200, 'true'); assert(h.shieldAmt > 0 && h.shieldUntil > g.time, 'Ballast Plating shields below 20%');
  h.shieldAmt = 0; g.damage(e, h, 5, 'true'); assert.equal(h.shieldAmt, 0, 'but only once per cooldown');
  console.log('gorrum ok');
}
// 6. Wren: cooldown refunds, mark and detonate, stacking buff, blink + auto-target, piercing wave
{
  const { g, h, e, reset, minion } = duel('wren');
  const as0 = g.atkSpeed(h);
  reset(800); h.cds = [0, g.time + 10, g.time + 10, g.time + 10]; g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.6);
  assert(e.hp < 5000 && Math.abs(h.cds[1] - g.time - 7.9) < 0.11, 'Compass Bolt hit and refunded 1.5s: ' + (h.cds[1] - g.time).toFixed(2));
  assert.equal(HEROES.wren.passive.count(g, h), 1); assert(Math.abs(g.atkSpeed(h) / as0 - 1.1) < 0.001, 'one stack = 10% attack speed');
  reset(800); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y + 400 }); run(g, 0.8); assert(Math.abs(h.cds[1] - g.time) < 0.01 || h.cds[1] <= g.time, 'a miss refunds nothing');
  reset(800); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); run(g, 0.8);
  assert(e.mark && e.hp === 5000, 'Waymark tags without damage'); const mp = h.mp;
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.6);
  const lost = 5000 - e.hp;
  assert(!e.mark && lost > 150 && h.mp > mp, `the next hit popped the mark: ${lost | 0} damage, mana ${mp | 0} -> ${h.mp | 0}`);
  for (let i = 0; i < 6; i++) { h.cds[0] = 0; h.mp = h.mmp; g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.6); }
  assert.equal(HEROES.wren.passive.count(g, h), 5, 'stacks cap at 5'); assert(Math.abs(g.atkSpeed(h) / as0 - 1.5) < 0.001);
  run(g, 6.1); assert.equal(HEROES.wren.passive.count(g, h), 0); assert.equal(g.atkSpeed(h), as0, 'stacks fall off together');
  reset(900); const m = minion(3500, 1000); g.command(1, { c: 'cast', s: 2, x: 3400, y: 800 }); run(g, 0.5);
  assert(Math.abs(h.x - 3400) < 1 && m.hp < 300 && e.hp === 5000, 'Fold Step blinked and shot the nearest enemy, not the farther one');
  reset(2500); h.x = 700; e.x = 5400; const m2 = minion(3000, 800, 5000); g.command(1, { c: 'cast', s: 3, x: 6000, y: 800 }); run(g, 0.9);
  assert.equal(m2.hp, 5000, 'Meridian has a cast time'); run(g, 4);
  const onHero = 5000 - e.hp, onMinion = (5000 - m2.hp) * (100 / (100 + e.mr));
  assert(onHero > 0 && Math.abs(onMinion / onHero - 0.5) < 0.02, `Meridian crossed the map, pierced, and halved on minions: ${onHero | 0} vs ${(5000 - m2.hp) | 0}`);
  console.log('wren ok');
}
// 7. Sable: blades in the world, chain targeting, delayed spawn, target validation, interruptible channel
{
  const { g, h, e, reset, minion } = duel('sable');
  reset(500); const a = minion(3700, 950, 5000), b = minion(3900, 700, 5000), far = minion(5200, 800, 5000);
  g.command(1, { c: 'cast', s: 0, x: 4800, y: 1300 }); assert(!(h.cds[0] > g.time), 'Q needs a target near the cursor');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(h.cds[0] > g.time); run(g, 1.5);
  assert(e.hp < 5000 && a.hp < 5000 && b.hp < 5000 && far.hp === 5000, 'the blade bounced through the 3 nearest enemies only');
  const blade = g.pickups[0]; assert(blade && Math.abs(blade.x - 3800) < 1 && g.time >= blade.at, 'and landed 300 behind the first target');
  const hpE = e.hp; g.command(1, { c: 'cast', s: 2, x: blade.x, y: blade.y });
  assert(!g.pickups.length && Math.abs(h.x - 3800) < 1 && e.hp < hpE, 'Moonstep to a blade picks it up and slashes at once');
  for (const u of [a, b, far]) g.units.delete(u.id);
  reset(600); g.command(1, { c: 'cast', s: 2, x: 3300, y: 1200 }); assert(!(h.cds[2] > g.time) && h.x === 3000, 'Moonstep refuses empty ground');
  g.command(1, { c: 'cast', s: 2, x: e.x, y: e.y }); assert(g.dist(h, e) < 100 && e.hp < 5000, 'Moonstep to an enemy lands next to it and hits it');
  reset(2000); g.command(1, { c: 'cast', s: 1 }); g.command(1, { c: 'move', x: 3600, y: 800 }); run(g, 1);
  assert.equal(g.pickups.length, 1); assert(g.time < g.pickups[0].at, 'the tossed blade is still in the air'); run(g, 0.4);
  assert(g.time >= g.pickups[0].at && h.x > 3350, 'it lands where she stood, and she got a speed burst');
  g.command(1, { c: 'move', x: 3000, y: 800 }); run(g, 2); assert(!g.pickups.length, 'walking back over it picks it up');
  g.command(1, { c: 'cast', s: 1 }); run(g, 1.3); h.x = 5000; run(g, 5.1); assert(!g.pickups.length, 'blades left alone expire');
  reset(300); g.command(1, { c: 'cast', s: 3 }); g.command(1, { c: 'move', x: 2000, y: 800 }); run(g, 1);
  assert(h.x === 3000 && h.state && e.hp < 5000, 'Glass Storm: rooted and throwing'); g.stun(h, 0.2);
  assert(!h.state, 'a stun cancels the channel'); run(g, 0.6); const hpS = e.hp; run(g, 1); assert(e.hp >= hpS, 'and the blades stop');
  reset(300); h.cds = [5, 5, 5, 50].map(c => g.time + c); e.hp = 1; g.damage(h, e, 5, 'true');
  assert(h.cds[0] <= g.time && Math.abs(h.cds[3] - g.time - 35) < 0.01, 'Encore: a hero kill takes 15s off every cooldown');
  JSON.stringify(g.snapshot(1));
  console.log('sable ok');
}
console.log('all checks passed');
