# Plan

## 1. Goal

Make Minecraft: Java Edition as fast as it can be across the whole game:

- **Frame rate:** higher average FPS, and better 1% lows (fewer stutters).
- **Server tick time (MSPT):** less time per game tick, so the world stays at
  full speed with more mobs, farms, and players.
- **Memory:** less RAM used and shorter garbage-collection pauses.
- **Load times:** faster game startup, world join, and chunk loading.

## 2. Ground rules

1. **Measure before and after.** Every optimization comes with a benchmark result.
   If a change can't be shown to help, it doesn't ship.
2. **Same gameplay by default.** Farms, redstone timing, and mob behavior must
   match the unmodded game exactly. Anything that changes behavior, such as slowing
   the AI of distant mobs, is off by default and clearly labeled.
3. **Don't rebuild what exists.** Sodium, Lithium, and similar mods are mature and
   maintained by experts. We run alongside them and target what they don't cover.
4. **One switch per optimization.** Each optimization can be turned off on its
   own, so a bug can be tracked down by turning things off one at a time.
5. **Fail safe.** If a Minecraft update or another mod conflicts with one of our
   patches, that one optimization turns itself off and logs a warning. The game
   doesn't crash.

## 3. Where things stand (September 2026)

These facts shape the plan:

| Fact | Why it matters |
|---|---|
| The current release is **26.3** "Wilderness Bound" (Sept 15, 2026). Version numbers became year-based after 1.21.11. | This is the version to target first. |
| **26.4 Snapshot 1** (Sept 22, 2026) made **Vulkan the default renderer**, with OpenGL as a fallback. Vulkan first appeared as an experiment in the 26.2 snapshots (April 2026). | The rendering engine is being rewritten right now. OpenGL-specific tricks written today will soon stop mattering. |
| Since **26.1**, Minecraft ships **unobfuscated**, with real class and method names. Fabric stopped maintaining its own name mappings and uses Mojang's. | Easier to read and patch the game's code. No mapping layer to fight. |
| 26.1+ requires **Java 25**. | We get Java 25 features: compact object headers, generational ZGC and Shenandoah, AOT caching. |
| Vanilla now does some classic mod tricks itself. Coverage of 26.3 reports multi-draw-indirect terrain rendering, faster structure locating, and faster chunk generation. | Old wins may already be built in. We re-measure "what's still slow" on every version instead of trusting old lists. |
| Sodium 0.9.x supports vanilla's Vulkan backend and added asynchronous occlusion culling. | The main rendering mod is already following Mojang's move to Vulkan. |

**What this means:** the game-logic side (ticking, entities, chunks, world
generation, memory, startup) is stable ground. The rendering side is changing
under our feet. So server-side and renderer-independent work comes first. Client
rendering comes later, and when it does, it targets the backend-neutral rendering
layer Mojang has been building since 1.21.5 (`GpuDevice`, `RenderPipeline`, and
related classes; exact names may shift) instead of raw OpenGL or Vulkan calls.

## 4. Where the time goes

Minecraft runs two main loops.

**The server loop.** It runs even in single-player, as a built-in "integrated
server". It aims for 20 ticks per second, which gives each tick a 50 ms budget.
Time per tick is called **MSPT** (milliseconds per tick). Above 50 MSPT the whole
world slows down. The main costs are:

- entities: AI, pathfinding, collisions, and pushing each other
- block entities: hoppers, furnaces, crafters, and similar blocks
- chunk loading, generation, lighting, and saving
- random ticks, fluids, redstone, and mob spawning
- sending chunks and entity updates to players

**The client loop.** It draws frames as fast as it can. The main costs are:

- building chunk meshes and drawing terrain
- entities and block entities (chests, signs, banners, item frames)
- particles, GUI, and text
- transparency sorting
- waiting on the GPU

Across both loops there are also RAM use, garbage-collection pauses (a common
cause of stutter), startup time, and disk I/O.

## 5. Strategy: four layers

```
Layer 3  Our own mod           fills the gaps nobody else covers
Layer 2  Curated mod stack     best existing mods, tested together
Layer 1  JVM + game settings   free wins, no code
Layer 0  Benchmark harness     proves every layer above actually helps
```

The end result is a documented setup where every piece is justified by a
measured number, plus our own mod for whatever is still slow.

### Layer 0: benchmark harness (built first)

**Server-side.** Runs headless, so it works in this cloud environment and in CI.

- Fixed world seed, pre-generated area, and scripted scenarios:
  1. Idle baseline: players standing at spawn.
  2. World generation: a scripted flight in a straight line. Measures chunks
     generated per second.
  3. Entity load: a 300-villager trading hall, 2,000 item entities, a mob farm,
     and crammed animal pens.
  4. Block entity load: 1,000-hopper chains, furnace arrays, crafters.
  5. Redstone: a large clock-driven piston machine.
  6. Lighting: mass block placement and a TNT crater.
  7. Structure search: explorer maps and `/locate`.
  8. Save: autosave and shutdown with many loaded chunks.
