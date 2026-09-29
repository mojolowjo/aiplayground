# Findings: baseline vs. Lithium (Sept 29, 2026)

The first full benchmark session: 6 scenarios × 2 mod stacks × 3 runs = 36 runs, all
successful. The raw numbers are in [`REPORT.md`](REPORT.md). This page says what they mean.

**Setup:** Minecraft 26.3 dedicated server, Fabric Loader 0.19.5, Fabric API
0.161.0+26.3, Lithium mc26.3-0.26.2. Java 25 with the default G1 garbage collector and a
4 GB heap, on a 4-CPU cloud machine. No players online.

## Results

| Scenario | Plain Fabric (MSPT) | With Lithium (MSPT) | Change | Verdict |
|---|---|---|---|---|
| Idle | 0.34 | 0.34 | none | Nothing to gain on an empty server |
| Villagers (300) | 27.5 | 22.9 | −17% | **Still heavy with Lithium: the top target for Cloudly** |
| Cramming (200 cows) | 11.5 | 10.2 | inconclusive | Too noisy to judge; the scenario needs fixing |
| Items (1,200) | 28.3 | 7.6 | **−73%** | Lithium handles this well |
| Hoppers (1,000) | 1.23 | 1.07 | −13% | Already cheap. Parity check passed. |
| Worldgen (625 chunks) | 23.7 chunks/s | 28.0 chunks/s | **+18% faster** | Lithium helps; world-generation mods are next to test |

MSPT is the average milliseconds of work per server tick. 50 is the limit before the game
slows down.

## What stands out

1. **Villagers are the biggest remaining problem.**
   - With Lithium, a 300-villager trading hall still averages 23 ms per tick.
   - Its worst 1% of ticks (58 ms) go over the 50 ms limit. Players would feel that as
     lag spikes.
   - The hot methods are the villager "brain": behavior checks
     (`BehaviorBuilder`, `GateBehavior`, `SetLookAndInteract`), memory lookups
     (`Reference2ObjectOpenHashMap.get`, `MemoryCondition`), and entity data reads
     (`SynchedEntityData.getItem`).
   - This matches catalog items C4 and C5, and it's where Cloudly should start.
2. **Lithium's item optimization is excellent.**
   - Items went from 28 ms to 8 ms.
   - Without Lithium, one lambda inside the "find nearby entities" search took 37% of the
     time.
   - Nothing worth adding here, so catalog item C12 becomes "Use".
3. **Hopper parity works.**
   - Every one of the 6 hopper runs delivered exactly 7,500 items, which is exactly what
     vanilla's timing predicts (50 chains × 1,200 ticks ÷ 8 ticks per item).
   - This check will catch any optimization that changes hopper behavior.
4. **Lag spikes all over.**
   - The slowest single tick in the busy scenarios was 180–340 ms, several times the
     50 ms limit.
   - Garbage collection is the likely cause: 200–550 ms of GC per minute in the busy
     scenarios.
   - Phase 2 tests whether ZGC and compact object headers remove these spikes.
   - **Update (Phase 2):** only partly right. With a settled world, G1's real pauses in
     these scenarios are 60–115 ms. Much of these spikes came from the brand-new world
     still generating and saving in the background. G1 does pause for up to 0.5 s during
     world generation. See [the GC findings](../2026-09-29-jvm/FINDINGS.md).

## Caveats

- **Villager and item runs started too early** (fixed in Phase 2). Every run began in a
  brand-new world, which was still generating and saving around spawn during
  measurement. Newly spawned villagers were also still walking to their workstations.
  Phase 2 re-measured both with a settled template world and longer warm-ups.
- **Cramming is too noisy.**
  - Plain Fabric alone ranged from 7.7 to 13.7 ms between runs.
  - The cows wander randomly and bunch up differently each time, so crowd shape swings
    the result more than the mods do.
  - Fix: pack the cows into a smaller pen so the crowd is equally dense everywhere.
- **Shared cloud machine.** Other work on the same hardware adds noise. Differences
  smaller than about 10% should be confirmed with more runs or on your own PC.
- **The hot-method tables mix all threads.** For worldgen, most of the listed methods run
  on the generation worker threads, not the main server thread. To look at the server
  thread alone, open the `.jfr` files in JDK Mission Control and filter to
  `Server thread`.

## Next steps

1. **Fix the cramming scenario** (smaller, evenly packed pen) and re-run it.
2. **Phase 2:** add stacks for the other well-known mods (FerriteCore, ModernFix,
   ScalableLux, C2ME vs. Moonrise), and compare garbage collectors (G1, ZGC, Shenandoah)
   and compact object headers.
3. **Phase 3/4:** profile villagers on the best stack. Then design Cloudly's first
   optimization: cache villager brain sensor results so they aren't recomputed when
   nothing relevant has changed.
