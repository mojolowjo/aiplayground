'use strict';
// Procedural art, animation state and particles. Everything is drawn in code.
// Uses globals defined in client.js at call time: ctx, scale, sx, sy, hello, W, H.
const GFX = { parts: [], floaters: [], anim: new Map(), trails: new Map(), shake: 0, scenery: null };
const TAU = Math.PI * 2, OUT = '#10141a';
const clamp01 = v => Math.max(0, Math.min(1, v));
const ease = t => t * t * (3 - 2 * t);
function shade(hex, k) {
  const n = parseInt(hex.slice(1, 7), 16), f = c => Math.max(0, Math.min(255, Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})`;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- animation state ----------
function animGet(id) {
  let a = GFX.anim.get(id);
  if (!a) GFX.anim.set(id, a = { x: null, y: 0, walk: 0, moving: 0, atk0: -9, atkD: 0.2, side: 1, cast0: -9, hp: null, flash: -9, f: null, seen: 0, lvl0: -9, dust: 0 });
  return a;
}
function animUpdate(u, now, dt) {
  const a = animGet(u.id);
  if (a.x === null) { a.x = u.x; a.y = u.y; a.hp = u.hp; }
  const v = Math.hypot(u.x - a.x, u.y - a.y) / Math.max(dt, 0.001), mv = v > 40 && v < 3000 ? 1 : 0;
  a.moving += (mv - a.moving) * Math.min(1, dt * 12);
  a.walk += dt * (5 + v / 45) * mv;
  if (u.f !== undefined) {
    if (a.f === null) a.f = u.f;
    let d = u.f - a.f; d = Math.atan2(Math.sin(d), Math.cos(d)); a.f += d * Math.min(1, dt * 18);
  }
  if (mv && u.k === 'h' && (a.dust -= dt) <= 0) { a.dust = 0.22; burstParts(u.x - Math.cos(a.f || 0) * 34, u.y - Math.sin(a.f || 0) * 34 + 10, 2, { color: '#b8a888', speed: 26, life: 0.5, size: 6, alpha: 0.3, ground: true }); }
  if (a.hp > u.hp) a.hp = Math.max(u.hp, a.hp - u.mhp * 0.6 * dt); else a.hp = u.hp;
  a.x = u.x; a.y = u.y; a.seen = now;
  return a;
}
// Attack pose: -1 = fully wound back, +1 = fully struck, 0 = rest. p = windup progress 0..1 (or -1 when idle).
function atkPose(a, now) {
  const t = now - a.atk0; if (t < 0 || t > a.atkD + 0.28) return { s: 0, p: -1 };
  if (t < a.atkD) { const p = t / a.atkD; return { s: p < 0.75 ? -ease(p / 0.75) : -1 + 2 * ease((p - 0.75) / 0.25), p }; }
  return { s: 1 - ease((t - a.atkD) / 0.28), p: -1 };
}

// ---------- particles ----------
function burstParts(x, y, n, o) {
  for (let i = 0; i < n; i++) {
    const ang = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread ?? 1) : Math.random() * TAU, sp = (o.speed || 100) * (0.4 + Math.random() * 0.8);
    const r0 = o.ring ? o.ring : 0;
    GFX.parts.push({ x: x + Math.cos(ang) * r0, y: y + Math.sin(ang) * r0, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp + (o.vy || 0),
      life: (o.life || 0.5) * (0.6 + Math.random() * 0.6), max: o.life || 0.5, size: (o.size || 6) * (0.6 + Math.random() * 0.8),
      color: o.color || '#fff', glow: !!o.glow, alpha: o.alpha ?? 1, drag: o.drag ?? 2.5, ground: !!o.ground });
  }
  if (GFX.parts.length > 900) GFX.parts.splice(0, GFX.parts.length - 900);
}
function floater(x, y, text, color, size) { GFX.floaters.push({ x: x + (Math.random() - 0.5) * 40, y, text, color, size: size || 15, t0: performance.now() / 1000, dur: 0.9 }); }
// Ground particles (dust) are drawn before the units so they sit under them; everything else goes on top.
function drawGroundParts(dt) { drawPartLayer(dt, true); }
function drawPartLayer(dt, ground) {
  const keep = [];
  for (const p of GFX.parts) {
    if (p.ground !== ground) { keep.push(p); continue; }
    p.life -= dt; if (p.life <= 0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k;
    const f = clamp01(p.life / p.max);
    ctx.globalAlpha = f * p.alpha; ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), Math.max(0.5, p.size * scale * (0.4 + 0.6 * f)), 0, TAU); ctx.fill();
    keep.push(p);
  }
  GFX.parts = keep; ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function drawParts(dt, now) {
  drawPartLayer(dt, false);
  GFX.floaters = GFX.floaters.filter(f => now - f.t0 < f.dur);
  ctx.textAlign = 'center';
  for (const f of GFX.floaters) {
    const p = (now - f.t0) / f.dur; ctx.globalAlpha = 1 - p * p; ctx.font = `bold ${f.size}px system-ui`;
    const x = sx(f.x), y = sy(f.y) - 40 * scale - 46 * ease(p);
    ctx.lineWidth = 3; ctx.strokeStyle = '#000c'; ctx.strokeText(f.text, x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
  }
  ctx.globalAlpha = 1;
}

// ---------- primitives (local, world-unit space) ----------
function ell(x, y, rx, ry, fill, stroke, lw) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function seg(x1, y1, x2, y2, col, lw) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function poly(pts, fill, stroke, lw) {
  ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.lineJoin = 'round'; ctx.stroke(); }
}
function glow(x, y, r, col, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function begin(u, rot) { ctx.save(); ctx.translate(sx(u.x), sy(u.y)); ctx.scale(scale, scale); if (rot !== undefined) ctx.rotate(rot); }

// ---------- heroes ----------
const SKIN = '#e9c8a2';
function drawHero(u, a, now, teamCol, isMe) {
  const def = hello.heroes[u.h], col = def.color, dark = shade(col, -0.45), lite = shade(col, 0.35);
  const { s, p } = atkPose(a, now), castT = now - a.cast0, castP = castT >= 0 && castT < 0.45 ? 1 - castT / 0.45 : 0;
  const step = Math.sin(a.walk) * a.moving, breathe = Math.sin(now * 2.2 + u.id) * 0.6 * (1 - a.moving);
  const f = a.f ?? 0, flash = now - a.flash < 0.09;
  begin(u);
  ell(10, 16, 52, 34, 'rgba(0,0,0,.32)');
  ctx.globalAlpha = isMe ? 0.95 : 0.75; ell(0, 0, 60, 60, null, teamCol, isMe ? 5 : 4); ctx.globalAlpha = 1;
  if (castP > 0) glow(0, 0, 70 + 60 * (1 - castP), col, castP * 0.7);
  ctx.rotate(f);
  if (u.br) ctx.globalAlpha = 0.6;
  // feet
  ell(step * 17, -16, 13, 9, '#22262c', OUT, 2.5); ell(-step * 17, 16, 13, 9, '#22262c', OUT, 2.5);
  const big = u.h === 'brakk' ? 1.18 : u.h === 'oriel' ? 0.96 : 1;
  ctx.save(); ctx.translate(step * 1.5, 0);
  if (u.h === 'vesk') {
    const pull = p >= 0 ? ease(clamp01(p / 0.85)) * (p > 0.92 ? 0 : 1) : 0;
    ell(-18, 0, 20, 30, dark, OUT, 3);                       // cloak tail
    poly([-24, -14, -44, -8, -46, 10, -24, 14], '#6b4a2a', OUT, 2.5); // quiver
    ell(0, 0, 21 + breathe, 34, col, OUT, 3);
    ell(0, -30, 11, 9, teamCol, OUT, 2.5); ell(0, 30, 11, 9, teamCol, OUT, 2.5);
    seg(4, -30, 40, -4, SKIN, 8); seg(4, 30, 40 - pull * 26, 0, SKIN, 8);      // arms
    ctx.strokeStyle = '#7a4f24'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(22, 0, 40, -1.05, 1.05); ctx.stroke();
    const tx = 22 + 40 * Math.cos(1.05), ty = 40 * Math.sin(1.05), sxp = tx - pull * 28;
    ctx.strokeStyle = '#f2ead8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(tx, -ty); ctx.lineTo(sxp, 0); ctx.lineTo(tx, ty); ctx.stroke();
    if (pull > 0.05) { seg(sxp, 0, sxp + 62, 0, '#e8dcc0', 3); poly([sxp + 62, -6, sxp + 76, 0, sxp + 62, 6], '#d8d8e0', OUT, 1.5); }
    ell(4, 0, 15, 15, dark, OUT, 3); poly([-2, -10, 18, 0, -2, 10], lite);     // hood
  } else if (u.h === 'oriel') {
    const thrust = s * 14, gl = Math.max(p >= 0 ? p : 0, castP, 0.25 + 0.1 * Math.sin(now * 4));
    poly([-40, -30, 14, -26, 22, 0, 14, 26, -40, 30, -30, 0], dark, OUT, 3);   // robe train
    ell(0, 0, 22 + breathe, 32, col, OUT, 3);
    ell(0, -28, 10, 8, teamCol, OUT, 2.5); ell(0, 28, 10, 8, teamCol, OUT, 2.5);
    seg(2, 28, 26 + thrust, 34, SKIN, 7); seg(2, -28, 22 + castP * 16, -26 - castP * 6, SKIN, 7);
    seg(-22 + thrust, 34, 58 + thrust, 34, '#8a6a3c', 5);
    ell(62 + thrust, 34, 10, 10, lite, OUT, 2.5); glow(62 + thrust, 34, 22 + gl * 34, col, 0.35 + gl * 0.6);
    ell(3, 0, 24, 24, dark, OUT, 3); ell(1, 0, 12, 12, col, OUT, 2.5); ell(-1, 0, 4, 4, lite);   // hat from above
  } else if (u.h === 'kessa') {
    const recoil = -Math.max(0, s) * 13, gl = Math.max(p >= 0 ? p : 0, castP, 0.2 + 0.08 * Math.sin(now * 5));
    poly([-34, -16, -12, -22, -12, 22, -34, 16], '#4a5560', OUT, 3);                 // pack
    ell(0, 0, 21 + breathe, 31, col, OUT, 3);
    ell(0, -27, 10, 8, teamCol, OUT, 2.5); ell(0, 27, 10, 8, teamCol, OUT, 2.5);
    ctx.save(); ctx.translate(recoil, 0);
    seg(2, 27, 24, 24, SKIN, 7); seg(2, -27, 34, 10, SKIN, 7);
    poly([-16, 12, 54, 13, 54, 31, -16, 32], '#5d6570', OUT, 3); poly([-16, 12, 54, 13, 54, 18, -16, 17], '#8a939e');
    poly([6, 10, 14, 10, 14, 34, 6, 34], dark, OUT, 2.5); poly([48, 9, 60, 9, 60, 35, 48, 35], col, OUT, 3);
    glow(62, 22, 18 + gl * 40, col, 0.3 + gl * 0.65);
    ctx.restore();
    ell(4, 0, 15, 15, dark, OUT, 3); ell(12, -6, 5, 5, lite, OUT, 2); ell(12, 6, 5, 5, lite, OUT, 2);   // goggles
  } else if (u.h === 'brakk') {
    ell(0, 0, 26 + breathe, 42, shade(col, -0.2), OUT, 3.5);
    ell(0, 0, 16, 26, '#8d949c', OUT, 2.5);                                     // chest plate
    ell(-2, -37, 17, 14, teamCol, OUT, 3); ell(-2, 37, 17, 14, teamCol, OUT, 3);
    seg(2, -37, 30, -24, SKIN, 10); ell(32, -22, 9, 9, '#8d949c', OUT, 2.5);    // off-hand fist
    ctx.save(); ctx.translate(6, 36); ctx.rotate(s < 0 ? 0.3 + (-s) * 1.9 : 0.3 - s * 1.2);
    seg(0, 0, 26, 0, SKIN, 10); seg(18, 0, 86, 0, '#6b4a2a', 7);
    poly([70, -24, 104, -24, 104, 24, 70, 24], '#9aa3ad', OUT, 3); poly([76, -24, 98, -24, 98, -16, 76, -16], '#c9d0d8');
    ctx.restore();
    ell(4, 0, 17, 17, '#8d949c', OUT, 3); poly([10, -4, 22, 0, 10, 4], OUT);    // helm + visor
    poly([-2, -15, -10, -30, 6, -17], '#e8e0cc', OUT, 2); poly([-2, 15, -10, 30, 6, 17], '#e8e0cc', OUT, 2);
  } else {
    const stabR = a.side > 0 ? Math.max(0, s) * 34 - Math.max(0, -s) * 10 : 0, stabL = a.side < 0 ? Math.max(0, s) * 34 - Math.max(0, -s) * 10 : 0;
    const sw = Math.sin(now * 7 + u.id) * 8;
    ctx.strokeStyle = teamCol; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(-30, sw, -52, -sw * 1.3); ctx.stroke();   // scarf
    ell(0, 0, 19 + breathe, 31, dark, OUT, 3);
    ell(0, -27, 10, 8, col, OUT, 2.5); ell(0, 27, 10, 8, col, OUT, 2.5);
    for (const [sy2, st] of [[-1, stabL], [1, stabR]]) {
      seg(2, sy2 * 27, 24 + st, sy2 * 22, SKIN, 7);
      poly([24 + st, sy2 * 22 - 5, 62 + st, sy2 * 20, 24 + st, sy2 * 22 + 5], '#dfe6ee', OUT, 2);
    }
    ell(4, 0, 15, 15, '#1d2a2a', OUT, 3); poly([8, -7, 18, -3, 18, 3, 8, 7], col);   // hood + mask
  }
  ctx.restore();
  if (flash) { ctx.globalCompositeOperation = 'lighter'; ell(0, 0, 30 * big, 36 * big, 'rgba(255,255,255,.22)'); ctx.globalCompositeOperation = 'source-over'; }
  ctx.globalAlpha = 1;
  ctx.rotate(-f);
  // status effects
  if (u.sg) { ctx.setLineDash([18, 12]); ctx.lineDashOffset = -now * 40; ell(0, 0, 92, 92, null, col, 4); ctx.setLineDash([]);
    for (let i = 0; i < 3; i++) { const an = i * TAU / 3 + 0.5; seg(Math.cos(an) * 58, Math.sin(an) * 58, Math.cos(an) * 96, Math.sin(an) * 96, '#aab3bd', 7); } }
  if (u.ch) { ctx.strokeStyle = u.ch >= 1 ? '#ffffff' : col; ctx.lineWidth = 7; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(0, 0, 74, -1.57, -1.57 + TAU * u.ch); ctx.stroke(); glow(0, 0, 60 + 50 * u.ch, col, 0.25 + 0.4 * u.ch); }
  if (u.sh) { const pu = 1 + Math.sin(now * 8) * 0.03; ell(0, 0, 72 * pu, 72 * pu, 'rgba(190,225,255,.18)', 'rgba(230,245,255,.9)', 3); }
  if (u.sl) { ctx.setLineDash([10, 12]); ell(0, 8, 58, 40, null, '#9fe0ff', 4); ctx.setLineDash([]); }
  if (u.rt) for (let i = 0; i < 8; i++) { const an = i / 8 * TAU; poly([Math.cos(an) * 46, Math.sin(an) * 46, Math.cos(an + 0.25) * 70, Math.sin(an + 0.25) * 70, Math.cos(an + 0.5) * 46, Math.sin(an + 0.5) * 46], '#7a4bd0', OUT, 2); }
  if (u.mk) { ctx.save(); ctx.rotate(now * 2); for (let i = 0; i < 4; i++) { ctx.rotate(TAU / 4); poly([78, -8, 62, 0, 78, 8], '#8affd9', OUT, 2); } ctx.restore(); }
  if (u.st) for (let i = 0; i < 3; i++) { const an = now * 5 + i * TAU / 3; star(Math.cos(an) * 34, -70 + Math.sin(an) * 12, 11, '#ffd24a'); }
  if (u.rc) { ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 84, -1.57, -1.57 + TAU * u.rc); ctx.stroke(); glow(0, 0, 90, '#7fd0ff', 0.25 + 0.25 * Math.sin(now * 10)); }
  const lv = now - a.lvl0; if (lv >= 0 && lv < 1) { ctx.globalAlpha = 1 - lv; ell(0, 0, 60 + lv * 90, 60 + lv * 90, null, '#ffd24a', 6); ctx.globalAlpha = 1; }
  ctx.restore();
}
function star(x, y, r, col) {
  const pts = []; for (let i = 0; i < 10; i++) { const an = i / 10 * TAU - 1.57, rr = i % 2 ? r * 0.45 : r; pts.push(x + Math.cos(an) * rr, y + Math.sin(an) * rr); }
  poly(pts, col, OUT, 1.5);
}

// ---------- minions ----------
function drawMinion(u, a, now, col) {
  const { s, p } = atkPose(a, now), step = Math.sin(a.walk) * a.moving, dark = shade(col, -0.45), flash = now - a.flash < 0.08;
  begin(u); ell(6, 9, 30, 20, 'rgba(0,0,0,.3)'); ctx.rotate(a.f ?? 0);
  ell(step * 10, -10, 8, 6, '#22262c', OUT, 2); ell(-step * 10, 10, 8, 6, '#22262c', OUT, 2);
  if (u.m) {
    ell(0, 0, 16, 23, dark, OUT, 3);
    ctx.save(); ctx.translate(6, 20); ctx.rotate(s < 0 ? 0.3 + (-s) * 1.3 : 0.3 - s * 1.4);
    seg(0, 0, 14, 0, SKIN, 6); poly([12, -4, 48, 0, 12, 4], '#dfe6ee', OUT, 2); ctx.restore();
    ctx.strokeStyle = OUT; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(8, -14, 17, -1.9, 0.2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(8, -14, 17, -1.9, 0.2); ctx.stroke();   // shield
    ell(3, 0, 11, 11, col, OUT, 2.5); seg(-4, 0, 10, 0, shade(col, 0.5), 3);
  } else {
    const th = s * 8, gl = p >= 0 ? p : 0.15;
    poly([-22, -14, 6, -15, 12, 0, 6, 15, -22, 14], dark, OUT, 2.5);
    ell(0, 0, 13, 18, col, OUT, 2.5);
    seg(-8 + th, 18, 30 + th, 18, '#8a6a3c', 4); ell(32 + th, 18, 6, 6, shade(col, 0.6), OUT, 2); glow(32 + th, 18, 12 + gl * 22, col, 0.3 + gl * 0.6);
    ell(2, 0, 13, 13, dark, OUT, 2.5); ell(1, 0, 6, 6, shade(col, 0.4));
  }
  if (flash) { ctx.globalCompositeOperation = 'lighter'; ell(0, 0, 18, 20, 'rgba(255,255,255,.28)'); ctx.globalCompositeOperation = 'source-over'; }
  ctx.restore();
}

// ---------- tower ----------
function drawTower(u, a, now, col, near) {
  const { p } = atkPose(a, now), charge = p >= 0 ? p : 0, flash = now - a.flash < 0.08;
  begin(u);
  ctx.globalAlpha = near ? 0.55 : 0.18; ctx.setLineDash([24, 18]); ctx.lineDashOffset = -now * 30;
  ell(0, 0, 775, 775, null, col, 3); ctx.setLineDash([]); ctx.globalAlpha = 1;
  ell(16, 24, 112, 84, 'rgba(0,0,0,.4)');
  const oct = (r, rot) => { const pts = []; for (let i = 0; i < 8; i++) { const an = i / 8 * TAU + rot; pts.push(Math.cos(an) * r, Math.sin(an) * r); } return pts; };
  poly(oct(104, 0.39), '#5d6570', OUT, 4); poly(oct(92, 0.39), '#7a838f');
  for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * TAU / 4 + 0.785); poly([70, -16, 112, -12, 112, 12, 70, 16], '#4a515b', OUT, 3); ctx.restore(); }
  poly(oct(66, 0), '#3d434c', OUT, 4); poly(oct(52, 0), shade(col, -0.55), OUT, 2);
  const pulse = 0.5 + 0.5 * Math.sin(now * 3);
  glow(0, 0, 70 + 50 * charge + 10 * pulse, col, 0.45 + 0.5 * charge);
  ctx.save(); ctx.rotate(now * 0.6 + charge * 3); const cs = 30 + 6 * charge;
  poly([0, -cs * 1.25, cs, 0, 0, cs * 1.25, -cs, 0], col, OUT, 3); poly([0, -cs * 1.25, cs, 0, 0, 0], shade(col, 0.45)); poly([0, 0, 0, cs * 1.25, -cs, 0], shade(col, -0.3));
  ctx.restore();
  if (flash) { ctx.globalCompositeOperation = 'lighter'; ell(0, 0, 100, 100, 'rgba(255,255,255,.25)'); ctx.globalCompositeOperation = 'source-over'; }
  ctx.restore();
}

// ---------- projectiles ----------
function drawShot(s, now, teamCol) {
  const col = s.c || teamCol;
  let tr = GFX.trails.get(s.id); if (!tr) GFX.trails.set(s.id, tr = { pts: [], seen: 0 });
  tr.seen = now; tr.pts.push(s.x, s.y); if (tr.pts.length > 16) tr.pts.splice(0, 2);
  const n = tr.pts.length / 2, wide = s.s === 'bolt' ? 16 : s.s === 'mote' ? 5 : s.s === 'arrow' ? 4 : 11;
  ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
  for (let i = 1; i < n; i++) {
    ctx.globalAlpha = i / n * 0.55; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, wide * scale * i / n);
    ctx.beginPath(); ctx.moveTo(sx(tr.pts[i * 2 - 2]), sy(tr.pts[i * 2 - 1])); ctx.lineTo(sx(tr.pts[i * 2]), sy(tr.pts[i * 2 + 1])); ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  begin(s, s.s === 'blade' ? now * 22 : s.a);
  if (s.s === 'arrow') {
    seg(-34, 0, 20, 0, '#e8dcc0', 4); poly([18, -8, 38, 0, 18, 8], '#f4f4fa', OUT, 2);
    poly([-34, 0, -44, -8, -30, -3], col); poly([-34, 0, -44, 8, -30, 3], col); glow(20, 0, 26, col, 0.5);
  } else if (s.s === 'blade') {
    poly([-30, 0, 0, -9, 34, 0, 0, 9], '#e6f2f0', OUT, 2.5); glow(0, 0, 40, col, 0.6);
  } else if (s.s === 'bolt') {
    glow(0, 0, 70, col, 0.9); ell(0, 0, 20, 14, '#ffffff', teamCol, 4);
  } else if (s.s === 'mote') {
    glow(0, 0, 22, col, 0.8); ell(0, 0, 8, 8, shade(col.startsWith('#') ? col : '#ffffff', 0.6), OUT, 1.5);
  } else {
    const r = Math.max(14, s.w / 2.6); glow(0, 0, r * 3, col, 0.85); ell(0, 0, r * 1.2, r * 0.85, col, OUT, 2.5); ell(r * 0.2, 0, r * 0.55, r * 0.4, '#ffffff');
    if (Math.random() < 0.6) burstParts(s.x, s.y, 1, { color: col, speed: 60, life: 0.35, size: 6, glow: true });
  }
  ctx.restore();
}

// ---------- zones ----------
function drawZone(z, now, mine) {
  const col = z.c || (mine ? '#6fb8ff' : '#ff6b6b'), edge = mine ? '#bfe0ff' : '#ff7a6a';
  ctx.save(); ctx.translate(sx(z.x), sy(z.y)); ctx.scale(scale, scale);
  ctx.globalAlpha = 0.16 + 0.1 * z.p; ell(0, 0, z.r, z.r, col);
  ctx.globalAlpha = 0.35; ell(0, 0, z.r * ease(z.p), z.r * ease(z.p), col);
  ctx.globalAlpha = 0.9; ctx.setLineDash([26, 16]); ctx.lineDashOffset = now * 80; ell(0, 0, z.r, z.r, null, edge, 4); ctx.setLineDash([]);
  ctx.globalAlpha = 1; ctx.restore();
}

// ---------- map ----------
function buildScenery(M) {
  const tile = (base, dots, n, seed) => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), r = rng(seed);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < n; i++) { g.fillStyle = dots[i % dots.length]; g.globalAlpha = 0.25 + r() * 0.5; const x = r() * 256, y = r() * 256, s = 2 + r() * 7;
      for (const [ox, oy] of [[0, 0], [256, 0], [0, 256], [-256, 0], [0, -256]]) { g.beginPath(); g.ellipse(x + ox, y + oy, s, s * (0.5 + r() * 0.5), r() * 3, 0, TAU); g.fill(); } }
    return ctx.createPattern(c, 'repeat');
  };
  const r = rng(77), trees = [], tufts = [];
  for (const [y0, y1] of [[-80, M.top - 20], [M.bot + 20, M.h + 80]])
    for (let x = -100; x < M.w + 100; x += 62) for (let k = 0; k < 2; k++) trees.push({ x: x + r() * 60, y: y0 + r() * (y1 - y0), r: 55 + r() * 45, c: r() });
  trees.sort((a, b) => a.y - b.y);
  M.brush.forEach((b, bi) => { for (let i = 0; i < 150; i++) tufts.push({ x: b.x + 10 + r() * (b.w - 20), y: b.y + 26 + r() * (b.h - 30), h: 46 + r() * 34, ph: r() * 6, c: r(), bi }); });
  tufts.sort((a, b) => a.y - b.y);
  GFX.scenery = { grass: tile('#27492f', ['#31593a', '#1f3d27', '#3a6842', '#2c5435'], 260, 5), dirt: tile('#5a503c', ['#6b6048', '#4c4332', '#786c52', '#43392a'], 220, 9),
    forest: tile('#12251a', ['#183022', '#0d1c13'], 120, 3), trees, tufts };
}
function drawGround(M, now, cam, halfW) {
  if (!GFX.scenery) buildScenery(M);
  const S = GFX.scenery;
  ctx.save(); ctx.translate(sx(0), sy(0)); ctx.scale(scale, scale);
  const x0 = cam - halfW - 50, wv = halfW * 2 + 100;
  ctx.fillStyle = S.forest; ctx.fillRect(x0, -200, wv, M.h + 400);
  ctx.fillStyle = S.grass; ctx.fillRect(x0, M.top, wv, M.bot - M.top);
  ctx.fillStyle = S.dirt; ctx.fillRect(x0, M.mid - 180, wv, 360);
  for (const [y, d] of [[M.mid - 180, -1], [M.mid + 180, 1]]) {
    const g = ctx.createLinearGradient(0, y, 0, y - d * 46); g.addColorStop(0, 'rgba(39,73,47,.95)'); g.addColorStop(1, 'rgba(39,73,47,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, Math.min(y, y - d * 46), wv, 46);
  }
  for (const [y, d] of [[M.top, 1], [M.bot, -1]]) {
    const g = ctx.createLinearGradient(0, y, 0, y + d * 110); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x0, Math.min(y, y + d * 110), wv, 110);
  }
  // fountains
  for (const t of ['blue', 'red']) {
    const p = M.spawn[t], col = t === 'blue' ? '#4aa3ff' : '#ff5a5a';
    if (Math.abs(p.x - cam) > halfW + M.fountainR) continue;
    ctx.save(); ctx.translate(p.x, p.y);
    ell(0, 0, M.fountainR, M.fountainR, 'rgba(60,66,76,.55)', 'rgba(20,24,30,.8)', 6);
    glow(0, 0, M.fountainR, col, 0.22 + 0.06 * Math.sin(now * 2));
    ctx.globalAlpha = 0.7; ctx.setLineDash([40, 26]); ctx.lineDashOffset = now * 40; ell(0, 0, M.fountainR - 26, M.fountainR - 26, null, col, 5); ctx.setLineDash([]);
    ctx.rotate(now * 0.4); for (let i = 0; i < 6; i++) { ctx.rotate(TAU / 6); poly([150, -16, 190, 0, 150, 16, 162, 0], col); }
    ell(0, 0, 120, 120, null, col, 4); ctx.globalAlpha = 1; ctx.restore();
  }
  // brush
  for (const b of M.brush) { ctx.fillStyle = 'rgba(24,60,32,.85)'; ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 40); ctx.fill(); }
  for (const t of S.tufts) {
    if (Math.abs(t.x - cam) > halfW + 60) continue;
    const sw = Math.sin(now * 1.6 + t.ph) * 9;
    ctx.fillStyle = t.c < 0.33 ? '#2f7a3e' : t.c < 0.66 ? '#3b8f4a' : '#286a36';
    ctx.beginPath(); ctx.moveTo(t.x - 13, t.y); ctx.quadraticCurveTo(t.x - 4 + sw * 0.4, t.y - t.h * 0.6, t.x + sw, t.y - t.h); ctx.quadraticCurveTo(t.x + 6 + sw * 0.4, t.y - t.h * 0.5, t.x + 13, t.y); ctx.fill();
  }
  ctx.restore();
}
function drawTrees(M, now, cam, halfW) {
  ctx.save(); ctx.translate(sx(0), sy(0)); ctx.scale(scale, scale);
  for (const t of GFX.scenery.trees) {
    if (Math.abs(t.x - cam) > halfW + 120) continue;
    const sw = Math.sin(now * 0.9 + t.c * 9) * 4, g = t.c < 0.5 ? '#1c4a2a' : '#235a31';
    ell(t.x + 14, t.y + 18, t.r, t.r * 0.8, 'rgba(0,0,0,.35)');
    ell(t.x + sw, t.y, t.r, t.r, g, '#0c1f13', 4); ell(t.x + sw - t.r * 0.2, t.y - t.r * 0.22, t.r * 0.66, t.r * 0.66, shade(g === '#1c4a2a' ? '#1c4a2a' : '#235a31', 0.12));
    ell(t.x + sw - t.r * 0.32, t.y - t.r * 0.36, t.r * 0.3, t.r * 0.3, 'rgba(120,190,120,.22)');
  }
  ctx.restore();
}

// ---------- bars ----------
function heroBar(u, a, col, isMe) {
  const w = 108, h = 11, x = Math.round(sx(u.x) - w / 2), y = Math.round(sy(u.y) - 92 * scale - h);
  ctx.fillStyle = '#0b0e12'; ctx.fillRect(x - 2, y - 2, w + 4, h + 9);
  ctx.fillStyle = '#f0e0c0'; ctx.fillRect(x, y, w * clamp01(a.hp / u.mhp), h);
  ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp01(u.hp / u.mhp), h);
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x, y, w * clamp01(u.hp / u.mhp), 3);
  if (u.sh) { ctx.fillStyle = '#e8f4ff'; ctx.fillRect(x + w * clamp01(u.hp / u.mhp), y, Math.min(w * u.sh / u.mhp, w - w * clamp01(u.hp / u.mhp)), h); }
  ctx.fillStyle = '#0b0e12'; for (let v = 100; v < u.mhp; v += 100) ctx.fillRect(x + w * v / u.mhp, y, 1, v % 1000 ? h * 0.55 : h);
  ctx.fillStyle = '#4a8fe0'; ctx.fillRect(x, y + h + 1, w * clamp01(u.mp / u.mmp), 4);
  ctx.fillStyle = '#0b0e12'; ctx.beginPath(); ctx.arc(x - 11, y + 8, 11, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(u.lvl, x - 11, y + 12);
  ctx.font = 'bold 12px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = '#000b'; ctx.strokeText(u.n, sx(u.x), y - 6); ctx.fillStyle = isMe ? '#fff' : '#dfe6ea'; ctx.fillText(u.n, sx(u.x), y - 6);
}
function smallBar(u, a, w, h, yOff, col) {
  const x = Math.round(sx(u.x) - w / 2), y = Math.round(sy(u.y) - yOff * scale - h);
  ctx.fillStyle = '#0b0e12'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#f0e0c0'; ctx.fillRect(x, y, w * clamp01(a.hp / u.mhp), h);
  ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp01(u.hp / u.mhp), h);
}

// ---------- events from the server ----------
function gfxEvent(e, now, myId) {
  if (e.e === 'atk') { const a = animGet(e.id); a.atk0 = now + 0.06; a.atkD = Math.max(0.08, e.d); a.side = -a.side; }
  else if (e.e === 'cast') animGet(e.id).cast0 = now + 0.06;
  else if (e.e === 'lvl') { animGet(e.id).lvl0 = now; }
  else if (e.e === 'dmg') {
    if (e.s || e.n > 40) animGet(e.id).flash = now + 0.06;
    const col = e.ty === 'm' ? '#c9a0ff' : e.ty === 't' ? '#ffffff' : '#ffd9a0';
    burstParts(e.x, e.y, e.s ? 7 : 2, { color: col, speed: 220, life: e.s ? 0.3 : 0.2, size: e.s ? 5 : 3.5, glow: !!e.s, alpha: e.s ? 1 : 0.7 });
    if (e.s === myId && e.k !== 'm') floater(e.x, e.y, e.n, '#ffffff', e.n > 150 ? 20 : 15);
    else if (e.s === myId) floater(e.x, e.y, e.n, '#d8d8d8', 11);
    else if (e.id === myId) { floater(e.x, e.y, e.n, '#ff6b6b', e.n > 100 ? 19 : 14); if (e.n > 60) GFX.shake = Math.min(10, GFX.shake + e.n / 30); }
  } else if (e.e === 'die') {
    const col = e.t === 'b' ? '#4aa3ff' : '#ff5a5a';
    if (e.k === 'm') { burstParts(e.x, e.y, 12, { color: col, speed: 170, life: 0.55, size: 9 }); burstParts(e.x, e.y, 6, { color: '#fff', speed: 90, life: 0.4, size: 5, glow: true }); }
    else { burstParts(e.x, e.y, 46, { color: col, speed: 420, life: 1, size: 12, glow: true }); burstParts(e.x, e.y, 30, { color: '#ffffff', speed: 260, life: 0.8, size: 8, glow: true }); GFX.shake = 12; }
  } else if (e.e === 'burst') {
    burstParts(e.x, e.y, Math.round(e.r / 9), { color: e.c || '#fff', speed: 160, life: 0.5, size: 8, glow: true, ring: e.r * 0.85 });
    burstParts(e.x, e.y, Math.round(e.r / 14), { color: '#ffffff', speed: e.r * 1.6, life: 0.35, size: 6, glow: true });
  } else if (e.e === 'blink') burstParts(e.x, e.y, 22, { color: '#bfe6ff', speed: 260, life: 0.45, size: 7, glow: true });
  else if (e.e === 'gold') { floater(e.x, e.y - 20, '+' + e.n + 'g', '#ffd24a', 15); burstParts(e.x, e.y, 6, { color: '#ffd24a', speed: 120, life: 0.5, size: 5, glow: true, vy: -80 }); }
}
function gfxCleanup(now) {
  for (const [id, a] of GFX.anim) if (now - a.seen > 3 && a.seen) GFX.anim.delete(id);
  for (const [id, t] of GFX.trails) if (now - t.seen > 0.2) GFX.trails.delete(id);
}
