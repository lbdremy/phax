# phax

phax runs a plan through AI coding agents as a sequence of **gated phases**, and hands you a change you can review.

You write what to build (a **spec**) and how, phase by phase (a **plan**). phax runs each phase in its own Git worktree with the agent of your choice — Claude Code, OpenAI Codex or Mistral Vibe — and the phase must pass your project's gates (typecheck, tests, lint…) before the next one starts. Everything around the agent is plain code: sequencing, gates, retries, state. The agent is the only non-deterministic part.

Every phase declares the files it means to create and edit, so phax can tell you what actually happened: planned but not done, done but not planned, deleted, renamed. The agent has to justify each deviation in its handoff. You review a change that is already framed, phase by phase, instead of a pull request full of touched files.

```
spec ──approve──▶ plan ──lint, approve──▶ run: phase-01 ─gate─▶ phase-02 ─gate─▶ … ─gate─▶ review ──▶ pull request
```

## Quickstart

Install phax and its skills, then set up your repository:

```bash
npm install -g @lbdremy/phax
cd my-project
phax init                               # writes phax.json: project name, gate commands
phax skills install --target claude     # phax-spec, phax-planning and phax-cli, for your agent
```

Write a spec, then a plan, and approve each. `artifact new` creates the file with its name and status; you fill it in with your agent, which follows the `phax-spec` and `phax-planning` skills:

```bash
phax artifact new spec greet            # docs/specs/2610041200-greet.md, Draft
phax artifact approve docs/specs/2610041200-greet.md

phax artifact new plan greet --spec docs/specs/2610041200-greet.md
phax plans lint docs/plans/2610041201-greet-plan.md
phax artifact approve docs/plans/2610041201-greet-plan.md
```

Or let phax drive each authoring session from a short brief, and get a committed draft back — the spec, then the plan written from it:

```bash
phax artifact new spec greet --headless --brief spec-brief.md
phax artifact new plan greet --headless --brief plan-brief.md --spec docs/specs/2610041200-greet.md
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

**An agent.** phax drives an agent CLI that must be on your `$PATH`: `claude` (Claude Code), and optionally `codex` (OpenAI Codex) or `vibe` (Mistral Vibe). Keep `claude` installed even if you prefer another provider: phax falls back to it when the preferred one is missing or cannot meet the run's security mode.

**The skills.** phax ships the skills your agent uses to write its documents: `phax-spec`, `phax-planning` and `phax-cli`.

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

**Lifecycle.** An artifact moves through statuses: `Draft` → `Approved` → `Completed`, or `Abandoned` if the work is dropped. A plan can also be marked `Stale` when the ground it was approved on has changed (`phax plans status` tells you). `phax artifact` makes every transition and commits it; an approval records what the artifact was approved against, so phax can tell later whether it still holds. A run completes its plan, and its spec where it can, on the run's own branch, so the merge lands the code and the completion together.

**Run and phase.** `phax run` turns an approved plan into a **run**, named from the plan's title as `<namespace>.<name>`, where the namespace is your project's `name` in `phax.json`. Each **phase** runs in its own Git worktree on its own branch, `phax/<name>--phase-NN`, branched from the previous phase, so the last phase's branch carries the whole change.

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
- **`gateProfiles`** holds your checks. Each step has a `command`, a `firing` (`every-phase`, or `terminal` for the last phase only) and a `surface` that says what it verifies (`local`, `structural` or `product`). phax records each step's surface and result, and the run's summary lists the surfaces it verified. A step can also return structured findings instead of a log — see [Extend phax](#extend-phax).
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
phax artifact new plan <slug> --spec <spec path>  # docs/plans/<YYMMDDHHMM>-<slug>-plan.md
```

phax names the file from the current UTC minute and the slug, with a `Draft` status, and refuses any other name (exit 12). A plan carries its spec's slug and names it as its `source-spec`; `--spec` can be left out when a plan has no spec. Fill the file in with your agent: the `phax-spec` and `phax-planning` skills hold the formats, and point at the right sections — requirements and acceptance criteria for a spec; for each plan phase, its instructions, the files it creates and edits, its gate and its commit. [`examples/hello-world/plan.md`](examples/hello-world/plan.md) is a small worked plan.

