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

The bot is saved to `carbon\data\AiBot.json` on every server save and on plugin unload, and comes
back at the same spot after a restart or hot reload. If it dies it leaves a normal corpse and is
gone until the next spawn.

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

## Vanilla AI

`config\server.cfg` turns off wildlife, scientist spawners, Bradley and events. A few built-in
NPCs remain. `ai.think` and `ai.npc_enable` stay on so they can't interfere with custom bots.
