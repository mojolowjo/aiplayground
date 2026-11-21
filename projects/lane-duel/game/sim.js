// Authoritative game simulation. No networking in here.
import { HEROES, SPELLS, ITEMS } from './data.js';
import { think } from './bot.js';
import { byId, plan, STAT_TEXT } from '../shared/shop.js';
import * as Move from '../shared/move.js';

export const TICK = 30, DT = 1 / TICK;
// Lane geometry. Minions spawn `minionOffset` in front of their base, so the first melee minions of each
// side each walk (red spawn - blue spawn - 2 * minionOffset) / 2 = 8200 units and meet about 25s after
// spawning at move speed 325. Each outer tower is 1300 from the middle of the lane (x = 9000), with an
// inner tower 3000 behind it. A team wins by destroying both enemy towers.
export const MAP = {
  w: 18000, h: 1600, top: 220, bot: 1380, mid: 800, edge: 60,
  spawn: { blue: { x: 420, y: 800 }, red: { x: 17580, y: 800 } }, minionOffset: 380,
  tower: { blue: { x: 7700, y: 800 }, red: { x: 10300, y: 800 } },          // outer towers
  innerTower: { blue: { x: 4700, y: 800 }, red: { x: 13300, y: 800 } },     // cannot be damaged while that team's outer tower stands
  fountainR: 520, fountainBurn: 400,
  brush: [
    { x: 8300, y: 220, w: 1400, h: 190 },
    { x: 8300, y: 1190, w: 1400, h: 190 },
  ],
};
export const RULES = {
  // kills and cs are per player on a team: a 2v2 team needs twice as many (team totals).
  kills: 8, cs: 100, firstWave: 30,
  modes: { '1v1': 1, '2v2': 2 },                    // players per team
  // Gold. Passive income starts at goldFrom seconds. An assist = damaged the victim within assistWindow
  // seconds; the assisters split assistShare of the kill's gold between them, at most assistMax in total.
  startGold: 500, goldPerSec: 2.04, goldFrom: 65,
  killGold: 300, firstBloodGold: 100, assistShare: 0.5, assistMax: 150, assistWindow: 10,
  sellBack: 0.7,                                    // share of an item's price returned when it is sold
  // Critical strikes: a basic attack that crits deals critDmg times its damage. Crits are dealt from a shuffled
  // deck of critDeck cards per hero, so 25% crit is exactly 5 crits in every 20 attacks, in a random order.
  critDmg: 1.75, critDeck: 20,
  respawn: [10, 10, 12, 12, 14, 16, 20, 25, 28, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5],   // seconds dead, by level 1-18
  recallTime: 8, revealFor: 1.5,    // revealFor: seconds a hero stays visible in brush after acting
  fountainRegen: 0.1,                               // share of max health and mana restored per second at base
  chargeRefund: 0.5,                                // share of a charged ability's cost returned if the charge is cancelled
  // Client-side prediction of your own hero's movement (public/predict.js). blend: seconds over which a small
  // error is smoothed out; snap: an error above this many units is corrected at once; dead: errors this small
  // are ignored; history: seconds of predicted positions kept; tickLead: a snapshot already holds the movement of
  // the tick that produced it, which the measured round trip does not cover (about half a tick on average).
  predict: { blend: 0.1, snap: 150, dead: 1.5, history: 1.5, tickLead: 0.017 },
  // Towers. Outer towers have `hp` in `plates` equal plates, each paying plateGold to the hero who breaks it;
  // inner towers have innerHp and no plates. Range is edge to edge, like every attack range.
  // On minions a shot removes a share of max health (MINION.*.towerShot); `ad` is the fallback for anything else.
  // On heroes a shot deals flat physical damage: heroAd at 0:00 rising evenly to heroAdLate at heroAdRamp
  // seconds. Each shot in a row on heroes adds heatPerShot (up to maxHeat times); the warm-up is lost
  // heatReset seconds after the tower last hit a hero. With no attacking minions within guardRange a tower
  // takes only guardedMult of the damage dealt to it.
  tower: { hp: 5000, innerHp: 4000, plates: 5, plateGold: 120, ad: 150, armor: 40, mr: 40, range: 750, as: 0.83, windupT: 0.15,
    projSpeed: 1300, radius: 88, heroAd: 180, heroAdLate: 350, heroAdRamp: 1500,
    heatPerShot: 0.4, maxHeat: 3, heatReset: 3, guardRange: 900, guardedMult: 0.2 },
  // Unit collision (the rules are in shared/move.js). Each unit's own collision radius is with its other numbers
  // (heroes in data.js, minions in MINION below): smaller than the hit radius on purpose. minionPad: minions treat each other as this much
  // bigger, which leaves gaps a hero can slip through. look: how far ahead a walking unit checks its path;
  // keepSide: seconds it sticks to the side it chose to go round; margin: extra angle it clears an edge by.
  // nudge: the most an overlapping minion is moved per tick to separate it from another minion.
  // unstick: how far a hero that landed on top of units may be moved to the nearest free spot.
  // walkingFor: a hero counts as walking for this long after its last step; minions do not steer around a walking hero.
  collision: { minionPad: 1.2, look: 200, keepSide: 0.5, margin: 0.05, nudge: 3, unstick: 150, walkingFor: 0.15 },
  // Practice bot. Per difficulty: react = seconds between decisions; hitErr = how far off its judgement of
  // "one attack will kill it" can be; skip = share of minions it does not try for at all; trade = chance per
  // second of attacking a player in range; qEvery = seconds between Q pokes; aimErr = aim error in radians;
  // commit = chance it goes for an ultimate, a chase or an all-in when one is on; castGap = seconds it
  // leaves between abilities; dodge = whether it sidesteps skillshots it can see.
  bot: {
    easy:   { react: 0.35, hitErr: 0.30, skip: 0.45, trade: 0.12, qEvery: 10, aimErr: 0.30, commit: 0.3, castGap: 3, dodge: false },
    normal: { react: 0.20, hitErr: 0.12, skip: 0.20, trade: 0.35, qEvery: 6.5, aimErr: 0.14, commit: 0.6, castGap: 1.5, dodge: false },
    hard:   { react: 0.10, hitErr: 0.03, skip: 0, trade: 0.70, qEvery: 4.5, aimErr: 0.05, commit: 1, castGap: 0.6, dodge: true },
    // Lane habits.
    drinkBelow: 0.5, keepPotions: 1, potionsUntilFinished: 2,          // drinks below this health share; keeps a potion in the bag until it owns this many finished items
    retreatHp: 0.35, returnHp: 0.9, safeDist: 1300, safeMinions: 650, retreatBehind: 250,
    chase: 600, prepHp: 0.5, standRanged: 350, standMelee: 200, standOff: 140, tradeFor: 1.2, tradeReach: 60, towerMargin: 120,
    // Using abilities. lowHp / finishHp: enemy health shares it treats as "low" and "nearly dead"; manaReserve:
    // share of its mana it keeps back from pokes; pokeReach: share of an ability's range it will cast from;
    // reachMargin: how far inside a range the target must be; forget: seconds it keeps aiming at where it last saw someone.
    lowHp: 0.4, finishHp: 0.25, manaReserve: 0.25, pokeReach: 0.9, reachMargin: 60, forget: 3,
    zoneDelay: 0.8, shotSpeed: 1600,                 // lead times assumed for a kit without its own numbers (Oriel)
    passiveBelow: 0.85,                              // Xerhta: only farm the passive's mana when below this share of mana
    engageSlack: 120, engageFor: 2.5, fleeSpeed: 80, chaseRange: 900,     // Bliknarczt: following up a hook, chasing a runner
    boltGap: 100, escapeRange: 700,                  // Ezrlae: bolt last-hits minions at least this far out of attack range; blink away inside this
    bladeNear: 300, comboAttacks: 2, comboTrust: 0.7, allInMargin: 0.1, allInRetry: 2, allInFor: 4,   // Katanira: when a combo should kill, and how long she commits
    dodgeAhead: 0.8, dodgeMargin: 25, dodgeExtra: 50,                     // sidestepping: how far ahead it looks, and how wide a berth it gives
  },
};
// Minions. Times are in seconds of game time.
export const WAVES = {
  every: t => (t < 840 ? 30 : t < 1800 ? 25 : 20),                    // gap to the next wave
  cannon: (n, t) => (t < 840 ? n % 3 === 0 : t < 1500 ? n % 2 === 0 : true),   // is wave n a cannon wave?
  stagger: 0.8,                                                       // seconds between minions in a wave
  upgradeEvery: 90,                                                   // newly spawned minions grow this often (amounts are per type, below)
  vsHero: 0.6, vsTower: 0.6,                                          // damage dealt: x0.6 to heroes and to towers (bonus vs minions is per type, below)
  sight: 500, keep: 750, helpRange: 1000, look: 0.5, xpRange: 1500,
  ms: 350,                                                            // minion move speed
  rowGap: 120,                                                        // distance between the three rows a wave walks in
};
// The number a snapshot uses for each minion kind (o.m), and the sizes the client needs for each.
export const MINION_KINDS = ['caster', 'melee', 'cannon'];
// hpPer / adPer / goldPer: flat amount added per upgrade (every WAVES.upgradeEvery seconds) to newly spawned minions.
// vsMinionHp: bonus damage to other minions, as a share of the target's CURRENT health.
// towerShot: share of this minion's MAX health one tower shot removes.
export const MINION = {
  melee:  { hp: 465, hpPer: 20, ad: 12, adPer: 0.4, range: 110, as: 1.25, windupT: 0.3, radius: 48, collisionRadius: 36, gold: 20, goldPer: 0, xp: 62, projSpeed: 0, vsMinionHp: 0.02, towerShot: 0.45 },
  caster: { hp: 275, hpPer: 9, ad: 23, adPer: 0.7, range: 550, as: 0.67, windupT: 0.4, radius: 48, collisionRadius: 36, gold: 14, goldPer: 0, xp: 31, projSpeed: 650, vsMinionHp: 0.035, towerShot: 0.7 },
  cannon: { hp: 750, hpPer: 85, ad: 36, adPer: 1.5, range: 300, as: 1.0, windupT: 0.35, radius: 65, collisionRadius: 56, gold: 50, goldPer: 1, xp: 75, projSpeed: 1200, vsMinionHp: 0.05, towerShot: 0.14 },
};

