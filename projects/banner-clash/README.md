# Banner Clash

A private, retro-style lane card battler for the browser (desktop and phone, portrait). Two players each
have two Watchtowers and a Keep, play cards from a hand of 4 with Spark that refills over time, and win by
knocking down more towers in 3 minutes. The game systems follow the genre; every name, card, number and
sprite here is original.

Bot matches run entirely in your browser. The small Node server only serves the page and referees friend 1v1s.

## Run it

Needs Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. The terminal prints the address to send friends.

## What is in this first version

- **Battle:** the 18 x 32 arena with a river and two bridges, 3:00 matches with Double Spark in the last
  minute, overtime with sudden death, tower-health tiebreak, 0.5 s deploy time, Keep activation, growing
  deploy zone after a Watchtower falls, spells at 35% against towers.
- **All 24 cards** from the battle design doc, plus Cogs from the Clockwork Golem and The Archivist's
  archived Marksman Trio. Every special is in: shields, charges, splash, chain lightning, knockback,
  harpoon pull, stealth, auras, slowing puddles, roots, splitting, rolling over small units, spawners.
- **Bots:** one shared brain with five skill tiers (reaction delay, play rate, placement wobble, mistakes,
  Spark counting, card memory) and the ten rivals from the bot design doc, each with a signature core,
  combo plans, lane habits, taunts and hint bubbles for Pip. Rivals remember your favourite lane and opener;
  AI Assimilation builds its deck from the cards you play most.
- **Progression:** Coins, Glory and Keys after every match; only wins move you up the 10 arenas; a Glory
  floor per arena; pick 1 of 3 new cards every 15 Keys (with a "Try it" practice match); Coin upgrades to
  level 9 with rarity pricing and the half-price catch-up discount; eased bots after 3 losses in a row;
  emotes per arena; rival records and habit hints. Your save lives in the browser (Setup → Export/Import).
- **Friend 1v1:** rooms, a lobby with all the match settings from the progression doc except Series,
  Draft and Ban, optional bets, Extend on a tie, seats held for 60 s on a disconnect.

Not yet: card backs for maxed cards, match series, draft and ban decks, profile codes that back your save up
on the laptop, HTTPS for installing to a phone home screen, bot balance tuning (higher tiers currently beat
the tier below only a little more than half the time; the design asks for about 70%).

## Playing with friends

Online play uses the lowest-ping setup from the online plan: friends connect straight to your laptop, with
no tunnel in between.

1. Run `npm start`. The server asks your router to forward the port with UPnP and prints
   `Friends join at: http://<your public address>:3000`.
2. Windows will ask whether Node.js may use the network the first time. Allow it on private and public networks.
3. Open the game, go to **Friends**, pick a room name and join. As the host you see a link with a Copy button.
   Send it to a friend; they open it and land in the same room.
4. Both press **Ready**. The host picks the match settings.

Tips for the lowest ping: plug the laptop into the router with a cable, and keep it from sleeping while you host.

Settings (environment variables):

| Variable | What it does | Default |
| --- | --- | --- |
| `PORT` | Port to listen on and to open on the router | 3000 |
| `UPNP` | `off` if you forward the port by hand in the router instead | on |
| `DUCKDNS_DOMAIN`, `DUCKDNS_TOKEN` | Keep one DuckDNS name pointed at your home, so the link stays the same | off |
| `UPNP_DEBUG` | `1` prints every UPnP request and reply | off |

On Windows PowerShell: `$env:UPNP="off"; npm start`.

### If friends cannot connect

- The server prints a warning if your router's own address is not public (CGNAT). Then a direct connection
  cannot work; use Tailscale (low added ping, everyone installs it once) or a Cloudflare Tunnel.
- If the server says no UPnP router answered, set `UPNP_GATEWAY` to the router's description URL (run once with `UPNP_DEBUG=1`, or look in the router's UPnP page).
- Some routers keep a mapping for up to a day if the server is killed instead of stopped. Stop it with Ctrl+C or by closing its window.
- If UPnP fails, forward TCP port 3000 to the laptop in your router's settings and run with `UPNP=off`.

## How online play works

Both browsers run the same deterministic battle (integer maths, one seeded random generator), so only card
plays travel over the network. A play is sent for a tick slightly in the future (half your ping plus a tick);
the server checks it and sends it to both players; the 0.5 s deploy time hides the wait. If a play arrives
late, the browser rewinds a few ticks and replays. Every second the server sends a checksum, and a browser that
has drifted asks for the full state. The server runs the battle too and is the only one that decides the winner.

Bets are settled by the server, but Coins are kept in each browser, so a friend who edits their save could
cheat. That seemed fine for a private game.

## Code

| Path | What |
| --- | --- |
| `shared/cards.js` | Cards, towers, arena: every number from the battle design doc |
| `shared/sim.js` | The deterministic battle simulation, used by browsers and server |
| `shared/bot.js` | Bot brain, skill tiers, rivals, deck building |
| `shared/progress.js` | Rewards, arenas, unlocks, upgrades (all pacing numbers in `PROG`) |
| `public/` | The browser game: menus, renderer, pixel sprites, sounds, online client |
| `server.js` | Web server and friend rooms |
| `net/` | UPnP, DuckDNS, public IP and abuse limits, from Lane Duel |

`npm test` runs the simulation, bot, progression and server tests.

Add `?demo=1` to the address to watch two bots play each other (for testing), and turn on
**Setup → Bot debug overlay** to see what the bot is thinking.
