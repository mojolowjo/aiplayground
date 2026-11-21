'use strict';
// The start screen: the server list, with a live ping for each, and the way into Settings.
// Everything it knows comes from the app through window.laneDuelApp (see ../preload.js).
const PING_EVERY = 4000, PING_TIMEOUT = 3000;   // ms
const $ = id => document.getElementById(id);
const pings = new Map();                        // address -> ms, or null while offline
let state = { servers: [], hideDefault: false }, meta = {};

function rows() {
  const def = meta.defaultServer && !state.hideDefault ? [{ ...meta.defaultServer, fixed: true }] : [];
  return [...def, ...state.servers.filter(s => !meta.defaultServer || s.address !== meta.defaultServer.address)];
}
const saveServers = servers => Settings.set({ servers });
function connect(s) { location.href = s.address + '/'; }

function render() {
  const list = rows(), box = $('servers');
  box.replaceChildren(...list.map(s => {
    const row = document.createElement('div'); row.className = 'server'; row.ondblclick = () => connect(s);
    const who = document.createElement('div'); who.className = 'who';
    const name = document.createElement('b'); name.textContent = s.name;
    const addr = document.createElement('small'); addr.textContent = s.address.replace(/^http:\/\//, '');
    who.append(name, addr);
    const ping = document.createElement('span'); ping.dataset.ping = s.address;
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; b.className = cls; b.onclick = e => { e.stopPropagation(); fn(); }; b.ondblclick = e => e.stopPropagation(); return b; };
    row.append(who, ping);
    if (s.fixed) row.append(btn('Hide', 'mini', () => Settings.set({ hideDefault: true })));
    else row.append(
      btn('Rename', 'mini', () => rename(s, name)),
      btn('Remove', 'mini', () => saveServers(state.servers.filter(o => o.address !== s.address))));
    row.append(btn('Connect', '', () => connect(s)));
    return row;
  }));
  if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'No servers yet. Add one below.'; box.append(e); }
  $('showDefault').hidden = !(meta.defaultServer && state.hideDefault);
  $('version').textContent = meta.version ? 'Version ' + meta.version : '';
  const up = $('update'); up.hidden = !meta.update;
  if (meta.update) { up.textContent = `Version ${meta.update.version} is available — open the download page`; up.onclick = e => { e.preventDefault(); window.laneDuelApp.openExternal(meta.update.url); }; }
  showPings();
}
// Renaming happens in place: the name turns into a text box until Enter or a click elsewhere.
function rename(s, label) {
  const input = document.createElement('input'); input.value = s.name; input.maxLength = 40;
  const done = keep => { const name = input.value.trim(); if (keep && name && name !== s.name) saveServers(state.servers.map(o => (o.address === s.address ? { ...o, name } : o))); else render(); };
  input.onkeydown = e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
  input.onblur = () => done(true); input.ondblclick = e => e.stopPropagation();
  label.replaceWith(input); input.focus(); input.select();
}
function showPings() {
  for (const e of document.querySelectorAll('[data-ping]')) {
    const ms = pings.get(e.dataset.ping);
    e.className = 'ping' + (ms == null ? ' off' : ''); e.textContent = ms === undefined ? '…' : ms === null ? 'offline' : ms + ' ms';
  }
}
// Time a tiny request to each server's /ping. No answer in time counts as offline.
async function pingOne(address) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), PING_TIMEOUT), t0 = performance.now();
  try { await fetch(address + '/ping', { mode: 'no-cors', cache: 'no-store', signal: stop.signal }); pings.set(address, Math.max(1, Math.round(performance.now() - t0))); }
  catch { pings.set(address, null); }
  clearTimeout(timer); showPings();
}
const pingAll = () => { for (const s of rows()) pingOne(s.address); };

$('add').onsubmit = async e => {
  e.preventDefault();
  const before = state.servers.length, wanted = { name: $('addName').value, address: $('addAddress').value };
  const view = await window.laneDuelApp.setSettings({ servers: [...state.servers, wanted] });
  const ok = !!view && view.settings.servers.length > before;        // the app drops anything that is not an address
  $('addError').hidden = ok;
  if (ok) $('addName').value = $('addAddress').value = '';
};
$('showDefault').onclick = () => Settings.set({ hideDefault: false });
$('settings').onclick = () => Settings.open();
$('quit').onclick = () => window.close();
addEventListener('keydown', e => { if (e.key === 'Escape') Settings.close(); });

const failed = new URLSearchParams(location.search).get('failed');
if (failed) { $('notice').hidden = false; $('notice').textContent = `Could not reach ${failed.replace(/^http:\/\//, '')}. Is the server running?`; }

Settings.onChange((cfg, m) => {
  state = { servers: cfg.servers || [], hideDefault: !!cfg.hideDefault }; meta = m; render();
  for (const s of rows()) if (!pings.has(s.address)) pingOne(s.address);      // a server that was just added: ping it now
});
Settings.load().then(() => { pingAll(); setInterval(pingAll, PING_EVERY); });
