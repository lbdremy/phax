---
status: Draft
date: 2026-10-03
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Preflight before naming: a refused run never exists

## 1. Context

`phax run --plan <plan.md>` takes a plan through these steps before any phase work: the lifecycle-status gate, extraction (cached), the staleness gate, the short-name checks, and the `--dry-run` exit. Then the skill edit consent check runs. That check moved ahead of naming on 2026-09-24, and executePlan keeps a copy of it to guard `phax resume`. After that, phax names the run: it takes the plan's slug, bumps it to `<slug>-2`, `-3`, … when the namespace's registry or a bare run folder already holds it, warns `Run "<ns>.<slug>" already exists; using "<ns>.<slug>-2" instead.`, and prints `Run: <ns>.<name>`. Next it loads the routing and provider config (on failure: exit 2), takes the run lock, and allocates the run. Allocation writes `<stateRoot>/runs/<ns>.<name>/` (plan.md, phax-plan.json, phax.json, run-status.json in state `created`) and a registry entry. Only then does executePlan run its preflights:

- gate profile resolution: refusal is exit 3;
- required commands, checked against security.agentCommands plus the gate commands: SecurityPreflightError, exit 11;
- skill edit consent (its copy): exit 11;
- mcp.allow entries must resolve to readable files: SecurityPreflightError, exit 11;
- the records destination must have its local clone: RecordsSyncRequiredError, exit 11, remedy `phax records sync`;
- phase models and efforts against the catalog: ModelPreflightError, exit 11;
- the clean working tree: UnsafeGitStateError, exit 3. This check is fused with run-branch creation in a single step.

With telemetry enabled, executePlan emits its first step events before these checks, so they land in the run folder's semantic.jsonl. All the refusals are printed as `phax run failed: <message>`. `phax resume` reloads phax.json and the routing config live, never checks for a clean tree (it passes allow-dirty), and re-enters executePlan, which re-runs the whole preflight block.

Ground read:

- `NEXT_STEPS.md` — §"Road to 1.0.0" lists the run-before-preflight slug burn as one of two happy-path defects blocking 1.0; §"Small follow-ups" records the defect (found 2026-09-08), the -2 pairs in the local registry, and the 2026-09-24 partial fix for skill edit consent that this spec generalises.
- `src/cli/commands/run.ts` — Today's order: lifecycle gate, extraction, staleness, short-name checks, --dry-run exit, skill edit consent, then naming (ensureUniqueShortName, the rename warning, the `Run:` line), then routing load (exit 2), then the run lock and createRunFolder, then executePlan.
- `src/app/executePlan.ts` — Its preflight block runs after the run exists: telemetry step events, gate profile resolution (exit 3), required commands (SecurityPreflightError, exit 11), its copy of skill edit consent, mcp.allow, records destination (RecordsSyncRequiredError), phase models and efforts (ModelPreflightError), then prepareRunBranch for a fresh run (startIndex 0).
- `src/app/worktree.ts` — prepareRunBranch does the dirty-tree refusal (UnsafeGitStateError, exit 3, unless --allow-dirty) and then creates the run branch, in a single step.
- `src/app/runFolder.ts` — createRunFolder writes plan.md, phax-plan.json, phax.json and run-status.json (state `created`) under <stateRoot>/runs/<ns>.<name>/ and upserts the registry entry. These are the writes a refused run leaves behind today.
- `src/app/skillEditConsent.ts` — The pattern to generalise: one refusal function called by run.ts before naming and again by executePlan to guard resume.
- `src/app/recordsSync.ts` — checkRecordsRunPreflight reads only the records config and whether the local clone exists under the state root. It needs no run state.
- `src/domain/routing/preflight.ts` — preflightPhaseModels is pure: it reads the plan's phases, the routing config and the provider config.
- `src/cli/commands/resume.ts` — Resume reloads phax.json and the routing/provider config live, passes allowDirty: true (so it never checks for a clean tree), and re-enters executePlan at the next pending phase.
- `src/cli/commands/runLayers.ts` — exitCodeForError maps UnsafeGitStateError to 3, and SecurityPreflightError, SkillEditConsentError, ModelPreflightError and RecordsSyncRequiredError to 11.
- `phax.usage.kdl` — cmd run: `--allow-dirty`, and side effects listed as worktrees, commits and writes to ~/.phax/runs/. cmd resume re-enters the same execution loop. No exit-code table is published for either command.

