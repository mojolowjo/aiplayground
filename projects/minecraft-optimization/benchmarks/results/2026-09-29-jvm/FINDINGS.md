# Findings: Java garbage collection settings (Sept 29, 2026)

Garbage collection (GC) is Java cleaning up memory the game no longer uses. Some collectors
pause the whole game while they work, which players feel as a stutter. Five settings were
compared on the same mods (Lithium + FerriteCore), Java 25, a 4 GB heap, and a 4-CPU
machine. There were 60 runs across villagers, cramming, items, and worldgen, all starting
from the settled template world.

| Stack | Collector | Extra flag |
|---|---|---|
| `lithium-ferrite` | G1 (Java's default) | none |
| `lithium-ferrite-coh` | G1 | `-XX:+UseCompactObjectHeaders` |
| `lithium-ferrite-zgc` | ZGC | `-XX:+UseZGC` |
| `lithium-ferrite-zgc-coh` | ZGC | `-XX:+UseZGC -XX:+UseCompactObjectHeaders` |
| `lithium-ferrite-shenandoah` | Generational Shenandoah | `-XX:+UseShenandoahGC -XX:ShenandoahGCMode=generational` |

Full numbers: [`REPORT.md`](REPORT.md).

## A measuring pitfall, fixed

The "GC ms" number Java reports through its management API also counts work ZGC and
Shenandoah do *in the background while the game keeps running*. By that number, ZGC looked
the worst: 1,737 ms per minute in the items test. The JFR recording of the same run shows
its real pauses added up to **0.19 ms**. Reports now include pause columns read from JFR.
Always compare collectors with those.

## Results

**Real GC pauses** (stop-the-world, per 60-second run, from JFR):

| Scenario | G1 | G1 + compact headers | ZGC | Shenandoah |
|---|---|---|---|---|
| Villagers: total / longest | 21 / 63 ms | 25 / 74 ms | 0.1 / 0.03 ms | 0.7 / 0.7 ms |
| Items: total / longest | 91 / 115 ms | 87 / 93 ms | 0.2 / 0.03 ms | 1.4 / 0.4 ms |
| Cramming: total / longest | 0 / 0 ms | 50 / 83 ms | 0.1 / 0.04 ms | 0.9 / 0.7 ms |
| Worldgen: total / longest | 362 / **383 ms** | 387 / **494 ms** | 0.2 / 0.05 ms | 5 / 4 ms |

**Average tick time (MSPT)** and **memory**:

| Scenario | G1 | G1 + compact headers | ZGC | ZGC + compact headers | Shenandoah |
|---|---|---|---|---|---|
| Villagers | 13.4 | 13.5 | 13.1 | 12.7 | 22.2 (erratic: 12–32) |
| Cramming | 5.7 | **4.3** | 5.2 | 5.1 | 4.4 |
| Items | 5.0 | 5.3 | 5.8 | 7.2 | 4.8 |
| Worldgen (chunks/s) | 24.3 | 24.5 | 22.7 | 22.2 | 20.8 |
| Memory after GC, villagers | 163 MB | **149 MB** | 252 MB | 234 MB | 172 MB |

## What it means

**Compact object headers: free memory, turn them on.**
- They cut memory in use by 7–9% in every scenario (for example 163 → 149 MB with 300
  villagers), with no measured slowdown.
- It's one flag, and it's stable in Java 25.

**G1 (the default) really does freeze the server now and then.**
- Single pauses of 60–115 ms with entities, and **up to half a second** while generating
  chunks.
- At 50 ms per tick, a 400 ms pause is 8 ticks lost in one stutter.

**ZGC removes the freezes entirely.**
- Its pauses never exceeded 0.08 ms in any run.
- The cost on this 4-CPU machine:
  - Its background work competes with the game for CPU, so average tick time rose about
    14% in the allocation-heavy items test. It was about equal elsewhere.
  - Chunks generated about 7% slower.
  - It used about 90 MB more memory.
- On a computer with more cores (6 or more), the background work has room and the cost
  should shrink. Worth testing on your PC.
- Combining it with compact headers gave mixed results (items got worse), so don't
  combine them until that's re-tested.

**Shenandoah: short pauses, but unreliable.** Villager runs ranged from 12 to 32 ms, and it
generated chunks 15% slower. Not recommended.

**Correction to the first findings.** The first session blamed GC for all the 200–340 ms
slowest ticks. With a settled world, G1's real pauses are 60–115 ms in the entity tests.
Much of the earlier spikes came from the fresh world still generating and saving in the
background. Worldgen is the exception: there, G1 really does pause for up to 0.5 s.

## Recommendation

| Machine | Flags |
|---|---|
| 4 CPU cores or fewer | Default G1 plus `-XX:+UseCompactObjectHeaders` |
| 6+ cores with memory to spare | `-XX:+UseZGC`: no GC stutters at all (measure it on your own hardware) |

Either way, set the minimum and maximum heap to the same size (`-Xms` = `-Xmx`) on a
server, as all these runs did.
