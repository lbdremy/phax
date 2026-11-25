# Fabro vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Fabro
> v0.423.0-nightly.0 (2026-11-20; its last release not marked pre-release is
> v0.254.0, 2026-06-04) — its README and the docs sources under `docs/public/`
> on the `main` branch of [`fabro-sh/fabro`](https://github.com/fabro-sh/fabro),
> published at [docs.fabro.sh](https://docs.fabro.sh) — and phax 0.43.0.

## The one-line difference

**Fabro runs a workflow graph that you write: agent steps, shell commands and
human gates, in the order and with the checks your graph declares. phax is
verified delegation: one fixed sequence, where every phase runs in its own
worktree and commits only when your project's gate exits green, whether or not
the plan's author asked for it.** In both, plain code decides what runs next
and a command's exit code can stop the work. They differ in who decides which
checks exist, in what runs the model (Fabro's own agent loop; for phax, a
vendor's agent CLI) and in where it runs (a server; a local command).

## What Fabro is, concretely

You install one Rust binary (`brew install fabro-sh/tap/fabro-nightly`), run
`fabro server start` to finish setup in a browser and `fabro repo init` in a
project, store a provider key in the server's vault, and start a workflow with
`fabro run hello` ([quick start](https://docs.fabro.sh/getting-started/quick-start)).
Its README is plain about the shape: _"Fabro runs as a server"_, on your laptop
or self-hosted from a Docker image, with a web UI and a REST API; the CLI is
its client.

A workflow is a Graphviz DOT file built from
[node types](https://docs.fabro.sh/workflows/stages-and-nodes):

```text
implement [label="Implement", prompt="Read plan.md and implement every step."]
test      [label="Run Tests", script="cargo test 2>&1 || true"]
approve   [shape=hexagon, label="Approve Plan"]
```

An **agent** node _"Runs an LLM with access to tools — bash, file editing,
sub-agents — in an agentic loop"_: by default
[Fabro runs that loop itself](https://docs.fabro.sh/core-concepts/agents)
against the provider's API, or hands the node to an external ACP agent, and a
CSS-like stylesheet picks each node's model. A **command** node _"Runs a shell
script inside the configured sandbox"_ and is
[_"`succeeded` when exit code is 0"_](https://docs.fabro.sh/execution/outcomes),
where an agent node _"Defaults to `succeeded`"_. **Human** gates pause for a
choice, conditional edges route on the outcome, parallel nodes fan out, and
with `goal_gate=true` _"the workflow fails if this node doesn't succeed"_.

So the checks are the ones the graph declares: the README pitches
_"deterministic verifications — test suites, linters, type checkers,
LLM-as-judge"_ layered into the graph, and its example workflow (plan → human
approval → implement → simplify) declares no command node.

Tools run in a [sandbox](https://docs.fabro.sh/administration/sandboxing):
`docker` (the default), `daytona` (a cloud VM) or `local`, which is _"no
isolation"_. After each node Fabro commits the file changes to a run branch;
events and [checkpoints](https://docs.fabro.sh/execution/checkpoints) go to
the server's run store, and a run can end by opening a GitHub pull request.
Fabro is MIT-licensed, free and young: the repository dates from 2026-03-13,
has 1,892 stars and 210 forks, and ships nightly releases; its
[security page](https://docs.fabro.sh/administration/security) says _"Fabro is
currently a research preview"_. It names itself _"The open source dark software
factory for expert engineers"_.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — with the bundled skills, or headlessly with `phax artifact new
spec|plan --headless --brief` — decide their open questions on the record and
approve them. `phax run` refuses a plan that is not Approved or has gone Stale,
then executes each phase in its **own Git worktree**, runs your project's
**gate profile** after it with a same-session fix loop, commits only on a green
gate, and reconciles the planned files against the actual diff. A plan can
declare an [acceptance phase](../acceptance-phases.md), whose tests a later
phase must pass without rewriting them, and a stop for a person (an interactive
phase, or `--hold` at run time). The run ends at review with its last phase
open: a compliance review against the plan and a code review (both optional)
whose [findings](../findings.md) each get an id and a fate, and an optional
GitHub pull request. Every run keeps a cost ledger and, with records turned
on, every phase leaves its gates, reconciliation, diff and handoff on a
`phax/records/v1` branch. Every command answers JSON with a schema under
`--json`. phax _is_ the runtime; it spawns the agent headlessly.

## Side-by-side

| Axis                              | Fabro                                                                                                                                                               | phax                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What it is**                    | A workflow engine: a server (web UI, REST API) and a CLI that run graphs you write in Graphviz DOT                                                                  | A compiled CLI that drives the agent through a plan's phases                                                                                                                                                       |
| **Runtime**                       | Fabro's own agent loop over provider APIs; or an external ACP agent per node                                                                                        | phax is the runtime around a vendor's agent CLI, which it spawns headlessly                                                                                                                                        |
| **Workflow shape**                | Any graph: branches, loops, fan-out, human gates, sub-workflows, child runs                                                                                         | One sequence: phases in the plan's order, then review; stops for a person at an interactive phase or `--hold`                                                                                                      |
| **Rigor**                         | As strict as the graph: command nodes (exit code), conditional edges, `goal_gate`, retry targets, loop detection; an agent node defaults to success                 | **Mechanical** gate profile (your `pnpm test`/lint/build) after every phase of every plan + same-session fix loop, explicit state machine                                                                          |
| **Git**                           | One run branch, a commit after each node, pushed for GitHub targets; optional pull request (draft by default) with optional auto-merge                              | Worktree per phase, chained phase branches, planned commit messages with run trailers, built-in `publish-pr`                                                                                                       |
| **Verification**                  | What the graph declares: tests and linters in command nodes, a second model as critic or judge, human gates; no planned-versus-changed file check in the pages read | Plan↔diff **file reconciliation**, per-gate verified surfaces, acceptance tests judged by a provider you configure, compliance review, code review                                                                 |
| **Isolation/Safety**              | A sandbox per run: Docker container (default), Daytona cloud VM with network controls, or `local` with none; three agent permission levels                          | No container or VM: the provider's own sandbox limits files to the worktree (an OS sandbox only with Codex), command allowlist, no MCP, protected paths; `isolated` mode is refused today                          |
| **Model choice**                  | Per node, by stylesheet: model, provider, reasoning effort; runtime fallback chains; a catalog across Anthropic, OpenAI, Gemini and Moonshot                        | A versioned model catalog, model + effort per phase, provider priority and fallback, owner-set assignment bounds; three providers                                                                                  |
| **Parallelism**                   | Parallel nodes (4 branches by default) that share one checkout — _"Fabro does not isolate branch files"_; child runs; concurrent runs on the server                 | None inside a run: phases run one after another. Separate runs can go side by side when `phax plans overlap` reports disjoint files                                                                                |
| **Detached runs**                 | `fabro run --detach` prints a run id; `fabro wait`, `fabro attach`, `fabro events --follow`; a self-hosted server keeps running without your laptop                 | No: `phax run` holds the calling shell until the run stops. Run state outlives the process, and `phax resume` continues it                                                                                         |
| **Multi-plan work**               | Child runs supervised by a parent run; automations with API and schedule triggers                                                                                   | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`: parallel-safety, staleness, drift after a landed run; nothing starts on a schedule                                                                |
| **Artifact lifecycle**            | Workflow files under version control; approval is a human gate inside a run, or `fabro approve` on a run waiting to start                                           | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline and a named approver                                                                       |
| **Authoring**                     | You write the graph and its prompts; Fabro validates the graph's structure                                                                                          | Spec and plan written inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (experimental); `plans lint` with no model                                                                      |
| **Agents**                        | Its own agent, with built-in tools, MCP servers and sub-agents; any ACP stdio agent                                                                                 | Claude Code (default), Codex, Mistral Vibe                                                                                                                                                                         |
| **Records**                       | Code checkpoints in Git; events, stage outputs and checkpoints in the server's run store, exported with `fabro dump`                                                | Per-phase commits, plus a `phax/records/v1` Git branch (opt-in): manifest, gate results, reconciliation, diff, handoff, optional transcript                                                                        |
| **Findings**                      | No finding ids or fates in the pages read; a review is a node of your graph, its output context for later nodes                                                     | phax numbers each review finding; each ends fixed by a commit, dismissed with a reason or deferred, on the record                                                                                                  |
| **Cost**                          | Token usage per stage, priced from its model catalog's pricing table, for any provider; routing cheap steps to cheap models is a stated use case                    | A cost ledger per run (Claude Code invocations only); `phax plans estimate` before a run, from this machine's past runs                                                                                            |
| **Interface for an agent caller** | REST API with an OpenAPI spec and SSE events; `--json` _"when the command supports it"_; `fabro events` as NDJSON                                                   | `--json` on every command with a published schema, `--json-schema` contracts, documented exit codes; no server, no API, no event stream                                                                            |
| **Hosted**                        | Self-hosted only: your laptop or a Docker host you operate (the README links a Railway template)                                                                    | None — local only; state under `~/.phax/`                                                                                                                                                                          |
| **Footprint**                     | One Rust binary and its server; Docker for the default sandbox; API keys in its vault; Linux and Apple Silicon macOS; MIT; nightly releases                         | npm launcher that downloads a binary; local only; three providers (Claude Code by default; Codex and Mistral Vibe once enabled); macOS and Linux; GitHub for pull requests; Apache-2.0; single maintainer, pre-1.0 |

## The key distinction

The two start from the same idea: the model does not decide what happens next.
Fabro's README calls its graphs _"deterministic"_, and its docs name the
problem both tools answer: _"Verification is overwhelmed. Agent throughput
exceeds human review capacity."_ The difference is **who decides which checks
exist**:

- **Fabro** gives you the parts, and you build the process. A test run is a
  command node you add, a quality bar is a `goal_gate` you set, a fix loop is
  an edge you draw; a graph without them is a valid workflow with no mechanical
  check. In exchange you can draw any process: loops, fan-out, one model
  criticising another, a person approving mid-run.
- **phax** gives you one process, and you fill in the plan. Every phase of
  every plan gets a worktree, your project's gate, the file reconciliation and
  a commit only on a green gate, and no phase may edit `phax.json` or the
  files listed in `protectedPaths`. In exchange you cannot draw another shape:
  no branch, no parallel phase, no loop beyond the fix loop.

So Fabro is closer to a **programmable workflow engine for agent work, run as
a service**, where you design the verification into each graph; phax is
**verified delegation**: a fixed path on your own machine, where the gate, the
file reconciliation and the record come with every phase.

## Where Fabro is ahead today

- Detached runs: `fabro run --detach` prints a run id at once, and a
  self-hosted server keeps the run going with your laptop closed.
- Free workflow shape and parallel work inside a run: loops, conditional
  routes, human gates anywhere, parallel nodes, child runs. phax runs one
  sequence of phases.
- A web UI (runs board, live run view, answers to human gates) and a REST API
  with an OpenAPI spec and a live event stream; phax has a CLI only.
- Container and cloud-VM sandboxes (Docker, Daytona, the latter with network
  block or allow list); phax's `isolated` mode is refused today.
- Its own agent loop over provider APIs, a model per node across Anthropic,
  OpenAI, Gemini and Moonshot with runtime fallback chains, plus any ACP
  agent; phax drives three vendor CLIs.
- Token cost priced for every provider it calls; phax's ledger covers Claude
  Code invocations only.
- Runs started by a schedule or an API trigger (automations); nothing starts a
  phax run on a schedule or an event.
- Steering a running agent mid-turn (`fabro steer`); phax takes a person's
  input at a declared or held stop, and at review.
- Adoption: 1,892 GitHub stars and 210 forks on 2026-11-25; phax is a
  single-maintainer project.

## When each fits

- **Fabro** if you want to design your own process as a graph — loops,
  fan-out, several models, human gates mid-run — and run it detached on a
  server, in containers or cloud VMs, with a web UI and an API; and you accept
  writing the checks into each graph and operating a server its docs call a
  research preview.
- **phax** if you want the checks to be there without designing them — a
  worktree and your project's gate at every phase, files reconciled against
  the plan, findings with a fate, the history in Git — on your own machine,
  with the agent CLI you already have; you trade workflow freedom, parallelism,
  detached runs and a user interface for that.

## Two things worth noting

1. **What stays in Git differs.** Fabro's README says _"Every stage commits
   code changes and execution metadata to Git branches"_. Its
   [checkpoints page](https://docs.fabro.sh/execution/checkpoints), read the
   same day, puts the file changes on the run branch and the events and stage
   results in the server's run store, and adds: _"Fabro no longer creates or
   pushes `fabro/meta/{run_id}` branches."_ So with Fabro, Git holds the code
   after each node and the server holds the history (`fabro dump` exports
   it); with phax, Git holds both once records are on.
2. **Relative to Spec Kit and OpenSpec** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md) and
   [`openspec-vs-phax.md`](./openspec-vs-phax.md)): those two structure what to
   build and leave the run to your agent; Fabro, like phax, runs the work
   itself. Spec Kit's workflows — YAML pipelines of command, prompt, shell and
   gate steps — are the nearest thing on those pages to a Fabro graph.