const other = t => (t === 'blue' ? 'red' : 'blue');
const xpToNext = lvl => 180 + 100 * lvl;
export const ITEM = byId(ITEMS);                   // items by id; a made-up id finds nothing
const STAT_KEYS = Object.keys(STAT_TEXT);          // every stat an item can give

export class Game {
  // opts.seed fixes every random choice in the match (crit order, bot decisions), so a match can be replayed exactly.
  constructor(players, opts = {}) {
    this.seed = (opts.seed ?? 1) >>> 0; let a = this.seed;
    this.rand = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.time = 0; this.nextId = 1; this.units = new Map(); this.shots = []; this.zones = []; this.pickups = [];
    this.events = []; this.over = null; this.nextWave = RULES.firstWave; this.waveNo = 0; this.spawnQ = []; this.wavesMet = false; this.firstBlood = false; this.heroes = new Map();
    for (const team of ['blue', 'red']) {
      const t = RULES.tower;
      for (const [p, inner] of [[MAP.tower[team], false], [MAP.innerTower[team], true]])
        this.add({ type: 'tower', team, inner, x: p.x, y: p.y, radius: t.radius, hp: inner ? t.innerHp : t.hp, mhp: inner ? t.innerHp : t.hp,
          plates: inner ? 0 : t.plates, ad: t.ad, armor: t.armor, mr: t.mr,
          range: t.range, as: t.as, windupT: t.windupT, projSpeed: t.projSpeed, melee: false, heat: 0, heatAt: -99 });
    }
    this.teamSize = Math.max(1, ...['blue', 'red'].map(t => players.filter(p => p.team === t).length));
    this.goal = { kills: RULES.kills * this.teamSize, cs: RULES.cs * this.teamSize };
    for (const p of players) this.addHero(p);
  }

  // ---------- setup ----------
  add(u) {
    u.id = this.nextId++; u.buffs = []; u.atkId = 0; u.atkAt = -9; u.nextAttack = 0; u.windup = null; u.dead = false;
    u.stunUntil = 0; u.rootUntil = 0; u.silenceUntil = 0; u.airUntil = 0; u.shieldAmt = 0; u.shieldUntil = 0; u.face = u.team === 'blue' ? 0 : Math.PI;
    if (u.coll == null) u.coll = u.type === 'minion' ? (MINION[u.kind] || MINION.melee).collisionRadius : 0;   // collision radius (towers are never walked into: the lane ends before them)
    this.units.set(u.id, u); return u;
  }
  addHero(p) {
    const d = HEROES[p.hero], s = MAP.spawn[p.team], mates = [...this.heroes.values()].filter(o => o.team === p.team).length;
    const h = this.add({ type: 'hero', team: p.team, pid: p.id, name: p.name, hero: p.hero, def: d, x: s.x, y: s.y + mates * 130 - (this.teamSize - 1) * 65,
      radius: d.radius, coll: d.collisionRadius, melee: d.melee, projSpeed: d.projSpeed, lvl: 1, xp: 0, points: 1, ranks: [0, 0, 0, 0],
      cds: [0, 0, 0, 0], spellCds: { d: 0, f: 0 }, gold: RULES.startGold, items: [], kills: 0, deaths: 0, cs: 0, missed: 0,
      order: null, casting: null, dashing: null, recall: null, state: null, respawnAt: 0, revealUntil: 0, bot: !!p.bot, ai: p.ai || null, aiMem: {},
      potQ: [], undo: [], deck: [], deckCrit: -1, heroHitAt: -1e9, ambushUntil: 0, ambushLock: 0, burn: null, hitBy: new Map() });
    this.refresh(h); h.hp = h.mhp; h.mp = h.mmp; this.heroes.set(p.id, h); return h;
  }
  // Work out a hero's stats from its level and its bag. Called whenever either changes.
  refresh(h) {
    h.items = h.items.map(s => (typeof s === 'string' ? { id: s, n: ITEM[s].charges || 1 } : s));   // a bare id is accepted for a slot
    const d = h.def, L = h.lvl - 1, it = Object.fromEntries(STAT_KEYS.map(k => [k, 0])), passives = {};
    let through = 1;                                   // share of crowd-control time that gets through tenacity (sources multiply)
    const add = stats => { for (const [k, v] of Object.entries(stats || {})) { if (k === 'tenacity') through *= 1 - v / 100; else it[k] += v; } };
    for (const slot of h.items) {
      const def = ITEM[slot.id]; add(def.stats);
      if (def.passive && !passives[def.passive.id]) { passives[def.passive.id] = def.passive; add(def.passive.stats); }   // a passive works once, however many copies
    }
    h.passives = passives; h.tenacity = 1 - through;
    const oldHp = h.mhp || 0, oldMp = h.mmp || 0;
    h.mhp = d.hp + d.hpPer * L + it.hp; h.mmp = d.manaless ? 0 : d.mana + d.manaPer * L + it.mana;   // manaless heroes have no mana at all
    h.bonusAd = it.ad; h.ad = d.ad + d.adPer * L + it.ad;
    h.bonusArmor = it.armor; h.armor = d.armor + d.armorPer * L + it.armor;
    h.ap = it.ap;
    if (passives.overflow) h.ap += h.mmp * passives.overflow.apPerMana;
    if (passives.magnify) h.ap *= passives.magnify.mult;                         // last, so it multiplies everything
    h.hpRegen = d.hpRegen + (d.hpRegenPer || 0) * L + it.hpRegen;                // per second
    h.manaRegen = d.manaless ? 0 : d.manaRegen + (d.manaRegenPer || 0) * L + it.manaRegen;
    h.mr = d.mr + d.mrPer * L + it.mr; h.baseMs = d.ms + it.ms; h.range = d.range;
    h.as = d.as * (1 + (d.asPer * L + it.as) / 100); h.windupFrac = d.windup;
    h.haste = it.haste; h.crit = Math.min(100, it.crit); h.critDmg = passives.keen ? passives.keen.critDmg : RULES.critDmg;
    h.lifesteal = it.lifesteal; h.armorPen = Math.min(100, it.armorPen); h.magicPenPct = Math.min(100, it.magicPenPct); h.magicPenFlat = it.magicPenFlat;
    h.healAmp = it.healAmp;
    if (oldHp) { h.hp += h.mhp - oldHp; h.mp += h.mmp - oldMp; }
  }
  // A living hero's item passive by id, or undefined.
  has(u, id) { return u.passives && !u.dead ? u.passives[id] : undefined; }
  // Crits are dealt from a deck: critDeck cards, of which crit% are crits, shuffled with the match's own random
  // generator. A new deck is shuffled when the old one runs out or the hero's crit chance changes.
  drawCrit(h) {
    if (!h.crit) return false;
    if (!h.deck.length || h.deckCrit !== h.crit) {
      const n = RULES.critDeck, hits = Math.round(h.crit * n / 100), deck = Array.from({ length: n }, (_, i) => i < hits);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      h.deck = deck; h.deckCrit = h.crit;
    }
    return h.deck.pop();
  }
  // Tenacity shortens stuns, roots, silences and slows. It does not shorten forced movement.
  cc(u, dur) { return u.tenacity ? dur * (1 - u.tenacity) : dur; }

