// Hero, item and spell definitions. All kits are original.
// Ability `cast(g, h, r, aim)`: g = Game, h = hero, r = rank index (0-based),
// aim = { x, y, dx, dy, power, target } (x,y already clamped to ability range).
// Optional ability hooks: pick (choose a target, or refuse the cast), tick (runs every step once learned),
// recast / onTick / onLeave (for abilities that put the hero into a state).
// Optional hero `passive` hooks: onAttack, onKill, onDamaged, plus wait / count for the HUD.

const R = (arr, r) => arr[Math.min(r, arr.length - 1)];
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

export const HEROES = {
  oriel: {
    name: 'Oriel', botBuild: ['boots', 'tome', 'staff', 'crystal', 'staff', 'staff'], role: 'Mage', color: '#c58bff',
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
};

// ---------------------------------------------------------------------------------------------
// Gorrum, the Salvage Hulk: a grab tank. Forced movement, an empowered attack, and one ability
// with a passive mode and an active mode.
HEROES.gorrum = {
  name: 'Gorrum', botBuild: ['boots', 'gem', 'plating', 'cloak', 'gem', 'tome'], role: 'Grab tank', color: '#c9973f',
  hp: 650, hpPer: 105, mana: 270, manaPer: 40, ad: 62, adPer: 3.5, as: 0.63, asPer: 1.5,
  armor: 40, armorPer: 4.5, mr: 32, mrPer: 2, ms: 325, range: 150, melee: true,
  windup: 0.25, hpRegen: 1.7, manaRegen: 1.7,
  // Threshold trigger with a cooldown: checked every time he takes damage.
  passive: { name: 'Ballast Plating', every: 75,
    desc: 'When damage drops Gorrum below 20% health he gains a shield of 100 + 12% of his max health for 8s. Can happen once every 75s.',
    wait: (g, h) => (h.ballastAt || 0) - g.time,
    onDamaged(g, h) {
      if (h.hp >= h.mhp * 0.2 || this.wait(g, h) > 0) return;
      g.shield(h, 100 + 0.12 * h.mhp, 8); h.ballastAt = g.time + this.every;
    } },
  abilities: [
    { key: 'Q', name: 'Harpoon Line', kind: 'line', range: 950, width: 110, castTime: 0.25,
      cd: [18, 17, 16, 15, 14], cost: [80],
      desc: 'Fire a harpoon. The first enemy it hits takes 90/140/190/240/290 + 60% AP and is dragged back to Gorrum.',
      cast(g, h, r, aim) {
        const dmg = R([90, 140, 190, 240, 290], r) + 0.6 * h.ap;
        g.line(h, aim, { speed: 1800, range: this.range, width: this.width, color: '#9fe8d2', style: 'harpoon', tether: true,
          onHit(t) { g.damage(h, t, dmg, 'magic'); g.pull(t, h, 1700); } });
      } },
    // Chained timed buffs: when the speed buff runs out, its onEnd applies the slow.
    { key: 'W', name: 'Boiler Vent', kind: 'self', cd: [15], cost: [60],
      desc: 'Gain 50/55/60/65/70% move speed and 30/38/46/54/62% attack speed for 4s. When it ends you are slowed by 30% for 1.5s.',
      cast(g, h, r) {
        g.addBuff(h, 'as', R([30, 38, 46, 54, 62], r), 4);
        g.addBuff(h, 'haste', R([0.5, 0.55, 0.6, 0.65, 0.7], r), 4, { onEnd: () => g.addBuff(h, 'slow', 0.3, 1.5) });
      } },
    { key: 'E', name: 'Anchor Fist', kind: 'self', cd: [9, 8, 7, 6, 5], cost: [30],
      desc: 'Resets your attack. Your next attack within 5s deals 20/35/50/65/80 + 80% AD bonus damage and knocks the enemy into the air for 1s.',
      cast(g, h, r) {
        const bonus = R([20, 35, 50, 65, 80], r) + 0.8 * h.ad;
        h.emp = { until: g.time + 5, hit(t) { g.knockUp(t, 1); return bonus; } };
        h.nextAttack = g.time;
      } },
    // Passive mode (tick) runs only while the ability is off cooldown, so casting it switches the zaps off.
    { key: 'R', name: 'Pressure Pulse', kind: 'self', radius: 550, castTime: 0.25, cd: [60, 45, 30], cost: [100],
      zapRange: 450, zapEvery: 2.5,
      desc: 'While this is ready, a random enemy within 450 is zapped every 2.5s for 40/70/100 + 20% AP. Activate to pulse: enemies within 550 take 200/325/450 + 80% AP and are silenced for 0.75s. The zaps stop until this is ready again.',
      tick(g, h, r) {
        if (h.cds[3] > g.time || g.time < (h.zapAt || 0) || h.dead) return;
        const near = g.enemiesIn(h.team, h.x, h.y, this.zapRange).filter(u => g.targetable(h, u));
        if (!near.length) return;
        const t = near[Math.random() * near.length | 0];
        g.fx({ e: 'zap', x: h.x | 0, y: h.y | 0, x2: t.x | 0, y2: t.y | 0 });
        g.damage(h, t, R([40, 70, 100], r) + 0.2 * h.ap, 'magic'); h.zapAt = g.time + this.zapEvery;
      },
      cast(g, h, r) {
        const dmg = R([200, 325, 450], r) + 0.8 * h.ap;
        g.burst(h, h.x, h.y, this.radius, '#9fe8d2', t => { g.damage(h, t, dmg, 'magic'); g.silence(t, 0.75); });
      } },
  ],
};

// ---------------------------------------------------------------------------------------------
// Wren Ashby, the Wayfinder: a skillshot marksman. Cooldown refunds, mark and detonate, stacking buffs.
// Every ability hit goes through `landed`, which adds a passive stack and pops her Waymark if it is there.
const landed = (g, h, t, pop = true) => { HEROES.wren.passive.gain(g, h); if (pop) g.popMark(h, t); };
HEROES.wren = {
  name: 'Wren Ashby', botBuild: ['boots', 'blade', 'dagger', 'greatblade', 'greatblade', 'dagger'], role: 'Marksman', color: '#f0c05a',
  hp: 560, hpPer: 92, mana: 380, manaPer: 40, ad: 58, adPer: 2.8, as: 0.65, asPer: 2.5,
  armor: 24, armorPer: 4, mr: 30, mrPer: 1.3, ms: 325, range: 550, melee: false,
  projSpeed: 2000, shot: 'light', windup: 0.2, hpRegen: 0.8, manaRegen: 1.9,
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
    // Cooldown refund: on a hit, every other ability's remaining cooldown shrinks.
    { key: 'Q', name: 'Compass Bolt', kind: 'line', range: 1100, width: 60, castTime: 0.2,
      cd: [5.5, 5.25, 5, 4.75, 4.5], cost: [28, 29, 30, 31, 32], refund: 1.5,
      desc: 'A fast bolt that hits the first enemy for 20/45/70/95/120 + 110% AD + 30% AP. If it hits, your other abilities come back 1.5s sooner.',
      cast(g, h, r, aim) {
        const dmg = R([20, 45, 70, 95, 120], r) + 1.1 * h.ad + 0.3 * h.ap, refund = this.refund;
        g.line(h, aim, { speed: 2200, range: this.range, width: this.width, color: '#fff2c0', style: 'light', onHit(t) {
          g.damage(h, t, dmg, 'phys'); landed(g, h, t);
          for (const s of [1, 2, 3]) h.cds[s] -= refund;
        } });
      } },
    // Mark and detonate: this only applies the tag; the burst lives in the tag and anything else she lands pops it.
    { key: 'W', name: 'Waymark', kind: 'line', range: 1000, width: 80, castTime: 0.2,
      cd: [12, 11, 10, 9, 8], cost: [50],
      desc: 'An orb that marks the first enemy it hits for 4s. Hitting the marked enemy with an attack or another ability bursts the mark for 80/135/190/245/300 + 60% AD + 70% AP and restores 60 mana.',
      cast(g, h, r, aim) {
        const dmg = R([80, 135, 190, 245, 300], r) + 0.6 * h.ad + 0.7 * h.ap;
        g.line(h, aim, { speed: 1500, range: this.range, width: this.width, color: '#ffe9a0', onHit(t) {
          landed(g, h, t, false);
          t.mark = { by: h.id, until: g.time + 4, pop(u) { g.fx({ e: 'burst', x: u.x, y: u.y, r: 110, c: '#ffe9a0' }); g.damage(h, u, dmg, 'magic'); g.restoreMana(h, 60); } };
        } });
      } },
    // Teleport, then auto-target: search for the nearest enemy from the new position.
    { key: 'E', name: 'Fold Step', kind: 'dash', range: 450, cd: [22, 20, 18, 16, 14], cost: [70], seek: 700,
      desc: 'Blink a short distance, then fire a bolt at the nearest enemy within 700 for 80/130/180/230/280 + 50% AD + 75% AP.',
      cast(g, h, r, aim) {
        g.blink(h, aim.x, aim.y);
        const t = g.nearestEnemy(h, this.seek), dmg = R([80, 130, 180, 230, 280], r) + 0.5 * h.ad + 0.75 * h.ap;
        if (t && t.type === 'hero') g.callForHelp(h, t);               // an auto-targeted bolt counts as a targeted ability
        if (t) g.homing(h, h.x, h.y, t, 2000, '#fff2c0', () => { g.damage(h, t, dmg, 'magic'); landed(g, h, t); }, 'light');
      } },
    // Map-length piercing projectile; damage depends on what it hits.
    { key: 'R', name: 'Meridian', kind: 'line', width: 300, reach: 20000, castTime: 1, cd: [110, 95, 80], cost: [100],
      desc: 'After 1s, send a wave of light across the whole map. It passes through everything, dealing 300/450/600 + 100% AD + 90% AP to heroes and half that to minions.',
      cast(g, h, r, aim) {
        const dmg = R([300, 450, 600], r) + h.ad + 0.9 * h.ap;
        g.line(h, aim, { speed: 2000, range: this.reach, width: this.width, color: '#fff2c0', style: 'wave', pierce: true, onHit(t) {
          g.damage(h, t, t.type === 'hero' ? dmg : dmg * 0.5, 'magic'); landed(g, h, t);
        } });
      } },
  ],
};

