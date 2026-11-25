# Archon vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Archon v0.14.0
> (2026-11-07) — its website ([archon.diy](https://archon.diy)), and the
> [README](https://github.com/coleam00/Archon/blob/v0.14.0/README.md) and
> [docs](https://github.com/coleam00/Archon/tree/v0.14.0/packages/docs-web/src/content/docs)
> of `coleam00/Archon` at that tag — and phax 0.43.0.

## The one-line difference

**Archon is a workflow engine: you write your process as a YAML graph of agent
prompts, shell commands, loops and waits for a person, and Archon runs that
graph with the checks you put in it.** phax is verified delegation: one fixed
process, in which an approved plan runs phase by phase, each phase in its own
Git worktree, committed only when your project's commands exit green and its
files are reconciled with the plan. Archon gives you the means to build a
process; phax is one process, with its checks built in and its evidence kept
in Git.

## What Archon is, concretely

You install a binary (`curl -fsSL https://archon.diy/install | bash`, a
PowerShell installer on Windows, Homebrew or Docker), add the agent runtimes you
use (`archon provider add claude`), and run a workflow in any Git repository:

```
archon workflow run archon-ship --branch fix/upload-timeout "<brief>" --detach
```

Its README calls it _"a factory builder. You describe how work should get done
as YAML workflows, and Archon runs them with AI agents, scripts and your
decisions in the places that need them"_, and states the split: _"The workflow
fixes the steps, the checks and the gates. The agent supplies the judgment
inside each step."_

A **workflow** is a YAML file in `.archon/workflows/` that lists nodes and their
dependencies; nodes with no dependency between them normally run in parallel. A
node is an agent `prompt:` or `command:`, `bash:` or `script:` code (_"No agent,
no model cost"_), a `loop:`, a `wait:` for a time, an event or a person, a child
`workflow:`, or `cancel:`. Each agent node can name its own `provider`, `model`
and `effort`, and nodes hand each other files through `$ARTIFACTS_DIR`. The
checks are the ones the workflow declares:

- A loop ends on `until_bash`, which the README example glosses as _"your test
  command; code decides when it is done"_, bounded by `max_iterations`.
- An approval gate or a `wait: attention` node pauses the run as one attention
  item, answered from the CLI, the web console or a chat platform.
- The bundled `sdlc` pack takes an issue to a merged pull request: `archon-ship`
  plans, implements, reviews the pull request _"through specialist lenses"_,
  fixes the findings and waits for CI, and `archon-merge-queue` merges through
  _"a gate that checks the review verdict and CI at the head commit and that the
  base branch is not red"_.

_"Repository runs get their own git worktree by default, so several can work on
one repository at once."_ The docs add that a worktree _"is not an execution or
security sandbox"_
([worktrees](https://github.com/coleam00/Archon/blob/v0.14.0/packages/docs-web/src/content/docs/guides/worktrees.md))
and that _"Archon runs the Claude Code SDK in `bypassPermissions` mode"_
([security](https://github.com/coleam00/Archon/blob/v0.14.0/packages/docs-web/src/content/docs/reference/security.md));
a node can narrow its tools with `allowed_tools` and `denied_tools`. A folder
project, which has no Git machinery, can run in a Docker container over a
read-only mount, with an approval before anything is written back.

Runs start by hand, detached, from a schedule, a GitHub event or a webhook, or
from Slack, Telegram or Discord. `archon serve` gives a web console and a REST
API with an OpenAPI spec, and `archon skill add` installs a skill so that your
coding agent can drive Archon. The README lists what is kept: _"Approval gates,
a full event log and transcript for every run, and the cost of every run, all
stored in your own database"_ (SQLite by default, PostgreSQL if you want it).

It is MIT-licensed, free and self-hosted (_"One install on your machine or
server"_), with anonymous telemetry on by default and an opt-out. It runs Claude
Code, Codex and Pi. The repository has 23,995 stars and 3,545 forks; its docs
say the current 0.x series is a rewrite of an earlier, different product. Its
README states that Archon runs built 363 of the 524 pull requests merged into
the repository between 1 and 19 October 2026: that figure is the project's own.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — with the bundled skills, or headlessly with `phax artifact new
spec|plan --headless --brief` — decide their open questions on the record and
approve them. `phax run` refuses a plan that is not Approved or has gone Stale,
then executes each phase in its **own git worktree**, runs your **gate profile**
(your typecheck, tests, lint) after each phase with a same-session fix loop, and
reconciles the planned files against the actual diff. A plan can put
[acceptance tests](../acceptance-phases.md) first: one phase writes them, and a
later phase must pass them unchanged. The run stops at `review_open` with a
review handoff, an optional compliance review and code review whose
[findings](../findings.md) each get an id and a fate, and an optional GitHub PR.
With records on, every phase leaves its gate results, reconciliation, diff and
handoff on a `phax/records/v1` branch; every run keeps a cost ledger, and
[`phax plans estimate`](../plan-estimate.md) prices a plan before it runs. Every
command answers JSON with a schema under `--json`. phax _is_ the runtime; it
spawns the agent headlessly, in the foreground, one phase after another.

## Side-by-side

| Axis | Archon | phax |
| --- | --- | --- |
| **What it is** | A workflow engine: YAML graphs of agent, code, loop and wait nodes; a CLI, a server with a web console, plugins and packs | A compiled CLI that drives the agent through an approved plan |
| **Unit of work** | One workflow run on a message, an issue or a brief | One approved plan, run phase by phase |
| **Runtime** | Archon is the runtime; it runs Claude Code, Codex and Pi "through their own CLIs and SDKs" | phax is the runtime; it spawns the agent headlessly |
| **Rigor** | What the workflow declares: node order, `until_bash` loops bounded by `max_iterations`, approval gates | **Mechanical** gate profile (your real `pnpm test`/lint/build) after every phase + same-session fix loop, explicit state machine |
| **Verification** | `bash:` and `script:` nodes and `until_bash` run your commands; review is an agent node; the `sdlc` pack waits for CI and merges through a gate on review verdict and CI | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, acceptance tests written first and judged twice, compliance review, protected paths |
| **Findings** | In the `sdlc` pack, review findings go back to the implementer, for up to three rounds | Every review finding gets an id (`C1`, `F2`) and a recorded fate: fixed, dismissed or deferred |
| **Git** | Worktree and branch per run by default (`--no-worktree` runs in place); pull requests through a forge plugin (GitHub); a merge queue in the pack | Worktree per phase, chained phase branches, planned commit messages with trailers, built-in `publish-pr`; merging stays yours |
| **Isolation/Safety** | Worktree per run, "not an execution or security sandbox"; Claude Code in `bypassPermissions` mode; per-node tool restrictions; Docker container isolation for folder projects | Secure-by-default: provider-native filesystem jail, command allowlist, no MCP, routing that skips providers unable to enforce the mode. No container or VM mode |
| **Model choice** | `provider`, `model` and `effort` per node; model tiers and aliases in configuration | Model + effort per phase from a versioned catalog, provider priority and fallback, owner-set assignment bounds |
| **Parallelism** | Independent nodes run in parallel; several runs per repository, each in its worktree | Phases run in sequence; separate runs can run side by side once `plans overlap` clears them |
| **Detached runs** | `--detach`, `archon workflow wait`, `logs --follow`; schedules and webhooks start runs | `phax run` stays in the foreground (`--verbose` prints its events); `resume` continues a stopped run |
| **A person in the run** | Approval gates and `wait: attention` items, answered from the CLI, the console or chat | Interactive phases declared by the plan, or `run --hold`: the run stops (exit 13) and is resumed; review at the end |
| **Records** | Event log, transcript and cost per run in SQLite or PostgreSQL | Per-phase records on a Git branch (`phax/records/v1`); `records explain <commit>` gives a commit back its prompt, gates and handoff |
| **Cost** | Cost of every run recorded; `budget` ceilings per run, `maxBudgetUsd` per node (Claude only) | Cost ledger per run in API-list dollars (Claude Code invocations); `plans estimate` before the run; no ceiling |
| **Multi-plan work** | Queues over issues in the `sdlc` pack: intake, build queue, merge queue | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`: parallel-safety, staleness, drift after a landed run |
| **Artifact lifecycle** | None for specs or plans: "The input is the contract"; `plan.md` is a file one stage hands the next | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline; an unapproved plan is refused |
| **Authoring** | You write workflows in YAML, and a brief for each run | Inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (`artifact new --headless`, experimental) |
| **Agents** | Claude Code, Codex, Pi; OpenCode and Copilot as deprecated community providers; a provider plugin contract | Claude Code (default), Codex, Mistral Vibe |
| **Interface for an agent caller** | `archon skill add` (a skill for Claude Code and Codex), a JSON queue contract on the CLI, REST API with OpenAPI, `llms.txt` | `--json` on every command with a published schema, documented exit codes, `phax --usage`, installable skills, `llms.txt` ([Delegating from an agent](../delegating.md)) |
| **Hosted** | Self-hosted, on your machine or a server (Docker and VPS guides); no hosted service on the pages read | None — local only; state under `~/.phax/` |
| **Footprint** | MIT; binary for macOS, Linux and Windows; SQLite by default; anonymous telemetry, opt-out; 0.x; 23,995 stars | Apache-2.0; npm launcher that downloads a binary; macOS and Linux; GitHub only for pull requests; single-maintainer, pre-1.0 project (0.43.0) |

## The key distinction

Both put a deterministic program, not the agent, in charge of the sequence, and
both can make a shell command the judge of "done". The difference is **where
the checks come from**:

- **Archon**: from the workflow you write. `until_bash` lets your test command
  end a loop, a `wait:` puts a person at a gate, and the bundled pack adds
  review, CI and a merge gate. The engine enforces what the workflow declares;
  in exchange it runs any process, with triggers, queues, chat, parallel nodes
  and work that is not code.
- **phax**: from the tool. Every phase of every run passes the project's gate
  profile, is reconciled file by file with the plan and leaves a record, and a
  plan that was not approved, or changed since its approval, does not run. In
  exchange there is one process, for one kind of work: an approved change to a
  repository.

So Archon is closer to a **workflow language and runtime for agent work**, with
which you build your own process; phax is **verified delegation**, closer to a
build system with CI-style gates for an approved plan.

## Where Archon is ahead today

- **Detached runs.** `archon workflow run … --detach` returns at once and
  `archon workflow wait <run-id>` blocks until the run finishes or needs you.
  `phax run` stays in the foreground.
- **Parallel nodes.** Nodes with no dependency between them run in parallel.
  phax phases run one after another.
- **Triggers.** Schedules, GitHub events and webhooks start runs. Every phax run
  is started by a person or a calling agent.
- **Issue in, merged pull request out.** The `sdlc` pack triages issues, builds
  them and merges through a queue. phax starts from a spec and a plan and stops
  at an open pull request.
- **An attention queue.** `archon workflow attention` lists every paused run
  with its question and choices. phax has no such list.
- **A web console and chat.** `archon serve`, and adapters for Slack, Telegram,
  Discord and GitHub webhooks. phax has no UI and no chat surface.
- **Workflows you write.** Any process with steps, checks and decisions,
  including work that is not code. phax's sequence is not configurable.
- **One task, no plan.** `archon workflow run <workflow> "<message>"` is enough.
  phax runs only an approved plan.
- **Spend ceilings.** A `budget:` block (`max_spend_usd`) per run and
  `maxBudgetUsd` per node. phax estimates and records cost, with no ceiling.
- **Waiting out a usage limit.** A run that hits a provider usage limit retries
  by itself at the reset time. phax stops (exit 8) until someone resumes it.
- **Container isolation.** Folder projects can run in a Docker container with a
  write-back approval. phax's `isolated` mode is refused today.
- **Windows and servers.** A Windows installer, Docker and VPS deployment,
  PostgreSQL, user roles. phax runs locally on macOS and Linux.
- **A REST API.** With an OpenAPI spec. phax's interface is its CLI and the JSON
  it answers.
- **Adoption.** 23,995 stars and 3,545 forks. phax has a single maintainer.

## When each fits

- **Archon** if you want to write your own process once — issue triage, queues,
  review, merge, or work that is not code — and have runs start from triggers
  or chat, run in parallel, and come to you only for the decisions you own.
- **phax** if you want each step of an approved change to pass your own commands
  before the next one starts, with a file-by-file account of plan against diff
  and a history in Git — i.e., you trade triggers, parallelism and a console
  for a gate and a reconciliation on every phase, and for records.

## Two things worth noting

1. **They are composable in one direction.** An Archon `bash:` node runs any
   command, so a workflow can call `phax run --plan <plan> --json` and read its
   exit code and JSON answer: Archon would bring the trigger, the queue and the
   attention item, phax the per-phase gates, the reconciliation and the records.
   No such workflow ships with either tool.
2. **Relative to Spec Kit and OpenSpec** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md) and
   [`openspec-vs-phax.md`](./openspec-vs-phax.md)): Spec Kit's workflow runner
   (YAML pipelines of command, prompt, shell and gate steps) is the nearest
   relative of Archon's workflows. Archon goes further on the run side (a
   worktree per run, detached runs, triggers, stored transcripts and cost);
   Spec Kit and OpenSpec go further on the spec side, where Archon has no
   artifact.
