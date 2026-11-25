# GitHub Spec Kit vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Spec Kit v1.4.4
> (2026-11-23) — its docs site
> ([github.github.io/spec-kit](https://github.github.io/spec-kit)), and the
> [README](https://github.com/github/spec-kit/blob/v1.4.4/README.md),
> [CHANGELOG](https://github.com/github/spec-kit/blob/v1.4.4/CHANGELOG.md),
> [docs](https://github.com/github/spec-kit/tree/v1.4.4/docs), bundled
> [workflows](https://github.com/github/spec-kit/tree/v1.4.4/workflows) and
> catalogs of `github/spec-kit` at that tag — and phax 0.43.0. Quotes and
> catalog counts are those of the tag; the default branch was 13 commits
> ahead that day.

## The one-line difference

**Spec Kit is a toolkit of processes, prompts and templates, with a workflow
engine on top, that runs your AI agent _as the worker for each step_. phax is
verified delegation: it runs your AI agent _inside isolated, mechanically gated
phases_ and hands back facts, not claims.** Same spec → plan → implement
philosophy; very different enforcement.

## What Spec Kit is, concretely

You install the `specify` CLI (`uv tool install specify-cli`; Python 3.11+ and
`uv`, on Linux, macOS or Windows) and run `specify init`, which installs
commands or skills for the agent you use. The
[integration list](https://github.com/github/spec-kit/blob/v1.4.4/docs/integrations/index.md)
has 43 keys: 41 coding agents (Copilot, Claude Code, Codex, Gemini, Cursor,
Mistral Vibe, …), `generic` for any other agent and `none` for agent-neutral
scaffolding. Then, inside your agent, you drive:

```text
/speckit.constitution → /speckit.specify → /speckit.clarify → /speckit.plan
→ /speckit.checklist → /speckit.tasks → /speckit.analyze → /speckit.implement
→ /speckit.converge
```

(spelled `/speckit-specify` in Copilot's default skills mode and
`$speckit-specify` on Codex). The
[command reference](https://github.com/github/spec-kit/blob/v1.4.4/docs/reference/agentic-sdd.md)
says _"only `/speckit.specify` is strictly required before `/speckit.plan`"_;
`clarify`, `checklist` and `analyze` are optional "quality gates" that the
agent runs, and `converge` is append-only: the agent assesses the code against
spec, plan and tasks and either reports "Converged" or appends the missing
tasks, so you loop implement → converge. The README asks you to _"Run these
skills in your agent's chat, not your terminal, one at a time, reviewing each
result before continuing."_ The steps leave Markdown artifacts in your repo
(constitution, spec, plan, tasks, checklists).

Spec-Driven Development is one of three ready-made processes: the README's
headline is _"Build with a spec, fix a bug, or assess an idea — with your
coding agent."_ Around them Spec Kit ships mechanisms you combine:

- **Extensions** add commands, and hooks before and after each core command.
  Five are first-party and opt-in: `git`, `github`, `agent-context`, `bug`
  (assess → fix → test, ending in a verdict of `verified`, `partial` or
  `failed`) and `assess` (intake → research → define → shape → decide, ending
  in `go`, `needs-clarification` or `kill`). The
  [community catalog](https://github.com/github/spec-kit/blob/v1.4.4/extensions/catalog.community.json)
  lists 204 extensions; it is discovery-only, and maintainers _"do **not
  review, audit, endorse, or support the extension code itself**"_.
  **Presets** (2 first-party, 44 in the community catalog) replace templates,
  commands and scripts in priority-ordered layers; **bundles** install a set
  of extensions, presets, workflows and step types together.
- **Workflows** are YAML definitions that `specify workflow run` executes from
  your terminal: _"They chain agent commands, prompts, shell tasks, control
  flow, and human review gates into repeatable, resumable runs."_
  ([overview](https://github.com/github/spec-kit/blob/v1.4.4/docs/workflows/overview.md)).
  The
  [built-in step types](https://github.com/github/spec-kit/blob/v1.4.4/docs/workflow-steps/types.md)
  are `command`, `prompt`, `shell`, `gate`, `if`, `switch`, `while`,
  `do-while`, `fan-out`, `fan-in`, `workflow` (a call to another workflow),
  `github`, `init` and `slot`; an overlay inserts, replaces or removes steps
  of an installed workflow without forking it.
  - **What it dispatches.** A `command` or `prompt` step starts the agent's own
    CLI (for Claude Code, `claude -p <prompt>`), so it needs _"an integration
    capable of CLI execution"_; seven integration guides (Cline, Firebender,
    Kilo Code, Lingma, Trae, Zed and `generic`) say theirs does not support
    it. A step can name its `integration` and `model`, and a
    `reasoning_effort` on Copilot, Codex and Claude Code. A `shell` step runs
    a local command. A `fan-out` step runs one step per item, in sequence by
    default and concurrently when `max_concurrency` is above 1.
  - **What halts a run.** _"By default, any step that returns
    `StepResult(status=StepStatus.FAILED, ...)` at runtime halts the entire
    run — most commonly a `shell` or `command` step exiting non-zero."_
    ([API reference](https://github.com/github/spec-kit/blob/v1.4.4/docs/workflows/api.md)).
    With `continue_on_error: true` on a step, the failure is recorded and the
    run goes on. A `gate` asks for a verdict on an interactive terminal and
    pauses the run otherwise; a rejection aborts by default, or skips, or
    pauses for a retry.
  - **State and JSON.** Each run has an id and a folder,
    `.specify/workflows/runs/<run_id>/`, with `state.json` (step progress and
    outputs), `inputs.json` and `log.jsonl`. A run is `created`, `running`,
    `completed`, `paused`, `failed` or `aborted`; `specify workflow resume`
    continues a paused or failed one, and `run`, `resume` and `status` print
    one JSON object under `--json`
    ([CLI reference](https://github.com/github/spec-kit/blob/v1.4.4/docs/workflows/cli.md)).
    A paused gate can be answered without a terminal: `specify workflow resume
    <run_id> --input speckit_review_spec_verdict=approve`.
  - **What ships.** Three
    [workflows](https://github.com/github/spec-kit/tree/v1.4.4/workflows):
    `speckit` (specify → **review-spec gate** → plan → **review-plan gate** →
    tasks → implement), `bugfix` (assess → review gate → fix → test) and
    `assess` (five agent steps, then a review gate). Every step in them is an
    agent command or a human gate: none has a `shell` step, so no test or lint
    command runs unless you add one, in your own workflow or with an overlay
    (the overlay docs insert a `ruff check` step after `implement` as their
    example).
- **Git is opt-in.** _"Git repository initialization and branching are managed
  by the **git extension**, which is not installed by default."_ Once added
  (`specify extension add git`), it creates a feature branch before `specify`
  and can commit before and after each command, every auto-commit being off
  by default. Worktree isolation is not in core; two community extensions
  offer it.
- **An MCP server** (`specify mcp`), experimental and stdio-only, exposes
  read-only tools; it _"does not expose mutations, installation or update
  operations, workflow execution, confirmations, or access tiers"_.

The _runtime is still your agent_, working in your normal tree. The docs are
explicit that workflows add no sandbox: _"a `shell` step runs a local command
with **your** privileges. There is no capability sandbox"_. What an agent step
may do depends on the integration: the Claude Code adapter _"does not add a
permission-bypass flag itself"_, while Copilot dispatch _"adds `--yolo` by
default"_.

Spec Kit is MIT-licensed and lives in the `github` organization. The
repository has 151,334 stars and 13,602 forks; 1.0.0 was released on
2026-08-21, and the docs landing page counts _"320+ contributors"_.

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

| Axis | GitHub Spec Kit | phax |
| --- | --- | --- |
| **What it is** | A Python CLI that installs commands or skills and templates into your agent, plus extensions, presets, bundles, catalogs and a workflow engine | A compiled CLI that drives the agent through an approved plan |
| **Unit of work** | A feature (spec, plan, tasks), a bug or an idea, each in its folder; or one workflow run | One approved plan, run phase by phase |
| **Runtime** | Your AI agent, step by step in its chat; or `specify workflow run`, which starts the agent's CLI for each `command` or `prompt` step | phax is the runtime; it spawns the agent headlessly |
| **The "gate"** | **Human** approve/reject steps in the bundled workflows; `clarify`/`checklist`/`analyze`/`converge` are prompts the agent runs; a `shell` or `command` step that exits non-zero halts a workflow run, where the workflow has one | **Mechanical** gate profile (your real `pnpm test`/lint/build) after every phase + same-session fix loop; a phase commits only on green |
| **Verification** | `converge`: the agent judges the code against spec/plan/tasks and appends tasks; `/speckit.bug.test` records `verified`, `partial` or `failed`; no program in the docs read compares planned files with changed ones (`/speckit.bug.fix` has the agent log its deviations from the assessment) | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, acceptance tests written first and judged by a command you configure, compliance review, protected paths |
| **Review and findings** | `analyze` reports conflicts and gaps before implementation; `converge` prints a "severity-graded findings summary" and turns gaps into tasks | Compliance review against the plan; read-only code review; every finding gets an id (`C1`, `F2`) and a recorded fate: fixed, dismissed or deferred |
| **Git** | Opt-in `git` extension: a branch per feature, optional commits around commands; pull requests through your normal flow or a community extension | Worktree per phase, chained phase branches, planned commit messages with trailers, built-in `publish-pr`; merging stays yours |
| **Isolation** | None in core: the agent edits your working tree; worktrees through community extensions | Each phase runs in its **own git worktree**, always |
| **Safety** | Whatever your agent provides; "There is no capability sandbox" for workflow steps; permission flags differ by integration (Copilot dispatch adds `--yolo` by default) | Secure by default: provider-native filesystem jail, command allowlist, no MCP, routing that skips providers unable to enforce the mode. No container or VM mode |
| **Model choice** | Your agent's own setting in chat; in workflows, `integration` and `model` per step, `reasoning_effort` on Copilot, Codex and Claude Code | Model + effort per phase from a versioned catalog, provider priority and fallback, owner-set assignment bounds |
| **Parallelism** | A `fan-out` step runs its items concurrently when `max_concurrency` is above 1 (1 by default); runs have independent ids and state | Phases run in sequence; separate runs can run side by side once `plans overlap` clears them |
| **A person in the run** | Every step, in the manual flow; `gate` steps in workflows, answered on the terminal or by a verdict input on `resume` | Interactive phases declared by the plan, or `run --hold`: the run stops (exit 13) and is resumed; review at the end |
| **Artifact lifecycle** | Artifacts per feature, bug or assessment; the spec template carries a `Status: Draft` line that no command in the docs read moves; an approval is a gate verdict inside one workflow run | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline; an unapproved plan is refused |
| **Authoring** | Inside your agent with `/speckit.specify`, `/speckit.clarify`, `/speckit.plan` and `/speckit.tasks`, or the same commands dispatched by a workflow | Inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (`artifact new --headless`, experimental); open questions decided on the record |
| **Records** | Markdown artifacts in your tree; per workflow run, `state.json`, `inputs.json` and `log.jsonl` under `.specify/workflows/runs/<run_id>/` | Per-phase records on a Git branch (`phax/records/v1`); `records explain <commit>` gives a commit back its prompt, gates and handoff |
| **Cost** | Not described in the docs read | Cost ledger per run in API-list dollars (Claude Code invocations); `plans estimate` before the run; no ceiling |
| **Agents** | Broad: 41 coding-agent integrations + `generic` + `none`, several installable side by side | Claude Code (default), Codex, Mistral Vibe |
| **Output** | Markdown artifacts + code in your tree; no pull request step in core | Per-phase commits + `security.json` + records + compliance review + PR, built in |
| **Extensibility** | Extensions, presets, bundles, workflows, overlays, installable step types, community and private catalogs, experimental read-only MCP server | Gate profiles and gate report steps, provider commands you configure (brief, architecture, acceptance, plan auditor), bundled skills, versioned JSON Schemas for every file (`@lbdremy/phax-schemas` on npm) |
| **Interface for an agent caller** | `--json` on `workflow run`, `resume`, `status` and `definition`; verdict inputs that answer a gate; `specify artifact` inventory as JSON; MCP tools, read-only | `--json` on every command with a published schema, documented exit codes, `phax --usage`, installable skills, `llms.txt` ([Delegating from an agent](../delegating.md)) |
| **Hosted** | None on the pages read: a local CLI | None — local only; state under `~/.phax/` |
| **Footprint** | MIT, in the `github` organization; Python 3.11+ and `uv`; Linux, macOS and Windows; 1.x since 2026-08-21; 151,334 stars | Apache-2.0; npm launcher that downloads a binary; macOS and Linux; GitHub only for pull requests; single-maintainer, pre-1.0 project (0.43.0) |

## The key distinction

The workflows _rhyme_ — both are spec → plan → tasks/phases → implement with
review gates, and with its workflow engine Spec Kit, too, can start the agent
from a program. The difference is still **what a gate means, and who has to
put it there**:

- **Spec Kit gate** = "a human reads the artifact and approves," plus prompts
  the agent runs on its own work (`analyze`, `checklist`, `converge`). A
  workflow _can_ add a `shell` step that runs your linter or tests, and its
  non-zero exit then halts the run; none of the three bundled workflows has
  one, and such a step runs in your tree with your privileges.
- **phax gate** = "the phase's code typechecks and tests pass, or the phase
  fails and the agent loops to fix it." Enforcement is a real process exit
  code after every phase of every run, in the phase's own worktree, with
  deterministic reconciliation of plan-vs-actual.

So Spec Kit is closer to a **shared SDD discipline + prompt library + process
platform** you layer onto the agent you already use; phax is **verified
delegation**, closer to a build system with CI-style gates for agent work.
Spec Kit standardizes the _conversation, artifacts and process_; phax
standardizes the _execution and verification_.

## Where Spec Kit is ahead today

- It installs into 41 coding agents, plus a `generic` integration and an
  agent-neutral `none`, and a project switches agent with `specify integration
  switch <key>`; phax drives three agent CLIs.
- It has an extension mechanism (commands, and hooks before and after each
  core command), with five first-party extensions and a community catalog of
  204; phax has commands you configure for its gate and its planners, no way
  to add a command and no catalog.
- Presets replace its templates, commands and terminology in priority-ordered
  layers (44 in the community catalog), and an organization can host a private
  catalog; phax's spec and plan formats are fixed.
- It has a workflow engine whose steps you define: agent commands, prompts,
  shell commands, human gates, branches, loops, fan-out and calls to other
  workflows, with overlays and installable step types; phax's sequence is
  fixed: the phases of the plan, a gate after each.
- A `fan-out` step runs its items concurrently when `max_concurrency` is
  above 1; phax runs a plan's phases one after another.
- It ships two flows that need neither a spec nor a plan: `bug` (assess → fix
  → test) and `assess` (intake → research → define → shape → decide); phax
  runs only an approved plan.
- Its `github` extension turns a feature's `tasks.md` into GitHub issues; phax
  has no issue-tracker integration.
- It has an MCP server (`specify mcp`, experimental, read-only tools); phax
  has none.
- It runs on Windows as well as Linux and macOS, with Bash, PowerShell and
  Python variants of its scripts; phax ships macOS and Linux binaries only.
- It has been 1.x since 2026-08-21, with 151,334 stars, 13,602 forks and, by
  its own docs, "320+ contributors"; phax is a single-maintainer, pre-1.0
  project.

## When each fits

- **Spec Kit** if you want a process that meets you where you already work,
  across many assistants, with people in the review loop, a large extension
  ecosystem, flows for bugs and ideas as well as features, and the option to
  script the process as a workflow with the checks you choose.
- **phax** if you want each step of an approved change to pass your own
  commands before the next one starts, in its own worktree, with a
  file-by-file account of plan against diff, a fate for every review finding
  and a history in Git — i.e., you trade agent breadth, ecosystem and a
  process you can reshape for a gate and a reconciliation on every phase.

## Two things worth noting

1. **They are composable, and phax already mirrors Spec Kit's front half.**
   phax's `phax-spec` and `phax-planning` skills (or `artifact new
   --headless`) are direct analogs of `/speckit.specify` and `/speckit.plan`.
   You could author Spec-Kit-style specs and execute them through phax's gated
   phases — spec discipline on the front, mechanical execution on the back.
   phax does not read Spec Kit's `spec.md`, `plan.md` or `tasks.md`: the plan
   is written again in phax's format. In the other direction, a Spec Kit
   `shell` step runs any command, so a workflow can call `phax run --plan
   <plan> --json`, and a non-zero exit halts the workflow run. No such
   workflow ships with either tool.
2. **Relative to OpenSpec, and to the "review-by-trajectory" idea** (see
   [`openspec-vs-phax.md`](./openspec-vs-phax.md) and
   [`docs/ideas/desktop-app.md`](../ideas/desktop-app.md), not on the
   roadmap): OpenSpec sits where Spec Kit's manual flow does — skills and
   Markdown artifacts driven from inside your agent — and Spec Kit goes
   further on the run side, with a workflow engine that starts the agent's CLI
   and keeps the state of each run. Spec Kit lives at "structure the prompts,
   artifacts and process"; phax lives at "make execution isolated and gates
   mechanical." The idea's _"approve the trajectory, not the diff"_ is a step
   beyond **both**: it presumes a gate result, a reconciliation and a record
   for every phase, which phax produces and a Spec Kit workflow has only where
   its author adds the steps, then makes them the primary review surface.
