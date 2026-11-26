// The app: menus, saves, bot matches and the battle screen. Online play lives in online.js.
import { Battle, DEF, TPS, SPARK, MT, W, H, ownY, laneOf, DEFAULT_SETTINGS } from '/shared/sim.js';
import { CARDS, ALL_CARDS, CARD_IDS, STARTER_DECK, RARITY_COLOR, LEVEL_PCT, MAX_LEVEL } from '/shared/cards.js';
import { Bot, RIVALS, rivalById, pickRival, buildDeck, assimilationDeck } from '/shared/bot.js';
import * as PR from '/shared/progress.js';
import { Renderer } from './render.js';
import { spriteURL } from './sprites.js';
import { sfx, setSound } from './sfx.js';
import { Online } from './online.js';
import { Account } from './account.js';

const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString('en-US');
const rnd = Math.random;

// ---------- the save ----------
const KEY = 'bannerclash.save.v1';
function load() { try { return PR.fixSave(JSON.parse(localStorage.getItem(KEY))); } catch { return PR.newSave(); } }
export let save = load();
let account = null;               // set up below; see public/account.js
export function persist() {
  save.updated = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { toast('Could not save progress in this browser.'); }
  account?.push();
  refreshTop();
}
setSound(save.settings.sound);

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }
function refreshTop() { $('#coins').textContent = fmt(save.coins); $('#keys').textContent = save.keys; $('#glory').textContent = fmt(save.glory); }

// ---------- navigation ----------
let current = 'home';
export function show(name) {
  current = name;
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === name);
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.go === name);
  document.body.classList.toggle('inbattle', name === 'battle');
  ({ home: renderHome, cards: renderCards, arenas: renderArenas, friends: () => online.render(), settings: renderSettings })[name]?.();
  refreshTop();
}
for (const b of document.querySelectorAll('#nav button')) b.onclick = () => { sfx.click(); show(b.dataset.go); };

// ---------- card widgets ----------
export function cardEl(id, { level, small, locked, onClick } = {}) {
  const c = ALL_CARDS[id];
  const e = el('div', { className: 'card' + (small ? ' tiny' : '') + (locked ? ' locked' : '') });
  e.style.setProperty('--r', RARITY_COLOR[c.rarity]);
  e.innerHTML = `<span class="cost">${c.cost}</span><img src="${spriteURL(id, 4)}" alt=""><span class="nm">${esc(c.name)}</span>${level ? `<span class="lv">Lv ${level}</span>` : ''}`;
  if (onClick) e.onclick = () => { sfx.click(); onClick(id); };
  return e;
}
function statRows(id, lvl) {
  const c = ALL_CARDS[id], d = DEF[id], p = LEVEL_PCT[lvl] / 100, r = [];
  const tiles = v => (v / MT).toFixed(1).replace('.0', '');
  const sp = { slow: 'Slow', medium: 'Medium', fast: 'Fast', veryfast: 'Very fast' };
  const tg = { both: 'Air and ground', ground: 'Ground', buildings: 'Buildings only' };
  r.push(['Type', c.type[0].toUpperCase() + c.type.slice(1) + ' · ' + c.rarity]);
  if (c.hp) r.push(['HP', Math.floor(c.hp * p) + (c.count > 1 ? ` x${c.count}` : '') + (c.shield ? ` + ${Math.floor(c.shield * p)} shield` : '')]);
  if (c.dmg) r.push(['Damage', Math.floor(c.dmg * p) + (c.type !== 'spell' ? ` every ${c.hit}s` : '')]);
  if (c.type === 'spell') { r.push(['Radius', c.radius + ' tiles']); r.push(['Delay', c.delay ? c.delay + ' s' : 'Instant']); if (c.dmg) r.push(['Vs towers', Math.floor(c.dmg * p * 0.35)]); }
  if (c.range != null && c.type !== 'spell' && c.dmg) r.push(['Range', c.range <= 1 ? 'Melee' : c.range + ' tiles']);
  if (c.speed) r.push(['Speed', sp[c.speed]]);
  if (c.targets) r.push(['Targets', tg[c.targets]]);
  if (c.life) r.push(['Lifetime', c.life + ' s']);
  if (c.air) r.push(['Flies', 'Yes']);
  r.push(['Special', c.text]);
  return r.map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('');
}

