# zeroshot vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against zeroshot v17.1.1
> (2026-11-22) — its website ([zeroshot.sh](https://zeroshot.sh)), its
> [review-loop benchmark post](https://zeroshot.sh/blog/review-loop/), and the
> [README](https://github.com/the-open-engine/zeroshot/blob/v17.1.1/README.md)
> and [`docs/`](https://github.com/the-open-engine/zeroshot/tree/v17.1.1/docs)
> of `the-open-engine/zeroshot` at that tag — and phax 0.43.0.

## The one-line difference

**zeroshot sends one task through a graph of agents that you design, where
separate agent sessions review the work and the graph, not the agent, decides
what happens after each verdict.** phax is verified delegation: it runs an
approved plan phase by phase, each phase in its own Git worktree, and a phase
commits only when your project's own commands exit green and its files are
reconciled with the plan. Both start the agent themselves, and neither lets the
agent that wrote the code be the one that says it works; they differ in who
judges by default: a second agent, or your project's checks.

## What zeroshot is, concretely

You install it with `npm install -g @the-open-engine-company/zeroshot`: an npm
package around a Rust executable (Linux and macOS on x64 and arm64, Windows on
x64) that also adds four skills for Claude Code, Codex, GitHub Copilot and Pi.
Its README opens with _"A multi-agent orchestration engine that keeps coding
agents from grading their own work"_, because _"The agent that wrote the code
shouldn't be the one that says it works"_. You drive it from your agent (_"use
zeroshot to let users export their data as CSV"_) or with `zeroshot run`.

A run takes a title, a graph, an input and a runtime plan. A **graph** is JSON:
`step` and `verifier` nodes grouped by `seq`, `choice`, `par`, `loop` and `map`.
The runtime plan gives each node its agent CLI, provider, model and effort;
zeroshot _"keeps no model catalog"_. The built-in `software-change` graph has
one worker, an acceptance review and a code review side by side, a bounded
repair loop, then Git delivery: `--delivery none`, `--push`, `--pr`, or `--ship`
to merge, on GitHub, GitHub Enterprise or GitLab. Its docs say which checks are
a program's ([How execution works](https://github.com/the-open-engine/zeroshot/blob/v17.1.1/docs/concepts/execution.md)):

- _"The engine enforces the order, routes and retry limits."_ A graph is checked
  before it runs, and _"Agents cannot add steps or increase retry limits."_
- _"Agent steps and verifiers are model judgement."_ Each reviewer returns an
  enum verdict, and the graph routes on it.
- A step can instead run a script you own, in local runs only, where a non-zero
  exit is an error; and _"delivery waits on your CI and required checks and
  cannot override them"_.

For larger work, the `zeroshot-plan` skill writes a
[plan](https://github.com/the-open-engine/zeroshot/blob/v17.1.1/docs/guides/planning.md)
to `.zeroshot/plans/<id>.md`, which Git ignores unless you choose otherwise: a
status (`new`, `needs-input`, `ready`), a `base_commit`, and `AC-n` acceptance
criteria that each name a `Check:`. Its sections become the task of a run, whose
_"verifiers judge the result against the criteria"_.

A local run works in your folder (_"Local agents edit this workspace as your
user"_, [Targets](https://github.com/the-open-engine/zeroshot/blob/v17.1.1/docs/concepts/targets.md));
`--worktree` moves it to a separate, retained worktree. Reviewers share the
workspace, and _"their instruction not to edit reviewed files is not filesystem
isolation"_; with no permission policy configured, _"zeroshot may add
permission-bypass flags"_. A Docker target you host, or the hosted zeroshot
Platform, runs an exact committed revision instead.

Each run has a SQLite ledger. `status` and `list` answer JSON, `run --detach`
returns after submission, `watch` and `logs` stream resumable events, and
`zeroshot ui` replays each node's input, output and logs on a timeline. It is
MIT-licensed, sends no telemetry, and is free to run locally on your agent
subscriptions; The Open Engine Company publishes it and runs the Platform. The
repository dates from 2025-12-25 and has 2,227 stars and 215 forks. Its own
benchmark post reports a smaller model in a build-and-check loop passing 69.5%
of hidden tests against 65.6% for a larger model's single shot, on 20 tasks
with one model family; those figures are zeroshot's own.

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

| Axis | zeroshot | phax |
| --- | --- | --- |
| **What it is** | A graph engine for agent work: a Rust CLI, skills for four agents, a browser UI, a JSON-RPC API | A compiled CLI that drives the agent through an approved plan |
| **Unit of work** | One task (a sentence, or a plan's sections) sent through a graph | One approved plan, run phase by phase |
| **Runtime** | zeroshot is the runtime; it starts the agent CLI bound to each node | phax is the runtime; it spawns the agent headlessly |
| **Rigor** | The engine enforces order, routes and retry limits; what a node decides is "model judgement" unless you bind a script step | **Mechanical** gate profile (your real `pnpm test`/lint/build) after every phase + same-session fix loop, explicit state machine |
| **Verification** | Independent reviewer agents (acceptance review, code review) return verdicts; CI and required checks at delivery; script steps and a delivery check command if you add them | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, acceptance tests written first and judged twice, compliance review, protected paths |
| **Findings** | Reviewer feedback goes back to the worker inside the loop; the `code-review` template posts its findings in one PR comment | Every review finding gets an id (`C1`, `F2`) and a recorded fate: fixed, dismissed or deferred |
| **Git** | Works in your checkout by default, `--worktree` on request; delivery pushes, opens a PR or MR, or merges (`--ship`) | Worktree per phase, chained phase branches, planned commit messages with trailers, built-in `publish-pr`; merging stays yours |
| **Isolation/Safety** | Local agents "edit this workspace as your user"; reviewers share it; may add permission-bypass flags when no policy is set; Docker or Platform targets for contained runs | Secure-by-default: provider-native filesystem jail, command allowlist, no MCP, routing that skips providers unable to enforce the mode. No container or VM mode |
| **Model choice** | Agent CLI, provider, model and effort per node; "keeps no model catalog" | Model + effort per phase from a versioned catalog, provider priority and fallback, owner-set assignment bounds |
| **Parallelism** | `par` and `map` groups run nodes concurrently in one shared workspace | Phases run in sequence; separate runs can run side by side once `plans overlap` clears them |
| **Detached runs** | `run --detach`; `watch` and `logs` resume the event stream; `steer`, `suspend`, `resume` | `phax run` stays in the foreground (`--verbose` prints its events); `resume` continues a stopped run |
| **Records** | One SQLite ledger per local run, replayed in `zeroshot ui` | Per-phase records on a Git branch (`phax/records/v1`); `records explain <commit>` gives a commit back its prompt, gates and handoff |
| **Cost** | Token totals per run (`metadata.tokenUsage`) | Cost ledger per run in API-list dollars (Claude Code invocations); `plans estimate` before the run |
| **Multi-plan work** | Plans linked by `depends_on`; stacks of dependent runs on hosted targets only | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`: parallel-safety, staleness, drift after a landed run |
| **Artifact lifecycle** | Plan `status` `new` / `needs-input` / `ready`, a `base_commit` to tell when it is stale; starting the run is the decision to build it | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline; an unapproved plan is refused |
| **Authoring** | Inside your agent: `zeroshot-plan` for the plan, `zeroshot-graph-design` for the graph | Inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (`artifact new --headless`, experimental) |
| **Agents** | Claude Code, Codex, Copilot CLI, Pi; contributed adapters for OpenCode and Hermes | Claude Code (default), Codex, Mistral Vibe |
| **Interface for an agent caller** | Skills, JSON from `status` and `list`, NDJSON event streams, JSON-RPC + OpenRPC, Python SDK, a plugin with an MCP connection to Platform | `--json` on every command with a published schema, documented exit codes, `phax --usage`, installable skills ([Delegating from an agent](../delegating.md)) |
| **Hosted** | zeroshot Platform; a Docker target you host yourself | None — local only; state under `~/.phax/` |
| **Footprint** | MIT; npm package around a Rust binary; Linux, macOS and Windows; no telemetry; published by a company; first releases December 2025, now v17 | Apache-2.0; npm launcher that downloads a binary; macOS and Linux; GitHub only for pull requests; single-maintainer, pre-1.0 project (0.43.0) |

## The key distinction

The two start from the same observation, in nearly the same words: the agent
that did the work should not be the one that calls it done. Both take the
sequencing away from the agent. The difference is **who judges, and what the
judgment leaves behind**:

- **zeroshot**: the judge is another agent session, which you can bind to
  another vendor's model, and the graph routes on its verdict. Deterministic
  checks sit where you add them: a script step in a local run, your CI and
  required checks at delivery. The process is yours to design, node by node.
- **phax**: the judge is your project's commands, run by phax after every
  phase. A red gate goes back to the same session, a phase cannot change the
  files you list as protected, and every file is accounted for against the
  plan. Model judgment (compliance review, code review) comes after, at review,
  and each finding keeps an id and a fate. The process is fixed; what varies is
  the plan.

So zeroshot is closer to a **programmable review loop for coding agents**, a
graph you shape around any task; phax is **verified delegation**, closer to a
build system with CI-style gates for an approved plan.

## Where zeroshot is ahead today

- **Detached runs.** `zeroshot run --detach` returns after submission; `watch`
  and `logs` resume the event stream. `phax run` stays in the foreground.
- **Parallel work inside a run.** `par` and `map` groups run nodes at the same
  time. phax phases run one after another.
- **Steering.** `zeroshot steer RUN_ID` messages a running agent, and `suspend`
  stops a run at its next checkpoint. phax cannot message a running phase; its
  stops are declared by the plan or chosen when the run starts (`--hold`).
- **A UI.** `zeroshot ui` shows a run live in the browser and replays a finished
  one. phax has no UI.
- **Review inside the loop.** A reviewer's rejection sends the work back to the
  worker. phax's compliance and code reviews run once the run reaches review,
  and fixing a finding is a command someone runs.
- **One task, no plan.** A sentence starts a run. phax runs only an approved
  plan.
- **A process you edit.** Who writes, who reviews and where failures loop back
  is a JSON graph. phax's sequence is not configurable.
- **More agent CLIs and providers.** Copilot CLI, Pi and contributed OpenCode
  and Hermes adapters, over OpenAI, Anthropic, OpenRouter, Bedrock, Foundry or
  your own endpoint. phax drives three agent CLIs.
- **Delivery through merge.** `--pr` waits for CI and addresses PR feedback,
  `--ship` then merges; GitLab and GitHub Enterprise are supported. phax opens
  a GitHub pull request and stops there.
- **Windows.** zeroshot ships a Windows x64 build. phax runs on macOS and Linux.
- **Hosted and self-hosted targets.** A Docker target, zeroshot Platform, and
  stacked pull requests there. phax is local only.
- **An API and an SDK.** JSON-RPC with an OpenRPC spec, and a Python SDK. phax's
  interface is its CLI and the JSON it answers.
- **Memory across runs.** Active Memory, on by default, gives agents lessons
  from earlier runs. phax keeps records and does not feed them back.
- **Adoption and backing.** 2,227 stars, 215 forks, a company behind it. phax
  has a single maintainer.

## When each fits

- **zeroshot** if you want to hand single tasks or small plans to a review loop
  you can reshape, with agents from several vendors checking each other, runs
  you can detach, watch and steer, and delivery that can go through to a merge
  behind your CI.
- **phax** if you want each step of a larger, approved change to pass your own
  commands before the next one starts, in isolated worktrees, with a
  file-by-file account of plan against diff and a history in Git — i.e., you
  trade agent-breadth, parallelism and a UI for enforcement and records.

## Two things worth noting

1. **They are composable only at the edges.** Both start the agent themselves,
   so neither runs inside the other as it stands. Two seams exist: a zeroshot
   plan's `AC-n` criteria and their `Check:` commands map onto a phax spec's
   acceptance criteria and a gate profile, and a zeroshot script step runs any
   program you own that answers JSON. Neither tool documents the pairing.
2. **Relative to Spec Kit and OpenSpec** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md) and
   [`openspec-vs-phax.md`](./openspec-vs-phax.md)): those two structure the
   conversation inside your agent, and by default a person or a model checks the
   code. zeroshot and phax both sit one level down: they start the agent, fix
   the order of the steps and decide what counts as done.
