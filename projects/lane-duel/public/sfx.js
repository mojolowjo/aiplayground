'use strict';
// Every sound in the game, made in code with the Web Audio API: no audio files, nothing downloaded.
//
//   1. A small engine: one AudioContext, a master volume with an effects bus and an interface bus under it,
//      a shared reverb, and a few building blocks (tone, noise, sweep, chime, boom).
//   2. A table of recipes. SFX.shared.<name> is the same for everyone; SFX.heroes.<heroId>.<name> belongs to
//      one character. A recipe is a function that is handed a voice `v` and calls the building blocks on it.
//
// Nothing here knows about the game. client.js decides when a sound plays and where on screen it is.
const SFX = (() => {
  // ---------- numbers ----------
  const LIMITS = {
    voices: 24,            // sounds playing at once
    sameGap: 0.04,         // seconds: a second copy of the same sound sooner than this is skipped
    minionMax: 4, minionWindow: 0.1,   // at most this many of one minion sound per window (seconds)
    hearScreens: 1.5,      // sounds further than this many screen widths from the camera centre are not played
    farVol: 0.15,          // volume at that distance (1 at the centre)
    ownFloor: 0.7,         // your own hero's sounds are never quieter than this
    panMax: 0.85,          // how far left or right a sound at the screen edge sits
    pitchJitter: 0.04, volJitter: 0.1,   // random variation on repeated sounds
  };
  const MIX = { reverbSeconds: 1.3, reverbDecay: 3, softTop: 8500, attack: 0.005, lead: 0.012, fade: 0.04, ramp: 0.03 };
  const DEFAULT_VOLUME = { master: 0.7, fx: 1, ui: 0.8 };
  // Interface sounds (gold, shop, level up, warnings). Everything else is an effect.
  const UI = new Set(['coin', 'coinLow', 'levelUp', 'deny', 'buy', 'sell', 'undo', 'towerWarn', 'kill', 'died', 'respawn']);
  const MINION = new Set(['minionHit', 'casterShot', 'cannonShot', 'minionDeath']);

  // Level trims, measured by rendering each recipe: filtered noise and very short sounds come out quieter than
  // their numbers suggest, so these bring each one up to the level of the rest. (Volume multipliers.)
  const TRIM = {
    'gorrum.attack': 1.9, 'gorrum.eCast': 4.2, 'gorrum.mark': 1.9, 'gorrum.qCast': 1.6, 'gorrum.qHit': 1.9, 'gorrum.qMiss': 2.8, 'gorrum.wCast': 1.5,
    'gorrum.wEnd': 2.1, 'kessa.attack': 3.6, 'kessa.attackHit': 6.0, 'kessa.death': 3.0, 'kessa.eCast': 1.6, 'kessa.eHit': 2.5, 'kessa.passive': 1.2,
    'kessa.qCancel': 5.9, 'kessa.qCast': 1.2, 'kessa.qCharge': 1.4, 'kessa.qLand': 1.8, 'kessa.rEnd': 6.7, 'kessa.rShot': 2.2, 'kessa.rStart': 1.6,
    'kessa.rTele': 2.1, 'kessa.stun': 2.3, 'kessa.wCast': 2.7, 'kessa.wLand': 1.2, 'kessa.wTele': 2.3, 'oriel.attack': 6.3, 'oriel.attackHit': 6.0,
    'oriel.death': 2.4, 'oriel.eCast': 2.9, 'oriel.eHit': 2.2, 'oriel.qCast': 5.6, 'oriel.qHit': 2.4, 'oriel.rCast': 1.6, 'oriel.wCast': 4.4,
    'oriel.wLand': 1.5, 'oriel.wTele': 3.8, 'sable.attack': 4.4, 'sable.attackHit': 3.1, 'sable.bladeLand': 2.1, 'sable.bounce': 3.3, 'sable.death': 1.4,
    'sable.eCast': 3.9, 'sable.eHit': 3.8, 'sable.passive': 3.8, 'sable.pickup': 3.7, 'sable.qCast': 8, 'sable.rBlade': 5.2, 'sable.rCast': 2.6,
    'sable.rEnd': 2.6, 'sable.wCast': 4.2, 'shared.blink': 2.8, 'shared.cannonShot': 1.8, 'shared.casterShot': 3.3, 'shared.coin': 1.4,
    'shared.coinLow': 1.3, 'shared.crit': 2.5, 'shared.deny': 2.3, 'shared.minionDeath': 7.8, 'shared.minionHit': 2.4, 'shared.plate': 1.5,
    'shared.potion': 1.4, 'shared.recall': 1.4, 'shared.recallDone': 1.2, 'shared.sell': 1.2, 'shared.towerShot': 1.8, 'shared.undo': 2.5,
    'wren.attack': 2.9, 'wren.attackHit': 4.1, 'wren.death': 2.0, 'wren.eCast': 1.7, 'wren.eHit': 2.9, 'wren.passive': 3.6, 'wren.pop': 1.8,
    'wren.qCast': 2.6, 'wren.qHit': 2.3, 'wren.rHit': 5.0, 'wren.wCast': 4.5, 'wren.wHit': 3.1,
  };
  let ac = null, bus = null, noiseBuf = null, random = Math.random;
  const live = new Set(), lastAt = new Map(), minionAt = new Map();
  const vol = { ...DEFAULT_VOLUME, muteMaster: false, muteFx: false, muteUi: false, muteUnfocused: true, focused: true };

  // ---------- engine ----------
  function init(ctx) {
    ac = ctx; live.clear(); lastAt.clear(); minionAt.clear();
    const len = Math.floor(ac.sampleRate * 2), nb = ac.createBuffer(1, len, ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;
    noiseBuf = nb;
    // The reverb's impulse: noise that dies away.
    const rl = Math.floor(ac.sampleRate * MIX.reverbSeconds), ir = ac.createBuffer(2, rl, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < rl; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, MIX.reverbDecay); }
    const master = ac.createGain(), limit = ac.createDynamicsCompressor();
    limit.threshold.value = -10; limit.knee.value = 12; limit.ratio.value = 12; limit.attack.value = 0.003; limit.release.value = 0.2;   // a limiter, so a pile-up never clips
    master.connect(limit); limit.connect(ac.destination);
    const makeBus = () => {
      const input = ac.createGain(), wet = ac.createConvolver(), soft = ac.createBiquadFilter(), out = ac.createGain();
      wet.buffer = ir; soft.type = 'lowpass'; soft.frequency.value = MIX.softTop;      // keeps the top end gentle
      input.connect(soft); wet.connect(soft); soft.connect(out); out.connect(master);
      return { input, wet, out };
    };
    bus = { master, fx: makeBus(), ui: makeBus() };
    applyVolume(true);
  }
  // Browsers only allow sound after a click or key press, so the context is made (or woken) on the first one.
  function unlock() {
    try {
      if (!ac) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; init(new AC()); }
      if (ac.state === 'suspended') ac.resume();
    } catch { /* no audio on this device: the game is simply silent */ }
  }
  function applyVolume(now) {
    if (!ac) return;
    const set = (g, v) => { if (now) g.gain.value = v; else g.gain.setTargetAtTime(v, ac.currentTime, MIX.ramp); };
    set(bus.master, vol.muteMaster || (vol.muteUnfocused && !vol.focused) ? 0 : vol.master);
    set(bus.fx.out, vol.muteFx ? 0 : vol.fx); set(bus.ui.out, vol.muteUi ? 0 : vol.ui);
  }
  function setVolume(o) { for (const k of Object.keys(vol)) if (k in o) vol[k] = o[k]; applyVolume(false); }

  // A voice is one playing sound. Times given to the building blocks are seconds from the voice's start.
  function makeVoice(group, o) {
    const b = bus[group], out = ac.createGain(), send = ac.createGain();
    out.gain.value = o.vol; send.gain.value = 0;
    let tail = out;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = o.pan || 0; out.connect(p); tail = p; }
    tail.connect(b.input); tail.connect(send); send.connect(b.wet);
    const v = { t0: ac.currentTime + MIX.lead, rate: o.rate, n: o.n, d: o.d, end: 0, srcs: [], out, send, tag: o.tag, name: o.name };
    const env = (g, t, dur, peak, a, hold) => {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
      if (hold) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    const run = (src, t, dur) => { src.start(t); src.stop(t + dur + 0.03); v.srcs.push(src); v.end = Math.max(v.end, t + dur + 0.03); };
    // How much of the voice goes to the reverb.
    v.wet = amount => { send.gain.value = amount; return v; };
    // tone: an oscillator from frequency f (sliding to `to`, or through `bend` = [[seconds, Hz], ...]), with a
    // short attack `a`, an optional `hold`, and a decay to silence by `dur`. `lp` low-passes it; `vib` wobbles it.
    v.tone = (q) => {
      const t = v.t0 + (q.at || 0), dur = q.dur || 0.2, osc = ac.createOscillator(), g = ac.createGain();
      osc.type = q.type || 'sine'; osc.frequency.setValueAtTime(q.f * v.rate, t);
      if (q.to) osc.frequency.exponentialRampToValueAtTime(q.to * v.rate, t + (q.slide || dur));
      for (const [at, f] of q.bend || []) osc.frequency.exponentialRampToValueAtTime(f * v.rate, t + at);
      if (q.vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = q.vib.f; lg.gain.value = q.vib.d; l.connect(lg); lg.connect(osc.frequency); run(l, t, dur); }
      env(g, t, dur, q.vol ?? 0.25, q.a ?? MIX.attack, q.hold);
      if (q.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = q.lp; osc.connect(f); f.connect(g); } else osc.connect(g);
      g.connect(out); run(osc, t, dur); return v;
    };
    // noise: filtered noise. type = lowpass / bandpass / highpass at f Hz (sliding to `to`), sharpness q.
    v.noise = (q) => {
      const t = v.t0 + (q.at || 0), dur = q.dur || 0.2, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noiseBuf; src.loop = true; f.type = q.type || 'lowpass'; f.Q.value = q.q ?? 1;
      f.frequency.setValueAtTime(q.f || 1000, t); if (q.to) f.frequency.exponentialRampToValueAtTime(q.to, t + dur);
      env(g, t, dur, q.vol ?? 0.2, q.a ?? MIX.attack, q.hold);
      src.connect(f); f.connect(g); g.connect(out); run(src, t, dur); return v;
    };
    // sweep: a tone that slides from one pitch to another.
    v.sweep = (f, to, dur, q = {}) => v.tone({ f, to, dur, ...q });
    // chime: bell-like notes one after another, `gap` seconds apart.
    v.chime = (freqs, q = {}) => {
      freqs.forEach((f, i) => {
        const at = (q.at || 0) + i * (q.gap ?? 0.08), dur = q.dur || 0.35, lvl = q.vol ?? 0.2;
        v.tone({ f, at, dur, vol: lvl, type: q.type || 'sine' }); v.tone({ f: f * 2.76, at, dur: dur * 0.45, vol: lvl * 0.22 });
      });
      return v;
    };
    // boom: a low thump that drops in pitch, with a puff of low noise.
    v.boom = (q = {}) => {
      const f = q.f || 90, dur = q.dur || 0.45, lvl = q.vol ?? 0.45, at = q.at || 0;
      v.tone({ f, to: f * 0.42, at, dur, vol: lvl, a: 0.004 });
      return v.noise({ at, dur: dur * 0.8, vol: lvl * 0.55, f: q.crack || 500, to: 70, a: 0.004 });
    };
    v.stop = (fade = MIX.fade) => {
      const t = ac.currentTime;
      out.gain.cancelScheduledValues(t); out.gain.setTargetAtTime(0, t, fade / 3);
      for (const s of v.srcs) { try { s.stop(t + fade + 0.05); } catch { /* already stopped */ } }
      v.end = Math.min(v.end, t + fade + 0.05);
    };
    return v;
  }
  function purge() { const t = ac.currentTime; for (const v of live) if (v.end <= t) { live.delete(v); try { v.out.disconnect(); v.send.disconnect(); } catch { /* gone */ } } }

  const find = name => { const [a, b] = name.split('.'); return a === 'shared' ? shared[b] : heroes[a] && heroes[a][b]; };
  // Play "shared.coin" or "<heroId>.<name>". o = { pan: -1..1, vol: 0..1, n, d, tag }. n and d are passed to the
  // recipe (a count, a duration). Returns the voice, or null if nothing was played (no audio yet, an unknown
  // name, or one of the limits).
  function play(name, o = {}) {
    const recipe = find(name); if (!ac || !recipe) return null;
    const t = ac.currentTime, short = name.split('.')[1], group = UI.has(short) ? 'ui' : 'fx';
    if (t - (lastAt.get(name) ?? -1) < LIMITS.sameGap) return null;
    if (MINION.has(short)) {
      const times = (minionAt.get(name) || []).filter(x => t - x < LIMITS.minionWindow);
      if (times.length >= LIMITS.minionMax) { minionAt.set(name, times); return null; }
      times.push(t); minionAt.set(name, times);
    }
    purge(); if (live.size >= LIMITS.voices) return null;
    lastAt.set(name, t);
    const vary = group === 'fx' && o.vary !== false, j = k => (vary ? 1 + (random() * 2 - 1) * k : 1);
    const v = makeVoice(group, { vol: (o.vol ?? 1) * (TRIM[name] || 1) * j(LIMITS.volJitter), pan: o.pan, rate: j(LIMITS.pitchJitter), n: o.n, d: o.d, tag: o.tag, name });
    recipe(v); live.add(v); return v;
  }
  function stopTag(tag, fade) { if (ac) for (const v of live) if (v.tag === tag) v.stop(fade); }
  // Where a sound sits. dx = how far it is from the camera centre, in screen widths (0.5 = the screen edge,
  // negative = left). Returns { pan, vol }, or null if it is too far away to hear.
  function place(dx, own) {
    const d = Math.abs(dx); if (d > LIMITS.hearScreens && !own) return null;
    const far = 1 - (1 - LIMITS.farVol) * Math.min(1, d / LIMITS.hearScreens);
    return { pan: Math.max(-1, Math.min(1, dx * 2)) * LIMITS.panMax, vol: own ? Math.max(LIMITS.ownFloor, far) : far };
  }

  // ---------- shared recipes ----------
  const coin = (v, base) => v.wet(0.08).chime([base, base * 1.5], { gap: 0.055, dur: 0.22, vol: 0.16 });
  const shared = {
    coin: v => coin(v, 1570),                                             // last hit: two quick bright notes
    coinLow: v => coin(v, 1180),                                          // plates, kills
    minionHit: v => v.tone({ f: 150, to: 70, dur: 0.09, vol: 0.14 }).noise({ dur: 0.06, vol: 0.07, f: 600 }),
    casterShot: v => v.sweep(980, 520, 0.11, { vol: 0.07, type: 'triangle' }),
    cannonShot: v => v.tone({ f: 130, to: 55, dur: 0.16, vol: 0.2 }).noise({ dur: 0.08, vol: 0.08, f: 900, to: 200 }),
    minionDeath: v => v.noise({ dur: 0.22, vol: 0.09, type: 'bandpass', f: 900, to: 180, q: 1.2 }),
    towerShot: v => v.wet(0.18).boom({ f: 85, dur: 0.4, vol: 0.34 }).noise({ at: 0.02, dur: 0.3, vol: 0.05, type: 'bandpass', f: 1800, to: 500 }),
    towerShotMe: v => v.wet(0.25).boom({ f: 62, dur: 0.6, vol: 0.5 }).tone({ f: 44, dur: 0.55, vol: 0.25 }),
    towerWarn: v => v.tone({ f: 196, dur: 0.16, vol: 0.22, type: 'triangle' }).tone({ f: 147, at: 0.15, dur: 0.24, vol: 0.24, type: 'triangle' }),
    plate: v => { v.wet(0.15).noise({ dur: 0.16, vol: 0.28, type: 'bandpass', f: 2200, to: 500, q: 0.8 }).tone({ f: 120, to: 60, dur: 0.2, vol: 0.2 }); v.chime([1180, 1570, 1180], { at: 0.12, gap: 0.05, dur: 0.2, vol: 0.1 }); },
    towerFall: v => v.wet(0.4).tone({ f: 58, to: 30, dur: 1.9, vol: 0.45, a: 0.03 }).noise({ dur: 1.8, vol: 0.3, f: 500, to: 60, a: 0.05 }).noise({ at: 0.1, dur: 0.5, vol: 0.18, type: 'bandpass', f: 1500, to: 300 }),
    levelUp: v => v.wet(0.25).chime([523, 659, 784], { gap: 0.1, dur: 0.5, vol: 0.2 }),
    deny: v => v.tone({ f: 190, to: 150, dur: 0.07, vol: 0.2, type: 'triangle', lp: 900 }),
    buy: v => { v.noise({ dur: 0.05, vol: 0.1, type: 'highpass', f: 3000 }); v.chime([880, 1320], { at: 0.05, gap: 0.07, dur: 0.3, vol: 0.14 }); },
    sell: v => { v.noise({ dur: 0.05, vol: 0.1, type: 'highpass', f: 3000 }); v.chime([1320, 880], { at: 0.05, gap: 0.07, dur: 0.3, vol: 0.14 }); },
    undo: v => v.sweep(900, 300, 0.13, { vol: 0.14, type: 'triangle' }).sweep(600, 220, 0.1, { at: 0.07, vol: 0.1, type: 'triangle' }),
    // recall: a soft hum that rises for as long as the channel lasts (v.d seconds); stopped early if interrupted
    recall: v => { const d = v.d || 8; v.wet(0.3).tone({ f: 110, to: 330, dur: d, vol: 0.12, a: 0.4, hold: d - 0.6, type: 'triangle', lp: 1200, vib: { f: 5, d: 3 } }).noise({ dur: d, vol: 0.04, type: 'bandpass', f: 400, to: 2400, q: 3, a: 0.5, hold: d - 0.7 }); },
    recallDone: v => { v.wet(0.5).noise({ dur: 0.5, vol: 0.14, type: 'bandpass', f: 600, to: 5000, q: 1.5, a: 0.08 }); v.chime([1047, 1319, 1568, 2093], { at: 0.12, gap: 0.05, dur: 0.5, vol: 0.09 }); },
    potion: v => { v.tone({ f: 260, to: 150, dur: 0.1, vol: 0.2 }).tone({ f: 300, to: 170, at: 0.12, dur: 0.1, vol: 0.16 }); v.wet(0.2).chime([1760, 2217], { at: 0.22, gap: 0.06, dur: 0.25, vol: 0.06 }); },
    heroDeath: v => v.wet(0.3).sweep(420, 90, 0.5, { vol: 0.24, type: 'triangle' }).boom({ at: 0.28, f: 70, dur: 0.45, vol: 0.34 }),
    respawn: v => v.wet(0.4).tone({ f: 196, to: 392, dur: 0.8, vol: 0.14, a: 0.3, type: 'triangle', lp: 1500 }).tone({ f: 294, to: 588, dur: 0.8, vol: 0.09, a: 0.35 }),
    kill: v => { v.wet(0.3); for (const f of [392, 494, 587]) v.tone({ f, dur: 0.22, vol: 0.12, type: 'triangle' }); for (const f of [523, 659, 784]) v.tone({ f, at: 0.16, dur: 0.6, vol: 0.13, type: 'triangle' }); },
    died: v => { v.wet(0.35); for (const f of [220, 262]) v.tone({ f, to: f * 0.84, dur: 0.3, vol: 0.14, type: 'triangle' }); for (const f of [147, 175]) v.tone({ f, to: f * 0.75, at: 0.22, dur: 0.8, vol: 0.16, type: 'triangle' }); },
    blink: v => v.wet(0.3).noise({ dur: 0.12, vol: 0.2, type: 'bandpass', f: 800, to: 4500, q: 1.5 }).sweep(700, 2100, 0.1, { vol: 0.1 }).chime([2093], { at: 0.08, dur: 0.35, vol: 0.07 }),
    mend: v => { v.wet(0.45); for (const f of [262, 330, 392, 523]) v.tone({ f, dur: 0.9, vol: 0.08, a: 0.12, type: 'triangle', lp: 1800 }); },
    crit: v => v.tone({ f: 3100, dur: 0.12, vol: 0.1 }).tone({ f: 4300, dur: 0.06, vol: 0.05 }),
  };

  // ---------- character recipes ----------
  // Pieces several recipes of one character share.
  const steam = (v, at, dur, lvl) => v.noise({ at, dur, vol: lvl, type: 'bandpass', f: 2600, to: 4200, q: 0.7, a: dur * 0.3 });
  const bubbles = (v, at, n, lvl) => { for (let i = 0; i < n; i++) v.tone({ f: 240 + 60 * ((i * 7) % 5), to: 520 + 90 * ((i * 3) % 4), at: at + i * 0.055, dur: 0.07, vol: lvl, lp: 1400 }); return v; };
  const crackle = (v, at, n, lvl, f = 2400) => { for (let i = 0; i < n; i++) v.noise({ at: at + i * 0.03 + ((i * 5) % 3) * 0.008, dur: 0.025, vol: lvl, type: 'bandpass', f: f + 500 * ((i * 3) % 4), q: 4, a: 0.002 }); return v; };
  const glass = (v, f, at, dur, lvl) => v.tone({ f, at, dur, vol: lvl }).tone({ f: f * 2.41, at, dur: dur * 0.5, vol: lvl * 0.3 }).tone({ f: f * 3.9, at, dur: dur * 0.25, vol: lvl * 0.12 });
  const whistle = (v, dur, lvl) => v.tone({ f: 1500, to: 420, dur, vol: lvl, a: dur * 0.25, type: 'triangle', lp: 3000, vib: { f: 9, d: 12 } });
  const tick = (v, f, at, lvl) => v.tone({ f, at, dur: 0.035, vol: lvl, type: 'square', lp: 4000, a: 0.002 });
  const embers = (v, at, n, lvl) => crackle(v, at, n, lvl, 1500);

  const heroes = {
    // Bliknarczt: a haunted brass diving suit. Heavy, wet, metallic, low.
    gorrum: {
      attack: v => v.tone({ f: 120, to: 80, dur: 0.12, vol: 0.2, type: 'triangle', lp: 700 }).noise({ dur: 0.08, vol: 0.1, f: 500 }),
      attackHit: v => v.wet(0.12).tone({ f: 180, to: 95, dur: 0.16, vol: 0.28, type: 'square', lp: 520 }).tone({ f: 412, dur: 0.22, vol: 0.05 }).noise({ dur: 0.05, vol: 0.12, f: 900 }),
      qCast: v => { v.wet(0.12).tone({ f: 110, to: 60, dur: 0.1, vol: 0.34 }); steam(v, 0.03, 0.3, 0.14); for (let i = 0; i < 9; i++) v.tone({ f: 620 + 130 * ((i * 3) % 4), at: 0.12 + i * 0.05, dur: 0.035, vol: 0.05, type: 'square', lp: 2200, a: 0.002 }); },
      qHit: v => { v.wet(0.2).tone({ f: 310, to: 250, dur: 0.3, vol: 0.2, type: 'square', lp: 1500 }).tone({ f: 742, dur: 0.35, vol: 0.08 }).noise({ dur: 0.05, vol: 0.2, f: 2500 }); for (let i = 0; i < 12; i++) tick(v, 500 + i * 22, 0.12 + i * 0.04, 0.05); },
      qMiss: v => v.noise({ dur: 0.3, vol: 0.16, f: 700, to: 150 }).tone({ f: 85, to: 50, dur: 0.22, vol: 0.2 }),
      wCast: v => { v.wet(0.2); v.noise({ dur: 0.7, vol: 0.16, type: 'bandpass', f: 900, to: 4200, q: 0.8, a: 0.3 }); v.tone({ f: 880, to: 1245, at: 0.25, dur: 0.38, vol: 0.06, a: 0.1, vib: { f: 14, d: 10 } }); },
      wEnd: v => v.wet(0.25).noise({ dur: 1.1, vol: 0.13, type: 'bandpass', f: 3400, to: 500, q: 0.7, a: 0.08 }),
      eCast: v => v.tone({ f: 90, to: 140, dur: 0.18, vol: 0.16, type: 'triangle', lp: 600 }).noise({ dur: 0.14, vol: 0.06, type: 'bandpass', f: 1200, q: 2 }),
      eHit: v => { v.wet(0.3).boom({ f: 70, dur: 0.5, vol: 0.45 }); for (const [f, l] of [[392, 0.2], [1043, 0.11], [1574, 0.06]]) v.tone({ f, dur: 0.75, vol: l, a: 0.002 }); v.noise({ dur: 0.04, vol: 0.22, f: 3500 }); },
      mark: v => { crackle(v, 0, 4, 0.1); v.tone({ f: 660, to: 990, at: 0.03, dur: 0.07, vol: 0.09, type: 'square', lp: 2500 }); },
      rCast: v => { v.wet(0.35).tone({ f: 55, to: 110, dur: 0.24, vol: 0.3, a: 0.1, type: 'triangle', lp: 500 }); v.boom({ at: 0.2, f: 60, dur: 1, vol: 0.5 }); crackle(v, 0.22, 14, 0.09); bubbles(v, 0.3, 10, 0.05); },
      passive: v => { v.wet(0.25).tone({ f: 62, to: 96, dur: 0.7, vol: 0.2, type: 'sawtooth', lp: 380, a: 0.15, vib: { f: 6, d: 4 } }).tone({ f: 93, to: 71, dur: 0.6, vol: 0.12, type: 'sawtooth', lp: 320, a: 0.2 }); bubbles(v, 0.15, 9, 0.06); },
      death: v => { v.wet(0.4).tone({ f: 110, to: 38, dur: 1.5, vol: 0.24, type: 'sawtooth', lp: 420, a: 0.08, vib: { f: 5, d: 5 } }); bubbles(v, 0.5, 16, 0.06); },
    },
    // Ezrlae: a cartographer with a crossbow that fires light, and a spinning brass compass. Bright, airy, glassy.
    wren: {
      attack: v => v.tone({ f: 330, to: 180, dur: 0.07, vol: 0.14, type: 'triangle' }).sweep(1400, 2800, 0.07, { at: 0.02, vol: 0.06 }),
      attackHit: v => v.noise({ dur: 0.04, vol: 0.1, type: 'highpass', f: 3500, a: 0.002 }).tone({ f: 2200, dur: 0.05, vol: 0.05 }),
      qCast: v => v.wet(0.2).tone({ f: 260, to: 130, dur: 0.1, vol: 0.2, type: 'triangle' }).sweep(1200, 3300, 0.2, { at: 0.02, vol: 0.09, vib: { f: 30, d: 60 } }).noise({ at: 0.02, dur: 0.18, vol: 0.05, type: 'highpass', f: 4000 }),
      qHit: v => { v.wet(0.15).tone({ f: 1800, to: 2600, dur: 0.08, vol: 0.09 }); tick(v, 2400, 0.07, 0.07); tick(v, 2400, 0.14, 0.07); },
      wCast: v => v.wet(0.3).tone({ f: 520, to: 300, dur: 0.12, vol: 0.14 }).tone({ f: 392, dur: 0.6, vol: 0.05, a: 0.1, vib: { f: 7, d: 6 } }),
      wHit: v => v.wet(0.4).chime([1319], { dur: 0.6, vol: 0.14 }),
      pop: v => { v.wet(0.35); for (let i = 0; i < 6; i++) v.tone({ f: 1500 + 320 * ((i * 5) % 6), at: i * 0.022, dur: 0.12, vol: 0.07 }); if (v.n) v.chime([1568, 1976, 2349, 3136], { at: 0.1, gap: 0.035, dur: 0.16, vol: 0.06 }); },
      eCast: v => { v.wet(0.3); for (let i = 0; i < 4; i++) v.noise({ at: i * 0.035, dur: 0.05, vol: 0.09, type: 'bandpass', f: 1300 + i * 300, q: 1.5 }); v.chime([1760], { at: 0.14, dur: 0.3, vol: 0.1 }); },
      eHit: v => v.sweep(1500, 3000, 0.07, { vol: 0.07 }).noise({ dur: 0.04, vol: 0.08, type: 'highpass', f: 3500 }),
      rCast: v => { v.wet(0.5); for (const [f, l] of [[220, 0.1], [330, 0.08], [440, 0.06], [660, 0.05]]) v.tone({ f, to: f * 2, dur: 1.02, vol: l, a: 0.7, vib: { f: 9, d: f / 40 } }); v.noise({ dur: 1, vol: 0.06, type: 'bandpass', f: 800, to: 5000, q: 2, a: 0.8 }); },
      rRelease: v => v.wet(0.55).noise({ dur: 1.8, vol: 0.22, type: 'bandpass', f: 5200, to: 500, q: 0.8, a: 0.04 }).sweep(2100, 420, 1.5, { vol: 0.08, a: 0.03 }),
      rHit: v => crackle(v.wet(0.2), 0, 5, 0.1, 3000),
      passive: v => { const n = v.n || 1; tick(v, 1900 + n * 190, 0, 0.07); if (n >= 5) for (let i = 1; i < 7; i++) tick(v, 2600 + i * 110, i * 0.03, 0.05); },
      death: v => { v.wet(0.35).tone({ f: 660, to: 150, dur: 0.7, vol: 0.14, type: 'triangle', vib: { f: 13, d: 40 } }).noise({ dur: 0.5, vol: 0.04, type: 'bandpass', f: 2000, to: 400, q: 2 }); glass(v, 2350, 0.6, 0.3, 0.07); },
    },
    // Katanira: a dancer in silver ribbons with knives of frosted glass. Crystalline, elegant, quick, cool.
    sable: {
      attack: v => v.noise({ dur: 0.09, vol: 0.1, type: 'bandpass', f: 1800, to: 5200, q: 1.2 }).tone({ f: 3300, to: 2700, at: 0.04, dur: 0.05, vol: 0.04 }),
      attackHit: v => glass(v, 2640, 0, 0.14, 0.09),
      qCast: v => v.wet(0.2).tone({ f: 900, to: 1500, dur: 0.3, vol: 0.06, type: 'triangle', vib: { f: 26, d: 90 } }).noise({ dur: 0.25, vol: 0.06, type: 'bandpass', f: 3000, q: 4 }),
      bounce: v => glass(v.wet(0.3), 1320 * Math.pow(1.26, (v.n || 1) - 1), 0, 0.4, 0.13),          // each bounce rings higher
      bladeLand: v => { v.wet(0.55); glass(v, 1976, 0, 1.1, 0.12); v.tone({ f: 2960, dur: 0.9, vol: 0.04 }); },
      wCast: v => v.wet(0.25).noise({ dur: 0.3, vol: 0.11, type: 'bandpass', f: 900, to: 4800, q: 1.2, a: 0.05 }).tone({ f: 700, to: 1300, at: 0.05, dur: 0.4, vol: 0.04, type: 'triangle', vib: { f: 22, d: 70 } }),
      eCast: v => v.wet(0.3).noise({ dur: 0.2, vol: 0.1, type: 'bandpass', f: 2600, to: 900, q: 0.9, a: 0.04 }).tone({ f: 3500, at: 0.12, dur: 0.05, vol: 0.05 }),
      eHit: v => v.noise({ dur: 0.07, vol: 0.14, type: 'highpass', f: 4200, a: 0.002 }).tone({ f: 3000, to: 1800, dur: 0.08, vol: 0.08 }),
      pickup: v => { v.wet(0.4).sweep(1700, 4000, 0.16, { vol: 0.1 }).noise({ dur: 0.14, vol: 0.07, type: 'highpass', f: 5000 }); for (let i = 0; i < 6; i++) v.tone({ f: 2400 + 260 * ((i * 4) % 5), at: 0.1 + i * 0.035, dur: 0.1, vol: 0.045 }); },
      // Glass Storm: a wind bed for the whole channel (v.d seconds). The blades tick on top (rBlade); rEnd closes it.
      rCast: v => { const d = v.d || 2.5; v.wet(0.4).noise({ dur: d, vol: 0.13, type: 'bandpass', f: 700, to: 1500, q: 1.6, a: 0.25, hold: d - 0.5 }).noise({ dur: d, vol: 0.06, type: 'bandpass', f: 2600, to: 3600, q: 3, a: 0.3, hold: d - 0.5 }); },
      rBlade: v => { const f = 2200 + Math.floor(random() * 9) * 260; v.tone({ f, dur: 0.06, vol: 0.06, a: 0.002 }).tone({ f: f * 1.5, dur: 0.03, vol: 0.025 }); },
      rEnd: v => glass(v.wet(0.5), 1568, 0, 0.9, 0.12),
      death: v => { v.wet(0.4); for (let i = 0; i < 10; i++) glass(v, 1500 + 420 * ((i * 7) % 8), i * 0.018, 0.25, 0.06); v.noise({ dur: 0.12, vol: 0.16, type: 'highpass', f: 3800, a: 0.002 }); for (let i = 0; i < 5; i++) v.noise({ at: 0.3 + i * 0.13, dur: 0.12, vol: 0.05 - i * 0.008, type: 'bandpass', f: 1400 - i * 150, q: 1.5, a: 0.04 }); },
    },
    // Xerhta: an artillery mage. Rail whines, shell launches, incoming whistles, booms, radio beeps.
    kessa: {
      attack: v => v.tone({ f: 1400, to: 500, dur: 0.07, vol: 0.09, type: 'sawtooth', lp: 3500 }).noise({ dur: 0.04, vol: 0.05, type: 'highpass', f: 3000 }),
      attackHit: v => crackle(v, 0, 3, 0.09, 2600),
      // Rail Lance charging: a whine that climbs for as long as the charge takes to fill (v.d seconds), then holds.
      qCharge: v => { const d = v.d || 1.5; v.tone({ f: 180, bend: [[d, 1250]], dur: d + 1.7, vol: 0.09, a: 0.08, hold: d + 1.4, type: 'sawtooth', lp: 2600 }).tone({ f: 90, bend: [[d, 625]], dur: d + 1.7, vol: 0.07, a: 0.08, hold: d + 1.4, type: 'triangle' }); },
      qCast: v => v.wet(0.3).noise({ dur: 0.07, vol: 0.34, type: 'highpass', f: 1800, a: 0.002 }).tone({ f: 2400, to: 300, dur: 0.22, vol: 0.14, type: 'sawtooth', lp: 4500 }).tone({ f: 140, to: 60, dur: 0.2, vol: 0.3 }),
      qLand: v => v.wet(0.3).noise({ dur: 0.4, vol: 0.2, type: 'bandpass', f: 5200, to: 1500, q: 1.2, a: 0.01 }).tone({ f: 95, to: 50, dur: 0.3, vol: 0.2 }),
      qCancel: v => v.tone({ f: 900, to: 110, dur: 0.4, vol: 0.1, type: 'sawtooth', lp: 2200 }),
      wCast: v => v.tone({ f: 1250, dur: 0.05, vol: 0.06, type: 'square', lp: 3000 }),
      wTele: v => whistle(v, v.d || 0.53, 0.09),
      wLand: v => v.wet(0.35).boom({ f: 95, dur: 0.5, vol: 0.42, crack: 900 }),
      wCentre: v => v.wet(0.3).boom({ f: 58, dur: 0.6, vol: 0.5 }),
      eCast: v => v.wet(0.2).tone({ f: 170, to: 62, dur: 0.16, vol: 0.38 }).noise({ dur: 0.07, vol: 0.14, f: 1200 }).noise({ at: 0.08, dur: 0.45, vol: 0.06, type: 'bandpass', f: 500, to: 250, q: 1.5, a: 0.1 }),
      eHit: v => v.wet(0.2).tone({ f: 520, dur: 0.22, vol: 0.15, type: 'square', lp: 2200 }).tone({ f: 1290, dur: 0.18, vol: 0.07 }).noise({ dur: 0.04, vol: 0.18, f: 3000 }),
      stun: v => { const d = Math.min(2.25, Math.max(0.4, v.n || 1)); v.wet(0.25).tone({ f: 1865, dur: d, vol: 0.06, a: 0.02, hold: d * 0.5, vib: { f: 7, d: 12 } }).tone({ f: 2794, dur: d * 0.8, vol: 0.025, a: 0.02, hold: d * 0.3 }); },
      // Fire Mission starting: two radio beeps, then a low hum for as long as she is rooted (v.d seconds).
      rStart: v => { const d = v.d || 10; v.tone({ f: 1320, dur: 0.07, vol: 0.09, type: 'square', lp: 3200 }).tone({ f: 1320, at: 0.12, dur: 0.07, vol: 0.09, type: 'square', lp: 3200 }); v.tone({ f: 48, to: 82, slide: 1.2, at: 0.25, dur: d, vol: 0.12, a: 0.6, hold: d - 1, type: 'sawtooth', lp: 300 }); },
      rShot: v => { const k = 1 + (((v.n || 1) * 3) % 5 - 2) * 0.05; v.wet(0.3).tone({ f: 150 * k, to: 55 * k, dur: 0.22, vol: 0.3 }).noise({ dur: 0.1, vol: 0.1, f: 800 }); },
      rTele: v => whistle(v, v.d || 0.63, 0.1),
      rLand: v => { const big = 1 + 0.12 * Math.min(6, (v.n || 1) - 1); v.wet(0.4).boom({ f: 88 / big, dur: 0.55 * big, vol: Math.min(0.6, 0.4 * big), crack: 1000 }); },
      rEnd: v => v.tone({ f: 300, to: 70, dur: 0.35, vol: 0.09, type: 'sawtooth', lp: 900 }),
      passive: v => { tick(v, 800, 0, 0.1); v.tone({ f: 170, to: 110, at: 0.07, dur: 0.07, vol: 0.18, type: 'square', lp: 700 }); v.sweep(520, 1040, 0.22, { at: 0.12, vol: 0.08, type: 'triangle' }); },
      death: v => { v.wet(0.3).tone({ f: 700, to: 55, dur: 0.9, vol: 0.14, type: 'sawtooth', lp: 1800 }); crackle(v, 0.35, 16, 0.07, 1800); },
    },
    // Oriel: a fire and sun mage. Warm, crackling.
    oriel: {
      attack: v => v.noise({ dur: 0.12, vol: 0.12, type: 'bandpass', f: 500, to: 1400, q: 0.8, a: 0.02 }),
      attackHit: v => embers(v, 0, 4, 0.08),
      qCast: v => { v.wet(0.2).noise({ dur: 0.35, vol: 0.16, type: 'bandpass', f: 700, to: 2600, q: 0.9, a: 0.03 }); embers(v, 0.03, 8, 0.06); },
      qHit: v => { v.wet(0.2).boom({ f: 120, dur: 0.25, vol: 0.24, crack: 1400 }); embers(v, 0.02, 9, 0.08); },
      wCast: v => v.noise({ dur: 0.15, vol: 0.1, type: 'bandpass', f: 900, q: 1.5, a: 0.03 }),
      wTele: v => { const d = v.d || 0.75; v.noise({ dur: d, vol: 0.09, type: 'bandpass', f: 2600, to: 4200, q: 2.5, a: d * 0.5 }); embers(v, 0.05, Math.round(d * 14), 0.035); },
      wLand: v => v.wet(0.3).boom({ f: 130, dur: 0.35, vol: 0.34, crack: 2200 }).noise({ dur: 0.12, vol: 0.14, type: 'highpass', f: 2500, a: 0.003 }),
      eCast: v => v.noise({ dur: 0.04, vol: 0.22, type: 'highpass', f: 2500, a: 0.002 }).tone({ f: 1700, to: 600, dur: 0.1, vol: 0.09, type: 'sawtooth', lp: 3500 }),
      eHit: v => v.tone({ f: 210, dur: 1, vol: 0.07, a: 0.02, hold: 0.7, type: 'sawtooth', lp: 1800, vib: { f: 55, d: 30 } }).noise({ dur: 1, vol: 0.04, type: 'bandpass', f: 3200, q: 5, a: 0.02, hold: 0.7 }),
      rCast: v => v.wet(0.3).tone({ f: 98, to: 147, dur: 0.5, vol: 0.14, a: 0.25, type: 'triangle', lp: 900 }),
      rTele: v => { const d = v.d || 1.1; v.wet(0.4).tone({ f: 110, to: 330, dur: d, vol: 0.14, a: d * 0.8, type: 'sawtooth', lp: 1100 }).noise({ dur: d, vol: 0.08, type: 'bandpass', f: 500, to: 2600, q: 1, a: d * 0.85 }); },
      rLand: v => { v.wet(0.5).boom({ f: 72, dur: 1.1, vol: 0.55, crack: 1500 }); v.noise({ dur: 1.3, vol: 0.2, type: 'bandpass', f: 1800, to: 300, q: 0.6, a: 0.02 }); embers(v, 0.1, 14, 0.06); },
      death: v => { v.wet(0.3).noise({ dur: 0.9, vol: 0.14, type: 'bandpass', f: 1800, to: 250, q: 1, a: 0.03 }); embers(v, 0.1, 10, 0.05); v.tone({ f: 220, to: 70, dur: 0.7, vol: 0.08, type: 'triangle' }); },
    },
  };
  heroes.sable.passive = heroes.sable.pickup;      // her passive is the slash on picking a blade up

  if (typeof document !== 'undefined') for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, unlock, true);

  return { LIMITS, DEFAULT_VOLUME, UI, shared, heroes, init, unlock, play, stopTag, place, setVolume, find,
    get ready() { return !!ac && ac.state === 'running'; }, get playing() { return ac ? (purge(), live.size) : 0; }, get context() { return ac; },
    set random(f) { random = f; } };
})();