// ---------------------------------------------------------------------------------------------
// Sable Venn, the Glass Dancer: a reset assassin. Objects in the world, chain targeting, a channel.
// Her blades are pickups: every way of dropping one goes through dropBlade, and touching one slashes.
const BLADE = { r: 150, life: 5, slash: 340 };
const slash = (g, h) => {
  const dmg = 45 + 10 * h.lvl + 0.35 * h.ad + 0.45 * h.ap;
  g.burst(h, h.x, h.y, BLADE.slash, '#dfe9ff', t => g.damage(h, t, dmg, 'magic'));
};
const dropBlade = (g, h, x, y, delay) => g.drop(h, x, y, delay, { kind: 'blade', r: BLADE.r, life: BLADE.life, onTake: () => slash(g, h) });
HEROES.sable = {
  name: 'Sable Venn', botBuild: ['boots', 'blade', 'tome', 'greatblade', 'staff', 'gem'], role: 'Assassin', color: '#b9c8ec',
  hp: 620, hpPer: 98, mana: 300, manaPer: 30, ad: 60, adPer: 3.2, as: 0.68, asPer: 2.8,
  armor: 30, armorPer: 4, mr: 32, mrPer: 1.5, ms: 340, range: 130, melee: true,
  windup: 0.2, hpRegen: 1.3, manaRegen: 1.8,
  // Kill-event hook. (The slash on picking up a blade lives with the blades, above.)
  passive: { name: 'Encore', refund: 15,
    desc: 'A kill or assist on an enemy hero takes 15s off all your cooldowns. Walking over one of your dropped blades picks it up and slashes enemies within 340 for 45 + 10 per level + 35% AD + 45% AP.',
    onKill(g, h, t) { if (t.type === 'hero') for (let s = 0; s < 4; s++) h.cds[s] -= this.refund; } },
  abilities: [
    { key: 'Q', name: 'Ricochet Crescent', kind: 'pick', range: 650, cd: [10, 9.5, 9, 8.5, 8], cost: [40],
      desc: 'Throw a blade at the enemy nearest the cursor. It bounces to up to 2 more nearby enemies for 75/105/135/165/195 + 20% AD + 30% AP each, then lands on the ground behind the first target.',
      pick(g, h, aim) {
        return [...g.units.values()].filter(u => u.type !== 'tower' && g.targetable(h, u) && g.dist(h, u) <= this.range + u.radius && Math.hypot(u.x - aim.x, u.y - aim.y) <= 260)
          .sort((a, b) => Math.hypot(a.x - aim.x, a.y - aim.y) - Math.hypot(b.x - aim.x, b.y - aim.y))[0];
      },
      cast(g, h, r, aim) {
        const first = aim.target, dmg = R([75, 105, 135, 165, 195], r) + 0.2 * h.ad + 0.3 * h.ap;
        const targets = g.chain(h, first, 3, 500);
        const fly = (from, i) => g.homing(h, from.x, from.y, targets[i], 1500, '#dfe9ff', () => {
          g.damage(h, targets[i], dmg, 'magic'); if (i + 1 < targets.length) fly(targets[i], i + 1);
        }, 'blade');
        fly(h, 0);
        const dx = first.x - h.x, dy = first.y - h.y, d = Math.hypot(dx, dy) || 1;
        dropBlade(g, h, first.x + dx / d * 300, first.y + dy / d * 300, 0.9);
      } },
    // Delayed spawn: the blade exists from now but only becomes live when its timer runs out.
    { key: 'W', name: 'Toss & Twirl', kind: 'self', cd: [14, 13, 12, 11, 10], cost: [30],
      desc: 'Toss a blade straight up and gain 50/55/60/65/70% move speed for 1.25s. The blade lands where you were standing.',
      cast(g, h, r) { g.addBuff(h, 'haste', R([0.5, 0.55, 0.6, 0.65, 0.7], r), 1.25); dropBlade(g, h, h.x, h.y, 1.25); } },
    // Target validation: allowed targets are her own landed blades and any other unit; the result differs by type.
    { key: 'E', name: 'Moonstep', kind: 'dash', range: 700, cd: [12, 11, 10, 9, 8], cost: [35],
      desc: 'Blink to a unit or one of your dropped blades near the cursor. Arriving at an enemy deals 25/40/55/70/85 + 40% AD + 25% AP. Arriving at a blade picks it up and slashes at once.',
      pick(g, h, aim) {
        const near = o => Math.hypot(o.x - aim.x, o.y - aim.y), ok = o => near(o) <= 260 && g.dist(h, o) <= this.range + 150;
        const blade = g.pickups.filter(b => b.owner === h && b.kind === 'blade' && g.time >= b.at && ok(b)).sort((a, b) => near(a) - near(b))[0];
        if (blade) return blade;
        return [...g.units.values()].filter(u => u !== h && !u.dead && (u.team === h.team || g.targetable(h, u)) && ok(u)).sort((a, b) => near(a) - near(b))[0];
      },
      cast(g, h, r, aim) {
        const t = aim.target;
        if (t.kind === 'blade') { g.blink(h, t.x, t.y); g.take(h, t); return; }
        const dx = h.x - t.x, dy = h.y - t.y, d = Math.hypot(dx, dy) || 1, gap = t.radius + h.radius * 0.6;
        g.blink(h, t.x + dx / d * gap, t.y + dy / d * gap);
        if (t.team !== h.team) { g.damage(h, t, R([25, 40, 55, 70, 85], r) + 0.4 * h.ad + 0.25 * h.ap, 'magic'); h.order = { type: 'atk', id: t.id }; }
      } },
    // Channel: a locked state that ticks on a timer. A stun or knock-up ends the state, and so the channel.
    { key: 'R', name: 'Glass Storm', kind: 'self', radius: 550, cd: [90, 75, 60], cost: [80],
      desc: 'Channel for 2.5s, unable to move or attack, throwing a blade at each of the 3 nearest enemies within 550 every 0.2s for 22/32/42 + 12% AD + 15% AP. Being stunned or knocked up cancels it; press S to end early.',
      cast(g, h) { g.enter(h, 3, 'channel', 2.5, { lock: true, stopEnds: true, every: 0.2 }); },
      onTick(g, h) {
        const r = h.ranks[3] - 1, dmg = R([22, 32, 42], r) + 0.12 * h.ad + 0.15 * h.ap;
        const near = g.enemiesIn(h.team, h.x, h.y, this.radius).filter(u => g.targetable(h, u))
          .sort((a, b) => (b.type === 'hero') - (a.type === 'hero') || g.dist(a, h) - g.dist(b, h)).slice(0, 3);
        for (const t of near) g.homing(h, h.x, h.y, t, 1700, '#dfe9ff', () => g.damage(h, t, dmg, 'magic'), 'blade');
      } },
  ],
};

