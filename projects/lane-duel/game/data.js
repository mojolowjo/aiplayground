// Hero, item and spell definitions. All kits are original.
// Ability `cast(g, h, r, aim)`: g = Game, h = hero, r = rank index (0-based),
// aim = { x, y, dx, dy, power, target } (x,y already clamped to ability range).
// Optional ability hooks: pick (choose a target, or refuse the cast), tick (runs every step once learned),
// onAttackHit (runs when the hero's attack lands), recast / onTick / onLeave (for abilities that put the
// hero into a state).
// Optional hero `passive` hooks: onAttack, onKill, beforeDamage, plus wait / count for the HUD.
// Each hero also has a recommended `build` (the shop's Recommended tab, and what the bot buys): a list of steps,
// where a step is an item id, a list bought together at the start, or { attack, ability } to choose by what
// the enemy mostly deals (their `dmgType`).
// Regen values are per second. "Bonus AD" is attack damage from items (h.bonusAd).

const R = (arr, r) => arr[Math.min(r, arr.length - 1)];
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const byLevel = (at1, at18, lvl) => at1 + (at18 - at1) * (Math.min(18, lvl) - 1) / 17;   // even steps from level 1 to 18
const tier = lvl => (lvl >= 16 ? 3 : lvl >= 11 ? 2 : lvl >= 6 ? 1 : 0);                   // steps up at levels 6, 11 and 16
const list = a => a.join('/'), pct = a => a.map(v => Math.round(v * 100)).join('/');     // for tooltips

