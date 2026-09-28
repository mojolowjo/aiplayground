# Learning to Profile Minecraft (Free Tools)

A hands-on guide to finding out why Minecraft lags, using only free tools. It
starts from zero and ends with you proving whether a mod actually fixed a problem.

Menu names below match current versions as closely as we could check. If
something is named slightly differently on your screen, the idea is the same.

## What a profiler does

A profiler watches a running Java program and tells you where its time and memory
go. For Minecraft that answers questions like:

- Which part of the game is eating the 50 ms each server tick is allowed?
- What causes the stutter every few seconds?
- Which objects fill up RAM?
- Did installing a mod actually make that part faster?

## The tools

All free.

| Tool | What it is | Use it for |
|---|---|---|
| **spark** | A Minecraft mod | Quick in-game checks. `/spark profiler` gives you a web link with the results. It can show which mod is responsible for lag. |
| **Java Flight Recorder (JFR)** | Built into Java | Records everything (CPU, memory, garbage collection, threads) into a `.jfr` file with very little slowdown. The cloud benchmarks record these too. |
| **JDK Mission Control (JMC)** | Desktop app | Opens `.jfr` files. Your main tool for digging in: hot methods, flame graphs, allocations, GC pauses, locks. |
| **VisualVM** | Desktop app | Live graphs and heap dumps. Use it for hunting memory leaks. |
| **`jfr` command** | Comes with Java | Prints quick tables from a `.jfr` file, like `jfr view hot-methods recording.jfr`. Our before/after reports are built on it. |

### How this compares to paid profilers

Paid profilers like JProfiler put all of this in one app and let you watch live.
The free setup covers everything this project needs, with two differences:

- **Record first, then look.** JFR records for a while, then JMC shows the
  results. You don't watch a live call tree.
- **Comparing runs** is done by our report script instead of a built-in button.

### What works on which operating system

| | Windows | macOS | Linux |
|---|---|---|---|
| JFR + JMC (CPU, memory, GC, locks) | ✔ | ✔ | ✔ |
| VisualVM | ✔ | ✔ | ✔ |
| spark CPU profiling | ✔ (built-in Java sampler) | ✔ (built-in Java sampler) | ✔ (async-profiler, most accurate) |
| spark allocation profiling (`--alloc`) | ✘, use JFR instead | ✘, use JFR instead | ✔ |

## Setup

1. **Install JDK Mission Control 9.** It's a free download from
   `jdk.java.net/jmc`. Some Java vendors also package it.
2. **Install VisualVM** from `visualvm.github.io`. You can skip this until
   exercise 5.
3. **Use a launcher that lets you set JVM arguments per instance.** Prism Launcher
   is the easiest for modding. The official launcher also works: Installations →
   Edit → More Options → JVM Arguments.
4. **Make a test instance** with the project's Minecraft version (see `PLAN.md`),
   Fabric, and the **spark** mod.
5. **Make a test world and keep a clean copy.** Copy the world folder before each
   test so every run starts from the identical state. Otherwise you're comparing
   different worlds, not different mods.

## Recording with JFR: three ways

### A. From JMC while the game runs (easiest)

1. Start Minecraft and load your test world.
2. In JMC, find the Minecraft process in the **JVM Browser** panel on the left.
3. Expand it, right-click **Flight Recorder**, and choose **Start Flight
   Recording**.
4. Pick the **Profiling** template (more detail than "Continuous"), set a
   duration like 60 seconds, and click **Finish**.
5. Play your test scenario. When the time is up, JMC opens the recording.

If Minecraft doesn't show up in the JVM Browser, use B or C.

### B. With a JVM argument (always works)

Add this to the instance's JVM arguments:

```
-XX:StartFlightRecording=delay=2m,duration=60s,settings=profile,filename=minecraft.jfr
```

The recording starts 2 minutes after launch (warm-up time), runs for 60 seconds,
and saves `minecraft.jfr` in the game folder. Open it in JMC with File → Open File.

### C. With Minecraft's `/jfr` command

