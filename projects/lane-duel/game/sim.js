// Authoritative game simulation. No networking in here.
import { HEROES, SPELLS, ITEMS } from './data.js';
import { think } from './bot.js';

export const TICK = 30, DT = 1 / TICK;
// Lane geometry. Minions spawn `minionOffset` in front of their base, so the first melee minions of each
// side each walk (red spawn - blue spawn - 2 * minionOffset) / 2 = 8200 units and meet about 25s after
// spawning at move speed 325. Each tower is 1300 from the middle of the lane (x = 9000).
export const MAP = {
  w: 18000, h: 1600, top: 220, bot: 1380, mid: 800, edge: 60,
  spawn: { blue: { x: 420, y: 800 }, red: { x: 17580, y: 800 } }, minionOffset: 380,
  tower: { blue: { x: 7700, y: 800 }, red: { x: 10300, y: 800 } },
  fountainR: 520, fountainBurn: 400,
  brush: [
    { x: 8300, y: 220, w: 1400, h: 190 },
    { x: 8300, y: 1190, w: 1400, h: 190 },
  ],
};
export const RULES = {
  kills: 2, cs: 100, firstWave: 30, startGold: 500, goldPerSec: 2,
  // Tower. Its damage to minions is a share of the minion's max health (MINION.*.towerShot); `ad` is what
  // heroes and cannon minions take, rising by heatPerShot for each shot in a row on a hero.
  tower: { hp: 2500, ad: 150, armor: 40, mr: 40, range: 775, as: 0.83, windupT: 0.15, projSpeed: 1300, radius: 90,
    heatPerShot: 0.4, maxHeat: 3, guardRange: 900, guardedMult: 0.33 },
  // Collision between heroes and minions: circles of these radii push apart. heroShare is how much of the push
  // the hero takes (1 = minions hold their ground); slide is how strongly a blocked hero is steered around.
  collision: { hero: 34, minion: 26, heroShare: 1, slide: 1, detourFor: 1 },
  // Practice bot. react = seconds between decisions; hitErr = how far off its judgement of "one attack will
  // kill it" can be; skip = share of minions it does not try for at all; trade = chance per second of
  // attacking a player in range; qEvery = seconds between Q casts; aimErr = aim error in radians.
  bot: {
    easy:   { react: 0.35, hitErr: 0.30, skip: 0.45, trade: 0.12, qEvery: 10, aimErr: 0.30 },
    normal: { react: 0.20, hitErr: 0.12, skip: 0.20, trade: 0.35, qEvery: 6.5, aimErr: 0.14 },
    hard:   { react: 0.10, hitErr: 0.03, skip: 0, trade: 0.70, qEvery: 4.5, aimErr: 0.05 },
    retreatHp: 0.35, returnHp: 0.9, safeDist: 1300, safeMinions: 650, retreatBehind: 250,
    chase: 600, prepHp: 0.5, standRanged: 350, standMelee: 200, standOff: 140, tradeFor: 1.2, tradeReach: 60, towerMargin: 120,
  },
};
// Minions. Times are in seconds of game time.
export const WAVES = {
  every: t => (t < 840 ? 30 : t < 1800 ? 25 : 20),                    // gap to the next wave
  cannon: (n, t) => (t < 840 ? n % 3 === 0 : t < 1500 ? n % 2 === 0 : true),   // is wave n a cannon wave?
  stagger: 0.8,                                                       // seconds between minions in a wave
  upgradeEvery: 90, hpPerUpgrade: 0.045, adPerUpgrade: 0.03,          // newly spawned minions grow over time
  vsHero: 0.6, vsTower: 0.6,                                          // damage dealt: x0.6 to heroes and to towers (bonus vs minions is per type, below)
  sight: 500, keep: 750, helpRange: 1000, look: 0.5, xpRange: 1500,
};
// vsMinionHp: bonus damage to other minions, as a share of the target's CURRENT health.
// towerShot: share of this minion's MAX health one tower shot removes (0 = the tower's normal damage).
export const MINION = {
  melee:  { hp: 480, ad: 12, range: 110, as: 1.25, windupT: 0.3, radius: 32, gold: 20, xp: 60, projSpeed: 0, vsMinionHp: 0.02, towerShot: 0.45 },
  caster: { hp: 290, ad: 23, range: 550, as: 0.67, windupT: 0.4, radius: 32, gold: 14, xp: 30, projSpeed: 650, vsMinionHp: 0.035, towerShot: 0.7 },
  cannon: { hp: 900, ad: 41, range: 300, as: 1.0, windupT: 0.35, radius: 42, gold: 60, xp: 93, projSpeed: 1200, vsMinionHp: 0.05, towerShot: 0 },
};

const other = t => (t === 'blue' ? 'red' : 'blue');
const xpToNext = lvl => 180 + 100 * lvl;
const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));

export class Game {
  constructor(players) {
    this.time = 0; this.nextId = 1; this.units = new Map(); this.shots = []; this.zones = []; this.pickups = [];
    this.events = []; this.over = null; this.nextWave = RULES.firstWave; this.waveNo = 0; this.spawnQ = []; this.wavesMet = false; this.heroes = new Map();
    for (const team of ['blue', 'red']) {
      const p = MAP.tower[team];
      const t = RULES.tower;
      this.add({ type: 'tower', team, x: p.x, y: p.y, radius: t.radius, hp: t.hp, mhp: t.hp, ad: t.ad, armor: t.armor, mr: t.mr,
        range: t.range, as: t.as, windupT: t.windupT, projSpeed: t.projSpeed, melee: false, heat: 0 });
    }
    for (const p of players) this.addHero(p);
  }

