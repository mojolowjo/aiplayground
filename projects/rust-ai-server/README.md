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

## Vanilla AI

`config\server.cfg` turns off wildlife, scientist spawners, Bradley and events. A few built-in
NPCs remain. `ai.think` and `ai.npc_enable` stay on so they can't interfere with custom bots.
