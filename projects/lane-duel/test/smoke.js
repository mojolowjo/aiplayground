// Headless rules check: runs the simulation directly, no network.
import assert from 'node:assert';
import { Game, TICK, MAP, WAVES, MINION, RULES } from '../game/sim.js';
import { HEROES } from '../game/data.js';

const run = (g, secs) => { for (let i = 0; i < secs * TICK; i++) g.step(); };
const mk = (a, b) => new Game([{ id: 1, team: 'blue', hero: a, name: 'A' }, { id: 2, team: 'red', hero: b, name: 'B' }]);

// 1. movement + minions meet + last hits give gold
{
  const g = mk('wren', 'oriel'), h = g.heroes.get(1);
  g.command(1, { c: 'lvl', s: 0 }); assert.equal(h.ranks[0], 1);
  g.command(1, { c: 'move', x: 2600, y: 800 }); run(g, 10);
  assert(Math.abs(h.x - 2600) < 5, 'hero walked to target: ' + h.x);
  h.x = MAP.w / 2 - 500; g.command(1, { c: 'amove', x: MAP.w / 2, y: 800 });      // jump to mid lane and farm the first wave
  while (h.cs < 1 && g.time < 120) g.step();
  assert([...g.units.values()].some(u => u.type === 'minion'), 'minions exist');
  assert(h.cs > 0 && h.gold > 500 && h.xp > 0 && !h.dead, `attack-move farmed: cs=${h.cs} gold=${h.gold | 0} xp=${h.xp | 0}`);
  g.giveXp(h, 300); assert(h.lvl > 1 && h.points === 1, 'levelled up');
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
// 8. Minions: spawn schedule, cannon waves, upgrades, target priority, call for help, first wave, rewards
{
  const fresh = () => { const g = mk('wren', 'gorrum'), h = g.heroes.get(1), e = g.heroes.get(2); return { g, h, e }; };
  const minions = (g, team) => [...g.units.values()].filter(u => u.type === 'minion' && (!team || u.team === team));
  const tgt = (g, m) => g.units.get(m.targetId);
  // schedule: nothing before 0:30, then one minion every 0.8s, melee first
  { const { g } = fresh(); run(g, 29.9); assert.equal(minions(g).length, 0, 'no minions before 0:30');
    run(g, 0.2); assert.equal(minions(g, 'blue').length, 1, 'they come out one at a time'); run(g, 5);
    assert.deepEqual(minions(g, 'blue').map(m => m.kind), ['melee', 'melee', 'melee', 'caster', 'caster', 'caster']);
    run(g, 62); const w3 = minions(g, 'blue').filter(m => m.wave === 3);
    assert.deepEqual(w3.map(m => m.kind), ['melee', 'melee', 'melee', 'cannon', 'caster', 'caster', 'caster'], 'wave 3 is a cannon wave');
    assert.equal(w3[0].mhp, Math.round(MINION.melee.hp * (1 + WAVES.hpPerUpgrade)), 'minions spawned after 1:30 are upgraded');
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(n => WAVES.cannon(n, 100)), [false, false, true, false, false, true]);
    assert(WAVES.cannon(31, 900) === false && WAVES.cannon(32, 900) === true && WAVES.cannon(51, 1600) === true, 'cannon every 2nd wave after 14:00, every wave after 25:00');
    assert.deepEqual([WAVES.every(0), WAVES.every(900), WAVES.every(1900)], [30, 25, 20]);
    g.time = 900; g.waveNo = 31; g.spawnQ = []; g.queueWave(); assert.equal(g.spawnQ.filter(q => q.team === 'blue' && q.kind === 'melee').length, 2, 'late cannon waves have 2 melee'); }
  // first wave: ignores a champion standing beside the lane, pairs off melee, both sides' melee die together
  { const { g, e } = fresh(); e.x = 3000; e.y = 1000; e.hp = e.mhp = 9000; e.bot = false; e.order = { type: 'hold' }; run(g, 37.5);
    assert(minions(g, 'blue').every(m => !tgt(g, m) || tgt(g, m).type !== 'hero'), 'first wave walks past an idle champion'); e.x = MAP.spawn.red.x; e.y = 800;
    let met = 0; while (!g.wavesMet && g.time < 90) g.step(); met = g.time - RULES.firstWave;
    assert(met >= 22 && met <= 28, `first clash ${met.toFixed(1)}s after the wave spawns (want 22-28)`);
    const died = {}; for (let i = 0; i < 25 * TICK; i++) { g.step();
      if (Math.abs(g.time - 61) < 0.02) for (const m of minions(g).filter(m => m.melee && m.wave === 1)) assert(tgt(g, m) && tgt(g, m).melee && tgt(g, m).slot === m.slot, 'each melee fights the enemy melee in its own slot');
      for (const t of ['blue', 'red']) if (!died[t] && !minions(g, t).some(m => m.melee && m.wave === 1)) died[t] = g.time; }
    assert(died.blue && died.red && Math.abs(died.blue - died.red) < 2, `both melee lines fall together: ${died.blue.toFixed(1)}s vs ${died.red.toFixed(1)}s`); }
  // priority and call for help, on a hand-built scene
  { const { g, h, e } = fresh(); g.nextWave = Infinity; g.wavesMet = true;
    const add = (team, kind, x, y) => g.spawnMinion({ team, kind, wave: 2, slot: 1 }) && Object.assign([...g.units.values()].at(-1), { x, y, laneY: y, hp: 5000, mhp: 5000 });
    h.x = 3000; h.y = 800; e.x = 3900; e.y = 800; e.hp = e.mhp = h.hp = h.mhp = 9000; h.order = e.order = { type: 'hold' }; e.cds[3] = 1e9;
    const red = [add('red', 'caster', 3500, 700), add('red', 'caster', 3500, 900)], blue = add('blue', 'melee', 3300, 800); run(g, 1);
    assert(red.every(m => tgt(g, m) === blue), 'minions pick the closest enemy minion over a champion');
    const nearer = add('blue', 'melee', 3420, 800); run(g, 1.2); assert(red.every(m => tgt(g, m) === blue), 'and do not switch to an equal-priority target');
    g.units.delete(nearer.id);
    g.command(1, { c: 'atk', id: red[0].id }); run(g, 2); assert(red.every(m => tgt(g, m) === blue), 'attacking a minion does not draw the others onto you');
    g.command(1, { c: 'stop' }); g.command(1, { c: 'lvl', s: 0 }); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 1.2);
    assert(e.hp < 9000 && red.every(m => tgt(g, m) === blue), 'a skillshot on the enemy champion does not call for help');
    g.command(1, { c: 'atk', id: e.id }); h.x = 3400; run(g, 0.3);
    assert(red.every(m => tgt(g, m) === h), 'a basic attack on the enemy champion does'); const hp = h.hp; run(g, 1.5);
    const per = (hp - h.hp); assert(per > 0, 'and they hit back');
    g.command(1, { c: 'stop' }); run(g, 4); assert(red.every(m => tgt(g, m) === blue), 'they go back to the minion once the champion stops'); }
  // damage rules and rewards
  { const { g, h, e } = fresh(); g.nextWave = Infinity; g.wavesMet = true; h.order = e.order = { type: 'hold' }; e.x = 6000;
    const m = g.spawnMinion({ team: 'red', kind: 'caster', wave: 2, slot: 1 }), b = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 });
    h.armor = 0; let hp = h.hp; g.attackHit(m, h); assert(Math.abs(hp - h.hp - m.ad * WAVES.vsHero) < 0.01, 'minions deal 60% to champions');
    hp = b.hp; g.attackHit(m, b); assert(Math.abs(hp - b.hp - (m.ad + 0.035 * hp)) < 0.01, 'casters add 3.5% of a minion\'s current health');
    for (const [kind, share] of [['melee', 0.02], ['cannon', 0.05]]) { const a = g.spawnMinion({ team: 'red', kind, wave: 2, slot: 1 }); hp = b.hp; g.attackHit(a, b);
      assert(Math.abs(hp - b.hp - (a.ad + share * hp)) < 0.01, `${kind} adds ${share * 100}%`); g.units.delete(a.id); }
    b.hp = b.mhp;
    const tw = [...g.units.values()].find(u => u.type === 'tower' && u.team === 'blue'); m.x = tw.x + 200; m.y = tw.y; hp = tw.hp; g.attackHit(m, tw);
    assert(Math.abs(hp - tw.hp - m.ad * 0.6 * 100 / (100 + tw.armor)) < 0.01, 'minions deal 60% to towers'); tw.hp = tw.mhp;
    h.x = 3000; m.x = 3400; m.y = h.y = 800; b.x = 500; const gold = h.gold, xp = h.xp;
    g.damage(b, m, 9999, 'true'); assert(h.gold - gold < 1 && h.xp > xp && h.missed === 1 && h.cs === 0, 'no last hit: XP but no gold, and it counts as missed');
    const m2 = g.spawnMinion({ team: 'red', kind: 'cannon', wave: 3, slot: 1 }); m2.x = 3400; m2.y = 800; const gold2 = h.gold;
    g.damage(h, m2, 9999, 'true'); assert(h.gold - gold2 >= MINION.cannon.gold && h.cs === 1 && h.missed === 1, 'last hit: gold, and cannons are worth more');
    const m3 = g.spawnMinion({ team: 'red', kind: 'melee', wave: 3, slot: 1 }); m3.x = 5000; const xp3 = h.xp; g.damage(b, m3, 9999, 'true');
    assert(h.xp === xp3 && h.missed === 1, 'no XP and no miss beyond 1500'); JSON.stringify(g.snapshot(1)); }
  console.log('minions ok');
}
// 9. Tower shots on minions are a share of max health, whatever upgrades have added
{
  const g = mk('wren', 'gorrum'), h = g.heroes.get(1); g.nextWave = Infinity;
  const tw = [...g.units.values()].find(u => u.type === 'tower' && u.team === 'blue');
  for (const time of [0, 900]) {                      // fresh minions, and minions with ten upgrades
    g.time = time;
    const mk1 = kind => { const m = g.spawnMinion({ team: 'red', kind, wave: 2, slot: 1 }); m.x = tw.x + 300; return m; };
    const melee = mk1('melee'), caster = mk1('caster'), cannon = mk1('cannon');
    if (time) assert(melee.mhp > MINION.melee.hp * 1.4, 'late minions really are tougher');
    g.attackHit(tw, melee); assert(Math.abs(melee.hp / melee.mhp - 0.55) < 1e-9, 'melee: one tower shot = 45% of max health');
    g.attackHit(tw, melee); assert(Math.abs(melee.hp / melee.mhp - 0.10) < 1e-9, 'melee: two shots leave 10%, a last hit');
    if (!time) assert(melee.hp < h.ad, 'which one basic attack finishes at level 1');
    g.attackHit(tw, caster); assert(Math.abs(caster.hp / caster.mhp - 0.30) < 1e-9, 'caster: one tower shot = 70% of max health');
    g.attackHit(tw, cannon); assert(Math.abs(cannon.mhp - cannon.hp - RULES.tower.ad) < 1e-9, 'cannon: the tower\'s normal damage');
    for (const m of [melee, caster, cannon]) g.units.delete(m.id);
  }
  const hp = h.hp, armor = h.armor; g.time = 0; tw.heat = 0; g.attackHit(tw, h);
  assert(Math.abs(hp - h.hp - RULES.tower.ad * 100 / (100 + armor)) < 0.01, 'tower damage to heroes is unchanged');
  assert.equal(MINION.cannon.range, 300);
  console.log('tower ok');
}
// 10. Heroes and minions collide; dashes pass through
{
  const g = mk('wren', 'gorrum'), h = g.heroes.get(1); g.nextWave = Infinity; g.wavesMet = true;
  const wall = y => { const m = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 }); Object.assign(m, { x: 3300, y, laneY: y, ms: 0 }); return m; };
  const ms = [wall(740), wall(800), wall(860)], gap = RULES.collision.hero + RULES.collision.minion;
  const walk = () => { h.x = 3000; h.y = 800; h.face = 0; g.command(1, { c: 'move', x: 3600, y: 800 }); let t = 0, off = 0, near = 1e9;
    while (h.order && t < 10) { g.step(); t += 1 / TICK; off = Math.max(off, Math.abs(h.y - 800)); for (const m of ms) near = Math.min(near, g.dist(h, m)); } return { t, off, near }; };
  for (const m of ms) m.x = 9000;                       // no wall: a straight walk
  const free = walk(); assert(free.off < 1 && Math.abs(free.t - 600 / 325) < 0.1, 'open ground: straight line');
  for (const m of ms) m.x = 3300;
  const blocked = walk();
  assert(Math.abs(h.x - 3600) < 1 && blocked.t > free.t + 0.2 && blocked.off > 60, `a wave in the way has to be walked around: ${blocked.t.toFixed(2)}s vs ${free.t.toFixed(2)}s, ${blocked.off | 0} off the line`);
  assert(blocked.near > gap - 12, 'and the hero never walks through a minion: closest ' + (blocked.near | 0));
  for (const m of ms) { m.x = 3300; } ms[0].y = 740; ms[1].y = 800; ms[2].y = 860;
  h.x = 3000; h.y = 800; g.dash(h, { x: 3600, y: 800, speed: 1500 }); let near = 1e9; for (let i = 0; i < TICK; i++) { g.step(); near = Math.min(near, g.dist(h, ms[1])); }
  assert(Math.abs(h.x - 3600) < 1 && Math.abs(h.y - 800) < 1 && near < 30, 'a dash goes straight through');
  g.blink(h, 3300, 800); run(g, 0.5); assert(ms.every(m => g.dist(h, m) > gap - 12), 'a blink into a wave is pushed clear');
  // minions still block skillshots
  const e = g.heroes.get(2); h.x = 3000; h.y = 800; e.x = 3700; e.y = 800; e.hp = e.mhp = 5000; const red = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 }); Object.assign(red, { x: 3400, y: 800, ms: 0 });
  h.ranks[0] = 1; h.cds[0] = 0; g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.8); assert(red.hp < red.mhp && e.hp === 5000, 'an enemy minion still blocks a skillshot');
  console.log('collision ok');
}
// 11. Practice opponent: last-hits, backs off and recalls, respects vision; the dummy is still there
{
  // The bot rolls dice, so give this section a fixed sequence of them: the checks are then the same every run.
  const realRandom = Math.random; let seed = 12345; Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bot = (ai, hero = 'wren') => { const g = new Game([{ id: 1, team: 'blue', hero: 'kessa', name: 'A' }, { id: -1, team: 'red', hero, name: 'Bot', bot: true, ai }]);
    const me = g.heroes.get(1), b = g.heroes.get(-1); me.order = { type: 'hold' }; return { g, me, b }; };
  const farm = ai => { let cs = 0, seen = 0; for (const hero of ['wren', 'gorrum', 'sable']) { const { g, b } = bot(ai, hero); run(g, 200); cs += b.cs; seen += b.cs + b.missed; } return cs / seen; };
  const easy = farm('easy'), hard = farm('hard');
  assert(hard > 0.5 && easy > 0.1 && hard > easy + 0.1, `the bot last-hits, better on hard: ${(hard * 100) | 0}% vs ${(easy * 100) | 0}% on easy`);
  { const { g, me, b } = bot('normal'); run(g, 70); const x = b.x; assert(Math.abs(b.x - MAP.w / 2) < 1500 && b.items.length > 0, 'it walks to lane and shops first');
    b.hp = b.mhp * 0.2; me.x = b.x - 600; me.y = 800; run(g, 1.5);
    assert(b.x > x + 300 && !b.recall, 'low health with the player close: it backs off toward its tower');
    me.x = 500; run(g, 6); assert(b.recall || g.dist(b, MAP.spawn.red) < MAP.fountainR, 'once safe it recalls'); while (b.recall) g.step();
    assert(g.dist(b, MAP.spawn.red) < MAP.fountainR && b.hp < b.mhp * 0.5, 'which takes it to base'); run(g, 18); assert(!b.aiMem.heal && b.hp > b.mhp * 0.8 && b.x < MAP.spawn.red.x - 1000, 'then heads back to lane healed'); }
  { const { g, me, b } = bot('hard', 'oriel'); g.nextWave = Infinity; g.spawnQ = []; b.x = 9400; b.y = 800; b.lvl = 3; b.points = 2; g.refresh(b);
    const br = MAP.brush[0]; me.x = br.x + br.w / 2; me.y = br.y + 100; me.hp = me.mhp = 9000; run(g, 25);
    assert(!(b.cds[0] > 0) && me.hp >= 9000 - 1, 'it never fires at a player it cannot see (hidden in brush)');
    me.x = b.x - 700; me.y = 800; let fired = 0; for (let i = 0; i < 25 * TICK && !fired; i++) { g.step(); if (b.cds[0] > g.time) fired = g.time; }
    assert(fired, 'it does throw its Q at a visible player'); const mp = b.mp;
    b.mp = 0; b.cds[0] = 0; run(g, 20); assert(!(b.cds[0] > g.time) || b.mp > 0, 'and not without the mana for it'); }
  { const g = new Game([{ id: 1, team: 'blue', hero: 'kessa', name: 'A' }, { id: -1, team: 'red', hero: 'wren', name: 'Dummy', bot: true }]); run(g, 60);
    const d = g.heroes.get(-1); assert(Math.abs(d.x - MAP.tower.red.x) < 500 && d.cs === 0, 'the stationary dummy still just stands by its tower'); }
  assert.deepEqual(['easy', 'normal', 'hard'].map(k => RULES.bot[k].aimErr > 0 && RULES.bot[k].react > 0), [true, true, true]);
  assert(RULES.bot.easy.aimErr > RULES.bot.normal.aimErr && RULES.bot.normal.aimErr > RULES.bot.hard.aimErr && RULES.bot.easy.trade < RULES.bot.hard.trade);
  Math.random = realRandom;
  console.log('bot ok');
}
console.log('all checks passed');