  // ---------- setup ----------
  add(u) {
    u.id = this.nextId++; u.buffs = []; u.atkId = 0; u.atkAt = -9; u.nextAttack = 0; u.windup = null; u.dead = false;
    u.stunUntil = 0; u.rootUntil = 0; u.silenceUntil = 0; u.airUntil = 0; u.shieldAmt = 0; u.shieldUntil = 0; u.face = u.team === 'blue' ? 0 : Math.PI;
    this.units.set(u.id, u); return u;
  }
  addHero(p) {
    const d = HEROES[p.hero], s = MAP.spawn[p.team];
    const h = this.add({ type: 'hero', team: p.team, pid: p.id, name: p.name, hero: p.hero, def: d, x: s.x, y: s.y,
      radius: 55, melee: d.melee, projSpeed: d.projSpeed, lvl: 1, xp: 0, points: 1, ranks: [0, 0, 0, 0],
      cds: [0, 0, 0, 0], spellCds: { d: 0, f: 0 }, gold: RULES.startGold, items: [], kills: 0, deaths: 0, cs: 0, missed: 0,
      order: null, casting: null, dashing: null, recall: null, state: null, respawnAt: 0, revealUntil: 0, bot: !!p.bot, ai: p.ai || null, aiMem: {},
      potionUntil: 0 });
    this.refresh(h); h.hp = h.mhp; h.mp = h.mmp; this.heroes.set(p.id, h); return h;
  }
  refresh(h) {
    const d = h.def, L = h.lvl - 1, it = { ad: 0, ap: 0, hp: 0, as: 0, armor: 0, mr: 0, ms: 0, mana: 0 };
    for (const id of h.items) for (const [k, v] of Object.entries(ITEM[id].stats || {})) it[k] += v;
    const oldHp = h.mhp || 0, oldMp = h.mmp || 0;
    h.mhp = d.hp + d.hpPer * L + it.hp; h.mmp = d.mana + d.manaPer * L + it.mana;
    h.ad = d.ad + d.adPer * L + it.ad; h.ap = it.ap; h.armor = d.armor + d.armorPer * L + it.armor;
    h.mr = d.mr + d.mrPer * L + it.mr; h.baseMs = d.ms + it.ms; h.range = d.range;
    h.as = d.as * (1 + (d.asPer * L + it.as) / 100); h.windupFrac = d.windup;
    if (oldHp) { h.hp += h.mhp - oldHp; h.mp += h.mmp - oldMp; }
  }

  // ---------- helpers ----------
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  buffSum(u, k) { let s = 0; for (const b of u.buffs) if (b.k === k) s += b.v; return s; }
  buffMax(u, k) { let s = 0; for (const b of u.buffs) if (b.k === k && b.v > s) s = b.v; return s; }
  speed(u) { return (u.baseMs || u.ms) * (1 - this.buffMax(u, 'slow')) * (1 + this.buffSum(u, 'haste')) * (1 - ((u.state && u.state.slow) || 0)); }
  atkSpeed(u) { return Math.min(2.5, u.as * (1 + this.buffSum(u, 'as') / 100)); }
  // Timed buff. o.tag: replaces any earlier buff with the same tag (for stacks that refresh).
  // o.onEnd: runs when the buff runs out, which is how one buff chains into the next.
  addBuff(u, k, v, dur, o = {}) {
    if (u.dead) return;
    if (o.tag) u.buffs = u.buffs.filter(b => b.tag !== o.tag);
    u.buffs.push({ k, v, until: this.time + dur, tag: o.tag, onEnd: o.onEnd });
  }
  silence(u, dur) { u.silenceUntil = Math.max(u.silenceUntil, this.time + dur); this.leave(u, 'cancel'); }
  knockUp(u, dur) { if (u.type === 'tower') return; this.stun(u, dur); u.airUntil = this.time + dur; }
  // A mark is a tag one ability leaves on a target: t.mark = { by, until, pop(t) }. Anything else the
  // marker lands on that target calls popMark, which removes the tag and runs its effect.
  popMark(h, t) {
    const m = t.mark; if (!m || m.by !== h.id || m.until <= this.time || t.dead) return false;
    t.mark = null; m.pop(t); return true;
  }
  // Chain targeting: starting from `first`, repeatedly hop to the nearest enemy not already in the chain.
  chain(h, first, count, hop) {
    const out = [first];
    while (out.length < count) {
      const last = out[out.length - 1];
      const n = this.enemiesIn(h.team, last.x, last.y, hop).filter(u => !out.includes(u) && this.targetable(h, u))
        .sort((a, b) => this.dist(a, last) - this.dist(b, last))[0];
      if (!n) break; out.push(n);
    }
    return out;
  }
  stun(u, dur) { u.stunUntil = Math.max(u.stunUntil, this.time + dur); u.windup = null; u.casting = null; u.recall = null; this.leave(u, 'cancel'); }
  root(u, dur) { u.rootUntil = Math.max(u.rootUntil, this.time + dur); }
  shield(u, amt, dur) { u.shieldAmt = amt; u.shieldUntil = this.time + dur; }
  heal(u, amt) { if (!u.dead) u.hp = Math.min(u.mhp, u.hp + amt); }
  restoreMana(u, amt) { if (!u.dead) u.mp = Math.min(u.mmp, u.mp + amt); }
  brushOf(u) { return MAP.brush.findIndex(b => u.x >= b.x && u.x <= b.x + b.w && u.y >= b.y && u.y <= b.y + b.h); }
  visible(u, team) {
    if (u.team === team || u.type !== 'hero' || u.revealUntil > this.time) return true;
    const b = this.brushOf(u); if (b < 0) return true;
    for (const o of this.units.values()) if (o.team === team && !o.dead && o.type !== 'tower' && this.brushOf(o) === b) return true;
    return false;
  }
  targetable(u, t) { return t && !t.dead && t.team !== u.team && this.visible(t, u.team); }
  inRange(u, t, extra = 0) { return this.dist(u, t) - t.radius <= u.range + extra; }
  enemiesIn(team, x, y, r, towers = false) {
    const out = [];
    for (const u of this.units.values())
      if (u.team !== team && !u.dead && (towers || u.type !== 'tower') && Math.hypot(u.x - x, u.y - y) <= r + u.radius) out.push(u);
    return out;
  }
  clampPos(u) {
    u.x = Math.max(MAP.edge, Math.min(MAP.w - MAP.edge, u.x)); u.y = Math.max(MAP.top + 30, Math.min(MAP.bot - 30, u.y));
  }
  fx(e) { this.events.push(e); }

