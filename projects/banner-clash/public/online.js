// Online 1v1 against a friend, from the Online multiplayer plan: the laptop server referees, and both
// browsers run the same deterministic battle from the same card plays. Your play is sent with a target
// tick a little ahead (half your ping plus one tick), the 0.5 s deploy hides the wait, and a late message
// rolls the battle back a few ticks and replays it. A checksum every second catches any drift.
import { Battle, TPS, DEF } from '/shared/sim.js';
import { ALL_CARDS } from '/shared/cards.js';
import * as PR from '/shared/progress.js';
import { sfx } from './sfx.js';

const SETTING_OPTIONS = {
  level: [['shared9', 'Shared level 9'], ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ['shared' + n, 'Shared level ' + n]), ['own', 'Own levels']],
  length: [[120, '2:00'], [180, '3:00'], [300, '5:00']],
  spark: [['normal', 'Normal'], ['double', 'Double all match'], ['triple', 'Triple all match']],
  startSpark: [[5, '5'], [7, '7'], [10, '10']],
  towers: [[50, 'Low (half)'], [100, 'Normal'], [200, 'High (double)']],
  deckRule: [['own', 'Your own deck'], ['mirror', "Mirror (host's deck)"], ['random', 'Random decks']],
  tie: [['extend', 'Extend if both agree'], ['tiebreak', 'Tiebreak on tower health'], ['draw', 'Draw']],
  bets: [['on', 'On'], ['off', 'Off']],
};
const LABELS = { level: 'Card level', length: 'Match length', spark: 'Spark speed', startSpark: 'Starting Spark', towers: 'Tower health', deckRule: 'Deck rules', tie: 'Tie rule', bets: 'Bets' };

// Runs the battle locally in step with the server.
class NetCtrl {
  constructor(net, start) {
    this.net = net; this.side = start.side;
    this.battle = new Battle({ seed: start.seed, decks: start.decks, levels: start.levels, towerLevels: start.towerLevels, settings: start.settings });
    this.cmds = [];                       // every confirmed command, in server order
    this.snaps = new Map();               // tick → state at the start of that tick
    this.hashes = new Map();              // tick → hash after stepping to it
    this.base = { n: 0, at: performance.now() + (start.countdown || 0) };
    this.pending = new Map();             // my plays waiting for the server: card → { x, y, tick }
    this.paused = undefined;              // no pausing online
    this.lastEvents = [];
  }
  serverTick(now) { return this.base.n + (now - this.base.at) / (1000 / TPS) + (this.net.rtt / 2) / (1000 / TPS); }
  onTick(n) { if (n >= this.base.n) this.base = { n, at: performance.now() }; }
  update(now, onTick) {
    const target = Math.floor(this.serverTick(now));
    const events = [];
    let steps = 0;
    while (this.battle.tick < target && steps < 40 && !this.battle.s.over) {
      this.snaps.set(this.battle.tick, this.battle.snapshot());
      this.snaps.delete(this.battle.tick - 80);
      this.battle.step(); steps++;
      this.hashes.set(this.battle.tick, this.battle.hash()); this.hashes.delete(this.battle.tick - 200);
      events.push(...this.battle.events); this.battle.events = [];
      onTick?.();
    }
    if (target - this.battle.tick > 100) this.net.send({ t: 'resync' });          // far behind (tab was hidden): ask for the state
    for (const [card, p] of this.pending) if (this.battle.tick > p.tick + 4) this.pending.delete(card);
    const frac = this.serverTick(now) - target;
    return { events, alpha: Math.max(0, Math.min(1, frac)) };
  }
  play(card, x, y) {
    if (!this.battle.canPlay(this.side, card) || this.pending.has(card)) return false;
    const lead = Math.ceil((this.net.rtt / 2) / (1000 / TPS)) + 1;
    const want = this.battle.tick + lead;
    this.pending.set(card, { x, y, tick: want + 10 });
    this.net.send({ t: 'play', card, x, y, want });
    return true;
  }
  vote(yes) { this.net.send({ t: 'extend', yes }); }
  emote(text) { this.net.send({ t: 'emote', text }); }
  // A confirmed command from the server.
  command(c) {
    this.cmds.push(c);
    if (c.side === this.side && c.type === 'play') this.pending.delete(c.card);
    if (c.tick >= this.battle.tick) { this.battle.schedule(c); return; }
    this.rollback(c.tick);
  }
  rollback(T) {
    const snap = this.snaps.get(T);
    const now = this.battle.tick;
    if (!snap) { this.net.send({ t: 'resync' }); return; }
    this.battle.restore(snap);
    this.battle.s.pending = [];
    for (const c of this.cmds) if (c.tick >= T) this.battle.schedule(c);
    while (this.battle.tick < now) {
      this.snaps.set(this.battle.tick, this.battle.snapshot());
      this.battle.step();
      this.hashes.set(this.battle.tick, this.battle.hash());
      const keep = this.battle.events.filter(e => e.e === 'play' || e.e === 'spawn');
      this.lastEvents.push(...keep); this.battle.events = [];
    }
  }
  check(tick, hash) {
    const mine = this.hashes.get(tick);
    if (mine != null && mine !== hash) { console.warn('Out of sync at tick', tick); this.net.send({ t: 'resync' }); }
  }
  resync(m) {
    this.battle.restore(m.state); this.cmds = m.cmds || []; this.snaps.clear(); this.hashes.clear();
    this.base = { n: m.state.tick, at: performance.now() };
  }
}

