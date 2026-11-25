// The battle must be deterministic and its snapshots must restore exactly, or online play drifts.
import assert from 'node:assert/strict';
import { Battle, TPS, MT, clampDrop, DEF } from '../shared/sim.js';
import { Bot, RIVALS, buildDeck } from '../shared/bot.js';
import { CARD_IDS } from '../shared/cards.js';

function botMatch(seed, { snapAt = -1 } = {}) {
  const rnd = (() => { let x = seed; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const r0 = RIVALS[6], r1 = RIVALS[4];
  const b = new Battle({ seed, decks: [buildDeck(r0, CARD_IDS, rnd), buildDeck(r1, CARD_IDS, rnd)] });
  const bots = [new Bot({ side: 0, rival: r0, seed: seed + 1 }), new Bot({ side: 1, rival: r1, seed: seed + 2 })];
  const hashes = [];
  while (!b.s.over && b.tick < 6000) {
    for (const bt of bots) bt.think(b);
    if (b.tick === snapAt) {
      // Rollback check: run ahead 40 ticks, go back, run again; the state must come out identical.
      const snap = b.snapshot(); const pend = JSON.stringify(b.s.pending);
      for (let i = 0; i < 40; i++) b.step();
      const ahead = b.hash();
      b.restore(snap); assert.equal(JSON.stringify(b.s.pending), pend);
      for (let i = 0; i < 40; i++) b.step();
      assert.equal(b.hash(), ahead, 'replay after restore matches');
      b.restore(snap);
    }
    b.step(); b.events = [];
    hashes.push(b.hash());
  }
  return { b, hashes };
}

const a = botMatch(11), c = botMatch(11);
assert.deepEqual(a.hashes, c.hashes, 'same seed, same match');
assert.ok(a.b.s.over, 'match ends');
const d = botMatch(11, { snapAt: 900 });
assert.deepEqual(d.hashes, a.hashes, 'a rewind in the middle changes nothing');
assert.notDeepEqual(botMatch(12).hashes.slice(-1), a.hashes.slice(-1), 'another seed differs');

// Rules spot checks.
const deck = ['imps', 'fox', 'hedge', 'slingers', 'moths', 'shower', 'gust', 'turret'];
let b = new Battle({ seed: 1, decks: [deck, deck] });
assert.equal(b.s.players[0].spark, 5 * 168, 'start with 5 Spark');
const keep1 = b.s.units.find(u => u.kind === 'tower' && u.type === 'keep' && u.side === 1);
assert.equal(keep1.awake, false, 'keep starts asleep');
// Drops are pushed back onto your own half.
const [, y0] = clampDrop(b.s, 0, 'fox', 3000, 5000);
assert.ok(y0 >= 17 * MT, 'blue cannot drop a troop on red\'s half');
const [, y1] = clampDrop(b.s, 1, 'fox', 3000, 30000);
assert.ok(y1 < 15 * MT, 'red cannot drop a troop on blue\'s half');
// Spells deal 35% to towers and wake the keep.
for (let i = 0; i < 400; i++) b.step();
const hand = b.s.players[0].hand;
const spell = hand.includes('shower') ? 'shower' : null;
if (spell) {
  b.schedule({ tick: b.tick, side: 0, type: 'play', card: 'shower', x: keep1.x, y: keep1.y });
  for (let i = 0; i < 20; i++) b.step();
  assert.equal(keep1.awake, true, 'a spell on the keep wakes it');
  assert.equal(keep1.maxHp - keep1.hp, Math.trunc(200 * 35 / 100), 'spell does 35% to towers');
}
// Spark caps at 10.
for (let i = 0; i < 600; i++) b.step();
assert.ok(b.s.players[1].spark <= 1680);
// Hive Spire spawns 2 moths at a time.
b = new Battle({ seed: 3, decks: [['hive', 'imps', 'fox', 'hedge', 'slingers', 'moths', 'shower', 'gust'], deck], settings: { startSpark: 10 } });
while (!b.s.players[0].hand.includes('hive')) { const c = b.s.players[0].hand[0]; b.schedule({ tick: b.tick, side: 0, type: 'play', card: c, x: 9000, y: 30000 }); b.step(); for (let i = 0; i < 60; i++) b.step(); }
const before = b.s.units.filter(u => u.card === 'moths' && u.side === 0).length;
b.schedule({ tick: b.tick, side: 0, type: 'play', card: 'hive', x: 9000, y: 22000 });
for (let i = 0; i < 40; i++) b.step();
assert.equal(b.s.units.filter(u => u.card === 'moths' && u.side === 0).length - before, 2, 'hive spawns 2 moths');
console.log('sim tests passed');
