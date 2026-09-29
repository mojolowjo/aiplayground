# Findings: which mods to run alongside Lithium (Sept 29, 2026)

Which well-known performance mods are worth adding on top of Lithium on a Minecraft 26.3
server? Four mod stacks were compared:

| Stack | Mods |
|---|---|
| `lithium` | Lithium (reference) |
| `lithium-ferrite` | + FerriteCore 9.0.0 |
| `lithium-ferrite-c2me-lux` | + FerriteCore + C2ME 0.4.2-alpha.0.88 + ScalableLux 0.3.0-alpha.0.6 |
| `lithium-ferrite-moonrise` | + FerriteCore + Moonrise 1.2.0 |

ModernFix wasn't tested because it has no build for 26.x. Its newest Fabric release is for
1.20.1.

## Two sessions

1. **This folder** has all six scenarios, 72 runs.
   - Each run started from a brand-new world, which turned out to add slow stretches to
     the villager and item measurements.
   - Those two scenarios' results here are unreliable. The other four scenarios were
     tight between runs.
2. **[`../2026-09-29-mod-stack-entities/`](../2026-09-29-mod-stack-entities/REPORT.md)**
   re-ran villagers and items, 24 runs, with the fixed method:
   - Every run starts from a saved world that has already settled.
   - The warm-up is 60 s for items and 3 minutes for villagers, so the villagers have
     settled into their jobs before measuring starts.
   - Villager and item numbers below come from this session.

## Results

MSPT = milliseconds of work per server tick. Lower is better; 50 is the limit.

| Scenario | Lithium | + FerriteCore | + C2ME + ScalableLux | + Moonrise |
|---|---|---|---|---|
| Idle (MSPT) | 0.38 | 0.37 | 0.39 | **0.28** (−25%) |
| Villagers (MSPT) | 15.5 | 14.6 | 15.3 | **22.9 (+47%, worse)** |
| Items (MSPT) | 5.1 | 5.7 | 5.3 | **4.2** (−17%) |
| Cramming (MSPT) | 4.7 | 6.5 (noisy) | 8.7 (+84%, worse) | **4.3** (−9%) |
| Hoppers (MSPT) | 1.19 | 1.31 | 1.38 | **1.09** (−8%) |
| Worldgen (chunks/s) | 22.4 | 21.1 | **27.6** (+23%) | 15.1 (−33%, slower) |
| Worldgen (MSPT while generating) | 5.9 | 6.2 | 9.4 (+61%, worse) | **3.3** (−45%) |
| Memory in use after GC (villagers) | 171 MB | **163 MB** | 177 MB | 250 MB (+79 MB) |
| Startup, existing world | 20.6 s | 21.2 s | 19.8 s | 20.4 s |

Hopper parity held for every stack: exactly 7,500 items in every run.

## What it means

**FerriteCore: keep it.**
- It saves about 8 MB of memory (about 5%) in every scenario, run after run.
- No tick-time cost showed up beyond run-to-run noise.
- Its bigger savings are on the client (model data), which these server tests don't cover.

**C2ME + ScalableLux: only for pre-generating or exploration-heavy servers.**
- Chunks generate 23% faster.
- The price: while generating, ticks take 61% longer, and garbage collection jumps in
  several scenarios (up to 850 ms per minute), with lag spikes of up to about 400 ms.
- On this 4-CPU machine, its extra worker threads compete with the main server thread.
  On a machine with more cores the trade-off is probably better.
- Both are alpha builds.

**Moonrise: great for smooth ticks, bad for villager halls.**
- Best result in idle, items, cramming, and hoppers, with the steadiest tick times of any
  stack.
- While generating chunks, the server stays very smooth: median tick 0.3 ms against
  2.7 ms. But chunks arrive 33% slower, so players exploring new land would wait longer.
- **Consistently 47% slower with 300 villagers** (all three runs 22–23.5 ms against
  13–17 ms). The profile shows why: Moonrise's replacement for the "find the nearest
  point of interest" search (`PoiAccess.findNearestPoiRecords`) plus the hash sets it
  fills (`LongOpenHashSet.add/rehash`) take about 25% of the time. Villagers call this
  constantly to find beds, workstations, and meeting points.
- It uses about 80 MB more memory.
- It can't be combined with C2ME.

## Recommendation (server)

- **Default: Lithium + FerriteCore.** No downsides found.
- **Add Moonrise** if the server has no large villager halls and smooth ticks matter more
  than chunk generation speed.
- **Add C2ME + ScalableLux** only while pre-generating a world with Chunky, or on servers
  with many cores where players explore a lot.

## Leads for Cloudly

1. **Villager AI stays the biggest cost with every stack**: 14–23 ms per tick for 300
   villagers. This confirms catalog items C4 and C5.
2. **Moonrise's point-of-interest search is slow in villager halls.** Two options:
   - Report it to Moonrise's developers, with this benchmark as a reproducible case.
   - Treat it as a head-to-head target: a Cloudly point-of-interest search that
     works alongside Moonrise.
3. **ModernFix has no 26.x build.** Its startup and memory work (catalog B1, B5, H4) is
   currently missing on modern versions. Most of it matters on the client.
