// Practice opponent: an enemy hero that plays the lane.
//
// It plays by the player's rules. Everything it does goes through g.command(), the same call a browser's
// input ends up in, so cooldowns, mana, range, silences and stuns apply to it exactly as they do to a player.
// It only uses what a player could see on screen:
//   - minions, towers, projectiles and ability telegraphs (all of these are drawn for both sides);
//   - the enemy hero only while g.targetable() says it is visible (not hidden in brush), and then only
//     what is drawn on it: position, health bar, stun / slow / mark, and whether it is mid-cast;
//   - where it last saw the enemy, which it remembers.
// It never reads the enemy's cooldowns, mana, orders or anything about a hero it cannot see.
// Its dice come from the match's own seeded generator (g.rand), so a match with a bot replays exactly.
// All its tunable numbers are in RULES.bot (sim.js). Each character's plan is in PLANS below.
import { MAP, RULES, MINION, ITEM } from './sim.js';
import { plan, missing } from '../shared/shop.js';

const other = t => (t === 'blue' ? 'red' : 'blue');
const R = (arr, r) => arr[Math.min(r, arr.length - 1)];
const hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------------------------------------------------------------------------------------------
// What the bot knows this decision, plus the handful of actions every plan is built from.
function context(g, h) {
  const T = g.time, B = RULES.bot, cfg = B[h.ai], mem = h.aiMem, K = h.def.abilities;
  const foe = [...g.heroes.values()].find(o => o.team !== h.team && g.targetable(h, o)) || null;
  // How fast the enemy is moving, worked out from where it was the last time we looked.
  let vx = 0, vy = 0;
  if (foe && mem.seen && mem.seen.id === foe.id && T - mem.seen.t < 1 && T > mem.seen.t) { const dt = T - mem.seen.t; vx = (foe.x - mem.seen.x) / dt; vy = (foe.y - mem.seen.y) / dt; }
  mem.seen = foe ? { id: foe.id, x: foe.x, y: foe.y, t: T } : null;
  if (foe) mem.lastSeen = { x: foe.x, y: foe.y, t: T };
  const c = {
    g, h, T, B, cfg, mem, K, foe, vx, vy,
    dir: h.team === 'blue' ? 1 : -1,
    d: foe ? g.dist(h, foe) : Infinity,
    foeFrac: foe ? foe.hp / foe.mhp : 1,
    cmd: o => g.command(h.pid, o),
    rank: s => h.ranks[s] - 1,
    cost: s => R(K[s].cost, h.ranks[s] - 1),
    can: s => h.ranks[s] > 0 && h.cds[s] <= T && h.mp >= R(K[s].cost, h.ranks[s] - 1) && h.silenceUntil <= T,
    // Mana discipline for pokes: keep a reserve unless the hero has no mana at all.
    spare: s => !h.mmp || h.mp - R(K[s].cost, h.ranks[s] - 1) >= B.manaReserve * h.mmp,
    commit: () => g.rand() < cfg.commit,
    ready: () => T >= (mem.castAt || 0),                    // enough time since its last ability
    // Where the enemy will be in `t` seconds if it keeps going the way it is going.
    lead: t => ({ x: foe.x + vx * t, y: foe.y + vy * t }),
    // Turn an aim point by a random error, so its skillshots can be dodged.
    aim: p => { const d = hyp(p, h), an = Math.atan2(p.y - h.y, p.x - h.x) + (g.rand() * 2 - 1) * cfg.aimErr; return { x: h.x + Math.cos(an) * d, y: h.y + Math.sin(an) * d }; },
    // Is the straight path from the bot to point p free of enemy minions? (They would block a skillshot.)
    clear: (p, width, ignore) => {
      const len = hyp(p, h) || 1, ux = (p.x - h.x) / len, uy = (p.y - h.y) / len;
      for (const m of g.units.values()) {
        if (m.type !== 'minion' || m.team === h.team || m.dead || m === ignore) continue;
        const rx = m.x - h.x, ry = m.y - h.y, along = rx * ux + ry * uy;
        if (along > 0 && along < len - 20 && Math.abs(rx * uy - ry * ux) <= width / 2 + m.radius) return false;
      }
      return true;
    },
    // Cast ability s at point p. Returns true if it went off (the rules may refuse it).
    cast: (s, p) => {
      const before = h.cds[s], state = h.state, casting = h.casting;
      g.command(h.pid, { c: 'cast', s, x: p ? p.x : h.x, y: p ? p.y : h.y });
      const ok = h.cds[s] !== before || h.state !== state || h.casting !== casting;
      if (ok) mem.castAt = T + cfg.castGap;
      return ok;
    },
    attack: t => { g.command(h.pid, { c: 'atk', id: t.id }); return true; },
    underFoeTower: u => hyp(u, g.frontTower(other(h.team))) <= RULES.tower.range + RULES.tower.radius + B.towerMargin,
    casting: u => !!(u.casting || u.state),                 // a visible cast or channel animation
    slowed: u => g.buffMax(u, 'slow') > 0,
  };
  c.foeLow = foe && c.foeFrac < B.lowHp;
  c.foeFinish = foe && c.foeFrac < B.finishHp;
  return c;
}

