---
status: Draft
date: 2026-10-20
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Oracle phases — a plan declares the phase that writes the tests and the phase that discharges them, and a configured `oracles` provider judges both gates

## 1. Context

phax runs a plan as chained phases. Each phase gets its own worktree on `<run.branch>--phase-NN`, branched off the previous phase's branch, and is committed once its gate is green. A red gate opens a same-session fix loop.

The gate is the project's gate profile, an ordered list of steps. Each step is `{ command, surface, firing }`. `surface` is exactly `local` | `structural` | `product`, and `firing` is exactly `every-phase` | `terminal`. A step may also carry two optional keys:
- `input: "gate-request"`: the step gets `{ $schema, phase, base, terminal, phases }` on stdin.
- `output: "gate-report"`: phax judges the step by the gate-report it prints. `{ $schema, outcome: "checked", findings, review }` passes with no finding on exit 0. Any finding fails the step and drives the fix prompt. `{ $schema, outcome: "refused", reason, remedy }` stops the phase for the operator with no fix attempt (exit 4, resumable). Anything unreadable fails as a broken step.

Steps run in order and stop at the first failure or refusal. Each step that ran is recorded in `<phase>/gate-attribution.json` as `{ command, surface, result }`, where `result` is exactly `pass` | `fail` | `refused`. A surface whose steps all passed is a verified surface in the phase record, the run summary and the PR body.

phax.json declares providers as `{ "command" }` blocks, split on whitespace with no shell, and merges them across `phax.json`, `~/.phax/config.json` and `phax.local.json`. `brief` and `architecture` speak versioned request and report formats that each carry a required `$schema`. The headless plan authoring prompt says whether an architecture provider is configured.

`phax plans lint` runs the checks structure, files, commands, models and advisory. The run preflight runs a fixed set of checks before `phax run` names a run, and again when `phax resume` re-checks it. Its plan checks refuse with exit 11.

Two specs reshape a phase in this release:
- assignment-bounds (Approved) renames `modelReason` to `assignmentReason`, which stays among the phase's last three keys.
- interactive-phases (Draft) adds `mode` (`headless` | `interactive`) directly after `optionalFilesToEdit`, a `**Mode:** interactive` line, and an `interactive` check that lint and the run preflight share.

The joint session of 2026-10-20 settled three points for this spec. oracle-phases adds its own `oracle` key (J1), placed after `mode` (J2), and its placement rules form one shared check that refuses with exit 11 (J4).

The 2026-09-28 oracle-phases design answered in the old diagnostics document, refused a missing provider with exit 2, and named steme's unbuilt `steme oracles` as its only provider. It was reopened and abandoned on 2026-10-20, to be re-authored here.

phax's own tests run on Vitest. There, `test.fails` and `it.fails` mark a test that must fail: the run passes when the test fails and fails when it passes.

Ground read:

- `docs/specs/archive/2609281159-oracle-phases.md` — The 2026-09-28 design. It was reopened to Draft and abandoned on 2026-10-20, and this spec re-authors it. Its problem, product goal, terminology and most requirements still hold. What changes: its provider answered the old `{ diagnostics }` document with no `$schema`, it refused a missing provider with exit 2, and its only provider was steme's unbuilt `steme oracles`. Its §9b holds five lifted verdicts: Q1 oracle-side-line, Q2 one-designated, Q3 error-and-refuse, Q4 new-oracle-surface and Q5 explicit-subset.
- `src/app/gates.ts` — The gate runner. Steps run in profile order and stop at the first failure or refusal. An `input: "gate-request"` step gets the gate request on stdin, which is saved as `checks-attempt-NN.request.json`. An `output: "gate-report"` step is judged by its report: a checked report passes with no finding on exit 0, and any finding fails the step. A checked report with no finding and a non-zero exit, or an unreadable report, fails as a broken step. A `refused` report records `refused`, writes the reason and remedy to the log, and fails with GateStepRefusedError. A readable report is saved as printed as `checks-attempt-NN.report-SS.json`. The steps that ran go to the attempt's step record and to `gate-attribution.json`. Gate steps run with no time cap.
- `src/schemas/gateReport.ts` — gate-report: `{ $schema, outcome: "checked", findings, review }` or `{ $schema, outcome: "refused", reason, remedy }`. Any other key is refused at any level. A finding is `{ id, rule, location: { file, lines }, message, related, guide }`. Review notes never fail a step and reach only the reviewer.
- `src/schemas/gateRequest.ts` — gate-request: `{ $schema, phase, base, terminal, phases: [{ id, files }] }`. It has exactly five keys. `base` is the commit the gated phase's branch was created from. The last snapshot is 0.20.0.
- `src/schemas/gateAttribution.ts` — A step result is `{ command, surface, result }`, with `result` exactly `pass` | `fail` | `refused`. The current shape is the 0.21.0 snapshot, and the history decoders 0.17.0 and 0.20.0 are frozen.
- `src/schemas/surface.ts` — `SurfaceSchema` is the closed literal `local` | `structural` | `product`. One enum serves three uses: configured gate steps (phaxConfig.ts), gate-attribution, and the phase record's `verifiedSurfaces` (runRecord.ts, format phase-record-manifest, current shape 0.17.0).
- `src/domain/gate/verifiedSurfaces.ts` — A surface is verified when at least one of its steps ran and every one of its steps passed. The result feeds the phase record, the final report and the PR body's 'Verified surfaces' line.
- `src/app/fixLoop.ts` — A GateStepRefusedError ends the loop: the gate is recorded as rejected, a GateStepRefused event pauses the phase, and there is no fix prompt and no counted attempt. `phax run` prints 'paused: a gate step refused to run' with the reason and remedy, and writes resume-instructions.md.
- `src/cli/commands/runLayers.ts` — Exit families: 2 for plan or config validation, 4 for a gate failure (fix attempts exhausted, or a step refused), 11 for a security or preflight refusal (ModelPreflightError, PlanSectionsPreflightError), and 1 for generic failures and lint.
- `src/schemas/phaxConfig.ts` — The provider seats `brief`, `planAuditor` and `architecture` are optional `{ command }` blocks, split on whitespace with no shell. They are present in both PhaxConfigSchema and PhaxUserOverlaySchema and decoded with excess properties refused. A gate step is `{ command, surface, firing, output?: log | gate-report, input?: gate-request }`. `getPhaxConfigJsonSchema` and `getPhaxUserOverlayJsonSchema` feed `phax schema upgrade`.
- `src/schemas/phaxPlan.ts` — An extracted and persisted phase: id, (title,) model, effort, planMarkdownAnchor, the three planned-file lists, commit. interactive-phases adds `mode` directly after `optionalFilesToEdit`. The current phax-plan snapshot is 0.17.0.
- `src/schemas/planDocument.ts` — A plan-document phase spreads the extracted fields and ends with `commit, modelReason, model, effort`. assignment-bounds renames `modelReason` to `assignmentReason`, and interactive-phases adds `mode` after `optionalFilesToEdit`. The 0.25.0 snapshot is cut.
- `src/domain/plan/lint.ts` — LintCheck is structure | files | commands | models | advisory. A finding is `{ severity, check, phase, message }`, and any error exits 1. interactive-phases adds an `interactive` check.
- `src/app/runPreflight.ts` — RUN_PREFLIGHT_CHECKS: gate-profile, required-commands, skill-edit-consent, mcp-allow, records-destination, phase-models, phase-sections. `phax run` runs them before it names the run, and executePlan runs them again as the resume re-check. `phase-models` and `phase-sections` refuse with exit 11.
- `src/domain/authoring/prompt.ts` — The headless authoring prompt for a plan states, in one bullet, whether an architecture provider is configured. The bullet is absent for a spec.
- `src/schemas/schemaUrl.ts` — FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS list every versioned format, including gate-request, gate-report, brief-request, architecture-request and architecture-report. A new provider format joins both lists.
- `docs/release.md` — A format's changed shape lives in `next.schema.json` until the cut renames it to the release. A stamp names the release that last changed the format's shape.
- `docs/specs/2610201350-assignment-bounds.md` — Approved. Its §10 records the joint phase-shape session of 2026-10-20: J1 separate keys, with `oracle` its own key; J2 `mode` after `optionalFilesToEdit`, with `assignmentReason`, `model`, `effort` last and `oracle`'s place left to this spec; J4 one shared check per rule family, refusing with exit 11; J5, at the time, oracle-phases with its own lift.
- `docs/specs/2610190947-interactive-phases.md` — Draft. It adds `mode` (`headless` | `interactive`) and a `**Mode:** interactive` line after the model, effort and Assignment reason lines, and an interactive phase plans no file to create or edit (q-planned-work, review-only). §10 hands this spec the rule against an interactive phase between an oracle phase and its discharging phase, and the question of which commit the discharge judges after a person's correction.
- `.claude/skills/phax-decide-plan/SKILL.md` — P3: oracle first when the surface is shown, with the oracle files 'read-only for the implementing phase'. A wrong oracle pauses the run and goes back to the spec.
- `package.json` — The `files` of the source package. The published launcher `@lbdremy/phax` (npm/package.json) ships only `bin`, `lib` and README.md. phax's own tests run on Vitest (`vitest run`).
- `phax.json` — phax's own config: the `standard` gate profile (pnpm format … pnpm test … pnpm audit:architecture, then the terminal build and smoke steps), `pnpm install` as setup, and no provider declared.
- `NEXT_STEPS.md` — The oracle-phases entry still says it waits for `steme oracles` and takes its own plan-document lift.

