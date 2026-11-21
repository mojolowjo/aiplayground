'use strict';
const $ = id => document.getElementById(id);
const cv = $('c'); let ctx = cv.getContext('2d');   // let: gfx.js points it at an offscreen canvas while pre-rendering
const TEAM = { b: '#4aa3ff', r: '#ff5a5a' };
let ws, hello = null, myId = 0, lobbyState = null, inGame = false;
let snaps = [], offset = null, me = null, meUnit = null, myDef = null;
let cam = { x: 0, locked: true }, mouse = { x: 0, y: 0, wx: 0, wy: 0, rdown: false, lastMove: 0 };
const pred = Predict.create();   // movement prediction for your own hero
let predErr = 0, showGhost = false;
let pendingA = false, shopOpen = false, showAggro = false, fx = [], ping = 0, W = 0, H = 0, scale = 1;

let zoom = 1; const MIN_ZOOM = 0.45;   // how far the camera may pull back
// Render scale (a desktop-app setting): the battlefield canvas holds fewer pixels and is stretched to fill the
// window. Everything is still drawn in window coordinates; the canvas's base transform shrinks it. Health bars,
// damage numbers and other text then go on a second, full-size canvas (#ui) so they stay sharp.
const worldCtx = ctx, ui = $('ui'), uiCtx = ui.getContext('2d');
let RS = 1;
function resize() {
  W = innerWidth; H = innerHeight; cv.width = Math.round(W * RS); cv.height = Math.round(H * RS);
  const split = RS < 1; ui.width = split ? W : 1; ui.height = split ? H : 1; ui.style.display = split ? 'block' : 'none';
  scale = H / 1250 * zoom;
}
// Frame pacing and the performance overlay.
const PERF = { slack: 1, samples: 60, every: 500 };   // ms of leeway when skipping frames; snapshots averaged for jitter; ms between overlay updates
const perf = { due: 0, frames: 0, since: performance.now(), lastSnap: 0, gaps: [] };
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
    else if (m.t === 'hello') { hello = m; myId = m.id; Predict.configure(m.rules.predict); buildHeroes(); }
    else if (m.t === 'lobby') { lobbyState = m; inGame = m.inGame; if (!inGame) { snaps = []; offset = null; perf.lastSnap = 0; perf.gaps = []; Predict.release(pred); lastDrawn = null; } renderLobby(); }
    else if (m.t === 'full') $('status').textContent = 'This room is full.';
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
  const ready = ps.every(p => p.hero), seats = lobbyState.size * 2, empty = seats - ps.length, other = mine && mine.team === 'blue' ? 'red' : 'blue';
  if (mine) hello.team = mine.team;                       // the team can change in the lobby
  // The join address is only sent to the host (whoever is on the PC running the server).
  const j = lobbyState.join; $('joinRow').style.display = j ? 'block' : 'none';
  if (j) { $('joinLabel').textContent = !j.url ? '' : j.public ? 'Friends join at:' : 'On your network:'; $('joinUrl').textContent = j.url || ''; $('joinUrl').style.display = $('joinCopy').style.display = j.url ? 'inline' : 'none'; $('joinNote').textContent = j.note || ''; }
  $('mode').value = lobbyState.mode; $('modeName').textContent = lobbyState.mode;
  $('rk').textContent = lobbyState.goal.kills; $('rc').textContent = lobbyState.goal.cs; $('teamNote').textContent = lobbyState.size > 1 ? ' (team totals)' : '';
  $('team').textContent = `Switch to ${other}`; $('team').disabled = ps.filter(p => p.team === other).length >= lobbyState.size;
  $('start').disabled = !ready;
  $('start').textContent = ps.length === 1 ? 'Practice' : 'Start';
  $('oppRow').style.display = empty ? 'inline' : 'none';
  $('oppLabel').textContent = ps.length === 1 && seats === 2 ? 'against' : `empty seat${empty > 1 ? 's' : ''} filled by`;
  $('hint').textContent = !ready ? 'Everyone must pick a character.' : empty ? 'Send this page\'s link to bring in more players.' : '';
  if (inGame && mine) { myDef = hello.heroes[mine.hero]; myHero = mine.hero; buildSlots(); buildShop(); cam.locked = true; cam.x = hello.map.spawn[mine.team].x; }
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('start').onclick = () => { localStorage.ldOpp = $('opp').value; send({ t: 'start', opp: $('opp').value }); goFullscreen(); };
if (localStorage.ldOpp) $('opp').value = localStorage.ldOpp;
$('mode').onchange = () => send({ t: 'mode', mode: $('mode').value });
$('joinCopy').onclick = async () => {
  const text = $('joinUrl').textContent;
  try { await navigator.clipboard.writeText(text); }
  catch {   // the clipboard API needs https or localhost; fall back to selecting the text and copying that
    const r = document.createRange(); r.selectNodeContents($('joinUrl')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    try { document.execCommand('copy'); } catch { /* the address is selected: Ctrl+C works */ }
  }
  $('joinCopy').textContent = 'Copied'; setTimeout(() => { $('joinCopy').textContent = 'Copy'; }, 1500);
};
$('team').onclick = () => send({ t: 'team' });
// Blink and Mend can swap keys. spellKey maps the D and F keys to the spell each one casts.
let swapSpells = localStorage.ldSwap === '1';
const spellKey = () => (swapSpells ? { KeyD: 'f', KeyF: 'd' } : { KeyD: 'd', KeyF: 'f' });
function showSwap() { $('swap').textContent = `Blink on ${swapSpells ? 'F' : 'D'}, Mend on ${swapSpells ? 'D' : 'F'} — swap`; }
$('swap').onclick = () => { swapSpells = !swapSpells; localStorage.ldSwap = swapSpells ? '1' : '0'; showSwap(); if (inGame && myDef) buildSlots(); };
showSwap();
$('rematch').onclick = () => send({ t: 'rematch' });
$('name').onchange = () => { localStorage.ldName = $('name').value; };

// ---------- HUD ----------
let slotEls = [], myHero = '';
function buildSlots() {
  const el = $('slots'); el.innerHTML = ''; slotEls = [];
  const defs = [...(myDef.passive ? [{ ...myDef.passive, pv: true, key: '' }] : []), ...myDef.abilities.map((a, i) => ({ ...a, i })), ...['KeyD', 'KeyF'].map(k => ({ ...hello.spells[spellKey()[k]], sp: spellKey()[k], key: k[3] }))];
  for (const a of defs) {
    const d = document.createElement('div'); d.className = 'slot' + (a.sp || a.pv ? ' small' : '');
    d.innerHTML = `<div class="ic">${ICON(a.pv ? myHero + 'P' : a.sp ? 'spell_' + a.sp : myHero + a.i)}</div><div class="sweep"></div><span class="k">${a.key}</span><div class="cd"></div><div class="pips"></div>`;
    d.onmouseenter = () => { const t = $('tip'); t.style.display = 'block';
      const cds = Array.isArray(a.cd) ? a.cd.join('/') : a.cd, range = Array.isArray(a.range) ? a.range.join('/') : a.range;
      t.innerHTML = a.pv ? `<b>${a.name}</b> (passive)<br>${a.desc}` :
        `<b>${a.name}</b> (${a.key})<br>${a.desc}<br><small style="color:#9fb2bf">Cooldown ${cds}s${a.cost && a.cost.some(c => c > 0) ? ' · Mana ' + a.cost.join('/') : ''}${range ? ' · Range ' + range : ''}</small>`;
      const r = d.getBoundingClientRect(); t.style.left = r.left + 'px'; t.style.bottom = (innerHeight - r.top + 8) + 'px'; t.style.top = 'auto'; };
    d.onmouseleave = () => { $('tip').style.display = 'none'; };
    if (!a.sp && !a.pv) d.onclick = () => cmd({ c: 'lvl', s: a.i });
    el.appendChild(d); slotEls.push({ d, a, sweep: d.children[1], cdEl: d.children[3], pips: d.children[4] });
  }
  const s = document.createElement('div'); s.id = 'stats'; el.appendChild(s);
  const b = document.createElement('div'); b.id = 'bag'; b.onclick = bagClick; el.appendChild(b); SHOP.bagDrawn = '';
}
function setBar(id, v, m, text) { const b = $(id); b.firstChild.style.width = (m ? 100 * v / m : 0) + '%'; if (text && b.children[1]) b.children[1].textContent = `${Math.max(0, v)} / ${m}`; }
function updateHud() {
  if (!me || !meUnit) return;
  setBar('hpb', meUnit.hp, meUnit.mhp, true); $('mpb').style.display = meUnit.mmp ? 'block' : 'none'; setBar('mpb', meUnit.mp, meUnit.mmp, true);   // manaless heroes have no mana bar setBar('xpb', me.xp, me.xpn);
  for (const { d, a, sweep, cdEl, pips } of slotEls) {
    if (a.pv) {   // passive: shows the wait until it is ready again
      cdEl.textContent = me.pv > 0 ? Math.ceil(me.pv) : meUnit.pn || ''; d.classList.toggle('off', me.pv > 0);
      sweep.style.background = me.pv > 0 ? `conic-gradient(rgba(0,0,0,0) ${100 - Math.min(100, 100 * me.pv / a.every)}%, rgba(4,8,12,.72) 0)` : 'none';
      continue;
    }
    const cd = a.sp ? (a.sp === 'd' ? me.sd : me.sf) : me.cds[a.i], rank = a.sp ? 1 : me.ranks[a.i];
    cdEl.textContent = cd > 0 ? (cd < 10 && !a.sp ? cd.toFixed(1) : Math.ceil(cd)) : '';
    const full = a.sp ? a.cd : a.cd[Math.min(Math.max(rank - 1, 0), a.cd.length - 1)], pct = Math.min(100, 100 * cd / full);
    sweep.style.background = cd > 0 ? `conic-gradient(rgba(0,0,0,0) ${100 - pct}%, rgba(4,8,12,.72) 0)` : 'none';
    d.classList.toggle('off', rank === 0 || cd > 0);
    if (!a.sp) {
      const cost = a.cost[Math.min(Math.max(rank - 1, 0), a.cost.length - 1)];
      d.classList.toggle('nomana', rank > 0 && meUnit.mp < cost);
      const max = a.i === 3 ? (meUnit.lvl >= 16 ? 3 : meUnit.lvl >= 11 ? 2 : meUnit.lvl >= 6 ? 1 : 0) : Math.min(5, Math.ceil(meUnit.lvl / 2));
      d.classList.toggle('up', me.pts > 0 && rank < max);
      pips.textContent = '●'.repeat(rank);
    }
  }
  // Item stats only take up room once you have some.
  const extra = [me.hs && `Haste ${me.hs}`, me.cr && `Crit ${me.cr}%`, me.ls && `Lifesteal ${me.ls}%`, me.apn && `Armor pen ${me.apn}%`,
    (me.mpp || me.mpf) && `Magic pen ${[me.mpp && me.mpp + '%', me.mpf].filter(Boolean).join(' + ')}`].filter(Boolean);
  $('stats').innerHTML = `Lv ${meUnit.lvl} · <b style="color:#ffd24a">${me.gold}g</b> · CS ${meUnit.cs} · missed ${me.miss}<br>AD ${me.ad} · AP ${me.ap} · AS ${me.as}<br>Armor ${me.ar} · MR ${me.mr} · MS ${me.ms}` +
    (extra.length ? '<br>' + extra.slice(0, 3).join(' · ') + (extra.length > 3 ? '<br>' + extra.slice(3).join(' · ') : '') : '');
  renderBag();
  const cur = snaps[snaps.length - 1];
  const sc = t => `<span style="color:${TEAM[t]}">${esc(cur.sc[t].n)} ${cur.sc[t].k}K ${cur.sc[t].cs}CS</span>`;
  const tm = cur.time | 0;
  $('top').innerHTML = `${sc('b')} &nbsp; ${tm / 60 | 0}:${String(tm % 60).padStart(2, '0')} &nbsp; ${sc('r')} &nbsp; <small style="color:#8a9aa5">${ping}ms</small>`;
  renderShop();
}
function feed(text) {
  const d = document.createElement('div'); d.textContent = text; $('feed').appendChild(d); setTimeout(() => d.remove(), 6000);
}

// ---------- snapshots ----------
function onSnap(s) {
  const now = performance.now() / 1000, o = s.time - now;
  if (perf.lastSnap) { perf.gaps.push((now - perf.lastSnap) * 1000); if (perf.gaps.length > PERF.samples) perf.gaps.shift(); }
  perf.lastSnap = now;
  offset = offset === null || Math.abs(o - offset) > 0.5 ? o : offset + (o - offset) * 0.05;
  s.at = now; snaps.push(s); if (snaps.length > 20) snaps.shift();
  me = s.me; meUnit = s.units.find(u => u.id === (me && me.id));
  // Check the prediction against the server. Forced movement and death hand the hero back to the snapshots.
  if (meUnit) { if (meUnit.d || meUnit.fm) Predict.release(pred); else predErr = Predict.reconcile(pred, meUnit.x, meUnit.y, now, ping / 1000); }
  for (const e of s.ev) { if (e.e === 'kill') feed(`${e.k} killed ${e.v}`); else gfxEvent(e, now, me ? me.id : 0); }
  if (s.over && $('over').style.display !== 'block') {
    const won = hello.team === s.over.winner;
    $('ot').textContent = won ? 'Victory' : 'Defeat'; $('ot').style.color = won ? '#ffd24a' : '#ff6b6b';
    $('or').textContent = `${s.over.winner.toUpperCase()} wins — ${s.over.reason}`; $('over').style.display = 'block';
  }
}
function interp() {
  if (!snaps.length) return null;
  const rt = performance.now() / 1000 + offset - Settings.cfg.smoothing / 1000;   // how far behind the server other units are drawn
  let b = snaps.length - 1; while (b > 0 && snaps[b - 1].time > rt) b--;
  const B = snaps[b], A = snaps[b - 1] || B, k = B.time > A.time ? Math.max(0, Math.min(1, (rt - A.time) / (B.time - A.time))) : 1;
  const lerp = (la, lb) => { const m = new Map(la.map(u => [u.id, u]));
    return lb.map(u => { const a = m.get(u.id); return a && Math.abs(a.x - u.x) + Math.abs(a.y - u.y) < 400 ? { ...u, x: a.x + (u.x - a.x) * k, y: a.y + (u.y - a.y) * k } : u; }); };
  return { units: lerp(A.units, B.units), shots: lerp(A.shots, B.shots), zones: B.zones, pk: B.pk || [] };
}

// ---------- input ----------
const toWorld = (sx, sy) => [(sx - W / 2) / scale + cam.x, (sy - H / 2) / scale + hello.map.h / 2];
function unitAt(wx, wy, heroOnly) {
  const cur = snaps[snaps.length - 1]; if (!cur) return null;
  let best = null, bd = 1e9;
  for (const u of cur.units) {
    if (u.t === hello.team[0] || u.d || (heroOnly && u.k !== 'h')) continue;
    const r = u.k === 't' ? 90 : u.k === 'h' ? hello.rules.heroRadius : 32, d = Math.hypot(u.x - wx, u.y - wy);
    if (d <= r + (heroOnly ? 180 : 25) && d < bd) { bd = d; best = u; }
  }
  return best;
}
// Where the minions will be at the moment the predicted hero is living in. The hero on screen is ahead of the
// newest snapshot by about one round trip, so each minion is moved on by its own speed (from the last two
// snapshots) over that time. Without this the hero would steer around where a marching wave used to be.
function minionsAhead(now) {
  const B = snaps[snaps.length - 1], A = snaps[snaps.length - 2]; if (!B) return [];
  const prev = A ? new Map(A.units.map(u => [u.id, u])) : new Map(), dt = A ? B.time - A.time : 0, ahead = Math.min(0.4, ping / 1000 + (now - B.at));
  return B.units.filter(u => u.k === 'm').map(u => { const a = dt > 0 && prev.get(u.id); return { x: u.x + (a ? (u.x - a.x) / dt * ahead : 0), y: u.y + (a ? (u.y - a.y) / dt * ahead : 0), gh: u.gh }; });
}
let lastDrawn = null;                       // your hero as it was last drawn (predicted or interpolated)
const drawnMe = () => lastDrawn || meUnit;
function rightClick(shift) {
  const [x, y] = [mouse.wx, mouse.wy], u = unitAt(x, y);
  if (u) cmd({ c: 'atk', id: u.id }); else cmd({ c: shift ? 'amove' : 'move', x, y });
  // Only a plain move order is predicted; attacking and attack-moving depend on what the server decides.
  const drawn = drawnMe();
  if (!u && !shift && drawn && meUnit && !meUnit.d && !meUnit.fm) Predict.moveTo(pred, x, y, drawn, performance.now() / 1000); else Predict.release(pred);
  fx.push({ k: 'click', x, y, c: u || shift ? '#ff5a5a' : '#6fe08a', t0: performance.now() / 1000, dur: 0.35 });
  mouse.lastMove = performance.now();
}
// ---------- keep the browser out of the way ----------
// A page can cancel most browser shortcuts, but not the ones that close or switch tabs (Ctrl+W, Ctrl+T,
// Ctrl+N, Ctrl+Tab). Those only reach the game in fullscreen with the keyboard locked, which Chrome and
// Edge support. So: cancel what we can, offer fullscreen for the rest, and confirm before leaving mid-game.
const KEEP = new Set(['F11', 'F12']);   // fullscreen and dev tools stay with the browser
function swallow(e) {
  if (!inGame || e.target.tagName === 'INPUT' || KEEP.has(e.code)) return;
  e.preventDefault();
}
addEventListener('keydown', swallow, true);
addEventListener('keyup', e => { if (inGame && (e.key === 'Alt' || e.key === 'Meta')) e.preventDefault(); }, true);   // Alt would focus the browser menu
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('dragstart', e => e.preventDefault());
addEventListener('selectstart', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
addEventListener('wheel', e => { if (e.ctrlKey || inGame) e.preventDefault(); }, { passive: false });               // no page zoom or scroll
for (const ev of ['mousedown', 'mouseup', 'auxclick']) addEventListener(ev, e => { if (e.button === 1 || e.button > 2) e.preventDefault(); });   // middle-click scroll, back/forward buttons
addEventListener('beforeunload', e => { if (!Settings.inApp && inGame && !(snaps.length && snaps[snaps.length - 1].over)) { e.preventDefault(); e.returnValue = ''; } });
async function goFullscreen() {
  if (Settings.inApp) return;   // the app's window mode setting decides
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock();   // hands Esc, Ctrl+W and friends to the game
  } catch { /* refused: the game still works windowed */ }
}
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  $('fs').textContent = on ? 'Exit fullscreen' : 'Fullscreen';
  if (!on && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
});
$('fs').onclick = () => {
  if (Settings.inApp) window.laneDuelApp.setFullscreen(Settings.cfg.windowMode === 'windowed' ? 'borderless' : 'windowed');
  else if (document.fullscreenElement) document.exitFullscreen(); else goFullscreen();
};
// ---------- desktop app downloads ----------
// The two lobby links start out pointing at the releases page. Once GitHub says what the newest lane-duel-v*
// release is, they point straight at its Windows and Linux files. If GitHub cannot be asked, they stay as they are.
const APP_RELEASES = { api: 'https://api.github.com/repos/mojolowjo/aiplayground/releases?per_page=50', tag: /^lane-duel-v(\d+)\.(\d+)\.(\d+)$/, files: { getWin: '.exe', getLinux: '.AppImage' } };
async function findDownloads() {
  try {
    const list = await (await fetch(APP_RELEASES.api, { headers: { Accept: 'application/vnd.github+json' } })).json();
    let best = null;
    for (const r of list) {
      const m = !r.draft && !r.prerelease && APP_RELEASES.tag.exec(r.tag_name); if (!m) continue;
      const v = m.slice(1).map(Number), newer = !best || v.find((n, i) => n !== best.v[i]) > best.v[v.findIndex((n, i) => n !== best.v[i])];
      if (newer) best = { v, assets: r.assets };
    }
    if (!best) return;
    for (const [id, ext] of Object.entries(APP_RELEASES.files)) {
      const a = best.assets.find(x => x.name.endsWith(ext)); if (a) { $(id).href = a.browser_download_url; $(id).removeAttribute('target'); }
    }
    $('getVer').textContent = ' ' + best.v.join('.');
  } catch { /* offline or rate-limited: the links still open the releases page */ }
}
if (!Settings.inApp) findDownloads();
// ---------- settings ----------
function openMenu() { Settings.open(Settings.inApp ? [{ label: 'Back to server list', onClick: () => window.laneDuelApp.backToStart() }] : []); }
$('gear').onclick = openMenu;
// Is the player in the middle of aiming something? (Esc cancels that first; only otherwise does it open the menu.)
const aiming = () => pendingA || Object.values(held).some(Boolean) || !!(meUnit && (meUnit.hl > 0 || meUnit.bg));
Settings.onChange(cfg => {
  const rs = Settings.inApp ? cfg.renderScale / 100 : 1; if (rs !== RS) { RS = rs; resize(); }
  GFX.fx = Settings.inApp ? cfg.effects : 'high';
  $('perf').style.display = cfg.overlay ? 'block' : 'none';
  if (Settings.inApp) { $('fs').textContent = cfg.windowMode === 'windowed' ? 'Fullscreen' : 'Exit fullscreen'; $('fs').title = ''; $('getApp').style.display = 'none'; }
});
// The frame cap in frames per second, or 0 for none. Only the desktop app has one.
function fpsCap() {
  if (!Settings.inApp) return 0;
  const v = Settings.cfg.fpsLimit;
  return v === 'auto' ? (Settings.cfg.vsync ? 0 : Settings.meta.refreshRate || 0) : v;   // with V-Sync on the monitor already paces the frames
}
function showPerf(nowMs) {
  perf.frames++;
  if (nowMs - perf.since < PERF.every) return;
  const fps = perf.frames * 1000 / (nowMs - perf.since), g = perf.gaps, mean = g.reduce((a, b) => a + b, 0) / (g.length || 1);
  const jitter = g.length ? g.reduce((a, b) => a + Math.abs(b - mean), 0) / g.length : 0;   // how unevenly snapshots arrive
  perf.frames = 0; perf.since = nowMs;
  if (Settings.cfg.overlay) $('perf').textContent = `${Math.round(fps)} FPS · ping ${ping} ms · jitter ${jitter.toFixed(1)} ms`;
}
// Mouse input is taken from the whole window, not just the canvas, so the cursor is tracked and right-clicks
// still move you when it is over the HUD, the shop or the score bar. Left-clicks on those panels still use them.
addEventListener('mousemove', e => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (mouse.rdown && inGame && performance.now() - mouse.lastMove > 120) { [mouse.wx, mouse.wy] = toWorld(mouse.x, mouse.y); rightClick(e.shiftKey); }
});
addEventListener('mousedown', e => {
  if (!inGame || !hello || e.target.closest('#over')) return;
  [mouse.wx, mouse.wy] = toWorld(e.clientX, e.clientY);
  if (e.button === 2 && e.target.closest('[data-item]')) return;                 // right-click on a shop item buys it; it is not a move order
  if (e.button === 2) { mouse.rdown = true; pendingA = false; rightClick(e.shiftKey); }
  else if (e.button === 0 && pendingA && e.target === cv) {
    pendingA = false; Predict.release(pred); const u = unitAt(mouse.wx, mouse.wy);
    if (u) cmd({ c: 'atk', id: u.id }); else cmd({ c: 'amove', x: mouse.wx, y: mouse.wy });
    fx.push({ k: 'click', x: mouse.wx, y: mouse.wy, c: '#ff5a5a', t0: performance.now() / 1000, dur: 0.35 });
  }
});
addEventListener('mouseup', e => { if (e.button === 2) mouse.rdown = false; });
addEventListener('keydown', e => {
  if (Settings.isOpen()) { if (e.code === 'Escape' && !e.repeat) Settings.close(); return; }
  if (!inGame || !hello || e.target.tagName === 'INPUT' || e.repeat) return;
  const k = e.code, qi = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(k);
  [mouse.wx, mouse.wy] = toWorld(mouse.x, mouse.y);
  const digit = /^Digit[1-6]$/.test(k) ? +k[5] - 1 : -1;
  if (digit >= 0) return cmd({ c: 'use', i: digit });                           // 1-6: drink the potion or flask in that bag slot
  if (k === 'KeyZ' && (e.ctrlKey || e.metaKey)) { if (shopOpen) cmd({ c: 'undo' }); return; }
  if (qi >= 0) {
    if (e.shiftKey || e.ctrlKey || e.metaKey) return cmd({ c: 'lvl', s: qi });
    const why = blocked(qi); if (why) return say(why);
    if (myDef.abilities[qi].castTime && !meUnit.bg) pred.lockUntil = performance.now() / 1000 + myDef.abilities[qi].castTime;   // the hero stands still while casting
    if (myDef.abilities[qi].charge) { held[qi] = true; return cmd({ c: 'charge', s: qi }); }
    const t = unitAt(mouse.wx, mouse.wy, true);
    cmd({ c: 'cast', s: qi, x: mouse.wx, y: mouse.wy, id: t ? t.id : 0 });
  } else if (k === 'KeyD' || k === 'KeyF') cmd({ c: 'spell', s: spellKey()[k], x: mouse.wx, y: mouse.wy });
  else if (k === 'KeyA') pendingA = true;
  else if (k === 'KeyS') { cmd({ c: 'stop' }); pendingA = false; Predict.stop(pred); }
  else if (k === 'KeyB') { cmd({ c: 'recall' }); Predict.stop(pred); }
  else if (k === 'KeyP') shopOpen = !shopOpen;
  else if (k === 'KeyY') cam.locked = !cam.locked;
  else if (k === 'KeyT') showAggro = !showAggro;
  else if (k === 'F8') showGhost = !showGhost;      // hidden debug view: where the server has your hero
  else if (k === 'Space') { e.preventDefault(); if (meUnit) cam.x = meUnit.x; }
  else if (k === 'Escape') { if (shopOpen || aiming()) { pendingA = false; shopOpen = false; } else openMenu(); }
});

