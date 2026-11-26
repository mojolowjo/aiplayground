// Progression, from the Progression design v1 doc. Pure functions on a plain save object, so the
// browser (which keeps the save) and the tests share them. Every pacing number lives in PROG.
import { CARDS, CARD_IDS, STARTER_DECK, FIRST_UNLOCK, RARITIES, MAX_LEVEL, ALL_CARDS } from './cards.js';

export const PROG = {
  coins: { win: 100, loss: 40, draw: 60, perWatchtower: 10, keepBonus: 10, friend: 10 },
  glory: { win: 30, loss: -10, draw: 0 },
  keys: { win: 3, draw: 2, loss: 1, perPick: 15 },
  arenaBonusStep: 0.25, arenaBonusMax: 3,
  // Common prices for 1→2 … 8→9; other rarities cost 10% more per tier, rounded to the nearest 10.
  upgrade: [50, 100, 200, 350, 550, 800, 1100, 1500],
  rarityMult: { common: 1, rare: 1.1, epic: 1.21, mythic: 1.33 },
  catchUp: 0.5,                 // upgrading to a level at or below your best card's level costs half
  easedAfter: 3,                // losses in a row before bots ease off
};

export const ARENAS = [
  { n: 1, name: 'Tutorial Island', glory: 0, bot: 1, style: 'Rookie', emote: 'Jobs done!' },
  { n: 2, name: 'Noober', glory: 200, bot: 2, style: 'Rookie', emote: 'Noob!' },
  { n: 3, name: 'Getting Real', glory: 400, bot: 2, style: 'Trainee', emote: 'Cool glasses' },
  { n: 4, name: 'Burger and Fries', glory: 600, bot: 3, style: 'Trainee', emote: 'Burger and fry' },
  { n: 5, name: 'Water World', glory: 800, bot: 3, style: 'Skilled', emote: 'Fizz!' },
  { n: 6, name: 'Big Cogs', glory: 1000, bot: 4, style: 'Skilled', emote: 'Gear toss!' },
  { n: 7, name: 'Not Another Reference', glory: 1200, bot: 4, style: 'Veteran', emote: 'Vex.' },
  { n: 8, name: 'Chess Board', glory: 1400, bot: 5, style: 'Veteran', emote: 'THE ROOOK' },
  { n: 9, name: 'How did we get here?', glory: 1600, bot: 6, style: 'Expert', emote: null },
  { n: 10, name: 'Possible the Matrix', glory: 1800, bot: 7, style: 'AI Assimilation', emote: 'Beep boop.' },   // emote is a placeholder (guess)
];

// Unlock order: rarity tier by how many picks you have made (Gust and 10 Rares, then 6 Epics, then 2 Mythics).
// Gust (FIRST_UNLOCK) is always one of the three in the first offer.
export const OFFER_TIERS = [
  { picks: 11, rarity: 'rare' },
  { picks: 6, rarity: 'epic' },
  { picks: 2, rarity: 'mythic' },
];

export function newSave(name = 'Player') {
  return {
    v: 1, counter: 0, name, coins: 0, glory: 0, keys: 0, picks: 0, arenaMax: 1,
    unlocked: STARTER_DECK.slice(), levels: Object.fromEntries(STARTER_DECK.map(id => [id, 1])),
    deck: STARTER_DECK.slice(), offer: null,
    lossStreak: 0, eased: false,
    stats: { wins: 0, losses: 0, draws: 0, friendly: 0 },
    rivals: {},                                      // per rival: { w, l, d, streak, notes: { lanes: [l, r], openers: {}, favLane, opener } }
    profile: { cards: {}, lanes: [0, 0], matches: 0 },   // everything AI Assimilation learns about you
    settings: { sound: true, taunts: true, music: false },
  };
}

// Fill in anything an older save is missing.
export function fixSave(s) {
  const base = newSave(s?.name || 'Player');
  const out = { ...base, ...(s || {}) };
  out.levels = { ...base.levels, ...(s?.levels || {}) };
  out.settings = { ...base.settings, ...(s?.settings || {}) };
  out.stats = { ...base.stats, ...(s?.stats || {}) };
  out.profile = { ...base.profile, ...(s?.profile || {}) };
  out.unlocked = (out.unlocked || []).filter(id => CARDS[id]);
  for (const id of STARTER_DECK) if (!out.unlocked.includes(id)) out.unlocked.push(id);
  for (const id of out.unlocked) out.levels[id] = Math.max(1, Math.min(MAX_LEVEL, out.levels[id] | 0 || 1));
  out.deck = (out.deck || []).filter(id => out.unlocked.includes(id));
  for (const id of out.unlocked) if (out.deck.length < 8 && !out.deck.includes(id)) out.deck.push(id);
  return out;
}

