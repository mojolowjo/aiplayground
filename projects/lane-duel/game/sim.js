// Authoritative game simulation. No networking in here.
import { HEROES, SPELLS, ITEMS } from './data.js';

export const TICK = 30, DT = 1 / TICK;
export const MAP = {
  w: 6400, h: 1600, top: 220, bot: 1380, mid: 800,
  spawn: { blue: { x: 260, y: 800 }, red: { x: 6140, y: 800 } },
  tower: { blue: { x: 1900, y: 800 }, red: { x: 4500, y: 800 } },
  fountainR: 520,
  brush: [
    { x: 2500, y: 220, w: 1400, h: 190 },
    { x: 2500, y: 1190, w: 1400, h: 190 },
  ],
};
export const RULES = { kills: 2, cs: 100, firstWave: 15, waveEvery: 25, startGold: 500, goldPerSec: 2 };

const other = t => (t === 'blue' ? 'red' : 'blue');
const xpToNext = lvl => 180 + 100 * lvl;
const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));

export class Game {
  constructor(players) {
    this.time = 0; this.nextId = 1; this.units = new Map(); this.shots = []; this.zones = [];
    this.events = []; this.over = null; this.nextWave = RULES.firstWave; this.heroes = new Map();
    for (const team of ['blue', 'red']) {
      const p = MAP.tower[team];
      this.add({ type: 'tower', team, x: p.x, y: p.y, radius: 90, hp: 2500, mhp: 2500, ad: 150, armor: 40, mr: 40,
        range: 775, as: 0.83, windupT: 0.15, projSpeed: 1300, melee: false, heat: 0 });
    }
    for (const p of players) this.addHero(p);
  }

