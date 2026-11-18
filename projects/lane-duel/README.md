# Lane Duel

A 1v1 lane game for two players, played in the browser. One player runs the
server; both open a link. Original characters, standard lane-game mechanics:
click-to-move, attack windup and cancelling, skillshots, minion waves and last
hits, a tower with aggro, brush, recall, a shop.

First to 8 kills, 100 minions, or both enemy towers wins. Each side has an outer and an inner
tower; the inner one cannot be damaged until the outer one has fallen.

## Modes

Pick **1v1** or **2v2** in the lobby. Both use the same lane. In 2v2 the targets are team
totals and double: 16 kills or 200 minions. Players are put on alternating teams as they join;
**Switch team** moves you across if there is room, so two friends can play on the same side.
Any seat nobody takes is filled by the practice opponent chosen next to the Start button.
Damaging an enemy within 10 seconds of its death counts as an assist (150 gold, half the XP).

## Run it

Needs Node.js 20 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000.

## Practice alone

With one player in the room the Start button becomes **Practice**, with a choice of opponent:

- **A stationary dummy** stands by its tower and hits whatever comes into range.
- **A bot (easy / normal / hard)** plays the lane: it last-hits minions, sometimes trades when you
  walk up, throws its Q at you now and then, backs off below 35% health and recalls when safe.
  Difficulty changes how accurately it last-hits, how often it trades and how well it aims.
  It follows the same rules as a player (vision, cooldowns, mana).

The stats panel shows your CS and missed CS, and **T** draws each minion's target.

## Lane rules worth knowing

- The first wave spawns at 0:30 and the two waves meet in the middle about 25 seconds later.
- A tower shot removes 45% of a melee minion's max health and 70% of a caster's, so under your
  tower a melee minion takes two tower shots and then your last hit. Cannon minions take the
  tower's normal damage.
- A tower shot on a hero removes 18% of the hero's max health at level 1, ignoring armor. Each
  level above 1 reduces that by 3% (so about half as much at level 18), and each shot in a row
  on the same hero hits 40% harder.
- Heroes cannot walk through minions; a wave in the way has to be walked around. Blinks and
  dashes pass through.

## Play over the internet

The host runs the server, then exposes port 3000 one of these ways:

- **Tunnel (easiest, no router changes).** Install `cloudflared`, then run
  the command below. It prints a `https://….trycloudflare.com` address; send
  that to your friend and open it yourself too.

  ```bash
  cloudflared tunnel --url http://localhost:3000
  ```

- **Port forward.** Forward TCP port 3000 on your router to your machine and
  send your friend `http://<your public IP>:3000`.

Both players land in the same room. Add `?room=anything` to the address to use
a separate room.

## Controls

| Input | Action |
|---|---|
| Right-click | Move, or attack the enemy under the cursor (hold to keep moving) |
| A, then left-click | Attack-move (Shift + right-click also works) |
| S | Stop |
| Q W E R | Abilities, cast at the cursor. Kessa's Q charges while held and fires on release; her R is pressed again for each shot |
| Shift or Ctrl + Q/W/E/R, or click the icon | Spend a skill point |
| D / F | Blink / Mend (the lobby has a button to swap them; the choice is remembered) |
| B | Recall to base (8s, cancelled by damage or orders) |
| P | Shop (buy at base or while dead). Standing at base with it open, click an item in your bag to sell it for 80% of its price |
| Y / Space | Toggle camera lock / centre on your character |
| T | Show what each minion is targeting (practice aid) |

## Browser shortcuts

While a game is running the page cancels the browser's own shortcuts (refresh, find, save,
print, zoom, right-click menu, Alt menu, back/forward mouse buttons) and asks before the tab
is closed or reloaded. F11 and F12 are left alone.

A page is not allowed to cancel the shortcuts that close or switch tabs (Ctrl+W, Ctrl+T,
Ctrl+N, Ctrl+Tab) on its own. Use the **Fullscreen** button, or start the game (which goes
fullscreen for whoever presses Start): in Chrome and Edge that hands those keys to the game
too. Hold Esc to leave fullscreen. Firefox and Safari do not support this part.

## Layout

- `server.js` — web server and WebSocket rooms; runs the game at 30 ticks/s.
- `game/sim.js` — all game rules. The server is the only authority. The tunable numbers for the
  map, towers, minions, collision and the bot are at the top, in `MAP`, `RULES`, `WAVES` and `MINION`.
- `game/bot.js` — the practice bot. It plays through the same commands a player sends.
- `game/data.js` — characters, abilities, items. Tune numbers here.
  Kessa's kit shows the two shared building blocks: `g.strike` (telegraph, delay,
  resolve) and the ability state machine (`g.enter` / `g.leave`), both in `sim.js`.
  Each character is written to show a few techniques, with the shared helpers in `sim.js`:

  | Character | Shows |
  |---|---|
  | Kessa | Delayed strikes, charging, an ability state machine |
  | Gorrum | Forced movement, an empowered attack, an ability with a passive and an active mode |
  | Wren Ashby | Cooldown refunds, mark and detonate, stacking buffs |
  | Sable Venn | Objects in the world, chain targeting, an interruptible channel |
- `public/client.js` — networking, input, HUD and the frame loop.
- `public/gfx.js` — all art, drawn in code: characters, animations, particles, map.
- `public/icons.js` — ability, spell and item icons as inline SVG.
- `test/smoke.js` — rules check without a network: `npm test`.
