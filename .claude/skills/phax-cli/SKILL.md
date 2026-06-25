---
name: phax-cli
description: Operate the phax CLI — its concepts, run lifecycle, and the canonical init → plan → run → review → publish flow. Use when driving phax, explaining it to a developer, or scripting against it. Defers to `phax --usage` for the exact command/flag contract.
---

# phax CLI skill

This skill is the **map**, not the territory. For the exact, version-accurate
command/flag/argument contract — every command, its flags, args, examples, and
help — run:

```
phax --usage              # KDL spec, source of truth, no external dependency
phax --usage-format json  # same contract as JSON (needs the `usage` CLI)
```

`--usage` is generated from the CLI's own command tree, so it never drifts from
the installed binary. **Don't memorize or restate flags here — read `--usage`.**
This skill only covers what `--usage` can't express: the concepts, the run
lifecycle, and how commands fit together.

## What phax is

A deterministic, local CLI that drives an AI coding agent (Claude Code by
default; also Mistral Vibe and OpenAI Codex) through isolated, **gated phases**.
Each phase runs in its **own Git worktree**, executes the agent, then runs a
**gate profile** (typecheck, tests, lint, …) with a **same-session fix loop** —
the agent fixes gate failures in the same context before the phase may commit.
The **final phase worktree stays open** for human review; phax never pushes or
opens a PR on its own.

## Run lifecycle — the command you reach for depends on the state

Runs live in a local registry (`~/.phax/runs/`), are addressed by a
**short-name** (e.g. `usage-cli`), and move through:

```
created → running → review_open → archived
                 ↘ failed
```

- **created / running** — phases executing. After an interruption, continue
  with `resume`.
- **failed** — a phase failed and the loop stopped. Inspect with `session-info`
  (or `enter-phase` to attach to the uncommitted worktree), then `reset-phase`
  to clear it and `resume` to re-run from there.
- **review_open** — all phases committed; the final worktree is open and waiting
  for a human. This is where you `enter` / `shell` / `open` to review,
  optionally `review-compliance`, then `publish-pr` and finally `archive`.
- **archived** — worktrees removed. Terminal.

Most review commands have a `…-last` variant that targets the most recent
`review_open` run, so you can drop the short-name (see `--usage`).

## Canonical end-to-end flow

```
phax init                          # scaffold phax.json
# author plan.md  → use the `phax-planning` skill for its format
phax run my-feature --plan plan.md # extract plan + run every phase → review_open
phax enter my-feature              # review/iterate in the kept-open agent session
phax publish-pr my-feature         # push branch + open a PR (needs gh)
phax archive my-feature            # finish
```

`phax run` extracts the plan inline; `phax extract-plan` is the standalone step
if you want to inspect `phax-plan.json` first. Each phase requests a
`model` + `effort` that phax resolves to a concrete provider — inspect routing
under `phax agent` (see `--usage`).

When unsure about any command, read its `long_help` and `example` in
`phax --usage`.
