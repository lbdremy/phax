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
created → running → review_open → archived → (prune) gone
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
- **archived** — the run folder and worktrees are moved under `~/.phax/archive`, and the name stays held. `phax prune` deletes the run for real and frees its name and disk space. Archived is no longer terminal: prune is the step that removes it.

Most review commands have a `…-last` variant that targets the most recent
`review_open` run, so you can drop the short-name (see `--usage`).

## Canonical end-to-end flow

```
phax init                          # scaffold phax.json
# author plan.md  → use the `phax-planning` skill for its format (status: Approved)
phax plans lint plan.md            # check structure, planned files, run readiness
phax run my-feature --plan plan.md # extract plan + run every phase → review_open
phax enter my-feature              # review/iterate in the kept-open agent session
phax publish-pr my-feature         # push branch + open a PR (needs gh)
phax archive my-feature            # finish
phax prune my-feature              # optional: delete the archived run and free its name
```

`phax run` extracts the plan inline; `phax plans lint <plan>` checks a plan's
structure, planned files and run readiness without running it. Each phase requests a
`model` + `effort` that phax resolves to a concrete provider — inspect routing
under `phax agent` (see `--usage`).

Plans that touch `.claude/skills/` files need `phax run --allow-skill-edits`; without it
the preflight refuses (exit 11). `phax resume` inherits the consent, and the grant is
recorded per phase in `security.json` (`skillEditGrants`). See `--usage` for the flag
contract.

## Inside a phase worktree — the phase guard

A phase worktree is a linked Git worktree whose root holds `.phax-context/`. Run from
anywhere inside one, phax refuses every command that acts on phax state or on an
artifact's lifecycle, before the command runs, and names the main checkout as the place to
run it. That covers `run`, `resume`, `archive`, `publish-pr`, `review-*`,
`artifact approve`/`new`/…, `plans status --apply`, and also `enter`, `shell` and `open`.
What still runs inside:

- `phax brief [path…]`;
- the read-only commands: `validate`, `ls`, `path`, `session-info`, `completions`,
  `plans lint`, `plans status`, `artifact status`, `artifact schema`, `records explain`,
  `records status`, `records list`, `security status`;
- `schema upgrade`, which writes only the working tree's local schemas.

The guard has no flag or environment variable to turn it off, and it catches people too:
in `phax shell` or the kept-open final phase, leave the worktree to run `review-compliance`
or `publish-pr`. It is accident-proofing, not a security boundary; the sandbox's write
scope is the boundary.

## Gate steps, briefs and records

These are `phax.json` keys rather than commands, so `--usage` does not show them. The
README (sections *Diagnostics gate steps*, *Gate request*, *Brief provider*, *Plan
auditor*) holds the exact formats.

- **`"output": "diagnostics"`** on a gate step: the step prints a JSON document with
  `$schema` and `diagnostics`, and phax reads the verdict from it, not from the exit code.
  An `invariant` or `completion` finding fails the step; the findings are what the agent is
  asked to fix.
- **`"input": "gate-request"`** on a gate step: the step gets `{$schema, phase, base,
  terminal, phases}` on stdin, the facts it needs to decide what is due now and what a
  later phase is planned to bring. Each attempt's request is saved as
  `checks-attempt-NN.request.json`; `phax records explain <commit> --gates` prints it after
  its log.
- **`brief`** (a provider command): tells the agent what the project's standard expects of
  some paths and how each expectation stands. It is pushed into a phase's first prompt and
  pulled with `phax brief [path…]`, from inside a phase or from your own checkout. A brief
  never blocks; the gate still decides. In `secure` mode the phase agent is granted
  `phax brief` (source `brief` in `security.json`). Each brief is recorded as
  `brief-NN.json`; `phax records explain <commit> --briefs` prints them.
- **`planAuditor`** (a provider command): advisory findings for `phax plans lint`, never
  during a run.

## Artifact lifecycle — specs and plans carry an enforced status

Specs (`docs/specs/`) and plans (`docs/plans/`) each carry a `status` key in
their YAML frontmatter block, drawn from a fixed per-kind set (specs: `Draft`,
`Approved`, `Abandoned`, `Completed`; plans add `Stale`). phax **enforces the one
gate that matters: only an `Approved` plan can run** — `phax run` refuses a
`Draft`, `Stale`, or retired (`Abandoned`/`Completed`) plan, naming the status and
the remedy, *before* extraction. Extraction itself stays ungated, so you can
still preview a draft's `phax-plan.json`.

The `phax artifact` command group inspects and moves lifecycle status through its
legal transitions (see `--usage` for the exact subcommands and flags):

- `phax artifact status <path>` — report an artifact's kind, current status, and
  legal transitions.
- `phax artifact approve <path>` — the `Draft → Approved` gate; run it on a plan
  under `docs/plans/` before `phax run`. Approving stamps `approved: { date, baseline }`
  into the frontmatter and writes the artifact's own record file (`docs/plans/approvals/<plan file name>.json`
  for plans, `docs/specs/approvals/<spec file name>.json` for specs). Re-approving an already-`Approved` artifact
  is legal — it re-records the approval against the current content, the correct way to log an
  in-place revision (don't hand-edit the stamp). Approving a plan whose `Source-Spec` is an
  Approved spec that is **unrecorded** or **edited since** its approval is refused with exit
  12 — re-approve the spec first.
- `phax artifact stale` / `reopen` — mark a plan `Stale`, or reopen a `Stale`
  plan back to `Draft` (plans only).
- `phax artifact abandon` / `complete` — terminal transitions; phax moves the file
  into the matching `archive/` directory and deletes its record file as part of the transition.
  Reopen deletes the plan's record file the same way. No transition touches another
  artifact's record file.
- `phax artifact migrate-approvals` — the one-time upgrade from the old shared ledgers
  (`docs/plans/approvals.json`, `docs/specs/approvals.json`) to per-artifact record files
  under `docs/plans/approvals/` and `docs/specs/approvals/`, in one commit. Exits 0 when
  migrated or when there is nothing to migrate; exits 12, writing nothing, on an unreadable
  ledger, an entry that is not a live artifact path, an uncommitted change to a path it
  would write, or an existing record file holding a different record. While a ledger
  exists, every other approval command exits 12 and names this command.

Transitions are validated: an illegal one is refused and names the legal set, and
a terminal status must live under `archive/` (status and location must agree). A
loose `plan.md` outside `docs/specs/`|`docs/plans/` is still gated on status, but
its status line is edited by hand — `phax artifact` targets repo-tracked
artifacts.

When unsure about any command, read its `long_help` and `example` in
`phax --usage`.
