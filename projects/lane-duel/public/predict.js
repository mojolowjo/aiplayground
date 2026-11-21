'use strict';
// Client-side prediction for the local hero's movement. No drawing and no networking in here, so the
// rules test (test/smoke.js) can run it against the server's own movement code.
//
// The idea: when you give a move order, your hero starts walking on your screen at once instead of after
// the server's reply. The client takes the very same walking step as the server: both call Move.step in
// shared/move.js (loaded before this file as the global `Move`). Every snapshot is then compared with where the
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
    // The same walking step the server takes (shared/move.js): steer around minions, slide along their edges.
    if (p.order && env.canMove && env.now >= p.lockUntil) {
      const C = env.coll, blockers = env.ghosted ? [] : env.minions.filter(m => !m.gh).map(m => ({ x: m.x, y: m.y, r: C.hero + C.minion }));
      const res = Move.step(p, p.order, env.speed * dt, blockers, { now: env.now, look: C.look, keep: C.keepSide, margin: C.margin, odd: env.odd });
      if (res.arrived) p.order = null;
    }
    Move.clamp(p, env.map);
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
