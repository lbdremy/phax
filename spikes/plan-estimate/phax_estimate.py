#!/usr/bin/env python3
"""Estimate what a phax plan will cost on Claude, and whether it fits the current subscription windows.

Spike for `phax plans estimate`. Standard library only.

    python3 spikes/plan-estimate/phax_estimate.py docs/plans/<plan>.md
    python3 spikes/plan-estimate/phax_estimate.py <run>/phax-plan.json --exclude-run phax.<run>   # backtest

How it works:
  1. History  - every `claude -p` stream phax kept under ~/.phax ends with a `result` event. Its
     `modelUsage` carries tokens and API-list cost. Since Claude Code 2.1.280 (2.1.267 was not) a
     resumed session (fix loop, handoff) reports *cumulative* modelUsage, so a resumed invocation
     is the delta against the previous invocation of the same session.
  2. Model    - log(token volume, priced at a fixed reference) ~ effort + planned-file sizes,
     weighted towards recent runs; the prediction is repriced at each phase's own model, so a
     model with little history is still estimable. Uncertainty comes from resampled residuals.
  3. Quota    - one tiny `claude -p` call returns a rate_limit_event with the five_hour and
     seven_day utilisation. API dollars per 1% of each window are calibrated from the same
     streams: rate_limit_events interleave with assistant messages whose cost is known.
  4. Verdict  - phases are played forward in time (agent burn rate from history), pausing when a
     window would be exhausted and resuming at its reset.

Limits: interactive use outside phax consumes the same windows; plan extraction, the plan auditor
and the interactive code review are not in the history (their streams are not kept).
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import random
import re
import subprocess
import sys
import time
from collections import defaultdict

PHAX_HOME = os.path.expanduser("~/.phax")
SKIP_DIRS = {"worktrees", ".git", "bin", "cache", "locks", "records", "node_modules"}

# API list $/MTok: input, output, cache read, cache write 5m, cache write 1h
PRICE = {
    "opus-5-5": (4, 20, 0.20, 5, 8), "opus-5": (5, 25, 0.5, 6.25, 10), "opus-4-8": (5, 25, 0.5, 6.25, 10),
    "opus-4-7": (5, 25, 0.5, 6.25, 10), "opus-4-6": (5, 25, 0.5, 6.25, 10),
    "sonnet-5-5": (2, 10, 0.2, 2.5, 4), "sonnet-5": (2, 10, 0.2, 2.5, 4), "sonnet-4-6": (3, 15, 0.3, 3.75, 6),
    "fable-5-1": (10, 50, 0.25, 12.5, 20), "fable-5": (10, 50, 1, 12.5, 20),
    "haiku-5-5": (0.1, 0.5, 0.01, 0.125, 0.2), "haiku-4-5": (1, 5, 0.1, 1.25, 2),
}
REF_MODEL = "opus-5-5"
EFFORTS = ("low", "medium", "high", "xhigh", "max")
CUMULATIVE_SINCE = (2, 1, 268)
FIVE_HOURS = 5 * 3600


def model_key(model):
    return re.sub(r"^claude-|-\d{8}$|\[.*\]$", "", model or "")


def ref_price(tokens):
    """Tokens (input, output, cache read, cache write) priced at the reference model, 1h cache writes."""
    p = PRICE[REF_MODEL]
    return (tokens[0] * p[0] + tokens[1] * p[1] + tokens[2] * p[2] + tokens[3] * p[4]) / 1e6


def message_cost(model, usage):
    p = PRICE.get(model_key(model))
    if not p:
        return 0.0
    cc = usage.get("cache_creation") or {}
    w1 = cc.get("ephemeral_1h_input_tokens", 0)
    w5 = usage.get("cache_creation_input_tokens", 0) - w1
    return (usage.get("input_tokens", 0) * p[0] + usage.get("output_tokens", 0) * p[1]
            + usage.get("cache_read_input_tokens", 0) * p[2] + w5 * p[3] + w1 * p[4]) / 1e6


# ---------------------------------------------------------------------------------------------
# 1. History
# ---------------------------------------------------------------------------------------------

def run_and_phase(rel):
    """~/.phax-relative stream path -> (run name, phase id or '-')."""
    parts = rel.split("/")
    if parts[0] == "authoring":
        return None, None
    phase = "-"
    for i, part in enumerate(parts):
        if re.match(r"phase-\d+", part):
            phase = part.split(".reset-")[0]
            parts = parts[:i]
            break
    else:
        parts = parts[:-1]
    run = re.sub(r"/runs$", "", re.sub(r"^(runs|archive)/", "", "/".join(parts)))
    return run, phase


def scan_streams(root):
    """One pass over every kept stream: invocation results, and rate-limit calibration intervals."""
    invocations, intervals = [], []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(dirpath, name)
            version, results, seen, events, by_model = None, [], {}, [], defaultdict(float)
            try:
                with open(path, errors="replace") as f:
                    for line in f:
                        if line.startswith('{"type":"assistant"'):
                            e = json.loads(line)
                            m = e.get("message") or {}
                            if m.get("usage") and m.get("id"):
                                c = message_cost(m.get("model"), m["usage"])
                                seen[m["id"]] = c
                                by_model[model_key(m.get("model"))] += c
                        elif '"rate_limit_event"' in line:
                            uw = (json.loads(line).get("rate_limit_info") or {}).get("unifiedWindows")
                            if uw:
                                events.append((sum(seen.values()), uw))
                        elif '"type":"result"' in line:
                            e = json.loads(line)
                            if e.get("type") == "result" and "modelUsage" in e:
                                results.append(e)
                        elif version is None and '"claude_code_version"' in line:
                            mv = re.search(r'"claude_code_version":"([\d.]+)"', line)
                            if mv:
                                version = tuple(int(x) for x in mv.group(1).split("."))
            except (OSError, ValueError):
                continue
            mtime = os.path.getmtime(path)
            rel = os.path.relpath(path, root)
            for idx, e in enumerate(results):
                invocations.append((mtime, idx, rel, version, e))
            main = max(by_model, key=by_model.get) if by_model else "?"
            for window in ("five_hour", "seven_day"):
                groups = defaultdict(list)
                for cost, uw in events:
                    if uw.get(window):
                        groups[uw[window]["resetsAt"]].append((cost, uw[window]["utilization"]))
                for reset, pts in groups.items():
                    d_cost, d_util = pts[-1][0] - pts[0][0], (pts[-1][1] - pts[0][1]) * 100
                    if d_cost > 0:
                        intervals.append({"window": window, "model": main, "mtime": mtime, "reset": reset,
                                          "d_cost": d_cost, "d_util": d_util})
    return invocations, intervals


KEYS = ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "costUSD")


def per_invocation(invocations):
    """Undo the cumulative modelUsage of resumed sessions; one row per (invocation, model)."""
    invocations.sort(key=lambda t: (t[0], t[1]))
    prev, rows, seen = {}, [], set()
    for mtime, _, rel, version, e in invocations:
        sid = e.get("session_id")
        mu = {k: {f: v.get(f, 0) for f in KEYS} for k, v in (e.get("modelUsage") or {}).items()}
        dedupe = (sid, e.get("total_cost_usd"), json.dumps(e.get("usage"), sort_keys=True))
        if dedupe in seen:
            continue
        seen.add(dedupe)
        cumulative = sid in prev and (version or (0,)) >= CUMULATIVE_SINCE
        run, phase = run_and_phase(rel)
        for model, cur in mu.items():
            if cumulative and model in prev[sid]:
                cur = {f: cur[f] - prev[sid][model].get(f, 0) for f in KEYS}
            if cur["costUSD"] <= 0 and cur["outputTokens"] <= 0:
                continue
            rows.append({"run": run, "phase": phase, "file": rel, "model": model_key(model), "mtime": mtime,
                         "cost": cur["costUSD"],
                         "tokens": (cur["inputTokens"], cur["outputTokens"], cur["cacheReadInputTokens"],
                                    cur["cacheCreationInputTokens"]),
                         "hours": (e.get("duration_ms") or 0) / 3.6e6})
        prev[sid] = mu
    return rows


# ---------------------------------------------------------------------------------------------
# 2. Plans and features
# ---------------------------------------------------------------------------------------------

def git(repo, *args, stdin=None):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, input=stdin)
    return r.stdout if r.returncode == 0 else ""


def blob_bytes(repo, commit, paths):
    if not paths or not repo:
        return 0
    out = git(repo, "cat-file", "--batch-check=%(objectsize)", stdin="".join(f"{commit}:{p}\n" for p in paths))
    return sum(int(t) for t in out.split() if t.isdigit())


SECTION_KEYS = {"planned files to create": "plannedFilesToCreate", "planned files to edit": "plannedFilesToEdit",
                "optional files that may be edited": "optionalFilesToEdit"}


def parse_plan_md(text):
    phases = []
    blocks = re.split(r"^## (?=phase-\d+)", text, flags=re.M)[1:]
    for block in blocks:
        pid = re.match(r"(phase-\d+)", block).group(1)
        model = re.search(r"\*\*Recommended model:\*\*\s*`?([\w.\-]+)", block)
        effort = re.search(r"\*\*Recommended effort:\*\*\s*`?(\w+)", block)
        title = block.splitlines()[0]
        ph = {"id": pid, "title": re.sub(r"\s*\{#.*\}$", "", title.split("—", 1)[-1]).strip(),
              "model": model.group(1) if model else "claude-opus-5-5", "effort": effort.group(1) if effort else "medium",
              "plannedFilesToCreate": [], "plannedFilesToEdit": [], "optionalFilesToEdit": []}
        for sub in re.split(r"^### ", block, flags=re.M)[1:]:
            head, _, body = sub.partition("\n")
            key = SECTION_KEYS.get(head.strip().lower())
            if key:
                ph[key] = re.findall(r"^\s*[-*]\s+`([^`]+)`", body, flags=re.M)
        phases.append(ph)
    return phases


def load_plan(path):
    if path.endswith(".json"):
        return json.load(open(path))["phases"]
    return parse_plan_md(open(path, errors="replace").read())


def features(ph, edit_bytes, optional_bytes):
    x = [1.0] + [1.0 if ph["effort"] == e else 0.0 for e in EFFORTS[1:4]]
    if edit_bytes is None:  # no repo to size files in: fall back to counts
        x += [math.log1p(len(ph.get("plannedFilesToCreate") or []) + len(ph.get("plannedFilesToEdit") or [])),
              math.log1p(len(ph.get("optionalFilesToEdit") or []))]
    else:
        x += [math.log1p(edit_bytes / 1000), math.log1p(optional_bytes / 1000),
              math.log1p(len(ph.get("plannedFilesToCreate") or []))]
    return x


def project_name(repo):
    try:
        return json.load(open(os.path.join(repo, "phax.json"))).get("name")
    except (OSError, ValueError):
        return None


def training_set(rows, repo, exclude_run):
    """(features, log ref-cost, mtime, model, run) per historical Claude phase."""
    phase_tokens, phase_cost = defaultdict(lambda: [0, 0, 0, 0]), defaultdict(float)
    for r in rows:
        if r["run"] and r["phase"] != "-":
            t = phase_tokens[(r["run"], r["phase"])]
            for i in range(4):
                t[i] += r["tokens"][i]
            phase_cost[(r["run"], r["phase"])] += r["cost"]
    ns = project_name(repo) if repo else None
    sized, counted = [], []
    plan_files = glob.glob(f"{PHAX_HOME}/runs/*/phax-plan.json") + glob.glob(f"{PHAX_HOME}/archive/*/runs/phax-plan.json")
    for p in plan_files:
        run = re.sub(r"/runs$", "", re.sub(r"^(runs|archive)/", "", os.path.relpath(os.path.dirname(p), PHAX_HOME)))
        if run == exclude_run:
            continue
        try:
            phases = json.load(open(p)).get("phases", [])
        except (OSError, ValueError):
            continue
        prompts = glob.glob(os.path.join(os.path.dirname(p), "phase-*", "prompt.md"))
        start = min((os.path.getmtime(x) for x in prompts), default=os.path.getmtime(p))
        commit = None
        if ns and run.startswith(ns + "."):
            commit = git(repo, "rev-list", "-1", f"--before=@{int(start)}", "HEAD").strip() or None
        for ph in phases:
            key = (run, ph["id"])
            ref = ref_price(phase_tokens.get(key, (0, 0, 0, 0)))
            if ref < 0.01 or not ph["model"].startswith("claude"):
                continue
            sample = {"y": math.log(ref), "mtime": start, "model": model_key(ph["model"]), "run": run,
                      "cost": phase_cost[key], "tokens": phase_tokens[key]}
            counted.append(dict(sample, x=features(ph, None, None)))
            if commit:
                eb = blob_bytes(repo, commit, ph.get("plannedFilesToEdit") or [])
                ob = blob_bytes(repo, commit, ph.get("optionalFilesToEdit") or [])
                sized.append(dict(sample, x=features(ph, eb, ob)))
    return sized, counted


# ---------------------------------------------------------------------------------------------
# Weighted least squares (tiny, pure Python)
# ---------------------------------------------------------------------------------------------

def solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[piv] = m[piv], m[c]
        if abs(m[c][c]) < 1e-12:
            continue
        for r in range(n):
            if r != c:
                f = m[r][c] / m[c][c]
                m[r] = [m[r][k] - f * m[c][k] for k in range(n + 1)]
    return [m[i][n] / m[i][i] if abs(m[i][i]) > 1e-12 else 0.0 for i in range(n)]


def fit(samples, half_life_days):
    tmax = max(s["mtime"] for s in samples)
    w = [0.5 ** ((tmax - s["mtime"]) / 86400 / half_life_days) for s in samples]
    k = len(samples[0]["x"])
    xtx = [[sum(wi * s["x"][i] * s["x"][j] for wi, s in zip(w, samples)) + (1e-6 if i == j else 0) for j in range(k)]
           for i in range(k)]
    xty = [sum(wi * s["x"][i] * s["y"] for wi, s in zip(w, samples)) for i in range(k)]
    beta = solve(xtx, xty)
    resid = [s["y"] - sum(b * xi for b, xi in zip(beta, s["x"])) for s in samples]
    mix = [sum(wi * s["tokens"][i] for wi, s in zip(w, samples)) for i in range(4)]
    return beta, resid, w, mix


def reprice(model, mix):
    p, ref = PRICE.get(model_key(model), PRICE[REF_MODEL]), PRICE[REF_MODEL]
    cols = (0, 1, 2, 4)
    return sum(mix[i] * p[c] for i, c in enumerate(cols)) / sum(mix[i] * ref[c] for i, c in enumerate(cols))


def quantiles(values, qs):
    v = sorted(values)
    return [v[min(len(v) - 1, int(q * len(v)))] for q in qs]


# ---------------------------------------------------------------------------------------------
# 3. Quota
# ---------------------------------------------------------------------------------------------

def probe_quota(model):
    cmd = ["claude", "-p", "Reply with: ok", "--model", model, "--output-format", "stream-json", "--verbose",
           "--max-turns", "1", "--strict-mcp-config", "--no-session-persistence"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd=os.path.expanduser("~")).stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        sys.exit(f"quota probe failed: {e}")
    for line in out.splitlines():
        if '"rate_limit_event"' in line:
            uw = json.loads(line)["rate_limit_info"].get("unifiedWindows")
            if uw:
                return uw, time.time(), "probe"
    sys.exit("quota probe returned no rate_limit_event (API-key auth has no subscription windows)")


def last_observed_quota(root):
    best = None
    for path in glob.glob(f"{root}/runs/**/*.jsonl", recursive=True) + glob.glob(f"{root}/archive/*/runs/**/*.jsonl", recursive=True):
        mt = os.path.getmtime(path)
        if best and mt <= best[1]:
            continue
        last = None
        with open(path, errors="replace") as f:
            for line in f:
                if '"rate_limit_event"' in line:
                    last = (json.loads(line).get("rate_limit_info") or {}).get("unifiedWindows") or last
        if last:
            best = (last, mt)
    if not best:
        sys.exit("no rate_limit_event in history; run without --no-probe")
    return best[0], best[1], "last observed"


def calibrate(intervals, days):
    cutoff = time.time() - days * 86400
    out = {}
    for window in ("five_hour", "seven_day"):
        sel = [i for i in intervals if i["window"] == window and i["mtime"] >= cutoff]
        dc, du = sum(i["d_cost"] for i in sel), sum(i["d_util"] for i in sel)
        out[window] = (dc / du if du > 0 else None, len(sel), dc)
    return out


# ---------------------------------------------------------------------------------------------
# 4. Timeline
# ---------------------------------------------------------------------------------------------

def play(phase_costs, burn, quota, rates, now):
    """Play phases forward; returns events (pauses) and the finish time."""
    r5, r7 = rates["five_hour"][0], rates["seven_day"][0]
    u5, reset5 = quota["five_hour"]["utilization"] * 100, quota["five_hour"]["resetsAt"]
    u7, reset7 = quota["seven_day"]["utilization"] * 100, quota["seven_day"]["resetsAt"]
    t, pauses = now, []
    for pid, cost in phase_costs:
        left = cost
        while left > 1e-9:
            if t >= reset5:  # the next window opens with the next request
                u5, reset5 = 0.0, t + FIVE_HOURS
            if t >= reset7:
                u7, reset7 = 0.0, t + 7 * 86400
            # dollars available before a window runs out, and before the five-hour reset
            room5 = (100 - u5) * r5
            room7 = (100 - u7) * r7 if r7 else float("inf")
            until_reset = burn * (reset5 - t) / 3600
            step = min(left, room5, room7, until_reset)
            if step <= 1e-9:
                which = "seven_day" if room7 <= 1e-9 else "five_hour"
                resume = reset7 if which == "seven_day" else reset5
                pauses.append((pid, which, t, resume))
                t = resume
                continue
            left -= step
            u5 += step / r5
            u7 += step / r7 if r7 else 0
            t += step / burn * 3600
    return pauses, t


def fmt_time(ts):
    return dt.datetime.fromtimestamp(ts).strftime("%a %d %b %H:%M")


# ---------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("plan", help="plan.md (before extraction) or phax-plan.json")
    ap.add_argument("--repo", help="repository the plan runs in (default: git toplevel of the plan file)")
    ap.add_argument("--exclude-run", help="leave this run out of the history (backtest a plan that already ran)")
    ap.add_argument("--no-probe", action="store_true", help="reuse the last rate_limit_event phax recorded instead of a tiny claude call")
    ap.add_argument("--probe-model", default="claude-haiku-4-5")
    ap.add_argument("--half-life", type=float, default=30, help="days; weight of past runs halves every N days")
    ap.add_argument("--calib-days", type=float, default=28, help="days of rate-limit history used for $/1%% calibration")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    plan_path = os.path.abspath(args.plan)
    repo = (args.repo or git(os.path.dirname(plan_path), "rev-parse", "--show-toplevel").strip()
            or git(os.getcwd(), "rev-parse", "--show-toplevel").strip() or None)
    phases = load_plan(plan_path)
    if not phases:
        sys.exit("no phases found in plan")

    t0 = time.time()
    invocations, intervals = scan_streams(PHAX_HOME)
    rows = per_invocation(invocations)
    sized, counted = training_set(rows, repo, args.exclude_run)
    samples = sized if len(sized) >= 60 else counted
    use_bytes = samples is sized
    beta, resid, weights, mix = fit(samples, args.half_life)

    # run-level costs that are not phases (compliance review), recent median
    fixed = sorted(sum(r["cost"] for r in rows if r["run"] == run and r["phase"] == "-")
                   for run in {r["run"] for r in rows if r["run"] and r["phase"] == "-" and r["mtime"] > time.time() - 60 * 86400})
    fixed_cost = fixed[len(fixed) // 2] if fixed else 0.0

    recent = [r for r in rows if r["mtime"] > time.time() - 30 * 86400 and r["hours"] > 0]
    burn = sum(r["cost"] for r in recent) / max(sum(r["hours"] for r in recent), 1e-9) if recent else 25.0

    head = git(repo, "rev-parse", "HEAD").strip() if repo else None
    est = []
    for ph in phases:
        if use_bytes:
            x = features(ph, blob_bytes(repo, head, ph.get("plannedFilesToEdit") or []),
                         blob_bytes(repo, head, ph.get("optionalFilesToEdit") or []))
        else:
            x = features(ph, None, None)
        base = math.exp(sum(b * xi for b, xi in zip(beta, x))) * reprice(ph["model"], mix)
        est.append((ph, base))

    rng = random.Random(7)
    sims_phase = [[base * math.exp(rng.choices(resid, weights)[0]) for _ in range(4000)] for _, base in est]
    sims_run = [sum(s[i] for s in sims_phase) + fixed_cost for i in range(4000)]
    run_q = quantiles(sims_run, (0.1, 0.5, 0.9))

    rates = calibrate(intervals, args.calib_days)
    quota, quota_ts, quota_src = last_observed_quota(PHAX_HOME) if args.no_probe else probe_quota(args.probe_model)
    now = time.time()
    # A window that reset since the observation is empty; the next one opens with the first request, i.e. now.
    if quota["five_hour"]["resetsAt"] <= now:
        quota["five_hour"] = {"utilization": 0.0, "resetsAt": now + FIVE_HOURS}
    if quota["seven_day"]["resetsAt"] <= now:
        quota["seven_day"] = {"utilization": 0.0, "resetsAt": now + 7 * 86400}

    scenarios = {}
    for label, q in (("P50", 0.5), ("P90", 0.9)):
        costs = [(ph["id"], quantiles(s, (q,))[0]) for (ph, _), s in zip(est, sims_phase)]
        scenarios[label] = play(costs, burn, quota, rates, now) if rates["five_hour"][0] else ([], now)

    actual = None
    if args.exclude_run:
        actual = sum(r["cost"] for r in rows if r["run"] == args.exclude_run)

    if args.json:
        print(json.dumps({
            "phases": [{"id": ph["id"], "model": ph["model"], "effort": ph["effort"],
                        "p10": q[0], "p50": q[1], "p90": q[2]}
                       for (ph, _), s in zip(est, sims_phase) for q in [quantiles(s, (0.1, 0.5, 0.9))]],
            "run": {"p10": run_q[0], "p50": run_q[1], "p90": run_q[2], "run_level_fixed": fixed_cost, "actual": actual},
            "quota": {"source": quota_src, "observed_at": quota_ts, **quota},
            "calibration_usd_per_pct": {w: v[0] for w, v in rates.items()},
            "scenarios": {k: {"pauses": [{"phase": p, "window": w, "at": a, "resume": r} for p, w, a, r in v[0]],
                              "finish": v[1]} for k, v in scenarios.items()},
        }, indent=2))
        return

    shown = os.path.relpath(plan_path)
    print(f"\nPlan: {plan_path if shown.startswith('..') else shown}  ({len(phases)} phases)")
    print(f"History: {len(samples)} phases ({'sized by planned-file bytes' if use_bytes else 'file counts'}), "
          f"half-life {args.half_life:g}d, scanned in {time.time() - t0:.0f}s\n")
    print(f"{'phase':10} {'model':18} {'effort':7} {'P10':>7} {'P50':>7} {'P90':>7}")
    for (ph, _), s in zip(est, sims_phase):
        q = quantiles(s, (0.1, 0.5, 0.9))
        print(f"{ph['id']:10} {model_key(ph['model']):18} {ph['effort']:7} {q[0]:7.2f} {q[1]:7.2f} {q[2]:7.2f}")
    print(f"{'run-level (compliance review, median)':37} {fixed_cost:7.2f}")
    print(f"{'RUN (API list $)':37} {run_q[0]:7.2f} {run_q[1]:7.2f} {run_q[2]:7.2f}")
    if actual is not None:
        print(f"{'actual (excluded run)':37} {actual:7.2f}")
    print("Not included: plan extraction, plan auditor, interactive code review.\n")

    r5, n5, _ = rates["five_hour"]
    r7, n7, _ = rates["seven_day"]
    age = (now - quota_ts) / 60
    print(f"Subscription ({quota_src}{'' if quota_src == 'probe' else f', {age:.0f} min old — usage since then is not counted'}):")
    for w, label, r in (("five_hour", "5h", r5), ("seven_day", "7d", r7)):
        u = quota[w]["utilization"] * 100
        cap = f"≈ ${r * 100:,.0f}/window, ${r * (100 - u):,.0f} left" if r else "not calibrated"
        print(f"  {label}: {u:4.0f}% used, resets {fmt_time(quota[w]['resetsAt'])}   ({cap})")
    print(f"  calibration: {n5} five-hour / {n7} seven-day intervals over {args.calib_days:g}d; "
          f"agent burn ≈ ${burn:.0f}/h\n")

    if not r5:
        print("Verdict: no rate-limit history to calibrate against yet.")
        return
    for label in ("P50", "P90"):
        pauses, finish = scenarios[label]
        if not pauses:
            line = f"fits — no pause, agent time ends ≈ {fmt_time(finish)}"
        else:
            line = "; ".join(f"{w} exhausted in {p} ≈ {fmt_time(a)}, resume {fmt_time(r)}" for p, w, a, r in pauses)
        print(f"Verdict {label}: {line}")
    p50_pauses, p90_pauses = scenarios["P50"][0], scenarios["P90"][0]
    if not p90_pauses:
        print("=> GO: fits the current windows even at P90.")
    elif not p50_pauses:
        print("=> RISKY: fits at P50 but not at P90; a pause (phax resume) is possible.")
    else:
        first = p50_pauses[0]
        print(f"=> WAIT or accept a pause: starting after {fmt_time(first[3])} gives the run a fresh {('five-hour' if first[1] == 'five_hour' else 'weekly')} window.")


if __name__ == "__main__":
    main()
