---
status: Approved
date: 2026-10-27
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-27
  baseline: 0524add
---
# Acceptance tests, not oracles

## 1. Context

phax lets a plan freeze tests before the code exists. One phase writes failing tests from the source spec's acceptance criteria, each behind the test framework's expected-failure marker so the gate stays green. A later phase removes the markers and writes the code, and may not otherwise touch those files. A configured provider judges both gates. phax calls the first phase an oracle phase, its tests oracles, its files oracle files, and says the later phase discharges them.

The name runs through every layer. In plan.md it is the header lines `**Oracle phase:** yes | discharged by phase-NN` and `**Oracle files:** …`, checked by lint's `oracles` check. In phax-plan.json and the plan sidecar it is the phase key `oracle: { dischargedBy, files } | null`. In config it is the `oracles` provider block beside `brief` and `architecture`. Then come the `oracle-request` document on that provider's stdin (verdicts `authored` / `discharged`, keys `oraclePhase`, `oracleCommit`), saved as `checks-attempt-NN.oracle-request.json`, and the gate attribution's appended step with `surface: "oracle"`. Run status has the hold selection `oracle`, and phase status has `oracleStep` on a closed stop. The phase record manifest has the role `oracle` (with `dischargedBy`) or `discharging` (with `oraclePhase`). On the CLI it is `phax run --hold oracle`, `phax resume --skip-oracle` and "Oracle preflight failed", with exit 11. It is also the `## Oracle role` prompt section, the fix-prompt tail, the `oracle.edits.unjudged` telemetry event, the `oracle role` row and the `oracleRole` JSON key of `phax plans overview`, the `oracle` row of `phax records explain`, the `## Oracle pairs` section of the review handoff, `oracle` among a phase record's and a run's verified surfaces, the schemas package's `parseOracleRequest`, the docs page `/guide/oracle-phases`, the `examples/vitest-oracles` example, and four skills.

The test line is `<guarantee> — <size> · <technique> · <oracle> · <oracle | in-phase>[ · <criterion>]`. Its fourth field is what judges the result. Its fifth is the loop that owns the test. The closed technique list is `example, table, property, metamorphic, stateful, fuzz, contract, smoke`. The `phax-review` skill's `wrong-oracle` escape already uses the word in its literature sense.

Ground read:

- `docs/briefs/acceptance-tests.md` — The operator's brief and the decisions settled on 2026-10-27.
- `src/domain/plan/oracleCheck.ts` — The `oracles` lint check, its messages, and the `**Oracle phase:**` / `**Oracle files:**` rules.
- `src/domain/plan/phaseHeader.ts` — How the header lines are read: `yes` or `discharged by phase-NN`, and `Model reason` as the precedent for an old label refused by name.
- `src/domain/authoring/renderPlan.ts` — The header paragraph rendered from a plan sidecar: `**Oracle phase:** discharged by phase-NN`.
- `src/schemas/testLine.ts` — `TestLoopSchema` `oracle | in-phase`, the closed technique list, and the fourth field `oracle`.
- `src/schemas/phaxPlan.ts` — The phase key `oracle: { dischargedBy, files } | null`.
- `src/schemas/phaxConfig.ts` — The `oracles` provider block beside `brief` and `architecture`. Unknown keys are refused (`onExcessProperty: error`).
- `src/schemas/oracleRequest.ts` — The `oracle-request` format: verdicts `authored` / `discharged`, keys `oraclePhase`, `oracleCommit`.
- `src/schemas/status.ts` — The `--hold` selection `oracle` in run-status and `oracleStep` on a closed stop in phase status.
- `src/schemas/runRecord.ts` — The record manifest's `oracle` role: `oracle` with `dischargedBy`, `discharging` with `oraclePhase`.
- `src/schemas/gateAttribution.ts` — The appended gate step with `surface: "oracle"`, and `skipped` from `--skip-oracle`.
- `src/schemas/schemaUrl.ts` — The persisted format ids, `oracle-request` among the formats born with `$schema`.
- `src/app/promptGeneration.ts` — The `## Oracle role` section and its two paragraphs.
- `src/domain/gate/fixPrompt.ts` — The fix-prompt tail of an oracle step that failed.
- `src/app/executePlan.ts` — "Oracle preflight failed" and the missing-oracle-commit refusal.
- `src/domain/hold.ts` — Parsing `--hold oracle` and its messages.
- `src/domain/whatsNext.ts` — The recovery steps after a failed oracle step, `--skip-oracle` among them.
- `src/domain/telemetry/events.ts` — The `oracle.edits.unjudged` event, the only telemetry event named after oracles.
- `src/cli/cliDocs.ts` — Help texts that name oracle phases, the `oracles` provider and "Oracle preflight failed".
- `phax.usage.kdl` — `--skip-oracle`, the `--hold` help, and the usage contract texts.
- `src/domain/plan/overviewRender.ts` — The `oracle role` row of `phax plans overview`.
- `src/cli/commands/records.ts` — The `oracle` row of `phax records explain`.
- `src/domain/plan/overview.ts` — The `oracleRole` of `phax plans overview --json`: `oracle` with `dischargedBy`, `discharging` with `oraclePhase`, or `none`.
- `src/domain/plan/oraclePairs.ts` — The review handoff's `## Oracle pairs` table (`Oracle phase | Discharged by | Authored | Discharged`) and the `--skip-oracle` refusals.
- `src/schemas/surface.ts` — The recorded surface `oracle`, also listed in a phase record's `verifiedSurfaces`, the run's verified surfaces and the PR body.
- `packages/schemas/src/formats/oracleRequest.ts` — The schemas package's `oracleRequestFormat`, `parseOracleRequest`, `toLatestOracleRequest`.
- `.claude/skills/phax-planning/SKILL.md` — The "Oracle phases" section, "What makes a good oracle", the loop coordinate, and the "Oracle candidate" column.
- `.claude/skills/phax-review/SKILL.md` — The `wrong-oracle` escape (the literature meaning, kept) beside "oracle pairs" and "discharged" (renamed).
- `.claude/skills/phax-decide-plan/SKILL.md` — `P3` "Oracle first" and the `oracle-authoring` phase.
- `.claude/skills/phax-decide-review/SKILL.md` — `R4` "Oracles are not fix targets".
- `docs/upgrading.md` — The 0.28.0 entry, the model for the 0.29.0 entry: migrate-documents, hand-written plans, runs in flight.
- `site/pages.ts` — The `/guide/oracle-phases` page, sourced from `docs/oracle-phases.md`.