## 2. Problem

An oracle-first plan cannot pass phax's gates today. The gate runs the ordinary test command at every phase, so an oracle phase is red by construction:
- its new tests fail because the code does not exist yet;
- old tests edited to state the new behaviour fail too.

Those failing tests, and the tests it deletes on purpose, are what the oracle phase exists to produce. They are the arbitration a reviewer reads like a spec before any code exists. The only way through today is to keep test and code in one phase. That gives up the separation the plan doctrine asks for (phax-decide-plan P3): the agent that writes the code also writes, and can quietly weaken, what judges it.

The implementing phase has the opposite problem. Nothing stops it from 'fixing' a red oracle by editing its assertion, deleting it or turning it into a skip. Read-only oracle files cannot fix this, because making the oracles live needs at least one edit: removing what kept them green while they were red.

phax cannot learn this per test framework. Vitest, pytest and every other runner mark expected failures differently, and phax's contract is to stay framework-agnostic and delegate such judgments to a provider. The 2026-09-28 design did that, but it had two flaws:
- it waited on a single provider that does not exist, so no plan, phax's own included, could ever declare an oracle phase;
- its request and answer carried no `$schema`, against the rule that every provider request and answer is a versioned phax format.

## 3. Product goal

A plan can declare an oracle phase and the later phase that discharges it, wherever an `oracles` provider is configured, whoever wrote that provider.

In the oracle phase, every added or modified test carries its framework's own expected-failure marker. The ordinary test command stays green, and the runner itself turns a vacuous oracle red. In the discharging phase every marker is gone, and removing them is the only change made to the oracle files since the oracle phase's commit.

phax checks none of this itself. At the gate of those two phases it sends the configured provider a versioned oracle request and judges the `gate-report` answer like any report step. A finding drives the fix loop. A wrong oracle exhausts the loop and pauses the run on what is a spec disagreement, not a bug.

Lint and the run's start preflight hold the declarations to one shared check.

The phax repository carries an example Vitest provider that compares syntax trees, and phax's own phax.json declares it. phax's own plans can then be oracle-first, and provider authors have a working reference.

> phax knows which phase authors the oracles and which phase discharges them; only the provider knows what an oracle is.

## 4. Terminology

- **Oracle** — A test that states the behaviour the code must have and judges the phase that implements it. This spec covers tests only; disposition matrices, fixtures and golden files are out of scope.
- **Expected-failure marker** — A test framework's own annotation for a test that must fail: Vitest `test.fails` and `it.fails`, pytest `xfail(strict=True)`. A marked test that fails passes the run, and a marked test that passes fails it. phax never names, detects or parses a marker; only a provider does.
- **Oracle phase** — A phase whose plan.md header carries the oracle declaration. Every test it adds or modifies in its oracle files carries an expected-failure marker, and it may delete tests. It is always a headless phase.
- **Discharging phase** — The one later phase that makes an oracle phase's oracles live: it removes every marker and makes the implementation satisfy the oracles. It is the next phase unless the declaration names another. Its own `oracle` is null; its role is derived from the oracle phase's declaration.
- **Oracle pair** — An oracle phase together with its discharging phase.
- **Oracle files** — The files an oracle phase lists on its `**Oracle files:**` line: a subset of its planned files to create and to edit. Only these files are sent to the provider and guarded between the pair. The oracle phase's other planned files, such as stubs the tests compile against, are ordinary files.
- **Base commit** — The commit the oracle phase's branch was created from: the previous phase's commit, or the run's start commit for phase-01.
- **Oracle commit** — The commit the oracle phase produced: the tip of its phase branch.
- **Proved-minimal edit** — A change to the oracle files, from the oracle commit to the discharging phase's worktree, that only removes expected-failure markers. No assertion changes, no test is deleted, and no skip or todo takes a marker's place. The provider proves this; phax does not.
- **Oracles provider** — The command configured as `oracles.command` in any config layer. It answers an oracle request with a `gate-report`.
- **Oracle request** — The `oracle-request` document phax writes on the oracles provider's stdin: `$schema`, `verdict`, `phase`, `oraclePhase`, `base`, `files`, and, on a `discharged` request only, `oracleCommit`.
- **Verdict** — What an oracle request asks the provider to judge: exactly `authored` (at the oracle phase's gate) or `discharged` (at the discharging phase's gate). The key is named `verdict`, not `mode`, because a phase already uses `mode` for `headless` | `interactive`.
- **Oracle step** — The gate step phax itself appends, after every configured step the attempt fires, at the gate of an oracle phase or a discharging phase. It runs the oracles provider and is recorded under the `oracle` surface.
- **`oracles` check** — The one domain check behind lint's `oracles` findings and the run preflight's oracle refusal.
- **Example Vitest provider** — Repository tooling in the phax repository: an oracles provider for Vitest that judges oracle files by their syntax trees. phax's own phax.json declares it, and no phax command runs it.

## 5. Functional requirements

### 5.1 Declaring an oracle phase in plan.md

The system shall read a phase of plan.md as an oracle phase when its header paragraph carries an `**Oracle phase:**` line valued `yes` or `discharged by phase-NN` and an `**Oracle files:**` line listing its oracle files. It shall take `yes` to designate the next phase in plan order as the discharging phase.

### 5.2 The oracle key in phax-plan.json and the plan document

WHEN phax extracts a plan.md or decodes a plan document THE system SHALL carry a required `oracle` key, placed directly after `mode`, on every phase of `phax-plan.json` and of the plan document. On an oracle phase the key is `{ "dischargedBy": "<phase id>", "files": [...] }`, with the discharging phase resolved and the oracle files in declaration order. On every other phase it is `null`.

### 5.3 Rendering the declaration

WHEN phax renders a plan document to plan.md THE system SHALL write the `**Oracle phase:** discharged by <dischargedBy>` and `**Oracle files:**` lines on each phase whose `oracle` is not null, after that phase's Recommended model, Recommended effort, Assignment reason and Mode lines, and SHALL write no oracle line on any other phase.

### 5.4 Lifted sidecars carry no oracle

WHEN `phax artifact migrate-documents` lifts a live plan sidecar stamped below the plan-document shape that carries `oracle` THE system SHALL give every lifted phase `oracle: null` and add no oracle line to its plan.md.

### 5.5 Lint: well-formed declaration lines

IF a phase carries an `**Oracle phase:**` line without an `**Oracle files:**` line or the reverse, an `**Oracle phase:**` value other than `yes` or `discharged by phase-NN`, or either line outside its header paragraph, THEN `phax plans lint` SHALL report an error on the `oracles` check naming the phase and the line.

### 5.6 Lint: a discharging phase that exists and comes after

IF an oracle phase's discharging phase is absent from the plan or does not come after the oracle phase THEN `phax plans lint` SHALL report an error on the `oracles` check naming the oracle phase and the discharging phase it resolved to.

### 5.7 Lint: one role per phase, one-to-one pairs

IF a phase is both an oracle phase and a discharging phase, or is the discharging phase of more than one oracle phase, THEN `phax plans lint` SHALL report an error on the `oracles` check naming that phase.

### 5.8 Lint: an oracle phase lists oracle files

IF an oracle phase's `**Oracle files:**` line lists no file THEN `phax plans lint` SHALL report an error on the `oracles` check naming that phase.

### 5.9 Lint: oracle files are planned by the oracle phase

IF an oracle phase lists an oracle file that is not among its own planned files to create or to edit THEN `phax plans lint` SHALL report an error on the `oracles` check naming the phase and the file.

### 5.10 Lint: no oracle file planned between the pair

IF a phase strictly between an oracle phase and its discharging phase names one of that pair's oracle files in its planned files to create, to edit or optionally edit THEN `phax plans lint` SHALL report an error on the `oracles` check naming the intervening phase, the file and the oracle phase.

### 5.11 Lint: no interactive phase between the pair

IF an interactive phase sits strictly between an oracle phase and its discharging phase THEN `phax plans lint` SHALL report an error on the `oracles` check naming the interactive phase and the oracle pair.

### 5.12 Lint: an interactive phase takes no oracle role

IF an interactive phase is an oracle phase or a discharging phase THEN `phax plans lint` SHALL report an error on the `oracles` check naming that phase.

### 5.13 Lint: an oracle phase needs a provider

IF a plan declares an oracle phase and no configuration layer declares an `oracles` provider THEN `phax plans lint` SHALL report an error on the `oracles` check naming the oracle phase and the missing `oracles` key.

### 5.14 One oracles check

The system shall compute every `oracles` finding in one domain check that `phax plans lint` and the run preflight both call, so that each error lint reports is exactly an error the run preflight refuses on.

### 5.15 Run and resume refuse an ill-formed declaration

IF the `oracles` check reports an error when `phax run` or `phax resume` runs its preflight THEN the system SHALL refuse before any phase starts (for `phax run`, before the run is named), print every error of the check, leave an existing run's state unchanged, and exit 11.

### 5.16 The oracles provider block

