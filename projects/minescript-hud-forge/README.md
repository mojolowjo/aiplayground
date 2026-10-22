# Minescript HUD Addon: Forge 1.20.1 port

A port of [Minescript HUD Addon](https://modrinth.com/mod/minescript-hud-addon/)
(by Maks, [source](https://github.com/maksymiblue12/Minescript-Hud-Addon), GPL-3.0)
from Fabric 1.21+/Minescript 5 to **Forge 1.20.1 / Minescript 4.0**.

## Install

1. Install Forge 1.20.1 and [Minescript 4.0 for Forge 1.20.1](https://modrinth.com/mod/minescript/version/4.0).
2. Put `release/Minescript-HUD-forge-1.20.1-1.2.1-forge.jar` in your `mods` folder.
3. Launch the game. The mod copies `hud_renderer.py` into `minescript/system/lib/`.

```python
from hud_renderer import *
add_text("Hello World",x=10,y=10,color=argb(255,255,255,255),shadow=True,display_duration=5)
```

The Python API is the same as the original's. See the
[original docs](https://maksymiblue12.github.io/Minescript-Hud-Addon/).

## Differences from the Fabric version

- **Textures:** 1.20.1 has no GUI sprite atlas. `Identifier(path, vanilla)` points to a
  whole texture file under `assets/<namespace>/textures/`, without `.png`, for example
  `Identifier("gui/icons", True)`. The whole image is stretched to the given width and height.
- `wait_next_frame()` replies after the next HUD frame instead of suspending the job.

## Status

It compiles, and in one test launch it loaded next to Minescript 4.0. It has **not**
been tested in a world yet.

## Build

```
./gradlew build      # output: build/libs/
```

ForgeGradle needs a JDK 17 toolchain.