## 2. Problem

In testing literature an oracle is the mechanism that decides whether a test passes (Barr, Harman, McMinn, Shahbaz and Yoo, The Oracle Problem in Software Testing: A Survey, IEEE TSE 2015). Every test has one, so "oracle phase" does not say what the phase does. What phax does is acceptance test-driven development (Koskela 2007; Pugh 2010; Adzic 2011; the outer loop of Freeman and Pryce 2009): a separate phase writes failing tests from the spec's acceptance criteria, and a later phase makes them pass unchanged. The wrong word now carries two meanings in one test line, where the fourth field is a real oracle and the fifth calls the loop `oracle`. A reader of a plan, a record or the review skill cannot tell which meaning a sentence uses. "Discharge" is jargon that nothing else in testing uses for making a test pass. phax is not at 1.0, so the names can still change without a compatibility layer.

## 3. Product goal

Every surface phax ships calls the phase that writes failing tests an acceptance phase, its tests acceptance tests in acceptance test files, and the later phase the one that passes them. The word oracle keeps only its literature meaning: the test line's fourth field, the `wrong-oracle` review escape, and prose about what judges a test. The test line gains one technique, `boundary`. Files a person writes that still use an old name are refused with the new name. Live plan sidecars are lifted by the existing migration, and records already written stay readable.

> An oracle is what judges a test; an acceptance test is a test written from a spec's acceptance criterion before the code, and phax never uses one word for the other.

## 4. Terminology

- **acceptance phase** — A plan phase that writes failing tests from the source spec's acceptance criteria, each behind the test framework's expected-failure marker. Formerly "oracle phase".
- **acceptance test** — A test written in an acceptance phase and frozen until its passing phase. The name states the test's purpose, checking a specified acceptance criterion, not its size: an acceptance test may be `small`. Formerly "oracle".
- **acceptance test files** — The files an acceptance phase declares on its `**Acceptance test files:**` line: the tests and whatever they judge with (generators, tables, fixtures). Formerly "oracle files".
- **passing phase** — The later phase that removes the expected-failure markers and writes the code so the acceptance tests pass. It "passes" them. Formerly the "discharging phase" that "discharged" them.
- **acceptance pair** — An acceptance phase and its passing phase. Formerly "oracle pair".
- **acceptance provider** — The command configured under `acceptance` in phax.json or its overlays, which judges both gates of an acceptance pair. Formerly the `oracles` provider.
- **acceptance step** — The gate step phax appends at the gate of each phase of an acceptance pair, which runs the acceptance provider. Formerly the "oracle step".
- **oracle** — In the literature sense only: what judges a test's result (an expected value, an invariant, a reference table, a relation between runs, a typed refusal). It is the test line's fourth field.
- **boundary** — A test technique: inputs chosen by equivalence partition and boundary value, meaning the empty case, each limit, and just outside each limit.
- **old name** — Any name in the left column of the rename table (§10, settled), as it appears in a file a person writes, a CLI argument, or a document phax reads.

## 5. Functional requirements

### 5.1 Acceptance phase header lines

WHEN a plan phase's header paragraph carries `**Acceptance phase:** yes` or `**Acceptance phase:** passed by phase-NN` followed by `**Acceptance test files:** <paths>` THE system SHALL read the phase as an acceptance phase whose passing phase is the next phase or phase-NN, applying every rule the `oracles` check applied to oracle phases under the `acceptance` lint check.

### 5.2 Old header lines refused

IF a plan phase carries a `**Oracle phase:**` or `**Oracle files:**` line THEN the system SHALL report an `acceptance` lint error reading `**Oracle phase:** is no longer read: write **Acceptance phase:**` or `**Oracle files:** is no longer read: write **Acceptance test files:**`, and `phax run` and `phax resume` SHALL refuse the plan with exit 11 and "Acceptance preflight failed".

### 5.3 Acceptance loop

The system shall read and write a test line's loop as exactly `acceptance` or `in-phase`, with `acceptance` meaning the test is written in an acceptance phase and frozen until its passing phase.

### 5.4 Old loop refused

IF a test line holds `oracle` in its loop position THEN the system SHALL report a `tests` lint error reading `test line <n> uses the loop 'oracle', which is no longer read: write 'acceptance'`, and SHALL refuse the plan wherever it refuses a departing test line today.

### 5.5 Boundary technique

The system shall accept `boundary` as a test technique, placed in the closed list directly after `example`: example, boundary, table, property, metamorphic, stateful, fuzz, contract, smoke.

### 5.6 Acceptance provider

