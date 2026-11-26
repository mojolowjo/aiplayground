// Draws a battle on a canvas: arena, towers, units, shots, spells and effects, in a chunky pixel style.
// The canvas is 18 x 32 tiles at 32 pixels a tile and is scaled up by CSS with pixelated scaling.
import { DEF, MT, W, H, LANES_X, ownY, laneOf, clampDrop } from '/shared/sim.js';
import { ALL_CARDS, BODY, ARENA } from '/shared/cards.js';
import { sprite } from './sprites.js';

export const TILE = 32;
export const CW = 18 * TILE, CH = 32 * TILE;
export const TEAM = ['#3a8cff', '#ff4646'];
const SCALE = { tiny: 4, small: 4, mid: 5, big: 5, huge: 5 };
const px = v => v * TILE / MT;

// Per-arena colours: each arena gets its own ground and water so you can tell where you are.
export const THEMES = {
  1: { a: '#5aa83c', b: '#4e9a34', water: '#3a7ad0', wave: '#7ab8f0', bridge: '#9a6a3a' },
  2: { a: '#7ab04a', b: '#6aa040', water: '#3a80c8', wave: '#8ac0f0', bridge: '#8a5a30' },
  3: { a: '#8a9a5a', b: '#7a8a4e', water: '#3a6aa0', wave: '#7aa0d0', bridge: '#6a4a2a' },
  4: { a: '#d8a850', b: '#c89840', water: '#c85a2a', wave: '#f0a060', bridge: '#8a4a20' },   // burgers and fries
  5: { a: '#4ab0a0', b: '#40a094', water: '#2050b0', wave: '#60a0ff', bridge: '#e8d8a8' },
  6: { a: '#8a7a6a', b: '#7a6a5c', water: '#5a5a66', wave: '#a0a0aa', bridge: '#c07840' },
  7: { a: '#6a5a9a', b: '#5e4e8e', water: '#2a2a5a', wave: '#6a6ab0', bridge: '#a08a60' },
  8: { a: '#e8e0d0', b: '#3a3a40', water: '#5a6a8a', wave: '#a0b0d0', bridge: '#8a6a4a', chess: true },
  9: { a: '#7a5a8a', b: '#6a8a5a', water: '#a03a8a', wave: '#f080e0', bridge: '#d0b040' },
  10: { a: '#0a2a14', b: '#0e3018', water: '#003a10', wave: '#30f070', bridge: '#205a30', matrix: true },
};

export class Renderer {
  constructor(canvas) {
    this.c = canvas; canvas.width = CW; canvas.height = CH;
    this.g = canvas.getContext('2d'); this.g.imageSmoothingEnabled = false;
    this.fx = []; this.flash = new Map(); this.prev = new Map(); this.cur = new Map();
    this.theme = THEMES[1]; this.flip = false; this.mySide = 0;
    this.bg = null;
  }
  setArena(n) { this.theme = THEMES[n] || THEMES[1]; this.bg = null; }
  setSide(side) { this.mySide = side; this.flip = side === 1; this.bg = null; }

  // Screen position (canvas pixels) of a game point, and back.
  sx(x) { return px(this.flip ? W - x : x); }
  sy(y) { return px(this.flip ? H - y : y); }
  toGame(cx, cy) { const x = cx * MT / TILE, y = cy * MT / TILE; return this.flip ? [W - x, H - y] : [x, y]; }

  // Remember positions after each tick so frames in between can glide.
  afterTick(b) {
    this.prev = this.cur; this.cur = new Map();
    for (const u of b.s.units) this.cur.set(u.id, [u.x, u.y]);
  }
  pos(u, alpha) {
    const p = this.prev.get(u.id);
    if (!p) return [u.x, u.y];
    return [p[0] + (u.x - p[0]) * alpha, p[1] + (u.y - p[1]) * alpha];
  }