The system shall accept an optional `oracles` block holding exactly one non-empty `command` in `phax.json`, `~/.phax/config.json` and `phax.local.json`, merged across the layers as `brief` and `architecture` are, and shall refuse any other key inside the block with exit 2.

### 5.17 Schema upgrade describes the block

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` and a `phax.user.schema.json` that both describe the `oracles` block, with the provider contract summarized in the block's description.

### 5.18 A configured step cannot claim the oracle surface

IF a configured gate step declares the `oracle` surface THEN loading the configuration SHALL fail with exit 2 naming the step's surface, because a configured step's surface stays exactly `local`, `structural` or `product`.

### 5.19 The oracle step at the oracle phase

WHEN a gate attempt of an oracle phase has run every configured step it fires and all of them passed THE system SHALL run the oracle step, with an `authored` oracle request, as the attempt's last step.

### 5.20 The oracle step at the discharging phase

WHEN a gate attempt of a discharging phase has run every configured step it fires and all of them passed THE system SHALL run the oracle step, with a `discharged` oracle request, as the attempt's last step.

### 5.21 No oracle step anywhere else

The system shall run the oracles provider only at the gate of an oracle phase or a discharging phase, and never from `phax plans lint`, `phax validate`, the run preflight, plan authoring or the gate of any other phase.

### 5.22 The oracle request

The system shall write on the oracle step's stdin an `oracle-request` document with a required `$schema` and exactly the keys of its verdict, and shall save that document beside the attempt's log. The keys are `verdict`, `phase`, `oraclePhase`, `base` (the oracle phase's full base commit), `files` (the oracle files) and, on a `discharged` request only, `oracleCommit` (full).

### 5.23 The spawn contract

The system shall run the oracle step in the gated phase's worktree as it stands before the phase commit, with the `oracles.command` string split on whitespace and no shell.

### 5.24 The step is judged as a report step

The system shall judge the oracle step by its stdout and exit code exactly as it judges an `output: "gate-report"` step: a `checked` report with no finding passes on exit 0, any finding fails the step whatever the exit code, and the report is saved as printed beside the attempt's log.

### 5.25 Findings drive the fix loop

WHEN the oracle step fails with findings THE system SHALL put the findings in the phase's fix prompt, as for any report step, and SHALL run the oracle step again on the next attempt once the configured steps pass.

### 5.26 A refusal pauses the phase

WHEN the oracles provider answers with a `refused` gate report THE system SHALL record the step as `refused`, make no fix attempt, print the provider's reason and remedy, and pause the run at that phase with exit 4, as for any refused report step.

### 5.27 Provider errors fail the step

IF the oracles provider cannot be spawned, outruns its time cap, prints no readable gate report, or exits non-zero with no finding THEN the system SHALL fail the oracle step as a broken step and name the reason in the attempt's log.

### 5.28 An undischargeable oracle pauses the run

WHEN an oracle phase or a discharging phase exhausts its fix loop on a failing oracle step THE system SHALL stop the run as a gate failure with exit 4, resumable at that phase.

### 5.29 Attribution of the oracle step

WHEN the oracle step runs THE system SHALL record it as the last step of the attempt's step record and of the phase's `gate-attribution.json`, with the `oracles.command` string as its command, `oracle` as its surface, and `pass`, `fail` or `refused` as its result.

### 5.30 The oracle surface is carried like any other

The system shall count the `oracle` surface among a phase's verified surfaces in the phase record, the run summary and the PR body, by the same rule as every other surface.

### 5.31 Oracle pairs in the review handoff

The system shall list every oracle pair in the run's `review-handoff.md`, with its oracle phase, its discharging phase and the result of each side's last oracle step, and shall write no such list for a plan with no oracle phase.

### 5.32 Oracle role in the records

WHEN `phax records explain` resolves the commit of an oracle phase or a discharging phase THE system SHALL name the phase's oracle role, its counterpart phase and its last oracle-step result.

### 5.33 The agent is told its role

The system shall state in the prompt of an oracle phase and of a discharging phase the phase's oracle role, its counterpart phase and the oracle files, in a fixed wording that names no test framework and no marker.

### 5.34 Discharge edits are planned edits

WHEN phax reconciles the files a discharging phase touched THE system SHALL count an edit to one of its pair's oracle files as a planned edit.

### 5.35 The discharge judges the current oracle commit

WHEN a discharging phase's gate runs after a resume, a reset or a re-run THE system SHALL name in the `discharged` request the oracle phase's current commit and its current base commit.

### 5.36 Reset the discharge before its oracles

IF `phax reset-phase` targets an oracle phase whose discharging phase is no longer pending THEN it SHALL refuse, naming the discharging phase to reset first, and change nothing.

### 5.37 The planner is told a provider is configured

WHERE an `oracles` provider is configured THE system SHALL state in the headless plan authoring prompt that one is configured and that the planner may declare oracle phases.

### 5.38 The planner is told no provider is configured

WHERE no `oracles` provider is configured THE system SHALL state in the headless plan authoring prompt that none is configured and that the planner declares no oracle phase.

### 5.39 The planning skill states the rule

The phax-planning skill shall state that a plan declares an oracle phase only when an `oracles` provider is configured. It shall give the two declaration lines, the oracle files as a subset of the oracle phase's planned files, and the one change the discharging phase may make to those files.

### 5.40 Nothing changes without an oracle phase

WHILE a plan declares no oracle phase THE system SHALL extract, lint, run, resume, reset and record it with the same findings, prompts, gate steps, attribution and exit codes as before this change, apart from `oracle: null` on every phase, whether or not an `oracles` provider is configured.

### 5.41 No test-framework knowledge in phax

The system shall neither read the content of an oracle file nor add, remove, reorder or alter a configured gate step in order to judge an oracle.

### 5.42 The example provider is repository tooling

The phax repository shall carry an example `oracles` provider for Vitest as repository tooling outside the phax CLI, run by no phax command and imported by no phax module.

### 5.43 phax's own config declares the example

The phax repository's own `phax.json` shall declare the example as its `oracles` provider.

### 5.44 The example judges authored oracles

WHEN the example provider receives an `authored` request THE example SHALL answer with a `checked` gate report that holds one finding for each test, added or modified since `base` in the oracle files, that does not carry `.fails`, and no finding for a test deleted since `base`.

### 5.45 The example finds markers left at discharge

WHEN the example provider receives a `discharged` request THE example SHALL report one finding for each `.fails` marker left in the oracle files.

### 5.46 The example proves marker removal is the only change

WHEN the example provider receives a `discharged` request THE example SHALL report one finding for each oracle file whose syntax tree now differs from its syntax tree at `oracleCommit` with every `.fails` member access removed.

### 5.47 The example compares syntax trees, not lines

The example provider shall judge oracle files by their syntax trees and never by their lines, so that a change of whitespace, line breaks or trailing commas alone never changes its answer.

### 5.48 The example refuses a request it cannot read

IF the example provider receives a request it cannot read THEN it SHALL answer with a `refused` gate report naming the reason and a remedy.

## 6. Surface

### file: plan.md — oracle phase declaration — indicative

before:

    ## phase-02 — Refund oracles  {#phase-02-refund-oracles}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium

after:

    ## phase-02 — Refund oracles  {#phase-02-refund-oracles}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium
    **Oracle phase:** yes
    **Oracle files:** tests/refunds.test.ts, tests/prune.test.ts

    # or, naming the discharging phase:
    **Oracle phase:** discharged by phase-04
    **Oracle files:** tests/refunds.test.ts, tests/prune.test.ts

    Normative:
    - the two lines sit only on an oracle phase, in its header paragraph;
    - they come after the Recommended model and Recommended effort lines, and after the Assignment reason and Mode lines when the phase has them (an oracle phase is headless, so in practice it has no Mode line);
    - `yes` means the next phase in plan order, and a rendered plan always names the phase;
    - the oracle files are a subset of the phase's planned files to create and to edit (Q5), so the phase may also plan a stub such as src/refunds/index.ts that is not an oracle.

    Indicative: the labels' spelling.

### file: phax-plan.json — per-phase oracle — normative

before:

    { "id": "phase-02", "title": "Refund oracles", "model": "claude-sonnet-5-5", "effort": "medium",
      "planMarkdownAnchor": "phase-02-refund-oracles",
      "plannedFilesToCreate": ["tests/refunds.test.ts"], "plannedFilesToEdit": ["tests/prune.test.ts", "src/refunds/index.ts"],
      "optionalFilesToEdit": [], "mode": "headless",
      "commit": { "subject": "test(refunds): oracles for partial refunds", "body": "…" } }

    # the phase as interactive-phases leaves it

after:

    { "id": "phase-02", …same fields up to mode…, "mode": "headless",
      "oracle": { "dischargedBy": "phase-03", "files": ["tests/refunds.test.ts", "tests/prune.test.ts"] },
      "commit": { … } }
    { "id": "phase-03", …same fields up to mode…, "mode": "headless", "oracle": null, "commit": { … } }

    Normative:
    - `oracle` is required on every phase, directly after `mode`;
    - it is null on an ordinary phase and on a discharging phase;
    - on an oracle phase it is `{ dischargedBy, files }`, always resolved (never `yes`/next), with both keys required and no other key.

### file: plan document (`phax artifact schema plan`) — per-phase oracle — normative

before:

    "phases": [{ "id": "phase-02", …, "plannedFilesToCreate": ["tests/refunds.test.ts"],
      "plannedFilesToEdit": ["tests/prune.test.ts", "src/refunds/index.ts"], "optionalFilesToEdit": [],
      "mode": "headless",
      "boundaryContracts": null, …, "expectedHandoff": "…", "commit": { … },
      "assignmentReason": null, "model": "claude-sonnet-5-5", "effort": "medium" }]

    # the phase once assignment-bounds and interactive-phases have reshaped it

after:

    "phases": [{ "id": "phase-02", …, "optionalFilesToEdit": [],
      "mode": "headless",
      "oracle": { "dischargedBy": "phase-03", "files": ["tests/refunds.test.ts", "tests/prune.test.ts"] },
      "boundaryContracts": null, …, "expectedHandoff": "…", "commit": { … },
      "assignmentReason": null, "model": "claude-sonnet-5-5", "effort": "medium" }]

    Normative:
    - `oracle` sits directly after `mode` in `properties` and `required` (J2);
    - `assignmentReason`, `model` and `effort` stay the last three keys;
    - it has the same shape as in phax-plan.json, renders to the plan.md oracle lines, and projects unchanged to phax-plan.json.

### config: phax.json `oracles` — normative

before:

    "brief": { "command": "acme-guard brief", "push": "findings" },
    "architecture": { "command": "acme-guard architecture" }

after:

    "brief": { "command": "acme-guard brief", "push": "findings" },
    "architecture": { "command": "acme-guard architecture" },
    "oracles": { "command": "node tools/vitest-oracles.mjs" }

    Normative:
    - the block is optional and is accepted in phax.json, ~/.phax/config.json and phax.local.json, merged per layer as `brief` and `architecture` are;
    - it holds exactly one non-empty `command`, split on whitespace with no shell;
    - any other key inside the block is refused with exit 2.

### api: oracle request (the provider's stdin) — normative

    $ node tools/vitest-oracles.mjs      # cwd: ~/.phax/worktrees/refunds/phase-02, the phase's work uncommitted
    stdin:
    {
      "$schema": "https://docs.phax.run/schemas/oracle-request/<release>.json",
      "verdict": "authored",
      "phase": "phase-02",
      "oraclePhase": "phase-02",
      "base": "3f2a91c0d6e84b1f9a7c2e5d8b0a4f6c1e3d7b92",
      "files": ["tests/refunds.test.ts", "tests/prune.test.ts"]
    }

    $ node tools/vitest-oracles.mjs      # cwd: ~/.phax/worktrees/refunds/phase-03
    stdin:
    {
      "$schema": "https://docs.phax.run/schemas/oracle-request/<release>.json",
      "verdict": "discharged",
      "phase": "phase-03",
      "oraclePhase": "phase-02",
      "base": "3f2a91c0d6e84b1f9a7c2e5d8b0a4f6c1e3d7b92",
      "oracleCommit": "8be04d71a2c94f3e6b0d5a7c9e1f2b3a4d6c8e05",
      "files": ["tests/refunds.test.ts", "tests/prune.test.ts"]
    }

    Normative (under q-request's recommendation):
    - a new versioned format `oracle-request`, with a required `$schema`;
    - two variants by `verdict` (`authored` | `discharged`), each with exactly its keys and all of them required: `oracleCommit` is present on `discharged` only;
    - `base` is the oracle phase's base commit on both variants;
    - commits are full object names;
    - `files` holds the oracle files in declaration order.

    Indicative: the release in the URL.

### api: oracles provider answer (its stdout) — the existing gate-report — normative

    pass — exit 0:
    { "$schema": "https://docs.phax.run/schemas/gate-report/<release>.json",
      "outcome": "checked", "findings": [], "review": [] }

    fail — any exit code:
    { "$schema": "https://docs.phax.run/schemas/gate-report/<release>.json",
      "outcome": "checked",
      "findings": [
        { "id": "oracle-changed:tests/refunds.test.ts:caps a refund at the invoice total",
          "rule": "After the oracle phase, only the expected-failure markers may change in an oracle file",
          "location": { "file": "tests/refunds.test.ts", "lines": [42, 42] },
          "message": "expect(refund.amount).toBe(120) became toBe(100) since the oracle commit",
          "related": [],
          "guide": null } ],
      "review": [] }

    refused — any exit code:
    { "$schema": "https://docs.phax.run/schemas/gate-report/<release>.json",
      "outcome": "refused",
      "reason": "tests/prune.test.ts is not at the oracle commit 8be04d7",
      "remedy": "reset phase-03, then phase-02, and resume" }

    Normative:
    - the answer is exactly gate-report, judged by the rules of an `output: "gate-report"` step;
    - a refusal pauses the phase with no fix attempt;
    - review notes reach only the reviewer;
    - an answer with no `$schema`, or of an unknown version, is a broken step.

    Indicative: finding ids, rules and wording, which are the provider's own.

### cli: phax plans lint — the `oracles` check — normative

before:

    $ phax plans lint docs/plans/2611021000-refunds-plan.md
    docs/plans/2611021000-refunds-plan.md: 0 errors, 0 warnings
    $? = 0

after:

    $ phax plans lint docs/plans/2611021000-refunds-plan.md
    docs/plans/2611021000-refunds-plan.md: 5 errors, 0 warnings
    error    oracles  phase-05  oracle phase is discharged by the next phase, and phase-05 is the last phase
    error    oracles  phase-02  oracle phase is discharged by phase-01, which comes before it
    error    oracles  phase-03  plans tests/refunds.test.ts, an oracle file of phase-02, before phase-04 discharges it
    error    oracles  phase-03  interactive phase sits between oracle phase-02 and its discharging phase-04
    error    oracles  phase-02  oracle phase declared, but no "oracles" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)
    $? = 1

    Normative:
    - the check name `oracles`;
    - severity error, with the phase column;
    - exit 1;
    - the same errors the run preflight refuses on;
    - the provider is never spawned.

    Indicative: the wording.

### cli: phax run / phax resume — the oracle preflight — normative

    $ phax run --plan docs/plans/2611021000-refunds-plan.md
    Oracle preflight failed: 1 error.
      phase-02  oracle phase declared, but no "oracles" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)
    Check the plan with `phax plans lint docs/plans/2611021000-refunds-plan.md`.
    $? = 11

    $ phax resume refunds --yes      # the oracles block was removed after the run failed
    Oracle preflight failed: 1 error.
      phase-02  oracle phase declared, but no "oracles" provider is configured (…)
    $? = 11

    Normative:
    - exit 11;
    - every error of the shared `oracles` check is printed, the same errors `phax plans lint` reports for the same plan and config;
    - the refusal comes before any phase starts (for `phax run`, before the run is named), and an existing run's state is unchanged.

    Indicative: the wording and the layout.

### cli: phax schema upgrade — normative

before:

    $ phax schema upgrade
    Updated /repo/phax.schema.json
    Updated /repo/phax.user.schema.json

after:

    $ phax schema upgrade
    Updated /repo/phax.schema.json
    Updated /repo/phax.user.schema.json

    The output is unchanged. Both files now carry properties.oracles = { command: a non-empty string }, with no other key, and a description summarizing the contract: an oracle-request on stdin, a gate-report on stdout, and the provider is run only at the gate of an oracle or discharging phase. The configured gate step's `surface` enum stays local | structural | product.

    Indicative: the description's wording.

### config: a configured gate step with `"surface": "oracle"` — normative

before:

    { "command": "pnpm test", "surface": "local", "firing": "every-phase" }

after:

    { "command": "pnpm test", "surface": "oracle", "firing": "every-phase" }

    $ phax validate
    Config validation failed: gateProfiles.standard[5].surface: Expected "local" | "structural" | "product", actual "oracle"
      at: phax.json
    $? = 2

    Normative: refused at config load, with exit 2, naming the step's surface. Only the oracle step carries `oracle`.

    Indicative: the message.

### file: <run>/phase-NN/gate-attribution.json — normative

before:

    { "$schema": "https://docs.phax.run/schemas/gate-attribution/0.21.0.json", "phase": "phase-03", "steps": [
      { "command": "pnpm typecheck", "surface": "local", "result": "pass" },
      { "command": "pnpm test", "surface": "local", "result": "pass" } ] }

after:

    { "$schema": "https://docs.phax.run/schemas/gate-attribution/<release>.json", "phase": "phase-03", "steps": [
      { "command": "pnpm typecheck", "surface": "local", "result": "pass" },
      { "command": "pnpm test", "surface": "local", "result": "pass" },
      { "command": "node tools/vitest-oracles.mjs", "surface": "oracle", "result": "fail" } ] }

    Normative:
    - the keys are unchanged;
    - `surface` gains `oracle`, carried only by the oracle step, which is always last and present only at an oracle or discharging phase's gate;
    - `result` stays `pass` | `fail` | `refused`;
    - the widened enum is a new gate-attribution shape, and a new phase-record-manifest shape through `verifiedSurfaces`; documents stamped earlier stay readable.

    Indicative: the release in the URL.

### file: <run>/phase-NN/checks-attempt-NN.* — the oracle step's files — indicative

before:

    ~/.phax/runs/refunds/phase-03/
      checks-attempt-01.log
      checks-attempt-01.steps.json

after:

    ~/.phax/runs/refunds/phase-03/
      checks-attempt-01.log
      checks-attempt-01.steps.json
      checks-attempt-01.oracle-request.json     # the oracle request, as written on stdin
      checks-attempt-01.report-03.json          # the provider's gate report, as printed

    checks-attempt-01.log:
    $ pnpm typecheck
    …
    exit 0

    $ pnpm test
    …
    exit 0

    $ node tools/vitest-oracles.mjs
    stdin: checks-attempt-01.oracle-request.json
    report: checks-attempt-01.report-03.json
    exit 1

    Indicative: the request file's name. The report follows the existing report-SS naming.

### cli: phax run — an oracle step that refuses — indicative

    $ phax run --plan docs/plans/2611021000-refunds-plan.md
    ✓ phase-01  Refund port        committed  1a2b3c4
    ✓ phase-02  Refund oracles     committed  8be04d7
    ✗ phase-03  Partial refunds    gate step refused
    Run "refunds" paused: a gate step refused to run.
      node tools/vitest-oracles.mjs: tests/prune.test.ts is not at the oracle commit 8be04d7 — remedy: reset phase-03, then phase-02, and resume
    See ~/.phax/runs/refunds/resume-instructions.md for details.
    $? = 4

    This is the same pause any refused report step causes. An exhausted fix loop on a failing oracle step also exits 4.

### file: <run>/review-handoff.md — oracle pairs — indicative

    ## Oracle pairs

    | Oracle phase | Discharged by | Authored | Discharged |
    | ------------ | ------------- | -------- | ---------- |
    | phase-02     | phase-03      | pass     | pass       |

    The section is omitted entirely when the plan declares no oracle phase.

### cli: phax records explain — indicative

before:

    phase-03  committed  surfaces: local, structural

after:

    phase-03  committed  surfaces: local, oracle, structural
      oracle: discharges phase-02 — node tools/vitest-oracles.mjs: pass

### cli: phax reset-phase — the discharge first — indicative

    $ phax reset-phase refunds phase-02
    ✗ Cannot reset "phase-02" of run "refunds": its discharging phase "phase-03" is failed — reset phase-03 first.
    $? = 1

### internal: phase prompt — oracle role paragraph — indicative

    Oracle phase: This phase writes the oracles that phase-03 will discharge. In the oracle files (tests/refunds.test.ts, tests/prune.test.ts), every test you add or modify must carry your test framework's expected-failure marker, so that the test command stays green. You may delete tests. The oracles provider checks this at the gate.

    Discharging phase: This phase discharges the oracles phase-02 wrote. In the oracle files, the only change allowed is removing every expected-failure marker. Make the implementation satisfy the oracles as written. If an oracle cannot pass unchanged, stop and say so in the handoff: that is a spec question, not a bug to work around.

    Normative: no test framework and no marker named.

    Indicative: the wording.

### file: ~/.phax/authoring/<id>/prompt.md (headless plan authoring) — indicative

before:

    - An architecture provider is configured: before cutting phases, run `phax architecture` …
    - Return ONLY a JSON object …

after:

    - An architecture provider is configured: before cutting phases, run `phax architecture` …
    - An oracles provider is configured ("oracles" in phax config): you may declare an oracle phase and its discharging phase, as the skill's oracle-phase section says.
    - Return ONLY a JSON object …

    With none configured, the bullet reads:
    - No oracles provider is configured: declare no oracle phase; every phase's `oracle` is null.

    Normative:
    - a plan prompt always states whether an oracles provider is configured;
    - spec prompts are unchanged;
    - no provider runs at authoring.

    Indicative: the wording and the position.

### file: .claude/skills/phax-planning/SKILL.md — oracle phases — indicative

    ## Oracle phases

    - Declare an oracle phase only when an `oracles` provider is configured: the authoring prompt says so, and by hand you check `oracles` in phax.json and its overlays. Without one, keep tests and code in one phase.
    - The oracle phase writes the tests. Every test it adds or modifies carries the runner's expected-failure marker. It may delete tests, and it may plan stubs the tests compile against; only the files on its `**Oracle files:**` line are oracles.
    - Its discharging phase (the next phase, or the one named) removes the markers and writes the code. Removing the markers is the only change it makes to the oracle files.
    - No phase in between plans an oracle file, and no interactive phase sits in between.

    Normative:
    - the provider rule;
    - the two lines;
    - oracle files as a subset of the planned files;
    - the discharge's one allowed change.

    Indicative: the wording and the placement.

### file: the example Vitest provider (repository tooling) and phax's own phax.json — indicative

before:

    phax.json (the phax repository): no provider declared.

after:

    examples/vitest-oracles/
      README.md     # what it answers and why, and how to adapt it to another runner
      main.ts       # reads an oracle-request on stdin and prints a gate-report
      …             # its own tests run in phax's `pnpm test`

    phax.json (the phax repository):
      "oracles": { "command": "pnpm exec tsx examples/vitest-oracles/main.ts" }

    Normative:
    - it lives in the repository, outside `src/`;
    - no phax command runs it, and no phax module imports it;
    - phax's own phax.json declares it;
    - it answers the two verdicts as the example requirements say, from syntax trees.

    Indicative:
    - the folder (`examples/` or `scripts/`), the file names and the command;
    - the parser: web-tree-sitter with the TypeScript grammar as WebAssembly, so nothing is built natively.

### package: @lbdremy/phax-schemas — formats this spec changes — normative

before:

    snapshots/gate-attribution/0.21.0.schema.json         # surface: local | structural | product
    snapshots/phase-record-manifest/0.17.0.schema.json    # verifiedSurfaces: the same three
    snapshots/gate-request/0.20.0.schema.json
    snapshots/gate-report/0.21.0.schema.json

after:

    snapshots/oracle-request/next.schema.json             # new format, born with $schema
    snapshots/gate-attribution/next.schema.json           # surface gains "oracle"
    snapshots/phase-record-manifest/next.schema.json      # verifiedSurfaces gains "oracle"
    snapshots/plan-document/next.schema.json              # phase gains oracle
    snapshots/phax-plan/next.schema.json                  # phase gains oracle
    # unchanged: gate-request, gate-report

    Normative:
    - the format id `oracle-request`;
    - the `oracle` value in gate-attribution's and phase-record-manifest's surface enums;
    - gate-request and gate-report are unchanged.

    Indicative: which release names the snapshots, and whether plan-document and phax-plan share their `next` with mode and assignmentReason (J5, §10).

### file: docs/upgrading.md — indicative

before:

    ### 0.26.0

    - **Plan sidecars: `modelReason` becomes `assignmentReason`.** Run `phax artifact migrate-documents` …

after:

    ### 0.26.0

    - **Plan sidecars: `modelReason` becomes `assignmentReason`, and every phase gains `mode` and `oracle`.** Run `phax artifact migrate-documents` once. It writes `mode: "headless"` and `oracle: null` on every phase, in the same commit.
    - **Oracle phases** need an `oracles` provider: `phax plans lint` and `phax run` refuse an oracle phase without one.

    Normative: the step lives under the release that ships the plan-document change. Under J5 it joins that entry; otherwise it is an entry of its own.

    Indicative: the wording.

## 7. Non-goals

- steme's own `oracles` provider, or any provider other than the repository's Vitest example.
- Non-test oracles: disposition matrices, fixtures and golden files.
- Read-only enforcement of oracle files at the file-system or sandbox level. The discharging phase may write them, and the provider judges the result.
- Several discharging phases for one oracle phase, one phase discharging several oracle phases, or a phase in both roles.
- Changes to headless-review. Its §9 Q5 decision (no oracle-file refusal in `--append`) stands, and oracle declarations inside appended review plans are out of scope.
- Any phax knowledge of test frameworks, markers or test-file conventions, and any fallback check when no provider is configured.
- Example providers for other runners (pytest, Jest), or the example as a supported product with its own release.
- The full change-gates lint of docs/ideas/change-gates-from-the-harness.md: refusing a phase that plans both a file and its oracle, and the per-phase diff budget.
- A command to amend a wrong oracle in place. The spec disagreement is resolved with existing tooling: reset the pair, or abandon the run and revise the spec and plan.
- Changing the gate request, the gate report, or the configured gate steps' `input` and `output`.

## 8. Acceptance criteria

### An oracle phase defaults to the next phase

Given a plan whose phase-02 header carries `**Oracle phase:** yes` and `**Oracle files:** tests/refunds.test.ts, tests/prune.test.ts`, followed by phase-03, with both files among phase-02's planned files to create or edit, when `phax run --plan <plan> --dry-run` extracts it, then `phax-plan.json` gives phase-02 `"oracle": { "dischargedBy": "phase-03", "files": ["tests/refunds.test.ts", "tests/prune.test.ts"] }` directly after its `mode`, and gives every other phase `"oracle": null`. (refs §5.1, §5.2)

### An explicit discharging phase is kept

Given a four-phase plan whose phase-02 carries `**Oracle phase:** discharged by phase-04` and its oracle files, when the plan is extracted, then phase-02's `oracle` is `{ "dischargedBy": "phase-04", "files": [...] }` with its declared files in order, and phases 01, 03 and 04 carry `"oracle": null`. (refs §5.1, §5.2)

### The key is required and sits after mode

Given the JSON Schemas printed by `phax artifact schema plan` and published for `phax-plan`, when a phase's `properties` and `required` are read, and a phase lacking `oracle`, then one with `"oracle": { "dischargedBy": "phase-03" }`, is decoded, then `oracle` is required and sits directly after `mode`, which sits directly after `optionalFilesToEdit`; in the plan document, `assignmentReason`, `model` and `effort` stay the last three keys; and both malformed phases are refused. (refs §5.2)

### The plan document renders and projects the declaration

Given a headless plan document whose phase-02 has `"oracle": { "dischargedBy": "phase-03", "files": ["tests/refunds.test.ts"] }` and whose other phases have `"oracle": null`, when it is rendered and the rendered plan.md is extracted, then the plan.md carries `**Oracle phase:** discharged by phase-03` and `**Oracle files:** tests/refunds.test.ts` on phase-02 only, after its model and effort lines, and every extracted phase's `oracle` equals the document's. (refs §5.3, §5.2)

### Lifted sidecars get oracle null

Given a live plan sidecar stamped at the 0.25.0 plan-document shape, committed with its plan.md, when `phax artifact migrate-documents` runs, then the rewritten sidecar is at the current shape with `"oracle": null` on every phase, and its plan.md gains no oracle line. (refs §5.4)

### Lint rejects malformed declaration lines

Given in turn: a phase with `**Oracle phase:** yes` and no `**Oracle files:**` line; a phase with `**Oracle files:** tests/refunds.test.ts` and no `**Oracle phase:**` line; a phase with `**Oracle phase:** maybe`; and a phase whose `**Oracle phase:**` line sits under its `### Detailed instructions`, when `phax plans lint` runs on each, then each run exits 1 with one `error` row on the `oracles` check naming the phase and the line. (refs §5.5)

