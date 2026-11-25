# Claude Code vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Claude Code
> 2.1.332 (2026-11-25) — its
> [changelog](https://code.claude.com/docs/en/changelog) and its docs, from
> [Run agents in parallel](https://code.claude.com/docs/en/agents) to
> [Claude Ship](https://code.claude.com/docs/en/claude-ship), each page linked
> where it is quoted below — and phax 0.43.0.

## The one-line difference

**Claude Code is the agent; phax is a program that runs it.** Claude Code does
the work, and on its own it can hand parts of it to other Claude sessions, check
them with hooks you write and review the result. phax is verified delegation: it
starts Claude Code _as a subprocess_ for each phase of an approved plan, runs
your project's checks itself after every phase and hands back facts, not claims.
You never choose one over the other: phax needs Claude Code (or another agent)
installed, so the real question is what going through phax adds to Claude Code
alone, and what it costs.

## What Claude Code gives you on its own, concretely

- **Delegation.** There are "five ways to work on several tasks at once:
  subagents, agent view, agent teams, dynamic workflows, and projects"
  ([Run agents in parallel](https://code.claude.com/docs/en/agents)). A
  [subagent](https://code.claude.com/docs/en/sub-agents) "does that work in its
  own context and returns only the summary";
  [agent teams](https://code.claude.com/docs/en/agent-teams) are "experimental
  and disabled by default"; a
  [dynamic workflow](https://code.claude.com/docs/en/workflows) is a script
  Claude writes, with "Up to 16 concurrent agents by default" and "1,000 agents
  total per run". And: "In every approach the workers are Claude sessions."
- **Planning.** In
  [plan mode](https://code.claude.com/docs/en/permission-modes#analyze-before-you-edit-with-plan-mode)
  "Claude reads files, runs shell commands to explore, and writes a plan, but
  does not edit your source"; approving it in the session starts the edits.
- **Deciding "done".** "Hooks are user-defined shell commands"
  ([hooks](https://code.claude.com/docs/en/hooks-guide)). A `Stop` hook that
  exits 2 sends Claude back to work, up to a cap: "Claude Code overrides a Stop
  hook after it blocks eight times in a row with no tool call from Claude in
  between." In agent teams, `TaskCompleted` "runs when a task is being marked
  complete. Exit with code 2 to prevent completion and send feedback."
  [`/goal`](https://code.claude.com/docs/en/goal) keeps Claude working until a
  condition holds, "so completion is decided by a fresh model rather than the
  one doing the work"; that evaluator "doesn't run commands or read files
  independently".
- **Isolation.**
  [`claude --worktree`](https://code.claude.com/docs/en/worktrees) starts a
  session in a Git worktree, a subagent takes `isolation: worktree`, and
  `/batch` splits a change "into 5 to 30 worktree-isolated subagents". The
  [Bash sandbox](https://code.claude.com/docs/en/sandboxing) "covers shell
  commands only. Claude's file tools, MCP servers, and hooks run outside it."
- **Review.**
  [`/code-review`](https://code.claude.com/docs/en/code-review-local) reviews a
  diff in a subagent, on any plan.
  [`/ship`](https://code.claude.com/docs/en/ship-command) (2.1.330 or later)
  opens the pull request, reviews it, then watches it and "pushes fixes"; then
  "merge it yourself".
  [Claude Ship](https://code.claude.com/docs/en/claude-ship) hosts that chain
  for Team and Enterprise plans:
  [Code Review](https://code.claude.com/docs/en/code-review) "doesn't approve or
  block the pull request" by itself and works "without building or running your
  code"; [PR Steward](https://code.claude.com/docs/en/pr-steward) "is designed
  not to approve or merge pull requests"; the
  [Claude Approvals](https://code.claude.com/docs/en/approvals) check follows a
  policy in `.claude/approvals.yml`, whose conditions "can't read CI results",
  and "blocks a merge only where you make it a required check in GitHub".
- **Records and a caller's interface.**
  [Transcripts](https://code.claude.com/docs/en/claude-directory) are JSONL
  files under `~/.claude/projects/`, deleted after 30 days by default;
  [checkpoints](https://code.claude.com/docs/en/checkpointing) "are designed for
  quick, session-level recovery".
  [`claude -p`](https://code.claude.com/docs/en/headless) "exits with code 0 on
  success and a non-zero code when the run fails", and its JSON output "includes
  `total_cost_usd` and a per-model cost breakdown".

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

| Axis                                  | Claude Code alone                                                                                                                              | Through phax                                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                        | The agent: a model working with tools in your terminal, IDE, desktop app or the cloud                                                          | A CLI that starts that agent headlessly, one phase at a time                                                                                                                        |
| **Who sequences the work**            | Claude, turn by turn (subagents); a lead session (agent teams); a script Claude writes (dynamic workflows)                                     | The approved plan, read by a program: phases in the plan's order, never reordered by a model                                                                                        |
| **What decides "done"**               | The model, unless you add a hook; `/goal` adds a second model that reads the conversation                                                      | The exit codes of your gate commands, run by phax after every phase                                                                                                                 |
| **Gate on your project's commands**   | Yours to build: a `Stop` hook script (overridden after eight blocks in a row with no tool call), `TaskCompleted` in agent teams                | Built in: a gate profile in `phax.json`, a same-session fix loop with a budget, no commit while a gate is red                                                                       |
| **Scope check (planned vs. touched)** | Not described in the pages checked                                                                                                             | Per phase and per run: planned but not done, done but not planned; a phase that touches a protected path fails its gate                                                             |
| **Maker and judge**                   | `/code-review` in a fresh subagent; the `/goal` evaluator, a second model that reads the conversation                                          | The gate is a program; acceptance tests are written in one phase and judged by a command you configure; reviews are separate read-only sessions                                     |
| **Isolation**                         | Opt-in: `--worktree`, `isolation: worktree`, the Bash sandbox (shell commands only); a managed VM in the cloud                                 | A worktree per phase, always; in `secure` mode (the default) Claude Code's file tools held to the worktree, a command allowlist, no MCP                                             |
| **Parallelism**                       | Parallel subagents, `/batch`, workflows (16 concurrent agents by default, 1,000 per run), background sessions                                  | None inside a run: phases run one after another. Separate runs can go side by side once `phax plans overlap` shows their files are disjoint                                         |
| **Plan and approval**                 | Plan mode: a plan you approve in the session, with no status afterwards                                                                        | Spec and plan are files with a status (Draft → Approved → Stale → Completed/Abandoned) and a named approver; a run refuses any other plan                                           |
| **Review and findings**               | `/code-review`, `/ship`, `/steward` locally; hosted Code Review, PR Steward and Approvals (the last two in public beta) on Team and Enterprise | Compliance review against the plan; read-only code review; every finding gets an id and a recorded fate. No hosted reviewer, no approval policy                                     |
| **Records and where they live**       | Session transcripts under `~/.claude/projects/`, swept after 30 days by default; checkpoints for the session                                   | One commit per phase on a Git branch (`phax/records/v1`) that travels with a clone; run state under `~/.phax/`                                                                      |
| **Cost visibility**                   | `total_cost_usd` in `claude -p --output-format json`; `/usage` in a session; `--max-budget-usd`                                                | A cost ledger per run, in API-list dollars; [`phax plans estimate`](../plan-estimate.md) before a run, once the repository has 60 sized phases of history                           |
| **Other vendors' agents**             | "In every approach the workers are Claude sessions"; another tool comes in as an MCP server                                                    | Claude Code, Codex or Mistral Vibe per phase, from the plan's model and effort; Claude Code is the default and the best exercised                                                   |
| **Interface for a caller**            | `claude -p`: exit 0 or non-zero, a JSON result with the session id and cost, `--json-schema` for the final answer                              | `--json` on every command, `--json-schema` contracts, one exit code per outcome (gate failure, limit hit, awaiting review). `phax run` holds the caller's shell until the run stops |
| **Hosted/cloud**                      | Cloud sessions, cloud scheduled tasks (research preview), hosted review agents                                                                 | None: local only                                                                                                                                                                    |
| **Footprint**                         | One CLI and a subscription or an API key; a task starts with one prompt                                                                        | A second CLI on top, a `phax.json`, and a spec and a plan to approve before anything runs; single-maintainer, pre-1.0 project                                                       |

## The key distinction

Claude Code already holds every part a delegation needs: workers, a place to
plug in a check, a reviewer. The difference is **who holds the check, and what
is left afterwards**:

- **Claude Code alone**: the check is something you add to the agent. A hook is
  yours to write; a `Stop` hook is overridden after eight blocks in a row with
  no tool call; the `/goal` evaluator "can only judge what Claude has already
  surfaced in the conversation". What happened is in a transcript on your
  machine. For a great deal of work that is enough, with no setup.
- **Through phax**: the check sits outside the agent. A program that is not the
  agent starts each session, runs your commands itself, commits a phase only
  when they pass, compares the files touched with the plan and writes what it
  saw to a Git branch. The agent saying it is done never moves the run forward.

So Claude Code is closer to **a capable colleague with a team of its own and its
own ways of checking its work**, which you can equip further with hooks; phax is
**verified delegation**: the same colleague, started by a program that runs your
checks after every phase and keeps the results in Git.

## Where Claude Code alone is ahead today

- **Starting at once.** One prompt starts the work. phax runs nothing without an
  Approved spec and an Approved plan.
- **Parallel work inside one task.** Parallel subagents, `/batch`, and dynamic
  workflows whose agents can "adversarially review each other's findings before
  they're reported". phax runs the phases of a run one after another.
- **Background and detached work.** `claude --bg` and
  [agent view](https://code.claude.com/docs/en/agent-view) (research preview)
  keep sessions running with no terminal attached. `phax run` holds the shell
  that started it until the run stops.
- **Cloud runs.** A
  [cloud session](https://code.claude.com/docs/en/claude-code-on-the-web) runs
  "in an isolated, Anthropic-managed VM" and "keeps running after you close your
  laptop". phax runs on your machine only.
- **Scheduled and triggered runs.**
  [`/loop`](https://code.claude.com/docs/en/scheduled-tasks), Desktop scheduled
  tasks and [cloud scheduled tasks](https://code.claude.com/docs/en/routines)
  (research preview). Only a person or a caller's command starts a phax run.
- **A UI and computer use.** The desktop app, agent view and the web; and
  [computer use](https://code.claude.com/docs/en/computer-use), a research
  preview on macOS. phax is a CLI with headless phases and ships neither.
- **Steering mid-task.** You can redirect a session at any turn. A phax run
  stops for a person only at a phase the plan declares interactive, or where you
  asked with `--hold`.
- **Policy-based approvals and hosted pull request agents.** Claude Approvals,
  PR Steward and hosted Code Review. phax opens the pull request and stops.

## When each fits

- **Claude Code alone** for short tasks, exploration, fan-out research and
  audits, work you watch as it happens, and any repository without real
  automated checks: a gate with nothing to run proves nothing.
- **Through phax** when the change is large enough to plan in phases, the
  repository has checks worth trusting, and whoever delegates — you the next
  morning, or another agent — will not watch the session and needs to read what
  passed, what left the plan and what became of each review finding.

## Two things worth noting

1. **You can build a gate yourself with hooks, and the
   [best practices](https://code.claude.com/docs/en/best-practices#enforce-the-check-with-a-stop-hook)
   show how.** A `Stop` hook that runs your tests and exits 2 on failure is a
   few lines of settings. What stays yours: the script reads `stop_hook_active`
   so it does not loop, Claude Code overrides it after eight blocks in a row
   with no tool call (a cap you can raise with
   `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`), it fires at the end of every turn rather
   than once per planned step, and its result is a line in a transcript. A scope
   check, a fix budget and a record per step are more scripts. If one hook
   covers your need, you do not need phax.
2. **phax's security mode relies on Claude Code's own controls.** In `secure`
   mode phax holds Claude Code's file-editing tools to the worktree and allows
   only your gate commands and the commands you list. It adds no OS sandbox of
   its own: an allowed command runs with your user's rights. The hooks and deny
   rules of your personal Claude settings do not run in phax's headless sessions
   either; a guardrail every session must keep belongs in the repository's
   committed `.claude/settings.json` ([security](../security.md)).
