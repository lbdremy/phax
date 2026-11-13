---
status: Approved
date: 2026-11-13
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-13
  baseline: 35ca2e7
---
# Property-based tests over phax's input boundaries

## 1. Context

phax decodes every external input through an Effect Schema at the boundary. Its persisted formats are versioned: each document carries a `$schema` stamp naming its format and shape, and the ledger in src/schemas/schemaUrl.ts lists 41 formats. 28 of them were born with `$schema`, and the other 13 also have a pre-schema shape. Frozen decoders under src/schemas/history/ read the older shapes, and the per-format readers in src/schemas/persisted.ts lift those shapes to the current value. Those readers promise never to throw. They refuse a stamp newer than the running release (PHAX_RELEASE). A few also enforce rules the schema alone does not, such as refusing a phase status awaiting review that records no waiting stop. The schemas package (@lbdremy/phax-schemas) reads the same formats with its own stamp resolution and makes the same promise: a parse failure is a value, never an exception.

Agents author plans as Markdown. phax reads that Markdown with a deterministic parser (extraction, and a structure check that `phax plans lint` reports), and renders plan documents back to Markdown. tests/unit/renderPlan.test.ts checks one fixture's round trip: render it, extract it, and compare the result with the document's projection.

The run state machine that phax executes is the pure reducer in src/domain/reducer.ts. It maps a state and an event to a disposition (Handled with a next state and effects; Ignored, Stale, Rejected or Unexpected with a reason). The transition functions in src/domain/state.ts are deprecated, and nothing in src/ calls them. The CLI contract has a conformance suite whose refusal is exit 64 with nothing on standard output and a message on standard error.

All of these contracts are tested with hand-written fixtures only. The repository uses no property-testing library. Effect 4.1.4 ships effect/Arbitrary, which derives generators from schemas, runs on its own engine and is marked @stability unstable. OpenSSF Scorecard's Fuzzing check scored 0 in the repository's first score (6.7, 2026-11-13). The check counts fast-check property tests in a TypeScript project.

Ground read:

