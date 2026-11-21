'use strict';
// Which sound plays for which game event, and where on screen it is. The sounds themselves are in sfx.js.
// Uses globals from client.js at the time an event arrives: cam, scale, W, me, myId, hello.
const SOUND = {
  slots: ['q', 'w', 'e', 'r'],
  ult: 3,                 // the ability slot that is heard even from out of sight
  warnAgainAfter: 4,      // seconds before a tower targeting you again repeats its warning
  cut: 0.03,              // seconds: how abruptly an interrupted sound stops
  noteFor: 1000,          // ms the "Sound off / Sound on" note stays up
  samples: { master: 'shared.levelUp', fx: 'shared.towerShot', ui: 'shared.coin' },   // what a volume slider plays
};
const snd = { recalling: new Set(), towersOnMe: new Set(), warnedAt: -99 };

// Play a sound that happens at world position x. `own` = it is your own hero's (never quieter than 70%).
function soundAt(name, x, o = {}) {
  const p = SFX.place((x - cam.x) * scale / W, !!o.own); if (!p) return null;
  return SFX.play(name, { ...o, pan: p.pan, vol: p.vol });
}
const soundName = (hero, name) => (hero && SFX.find(`${hero}.${name}`) ? `${hero}.${name}` : `shared.${name}`);

// One event from a snapshot. `units` = the units the player can currently see, by id.
function soundEvent(e, units) {
  if (!me || !hello) return;
  const mine = me.id, own = e.id === mine, seen = !e.id || units.has(e.id), from = units.get(e.id);
  switch (e.e) {
    case 'cast': {
      if (e.re || (!seen && e.s !== SOUND.ult)) break;            // fog: only an ultimate is heard from out of sight
      soundAt(`${e.h}.${SOUND.slots[e.s]}Cast`, e.x, { own, tag: `${e.id}:${e.s}` }); break;
    }
    case 'atk': {                                                  // an attack was started; it goes off after e.d seconds
      if (!from) break;
      const name = from.k === 'h' ? `${from.h}.attack` : from.k === 't' ? (from.tg === mine ? 'shared.towerShotMe' : 'shared.towerShot')
        : from.m === 1 ? 'shared.minionHit' : from.m === 2 ? 'shared.cannonShot' : 'shared.casterShot';
      setTimeout(() => soundAt(name, from.x, { own }), e.d * 1000); break;
    }
    case 'dmg': {
      const by = units.get(e.s); if (!e.a || !by) break;           // a hero's basic attack landing
      soundAt(`${by.h}.attackHit`, e.x, { own: e.s === mine });
      if (e.cr) soundAt('shared.crit', e.x, { own: e.s === mine }); break;
    }
    case 'die':
      if (e.k === 'm') soundAt('shared.minionDeath', e.x);
      else if (e.k === 't') soundAt('shared.towerFall', e.x);
      else { soundAt(`${e.h}.death`, e.x); soundAt('shared.heroDeath', e.x); }
      break;
    case 'kill': if (e.kp === myId) SFX.play('shared.kill'); else if (e.vp === myId) SFX.play('shared.died'); break;
    case 'gold': SFX.play(e.w === 'm' ? 'shared.coin' : 'shared.coinLow'); break;       // only ever sent to the player who earned it
    case 'lvl': if (own) SFX.play('shared.levelUp'); break;
    case 'sfx': {
      const tag = `${e.id}:${e.s}`;
      if (e.k === 'end' || e.k === 'cancel') SFX.stopTag(tag, SOUND.cut);                // a charge or channel is over: stop its sound
      if (e.p !== undefined) { SFX.play(`shared.${e.k}`); break; }                       // shop sounds, for you alone
      if (e.k === 'respawn') { if (own) SFX.play('shared.respawn'); break; }
      if (!seen && !e.u && !e.v && e.s !== SOUND.ult) break;                             // fog of war
      const name = e.s != null ? SOUND.slots[e.s] + e.k[0].toUpperCase() + e.k.slice(1) : e.k;
      soundAt(soundName(e.h, name), e.x, { own, n: e.n, d: e.d, tag });
      if (e.k === 'land' && e.c) soundAt(soundName(e.h, SOUND.slots[e.s] + 'Centre'), e.x, { own });   // the stronger middle of an area
      break;
    }
  }
}
// Things that are not events but show in the snapshot: a hero recalling, a tower picking you.
function soundSnapshot(s, now) {
  if (!me) return;
  const units = new Map(s.units.map(u => [u.id, u]));
  for (const e of s.ev) soundEvent(e, units);
  for (const u of s.units) {
    if (u.k === 'h') {
      const tag = 'rc:' + u.id;
      if (u.rc > 0 && !snd.recalling.has(u.id)) { snd.recalling.add(u.id); soundAt('shared.recall', u.x, { own: u.id === me.id, tag, d: hello.rules.recallTime, vary: false }); }
      else if (!(u.rc > 0) && snd.recalling.has(u.id)) { snd.recalling.delete(u.id); SFX.stopTag(tag, SOUND.cut); }   // finished or interrupted: the hum cuts
    } else if (u.k === 't') {
      const onMe = u.tg === me.id;
      if (onMe && !snd.towersOnMe.has(u.id) && now - snd.warnedAt > SOUND.warnAgainAfter) { snd.warnedAt = now; SFX.play('shared.towerWarn'); }
      if (onMe) snd.towersOnMe.add(u.id); else snd.towersOnMe.delete(u.id);
    }
  }
  for (const id of snd.recalling) if (!units.has(id)) { snd.recalling.delete(id); SFX.stopTag('rc:' + id, SOUND.cut); }   // walked out of sight
}

// ---------- volume ----------
function soundSettings(cfg) {
  SFX.setVolume({ master: cfg.volMaster / 100, fx: cfg.volFx / 100, ui: cfg.volUi / 100,
    muteMaster: cfg.muteMaster, muteFx: cfg.muteFx, muteUi: cfg.muteUi, muteUnfocused: cfg.muteUnfocused });
}
let noteTimer = 0;
function toggleMute() {
  const off = !Settings.cfg.muteMaster; Settings.set({ muteMaster: off });
  const n = document.getElementById('note'); n.textContent = off ? 'Sound off' : 'Sound on'; n.style.display = 'block';
  clearTimeout(noteTimer); noteTimer = setTimeout(() => { n.style.display = 'none'; }, SOUND.noteFor);
}
function soundSetup() {
  Settings.onChange(soundSettings); soundSettings(Settings.cfg);
  Settings.onSample = group => SFX.play(SOUND.samples[group], { vary: false });
  addEventListener('blur', () => SFX.setVolume({ focused: false }));
  addEventListener('focus', () => SFX.setVolume({ focused: true }));
  document.getElementById('spk').onclick = () => Settings.open([], { only: 'audio' });
}
