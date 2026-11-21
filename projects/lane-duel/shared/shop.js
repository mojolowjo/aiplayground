// Shop rules shared by the server (game/sim.js) and the browser (public/client.js), so the price a player
// is shown is worked out by the same code that charges it. Pure functions; item data comes from game/data.js.

export const BAG_SLOTS = 6;

// How each stat is written in the shop ("+90 ability power"). Also what the search box matches against.
export const STAT_TEXT = {
  ad: v => `+${v} attack damage`, ap: v => `+${v} ability power`, as: v => `+${v}% attack speed`, hp: v => `+${v} health`, mana: v => `+${v} mana`,
  armor: v => `+${v} armor`, mr: v => `+${v} magic resist`, ms: v => `+${v} move speed`, hpRegen: v => `+${v} health regen per second`,
  manaRegen: v => `+${v} mana regen per second`, haste: v => `+${v} ability haste`, crit: v => `+${v}% crit chance`, lifesteal: v => `+${v}% lifesteal`,
  armorPen: v => `+${v}% armor pen`, magicPenPct: v => `+${v}% magic pen`, magicPenFlat: v => `+${v} flat magic pen`, tenacity: v => `+${v}% tenacity`,
  healAmp: v => `+${v}% healing received`,
};

// Items by id, with no inherited keys: a made-up id such as "constructor" finds nothing.
export function byId(items) { return Object.assign(Object.create(null), Object.fromEntries(items.map(i => [i.id, i]))); }

// Work out a purchase of item `id` for a bag ([{ id, n }, ...]).
//   used   bag slots that the recipe uses up (owned parts, and owned parts of parts)
//   price  the item's total price minus the full price of everything used up
//   stack  the bag slot a stackable item is added to, or -1
//   ok     false if it cannot be bought at all, with `why`
// It does not look at gold; the caller compares `price` with what the hero has.
export function plan(ITEM, bag, id) {
  const it = typeof id === 'string' ? ITEM[id] : null;
  if (!it) return { ok: false, why: 'No such item', price: 0, used: [], stack: -1 };
  const used = [];
  const take = part => { const i = bag.findIndex((s, k) => s.id === part && !used.includes(k)); if (i >= 0) used.push(i); return i >= 0; };
  // For each part: use an owned one, or else look inside that part's own recipe the same way.
  const walk = item => { for (const part of item.recipe || []) if (!take(part)) walk(ITEM[part]); };
  walk(it);
  const price = it.cost - used.reduce((sum, i) => sum + ITEM[bag[i].id].cost, 0);
  const out = { ok: true, why: '', price, used, stack: -1 };
  const fail = why => ({ ...out, ok: false, why });
  if (it.stack) {
    out.stack = bag.findIndex(s => s.id === it.id);
    if (out.stack >= 0 && bag[out.stack].n >= it.stack) return fail(`You can carry ${it.stack} at most`);
  }
  if (it.group && out.stack < 0 && bag.some((s, k) => !used.includes(k) && ITEM[s.id].group === it.group)) return fail(`Only one ${it.group} item`);
  if (!used.length && out.stack < 0 && bag.length >= BAG_SLOTS) return fail('No free slot');
  return out;
}

// Every item whose recipe uses `id` directly.
export function buildsInto(items, id) { return items.filter(i => (i.recipe || []).includes(id)); }

// The lines shown for an item: its stats, then its passive.
export function describe(it) {
  const lines = Object.entries(it.stats || {}).map(([k, v]) => (STAT_TEXT[k] ? STAT_TEXT[k](v) : `+${v} ${k}`));
  if (it.use) lines.push(`Drink (slot key): restores ${it.use.heal} health over ${it.use.over}s` + (it.stack ? `. Stacks to ${it.stack}.` : '') + (it.charges ? `. ${it.charges} charges, refilled at base.` : ''));
  if (it.passive) lines.push(`Passive – ${it.passive.name}: ${it.passive.desc}`);
  return lines;
}

// The parts of item `id` (at any depth) that the bag does not already cover: what is still to be bought.
export function missing(ITEM, bag, id) {
  const used = [], out = [];
  const take = part => { const i = bag.findIndex((s, k) => s.id === part && !used.includes(k)); if (i >= 0) used.push(i); return i >= 0; };
  const walk = item => { for (const part of item.recipe || []) if (!take(part)) { out.push(part); walk(ITEM[part]); } };
  walk(ITEM[id]);
  return out;
}
