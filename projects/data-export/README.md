# Data Export

A **client-side** Forge mod for Minecraft 1.20.1 (Forge 47.4.2). One command writes everything
the client knows about the pack's game data to a folder, so you can zip it and hand it to an AI
and ask "how do I get X in this pack?". Nothing is installed on the server.

Personal tool, unrelated to the bot projects in this repository.

## Use

1. Drop `dist/dataexport-<version>.jar` into the pack's `mods` folder (client only).
2. Join the server, or open the singleplayer world.
3. Type `/dataexport` in chat. Optional: `/dataexport <name>` to pick the folder name.
4. The folder is `<game dir>/dataexport/<world or server name>/`. Zip it, give it to the AI.

The game pauses a few seconds while it writes (large packs: longer). Chat then says what was
written and how many entries could not be read.

## What it exports

The client receives the finished game data from the server on join, with every KubeJS server
script change (recipe edits, removals, tag changes) already applied. The mod reads that copy, plus
the JSON inside the pack's jars, and writes:

| File | Contents | Source |
|---|---|---|
| `meta.json` | Minecraft and Forge versions, every loaded mod (id, name, version) | the mod list |
| `INDEX.txt` | one line per item: how it is made, how often it is used, which loot tables drop it, block or not, tag count | built from the rest |
| `recipes.json` | every recipe: type, station, inputs (items or tags), result and count, cooking xp and time; modded types add `details`, every field of the recipe object (fluids, temperatures, pentacles, post-actions) | the synced `RecipeManager`, read by field name where the vanilla getters stop |
| `tags.json` | every item, block and fluid tag with its members | the synced tag registries |
| `items.json` | every item: name, tooltip lines as shown in game, max stack, durability, rarity, enchantability, fuel ticks, food, tool tier and kinds, armor, block hardness | item classes, Forge `getBurnTime` |
| `lang.json` | the active language table, key to text | the client's language |
| `loot.json` | block drops, mob drops, chest loot, raw JSON keyed by id | loot-table JSON in the vanilla data, the mod jars, `kubejs/data`, a singleplayer world's datapacks |
| `worldgen.json` | `configured_feature`, `placed_feature` (ore veins, counts, heights), `biome_modifier` (which biomes get which features), `biome_tags`, `biome`, `dimension`, `dimension_type` | the same sources |
| `tinkers.json` | Tinkers' Construct materials (definition, stats, traits), modifiers and tool definitions, when the mod is present | `data/*/tinkering/` in the jars |
| `kubejs/` | the pack's `server_scripts`, `startup_scripts`, `client_scripts` | the client's `kubejs` folder |
| `config/`, `defaultconfigs/` | mod configs and FTB Quests (`config/ftbquests`: quests, shop, loot crates) | the game folder; files whose name says token, secret, password, api key or credential are skipped and listed in `errors.txt` |
| `README.txt` | what each file is, written for the AI that reads the zip | fixed text |
| `errors.txt` | entries the exporter could not read or skipped, if any | |

Out of reach from the client: loot or world-gen changed by a KubeJS script that runs only on the
server (the scripts themselves are copied when the pack ships them client-side, as most do), and
mod logic in Java code. Everything the server sends is in.

Configs can hold personal settings. Look through the zip before handing it to anyone.

## Status

0.2.0: builds, unit tests pass. Adds what the first AI reader said was missing: biome modifiers,
modded recipe details, Tinkers materials, the language table and tooltips, FTB Quests and configs.
0.1.0 ran in the owner's pack; 0.2.0 is not yet run inside a game.

## Building

Needs JDK 17. From this folder, in PowerShell:

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-17.0.1'; .\gradlew.bat test build
```

The jar lands in `build/libs/`; the released copy is in `dist/`.
