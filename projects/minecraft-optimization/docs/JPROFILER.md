# Learning JProfiler with Minecraft

A hands-on guide to profiling Minecraft with JProfiler. It starts from zero and
ends with you finding lag sources yourself and proving whether a mod fixed them.

Menu and button names below match JProfiler 16 as closely as we could check.
If something is named slightly differently in your version, the idea is the same.

## What a profiler does

A profiler watches a running Java program and tells you where its time and memory
go. For Minecraft that answers questions like:

- Which part of the game is eating the 50 ms each server tick is allowed?
- What causes the stutter every few seconds?
- Which objects fill up RAM?
- Did installing a mod actually make that part faster?

## Which tool does what

| Tool | Where it runs | Used for |
|---|---|---|
| **JProfiler** | Your computer | Hands-on investigation. The best views for digging into a problem. |
| **Java Flight Recorder (JFR)** | Cloud benchmarks, or your computer | Built into Java with very low overhead. The cloud harness records JFR files automatically. **JProfiler can open them.** |
| **Minecraft's `/jfr` command** | In-game | Records a JFR file that also includes Minecraft-specific events: tick times, chunk generation, network packets. |
| **spark** | In-game mod | Quick profile with a shareable web link. Good for "what's lagging right now". |
| **JDK Mission Control** | Your computer | Free viewer for JFR files. The fallback after the JProfiler trial ends. |

## Before you start: the 10-day trial

JProfiler is paid software. The first time you open it, you can start a **free
10-day evaluation**, which is meant for trying it out.

- **Start the trial on a day you have time to use it.** Exercises 1–4 below fit
  in a few evenings, so plan them for the same week.
- After the trial, the same skills carry over to the free tools: JFR, JDK
  Mission Control, and spark.
- ej-technologies gives **free licenses to non-profit open-source projects** that
  have a website and a released product. If we publish this mod as open source,
  we can apply for one then.

## Setup

1. **Install JProfiler** from ej-technologies. The current version is 16.2.x, and
   it runs on Windows, macOS, and Linux.
2. **Use a launcher that lets you set JVM arguments per instance.** Prism Launcher
   is the easiest for modding. The official launcher also works: Installations →
   Edit → More Options → JVM Arguments.
3. **Make a test instance.** Use the same Minecraft version and mod loader as the
   project (see `PLAN.md`), plus the spark mod.
4. **Make a test world and keep a clean copy.** Copy the world folder before each
   test so every run starts from the identical state. Otherwise you're comparing
   different worlds, not different mods.

## Connecting JProfiler to Minecraft

### Option A: attach to the running game (easiest)

1. Start Minecraft and load your test world.
2. In JProfiler, open **Quick Attach** from the start screen.
3. Pick the Minecraft Java process. It usually shows up under its main class, for
   example a Fabric "Knot" class or `net.minecraft.client.main.Main`.
4. When JProfiler asks how to record CPU data, choose **sampling** (see the next
   section).

If Minecraft doesn't appear in the list, use option B. Some bundled Java runtimes
don't allow attaching.

### Option B: load JProfiler when the game starts (always works)

1. In JProfiler, create a **New Session** and use the integration wizard for a
   local Java application launched by hand.
2. The wizard gives you a line starting with `-agentpath:`. Copy it.
3. Paste it into your instance's JVM arguments in the launcher.
4. The wizard asks whether the game should wait for JProfiler to connect at
   startup. Choose "wait" only if you want to profile the startup itself.

This also works for a dedicated server: add the same line to the server's start
command.

## Settings that matter for Minecraft

- **Use sampling, not instrumentation.** Instrumentation measures every single
  method call. Minecraft makes millions of them per second, so instrumentation
  slows the game to a crawl and distorts the results. Sampling checks what each
  thread is doing many times per second, which is cheap and accurate enough. On
  macOS and Linux, pick **async sampling** if it's offered. It's the most accurate.
- **Record one thing at a time.** Record CPU in one run and memory allocations in
  another. Allocation recording adds its own overhead.
- **Warm up first.** Play for 1–2 minutes before recording. Java compiles hot code
  into faster machine code while the game runs, and the first minute isn't
  representative.

## The views you'll use

### Telemetries: the dashboard

Live graphs of the whole game:

- **Memory:** heap use over time. A sawtooth pattern is normal: memory fills up,
  garbage collection clears it, repeat.
- **GC activity:** time spent collecting garbage. Tall spikes line up with
  stutters.
- **CPU load** and **thread count.**

### Threads that matter

| Thread name | What it does |
|---|---|
| `Server thread` | Game ticks: entities, redstone, block entities. MSPT is measured here. Exists in single-player too. |
| `Render thread` | Draws frames. FPS lives here. |
| `Worker-Main-…` | Background work, including chunk generation |
| `IO-Worker-…` | Reading and writing chunks to disk |
| `Netty …` | Networking |