// ---------- home ----------
let nextRival = null;
function chooseRival() { nextRival = pickRival(PR.currentArena(save)); }
// ---------- account ----------
account = new Account({
  getSave: () => save,
  setSave: s => { save = s; try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ } setSound(save.settings.sound); nextRival = null; },
  fresh: () => PR.newSave('Player'), fix: s => PR.fixSave(s), toast: m => toast(m),
  onChange: () => { refreshTop(); if (current !== 'battle') show(current); },
});
function renderAccount() {
  const c = $('#acctCard'); if (!c) return;
  const st = { ok: 'saved on the server', saving: 'saving…', offline: 'server not reachable, saved in this browser for now', off: '' }[account.state];
  c.innerHTML = account.name
    ? `<small>Logged in as <b>${esc(account.name)}</b>${st ? ` · ${st}` : ''}</small>`
    : `<small>Playing without an account: progress is saved only in this browser.</small> <button class="mini" id="acctBtn">Log in</button>`;
  if (!account.name) $('#acctBtn').onclick = () => openLogin();
}
function openLogin() {
  const box = el('div', {}, `<b>Log in</b><p><small>Your progress is kept on the host's laptop, so you can play from any device. New here? Pick a name and password and press Create account. Your progress in this browser comes with you.</small></p>
    <label>Name<input id="lName" maxlength="20" autocomplete="username"></label>
    <label>Password<input id="lPass" type="password" autocomplete="current-password"></label>
    <p id="lErr" style="color:var(--red,#e55)"></p>
    <div class="row"><button class="go" id="lIn">Log in</button><button id="lNew">Create account</button><button id="lNo">Cancel</button></div>
    <p><small>Simple test login: don't reuse an important password.</small></p>`);
  modal(box);
  const go = async kind => {
    $('#lErr').textContent = '';
    const err = await account.enter(kind, $('#lName').value.trim(), $('#lPass').value);
    if (err) { $('#lErr').textContent = err; return; }
    if (!save.name || save.name === 'Player') { save.name = account.name.slice(0, 16); persist(); }
    closeModal(); toast(kind === 'register' ? 'Account created' : 'Welcome back, ' + account.name);
  };
  $('#lIn').onclick = () => go('login'); $('#lNew').onclick = () => go('register'); $('#lNo').onclick = closeModal;
  $('#lPass').onkeydown = e => { if (e.key === 'Enter') go('login'); };
  $('#lName').focus();
}

function renderHome() {
  renderAccount();
  const a = PR.currentArena(save), info = PR.arenaInfo(a), next = PR.ARENAS[a];
  const lo = info.glory, hi = next ? next.glory : Math.max(2400, save.glory);
  const pct = next ? (save.glory - lo) / (hi - lo) * 100 : 100;
  $('#arenaCard').innerHTML = `<h3>Arena ${a}: ${esc(info.name)}</h3>
    <div class="bar-o"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i><em>${fmt(save.glory)} / ${next ? fmt(hi) : 'MAX'} Glory</em></div>
    <small>${next ? `Next: Arena ${a + 1}, ${esc(next.name)}. Only wins move you up.` : 'Champion arena. Bot levels rise at 2,100 and 2,400 Glory.'}</small>`;
  if (!nextRival) chooseRival();
  const r = nextRival.rival, rec = save.rivals[r.id];
  $('#rivalCard').innerHTML = `<div class="row spread"><div><b style="color:${r.color}">${esc(r.name)}</b><br><small>${r.tier} brain · level ${PR.botLevel(save)} cards${nextRival.headline ? ' · headline rival' : ' · returning rival'}</small></div>
    ${save.eased ? '<span class="tag eased">EASED</span>' : ''}</div>
    ${rec ? `<small>Record ${rec.w}-${rec.l}${rec.d ? '-' + rec.d : ''}${rec.w + rec.l + rec.d >= 2 ? '. ' + esc(PR.HABITS[r.id]) : ''}</small>` : '<small>First meeting.</small>'}
    ${save.eased ? '<br><small>After 3 losses in a row this rival plays one level lower. A win pays Coins and Keys but no Glory.</small>' : ''}`;
  const waiting = PR.picksWaiting(save), offer = PR.ensureOffer(save, rnd);
  const into = save.keys % PR.PROG.keys.perPick;
  const box = $('#unlockCard'); box.innerHTML = '';
  if (save.unlocked.length >= CARD_IDS.length) box.innerHTML = '<small>Every card unlocked. Upgrade them in Cards.</small>';
  else if (waiting) { const b = el('button', { className: 'big ok' }, `PICK A NEW CARD${waiting > 1 ? ' (' + waiting + ')' : ''}`); b.onclick = () => openOffer(); box.append(b); }
  else {
    box.innerHTML = `<small>Card unlock: ${into} / ${PR.PROG.keys.perPick} Keys. Next offer:</small><div class="bar-o keys"><i style="width:${into / PR.PROG.keys.perPick * 100}%"></i></div>`;
    const row = el('div', { className: 'row' }); for (const id of offer || []) row.append(cardEl(id, { small: true, onClick: () => openCard(id, { preview: true }) })); box.append(row);
  }
  persist();
}
$('#battleBtn').onclick = () => { sfx.unlock(); sfx.click(); startBotMatch(); };