### Lint rejects a missing or earlier discharging phase

Given in turn, a plan whose last phase carries `**Oracle phase:** yes`, and a plan whose phase-02 carries `**Oracle phase:** discharged by phase-01`, when `phax plans lint` runs on each, then each run exits 1 with an `error` row on the `oracles` check naming the oracle phase and the discharging phase it resolved to. (refs §5.6)

### Lint rejects overlapping roles

Given in turn, a plan where phase-03 is discharged by phase-04 and also discharges phase-02, and a plan where phase-01 and phase-02 are both discharged by phase-03, when `phax plans lint` runs on each, then each run exits 1 with an `error` row on the `oracles` check naming phase-03. (refs §5.7)

### Lint rejects an oracle phase that lists no oracle file

Given an oracle phase whose `**Oracle files:**` line names no file, when `phax plans lint` runs, then it exits 1 with an `error` row on the `oracles` check naming that phase. (refs §5.8)

### Lint rejects an oracle file the phase does not plan

Given an oracle phase that plans tests/refunds.test.ts and the stub src/refunds/index.ts, and lists tests/refunds.test.ts and tests/other.test.ts as oracle files, when `phax plans lint` runs, then it exits 1 with one `error` row on the `oracles` check naming the phase and tests/other.test.ts, and src/refunds/index.ts is not treated as an oracle file. (refs §5.9)

