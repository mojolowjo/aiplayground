# Seedscout

A Forge 1.20.1 (47.4.2) mod that shows a multiplayer server's real ore positions through walls. The server
has anti-xray, so the ore data never comes from the server: the mod builds a local **scout server** from the
client's own mods and configs with the server's seed, asks it which blocks are ores around the player, and
draws line boxes at those positions. One jar does both halves: in the client it is the controller and the
overlay, on the scout server it is the chunk scanner. Everything is driven from in-game chat commands.

Personal tool for the MC Eternal 2 pack. Unrelated to the bot projects in this repository.

## Install

1. Drop `dist/seedscout-<version>.jar` into the pack instance's `mods` folder (the client).
2. Check `config/seedscout-client.toml` after the first start: `seed` is the server's seed
   (default `-3796965907673005514`), `ores` the blocks to find, `ram` the scout server heap (default `5G`).
3. The scout server lives in `<instance>/seedscout/server/`, the ore cache in `<instance>/seedscout/cache/`,
   logs in `<instance>/seedscout/logs/`. Delete the `seedscout` folder to start over.

Worldgen only matches when the scout server has the same worldgen mods and configs as the real server.
Setup copies `mods/` (minus client-only mods), `config/`, `defaultconfigs/`, `kubejs/`, `global_packs/`,
`openloader/` and `scripts/` from the instance, and `defaultconfigs/*` into `world/serverconfig/`.

## Commands