WHERE a config layer declares `"acceptance": { "command": … }` THE system SHALL run that command as the acceptance step at the gate of every phase of an acceptance pair, exactly as it ran the `oracles` provider.

### 5.7 Old provider key refused

IF phax.json, phax.local.json or ~/.phax/config.json carries an `oracles` key THEN the system SHALL refuse the configuration with a message naming the file and reading `"oracles" is no longer read: write "acceptance"`.

### 5.8 Hold acceptance phases

WHEN `phax run --hold acceptance` names a run THE system SHALL hold every acceptance phase of the plan and record the hold selection `acceptance`.

### 5.9 Old hold selection refused

IF `--hold` is given `oracle`, alone or in a list THEN the system SHALL refuse it before the run is named with `--hold 'oracle' is no longer read: write --hold acceptance`.

### 5.10 Skip the acceptance step

WHEN `phax resume <run> --skip-acceptance` restarts at a phase of an acceptance pair THE system SHALL record its acceptance step as skipped and still run the configured gate.

### 5.11 Old skip flag refused

IF `phax resume` is given `--skip-oracle` THEN the system SHALL refuse it with `--skip-oracle is no longer read: write --skip-acceptance`, resuming nothing.

### 5.12 Acceptance request

The system shall write on the acceptance provider's stdin, and save as `checks-attempt-NN.acceptance-request.json`, an `acceptance-request` document stamped `https://docs.phax.run/schemas/acceptance-request/0.29.0.json`, whose verdict is `authored` or `passed` and whose keys are `phase`, `acceptancePhase`, `base`, `files`, plus `acceptanceCommit` on a `passed` request.

### 5.13 New names in written documents

The system shall write phax-plan, plan-document, run-status, phase-status, gate-attribution and phase-record-manifest documents stamped at 0.29.0, carrying only the new names of the rename table: phase key `acceptance: { passedBy, files } | null`, hold selection `acceptance`, stop key `acceptanceStep`, step surface and verified surface `acceptance`, record role `acceptance` with `passedBy` or `passing` with `acceptancePhase`.

### 5.14 Records already written stay readable

WHEN phax or the schemas package reads a record, gate attribution, oracle request, phase status or run status written by an earlier release THE system SHALL read it, presenting its oracle names under the new names of the rename table.

### 5.15 Live plan sidecars lifted

WHEN `phax artifact migrate-documents` runs in a repository with a live plan sidecar below 0.29.0 THE system SHALL rewrite it at 0.29.0 under the new names (phase `acceptance` with `passedBy`, loop `acceptance`), re-render its plan.md header lines, and commit the result.

### 5.16 Unmigrated sidecars refused

IF a live plan sidecar is below 0.29.0 THEN `phax artifact approve`, `reopen` and `decide` SHALL refuse it with exit 12, naming `phax artifact migrate-documents`.

### 5.17 Archived artifacts untouched

WHILE a plan or spec lives under an `archive/` folder THE system SHALL leave it as written and keep reading it.

### 5.18 Runs in flight refused

IF a run's phax-plan.json was extracted by an earlier release THEN `phax resume` and `phax validate --plan` SHALL refuse it, naming `phax archive <run> --force`, while `phax ls` and `phax session-info` still show the run.

### 5.19 Acceptance names in every message

The system shall name acceptance phases, acceptance tests, acceptance test files, passing phases and the acceptance provider, step and pair in every message, help text, usage contract, prompt section, telemetry event, overview and records row, as the rename table lists.

### 5.20 Oracle in its literature sense only

The system shall use the word oracle only for the test line's fourth field, the `phax-review` skill's `wrong-oracle` escape, and prose about what judges a test, and shall use the word discharge nowhere, except in the refusals of old names and where it reads or lifts a document written by an earlier release.

### 5.21 The planning skill rewritten

The bundled phax-planning skill shall teach acceptance phases under an "Acceptance phases" section and an "Acceptance candidate" defaults column. It shall state that acceptance names a test's purpose, not its size, and describe the `boundary` technique.

### 5.22 Upgrade entry

The upgrading guide shall carry a 0.29.0 entry naming every step an operator takes: the migration, hand-written plans, the phax.json key and its overlays, the `--hold` and `--skip-acceptance` spellings, the acceptance provider's command reading an `acceptance-request`, scripts reading the renamed status, record and overview names or the schemas package's renamed exports, and runs in flight.

## 6. Surface

### file: plan.md acceptance phase header lines — normative

Summary: A plan declares the phase that writes failing tests with `**Acceptance phase:**` and `**Acceptance test files:**`, naming the phase that passes them.

before:

    ## phase-03 — Acceptance tests for publish {#phase-03-publish-tests}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium
    **Oracle phase:** discharged by phase-04
    **Oracle files:** `tests/e2e/publish.test.ts`

after:

    ## phase-03 — Acceptance tests for publish {#phase-03-publish-tests}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium
    **Acceptance phase:** passed by phase-04
    **Acceptance test files:** `tests/e2e/publish.test.ts`

### file: plan.md test strategy line — normative

Summary: A test written in an acceptance phase is marked `acceptance` in its loop field, and `boundary` is a new technique for empty cases and limits.

before:

    - every (state, transition) pair is accepted or refused as the table says — small · table · transition table · oracle · AC-3

after:

    - every (state, transition) pair is accepted or refused as the table says — small · table · transition table · acceptance · AC-3
    - an empty name and a 64-character name are accepted, a 65-character one refused — small · boundary · the 64-character limit · in-phase

### cli: phax run — a plan with the old names — normative

