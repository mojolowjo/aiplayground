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

  const art = {
    // --- Vesk
    vesk0: G(8, 34, -35, arrow(34)) + G(10, 42, -35, arrow(30)) + G(6, 25, -35, arrow(30)) + L('M30 40L36 36M34 44L40 40', '#fff8', 2),
    vesk1: L('M6 38L22 14L30 30L41 10', O, 6) + L('M6 38L22 14L30 30L41 10', '#ffe27a', 3) + G(41, 10, -61, P('M-7 -6L3 0L-7 6Z', '#f4f4fa', 1.5)) + C(22, 14, 3, '#fff', 1.5) + C(30, 30, 3, '#fff', 1.5),
    vesk2: P('M30 8L18 24L30 40L24 40L12 24L24 8Z', '#f4ecd8') + P('M42 12L33 24L42 36L37 36L28 24L37 12Z', '#f4ecd8aa') + L('M6 16H12M4 24H9M6 32H12', '#fff9', 2),
    vesk3: G(14, 6, 90, arrow(24)) + G(24, 3, 90, arrow(28)) + G(34, 6, 90, arrow(24)) + `<ellipse cx="24" cy="39" rx="17" ry="5" fill="none" stroke="#ffe27a" stroke-width="2.5" stroke-dasharray="5 3"/>`,
    // --- Oriel
    oriel0: G(9, 39, -45, P('M0 0L10 -5L42 0L10 5Z', '#ffb35a', 2) + P('M10 -2.5L36 0L10 2.5Z', '#fff2c0', 0)) + flame(12, 34, 0.55) + L('M30 34L36 28M36 38L42 32', '#ffb35a', 2),
    oriel1: `<ellipse cx="24" cy="34" rx="18" ry="8" fill="#ff8a3a55" stroke="#ffb35a" stroke-width="2.5"/>` + flame(24, 22, 1.15),
    oriel2: C(24, 24, 15, 'none', 4, O) + `<circle cx="24" cy="24" r="15" fill="none" stroke="#d0a8ff" stroke-width="2.5" stroke-dasharray="7 4"/>` + star(24, 24, 12, '#fff'),
    oriel3: C(24, 24, 9, '#ffe27a') + [0, 45, 90, 135, 180, 225, 270, 315].map(d => G(24, 24, d, P('M13 -3L21 0L13 3Z', '#ffd24a', 1.5))).join('') + C(24, 24, 4, '#fff', 0),
    // --- Brakk
    brakk0: G(11, 38, -45, P('M0 -2.5H26V2.5H0Z', '#7a5230', 2) + P('M22 -11H38V11H22Z', '#aab3bd', 2) + P('M24 -11H36V-6H24Z', '#d5dbe2', 0)) + L('M36 30L42 34M30 36L33 42', '#fff9', 2),
    brakk1: P('M24 5L40 11V24C40 33 33 40 24 43C15 40 8 33 8 24V11Z', '#aab3bd') + P('M24 10L35 14V24C35 30 30 35 24 38Z', '#d5dbe2', 0) + L('M24 10V38', O, 1.5),
    brakk2: P('M18 12H30L44 24L30 36H18L28 24Z', '#f4ecd8') + L('M4 16H16M2 24H14M4 32H16', '#fff9', 2.5),
    brakk3: P('M4 30H44L40 42H8Z', '#7a5a3a') + L('M24 30L20 22L27 16L22 6', O, 5) + L('M24 30L20 22L27 16L22 6', '#ffd9a0', 2.5) + L('M24 30L14 26M24 30L35 25M24 30L18 38M24 30L32 39', '#2a1c10', 2) + L('M8 22Q6 14 12 10M40 22Q42 14 36 10', '#fff8', 2),
    // --- Sliv
    sliv0: G(10, 38, -45, sword(38, 4, '#e3f2ee', '#58d6b0')) + L('M6 22L12 16M10 30L14 26', '#fff8', 2),
    sliv1: C(15, 28, 9, '#ffffff22', 2, '#9fe8d2') + `<circle cx="15" cy="28" r="9" fill="none" stroke="#9fe8d2" stroke-width="2" stroke-dasharray="4 3"/>` + C(33, 18, 9, '#1d2a2a') + P('M30 16L38 18L30 21Z', '#58d6b0', 1) + L('M20 25L26 22', '#fff', 2.5),
    sliv2: L('M10 30A16 16 0 0 1 30 9', O, 7) + L('M10 30A16 16 0 0 1 30 9', '#e3f2ee', 4) + L('M38 18A16 16 0 0 1 18 39', O, 7) + L('M38 18A16 16 0 0 1 18 39', '#8affd9', 4) + C(24, 24, 3, '#fff', 1.5),
    sliv3: G(9, 39, -45, sword(40, 3.5, '#e3f2ee', '#58d6b0')) + G(39, 39, -135, sword(40, 3.5, '#e3f2ee', '#58d6b0')) + P('M24 30C27 34 28 36 28 38A4 4 0 0 1 20 38C20 36 21 34 24 30Z', '#ff5a5a', 1.5),
    // --- Spells
    spell_d: P('M28 4L10 27H22L18 44L38 19H25Z', '#ffe27a') + L('M8 10L11 13M40 36L43 39M38 8L41 6', '#fff9', 2),
    spell_f: P('M24 42C10 32 5 24 5 16A9.5 9.5 0 0 1 24 12A9.5 9.5 0 0 1 43 16C43 24 38 32 24 42Z', '#6fe08a') + P('M21 15H27V21H33V27H27V33H21V27H15V21H21Z', '#fff', 1.5),
    // --- Items
    blade: G(11, 37, -45, sword(36, 3.5)),
    greatblade: G(10, 38, -45, sword(42, 6, '#eef3f8', '#ffd24a')) + L('M33 9L37 5M38 14L42 10', '#fff9', 2),
    tome: P('M8 10H22C23 10 24 11 24 12C24 11 25 10 26 10H40V36H26C25 36 24 37 24 38C24 37 23 36 22 36H8Z', '#b98cf0') + L('M24 12V38', O, 2) + L('M12 17H19M12 22H19M29 17H36M29 22H36', '#fff9', 2) + star(33, 30, 4, '#ffe27a'),
    staff: L('M11 42L31 16', O, 6) + L('M11 42L31 16', '#9a7240', 3) + L('M27 20Q24 8 34 6Q44 6 42 16Q40 22 33 20', '#c9a04a', 3) + C(35, 13, 5, '#c58bff') + C(34, 12, 1.6, '#fff', 0),
    dagger: G(13, 35, -45, sword(26, 3, '#e3e9f0', '#8d949c')) + L('M32 30L38 24M36 36L41 31', '#fff8', 2),
    gem: P('M15 9H33L42 20L24 42L6 20Z', '#ff5a6a') + P('M15 9L19 20H6ZM33 9L29 20H42ZM19 20H29L24 42Z', '#ff8a96', 1, O) + P('M15 9H33L29 20H19Z', '#ffc0c8', 1, O),
    crystal: P('M24 4L35 18L28 44H20L13 18Z', '#5aa8ff') + P('M24 4L28 18L24 44L20 18Z', '#a8d4ff', 1, O) + L('M13 18H35', O, 1.5) + star(37, 34, 4, '#fff'),
    plating: P('M12 8L20 11H28L36 8L42 16L37 22V38C32 42 16 42 11 38V22L6 16Z', '#aab3bd') + L('M24 11V40M13 27H35', O, 1.5) + P('M15 14L22 15V24H14Z', '#d5dbe2', 0),
    cloak: P('M24 5C31 5 35 9 36 15L42 40C36 44 12 44 6 40L12 15C13 9 17 5 24 5Z', '#7a5ac8') + P('M24 9C28 9 31 12 31 16C31 20 28 22 24 22C20 22 17 20 17 16C17 12 20 9 24 9Z', '#1d1830') + L('M24 22V42', '#a890e8', 2) + C(24, 24, 2.5, '#ffd24a', 1.5),
    boots: P('M14 6H28V24L40 30C43 32 43 38 40 40H12C10 40 9 38 9 36Z', '#b07a48') + P('M9 36H42V40H12C10 40 9 38 9 36Z', '#5a3a20') + L('M14 12H28M17 18H28', '#e8c898', 2) + L('M3 22H8M2 28H7', '#fff8', 2),
    potion: P('M19 5H29V8H27V16C35 19 39 25 39 31C39 39 33 43 24 43C15 43 9 39 9 31C9 25 13 19 21 16V8H19Z', '#d8ecf4') + P('M12 28C16 25 20 30 24 28C28 26 32 28 36 27C37 29 37 30 37 31C37 38 32 41 24 41C16 41 11 38 11 31C11 30 11 29 12 28Z', '#ff5a6a', 0) + P('M19 3H29V8H19Z', '#9a7240') + C(18, 33, 2, '#fff9', 0),
  };
  const BG = { vesk: '#8a6a14', oriel: '#5a3396', brakk: '#8a4418', sliv: '#1c6a56', spell_d: '#806a10', spell_f: '#1e6a34',
    blade: '#5a2c2c', greatblade: '#6a2a1a', dagger: '#5a4a2a', tome: '#3a2a6a', staff: '#3a2a6a', gem: '#5a1a26', crystal: '#1a3a6a', plating: '#3a4450', cloak: '#2e2450', boots: '#4a3420', potion: '#3a2030' };
  return key => {
    const bg = BG[key] || BG[key.replace(/\d$/, '')] || '#333';
    return `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="ig_${key}" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#0c1016"/></radialGradient></defs>` +
      `<rect width="48" height="48" fill="url(#ig_${key})"/>${art[key] || ''}</svg>`;
  };
})();
