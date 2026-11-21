'use strict';
// Everything the desktop app decides that does not need Electron: where settings live, what a typed server
// address means, which settings are valid, and where the window may navigate. Plain Node, so the test
// (test/desktop.test.js) can check it directly.
const fs = require('node:fs'), path = require('node:path');

const DATA_FOLDER = 'LaneDuel-data';     // sits next to the downloaded file; deleting both removes everything
const DEFAULT_PORT = 3000;               // the port a Lane Duel server listens on unless told otherwise
const MAX_SERVERS = 50, MAX_NAME = 40;
const RELEASE_TAG = /^lane-duel-v(\d+\.\d+\.\d+)$/;

// Every choice the settings screen offers. public/settings-menu.js carries the same lists (the test compares them).
const OPTIONS = {
  fpsLimit: ['auto', 30, 60, 120, 144, 240, 0],    // 'auto' = the monitor's refresh rate, 0 = the highest (500, see settings-menu.js)
  renderScale: [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  effects: ['low', 'medium', 'high'],
  windowMode: ['windowed', 'borderless', 'fullscreen'],
  smoothing: [30, 45, 60, 90, 120],
};
const DEFAULTS = {
  fpsLimit: 'auto', vsync: true, renderScale: 100, effects: 'high', windowMode: 'windowed', hwAccel: true,
  smoothing: 60, overlay: false,
  servers: [], hideDefault: false, bounds: null,
};
const RESTART_KEYS = ['vsync', 'hwAccel'];   // these only take effect when the app starts

// "1.2.3.4", "host:4000", "http://host:4000" -> "http://1.2.3.4:3000" and so on. null if it is not an address.
function normalizeAddress(text) {
  let s = String(text ?? '').trim();
  if (!s || s.length > 200 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  const m = /^(https?):\/\/([^/?#]*)/i.exec(s);
  if (!m) return null;
  let u; try { u = new URL(s); } catch { return null; }
  if (!u.hostname || u.username || u.password) return null;
  const saidPort = /:\d+$/.test(m[2]);
  const port = u.port || (saidPort ? '' : u.protocol === 'http:' ? String(DEFAULT_PORT) : '');
  return `${u.protocol}//${u.hostname}${port ? ':' + port : ''}`;
}
// The origin of an http(s) address, or null for anything else (file:, javascript:, garbage).
function originOf(url) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null; } catch { return null; }
}
function cleanServer(s) {
  if (!s || typeof s !== 'object') return null;
  const address = normalizeAddress(s.address); if (!address) return null;
  const name = String(s.name ?? '').trim().slice(0, MAX_NAME) || address.replace(/^https?:\/\//, '');
  return { name, address };
}
function readDefaultServer(file) {
  try { return cleanServer(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return null; }
}

// Keep only known settings with valid values; anything else falls back to `base` (the defaults, or what is saved).
function sanitize(raw, base = DEFAULTS) {
  const r = raw && typeof raw === 'object' ? raw : {}, out = { ...base };
  for (const k of Object.keys(OPTIONS)) if (OPTIONS[k].includes(r[k])) out[k] = r[k];
  for (const k of ['vsync', 'hwAccel', 'overlay', 'hideDefault']) if (typeof r[k] === 'boolean') out[k] = r[k];
  if (Array.isArray(r.servers)) {
    const seen = new Set(); out.servers = [];
    for (const s of r.servers.slice(0, MAX_SERVERS)) { const c = cleanServer(s); if (c && !seen.has(c.address)) { seen.add(c.address); out.servers.push(c); } }
  }
  const b = r.bounds;
  if (b && [b.width, b.height].every(n => Number.isFinite(n) && n >= 320 && n <= 20000))
    out.bounds = { width: Math.round(b.width), height: Math.round(b.height), ...(Number.isFinite(b.x) && Number.isFinite(b.y) ? { x: Math.round(b.x), y: Math.round(b.y) } : {}) };
  return out;
}
function loadSettings(file) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return sanitize({}); }
}
function saveSettings(file, settings) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(settings, null, 2)); return true; } catch { return false; }
}

function writable(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const probe = path.join(dir, '.write-test'); fs.writeFileSync(probe, ''); fs.rmSync(probe); return true; } catch { return false; }
}
// Where the app keeps everything. A downloaded build keeps it in LaneDuel-data next to the file the player
// double-clicked (the Windows portable build and the AppImage each say where that is). If that folder cannot
// be written (a read-only USB stick, say), the normal per-user folder is used instead and `fallback` is set.
function pickDataDir({ env, normalDir }) {
  const beside = env.PORTABLE_EXECUTABLE_DIR || (env.APPIMAGE ? path.dirname(env.APPIMAGE) : null);
  if (!beside) return { dir: normalDir, portable: false, fallback: false };       // run from source
  const dir = path.join(beside, DATA_FOLDER);
  return writable(dir) ? { dir, portable: true, fallback: false } : { dir: normalDir, portable: false, fallback: true, wanted: dir };
}

const samePage = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.protocol === y.protocol && x.host === y.host && x.pathname === y.pathname; } catch { return false; } };
// May the window go to `target`? 'allow', 'external' (open it in the system browser instead) or 'block'.
//   - From the start screen: only to a server on the player's list.
//   - From a game page: only within that server's own origin.
//   - The start screen itself is only reached through backToStart(), never by a page navigating to it.
function navigationVerdict(target, { current, startUrl, allowedOrigin, serverOrigins }) {
  const fromStart = samePage(current, startUrl);
  if (samePage(target, startUrl)) return fromStart ? 'allow' : 'block';
  const origin = originOf(target);
  if (!origin) return 'block';
  if (fromStart) return serverOrigins.includes(origin) ? 'allow' : 'external';
  return origin === allowedOrigin ? 'allow' : 'external';
}

// The newest published lane-duel-v* release that is newer than `current`, from GitHub's release list. null if none.
function newerVersion(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; }
function findUpdate(releases, current) {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    const m = r && !r.draft && !r.prerelease && RELEASE_TAG.exec(String(r.tag_name));
    if (m && /^\d+\.\d+\.\d+$/.test(current) && newerVersion(m[1], best ? best.version : current)) best = { version: m[1], tag: r.tag_name };
  }
  return best;
}

module.exports = { DATA_FOLDER, DEFAULT_PORT, OPTIONS, DEFAULTS, RESTART_KEYS, normalizeAddress, originOf, cleanServer, readDefaultServer,
  sanitize, loadSettings, saveSettings, pickDataDir, samePage, navigationVerdict, findUpdate };