Summary: Running a plan that still uses the oracle names is refused before anything runs, and each refusal names what to write instead.

    $ phax plans lint docs/plans/2610271100-publish-plan.md
    docs/plans/2610271100-publish-plan.md: 3 errors, 0 warnings
    error    acceptance  phase-03  **Oracle phase:** is no longer read: write **Acceptance phase:**
    error    acceptance  phase-03  **Oracle files:** is no longer read: write **Acceptance test files:**
    error    tests       phase-03  test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance'
    $? = 1

    $ phax run docs/plans/2610271100-publish-plan.md
    docs/plans/2610271100-publish-plan.md: phase-03 test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance' — run phax plans lint docs/plans/2610271100-publish-plan.md

    $ phax run docs/plans/2610271100-publish-plan.md        # test line rewritten, header lines not yet
    Acceptance preflight failed: 2 error(s).
      phase-03  **Oracle phase:** is no longer read: write **Acceptance phase:**
      phase-03  **Oracle files:** is no longer read: write **Acceptance test files:**
    Fix the plan, then check it with `phax plans lint docs/plans/2610271100-publish-plan.md`.
    $? = 11

### config: phax.json acceptance provider — normative

Summary: The provider that judges acceptance tests is configured under `acceptance`, and an `oracles` block is refused with the new key named.

before:

    {
      "oracles": { "command": "node scripts/acceptance-verdicts.mjs" }
    }

after:

    {
      "acceptance": { "command": "node scripts/acceptance-verdicts.mjs" }
    }

    $ phax validate
    phax.json: "oracles" is no longer read: write "acceptance"

### cli: phax run --hold acceptance — normative

Summary: `phax run --hold acceptance` stops the run for review after every acceptance phase, and `--hold oracle` is refused with the new spelling named.

before:

    $ phax run docs/plans/2610271100-publish-plan.md --hold oracle

after:

    $ phax run docs/plans/2610271100-publish-plan.md --hold acceptance

    $ phax run docs/plans/2610271100-publish-plan.md --hold oracle
    --hold 'oracle' is no longer read: write --hold acceptance

### cli: phax resume --skip-acceptance — normative

Summary: `phax resume --skip-acceptance` resumes without the acceptance step while the configured gate still runs, and `--skip-oracle` is refused with the new flag named.

before:

    $ phax resume publish --yes --skip-oracle
      Skipping the oracle step of phase-04 (--skip-oracle); its configured gate still runs.

after:

    $ phax resume publish --yes --skip-acceptance
      Skipping the acceptance step of phase-04 (--skip-acceptance); its configured gate still runs.

    $ phax resume publish --yes --skip-oracle
    --skip-oracle is no longer read: write --skip-acceptance

### file: acceptance request on the provider's stdin — normative

Summary: An acceptance provider reads an `acceptance-request` document, whose verdict is `authored` or `passed`.

before:

    {
      "$schema": "https://docs.phax.run/schemas/oracle-request/0.26.0.json",
      "verdict": "discharged",
      "phase": "phase-04",
      "oraclePhase": "phase-03",
      "base": "<40-hex>",
      "oracleCommit": "<40-hex>",
      "files": ["tests/e2e/publish.test.ts"]
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/acceptance-request/0.29.0.json",
      "verdict": "passed",
      "phase": "phase-04",
      "acceptancePhase": "phase-03",
      "base": "<40-hex>",
      "acceptanceCommit": "<40-hex>",
      "files": ["tests/e2e/publish.test.ts"]
    }

### file: phax-plan.json and the plan sidecar phase — normative

Summary: A plan's phase states its acceptance tests under `acceptance`, naming the phase that passes them in `passedBy`.

before:

    "oracle": { "dischargedBy": "phase-04", "files": ["tests/e2e/publish.test.ts"] }

after:

    "acceptance": { "passedBy": "phase-04", "files": ["tests/e2e/publish.test.ts"] }

### file: run and phase status — normative

Summary: Scripts reading a run's status find the hold selection `acceptance` and, on a closed stop, `acceptanceStep`.

before:

    run-status.json:  "hold": { "selection": "oracle", "phases": ["phase-03"] }
    status.json:      "stop": { "cause": "held", "status": "closed", "outcome": "corrected", "reviewCommit": "<40-hex>", "oracleStep": "authored", "closedBy": { … } }

after:

    run-status.json:  "hold": { "selection": "acceptance", "phases": ["phase-03"] }
    status.json:      "stop": { "cause": "held", "status": "closed", "outcome": "corrected", "reviewCommit": "<40-hex>", "acceptanceStep": "authored", "closedBy": { … } }

### file: gate attribution and phase record — normative

Summary: A gate attribution's appended step carries the surface `acceptance`, and a phase record names its role as `acceptance` or `passing` and lists `acceptance` among its verified surfaces.

before:

    gate attribution:  { "command": "node scripts/acceptance-verdicts.mjs", "surface": "oracle", "result": "pass" }
    record manifest:   "oracle": { "role": "oracle", "dischargedBy": "phase-04" }
                       "oracle": { "role": "discharging", "oraclePhase": "phase-03" }
                       "verifiedSurfaces": ["local", "oracle"]

after:

    gate attribution:  { "command": "node scripts/acceptance-verdicts.mjs", "surface": "acceptance", "result": "pass" }
    record manifest:   "acceptance": { "role": "acceptance", "passedBy": "phase-04" }
                       "acceptance": { "role": "passing", "acceptancePhase": "phase-03" }
                       "verifiedSurfaces": ["acceptance", "local"]

### cli: phax plans overview and phax records explain — indicative