## 2. Problem

A run that phax refuses at preflight still exists. It has a run folder, a registry entry in state `created`, a telemetry file when telemetry is on, and it holds the slug. The operator fixes the cause (runs `phax records sync`, adds a command to agentCommands, commits a stray file) and runs the same plan again. That retry is renamed `<slug>-2` with a warning, and its branch becomes `phax/<slug>-2`. In the local registry, 22 of 123 runs carry a numeric suffix, most from exactly this. The dead `created` run stays in `phax runs list` until it is pruned by hand. None of these refusals depends on the run's own state. Each needs only the plan, phax.json, the routing/provider config and the repository, so nothing forces allocation to come first. Plan lint already catches the commands and models causes ahead of time, but a refusal from any other preflight still burns the slug. NEXT_STEPS lists this as one of the two happy-path defects blocking 1.0: an `approve` → `run` sequence that leaves debris and renames its own retry is not 1.0.

## 3. Product goal

A `phax run` refused at preflight leaves no trace. phax runs every check that does not need the run's own state before it picks the name or writes anything. A refusal then has the same exit code and message as today, and nothing else happens: no run folder, no registry entry, no branch, no worktree, no records commit, no telemetry file. Fixing the cause and running the same plan again names the run with the bare slug. `phax resume` keeps re-checking whatever can have changed since the run started. A guard in the test suite stops a future preflight from quietly landing after naming again.

> A run comes into existence only once nothing that could refuse it is left to check.

## 4. Terminology

- **preflight** — A check that `phax run` or `phax resume` makes before any branch, worktree or agent work, and whose failure refuses the run with a named cause and remedy. The lifecycle, extraction and staleness gates are earlier gates. They already run before naming and are not preflights in this spec.
- **run-independent preflight** — A preflight that reads only the plan, phax.json, the routing/provider config, the flags, and the repository or state root as they are now. It never reads the run's own folder, registry entry or branch. All seven preflights listed in §1, plus the routing-config load, are run-independent.
- **naming** — Choosing the run's short name: the plan's slug, or the slug bumped to `-2`, `-3`, … when it is already held. Naming is observable as the `Run: <ns>.<name>` line and, when bumped, the rename warning.
- **allocation** — The writes that make a run exist: the run folder under <stateRoot>/runs/<ns>.<name>/, the registry entry, and from then on the run's telemetry file, branch, worktrees and records commits.
- **refusal family** — A group of preflights that share an exit code and refusal path: security (required commands, mcp.allow; exit 11), consent (skill edits; exit 11), records (exit 11), models (exit 11), working tree (exit 3), and routing config load (exit 2).
- **fresh run** — A run started by `phax run`, as opposed to one continued by `phax resume`.
- **resume re-check** — A preflight that `phax resume` repeats because its input can have changed between the run's start and the resume.

## 5. Functional requirements

### 5.1 Run-independent preflights precede naming

WHEN `phax run` starts a fresh run THE system SHALL complete every run-independent preflight (routing config load, gate profile resolution, required commands, skill edit consent, mcp.allow, records destination, phase models and efforts, clean working tree) before it names the run.

### 5.2 A refusal writes nothing

IF a run-independent preflight refuses a fresh run THEN the system SHALL exit without creating a run folder, a registry entry, a run branch, a worktree, a records commit or a run telemetry file.

### 5.3 Refusal exit code and message unchanged

IF a preflight refuses a fresh run THEN the system SHALL exit with the same exit code and print the same refusal message as it does today.

### 5.4 No naming output on refusal

IF a preflight refuses a fresh run THEN the system SHALL print neither the `Run: <ns>.<name>` line nor the rename warning.

### 5.5 First refusal unchanged

WHEN more than one preflight would refuse a fresh run THE system SHALL report the refusal that today's phax reports first, in this order: skill edit consent, routing config load, gate profile resolution, required commands, mcp.allow, records destination, phase models and efforts, clean working tree.

### 5.6 Retry gets the bare slug