// ---------------------------------------------------------------------------------------------
// One plan per character. Each can define:
//   state(c)  - what to do while one of its own abilities holds it in a state (charging, barrage, channel)
//   fight(c)  - abilities and attacks aimed at the enemy hero; returns true if it did something
//   farm(c)   - extra ways of last-hitting or using the wave; returns true if it did something
//   escape(c) - an extra move while running away at low health
const PLANS = {
  kessa: {
    state(c) {
      const { h, K, T, foe, mem } = c, st = h.state;
      if (st.name === 'charging') {
        // Release once the (led) target is inside the range the charge has reached, or just before it would cancel.
        const ch = K[0].charge, reach = ch.min + (ch.max - ch.min) * Math.min(1, (T - st.t0) / ch.full);
        const target = foe ? c.lead(ch.delay) : mem.lastSeen;
        if (!target) return;
        if (hyp(target, h) <= reach - c.B.reachMargin || T - st.t0 >= ch.hold - 0.5) c.cmd({ c: 'cast', s: 0, ...c.aim(target) });
      } else if (st.name === 'barrage') {
        // Fire every shot at where the target will be when it lands; give up if the target has been gone a while.
        const target = foe ? c.lead(K[3].delay) : mem.lastSeen && T - mem.lastSeen.t < c.B.forget ? mem.lastSeen : null;
        if (!target) return c.cmd({ c: 'stop' });
        if (T >= st.next) c.cmd({ c: 'cast', s: 3, ...c.aim(target) });
      }
    },
    fight(c) {
      const { h, K, foe, d } = c;
      if (!foe || !c.ready()) return false;
      if (c.can(3) && c.foeLow && d <= R(K[3].range, c.rank(3)) && c.commit()) return c.cast(3);
      if (!c.safe) return false;
      if (c.can(2) && d <= K[2].range * c.B.pokeReach) { const p = c.lead(K[2].castTime + d / K[2].speed); if (c.clear(p, K[2].width)) return c.cast(2, c.aim(p)); }
      if (c.can(1) && c.spare(1) && d <= K[1].range) return c.cast(1, c.aim(c.lead(K[1].castTime + K[1].delay)));
      if (c.can(0) && c.spare(0) && c.T >= (c.mem.qAt || 0) && d <= K[0].charge.max * c.B.pokeReach) {
        c.mem.qAt = c.T + c.cfg.qEvery * (0.7 + 0.6 * c.g.rand()); c.cmd({ c: 'charge', s: 0 });
        return !!h.state;
      }
      return false;
    },
    farm(c) {
      // The passive hands back mana on her next attack: spend it on a minion already in reach.
      const { g, h } = c;
      if (h.def.passive.wait(g, h) > 0 || h.mp > h.mmp * c.B.passiveBelow) return false;
      const m = g.nearestEnemy(h, h.range + h.radius, u => u.type === 'minion');
      return m ? c.attack(m) : false;
    },
  },

  gorrum: {
    fight(c) {
      const { g, h, K, foe, d, mem, T } = c;
      if (!foe) return false;
      if (c.can(3) && d <= K[3].radius - c.B.reachMargin && (c.foeLow || c.casting(foe)) && c.commit()) return c.cast(3);
      if (!c.safe) return false;
      const reach = h.range + h.radius + foe.radius;
      if (foe.stunUntil > T && d <= reach + c.B.engageSlack) mem.engageUntil = T + c.B.engageFor;      // a hook landed: follow it up
      if (mem.engageUntil > T && d <= reach + c.B.engageSlack) { if (c.can(2)) c.cast(2); return c.attack(foe); }
      // Chase a low enemy that is running away.
      const fleeing = (c.vx * (foe.x - h.x) + c.vy * (foe.y - h.y)) / (d || 1) > c.B.fleeSpeed;
      if (c.can(1) && c.foeLow && fleeing && d > reach && d <= c.B.chaseRange && c.commit()) { c.cast(1); mem.engageUntil = T + c.B.engageFor; return c.attack(foe); }
      if (!c.ready()) return false;
      if (c.can(0) && c.spare(0) && T >= (mem.qAt || 0) && d <= K[0].range * c.B.pokeReach) {
        const p = c.lead(K[0].castTime + d / K[0].speed);
        if (c.clear(p, K[0].width) && c.clear(foe, K[0].width)) { mem.qAt = T + c.cfg.qEvery * (0.7 + 0.6 * c.g.rand()); return c.cast(0, c.aim(p)); }
      }
      return false;
    },
    escape(c) { if (c.foe && c.d <= c.B.chaseRange && c.can(1)) c.cast(1); },
  },

  wren: {
    fight(c) {
      const { g, h, K, foe, d, mem, T } = c;
      if (!foe) return false;
      const marked = foe.mark && foe.mark.by === h.id && foe.mark.until > T;
      // A low enemy anywhere it can see is a target for the map-wide wave.
      if (c.can(3) && c.foeFinish && c.ready() && c.commit()) return c.cast(3, c.aim(c.lead(K[3].castTime + d / K[3].speed)));
      if (!c.safe) return false;
      // Burst a mark as soon as possible: Compass Bolt if the way is clear, otherwise an attack.
      if (marked) {
        if (c.can(0)) { const p = c.lead(K[0].castTime + d / K[0].speed); if (d <= K[0].range && c.clear(p, K[0].width)) return c.cast(0, c.aim(p)); }
        if (g.inRange(h, foe)) return c.attack(foe);
      }
      // Step in to finish a low enemy, if the bolt would go for it rather than a minion.
      if (c.can(2) && c.foeFinish && d <= K[2].range + K[2].seek * c.B.pokeReach && c.ready() && c.commit()) {
        const step = Math.min(K[2].range, Math.max(0, d - h.range)), p = { x: h.x + (foe.x - h.x) / d * step, y: h.y + (foe.y - h.y) / d * step };
        const closer = [...g.units.values()].some(m => m.type === 'minion' && m.team !== h.team && !m.dead && hyp(m, p) - m.radius < hyp(foe, p) - foe.radius);
        if (marked || !closer) return c.cast(2, p);
      }
      if (!c.ready()) return false;
      if (c.can(1) && c.spare(1) && d <= K[1].range * c.B.pokeReach) { const p = c.lead(K[1].castTime + d / K[1].speed); if (c.clear(p, K[1].width)) return c.cast(1, c.aim(p)); }
      if (c.can(0) && c.spare(0) && T >= (mem.qAt || 0) && d <= K[0].range * c.B.pokeReach) {
        const p = c.lead(K[0].castTime + d / K[0].speed);
        if (c.clear(p, K[0].width)) { mem.qAt = T + c.cfg.qEvery * (0.7 + 0.6 * c.g.rand()); return c.cast(0, c.aim(p)); }
      }
      return false;
    },
    farm(c) {
      // Compass Bolt last-hits a minion her attack cannot get to in time.
      const { g, h, K, T } = c;
      if (!c.can(0) || !c.spare(0) || !c.ready()) return false;
      const dmg = R(K[0].dmg, c.rank(0)) + K[0].adRatio * h.ad + K[0].ap * h.ap;
      for (const m of g.units.values()) {
        if (m.type !== 'minion' || m.team === h.team || m.dead || !c.judge(m)) continue;
        const dist = g.dist(h, m), gap = dist - m.radius - h.radius - h.range;
        if (gap < c.B.boltGap || dist > K[0].range * c.B.pokeReach || m.hp > dmg * c.judge(m)) continue;
        if (m.hp - c.incoming(m) * (K[0].castTime + dist / K[0].speed) <= 0 || !c.clear(m, K[0].width, m)) continue;
        return c.cast(0, m);
      }
      return false;
    },
    escape(c) { if (c.foe && c.d <= c.B.escapeRange && c.can(2)) c.cast(2, { x: c.h.x - c.dir * c.K[2].range, y: MAP.mid }); },
  },

  sable: {
    fight(c) {
      const { g, h, K, foe, d, mem, T } = c;
      if (!foe) return false;
      if (c.can(3) && d <= K[3].castRange * c.B.pokeReach && (c.foeLow || foe.stunUntil > T || c.slowed(foe)) && c.commit()) return c.cast(3);
      // What one combo should do: Q, E and a couple of attacks, discounted for the enemy's resistances.
      const combo = (R(K[0].dmg, c.rank(0)) + R(K[2].dmg, c.rank(2)) + K[2].adRatio * h.ad + c.B.comboAttacks * h.ad) * c.B.comboTrust;
      if (!c.safe && foe.hp > combo) { mem.allInUntil = 0; return false; }     // under the enemy tower only for a kill
      // A landed blade next to the enemy: step to it, which picks it up and slashes.
      const slash = g.pickups.find(b => b.owner === h && b.kind === 'blade' && T >= b.at && hyp(b, foe) <= c.B.bladeNear && hyp(b, h) <= K[2].range);
      if (slash && c.can(2)) return c.cast(2, slash);
      // All in when the enemy is low, or when one combo should kill it. The decision is made once and kept for a while.
      if (!(mem.allInUntil > T) && (c.foeLow || foe.hp <= combo) && h.hp / h.mhp > c.B.retreatHp + c.B.allInMargin && T >= (mem.allInTry || 0)) {
        mem.allInTry = T + c.B.allInRetry; if (c.commit()) mem.allInUntil = T + c.B.allInFor;
      }
      const reach = h.range + h.radius + foe.radius;
      if (mem.allInUntil > T) {
        if (c.can(1) && d > reach) c.cast(1);                                  // Toss & Twirl first: speed, and a blade for later
        if (c.can(2) && d > reach && d <= K[2].range) c.cast(2, foe);
        if (c.can(0) && d <= K[0].range + foe.radius) c.cast(0, foe);
        return c.attack(foe);
      }
      if (c.can(0) && c.ready() && T >= (mem.qAt || 0) && d <= K[0].range + foe.radius) { mem.qAt = T + c.cfg.qEvery * (0.5 + 0.5 * c.g.rand()); return c.cast(0, foe); }
      return false;
    },
  },

  // Oriel's kit was not part of the bot brief; she gets the plain version: skillshots when the way is clear,
  // the zone where the enemy is heading, and the big one on a low enemy.
  oriel: {
    fight(c) {
      const { K, foe, d, mem, T } = c;
      if (!foe || !c.safe || !c.ready()) return false;
      if (c.can(3) && c.foeLow && d <= K[3].range && c.commit()) return c.cast(3, c.aim(c.lead(K[3].castTime + c.B.zoneDelay)));
      if (c.can(2) && c.spare(2) && d <= K[2].range * c.B.pokeReach) { const p = c.lead(K[2].castTime + d / c.B.shotSpeed); if (c.clear(p, K[2].width)) return c.cast(2, c.aim(p)); }
      if (c.can(1) && c.spare(1) && d <= K[1].range) return c.cast(1, c.aim(c.lead(K[1].castTime + c.B.zoneDelay)));
      if (c.can(0) && c.spare(0) && T >= (mem.qAt || 0) && d <= K[0].range * c.B.pokeReach) {
        const p = c.lead(K[0].castTime + d / c.B.shotSpeed);
        if (c.clear(p, K[0].width)) { mem.qAt = T + c.cfg.qEvery * (0.7 + 0.6 * c.g.rand()); return c.cast(0, c.aim(p)); }
      }
      return false;
    },
  },
};