  // ---------- ability primitives ----------
  line(h, aim, o) {
    this.shots.push({ id: this.nextId++, kind: 'line', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, left: o.range, range: o.range, dist: 0, team: h.team,
      speed: o.speed, w: o.width, color: o.color, onHit: o.onHit, pierce: o.pierce, hit: new Set(), style: o.style || 'orb', own: o.tether ? h.id : 0 });
  }
  homing(src, x, y, target, speed, color, onHit, style) {
    this.shots.push({ id: this.nextId++, kind: 'home', x, y, target, speed, team: src.team, color, onHit, w: 24,
      style: style || (src.type === 'tower' ? 'bolt' : src.type === 'minion' ? 'mote' : src.def.shot || 'orb') });
  }
  // AreaStrike: telegraph -> delay -> resolve. Everyone sees the shape from the moment it is created; after
  // `delay` it resolves once (or `ticks` times) against whoever is inside, calling onHit(target, inInner).
  // Shapes: a circle at x,y with radius r (and an optional stronger `inner` radius, measured to the target's
  // centre), or with shape 'line' a strip of length `len` and width `w` starting at x,y along dx,dy.
  strike(h, o) {
    const z = { id: this.nextId++, shape: o.shape || 'circle', x: o.x, y: o.y, r: o.r || 0, inner: o.inner || 0,
      dx: o.dx || 0, dy: o.dy || 0, len: o.len || 0, w: o.w || 0, team: h.team, born: this.time, at: this.time + o.delay,
      ticks: o.ticks || 1, interval: o.interval || 0, color: o.color, onHit: o.onHit, quiet: !!o.quiet };
    this.zones.push(z); return z;
  }
  strikeTargets(z) {
    if (z.shape !== 'line') return this.enemiesIn(z.team, z.x, z.y, z.r);
    const out = [];
    for (const u of this.units.values()) {
      if (u.team === z.team || u.dead || u.type === 'tower') continue;
      const rx = u.x - z.x, ry = u.y - z.y, along = rx * z.dx + ry * z.dy, side = Math.abs(rx * z.dy - ry * z.dx);
      if (along >= -u.radius && along <= z.len + u.radius && side <= z.w / 2 + u.radius) out.push(u);
    }
    return out;
  }
  burst(h, x, y, r, color, onHit) {
    this.fx({ e: 'burst', x, y, r, c: color });
    for (const t of this.enemiesIn(h.team, x, y, r)) onHit(t);
  }
  dash(h, o) { h.dashing = o; h.windup = null; }
  // Forced movement: the unit is carried at a fixed velocity and stunned (its own controls are
  // overridden) until it arrives. Towers cannot be moved.
  shove(t, vx, vy, dur, extraStun = 0) {
    if (t.type === 'tower' || t.dead) return;
    t.push = { vx, vy, until: this.time + dur }; t.dashing = null; this.stun(t, dur + extraStun);
  }
  pull(t, to, speed) {
    const dx = to.x - t.x, dy = to.y - t.y, d = Math.hypot(dx, dy), go = d - to.radius - t.radius;
    if (go > 0) this.shove(t, dx / d * speed, dy / d * speed, go / speed, 0.2);
  }
  // Pickups are objects lying in the world. One becomes live `delay` seconds after it is dropped, stays
  // for o.life seconds, and runs o.onTake when its owner walks within o.r of it.
  drop(h, x, y, delay, o) {
    const b = { id: this.nextId++, kind: o.kind, owner: h, team: h.team, x, y, r: o.r, born: this.time, at: this.time + delay,
      until: this.time + delay + o.life, onTake: o.onTake };
    this.clampPos(b); this.pickups.push(b); return b;
  }
  take(h, b) {
    const i = this.pickups.indexOf(b); if (i < 0) return;
    this.pickups.splice(i, 1); this.fx({ e: 'take', x: b.x | 0, y: b.y | 0 }); b.onTake(b);
  }
  stepPickups() {
    for (const b of [...this.pickups]) {
      if (this.time >= b.until) this.pickups.splice(this.pickups.indexOf(b), 1);
      else if (this.time >= b.at && !b.owner.dead && this.dist(b.owner, b) <= b.r) this.take(b.owner, b);
    }
  }
  blink(h, x, y) {
    this.fx({ e: 'blink', x: h.x, y: h.y }); h.x = x; h.y = y; this.clampPos(h); this.fx({ e: 'blink', x: h.x, y: h.y });
    h.windup = null;
  }

  // ---------- ability states ----------
  // A hero is in at most one ability state at a time: h.state = { name, s, t0, until, ...flags }, or null when
  // idle. `s` is the ability slot that owns it. Flags: lock (cannot move or attack), slow (move speed
  // penalty), noAttack (may walk but not attack), stopEnds (the Stop command ends it). The state ends with
  // leave(h, why): 'done' (the ability finished it), 'timeout' (ran past `until`) or 'cancel' (stun, death, Stop).
  enter(h, s, name, dur, flags) {
    this.leave(h, 'cancel');
    if (h.windup) { h.windup = null; h.nextAttack = this.time; }
    h.state = { name, s, t0: this.time, until: this.time + dur, tickAt: this.time, ...flags };
  }
  leave(h, why) {
    const st = h.state; if (!st) return;
    h.state = null;
    const def = h.def.abilities[st.s];
    if (def.onLeave) def.onLeave(this, h, st, why);
  }

  // ---------- damage ----------
  damage(src, t, amt, type, attack = false) {
    if (t.dead || this.over) return;
    if (t.type === 'tower') {
      if (!attack) return;
      const guarded = !this.enemiesIn(t.team, t.x, t.y, RULES.tower.guardRange).some(u => u.type === 'minion');
      if (guarded) amt *= RULES.tower.guardedMult;
    }
    if (type !== 'true') amt *= 100 / (100 + (type === 'phys' ? t.armor : t.mr));
    if (t.shieldUntil > this.time && t.shieldAmt > 0) { const a = Math.min(t.shieldAmt, amt); t.shieldAmt -= a; amt -= a; }
    t.hp -= amt;
    if (src && amt >= 1) this.fx({ e: 'dmg', id: t.id, x: Math.round(t.x), y: Math.round(t.y), n: Math.round(amt),
      s: src.type === 'hero' ? src.id : 0, k: t.type[0], ty: type[0] });
    if (t.type === 'hero') {
      t.recall = null;
      if (src && src.type === 'hero') {
        t.lastHeroDmg = { id: src.id, at: this.time };
        for (const u of this.units.values()) {
          if (u.team !== t.team || u.dead) continue;
          if (u.type === 'tower' && this.inRange(u, src)) { if (u.forced !== src.id) { u.forced = src.id; u.heat = 0; } }
        }
      }
    }
    if (src && src.type === 'hero') src.revealUntil = this.time + 1.5;
    if (t.hp <= 0) this.kill(src, t);
    else if (t.type === 'hero' && t.def.passive && t.def.passive.onDamaged) t.def.passive.onDamaged(this, t);
  }
  kill(src, t) {
    t.dead = true; t.hp = 0; t.windup = null; t.buffs = []; this.leave(t, 'cancel');
    this.fx({ e: 'die', x: Math.round(t.x), y: Math.round(t.y), t: t.team[0], k: t.type[0], h: t.hero });
    const enemy = [...this.heroes.values()].filter(h => h.team !== t.team);
    let killer = src && src.type === 'hero' ? src : null;
    if (t.type === 'minion') {
      this.units.delete(t.id);
      if (src && src.type === 'hero') { src.gold += t.gold; src.cs++; this.fx({ e: 'gold', x: t.x, y: t.y, n: t.gold, p: src.pid }); }
      const near = enemy.filter(h => !h.dead && this.dist(h, t) < WAVES.xpRange);
      for (const h of near) { this.giveXp(h, t.xp / near.length); if (h !== src) h.missed++; }   // in range but no last hit = a missed minion
    } else if (t.type === 'hero') {
      t.deaths++; t.respawnAt = this.time + 5 + 1.5 * t.lvl; t.order = null; t.casting = null; t.dashing = null; t.recall = null;
      let k = killer;
      if (!k && t.lastHeroDmg && this.time - t.lastHeroDmg.at < 10) k = this.units.get(t.lastHeroDmg.id);
      killer = k;
      if (k) { k.kills++; k.gold += 300; this.giveXp(k, 100 + 40 * t.lvl); this.fx({ e: 'gold', x: t.x, y: t.y, n: 300, p: k.pid }); }
      this.fx({ e: 'kill', k: k ? k.name : 'the lane', v: t.name });
    } else if (t.type === 'tower') {
      this.over = { winner: other(t.team), reason: 'tower destroyed' };
    }
    const pv = killer && killer.def.passive;
    if (pv && pv.onKill) pv.onKill(this, killer, t);
  }
  giveXp(h, n) {
    h.xp += n;
    while (h.lvl < 18 && h.xp >= xpToNext(h.lvl)) {
      h.xp -= xpToNext(h.lvl); h.lvl++; h.points++; this.refresh(h); this.fx({ e: 'lvl', id: h.id });
    }
  }

