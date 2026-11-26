// The 27 cards, the towers and the arena, in human units (tiles, seconds).
// The battle doc (Battle game design doc v0.1) is the source for every number here; values it marks
// as a guess are guesses here too. sim.js converts them to integer game units when it loads.
// Shared by the browser and the server, so no imports and no browser or Node APIs.

export const ARENA = {
  w: 18, h: 32,                       // tiles
  riverTop: 15, riverBottom: 17,      // rows 16 and 17 (1-indexed) are water
  bridgeHalf: 1.5,                    // each bridge is 3 tiles wide
  lanesX: [3.5, 14.5],                // centre of the left and right lane (and of each bridge)
  zonePush: 4,                        // rows past the river you may deploy once that lane's enemy Watchtower falls
};

export const TOWERS = {
  watch: { name: 'Watchtower', hp: 2500, dmg: 90, hit: 0.8, range: 7.5, r: 1.5 },
  keep:  { name: 'Keep',       hp: 4000, dmg: 110, hit: 1.0, range: 7, r: 2 },
};

// Speed tiers, tiles per second.
export const SPEED = { slow: 0.75, medium: 1.0, fast: 1.5, veryfast: 2.0 };

// Body sizes: hit radius in tiles and push weight. Size matches the role (swarms tiny, tanks big).
export const BODY = {
  tiny:  { r: 0.3,  mass: 1 },
  small: { r: 0.4,  mass: 3 },
  mid:   { r: 0.5,  mass: 6 },
  big:   { r: 0.7,  mass: 12 },
  huge:  { r: 0.9,  mass: 24 },
};

export const MELEE = 0.8;             // melee reach, edge to edge (the doc says "melee = 1"; 0.8 edge to edge feels about that)
export const SIGHT = 5.5;             // how far most troops look for targets
export const DEPLOY = 0.5;            // seconds before a troop or building acts (decided by m0j)
export const SPELL_TOWER_PCT = 35;    // damaging spells deal 35% to towers

