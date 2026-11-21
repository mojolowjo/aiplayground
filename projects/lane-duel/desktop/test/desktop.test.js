'use strict';
// Checks for the desktop app that need no Electron and no window: the real main process (../main.js) and
// preload are loaded with a stand-in `electron` module, with a temporary folder playing "next to the executable".
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const Module = require('node:module'), { pathToFileURL } = require('node:url');
const lib = require('../lib');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneduel-test-'));
const START = pathToFileURL(path.join(__dirname, '..', 'start', 'index.html')).href;

// ---------- a stand-in for Electron that records what the app asks of it ----------
function fakeElectron() {
  const rec = { paths: {}, switches: [], hwOff: false, opened: [], handlers: {}, windows: [], relaunch: null, exited: false, sent: [], exposed: null, menu: 'unset', perm: null };
  class WebContents {
    constructor() { this.listeners = {}; this.url = ''; this.mainFrame = { get url() { return rec.windows[0].webContents.url; } }; }
    on(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, ...args) { const e = { prevented: false, preventDefault() { this.prevented = true; } }; for (const f of this.listeners[name] || []) f(e, ...args); return e; }
    getURL() { return this.url; }
    send(ch) { rec.sent.push(ch); }
    setWindowOpenHandler(fn) { this.openHandler = fn; }
  }
  class BrowserWindow {
    constructor(opts) { this.opts = opts; this.webContents = new WebContents(); this.kiosk = false; this.full = false; rec.windows.push(this); }
    on() {} isDestroyed() { return false; } isKiosk() { return this.kiosk; } setKiosk(v) { this.kiosk = v; } isFullScreen() { return this.full; } setFullScreen(v) { this.full = v; }
    isMinimized() { return false; } isMaximized() { return false; } getBounds() { return { x: 0, y: 0, width: 1280, height: 720 }; }
    loadFile(file, o) { this.webContents.url = pathToFileURL(file).href + (o && o.query ? '?' + new URLSearchParams(o.query) : ''); }
  }
  const app = {
    getPath: () => { const d = path.join(tmp, 'normal-user-data'); fs.mkdirSync(d, { recursive: true }); return d; },   // like Electron, which makes this folder as it starts
    setPath: (k, v) => { rec.paths[k] = v; }, setAppLogsPath: v => { rec.paths.logs = v; },
    commandLine: { appendSwitch: s => rec.switches.push(s) }, disableHardwareAcceleration: () => { rec.hwOff = true; },
    requestSingleInstanceLock: () => true, on() {}, quit() {}, whenReady: () => Promise.resolve(), getVersion: () => '1.0.0',
    relaunch: o => { rec.relaunch = o; }, exit: () => { rec.exited = true; },
  };
  return { rec, electron: {
    app, BrowserWindow, Menu: { setApplicationMenu: m => { rec.menu = m; } },
    ipcMain: { handle: (ch, fn) => { rec.handlers[ch] = fn; } }, shell: { openExternal: u => { rec.opened.push(u); } },
    screen: { getPrimaryDisplay: () => ({ displayFrequency: 60 }), getDisplayMatching: () => ({ displayFrequency: 144 }), getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    session: { defaultSession: { setPermissionRequestHandler: f => { rec.perm = f; }, setPermissionCheckHandler() {} } },
    net: { fetch: async () => ({ ok: true, json: async () => [{ tag_name: 'lane-duel-v1.2.0' }, { tag_name: 'lane-duel-v9.0.0', draft: true }, { tag_name: 'other-v5.0.0' }] }) },
    contextBridge: { exposeInMainWorld: (name, api) => { rec.exposed = { name, api }; } }, ipcRenderer: { on() {}, invoke: async () => null },
  } };
}
// Load a file from the app as if Electron had started it, with `env` added to the environment.
async function boot(file, env = {}) {
  const fake = fakeElectron(), realLoad = Module._load, saved = { ...process.env };
  Module._load = function (request, ...rest) { return request === 'electron' ? fake.electron : realLoad.call(this, request, ...rest); };
  for (const k of ['PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_FILE', 'APPIMAGE']) delete process.env[k];
  Object.assign(process.env, env);
  const full = require.resolve(file); delete require.cache[full];
  try { require(full); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); }
  finally { Module._load = realLoad; process.env = saved; }
  return fake.rec;
}