export class Online {
  constructor(app) {
    this.app = app; this.ws = null; this.rtt = 80; this.lobby = null; this.ctrl = null; this.status = 'Not connected';
    this.room = new URLSearchParams(location.search).get('room') || 'main';
    if (new URLSearchParams(location.search).get('room')) setTimeout(() => this.app.show('friends'), 0);
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.status = 'Connecting…'; this.render();
    const ws = this.ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      const save = this.app.getSave();
      const token = sessionStorage.getItem('bc.token.' + this.room) || '';
      this.send({ t: 'join', room: this.room, name: save.name, token, coins: save.coins });
      this.sendDeck();
      clearInterval(this.pinger); this.pinger = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
      this.send({ t: 'ping', c: performance.now() });
    };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.handle(m); };
    ws.onclose = ev => {
      clearInterval(this.pinger);
      this.status = ev.reason ? 'Disconnected: ' + ev.reason : 'Disconnected';
      if (this.ctrl && !this.ctrl.battle.s.over) { this.app.toast('Connection lost. Reconnecting…'); setTimeout(() => this.connect(), 1500); }
      this.ws = null; this.render();
    };
  }
  disconnect() { this.send({ t: 'leave' }); sessionStorage.removeItem('bc.token.' + this.room); this.ws?.close(); this.ws = null; this.lobby = null; this.render(); }
  sendDeck() { const s = this.app.getSave(); this.send({ t: 'deck', deck: s.deck, levels: s.levels }); }

  handle(m) {
    const app = this.app;
    if (m.t === 'pong') { this.rtt = Math.max(1, performance.now() - m.c) * 0.3 + this.rtt * 0.7; return; }
    if (m.t === 'full') { this.status = 'That room is full.'; this.ws?.close(); return this.render(); }
    if (m.t === 'token') { sessionStorage.setItem('bc.token.' + this.room, m.token); return; }
    if (m.t === 'lobby') { this.lobby = m; this.status = 'Connected'; if (!this.ctrl || this.ctrl.battle.s.over) this.render(); return; }
    if (m.t === 'start') return this.begin(m);
    if (!this.ctrl) return;
    if (m.t === 'tk') return this.ctrl.onTick(m.n);
    if (m.t === 'cmd') return this.ctrl.command(m.c);
    if (m.t === 'sync') return this.ctrl.check(m.tick, m.hash);
    if (m.t === 'state') return this.ctrl.resync(m);
    if (m.t === 'rejected') { this.ctrl.pending.delete(m.card); sfx.deny(); return; }
    if (m.t === 'emote' && m.side !== this.ctrl.side) return app.screen.emote(String(m.text).slice(0, 40), false);
    if (m.t === 'opp') return app.toast(m.status === 'dropped' ? 'Your friend lost connection. Holding their seat for 60 s.' : 'Your friend is back.');
    if (m.t === 'end') return this.finish(m);
  }

  begin(m) {
    const app = this.app, save = app.getSave();
    this.myBet = m.bets ? m.bets[m.side] : 0;
    if (!m.resume && this.myBet) { PR.placeBet(save, this.myBet); app.persist(); }
    this.ctrl = new NetCtrl(this, m);
    if (m.state) this.ctrl.resync(m);
    const foe = m.names[1 - m.side];
    const emotes = PR.ARENAS.filter(a => a.emote && save.arenaMax >= a.n).map(a => a.emote);
    app.screen.begin(this.ctrl, { foe, foeLvl: m.levelText || '', me: save.name, arena: m.arena || 1, pausable: false, emotes, onEnd: () => {} });
    if (m.countdown) app.screen.msg('Ready…', m.countdown);
  }

  finish(m) {
    const app = this.app, save = app.getSave(), me = this.ctrl.side;
    const won = m.winner === me, draw = m.winner === -1;
    PR.applyFriendResult(save, { won, pot: m.pot || 0, bet: this.myBet || 0, refunded: draw });
    app.persist();
    const show = () => {
      app.show('result');
      const p = document.querySelector('#resultPanel');
      p.innerHTML = `<h1 class="${draw ? 'draw' : won ? 'win' : 'loss'}">${draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'}</h1>
        <p>${m.banners[me]} ⚑ vs ${m.banners[1 - me]} ⚑${m.reason === 'tiebreak' ? ' (tiebreak)' : m.reason === 'forfeit' ? ' (forfeit)' : ''}</p>
        <div class="reward"><span>For playing</span><b>+${PR.PROG.coins.friend}</b></div>
        ${m.pot ? `<div class="reward"><span>Bet</span><b>${won ? '+' + m.pot : draw ? 'returned' : '-' + (this.myBet || 0)}</b></div>` : ''}`;
      const row = app.el('div', { className: 'row', style: 'justify-content:center' });
      const again = app.el('button', { className: 'go' }, 'Rematch'); again.onclick = () => { this.send({ t: 'rematch' }); this.ctrl = null; app.show('friends'); };
      const leave = app.el('button', {}, 'Leave room'); leave.onclick = () => { this.ctrl = null; this.disconnect(); app.show('home'); };
      row.append(again, leave); p.append(row);
    };
    setTimeout(show, 1600);
  }

  render() {
    const p = document.querySelector('#netPanel'); if (!p) return;
    const app = this.app, esc = app.esc, save = app.getSave();
    if (!this.ws || !this.lobby) {
      p.innerHTML = `<small>Play a friend live. Both of you open this page from the laptop's address and join the same room.</small>
        <label>Room<input id="nRoom" maxlength="24" value="${esc(this.room)}"></label>
        <button class="go" id="nJoin">Join room</button><p><small>${esc(this.status)}</small></p>`;
      p.querySelector('#nRoom').onchange = e => { this.room = e.target.value.trim().slice(0, 24) || 'main'; };
      p.querySelector('#nJoin').onclick = () => { sfx.unlock(); this.room = p.querySelector('#nRoom').value.trim().slice(0, 24) || 'main'; this.connect(); };
      return;
    }
    const L = this.lobby, me = L.you, host = me === 0;
    let html = `<div class="row spread"><b>Room ${esc(L.room)}</b><small>ping ${Math.round(this.rtt)} ms</small></div>`;
    if (L.join) html += `<p><small>Send friends: </small><br><input id="nLink" readonly value="${esc(L.join.url || '')}"><button class="mini" id="nCopy">Copy</button>${L.join.note ? `<br><small>${esc(L.join.note)}</small>` : ''}</p>`;
    for (let i = 0; i < 2; i++) {
      const pl = L.players[i];
      html += `<div class="lobby-p"><span>${i === 0 ? 'Host' : 'Guest'}: ${pl ? esc(pl.name) + (pl.away ? ' (away)' : '') : '<small>waiting…</small>'}</span><span>${pl ? (L.settings.bets === 'on' ? `bet ${pl.bet} · ` : '') + (pl.ready ? '✔ ready' : 'not ready') : ''}</span></div>`;
    }
    html += '<h2>Match settings</h2>';
    for (const [k, opts] of Object.entries(SETTING_OPTIONS))
      html += `<label>${LABELS[k]}<select data-k="${k}" ${host ? '' : 'disabled'}>${opts.map(([v, t]) => `<option value="${v}" ${String(L.settings[k]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    if (L.settings.bets === 'on') html += `<label>Your bet (you have ${save.coins} Coins)<input id="nBet" type="number" min="0" max="${save.coins}" value="${L.players[me]?.bet || 0}"></label>`;
    html += `<div class="row"><button class="go" id="nReady">${L.players[me]?.ready ? 'Not ready' : 'Ready'}</button><button id="nLeave">Leave</button></div>
      <small>Changing a setting or a bet clears both Ready marks. The match starts when both are ready.</small>`;
    p.innerHTML = html;
    for (const s of p.querySelectorAll('select')) s.onchange = () => this.send({ t: 'settings', settings: { [s.dataset.k]: s.value } });
    const bet = p.querySelector('#nBet'); if (bet) bet.onchange = () => this.send({ t: 'bet', amount: Math.max(0, Math.min(save.coins, bet.value | 0)), coins: save.coins });
    p.querySelector('#nReady').onclick = () => { this.sendDeck(); this.send({ t: 'ready', ready: !L.players[me]?.ready }); };
    p.querySelector('#nLeave').onclick = () => this.disconnect();
    const copy = p.querySelector('#nCopy'); if (copy) copy.onclick = () => { const i = p.querySelector('#nLink'); i.select(); navigator.clipboard?.writeText(i.value); app.toast('Link copied'); };
  }
}
export { DEF, ALL_CARDS };