### Let phax write them

With `--headless`, phax runs the authoring session itself from a brief: it gives the agent the skill and the document's JSON Schema, accepts a valid document as the session's only output, renders it to Markdown, keeps the document as a `.json` sidecar beside it, and commits both. A plan written this way is already extracted, so `phax run` never extracts it again.

```bash
phax artifact new spec greet --headless --brief brief.md
phax artifact new plan greet --headless --brief brief.md --spec docs/specs/2610041200-greet.md
cat brief.md | phax artifact new spec greet --headless --brief -
```

```
authoring spec greet — claude-opus-5-5 / high
created docs/specs/2610041200-greet.md (Draft, headless)
sidecar docs/specs/2610041200-greet.json
commit a1b2c3d — docs(specs): draft greet
record authoring/2610041200-greet
```

`--model` and `--effort` choose the model, before `authoring.spec|plan` in `phax.json` and the catalog's default. The last line names the session's [record](#records). It exits 5 when the session's output is not a valid document, 8 on a provider rate or usage limit, and 12 when the slug, the brief or `--spec` is wrong. `phax artifact schema spec|plan` prints the document's JSON Schema. Headless authoring is experimental: the two document formats may still change.

If you edit the Markdown of a headless document, edit its sidecar too: `phax artifact status` tells you whether the body is still the sidecar's rendering, and approving a document whose body has diverged is refused.

### Check a plan

```bash
phax plans lint docs/plans/2610041201-greet-plan.md
```

A read-only check, with no model: the plan's structure, its planned files against the working tree and against earlier phases, the commands it needs against `phax.json`, each phase's model and effort against the catalog, and the findings of your [plan auditor](#extend-phax) if you have one. It exits 1 on any error; the auditor's findings are only warnings.

### Move them through their lifecycle

| Command                         | From                                                           | To                                            |
| ------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `phax artifact approve <path>`  | `Draft`; `Stale` (plan); `Approved` again to record a revision | `Approved`                                    |
| `phax artifact stale <path>`    | `Approved` (plan)                                              | `Stale`                                       |
| `phax artifact reopen <path>`   | `Stale` (plan)                                                 | `Draft`                                       |
| `phax artifact complete <path>` | `Approved`; `Stale` (plan)                                     | `Completed`                                   |
| `phax artifact abandon <path>`  | `Draft`, `Approved`; `Stale` (plan)                            | `Abandoned`                                   |
| `phax artifact status <path>`   | any                                                            | — prints the status and the legal transitions |

Each transition rewrites the status in the file's frontmatter and commits it on its own, and refuses when the files it writes have uncommitted changes. `Completed` and `Abandoned` move the file, and its sidecar, into the folder's `archive/`. Approving writes the artifact's own approval record file, `docs/specs/approvals/<spec>.json` or `docs/plans/approvals/<plan>.json`, with the commit it was made against; completing or abandoning an artifact, or reopening a plan, deletes that file in the same commit, and no transition touches another artifact's record; approving a plan is refused while its spec's approval is missing or the spec has changed since. A run completes its own plan, and its spec where it can, on the run's branch.

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

A phase that changes nothing stops the run (exit 9). The last phase runs the gate's `terminal` steps too, then the run stops at `review_open`. Its plan, and its spec where it can, are completed on the run's branch. The run's folder is `~/.phax/runs/<namespace>.<name>/`; when the run ends, phax prints what happened and the next command to run. On a Mac, keep it awake for long runs: `caffeinate -ims phax run --plan <plan>`.

### When a run stops

```bash
phax resume <run>                     # continue from the next phase that has not committed
phax resume <run> --yes --provider-priority codex-cli,claude-code
phax reset-phase <run> [phase-id]     # throw a stuck phase's worktree away so resume starts it over
phax enter-phase <run> <phase-id>     # open that phase's agent session
phax session-info <run>               # state, phase, worktree, agent session id
phax unlock <run>                     # remove a stale lock left by a process that died
```

`resume` never re-runs a committed phase. A run stopped by a provider rate or usage limit (exit 8) or by a phase with no changes (exit 9) is meant to be resumed. A run already at review is not resumed: use `phax enter`.

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

`review-code` starts from the reconciliation and the compliance findings rather than a blank prompt; running it again resumes the session, and `--new-session` starts over. Its model is `review.code` in `phax.json`, `claude-opus-5-5` at `high` effort by default, or `--model` and `--effort`.

Two steps run on their own when a run reaches review, if `phax.json` turns them on, and can be run by hand. Neither can fail the run.

```bash
phax review-compliance <run>    # an agent checks the work against the plan, phase by phase, and writes a verdict
phax publish-pr <run>           # push the final branch and open a pull request, or reuse the open one
```

The compliance review changes nothing; its verdict goes into the pull request's description. Its model is `review.compliance`, `claude-sonnet-5-5` at `medium` by default. `publish-pr` needs a GitHub remote and an authenticated `gh`; the remote, base branch and title are set under `publish`.

### After the merge

```bash
phax ls                         # your runs; --active, --failed, --review-open, --archived, --json
phax archive <run>              # put a finished run away, keeping everything
phax prune --all --dry-run      # see what deleting your archived runs would free
phax prune <run>                # delete an archived run for good
```

`archive` moves the run's folder and its worktrees under `~/.phax/archive/<namespace>.<name>/` and keeps the name taken. It accepts a finished run (`review_open`, `completed`) whose final worktree is clean; an unfinished run or a dirty worktree needs `--force`, and a running or locked run is refused.

`prune` deletes archived runs for real: the archive folder, the worktrees' records in Git, the run's local branches, and its entry, which frees its name and its disk space. It shows what it will do first, asks in a terminal (`--yes` otherwise, `--dry-run` to only look), works on this repository's runs only, and never touches the records branch, remote branches or pull requests. A run whose branches hold commits found nowhere else is kept, unless you pass `--force`; a branch checked out somewhere keeps its run even then.

## Records

A record is what a phase leaves behind for later: on a `phax/records/v1` branch, one commit per phase, holding its manifest, its gate results and the surfaces they verified, its file reconciliation, its diff, its handoff and logs, and the agent's transcript if you keep it. A headless authoring session leaves one too. Worktrees come and go; the records stay, and they travel with a clone.

```bash
phax records init               # choose: keep transcripts, where the branch lives, push automatically
phax records status             # records not pushed yet, by run and phase
phax records sync               # bring the local records clone in line with its remote
phax records list [--run <id>]  # the records present, by run and phase
phax records explain <commit>   # a commit's record: prompt, diff, gates, handoff, transcript, usage
```

The branch can live in the same repository or in a separate one. Transcripts can hold anything the agent read, so phax refuses to keep them on a public repository's own records branch, and on one it cannot tell is private until you confirm it is (`records.destination.acknowledgedUnknownVisibility`). `records explain` takes `--prompt`, `--diff`, `--transcript` or `--gates` to print each part in full. To read records from another tool, see [Read phax files from code](#read-phax-files-from-code).

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

Three hooks let your own tools inform a run: a gate step that prints diagnostics, and two providers. A provider is a command in `phax.json`, split on spaces and run without a shell, that reads a JSON request on stdin and answers JSON on stdout.

### Diagnostics gate steps

A gate step with `"output": "diagnostics"` prints a JSON document instead of a log, and phax reads its verdict from that document rather than from its exit code:

```json
{
  "diagnostics": [
    {
      "rule": "no-cycles",
      "class": "invariant",
      "location": { "file": "src/a.ts", "line": 3 },
      "message": "…",
      "repair": "…"
    }
  ]
}
```

The step must print the document every time it runs, `{ "diagnostics": [] }` when it passes; empty or non-JSON output counts as a missing document and fails the step, even on exit 0. An `invariant` finding fails the step. A `completion` finding names the `scopes` it belongs to, and fails the step only once all of them are closed according to your scope provider; until then it is pending, shown to the agent as optional work. The failing findings, not the raw log, are what the agent is asked to fix.

### Scope provider

```json
{ "scopes": { "command": "node ./scopes.mjs" } }
```

Answers which scopes are closed, for completion findings. Before each gate that has a diagnostics step, except the last phase's (which closes every scope), phax sends the phase and every phase's planned files:

```json
{
  "phase": "phase-02",
  "phases": [
    { "id": "phase-01", "files": ["src/core/billing/port.ts"] },
    { "id": "phase-02", "files": ["src/core/billing/invoice.ts"] }
  ]
}
```

and expects `{"closed": ["<scope>", ...]}`. A completion finding with no scope provider configured, or a provider that fails, fails the gate with the reason.

### Plan auditor

```json
{ "planAuditor": { "command": "node ./audit-plan.mjs" } }
```

Reviews a plan's shape for `phax plans lint` (never during a run). It receives every phase's planned files, `{"phases": [{"id", "files"}]}` — nothing else leaves phax — and answers `{"findings": [{"message", "phases": [...]}]}`. Its findings are warnings; a provider that fails or takes more than 30 seconds becomes one warning saying why.

[`examples/hello-world/`](examples/hello-world/) has a small example of each.

## Persisted formats

Every file phax writes starts with `$schema`, naming its format and the phax release that wrote it, for example `https://docs.phax.run/schemas/run-status/0.17.0.json`. Each URL serves that format's JSON Schema, and stays up for good. Files written before 0.17.0 have no `$schema`.

| Format                                       | Format id                   | Where it lives                                             | Read it with                   | JSON Schema                                  |
| -------------------------------------------- | --------------------------- | ---------------------------------------------------------- | ------------------------------ | -------------------------------------------- |
| Run registry                                 | `registry`                  | `~/.phax/registry.json`                                    | `parseRegistry`                | `json/registry.schema.json`                  |
| Run status                                   | `run-status`                | `<run folder>/run-status.json`                             | `parseRunStatus`               | `json/run-status.schema.json`                |
| Phase status                                 | `phase-status`              | `<run folder>/<phase-id>/status.json`                      | `parsePhaseStatus`             | `json/phase-status.schema.json`              |
| phax-plan                                    | `phax-plan`                 | `<run folder>/phax-plan.json`                              | `parsePhaxPlan`                | `json/phax-plan.schema.json`                 |
| Compliance review                            | `compliance-review`         | `<run folder>/compliance-review.json`                      | `parseComplianceReview`        | `json/compliance-review.schema.json`         |
| Plan approval record                         | `plan-approval-record`      | `docs/plans/approvals/<plan>.json`                         | `parsePlanApprovalRecord`      | `json/plan-approval-record.schema.json`      |
| Spec approval record                         | `spec-approval-record`      | `docs/specs/approvals/<spec>.json`                         | `parseSpecApprovalRecord`      | `json/spec-approval-record.schema.json`      |
| Plan approvals (old ledger, read to migrate) | `plan-approvals`            | `docs/plans/approvals.json`                                | `parsePlanApprovals`           | `json/plan-approvals.schema.json`            |
| Spec approvals (old ledger, read to migrate) | `spec-approvals`            | `docs/specs/approvals.json`                                | `parseSpecApprovals`           | `json/spec-approvals.schema.json`            |
| Phase record manifest                        | `phase-record-manifest`     | `<runId>/<phaseId>/record.json` on `phax/records/v1`       | `parsePhaseRecordManifest`     | `json/phase-record-manifest.schema.json`     |
| Authoring record manifest                    | `authoring-record-manifest` | `authoring/<authoringId>/record.json` on `phax/records/v1` | `parseAuthoringRecordManifest` | `json/authoring-record-manifest.schema.json` |
| Gate attribution                             | `gate-attribution`          | `<record>/gate-attribution.json`                           | `parseGateAttribution`         | `json/gate-attribution.schema.json`          |
| File reconciliation                          | `phase-file-reconciliation` | `<record>/file-reconciliation.json`                        | `parsePhaseFileReconciliation` | `json/phase-file-reconciliation.schema.json` |
| Gate diagnostics                             | `gate-diagnostics`          | `<record>/checks-attempt-NN.diagnostics.json`              | `parseGateDiagnostics`         | `json/gate-diagnostics.schema.json`          |
| Gate pending                                 | `gate-pending`              | `<record>/checks-attempt-NN.pending.json`                  | `parseGatePending`             | `json/gate-pending.schema.json`              |
| Spec document                                | `spec-document`             | `.json` sidecar beside a headless-authored spec            | `parseSpecDocument`            | `json/spec-document.schema.json`             |
| Plan document                                | `plan-document`             | `.json` sidecar beside a headless-authored plan            | `parsePlanDocument`            | `json/plan-document.schema.json`             |
| Record manifest (union)                      | `record-manifest`           | any `record.json` on `phax/records/v1`                     | `parseRecordManifest`          | `json/record-manifest.schema.json`           |

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
| 4    | Gate failure (after the fix loop is exhausted)              |
| 5    | Agent invocation error (Claude, Vibe, or Codex)             |
| 6    | Archive blocked by a dirty worktree                         |
| 7    | Lock conflict                                               |
| 8    | Rate or usage limit hit (resumable)                         |
| 9    | Phase produced no changes (resumable)                       |
| 10   | Registry corruption                                         |
| 11   | Security or preflight refusal                               |
| 12   | Artifact lifecycle refusal                                  |

`phax prune` uses a subset of these codes: 0 when every selected run was pruned, for a `--dry-run` preview, or when there is nothing to prune; 1 when nothing was deleted (a bad selection, no project config, or a declined or missing confirmation); 3 when at least one selected run was kept; 7 when a selected run is locked.

## Environment

phax reads no environment variable for its configuration: everything is in `phax.json`, its layers and `~/.phax/`. The one variable it honours, `PHAX_E2E_RUN=1`, enables its own end-to-end tests.

## Troubleshooting

- **`claude` not found.** Install Claude Code and make sure `claude` is on your `$PATH`; `phax agent probe` lists what phax finds.
- **A gate keeps failing.** The run pauses once the fix attempts are spent. Read the attempt logs, `~/.phax/runs/<namespace>.<name>/phase-NN/checks-attempt-NN.log`, fix the cause (or raise `agent.maxFixAttempts`), then `phax resume <run>`, which runs the gate again first. To start the phase over instead, `phax reset-phase <run>` before resuming.
- **Lock conflict.** Another phax is working on that run, or one died; `phax unlock <run>` clears a stale lock.
- **The handoff is missing.** The phase ended in `handoff_failed`: `phax enter <run>` takes you back into its session.
- **A rate or usage limit.** The run stopped at exit 8 and keeps its place: `phax resume <run>` when the limit resets.
- **A plan is stale right after its approval.** A plan that lists its own record file, `docs/plans/approvals/<plan>.json`, among its files reads its own approval as a change. Leave that file out of the plan's lists. Another plan's approval affects it only when the plan lists that plan's record file.
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

Something else? `phax report <run>` opens a GitHub issue with the run's telemetry.

## CLI command reference

<!-- BEGIN GENERATED CLI REFERENCE -->

Full CLI reference: [`docs/cli/reference.md`](docs/cli/reference.md).

- `phax validate [--plan <path>]` — Validate phax.json and its user overlays without any side effects; pass --plan to also validate a phax-plan.json
- `phax unlock [--force] <short-name>` — Remove a stale run lock; use --force to remove any lock
- `phax enter <short-name>` — Attaches to the kept-open agent session in the final worktree, so you can review the agent's work, ask follow-up questions, or apply manual fixes interactively.
- `phax enter-phase <short-name> <phase-id>` — Attaches to the agent session for a specific phase worktree. Useful for inspecting intermediate state or debugging a phase that has not yet been committed to main.
- `phax session-info [--debug] <short-name>` — Prints diagnostic information about a run: its current state, active phase, worktree path, and agent session id. Read-only — no side effects.
- `phax shell <short-name>` — Opens an interactive shell in the final worktree. Useful for manually inspecting files, running tests, or executing commands outside the agent session.
- `phax path <short-name>` — Prints the absolute path to the final worktree on a single line. Useful in scripts: cd $(phax path my-run) or for piping to other tools.
- `phax open <short-name>` — Opens the final worktree in the editor configured in phax.json (or the EDITOR environment variable). Equivalent to running your editor with the worktree path as an argument.
- `phax ls [FLAGS]` — Lists runs from the local registry (~/.phax/runs/). With no filter flags, shows all runs. Use status filters to narrow output: --active (created or running), --failed, --review-open (awaiting human review), or --archived. Use --json for machine-readable output.
- `phax archive [--force] <short-name>` — Archives a run by moving its worktrees under ~/.phax/archive/<namespace>.<short-name>/ and marking it archived in the registry. Nothing is destructively deleted — every phase's working state is preserved.
- `phax prune [FLAGS] [short-name]…` — Deletes each selected archived run of the current namespace for real: its archive folder under ~/.phax/archive/<namespace>.<short-name>/, its worktree metadata in the current repository, its local branches (<branch> and <branch>--phase-NN) and, last, its registry entry — so its name and disk space come back. Select runs by name (short or <namespace>.<short-name>) or with --all; only archived runs of the current namespace can be pruned, and an unknown, non-archived or other-namespace name refuses the whole command. Never touches records on phax/records/v1, remote branches, remote-tracking refs or pull requests, and never contacts a remote.
- `phax run <FLAGS> [short-name]` — Extracts a plan from the plan.md given by --plan, creates a run entry in the registry, and executes each phase sequentially in its own Git worktree using the configured AI agent. Each phase runs its gate profile's every-phase steps after execution; the final phase also runs the profile's terminal steps. Each step's surface (local, structural, or product) is recorded per phase and the run's verified surfaces are reported at run end.
- `phax review-handoff [--allow-partial] <short-name>` — Regenerate review-handoff.md and global file reconciliation for a review_open run
- `phax publish-pr <short-name>` — Pushes the final worktree branch to the GitHub remote and creates a pull request, or reuses an existing PR for the same branch. Requires a GitHub remote and gh CLI authentication.
- `phax review-compliance <short-name>` — Runs a non-mutating plan-compliance review by invoking the AI agent with the run's handoff artifacts and the original plan. Does not modify the worktree, registry, or any files.
- `phax review-code [FLAGS] <short-name>` — Opens an interactive, pre-prompted code-review session for a review_open run by launching the AI agent in the run's worktree with the code-review prompt. The session is resumable: re-running resumes the existing session, while --new-session starts fresh. The developer takes over the session to investigate, discuss, and apply fixes.
- `phax adjust-plan <FLAGS> <plan>` — Opens an interactive, pre-prompted session to help you adjust a plan.md after a landed run has introduced drift. The session establishes which of the plan's declared files, line references, and decisions are invalidated by the landed run's actual changes, asks clarifying questions where needed, proposes concrete edits and waits for your explicit approval, and only then edits and commits the plan — all interactively within the session. The command itself mutates nothing.
- `phax init [--force] [--yes]` — Creates phax.json and phax.schema.json in the current directory. Use --force to overwrite an existing phax.json. Does not connect to any network or external service.
- `phax report [--no-gist] [short-name]` — Creates a GitHub issue from local run telemetry. By default, uploads the full log as a secret GitHub gist and links it in the issue body. Use --no-gist to inline the log directly.
- `phax completions <shell>` — Generate a shell completion script (zsh, bash, fish, nu, powershell). Requires the usage CLI.
- `phax resume [FLAGS] <short-name>` — Picks up a run from its next pending phase, re-entering the same execution loop as phax run. Prompts for confirmation before proceeding unless --yes is set.
- `phax reset-phase [FLAGS] <short-name> [phase-id]` — Reset a stuck or failed phase so phax resume re-runs it from scratch
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
- `phax artifact status <path>` — Reports an artifact's kind (spec or plan), current status, and the legal transitions from that status. For Approved specs, also reports the approval date and baseline, and whether the spec has been edited since that approval (recorded) or has no approval record (unrecorded). Also reports how the artifact was authored: interactive (no sidecar), or headless with its JSON document sidecar and whether the body is still the sidecar's rendering (in sync), differs from it (diverged — the body was edited by hand), or the sidecar is not a valid document (invalid). Frontmatter changes never count as divergence. Read-only — no side effects.
- `phax artifact approve <path>` — Transitions an artifact to Approved. Legal from Draft (both kinds) and from Stale (plans only); re-approving an already-Approved artifact re-records the approval, refreshing its timestamp and baseline — this is the correct way to record an in-place revision of a spec, not editing the date by hand. Rewrites the frontmatter status key in place.
- `phax artifact stale <path>` — Manually marks a plan Stale. Legal from Approved only — Stale has no automatic trigger (that belongs to a future lineage spec). Rewrites the frontmatter status key in place.
- `phax artifact abandon <path>` — Abandons an artifact — a terminal status distinct from Completed, for work dropped without execution. Legal from Draft or Approved (specs) or Draft, Approved, or Stale (plans).
- `phax artifact complete <path>` — Completes an artifact — a terminal status for work that ran to completion. Legal from Approved (specs) or Approved or Stale (plans).
- `phax artifact reopen <path>` — Reopens a Stale plan back to Draft, for when re-planning is needed before re-approval. Legal from Stale only. Rewrites the frontmatter status key in place.
- `phax artifact new <SUBCOMMAND>` — Parent command for creating a Draft spec or plan named from the current UTC minute: <YYMMDDHHMM>-<slug>.md for a spec, <YYMMDDHHMM>-<slug>-plan.md for a plan. The instant is captured when the command runs, never chosen or backdated. A bad slug, an existing target name, or (for a plan) a --spec that is missing or not a spec all refuse with exit code 12 before anything is written.
- `phax artifact new spec [FLAGS] <slug>` — Creates a Draft spec at docs/specs/<YYMMDDHHMM>-<slug>.md, with a frontmatter-only skeleton (status, date, audience, scope). The slug must match `[a-z0-9]+(-[a-z0-9]+)*`.
- `phax artifact new plan [FLAGS] <slug>` — Creates a Draft plan at docs/plans/<YYMMDDHHMM>-<slug>-plan.md, with a frontmatter-only skeleton (status, source-spec). Pass --spec <path> to bind an existing spec as the plan's source-spec; the path must classify as a spec (live or archived), exist, and pass artifact validation. Without --spec, source-spec is written as null. The slug must match `[a-z0-9]+(-[a-z0-9]+)*`.
- `phax artifact schema <kind>` — Prints the JSON Schema of the experimental spec document (kind spec) or plan document (kind plan), pretty-printed to stdout, so a consumer can read the contract a headless authoring session must satisfy without a model call.
- `phax artifact migrate-approvals` — Reads docs/plans/approvals.json and docs/specs/approvals.json in any released shape, writes one record file per entry under docs/plans/approvals/ and docs/specs/approvals/, deletes the ledgers, and commits exactly those paths in one commit. Exits 0 when migrated or when there is nothing to migrate; exits 12, writing nothing, on an unreadable ledger, an entry that is not a live artifact path, an uncommitted change to any path it would write, or an existing record file holding a different record.
- `phax plans <SUBCOMMAND>` — Parent command for reporting on plans: the mechanical defects of a single plan (lint), staleness of Approved plans against their recorded approval, and cross-plan file overlap.
- `phax plans status [--apply] [--json]` — Reports every live, Approved plan's staleness against the ground it was approved against: the declared source spec's content, the plan's own content, and the files changed since the recorded baseline intersected with the plan's footprint. Each stale entry names its reasons (spec-changed, ground-changed, self-changed) with evidence; a plan with no approval record — or one whose baseline commit no longer exists — reports missing-record, which renders as stale. This is a report, not a gate: it exits 0 whether or not stale plans exist. Use --apply to flip stale-computed plans Approved -> Stale as an explicit gesture (the flip is never automatic). Use --json for machine-readable output.
- `phax plans overlap [FLAGS] <plan>…` — Reports which of two or more plans can run in parallel without a merge conflict — predicted from each plan's declared file-sets, or confirmed against a landed run's actual diff.
- `phax plans lint [--json] <plan>` — Reports every mechanical defect of a plan.md that phax can establish before a run, as findings with a severity (error or warning), a check, and the phase they concern.
- `phax records <SUBCOMMAND>` — Manage phax run records
- `phax records init [--force]` — Configure records for this project (transcript, destination, auto-push)
- `phax records sync` — Bring the local records clone in line with its configured remote
- `phax records status` — Show pending (unpushed) records, by run and phase
- `phax records list [--run <id>]` — List records present: phase records by run, phase, and verified surfaces; authoring records by id and artifact
- `phax records explain [FLAGS] <sha>` — Explain a commit from its record: prompt, diff, gates and verified surfaces, handoff, transcript, usage — or, for a headless artifact commit, its authoring record

<!-- END GENERATED CLI REFERENCE -->
