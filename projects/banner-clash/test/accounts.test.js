// Accounts: register, log in, store and load a save, tokens survive a restart, wrong passwords are limited.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../accounts.js';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bc-')), 'accounts.json');
let a = new Accounts(file);
assert.match(a.register('x', 'pass', 'ip').error, /3 to 20/);
assert.match(a.register('mojo', 'ab', 'ip').error, /at least 4/);
const r = a.register('Mojo', 'secret', 'ip');
assert.equal(r.name, 'Mojo'); assert.equal(r.token.length, 48);
assert.match(a.register('mojo', 'other', 'ip').error, /taken/, 'names ignore case');
assert.deepEqual(a.store(r.token, { coins: 50 }).ok, true);
assert.equal(a.load(r.token).save.coins, 50);
assert.match(a.load('nope').error, /log in again/);
assert.match(a.login('mojo', 'wrong', 'ip').error, /Wrong/);
const l = a.login('MOJO', 'secret', 'ip');
assert.equal(l.save.coins, 50);
a.flush();
assert.ok(!fs.readFileSync(file, 'utf8').includes('secret'), 'password is not stored as text');
a = new Accounts(file);
assert.equal(a.load(l.token).save.coins, 50, 'token and save survive a restart');
a.logout(l.token);
assert.match(a.load(l.token).error, /log in again/);
for (let i = 0; i < 10; i++) a.login('mojo', 'bad', 'ip2');
assert.match(a.login('mojo', 'secret', 'ip2').error, /Too many/);
assert.ok(a.login('mojo', 'secret', 'ip3').token, 'other addresses are not blocked');
// Built-in object names are not accounts, and odd input is refused instead of crashing.
for (const n of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.match(a.login(n, 'x', 'ip4').error, /Wrong/, n);
assert.match(a.login(null, null, 'ip4').error, /Wrong/);
assert.match(a.login({}, 'x', 'ip4').error, /Wrong/);
assert.match(a.register('__proto__', 'pass', 'ip5').error, /taken/);
assert.match(a.register('constructor', 'pass', 'ip5').error, /taken/);
a.flush();
// An unreadable file is kept aside, never overwritten.
fs.writeFileSync(file, '{not json');
const b2 = new Accounts(file);
assert.ok(fs.readdirSync(path.dirname(file)).some(f => f.startsWith('accounts.json.broken-')), 'broken file kept');
assert.equal(Object.keys(b2.db.users).length, 0);
console.log('accounts tests passed');
