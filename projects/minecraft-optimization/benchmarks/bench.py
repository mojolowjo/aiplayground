#!/usr/bin/env python3
"""Runs Cloudly's server benchmarks and turns the results into reports.

    python3 benchmarks/bench.py run --stacks baseline,lithium --repeats 3
    python3 benchmarks/bench.py report benchmarks/results/<label>

See benchmarks/README.md for details. Needs Java 25 and Python 3.9+, nothing else.
"""
import argparse
import datetime
import hashlib
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BENCH_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BENCH_DIR.parent
WORK_DIR = BENCH_DIR / "work"
CACHE_DIR = WORK_DIR / "cache"
RESULTS_DIR = BENCH_DIR / "results"
STACKS_DIR = BENCH_DIR / "stacks"
SCENARIOS = ["idle", "villagers", "cramming", "items", "hoppers", "worldgen"]
USER_AGENT = "mojolowjo/aiplayground cloudly-bench (https://github.com/mojolowjo/aiplayground)"

SERVER_PROPERTIES = {
    "online-mode": "false",
    "server-port": "25599",
    "level-seed": "cloudly",
    "pause-when-empty-seconds": "0",  # keep ticking with no players online
    "max-tick-time": "-1",  # no watchdog: slow setup ticks must not crash the server
    "view-distance": "10",
    "simulation-distance": "10",
    "spawn-protection": "0",
    "enable-query": "false",
    "enable-rcon": "false",
    "motd": "Cloudly benchmark",
}


# ---------------------------------------------------------------- downloads