export const arenaOf = glory => { let a = 1; for (const ar of ARENAS) if (glory >= ar.glory) a = ar.n; return a; };
export const arenaInfo = n => ARENAS[Math.max(1, Math.min(10, n)) - 1];
export const gloryFloor = s => arenaInfo(s.arenaMax).glory;
// Emotes: an arena's emote is earned by moving on from it (reaching the next arena). Arena 10 has no next arena,
// so its emote is earned at CHAMPION_GLORY, the top of the bot ladder (a guess at "moving on" from the last arena).
export const CHAMPION_GLORY = 2400;
export const emoteEarned = (s, n) => n < 10 ? s.arenaMax > n : !!s.champion;
export const ownedEmotes = s => ARENAS.filter(a => a.emote && emoteEarned(s, a.n)).map(a => a.emote);
export const currentArena = s => Math.max(arenaOf(s.glory), 1);

// Bot card level for the arena you are in (Arena 10 climbs 7, 8, 9 at 1,800 / 2,100 / 2,400 Glory).
export function botLevel(s) {
  const a = currentArena(s);
  let lvl = a === 10 ? (s.glory >= 2400 ? 9 : s.glory >= 2100 ? 8 : 7) : arenaInfo(a).bot;
  if (s.eased) lvl = Math.max(1, lvl - 1);
  return lvl;
}
// How far through the current arena's Glory band you are, 0..1 (bots sharpen a little as you climb).
export function arenaProgress(s) {
  const a = currentArena(s); if (a >= 10) return Math.min(1, (s.glory - 1800) / 600);
  return Math.max(0, Math.min(1, (s.glory - arenaInfo(a).glory) / 200));
}
export const coinBonus = arena => Math.min(PROG.arenaBonusMax, 1 + PROG.arenaBonusStep * (arena - 1));
export const deckLevel = s => Math.floor(s.deck.reduce((a, id) => a + (s.levels[id] || 1), 0) / s.deck.length);   // tower level

// ---------- upgrades ----------
const round10 = v => Math.round(v / 10) * 10;
export function upgradeCost(s, id) {
  const lvl = s.levels[id] || 1;
  if (lvl >= MAX_LEVEL) return null;
  const base = round10(PROG.upgrade[lvl - 1] * PROG.rarityMult[CARDS[id].rarity]);
  const best = Math.max(...Object.values(s.levels));
  return lvl + 1 <= best ? round10(base * PROG.catchUp) : base;
}
export function upgrade(s, id) {
  const cost = upgradeCost(s, id);
  if (cost == null || !s.unlocked.includes(id) || s.coins < cost) return false;
  s.coins -= cost; s.levels[id] = (s.levels[id] || 1) + 1; s.counter++;
  return true;
}

