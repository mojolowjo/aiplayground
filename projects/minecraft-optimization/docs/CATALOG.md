# Optimization Catalog

Every optimization idea we know of, grouped by part of the game. Each has an ID
(like `C4`) so later work, commits, and benchmark results can refer to it.

Phase 3 re-ranks this list using real profiling numbers. Until then, the
**Impact** column is an educated guess.

Measured so far (Sept 29, 2026): [baseline vs. Lithium](../benchmarks/results/2026-09-29-baseline-vs-lithium/FINDINGS.md),
[mods on top of Lithium](../benchmarks/results/2026-09-29-mod-stack/FINDINGS.md), and
[garbage collectors](../benchmarks/results/2026-09-29-jvm/FINDINGS.md). The resulting setup is in
[`setups/`](../setups/README.md). Entries backed by a measurement say so in the **Covered by** column.

## How to read the tables

- **Covered by:** an existing mod or game setting that already does it.
  "(verify)" means we believe so but haven't confirmed it for 26.x.
- **Gameplay:**
  - **Same:** the game behaves exactly as unmodded.
  - **Changes:** behavior differs, so the idea can only ship as an opt-in option.
  - **Looks:** visuals differ slightly.
- **Verdict:**
  - **Use:** already solved. Include it in the recommended setup.
  - **Gap?:** candidate for our mod. Confirm with profiling first.
  - **Opt-in:** changes gameplay. Offer it as an option, off by default.
  - **Research:** unclear payoff. Do a small experiment first.
  - **Wait:** depends on the OpenGL → Vulkan switch settling.
  - **Skip:** not worth it, or too risky.

---

## A. Java runtime

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| A1 | Pick the best garbage collector: Generational ZGC, G1, or Generational Shenandoah | Launch flags. Measured: G1 pauses up to 0.5 s; ZGC pauses under 0.1 ms but costs some average speed on 4 cores; Shenandoah erratic | Same | High (stutter) | Use: G1 on ≤4 cores, ZGC on 6+ |
| A2 | Compact object headers (`-XX:+UseCompactObjectHeaders`, Java 25) | Launch flag. Measured: 7–9% less memory, no slowdown with G1 | Same | Medium–High (RAM) | Use |
| A3 | Heap sizing; on servers set min = max heap and pre-touch memory | Launch flags | Same | Medium | Use |
| A4 | AOT cache from Project Leyden, for faster startup | Nothing yet | Same | Medium (startup) | Research. Mod loaders limit what can be cached. |
| A5 | Transparent huge pages (Linux) | Launch flag | Same | Low | Research |
| A6 | String deduplication in the garbage collector | Launch flag | Same | Low | Research |
| A7 | SIMD math (Vector API) for noise and lighting | Nothing; still an incubator API in Java 25 | Same | Unknown | Skip for now |
| A8 | Size the thread pools for world generation, chunk I/O, and networking | C2ME / Moonrise config | Same | Medium | Use |

## B. Startup and loading

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| B1 | Build item and block models only when first needed, not all at startup | ModernFix, but it has no 26.x build | Same | High (startup, RAM) | **Gap** on 26.x (client side) |
| B2 | Parallel texture-atlas stitching and resource parsing | Partly vanilla and ModernFix (verify) | Same | Medium | Gap? |
| B3 | Keep our own mod cheap at startup: few patches, lazy setup | Us | Same | Low | Always |
| B4 | Save compiled shaders and pipelines to disk between launches | Check vanilla 26.4 | Same | Medium (first-load stutter) | Wait |
| B5 | Faster data pack, tag, and recipe loading on world join | Partly ModernFix | Same | Medium | Gap? |
| B6 | Faster upgrading of chunks from old worlds (DataFixerUpper) | Vanilla "Optimize World" button | Same | High for old worlds | Research |
| B7 | Fewer chunks prepared before the player can move on world join | Vanilla settings | Same | Medium | Research |