Summary: The plan overview, as text and as JSON, and the records explanation show each phase's acceptance role, and records written before the rename read the same way.

before:

    $ phax plans overview docs/plans/2610271100-publish-plan.md
    phase-03 — Acceptance tests for publish  claude-sonnet-5-5 · medium · headless
      oracle role  oracle phase, discharged by phase-04

    $ phax plans overview docs/plans/2610271100-publish-plan.md --json
          "oracleRole": { "kind": "oracle", "dischargedBy": "phase-04" },

    $ phax records explain <commit>
    oracle   discharges phase-03 — node scripts/acceptance-verdicts.mjs: pass

after:

    $ phax plans overview docs/plans/2610271100-publish-plan.md
    phase-03 — Acceptance tests for publish  claude-sonnet-5-5 · medium · headless
      acceptance role  acceptance phase, passed by phase-04

    $ phax plans overview docs/plans/2610271100-publish-plan.md --json
          "acceptanceRole": { "kind": "acceptance", "passedBy": "phase-04" },

    $ phax records explain <commit>
    acceptance   passes phase-03 — node scripts/acceptance-verdicts.mjs: pass

### cli: phax artifact migrate-documents — indicative

Summary: Running `phax artifact migrate-documents` once rewrites every live plan to the acceptance names and commits it.

    $ phax artifact migrate-documents
    migrated docs/plans/2610271039-headless-code-review-plan.json → 0.29.0
    committed 1 plan

### internal: the phase prompt's acceptance section — normative

Summary: An agent running a phase of an acceptance pair reads a `## Acceptance role` section telling it whether it writes the acceptance tests or passes them.

before:

    ## Oracle role

    This phase discharges the oracles phase-03 wrote. In the oracle files (tests/e2e/publish.test.ts), the only change allowed is removing every expected-failure marker.

after:

    ## Acceptance role

    This phase passes the acceptance tests phase-03 wrote. In the acceptance test files (tests/e2e/publish.test.ts), the only change allowed is removing every expected-failure marker.

### file: telemetry event acceptance.edits.unjudged — normative

Summary: Telemetry reports a review correction to acceptance test files after they were judged as `acceptance.edits.unjudged`.

before:

    phax·oracle.edits.unjudged  files=[tests/e2e/publish.test.ts]

after:

    phax·acceptance.edits.unjudged  files=[tests/e2e/publish.test.ts]

### package: @lbdremy/phax-schemas acceptance request — normative

Summary: Tools that read run records parse acceptance requests with `parseAcceptanceRequest`, which reads requests saved by earlier releases too.

before:

    import { parseOracleRequest, toLatestOracleRequest } from "@lbdremy/phax-schemas";

after:

    import { parseAcceptanceRequest, toLatestAcceptanceRequest } from "@lbdremy/phax-schemas";

### file: the phax-planning skill — indicative

Summary: The planning skill teaches acceptance phases, explains that an acceptance test may be small, and describes the `boundary` technique.

before:

    ## Oracle phases
    …
    | Kind of code | Size | Technique | Oracle candidate |

after:

    ## Acceptance phases
    …
    | Kind of code | Size | Technique | Acceptance candidate |

    `boundary` (equivalence partitions and boundary values: the empty case, each limit, just outside it)

## 7. Non-goals

- Typing the test line's `<oracle>` field, for example with Barr's four kinds (specified, derived, implicit, human): it stays free text.
- Any technique beyond `boundary`. Golden or snapshot tests are an oracle (`example · the golden file`), and pairwise and mutation are not wanted now.
- Any change to how acceptance phases behave: the pairing rules, markers, gate judgments, holds, stops, resets and refusals stay as they are, under new names.
- Rewriting archived plans and specs, briefs under `docs/briefs/`, past release notes under `docs/releases/`, or the upgrading entries of releases before 0.29.0: they record what those releases shipped.
- Rewriting the prose of specs and plans under `docs/specs/` and `docs/plans/`: they record decisions in the words of their day. `phax artifact migrate-documents` lifts a live plan sidecar's fields and re-renders what they render; nothing else in an artifact changes.
- Rewriting records, gate attributions, oracle requests or status files already written: they are read as they are.
- Resuming a run started by an earlier release: it is refused, as in 0.28.0.
- Recognizing an old name anywhere beyond the refusals this spec lists. An old name is refused with the new name, never accepted as an alias.

## 8. Acceptance criteria

### Acceptance header lines are read

Given an `acceptance` provider is configured and a plan's phase-03 carries `**Acceptance phase:** passed by phase-04` and `**Acceptance test files:** `tests/e2e/publish.test.ts``, a file phase-03 plans to create, when `phax plans lint` runs and the plan is extracted, then lint reports no `acceptance` error, and phase-03 in phax-plan.json carries `"acceptance": { "passedBy": "phase-04", "files": ["tests/e2e/publish.test.ts"] }` with `$schema` at 0.29.0. (refs §5.1, §5.13)

### Pairing rules hold under the new names

Given a plan whose phase-03 carries `**Acceptance phase:** discharged by phase-04`, and another whose phase-02 carries `**Acceptance phase:** yes` and no `**Acceptance test files:**` line, when `phax plans lint` runs on each, then the first reports the `acceptance` error `**Acceptance phase:** "discharged by phase-04" is not a declaration: write "yes" or "passed by phase-NN"`, the second `**Acceptance phase:** without **Acceptance test files:**: write both lines or neither`, and both exit 1. (refs §5.1)

### Old header lines are refused by name