export const HEROES = {
  oriel: {
    name: 'Oriel', build: [['starterring', 'potion', 'potion'], 'codex', 'emberorb', 'casterboots', 'crown', 'voidstaff', 'doomstaff'], dmgType: 'ability', role: 'Mage', color: '#c58bff',
    hp: 560, hpPer: 90, mana: 420, manaPer: 30, ad: 52, adPer: 3, as: 0.63, asPer: 1.5,
    armor: 21, armorPer: 4, mr: 30, mrPer: 1.3, ms: 330, range: 550, melee: false,
    projSpeed: 1600, windup: 0.22, hpRegen: 0.7, manaRegen: 2.2,
    abilities: [
      { key: 'Q', name: 'Cinder Lance', kind: 'line', range: 1050, width: 70, castTime: 0.25,
        cd: [7, 6.5, 6, 5.5, 5], cost: [55, 60, 65, 70, 75],
        desc: 'Skillshot that hits the first enemy for 80/125/170/215/260 + 70% AP magic damage.',
        cast(g, h, r, aim) {
          const dmg = R([80, 125, 170, 215, 260], r) + 0.7 * h.ap;
          g.line(h, aim, { speed: 1700, range: 1050, width: 70, color: '#ff9a4a',
            onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        } },
      { key: 'W', name: 'Flare Zone', kind: 'point', range: 900, radius: 220, castTime: 0.25,
        cd: [10, 9.5, 9, 8.5, 8], cost: [70],
        desc: 'After 0.75s an area erupts for 70/115/160/205/250 + 60% AP.',
        cast(g, h, r, aim) {
          const dmg = R([70, 115, 160, 205, 250], r) + 0.6 * h.ap;
          g.strike(h, { x: aim.x, y: aim.y, r: 220, delay: 0.75, color: '#ff9a4a',
            onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        } },
      { key: 'E', name: 'Snare Spark', kind: 'line', range: 950, width: 70, castTime: 0.25,
        cd: [14, 13, 12, 11, 10], cost: [60],
        desc: 'Slow skillshot that roots the first enemy for 1/1.1/1.2/1.3/1.4s and deals 60/90/120/150/180 + 40% AP.',
        cast(g, h, r, aim) {
          const dmg = R([60, 90, 120, 150, 180], r) + 0.4 * h.ap;
          g.line(h, aim, { speed: 1400, range: 950, width: 70, color: '#b06bff', onHit(t) {
            g.damage(h, t, dmg, 'magic'); g.root(t, 1 + 0.1 * r);
          } });
        } },
      { key: 'R', name: 'Sunburst', kind: 'point', range: 1000, radius: 350, castTime: 0.3,
        cd: [110, 95, 80], cost: [100],
        desc: 'After 1.1s a large area detonates for 250/375/500 + 90% AP.',
        cast(g, h, r, aim) {
          const dmg = R([250, 375, 500], r) + 0.9 * h.ap;
          g.strike(h, { x: aim.x, y: aim.y, r: 350, delay: 1.1, color: '#ffd24a',
            onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        } },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Gorrum, the Salvage Hulk: a grab tank. Forced movement, an empowered attack, and one ability
// with a passive mode and an active mode.
HEROES.gorrum = {
  name: 'Gorrum', build: [['startershield', 'potion', 'potion'], 'heartgem', { attack: 'ironboots', ability: 'spiritboots' }, 'frostplate', 'spiritcloak', 'thornmail', 'titanheart'], dmgType: 'attack', role: 'Grab tank', color: '#c9973f',
  hp: 600, hpPer: 109, mana: 267, manaPer: 40, ad: 62, adPer: 3.5, as: 0.625, asPer: 1.13,
  armor: 37, armorPer: 4.7, mr: 32, mrPer: 2.05, ms: 325, range: 125, melee: true,
  windup: 0.25, hpRegen: 1.5, hpRegenPer: 0.15, manaRegen: 1.7, manaRegenPer: 0.16,
  // Threshold trigger with a cooldown, checked before each hit lands. The shield is a "floor shield": it only
  // soaks the part of a hit that would take him below the threshold.
  passive: { name: 'Ballast Plating', every: 90, floor: 0.3, manaShare: 0.35, lasts: 10,
    desc: 'When damage would take Gorrum below 30% health he gains a shield equal to 35% of his max mana for 10s. It only absorbs damage that would take him below 30%. Can happen once every 90s.',
    wait: (g, h) => (h.ballastAt || 0) - g.time,
    beforeDamage(g, h, amt) {
      const floor = this.floor * h.mhp;
      if (this.wait(g, h) > 0 || h.hp - amt >= floor) return;
      h.floorShield = { amt: this.manaShare * h.mmp, until: g.time + this.lasts, floor }; h.ballastAt = g.time + this.every;
    } },
  abilities: [
    { key: 'Q', name: 'Harpoon Line', kind: 'line', range: 1080, width: 140, speed: 1800, castTime: 0.25,
      cd: [20, 19, 18, 17, 16], cost: [100], dmg: [110, 160, 210, 260, 310], ap: 1.2,
      pullSpeed: 1700, landGap: 75, stun: 0.65, afterHit: 0.25,
      get desc() { return `Fire a harpoon. The first enemy it hits takes ${list(this.dmg)} + ${this.ap * 100}% AP, is stunned for ${this.stun}s and is dragged to just in front of Gorrum. He cannot move or attack while the harpoon flies, or for ${this.afterHit}s after it hits.`; },
      cast(g, h, r, aim) {
        const dmg = R(this.dmg, r) + this.ap * h.ap, me = this;
        g.enter(h, 0, 'hooking', this.range / this.speed, { lock: true });     // held in place while the harpoon is out
        g.line(h, aim, { speed: this.speed, range: this.range, width: this.width, color: '#9fe8d2', style: 'harpoon', tether: true,
          onHit(t) {
            g.damage(h, t, dmg, 'magic'); g.pull(t, h, me.pullSpeed, { gap: me.landGap, stun: me.stun });
            if (h.state && h.state.name === 'hooking') h.state.until = g.time + me.afterHit;
          } });
      } },
    // Chained timed buffs: the speed buff decays, and when it runs out its onEnd applies the slow.
    { key: 'W', name: 'Boiler Vent', kind: 'self', cd: [15], cost: [75], lasts: 5,
      as: [30, 40, 50, 60, 70], haste: [0.6, 0.65, 0.7, 0.75, 0.8], hasteEnd: 0.1, decay: 2.9, slow: 0.3, slowFor: 1.5,
      get desc() { return `For ${this.lasts}s gain ${list(this.as)}% attack speed and ${pct(this.haste)}% move speed, the move speed fading to ${this.hasteEnd * 100}% over the first ${this.decay}s. When it ends you are slowed by ${this.slow * 100}% for ${this.slowFor}s.`; },
      cast(g, h, r) {
        g.addBuff(h, 'as', R(this.as, r), this.lasts);
        g.addBuff(h, 'haste', R(this.haste, r), this.lasts, { to: this.hasteEnd, over: this.decay, onEnd: () => g.addBuff(h, 'slow', this.slow, this.slowFor) });
      } },
    { key: 'E', name: 'Anchor Fist', kind: 'self', cd: [7, 6.5, 6, 5.5, 5], cost: [25], window: 5, adRatio: 1, ap: 0.25, knockUp: 1,
      get desc() { return `Resets your attack. Your next attack within ${this.window}s deals ${this.adRatio * 100}% AD + ${this.ap * 100}% AP bonus physical damage and knocks the enemy into the air for ${this.knockUp}s. Once that attack starts it cannot be cancelled.`; },
      cast(g, h) {
        const me = this;
        h.emp = { until: g.time + this.window, lockWindup: true, hit(t) { g.knockUp(t, me.knockUp); return me.adRatio * h.ad + me.ap * h.ap; } };
        h.nextAttack = g.time;
      } },
    // Passive mode (onAttackHit + tick) only adds marks while the ability is off cooldown, so casting it switches that off.
    { key: 'R', name: 'Pressure Pulse', kind: 'self', radius: 600, castTime: 0.25, cd: [60, 40, 20], cost: [100],
      dmg: [275, 400, 525], ap: 1, silence: 0.5, markDmg: [50, 100, 150], markAp: [0.3, 0.4, 0.5], markMana: 0.02, markEvery: 1,
      get desc() { return `While this is ready, each of your basic attacks leaves a mark on its target. Marks go off one per ${this.markEvery}s, each dealing ${list(this.markDmg)} + ${pct(this.markAp)}% AP + ${this.markMana * 100}% of your max mana. Activate to pulse: enemies within ${this.radius} take ${list(this.dmg)} + ${this.ap * 100}% AP, lose their shields and are silenced for ${this.silence}s. No new marks until this is ready again.`; },
      onAttackHit(g, h, r, t) {
        if (h.cds[3] > g.time || t.type === 'tower') return;
        const marks = h.pulseMarks || (h.pulseMarks = new Map()), m = marks.get(t) || { n: 0, next: g.time + this.markEvery };
        m.n++; marks.set(t, m);
      },
      tick(g, h, r) {
        if (!h.pulseMarks) return;
        for (const [t, m] of [...h.pulseMarks]) {
          if (t.dead) { h.pulseMarks.delete(t); continue; }
          if (g.time < m.next) continue;
          m.next += this.markEvery; if (--m.n <= 0) h.pulseMarks.delete(t);
          g.fx({ e: 'zap', x: h.x | 0, y: h.y | 0, x2: t.x | 0, y2: t.y | 0 });
          g.damage(h, t, R(this.markDmg, r) + R(this.markAp, r) * h.ap + this.markMana * h.mmp, 'magic');
        }
      },
      cast(g, h, r) {
        const dmg = R(this.dmg, r) + this.ap * h.ap;
        g.burst(h, h.x, h.y, this.radius, '#9fe8d2', t => { g.stripShields(t); g.damage(h, t, dmg, 'magic'); g.silence(t, this.silence); });
      } },
  ],
};

// ---------------------------------------------------------------------------------------------
// Wren Ashby, the Wayfinder: a skillshot marksman. Cooldown refunds, mark and detonate, stacking buffs.
// Every ability hit goes through `landed`, which adds a passive stack and pops her Waymark if it is there
// (telling the mark what the ability cost, because the mark pays that back).
const landed = (g, h, t, cost, pop = true) => { HEROES.wren.passive.gain(g, h); if (pop) g.popMark(h, t, { cost }); };
HEROES.wren = {
  name: 'Wren Ashby', build: [['starterblade', 'potion'], 'edge', 'hasteboots', 'duskblade', 'critblade', 'longbow', 'ruinblade'], dmgType: 'attack', role: 'Marksman', color: '#f0c05a',
  hp: 600, hpPer: 102, mana: 375, manaPer: 70, ad: 60, adPer: 3.75, as: 0.625, asPer: 2.5,
  armor: 24, armorPer: 4.2, mr: 33, mrPer: 1.1, ms: 325, range: 550, melee: false,
  projSpeed: 2000, shot: 'light', windup: 0.188, hpRegen: 0.8, hpRegenPer: 0.13, manaRegen: 1.7, manaRegenPer: 0.2,
  // Stacking buff with a cap and a decay timer: one tagged buff that is replaced on every new stack.
  passive: { name: 'Trailblazer', max: 5, per: 10, lasts: 6,
    desc: 'Each ability you land gives a stack of 10% attack speed for 6s, up to 5 stacks. Landing another refreshes them all; if the timer runs out they are all lost.',
    count: (g, h) => (h.trail && h.trail.until > g.time ? h.trail.n : 0),
    gain(g, h) {
      const n = Math.min(this.max, this.count(g, h) + 1);
      h.trail = { n, until: g.time + this.lasts };
      g.addBuff(h, 'as', n * this.per, this.lasts, { tag: 'trail' });
    } },
  abilities: [
    // Cooldown refund: on a hit, every ability's remaining cooldown shrinks. It also counts as an attack landing.
    { key: 'Q', name: 'Compass Bolt', kind: 'line', range: 1200, width: 120, speed: 2000, castTime: 0.25,
      cd: [5.5, 5.25, 5, 4.75, 4.5], cost: [28, 31, 34, 37, 40], dmg: [20, 45, 70, 95, 120], adRatio: 1.3, ap: 0.4, refund: 1.5,
      get desc() { return `A fast bolt that hits the first enemy for ${list(this.dmg)} + ${this.adRatio * 100}% AD + ${this.ap * 100}% AP physical damage. If it hits, all your abilities come back ${this.refund}s sooner. It counts as an attack landing, so it bursts your Waymark.`; },
      cast(g, h, r, aim) {
        const dmg = R(this.dmg, r) + this.adRatio * h.ad + this.ap * h.ap, me = this, cost = R(this.cost, r);
        g.line(h, aim, { speed: this.speed, range: this.range, width: this.width, color: '#fff2c0', style: 'light', onHit(t) {
          g.damage(h, t, dmg, 'phys'); HEROES.wren.passive.gain(g, h); g.applyOnHit(h, t, { cost });
          for (const s of [0, 1, 2, 3]) h.cds[s] -= me.refund;
        } });
      } },
    // Mark and detonate: this only applies the tag; the burst lives in the tag and anything else she lands pops it.
    { key: 'W', name: 'Waymark', kind: 'line', range: 1200, width: 160, speed: 1700, castTime: 0.25,
      cd: [8], cost: [50], lasts: 4, dmg: [80, 135, 190, 245, 300], bonusAd: 1.15, ap: 1, manaBack: 60,
      get desc() { return `An orb that marks the first enemy it hits for ${this.lasts}s. Hitting the marked enemy with an attack or another ability bursts the mark for ${list(this.dmg)} + ${this.bonusAd * 100}% bonus AD + ${this.ap * 100}% AP. Bursting it with an ability restores ${this.manaBack} mana plus that ability's cost; a basic attack restores none.`; },
      cast(g, h, r, aim) {
        const dmg = R(this.dmg, r) + this.bonusAd * h.bonusAd + this.ap * h.ap, me = this;
        g.line(h, aim, { speed: this.speed, range: this.range, width: this.width, color: '#ffe9a0', onHit(t) {
          landed(g, h, t, 0, false);
          t.mark = { by: h.id, until: g.time + me.lasts, pop(u, via) {
            g.fx({ e: 'burst', x: u.x, y: u.y, r: 110, c: '#ffe9a0' }); g.damage(h, u, dmg, 'magic');
            if (via) g.restoreMana(h, me.manaBack + via.cost);
          } };
        } });
      } },
    // Teleport, then auto-target: a marked enemy first, otherwise the nearest one from the new position.
    { key: 'E', name: 'Fold Step', kind: 'dash', range: 475, castTime: 0.25, cd: [26, 23, 20, 17, 14], cost: [70], seek: 750, boltSpeed: 2000,
      dmg: [80, 130, 180, 230, 280], bonusAd: 0.6, ap: 0.75,
      get desc() { return `Blink a short distance, then fire a bolt at an enemy within ${this.seek} (a marked one first, otherwise the nearest) for ${list(this.dmg)} + ${this.bonusAd * 100}% bonus AD + ${this.ap * 100}% AP.`; },
      cast(g, h, r, aim) {
        g.blink(h, aim.x, aim.y);
        const dmg = R(this.dmg, r) + this.bonusAd * h.bonusAd + this.ap * h.ap, cost = R(this.cost, r);
        const marked = g.enemiesIn(h.team, h.x, h.y, this.seek).filter(u => g.targetable(h, u) && u.mark && u.mark.by === h.id && u.mark.until > g.time)
          .sort((a, b) => g.dist(a, h) - g.dist(b, h))[0];
        const t = marked || g.nearestEnemy(h, this.seek);
        if (t && t.type === 'hero') g.callForHelp(h, t);               // an auto-targeted bolt counts as a targeted ability
        if (t) g.homing(h, h.x, h.y, t, this.boltSpeed, '#fff2c0', () => { g.damage(h, t, dmg, 'magic'); landed(g, h, t, cost); }, 'light');
      } },
    // Map-length piercing projectile; damage depends on what it hits.
    { key: 'R', name: 'Meridian', kind: 'line', width: 320, speed: 2000, reach: 20000, castTime: 1, cd: [120, 105, 90], cost: [100],
      dmg: [350, 600, 850], bonusAd: 1.1, ap: 1.2, minionDmg: [150, 225, 300], minionBonusAd: 1, minionAp: 1.1,
      get desc() { return `After ${this.castTime}s, send a wave of light across the whole map. It passes through everything, dealing ${list(this.dmg)} + ${this.bonusAd * 100}% bonus AD + ${this.ap * 100}% AP to heroes and ${list(this.minionDmg)} + ${this.minionBonusAd * 100}% bonus AD + ${this.minionAp * 100}% AP to minions.`; },
      cast(g, h, r, aim) {
        const hero = R(this.dmg, r) + this.bonusAd * h.bonusAd + this.ap * h.ap, minion = R(this.minionDmg, r) + this.minionBonusAd * h.bonusAd + this.minionAp * h.ap;
        const cost = R(this.cost, r);
        g.line(h, aim, { speed: this.speed, range: this.reach, width: this.width, color: '#fff2c0', style: 'wave', pierce: true, onHit(t) {
          g.damage(h, t, t.type === 'hero' ? hero : minion, 'magic'); landed(g, h, t, cost);
        } });
      } },
  ],
};

// ---------------------------------------------------------------------------------------------
// Sable Venn, the Glass Dancer: a reset assassin with no mana. Objects in the world, chain targeting, a channel.
// Her blades are pickups: every way of dropping one goes through dropBlade, and touching one slashes and
// brings Moonstep most of the way back.
const BLADE = { r: 150, life: 4, slash: 340, dmg1: 68, dmg18: 240, bonusAd: 0.6, ap: [0.7, 0.8, 0.9, 1], moonstepCut: [0.78, 0.84, 0.9, 0.96] };
const slash = (g, h) => {
  const dmg = byLevel(BLADE.dmg1, BLADE.dmg18, h.lvl) + BLADE.bonusAd * h.bonusAd + BLADE.ap[tier(h.lvl)] * h.ap;
  g.burst(h, h.x, h.y, BLADE.slash, '#dfe9ff', t => g.damage(h, t, dmg, 'magic'));
  const e = h.def.abilities[2];
  if (h.ranks[2] > 0) h.cds[2] -= BLADE.moonstepCut[tier(h.lvl)] * R(e.cd, h.ranks[2] - 1);
};
const dropBlade = (g, h, x, y, delay) => g.drop(h, x, y, delay, { kind: 'blade', r: BLADE.r, life: BLADE.life, onTake: () => slash(g, h) });
HEROES.sable = {
  name: 'Sable Venn', build: [['startershield', 'potion', 'potion'], 'codex', 'casterboots', 'hexblade', 'emberorb', 'voidstaff', 'doomstaff'], dmgType: 'ability', role: 'Assassin', color: '#b9c8ec',
  manaless: true, mana: 0, manaPer: 0, manaRegen: 0,
  hp: 672, hpPer: 108, ad: 58, adPer: 3.2, as: 0.658, asPer: 2.74,
  armor: 32, armorPer: 4.7, mr: 32, mrPer: 2.05, ms: 335, range: 125, melee: true,
  windup: 0.2, hpRegen: 1.5, hpRegenPer: 0.14,
  // Kill-event hook. (The slash on picking up a blade lives with the blades, above.)
  passive: { name: 'Encore', refund: 15, recent: 3,
    get desc() { return `A kill or assist on an enemy hero you damaged in the last ${this.recent}s takes ${this.refund}s off all your cooldowns. Walking over one of your dropped blades picks it up, slashes enemies within ${BLADE.slash} for ${BLADE.dmg1}-${BLADE.dmg18} (by level) + ${BLADE.bonusAd * 100}% bonus AD + ${pct(BLADE.ap)}% AP (at levels 1/6/11/16), and cuts Moonstep's cooldown by ${pct(BLADE.moonstepCut)}% of its full length.`; },
    onKill(g, h, t) {
      if (t.type !== 'hero' || !(g.time - (t.hitBy.get(h.id) ?? -99) <= this.recent)) return;
      for (let s = 0; s < 4; s++) h.cds[s] -= this.refund;
    } },
  abilities: [
    { key: 'Q', name: 'Ricochet Crescent', kind: 'pick', range: 625, castTime: 0.25, cd: [11, 10, 9, 8, 7], cost: [0],
      dmg: [80, 115, 150, 185, 220], ap: 0.4, bounces: 2, hop: 450, aimSlack: 260, bladeSpeed: 1500, bladePast: 350, bladeDelay: 1,
      get desc() { return `Throw a blade at the enemy nearest the cursor. It bounces to up to ${this.bounces} more nearby enemies for ${list(this.dmg)} + ${this.ap * 100}% AP each. ${this.bladeDelay}s after the first hit it lands on the ground ${this.bladePast} units behind the first target.`; },
      pick(g, h, aim) {
        return [...g.units.values()].filter(u => u.type !== 'tower' && g.targetable(h, u) && g.dist(h, u) <= this.range + u.radius && Math.hypot(u.x - aim.x, u.y - aim.y) <= this.aimSlack)
          .sort((a, b) => Math.hypot(a.x - aim.x, a.y - aim.y) - Math.hypot(b.x - aim.x, b.y - aim.y))[0];
      },
      cast(g, h, r, aim) {
        const first = aim.target, dmg = R(this.dmg, r) + this.ap * h.ap, me = this, from = { x: h.x, y: h.y };
        if (first.dead) return;
        const targets = g.chain(h, first, 1 + this.bounces, this.hop);
        const fly = (src, i) => g.homing(h, src.x, src.y, targets[i], this.bladeSpeed, '#dfe9ff', () => {
          if (i === 0) { const dx = first.x - from.x, dy = first.y - from.y, d = Math.hypot(dx, dy) || 1; dropBlade(g, h, first.x + dx / d * me.bladePast, first.y + dy / d * me.bladePast, me.bladeDelay); }
          g.damage(h, targets[i], dmg, 'magic'); if (i + 1 < targets.length) fly(targets[i], i + 1);
        }, 'blade');
        fly(h, 0);
      } },
    // Delayed spawn: the blade exists from now but only becomes live when its timer runs out.
    { key: 'W', name: 'Toss & Twirl', kind: 'self', cd: [15, 14, 13, 12, 11], cost: [0], haste: [0.5, 0.6, 0.7, 0.8, 0.9], lasts: 1.25,
      get desc() { return `Toss a blade straight up and gain ${pct(this.haste)}% move speed, fading to nothing over ${this.lasts}s; for that time you also pass through minions. The blade lands where you were standing.`; },
      cast(g, h, r) {
        g.addBuff(h, 'haste', R(this.haste, r), this.lasts, { to: 0, over: this.lasts });
        h.ghostUntil = g.time + this.lasts; dropBlade(g, h, h.x, h.y, this.lasts);
      } },
    // Target validation: allowed targets are her own landed blades and any other unit; the result differs by type.
    { key: 'E', name: 'Moonstep', kind: 'dash', range: 725, castTime: 0.15, cd: [12, 11, 10, 9, 8], cost: [0],
      dmg: [20, 30, 40, 50, 60], adRatio: 0.4, ap: 0.25, aimSlack: 260, reachSlack: 150,
      get desc() { return `Blink to a unit or one of your dropped blades near the cursor. Arriving at an enemy deals ${list(this.dmg)} + ${this.adRatio * 100}% AD + ${this.ap * 100}% AP. Arriving at a blade picks it up and slashes at once. Your attack is ready again straight away, unless the hit killed its target.`; },
      pick(g, h, aim) {
        const near = o => Math.hypot(o.x - aim.x, o.y - aim.y), ok = o => near(o) <= this.aimSlack && g.dist(h, o) <= this.range + this.reachSlack;
        const blade = g.pickups.filter(b => b.owner === h && b.kind === 'blade' && g.time >= b.at && ok(b)).sort((a, b) => near(a) - near(b))[0];
        if (blade) return blade;
        return [...g.units.values()].filter(u => u !== h && !u.dead && (u.team === h.team || g.targetable(h, u)) && ok(u)).sort((a, b) => near(a) - near(b))[0];
      },
      cast(g, h, r, aim) {
        const t = aim.target;
        if (t.kind === 'blade') { g.blink(h, t.x, t.y); g.take(h, t); h.nextAttack = g.time; return; }
        if (t.dead) return;
        const dx = h.x - t.x, dy = h.y - t.y, d = Math.hypot(dx, dy) || 1, gap = t.radius + h.radius * 0.6;
        g.blink(h, t.x + dx / d * gap, t.y + dy / d * gap);
        if (t.team !== h.team) { g.damage(h, t, R(this.dmg, r) + this.adRatio * h.ad + this.ap * h.ap, 'magic'); h.order = t.dead ? null : { type: 'atk', id: t.id }; }
        if (!t.dead) h.nextAttack = g.time;
      } },
    // Channel: a locked state that ticks on a timer. A stun or knock-up ends the state, and so the channel.
    { key: 'R', name: 'Glass Storm', kind: 'self', radius: 550, castRange: 500, lasts: 2.5, every: 0.166, blades: 15, targets: 3, cd: [75, 60, 45], cost: [0],
      dmg: [25, 37.5, 50], ap: 0.19, bonusAd: 0.16, bonusAdPerAs: 0.5, bladeSpeed: 1700, noTarget: 'No enemy hero close enough',
      get desc() { return `Needs an enemy hero within ${this.castRange}. Channel for ${this.lasts}s, unable to move or attack, throwing ${this.blades} blades (one every ${this.every}s) at each of up to ${this.targets} enemy heroes within ${this.radius}. Each blade deals ${list(this.dmg)} + ${this.ap * 100}% AP magic damage plus ${this.bonusAd * 100}% bonus AD physical damage (that share grows by ${this.bonusAdPerAs * 100}% bonus AD for every 100% bonus attack speed). Being stunned or knocked up cancels it; press S to end early.`; },
      pick(g, h) { return [...g.heroes.values()].filter(u => g.targetable(h, u) && g.dist(h, u) <= this.castRange).sort((a, b) => g.dist(a, h) - g.dist(b, h))[0]; },
      cast(g, h) { g.enter(h, 3, 'channel', this.lasts, { lock: true, stopEnds: true, every: this.every, thrown: 0 }); },
      onTick(g, h, st) {
        if (st.thrown >= this.blades) return;          // exactly `blades` volleys per channel: at 0s, then every `every` seconds
        st.thrown++;
        const r = h.ranks[3] - 1, magic = R(this.dmg, r) + this.ap * h.ap;
        const phys = h.bonusAd * (this.bonusAd + this.bonusAdPerAs * Math.max(0, g.atkSpeed(h) / h.def.as - 1));
        const near = [...g.heroes.values()].filter(u => g.targetable(h, u) && g.dist(h, u) <= this.radius + u.radius)
          .sort((a, b) => g.dist(a, h) - g.dist(b, h)).slice(0, this.targets);
        for (const t of near) g.homing(h, h.x, h.y, t, this.bladeSpeed, '#dfe9ff', () => { g.damage(h, t, magic, 'magic'); if (phys > 0) g.damage(h, t, phys, 'phys'); }, 'blade');
      } },
  ],
};

// ---------------------------------------------------------------------------------------------
// Kessa is built from two shared pieces in sim.js: g.strike (telegraph -> delay -> resolve) and the ability
// state machine (g.enter / g.leave). Each ability below is one of those, or both, with different numbers.
HEROES.kessa = {
  name: 'Kessa', build: [['starterring', 'potion', 'potion'], 'spellbook', 'crown', 'casterboots', 'voidstaff', 'doomstaff', 'emberorb'], dmgType: 'ability', role: 'Artillery', color: '#6fb6e8',
  hp: 575, hpPer: 106, mana: 400, manaPer: 22, ad: 55, adPer: 3, as: 0.658, asPer: 1.36,
  armor: 22, armorPer: 4.7, mr: 30, mrPer: 1.3, ms: 340, range: 525, melee: false,
  projSpeed: 1500, shot: 'orb', windup: 0.2, hpRegen: 1.1, hpRegenPer: 0.11, manaRegen: 1.37, manaRegenPer: 0.16,
  // Event hooks: sim.js calls onAttack when her basic attack lands and onKill when she kills anything.
  passive: { name: 'Recycler', every: 16, perKill: 3.5, mana1: 30, mana18: 195, heroMult: 2,
    get desc() { return `Every ${this.every}s your next attack restores ${this.mana1}-${this.mana18} mana (by level), doubled against heroes. Each enemy you kill shortens the wait by ${this.perKill}s.`; },
    wait: (g, h) => (h.surgeAt || 0) - g.time,
    onAttack(g, h, t) {
      if (this.wait(g, h) > 0) return;
      const n = Math.round(byLevel(this.mana1, this.mana18, h.lvl) * (t.type === 'hero' ? this.heroMult : 1));
      g.restoreMana(h, n); h.surgeAt = g.time + this.every; g.fx({ e: 'mana', x: Math.round(h.x), y: Math.round(h.y), n, p: h.pid });
    },
    onKill(g, h) { if (this.wait(g, h) > 0) h.surgeAt -= this.perKill; } },
  abilities: [
    // IDLE -> CHARGING (hold) -> FIRING (release). The charge itself lives in sim.js (startCharge / cast).
    { key: 'Q', name: 'Rail Lance', kind: 'line', range: 1450,
      charge: { full: 1.5, hold: 3, min: 700, max: 1450, width: 145, delay: 0.528, slow: { start: 0.1, step: 0.05, every: 0.25, max: 0.4 } },
      cd: [9, 8, 7, 6, 5], cost: [80, 90, 100, 110, 120], dmg: [70, 110, 150, 190, 230], ap: 0.9,
      get desc() { const c = this.charge; return `Hold to charge (the cost is paid when you start): range grows from ${c.min} to ${c.max} over ${c.full}s while you slow down, from ${c.slow.start * 100}% to ${c.slow.max * 100}%. Release to fire a beam that, after ${c.delay}s, hits every enemy in a line for ${list(this.dmg)} + ${this.ap * 100}% AP. Holding for more than ${c.hold}s, or being interrupted, cancels it and refunds half the cost.`; },
      cast(g, h, r, aim) {
        const c = this.charge, len = lerp(c.min, c.max, aim.power), dmg = R(this.dmg, r) + this.ap * h.ap;
        g.strike(h, { shape: 'line', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, len, w: c.width, delay: c.delay, color: '#8fd0ff',
          onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        g.enter(h, 0, 'firing', c.delay, { lock: true });
      } },
    { key: 'W', name: 'Ground Zero', kind: 'point', range: 1000, radius: 275, inner: 125, castTime: 0.25, delay: 0.528,
      cd: [14, 13, 12, 11, 10], cost: [80, 90, 100, 110, 120], dmg: [50, 85, 120, 155, 190], ap: 0.65, centreMult: 5 / 3,
      slow: 0.25, slowFor: 2.5, centreSlow: [0.6, 0.65, 0.7, 0.75, 0.8],
      get desc() { return `Mark an area that blows up after ${this.delay}s for ${list(this.dmg)} + ${this.ap * 100}% AP and a ${this.slow * 100}% slow for ${this.slowFor}s. Enemies in the centre take ${Math.round(this.centreMult * 100)}% of that damage and are slowed by ${pct(this.centreSlow)}%, fading to ${this.slow * 100}% over the ${this.slowFor}s.`; },
      cast(g, h, r, aim) {
        const dmg = R(this.dmg, r) + this.ap * h.ap, me = this;
        g.strike(h, { x: aim.x, y: aim.y, r: this.radius, inner: this.inner, delay: this.delay, color: '#ffe9a0', onHit(t, centre) {
          if (centre) { g.damage(h, t, dmg * me.centreMult, 'magic'); g.addBuff(t, 'slow', R(me.centreSlow, r), me.slowFor, { to: me.slow, over: me.slowFor }); }
          else { g.damage(h, t, dmg, 'magic'); g.addBuff(t, 'slow', me.slow, me.slowFor); }
        } });
      } },
    { key: 'E', name: 'Concussion Shell', kind: 'line', range: 1125, width: 120, speed: 1400, castTime: 0.25,
      cd: [13, 12.5, 12, 11.5, 11], cost: [60, 65, 70, 75, 80], dmg: [70, 100, 130, 160, 190], ap: 0.45, stunMin: 0.75, stunMax: 2.25,
      get desc() { return `Fire a shell that hits the first enemy for ${list(this.dmg)} + ${this.ap * 100}% AP and stuns it for ${this.stunMin}s to ${this.stunMax}s, longer the farther the shell flew.`; },
      cast(g, h, r, aim) {
        const dmg = R(this.dmg, r) + this.ap * h.ap, me = this;
        g.line(h, aim, { speed: this.speed, range: this.range, width: this.width, color: '#dff2ff', onHit(t, shot) {
          g.damage(h, t, dmg, 'magic'); g.stun(t, lerp(me.stunMin, me.stunMax, shot.dist / me.range));
        } });
      } },
    // IDLE -> BARRAGE. Each recast while in the state is one more W-style strike; the state ends when the
    // shots or the time run out, when she is stunned, or on Stop.
    { key: 'R', name: 'Fire Mission', kind: 'self', range: [5000], radius: 200, cd: [130, 115, 100], cost: [100],
      lasts: 10, shots: [4, 5, 6], firstShotAfter: 0.5, between: 0.5, delay: 0.627, dmg: [170, 220, 270], ap: 0.45,
      maxStacks: [3, 4, 5], stackDmg: [20, 25, 30], stackAp: 0.05, revealNear: 600, unusedRefund: 0.5,
      get desc() { return `Root yourself for up to ${this.lasts}s and gain ${list(this.shots)} shots with ${this.range[0]} range. From ${this.firstShotAfter}s in, press R again to drop each one at the cursor: after ${this.delay}s it hits an area for ${list(this.dmg)} + ${this.ap * 100}% AP. Each hero hit makes your later shots deal ${list(this.stackDmg)} + ${this.stackAp * 100}% AP more (up to ${list(this.maxStacks)} times). A shot landing near an enemy hero reveals you. Press S to end early; if you fire nothing, half the cooldown is refunded.`; },
      cast(g, h, r) {
        g.enter(h, 3, 'barrage', this.lasts, { lock: true, stopEnds: true, shots: R(this.shots, r), fired: 0, stacks: 0, next: g.time + this.firstShotAfter, range: R(this.range, r) });
      },
      recast(g, h, r, aim, st) {
        if (g.time < st.next) return;
        const d = Math.min(st.range, Math.hypot(aim.x - h.x, aim.y - h.y)), x = h.x + aim.dx * d, y = h.y + aim.dy * d, me = this;
        const dmg = R(this.dmg, r) + this.ap * h.ap + st.stacks * (R(this.stackDmg, r) + this.stackAp * h.ap);   // stacks earned so far; this shot's own hits count for later ones
        g.strike(h, { x, y, r: this.radius, delay: this.delay, color: '#8fd0ff',
          onLand() { if ([...g.heroes.values()].some(o => o.team !== h.team && !o.dead && Math.hypot(o.x - x, o.y - y) <= me.revealNear)) h.revealUntil = g.time + g.rules.revealFor; },
          onHit(t) { g.damage(h, t, dmg, 'magic'); if (t.type === 'hero') st.stacks = Math.min(R(me.maxStacks, r), st.stacks + 1); } });
        h.face = Math.atan2(aim.dy, aim.dx); g.fx({ e: 'cast', id: h.id, s: 3, d: 0 });
        st.next = g.time + this.between; st.fired++;
        if (--st.shots <= 0) g.leave(h, 'done');
      },
      onLeave(g, h, st) { if (!st.fired) h.cds[3] -= R(this.cd, h.ranks[3] - 1) * this.unusedRefund; } },
  ],
};

export const SPELLS = {
  d: { key: 'D', name: 'Blink', kind: 'dash', range: 400, cd: 300, desc: 'Instantly teleport a short distance.',
    cast(g, h, aim) { g.blink(h, aim.x, aim.y); } },
  f: { key: 'F', name: 'Mend', kind: 'self', cd: 240, heal1: 80, heal18: 318, haste: 0.3, hasteFor: 1,
    get desc() { return `Restore ${this.heal1}-${this.heal18} health (by level) and gain ${this.haste * 100}% move speed for ${this.hasteFor}s.`; },
    cast(g, h) { g.heal(h, byLevel(this.heal1, this.heal18, h.lvl)); g.addBuff(h, 'haste', this.haste, this.hasteFor); } },
};

// ---------------------------------------------------------------------------------------------
// Items. Three tiers that combine: parts -> mid items -> finished items (plus boots, starters, consumables).
//   cost      the total price when bought from nothing (= the recipe's totals + fee)
//   recipe    ids of the items it is built from; `fee` is what combining them costs
//   stats     added to the hero in Game.refresh()
//   passive   { id, name, desc, ...numbers }: the engine looks effects up by id. `stats` inside a passive are
//             stats that count once however many copies are owned (passives are unique).
//   group     only one item of a group fits in the bag (boots / starter / flask)
//   stack     how many fit in one slot (potions); charges: uses before a refill at base (flask)
//   use       what drinking it does
const pc = v => Math.round(v * 1000) / 10;   // 0.06 -> 6
export const ITEMS = [
  // --- parts
  { id: 'blade', name: 'Blade', cat: 'attack', tier: 'part', cost: 350, stats: { ad: 10 } },
  { id: 'tome', name: 'Tome', cat: 'magic', tier: 'part', cost: 400, stats: { ap: 20 } },
  { id: 'dagger', name: 'Dagger', cat: 'attack', tier: 'part', cost: 250, stats: { as: 10 } },
  { id: 'gem', name: 'Gem', cat: 'defense', tier: 'part', cost: 400, stats: { hp: 150 } },
  { id: 'crystal', name: 'Crystal', cat: 'magic', tier: 'part', cost: 300, stats: { mana: 300 } },
  { id: 'plating', name: 'Plating', cat: 'defense', tier: 'part', cost: 300, stats: { armor: 15 } },
  { id: 'cloak', name: 'Cloak', cat: 'defense', tier: 'part', cost: 400, stats: { mr: 20 } },
  { id: 'boots', name: 'Boots', cat: 'boots', tier: 'part', cost: 300, stats: { ms: 25 }, group: 'boots' },
  { id: 'greatblade', name: 'Greatblade', cat: 'attack', tier: 'part', cost: 1300, stats: { ad: 40 } },
  { id: 'staff', name: 'Staff', cat: 'magic', tier: 'part', cost: 1200, stats: { ap: 65 } },
  { id: 'bead', name: 'Bead', cat: 'defense', tier: 'part', cost: 300, stats: { hpRegen: 1 } },
  { id: 'charm', name: 'Charm', cat: 'magic', tier: 'part', cost: 250, stats: { manaRegen: 0.5 } },
  { id: 'gear', name: 'Gear', cat: 'magic', tier: 'part', cost: 300, stats: { haste: 8 } },
  { id: 'cape', name: 'Cape', cat: 'attack', tier: 'part', cost: 600, stats: { crit: 15 } },
  // --- mid items
  { id: 'leechblade', name: 'Leech Blade', cat: 'attack', tier: 'mid', cost: 900, recipe: ['blade'], fee: 550, stats: { ad: 15, lifesteal: 7 } },
  { id: 'edge', name: 'Edge', cat: 'attack', tier: 'mid', cost: 1100, recipe: ['blade', 'gear'], fee: 450, stats: { ad: 20, haste: 10 } },
  { id: 'bow', name: 'Bow', cat: 'attack', tier: 'mid', cost: 1000, recipe: ['dagger', 'dagger'], fee: 500, stats: { as: 25 } },
  { id: 'spellbook', name: 'Spellbook', cat: 'magic', tier: 'mid', cost: 1200, recipe: ['tome', 'crystal'], fee: 500, stats: { ap: 40, mana: 300, haste: 10 } },
  { id: 'codex', name: 'Codex', cat: 'magic', tier: 'mid', cost: 900, recipe: ['tome', 'gear'], fee: 200, stats: { ap: 35, haste: 10 } },
  { id: 'belt', name: 'Belt', cat: 'defense', tier: 'mid', cost: 900, recipe: ['gem'], fee: 500, stats: { hp: 350 } },
  { id: 'heartgem', name: 'Heart Gem', cat: 'defense', tier: 'mid', cost: 800, recipe: ['gem', 'gear'], fee: 100, stats: { hp: 200, haste: 10 } },
  { id: 'chainmail', name: 'Chain Mail', cat: 'defense', tier: 'mid', cost: 800, recipe: ['plating'], fee: 500, stats: { armor: 40 } },
  { id: 'mantle', name: 'Mantle', cat: 'defense', tier: 'mid', cost: 900, recipe: ['cloak'], fee: 500, stats: { mr: 40 } },
  { id: 'piercer', name: 'Piercer', cat: 'attack', tier: 'mid', cost: 1100, recipe: ['blade'], fee: 750, stats: { ad: 20, armorPen: 15 } },
  { id: 'voidshard', name: 'Void Shard', cat: 'magic', tier: 'mid', cost: 1000, recipe: ['tome'], fee: 600, stats: { ap: 25, magicPenFlat: 10 } },
  { id: 'swiftcape', name: 'Swift Cape', cat: 'attack', tier: 'mid', cost: 1100, recipe: ['dagger', 'cape'], fee: 250, stats: { as: 15, crit: 15 } },
  // --- finished items: magic
  { id: 'crown', name: 'Crown', cat: 'magic', tier: 'finished', cost: 2900, recipe: ['spellbook', 'codex'], fee: 800, stats: { ap: 90, mana: 300, haste: 20 },
    passive: { id: 'overflow', name: 'Overflow', apPerMana: 0.02, get desc() { return `gain ability power equal to ${pc(this.apPerMana)}% of max mana.`; } } },
  { id: 'doomstaff', name: 'Doom Staff', cat: 'magic', tier: 'finished', cost: 3500, recipe: ['staff', 'staff'], fee: 1100, stats: { ap: 120 },
    passive: { id: 'magnify', name: 'Magnify', mult: 1.3, get desc() { return `your total ability power is increased by ${pc(this.mult - 1)}%.`; } } },
  { id: 'voidstaff', name: 'Void Staff', cat: 'magic', tier: 'finished', cost: 3000, recipe: ['voidshard', 'staff'], fee: 800, stats: { ap: 90 },
    passive: { id: 'hollow', name: 'Hollow', stats: { magicPenPct: 35 }, get desc() { return `your magic damage ignores ${this.stats.magicPenPct}% of the target's magic resist.`; } } },
  { id: 'emberorb', name: 'Ember Orb', cat: 'magic', tier: 'finished', cost: 2800, recipe: ['codex', 'belt'], fee: 1000, stats: { ap: 75, hp: 350, haste: 15 },
    passive: { id: 'burn', name: 'Burn', tick: 0.005, every: 0.5, lasts: 3,
      get desc() { return `your abilities set enemy heroes burning for ${pc(this.tick / this.every)}% of their max health as magic damage each second for ${this.lasts}s. Hitting them again restarts it; it does not stack.`; } } },
  // --- finished items: attack
  { id: 'critblade', name: 'Crit Blade', cat: 'attack', tier: 'finished', cost: 3350, recipe: ['greatblade', 'cape', 'blade'], fee: 1100, stats: { ad: 60, crit: 25 },
    passive: { id: 'keen', name: 'Keen', critDmg: 2.15, get desc() { return `your critical strikes deal ${pc(this.critDmg)}% damage instead of 175%.`; } } },
  { id: 'stormbow', name: 'Storm Bow', cat: 'attack', tier: 'finished', cost: 2800, recipe: ['swiftcape', 'bow'], fee: 700, stats: { as: 40, crit: 25, ms: 20 } },
  { id: 'ruinblade', name: 'Ruin Blade', cat: 'attack', tier: 'finished', cost: 3200, recipe: ['leechblade', 'bow'], fee: 1300, stats: { ad: 40, as: 25, lifesteal: 10 },
    passive: { id: 'rend', name: 'Rend', share: 0.06, minionCap: 60,
      get desc() { return `each basic attack deals extra physical damage equal to ${pc(this.share)}% of the target's current health (at most ${this.minionCap} against minions, none against towers).`; } } },
  { id: 'longbow', name: 'Long Bow', cat: 'attack', tier: 'finished', cost: 2600, recipe: ['piercer', 'cape'], fee: 900, stats: { ad: 35, crit: 25, armorPen: 30 } },
  { id: 'duskblade', name: 'Dusk Blade', cat: 'attack', tier: 'finished', cost: 3000, recipe: ['piercer', 'edge'], fee: 800, stats: { ad: 60, haste: 20, armorPen: 20 },
    passive: { id: 'ambush', name: 'Ambush', window: 4, base: 40, bonusAd: 0.3, lockout: 6,
      get desc() { return `casting an ability charges the blade for ${this.window}s: your next basic attack deals ${this.base} + ${pc(this.bonusAd)}% bonus AD extra physical damage. It cannot charge again for ${this.lockout}s after that.`; } } },
  { id: 'hexblade', name: 'Hexblade', cat: 'attack', tier: 'finished', cost: 2900, recipe: ['leechblade', 'codex'], fee: 1100, stats: { ad: 40, ap: 80, haste: 10, lifesteal: 10 },
    passive: { id: 'drain', name: 'Drain', share: 1 / 3, get desc() { return 'your ability damage also heals you, at one third of your lifesteal.'; } } },
  // --- finished items: defense
  { id: 'thornmail', name: 'Thorn Mail', cat: 'defense', tier: 'finished', cost: 2600, recipe: ['chainmail', 'belt'], fee: 900, stats: { armor: 70, hp: 350 },
    passive: { id: 'barbs', name: 'Barbs', base: 10, bonusArmor: 0.1, get desc() { return `an enemy hero who hits you with a basic attack takes ${this.base} + ${pc(this.bonusArmor)}% of your bonus armor as magic damage.`; } } },
  { id: 'spiritcloak', name: 'Spirit Cloak', cat: 'defense', tier: 'finished', cost: 2700, recipe: ['mantle', 'heartgem'], fee: 1000, stats: { mr: 60, hp: 400, haste: 10 },
    passive: { id: 'vigor', name: 'Vigor', stats: { healAmp: 25 }, get desc() { return `all healing and regeneration you receive is increased by ${this.stats.healAmp}%.`; } } },
  { id: 'titanheart', name: 'Titan Heart', cat: 'defense', tier: 'finished', cost: 3000, recipe: ['belt', 'belt', 'bead'], fee: 900, stats: { hp: 800, hpRegen: 2 },
    passive: { id: 'recover', name: 'Recover', after: 6, share: 0.004,
      get desc() { return `after ${this.after}s without damage from an enemy hero, regenerate an extra ${pc(this.share)}% of your max health each second.`; } } },
  { id: 'frostplate', name: 'Frost Plate', cat: 'defense', tier: 'finished', cost: 2500, recipe: ['chainmail', 'heartgem'], fee: 900, stats: { armor: 60, hp: 300, haste: 15 },
    passive: { id: 'chill', name: 'Chill', as: 20, lasts: 2, get desc() { return `an enemy hero who hits you with a basic attack loses ${this.as}% attack speed for ${this.lasts}s.`; } } },
  // --- boots (one pair at a time)
  { id: 'swiftboots', name: 'Swift Boots', cat: 'boots', tier: 'mid', cost: 1000, recipe: ['boots'], fee: 700, stats: { ms: 55 }, group: 'boots' },
  { id: 'battleboots', name: 'Battle Boots', cat: 'boots', tier: 'mid', cost: 1000, recipe: ['boots', 'dagger'], fee: 450, stats: { ms: 45, as: 25 }, group: 'boots' },
  { id: 'casterboots', name: 'Caster Boots', cat: 'boots', tier: 'mid', cost: 1100, recipe: ['boots'], fee: 800, stats: { ms: 45, magicPenFlat: 12 }, group: 'boots' },
  { id: 'ironboots', name: 'Iron Boots', cat: 'boots', tier: 'mid', cost: 1100, recipe: ['boots', 'plating'], fee: 500, stats: { ms: 45, armor: 25 }, group: 'boots',
    passive: { id: 'guard', name: 'Guard', less: 0.1, get desc() { return `basic attacks deal ${pc(this.less)}% less damage to you.`; } } },
  { id: 'spiritboots', name: 'Spirit Boots', cat: 'boots', tier: 'mid', cost: 1100, recipe: ['boots', 'cloak'], fee: 400, stats: { ms: 45, mr: 25, tenacity: 30 }, group: 'boots' },
  { id: 'hasteboots', name: 'Haste Boots', cat: 'boots', tier: 'mid', cost: 900, recipe: ['boots'], fee: 600, stats: { ms: 45, haste: 15 }, group: 'boots' },
  // --- starters (one at a time; they do not build into anything)
  { id: 'starterblade', name: 'Starter Blade', cat: 'starter', tier: 'starter', cost: 450, stats: { ad: 8, hp: 80, lifesteal: 3 }, group: 'starter' },
  { id: 'starterring', name: 'Starter Ring', cat: 'starter', tier: 'starter', cost: 400, stats: { ap: 18, hp: 90, manaRegen: 0.6 }, group: 'starter' },
  { id: 'startershield', name: 'Starter Shield', cat: 'starter', tier: 'starter', cost: 450, stats: { hp: 110, hpRegen: 0.8 }, group: 'starter',
    passive: { id: 'secondwind', name: 'Second Wind', regen: 3, lasts: 6, get desc() { return `after taking damage from an enemy hero, regenerate ${this.regen} extra health each second for ${this.lasts}s.`; } } },
  // --- consumables (carried, and drunk with the slot's number key)
  { id: 'potion', name: 'Potion', cat: 'consumable', tier: 'consumable', cost: 50, stack: 5, use: { heal: 120, over: 15 } },
  { id: 'flask', name: 'Refill Flask', cat: 'consumable', tier: 'consumable', cost: 150, group: 'flask', charges: 3, use: { heal: 100, over: 12 } },
];
