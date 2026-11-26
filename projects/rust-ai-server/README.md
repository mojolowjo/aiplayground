# rust-ai-server

A private Rust (Facepunch) test server running Carbon, for developing player-like AI.
This folder holds config, scripts and plugins. Server files, saves and logs live in
`C:\Users\mojol\Documents\Game Servers\ai rust server` and stay out of git.

## Scripts (run from `scripts\`)

If Windows blocks them, start with `powershell -ExecutionPolicy Bypass -File .\start.ps1`.

| Script | Does |
|---|---|
| `update.ps1` | Installs or updates SteamCMD, Rust and Carbon. Stop the server first. |
| `start.ps1` | Copies config and plugins, then starts the server. |
| `rcon.ps1 "status"` | Sends one console command. `rcon.ps1 "quit"` saves and stops. |
| `deploy-plugins.ps1 [-Watch]` | Copies `plugins\*.cs` into `carbon\plugins`. Carbon hot-reloads them. |
| `upnp.ps1 [-Add] [-Remove] [-Renew]` | Shows router mappings. Changes them only with a switch. |

Change map size, seed, ports or name in `settings.ps1`, or override them in
`settings.local.ps1` (ignored by git).

## Whitelist

`AiTestWhitelist` lets in only listed Steam IDs (SteamID64). An empty list lets nobody in.
If the plugin is unloaded or fails to compile, the server is open, so check `c.plugins`.

    .\rcon.ps1 "wl.add 7656119XXXXXXXXXX"
    .\rcon.ps1 "wl.list"
    .\rcon.ps1 "ownerid 7656119XXXXXXXXXX m0j"
    .\rcon.ps1 "server.writecfg"

`ownerid` makes that account admin, which spectating needs.

## Ports

| Port | Protocol | Forward? |
|---|---|---|
| 28015 | UDP | Yes, game traffic |
| 28017 | UDP | Only to appear in the server browser |
| 28016 | TCP | Never. RCON listens on 127.0.0.1 only |

Rust+ (`app.port`) is off. The RCON password is generated into `rcon-password.txt` in the
server folder.

The router here offers no port forwarding, so the mapping uses UPnP. It has a 24 hour lease, and
start.ps1 re-adds it every hour while the server runs (see upnp.log in the server folder).
After the server stops, the mapping stays until the lease ends, or until upnp.ps1 -Remove.

Windows Firewall needs an inbound allow rule for RustDedicated.exe on Private networks.

## AiBot (player-like bot)

`plugins\AiBot.cs` runs one bot that looks like a player and wanders the map. Admin only.

| Chat | Console / RCON | Does |
|---|---|---|
| `/bot spawn` | `aibot.spawn` | New bot, 4 m in front of you, standing still. From RCON it appears at a random spawn point and roams. |
| `/bot info` | `aibot.info` | Name, position, health, gear, what it is doing, and counters since spawn. |
| `/bot roam` / `/bot stop` | `aibot.roam` / `aibot.stop` | Start or stop wandering. |
| `/bot here` | | Moves it in front of you and stops it. |
| `/bot kill` | `aibot.kill` | Removes it. |
| `/bot chop` | `aibot.chop` | Walks to the nearest tree (or wood pile) and chops it down with the hatchet. |
| `/bot mine` | `aibot.mine` | Walks to the nearest ore node and mines it out with the pickaxe. |
| `/bot barrel` | `aibot.barrel` | Breaks the nearest barrel and picks up what drops. |
| `/bot loot` | `aibot.loot` | Opens the nearest unlocked crate and takes everything. |
| `/bot inv` | `aibot.inv` | Lists belt, main inventory and clothing, with amounts and tool condition. |

The bot is saved to `carbon\data\AiBot.json` on every server save and on plugin unload, and comes
back at the same spot with the same inventory after a restart or hot reload. If it dies it leaves
a normal corpse with its items and respawns 30 s later at a random spawn point with fresh gear.
`/bot kill` removes it for good.

### Actions

Actions run only when you give the command; the bot makes no decisions of its own yet. It looks
within 120 m, tries the 8 nearest targets until one has a walkable path, walks there (the last
few metres straight, since the navmesh stops short of trees and rocks), then works it. When it
finishes, the admin who asked gets a chat line with what it gained, and it goes back to roaming
if it was roaming. `/bot stop`, `roam`, `here` or `kill` cancel an action.

Everything goes through the game's own code, so it behaves as it does for a player:

- Swings: picks the best tool on the belt for the target, switches to it, turns its head to aim
  (at the tree's X marker or the ore's bonus spot when there is one), plays the attack animation
  and swing sound, and 0.3 s later traces the hit from its eyes along its view, within the tool's
  reach. Whatever is first in the way gets hit, including a player standing in front of it. A
  player's client does that trace; the bot uses the game's own server-side melee trace
  (`BaseMelee.ServerUse_Strike`, used by its AI), which also keeps it inside the server's
  anti-cheat rules for distance and line of sight. The hit then goes to the tool's own attack
  code (`BaseMelee.DoAttackShared`): damage, gathering, tool wear, impact effects. The swing rate
  is the tool's own cooldown. After two misses it steps 0.6 m closer; after eight it gives up.
