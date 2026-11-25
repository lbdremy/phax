# Codex vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Codex CLI
> 0.172.0 (2026-11-24) — its
> [changelog](https://learn.chatgpt.com/docs/changelog) and its docs, now served
> at [learn.chatgpt.com/docs](https://learn.chatgpt.com/docs/codex/cli), each
> page linked where it is quoted below — and phax 0.43.0.

## The one-line difference

**Codex is the agent; phax is a program that can run it.** Codex does the work,
in your terminal, your IDE, the desktop app or OpenAI's cloud, and on its own it
can hand parts of it to subagents, check a turn with hooks you write and review
a change. phax is verified delegation: it starts an agent CLI _as a subprocess_
for each phase of an approved plan (Claude Code by default, Codex once you
enable it), runs your project's checks itself after every phase and hands back
facts, not claims. You never choose one over the other: the real question is
what going through phax adds to Codex alone, and what it costs.

## What Codex gives you on its own, concretely

- **Delegation.** Codex can "run subagent workflows by spawning specialized
  agents in parallel and then collecting their results in one response", and
  "Current Codex releases enable subagent workflows by default"
  ([Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)).
  The aim is to "Return **summaries** from subagents instead of raw intermediate
  output". A custom agent sets its own `model` and `model_reasoning_effort`. The
  page asks for care with writes: "agents editing code at once can create
  conflicts and increase coordination overhead", and custom agent instructions
  "don't create a separate read-only sandbox".
- **Planning.** `/plan` switches a chat to plan mode, to "propose an execution
  plan before implementation work starts"
  ([CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)).
  `/goal` starts Goal mode: "The goal text becomes both the first prompt and the
  completion criteria for the task"
  ([Long-running work](https://learn.chatgpt.com/docs/long-running-work)).
- **Deciding "done".** The same page says to "Write a goal that lets ChatGPT
  verify its own progress". [Hooks](https://learn.chatgpt.com/docs/hooks) can
  "Run a custom validation check when a chat turn stops, enforcing standards": a
  `Stop` hook that returns `decision: "block"` "tells Codex to continue and
  automatically creates a new continuation prompt". A hook is yours to write,
  and "Non-managed hooks must be reviewed and trusted before they run". The
  [guide to agents](https://learn.chatgpt.com/docs/working-with-agents) states
  the stake: "Fluent writing or a confident summary is not enough to establish
  that a task succeeded."
- **Isolation.** "Locally, Codex uses an OS-enforced sandbox that limits what it
  can touch (typically to the current workspace)", and "By default, the agent
  runs with network access turned off"
  ([Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)).
  The [sandbox](https://learn.chatgpt.com/docs/sandboxing) "applies to spawned
  commands, not just to built-in file operations". `codex exec --worktree` and
  `/worktree` put a run in a managed
  [Git worktree](https://learn.chatgpt.com/docs/environments/git-worktrees).
- **Cloud tasks.** In [Codex Cloud](https://learn.chatgpt.com/docs/cloud), "Each
  task has its own workspace and can keep working while your computer is
  asleep." The person's step comes last: "Inspect changed files and check
  results, request follow-up changes, and commit or open a pull request when
  you're ready."
- **Review.** `/review` starts "a dedicated reviewer that reads the selected
  diff and reports prioritized, actionable findings without changing your
  working tree" ([Code review](https://learn.chatgpt.com/docs/code-review)). On
  GitHub, `@codex review` posts a review, and "Codex flags only P0 and P1
  issues"; its rules "don't replace tests, branch protections, or required
  approvals"
  ([GitHub reviews](https://learn.chatgpt.com/docs/third-party/github)).
- **Records and a caller's interface.** "By default, Codex saves local session
  transcripts under `CODEX_HOME`"
  ([configuration](https://learn.chatgpt.com/docs/config-file/config-advanced)).
  For a script or another agent,
  [`codex exec`](https://learn.chatgpt.com/docs/non-interactive-mode) "runs in a
  read-only sandbox" by default; with `--json`, "`stdout` becomes a JSON Lines
  (JSONL) stream" of events such as `turn.completed` and `turn.failed`, and
  `--output-schema` requests "a final response that conforms to a JSON Schema".
  The [SDK](https://learn.chatgpt.com/docs/codex-sdk) lets you "Create your own
  agent that can engage with Codex".

## What phax is, concretely

A compiled CLI that **drives** an AI coding agent (Claude Code by default; Codex
and Mistral Vibe once enabled) through isolated, gated phases. You write a spec
and a `plan.md` — with the bundled skills in your agent, or headlessly with
`phax artifact new spec|plan --headless --brief` (experimental) — and approve
them. `phax run` refuses a plan that is not Approved or has gone Stale, then
runs each phase in its **own Git worktree**, on a branch made from the previous
phase, with the model and effort the plan gives it. After each phase phax itself
runs your **gate profile** (your typecheck, tests, lint): a red gate goes back
to the same agent session, within a fix budget, and the phase commits only when
the gate is green. phax then reconciles the files the phase planned with the
files it changed. A plan can give [acceptance tests](../acceptance-phases.md) a
phase of their own, judged apart from the phase that must pass them. The run
stops at `review_open` with a review handoff, an optional compliance review
against the plan, an optional read-only code review whose
[findings](../findings.md) each get a fate, and an optional GitHub pull request.
With records on, every phase leaves its manifest, gate results, reconciliation,
diff, handoff and transcript on a `phax/records/v1` branch. Every command
answers [JSON with a schema](../json-output.md) under `--json`, so the one
delegating can be a person or another agent
([Delegating from an agent](../delegating.md)).

## Side-by-side

| Axis                                  | Codex alone                                                                                                                 | Through phax                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                        | The agent: a model working with tools in your terminal, IDE, desktop app or OpenAI's cloud                                  | A CLI that starts an agent CLI headlessly, one phase at a time                                                                                                                      |
| **Who sequences the work**            | Codex, in the chat: it spawns subagents, waits for them and returns "a consolidated response"                               | The approved plan, read by a program: phases in the plan's order, never reordered by a model                                                                                        |
| **What decides "done"**               | The model, against the goal text you gave it, unless you add a hook                                                         | The exit codes of your gate commands, run by phax after every phase                                                                                                                 |
| **Gate on your project's commands**   | Yours to build: a `Stop` hook you write and trust, or your CI                                                               | Built in: a gate profile in `phax.json`, a same-session fix loop with a budget, no commit while a gate is red                                                                       |
| **Scope check (planned vs. touched)** | Not described in the pages checked                                                                                          | Per phase and per run: planned but not done, done but not planned; a phase that touches a protected path fails its gate                                                             |
| **Maker and judge**                   | `/review` in "a dedicated reviewer"; `@codex review` on GitHub; both are Codex                                              | The gate is a program; acceptance tests are written in one phase and judged by a command you configure; reviews are separate read-only sessions                                     |
| **Isolation**                         | An OS-enforced sandbox on by default, network off by default; worktrees on request; a workspace per cloud task              | A worktree per phase, always. On a Codex phase, Codex's own `workspace-write` sandbox held to the worktree; phax adds no sandbox of its own                                         |
| **Parallelism**                       | Parallel subagents, on by default; parallel chats in worktrees; parallel cloud tasks                                        | None inside a run: phases run one after another. Separate runs can go side by side once `phax plans overlap` shows their files are disjoint                                         |
| **Plan and approval**                 | `/plan`: a plan you accept in the chat, with no status afterwards                                                           | Spec and plan are files with a status (Draft → Approved → Stale → Completed/Abandoned) and a named approver; a run refuses any other plan                                           |
| **Review and findings**               | `/review` and `codex review` locally; `@codex review` and automatic reviews on GitHub (GitLab in preview)                   | Compliance review against the plan; read-only code review; every finding gets an id and a recorded fate. No hosted reviewer                                                         |
| **Records and where they live**       | Session transcripts under `~/.codex` on your machine; cloud tasks listed by `codex cloud list`                              | One commit per phase on a Git branch (`phax/records/v1`) that travels with a clone; run state under `~/.phax/`                                                                      |
| **Cost visibility**                   | Token usage: in each `turn.completed` event, `/status` and `/usage`                                                         | A cost ledger per run, in API-list dollars, that covers Claude Code invocations only                                                                                                |
| **Other vendors' agents**             | Subagents are Codex agent threads; `config.toml` can point Codex at other model providers                                   | Claude Code, Codex or Mistral Vibe per phase, from the plan's model and effort; Claude Code is the default and the best exercised                                                   |
| **Interface for a caller**            | `codex exec`: final message on stdout, JSONL events with `--json`, `--output-schema` for the final answer; a TypeScript SDK | `--json` on every command, `--json-schema` contracts, one exit code per outcome (gate failure, limit hit, awaiting review). `phax run` holds the caller's shell until the run stops |
| **Hosted/cloud**                      | Codex Cloud tasks, scheduled and event-triggered tasks, reviews on GitHub                                                   | None: local only                                                                                                                                                                    |
| **Footprint**                         | One CLI (or the app) and a ChatGPT plan or an API key; a task starts with one prompt                                        | A second CLI on top, a `phax.json`, and a spec and a plan to approve before anything runs; Claude Code installed as well; single-maintainer, pre-1.0 project                        |

## The key distinction

Codex already holds every part a delegation needs: workers, a sandbox, a place
to plug in a check, a reviewer. The difference is **who holds the check, and
what is left afterwards**:

- **Codex alone**: the check is something you add to the agent or to your CI. A
  goal is checked by the agent that works toward it; a `Stop` hook is yours to
  write; a review reports findings and its rules "don't replace tests, branch
  protections, or required approvals". What happened is in a transcript on your
  machine or a task in Codex Cloud. For a great deal of work that is enough,
  with no setup.
- **Through phax**: the check sits outside the agent. A program that is not the
  agent starts each session, runs your commands itself, commits a phase only
  when they pass, compares the files touched with the plan and writes what it
  saw to a Git branch. The agent saying it is done never moves the run forward.

So Codex is closer to **a capable colleague with a sandbox, a cloud to work in
and a reviewer of its own**, whose checks you wire in yourself; phax is
**verified delegation**: a colleague of your choice, started by a program that
runs your checks after every phase and keeps the results in Git.

## Where Codex alone is ahead today

- **Starting at once.** One prompt starts the work. phax runs nothing without an
  Approved spec and an Approved plan.
- **Parallel work inside one task.** Subagent workflows are on by default. phax
  runs the phases of a run one after another.
- **Cloud tasks.** A task "can keep working while your computer is asleep",
  started from the web, the app, `codex cloud exec` or
  [Slack](https://learn.chatgpt.com/docs/third-party/slack). phax runs on your
  machine only, and `phax run` holds the shell that started it until the run
  stops.
- **Scheduled and triggered runs.**
  [Scheduled tasks](https://learn.chatgpt.com/docs/automations) run on a
  schedule or "from supported app events". Only a person or a caller's command
  starts a phax run.
- **A UI and computer use.** A [desktop app](https://learn.chatgpt.com/docs/app)
  for macOS, Windows and Linux, an IDE extension, and
  [Computer Use](https://learn.chatgpt.com/docs/computer-use) in the app on
  macOS and Windows. phax is a CLI with headless phases and ships neither.
- **An OS sandbox, on by default.** Every command Codex runs locally inherits
  it. phax has no sandbox of its own: its gate steps run outside any sandbox,
  with your user's rights.
- **Windows.** Codex has a native Windows sandbox. phax ships macOS and Linux
  binaries only.
- **A library.** The Codex SDK starts and resumes threads from TypeScript. phax
  is a CLI only; its npm schemas package reads its files and starts nothing.
- **Hosted pull request review.** `@codex review` and automatic reviews on
  GitHub. phax opens the pull request and stops.
- **Steering mid-task.** You can redirect a chat at any turn. A phax run stops
  for a person only at a phase the plan declares interactive, or where you asked
  with `--hold`.

## When each fits

- **Codex alone** for short tasks, exploration, read-heavy fan-out, work you
  watch as it happens or hand to the cloud, and any repository without real
  automated checks: a gate with nothing to run proves nothing.
- **Through phax** when the change is large enough to plan in phases, the
  repository has checks worth trusting, and whoever delegates — you the next
  morning, or another agent — will not watch the session and needs to read what
  passed, what left the plan and what became of each review finding.

## Two things worth noting

1. **You can build a gate yourself, in a hook or in CI.** A `Stop` hook that
   runs your tests and returns `decision: "block"` on failure keeps Codex
   working; its input carries `stop_hook_active`, "Whether this turn was already
   continued by `Stop`", so your script can end the loop. The other route is the
   one the review docs name: "Leave mechanical checks in CI." Either way a scope
   check, a fix budget and a record per step are more scripts. If one hook or
   your CI covers your need, you do not need phax.
2. **Under phax, Codex's sandbox is the security mode, and Codex is not the
   default.** In `secure` mode a Codex phase runs in Codex's own
   `workspace-write` sandbox, with writes limited to the worktree and phax's own
   state, and network egress on or off; it is the one agent phax drives whose
   commands run in an OS sandbox ([security](../security.md)). Codex is disabled
   until you enable it, Claude Code must stay installed as the fallback, the
   cost ledger does not cover Codex invocations, and Claude Code is the path
   phax exercises most ([model routing](../model-routing.md)).
