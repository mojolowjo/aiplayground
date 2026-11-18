// Hero, item and spell definitions. All kits are original.
// Ability `cast(g, h, r, aim)`: g = Game, h = hero, r = rank index (0-based),
// aim = { x, y, dx, dy, target } (x,y already clamped to ability range).

const R = (arr, r) => arr[Math.min(r, arr.length - 1)];
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

export const HEROES = {
  vesk: {
    name: 'Vesk', role: 'Marksman', color: '#e8c14a',
    hp: 600, hpPer: 95, mana: 300, manaPer: 35, ad: 58, adPer: 3, as: 0.66, asPer: 3,
    armor: 26, armorPer: 4, mr: 30, mrPer: 1.3, ms: 325, range: 575, melee: false,
    projSpeed: 2200, shot: 'arrow', windup: 0.2, hpRegen: 0.8, manaRegen: 1.6,
    abilities: [
      { key: 'Q', name: 'Rapid Fire', kind: 'self', cd: [16, 15, 14, 13, 12], cost: [50],
        desc: 'Gain 30/40/50/60/70% attack speed for 4s.',
        cast(g, h, r) { g.addBuff(h, 'as', R([30, 40, 50, 60, 70], r), 4); } },
      { key: 'W', name: 'Ricochet Bolt', kind: 'line', range: 1000, width: 60, castTime: 0.2,
        cd: [9, 8.5, 8, 7.5, 7], cost: [60],
        desc: 'Fire a bolt that hits the first enemy (60/95/130/165/200 + 50% AD) and bounces to another nearby enemy for 60%.',
        cast(g, h, r, aim) {
          const dmg = R([60, 95, 130, 165, 200], r) + 0.5 * h.ad;
          g.line(h, aim, { speed: 1800, range: 1000, width: 60, color: '#ffe27a', style: 'arrow', onHit(t) {
            g.damage(h, t, dmg, 'phys');
            const n = g.enemiesIn(h.team, t.x, t.y, 450).filter(u => u !== t && !u.dead)
              .sort((a, b) => g.dist(a, t) - g.dist(b, t))[0];
            if (n) g.homing(h, t.x, t.y, n, 1600, '#ffe27a', () => g.damage(h, n, dmg * 0.6, 'phys'), 'arrow');
          } });
        } },
      { key: 'E', name: 'Backstep', kind: 'dash', range: 350, cd: [18, 16, 14, 12, 10], cost: [40],
        desc: 'Dash a short distance. Your next attack within 4s slows by 40% for 1.5s.',
        cast(g, h, r, aim) { g.dash(h, { x: aim.x, y: aim.y, speed: 1500 }); h.chill = g.time + 4; } },
      { key: 'R', name: 'Skyfall', kind: 'point', range: 1200, radius: 300, castTime: 0.25,
        cd: [100, 85, 70], cost: [100],
        desc: 'Arrows rain on an area for 3s, dealing 40/65/90 + 25% AD every 0.5s and slowing by 30%.',
        cast(g, h, r, aim) {
          const dmg = R([40, 65, 90], r) + 0.25 * h.ad;
          g.strike(h, { x: aim.x, y: aim.y, r: 300, delay: 0.8, ticks: 6, interval: 0.5, color: '#ffe27a',
            onHit(t) { g.damage(h, t, dmg, 'phys'); g.addBuff(t, 'slow', 0.3, 1); } });
        } },
    ],
  },
  oriel: {
    name: 'Oriel', role: 'Mage', color: '#c58bff',
    hp: 560, hpPer: 90, mana: 420, manaPer: 30, ad: 52, adPer: 3, as: 0.63, asPer: 1.5,
    armor: 21, armorPer: 4, mr: 30, mrPer: 1.3, ms: 330, range: 550, melee: false,
    projSpeed: 1600, windup: 0.22, hpRegen: 0.7, manaRegen: 2.2,
    abilities: [
      { key: 'Q', name: 'Cinder Lance', kind: 'line', range: 1050, width: 70, castTime: 0.25,
        cd: [7, 6.5, 6, 5.5, 5], cost: [55, 60, 65, 70, 75],
        desc: 'Skillshot that hits the first enemy for 80/125/170/215/260 + 70% AP.',
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
  brakk: {
    name: 'Brakk', role: 'Bruiser', color: '#d9824a',
    hp: 660, hpPer: 105, mana: 280, manaPer: 40, ad: 64, adPer: 3.5, as: 0.65, asPer: 2.5,
    armor: 36, armorPer: 4.5, mr: 32, mrPer: 2, ms: 340, range: 150, melee: true,
    windup: 0.25, hpRegen: 1.6, manaRegen: 1.5,
    abilities: [
      { key: 'Q', name: 'Hammer Blow', kind: 'self', cd: [8, 7.5, 7, 6.5, 6], cost: [30],
        desc: 'Resets your attack. Your next attack within 5s deals 30/50/70/90/110 + 40% AD bonus damage and slows by 35% for 1.5s.',
        cast(g, h, r) {
          h.emp = { until: g.time + 5, bonus: R([30, 50, 70, 90, 110], r) + 0.4 * h.ad };
          h.nextAttack = g.time;
        } },
      { key: 'W', name: 'Iron Hide', kind: 'self', cd: [16, 15, 14, 13, 12], cost: [50],
        desc: 'Gain a shield of 70/110/150/190/230 + 8% max health for 3s.',
        cast(g, h, r) { g.shield(h, R([70, 110, 150, 190, 230], r) + 0.08 * h.mhp, 3); } },
      { key: 'E', name: 'Charge', kind: 'dash', range: 500, cd: [14, 13, 12, 11, 10], cost: [50],
        desc: 'Charge forward. The first enemy hero hit takes 60/90/120/150/180 + 50% AD and is stunned for 0.75s.',
        cast(g, h, r, aim) {
          const dmg = R([60, 90, 120, 150, 180], r) + 0.5 * h.ad;
          g.dash(h, { x: aim.x, y: aim.y, speed: 1400, full: true,
            onHero(t) { g.damage(h, t, dmg, 'phys'); g.stun(t, 0.75); } });
        } },
      { key: 'R', name: 'Quake', kind: 'self', radius: 400, castTime: 0.4, cd: [100, 90, 80], cost: [100],
        desc: 'Slam the ground: enemies within 400 take 150/250/350 + 80% AD and are slowed by 50% for 2.5s.',
        cast(g, h, r) {
          const dmg = R([150, 250, 350], r) + 0.8 * h.ad;
          g.burst(h, h.x, h.y, 400, '#d9824a', t => { g.damage(h, t, dmg, 'phys'); g.addBuff(t, 'slow', 0.5, 2.5); });
        } },
    ],
  },
  sliv: {
    name: 'Sliv', role: 'Assassin', color: '#58d6b0',
    hp: 620, hpPer: 98, mana: 300, manaPer: 30, ad: 62, adPer: 3.2, as: 0.68, asPer: 2.8,
    armor: 30, armorPer: 4, mr: 32, mrPer: 1.5, ms: 345, range: 130, melee: true,
    windup: 0.2, hpRegen: 1.3, manaRegen: 1.6,
    abilities: [
      { key: 'Q', name: 'Thrown Blade', kind: 'line', range: 850, width: 60, castTime: 0.2,
        cd: [8, 7.5, 7, 6.5, 6], cost: [45],
        desc: 'Skillshot dealing 65/100/135/170/205 + 60% AD and marking the target for 4s. Your next attack on a marked target deals 30/45/60/75/90 bonus damage.',
        cast(g, h, r, aim) {
          const dmg = R([65, 100, 135, 170, 205], r) + 0.6 * h.ad;
          g.line(h, aim, { speed: 2000, range: 850, width: 60, color: '#8affd9', style: 'blade', onHit(t) {
            g.damage(h, t, dmg, 'phys'); t.mark = { by: h.id, until: g.time + 4, dmg: 30 + 15 * r };
          } });
        } },
      { key: 'W', name: 'Shadowstep', kind: 'dash', range: 450, cd: [20, 18, 16, 14, 12], cost: [50],
        desc: 'Instantly blink to a nearby location.',
        cast(g, h, r, aim) { g.blink(h, aim.x, aim.y); } },
      { key: 'E', name: 'Flurry', kind: 'self', radius: 300, cd: [9, 8, 7, 6, 5], cost: [40],
        desc: 'Slash all enemies within 300 for 60/90/120/150/180 + 50% AD.',
        cast(g, h, r) {
          const dmg = R([60, 90, 120, 150, 180], r) + 0.5 * h.ad;
          g.burst(h, h.x, h.y, 300, '#58d6b0', t => g.damage(h, t, dmg, 'phys'));
        } },
      { key: 'R', name: 'Final Cut', kind: 'unit', range: 600, cd: [90, 75, 60], cost: [80],
        desc: 'Dash to an enemy hero and strike for 120/200/280 + 80% AD, increased by up to 60% against low-health targets.',
        cast(g, h, r, aim) {
          const base = R([120, 200, 280], r) + 0.8 * h.ad, t = aim.target;
          g.dash(h, { follow: t, speed: 2200, onEnd() {
            if (!t.dead) g.damage(h, t, base * (1 + 0.6 * (1 - t.hp / t.mhp)), 'phys');
          } });
        } },
    ],
  },
};

// Kessa is built from two shared pieces in sim.js: g.strike (telegraph -> delay -> resolve) and the ability
// state machine (g.enter / g.leave). Each ability below is one of those, or both, with different numbers.
HEROES.kessa = {
  name: 'Kessa', role: 'Artillery', color: '#6fb6e8',
  hp: 540, hpPer: 88, mana: 440, manaPer: 32, ad: 52, adPer: 3, as: 0.62, asPer: 1.4,
  armor: 20, armorPer: 4, mr: 30, mrPer: 1.3, ms: 325, range: 525, melee: false,
  projSpeed: 1500, shot: 'orb', windup: 0.24, hpRegen: 0.7, manaRegen: 2.3,
  // Event hooks: sim.js calls onAttack when her basic attack lands and onKill when she kills anything.
  passive: { name: 'Recycler', every: 12, perKill: 2,
    desc: 'Every 12s your next attack restores 30 + 4 per level mana, doubled against heroes. Each enemy you kill shortens the wait by 2s.',
    wait: (g, h) => (h.surgeAt || 0) - g.time,
    onAttack(g, h, t) {
      if (this.wait(g, h) > 0) return;
      const n = (30 + 4 * h.lvl) * (t.type === 'hero' ? 2 : 1);
      g.restoreMana(h, n); h.surgeAt = g.time + this.every; g.fx({ e: 'mana', x: Math.round(h.x), y: Math.round(h.y), n, p: h.pid });
    },
    onKill(g, h) { if (this.wait(g, h) > 0) h.surgeAt -= this.perKill; } },
  abilities: [
    // IDLE -> CHARGING (hold) -> FIRING (release). The charge itself lives in sim.js (startCharge / cast).
    { key: 'Q', name: 'Rail Lance', kind: 'line', range: 1400,
      charge: { full: 1.5, hold: 3, min: 700, max: 1400, width: 130, slow: 0.5 },
      cd: [9, 8, 7, 6, 5], cost: [60, 65, 70, 75, 80],
      desc: 'Hold to charge: range grows from 700 to 1400 over 1.5s while you move 50% slower. Release to fire a beam that hits every enemy in a line for 70/110/150/190/230 + 75% AP. Holding for more than 3s cancels it.',
      cast(g, h, r, aim) {
        const c = this.charge, len = lerp(c.min, c.max, aim.power), dmg = R([70, 110, 150, 190, 230], r) + 0.75 * h.ap;
        g.strike(h, { shape: 'line', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, len, w: c.width, delay: 0.3, color: '#8fd0ff',
          onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        g.enter(h, 0, 'firing', 0.3, { lock: true });
      } },
    { key: 'W', name: 'Ground Zero', kind: 'point', range: 1000, radius: 260, inner: 120, castTime: 0.2,
      cd: [14, 13, 12, 11, 10], cost: [70, 80, 90, 100, 110],
      desc: 'Mark an area that blows up after 0.7s for 60/95/130/165/200 + 60% AP and a 25% slow for 2.5s. Enemies in the centre take 50% more damage and are slowed by 60% instead.',
      cast(g, h, r, aim) {
        const dmg = R([60, 95, 130, 165, 200], r) + 0.6 * h.ap;
        g.strike(h, { x: aim.x, y: aim.y, r: this.radius, inner: this.inner, delay: 0.7, color: '#ffe9a0', onHit(t, centre) {
          if (centre) { g.damage(h, t, dmg * 1.5, 'magic'); g.addBuff(t, 'slow', 0.6, 2.5); }
          else { g.damage(h, t, dmg, 'magic'); g.addBuff(t, 'slow', 0.25, 2.5); }
        } });
      } },
    { key: 'E', name: 'Concussion Shell', kind: 'line', range: 1050, width: 70, castTime: 0.25,
      cd: [13, 12.5, 12, 11.5, 11], cost: [60, 65, 70, 75, 80],
      desc: 'Fire a shell that hits the first enemy for 80/110/140/170/200 + 45% AP and stuns it for 0.5s to 2s, longer the farther the shell flew.',
      cast(g, h, r, aim) {
        const dmg = R([80, 110, 140, 170, 200], r) + 0.45 * h.ap, range = this.range;
        g.line(h, aim, { speed: 1400, range, width: this.width, color: '#dff2ff', onHit(t, shot) {
          g.damage(h, t, dmg, 'magic'); g.stun(t, lerp(0.5, 2, shot.dist / range));
        } });
      } },
    // IDLE -> BARRAGE. Each recast while in the state is one more W-style strike; the state ends when the
    // shots or the time run out, when she is stunned, or on Stop.
    { key: 'R', name: 'Fire Mission', kind: 'self', range: [1800, 2100, 2400], radius: 200, cd: [120, 105, 90], cost: [100],
      desc: 'Root yourself for up to 10s and gain 3/4/5 long-range shots (range 1800/2100/2400). Press R again to drop each one at the cursor: after 0.6s it hits an area for 150/200/250 + 40% AP. Press S to end early.',
      cast(g, h, r) {
        g.enter(h, 3, 'barrage', 10, { lock: true, stopEnds: true, shots: 3 + r, next: g.time + 0.4, range: R(this.range, r) });
      },
      recast(g, h, r, aim, st) {
        if (g.time < st.next) return;
        const d = Math.min(st.range, Math.hypot(aim.x - h.x, aim.y - h.y)), dmg = R([150, 200, 250], r) + 0.4 * h.ap;
        g.strike(h, { x: h.x + aim.dx * d, y: h.y + aim.dy * d, r: this.radius, delay: 0.6, color: '#8fd0ff',
          onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        h.face = Math.atan2(aim.dy, aim.dx); h.revealUntil = g.time + 1.5; g.fx({ e: 'cast', id: h.id, s: 3, d: 0 });
        st.next = g.time + 0.6;
        if (--st.shots <= 0) g.leave(h, 'done');
      } },
  ],
};

export const SPELLS = {
  d: { key: 'D', name: 'Blink', kind: 'dash', range: 400, cd: 240, desc: 'Instantly teleport a short distance.',
    cast(g, h, aim) { g.blink(h, aim.x, aim.y); } },
  f: { key: 'F', name: 'Mend', kind: 'self', cd: 180, desc: 'Restore 90 + 15 per level health and gain 30% move speed for 1s.',
    cast(g, h) { g.heal(h, 90 + 15 * h.lvl); g.addBuff(h, 'haste', 0.3, 1); } },
};

export const ITEMS = [
  { id: 'blade', name: 'Blade', cost: 350, desc: '+10 attack damage', stats: { ad: 10 } },
  { id: 'greatblade', name: 'Greatblade', cost: 1300, desc: '+40 attack damage', stats: { ad: 40 } },
  { id: 'tome', name: 'Tome', cost: 435, desc: '+20 ability power', stats: { ap: 20 } },
  { id: 'staff', name: 'Staff', cost: 1250, desc: '+60 ability power', stats: { ap: 60 } },
  { id: 'dagger', name: 'Dagger', cost: 300, desc: '+12% attack speed', stats: { as: 12 } },
  { id: 'gem', name: 'Gem', cost: 400, desc: '+150 health', stats: { hp: 150 } },
  { id: 'crystal', name: 'Crystal', cost: 350, desc: '+250 mana', stats: { mana: 250 } },
  { id: 'plating', name: 'Plating', cost: 300, desc: '+15 armor', stats: { armor: 15 } },
  { id: 'cloak', name: 'Cloak', cost: 450, desc: '+25 magic resist', stats: { mr: 25 } },
  { id: 'boots', name: 'Boots', cost: 300, desc: '+25 move speed (one pair only)', stats: { ms: 25 }, unique: true },
  { id: 'potion', name: 'Potion', cost: 50, desc: 'Restores 150 health over 10s (used on purchase)', potion: true },
];