Given a plan whose phase-03 carries `**Oracle phase:** yes` and `**Oracle files:** `tests/e2e/publish.test.ts``, when `phax plans lint`, then `phax run`, then `phax resume` of a run holding that plan, are each run, then lint exits 1 with the `acceptance` errors `**Oracle phase:** is no longer read: write **Acceptance phase:**` and `**Oracle files:** is no longer read: write **Acceptance test files:**`, and `phax run` and `phax resume` exit 11 with "Acceptance preflight failed" listing both. (refs §5.2)

### The acceptance loop

Given an acceptance phase whose test line is `- every (state, transition) pair is accepted or refused as the table says — small · table · transition table · acceptance · AC-3`, when `phax plans lint` and `phax plans overview` run, then lint reports no `tests` error, the extracted test line has `"loop": "acceptance"` and `"oracle": "transition table"`, and the overview's coverage shows AC-3 covered by an `acceptance` line. (refs §5.3)

### Loop rules hold under the new names

Given an ordinary phase with a line in the `acceptance` loop, and an acceptance phase with only `in-phase` lines, when `phax plans lint` runs, then it reports the `tests` errors `test line 1 is in the acceptance loop, but phase-02 is not an acceptance phase` and `phase-03 is an acceptance phase, but none of its test lines is in the acceptance loop`. (refs §5.3, §5.19)

### The old loop is refused by name

Given a plan with the test line `- every (state, transition) pair is accepted or refused as the table says — small · table · transition table · oracle · AC-3`, when `phax plans lint` and `phax run` run, then lint exits 1 with the `tests` error `test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance'`, and `phax run` refuses the plan before any model call, naming the line. (refs §5.4)

### Boundary is a technique

Given a test line `- an empty name and a 64-character name are accepted, a 65-character one refused — small · boundary · the 64-character limit · in-phase`, when `phax plans lint` runs and `phax artifact schema plan` prints the plan document schema, then lint reports no `tests` error, and the schema's technique enum is exactly `example, boundary, table, property, metamorphic, stateful, fuzz, contract, smoke` in that order. (refs §5.5)

### The acceptance provider judges a pair

Given phax.json declares `"acceptance": { "command": "node scripts/acceptance-verdicts.mjs" }` and a run reaches the gate of passing phase phase-04, when the gate runs, then the command receives on stdin an `acceptance-request` with `$schema` `https://docs.phax.run/schemas/acceptance-request/0.29.0.json`, `verdict` `passed`, `acceptancePhase` `phase-03` and `acceptanceCommit`, the same document is saved as `checks-attempt-01.acceptance-request.json`, and the gate attribution's appended step carries `"surface": "acceptance"`. (refs §5.6, §5.12, §5.13)

### The authored request

Given the same configuration at the gate of acceptance phase phase-03, when the gate runs, then the request's `verdict` is `authored`, it carries `phase`, `acceptancePhase`, `base` and `files`, and no `acceptanceCommit`. (refs §5.12)

### No provider, no acceptance phase

Given a plan with an acceptance phase and no `acceptance` key in any config layer, when `phax plans lint` runs, then it reports the `acceptance` error `acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)`. (refs §5.6, §5.19)

### The old provider key is refused by name

Given phax.local.json carries `"oracles": { "command": "node scripts/acceptance-verdicts.mjs" }`, when `phax validate` runs, then it fails, naming phax.local.json and `"oracles" is no longer read: write "acceptance"`. (refs §5.7)

### Holding acceptance phases

Given a plan with acceptance phases phase-03 and phase-05, when `phax run <plan> --hold acceptance` names the run, then run-status.json carries `"hold": { "selection": "acceptance", "phases": ["phase-03", "phase-05"] }` at 0.29.0, and the run stops for review after each of them. (refs §5.8, §5.13)

### The old hold selection is refused

Given any plan, when `phax run <plan> --hold oracle` or `--hold oracle,phase-02` runs, then it prints `--hold 'oracle' is no longer read: write --hold acceptance`, exits non-zero and names no run. (refs §5.9)

### Skipping the acceptance step

Given a run stopped after its acceptance step failed at phase-04, when `phax resume <run> --yes --skip-acceptance` runs, then it prints `Skipping the acceptance step of phase-04 (--skip-acceptance); its configured gate still runs.`, the configured gate runs, and the gate attribution records the appended step with `"surface": "acceptance"` and `"result": "skipped"`. (refs §5.10)

### The old skip flag is refused

Given the same stopped run, when `phax resume <run> --yes --skip-oracle` runs, then it prints `--skip-oracle is no longer read: write --skip-acceptance`, exits non-zero, and the run's status is unchanged. (refs §5.11)

### Status and records carry the new names

Given a held stop on acceptance phase phase-03 closed with a correction whose gate passed the acceptance step, and the pair's records written, when status.json and the two record manifests are read, then the stop carries `"acceptanceStep": "authored"`, phase-03's manifest carries `"acceptance": { "role": "acceptance", "passedBy": "phase-04" }` and lists `acceptance` in its `verifiedSurfaces`, phase-04's carries `"acceptance": { "role": "passing", "acceptancePhase": "phase-03" }`, and each is stamped 0.29.0. (refs §5.13)

### Records from 0.28.0 still read

Given a repository holding records, gate attributions and `checks-attempt-01.oracle-request.json` files written by phax 0.28.0 for an oracle pair, when `phax records explain <commit>` runs on the discharging phase's commit, and `parseAcceptanceRequest` from @lbdremy/phax-schemas parses the saved oracle request and `toLatestAcceptanceRequest` lifts it, then the explanation shows `acceptance   passes phase-03 — <command>: pass`, and the parse succeeds, the lifted request carrying `verdict` `passed`, `acceptancePhase` and `acceptanceCommit`. (refs §5.14, §5.19)