In a world with cheats on, run `/jfr start`, play for a minute, then run
`/jfr stop`. The game tells you where it saved the file. These recordings also
include Minecraft's own events: tick times, chunk generation, and network
packets.

## Using spark

spark is the quickest way to answer "what's lagging right now".

- **Server side:** `/spark profiler start --timeout 60`. This also works in
  single-player with cheats on. When it finishes, spark posts a link in chat.
- **Client side (FPS):** use `/sparkc` instead of `/spark`.
- **Useful extras:**
  - `/spark tps` shows ticks per second and tick times.
  - `/spark health` gives an overview of CPU, memory, and tick times.
  - `/spark gc` shows garbage collection stats.
  - `/spark tickmonitor` reports lag spikes as they happen.
- **Watch out for sleep.** When ticks are fast, the server thread sleeps until
  the next tick. spark counts that sleep unless you add `--ignore-sleeping`.
  Otherwise sleep can look like the biggest cost.
- **Privacy:** spark uploads results to its website to show them. The link is
  unlisted, but anyone who has it can see the profile.

In the web viewer:

- **Tree** view is top-down: time broken down from the tick into what it calls.
- **Flat** view is bottom-up: the methods doing the most work themselves.
- spark can also group time by mod, which shows whose code is slow.

## Settings that matter

- **Warm up first.** Play for 1–2 minutes before recording. Java compiles hot code
  into faster machine code while the game runs, and the first minute isn't
  representative.
- **Use the Profiling template** in JMC for investigations. "Continuous" records
  less detail.
- **Record about 60 seconds.** Much shorter misses things. Much longer makes files
  slow to open.

## Reading a recording in JMC

After a recording opens, the **Outline** panel on the left lists these pages.

### Automated Analysis Results: start here

JMC checks the recording against a list of known problems and scores each one.
Examples are long GC pauses, heavy allocation, lock contention, and hot methods.
Red and yellow items tell you where to look first.

### Threads

A timeline of every thread. The ones that matter for Minecraft:

| Thread name | What it does |
|---|---|
| `Server thread` | Game ticks: entities, redstone, block entities. MSPT is measured here. Exists in single-player too. |
| `Render thread` | Draws frames. FPS lives here. |
| `Worker-Main-…` | Background work, including chunk generation |
| `IO-Worker-…` | Reading and writing chunks to disk |
| `Netty …` | Networking |

Mods add their own threads, for example Sodium's chunk builders or C2ME's
workers. Exact names can vary between versions.

Select a thread and use it as a filter for the other pages (JMC calls this the
**focused selection**). That way you look at only `Server thread` or only
`Render thread`.

### Method Profiling: where the CPU time goes

- **Top methods** are the methods seen most often doing work. This is the
  "hot spots" list, and where optimization targets come from.
- The **stack trace** panel shows how each hot method was reached, for example
  server tick → world tick → entity tick → villager brain → sensor.
- **Flame graph** (Window → Show View → Flame Graph) shows the same data as a
  picture. Wide bars are expensive. Read it from the bottom up.

JFR only samples threads that are actually running Java code, so the
sleeping-server-thread trap from spark doesn't apply here.

### Memory: what's creating objects

Shows which classes are allocated most, and from where. Lots of short-lived
objects → frequent garbage collection → stutter.

### Garbage Collections: stutter from memory cleanup

Every GC pause, with how long it took. Pauses longer than a frame (about 16 ms at
60 FPS) are visible stutter.

### Lock Instances: threads waiting on each other

Shows where threads were blocked waiting for another thread. This matters for
chunk loading, where worker threads hand work back to the server thread.

Since Minecraft 26.1 the game's code has real names, so the method names you see
are readable, like `...ai.sensing.NearestLivingEntitySensor`.

## Quick tables with the `jfr` command

The `jfr` program ships with Java, in the same `bin` folder as `java`. It prints
summaries straight from a recording:

```
jfr view hot-methods minecraft.jfr         # where CPU time goes
jfr view allocation-by-site minecraft.jfr  # which code creates the most objects
jfr view gc-pauses minecraft.jfr           # garbage-collection pauses
jfr view contention-by-site minecraft.jfr  # where threads wait on locks
```

