'use strict';
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
const TEAM = { b: '#4aa3ff', r: '#ff5a5a' };
let ws, hello = null, myId = 0, lobbyState = null, inGame = false;
let snaps = [], offset = null, me = null, meUnit = null, myDef = null;
let cam = { x: 0, locked: true }, mouse = { x: 0, y: 0, wx: 0, wy: 0, rdown: false, lastMove: 0 };
let pendingA = false, shopOpen = false, fx = [], ping = 0, W = 0, H = 0, scale = 1;

function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; scale = H / 1500; }
addEventListener('resize', resize); resize();

// ---------- networking ----------
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.onopen = () => {
    const room = new URLSearchParams(location.search).get('room') || 'main';
    $('name').value = localStorage.ldName || 'Player';
    send({ t: 'join', room, name: $('name').value });
    setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'snap') return onSnap(m);
    if (m.t === 'pong') ping = Math.round(performance.now() - m.c);
    else if (m.t === 'hello') { hello = m; myId = m.id; $('rk').textContent = m.rules.kills; $('rc').textContent = m.rules.cs; buildHeroes(); }
    else if (m.t === 'lobby') { lobbyState = m; inGame = m.inGame; if (!inGame) { snaps = []; offset = null; } renderLobby(); }
    else if (m.t === 'full') $('status').textContent = 'This room already has two players.';
    else if (m.t === 'left') feed('The other player left.');
  };
  ws.onclose = () => { $('status').textContent = 'Disconnected — reload the page.'; $('lobby').style.display = 'block'; };
}
const send = m => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
const cmd = m => send({ t: 'cmd', ...m });