### A live plan is lifted

Given a live plan sidecar stamped 0.28.0 whose phase-03 has `"oracle": { "dischargedBy": "phase-04", … }` and a test line in the `oracle` loop, when `phax artifact migrate-documents` runs, then the sidecar is stamped 0.29.0 with `"acceptance": { "passedBy": "phase-04", … }` and loop `acceptance`, plan.md's header reads `**Acceptance phase:** passed by phase-04` and `**Acceptance test files:** …`, the test line ends `· acceptance · <criterion>`, and one commit holds both files. (refs §5.15)

### An unmigrated plan is refused

Given the same plan before the migration runs, when `phax artifact approve <plan> --by operator` runs, then it exits 12 and names `phax artifact migrate-documents`. (refs §5.16)

### Archived artifacts are untouched

Given plans and specs under `docs/plans/archive/` and `docs/specs/archive/` that use the oracle names, when `phax artifact migrate-documents` runs and `phax artifact status` reads one of them, then every archived file is byte-identical afterwards, and its status reads without error. (refs §5.17)

### A run in flight is refused

Given a run whose phax-plan.json was extracted by phax 0.28.0, when `phax resume <run>`, `phax validate --plan` and `phax ls` run, then resume and validate refuse it and name `phax archive <run> --force`, and `phax ls` still lists the run. (refs §5.18)

### Prompts, messages and telemetry use the new names

Given an acceptance pair whose passing phase runs, fails its acceptance step, and later has a held correction that changes an acceptance test file, when the phase prompt, the fix prompt, the recovery steps and the telemetry stream are read, then the prompt holds `## Acceptance role` with the passing-phase paragraph, the fix prompt names the acceptance provider, the recovery headline reads `The acceptance step failed after all fix attempts.` and names `--skip-acceptance`, and the telemetry stream holds `acceptance.edits.unjudged`. (refs §5.19)

### Oracle survives only in its literature sense

Given the repository after the change, when a check scans the sources, help texts, usage contract, JSON Schemas, README, live docs (outside `docs/specs/`, `docs/plans/`, `docs/briefs/`, `docs/releases/` and the upgrading entries before 0.29.0), the site, the examples and the skills for `oracle` and `discharg`, then `discharg` and every other `oracle` appear only in a refusal naming an old name, the 0.29.0 upgrading entry, a reader, lift or frozen schema of a shape an earlier release wrote, or the slug of the archived spec `oracle-phases`; every remaining `oracle` is the test line's fourth field, the `wrong-oracle` escape or prose about what judges a test. (refs §5.20, §5.19)

### The planning skill teaches acceptance phases

Given the phax-planning skill as `phax skills install` writes it, and the copy under `.claude/skills/`, when the two are read, then they are identical, hold a `## Acceptance phases` section and an `Acceptance candidate` column, state that acceptance names a test's purpose and an acceptance test may be `small`, describe `boundary`, and write the test line's loop as `acceptance | in-phase`. (refs §5.21)

### The upgrade entry

Given docs/upgrading.md, when it is read, then it holds a `### 0.29.0` entry naming `phax artifact migrate-documents`, the hand-written plan lines and test-line loop, the `acceptance` key of phax.json and its overlays, `--hold acceptance`, `--skip-acceptance`, the `acceptance-request` an acceptance provider now reads (verdict `passed`, `acceptancePhase`, `acceptanceCommit`), the renamed status, record and schemas-package names, and runs in flight. (refs §5.22)

## 9. Open questions