// Kessa is built from two shared pieces in sim.js: g.strike (telegraph -> delay -> resolve) and the ability
// state machine (g.enter / g.leave). Each ability below is one of those, or both, with different numbers.
HEROES.kessa = {
  name: 'Kessa', botBuild: ['boots', 'tome', 'crystal', 'staff', 'staff', 'staff'], role: 'Artillery', color: '#6fb6e8',
  hp: 540, hpPer: 88, mana: 440, manaPer: 32, ad: 52, adPer: 3, as: 0.62, asPer: 1.4,
  armor: 20, armorPer: 4, mr: 30, mrPer: 1.3, ms: 325, range: 525, melee: false,
  projSpeed: 1500, shot: 'orb', windup: 0.24, hpRegen: 0.7, manaRegen: 3,
  // Event hooks: sim.js calls onAttack when her basic attack lands and onKill when she kills anything.
  passive: { name: 'Recycler', every: 12, perKill: 2,
    desc: 'Every 12s your next attack restores 40 + 5 per level mana, doubled against heroes. Each enemy you kill shortens the wait by 2s.',
    wait: (g, h) => (h.surgeAt || 0) - g.time,
    onAttack(g, h, t) {
      if (this.wait(g, h) > 0) return;
      const n = (40 + 5 * h.lvl) * (t.type === 'hero' ? 2 : 1);
      g.restoreMana(h, n); h.surgeAt = g.time + this.every; g.fx({ e: 'mana', x: Math.round(h.x), y: Math.round(h.y), n, p: h.pid });
    },
    onKill(g, h) { if (this.wait(g, h) > 0) h.surgeAt -= this.perKill; } },
  abilities: [
    // IDLE -> CHARGING (hold) -> FIRING (release). The charge itself lives in sim.js (startCharge / cast).
    { key: 'Q', name: 'Rail Lance', kind: 'line', range: 1150,
      charge: { full: 1.5, hold: 3, min: 600, max: 1150, width: 130, slow: 0.5, delay: 0.4 },
      cd: [9, 8, 7, 6, 5], cost: [45, 50, 55, 60, 65],
      desc: 'Hold to charge: range grows from 600 to 1150 over 1.5s while you move 50% slower. Release to fire a beam that, after 0.4s, hits every enemy in a line for 70/110/150/190/230 + 75% AP. Holding for more than 3s cancels it.',
      cast(g, h, r, aim) {
        const c = this.charge, len = lerp(c.min, c.max, aim.power), dmg = R([70, 110, 150, 190, 230], r) + 0.75 * h.ap;
        g.strike(h, { shape: 'line', x: h.x, y: h.y, dx: aim.dx, dy: aim.dy, len, w: c.width, delay: c.delay, color: '#8fd0ff',
          onHit(t) { g.damage(h, t, dmg, 'magic'); } });
        g.enter(h, 0, 'firing', c.delay, { lock: true });
      } },
    { key: 'W', name: 'Ground Zero', kind: 'point', range: 1000, radius: 260, inner: 120, castTime: 0.2,
      cd: [14, 13, 12, 11, 10], cost: [60, 65, 70, 75, 80],
      desc: 'Mark an area that blows up after 0.7s for 60/95/130/165/200 + 60% AP and a 25% slow for 2.5s. Enemies in the centre take 50% more damage and are slowed by 60% instead.',
      cast(g, h, r, aim) {
        const dmg = R([60, 95, 130, 165, 200], r) + 0.6 * h.ap;
        g.strike(h, { x: aim.x, y: aim.y, r: this.radius, inner: this.inner, delay: 0.7, color: '#ffe9a0', onHit(t, centre) {
          if (centre) { g.damage(h, t, dmg * 1.5, 'magic'); g.addBuff(t, 'slow', 0.6, 2.5); }
          else { g.damage(h, t, dmg, 'magic'); g.addBuff(t, 'slow', 0.25, 2.5); }
        } });
      } },
    { key: 'E', name: 'Concussion Shell', kind: 'line', range: 1050, width: 70, castTime: 0.25,
      cd: [13, 12.5, 12, 11.5, 11], cost: [50, 55, 60, 65, 70],
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