WHEN a plan whose previous `phax run` was refused at preflight is run again and no other run in the namespace holds its slug THE system SHALL name the run with the plan's bare slug, without a rename warning.

### 5.7 Read-only clean-tree check before naming

WHEN `phax run` starts a fresh run without `--allow-dirty` THE system SHALL check that the working tree is clean before naming, and SHALL leave the repository unmodified.

### 5.8 Branch creation still refuses a dirty tree

IF the working tree is dirty when the run branch is about to be created and `--allow-dirty` is absent THEN the system SHALL refuse with the existing dirty-tree exit code and message and SHALL NOT create the branch, even when the earlier check passed.

### 5.9 Resume re-checks what can change

WHEN `phax resume` continues a run THE system SHALL re-run the required-commands, skill edit consent, mcp.allow, records destination and phase models and efforts preflights before any phase work for the resumed phase.

### 5.10 Order guard

The phax test suite shall fail when any fresh-run preflight refusal can be raised after the run is named or allocated.

## 6. Surface

### cli: phax run — refusal output and retry — normative

before:

    $ phax run --plan docs/plans/2609301200-foo-plan.md
    Run: phax.foo
    phax run failed: Records destination "git@github.com:acme/records.git" has no local clone at "~/.phax/records/phax". Run `phax records sync` before starting this run.
    $? = 11
    $ phax records sync
    $ phax run --plan docs/plans/2609301200-foo-plan.md
    Run "phax.foo" already exists; using "phax.foo-2" instead.
    Run: phax.foo-2
    …

after:

    $ phax run --plan docs/plans/2609301200-foo-plan.md
    phax run failed: Records destination "git@github.com:acme/records.git" has no local clone at "~/.phax/records/phax". Run `phax records sync` before starting this run.
    $? = 11
    $ phax records sync
    $ phax run --plan docs/plans/2609301200-foo-plan.md
    Run: phax.foo
    …

    Normative: the exit code and the refusal text are unchanged for every refusal family (exit 11 for security, consent, records and models; 3 for working tree and gate profile; 2 for routing config). The `Run:` line and the rename warning are absent on refusal. The retry is named with the bare slug. The record paths shown are illustrative.

### file: <stateRoot>/runs/ and <stateRoot>/registry.json after a refusal — normative

before:

    ~/.phax/runs/phax.foo/
      plan.md
      phax-plan.json
      phax.json
      run-status.json        # "state": "created"
      semantic.jsonl         # when telemetry is enabled
    ~/.phax/registry.json    # + { "namespace": "phax", "shortName": "foo", "state": "created", … }
    $ git branch --list 'phax/foo*'
      phax/foo               # only when the refusal was not the dirty tree

after:

    ~/.phax/runs/            # no phax.foo/ folder
    ~/.phax/registry.json    # unchanged
    $ git branch --list 'phax/foo*'
                             # no branch, no worktree, no records commit

### cli: phax runs list after a refusal — normative

before:

    $ phax runs list
    …
    phax.foo    created    …

after:

    $ phax runs list
    …                        # identical to the listing before the refused run

## 7. Non-goals

- Freeing names already held by runs refused before this change. That is `phax prune`, a separate spec.
- The approval-commit staleness defect (a plan whose footprint names approvals.json is stale at its own approval).
- Any change to a preflight's rules, its refusal message or its exit code, including which phases the model preflight checks on resume.
- Any CLI, flag or config change, and any persisted-format change (run-status.json, registry.json, the run folder layout).
- Resume's working-tree behaviour: `phax resume` still does not check for a clean tree.
- `--dry-run` output and behaviour, and the lifecycle, extraction and staleness gates, which already run before naming.
- Telemetry for refused runs: a refusal before naming emits no run telemetry, and no new global event is added.
- Concurrency between two simultaneous `phax run` invocations of the same plan.

## 8. Acceptance criteria

### Required-commands refusal leaves no run

Given an Approved plan whose requiredCommands include a command missing from security.agentCommands and from the gate commands, and a clean tree, when `phax run --plan <plan>` runs, then it exits 11 and prints the unchanged `Security preflight failed: the plan requires …` message; no `Run:` line is printed; and no <stateRoot>/runs/<ns>.<slug>/ folder, registry entry or `phax/<slug>` branch exists afterwards. (refs §5.1, §5.2, §5.3, §5.4)

