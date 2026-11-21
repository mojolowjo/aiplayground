'use strict';
// The shop screen and the bag. Prices and what a purchase uses up come from Shop (shared/shop.js), the same
// code the server charges with. Uses globals from client.js: $, cmd, hello, me, myDef, shopOpen.
const SHOP = { tab: 'recommended', sel: null, search: '', drawn: '', bagDrawn: '' };
const SHOP_TABS = [['recommended', 'Recommended'], ['starter', 'Starter'], ['attack', 'Attack'], ['magic', 'Magic'], ['defense', 'Defense'], ['boots', 'Boots'], ['consumable', 'Consumables']];
let ITEM = null;

// No artwork: a rounded square in the category's colour with two letters from the name. Finished items get a gold border.
function itemIcon(it) {
  const w = it.name.split(' '), label = w.length > 1 ? w[0][0] + w[1][0] : it.name.slice(0, 2);
  return `<span class="iic cat-${it.cat}${it.tier === 'finished' ? ' fin' : ''}">${label}</span>`;
}
// Does the bag hold this item, or something it has already been built into?
function ownsOrBuilt(id) {
  const inside = (item, want) => (item.recipe || []).some(p => p === want || inside(ITEM[p], want));
  return me.items.some(s => s.id === id || inside(ITEM[s.id], id));
}
// The text shown in the details panel and in tooltips.
function itemText(it, full) {
  const p = Shop.plan(ITEM, me.items, it.id), lines = Shop.describe(it).map(l => (l.startsWith('Passive') ? `<div class="pas">${l}</div>` : `<div>${l}</div>`)).join('');
  const price = p.price !== it.cost ? `<b class="gold">${p.price}g</b> <small>(${it.cost}g in full)</small>` : `<b class="gold">${it.cost}g</b>`;
  return `<div class="dhead">${full ? `<span class="dicon">${itemIcon(it)}</span>` : ''}<span><b>${it.name}</b><br>${price}</span></div>${lines}`;
}

function buildShop() {
  ITEM = Shop.byId(hello.items); SHOP.sel = null; SHOP.drawn = SHOP.bagDrawn = '';
  $('shop').innerHTML = `<div class="shead"><b>Shop</b> <small>(P) — buy at your base or while dead · right-click an item to buy it</small></div>
    <div class="sbody"><div class="sleft"><input id="shopSearch" placeholder="Search name or stat…" maxlength="20"><div id="shopTabs"></div></div>
    <div id="shopGrid"></div><div id="shopInfo"></div></div>
    <div class="sfoot"><span id="shopGold"></span><button id="shopUndo" class="mini">Undo (Ctrl+Z)</button><span id="shopHint"></span></div>`;
  $('shopSearch').oninput = e => { SHOP.search = e.target.value.trim().toLowerCase(); };
  $('shopSearch').onkeydown = e => { if (e.key === 'Escape') e.target.blur(); };
  $('shopUndo').onclick = () => cmd({ c: 'undo' });
  // mousedown, not click: the grid is redrawn as gold ticks up, and a click needs the same element on press and release.
  $('shop').addEventListener('mousedown', e => {
    const tab = e.target.closest('[data-tab]'), item = e.target.closest('[data-item]'), buyBtn = e.target.closest('[data-buy]');
    if (tab) { SHOP.tab = tab.dataset.tab; SHOP.search = ''; $('shopSearch').value = ''; }
    else if (buyBtn) cmd({ c: 'buy', item: buyBtn.dataset.buy });
    else if (item && e.button === 2) cmd({ c: 'buy', item: item.dataset.item });
    else if (item) SHOP.sel = item.dataset.item;
  });
  $('shop').addEventListener('contextmenu', e => e.preventDefault());
}