// ---------- cards ----------
let swapIn = null;
function renderCards() {
  const dg = $('#deckGrid'), cg = $('#collGrid'); dg.innerHTML = ''; cg.innerHTML = '';
  const avg = save.deck.reduce((a, id) => a + CARDS[id].cost, 0) / 8;
  $('#deckAvg').textContent = `avg ${avg.toFixed(1)} Spark · towers Lv ${PR.deckLevel(save)}`;
  for (const id of save.deck) {
    const e = cardEl(id, { level: save.levels[id], onClick: () => {
      if (swapIn) { save.deck[save.deck.indexOf(id)] = swapIn; swapIn = null; persist(); renderCards(); toast('Deck updated'); }
      else openCard(id);
    } });
    if (canAfford(id)) e.classList.add('up');
    if (swapIn) e.classList.add('sel');
    dg.append(e);
  }
  $('#swapHint').textContent = swapIn ? `Tap a deck card to swap in ${CARDS[swapIn].name}.` : 'Tap a card for its stats and upgrades.';
  $('#ownCount').textContent = `${save.unlocked.length} / ${CARD_IDS.length}`;
  for (const id of CARD_IDS) {
    if (save.deck.includes(id)) continue;
    const own = save.unlocked.includes(id);
    const e = cardEl(id, { level: own ? save.levels[id] : 0, locked: !own, onClick: () => openCard(id, { preview: !own }) });
    if (own && canAfford(id)) e.classList.add('up');
    if (swapIn === id) e.classList.add('sel');
    cg.append(e);
  }
}
const canAfford = id => { const c = PR.upgradeCost(save, id); return c != null && save.coins >= c; };

