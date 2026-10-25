# phax

phax runs a plan through AI coding agents — Claude Code, OpenAI Codex or Mistral Vibe — as a sequence of **gated phases**, and hands you a change you can review.

**Documentation:** [docs.phax.run](https://docs.phax.run) · **npm:** [`@lbdremy/phax`](https://www.npmjs.com/package/@lbdremy/phax)

You write what to build (a **spec**) and how, phase by phase (a **plan**). phax runs each phase in its own Git worktree with the agent you pick, and the phase must pass your project's gates (typecheck, tests, lint…) before the next one starts. Everything around the agent is plain code: sequencing, gates, retries, state. The agent is the only non-deterministic part.

Every phase declares the files it means to create and edit, so phax can tell you what actually happened: planned but not done, done but not planned, deleted, renamed. The agent has to justify each deviation in its handoff. You review a change that is already framed, phase by phase, instead of a pull request full of touched files.

```
spec ──approve──▶ plan ──lint, approve──▶ run: phase-01 ─gate─▶ phase-02 ─gate─▶ … ─gate─▶ review ──▶ pull request
```

**How phax compares.** Spec-driven tools such as GitHub Spec Kit and OpenSpec share the spec → plan → implement idea and work with dozens of agents, but by default what checks the code there is a person's review or a model's judgment. phax is the runtime instead: it starts the agent itself, runs each phase in an isolated worktree, moves on only when your real checks exit green, and reconciles the plan file by file against the diff. It trades breadth of agents for that enforcement. The comparisons go axis by axis: [GitHub Spec Kit vs. phax](docs/comparisons/spec-kit-vs-phax.md) and [OpenSpec vs. phax](docs/comparisons/openspec-vs-phax.md).

## Quickstart

Install phax and its skills, then set up your repository:

```bash
npm install -g @lbdremy/phax
cd my-project
phax init                               # writes phax.json: project name, gate commands
phax skills install --target claude     # phax-spec, phax-planning, phax-cli and the decide skills, for your agent
```

Write a spec, then a plan, and approve each. `artifact new` creates the file with its name and status; you fill it in with your agent, which follows the `phax-spec` and `phax-planning` skills:

```bash
phax artifact new spec greet            # docs/specs/2610041200-greet.md, Draft
phax artifact approve docs/specs/2610041200-greet.md

phax artifact new plan greet --spec docs/specs/2610041200-greet.md --last
phax plans lint docs/plans/2610041201-greet-plan.md
phax artifact approve docs/plans/2610041201-greet-plan.md
```

Or let phax drive each authoring session from a short brief, and get a committed draft back — the spec, then the plan written from it:

```bash
phax artifact new spec greet --headless --brief spec-brief.md
phax artifact new plan greet --headless --brief plan-brief.md --spec docs/specs/2610041200-greet.md --last
```

Run the plan. Each phase runs, passes its gates and commits; the last one stays open for you:

```bash
phax run --plan docs/plans/2610041201-greet-plan.md
# Run: my-project.greet
# Run "my-project.greet" reached review — 3 phase(s) complete.
```

Review it, open the pull request, and put the run away once it is merged:

```bash
phax review-code greet                  # an agent session primed to review the change with you
phax publish-pr greet                   # push the final branch, open the pull request
phax archive greet                      # after the merge
```

## Install

**With npm** (recommended). The package is a small launcher that downloads the binary for your platform on first run and caches it per version under `~/.phax/bin/<version>/`:

```bash
npm install -g @lbdremy/phax
# or without installing:
npx @lbdremy/phax --help
```

**As a binary.** Download it with its checksum from [GitHub Releases](https://github.com/lbdremy/phax/releases). Targets: `phax-darwin-arm64`, `phax-darwin-x64`, `phax-linux-x64`, `phax-linux-arm64`.

```bash
curl -LO https://github.com/lbdremy/phax/releases/latest/download/phax-darwin-arm64
curl -LO https://github.com/lbdremy/phax/releases/latest/download/phax-darwin-arm64.sha256
sha256sum --check phax-darwin-arm64.sha256
chmod +x phax-darwin-arm64 && sudo mv phax-darwin-arm64 /usr/local/bin/phax
xattr -dr com.apple.quarantine /usr/local/bin/phax   # macOS: the binary is not notarized yet
```

**Upgrading.** See [Upgrading phax](docs/upgrading.md) for what to run after an upgrade, release by release.

**An agent.** phax drives an agent CLI that must be on your `$PATH`: `claude` (Claude Code), and optionally `codex` (OpenAI Codex) or `vibe` (Mistral Vibe). Keep `claude` installed even if you prefer another provider: phax falls back to it when the preferred one is missing or cannot meet the run's security mode.

**The skills.** phax ships the skills your agent uses to write its documents: `phax-spec`, `phax-planning` and `phax-cli`; `phax-review`, which `phax review-code` follows; and the three doctrine skills `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review`. `phax artifact decide` follows the first two when it decides a spec's or plan's open questions.

```bash
phax skills install --target claude                 # or codex, or agent
phax skills install --target claude --scope user    # for every project, not just this one
```

**Shell completions** (optional). They need the [`usage` CLI](https://usage.jdx.dev/cli/), both to generate the script and at Tab time. Run names complete live from your registry.

```bash
brew install usage
source <(phax completions bash)                                   # bash
phax completions zsh > "${fpath[1]}/_phax"                        # zsh
phax completions fish > ~/.config/fish/completions/phax.fish      # fish
phax completions nu | save --force ~/.config/nushell/completions/phax.nu   # nushell
phax completions powershell >> $PROFILE                           # powershell
```

If zsh has no completions directory on its `$fpath` yet, create one once:

```zsh
mkdir -p ~/.zsh/completions
phax completions zsh > ~/.zsh/completions/_phax
cat >> ~/.zshrc <<'RC'
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
RC
exec zsh
```

## Concepts

**Spec and plan.** A spec says what to build and why: requirements, acceptance criteria, and the questions still open. A plan says how: an ordered list of phases, each with its instructions, the files it will create and edit, the gate it must pass and its commit message. Both are Markdown files with a status in their frontmatter, under `docs/specs/` and `docs/plans/`. phax calls them **artifacts**.

**Lifecycle.** An artifact moves through statuses: `Draft` → `Approved` → `Completed`, or `Abandoned` if the work is dropped. A plan can also be marked `Stale` when the ground it was approved on has changed (`phax plans status` tells you). `phax artifact` makes every transition and commits it; an approval records what the artifact was approved against, so phax can tell later whether it still holds. A run completes its plan on the run's own branch, and its spec only when the plan says it is the spec's last (`completes-spec: true`) and no other live plan still needs it, so the merge lands the code and the completion together.

**Run and phase.** `phax run` turns an approved plan into a **run**, named from the plan's title as `<namespace>.<name>`, where the namespace is your project's `name` in `phax.json`. Each **phase** runs in its own Git worktree on its own branch, `phax/<name>--phase-NN`, branched from the previous phase, so the last phase's branch carries the whole change. A phase's prompt carries the plan's preamble, its own section, and an outline of every phase (id, title, planned files to create and edit); the full plan is at `.phax-context/plan.md` in its worktree.

**Gate.** Your project's checks, declared once in `phax.json` as a gate profile. A step runs at every phase (`every-phase`) or only at the last one (`terminal`), and records what it verifies (`local`, `structural` or `product`). When a gate fails, the same agent session gets the failure and tries to fix it before the phase gives up.

**Handoff and reconciliation.** After its gate passes, each phase writes a handoff for the next one: what it did, what it decided, what is left. phax compares the files the phase actually changed with the files it planned, and every gap goes into the next phase's prompt and into the final review.

**Review.** The last phase does not land anything. The run stops at `review_open`, with a review handoff, an optional compliance review of the work against the plan, and optionally a pull request. You take it from there.

**Records.** If you turn them on (`phax records init`), every phase leaves a record on the `phax/records/v1` branch — its manifest, gate results, reconciliation, diff, handoff and, optionally, the agent's transcript — so a run's history outlives its worktrees.

**State.** phax keeps its own state outside your repository, under `~/.phax/`: the registry of runs, each run's folder, the worktrees, the locks. Your repository only holds the artifacts, and the records branch if you use one.

## Set up a project

`phax init` writes `phax.json` at the root of your repository, with the JSON Schemas your editor uses to check it (`phax.schema.json`, `phax.user.schema.json`). In a terminal it asks a few questions, pre-filled from your `package.json`: the project's name, its gate commands, whether to review and publish runs automatically. Elsewhere it takes the detected defaults.

```bash
phax init            # asks, or takes the defaults when there is no terminal
phax init --yes      # takes the defaults
phax init --force    # reconfigures an existing phax.json
```

A `phax.json` looks like this:

```json
{
  "$schema": "./phax.schema.json",
  "version": 1,
  "name": "my-project",
  "commands": { "setup": ["pnpm install"] },
  "gateProfiles": {
    "standard": [
      { "command": "pnpm typecheck", "surface": "local", "firing": "every-phase" },
      { "command": "pnpm test", "surface": "local", "firing": "every-phase" },
      { "command": "pnpm lint", "surface": "structural", "firing": "every-phase" },
      { "command": "pnpm build", "surface": "product", "firing": "terminal" }
    ]
  },
  "review": { "compliance": { "enabled": true } },
  "publish": { "auto": true, "remote": "origin", "baseBranch": "main" }
}
```

- **`name`** is the namespace of your runs: a run is `<name>.<run name>`.
- **`commands.setup`** runs in each phase's fresh worktree before the agent starts; **`commands.cleanup`** runs in it once the phase has committed, to free space (`node_modules`, build output).
- **`gateProfiles`** holds your checks. Each step has a `command`, a `firing` (`every-phase`, or `terminal` for the last phase only) and a `surface` that says what it verifies (`local`, `structural` or `product`). phax records each step's surface and result, and the run's summary lists the surfaces it verified. A step can also return structured findings instead of a log — see [Extend phax](#extend-phax). An optional `input` key, `"gate-request"` (the only value), has phax write the phase's facts on the step's stdin — see [Gate request](#gate-request).
- **`review.compliance`** and **`publish`** run a compliance review and open a pull request when a run reaches review — see [Review and land](#review-and-land). `review.code` sets the model for `phax review-code`, and `authoring.spec` and `authoring.plan` the model for headless authoring.
- **`security.profile`** sets the default security mode (`secure` unless you say otherwise) — see [Providers and security](#providers-and-security).
- **`agent.maxFixAttempts`** is how many times a failing gate goes back to the agent (1 by default).
- **`fileReconciliation.mode`** is `report_only` (default) or `warn`, to also log each deviation from the planned files.
- **`records`** is written by `phax records init` — see [Records](#records).

**Layers.** `phax.json` is the team's baseline. Two more files can add to it: `~/.phax/config.json` for your machine, and `phax.local.json` (gitignored) for you in this repository. A scalar takes the most personal value. An allowlist (`security.filesystem.allowRead|allowWrite`, `security.agentCommands`, `security.mcp.allow`) is the union of all layers, so a personal layer can add to the project's security baseline but never remove from it. Gate profiles merge by name.

**Check and upgrade.**

```bash
phax validate                          # check phax.json and its layers, no side effects
phax validate --plan phax-plan.json    # and an extracted plan
phax schema upgrade                    # after upgrading phax: regenerate the editor schemas
```

## Specs and plans

### Create them

```bash
phax artifact new spec <slug>                     # docs/specs/<YYMMDDHHMM>-<slug>.md
phax artifact new plan <slug> --spec <spec path> --last  # docs/plans/<YYMMDDHHMM>-<slug>-plan.md
```

phax names the file from the current UTC minute and the slug, with a `Draft` status, and refuses any other name (exit 12). A plan carries its spec's slug and names it as its `source-spec`; `--spec` can be left out when a plan has no spec. With `--spec`, say whether the plan is the spec's last: `--last` or `--not-last` (see below). Fill the file in with your agent: the `phax-spec` and `phax-planning` skills hold the formats, and point at the right sections — requirements and acceptance criteria for a spec; for each plan phase, its instructions, the files it creates and edits, its gate and its commit. [`examples/hello-world/plan.md`](examples/hello-world/plan.md) is a small worked plan.

**One spec, several plans.** `--last` writes `completes-spec: true`, so the plan's run completes the spec; `--not-last` writes `completes-spec: false`, so the run leaves the spec live. Every plan of a spec except the last says `--not-last`. Splitting a spec across three plans:

```bash
phax artifact new plan greet-core --spec docs/specs/2610041200-greet.md --not-last   # plan 1 of 3
phax artifact new plan greet-cli  --spec docs/specs/2610041200-greet.md --not-last   # plan 2 of 3
phax artifact new plan greet-docs --spec docs/specs/2610041200-greet.md --last       # plan 3 of 3
```

Plan 1's frontmatter reads:

```markdown
---
status: Draft
source-spec: docs/specs/2610041200-greet.md
completes-spec: false
---
```

### Let phax write them

With `--headless`, phax runs the authoring session itself from a brief: it gives the agent the skill and the document's JSON Schema, accepts a valid document as the session's only output, renders it to Markdown, keeps the document as a `.json` sidecar beside it, and commits both. A plan written this way is already extracted, so `phax run` never extracts it again. A plan document's test strategy is a list of test lines, one per guarantee, each on four coordinates and an optional criterion id.

```bash
phax artifact new spec greet --headless --brief brief.md
phax artifact new plan greet --headless --brief brief.md --spec docs/specs/2610041200-greet.md --last
cat brief.md | phax artifact new spec greet --headless --brief -
```

```
authoring spec greet — claude-opus-5-5 / high
created docs/specs/2610041200-greet.md (Draft, headless)
sidecar docs/specs/2610041200-greet.json
commit a1b2c3d — docs(specs): draft greet
record authoring/2610041200-greet
```

`--model` and `--effort` choose the model, before `authoring.spec|plan` in `phax.json` and the catalog's default. The last line names the session's [record](#records). It exits 5 when the session's output is not a valid document, 8 on a provider rate or usage limit, and 12 when the slug, the brief or `--spec` is wrong.

A refused document, one that is not JSON or that the document's schema refuses, gets one retry: phax resumes the same session once, says what was refused, and asks for the whole document again. A warning names the refusal before the retry runs:

```
spec document refused — acceptanceCriteria[0].refs: is missing
  resuming the session once to ask for the whole document again
```

A not-JSON refusal names the parser's error and the position where parsing failed. If the retry's document is refused too, the authoring fails with exit 5, naming both refusals, and nothing is written. Rate and usage limits, provider errors and a failed commit are never retried. The record's `retry` field says whether a retry ran (`none` or `retried`), and the record keeps the retry's prompt and transcript beside the first answer's. `phax artifact schema spec|plan` prints the document's JSON Schema. Headless authoring is experimental: the two document formats may still change.

If you edit the Markdown of a headless document, edit its sidecar too: `phax artifact status` tells you whether the body is still the sidecar's rendering, and approving a document whose body has diverged is refused.

### Check a plan

```bash
phax plans lint docs/plans/2610041201-greet-plan.md
phax plans overview <plan>   # its phases, planned files by architecture part, test lines and criterion coverage
phax plans estimate <plan>   # its API-list cost, and whether it fits your subscription windows now
```

A read-only check, with no model: the plan's structure, its planned files against the working tree and against earlier phases, the commands it needs against `phax.json`, each phase's model and effort against the catalog, each phase's declaration lines (an interactive phase must not be the first or the last phase, must not directly follow another interactive phase and plans no file to create or edit; an oracle phase runs with a configured `oracles` provider and is refused without one, and a `**Model reason:**` line is an error: the label is `**Assignment reason:**`), each phase's test lines (a line off the format, an oracle-loop line off an oracle phase, an oracle phase with none, and an unknown criterion id are errors; an uncovered criterion of the source spec is a warning), and the findings of your [plan auditor](#extend-phax) if you have one. It exits 1 on any error; the warnings never fail it.

`plans overview` lays the plan out phase by phase: model, effort and mode, the oracle pair, the planned files under the architecture's parts, the test lines, and which acceptance criteria of the source spec have a test. No model reads the plan, and nothing is written. See [Reading a plan's overview](docs/plan-overview.md).

`plans estimate` gives each phase's and the run's cost as P10/P50/P90, calibrated from this machine's cost ledgers, and says whether the plan fits the Claude subscription windows left right now. See [Estimating a plan](docs/plan-estimate.md).

The structure check also reports a phase missing from the phase numbering, for example a plan with phase-01 and phase-03 but no `## phase-02` heading:

```text
docs/plans/2610161201-greet-plan.md: 1 error, 0 warnings
error    structure  phase-02  no section for phase-02 in plan.md (expected a "## phase-02 — …" heading)
```

`phax run` and `phax resume` refuse a plan with a phase whose section they cannot find in plan.md. They look for the phase's `## phase-NN` heading or its `{#anchor}`. `phax run` refuses before the run is named; both exit 11 and name the phase and `phax plans lint`.

### Decide open questions

A spec or a plan can leave questions open, each with options, the loss each abandons, and a recommendation. `phax artifact decide` answers them with you, in an interactive Claude Code session:

```bash
phax artifact decide <path>                                  # framing F1–F5, then each open question
phax artifact decide <path> --question Q1                    # one question alone, open or arbitrated
phax artifact decide <path> --doctrine docs/doctrine.md      # add project rules after the skill
phax artifact decide <path> --model claude-sonnet-5-5 --effort medium
```

The agent raises five framing questions first, then presents the questions, and you decide. When you exit, phax asks the session for the revised document, checks it, shows the body diff and writes only what you accept: the artifact and its sidecar, committed together. `--question` re-arbitrates one question and keeps its previous verdict in its history; reopen an Approved artifact first. The session follows `phax-decide-spec` or `phax-decide-plan`; a copy in `.claude/skills/` replaces the bundled one, and `--doctrine` appends a file after it. decide needs a terminal and a Draft artifact, runs on Claude Code only (default `claude-opus-5-5` at `high`), and is refused inside a phase worktree. Every session leaves a decision record when records are on. [Deciding open questions](docs/arbitration.md) covers the flow.

**The approval lock.** `phax artifact approve` refuses, with exit 12, while a spec or plan has an open question, and names `phax artifact decide`. Hand-authored artifacts are locked too, and an artifact with no question section is approved as before.

### Move them through their lifecycle

| Command                                         | From                                                           | To                                            |
| ----------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `phax artifact approve [--by <arbiter>] <path>` | `Draft`; `Stale` (plan); `Approved` again to record a revision | `Approved`                                    |
| `phax artifact stale <path>`                    | `Approved` (plan)                                              | `Stale`                                       |
| `phax artifact reopen [--by <arbiter>] <path>`  | `Approved`; `Stale` (plan)                                     | `Draft`                                       |
| `phax artifact complete <path>`                 | `Approved`; `Stale` (plan)                                     | `Completed`                                   |
| `phax artifact abandon <path>`                  | `Draft`, `Approved`; `Stale` (plan)                            | `Abandoned`                                   |
| `phax artifact status <path>`                   | any                                                            | — prints the status and the legal transitions |

Each transition rewrites the status in the file's frontmatter and commits it on its own, and refuses when the files it writes have uncommitted changes. `Completed` and `Abandoned` move the file, and its sidecar, into the folder's `archive/`. Approving writes the artifact's own approval record file, `docs/specs/approvals/<spec>.json` or `docs/plans/approvals/<plan>.json`, with the commit it was made against; the record's `approvedBy` names the approver, `--by operator` (the committing git name: `GIT_COMMITTER_NAME`, else `user.name`) or `--by machine:<grant>`, and approve and reopen refuse with exit 12 without a terminal unless `--by` is given; completing or abandoning an artifact, or reopening one, deletes that file in the same commit (a reopen commit also carries a `Reopened-By:` trailer, and reopening a spec names its bound plans and leaves them unchanged), and no transition touches another artifact's record; approving a plan is refused while its spec's approval is missing or the spec has changed since. A run completes its own plan, and its spec only when the plan says it is the spec's last (`completes-spec: true`) and no other live plan still needs it, on the run's branch.

`phax artifact migrate-documents` lifts the headless sidecars written in an older shape and re-renders their bodies, once, after an upgrade; `approve`, `reopen` and `decide` refuse until it has run. A spec sidecar stamped below 0.27.0, or written before `$schema`, is lifted with a summary placeholder on every surface element when phax reads it, and `migrate-documents` restamps it; `approve` and `complete` refuse a spec still holding a placeholder. A plan sidecar stamped 0.26.0 or below has each phase's test strategy string read as test lines: `migrate-documents` lifts one whose every line follows the line format and refuses one holding prose, naming the phase and the line. See [Troubleshooting](#troubleshooting).

### Keep several plans in step

```bash
phax plans status                          # every Approved plan: fresh, or stale and why
phax plans status --apply                  # mark the stale ones Stale
phax plans overlap <plan> <plan>...        # which plans can run side by side without conflicts
phax plans overlap --landed <run> <plan>   # which plans a landed run's real diff touches
phax adjust-plan <plan> --landed <run>     # an agent session that updates a plan to what landed
```

`plans status` compares each plan with what its approval was made against: `spec-changed` when its spec changed, `self-changed` when the plan did, `ground-changed` when files it plans to touch changed since, `missing-record` when there is nothing to compare with. It reports and exits 0; `--apply` makes the change. `plans overlap` compares the files plans declare (file by file, not line by line); with `--landed`, it uses the files a finished run actually changed — run it before you archive that run. `adjust-plan` asks before it edits and commits anything.

## Run a plan

```bash
phax run --plan docs/plans/2610041201-greet-plan.md
phax run greet --plan <plan>          # choose the run's name
phax run --plan <plan> --dry-run      # show what would run, change nothing
```

| Flag                        | Effect                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `--allow-dirty`             | run from a working tree with uncommitted changes             |
| `--security <mode>`         | override the security mode for this run                      |
| `--provider-priority <a,b>` | override which providers to prefer, for this run             |
| `--allow-skill-edits`       | let phases edit the `.claude/skills` files the plan declares |
| `--refresh`                 | extract the plan again instead of using the cache            |

Before naming the run, phax checks everything it can without it: the commands the plan needs, each phase's model, the MCP and records settings, a clean working tree. A refused run leaves nothing behind, and trying again gets the same name.

Then, for each phase:

1. A worktree under `~/.phax/worktrees/`, on the branch `phax/<name>--phase-NN`, branched from the previous phase.
2. `commands.setup` runs in it.
3. The agent gets the phase's instructions, the previous phase's handoff and how that phase deviated from its plan.
4. The gate runs; on failure, the same agent session gets the failure and tries again, up to `agent.maxFixAttempts`.
5. The agent writes the phase's handoff.
6. phax commits with the planned message, then compares the files changed with the files planned (`file-reconciliation.json` in the phase's folder).

A phase that changes nothing stops the run (exit 9). The last phase runs the gate's `terminal` steps too, then the run stops at `review_open`. Its plan is completed on the run's branch, and its spec too when the plan says it is the spec's last (`completes-spec: true`) and no other live plan still needs it. The run's folder is `~/.phax/runs/<namespace>.<name>/`; when the run ends, phax prints what happened and the next command to run. On a Mac, keep it awake for long runs: `caffeinate -ims phax run --plan <plan>`.

### When a run stops

```bash
phax resume <run>                     # continue from the next phase, or finish a committed phase's cut-short handoff
phax resume <run> --yes --provider-priority codex-cli,claude-code
phax reset-phase <run> [phase-id]     # throw a stuck phase's worktree away so resume starts it over
phax enter-phase <run> <phase-id>     # open that phase's agent session
phax session-info <run>               # state, phase, worktree, agent session id
phax unlock <run>                     # remove a stale lock left by a process that died
```

`resume` never re-runs a committed phase's work; it only runs that phase's handoff turn again when the turn was cut short. A run stopped by a provider rate or usage limit (exit 8), by a phase with no changes (exit 9) or at an interactive phase (exit 13, see [Interactive phases](#interactive-phases)) is meant to be resumed. A run already at review is not resumed: use `phax enter`.

A phase that committed but whose handoff turn was cut short (a rate or usage limit) gets its handoff written first: `phax resume` runs the handoff turn again in that phase's session and worktree, then goes on. When that worktree is gone, resume refuses with exit 1 and names the commands that restore it, `git worktree prune` then `git worktree add <worktree> <phase branch>` (git keeps a deleted worktree registered until it is pruned); when the session id is gone, it names the `phase-handoff.md` file to write by hand. After a handoff written by hand, the next `phax resume` finishes that phase without an agent turn: it collects the phase's pulled briefs, writes its record and runs its cleanup, then goes on to the next phase. When that phase's worktree is gone as well, its cleanup commands do not run and the phase is still cleaned up; phax warns and names them, so run them yourself if they free resources outside the worktree. The final message counts every phase of the run that committed, across resumes.

Without `--yes`, `phax reset-phase` previews the reset, and it applies the same refusals of the run's state as `--yes`, with the same message and exit 1. (Only `--yes` takes the run lock, so a held lock is refused there alone, with its own exit code.)

### Interactive phases

A plan can ask for a person to review the work after a phase, before the phases that repeat its pattern begin. Say so on the phase, after its model, effort and assignment-reason lines:

```markdown
## phase-02 — Invoice export, the first exporter {#phase-02-invoice-export}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Mode:** interactive
```

Declare one directly after the first phase that sets a pattern, never by default. It plans no file to create or edit: its optional files name what the person may touch, and its instructions name what to review. It is never the first or the last phase, and never directly follows another interactive phase. One may sit between the two phases of an [oracle pair](docs/oracle-phases.md), and takes no oracle role.

When `phax run` reaches the phase, it sets up the worktree as for any phase, writes a seed into `.phax-context/` (the phase's instructions, the handoffs so far and the plan's later phases) and runs one read-only first turn: the agent reads the work and reports the pattern it found. Then the run stops with the state `awaiting_review`, writes `review-stop.json` in the run folder and exits 13. It does not wait for input, so the person can leave and come back. The output names the worktree, the first reading and a command that continues the agent session phax started (or starts a fresh one when there is none to continue):

```bash
cd ~/.phax/worktrees/phax.invoice-export/phase-02 && claude --resume 6f1c… --permission-mode acceptEdits …
```

The command carries the phase's filesystem, network and MCP posture, but a step outside it asks you first. The first time codex opens the worktree, it asks you to trust the directory, then to review its hooks. You can also work by hand, in any editor, or with any other agent.

```bash
phax ls --awaiting-review                # the runs waiting for a person, with the stopped phase
phax session-info invoice-export         # the stop's worktree, seed and current session
phax enter-phase invoice-export phase-02 # continue the session, or start a fresh one
phax enter-phase --new-session invoice-export phase-02   # a new read-only first turn; its session becomes current
phax path invoice-export                 # phax shell and phax open take the same worktree
```

`phax path`, `phax shell` and `phax open` target the stopped phase's worktree. While the stop's close is running, `enter-phase` refuses the phase until the close ends.

To close the stop, run `phax resume invoice-export` from the main checkout. phax:

1. runs the phase's gate first. A red gate returns the phase to you (exit 4): fix the worktree, resume again;
2. takes the handoff: your `.phax-context/correction-handoff.md` when it exists, with the sections `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know` (one guard per correction); otherwise a read-only closing turn writes it from the diff of your corrections. A closing turn that edits the worktree is refused (exit 5): its edits are set aside in the phase's `refused-turn-NN/` folder and the worktree put back to the tree the gate passed. An answer still invalid after one corrective resume is refused too (exit 5);
3. commits exactly the gated tree, with an `Interactive-Phase: <phase-id>` trailer and no model or session trailers, because no agent session wrote it. A review that changed nothing commits an empty commit;
4. continues with the next phase, whose prompt carries your correction under `## Review corrections`, after the previous phase's handoff.

Leave your corrections uncommitted: phax commits the gated tree itself. A commit you make in the stopped worktree is refused (exit 1) with the `git -C <worktree> reset --soft <base>` that keeps its changes uncommitted; phax never rewrites the history itself.

A refused close puts the run back to `awaiting_review`; so does an interrupt during the close. `phax reset-phase` at a stop discards the phase's worktree so that `phax resume` runs it again, first turn included. `phax archive --force` archives the run. `phax adjust-plan --landed` is refused until the run lands.

A user interface reads `review-stop.json` for the stopped phase, its worktree, the current session, the last refused close and the commands above, each as `{ cwd, argv, env }`; its format is under [Persisted formats](#persisted-formats).

#### Holding a run

A plan declares a stop for a review it always wants. When you want one only on this run, hold it:

```bash
phax run --plan plan.md --hold                       # every headless phase but the final one
phax run --plan plan.md --hold phase-02,phase-04     # the phases listed
phax run --plan plan.md --hold oracle                # the oracle phases
```

Prefer a declaration for the review the plan is built around, directly after the phase that sets a pattern. Prefer `--hold` for a look you decide on at run time: a risky phase, a first run of a new plan, or the oracles of a pair. The selection is fixed for the run and recorded with it: `phax resume` takes no `--hold`, and no configuration key sets one. A bare `--hold` takes the next word as its value, so put the run's name before it or write `--hold=<selection>`. A malformed value exits 1; a selection the plan cannot honour (an unknown, interactive or final phase) exits 11 with `Hold preflight failed`. The final phase never holds, because it is already kept open for review. `phax run --dry-run` prints the resolved hold as `Hold: none` or `Hold: listed — phase-02, phase-04`.

For example, `phax run --plan plan.md --hold phase-02` on the invoice-export plan runs phase-02 like any phase: its agent works, its gate passes, it commits and its handoff is validated. Then, before its record and its cleanup, and with no agent turn, the run stops in `awaiting_review (held)`, writes `review-stop.json` and exits 13. It does not wait for input.

You review the phase by hand, with any agent, or by continuing the builder's own session, which is the default of `phax enter-phase invoice-export phase-02`. `phax enter-phase --new-session` starts a fresh read-only look instead and makes its session current. `phax ls`, `phax session-info`, `phax path`, `phax shell` and `phax open` work as at a declared stop; `session-info` names the phase `headless, committed <short sha>`.

`phax resume invoice-export` closes a held stop. phax:

1. runs the phase's gate first; a red gate returns the phase to you (exit 4);
2. takes the correction handoff: your `.phax-context/correction-handoff.md`, or a closing turn that resumes the builder session and writes it from the diff of your corrections. The handoff lands beside the phase's own `phase-handoff.md`, which stays as the builder wrote it;
3. leaves one review commit on top of the unchanged phase commit, with a `Held-Phase: <phase-id>` trailer and you as author, or no commit when nothing changed;
4. writes the phase's record once, runs its cleanup and starts the next phase from the branch tip in the same invocation. The next prompts carry your corrections under `## Review corrections`, after the held phase's own handoff.

Leave your corrections uncommitted. A commit of your own in the stopped worktree is refused (exit 1) with `git -C <worktree> reset --soft <phase commit>`, which keeps its changes uncommitted. `phax reset-phase` at a held stop discards the phase commit and the phase's worktree; the phase runs again and is held again when it commits.

The closing turn resumes the builder read-only, on every provider: Claude Code with its reading tools and no shell, codex with `exec resume` under `sandbox_mode=read-only` and `approval_policy=never`. On codex, the read-only override is the provider's to honour: codex merges a rollout's persisted permissions on resume, so a builder that ran with `workspace-write` may keep it. phax compares the worktree after every turn, but cannot see a write outside it. mistral-vibe keeps the phase's own posture.

The phase's record is written at closing, once. It names the builder's provider, model, effort and session, the phase commit as its source, and the review commit as part of the stop. Its usage is the builder's, read when the run stopped, so it leaves out the closing turn on every provider. See [The record of a stop](#the-record-of-a-stop). A resume finishes a hold or a close that was interrupted: a held phase that committed but did not stop stops then, and a close that landed but did not clean up runs its cleanup, writing the record only if the phase has none.

#### Reviews inside an oracle pair

A stop, held or declared, may sit between the two phases of an [oracle pair](docs/oracle-phases.md#reviewing-oracles-before-the-discharge), and `--hold oracle` is how you review the oracles before their discharge. When your corrections change an oracle file, the close runs the oracles provider's `authored` verdict again as the last step of its gate. The discharge then judges the latest commit of the pair that passed `authored`. A held discharge closes on its configured steps only, with a warning for each oracle file your corrections changed, because the oracles provider does not see the change. `phax resume --skip-oracle` is refused at a stop.

#### Who closed the stop, and the transcripts

A close reads your identity first, from the main checkout's git configuration (`user.name` and `user.email`, or `author.name` and `author.email` when set). An unset identity refuses the close with exit 1 and the run stays in `awaiting_review`: run `git config user.name` and `git config user.email`, then resume. The identity is written in the stop, with the cause and outcome.

Before it commits, the close copies the transcript of each session it recorded into the phase folder: `<run>/<phase>/interactive-transcripts/<session id>.jsonl`. The recorded sessions are the builder (at a hold), each first turn that answered and every `--new-session` session. A closing turn that started its own session is not one of them; its stream stays in the phase folder as `closing-turn-NN.jsonl`. A copy is written with mode 0600 in a folder with mode 0700, because a continued session may hold secrets you typed. A transcript phax cannot find or read is not an error: the close records it as `missing`, with the reason `not-found` or `unreadable`. A copy that cannot be written refuses the close, and the next close copies again.

#### The record of a stop

A stop writes its phase's record at closing, once, declared or held. The record names:

- the mode (`headless` or `interactive`) and the stop's cause (`declared` or `held`);
- the outcome, corrected or unchanged, and who closed it;
- for a held stop that you corrected, the review commit;
- each recorded session with its provider, model, effort, origin (`first-turn`, `new-session` or `builder`) and its transcript's sha256, or `missing` with its reason.

A declared phase's record names the phase's routed provider, model and effort, the declared commit as its source, and no token usage, because no agent session built the phase. A held phase's usage is the builder's, read when the run stopped. If the records destination refuses the write, the run pauses (exit 1) and `phax resume` writes the record again once the destination accepts it.

`phax records explain <commit>` takes a phase commit, a declared commit or a held phase's review commit, and shows the stop's lines beside the usual ones. A review commit finds its record through its `Run-Id` and `Held-Phase` trailers.

An interactive transcript's content never reaches the records branch, whatever `records.transcript` says: a session you continued ran outside phax's enforcement and may hold secrets you typed, and a dedicated records repository faces no visibility check. The record carries the digest; the copy stays in the run folder, so only the run folder can replay what you and the agent said at a stop. `output.jsonl`, the stream of a headless phase phax ran, still follows `records.transcript`.

#### The security record

The phase's `security.json` has a `stop` section, `null` for a phase that never stopped. A close sets it to the cause, `personWork: "outside-phax-enforcement"`, and one entry for each first and closing turn phax ran. Each entry names the turn, its kind, the narrowing it ran under (`read-only-tools` on Claude Code, `read-only-sandbox` on codex, `none` on mistral-vibe) and its agent commands, which are none. The other fields stay the posture the builder ran under, which your own work did not have. The record carries the file.

#### Review handoff, PR and run list

`review-handoff.md` gains a `## Reviewed phases` table (`Phase | Stop | Outcome | Closed by | Corrections | Guards`), and each corrected stop a `### <phase> (<held|interactive>)` section with what was corrected and its guards. The compliance reviewer reads the same section. The PR body's line for a stopped phase ends with ` · held, corrected by Ada Example (2 guards)`, ` · interactive, corrected by Ada Example (1 guard)` or ` · held, reviewed without change by Ada Example`. A run with no stop reads exactly as before.

`phax ls --json` prints one versioned `run-list` document, and each run embeds its `review-stop` document as `stop` (`null` for a run not waiting at a stop). Together with `review-stop.json`, it is what a review UI reads:

```json
{
  "$schema": "https://…/run-list/…",
  "runs": [
    {
      "qualifiedName": "example.invoice-export",
      "namespace": "example",
      "shortName": "invoice-export",
      "state": "awaiting_review",
      "branch": "phax/invoice-export",
      "currentPhase": "2/6",
      "gateProfile": "standard",
      "updatedAt": "2026-10-24 09:30",
      "lockState": "none",
      "recordsPending": null,
      "archivePath": null,
      "stop": { "$schema": "https://…/review-stop/…", "…": "…" }
    }
  ]
}
```

A script that read the old bare array now reads `.runs[]`; see [upgrading](docs/upgrading.md). A run being closed lists `running` with `stop: null`.

The cost ledger covers Claude Code invocations, for every phase; a stop's first and closing turns on Claude Code are in it like any other turn. [`phax plans estimate`](docs/plan-estimate.md) sizes an interactive phase from those turns.

#### What phax reads from a provider's session store

At closing, phax reads only what it needs from each provider's own store. The roots are `~/.claude`, `~/.codex` and `~/.vibe`, moved by `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `VIBE_HOME` (an empty variable counts as unset).

- **What it reads at closing:** the transcript file of each recorded session, and nothing else. Claude Code: `projects/<slug>/<session id>.jsonl`, where the slug is the worktree's path with every character outside `A-Z a-z 0-9` replaced by `-`. When that misses, it tries the slug of the worktree's real path (`/var/…` is `/private/var/…` on macOS). When both miss, phax lists the names under `projects/` and tries `<name>/<session id>.jsonl` in each. Codex: `sessions/YYYY/MM/DD/rollout-*-<session id>.jsonl`, listing the date directories' names. Mistral Vibe: `logs/session/<directory>/messages.jsonl`.
- **Finding a Vibe session's directory,** for the transcript and for usage: phax lists the names under `logs/session` and reads the `meta.json` of the `session_*` directories whose name ends with a prefix of the session id, decoding only `session_id`. When no name ends that way, it reads the `meta.json` of every `session_*` directory, until one names the id. Take `session_20261024_0199a1b2` for the session `0199a1b2-…`: phax reads its `meta.json` first, and the others only if no name matches. For usage it reads that session's `meta.json` statistics.
- **Learning a new Vibe session's id** after a turn: phax reads the `meta.json` of the session directories modified since the turn started, and keeps the one whose working directory matches.
- **What it never reads:** a provider's credentials or configuration.
- **Where the copies go:** the run folder only. They never enter a commit or a record.
- **Session ids** that are not made of letters, digits, `.`, `_` and `-` are refused before any path is built.

### See what it is doing

```bash
phax run --plan <plan> --verbose      # print phax's events as they happen
phax run --plan <plan> --trace        # and write them to semantic.jsonl in the run folder
phax report <run>                     # open a GitHub issue from the run's telemetry (a secret gist holds the log)
```

phax records its events for every run (state changes, agent calls, gate results); turn that off with `"enabled": false` in `~/.phax/telemetry.json`. [`docs/observability.md`](docs/observability.md) has the details.

## Review and land

A run at `review_open` has done its work on the last phase's branch; nothing has landed. You find there a `review-handoff.md` and the reconciliation of the whole run, against its plan.

```bash
phax review-code <run>          # an agent session in the final worktree, primed to review the change
phax enter <run>                # back into the last phase's agent session
phax shell <run>                # a shell in the final worktree
phax open <run>                 # the final worktree in your editor
phax path <run>                 # the final worktree's path
phax review-handoff <run>       # write review-handoff.md and the reconciliation again
```

`review-code` starts from the reconciliation and the compliance findings rather than a blank prompt, and follows the `phax-review` skill: it uses the change before reading its code, works from the user inward, and looks for what the run's tests cannot catch, each finding naming why they missed it. A copy at `.claude/skills/phax-review/SKILL.md` on the run's branch replaces the bundled skill. Running it again resumes the session, and `--new-session` starts over. Its model is `review.code` in `phax.json`, `claude-opus-5-5` at `high` effort by default, or `--model` and `--effort`.

Two steps run on their own when a run reaches review, if `phax.json` turns them on, and can be run by hand. Neither can fail the run.

```bash
phax review-compliance <run>    # an agent checks the work against the plan, phase by phase, and writes a verdict
phax publish-pr <run>           # push the final branch and open a pull request, or reuse the open one
```

The compliance review changes nothing. `phax publish-pr <run>` writes a short description: a run summary with the compliance verdict, one line per phase, what needs your review (unexplained deviations, compliance attention points), the review notes, and where to read the full review handoff, `~/.phax/runs/<namespace>.<name>/review-handoff.md`, on the machine that ran it. The compliance review's model is `review.compliance`, `claude-sonnet-5-5` at `medium` by default. `publish-pr` needs a GitHub remote and an authenticated `gh`; the remote, base branch and title are set under `publish`.

The description ends with a phax footer, for example:

```markdown
---

🛤️ Generated with [phax](https://docs.phax.run) 0.27.0 — the golden path, just facts\
**Plan** [`docs/plans/archive/2610101200-greet-cli-plan.md`](https://github.com/acme/greet/blob/3f2a…/docs/plans/archive/2610101200-greet-cli-plan.md) · **Spec** [`docs/specs/archive/2610091100-greet-cli.md`](https://github.com/acme/greet/blob/3f2a…/docs/specs/archive/2610091100-greet-cli.md)\
**Agents** claude-code `claude-sonnet-5-5` at medium: 2 phases; codex-cli `gpt-5.5` at high: 1 phase\
**Run** `acme.greet-cli`
```

The plan and the spec (the `source-spec` of the run's plan) are permalinks at the head commit of the published branch, each named where it lives in that commit's tree: its recorded path, else its `archive/` counterpart. The summary's `**Plan**` names the plan the same way. A loose plan (outside `docs/plans/`), a branch `publish-pr` did not push (`publish.pushBranch: false`, so the host may not hold that commit), a web URL `gh repo view` cannot give, or a head commit phax cannot read gives a code span instead of a link; with no readable head, the plan is named at its `archive/` counterpart and the spec is left out. A run that recorded no plan path names its plan as plain `loose plan` text. A plan with no spec has no `**Spec**` part. The agents are the provider, model and effort each committed phase ran with, read from its `agent-binding.json` and counted per assignment; an interactive phase has no binding and a skipped phase did not commit, so neither is counted. When the description is shortened to fit GitHub's limit, the footer is never cut. A pull request that already exists keeps its description: `publish-pr` reuses it as it is. There is no setting to turn the footer off.

### After the merge

```bash
phax ls                         # your runs; --active, --failed, --review-open, --archived, --json
phax archive <run>              # put a finished run away, keeping everything
phax prune --all --dry-run      # see what deleting your archived runs would free
phax prune <run>                # delete an archived run for good
phax cost backfill              # give every kept run without a cost ledger one, from its streams
```

Every run keeps `cost-ledger.json`: each Claude invocation's own API-list cost, tokens, duration and subscription-window samples. `archive` moves it with the run, and `prune` keeps a copy in `~/.phax/cost-ledgers/`.

`archive` moves the run's folder and its worktrees under `~/.phax/archive/<namespace>.<name>/` and keeps the name taken. It accepts a finished run (`review_open`, `completed`) whose final worktree is clean; an unfinished run or a dirty worktree needs `--force`, and a running or locked run is refused.

`prune` deletes archived runs for real: the archive folder, the worktrees' records in Git, the run's local branches, and its entry, which frees its name and its disk space. It shows what it will do first, asks in a terminal (`--yes` otherwise, `--dry-run` to only look), works on this repository's runs only, and never touches the records branch, remote branches or pull requests. Before it deletes the archive folder, it copies the run's cost ledger to `~/.phax/cost-ledgers/<namespace>.<name>.<run-id>.json`; if the copy fails, the run is kept. A run whose branches hold commits found nowhere else is kept, unless you pass `--force`; a branch checked out somewhere keeps its run even then.

## Records

A record is what a phase leaves behind for later: on a `phax/records/v1` branch, one commit per phase, holding its manifest, its gate results and the surfaces they verified, its file reconciliation, its diff, its handoff and logs, and the agent's transcript if you keep it. A headless authoring session leaves one too, and so does every `phax artifact decide` session. Worktrees come and go; the records stay, and they travel with a clone.

```bash
phax records init               # choose: keep transcripts, where the branch lives, push automatically
phax records status             # records not pushed yet, by run and phase
phax records sync               # bring the local records clone in line with its remote
phax records list [--run <id>]  # the records present, by run and phase
phax records explain <commit>   # a commit's record: prompt, diff, gates, handoff, transcript, usage
```

The branch can live in the same repository or in a separate one. Transcripts can hold anything the agent read, so phax refuses to keep them on a public repository's own records branch, and on one it cannot tell is private until you confirm it is (`records.destination.acknowledgedUnknownVisibility`). `records explain` takes `--prompt`, `--diff`, `--transcript` or `--gates` to print each part in full. A phase that stopped for a person's review, declared or held, records its stop too (mode, cause, outcome, closer and sessions, never a transcript's content): see [The record of a stop](#the-record-of-a-stop). To read records from another tool, see [Read phax files from code](#read-phax-files-from-code).

## Providers and security

### Models and providers

phax can run a phase with Claude Code, OpenAI Codex or Mistral Vibe. A plan asks for a model and an effort; the routing layer maps them to a provider that has them, following `providerPriority` in `~/.phax/model-routing.json` (`mistral-vibe`, `codex-cli`, then `claude-code` by default). Vibe and Codex are disabled until you enable them, so a fresh install runs everything with Claude Code.

```bash
phax agent models                                    # the routing table and the provider priority
phax agent resolve --model claude-sonnet-5 --effort medium   # where a request would go
phax agent probe                                     # which provider CLIs are installed
phax agent setup providers --write                   # enable the providers that are installed
phax agent setup mistral-vibe --install-model-aliases   # add phax's model aliases to Vibe
```

[`docs/model-routing.md`](docs/model-routing.md) explains how a request is resolved, and the [model catalog](docs/model-catalog.md) lists the models phax knows.

### Security modes

Every run has a security mode, from `security.profile` in `phax.json` or `--security`:

| Mode       | What the agent can do                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `secure`   | **Default.** The provider's own sandbox: files limited to the worktree, network as `network.profile` allows where the provider can enforce it, no MCP. |
| `unsafe`   | Anything on your machine. phax warns you. For plans you trust.                                                                                         |
| `isolated` | An external sandbox. Planned, refused today.                                                                                                           |

Providers differ: Claude Code and Codex jail the filesystem; Vibe only partly, so a `secure` run skips it and falls back to Claude Code. No provider filters network by domain, and only Codex can cut a phase's network off. The mode a phase actually ran with is in its `security.json`. `phax security status` shows what each installed provider can enforce.

The agent can run your gate commands and the commands in `security.agentCommands`, and nothing else where the provider supports an allowlist. The phax binary has no network permission of its own: what reaches the network (an agent, `git push`, `gh`) is a program it starts. And phax never builds a shell command from your data: every command it runs gets its arguments one by one. [`docs/security.md`](docs/security.md) has the details.

## Extend phax

Four hooks let your own tools inform a run: a gate step that prints a gate report, a brief provider that answers with a brief report, an architecture provider that answers with the repository's architecture for planners, and a plan auditor. A provider is a command in `phax.json`, split on spaces and run without a shell, that reads a JSON request on stdin and answers JSON on stdout. A gate step reads a request only when it declares `"input": "gate-request"` (see [Gate request](#gate-request)); otherwise its stdin is not connected.

The two reports share one location, guide and finding, and phax routes each fact to whoever acts on it: findings and their guides go to the agent, review notes to the reviewer, and a refusal to you.

### Gate report steps

A gate step with `"output": "gate-report"` prints a gate report on stdout, and phax judges the step from that report rather than from its exit code:

```json
{
  "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json",
  "outcome": "checked",
  "findings": [
    {
      "id": "no-node-import src/greet.ts node:fs",
      "rule": "a module under src/ imports no node: module",
      "location": { "file": "src/greet.ts", "lines": [1, 1] },
      "message": "imports node:fs",
      "related": [
        { "file": "src/cli.ts", "lines": [3, 5], "why": "the caller, where the read belongs" }
      ],
      "guide": { "summary": "keep I/O in the module's caller", "read": "guides/no-node-import.md" }
    },
    {
      "id": "exports-function src/farewell.ts",
      "rule": "a module under src/ exports its function",
      "location": { "file": "src/farewell.ts", "lines": null },
      "message": "no exported function",
      "related": [],
      "guide": null
    }
  ],
  "review": [
    {
      "owner": "hw-maintainers",
      "note": "whether 'Hello, <name>!' is the greeting the product wants"
    }
  ]
}
```

Every key shown is required, and a key not shown is refused at any level. `lines` is `[start, end]`, 1-based and inclusive, or `null` for the whole file. `guide` may be `null`, and `findings`, `related` and `review` may be empty. `id` belongs to the step: keep it stable across runs of the same check. phax compares ids by equality only and never shows them. `read` names a file, relative to the working tree, that the agent reads; phax never opens it.

The verdict:

- Any finding fails the step, whatever the exit code. The fix prompt lists each finding with its rule, location, message, related locations and guide, and tells the agent to read each guide's file before changing code.
- An empty `findings` list passes the step on exit 0: `{ "$schema": …, "outcome": "checked", "findings": [], "review": [] }`.
- A refused report stops the phase without a fix attempt (below).
- Anything else is a broken step that fails with the raw log: empty or non-JSON output, a document without `$schema` or in another format, a duplicate `id`, a `lines` pair out of order, a key the format does not name, or an empty list on a non-zero exit. The failure names the gate-report URL phax reads.

`$schema` names the `gate-report` shape the report is written in: the release that last changed the format. A report stamped newer than the running phax, or in an older shape, fails the step too, and phax names the URL it reads. The step must print a report every time it runs. phax never decides when a finding is due, so report only what is: the [gate request](#gate-request) is how a step learns what the phase changed and what later phases will bring.

A step that cannot run its checks says so with a refused report, which carries exactly these keys:

```json
{
  "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json",
  "outcome": "refused",
  "reason": "the checks need hw-rules 2, and 1 is installed",
  "remedy": "pnpm add -D hw-rules@2"
}
```

A refusal goes to you, not to the agent, whatever the exit code. No later step runs, no fix attempt is made, and the run exits 4, naming the step, the reason and the remedy. The phase pauses as it does when its fix attempts run out (`gates_exhausted`), and `phax resume` runs the gate again before any agent turn, with the full `agent.maxFixAttempts` budget. `gate-attribution.json` records the step as `refused`.

Review notes are for the person who reviews the run. They never fail a step and never reach the agent. phax gathers the notes of each phase's last gate attempt into a `## Review notes` section of the review handoff and the PR body, one group per `owner`, with a note several phases left listed once, naming those phases. When the PR body must be shortened to fit GitHub's limit, it cuts review notes last.

When a step fails again on the next attempt, the fix prompt marks each finding whose `id` the step with the same command listed in the previous attempt as `still failing`, wherever it now sits. The previous attempt is the highest-numbered attempt before this one, even across a `phax resume`. Two commands are the same when they split into the same words (`pnpm  test` is `pnpm test`), so a gate profile may not list the same command twice: config loading refuses it with exit 2, naming the profile and the command. Nothing else from earlier attempts reaches the agent.

Nothing in a report grants a command. When a guide asks the agent to run a tool, grant it yourself through `security.agentCommands`.

phax saves every readable report exactly as printed, beside the attempt's log, as `checks-attempt-NN.report-SS.json`, where `SS` is the step's position among the steps the attempt runs. The log itself names that file (`report: checks-attempt-NN.report-SS.json`) rather than holding the report's text, so a later step's failure, whose fix prompt carries the log, never shows the agent a review note. Each attempt also writes `checks-attempt-NN.attribution.json`, the attempt's step record in the gate-attribution format: the commands it ran, in order, with their results, which ties `report-SS` to the step that printed it. `phax records explain --gates` prints each report after its attempt's log and request.

### Gate request

A gate step that declares `"input": "gate-request"` gets a JSON request on stdin, whatever its `output`. A report step reads the request when it declares `input`, and does not have to declare it:

```json
{
  "command": "node ./audit.mjs",
  "surface": "structural",
  "firing": "every-phase",
  "output": "gate-report",
  "input": "gate-request"
}
```

```json
{
  "$schema": "https://docs.phax.run/schemas/gate-request/0.20.0.json",
  "phase": "phase-02",
  "base": "3f9c2a7d1e8b4c6a0f5d9e2b7a1c4d8e6f0b3a5c",
  "terminal": false,
  "phases": [
    { "id": "phase-01", "files": ["src/greet.ts"] },
    { "id": "phase-02", "files": ["src/cli.ts", "tests/cli.test.ts"] },
    { "id": "phase-03", "files": ["README.md"] }
  ]
}
```

- **`phase`** is the phase being gated.
- **`base`** is the full object name of the commit the phase's branch was created from. phax notes it when it creates the branch and never re-derives it.
- **`terminal`** is `true` exactly when the gated phase is the run's terminal phase, the one `terminal` steps fire on.
- **`phases`** is every phase of the run in execution order, each with its planned files to create and edit (optional files excluded).

phax sends facts and decides nothing: the step decides what is due. Read stdin to its end, then parse it. The past is `git diff --name-only <base>` plus the untracked files (`git ls-files --others --exclude-standard`). The future is the `phases` entries after `phase`, so a finding a later phase is planned to fix need not fail this one. When `terminal` is `true`, audit everything. A report step still prints `{"$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json", "outcome": "checked", ...}`, never a document without `$schema`.

phax writes the same bytes to every declaring step of every attempt, then closes stdin. Before an attempt's first declaring step it saves them beside the attempt's log as `checks-attempt-NN.request.json`, and the log shows `stdin: checks-attempt-NN.request.json` right after the step's `$` line; `phax records explain --gates` prints the request after its attempt's log. To replay a verdict, run the step on the saved copy in the phase's worktree:

```bash
node ./audit.mjs < checks-attempt-01.request.json
```

### Brief provider

```json
{ "brief": { "command": "node ./brief.mjs", "push": "findings" } }
```

A brief tells the agent which rules cover some paths, what fails there and how to fix it. Declare `brief` in `phax.json`, `phax.local.json` or `~/.phax/config.json`; the nearest layer that declares it wins whole, `command` and `push` together. Both keys are required: a `brief` without `push`, or with any other value, fails config loading with exit 2. phax ties the brief to no gate step: a brief informs and never blocks, and the gate still decides. phax judges nothing in the report; it only reads it by its `$schema`.

phax asks for a brief at two moments:

- **Pushed**, once when a phase starts fresh, before the agent's first turn. It goes into the first prompt under `## Brief for this phase`, one line per item, as `push` chooses:
  - `"findings"` lists the findings due in this phase, in your order, each with its location, rule, message and guide.
  - `"findings-and-rules"` lists those findings, then each rule over the phase's planned files, with its files and guide.

  A finding due `later`, or with a `null` due, is never pushed. At most 50 items are listed, findings first, then one line says how many more `phax brief` prints. With nothing to list, the section says so in one line. phax asks once per phase: a re-entry after a rate limit shows the recorded brief again, and a resumed phase gets no new section.

- **Pulled**, with `phax brief [path…]`, by the agent or by you, at any time. It prints the whole report: each rule with its files and guide, then each finding with its location, due, rule, message, related locations and guide. It exits 0 on any readable report, an empty one included, and 1 otherwise.

The request on stdin has two variants. Inside a phase, it carries the phase facts and `files`:

```json
{
  "$schema": "https://docs.phax.run/schemas/brief-request/0.20.0.json",
  "phase": "phase-02",
  "base": "3f9c2a7d1e8b4c6a0f5d9e2b7a1c4d8e6f0b3a5c",
  "terminal": false,
  "phases": [
    { "id": "phase-01", "files": ["src/greet.ts"] },
    { "id": "phase-02", "files": ["src/cli.ts", "tests/cli.test.ts"] },
    { "id": "phase-03", "files": ["README.md"] }
  ],
  "files": null
}
```

Outside a phase (`phax brief src/greet.ts` in your own checkout), it carries `files` alone:

```json
{ "$schema": "https://docs.phax.run/schemas/brief-request/0.20.0.json", "files": ["src/greet.ts"] }
```

- **`phase`**, **`base`**, **`terminal`** and **`phases`** hold the same values as the phase's [gate request](#gate-request).
- **`files`** is `null` for the phase's brief (the pushed one, and `phax brief` with no path): brief the files of the `phases` entry whose `id` is `phase`. Otherwise it lists working-tree-root-relative paths, deduplicated, in the order given. phax never checks they exist; a path may name a file the phase has yet to create.

The provider runs from the working tree's root, the phase worktree inside a phase. It answers with a brief report:

```json
{
  "$schema": "https://docs.phax.run/schemas/brief-report/0.21.0.json",
  "rules": [
    {
      "rule": "a module under src/ exports its function",
      "files": ["src/greet.ts", "src/farewell.ts"],
      "guide": null
    },
    {
      "rule": "a module under src/ imports no node: module",
      "files": ["src/greet.ts", "src/farewell.ts"],
      "guide": { "summary": "keep I/O in the module's caller", "read": "guides/no-node-import.md" }
    }
  ],
  "findings": [
    {
      "id": "no-node-import src/greet.ts node:fs",
      "rule": "a module under src/ imports no node: module",
      "location": { "file": "src/greet.ts", "lines": [1, 1] },
      "message": "imports node:fs",
      "related": [],
      "guide": { "summary": "keep I/O in the module's caller", "read": "guides/no-node-import.md" },
      "due": "this-phase"
    },
    {
      "id": "exports-function src/farewell.ts",
      "rule": "a module under src/ exports its function",
      "location": { "file": "src/farewell.ts", "lines": null },
      "message": "no exported function",
      "related": [],
      "guide": null,
      "due": "later"
    }
  ]
}
```

- **`rules`** says what a file at the requested paths must or must not do, even a file not written yet: each `rule` with the requested `files` it covers (at least one) and its `guide`, or `null`.
- **`findings`** says what fails at those paths. A finding has the keys of a [gate report](#gate-report-steps)'s finding (`id`, `rule`, `location`, `message`, `related` and `guide`), plus `due`.
- **`due`** is `"this-phase"` or `"later"`, from what the later `phases` entries still plan, and `null` when the request carried no phase facts. It is your word: phax never computes or checks it.
- **`guide`** is a `summary` and a file to `read`, relative to the working tree, that the agent reads and follows. phax never opens it.
- The order of each list is your rank, most important first; phax never re-sorts. Every key shown is required, and a key not shown is refused at any level: there is no outcome and no review note. `{ "$schema": …, "rules": [], "findings": [] }` means nothing to report, and `phax brief` then prints `No brief for …`.
- `$schema` names the `brief-report` shape the report is written in: the release that last changed the format. A report without `$schema`, naming another format, stamped newer than the running phax or in an older shape is refused by name, as is a finding `id` used twice or a `lines` pair out of order, and the refusal names the URL phax reads.

A provider that declines to run exits non-zero, with its reason on stderr. A brief that fails (a non-zero exit, output that is not JSON, a refused report, or more than 60 seconds; the limit is fixed) never fails the phase. A pushed brief becomes a run-output warning and a line in the prompt saying the brief is unavailable and why, with the provider's stderr; a pulled one prints the reason and exits 1.

Inside a phase, phax writes the phase's request to `.phax-context/brief-request.json` when the phase starts or resumes; `phax brief` reads its phase from there, from any directory of the worktree. Replay the phase's brief in the worktree:

```bash
node ./brief.mjs < .phax-context/brief-request.json
```

Every brief of a phase is recorded in its phase folder: `brief-00.json` for the pushed one, `brief-01.json` onwards for each pull, in call order. Each holds the request as sent and the outcome: the report as printed, every key in its printed order. The phase record carries them; `phax records explain <commit> --briefs` prints them. A pull after the phase's record is written is answered and not recorded. Replay a recorded brief:

```bash
jq -c .request brief-01.json | node ./brief.mjs
```

In `secure` mode the in-phase agent is granted `phax brief` (source `brief` in `security.json`) whenever a brief provider is configured, and a pull runs inside the agent's sandbox. Inside a phase worktree phax refuses every command but `phax brief` and the read-only ones, as a guard against mistakes; the sandbox's write scope is the boundary. The authoring `--brief` flag and `docs/briefs/` are something else: a brief a person writes for an authoring session.

### Architecture provider

An architecture provider tells a planner how the repository is built:

```json
{ "architecture": { "command": "acme-guard architecture" } }
```

`phax architecture [path]…` prints the report the provider answers, the Markdown body then each part (id, name, description, globs), for the whole repository or the parts that hold the paths. When `phax.json` declares `assignments`, it then lists the bounds. With no provider configured it prints one line telling the agent to read the code and its documentation, followed by the bounds when declared, and exits 1; it writes nothing either way. A headless plan authoring session is told whether a provider is configured or bounds are declared, and is granted this command when either is. See [Architecture provider](docs/architecture-provider.md) for the request, the report and the limits a provider runs under.

### Oracle provider

An oracles provider judges the two phases of an oracle pair: the phase that writes tests and the phase that discharges them.

```json
{ "oracles": { "command": "node tools/vitest-oracles.mjs" } }
```

At the gate of each of the two phases, after every configured step passed, phax runs the command (split on spaces, no shell, in the phase worktree, 120-second limit) and sends it an `oracle-request` on stdin. The verdict is `authored` at the oracle phase, where every test must carry the runner's expected-failure marker, and `discharged` at the discharging phase, which may only remove those markers; the request then also names the oracle phase's commit. The provider answers a `gate-report` on stdout, judged like any report step: findings go to the fix loop, a refusal pauses the phase with exit 4, and a fix loop that runs out on a failing oracle exits 4 too. The request is saved as `checks-attempt-NN.oracle-request.json`. When no provider is configured, `phax plans lint` reports an `oracles` error on every oracle phase and exits 1, and `phax run` and `phax resume` refuse the plan with exit 11; none of them spawns the provider. A committed oracle phase is not reset, so when the discharge shows that the oracle itself is wrong, correct it in the stopped phase (`phax enter-phase <run> <phase>`) and run `phax resume <run> --yes --skip-oracle`: that phase's configured gate still runs, with the usual fix loop, its oracle step is recorded `skipped`, and `oracle` is then not among its verified surfaces or the run's; To review the oracles before their discharge, hold the oracle phases with `phax run --hold oracle`: a correction to an oracle file is judged again with the `authored` verdict at the close (see [Reviews inside an oracle pair](#reviews-inside-an-oracle-pair)). phax knows no test framework: the provider does. See [Oracle phases](docs/oracle-phases.md) for the formats, a worked example and how to write the plan. The phax repository carries a Vitest provider that compares syntax trees in [`examples/vitest-oracles/`](examples/vitest-oracles/), declared in its own `phax.json` as `node examples/vitest-oracles/main.mjs` and shipped in no package: copy it and adapt it to your runner.

### Assignment bounds

The repository's owner can bound which model, at which efforts, a phase takes where it touches certain files:

```json
{
  "assignments": [
    {
      "kind": "part",
      "part": "core-decide",
      "model": "claude-opus-5-5",
      "effort": { "min": "medium", "max": "high" }
    },
    {
      "kind": "globs",
      "globs": ["src/*/schemas/**"],
      "model": "claude-sonnet-5-5",
      "effort": { "min": "medium", "max": "high" }
    }
  ]
}
```

A `part` bound names an architecture-report part by its id; a `globs` bound lists globs. The list is ordered and the first bound that matches any file a phase plans to touch governs it; with none, the policy default stands in. A phase that departs from its governing bound needs an `**Assignment reason:**` line: without one, `phax plans lint` reports an error and `phax run` / `phax resume` refuse with exit 11 before the run is named. `assignments` is accepted in `phax.json` only, and `phax validate` checks each bound against the routing catalog. See [Assignment bounds](docs/assignment-bounds.md).

### Plan auditor

```json
{ "planAuditor": { "command": "node ./audit-plan.mjs" } }
```

Reviews a plan's shape for `phax plans lint` (never during a run). It receives every phase's planned files, `{"phases": [{"id", "files"}]}` — nothing else leaves phax — and answers `{"findings": [{"message", "phases": [...]}]}`. Its findings are warnings; a provider that fails or takes more than 30 seconds becomes one warning saying why.

[`examples/hello-world/`](examples/hello-world/) has a small example of each provider except the oracles provider, whose example is [`examples/vitest-oracles/`](examples/vitest-oracles/).

## Persisted formats

Every file phax writes starts with `$schema`, naming its format and that format's shape — the release that last changed the format, not the release that wrote the file — for example `https://docs.phax.run/schemas/run-status/0.17.0.json`. Each URL serves that format's JSON Schema, and stays up for good. Files written before 0.17.0 have no `$schema`.

| Format                                       | Format id                   | Where it lives                                                                                             | Read it with                   | JSON Schema                                  |
| -------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| Run registry                                 | `registry`                  | `~/.phax/registry.json`                                                                                    | `parseRegistry`                | `json/registry.schema.json`                  |
| Run status                                   | `run-status`                | `<run folder>/run-status.json`                                                                             | `parseRunStatus`               | `json/run-status.schema.json`                |
| Phase status                                 | `phase-status`              | `<run folder>/<phase-id>/status.json`                                                                      | `parsePhaseStatus`             | `json/phase-status.schema.json`              |
| phax-plan                                    | `phax-plan`                 | `<run folder>/phax-plan.json`                                                                              | `parsePhaxPlan`                | `json/phax-plan.schema.json`                 |
| Compliance review                            | `compliance-review`         | `<run folder>/compliance-review.json`                                                                      | `parseComplianceReview`        | `json/compliance-review.schema.json`         |
| Cost ledger                                  | `cost-ledger`               | `<run folder>/cost-ledger.json`; `~/.phax/cost-ledgers/<namespace>.<short-name>.<run-id>.json` after prune | `parseCostLedger`              | `json/cost-ledger.schema.json`               |
| Plan approval record                         | `plan-approval-record`      | `docs/plans/approvals/<plan>.json`                                                                         | `parsePlanApprovalRecord`      | `json/plan-approval-record.schema.json`      |
| Spec approval record                         | `spec-approval-record`      | `docs/specs/approvals/<spec>.json`                                                                         | `parseSpecApprovalRecord`      | `json/spec-approval-record.schema.json`      |
| Plan approvals (old ledger, read to migrate) | `plan-approvals`            | `docs/plans/approvals.json`                                                                                | `parsePlanApprovals`           | `json/plan-approvals.schema.json`            |
| Spec approvals (old ledger, read to migrate) | `spec-approvals`            | `docs/specs/approvals.json`                                                                                | `parseSpecApprovals`           | `json/spec-approvals.schema.json`            |
| Phase record manifest                        | `phase-record-manifest`     | `<runId>/<phaseId>/record.json` on `phax/records/v1`                                                       | `parsePhaseRecordManifest`     | `json/phase-record-manifest.schema.json`     |
| Authoring record manifest                    | `authoring-record-manifest` | `authoring/<authoringId>/record.json` on `phax/records/v1`                                                 | `parseAuthoringRecordManifest` | `json/authoring-record-manifest.schema.json` |
| Decision record manifest                     | `decision-record-manifest`  | `decision/<stamp>-<slug>/<NN>/record.json` on `phax/records/v1`                                            | `parseDecisionRecordManifest`  | `json/decision-record-manifest.schema.json`  |
| Gate attribution                             | `gate-attribution`          | `<record>/gate-attribution.json`, `<record>/checks-attempt-NN.attribution.json`                            | `parseGateAttribution`         | `json/gate-attribution.schema.json`          |
| File reconciliation                          | `phase-file-reconciliation` | `<record>/file-reconciliation.json`                                                                        | `parsePhaseFileReconciliation` | `json/phase-file-reconciliation.schema.json` |
| Gate request                                 | `gate-request`              | `<record>/checks-attempt-NN.request.json`                                                                  | `parseGateRequest`             | `json/gate-request.schema.json`              |
| Brief request                                | `brief-request`             | `<worktree>/.phax-context/brief-request.json`, `request` in a brief record                                 | `parseBriefRequest`            | `json/brief-request.schema.json`             |
| Brief record                                 | `brief-record`              | `<record>/brief-NN.json`                                                                                   | `parseBriefRecord`             | `json/brief-record.schema.json`              |
| Gate report                                  | `gate-report`               | a report step's stdout, `<record>/checks-attempt-NN.report-SS.json`                                        | `parseGateReport`              | `json/gate-report.schema.json`               |
| Brief report                                 | `brief-report`              | the brief provider's stdout, `outcome.answer` in a brief record                                            | `parseBriefReport`             | `json/brief-report.schema.json`              |
| Architecture request                         | `architecture-request`      | the architecture provider's stdin, never saved                                                             | `parseArchitectureRequest`     | `json/architecture-request.schema.json`      |
| Architecture report                          | `architecture-report`       | the architecture provider's stdout, never saved                                                            | `parseArchitectureReport`      | `json/architecture-report.schema.json`       |
| Oracle request                               | `oracle-request`            | the oracles provider's stdin, `<run folder>/<phase-id>/checks-attempt-NN.oracle-request.json`              | `parseOracleRequest`           | `json/oracle-request.schema.json`            |
| First reading                                | `first-reading`             | the final message of a declared interactive phase's first turn, `<run folder>/<phase-id>/first-reading.md` | `parseFirstReading`            | `json/first-reading.schema.json`             |
| Interactive handoff                          | `interactive-handoff`       | the final message of a declared interactive phase's closing turn                                           | `parseInteractiveHandoff`      | `json/interactive-handoff.schema.json`       |
| Interactive session                          | `interactive-session`       | `<run folder>/<phase-id>/interactive-session.json`                                                         | `parseInteractiveSession`      | `json/interactive-session.schema.json`       |
| Review stop                                  | `review-stop`               | `<run folder>/review-stop.json`, while the run is `awaiting_review`                                        | `parseReviewStop`              | `json/review-stop.schema.json`               |
| Run list                                     | `run-list`                  | the output of `phax ls --json`, never saved                                                                | `parseRunList`                 | `json/run-list.schema.json`                  |
| Spec document                                | `spec-document`             | `.json` sidecar beside a headless-authored spec                                                            | `parseSpecDocument`            | `json/spec-document.schema.json`             |
| Plan document                                | `plan-document`             | `.json` sidecar beside a headless-authored plan                                                            | `parsePlanDocument`            | `json/plan-document.schema.json`             |
| Hand decision answer                         | `hand-decision-answer`      | a decide session's final message over a hand-authored spec or plan                                         | `parseHandDecisionAnswer`      | `json/hand-decision-answer.schema.json`      |
| Decide verdicts                              | `decide-verdicts`           | the file a person writes for `phax artifact decide --verdicts`                                             | `parseDecideVerdicts`          | `json/decide-verdicts.schema.json`           |
| Record manifest (union)                      | `record-manifest`           | any `record.json` on `phax/records/v1`                                                                     | `parseRecordManifest`          | `json/record-manifest.schema.json`           |

Spec and plan documents carry open and arbitrated questions, and every spec surface element carries a one-line `summary`. A spec sidecar stamped below 0.27.0, or written before `$schema`, is lifted with a summary placeholder on every surface element; `approve` and `complete` refuse a spec still holding one. A spec sidecar written in an older shape, or a plan sidecar stamped 0.26.0, 0.25.0 or 0.20.0 or written before `$schema` without a source spec, is lifted when phax reads it, and `phax artifact migrate-documents` restamps it at the current shape; an older plan sidecar stays refused. A plan document holds each phase's test strategy as test lines; an older plan sidecar's test strategy string is read through the line format, so one whose every line follows it lifts to those lines, while one holding prose still reads but `migrate-documents` refuses it, naming the phase and its first departing line. A `phax-plan.json` in the 0.26.0 shape or older, written without `testLines`, is still shown by `phax ls` and `phax session-info`, but `phax resume` and `phax validate --plan` refuse it.

## Read phax files from code

`@lbdremy/phax-schemas` reads all of them, with phax's own types and verdicts, without phax installed. `parseDocument` reads any file that carries `$schema`; the JSON Schema of each format is in the package, as `json/<format id>.schema.json`.

```bash
npm install @lbdremy/phax-schemas
```

```js
// read-record.mjs: Node 20+, phax not installed, only @lbdremy/phax-schemas
import { execFileSync } from "node:child_process";
import { parsePhaseRecordManifest } from "@lbdremy/phax-schemas";

const [runId, phaseId] = process.argv[2].split("/"); // "<runId>/phase-01"
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// Each commit on the records branch holds only its own record: find the
// record's commit by its trailers, then read the file at that commit.
const sha = git(
  "log",
  "phax/records/v1",
  "--format=%H",
  "--fixed-strings",
  "--all-match",
  `--grep=Run-Id: ${runId}`,
  `--grep=Phase-Id: ${phaseId}`,
  "-1",
);
if (!sha) {
  console.error(`no record for ${runId}/${phaseId} on phax/records/v1`);
  process.exit(1);
}
const raw = git("show", `${sha}:${runId}/${phaseId}/record.json`);

const parsed = parsePhaseRecordManifest(JSON.parse(raw));
if (!parsed.ok) {
  console.error(`record.json: ${parsed.error.path}: ${parsed.error.message}`);
  process.exit(1);
}
const { outcome, usage } = parsed.value; // typed PhaseRecord
console.log(runId, phaseId, outcome, usage.available ? usage.usage.provider : "no usage");
```

```bash
node read-record.mjs <runId>/phase-01
```

A failed parse is a value, never an exception: `parsed.ok` is `false`, with a `path` and a `message`. A file stays readable as phax evolves: an older shape still parses, upgraded in memory by the format's `toLatest*` function (a fact phax did not track yet becomes `{ kind: "unknown" }`), and a file written by a newer phax asks you to upgrade the package.

Each commit on `phax/records/v1` holds only its own record, so `git show phax/records/v1:<path>` sees only the newest one: find a record by its commit trailers (`Run-Id` and `Phase-Id`, or `Authoring-Id`), as above. To read them all, list the branch's commits (`git log phax/records/v1 --format=%H`), read the `record.json` each one holds (`git ls-tree -r --name-only <sha>`, then `git show <sha>:<path>`) and give it to `parseRecordManifest`.

## Exit codes

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| 0    | Success                                                     |
| 1    | Generic failure (refusal, bad arguments, no project config) |
| 2    | Plan or config validation                                   |
| 3    | Unsafe git state                                            |
| 4    | Gate failure (fix attempts exhausted, or a step refused)    |
| 5    | Agent invocation error (Claude, Vibe, or Codex)             |
| 6    | Archive blocked by a dirty worktree                         |
| 7    | Lock conflict                                               |
| 8    | Rate or usage limit hit (resumable)                         |
| 9    | Phase produced no changes (resumable)                       |
| 10   | Registry corruption                                         |
| 11   | Security or preflight refusal                               |
| 12   | Artifact lifecycle refusal                                  |
| 13   | Awaiting review at an interactive or held phase (resumable) |

`phax prune` uses a subset of these codes: 0 when every selected run was pruned, for a `--dry-run` preview, or when there is nothing to prune; 1 when nothing was deleted (a bad selection, no project config, or a declined or missing confirmation); 3 when at least one selected run was kept; 7 when a selected run is locked.

## Environment

phax reads no environment variable for its configuration: everything is in `phax.json`, its layers and `~/.phax/`. The one variable it honours, `PHAX_E2E_RUN=1`, enables its own end-to-end tests.

## Troubleshooting

- **`claude` not found.** Install Claude Code and make sure `claude` is on your `$PATH`; `phax agent probe` lists what phax finds.
- **A gate keeps failing.** The run pauses once the fix attempts are spent. Read the attempt logs, `~/.phax/runs/<namespace>.<name>/phase-NN/checks-attempt-NN.log`. Attempts are numbered once per phase: a resumed phase continues at the next number and never overwrites an earlier attempt's files, so the last attempt is the highest-numbered `checks-attempt-NN.log`. Fix the cause (or raise `agent.maxFixAttempts`), then `phax resume <run>`, which runs the gate again first. To start the phase over instead, `phax reset-phase <run>` before resuming.
- **Lock conflict.** Another phax is working on that run, or one died; `phax unlock <run>` clears a stale lock.
- **The handoff is missing.** The phase ended in `handoff_failed`: `phax enter <run>` takes you back into its session.
- **A rate or usage limit.** The run stopped at exit 8 and keeps its place: `phax resume <run>` when the limit resets.
- **A plan with a source spec is refused for lacking `completes-spec`.** A plan whose `source-spec` names a spec must carry `completes-spec: true` (its run completes the spec) or `false` (more plans follow); `plans lint`, `artifact approve` and `run` refuse it with exit 12. Add the key by hand, then re-approve an Approved plan, since changing the value makes it stale. A headless plan's older `.json` sidecar lacks `completesSpec` too: re-author or delete it.
- **Approval records are per-artifact files.** Approval records were one shared ledger per kind; each is now a file of its own under `docs/plans/approvals/` and `docs/specs/approvals/`. After upgrading, `phax artifact approve` and `phax run` refuse with exit 12 while `docs/plans/approvals.json` or `docs/specs/approvals.json` exists. Run the one-time migration, which splits both ledgers into record files in one commit:

  ```console
  $ phax artifact approve docs/plans/2610051200-foo-plan.md
  ✗ docs/plans/approvals.json is an approval ledger from an older phax — run `phax artifact migrate-approvals` first
  $ phax artifact migrate-approvals
  docs/plans/approvals.json → 1 record file
    docs/plans/approvals/2606291247-smolvm-isolation-spike-plan.json
  committed a1b2c3d chore(approvals): migrate approval ledgers to record files
  $ phax artifact approve docs/plans/2610051200-foo-plan.md   # now writes docs/plans/approvals/2610051200-foo-plan.json
  ```

- **Approvals name their approver.** `phax artifact approve` and `phax artifact reopen` now take `--by operator` or `--by machine:<grant>` (a kebab-case slug). Without a terminal they refuse with exit 12 unless given `--by`, so add it to scripts and loops; from a terminal the default is the operator, named as git commits (`GIT_COMMITTER_NAME`, else `user.name`), and an operator approval with neither set refuses. New approval records carry `approvedBy`; records written earlier read as `unattributed` and are never rewritten by a read.

- **Spec and plan documents carry questions.** A spec or plan can hold open and arbitrated questions, each named by id, and `phax artifact status` prints a `Questions:` line counting them. After upgrading, run `phax artifact migrate-documents` once in the main checkout: `phax artifact approve` and `phax artifact reopen` refuse with exit 12 until every live headless sidecar is at its current shape. The command rewrites each older sidecar, re-renders its body keeping the frontmatter, and commits exactly what it wrote in one commit. It refuses, writing nothing, on an invalid sidecar, on a body that is not its sidecar's own rendering (a hand edit would be overwritten), or on an uncommitted change to a path it would write. It names the Approved artifacts it leaves edited since approval, with their open question ids, and the plans it leaves stale. A spec question whose rationale opens with `Decided by the author on <date>` becomes arbitrated, lifted and unattributed; every other question stays open. `abandon` is not refused. `complete` (exit 12) and run completion refuse only a current-shape spec still holding a summary placeholder. Each surface element of a spec now carries a `summary`: a sidecar stamped below 0.27.0, or written before `$schema`, is lifted with a placeholder on every element, `migrate-documents` restamps it and counts the summaries to write per spec, and `approve` and `complete` refuse a spec until every placeholder is replaced.

- **`migrate-documents` refuses a plan whose test strategy is prose.** A plan document now holds each phase's test strategy as test lines. A plan sidecar stamped 0.26.0 or below whose every test strategy line follows the line format is lifted to those lines; one holding prose is refused with exit 12, writing nothing, naming the phase and its first departing line:

  ```console
  $ phax artifact migrate-documents
  ✗ migrate refused: docs/plans/2610230951-interactive-phases-plan.md phase-01 testStrategy line 1 departs from the test line format: "Write `tests/unit/hold.test.ts` first."
    Rewrite each phase's test strategy in the line format, in the sidecar and plan.md alike, or re-author the plan, then rerun.
  ```

  Each line reads `- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`, one per line under the phase's `### Test strategy` heading, or a lone `- (none)`.

Something else? `phax report <run>` opens a GitHub issue with the run's telemetry.

## CLI command reference

<!-- BEGIN GENERATED CLI REFERENCE -->

Full CLI reference: [`docs/cli/reference.md`](docs/cli/reference.md).

- `phax validate [--plan <path>]` — Checks that the configuration decodes and, with --plan, that the given phax-plan.json decodes. The config layers (phax.json, phax.local.json, ~/.phax/config.json) are merged and decoded; a user overlay that carries assignments is refused, because assignments is accepted only in phax.json.
- `phax unlock [--force] <short-name>` — Remove a stale run lock; use --force to remove any lock
- `phax enter <short-name>` — Attaches to the kept-open agent session in the final worktree, so you can review the agent's work, ask follow-up questions, or apply manual fixes interactively.
- `phax enter-phase [--new-session] <short-name> <phase-id>` — Continues a phase's agent session interactively in the phase's worktree: claude-code with `claude --resume` and codex with `codex resume`; mistral-vibe has no verified interactive resume. The session carries the phase's own filesystem, network and MCP posture, rebuilt from its security.json; a phase whose security.json cannot be read is refused rather than opened unconfined. Useful for inspecting intermediate state or debugging a phase that has not yet been committed to main.
- `phax session-info [--debug] <short-name>` — Prints diagnostic information about a run: its current state, active phase, worktree path, and agent session id. For a run in awaiting_review it prints the stop's cause, the stopped phase, its worktree, the seed and the current session with the phax enter-phase command that continues it. A held stop reads `headless, committed <short sha>`, and its session is the builder's. Read-only — no side effects.
- `phax shell <short-name>` — Opens an interactive shell in the final worktree. Useful for manually inspecting files, running tests, or executing commands outside the agent session. For a run in awaiting_review it opens the stopped phase's worktree.
- `phax path <short-name>` — Prints the absolute path to the final worktree on a single line. Useful in scripts: cd $(phax path my-run) or for piping to other tools. For a run in awaiting_review it prints the stopped phase's worktree.
- `phax open <short-name>` — Opens the final worktree in the editor configured in phax.json (or the EDITOR environment variable). Equivalent to running your editor with the worktree path as an argument. For a run in awaiting_review it opens the stopped phase's worktree.
- `phax ls [FLAGS]` — Lists runs from the local registry (~/.phax/runs/). With no filter flags, shows all runs. Use status filters to narrow output: --active (created or running), --failed, --review-open (finished, open for human review), --awaiting-review (stopped at an interactive phase), or --archived. A run waiting at a stop reads awaiting_review (declared) or awaiting_review (held), and its PHASE column names the stopped phase. Use --json for the versioned run list: one run-list document (a $schema and a runs array) whose runs carry qualifiedName, namespace, shortName, state, branch, currentPhase, gateProfile, updatedAt, lockState, recordsPending, archivePath and stop. A value that is unknown is null, and stop is the run's review-stop document, or null when the run is not waiting at a stop.
- `phax archive [--force] <short-name>` — Archives a run by moving its worktrees under ~/.phax/archive/<namespace>.<short-name>/ and marking it archived in the registry. Nothing is destructively deleted — every phase's working state is preserved.
- `phax prune [FLAGS] [short-name]…` — Deletes each selected archived run of the current namespace for real: its archive folder under ~/.phax/archive/<namespace>.<short-name>/, its worktree metadata in the current repository, its local branches (<branch> and <branch>--phase-NN) and, last, its registry entry — so its name and disk space come back. Before deleting the archive folder, it keeps the run's cost ledger: runs/cost-ledger.json is copied byte for byte to ~/.phax/cost-ledgers/<namespace>.<short-name>.<run-id>.json, and a failed copy keeps the run. Select runs by name (short or <namespace>.<short-name>) or with --all; only archived runs of the current namespace can be pruned, and an unknown, non-archived or other-namespace name refuses the whole command. Never touches records on phax/records/v1, remote branches, remote-tracking refs or pull requests, and never contacts a remote.
- `phax cost <SUBCOMMAND>` — Parent command for the runs' cost ledgers. Every run keeps cost-ledger.json in its run folder: one entry per Claude invocation (phase turn, fix attempt, handoff generation, compliance review) with its own API-list cost, tokens per model, agent duration, end time and subscription-window samples. phax archive moves it with the run, and phax prune keeps a copy under ~/.phax/cost-ledgers/.
- `phax cost backfill` — Writes cost-ledger.json for every run in the registry, across namespaces, that has none, derived from the Claude streams its run folder kept: each phase's output.jsonl, fix-attempt-NN.jsonl and handoff-generation.jsonl (reset phase folders first), then compliance-review.session.jsonl. It reads the active run folder (~/.phax/runs/<namespace>.<short-name>/) or the archived one (~/.phax/archive/<namespace>.<short-name>/runs/). Each entry is the invocation's own cost, corrected when Claude Code reports a resumed session cumulatively; its end time is the stream's modification time, and an interrupted invocation carries no duration. A run with no Claude stream gets an empty ledger.
- `phax run <FLAGS> [short-name]` — Extracts a plan from the plan.md given by --plan, creates a run entry in the registry, and executes each phase sequentially in its own Git worktree using the configured AI agent. Each phase runs its gate profile's every-phase steps after execution; the final phase also runs the profile's terminal steps. Each step's surface (local, structural, or product) is recorded per phase and the run's verified surfaces are reported at run end.
- `phax review-handoff [--allow-partial] <short-name>` — Regenerate review-handoff.md and global file reconciliation for a review_open run
- `phax publish-pr <short-name>` — Pushes the final worktree branch to the GitHub remote and creates a pull request, or reuses an existing PR for the same branch. Requires a GitHub remote and gh CLI authentication.
- `phax review-compliance <short-name>` — Runs a non-mutating plan-compliance review by invoking the AI agent with the run's handoff artifacts and the original plan. Does not modify the worktree, registry, or any files.
- `phax review-code [FLAGS] <short-name>` — Opens an interactive, pre-prompted code-review session for a review_open run by launching the AI agent in the run's worktree with the code-review prompt. The prompt carries the phax-review skill: the project's copy at .claude/skills/phax-review/SKILL.md in the run's worktree when it has one, else the bundled skill. The session is resumable: re-running resumes the existing session, while --new-session starts fresh. The developer takes over the session to investigate, discuss, and apply fixes.
- `phax adjust-plan <FLAGS> <plan>` — Opens an interactive, pre-prompted session to help you adjust a plan.md after a landed run has introduced drift. The session establishes which of the plan's declared files, line references, and decisions are invalidated by the landed run's actual changes, asks clarifying questions where needed, proposes concrete edits and waits for your explicit approval, and only then edits and commits the plan — all interactively within the session. The command itself mutates nothing.
- `phax brief [path]…` — Asks the brief provider configured as "brief": { "command": …, "push": … } in phax.json, phax.local.json or ~/.phax/config.json which rules cover the given paths, what fails there and how to fix it. Paths resolve against the current directory, may not exist yet, and must lie inside the working tree; they are sent relative to its root, deduplicated, in the order given. Config is read from the repository's main checkout; the provider runs from the working tree's root, with no shell, one brief request on stdin, and a fixed 60-second limit.
- `phax architecture [path]…` — Asks the architecture provider configured as "architecture": { "command": … } in phax.json, phax.local.json or ~/.phax/config.json for the repository's architecture, and prints its report: the Markdown body, then the report's parts rendered to Markdown, then the owner's assignment bounds (phax.json "assignments") as a "## Bounds" list, each as assignments[N] with its model and effort range; a part bound shows its part's name and globs, and a path-scoped report that does not carry the part says to run the command with no path for its globs. With no path, it asks about the whole repository; with paths, about the parts that hold them. Paths resolve against the current directory, may not exist yet, and must lie inside the working tree. Config is read from the repository's main checkout; the provider runs from the working tree's root, with no shell, one architecture request on stdin, and a fixed 60-second limit.
- `phax init [--force] [--yes]` — Creates phax.json and phax.schema.json in the current directory. Use --force to overwrite an existing phax.json. Does not connect to any network or external service.
- `phax report [--no-gist] [short-name]` — Creates a GitHub issue from local run telemetry. By default, uploads the full log as a secret GitHub gist and links it in the issue body. Use --no-gist to inline the log directly.
- `phax completions <shell>` — Generate a shell completion script (zsh, bash, fish, nu, powershell). Requires the usage CLI.
- `phax resume [FLAGS] <short-name>` — Picks up a run from its next pending phase, re-entering the same execution loop as phax run. Prompts for confirmation before proceeding unless --yes is set.
- `phax reset-phase [FLAGS] <short-name> [phase-id]` — Resets a stuck or failed phase: its folder is archived, its worktree and branch are removed, and the run becomes resumable so phax resume starts the phase over. Without --yes it first previews what the reset would discard.
- `phax agent <SUBCOMMAND>` — Inspect and manage model routing and provider configuration
- `phax agent models` — Print the routing table and provider priority
- `phax agent resolve <FLAGS>` — Show how a model+effort request resolves to a provider and concrete model
- `phax agent probe` — Check which provider executables are available on PATH; never throws on an unavailable provider
- `phax agent setup <SUBCOMMAND>` — Set up provider integrations
- `phax agent setup mistral-vibe [--dry-run] [--install-model-aliases]` — Append PHAX-owned Mistral Vibe model aliases to ~/.vibe/config.toml (append-only, atomic)
- `phax agent setup providers [FLAGS]` — Reconcile ~/.phax/providers.json enabled flags from live executable probes (dry-run by default)
- `phax security [--verbose] [--trace] <SUBCOMMAND>` — Security-related commands
- `phax security status [--verbose] [--trace]` — Show provider security capabilities and availability
- `phax skills <SUBCOMMAND>` — Manage PHAX skills
- `phax skills install <--target <target>> [--scope <scope>] [skill]` — Install bundled PHAX skills into an agent's native skill directory
- `phax schema <SUBCOMMAND>` — Manage the local phax.schema.json
- `phax schema upgrade` — Regenerate phax.schema.json from the installed binary's config contract; never modifies phax.json
- `phax artifact <SUBCOMMAND>` — Parent command for inspecting and transitioning the lifecycle status of a spec (docs/specs/) or plan (docs/plans/). Specs carry Draft, Approved, Abandoned, or Completed; plans additionally carry Stale. Transitioning to a terminal status (Abandoned, Completed) moves the file into the artifact's archive/ subdirectory as part of the transition. A headless-authored artifact's JSON document sidecar (<name>.json beside the .md) travels with it: every transition's write-set includes it, and a terminal transition moves it into archive/ alongside the .md. Illegal transitions and validation failures (missing frontmatter block, unknown status, status/location disagreement) refuse with exit code 12.
- `phax artifact status <path>` — Reports an artifact's kind (spec or plan), current status, and the legal transitions from that status (an Approved spec or plan lists Draft, reached with phax artifact reopen). For an approved spec or plan, also reports the approval date and baseline, its approver (by machine (<grant>), by operator (<name>), or unattributed for an approval recorded before phax named the approver), and whether the artifact has been edited since that approval (recorded) or has no approval record (unrecorded). Also reports how the artifact was authored: interactive (no sidecar), or headless with its JSON document sidecar and whether the body is still the sidecar's rendering (in sync), differs from it (diverged — the body was edited by hand), or the sidecar is not a valid document (invalid). Frontmatter changes never count as divergence. A sidecar stamped below its document format's current shape, or written before $schema, is not compared: status names its stamped shape and `phax artifact migrate-documents` instead.
- `phax artifact approve [--by <arbiter>] <path>` — Transitions an artifact to Approved. Legal from Draft (both kinds) and from Stale (plans only); re-approving an already-Approved artifact re-records the approval, refreshing its timestamp and baseline — this is the correct way to record an in-place revision of a spec, not editing the date by hand. Rewrites the frontmatter status key in place. An Approved artifact goes back to Draft only through `phax artifact reopen`, which voids the approval.
- `phax artifact stale <path>` — Manually marks a plan Stale. Legal from Approved only — Stale has no automatic trigger (that belongs to a future lineage spec). Rewrites the frontmatter status key in place.
- `phax artifact abandon <path>` — Abandons an artifact — a terminal status distinct from Completed, for work dropped without execution. Legal from Draft or Approved (specs) or Draft, Approved, or Stale (plans).
- `phax artifact complete <path>` — Completes an artifact — a terminal status for work that ran to completion. Legal from Approved (specs) or Approved or Stale (plans).
- `phax artifact reopen [--by <arbiter>] <path>` — Reopens an artifact back to Draft, voiding its approval, for when it must be revised before re-approval. Legal from Approved (specs and plans) and from Stale (plans only); a Draft, Completed or Abandoned artifact is refused with exit 12 and nothing is written. Rewrites the frontmatter status key in place and clears the `approved` stamp.
- `phax artifact decide [FLAGS] <path>` — Decides a Draft spec's or plan's open questions with the operator, in an interactive Claude Code session. The session first raises the framing questions F1–F5, then presents the open questions in document order; --question <id> presents that question alone, an open one or an arbitrated one to re-arbitrate (its previous verdict is kept in its history). The session follows the doctrine skill for the artifact's kind (phax-decide-spec or phax-decide-plan; a project copy under .claude/skills/ replaces the bundled one), with --doctrine <file> appended after it; a verdict may cite only the backticked ids that open list items in that doctrine. It resumes the artifact's headless authoring session when phax kept its id, and starts a new one otherwise, and says which.
- `phax artifact new <SUBCOMMAND>` — Parent command for creating a Draft spec or plan named from the current UTC minute: <YYMMDDHHMM>-<slug>.md for a spec, <YYMMDDHHMM>-<slug>-plan.md for a plan. The instant is captured when the command runs, never chosen or backdated. A bad slug, an existing target name, or (for a plan) a --spec that is missing or not a spec, a --spec without exactly one of --last/--not-last, or either flag without --spec all refuse with exit code 12 before anything is written.
- `phax artifact new spec [FLAGS] <slug>` — Creates a Draft spec at docs/specs/<YYMMDDHHMM>-<slug>.md, with a frontmatter-only skeleton (status, date, audience, scope). The slug must match `[a-z0-9]+(-[a-z0-9]+)*`.
- `phax artifact new plan [FLAGS] <slug>` — Creates a Draft plan at docs/plans/<YYMMDDHHMM>-<slug>-plan.md, with a frontmatter-only skeleton (status, source-spec, and completes-spec when a spec is bound). Pass --spec <path> to bind an existing spec as the plan's source-spec; the path must classify as a spec (live or archived), exist, and pass artifact validation. With --spec, pass exactly one of --last or --not-last: --last writes completes-spec: true (this plan is the spec's last, and its run completes the spec), --not-last writes completes-spec: false (more plans of the spec follow, and its run leaves the spec live). Every plan of a spec except the last says --not-last; no default is ever inferred. Without --spec, source-spec is written as null with no completes-spec, and both flags are refused. The slug must match `[a-z0-9]+(-[a-z0-9]+)*`.
- `phax artifact schema <kind>` — Prints the JSON Schema of the experimental spec document (kind spec) or plan document (kind plan), pretty-printed to stdout, so a consumer can read the contract a headless authoring session must satisfy without a model call.
- `phax artifact migrate-approvals` — Reads docs/plans/approvals.json and docs/specs/approvals.json in any released shape, writes one record file per entry under docs/plans/approvals/ and docs/specs/approvals/, deletes the ledgers, and commits exactly those paths in one commit. Exits 0 when migrated or when there is nothing to migrate; exits 12, writing nothing, on an unreadable ledger, an entry that is not a live artifact path, an uncommitted change to any path it would write, or an existing record file holding a different record.
- `phax artifact migrate-documents` — Rewrites every live spec and plan sidecar (a <name>.json directly under docs/specs/ or docs/plans/ beside its <name>.md) stamped below its document format's current shape, or written before $schema, at that shape, and re-renders its body in the current layout, keeping its frontmatter byte for byte. A spec's questions are lifted by the author's rationale marker: a question whose rationale opens with `Decided by the author on <YYYY-MM-DD>` becomes arbitrated with a lifted, unattributed verdict; every other question stays open. A plan document stamped 0.20.0 lifts with empty preamble questions and keeps its body, lineage and frontmatter as they were. A plan sidecar stamped 0.26.0 or below has each phase's testStrategy string read as test lines: one whose every line follows the line format (`- <guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`) is lifted to those lines, and one holding prose is refused, naming the phase, its first departing line and the remedy: rewrite each phase's test strategy in the line format, in the sidecar and plan.md alike, or re-author the plan, then rerun. Archived artifacts, hand-authored artifacts and approval record files are never touched.
- `phax plans <SUBCOMMAND>` — Parent command for reporting on plans: the mechanical defects of a single plan (lint), a plan laid out phase by phase with its planned files by architecture part, its test lines and the coverage of its source spec's criteria (overview), a plan's API-list cost and its fit in the subscription windows (estimate), staleness of Approved plans against their recorded approval, and cross-plan file overlap.
- `phax plans status [--apply] [--json]` — Reports every live, Approved plan's staleness against the ground it was approved against: the declared source spec's content, the plan's own content, and the files changed since the recorded baseline intersected with the plan's footprint. Each stale entry names its reasons (spec-changed, ground-changed, self-changed) with evidence; a plan with no approval record — or one whose baseline commit no longer exists — reports missing-record, which renders as stale. This is a report, not a gate: it exits 0 whether or not stale plans exist. Use --apply to flip stale-computed plans Approved -> Stale as an explicit gesture (the flip is never automatic). Use --json for machine-readable output.
- `phax plans overlap [FLAGS] <plan>…` — Reports which of two or more plans can run in parallel without a merge conflict — predicted from each plan's declared file-sets, or confirmed against a landed run's actual diff.
- `phax plans lint [--json] <plan>` — Reports every mechanical defect of a plan.md that phax can establish before a run, as findings with a severity (error or warning), a check, and the phase they concern.
- `phax plans overview [--json] <plan>` — Lays a plan out before it runs. For each phase in plan order it shows the model, effort and mode, the oracle role (an oracle phase and the phase that discharges it, or none), the planned files to create and edit grouped by architecture part, and the test lines. It ends with the coverage of the source spec's acceptance criteria: each criterion with the phases and loops whose test lines name it (`phase-02 in-phase ×2` when two lines of a phase and loop name it), then the criteria no line names. Cost is not shown; `phax plans estimate` keeps that.
- `phax plans estimate [--json] [--no-probe] <plan>` — Estimate a plan's API-list cost and whether it fits the subscription windows now. Reports P10/P50/P90 in API-list dollars for each phase and for the run, then a verdict on the Claude subscription windows left right now.
- `phax records <SUBCOMMAND>` — Manage phax run records
- `phax records init [--force]` — Configure records for this project (transcript, destination, auto-push)
- `phax records sync` — Bring the local records clone in line with its configured remote
- `phax records status` — Show pending (unpushed) records, by run and phase
- `phax records list [--run <id>]` — List records present: phase records by run, phase, and verified surfaces; authoring records by id and artifact
- `phax records explain [FLAGS] <sha>` — Explains a commit from its record. The commit is a phase commit, a declared interactive phase's commit (Phase-Id with Interactive-Phase), or a held phase's review commit, which carries Run-Id and Held-Phase and resolves to the held phase's record. The output adds the stop's lines: its mode, cause, outcome, the person who closed it, the review commit, and each recorded session with its provider, model, origin and its transcript's sha256, or the reason it is missing. A stop's record never carries the transcript itself: interactive transcripts stay in the run folder whatever records.transcript says.

<!-- END GENERATED CLI REFERENCE -->
