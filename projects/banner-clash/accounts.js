// Simple accounts for testing with friends: a name and a password, and the player's save kept on the laptop.
//
// Everything lives in one file, saves/accounts.json, next to the server. Passwords are stored as salted scrypt
// hashes, never as text. A login returns a random token that the browser keeps; the token is what it sends to
// load and store the save. Tokens are kept in the same file, so players stay logged in across server restarts.
//
// This is deliberately small: no email, no password reset (the host can delete an account from the file), and
// it runs over plain http, so do not reuse an important password here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const NAME = /^[A-Za-z0-9_-]{3,20}$/;
const MAX_SAVE = 200_000;                 // bytes; a full save is a few KB
const MAX_TOKENS = 5;                     // logged-in browsers per account
const FAIL_LIMIT = 10;                    // wrong passwords per address per 10 minutes

export class Accounts {
  constructor(file) {
    this.file = file;
    this.db = { users: {} };
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* first run: no file yet */ }
    if (text != null) {
      try {
        const d = JSON.parse(text);
        if (!d || typeof d.users !== 'object' || Array.isArray(d.users)) throw new Error('no users list');
        this.db = d;
      } catch (e) {                         // never overwrite a file we could not read: keep it aside and say so
        const keep = file + '.broken-' + Date.now();
        fs.renameSync(file, keep);
        console.log(`Accounts file could not be read (${e.message}); kept it as ${keep} and started with no accounts.`);
      }
    }
    this.fails = new Map();
    this.timer = null;
  }
  key(name) { return String(name).toLowerCase(); }
  user(name) { const k = this.key(name); return Object.hasOwn(this.db.users, k) ? this.db.users[k] : null; }   // own names only: "constructor" is not an account
  write() {                               // a short delay groups several saves into one disk write
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, this.file);
    }, 200);
  }
  flush() { if (this.timer) { clearTimeout(this.timer); this.timer = null; fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.db)); } }
  hash(password, salt) { return crypto.scryptSync(String(password), salt, 32).toString('hex'); }
  token(u) {
    const t = crypto.randomBytes(24).toString('hex');
    u.tokens = [t, ...(u.tokens || [])].slice(0, MAX_TOKENS);
    return t;
  }
  tooMany(ip) {
    const now = Date.now(), f = this.fails.get(ip);
    if (!f || now - f.since > 600_000) return false;
    return f.n >= FAIL_LIMIT;
  }
  failed(ip) {
    const now = Date.now(), f = this.fails.get(ip);
    if (!f || now - f.since > 600_000) this.fails.set(ip, { n: 1, since: now }); else f.n++;
  }

  register(name, password, ip) {
    if (!NAME.test(String(name || ''))) return { error: 'Names are 3 to 20 letters, numbers, _ or -.' };
    if (String(password || '').length < 4) return { error: 'Use a password of at least 4 characters.' };
    if (this.tooMany(ip)) return { error: 'Too many tries. Wait a few minutes.' };
    const k = this.key(name);
    if (this.user(name) || k in Object.prototype) return { error: 'That name is taken.' };   // "__proto__" and friends
    const salt = crypto.randomBytes(16).toString('hex');
    const u = this.db.users[k] = { name: String(name), salt, hash: this.hash(password, salt), save: null, saved: 0, created: Date.now() };
    const token = this.token(u); this.write();
    return { name: u.name, token, save: null };
  }
  login(name, password, ip) {
    if (this.tooMany(ip)) return { error: 'Too many tries. Wait a few minutes.' };
    const u = typeof name === 'string' ? this.user(name) : null;
    const ok = u && typeof u.salt === 'string' && typeof u.hash === 'string' && crypto.timingSafeEqual(Buffer.from(this.hash(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
    if (!ok) { this.failed(ip); return { error: 'Wrong name or password.' }; }
    const token = this.token(u); this.write();
    return { name: u.name, token, save: u.save, saved: u.saved };
  }
  byToken(token) {
    if (typeof token !== 'string' || token.length !== 48) return null;
    for (const u of Object.values(this.db.users)) if ((u.tokens || []).includes(token)) return u;
    return null;
  }
  load(token) { const u = this.byToken(token); return u ? { name: u.name, save: u.save, saved: u.saved } : { error: 'Please log in again.' }; }
  store(token, save) {
    const u = this.byToken(token); if (!u) return { error: 'Please log in again.' };
    if (!save || typeof save !== 'object' || Array.isArray(save)) return { error: 'That is not a save.' };
    if (JSON.stringify(save).length > MAX_SAVE) return { error: 'Save too large.' };
    u.save = save; u.saved = Date.now(); this.write();
    return { ok: true, saved: u.saved };
  }
  logout(token) { const u = this.byToken(token); if (u) { u.tokens = u.tokens.filter(t => t !== token); this.write(); } return { ok: true }; }

  // HTTP: POST /api/register, /api/login, /api/logout, /api/save (store); GET /api/save (load).
  // The token travels in the Authorization header: "Bearer <token>". Returns true if it handled the request.
  handle(req, res, rel, ip) {
    if (!rel.startsWith('/api/')) return false;
    const reply = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    const done = out => reply(out.error ? (/log in again/.test(out.error) ? 401 : 400) : 200, out);
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (req.method === 'GET' && rel === '/api/save') { try { done(this.load(token)); } catch { reply(500, { error: 'Something went wrong.' }); } return true; }
    if (req.method !== 'POST') { reply(405, { error: 'not allowed' }); return true; }
    let body = '', big = false;
    req.setEncoding('utf8');
    req.on('data', c => { if (big) return; body += c; if (body.length > MAX_SAVE + 1000) { big = true; reply(413, { error: 'Too large.' }); req.destroy(); } });
    req.on('end', () => {
      if (big) return;
      try {
        let m; try { m = JSON.parse(body || '{}'); } catch { return reply(400, { error: 'Bad request.' }); }
        if (!m || typeof m !== 'object' || Array.isArray(m)) return reply(400, { error: 'Bad request.' });
        if (rel === '/api/register') done(this.register(m.name, m.password, ip));
        else if (rel === '/api/login') done(this.login(m.name, m.password, ip));
        else if (rel === '/api/logout') done(this.logout(token));
        else if (rel === '/api/save') done(this.store(token, m.save));
        else reply(404, { error: 'not found' });
      } catch (e) {                         // a bad request must never take the server down
        console.log('Account request failed: ' + e.message);
        if (!res.headersSent) reply(500, { error: 'Something went wrong.' });
      }
    });
    return true;
  }
}
