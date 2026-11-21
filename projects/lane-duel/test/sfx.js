// Sound checks without a sound card: public/sfx.js is loaded against a stand-in AudioContext that records and
// validates everything scheduled on it, and the sim is checked for the events the sounds are driven by.
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { Game, TICK } from '../game/sim.js';
import { HEROES } from '../game/data.js';

// ---------- a stand-in AudioContext ----------
function fakeContext() {
  const log = { started: 0, peak: 0, end: 0, targets: [] };
  const ok = (...xs) => { for (const x of xs) assert(Number.isFinite(x), 'a scheduled value or time is not a number: ' + x); };
  class Param {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v, t) { ok(v, t); assert(t >= 0); return this; }
    linearRampToValueAtTime(v, t) { ok(v, t); log.peak = Math.max(log.peak, Math.abs(v) <= 1 ? Math.abs(v) : 0); return this; }
    exponentialRampToValueAtTime(v, t) { ok(v, t); assert(v > 0, 'an exponential ramp cannot reach ' + v); return this; }
    setTargetAtTime(v, t, c) { ok(v, t, c); this.value = v; log.targets.push(v); return this; }
    cancelScheduledValues() { return this; }
  }
  const node = () => {
    const n = { connect(d) { assert(d, 'connected to nothing'); return d; }, disconnect() {}, type: '', loop: false, buffer: null,
      start(t) { ok(t); assert(!n.started, 'a source was started twice'); n.started = true; log.started++; },
      stop(t) { ok(t); log.end = Math.max(log.end, t); } };
    for (const k of ['gain', 'frequency', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release', 'detune']) n[k] = new Param();
    return n;
  };
  const ctx = { currentTime: 0, sampleRate: 8000, state: 'running', destination: node(), log, resume() {} };
  for (const k of ['Gain', 'Oscillator', 'BufferSource', 'BiquadFilter', 'Convolver', 'DynamicsCompressor', 'StereoPanner']) ctx['create' + k] = node;
  ctx.createBuffer = (ch, len) => ({ getChannelData: () => new Float32Array(len) });
  return ctx;
}
function loadSfx() {
  const box = { window: {}, Math, console };
  vm.runInNewContext(fs.readFileSync(new URL('../public/sfx.js', import.meta.url), 'utf8') + '\nthis.SFX = SFX;', box);
  return box.SFX;
}

// ---------- 1. every sound that was asked for has a recipe ----------
const WANTED = {
  shared: ['coin', 'coinLow', 'minionHit', 'casterShot', 'cannonShot', 'minionDeath', 'towerShot', 'towerShotMe', 'towerWarn', 'plate', 'towerFall', 'levelUp',
    'deny', 'buy', 'sell', 'undo', 'recall', 'recallDone', 'potion', 'heroDeath', 'respawn', 'kill', 'died', 'blink', 'mend', 'crit'],
  gorrum: ['attack', 'attackHit', 'qCast', 'qHit', 'qMiss', 'wCast', 'wEnd', 'eCast', 'eHit', 'mark', 'rCast', 'passive', 'death'],
  wren: ['attack', 'attackHit', 'qCast', 'qHit', 'wCast', 'wHit', 'pop', 'eCast', 'eHit', 'rCast', 'rRelease', 'rHit', 'passive', 'death'],
  sable: ['attack', 'attackHit', 'qCast', 'bounce', 'bladeLand', 'wCast', 'eCast', 'eHit', 'pickup', 'passive', 'rCast', 'rBlade', 'rEnd', 'death'],
  kessa: ['attack', 'attackHit', 'qCharge', 'qCast', 'qLand', 'qCancel', 'wCast', 'wTele', 'wLand', 'wCentre', 'eCast', 'eHit', 'stun', 'rStart', 'rShot', 'rTele', 'rLand', 'rEnd', 'passive', 'death'],
  oriel: ['attack', 'attackHit', 'qCast', 'qHit', 'wCast', 'wTele', 'wLand', 'eCast', 'eHit', 'rCast', 'rTele', 'rLand', 'death'],
};
const LONG = new Set(['shared.recall', 'kessa.qCharge', 'kessa.rStart', 'sable.rCast']);   // these last as long as what they follow, and are stopped by it
{
  const S = loadSfx();
  for (const [who, names] of Object.entries(WANTED)) for (const n of names) assert.equal(typeof S.find(`${who}.${n}`), 'function', `missing recipe ${who}.${n}`);
  assert.deepEqual(Object.keys(S.heroes).sort(), Object.keys(HEROES).sort(), 'every hero has sounds, under its id');
  console.log('recipes ok');

  // ---------- 2. nothing plays before the first click or key press ----------
  assert.equal(S.play('shared.coin'), null, 'no sound before audio is unlocked'); assert.equal(S.ready, false);

  // ---------- 3. every recipe builds cleanly ----------
  let count = 0;
  for (const who of ['shared', ...Object.keys(S.heroes)]) for (const n of Object.keys(who === 'shared' ? S.shared : S.heroes[who])) {
    for (const extra of [{}, { n: 1 }, { n: 5, d: 0.6 }]) {
      const ctx = fakeContext(); S.init(ctx); ctx.currentTime = 3;
      const v = S.play(`${who}.${n}`, extra);
      assert(v, `${who}.${n} did not play`); assert(ctx.log.started > 0, `${who}.${n} makes no sound`);
      const len = ctx.log.end - 3;
      assert(len > 0.02 && len <= (LONG.has(`${who}.${n}`) ? 12 : 2.3), `${who}.${n} lasts ${len.toFixed(2)}s`);
      assert(ctx.log.peak <= 0.62, `${who}.${n} is too loud at ${ctx.log.peak}`);
      count++;
    }
  }
  console.log(`built ${count} sounds ok`);

  // ---------- 4. the limits ----------
  const ctx = fakeContext(); S.init(ctx);
  let played = 0; for (let i = 0; i < 50; i++) if (S.play('shared.minionHit')) played++;
  assert(played >= 1 && played <= 4, '50 minion hits in one tick play at most 4: ' + played);
  played = 0; for (let i = 0; i < 50; i++) { ctx.currentTime += 0.002; if (S.play('shared.minionHit')) played++; }   // 50 hits spread over 100ms
  assert(played <= 4, 'and at most 4 in any 100ms: ' + played);
  ctx.currentTime = 10; assert(S.play('shared.coin')); assert.equal(S.play('shared.coin'), null, 'a copy within 40ms is skipped');
  ctx.currentTime = 10.05; assert(S.play('shared.coin'), 'but not after it');
  const ctx2 = fakeContext(); S.init(ctx2); const all = Object.entries(WANTED).flatMap(([w, ns]) => ns.map(n => `${w}.${n}`));
  played = 0; for (const n of all) if (S.play(n)) played++;
  assert.equal(played, S.LIMITS.voices, 'never more than 24 sounds at once'); assert.equal(S.playing, 24);
  ctx2.currentTime = 30; assert.equal(S.playing, 0, 'finished sounds free their place'); assert(S.play('shared.coin'));
  console.log('limits ok');

  // ---------- 5. position ----------
  assert.deepEqual({ ...S.place(0, false) }, { pan: 0, vol: 1 });
  const edge = S.place(0.5, false), far = S.place(-1.4, false);
  assert(edge.pan > 0.8 && edge.vol < 1 && edge.vol > 0.6, 'the screen edge is hard right and a little quieter');
  assert(far.pan < -0.8 && far.vol < 0.3, 'far left is quiet'); assert.equal(S.place(1.6, false), null, 'more than 1.5 screens away is not played');
  assert(S.place(1.4, true).vol >= 0.7 && S.place(3, true).vol >= 0.7, 'your own hero is never quieter than 70%');
  // variation: repeated effects differ a little, interface sounds do not
  const ctx3 = fakeContext(); S.init(ctx3); S.random = () => 1;
  ctx3.currentTime = 1; const a = S.play('gorrum.attack'); ctx3.currentTime = 2; S.random = () => 0; const b = S.play('gorrum.attack');
  assert(Math.abs(a.rate - 1.04) < 1e-9 && Math.abs(b.rate - 0.96) < 1e-9, 'pitch varies by up to 4%');
  ctx3.currentTime = 3; assert.equal(S.play('shared.coin').rate, 1); S.random = Math.random;
  console.log('position ok');

  // ---------- 6. volume and mute apply at once ----------
  const ctx4 = fakeContext(); S.init(ctx4); ctx4.log.targets.length = 0;
  S.setVolume({ master: 0.35, fx: 0.5, ui: 1 }); assert.deepEqual(ctx4.log.targets, [0.35, 0.5, 1]);
  ctx4.log.targets.length = 0; S.setVolume({ muteMaster: true }); assert.equal(ctx4.log.targets[0], 0, 'mute silences the master');
  ctx4.log.targets.length = 0; S.setVolume({ muteMaster: false, focused: false }); assert.equal(ctx4.log.targets[0], 0, 'an unfocused window is muted by default');
  ctx4.log.targets.length = 0; S.setVolume({ muteUnfocused: false }); assert.equal(ctx4.log.targets[0], 0.35, 'unless that is switched off');
  ctx4.log.targets.length = 0; S.setVolume({ focused: true, muteFx: true }); assert.deepEqual(ctx4.log.targets, [0.35, 0, 1]);
  // a stopped sound ends early
  S.setVolume({ muteFx: false }); ctx4.currentTime = 5; const hum = S.play('shared.recall', { d: 8, tag: 'rc:1' }); assert(hum.end > 12);
  ctx4.currentTime = 6; S.stopTag('rc:1', 0.03); assert(hum.end < 6.2, 'an interrupted recall cuts off');
  console.log('volume ok');
}

// ---------- 7. the sim says what happened, with just what the client needs ----------
{
  const mk = (a, b) => new Game([{ id: 1, name: 'A', hero: a, team: 'blue' }, { id: 2, name: 'B', hero: b, team: 'red', bot: true }]);
  const run = (g, s) => { const out = []; for (let i = 0; i < s * TICK; i++) { g.step(); out.push(...g.events); g.events = []; } return out; };
  const sounds = ev => ev.filter(e => e.e === 'sfx').map(e => (e.s != null ? 'qwer'[e.s] : '') + e.k);
  const setup = hero => { const g = mk(hero, 'oriel'), h = g.heroes.get(1), e = g.heroes.get(2); h.x = 3000; h.y = 800; e.x = 3500; e.y = 800; e.hp = e.mhp = 9000; h.ranks = [1, 1, 1, 1]; h.lvl = 6; g.events = []; return { g, h, e }; };

  // Xerhta: charge -> release -> the beam lands; a cancelled charge says so
  let { g, h, e } = setup('kessa');
  g.command(1, { c: 'charge', s: 0 }); let ev = run(g, 0.5); assert(sounds(ev).includes('qcharge'), 'the charge starting is an event');
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); ev = [...g.events, ...run(g, 0.7)];
  assert(ev.some(x => x.e === 'cast' && x.s === 0 && x.h === 'kessa' && x.x === 3000), 'a cast says which hero and where');
  assert(['qtele', 'qland'].every(k => sounds(ev).includes(k)), 'the beam is announced and lands: ' + sounds(ev));
  ({ g, h, e } = setup('kessa')); g.command(1, { c: 'charge', s: 0 }); run(g, 0.3); g.leave(h, 'cancel');
  assert(sounds(g.events).includes('qcancel'), 'a cancelled charge is an event');
  // Ground Zero: the centre is flagged; Concussion Shell: the stun says how long
  ({ g, h, e } = setup('kessa')); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); ev = run(g, 1);
  assert(ev.some(x => x.e === 'sfx' && x.k === 'land' && x.s === 1 && x.c === 1 && x.v === 1), 'a centre hit is flagged on the landing');
  g.command(1, { c: 'cast', s: 2, x: e.x, y: e.y }); ev = run(g, 1);
  const stun = ev.find(x => x.e === 'sfx' && x.k === 'stun'); assert(stun && stun.n >= 0.75 && stun.n <= 2.25 && sounds(ev).includes('ehit'));
  // Fire Mission: start (heard through fog), each shot numbered, an end
  g.command(1, { c: 'cast', s: 3 }); run(g, 0.6); g.command(1, { c: 'cast', s: 3, x: e.x, y: e.y }); ev = [...g.events, ...run(g, 0.2)]; g.command(1, { c: 'stop' });
  assert(ev.some(x => x.k === 'rShot' && x.n === 1 && x.u === 1) && sounds(ev).includes('rtele'), 'each barrage shot is an event');
  assert(sounds(g.events).includes('rend'), 'and so is the barrage ending');
  // Bliknarczt: a harpoon that misses, and one that hits
  ({ g, h, e } = setup('gorrum')); g.command(1, { c: 'cast', s: 0, x: 3000, y: 100 }); assert(sounds(run(g, 1.2)).includes('qmiss'));
  ({ g, h, e } = setup('gorrum')); g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); assert(sounds(run(g, 1.2)).includes('qhit'));
  // Katanira: bounces count up, the blade landing and the pickup are events
  ({ g, h, e } = setup('sable')); e.x = 3300; g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); ev = run(g, 2.5);
  assert(ev.some(x => x.k === 'bounce' && x.n === 1) && sounds(ev).includes('bladeLand'), 'bounce and blade landing: ' + sounds(ev));
  // Ezrlae: passive stacks are counted, the mark popping is an event
  ({ g, h, e } = setup('wren')); g.command(1, { c: 'cast', s: 1, x: e.x, y: e.y }); ev = run(g, 1); assert(sounds(ev).includes('whit') && ev.some(x => x.k === 'passive' && x.n === 1));
  g.command(1, { c: 'cast', s: 0, x: e.x, y: e.y }); ev = run(g, 1); assert(sounds(ev).includes('pop') && ev.some(x => x.k === 'passive' && x.n === 2));
  // shop sounds go to the buyer alone; a refused purchase says so
  ({ g, h, e } = setup('kessa')); h.x = 420; h.gold = 400; g.command(1, { c: 'buy', item: 'blade' }); g.command(1, { c: 'buy', item: 'greatblade' });
  assert.deepEqual(g.events.filter(x => x.e === 'sfx').map(x => [x.k, x.p]), [['buy', 1], ['deny', 1]]);
  assert(g.snapshot(2).ev.every(x => x.e !== 'sfx'), 'the other player does not hear your shop');
  // attacks are marked, so a hit sound can tell them from ability damage
  ({ g, h, e } = setup('gorrum')); e.x = 3120; g.command(1, { c: 'atk', id: e.id }); ev = run(g, 1.5); assert(ev.some(x => x.e === 'dmg' && x.a === 1 && x.s === h.id));
  console.log('sim events ok');
}

// ---------- 8. hero search: the start of the name, whatever the capitals ----------
{
  const match = typed => Object.entries(HEROES).filter(([, h]) => h.name.toLowerCase().startsWith(typed.trim().toLowerCase())).map(([k]) => k);
  assert.deepEqual(match('xer'), ['kessa']); assert.deepEqual(match('BLI'), ['gorrum']); assert.deepEqual(match('ezr'), ['wren']); assert.deepEqual(match('kat'), ['sable']);
  assert.deepEqual(match('or'), ['oriel']); assert.equal(match('').length, 5); assert.equal(match('rhta').length, 0, 'only from the start of the name');
  assert.deepEqual(Object.values(HEROES).map(h => h.name).sort(), ['Bliknarczt', 'Ezrlae', 'Katanira', 'Oriel', 'Xerhta']);
  console.log('names ok');
}
console.log('all sound checks passed');
