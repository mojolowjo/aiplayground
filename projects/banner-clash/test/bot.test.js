// Bots must actually play, finish matches, and higher tiers should beat lower ones more often than not.
import assert from 'node:assert/strict';
import { Battle } from '../shared/sim.js';
import { Bot, RIVALS, TIERS, buildDeck, assimilationDeck } from '../shared/bot.js';
import { CARD_IDS, ALL_CARDS } from '../shared/cards.js';

function match(r0, r1, seed) {
  let x = seed; const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const b = new Battle({ seed, decks: [buildDeck(r0, CARD_IDS, rnd), buildDeck(r1, CARD_IDS, rnd)] });
  const bots = [new Bot({ side: 0, rival: r0, seed: seed + 1 }), new Bot({ side: 1, rival: r1, seed: seed + 2 })];
  const plays = [0, 0];
  while (!b.s.over && b.tick < 7000) { for (const bt of bots) if (bt.think(b)) plays[bt.side]++; b.step(); for (const bt of bots) bt.onEvents(b, b.events); b.events = []; }
  return { winner: b.s.winner, plays, over: b.s.over };
}
// Every rival plays a full match against every other tier's headline without getting stuck.
for (const r of RIVALS.filter(r => !r.boss)) {
  const m = match(r, RIVALS[2], 40 + r.arena);
  assert.ok(m.over, `${r.name} finishes`);
  assert.ok(m.plays[0] >= 8, `${r.name} plays cards (${m.plays[0]})`);
}
// Decks: 8 distinct real cards, with the rival's core inside.
for (const r of RIVALS.filter(r => !r.boss)) {
  const d = buildDeck(r, CARD_IDS, Math.random);
  assert.equal(new Set(d).size, 8); assert.ok(d.every(id => ALL_CARDS[id]));
  for (const c of r.core) assert.ok(d.includes(c), `${r.name} keeps ${c}`);
}
assert.equal(new Set(assimilationDeck({ cards: { imps: 30, moths: 20, golem: 5 } }, Math.random)).size, 8);
// Tier ladder, same plain style and decks drawn from all cards.
const plain = { aggression: 0.5, patience: 0.5, lane: 'weak', greed: 2, defence: 'tower', risk: 0.3 };
const tiers = Object.keys(TIERS);
const mk = t => ({ id: t, name: t, tier: t, core: [], plans: [], style: plain });
let total = 0;
for (let i = 1; i < tiers.length; i++) {
  let w = 0; const n = 30;
  for (let s = 0; s < n; s++) { const hiSide = s % 2; const m = hiSide ? match(mk(tiers[i - 1]), mk(tiers[i]), 500 + s) : match(mk(tiers[i]), mk(tiers[i - 1]), 500 + s); if (m.winner === hiSide) w++; }
  console.log(`  ${tiers[i]} beats ${tiers[i - 1]} ${Math.round(w / n * 100)}%`);
  total += w / n;
}
assert.ok(total / (tiers.length - 1) > 0.5, 'on average the higher tier wins');
console.log('bot tests passed');
