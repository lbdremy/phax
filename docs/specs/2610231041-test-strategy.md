---
status: Approved
date: 2026-10-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-23
  baseline: f2118ff
---
# Test strategy as data, and the plan overview

## 1. Context

The phax-planning skill (revised in commit a08d93cb) already holds a phase's `### Test strategy` to a strict line format: `- <guarantee> — <size> · <technique> · <oracle> · <oracle | in-phase>[ · <acceptance criterion id>]`, with size `small` | `medium` | `large`, technique `example` | `table` | `property` | `metamorphic` | `stateful` | `fuzz` | `contract` | `smoke`, a named oracle, and the loop that owns the test: `oracle` (frozen in an oracle pair) or `in-phase`. The format is prose only. In the plan document, `testStrategy` is a free non-empty string that the renderer writes as is; the deterministic plan.md parser shared by `phax plans lint`, `phax plans estimate` and extraction skips the section; `phax-plan.json` carries no test strategy. The one live plan sidecar, `interactive-phases`, holds seven prose test strategies, none in the line format.

Around it: oracle phases declare `oracle: { dischargedBy, files }` and share an `oracles` check between lint and the run preflight. A spec document's acceptance criteria each carry an `id`, but only in the spec's JSON sidecar: the rendered .md shows the criterion's name. A plan names its spec in `source-spec`. An architecture provider reports the repository's parts, each with globs; lint already spawns it to resolve assignment bounds. `phax run --dry-run` lists execution mechanics (worktrees, commands, security) and `phax plans estimate` lists cost per phase. `docs/acceptance-coverage.md` maps criteria to phases by hand.

Ground read:

- `.claude/skills/phax-planning/SKILL.md` — The Test strategy section (one line per guarantee on size · technique · oracle · loop, optional criterion id), What makes a good oracle, the defaults table, and the headless section that describes testStrategy as a string of `- ` lines.
- `src/schemas/planDocument.ts` — testStrategy: Schema.NonEmptyString on every phase; projectExtractedPlan builds phax-plan.json key by key and carries no test strategy.
- `src/domain/authoring/renderPlan.ts` — Renders the string as is under `### Test strategy`.
- `src/domain/artifact/documentMigration.ts` — migrate-documents decides per sidecar from text alone, migrates only while the body is its own shape's rendering, and refuses with a problem and a remedy.
- `src/schemas/release.ts` — plan-document is stamped 0.26.0; earlier shapes are frozen under src/schemas/history/plan-document/.
- `docs/plans/2610230951-interactive-phases-plan.json` — The only live plan sidecar. Its seven testStrategy strings are prose and lists of test file names, none in the line format.
- `src/app/lintPlan.ts` — Lint is read-only and has no Backend, but it already spawns the architecture provider to resolve part bounds, and the plan auditor.
- `src/domain/plan/lint.ts` — Findings carry severity error|warning and a check from a closed set (structure, files, commands, models, interactive, oracles, advisory).
- `src/domain/plan/lintRender.ts` — Report header `<plan>: N errors, M warnings`, then `severity  check  phase  message` columns.
- `src/schemas/architecture.ts` — An architecture report's parts: id, name, description, globs in phax's dialect.
- `src/schemas/specDocument.ts` — Each acceptance criterion has an id; renderSpec writes only the criterion's name into the .md, so ids live in the spec's JSON sidecar alone.
- `src/cli/commands/plans.ts` — `phax plans` has status, overlap, lint and estimate; lint and estimate take <plan> and --json.
- `docs/acceptance-coverage.md` — A hand-maintained criterion → phase table: the coverage this spec derives from the plan instead.
- `docs/upgrading.md` — Every sidecar shape change so far ships with a migrate-documents step and an entry here.

## 2. Problem

Nothing reads a plan's test strategy, so nothing can check it. A plan can leave an acceptance criterion of its spec untested, name a criterion the spec does not have, or put an oracle-loop line on a phase that is no oracle phase. Today nothing reports any of these, and the operator finds out during the run or in review. A coordinate outside the skill's values (`unit`, `integration`, `e2e`) passes because the field is a free string.

