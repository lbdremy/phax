# Kiro vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Kiro CLI 3.6.0
> (2026-11-24) and Kiro IDE 1.5.11 (2026-11-20) — its docs
> ([kiro.dev/docs](https://kiro.dev/docs/): Specs, Correctness, Hooks,
> Workflows, Headless mode, Cloud sessions, Autonomous mode, Sandbox,
> Permissions), [pricing](https://kiro.dev/pricing/),
> [changelog](https://kiro.dev/changelog/) and the README of its issue tracker
> (`kirodotdev/Kiro`) — and phax 0.43.0.

## The one-line difference

**Kiro is an agent platform: its own agent in an IDE, a CLI, the web and a
phone, with specs, hooks, workflows and cloud sandboxes around it.** phax is
verified delegation: a local CLI that takes the agent you already run (Claude
Code, Codex or Mistral Vibe) through an approved plan, lets a phase commit only
when your project's checks exit green, reconciles the plan against the diff and
keeps the evidence in Git. Kiro offers many ways to have the work checked; phax
fixes one and enforces it by program.

## What Kiro is, concretely

Kiro is Amazon's product: _"an agentic AI development platform that helps
developers and teams plan, build, and review software"_
([README](https://github.com/kirodotdev/Kiro)). You download the IDE, add the
VS Code extension, or install the CLI (`brew install kiro-cli`); Kiro Web and
the mobile apps run the same agent in the cloud. _"One unified agent harness
powers every Kiro surface."_ Four mechanisms shape and check the work:

- **[Specs](https://kiro.dev/docs/specs/).** `/spec new <name>` writes
  `requirements.md` (or `bugfix.md`), `design.md` and `tasks.md` under
  `.kiro/specs/<name>/`, with a review at each of the three phases; Quick Spec
  generates them _"in one pass without approval gates"_. `/spec run <name>`
  executes the tasks: _"Kiro analyzes your task list, figures out which tasks
  depend on each other, and runs independent tasks concurrently."_
- **[Correctness](https://kiro.dev/docs/specs/correctness/).** In the IDE, Kiro
  derives property-based tests from the requirements and runs them against the
  code. They are _"optional by default"_, and the page is plain about their
  reach: _"While not formal verification, PBT provides evidence for
  correctness"_.
- **[Hooks](https://kiro.dev/docs/hooks/).** JSON files in `.kiro/hooks/` that
  _"run shell commands or agent prompts automatically when specific events
  happen in your session"_. A `PreToolUse` hook can block a tool call, a `Stop`
  hook can send the agent back for another turn, and a hook can fire after
  each spec task. You write them, or ask Kiro to.
- **[Workflows](https://kiro.dev/docs/workflows/)** (opt-in). _"The model
  defines which agents do the work and in what order, and the Kiro runtime
  executes that plan"_: a graph of steps, loops and parallel branches, shown
  for your approval before it starts, each step _"in its own session with fresh
  context"_ and, if you say so, on its own model and effort. A loop _"repeats
  until evidence matches a condition or a safety cap is reached"_. Workflows
  run in the background, and a recipe can be told to work in a worktree.

For automation, `kiro-cli chat --no-interactive` runs a prompt in CI and
`--output-format stream-json` emits its events as JSON Lines. A
[cloud session](https://kiro.dev/docs/cloud-sessions/) (in Preview, says the
README) runs the agent _"in a managed cloud sandbox instead of on your
machine"_, up to 10 at a time, keeps working when no client is connected and
typically delivers a pull request; in Kiro Web an issue labelled `kiro` or a
schedule can start one. Locally, the agent works in your tree behind
permission rules and approval modes; an OS sandbox for its shell commands
exists and is _"off by default"_.

Kiro's source is not published: its GitHub repository is an issue tracker
(_"The Kiro product source code is not hosted here"_). Plans go from Free (50
credits a month) through Pro ($20, 1,000 credits) to Power ($200, 10,000
credits), with add-on credits at $0.04; cloud sessions and API keys need a paid
plan. It has been generally available since 2025-11-17, and its changelog
lists a release every few days.

## What phax is, concretely

A compiled CLI (Node launcher + Deno-compiled binary, Effect / TypeScript)
that **drives** an AI coding agent (Claude Code by default; Codex and Mistral
Vibe once enabled) through isolated, gated phases. You write a spec and a
`plan.md` — by hand with the bundled skills, or headlessly with `phax artifact
new spec|plan --headless --brief` — and approve them. `phax run` refuses a plan
that is not Approved or has gone Stale, then executes each phase in its **own
git worktree**, runs a mechanical **gate profile** after each phase with a
same-session fix loop, reconciles the planned files against the actual diff,
and stops at `review_open` with a review handoff, an optional compliance
review, an optional read-only code review and an optional GitHub PR. Every
review finding gets an id and a fate: fixed, dismissed or deferred. A plan can
put its acceptance tests first, judged by a provider you configure, and can
declare stops for a person's review. With records turned on, every phase
leaves its manifest, gate results, reconciliation, diff, handoff and transcript
on a `phax/records/v1` branch; every run keeps a cost ledger, and `phax plans
estimate` prices a plan before it runs. Every command answers JSON with a
schema under `--json`. phax _is_ the runtime; it spawns the agent headlessly.

## Side-by-side

| Axis                              | Kiro                                                                                                                                           | phax                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                    | An agent platform: IDE, VS Code extension, CLI, web and mobile over one agent                                                                  | A local CLI that drives another vendor's agent CLI                                                                                             |
| **Runtime**                       | Kiro is the agent and the runtime: spec task waves, workflow graphs, headless CLI, cloud sessions                                              | phax is the runtime; it spawns Claude Code, Codex or Vibe headlessly                                                                           |
| **Rigor**                         | Yours to assemble: phase reviews in specs (skipped by Quick Spec), hooks you write, workflow loops with a completion condition and a cap       | Fixed: **mechanical** gate profile after every phase + same-session fix loop; a phase commits only on green; explicit state machine            |
| **Git**                           | Your working tree locally (a workflow can be told to use a worktree); cloud sessions clone server-side and open a pull or merge request        | Worktree per phase, chained phase branches, planned commit messages with trailers, built-in `publish-pr`                                       |
| **Verification**                  | Property-based tests derived from the requirements (IDE only, optional); independent reviewer steps in workflows; CI follow-up in Kiro Web     | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, compliance review against the plan, acceptance tests judged by a program |
| **Isolation/Safety**              | Cloud: one isolated sandbox per session. Local: permission rules and approval modes; OS sandbox for shell commands, off by default             | Local worktree per phase; secure by default: provider-native filesystem jail, command allowlist, no MCP, protected paths. No VM, no cloud      |
| **Model choice**                  | Auto by default, or a named model (OpenAI, Anthropic, xAI, open-weight); model and effort per workflow step                                    | Model + effort per phase in the plan, versioned model catalog, provider priority and fallback, owner bounds per file                           |
| **Parallelism**                   | Independent spec tasks run concurrently in waves; parallel branches in workflows; up to 10 concurrent cloud sessions                           | Sequential phases; separate runs side by side once `plans overlap` says they are disjoint                                                      |
| **Detached runs**                 | Workflows run in the background; a cloud session keeps working with no client connected                                                        | None: `phax run` holds the terminal; `resume` continues a stopped run                                                                          |
| **Multi-plan work**               | Several repositories in one Kiro Web session                                                                                                   | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`; one repository per run                                                        |
| **Artifact lifecycle**            | Requirements → design → tasks, a review at each phase; tasks marked in progress or completed                                                   | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), approvals recorded against a baseline                                        |
| **Authoring**                     | Kiro writes the spec with you in chat (Requirements-First, Design-First or Quick Spec)                                                         | `phax-spec`/`phax-planning` skills in your agent, or headless from a brief; open questions decided on the record                               |
| **Records**                       | Cloud session history in a cloud session store; specs, hooks and workflow recipes under `.kiro/` in your repository                            | One commit per phase on `phax/records/v1` in your Git: gates, reconciliation, diff, handoff, optional transcript                               |
| **Cost**                          | Monthly credits by plan, $0.04 per add-on credit, a usage view in your account                                                                 | Your provider's subscription or API bill; cost ledger per run in API-list dollars (Claude Code invocations); estimate before the run           |
| **Interface for an agent caller** | `--no-interactive` with `stream-json` events and exit codes; use through third-party automation outside Kiro's own interfaces is not permitted | `--json` on every command with a `$schema`, `--json-schema` contracts, an exit code per outcome, approvals by a named grant                    |
| **Agents**                        | Kiro's own agent only                                                                                                                          | Claude Code (default), Codex, Mistral Vibe                                                                                                     |
| **Hosted**                        | Kiro Web, cloud sessions, mobile apps, scheduled tasks; GitHub and GitLab                                                                      | None — local only; state under `~/.phax/`                                                                                                      |
| **Footprint**                     | Amazon product, source not published, generally available since 2025-11; Free to $200 a month; macOS, Windows, Linux                           | Apache-2.0; npm launcher that downloads a binary; macOS and Linux; GitHub for pull requests; single-maintainer, pre-1.0 project                |

## The key distinction

Both start from a spec, break it into steps and can run without you. The
difference is **who decides what "checked" means, and whether it is enforced**:

- **Kiro** gives you the parts: generated property tests, hooks, reviewer
  agents, loops that wait for evidence, human approvals. Each is yours to turn
  on: Quick Spec skips the approvals, property tests are _"optional by
  default"_, a hook exists once you write it, and workflows are _"opt-in in
  every client"_, with the model drafting the plan the runtime executes.
- **phax** has one loop, the same for every run: an approved plan, a gate
  after every phase whose exit code decides the commit, and a file-by-file
  reconciliation of the plan against the diff. The gate is your project's own
  commands, declared once in `phax.json`.

So Kiro is closer to an **agent platform with a toolbox of checks you
compose**, from your editor to its cloud; phax is **verified delegation**,
closer to a build system with CI-style gates for the agent you already run.

## Where Kiro is ahead today

- It has a hosted layer: cloud sessions in managed sandboxes, up to 10 at a
  time, that keep working with no client connected. phax is local only.
- Its workflows run in the background while you keep working in the same
  chat; `phax run` holds the terminal.
- It runs independent spec tasks concurrently, and workflow branches in
  parallel; phax runs a plan's phases one after another.
- It has an IDE, a VS Code extension, a web app and iOS and Android apps, and
  runs on Windows; phax is a CLI for macOS and Linux, with no UI.
- Work can start from an event: an issue labelled `kiro`, a `/kiro` comment,
  or a scheduled task in Kiro Web. phax has no trigger and no scheduler; a
  person or a calling agent starts each run.
- It opens merge requests on GitLab as well as pull requests on GitHub, and
  one web session can span several repositories; phax publishes to GitHub,
  one repository per run.
- In Kiro Web it follows a pull request it opened: it monitors CI and answers
  review comments. phax opens the pull request and stops there.
- It generates property-based tests from a spec's requirements (IDE); phax
  runs the tests the plan's phases write.
- It offers an operating-system sandbox for local shell commands, and domain
  rules for the cloud sandbox's network; phax relies on each provider's own
  sandbox, and no provider it drives filters the network by domain.
- It is an Amazon product with a free tier, team credit pools and enterprise
  sign-in; phax is a single-maintainer, pre-1.0 project.

## When each fits

- **Kiro** if you want one vendor's agent everywhere you work — editor,
  terminal, browser, phone — with specs built in, parallel and background
  execution, cloud sandboxes, and the choice of how much checking a task gets.
- **phax** if you already run Claude Code, Codex or Vibe and want every
  delegated change held to the same contract: an approved plan, your gates
  after each phase, files reconciled against the plan, findings with a fate,
  records in your own Git — i.e., you trade surfaces, parallelism and a hosted
  layer for enforcement you can read back.

## Two things worth noting

1. **They are composable through the documents, not through the agent.**
   Kiro's specs are Markdown files in your repository (`.kiro/specs/<name>/`),
   with EARS requirements as phax's specs have, so a Kiro requirements
   document can be the source of a phax spec and plan. phax cannot drive
   Kiro's agent: Kiro is not one of its three providers, and Kiro's
   [pricing page](https://kiro.dev/pricing/) does not permit use through
   third-party automation that routes requests outside Kiro's own interfaces.
2. **Relative to Spec Kit and OpenSpec** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md) and
   [`openspec-vs-phax.md`](./openspec-vs-phax.md)): those two bring a
   spec → plan → tasks convention to many agents; Kiro builds a similar set of
   documents into one vendor's agent and adds a runtime and a cloud under
   them. On what makes a step count as done, all three leave the choice to
   you by default; phax makes it your gate's exit code.
