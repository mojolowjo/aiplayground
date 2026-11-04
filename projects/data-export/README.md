# Data Export

A **client-side** Forge mod for Minecraft 1.20.1 (Forge 47.4.2). One command writes everything
the client knows about the pack's game data to a folder, so you can zip it and hand it to an AI
and ask "how do I get X in this pack?". Nothing is installed on the server.

Personal tool, unrelated to the bot projects in this repository.

## What it exports

The client receives the finished game data from the server on join, with every KubeJS server
script change (recipe edits, removals, tag changes) already applied. The mod reads that copy, plus
the JSON inside the pack's jars, and writes `<game dir>/dataexport/<world or server>/`:

| File | Contents | Source |
|---|---|---|
| `recipes.json` | every recipe: type, station, inputs (items or tags), output and count | the synced `RecipeManager` |
| `tags.json` | every item, block and fluid tag with its members | the synced tag registries |
| `items.json` | every item: stack size, tool tier and speed, food values, fuel burn time, armor, durability | item classes, Forge `getBurnTime` |
| `loot.json` | block drops, mob drops, chest loot | loot-table JSON in the pack's jars |
| `worldgen.json` | ore bands per ore and dimension | `placed_feature` / `configured_feature` JSON in the jars |
| `INDEX.txt` | one line per item: how it is obtained (recipe, drop, mined, none known) | built from the above |
| `README.txt` | what each file is, written for the AI that reads the zip | fixed text |

Out of reach from the client: KubeJS scripts that react to events at runtime, and mod logic in
Java code. Everything the server sends is in.

## Status

Planned. Build setup to be copied from [`../craftchain`](../craftchain/) (same loader, same
version, same client-only marking).

## Building

Needs JDK 17. From this folder, in PowerShell:

```powershell
$env:JAVA_HOME='C:\Program Files\Java\jdk-17.0.1'; .\gradlew.bat build
```

The jar lands in `build/libs/`; drop it into the pack's `mods` folder.
