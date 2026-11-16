# Property tests

A property test states a rule that must hold for every input of a kind, and checks it against many generated inputs instead of a few hand-picked ones. phax uses [fast-check](https://fast-check.dev) for the engine. This page is for a contributor whose pull request or daily Security run shows a failing property, or who is adding a persisted format or a frozen shape and must register its generator.

## What is covered

The spec plans four boundaries:

1. The persisted formats: every format in `FORMAT_IDS` (`src/schemas/schemaUrl.ts`).
2. The plan parser.
3. The state machine.
4. CLI arguments.

All four are written. The run reducer (`## The run reducer`) and the CLI arguments (`## CLI arguments`) have their own sections below.

For each persisted format, the suite in `tests/unit/property/persistedFormats.property.test.ts` has one `describe` per format id and one `it` per property:

- `has a generator`: the registry has an entry for the id.
- `reads its written encoding back`: a valid document, written as phax writes it, reads back equal.
- `never throws on any JSON`: every reader answers a verdict (read or refused), never an exception.
- `refuses a newer stamp whatever the body`: a `$schema` stamp newer than the running release is refused, and the refusal names that release.
- `reads every frozen shape`: a document of each older shape, stamped with a release in its range, still reads, and as that shape.
- `reaches the schemas package's verdict`: phax's reader and the schemas package accept and refuse the same documents.
- `registers a frozen shape for every module of its history`: each module under `src/schemas/history/<id>/` has a frozen entry.

Vitest reports a failure as `tests/unit/property/persistedFormats.property.test.ts > run-status > reads its written encoding back`: the file, then the test's full name, `run-status > reads its written encoding back` (the `describe`, then the `it`).

The plan parser's suite is `tests/unit/property/planParser.property.test.ts`, with four tests under `describe("plan parser")`:

- `a rendered plan parses back to its projection`: a generated plan document, rendered by `renderPlanBody`, parses back to the projection of that document, and each phase title reads back as its heading writes it.
- `any text yields a plan or structure errors`: for any text, `collectPlanStructureErrors`, `readPlanDeterministic` and `extractPlanDeterministic` answer and never throw, and a refused text comes with errors that say why. `locatePlanSections` and, on a successful extraction, `finalizeExtractedPlan` read the same text and answer a `Result`, never a throw.
- `parsing finishes in bounded time`: `collectPlanStructureErrors`, `extractPlanDeterministic`, `finalizeExtractedPlan` (on a successful extraction) and `locatePlanSections` each answer within 2 seconds, on inputs up to 64 KiB.
- `the structure check agrees with extraction`: `collectPlanStructureErrors` is empty exactly when `extractPlanDeterministic` succeeds, bar the named structure exceptions.

Vitest reports a failure as `planParser.property.test.ts > plan parser > a rendered plan parses back to its projection`. The same file also holds `renderable rules` and `structure exceptions`, which check that every rule and exception has its example (see below). Two sanity files check the generators themselves: `tests/unit/property/planDocuments.test.ts` and `tests/unit/property/planText.test.ts`.

## Where the files live

- `tests/unit/property/`: the property tests. The unit project collects them, so `pnpm test`, `pnpm test:unit`, `pnpm check:full` and CI run them with no extra command.
- `tests/helpers/property/harness.ts`: the parameters, `checkProperty`, replay and `propertyTimeout`.
- `tests/helpers/property/fromEffect.ts`: `fromSchema`, the bridge from `effect/Arbitrary` into fast-check.
- `tests/helpers/property/formatRegistry.ts`: `FORMAT_REGISTRY`, one entry per format id.
- `tests/helpers/property/jsonInputs.ts`: hand-written JSON generators (`anyJson`, `stampedObject`, `mutatedValid`, `newerStamped`, `newerBody`).
- `tests/helpers/property/planDocuments.ts`: the plan-document generator and `RENDERABLE_RULES`.
- `tests/helpers/property/planText.ts`: the plan-parser text sources (`anyPlanText`, `mutatedPlanText`, `largePlanText`), `PLAN_TEXT_MUTATIONS` and `LARGE_TEXT_FRAGMENTS`.
- `tests/helpers/planRoundTrip.ts`: `roundTrip`, the render-and-parse step of the round trip.
- `tests/helpers/property/reducerInputs.ts`: the reducer's generators (`reachableStates`, `statesOfRun`, `terminalPhaseStates`, `anyEvent`, `eventsBiasedTo`), `handledEventTypes`, `EVENT_GENERATORS` and `REACHABLE_SHAPES`.
- `tests/unit/property/reducerInputs.test.ts`: the sanity and coverage tests of those generators.
- `tests/helpers/property/argvProgram.ts`: `argvProgram()`, the property program, with `PROGRAM_SHAPES`, `declaredExitCodes`, `TRIGGER_WORDS` and `VERDICT_DEFAULT`.
- `tests/helpers/property/argvInputs.ts`: the argument-vector sources (`anyArgv`, `knownArgv`) and the vocabulary read from the program.
- `tests/unit/property/argvInputs.test.ts`: the sanity tests of the program and its generators.

Property tests import only from `src/domain`, `src/schemas`, `packages/schemas`, `tests/helpers/property/` and the shared round-trip step `tests/helpers/planRoundTrip.ts`, which sits outside the property helpers because the `renderPlan` examples use it too. The harness's own tests (`harness.test.ts` and `harnessConfig.test.ts`) may also import `tests/helpers/vitestSelection.ts`, which reads the files a replay line selects. The plan-parser properties import from `src/domain/plan`, `src/domain/authoring` and `src/schemas`. fast-check is a devDependency.

The rule has a second tier. The four argv files (`tests/helpers/property/argvProgram.ts`, `tests/helpers/property/argvInputs.ts`, `tests/unit/property/argvInputs.test.ts` and `tests/unit/property/cliArguments.property.test.ts`) alone may also import `src/cli/commandLibrary/contract/` (including `conformance/memoryIo.ts`) and exactly `src/cli/commandLibrary/commander/run.ts`. Nothing else under `src/cli/` is allowed, and never `commander/index.ts`, because it re-exports the process-backed `processIo`.

This is safe because `run.ts` reaches the world only through the `Io` it is handed, Commander is built with `exitOverride()`, and its output is collected into strings in memory. `memoryIo` keeps every stream and file in memory. The runner is therefore driven with no real I/O and no port.

The guard `%s imports only from the allowed roots` in `tests/unit/property/harnessConfig.test.ts` runs over every `.ts` file of `tests/unit/property/` and `tests/helpers/property/`. It reads each relative specifier, in either quote style, of a `from` (an import or a re-export), a bare side-effect `import "…"` and an `import("…")`. A target under `src/` or `packages/` must be under an allowed root, and a target under `tests/` must be one of the test helpers named above. It fails naming the offending import. The guard's own tests give it one example of each kind it must refuse.

## The default budget

On a pull request and locally, each property runs 100 inputs from a fixed seed (`20261113`), so a run is repeatable: the same code gives the same inputs. Each property finishes within the unit tier's 30-second timeout at that count.

At that count the property files together take at most 60 seconds on CI. The `Property tests budget` step of `.github/workflows/ci.yml` checks it: after the full test run, it runs `pnpm test:unit tests/unit/property` alone and fails if that takes over 60 seconds. The check times the files alone, outside the suite: within `pnpm test` they share the machine with every other test file, so their time there measures the load as much as the properties, and a bound on it would fail at random.

## The three environment variables

| Variable              | Meaning                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PHAX_PROPERTY_SEED`  | An integer within int32, or `random`. Unset means the fixed seed. `random` draws one seed per test file and prints it once, with a replay hint; every property of that file runs from it. |
| `PHAX_PROPERTY_PATH`  | Colon-separated integers (for example `36:0:2`): the shrink path of a failure. It needs a fixed integer seed, not `random`.          |
| `PHAX_PROPERTY_RUNS`  | A positive integer: how many inputs each property checks. Unset means 100. The per-test timeout grows by 30 s per 100 runs (rounded up). |

A value the harness refuses stops the test with a `PropertyConfigError` that names the variable.

## Reading a failure

Every property goes through `checkProperty`, which prints the seed, the path, the shrunk counter-example and a replay line:

```text
Property failed after 37 runs (seed 1849203311, path "36:0:2"), shrunk 2 times
Counter-example:
  {"$schema":"https://…","state":"awaiting_review","stop":{"status":"running"}}
read back differs at /state
Replay:
  PHAX_PROPERTY_SEED=1849203311 PHAX_PROPERTY_PATH=36:0:2 pnpm test:unit tests/unit/property/persistedFormats.property.test.ts -t '^run-status > reads its written encoding back$'
```

(The counter-example above is illustrative.) The counter-example is a JSON literal when the value is JSON-carryable.

Values derived from a schema shrink by size and seed, so the counter-example is the smallest sample that still fails, not always the smallest value. The hand-written JSON generators shrink structurally.

## Replaying

Run the replay line as printed:

```bash
PHAX_PROPERTY_SEED=1849203311 PHAX_PROPERTY_PATH=36:0:2 pnpm test:unit tests/unit/property/persistedFormats.property.test.ts -t '^run-status > reads its written encoding back$'
```

The `-t` value is the test's full name without the file: vitest matches `-t` as a regular expression against each test's `describe > it` name, so the harness escapes the name and anchors it (`^…$`) to select that test alone. A `-t` value that also names the file matches no test, and the run passes without checking anything. `pnpm test:unit` runs the unit project, so the file path is the only file filter.

The seed and path run only that failing input again. Without the path, the seed replays the whole run. A daily deep pass prints its seeds in the log, one per property file, so a failure there replays the same way: its replay line names the seed it ran from.

## What to do with a counter-example

A counter-example a property finds is a bug in the code under test unless the generator made it.

- A reducer counter-example is fixed in `src/domain/reducer.ts`, with a case in `tests/unit/reducer.test.ts`.
- A runner counter-example is fixed under `src/cli/commandLibrary/commander/`, with a case in the runner suite that owns the path.
- The contract and the conformance cases are never changed to make a property pass.

For a persisted format, fix the reader, never the format's shape or stamp. Paste the counter-example as a hand-written case in that reader's existing suite (`tests/unit/persisted.test.ts` for the readers in `src/schemas/persisted.ts`), in the same commit as the fix. If the fix would need a new shape, stop and say so in the plan or pull request: a shape change is a release decision, not a repair.

For the plan parser, the fix goes where the bug is, with the counter-example as a hand-written case in the same commit:

- a parser counter-example: fix `src/domain/plan/parsePlanMarkdown.ts`, with a case in `tests/unit/parsePlanMarkdown.test.ts`;
- a finalize counter-example: fix `src/domain/plan/finalize.ts`, with a case in `tests/unit/extractPlanFinalize.test.ts`;
- a counter-example that only the generator made (a document or text the format never carries) is a generator fix.

A renderer limit, where `renderPlanBody` emits a value the plan.md cannot carry back, becomes a renderable rule with its failing example. It is never a change to `renderPlanBody`: phax compares a sidecar's rendering with the plan body committed beside it, so a change to the output makes committed plans read as diverged. The limits the renderable rules record (run-title and commit folding and trimming, a blank phase title, a lone `(none)` required command) are known gaps, left for their own spec.

One renderer limit is not a rule, because the round trip checks the value in the form the renderer writes it:

- `phase-title-folds-onto-its-heading`: `headingText` folds a phase title's line breaks, with the whitespace around them, to one space and trims it, so `" Read\nthe plan "` reads back as `"Read the plan"`. The round trip holds each phase title read back to `headingText` of the document's title, and the generator keeps multi-line and padded titles.

A property written with a bare `fc.assert` escapes the budget and the replay. A guard in `tests/unit/property/harnessConfig.test.ts` refuses one, so go through `checkProperty`.

## Registering a format or a frozen shape

A new format id in `FORMAT_IDS` and its generator land in the same commit. The registry is typed over every `FormatId`, so `pnpm test:type` fails on a missing entry, and the `has a generator` test fails with `no generator registered for <id>`.

An entry in `FORMAT_REGISTRY` (`FormatEntry`) holds:

- `valid`: valid current-shape documents, derived from the format's schema through `fromSchema`, `$schema` first.
- `write`: the encoding phax's writer puts in the file.
- `parse`: the schemas package's reader.
- `phax`: phax's reader, as `{ read, readFile? }`, or `writeOnly` with a reason when phax only writes or prints the format and no code in `src/` reads it. A write-only format is checked through the package alone.
- `repairs`: each a `{ name, reason, repair }`. The name is kebab-case and states the reader rule it mirrors (for example `awaiting-review-records-a-waiting-stop`). The reason is one line naming the reader that enforces the rule. `repair` is a pure function from a derived value to a valid one. A value JSON cannot carry (`NaN`, `±Infinity`, `-0`) is not valid: exclude it with a repair (`numbers-are-json-numbers`), never by loosening equality.
- `derivation` (optional): a narrower schema to derive from, under the same naming rule, when `Arbitrary.schema` cannot derive the format's own.
- `frozen`: one entry per module of `src/schemas/history/<id>/`, oldest first. Each names its `shape` (`pre-schema` or the module's `X.Y.Z`), a generator of valid documents, and whether both readers read it or only the package does. A shape phax refuses by design says why in `packageOnly`.

A repair fixes only the values it was written for. A reader rule the registry does not mirror shows up as a round-trip counter-example.

The test `registers a frozen shape for every module of its history` fails by name until each history module has an entry. Frozen-shape stamps come from `packages/schemas/releases.json`, within the shape's range: from its release up to, not including, the next shape's release or the current stamp.

## Never name the opened version

CI rehearses the release cut and the next opening on every pull request. A property test therefore never names the opened version or a `next` shape literally. Take versions and stamps at run time from `PHAX_RELEASE` (`src/schemas/release.ts`), `CURRENT_STAMPS`, `PACKAGE_VERSION`, `CURRENT_SHAPES` and `packages/schemas/releases.json`. Only the behaviour-corpus cases may read across a cut.

## Agreement exceptions

`reaches the schemas package's verdict` holds phax's reader and the package to the same verdict. A deliberate disagreement is an entry of `AGREEMENT_EXCEPTIONS` in the test file: `{ format, name, reason, matches(document) }`, with a hand-written example showing that the two verdicts differ. Today the list holds `awaiting-review-records-a-waiting-stop` for `phase-status`.

Add an entry only when the disagreement is deliberate: phax refuses by design what the package reads. A reader bug is fixed in the reader instead. Keep `matches` as narrow as the rule it names, since an exception hides every disagreement it matches.

## The plan parser

### The document generator

`planDocuments` builds `PlanDocument` values by hand from fast-check pieces, in an `fc.record` typed over every key: a new required key fails `pnpm test:type`. The closed vocabularies (effort, mode, test-line size, technique, loop) are read at run time from their schemas' literals, and every generated document must decode through `decodePlanDocumentFile`.

It is not derived through `fromSchema`. The derived prose strings are arbitrary, so nearly every derived document would break the Markdown it renders to and need a rewriting repair on every prose field, which is a hand-written text generator anyway. The bridge also shrinks by seed and size only, so a counter-example would be a whole sampled document. The cost: a value the schema newly admits is generated only once someone extends a piece. The typecheck catches a new key and the decode check catches a value the schema stops admitting, but nothing catches a widened domain.

### Renderable rules

Some properties of a plan document the plan.md form cannot carry. Each is a `RENDERABLE_RULES` entry, `{ name, reason, holds }`, and the round trip is checked over documents that satisfy every rule. Today's rules:

| Rule                                          | Reason                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `short-name-is-the-title-slug`                | the parser takes the run short name from the H1 title, and finalize slugifies both sides                    |
| `run-title-is-one-trimmed-line`               | the renderer folds line breaks to a space and trims, and the H1 is one line                                 |
| `model-is-one-token`                          | the model is read as one run of non-space characters, trailing `*` stripped                                 |
| `anchor-fits-its-braces`                      | the anchor is written as `{#…}` and read up to the first `}`, trimmed                                       |
| `phase-title-holds-no-anchor`                 | the parser reads the first `{#…}` as the anchor, finalize the title before the last one                     |
| `phase-title-has-text`                        | the renderer trims a blank title to nothing, and finalize then finds no title                               |
| `root-prose-opens-no-block`                   | a root prose line that opens a heading, break, fence, code, HTML, quote or list block changes the structure |
| `commit-body-is-trimmed`                      | the commit body is read from the section's source slice and trimmed                                         |
| `commit-subject-is-one-line-of-single-spaces` | the commit subject folds every whitespace run to one space and trims                                        |
| `required-command-is-a-trimmed-line`          | each required command is read trimmed, an empty one is dropped, a lone `(none)` reads as no command         |

Add a rule only for a limit of the plan.md form or of the renderer, never to hide a parser bug, and always with a failing example: the test file keeps one hand-written document per rule that breaks that rule alone, and `every rule has an example and every example a rule` fails until both exist. Keep `holds` as narrow as the rule it names, since a rule hides every document it excludes.

### Text sources

The totality, bounded-time and agreement properties read texts from three sources. Each value is `{ origin, text }`, and a failure names the origin.

- `anyPlanText`: arbitrary Unicode strings (`arbitrary-unicode`), and strings drawn from an alphabet of Markdown and plan tokens (`plan-token-alphabet`).
- `mutatedPlanText`: a rendered plan with 1 to 3 line-level mutations from `PLAN_TEXT_MUTATIONS`: `heading-dropped`, `section-duplicated`, `list-item-emptied`, `path-made-non-canonical`, `line-inserted`, `line-removed`, `lines-swapped`, `fence-inserted`, `test-line-departs`. The origin lists the mutations applied.
- `largePlanText`: inputs up to 65,536 UTF-8 bytes, built from `LARGE_TEXT_FRAGMENTS`: `nested-lists`, `nested-quotes`, `nested-inline` (emphasis up to 400 levels deep, as a root phase heading or a prose line), `character-run` (long runs of one of `# * _ ` > [ ~ - =`), `repeated-plan` and `mutated-plans`. The origin lists the fragments used.

Markdown outside the alphabet (tables, HTML blocks, link reference definitions) is reached only by chance, through arbitrary strings. A grammar-based generator was rejected: the trees it makes almost never look like a plan, so the structure check would stop at the first missing section.

### The 2-second bound

`parsing finishes in bounded time` times each call alone with `performance.now()`; finalize and section location are timed apart from the extraction they read. A call over 2,000 ms is timed twice more, and the property fails only when the fastest of the three is still over 2,000 ms. One garbage-collection pause or scheduler stall on a loaded runner therefore cannot fail an unrelated pull request. The cost: an input that is slow only some of the time can pass. The property draws large, mutated and arbitrary text in equal shares: each large input is parsed four times, and at three large inputs in five the property outgrew the 30-second per-test timeout on a loaded CI runner.

The `nested-inline` fragment stops at 400 levels of emphasis. The Markdown parser resolves emphasis in time that grows with the square of the delimiters in one paragraph or heading, so deeper nesting near 64 KiB outgrows the bound inside the parser itself: one heading 4,000 levels deep (24 KB) already takes it about 1.6 s. The bound is therefore not held against deeper emphasis, a known gap left for its own spec.

### Structure exceptions

`the structure check agrees with extraction` holds `collectPlanStructureErrors` and `extractPlanDeterministic` to one verdict. A deliberate disagreement is an entry of `STRUCTURE_EXCEPTIONS` in the test file: `{ name, reason, matches(text) }`, with a hand-written example in which the two differ; `every exception has an example and every example an exception` fails until both exist. Today the list holds `departing-test-line`: extraction refuses a test line that departs from the grammar, while the structure check leaves test lines to the `tests` check of `phax plans lint`. Its `matches` holds only when the structure check is empty, `readPlanDeterministic` succeeds and at least one test line departs, so no other cause hides behind it.

Add an entry only when the disagreement is deliberate, as for `Agreement exceptions`: a parser bug is fixed in the parser instead. Keep `matches` as narrow as the rule it names.

## The run reducer

`tests/unit/property/reducer.property.test.ts` checks `interpret` (`src/domain/reducer.ts`), never the deprecated transition functions of `src/domain/state.ts`. Its five tests are under `describe("run reducer")`:

- `every state and event gets a disposition` (ac-sm-total): every reachable state with every event answers a `Disposition`; a handled one has a next state and a list of effects.
- `an archived run handles nothing` (ac-sm-archived): from an archived run no event is handled.
- `a completed or stopped run only archives` (ac-sm-finished): a handled event leads to the bare archived state.
- `a terminal phase does not go back` (ac-sm-phase-terminal): from `committed`, `cleaned_up`, `review_open` or `skipped`, a handled event leads to no phase, a terminal phase state, a post-commit state (`cleaning_up`, `handoff_failed`, `awaiting_review`) or the next phase's start (`pending`, `setting_up_worktree`). It never leads to `running`, `fixing`, `gates_failed`, `gates_exhausted`, `passed`, `rate_limited` or `failed`. This is the set decided in q-terminal-successors, and the spec's §5.14 states the same set. A wrong move between two allowed states is not caught here; the reducer's own suite checks it.
- `a refused event carries no change` (ac-sm-refused): an ignored or rejected disposition holds a `kind` and a `reason` and nothing else.

`a completed or stopped run only archives` and `a terminal phase does not go back` check nothing on a refusal, and among the 39 event types `anyEvent` draws the few each handles too rarely: under the fixed seed, the first would see no handled input at all. Their events come from `eventsBiasedTo(handledEventTypes(states))`: four draws in five are of a type the reducer handles from those states, read from `interpret` over a fixed-seed sample, and the fifth is any event, so the refusals are still searched. The tests under `describe("run reducer reach")` count the handled inputs of each over a fixed-seed sample at the default run count, and require at least one in five.

`tests/unit/property/reducerInputs.test.ts` checks the generators themselves.

### Reachability

`REACHABLE_SHAPES` lists every abstract shape (run state, phase sub-state and a stop's cause) the reducer reaches. It is the closure of the reducer from `REACHABILITY_SEEDS`: `created`, and `stopped`. `stopped` is a seed because no transition enters it, yet a run-status written by an older release holds it and `composePhaxState` composes it. A test recomputes the closure with `interpret` and requires it to equal the table, so a reducer change that alters reachability fails until the table is reviewed. The generators draw a shape from the table and fill its free fields (`hash`, `attempt`, `missing`, `cause`) at random.

Loss accepted: a state only an inconsistent persisted file composes (a `rate_limited` run whose phase status is `committed` after a torn write) is never generated. A reducer bug that strands a state outside the closure also hides that state.

### Adding an event type

`EVENT_GENERATORS` is typed `{ readonly [K in PhaxEventType]: fc.Arbitrary<Extract<PhaxEvent, { type: K }>> }`, so `pnpm typecheck` and `pnpm test:type` fail on a missing type. A runtime test checks the registry against the event types of `phaxDispositionMatrix` (`src/domain/matrix.ts`) and fails with `no generator registered for <type>`.

### Derived and hand-built values

`PhaxEvent` and `PhaxState` have no Effect schema, so they are built by hand. The review stop and its `lastClose` come from `ReviewStopFileSchema` through `fromSchema`. The branded ids, worktree paths and session ids have private schemas: they are generated as constrained strings, and a sanity property checks they pass their exported decoders. Error causes are built with their classes, and `RunReviewInfo` is built by hand. A value an event newly admits is generated only once someone extends its piece.

## CLI arguments

`tests/unit/property/cliArguments.property.test.ts` drives the command library's runner (`runner`, `src/cli/commandLibrary/commander/run.ts`) over `memoryIo`.

The property runs a dedicated program, `argvProgram()`, built with the contract's define API, not the conformance suite's programs that the spec's ac-cli-argv names. Those programs are private to the suite's `cases.ts`, built one per case, and frozen: the property can neither import them nor add to them, and no one of them offers every path. One program that offers every path `PROGRAM_SHAPES` names lets a single property search them all. The loss is stated under `### The property program`.

Four tests are under `describe("cli arguments")`:

- `any argv is run or refused through the contract` (ac-cli-argv): a call runs the command its words name and exits with a code the program declares, or is refused with the refused code, nothing on stdout and a message on stderr. It never ends with the defect code.
- `the argv source reaches every code the program declares, and the refusal`: a fixed-seed sample of the property's argv source, run through the runner, ends with every code of `declaredExitCodes` (0, each verdict code, the mapped error tag's code, the guard's code) and the refused code.
- `` `--json-schema` alone runs: it answers the program's contracts ``: a counter-example the deep pass found in the evidence, kept as a hand-written case.
- `no argv reaches the process`: `process.exit` is never called.

The exit codes are read from `program.exits` (and `declaredExitCodes`), never written as literals.

A code other than the refused one is checked against evidence that the command ran, so a runner that answered 0 to every call would fail. The command is the one whose full name starts the call's words, once the program's options and other dash-led words are set aside:

- on 0, stdout is that command's output (every command without verdicts answers its own name, as text or as the JSON string `--json` writes), or the help, the version, the usage spec, the command's JSON Schema or, for `--json-schema` alone, the program's contracts, each only when the call asked for it;
- on a verdict code, stdout is the verdict command's output (an operand of the call, or `VERDICT_DEFAULT`), and the code is the one its verdicts give that output;
- on a code the command's `exits` maps, or the guard's code for its words, stdout is empty and stderr is written.

### The property program

`argvProgram()` (`tests/helpers/property/argvProgram.ts`) is built with the contract's `defineProgram`, `defineGroup` and `defineCommand`. It is not taken from the conformance suite, whose programs are private to `cases.ts`, built one per case, and frozen. `PROGRAM_SHAPES` names every runner path it must offer (arguments and flags of each kind, strip and reject policies, stdin, env source, nested group, retired words, program options, usage, version alias, help, the guard exit, verdict codes, mapped error tags), and a test checks each by name.

Paths left out, with their reasons:

- a successful `--out` document write: it hashes with WebCrypto, asynchronously, and the property runs the runner synchronously (`Effect.runSyncExit`). The refusals of `--out` (a missing value) are searched;
- `handsOver` and `prompts`, and stdin that is a terminal: they have no in-memory answer;
- a command whose run dies, or fails with a tag it does not map, a `render` or `notes` that throws, and a tag or verdict mapped to the refused or defect code: each is a defect by design, and the runner refuses a program that maps one (`misdeclared`).

A path that only a frozen conformance case builds, and that `PROGRAM_SHAPES` leaves out, is not searched.

### The two argv sources

`anyArgv` draws arbitrary strings. `knownArgv` draws the program's own command words followed by arbitrary flags and values. Each value is `{ origin, argv, stdin }`, and a failure names the origin.

The values also draw `TRIGGER_WORDS` (exported by `argvProgram.ts`), the operands the program reads: `bad` is the verdict command's code 1 and the argument the `refuse` command's check refuses, `warn` its code 2. A command that takes an operand is now and then called with one of them alone, since among arbitrary tokens another word is almost always refused first.

### The vocabulary

The command words, options and aliases are read at run time from the program, through the contract's `fullName`, `flagShapes` and `argShapes`, which `usageSpec` writes from; the program's own options, usage, version alias and groups' retired words are read the same way. A test checks that every word the vocabulary yields appears in `usageSpec(program)`, so a new command is covered without editing the generator. The KDL text itself is not parsed.

## The daily deep pass

The `property-tests` job of `.github/workflows/security.yml` runs `pnpm test:unit tests/unit/property` with `PHAX_PROPERTY_RUNS=2000` and `PHAX_PROPERTY_SEED=random`: 2,000 inputs per property from a fresh seed per property file, each of which the log prints. It runs on the schedule and on demand (`workflow_dispatch`), never on a pull request. A failure there is replayed with the printed line, and fixed as above.

To run the same pass locally on some files, before handing off a new property file for example, use `pnpm test:property:deep <files>`. It sets `PHAX_PROPERTY_RUNS=2000` and `PHAX_PROPERTY_SEED=random`, so it needs no environment prefix, which a phase agent's session refuses. phax.json's `security.agentCommands` lists it, with `pnpm test:unit`, so a phase agent may run either.