The operator also cannot see a plan whole before running it. The questions that matter before `phax run` are: what each phase builds, with which model, in which part of the architecture, which phases form oracle pairs, and which guarantees test which criteria. Answering them means reading the whole plan.md and running `phax architecture` to match globs by eye. Dry-run answers how the plan executes, and estimate answers what it costs. No command lays out the plan's shape.

## 3. Product goal

A plan's test strategy becomes data. Every phase carries a list of test lines, each placed on the four closed coordinates the planning skill defines, plus an optional criterion id. Lint holds the lines to the oracle pairs and to the source spec's criteria. A new read-only, model-free `phax plans overview` lays the plan out phase by phase before it runs, and ends with which lines cover each acceptance criterion and which criteria no line covers.

> The overview shows what the plan says, read without a model, and it never writes or starts anything.

## 4. Terminology

- **test line** — One guarantee of a phase's test strategy, placed on four coordinates: size, technique, oracle and loop. It can name one acceptance criterion.
- **size** — What the test touches: `small` (one process, memory only), `medium` (one machine), `large` (anything beyond). Closed set.
- **technique** — How inputs are chosen: `example`, `table`, `property`, `metamorphic`, `stateful`, `fuzz`, `contract` or `smoke`. Closed set.
- **oracle (coordinate)** — What judges the test's result, as a non-empty string. Different from an oracle phase.
- **loop** — Which loop owns the test: `oracle` (written in an oracle phase, frozen until discharged) or `in-phase` (written with the code). Closed set.
- **criterion id** — The `id` of one of the source spec's acceptance criteria, read from the spec's JSON sidecar. Optional per line.
- **oracle role** — A phase's place in an oracle pair: oracle phase (with the phase that discharges it), discharging phase (with the oracle phase it discharges), or none.
- **plan overview** — The read-only report of `phax plans overview`: every phase's layout, in plan order, then the coverage of the source spec's criteria.
- **coverage** — For each acceptance criterion of the source spec, the test lines that name it, with their phase and loop. A criterion with no such line is uncovered.

## 5. Functional requirements

### 5.1 Test lines with closed coordinates

The system shall hold each phase's test strategy as a list of test lines, each with a guarantee, a size, a technique, an oracle, a loop and a criterion id or none, where size, technique and loop take only the values the terminology lists.

### 5.2 Refusing a malformed test line in a plan document

IF a plan document carries a test line with a missing coordinate, a value outside its closed set, or an unknown key THEN the system SHALL refuse the document, naming the phase, the line's position and the coordinate.

### 5.3 Rendering test lines

The system shall render each test line under the phase's `### Test strategy` heading in the skill's line format, with ` · <criterion id>` appended only when the line names a criterion.

### 5.4 Parsing test lines from any plan.md

WHEN the deterministic parser reads a plan.md THE system SHALL read each phase's `### Test strategy` list into test lines, whether the plan was authored headless or by hand.

### 5.5 A line that departs from the format

IF a `### Test strategy` entry departs from the line format THEN `phax plans lint` SHALL report an error naming the phase and the first departing line.

### 5.6 Test lines join phax-plan.json

WHEN phax extracts a plan, by the deterministic parser or by the model fallback, THE system SHALL carry each phase's test lines in `phax-plan.json` and in the extraction cache seed, under a required key holding an empty list for a phase with no line.

### 5.7 Oracle-loop lines only on oracle phases

IF a test line in the `oracle` loop sits on a phase that is not an oracle phase THEN `phax plans lint` SHALL report an error naming the phase and the line.

### 5.8 An oracle phase states its oracles

IF an oracle phase carries no test line in the `oracle` loop THEN `phax plans lint` SHALL report an error naming the phase.

### 5.9 A line naming no real criterion

IF a test line names a criterion id that the source spec's acceptance criteria do not have THEN `phax plans lint` SHALL report an error naming the phase, the line and the id.

### 5.10 An uncovered criterion

IF an acceptance criterion of the source spec is named by no test line of the plan THEN `phax plans lint` SHALL report a warning naming the criterion id.

### 5.11 A phase that tests nothing

The system shall report no lint finding for a phase whose test strategy has no line.

### 5.12 A source spec without criterion ids

IF the plan's source spec has no JSON sidecar to read criterion ids from THEN `phax plans lint` and `phax plans overview` SHALL each say so in one line and check no criterion.

### 5.13 The overview is read-only and model-free

