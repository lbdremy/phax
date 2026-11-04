#!/usr/bin/env python3
"""Read a project's phax records and report what its harness costs the agent.

Harness = feed-forward (what the session is given before it acts) + feedback (the
commands it runs to learn whether it is right). Python 3, standard library only.
Reads the records repository; writes only into --work.

    python3 spikes/harness-data/harness_data.py                      # ~/.phax/records/phax
    python3 spikes/harness-data/harness_data.py --records ~/.phax/records/<project>
    python3 spikes/harness-data/harness_data.py --section feedback
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import re
import statistics
import subprocess
import tarfile
import tempfile
from datetime import datetime
from io import BytesIO

FEEDBACK_SCRIPTS = {
    "check", "check:full", "typecheck", "test", "test:unit", "test:integration",
    "test:type", "lint", "format", "format:check", "knip", "audit:architecture",
    "build", "vitest", "tsgo", "tsc", "oxlint", "oxfmt",
}
TARGETED = re.compile(r"\S+\.(ts|tsx|js|mjs)\b|tests?/|\s-t\s|--filter|--project|\srelated\s")


# --- materialise -------------------------------------------------------------------

def materialise(records: str, work: str) -> str:
    """Every records commit holds one snapshot; unpack them all (paths are run-scoped)."""
    marker = os.path.join(work, ".materialised")
    if os.path.exists(marker):
        return work
    os.makedirs(work, exist_ok=True)
    revs = subprocess.run(["git", "-C", records, "rev-list", "--all", "--reverse"],
                          check=True, capture_output=True, text=True).stdout.split()
    for rev in revs:
        blob = subprocess.run(["git", "-C", records, "archive", rev],
                              check=True, capture_output=True).stdout
        with tarfile.open(fileobj=BytesIO(blob)) as tar:
            tar.extractall(work, filter="data")
    open(marker, "w").close()
    return work


# --- transcript reading ------------------------------------------------------------

def events(path: str):
    for line in open(path, errors="replace"):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            yield e


def content(e: dict) -> list:
    m = e.get("message")
    if isinstance(m, dict) and isinstance(m.get("content"), list):
        return [c for c in m["content"] if isinstance(c, dict)]
    return []


def ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def classify(name: str, inp: dict) -> str:
    if name != "Bash":
        return name
    cmd = inp.get("command", "")
    m = re.search(r"pnpm (?:run |exec )?([\w:.-]+)(.*)", cmd)
    if m and m.group(1) in FEEDBACK_SCRIPTS:
        script, rest = m.group(1), m.group(2).split("|")[0].split("2>")[0]
        if script in ("test", "test:unit", "vitest"):
            return "fb:test(targeted)" if TARGETED.search(rest) else "fb:test(whole)"
        return "fb:" + script
    if re.search(r"\b(grep|rg)\b", cmd):
        return "bash:grep"
    if re.search(r"\b(cat|sed -n|head|tail)\b", cmd):
        return "bash:read"
    if re.search(r"\bgit\b", cmd):
        return "bash:git"
    return "bash:other"


def session_kind(root: str, path: str) -> str:
    parts = os.path.relpath(path, root).split(os.sep)
    base = parts[-1]
    if parts[0] in ("authoring", "decision"):
        kind = parts[0]
    elif any(p.startswith("phase-") for p in parts):
        kind = "phase"
    else:
        kind = "other"
    return kind + ("-fix" if base.startswith("fix-attempt") else "")


def sessions(root: str):
    for path in glob.glob(os.path.join(root, "**", "*.jsonl"), recursive=True):
        base = os.path.basename(path)
        if base == "output.jsonl" or base.startswith("fix-attempt"):
            yield session_kind(root, path), path


# --- sections ----------------------------------------------------------------------

def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 2) if xs else None


def p90(xs):
    xs = sorted(xs)
    return round(xs[int(0.9 * (len(xs) - 1))], 1) if xs else None


def section_sessions(root: str) -> None:
    """What each kind of session spends its tool calls on. Resumed sessions report a
    cumulative total_cost_usd (Claude Code >= 2.1.280), so fix-attempt costs include
    the phase they resume: compare deltas, never sums."""
    by = collections.defaultdict(list)
    for kind, path in sessions(root):
        tools, cost = collections.Counter(), None
        for e in events(path):
            if e.get("type") == "assistant":
                tools.update(classify(c["name"], c.get("input") or {})
                             for c in content(e) if c.get("type") == "tool_use")
            if e.get("type") == "result":
                cost = e.get("total_cost_usd")
        by[kind].append((tools, cost))
    print("== sessions: tool calls by kind (cost of *-fix is cumulative)")
    for kind, rows in sorted(by.items(), key=lambda x: -len(x[1])):
        total = collections.Counter()
        for t, _ in rows:
            total.update(t)
        n = sum(total.values()) or 1
        print(f"{kind:12} n={len(rows):4} median cost ${med([c for _, c in rows])}"
              f" median calls {med([sum(t.values()) for t, _ in rows])}")
        print("   ", ", ".join(f"{k} {100 * v / n:.0f}%" for k, v in total.most_common(8)))


def section_feedback(root: str) -> None:
    """Wall time between a tool_use and its tool_result, from the stream timestamps."""
    durs, by_month = collections.defaultdict(list), collections.defaultdict(list)
    wall = waiting = 0.0
    for kind, path in sessions(root):
        if kind != "phase":
            continue
        pending, first, last, month = {}, None, None, None
        for e in events(path):
            t = e.get("timestamp")
            if not t:
                continue
            x = ts(t)
            first, last, month = first or x, x, month or t[:7]
            for c in content(e):
                if c.get("type") == "tool_use":
                    pending[c["id"]] = (classify(c["name"], c.get("input") or {}), x)
                elif c.get("type") == "tool_result" and c.get("tool_use_id") in pending:
                    label, t0 = pending.pop(c["tool_use_id"])
                    d = x - t0
                    if 0 <= d < 3600:
                        durs[label].append(d)
                        by_month[(label, month)].append(d)
                        if label.startswith("fb:"):
                            waiting += d
        if first and last:
            wall += last - first
    print(f"\n== feedback: phases spent {waiting / 3600:.1f}h of {wall / 3600:.1f}h wall time "
          f"({100 * waiting / max(wall, 1):.0f}%) waiting on feedback commands")
    rows = sorted(((k, v) for k, v in durs.items() if k.startswith("fb:")),
                  key=lambda kv: -sum(kv[1]))
    for k, v in rows:
        print(f"  {k:20} total {sum(v) / 3600:5.1f}h calls {len(v):5} "
              f"median {med(v):6}s p90 {p90(v):6}s")
    print("  median seconds by month:")
    for k, _ in rows[:6]:
        series = [(m, med(v), len(v)) for (kk, m), v in sorted(by_month.items()) if kk == k]
        print(f"    {k:20}", "  ".join(f"{m} {d}s (n={n})" for m, d, n in series))


def section_feedforward(root: str) -> None:
    """What every session is handed before it acts: the first turn's context size, and
    which skills and memory the provider loaded (global ones are not in the repo)."""
    by_kind, skills, memory = collections.defaultdict(list), [], collections.Counter()
    for kind, path in sessions(root):
        if kind.endswith("-fix"):
            continue
        for e in events(path):
            if e.get("type") == "system" and e.get("subtype") == "init":
                skills.append((kind, len(e.get("skills") or []), e.get("claude_code_version")))
                memory[bool((e.get("memory_paths") or {}).get("auto"))] += 1
            if e.get("type") == "assistant":
                u = (e.get("message") or {}).get("usage") or {}
                by_kind[kind].append(u.get("input_tokens", 0)
                                     + u.get("cache_creation_input_tokens", 0)
                                     + u.get("cache_read_input_tokens", 0))
                break
    print("\n== feed-forward: context size at the first turn (tokens)")
    for kind, v in by_kind.items():
        print(f"  {kind:10} n={len(v):4} median {med(v)} min {min(v)} max {max(v)}")
    n = [s for _, s, _ in skills]
    if n:
        print(f"  skills loaded per session: median {med(n)} min {min(n)} max {max(n)}")
    print(f"  sessions with the user's auto-memory loaded: {memory[True]} / {sum(memory.values())}")


def section_gates(root: str) -> None:
    """Which gate step failed on the first attempt of phases that needed a second."""
    steps, rules = collections.Counter(), collections.Counter()
    n = 0
    for d in glob.glob(os.path.join(root, "*", "phase-*")):
        if not os.path.exists(os.path.join(d, "checks-attempt-02.log")):
            continue
        n += 1
        attr = os.path.join(d, "checks-attempt-01.attribution.json")
        if os.path.exists(attr):
            for s in json.load(open(attr)).get("steps", []):
                if s.get("result") == "fail":
                    steps[s.get("command")] += 1
        log = os.path.join(d, "checks-attempt-01.log")
        if os.path.exists(log):
            rules.update(set(re.findall(r"\b[a-z-]+\(([a-z0-9-]+)\)", open(log, errors="replace").read())))
    print(f"\n== gates: {n} phases needed a second attempt")
    print("  failing step on attempt 1:", steps.most_common(6))
    print("  lint rules named on attempt 1:", rules.most_common(6))


SECTIONS = {"sessions": section_sessions, "feedback": section_feedback,
            "feedforward": section_feedforward, "gates": section_gates}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--records", default=os.path.expanduser("~/.phax/records/phax"))
    ap.add_argument("--work", help="where snapshots are unpacked (reused if present)")
    ap.add_argument("--section", choices=sorted(SECTIONS), action="append")
    a = ap.parse_args()
    work = a.work or os.path.join(tempfile.gettempdir(), "phax-harness-data",
                                  os.path.basename(os.path.normpath(a.records)))
    root = materialise(os.path.expanduser(a.records), work)
    for name in a.section or SECTIONS:
        SECTIONS[name](root)


if __name__ == "__main__":
    main()
