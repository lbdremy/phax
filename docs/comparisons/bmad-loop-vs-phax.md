# BMad Loop vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against BMad Loop
> v0.13.2 (2026-10-10) and its `main` branch (last pushed 2026-11-22) — its
> [README](https://github.com/bmad-code-org/bmad-loop/blob/main/README.md),
> [feature catalog](https://github.com/bmad-code-org/bmad-loop/blob/main/docs/FEATURES.md),
> [CLI, configuration and run-state references](https://github.com/bmad-code-org/bmad-loop/tree/main/docs/reference)
> and CHANGELOG, and the [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)
> README (v6.12.4, 2026-10-14) — and phax 0.43.0.

## The one-line difference

**BMad Loop and phax are the same kind of program: plain code that starts a
coding agent, runs your commands on what it left, and commits only then.** BMad
Loop does it for the stories of a BMAD project, one after another, across six
agent CLIs; phax is verified delegation of one approved spec and plan, with
every phase in its own worktree, the plan reconciled file by file against the
diff, and the evidence kept on a Git branch. Same refusal to take a model's
word; different unit of work, different defaults, different record.

## What BMad Loop is, concretely

[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) is a set of skills
and workflows you install into your AI coding tool (`npx bmad-method install`)
and drive from inside it. Its README lists BMad Loop among its modules:
_"Builds, verifies, and retros a whole epic unattended"_. BMad Loop is a
separate Python CLI and TUI, installed with `uv tool install`, which its own
README describes as _"A deterministic ralph-loop orchestrator for the
BMAD-METHOD implementation phase"_. After `bmad-loop init` and `validate`,
`bmad-loop run` drives:

```
pick story → DEV → VERIFY → REVIEW → VERIFY → COMMIT → next story
```

Stories come from the BMAD sprint board (`sprint-status.yaml`) or from a
`stories.yaml` breakdown. For each one it launches a fresh agent session in a
terminal multiplexer (tmux by default), and that session plans the story's
spec, implements it and reviews itself. Then the program takes over:

- **What checks the work.** _"After each session the orchestrator checks the
  spec status, the baseline commit, that code actually changed, and that the
  board matches, then runs your `[verify]` commands before it commits."_ A
  failure _"feeds a fix session the output"_, and a session is complete _"only
  on a completion event from the coding agent or the death of its session,
  never on model prose"_.
- **Review.** A separate session _"that never inherits the implementer's
  context, optionally on a different CLI or model"_, at most
  `max_review_cycles` times (3 by default).
- **When it does not converge.** A story that exhausts `max_dev_attempts` is
  deferred and the run moves on (in place, it pauses for a manual rollback if
  the attempt left changes). A CRITICAL escalation pauses the run for
  `bmad-loop resolve`, and a gate (`per-epic` by default) pauses it for you.
- **Deferred work.** Sessions append split-off goals and findings to
  `deferred-work.md` (`DW-<n>` entries); `bmad-loop sweep` triages them against
  the code and builds the buildable ones through the same loop.
- **Git and isolation.** Work happens in place on your branch by default;
  `[scm] isolation = "worktree"` gives each story a worktree and a branch,
  merged back locally, and _"no PRs are opened"_. Sessions launch with their
  CLI's permission-bypass flags by default; a `sandboxed` mode for claude and
  codex is on `main`, not yet in a tagged release.
- **What it stores.** `.bmad-loop/runs/<run-id>/` holds `state.json`, an
  append-only `journal.jsonl` and session logs. `init` gitignores it.

It is MIT-licensed (© BMad Code, LLC) and free. Its README opens with a
warning: _"Early open beta — experimental, and moving fast"_, with _"breaking
changes in any pre-1.0 release"_. The repository dates from 2026-06-19 and has
193 stars; BMAD-METHOD has about 55,700.

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

| Axis                              | BMad Loop                                                                                                                                             | phax                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What it is**                    | A Python CLI and TUI that runs the implementation phase of a BMAD project                                                                             | A compiled CLI that drives the agent through an approved plan                                                                                         |
| **Unit of work**                  | A story from the sprint board or a `stories.yaml` breakdown; the dev session plans the story's spec itself                                            | A phase of a plan approved beforehand, with the files it declares                                                                                     |
| **Runtime**                       | BMad Loop starts one fresh agent session per story, in tmux, and you can attach to it                                                                 | phax is the runtime; it spawns the agent headlessly                                                                                                   |
| **Rigor**                         | Your `[verify]` commands plus spec-status, baseline, non-empty-diff and board checks before each commit; a failure goes to a fix session              | **Mechanical** gate profiles (your typecheck/tests/lint/build) after every phase + same-session fix loop, explicit state machine                      |
| **Git**                           | In place on your branch by default; one squashed commit per story; opt-in worktree per story merged back locally; opens no pull request               | Worktree per phase, chained phase branches, planned commit messages with trailers, built-in `publish-pr`                                              |
| **Verification**                  | Checks that code changed, not which files; a separate fresh-context review session, optionally on another CLI or model                                | Deterministic plan↔diff **file reconciliation**, per-gate verified surfaces, compliance review against the plan, acceptance tests judged by a program |
| **Isolation/Safety**              | Worktree opt-in; sessions launch with permission-bypass flags by default (`sandboxed` mode on `main`, unreleased)                                     | Worktree always; secure by default: provider-native filesystem jail, command allowlist, no MCP, protected paths, per-phase `security.json`            |
| **Model choice**                  | A CLI and a model per stage (`[adapter.dev]`, `[adapter.review]`, …) in the policy file                                                               | Model + effort per phase in the plan, versioned model catalog, provider priority and fallback, owner bounds per file                                  |
| **Artifact lifecycle**            | Story status on the board, written only by BMad Loop during a run; gates per epic or per story spec, checkpoints, `resolve`, `confirm`                | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), approvals recorded against a baseline; stops declared by the plan or `--hold`       |
| **Authoring**                     | BMAD-METHOD skills inside your agent write the planning artifacts and the board; the loop's dev session writes each story's spec                      | `phax-spec`/`phax-planning` skills in your agent, or headless from a brief; `plans lint`, `plans overlap`, `plans estimate`                           |
| **Findings**                      | `deferred-work.md` ledger with `DW-<n>` ids; `sweep` sorts entries into resolved, buildable, blocked, skipped or a decision, and builds the buildable | Ids given by phax (`C1`, `F2`) and a fate for each: fixed by a commit, dismissed with a reason, deferred to a file                                    |
| **Records**                       | Run folder with `state.json`, `journal.jsonl` and logs; gitignored, per machine                                                                       | One commit per phase on `phax/records/v1`, which travels with a clone; `records explain <commit>`                                                     |
| **Cost**                          | Cost-weighted token totals per story; a per-session budget that warns or ends the session                                                             | Cost ledger per run in API-list dollars (Claude Code invocations); estimate before the run; no budget that ends a session                             |
| **Parallelism**                   | One story at a time (parallel units planned)                                                                                                          | Sequential phases; separate runs side by side once `plans overlap` says they are disjoint                                                             |
| **Detached runs**                 | Runs launched from the TUI are detached and survive its exit; `attach`, `stop --graceful`, `resume`                                                   | None: `phax run` holds the terminal; `resume` continues a stopped run                                                                                 |
| **Interface for an agent caller** | `--json` on `status`, `list`, `validate` and seven more commands, each with a `schema_version`; exit codes 0, 1, 2, 130                               | `--json` on every command with a `$schema`, `--json-schema` contracts, an exit code per outcome, approvals by a named grant                           |
| **Agents**                        | Six CLI profiles: claude, codex, gemini, copilot, antigravity (experimental), opencode; your own as a TOML profile                                    | Claude Code (default), Codex, Mistral Vibe                                                                                                            |
| **Hosted**                        | None — local                                                                                                                                          | None — local only; state under `~/.phax/`                                                                                                             |
| **Footprint**                     | Python tool installed with `uv`; needs tmux and a BMAD project; Linux, macOS, Windows via WSL; MIT; early open beta inside the BMAD-METHOD ecosystem  | npm launcher that downloads a binary; macOS and Linux; GitHub for pull requests; Apache-2.0; single-maintainer, pre-1.0 project                       |

## The key distinction

The two agree on the main point: sequencing, retries and completion are code,
and a commit waits for your own commands to exit green. The difference is
**what the work is checked against**:

- **BMad Loop** checks the _outcome of a story_: something changed, the spec
  and the board say done, your verify commands pass, and a second session
  reviewed it. What should change is decided inside the dev session, which
  plans the story's spec as it goes. Worktrees and sandboxing are options.
- **phax** checks a _change against a plan approved beforehand_: each phase
  declares its files, its gate runs, and the plan is reconciled file by file
  against the diff, with every deviation surfaced. The worktree and the
  provider's sandbox are the default.

So BMad Loop is closer to an **unattended sprint runner for a BMAD backlog**:
it works through stories, sets aside the one that does not converge and keeps
a ledger of what is left; phax is **verified delegation** of one approved
change, closer to a build system with CI-style gates for agent work.

## Where BMad Loop is ahead today

- It drives six agent CLIs (claude, codex, gemini, copilot, antigravity,
  opencode) and takes a new one as a TOML profile; phax drives three.
- Runs launched from its TUI are detached processes that survive the TUI's
  exit, and `bmad-loop attach` joins a live session; `phax run` holds the
  terminal.
- It has a TUI dashboard (runs, board, ledger, journal, policy editor); phax
  has no UI.
- One run works through a backlog and can defer a story that exhausts its
  attempts; a phax run executes one plan and stops at the phase whose gate
  stays red.
- It builds deferred work: `sweep` runs the buildable ledger entries through
  the same loop. phax records a deferred finding and stops there.
- A token budget can end a runaway session (`session_budget_mode =
  "enforce"`); phax measures and estimates cost, and enforces no budget.
- A review session can run before every story's commit; phax's automated
  compliance and code reviews run once per run, at review.
- It documents Windows through WSL and an experimental native backend; phax
  ships macOS and Linux binaries only.
- It is an official module of BMAD-METHOD (about 55,700 stars); phax is a
  single-maintainer project.

## When each fits

- **BMad Loop** if you already plan with BMAD-METHOD and want its sprint board
  built story by story while you are away, on the agent CLI of your choice,
  with your tests before each commit and a dashboard to watch it.
- **phax** if you want the change held to a plan you approved: isolation and a
  sandbox by default, files reconciled against the plan, findings with a fate,
  a pull request and records in Git — i.e., you trade agent breadth and backlog
  automation for a tighter contract per change.

## Two things worth noting

1. **They are composable one level up, not side by side.** BMad Loop and phax
   fill the same slot — the program that starts the agent and checks its work —
   so a given change goes through one or the other. BMAD-METHOD is the part
   that composes: its README says you can _"carry its briefs, specifications,
   and architecture into your existing delivery workflow"_, and a BMAD brief
   can be the source of a phax spec and plan. phax does not read a BMAD sprint
   board or story file.
2. **Relative to Spec Kit and OpenSpec** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md) and
   [`openspec-vs-phax.md`](./openspec-vs-phax.md)): BMAD-METHOD sits where
   they do — skills and artifacts driven from inside your agent. BMad Loop is
   a separate program that runs your own commands before each commit and never
   takes the model's word for "done": of the tools compared here, it is the
   nearest to phax.
