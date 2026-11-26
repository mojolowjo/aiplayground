// The bot brain, from the Bot AI design doc. One shared brain plays every rival; a rival is a skill tier
// (how well and how fast it thinks) plus a personality (what it wants to do), both plain data.
// The bot plays by the player's rules: same Spark, same hand, same deploy time, and it only sees what is
// on screen, a little late (its reaction delay). It sends the same "play card X at Y" command a player does.
import { ALL_CARDS, CARDS, CARD_IDS, STARTER_DECK } from './cards.js';
import { DEF, TPS, SPARK, MT, W, H, LANES_X, ownY, laneOf, isqrt } from './sim.js';

// ---------- skill tiers (Fairness table) ----------
// react: seconds of stale view; gap: fastest play rate (seconds between cards); wobble: placement error in tiles;
// mistake: % chance per play of a believable error; est/memory: counts your Spark / remembers your cycle;
// smart: how well it judges which card answers which threat (0 picks almost blindly, 1 uses the full counter table).
export const TIERS = {
  rookie:  { react: 2.0, gap: 3.0, wobble: 2.0, mistake: 25, est: false, memory: 0, smart: 0.15 },
  trainee: { react: 1.5, gap: 2.0, wobble: 1.5, mistake: 15, est: false, memory: 0, smart: 0.4 },
  skilled: { react: 1.0, gap: 1.5, wobble: 1.0, mistake: 8,  est: true,  memory: 0, smart: 0.65 },
  veteran: { react: 0.7, gap: 1.2, wobble: 0.5, mistake: 4,  est: true,  memory: 20, smart: 0.85 },
  expert:  { react: 0.5, gap: 1.0, wobble: 0.3, mistake: 2,  est: true,  memory: 999, smart: 1 },
};