function modal(html) { $('#modalBox').innerHTML = ''; if (typeof html === 'string') $('#modalBox').innerHTML = html; else $('#modalBox').append(html); $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

function openCard(id, { preview, offer } = {}) {
  const own = save.unlocked.includes(id), lvl = own ? save.levels[id] : 1, c = CARDS[id];
  const box = el('div');
  box.innerHTML = `<div class="detail"><div class="dc"></div><div><b style="color:${RARITY_COLOR[c.rarity]}">${esc(c.name)}</b><br><small>${own ? 'Level ' + lvl + (lvl >= MAX_LEVEL ? ' (max)' : '') : 'Not unlocked yet · shown at level 1'}</small></div></div>
    <table class="stats">${statRows(id, lvl)}</table>`;
  box.querySelector('.dc').append(cardEl(id));
  const row = el('div', { className: 'row' });
  if (own) {
    const cost = PR.upgradeCost(save, id);
    if (cost != null) {
      const best = Math.max(...Object.values(save.levels));
      const up = el('button', { className: 'ok', disabled: save.coins < cost }, `Upgrade ${fmt(cost)}c${lvl + 1 <= best ? ' (half price)' : ''}`);
      up.onclick = () => { if (PR.upgrade(save, id)) { sfx.coin(); persist(); toast(`${c.name} is now level ${save.levels[id]}`); openCard(id); renderCards(); } };
      row.append(up);
    }
    if (!save.deck.includes(id)) { const b = el('button', {}, 'Use in deck'); b.onclick = () => { swapIn = id; closeModal(); show('cards'); }; row.append(b); }
  }
  if (offer) {
    const pick = el('button', { className: 'go' }, 'Pick this card');
    pick.onclick = () => { if (PR.pickCard(save, id)) { sfx.win(); persist(); closeModal(); toast(`${c.name} unlocked!`); chooseRival(); show(current); if (PR.picksWaiting(save)) setTimeout(openOffer, 400); } };
    const tryIt = el('button', {}, 'Try it');
    tryIt.onclick = () => { closeModal(); startBotMatch({ tryCard: id }); };
    row.append(pick, tryIt);
  }
  const close = el('button', {}, offer ? 'Back' : 'Close'); close.onclick = () => offer ? openOffer() : closeModal();
  row.append(close); box.append(row);
  modal(box);
}

function openOffer() {
  const offer = PR.ensureOffer(save, rnd); persist();
  if (!offer || !PR.picksWaiting(save)) return closeModal();
  const box = el('div', {}, `<b>Pick 1 of 3</b><br><small>Tap a card to see it and try it in a practice match. Cards you skip come back later.</small>`);
  const grid = el('div', { className: 'offer' });
  for (const id of offer) grid.append(cardEl(id, { onClick: () => openCard(id, { preview: true, offer: true }) }));
  const later = el('button', {}, 'Later'); later.onclick = closeModal;
  box.append(grid, later); modal(box);
}

// ---------- arenas ----------
function renderArenas() {
  const list = $('#arenaList'); list.innerHTML = '';
  const here = PR.currentArena(save);
  for (const a of PR.ARENAS) {
    const r = RIVALS.find(x => x.arena === a.n), rec = save.rivals[r.id];
    const reached = save.arenaMax >= a.n;
    const p = el('div', { className: 'panel arena-row' + (reached ? '' : ' locked') + (a.n === here ? ' here' : '') });
    p.innerHTML = `<div class="num">${a.n}</div><div><b>${esc(a.name)}</b><br>
      <small>${fmt(a.glory)} Glory · ${a.n === 10 ? 'level 7 to 9' : 'level ' + a.bot} · ${esc(a.style)}</small><br>
      <small>Rival: <span style="color:${r.color}">${esc(r.name)}</span>${rec ? ` · ${rec.w}-${rec.l}` : ''}</small>
      ${rec && rec.w + rec.l + rec.d >= 2 ? `<br><small>${esc(PR.HABITS[r.id])}</small>` : ''}
      <br><small>Emote: ${a.emote ? (PR.emoteEarned(save, a.n) ? '"' + esc(a.emote) + '"' : (a.n < 10 ? 'earned when you reach the next arena' : `earned at ${fmt(PR.CHAMPION_GLORY)} Glory`)) : 'none'}</small></div>`;
    list.append(p);
  }
}

// ---------- settings ----------
function renderSettings() {
  const p = $('#setPanel');
  p.innerHTML = `<label>Your name<input id="sName" maxlength="16" value="${esc(save.name)}"></label>
    <label><input type="checkbox" id="sSound" ${save.settings.sound ? 'checked' : ''} style="display:inline;width:auto"> Sound</label>
    <label><input type="checkbox" id="sTaunts" ${save.settings.taunts ? 'checked' : ''} style="display:inline;width:auto"> Show rival taunts</label>
    <label><input type="checkbox" id="sDebug" ${save.settings.debug ? 'checked' : ''} style="display:inline;width:auto"> Bot debug overlay</label>
    <p><small>Wins ${save.stats.wins} · losses ${save.stats.losses} · draws ${save.stats.draws} · friend battles ${save.stats.friendly}</small></p>
    <h2>Account</h2>${account.name ? `<small>Logged in as <b>${esc(account.name)}</b>. Your progress is saved on the server.</small><div class="row"><button id="sOut">Log out</button></div>`
      : `<small>Not logged in. Log in to keep your progress on the server and play from any device.</small><div class="row"><button class="go" id="sIn">Log in</button></div>`}
    <h2>Save</h2><small>${account.name ? 'A copy also lives in this browser.' : 'Your progress lives in this browser.'} Copy it to move it to another device.</small>
    <textarea id="sBox" placeholder="Paste a save here to import it"></textarea>
    <div class="row"><button id="sExport">Export</button><button id="sImport">Import</button><button id="sReset" class="warn">Reset</button></div>`;
  if ($('#sOut')) $('#sOut').onclick = async () => { await account.logout(); toast('Logged out'); };
  if ($('#sIn')) $('#sIn').onclick = () => openLogin();
  $('#sName').onchange = e => { save.name = e.target.value.slice(0, 16) || 'Player'; persist(); };
  $('#sSound').onchange = e => { save.settings.sound = e.target.checked; setSound(save.settings.sound); persist(); };
  $('#sTaunts').onchange = e => { save.settings.taunts = e.target.checked; persist(); };
  $('#sDebug').onchange = e => { save.settings.debug = e.target.checked; persist(); };
  $('#sExport').onclick = () => { $('#sBox').value = btoa(unescape(encodeURIComponent(JSON.stringify(save)))); $('#sBox').select(); toast('Copy the text in the box'); };
  $('#sImport').onclick = () => { try { const s = JSON.parse(decodeURIComponent(escape(atob($('#sBox').value.trim())))); save = PR.fixSave(s); persist(); toast('Save imported'); renderSettings(); } catch { toast('That is not a save'); } };
  $('#sReset').onclick = () => { if (prompt('Type RESET to wipe your progress') === 'RESET') { save = PR.newSave(save.name); persist(); toast('Progress reset'); renderSettings(); } };
}

// ---------- the battle screen ----------
// A controller runs the match: LocalCtrl for bots here, a network one in online.js. Both give the screen
// { battle, side, update(now) → { events, alpha }, play(card, x, y), names, bot? }.
class LocalCtrl {
  constructor(battle, bot) { this.battle = battle; this.bot = bot; this.side = 0; this.last = null; this.acc = 0; this.paused = false; }
  update(now, onTick) {
    if (this.last == null) this.last = now;
    const dt = Math.min(250, now - this.last); this.last = now;
    if (!this.paused) this.acc += dt;
    const events = [];
    while (this.acc >= 1000 / TPS) {
      this.acc -= 1000 / TPS;
      this.bot?.think(this.battle); this.bot2?.think(this.battle);
      this.battle.step();
      this.bot?.onEvents(this.battle, this.battle.events); this.bot2?.onEvents(this.battle, this.battle.events);
      events.push(...this.battle.events); this.battle.events = [];
      onTick?.();
    }
    return { events, alpha: this.acc / (1000 / TPS) };
  }
  play(card, x, y) {
    if (!this.battle.canPlay(0, card)) return false;
    this.battle.schedule({ tick: this.battle.tick, side: 0, type: 'play', card, x, y }); return true;
  }
  vote(yes) { this.battle.schedule({ tick: this.battle.tick, side: 0, type: 'extend', yes }); }
}

export const screen = {
  ctrl: null, r: null, held: null, ghost: null, raf: 0, onEnd: null, lastSec: -1, emotesOn: false,
  begin(ctrl, { foe, foeLvl, me, arena, onEnd, pausable, emotes }) {
    this.ctrl = ctrl; this.onEnd = onEnd; this.ended = false;
    if (!this.r) { this.r = new Renderer($('#cv')); this.bindInput(); }
    this.r.setArena(arena || 1); this.r.setSide(ctrl.side); this.r.fx = []; this.r.afterTick(ctrl.battle); this.r.afterTick(ctrl.battle);
    $('#foeName').textContent = foe; $('#foeLvl').textContent = foeLvl || ''; $('#meName').textContent = me;
    $('#pauseBtn').classList.toggle('hidden', !pausable);
    $('#voteBox').classList.add('hidden');
    $('#debug').classList.toggle('hidden', !(save.settings.debug && ctrl.bot));
    this.emoteList = emotes || [];
    $('#emotes').classList.add('hidden');
    this.held = null; this.ghost = null; this.lastSec = -1;
    show('battle');
    this.drawHand(true);
    cancelAnimationFrame(this.raf);
    const loop = now => { this.frame(now); if (!this.ended) this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    this.msg('Fight!', 1200);
  },
  frame(now) {
    const c = this.ctrl, b = c.battle;
    const { events, alpha } = c.update(now, () => this.r.afterTick(c.battle));
    if (events.length) { this.r.events(c.battle, events); this.sounds(events); }
    this.r.draw(c.battle, { alpha, ghost: this.ghost, me: c.side });
    this.hud();
    if (c.bot) this.botUi(c.bot);
    if (c.battle.s.over && !this.ended) { this.ended = true; setTimeout(() => this.onEnd?.(c.battle), 1400); this.msg(this.endText(c.battle), 1400); }
  },
  endText(b) { const w = b.s.winner; return w === -1 ? 'Draw' : w === this.ctrl.side ? 'Victory!' : 'Defeat'; },
  sounds(evs) {
    const me = this.ctrl.side;
    for (const e of evs) {
      if (e.e === 'play') { if (DEF[e.card].type === 'spell') sfx.spell(); else sfx.play(); }
      else if (e.e === 'hurt') sfx.hit();
      else if (e.e === 'die') { if (e.kind === 'tower') { sfx.tower(); this.msg(e.side === me ? 'Tower lost!' : 'Tower down!', 1200); } else sfx.die(); }
      else if (e.e === 'spell' && (e.card === 'meteor' || e.card === 'flamejar')) sfx.boom();
      else if (e.e === 'overtime') { this.msg('Overtime! Sudden death', 1800); sfx.double(); }
      else if (e.e === 'vote') $('#voteBox').classList.remove('hidden');
      else if (e.e === 'extended') { $('#voteBox').classList.add('hidden'); this.msg('Extended! +1:00', 1500); }
      else if (e.e === 'end') { $('#voteBox').classList.add('hidden'); if (e.winner === me) sfx.win(); else if (e.winner !== -1) sfx.lose(); }
    }
  },
  msg(text, ms) { const m = $('#banner'); m.textContent = text; m.classList.add('on'); clearTimeout(this.msgT); this.msgT = setTimeout(() => m.classList.remove('on'), ms); },
  hud() {
    const b = this.ctrl.battle, s = b.s, me = this.ctrl.side, P = s.players[me];
    const left = Math.ceil(b.timeLeft() / TPS), sec = left % 60;
    const ck = $('#clock'); ck.textContent = s.vote ? 'TIED' : `${Math.floor(left / 60)}:${String(sec).padStart(2, '0')}`;
    const mult = b.sparkMult();
    ck.className = 'clock' + (s.ot ? ' ot' : mult > 1 ? ' double' : '');
    if (left !== this.lastSec) { if (left <= 10 && left > 0 && !s.over) sfx.tick(); if (left === 60 && !s.ot && s.settings.spark === 'normal') { this.msg('Double Spark!', 1500); sfx.double(); } this.lastSec = left; }
    $('#sparkFill').style.width = (P.spark / (10 * SPARK) * 100) + '%';
    $('#sparkNum').textContent = Math.floor(P.spark / SPARK);
    $('#bannersBlue').textContent = '⚑'.repeat(P.banners);
    $('#bannersRed').textContent = '⚑'.repeat(s.players[1 - me].banners);
    this.drawHand();
  },
  drawHand(force) {
    const b = this.ctrl.battle, me = this.ctrl.side, P = b.s.players[me];
    const key = P.hand.join() + '|' + P.queue[0] + '|' + this.held;
    const hand = $('#hand');
    if (force || key !== this.handKey) {
      this.handKey = key; hand.innerHTML = '';
      for (const id of P.hand) {
        const e = cardEl(id, { level: b.level(me, id) });
        e.dataset.card = id;
        if (this.held === id) e.classList.add('held');
        e.addEventListener('pointerdown', ev => this.grab(ev, id));
        hand.append(e);
      }
      const n = $('#nextCard'); n.innerHTML = ''; n.append(...cardEl(P.queue[0], { small: true }).childNodes);
      n.style.setProperty('--r', RARITY_COLOR[ALL_CARDS[P.queue[0]].rarity]);
    }
    for (const e of hand.children) e.classList.toggle('poor', P.spark < ALL_CARDS[e.dataset.card].cost * SPARK);
  },
  botUi(bot) {
    const bub = $('#bubbleFoe');
    if (bot.speech && save.settings.taunts) { bub.textContent = bot.speech.text; bub.classList.add('on'); } else bub.classList.remove('on');
    if (save.settings.debug) $('#debug').textContent = `threat L ${bot.debug.threat[0]} R ${bot.debug.threat[1]}\nplan ${bot.debug.plan || '-'}\nspark est ${bot.estSpark.toFixed(1)}\n${bot.debug.scores.join('\n')}`;
  },
  // Drag a card onto the arena, or tap a card and then tap the arena.
  grab(ev, id) {
    ev.preventDefault(); sfx.unlock();
    this.held = id; this.dragging = true; this.downAt = [ev.clientX, ev.clientY];
    this.drawHand(true);
  },
  bindInput() {
    const cv = $('#cv');
    const gamePos = ev => {
      const r = cv.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return null;
      return this.r.toGame((ev.clientX - r.left) / r.width * cv.width, (ev.clientY - r.top) / r.height * cv.height);
    };
    window.addEventListener('pointermove', ev => {
      if (!this.held || this.ended) return;
      const p = gamePos(ev);
      // While dragging, aim a little above the finger so the drop point is visible on a phone.
      if (p && this.dragging && ev.pointerType === 'touch') p[1] += (this.ctrl.side === 0 ? -1 : 1) * 1.2 * MT;
      this.ghost = p ? { card: this.held, x: p[0], y: p[1] } : null;
    });
    window.addEventListener('pointerup', ev => {
      if (!this.held || this.ended) { this.dragging = false; return; }
      const p = gamePos(ev);
      const moved = this.downAt && Math.hypot(ev.clientX - this.downAt[0], ev.clientY - this.downAt[1]) > 12;
      if (p) {
        if (this.dragging && ev.pointerType === 'touch') p[1] += (this.ctrl.side === 0 ? -1 : 1) * 1.2 * MT;
        if (this.ctrl.play(this.held, Math.round(p[0]), Math.round(p[1]))) { this.held = null; }
        else { sfx.deny(); toast('Not enough Spark'); }
        this.ghost = null;
      } else if (moved) { this.held = null; this.ghost = null; }
      this.dragging = false; this.downAt = null;
      this.drawHand(true);
    });
    cv.addEventListener('pointerdown', ev => { if (this.held) { const p = gamePos(ev); if (p) this.ghost = { card: this.held, x: p[0], y: p[1] }; } });
    $('#pauseBtn').onclick = () => {
      const c = this.ctrl; if (!('paused' in c)) return;
      c.paused = !c.paused; $('#pauseBtn').textContent = c.paused ? '▶' : 'II';
      if (c.paused) this.pauseMenu();
    };
    $('#voteYes').onclick = () => { this.ctrl.vote?.(true); $('#voteBox').classList.add('hidden'); };
    $('#voteNo').onclick = () => { this.ctrl.vote?.(false); $('#voteBox').classList.add('hidden'); };
    $('#emoteBtn').onclick = () => {
      const box = $('#emotes'); box.classList.toggle('hidden');
      box.innerHTML = '';
      if (!this.emoteList.length) box.innerHTML = '<small>Move on from an arena to earn its emote.</small>';
      for (const em of this.emoteList) { const b = el('button', {}, esc(em)); b.onclick = () => { this.emote(em, true); box.classList.add('hidden'); }; box.append(b); }
    };
    window.addEventListener('keydown', e => {
      const n = '1234'.indexOf(e.key);
      if (n >= 0 && current === 'battle') { const id = this.ctrl.battle.s.players[this.ctrl.side].hand[n]; this.held = id; this.drawHand(true); }
      if (e.key === 'Escape') { this.held = null; this.ghost = null; this.drawHand(true); }
    });
  },
  pauseMenu() {
    const box = el('div', {}, '<b>Paused</b><br><small>Leaving counts as a loss.</small>');
    const resume = el('button', { className: 'ok' }, 'Resume'); resume.onclick = () => { this.ctrl.paused = false; $('#pauseBtn').textContent = 'II'; closeModal(); };
    const quit = el('button', { className: 'warn' }, 'Leave'); quit.onclick = () => { closeModal(); this.ctrl.paused = false; this.ctrl.battle.end(1 - this.ctrl.side, 'left'); };
    box.append(el('br'), resume, quit); modal(box);
  },
  emote(text, mine) {
    const b = mine ? $('#bubbleMe') : $('#bubbleFoe');
    b.textContent = text; b.classList.add('on'); clearTimeout(b.t); b.t = setTimeout(() => b.classList.remove('on'), 2200);
    if (mine) this.ctrl.emote?.(text);
  },
};

// ---------- bot matches ----------
function startBotMatch({ tryCard } = {}) {
  const practice = !!tryCard;
  const arena = PR.currentArena(save);
  if (!nextRival) chooseRival();
  const { rival } = practice ? { rival: rivalById('pip') } : nextRival;
  const pool = [...save.unlocked, ...(PR.ensureOffer(save, rnd) || [])];
  let botDeck = rival.boss ? assimilationDeck(save.profile, rnd) : buildDeck(rival, pool, rnd);
  let myDeck = save.deck.slice();
  const myLevels = { ...save.levels };
  if (tryCard) { myDeck[Math.floor(rnd() * 8)] = tryCard; myLevels[tryCard] = myLevels[tryCard] || 1; botDeck = STARTER_DECK.slice(); }
  const lvl = practice ? 1 : PR.botLevel(save);
  const botLevels = Object.fromEntries(botDeck.map(id => [id, lvl]));
  const seed = (rnd() * 2 ** 32) >>> 0;
  const battle = new Battle({ seed, decks: [myDeck, botDeck], levels: [myLevels, botLevels], towerLevels: [PR.deckLevel(save), lvl],
    settings: { ...DEFAULT_SETTINGS, tie: 'tiebreak' } });
  const rec = save.rivals[rival.id];
  const notes = rec ? { favLane: rec.notes.favLane, opener: rec.notes.opener } : {};
  const r2 = rec?.counterPlan ? { ...rival, style: { ...rival.style, aggression: Math.min(1, rival.style.aggression + 0.2), lane: 'weak', defence: 'bridge' } } : rival;
  const bot = new Bot({ side: 1, rival: r2, seed: seed ^ 0x5bd1e995, progress: practice ? 0 : PR.arenaProgress(save), notes, profile: rival.boss ? save.profile : null });
  const plays = [];
  const ctrl = new LocalCtrl(battle, bot);
  if (new URLSearchParams(location.search).has('demo')) ctrl.bot2 = new Bot({ side: 0, rival: rivalById('rook'), seed: seed + 7 });   // watch two bots play (testing)
  const origUpdate = ctrl.update.bind(ctrl);
  ctrl.update = (now, onTick) => { const r = origUpdate(now, onTick); for (const e of r.events) if (e.e === 'play' && e.side === 0) plays.push({ card: e.card, lane: laneOf(e.x), enemySide: DEF[e.card].type === 'troop' || ownY(0, e.y) < 17 * MT }); return r; };
  const emotes = PR.ownedEmotes(save);
  screen.begin(ctrl, { foe: rival.name, foeLvl: practice ? 'practice' : `Lv ${lvl}${save.eased ? ' eased' : ''}`, me: save.name, arena: practice ? 1 : arena, pausable: true, emotes,
    onEnd: b => practice ? endPractice(b, tryCard) : endBotMatch(b, rival, plays) });
}

function endPractice(b, card) {
  show('result');
  const p = $('#resultPanel');
  p.innerHTML = `<h1 class="draw">Practice over</h1><p>No rewards in practice. Did ${esc(CARDS[card].name)} feel right?</p>`;
  const back = el('button', { className: 'go big' }, 'Back to the offer'); back.onclick = () => { show('home'); openOffer(); };
  p.append(back);
}

function endBotMatch(b, rival, plays) {
  const s = b.s, w = s.winner;
  const result = w === -1 ? 'draw' : w === 0 ? 'win' : 'loss';
  const watch = 2 - s.units.filter(u => u.kind === 'tower' && u.type === 'watch' && u.side === 1).length;
  const keep = !s.units.some(u => u.kind === 'tower' && u.type === 'keep' && u.side === 1);
  const wasEased = save.eased;
  const out = PR.applyBotResult(save, { result, watch, keep, rival: rival.id, eased: wasEased, plays });
  persist();
  chooseRival();
  show('result');
  const p = $('#resultPanel');
  const title = { win: 'VICTORY', loss: 'DEFEAT', draw: 'DRAW' }[result];
  p.innerHTML = `<h1 class="${result}">${title}</h1>
    <p>${s.players[0].banners} ⚑ vs ${s.players[1].banners} ⚑ against ${esc(rival.name)}${s.reason === 'tiebreak' ? ' (tower health tiebreak)' : ''}</p>
    <div class="reward"><span>Coins</span><b>+${fmt(out.coins)}</b></div>
    <div class="reward"><span>Keys</span><b>+${out.keys}</b></div>
    <div class="reward"><span>Glory</span><b>${out.glory >= 0 ? '+' : ''}${out.glory}${result === 'win' && wasEased ? ' (eased bot)' : ''}</b></div>
    ${out.arenaUp ? `<p style="color:var(--gold)">New arena: ${esc(PR.arenaInfo(out.arenaUp).name)}!</p>` : ''}
    ${out.newEmotes?.length ? `<p><small>Emote unlocked: ${out.newEmotes.map(e => '"' + esc(e) + '"').join(', ')}</small></p>` : ''}
    ${out.eased && !wasEased ? '<p><small>3 losses in a row: the next bots play one level lower until you win.</small></p>' : ''}`;
  const row = el('div', { className: 'row', style: 'justify-content:center' });
  if (out.picks) { const pick = el('button', { className: 'ok' }, 'Pick a card'); pick.onclick = () => { show('home'); openOffer(); }; row.append(pick); }
  const again = el('button', { className: 'go' }, 'Battle again'); again.onclick = () => startBotMatch();
  const home = el('button', {}, 'Home'); home.onclick = () => show('home');
  row.append(again, home); p.append(row);
  if (result === 'win') sfx.coin();
}

// ---------- start ----------
export const online = new Online({ getSave: () => save, persist, screen, show, toast, modal, closeModal, cardEl, el, esc });
show('home');
account.start();
if (!localStorage.getItem(KEY + '.seen')) {
  try { localStorage.setItem(KEY + '.seen', '1'); } catch { /* private mode */ }
  modal(`<b>Welcome to Banner Clash</b><p><small>Drag a card from your hand onto your half of the arena (or tap the card, then tap the arena). Cards cost Spark, which refills over time. Knock down more enemy towers than you lose in 3 minutes. Taking the big Keep in the middle wins at once.</small></p><button class="go" onclick="document.getElementById('modal').classList.add('hidden')">Let's go</button>`);
}