// ---------------------------------------------------------------------------------------------
// Hard only: step out of the way of a skillshot or telegraphed area it can see coming.
// Returns the point to walk to, 'hold' if it is just clear and should stay put until the danger has passed,
// or null if nothing is coming.
function dodge(c) {
  const { g, h, B, T } = c, safe = h.radius + B.dodgeMargin;
  const side = (ox, oy, dx, dy, len, half) => {              // is the bot inside this strip? if so, which way out
    const rx = h.x - ox, ry = h.y - oy, along = rx * dx + ry * dy, off = rx * dy - ry * dx;
    const clear = half + safe + B.dodgeExtra;
    if (along < -safe || along > len + safe || Math.abs(off) > clear + B.dodgeMargin) return null;
    if (Math.abs(off) > half + safe) return 'hold';
    const s = off >= 0 ? 1 : -1, go = clear - Math.abs(off);
    return { x: h.x + dy * s * go, y: h.y - dx * s * go };
  };
  for (const s of g.shots) {
    if (s.kind !== 'line' || s.team === h.team) continue;
    const p = side(s.x, s.y, s.dx, s.dy, Math.min(s.left, s.speed * B.dodgeAhead), s.w / 2);
    if (p) return p;
  }
  for (const z of g.zones) {
    if (z.team === h.team || z.at - T > B.dodgeAhead) continue;
    if (z.shape === 'line') { const p = side(z.x, z.y, z.dx, z.dy, z.len, z.w / 2); if (p) return p; continue; }
    const d = hyp(z, h); if (d > z.r + safe + B.dodgeExtra + B.dodgeMargin) continue;
    if (d > z.r + safe) return 'hold';
    const ux = d > 1 ? (h.x - z.x) / d : -c.dir, uy = d > 1 ? (h.y - z.y) / d : 0, go = z.r + safe + B.dodgeExtra;
    return { x: z.x + ux * go, y: z.y + uy * go };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Shopping, with the same buy and sell commands a player uses. It follows the hero's recommended build:
// the opening items once, then for each step the item itself if it can pay for it, otherwise the cheapest
// part of it that it can pay for.
function shop(g, h, cmd) {
  const B = RULES.bot, mem = h.aiMem, build = h.def.build || [];
  const foe = [...g.heroes.values()].find(o => o.team !== h.team);          // who it is up against is on the scoreboard
  const pick = st => (typeof st === 'string' || Array.isArray(st) ? st : st[foe && foe.def.dmgType === 'attack' ? 'attack' : 'ability']);
  const owns = id => h.items.some(s => s.id === id), count = id => h.items.filter(s => s.id === id).reduce((n, s) => n + s.n, 0);
  if (!mem.opened) { mem.opened = true; mem.step = 1; for (const id of [].concat(pick(build[0] || []))) cmd({ c: 'buy', item: id }); return; }
  const finished = h.items.filter(s => ITEM[s.id].tier === 'finished').length;
  if (finished < B.potionsUntilFinished && count('potion') < B.keepPotions) cmd({ c: 'buy', item: 'potion' });
  while (mem.step < build.length && owns(pick(build[mem.step]))) mem.step++;
  const target = mem.step < build.length ? pick(build[mem.step]) : null;
  if (!target) return;
  let p = plan(ITEM, h.items, target);
  if (!p.ok && p.why === 'No free slot' && h.gold >= p.price && !h.dead) {    // make room: the starter item goes first
    const starter = h.items.findIndex(s => ITEM[s.id].group === 'starter');
    if (starter >= 0) { cmd({ c: 'sell', i: starter }); p = plan(ITEM, h.items, target); }
  }
  if (p.ok && h.gold >= p.price) return cmd({ c: 'buy', item: target });
  const part = missing(ITEM, h.items, target).map(id => ({ id, p: plan(ITEM, h.items, id) })).filter(c => c.p.ok && c.p.price <= h.gold).sort((a, b) => a.p.price - b.p.price)[0];
  if (part) cmd({ c: 'buy', item: part.id });
}

// ---------------------------------------------------------------------------------------------
export function think(g, h) {
  const T = g.time, B = RULES.bot, cfg = B[h.ai], mem = h.aiMem;
  if (T < (mem.next || 0)) return;
  mem.next = T + cfg.react;
  const cmd = o => g.command(h.pid, o);
  const dir = h.team === 'blue' ? 1 : -1, home = MAP.spawn[h.team], tower = g.frontTower(h.team), foeTower = g.frontTower(other(h.team));
  const atHome = g.dist(h, home) <= MAP.fountainR;

  // Skill points and shopping (the shop only works at base or while dead, as for a player).
  if (h.points) for (const s of [3, 0, 1, 2]) cmd({ c: 'lvl', s });
  if (h.dead || atHome) shop(g, h, cmd);
  if (h.dead) return;
  // Drink a potion (or the flask) when hurt and not already drinking.
  if (h.hp / h.mhp < B.drinkBelow && !h.potQ.length) { const i = h.items.findIndex(s => ITEM[s.id].use && s.n > 0); if (i >= 0) cmd({ c: 'use', i }); }

  const c = context(g, h), plan = PLANS[h.hero] || {}, foe = c.foe;
  c.safe = !c.underFoeTower(h);

  // Held in one of its own abilities (a charge, a barrage, a channel): only that ability's plan runs.
  if (h.state) { if (plan.state) plan.state(c); return; }
  if (h.recall || h.casting || h.dashing) return;                           // busy: let it finish
  if (cfg.dodge) { const p = dodge(c); if (p) return p === 'hold' ? cmd({ c: 'stop' }) : cmd({ c: 'move', x: p.x, y: p.y }); }
  if (h.windup) return;                                                     // mid-attack: let it land

  // Low health: back off behind the tower, recall once nothing is near, and stay home until healed.
  const hpFrac = h.hp / h.mhp;
  if (hpFrac < B.retreatHp) mem.heal = true;
  if (mem.heal && atHome) {
    if (hpFrac >= B.returnHp) mem.heal = false; else return cmd({ c: 'stop' });
  }
  if (mem.heal) {
    const safe = (!foe || g.dist(h, foe) > B.safeDist) && !g.enemiesIn(h.team, h.x, h.y, B.safeMinions).length;
    if (safe) return cmd({ c: 'recall' });
    if (plan.escape) plan.escape(c);
    return cmd({ c: 'move', x: tower.x - dir * B.retreatBehind, y: MAP.mid });
  }

  // An opening on the enemy hero (low, stunned, marked, or already committed) comes before the wave.
  const opening = foe && (c.foeLow || foe.stunUntil > T || (foe.mark && foe.mark.by === h.id) || mem.engageUntil > T || mem.allInUntil > T);
  if (opening && plan.fight && plan.fight(c)) return;

  // Last hit: attack a minion when one attack will kill it by the time the attack lands.
  const noise = mem.noise || (mem.noise = new Map());
  // How well it judges a minion: a factor on the damage it thinks it will do; 0 means it never tries for it.
  c.judge = m => { if (!noise.has(m.id)) noise.set(m.id, g.rand() < cfg.skip ? 0 : 1 + (g.rand() * 2 - 1) * cfg.hitErr); return noise.get(m.id); };
  // What a minion's other attackers will do to it per second.
  c.incoming = m => {
    let dps = 0;
    for (const u of g.units.values()) {
      if (u.team !== h.team || u.dead || u === h || g.attacking(u) !== m) continue;
      const k = MINION[m.kind] || {}, mine = MINION[u.kind] || {};
      if (u.type === 'tower') dps += (k.towerShot ? k.towerShot * m.mhp : u.ad) * u.as;
      else if (u.type === 'minion') dps += (u.ad + (mine.vsMinionHp || 0) * m.hp) * u.as;
    }
    return dps;
  };
  let pick = null, pickAt = Infinity, prep = null;
  for (const m of g.units.values()) {
    if (m.type !== 'minion' || m.team === h.team || m.dead) continue;
    const gap = g.dist(h, m) - m.radius - h.radius - h.range;
    if (gap > B.chase) continue;
    const land = Math.max(0, gap) / g.speed(h) + Math.max(0, h.nextAttack - T) + h.windupFrac / g.atkSpeed(h) + (h.melee ? 0 : g.dist(h, m) / h.projSpeed);
    const k = c.judge(m); if (!k) continue;
    if (m.hp - c.incoming(m) * land <= h.ad * k && land < pickAt) { pick = m; pickAt = land; }
    if (m.hp < m.mhp * B.prepHp && (!prep || m.hp < prep.hp)) prep = m;
  }
  if (noise.size > 80) for (const id of noise.keys()) if (!g.units.has(id)) noise.delete(id);
  if (pick) return cmd({ c: 'atk', id: pick.id });
  if (plan.farm && plan.farm(c)) return;
  if (!opening && plan.fight && plan.fight(c)) return;
  // Nothing to hit yet: step up to attack range of the lowest minion, so the attack lands sooner when it is time.
  if (prep && !c.underFoeTower(prep)) {
    const d = g.dist(h, prep), want = h.range + prep.radius + h.radius - 30;
    if (d > want + 20) return cmd({ c: 'move', x: prep.x + (h.x - prep.x) / d * want, y: prep.y + (h.y - prep.y) / d * want });
    return h.order && h.order.type === 'hold' ? null : cmd({ c: 'stop' });
  }

  // Trade: sometimes hit the player back when they come into range (to last-hit, usually).
  if (foe && c.safe) {
    const inRange = g.inRange(h, foe, B.tradeReach);
    if (mem.tradeUntil > T && inRange) return cmd({ c: 'atk', id: foe.id });
    if (inRange && g.rand() < cfg.trade * cfg.react) { mem.tradeUntil = T + B.tradeFor; return cmd({ c: 'atk', id: foe.id }); }
  }

  // Otherwise wait at a safe spot: a little behind its most advanced minion and off to one side, never
  // further back than its own tower and never inside the enemy tower's range.
  let front = null;
  for (const m of g.units.values()) if (m.type === 'minion' && m.team === h.team && !m.dead && (!front || dir * m.x > dir * front.x)) front = m;
  const post = tower.x + dir * B.retreatBehind, limit = foeTower.x - dir * (RULES.tower.range + RULES.tower.radius + B.towerMargin + 40);
  let x = front ? front.x - dir * (h.melee ? B.standMelee : B.standRanged) : post;
  x = dir > 0 ? Math.min(Math.max(x, post), limit) : Math.max(Math.min(x, post), limit);
  const y = MAP.mid + B.standOff * (h.id % 2 ? 1 : -1);
  if (Math.hypot(x - h.x, y - h.y) > 70) cmd({ c: 'move', x, y });
  else if (!h.order || h.order.type !== 'hold') cmd({ c: 'stop' });
}
