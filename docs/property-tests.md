# Property tests

A property test states a rule that must hold for every input of a kind, and checks it against many generated inputs instead of a few hand-picked ones. phax uses [fast-check](https://fast-check.dev) for the engine. This page is for a contributor whose pull request or daily Security run shows a failing property, or who is adding a persisted format or a frozen shape and must register its generator.

## What is covered

The spec plans four boundaries:

1. The persisted formats: every format in `FORMAT_IDS` (`src/schemas/schemaUrl.ts`).
2. The plan parser.
3. The state machine.
4. CLI arguments.

The first two are written. The state machine and CLI arguments follow in a later plan of the same spec.

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

- `a rendered plan parses back to its projection`: a generated plan document, rendered by `renderPlanBody`, parses back to the projection of that document.
- `any text yields a plan or structure errors`: for any text, `collectPlanStructureErrors` and `extractPlanDeterministic` answer and never throw, and a refused text comes with errors that say why.
- `parsing finishes in bounded time`: both parser calls answer within 2 seconds, on inputs up to 64 KiB.
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

Property tests import only from `src/domain`, `src/schemas`, `packages/schemas` and `tests/helpers/property/`. The plan-parser properties import from `src/domain/plan`, `src/domain/authoring` and `src/schemas`. fast-check is a devDependency.

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

Fix the reader, never the format's shape or stamp. Paste the counter-example as a hand-written case in that reader's existing suite (`tests/unit/persisted.test.ts` for the readers in `src/schemas/persisted.ts`), in the same commit as the fix. If the fix would need a new shape, stop and say so in the plan or pull request: a shape change is a release decision, not a repair.

For the plan parser, the fix goes where the bug is, with the counter-example as a hand-written case in the same commit:

- a parser counter-example: fix `src/domain/plan/parsePlanMarkdown.ts`, with a case in `tests/unit/parsePlanMarkdown.test.ts`;
- a finalize counter-example: fix `src/domain/plan/finalize.ts`, with a case in `tests/unit/extractPlanFinalize.test.ts`;
- a counter-example that only the generator made (a document or text the format never carries) is a generator fix.

A renderer limit, where `renderPlanBody` emits a value the plan.md cannot carry back, becomes a renderable rule with its failing example. It is never a change to `renderPlanBody`: phax compares a sidecar's rendering with the plan body committed beside it, so a change to the output makes committed plans read as diverged. The limits the renderable rules record (title and commit folding and trimming, a blank phase title, a lone `(none)` required command) are known gaps, left for their own spec.

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
- `largePlanText`: inputs up to 65,536 UTF-8 bytes, built from `LARGE_TEXT_FRAGMENTS`: `nested-lists`, `nested-quotes`, `character-run` (long runs of one of `# * _ ` > [ ~ - =`), `repeated-plan` and `mutated-plans`. The origin lists the fragments used.

Markdown outside the alphabet (tables, HTML blocks, link reference definitions) is reached only by chance, through arbitrary strings. A grammar-based generator was rejected: the trees it makes almost never look like a plan, so the structure check would stop at the first missing section.

### The 2-second bound

`parsing finishes in bounded time` times each parser call alone with `performance.now()`. A call over 2,000 ms is timed twice more, and the property fails only when the fastest of the three is still over 2,000 ms. One garbage-collection pause or scheduler stall on a loaded runner therefore cannot fail an unrelated pull request. The cost: an input that is slow only some of the time can pass.

### Structure exceptions

`the structure check agrees with extraction` holds `collectPlanStructureErrors` and `extractPlanDeterministic` to one verdict. A deliberate disagreement is an entry of `STRUCTURE_EXCEPTIONS` in the test file: `{ name, reason, matches(text) }`, with a hand-written example in which the two differ; `every exception has an example and every example an exception` fails until both exist. Today the list holds `departing-test-line`: extraction refuses a test line that departs from the grammar, while the structure check leaves test lines to the `tests` check of `phax plans lint`. Its `matches` holds only when the structure check is empty, `readPlanDeterministic` succeeds and at least one test line departs, so no other cause hides behind it.

Add an entry only when the disagreement is deliberate, as for `Agreement exceptions`: a parser bug is fixed in the parser instead. Keep `matches` as narrow as the rule it names.

## The daily deep pass

The `property-tests` job of `.github/workflows/security.yml` runs `pnpm test:unit tests/unit/property` with `PHAX_PROPERTY_RUNS=2000` and `PHAX_PROPERTY_SEED=random`: 2,000 inputs per property from a fresh seed per property file, each of which the log prints. It runs on the schedule and on demand (`workflow_dispatch`), never on a pull request. A failure there is replayed with the printed line, and fixed as above.