// ---------- unlocks ----------
export const picksEarned = s => Math.min(CARD_IDS.length - STARTER_DECK.length, Math.floor(s.keys / PROG.keys.perPick));
export const picksWaiting = s => Math.max(0, picksEarned(s) - s.picks);
export function offerTier(picksMade) {
  let n = picksMade;
  for (const t of OFFER_TIERS) { if (n < t.picks) return t.rarity; n -= t.picks; }
  return null;
}
// The 3 cards of the next offer (from the tier you are in; falls through to the next tier if one runs dry).
export function makeOffer(s, rnd = Math.random) {
  if (s.unlocked.length >= CARD_IDS.length) return null;
  let tierIdx = RARITIES.indexOf(offerTier(s.picks) || 'mythic');
  let pool = [];
  while (!pool.length && tierIdx < RARITIES.length) {
    pool = CARD_IDS.filter(id => CARDS[id].rarity === RARITIES[tierIdx] && !s.unlocked.includes(id));
    tierIdx++;
  }
  if (!pool.length) pool = CARD_IDS.filter(id => !s.unlocked.includes(id));
  const out = [];
  if (!s.unlocked.includes(FIRST_UNLOCK)) { out.push(FIRST_UNLOCK); pool = pool.filter(id => id !== FIRST_UNLOCK); }
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
// The offer you are shown next: the pending one, or a preview of what comes after your next 15 Keys.
export function ensureOffer(s, rnd = Math.random) {
  if (!s.offer || s.offer.some(id => s.unlocked.includes(id))) s.offer = makeOffer(s, rnd);
  return s.offer;
}
export function pickCard(s, id) {
  if (!picksWaiting(s) || !s.offer || !s.offer.includes(id)) return false;
  s.unlocked.push(id); s.levels[id] = 1; s.picks++; s.offer = null; s.counter++;
  return true;
}

// ---------- after a bot match ----------
// r: { result: 'win' | 'loss' | 'draw', banners: n (enemy towers you took), keep: bool, rival: id, eased: bool,
//      plays: [{ card, lane, enemySide: bool }] }
export function applyBotResult(s, r) {
  const arena = currentArena(s);
  const before = { coins: s.coins, glory: s.glory, keys: s.keys, arena };
  let coins = PROG.coins[r.result] + PROG.coins.perWatchtower * Math.min(2, r.watch || 0) + (r.keep ? PROG.coins.keepBonus : 0);
  coins = Math.round(coins * coinBonus(arena));
  let glory = PROG.glory[r.result];
  if (r.result === 'win' && r.eased) glory = 0;                    // beating an eased bot never moves you toward the next arena
  s.coins += coins;
  s.keys += PROG.keys[r.result];
  s.glory = Math.max(gloryFloor(s), s.glory + glory);
  const newArena = arenaOf(s.glory);
  const emotesBefore = ownedEmotes(s);
  if (newArena > s.arenaMax) s.arenaMax = newArena;
  if (s.glory >= CHAMPION_GLORY) s.champion = true;
  const newEmotes = ownedEmotes(s).filter(e => !emotesBefore.includes(e));
  // Losing-streak help.
  if (r.result === 'loss') { s.lossStreak++; if (s.lossStreak >= PROG.easedAfter) s.eased = true; }
  else if (r.result === 'win') { s.lossStreak = 0; s.eased = false; }
  s.stats[r.result === 'win' ? 'wins' : r.result === 'loss' ? 'losses' : 'draws']++;
  // What the rival (and the final boss) remember about you.
  if (r.rival) {
    const rec = s.rivals[r.rival] || (s.rivals[r.rival] = { w: 0, l: 0, d: 0, streak: 0, notes: { lanes: [0, 0], openers: {} } });
    rec[r.result === 'win' ? 'w' : r.result === 'loss' ? 'l' : 'd']++;
    rec.streak = r.result === 'win' ? rec.streak + 1 : 0;
    learn(rec.notes, r.plays || []);
    rec.counterPlan = rec.streak >= 3;
  }
  s.profile.matches++;
  for (const p of r.plays || []) { s.profile.cards[p.card] = (s.profile.cards[p.card] || 0) + 1; if (p.enemySide) s.profile.lanes[p.lane]++; }
  s.profile.favLane = s.profile.lanes[0] === s.profile.lanes[1] ? null : s.profile.lanes[0] > s.profile.lanes[1] ? 0 : 1;
  s.counter++;
  return { coins, glory: s.glory - before.glory, keys: s.keys - before.keys, arenaUp: arenaOf(s.glory) > before.arena ? arenaOf(s.glory) : 0, newEmotes,
    eased: s.eased, picks: picksWaiting(s) };
}
function learn(notes, plays) {
  for (const p of plays) if (p.enemySide && p.lane != null) notes.lanes[p.lane]++;
  if (plays[0]) notes.openers[plays[0].card] = (notes.openers[plays[0].card] || 0) + 1;
  notes.favLane = notes.lanes[0] === notes.lanes[1] ? null : notes.lanes[0] > notes.lanes[1] ? 0 : 1;
  const op = Object.entries(notes.openers).sort((a, b) => b[1] - a[1])[0];
  notes.opener = op ? op[0] : null;
}

// Friend matches: participation Coins plus a won bet; no Glory or Keys.
export function applyFriendResult(s, { won, pot = 0, bet = 0, refunded = false }) {
  s.coins += PROG.coins.friend + (won ? pot : 0) + (refunded ? bet : 0);
  s.stats.friendly++; s.counter++;
}
export const placeBet = (s, amount) => { const a = Math.max(0, Math.min(s.coins, amount | 0)); s.coins -= a; s.counter++; return a; };

// Short habit hints shown once you have played a rival twice.
export const HABITS = {
  pip: 'Plays one card at a time and tells you what is coming.',
  bea: 'Spams cheap swarms at the bridge. Splash and Spark Shower win trades.',
  moss: 'Defends everything, then counter-pushes with Ironbark Treant.',
  kestrel: 'Switches lanes every push. Watch both sides.',
  fizz: 'Holds spells for clumps. Spread your units out.',
  gear: 'Saves up for one huge Clockwork Golem push in double Spark.',
  vex: 'Shows a weak threat to draw your counter, then plays what it would have stopped.',
  rook: 'Answers your push cheaply and hits the other lane at once.',
  archivist: 'Reads your deck and changes plan mid-match. Carries an archived card.',
  assim: 'Learned from every match you played. Plays to counter your habits.',
};
export { ALL_CARDS };
