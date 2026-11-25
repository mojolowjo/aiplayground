// The battle simulation. Deterministic: the same seed and the same card plays give the same match
// in every browser and in Node, so online play only has to send card plays.
//
// Rules that keep it identical everywhere (from the online plan):
//   - all game state is integers: positions in 1/1000 of a tile, time in ticks, Spark in 1/168 of a Spark;
//   - only + - * / and Math.sqrt (all exactly rounded in every JS engine), never sin/cos/pow;
//   - one seeded random generator, stored in the state;
//   - units are always processed in array order, which is spawn order.
// The whole state is plain JSON (`battle.s`), so a snapshot is a deep copy and rollback is "copy it back".
import { ARENA, TOWERS, SPEED, BODY, SIGHT, DEPLOY, SPELL_TOWER_PCT, ALL_CARDS as CARDS, TOKENS, LEVEL_PCT } from './cards.js';

export const TPS = 20;                          // ticks per second
export const MT = 1000;                         // game units per tile
export const SPARK = 168;                       // game units per Spark: +3 a tick is 1 per 2.8 s, +6 is 1 per 1.4 s, +9 is 1 per 0.93 s
export const MAX_SPARK = 10 * SPARK;
const T = v => Math.round(v * MT);
const S = v => Math.round(v * TPS);
export const W = T(ARENA.w), H = T(ARENA.h);
const RIVER_TOP = T(ARENA.riverTop), RIVER_BOTTOM = T(ARENA.riverBottom), MID_Y = (RIVER_TOP + RIVER_BOTTOM) / 2;
const BRIDGE_HALF = T(ARENA.bridgeHalf);
export const LANES_X = ARENA.lanesX.map(T);
const MID_X = W / 2;
export const isqrt = n => Math.floor(Math.sqrt(n));
const trunc = Math.trunc;

export const DEFAULT_SETTINGS = {
  length: 180,          // seconds of regulation
  overtime: 120,        // seconds of sudden death on a tie (0 for none)
  spark: 'normal',      // 'normal' (double in the last minute), 'double', 'triple'
  startSpark: 5,
  towerPct: 100,        // tower health, percent
  tie: 'tiebreak',      // after overtime: 'tiebreak', 'extend' (both must agree), 'draw'
};

// ---------- card definitions in game units ----------
function prep(def) {
  const body = BODY[def.body] || BODY.small;
  return {
    ...def,
    r: T(body.r), mass: body.mass,
    range: def.range != null ? T(def.range) : 0,
    sight: Math.max(T(SIGHT), def.range != null ? T(def.range) : 0),
    speed: def.speed ? Math.round(SPEED[def.speed] * MT / TPS) : 0,
    hitT: def.hit ? S(def.hit) : 0,
    radius: def.radius != null ? T(def.radius) : 0,
    delayT: def.delay != null ? S(def.delay) : 0,
    lifeT: def.life ? S(def.life) : 0,
    splash: def.splash ? T(def.splash) : 0,
    offsets: (def.offsets || [[0, 0]]).map(([x, y]) => [T(x), T(y)]),
    count: def.count || 1,
  };
}
export const DEF = {};
for (const [id, c] of Object.entries(CARDS)) DEF[id] = prep(c);
for (const [id, c] of Object.entries(TOKENS)) DEF[id] = prep(c);
for (const [id, t] of Object.entries(TOWERS)) DEF['tower_' + id] = { ...t, r: T(t.r), mass: 1e9, range: T(t.range) - T(t.r), sight: T(t.range) - T(t.r), hitT: S(t.hit), targets: 'both' };   // tower range is measured from its centre

// Where each side's towers stand. Side 0 is blue at the bottom, side 1 is red at the top.
export function towerSpots(side) {
  const y = v => side === 0 ? v : H - v;
  return [
    { type: 'watch', lane: 0, x: LANES_X[0], y: y(T(26)) },
    { type: 'watch', lane: 1, x: LANES_X[1], y: y(T(26)) },
    { type: 'keep', lane: -1, x: MID_X, y: y(T(28.5)) },
  ];
}