// ---------- rivals (Personalities per arena) ----------
// Style knobs (0..1 unless noted): aggression (tower damage over saving Spark), patience (how full the bar must be
// before a push), lane ('left' | 'right' | 'alt' | 'weak' | 'one'), greed (targets a spell wants), defence
// ('bridge' early or 'tower' late), risk (leaves a lane open to punish). Rival names and lines are placeholders.
export const RIVALS = [
  { id: 'pip', arena: 1, name: 'Pip the Deckhand', tier: 'rookie', slow: true, hints: true, color: '#7ec850',
    style: { aggression: 0.3, patience: 0.3, lane: 'one', greed: 3, defence: 'tower', risk: 0.1 },
    core: [], plans: [], lines: { start: 'Ahoy! Let\'s learn the ropes.', take: 'Oops, did I do that?', lose: 'Good shot!', win: 'Again, again!', defeat: 'You\'re a natural!' } },
  { id: 'bea', arena: 2, name: 'Brassy Bea', tier: 'rookie', color: '#e8b030',
    style: { aggression: 0.9, patience: 0.05, lane: 'alt', greed: 3, defence: 'bridge', risk: 0.6 },
    core: ['imps', 'moths', 'fox', 'slingers'], plans: [['imps', 'fox']], costShift: -0.6,
    lines: { start: 'Swarm time!', take: 'Noob!', lose: 'Hey, rude!', win: 'Too many, too fast!', defeat: 'Fine, you got me.' } },
  { id: 'moss', arena: 3, name: 'Old Moss', tier: 'trainee', color: '#4f8a3c',
    style: { aggression: 0.35, patience: 0.85, lane: 'weak', greed: 2, defence: 'tower', risk: 0.1 },
    core: ['treant', 'turret', 'hedge', 'slingers'], plans: [['treant', 'slingers'], ['hedge', 'treant']], costShift: 0.3,
    lines: { start: 'Patience, young one.', take: 'Slow and steady.', lose: 'Hm. Sharp.', win: 'The forest always wins.', defeat: 'Well grown.' } },
  { id: 'kestrel', arena: 4, name: 'The Kestrel Twins', tier: 'trainee', color: '#d06a3a',
    style: { aggression: 0.7, patience: 0.4, lane: 'alt', greed: 2, defence: 'bridge', risk: 0.5 },
    core: ['roller', 'fox', 'harpoon', 'imps'], plans: [['roller', 'fox']],
    lines: { start: 'Left or right? Guess!', take: 'Wrong lane!', lose: 'Ow! Sister, help!', win: 'Twice as nice.', defeat: 'Next time we split three ways.' } },
  { id: 'fizz', arena: 5, name: 'Professor Fizz', tier: 'skilled', color: '#40a0e0',
    style: { aggression: 0.5, patience: 0.6, lane: 'weak', greed: 2, defence: 'tower', risk: 0.3, spellLove: 1.6 },
    core: ['flamejar', 'shower', 'frost', 'hermit', 'tide'], plans: [['tide', 'flamejar']],
    lines: { start: 'Let us run an experiment.', take: 'Fascinating.', lose: 'An anomaly!', win: 'Hypothesis confirmed.', defeat: 'Back to the lab...' } },
  { id: 'gear', arena: 6, name: 'Gearheart', tier: 'skilled', color: '#b08850', bigPushInDouble: true,
    style: { aggression: 0.6, patience: 0.95, lane: 'weak', greed: 3, defence: 'tower', risk: 0.2 },
    core: ['golem', 'captain', 'ember', 'brute'], plans: [['golem', 'ember'], ['golem', 'captain']], costShift: 0.7,
    lines: { start: 'Wind it up...', take: 'Crunch.', lose: 'A loose bolt.', win: 'Full steam!', defeat: 'Needs oiling.' } },
  { id: 'vex', arena: 7, name: 'Vex', tier: 'veteran', color: '#9050d0', baiter: true,
    style: { aggression: 0.75, patience: 0.4, lane: 'alt', greed: 2, defence: 'bridge', risk: 0.6 },
    core: ['shade', 'roller', 'moths', 'shower', 'fox'], plans: [['moths', 'roller'], ['fox', 'shade']], costShift: -0.3,
    lines: { start: 'Show me your counters.', take: 'Too easy.', lose: 'Clever.', win: 'You took the bait.', defeat: 'Hmph.' } },
  { id: 'rook', arena: 8, name: 'Captain Rook', tier: 'veteran', color: '#c8c8d0', punisher: true,
    style: { aggression: 0.65, patience: 0.5, lane: 'weak', greed: 2, defence: 'tower', risk: 0.8 },
    core: ['loft', 'harpoon', 'roller', 'hedge', 'gust'], plans: [['hedge', 'roller']],
    lines: { start: 'Your move.', take: 'Check.', lose: 'A fine sacrifice.', win: 'Checkmate.', defeat: 'Good game. Truly.' } },
  { id: 'archivist', arena: 9, name: 'The Archivist', tier: 'expert', reactAs: 'veteran', adaptive: true, color: '#d8c890',
    style: { aggression: 0.6, patience: 0.6, lane: 'weak', greed: 2, defence: 'tower', risk: 0.4 },
    core: ['trio', 'wyvern', 'tide', 'meteor'], plans: [['tide', 'trio']], costShift: 0.6,
    lines: { start: 'I have read about you.', take: 'As written.', lose: 'A footnote.', win: 'Filed under defeated.', defeat: 'A new chapter.' } },
  { id: 'assim', arena: 10, name: 'AI Assimilation', tier: 'expert', boss: true, adaptive: true, color: '#30f070',
    style: { aggression: 0.65, patience: 0.55, lane: 'weak', greed: 2, defence: 'bridge', risk: 0.5 },
    core: [], plans: [],
    lines: { start: 'Your patterns have been recorded.', take: 'Predicted.', lose: 'Recalibrating.', win: 'Assimilation complete.', defeat: 'Error. Learning.' } },
];
export const rivalById = id => RIVALS.find(r => r.id === id);

// Pick who you face in an arena: the headline rival about half the time, otherwise one of two earlier rivals
// returning with this arena's levels and brain (Keeping it fresh).
export function pickRival(arena, rnd = Math.random) {
  const head = RIVALS.find(r => r.arena === Math.min(arena, 10));
  if (arena <= 2 || head.boss || rnd() < 0.5) return { rival: head, headline: true };
  const earlier = RIVALS.filter(r => r.arena < arena && r.arena >= Math.max(2, arena - 3) && !r.boss);
  const pick = earlier[Math.floor(rnd() * earlier.length)] || head;
  return { rival: pick, headline: pick === head };
}

