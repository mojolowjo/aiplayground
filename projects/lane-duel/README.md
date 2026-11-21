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
Damaging an enemy within 10 seconds of its death counts as an assist: the assisters share half
the kill's gold (150 at most between them) and each get half the XP.

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
- **A bot (easy / normal / hard)** plays the lane: it last-hits minions, trades when you walk
  up, backs off below 35% health and recalls when safe, and uses its whole kit with a plan for
  each character (for example Gorrum only hooks with a clear line and follows up with his
  knock-up; Kessa charges her beam until you are inside its reach; Sable goes all in when a combo
  should kill). Difficulty changes how accurately it last-hits, how quickly it reacts, how well it
  aims, how often it commits and how long it waits between abilities. On hard it also sidesteps
  skillshots and telegraphed areas it can see coming.
  It follows the same rules as a player: cooldowns, mana and vision. It only acts on what is
  drawn on your screen too, never on your cooldowns, mana or orders, and never on a hero hidden
  in brush.

The stats panel shows your CS and missed CS, and **T** draws each minion's target.

## Lane rules worth knowing

- The first wave spawns at 0:30 and the two waves meet in the middle about 25 seconds later.
- A tower shot removes 45% of a melee minion's max health, 70% of a caster's and 14% of a
  cannon's, so under your tower a melee minion takes two tower shots and then your last hit.
- A tower shot on a hero deals flat physical damage: 180 at the start of the game, rising to 350
  by 25:00. Each shot in a row on heroes hits 40% harder (up to +120%); the tower cools off 3
  seconds after it last hit a hero.
- Outer towers have 5000 health in five plates; breaking a plate pays 120 gold to the hero who
  broke it. Inner towers have 4000 health. A tower with no attacking minions near it takes only
  20% damage.
- Attack ranges are measured edge to edge, for heroes, minions and towers.
- Passive gold (2.04 a second) starts at 1:05. The first kill of the game pays 100 extra.
- Sable Venn has no mana; her abilities cost nothing.
- Heroes cannot walk through minions, and nothing is ever shoved by a bump. A hero walking into a
  wave is steered around it and may lose a little time; a hero standing still is never moved, the
  minions walk around it. Blinks and dashes pass through, and a hero that lands on top of minions
  is set down on the nearest free spot. First-wave minions and heroes pass through each other
  until the two waves have met.

## Items

Items come in three tiers that build into each other: cheap **parts** with one stat, **mid items**
made from one or two parts plus a fee, and **finished items** made from two or three of those,
with bigger stats and usually a passive effect. There are also upgraded boots (one pair at a
time), starter items for the first few minutes (one at a time), and potions and a refillable
flask that you carry and drink yourself.

- **Buying uses what you own.** The price of an item is its total price minus the full price of
  every part of it already in your bag, at any depth. Those parts are used up, so the purchase
  fits even in a full bag. Missing parts are bought along with it.
- **Recommended tab.** Each character has a build laid out left to right; the next step you
  don't have is highlighted.
- **Undo** takes back buys and sells, newest first, until you leave base, deal or take damage,
  cast an ability, drink something or die.
- **New stats:** ability haste (shorter ability cooldowns), crit chance (basic attacks only,
  dealt from a shuffled deck so 25% is exactly 5 crits in every 20 attacks), lifesteal, armor
  pen, magic pen, tenacity (shorter stuns, roots, silences and slows) and healing received.

All item data is in `ITEMS` in `game/data.js`.

## Play over the internet

### Host from home (the usual way)

Run the server on your own PC and friends connect straight to it. No account, no tunnel.

```bash
npm start
```

On start the server asks your router, over UPnP, to forward TCP port 3000 to this PC, and prints
the address to give your friends:

```
Lane Duel running: http://localhost:3000
UPnP: router now forwards TCP port 3000 to this PC (192.168.1.20), lease 60 min, renewed automatically.
Public address: 203.0.113.7 (from your router).
Friends join at: http://203.0.113.7:3000
```

You open http://localhost:3000 yourself. The lobby shows the same join address with a Copy
button, to you only (whoever is on the PC running the server).

- The port mapping is named "Lane Duel", has a one-hour lease that is renewed every half hour
  while the server runs, and is removed when you stop the server with Ctrl+C.
- The public address comes from the router. If the router opens the port but will not say what
  its address is (it is asked twice, and its replies are printed), the server asks
  https://api.ipify.org instead and says so. If that fails too, it tells you the port is open and
  to look the address up yourself.
- If UPnP does not work (no router answered, or it refused), the server keeps running, prints a
  warning and tells you the game is only reachable on your local network. Use the tunnel below.
- If something about UPnP looks wrong, start with `UPNP_DEBUG=1`: every request to the router and
  every raw reply is printed.
- If your router's own address is not a public one (it sits behind another router, or your
  provider shares one address between customers), the server says so. A port mapping cannot fix
  that; use the tunnel.
- Your PC's firewall may ask whether to allow Node.js to accept connections. It has to be allowed.