- Metrics: MSPT (mean, 95th and 99th percentile, max), heap use, GC pause times,
  chunks per second, save duration, and startup time to "Done".
- Tools: Fabric GameTest for scripted scenarios and correctness tests; spark and
  Java Flight Recorder (JFR) for profiles; JMH for micro-benchmarks of hot methods.
- **Parity tests:** run each scenario on the unmodded game and with our mod, then
  compare the results: farm output after N ticks, redstone state at tick N, and a
  hash of block states in a region. Exact comparison where the game is
  deterministic, statistical comparison where it's random.

**Client-side.** This needs a real GPU, so it runs on your computer. The cloud
environment has no GPU.

- A fixed camera flight path over the same world.
- Records average FPS, 1% and 0.1% lows, frame-time graph, chunk build time, and
  video memory use.
- Writes a CSV file. You run it and share the file.

### Layer 1: JVM and game settings

| Setting | What it does | Plan |
|---|---|---|
| Garbage collector | Generational ZGC (very short pauses) vs. G1 (the default) vs. Generational Shenandoah (production-ready in Java 25) | Benchmark all three. Measure pauses and throughput. |
| Compact object headers (`-XX:+UseCompactObjectHeaders`, Java 25) | Shrinks every Java object's header from 12 to 8 bytes. Minecraft creates huge numbers of small objects. | Likely a free RAM win. Measure it. |
| Heap size | Too small causes constant garbage collection. Too large can lengthen some pauses. | Find sensible defaults per use case. |
| AOT cache (Project Leyden, Java 24–25) | Caches loaded and linked classes plus method profiles between runs, for faster startup. | Research spike. Mod loaders transform classes at runtime with their own class loader, which limits what can be cached. Try it on a vanilla server first. |
| Transparent huge pages (Linux) | Fewer memory-translation misses | Small win at best. Measure it. |
| Worker thread counts | World generation, chunk I/O, and network threads | Tune to CPU core count. |
| Server properties | `view-distance` vs. `simulation-distance`, `region-file-compression` (lz4 vs. deflate), `network-compression-threshold`, `entity-broadcast-range-percentage`, `sync-chunk-writes` | Document recommended values. Flag the risky ones. For example, turning off `sync-chunk-writes` is faster but risks chunk loss if the server crashes. |
| Pre-generation | Generate the world ahead of time (Chunky) | Removes world-generation lag during play. |

### Layer 2: curated mod stack

Before we write any optimization of our own, we find the best combination of
what already exists. Each mod needs a 26.3/26.4 build check when Phase 2 starts.
This table reflects the ecosystem as understood today.

| Mod | Side | What it does | Notes |
|---|---|---|---|
| Sodium | Client | Replaces the rendering engine: meshing, culling, draw batching. 0.9.x supports Vulkan. | Core. Keep. |
| Lithium | Both | Game-logic optimizations (AI, collisions, hoppers, block entities, chunk access) with strict vanilla behavior | Core. Keep. |
| Moonrise | Server | Paper's rewritten chunk system, lighting, and collision code | **Incompatible with C2ME.** Pick one of the two by benchmark. |
| C2ME | Server | Multithreaded chunk generation, I/O, and loading, plus a world-generation math compiler | **Incompatible with Moonrise.** |
| ScalableLux | Server | Faster lighting engine | Check overlap with Moonrise. |
| FerriteCore | Both | Cuts RAM by deduplicating block-state and model data | Moonrise turns off FerriteCore parts that conflict with it. |
| ModernFix | Both | Faster startup, less memory, many bug fixes | Keep. |
| ImmediatelyFast | Client | Batches GUI, text, and simple rendering | Check whether vanilla's newer GUI renderer made parts of it redundant. |
| Entity Culling | Client | Skips drawing entities and block entities hidden behind walls | Keep. |
| More Culling | Client | Extra culling for leaves, item frames, and more | Some options change how things look. |
| Enhanced Block Entities | Client | Draws chests, signs, and similar blocks as static models | Check whether a 26.x build exists. |
| Dynamic FPS | Client | Lowers FPS when the game is in the background or idle | Keep. |
| Krypton | Server | Faster networking stack | Check whether it's still maintained. |
| ServerCore | Server | Paper-style options (entity activation range, dynamic view distance) | Changes gameplay. Opt-in only. |
| Distant Horizons | Client | Low-detail rendering for very far terrain | Separate goal (huge view distance). Optional. |
| spark | Both | Profiler | A tool, not an optimization. Used by the harness. |
| Chunky | Server | World pre-generation | A tool. |

### Layer 3: our own mod

The gap list comes from profiling the fully optimized Layer 1+2 setup in Phase 3.
Until then these are **hypotheses**, meaning areas where lag is common and
existing coverage looks thin:

1. **Villager and "brain" AI.** Sensors rescan nearby entities and points of
   interest constantly. Villager halls are a top cause of server lag. Idea: reuse
   sensor results when nothing relevant changed, and use a spatial index for
   "nearest entity" queries.