The system shall produce `phax plans overview <plan>` from the deterministic parser alone, starting no model session and writing no file, for a plan in any status.

### 5.14 Per-phase layout

The system shall show, for each phase in plan order, its id, title, model, effort, mode, oracle role, placement and test lines.

### 5.15 Placement by architecture part

WHERE an architecture provider is configured THE overview SHALL run it once and show each phase's planned files to create and edit under every part whose globs match them, and under `(no part)` when none does.

### 5.16 Placement without a provider

WHILE no architecture provider is configured THE overview SHALL show each phase's planned files to create and edit, with one header line saying no provider is configured.

### 5.17 A failing architecture provider

IF the architecture provider fails or its report does not decode THEN the overview SHALL show planned files as without a provider, print one warning line naming the failure on stderr, and exit 0.

### 5.18 Criterion coverage

WHERE the plan names a source spec THE overview SHALL end with each of its acceptance criteria and the phase and loop of every line that names it, then the criteria no line names.

### 5.19 JSON output

WHEN `phax plans overview` runs with `--json` THE system SHALL print one JSON document on stdout carrying the same content as the rendered overview.

### 5.20 A plan that does not parse

IF the plan does not parse THEN `phax plans overview` SHALL exit 1 with one line naming `phax plans lint <plan>`.

### 5.21 Migrating a live string test strategy

WHEN `phax artifact migrate-documents` meets a live plan sidecar whose `testStrategy` is a string THE system SHALL lift it into test lines if every line follows the line format, and otherwise refuse the sidecar, naming the phase, the first departing line and the remedy.

### 5.22 The format in the plan document schema

The system shall describe the test line's format and each coordinate's allowed values in the plan document JSON Schema that `phax artifact schema plan` prints and the headless plan authoring prompt carries.

### 5.23 The planning skill follows the data

The system shall ship the phax-planning skill with its Test strategy section pointing to the test line data and its headless section documenting `testStrategy` as an array of test lines.

## 6. Surface

### file: plan sidecar `docs/plans/<stamp>-<slug>-plan.json`, phase `testStrategy` — indicative

before:

    "testStrategy": "- a run folder is created with its layout, and a second create of the same name is refused — medium · example · expected tree and typed error · in-phase\n- an interrupted write leaves the previous file whole — medium · example · file content before and after · in-phase"

after:

    "testStrategy": [
      {
        "guarantee": "every (state, transition) pair is accepted or refused as the table says",
        "size": "small",
        "technique": "table",
        "oracle": "transition table",
        "loop": "oracle",
        "criterion": "ac-transitions"
      },
      {
        "guarantee": "a gate-report decodes or is refused with a typed error, never a crash",
        "size": "small",
        "technique": "fuzz",
        "oracle": "the decoder's refusal",
        "loop": "in-phase",
        "criterion": null
      }
    ]

    Key spellings are indicative. The values of size, technique and loop are normative: exactly the skill's sets. Every key is required, `criterion` is a string or null, and an empty array is a phase with no line.

### file: `phax-plan.json`, phase test lines — indicative

before:

    A phase of `phax-plan.json` carries no test strategy: the `### Test strategy` section is never extracted.

after:

    "testLines": [
      {
        "guarantee": "every (state, transition) pair is accepted or refused as the table says",
        "size": "small",
        "technique": "table",
        "oracle": "transition table",
        "loop": "oracle",
        "criterion": "ac-transitions"
      }
    ]

    The same line shape as the plan document's. The key spelling is indicative; the key is required on every phase.

### file: plan.md `### Test strategy` section — normative

before:

    ### Test strategy

    <any text; not parsed>

after:

    ### Test strategy

    - every (state, transition) pair is accepted or refused as the table says — small · table · transition table · oracle · ac-transitions
    - a gate-report decodes or is refused with a typed error, never a crash — small · fuzz · the decoder's refusal · in-phase

    One `- ` entry per line, separated by ` — ` then ` · `. A section with no entry is a phase with no line.

### cli: phax plans lint <plan> — new test line findings — indicative

before:

    docs/plans/2610240900-invoice-export-plan.md: no findings

