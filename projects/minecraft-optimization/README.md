# Minecraft Optimization

Goal: make Minecraft: Java Edition run as fast as possible. That means higher and
steadier FPS, lower server tick time, less RAM, and faster startup and world
loading. Gameplay stays the same unless the player turns on an option that
changes it.

**Status:** Planning (Phase 0). No code yet.

## Documents

| File | What's in it |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Strategy, the state of Minecraft modding as of Sept 2026, roadmap, decisions for you to make |
| [`docs/CATALOG.md`](docs/CATALOG.md) | Every optimization idea, grouped by part of the game, with who already does it and what we'd do |
| [`docs/JPROFILER.md`](docs/JPROFILER.md) | Hands-on guide to profiling Minecraft with JProfiler, with exercises |

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

## Planned layout (once code starts)

```
projects/minecraft-optimization/
├── README.md          this file
├── docs/              plans and design notes
├── mod/               the Fabric mod (Gradle project)
├── benchmarks/        scenarios, scripts, and recorded results
└── setups/            recommended JVM flags, server settings, and mod lists
```