const held = {};
// Why an ability key would do nothing right now, so a dead key press always explains itself.
function blocked(i) {
  if (!me || !meUnit || meUnit.d) return '';
  const a = myDef.abilities[i], rank = me.ranks[i];
  if (!rank) return `${a.name} not learned — Shift+${a.key}`;
  if (meUnit.bg) return i === 3 ? '' : 'Busy firing — S to end';
  if (meUnit.cn) return 'Channelling — S to end';
  if (meUnit.st) return 'Stunned';
  if (meUnit.si) return 'Silenced';
  if (me.cds[i] > 0) return `${a.name} on cooldown`;
  if (meUnit.mp < a.cost[Math.min(rank - 1, a.cost.length - 1)]) return 'Not enough mana';
  return '';
}
let said = 0;
function say(text) { const now = performance.now(); if (now - said < 400) return; said = now; floater(meUnit.x, meUnit.y - 60, text, '#ffb0a0', 15); }
addEventListener('keyup', e => {
  const qi = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'].indexOf(e.code);
  if (qi < 0 || !held[qi]) return;
  held[qi] = false; [mouse.wx, mouse.wy] = toWorld(mouse.x, mouse.y);
  cmd({ c: 'cast', s: qi, x: mouse.wx, y: mouse.wy });
});
// ---------- rendering ----------
const sx = x => (x - cam.x) * scale + W / 2, sy = y => (y - hello.map.h / 2) * scale + H / 2;
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now(), cap = fpsCap();
  if (cap) {   // FPS limit: skip this frame if the next one is not due yet
    const gap = 1000 / cap;
    if (nowMs < perf.due - PERF.slack) return;
    perf.due = nowMs - perf.due > gap ? nowMs + gap : perf.due + gap;
  }
  const dt = Math.min(0.1, (nowMs - lastFrame) / 1000), now = nowMs / 1000; lastFrame = nowMs;
  showPerf(nowMs);
  const top = RS < 1 ? uiCtx : worldCtx;   // where bars and text go
  if (top !== worldCtx) { uiCtx.setTransform(1, 0, 0, 1, 0, 0); uiCtx.clearRect(0, 0, W, H); }
  ctx = worldCtx; ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0); ctx.fillStyle = '#0b1410'; ctx.fillRect(0, 0, W, H);
  if (!hello || !inGame) return;
  const st = interp(); if (!st) return;
  const M = hello.map, my = hello.team[0];
  // Your own hero is drawn from the prediction; everything else from interpolated snapshots.
  const mi = st.units.findIndex(u => u.id === (me && me.id));
  if (mi >= 0 && pred.mode === 'predict' && me && meUnit) {
    Predict.step(pred, dt, { now, speed: me.ms, canMove: !meUnit.nm && !meUnit.d, ghosted: !!meUnit.gh, odd: me.id % 2 === 1,
      minions: minionsAhead(now), map: M, coll: hello.rules.collision });
    st.units[mi] = { ...st.units[mi], x: pred.x, y: pred.y, ...(pred.order ? { f: pred.face } : {}) };
  }
  const mine = mi >= 0 ? st.units[mi] : undefined; lastDrawn = mine || null;
  // camera (zooms out during a barrage until the whole range fits on screen)
  const ranges = mine && mine.bg && myDef && me ? myDef.abilities[3].range : null, barrage = ranges ? ranges[Math.min(ranges.length, Math.max(1, me.ranks[3])) - 1] : 0;
  zoom += ((barrage ? Math.max(MIN_ZOOM, Math.min(1, W / 2 / (H / 1250) / (barrage + 250))) : 1) - zoom) * Math.min(1, dt * 5); scale = H / 1250 * zoom;
  const halfW = W / 2 / scale;
  // During a barrage the range is wider than the screen, so the camera follows the cursor to the screen edges
  // (within the barrage's reach) and snaps back afterwards.
  const pan = () => { const v = 2200 / zoom * dt; if (mouse.x < 40) cam.x -= v; if (mouse.x > W - 40) cam.x += v; };
  if (barrage && mine) { pan(); cam.x = Math.max(mine.x - barrage, Math.min(mine.x + barrage, cam.x)); }
  else if (cam.locked && mine && !mine.d) cam.x = mine.x;
  else if (!cam.locked) pan();
  cam.x = halfW * 2 >= M.w ? M.w / 2 : Math.max(halfW, Math.min(M.w - halfW, cam.x));
  GFX.shake = EFFECTS[GFX.fx].shake ? GFX.shake * Math.exp(-dt * 9) : 0;
  const shaking = GFX.shake > 0.3, shx = shaking ? (Math.random() - 0.5) * GFX.shake : 0, shy = shaking ? (Math.random() - 0.5) * GFX.shake : 0;
  ctx.save(); ctx.translate(shx, shy);
  GFX.ambient = true; drawGround(M, now, cam.x, halfW); GFX.ambient = false;
  for (const z of st.zones) drawZone(z, now, z.t === my);
  for (const b of st.pk) drawPickup(b, now, b.t === my);
  // click markers sit on the ground
  fx = fx.filter(f => now - f.t0 < f.dur);
  for (const f of fx) {
    const p = (now - f.t0) / f.dur; ctx.strokeStyle = f.c; ctx.lineWidth = 2.5; ctx.globalAlpha = 1 - p;
    ctx.beginPath(); ctx.ellipse(sx(f.x), sy(f.y), 44 * (1 - p) * scale + 3, 30 * (1 - p) * scale + 2, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
  drawGroundParts(dt);
  // units, back to front
  const live = st.units.filter(u => !u.d).sort((a, b) => (a.k === 't' ? -1e5 : a.y) - (b.k === 't' ? -1e5 : b.y));
  const anims = new Map(), byId = new Map(st.units.map(u => [u.id, u]));
  for (const u of live) {
    const a = animUpdate(u, now, dt), col = TEAM[u.t]; anims.set(u.id, a); GFX.ambient = true;
    if (u.k === 't') {
      drawTower(u, a, now, col, !!mine && Math.hypot(mine.x - u.x, mine.y - u.y) < 1100);
      const tg = st.units.find(o => o.id === u.tg);
      if (tg && tg.k === 'h' && !tg.d) {
        ctx.strokeStyle = '#ff3030'; ctx.lineWidth = 2 + 1.5 * Math.sin(now * 20); ctx.globalAlpha = 0.8; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now * 120;
        ctx.beginPath(); ctx.moveTo(sx(u.x), sy(u.y)); ctx.lineTo(sx(tg.x), sy(tg.y)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
    } else if (u.k === 'm') drawMinion(u, a, now, col);
    else drawHero(u, a, now, col, u.id === (me && me.id));
    GFX.ambient = false;
  }
  if (showAggro) for (const u of live) {   // debug: a line from each minion to whatever it is targeting
    const tg = u.k === 'm' && byId.get(u.tg); if (!tg || tg.d) continue;
    ctx.strokeStyle = TEAM[u.t]; ctx.globalAlpha = 0.75; ctx.lineWidth = tg.k === 'h' ? 3 : 1.5;
    ctx.beginPath(); ctx.moveTo(sx(u.x), sy(u.y)); ctx.lineTo(sx(tg.x), sy(tg.y)); ctx.stroke();
    ctx.fillStyle = TEAM[u.t]; ctx.beginPath(); ctx.arc(sx(tg.x), sy(tg.y), 4, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  }
  for (const s of st.shots) drawShot(s, now, TEAM[s.t], byId);
  drawTrees(M, now, cam.x, halfW);
  drawParts(dt, now);
  ctx.restore(); ctx = top; ctx.save(); ctx.translate(shx, shy);   // from here on: bars, numbers and text, at full sharpness
  drawFloaters(now);
  for (const u of live) {
    const a = anims.get(u.id), mineTeam = u.t === my;
    if (u.k === 't') { smallBar(u, a, 120, 10, 128, TEAM[u.t]);
      if (u.pl) { ctx.fillStyle = '#0b0e12'; const bx = Math.round(sx(u.x) - 60), by = Math.round(sy(u.y) - 128 * scale - 10); for (let i = 1; i < u.pl; i++) ctx.fillRect(bx + 120 * i / u.pl - 1, by, 2, 10); }   // plate marks
    }
    else if (u.k === 'm') smallBar(u, a, u.m === 2 ? 62 : 46, u.m === 2 ? 6 : 5, u.m === 2 ? 56 : 44, mineTeam ? '#4aa3ff' : '#ff5a5a');
    else heroBar(u, a, mineTeam ? (u.id === me.id ? '#3fd06a' : '#4aa3ff') : '#ff5a5a', u.id === (me && me.id));
  }
  if (barrage) {   // barrage: range ring, and where the next shot would land
    const def = myDef.abilities[3], [wx, wy] = toWorld(mouse.x, mouse.y), d = Math.hypot(wx - mine.x, wy - mine.y) || 1, k = Math.min(1, barrage / d);
    ctx.strokeStyle = '#8fd0ff66'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.arc(sx(mine.x), sy(mine.y), barrage * scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#8fd0ff22'; ctx.strokeStyle = '#dff2ff'; ctx.beginPath(); ctx.arc(sx(mine.x + (wx - mine.x) * k), sy(mine.y + (wy - mine.y) * k), def.radius * scale, 0, 7); ctx.fill(); ctx.stroke();
  }
  if (mine && mine.hl > 0 && myDef) {   // charge preview: the beam's current reach inside its maximum reach
    const c = myDef.abilities.find(a => a.charge).charge, [wx, wy] = toWorld(mouse.x, mouse.y), an = Math.atan2(wy - mine.y, wx - mine.x);
    const len = c.min + (c.max - c.min) * mine.ch;
    ctx.save(); ctx.translate(sx(mine.x), sy(mine.y)); ctx.rotate(an); ctx.scale(scale, scale);
    ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; ctx.setLineDash([12, 10]); ctx.strokeRect(0, -c.width / 2, c.max, c.width); ctx.setLineDash([]);
    ctx.fillStyle = mine.hl > 0.8 ? '#ff8a6a44' : '#8fd0ff44'; ctx.strokeStyle = '#dff2ff'; ctx.lineWidth = 3; ctx.fillRect(0, -c.width / 2, len, c.width); ctx.strokeRect(0, -c.width / 2, len, c.width);
    ctx.restore();
  }
  if (mine && pendingA && me) { ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx(mine.x), sy(mine.y), (me.range + hello.rules.heroRadius) * scale, 0, 7); ctx.stroke(); }
  ctx.restore();
  gfxCleanup(now);
  // minimap strip
  const mw = Math.min(520, W * 0.4), mx = W - mw - 10, myy = 10, mh = 26;
  ctx.fillStyle = '#0c141acc'; ctx.fillRect(mx, myy, mw, mh); ctx.strokeStyle = '#33485a'; ctx.lineWidth = 1; ctx.strokeRect(mx, myy, mw, mh);
  for (const u of live) { ctx.fillStyle = TEAM[u.t]; const r = u.k === 'h' ? 5 : u.k === 't' ? 6 : 2;
    ctx.fillRect(mx + u.x / M.w * mw - r / 2, myy + 4 + (u.y - M.top) / (M.bot - M.top) * (mh - 8) - r / 2, r, r); }
  ctx.strokeStyle = '#fff8'; ctx.strokeRect(mx + (cam.x - halfW) / M.w * mw, myy, Math.min(mw, halfW * 2 / M.w * mw), mh);
  if (barrage) { ctx.fillStyle = '#dff2ff'; ctx.font = 'bold 20px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000c';
    const txt = `${mine.bg} shot${mine.bg > 1 ? 's' : ''} left · ${me.bt.toFixed(1)}s · R to fire, S to end`; ctx.strokeText(txt, W / 2, H * 0.2); ctx.fillText(txt, W / 2, H * 0.2); }
  // death overlay
  if (showGhost && meUnit && mine) {   // debug: the server's position for your hero, and how far the prediction is from it
    ctx.strokeStyle = '#ff4fd8'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.arc(sx(meUnit.x), sy(meUnit.y), hello.rules.heroRadius * scale, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(sx(meUnit.x), sy(meUnit.y)); ctx.lineTo(sx(mine.x), sy(mine.y)); ctx.stroke();
    ctx.fillStyle = '#ff4fd8'; ctx.font = '12px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(`${pred.mode} · ahead of server ${Math.hypot(mine.x - meUnit.x, mine.y - meUnit.y) | 0} · last error ${predErr.toFixed(1)} · ping ${ping}ms`, sx(meUnit.x) + 70 * scale, sy(meUnit.y) + 90 * scale);
  }
  if (meUnit && meUnit.d) { ctx.fillStyle = '#0009'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = 'bold 34px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(`Respawning in ${meUnit.d}`, W / 2, H * 0.3); }
  updateHud();
}
Settings.load().then(() => { connect(); frame(); });
