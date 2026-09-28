---
status: Approved
date: 2026-09-28
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-28
  baseline: ddc1a9a
---
# Oracle-first phases behind a pluggable oracle provider

## 1. Context

phax runs a plan as chained phases. Each phase gets its own worktree and branch (`<run.branch>--phase-NN`, branched off the previous phase's branch) and its own commit. Every phase is gated by the project's single gate profile. Each step carries a `surface` (local | structural | product, attribution only), a `firing` (every-phase | terminal) and an optional `output` (log | diagnostics). A diagnostics step returns `{"diagnostics": [...]}`. Exit 0 with an empty list passes; failing diagnostics are saved as `checks-attempt-NN.diagnostics.json` and drive the same-session fix prompt. The steps that ran are recorded in `<phase>/gate-attribution.json` as {command, surface, result}.

phax already delegates judgements it cannot make to registered providers. Each one is a `{"command"}` block in `phax.json`, split on whitespace with no shell, with a JSON request on stdin and a JSON response on stdout:
- `orient` returns orientation rows.
- `scopes` returns which completion scopes are closed, before a non-terminal diagnostic gate.
- `planAuditor` returns advisory lint findings.

phax knows the plan's structure (phases, planned files, commit per phase) and nothing about what a test is.

steme's plan doctrine (roadmap-1.0-arbitration-reflexes §P3, decided 2026-09-24 and complemented 2026-09-28) prefers oracle first: when the spec shows the surface, one phase writes the tests and a later phase makes them pass. The corpus file was not readable from this session, so this spec relies on the decision as the brief quotes it. The `phax-decide-plan` skill carries the same rule as P3 and phrases it as a separate oracle-authoring phase whose files are read-only to the implementing phase.

Ground read:

- `docs/ideas/change-gates-from-the-harness.md` — The oracle-separation idea (an agent never edits what judges its work) with its run-time complement: oracle files are read-only unless a phase is oracle-authoring. This spec is its first mechanical piece, for the test-first case only.
- `src/app/gates.ts` — The gate runner. Steps run in profile order and stop at the first failure. An `output: diagnostics` step is judged by its document. A scopes-provider failure fails the gate through the fix loop. `gate-attribution.json` records {command, surface, result} for every step that ran.
- `src/schemas/gateDiagnostics.ts` — The diagnostics document {diagnostics: [{rule, class: invariant|completion, scopes?, location: {file, line?}, message, repair}]}. The oracle provider answers in this shape.
- `src/schemas/gateAttribution.ts` — GateStepResult {command, surface: local|structural|product, result: pass|fail|pending}. The surface enum is closed and shared with the run records' verifiedSurfaces.
- `src/schemas/phaxConfig.ts` — The provider blocks `orient`, `scopes` and `planAuditor` share one shape, {command}, split on whitespace with no shell. Each appears in phax.json and in the user overlay. Config decoding rejects excess properties.
- `src/schemas/phaxPlan.ts` — The extracted and persisted phase fields: id, model, effort, anchor, the three planned-file lists and commit. There is no per-phase role today.
- `src/schemas/planDocument.ts` — The headless plan document spreads the same extracted phase fields, so a new phase field reaches `phax artifact schema plan` too.
- `src/app/lintPlan.ts` — The `phax plans lint` checks are structure, files, commands, models and advisory. A finding is {severity, check, phase, message}, and any error exits 1.
- `src/domain/plan/lintRender.ts` — The lint output is a header `<plan>: N errors, M warnings`, then one `severity  check  phase  message` row per finding.
- `src/domain/plan/projection.ts` — The plan projection sent to `scopes` and `planAuditor`. A phase's files are its planned files to create and edit, deduplicated, with optional files excluded.
- `src/app/resetPhase.ts` — `reset-phase` refuses when a later phase is committed. Otherwise it archives the phase folder and removes the phase's worktree and branch.
- `src/cli/commands/runLayers.ts` — The exit families: 2 plan/config validation, 3 unsafe git, 4 gate failed, 5 agent, 7 lock, 8 limits, 11 security, 12 artifact/approval, 1 otherwise.
- `README.md` — The sections §Configure (surface, firing, output: diagnostics, completion vs invariant), §Scope provider, §Plan auditor, §Schema upgrade, §Run (each phase on its own chained branch `<run.branch>--phase-NN`) and §Resume.
- `.claude/skills/phax-planning/SKILL.md` — The per-phase field set and the bold `**Recommended model:**` / `**Recommended effort:**` lines read by the deterministic parser.
- `.claude/skills/phax-decide-plan/SKILL.md` — P3: oracle first when the surface is shown, with the oracles listed as read-only for the implementing phase. A wrong oracle pauses the run and goes back to the spec.
- `docs/specs/2609250823-headless-review.md` — A Draft. Its §5.44 and Q5 refuse oracle files in an appended review plan using a built-in path convention, until the oracle-separation lint exists.
- `NEXT_STEPS.md` — Road to 1.0.0. The CLI and config contracts are about to freeze, so changes must be additive.

## 2. Problem

An oracle-first plan cannot pass phax's gates today.

The gate runs the ordinary test command at every phase, so the oracle phase is red by construction:
- Its new tests fail because the code does not exist yet.
- Old tests edited to state the new behaviour fail too.

Those changes, plus the tests it deletes on purpose, are exactly what the oracle phase exists to produce. They are the arbitration a human reads like a spec before any code exists. The only way through today is the one plans already take: keep test and code in the same phase. That gives up the separation P3 asks for, because the agent that writes the code also writes, and can quietly weaken, what judges it.

The implementing phase has the opposite problem. Nothing stops it from 'fixing' a red oracle by editing its assertion, deleting it, or turning it into a skip. Plain read-only files cannot fix this, because making the oracles live requires at least one edit: removing whatever kept them green while red.

phax also cannot learn this per test framework. Vitest, pytest and every other runner mark expected failures differently, and phax's contract is to stay framework-agnostic and delegate such judgement to a provider.

## 3. Product goal

A plan can declare an oracle phase and the later phase that discharges it.

In the oracle phase, every added or modified test carries its framework's own expected-failure marker (Vitest `test.fails`, pytest `xfail(strict=True)`, …). The ordinary test command stays green, and the runner itself turns a vacuous oracle (one that already passes) red.

In the discharging phase, every marker must be gone, and the only change allowed to the oracle files since the oracle phase's commit is removing those markers.

phax does not check any of this itself. At the gate of those two phases it asks a registered `oracles` provider for a verdict, in the diagnostics shape it already understands, and treats the answer like any other diagnostics step. An oracle that was red for the wrong reason cannot be discharged: the runner keeps it red once its marker goes, and the provider refuses any other edit. The fix loop then exhausts and the run pauses on what is a spec disagreement, not a bug.

The first provider is steme's `steme oracles` (a separate steme-lab spec, not built yet). Until it ships, no phax or steme-lab plan declares an oracle phase, and plans keep test and code in one phase as today.

> phax knows which phase authors the oracles and which phase discharges them; only the provider knows what an oracle is.

## 4. Terminology

- **Oracle** — A test that states the behaviour the code must have and judges the phase that implements it. In this spec, only tests: matrices, fixtures and other non-test oracles are out of scope.
- **Expected-failure marker** — A test framework's own annotation for a test that must fail (Vitest `test.fails`, pytest `xfail(strict=True)`). A marked test that fails passes the run, and a marked test that passes fails it. phax never names, detects or parses a marker.
- **Oracle phase** — A plan phase declared to author oracles. Every test it adds or modifies carries an expected-failure marker, and it may delete tests.
- **Discharging phase** — The one later phase that makes an oracle phase's oracles live. It removes every marker and makes the implementation satisfy the oracles. It is the next phase unless the declaration names another.
- **Oracle pair** — An oracle phase together with its discharging phase.
- **Oracle files** — The files an oracle phase lists in its declaration: a subset of its planned files to create and to edit. Only these are sent to the provider and guarded between the pair. The oracle phase's other planned files (stubs, fixtures the tests compile against) are ordinary files.
- **Base commit** — The commit the oracle phase's branch started from: the previous phase's commit, or the run-start commit for phase-01.
- **Oracle commit** — The commit the oracle phase produced: the tip of its phase branch.
- **Proved-minimal edit** — A change to the oracle files, from the oracle commit to the discharging phase's working tree, that consists only of removing expected-failure markers. No assertion is changed, no test is deleted, and no skip or todo replaces a marker. The provider proves this; phax does not.
- **Oracle provider** — The command registered as `oracles.command` in `phax.json`. It returns the verdict for an oracle pair's gate as a diagnostics document.
- **Oracle step** — The gate step phax appends after every configured step at the gate of an oracle phase or a discharging phase. It runs the oracle provider.

## 5. Functional requirements

### 5.1 Declaring an oracle phase

The plan format SHALL let a phase declare itself an oracle phase, list its oracle files, and optionally name its discharging phase. A declaration that names none SHALL designate the next phase in plan order.

### 5.2 The resolved pair in the structured plan

WHEN phax extracts a plan.md or decodes a plan document THE system SHALL record each phase's `oracle` field in `phax-plan.json` and in the plan document: `{ "dischargedBy": "<phase id>", "files": ["<path>", …] }`, with the discharging phase resolved and the oracle files in declaration order, for an oracle phase, and `null` for every other phase.

### 5.3 Lint: a discharging phase that exists and comes after

IF an oracle phase's discharging phase is absent from the plan or does not come after the oracle phase THEN `phax plans lint` SHALL report an error on the `oracles` check, naming the oracle phase and the discharging phase it resolved to.

### 5.4 Lint: one role per phase, one-to-one pairs

IF a phase is both an oracle phase and a discharging phase, or is the discharging phase of more than one oracle phase, THEN `phax plans lint` SHALL report an error on the `oracles` check naming that phase.

### 5.5 Lint: an oracle phase lists oracle files

IF an oracle phase's declaration lists no oracle file THEN `phax plans lint` SHALL report an error on the `oracles` check naming that phase.

### 5.6 Lint: oracle files are planned files of the oracle phase

IF an oracle phase lists an oracle file that is not among its own planned files to create or to edit THEN `phax plans lint` SHALL report an error on the `oracles` check naming the phase and the file.

### 5.7 Lint: no oracle file planned between the pair

IF a phase strictly between an oracle phase and its discharging phase names one of that pair's oracle files in any of its three planned-file lists THEN `phax plans lint` SHALL report an error on the `oracles` check, naming the intervening phase, the file and the oracle phase.

### 5.8 Lint: an oracle phase needs a provider

IF a plan declares an oracle phase and no `oracles` provider is registered in the resolved configuration THEN `phax plans lint` SHALL report an error on the `oracles` check naming the oracle phase and `phax.json`.

### 5.9 Run and resume refuse an ill-formed pair

IF `phax run` or `phax resume` is given a plan that any `oracles` lint rule would report as an error THEN it SHALL refuse in the plan/config validation family (exit 2) before any phase starts, naming the first such error, creating no worktree and leaving any existing run's state unchanged.

### 5.10 The oracles provider block

The system SHALL accept an optional `oracles` block containing exactly one non-empty `command` string in `phax.json` and in both user configuration layers, with the highest present layer winning, and SHALL reject any other key inside it.

### 5.11 Schema upgrade describes the block

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` and a `phax.user.schema.json` that both describe the `oracles` block and summarize the provider contract in its description.

### 5.12 The oracle step at the oracle phase

WHEN a gate attempt of an oracle phase reaches the end of its configured steps with all of them passing THE system SHALL run the oracle provider with an `authored` request as that gate's last step.

### 5.13 The oracle step at the discharging phase

WHEN a gate attempt of a discharging phase reaches the end of its configured steps with all of them passing THE system SHALL run the oracle provider with a `discharged` request as that gate's last step.

### 5.14 No oracle step anywhere else

The system SHALL never run the oracle provider outside the gate of an oracle phase or a discharging phase, including from `phax plans lint`, `phax validate` or any other phase's gate.

### 5.15 The request

The system SHALL send the provider exactly these fields: `mode` (`authored` or `discharged`), the gated `phase`, the `oraclePhase`, the full `base` commit, the oracle `files`, and, in `discharged` mode only, the full `oracleCommit`.

### 5.16 The spawn contract

The system SHALL run the provider in the gated phase's worktree, as it stands before the phase commit, with the command string split on whitespace and no shell, and the request as JSON on stdin.

### 5.17 The verdict

The system SHALL judge the oracle step's stdout and exit code by the verdict and scheduling rules of an `output: "diagnostics"` gate step.

### 5.18 Failing diagnostics drive the fix loop

WHEN the oracle step fails with diagnostics THE system SHALL persist them as the attempt's diagnostics document and put them in the phase's fix prompt, as for any diagnostics step.

### 5.19 Provider errors and timeout

IF the oracle provider cannot be spawned, outruns its time cap, returns no decodable diagnostics document, or exits non-zero with an empty list THEN the system SHALL fail the oracle step as a provider error and name the reason in the attempt log.

### 5.20 An undischargeable oracle pauses the run

WHEN an oracle or discharging phase exhausts its fix loop on a red gate THE system SHALL stop the run as a gate failure (exit 4), resumable at that phase.

### 5.21 Attribution of the oracle step

WHEN the oracle step runs THE system SHALL record it in the phase's `gate-attribution.json` as the last step, with the `oracles.command` string as its command, `oracle` as its surface and its pass, fail or pending result, and SHALL carry the `oracle` surface into the run records and the run summary like any other surface.

### 5.22 The oracle surface is reserved

IF a configured gate step declares the `oracle` surface THEN `phax validate` and every command that loads the configuration SHALL refuse it in the plan/config validation family (exit 2), naming the step: only the oracle step carries that surface.

### 5.23 Oracle pairs in the review handoff

The system SHALL list every oracle pair in the run's review handoff with its oracle phase, its discharging phase and the result of each side's last oracle step.

### 5.24 Oracle role in the records

WHEN `phax records explain` resolves the commit of an oracle phase or a discharging phase THE system SHALL name that phase's oracle role, its counterpart phase and its oracle-step result.

### 5.25 The agent is told its role

The system SHALL state in the prompt of an oracle phase and of a discharging phase the phase's oracle role, its counterpart phase and the oracle files, in a fixed wording that names no test framework.

### 5.26 Discharge edits are planned edits

WHEN reconciling the files a discharging phase touched THE system SHALL count an edit to one of its pair's oracle files as a planned edit.

### 5.27 Discharge always judges the current oracle commit

WHEN a discharging phase's gate runs after a resume, a reset or a re-run THE system SHALL name in the `discharged` request the oracle phase's current commit and base commit.

### 5.28 Reset the discharge before its oracles

IF `phax reset-phase` targets an oracle phase whose discharging phase is no longer pending THEN it SHALL refuse, naming the discharging phase to reset first, and change nothing.

### 5.29 Nothing changes without an oracle phase

WHILE a plan declares no oracle phase THE system SHALL extract, lint, run, resume, reset and record it with the same findings, prompts, gate steps, attribution and exit codes as before this change, whether or not an `oracles` provider is registered.

### 5.30 No test-framework knowledge in phax

The system SHALL neither read the content of any oracle file nor add, remove, reorder or alter any configured gate step in order to judge an oracle.

## 6. Surface

### file: plan.md — oracle phase declaration — indicative

before:

    ## phase-02 — Prune oracles  {#phase-02-prune-oracles}

    **Recommended model:** claude-sonnet-5
    **Recommended effort:** medium

after:

    ## phase-02 — Prune oracles  {#phase-02-prune-oracles}

    **Recommended model:** claude-sonnet-5
    **Recommended effort:** medium
    **Oracle phase:** yes                       # discharged by the next phase (phase-03)
    **Oracle files:** tests/prune.test.ts, tests/archive.test.ts

    # or, naming the discharging phase:
    **Oracle phase:** discharged by phase-04
    **Oracle files:** tests/prune.test.ts, tests/archive.test.ts

    # normative: the declaration sits on the oracle phase only, in the header paragraph, and defaults to the next phase (Q1); it lists the oracle files, a subset of the phase's planned files (Q5). Indicative: the exact spelling of the line.

### file: phax-plan.json — per-phase oracle field — normative

before:

    { "id": "phase-02", "title": "Prune oracles", "model": "claude-sonnet-5", "effort": "medium",
      "planMarkdownAnchor": "phase-02-prune-oracles",
      "plannedFilesToCreate": ["tests/prune.test.ts"], "plannedFilesToEdit": ["tests/archive.test.ts"],
      "optionalFilesToEdit": [], "commit": { "subject": "test(prune): oracles for phax prune", "body": "…" } }

after:

    { "id": "phase-02", …same fields…, "oracle": { "dischargedBy": "phase-03", "files": ["tests/prune.test.ts", "tests/archive.test.ts"] } }
    { "id": "phase-03", …same fields…, "oracle": null }

    # `oracle` is required on every phase: null for an ordinary or discharging phase, and always resolved (never "next") on an oracle phase.

### file: plan document (`phax artifact schema plan`) — per-phase oracle field — normative

before:

    "phases": [{ "id": "phase-02", "model": …, "plannedFilesToCreate": […], …, "expectedHandoff": "…" }]

after:

    "phases": [{ "id": "phase-02", "model": …, "plannedFilesToCreate": […], …, "oracle": { "dischargedBy": "phase-03", "files": ["tests/prune.test.ts", "tests/archive.test.ts"] }, "expectedHandoff": "…" }]

    # Same field and shape as phax-plan.json. It renders to the plan.md declaration line and projects unchanged into the extraction cache seed.

### config: phax.json `oracles` — normative

before:

    "scopes": { "command": "node ./scopes.mjs" },
    "planAuditor": { "command": "node ./audit-plan.mjs" }

after:

    "scopes": { "command": "node ./scopes.mjs" },
    "planAuditor": { "command": "node ./audit-plan.mjs" },
    "oracles": { "command": "steme oracles" }

    # Optional. Accepted in phax.json, ~/.phax/config.json and phax.local.json (highest layer wins). Any other key inside `oracles` is rejected.

### api: oracle provider request — authored — normative

    $ steme oracles            # cwd: ~/.phax/worktrees/prune/phase-02, uncommitted phase work in place
    stdin:
    {
      "mode": "authored",
      "phase": "phase-02",
      "oraclePhase": "phase-02",
      "base": "3f2a91c0d6e84b1f9a7c2e5d8b0a4f6c1e3d7b92",
      "files": ["tests/prune.test.ts", "tests/archive.test.ts"]
    }

    # The provider proves: every test added or modified since `base` in `files` carries an expected-failure marker (deletions are allowed).

### api: oracle provider request — discharged — normative

    $ steme oracles            # cwd: ~/.phax/worktrees/prune/phase-03, uncommitted phase work in place
    stdin:
    {
      "mode": "discharged",
      "phase": "phase-03",
      "oraclePhase": "phase-02",
      "base": "3f2a91c0d6e84b1f9a7c2e5d8b0a4f6c1e3d7b92",
      "oracleCommit": "8be04d71a2c94f3e6b0d5a7c9e1f2b3a4d6c8e05",
      "files": ["tests/prune.test.ts", "tests/archive.test.ts"]
    }

    # The provider proves: no marker is left in `files`, and the only change since `oracleCommit` is marker removal (proved-minimal edit).

### api: oracle provider response — normative

    pass — exit 0:
    { "diagnostics": [] }

    fail — any exit code:
    { "diagnostics": [
      { "rule": "oracles/assertion-changed", "class": "invariant",
        "location": { "file": "tests/prune.test.ts", "line": 42 },
        "message": "expect(removed).toEqual(['a']) became toEqual([]) since the oracle commit",
        "repair": "restore the oracle's assertion and change the implementation; if the oracle is wrong, stop — it is a spec question" } ] }

    # The document shape and verdict rules are exactly those of `output: "diagnostics"`. Rule ids and wording are the provider's own (indicative).
    # Provider error: spawn failure, over the 120 s cap (value indicative), non-JSON or schema-invalid stdout, or non-zero exit with an empty list.

### cli: phax plans lint — `oracles` check — normative

before:

    docs/plans/2609281200-prune-plan.md: 0 errors, 0 warnings

after:

    $ phax plans lint docs/plans/2609281200-prune-plan.md
    docs/plans/2609281200-prune-plan.md: 4 errors, 0 warnings
    error    oracles    phase-04  oracle phase is discharged by phase-04's next phase, which does not exist
    error    oracles    phase-02  oracle phase is discharged by phase-01, which does not come after it
    error    oracles    phase-03  plans tests/prune.test.ts, an oracle file of phase-02, before phase-04 discharges it
    error    oracles    phase-02  oracle phase declared but no "oracles" provider is registered in phax.json
    $? = 1

    # normative: the check name `oracles`, severity error, the phase column, exit 1. Indicative: message wording.

### cli: phax run / phax resume — refusal — normative

    $ phax run --plan docs/plans/2609281200-prune-plan.md
    ✗ plan refused: phase-02 is an oracle phase but no "oracles" provider is registered in phax.json
    $? = 2

    # normative: exit 2, no worktree created, an existing run's state unchanged. Indicative: wording.

### cli: phax schema upgrade — normative

before:

    $ phax schema upgrade
    Updated /repo/phax.schema.json
    Updated /repo/phax.user.schema.json

after:

    $ phax schema upgrade
    Updated /repo/phax.schema.json
    Updated /repo/phax.user.schema.json

    # Output unchanged. Both files now carry properties.oracles = { command: non-empty string } with a description summarizing the provider contract (indicative wording).

### file: <run>/phase-NN/gate-attribution.json — normative

before:

    { "phase": "phase-03", "steps": [
      { "command": "pnpm typecheck", "surface": "local", "result": "pass" },
      { "command": "pnpm test:unit", "surface": "local", "result": "pass" } ] }

after:

    { "phase": "phase-03", "steps": [
      { "command": "pnpm typecheck", "surface": "local", "result": "pass" },
      { "command": "pnpm test:unit", "surface": "local", "result": "pass" },
      { "command": "steme oracles", "surface": "oracle", "result": "fail" } ] }

    # The same file shape. The oracle step is always last and present only on an oracle or discharging phase.

### file: <run>/phase-NN/checks-attempt-NN.log — indicative

before:

    $ pnpm test:unit
    …
    exit 0

after:

    $ pnpm test:unit
    …
    exit 0

    $ steme oracles
    stdin: {"mode":"discharged","phase":"phase-03","oraclePhase":"phase-02",…}
    {"diagnostics":[…]}
    exit 1

### file: <run>/review-handoff.md — oracle pairs — indicative

    ## Oracle pairs

    | Oracle phase | Discharged by | Authored | Discharged |
    | ------------ | ------------- | -------- | ---------- |
    | phase-02     | phase-03      | pass     | pass       |

    # Omitted entirely when the plan declares no oracle phase.

### cli: phax records explain — indicative

before:

    phase-03  committed  surfaces: local, structural

after:

    phase-03  committed  surfaces: local, structural, oracle
      oracle: discharges phase-02 — steme oracles: pass

### cli: phax reset-phase — refusal on an oracle phase — indicative

    $ phax reset-phase prune phase-02
    ✗ Cannot reset "phase-02" of run "prune": its discharging phase "phase-03" is failed — reset phase-03 first.
    $? = 1

### internal: phase prompt — oracle role paragraph — indicative

    Oracle phase: This phase authors the oracles that phase-03 will discharge. In the oracle files (tests/prune.test.ts, tests/archive.test.ts), every test you add or modify must carry your test framework's expected-failure marker, so the test command stays green. You may delete tests. The oracle provider checks this at the gate.

    Discharging phase: This phase discharges the oracles phase-02 authored. In the oracle files, the only change allowed is removing every expected-failure marker. Make the implementation satisfy the oracles as written. If an oracle cannot pass unchanged, stop and say so in the handoff: that is a spec question, not a bug to work around.

## 7. Non-goals

- A generic oracle concept for non-test oracles: disposition matrices, fixtures and golden files are not covered.
- Read-only enforcement of oracle files at the file-system or sandbox level. The discharging phase may write them, and the provider judges the result.
- The full change-gates lint from docs/ideas/change-gates-from-the-harness.md: refusing a phase that plans both a file and its oracle, the per-phase diff budget, and deriving oracles from `scopes`.
- Any phax knowledge of test frameworks, markers or test-file conventions. phax adds no built-in provider and no fallback check when none is registered.
- Several discharging phases for one oracle phase, one phase discharging several oracle phases, and a phase that is both roles (see Q2).
- Changing the headless-review spec. Its §9 Q5 decision (no oracle-file refusal in `--append`) stays as written, and oracle declarations inside appended review plans are out of scope here.
- A command to amend a wrong oracle in place. Resolving the spec disagreement uses existing tooling: reset the pair, or abandon the run and revise the spec and plan.
- Using oracle phases in phax's own plans or in steme-lab's plans before steme ships its `oracles` provider.
- The steme `oracles` provider itself. It is specified in steme-lab.

## 8. Acceptance criteria

### An oracle phase defaults to the next phase

Given a plan whose phase-02 header carries the oracle-phase declaration without naming a discharging phase, followed by phase-03 and the oracle files tests/prune.test.ts and tests/archive.test.ts, when the plan is extracted by `phax run --plan <plan> --dry-run`, then phax-plan.json gives phase-02 `"oracle": { "dischargedBy": "phase-03", "files": ["tests/prune.test.ts", "tests/archive.test.ts"] }` and every other phase `"oracle": null`. (refs §5.1, §5.2)

### An explicit discharging phase is kept

Given a four-phase plan whose phase-02 declares itself discharged by phase-04, when the plan is extracted, then phax-plan.json gives phase-02 `"oracle": { "dischargedBy": "phase-04", "files": […] }` with its declared oracle files and phases 01, 03 and 04 `"oracle": null`. (refs §5.1, §5.2)

### The plan document carries the same field

Given a headless plan document whose phase-02 has `"oracle": { "dischargedBy": "phase-03", "files": ["tests/prune.test.ts"] }` and whose other phases have `"oracle": null`, when it is rendered and then linted, then the rendered plan.md carries the declaration and oracle-files lines on phase-02 only, the projected extraction equals the document's phases field for field, and a document missing `oracle` on any phase is rejected against `phax artifact schema plan`. (refs §5.2)

### Lint rejects a missing or earlier discharging phase

Given in turn, a plan whose last phase is an oracle phase with no named discharging phase, and a plan whose phase-02 is declared discharged by phase-01, when `phax plans lint` runs on each, then each exits 1 with an `error` row on the `oracles` check naming the oracle phase and the resolved discharging phase. (refs §5.3)

### Lint rejects overlapping roles

Given in turn, a plan where phase-03 is both discharged by phase-04 and the discharging phase of phase-02, and a plan where phase-01 and phase-02 are both discharged by phase-03, when `phax plans lint` runs on each, then each exits 1 with an `error` row on the `oracles` check naming phase-03. (refs §5.4)

### Lint rejects an oracle phase that lists no oracle file

Given an oracle phase whose declaration lists no oracle file, when `phax plans lint` runs, then it exits 1 with an `error` row on the `oracles` check naming that phase. (refs §5.5)

### Lint rejects an oracle file the phase does not plan

Given an oracle phase that plans tests/prune.test.ts and src/prune.ts (a stub) and lists tests/prune.test.ts and tests/other.test.ts as oracle files, when `phax plans lint` runs, then it exits 1 with one `error` row on the `oracles` check naming the phase and tests/other.test.ts, and src/prune.ts is not treated as an oracle file. (refs §5.6)

### Lint rejects an oracle file planned between the pair

Given phase-02 is an oracle phase discharged by phase-04 and plans `tests/prune.test.ts`, and phase-03 lists `tests/prune.test.ts` as an optional file, when `phax plans lint` runs, then it exits 1 with an `error` row on the `oracles` check for phase-03 naming `tests/prune.test.ts` and phase-02; the same plan with the file moved to phase-05 reports no `oracles` finding. (refs §5.7)

### An oracle phase needs a registered provider

Given a well-formed oracle pair, first with no `oracles` block in any configuration layer, then with `"oracles": { "command": "./fake-oracles" }`, when `phax plans lint` runs in each configuration, then the first exits 1 with an `oracles` error naming the oracle phase and `phax.json`; the second reports no `oracles` finding, and `./fake-oracles` is never spawned. (refs §5.8, §5.14)

### Run and resume refuse before any phase

Given a plan whose oracle phase has no registered provider, and separately a failed run of a well-formed oracle plan whose `oracles` block has since been removed, when `phax run --plan <plan>` and `phax resume <run> --yes` run, then both exit 2 naming the `oracles` error; no worktree or phase branch is created, and the failed run's state and last error are unchanged. (refs §5.9)

### The oracles block is strictly decoded

Given three phax.json variants: `"oracles": { "command": "steme oracles" }`, `"oracles": { "command": "steme oracles", "timeout": 60 }` and `"oracles": { "command": "" }`, plus a phax.local.json overriding the command, when `phax validate` runs on each, then the first passes and the local command is the one used; the second fails naming `timeout`, and the third fails naming `command`. (refs §5.10)

### Schema upgrade describes the block

Given a repo whose phax.schema.json predates this change, when `phax schema upgrade` runs, then it prints `Updated …/phax.schema.json` and `Updated …/phax.user.schema.json`, and both files define `oracles` with a required non-empty `command` and a description. (refs §5.11)

### The oracle phase is judged in authored mode

Given a three-phase plan with an oracle pair phase-02 → phase-03, a two-step gate profile, and a fake provider that records its stdin and cwd and returns `{"diagnostics": []}`, when phase-02's gate runs, then the provider is spawned once, after both configured steps pass, in phase-02's worktree before its commit, with stdin equal to `{"mode":"authored","phase":"phase-02","oraclePhase":"phase-02","base":<phase-01 commit>,"files":<phase-02 planned create+edit files>}` and no `oracleCommit` key. (refs §5.12, §5.15, §5.16)

### The discharging phase is judged in discharged mode

Given the same run after phase-02 committed, when phase-03's gate runs, then the provider receives `mode` `discharged`, `phase` `phase-03`, `oraclePhase` `phase-02`, `base` equal to phase-01's commit, `oracleCommit` equal to the tip of `<run.branch>--phase-02`, and the same `files`. (refs §5.13, §5.15)

### No oracle step elsewhere

Given a five-phase plan whose only pair is phase-02 → phase-04, with a provider that logs each call, when the run completes, then the provider was called only at the gates of phase-02 and phase-04, never from phase-01, phase-03 or phase-05, and never by `phax validate --plan` or `phax plans lint`. (refs §5.14)

### The oracle step waits for a green profile

Given an oracle phase whose configured test step exits non-zero on its first attempt, when that gate attempt runs, then the provider is not spawned on that attempt, and the attribution records the failing test step as the last step. (refs §5.12, §5.17)

### A passing verdict is attributed

Given a provider that exits 0 with `{"diagnostics": []}`, when the oracle or discharging phase's gate passes, then `gate-attribution.json` ends with `{ "command": "<oracles.command>", "surface": "oracle", "result": "pass" }`, and the phase commits. (refs §5.17, §5.21)

### Failing diagnostics drive the fix loop

Given a provider that returns one invariant diagnostic on the first attempt and an empty list on the second, with `maxFixAttempts` 1, when the discharging phase's gate runs, then `checks-attempt-01.diagnostics.json` holds that diagnostic, the fix prompt contains its message and repair, the provider is queried again on attempt 2, and the phase passes. (refs §5.18, §5.17, §5.13)

### Provider errors fail the step

Given in turn, a provider command that does not exist, one that prints non-JSON, one that exits 3 with `{"diagnostics": []}`, and one that sleeps past the time cap, when the oracle phase's gate runs with each, then the oracle step is recorded `fail` in each case and the attempt log names the reason (spawn failure, invalid JSON, non-zero exit with no diagnostics, timeout). (refs §5.19, §5.21)

### An undischargeable oracle pauses the run

Given a discharging phase whose provider returns an `invariant` diagnostic on every attempt, when the fix loop exhausts, then `phax run` exits 4, the run is `failed` at the discharging phase, and `phax resume <run>` re-runs that phase's gate with a `discharged` request naming the same `oracleCommit`. (refs §5.20, §5.27)

### The review handoff lists the pair

Given a run with one oracle pair, both of whose sides passed, when the run reaches `review_open`, then `review-handoff.md` lists phase-02, phase-03 and a pass result for each side, and a run of a plan with no oracle phase has no such section. (refs §5.23)

### Records explain names the role

Given a completed run with records enabled and one oracle pair, when `phax records explain` is given the commits of phase-02 and of phase-03 in turn, then the first names phase-02 as the oracle phase discharged by phase-03 with its oracle-step result, and the second names phase-03 as discharging phase-02 with its result. (refs §5.24)

### The prompt states the role without naming a framework

Given the same oracle plan run in a TypeScript/Vitest project and in a Python/pytest project, when the prompts of phase-02 and phase-03 are built, then each prompt carries its role paragraph naming the counterpart phase and the oracle files, and the paragraphs are identical across the two projects apart from those names. (refs §5.25)

### Marker removal is not an unplanned edit

Given a discharging phase that does not list the oracle files in its own planned edits and edits them to remove markers, when its files are reconciled, then `file-reconciliation.json` reports no unplanned edit for those oracle files. (refs §5.26)

### Reset the discharge first

Given a run failed at discharging phase-03, whose oracle phase-02 is committed, when `phax reset-phase <run> phase-02` runs, then `phax reset-phase <run> phase-03` followed by `phax reset-phase <run> phase-02` and `phax resume <run> --yes`, then the first reset refuses naming phase-03 and changes nothing; after the two resets the resume re-runs phase-02, and phase-03's `discharged` request names phase-02's new commit as `oracleCommit`. (refs §5.28, §5.27)

### Plans without oracle phases are unchanged

Given a plan with no oracle declaration, run once with an `oracles` provider registered and once without, when `phax plans lint`, `phax run` and `phax records explain` run, then both runs produce the same lint findings, prompts, `gate-attribution.json` steps and exit codes, with `"oracle": null` on every phase, no oracle-step row, and the provider never spawned. (refs §5.29, §5.14)

### phax neither reads oracles nor rewrites the gate

Given an oracle pair run with a filesystem port that records every read, and a gate profile of three steps, when both phases' gates run, then no oracle file path is read by phax itself, and each phase's attribution lists the three configured steps unchanged and in order, followed only by the oracle step. (refs §5.30, §5.21)

### A configured step cannot claim the oracle surface

Given a phax.json gate profile with a step `{ "command": "pnpm test", "surface": "oracle", "firing": "every-phase" }`, when `phax validate` runs, then `phax run --plan <plan>`, then both exit 2 naming the step and the reserved `oracle` surface, and no run is created. (refs §5.22)

## 9. Open questions for implementation planning

### Q1 — What is the plan syntax for the oracle declaration?

- A bold header line on the oracle phase, `**Oracle phase:** yes` or `**Oracle phase:** discharged by phase-NN`, beside Recommended model/effort — abandons: Seeing the role in the discharging phase's own section: it is derived, and shown only by lint, the prompt and the handoff
- A bold line on the discharging phase, `**Discharges oracles of:** phase-NN` — abandons: The next-phase default the brief decided, and any mark on the oracle phase itself, which is where the agent writes the oracles
- An `### Oracle role` subsection on both phases — abandons: A single source for the pair: it is declared twice, and lint needs one more rule to check that the halves agree

Recommendation: A bold header line on the oracle phase, `**Oracle phase:** yes` or `**Oracle phase:** discharged by phase-NN`, beside Recommended model/effort — Decided by the author on 2026-09-28, as recommended. Losing the discharge-side mark is acceptable: phax derives it and shows it in the prompt, lint and handoff. The alternatives give up the decided default or a single source for the pair. The line also reuses the header paragraph the deterministic parser already reads.

### Q2 — May a discharge span several phases?

- Exactly one discharging phase per oracle phase: one-to-one pairs, and no phase in both roles — abandons: Plans that implement one oracle set over several phases, each lifting part of the markers. Such plans must split their oracles into one oracle phase per implementing phase.
- Several discharging phases, each naming the oracle files it discharges — abandons: A single gate where 'every marker is gone' is proved. It adds a per-file discharge mapping to the plan syntax and a partial-discharge mode to the provider contract, which the first consumer does not need.

Recommendation: Exactly one discharging phase per oracle phase: one-to-one pairs, and no phase in both roles — Decided by the author on 2026-09-28, as recommended. The first consumer's conductor plans one oracle phase and one implementing phase per surface. Splitting the oracles is a planning cost, while partial discharge weakens the guarantee itself. The one-to-one pairing can be relaxed additively later.

### Q3 — Is an oracle phase with no provider registered a lint error, or does it run without the check?

- Lint error, and `run`/`resume` refuse in exit family 2 — abandons: Linting or running an oracle-first plan in a repo before its provider exists, which is steme-lab's situation until steme ships
- Lint warning; the run proceeds without the oracle step — abandons: The guarantee the plan declared: the discharging phase could edit or delete oracles unchecked while the plan still reads as oracle-first
- Lint warning, but `run` refuses — abandons: The rule that a lint-clean plan is one phax will run: a plan with no lint error could still be refused at run time

Recommendation: Lint error, and `run`/`resume` refuse in exit family 2 — Decided by the author on 2026-09-28, as recommended. The lost capability is one nobody may use yet: it was decided that no plan declares an oracle phase before steme's provider ships. Running unchecked would quietly break exactly the separation the declaration promises.

### Q4 — Under which surface is the oracle verdict recorded?

- `structural` — abandons: Telling the oracle verdict apart from other structural steps by surface alone: only the command string distinguishes it in attribution and records
- `local` — abandons: The meaning of `local` as the project's own fast checks, such as unit tests. The verdict judges the shape of the change, not a local run.
- A new `oracle` surface value — abandons: The closed three-value surface enum persisted in gate-attribution.json, run records and the run summary. It widens just before the 1.0 freeze, with a value no configured step may use.

Recommendation: A new `oracle` surface value — Decided by the author on 2026-09-28, against the previous recommendation (`structural`). The oracle verdict reads apart from every other step by its surface alone, in attribution, records and the run summary. The cost is accepted: the persisted surface enum widens before the 1.0 freeze, and a configured step may not use the new value.

### Q5 — Which files are the oracle files?

- All of the oracle phase's planned files to create and edit. Any stub the oracles need to compile against lands in an earlier ordinary phase. — abandons: An oracle phase that also ships the stubs its tests import. A typed project needs one more phase: surface stubs, then oracles, then implementation.
- The declaration lists the oracle files explicitly, as a subset of the phase's planned files — abandons: A one-line declaration: each oracle file is named twice, and lint needs one more rule for a list that can drift from the planned files
- phax sends every planned file, and the provider decides which are oracles — abandons: phax's own between-the-pair lint rule, which needs the oracle file set without calling a provider, and the lint staying provider-free for oracles

Recommendation: The declaration lists the oracle files explicitly, as a subset of the phase's planned files — Decided by the author on 2026-09-28, against the previous recommendation (all planned files). The oracle phase may carry the stubs its tests compile against without making them oracles, so a typed project needs no extra stub phase. The cost is accepted: each oracle file is named twice, and lint checks the list is a subset of the phase's planned files.

## 10. Implementation-planning note

Settled:

- The mechanism is the test framework's own expected-failure marker. phax never parses test files, never runs a test command specially, and never knows a marker.
- The provider's answer is the existing diagnostics document, judged and scheduled exactly like an `output: "diagnostics"` step. Failing diagnostics drive the fix prompt.
- The oracle step runs after every configured step, at every gate attempt of the oracle phase (`authored`) and of the discharging phase (`discharged`), and nowhere else.
- The discharging phase may edit oracle files only by a proved-minimal edit, which the provider proves. A wrong oracle exhausts the fix loop and pauses the run (exit 4). That is intended behaviour (P3, P1).
- The config key is `oracles: { command }`, mirroring `scopes` and `planAuditor`: split on whitespace, no shell, JSON on stdin and stdout.
- The §9 decisions of 2026-09-28: a declaration line on the oracle phase defaulting to the next phase, one-to-one pairs, a lint error plus exit-2 refusal without a provider, a new reserved `oracle` surface, and an explicit list of oracle files, a subset of the oracle phase's planned files.
- Relation to headless-review §9 Q5: that spec's `--append` has no oracle-file refusal (decided 2026-09-28); its compliance review alone checks R4. The oracle files declared here are the first plan-declared source of oracle identity; the future oracle-separation lint, not this spec, generalises it.
- The first provider is steme's `steme oracles`. No phax or steme-lab plan declares an oracle phase until it ships.

Left open:

- The exact spelling of the plan.md declaration line and of the lint and refusal messages (all indicative).
- The provider time cap: 120 s is indicative. It should cover a git-diff-based proof without letting a hung provider stall a phase.
- How the oracle role reaches `phax records explain`: a new per-phase record field, or a derivation from the recorded plan. A new persisted field follows the no-shims rule (required, null for ordinary phases).
- The exact wording of the framework-neutral role paragraph in the phase prompt.
- Where in the review handoff and the final report the oracle-pair table renders.

Constraints:

- Additive only (NEXT_STEPS §Road to 1.0.0). A plan with no oracle phase is extracted, linted, run and recorded exactly as today.
- phax gains no knowledge of any test framework: no built-in provider, no marker list, no test-file convention.
- Persisted fields follow the no-shims rule: `oracle` is required on every phase of phax-plan.json and of the plan document, and `null` for ordinary phases. The plan must say how extraction-cache entries and in-flight runs written by an older binary are treated.
- The `oracles` block appears in phax.json and in the user overlay like `scopes`, and in both generated JSON schemas.
- Keep the exit families of src/cli/commands/runLayers.ts: 2 for ill-formed pairs or a missing provider at run/resume, and 4 for an exhausted gate. The README exit-code table is stale on these and should be corrected where this change documents them.
- Update the phax-planning skill (the declaration line, oracle-first phase shape, stubs allowed in the oracle phase outside the listed oracle files) and the phax-decide-plan skill's P3 wording ('read-only for the implementing phase' becomes 'changed only by a proved-minimal edit, judged by the oracles provider').
- Document the provider contract in `phax --usage` (cmd run and cmd plans lint) and in README §Oracle provider, beside §Scope provider.
- The `oracle` surface widens a persisted enum (gate-attribution.json, run records, run summary). Under schemas-package's `$schema` identification, that is a new shape of the phase record at the release that ships it, recorded by its snapshot gate; older records stay readable.

## 11. Docs page

Page: README §Oracle provider (under §Configure, after §Scope provider), plus an oracle-phase section in the phax-planning skill

Reader: A project owner registering a test-first provider such as `steme oracles`, and a planner writing an oracle-first plan whose tests must be written before the code

Example: phax.json: "oracles": { "command": "steme oracles" }. In plan.md, phase-02 carries `**Oracle phase:** yes` and marks every new or edited test with the runner's expected-failure marker. At phase-02's gate phax sends {"mode":"authored","phase":"phase-02","oraclePhase":"phase-02","base":"3f2a91c…","files":["tests/prune.test.ts"]}. At phase-03's gate it sends mode "discharged" with the phase-02 commit as oracleCommit. The provider answers {"diagnostics": []} to pass, and a failing diagnostic drives the fix loop.
