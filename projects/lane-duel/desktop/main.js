'use strict';
// The Lane Duel desktop app. It is a window, a start screen with a server list, and a settings file.
// The game itself is not in here: the window loads it from whichever server the player picks, exactly as
// a browser would, so the app never needs updating when the game changes.
const { app, BrowserWindow, Menu, ipcMain, shell, screen, session, net } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const lib = require('./lib');

const START_FILE = path.join(__dirname, 'start', 'index.html'), START_URL = pathToFileURL(START_FILE).href;
const RELEASES_API = 'https://api.github.com/repos/mojolowjo/aiplayground/releases?per_page=50';
const RELEASES_PAGE = 'https://github.com/mojolowjo/aiplayground/releases/tag/';
const SAVE_BOUNDS_AFTER = 500;   // ms of quiet after a resize or move before the window's place is saved
// The file the player double-clicked (both builds unpack themselves and run from a temporary copy).
const DOWNLOADED_FILE = process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE || process.execPath;
const DEFAULT_SERVER = lib.readDefaultServer(path.join(__dirname, 'default-server.json'));

// ---------- where everything is kept (must be decided before the app is ready) ----------
const NORMAL_DIR = app.getPath('userData');
const data = lib.pickDataDir({ env: process.env, normalDir: NORMAL_DIR });
// Electron makes its usual per-user folder as it starts, before this file can redirect it. It stays empty;
// remove it so nothing is left behind. (rmdir only ever removes an empty folder.)
const tidy = () => { if (data.portable) try { fs.rmdirSync(NORMAL_DIR); } catch { /* not there, or not empty: leave it */ } };
if (data.portable) {
  // Next to the downloaded file, so deleting the file and this folder leaves nothing behind.
  app.setPath('userData', data.dir); app.setPath('sessionData', data.dir);
  app.setPath('crashDumps', path.join(data.dir, 'crashes')); app.setAppLogsPath(path.join(data.dir, 'logs'));
}
const SETTINGS_FILE = path.join(data.dir, 'settings.json');
let settings = lib.loadSettings(SETTINGS_FILE);
const save = () => lib.saveSettings(SETTINGS_FILE, settings);

// ---------- settings that only work from the very start ----------
const boot = Object.fromEntries(lib.RESTART_KEYS.map(k => [k, settings[k]]));
if (!settings.vsync) { app.commandLine.appendSwitch('disable-gpu-vsync'); app.commandLine.appendSwitch('disable-frame-rate-limit'); }
if (!settings.hwAccel) app.disableHardwareAcceleration();

let win = null, allowedOrigin = null, update = null;
const currentUrl = () => (win && !win.isDestroyed() ? win.webContents.getURL() : '');
const onStart = () => lib.samePage(currentUrl(), START_URL);
const serverOrigins = () => [DEFAULT_SERVER, ...settings.servers].filter(Boolean).map(s => lib.originOf(s.address));

function openExternal(url) {
  const ok = lib.originOf(url);                       // http and https only
  if (ok) shell.openExternal(new URL(url).href);
  return !!ok;
}

// What a page is told. The server list is for the start screen only: a game server has no business reading it.
function view(forStart) {
  const { servers, hideDefault, bounds, ...shared } = settings;
  return {
    settings: forStart ? { ...shared, servers, hideDefault } : shared,
    meta: {
      version: app.getVersion(), refreshRate: Math.round((win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).displayFrequency) || 60,   // of the monitor the window is on
      dataDir: data.dir, portable: data.portable, fallback: data.fallback, wantedDir: data.wanted || null,
      restartNeeded: lib.RESTART_KEYS.some(k => settings[k] !== boot[k]), vsyncActive: boot.vsync,   // vsyncActive: what this run started with
      ...(forStart ? { defaultServer: DEFAULT_SERVER, update } : {}),
    },
  };
}
const announce = () => { if (win && !win.isDestroyed()) win.webContents.send('ld:changed'); };

function applyWindowMode() {
  if (!win || win.isDestroyed()) return;
  const mode = settings.windowMode;
  if (win.isKiosk() !== (mode === 'fullscreen')) win.setKiosk(mode === 'fullscreen');
  if (mode !== 'fullscreen' && win.isFullScreen() !== (mode === 'borderless')) win.setFullScreen(mode === 'borderless');
}

// Only the page in the window itself may talk to the app, and only while it is the start screen or the chosen server.
function caller(event) {
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || !frame || frame !== win.webContents.mainFrame) return null;
  if (lib.samePage(frame.url, START_URL)) return 'start';
  return allowedOrigin && lib.originOf(frame.url) === allowedOrigin ? 'game' : null;
}

