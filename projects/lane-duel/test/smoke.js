// Headless rules check: runs the simulation directly, no network.
import assert from 'node:assert';
import { Game, TICK, MAP, WAVES, MINION, RULES, ITEM } from '../game/sim.js';
import { plan, missing, describe, buildsInto, BAG_SLOTS } from '../shared/shop.js';
import { HEROES, ITEMS } from '../game/data.js';
import fs from 'node:fs';

const bag = h => h.items.map(s => s.id);            // the ids in a hero's bag, in slot order
const run = (g, secs) => { for (let i = 0; i < secs * TICK; i++) g.step(); };
// Most checks stage their scene on open ground on blue's side of the lane, which is where the blue inner
// tower stands. Those games are built without the inner towers; pass `true` to keep them.
const mk = (a, b, innerTowers = false) => {
  const g = new Game([{ id: 1, team: 'blue', hero: a, name: 'A' }, { id: 2, team: 'red', hero: b, name: 'B' }]);
  if (!innerTowers) for (const u of [...g.units.values()]) if (u.type === 'tower' && u.inner) g.units.delete(u.id);
  return g;
};

// 1. movement + minions meet + last hits give gold
{
  const g = mk('wren', 'oriel'), h = g.heroes.get(1);
  g.command(1, { c: 'lvl', s: 0 }); assert.equal(h.ranks[0], 1);
  g.command(1, { c: 'move', x: 2600, y: 800 }); run(g, 10);
  assert(Math.abs(h.x - 2600) < 5, 'hero walked to target: ' + h.x);
  h.x = MAP.w / 2 - 500; while (!g.wavesMet && g.time < 90) g.step();              // jump to mid lane and wait for the first wave
  g.command(1, { c: 'amove', x: MAP.w / 2 + 600, y: 800 });                        // then attack-move into it
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
  for (let k = 0; k < RULES.kills; k++) { e.hp = 1; g.command(1, { c: 'atk', id: e.id }); run(g, 3); e.dead = false; e.x = h.x + 100; e.y = h.y; }
  assert.equal(h.kills, 8); assert(g.over && g.over.winner === 'blue', 'game over at 8 kills');
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
// Shared setup for the kit checks: level 6, one rank in everything, no minions, a 5000 hp level-1 Oriel as the target.
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const duel = (a, b = 'oriel') => {
  const g = mk(a, b), h = g.heroes.get(1), e = g.heroes.get(2);
  g.nextWave = Infinity; h.lvl = 6; h.points = 4; g.refresh(h); for (let s = 0; s < 4; s++) g.command(1, { c: 'lvl', s });
  e.hpRegen = 0;                                    // so damage can be measured exactly
  const reset = dx => { h.x = 3000; e.x = 3000 + dx; h.y = e.y = 800; e.hp = e.mhp = 5000; e.stunUntil = e.silenceUntil = 0; e.buffs = []; e.mark = null; e.push = null; e.order = { type: 'hold' };
    h.hp = h.mhp; h.mp = h.mmp; h.cds = [0, 0, 0, 0]; h.order = null; h.emp = null; h.state = null; h.casting = null; h.windup = null; h.nextAttack = 0; h.stunUntil = 0; h.buffs = []; g.pickups = []; g.shots = []; g.zones = []; };
  const minion = (x, y, hp = 300) => g.add({ type: 'minion', team: 'red', melee: true, x, y, laneY: y, radius: 22, hp, mhp: hp, ad: 0, armor: 0, mr: 0, ms: 0, range: 0, as: 0.1, gold: 1, xp: 1, targetId: 0, lookAt: Infinity });
  const mr = 100 / (100 + e.mr), ar = 100 / (100 + e.armor);     // what Oriel's resistances let through
  return { g, h, e, reset, minion, mr, ar };
};
// 4. Kessa: every ability is telegraph -> delay -> resolve, driven by the ability state machine
{
  const { g, h, e, reset, mr } = duel('kessa'), K = HEROES.kessa.abilities, beam = () => g.zones.find(z => z.shape === 'line');
  assert.deepEqual([h.range, h.baseMs, h.mhp, h.mmp], [525, 340, 575 + 5 * 106, 400 + 5 * 22]); assert(near(h.hpRegen, 1.1 + 5 * 0.11) && near(h.manaRegen, 1.37 + 5 * 0.16), 'regen grows per level');

  // W: nothing during cast time + delay; the centre hits x1.667 with a slow that fades from 60% to 25%
  reset(800); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); assert.equal(h.mp, h.mmp - 80); run(g, 0.7);
  assert.equal(e.hp, 5000, 'W does nothing during its cast time and delay'); run(g, 0.15);
  const centre = 5000 - e.hp; assert(near(centre, 50 * 5 / 3 * mr) && near(g.buffMax(e, 'slow'), 0.6, 0.06), 'W centre: ' + centre.toFixed(1)); run(g, 1.2);
  assert(near(g.buffMax(e, 'slow'), 0.42, 0.06), 'the centre slow has faded about half way: ' + g.buffMax(e, 'slow').toFixed(2)); run(g, 1.1);
  assert(near(g.buffMax(e, 'slow'), 0.26, 0.06), 'and to 25% by the end'); run(g, 0.3); assert.equal(g.buffMax(e, 'slow'), 0);
  reset(800); g.command(1, { c: 'cast', s: 1, x: e.x + 200, y: e.y }); run(g, 0.85);
  assert(near(5000 - e.hp, 50 * mr) && g.buffMax(e, 'slow') === 0.25, 'W rim: normal damage and a flat 25% slow');

  // E: the stun grows with the distance the shell flew, 0.75s to 2.25s
  const stunAt = dx => { reset(dx); g.command(1, { c: 'cast', s: 2, x: e.x, y: e.y }); run(g, 0.25); while (e.stunUntil <= g.time && g.shots.length) g.step(); return e.stunUntil - g.time; };
  const close = stunAt(200), far = stunAt(1100);
  assert(close >= 0.75 && close < 1 && far > 1.9 && far <= 2.25, `E stun scales with distance: ${close.toFixed(2)}s near, ${far.toFixed(2)}s far`);
  assert(near(5000 - e.hp, 70 * mr), 'E damage');

  // Q: IDLE -> CHARGING -> FIRING. Paid up front; range and self-slow grow while holding; too long cancels with half back.
  reset(1300); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(!h.state && !beam(), 'Q does not fire without charging');
  g.command(1, { c: 'charge', s: 0 }); assert(h.state.name === 'charging' && h.mp === h.mmp - 80, 'the cost is paid when charging starts');
  assert(near(g.speed(h), h.baseMs * 0.9), 'slowed 10% at the start'); run(g, 0.3); assert(near(g.speed(h), h.baseMs * 0.85), '15% after 0.25s');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); const short = beam().len; assert.equal(h.state.name, 'firing'); run(g, 0.7);
  assert(short > 850 && short < 950 && e.hp === 5000 && !h.state && h.mp < h.mmp - 75, 'a short charge falls short, and costs no more on release: ' + (short | 0));
  reset(1300); g.command(1, { c: 'charge', s: 0 }); run(g, 1.6); assert(near(g.speed(h), h.baseMs * 0.6), 'the slow caps at 40%');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(beam().len === 1450 && beam().w === 145); run(g, 0.45); assert.equal(e.hp, 5000, 'the beam waits 0.528s'); run(g, 0.15);
  assert(near(5000 - e.hp, 70 * mr) && h.cds[0] > g.time, 'a full charge reaches 1450');
  reset(1300); g.command(1, { c: 'charge', s: 0 }); run(g, 3.1);
  assert(!h.state && h.cds[0] <= g.time && h.mp >= h.mmp - 40 - 0.01 && h.mp < h.mmp - 30, 'held too long: cancelled, half the cost back');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(!beam(), 'releasing after a cancel fires nothing');
  reset(1300); g.command(1, { c: 'charge', s: 0 }); g.stun(h, 0.1); assert(!h.state && near(h.mp, h.mmp - 40), 'a stun cancels the charge and refunds half'); run(g, 0.2);

  // R: rooted, counted long-range shots; hero hits make LATER shots stronger; unused = half the cooldown back
  reset(1700); g.command(1, { c: 'cast', s: 3 }); assert.equal(h.state.shots, 4);
  g.command(1, { c: 'move', x: 2000, y: 800 }); run(g, 0.5); assert.equal(h.x, 3000, 'rooted during the barrage');
  g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y });
  assert.equal(h.state.shots, 3, 'shots cannot be fired faster than the interval'); run(g, 0.6); assert.equal(e.hp, 5000, 'each shot lands 0.627s after it is fired'); run(g, 0.1);
  const first = 5000 - e.hp; assert(near(first, 170 * mr), 'first shot: ' + first.toFixed(1));
  g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); run(g, 0.7); assert(near(5000 - e.hp - first, (170 + 20) * mr), 'the next shot is 20 stronger for the hero already hit');
  g.command(1, { c: 'cast', s: 3, x: 99999, y: 800 }); assert(near(g.zones.at(-1).x - h.x, 5000), 'range 5000'); run(g, 0.7);
  g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); assert(!h.state, 'barrage ends with the last shot'); run(g, 1); assert(h.x < 3000, 'free to move again');
  reset(1700); g.command(1, { c: 'cast', s: 3 }); run(g, 1); g.command(1, { c: 'stop' });
  assert(!h.state && near(h.cds[3] - g.time, 130 / 2 - 1, 0.02), 'ended without firing: half the cooldown back');
  reset(1700); g.command(1, { c: 'cast', s: 3 }); run(g, 0.5); g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); g.command(1, { c: 'stop' }); assert(near(h.cds[3] - g.time, 130 - 0.5, 0.02), 'but not once a shot has gone');
  reset(1700); g.command(1, { c: 'cast', s: 3 }); run(g, 10.1); assert(!h.state, 'barrage times out');
  const br = MAP.brush[0]; reset(0); h.x = br.x + 300; h.y = br.y + 90; e.x = h.x + 2500; e.y = 800;
  g.command(1, { c: 'cast', s: 3 }); run(g, 2); assert(!g.visible(h, 'red'), 'hidden in brush once the cast reveal has worn off');
  g.command(1, { c: 'cast', s: 3, x: e.x - 2000, y: 800 }); run(g, 0.8); assert(!g.visible(h, 'red'), 'a shot landing far from any hero does not reveal her');
  g.command(1, { c: 'cast', s: 3, x: e.x + 300, y: 800 }); run(g, 0.8); assert(g.visible(h, 'red'), 'a shot landing near an enemy hero does'); g.command(1, { c: 'stop' });

  // Passive: a ready attack restores mana (doubled on heroes), then waits 16s; kills shorten the wait by 3.5s
  reset(300); h.mp = 100; h.surgeAt = 0; g.command(1, { c: 'atk', id: e.id }); run(g, 1);
  assert(near(h.mp, 100 + 157 + h.manaRegen, 0.01), 'ready attack restored mana: ' + h.mp.toFixed(1));
  const wait = HEROES.kessa.passive.wait(g, h); assert(wait > 15, 'passive went on its wait');
  g.command(1, { c: 'stop' }); const m = g.add({ type: 'minion', team: 'red', x: 3100, y: 900, radius: 22, hp: 1, mhp: 1, ad: 0, armor: 0, mr: 0, ms: 0, range: 0, as: 1, gold: 1, xp: 1 });
  g.damage(h, m, 5, 'true'); assert(near(wait - HEROES.kessa.passive.wait(g, h), 3.5), 'a kill shortens the wait by 3.5s');
  assert(K.every(a => typeof a.desc === 'string' && a.desc.length > 40)); JSON.stringify(g.snapshot(1));
  console.log('kessa ok');
}
// 5. Gorrum: forced movement, chained decaying buffs, a locked empowered attack, marks, a floor shield
{
  const { g, h, e, reset, mr, ar } = duel('gorrum');
  assert.deepEqual([h.range, h.mhp, h.mmp], [125, 600 + 5 * 109, 267 + 5 * 40]);
  h.cds[3] = 1e9;                                   // keep the R marks out of the other checks
  const noR = () => { h.cds[3] = 1e9; };
  reset(800); noR(); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); g.command(1, { c: 'move', x: 2000, y: 800 }); run(g, 0.5);
  assert.equal(h.x, 3000, 'Gorrum cannot move while the harpoon is out'); run(g, 0.3); g.command(2, { c: 'move', x: 6000, y: 800 });
  assert(e.stunUntil > g.time && e.x < 3800 && e.x > 3200, 'hooked target is being dragged: ' + (e.x | 0)); run(g, 0.35);
  assert(near(e.x, 3000 + h.radius + 75, 0.01) && near(5000 - e.hp, 110 * mr), 'pulled to 75 in front of where he stood: ' + (e.x | 0)); run(g, 0.7); assert(h.x < 2950, 'and he is free again 0.25s after the hit');
  reset(800); noR(); g.command(1, { c: 'cast', s: 0, x: h.x, y: h.y + 500 }); run(g, 0.5); assert(h.state && h.state.name === 'hooking'); run(g, 0.5); assert(!h.state, 'a miss frees him when the harpoon runs out');
  reset(2000); noR(); const base = g.speed(h), as0 = g.atkSpeed(h); g.command(1, { c: 'cast', s: 1 });
  assert(near(g.speed(h), base * 1.6) && near(g.atkSpeed(h), as0 * 1.3), 'Boiler Vent: 60% move speed, 30% attack speed'); run(g, 1.45);
  assert(near(g.speed(h), base * 1.35, 0.02), 'fading: about 35% half way through the decay'); run(g, 1.6); assert(near(g.speed(h), base * 1.1), '10% for the rest'); run(g, 2);
  assert(near(g.speed(h), base * 0.7), 'then a 30% slow when it ends'); run(g, 1.6); assert(near(g.speed(h), base), 'which wears off');
  reset(150); noR(); g.command(1, { c: 'atk', id: e.id }); run(g, 0.1); assert(h.windup); g.command(1, { c: 'move', x: 2000, y: 800 }); assert(!h.windup, 'a plain attack windup is cancelled by a move order');
  reset(150); noR(); g.command(1, { c: 'cast', s: 2 }); g.command(1, { c: 'atk', id: e.id }); run(g, 0.1); assert(h.windup && h.windup.locked); g.command(1, { c: 'move', x: 2000, y: 800 });
  assert(h.windup, 'the empowered windup cannot be cancelled'); run(g, 0.5);
  assert(e.airUntil > g.time && !h.emp && near(5000 - e.hp, 2 * h.ad * ar), 'Anchor Fist: +100% AD and a knock-up');
  // R passive: attacks leave marks while R is ready; one goes off per second
  reset(150); h.cds[3] = 0; h.order = { type: 'hold' }; for (let i = 0; i < 3; i++) g.attackHit(h, e);
  const hpM = e.hp; run(g, 0.9); assert.equal(e.hp, hpM, 'marks wait a second'); run(g, 0.2); const one = hpM - e.hp;
  assert(near(one, (50 + 0.02 * h.mmp) * mr), 'a mark deals 50 + 2% of his max mana: ' + one.toFixed(1)); run(g, 2.1); assert(near(hpM - e.hp, 3 * one), 'three marks, three zaps'); run(g, 2); assert(near(hpM - e.hp, 3 * one));
  g.command(1, { c: 'cast', s: 3 }); e.shieldAmt = 500; e.shieldUntil = g.time + 9; const hpP = e.hp; run(g, 0.4);
  assert(near(hpP - e.hp, 275 * mr) && e.shieldAmt === 0 && e.silenceUntil > g.time && e.silenceUntil - g.time < 0.5, 'Pressure Pulse: damage through a stripped shield, 0.5s silence');
  e.ranks = [1, 1, 1, 1]; e.mp = 999; g.command(2, { c: 'cast', s: 0, x: h.x, y: h.y }); assert(!(e.cds[0] > g.time), 'a silenced hero cannot cast');
  g.attackHit(h, e); assert(!h.pulseMarks.size, 'no new marks while R is on cooldown');
  // Passive: the shield appears when a hit would take him below 30%, and only soaks what goes below it
  h.hp = h.mhp * 0.35; g.damage(e, h, h.mhp * 0.02, 'true'); assert(!h.floorShield, 'not yet');
  g.damage(e, h, h.mhp * 0.1, 'true'); assert(near(h.hp, h.mhp * 0.3) && near(h.floorShield.amt, 0.35 * h.mmp - 0.07 * h.mhp), 'Ballast Plating: held at 30%, shield = 35% of max mana');
  g.snapshot(1).units.find(u => u.id === h.id).sh > 0 || assert.fail('shield shown');
  h.floorShield.amt = 0; h.hp = h.mhp * 0.35; g.damage(e, h, h.mhp * 0.1, 'true'); assert(near(h.hp, h.mhp * 0.25), 'only once per cooldown');
  console.log('gorrum ok');
}
// 6. Wren: cooldown refunds, mark and detonate, stacking buff, blink + auto-target, piercing wave
{
  const { g, h, e, reset, minion, mr, ar } = duel('wren'), P = HEROES.wren.passive;
  const as0 = g.atkSpeed(h); assert(near(h.ad, 60 + 5 * 3.75) && h.bonusAd === 0);
  reset(800); h.cds = [0, g.time + 10, g.time + 10, g.time + 10]; g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.7);
  assert(near(5000 - e.hp, (20 + 1.3 * h.ad) * ar) && near(h.cds[1] - g.time, 10 - 0.7 - 1.5, 0.03) && near(h.cds[0] - g.time, 5.5 - 0.7 - 1.5, 0.03), 'Compass Bolt hit and took 1.5s off every cooldown');
  assert.equal(P.count(g, h), 1); assert(near(g.atkSpeed(h) / as0, 1.1), 'one stack = 10% attack speed');
  reset(800); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y + 500 }); run(g, 0.9); assert(near(h.cds[0] - g.time, 5.5 - 0.9, 0.03), 'a miss refunds nothing');
  h.items = ['blade']; g.refresh(h); assert.equal(h.bonusAd, 10);
  reset(800); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); run(g, 0.9); assert(e.mark && e.hp === 5000, 'Waymark tags without damage');
  h.mp = 200; let mp = h.mp; g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.7);
  assert(!e.mark && near(5000 - e.hp, (20 + 1.3 * h.ad) * ar + (80 + 1.15 * 10) * mr), 'Compass Bolt bursts the mark: 80 + 115% bonus AD on top');
  assert(near(h.mp - mp, 60 + 0.7 * h.manaRegen, 0.03), 'bursting with an ability restores 60 + that ability\'s cost: ' + (h.mp - mp).toFixed(1));
  reset(500); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); run(g, 0.9); h.mp = 200; mp = h.mp; g.command(1, { c: 'atk', id: e.id }); run(g, 0.8); g.command(1, { c: 'stop' });
  assert(!e.mark && near(5000 - e.hp, h.ad * ar + (80 + 11.5) * mr) && h.mp - mp < 3, 'a basic attack bursts it too, but restores no mana');
  h.items = []; g.refresh(h);
  for (let i = 0; i < 6; i++) { reset(800); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g, 0.7); }
  assert.equal(P.count(g, h), 5, 'stacks cap at 5'); assert(near(g.atkSpeed(h) / as0, 1.5));
  run(g, 6.1); assert.equal(P.count(g, h), 0); assert(near(g.atkSpeed(h), as0), 'stacks fall off together');
  reset(700); const m = minion(3550, 900); g.command(1, { c: 'cast', s: 2, x: 9000, y: 800 }); run(g, 0.2); assert.equal(h.x, 3000, 'Fold Step has a cast time'); run(g, 0.6);
  assert(near(h.x, 3475) && m.hp < 300 && e.hp === 5000, 'Fold Step blinked 475 and shot the nearest enemy');
  reset(700); m.hp = 300; m.y = 1000; g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); run(g, 0.9); assert(e.mark); g.command(1, { c: 'cast', s: 2, x: 3100, y: 800 }); run(g, 0.8);
  assert(m.hp === 300 && near(5000 - e.hp, (80 + 80) * mr) && !e.mark, 'with a marked enemy in reach, the bolt goes for it instead');
  g.units.delete(m.id);
  reset(2500); h.x = 700; e.x = 5400; const m2 = minion(3000, 800, 5000); g.command(1, { c: 'cast', s: 3, x: 6000, y: 800 }); run(g, 0.9);
  assert.equal(m2.hp, 5000, 'Meridian has a cast time'); run(g, 4);
  assert(near(5000 - m2.hp, 150) && near(5000 - e.hp, 350 * mr, 0.02), `Meridian crossed the map and pierced: ${(5000 - e.hp) | 0} to the hero, ${(5000 - m2.hp) | 0} to the minion`);
  console.log('wren ok');
}
// 7. Sable: no mana, blades in the world, chain targeting, delayed spawn, target validation, a hero-only channel
{
  const { g, h, e, reset, minion, mr, ar } = duel('sable'), B = HEROES.sable.abilities;
  assert(h.mmp === 0 && h.mp === 0 && g.snapshot(1).units.find(u => u.id === h.id).mmp === 0 && B.every(a => a.cost[0] === 0), 'Sable has no mana and her abilities cost nothing');
  h.items = ['crystal']; g.refresh(h); assert.equal(h.mmp, 0, 'even with a mana item'); h.items = []; g.refresh(h);
  reset(500); const a = minion(3700, 950, 5000), b = minion(3900, 700, 5000), far = minion(5200, 800, 5000);
  g.command(1, { c: 'cast', s: 0, x: 4800, y: 1300 }); assert(!(h.cds[0] > g.time), 'Q needs a target near the cursor');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(h.cds[0] > g.time); run(g, 1.4);
  assert(near(5000 - e.hp, 80 * mr) && near(5000 - a.hp, 80) && b.hp < 5000 && far.hp === 5000, 'the blade bounced through the 3 nearest enemies only');
  const blade = g.pickups[0]; assert(blade && near(blade.x, 3850) && g.time < blade.at, 'a blade is on its way to 350 behind the first target'); run(g, 0.4); assert(g.time >= blade.at, 'landing 1s after the first hit');
  const hpE = e.hp; g.command(1, { c: 'cast', s: 2, x: blade.x, y: blade.y }); run(g, 0.2);
  assert(!g.pickups.length && near(h.x, 3850) && near(hpE - e.hp, (68 + 172 * 5 / 17) * mr), 'Moonstep to a blade picks it up and slashes: ' + (hpE - e.hp).toFixed(1));
  assert(near(h.cds[2] - g.time, 12 * (1 - 0.84) - 0.2, 0.05) && h.nextAttack <= g.time, 'the pickup cut 84% of Moonstep\'s cooldown, and her attack is ready');
  for (const u of [a, b, far]) g.units.delete(u.id);
  reset(600); g.command(1, { c: 'cast', s: 2, x: 3300, y: 1200 }); assert(!(h.cds[2] > g.time) && h.x === 3000, 'Moonstep refuses empty ground');
  h.nextAttack = g.time + 9; g.command(1, { c: 'cast', s: 2, x: e.x, y: e.y }); run(g, 0.2);
  assert(g.dist(h, e) < 110 && near(5000 - e.hp, (20 + 0.4 * h.ad) * mr) && h.windup, 'Moonstep to an enemy lands next to it, hits it, and her attack (which was 9s away) starts at once');
  reset(2000); const base = g.speed(h); g.command(1, { c: 'cast', s: 1 }); assert(near(g.speed(h), base * 1.5), 'Toss & Twirl: 50% move speed'); g.command(1, { c: 'move', x: 3900, y: 800 }); run(g, 0.625);
  assert(near(g.speed(h), base * 1.25, 0.02), 'fading'); run(g, 0.7); assert(near(g.speed(h), base) && g.pickups.length === 1 && g.time >= g.pickups[0].at && near(g.pickups[0].x, 3000), 'gone after 1.25s, when the blade lands where she stood');
  h.x = 5000; run(g, 4.1); assert(!g.pickups.length, 'blades left alone expire after 4s');
  reset(2000); const wall = [740, 800, 860].map(y => minion(3150, y, 5000)); g.command(1, { c: 'cast', s: 1 }); g.command(1, { c: 'move', x: 3400, y: 800 }); let off = 0;
  for (let i = 0; i < 0.9 * TICK; i++) { g.step(); off = Math.max(off, Math.abs(h.y - 800)); } assert(off < 1 && h.x > 3300, 'and she passes through minions for those 1.25s'); for (const u of wall) g.units.delete(u.id);
  reset(600); const by = minion(3200, 900, 5000); g.command(1, { c: 'cast', s: 3 }); assert(!(h.cds[3] > g.time) && !h.state, 'Glass Storm needs an enemy hero within 500');
  reset(300); g.command(1, { c: 'cast', s: 3 }); g.command(1, { c: 'move', x: 2000, y: 800 }); run(g, 2.4); assert(h.x === 3000 && h.state, 'rooted while channelling'); g.command(1, { c: 'stop' }); run(g, 0.4);
  const storm = 5000 - e.hp, blades = storm / (25 * mr); assert(by.hp === 5000 && near(blades, 15, 1e-6), `Glass Storm: heroes only, exactly 15 blades: ${blades.toFixed(3)}`);
  { reset(300); let thrown = 0, last = 0; const seen = new Set(); g.command(1, { c: 'cast', s: 3 }); const t0 = g.time;      // count the blades as they leave her hand
    for (let i = 0; i < 3 * TICK; i++) { g.step(); for (const sh of g.shots) if (sh.kind === 'home' && !seen.has(sh.id)) { seen.add(sh.id); thrown++; last = g.time - t0; } }
    assert(thrown === 15 && near(last, 14 * 0.166, 0.03) && !h.state, `15 blades thrown, the last at ${last.toFixed(2)}s of the 2.5s channel`); }
  h.items = ['greatblade']; g.refresh(h); reset(300); g.command(1, { c: 'cast', s: 3 }); run(g, 2.4); g.command(1, { c: 'stop' }); run(g, 0.4); const phys = 40 * (0.16 + 0.5 * (g.atkSpeed(h) / HEROES.sable.as - 1)) * ar;
  assert(near((5000 - e.hp) / storm, (25 * mr + phys) / (25 * mr), 0.03), 'bonus AD adds a physical part to each blade'); h.items = []; g.refresh(h);
  reset(300); g.command(1, { c: 'cast', s: 3 }); run(g, 1); g.stun(h, 0.2); assert(!h.state, 'a stun cancels the channel'); run(g, 0.6); const hpS = e.hp; run(g, 1); assert(e.hp >= hpS, 'and the blades stop');
  reset(300); h.cds = [5, 5, 5, 50].map(c => g.time + c); e.hitBy.set(h.id, g.time - 5); e.hp = 1; g.damage(null, e, 5, 'true');
  assert(h.kills === 1 && near(h.cds[3] - g.time, 50), 'Encore needs damage on that hero within 3s'); e.dead = false;
  e.hp = 1; g.damage(h, e, 5, 'true'); assert(h.cds[0] <= g.time && near(h.cds[3] - g.time, 35), 'then a kill takes 15s off every cooldown');
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
    assert.equal(w3[0].mhp, MINION.melee.hp + MINION.melee.hpPer, 'minions spawned after 1:30 have had one upgrade');
    const can = w3.find(m => m.kind === 'cannon'); assert.deepEqual([can.mhp, can.ad, can.gold], [750 + 85, 36 + 1.5, 50 + 1], 'cannon: flat health, damage and gold per upgrade');
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
  const g = mk('wren', 'gorrum', true), h = g.heroes.get(1); g.nextWave = Infinity;
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
    g.attackHit(tw, cannon); assert(Math.abs(cannon.hp / cannon.mhp - 0.86) < 1e-9, 'cannon: one tower shot = 14% of max health');
    for (const m of [melee, caster, cannon]) g.units.delete(m.id);
  }
  // On heroes: flat physical damage that grows with game time, +40% per shot in a row (max +120%), reset 3s after the last hit
  const T = RULES.tower, hit = () => { const hp = h.hp; g.attackHit(tw, h); const d = hp - h.hp; h.hp = h.mhp; return d; }, ar = () => 100 / (100 + h.armor);
  g.time = 0; tw.heat = 0; tw.heatAt = -99;
  assert(near(hit(), 180 * ar()), 'a tower shot on a hero is 180 physical at 0:00'); assert(near(hit(), 180 * 1.4 * ar()), '+40% for the second in a row');
  hit(); assert(near(hit(), 180 * 2.2 * ar()) && near(hit(), 180 * 2.2 * ar()), 'capped at +120%');
  g.time = 2.9; assert(near(hit(), 180 * 2.2 * ar()), 'still warm 2.9s later'); g.time += 3.1; assert(near(hit(), (180 + 170 * g.time / 1500) * ar(), 0.001), 'cold again 3s after its last hit on a hero');
  g.time = 1500; tw.heatAt = -99; assert(near(hit(), 350 * ar()), '350 by the late game'); g.time = 5000; tw.heatAt = -99; assert(near(hit(), 350 * ar()), 'and no higher');
  h.armor += 100; tw.heatAt = -99; assert(near(hit(), 350 * ar()), 'armor reduces it');
  // plates, health and the unguarded reduction
  const outer = tw, inner = g.towers('blue').find(t => t.inner); g.time = 0;
  assert.deepEqual([outer.mhp, outer.plates, inner.mhp, inner.plates, outer.range], [5000, 5, 4000, 0, 750]);
  const red = g.heroes.get(2), mAtk = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 }); mAtk.x = outer.x + 200; mAtk.ms = 0; mAtk.range = 0;
  let gold = red.gold; g.damage(red, outer, 999, 'true', true); assert(outer.hp === 4001 && red.gold === gold, 'no gold until a plate breaks');
  g.damage(red, outer, 2, 'true', true); assert.equal(red.gold, gold + 120, 'breaking a plate pays 120'); g.damage(red, outer, 2100, 'true', true); assert.equal(red.gold, gold + 360, 'two more plates in one hit pay twice');
  gold = red.gold; g.damage(mAtk, outer, 1000, 'true', true); assert.equal(red.gold, gold, 'a plate broken by a minion pays nobody');
  g.units.delete(mAtk.id); const hpT = outer.hp; g.damage(red, outer, 100, 'true', true); assert(near(hpT - outer.hp, 20), 'with no attacking minions nearby a tower takes 20%');
  // edge-to-edge range: a hero is in tower range when its edge is within 750 of the tower's edge
  red.x = outer.x + 750 + outer.radius + red.radius - 1; red.y = outer.y; assert(g.inRange(outer, red)); red.x += 2; assert(!g.inRange(outer, red), 'tower range 750, edge to edge'); red.x = MAP.spawn.red.x;
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
  // The whole kit. A level-11 hard bot against a low player who stands still for 30s, then runs.
  const scene = (hero, ai = 'hard', mine = 'oriel') => { const g = new Game([{ id: 1, team: 'blue', hero: mine, name: 'A' }, { id: -1, team: 'red', hero, name: 'Bot', bot: true, ai }]);
    const me = g.heroes.get(1), b = g.heroes.get(-1); g.nextWave = Infinity; b.lvl = 11; b.points = 10; g.refresh(b); b.hp = b.mhp; b.mp = b.mmp; b.x = 9600; b.y = 800;
    me.x = 9000; me.y = 800; me.hpRegen = 0; me.order = { type: 'hold' }; return { g, me, b }; };
  for (const hero of ['kessa', 'gorrum', 'wren', 'sable']) {
    const { g, me, b } = scene(hero); me.mhp = 30000; me.hp = 9000; const used = [0, 0, 0, 0], prev = [0, 0, 0, 0];
    for (let i = 0; i < 60 * TICK; i++) { if (i === 30 * TICK) g.command(1, { c: 'move', x: 8200, y: 800 }); g.step(); if (me.hp < 3000) me.hp = 3000; b.mp = Math.max(b.mp, 200);
      assert(b.mp >= 0 && b.cds.every((cd, s) => cd <= prev[s] + 0.01 || prev[s] <= g.time + 0.05), `${hero} never casts an ability that is on cooldown`);
      for (let s = 0; s < 4; s++) { if (b.cds[s] > prev[s] + 0.5) used[s]++; prev[s] = b.cds[s]; } }
    assert(used.every(n => n > 0), `the ${hero} bot uses all four abilities: Q/W/E/R cast ${used.join('/')} times`);
  }
  // No hidden information: with the player out of sight in brush, no hero's bot casts anything at it.
  for (const hero of Object.keys(HEROES)) { const { g, me, b } = scene(hero); const br = MAP.brush[0]; me.x = br.x + br.w / 2; me.y = br.y + 100; me.hp = 1; me.mhp = 9000; b.x = me.x + 500; run(g, 20);
    assert(b.cds.every(cd => !(cd > 0)) && me.hp === 1, `${hero} bot does nothing to a player it cannot see`); }
  // Gorrum only hooks with a clear line; Kessa only lets her beam go once it reaches.
  { const { g, me, b } = scene('gorrum'); me.mhp = me.hp = 30000; const wall = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 }); Object.assign(wall, { x: 9300, y: 800, ms: 0, ad: 0, hp: 1e6, mhp: 1e6, lookAt: Infinity });
    for (let i = 0; i < 20 * TICK; i++) { g.step(); b.x = 9600; b.y = 800; } assert(!(b.cds[0] > 0), 'no hook while a minion stands in the way');
    g.units.delete(wall.id); let hooked = false; for (let i = 0; i < 20 * TICK && !hooked; i++) { g.step(); hooked = b.cds[0] > g.time; } assert(hooked, 'the hook comes out once the line is clear'); }
  { const { g, me, b } = scene('kessa'); me.mhp = me.hp = 30000; me.x = 8400; let beams = 0;
    for (let i = 0; i < 40 * TICK; i++) { const n = g.zones.length; g.step(); b.x = 9600; b.y = 800; for (const z of g.zones.slice(n)) if (z.shape === 'line') { beams++; assert(z.len >= g.dist(b, me) - me.radius - 80, `the beam (${z.len | 0}) was released long enough to reach (${g.dist(b, me) | 0})`); } }
    assert(beams >= 2 && me.hp < 30000, 'Kessa charges and releases her beam at the player'); }
  // Hard sidesteps a skillshot it can see; easy stands in it.
  const dodged = ai => { let hit = 0; for (let k = 0; k < 12; k++) { const { g, me, b } = scene('wren', ai); me.mhp = me.hp = 30000; me.x = 9150 + k * 10; b.hp = b.mhp = 30000; b.hpRegen = 0; b.x = 10050; b.y = 940; run(g, 2);     // the bot is standing at its post
      g.command(1, { c: 'lvl', s: 0 }); b.mp = 0; b.manaRegen = 0; const hp = b.hp; g.command(1, { c: 'cast', s: 0, x: b.x, y: b.y }); run(g, 1.5); if (b.hp < hp - 1) hit++; } return hit; };   // no mana: it can only move
  const hardHit = dodged('hard'), easyHit = dodged('easy');
  assert(hardHit <= 3 && easyHit >= 10, `skillshots that landed out of 12: ${hardHit} on hard (it dodges), ${easyHit} on easy`);
  Math.random = realRandom;
  console.log('bot ok');
}
// 11b. Heroes only attack on an attack click or an attack-move
{
  const g = mk('wren', 'oriel'), h = g.heroes.get(1), e = g.heroes.get(2); g.nextWave = Infinity;
  h.x = 3000; e.x = 3300; h.y = e.y = 800; e.hp = e.mhp = 5000; e.order = { type: 'hold' };
  const m = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 }); Object.assign(m, { x: 3200, y: 700, ms: 0, ad: 0, hp: 5000, mhp: 5000 });
  run(g, 3); assert(e.hp === 5000 && m.hp === 5000, 'standing idle next to enemies: no attacks');
  g.command(1, { c: 'move', x: 3050, y: 800 }); run(g, 3); assert(e.hp === 5000 && m.hp === 5000, 'nor after a move order finishes');
  g.command(1, { c: 'stop' }); run(g, 2); assert(e.hp === 5000 && m.hp === 5000, 'nor after Stop');
  g.command(1, { c: 'atk', id: m.id }); run(g, 2); assert(m.hp < 5000 && e.hp === 5000, 'clicking a minion attacks it, and only it');
  m.hp = 1; run(g, 2); assert(!g.units.has(m.id) && h.order === null, 'when it dies the hero stops'); run(g, 2); assert.equal(e.hp, 5000, 'instead of picking a new target');
  g.command(1, { c: 'amove', x: 3100, y: 800 }); run(g, 2); assert(e.hp < 5000, 'attack-move attacks what it meets');
  console.log('attack orders ok');
}
// 12. Selling items back, and 2v2: team totals, assists, four heroes
{
  const g = mk('wren', 'oriel'), h = g.heroes.get(1); h.gold = 2000;
  g.command(1, { c: 'buy', item: 'greatblade' }); g.command(1, { c: 'buy', item: 'gem' });
  const ad = h.ad, mhp = h.mhp, gold = h.gold; assert.deepEqual(bag(h), ['greatblade', 'gem']);
  g.command(1, { c: 'sell', i: 0 });
  assert.deepEqual(bag(h), ['gem']); assert.equal(h.gold, gold + 910); assert.equal(h.ad, ad - 40, 'selling returns 70% and removes the stats');
  g.command(1, { c: 'sell', i: 5 }); assert.equal(h.items.length, 1, 'an empty slot sells nothing');
  h.x = 5000; g.command(1, { c: 'sell', i: 0 }); assert.equal(h.items.length, 1, 'no selling away from base');
  h.x = MAP.spawn.blue.x; h.dead = true; g.command(1, { c: 'sell', i: 0 }); assert.equal(h.items.length, 1, 'no selling while dead, though buying still works');
  g.command(1, { c: 'buy', item: 'tome' }); assert.equal(h.items.length, 2); g.command(1, { c: 'sell', i: 1 }); h.dead = false; g.command(1, { c: 'sell', i: 1 }); assert.equal(h.items.length, 1);
  h.hp = h.mhp; g.command(1, { c: 'sell', i: 0 }); assert(h.items.length === 0 && h.mhp === mhp - 150 && h.hp <= h.mhp, 'health is capped after selling a health item');

  const g2 = new Game([{ id: 1, team: 'blue', hero: 'sable', name: 'A' }, { id: 2, team: 'blue', hero: 'wren', name: 'B' },
    { id: 3, team: 'red', hero: 'oriel', name: 'C' }, { id: 4, team: 'red', hero: 'gorrum', name: 'D' }]);
  const [a, b, c, d] = [1, 2, 3, 4].map(i => g2.heroes.get(i)); g2.nextWave = Infinity;
  assert.deepEqual(g2.goal, { kills: RULES.kills * 2, cs: RULES.cs * 2 }, '2v2 doubles the targets'); assert(a.y !== b.y, 'teammates spawn side by side');
  for (const u of [a, b, c, d]) { u.x = 5000; u.y = 800; u.order = { type: 'hold' }; } c.y = 900;
  a.cds = [20, 20, 20, 20].map(v => g2.time + v); g2.damage(a, c, 10, 'true'); g2.damage(b, c, 99999, 'true');
  assert(b.kills === 1 && a.kills === 0 && a.assists === 1 && a.gold === RULES.startGold + 150 && b.gold === RULES.startGold + 300 + 100, 'the killer gets 300 + 100 for first blood, the assister half of that capped at 150');
  assert(Math.abs(a.cds[0] - g2.time - 5) < 0.01, 'an assist triggers Encore');
  a.kills = RULES.kills; g2.step(); assert(!g2.over, 'one hero reaching the 1v1 target does not end a 2v2');
  a.kills = RULES.kills * 2 - 1; g2.step(); assert(g2.over && g2.over.winner === 'blue', 'the team total does');
  const snap = g2.snapshot(3); assert(snap.sc.b.k === RULES.kills * 2 && snap.sc.b.n === 'A & B' && snap.units.filter(u => u.k === 'h').length === 4);
  console.log('shop and 2v2 ok');
}
// 13. Two towers a side: the inner one is protected, and both must fall to win. Oriel's Q scales with AP.
{
  const g = mk('wren', 'oriel', true), h = g.heroes.get(1); g.nextWave = Infinity;
  const [outer, inner] = g.towers('red'); assert(outer && inner && !outer.inner && inner.inner && g.towers('blue').length === 2, 'two towers each');
  assert(Math.abs(inner.x - MAP.innerTower.red.x) < 1 && inner.x > outer.x, 'the inner tower is behind the outer one');
  const m = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 }); m.x = inner.x - 200;      // an attacker's minion nearby, so the tower is not "guarded"
  g.damage(h, inner, 500, 'true', true); assert.equal(inner.hp, inner.mhp, 'the inner tower cannot be hurt while the outer one stands');
  assert.equal(g.frontTower('red'), outer);
  m.x = outer.x - 200; g.damage(h, outer, 99999, 'true', true); assert(!g.over && g.towers('red').length === 1 && g.frontTower('red') === inner, 'one tower down is not a win');
  m.x = inner.x - 200; g.damage(h, inner, 500, 'true', true); assert(inner.hp < inner.mhp, 'now the inner tower takes damage');
  g.damage(h, inner, 99999, 'true', true); assert(g.over && g.over.winner === 'blue' && g.over.reason === 'both towers destroyed');
  const g2 = mk('oriel', 'gorrum'), q = g2.heroes.get(1), e = g2.heroes.get(2); g2.nextWave = Infinity; g2.command(1, { c: 'lvl', s: 0 });
  const hit = () => { q.x = 3000; e.x = 3600; q.y = e.y = 800; e.hp = e.mhp = 5000; q.cds[0] = 0; q.mp = q.mmp; q.order = { type: 'hold' }; g2.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); run(g2, 1); return 5000 - e.hp; };
  const base = hit(); q.items = ['staff', 'staff']; g2.refresh(q); const withAp = hit(), mult = 100 / (100 + e.mr);
  assert.equal(q.ap, 130); assert(Math.abs(base - 80 * mult) < 1 && Math.abs(withAp - (80 + 0.7 * 130) * mult) < 1, `Cinder Lance: ${base | 0} with no AP, ${withAp | 0} with 130 AP, reduced by magic resist`);
  console.log('towers ok');
}
// 14. Shared systems: gold, respawn timers, spells, items, edge-to-edge range
{
  const g = mk('wren', 'oriel'), h = g.heroes.get(1), e = g.heroes.get(2); g.nextWave = Infinity; h.order = e.order = { type: 'hold' };
  run(g, 64); assert.equal(h.gold, 500, 'no passive gold before 1:05'); run(g, 11); assert(near(h.gold, 500 + 10 * 2.04, 0.005), 'then 2.04 per second: ' + h.gold.toFixed(1));
  assert.deepEqual(RULES.respawn, [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5]);
  for (const lvl of [1, 7, 18]) { e.lvl = lvl; e.dead = false; e.hp = 1; g.damage(h, e, 5, 'true'); assert(near(e.respawnAt - g.time, RULES.respawn[lvl - 1]), `level ${lvl} respawn timer`); }
  assert.equal(h.kills, 3); const g3 = mk('wren', 'oriel'), k = g3.heroes.get(1), v = g3.heroes.get(2);
  v.hp = 1; g3.damage(k, v, 5, 'true'); assert.equal(k.gold, 500 + 400, 'first blood: 300 + 100'); v.dead = false; v.hp = 1; g3.damage(k, v, 5, 'true'); assert.equal(k.gold, 500 + 700, 'later kills: 300');
  // attack range is edge to edge for heroes and minions
  k.x = 3000; v.x = 3000 + k.range + k.radius + v.radius - 1; k.y = v.y = 800; v.dead = false; assert(g3.inRange(k, v)); v.x += 2; assert(!g3.inRange(k, v), 'hero attack range, edge to edge');
  assert.equal(k.radius, 65);
  // spells and items
  const S = (await import('../game/data.js')), I = Object.fromEntries(S.ITEMS.map(i => [i.id, i]));
  assert.deepEqual([S.SPELLS.d.cd, S.SPELLS.d.range, S.SPELLS.f.cd], [300, 400, 240]);
  for (const [lvl, heal] of [[1, 80], [18, 318], [6, 80 + 238 * 5 / 17]]) { k.lvl = lvl; g3.refresh(k); k.hp = 1; k.spellCds.f = 0; g3.command(1, { c: 'spell', s: 'f' }); assert(near(k.hp, 1 + heal), `Mend at level ${lvl}`); }
  assert.deepEqual(['tome', 'staff', 'dagger', 'crystal', 'cloak'].map(i => [I[i].cost, Object.values(I[i].stats)[0]]), [[400, 20], [1200, 65], [250, 10], [300, 300], [400, 20]]);
  k.x = MAP.spawn.blue.x; k.hp = 100; k.hpRegen = 0; k.gold = 50; g3.command(1, { c: 'buy', item: 'potion' }); k.hpRegen = 0; k.x = 3000; g3.command(1, { c: 'use', i: 0 }); run(g3, 15.2);
  assert(near(k.hp, 220, 0.01), 'a potion restores 120 health over 15s: ' + k.hp.toFixed(1));
  console.log('shared systems ok');
}
// 15. Client-side prediction (public/predict.js) follows the server's own movement rules
{
  const Predict = new Function(fs.readFileSync(new URL('../public/predict.js', import.meta.url), 'utf8') + '; return Predict;')();
  Predict.configure(RULES.predict);
  const setup = wallX => { const g = mk('wren', 'gorrum'), h = g.heroes.get(1); g.nextWave = Infinity; h.x = 3000; h.y = 800; h.face = 0;
    const ms = [740, 800, 860].map(y => { const m = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 }); return Object.assign(m, { x: wallX, y, laneY: y, ms: 0, lookAt: Infinity }); });
    const env = () => ({ now: g.time, speed: g.speed(h), canMove: true, ghosted: false, odd: h.id % 2 === 1, minions: ms, map: MAP, coll: RULES.collision });
    return { g, h, ms, env }; };
  // (a) Same orders, same world, same steps: the prediction lands where the server does, on open ground and around a wave.
  for (const wallX of [9000, 3300]) { const { g, h, env } = setup(wallX), p = Predict.create(); let worst = 0, steps = 0;
    Predict.moveTo(p, 3600, 800, { x: h.x, y: h.y, f: h.face }, g.time); g.command(1, { c: 'move', x: 3600, y: 800 });
    while (h.order && steps++ < 300) { g.step(); Predict.step(p, 1 / TICK, env()); worst = Math.max(worst, Math.hypot(p.x - h.x, p.y - h.y)); }
    assert(!h.order && !p.order && worst < 0.01, `prediction matches the server step for step ${wallX < 9000 ? 'around a wave' : 'on open ground'}: worst gap ${worst.toFixed(4)} over ${steps} steps`); }
  // (b) With 100ms of round trip the hero moves at once on the client, stays one round trip ahead, and snapshots agree with it.
  { const { g, h, env } = setup(3300), p = Predict.create(), rtt = 0.1, toServer = [], toClient = []; let worst = 0, late = 0, lead = 0, moved = 0;
    Predict.moveTo(p, 3600, 800, { x: h.x, y: h.y, f: h.face }, g.time); toServer.push({ at: g.time + rtt / 2, c: { c: 'move', x: 3600, y: 800 } });
    for (let i = 0; i < 3 * TICK; i++) {
      while (toServer.length && g.time + 1 / TICK >= toServer[0].at - 1e-9) g.command(1, toServer.shift().c);   // a tick includes every order that arrived before it ran
      g.step(); toClient.push({ at: g.time + rtt / 2, x: Math.round(h.x), y: Math.round(h.y) });
      Predict.step(p, 1 / TICK, env()); if (i === 0) moved = p.x - 3000;
      while (toClient.length && g.time >= toClient[0].at - 1e-9) { const s = toClient.shift(), err = Predict.reconcile(p, s.x, s.y, s.at, rtt); /* handled the moment it arrives */ worst = Math.max(worst, err); if (i > 0.5 * TICK) late = Math.max(late, err); }
      if (i === 10) lead = p.x - h.x;
    }
    assert(moved > 5, 'the hero starts moving on the very first frame, before the server has even heard the order');
    assert(lead > 0 && lead < 45, `it runs ahead of the server by about the delay the order took to get there: ${lead.toFixed(0)} units`);
    assert(worst < 20 && late < 2.5 && near(p.x, 3600, 0.002) && near(h.x, 3600, 0.002), `snapshots agree with it: largest disagreement ${worst.toFixed(1)} at the start, ${late.toFixed(1)} once settled (no rubber-banding)`); }
  // (c) Corrections: a small error is blended away over ~100ms, a large one snaps, and following mode is left alone.
  { const { g, env } = setup(9000), p = Predict.create(), e0 = env();
    Predict.moveTo(p, 3000, 800, { x: 3000, y: 800 }, 0); Predict.stop(p); for (let i = 0; i < 10; i++) Predict.step(p, 1 / TICK, { ...e0, now: i / TICK });
    assert.equal(Predict.reconcile(p, 3001, 800, 0.3, 0), 1); Predict.step(p, 1 / TICK, { ...e0, now: 0.34 }); assert.equal(p.x, 3000, 'rounding-sized errors are ignored');
    assert.equal(Predict.reconcile(p, 3040, 800, 0.35, 0), 40); Predict.step(p, 0.05, { ...e0, now: 0.4 }); assert(near(p.x, 3020, 0.001), 'half way after 50ms');
    Predict.step(p, 0.05, { ...e0, now: 0.45 }); assert(near(p.x, 3040, 0.001), 'all the way after 100ms'); assert(Predict.reconcile(p, 3040, 800, 0.46, 0) < 0.1, 'and the next snapshot agrees');
    Predict.reconcile(p, 3300, 800, 0.5, 0); assert.equal(p.x, 3300, 'an error over 150 units snaps');
    Predict.release(p); assert(p.mode === 'follow' && Predict.reconcile(p, 5000, 800, 0.6, 0) === 0 && p.x === 3300, 'following mode is not corrected'); }
  // The server marks when the hero cannot walk or is being moved, so the client can hold or hand over.
  { const g = mk('wren', 'gorrum'), h = g.heroes.get(1), flags = () => { const u = g.snapshot(1).units.find(u => u.id === h.id); return [u.nm, u.fm, u.gh]; };
    assert.deepEqual(flags(), [0, 0, 0]); g.stun(h, 1); assert.deepEqual(flags(), [1, 0, 0]); h.stunUntil = 0; g.shove(h, 100, 0, 0.5); assert.deepEqual(flags(), [1, 1, 0]); }
  console.log('prediction ok');
}
// 16. Items: recipes and prices, undo, limits, potions, the new stats, every passive, and the bot's shopping
{
  const shopper = (hero = 'wren', foe = 'oriel') => { const g = mk(hero, foe), h = g.heroes.get(1), e = g.heroes.get(2); g.nextWave = Infinity; h.gold = 20000; e.hpRegen = 0; h.hpRegen = 0; e.x = 3300; e.y = 800; return { g, h, e }; };
  const buy = (g, ...ids) => ids.map(id => g.command(1, { c: 'buy', item: id }));
  const wear = (g, h, ...ids) => { h.items = ids; g.refresh(h); h.hp = h.mhp; h.mp = h.mmp; };
  const fight = (g, h, e, dx = 200) => { h.x = 3000; e.x = 3000 + dx; h.y = e.y = 800; e.hp = e.mhp = 5000; h.hp = h.mhp; e.buffs = []; h.buffs = []; e.burn = null; };

  // data: every recipe adds up, every id is unique, every recipe part exists
  for (const it of ITEMS) if (it.recipe) assert.equal(it.cost, it.recipe.reduce((n, id) => n + ITEM[id].cost, 0) + it.fee, `${it.name}: total price = parts + fee`);
  assert.equal(new Set(ITEMS.map(i => i.id)).size, ITEMS.length); assert(ITEMS.every(i => (i.recipe || []).every(id => ITEM[id]) && i.name && i.cat && i.tier));
  assert(['blade', 'tome', 'dagger', 'gem', 'crystal', 'plating', 'cloak', 'boots', 'greatblade', 'staff', 'potion'].every(id => ITEM[id]), 'the old item ids are all still there');
  assert(ITEMS.filter(i => i.tier === 'finished').every(i => i.cost >= 2500 && i.cost <= 3500) && ITEMS.filter(i => i.tier === 'finished').length === 14);

  // recipe pricing: the Crown example
  { const { g, h } = shopper(); wear(g, h, 'spellbook', 'tome'); h.gold = 1300;
    assert.deepEqual(plan(ITEM, h.items, 'crown'), { ok: true, why: '', price: 1300, used: [0, 1], stack: -1 });
    buy(g, 'crown'); assert.deepEqual(bag(h), ['crown']); assert.equal(h.gold, 0, 'Crown: 2900 - 1200 (Spellbook) - 400 (Tome, a part of Codex) = 1300, both used up, one slot');
    h.gold = 1299; wear(g, h, 'spellbook', 'tome'); buy(g, 'crown'); assert.deepEqual(bag(h), ['spellbook', 'tome'], 'one gold short: nothing happens'); assert.equal(h.gold, 1299); }
  // nothing owned: full price and one free slot
  { const { g, h } = shopper(); h.gold = 2900; buy(g, 'crown'); assert.deepEqual(bag(h), ['crown']); assert.equal(h.gold, 0, 'bought from nothing: the full 2900');
    wear(g, h, 'gem', 'gem', 'gem', 'gem', 'gem', 'cloak'); h.gold = 9000; buy(g, 'crown'); assert.equal(h.items.length, 6); assert.equal(h.gold, 9000, 'a full bag with no parts of it: refused');
    // ...but a full bag can still buy something that uses up an owned part
    wear(g, h, 'gem', 'gem', 'gem', 'blade', 'gem', 'cloak'); buy(g, 'leechblade'); assert.deepEqual(bag(h), ['gem', 'gem', 'gem', 'leechblade', 'gem', 'cloak']); assert.equal(h.gold, 9000 - 550, 'it takes the part\'s slot and costs only the fee'); }
  // deep recipes: parts of parts are used, missing parts are bought in the same purchase
  { const { g, h } = shopper(); wear(g, h, 'blade', 'dagger', 'dagger'); h.gold = 5000; buy(g, 'ruinblade');
    assert.deepEqual(bag(h), ['ruinblade']); assert.equal(h.gold, 5000 - (3200 - 350 - 250 - 250));
    assert.deepEqual(missing(ITEM, [{ id: 'spellbook', n: 1 }], 'crown'), ['codex', 'tome', 'gear']); assert.deepEqual(buildsInto(ITEMS, 'codex').map(i => i.id), ['crown', 'emberorb', 'hexblade']);
    assert.deepEqual(describe(ITEM.crown), ['+90 ability power', '+300 mana', '+20 ability haste', 'Passive – Overflow: gain ability power equal to 2% of max mana.']); }
  // shopping only at base or while dead
  { const { g, h } = shopper(); h.x = 5000; buy(g, 'blade'); assert.equal(h.items.length, 0, 'no buying in lane'); h.dead = true; buy(g, 'blade'); assert.equal(h.items.length, 1, 'buying while dead works'); }

  // undo: several steps, newest first, exact gold and bag; a sale is taken back at full value
  { const { g, h } = shopper(); h.gold = 3000; const states = [[[], 3000]];
    const act = c => { g.command(1, c); states.push([bag(h), h.gold]); };
    act({ c: 'buy', item: 'blade' }); act({ c: 'buy', item: 'gear' }); act({ c: 'buy', item: 'edge' }); act({ c: 'sell', i: 0 }); act({ c: 'buy', item: 'potion' }); act({ c: 'buy', item: 'potion' });
    assert.deepEqual(states.map(x => x[1]), [3000, 2650, 2350, 1900, 1900 + 770, 2620, 2570]); assert.deepEqual(states.at(-1)[0], ['potion']); assert.equal(h.items[0].n, 2);
    for (let i = states.length - 2; i >= 0; i--) { g.command(1, { c: 'undo' }); assert.deepEqual([bag(h), h.gold], states[i], `undo back to step ${i}`); }
    g.command(1, { c: 'undo' }); assert.deepEqual([bag(h), h.gold], [[], 3000], 'nothing left to undo'); assert.equal(h.ad, HEROES.wren.ad, 'and the stats went back too');
    const cleared = (what, how) => { h.x = MAP.spawn.blue.x; h.dead = false; h.gold = 3000; h.items = []; g.refresh(h); h.hp = h.mhp; buy(g, 'blade'); assert.equal(h.undo.length, 1); how(); g.command(1, { c: 'undo' }); assert.deepEqual(bag(h), ['blade'], 'undo history is cleared by ' + what); };
    const e = g.heroes.get(2);
    cleared('leaving base', () => { h.x = 3000; g.step(); h.x = MAP.spawn.blue.x; }); cleared('taking damage', () => g.damage(e, h, 5, 'true')); cleared('dealing damage', () => g.damage(h, e, 5, 'true'));
    cleared('casting an ability', () => { h.ranks[0] = 1; h.cds[0] = 0; g.command(1, { c: 'cast', s: 0, x: 9000, y: 800 }); }); cleared('dying', () => { g.kill(null, h); h.dead = false; h.respawnAt = 0; });
    cleared('drinking', () => { buy(g, 'potion'); g.command(1, { c: 'use', i: 1 }); }); }

  // limits: one pair of boots, one starter, one flask; an upgrade of what you have is fine; passives are unique
  { const { g, h } = shopper(); buy(g, 'boots', 'boots'); assert.deepEqual(bag(h), ['boots'], 'a second pair of boots is refused'); wear(g, h, 'boots', 'gem'); buy(g, 'swiftboots'); assert.deepEqual(bag(h), ['swiftboots', 'gem'], 'Boots -> Swift Boots is allowed');
    wear(g, h, 'boots'); buy(g, 'hasteboots'); assert.deepEqual(bag(h), ['hasteboots'], 'upgrading Boots uses them up, so it is allowed'); buy(g, 'boots', 'ironboots'); assert.deepEqual(bag(h), ['hasteboots']);
    buy(g, 'starterblade', 'starterring', 'starterblade'); assert.deepEqual(bag(h), ['hasteboots', 'starterblade'], 'one starter only');
    buy(g, 'flask', 'flask'); assert.deepEqual(bag(h), ['hasteboots', 'starterblade', 'flask'], 'one flask only'); assert.equal(h.items[2].n, 3);
    wear(g, h, 'doomstaff', 'doomstaff'); assert(near(h.ap, 240 * 1.3), 'two copies: the stats twice, the passive once'); wear(g, h, 'voidstaff', 'voidstaff'); assert.equal(h.magicPenPct, 35); }

  // potions and the flask: carried, stacked, drunk with the slot key
  { const { g, h } = shopper(); h.hp = 100; buy(g, 'potion', 'potion', 'potion', 'potion', 'potion', 'potion'); h.x = 3000; h.hpRegen = 0;
    assert.deepEqual(h.items, [{ id: 'potion', n: 5 }], 'potions stack to 5 in one slot; the sixth is refused'); assert.equal(h.gold, 20000 - 250); run(g, 3); assert.equal(h.hp, 100, 'a potion is not drunk when bought');
    g.command(1, { c: 'use', i: 3 }); g.command(1, { c: 'use', i: 0 }); assert.equal(h.items[0].n, 4); run(g, 7.5); assert(near(h.hp, 160, 0.01), 'half the potion after 7.5s'); run(g, 7.6); assert(near(h.hp, 220, 0.01), 'a potion heals 120 over 15s');
    g.command(1, { c: 'use', i: 0 }); g.command(1, { c: 'use', i: 0 }); run(g, 15.1); assert(near(h.hp, 340, 0.01), 'a second drink waits its turn'); run(g, 15); assert(near(h.hp, 460, 0.01)); assert.equal(h.items[0].n, 2);
    g.command(1, { c: 'use', i: 0 }); g.command(1, { c: 'use', i: 0 }); assert.equal(h.items.length, 0, 'the slot empties with the last potion'); run(g, 31); h.hp = 100;
    h.x = MAP.spawn.blue.x; buy(g, 'flask', 'blade'); h.x = 3000; h.hpRegen = 0; g.step(); for (let i = 0; i < 4; i++) g.command(1, { c: 'use', i: 0 }); g.command(1, { c: 'use', i: 1 });
    assert.deepEqual(h.items, [{ id: 'flask', n: 0 }, { id: 'blade', n: 1 }], 'three charges; empty, it stays in the bag; other items cannot be drunk'); const hp = h.hp; run(g, 36.1); assert(near(h.hp - hp, 300, 0.01), 'each charge heals 100 over 12s');
    h.x = MAP.spawn.blue.x; g.step(); assert.equal(h.items[0].n, 3, 'the flask refills at base');
    const before = h.gold; g.command(1, { c: 'sell', i: 0 }); assert.equal(h.gold, before + 105, 'the flask sells for 70% of 150'); buy(g, 'potion', 'potion'); const gold = h.gold; g.command(1, { c: 'sell', i: 1 }); assert(h.gold === gold + 35 && h.items[1].n === 1, 'potions sell one at a time for 70%'); }

  // haste
  { const { g, h } = shopper('oriel'); wear(g, h, 'edge', 'codex'); assert.equal(h.haste, 20); g.command(1, { c: 'lvl', s: 1 }); h.x = 3000; g.command(1, { c: 'cast', s: 1, x: 3500, y: 800 });
    assert(near(h.cds[1] - g.time, 10 * 100 / 120, 1e-9), '20 haste turns a 10s cooldown into 8.33s: ' + (h.cds[1] - g.time).toFixed(3));
    const cd = HEROES.oriel.abilities[1].cd[0]; assert.equal(cd, 10); run(g, 0.3); g.command(1, { c: 'spell', s: 'd', x: 3100, y: 800 }); assert(near(h.spellCds.d - g.time, 300), 'summoner spells are not affected');
    wear(g, h, 'crown', 'hasteboots', 'emberorb', 'spellbook', 'codex', 'heartgem'); assert.equal(h.haste, 20 + 15 + 15 + 10 + 10 + 10); }

  // crit: dealt from a deck, so 25% is exactly 5 in 20, and the same seed gives the same order
  { const crits = seed => { const g = new Game([{ id: 1, team: 'blue', hero: 'wren', name: 'A' }, { id: 2, team: 'red', hero: 'oriel', name: 'B' }], { seed }), h = g.heroes.get(1), e = g.heroes.get(2); g.nextWave = Infinity;
      h.items = ['critblade']; g.refresh(h); e.mhp = e.hp = 1e6; e.armor = 0; const out = [];
      for (let i = 0; i < 60; i++) { g.events = []; const hp = e.hp; g.attackHit(h, e); const crit = g.events.some(ev => ev.e === 'dmg' && ev.cr); out.push(crit ? 1 : 0); assert(near(hp - e.hp, h.ad * (crit ? 2.15 : 1)), 'a crit multiplies the attack by critDmg (Keen: 215%)'); }
      return out; };
    const a = crits(7), b = crits(7), c = crits(8), sum = x => x.reduce((n, v) => n + v, 0);
    assert.equal(ITEM.critblade.stats.crit, 25); assert.deepEqual([sum(a.slice(0, 20)), sum(a.slice(20, 40)), sum(a.slice(40))], [5, 5, 5], 'exactly 5 crits in every 20 attacks');
    assert.deepEqual(a, b, 'the same seed gives the same order'); assert.notDeepEqual(a, c, 'another seed gives another');
    const { g, h, e } = shopper(); wear(g, h, 'cape'); e.mhp = e.hp = 1e6; e.armor = 0; g.events = []; for (let i = 0; i < 20; i++) g.attackHit(h, e);
    assert.equal(g.events.filter(ev => ev.cr).length, 3, '15% crit: 3 cards in 20'); assert(near(1e6 - e.hp, h.ad * (17 + 3 * 1.75)), 'without Keen a crit is 175%');
    wear(g, h, 'cape', 'swiftcape', 'critblade', 'longbow', 'stormbow'); assert.equal(h.crit, 100, 'crit chance is capped at 100%'); g.events = []; g.attackHit(h, e); assert(g.events.some(ev => ev.cr));
    h.ranks[0] = 1; wear(g, h, 'critblade'); const hp = e.hp; g.damage(h, e, 100, 'phys'); assert.equal(hp - e.hp, 100, 'abilities never crit'); }

  // lifesteal, armor pen, magic pen: the worked examples
  { const { g, h, e } = shopper(); wear(g, h, 'leechblade'); fight(g, h, e); e.armor = 100; h.hp = 200; g.attackHit(h, e);
    const dealt = 5000 - e.hp; assert(near(dealt, h.ad / 2) && near(h.hp - 200, dealt * 0.07), 'lifesteal heals 7% of the damage dealt after armor');
    e.shieldAmt = 10; e.shieldUntil = g.time + 5; h.hp = 200; g.attackHit(h, e); assert(near(h.hp - 200, (h.ad / 2 - 10) * 0.07), 'and after shields');
    h.hp = 200; g.damage(h, e, 500, 'magic'); assert.equal(h.hp, 200, 'not from ability damage');
    const tower = g.towers('red')[0], mAtk = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 }); mAtk.x = tower.x; mAtk.ms = 0; mAtk.range = 0; const m = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 });
    h.hp = 200; g.attackHit(h, m); assert(near(h.hp - 200, h.ad * 0.07), 'it works on minions'); h.hp = 200; const thp = tower.hp; g.attackHit(h, tower); assert(near(h.hp - 200, (thp - tower.hp) * 0.07) && tower.hp < thp, 'and on towers');
    wear(g, h, 'longbow'); assert.equal(h.armorPen, 30); fight(g, h, e); e.armor = 100; g.damage(h, e, 170, 'phys'); assert(near(5000 - e.hp, 100), '100 armor with 30% armor pen is treated as 70');
    tower.hp = tower.mhp; g.damage(h, tower, 140, 'phys', true); assert(near(tower.mhp - tower.hp, 100), 'armor pen does not apply to towers (40 armor stays 40)');
    wear(g, h, 'voidstaff', 'casterboots'); assert.deepEqual([h.magicPenPct, h.magicPenFlat], [35, 12]); fight(g, h, e); e.mr = 60; g.damage(h, e, 127, 'magic'); assert(near(5000 - e.hp, 100), '60 MR, 35% pen, 12 flat: 39, then 27');
    fight(g, h, e); e.mr = 10; g.damage(h, e, 100, 'magic'); assert(near(5000 - e.hp, 100), 'magic resist never goes below 0'); m.mr = 60; const mhp = m.hp; g.damage(h, m, 127, 'magic'); assert(near(mhp - m.hp, 100), 'pen works on minions'); }

  // tenacity: stuns, roots, silences and slows are shorter; forced movement is not
  { const { g, h, e } = shopper(); wear(g, h, 'spiritboots'); assert(near(h.tenacity, 0.3));
    g.stun(h, 1); assert(near(h.stunUntil - g.time, 0.7), 'a 1s stun lasts 0.7s'); h.stunUntil = 0; g.root(h, 1); g.silence(h, 2); g.addBuff(h, 'slow', 0.5, 2);
    assert(near(h.rootUntil - g.time, 0.7) && near(h.silenceUntil - g.time, 1.4) && near(h.buffs.at(-1).until - g.time, 1.4), 'roots, silences and slows too'); h.buffs = [];
    g.addBuff(h, 'haste', 0.5, 2); assert(near(h.buffs.at(-1).until - g.time, 2), 'buffs are not shortened'); h.stunUntil = 0;
    g.knockUp(h, 1); assert(near(h.stunUntil - g.time, 1) && near(h.airUntil - g.time, 1), 'a knock-up is unchanged'); h.stunUntil = 0; h.x = 3000; e.x = 3600; h.y = e.y = 800;
    g.pull(h, e, 1700, { gap: 75, stun: 0.65 }); assert(near(h.stunUntil - g.time, 0.65), 'and so is a pull'); h.push = null;
    g.stun(e, 1); assert(near(e.stunUntil - g.time, 1), 'no tenacity, full stun'); }

  // regen, heal amp and the regen passives
  { const { g, h, e } = shopper(); const base = HEROES.wren.hpRegen, mbase = HEROES.wren.manaRegen;
    wear(g, h, 'bead', 'charm'); assert(near(h.hpRegen, base + 1) && near(h.manaRegen, mbase + 0.5), 'regen items add per-second regen');
    wear(g, h, 'spiritcloak'); h.hp = 100; g.heal(h, 100); assert.equal(h.hp, 225, 'Vigor: +25% healing'); h.x = 3000; h.hp = 100; h.hpRegen = 4; run(g, 1); assert(near(h.hp, 105, 0.001), 'and regen');
    wear(g, h, 'titanheart'); h.x = 3000; h.hpRegen = 0; h.hp = 100; h.heroHitAt = g.time; run(g, 5.9); assert.equal(h.hp, 100, 'Recover waits 6s after hero damage'); run(g, 1.1);
    assert(near(h.hp - 100, 0.004 * h.mhp, 0.05), 'then 0.4% of max health a second'); const m = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 }); m.ms = 0; m.range = 0;
    g.damage(m, h, 10, 'true'); let hp = h.hp; run(g, 1); assert(near(h.hp - hp, 0.004 * h.mhp, 0.01), 'minion damage does not stop it'); g.damage(e, h, 10, 'true'); hp = h.hp; run(g, 3); assert.equal(h.hp, hp, 'hero damage does');
    wear(g, h, 'startershield'); h.hpRegen = 0; h.hp = 100; h.heroHitAt = -1e9; run(g, 2); assert.equal(h.hp, 100, 'Second Wind: nothing until a hero hits you'); g.damage(m, h, 10, 'true'); run(g, 1); assert.equal(h.hp, 90, 'minions do not count');
    g.damage(e, h, 10, 'true'); run(g, 3); assert(near(h.hp, 80 + 9, 0.01), '+3 a second after hero damage'); g.damage(e, h, 9, 'true'); run(g, 6); assert(near(h.hp, 80 + 18, 0.01), 'a new hit restarts the 6s'); run(g, 3); assert(near(h.hp, 98, 0.01), 'and then it stops'); }

  // the magic passives
  { const { g, h, e } = shopper('kessa'); wear(g, h, 'crown'); assert.equal(h.mmp, 700); assert(near(h.ap, 90 + 14), 'Overflow: +2% of max mana as AP'); wear(g, h, 'crown', 'crystal'); assert(near(h.ap, 90 + 20), '1000 max mana -> +20 AP');
    wear(g, h, 'crown', 'crystal', 'doomstaff'); assert(near(h.ap, (90 + 120 + 20) * 1.3), 'Magnify multiplies everything, Overflow included');
    wear(g, h, 'emberorb'); fight(g, h, e); const m = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 }); m.ms = 0; m.range = 0; h.order = e.order = { type: 'hold' };
    g.attackHit(h, e); assert(!e.burn, 'Burn: not from a basic attack'); g.damage(h, m, 10, 'magic'); assert(!m.burn, 'not on minions');
    e.hp = 5000; e.mr = 0; g.damage(h, e, 100, 'magic'); assert(e.burn && e.hp === 4900); run(g, 0.4); assert.equal(e.hp, 4900); run(g, 0.2); assert(near(e.hp, 4900 - 25), 'a tick of 0.5% of max health every 0.5s'); run(g, 2.5);
    assert(near(e.hp, 4900 - 150) && !e.burn, '6 ticks: 3% of max health over 3s'); run(g, 2); assert(near(e.hp, 4750), 'and it does not restart itself');
    g.damage(h, e, 50, 'magic'); run(g, 1.6); g.damage(h, e, 50, 'magic'); run(g, 3.2); assert(near(e.hp, 4750 - 100 - 9 * 25), 'hitting again restarts the 3s; it never stacks');
    wear(g, h, 'emberorb', 'hexblade'); h.hpRegen = 0; h.hp = 100; e.hp = 5000; g.damage(h, e, 300, 'magic'); assert(near(h.hp, 110), 'Drain: ability damage heals a third of lifesteal (10% -> 3.3%)'); run(g, 3.2); assert(near(h.hp, 110, 0.02), 'passive damage (the burn) does not trigger it');
    h.hp = 100; e.armor = 0; e.burn = null; g.attackHit(h, e); assert(near(h.hp - 100, h.ad * 0.1, 0.01), 'attacks still use plain lifesteal'); }

  // the attack passives
  { const { g, h, e } = shopper(); wear(g, h, 'ruinblade'); fight(g, h, e); e.armor = 0; g.attackHit(h, e); assert(near(5000 - e.hp, h.ad + 300), 'Rend: +6% of the target\'s current health'); const was = e.hp; h.hp = 100; g.attackHit(h, e);
    assert(near(was - e.hp, h.ad + 0.06 * was) && near(h.hp - 100, (was - e.hp) * 0.1), 'current health, and lifesteal heals from it too');
    const m = g.spawnMinion({ team: 'red', kind: 'cannon', wave: 2, slot: 1 }); m.hp = m.mhp = 5000; g.attackHit(h, m); assert(near(5000 - m.hp, h.ad + 60), 'at most 60 against minions');
    const tower = g.towers('red')[0], ally = g.spawnMinion({ team: 'blue', kind: 'melee', wave: 2, slot: 1 }); ally.x = tower.x; ally.ms = 0; ally.range = 0; ally.hp = ally.mhp = 1e7; ally.kind = 'statue'; g.attackHit(h, tower); assert(near(tower.mhp - tower.hp, h.ad * 100 / 140), 'never against towers');
    wear(g, h, 'duskblade'); h.ranks = [1, 1, 1, 1]; fight(g, h, e); e.armor = 0; h.armorPen = 0; g.attackHit(h, e); assert(near(5000 - e.hp, h.ad), 'Ambush: nothing until an ability is cast');
    g.command(1, { c: 'spell', s: 'f' }); assert(!(h.ambushUntil > g.time), 'summoner spells do not charge it'); h.cds = [0, 0, 0, 0]; h.mp = h.mmp; g.command(1, { c: 'cast', s: 1, x: 3000, y: 300 }); run(g, 0.3);
    assert(h.ambushUntil > g.time && g.snapshot(1).units.find(u => u.id === h.id).ab === 1, 'an ability charges it (and the hero glows)'); let hp = e.hp; g.attackHit(h, e); assert(near(hp - e.hp, h.ad + 40 + 0.3 * h.bonusAd), `+40 + 30% bonus AD on the next attack: ${hp - e.hp} vs ${h.ad} + 40 + 0.3 x ${h.bonusAd}, armor ${e.armor}, pen ${h.armorPen}`);
    hp = e.hp; g.attackHit(h, e); assert(near(hp - e.hp, h.ad), 'once'); h.cds = [0, 0, 0, 0]; g.command(1, { c: 'cast', s: 1, x: 3000, y: 300 }); assert(!(h.ambushUntil > g.time), 'it cannot charge again for 6s'); run(g, 6.1);
    h.cds = [0, 0, 0, 0]; h.mp = h.mmp; g.command(1, { c: 'cast', s: 1, x: 3000, y: 300 }); assert(h.ambushUntil > g.time); run(g, 4.1); hp = e.hp; g.attackHit(h, e); assert(near(hp - e.hp, h.ad), 'the charge is lost after 4s');
    h.cds = [0, 0, 0, 0]; h.mp = h.mmp; run(g, 6); g.command(1, { c: 'cast', s: 1, x: 3000, y: 300 }); tower.hp = tower.mhp; const charged = h.ambushUntil > g.time; g.attackHit(h, tower); assert(near(tower.mhp - tower.hp, (h.ad + 58) * 100 / 140), `it works on towers: charged ${charged}, dealt ${tower.mhp - tower.hp}, want ${(h.ad + 58) * 100 / 140}, towers ${g.towers('red').length}, ally hp ${ally.hp}`); }

  // the defense passives
  { const { g, h, e } = shopper('gorrum', 'wren'); wear(g, h, 'thornmail'); fight(g, h, e); h.cds[3] = 1e9; e.mr = 0; e.hp = e.mhp = 5000;
    g.attackHit(e, h); assert(near(5000 - e.hp, 10 + 0.1 * 70), 'Barbs: a hero who attacks takes 10 + 10% of the owner\'s bonus armor');
    const m = g.spawnMinion({ team: 'red', kind: 'melee', wave: 2, slot: 1 }), mhp = m.hp; g.attackHit(m, h); assert.equal(m.hp, mhp, 'not from minions'); const hp = e.hp; g.damage(e, h, 50, 'magic'); assert.equal(e.hp, hp, 'not from abilities');
    const tower = g.towers('red')[0], thp = tower.hp; g.attackHit(tower, h); assert.equal(tower.hp, thp, 'not from towers');
    wear(g, h, 'frostplate'); fight(g, h, e); const as0 = g.atkSpeed(e); g.attackHit(m, h); g.damage(e, h, 50, 'magic'); assert(near(g.atkSpeed(e), as0), 'Chill: not from minions or abilities'); g.attackHit(e, h);
    assert(near(g.atkSpeed(e), as0 * 0.8) && g.snapshot(1).units.find(u => u.id === e.id).fz === 1, 'an attacking hero loses 20% attack speed, and it shows'); run(g, 1); g.attackHit(e, h); assert(near(g.atkSpeed(e), as0 * 0.8), 'it does not stack'); run(g, 1.5);
    assert(near(g.atkSpeed(e), as0 * 0.8), 'it refreshes'); run(g, 0.6); assert(near(g.atkSpeed(e), as0), 'and ends after 2s');
    wear(g, h, 'ironboots'); fight(g, h, e); h.hp = h.mhp; g.attackHit(e, h); const withGuard = h.mhp - h.hp; wear(g, h, 'boots', 'plating', 'plating'); h.armor += -5; g.refresh(h); h.items = ['ironboots']; g.refresh(h); h.passives = {}; h.hp = h.mhp; g.attackHit(e, h);
    assert(near(withGuard / (h.mhp - h.hp), 0.9), 'Guard: basic attacks deal 10% less'); g.refresh(h); h.hp = h.mhp; g.damage(e, h, 100, 'true'); assert.equal(h.mhp - h.hp, 100, 'abilities are not reduced'); h.hp = h.mhp; g.attackHit(m, h); assert(near(h.mhp - h.hp, m.ad * 0.6 * 0.9 * 100 / (100 + h.armor)), 'minion attacks are'); }

  // the stat panel numbers reach the client
  { const { g, h } = shopper(); wear(g, h, 'duskblade', 'leechblade', 'cape', 'voidstaff', 'casterboots'); const me = g.snapshot(1).me;
    assert.deepEqual([me.hs, me.cr, me.ls, me.apn, me.mpp, me.mpf, me.undo], [20, 15, 7, 20, 35, 12, 0]); assert.deepEqual(me.items[0], { id: 'duskblade', n: 1 }); }

  // the bot shops through recipes, keeps a potion, and sells its starter when it needs the room
  for (const hero of Object.keys(HEROES)) { const g = new Game([{ id: 1, team: 'blue', hero: 'wren', name: 'A' }, { id: -1, team: 'red', hero, name: 'Bot', bot: true, ai: 'normal' }], { seed: 3 }), b = g.heroes.get(-1), build = HEROES[hero].build; g.nextWave = Infinity;
    g.step(); const opening = [].concat(build[0]); assert.deepEqual(bag(b).sort(), [...new Set(opening)].sort(), `${hero} bot buys its opening items`); // A 450-gold starter leaves room for one potion out of 500 starting gold, even where the build lists two.
    assert.equal(b.items.find(s => s.id === 'potion').n, Math.min(opening.filter(i => i === 'potion').length, Math.floor((RULES.startGold - ITEM[opening[0]].cost) / ITEM.potion.cost)));
    assert(b.gold >= 0 && b.gold < 100); const spent = [];
    for (let i = 0; i < 400; i++) { b.gold += 60; b.x = MAP.spawn.red.x; b.y = 800; b.order = null; g.step(); assert(b.items.length <= BAG_SLOTS && b.gold >= 0); if (i % 40 === 0) spent.push(bag(b).join()); }
    const done = b.items.filter(s => ITEM[s.id].tier === 'finished').map(s => s.id), wanted = build.slice(1).map(st => (typeof st === 'string' ? st : st[HEROES.wren.dmgType])).filter(id => ITEM[id].tier === 'finished');
    assert(done.length >= 3 && done.every((id, i) => id === wanted[i]), `${hero} bot builds its finished items in order: ${done.join(', ')}`);
    assert(b.items.some(s => ITEM[s.id].group === 'boots') && new Set(spent).size > 5, 'with boots, bought a piece at a time'); }
  { const g = new Game([{ id: 1, team: 'blue', hero: 'wren', name: 'A' }, { id: -1, team: 'red', hero: 'gorrum', name: 'Bot', bot: true, ai: 'normal' }], { seed: 3 }), b = g.heroes.get(-1); g.nextWave = Infinity; g.step();
    const potions = () => b.items.filter(s => s.id === 'potion').reduce((n, s) => n + s.n, 0), n = potions();
    b.x = 9000; b.hp = b.mhp * 0.45; run(g, 0.5); assert(n >= 1 && b.potQ.length === 1 && potions() === n - 1, 'the bot drinks a potion below half health');
    b.gold = 1000; b.hp = b.mhp * 0.45; run(g, 2); assert.equal(b.potQ.length, 1, 'one at a time');
    const g2 = new Game([{ id: 1, team: 'blue', hero: 'kessa', name: 'A' }, { id: -1, team: 'red', hero: 'gorrum', name: 'Bot', bot: true, ai: 'normal' }], { seed: 3 }); g2.nextWave = Infinity; const b2 = g2.heroes.get(-1);
    for (let i = 0; i < 200; i++) { b2.gold += 60; b2.x = MAP.spawn.red.x; g2.step(); } assert(bag(b2).includes('spiritboots') && !bag(b2).includes('ironboots'), 'against an ability hero Gorrum buys Spirit Boots'); }
  console.log('items ok');
}
console.log('all checks passed');
