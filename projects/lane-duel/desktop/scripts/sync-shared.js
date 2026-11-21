'use strict';
// The settings menu is one file used by both the game page and the app's start screen. The game's copy
// (public/settings-menu.js) is the real one; this copies it in beside the start screen before a run or build.
const fs = require('node:fs'), path = require('node:path');
const from = path.join(__dirname, '..', '..', 'public', 'settings-menu.js'), to = path.join(__dirname, '..', 'start', 'settings-menu.js');
fs.copyFileSync(from, to);
console.log('copied settings-menu.js into the start screen');