  // ---------- commands ----------
  command(pid, c) {
    const h = this.heroes.get(pid);
    if (!h || this.over || !c) return;
    const num = v => (Number.isFinite(v) ? v : 0);
    if (c.c === 'lvl') return this.levelUp(h, c.s | 0);
    if (c.c === 'buy') return this.buy(h, c.item);
    if (h.dead) return;
    const interrupt = () => { h.windup && (h.nextAttack = this.time); h.windup = null; h.recall = null; };
    switch (c.c) {
      case 'move': interrupt(); h.order = { type: 'move', x: num(c.x), y: num(c.y) }; break;
      case 'amove': h.recall = null; h.order = { type: 'amove', x: num(c.x), y: num(c.y) }; break;
      case 'atk': { const t = this.units.get(c.id); if (this.targetable(h, t)) { h.recall = null; h.order = { type: 'atk', id: t.id }; } break; }
      case 'stop': interrupt(); h.order = { type: 'hold' }; if (h.state && h.state.stopEnds) this.leave(h, 'cancel'); break;
      case 'recall': if (!h.casting && !h.dashing && !h.state) { interrupt(); h.order = { type: 'hold' }; h.recall = { at: this.time + 8 }; } break;
      case 'charge': this.startCharge(h, c.s | 0); break;
      case 'cast': this.cast(h, c.s | 0, c); break;
      case 'spell': this.castSpell(h, c.s, c); break;
    }
  }
  levelUp(h, s) {
    if (h.points < 1 || s < 0 || s > 3) return;
    const max = s === 3 ? Math.min(3, h.lvl >= 16 ? 3 : h.lvl >= 11 ? 2 : h.lvl >= 6 ? 1 : 0) : Math.min(5, Math.ceil(h.lvl / 2));
    if (h.ranks[s] >= max) return;
    h.ranks[s]++; h.points--;
  }
  buy(h, id) {
    const it = ITEM[id], s = MAP.spawn[h.team];
    if (!it || h.gold < it.cost || (this.dist(h, s) > MAP.fountainR && !h.dead)) return;
    if (it.potion) { h.gold -= it.cost; h.potionUntil = Math.max(this.time, h.potionUntil) + 10; return; }
    if (h.items.length >= 6 || (it.unique && h.items.includes(id))) return;
    h.gold -= it.cost; h.items.push(id); this.refresh(h);
  }
  aimFor(h, def, c) {
    let x = Number.isFinite(c.x) ? c.x : h.x, y = Number.isFinite(c.y) ? c.y : h.y;
    let dx = x - h.x, dy = y - h.y, d = Math.hypot(dx, dy);
    if (d < 1) { dx = Math.cos(h.face); dy = Math.sin(h.face); d = 1; } else { dx /= d; dy /= d; }
    const range = def.range;
    if (range && (def.kind === 'point' || def.kind === 'dash')) {
      const r = Math.min(d, range); x = h.x + dx * r; y = h.y + dy * r;
    }
    return { x, y, dx, dy };
  }
  canAct(h) { return !h.dead && h.stunUntil <= this.time && !h.casting && !h.dashing; }
  // Charged abilities: pressing the key enters CHARGING, releasing it casts with aim.power = 0..1.
  // Nothing is spent until release; holding past `hold` seconds just cancels.
  startCharge(h, s) {
    const def = h.def.abilities[s], r = h.ranks[s] - 1;
    if (!def || !def.charge || r < 0 || h.state || !this.canAct(h) || h.cds[s] > this.time) return;
    if (h.mp < def.cost[Math.min(r, def.cost.length - 1)]) return;
    h.recall = null;
    this.enter(h, s, 'charging', def.charge.hold, { slow: def.charge.slow, noAttack: true, full: def.charge.full });
  }
  cast(h, s, c) {
    const def = h.def.abilities[s], r = h.ranks[s] - 1, st = h.state;
    if (!def || r < 0 || !this.canAct(h) || h.silenceUntil > this.time) return;
    if (st && st.s !== s) return;                                   // busy with another ability
    if (st && st.name !== 'charging') { if (def.recast) def.recast(this, h, r, this.aimFor(h, def, c), st); return; }
    if (def.charge && !st) return;                                  // charged abilities only fire from CHARGING
    if (h.cds[s] > this.time) return;
    const cost = def.cost[Math.min(r, def.cost.length - 1)];
    if (h.mp < cost) return;
    if (def.kind === 'dash' && h.rootUntil > this.time) return;
    const aim = this.aimFor(h, def, c);
    aim.power = st ? Math.max(0, Math.min(1, (this.time - st.t0) / st.full)) : 0;
    if (st) this.leave(h, 'done');
    // Target validation: an ability with `pick` chooses what it is aimed at; no valid target, no cast.
    if (def.pick) { aim.target = def.pick(this, h, aim); if (!aim.target) { this.fx({ e: 'say', p: h.pid, m: 'No target there' }); return; } }
    if (aim.target && aim.target.type === 'hero' && aim.target.team !== h.team) this.callForHelp(h, aim.target);   // targeted ability on a champion
    h.mp -= cost; h.cds[s] = this.time + def.cd[Math.min(r, def.cd.length - 1)];
    h.recall = null; h.revealUntil = this.time + 1.5;
    if (h.windup) { h.windup = null; h.nextAttack = this.time; }
    if (def.kind !== 'self') h.face = Math.atan2(aim.dy, aim.dx);
    this.fx({ e: 'cast', id: h.id, s, d: def.castTime || 0 });
    const fire = () => def.cast(this, h, r, aim);
    if (def.castTime) h.casting = { at: this.time + def.castTime, fire }; else fire();
  }
  castSpell(h, s, c) {
    const def = SPELLS[s];
    if (!def || !this.canAct(h) || h.spellCds[s] > this.time || (h.state && h.state.lock)) return;
    h.spellCds[s] = this.time + def.cd; h.recall = null;
    def.cast(this, h, this.aimFor(h, def, c));
  }

