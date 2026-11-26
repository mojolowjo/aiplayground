// Chiptune sound effects made on the fly with Web Audio: square and noise blips, no sound files.
let ctx = null, on = true;
export function setSound(v) { on = !!v; }
function ac() { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
function tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
  if (!on) return; const a = ac(); if (!a) return;
  const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.08, delay = 0) {
  if (!on) return; const a = ac(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(), g = a.createGain(); s.buffer = buf; g.gain.value = vol;
  s.connect(g).connect(a.destination); s.start(a.currentTime + delay);
}
let lastHit = 0;
export const sfx = {
  unlock() { ac(); },
  play() { tone(440, 0.08, { slide: 300 }); },
  spell() { tone(880, 0.15, { type: 'triangle', slide: -500, vol: 0.08 }); },
  hit() { const t = performance.now(); if (t - lastHit < 70) return; lastHit = t; noise(0.04, 0.03); },
  die() { tone(220, 0.12, { slide: -150, vol: 0.05 }); },
  boom() { noise(0.4, 0.15); tone(110, 0.4, { slide: -60, vol: 0.08 }); },
  tower() { noise(0.6, 0.18); tone(196, 0.2, { delay: 0.1 }); tone(147, 0.3, { delay: 0.3 }); },
  click() { tone(660, 0.04, { vol: 0.04 }); },
  deny() { tone(150, 0.12, { vol: 0.05 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { delay: i * 0.14, vol: 0.07 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.22, { delay: i * 0.18, vol: 0.06 })); },
  tick() { tone(1200, 0.03, { vol: 0.03 }); },
  double() { tone(523, 0.1); tone(784, 0.15, { delay: 0.1 }); },
  coin() { tone(988, 0.06, { vol: 0.05 }); tone(1319, 0.1, { delay: 0.06, vol: 0.05 }); },
};
