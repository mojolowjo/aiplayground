# CraftChain

A **client-side** Forge mod for Minecraft 1.20.1 (Forge 47.4.2). Hover an item in JEI, press a
key, and CraftChain crafts it from what you carry, including every intermediate step, by
clicking the crafting grid the way you would. Nothing is installed on the server.

Built for the MC Eternal 2 pack (v1.3), but it only needs Forge and JEI.

**Status:** researched, designed, and the first version compiles against the real Forge, JEI and
Curios jars. Not yet tested inside the game. See `docs/OUTLINE.md` section 5 for what is known
to be missing.

## Documents

| File | What's in it |
|---|---|
| [`docs/OUTLINE.md`](docs/OUTLINE.md) | How the mod works, phase plan, backpack plan, known gaps and risks |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | What was looked into, what was found with sources, what was not checked |

## Features

* **Craft from JEI.** Hover an item in JEI's list, bookmarks or recipe screen (or an inventory
  slot) and press **G**. Shift+G crafts a stack. Works in the 2x2 inventory grid for small recipes
  and in a crafting table for 3x3 ones.
* **Pinned list.** Press **P** on a hovered item to pin it (Shift+P pins a stack, Ctrl+P unpins).
  The corner of the screen then shows each pinned item and the raw materials it needs, broken
  down as far as crafting-table recipes go (64 ladders -> 20 logs), with have/need counts.
* **Backpacks:** planned, not built. The pack's Sophisticated Backpacks keep their contents on
  the server, so this needs the mod to open the backpack first. The plan is in the outline.

Keys are rebindable under Options > Controls > CraftChain. Settings live in
`config/craftchain-client.toml`; pins in `config/craftchain-pins.json`.

## Building

Needs JDK 17. Java 25 is first on this machine's PATH and Gradle 8.8 cannot run on it, so point
`JAVA_HOME` at 17 first. From this folder, in PowerShell:

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17.0.1"; .\gradlew.bat build
```

The jar lands in `build/libs/craftchain-<version>.jar`. The first build downloads and
decompiles Minecraft (about 6 minutes); later builds take about a minute.

To launch a development client with the mod, JEI and Curios loaded:

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17.0.1"; .\gradlew.bat runClient
```

To use it in the pack, drop the jar into the pack's `mods` folder on the client only.

## Layout

```
projects/craftchain/
├── README.md, docs/              this file, outline, research notes
├── build.gradle, gradle.properties, settings.gradle, gradlew   Forge 47.4.2 MDK build
└── src/main/
    ├── java/com/mojolowjo/craftchain/
    │   ├── CraftChain.java        mod entry; registers keys, overlay, events
    │   ├── ClientConfig.java      config/craftchain-client.toml
    │   ├── ClientEvents.java      key presses, ticks, recipe reloads, /craftchain
    │   ├── Keybinds.java          G craft, P pin, Esc cancel
    │   ├── jei/                   JEI plugin + "what is under the mouse"
    │   ├── planning/              recipe index, planner, plan
    │   ├── execution/             the click state machine and slot layouts
    │   ├── pins/                  pinned list, persistence, HUD overlay
    │   └── backpack/              placeholder for Phase 3
    └── resources/
        ├── META-INF/mods.toml     clientSideOnly=true, depends on jei, optional curios
        └── assets/craftchain/lang/en_us.json
```

## License

MIT.