- `src/schemas/persisted.ts` — The bridge from a parsed file to phax's value. readPersisted and readSchemaBornPersisted never throw by contract. They refuse a non-object and a `$schema` newer than PHAX_RELEASE, read the current shape, and step a pre-schema shape. Per-format readers route older stamps to the frozen decoders. Some readers add rules beyond the schema, e.g. a phase status awaiting review without a waiting stop is refused.
- `src/schemas/schemaUrl.ts` — FORMAT_IDS, the ledger of 41 persisted formats; SCHEMA_BORN_FORMAT_IDS (28 born with `$schema`) and PRE_SCHEMA_FORMAT_IDS; parseSchemaUrl and compareReleases.
- `packages/schemas/src/index.ts` — The schemas package's parse functions and parseDocument, a second reader of the same formats that resolves stamps on its own.
- `packages/schemas/README.md` — The package's promise: a parse failure is a value, never an exception; a newer stamp asks for an upgrade.
- `packages/schemas/releases.json` — The releases from 0.17.0 to 0.37.0 that a stamp can name.
- `src/domain/plan/parsePlanMarkdown.ts` — readPlanDeterministic, extractPlanDeterministic and collectPlanStructureErrors, all built on one walk of the Markdown.
- `src/domain/authoring/renderPlan.ts` — renderPlanBody, which renders a plan document to plan.md.
- `tests/unit/renderPlan.test.ts` — A single-fixture round trip already exists: render, extract, finalize, then compare with the document's projection. The property generalizes it.
- `src/domain/state.ts` — RunState, PhaseState, the hierarchical PhaxState and TERMINAL_PHASE_STATES (committed, cleaned_up, review_open, skipped). Its transition functions are @deprecated, and nothing in src/ calls them.
- `src/domain/reducer.ts` — interpret(state, event) is the live state machine, used by the dispatcher, resume and the interrupt handler. It returns Handled, Ignored, Stale, Rejected or Unexpected, and assertNever throws on an impossible state. archived handles no event, and completed and stopped move only to archived.
- `src/cli/commandLibrary/contract/conformance/cases.ts` — The CLI contract's conformance cases: a refusal exits 64 with nothing on stdout and a message on stderr. A defect has its own exit code, and in-memory IO is available.
- `vitest.config.ts` — The unit tier: tests/unit/**, with a 30 s per-test timeout.
- `.github/workflows/security.yml` — Runs on every pull request, on every push to main, daily (cron 17 5 * * *) and on demand. Its jobs are security-audit and semgrep.
- `.github/workflows/ci.yml` — CI runs pnpm test:type and pnpm test.
- `package.json` — effect ^4.1.4 and vitest ^5.1.0. No property-testing library.
- `CONTRIBUTING.md` — The Tests section, which lists the test tiers a contributor runs.

## 2. Problem

A hand-written fixture checks only the inputs its author thought of, while the boundaries phax decodes face inputs nobody wrote: files from older releases, files edited or damaged by hand, Markdown from an agent, and argument vectors from a person. Several promises sit at exactly these boundaries: never throw on any JSON, refuse a newer stamp whatever the document holds, read every shape back to what was written, keep every older shape readable, and parse any Markdown into a plan or errors in bounded time. No test checks any of these promises in general. Two readers of the same 41 formats (phax's own and the schemas package's) resolve stamps independently, and nothing checks that they agree. The reducer throws on an impossible state, and nothing checks that no reachable pair of state and event gets there. A broken promise therefore shows up in a user's file, not in CI. When one does, there is no minimal counter-example to fix it against.

## 3. Product goal

Each contract phax decodes its input with is stated as a property: something that must hold for every input. Generated input then checks it, starting with the persisted formats and then covering the plan parser, the state machine and CLI arguments. A broken property fails `pnpm test:unit` with a seed and a shrunk counter-example that anyone can replay. A daily deeper pass searches further. Each counter-example found becomes a hand-written case beside its fix. The aim is to show that the validation holds and to find where it does not, at no noticeable cost to the unit tier.

> A property states a promise phax already makes at an input boundary; a generator searches for the input that breaks it, and every failure replays from its seed.

## 4. Terminology

- **property** — A statement that must hold for every input of a given kind, checked against a bounded number of generated inputs.
- **generator** — A source of random inputs of one kind (a format's valid values, any JSON value, any text, any event sequence) that can shrink a failing input.
- **counter-example** — A generated input on which a property fails. The shrunk counter-example is the smallest such input the shrinker finds from it.
- **seed and path** — The seed fixes the sequence of generated inputs. The path leads from that seed to the shrunk counter-example. Together they replay a failure exactly.
- **run count** — The number of generated inputs a property is checked against in one test run.
- **format ledger** — The list of phax's 41 persisted format ids (FORMAT_IDS).
- **valid value** — A value that phax's writer for a format could produce: it satisfies the format's current schema and every rule the format's reader enforces beyond it (for example, a phase status awaiting review records a waiting stop).
- **written encoding** — The JSON text of a value as phax writes it: the value encoded by its format's schema, with `$schema` first, naming the format's current stamp.
- **frozen shape** — An older shape of a format that a frozen decoder reads: one stamped below the format's current stamp, or one written before `$schema` (pre-schema).
- **refusal** — A failure returned as a value: a read error, structure errors, a Rejected/Ignored/Stale/Unexpected disposition, or the CLI contract's exit 64.
- **defect** — A thrown exception or an Effect defect, as opposed to a refusal. At the CLI, it is the contract's defect exit code.
- **terminal run state** — completed, stopped or archived. archived is absorbing, and completed and stopped move only to archived.
- **terminal phase state** — A phase state in TERMINAL_PHASE_STATES: committed, cleaned_up, review_open or skipped.
- **deep pass** — The daily run of every property with a larger run count and a fresh seed.

## 5. Functional requirements

### 5.1 Persisted formats: a written value reads back

For every format in the format ledger, the system shall read the written encoding of any valid value of the format's current shape back to a value equal to the one written.

### 5.2 Persisted formats: any JSON reads or is refused

IF a format's reader is given any JSON value THEN the reader SHALL return either a read value or a refusal, and SHALL NOT throw an exception or raise a defect.

### 5.3 Persisted formats: a newer stamp is refused

IF a document's `$schema` names the reader's format at a release newer than the running phax release THEN the reader SHALL refuse it with a refusal naming that release, whatever the rest of the document holds.

### 5.4 Persisted formats: every older shape stays readable

For every frozen shape of every format, the system shall read any valid value of that shape without a refusal, when the value is stamped at a release within the shape's range (or carries no `$schema`, for a pre-schema shape). Where the format's reader reports the shape it read, it shall report that frozen shape.

### 5.5 Persisted formats: phax and the schemas package agree

For every format that both phax and the schemas package read, the system shall have both readers reach the same verdict on every generated document: both read it, or both refuse it.

### 5.6 Persisted formats: no format escapes the properties

IF a format in the format ledger has no generator THEN the property suite SHALL fail, naming that format.

### 5.7 Plan parser: a rendered plan parses back

For any valid plan document, the system shall parse the Markdown rendered from it back to the plan the document projects to, with no warning.

### 5.8 Plan parser: any text yields a plan or errors

IF the plan parser is given any text THEN it SHALL return either a plan or at least one structure error, and SHALL NOT throw.

### 5.9 Plan parser: bounded time

IF the plan parser is given any text of at most 64 KiB THEN it SHALL return within 2 seconds.

### 5.10 Plan parser: the structure check agrees with extraction

The system's plan structure check shall report no error for a text exactly when deterministic extraction reads a plan from that text.

### 5.11 State machine: every state and event has a disposition

For any reachable run state and any event, the state machine shall return a disposition and shall not throw.

### 5.12 State machine: an archived run stays archived

WHILE a run is archived THE state machine SHALL handle no event.

### 5.13 State machine: a completed or stopped run only archives

WHILE a run is completed or stopped THE state machine SHALL handle an event only by moving the run to archived.

### 5.14 State machine: a terminal phase stays terminal

WHEN the state machine handles an event from a state whose phase is in a terminal phase state THE next state SHALL hold no phase, a phase in a terminal phase state, or a phase in pending (the next phase's start).

### 5.15 State machine: a refused event changes nothing

IF the state machine does not handle an event (Ignored, Stale, Rejected or Unexpected) THEN the disposition SHALL carry no next state and request no effect.

### 5.16 CLI arguments: accepted or refused through the contract

IF the command library's runner is given any argument vector THEN it SHALL either run the matched command or refuse through the contract's refusal (exit 64, nothing on standard output, a message on standard error), and SHALL NOT exit with the defect code.

### 5.17 Tier: properties run with the unit tests

The system shall run every property test in the unit tier, so that `pnpm test:unit`, `pnpm check:full` and CI run them with no separate command.

### 5.18 Budget: bounded run count and duration

The system shall check each property against a fixed run count of 100 generated inputs unless PHAX_PROPERTY_RUNS sets another, and at that default the property tests shall add no more than 60 seconds to `pnpm test:unit` on CI.

### 5.19 Budget: a fixed default seed

The system shall use a fixed seed when PHAX_PROPERTY_SEED is unset, so that the same commit gives every property the same generated inputs, and shall pick and print a fresh seed when PHAX_PROPERTY_SEED is `random`.

### 5.20 Deep pass: the daily Security workflow searches further

WHERE the Security workflow runs on its daily schedule or on demand THE system SHALL run every property with 2,000 generated inputs and a fresh seed, and print the seed it used.

### 5.21 Reproduction: a failure prints what replays it

WHEN a property fails THE system SHALL print the seed, the path, the shrunk counter-example as a literal that a hand-written case can paste, and a command line that replays it.

### 5.22 Reproduction: the printed seed replays the failure

WHEN `pnpm test:unit` runs with PHAX_PROPERTY_SEED and PHAX_PROPERTY_PATH set to a failure's printed seed and path THE same property SHALL fail on the same shrunk counter-example.

## 6. Surface

### cli: pnpm test:unit — indicative

Summary: A failing property in `pnpm test:unit` prints its seed, its shrunk counter-example and the command that replays it.

before:

    $ pnpm test:unit
     ✓ tests/unit/renderPlan.test.ts (24 tests)
     ✓ tests/unit/parsePlanMarkdown.test.ts (61 tests)
     Test Files  412 passed

after:

    $ pnpm test:unit
     FAIL  tests/unit/property/persistedFormats.property.test.ts > run-status > reads its written encoding back
    Property failed after 37 runs (seed 1849203311, path "36:0:2"), shrunk 12 times
    Counter-example:
      {"$schema":"https://docs.phax.run/schemas/run-status/0.36.0.json", …}
    Replay:
      PHAX_PROPERTY_SEED=1849203311 PHAX_PROPERTY_PATH=36:0:2 pnpm test:unit tests/unit/property/persistedFormats.property.test.ts

### config: PHAX_PROPERTY_SEED, PHAX_PROPERTY_PATH, PHAX_PROPERTY_RUNS — normative

Summary: Three environment variables set the seed, the replay path and the run count of every property test.

    PHAX_PROPERTY_SEED=1849203311   # generate from this seed; unset: a fixed seed; random: a fresh, printed seed
    PHAX_PROPERTY_PATH=36:0:2       # with the seed, go straight to the shrunk counter-example
    PHAX_PROPERTY_RUNS=2000         # generated inputs per property; unset: 100

### config: .github/workflows/security.yml — indicative

Summary: The daily Security workflow runs a deeper pass of every property test with a fresh seed.

before:

    jobs:
      security-audit:
        runs-on: ubuntu-latest
      semgrep:
        runs-on: ubuntu-latest

after:

    jobs:
      security-audit:
        runs-on: ubuntu-latest
      semgrep:
        runs-on: ubuntu-latest
      property-tests:
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        runs-on: ubuntu-latest
        steps:
          # checkout, pnpm, mise and pnpm install, as in security-audit
          - name: Property tests, deep pass
            env:
              PHAX_PROPERTY_RUNS: "2000"
              PHAX_PROPERTY_SEED: random
            run: pnpm test:unit tests/unit/property

### package: fast-check — indicative

Summary: phax's development dependencies include fast-check, the property-testing library its tests run on.

before:

    "devDependencies": {
      "esbuild": "^0.28.2",
      "github-slugger": "^2.0.0",
      "knip": "^6.45.1"
    }

after:

    "devDependencies": {
      "esbuild": "^0.28.2",
      "fast-check": "^4.3.0",
      "github-slugger": "^2.0.0",
      "knip": "^6.45.1"
    }

## 7. Non-goals

- Coverage-guided fuzzing: no fuzzing engine that instruments the code.
- Fuzzing the provider CLIs phax drives (Claude Code, Codex, Mistral Vibe).
- Random arguments to every phax command: the CLI slice checks the command library's runner and its refusal, not each command's use case.
- Properties over the app or infra layers (git, file system, shell): every property calls pure functions in domain/ or schemas/, with no port.
- Replacing the hand-written suites: properties add to them, and every counter-example found becomes one more hand-written case.
- Changing a persisted format's shape or stamp: a counter-example is fixed in the reader or the generator, and a fix that needs a new shape is its own spec.
- Properties over the frozen renderers (the renderPlanBodyV0_* functions) or the deprecated transition functions in src/domain/state.ts.
- Treating the OpenSSF Scorecard score as an acceptance target: the Fuzzing check is a side effect.

## 8. Acceptance criteria

### Every format reads its written value back

Given the format ledger and a generator of valid values per format, when the persisted-format properties run in `pnpm test:unit`, then for each of the 41 formats, every generated current-shape value, written as its written encoding and read back, equals the value written. (refs §5.1)

### No JSON value makes a reader throw

Given generated JSON values: arbitrary JSON, objects carrying the format's `$schema` at arbitrary releases (and at malformed URLs), and valid documents with one key removed or one value replaced by another JSON type, when each value is given to each format's reader, then every call returns a read value or a refusal, and none throws or dies. (refs §5.2)

### A newer stamp is refused whatever the body

Given a document whose `$schema` names its format at a release one patch, one minor or one major above the running release, with a body that is either a valid value or arbitrary JSON, when the format's reader reads it, then it is refused, and the refusal names that release. (refs §5.3)

### Every frozen shape reads

Given a generated valid value of each frozen shape, stamped at a generated release within the shape's range, or carrying no `$schema` for a pre-schema shape, when the format's reader reads it, then it is read without a refusal, and a reader that reports the shape it read reports that frozen shape. (refs §5.4)

### phax and the schemas package reach the same verdict

Given the generated documents of the round-trip and totality properties, for a format both phax and the schemas package read, when phax's reader and the package's parse function each read the document, then both read it or both refuse it, apart from a disagreement listed in the test as a named, explained exception. (refs §5.5)

### A format without a generator fails the suite

Given a format id in the format ledger with no generator, when `pnpm test:unit` runs, then the property suite fails with a message naming that format id. (refs §5.6)

### A rendered plan parses back to its projection

Given generated valid plan documents, when each is rendered to Markdown and read back by deterministic extraction, then the extracted plan equals the document's projection and carries no warning. (refs §5.7)

### Any text yields a plan or structure errors

Given generated text: arbitrary strings, and rendered plans with a heading, a line or a code fence inserted, removed or swapped, when the plan parser reads it, then it returns a plan or at least one structure error, and never throws. (refs §5.8)

### Parsing finishes in bounded time

Given generated text of at most 64 KiB, including deeply nested lists and long runs of one heading, emphasis or fence character, when the plan parser reads it, then every call returns within 2 seconds. (refs §5.9)

### The structure check agrees with extraction

Given the generated text of the totality property, when both the structure check and deterministic extraction read it, then the structure check reports no error exactly when extraction reads a plan. (refs §5.10)

### Every state and event gets a disposition

Given generated reachable run states with their phase sub-states, and generated events of every event type, when the state machine interprets each pair, then it returns a disposition and never throws. (refs §5.11)

### An archived run handles nothing

Given an archived run and any generated event, when the state machine interprets the event, then the disposition is not Handled. (refs §5.12)

### A completed or stopped run only archives

Given a completed or stopped run and any generated event, when the state machine handles the event, then the next state is archived. (refs §5.13)

### A terminal phase does not go back

Given a run state whose phase is committed, cleaned_up, review_open or skipped, and any generated event, when the state machine handles the event, then the next state holds no phase, a phase in a terminal phase state, or a phase in pending. (refs §5.14)

### A refused event carries no change

Given generated pairs of reachable state and event, when the state machine returns Ignored, Stale, Rejected or Unexpected, then the disposition carries no next state and no effect. (refs §5.15)

### Any argv is run or refused through the contract

Given generated argument vectors: arbitrary strings, and known command words followed by arbitrary flags and values, when the command library's runner runs the conformance suite's program with each, over in-memory IO, then each call either runs a command and exits with one of its declared codes, or exits 64 with nothing on standard output and a message on standard error, and none exits with the defect code. (refs §5.16)

### The properties run in the unit tier

Given the property test files, when `pnpm test:unit` and `pnpm check:full` run, then the property tests are among the tests they run, with no other command. (refs §5.17)

### The default budget is bounded

Given PHAX_PROPERTY_RUNS unset, when `pnpm test:unit` runs on CI, then each property is checked against 100 generated inputs, and the property test files together take at most 60 seconds. (refs §5.18)

### The default seed is fixed

Given PHAX_PROPERTY_SEED unset, when `pnpm test:unit` runs twice on the same commit, then every property is given the same generated inputs both times; with PHAX_PROPERTY_SEED=random, each run prints the fresh seed it picked. (refs §5.19)

### The daily Security run searches deeper

Given the Security workflow triggered by its daily schedule or on demand, when its property-tests job runs, then every property runs with PHAX_PROPERTY_RUNS=2000 and PHAX_PROPERTY_SEED=random, the job log prints each seed used, and the job does not run on a pull request. (refs §5.20)

### A failure prints its replay

Given a property made to fail by a deliberately broken function in a test of the property harness, when the property runs, then the output holds the seed, the path, the shrunk counter-example as a JSON or string literal, and a replay command line setting PHAX_PROPERTY_SEED and PHAX_PROPERTY_PATH. (refs §5.21)

### The printed seed replays the failure

Given the seed and path that a failing property printed, when `pnpm test:unit` runs with PHAX_PROPERTY_SEED and PHAX_PROPERTY_PATH set to them, then the same property fails on the same shrunk counter-example. (refs §5.22)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-engine — Which engine do the properties run on: fast-check, or Effect's own effect/Arbitrary runner?

- fast-check — fast-check, a new devDependency — abandons: Schema-native generation for free. Generators must be bridged from the schemas or written, and phax takes on one more development dependency.
- effect-arbitrary — Effect's effect/Arbitrary and its runner — abandons: A stable testing API and Scorecard's Fuzzing point: the module is @stability unstable, so a minor Effect bump can break every property, and Scorecard does not recognize it.

Recommendation: fast-check — fast-check's API is stable, its seed, path and shrinking output is mature, and Scorecard counts it. The bridge to the schemas is the one cost, and it is paid once for all 41 formats (see q-generators). An unstable engine under the suite meant to prove stability is the worse loss.

Decision: fast-check — by operator (Rémy Loubradou), 2026-11-13
Why: fast-check's API is stable, its seed, path and shrinking output is mature, and Scorecard counts it. The bridge to the schemas is the one cost, and it is paid once for all 41 formats (see q-generators). An unstable engine under the suite meant to prove stability is the worse loss. Advocate: Effect's own engine derives generators straight from the schemas with no bridge and no new dependency, so generators can never drift from the schemas; the instability is a risk phax already carries for every other Effect API it uses. Principles: S1. Reversibility: costly. Revised: none.

### q-generators — How are valid values generated for the 41 formats and their frozen shapes?

- derive-effect — Derived from each Effect Schema through effect/Arbitrary, bridged into fast-check, with per-format overrides for rules readers enforce beyond the schema — abandons: Stability of the generator layer: the bridge rests on an unstable Effect API, and an Effect upgrade can force the bridge to be rewritten.
- derive-json-schema — Derived from the draft-07 JSON Schemas the schemas package ships — abandons: The refinements Effect schemas carry and JSON Schema loses (filters, branded strings, cross-field checks). Far more generated values would be refused, so many more overrides would be needed.
- by-hand — Written by hand per format and per frozen shape — abandons: Generators that track the schemas: more than sixty hand-written generators drift from the shapes they mirror, which is the very drift the properties exist to catch.

Recommendation: derive-effect — Deriving from the schemas phax decodes with is the only option that grows with the ledger at no extra cost: a new format or frozen shape is covered once it is registered. The instability is confined to one bridge module that the suite exercises on every run, so an Effect upgrade that breaks it fails loudly, not silently. Frozen shapes are generated the same way, from their frozen decoders' schemas.

Decision: derive-effect — by operator (Rémy Loubradou), 2026-11-13
Why: Deriving from the schemas phax decodes with is the only option that grows with the ledger at no extra cost: a new format or frozen shape is covered once it is registered. The instability is confined to one bridge module that the suite exercises on every run, so an Effect upgrade that breaks it fails loudly, not silently. Frozen shapes are generated the same way, from their frozen decoders' schemas. Advocate: Hand-written generators rest on no unstable API and give full control over which values are valid, so an Effect upgrade can never break the whole generator layer at once. Principles: S1, S4. Reversibility: costly. Revised: none.

### q-budget — What run count and seed does each property use, locally, on a pull request, and in the daily Security workflow?

- fixed-100 — 100 runs from a fixed seed everywhere, with no deep pass — abandons: Search: every run checks the same inputs forever, so a counter-example outside that set is never found.
- random-100-daily-2000 — 100 runs from a fresh seed on every run, and 2,000 daily — abandons: Pull-request determinism: an unrelated pull request can go red on a counter-example its change did not cause.
- fixed-100-daily-2000 — 100 runs from a fixed seed locally and on pull requests, and 2,000 from a fresh seed in the daily Security workflow — abandons: Same-day detection: a counter-example outside the fixed seed's inputs is found by the next daily run, not on the pull request that introduced it.

Recommendation: fixed-100-daily-2000 — A pull request's result then depends only on its code, and the daily pass searches twenty times deeper with a new seed each day. A failed scheduled run already emails whoever last edited the cron. A delay of a day is the acceptable loss, because the boundaries change rarely. The §5 requirements are written to this default.

Decision: fixed-100-daily-2000 — by operator (Rémy Loubradou), 2026-11-13
Why: A pull request's result then depends only on its code, and the daily pass searches twenty times deeper with a new seed each day. A failed scheduled run already emails whoever last edited the cron. A delay of a day is the acceptable loss, because the boundaries change rarely. The §5 requirements are written to this default. Advocate: A fresh seed on every run finds a counter-example on the pull request that introduces it, a day sooner, instead of leaving it to the next daily pass. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-first-slice — Which slices does the first plan take?

- formats-only — The persisted formats alone (round trip, totality, newer stamp, frozen shapes, agreement, coverage), plus the shared harness: engine, budget, seed and replay — abandons: The plan parser's round trip, the boundary that agents' Markdown crosses most often, which waits for a second plan.
- formats-and-plan — The persisted formats and the plan parser — abandons: A small first plan: two generator families land at once, and the plan-document generator, the hardest to make valid, gates the whole change.
- all-four — All four slices — abandons: Bounded scope: one plan carries four generator families, and a counter-example in any of them blocks the rest.

Recommendation: formats-only — One property shape covers all 41 formats, and it builds the harness every later slice reuses: the engine, the bridge, the budget, the seed and the replay. The plan parser follows in a second plan against the same spec, and the state machine and the CLI after it.

Decision: formats-only — by operator (Rémy Loubradou), 2026-11-13
Why: One property shape covers all 41 formats, and it builds the harness every later slice reuses: the engine, the bridge, the budget, the seed and the replay. The plan parser follows in a second plan against the same spec, and the state machine and the CLI after it. Advocate: The plan parser is the boundary agents' Markdown crosses most often, so taking it in the first plan would test the riskiest input sooner and prove the harness on a second generator family. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-machine — Which state machine do the state-machine properties check?

- reducer — The reducer phax executes (interpret), with dispositions — abandons: Checks on the deprecated transition functions in src/domain/state.ts, which tests and the architecture rule still name.
- transition-functions — The deprecated transition functions in src/domain/state.ts — abandons: The machine that runs: nothing in src/ calls those functions, so the properties would check allow-lists that no run goes through.
- both — Both — abandons: Focus: the slice is twice the size for no run-time gain, because the transition functions are three-line allow-list checks.

Recommendation: reducer — The dispatcher, resume and the interrupt handler all go through the reducer, and its assertNever is the one place a reachable state could throw. The no-change half of the operator's invariant (sm-refused) is already largely guaranteed by the reducer's types, so it costs little and guards against a future disposition that carries effects.

Decision: reducer — by operator (Rémy Loubradou), 2026-11-13
Why: The dispatcher, resume and the interrupt handler all go through the reducer, and its assertNever is the one place a reachable state could throw. The no-change half of the operator's invariant (sm-refused) is already largely guaranteed by the reducer's types, so it costs little and guards against a future disposition that carries effects. Advocate: Checking both machines would also cover the transition functions that tests and the architecture rule still name, so nothing that exists is left unchecked until they are deleted. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-phase-terminal — The reducer's state holds only the current phase, with no phase identity. How is the invariant that a terminal phase stays terminal stated?

- next-or-terminal — Next or terminal: from a terminal phase state, a handled event leads to no phase, a terminal phase state, or pending — abandons: Detecting a bug that restarts the same phase: the next phase's pending looks the same as the old phase's pending.
- status-sequence — Over each phase's persisted status sequence, through a run driven on fakes — abandons: A pure, fast property: it needs the dispatcher and fake ports, so it moves to the integration tier and outside this spec's pure-function bound.
- run-only — Only the run-level invariants — abandons: The phase half of the operator's invariant, unchecked.

Recommendation: next-or-terminal — It is the strongest form of the invariant that the reducer's own state can observe, and it stays pure and fast. A same-phase restart would be a dispatcher bug, which belongs to the dispatcher's own tests. The §5 requirement sm-phase-terminal is written to this default.

Decision: next-or-terminal — by operator (Rémy Loubradou), 2026-11-13
Why: It is the strongest form of the invariant that the reducer's own state can observe, and it stays pure and fast. A same-phase restart would be a dispatcher bug, which belongs to the dispatcher's own tests. The §5 requirement sm-phase-terminal is written to this default. Advocate: Checking each phase's persisted status sequence would catch a same-phase restart, which the next-or-terminal form cannot tell from the next phase starting. Principles: S1, S5. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- Four slices, in this order of value: persisted formats, plan parser, state machine, CLI arguments. q-first-slice decides how many the first plan takes, and later plans consume this same spec.
- The properties run in the unit tier, under `pnpm test:unit`, so `pnpm check:full` and CI pick them up. The test files sit in their own directory under tests/unit (tests/unit/property/ is indicative).
- The default budget is 100 runs from a fixed seed. The deep pass is 2,000 runs from a fresh seed, in a scheduled and on-demand job of the Security workflow. PHAX_PROPERTY_SEED, PHAX_PROPERTY_PATH and PHAX_PROPERTY_RUNS are the replay contract, and their names are normative.
- The persisted-format properties iterate the format ledger (FORMAT_IDS), and frozen shapes are generated from their frozen decoders. Adding a format is covered once its generator is registered, and a format without one fails the suite.
- The plan round trip generalizes the existing helper in tests/unit/renderPlan.test.ts: render, extract, finalize, then compare with the finalized projection.
- The totality generators deliberately mix raw JSON, documents carrying the format's `$schema` at arbitrary or malformed releases, and valid documents with one key removed or retyped, so that the stamp-routing branches are actually reached.

Left open:

- Whether effect/Arbitrary in the installed effect version (^4.1.4) yields a fast-check-compatible arbitrary or only its own runner, which decides how thin the bridge is. Check it against node_modules or the current Effect docs, not training data, before choosing the bridge's shape.
- Which formats need per-format overrides so that generated values are valid values (for example, phase status awaiting review requires a waiting stop), and how each override is named.
- Which deliberate disagreements between phax's readers and the schemas package's parse functions (if any) the agreement property lists as named exceptions, each with its reason.
- How the seed and path are threaded from the environment into every property (a shared parameter helper, or the engine's global configuration).

Constraints:

- Property tests live in tests/ and import only from src/domain and src/schemas (and packages/schemas for the agreement property). No port, no I/O, and nothing in src/ imports a generator.
- The property-testing library is a devDependency only. `pnpm knip`, `pnpm test:type` and `pnpm audit:architecture` stay green.
- A counter-example a property finds becomes a hand-written example case in that boundary's existing suite, in the same commit as its fix. The property stays as it is.
- A fix that a found counter-example needs goes into the reader, the parser or the reducer, never into a format's shape or stamp (see Non-goals).
- Each property finishes within the unit tier's 30-second per-test timeout at its default run count.
- Use pnpm only; no npm, yarn or package-lock.json.

## 11. Docs page

Page: docs/property-tests.md, linked from the Tests section of CONTRIBUTING.md

Reader: A contributor whose pull request or the daily Security run shows a failing property, or who adds a persisted format or a frozen shape and has to register its generator.

Example: The run-status round-trip property fails on a pull request with seed 1849203311 and path 36:0:2. The contributor replays it with `PHAX_PROPERTY_SEED=1849203311 PHAX_PROPERTY_PATH=36:0:2 pnpm test:unit tests/unit/property/persistedFormats.property.test.ts`, fixes the reader, and pastes the printed counter-example into the run-status reader's hand-written suite as a new case, in the same commit.

## 12. Decision log

- 2026-11-13 q-engine decided fast-check — operator (Rémy Loubradou)
- 2026-11-13 q-generators decided derive-effect — operator (Rémy Loubradou)
- 2026-11-13 q-budget decided fixed-100-daily-2000 — operator (Rémy Loubradou)
- 2026-11-13 q-first-slice decided formats-only — operator (Rémy Loubradou)
- 2026-11-13 q-machine decided reducer — operator (Rémy Loubradou)
- 2026-11-13 q-phase-terminal decided next-or-terminal — operator (Rémy Loubradou)
