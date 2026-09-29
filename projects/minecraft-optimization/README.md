# Minecraft Optimization — Cloudly

Goal: make Minecraft: Java Edition run as fast as possible. That means higher and
steadier FPS, lower server tick time, less RAM, and faster startup and world
loading. Gameplay stays the same unless the player turns on an option that
changes it.

**Status:** Phase 1 done: mod skeleton, benchmark harness, and first baseline results.
Next: Phase 2, tuning the existing mod stack.

## Documents

| File | What's in it |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Strategy, the state of Minecraft modding as of Sept 2026, roadmap, decisions for you to make |
| [`docs/CATALOG.md`](docs/CATALOG.md) | Every optimization idea, grouped by part of the game, with who already does it and what we'd do |
| [`docs/PROFILING.md`](docs/PROFILING.md) | Hands-on guide to profiling Minecraft with free tools (JFR, JDK Mission Control, spark, VisualVM), with exercises |

## Summary

1. **Measure first.** Build a benchmark harness before writing any optimization.
   Nothing ships without a before/after number.
2. **Stand on existing work.** Sodium, Lithium, and others already cover the big,
   well-known wins. We use them, test them together, and pick the best setup by
   measurement. Where we think we can beat one of them, we build our version and
   race it head-to-head. Ours ships only if it wins.
3. **Write our own mod for the gaps.** After profiling the fully optimized setup,
   whatever is still slow becomes our target list.
4. **Server side first, client rendering later.** Minecraft's renderer is being
   swapped from OpenGL to Vulkan right now (26.4 snapshots). Rendering work done
   today would likely be thrown away. Server-side work isn't affected.

## Layout

```
projects/minecraft-optimization/
├── README.md              this file
├── LICENSE                MIT
├── docs/                  plans, catalog, profiling guide
├── mod/                   Cloudly, the Fabric mod
├── benchmarks/            benchmark harness and committed results (see its README)
│   ├── bench.py           runs benchmarks and writes reports
│   ├── driver/            helper mod that builds scenarios and measures ticks
│   ├── stacks/            mod sets to compare
│   └── results/           reports and per-run results
├── build.gradle, settings.gradle, gradle.properties, gradlew
└── setups/                (Phase 2) recommended JVM flags, server settings, mod lists
```

## Building

Needs Java 25. From this folder:

```
./gradlew build
```

The mod jar ends up in `mod/build/libs/cloudly-<version>.jar`. GitHub also builds it
automatically on every push that touches this folder (the "minecraft-optimization"
workflow); the jar is attached to each run as an artifact.

## Cloudly settings

Every optimization is a switch in `config/cloudly.properties`, which Cloudly creates on
first launch with every option listed and commented. Explicit settings always win. When
another mod that already does the same job is installed (Lithium, for example), the
matching Cloudly option turns itself off unless you turn it back on. There are no
optimizations yet: Phase 1 built the switchboard and the benchmarks first.