ipcMain.handle('ld:get', e => { const who = caller(e); return who ? view(who === 'start') : null; });
ipcMain.handle('ld:set', (e, partial) => {
  const who = caller(e); if (!who) return null;
  const p = partial && typeof partial === 'object' ? { ...partial } : {};
  delete p.bounds; if (who !== 'start') { delete p.servers; delete p.hideDefault; }
  const before = settings.windowMode;
  settings = lib.sanitize(p, settings); save();
  if (settings.windowMode !== before) applyWindowMode();
  announce();
  return view(who === 'start');
});
ipcMain.handle('ld:fullscreen', (e, mode) => {
  if (!caller(e) || !lib.OPTIONS.windowMode.includes(mode)) return false;
  settings.windowMode = mode; save(); applyWindowMode(); announce(); return true;
});
ipcMain.handle('ld:restart', e => {
  if (!caller(e)) return false;
  save();
  app.relaunch({ execPath: DOWNLOADED_FILE, args: [] });
  app.exit(0); return true;
});
ipcMain.handle('ld:external', (e, url) => (caller(e) ? openExternal(url) : false));
ipcMain.handle('ld:back', e => { if (!caller(e)) return false; backToStart(); return true; });

function backToStart(query) { allowedOrigin = null; win.loadFile(START_FILE, query ? { query } : undefined); }

function createWindow() {
  const b = settings.bounds || {}, placed = Number.isFinite(b.x) && screen.getAllDisplays().some(d => b.x >= d.bounds.x - 50 && b.y >= d.bounds.y - 50 && b.x < d.bounds.x + d.bounds.width - 100 && b.y < d.bounds.y + d.bounds.height - 100);
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 720, ...(placed ? { x: b.x, y: b.y } : {}), minWidth: 800, minHeight: 500,
    title: 'Lane Duel', backgroundColor: '#0b1410', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, spellcheck: false },
  });
  const wc = win.webContents;
  win.on('page-title-updated', e => e.preventDefault());

  // Where the window may go: the start screen, and the server the player picked there. Anything else opens
  // in the system browser (http/https) or is dropped.
  const guard = (e, url) => {
    const verdict = lib.navigationVerdict(url, { current: currentUrl(), startUrl: START_URL, allowedOrigin, serverOrigins: serverOrigins() });
    if (verdict === 'allow') { if (onStart() && !lib.samePage(url, START_URL)) allowedOrigin = lib.originOf(url); return; }
    e.preventDefault();
    if (verdict === 'external') openExternal(url);
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  wc.on('will-prevent-unload', e => e.preventDefault());      // a page may not hold the window open
  // The server did not answer: go back to the list and say so, rather than leaving a blank error page.
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => { if (isMainFrame && code !== -3 && !lib.samePage(url, START_URL)) backToStart({ failed: lib.originOf(url) || '' }); });

  // Remember the window's size and place (as a normal window, not while it fills the screen).
  let timer = null;
  const remember = () => { clearTimeout(timer); timer = setTimeout(() => { if (win.isDestroyed() || win.isFullScreen() || win.isKiosk() || win.isMinimized() || win.isMaximized()) return; settings.bounds = lib.sanitize({ bounds: win.getBounds() }, settings).bounds; save(); }, SAVE_BOUNDS_AFTER); };
  win.on('resize', remember); win.on('move', remember);
  win.on('closed', () => { clearTimeout(timer); win = null; });

  applyWindowMode();
  win.loadFile(START_FILE);
}

// Is there a newer download? Only ever shown as a link on the start screen; nothing is downloaded.
async function checkForUpdate() {
  try {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LaneDuel-desktop' } });
    if (!res.ok) return;
    const found = lib.findUpdate(await res.json(), app.getVersion());
    if (found) { update = { version: found.version, url: RELEASES_PAGE + found.tag }; announce(); }
  } catch { /* offline, or GitHub said no: not worth a message */ }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('web-contents-created', (e, contents) => { contents.on('will-attach-webview', ev => ev.preventDefault()); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', tidy);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);                    // no menu bar, so no browser shortcuts (reload, dev tools, zoom)
    // Pages may copy the join link to the clipboard. Nothing else is granted (camera, location, notifications...).
    const granted = new Set(['clipboard-sanitized-write']);
    session.defaultSession.setPermissionRequestHandler((wc, permission, done) => done(granted.has(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => granted.has(permission));
    tidy();
    createWindow();
    checkForUpdate();
  });
}
