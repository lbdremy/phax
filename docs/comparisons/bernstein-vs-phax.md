# Bernstein vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Bernstein
> v4.0.1 (2026-11-25) — the README, release notes and `docs/` of
> [`sipyourdrink-ltd/bernstein`](https://github.com/sipyourdrink-ltd/bernstein)
> (first run, quality pipeline, plans, sandbox backends, capabilities, known
> limitations, use cases, scope) — and phax 0.43.0.

## The one-line difference

**Bernstein schedules many agents in parallel under declared policy and lets
anyone verify afterwards that the record of the run was not altered; phax runs
one approved plan phase by phase and commits a phase only when your checks
pass.** Both keep models out of the sequencing and give each unit of work its
own Git worktree. Bernstein calls itself "an open-source governance layer for
AI agents"; phax is verified delegation: a spec and a plan a person approved,
gates that must exit green before each commit, the diff reconciled with the
plan, and findings that each get a fate.

## What Bernstein is, concretely

You install it with `uv tool install bernstein` (or pipx, pip, Homebrew, npm,
Docker; Python 3.12 or later) and run `bernstein init` in a repository, which
creates a `.sdd/` state directory, `bernstein.yaml` and role templates. From a
working branch:

```
bernstein -g "Add rate limiting"  # agents spawn, work in parallel, verify, exit
bernstein run plan.yaml           # a plan file: no LLM planning, run it directly
bernstein live                    # watch progress in the TUI dashboard
```

The [README](https://github.com/sipyourdrink-ltd/bernstein#how-it-works) gives
four stages. **Decompose**: "The manager breaks your goal into tasks with
roles, owned files, and completion signals. One LLM call, then plain Python
from there." **Spawn**: "Agents start in isolated git worktrees, one per coding
task". **Verify**: "The janitor checks concrete signals: tests pass, files
exist, lint clean, types correct." **Merge**: Bernstein "merges verified
changes into the working branch and refuses merge-capable runs from the default
branch".

What checks the work is described in the
[quality pipeline](https://github.com/sipyourdrink-ltd/bernstein/blob/main/docs/architecture/quality-pipeline.md):

- **Completion signals** declared on each task, such as `test_passes` ("The
  named shell command exits 0") or the model-judged `llm_review`.
- **A gate pipeline** on the diff. "A failing **required** gate hard-blocks
  merge. A failing **optional** gate is reported but does not block." In the
  configuration that page documents, `lint`, `pii_scan` and `dlp_scan` are
  `true`, and `type_check` and `tests` are `false` until you turn them on.
- **On failure**, one bounded repair task on the same branch, then a retry
  that can escalate to a more capable model.
- **Model judgment** too: an intent check (off by default), a fresh-context
  review gate, and a cross-model verifier "shipped but disabled by default".

The _runtime is Bernstein_: a scheduler in "plain Python" spawns short-lived
CLI agents, by default in a worktree that "shares the host filesystem and
network"; Docker, microVM and hosted
[sandbox backends](https://github.com/sipyourdrink-ltd/bernstein/blob/main/docs/architecture/sandbox.md)
are opt-in. State is plain files under `.sdd/`: a hash-chained replay journal
per run, a lineage spine, an opt-in HMAC audit log (`BERNSTEIN_AUDIT=1`) and a
signed run receipt that `bernstein verify receipt` checks offline. It is
Apache-2.0 and "on-prem only by design". Its README says: "**Status: beta.**
Solo-maintained, under active development. The version number counts releases,
not maturity". The repository dates from March 2026 and has about 1,200 stars.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — by hand with the bundled skills, or headlessly with `phax artifact
new spec|plan --headless --brief` — and approve them. `phax run` refuses a plan
that is not Approved or has gone Stale, then executes each phase in its **own
git worktree**, one after another, runs your project's **gate profile** after
each phase with a same-session fix loop, commits only when it passes,
reconciles the planned files against the actual diff, and stops at
`review_open` with a review handoff, an optional compliance review, an optional
headless code review whose findings each get a fate (fixed, dismissed or
deferred) and an optional GitHub PR. Nothing is merged for you. With records
turned on, every phase leaves its manifest, gate results, reconciliation, diff,
handoff and, if you keep it, transcript on a `phax/records/v1` branch, and
every run keeps a cost ledger. phax _is_ the runtime; it spawns the agent
headlessly.

## Side-by-side

| Axis                              | Bernstein                                                                                                                                                           | phax                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                    | A Python CLI and task server: a deterministic scheduler for many agents, policy as code, verifiable run records                                                     | A compiled CLI that drives one agent through an approved plan                                                                                                 |
| **Runtime**                       | Bernstein spawns short-lived CLI agents; one model call decomposes a goal (none when you pass a plan), then "plain Python"                                          | phax spawns the agent headlessly; sequencing, gates, retries and state are plain code                                                                         |
| **Rigor**                         | Completion signals and a gate pipeline after each task; a failing required gate "hard-blocks merge"; tests and type-check are gates you turn on                     | Your gate profile (typecheck, tests, lint…) after every phase; a commit only on exit 0; protected paths keep a phase from editing its own checks              |
| **Git**                           | Worktree per coding task; verified work merged into the working branch; `bernstein pr` opens a GitHub PR                                                            | Worktree per phase on chained branches, planned commit messages with trailers; nothing merges, the run stops at review; `publish-pr`                          |
| **Verification**                  | Declared signals and gates per task, opt-in model judges; owned files as a write allowlist on Claude Code; a record you can verify was not altered                  | Deterministic plan↔diff **file reconciliation**, acceptance tests written first and judged apart, compliance review, findings with ids and fates              |
| **Isolation/Safety**              | Worktree by default, sharing the host filesystem and network; opt-in Docker, microVM and hosted sandboxes; four permission modes; PII and DLP gates                 | Secure by default: provider-native filesystem jail, command allowlist, no MCP, routing that skips providers unable to enforce the mode. No sandbox of its own |
| **Model choice**                  | Model, effort and agent per step; escalation to a more capable model on failure; fallback across agents on rate limits; USD budget caps                             | Model + effort per phase from a versioned catalog, provider priority and fallback, owner's bounds per file; a cost estimate before the run, no cap            |
| **Parallelism**                   | Steps of a stage in parallel worktrees; several attempts at one task with a scripted winner; cluster workers                                                        | None inside a run: phases run one after another. `plans overlap` says which plans can run side by side as separate runs                                       |
| **Artifact lifecycle**            | Plan YAML and workflow manifests; tasks from a plan file start `PLANNED` ("Awaiting human approval before execution"); a workflow resume refuses a changed manifest | Draft → Approved → Stale → Completed/Abandoned for specs and plans, approvals recorded against a baseline, open questions decided on the record               |
| **Records**                       | Files under `.sdd/`: hash-chained journal, lineage spine, opt-in HMAC audit log, Ed25519-signed run receipt verified offline                                        | Commits on a `phax/records/v1` branch: gates, reconciliation, diff, handoff, transcript; `records explain <commit>`; a cost ledger. Not signed                |
| **Agents**                        | 55 adapter names; its limitations page says to prefer "proven adapters (claude, codex, gemini) in production workflows"                                             | Claude Code (default), Codex, Mistral Vibe                                                                                                                    |
| **Interface for an agent caller** | An MCP server (`bernstein mcp`: `bernstein_run`, `bernstein_status`…), a `bernstein-run` skill for five hosts, a REST task API, A2A endpoints                       | The CLI: `--json` on every command with published schemas, documented exit codes, seven skills, a delegating guide. No MCP server                             |
| **Hosted**                        | None for runs; a hosted read-only MCP endpoint verifies receipts                                                                                                    | None — local only; state under `~/.phax/`                                                                                                                     |
| **Footprint**                     | Python 3.12+, macOS, Linux and Windows; Apache-2.0; beta and solo-maintained, in its README's words; TUI and web dashboard; telemetry off by default                | npm launcher that downloads a binary, macOS and Linux; Apache-2.0; single maintainer, pre-1.0; local only, three providers, GitHub for pull requests          |

## The key distinction

The two are close in shape: no model decides what runs next, each unit of work
gets a worktree, and a declared check can block. The difference is **what is
being made trustworthy**:

- **Bernstein** makes the _run_ trustworthy, at scale: many agents in
  parallel, policy about who may do what, and a record whose integrity anyone
  can verify offline. Which checks a task must pass is what you declare, and a
  model's judgment can be one of them.
- **phax** makes the _change_ trustworthy for whoever delegated it: an
  approved spec and plan, every phase behind the project's gates before it
  commits, the diff reconciled file by file with the plan, and findings that
  each get a fate. Its record is plain Git commits, not signed, and its phases
  run one at a time.

So Bernstein is closer to **a scheduler and audit layer for fleets of agents**,
where the proof is that the record is intact; phax is **verified delegation**:
one approved change, checked phase by phase and handed back with its evidence.

## Where Bernstein is ahead today

- It runs tasks in parallel, each in its own worktree; phax runs phases one
  after another.
- It runs from a one-line goal (`bernstein -g "…"`); phax needs an approved
  plan.
- It takes a dependency graph (stages with `depends_on`, workflow DAGs with
  conditions and retries); a phax plan is an ordered list of phases.
- It can run several attempts at one task and pick a winner with scripted
  evaluators (`attempts: N`); phax runs a phase once.
- It ships an MCP server and a `.mcp.json`, a REST task API and A2A endpoints;
  phax is called through its CLI only.
- It lists 55 agent adapter names; phax drives three providers.
- It has a terminal dashboard (`bernstein live`) and a web one; phax has no UI.
- It offers Docker, microVM and hosted sandbox backends; phax relies on each
  provider's own sandbox.
- Its records are tamper-evident (hash-chained journal, signed receipt
  verified offline); phax's are ordinary Git commits.
- It enforces USD budgets before dispatch; phax estimates a plan's cost and
  records a run's, without a cap.
- It retries a failed task on a more capable model; phax's fix loop stays in
  the same session and model.
- It has detached runs (`bernstein run-service`; its limitations page says the
  local path does not execute tasks yet without an SSH sidecar); phax runs in
  the foreground.
- It measures reliability over k trials (`bench run --reliability k`); phax
  does not.
- It runs on Windows; phax builds for macOS and Linux.

## When each fits

- **Bernstein** if you run several agents at once and need them scheduled,
  isolated and merged across many agent CLIs, with budgets, dashboards, an MCP
  entry point and a record an auditor can verify offline.
- **phax** if you delegate one change at a time and want it held to an approved
  plan: gates that must exit green before every commit, file reconciliation,
  findings with fates and the history in Git — on three providers, locally.

## Two things worth noting

1. **This comparison is read, not run.** It is written from Bernstein's README
   and docs at v4.0.1; nobody ran Bernstein for it. Those docs mark some
   capabilities as not wired in yet, for example a cross-task gate whose
   "production consumer today is the eval bundle receipt path"
   ([merge-gate stack](https://github.com/sipyourdrink-ltd/bernstein/blob/main/docs/operations/merge-gate.md)),
   so check its docs for the one you depend on.
2. **Both tools check only what your project gives them.** Bernstein's
   [limitations page](https://github.com/sipyourdrink-ltd/bernstein/blob/main/docs/reference/KNOWN_LIMITATIONS.md)
   says "Bernstein's gates and janitor checks can only validate what your
   project exposes (tests, linters, static checks, completion signals)." The
   same holds for a phax gate profile: look at which commands actually run
   before trusting a green result.
