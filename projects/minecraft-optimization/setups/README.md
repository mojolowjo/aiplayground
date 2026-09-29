# Recommended setup: Minecraft 26.3 server

What to install and how to start the server. Every recommendation here comes from a
benchmark in [`../benchmarks/results/`](../benchmarks/results/), and each links to its
measurement. Things not measured yet are marked that way.

Last updated: September 29, 2026 (Phase 2).

## Mods

Fabric Loader 0.19.5 and Fabric API 0.161.0+26.3, plus:

| Mod | Version tested | Verdict | Why |
|---|---|---|---|
| [Lithium](https://modrinth.com/mod/lithium) | mc26.3-0.26.2-fabric | **Install** | Items −73%, world generation +18% faster, hoppers exact ([results](../benchmarks/results/2026-09-29-baseline-vs-lithium/FINDINGS.md)) |
| [FerriteCore](https://modrinth.com/mod/ferrite-core) | 9.0.0-fabric | **Install** | About 8 MB (5%) less memory, no measured cost ([results](../benchmarks/results/2026-09-29-mod-stack/FINDINGS.md)) |
| [Moonrise](https://modrinth.com/mod/moonrise-opt) | 1.2.0 | Optional, see below | Smoothest ticks in most tests, but villager halls 47% slower and about 80 MB more memory |
| [C2ME](https://modrinth.com/mod/c2me-fabric) + [ScalableLux](https://modrinth.com/mod/scalablelux) | 0.4.2-alpha.0.88 / 0.3.0-alpha.0.6 | Optional, see below | Chunks generate 23% faster, but ticks take 61% longer while generating. Alpha builds. |

**Pick at most one of Moonrise and C2ME.** They replace the same part of the game and
can't run together.

- **Add Moonrise** if your server has no big villager halls and smooth ticks matter more to
  you than how fast new land generates.
- **Add C2ME + ScalableLux** while pre-generating a world (for example with
  [Chunky](https://modrinth.com/plugin/chunky)), or on servers with many CPU cores where
  players explore a lot.

**ModernFix** has no build for 26.x yet.

## Starting the server

[`start-server.sh`](start-server.sh) has the full command. The Java flags:

| Your server machine | Flags | Why |
|---|---|---|
| 4 CPU cores or fewer | `-Xms4G -Xmx4G -XX:+UseCompactObjectHeaders` | Compact headers use 7–9% less memory with no slowdown ([results](../benchmarks/results/2026-09-29-jvm/FINDINGS.md)) |
| 6+ cores, RAM to spare | `-Xms4G -Xmx4G -XX:+UseZGC` | No GC stutters at all (longest pause under 0.1 ms, against up to 500 ms with the default). It costs some average speed and about 90 MB more memory on 4 cores; measure on your hardware. |

- Replace `4G` with the memory you want to give the server, and keep both numbers the same.
- Requires Java 25.

## Not measured yet

These are common recommendations that this project hasn't benchmarked yet:

- **Pre-generate the world** with Chunky before players join. This avoids generation lag
  during play; our worldgen scenario shows why it matters.
- **`simulation-distance`** in `server.properties` sets how far from players the game
  keeps ticking. Lower values mean less work.
- **`sync-chunk-writes=false`** makes saving faster, but risks losing chunks if the
  server crashes.
- **The client** (Sodium, Iris, Entity Culling, and so on) is Phase 5, measured on your PC
  once Minecraft's switch to Vulkan settles.

## Caveats

- **Measured on a shared 4-CPU cloud machine with no players online.** Results on a
  dedicated server with more cores, or with players connected, can differ.
- **Re-run the benchmarks to check on your own hardware:**
  `python3 benchmarks/bench.py run --stacks lithium-ferrite,lithium-ferrite-zgc --repeats 3`