## C. Entities (server)

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| C1 | Faster collision checks against blocks and entities | Lithium, Moonrise | Same | High | Use |
| C2 | Faster "which entities are in this area" lookups | Lithium | Same | Medium | Use |
| C3 | Skip idle goals in older-style mob AI | Lithium | Same | Medium | Use |
| C4 | Villager, piglin, allay, and other "brain" AI: reuse sensor results when nothing relevant changed | Partly Lithium. Measured: 300 villagers still cost 23 ms/tick with Lithium | Same | High | **Gap (confirmed)** |
| C5 | Spatial index for "nearest entity" and "nearest point of interest" queries | Partial. Measured: Moonrise's point-of-interest search makes 300 villagers 47% slower | Same | High | **Gap (confirmed)** |
| C6 | Entity cramming: crowded mobs check every neighbor every tick (quadratic cost) | Unknown | Same | High (farms, pens) | **Gap?** |
| C7 | Pathfinding: cache block-type lookups during a search | Lithium | Same | Medium | Use |
| C8 | Pathfinding: remember recently failed searches toward unreachable targets | Nothing known | Same if the cache is exact; otherwise Changes | Medium | Gap? |
| C9 | Pathfinding on background threads | Some Paper forks, not Fabric | Changes (timing) | Medium | Skip |
| C10 | Entity activation range: tick distant mobs less often | ServerCore, Paper | Changes | High | Opt-in |
| C11 | Entity tracking: decide more cheaply which players get updates about which entities | Paper; Moonrise (verify) | Same | Medium–High (busy servers) | Gap?, verify |
| C12 | Item entity merging: cheaper nearby-item scans | Lithium. Measured: −73% in the `items` scenario | Same | Medium | Use |
| C13 | Merge experience orbs more aggressively | Clumps | Changes (pickup) | Low–Medium | Opt-in |
| C14 | Faster explosion ray calculations (TNT) | Lithium | Same | Medium | Use |
| C15 | Cheaper mob spawning checks and mob-cap counting | Partly Lithium | Same | Medium | Research |
| C16 | Faster entity saving (serialization) | Nothing known | Same | Low–Medium | Research |
| C17 | Switch off AI for villagers locked in trading cells ("lobotomy") | Purpur (Paper fork) | Changes | High | Opt-in |

## D. Block entities (server)

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| D1 | Hoppers: track inventory changes and skip idle hoppers | Lithium. Measured: −13%, exact hopper parity | Same | High | Use |
| D2 | Put idle furnaces, brewing stands, and campfires to sleep | Lithium | Same | Medium | Use |
| D3 | Cache comparator reads of inventories | Lithium | Same | Medium | Use |
| D4 | Cache recipe lookups for furnaces, smokers, blast furnaces, and crafters | Nothing known for 26.x | Same | Medium | **Gap?** |
| D5 | Sculk sensors and vibrations: faster game-event dispatch | Lithium (verify) | Same | Medium | Use |
| D6 | Cheaper add/remove in the block entity tick list | Lithium | Same | Low | Use |
| D7 | Beacon and conduit periodic scans | Already cheap | Same | Low | Skip |

## E. World ticking (server)

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| E1 | Random ticks: skip chunk sections with nothing that random-ticks | Vanilla, Lithium | Same | Medium | Use |
| E2 | Fluid flow: water and lava search for which way to flow | Unknown (verify) | Same | Medium | Gap? |
| E3 | Redstone wire update storms | Alternate Current; vanilla "Redstone Experiments" toggle | Changes (update order) | High for redstone builds | Opt-in |
| E4 | Neighbor and shape update chains (pistons, rails) | Partial | Same | Medium | Research |
| E5 | Lighting engine | Vanilla (rewritten in 1.20), ScalableLux, Moonrise | Same | High | Use |
| E6 | Heightmap updates | Vanilla | Same | Low | Skip |
| E7 | Point-of-interest lookups (beds, workstations, portals, bee nests) | Partly Lithium | Same | Medium | Gap? |
| E8 | Nether portal destination search | Unknown | Same | Medium (spikes) | Gap? |
| E9 | Spread autosave across many ticks instead of saving everything at once | Paper; Moonrise (verify) | Same (only disk-write timing) | High (spikes) | **Gap?**, verify |
| E10 | Scheduled block and fluid tick storage | Vanilla (rewritten in 1.18) | Same | Low | Skip |

