# Benchmarks

Repeatable server-side benchmarks. Each run starts a real headless Minecraft server with a
chosen set of mods, builds one scenario in a fresh world, lets the game warm up, measures
every tick, and writes the results. A report then compares mod sets side by side.

## What's here

| Path | What it is |
|---|---|
| `bench.py` | Runs benchmarks and writes reports. Python 3 standard library only. |
| `driver/` | A small helper mod that builds scenarios and measures ticks. It does nothing unless the benchmark starts it, and it's never shipped. |
| `stacks/` | Mod sets to compare. One JSON file each, with exact mod versions. |
| `results/` | Committed results: one folder per benchmark session, with `REPORT.md` and one JSON file per run. |
| `work/` | Server folders, downloads, logs, and JFR recordings. Not committed. |

## Scenarios

| Name | Workload | Main number |
|---|---|---|
| `idle` | An empty platform | MSPT: the server's cost of doing nothing |
| `villagers` | 300 villagers in one-block trading cells beside workstations | MSPT |
| `cramming` | 200 cows packed into an 8×8 pen | MSPT |
| `items` | 1,200 item entities of different types on a 16×16 floor | MSPT |
| `hoppers` | 50 chains of 20 hoppers (1,000 total) moving items between barrels | MSPT, plus items delivered (a parity check) |
| `worldgen` | 625 new chunks generated far from spawn, like a player arriving | chunks per second, plus MSPT while generating |

**How a run works:**
1. The server starts with a fresh world (seed `cloudly`).
2. The driver freezes time and weather and turns off natural mob spawning and cramming
   damage, so the workload stays the same for the whole run.
3. It force-loads a 4×4-chunk platform high in the sky (y = 199) and builds the scenario
   there with ordinary game commands.
4. It warms up for 600 ticks (30 s), then measures 1,200 ticks (60 s). JFR records the
   measured window.

**Limits:** no players are online, so anything that only happens near a player isn't
covered: natural mob spawning, random ticks such as crop growth, and chunk sending.

## Running it

You need **Java 25** and **Python 3**. On Bazzite (and other Linux systems where you'd
rather not install system packages):

1. Download a JDK 25 `.tar.gz` for Linux x64, for example Eclipse Temurin from
   adoptium.net.
2. Unpack it in your home folder.
3. Point `JAVA_HOME` at it:

   ```
   export JAVA_HOME=~/jdk-25.0.x+y     # the folder you unpacked
   export PATH="$JAVA_HOME/bin:$PATH"
   ```

Then, from `projects/minecraft-optimization/`:

```
./gradlew build                                   # builds Cloudly and the driver
python3 benchmarks/bench.py run --stacks baseline,lithium --repeats 3
python3 benchmarks/bench.py run --stacks baseline --scenarios villagers --repeats 1   # one quick run
```

Each run takes about 1–2 minutes. The full set (6 scenarios × 2 stacks × 3 repeats) takes
about an hour.

Useful options:

| Option | Default | What it does |
|---|---|---|
| `--stacks a,b` | `baseline` | Mod sets to compare |
| `--scenarios a,b` | all six | Which scenarios to run |
| `--repeats N` | 3 | Runs per scenario and stack. Use at least 3 for real comparisons. |
| `--heap 4G` | `4G` | Server memory |
| `--jvm-arg X` | none | Extra JVM argument, repeatable. For example `--jvm-arg=-XX:+UseZGC` |
| `--hot-methods` | off | Adds the top methods from each JFR recording to the report |
| `--label NAME` | date + stacks | Name of the results folder |

To rebuild a report later, or to compare against a different stack:

```
python3 benchmarks/bench.py report benchmarks/results/<folder> --baseline lithium --hot-methods
```

Starting a server means accepting the
[Minecraft EULA](https://aka.ms/MinecraftEULA), so `bench.py` writes `eula=true` into the
benchmark server folder.

## Reading a report

- **MSPT** is milliseconds of work per server tick. Lower is better, and 50 is the limit
  before the game slows down.
- Each number is the average over runs, with the lowest and highest run in brackets. If
  two stacks' ranges overlap, the difference may just be noise.
- **vs baseline** is the change in mean MSPT. Negative means faster.
- **Parity:** in the `hoppers` scenario, the number of items delivered must be the same for
  every stack. Vanilla hopper timing is exact, so a different number means an
  optimization changed how hoppers behave.
- The JFR recordings for each run are in the results folder next to the JSON files (not
  committed). Open them in JDK Mission Control, see `docs/PROFILING.md`.

## Adding a stack

Copy `stacks/baseline.json` and add mods by their Modrinth slug and exact version number:

```json
{
  "description": "Baseline plus Lithium.",
  "mods": [
    {"modrinth": "fabric-api", "version": "0.161.0+26.3"},
    {"modrinth": "lithium", "version": "mc26.3-0.26.2-fabric"}
  ],
  "cloudly": false,
  "jvmArgs": []
}
```

Set `"cloudly": true` to include the Cloudly jar built from this repository.