Our before/after report script runs views like these on two recordings and puts
the results side by side.

## Exercises

Do these in order. Keep your recordings, name them clearly (like
`02-villagers-vanilla.jfr`), and write down what you found.

### 1. First look with spark (≈20 min)

1. Load an idle world with cheats on.
2. Run `/spark health` and `/spark tps` and read the numbers.
3. Run `/spark profiler start --timeout 60`, and when the link appears, open it.
4. Look at the Tree view, then the Flat view.
5. Run the profile again with `--ignore-sleeping` and see how different the idle
   server thread looks.

### 2. Villager lag with JMC (≈45 min)

1. In a creative test world, fence in an area and add about 200 villagers with
   spawn eggs. Add beds and workstations too, because villagers constantly search
   for them.
2. Wait 2 minutes, then record 60 seconds with JMC using the Profiling template.
3. Read **Automated Analysis** first.
4. Focus on `Server thread`, open **Method Profiling**, and look for names
   containing `Sensor`, `Brain`, `Behavior`, `PathFinder`, and `PoiManager`.
5. Open the flame graph and find the same methods there.
6. Write down the top 5 methods. Save the recording as `02-villagers-vanilla.jfr`.

### 3. Stutter hunting (≈45 min)

1. Set render distance high. In spectator mode, fly fast in a straight line into
   terrain you haven't visited, while recording.
2. In JMC, open **Garbage Collections**. How long are the longest pauses?
3. Open **Memory**. Which classes are allocated most, and by which code?
4. Save as `03-flight.jfr`.

### 4. Before and after (≈45 min)

1. Add Lithium to the instance.
2. Restore the **same** world copy from exercise 2 and repeat it exactly.
3. Save as `04-villagers-lithium.jfr`.
4. Run `jfr view hot-methods` on both files and compare the lists. Which methods
   shrank? What's still at the top? Whatever's left is a candidate for our mod.

### 5. Memory leak check with VisualVM (≈30 min)

1. Start Minecraft and open VisualVM. Select the Minecraft process and open the
   **Monitor** tab.
2. Join and leave a world 5 times.
3. Click **Perform GC** and watch the heap graph. Heap use should return to
   roughly the same level each time. If it keeps climbing, something is being
   kept in memory that shouldn't be.
4. Take a **Heap Dump** and look at which classes have the most instances.

### 6. Open a recording from the cloud (≈15 min)

Once the benchmark harness exists (Phase 1), its recordings will be saved in
`benchmarks/`. Open one in JMC and compare it with what you recorded yourself.

## Not fooling yourself

- **One run isn't a result.** Repeat each measurement at least 3 times.
- **Keep everything the same:** world copy, standing position, settings, in-game
  time and weather (freeze both), and render distance.
- **Close other programs,** especially browsers and anything recording video.
- **Recording adds a little overhead.** Compare recorded runs with other recorded
  runs, never with normal play.
- **Look at percentages, not raw counts.** Sample counts depend on how long you
  recorded.

## Glossary

| Term | Meaning |
|---|---|
| Tick | One step of the game simulation. 20 per second when healthy. |
| TPS | Ticks per second. Below 20 means the world is running slow. |
| MSPT | Milliseconds per tick. Must stay under 50 for a full 20 TPS. |
| FPS / 1% low | Frames per second. The 1% low is the FPS during the worst 1% of frames, which is how stutter shows up in numbers. |
| Heap | The memory Java manages for the game's objects |
| Allocation | Creating a new object on the heap |
| GC (garbage collection) | Java freeing memory from objects no longer in use. It can pause the game. |
| JIT | Java compiling frequently used code into fast machine code while the game runs |
| Sampling | Checking what each thread is doing many times a second. Cheap. |
| Top-down / tree view | Time broken down from the top of a thread downward |
| Bottom-up / flat view / hot methods | Methods ranked by the work they do themselves |
| Flame graph | A picture of the call tree. Wider bars mean more time. |
| Heap dump | A snapshot of every object in memory, for finding leaks |
| Recording | A saved `.jfr` file you can reopen and compare |