after:

    docs/plans/2610240900-invoice-export-plan.md: 3 errors, 1 warning
    error    tests      phase-01  test line 2 departs from the format: "add unit tests for the exporter"
    error    tests      phase-03  test line 1 is in the oracle loop, but phase-03 is not an oracle phase
    error    tests      phase-02  test line 3 names criterion "ac-retry", which invoice-export does not have
    warning  tests      -         criterion "ac-empty-month" of invoice-export is named by no test line

    The check name `tests` and the wording are indicative; severities follow §5.

### cli: phax plans overview <plan> [--json] — normative

    phax plans overview docs/plans/2610240900-invoice-export-plan.md
    phax plans overview docs/plans/2610240900-invoice-export-plan.md --json

    $? = 0   overview shown (architecture provider failure included)
    $? = 1   the plan does not parse: "run phax plans lint docs/plans/…-plan.md"
    $? = 2   invalid config

### cli: phax plans overview — rendered layout — indicative

    invoice-export — Monthly invoice export  (Draft · source spec invoice-export)
    architecture: parts from the configured provider

    phase-01 — Export decision rules     claude-sonnet-5-5 · medium · headless
      oracle role  oracle phase, discharged by phase-02
      domain       src/domain/invoice/export.ts
      tests        tests/unit/invoiceExport.test.ts
      - every month boundary rounds as the table says — small · table · boundary table · oracle · ac-month-boundary

    phase-02 — Export use case           claude-sonnet-5-5 · high · headless
      oracle role  discharges phase-01
      app          src/app/exportInvoices.ts
      (no part)    scripts/export-fixture.sh
      - a failed write leaves no partial export — small · example · fake fs state · in-phase · ac-atomic

    phase-03 — Docs                      claude-haiku-5-5 · low · headless
      oracle role  none
      docs         docs/invoice-export.md
      (no test lines)

    acceptance criteria of invoice-export
      ac-month-boundary   phase-01 oracle
      ac-atomic           phase-02 in-phase
      uncovered           ac-empty-month

    Without a provider, the architecture line reads `architecture: no provider configured — planned files shown`, and each phase lists `files` in place of parts.

### cli: phax plans overview --json — indicative

    {
      "plan": "docs/plans/2610240900-invoice-export-plan.md",
      "sourceSpec": "docs/specs/2610231100-invoice-export.md",
      "architecture": { "kind": "parts" },
      "phases": [
        {
          "id": "phase-01",
          "title": "Export decision rules",
          "model": "claude-sonnet-5-5",
          "effort": "medium",
          "mode": "headless",
          "oracleRole": { "kind": "oracle", "dischargedBy": "phase-02" },
          "placement": [
            { "part": "domain", "files": ["src/domain/invoice/export.ts"] },
            { "part": null, "files": [] }
          ],
          "testLines": [
            { "guarantee": "every month boundary rounds as the table says", "size": "small", "technique": "table", "oracle": "boundary table", "loop": "oracle", "criterion": "ac-month-boundary" }
          ]
        }
      ],
      "coverage": {
        "kind": "criteria",
        "criteria": [ { "id": "ac-month-boundary", "lines": [ { "phase": "phase-01", "loop": "oracle" } ] } ],
        "uncovered": ["ac-empty-month"]
      }
    }

    `architecture.kind` is one of `parts` | `none` | `failed` (with `message`). `oracleRole.kind` is one of `oracle` | `discharging` | `none`. `coverage.kind` is one of `criteria` | `no-source-spec` | `no-criterion-ids`.

### cli: phax artifact migrate-documents — refusing a prose test strategy — indicative

    ✗ docs/plans/2610230951-interactive-phases-plan.md phase-01 testStrategy line 1 departs from the test line format: "Write `tests/unit/hold.test.ts` first."
      Rewrite each phase's test strategy in the line format, in the sidecar and plan.md alike, or re-author the plan, then rerun.

### file: .claude/skills/phax-planning/SKILL.md — indicative

