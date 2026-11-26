"""Behaviour baseline from a MoveLab recording (positions, view, inputs ~20 times a second).

Usage: py -I baseline.py <recording.json> [out.json]

Splits the recording into moving "legs" and stops, and measures the rhythm a player-like bot
should match: how long legs and stops are, how fast and how straight it moves, how often it
turns, looks around, jumps, crouches and sprints.
"""
import json, math, statistics as st, sys

STILL = 0.4      # m/s: slower than this counts as standing
MIN_STOP = 1.0   # s: a standing spell shorter than this is just a hesitation, not a stop


def pct(xs, q):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 2) if xs else None


def summary(xs):
    return {"n": len(xs), "median": pct(xs, .5), "p10": pct(xs, .1), "p90": pct(xs, .9), "max": round(max(xs), 2) if xs else None}


def angle(a, b):
    return abs((b - a + 180) % 360 - 180)


def main(path, out=None):
    r = json.load(open(path, encoding="utf-8-sig"))
    S = r["Samples"]
    # smoothed speed over ~0.5 s, so jitter doesn't split legs
    n = len(S)
    spd = [0.0] * n
    for i in range(n):
        j = max(0, i - 5)
        dt = S[i]["T"] - S[j]["T"]
        spd[i] = math.hypot(S[i]["X"] - S[j]["X"], S[i]["Z"] - S[j]["Z"]) / dt if dt > 0 else 0.0
    moving = [s > STILL for s in spd]

    # runs of moving / standing
    runs = []
    start = 0
    for i in range(1, n + 1):
        if i == n or moving[i] != moving[start]:
            runs.append((moving[start], start, i - 1))
            start = i
    # short standing spells are hesitations, merge them into the legs around them
    merged = []
    for m, a, b in runs:
        dur = S[b]["T"] - S[a]["T"]
        if not m and dur < MIN_STOP and merged and merged[-1][0]:
            merged[-1] = (True, merged[-1][1], b)
            continue
        if m and merged and merged[-1][0]:
            merged[-1] = (True, merged[-1][1], b)
            continue
        merged.append((m, a, b))

    legs, stops = [], []
    for m, a, b in merged:
        dur = S[b]["T"] - S[a]["T"]
        if dur <= 0:
            continue
        if m:
            length = sum(math.hypot(S[k]["X"] - S[k - 1]["X"], S[k]["Z"] - S[k - 1]["Z"]) for k in range(a + 1, b + 1))
            disp = math.hypot(S[b]["X"] - S[a]["X"], S[b]["Z"] - S[a]["Z"])
            turns = sum(1 for k in range(a + 10, b + 1, 10) if angle(S[k - 10]["Yaw"], S[k]["Yaw"]) > 45)
            legs.append({"dur": dur, "len": length, "straight": disp / length if length > 1 else 1.0,
                         "sprint": sum(S[k]["Sprint"] for k in range(a, b + 1)) / (b - a + 1),
                         "turns_per_min": turns / (dur / 60), "speed": length / dur})
        else:
            look = sum(angle(S[k - 1]["Yaw"], S[k]["Yaw"]) for k in range(a + 1, b + 1))
            stops.append({"dur": dur, "look_deg_per_s": look / dur, "crouch": sum(S[k]["Duck"] for k in range(a, b + 1)) / (b - a + 1)})

    total = S[-1]["T"]
    jumps = sum(1 for k in range(1, n) if S[k]["Jump"] and not S[k - 1]["Jump"])
    base = {
        "source": path.replace("\\", "/").split("/")[-1],
        "player": r.get("Player"),
        "minutes": round(total / 60, 1),
        "distance_m": round(sum(l["len"] for l in legs)),
        "share_moving": round(sum(l["dur"] for l in legs) / total, 2),
        "share_sprinting_while_moving": round(sum(l["sprint"] * l["dur"] for l in legs) / max(1e-6, sum(l["dur"] for l in legs)), 2),
        "jumps_per_minute": round(jumps / (total / 60), 1),
        "share_crouched": round(sum(s["Duck"] for s in S) / n, 3),
        "legs": {"count": len(legs), "duration_s": summary([l["dur"] for l in legs]), "length_m": summary([l["len"] for l in legs]),
                 "speed_mps": summary([l["speed"] for l in legs]), "straightness": summary([l["straight"] for l in legs]),
                 "turns_over_45deg_per_min": summary([l["turns_per_min"] for l in legs])},
        "stops": {"count": len(stops), "duration_s": summary([s["dur"] for s in stops]),
                  "looking_around_deg_per_s": summary([s["look_deg_per_s"] for s in stops])},
    }
    txt = json.dumps(base, indent=2)
    print(txt)
    if out:
        open(out, "w", encoding="utf-8").write(txt + "\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
