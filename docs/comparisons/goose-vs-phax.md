# Goose vs. phax

> A side-by-side comparison, last checked on 2026-11-25 against Goose v1.61.0
> (2026-11-25) — its README and the docs sources under `documentation/docs/` in
> [`aaif-goose/goose`](https://github.com/aaif-goose/goose) (formerly
> `block/goose`), published at [goose-docs.ai](https://goose-docs.ai), chiefly
> the [recipe reference](https://goose-docs.ai/docs/guides/recipes/recipe-reference)
> and the [subrecipes](https://goose-docs.ai/docs/guides/recipes/subrecipes)
> guide — and phax 0.43.0.

## The one-line difference

**Goose is a general-purpose agent: it is the program that reads your code and
changes it, and one of its recipes can carry shell checks that must exit 0,
with a bounded number of retries. phax is verified delegation: it is not an
agent, and it drives other vendors' agents (Claude Code, Codex, Mistral Vibe)
through a fixed sequence of gated phases.** The two are not the same kind of
tool, and phax does not drive Goose. The comparison that holds is narrower: a
recipe whose author declared checks, against a plan whose every phase must
pass the project's gate before it commits.

## What Goose is, concretely

You install the desktop app (macOS, Linux, Windows) or the CLI
(`brew install block-goose-cli`, or an install script), configure a model
provider and start a session. Its README: _"goose is a general-purpose agent
for coding, research, writing, automation, and data analysis."_ It connects
tools through MCP extensions, loads local models in-process or connects to
_"over 85 providers"_, and can be the agent behind another application over
the Agent Client Protocol (`goose acp`). It is _"part of the Agentic AI
Foundation (AAIF) at the Linux Foundation"_.

A [recipe](https://goose-docs.ai/docs/guides/recipes/recipe-reference) is a
YAML or JSON file — _"reusable goose configurations that package up
instructions and settings so the setup can be easily shared and launched by
others"_ — that you write by hand or fill in from the desktop app:

```bash
goose run --recipe recipe.yaml --params environment=production --params region=us-west-2
goose recipe validate my-recipe.yaml
```

Beside `instructions`, `prompt`, `parameters`, `extensions` and `settings`
(the provider and model for this recipe), three fields matter here:

- `retry` — _"enables recipes to automatically retry execution if success
  criteria are not met."_ Its `checks` are shell commands (_"currently only
  "shell" is supported"_) that _"must exit with code 0 for success"_, run after
  the agent finishes. If one fails and attempts remain, goose runs the
  optional `on_failure` command, clears the conversation (_"Reset the agent's
  message history to initial state"_) and starts again, up to `max_retries`.
- `response` — a `json_schema` with which a recipe can _"enforce a final
  structured JSON output"_.
- `sub_recipes` — _"goose generates a tool for each subrecipe"_, and the agent
  calls them; each runs _"in a separate session with its own context"_, with
  no nesting, and several can run in parallel across up to 10 workers.
  _"Subrecipes are an experimental feature in active development."_

`goose run` exits when the task is complete, can answer as `json` or
`stream-json`, and a recipe can run on a cron schedule (`goose schedule add`).
What the agent may do is set by a
[permission mode](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions):
_"`Autonomous Mode` is applied by default."_ Sessions are kept in a local
SQLite database. The recipe pages read describe no Git worktree, branch,
commit or pull request made by goose around a recipe run.

Goose is Apache-2.0 and free; you pay your model provider, or use a Claude Code
or Codex subscription through its
[ACP providers](https://goose-docs.ai/docs/guides/acp-providers). The
repository dates from 2024-08-23, has 56,970 stars and 6,666 forks, and
published four releases between 2026-11-17 and 2026-11-25.

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

| Axis                              | Goose                                                                                                                                                                 | phax                                                                                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What it is**                    | An AI agent (desktop app and CLI) with recipes: reusable, parameterised session set-ups                                                                               | A compiled CLI that drives another vendor's agent through a plan's phases                                                                                                                                          |
| **Runtime**                       | goose is the agent: its own model loop and tools; it can also front Claude Code, Codex or Amp as ACP providers                                                        | phax is the runtime around a vendor's agent CLI, which it spawns headlessly; it has no model loop of its own                                                                                                       |
| **Unit of work**                  | A recipe run: one session, which may call sub-recipes as tools                                                                                                        | A run of an approved plan: phases in order, each its own session, worktree and commit                                                                                                                              |
| **Sequencing**                    | The agent, following the recipe's instructions; it decides when to call a sub-recipe                                                                                  | Plain code: the plan's order, an explicit state machine                                                                                                                                                            |
| **Rigor**                         | Opt-in per recipe: `retry.checks` shell commands that _"must exit with code 0"_, `max_retries`; a failed attempt starts again with the message history reset          | **Mechanical** gate profile (your `pnpm test`/lint/build) after every phase of every plan; a red gate goes back to the same session                                                                                |
| **Git**                           | None described around a recipe run in the pages read; the agent can run Git like any other command                                                                    | Worktree per phase, chained phase branches, planned commit messages with run trailers, built-in `publish-pr`                                                                                                       |
| **Verification**                  | The declared shell checks, once the agent has finished; `response.json_schema` validates the shape of the final answer                                                | Plan↔diff **file reconciliation**, per-gate verified surfaces, acceptance tests judged by a provider you configure, compliance review, code review                                                                 |
| **Isolation/Safety**              | Permission modes (autonomous by default), per-tool permissions, prompt-injection detection, an adversary reviewer mode; sub-recipe isolation is of conversation state | The provider's own sandbox limits files to the worktree (an OS sandbox only with Codex), command allowlist, no MCP, protected paths; `isolated` mode is refused today                                              |
| **Model choice**                  | Per recipe (`settings.goose_provider`, `goose_model`); _"over 85 providers"_, local models in-process                                                                 | A versioned model catalog, model + effort per phase, provider priority and fallback, owner-set assignment bounds; three providers                                                                                  |
| **Parallelism**                   | Sub-recipes in parallel across up to 10 workers (experimental); subagents                                                                                             | None inside a run: phases run one after another. Separate runs can go side by side when `phax plans overlap` reports disjoint files                                                                                |
| **Scheduled and detached runs**   | Recipes on a cron schedule (`goose schedule add`)                                                                                                                     | Neither: `phax run` holds the calling shell until the run stops, and nothing starts a run on a schedule; `phax resume` continues a stopped run                                                                     |
| **Multi-plan work**               | Nothing in the pages read relates one recipe's files to another's                                                                                                     | `plans overlap` / `plans status` / `plans lint` / `adjust-plan`: parallel-safety, staleness, drift after a landed run                                                                                              |
| **Artifact lifecycle**            | Recipes are files you share (deeplinks, a GitHub recipe repository); `goose recipe validate`; no approval status                                                      | Draft → Approved → Stale → Completed/Abandoned (`phax artifact`), auto-committed, approvals recorded against a baseline and a named approver                                                                       |
| **Authoring**                     | Write the YAML or JSON file, or fill in the recipe form of the desktop app                                                                                            | Spec and plan written inside your agent with the `phax-spec`/`phax-planning` skills, or headlessly (experimental); `plans lint` with no model                                                                      |
| **Agents**                        | Itself; or ACP agents (Claude Code, Codex, Amp) used as providers                                                                                                     | Claude Code (default), Codex, Mistral Vibe                                                                                                                                                                         |
| **Records**                       | Sessions in a local SQLite database, exportable as JSON or Markdown                                                                                                   | Per-phase commits, plus a `phax/records/v1` Git branch (opt-in): manifest, gate results, reconciliation, diff, handoff, optional transcript                                                                        |
| **Findings**                      | No finding ids or fates in the pages read                                                                                                                             | phax numbers each review finding; each ends fixed by a commit, dismissed with a reason or deferred, on the record                                                                                                  |
| **Cost**                          | Desktop cost tracking: an estimated session cost from public prices, by model                                                                                         | A cost ledger per run (Claude Code invocations only); `phax plans estimate` before a run, from this machine's past runs                                                                                            |
| **Interface for an agent caller** | `goose run --output-format json` or `stream-json`; the recipe's own `response.json_schema`; an ACP server (`goose acp`)                                               | `--json` on every command with a published schema, `--json-schema` contracts, documented exit codes; no server, no event stream                                                                                    |
| **Hosted**                        | None in the pages read — a local app and CLI                                                                                                                          | None — local only; state under `~/.phax/`                                                                                                                                                                          |
| **Footprint**                     | Desktop app and CLI on macOS, Linux and Windows; Apache-2.0; a Linux Foundation (AAIF) project; anonymous usage data only if you opt in                               | npm launcher that downloads a binary; local only; three providers (Claude Code by default; Codex and Mistral Vibe once enabled); macOS and Linux; GitHub for pull requests; Apache-2.0; single maintainer, pre-1.0 |

## The key distinction

Both can make a shell command's exit code, not the model's word, decide
whether work is done. The difference is **what the check is attached to, and
who sequences the work**:

- **Goose** attaches the check to a recipe, when its author writes a `retry`
  block; a recipe without one has no check. The checks run once the agent has
  finished, and a failure starts the recipe again from a clean history, up to
  `max_retries`. Inside the run the agent sequences itself, including which
  sub-recipe to call and when.
- **phax** attaches the check to the project: the gate profile in `phax.json`
  runs after every phase of every plan, and its failure goes back to the same
  session, which fixes its own work. The order is the plan's, held by code;
  each phase has its own worktree, and the files it changed are reconciled
  with the files it planned.

So Goose is closer to a **general agent with reusable task definitions that
can carry their own pass conditions**; phax is not an agent but **verified
delegation**: the fixed, gated sequence that other vendors' agents are driven
through.

## Where Goose is ahead today

- It is the agent: one install brings the model loop, the tools and the
  recipes. phax needs a vendor's agent CLI on your `$PATH`.
- Model breadth: _"over 85 providers"_ and local models loaded in-process;
  phax drives three vendor CLIs.
- Tools through MCP extensions; a phax run in its default mode has no MCP.
- A desktop app, and Windows support; phax is a CLI for macOS and Linux.
- One file is enough: a recipe runs with one command, on any task (research,
  writing, data analysis). phax runs changes to a Git repository, from an
  approved plan.
- Parallel sub-recipes (up to 10 workers, experimental) and subagents; phax
  runs phases one after another.
- Recipes on a cron schedule (`goose schedule add`); nothing starts a phax run
  on a schedule.
- An ACP server (`goose acp`), so another application can use goose as its
  agent; phax has no server.
- Adoption and governance: 56,970 GitHub stars and 6,666 forks on 2026-11-25,
  under the Linux Foundation's AAIF; phax is a single-maintainer project.

## When each fits

- **Goose** if you want one agent for many kinds of work, on the model of your
  choice, with MCP tools and a desktop app, and reusable recipes — some of
  which you close with shell checks and a retry bound.
- **phax** if the work is a code change you want to hand to Claude Code, Codex
  or Mistral Vibe and get back checked: every phase behind your project's gate
  in its own worktree, files reconciled against the plan, findings with a
  fate, the history in Git. You trade the agent's breadth, its tools and its
  parallelism for that.

## Two things worth noting

1. **They are composable, in one direction.** phax is built to be called by an
   agent as well as by a person: every command answers JSON, and
   [Delegating from an agent](../delegating.md) lists the sequence. Goose runs
   shell commands, so a Goose session can hand a code change to phax and read
   the outcome, the compliance verdict and each finding's fate. The reverse
   does not exist: phax cannot run Goose as the agent of a phase. This pairing
   has not been tried for this page.
2. **Relative to Spec Kit and OpenSpec** (see
   [`spec-kit-vs-phax.md`](./spec-kit-vs-phax.md) and
   [`openspec-vs-phax.md`](./openspec-vs-phax.md)): those are spec layers that
   run inside an agent, the kind of program Goose is. A recipe is not a spec: it
   packages a session's instructions, tools and settings, where a spec states
   what to build. Its `retry` checks are nearest to the `shell` steps of a
   Spec Kit workflow: a command the author adds.
