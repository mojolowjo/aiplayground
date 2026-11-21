'use strict';
// Player settings and the menu that edits them. One file, used in two places: the game page, and the
// desktop app's start screen (desktop/scripts/sync-shared.js copies it there).
//
// In the desktop app (window.laneDuelApp exists) settings are kept by the app, and every option is offered.
// In a normal browser only the two network settings exist, kept in localStorage; everything else stays at
// its default, which is how the game has always drawn.
const Settings = (() => {
  // The same lists as desktop/lib.js (the desktop test compares them).
  const OPTIONS = {
    fpsLimit: ['auto', 30, 60, 120, 144, 240, 0],    // 'auto' = the monitor's refresh rate, 0 = unlimited
    renderScale: [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
    effects: ['low', 'medium', 'high'],
    windowMode: ['windowed', 'borderless', 'fullscreen'],
    smoothing: [30, 45, 60, 90, 120],
  };
  const DEFAULTS = { fpsLimit: 'auto', vsync: true, renderScale: 100, effects: 'high', windowMode: 'windowed', hwAccel: true, smoothing: 60, overlay: false };
  const BROWSER_KEYS = ['smoothing', 'overlay'], STORE = 'ldSettings';
  const TEXT = {
    fpsLimit: v => (v === 'auto' ? `Monitor refresh${meta.refreshRate ? ` (${meta.refreshRate})` : ''}` : v === 0 ? 'Unlimited' : String(v)),
    renderScale: v => v + '%',
    effects: v => ({ low: 'Low', medium: 'Medium', high: 'High' })[v],
    windowMode: v => ({ windowed: 'Windowed', borderless: 'Borderless fullscreen', fullscreen: 'Fullscreen' })[v],
    smoothing: v => v + ' ms',
  };
  const SMOOTHING_TIP = 'Lower feels snappier but can stutter on a bad connection. Higher is smoother but shows other units slightly later.';
  const EFFECTS_TIP = 'Low: no particles, no glow, no screen shake, at most 10 damage numbers. Medium: half the particles, glow on abilities only. High: everything.';
  const CSS = `
    .ldset-back { position: fixed; inset: 0; background: #000a; z-index: 50; display: flex; align-items: center; justify-content: center; font: 14px system-ui, sans-serif; color: #e8eee9; user-select: none; }
    .ldset { background: #16212a; border: 1px solid #33485a; border-radius: 10px; padding: 18px 22px; width: min(520px, 92vw); max-height: 90vh; overflow: auto; box-shadow: 0 10px 40px #000a; }
    .ldset h2 { margin: 0 0 6px; font-size: 20px; } .ldset h3 { margin: 14px 0 4px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8a9aa5; }
    .ldset .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; }
    .ldset .row > span { flex: 1; min-width: 0; } .ldset .row > select, .ldset .row > input { flex: none; }
    .ldset .row small, .ldset .note { display: block; color: #8a9aa5; font-size: 12px; line-height: 1.4; }
    .ldset .warn { color: #e0b060; }
    .ldset select { background: #0f181e; color: #e8eee9; border: 1px solid #3a4c5a; border-radius: 5px; padding: 4px 6px; font: inherit; min-width: 150px; }
    .ldset input[type=checkbox] { width: 18px; height: 18px; }
    .ldset .foot { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px; }
    .ldset button { background: #2c6e49; color: #fff; border: 0; border-radius: 6px; padding: 7px 14px; font: inherit; cursor: pointer; }
    .ldset button.plain { background: #24323c; } .ldset button.go { background: #b7791f; }`;

  const app = window.laneDuelApp || null;
  let cfg = { ...DEFAULTS }, meta = {}, box = null, buttons = [];
  const subs = [];
  const fire = () => { for (const f of subs) f(cfg, meta); if (box) render(); };
  function take(view) { if (!view) return; cfg = { ...DEFAULTS, ...view.settings }; meta = view.meta || {}; fire(); }

  // Read the saved settings. Safe to call again whenever they may have changed.
  async function load() {
    if (app) { try { take(await app.getSettings()); } catch { /* keep what we have */ } return cfg; }
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
      if (OPTIONS.smoothing.includes(saved.smoothing)) cfg.smoothing = saved.smoothing;
      if (typeof saved.overlay === 'boolean') cfg.overlay = saved.overlay;
    } catch { /* storage blocked or garbled: defaults */ }
    fire(); return cfg;
  }
  function set(partial) {
    Object.assign(cfg, partial);
    if (app) app.setSettings(partial).then(take, () => {});
    else try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(BROWSER_KEYS.map(k => [k, cfg[k]])))); } catch { /* not saved; still applies until the page closes */ }
    fire();
  }
  if (app) addEventListener('laneduel-settings', load);

  // ---------- the menu ----------
  function el(tag, props, ...kids) { const e = Object.assign(document.createElement(tag), props || {}); for (const k of kids) if (k) e.append(k); return e; }
  function choice(key, label, hint) {
    const sel = el('select'); for (const v of OPTIONS[key]) sel.append(el('option', { value: String(v), textContent: TEXT[key](v), selected: cfg[key] === v }));
    sel.onchange = () => set({ [key]: OPTIONS[key][sel.selectedIndex] });
    return el('label', { className: 'row', title: hint || '' }, el('span', null, label, hint ? el('small', { textContent: hint }) : null), sel);
  }
  function toggle(key, label, hint) {
    const box = el('input', { type: 'checkbox', checked: !!cfg[key] }); box.onchange = () => set({ [key]: box.checked });
    return el('label', { className: 'row', title: hint || '' }, el('span', null, label, hint ? el('small', { textContent: hint }) : null), box);
  }
  function render() {
    const p = el('div', { className: 'ldset' }, el('h2', { textContent: 'Settings' }));
    if (app) {
      const hz = meta.refreshRate || 60, over = cfg.vsync && (cfg.fpsLimit === 0 || cfg.fpsLimit > hz);
      p.append(el('h3', { textContent: 'Performance' }), choice('fpsLimit', 'FPS limit', 'How many frames are drawn each second.'));
      if (over) p.append(el('div', { className: 'note warn', textContent: `With V-Sync on, the game cannot draw faster than your monitor (${hz}). Turn V-Sync off to go above it.` }));
      p.append(
        toggle('vsync', 'V-Sync', 'Matches frames to the monitor. Off allows more frames but can tear. Needs a restart.'),
        choice('renderScale', 'Render scale', 'Draws the battlefield smaller and stretches it. The HUD and text stay sharp.'),
        choice('effects', 'Effects quality', EFFECTS_TIP),
        choice('windowMode', 'Window mode'),
        toggle('hwAccel', 'Hardware acceleration', 'Uses the graphics card. Turn off only if the game looks wrong. Needs a restart.'));
    }
    p.append(el('h3', { textContent: 'Network' }),
      choice('smoothing', 'Smoothing', SMOOTHING_TIP),
      toggle('overlay', 'Performance overlay', 'Shows FPS, ping and jitter in a corner.'));
    if (app && meta.dataDir) p.append(el('div', { className: 'note' + (meta.fallback ? ' warn' : ''), textContent: meta.fallback
      ? `The folder next to the app could not be written (${meta.wantedDir}), so settings are kept in your user folder instead: ${meta.dataDir}`
      : `Settings are kept in: ${meta.dataDir}` }));
    const foot = el('div', { className: 'foot' });
    if (app && meta.restartNeeded) foot.append(el('button', { className: 'go', textContent: 'Restart to apply', onclick: () => app.restartApp() }));
    for (const b of buttons) foot.append(el('button', { className: 'plain', textContent: b.label, onclick: b.onClick }));
    foot.append(el('button', { textContent: 'Close', onclick: close }));
    p.append(foot);
    box.replaceChildren(p);
  }
  // extra = [{ label, onClick }]: buttons the page wants beside Close (the game adds "Back to server list").
  function open(extra) {
    if (box) return;
    if (!document.getElementById('ldset-css')) document.head.append(el('style', { id: 'ldset-css', textContent: CSS }));
    buttons = extra || [];
    box = el('div', { className: 'ldset-back' });
    box.addEventListener('mousedown', e => { e.stopPropagation(); if (e.target === box) close(); });
    for (const ev of ['mouseup', 'click', 'contextmenu', 'wheel']) box.addEventListener(ev, e => e.stopPropagation());
    document.body.append(box); render();
  }
  function close() { if (box) { box.remove(); box = null; } }

  return { OPTIONS, DEFAULTS, SMOOTHING_TIP, inApp: !!app, get cfg() { return cfg; }, get meta() { return meta; },
    load, set, open, close, isOpen: () => !!box, onChange: f => { subs.push(f); } };
})();
