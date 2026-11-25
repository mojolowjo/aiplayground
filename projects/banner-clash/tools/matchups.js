// Matchup tester: every troop and building card fights every other one, 1v1, at the same level, in the real
// battle code with the towers switched off. Prints a summary and writes an HTML table to read.
//
//   npm run matchups                    level 1, writes matchups.html next to this file
//   npm run matchups -- --level 9       another level for both sides
//   npm run matchups -- --only hedge    just one card's row
//   npm run matchups -- --out file.html write the table somewhere else
//
// Each pair is fought twice, once from each side of the arena, and the two results are averaged.
// Setup (a guess at a fair duel, easy to change below): both cards are dropped in the left lane, 10 tiles apart,
// one on each side of the river. Towers stay on the board, because troops walk toward them, but they do not
// shoot and cannot fall. A fight ends when one card and everything it made (Cogs, moths) is gone, or after
// LIMIT seconds. Buildings fade over their lifetime like in a match; building vs building is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Battle, TPS, MT, LANES_X } from '../shared/sim.js';
import { CARDS, DEPLOY } from '../shared/cards.js';

const LIMIT = 60;                                  // seconds before a fight counts as a draw
const DROP_Y = [21, 11];                           // tiles: side 0 (bottom) and side 1 (top); the river is rows 15-17

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const LEVEL = Math.max(1, Math.min(9, +arg('level', 1) | 0));
const ONLY = arg('only', null);
const OUT = arg('out', path.join(path.dirname(fileURLToPath(import.meta.url)), 'matchups.html'));

const ids = Object.keys(CARDS).filter(id => CARDS[id].type !== 'spell');
const isBuilding = id => CARDS[id].type === 'building';
// Cards like the Golem only attack buildings, so against a troop the fight is one-sided: what matters is how long
// the troop needs to bring it down (the longer, the more it would hit a tower in a real match).
const ignores = (a, b) => CARDS[a].targets === 'buildings' && CARDS[b].type === 'troop';

// One fight. Returns { winner: 0|1|null, left: [hp% left side 0, side 1], secs }.
function fight(a, b) {
  const battle = new Battle({ seed: 1, decks: [[a], [b]], levels: [{ [a]: LEVEL }, { [b]: LEVEL }] });
  const s = battle.s;
  for (const u of s.units) if (u.kind === 'tower') { u.awake = false; u.dmg = 0; u.hp = u.maxHp = 1e9; }
  const start = [0, 0];
  [a, b].forEach((card, side) => {
    const made = battle.spawn(side, card, LEVEL, LANES_X[0], DROP_Y[side] * MT, Math.round(DEPLOY * TPS));
    start[side] = made.reduce((n, u) => n + u.maxHp + u.shield, 0);
  });
  const alive = side => s.units.filter(u => u.side === side && u.kind !== 'tower' && u.hp > 0);
  const hpLeft = side => alive(side).reduce((n, u) => n + Math.max(0, u.hp) + Math.max(0, u.shield), 0);
  let t = 0;
  for (; t < LIMIT * TPS; t++) {
    battle.step(); battle.events = [];
    if (!alive(0).length || !alive(1).length) break;
  }
  const n0 = alive(0).length, n1 = alive(1).length;
  const winner = n0 && !n1 ? 0 : n1 && !n0 ? 1 : null;
  return { winner, left: [hpLeft(0) / start[0], hpLeft(1) / start[1]], secs: (t + 1) / TPS };
}

// Card a against card b, from both ends of the arena. score: +1 a won both, -1 b won both, 0 even.
// margin: how much of the winner's health was left, averaged over the two fights (a's view, -1..1).
function matchup(a, b) {
  const r1 = fight(a, b), r2 = fight(b, a);
  const pts = (r1.winner === 0 ? 1 : r1.winner === 1 ? -1 : 0) + (r2.winner === 1 ? 1 : r2.winner === 0 ? -1 : 0);
  const margin = ((r1.left[0] - r1.left[1]) + (r2.left[1] - r2.left[0])) / 2;
  return { score: pts / 2, margin, secs: (r1.secs + r2.secs) / 2, oneSided: ignores(a, b) ? 'row' : ignores(b, a) ? 'col' : null };
}

const rows = ONLY ? [ONLY] : ids;
if (ONLY && !CARDS[ONLY]) { console.error(`No card "${ONLY}". Cards: ${ids.join(', ')}`); process.exit(1); }
const res = {};
for (const a of rows) {
  res[a] = {};
  for (const b of ids) {
    if (a === b) continue;
    if ((isBuilding(a) && isBuilding(b)) || (ignores(a, b) && ignores(b, a))) { res[a][b] = null; continue; }
    res[a][b] = res[b]?.[a] ? flip(res[b][a]) : matchup(a, b);
  }
}
function flip(m) { return m && { score: -m.score, margin: -m.margin, secs: m.secs, oneSided: m.oneSided === 'row' ? 'col' : m.oneSided === 'col' ? 'row' : null }; }