// ---------- random numbers (mulberry32, state kept in the battle) ----------
function rand(s) {
  let t = (s.rng = (s.rng + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0);
}

// ---------- helpers ----------
export const band = y => y < RIVER_TOP ? -1 : y >= RIVER_BOTTOM ? 1 : 0;   // -1 top half, 0 river, 1 bottom half
export const ownY = (side, y) => side === 0 ? y : H - y;                    // a y measured from that side's own back edge
const nearBridge = x => Math.abs(x - LANES_X[0]) <= Math.abs(x - LANES_X[1]) ? LANES_X[0] : LANES_X[1];
export const laneOf = x => x < MID_X ? 0 : 1;
export function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return isqrt(dx * dx + dy * dy); }
export const edge = (a, b) => dist(a, b) - a.r - b.r;
const lvlPct = lvl => LEVEL_PCT[Math.max(1, Math.min(9, lvl | 0))];

// Where a card may be dropped. Returns [x, y] moved to the nearest allowed point, or null for a bad card.
export function clampDrop(s, side, card, x, y) {
  const d = DEF[card]; if (!d) return null;
  x = Math.max(T(0.5), Math.min(W - T(0.5), trunc(x) || 0));
  y = Math.max(T(0.5), Math.min(H - T(0.5), trunc(y) || 0));
  if (d.type === 'spell') return [x, y];
  let oy = ownY(side, y);
  const opened = s.players[side].opened;                      // lanes where the enemy Watchtower is down
  const minOy = opened[laneOf(x)] ? RIVER_TOP - T(ARENA.zonePush) + T(0.5) : RIVER_BOTTOM + T(0.5);
  oy = Math.max(minOy, Math.min(H - T(0.5), oy));
  y = side === 0 ? oy : H - oy;
  if (band(y) === 0 && Math.abs(x - nearBridge(x)) > BRIDGE_HALF - d.r) {     // in the river but not on a bridge: step onto the bank
    oy = RIVER_BOTTOM + T(0.5); y = side === 0 ? oy : H - oy;
  }
  // Not inside a tower.
  for (const u of s.units) if (u.kind === 'tower') {
    const dx = x - u.x, dy = y - u.y, need = u.r + d.r, dd = isqrt(dx * dx + dy * dy);
    if (dd < need) { if (dd === 0) { y += side === 0 ? -need : need; } else { x = u.x + trunc(dx * need / dd); y = u.y + trunc(dy * need / dd); } }
  }
  return [x, y];
}