None.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Rename table, plan Markdown: `**Oracle phase:** yes` → `**Acceptance phase:** yes`; `**Oracle phase:** discharged by phase-NN` → `**Acceptance phase:** passed by phase-NN`; `**Oracle files:**` → `**Acceptance test files:**`.
- Rename table, lint: check `oracles` → `acceptance`; check `tests` keeps its name. Every message of the old `oracles` check is reworded with the new terms, rules unchanged.
- Rename table, plan document and phax-plan.json: phase key `oracle` → `acceptance`; `dischargedBy` → `passedBy`; `files` unchanged. Both formats move to 0.29.0.
- Rename table, test line: loop `oracle` → `acceptance`; `in-phase` unchanged; the fourth field `oracle` keeps its name; a criterion id may be neither `acceptance`, `in-phase` nor `oracle` (`oracle` stays refused so the old loop is recognized and refused by name); technique `boundary` added after `example`.
- Rename table, configuration: key `oracles` → `acceptance` in phax.json, phax.local.json, ~/.phax/config.json and the editor schemas phax.schema.json and phax.user.schema.json.
- Rename table, published format: `oracle-request` → `acceptance-request` at `https://docs.phax.run/schemas/acceptance-request/0.29.0.json`, born with `$schema`; verdict `authored` unchanged, `discharged` → `passed`; `oraclePhase` → `acceptancePhase`; `oracleCommit` → `acceptanceCommit`; saved file `checks-attempt-NN.oracle-request.json` → `checks-attempt-NN.acceptance-request.json`.
- Rename table, gate attribution: appended step `surface: "oracle"` → `surface: "acceptance"` (0.29.0). A configured gate step still may not declare it. The recorded surface `oracle` → `acceptance` wherever a surface is recorded or reported: a phase record manifest's `verifiedSurfaces` (0.29.0), the run's verified surfaces in the final report and the PR body, and `phax records list`.
- Rename table, run status: hold selection `oracle` → `acceptance` (0.29.0). Phase status: stop key `oracleStep` → `acceptanceStep` (0.29.0), values `authored | none` unchanged.
- Rename table, phase record manifest: key `oracle` → `acceptance`; role `oracle` with `dischargedBy` → role `acceptance` with `passedBy`; role `discharging` with `oraclePhase` → role `passing` with `acceptancePhase` (0.29.0).
- Rename table, CLI: `--hold oracle` → `--hold acceptance`; `--skip-oracle` → `--skip-acceptance`; "Oracle preflight failed" → "Acceptance preflight failed" (exit 11 unchanged); "The oracle step failed after all fix attempts." → "The acceptance step failed after all fix attempts."; overview row `oracle role` → `acceptance role` with `acceptance phase, passed by phase-NN` / `passes phase-NN`; records explain row `oracle` → `acceptance` with the same values; `phax plans overview --json` key `oracleRole` → `acceptanceRole`, kind `oracle` with `dischargedBy` → kind `acceptance` with `passedBy`, kind `discharging` with `oraclePhase` → kind `passing` with `acceptancePhase`, kind `none` unchanged.
- Rename table, review handoff: section `## Oracle pairs` → `## Acceptance pairs`; its columns `Oracle phase | Discharged by | Authored | Discharged` → `Acceptance phase | Passed by | Authored | Passed`.
- Rename table, prompt: `## Oracle role` → `## Acceptance role`. Its paragraphs say "acceptance tests", "acceptance test files", "pass" and "the acceptance provider". The fix-prompt tail says "The acceptance provider runs only at the gate". The authoring prompt names the `acceptance` provider and the skill's acceptance-phase section.
- Rename table, telemetry: event `oracle.edits.unjudged` → `acceptance.edits.unjudged`, and its console line `phax·acceptance.edits.unjudged`. Every span, attribute or event value naming an oracle step (such as a failed step `oracle`) becomes `acceptance`.
- Rename table, schemas package: `oracleRequestFormat` → `acceptanceRequestFormat`, `parseOracleRequest` → `parseAcceptanceRequest`, `toLatestOracleRequest` → `toLatestAcceptanceRequest`, and the types to match. The parser still reads 0.26.0 `oracle-request` documents, lifted to the latest acceptance request.
- Rename table, docs and skills: `docs/oracle-phases.md` → `docs/acceptance-phases.md`; site route `/guide/oracle-phases` → `/guide/acceptance-phases`, titled "Acceptance phases"; `examples/vitest-oracles` → `examples/vitest-acceptance`, and this repository's phax.json (`"acceptance": { "command": "node examples/vitest-acceptance/main.mjs" }`) and knip.json follow it. In phax-planning, "What makes a good oracle" becomes "What makes a good acceptance test" and the `#oracle-phases` anchor `#acceptance-phases`. In phax-decide-plan, `P3` and the skill's description say "Acceptance first" and `oracle-authoring` becomes an acceptance phase. In phax-decide-review, `R4` becomes "Acceptance tests are not fix targets". phax-review says "acceptance pairs" and "passed", and keeps `wrong-oracle`.
- Refusal wording, each normative: `**Oracle phase:** is no longer read: write **Acceptance phase:**`; `**Oracle files:** is no longer read: write **Acceptance test files:**`; `test line <n> uses the loop 'oracle', which is no longer read: write 'acceptance'`; `<file>: "oracles" is no longer read: write "acceptance"`; `--hold 'oracle' is no longer read: write --hold acceptance`; `--skip-oracle is no longer read: write --skip-acceptance`. They follow the existing `**Model reason:** is no longer read: write **Assignment reason:**`.
- Every published format whose shape changes is stamped 0.29.0. Earlier shapes stay readable through the frozen history readers, as earlier lifts did, and none is accepted as a current input where a person writes it.
- Internal names follow the same table: types, functions, modules, test names and the run preflight check `oracle-phases` (→ `acceptance-phases`) need no row of their own. Only the readers and lifts of earlier shapes, and the frozen schemas of earlier releases, keep the old names.

Left open:

- The exit code of the config, `--hold` and `--skip-oracle` refusals: use the code each command already returns for an invalid configuration or argument.
- The wording of the overview, records-explain, recovery and help texts beyond the strings this spec quotes, provided they use only the new terms.

Constraints:

- No back-compat shims: an old name a person writes is refused, never read as an alias. Only records already written and archived artifacts are read in their old shape.
- The runs of this plan edit the phax-planning skill and its bundled copy, so they need `phax run --allow-skill-edits`.
- Behaviour of acceptance pairs does not change: every existing oracle-phase test keeps its scenario and asserts the new names.
- The decoder and the published JSON Schemas must agree: the technique enum, the loop enum and the criterion refusal all change in both.
- An extraction cached by an earlier release is never reused: the extractor version moves, as it did when phases gained test lines.

## 11. Docs page

Page: docs/acceptance-phases.md, published at /guide/acceptance-phases (renamed from docs/oracle-phases.md and /guide/oracle-phases)

Reader: A plan author who wants a phase to freeze tests from the spec's acceptance criteria before another phase writes the code, and an operator configuring the provider that judges them.

Example: "acceptance": { "command": "node scripts/acceptance-verdicts.mjs" } in phax.json, then a phase with `**Acceptance phase:** passed by phase-04` and `**Acceptance test files:** `tests/e2e/publish.test.ts``, and its test line `- publishing refuses a red gate — medium · example · the refusal naming the gate · acceptance · AC-1`.
