import assert from 'node:assert/strict';
import * as PR from '../shared/progress.js';
import { CARD_IDS } from '../shared/cards.js';

let s = PR.newSave('T');
assert.equal(s.deck.length, 8); assert.equal(s.unlocked.length, 8);
// Upgrade costs from the doc: 4,650 for a Common from 1 to 9; Rares about 5,120.
const total = r => { const t = PR.newSave(); t.coins = 1e9; t.unlocked.push('brute'); t.levels.brute = 1; let id = r === 'common' ? 'imps' : 'brute', sum = 0; while (t.levels[id] < 9) { const c = PR.upgradeCost({ ...t, levels: { [id]: t.levels[id] } }, id); sum += c; t.levels[id]++; } return sum; };
assert.equal(total('common'), 4650);
assert.ok(Math.abs(total('rare') - 5120) <= 30, 'rare total ' + total('rare'));
// Catch-up discount: half price up to your best card's level.
s.coins = 10000; s.levels.imps = 5;
assert.equal(PR.upgradeCost(s, 'fox'), 30);   // 50 halved is 25, rounded to the nearest 10
// Rewards: a win in Arena 1 pays 100 + 10 per Watchtower; 30 Glory; 3 Keys.
s = PR.newSave();
let out = PR.applyBotResult(s, { result: 'win', watch: 1, keep: false, rival: 'pip', plays: [{ card: 'fox', lane: 0, enemySide: true }] });
assert.deepEqual([out.coins, s.glory, s.keys], [110, 30, 3]);
// Losses cost Glory but never drop below the arena floor; 3 in a row eases the bot; a win against it gives no Glory.
s.glory = 210; s.arenaMax = 2;
for (let i = 0; i < 3; i++) PR.applyBotResult(s, { result: 'loss', rival: 'bea' });
assert.equal(s.glory, 200, 'floor at Arena 2'); assert.equal(s.eased, true);
assert.equal(PR.botLevel(s), 1, 'eased bot one level lower');
out = PR.applyBotResult(s, { result: 'win', rival: 'bea', eased: true, watch: 0 });
assert.equal(out.glory, 0); assert.equal(s.eased, false);
// Arena bonus ×1.25 in Arena 2.
assert.equal(out.coins, 125);
// Unlocks: 15 Keys per pick, 3 cards offered from the right tier with Gust first, all 27 by 285 Keys.
s = PR.newSave(); s.keys = 15;
assert.equal(PR.picksWaiting(s), 1);
const offer = PR.ensureOffer(s, Math.random);
assert.equal(offer.length, 3); assert.equal(offer[0], 'gust'); assert.ok(offer.slice(1).every(id => ['brute', 'roller', 'harpoon', 'ember', 'treant', 'flamejar', 'loft', 'hive', 'lancer', 'kite'].includes(id)));
s.keys = 285;
while (PR.picksWaiting(s)) { const o = PR.ensureOffer(s, Math.random); assert.ok(PR.pickCard(s, o[0])); }
assert.equal(s.unlocked.length, CARD_IDS.length, 'everything unlocked at 285 Keys');
// Arena 10 bot levels.
s.glory = 1800; assert.equal(PR.botLevel(s), 7); s.glory = 2100; assert.equal(PR.botLevel(s), 8); s.glory = 2500; assert.equal(PR.botLevel(s), 9);
// Old or broken saves are repaired.
assert.equal(PR.fixSave({ deck: ['nope'], levels: { imps: 99 } }).levels.imps, 9);
console.log('progress tests passed');