// ---------- summary ----------
const name = id => CARDS[id].name;
const pct = v => `${Math.round(v * 100)}%`;
console.log(`Matchups at level ${LEVEL}, ${LIMIT}s limit. Wins / draws / losses against the cards it really fights`);
console.log(`(one-sided fights against building-only attackers are left out of these counts; see the table).\n`);
const summary = rows.map(a => {
  const list = Object.values(res[a]).filter(m => m && !m.oneSided);
  const w = list.filter(m => m.score > 0).length, l = list.filter(m => m.score < 0).length;
  return { a, w, d: list.length - w - l, l, avg: list.length ? list.reduce((n, m) => n + m.margin, 0) / list.length : 0 };
}).sort((x, y) => y.w - x.w || y.avg - x.avg);
for (const r of summary) console.log(`${name(r.a).padEnd(18)} cost ${CARDS[r.a].cost ?? '-'}   ${String(r.w).padStart(2)} W ${String(r.d).padStart(2)} D ${String(r.l).padStart(2)} L   average margin ${pct(r.avg)}`);

// ---------- HTML table ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cell = m => {
  if (m === undefined) return '<td class="self"></td>';
  if (m === null) return '<td class="skip">–</td>';
  if (m.oneSided) {   // the row card only attacks buildings (row), or the column card does (col)
    const survived = m.oneSided === 'row' ? m.score >= 0 : m.score <= 0;
    const text = survived ? 'lives' : `${m.secs.toFixed(0)}s`;
    const tip = m.oneSided === 'row' ? (survived ? 'The column card could not bring it down in time' : `The column card needed about ${m.secs.toFixed(1)} s to bring it down`)
      : (survived ? 'The row card could not bring it down in time' : `The row card needed about ${m.secs.toFixed(1)} s to bring it down`);
    return `<td class="one ${m.oneSided}" title="${tip}">${text}</td>`;
  }
  const v = m.score > 0 ? Math.max(0.15, m.margin) : m.score < 0 ? Math.min(-0.15, m.margin) : m.margin / 3;
  const hue = v >= 0 ? 140 : 0, light = 96 - Math.min(1, Math.abs(v)) * 46;
  const label = m.score === 1 ? 'W' : m.score === -1 ? 'L' : m.score === 0 && Math.abs(m.margin) < 0.05 ? 'D' : 'split';
  return `<td style="background:hsl(${hue} 60% ${light}%)" title="${label}, margin ${pct(m.margin)}, about ${m.secs.toFixed(1)} s">${label === 'split' ? '½' : label}<small>${pct(Math.abs(m.margin))}</small></td>`;
};
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Banner Clash matchups</title>
<style>
body { font: 13px system-ui, sans-serif; margin: 16px; background: #fff; color: #222 }
table { border-collapse: collapse } td, th { border: 1px solid #ddd; padding: 2px 4px; text-align: center; min-width: 34px }
th.col { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; font-weight: 500 }
th.row { text-align: right; white-space: nowrap; font-weight: 500 } td small { display: block; font-size: 10px; opacity: .7 }
td.self { background: #eee } td.skip { color: #aaa } td.one { background: #e8eefc; color: #345; font-size: 11px } .wrap { overflow-x: auto }
</style>
<h1>Banner Clash matchups</h1>
<p>Level ${LEVEL} for both cards, ${LIMIT} s limit, each pair fought from both sides of the arena. Read across a row: <b>W</b> the row card beat
the column card both times, <b>L</b> it lost both times, <b>½</b> one each, <b>D</b> neither finished. The small number is how much health the winner
had left on average. Hover a cell for the fight length. Cost does not count here: a 7-cost card beating a 2-cost card is expected.</p>
<p>Blue cells are one-sided: one of the two cards only attacks buildings, so it walks past the other. The number is how many seconds the other card
took to bring it down (more seconds means more time hitting a tower in a real match), or <b>lives</b> if it never did.</p>
<div class="wrap"><table>
<tr><th></th>${ids.map(b => `<th class="col">${esc(name(b))} (${CARDS[b].cost})</th>`).join('')}</tr>
${rows.map(a => `<tr><th class="row">${esc(name(a))} (${CARDS[a].cost})</th>${ids.map(b => cell(a === b ? undefined : res[a][b])).join('')}</tr>`).join('\n')}
</table></div>`;
fs.writeFileSync(OUT, html);
console.log(`\nTable written to ${OUT}`);
