// Log in to keep your progress on the host's laptop instead of only in this browser.
// The server side is accounts.js. The browser keeps a copy of the save as before, so a bot match never waits
// for the network; every change is sent to the server a moment later.
const KEY = 'bannerclash.account';

async function call(method, url, body, token) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let out = {}; try { out = await res.json(); } catch { out = { error: 'The server did not answer.' }; }
  if (!res.ok && !out.error) out.error = 'Something went wrong (' + res.status + ').';
  out.status = res.status;
  return out;
}

export class Account {
  // getSave/setSave: read and replace the game's save. fresh: a new empty save. fix: repairs a save from the server.
  constructor({ getSave, setSave, fresh, fix, toast, onChange }) {
    Object.assign(this, { getSave, setSave, fresh, fix, toast, onChange });
    this.me = null; this.timer = null; this.state = 'off';      // off | ok | saving | offline
    try { this.me = JSON.parse(localStorage.getItem(KEY)); } catch { this.me = null; }
    if (this.me && !(this.me.name && this.me.token)) this.me = null;
  }
  get name() { return this.me?.name || null; }
  remember() { try { this.me ? localStorage.setItem(KEY, JSON.stringify(this.me)) : localStorage.removeItem(KEY); } catch { /* private mode */ } }

  // On page load: get the account's save. The newer of the two copies wins, so progress made while the
  // server was down is not lost.
  async start() {
    if (!this.me) return;
    let out; try { out = await call('GET', '/api/save', null, this.me.token); } catch { this.state = 'offline'; this.onChange(); return; }
    if (out.status === 401) { this.me = null; this.remember(); this.toast('Please log in again to keep saving your progress.'); this.onChange(); return; }
    if (out.error) { this.state = 'offline'; this.onChange(); return; }
    const local = this.getSave();
    if (out.save && (local.account !== this.me.name || (out.save.updated || 0) >= (local.updated || 0))) this.setSave(this.fix({ ...out.save, account: this.me.name }));
    else this.push(true);
    this.state = 'ok'; this.onChange();
  }

  async enter(kind, name, password) {
    let out; try { out = await call('POST', '/api/' + kind, { name, password }); } catch { return 'Cannot reach the server.'; }
    if (out.error) return out.error;
    this.me = { name: out.name, token: out.token }; this.remember();
    const local = this.getSave();
    if (out.save) this.setSave(this.fix({ ...out.save, account: out.name }));
    else if (!local.account || local.account === out.name) { local.account = out.name; this.setSave(local); this.push(true); }   // first login keeps this browser's progress
    else { const s = this.fresh(); s.account = out.name; this.setSave(s); this.push(true); }                                   // someone else's progress stays with them
    this.state = 'ok'; this.onChange();
    return null;
  }

  async logout() {
    if (!this.me) return;
    const token = this.me.token;
    this.me = null; this.remember(); clearTimeout(this.timer);
    try { await call('POST', '/api/logout', {}, token); } catch { /* fine, the token just stays valid */ }
    this.setSave(this.fresh()); this.state = 'off'; this.onChange();
  }

  // Called after every change to the save. Sends it a second later, so a burst of changes is one request.
  push(now = false) {
    if (!this.me) return;
    const s = this.getSave(); s.account = this.me.name;
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      this.state = 'saving';
      let out; try { out = await call('POST', '/api/save', { save: this.getSave() }, this.me?.token); } catch { out = { error: 'offline' }; }
      if (!this.me) return;
      if (out.status === 401) { this.me = null; this.remember(); this.toast('Please log in again to keep saving your progress.'); this.state = 'off'; }
      else if (out.error) { this.state = 'offline'; this.timer = setTimeout(() => this.push(true), 15000); }
      else this.state = 'ok';
      this.onChange();
    }, now ? 0 : 1000);
  }
}
