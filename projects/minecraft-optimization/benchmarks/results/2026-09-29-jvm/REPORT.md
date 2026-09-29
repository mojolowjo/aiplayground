# Benchmark report: 2026-09-29-jvm

- Minecraft 26.3, Java 25.0.4.1+1-1-24.04.4-Ubuntu (Ubuntu)
- 4 CPUs, 4096 MB max heap, GC: G1 Young Generation, G1 Concurrent GC, G1 Old Generation
- Baseline for comparisons: `lithium-ferrite`
- MSPT = milliseconds of work per server tick (lower is better; 50 is the limit).
  Numbers are the average over runs, with the lowest and highest run in brackets.
- GC ms is the collector's total time as Java reports it. For ZGC, Shenandoah and G1's
  concurrent phases that includes work done while the game keeps running, so compare
  collectors with the GC pause columns instead (read from each run's JFR recording).

## Startup

Seconds from launching Java to the server being ready, including creating a fresh
world. Averaged over every run of every scenario.

| Stack | Runs | Launch to ready (s) |
|---|---|---|
| `lithium-ferrite` | 12 | 20.2 (17.5–22.1) |
| `lithium-ferrite-coh` | 12 | 20.3 (18.4–26.2) |
| `lithium-ferrite-shenandoah` | 12 | 21.8 (18.4–25.4) |
| `lithium-ferrite-zgc` | 12 | 21.5 (18.2–27.5) |
| `lithium-ferrite-zgc-coh` | 12 | 21.5 (19.0–27.2) |

## villagers

300 villagers in one-block trading cells, each beside a workstation.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium-ferrite` | 3 | 13.41 (12.38–14.32) | 12.22 (11.21–13.19) | 19.73 (18.18–21.41) | 24.03 (22.62–25.19) | 44.59 (28.54–74.50) | 21 (0–64) |  |
| `lithium-ferrite-coh` | 3 | 13.54 (12.63–14.22) | 12.11 (11.62–12.44) | 20.48 (18.02–22.16) | 28.17 (20.99–36.04) | 56.86 (29.83–94.85) | 25 (0–74) | +0.9% |
| `lithium-ferrite-shenandoah` | 3 | 22.21 (12.11–31.89) | 19.75 (10.60–32.29) | 39.27 (18.52–51.67) | 49.01 (25.84–60.69) | 86.55 (85.47–88.19) | 296 (0–503) | +65.6% |
| `lithium-ferrite-zgc` | 3 | 13.14 (12.89–13.37) | 11.70 (11.68–11.73) | 20.10 (19.54–20.96) | 26.01 (22.30–33.06) | 45.76 (32.42–64.05) | 613 (0–997) | -2.1% |
| `lithium-ferrite-zgc-coh` | 3 | 12.74 (12.10–13.68) | 11.48 (10.97–12.24) | 19.39 (17.85–21.06) | 23.84 (19.67–26.99) | 43.70 (35.91–54.59) | 932 (849–1029) | -5.0% |

| Stack | villagersAtEnd | heap after GC (MB) | GC pauses total (ms) | longest GC pause (ms) |
|---|---|---|---|---|
| `lithium-ferrite` | 300.00 (300.00–300.00) | 163.00 (163.00–163.00) | 21.10 (0.00–63.30) | 21.10 (0.00–63.30) |
| `lithium-ferrite-coh` | 300.00 (300.00–300.00) | 149.33 (149.00–150.00) | 24.70 (0.00–74.10) | 24.70 (0.00–74.10) |
| `lithium-ferrite-shenandoah` | 300.00 (300.00–300.00) | 172.00 (172.00–172.00) | 0.67 (0.00–1.04) | 0.40 (0.00–0.70) |
| `lithium-ferrite-zgc` | 300.00 (300.00–300.00) | 252.00 (252.00–252.00) | 0.07 (0.00–0.13) | 0.02 (0.00–0.03) |
| `lithium-ferrite-zgc-coh` | 300.00 (300.00–300.00) | 234.00 (234.00–234.00) | 0.12 (0.11–0.12) | 0.03 (0.03–0.04) |

## cramming

200 cows packed into a 5x5 pen.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium-ferrite` | 3 | 5.66 (5.34–6.04) | 5.00 (4.82–5.29) | 8.78 (8.12–9.48) | 12.43 (9.55–14.20) | 28.22 (16.50–38.52) | 0 (0–0) |  |
| `lithium-ferrite-coh` | 3 | 4.30 (3.97–4.71) | 3.81 (3.53–4.22) | 6.54 (5.81–7.42) | 9.20 (8.12–10.47) | 59.34 (31.90–87.98) | 50 (13–83) | -24.0% |
| `lithium-ferrite-shenandoah` | 3 | 4.40 (4.35–4.49) | 3.80 (3.67–4.00) | 7.42 (6.87–8.21) | 10.14 (8.71–11.58) | 21.31 (13.82–32.85) | 401 (383–434) | -22.3% |
| `lithium-ferrite-zgc` | 3 | 5.22 (4.92–5.43) | 4.79 (4.58–5.20) | 9.39 (8.34–10.10) | 11.83 (10.69–12.58) | 21.11 (19.06–24.41) | 1022 (882–1094) | -7.8% |
| `lithium-ferrite-zgc-coh` | 3 | 5.07 (4.77–5.33) | 4.58 (3.98–4.98) | 9.10 (8.44–9.59) | 12.36 (12.09–12.54) | 24.71 (20.19–29.77) | 954 (938–970) | -10.4% |

| Stack | cowsAtEnd | heap after GC (MB) | GC pauses total (ms) | longest GC pause (ms) |
|---|---|---|---|---|
| `lithium-ferrite` | 200.00 (200.00–200.00) | 147.00 (147.00–147.00) | 0.00 (0.00–0.00) | 0.00 (0.00–0.00) |
| `lithium-ferrite-coh` | 200.00 (200.00–200.00) | 135.00 (135.00–135.00) | 50.43 (13.80–83.30) | 50.43 (13.80–83.30) |
| `lithium-ferrite-shenandoah` | 200.00 (200.00–200.00) | 156.00 (156.00–156.00) | 0.94 (0.79–1.16) | 0.50 (0.40–0.65) |
| `lithium-ferrite-zgc` | 200.00 (200.00–200.00) | 226.67 (226.00–228.00) | 0.13 (0.11–0.14) | 0.03 (0.03–0.04) |
| `lithium-ferrite-zgc-coh` | 200.00 (200.00–200.00) | 214.00 (212.00–216.00) | 0.15 (0.12–0.17) | 0.06 (0.03–0.08) |

## items

1200 item entities of different types on a 16x16 floor.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium-ferrite` | 3 | 5.04 (4.31–5.44) | 4.30 (3.71–4.94) | 8.43 (6.61–9.48) | 12.93 (9.57–17.25) | 102.79 (68.75–132.92) | 91 (61–116) |  |
| `lithium-ferrite-coh` | 3 | 5.34 (5.19–5.43) | 4.44 (4.16–4.63) | 8.94 (8.36–9.24) | 12.04 (10.21–14.15) | 114.98 (86.67–160.15) | 86 (79–93) | +5.9% |
| `lithium-ferrite-shenandoah` | 3 | 4.84 (4.29–5.67) | 4.34 (3.81–5.08) | 7.35 (6.55–8.23) | 9.30 (7.61–10.52) | 19.38 (16.39–23.41) | 494 (466–523) | -4.0% |
| `lithium-ferrite-zgc` | 3 | 5.77 (4.61–7.70) | 4.28 (3.71–4.83) | 12.88 (7.37–22.16) | 18.51 (10.13–27.86) | 35.72 (30.70–39.78) | 1737 (1600–1858) | +14.3% |
| `lithium-ferrite-zgc-coh` | 3 | 7.22 (6.29–7.84) | 6.04 (5.29–6.54) | 16.98 (9.66–21.82) | 23.63 (11.04–34.74) | 40.51 (24.14–54.80) | 1317 (1045–1796) | +43.1% |

| Stack | itemsAtEnd | heap after GC (MB) | GC pauses total (ms) | longest GC pause (ms) |
|---|---|---|---|---|
| `lithium-ferrite` | 1200.00 (1200.00–1200.00) | 148.00 (148.00–148.00) | 90.50 (62.00–115.00) | 90.50 (62.00–115.00) |
| `lithium-ferrite-coh` | 1200.00 (1200.00–1200.00) | 136.00 (136.00–136.00) | 86.50 (79.90–93.30) | 86.50 (79.90–93.30) |
| `lithium-ferrite-shenandoah` | 1200.00 (1200.00–1200.00) | 158.00 (158.00–158.00) | 1.39 (1.28–1.49) | 0.39 (0.36–0.42) |
| `lithium-ferrite-zgc` | 1200.00 (1200.00–1200.00) | 231.33 (228.00–234.00) | 0.19 (0.18–0.19) | 0.03 (0.03–0.03) |
| `lithium-ferrite-zgc-coh` | 1200.00 (1200.00–1200.00) | 217.33 (216.00–220.00) | 0.17 (0.12–0.26) | 0.05 (0.03–0.08) |

## worldgen

Generate 625 new chunks (25x25) far from spawn.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium-ferrite` | 3 | 6.08 (5.72–6.53) | 2.68 (2.54–2.77) | 24.91 (22.81–26.67) | 53.41 (47.66–58.13) | 200.35 (178.22–238.57) | 349 (182–664) |  |
| `lithium-ferrite-coh` | 3 | 5.79 (5.58–5.95) | 2.65 (2.52–2.82) | 23.22 (21.84–24.76) | 51.19 (46.26–54.90) | 177.19 (155.50–190.00) | 387 (193–707) | -4.8% |
| `lithium-ferrite-shenandoah` | 3 | 5.94 (5.69–6.32) | 2.36 (2.03–2.56) | 23.92 (22.27–26.72) | 63.46 (54.90–72.69) | 219.78 (190.25–264.28) | 3059 (2782–3338) | -2.3% |
| `lithium-ferrite-zgc` | 3 | 6.02 (5.72–6.23) | 2.50 (2.33–2.60) | 23.55 (21.77–25.70) | 58.15 (56.33–59.12) | 231.10 (202.32–249.97) | 4074 (2995–5494) | -1.0% |
| `lithium-ferrite-zgc-coh` | 3 | 5.83 (5.65–6.04) | 2.50 (2.36–2.74) | 22.93 (21.98–23.58) | 62.45 (59.71–64.92) | 163.62 (140.74–203.55) | 2968 (2376–3716) | -4.1% |

| Stack | chunksReady | complete | seconds | chunksPerSecond | heap after GC (MB) | GC pauses total (ms) | longest GC pause (ms) |
|---|---|---|---|---|---|---|---|
| `lithium-ferrite` | 625.00 (625.00–625.00) | True, True, True | 25.70 (25.27–26.32) | 24.33 (23.75–24.73) | 249.00 (249.00–249.00) | 362.33 (200.00–687.00) | 197.47 (96.40–383.00) |
| `lithium-ferrite-coh` | 625.00 (625.00–625.00) | True, True, True | 25.58 (23.98–26.41) | 24.48 (23.66–26.07) | 232.00 (226.00–235.00) | 387.00 (193.00–707.00) | 241.40 (98.20–494.00) |
| `lithium-ferrite-shenandoah` | 625.00 (625.00–625.00) | True, True, True | 30.18 (27.46–31.86) | 20.80 (19.62–22.76) | 254.00 (252.00–257.00) | 5.18 (2.73–8.81) | 1.79 (0.46–3.99) |
| `lithium-ferrite-zgc` | 625.00 (625.00–625.00) | True, True, True | 27.62 (25.81–29.22) | 22.68 (21.39–24.22) | 345.33 (342.00–348.00) | 0.24 (0.18–0.34) | 0.04 (0.03–0.05) |
| `lithium-ferrite-zgc-coh` | 625.00 (625.00–625.00) | True, True, True | 28.28 (25.42–30.13) | 22.22 (20.74–24.59) | 324.00 (324.00–324.00) | 0.17 (0.11–0.28) | 0.03 (0.03–0.05) |