Settings are environment variables:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the game listens on, and the port opened on the router |
| `UPNP` | `on` | `off` leaves the router alone (forward the port yourself) |
| `UPNP_DEBUG` | not set | `1` prints every UPnP request and the router's raw replies |
| `DUCKDNS_DOMAIN` | not set | A [DuckDNS](https://www.duckdns.org) name, e.g. `mygame`. The join address becomes `http://mygame.duckdns.org:3000` |
| `DUCKDNS_TOKEN` | not set | With the domain: the name is pointed at your network on start and every 5 minutes, so it follows your IP if it changes. The token is never printed |

For example, on Linux or macOS:

```bash
DUCKDNS_DOMAIN=mygame DUCKDNS_TOKEN=your-token npm start
```

On Windows (PowerShell):

```bash
$env:DUCKDNS_DOMAIN="mygame"; $env:DUCKDNS_TOKEN="your-token"; npm start
```

### Fallback: a tunnel

For networks where UPnP does not work. Install `cloudflared`, start the game with `UPNP=off`,
then run the command below. It prints a `https://….trycloudflare.com` address; send that to your
friends and open it yourself too.

```bash
cloudflared tunnel --url http://localhost:3000
```

### Rooms and limits

Everyone lands in the same room. Add `?room=anything` to the address to use a separate room.

Because the server is reachable from the internet, it limits what one visitor can do: messages
over 2 KB close the connection, as does sending more than 60 messages a second (after a burst of
120); one address can hold 8 connections; there can be 50 rooms. Malformed messages are ignored.
Only the files in `public/` and `shared/` are served. The limits are in `net/guard.js`.

## Controls

| Input | Action |
|---|---|
| Right-click | Move, or attack the enemy under the cursor (hold to keep moving). Your character never attacks on its own: it only attacks what you click, or what it meets on an attack-move |
| A, then left-click | Attack-move (Shift + right-click also works) |
| S | Stop |
| Q W E R | Abilities, cast at the cursor. Kessa's Q charges while held and fires on release; her R is pressed again for each shot |
| Shift or Ctrl + Q/W/E/R, or click the icon | Spend a skill point |
| D / F | Blink / Mend (the lobby has a button to swap them; the choice is remembered) |
| B | Recall to base (8s, cancelled by damage or orders) |
| P | Shop. Buying works at base or while dead: left-click an item to see it, right-click to buy it. Standing at base with the shop open, click an item in your bag to sell it for 70% |
| Ctrl+Z (shop open) | Undo the last buy or sell |
| 1–6 | Drink the potion or flask in that bag slot |
| Y / Space | Toggle camera lock / centre on your character |
| Esc | Close the shop or cancel an attack-move; otherwise open **Settings** (also the ⚙ button, bottom left) |
| T | Show what each minion is targeting (practice aid) |
| F8 | Debug: show where the server has your hero, next to where your screen predicts it |

## Browser shortcuts

While a game is running the page cancels the browser's own shortcuts (refresh, find, save,
print, zoom, right-click menu, Alt menu, back/forward mouse buttons) and asks before the tab
is closed or reloaded. F11 and F12 are left alone.

A page is not allowed to cancel the shortcuts that close or switch tabs (Ctrl+W, Ctrl+T,
Ctrl+N, Ctrl+Tab) on its own. Use the **Fullscreen** button, or start the game (which goes
fullscreen for whoever presses Start): in Chrome and Edge that hands those keys to the game
too. Hold Esc to leave fullscreen. Firefox and Safari do not support this part.

## Settings

Press **Esc** (with the shop closed and nothing being aimed) or the **⚙ Settings** button. In a browser
there are two, remembered by that browser:

- **Smoothing** (30 / 45 / 60 / 90 / 120 ms, default 60): how far behind the server other units are
  drawn. Lower feels snappier but can stutter on a bad connection. Higher is smoother but shows other
  units slightly later.