  events(b, evs) {
    const now = performance.now();
    for (const e of evs) {
      if (e.e === 'hurt') this.flash.set(e.id, now + 90);
      else if (e.e === 'attack') { this.fired = this.fired || new Map(); this.fired.set(e.id, now + 140); }
      else if (e.e === 'spell') this.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t: now, d: 450, c: e.card === 'frost' ? '#bff' : e.card === 'gust' ? '#fff' : '#ffb040' });
      else if (e.e === 'splash') this.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t: now, d: 250, c: '#ff8030' });
      else if (e.e === 'root') this.fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t: now, d: 600, c: '#6a4' });
      else if (e.e === 'zap') this.fx.push({ k: 'zap', ...e, t: now, d: 180 });
      else if (e.e === 'die') this.fx.push({ k: 'puff', x: e.x, y: e.y, t: now, d: e.kind === 'tower' ? 900 : 350, big: e.kind === 'tower' });
      else if (e.e === 'spawn') this.fx.push({ k: 'drop', x: e.x, y: e.y, t: now, d: 300, c: TEAM[e.side] });
    }
  }

  drawGround() {
    const g = document.createElement('canvas'); g.width = CW; g.height = CH;
    const x = g.getContext('2d'), th = this.theme;
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 18; tx++) {
      x.fillStyle = (tx + ty) % 2 ? th.a : th.b;
      if (th.chess) x.fillStyle = (tx + ty) % 2 ? '#d8d0c0' : '#8a8478';
      x.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      if (!th.chess && (tx * 7 + ty * 13) % 11 === 0) { x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(tx * TILE + 8, ty * TILE + 12, 4, 4); x.fillRect(tx * TILE + 20, ty * TILE + 20, 4, 4); }
      if (th.matrix && (tx * 5 + ty * 3) % 4 === 0) { x.fillStyle = 'rgba(60,255,120,0.18)'; x.fillRect(tx * TILE + 12, ty * TILE, 4, TILE); }
    }
    // Lane paths: lighter dirt under each lane.
    x.fillStyle = 'rgba(0,0,0,0.08)';
    for (const lx of LANES_X) x.fillRect(px(lx) - TILE * 0.75, TILE * 6, TILE * 1.5, TILE * 20);
    // River and bridges.
    const ry = ARENA.riverTop * TILE, rh = (ARENA.riverBottom - ARENA.riverTop) * TILE;
    x.fillStyle = th.water; x.fillRect(0, ry, CW, rh);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(0, ry, CW, 4); x.fillRect(0, ry + rh - 4, CW, 4);
    for (const lx of LANES_X) {
      const bx = px(lx) - ARENA.bridgeHalf * TILE;
      x.fillStyle = th.bridge; x.fillRect(bx, ry - 8, ARENA.bridgeHalf * 2 * TILE, rh + 16);
      x.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < rh + 16; i += 12) x.fillRect(bx, ry - 8 + i, ARENA.bridgeHalf * 2 * TILE, 3);
      x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(bx - 4, ry - 8, 4, rh + 16); x.fillRect(bx + ARENA.bridgeHalf * 2 * TILE, ry - 8, 4, rh + 16);
    }
    // Centre line marks.
    x.fillStyle = 'rgba(255,255,255,0.15)';
    for (let i = 0; i < 18; i += 2) { x.fillRect(i * TILE + 8, ry - 20, 16, 4); x.fillRect(i * TILE + 8, ry + rh + 16, 16, 4); }
    this.bg = g;
  }

  // view: { alpha, ghost: { card, x, y, ok } , me, battle, debug }
  draw(b, view = {}) {
    const g = this.g, s = b.s, alpha = view.alpha ?? 1, now = performance.now();
    this.towerLv = s.players.map(p => p.towerLevel || 1);
    if (!this.bg) this.drawGround();
    g.drawImage(this.bg, 0, 0);
    // River shimmer.
    const ry = ARENA.riverTop * TILE;
    g.fillStyle = this.theme.wave;
    for (let i = 0; i < 9; i++) { const off = ((now / 40) + i * 64) % CW; g.fillRect(off, ry + 18 + (i % 3) * 14, 16, 4); }

    // Deploy-zone shading while a card is held.
    if (view.ghost && DEF[view.ghost.card]?.type !== 'spell') this.drawZone(b, view.me);

    // Puddles.
    for (const z of s.zones) { g.fillStyle = 'rgba(40,70,20,0.55)'; this.ellipse(this.sx(z.x), this.sy(z.y), px(z.r), px(z.r) * 0.6); }

    // Units, back to front.
    const units = s.units.slice().sort((a, b2) => this.sy(a.y) - this.sy(b2.y) || (a.air - b2.air));
    for (const u of units) if (!u.air) this.drawUnit(u, alpha, now, view.me);
    for (const sh of s.shots) this.drawShot(sh);
    for (const u of units) if (u.air) this.drawUnit(u, alpha, now, view.me);

    // Spells in flight.
    for (const sp of s.spells) this.drawSpell(sp);

    // Effects.
    this.fx = this.fx.filter(f => now - f.t < f.d);
    for (const f of this.fx) this.drawFx(f, (now - f.t) / f.d);

    if (view.ghost) this.drawGhost(b, view.ghost, view.me);
  }

  ellipse(x, y, rx, ry) { const g = this.g; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }

  drawZone(b, me) {
    // Shade every tile where this side cannot drop a troop.
    const g = this.g; g.fillStyle = 'rgba(200,0,0,0.22)';
    const opened = b.s.players[me].opened;
    for (let ty = 0; ty < 32; ty++) for (let lane = 0; lane < 2; lane++) {
      const cy = (ty + 0.5) * MT, oyv = ownY(me, this.flip ? H - cy : cy);
      const min = opened[lane] ? (ARENA.riverTop - ARENA.zonePush) * MT : ARENA.riverBottom * MT;
      if (oyv < min) g.fillRect(lane ? CW / 2 : 0, ty * TILE, CW / 2, TILE);
    }
  }

  drawTower(u, now) {
    const g = this.g, x = this.sx(u.x), y = this.sy(u.y), r = px(u.r), team = TEAM[u.side];
    const keep = u.type === 'keep';
    const w = r * 2, h = r * 2;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - r + 6, y - r + 10, w, h);
    g.fillStyle = '#7a7a86'; g.fillRect(x - r, y - r, w, h);
    g.fillStyle = '#9a9aa8'; g.fillRect(x - r + 6, y - r + 6, w - 12, h - 12);
    g.fillStyle = '#5a5a66';
    for (let i = 0; i < w; i += 16) g.fillRect(x - r + i, y - r - 8, 10, 10);         // battlements
    for (let i = 8; i < h - 8; i += 16) { g.fillRect(x - r + 10, y - r + i, 8, 4); g.fillRect(x + r - 18, y - r + i + 8, 8, 4); }
    g.fillStyle = team; g.fillRect(x - r + 10, y - r + 10, w - 20, keep ? 20 : 14);   // banner stripe
    // Flag.
    g.fillStyle = '#3a3a3a'; g.fillRect(x - 2, y - r - 34, 4, 30);
    const wave = Math.floor(now / 200) % 2;
    g.fillStyle = team; g.fillRect(x + 2, y - r - 34 + wave * 2, keep ? 22 : 16, 12);
    if (keep && !u.awake) { g.fillStyle = '#fff'; g.font = 'bold 18px monospace'; g.fillText('z', x + r - 18, y - r + 4 - (Math.floor(now / 400) % 2) * 4); }
    // Cannon/window.
    g.fillStyle = '#2a2a34'; g.fillRect(x - 8, y + 4, 16, 12);
    const top = y < CH / 2;                                       // towers at the top of the screen show their bar underneath
    const by = top ? y + r + 22 : y - r - 46, bw = keep ? 96 : 76;
    this.hpBar(x, by, bw, u.hp, u.maxHp, team, true);
    this.lvBadge(x - bw / 2 - 14, by + 3, this.towerLv?.[u.side] || 1, team, 13);
  }

  // A small square with the level number, at the left end of a health bar.
  lvBadge(x, y, lvl, team, size = 11) {
    const g = this.g, h = size;
    g.fillStyle = '#111'; g.fillRect(x - h / 2 - 2, y - h / 2 - 2, h + 4, h + 4);
    g.fillStyle = team; g.fillRect(x - h / 2, y - h / 2, h, h);
    g.fillStyle = '#fff'; g.font = `bold ${h - 1}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(lvl), x, y + 1);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }

  hpBar(x, y, w, hp, max, team, always) {
    if (!always && hp >= max) return;
    const g = this.g;
    g.fillStyle = '#111'; g.fillRect(x - w / 2 - 2, y - 2, w + 4, 10);
    g.fillStyle = '#444'; g.fillRect(x - w / 2, y, w, 6);
    g.fillStyle = team; g.fillRect(x - w / 2, y, Math.max(0, Math.round(w * hp / max)), 6);
    if (always) { g.fillStyle = '#fff'; g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.fillText(String(Math.max(0, hp)), x, y - 6); g.textAlign = 'left'; }
  }

  drawUnit(u, alpha, now, me) {
    if (u.kind === 'tower') return this.drawTower(u, now);
    if (u.hidden && u.side !== me) return;                      // an invisible Shade Duelist: you cannot see theirs
    const g = this.g, [gx, gy] = this.pos(u, alpha), x = this.sx(gx), y = this.sy(gy);
    const d = DEF[u.card], body = ALL_CARDS[u.card]?.body || 'small';
    const sc = SCALE[body] || 2;
    const spr = sprite(u.card, TEAM[u.side], sc);
    const bob = u.air ? Math.round(Math.sin(now / 160 + u.id) * 3) - 18 : 0;
    // Shadow.
    g.fillStyle = 'rgba(0,0,0,0.28)'; this.ellipse(x, y + spr.height / 2 - 6 + (u.air ? 8 : 0), spr.width / 2.6, 5);
    g.save();
    if (u.deploy > 0) g.globalAlpha = 0.45;
    if (u.hidden) g.globalAlpha = 0.35;
    // Flip sprite to face the way it walks (enemy side faces down; we draw everyone upright).
    g.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2 + bob));
    const fl = this.flash.get(u.id);
    if (fl && fl > now) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6; g.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2 + bob)); }
    g.restore();
    if (u.frozen > 0) { g.fillStyle = 'rgba(160,230,255,0.55)'; g.fillRect(x - spr.width / 2, y - spr.height / 2 + bob, spr.width, spr.height); }
    if (u.stun > 0) { g.fillStyle = '#ffe040'; for (let i = 0; i < 3; i++) g.fillRect(x - 12 + i * 10, y - spr.height / 2 - 8 + bob - (i % 2) * 4, 4, 4); }
    if (u.slow > 0) { g.fillStyle = 'rgba(60,90,30,0.6)'; g.fillRect(x - 10, y + spr.height / 2 - 4, 20, 4); }
    if (u.haste > 0) { g.fillStyle = '#ffd84a'; g.fillRect(x + spr.width / 2 - 6, y - spr.height / 2 + bob, 4, 8); }
    if (u.deploy > 0) {                                          // deploy timer ring
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath();
      g.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - u.deploy / 10)); g.stroke();
    }
    const shot = this.fired && this.fired.get(u.id);
    if (u.kind === 'building' && shot && shot > now) {           // muzzle flash, so a firing building is easy to see
      const fy = u.side === me ? -1 : 1;
      g.fillStyle = '#fff4b0'; g.fillRect(x - 6, y + fy * (spr.height / 2 - 2) - 6, 12, 12);
      g.fillStyle = '#ffb030'; g.fillRect(x - 3, y + fy * (spr.height / 2 - 2) - 3, 6, 6);
    }
    // Health bar (only once hurt) with the unit's level always shown at its left end.
    const bw = u.kind === 'building' ? 40 : Math.max(20, spr.width * 0.8), by = u.kind === 'building' ? y - spr.height / 2 - 10 : y - spr.height / 2 - 8 + bob;
    this.hpBar(x, by, bw, u.hp, u.maxHp, TEAM[u.side], false);
    if (u.lvl && u.deploy <= 0 && !(u.hidden && u.side !== me)) this.lvBadge(x - bw / 2 - 9, by + 3, u.lvl, TEAM[u.side]);
    if (u.shield > 0) { g.fillStyle = '#c8d0d8'; g.fillRect(x - spr.width * 0.4, y - spr.height / 2 - 14 + bob, spr.width * 0.8 * Math.min(1, u.shield / 200), 4); }
  }

  drawShot(sh) {
    const g = this.g, x = this.sx(sh.x), y = this.sy(sh.y);
    const c = sh.card;
    if (c === 'ember') { g.fillStyle = '#ffb030'; g.fillRect(x - 6, y - 6, 12, 12); g.fillStyle = '#ff4020'; g.fillRect(x - 3, y - 3, 6, 6); }
    else if (c === 'hermit') { g.fillStyle = '#fff860'; g.fillRect(x - 4, y - 4, 8, 8); }
    else if (c === 'tide') { g.fillStyle = '#80e0ff'; g.fillRect(x - 5, y - 5, 10, 10); }
    else if (c === 'harpoon') { g.fillStyle = '#d0d0d8'; g.fillRect(x - 2, y - 8, 4, 16); }
    else if (c === 'turret') { g.fillStyle = '#2a2a34'; g.fillRect(x - 6, y - 6, 12, 12); g.fillStyle = '#9a9aa6'; g.fillRect(x - 4, y - 4, 8, 8); g.fillStyle = '#c8c8d0'; g.fillRect(x - 3, y - 3, 3, 3); }
    else if (c === 'loft') { g.fillStyle = '#e8d8a8'; g.fillRect(x - 1, y - 7, 3, 14); g.fillStyle = '#c84030'; g.fillRect(x - 2, y - 8, 5, 3); }
    else if (c === 'wyvern') { g.fillStyle = '#c0f8ff'; g.fillRect(x - 5, y - 5, 10, 10); }
    else if (c.startsWith('tower')) { g.fillStyle = TEAM[sh.side]; g.fillRect(x - 4, y - 4, 8, 8); g.fillStyle = '#fff'; g.fillRect(x - 2, y - 2, 4, 4); }
    else { g.fillStyle = '#e8d8b0'; g.fillRect(x - 3, y - 3, 6, 6); }
  }

  drawSpell(sp) {
    const g = this.g, x = this.sx(sp.x), y = this.sy(sp.y), d = DEF[sp.card], r = px(d.radius);
    const t = sp.total ? 1 - sp.left / sp.total : 1;
    if (sp.card === 'meteor') {                                 // the shadow shows where it lands
      g.fillStyle = `rgba(0,0,0,${0.2 + 0.3 * t})`; this.ellipse(x, y, r * (0.4 + 0.6 * t), r * (0.4 + 0.6 * t) * 0.7);
      const mx = x + (1 - t) * 80, my = y - (1 - t) * 420;
      g.fillStyle = '#ff8020'; g.fillRect(mx - 20, my - 20, 40, 40); g.fillStyle = '#7a2a10'; g.fillRect(mx - 12, my - 12, 24, 24);
      return;
    }
    // Others fly from the caster's Keep.
    const fx = this.sx(sp.fx), fy = this.sy(sp.fy);
    const cx = fx + (x - fx) * t, cy = fy + (y - fy) * t - Math.sin(Math.PI * t) * 120;
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    if (sp.card === 'flamejar') { g.fillStyle = '#c88a4c'; g.fillRect(cx - 8, cy - 10, 16, 20); g.fillStyle = '#ff9020'; g.fillRect(cx - 4, cy - 16, 8, 8); }
    if (sp.card === 'shower') { g.fillStyle = '#ffe040'; for (let i = 0; i < 8; i++) g.fillRect(x - r + ((i * 37) % (2 * r)), y - r + ((i * 53 + t * 200) % (2 * r)), 6, 6); }
  }

  drawFx(f, t) {
    const g = this.g, x = this.sx(f.x ?? 0), y = this.sy(f.y ?? 0);
    if (f.k === 'ring') { g.strokeStyle = f.c; g.globalAlpha = 1 - t; g.lineWidth = 6; g.beginPath(); g.arc(x, y, px(f.r) * (0.4 + 0.6 * t), 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
    else if (f.k === 'zap') { g.strokeStyle = '#fff860'; g.lineWidth = 4; g.beginPath(); g.moveTo(this.sx(f.x1), this.sy(f.y1)); const mx = (this.sx(f.x1) + this.sx(f.x2)) / 2 + 10, my = (this.sy(f.y1) + this.sy(f.y2)) / 2 - 10; g.lineTo(mx, my); g.lineTo(this.sx(f.x2), this.sy(f.y2)); g.stroke(); }
    else if (f.k === 'puff') { g.fillStyle = `rgba(230,230,230,${1 - t})`; const n = f.big ? 10 : 5, sp = (f.big ? 70 : 24) * t; for (let i = 0; i < n; i++) { const a = i / n * 6.28; g.fillRect(x + Math.cos(a) * sp - 4, y + Math.sin(a) * sp - 4, f.big ? 14 : 8, f.big ? 14 : 8); } }
    else if (f.k === 'drop') { g.strokeStyle = f.c; g.globalAlpha = 1 - t; g.lineWidth = 4; g.beginPath(); g.arc(x, y, 10 + 30 * t, 0, 6.28); g.stroke(); g.globalAlpha = 1; }
  }

  drawGhost(b, gh, me) {
    const g = this.g, d = DEF[gh.card]; if (!d) return;
    const at = clampDrop(b.s, me, gh.card, gh.x, gh.y); if (!at) return;
    const x = this.sx(at[0]), y = this.sy(at[1]);
    g.save(); g.globalAlpha = 0.6;
    if (d.type === 'spell') {
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(x, y, px(d.radius), 0, 6.28); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke();
    } else {
      const body = ALL_CARDS[gh.card].body; const spr = sprite(gh.card, TEAM[me], SCALE[body] || 2);
      for (const [ox, oy] of d.offsets.slice(0, d.count)) g.drawImage(spr, x + px(ox) * (this.flip ? -1 : 1) - spr.width / 2, y + px(oy) * (me === 0 ? 1 : -1) * (this.flip ? -1 : 1) - spr.height / 2);
      if (d.range > 1.5 * MT) { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, px(d.range + d.r), 0, 6.28); g.stroke(); }
    }
    g.restore();
  }
}