  // ---------- setup ----------
  add(u) {
    u.id = this.nextId++; u.buffs = []; u.nextAttack = 0; u.windup = null; u.dead = false;
    u.stunUntil = 0; u.rootUntil = 0; u.shieldAmt = 0; u.shieldUntil = 0; u.face = u.team === 'blue' ? 0 : Math.PI;
    this.units.set(u.id, u); return u;
  }
  addHero(p) {
    const d = HEROES[p.hero], s = MAP.spawn[p.team];
    const h = this.add({ type: 'hero', team: p.team, pid: p.id, name: p.name, hero: p.hero, def: d, x: s.x, y: s.y,
      radius: 55, melee: d.melee, projSpeed: d.projSpeed, lvl: 1, xp: 0, points: 1, ranks: [0, 0, 0, 0],
      cds: [0, 0, 0, 0], spellCds: { d: 0, f: 0 }, gold: RULES.startGold, items: [], kills: 0, deaths: 0, cs: 0,
      order: null, casting: null, dashing: null, recall: null, respawnAt: 0, revealUntil: 0, bot: !!p.bot,
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
  speed(u) { return (u.baseMs || u.ms) * (1 - this.buffMax(u, 'slow')) * (1 + this.buffSum(u, 'haste')); }
  atkSpeed(u) { return Math.min(2.5, u.as * (1 + this.buffSum(u, 'as') / 100)); }
  addBuff(u, k, v, dur) { if (!u.dead) u.buffs.push({ k, v, until: this.time + dur }); }
  stun(u, dur) { u.stunUntil = Math.max(u.stunUntil, this.time + dur); u.windup = null; u.casting = null; u.recall = null; }
  root(u, dur) { u.rootUntil = Math.max(u.rootUntil, this.time + dur); }
  shield(u, amt, dur) { u.shieldAmt = amt; u.shieldUntil = this.time + dur; }
  heal(u, amt) { if (!u.dead) u.hp = Math.min(u.mhp, u.hp + amt); }
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
    u.x = Math.max(60, Math.min(MAP.w - 60, u.x)); u.y = Math.max(MAP.top + 30, Math.min(MAP.bot - 30, u.y));
  }
  fx(e) { this.events.push(e); }

  // ---------- ability primitives ----------
  line(h, aim, o) {
    this.shots.push({ id: this.nextId++, kind: 'line', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, left: o.range, team: h.team,
      speed: o.speed, w: o.width, color: o.color, onHit: o.onHit, pierce: o.pierce, hit: new Set(), style: o.style || 'orb' });
  }
  homing(src, x, y, target, speed, color, onHit, style) {
    this.shots.push({ id: this.nextId++, kind: 'home', x, y, target, speed, team: src.team, color, onHit, w: 24,
      style: style || (src.type === 'tower' ? 'bolt' : src.type === 'minion' ? 'mote' : src.def.shot || 'orb') });
  }
  zone(h, o) {
    this.zones.push({ id: this.nextId++, x: o.x, y: o.y, r: o.r, team: h.team, born: this.time, at: this.time + o.delay,
      ticks: o.ticks || 1, interval: o.interval || 0, color: o.color, onHit: o.onHit });
  }
  burst(h, x, y, r, color, onHit) {
    this.fx({ e: 'burst', x, y, r, c: color });
    for (const t of this.enemiesIn(h.team, x, y, r)) onHit(t);
  }
  dash(h, o) { h.dashing = o; h.windup = null; }
  blink(h, x, y) {
    this.fx({ e: 'blink', x: h.x, y: h.y }); h.x = x; h.y = y; this.clampPos(h); this.fx({ e: 'blink', x: h.x, y: h.y });
    h.windup = null;
  }

  // ---------- damage ----------
  damage(src, t, amt, type, attack = false) {
    if (t.dead || this.over) return;
    if (t.type === 'tower') {
      if (!attack) return;
      const guarded = !this.enemiesIn(t.team, t.x, t.y, 900).some(u => u.type === 'minion');
      if (guarded) amt *= 0.33;
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
          else if (u.type === 'minion' && this.dist(u, src) < 600) { u.targetId = src.id; u.aggroUntil = this.time + 2.5; }
        }
      }
    }
    if (src && src.type === 'hero') src.revealUntil = this.time + 1.5;
    if (t.hp <= 0) this.kill(src, t);
  }
  kill(src, t) {
    t.dead = true; t.hp = 0; t.windup = null; t.buffs = [];
    this.fx({ e: 'die', x: Math.round(t.x), y: Math.round(t.y), t: t.team[0], k: t.type[0], h: t.hero });
    const enemy = [...this.heroes.values()].filter(h => h.team !== t.team);
    if (t.type === 'minion') {
      this.units.delete(t.id);
      if (src && src.type === 'hero') { src.gold += t.gold; src.cs++; this.fx({ e: 'gold', x: t.x, y: t.y, n: t.gold, p: src.pid }); }
      const near = enemy.filter(h => !h.dead && this.dist(h, t) < 1400);
      for (const h of near) this.giveXp(h, t.xp / near.length);
    } else if (t.type === 'hero') {
      t.deaths++; t.respawnAt = this.time + 5 + 1.5 * t.lvl; t.order = null; t.casting = null; t.dashing = null; t.recall = null;
      let k = src && src.type === 'hero' ? src : null;
      if (!k && t.lastHeroDmg && this.time - t.lastHeroDmg.at < 10) k = this.units.get(t.lastHeroDmg.id);
      if (k) { k.kills++; k.gold += 300; this.giveXp(k, 100 + 40 * t.lvl); this.fx({ e: 'gold', x: t.x, y: t.y, n: 300, p: k.pid }); }
      this.fx({ e: 'kill', k: k ? k.name : 'the lane', v: t.name });
    } else if (t.type === 'tower') {
      this.over = { winner: other(t.team), reason: 'tower destroyed' };
    }
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
      case 'stop': interrupt(); h.order = { type: 'hold' }; break;
      case 'recall': if (!h.casting && !h.dashing) { interrupt(); h.order = { type: 'hold' }; h.recall = { at: this.time + 8 }; } break;
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
    if (def.range && (def.kind === 'point' || def.kind === 'dash')) {
      const r = Math.min(d, def.range); x = h.x + dx * r; y = h.y + dy * r;
    }
    return { x, y, dx, dy, target: this.units.get(c.id) };
  }
  canAct(h) { return !h.dead && h.stunUntil <= this.time && !h.casting && !h.dashing; }
  cast(h, s, c) {
    const def = h.def.abilities[s], r = h.ranks[s] - 1;
    if (!def || r < 0 || !this.canAct(h) || h.cds[s] > this.time) return;
    const cost = def.cost[Math.min(r, def.cost.length - 1)];
    if (h.mp < cost) return;
    if (def.kind === 'dash' && h.rootUntil > this.time) return;
    const aim = this.aimFor(h, def, c);
    if (def.kind === 'unit') {
      const t = aim.target;
      if (!this.targetable(h, t) || t.type !== 'hero' || this.dist(h, t) > def.range + t.radius) return;
      if (h.rootUntil > this.time) return;
    }
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
    if (!def || !this.canAct(h) || h.spellCds[s] > this.time) return;
    h.spellCds[s] = this.time + def.cd; h.recall = null;
    def.cast(this, h, this.aimFor(h, def, c));
  }