// ---------- lobby ----------
function buildHeroes() {
  $('heroes').innerHTML = '';
  for (const [k, h] of Object.entries(hello.heroes)) {
    const d = document.createElement('div'); d.className = 'hero'; d.dataset.k = k;
    d.innerHTML = `<b style="color:${h.color}">${h.name}</b> — ${h.role}<small>${h.abilities.map(a => a.name).join(' · ')}</small>`;
    d.onclick = () => send({ t: 'pick', hero: k });
    $('heroes').appendChild(d);
  }
}
function renderLobby() {
  const ps = lobbyState.players, mine = ps.find(p => p.id === myId);
  $('lobby').style.display = inGame ? 'none' : 'block';
  for (const id of ['hud', 'top']) $(id).style.display = inGame ? 'block' : 'none';
  if (!inGame) { $('over').style.display = 'none'; $('shop').style.display = 'none'; shopOpen = false; }
  $('players').innerHTML = ps.map(p => `<div class="${p.team}">${p.team.toUpperCase()}: ${esc(p.name)}${p.id === myId ? ' (you)' : ''} — ${p.hero ? hello.heroes[p.hero].name : 'choosing…'}</div>`).join('');
  document.querySelectorAll('.hero').forEach(d => d.classList.toggle('sel', mine && d.dataset.k === mine.hero));
  const ready = ps.every(p => p.hero);
  $('start').disabled = !ready;
  $('start').textContent = ps.length === 1 ? 'Practice vs dummy' : 'Start';
  $('hint').textContent = ps.length === 1 ? 'Waiting for a second player — send them this page\'s link.' : ready ? '' : 'Both players must pick.';
  if (inGame && mine) { myDef = hello.heroes[mine.hero]; buildSlots(); buildShop(); cam.locked = true; cam.x = hello.map.spawn[mine.team].x; }
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('start').onclick = () => send({ t: 'start' });
$('rematch').onclick = () => send({ t: 'rematch' });
$('name').onchange = () => { localStorage.ldName = $('name').value; };

// ---------- HUD ----------
let slotEls = [];
function buildSlots() {
  const el = $('slots'); el.innerHTML = ''; slotEls = [];
  const defs = [...myDef.abilities.map((a, i) => ({ ...a, i })), { ...hello.spells.d, sp: 'd' }, { ...hello.spells.f, sp: 'f' }];
  for (const a of defs) {
    const d = document.createElement('div'); d.className = 'slot' + (a.sp ? ' small' : '');
    d.innerHTML = `<span class="k">${a.key}</span><div class="cd"></div><div class="pips"></div>`;
    d.onmouseenter = () => { const t = $('tip'); t.style.display = 'block';
      const cds = Array.isArray(a.cd) ? a.cd.join('/') : a.cd;
      t.innerHTML = `<b>${a.name}</b> (${a.key})<br>${a.desc}<br><small style="color:#9fb2bf">Cooldown ${cds}s${a.cost ? ' · Mana ' + a.cost.join('/') : ''}${a.range ? ' · Range ' + a.range : ''}</small>`;
      const r = d.getBoundingClientRect(); t.style.left = r.left + 'px'; t.style.bottom = (innerHeight - r.top + 8) + 'px'; };
    d.onmouseleave = () => { $('tip').style.display = 'none'; };
    if (!a.sp) d.onclick = () => cmd({ c: 'lvl', s: a.i });
    el.appendChild(d); slotEls.push({ d, a });
  }
  const s = document.createElement('div'); s.id = 'stats'; el.appendChild(s);
}
function buildShop() {
  $('items').innerHTML = '';
  for (const it of hello.items) {
    const d = document.createElement('div'); d.className = 'item'; d.dataset.id = it.id;
    d.innerHTML = `<span>${it.name}<small>${it.desc}</small></span><b style="color:#ffd24a">${it.cost}</b>`;
    d.onclick = () => cmd({ c: 'buy', item: it.id });
    $('items').appendChild(d);
  }
}
function setBar(id, v, m, text) { const b = $(id); b.firstChild.style.width = (m ? 100 * v / m : 0) + '%'; if (text && b.children[1]) b.children[1].textContent = `${Math.max(0, v)} / ${m}`; }
function updateHud() {
  if (!me || !meUnit) return;
  setBar('hpb', meUnit.hp, meUnit.mhp, true); setBar('mpb', meUnit.mp, meUnit.mmp, true); setBar('xpb', me.xp, me.xpn);
  for (const { d, a } of slotEls) {
    const cd = a.sp ? (a.sp === 'd' ? me.sd : me.sf) : me.cds[a.i], rank = a.sp ? 1 : me.ranks[a.i];
    d.children[1].textContent = cd > 0 ? (cd < 10 && !a.sp ? cd.toFixed(1) : Math.ceil(cd)) : '';
    d.classList.toggle('off', rank === 0 || cd > 0);
    if (!a.sp) {
      const cost = a.cost[Math.min(Math.max(rank - 1, 0), a.cost.length - 1)];
      d.classList.toggle('nomana', rank > 0 && meUnit.mp < cost);
      const max = a.i === 3 ? (meUnit.lvl >= 16 ? 3 : meUnit.lvl >= 11 ? 2 : meUnit.lvl >= 6 ? 1 : 0) : Math.min(5, Math.ceil(meUnit.lvl / 2));
      d.classList.toggle('up', me.pts > 0 && rank < max);
      d.children[2].textContent = '●'.repeat(rank);
    }
  }
  $('stats').innerHTML = `Lv ${meUnit.lvl} · <b style="color:#ffd24a">${me.gold}g</b><br>AD ${me.ad} · AP ${me.ap} · AS ${me.as}<br>Armor ${me.ar} · MR ${me.mr} · MS ${me.ms}`;
  const cur = snaps[snaps.length - 1], hs = cur.units.filter(u => u.k === 'h');
  const sc = t => { const h = hs.find(u => u.t === t); return h ? `<span style="color:${TEAM[t]}">${esc(h.n)} ${h.kl}K ${h.cs}CS</span>` : `<span style="color:${TEAM[t]}">?</span>`; };
  const tm = cur.time | 0;
  $('top').innerHTML = `${sc('b')} &nbsp; ${tm / 60 | 0}:${String(tm % 60).padStart(2, '0')} &nbsp; ${sc('r')} &nbsp; <small style="color:#8a9aa5">${ping}ms</small>`;
  $('shop').style.display = shopOpen ? 'block' : 'none';
  if (shopOpen) {
    document.querySelectorAll('.item').forEach(d => { const it = hello.items.find(i => i.id === d.dataset.id); d.classList.toggle('no', !me.shop || me.gold < it.cost); });
    $('inv').textContent = 'Items: ' + (me.items.map(i => hello.items.find(x => x.id === i).name).join(', ') || 'none') + (me.shop ? '' : ' — return to base to buy');
  }
}
function feed(text) {
  const d = document.createElement('div'); d.textContent = text; $('feed').appendChild(d); setTimeout(() => d.remove(), 6000);
}

// ---------- snapshots ----------
function onSnap(s) {
  const now = performance.now() / 1000, o = s.time - now;
  offset = offset === null || Math.abs(o - offset) > 0.5 ? o : offset + (o - offset) * 0.05;
  snaps.push(s); if (snaps.length > 20) snaps.shift();
  me = s.me; meUnit = s.units.find(u => u.id === (me && me.id));
  for (const e of s.ev) {
    if (e.e === 'gold') fx.push({ k: 'text', x: e.x, y: e.y, s: '+' + e.n, t0: now, dur: 1 });
    else if (e.e === 'burst') fx.push({ k: 'burst', x: e.x, y: e.y, r: e.r, c: e.c, t0: now, dur: 0.3 });
    else if (e.e === 'blink') fx.push({ k: 'burst', x: e.x, y: e.y, r: 70, c: '#ffffff', t0: now, dur: 0.25 });
    else if (e.e === 'kill') feed(`${e.k} killed ${e.v}`);
  }
  if (s.over && $('over').style.display !== 'block') {
    const won = hello.team === s.over.winner;
    $('ot').textContent = won ? 'Victory' : 'Defeat'; $('ot').style.color = won ? '#ffd24a' : '#ff6b6b';
    $('or').textContent = `${s.over.winner.toUpperCase()} wins — ${s.over.reason}`; $('over').style.display = 'block';
  }
}
function interp() {
  if (!snaps.length) return null;
  const rt = performance.now() / 1000 + offset - 0.06;
  let b = snaps.length - 1; while (b > 0 && snaps[b - 1].time > rt) b--;
  const B = snaps[b], A = snaps[b - 1] || B, k = B.time > A.time ? Math.max(0, Math.min(1, (rt - A.time) / (B.time - A.time))) : 1;
  const lerp = (la, lb) => { const m = new Map(la.map(u => [u.id, u]));
    return lb.map(u => { const a = m.get(u.id); return a && Math.abs(a.x - u.x) + Math.abs(a.y - u.y) < 400 ? { ...u, x: a.x + (u.x - a.x) * k, y: a.y + (u.y - a.y) * k } : u; }); };
  return { units: lerp(A.units, B.units), shots: lerp(A.shots, B.shots), zones: B.zones };
}

// ---------- input ----------
const toWorld = (sx, sy) => [(sx - W / 2) / scale + cam.x, (sy - H / 2) / scale + hello.map.h / 2];
function unitAt(wx, wy, heroOnly) {
  const cur = snaps[snaps.length - 1]; if (!cur) return null;
  let best = null, bd = 1e9;
  for (const u of cur.units) {
    if (u.t === hello.team[0] || u.d || (heroOnly && u.k !== 'h')) continue;
    const r = u.k === 't' ? 90 : u.k === 'h' ? 55 : 32, d = Math.hypot(u.x - wx, u.y - wy);
    if (d <= r + (heroOnly ? 180 : 25) && d < bd) { bd = d; best = u; }
  }
  return best;
}
function rightClick(shift) {
  const [x, y] = [mouse.wx, mouse.wy], u = unitAt(x, y);
  if (u) cmd({ c: 'atk', id: u.id }); else cmd({ c: shift ? 'amove' : 'move', x, y });
  fx.push({ k: 'click', x, y, c: u || shift ? '#ff5a5a' : '#6fe08a', t0: performance.now() / 1000, dur: 0.35 });
  mouse.lastMove = performance.now();
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (mouse.rdown && inGame && performance.now() - mouse.lastMove > 120) { [mouse.wx, mouse.wy] = toWorld(mouse.x, mouse.y); rightClick(e.shiftKey); }
});
cv.addEventListener('mousedown', e => {
  if (!inGame || !hello) return;
  [mouse.wx, mouse.wy] = toWorld(e.clientX, e.clientY);
  if (e.button === 2) { mouse.rdown = true; pendingA = false; rightClick(e.shiftKey); }
  else if (e.button === 0 && pendingA) {
    pendingA = false; const u = unitAt(mouse.wx, mouse.wy);
    if (u) cmd({ c: 'atk', id: u.id }); else cmd({ c: 'amove', x: mouse.wx, y: mouse.wy });
    fx.push({ k: 'click', x: mouse.wx, y: mouse.wy, c: '#ff5a5a', t0: performance.now() / 1000, dur: 0.35 });
  }
});
addEventListener('mouseup', e => { if (e.button === 2) mouse.rdown = false; });
addEventListener('keydown', e => {
  if (!inGame || !hello || e.target.tagName === 'INPUT' || e.repeat) return;
  const k = e.code, qi = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(k);
  [mouse.wx, mouse.wy] = toWorld(mouse.x, mouse.y);
  if (qi >= 0) {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (e.shiftKey) return cmd({ c: 'lvl', s: qi });
    const t = unitAt(mouse.wx, mouse.wy, true);
    cmd({ c: 'cast', s: qi, x: mouse.wx, y: mouse.wy, id: t ? t.id : 0 });
  } else if (k === 'KeyD' || k === 'KeyF') cmd({ c: 'spell', s: k === 'KeyD' ? 'd' : 'f', x: mouse.wx, y: mouse.wy });
  else if (k === 'KeyA') pendingA = true;
  else if (k === 'KeyS') { cmd({ c: 'stop' }); pendingA = false; }
  else if (k === 'KeyB') cmd({ c: 'recall' });
  else if (k === 'KeyP') shopOpen = !shopOpen;
  else if (k === 'KeyY') cam.locked = !cam.locked;
  else if (k === 'Space') { e.preventDefault(); if (meUnit) cam.x = meUnit.x; }
  else if (k === 'Escape') { pendingA = false; shopOpen = false; }
});