### Lint rejects an oracle file planned between the pair

Given phase-02, an oracle phase discharged by phase-04 with oracle file tests/refunds.test.ts, and phase-03 listing tests/refunds.test.ts as an optional file, when `phax plans lint` runs, then it exits 1 with an `error` row on the `oracles` check for phase-03 naming tests/refunds.test.ts and phase-02, and the same plan with the file moved to phase-05 reports no `oracles` finding. (refs §5.10)

### Lint rejects an interactive phase inside the pair

Given phase-02, an oracle phase discharged by phase-04, and a phase-03 that carries `**Mode:** interactive` and plans no file, when `phax plans lint` runs, then it exits 1 with an `error` row on the `oracles` check naming phase-03 and the pair phase-02 → phase-04, and the same plan with the interactive phase placed after phase-04 reports no `oracles` finding. (refs §5.11)

### Lint rejects an interactive phase in an oracle role

Given a plan whose phase-02 carries `**Oracle phase:** yes` and whose phase-03 carries `**Mode:** interactive`, when `phax plans lint` runs, then it exits 1 with an `error` row on the `oracles` check naming phase-03. (refs §5.12)

### An oracle phase needs a configured provider

Given a well-formed oracle pair, first with no `oracles` key in any config layer, then with `"oracles": { "command": "./fake-oracles" }` in phax.local.json only, when `phax plans lint` runs in each configuration, then the first run exits 1 with an `oracles` error naming phase-02 and the missing `oracles` key; the second reports no `oracles` finding; and `./fake-oracles` is never spawned. (refs §5.13, §5.21)