  // ---------- per-tick ----------
  step() {
    if (this.over) return;
    this.time += DT;
    if (this.time >= this.nextWave) { this.spawnWave(); this.nextWave += RULES.waveEvery; }
    for (const u of [...this.units.values()]) {
      if (u.buffs.length) u.buffs = u.buffs.filter(b => b.until > this.time);
      if (u.type === 'hero') this.stepHero(u);
      else if (u.dead) continue;
      else if (u.type === 'minion') this.stepMinion(u);
      else this.stepTower(u);
    }
    this.separate();
    this.stepShots(); this.stepZones();
    for (const h of this.heroes.values()) {
      if (this.over) break;
      if (h.kills >= RULES.kills) this.over = { winner: h.team, reason: `${RULES.kills} kills` };
      else if (h.cs >= RULES.cs) this.over = { winner: h.team, reason: `${RULES.cs} minions` };
    }
  }
  spawnWave() {
    for (const team of ['blue', 'red']) {
      const dir = team === 'blue' ? 1 : -1, sx = MAP.spawn[team].x + dir * 380;
      for (let i = 0; i < 6; i++) {
        const melee = i < 3, off = ((i % 3) - 1) * 90;
        this.add({ type: 'minion', team, melee, x: sx - dir * (melee ? 0 : 180), y: MAP.mid + off, laneY: MAP.mid + off,
          radius: 32, hp: melee ? 480 : 290, mhp: melee ? 480 : 290, ad: melee ? 12 : 23, armor: 0, mr: 0, ms: 325,
          range: melee ? 110 : 550, as: melee ? 1.25 : 0.67, windupT: melee ? 0.3 : 0.4, projSpeed: 650,
          gold: melee ? 21 : 14, xp: melee ? 60 : 30, targetId: 0, aggroUntil: 0 });
      }
    }
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
    if (u.type === 'tower' && t.type === 'hero') { dmg *= 1 + 0.4 * u.heat; u.heat = Math.min(3, u.heat + 1); }
    if (u.type === 'hero') {
      if (u.emp && u.emp.until > this.time) { dmg += u.emp.bonus; this.addBuff(t, 'slow', 0.35, 1.5); u.emp = null; }
      if (u.chill > this.time) { this.addBuff(t, 'slow', 0.4, 1.5); u.chill = 0; }
      if (t.mark && t.mark.by === u.id && t.mark.until > this.time) { dmg += t.mark.dmg; t.mark = null; }
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
    if (h.dead) {
      if (T >= h.respawnAt) { h.dead = false; h.hp = h.mhp; h.mp = h.mmp; h.x = sp.x; h.y = sp.y; h.order = null; }
      return;
    }
    h.gold += RULES.goldPerSec * DT;
    const home = this.dist(h, sp) < MAP.fountainR;
    h.hp = Math.min(h.mhp, h.hp + (h.def.hpRegen + (home ? h.mhp * 0.1 : 0) + (h.potionUntil > T ? 15 : 0)) * DT);
    h.mp = Math.min(h.mmp, h.mp + (h.def.manaRegen + (home ? h.mmp * 0.1 : 0)) * DT);
    const es = MAP.spawn[other(h.team)];
    if (this.dist(h, es) < MAP.fountainR) this.damage(null, h, 400 * DT, 'true');
    if (h.dead || T < h.stunUntil) return;
    if (h.dashing) return this.stepDash(h);
    if (h.casting) { if (T >= h.casting.at) { const f = h.casting.fire; h.casting = null; f(); } return; }
    if (h.recall) {
      if (T >= h.recall.at) { h.recall = null; h.x = sp.x; h.y = sp.y; h.order = null; this.fx({ e: 'blink', x: h.x, y: h.y }); }
      return;
    }
    if (h.bot) return this.stepBot(h);
    if (this.stepWindup(h)) return;
    const o = h.order;
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
  stepMinion(m) {
    if (this.time < m.stunUntil || this.stepWindup(m)) return;
    let t = this.units.get(m.targetId);
    const forced = m.aggroUntil > this.time;
    if (!this.targetable(m, t) || this.dist(m, t) - t.radius > (forced ? 900 : 700)) t = null;
    if (!t || (!forced && (this.time * TICK | 0) % 15 === m.id % 15)) t = this.nearestEnemy(m, 600) || t;
    m.targetId = t ? t.id : 0;
    if (t) return this.engage(m, t);
    const goal = MAP.spawn[other(m.team)];
    const dir = m.team === 'blue' ? 1 : -1;
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
          s.x += s.dx * st / n; s.y += s.dy * st / n;
          for (const t of this.enemiesIn(s.team, s.x, s.y, s.w / 2)) {
            if (s.hit.has(t.id)) continue;
            s.hit.add(t.id); s.onHit(t);
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
      this.fx({ e: 'burst', x: z.x, y: z.y, r: z.r, c: z.color });
      for (const t of this.enemiesIn(z.team, z.x, z.y, z.r)) z.onHit(t);
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
      if (u.type === 'minion') { o.m = u.melee ? 1 : 0; o.f = +u.face.toFixed(2); }
      if (u.type === 'tower') o.tg = u.targetId;
      if (u.type === 'hero') Object.assign(o, { h: u.hero, n: u.name, lvl: u.lvl, mp: r(u.mp), mmp: r(u.mmp), f: +u.face.toFixed(2),
        d: u.dead ? Math.ceil(u.respawnAt - T) : 0, st: T < u.stunUntil ? 1 : 0, rt: T < u.rootUntil ? 1 : 0,
        sl: this.buffMax(u, 'slow') > 0 ? 1 : 0, sh: u.shieldUntil > T ? r(u.shieldAmt) : 0,
        rc: u.recall ? +(1 - (u.recall.at - T) / 8).toFixed(2) : 0, br: this.brushOf(u) >= 0 ? 1 : 0,
        mk: u.mark && u.mark.until > T ? 1 : 0, kl: u.kills, cs: u.cs });
      units.push(o);
    }
    const snap = { t: 'snap', time: +T.toFixed(3), units,
      shots: this.shots.map(s => ({ id: s.id, x: r(s.x), y: r(s.y), w: s.w, t: s.team[0], c: s.color, s: s.style,
        a: +(s.kind === 'home' ? Math.atan2(s.target.y - s.y, s.target.x - s.x) : Math.atan2(s.dy, s.dx)).toFixed(2) })),
      zones: this.zones.map(z => ({ id: z.id, x: z.x | 0, y: z.y | 0, r: z.r, t: z.team[0], c: z.color,
        p: +Math.min(1, (T - z.born) / Math.max(0.01, z.at - z.born)).toFixed(2) })),
      ev: this.events.filter(e => e.p === undefined || e.p === pid), over: this.over };
    if (me) snap.me = { id: me.id, gold: Math.floor(me.gold), xp: r(me.xp), xpn: xpToNext(me.lvl), pts: me.points, ranks: me.ranks,
      cds: me.cds.map(c => Math.max(0, +(c - T).toFixed(1))), sd: Math.max(0, r(me.spellCds.d - T)), sf: Math.max(0, r(me.spellCds.f - T)),
      items: me.items, ad: r(me.ad), ap: r(me.ap), ar: r(me.armor), mr: r(me.mr), ms: r(this.speed(me)), as: +this.atkSpeed(me).toFixed(2),
      range: me.range, shop: me.dead || this.dist(me, MAP.spawn[me.team]) <= MAP.fountainR };
    return snap;
  }
}
