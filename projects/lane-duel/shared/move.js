// Walking and unit collision, shared by the server (game/sim.js) and the browser's movement prediction
// (public/predict.js) so both move a unit in exactly the same way. Pure functions.
//
// The rules:
//   - Collision is resolved while a unit moves, and only ever changes that unit's own step. Nothing is
//     pushed: a unit that is standing still is never moved by something walking into it.
//   - A step that would enter another unit's circle loses the part that points into the circle and keeps
//     the part that runs along its edge. Blocked from two sides, the unit stops for that tick.
//   - Before stepping, the unit looks a short way ahead along its path. If something is in the way it aims
//     for the edge of it instead, on whichever side is the shorter way round, and keeps to that side for a
//     moment so it does not wobble. Units packed too tightly to pass between count as one obstacle.
//   - A unit never moves further in a tick than its speed allows.
//   - If a unit already overlaps another (it blinked in, say), that pair is ignored until they separate.
//
//   - Two units walking at each other must not both swerve, or they chase each other sideways. So a blocker
//     can be marked `walking`: the mover still slides along it, but does not steer around it. The server
//     marks walking heroes that way for minions, which leaves the steering to the hero.
//
// A blocker is { x, y, r, walking? }, where r is the mover's collision radius plus the other unit's.

const OVERLAP = 1;          // a mover this far inside a blocker's circle counts as already overlapping it
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Move `u` ({ x, y, face, detour }, changed in place) up to `dist` toward `to`.
// o = { now, look, keep, margin, odd }: look = how far ahead to check; keep = seconds to stay on the chosen
// side; margin = extra angle to clear an edge by; odd = which side to prefer when it is a dead heat.
// Returns { arrived, blocked }.
export function step(u, to, dist, blockers, o) {
  const dx = to.x - u.x, dy = to.y - u.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return { arrived: true, blocked: false };
  const aim = Math.atan2(dy, dx);
  // Blockers the mover is already inside are ignored until it is clear of them.
  const live = blockers.filter(b => Math.hypot(u.x - b.x, u.y - b.y) >= b.r - OVERLAP);

  // --- steer: is anything on the straight line ahead?
  let heading = aim, steered = false;
  const reach = Math.min(o.look, d), ux = dx / d, uy = dy / d;
  let first = null, firstAlong = Infinity;
  for (const b of live) {
    if (b.walking) continue;
    const rx = b.x - u.x, ry = b.y - u.y, along = rx * ux + ry * uy, off = Math.abs(rx * uy - ry * ux);
    if (off >= b.r || along <= 0) continue;
    const enter = along - Math.sqrt(b.r * b.r - off * off);        // where the path first touches this circle
    if (enter < reach && enter < firstAlong) { first = b; firstAlong = enter; }
  }
  if (first) {
    // Everything packed against it with no gap the mover could fit through is one obstacle.
    const blob = [first];
    for (let i = 0; i < blob.length; i++) for (const b of live) {
      if (!b.walking && !blob.includes(b) && Math.hypot(b.x - blob[i].x, b.y - blob[i].y) < b.r + blob[i].r) blob.push(b);
    }
    // The obstacle's left and right edges as seen from the mover, as angles away from the straight line.
    let left = -Infinity, right = Infinity;
    for (const b of blob) {
      const dc = Math.hypot(b.x - u.x, b.y - u.y), mid = wrap(Math.atan2(b.y - u.y, b.x - u.x) - aim), half = Math.asin(Math.min(1, b.r / dc)) + o.margin;
      left = Math.max(left, mid + half); right = Math.min(right, mid - half);
    }
    if (!u.detour || o.now >= u.detour.until) u.detour = { side: Math.abs(left - -right) < 1e-9 ? (o.odd ? 1 : -1) : left < -right ? 1 : -1, until: 0 };
    u.detour.until = o.now + o.keep;
    heading = aim + Math.max(-2, Math.min(2, u.detour.side > 0 ? left : right));
    steered = true;
  }

  // --- step, sliding along anything it would enter
  const len = steered ? dist : Math.min(dist, d);
  let vx = Math.cos(heading) * len, vy = Math.sin(heading) * len, blocked = false;
  const hit = () => live.find(b => Math.hypot(u.x + vx - b.x, u.y + vy - b.y) < b.r - 1e-6);
  for (let pass = 0; pass < 2; pass++) {
    const b = hit(); if (!b) break;
    blocked = true;
    const dc = Math.hypot(u.x - b.x, u.y - b.y) || 1, nx = (u.x - b.x) / dc, ny = (u.y - b.y) / dc, into = vx * nx + vy * ny;
    if (into < 0) { vx -= into * nx; vy -= into * ny; }             // drop the part of the step that points into the circle
    else { vx = 0; vy = 0; }
  }
  if (hit()) { vx = 0; vy = 0; }                                    // boxed in from two sides: wait
  const moved = Math.hypot(vx, vy);
  u.x += vx; u.y += vy;
  if (moved > 0.5) u.face = Math.atan2(vy, vx); else if (d > 0.5) u.face = aim;

  if (!steered && !blocked && d <= dist) { u.x = to.x; u.y = to.y; return { arrived: true, blocked: false }; }
  // A target inside something solid can never be reached: stop once as close as the obstacle allows.
  if (blocked && blockers.some(b => Math.hypot(to.x - b.x, to.y - b.y) < b.r && Math.hypot(u.x - b.x, u.y - b.y) < b.r + dist + 2)) return { arrived: true, blocked: true };
  return { arrived: false, blocked };
}

// Keep a point inside the lane. map is the server's MAP.
export function clamp(u, map) {
  u.x = Math.max(map.edge, Math.min(map.w - map.edge, u.x)); u.y = Math.max(map.top + 30, Math.min(map.bot - 30, u.y));
}

// A unit has landed on top of others (blink, dash end, respawn, a ghost effect ending). Returns the nearest
// spot within `far` where it fits, or null if it already fits or nowhere does. Nothing else is moved.
export function freeSpot(u, blockers, far, map) {
  const fits = (x, y) => blockers.every(b => Math.hypot(x - b.x, y - b.y) >= b.r);
  if (fits(u.x, u.y)) return null;
  for (let rad = 6; rad <= far; rad += 6) for (let k = 0; k < 24; k++) {
    const an = k * Math.PI / 12, p = { x: u.x + Math.cos(an) * rad, y: u.y + Math.sin(an) * rad }, q = { ...p };
    clamp(q, map);
    if (q.x === p.x && q.y === p.y && fits(p.x, p.y)) return p;
  }
  return null;
}
