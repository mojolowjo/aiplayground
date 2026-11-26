"""Brain odds from MoveLab recordings: what real players chose to do, in which situation.

Usage: py -I odds.py <out AiBotBrain.json> <recording.json> [more recordings...]

Only recordings made with MoveLab 0.2.0 or later carry what the player did (Actions) and what
they had and saw (States, every 5 s). For each state it looks at what the player did next:

  chop / mine         hit a tree / ore node within the next WINDOW seconds
  barrel / loot       broke a barrel / opened a crate
  wander              did none of those but moved more than 10 m
  rest                did none of those and stayed put

Then, per choice:
  Base       how often it was chosen when nothing for it was nearby (relative to the others)
  NearBoost  how much more often it was chosen with one within 30 m
  NeedBoost  for chop/mine, how much more often with little wood/stone carried

The output has the same shape as carbon\\data\\AiBotBrain.json, so copying it there makes the
bot use it (the bot re-reads the file when it changes). Stop lengths and sprinting come from
the movement samples, as in baseline.py.
"""
import json, math, sys

WINDOW = 10.0  # s after a snapshot in which an action counts as "what they did next"
CHOICES = ["chop", "mine", "barrel", "loot", "wander", "rest"]
NEAR_KEY = {"chop": "tree", "mine": "ore", "barrel": "barrel", "loot": "crate"}
WANT = {"chop": ("wood", 1000), "mine": ("stones", 1000)}
# The bot's hand guesses, kept wherever the recordings say too little (a choice seen under
# MIN_SEEN times, or a situation seen in under MIN_ROWS snapshots).
DEFAULTS = {"chop": (1.0, 3.0, 2.0), "mine": (0.8, 3.0, 2.0), "barrel": (0.6, 5.0, 0.0), "loot": (0.4, 5.0, 0.0), "wander": (1.5, 1.0, 0.0), "rest": (0.3, 1.0, 0.0)}
MIN_SEEN, MIN_ROWS = 3, 10
ACTION_TO_CHOICE = {"chop": "chop", "mine": "mine"}


def choice_of(act):
    k, what = act["Kind"], act.get("What") or ""
    if k in ACTION_TO_CHOICE:
        return ACTION_TO_CHOICE[k]
    if k == "break" and "barrel" in what:
        return "barrel"
    if k == "open" and "crate" in what:
        return "loot"
    return None


def position_at(samples, t):
    lo, hi = 0, len(samples) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if samples[mid]["T"] < t:
            lo = mid + 1
        else:
            hi = mid
    s = samples[lo]
    return s["X"], s["Z"]


def rows(rec):
    S, acts, states = rec.get("Samples") or [], rec.get("Actions") or [], rec.get("States") or []
    for st in states:
        t = st["T"]
        nxt = next((choice_of(a) for a in acts if t <= a["T"] <= t + WINDOW and choice_of(a)), None)
        if nxt is None and S:
            (x0, z0), (x1, z1) = position_at(S, t), position_at(S, t + WINDOW)
            nxt = "wander" if math.hypot(x1 - x0, z1 - z0) > 10 else "rest"
        yield st, nxt


def stops_and_sprint(recs):
    stops, sprint, moving = [], 0, 0
    for r in recs:
        S = r.get("Samples") or []
        still_since = None
        for i in range(5, len(S)):
            dt = S[i]["T"] - S[i - 5]["T"]
            v = math.hypot(S[i]["X"] - S[i - 5]["X"], S[i]["Z"] - S[i - 5]["Z"]) / dt if dt > 0 else 0
            if v > 0.4:
                moving += 1
                sprint += 1 if S[i]["Sprint"] else 0
                if still_since is not None and S[i]["T"] - still_since >= 1.0:
                    stops.append(S[i]["T"] - still_since)
                still_since = None
            elif still_since is None:
                still_since = S[i]["T"]
    return stops, (sprint / moving if moving else None)


def main(out, paths):
    recs = [json.load(open(p, encoding="utf-8-sig")) for p in paths]
    data = [row for r in recs for row in rows(r)]
    if not data:
        sys.exit("No Actions/States in these recordings (record with MoveLab 0.2.0 or later).")
    n = len(data)
    counts = {c: sum(1 for _, ch in data if ch == c) for c in CHOICES}
    def rate(group, c):
        return group.count(c) / len(group)

    options, measured, notes = {}, {}, {}
    for c in CHOICES:
        base0, near0, need0 = DEFAULTS[c]
        opt = {"Base": base0, "NearBoost": near0, "NearRadius": 30.0, "Want": None, "WantAmount": 0, "NeedBoost": need0}
        how = []
        if counts[c] >= MIN_SEEN:
            if c in NEAR_KEY:
                key = NEAR_KEY[c]
                near = [ch for st, ch in data if st.get("Near", {}).get(key, 0) > 0]
                far = [ch for st, ch in data if st.get("Near", {}).get(key, 0) == 0]
                if len(far) >= MIN_ROWS:
                    measured[c] = max(rate(far, c), 0.5 / len(far))
                    how.append("base")
                    if len(near) >= MIN_ROWS:
                        opt["NearBoost"] = round(min(20.0, max(1.0, rate(near, c) / measured[c])), 2)
                        how.append("near")
                elif len(near) >= MIN_ROWS:
                    # Always near one in these recordings: the measured rate is the "near" rate.
                    measured[c] = rate(near, c) / near0
                    how.append("base (from near / guessed boost)")
            else:
                measured[c] = rate([ch for _, ch in data], c)
                how.append("base")
            if c in WANT:
                item, amount = WANT[c]
                low = [ch for st, ch in data if st.get("Inv", {}).get(item, 0) < amount / 2]
                high = [ch for st, ch in data if st.get("Inv", {}).get(item, 0) >= amount / 2]
                if len(low) >= MIN_ROWS and len(high) >= MIN_ROWS and high.count(c) > 0:
                    opt["NeedBoost"] = round(max(0.0, min(5.0, rate(low, c) / rate(high, c) - 1)), 2)
                    how.append("need")
        if c in WANT:
            opt["Want"], opt["WantAmount"] = WANT[c]
        notes[c] = ", ".join(how) if how else "hand guess (too little data)"
        options[c] = opt
    # Measured bases are rates (0..1); scale the hand-guessed ones to sit alongside them.
    if measured:
        scale = sum(measured.values()) / sum(DEFAULTS[c][0] for c in measured)
        for c in CHOICES:
            options[c]["Base"] = round(measured[c] if c in measured else DEFAULTS[c][0] * scale, 4)
    print("Where each number came from:", json.dumps(notes, indent=1))

    stops, run_share = stops_and_sprint(recs)
    result = {
        "Source": "measured from " + ", ".join(p.replace("\\", "/").split("/")[-1] for p in paths) + f" ({n} snapshots)",
        "StopMedian": 2.1, "StopSpread": 1.56, "StopMax": 50.0, "RestMin": 8.0, "RestMax": 30.0,
        "RunShare": round(run_share, 2) if run_share is not None else 0.72,
        "StickMin": 10.0, "StickMax": 60.0,
        "Options": options,
    }
    if len(stops) >= 10:
        logs = sorted(math.log(s) for s in stops)
        med = logs[len(logs) // 2]
        p90 = logs[int(0.9 * len(logs))]
        result["StopMedian"] = round(math.exp(med), 2)
        result["StopSpread"] = round(max(0.3, (p90 - med) / 1.2816), 2)
        result["StopMax"] = round(min(120.0, max(stops)), 1)
    print("Choices seen:", counts)
    print(json.dumps(result, indent=2))
    open(out, "w", encoding="utf-8").write(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