### Run and resume refuse on exactly lint's errors

Given each defective plan of the lint criteria above, and separately a failed run of a well-formed oracle plan whose `oracles` block has since been removed, when `phax run --plan <plan>` and `phax resume <run> --yes` run, then each exits 11 and prints every error `phax plans lint` reports for the same plan and config. `phax run` names no run and creates no worktree or branch. The failed run's state and last error are unchanged. (refs §5.15, §5.14)

### The oracles block is strictly decoded and merged

Given three phax.json variants, `"oracles": { "command": "node tools/vitest-oracles.mjs" }`, `"oracles": { "command": "node tools/vitest-oracles.mjs", "timeout": 60 }` and `"oracles": { "command": "" }`, plus a phax.local.json overriding the command, when `phax validate` runs on each, and an oracle phase's gate runs with the first, then the first passes and the gate spawns the local command; the second exits 2 naming `timeout`; the third exits 2 naming `command`. (refs §5.16)

### Schema upgrade describes the block

Given a repository whose phax.schema.json predates this change, when `phax schema upgrade` runs, then it prints `Updated …/phax.schema.json` and `Updated …/phax.user.schema.json`, and both files define `oracles` with a required non-empty `command`, no other key, and a description. (refs §5.17)

### A configured step cannot claim the oracle surface

Given a phax.json gate profile with the step `{ "command": "pnpm test", "surface": "oracle", "firing": "every-phase" }`, when `phax validate` runs, then `phax run --plan <plan>`, then both exit 2 naming the step's `surface`, and no run is created. (refs §5.18)

### The oracle phase is judged on an authored request

Given a three-phase plan with the pair phase-02 → phase-03 and oracle files tests/refunds.test.ts and tests/prune.test.ts, a two-step gate profile, and a fake provider that records its stdin and cwd and prints a `checked` gate report with no finding, when phase-02's gate runs, then the provider is spawned once, after both configured steps pass, in phase-02's worktree before its commit. Its stdin is an `oracle-request` whose `$schema` names the `oracle-request` format (asserted by format id and release pattern), with `verdict` `authored`, `phase` and `oraclePhase` `phase-02`, `base` equal to phase-01's full commit, `files` equal to the two oracle files, and no `oracleCommit` key. The same request is saved beside the attempt's log. (refs §5.19, §5.22, §5.23)

### The discharging phase is judged on a discharged request

Given the same run after phase-02 committed, when phase-03's gate runs, then the provider receives `verdict` `discharged`, `phase` `phase-03`, `oraclePhase` `phase-02`, `base` equal to phase-01's full commit, `oracleCommit` equal to the full tip of `<run.branch>--phase-02`, and the same `files`. (refs §5.20, §5.22)

### No oracle step elsewhere

Given a five-phase plan whose only pair is phase-02 → phase-04, and a provider that logs each call, when `phax plans lint`, `phax validate --plan` and the run run to completion, then the provider was called only at the gates of phase-02 and phase-04: never at phase-01, phase-03 or phase-05, never from lint or validate, and never from the run preflight. (refs §5.21)

### The oracle step waits for a green profile

Given an oracle phase whose configured test step exits non-zero on its first attempt, when that gate attempt runs, then the provider is not spawned on that attempt, and the attempt's step record ends with the failing test step. (refs §5.19, §5.24)

### A passing verdict is attributed and saved

Given a provider that exits 0 with a `checked` gate report holding no finding, when the oracle or discharging phase's gate runs, then `gate-attribution.json` ends with `{ "command": "node tools/vitest-oracles.mjs", "surface": "oracle", "result": "pass" }`, the report is saved byte for byte beside the attempt's log, and the phase commits. (refs §5.24, §5.29)

### Findings drive the fix loop

Given a provider that answers one finding on the first attempt and none on the second, with `maxFixAttempts` 1, when the discharging phase's gate runs, then the fix prompt carries the finding's message and location, the provider is queried again on attempt 2, and the phase passes. (refs §5.25, §5.24)

### A refusal pauses with no fix attempt

Given a provider that answers `{ "$schema": …, "outcome": "refused", "reason": "…", "remedy": "…" }`, when the oracle phase's gate runs, then the oracle step is recorded `refused` as the last step, no fix prompt is built, `phax run` exits 4 printing the reason and remedy, and `phax resume <run>` runs that phase's gate again. (refs §5.26, §5.29)

### Provider errors fail the step