// ---------- card knowledge ----------
const has = (id, tag) => (ALL_CARDS[id]?.tags || []).includes(tag);
export const hitsAir = id => { const d = DEF[id]; return d.type === 'spell' || d.targets === 'both' || (d.spawn && DEF[d.spawn.card].targets === 'both'); };
// Rough fighting strength of a card: total health times total damage per second, in thousands.
export function power(id, pct = 100) {
  const d = DEF[id], c = ALL_CARDS[id];
  if (d.type === 'spell') return 0;
  if (d.spawn) return 35 * pct / 100;
  const hp = (c.hp + (c.shield || 0)) * d.count * pct / 100, dps = (c.dmg || 0) * d.count / (c.hit || 1) * pct / 100;
  return hp * dps / 1000;
}
const unitThreat = u => {           // how much a live enemy unit is worth worrying about
  const c = ALL_CARDS[u.card] || {}, d = DEF[u.card];
  if (!d || u.kind !== 'troop') return 0;
  const dps = (u.dmg || c.dmg || 0) / (c.hit || 1);
  return u.hp * dps / 1000;
};

// Build a rival's 8 cards: its signature core, then filler from the player's cards and next offer,
// checked for coverage (air, swarm, building-targeter answers, a spell) and average cost.
export function buildDeck(rival, pool, rnd = Math.random, extraCore = []) {
  if (rival.id === 'pip') return STARTER_DECK.slice();
  const core = [...new Set([...rival.core, ...extraCore])].filter(id => ALL_CARDS[id]).slice(0, 5);
  const fillPool = [...new Set(pool)].filter(id => CARDS[id] && !core.includes(id));
  const wantAvg = 3.75 + (rival.costShift || 0);
  const covers = deck => ({
    air: deck.some(id => DEF[id].type !== 'spell' && hitsAir(id)),
    swarm: deck.some(id => has(id, 'antiswarm') || has(id, 'splash')),
    bt: deck.some(id => DEF[id].type === 'building' || has(id, 'bruiser') || has(id, 'minitank')),
    spell: deck.some(id => DEF[id].type === 'spell'),
  });
  let best = null, bestScore = -Infinity;
  for (let attempt = 0; attempt < 40; attempt++) {
    const deck = core.slice(), left = fillPool.slice();
    while (deck.length < 8 && left.length) {
      const weights = left.map(id => 1 + synergy(deck, id));
      let r = rnd() * weights.reduce((a, b) => a + b, 0), i = 0;
      while (i < left.length - 1 && (r -= weights[i]) > 0) i++;
      deck.push(left.splice(i, 1)[0]);
    }
    while (deck.length < 8) { const id = CARD_IDS.find(c => !deck.includes(c)); deck.push(id); }
    const cov = covers(deck), avg = deck.reduce((a, id) => a + ALL_CARDS[id].cost, 0) / 8;
    const score = Object.values(cov).filter(Boolean).length * 10 - Math.abs(avg - wantAvg) * 4 - (avg < 3 || avg > 4.8 ? 20 : 0) + rnd();
    if (score > bestScore) { best = deck; bestScore = score; }
    if (Object.values(cov).every(Boolean) && Math.abs(avg - wantAvg) < 0.6) break;
  }
  return best;
}
function synergy(deck, id) {
  let s = 0;
  const tank = deck.some(c => has(c, 'tank') || has(c, 'wincon'));
  if (tank && (has(id, 'splash') || has(id, 'ranged') || has(id, 'support'))) s += 1.5;
  if (!tank && (has(id, 'tank') || has(id, 'wincon'))) s += 2;
  if (!deck.some(c => DEF[c].type === 'spell') && DEF[id].type === 'spell') s += 2;
  if (!deck.some(c => DEF[c].type !== 'spell' && hitsAir(c)) && DEF[id].type !== 'spell' && hitsAir(id)) s += 2;
  return s;
}