| Command | What it does |
|---|---|
| `/seedscout setup` | One-time, in the background, progress in chat: shows the EULA link, downloads `forge-1.20.1-47.4.2-installer.jar` from maven.minecraftforge.net, runs it with the client's own Java (`--installServer`), copies mods and configs, writes `server.properties` (seed, 127.0.0.1, a free port, offline, view-distance 3, simulation-distance 2, 1 player, rcon and query off). Stops before any server start until the EULA is accepted. |
| `/seedscout setup accept-eula` | Writes `eula=true` (you accept https://aka.ms/MinecraftEULA) and runs the rest: test starts of the server, up to 15 tries. Each crash is traced to a jar (`Mod File:` lines, mod ids, "invalid dist DEDICATED_SERVER" and `NoClassDefFoundError` classes looked up in the jars); that jar is excluded, written to `seedscout/excluded-mods.txt`, and the start is retried. Setup can be run again any time, it skips what is done and re-syncs the mods. |
| `/seedscout start` | Starts the scout server (`-Xmx<ram>`, `-Dseedscout.scout=true`, the installer's args file, `nogui`), waits for its socket and connects. |
| `/seedscout stop` | Stops it (socket shutdown, console `stop`, then force). The server is also stopped when the game closes. |
| `/seedscout status` | Seed and expected hash, overlay state, boxes drawn, install and process state, connection and cache counts. |
| `/seedscout hash` | The configured seed's hash, the hash the server you are on sent, and the scout world's hash. |
| `/seedscout range <n>` | Chunks around the player to request and draw (default 4). |
| `/seedscout ores add <id>` / `remove <id>` / `list` | The block list; ids or `#tags` (quote them: `"#forge:ores"`). Chunks are rescanned for a changed list. |
| `/seedscout color <id> <RRGGBB>` | Box color of an ore. |
| `/seedscout ram <size>` | Scout server heap, like `5G` or `6144M`, for the next start. |
| `/seedscout seed <seed>` | Change the seed (then delete `seedscout/server/world` and run setup again). |
| `/seedscout autostart true|false` | Start the scout server when joining a multiplayer server. |
| `/seedscout toggle` or the **X** key | Overlay on or off. |

Defaults: `#forge:ores`, `irons_spellbooks:mithril_ore`, `irons_spellbooks:deepslate_mithril_ore`,
`tinkers_advanced:bismuthinite_ore`, `minecraft:ancient_debris`. Dimensions map by id, so the Dwarven Depths
(`mce:dwarven_depths`) work as long as the scout server has the dimension.

## How it works

- **Scout server** (`ScoutServer`): a dedicated Forge server started with `-Dseedscout.scout=true` opens a
  localhost TCP socket with a random token and writes port and token to `seedscout-endpoint.json` in its
  folder. JSON lines: `scan {dim, q, chunks:[[x,z]], blocks:[ids or #tags]}` answers one line per chunk
  `{dim, q, x, z, ores:[[x,y,z,id]]}`; `hash` answers `BiomeManager.obfuscateSeed(seed)`; `shutdown` stops
  it. Chunks are generated with `getChunkFuture(x, z, FULL, true)`, 8 in flight, held by a ticket until
  scanned and released after. Sections whose palette has none of the wanted blocks are skipped. Every level
  has `noSave` set; mob spawning, weather, daylight, fire and random ticks are off. Tags resolve on the scout.
- **Client**: every half second it asks for the uncached chunks within range, nearest first. Only ore
  positions are cached, per seed and dimension, in `seedscout/cache/<seed>/<dim>.bin` (gzip, one byte for
  x/z in the chunk, a short for y, a short id index). Boxes are drawn in `RenderLevelStageEvent`
  `AFTER_TRANSLUCENT_BLOCKS` with a lines render type whose depth test is off. An ore whose block on the
  client is air or a fluid is not drawn (it was mined). On connect the scout's hash is compared with the
  configured seed's hash and with the hash the real server sent; a mismatch is a chat warning.

Known limits: with a shader pack (Oculus) the line overlay may not show; the scout server needs the pack's
dimension mods to answer for modded dimensions; the first world generation on `setup` and the first chunks
after `start` take a while on 600 mods.

## Testing

What the owner tests on the gaming PC (Prism Launcher, Bazzite):

1. **The game launches with the mod.** `latest.log` has `[seedscout] client loaded`.
2. **Setup and start work.** `/seedscout setup`, then `/seedscout setup accept-eula`; chat ends with "the scout
   server started and stopped cleanly". `/seedscout start`, then "connected to the scout server". Check the
   client-only list in `seedscout/excluded-mods.txt` after setup.
3. **The hash check matches.** `/seedscout hash`: all three values are `-8161242814662636247` while on the
   server; the connect line says "hash check ok".
4. **Cave test.** In an open cave on the real server, ores you can see get boxes on exactly those blocks, in
   the ore's color. Mine one: its box disappears.

On this laptop: `gradlew test build` runs the pure-Java unit tests (seed hash against the expected value,
cache format round trip, protocol round trip, client-only mod detection and crash diagnosis, server files).
No game is launched here.

## Building

Needs JDK 17. From this folder, in PowerShell:

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-17.0.1'; .\gradlew.bat test build
```

The jar lands in `build/libs/`; the released copy is in `dist/`.

## Status

0.1.2: the second run (2026-11-05) got past the dependencies and crashed on nine mods loading client classes. One failed start now excludes every such mod at once, and when a section's stack trace names another mod's jar (Framework failing through Controllable) that jar goes instead. Still open: Create fails on PoseStack with no other jar named; the server's debug.log should show which mixin does it.

0.1.1: the first run on the owner's PC (2026-11-05) got through download, install and the mod copy, then
failed all 15 test starts. Two causes, both fixed: the name filter matched "iris" inside Vampirism, and the
retry blamed the first jar in the crash report, which for "mod X requires Y" errors is the innocent
requester, so each round removed a good mod (geckolib, resourcefullib, architectury among them). Now names
match at word starts only, and a failed start is repaired from Forge's dependency lines: a dependency the
client has but the server lacks is copied back, a mod that needs a client-only mod (colorwheel needs
Oculus) goes out, and crash-report blame is used only for client-class errors. An exclusion list from 0.1.0
is set aside as `excluded-mods.old.txt` on the next setup.
0.1.0: builds, unit tests pass, not yet run in a game.