// ---------- rendering ----------
const sx = x => (x - cam.x) * scale + W / 2, sy = y => (y - hello.map.h / 2) * scale + H / 2;
function circle(x, y, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.arc(sx(x), sy(y), r * scale, 0, 7);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}
function hpBar(u, w, h, yOff, col) {
  const x = sx(u.x) - w / 2, y = sy(u.y) - yOff * scale - h;
  ctx.fillStyle = '#000a'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = col; ctx.fillRect(x, y, w * Math.max(0, u.hp) / u.mhp, h);
  return [x, y];
}
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now(), dt = (nowMs - lastFrame) / 1000, now = nowMs / 1000; lastFrame = nowMs;
  ctx.fillStyle = '#0b1410'; ctx.fillRect(0, 0, W, H);
  if (!hello || !inGame) return;
  const st = interp(); if (!st) return;
  const M = hello.map, my = hello.team[0], mine = st.units.find(u => u.id === (me && me.id));
  // camera
  const halfW = W / 2 / scale;
  if (cam.locked && mine && !mine.d) cam.x = mine.x;
  else if (!cam.locked) { if (mouse.x < 24) cam.x -= 2200 * dt; if (mouse.x > W - 24) cam.x += 2200 * dt; }
  cam.x = halfW * 2 >= M.w ? M.w / 2 : Math.max(halfW, Math.min(M.w - halfW, cam.x));
  // ground
  ctx.fillStyle = '#1b3324'; ctx.fillRect(sx(0), sy(M.top), M.w * scale, (M.bot - M.top) * scale);
  ctx.fillStyle = '#3a3a2c'; ctx.fillRect(sx(0), sy(M.mid - 170), M.w * scale, 340 * scale);
  for (const t of ['blue', 'red']) circle(M.spawn[t].x, M.spawn[t].y, M.fountainR, t === 'blue' ? '#4aa3ff22' : '#ff5a5a22', t === 'blue' ? '#4aa3ff66' : '#ff5a5a66');
  ctx.fillStyle = '#2f6b3acc';
  for (const b of M.brush) ctx.fillRect(sx(b.x), sy(b.y), b.w * scale, b.h * scale);
  // zones
  for (const z of st.zones) {
    const col = z.t === my ? '#6fb8ff' : '#ff6b6b';
    circle(z.x, z.y, z.r, col + '22', col, 2); circle(z.x, z.y, z.r * z.p, col + '33');
  }
  // units
  const order = { t: 0, m: 1, h: 2 };
  for (const u of [...st.units].sort((a, b) => order[a.k] - order[b.k])) {
    const col = TEAM[u.t];
    if (u.k === 't') {
      circle(u.x, u.y, 775 + 0, null, col + '30', 1);
      circle(u.x, u.y, 90, '#2a3138', col, 5); circle(u.x, u.y, 45, col);
      hpBar(u, 110, 9, 110, col);
      const tg = st.units.find(o => o.id === u.tg);
      if (tg && tg.k === 'h') { ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(u.x), sy(u.y)); ctx.lineTo(sx(tg.x), sy(tg.y)); ctx.stroke(); }
    } else if (u.k === 'm') {
      circle(u.x, u.y, u.m ? 32 : 26, col, '#0008', 2);
      if (!u.m) circle(u.x, u.y, 10, '#fff9');
      hpBar(u, 44, 5, 42, u.t === my ? '#4aa3ff' : '#ff5a5a');
    } else if (!u.d) {
      const def = hello.heroes[u.h];
      ctx.globalAlpha = u.br ? 0.55 : 1;
      circle(u.x, u.y, 55, def.color, col, 5);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx(u.x), sy(u.y));
      ctx.lineTo(sx(u.x + Math.cos(u.f) * 55), sy(u.y + Math.sin(u.f) * 55)); ctx.stroke();
      ctx.globalAlpha = 1;
      if (u.sh) circle(u.x, u.y, 66, null, '#ffffff', 3);
      if (u.mk) circle(u.x, u.y, 75, null, '#8affd9', 2);
      if (u.rc) { ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sx(u.x), sy(u.y), 80 * scale, -1.57, -1.57 + 6.283 * u.rc); ctx.stroke(); }
      const [bx, by] = hpBar(u, 96, 10, 78, u.t === my ? '#3fd06a' : '#ff5a5a');
      ctx.fillStyle = '#000a'; ctx.fillRect(bx - 1, by + 11, 98, 4); ctx.fillStyle = '#4a8fe0'; ctx.fillRect(bx, by + 11, 96 * u.mp / u.mmp, 3);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText(`${u.lvl} ${u.n}`, sx(u.x), by - 4);
      const tag = u.st ? 'STUNNED' : u.rt ? 'ROOTED' : u.sl ? 'slowed' : '';
      if (tag) { ctx.fillStyle = '#ffd24a'; ctx.fillText(tag, sx(u.x), by - 18); }
    }
  }
  // projectiles
  for (const s of st.shots) circle(s.x, s.y, Math.max(10, s.w / 2.4), s.c || TEAM[s.t], '#000a', 1);
  // effects
  fx = fx.filter(f => now - f.t0 < f.dur);
  for (const f of fx) {
    const p = (now - f.t0) / f.dur;
    if (f.k === 'burst') { ctx.globalAlpha = 1 - p; circle(f.x, f.y, f.r * (0.7 + 0.3 * p), (f.c || '#fff') + '55', f.c || '#fff', 3); ctx.globalAlpha = 1; }
    else if (f.k === 'click') circle(f.x, f.y, 40 * (1 - p), null, f.c, 2);
    else { ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText(f.s, sx(f.x), sy(f.y) - 30 - 30 * p); }
  }
  if (mine && pendingA && me) circle(mine.x, mine.y, me.range + 55, null, '#ffffff88', 1);
  // minimap strip
  const mw = Math.min(520, W * 0.4), mx = W - mw - 10, myy = 10, mh = 26;
  ctx.fillStyle = '#0c141acc'; ctx.fillRect(mx, myy, mw, mh); ctx.strokeStyle = '#33485a'; ctx.lineWidth = 1; ctx.strokeRect(mx, myy, mw, mh);
  for (const u of st.units) { if (u.d) continue; ctx.fillStyle = TEAM[u.t]; const r = u.k === 'h' ? 5 : u.k === 't' ? 6 : 2;
    ctx.fillRect(mx + u.x / M.w * mw - r / 2, myy + 4 + (u.y - M.top) / (M.bot - M.top) * (mh - 8) - r / 2, r, r); }
  ctx.strokeStyle = '#fff8'; ctx.strokeRect(mx + (cam.x - halfW) / M.w * mw, myy, Math.min(mw, halfW * 2 / M.w * mw), mh);
  // death overlay
  if (meUnit && meUnit.d) { ctx.fillStyle = '#0008'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`Respawning in ${meUnit.d}`, W / 2, H * 0.3); }
  updateHud();
}
connect(); frame();