// ---------- the battle ----------
export class Battle {
  // opts: { seed, decks: [[8 ids], [8 ids]], levels: [{id: lvl}, {id: lvl}], towerLevels: [n, n], settings }
  constructor(opts) {
    this.events = [];
    if (opts.state) { this.s = opts.state; return; }
    const settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    const s = this.s = {
      tick: 0, rng: (opts.seed >>> 0) || 1, nextId: 1, over: false, winner: null, reason: '',
      settings, ot: false, vote: null, extraEnd: 0,
      players: [], units: [], shots: [], spells: [], zones: [], pending: [], seq: 0,
    };
    for (let side = 0; side < 2; side++) {
      const deck = opts.decks[side].slice(0, 8);
      for (let i = deck.length - 1; i > 0; i--) { const j = rand(s) % (i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }   // shuffle the starting order
      s.players.push({
        spark: Math.min(MAX_SPARK, settings.startSpark * SPARK), hand: deck.slice(0, 4), queue: deck.slice(4),
        levels: { ...(opts.levels?.[side] || {}) }, towerLevel: opts.towerLevels?.[side] || 1,
        banners: 0, opened: [false, false], played: 0,
      });
    }
    for (let side = 0; side < 2; side++) for (const t of towerSpots(side)) {
      const d = DEF['tower_' + t.type], pct = lvlPct(s.players[side].towerLevel) * settings.towerPct / 100;
      const hp = trunc(d.hp * pct / 100);
      this.add({ kind: 'tower', card: 'tower_' + t.type, type: t.type, lane: t.lane, side, x: t.x, y: t.y, r: d.r, mass: d.mass,
        hp, maxHp: hp, dmg: trunc(d.dmg * lvlPct(s.players[side].towerLevel) / 100), awake: t.type !== 'keep' });
    }
  }

  get tick() { return this.s.tick; }
  level(side, card) { return this.s.players[side].levels[card] || 1; }
  next(side) { return this.s.players[side].queue[0]; }

  // Is this play allowed right now? Used by the UI, the bot and the server before sending.
  canPlay(side, card) {
    const s = this.s, p = s.players[side];
    return !s.over && !s.vote && !!DEF[card] && p.hand.includes(card) && p.spark >= CARDS[card].cost * SPARK;
  }

  // Queue a command for a tick. { tick, side, type: 'play', card, x, y } or { tick, side, type: 'extend', yes }.
  // Commands are applied at the start of their tick, side 0 first, then in the order they were queued.
  schedule(cmd) {
    const s = this.s;
    const c = { tick: Math.max(s.tick, cmd.tick | 0), side: cmd.side ? 1 : 0, type: String(cmd.type), card: cmd.card, x: cmd.x | 0, y: cmd.y | 0, yes: !!cmd.yes, seq: s.seq++ };
    s.pending.push(c);
    s.pending.sort((a, b) => a.tick - b.tick || a.side - b.side || a.seq - b.seq);
  }

  // ---------- one tick ----------
  step() {
    const s = this.s;
    if (s.over) return;
    while (s.pending.length && s.pending[0].tick <= s.tick) this.apply(s.pending.shift());
    if (s.vote) { if (s.tick >= s.vote.until) this.decideVote(); s.tick++; return; }   // the battle waits while both players decide
    this.regen();
    this.updateSpells();
    this.updateZones();
    this.auras();
    for (let i = 0; i < s.units.length; i++) this.updateUnit(s.units[i]);
    this.updateShots();
    this.collide();
    this.reap();
    s.tick++;
    this.clock();
  }

  apply(c) {
    const s = this.s, p = s.players[c.side];
    if (c.type === 'extend') {
      if (s.vote) { s.vote.yes[c.side] = c.yes ? 1 : -1; if (s.vote.yes.includes(-1) || s.vote.yes.every(v => v === 1)) this.decideVote(); }
      return;
    }
    if (c.type !== 'play' || !this.canPlay(c.side, c.card)) return;
    const at = clampDrop(s, c.side, c.card, c.x, c.y); if (!at) return;
    const def = DEF[c.card];
    p.spark -= CARDS[c.card].cost * SPARK;
    const slot = p.hand.indexOf(c.card);
    p.hand[slot] = p.queue.shift(); p.queue.push(c.card); p.played++;
    const lvl = this.level(c.side, c.card);
    this.events.push({ e: 'play', side: c.side, card: c.card, x: at[0], y: at[1] });
    if (def.type === 'spell') {
      const from = s.units.find(u => u.kind === 'tower' && u.type === 'keep' && u.side === c.side) || { x: MID_X, y: c.side ? 0 : H };
      s.spells.push({ side: c.side, card: c.card, x: at[0], y: at[1], fx: from.x, fy: from.y, left: def.delayT, total: def.delayT, lvl });
    } else this.spawn(c.side, c.card, lvl, at[0], at[1], S(DEPLOY));
  }

  regen() {
    const s = this.s, base = { normal: 1, double: 2, triple: 3 }[s.settings.spark] || 1, L = s.settings.length * TPS;
    let mult = base;
    if (!s.ot) { if (s.tick >= L - 60 * TPS) mult = Math.max(base, 2); }
    else { const end = s.extraEnd || L + s.settings.overtime * TPS; mult = s.extraEnd || s.tick >= end - 60 * TPS ? 3 : Math.max(base, 2); }
    for (const p of s.players) p.spark = Math.min(MAX_SPARK, p.spark + 3 * mult);
  }

  add(u) {
    const s = this.s;
    const unit = { id: s.nextId++, kind: 'troop', type: '', lane: 0, air: false, hp: 1, maxHp: 1, shield: 0, dmg: 0,
      target: 0, locked: false, cd: 0, deploy: 0, frozen: 0, stun: 0, slow: 0, haste: false, hidden: false,
      run: 0, pulled: false, rolled: [], age: 0, spawnCd: 0, awake: true, ...u };
    s.units.push(unit);
    return unit;
  }

  spawn(side, card, lvl, x, y, deploy, count) {
    const d = DEF[card], pct = lvlPct(lvl);
    const flip = side === 0 ? 1 : -1;                      // offsets are written for the bottom player
    const made = [];
    for (let i = 0; i < (count || d.count); i++) {
      const [ox, oy] = count ? [0, 0] : d.offsets[i % d.offsets.length];
      const hp = trunc(d.hp * pct / 100);
      const ux = Math.max(d.r, Math.min(W - d.r, x + ox)), uy = Math.max(d.r, Math.min(H - d.r, y + oy * flip));
      made.push(this.add({ kind: d.type === 'building' ? 'building' : 'troop', card, side, lvl, x: ux, y: uy, r: d.r, mass: d.mass, air: !!d.air,
        hp, maxHp: hp, shield: d.shield ? trunc(d.shield * pct / 100) : 0, dmg: trunc((d.dmg || 0) * pct / 100),
        deploy, hidden: !!d.stealth, lane: laneOf(ux), spawnCd: d.spawn ? S(d.spawn.first) : 0 }));
    }
    this.events.push({ e: 'spawn', side, card, x, y });
    return made;
  }

  // ---------- spells ----------
  updateSpells() {
    const s = this.s;
    for (const sp of s.spells) if (sp.left-- <= 0) this.castSpell(sp);
    s.spells = s.spells.filter(sp => sp.left >= 0);
  }
  castSpell(sp) {
    const s = this.s, d = DEF[sp.card], pct = lvlPct(sp.lvl);
    this.events.push({ e: 'spell', side: sp.side, card: sp.card, x: sp.x, y: sp.y, r: d.radius });
    const c = { x: sp.x, y: sp.y, r: 0 };
    for (const u of s.units) {
      if (u.side === sp.side || u.hp <= 0 || edge(c, u) > d.radius) continue;
      if (d.dmg) {
        let dmg = trunc(d.dmg * pct / 100);
        if (u.kind === 'tower') dmg = trunc(dmg * SPELL_TOWER_PCT / 100);
        this.damage(u, dmg, true);
      }
      if (d.freeze) { u.frozen = Math.max(u.frozen, S(d.freeze)); this.reset(u); }
      if (d.push && u.kind === 'troop') { this.shove(u, sp.x, sp.y, T(d.push)); this.reset(u); }
    }
  }

  // ---------- puddles ----------
  updateZones() {
    const s = this.s;
    for (const u of s.units) u.slow = 0;
    for (const z of s.zones) {
      for (const u of s.units) if (u.side !== z.side && u.kind === 'troop' && !u.air && dist(u, z) <= z.r + u.r) u.slow = Math.max(u.slow, z.slow);
      z.left--;
    }
    s.zones = s.zones.filter(z => z.left > 0);
  }

  // Banner Captain: allies near a captain move and attack faster.
  auras() {
    const s = this.s;
    for (const u of s.units) u.haste = 0;
    for (const c of s.units) {
      const a = DEF[c.card].aura;
      if (!a || c.hp <= 0 || c.deploy > 0) continue;
      for (const u of s.units) if (u.side === c.side && u.kind === 'troop' && u.hp > 0 && dist(u, c) <= T(a.r)) u.haste = Math.max(u.haste, a.pct);
    }
  }

  // How fast a unit's clock runs this tick, in 1/1000: 1000 normal, 1150 hasted, 650 slowed.
  rate(u) { return trunc(1000 * (100 + u.haste) * (100 - u.slow) / 10000); }

  // ---------- targeting ----------
  canHit(u, t) {
    if (t.side === u.side || t.hp <= 0 || t.hidden) return false;
    const f = u.kind === 'tower' ? 'both' : DEF[u.card].targets;
    if (f === 'buildings') return t.kind !== 'troop';
    if (f === 'ground') return !t.air;
    return true;
  }
  findTarget(u) {
    const s = this.s, d = u.kind === 'tower' ? DEF[u.card] : DEF[u.card];
    const sight = u.kind === 'troop' ? (d.targets === 'buildings' ? T(7) : d.sight) : d.range;
    let best = null, bestD = Infinity;
    for (const t of s.units) {
      if (!this.canHit(u, t)) continue;
      const e = edge(u, t);
      if (e <= sight && (e < bestD || (e === bestD && t.id < best.id))) { best = t; bestD = e; }
    }
    return best;
  }
  reset(u) { u.target = 0; u.locked = false; u.run = 0; }
  byId(id) { if (!id) return null; for (const u of this.s.units) if (u.id === id) return u; return null; }

  // ---------- units ----------
  updateUnit(u) {
    const s = this.s;
    if (u.hp <= 0) return;
    u.age++;
    if (u.deploy > 0) { u.deploy--; return; }
    if (u.kind === 'building') {
      const d = DEF[u.card];
      const lose = trunc(u.age * u.maxHp / d.lifeT) - trunc((u.age - 1) * u.maxHp / d.lifeT);    // buildings fade over their lifetime
      u.hp -= lose;
      if (u.hp <= 0) return;
    }
    if (u.frozen > 0) { u.frozen--; return; }
    if (u.stun > 0) { u.stun--; return; }
    if (u.kind === 'tower' && !u.awake) return;
    const d = DEF[u.card];
    if (d.spawn) {                                          // Hive Spire
      if (--u.spawnCd <= 0) {
        u.spawnCd = S(d.spawn.every);
        const dy = u.side === 0 ? -T(1) : T(1);
        for (let i = 0; i < d.spawn.n; i++) this.spawn(u.side, d.spawn.card, u.lvl, u.x + (i ? T(0.5) : -T(0.5)), u.y + dy, 0, 1);
      }
      return;
    }
    if (!u.dmg) return;
    let t = this.byId(u.target);
    if (t && !this.canHit(u, t)) { t = null; this.reset(u); }
    const range = u.kind === 'tower' ? DEF[u.card].range : d.range;
    if (t && u.locked && edge(u, t) > range + T(0.5)) { t = null; this.reset(u); }     // locked targets are kept until they leave range
    if (!t || (!u.locked && (s.tick + u.id) % 5 === 0)) {
      const n = this.findTarget(u);
      if (n && n !== t) { t = n; u.target = n.id; u.locked = false; }
    }
    const rate = this.rate(u);
    if (t && edge(u, t) <= range) {
      if (!u.locked) { u.locked = true; u.cd = trunc((u.kind === 'tower' ? DEF[u.card].hitT : d.hitT) * 1000 / 2); }
      u.cd -= rate;
      if (u.cd <= 0) { u.cd += (u.kind === 'tower' ? DEF[u.card].hitT : d.hitT) * 1000; this.attack(u, t); }
      return;
    }
    if (u.kind !== 'troop') return;
    u.locked = false;
    const speed = trunc(d.speed * rate / 1000);
    const goal = t || this.laneGoal(u);
    if (goal) this.moveToward(u, goal.x, goal.y, speed);
  }

  laneGoal(u) {
    const s = this.s;
    const lane = laneOf(u.x);
    let best = null, bestD = Infinity;
    for (const t of s.units) {
      if (t.side === u.side || t.kind !== 'tower' || t.hp <= 0) continue;
      if (t.type === 'watch' && t.lane !== lane) continue;
      const dd = dist(u, t);
      if (t.type === 'watch') return t;                      // the lane's Watchtower first
      if (dd < bestD) { best = t; bestD = dd; }
    }
    return best;
  }

  moveToward(u, gx, gy, speed) {
    let tx = gx, ty = gy;
    if (!u.air) [tx, ty] = this.waypoint(u, gx, gy);
    const dx = tx - u.x, dy = ty - u.y, dd = isqrt(dx * dx + dy * dy);
    if (dd === 0) return;
    const step = Math.min(dd, speed);
    u.x += trunc(dx * step / dd); u.y += trunc(dy * step / dd);
    u.run += step;
    const roll = DEF[u.card].roll;
    if (roll) for (const o of this.s.units)                  // Boulder Roller flattens small units it rolls over
      if (o.side !== u.side && o.kind === 'troop' && !o.air && o.mass <= 3 && o.hp > 0 && !u.rolled.includes(o.id) && dist(u, o) <= u.r + o.r) {
        u.rolled.push(o.id); this.damage(o, trunc(roll * lvlPct(u.lvl) / 100), false);
      }
  }

  // Ground units cross the river only on a bridge.
  waypoint(u, gx, gy) {
    const ub = band(u.y), gb = band(gy);
    if (ub === gb && ub !== 0) return [gx, gy];
    const bx = nearBridge(u.x), onBridgeX = Math.abs(u.x - bx) <= BRIDGE_HALF - u.r;
    const up = gy < u.y;
    if (ub === 0) return gb === 0 ? [gx, gy] : [onBridgeX ? u.x : bx, up ? RIVER_TOP - T(0.3) : RIVER_BOTTOM + T(0.3)];
    if (gb === 0 && onBridgeX && Math.abs(gx - bx) <= BRIDGE_HALF) return [gx, gy];
    const bankY = ub === 1 ? RIVER_BOTTOM + T(0.3) : RIVER_TOP - T(0.3);
    if (onBridgeX && Math.abs(u.y - bankY) <= T(0.6)) return [u.x, ub === 1 ? RIVER_TOP - T(0.3) : RIVER_BOTTOM + T(0.3)];
    return [bx, bankY];
  }

  attack(u, t) {
    const d = DEF[u.card];
    u.hidden = false;
    let dmg = u.dmg;
    if (d.charge && u.run >= T(d.charge)) { dmg *= 2; this.events.push({ e: 'charge', id: u.id }); }
    u.run = 0;
    const ranged = u.kind === 'tower' || d.range > T(1.5);
    this.events.push({ e: 'attack', id: u.id, target: t.id });
    if (!ranged) return this.hit(u.id, u.side, u.card, t, dmg, t.x, t.y, u.x, u.y, !u.pulled);
    const speed = u.kind === 'tower' ? T(14) / TPS : T(11) / TPS;
    this.s.shots.push({ from: u.id, side: u.side, card: u.card, target: t.id, x: u.x, y: u.y, tx: t.x, ty: t.y, speed: trunc(speed), dmg, first: !u.pulled, sx: u.x, sy: u.y });
    u.pulled = true;
  }

  updateShots() {
    const s = this.s, keep = [];
    for (const p of s.shots) {
      const t = this.byId(p.target);
      if (t && t.hp > 0) { p.tx = t.x; p.ty = t.y; }
      const dx = p.tx - p.x, dy = p.ty - p.y, dd = isqrt(dx * dx + dy * dy);
      if (dd <= p.speed) { this.hit(p.from, p.side, p.card, t && t.hp > 0 ? t : null, p.dmg, p.tx, p.ty, p.sx, p.sy, p.first); continue; }
      p.x += trunc(dx * p.speed / dd); p.y += trunc(dy * p.speed / dd);
      keep.push(p);
    }
    s.shots = keep;
  }

  // A blow lands: direct damage, splash, chain lightning, knockback, harpoon pull.
  hit(fromId, side, card, t, dmg, x, y, sx, sy, first) {
    const s = this.s, d = DEF[card];
    const src = this.byId(fromId) || { side, kind: card.startsWith('tower_') ? 'tower' : 'troop', card, x: sx, y: sy };
    if (d.splash) {
      const c = { x, y, r: 0 };
      this.events.push({ e: 'splash', x, y, r: d.splash, side });
      for (const o of s.units) if (o.side !== side && o.hp > 0 && this.canHitAny(src, o) && edge(c, o) <= d.splash) this.damage(o, dmg, false);
      return;
    }
    if (!t) return;
    this.damage(t, dmg, false);
    if (d.chain) {
      const hitIds = [t.id]; let last = t;
      for (let j = 0; j < d.chain.jumps; j++) {
        let best = null, bestD = Infinity;
        for (const o of s.units) {
          if (hitIds.includes(o.id) || !this.canHitAny(src, o) || o.hp <= 0) continue;
          const e = dist(last, o);
          if (e <= T(d.chain.r) && e < bestD) { best = o; bestD = e; }
        }
        if (!best) break;
        this.events.push({ e: 'zap', x1: last.x, y1: last.y, x2: best.x, y2: best.y });
        this.damage(best, trunc(dmg * d.chain.pct / 100), false);
        hitIds.push(best.id); last = best;
      }
    }
    if (d.knock && t.kind === 'troop' && t.hp > 0) { this.shove(t, sx, sy, T(d.knock)); this.reset(t); }
    if (d.pull && first && t.kind === 'troop' && t.hp > 0) { this.shove(t, sx, sy, -T(d.pull)); this.reset(t); }
  }
  // Like canHit but ignores stealth for splash and chains that land on a hidden unit's spot (a hidden unit can still be splashed).
  canHitAny(u, t) {
    if (t.side === u.side || t.hp <= 0) return false;
    const f = u.kind === 'tower' ? 'both' : DEF[u.card].targets;
    if (f === 'buildings') return t.kind !== 'troop';
    if (f === 'ground') return !t.air;
    return true;
  }

  // Move a unit `by` away from (x, y); a negative `by` pulls it closer.
  shove(u, x, y, by) {
    const dx = u.x - x, dy = u.y - y, dd = isqrt(dx * dx + dy * dy);
    if (dd === 0) { u.y += u.side === 0 ? by : -by; }
    else { const m = by < 0 ? Math.max(by, -(dd - T(1))) : by; u.x += trunc(dx * m / dd); u.y += trunc(dy * m / dd); }
    this.bound(u);
  }

  damage(u, amount, spell) {
    if (u.hp <= 0 || amount <= 0) return;
    if (spell && DEF[u.card].spellWeak) amount = trunc(amount * (100 + DEF[u.card].spellWeak) / 100);
    if (u.shield > 0) { const a = Math.min(u.shield, amount); u.shield -= a; amount -= a; }
    u.hp -= amount;
    if (u.kind === 'tower' && u.type === 'keep') u.awake = true;
    this.events.push({ e: 'hurt', id: u.id, x: u.x, y: u.y, n: amount });
  }

  // ---------- pushing ----------
  collide() {
    const us = this.s.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i]; if (a.hp <= 0) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j]; if (b.hp <= 0 || a.air !== b.air) continue;
        const aFixed = a.kind !== 'troop', bFixed = b.kind !== 'troop';
        if (aFixed && bFixed) continue;
        if ((DEF[a.card].roll && b.side !== a.side && b.mass <= 3) || (DEF[b.card].roll && a.side !== b.side && a.mass <= 3)) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        const need = a.r + b.r;
        if (Math.abs(dx) >= need || Math.abs(dy) >= need) continue;
        let d2 = dx * dx + dy * dy;
        if (d2 >= need * need) continue;
        if (d2 === 0) { dx = (a.id & 1) ? 1 : -1; dy = 0; d2 = 1; }
        const dd = Math.max(1, isqrt(d2)), over = need - dd;
        const ma = aFixed ? 1e9 : (a.frozen || a.stun ? a.mass * 4 : a.mass), mb = bFixed ? 1e9 : (b.frozen || b.stun ? b.mass * 4 : b.mass);
        const pa = aFixed ? 0 : bFixed ? over : trunc(over * mb / (ma + mb));
        const pb = over - pa;
        if (pa) { a.x -= trunc(dx * pa / dd); a.y -= trunc(dy * pa / dd); }
        if (pb && !bFixed) { b.x += trunc(dx * pb / dd); b.y += trunc(dy * pb / dd); }
      }
    }
    for (const u of us) if (u.kind === 'troop') this.bound(u);
  }
  bound(u) {
    u.x = Math.max(u.r, Math.min(W - u.r, u.x)); u.y = Math.max(u.r, Math.min(H - u.r, u.y));
    if (!u.air && band(u.y) === 0) {
      const bx = nearBridge(u.x);
      if (Math.abs(u.x - bx) > BRIDGE_HALF - u.r) {
        // Off the bridge: if it is mostly over the bridge, slide it back on; otherwise put it back on its bank.
        if (Math.abs(u.x - bx) < BRIDGE_HALF + u.r) u.x = u.x < bx ? bx - BRIDGE_HALF + u.r : bx + BRIDGE_HALF - u.r;
        else u.y = u.y < MID_Y ? RIVER_TOP - 1 : RIVER_BOTTOM;
      }
    }
  }

  // ---------- deaths, banners, the clock ----------
  reap() {
    const s = this.s;
    const dead = s.units.filter(u => u.hp <= 0);
    if (!dead.length) return;
    s.units = s.units.filter(u => u.hp > 0);
    for (const u of dead) {
      const d = DEF[u.card];
      this.events.push({ e: 'die', id: u.id, card: u.card, side: u.side, x: u.x, y: u.y, kind: u.kind });
      for (const o of s.units) if (o.target === u.id) this.reset(o);
      if (d.puddle) s.zones.push({ type: 'puddle', side: u.side, x: u.x, y: u.y, r: T(d.puddle.r), slow: d.puddle.slow, left: S(d.puddle.time) });
      if (d.root) for (const o of s.units) if (o.side !== u.side && o.kind === 'troop' && dist(o, u) <= T(d.root.r)) { o.stun = Math.max(o.stun, S(d.root.time)); this.reset(o); }
      if (d.root) this.events.push({ e: 'root', x: u.x, y: u.y, r: T(d.root.r) });
      if (d.split) this.spawn(u.side, d.split, u.lvl, u.x, u.y, 0);
      if (u.kind === 'tower') this.towerDown(u);
    }
  }
  towerDown(t) {
    const s = this.s, foe = 1 - t.side, p = s.players[foe];
    if (t.type === 'keep') { p.banners = 3; this.end(foe, 'keep'); return; }
    p.banners++;
    p.opened[t.lane] = true;
    for (const k of s.units) if (k.kind === 'tower' && k.type === 'keep' && k.side === t.side) k.awake = true;
    if (s.ot && !s.over) this.end(foe, 'sudden death');
  }
  clock() {
    const s = this.s; if (s.over) return;
    const L = s.settings.length * TPS, OT = s.settings.overtime * TPS;
    const [a, b] = s.players.map(p => p.banners);
    if (!s.ot && s.tick >= L) {
      if (a !== b) return this.end(a > b ? 0 : 1, 'time');
      if (OT > 0) { s.ot = true; this.events.push({ e: 'overtime' }); return; }
      return this.tie();
    }
    if (s.ot && !s.vote && s.tick >= (s.extraEnd || L + OT)) this.tie();
  }
  tie() {
    const s = this.s, rule = s.settings.tie;
    if (rule === 'draw') return this.end(-1, 'draw');
    if (rule === 'extend') { s.vote = { until: s.tick + 10 * TPS, yes: [0, 0] }; this.events.push({ e: 'vote' }); return; }
    this.tiebreak();
  }
  decideVote() {
    const s = this.s, v = s.vote; s.vote = null;
    if (v.yes[0] === 1 && v.yes[1] === 1) { s.extraEnd = s.tick + 60 * TPS; this.events.push({ e: 'extended' }); }
    else this.tiebreak();
  }
  tiebreak() {
    const s = this.s;
    const weakest = side => {
      let m = Infinity;
      for (const u of s.units) if (u.kind === 'tower' && u.side === side) m = Math.min(m, trunc(u.hp * 1000 / u.maxHp));
      return m === Infinity ? 0 : m;
    };
    const w0 = weakest(0), w1 = weakest(1);
    this.end(w0 === w1 ? -1 : w0 > w1 ? 0 : 1, 'tiebreak');
  }
  end(winner, reason) {
    const s = this.s; if (s.over) return;
    s.over = true; s.winner = winner; s.reason = reason; s.vote = null;
    this.events.push({ e: 'end', winner, reason });
  }

  // ---------- info for the screen, the bot and the network ----------
  timeLeft() {
    const s = this.s, L = s.settings.length * TPS, OT = s.settings.overtime * TPS;
    if (!s.ot) return Math.max(0, L - s.tick);
    return Math.max(0, (s.extraEnd || L + OT) - s.tick);
  }
  sparkMult() {
    const s = this.s, base = { normal: 1, double: 2, triple: 3 }[s.settings.spark] || 1, L = s.settings.length * TPS;
    if (!s.ot) return s.tick >= L - 60 * TPS ? Math.max(base, 2) : base;
    return s.extraEnd || this.timeLeft() <= 60 * TPS ? 3 : Math.max(base, 2);
  }
  // A short checksum of everything that matters, to spot two sims that have drifted apart.
  hash() {
    const s = this.s;
    let h = 0x811c9dc5;
    const mix = n => { h ^= n & 0xffff; h = Math.imul(h, 16777619); h ^= (n >>> 16) & 0xffff; h = Math.imul(h, 16777619); };
    mix(s.tick); mix(s.rng);
    for (const p of s.players) { mix(p.spark); mix(p.banners); }
    for (const u of s.units) { mix(u.id); mix(u.x); mix(u.y); mix(u.hp); mix(u.target); }
    for (const p of s.shots) { mix(p.x); mix(p.y); }
    return h >>> 0;
  }
  snapshot() { return JSON.parse(JSON.stringify(this.s)); }
  restore(state) { this.s = JSON.parse(JSON.stringify(state)); this.events = []; }
}