function shopCell(it, cls = '') {
  const p = Shop.plan(ITEM, me.items, it.id), poor = me.gold < p.price, off = !me.shop || !p.ok || poor;
  return `<div class="cell${off ? ' no' : ''}${SHOP.sel === it.id ? ' sel' : ''} ${cls}" data-item="${it.id}" data-tip="${it.id}">${itemIcon(it)}<span class="cn">${it.name}</span><span class="cp${poor ? ' poor' : ''}">${p.price}</span></div>`;
}
function renderShop() {
  $('shop').style.display = shopOpen ? 'block' : 'none';
  if (!shopOpen || !me || !ITEM) return;
  const state = [SHOP.tab, SHOP.sel, SHOP.search, me.gold, me.shop, me.sell, me.undo, JSON.stringify(me.items)].join('|');
  if (state === SHOP.drawn) return;
  SHOP.drawn = state;
  $('shopTabs').innerHTML = SHOP_TABS.map(([k, n]) => `<div class="tab${SHOP.tab === k && !SHOP.search ? ' on' : ''}" data-tab="${k}">${n}</div>`).join('');
  // middle: search results, the recommended build, or a category
  let grid;
  if (SHOP.search) {
    const hit = it => it.name.toLowerCase().includes(SHOP.search) || Shop.describe(it).some(l => l.toLowerCase().includes(SHOP.search));
    grid = hello.items.filter(hit).map(it => shopCell(it)).join('') || '<div class="none">Nothing matches.</div>';
  } else if (SHOP.tab === 'recommended') {
    // The hero's build, left to right. The first step not yet owned (or built past) is highlighted.
    const steps = (myDef.build || []).map(st => (typeof st === 'string' ? [st] : Array.isArray(st) ? [...new Set(st)] : Object.values(st)));
    let next = steps.length; for (let i = steps.length - 1; i >= 0; i--) { if (steps[i].some(ownsOrBuilt)) break; next = i; }
    grid = steps.map((ids, i) => `<div class="step${i === next ? ' next' : ''}">${ids.map(id => shopCell(ITEM[id])).join(ids.length > 1 && i > 0 ? '<span class="or">or</span>' : '')}</div>`).join('<span class="arrow">→</span>');
    grid = `<div class="build">${grid}</div><div class="none">Buy the highlighted step each time you are back at base.</div>`;
  } else grid = hello.items.filter(it => it.cat === SHOP.tab).map(it => shopCell(it)).join('');
  $('shopGrid').innerHTML = grid;
  // right: details of the selected item
  const it = SHOP.sel && ITEM[SHOP.sel];
  if (!it) $('shopInfo').innerHTML = '<div class="none">Click an item to see what it does and what it builds into.</div>';
  else {
    const p = Shop.plan(ITEM, me.items, it.id), left = me.items.map(s => s.id);
    const from = (it.recipe || []).map(id => { const k = left.indexOf(id), have = k >= 0; if (have) left.splice(k, 1); return `<span class="mini-i${have ? ' have' : ''}" data-item="${id}" data-tip="${id}">${itemIcon(ITEM[id])}${have ? '<i>✓</i>' : ''}</span>`; }).join('');
    const into = Shop.buildsInto(hello.items, it.id).map(o => `<span class="mini-i" data-item="${o.id}" data-tip="${o.id}">${itemIcon(o)}</span>`).join('');
    const can = me.shop && p.ok && me.gold >= p.price;
    $('shopInfo').innerHTML = itemText(it, true) + (from ? `<div class="sub">Builds from</div><div class="row">${from}<span class="fee">+ ${it.fee}g</span></div>` : '') +
      (into ? `<div class="sub">Builds into</div><div class="row">${into}</div>` : '') +
      `<button class="buy" data-buy="${it.id}" ${can ? '' : 'disabled'}>Buy for ${p.price}g</button>` + (!p.ok ? `<div class="why">${p.why}</div>` : !me.shop ? '<div class="why">Return to base to buy</div>' : me.gold < p.price ? `<div class="why">${p.price - me.gold}g short</div>` : '');
  }
  $('shopGold').innerHTML = `<b class="gold">${me.gold}g</b> · ${Shop.BAG_SLOTS - me.items.length} slots free`;
  $('shopUndo').disabled = !me.undo || !me.shop;
  $('shopHint').textContent = !me.shop ? 'Return to base to buy or sell' : me.sell ? `Click an item in your bag to sell it for ${hello.rules.sellBack * 100}%` : 'Selling needs you alive at base';
}

// The bag in the HUD: six slots, each with its number key underneath and a stack or charge count in the corner.
function renderBag() {
  const state = JSON.stringify(me.items);
  if (state === SHOP.bagDrawn) return;
  SHOP.bagDrawn = state;
  $('bag').innerHTML = Array.from({ length: Shop.BAG_SLOTS }, (_, i) => {
    const s = me.items[i], it = s && ITEM[s.id], count = it && (it.stack || it.charges) ? `<b class="cnt">${s.n}</b>` : '';
    return `<div class="bagslot"><div class="bag" data-i="${i}" ${it ? `data-tip="${it.id}"` : ''}>${it ? itemIcon(it) : ''}${count}</div><small>${i + 1}</small></div>`;
  }).join('');
}
function bagClick(e) {
  const d = e.target.closest('.bag'); if (!d || !me.items[d.dataset.i]) return;
  if (shopOpen && me.sell) cmd({ c: 'sell', i: +d.dataset.i });           // with the shop open at base: sell
  else if (ITEM[me.items[d.dataset.i].id].use) cmd({ c: 'use', i: +d.dataset.i });   // otherwise a click drinks it, like its number key
}
// Tooltips: anything carrying data-tip shows that item's details.
document.addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-tip]'); if (!t || !ITEM || !me || !ITEM[t.dataset.tip]) return;
  const tip = $('tip'), r = t.getBoundingClientRect(), it = ITEM[t.dataset.tip], inBag = t.classList.contains('bag');
  tip.innerHTML = itemText(it, false) + (inBag ? `<div class="sub">${it.use ? `Press ${+t.dataset.i + 1} to drink. ` : ''}Sells for ${Math.round(it.cost * hello.rules.sellBack)}g (shop open, at base).</div>` : '');
  tip.style.display = 'block'; tip.style.left = Math.max(8, Math.min(innerWidth - 320, r.left - 100)) + 'px';
  if (r.top < 280) { tip.style.top = (r.bottom + 8) + 'px'; tip.style.bottom = 'auto'; } else { tip.style.bottom = (innerHeight - r.top + 8) + 'px'; tip.style.top = 'auto'; }   // below when there is no room above
});
document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('[data-tip]')) $('tip').style.display = 'none'; });
