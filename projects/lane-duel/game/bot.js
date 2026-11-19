// Practice opponent: an enemy hero that plays the lane.
//
// It plays by the player's rules. Everything it does goes through g.command(), the same call a browser's
// input ends up in, so cooldowns, mana, range and stuns apply to it exactly as they do to a player. It
// only looks at what a player could see on screen: minions, and the enemy hero when g.targetable() says
// it is visible (not hidden in brush). All its tunable numbers are in RULES.bot (sim.js).
import { MAP, RULES, MINION } from './sim.js';

const other = t => (t === 'blue' ? 'red' : 'blue');

export function think(g, h) {
  const T = g.time, B = RULES.bot, cfg = B[h.ai], mem = h.aiMem;
  if (T < (mem.next || 0)) return;
  mem.next = T + cfg.react;
  const cmd = c => g.command(h.pid, c);
  const dir = h.team === 'blue' ? 1 : -1, home = MAP.spawn[h.team], tower = g.frontTower(h.team), foeTower = g.frontTower(other(h.team));
  const atHome = g.dist(h, home) <= MAP.fountainR;

  // Skill points and shopping (the shop only works at base or while dead, as for a player).
  if (h.points) for (const s of [3, 0, 1, 2]) cmd({ c: 'lvl', s });
  if (h.dead || atHome) {
    const next = (h.def.botBuild || [])[mem.bought || 0], n = h.items.length;
    if (next) { cmd({ c: 'buy', item: next }); if (h.items.length > n) mem.bought = (mem.bought || 0) + 1; }
  }
  if (h.dead) return;

  // The enemy hero, if visible, and how fast it is moving (worked out from where it was last time we looked).
  const foe = [...g.heroes.values()].find(o => o.team !== h.team && g.targetable(h, o)) || null;
  let vx = 0, vy = 0;
  if (foe && mem.seen && mem.seen.id === foe.id && T - mem.seen.t < 1) { const dt = T - mem.seen.t; vx = (foe.x - mem.seen.x) / dt; vy = (foe.y - mem.seen.y) / dt; }
  mem.seen = foe ? { id: foe.id, x: foe.x, y: foe.y, t: T } : null;
  // Where to aim a skillshot: lead the target, then turn the aim by a random error so it can be dodged.
  const aimAt = lead => {
    const tx = foe.x + vx * lead, ty = foe.y + vy * lead, d = Math.hypot(tx - h.x, ty - h.y);
    const an = Math.atan2(ty - h.y, tx - h.x) + (Math.random() * 2 - 1) * cfg.aimErr;
    return { x: h.x + Math.cos(an) * d, y: h.y + Math.sin(an) * d };
  };

  // A charged Q is released once it has charged far enough to reach.
  if (h.state && h.state.name === 'charging') {
    if (T >= mem.release) cmd({ c: 'cast', s: 0, ...(foe ? aimAt(0.4) : mem.aim) });
    return;
  }
  if (h.recall || h.state || h.casting || h.dashing || h.windup) return;   // busy: let it finish

  // Low health: back off behind the tower, recall once nothing is near, and stay home until healed.
  const hpFrac = h.hp / h.mhp;
  if (hpFrac < B.retreatHp) mem.heal = true;
  if (mem.heal && atHome) {
    if (hpFrac >= B.returnHp) mem.heal = false; else return cmd({ c: 'stop' });
  }
  if (mem.heal) {
    const safe = (!foe || g.dist(h, foe) > B.safeDist) && !g.enemiesIn(h.team, h.x, h.y, B.safeMinions).length;
    return safe ? cmd({ c: 'recall' }) : cmd({ c: 'move', x: tower.x - dir * B.retreatBehind, y: MAP.mid });
  }

  // Last hit: attack a minion when one attack will kill it by the time the attack lands.
  const underFoeTower = u => g.dist(u, foeTower) <= RULES.tower.range + B.towerMargin;
  const noise = mem.noise || (mem.noise = new Map());
  let pick = null, pickAt = Infinity, prep = null;
  for (const m of g.units.values()) {
    if (m.type !== 'minion' || m.team === h.team || m.dead) continue;
    const gap = g.dist(h, m) - m.radius - h.radius - h.range;
    if (gap > B.chase) continue;
    const land = Math.max(0, gap) / g.speed(h) + Math.max(0, h.nextAttack - T) + h.windupFrac / g.atkSpeed(h) + (h.melee ? 0 : g.dist(h, m) / h.projSpeed);
    let dps = 0;                                   // what its other attackers will do to it in the meantime
    for (const u of g.units.values()) {
      if (u.team !== h.team || u.dead || u === h || g.attacking(u) !== m) continue;
      const k = MINION[m.kind] || {}, mine = MINION[u.kind] || {};
      if (u.type === 'tower') dps += (k.towerShot ? k.towerShot * m.mhp : u.ad) * u.as;
      else if (u.type === 'minion') dps += (u.ad + (mine.vsMinionHp || 0) * m.hp) * u.as;
    }
    // How well it judges this minion: k scales the damage it thinks it will do; 0 means it never tries for it.
    if (!noise.has(m.id)) noise.set(m.id, Math.random() < cfg.skip ? 0 : 1 + (Math.random() * 2 - 1) * cfg.hitErr);
    const k = noise.get(m.id); if (!k) continue;
    if (m.hp - dps * land <= h.ad * k && land < pickAt) { pick = m; pickAt = land; }
    if (m.hp < m.mhp * B.prepHp && (!prep || m.hp < prep.hp)) prep = m;
  }
  if (noise.size > 80) for (const id of noise.keys()) if (!g.units.has(id)) noise.delete(id);
  if (pick) return cmd({ c: 'atk', id: pick.id });
  // Nothing to hit yet: step up to attack range of the lowest minion, so the attack lands sooner when it is time.
  if (prep && !underFoeTower(prep)) {
    const d = g.dist(h, prep), want = h.range + prep.radius + h.radius - 30;
    if (d > want + 20) return cmd({ c: 'move', x: prep.x + (h.x - prep.x) / d * want, y: prep.y + (h.y - prep.y) / d * want });
    return h.order && h.order.type === 'hold' ? null : cmd({ c: 'stop' });
  }

  if (foe && !underFoeTower(h)) {
    // Trade: sometimes hit the player back when they come into range (to last-hit, usually).
    const inRange = g.inRange(h, foe, B.tradeReach);
    if (mem.tradeUntil > T && inRange) return cmd({ c: 'atk', id: foe.id });
    if (inRange && Math.random() < cfg.trade * cfg.react) { mem.tradeUntil = T + B.tradeFor; return cmd({ c: 'atk', id: foe.id }); }
    // Q at the player every so often.
    const def = h.def.abilities[0], rank = h.ranks[0];
    if (rank > 0 && T >= (mem.qAt || 0) && h.cds[0] <= T && h.mp >= def.cost[Math.min(rank - 1, def.cost.length - 1)]) {
      const d = g.dist(h, foe), reach = (def.charge ? def.charge.max : def.range) * 0.9;
      if (d <= reach) {
        mem.qAt = T + cfg.qEvery * (0.7 + 0.6 * Math.random());
        if (def.charge) {
          const c = def.charge, need = Math.max(0, Math.min(1, (d + 80 - c.min) / (c.max - c.min)));
          mem.release = T + c.full * need + 0.15; mem.aim = { x: foe.x, y: foe.y };
          return cmd({ c: 'charge', s: 0 });
        }
        return cmd({ c: 'cast', s: 0, ...aimAt((def.castTime || 0) + d / 1700) });
      }
    }
  }

  // Otherwise wait at a safe spot: a little behind its most advanced minion and off to one side, never
  // further back than its own tower and never inside the enemy tower's range.
  let front = null;
  for (const m of g.units.values()) if (m.type === 'minion' && m.team === h.team && !m.dead && (!front || dir * m.x > dir * front.x)) front = m;
  const post = tower.x + dir * B.retreatBehind, limit = foeTower.x - dir * (RULES.tower.range + B.towerMargin + 40);
  let x = front ? front.x - dir * (h.melee ? B.standMelee : B.standRanged) : post;
  x = dir > 0 ? Math.min(Math.max(x, post), limit) : Math.max(Math.min(x, post), limit);
  const y = MAP.mid + B.standOff * (h.id % 2 ? 1 : -1);
  if (Math.hypot(x - h.x, y - h.y) > 70) cmd({ c: 'move', x, y });
  else if (!h.order || h.order.type !== 'hold') cmd({ c: 'stop' });
}