def fetch_json(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def download(url, dest, sha512=None):
    if dest.exists() and (sha512 is None or file_sha512(dest) == sha512):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    partial = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(request, timeout=300) as response, open(partial, "wb") as out:
        shutil.copyfileobj(response, out)
    if sha512 is not None and file_sha512(partial) != sha512:
        partial.unlink()
        sys.exit(f"Checksum mismatch downloading {url}")
    partial.replace(dest)
    return dest


def file_sha512(path):
    digest = hashlib.sha512()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def gradle_properties():
    props = {}
    for line in (PROJECT_DIR / "gradle.properties").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            props[key.strip()] = value.strip()
    return props


def fabric_server_launcher(minecraft, loader):
    installer = next(v["version"] for v in fetch_json("https://meta.fabricmc.net/v2/versions/installer")
                     if v["stable"])
    name = f"fabric-server-mc.{minecraft}-loader.{loader}-launcher.{installer}.jar"
    url = f"https://meta.fabricmc.net/v2/versions/loader/{minecraft}/{loader}/{installer}/server/jar"
    return download(url, CACHE_DIR / "launchers" / name)


def modrinth_mod(slug, version):
    versions = fetch_json(f"https://api.modrinth.com/v2/project/{slug}/version")
    match = next((v for v in versions if v["version_number"] == version), None)
    if match is None:
        sys.exit(f"Modrinth has no version '{version}' of '{slug}'")
    file = next((f for f in match["files"] if f["primary"]), match["files"][0])
    return download(file["url"], CACHE_DIR / "mods" / file["filename"], file["hashes"]["sha512"])


def built_jar(subdir, prefix):
    jars = [p for p in (PROJECT_DIR / subdir / "build" / "libs").glob(f"{prefix}-*.jar")
            if not p.name.endswith("-sources.jar")]
    if not jars:
        sys.exit(f"No {prefix} jar found. Run ./gradlew build in {PROJECT_DIR} first.")
    return max(jars, key=lambda p: p.stat().st_mtime)


# ---------------------------------------------------------------- running

def java_tool(name, override=None):
    if override:
        return override
    home = os.environ.get("JAVA_HOME")
    if home and (Path(home) / "bin" / name).exists():
        return str(Path(home) / "bin" / name)
    return name


def load_stack(name):
    path = STACKS_DIR / f"{name}.json"
    if not path.exists():
        sys.exit(f"Unknown stack '{name}'. Stacks live in {STACKS_DIR}.")
    return json.loads(path.read_text())


def template_world(launcher, args):
    """The saved world every run starts from, created once with no optimization mods.

    A brand-new world keeps generating and saving the area around spawn for minutes, which
    showed up as stretches of slow ticks during measurements. Starting from a settled copy
    removes that.
    """
    props = gradle_properties()
    template = WORK_DIR / "templates" / f"{props['minecraft_version']}-seed-{SERVER_PROPERTIES['level-seed']}"
    if (template / "level.dat").exists():
        return template
    print("Creating the template world (once)...")
    stack = load_stack("baseline")
    server_dir = prepare_server("template", stack, launcher, None)
    out_json = WORK_DIR / "templates" / "prepare.json"
    prepare_args = argparse.Namespace(**{**vars(args), "warmup": 2400, "measure": 20, "no_jfr": True})
    result = run_once(server_dir, "template", stack, "prepare", 1, out_json, prepare_args)
    if result is None or result.get("status") != "ok":
        sys.exit("Could not create the template world.")
    shutil.rmtree(template, ignore_errors=True)
    shutil.copytree(server_dir / "world", template)
    return template


def prepare_server(stack_name, stack, launcher, template):
    """A server folder per stack. Libraries persist between runs; the world and mods don't."""
    server_dir = WORK_DIR / "servers" / stack_name
    server_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(launcher, server_dir / "fabric-server-launch.jar")
    for folder in ("mods", "world", "config", "logs"):
        shutil.rmtree(server_dir / folder, ignore_errors=True)
    if template is not None:
        shutil.copytree(template, server_dir / "world")
    mods_dir = server_dir / "mods"
    mods_dir.mkdir()
    jars = [modrinth_mod(m["modrinth"], m["version"]) for m in stack["mods"]]
    jars.append(built_jar("benchmarks/driver", "cloudly-bench-driver"))
    if stack.get("cloudly"):
        jars.append(built_jar("mod", "cloudly"))
    for jar in jars:
        shutil.copy2(jar, mods_dir / jar.name)
    # Running a server means accepting Minecraft's EULA: https://aka.ms/MinecraftEULA
    (server_dir / "eula.txt").write_text("eula=true\n")
    (server_dir / "server.properties").write_text(
        "".join(f"{key}={value}\n" for key, value in SERVER_PROPERTIES.items()))
    return server_dir


def run_once(server_dir, stack_name, stack, scenario, run_index, out_json, args):
    properties = {
        "scenario": scenario,
        "stack": stack_name,
        "run": run_index,
        "warmup": args.warmup,
        "measure": args.worldgen_cap if scenario == "worldgen" else args.measure,
        "output": out_json,
        "jfr": "false" if args.no_jfr else "true",
    }
    command = [java_tool("java", args.java), f"-Xms{args.heap}", f"-Xmx{args.heap}"]
    command += stack.get("jvmArgs", []) + args.jvm_arg
    command += [f"-Dcloudly.bench.{key}={value}" for key, value in properties.items()]
    command += ["-jar", "fabric-server-launch.jar", "nogui"]

    log_path = WORK_DIR / "logs" / f"{out_json.parent.parent.name}-{stack_name}-{scenario}-{run_index}.log"
    if scenario == "prepare":
        log_path = WORK_DIR / "logs" / "prepare-template.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    start = time.monotonic()
    with open(log_path, "w") as log:
        try:
            subprocess.run(command, cwd=server_dir, stdin=subprocess.DEVNULL, stdout=log,
                           stderr=subprocess.STDOUT, timeout=args.timeout * 60, check=False)
        except subprocess.TimeoutExpired:
            print(f"    timed out after {args.timeout} minutes, see {log_path}")
            return None
    if not out_json.exists():
        print(f"    no result written, see {log_path}")
        return None
    result = json.loads(out_json.read_text())
    mspt = result.get("mspt", {})
    extra = result.get("scenarioResults", {})
    print(f"    {result['status']}: MSPT mean {mspt.get('mean', '?')} ms, p99 {mspt.get('p99', '?')} ms"
          f"{'' if not extra else ', ' + json.dumps(extra)} ({time.monotonic() - start:.0f}s)")
    return result


def cmd_run(args):
    props = gradle_properties()
    stacks = {name: load_stack(name) for name in args.stacks.split(",")}
    scenarios = args.scenarios.split(",")
    for scenario in scenarios:
        if scenario not in SCENARIOS:
            sys.exit(f"Unknown scenario '{scenario}'. Known: {', '.join(SCENARIOS)}")
    label = args.label or datetime.date.today().isoformat() + "-" + "-".join(stacks)
    out_dir = RESULTS_DIR / label
    launcher = fabric_server_launcher(props["minecraft_version"], props["loader_version"])
    template = template_world(launcher, args)
    print(f"Minecraft {props['minecraft_version']}, Fabric Loader {props['loader_version']}")
    print(f"Results: {out_dir}")

    # Rotate through stacks inside each repeat, so slow drift on the machine (heat, other
    # load) spreads evenly instead of favoring whichever stack ran first.
    failures = 0
    for run_index in range(1, args.repeats + 1):
        for scenario in scenarios:
            for stack_name, stack in stacks.items():
                print(f"[run {run_index}/{args.repeats}] {scenario} on {stack_name}")
                server_dir = prepare_server(stack_name, stack, launcher, template)
                out_json = out_dir / stack_name / f"{scenario}-run{run_index}.json"
                out_json.parent.mkdir(parents=True, exist_ok=True)
                out_json.unlink(missing_ok=True)
                result = run_once(server_dir, stack_name, stack, scenario, run_index, out_json, args)
                if result is None or result.get("status") != "ok":
                    failures += 1
    write_report(out_dir, args.baseline if args.baseline in stacks else next(iter(stacks)), args.hot_methods)
    print(f"Report: {out_dir / 'REPORT.md'}")
    return 1 if failures else 0


# ---------------------------------------------------------------- reporting

def load_results(out_dir):
    results = {}
    for path in sorted(out_dir.glob("*/*-run*.json")):
        data = json.loads(path.read_text())
        if data.get("status") == "ok":
            data["_path"] = path
            results.setdefault((data["stack"], data["scenario"]), []).append(data)
    return results


def spread(values, digits=2):
    mean = statistics.fmean(values)
    if len(values) == 1:
        return f"{mean:.{digits}f}"
    return f"{mean:.{digits}f} ({min(values):.{digits}f}–{max(values):.{digits}f})"


def hot_methods(jfr_file, jfr_tool, lines=12):
    try:
        output = subprocess.run([jfr_tool, "view", "--width", "160", "hot-methods", str(jfr_file)],
                                capture_output=True, text=True, timeout=300, check=True).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    table = [line for line in output.splitlines() if line.strip()]
    return "\n".join(table[:lines + 3])


def write_report(out_dir, baseline, include_hot_methods, jfr_tool=None):
    results = load_results(out_dir)
    if not results:
        print("No successful results to report.")
        return
    stacks = sorted({stack for stack, _ in results}, key=lambda s: (s != baseline, s))
    scenarios = [s for s in SCENARIOS if any(key[1] == s for key in results)]
    first = next(iter(results.values()))[0]
    jvm = first["jvm"]

    lines = [f"# Benchmark report: {out_dir.name}", ""]
    lines.append(f"- Minecraft {first['minecraft']}, Java {jvm['version']} ({jvm['vendor']})")
    lines.append(f"- {jvm['cpus']} CPUs, {jvm['maxHeapMb']} MB max heap, GC: {', '.join(jvm['garbageCollectors'])}")
    lines.append(f"- Baseline for comparisons: `{baseline}`")
    lines.append("- MSPT = milliseconds of work per server tick (lower is better; 50 is the limit).")
    lines.append("  Numbers are the average over runs, with the lowest and highest run in brackets.")
    lines.append("")

    startup = {}
    for (stack, _), runs in results.items():
        startup.setdefault(stack, []).extend(r["startupMillis"] / 1000 for r in runs if "startupMillis" in r)
    if any(startup.values()):
        lines += ["## Startup", "", "Seconds from launching Java to the server being ready, including creating a fresh",
                  "world. Averaged over every run of every scenario.", "",
                  "| Stack | Runs | Launch to ready (s) |", "|---|---|---|"]
        for stack in stacks:
            if startup.get(stack):
                lines.append(f"| `{stack}` | {len(startup[stack])} | {spread(startup[stack], 1)} |")
        lines.append("")

    for scenario in scenarios:
        description = next(r for (st, sc), rs in results.items() if sc == scenario for r in rs)["description"]
        lines += [f"## {scenario}", "", description, ""]
        lines.append("| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |")
        lines.append("|---|---|---|---|---|---|---|---|---|")
        base_runs = results.get((baseline, scenario))
        base_mean = statistics.fmean(r["mspt"]["mean"] for r in base_runs) if base_runs else None
        for stack in stacks:
            runs = results.get((stack, scenario))
            if not runs:
                continue
            means = [r["mspt"]["mean"] for r in runs]
            change = ""
            if base_mean and stack != baseline:
                change = f"{(statistics.fmean(means) - base_mean) / base_mean * 100:+.1f}%"
            lines.append("| " + " | ".join([
                f"`{stack}`", str(len(runs)), spread(means),
                spread([r["mspt"]["median"] for r in runs]),
                spread([r["mspt"]["p95"] for r in runs]),
                spread([r["mspt"]["p99"] for r in runs]),
                spread([r["mspt"]["max"] for r in runs]),
                spread([float(r["gcMillis"]) for r in runs], 0),
                change,
            ]) + " |")
        lines.append("")

        extras = {}
        for stack in stacks:
            for run in results.get((stack, scenario), []):
                values = dict(run.get("scenarioResults", {}))
                if "heapAfterGcMb" in run:
                    values["heap after GC (MB)"] = run["heapAfterGcMb"]
                for key, value in values.items():
                    extras.setdefault(key, {}).setdefault(stack, []).append(value)
        if extras:
            lines.append("| Stack | " + " | ".join(extras) + " |")
            lines.append("|---|" + "---|" * len(extras))
            for stack in stacks:
                cells = []
                for key in extras:
                    values = extras[key].get(stack, [])
                    numbers = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
                    cells.append(spread(numbers) if numbers and len(numbers) == len(values)
                                 else ", ".join(str(v) for v in values))
                lines.append(f"| `{stack}` | " + " | ".join(cells) + " |")
            lines.append("")
            delivered = extras.get("itemsDeliveredDuringMeasurement")
            if delivered and len({v for vs in delivered.values() for v in vs}) > 1:
                lines.append("> **Parity warning:** hoppers moved a different number of items between runs or "
                             "stacks. Vanilla hopper timing is exact, so this needs investigating.")
                lines.append("")

        if include_hot_methods:
            tool = jfr_tool or java_tool("jfr")
            for stack in stacks:
                runs = results.get((stack, scenario), [])
                jfr_name = runs[0].get("jfr") if runs else None
                if not jfr_name:
                    continue
                table = hot_methods(runs[0]["_path"].parent / jfr_name, tool)
                if table:
                    lines += [f"<details><summary>Hot methods: <code>{stack}</code> (run 1)</summary>", "",
                              "```", table, "```", "", "</details>", ""]

    report = "\n".join(lines)
    (out_dir / "REPORT.md").write_text(report)
    print(report)


def cmd_report(args):
    out_dir = Path(args.results_dir).resolve()
    write_report(out_dir, args.baseline, args.hot_methods, java_tool("jfr", args.jfr))


# ---------------------------------------------------------------- command line

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="run scenarios on one or more mod stacks")
    run.add_argument("--stacks", default="baseline", help="comma-separated stack names from benchmarks/stacks")
    run.add_argument("--scenarios", default=",".join(SCENARIOS), help="comma-separated scenario names")
    run.add_argument("--repeats", type=int, default=3)
    run.add_argument("--warmup", type=int, default=1200, help="warm-up ticks before measuring (20 per second)")
    run.add_argument("--measure", type=int, default=1200, help="measured ticks per run")
    run.add_argument("--worldgen-cap", type=int, default=12000, help="tick limit for the worldgen scenario")
    run.add_argument("--heap", default="4G", help="server heap size, e.g. 4G")
    run.add_argument("--jvm-arg", action="append", default=[], help="extra JVM argument (repeatable)")
    run.add_argument("--java", help="path to the java executable (default: JAVA_HOME or PATH)")
    run.add_argument("--timeout", type=int, default=20, help="minutes before a stuck run is killed")
    run.add_argument("--label", help="results folder name (default: date + stacks)")
    run.add_argument("--baseline", default="baseline", help="stack the report compares against")
    run.add_argument("--no-jfr", action="store_true", help="skip JFR recordings")
    run.add_argument("--hot-methods", action="store_true", help="add JFR hot-method tables to the report")
    run.set_defaults(func=cmd_run)

    report = commands.add_parser("report", help="rebuild REPORT.md for a results folder")
    report.add_argument("results_dir")
    report.add_argument("--baseline", default="baseline")
    report.add_argument("--hot-methods", action="store_true")
    report.add_argument("--jfr", help="path to the jfr tool (default: JAVA_HOME or PATH)")
    report.set_defaults(func=cmd_report)

    args = parser.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
