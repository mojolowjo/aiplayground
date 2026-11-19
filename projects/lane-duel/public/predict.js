'use strict';
// Client-side prediction for the local hero's movement. No drawing and no networking in here, so the
// rules test (test/smoke.js) can run it against the server's own movement code.
//
// The idea: when you give a move order, your hero starts walking on your screen at once instead of after
// the server's reply. The client runs the same movement and minion-collision rules as game/sim.js
// (Game.moveToward and the hero half of Game.separate). Every snapshot is then compared with where the
// client had predicted the hero would be at that moment, and any difference is blended away, or snapped
// if it is large (a stun, pull, blink or death the client could not have known about).
//
// Only movement is predicted. Attacks, abilities and damage still come from the server alone.
const Predict = (() => {
  const CFG = {};   // filled from RULES.predict (game/sim.js) by configure(); the numbers live there
  function configure(rules) { Object.assign(CFG, rules); }

  // mode 'follow': the hero is drawn from snapshots like everything else (attack orders, forced movement).
  // mode 'predict': the hero is drawn from x,y here.
  function create() { return { mode: 'follow', x: 0, y: 0, face: 0, order: null, hist: [], corrX: 0, corrY: 0, corrT: 0, detour: null, lockUntil: 0 }; }

  // A move order was given at time `now`. `from` is where the hero is drawn right now; it is remembered as
  // the starting point, so snapshots from before the order are compared with where the hero stood then.
  function moveTo(p, x, y, from, now) {
    if (p.mode !== 'predict') { p.mode = 'predict'; p.x = from.x; p.y = from.y; p.face = from.f || 0; p.hist = [{ t: now, x: from.x, y: from.y }]; p.corrX = p.corrY = 0; p.detour = null; }
    p.order = { x, y };
  }
  function stop(p) { p.order = null; }                 // Stop or recall: stand still, keep predicting
  function release(p) { p.mode = 'follow'; p.order = null; p.hist = []; p.corrX = p.corrY = 0; }   // hand the hero back to the snapshots

  // Advance the prediction by dt seconds. env = { now, speed, canMove, ghosted, minions: [{x, y}], map, coll }
  // where map is the server's MAP and coll its RULES.collision.
  function step(p, dt, env) {
    if (p.mode !== 'predict') return;
    // Blend in whatever correction the last snapshot asked for, and move the history with it so the same
    // error is not corrected twice.
    if (p.corrX || p.corrY) {
      const k = Math.min(1, dt / Math.max(dt, p.corrT)), dx = p.corrX * k, dy = p.corrY * k;   // an even share, so it is all in after CFG.blend seconds
      p.x += dx; p.y += dy; p.corrX -= dx; p.corrY -= dy; p.corrT -= dt;
      for (const e of p.hist) { e.x += dx; e.y += dy; }
      if (Math.hypot(p.corrX, p.corrY) < 0.05) p.corrX = p.corrY = 0;
    }
    // Game.moveToward
    if (p.order && env.canMove && env.now >= p.lockUntil) {
      const dx = p.order.x - p.x, dy = p.order.y - p.y, d = Math.hypot(dx, dy), s = env.speed * dt;
      if (d > 0.5) p.face = Math.atan2(dy, dx);
      if (d <= s) { p.x = p.order.x; p.y = p.order.y; p.order = null; }
      else { p.x += dx / d * s; p.y += dy / d * s; }
    }
    // The hero half of Game.separate: minions hold their ground and the hero is steered around them.
    const C = env.coll, min = C.hero + C.minion;
    if (!env.ghosted) for (const m of env.minions) {
      let dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 0.01) { dx = 0; dy = env.odd ? 1 : -1; d = 1; }
      if (!p.detour || env.now > p.detour.until) p.detour = { side: Math.abs(dy) > 4 ? Math.sign(dy) : (env.odd ? 1 : -1) };
      p.detour.until = env.now + C.detourFor;
      const over = min - d, nx = dx / d, ny = dy / d;
      let tx = -ny, ty = nx;
      if (Math.abs(ty) > 0.15 ? ty * p.detour.side < 0 : tx * Math.cos(p.face) + ty * Math.sin(p.face) < 0) { tx = -tx; ty = -ty; }
      p.x += nx * over * C.heroShare + tx * over * C.slide; p.y += ny * over * C.heroShare + ty * over * C.slide;
    }
    // Game.clampPos
    const M = env.map;
    p.x = Math.max(M.edge, Math.min(M.w - M.edge, p.x)); p.y = Math.max(M.top + 30, Math.min(M.bot - 30, p.y));
    p.hist.push({ t: env.now, x: p.x, y: p.y });
    while (p.hist.length > 2 && env.now - p.hist[0].t > CFG.history) p.hist.shift();
  }

  // Where the prediction had the hero at time t (between two remembered positions).
  function at(p, t) {
    const h = p.hist; if (!h.length) return { x: p.x, y: p.y };
    if (t <= h[0].t) return h[0];
    for (let i = 1; i < h.length; i++) if (t <= h[i].t) { const a = h[i - 1], b = h[i], k = (t - a.t) / (b.t - a.t || 1); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }
    return h[h.length - 1];
  }

  // A snapshot arrived: the server says the hero is at sx,sy. That is where the hero was one round trip
  // ago in the client's terms, so compare it with the prediction for then. Returns the size of the error.
  function reconcile(p, sx, sy, now, roundTrip) {
    if (p.mode !== 'predict') return 0;
    const was = at(p, now - roundTrip + CFG.tickLead), ex = sx - was.x, ey = sy - was.y, err = Math.hypot(ex, ey);
    if (err > CFG.snap) { p.x = sx; p.y = sy; p.hist = []; p.corrX = p.corrY = 0; p.detour = null; }
    else if (err <= CFG.dead) p.corrX = p.corrY = 0;
    else { p.corrX = ex; p.corrY = ey; p.corrT = CFG.blend; }
    return err;
  }

  return { CFG, configure, create, moveTo, stop, release, step, reconcile, at };
})();