// targets: 'both' (air and ground), 'ground', 'buildings' (buildings and towers only)
// count/offsets: how many units the card drops and where, in tiles from the drop point
// Each card's `color` and `role` drive its sprite and the bot's counter table.
export const CARDS = {
  // ---------- troops ----------
  imps: { name: 'Pebble Imps', type: 'troop', rarity: 'common', cost: 2, hp: 110, dmg: 55, hit: 1.0, range: MELEE, speed: 'fast',
    targets: 'ground', body: 'tiny', count: 4, offsets: [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]],
    tags: ['swarm', 'ground'], text: '4 imps' },
  fox: { name: 'Fox Scout', type: 'troop', rarity: 'common', cost: 2, hp: 500, dmg: 110, hit: 0.9, range: MELEE, speed: 'veryfast',
    targets: 'ground', body: 'small', charge: 3, tags: ['cycle', 'ground'], text: 'First hit after moving 3 tiles deals double' },
  hedge: { name: 'Hedge Guard', type: 'troop', rarity: 'common', cost: 3, hp: 1000, shield: 250, dmg: 100, hit: 1.2, range: MELEE, speed: 'medium',
    targets: 'ground', body: 'mid', lockOn: true, tags: ['minitank', 'wincon', 'ground'],
    text: 'Shield soaks damage first. Once it hits a building or tower, it ignores troops' },
  smasher: { name: 'Crag Smasher', type: 'troop', rarity: 'common', cost: 3, hp: 650, dmg: 340, hit: 1.8, range: MELEE, speed: 'medium',
    targets: 'ground', body: 'mid', tags: ['tankkiller', 'ground'], text: 'One huge, slow blow' },
  slingers: { name: 'Slingers', type: 'troop', rarity: 'common', cost: 3, hp: 200, dmg: 70, hit: 1.1, range: 5, speed: 'medium',
    targets: 'both', body: 'small', count: 2, offsets: [[-0.5, 0], [0.5, 0]], tags: ['ranged', 'antiair', 'ground'], text: '2 slingers' },
  moths: { name: 'Moth Swarm', type: 'troop', rarity: 'common', cost: 3, hp: 70, dmg: 40, hit: 1.0, range: 1.5, speed: 'fast',
    targets: 'both', body: 'tiny', air: true, count: 5, offsets: [[0, -0.6], [0.57, -0.19], [0.35, 0.49], [-0.35, 0.49], [-0.57, -0.19]],
    tags: ['swarm', 'air', 'antiair'], text: '5 flying moths' },
  brute: { name: 'Bog Brute', type: 'troop', rarity: 'rare', cost: 4, hp: 1400, dmg: 160, hit: 1.4, range: MELEE, speed: 'medium',
    targets: 'ground', body: 'big', puddle: { r: 1.25, slow: 35, time: 4 }, tags: ['bruiser', 'ground'], text: 'Leaves a 2-tile slowing puddle on death' },
  roller: { name: 'Boulder Roller', type: 'troop', rarity: 'rare', cost: 4, hp: 1300, dmg: 200, hit: 1.6, range: MELEE, speed: 'fast',
    targets: 'buildings', body: 'big', roll: 50, tags: ['wincon', 'ground', 'buildingtargeter'], text: 'Rolls over small units, dealing 50 to each' },
  harpoon: { name: 'Harpoon Gunner', type: 'troop', rarity: 'rare', cost: 4, hp: 500, dmg: 140, hit: 1.5, range: 6.5, speed: 'medium',
    targets: 'both', body: 'small', pull: 1, tags: ['ranged', 'antiair', 'ground'], text: 'First shot pulls its target 1 tile closer' },
  lancer: { name: 'Forge Lancer', type: 'troop', rarity: 'rare', cost: 4, hp: 450, dmg: 15, hit: 0.4, range: 5, speed: 'medium',
    targets: 'both', body: 'small', beam: { dmg: [15, 60, 300], every: 5 }, tags: ['tankkiller', 'ranged', 'antiair', 'ground'],
    text: 'Beam grows stronger on one target: 15, then 60, then 300' },   // 'every': hits per beam stage (2 s), a guess
  kite: { name: 'Paper Kite', type: 'troop', rarity: 'rare', cost: 5, hp: 1100, dmg: 300, hit: 2.0, range: 1, speed: 'medium',
    targets: 'buildings', body: 'big', air: true, deathSplash: { r: 2, dmg: 150 }, tags: ['wincon', 'air', 'buildingtargeter'],
    text: 'Flies to buildings. Drops 150 splash damage when it falls' },   // range and splash radius are guesses
  ember: { name: 'Ember Mage', type: 'troop', rarity: 'rare', cost: 5, hp: 650, dmg: 220, hit: 1.9, range: 5.5, speed: 'medium',
    targets: 'both', body: 'small', splash: 1.5, tags: ['splash', 'antiair', 'antiswarm', 'ground'], text: 'Splash hits all units in radius' },
  treant: { name: 'Ironbark Treant', type: 'troop', rarity: 'rare', cost: 6, hp: 3600, dmg: 180, hit: 1.5, range: MELEE, speed: 'slow',
    targets: 'buildings', body: 'huge', root: { r: 2.5, time: 1 }, tags: ['tank', 'wincon', 'ground', 'buildingtargeter'], text: 'On death, roots nearby enemies for 1 s' },
  wyvern: { name: 'Glass Wyvern', type: 'troop', rarity: 'epic', cost: 4, hp: 900, dmg: 120, hit: 1.4, range: 2, speed: 'fast',
    targets: 'both', body: 'mid', air: true, splash: 1, spellWeak: 25, tags: ['air', 'splash', 'antiswarm', 'antiair'], text: 'Takes 25% extra damage from spells' },
  shade: { name: 'Shade Duelist', type: 'troop', rarity: 'epic', cost: 4, hp: 650, dmg: 220, hit: 1.3, range: MELEE, speed: 'fast',
    targets: 'ground', body: 'small', stealth: true, tags: ['assassin', 'ground'], text: 'Invisible until its first attack' },
  captain: { name: 'Banner Captain', type: 'troop', rarity: 'epic', cost: 5, hp: 1200, dmg: 110, hit: 1.2, range: MELEE, speed: 'medium',
    targets: 'ground', body: 'mid', aura: { r: 3, pct: 15 }, tags: ['support', 'ground'], text: 'Allies within 3 tiles move and attack 15% faster' },
  golem: { name: 'Clockwork Golem', type: 'troop', rarity: 'epic', cost: 7, hp: 4200, dmg: 250, hit: 1.8, range: MELEE, speed: 'slow',
    targets: 'buildings', body: 'huge', split: 'cog', tags: ['tank', 'wincon', 'ground', 'buildingtargeter'], text: 'Splits into 2 Cogs (600 HP, 80 dmg) on death' },
  hermit: { name: 'Storm Hermit', type: 'troop', rarity: 'mythic', cost: 4, hp: 700, dmg: 160, hit: 1.6, range: 5, speed: 'medium',
    targets: 'both', body: 'small', chain: { jumps: 2, pct: 60, r: 3 }, tags: ['ranged', 'antiair', 'antiswarm', 'ground'], text: 'Lightning jumps to 2 more targets at 60%' },
  tide: { name: 'Tidecaller', type: 'troop', rarity: 'mythic', cost: 5, hp: 750, dmg: 130, hit: 1.5, range: 5.5, speed: 'medium',
    targets: 'ground', body: 'small', knock: 0.5, tags: ['ranged', 'control', 'ground'], text: 'A rolling wave: every hit pushes a ground target back 0.5 tiles' },

  // ---------- spells ----------
  shower: { name: 'Spark Shower', type: 'spell', rarity: 'common', cost: 2, radius: 2.5, dmg: 200, delay: 0.5, tags: ['spell', 'antiswarm'], text: '200 damage' },
  gust: { name: 'Gust', type: 'spell', rarity: 'common', cost: 2, radius: 3, dmg: 80, delay: 0, push: 1.5, tags: ['spell', 'reset'], text: '80 damage, pushes units 1.5 tiles away' },
  flamejar: { name: 'Flame Jar', type: 'spell', rarity: 'rare', cost: 4, radius: 2.5, dmg: 520, delay: 1, tags: ['spell', 'antiswarm', 'bigspell'], text: '520 damage' },
  frost: { name: 'Frost Bloom', type: 'spell', rarity: 'epic', cost: 4, radius: 3, dmg: 90, delay: 0, freeze: 3.5, tags: ['spell', 'reset', 'freeze'], text: 'Freezes units and buildings for 3.5 s, 90 damage' },
  meteor: { name: 'Meteor', type: 'spell', rarity: 'epic', cost: 6, radius: 3, dmg: 1100, delay: 2.5, tags: ['spell', 'bigspell'], text: '1,100 damage, shadow shown' },

  // ---------- buildings ----------
  turret: { name: 'Stone Turret', type: 'building', rarity: 'common', cost: 3, hp: 700, dmg: 150, hit: 0.9, range: 5.5, life: 30,
    targets: 'ground', body: 'big', tags: ['building', 'pull', 'defence'], text: 'Ground defence' },
  loft: { name: 'Arrow Loft', type: 'building', rarity: 'rare', cost: 4, hp: 900, dmg: 90, hit: 1.0, range: 7, life: 35,
    targets: 'both', body: 'big', tags: ['building', 'pull', 'defence', 'antiair'], text: 'All-round defence' },
  hive: { name: 'Hive Spire', type: 'building', rarity: 'rare', cost: 5, hp: 1000, life: 40, spawn: { card: 'moths', n: 2, every: 7, first: 1 },
    body: 'big', tags: ['building', 'spawner', 'pull'], text: 'Spawns 2 Moths every 7 s' },
};

