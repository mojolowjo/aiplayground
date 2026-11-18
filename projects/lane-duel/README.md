# Lane Duel

A 1v1 lane game for two players, played in the browser. One player runs the
server; both open a link. Original characters, standard lane-game mechanics:
click-to-move, attack windup and cancelling, skillshots, minion waves and last
hits, a tower with aggro, brush, recall, a shop.

First to 2 kills, 100 minions, or the enemy tower wins.

## Run it

Needs Node.js 20 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. With one player in the room, "Practice vs
dummy" starts a solo game against a stationary enemy.

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
| Q W E R | Abilities, cast at the cursor |
| Shift + Q/W/E/R, or click the icon | Spend a skill point |
| D / F | Blink / Mend |
| B | Recall to base (8s, cancelled by damage or orders) |
| P | Shop (buy at base or while dead) |
| Y / Space | Toggle camera lock / centre on your character |

## Layout

- `server.js` — web server and WebSocket rooms; runs the game at 30 ticks/s.
- `game/sim.js` — all game rules. The server is the only authority.
- `game/data.js` — characters, abilities, items. Tune numbers here.
- `public/` — the browser client (rendering and input only).
- `test/smoke.js` — rules check without a network: `npm test`.
