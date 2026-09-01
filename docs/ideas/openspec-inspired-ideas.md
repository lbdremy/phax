# Idea: living specs, requirement-level deltas, and an explore step

> Status: **brainstorm**. Captured from the OpenSpec comparison
> ([`../comparisons/openspec-vs-phax.md`](../comparisons/openspec-vs-phax.md)) — not a
> spec, not a plan. Nothing below is committed.
>
> OpenSpec's execution philosophy ("fluid not rigid", no gates) is the deliberate
> opposite of phax's and is **not** on the table here. What is worth stealing is its
> upstream model of how specs relate to the current system.

## 1. Living specs + delta folding (the big one)

In OpenSpec, `openspec/specs/` describes **the current behavior of the system** — the
canonical truth — and each change carries only requirement **deltas**
(`ADDED / MODIFIED / REMOVED Requirements`). Archiving a completed change folds its
deltas back into the living specs.

phax's `docs/specs/` describes *work to be done*: once `Completed`, a spec moves to
`archive/` and no document states what the system does today — that knowledge is
scattered across archived specs. A "living spec per capability + per-run deltas folded
on completion" model would have direct synergies with what already exists:

- `phax plans status` already detects `spec-changed` — a living spec would give that
  check a far more meaningful baseline than today's work-order spec.
- The compliance review could verify requirement by requirement ("is the ADDED delta
  implemented?") instead of re-reading a whole plan.
- `phax artifact complete` is already the natural transition point at which to trigger
  the fold.

## 2. Requirement-level traceability

All of phax's reconciliation is file-level (`file-reconciliation`, footprints, and
`plans overlap` is explicitly "file-level, not hunk-level"). OpenSpec's delta format
suggests one level up: tie each phase to named requirements. Two plans touching the
same file but disjoint requirements are not necessarily in conflict — and vice versa.
This would refine `plans overlap` and give the compliance review an objective
checklist.

## 3. An explicit explore step

A divergence moment before proposing ("I want X but I'm not sure how to do it
cleanly" → the agent lays out options without committing). phax goes straight to
`phax-spec` / `phax-planning`. Near-zero cost: either an "exploration" section in the
`phax-spec` skill, or a pre-prompted `phax explore` modeled on `adjust-plan`
(interactive session, mutates nothing). Small gain, small effort.

## Lower priority

- **Multi-tool skill installation** — OpenSpec installs its slash commands into 30+
  assistants; `phax skills install --target claude` knows one. Extending targets
  (Cursor, Copilot, …) would widen adoption on the *planning* side — any tool could
  draft a conforming `plan.md`, even though execution stays on the three provider
  CLIs. The `--target` structure already exists; this is a natural extension.
- **Stores (cross-repo shared specs)** — relevant only if phax ever goes multi-repo.
  Note that `phax records` already has the "local clone + configured remote" plumbing
  that resembles this.