## F. Chunks: loading, generation, saving

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| F1 | Chunk loading and scheduling system | Moonrise **or** C2ME (they're incompatible). Measured: C2ME +23% chunks/s but +61% tick time while generating; Moonrise −45% tick time but −33% chunks/s | Same | High | Use; depends on the server (see findings) |
| F2 | World-generation noise and density-function math | C2ME (compiles it to fast code); vanilla 26.3 improvements. Measured: Lithium alone gives +18% chunks/s | Same | High | Use; compare C2ME next |
| F3 | Feature placement (trees, ores, plants) | Unknown | Same | Medium | Research |
| F4 | Structure placement checks and jigsaw assembly (villages, trial chambers, ancient cities) | Partly vanilla 26.3 | Same | Medium | Research |
| F5 | Structure search (`/locate`, explorer maps, dolphins) | Vanilla 26.3 made it faster | Same | High (spikes) | Re-measure |
| F6 | Biome lookups | Unknown | Same | Low–Medium | Research |
| F7 | Chunk serialization (NBT writing) with fewer temporary objects | Unknown | Same | Medium | Gap? |
| F8 | Region file compression: LZ4 vs. deflate | Vanilla setting (`region-file-compression`) | Same | Medium | Use (setting) |
| F9 | Load and save chunks on background threads | Moonrise, C2ME | Same | High | Use |
| F10 | Pre-generate the world | Chunky | Same | High | Use |
| F11 | Chunk data memory (palette resizing) | Vanilla | Same | Low | Skip |
| F12 | Save storms when players log out or the server shuts down | Unknown | Same | Medium | Research |

## G. Networking

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| G1 | Network pipeline: fewer flushes, faster number encoding, native compression and encryption | Krypton (verify it's maintained) | Same | Medium | Use, or Gap? if Krypton is abandoned |
| G2 | Tune compression threshold and level | Server settings | Same | Medium | Use (setting) |
| G3 | Chunk sending pace | Vanilla (chunk batching since 1.20.2) | Same | Low | Skip |
| G4 | Entity movement update volume; tracking range | Server settings | Changes (how far away entities are visible) | Medium | Use (setting) |
| G5 | Smaller light data in chunk packets | Unknown | Same | Low–Medium | Research |

## H. Memory

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| H1 | Deduplicate block-state and model data | FerriteCore (measured: −8 MB on a server), ModernFix (no 26.x build) | Same | High | Use |
| H2 | Compact object headers | See A2 | Same | Medium–High | Use |
| H3 | Find and remove the hottest allocation sites (temporary positions, vectors, iterators, lambdas) | Us, using JFR allocation profiling | Same | High (less GC) | **Gap?** |
| H4 | Fix known memory leaks in each version | ModernFix | Same | Medium | Use |
| H5 | Item stacks (data components): avoid needless copies and re-hashing | Unknown | Same | Medium | Gap? |
| H6 | Keep render buffers outside the Java heap | Sodium | Same | n/a | Use |

## I. Client: terrain rendering

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| I1 | Chunk meshing on multiple threads with a compact vertex format | Sodium | Same | High | Use |
| I2 | Fewer draw calls (multi-draw indirect) | Vanilla 26.3, Sodium | Same | High | Use |
| I3 | Cave and occlusion culling | Sodium (asynchronous in 0.9) | Same | High | Use |
| I4 | Translucency: sorting vs. vanilla 26.3's order-independent transparency | Sodium; vanilla | Looks | Medium | Use; recommend settings |
| I5 | Leaf face culling | More Culling | Looks | Medium | Opt-in |
| I6 | Only update animated textures that are on screen | Sodium | Same | Low–Medium | Use |
| I7 | Low-detail rendering for very distant terrain | Distant Horizons | Looks | High at huge distances | Optional |
| I8 | Mesh shaders | Nvidium (OpenGL, NVIDIA only) | Same | High on NVIDIA | Wait (Vulkan) |
| I9 | Vulkan specifics: pipeline caching, multithreaded command recording, present modes | Mojang, Sodium | Same | High | Wait |

## J. Client: entities, block entities, particles

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| J1 | Skip drawing entities and block entities hidden behind walls | Entity Culling | Same | High | Use |
| J2 | Faster entity model drawing on the CPU | Partly Sodium | Same | Medium | Use |
| J3 | GPU instancing for crowds of identical mobs | Nothing for 26.x (Flywheel, used by the Create mod, is the model) | Same | High (mob farms) | Wait, then **Gap** |
| J4 | Draw chests, signs, banners, and beds as static models | Enhanced Block Entities (verify 26.x) | Mostly Same (animations need care) | High in storage rooms | Use, or Gap? if unmaintained |
| J5 | Cache sign text instead of redrawing it every frame | Unknown | Same | Medium | Gap? |
| J6 | Item frames, maps, dropped items, display entities | Partly ImmediatelyFast (maps) | Same | Medium | Gap? |
| J7 | Particle culling and batching | Partial | Same | Medium | Gap? |
| J8 | Entity shadows, name tags, beacon beams | Already cheap | Same | Low | Skip |

## K. Client: GUI and text

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| K1 | Batch GUI drawing | Vanilla (GUI renderer rewritten in 1.21.6), ImmediatelyFast | Same | Medium | Use |
| K2 | Faster text rendering | ImmediatelyFast | Same | Medium | Use |
| K3 | Put map textures in one shared atlas | ImmediatelyFast | Same | Low–Medium | Use |
| K4 | Lag when first opening creative search or the recipe book | Unknown | Same | Low | Research |
| K5 | Debug screen overhead | Vanilla | Same | Low | Skip |

## L. Client: frame pacing and stutter

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| L1 | Lower FPS when unfocused, minimized, or idle | Dynamic FPS | Same | High (power, heat, background performance) | Use |
| L2 | Garbage-collection pauses cause stutter | See A1 | Same | High | Use |
| L3 | Chunk upload spikes on the render thread | Sodium | Same | Medium | Use |
| L4 | Stutter when a shader or pipeline compiles for the first time | See B4 | Same | Medium | Wait |
| L5 | Present-mode options under Vulkan (latency vs. tearing) | Check vanilla 26.4 | Same | Medium (input latency) | Wait |
| L6 | In single-player, the built-in server competes with the client for CPU | Unknown | Same | Medium | Research |

## M. Audio

| ID | Idea | Covered by | Gameplay | Impact | Verdict |
|---|---|---|---|---|---|
| M1 | Cap or merge many identical nearby sounds (mob farms) | Unknown | Changes (slightly) | Low | Research |
| M2 | Sound source pooling | Vanilla | Same | Low | Skip |

---

## Tools (for measuring, not optimizations)

| Tool | Used for |
|---|---|
| spark | In-game profiler: finds which code is using the time |
| Java Flight Recorder (JFR) | Low-overhead profiling of CPU time, allocations, and GC pauses. Minecraft's `/jfr` command adds game-specific events. |
| JDK Mission Control | Free desktop app for reading JFR files: hot methods, flame graphs, allocations, GC pauses, locks. See [`PROFILING.md`](PROFILING.md). |
| VisualVM | Free desktop app for live graphs and heap dumps (memory leaks) |
| async-profiler | Detailed CPU flame graphs |
| JMH | Micro-benchmarks of single hot methods |
| Fabric GameTest | Scripted in-world scenarios and correctness tests |
| GitHub Actions | Build the mod and run the headless benchmarks automatically |