// Units that only appear from other cards.
export const TOKENS = {
  cog: { name: 'Cog', type: 'troop', rarity: 'epic', hp: 600, dmg: 80, hit: 1.2, range: MELEE, speed: 'medium',
    targets: 'buildings', body: 'mid', tags: ['ground'], offsets: [[-0.6, 0], [0.6, 0]], count: 2 },   // hit speed and target filter are guesses
};

// Archived cards: only The Archivist (Arena 9) plays these. Homages to genre archetypes, with our own names and numbers.
export const ARCHIVED = {
  trio: { name: 'Marksman Trio', type: 'troop', rarity: 'mythic', cost: 9, hp: 450, dmg: 160, hit: 1.5, range: 6.5, speed: 'medium',
    targets: 'both', body: 'small', count: 3, offsets: [[-0.8, 0], [0, 0.4], [0.8, 0]], archived: true,
    tags: ['ranged', 'antiair', 'ground'], text: 'Three long-range sharpshooters' },
};
// Every card a deck may hold (the 27 plus archived ones).
export const ALL_CARDS = { ...CARDS, ...ARCHIVED };

export const CARD_IDS = Object.keys(CARDS);
export const STARTER_DECK = ['imps', 'fox', 'hedge', 'smasher', 'slingers', 'moths', 'shower', 'turret'];
export const FIRST_UNLOCK = 'gust';   // always in the first card offer
export const RARITIES = ['common', 'rare', 'epic', 'mythic'];
export const RARITY_COLOR = { common: '#9aa7b8', rare: '#f0a030', epic: '#b05ce8', mythic: '#38e0c8' };

// Stats vs level 1, in percent (the progression doc's table: about +8% per level).
export const LEVEL_PCT = [0, 100, 108, 117, 126, 136, 147, 159, 171, 185];
export const MAX_LEVEL = 9;