Given in turn: a provider command that does not exist; one that prints non-JSON; one that prints a gate report without `$schema`; one that exits 3 with a `checked` report holding no finding; and one that sleeps past the time cap, when the oracle phase's gate runs with each, then the oracle step is recorded `fail` each time, and the attempt's log names the reason. (refs §5.27)

### An undischargeable oracle pauses the run

Given a discharging phase whose provider returns a finding on every attempt, when the fix loop exhausts, then `phax run` exits 4, the run is failed at the discharging phase, and `phax resume <run>` runs that phase's gate again with a `discharged` request naming the same `oracleCommit`. (refs §5.28, §5.35)

### The oracle surface is verified like any other

Given a completed run with records enabled whose phase-03 passed its configured local steps and its oracle step, when its phase record and PR body are built, then phase-03's `verifiedSurfaces` lists `local` and `oracle`, and the PR body's verified surfaces include `oracle`. (refs §5.30)

### The review handoff lists the pair

Given a run with one oracle pair, both of whose sides passed, when the run reaches `review_open`, then `review-handoff.md` lists phase-02, phase-03 and a pass result for each side, and a run of a plan with no oracle phase has no such section. (refs §5.31)

### Records explain names the role

Given a completed run with records enabled and one oracle pair, when `phax records explain` is given the commit of phase-02, then that of phase-03, then the first names phase-02 as the oracle phase discharged by phase-03, with its oracle-step result; the second names phase-03 as discharging phase-02, with its result. (refs §5.32)

### The prompt states the role without naming a framework

Given the same oracle plan run in a TypeScript/Vitest project and in a Python/pytest project, when the prompts of phase-02 and phase-03 are built, then each prompt carries its role paragraph naming the counterpart phase and the oracle files. The paragraphs are identical across the two projects apart from those names, and neither names `fails`, `xfail` or a framework. (refs §5.33)

### Marker removal is not an unplanned edit

Given a discharging phase that does not list the oracle files among its own planned edits, and that edits them to remove markers, when its files are reconciled, then `file-reconciliation.json` reports no unplanned edit for those oracle files. (refs §5.34)

### Reset the discharge first

Given a run failed at discharging phase-03, whose oracle phase-02 is committed, when `phax reset-phase <run> phase-02` runs, then `phax reset-phase <run> phase-03`, `phax reset-phase <run> phase-02` and `phax resume <run> --yes`, then the first reset refuses, naming phase-03, and changes nothing. After the two resets, the resume re-runs phase-02, and phase-03's `discharged` request names phase-02's new commit as `oracleCommit`. (refs §5.36, §5.35)

### The authoring prompt states whether a provider is configured

Given a repository with `"oracles": { "command": "node tools/vitest-oracles.mjs" }`, then one with no `oracles` key in any layer, when `phax artifact new plan refunds --headless --brief <file>` writes its prompt.md in each, then the first prompt says an oracles provider is configured and oracle phases may be declared; the second says none is configured and no oracle phase is declared; a spec authoring prompt carries neither line; and no provider is spawned. (refs §5.37, §5.38)

### The planning skill states the rule

Given the phax-planning skill shipped with phax, when its oracle-phase section is read, then it says an oracle phase is declared only when an `oracles` provider is configured, and it gives the `**Oracle phase:**` and `**Oracle files:**` lines, the oracle files as a subset of the phase's planned files, and marker removal as the discharge's only change to them. (refs §5.39)

### Plans without oracle phases are unchanged

Given a plan with no oracle declaration, run once with an `oracles` provider configured and once without, when `phax plans lint`, `phax run` and `phax records explain` run, then both runs produce the same lint findings, prompts, `gate-attribution.json` steps and exit codes, with `"oracle": null` on every phase, no `oracle`-surface step, and the provider never spawned. (refs §5.40)

### phax neither reads oracles nor rewrites the gate

Given an oracle pair run with a filesystem port that records every read, and a gate profile of three steps, when both phases' gates run, then phax itself reads no oracle file path, and each phase's attribution lists the three configured steps unchanged and in order, followed only by the oracle step. (refs §5.41)

### The example stays outside the CLI

Given the phax repository, its built CLI and its packed npm packages, when `phax --usage` is read, `src/` is searched for imports, and the packages' file lists are read, then no phax command names or runs the example, no module under `src/` imports it, and, under q-example-ships' recommendation, neither npm package contains it. (refs §5.42)

### phax's own config declares the example

Given the phax repository's phax.json, when `phax validate` runs and the resolved `oracles.command` is executed on a made-up `authored` request, then validation passes, and the command prints a gate-report carrying `$schema`. (refs §5.43)

### The example judges authored oracles

Given a git repository whose `base` commit holds tests/prune.test.ts with the tests `keeps the newest run` and `drops archived runs`, and a working tree that adds `test.fails('refunds a partial capture', …)` and `it('caps a refund at the invoice total', …)`, modifies `keeps the newest run` without `.fails`, and deletes `drops archived runs`, when the example receives an `authored` request for tests/prune.test.ts, then it prints a `checked` gate report with exactly two findings, naming `caps a refund at the invoice total` and `keeps the newest run`, and none for the deleted test or the `test.fails` one. (refs §5.44)

### The example finds a marker left at discharge

Given an oracle commit whose tests/refunds.test.ts holds two `test.fails` tests, and a working tree that removes one of the two markers and changes nothing else, when the example receives a `discharged` request, then it reports exactly one finding, naming the remaining `.fails`; with both markers removed and nothing else changed, it prints a `checked` report with no finding and exits 0. (refs §5.45, §5.46)

### The example refuses any other change at discharge

Given the same oracle commit and, in turn, working trees that remove both markers and also change `toBe(120)` to `toBe(100)`, delete a test, or replace a `test.fails` with `test.skip`, when the example receives a `discharged` request for each, then each answer holds a finding naming tests/refunds.test.ts. (refs §5.46)

### Reformatting never changes the example's answer

Given the same oracle commit and a working tree that removes both markers and also re-indents the file, moves its line breaks and adds trailing commas, and separately a `base` and working tree that differ in one unchanged test only by re-indentation, when the example receives a `discharged` request for the first and an `authored` request for the second, then neither answer holds a finding. (refs §5.47)

### The example refuses a request it cannot read

Given in turn, a request with no `$schema`, and one whose `verdict` is `approved`, when the example receives each, then it prints a `refused` gate report carrying `$schema`, a reason naming the defect, and a remedy. (refs §5.48)

## 9. Open questions

### q-request — Which request does phax write on the oracle step's stdin: a new `oracle-request` format, or the existing `gate-request` extended?