  // ---------- per-tick ----------
  step() {
    if (this.over) return;
    this.time += DT;
    if (this.time >= this.nextWave) { this.queueWave(); this.nextWave += WAVES.every(this.time); }
    while (this.spawnQ.length && this.time >= this.spawnQ[0].at) this.spawnMinion(this.spawnQ.shift());
    for (const u of [...this.units.values()]) {
      if (u.buffs.length) {
        const done = u.buffs.filter(b => b.until <= this.time);
        if (done.length) { u.buffs = u.buffs.filter(b => b.until > this.time); for (const b of done) if (b.onEnd && !u.dead) b.onEnd(); }
      }
      if (u.push) { if (this.time < u.push.until && !u.dead) { u.x += u.push.vx * DT; u.y += u.push.vy * DT; this.clampPos(u); } else u.push = null; }
      if (u.type === 'hero') this.stepHero(u);
      else if (u.dead) continue;
      else if (u.type === 'minion') this.stepMinion(u);
      else this.stepTower(u);
    }
    this.separate();
    this.stepShots(); this.stepZones(); this.stepPickups();
    for (const h of this.heroes.values()) {
      if (this.over) break;
      if (h.kills >= RULES.kills) this.over = { winner: h.team, reason: `${RULES.kills} kills` };
      else if (h.cs >= RULES.cs) this.over = { winner: h.team, reason: `${RULES.cs} minions` };
    }
  }
  // A wave is queued as a list of spawns, one minion every WAVES.stagger seconds: melee, then the cannon, then casters.
  queueWave() {
    const n = ++this.waveNo, T = this.time, cannon = WAVES.cannon(n, T);
    const kinds = [...Array(cannon && T >= 840 ? 2 : 3).fill('melee'), ...(cannon ? ['cannon'] : []), 'caster', 'caster', 'caster'];
    const slot = { melee: 0, caster: 0, cannon: 1 };
    kinds.forEach((kind, i) => { for (const team of ['blue', 'red']) this.spawnQ.push({ at: T + i * WAVES.stagger, team, kind, wave: n, slot: slot[kind] }); slot[kind]++; });
  }
  spawnMinion(q) {
    const k = MINION[q.kind], dir = q.team === 'blue' ? 1 : -1, up = Math.floor(this.time / WAVES.upgradeEvery);
    const hp = Math.round(k.hp * (1 + WAVES.hpPerUpgrade * up)), y = MAP.mid + (q.slot - 1) * 90;
    return this.add({ type: 'minion', team: q.team, kind: q.kind, melee: q.kind === 'melee', wave: q.wave, slot: q.slot,
      x: MAP.spawn[q.team].x + dir * MAP.minionOffset, y, laneY: y, radius: k.radius, hp, mhp: hp, ad: k.ad * (1 + WAVES.adPerUpgrade * up),
      armor: 0, mr: 0, ms: 325, range: k.range, as: k.as, windupT: k.windupT, projSpeed: k.projSpeed, gold: k.gold, xp: k.xp,
      targetId: 0, mode: 'walk', lookAt: this.time + (this.nextId % 5) * 0.1 });
  }
  moveToward(u, x, y) {
    if (u.rootUntil > this.time) return false;
    const dx = x - u.x, dy = y - u.y, d = Math.hypot(dx, dy), s = this.speed(u) * DT;
    if (d > 0.5) u.face = Math.atan2(dy, dx);
    if (d <= s) { u.x = x; u.y = y; this.clampPos(u); return true; }
    u.x += dx / d * s; u.y += dy / d * s; this.clampPos(u); return false;
  }
  // Returns true while the unit is locked in an attack windup.
  stepWindup(u) {
    if (!u.windup) return false;
    const t = this.units.get(u.windup.id);
    if (!this.targetable(u, t)) { u.windup = null; u.nextAttack = this.time; return false; }
    if (this.time >= u.windup.at) { u.windup = null; this.fireAttack(u, t); }
    return true;
  }
  engage(u, t) {
    if (this.inRange(u, t)) {
      u.face = Math.atan2(t.y - u.y, t.x - u.x);
      if (this.time >= u.nextAttack) {
        u.atkId = t.id; u.atkAt = this.time;                       // who this unit is attacking, for minion target priority
        if (u.type === 'hero' && t.type === 'hero') this.callForHelp(u, t);
        const period = 1 / this.atkSpeed(u);
        const wd = u.windupT ?? u.windupFrac * period;
        u.windup = { id: t.id, at: this.time + wd };
        this.fx({ e: 'atk', id: u.id, d: +wd.toFixed(2) });
        u.nextAttack = this.time + period;
      }
    } else this.moveToward(u, t.x, t.y);
  }
  fireAttack(u, t) {
    if (u.type === 'hero') u.revealUntil = this.time + 1.5;
    if (u.melee) this.attackHit(u, t);
    else this.homing(u, u.x, u.y, t, u.projSpeed, u.type === 'tower' ? '#ffffff' : null, () => this.attackHit(u, t));
  }
  attackHit(u, t) {
    if (t.dead) return;
    let dmg = u.ad;
    const kind = MINION[t.kind];
    if (u.type === 'minion') dmg = t.type === 'hero' ? dmg * WAVES.vsHero : t.type === 'tower' ? dmg * WAVES.vsTower : dmg + ((MINION[u.kind] || {}).vsMinionHp || 0) * t.hp;
    if (u.type === 'tower' && t.type === 'hero') { dmg *= 1 + RULES.tower.heatPerShot * u.heat; u.heat = Math.min(RULES.tower.maxHeat, u.heat + 1); }
    // A tower shot takes a fixed share of a minion's max health, however much health upgrades have added.
    if (u.type === 'tower' && t.type === 'minion' && kind && kind.towerShot) return this.damage(u, t, kind.towerShot * t.mhp, 'true', true);
    if (u.type === 'hero') {
      // Empowered next attack: h.emp = { until, hit(target) -> bonus damage }, used up by one attack.
      if (u.emp) { const e = u.emp; u.emp = null; if (e.until > this.time) dmg += e.hit(t) || 0; }
      this.popMark(u, t);
      if (u.def.passive && u.def.passive.onAttack) u.def.passive.onAttack(this, u, t);
    }
    this.damage(u, t, dmg, 'phys', true);
  }
  nearestEnemy(u, maxEdgeDist, filter) {
    let best = null, bd = Infinity;
    for (const t of this.units.values()) {
      if (!this.targetable(u, t) || (filter && !filter(t))) continue;
      const d = this.dist(u, t) - t.radius;
      if (d <= maxEdgeDist && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  stepHero(h) {
    const T = this.time, sp = MAP.spawn[h.team];
    if (h.ai) think(this, h);                       // practice bot: decides, then issues ordinary commands
    if (h.dead) {
      if (T >= h.respawnAt) { h.dead = false; h.hp = h.mhp; h.mp = h.mmp; h.x = sp.x; h.y = sp.y; h.order = null; }
      return;
    }
    h.gold += RULES.goldPerSec * DT;
    const home = this.dist(h, sp) < MAP.fountainR;
    h.hp = Math.min(h.mhp, h.hp + (h.def.hpRegen + (home ? h.mhp * 0.1 : 0) + (h.potionUntil > T ? 15 : 0)) * DT);
    h.mp = Math.min(h.mmp, h.mp + (h.def.manaRegen + (home ? h.mmp * 0.1 : 0)) * DT);
    const es = MAP.spawn[other(h.team)];
    if (this.dist(h, es) < MAP.fountainR) this.damage(null, h, MAP.fountainBurn * DT, 'true');
    if (h.dead || T < h.stunUntil) return;
    for (let s = 0; s < 4; s++) { const d = h.def.abilities[s]; if (d.tick && h.ranks[s] > 0) d.tick(this, h, h.ranks[s] - 1); }   // always-on effects
    if (h.state && T >= h.state.until) this.leave(h, 'timeout');
    // Channels: a state with `every` calls its ability's onTick on that interval until the state ends.
    if (h.state && h.state.every && T >= h.state.tickAt) { const st = h.state; st.tickAt += st.every; h.def.abilities[st.s].onTick(this, h, st); }
    if (h.dashing) return this.stepDash(h);
    if (h.casting) { if (T >= h.casting.at) { const f = h.casting.fire; h.casting = null; f(); } return; }
    if (h.recall) {
      if (T >= h.recall.at) { h.recall = null; h.x = sp.x; h.y = sp.y; h.order = null; this.fx({ e: 'blink', x: h.x, y: h.y }); }
      return;
    }
    if (h.bot && !h.ai) return this.stepBot(h);
    const o = h.order, st = h.state;
    if (st && st.lock) return;
    if (st && st.noAttack) { if (o && (o.type === 'move' || o.type === 'amove') && this.moveToward(h, o.x, o.y)) h.order = null; return; }
    if (this.stepWindup(h)) return;
    if (!o) { const t = this.nearestEnemy(h, h.range); if (t) this.engage(h, t); return; }
    if (o.type === 'move') { if (this.moveToward(h, o.x, o.y)) h.order = null; }
    else if (o.type === 'atk') {
      const t = this.units.get(o.id);
      if (!this.targetable(h, t)) h.order = null; else this.engage(h, t);
    } else if (o.type === 'amove') {
      const t = this.nearestEnemy(h, h.range + 250);
      if (t) this.engage(h, t); else if (this.moveToward(h, o.x, o.y)) h.order = null;
    }
  }
  // Practice dummy: stands by its tower and hits whatever comes into range.
  stepBot(h) {
    if (this.stepWindup(h)) return;
    const post = MAP.tower[h.team], dir = h.team === 'blue' ? 1 : -1;
    const t = this.nearestEnemy(h, h.range + 150);
    if (t) this.engage(h, t); else this.moveToward(h, post.x + dir * 350, post.y + 120);
    if (h.points) for (const s of [3, 0, 1, 2]) this.levelUp(h, s);
  }
  stepDash(h) {
    const d = h.dashing, tx = d.follow ? d.follow.x : d.x, ty = d.follow ? d.follow.y : d.y;
    const dx = tx - h.x, dy = ty - h.y, dist = Math.hypot(dx, dy), s = d.speed * DT;
    const stopAt = d.follow ? d.follow.radius + 40 : 0;
    if (dist > 0.5) h.face = Math.atan2(dy, dx);
    let done = d.follow && d.follow.dead;
    if (dist - stopAt <= s) { const k = Math.max(0, dist - stopAt) / (dist || 1); h.x += dx * k; h.y += dy * k; done = true; }
    else { h.x += dx / dist * s; h.y += dy / dist * s; }
    this.clampPos(h);
    if (d.onHero) {
      const t = this.enemiesIn(h.team, h.x, h.y, h.radius).find(u => u.type === 'hero');
      if (t) { h.dashing = null; d.onHero(t); h.order = { type: 'atk', id: t.id }; return; }
    }
    if (done) { h.dashing = null; if (d.onEnd) d.onEnd(); if (d.follow && !d.follow.dead) h.order = { type: 'atk', id: d.follow.id }; else if (h.order && h.order.type === 'move') h.order = null; }
  }
  // ---------- minions ----------
  // What a unit is attacking right now (its most recent attack target, if recent enough), or null.
  attacking(u) { return this.time - u.atkAt <= 2.5 ? this.units.get(u.atkId) || null : null; }
  // A champion attacked (or used a targeted ability on) an enemy champion: nearby minions of the victim's
  // team look for a target at once instead of waiting for their next scheduled look.
  callForHelp(attacker, victim) {
    attacker.atkId = victim.id; attacker.atkAt = this.time;
    for (const m of this.units.values())
      if (m.type === 'minion' && m.team === victim.team && !m.dead && this.dist(m, victim) <= WAVES.helpRange) m.lookAt = 0;
  }
  // Target priority for minion m looking at enemy t at edge distance d. 1 is highest; 0 means "not a target".
  // `reach` is how far m will look: WAVES.sight for new targets, WAVES.keep for the one it already has.
  priority(m, t, d, reach) {
    const a = this.attacking(t), ally = a && a.team === m.team && !a.dead ? a : null;
    if (t.type === 'hero') {
      if (m.wave === 1 && !this.wavesMet) return d <= 120 ? 6 : 0;          // first wave leaves champions alone until the waves meet
      if (ally && ally.type === 'hero' && d <= WAVES.helpRange && this.dist(m, ally) <= WAVES.helpRange) return 1;
      return d <= reach ? 6 : 0;
    }
    if (d > reach) return 0;
    if (t.type === 'minion') return ally ? (ally.type === 'hero' ? 2 : 3) : 5;
    return ally && ally.type === 'minion' ? 4 : 7;                          // tower: 4 if it is shooting allied minions, else last
  }
  // Keep the current target unless something of strictly higher priority shows up.
  pickTarget(m, cur) {
    const edge = t => this.dist(m, t) - t.radius;
    const sieging = cur && cur.type === 'tower' && this.inRange(m, cur);     // minions hitting a tower ignore calls for help
    const curP = cur ? this.priority(m, cur, edge(cur), WAVES.keep) : 0;
    let best = null, bestP = 99, bestD = Infinity;
    for (const t of this.units.values()) {
      if (t === cur || !this.targetable(m, t)) continue;
      const d = edge(t), p = this.priority(m, t, d, WAVES.sight);
      if (!p || (sieging && p <= 2)) continue;
      if (p < bestP || (p === bestP && d < bestD)) { best = t; bestP = p; bestD = d; }
    }
    if (curP && !(best && bestP < curP)) return cur;
    // First clash: each first-wave melee minion takes the enemy melee in its own lane slot, so the attacks
    // are spread across all three and both sides' melee die at about the same time.
    if (best && best.type === 'minion' && bestP >= 3 && m.wave === 1 && m.melee) {
      const twin = [...this.units.values()].find(t => t.type === 'minion' && t.team !== m.team && t.wave === 1 && t.melee && t.slot === m.slot && !t.dead && edge(t) <= 1200);
      if (twin) best = twin;
    }
    return best;
  }
  // State machine: WALK the lane -> CHASE a target -> ATTACK it once in range.
  stepMinion(m) {
    if (this.time < m.stunUntil) return;
    if (this.stepWindup(m)) return;
    let t = this.units.get(m.targetId) || null;
    if (t && !this.targetable(m, t)) t = null;                               // died or went out of sight
    if (!t || !(this.time < m.lookAt)) { m.lookAt = this.time + WAVES.look; t = this.pickTarget(m, t); }
    m.targetId = t ? t.id : 0;
    if (t) {
      if (m.wave === 1 && t.type === 'minion' && this.inRange(m, t)) this.wavesMet = true;
      m.mode = this.inRange(m, t) ? 'attack' : 'chase';
      return this.engage(m, t);
    }
    m.mode = 'walk';
    const goal = MAP.spawn[other(m.team)], dir = m.team === 'blue' ? 1 : -1;
    this.moveToward(m, Math.abs(goal.x - m.x) < 300 ? goal.x : m.x + dir * 200, m.y + Math.sign(m.laneY - m.y) * Math.min(60, Math.abs(m.laneY - m.y)));
  }
  stepTower(t) {
    if (this.stepWindup(t)) return;
    let tg = this.units.get(t.forced);
    if (!(this.targetable(t, tg) && this.inRange(t, tg))) { t.forced = 0; tg = this.units.get(t.targetId); }
    if (!(this.targetable(t, tg) && this.inRange(t, tg))) {
      tg = this.nearestEnemy(t, t.range, u => u.type === 'minion') || this.nearestEnemy(t, t.range);
      if (!tg || tg.id !== t.targetId) t.heat = 0;
    }
    t.targetId = tg ? tg.id : 0;
    if (tg) this.engage(t, tg);
  }
  separate() {
    const ms = [...this.units.values()].filter(u => u.type === 'minion');
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j]; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy), min = a.radius + b.radius - 6;
      if (d >= min) continue;
      if (d < 0.01) { dx = 1; dy = (a.id % 2 ? 1 : -1); }
      const k = (min - d) / (2 * (d || 1.4)) * 0.5; a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k;
    }
    // Heroes and minions (either team) also push apart, so a wave can body-block a hero. The hero is also
    // steered sideways along the minion's edge, so walking into a wave goes around it instead of stopping dead. Dashing or shoved units pass through; blinks simply land and get pushed clear.
    const C = RULES.collision, min = C.hero + C.minion;
    for (const h of this.heroes.values()) {
      if (h.dead || h.dashing || h.push) continue;
      for (const m of ms) {
        if (m.push) continue;
        let dx = h.x - m.x, dy = h.y - m.y, d = Math.hypot(dx, dy);
        if (d >= min) continue;
        if (d < 0.01) { dx = 0; dy = h.id % 2 ? 1 : -1; d = 1; }
        // Pick one side to go around and stick with it for a moment; otherwise a hero between two minions is
        // steered both ways at once and stops dead.
        if (!h.detour || this.time > h.detour.until) h.detour = { side: Math.abs(dy) > 4 ? Math.sign(dy) : (h.id % 2 ? 1 : -1) };
        h.detour.until = this.time + C.detourFor;
        const over = min - d, nx = dx / d, ny = dy / d;
        let tx = -ny, ty = nx;                                             // along the minion's edge...
        if (Math.abs(ty) > 0.15 ? ty * h.detour.side < 0 : tx * Math.cos(h.face) + ty * Math.sin(h.face) < 0) { tx = -tx; ty = -ty; }   // ...toward the chosen side
        h.x += nx * over * C.heroShare + tx * over * C.slide; h.y += ny * over * C.heroShare + ty * over * C.slide;
        m.x -= nx * over * (1 - C.heroShare); m.y -= ny * over * (1 - C.heroShare);
      }
      this.clampPos(h);
    }
  }
  stepShots() {
    const keep = [];
    for (const s of this.shots) {
      if (s.kind === 'home') {
        const t = s.target; if (t.dead) continue;
        const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), st = s.speed * DT;
        if (d <= st + t.radius * 0.5) { s.onHit(); continue; }
        s.x += dx / d * st; s.y += dy / d * st; keep.push(s);
      } else {
        const st = Math.min(s.speed * DT, s.left); let dead = false;
        for (let i = 0, n = Math.ceil(st / 25); i < n && !dead; i++) {
          s.x += s.dx * st / n; s.y += s.dy * st / n; s.dist += st / n;
          for (const t of this.enemiesIn(s.team, s.x, s.y, s.w / 2)) {
            if (s.hit.has(t.id)) continue;
            s.hit.add(t.id); s.onHit(t, s);
            if (!s.pierce) { dead = true; break; }
          }
        }
        s.left -= st;
        if (!dead && s.left > 0 && s.x > 0 && s.x < MAP.w) keep.push(s);
      }
    }
    this.shots = keep;
  }
  stepZones() {
    this.zones = this.zones.filter(z => {
      if (this.time < z.at) return true;
      if (z.shape === 'line') this.fx({ e: 'beam', x: z.x | 0, y: z.y | 0, a: +Math.atan2(z.dy, z.dx).toFixed(3), l: z.len | 0, w: z.w, c: z.color });
      else if (!z.quiet) this.fx({ e: 'burst', x: z.x, y: z.y, r: z.r, c: z.color });
      for (const t of this.strikeTargets(z)) z.onHit(t, z.inner > 0 && Math.hypot(t.x - z.x, t.y - z.y) <= z.inner);
      z.at += z.interval; return --z.ticks > 0;
    });
  }

  // ---------- snapshots ----------
  snapshot(pid) {
    const me = this.heroes.get(pid), team = me ? me.team : 'blue', T = this.time, r = Math.round;
    const units = [];
    for (const u of this.units.values()) {
      if (!this.visible(u, team) && !u.dead) continue;
      const o = { id: u.id, k: u.type[0], t: u.team[0], x: r(u.x), y: r(u.y), hp: Math.ceil(u.hp), mhp: r(u.mhp) };
      if (u.type === 'minion') { o.m = u.kind === 'melee' ? 1 : u.kind === 'cannon' ? 2 : 0; o.f = +u.face.toFixed(2); o.tg = u.targetId; }
      if (u.type === 'tower') o.tg = u.targetId;
      if (u.type === 'hero') Object.assign(o, { h: u.hero, n: u.name, lvl: u.lvl, mp: r(u.mp), mmp: r(u.mmp), f: +u.face.toFixed(2),
        d: u.dead ? Math.ceil(u.respawnAt - T) : 0, st: T < u.stunUntil ? 1 : 0, rt: T < u.rootUntil ? 1 : 0,
        sl: this.buffMax(u, 'slow') > 0 ? 1 : 0, sh: u.shieldUntil > T ? r(u.shieldAmt) : 0,
        rc: u.recall ? +(1 - (u.recall.at - T) / 8).toFixed(2) : 0, br: this.brushOf(u) >= 0 ? 1 : 0,
        mk: u.mark && u.mark.until > T ? 1 : 0, kl: u.kills, cs: u.cs,
        pr: u.def.passive && u.def.passive.wait && u.def.passive.wait(this, u) <= 0 ? 1 : 0,
        pn: u.def.passive && u.def.passive.count ? u.def.passive.count(this, u) : 0,
        si: T < u.silenceUntil ? 1 : 0, ku: T < u.airUntil ? 1 : 0, em: u.emp && u.emp.until > T ? 1 : 0,
        cn: u.state && u.state.name === 'channel' ? 1 : 0,
        // ability state: ch = charge 0..1 (hl = fraction of the hold limit used), bg = barrage shots left
        ch: u.state && u.state.name === 'charging' ? +Math.min(1, (T - u.state.t0) / u.state.full).toFixed(2) : 0,
        hl: u.state && u.state.name === 'charging' ? +((T - u.state.t0) / (u.state.until - u.state.t0)).toFixed(2) : 0,
        bg: u.state && u.state.name === 'barrage' ? u.state.shots : 0 });
      units.push(o);
    }
    const snap = { t: 'snap', time: +T.toFixed(3), units,
      shots: this.shots.map(s => ({ id: s.id, x: r(s.x), y: r(s.y), w: s.w, t: s.team[0], c: s.color, s: s.style,
        ...(s.own ? { o: s.own } : {}),
        a: +(s.kind === 'home' ? Math.atan2(s.target.y - s.y, s.target.x - s.x) : Math.atan2(s.dy, s.dx)).toFixed(2) })),
      zones: this.zones.map(z => ({ id: z.id, x: z.x | 0, y: z.y | 0, r: z.r, t: z.team[0], c: z.color,
        ...(z.inner ? { i: z.inner } : {}), ...(z.shape === 'line' ? { l: z.len | 0, w: z.w, a: +Math.atan2(z.dy, z.dx).toFixed(3) } : {}),
        p: +Math.min(1, (T - z.born) / Math.max(0.01, z.at - z.born)).toFixed(2) })),
      pk: this.pickups.map(b => ({ id: b.id, x: b.x | 0, y: b.y | 0, r: b.r, t: b.team[0], k: b.kind,
        p: +Math.min(1, (T - b.born) / Math.max(0.01, b.at - b.born)).toFixed(2), l: +Math.max(0, b.until - T).toFixed(1) })),
      ev: this.events.filter(e => e.p === undefined || e.p === pid), over: this.over };
    if (me) snap.me = { id: me.id, gold: Math.floor(me.gold), xp: r(me.xp), xpn: xpToNext(me.lvl), pts: me.points, ranks: me.ranks,
      cds: me.cds.map(c => Math.max(0, +(c - T).toFixed(1))), sd: Math.max(0, r(me.spellCds.d - T)), sf: Math.max(0, r(me.spellCds.f - T)),
      items: me.items, ad: r(me.ad), ap: r(me.ap), ar: r(me.armor), mr: r(me.mr), ms: r(this.speed(me)), as: +this.atkSpeed(me).toFixed(2),
      range: me.range, miss: me.missed, wave: this.waveNo, pv: me.def.passive && me.def.passive.wait ? Math.max(0, +me.def.passive.wait(this, me).toFixed(1)) : 0,
      bt: me.state && me.state.name === 'barrage' ? Math.max(0, +(me.state.until - T).toFixed(1)) : 0, shop: me.dead || this.dist(me, MAP.spawn[me.team]) <= MAP.fountainR };
    return snap;
  }
}