Mods add their own threads, for example Sodium's chunk builders or C2ME's
workers. Exact names can vary between versions.

### CPU views: where the time goes

- **Call tree (top-down).** Starts at the top of a thread and branches into what
  it calls. Pick `Server thread`, then drill down: server tick → world tick →
  entity ticks → a specific mob's AI. Each node shows its **total time**,
  including everything it calls.
- **Hot spots (bottom-up).** Lists methods by **self time**, the work done inside
  that method itself. This is where optimization targets come from.
- **Thread state filter: set it to "Runnable".** This is the biggest beginner
  trap. When ticks are fast, the server thread sleeps until the next tick. With
  "all states", that sleep shows up as the biggest cost. "Runnable" shows only
  actual work.

Since Minecraft 26.1 the game's code has real names, so what you see is readable,
like `...ai.sensing.NearestLivingEntitySensor`. On older versions (1.21.1 and
below), the same method shows up as a code like `class_1234.method_5678` or
`m_12345_`.

### Memory views: what fills RAM and what causes GC stutter

- **Allocation call tree / allocation hot spots** (needs allocation recording):
  which code creates the most objects. Lots of short-lived objects → frequent
  garbage collection → stutter.
- **All objects / heap walker:** what's taking up memory right now. Useful for
  finding memory leaks.

### Monitors and locks: threads waiting on each other

Shows threads blocked waiting for another thread. This matters for chunk loading,
where worker threads hand work back to the server thread.

### Snapshots and comparing them

- **Save a snapshot** (`.jps` file) after each recording and name it clearly, like
  `02-villagers-vanilla.jps`.
- **Compare two snapshots** to see which methods got faster or slower. This is
  how we prove every "before vs. after" in this project.

## Exercises

Do these in order. Save a snapshot at the end of each one and write down what you
found.

### 1. First look (≈30 min)

1. Load an idle world and attach JProfiler.
2. Watch the telemetries for 2 minutes. Find the sawtooth in Memory and any
   spikes in GC activity.
3. Find `Server thread` and `Render thread` in the thread views.
4. Record CPU for 60 seconds. In Hot Spots, pick `Server thread` and set the
   state to Runnable. Then look at the same thread with "all states" to see the
   sleeping trap for yourself.
5. Save as `01-idle`.

### 2. Villager lag (≈45 min)

1. In a creative test world, fence in an area and add about 200 villagers with
   spawn eggs. Add beds and workstations too, because villagers constantly search
   for them.
2. Wait 2 minutes to warm up, then record CPU for 60 seconds.
3. Open Hot Spots for `Server thread` (Runnable). Look for names containing
   `Sensor`, `Brain`, `Behavior`, `PathFinder`, and `PoiManager`.
4. Write down the top 5 hot spots and their percentages.
5. Save as `02-villagers-vanilla`.

### 3. Stutter hunting (≈45 min)

1. Set render distance high. In spectator mode, fly fast in a straight line into
   terrain you haven't visited.
2. Watch GC activity while flying.
3. Record allocations for 30 seconds. In allocation hot spots, see which objects
   are created the most and by which code.
4. Save as `03-flight`.

### 4. Before and after (≈45 min)

1. Add Lithium to the instance.
2. Restore the **same** world copy from exercise 2 and repeat it exactly.
3. Save as `04-villagers-lithium`.
4. Compare `02` against `04`. Which hot spots shrank? What's still at the top?
   Whatever's left is a candidate for our mod.

### 5. Open a recording from the cloud (≈15 min)

1. Once the benchmark harness exists (Phase 1), its JFR recordings will be saved
   in `benchmarks/`.
2. Open one in JProfiler with the open-snapshot option.
3. You can make your own too: in a world with cheats on, run `/jfr start`, play
   for a minute, then run `/jfr stop`. The game tells you where it saved the file.

### Optional: let Claude drive JProfiler

JProfiler 16.1 and newer include an MCP server that lets AI coding agents run
profiling sessions and read the results. If you ever run Claude Code on your own
computer instead of in the cloud, it could profile the game directly.

## Not fooling yourself

- **One run isn't a result.** Repeat each measurement at least 3 times.
- **Keep everything the same:** world copy, standing position, settings, in-game
  time and weather (freeze both), and render distance.
- **Close other programs,** especially browsers and anything recording video.
- **The profiler itself slows the game a little.** Compare profiled runs with
  other profiled runs, never with normal play.
- **Look at percentages, not raw counts.** Sampling counts depend on how long you
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
| Instrumentation | Measuring every method call exactly. Very expensive for games. |
| Call tree | Time broken down from the top of a thread downward |
| Hot spot | A method with high self time |
| Self time | Time spent inside a method itself, not counting what it calls |
| Total time | Self time plus the time of everything the method calls |
| Snapshot | A saved recording you can reopen and compare |