// ---------- the brain ----------
function rng32(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class Bot {
  // opts: { side, rival, tier (name or knobs), progress (0..1 inside the arena), seed, notes, profile, dummy }
  constructor(opts) {
    this.side = opts.side;
    this.rival = opts.rival || RIVALS[0];
    const tier = { ...TIERS[this.rival.tier] };
    if (this.rival.reactAs) tier.react = TIERS[this.rival.reactAs].react;
    if (this.rival.slow) { tier.react = 2.5; tier.gap = 4; }
    const prog = Math.max(0, Math.min(1, opts.progress || 0));
    tier.react = Math.max(0.3, tier.react - 0.2 * prog);        // Glory tunes it a little inside an arena
    tier.mistake = tier.mistake * (1 - prog / 3);
    this.tier = tier;
    this.style = { aggression: 0.5, patience: 0.5, lane: 'weak', greed: 2, defence: 'tower', risk: 0.3, spellLove: 1, ...this.rival.style };
    this.rnd = rng32(opts.seed || 12345);
    this.notes = opts.notes || {};          // what this rival remembers about you: { favLane, opener }
    this.profile = opts.profile || null;    // AI Assimilation: what it learned from all your matches
    this.dummy = !!opts.dummy;
    this.history = [];                      // delayed views of the board
    this.seen = [];                         // your card plays it has seen: { card, tick }
    this.estSpark = 5;
    this.lastPlay = -999;
    this.plan = null;
    this.altLane = 0;
    this.pendingHint = null;
    this.speech = null; this.lastSpeech = -999;
    this.debug = { scores: [], threat: [0, 0], plan: null };
    this.lastEnemyPlayTick = -999;
    if (this.profile?.favLane != null) this.notes.favLane = this.profile.favLane;
  }

  say(tick, text, force) {
    if (!text || (!force && tick - this.lastSpeech < 15 * TPS)) return;
    this.speech = { text, until: tick + 3 * TPS }; this.lastSpeech = tick;
  }

  // Feed it the battle's events, so it can react to what a player would see and hear.
  onEvents(battle, events) {
    const me = this.side, t = battle.tick;
    for (const e of events) {
      if (e.e === 'play' && e.side !== me) { this.seen.push({ card: e.card, tick: t }); this.lastEnemyPlayTick = t; }
      if (e.e === 'die' && e.kind === 'tower') this.say(t, e.side === me ? this.rival.lines?.lose : this.rival.lines?.take);
      if (e.e === 'end') this.say(t, e.winner === me ? this.rival.lines?.win : e.winner === -1 ? null : this.rival.lines?.defeat, true);
    }
  }

  observe(b) {
    const me = this.side;
    return { tick: b.tick, units: b.s.units.filter(u => u.side === me || !u.hidden).map(u => ({ id: u.id, card: u.card, side: u.side, kind: u.kind, type: u.type, lane: u.lane, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp, air: u.air, dmg: u.dmg, r: u.r, target: u.target, deploy: u.deploy })) };
  }

  // Call once per tick, before battle.step(). Returns the commands it scheduled (for logging).
  think(b) {
    const me = this.side, tick = b.tick;
    if (this.speech && tick > this.speech.until) this.speech = null;
    if (tick === 1) this.say(tick, this.rival.lines?.start, true);
    if (this.dummy || b.s.over) return null;
    if (this.pendingHint && tick >= this.pendingHint.at) {        // Pip shows a hint, then plays
      const c = this.pendingHint.cmd; this.pendingHint = null;
      if (b.canPlay(me, c.card)) { b.schedule({ ...c, tick }); this.lastPlay = tick; return c; }
    }
    if (tick % 5 !== 0) return null;
    this.history.push(this.observe(b));
    const lag = Math.round(this.tier.react * TPS / 5);
    if (this.history.length > lag + 3) this.history.shift();
    const view = this.history[Math.max(0, this.history.length - 1 - lag)];
    const prev = this.history[Math.max(0, this.history.length - 2 - lag)];
    this.updateSparkEstimate(b, view);
    if (this.pendingHint) return null;
    if (tick - this.lastPlay < this.tier.gap * TPS) return null;
    const cmd = this.decide(b, view, prev);
    if (!cmd) return null;
    if (this.rival.hints && ALL_CARDS[cmd.card].cost >= 3) {
      const side = cmd.x < W / 2 ? 'left' : 'right';
      this.say(tick, `${ALL_CARDS[cmd.card].name}, ${DEF[cmd.card].type === 'spell' ? 'incoming' : 'going ' + side}!`, true);
      this.pendingHint = { at: tick + 30, cmd };
      return null;
    }
    b.schedule({ ...cmd, tick });
    this.lastPlay = tick;
    if (this.plan && this.plan.cards[0] === cmd.card) { this.plan.cards.shift(); if (!this.plan.cards.length) this.plan = null; }
    else this.startPlan(cmd, tick);
    return cmd;
  }

  updateSparkEstimate(b, view) {
    // Count your Spark the way a sharp player would: regen over time minus every card you were seen playing.
    const seen = this.seen.filter(p => p.tick <= view.tick);
    const mult = b.sparkMult();
    const dt = 5 / TPS;
    this.estSpark = Math.min(10, this.estSpark + dt * mult / 2.8);
    for (const p of seen.filter(p => !p.counted)) { p.counted = true; this.estSpark = Math.max(0, this.estSpark - ALL_CARDS[p.card].cost); }
  }

  startPlan(cmd, tick) {
    const plan = (this.rival.plans || []).find(p => p[0] === cmd.card);
    if (plan) this.plan = { cards: plan.slice(1), until: tick + 12 * TPS, lane: laneOf(cmd.x), anchor: cmd };
  }

  // ---------- scoring ----------
  decide(b, view, prev) {
    const me = this.side, foe = 1 - me, P = b.s.players[me], st = this.style;
    const spark = P.spark / SPARK;
    const lvlPct = 100;
    const mine = view.units.filter(u => u.side === me), theirs = view.units.filter(u => u.side === foe);
    const myTowers = mine.filter(u => u.kind === 'tower'), theirTowers = theirs.filter(u => u.kind === 'tower');
    const vel = new Map();
    if (prev) for (const u of view.units) { const p = prev.units.find(q => q.id === u.id); if (p) vel.set(u.id, [(u.x - p.x) / 5, (u.y - p.y) / 5]); }
    const oy = u => ownY(me, u.y);                                       // big = deep in my half
    const hand = P.hand.filter(id => b.canPlay(me, id));
    if (!hand.length) return null;

    // Lane threat: enemy troops heading for each of my lanes, weighted by how close they are.
    const threat = [0, 0], groups = [[], []];
    for (const u of theirs) {
      if (u.kind !== 'troop') continue;
      const depth = oy(u);
      if (depth < 9 * MT) continue;
      const w = Math.min(2.2, (depth - 9 * MT) / (8 * MT) + 0.2);
      let t = unitThreat(u) * w;
      const lane = laneOf(u.x);
      if (u.air && !hand.some(id => hitsAir(id) && DEF[id].type !== 'spell')) t *= 1.4;
      if (this.notes.favLane === lane && this.tier.est) t *= 1.3;          // it remembers where you like to attack
      threat[lane] += t; groups[lane].push(u);
    }
    // Defenders already there soak some of it, and the tower soaks small stuff by itself.
    for (let lane = 0; lane < 2; lane++) {
      let mineHere = 0;
      for (const u of mine) if (u.kind !== 'tower' && laneOf(u.x) === lane && oy(u) > 14 * MT) mineHere += unitThreat(u) * 0.8 + (u.kind === 'building' ? 40 : 0);
      const towerUp = myTowers.some(t => t.type === 'watch' && t.lane === lane);
      threat[lane] = Math.max(0, threat[lane] - mineHere - (towerUp ? 45 : 25));
    }
    this.debug.threat = threat.map(v => Math.round(v));

    const moves = [];
    const add = (kind, card, x, y, score, why) => moves.push({ kind, card, x, y, score, why });
    const towerOf = lane => myTowers.find(t => t.type === 'watch' && t.lane === lane) || myTowers.find(t => t.type === 'keep');
    const toWorld = (x, oyv) => [x, me === 0 ? oyv : H - oyv];

    // Defend
    for (let lane = 0; lane < 2; lane++) {
      if (threat[lane] < 8) continue;
      const g = groups[lane];
      const swarm = g.filter(u => u.r <= 300).length, airHp = g.filter(u => u.air).reduce((a, u) => a + u.hp, 0), allHp = g.reduce((a, u) => a + u.hp, 0) || 1;
      const bt = g.some(u => DEF[u.card].targets === 'buildings');
      const front = g.reduce((a, u) => !a || oy(u) > oy(a) ? u : a, null);
      const tower = towerOf(lane);
      for (const id of hand) {
        const d = DEF[id]; if (d.type === 'spell') continue;
        let fit = 1;
        if (d.targets === 'buildings') fit *= 0.1;
        if (airHp > allHp * 0.5 && !hitsAir(id)) fit *= 0.1;
        if (swarm >= 3 && (has(id, 'antiswarm') || has(id, 'splash'))) fit *= 2.2;
        if (swarm >= 3 && d.count === 1 && !d.splash && ALL_CARDS[id].cost >= 4) fit *= 0.5;
        if (bt && d.type === 'building') fit *= 2;
        if (!bt && d.type === 'building') fit *= 0.8;
        fit = 1 + (fit - 1) * this.tier.smart;                          // low tiers barely see which card counters what
        const pw = power(id, lvlPct) * fit;
        const value = Math.min(threat[lane], pw);
        const cost = ALL_CARDS[id].cost;
        let score = value / cost * 1.1 + (threat[lane] > 80 ? 8 : 0);
        if (this.holdCounter(id) && threat[lane] < 30) score *= 0.5;
        // Where: ranged and buildings near the tower; melee meets the front unit; buildings pull from the middle.
        let x, y;
        if (d.type === 'building') {
          [x, y] = toWorld(lane === 0 ? W / 2 - 1.8 * MT : W / 2 + 1.8 * MT, 21.5 * MT);
        } else if (d.range > 2 * MT || st.defence === 'tower') {
          const ty = tower ? oy(tower) : 26 * MT;
          [x, y] = toWorld(lane === 0 ? LANES_X[0] + 1.5 * MT : LANES_X[1] - 1.5 * MT, ty - 2.5 * MT);
          if (front && d.range <= 2 * MT) { x = front.x; y = toWorld(0, Math.min(Math.max(oy(front) + 1.5 * MT, 18 * MT), 27 * MT))[1]; }
        } else {
          const fy = front ? Math.max(18 * MT, Math.min(oy(front) + 1.5 * MT, 27 * MT)) : 21 * MT;
          [x, y] = toWorld(front ? front.x : LANES_X[lane], fy);
        }
        add('defend', id, x, y, score, `defend ${lane ? 'R' : 'L'} ${Math.round(threat[lane])}`);
      }
    }

    // Spell value: the best circle on predicted positions (units move during the spell's travel time).
    for (const id of hand) {
      const d = DEF[id]; if (d.type !== 'spell') continue;
      const cost = ALL_CARDS[id].cost;
      const travel = d.delayT;
      const lead = this.tier.smart >= 0.5 ? travel : 0;              // better bots aim where units will be
      const pts = theirs.filter(u => u.kind !== 'tower').map(u => { const v = vel.get(u.id) || [0, 0]; return { u, x: u.x + v[0] * lead, y: u.y + v[1] * lead }; });
      let bestV = 0, bx = 0, by = 0, bn = 0;
      for (const c of pts) {
        let value = 0, n = 0;
        for (const p of pts) {
          const dx = p.x - c.x, dy = p.y - c.y;
          if (isqrt(dx * dx + dy * dy) - p.u.r > d.radius) continue;
          n++;
          const c2 = ALL_CARDS[p.u.card] || CARDS.imps, count = DEF[p.u.card].count || 1, unitCost = (c2.cost || 1) / count;
          const dmg = (d.dmg || 0) * (DEF[p.u.card].spellWeak ? 1.25 : 1);
          if (dmg >= p.u.hp) value += unitCost;
          else value += unitCost * dmg / p.u.maxHp * 0.6;
          if (d.freeze) value += unitCost * 0.35 * (oy(p.u) > 20 * MT ? 2 : 0.5);
          if (d.push) value += oy(p.u) > 22 * MT ? unitCost * 0.4 : 0;
        }
        for (const t of theirTowers) {                                   // chipping a tower behind them is a bonus
          const dx = t.x - c.x, dy = t.y - c.y;
          if (isqrt(dx * dx + dy * dy) - t.r <= d.radius && d.dmg) value += d.dmg * 0.35 / 350 * (st.aggression + 0.3);
        }
        if (value > bestV) { bestV = value; bx = c.x; by = c.y; bn = n; }
      }
      if (bn >= Math.max(1, st.greed) || bestV >= cost * 1.2) {
        const score = (bestV - cost * 0.8) * 6 * st.spellLove;
        if (score > 0) add('spell', id, bx, by, score, `spell x${bn} v${bestV.toFixed(1)}`);
      }
      // Late in the match, finish a low tower with a big spell.
      if (d.dmg >= 500 && b.timeLeft() < 30 * TPS) for (const t of theirTowers) {
        if (t.hp <= d.dmg * 0.35) add('spell', id, t.x, t.y, 60, 'finish tower');
      }
    }

    // Push: spend a healthy bar on an attack in the chosen lane.
    const full = spark >= 9.3;
    const doubleTime = b.sparkMult() >= 2;
    const need = 4 + st.patience * 5.5 - (doubleTime && this.rival.bigPushInDouble ? 0 : 0);
    const dangerNow = threat[0] + threat[1] > 40;
    const pushLane = this.pickLane(b, theirTowers);
    const lead = this.tier.est ? this.estSpark : 5;
    for (const id of hand) {
      const d = DEF[id], c = ALL_CARDS[id]; if (d.type === 'spell') continue;
      const cost = c.cost;
      if (spark < Math.min(10, need) && !full && !(this.plan && this.plan.cards[0] === id)) continue;
      if (dangerNow && !full) continue;
      let score = (power(id) / cost) * 0.25 * (0.6 + st.aggression);
      if (has(id, 'wincon') || has(id, 'tank')) score += 10 * st.aggression + 4;
      if (d.type === 'building') score *= 0.25;
      if (this.tier.est && lead < 3) score += 8 * st.risk;                   // punish: you just spent big
      if (this.rival.bigPushInDouble && has(id, 'tank') && !doubleTime) score *= 0.4;
      if (this.rival.baiter && cost <= 3 && !this.baited) score += 6;
      let x = LANES_X[pushLane], oyv;
      if (has(id, 'tank') || (has(id, 'wincon') && cost >= 6)) oyv = 30.5 * MT;              // big tanks start at the back
      else if (has(id, 'wincon') || d.speed >= 70) oyv = 17.8 * MT;                          // fast pushers at the bridge
      else oyv = 22 * MT;
      // Support goes behind our own push.
      const lead2 = mine.filter(u => u.kind === 'troop' && laneOf(u.x) === pushLane).sort((a, b2) => oy(a) - oy(b2))[0];
      if (lead2 && !has(id, 'tank') && d.type === 'troop') { x = lead2.x; oyv = Math.max(17.8 * MT, Math.min(31 * MT, oy(lead2) + 2 * MT)); score += 5; }
      const [wx, wy] = toWorld(x, oyv);
      add('push', id, wx, wy, score, `push ${pushLane ? 'R' : 'L'}`);
    }

    // Follow a live plan: the next card of the combo, behind the first.
    if (this.plan && b.tick < this.plan.until && !dangerNow) {
      const id = this.plan.cards[0];
      if (hand.includes(id)) {
        const anchor = mine.find(u => u.card === this.plan.anchor.card && u.kind === 'troop');
        const d = DEF[id];
        let x = anchor ? anchor.x : this.plan.anchor.x, oyv = anchor ? Math.min(31 * MT, oy(anchor) + 1.5 * MT) : ownY(me, this.plan.anchor.y);
        if (d.type === 'spell') { const t = theirTowers.find(t => laneOf(t.x) === this.plan.lane) || theirTowers[0]; if (t) { x = t.x; oyv = ownY(me, t.y); } }
        else oyv = Math.max(17.8 * MT, oyv);
        const [wx, wy] = toWorld(x, oyv);
        add('plan', id, wx, wy, 30 + 10 * st.aggression, 'plan');
      }
    } else if (this.plan && b.tick >= this.plan.until) this.plan = null;

    // Cycle: the bar is full and nothing better to do.
    if (full) {
      const cheap = hand.slice().sort((a, b2) => ALL_CARDS[a].cost - ALL_CARDS[b2].cost)[0];
      const d = DEF[cheap];
      if (d.type !== 'spell') { const [wx, wy] = toWorld(LANES_X[pushLane], 30.5 * MT); add('cycle', cheap, wx, wy, 6, 'cycle'); }
    }

    // Wait
    const wait = 4 + st.patience * 6 - (full ? 8 : 0);
    const wob = 1 + this.tier.mistake / 10 + (1 - this.tier.smart) * 3;
    for (const m of moves) m.score += (this.rnd() - 0.5) * wob * 4;
    moves.sort((a, b2) => b2.score - a.score);
    this.debug.scores = moves.slice(0, 3).map(m => `${m.why} ${ALL_CARDS[m.card].name} ${m.score.toFixed(1)}`);
    this.debug.plan = this.plan ? this.plan.cards.join('+') : null;
    let pick = moves[0];
    if (!pick || pick.score < wait) return null;
    // A believable mistake: the second-best move, or a troop one tile off.
    if (this.rnd() * 100 < this.tier.mistake) {
      if (moves[1] && moves[1].score > wait * 0.5 && this.rnd() < 0.5) pick = moves[1];
      else { pick = { ...pick, x: pick.x + (this.rnd() < 0.5 ? -1 : 1) * MT, y: pick.y + (this.rnd() < 0.5 ? -1 : 1) * MT }; }
    }
    if (pick.kind === 'push' && this.rival.baiter) this.baited = ALL_CARDS[pick.card].cost <= 3;
    if (pick.kind === 'push' && this.style.lane === 'alt') this.altLane = 1 - this.altLane;
    const wobble = this.tier.wobble * MT;
    const x = Math.round(pick.x + (this.rnd() - 0.5) * wobble), y = Math.round(pick.y + (this.rnd() - 0.5) * wobble);
    return { side: me, type: 'play', card: pick.card, x, y };
  }

  // Does this card answer your opener? Then a skilled rival keeps it for that.
  holdCounter(id) {
    const op = this.notes.opener; if (!op || !this.tier.est) return false;
    if (has(op, 'swarm') && (has(id, 'antiswarm') || has(id, 'splash'))) return true;
    if (has(op, 'air') && hitsAir(id)) return true;
    return false;
  }

  pickLane(b, theirTowers) {
    const L = this.style.lane;
    const alive = lane => theirTowers.some(t => t.type === 'watch' && t.lane === lane);
    if (L === 'left') return alive(0) || !alive(1) ? 0 : 1;
    if (L === 'right') return alive(1) || !alive(0) ? 1 : 0;
    if (L === 'one') return 0;
    if (L === 'alt') return this.altLane;
    // 'weak': the lane whose tower has less HP; a rival that knows your favourite lane attacks the other one.
    const hp = lane => { const t = theirTowers.find(t => t.type === 'watch' && t.lane === lane); return t ? t.hp : 99999; };
    if (this.notes.favLane != null && this.tier.memory && Math.abs(hp(0) - hp(1)) < 300) return 1 - this.notes.favLane;
    return hp(0) <= hp(1) ? 0 : 1;
  }
}

// AI Assimilation builds its deck from what it learned: answers to the cards you play most.
export function assimilationDeck(profile, rnd = Math.random) {
  const counts = profile?.cards || {};
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
  const answers = new Set();
  for (const id of top) {
    if (has(id, 'swarm')) answers.add(rnd() < 0.5 ? 'ember' : 'hermit');
    if (has(id, 'air')) answers.add(rnd() < 0.5 ? 'loft' : 'harpoon');
    if (has(id, 'tank') || has(id, 'wincon')) answers.add(['turret', 'shade', 'lancer', 'smasher'][Math.floor(rnd() * 4)]);
    if (has(id, 'ranged')) answers.add('flamejar');
  }
  const core = [...answers].slice(0, 4);
  if (!core.some(id => has(id, 'wincon'))) core.push(rnd() < 0.5 ? 'golem' : 'roller');
  return buildDeck({ id: 'assim', core, costShift: 0.2 }, CARD_IDS, rnd);
}
