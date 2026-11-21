'use strict';
// Ability, spell and item icons, drawn as inline SVG on a 48x48 grid.
const ICON = (() => {
  const O = '#10141a';
  const P = (d, fill = '#fff', sw = 2, stroke = O) => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const L = (d, stroke = '#fff', sw = 3) => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const C = (x, y, r, fill = '#fff', sw = 2, stroke = O) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  const G = (x, y, deg, body, s = 1) => `<g transform="translate(${x} ${y}) rotate(${deg}) scale(${s})">${body}</g>`;
  // Shapes drawn pointing along +x from the origin, placed with G().
  const arrow = (len, col = '#f4ecd8') => L(`M0 0H${len - 6}`, O, 5) + L(`M0 0H${len - 6}`, col, 2.5) + P(`M${len - 9} -5L${len} 0L${len - 9} 5Z`, '#f4f4fa', 1.5) + P(`M0 0L-5 -4H1ZM0 0L-5 4H1Z`, col, 1);
  const sword = (len, w, blade = '#e3e9f0', hilt = '#c9a04a') => P(`M3 ${-w}H${len - 6}L${len} 0L${len - 6} ${w}H3Z`, blade, 2) + L(`M5 0H${len - 7}`, '#ffffffaa', 1) +
    P(`M-1 ${-w - 4}H3V${w + 4}H-1Z`, hilt, 2) + P(`M-10 -2H-1V2H-10Z`, '#6b4a2a', 2) + C(-11, 0, 2.6, hilt, 1.5);
  const star = (x, y, r, fill, n = 4, inner = 0.38) => { let d = ''; for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n - Math.PI / 2, rr = i % 2 ? r * inner : r; d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`; } return P(d + 'Z', fill, 2); };
  const flame = (x, y, s, a = '#ff8a3a', b = '#ffe27a') => G(x, y, 0, P('M0 -14C7 -6 10 -1 8 6C7 11 3 14 0 14C-4 14 -9 10 -9 4C-9 0 -6 -2 -5 -6C-2 -4 -2 -9 0 -14Z', a, 2) + P('M0 0C3 3 4 6 3 9C2 11 -3 11 -4 8C-5 5 -2 4 0 0Z', b, 0), s);

  // A crescent blade: bulges toward +x, centred on x,y.
  const cres = (x, y, r, fill) => P(`M${x} ${y - r}A${r} ${r} 0 0 1 ${x} ${y + r}A${r * 1.6} ${r * 1.6} 0 0 0 ${x} ${y - r}Z`, fill, 1.8);
  const art = {
    // --- Oriel
    oriel0: G(9, 39, -45, P('M0 0L10 -5L42 0L10 5Z', '#ffb35a', 2) + P('M10 -2.5L36 0L10 2.5Z', '#fff2c0', 0)) + flame(12, 34, 0.55) + L('M30 34L36 28M36 38L42 32', '#ffb35a', 2),
    oriel1: `<ellipse cx="24" cy="34" rx="18" ry="8" fill="#ff8a3a55" stroke="#ffb35a" stroke-width="2.5"/>` + flame(24, 22, 1.15),
    oriel2: C(24, 24, 15, 'none', 4, O) + `<circle cx="24" cy="24" r="15" fill="none" stroke="#d0a8ff" stroke-width="2.5" stroke-dasharray="7 4"/>` + star(24, 24, 12, '#fff'),
    oriel3: C(24, 24, 9, '#ffe27a') + [0, 45, 90, 135, 180, 225, 270, 315].map(d => G(24, 24, d, P('M13 -3L21 0L13 3Z', '#ffd24a', 1.5))).join('') + C(24, 24, 4, '#fff', 0),
    // --- Bliknarczt
    gorrumP: P('M24 5L40 11V24C40 33 33 40 24 43C15 40 8 33 8 24V11Z', '#c9973f') + C(24, 22, 9, '#0f2a26') + C(24, 22, 5, '#7ff0c8', 0) + [[12, 13], [36, 13], [14, 31], [34, 31]].map(([x, y]) => C(x, y, 1.6, '#6b4a14', 0)).join(''),
    gorrum0: L('M6 42L26 22', O, 5) + `<path d="M6 42L26 22" fill="none" stroke="#aab3bd" stroke-width="3" stroke-dasharray="4 3"/>` + G(24, 24, -45, P('M0 -3H8V-9L24 0L8 9V3H0Z', '#dfe6ee', 2) + P('M2 -3L-6 -10L-2 -2ZM2 3L-6 10L-2 2Z', '#aab3bd', 1.5)),
    gorrum1: P('M10 38V22H16V38ZM21 38V16H27V38ZM32 38V22H38V38Z', '#8a6a2c') + [[13, 15, 5], [24, 9, 6], [35, 15, 5]].map(([x, y, r]) => C(x, y, r, '#e8f0f2', 1.5)).join('') + L('M6 42H42', '#c9973f', 3),
    gorrum2: P('M12 30V20Q12 16 16 16H32Q36 16 36 20V30Q36 36 30 36H18Q12 36 12 30Z', '#aab3bd') + L('M18 16V24M24 16V24M30 16V24', O, 1.8) + P('M24 2L32 11H27V14H21V11H16Z', '#ffd27a', 1.5) + L('M10 42H38', '#fff8', 2),
    gorrum3: C(24, 24, 18, 'none', 2.5, '#9fe8d2') + `<circle cx="24" cy="24" r="12" fill="none" stroke="#9fe8d2" stroke-width="2.5" stroke-dasharray="5 3"/>` + P('M27 8L16 26H23L20 40L33 21H25Z', '#eafff8'),
    // --- Ezrlae
    wrenP: C(24, 24, 16, '#d8b060') + C(24, 24, 12, '#fff6e0', 1.5) + P('M24 10L28 24H20Z', '#c0392b', 1.2) + P('M24 38L28 24H20Z', '#e8e8f0', 1.2) + C(24, 24, 2, O, 0),
    wren0: G(7, 41, -45, P('M0 0L10 -5L46 0L10 5Z', '#fff2c0', 2) + P('M10 -2.2L40 0L10 2.2Z', '#ffffff', 0)) + L('M30 40L36 34M22 42L26 38', '#fff8', 2) + star(38, 10, 6, '#fff'),
    wren1: C(24, 24, 9, '#ffe9a0') + C(22, 22, 3, '#fff', 0) + `<circle cx="24" cy="24" r="16" fill="none" stroke="#ffe9a0" stroke-width="2.5" stroke-dasharray="6 4"/>` + L('M24 3V10M24 38V45M3 24H10M38 24H45', '#fff', 2.5),
    wren2: C(12, 34, 7, '#ffffff22', 2, '#ffe9a0') + `<circle cx="12" cy="34" r="7" fill="none" stroke="#ffe9a0" stroke-width="2" stroke-dasharray="3 3"/>` + P('M18 30L24 24L21 21L30 20L29 29L26 26L20 32Z', '#f4ecd8', 1.5) + G(30, 18, -45, P('M0 0L4 -3L16 0L4 3Z', '#fff2c0', 1.5)),
    wren3: [[O, 9], ['#f0c05a', 6], ['#ffffff', 2]].map(([c, w]) => L('M14 6Q40 24 14 42', c, w)).join('') + L('M4 14H14M2 24H16M4 34H14', '#fff9', 2.5) + L('M30 12Q40 24 30 36', '#fff7', 2),
    // --- Katanira
    sableP: [0, 120, 240].map(d => G(24, 24, d, cres(11, 0, 9, '#eaf4ff'))).join('') + star(24, 24, 7, '#fff'),
    sable0: G(30, 16, -30, cres(0, 0, 13, '#eaf4ff')) + `<path d="M8 40L18 30L14 22L26 20" fill="none" stroke="#bcd0ff" stroke-width="2.5" stroke-dasharray="4 3" stroke-linecap="round"/>` + C(8, 40, 3, '#fff', 1.5) + C(14, 22, 3, '#fff', 1.5),
    sable1: G(24, 18, -90, cres(0, 0, 12, '#eaf4ff')) + P('M24 3L29 9H19Z', '#fff', 1.2) + `<ellipse cx="24" cy="40" rx="13" ry="4" fill="none" stroke="#bcd0ff" stroke-width="2" stroke-dasharray="4 3"/>` + L('M8 26V34M40 26V34', '#fff8', 2),
    sable2: G(30, 18, 200, cres(0, 0, 14, '#f4f0d8')) + `<path d="M6 42L20 30" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="3 4" stroke-linecap="round"/>` + star(10, 14, 5, '#fff') + star(40, 38, 4, '#fff'),
    sable3: [0, 60, 120, 180, 240, 300].map(d => G(24, 24, d, cres(12, 0, 8, '#eaf4ff'))).join('') + C(24, 24, 4, '#bcd0ff', 1.5),
    // --- Xerhta
    kessaP: P('M24 5C31 15 36 21 36 29A12 12 0 0 1 12 29C12 21 17 15 24 5Z', '#7fb8ff') + P('M20 30A5 5 0 0 0 25 35', 'none', 2, '#ffffffcc') + L('M38 12V20M34 16H42', '#fff', 2.5),
    kessa0: G(5, 41, -40, P('M0 -5H44L50 0L44 5H0Z', '#8fd0ff', 2) + P('M2 -1.8H46V1.8H2Z', '#ffffff', 0) + C(0, 0, 6, '#dff2ff')) + L('M30 40L36 34M22 42L26 38', '#fff8', 2),
    kessa1: `<ellipse cx="24" cy="30" rx="19" ry="12" fill="#ffe9a033" stroke="#ffe9a0" stroke-width="2.5" stroke-dasharray="6 3"/>` + `<ellipse cx="24" cy="30" rx="8" ry="5" fill="#ffe9a0" stroke="${O}" stroke-width="2"/>` + star(24, 13, 9, '#fff6d0'),
    kessa2: L('M5 40L24 24', '#fff8', 2.5) + `<path d="M5 40L24 24" fill="none" stroke="#8fd0ff" stroke-width="2.5" stroke-dasharray="4 4"/>` + C(28, 21, 9, '#dff2ff') + C(26, 19, 3, '#fff', 0) + star(38, 10, 7, '#ffd24a', 5, 0.45),
    kessa3: [[12, 34, 8], [24, 38, 9], [36, 33, 8]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.45}" fill="#8fd0ff44" stroke="#8fd0ff" stroke-width="2" stroke-dasharray="4 3"/>`).join('') +
      [[12, 20], [24, 14], [36, 19]].map(([x, y]) => L(`M${x} ${y - 12}V${y}`, '#fff8', 2) + G(x, y, 90, P('M-5 -4H4L9 0L4 4H-5Z', '#dff2ff', 1.5))).join(''),
    // --- Spells
    spell_d: P('M28 4L10 27H22L18 44L38 19H25Z', '#ffe27a') + L('M8 10L11 13M40 36L43 39M38 8L41 6', '#fff9', 2),
    spell_f: P('M24 42C10 32 5 24 5 16A9.5 9.5 0 0 1 24 12A9.5 9.5 0 0 1 43 16C43 24 38 32 24 42Z', '#6fe08a') + P('M21 15H27V21H33V27H27V33H21V27H15V21H21Z', '#fff', 1.5),
  };

  // ---------- items: shaded objects rather than flat glyphs ----------
  const lg = (id, x1, y1, x2, y2, stops) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</linearGradient>`;
  const rg = (id, cx, cy, r, stops) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('')}</radialGradient>`;
  const S = (d, fill, stroke = 'none', sw = 1, extra = '') => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
  const E = (cx, cy, rx, ry, fill, stroke = 'none', sw = 1, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${extra}/>`;
  const glint = (x, y, r, o = 0.95) => S(`M${x} ${y - r}L${x + r * 0.22} ${y - r * 0.22}L${x + r} ${y}L${x + r * 0.22} ${y + r * 0.22}L${x} ${y + r}L${x - r * 0.22} ${y + r * 0.22}L${x - r} ${y}L${x - r * 0.22} ${y - r * 0.22}Z`, '#fff', 'none', 0, `opacity="${o}"`);
  const shadow = (cx, cy, rx, ry) => E(cx, cy, rx, ry, 'url(#shadow)');
  const DEFS = lg('gold', 0, 0, 0, 1, [[0, '#fff0b0'], [0.45, '#e0a830'], [1, '#7a4c0c']]) + lg('leather', 0, 0, 0, 1, [[0, '#a06a3c'], [1, '#42250f']]) +
    lg('wood', 0, 0, 1, 1, [[0, '#b98a52'], [0.5, '#7c5428'], [1, '#4a2f14']]) + lg('slot', 0, 0, 0, 1, [[0, '#2a323d'], [1, '#0e1218']]) +
    rg('shadow', 0.5, 0.5, 0.5, [[0, '#000', 0.6], [1, '#000', 0]]) + lg('steelHi', 0, 0, 0, 1, [[0, '#ffffff'], [1, '#c3ccd6']]) + lg('steelLo', 0, 0, 0, 1, [[0, '#8a95a3'], [1, '#56606c']]);
  // A sword drawn along +x: two-tone blade for a centre ridge, wrapped grip, metal guard and pommel.
  const blade3d = (len, w, o = {}) => {
    const tip = o.tip || 7, gw = o.guard || w + 4.5, grip = o.grip || 10;
    return S(`M4 ${-w}H${len - tip}L${len} 0H4Z`, o.hi || 'url(#steelHi)') + S(`M4 0H${len}L${len - tip} ${w}H4Z`, o.lo || 'url(#steelLo)') +
      S(`M4 ${-w}H${len - tip}L${len} 0L${len - tip} ${w}H4Z`, 'none', '#2c3540', 1) + S(`M7 -0.5H${len - tip - 1}`, 'none', '#ffffff', 0.9, 'opacity=".75"') + S(`M7 0.7H${len - tip - 1}`, 'none', '#3c4654', 0.7, 'opacity=".6"') +
      (o.guardPath ? S(o.guardPath, 'url(#gold)', '#4a2e06', 1) : `<rect x="0" y="${-gw}" width="4.6" height="${gw * 2}" rx="1.6" fill="url(#gold)" stroke="#4a2e06"/>`) +
      `<rect x="${-grip}" y="-2.3" width="${grip}" height="4.6" rx="1" fill="url(#leather)" stroke="#24140a"/>` +
      Array.from({ length: Math.floor(grip / 2.4) }, (_, i) => S(`M${-grip + 1.2 + i * 2.4} -2.2L${-grip + 2.4 + i * 2.4} 2.2`, 'none', '#d9a870', 0.7, 'opacity=".55"')).join('') +
      `<circle cx="${-grip - 2.2}" cy="0" r="${o.pommel || 3}" fill="url(#gold)" stroke="#4a2e06"/>` + `<circle cx="${-grip - 3}" cy="-0.9" r="0.9" fill="#fff" opacity=".8"/>` + (o.extra || '');
  };
  const itemArt = {
    blade: ['#7fa8d8', shadow(24, 40, 15, 3.5) + G(15, 34, -45, blade3d(34, 3.6), 0.9) + glint(35, 14, 4)],
    greatblade: ['#ff9a4a', shadow(24, 41, 17, 3.5) + G(13.5, 35.5, -45, blade3d(42, 6.2, { tip: 10, grip: 9, pommel: 3.4,
      guardPath: 'M-1 -13C2 -12 5 -9 5.5 -6V6C5 9 2 12 -1 13C1 9 1 5 0 3V-3C1 -5 1 -9 -1 -13Z',
      extra: `<circle cx="2.6" cy="0" r="2.3" fill="#ff4a5a" stroke="#5a0a14"/><circle cx="2" cy="-0.7" r="0.8" fill="#fff" opacity=".85"/>` + S('M10 -3.5L14 0L10 3.5L18 0Z', '#c9a04a', 'none', 0, 'opacity=".55"') }), 0.8) + glint(36, 13, 5) + glint(28, 22, 2.4, 0.7)],
    dagger: ['#b8c4d0', shadow(25, 40, 12, 3) + G(14, 35, -45, blade3d(25, 3.4, { tip: 9, grip: 8, guard: 6, pommel: 2.4, hi: '#f4f7fa', lo: '#7a8592' })) + glint(31, 17, 3.2)],
    tome: ['#b98cf0', lg('cover', 0, 0, 1, 1, [[0, '#9a6ae8'], [1, '#4a2a8a']]) + lg('pages', 0, 0, 0, 1, [[0, '#fff6dc'], [1, '#c9b88a']]) + shadow(25, 42, 16, 3.5) +
      S('M13 43L38.5 39L38 35.5L12 39.5Z', 'url(#pages)', '#6a5a34', 0.8) + S('M14 41.3L38 37.6M14 42.2L38 38.6', 'none', '#8a7a50', 0.5) +
      S('M12 9L8.5 12L10 43L13 40.5Z', '#35206a', '#1a0e3a', 1) + S('M12 9L36 6L38 36L13 40.5Z', 'url(#cover)', '#1a0e3a', 1) +
      S('M14.5 11.6L34.2 9.2L35.8 33.8L15.6 37.4Z', 'none', '#e8c860', 0.9, 'opacity=".85"') +
      S('M12 9L16 8.5L12.3 13Z M36 6L36.3 10.5L32 6.5Z M38 36L33.6 36.8L37.7 31.8Z M13 40.5L12.8 36L17 39.8Z', 'url(#gold)', '#4a2e06', 0.6) +
      E(25, 23, 5.4, 6.4, '#2a1658', '#e8c860', 0.9, 'transform="rotate(-6 25 23)"') + glint(25, 23, 4.4) + S('M30 6.8L31.6 6.6L32.6 15L31.2 13.6L30.2 15.2Z', '#e0404a', '#6a0a14', 0.5) +
      S('M14 12L22 11L15 22Z', '#fff', 'none', 0, 'opacity=".16"')],
    staff: ['#c58bff', rg('orb', 0.38, 0.34, 0.7, [[0, '#ffffff'], [0.35, '#d9a8ff'], [1, '#5a1e9a']]) + rg('halo', 0.5, 0.5, 0.5, [[0, '#c58bff', 0.75], [1, '#c58bff', 0]]) + shadow(22, 43, 13, 3) +
      S('M10 43.5L12.4 45L32 20L29.4 18.2Z', 'url(#wood)', '#2a180a', 0.9) + S('M11 43L29.8 19.2', 'none', '#e8c898', 0.7, 'opacity=".5"') +
      S('M17.2 34.5L20 36.6M20.6 30.2L23.4 32.3', 'none', '#e0a830', 2) + E(33, 14, 13, 13, 'url(#halo)') +
      S('M29 19C24 15 24 8 30 5C28 9 28 13 31 16Z', 'url(#gold)', '#4a2e06', 0.9) + S('M32.5 20.5C38 23 43 19 43 13C41 16 37 18 33.5 17Z', 'url(#gold)', '#4a2e06', 0.9) +
      S('M28.5 19L32.5 21L33.6 17.4L30.6 15.6Z', 'url(#gold)', '#4a2e06', 0.9) + `<circle cx="34" cy="12.5" r="6" fill="url(#orb)" stroke="#3a0e6a"/>` + glint(32, 10.4, 2.6)],
    gem: ['#ff5a6a', rg('ghalo', 0.5, 0.5, 0.5, [[0, '#ff5a6a', 0.55], [1, '#ff5a6a', 0]]) + E(24, 25, 20, 19, 'url(#ghalo)') + shadow(24, 41, 12, 3) +
      S('M16 10H32L27.5 18H20.5Z', '#ffd0d6') + S('M16 10L20.5 18L7.5 19Z', '#ff8e9a') + S('M32 10L40.5 19L27.5 18Z', '#e8485a') +
      S('M7.5 19L20.5 18L24 40Z', '#d83a4e') + S('M20.5 18H27.5L24 40Z', '#f2606e') + S('M27.5 18L40.5 19L24 40Z', '#9a1a30') +
      S('M16 10H32L40.5 19L24 40L7.5 19Z', 'none', '#4a0a16', 1.1) + S('M20.5 18H27.5M16 10L20.5 18L24 40M32 10L27.5 18', 'none', '#fff', 0.5, 'opacity=".45"') +
      S('M18 11.4H24L22 15.6Z', '#fff', 'none', 0, 'opacity=".7"') + glint(34, 12, 3.6)],
    crystal: ['#5aa8ff', rg('chalo', 0.5, 0.5, 0.5, [[0, '#6ab8ff', 0.6], [1, '#6ab8ff', 0]]) + E(24, 24, 20, 20, 'url(#chalo)') + shadow(24, 42, 13, 3) +
      S('M11 24L15 19L18 23L17 40L12 40Z', '#3a7ad8', '#0e2a5a', 0.9) + S('M15 19L18 23L17 40L14.6 40Z', '#8cc4ff', 'none', 0, 'opacity=".7"') +
      S('M33 21L37 26L36 40H31L30 25Z', '#2a62c0', '#0e2a5a', 0.9) + S('M33 21L33.6 40H31L30 25Z', '#7ab4f8', 'none', 0, 'opacity=".7"') +
      S('M24 4L31 15L29 41H19L17 15Z', '#4a94f0', '#0e2a5a', 1) + S('M24 4L17 15L19 41H23Z', '#b8dcff') + S('M24 4L31 15L29 41H26.5Z', '#2456b0') +
      S('M17 15L23.4 17L26 16.4L31 15', 'none', '#eaf6ff', 0.7, 'opacity=".8"') + S('M19.5 16.5L21.5 17L21.8 34L20.4 34Z', '#fff', 'none', 0, 'opacity=".55"') + glint(27, 9, 3.4)],
    plating: ['#aab3bd', rg('plate', 0.38, 0.3, 0.8, [[0, '#f4f7fa'], [0.45, '#a8b2be'], [1, '#4c5662']]) + shadow(24, 42, 15, 3) +
      S('M14 7L19.5 9.5C22 12 26 12 28.5 9.5L34 7L41 13.5L37 20.5C37.5 27 37 33 35.5 38.5C29 42 19 42 12.5 38.5C11 33 10.5 27 11 20.5L7 13.5Z', 'url(#plate)', '#262e38', 1.1) +
      S('M19.5 9.5C22 12 26 12 28.5 9.5C27 15 21 15 19.5 9.5Z', '#3a424c', '#262e38', 0.8) + S('M24 14.5V40.5', 'none', '#2e3640', 0.9) + S('M23.2 14.5V40.5', 'none', '#fff', 0.6, 'opacity=".5"') +
      S('M11.6 28C17 30.5 31 30.5 36.4 28M12.2 33.5C17.5 36 30.5 36 35.8 33.5', 'none', '#2e3640', 0.9) + S('M14 7L7 13.5L11 20.5L15.5 12.5Z M34 7L41 13.5L37 20.5L32.5 12.5Z', '#c9d1da', '#262e38', 0.9) +
      [[15, 24], [33, 24], [14.4, 31], [33.6, 31], [15.4, 37], [32.6, 37]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1" fill="#e8c860" stroke="#4a2e06" stroke-width=".4"/>`).join('') +
      S('M15 14.5C16 20 16 24 15.2 26.5C18.4 26 20.6 23 21 17Z', '#fff', 'none', 0, 'opacity=".45"')],
    cloak: ['#8a6ae0', lg('cloth', 0, 0, 1, 0, [[0, '#4a3498'], [0.3, '#8a6ae0'], [0.55, '#5a40b0'], [0.8, '#7c5cd4'], [1, '#3a2880']]) + shadow(24, 43, 16, 3) +
      S('M24 6C30 6 34.5 9.5 35.5 15L42 39C38 43.5 31 42 28.5 44C26 42.5 22.5 43.5 20 44C16 42 9.5 43.5 6 39L12.5 15C13.5 9.5 18 6 24 6Z', 'url(#cloth)', '#1c1244', 1.1) +
      S('M17 20C16 28 14 35 11.5 41M22 21C22 30 21.5 37 20.5 43M27 21C27.5 30 28 37 28.5 43.5M31.5 20C33 28 35 35 37 41', 'none', '#22164e', 1, 'opacity=".55"') +
      S('M24 6C30 6 34.5 9.5 35.5 15C33 19 28 21.5 24 21.5C20 21.5 15 19 12.5 15C13.5 9.5 18 6 24 6Z', '#9a7cf0', '#1c1244', 1) +
      S('M24 9.5C28 9.5 31 12 31.5 15.2C29.5 17.6 26.5 18.8 24 18.8C21.5 18.8 18.5 17.6 16.5 15.2C17 12 20 9.5 24 9.5Z', '#160e30') +
      S('M14 12.5C15.5 9.5 18.5 7.5 22 7', 'none', '#fff', 1, 'opacity=".5"') + `<circle cx="24" cy="22.5" r="3" fill="url(#gold)" stroke="#4a2e06"/>` + `<circle cx="23.2" cy="21.7" r="0.9" fill="#fff" opacity=".85"/>` +
      S('M8 38.5C10 40 13 40.2 15 39.6', 'none', '#fff', 0.8, 'opacity=".3"')],
    boots: ['#d09a5c', lg('boot', 0, 0, 1, 0, [[0, '#c98e52'], [0.5, '#9a6432'], [1, '#5a3416']]) + shadow(25, 42, 17, 3.5) +
      S('M22 9H31V25L39 29.5C41.5 31 41.5 36 39.5 37H22Z', '#6a4220', '#24140a', 1, 'opacity=".9"') +
      S('M12 7C16 8.5 21 8.5 25 7V25L37.5 31C40.5 32.5 40.5 37.5 38 38.5H12.5C11 38.5 10.4 37.5 10.6 36Z', 'url(#boot)', '#24140a', 1.1) +
      S('M10.4 36.5H39.6C39.6 39 38.8 41 37 41H12.6C11 41 10.2 39 10.4 36.5Z', '#2e1c0e', '#140a04', 0.9) + S('M10.6 40H16.5V42H11.4Z', '#20140a') +
      S('M11.4 6C15.5 8 21.5 8 25.6 6L26 11.5C21.5 13.5 15.5 13.5 11 11.5Z', '#e8c088', '#24140a', 1) +
      S('M13.5 18.5H24.4M13.2 24.5H24.8', 'none', '#2e1c0e', 1.6) + `<rect x="16.5" y="16.8" width="4.2" height="3.4" rx=".6" fill="url(#gold)" stroke="#4a2e06" stroke-width=".6"/><rect x="16.5" y="22.8" width="4.2" height="3.4" rx=".6" fill="url(#gold)" stroke="#4a2e06" stroke-width=".6"/>` +
      S('M13 13.5C12.6 20 12.2 27 11.8 34', 'none', '#fff', 1.4, 'opacity=".28"') + S('M27 27L35.5 31.2', 'none', '#fff', 1, 'opacity=".3"')],
    potion: ['#ff6a7a', rg('glass', 0.35, 0.3, 0.8, [[0, '#ffffff', 0.55], [0.6, '#bfe0f0', 0.25], [1, '#6a9ab8', 0.5]]) + lg('liquid', 0, 0, 0, 1, [[0, '#ff7a86'], [1, '#a81428']]) + lg('cork', 0, 0, 1, 0, [[0, '#c99a5c'], [1, '#7a5226']]) + shadow(24, 43, 13, 3) +
      S('M20.5 9.5H27.5V17.2C34.5 19.4 38.5 25 38.5 30.5C38.5 38 32.5 42.5 24 42.5C15.5 42.5 9.5 38 9.5 30.5C9.5 25 13.5 19.4 20.5 17.2Z', 'url(#glass)', '#22303a', 1.1) +
      S('M11.6 28.5C11.2 29.2 11.2 30 11.2 30.6C11.2 37 16.4 40.8 24 40.8C31.6 40.8 36.8 37 36.8 30.6C36.8 30 36.8 29.2 36.4 28.5Z', 'url(#liquid)') + E(24, 28.5, 12.4, 2.6, '#ffa0aa', '#c82a3c', 0.6) +
      `<circle cx="19" cy="34" r="1.5" fill="#ffc0c8" opacity=".8"/><circle cx="28.5" cy="36.5" r="1" fill="#ffc0c8" opacity=".7"/><circle cx="25" cy="32.6" r=".8" fill="#ffc0c8" opacity=".7"/>` +
      S('M19.5 9.5H28.5', 'none', '#22303a', 2.2) + S('M20.2 14.2H27.8', 'none', '#c9a04a', 1.6) + `<rect x="20.6" y="4" width="6.8" height="6" rx="1.2" fill="url(#cork)" stroke="#3a240e"/>` +
      S('M14 24.5C12.4 27 12 30.5 13.2 34', 'none', '#fff', 2, 'opacity=".75"') + S('M22 11V16.5', 'none', '#fff', 1.1, 'opacity=".6"') + glint(31.5, 22.5, 2.8)],
  };
  const BG = { kessa: '#1e4a6e', oriel: '#5a3396', gorrum: '#5a3c10', wren: '#6e5210', sable: '#343c68', spell_d: '#806a10', spell_f: '#1e6a34',
    blade: '#5a2c2c', greatblade: '#6a2a1a', dagger: '#5a4a2a', tome: '#3a2a6a', staff: '#3a2a6a', gem: '#5a1a26', crystal: '#1a3a6a', plating: '#3a4450', cloak: '#2e2450', boots: '#4a3420', potion: '#3a2030' };
  let uid = 0;
  // Gradient ids are made unique per icon so a hidden copy can never break a visible one.
  const unique = svg => { const u = 'i' + (++uid) + '_'; return svg.replace(/id="/g, 'id="' + u).replace(/url\(#/g, 'url(#' + u); };
  return key => {
    if (itemArt[key]) {
      const [tint, body] = itemArt[key];
      return unique(`<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><defs>${DEFS}${rg('tint', 0.5, 0.45, 0.6, [[0, tint, 0.42], [1, tint, 0]])}</defs>` +
        `<rect width="48" height="48" fill="url(#slot)"/><rect width="48" height="48" fill="url(#tint)"/>` +
        `<rect x="1" y="1" width="46" height="46" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="2"/><path d="M1 47V1H47" fill="none" stroke="#fff" stroke-opacity=".1"/>${body}</svg>`);
    }
    const bg = BG[key] || BG[key.replace(/[\dP]$/, '')] || '#333';
    return unique(`<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="ig" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#0c1016"/></radialGradient></defs>` +
      `<rect width="48" height="48" fill="url(#ig)"/>${art[key] || ''}</svg>`);
  };
})();