- Crates, dropped bags and pickups: a player's client sends the server short messages (RPCs)
  such as "open this" or "pick this up". The bot calls the same server handlers with itself as
  the sender (`StorageContainer.RPC_OpenLoot`, `WorldItem.Pickup`), after the same rule the server
  checks first (within 3 m and in plain sight). Taking an item repeats the steps of the "move
  item" handler (`PlayerInventory.MoveItem`) for a quick-move into its own inventory, including
  its refusals, because that handler reads its arguments from network bytes the bot can't send.
  It takes one item every 0.35 s, then closes the loot, which is what makes an empty crate
  despawn.

Gathering sends the "+wood" popup as a client command; for a bot the game runs that on the
server, so the plugin registers an empty `note.inv` command to keep it out of the log.

Each name owns one bot ID (Dusty 9000001, Marlow 9000002, Kestrel 9000003, and so on), so a bot
keeps its name, face and body through deaths and restarts. The game gives its own bots IDs
counting up from 1 and reuses freed ones; the plugin keeps the 9000001+ range out of that reuse
pool. Add new names at the end of the list only.

### Which body

| Body | Verdict |
|---|---|
| `ScientistNPC2` (Gen2, most vanilla NPCs now) | Not a player. It derives from `BaseNPC2 : BaseCombatEntity`, so it has no inventory, clothing slots, held item or player name. It can't be made to look like a player. |
| `HumanNPC` / `ScientistNPC` (legacy) | A player body, but it's the AI generation Facepunch is replacing; scientists already moved to Gen2. |
| Plain `BasePlayer`, no connection | **Chosen.** The real player prefab. It is the same class real players use, so it won't be phased out. The game treats it as a bot (`BasePlayer.bots`, user id below 10,000,000). |

A `BasePlayer` has no navigator, so the plugin moves it: it asks the game's own Gen2 navmesh for a
path (`RustNavMeshHelpers.CalculatePath`, the same one NPC2 uses), then walks the corners,
snapping to the ground each step. Checked against Rust 2636.

### Roaming

Picks a spot 30 to 100 m away, mostly keeping its heading, walks or runs there, pauses, looks
around, repeats. Paths that cross water deeper than 0.4 m are refused. If it moves less than
0.6 m in 3 s it re-paths, then picks a new spot, then hops a few metres to the nearest walkable
spot. The hop is a short teleport, so a bot boxed in by walls will hop out through them.

### Movement checks (the server's tick process, rebuilt)

A real player's client sends the server a tick with each new position, and the server checks it
before accepting it. The server only does that for connected players, so it never runs for a
bot. `TickGuard` in `AiBot.cs` rebuilds that step, and every move the bot makes goes through it:

1. Tick jump: one move may not be longer than `antihack.tick_max_distance`
   (`BasePlayer.UpdatePositionFromTick`). Refused moves reset the history, as the server does.
2. No-clip: the game's own `AntiHack.TestNoClipping`, with the same offset and radius.
3. Speed: the maths of the server's speed-check jobs (`AntiHackJobs.*`) copied step for step:
   2.8 m/s walking, 5.5 running, 1.7 crouched, less with heavy clothing, a downhill allowance,
   and the same forgiveness budget.
4. Fly: the same ground test under the feet and the same limits while in the air.
5. Inside terrain or rocks: the game's own `AntiHack.TestInsideTerrain` / `IsInsideMesh`.

All limits come from the server's `antihack.*` settings. A failed check adds violation points
and, where that check is set to reject, the move doesn't happen. Past `antihack.maxviolation` a
player would be kicked; the bot stops moving until `/bot roam`. `/bot info` shows the counts.
A hop when stuck is checked like any other move, so it's refused unless it is tiny.
`/bot unstuck` is an admin teleport out of a rock or wall, like the game's own teleport. Matches
Rust 2636: after a game update, compare it with the server's `AntiHack` code again.

Tested: a deliberate 9 m/s run had 545 moves refused for speed; normal roaming had 1 flag in
953 moves (a hop through a tree, correctly refused).

## Roadmap

- Movement option C: a client-style movement simulator (collide and slide, step up, gravity and
  fall damage, jumping, crouching, swimming), sending its moves through `TickGuard`.
- Keep the "brain" (decisions) behind a clean interface, separate from the "body" (movement,
  actions). The goal is a bot that looks like a player, not a smart one, using our own simple
  AI, not a downloaded LLM.
- Multi-bot stage: try a companion process on the GPU that batches every bot's brain and
  learned-movement work, while the server CPU keeps doing game, physics and anti-cheat. The
  brain/body split is what makes that possible.

## Vanilla AI

`config\server.cfg` turns off wildlife, scientist spawners, Bradley and events. A few built-in
NPCs remain. `ai.think` and `ai.npc_enable` stay on so they can't interfere with custom bots.
