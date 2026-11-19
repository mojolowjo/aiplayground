// Limits that keep a public server from being knocked over by one visitor. No networking in here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// All the limits in one place.
export const LIMITS = {
  maxMessageBytes: 2048,   // largest WebSocket message accepted (the biggest real one is a few hundred bytes)
  maxConnsPerIp: 8,        // simultaneous connections from one address (a household behind one router, a few tabs)
  msgsPerSec: 60,          // sustained messages per second from one connection (real play peaks around 15)
  burst: 120,              // how many messages may arrive at once before the limit bites
  maxRooms: 50,            // rooms that can exist at the same time
};

// Token bucket: `burst` messages are free, then `perSec` per second. allow() is false once the bucket is empty.
export class RateLimiter {
  constructor({ perSec = LIMITS.msgsPerSec, burst = LIMITS.burst, now = () => performance.now() / 1000 } = {}) {
    Object.assign(this, { perSec, burst, now, tokens: burst, at: now() });
  }
  allow() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + (t - this.at) * this.perSec); this.at = t;
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}

// Counts live connections per address. add() is false when the address already has `max`.
export class PerIp {
  constructor(max = LIMITS.maxConnsPerIp) { this.max = max; this.n = new Map(); }
  add(ip) { const c = this.n.get(ip) || 0; if (c >= this.max) return false; this.n.set(ip, c + 1); return true; }
  remove(ip) { const c = (this.n.get(ip) || 0) - 1; if (c > 0) this.n.set(ip, c); else this.n.delete(ip); }
}

export const plainIp = ip => String(ip || '').replace(/^::ffff:/, '');

// Is this connection coming from the PC the server runs on? (Used to show the join address to the host only.)
export function isThisMachine(ip) {
  const a = plainIp(ip);
  if (a === '127.0.0.1' || a === '::1') return true;
  return Object.values(os.networkInterfaces()).flat().some(i => i && i.address === a);
}
export function lanAddress() {
  const i = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
  return i ? i.address : null;
}

// The files the web server will hand out: exactly the regular files sitting directly in `dir`, read once
// at start. Anything else, including "..", sub-folders and the folder itself, is simply not on the list.
export function staticFiles(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const files = new Map();
  for (const e of fs.readdirSync(dir, { withFileTypes: true }))
    if (e.isFile() && types[path.extname(e.name)]) files.set('/' + e.name, { file: path.join(dir, e.name), type: types[path.extname(e.name)] });
  if (files.has('/index.html')) files.set('/', files.get('/index.html'));
  return files;
}