- oracle-request — A new versioned `oracle-request` format: `$schema`, `verdict` (`authored` | `discharged`), `phase`, `oraclePhase`, `base`, `files`, and `oracleCommit` on `discharged` only — two variants, each with exactly its keys — abandons: One request reader for every provider phax spawns at a gate. A provider that is both an oracles provider and a configured gate-report step reads two formats, and phax versions, snapshots and publishes one more format.
- gate-request-extended — The existing `gate-request` gains a required `oracle` key: null for configured steps, and `{ verdict, oraclePhase, oracleBase, oracleCommit, files }` for the oracle step — abandons: gate-request's single meaning and its stable shape. Every declaring step's request changes shape for a key only one step reads. Its `base` (the gated phase's) is not the oracle base the verdict needs, so the block repeats a second base. A nullable block also admits combinations, such as a discharged verdict with no oracle commit, that two explicit variants exclude.

Recommendation: oracle-request — The lost shared reader costs little. phax already gives each provider its own request format (brief-request, architecture-request), and a provider that is also a configured report step is the rare case. Extending gate-request would change a published shape (0.20.0) for every report step in every repository, to carry a block one step reads, and would need a second `base` beside the gated phase's. A separate format keeps both shapes explicit per variant, with no null-filled keys.

### q-example-ships — Where does the example Vitest provider ship?

- repo-only — Repository tooling only: it lives in the phax repository under `examples/` (or `scripts/`), phax's own plans use it, and it ships in neither npm package — abandons: A ready-to-install Vitest provider for other repositories: they copy the example's folder, or write their own against its README.
- launcher-bin — Shipped in `@lbdremy/phax` as a second executable beside `phax` — abandons: The launcher's thinness and phax's framework neutrality. Every install carries tree-sitter and a TypeScript grammar for one test framework, under phax's own name, and the example's behaviour becomes something each release must keep working.
- own-package — Published as its own npm package, released in lockstep with phax — abandons: A release with two packages. A third package means another trusted publisher, version check, smoke test and approval in the release workflow, for a tool with one known consumer.

Recommendation: repo-only — The operator decided the example is repository tooling, there so that phax's own plans can be oracle-first and provider authors have a reference. Shipping it under phax's name would contradict the guiding rule that only the provider knows what an oracle is. A separate package can be cut later, at no cost to this spec, if a second consumer appears.

### q-interactive-role — May an interactive phase be the discharging phase of an oracle phase? (It can never be an oracle phase: oracle files must be planned files to create or edit, and an interactive phase plans none.)

- refuse — No: an interactive phase takes no oracle role. It is a lint error and an exit-11 preflight refusal on the `oracles` check — abandons: A person writing the implementation against oracles an agent wrote, during the stop, with the oracles provider judging the closing gate.
- allow-discharge — Yes: an interactive phase may discharge, and its closing gate runs the oracle step with a `discharged` request — abandons: interactive-phases' review-only rule (q-planned-work). Discharging is implementation the planner foresaw, so the phase would carry planned work. A red oracle verdict at closing would also return the phase to the person with no fix loop.

Recommendation: refuse — Discharge is foreseeable work, and interactive-phases decided that foreseeable work belongs to an agent phase under the gate and the fix loop. Refusing also keeps every oracle verdict on a headless phase, where a finding has a fix loop to drive. A person who wants to review the oracles places an interactive phase before the oracle phase, or after the discharge.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Decided by the operator on 2026-10-20, not to reopen:
  - any provider will do: the `oracles` block, merged across layers like `brief` and `architecture`;
  - the phax repository carries an example Vitest provider that compares syntax trees, and phax's own phax.json declares it;
  - the planner declares an oracle phase only when a provider is configured, and the prompt, the skill, lint and the preflight all say so;
  - the request and the answer are versioned phax formats with a required `$schema`, and the answer is the existing `gate-report`;
  - the phase shape of the joint session: J1, a separate `oracle` key; J2, the key directly after `mode`, with `assignmentReason`, `model` and `effort` last, and the oracle lines after the Mode line;
  - one shared `oracles` check refusing `phax run` and `phax resume` with exit 11 (J4), which also carries the rule handed over by interactive-phases.
- Lifted from the abandoned 2026-09-28 spec, unattributed, not reopened:
  - Q1 `oracle-side-line`: the declaration sits on the oracle phase and defaults to the next phase; its lines now follow the Mode line;
  - Q2 `one-designated`: one discharging phase per oracle phase, and no phase in both roles;
  - Q3 `error-and-refuse`: a lint error and a run refusal without a provider, now exit 11 instead of exit 2 under J4;
  - Q4 `new-oracle-surface`: a new `oracle` surface that only the oracle step carries;
  - Q5 `explicit-subset`: the oracle files are listed, as a subset of the oracle phase's planned files.
  They are recorded here because a headless authoring session leaves §9b empty.
- The oracle step is judged exactly as an `output: "gate-report"` step, by the code that judges one today:
  - findings fail the step and drive the fix prompt;
  - a `refused` report pauses the phase with no fix attempt (exit 4, resumable), a stop on a machine-detected cause that runs-stay-autonomous allows;
  - anything unreadable fails as a broken step;
  - review notes reach only the reviewer.
  The oracle step runs after every configured step the attempt fires, and only when all of them passed.
- Q4's widened surface changes two published shapes: gate-attribution (current shape 0.21.0) and phase-record-manifest (current shape 0.17.0, through `verifiedSurfaces`). Each gets a `next` snapshot and a frozen decoder for its current shape, and documents stamped earlier stay readable. A configured gate step keeps its own three-value enum, so phax.json's JSON Schema still offers only `local`, `structural` and `product`, and `"surface": "oracle"` on a configured step is refused at decode. gate-request and gate-report are unchanged.
- The rule against an interactive phase inside a pair settles the question interactive-phases handed over. No person's correction can land between the two phases, so the discharge always judges the oracle phase's own commit. A correction after the discharge belongs to an ordinary interactive phase and runs no oracle step.
- `phax validate --plan` stays a decode of `phax-plan.json`. It refuses a phase whose `oracle` is missing or malformed, and runs neither the `oracles` check nor the provider.
- Release, under J5 as revised on 2026-10-20, in two cases:
  - If this spec is approved before the joint plan-document plan of assignment-bounds and interactive-phases is cut, `oracle` rides that change. There is one frozen copy of the 0.25.0 plan-document shape and one `phax artifact migrate-documents` lift, which renames `modelReason`, writes `mode: "headless"` and writes `oracle: null`. There is one new phax-plan shape carrying `mode` and `oracle`, with a frozen copy of 0.17.0, one treatment of the extraction cache and of in-flight runs, and one upgrading entry. The J5 lines in those two specs and in NEXT_STEPS.md then describe a superseded plan.
  - Otherwise this spec takes its own lift after theirs: a frozen copy of the plan-document and phax-plan shapes they cut, a second lift that writes `oracle: null`, its own extraction-cache treatment and its own upgrading entry.
  Either way, `oracle-request`, gate-attribution and phase-record-manifest are this spec's own shape changes.
- The example provider's semantics:
  - it compares syntax trees, so formatting never changes a verdict;
  - in the authored verdict, a deleted test is allowed;
  - in the discharge, the oracle files' trees at the oracle commit, with every `.fails` member access removed, must equal their trees now;
  - an oracle file with a syntax error is a finding, not a refusal, so the fix loop can repair it.

Left open:

- q-request, q-example-ships and q-interactive-role (§9).
- The spelling of the plan.md lines, the lint, preflight and refusal messages, the prompt paragraphs, the handoff table, the records-explain line and the skill text. All are indicative.
- The provider time cap. 120 s is indicative: it covers a syntax-tree comparison of a few files without letting a hung provider stall an unattended phase. Configured report steps have no cap today.
- Where the `oracles` check sits in RUN_PREFLIGHT_CHECKS (after `phase-sections`, beside the `interactive` check), and whether `phax run --dry-run`, which returns before the preflight, reports its errors as a "Preflight will fail" line.
- How the oracle role reaches `phax records explain`. Either a new per-phase record field (required, null for ordinary phases, under the no-shims rule), or a derivation from the recorded `phax-plan.json`.
- How the example identifies a test across two trees (its `describe` path and title), how it treats `test.each` tables and nested `describe` blocks, whether a comment change counts as a change, and what it answers for an oracle file missing at a commit.
- The example's folder (`examples/` or `scripts/`), its command in phax.json, and its parser. web-tree-sitter with the TypeScript grammar as WebAssembly is suggested.
- The oracle request's saved file name. `checks-attempt-NN.oracle-request.json` is indicative.

Constraints:

- No back-compat shims. `oracle` is required on every phase of `phax-plan.json` and of the plan document, and is null on every phase that is not an oracle phase. Older sidecars are lifted, never read with the key missing. The plan must say how extraction-cache entries and in-flight runs written by an older binary are treated.
- Explicit per-variant enums:
  - `verdict` is `authored` | `discharged`;
  - each request variant carries exactly its keys, with `oracleCommit` on `discharged` only;
  - the configured-step surface stays `local` | `structural` | `product`;
  - the recorded surface is that set plus `oracle`.
- Every provider request and answer carries a required `$schema`. `oracle-request` is born with it and joins FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS.
- phax stays autonomous:
  - a missing provider refuses only at lint and at the start preflight;
  - a failing provider fails the oracle step;
  - a refusing provider pauses the phase as any refused report step does;
  - nothing stops a phase to wait for a person.
- phax gains no test-framework knowledge: no built-in provider, no marker list and no test-file convention in `src/`. The example lives outside `src/`, so the port rules do not bind it, and nothing in `src/` imports it. It must install without native builds.
- Respect the layers:
  - the `oracles` check and the pair resolution are pure domain;
  - the provider runs through the Shell port, as gate steps do;
  - the config block is decoded, and the request encoded, through schemas.
- Fixtures and examples are made up: acme-billing, refunds, tests/prune.test.ts, tests/refunds.test.ts. Tests hold across a release cut: they assert `$schema` URLs by format id and release pattern, never by the running version.
- Update:
  - `phax --usage`: cmd run, cmd resume, cmd plans lint, and the oracles contract;
  - README §Oracle provider, beside the other providers;
  - docs/upgrading.md;
  - the phax-planning skill;
  - the phax-decide-plan skill's P3, where 'read-only for the implementing phase' becomes 'changed only by removing the markers, judged by the oracles provider';
  - NEXT_STEPS.md, whose oracle-phases entry no longer waits for `steme oracles`.
- headless-review is unchanged: its `--append` keeps no oracle-file refusal.

## 11. Docs page

Page: README §Oracle provider (under §Configure, beside the other providers) and the docs-site page built from it, plus an oracle-phase section in the phax-planning skill

Reader: Two readers. First, a project owner who wants an agent's tests written before, and judged apart from, the code that satisfies them, and who configures an `oracles` provider: their own, or one adapted from phax's Vitest example. Second, a planner writing an oracle-first plan.

Example: In acme-billing's phax.json: "oracles": { "command": "node tools/vitest-oracles.mjs" }.

In plan.md, phase-02 carries `**Oracle phase:** yes` and `**Oracle files:** tests/refunds.test.ts`, and writes `test.fails('caps a refund at the invoice total', …)`. At phase-02's gate, phax sends {"$schema": "…/oracle-request/<release>.json", "verdict": "authored", "phase": "phase-02", "oraclePhase": "phase-02", "base": "3f2a91c…", "files": ["tests/refunds.test.ts"]}, and the provider answers a checked gate report with no finding.

phase-03 removes `.fails` and writes the refund cap. Its gate sends verdict "discharged", with phase-02's commit as oracleCommit. Had phase-03 changed toBe(120) to toBe(100), the provider's finding would drive the fix loop, and an oracle that cannot pass unchanged pauses the run with exit 4.

Without an oracles block, `phax plans lint` reports an error on the oracles check, and `phax run` refuses with exit 11.