- **Performance overlay**: FPS, ping and jitter (how unevenly the server's updates arrive) in a corner.

The desktop app adds performance settings; see below.

## Desktop app

An optional way to play: one file for Windows or Linux that opens the game in its own window, with a
server list and performance settings. It does not contain the game. It loads it from the server you
pick, exactly like a browser, so it does not need updating when the game changes. The browser version
keeps working as before.

### For players

1. **Download** with the **Download for Windows** or **Download for Linux** link in the game's lobby, or from
   [the releases page](https://github.com/mojolowjo/aiplayground/releases?q=lane-duel):
   `LaneDuel-<version>.exe` for Windows, `LaneDuel-<version>.AppImage` for Linux. Put it in a folder of
   its own (the Desktop is fine).
2. **Run it.**
   - **Windows:** double-click. The first time, Windows shows a blue "Windows protected your PC" box,
     because the app is not signed (signing costs money every year). Click **More info**, then
     **Run anyway**.
   - **Linux:** right-click the file → **Properties** → tick **Allow executing as program** (or
     `chmod +x LaneDuel-*.AppImage`), then double-click. If nothing happens, your system is missing
     FUSE; run it from a terminal with `--appimage-extract-and-run` added.
3. **Pick a server** and press **Connect** (or double-click it). The list shows each server's ping, or
   "offline" if it does not answer.

**Adding a server.** Type what the host sent you into the box under the list and press **Add server**.
`1.2.3.4`, `1.2.3.4:3000`, `my-name.duckdns.org` and `http://1.2.3.4:3000` all work; port 3000 is
assumed if you leave it out. Servers you added can be renamed or removed. The main server can only be
hidden.

**Settings** (start screen, the ⚙ button in a game, or Esc):

| Setting | What it does |
|---|---|
| FPS limit | 30 / 60 / 120 / 144 / 240 / 500, or your monitor's refresh rate (the default). Going above your monitor's rate needs V-Sync off (and a restart). With V-Sync on, a limit that does not divide evenly into the monitor's rate comes out uneven |
| V-Sync | On by default. Off lets the game draw faster than the monitor (and can tear). Needs a restart |
| Render scale | 50–100%. Draws the battlefield with fewer pixels and stretches it; health bars, damage numbers and the HUD stay sharp. The biggest help on a slow PC |
| Effects quality | Low: no particles, no glow, no screen shake, at most 10 damage numbers. Medium: half the particles, glow on abilities only. High: everything |
| Window mode | Windowed, borderless fullscreen or fullscreen. Both fullscreen modes are borderless windows that cover the screen (the app cannot take the screen over exclusively the way some games do); "Fullscreen" uses the system's kiosk mode |
| Hardware acceleration | On by default. Turn off only if the picture is wrong. Needs a restart |
| Smoothing, Performance overlay | As in the browser |

When a setting needs a restart, a **Restart to apply** button appears.

**Deleting everything.** The app keeps its settings and server list in a folder called `LaneDuel-data`
next to the file you downloaded, and nowhere else. To remove the app completely, delete the file and
that folder. (If the folder could not be created there, for example on a read-only drive, the app uses
your normal user folder instead and Settings shows where.) While it runs, the Windows build unpacks
itself into your temporary folder and removes that copy when it closes.

The app never downloads updates. If a newer version exists, the start screen shows a link to it.

### For the owner

- **Default server.** The first row of everyone's list comes from `desktop/default-server.json`:
  `{ "name": "Main server", "address": "http://73.157.4.152:3000" }`. Change it there and make a new
  release. A home connection's address can change; a DuckDNS name (above) does not.
- **Making a release.** Push a tag named `lane-duel-vX.Y.Z`:

  ```bash
  git tag lane-duel-v1.0.0
  ```

  ```bash
  git push origin lane-duel-v1.0.0
  ```

  GitHub Actions (`.github/workflows/lane-duel-desktop.yml`) then builds the `.exe` on Windows and the
  `.AppImage` on Linux, with the version taken from the tag, and publishes both in a GitHub Release.
  The lobby's **Download for Windows** and **Download for Linux** links find the newest release by
  themselves and download its file directly, and the app's own update check looks at the same releases.
  The tag must be on a commit that contains the workflow file.
- **Trying it without a build:** `cd desktop`, `npm install`, `npm start`.
- **Building by hand:** `npm run build:linux` or `npm run build:win` in `desktop/` (output in
  `desktop/dist/`).
- **What the window may do.** Pages run with no Node access (`contextIsolation`, `sandbox`). They get
  six functions on `window.laneDuelApp` (`getSettings`, `setSettings`, `restartApp`, `setFullscreen`,
  `openExternal`, `backToStart`). The window only navigates to the start screen and the server picked
  there; any other link opens in the system browser. A server's page can change performance settings
  but cannot read or change the server list.

## Layout

- `server.js` — web server and WebSocket rooms; runs the game at 30 ticks/s. `GET /ping` answers 204 (the app's server list times it).
- `net/upnp.js` — asks the router to forward the port (SSDP search, then SOAP calls). No dependencies.
- `net/duckdns.js` — the optional DuckDNS updater.
- `net/guard.js` — connection and message limits, and the list of files the web server may hand out.
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
- `shared/move.js` — walking and unit collision: one step function that both the server and the
  browser's movement prediction call, so they always agree.
- `shared/shop.js` — shop rules (what a purchase costs and uses up) used by both the server and the
  browser, so the price you are shown is the price you are charged.
- `public/client.js` — networking, input, HUD and the frame loop.
- `public/shop.js` — the shop screen and the bag.
- `public/predict.js` — moves your own hero on your screen the moment you click, with the same
  step function as the server (`shared/move.js`), then reconciles with each snapshot. Only movement is predicted; the server stays
  the authority on everything.
- `public/gfx.js` — all art, drawn in code: characters, animations, particles, map.
- `public/icons.js` — ability, spell and item icons as inline SVG.
- `test/smoke.js` — rules check without a network.
- `test/net.js` — hosting checks: the limits, the UPnP client against a stand-in router, and the real
  server started on a spare port. `npm test` runs both; nothing leaves your machine.
- `public/settings-menu.js` — player settings and the menu that edits them (browser and desktop app).
- `desktop/` — the desktop app (Electron): `main.js` (window, data folder, navigation rules),
  `lib.js` (the same decisions as plain functions, for the test), `preload.js` (the six functions a page
  gets), `start/` (the server list), `default-server.json`, `test/desktop.test.js`.