(async () => {
  // ---------- 1. addresses ----------
  assert.equal(lib.normalizeAddress('1.2.3.4'), 'http://1.2.3.4:3000', 'a bare address gets http and port 3000');
  assert.equal(lib.normalizeAddress('  my-pc.duckdns.org  '), 'http://my-pc.duckdns.org:3000');
  assert.equal(lib.normalizeAddress('host:4000'), 'http://host:4000');
  assert.equal(lib.normalizeAddress('http://host:4000/'), 'http://host:4000');
  assert.equal(lib.normalizeAddress('http://host'), 'http://host:3000');
  assert.equal(lib.normalizeAddress('https://play.example.com'), 'https://play.example.com', 'https keeps its own port');
  assert.equal(lib.normalizeAddress('HTTP://Host:3000/some/page?x=1'), 'http://host:3000', 'only the server part is kept');
  for (const bad of ['', '   ', 'two words', 'ftp://host', 'javascript:alert(1)', 'file:///etc/passwd', 'http://user:pw@host', 'http://', 'x'.repeat(300)])
    assert.equal(lib.normalizeAddress(bad), null, 'not an address: ' + bad.slice(0, 30));
  console.log('addresses ok');

  // ---------- 2. settings ----------
  assert.deepEqual(lib.sanitize({}), lib.DEFAULTS);
  const s = lib.sanitize({ fpsLimit: 144, renderScale: 75, effects: 'low', windowMode: 'borderless', smoothing: 45, vsync: false, overlay: true, junk: 1,
    servers: [{ name: 'Mine', address: '10.0.0.5' }, { address: '10.0.0.5:3000' }, { address: 'nope nope' }, { name: 'x'.repeat(99), address: 'b.example:81' }] });
  assert(s.fpsLimit === 144 && s.renderScale === 75 && s.effects === 'low' && s.windowMode === 'borderless' && s.smoothing === 45 && !s.vsync && s.overlay && !('junk' in s));
  assert.deepEqual(s.servers.map(x => x.address), ['http://10.0.0.5:3000', 'http://b.example:81'], 'servers are normalised; duplicates and non-addresses are dropped');
  assert(s.servers[1].name.length === 40, 'names are cut to length');
  const bad = lib.sanitize({ fpsLimit: 61, renderScale: 52, effects: 'ultra', smoothing: '60', vsync: 'yes', servers: 'x', bounds: { width: 5, height: 5 } });
  assert.deepEqual(bad, lib.DEFAULTS, 'invalid values fall back to the defaults');
  // the menu (public/settings-menu.js) offers exactly the choices the app accepts
  const box = { window: {}, addEventListener() {}, localStorage: {}, out: null };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'settings-menu.js'), 'utf8') + '\nout = { OPTIONS: Settings.OPTIONS, DEFAULTS: Settings.DEFAULTS };', box);
  assert.deepEqual(JSON.parse(JSON.stringify(box.out.OPTIONS)), lib.OPTIONS, 'the menu and the app agree on the options');
  for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(box.out.DEFAULTS)))) assert.deepEqual(v, lib.DEFAULTS[k], 'same default for ' + k);
  console.log('settings ok');

  // ---------- 3. where the data folder goes ----------
  const exeDir = path.join(tmp, 'Downloads'); fs.mkdirSync(exeDir);
  assert.deepEqual(lib.pickDataDir({ env: { PORTABLE_EXECUTABLE_DIR: exeDir }, normalDir: '/n' }), { dir: path.join(exeDir, 'LaneDuel-data'), portable: true, fallback: false });
  assert.equal(lib.pickDataDir({ env: { APPIMAGE: path.join(exeDir, 'LaneDuel-1.0.0.AppImage') }, normalDir: '/n' }).dir, path.join(exeDir, 'LaneDuel-data'), 'an AppImage keeps it beside the AppImage');
  assert.deepEqual(lib.pickDataDir({ env: {}, normalDir: '/n' }), { dir: '/n', portable: false, fallback: false }, 'run from source: the normal folder');
  const blocker = path.join(tmp, 'a-file'); fs.writeFileSync(blocker, '');       // a folder cannot be made inside a file
  const fb = lib.pickDataDir({ env: { PORTABLE_EXECUTABLE_DIR: blocker }, normalDir: '/n' });
  assert(fb.dir === '/n' && fb.fallback && !fb.portable && fb.wanted === path.join(blocker, 'LaneDuel-data'), 'not writable: fall back and say so');
  console.log('data folder ok');

  // ---------- 4. navigation rules ----------
  const nav = (target, current, allowedOrigin) => lib.navigationVerdict(target, { current, startUrl: START, allowedOrigin, serverOrigins: ['http://1.2.3.4:3000'] });
  assert.equal(nav('http://1.2.3.4:3000/', START, null), 'allow', 'start screen -> a listed server');
  assert.equal(nav('http://6.6.6.6:3000/', START, null), 'external', 'start screen -> anything else goes to the browser');
  assert.equal(nav('http://1.2.3.4:3000/?room=x', 'http://1.2.3.4:3000/', 'http://1.2.3.4:3000'), 'allow', 'within the server');
  assert.equal(nav('http://1.2.3.4:4000/', 'http://1.2.3.4:3000/', 'http://1.2.3.4:3000'), 'external', 'another port is another origin');
  assert.equal(nav('https://github.com/x', 'http://1.2.3.4:3000/', 'http://1.2.3.4:3000'), 'external');
  assert.equal(nav(START, 'http://1.2.3.4:3000/', 'http://1.2.3.4:3000'), 'block', 'a page cannot send the window to the start screen');
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'not a url']) assert.equal(nav(u, 'http://1.2.3.4:3000/', 'http://1.2.3.4:3000'), 'block', u);
  console.log('navigation rules ok');

  // ---------- 5. update check ----------
  assert.deepEqual(lib.findUpdate([{ tag_name: 'lane-duel-v1.2.0' }, { tag_name: 'lane-duel-v1.10.0' }, { tag_name: 'lane-duel-v2.0.0', prerelease: true }, { tag_name: 'v9.9.9' }], '1.2.0'), { version: '1.10.0', tag: 'lane-duel-v1.10.0' });
  assert.equal(lib.findUpdate([{ tag_name: 'lane-duel-v1.2.0' }], '1.2.0'), null); assert.equal(lib.findUpdate('garbage', '1.0.0'), null);
  console.log('update check ok');

  // ---------- 6. the real main process, started as the Windows portable build would start it ----------
  const dataDir = path.join(exeDir, 'LaneDuel-data'), file = path.join(dataDir, 'settings.json');
  let rec = await boot('../main.js', { PORTABLE_EXECUTABLE_DIR: exeDir, PORTABLE_EXECUTABLE_FILE: path.join(exeDir, 'LaneDuel-1.0.0.exe') });
  assert.equal(rec.paths.userData, dataDir, 'everything Electron stores goes next to the executable');
  assert(rec.paths.sessionData === dataDir && rec.paths.crashDumps.startsWith(dataDir) && rec.paths.logs.startsWith(dataDir));
  assert(rec.switches.length === 0 && !rec.hwOff && rec.menu === null, 'defaults: V-Sync on, hardware acceleration on, no menu bar');
  const win = rec.windows[0], wc = win.webContents, prefs = win.opts.webPreferences;
  assert(prefs.contextIsolation === true && prefs.nodeIntegration === false && prefs.sandbox === true, 'the window is locked down');
  assert(win.opts.width === 1280 && win.opts.height === 720 && win.opts.title === 'Lane Duel' && wc.url === START);
  const frame = { get url() { return wc.url; } }; wc.mainFrame = frame;
  const call = (ch, ...args) => rec.handlers[ch]({ senderFrame: frame }, ...args);

  // settings are saved next to the executable, and a typed address becomes a full one
  let v = call('ld:set', { smoothing: 30, servers: [{ name: 'Friend', address: '1.2.3.4' }] });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(onDisk.smoothing === 30 && onDisk.servers[0].address === 'http://1.2.3.4:3000', 'settings.json sits in LaneDuel-data beside the executable');
  assert(v.settings.servers[0].address === 'http://1.2.3.4:3000' && v.meta.dataDir === dataDir && v.meta.portable && !v.meta.fallback && v.meta.refreshRate === 144 && v.meta.version === '1.0.0');
  assert.equal(v.meta.defaultServer.address, 'http://73.157.4.152:3000', 'the default server comes from default-server.json');
  assert.deepEqual(call('ld:get').meta.update, { version: '1.2.0', url: 'https://github.com/mojolowjo/aiplayground/releases/tag/lane-duel-v1.2.0' }, 'a newer release is offered as a link');
  assert(rec.sent.includes('ld:changed'), 'the page is told when settings change');
  assert.equal(fs.readdirSync(path.join(tmp, 'Downloads')).join(), 'LaneDuel-data', 'nothing else is written beside it');
  assert(!fs.existsSync(path.join(tmp, 'normal-user-data')), 'and the empty folder Electron makes in the normal place is removed');

  // a restart-only setting asks for a restart, and the restart starts the downloaded file again
  assert.equal(call('ld:set', { vsync: false }).meta.restartNeeded, true);
  call('ld:restart'); assert(rec.exited && rec.relaunch.execPath === path.join(exeDir, 'LaneDuel-1.0.0.exe'));

  // window modes
  assert(call('ld:fullscreen', 'borderless') && win.full && !win.kiosk); assert(call('ld:fullscreen', 'fullscreen') && win.kiosk);
  assert(call('ld:fullscreen', 'windowed') && !win.full && !win.kiosk); assert.equal(call('ld:fullscreen', 'huge'), false);

  // links: http/https go to the system browser, nothing else does
  assert(call('ld:external', 'https://github.com/mojolowjo/aiplayground/releases') && rec.opened.length === 1);
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://x/y', '']) assert.equal(call('ld:external', u), false);
  assert.equal(rec.opened.length, 1);

  // navigation: start screen -> the saved server is allowed; from there, another origin is blocked
  assert.equal(wc.emit('will-navigate', 'http://9.9.9.9:3000/').prevented, true, 'a server that is not on the list is not loaded in the window');
  assert.equal(wc.emit('will-navigate', 'http://1.2.3.4:3000/').prevented, false);
  wc.url = 'http://1.2.3.4:3000/';
  rec.opened.length = 0;
  assert.equal(wc.emit('will-navigate', 'http://1.2.3.4:3000/?room=two').prevented, false, 'the server may move within itself');
  assert(wc.emit('will-navigate', 'https://evil.example/').prevented && rec.opened[0] === 'https://evil.example/', 'another origin is blocked and handed to the browser');
  assert(wc.emit('will-redirect', 'http://evil.example:3000/').prevented, 'redirects are held to the same rule');
  assert(wc.emit('will-navigate', 'file:///etc/passwd').prevented && wc.emit('will-navigate', START).prevented && rec.opened.length === 2, 'local files are simply refused');
  assert.deepEqual(wc.openHandler({ url: 'https://example.com/' }), { action: 'deny' }, 'no pop-up windows');
  let granted = null; rec.perm(null, 'media', ok => { granted = ok; }); assert.equal(granted, false, 'no camera or microphone');

  // a game server's page gets the settings but not the server list, and cannot change it
  v = call('ld:get'); assert(v.settings.smoothing === 30 && !('servers' in v.settings) && !('defaultServer' in v.meta));
  call('ld:set', { servers: [{ address: 'evil.example' }], effects: 'low' });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(after.effects === 'low' && after.servers.length === 1 && after.servers[0].address === 'http://1.2.3.4:3000', 'a server page can change performance settings, never the server list');
  // a page from anywhere else gets nothing
  wc.url = 'https://evil.example/';
  assert(call('ld:get') === null && call('ld:set', { effects: 'high' }) === null && call('ld:external', 'https://x.example') === false && call('ld:back') === false);
  assert.equal(rec.handlers['ld:get']({ senderFrame: { url: START } }), null, 'nor does a frame that is not the window\'s own page');
  // back to the list
  wc.url = 'http://1.2.3.4:3000/'; assert(call('ld:back') && wc.url === START);
  wc.url = 'http://1.2.3.4:3000/'; assert.equal(call('ld:get'), null, 'after going back, the old server is no longer trusted');
  // a server that does not answer sends the player back to the list with a message
  wc.url = START; wc.emit('will-navigate', 'http://1.2.3.4:3000/'); wc.emit('did-fail-load', -102, 'REFUSED', 'http://1.2.3.4:3000/', true);
  assert(wc.url.startsWith(START + '?failed='));
  console.log('main process ok');

  // ---------- 7. next start: the saved choices are applied, V-Sync off and hardware acceleration off ----------
  fs.writeFileSync(file, JSON.stringify({ ...after, vsync: false, hwAccel: false, windowMode: 'borderless' }));
  rec = await boot('../main.js', { PORTABLE_EXECUTABLE_DIR: exeDir });
  assert.deepEqual(rec.switches, ['disable-gpu-vsync', 'disable-frame-rate-limit']); assert(rec.hwOff && rec.windows[0].full);
  // Linux: an AppImage keeps its data beside the AppImage file
  const appDir = path.join(tmp, 'Apps'); fs.mkdirSync(appDir);
  rec = await boot('../main.js', { APPIMAGE: path.join(appDir, 'LaneDuel-1.0.0.AppImage') });
  assert.equal(rec.paths.userData, path.join(appDir, 'LaneDuel-data'));
  // not writable: the normal folder is used and Settings is told
  rec = await boot('../main.js', { PORTABLE_EXECUTABLE_DIR: blocker });
  assert(!('userData' in rec.paths), 'the normal user data folder is left in place');
  const w2 = rec.windows[0].webContents, f2 = { get url() { return w2.url; } }; w2.mainFrame = f2;
  const m2 = rec.handlers['ld:get']({ senderFrame: f2 }).meta;
  assert(m2.fallback && m2.dataDir === path.join(tmp, 'normal-user-data') && m2.wantedDir === path.join(blocker, 'LaneDuel-data'));
  console.log('restart settings and fallback ok');

  // ---------- 8. the preload gives pages six functions and nothing else ----------
  global.window = { dispatchEvent() {} };
  rec = await boot('../preload.js');
  assert.equal(rec.exposed.name, 'laneDuelApp');
  assert.deepEqual(Object.keys(rec.exposed.api).sort(), ['backToStart', 'getSettings', 'openExternal', 'restartApp', 'setFullscreen', 'setSettings']);
  console.log('preload ok');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('all desktop checks passed');
})().catch(e => { console.error(e); process.exit(1); });