  // ---------- helpers ----------
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  // A buff's value now. A decaying buff slides evenly from v to `to` over its first `over` seconds, then holds.
  buffVal(b) { return b.over ? b.v + (b.to - b.v) * Math.min(1, (this.time - b.t0) / b.over) : b.v; }
  buffSum(u, k) { let s = 0; for (const b of u.buffs) if (b.k === k) s += this.buffVal(b); return s; }
  buffMax(u, k) { let s = 0; for (const b of u.buffs) if (b.k === k) s = Math.max(s, this.buffVal(b)); return s; }
  // The move-speed penalty of the hero's ability state: a fixed share, or one that steps up while the state lasts.
  stateSlow(u) {
    const s = u.state && u.state.slow; if (!s) return 0;
    return typeof s === 'number' ? s : Math.min(s.max, s.start + s.step * Math.floor((this.time - u.state.t0) / s.every + 1e-6));
  }
  speed(u) { return (u.baseMs || u.ms) * (1 - this.buffMax(u, 'slow')) * (1 + this.buffSum(u, 'haste')) * (1 - this.stateSlow(u)); }
  atkSpeed(u) { return Math.min(2.5, u.as * (1 + this.buffSum(u, 'as') / 100)); }
  // Timed buff. o.tag: replaces any earlier buff with the same tag (for stacks that refresh).
  // o.onEnd: runs when the buff runs out, which is how one buff chains into the next.
  // o.to + o.over: a decaying buff (see buffVal).
  addBuff(u, k, v, dur, o = {}) {
    if (u.dead) return;
    if (o.tag) u.buffs = u.buffs.filter(b => b.tag !== o.tag);
    if (k === 'slow') dur = this.cc(u, dur);
    u.buffs.push({ k, v, t0: this.time, until: this.time + dur, tag: o.tag, onEnd: o.onEnd, to: o.to, over: o.over });
  }
  silence(u, dur) { u.silenceUntil = Math.max(u.silenceUntil, this.time + this.cc(u, dur)); this.leave(u, 'cancel'); }
  knockUp(u, dur) { if (u.type === 'tower') return; this.stun(u, dur, true); u.airUntil = this.time + dur; }
  // A mark is a tag one ability leaves on a target: t.mark = { by, until, pop(t, via) }. Anything else the
  // marker lands on that target calls popMark, which removes the tag and runs its effect. `via` says what
  // popped it: { cost } for an ability, nothing for a basic attack.
  popMark(h, t, via) {
    const m = t.mark; if (!m || m.by !== h.id || m.until <= this.time || t.dead) return false;
    t.mark = null; m.pop(t, via); return true;
  }
  // Everything that happens when a hero's attack lands, apart from the damage: marks pop, and the hero's
  // passive and learned abilities get their on-attack hooks. Abilities that "count as an attack" call this too.
  applyOnHit(h, t, via) {
    this.popMark(h, t, via);
    if (h.def.passive && h.def.passive.onAttack) h.def.passive.onAttack(this, h, t);
    for (let s = 0; s < 4; s++) { const d = h.def.abilities[s]; if (d.onAttackHit && h.ranks[s] > 0) d.onAttackHit(this, h, h.ranks[s] - 1, t); }
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
  // `forced` marks the stun that comes with forced movement (knock-ups, pulls, shoves): tenacity does not shorten it.
  stun(u, dur, forced = false) { u.stunUntil = Math.max(u.stunUntil, this.time + (forced ? dur : this.cc(u, dur))); u.windup = null; u.casting = null; u.recall = null; this.leave(u, 'cancel'); }
  root(u, dur) { u.rootUntil = Math.max(u.rootUntil, this.time + this.cc(u, dur)); }
  shield(u, amt, dur) { u.shieldAmt = amt; u.shieldUntil = this.time + dur; }
  stripShields(u) { u.shieldAmt = 0; u.floorShield = null; }
  heal(u, amt) { if (!u.dead) u.hp = Math.min(u.mhp, u.hp + amt * (1 + (u.healAmp || 0) / 100)); }
  restoreMana(u, amt) { if (!u.dead) u.mp = Math.min(u.mmp, u.mp + amt); }
  towers(team) { return [...this.units.values()].filter(u => u.type === 'tower' && u.team === team && !u.dead); }
  // The tower a team is currently defending: the outer one, or the inner one once that has fallen.
  frontTower(team) { const ts = this.towers(team); return ts.find(t => !t.inner) || ts[0] || MAP.innerTower[team]; }
  brushOf(u) { return MAP.brush.findIndex(b => u.x >= b.x && u.x <= b.x + b.w && u.y >= b.y && u.y <= b.y + b.h); }
  visible(u, team) {
    if (u.team === team || u.type !== 'hero' || u.revealUntil > this.time) return true;
    const b = this.brushOf(u); if (b < 0) return true;
    for (const o of this.units.values()) if (o.team === team && !o.dead && o.type !== 'tower' && this.brushOf(o) === b) return true;
    return false;
  }
  targetable(u, t) { return t && !t.dead && t.team !== u.team && this.visible(t, u.team); }
  // Attack range is measured edge to edge.
  inRange(u, t, extra = 0) { return this.dist(u, t) - t.radius - u.radius <= u.range + extra; }
  enemiesIn(team, x, y, r, towers = false) {
    const out = [];
    for (const u of this.units.values())
      if (u.team !== team && !u.dead && (towers || u.type !== 'tower') && Math.hypot(u.x - x, u.y - y) <= r + u.radius) out.push(u);
    return out;
  }
  get rules() { return RULES; }
  clampPos(u) {
    u.x = Math.max(MAP.edge, Math.min(MAP.w - MAP.edge, u.x)); u.y = Math.max(MAP.top + 30, Math.min(MAP.bot - 30, u.y));
  }
  fx(e) { this.events.push(e); }
  // A sound for the clients (public/sfx.js has the recipes). src = who made it, k = the recipe's name, at = where.
  // o.s = an ability slot (the client then looks for e.g. "qHit"); o.n = a number the recipe may use (a bounce
  // count, a stun length); o.u = heard even through fog (ultimates); o.v = tied to something everyone can see
  // (a telegraphed area); o.p = only that player hears it. While an ability's own code runs, this.slot is its
  // slot, so the shots and strikes it creates know which ability they belong to.
  sfx(src, k, at, o = {}) {
    const a = at || src;
    this.fx({ e: 'sfx', k, x: Math.round(a.x), y: Math.round(a.y), ...(src ? { id: src.id } : {}), ...(src && src.hero ? { h: src.hero } : {}), ...o });
  }
  inSlot(s, f) { const was = this.slot; this.slot = s; try { return f(); } finally { this.slot = was; } }

  // ---------- ability primitives ----------
  line(h, aim, o) {
    const s = { id: this.nextId++, kind: 'line', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, left: o.range, range: o.range, dist: 0, team: h.team,
      speed: o.speed, w: o.width, color: o.color, onHit: o.onHit, pierce: o.pierce, hit: new Set(), style: o.style || 'orb', own: o.tether ? h.id : 0, src: h, sl: this.slot };
    this.shots.push(s); return s;
  }
  homing(src, x, y, target, speed, color, onHit, style) {
    this.shots.push({ id: this.nextId++, kind: 'home', x, y, target, speed, team: src.team, color, onHit, w: 24, src, sl: this.slot,
      style: style || (src.type === 'tower' ? 'bolt' : src.type === 'minion' ? 'mote' : src.def.shot || 'orb') });
  }
  // AreaStrike: telegraph -> delay -> resolve. Everyone sees the shape from the moment it is created; after
  // `delay` it resolves once (or `ticks` times) against whoever is inside, calling onHit(target, inInner),
  // after calling o.onLand() if there is one.
  // Shapes: a circle at x,y with radius r (and an optional stronger `inner` radius, measured to the target's
  // centre), or with shape 'line' a strip of length `len` and width `w` starting at x,y along dx,dy.
  strike(h, o) {
    const z = { id: this.nextId++, shape: o.shape || 'circle', x: o.x, y: o.y, r: o.r || 0, inner: o.inner || 0,
      dx: o.dx || 0, dy: o.dy || 0, len: o.len || 0, w: o.w || 0, team: h.team, born: this.time, at: this.time + o.delay,
      ticks: o.ticks || 1, interval: o.interval || 0, color: o.color, onHit: o.onHit, onLand: o.onLand, quiet: !!o.quiet, src: h, sl: this.slot, n: o.n };
    if (z.sl != null) this.sfx(h, 'tele', z.shape === 'line' ? h : z, { s: z.sl, v: 1, d: +o.delay.toFixed(3), ...(o.n ? { n: o.n } : {}) });   // the telegraph: an incoming whistle, a sizzle
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
    t.push = { vx, vy, left: dur }; t.dashing = null; this.stun(t, dur + extraStun, true);
  }
  // Drag t toward `to`, stopping with its centre o.gap beyond `to`'s edge. It is stunned for o.stun seconds,
  // or for the whole trip if that takes longer.
  pull(t, to, speed, o) {
    const dx = to.x - t.x, dy = to.y - t.y, d = Math.hypot(dx, dy), go = Math.max(0, d - to.radius - o.gap), dur = go / speed;
    if (go > 0) this.shove(t, dx / d * speed, dy / d * speed, dur, Math.max(0, o.stun - dur)); else this.stun(t, o.stun, true);
  }
  // Pickups are objects lying in the world. One becomes live `delay` seconds after it is dropped, stays
  // for o.life seconds, and runs o.onTake when its owner walks within o.r of it.
  drop(h, x, y, delay, o) {
    const b = { id: this.nextId++, kind: o.kind, owner: h, team: h.team, x, y, r: o.r, born: this.time, at: this.time + delay,
      until: this.time + delay + o.life, onTake: o.onTake, landSfx: o.landSfx };
    this.clampPos(b); this.pickups.push(b); return b;
  }
  take(h, b) {
    const i = this.pickups.indexOf(b); if (i < 0) return;
    this.pickups.splice(i, 1); this.fx({ e: 'take', x: b.x | 0, y: b.y | 0 }); b.onTake(b);
  }
  stepPickups() {
    for (const b of [...this.pickups]) {
      if (b.landSfx && this.time >= b.at) { this.sfx(b.owner, b.landSfx, b); b.landSfx = null; }   // it has just landed
      if (this.time >= b.until) this.pickups.splice(this.pickups.indexOf(b), 1);
      else if (this.time >= b.at && !b.owner.dead && this.dist(b.owner, b) <= b.r) this.take(b.owner, b);
    }
  }
  blink(h, x, y) {
    this.fx({ e: 'blink', x: h.x, y: h.y }); h.x = x; h.y = y; this.clampPos(h); this.unstick(h); this.fx({ e: 'blink', x: h.x, y: h.y });
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
    if (st.name === 'charging' && why !== 'done' && st.paid) this.restoreMana(h, st.paid * RULES.chargeRefund);   // cancelled charge: part of the cost back
    this.sfx(h, st.name === 'charging' && why !== 'done' ? 'cancel' : 'end', h, { s: st.s, st: st.name });   // lets the client stop a charge whine or a channel's sound
    if (def.onLeave) def.onLeave(this, h, st, why);
  }

  // ---------- damage ----------
  // attack: a basic attack. o.passive: damage dealt by an item passive (it triggers no other passives).
  // o.crit: only for showing the number. Anything else a hero deals counts as ability damage.
  damage(src, t, amt, type, attack = false, o = {}) {
    if (t.dead || this.over) return;
    const hero = src && src.type === 'hero' ? src : null;
    if (t.type === 'tower') {
      if (!attack || (t.inner && this.towers(t.team).some(o => !o.inner))) return;   // the inner tower is safe behind the outer one
      const guarded = !this.enemiesIn(t.team, t.x, t.y, RULES.tower.guardRange).some(u => u.type === 'minion');
      if (guarded) amt *= RULES.tower.guardedMult;
    }
    if (type !== 'true') {
      let res = type === 'phys' ? t.armor : t.mr;
      if (hero && t.type !== 'tower')                 // penetration: % first, then flat, never below zero; not against towers
        res = type === 'phys' ? res * (1 - hero.armorPen / 100) : Math.max(0, res * (1 - hero.magicPenPct / 100) - hero.magicPenFlat);
      amt *= 100 / (100 + res);
    }
    const guard = attack && this.has(t, 'guard'); if (guard) amt *= 1 - guard.less;
    if (t.shieldUntil > this.time && t.shieldAmt > 0) { const a = Math.min(t.shieldAmt, amt); t.shieldAmt -= a; amt -= a; }
    if (t.type === 'hero' && t.def.passive && t.def.passive.beforeDamage) t.def.passive.beforeDamage(this, t, amt);
    // A floor shield only soaks the part of a hit that would take its owner below `floor` health.
    const fs = t.floorShield;
    if (fs && fs.until > this.time && fs.amt > 0) { const a = Math.min(fs.amt, amt, Math.max(0, fs.floor - (t.hp - amt))); fs.amt -= a; amt -= a; }
    const hp0 = t.hp;
    t.hp -= amt;
    if (t.plates) {                                   // tower plates: each one broken pays the hero who broke it
      const size = t.mhp / t.plates, broke = Math.ceil(hp0 / size - 1e-9) - Math.ceil(Math.max(0, t.hp) / size - 1e-9);
      if (broke > 0 && src && src.type === 'hero') { src.gold += broke * RULES.tower.plateGold; this.fx({ e: 'gold', x: t.x, y: t.y, n: broke * RULES.tower.plateGold, p: src.pid, w: 'p' }); }
      if (broke > 0) this.sfx(null, 'plate', t);
    }
    if (src && amt >= 1) this.fx({ e: 'dmg', id: t.id, x: Math.round(t.x), y: Math.round(t.y), n: Math.round(amt),
      s: src.type === 'hero' ? src.id : 0, k: t.type[0], ty: type[0], ...(o.crit ? { cr: 1 } : {}), ...(attack ? { a: 1 } : {}) });
    if (hero && !hero.dead) {
      hero.undo = [];                                 // dealing damage closes the shop's undo history
      // amt is now what actually came off the target's health, after armor and shields.
      if (attack) { if (hero.lifesteal) this.heal(hero, amt * hero.lifesteal / 100); }
      else if (!o.passive) {                          // ability damage
        const drain = this.has(hero, 'drain'); if (drain && hero.lifesteal) this.heal(hero, amt * hero.lifesteal / 100 * drain.share);
        const burn = this.has(hero, 'burn');
        if (burn && t.type === 'hero' && t.team !== hero.team) t.burn = { by: hero, p: burn, left: Math.round(burn.lasts / burn.every), next: this.time + burn.every };   // restarts, never stacks
      }
    }
    if (t.type === 'hero') {
      t.recall = null; t.undo = [];
      if (hero && hero.team !== t.team) {
        t.heroHitAt = this.time;                      // for Recover and Second Wind
        if (attack) {                                 // what the victim's items do to a hero who attacks it
          const barbs = this.has(t, 'barbs'); if (barbs) this.damage(t, hero, barbs.base + barbs.bonusArmor * t.bonusArmor, 'magic', false, { passive: true });
          const chill = this.has(t, 'chill'); if (chill) this.addBuff(hero, 'as', -chill.as, chill.lasts, { tag: 'chill' });
        }
      }
      if (src && src.type === 'hero') {
        t.hitBy.set(src.id, this.time);                            // for kill credit and assists
        for (const u of this.units.values()) {
          if (u.team !== t.team || u.dead) continue;
          if (u.type === 'tower' && this.inRange(u, src)) u.forced = src.id;
        }
      }
    }
    if (src && src.type === 'hero') src.revealUntil = this.time + RULES.revealFor;
    if (t.hp <= 0) this.kill(src, t);
  }
  kill(src, t) {
    t.dead = true; t.hp = 0; t.windup = null; t.buffs = []; this.leave(t, 'cancel');
    if (t.type === 'hero') { t.undo = []; t.burn = null; t.potQ = []; t.ambushUntil = 0; }
    this.fx({ e: 'die', x: Math.round(t.x), y: Math.round(t.y), t: t.team[0], k: t.type[0], h: t.hero });
    const enemy = [...this.heroes.values()].filter(h => h.team !== t.team);
    let killer = src && src.type === 'hero' ? src : null;
    if (t.type === 'minion') {
      this.units.delete(t.id);
      if (src && src.type === 'hero') { src.gold += t.gold; src.cs++; this.fx({ e: 'gold', x: t.x, y: t.y, n: t.gold, p: src.pid, w: 'm' }); }
      const near = enemy.filter(h => !h.dead && this.dist(h, t) < WAVES.xpRange);
      for (const h of near) { this.giveXp(h, t.xp / near.length); if (h !== src) h.missed++; }   // in range but no last hit = a missed minion
    } else if (t.type === 'hero') {
      t.deaths++; t.respawnAt = this.time + RULES.respawn[Math.min(t.lvl, RULES.respawn.length) - 1]; t.order = null; t.casting = null; t.dashing = null; t.recall = null;
      // Credit: whoever landed the blow, or else the hero who damaged the victim most recently. Every other
      // hero who damaged it within the assist window gets an assist.
      const recent = [...t.hitBy].filter(([, at]) => this.time - at < RULES.assistWindow).sort((a, b) => b[1] - a[1]).map(([id]) => this.units.get(id)).filter(Boolean);
      const k = killer || recent[0] || null, xp = 100 + 40 * t.lvl, helpers = recent.filter(a => a !== k);
      killer = k;
      const bounty = RULES.killGold + (k && !this.firstBlood ? RULES.firstBloodGold : 0);
      if (k) { this.firstBlood = true; k.kills++; k.gold += bounty; this.giveXp(k, xp); this.fx({ e: 'gold', x: t.x, y: t.y, n: bounty, p: k.pid, w: 'k' }); }
      const share = helpers.length ? Math.min(RULES.assistMax, bounty * RULES.assistShare) / helpers.length : 0;
      for (const a of helpers) {
        a.assists = (a.assists || 0) + 1; a.gold += share; this.giveXp(a, xp / 2); this.fx({ e: 'gold', x: t.x, y: t.y, n: Math.round(share), p: a.pid, w: 'k' });
        if (a.def.passive && a.def.passive.onKill) a.def.passive.onKill(this, a, t);
      }
      this.fx({ e: 'kill', k: k ? k.name : 'the lane', v: t.name, kp: k ? k.pid : 0, vp: t.pid });
    } else if (t.type === 'tower') {
      this.units.delete(t.id); this.fx({ e: 'kill', k: src && src.name ? src.name : other(t.team) + ' minions', v: `a ${t.team} tower` });
      if (!this.towers(t.team).length) this.over = { winner: other(t.team), reason: 'both towers destroyed' };
    }
    const pv = killer && killer.def.passive;
    if (pv && pv.onKill) pv.onKill(this, killer, t);
    if (t.hitBy) t.hitBy.clear();
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
    if (c.c === 'buy') { const ok = this.buy(h, c.item); if (!ok) this.sfx(h, 'deny', h, { p: h.pid }); return ok; }
    if (c.c === 'sell') return this.sell(h, c.i | 0);
    if (c.c === 'undo') return this.undoShop(h);
    if (c.c === 'use') return this.useItem(h, c.i | 0);
    if (h.dead) return;
    // A new order cancels an attack that is still winding up, unless that windup is locked in.
    const interrupt = () => { if (h.windup && !h.windup.locked) { h.nextAttack = this.time; h.windup = null; } h.recall = null; };
    switch (c.c) {
      case 'move': interrupt(); h.order = { type: 'move', x: num(c.x), y: num(c.y) }; break;
      case 'amove': h.recall = null; h.order = { type: 'amove', x: num(c.x), y: num(c.y) }; break;
      case 'atk': { const t = this.units.get(c.id); if (this.targetable(h, t)) { h.recall = null; h.order = { type: 'atk', id: t.id }; } break; }
      case 'stop': interrupt(); h.order = { type: 'hold' }; if (h.state && h.state.stopEnds) this.leave(h, 'cancel'); break;
      case 'recall': if (!h.casting && !h.dashing && !h.state) { interrupt(); h.order = { type: 'hold' }; h.recall = { at: this.time + RULES.recallTime }; } break;
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
  // ---------- the shop ----------
  // Buying and undoing work at base or while dead. Selling needs the hero alive and standing at base.
  canShop(h) { return h.dead || this.dist(h, MAP.spawn[h.team]) <= MAP.fountainR; }
  // Buy through the recipe: owned parts are used up and taken off the price (shared/shop.js works that out).
  buy(h, id) {
    if (!this.canShop(h)) return false;
    const p = plan(ITEM, h.items, id);
    if (!p.ok || h.gold < p.price) return false;
    h.undo.push({ items: h.items.map(s => ({ ...s })), gold: -p.price });
    if (p.stack >= 0) h.items[p.stack].n++;
    else {
      const slot = { id, n: ITEM[id].charges || 1 }, at = p.used.length ? Math.min(...p.used) : -1;   // the new item takes the place of the first part used
      h.items = h.items.map((s, k) => (k === at ? slot : s)).filter((s, k) => k === at || !p.used.includes(k));
      if (at < 0) h.items.push(slot);
    }
    h.gold -= p.price; this.refresh(h); this.sfx(h, 'buy', h, { p: h.pid }); return true;
  }
  // Sell the item in bag slot i for RULES.sellBack of its total price (one potion at a time from a stack).
  sell(h, i) {
    const slot = h.items[i], it = slot && ITEM[slot.id];
    if (!it || h.dead || this.dist(h, MAP.spawn[h.team]) > MAP.fountainR) return false;
    const gain = Math.round(it.cost * RULES.sellBack);
    h.undo.push({ items: h.items.map(s => ({ ...s })), gold: gain });
    if (it.stack && slot.n > 1) slot.n--; else h.items.splice(i, 1);
    h.gold += gain; this.refresh(h); this.sfx(h, 'sell', h, { p: h.pid });
    h.hp = Math.min(h.hp, h.mhp); h.mp = Math.min(h.mp, h.mmp); return true;
  }
  // Take back the last buy or sell: the bag as it was, and exactly the gold that changed hands.
  undoShop(h) {
    if (!this.canShop(h) || !h.undo.length) return false;
    const e = h.undo.pop();
    h.items = e.items; h.gold -= e.gold; this.refresh(h); this.sfx(h, 'undo', h, { p: h.pid });
    h.hp = Math.min(h.hp, h.mhp); h.mp = Math.min(h.mp, h.mmp); return true;
  }
  // Drink the potion or flask in bag slot i. A second drink waits its turn behind the first.
  useItem(h, i) {
    const slot = h.items[i], it = slot && ITEM[slot.id];
    if (!it || !it.use || h.dead || slot.n < 1) return false;
    slot.n--; if (!it.charges && slot.n < 1) h.items.splice(i, 1);
    h.potQ.push({ rate: it.use.heal / it.use.over, left: it.use.over }); h.undo = []; this.sfx(h, 'potion');
    return true;
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
  // Charged abilities: pressing the key pays the cost and enters CHARGING; releasing it casts with
  // aim.power = 0..1. Holding past `hold` seconds, or being interrupted, cancels it and refunds part of the cost.
  startCharge(h, s) {
    const def = h.def.abilities[s], r = h.ranks[s] - 1;
    if (!def || !def.charge || r < 0 || h.state || !this.canAct(h) || h.cds[s] > this.time) return;
    const cost = def.cost[Math.min(r, def.cost.length - 1)];
    if (h.mp < cost) return;
    h.recall = null; h.mp -= cost;
    this.enter(h, s, 'charging', def.charge.hold, { slow: def.charge.slow, noAttack: true, full: def.charge.full, paid: cost });
    this.sfx(h, 'charge', h, { s, d: def.charge.full });
  }
  cast(h, s, c) {
    const def = h.def.abilities[s], r = h.ranks[s] - 1, st = h.state;
    if (!def || r < 0 || !this.canAct(h) || h.silenceUntil > this.time) return;
    if (st && st.s !== s) return;                                   // busy with another ability
    if (st && st.name !== 'charging') { if (def.recast) this.inSlot(s, () => def.recast(this, h, r, this.aimFor(h, def, c), st)); return; }
    if (def.charge && !st) return;                                  // charged abilities only fire from CHARGING
    if (h.cds[s] > this.time) return;
    const cost = st ? 0 : def.cost[Math.min(r, def.cost.length - 1)];   // a charged ability was paid for when the charge began
    if (h.mp < cost) return;
    if (def.kind === 'dash' && h.rootUntil > this.time) return;
    const aim = this.aimFor(h, def, c);
    aim.power = st ? Math.max(0, Math.min(1, (this.time - st.t0) / st.full)) : 0;
    if (st) this.leave(h, 'done');
    // Target validation: an ability with `pick` chooses what it is aimed at; no valid target, no cast.
    if (def.pick) { aim.target = def.pick(this, h, aim); if (!aim.target) { this.fx({ e: 'say', p: h.pid, m: def.noTarget || 'No target there' }); return; } }
    if (aim.target && aim.target.type === 'hero' && aim.target.team !== h.team) this.callForHelp(h, aim.target);   // targeted ability on a champion
    h.mp -= cost; h.cds[s] = this.time + def.cd[Math.min(r, def.cd.length - 1)] * 100 / (100 + h.haste);   // ability haste shortens the cooldown as it starts
    h.recall = null; h.revealUntil = this.time + RULES.revealFor; h.undo = [];
    const ambush = this.has(h, 'ambush'); if (ambush && this.time >= h.ambushLock) h.ambushUntil = this.time + ambush.window;
    if (h.windup && !h.windup.locked) { h.windup = null; h.nextAttack = this.time; }
    if (def.kind !== 'self') h.face = Math.atan2(aim.dy, aim.dx);
    this.fx({ e: 'cast', id: h.id, s, d: def.castTime || 0, h: h.hero, x: Math.round(h.x), y: Math.round(h.y) });
    const fire = () => this.inSlot(s, () => def.cast(this, h, r, aim));
    if (def.castTime) h.casting = { at: this.time + def.castTime, fire }; else fire();
  }
  castSpell(h, s, c) {
    const def = Object.hasOwn(SPELLS, s) ? SPELLS[s] : null;
    if (!def || !this.canAct(h) || h.spellCds[s] > this.time || (h.state && h.state.lock)) return;
    h.spellCds[s] = this.time + def.cd; h.recall = null; this.sfx(h, def.name.toLowerCase());
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
      if (u.push) {                                   // forced movement, for exactly as long as it was given
        const dt = Math.min(DT, u.push.left); u.push.left -= dt;
        if (dt > 0 && !u.dead) { u.x += u.push.vx * dt; u.y += u.push.vy * dt; this.clampPos(u); }
        if (u.push.left <= 1e-9 || u.dead) { u.push = null; this.unstick(u); }
      }
      if (u.type === 'hero') this.stepHero(u);
      else if (u.dead) continue;
      else if (u.type === 'minion') this.stepMinion(u);
      else this.stepTower(u);
    }
    this.separate();
    this.stepShots(); this.stepZones(); this.stepPickups();
    for (const team of ['blue', 'red']) {               // win on team totals
      if (this.over) break;
      const hs = [...this.heroes.values()].filter(h => h.team === team), sum = k => hs.reduce((n, h) => n + h[k], 0);
      if (sum('kills') >= this.goal.kills) this.over = { winner: team, reason: `${this.goal.kills} kills` };
      else if (sum('cs') >= this.goal.cs) this.over = { winner: team, reason: `${this.goal.cs} minions` };
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
    const hp = k.hp + k.hpPer * up, y = MAP.mid + (q.slot - 1) * WAVES.rowGap;
    return this.add({ type: 'minion', team: q.team, kind: q.kind, melee: q.kind === 'melee', wave: q.wave, slot: q.slot,
      x: MAP.spawn[q.team].x + dir * MAP.minionOffset, y, laneY: y, radius: k.radius, coll: k.collisionRadius, hp, mhp: hp, ad: k.ad + k.adPer * up,
      armor: 0, mr: 0, ms: WAVES.ms, range: k.range, as: k.as, windupT: k.windupT, projSpeed: k.projSpeed, gold: k.gold + k.goldPer * up, xp: k.xp,
      targetId: 0, mode: 'walk', lookAt: this.time + (this.nextId % 5) * 0.1 });
  }
  // ---------- walking and collision (the rules themselves are in shared/move.js) ----------
  // First-wave minions and heroes pass through each other until the waves have met, which keeps the opening fair.
  ghostMinion(m) { return m.wave === 1 && !this.wavesMet; }
  // What a walking unit has to go around: for a hero, minions; for a minion, heroes and other minions.
  // Ghosted units neither block nor are blocked. Each blocker's r is the two collision radii added together.
  blockersFor(u) {
    const C = RULES.collision, out = [];
    if (u.type === 'hero') {
      if (u.ghostUntil > this.time) return out;
      for (const m of this.units.values()) if (m.type === 'minion' && !m.dead && !this.ghostMinion(m)) out.push({ x: m.x, y: m.y, r: u.coll + m.coll });
    } else if (u.type === 'minion') {
      const ghost = this.ghostMinion(u);
      for (const o of this.units.values()) {
        if (o === u || o.dead) continue;
        if (o.type === 'minion') out.push({ x: o.x, y: o.y, r: u.coll + o.coll * C.minionPad });   // other minions count as a little bigger
        else if (o.type === 'hero' && !ghost && !(o.ghostUntil > this.time)) out.push({ x: o.x, y: o.y, r: u.coll + o.coll, walking: this.time - (o.walkedAt ?? -9) < C.walkingFor });   // a walking hero steers; the minion only slides
      }
    }
    return out;
  }
  // One walking step toward x,y. Only this unit moves; nothing it bumps into is pushed. Returns true on arrival.
  moveToward(u, x, y) {
    if (u.rootUntil > this.time) return false;
    const C = RULES.collision;
    const px = u.x, py = u.y;
    const res = Move.step(u, { x, y }, this.speed(u) * DT, this.blockersFor(u), { now: this.time, look: C.look, keep: C.keepSide, margin: C.margin, odd: u.id % 2 === 1 });
    this.clampPos(u);
    if (u.type === 'hero' && Math.hypot(u.x - px, u.y - py) > 0.5) u.walkedAt = this.time;
    return res.arrived;
  }
  // A hero that ended up on top of units (blink, dash, respawn, a ghost effect or a shove ending) is moved
  // once to the nearest spot where it fits. Nothing else moves; if nowhere fits, the overlap is simply left.
  unstick(h) {
    if (h.type !== 'hero' || h.dead) return;
    const p = Move.freeSpot(h, this.blockersFor(h), RULES.collision.unstick, MAP);
    if (p) { h.x = p.x; h.y = p.y; }
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
        u.windup = { id: t.id, at: this.time + wd, locked: !!(u.emp && u.emp.lockWindup && u.emp.until > this.time) };
        this.fx({ e: 'atk', id: u.id, d: +wd.toFixed(2) });
        u.nextAttack = this.time + period;
      }
    } else this.moveToward(u, t.x, t.y);
  }
  fireAttack(u, t) {
    if (u.type === 'hero') u.revealUntil = this.time + RULES.revealFor;
    if (u.melee) this.attackHit(u, t);
    else this.homing(u, u.x, u.y, t, u.projSpeed, u.type === 'tower' ? '#ffffff' : null, () => this.attackHit(u, t));
  }
  attackHit(u, t) {
    if (t.dead) return;
    let dmg = u.ad;
    const kind = MINION[t.kind];
    if (u.type === 'minion') dmg = t.type === 'hero' ? dmg * WAVES.vsHero : t.type === 'tower' ? dmg * WAVES.vsTower : dmg + ((MINION[u.kind] || {}).vsMinionHp || 0) * t.hp;
    if (u.type === 'tower' && t.type === 'hero') {     // flat physical damage that grows with game time and with each shot in a row
      const R = RULES.tower; if (this.time - u.heatAt > R.heatReset) u.heat = 0;
      dmg = (R.heroAd + (R.heroAdLate - R.heroAd) * Math.min(1, this.time / R.heroAdRamp)) * (1 + R.heatPerShot * u.heat);
      u.heat = Math.min(R.maxHeat, u.heat + 1); u.heatAt = this.time;
    }
    // A tower shot takes a fixed share of a minion's max health, however much health upgrades have added.
    if (u.type === 'tower' && t.type === 'minion' && kind && kind.towerShot) return this.damage(u, t, kind.towerShot * t.mhp, 'true', true);
    let crit = false;
    if (u.type === 'hero') {
      crit = this.drawCrit(u); if (crit) dmg *= u.critDmg;                 // the attack's own damage; the extras below are not multiplied
      const rend = this.has(u, 'rend'); if (rend && t.type !== 'tower') dmg += t.type === 'minion' ? Math.min(rend.minionCap, rend.share * t.hp) : rend.share * t.hp;
      const ambush = this.has(u, 'ambush');
      if (ambush && u.ambushUntil > this.time) { dmg += ambush.base + ambush.bonusAd * u.bonusAd; u.ambushUntil = 0; u.ambushLock = this.time + ambush.lockout; }
      // Empowered next attack: h.emp = { until, hit(target) -> bonus damage }, used up by one attack.
      if (u.emp) { const e = u.emp; u.emp = null; if (e.until > this.time) dmg += e.hit(t) || 0; }
      this.applyOnHit(u, t);
    }
    this.damage(u, t, dmg, 'phys', true, { crit });
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
      if (T >= h.respawnAt) { h.dead = false; h.hp = h.mhp; h.mp = h.mmp; h.x = sp.x; h.y = sp.y; h.order = null; this.unstick(h); this.sfx(h, 'respawn'); }
      return;
    }
    if (T >= RULES.goldFrom) h.gold += RULES.goldPerSec * DT;
    const home = this.dist(h, sp) < MAP.fountainR;
    // Health coming in this tick: own regen, the fountain, the potion being drunk, and item passives. healAmp scales all of it.
    let regen = h.hpRegen + (home ? h.mhp * RULES.fountainRegen : 0);
    const drink = h.potQ[0]; if (drink) { regen += drink.rate; drink.left -= DT; if (drink.left <= 1e-9) h.potQ.shift(); }
    const recover = this.has(h, 'recover'); if (recover && T - h.heroHitAt >= recover.after) regen += recover.share * h.mhp;
    const wind = this.has(h, 'secondwind'); if (wind && T - h.heroHitAt < wind.lasts) regen += wind.regen;
    h.hp = Math.min(h.mhp, h.hp + regen * (1 + h.healAmp / 100) * DT);
    if (home) { for (const slot of h.items) if (ITEM[slot.id].charges) slot.n = ITEM[slot.id].charges; }   // flasks refill at base
    else if (h.undo.length) h.undo = [];                                                                   // leaving base closes the undo history
    if (h.burn) {                                                                                          // Ember Orb's burn, ticking on this hero
      const b = h.burn;
      if (b.by.dead || !this.has(b.by, 'burn')) h.burn = null;
      else if (T >= b.next) { b.next += b.p.every; if (--b.left <= 0) h.burn = null; this.damage(b.by, h, b.p.tick * h.mhp, 'magic', false, { passive: true }); }
    }
    h.mp = Math.min(h.mmp, h.mp + (h.manaRegen + (home ? h.mmp * RULES.fountainRegen : 0)) * DT);
    const es = MAP.spawn[other(h.team)];
    if (this.dist(h, es) < MAP.fountainR) this.damage(null, h, MAP.fountainBurn * DT, 'true');
    if (h.ghostUntil && T >= h.ghostUntil) { h.ghostUntil = 0; this.unstick(h); }          // a ghost effect ran out
    if (h.dead || T < h.stunUntil) return;
    for (let s = 0; s < 4; s++) { const d = h.def.abilities[s]; if (d.tick && h.ranks[s] > 0) d.tick(this, h, h.ranks[s] - 1); }   // always-on effects
    if (h.state && T >= h.state.until) this.leave(h, 'timeout');
    // Channels: a state with `every` calls its ability's onTick on that interval until the state ends.
    if (h.state && h.state.every && T >= h.state.tickAt) { const st = h.state; st.tickAt += st.every; this.inSlot(st.s, () => h.def.abilities[st.s].onTick(this, h, st)); }
    if (h.dashing) return this.stepDash(h);
    if (h.casting) { if (T >= h.casting.at) { const f = h.casting.fire; h.casting = null; f(); } return; }
    if (h.recall) {
      if (T >= h.recall.at) { this.sfx(h, 'recallDone'); h.recall = null; h.x = sp.x; h.y = sp.y; h.order = null; this.fx({ e: 'blink', x: h.x, y: h.y }); }
      return;
    }
    if (h.bot && !h.ai) return this.stepBot(h);
    const o = h.order, st = h.state;
    if (st && st.lock) return;
    if (st && st.noAttack) { if (o && (o.type === 'move' || o.type === 'amove') && this.moveToward(h, o.x, o.y)) h.order = null; return; }
    if (this.stepWindup(h)) return;
    if (!o) return;                                  // idle heroes never attack on their own: it takes an attack click or attack-move
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
    const post = this.frontTower(h.team), dir = h.team === 'blue' ? 1 : -1;
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
    if (done) { h.dashing = null; this.unstick(h); if (d.onEnd) d.onEnd(); if (d.follow && !d.follow.dead) h.order = { type: 'atk', id: d.follow.id }; else if (h.order && h.order.type === 'move') h.order = null; }
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
      const within = u => this.inRange(t, u);
      tg = this.nearestEnemy(t, Infinity, u => u.type === 'minion' && within(u)) || this.nearestEnemy(t, Infinity, within);
    }
    t.targetId = tg ? tg.id : 0;
    if (tg) this.engage(t, tg);
  }
  // Minions that overlap each other (right after spawning, mostly) are eased apart a little each tick.
  // Only minions are moved here, and never by more than RULES.collision.nudge. Heroes are never pushed.
  separate() {
    const C = RULES.collision, ms = [...this.units.values()].filter(u => u.type === 'minion');
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j], min = a.coll + b.coll; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy);
      if (d >= min || a.push || b.push) continue;
      if (d < 0.01) { dx = 1; dy = (a.id % 2 ? 1 : -1); }
      const len = Math.hypot(dx, dy), k = Math.min(C.nudge, (min - d) / 2) / len;
      a.x -= dx * k; a.y -= dy * k; b.x += dx * k; b.y += dy * k;
    }
  }
  stepShots() {
    const keep = [];
    for (const s of this.shots) {
      if (s.kind === 'home') {
        const t = s.target; if (t.dead) continue;
        const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), st = s.speed * DT;
        if (d <= st + t.radius * 0.5) { if (s.sl != null) this.sfx(s.src, 'hit', t, { s: s.sl }); this.inSlot(s.sl, () => s.onHit()); continue; }
        s.x += dx / d * st; s.y += dy / d * st; keep.push(s);
      } else {
        const st = Math.min(s.speed * DT, s.left); let dead = false;
        for (let i = 0, n = Math.ceil(st / 25); i < n && !dead; i++) {
          s.x += s.dx * st / n; s.y += s.dy * st / n; s.dist += st / n;
          for (const t of this.enemiesIn(s.team, s.x, s.y, s.w / 2)) {
            if (s.hit.has(t.id)) continue;
            s.hit.add(t.id); if (s.sl != null) this.sfx(s.src, 'hit', t, { s: s.sl }); this.inSlot(s.sl, () => s.onHit(t, s));
            if (!s.pierce) { dead = true; break; }
          }
        }
        s.left -= st;
        if (!dead && s.left > 0 && s.x > 0 && s.x < MAP.w) keep.push(s);
        else if (!dead && !s.pierce && s.sl != null) this.sfx(s.src, 'miss', s, { s: s.sl });      // it ran out without hitting anything
      }
    }
    this.shots = keep;
  }
  stepZones() {
    this.zones = this.zones.filter(z => {
      if (this.time < z.at) return true;
      if (z.shape === 'line') this.fx({ e: 'beam', x: z.x | 0, y: z.y | 0, a: +Math.atan2(z.dy, z.dx).toFixed(3), l: z.len | 0, w: z.w, c: z.color });
      else if (!z.quiet) this.fx({ e: 'burst', x: z.x, y: z.y, r: z.r, c: z.color });
      if (z.onLand) z.onLand();
      let centre = 0, heroes = 0;
      this.inSlot(z.sl, () => { for (const t of this.strikeTargets(z)) { const c = z.inner > 0 && Math.hypot(t.x - z.x, t.y - z.y) <= z.inner; if (c) centre = 1; if (t.type === 'hero') heroes = 1; z.onHit(t, c); } });
      if (z.sl != null) this.sfx(z.src, 'land', z.shape === 'line' ? { x: z.x + z.dx * z.len / 2, y: z.y + z.dy * z.len / 2 } : z, { s: z.sl, v: 1, ...(centre ? { c: 1 } : {}), ...(heroes ? { hh: 1 } : {}), ...(z.n ? { n: z.n } : {}) });
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
      if (u.type === 'minion') { o.m = Math.max(0, MINION_KINDS.indexOf(u.kind)); o.f = +u.face.toFixed(2); o.tg = u.targetId; if (this.ghostMinion(u)) o.gh = 1; }
      if (u.type === 'tower') { o.tg = u.targetId; if (u.plates) o.pl = u.plates; }
      if (u.type === 'hero') Object.assign(o, { h: u.hero, n: u.name, lvl: u.lvl, mp: r(u.mp), mmp: r(u.mmp), f: +u.face.toFixed(2),
        d: u.dead ? Math.ceil(u.respawnAt - T) : 0, st: T < u.stunUntil ? 1 : 0, rt: T < u.rootUntil ? 1 : 0,
        sl: this.buffMax(u, 'slow') > 0 ? 1 : 0, sh: r((u.shieldUntil > T ? u.shieldAmt : 0) + (u.floorShield && u.floorShield.until > T ? u.floorShield.amt : 0)),
        rc: u.recall ? +(1 - (u.recall.at - T) / RULES.recallTime).toFixed(2) : 0, br: this.brushOf(u) >= 0 ? 1 : 0,
        mk: u.mark && u.mark.until > T ? 1 : 0, kl: u.kills, cs: u.cs,
        pr: u.def.passive && u.def.passive.wait && u.def.passive.wait(this, u) <= 0 ? 1 : 0,
        pn: u.def.passive && u.def.passive.count ? u.def.passive.count(this, u) : 0,
        si: T < u.silenceUntil ? 1 : 0, ku: T < u.airUntil ? 1 : 0, em: u.emp && u.emp.until > T ? 1 : 0,
        cn: u.state && u.state.name === 'channel' ? 1 : 0,
        ab: u.ambushUntil > T ? 1 : 0, fz: u.buffs.some(b => b.tag === 'chill') ? 1 : 0, bn: u.burn ? 1 : 0,   // Dusk Blade charged, chilled, burning
        // for the client's movement prediction: nm = cannot walk right now, fm = being moved by force, gh = ignores unit collision
        nm: T < u.stunUntil || T < u.rootUntil || (u.state && u.state.lock) || u.casting || u.recall ? 1 : 0,
        fm: u.push || u.dashing ? 1 : 0, gh: u.ghostUntil > T ? 1 : 0,
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
      sc: Object.fromEntries(['blue', 'red'].map(t => { const hs = [...this.heroes.values()].filter(h => h.team === t);   // team scores
        return [t[0], { n: hs.map(h => h.name).join(' & '), k: hs.reduce((n, h) => n + h.kills, 0), cs: hs.reduce((n, h) => n + h.cs, 0) }]; })),
      ev: this.events.filter(e => e.p === undefined || e.p === pid), over: this.over };
    if (me) snap.me = { id: me.id, gold: Math.floor(me.gold), xp: r(me.xp), xpn: xpToNext(me.lvl), pts: me.points, ranks: me.ranks,
      cds: me.cds.map(c => Math.max(0, +(c - T).toFixed(1))), sd: Math.max(0, r(me.spellCds.d - T)), sf: Math.max(0, r(me.spellCds.f - T)),
      items: me.items.map(s => ({ id: s.id, n: s.n })), undo: me.undo.length, hs: r(me.haste), cr: r(me.crit), ls: r(me.lifesteal), apn: r(me.armorPen), mpp: r(me.magicPenPct), mpf: r(me.magicPenFlat),
      ad: r(me.ad), ap: r(me.ap), ar: r(me.armor), mr: r(me.mr), ms: r(this.speed(me)), as: +this.atkSpeed(me).toFixed(2),
      range: me.range, sell: !me.dead && this.dist(me, MAP.spawn[me.team]) <= MAP.fountainR, miss: me.missed, wave: this.waveNo, pv: me.def.passive && me.def.passive.wait ? Math.max(0, +me.def.passive.wait(this, me).toFixed(1)) : 0,
      bt: me.state && me.state.name === 'barrage' ? Math.max(0, +(me.state.until - T).toFixed(1)) : 0, shop: me.dead || this.dist(me, MAP.spawn[me.team]) <= MAP.fountainR };
    return snap;
  }
}