before:

    - `testStrategy`, `verification`, `expectedHandoff`: strings. `testStrategy` holds the guarantee lines of [Test strategy](#test-strategy-informational), one `- ` line each, separated by newlines.

after:

    - `testStrategy`: an array of test lines `{ guarantee, size, technique, oracle, loop, criterion }` (see [Test strategy](#test-strategy)); `[]` for a phase that tests nothing.
    - `verification`, `expectedHandoff`: strings.

    The `## Test strategy (informational)` heading loses "(informational)" and says that lint checks the lines and that `phax plans overview` shows them.

## 7. Non-goals

- Changes to the oracles provider (failing for the right reason, frozen generators, fixed seeds): a separate spec.
- Adding a property-based testing or mutation library to phax's own tests.
- A graphical view of the overview.
- Making `phax run`, its preflight, the phase prompt or the records act on test lines.
- Folding the cost estimate into the overview: `phax plans estimate` keeps that.
- Checking that a test line's test exists, runs or passes, or linking a line to a test file.
- Judging whether a line's oracle is a good oracle.
- Changing the coordinates or their values, or inferring coordinates from a prose test strategy.
- Reading criterion ids from a spec's Markdown body: ids come from its JSON sidecar only.
- Replacing or regenerating `docs/acceptance-coverage.md`.

## 8. Acceptance criteria

### Only the skill's values are accepted

Given a headless plan document whose test lines use every size, technique and loop value of the skill, when phax decodes it, then it is accepted, and the same document with size `unit` on one line is refused. (refs §5.1, §5.2)

### A refusal names where the line is wrong

Given a plan document whose phase-02 second test line has no `loop` key, when phax decodes it, then it is refused with a message naming phase-02, line 2 and `loop`. (refs §5.2)

### Rendered lines parse back to the same lines

Given a plan document with lines with and without a criterion id, and a phase with no line, when it is rendered to plan.md and the deterministic parser reads that plan.md, then each `### Test strategy` entry is in the line format, ` · <criterion id>` appears only on lines naming one, and the parsed lines equal the document's. (refs §5.3, §5.4)

### A hand-authored plan is parsed too

Given a hand-written plan.md with no sidecar whose phases list lines in the format, when `phax plans overview` runs on it, then each phase shows its lines with their coordinates. (refs §5.4, §5.14)

### A prose line is a lint error

Given a plan.md whose phase-01 Test strategy has the entry `- add unit tests for the exporter`, when `phax plans lint` runs, then it exits 1 with an error naming phase-01 and that line. (refs §5.5)

### phax-plan.json carries the test lines

Given a plan whose phases list lines in the format, and a second plan that differs from it only in one line, when each is extracted, then each phase of the first plan's `phax-plan.json` carries its lines with their coordinates in plan order, a phase with no line carries an empty list, and the two plans' cache seeds differ. (refs §5.6)

### An oracle line on an ordinary phase is an error

Given a plan whose discharging phase lists a line in the `oracle` loop, when `phax plans lint` runs, then it exits 1 with an error naming that phase and line. (refs §5.7)

### An oracle phase with no oracle line is an error

Given an oracle phase whose lines are all `in-phase`, when `phax plans lint` runs, then it exits 1 with an error naming the oracle phase. (refs §5.8)

### A line naming a missing criterion is an error

Given a plan whose source spec sidecar has criteria `ac-a` and `ac-b`, and a line naming `ac-c`, when `phax plans lint` runs, then it exits 1 with an error naming the phase, the line and `ac-c`. (refs §5.9)

### An uncovered criterion is a warning

Given a plan whose lines name `ac-a` and never `ac-b`, and no other defect, when `phax plans lint` runs, then it exits 0 and reports one warning naming `ac-b`. (refs §5.10)

### A docs-only phase is not flagged

Given a plan whose last phase has an empty Test strategy and no other defect, when `phax plans lint` runs, then it reports no finding for that phase. (refs §5.11)

### A spec without a sidecar is named, not checked

Given a plan whose source spec is a hand-written .md with no JSON sidecar, and a line naming `ac-a`, when `phax plans lint` and `phax plans overview` run, then each prints one line saying the spec has no criterion ids, lint reports no criterion finding, and the overview's coverage is `no-criterion-ids`. (refs §5.12)

### The overview writes and spawns nothing it should not

Given a Draft plan in a clean repository and a backend that fails the test on any call, when `phax plans overview <plan>` runs, then it exits 0, the backend is never called, and `git status` shows no change. (refs §5.13)

### Every phase is laid out in order

Given a plan of three phases: an oracle phase, its discharging phase and an interactive phase, when `phax plans overview <plan>` runs, then the phases appear in plan order, each with its id, title, model, effort, mode, oracle role (`oracle phase, discharged by phase-02`, `discharges phase-01`, `none`) and test lines. (refs §5.14)

### Planned files fall in architecture parts

Given a configured architecture provider reporting parts `domain` (`src/domain/**`) and `app` (`src/app/**`), and a phase planning `src/domain/x.ts` and `scripts/y.sh`, when `phax plans overview <plan>` runs, then the provider runs once, `src/domain/x.ts` shows under `domain` and `scripts/y.sh` under `(no part)`. (refs §5.15)

### Without a provider, files are listed

Given no architecture provider configured, when `phax plans overview <plan>` runs, then its header says no provider is configured and each phase lists its planned files to create and edit. (refs §5.16)

### A failing provider degrades to files

Given an architecture provider that exits non-zero, when `phax plans overview <plan>` runs, then it exits 0, lists planned files per phase, and prints one warning line on stderr naming the failure. (refs §5.17)

### Coverage ends the overview

Given a plan whose source spec has `ac-a`, `ac-b` and `ac-c`, with `ac-a` named on an oracle line of phase-01 and an in-phase line of phase-02, `ac-b` on phase-03, and `ac-c` on no line, when `phax plans overview <plan>` runs, then it ends with `ac-a` against phase-01 oracle and phase-02 in-phase, `ac-b` against phase-03, and `ac-c` as uncovered. (refs §5.18)

### JSON carries the same overview

Given any plan that parses, when `phax plans overview <plan> --json` runs, then stdout is one JSON document whose phases, placement, test lines and coverage match the rendered overview, and nothing else is on stdout. (refs §5.19)

### An unparsable plan points to lint

Given a plan.md with a phase heading missing its anchor, when `phax plans overview <plan>` runs, then it exits 1 with one line naming `phax plans lint <plan>`. (refs §5.20)

### A formatted string is lifted

Given a live plan sidecar at the previous shape whose every testStrategy string is lines in the format, and a body that is its own rendering, when `phax artifact migrate-documents` runs, then the sidecar's testStrategy becomes the equivalent test lines, the body is unchanged, and the result is committed. (refs §5.21)

### A prose string is refused

Given the `interactive-phases` plan sidecar as it stands today, when `phax artifact migrate-documents` runs, then the sidecar is refused with a message naming phase-01, its first departing line and the remedy, and the sidecar is left as it was. (refs §5.21)

### The schema states the format

Given the current phax, when `phax artifact schema plan` runs, then the `testStrategy` item schema lists size, technique and loop as enums of exactly the skill's values, and its description states the line format. (refs §5.22, §5.1)

### The skill documents the data

Given the shipped phax-planning skill, when the skills test reads it, then its headless section describes `testStrategy` as an array of test lines with the coordinate keys, and its Test strategy section names `phax plans lint` and `phax plans overview`. (refs §5.23)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-where — Where does the test line structure live: only in the plan document, also parsed from any plan.md, and does it join `phax-plan.json`? (§5 follows the verdict.)

- document-only — Only in the plan document; a hand-authored plan.md shows no lines in the overview and lint skips it — abandons: every hand-authored plan: no overview lines, no coverage, no oracle-loop check. It also contradicts the overview reading the deterministic parser, because the lines would come from the sidecar instead.
- parsed-informational — Parsed from `### Test strategy` in any plan.md by the deterministic parser, kept out of `phax-plan.json` — abandons: run-time use of the lines. The phase prompt, the records and the review handoff cannot see them without re-reading plan.md, and a departing line is a lint error that the run itself does not refuse.
- parsed-extracted — Parsed from any plan.md and carried into `phax-plan.json` — abandons: runs in flight and the extraction contract. Every older `phax-plan.json` is refused on resume, the model-fallback extraction must emit coordinates, and all of it serves no reader in the run.

Recommendation: parsed-informational — The overview and lint must work on every plan, so the parser has to read the lines. No part of the run reads them yet, so moving them into `phax-plan.json` costs runs in flight and the extraction contract for nothing. If a later spec gives the run a reader, it can carry them then.

Decision: parsed-extracted — by operator (Rémy Loubradou), 2026-10-23
Why: Decided by the operator on 2026-10-23, against the recommendation: one source of what a plan declares. `phax-plan.json` stays the single record of a plan's phases; a structure the parser reads but extraction drops would be a second reading of the plan, beside the one the run keeps. Advocate: No part of the run reads the lines yet: extracting them changes the `phax-plan.json` shape and the cache seed, and asks the model fallback to emit coordinates, with no reader in the run to show for it. Principles: none. Reversibility: costly. Revised: §5.6, §6 phax-plan.json test lines, AC phax-plan.json carries the test lines, §7, §10.

### q-migrate — What does `phax artifact migrate-documents` write for a live plan sidecar whose `testStrategy` is a string?

- refuse — Always refuse, naming re-authoring — abandons: every live sidecar whose strings already follow the format. It is refused even though a deterministic lift was possible, and approve, reopen and decide stay blocked on it until someone edits it by hand.
- lift-unstructured — Lift the string into one line marked unstructured, which lint reports — abandons: the closed format. The persisted shape keeps a permissive `unstructured` variant forever, which is the back-compat shim the repository refuses.
- parse-or-refuse — Parse the string when every line follows the format; refuse otherwise, naming the first departing line — abandons: interactive-phases as it stands. None of its seven strings follow the format, so it is refused and blocked from approve, reopen and decide until its test strategies are rewritten in the format or it is re-authored. The parse costs nothing extra because the plan.md parser is reused.

Recommendation: parse-or-refuse — It is deterministic and invents no coordinate, and it never adds a variant to the persisted shape. Its cost lands on the one live plan, interactive-phases. That plan's test strategies are prose that the skill revision of a08d93cb already asks to be rewritten as lines. If the plan runs and completes before this release, it is archived and migration never touches it.

Decision: parse-or-refuse — by operator (Rémy Loubradou), 2026-10-23
Why: Decided by the operator on 2026-10-23, as recommended: it is deterministic, invents no coordinate and adds no variant to the persisted shape. interactive-phases, the live plan the recommendation named, was abandoned on 2026-10-23 (04f6208b): no live plan sidecar remains, so the refusal lands on none today. Advocate: Always refusing is one rule with no parser in the migration, and with no live plan sidecar left there is nothing for the lift to save. Principles: none. Reversibility: cheap. Revised: none.

### q-lint — Which lint findings are errors, which are warnings, and which are not checked? (§5 follows the recommendation.)

- all-errors — Every defect is an error: a format departure, an unknown criterion id, an oracle line off an oracle phase, an oracle phase with no oracle line, an uncovered criterion, and a phase with no line — abandons: specs split across plans and docs-only phases. A plan of a spec with `completesSpec: false` fails on criteria a later plan covers, and every docs phase must invent a line to pass.
- graded — Contradictions are errors: a format departure, an unknown criterion id, an oracle line off an oracle phase, an oracle phase with no oracle line. An uncovered criterion is a warning. A phase with no line is not checked. — abandons: blocking on gaps. A plan that leaves a criterion untested still lints with exit 0, so the uncovered criterion is caught only by an operator who reads the warning or the overview.
- all-warnings — Every finding is a warning — abandons: lint's exit code as proof that the oracle pairs and test lines agree. That agreement is settled direction, and a plan breaking it would still exit 0.

Recommendation: graded — A contradiction is always wrong, so it is an error. An uncovered criterion is sometimes right, because one spec can feed several plans. A phase with no line is often right, as in a docs-only phase. Warnings that fire on correct plans teach the operator to ignore them, and the overview already shows every gap.

Decision: graded — by operator (Rémy Loubradou), 2026-10-23
Why: Decided by the operator on 2026-10-23, as recommended: a contradiction is always wrong, an uncovered criterion is sometimes right (one spec feeds several plans), a phase with no line is often right (a docs-only phase); the overview shows every gap. Advocate: An untested acceptance criterion is exactly the gap a test strategy exists to catch; as a warning, a plan that leaves one untested still lints clean and runs. Principles: none. Reversibility: cheap. Revised: none.

### q-command — What is the overview's command and contract?

- new-command — A new `phax plans overview <plan> [--json]` beside lint and estimate, with no cost — abandons: a single screen for shape and cost. The operator runs `phax plans estimate` separately to see what the plan costs.
- dry-run-mode — Fold it into `phax run --dry-run` — abandons: the before-approval, model-free guarantee. Dry-run goes through the run's entry and extraction, so the layout is tied to a run being possible at all.
- with-cost — A new command that also prints each phase's P50 cost — abandons: the guarantee of starting no session. Estimate probes Claude Code by default, so the overview would have to probe or duplicate estimate's `--no-probe` path and its ledger backfill.

Recommendation: new-command — The read-only, model-free guarantee is settled, and a separate command is the cheapest way to keep it. A second command to type is a small price, and `--json` matches lint and estimate.

Decision: new-command — by operator (Rémy Loubradou), 2026-10-23
Why: Decided by the operator on 2026-10-23, as recommended: a separate command keeps the overview read-only and model-free at the lowest cost; `--json` matches lint and estimate. Advocate: One screen would answer both what the plan does and what it costs before approval, without a second command. Principles: none. Reversibility: cheap. Revised: none.

### q-architecture — How does the overview reach the architecture, and what does it print when the provider fails?

- run-provider — Run the configured provider once with the plan's planned files. On failure, show files, warn once on stderr and exit 0. — abandons: a command that spawns no process at all. A read-only command runs a repository script whose speed and side effects phax does not control, as lint already does for part bounds.
- files-only — Show planned files only and leave parts to `phax architecture` — abandons: the answer the overview exists for, which part each phase touches. The operator goes back to matching globs by eye.

Recommendation: run-provider — Lint already runs the provider and accepts its cost. A failing provider only takes away the placement, while the layout, test lines and coverage still stand, so it is a warning with exit 0, never an exit 1.

Decision: run-provider — by operator (Rémy Loubradou), 2026-10-23
Why: Decided by the operator on 2026-10-23, as recommended: lint already runs the provider for part bounds; a failing provider only takes away the placement, so it is a warning with exit 0. Advocate: A read-only command that spawns no process stays fast and free of side effects whatever the repository's provider script does. Principles: none. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The coordinates, their values and the line format are the phax-planning skill's (a08d93cb); this spec makes them data and does not reopen them.
- Oracle-loop lines belong on oracle phases only, and a discharging phase lists only in-phase lines.
- The overview is read-only and model-free: it starts no session, writes nothing, and runs on a plan in any status, like lint.
- The per-phase content of the overview and the trailing coverage are fixed by §5.
- The skill is revised with the format, and its headless section documents the new shape.

Left open:

- Key spellings in the sidecar (`loop`, `criterion`), the lint check name (`tests`), and the rendered and JSON layouts of the overview are indicative.
- The §9 answers: where the structure lives, the migration rule, lint severities, the command and its contract, and how the overview reaches the architecture.

Constraints:

- The plan-document shape changes, so freeze the 0.26.0 schema and its renderer under the history snapshots, as was done for 0.25.0, and add an entry to docs/upgrading.md naming `phax artifact migrate-documents`.
- No back-compat shims: every test line key is required, and `criterion` is null rather than absent.
- The overview's layer has no Backend, the same construction that keeps lint model-free.
- Reuse the architecture provider path that lint uses for part bounds, and phax's glob dialect, for placement.
- Criterion ids are read from the source spec's JSON sidecar, never from its Markdown body.
- The parser change is shared by lint, estimate and extraction. The extracted projection and the cache seed carry the test lines (q-where): cut the current `phax-plan.json` snapshot as for the plan document, let the model-fallback extraction emit them through the same JSON Schema, and say in docs/upgrading.md what becomes of a run extracted before the release.
- Update the generated usage spec and CLI docs for the new command; their drift tests guard them.

## 11. Docs page

Page: docs/plan-overview.md

Reader: An operator who has a plan in hand and wants to see its shape, oracle pairs and criterion coverage before approving or running it.

Example: `phax plans overview docs/plans/2610240900-invoice-export-plan.md` on a three-phase plan with an oracle pair. The page shows the rendered layout, the parts each phase touches, and the coverage block with one uncovered criterion, then the matching `phax plans lint` warning.

## 12. Decision log

- 2026-10-23 q-where decided parsed-extracted — operator (Rémy Loubradou) — revised 5 sections
- 2026-10-23 q-migrate decided parse-or-refuse — operator (Rémy Loubradou)
- 2026-10-23 q-lint decided graded — operator (Rémy Loubradou)
- 2026-10-23 q-command decided new-command — operator (Rémy Loubradou)
- 2026-10-23 q-architecture decided run-provider — operator (Rémy Loubradou)