### mcp.allow refusal leaves no run

Given phax.json with security.mcp in allowlist mode naming a file that does not exist, when `phax run --plan <plan>` runs, then it exits 11 with the unchanged `mcp.allow` refusal message, and neither a run folder nor a registry entry nor a branch is created. (refs §5.1, §5.2, §5.3)

### Records refusal, then retry with the bare slug

Given records enabled with a dedicated repo destination and no local clone, when `phax run --plan <plan>` runs, then `phax records sync` runs, then `phax run --plan <plan>` runs again, then the first run exits 11 with the unchanged `phax records sync` remedy and creates nothing; the second prints `Run: <ns>.<slug>` with no rename warning, and its branch is `phax/<slug>`. (refs §5.1, §5.2, §5.3, §5.6)

### Model preflight refusal leaves no run

Given a plan with a phase whose model id is not in the catalog, when `phax run --plan <plan>` runs, then it exits 11 with the unchanged `Model preflight failed: …` message listing the phase and its alternatives, and no run folder, registry entry or branch exists. (refs §5.1, §5.2, §5.3)

### Skill edit consent stays before naming

Given a plan with a phase that declares a `.claude/skills/**` file, when `phax run --plan <plan>` runs without `--allow-skill-edits`, then it exits 11 with the unchanged consent refusal, prints no `Run:` line, and creates no run folder or registry entry. (refs §5.1, §5.2, §5.4)

### Dirty tree refused before naming, read-only

Given a working tree with an uncommitted change and no `--allow-dirty`, when `phax run --plan <plan>` runs, then it exits 3 with the unchanged `Working tree is not clean. Commit or stash changes, or pass --allow-dirty.` message; no run folder, registry entry or `phax/<slug>` branch exists; and `git status --porcelain` output is identical before and after. (refs §5.1, §5.2, §5.3, §5.7)

### Dirty tree at branch creation still refused

Given a tree that is clean at the preflight and dirty at the moment the run branch is about to be created (simulated with a test double), with no `--allow-dirty`, when the fresh run reaches branch creation, then it exits 3 with the dirty-tree message and no `phax/<slug>` branch is created. (refs §5.8)

### Routing config failure prints no run name

Given a routing or provider config that fails to load, when `phax run --plan <plan>` runs, then it exits 2 with the unchanged `Failed to load routing config: …` message, and prints no `Run:` line and no rename warning. (refs §5.1, §5.3, §5.4)

### Nothing new in the run list or telemetry

Given telemetry enabled and any preflight that refuses, when `phax run --plan <plan>` is refused, then `phax runs list` output is identical to its output before the attempt, and no semantic.jsonl exists for the slug under <stateRoot>/runs/. (refs §5.2)

### First refusal is unchanged

Given a plan that fails both the required-commands and the model preflight, and a dirty tree, when `phax run --plan <plan>` runs, then it reports only the required-commands refusal, with exit 11. (refs §5.5)

### Resume re-checks changed inputs