2. **Entity cramming.** Crowded mobs check every neighbor every tick, which is
   quadratic. Mob farms and animal pens suffer. Idea: spatial hashing that keeps
   the exact vanilla push results.
3. **Pathfinding.** Repeated failed searches toward unreachable targets. Idea:
   cache results. A "give up sooner" option would be opt-in.
4. **Autosave and chunk-save spikes.** Spread saves across ticks, and speed up
   chunk serialization and compression.
5. **Allocation churn.** Find the hottest allocation sites with JFR and remove them
   (temporary positions, vectors, iterators, lambdas).
6. **Item stacks.** Items have been built from "data components" since 1.20.5.
   Idea: cache hashes and avoid copies in inventory-heavy paths such as hoppers
   and sorting systems.
7. **Recipe lookups.** Furnaces, crafters, and auto-crafting re-search recipes.
   Idea: cache the last match.
8. **Structure and portal searches.** Explorer maps and nether portal searches
   cause lag spikes. Vanilla 26.3 improved locating, so re-measure first.
9. **Client, after Vulkan settles:** GPU-instanced rendering for crowds of
   identical mobs, cached sign and text rendering, cheaper item frames and dropped
   items, particle batching.

Every idea, including the ones already covered by other mods, is listed in
[`CATALOG.md`](CATALOG.md).

## 6. Roadmap

| Phase | What happens | Output |
|---|---|---|
| **0. Plan** | This document | `docs/` ✔ |
| **1. Skeleton + server harness** | Fabric mod skeleton for 26.3 with automatic builds on GitHub, headless benchmark scenarios, unmodded baseline numbers | `mod/`, `benchmarks/`, first results |
| **2. Tune the known stack** | Compare unmodded vs. JVM tuning vs. JVM + mod stack. Answer Moonrise or C2ME, ZGC or G1, and how much compact headers help. | `setups/`, the recommended configuration with numbers |
| **3. Profile what's left** | Profile the best Layer 1+2 setup under every scenario. Re-rank the catalog by measured cost. | Updated `CATALOG.md` with real numbers |
| **4. Our mod, server side** | Build the top 3–5 targets with parity tests. Each one can be toggled. | First release of the mod |
| **5. Client** | Client benchmark on your computer. Client-side targets once 26.4 (Vulkan default) is a stable release. | Client optimizations |
| **6. Ongoing** | Port to each new Minecraft version. Optional NeoForge version. Publish on Modrinth/GitHub. | Releases |

## 7. Decisions for you

A default is marked for each. Say "go with the defaults" and I'll use them.

1. **Minecraft version.** Default: **latest (26.3 now, 26.4 once released).**
   The alternative is an older modpack favorite like 1.20.1 or 1.21.1. More people
   play those, but they use OpenGL and obfuscated code, and they no longer get
   updates.
2. **Mod loader.** Default: **Fabric.** Most optimization mods live there and it's
   lightweight. NeoForge support could come later.
3. **Focus first.** Default: **server and game logic**, for the renderer reasons
   above. The alternative is client FPS first, accepting some rework after the
   Vulkan switch.
4. **Scope.** Default: **our mod plus a recommended setup of existing mods.** The
   alternative is a stand-alone all-in-one mod. That would mean redoing years of
   Sodium- and Lithium-level work, which isn't a good use of effort.
5. **Vanilla behavior.** Default: **strict by default, with gameplay-changing
   options as opt-in.**
6. **Name.** The mod needs a name and mod ID. Any ideas? If not, I'll propose a few.
7. **Public or private.** Publish releases on Modrinth/GitHub, or keep them for
   yourself?
8. **Your hardware.** For client benchmarks: CPU, GPU, RAM, and operating system.

## 8. Limits and risks

- **Network access (blocks Phase 1).** This cloud environment currently blocks
  Mojang's and Fabric's download servers, as well as Modrinth. Blocked hosts:
  `piston-meta.mojang.com`, `piston-data.mojang.com`, `libraries.minecraft.net`,
  `resources.download.minecraft.net`, `maven.fabricmc.net`, `meta.fabricmc.net`,
  `api.modrinth.com`, `cdn.modrinth.com`. The build tools need these to download
  Minecraft and Fabric. The fix is in the environment's Network access settings.
  Java 25 itself is installable here.
- **No GPU here.** Server-side work can be fully built and tested in the cloud.
  Client FPS can only be measured on your computer.
- **Updates break things.** Minecraft releases about every three months, and our
  code patches can break with each one. Porting is recurring work.
- **The easy wins are taken.** Existing mods cover the big, well-known wins. Expect
  our gains to be large on specific workloads (villager halls, farms, busy
  servers), not a blanket "2× FPS".
- **Things we deliberately won't do:**
  - Multithreaded entity ticking or region threading, as in Paper's Folia fork.
    It breaks mod compatibility and vanilla behavior.
  - Our own renderer while Mojang's is mid-rewrite.