Given a run created and paused after phase 1, after which an mcp.allow file is deleted (and, separately, the records clone is removed, or a phase's model provider is disabled with no permitted route), when `phax resume <name> --yes` runs, then it exits 11 with the corresponding unchanged refusal before any worktree is created for the resumed phase. (refs §5.9)

### Guard catches a preflight moved after naming

Given the order guard in place, when any fresh-run preflight is made reachable only after naming or allocation (for example, the records check moved back to after the run folder is created), then `pnpm check:full` fails, naming the preflight. (refs §5.10)

## 9. Open questions for implementation planning

### Q1 — How does the guard keep a future preflight from landing after naming?

- A static architectural test that pins the call order in run.ts (the preflight calls must appear before naming and allocation in the source) — abandons: Catching the actual regression: a new preflight added only inside executePlan's block passes this test untouched, and a refactor that keeps the behaviour but reorders text breaks it.
- Behavioural unit tests on `phax run`, one per refusal family, asserting that naming and allocation are never reached — abandons: Future preflights: a preflight added later has no test case until someone writes one, so it can still land after naming silently.
- A single shared set of fresh-run preflights, which `phax run` runs before naming and executePlan's preflight block consists of, plus a test that every refusal the set can raise is raised by `phax run` before naming — abandons: Freedom for executePlan to grow a preflight that `phax run` does not run before naming: a genuinely run-dependent or resume-only check has to be declared outside the set, explicitly.

Recommendation: A single shared set of fresh-run preflights, which `phax run` runs before naming and executePlan's preflight block consists of, plus a test that every refusal the set can raise is raised by `phax run` before naming — The defect started because a check was added where the run already existed. Only C makes the pre-naming path pick up a new preflight by construction, rather than relying on someone remembering a test or a source position. Its loss is the intended discipline: no preflight today needs the run, so a future one that does should have to say so. B's per-family tests are still written as the acceptance criteria.

### Q2 — Once the read-only clean-tree check runs before naming, does run-branch creation keep its own dirty-tree refusal?

- Keep it: the check runs twice, before naming and again when the branch is created — abandons: A complete fix: a tree that becomes dirty in the seconds between the two checks is refused after naming and still burns the slug.
- Drop it for fresh runs: only the pre-naming check remains — abandons: The guarantee that the run branch is cut from a clean tree: a file dirtied in the window is silently carried into the run.

Recommendation: Keep it: the check runs twice, before naming and again when the branch is created — The window is seconds long and rarely hit, and a slug burned in it is the old, recoverable defect. Running work from an unverified tree is a correctness loss, and `--allow-dirty` exists precisely so that it is never silent.

### Q3 — When several preflights would refuse, should the first refusal be reported (as today) or all of them at once?

- Keep reporting the first refusal, in today's order — abandons: Fixing everything in one pass: an operator with two causes needs two attempts, although retries are now free of debris.
- Collect and report every refusal in one exit — abandons: The unchanged-output contract: the message and possibly the exit code change while the CLI contract is about to freeze for 1.0.

Recommendation: Keep reporting the first refusal, in today's order — This spec removes the cost of a retry, which was what made one-at-a-time painful. Changing refusal output is out of scope by constraint and can be its own spec after 1.0.

## 10. Implementation-planning note

Settled:

- All eight run-independent checks move ahead of naming for a fresh run: routing config load, gate profile resolution, required commands, skill edit consent (already there), mcp.allow, records destination, phase models and efforts, and the clean-tree check. None of them needs the run to exist. Only the writes need the run: run-branch creation, the RunStarted transition and recording the gate profile in run-status.json, and these stay where they are.
- The clean-tree check runs before naming as a read-only check. Run-branch creation stays in executePlan and keeps its own dirty-tree refusal (Q2 default A).
- executePlan keeps its copies of required commands, skill edit consent, mcp.allow, records destination and phase models and efforts. These are the resume re-checks: phax.json, the routing/provider config, the mcp.allow files and the records clone are all read live at resume and can change after the run starts. Resume still passes allow-dirty and does not check for a clean tree.
- Refusal exit codes and messages are unchanged, including the `phax run failed: ` prefix for the refusals that printed it from executePlan. The skill edit consent refusal keeps its current bare form.
- Today's first-refusal order is preserved (R5, Q3 default A).
- No CLI, config or persisted-format change.

Left open:

- The guard mechanism: Q1 defaults to a single shared fresh-run preflight set with a test over every refusal it can raise.
- How the pre-naming preflight sequence is factored between app/ and run.ts, within the constraints below.

Constraints:

- The preflight sequence is an app/ use case reached through ports. run.ts stays a thin command layer that calls it and renders the refusal, following the skillEditConsent.ts pattern.
- Refusal error types and their exitCodeForError mapping are unchanged.
- No run lock, run telemetry layer or run folder path is acquired or built until every fresh-run preflight has passed.
- Each acceptance criterion becomes a test. AC7 and AC12 may use test doubles; the others drive `phax run` or `phax resume` against a temporary repository and state root.

## 11. Docs page

None — A behavioural fix behind an unchanged interface: commands, flags, refusal messages and exit codes stay as they are, so no user-facing page changes. The only observable difference is the absence of debris and of the `-2` rename.
