---
status: Draft
source-spec: docs/specs/2611131320-property-tests.md
completes-spec: false
---
# Property tests over the plan parser

The second plan of the property-tests spec takes the plan-parser slice: §5.7 to §5.10 and their criteria ac-plan-roundtrip, ac-plan-total, ac-plan-bounded and ac-plan-lint-agrees. The reducer and CLI-argument slices (§5.11 to §5.16) are left to the third plan.

The plan builds on what plan 1 landed: the harness (`tests/helpers/property/harness.ts`: `checkProperty`, `propertyTimeout`, the three `PHAX_PROPERTY_*` variables, the anchored replay line), the guard in `tests/unit/property/harnessConfig.test.ts` that requires every `.test.ts` under `tests/unit/property/` to go through `checkProperty` and never through a bare `fc.assert(` or `fc.check(`, the daily deep pass in `.github/workflows/security.yml`, and the CI budget step in `.github/workflows/ci.yml`. New files under `tests/unit/property/` join the deep pass and the budget step with no workflow change.

The phases run in this order. First come the two generators, each with its own sanity properties: valid plan documents, then parser text (arbitrary, mutated rendered plans, and inputs up to 64 KiB). Then the round trip, then totality and bounded time, then the agreement between the structure check and extraction. The plan-parser section of `docs/property-tests.md` comes last. Every in-scope §8 criterion has its own named `it` in `tests/unit/property/planParser.property.test.ts`, under `describe("plan parser")`.

A counter-example is a parser or finalize bug unless the generator made it. Fix it in `src/domain/plan/parsePlanMarkdown.ts` or `src/domain/plan/finalize.ts`, and in the same commit add the counter-example as a hand-written case in that code's suite (`tests/unit/parsePlanMarkdown.test.ts` or `tests/unit/extractPlanFinalize.test.ts`). Then say so in the handoff. Never change a format's shape or stamp, and see the arbitration below on the renderer.

Three rules apply to every phase. They come from earlier runs on this repository:

- knip runs at every gate, so export only what the phase's own tests use.
- No test names the opened version or a `next` shape. Take stamps at run time, e.g. `currentSchemaUrl("plan-document")`.
- Run each new or changed property file once at 2,000 runs with a random seed before handing off.

## Required commands

- (none)

None. Each phase is verified by the `standard` gate profile's commands. Before handing off, a phase runs `PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test <file>`. That command goes through the gate's own `pnpm test` (`vitest run`), which runs a property file of the unit project just as `pnpm test:unit <file>` would. If the session refuses the env-prefixed form, record that in the handoff so the operator runs it before merging.

## Technical arbitrations

- **The plan-document generator is hand-built, not derived.** `tests/helpers/property/planDocuments.ts` builds `PlanDocument` values from fast-check pieces. It uses an `fc.record` typed over every key, so a new required key fails `pnpm test:type`. The closed vocabularies (effort, mode, test-line size, technique and loop) are read at run time from their schemas' literals, and every generated document must decode through `decodePlanDocumentFile`. Plan-document properties that the plan.md form cannot carry are named rules (`RENDERABLE_RULES`: name, reason, `holds`), and each rule has an example document that fails the round trip. **Loss accepted:** the generator does not track the schema's value domains on its own. A value the schema newly admits is generated only once someone extends a piece; the typecheck catches a new key and the decode check catches a value the schema stops admitting, but nothing catches a widened domain. **Rejected:** deriving from the format registry's plan-document entry through `fromSchema`. Its derived prose strings are arbitrary, so nearly every derived document breaks the Markdown it renders to and would need a rewriting repair on every prose field, which amounts to a hand-written text generator anyway. The bridge also shrinks only (seed, size), so a counter-example would be a whole sampled document, not the smallest failing one. The registry entry stays unchanged for the persisted-format properties, and q-generators is not reopened.
- **The text generator is hand-written and has three sources.** `tests/helpers/property/planText.ts` provides `anyPlanText` (arbitrary Unicode strings, and strings drawn from a Markdown-and-plan alphabet of tokens) and `mutatedPlanText`. That second source renders a generated plan, then applies 1 to 3 named line-level mutations: a heading dropped, a section duplicated, a list item emptied, a path made non-canonical, a line inserted, removed or swapped, a code fence inserted, or a test line made to depart. The third source is `largePlanText`, for inputs up to 65,536 UTF-8 bytes: deeply nested lists and block quotes, long runs of one of `# * _ ` > [ ~ - =`, and repeated rendered plans. Each value carries its origin (`{ origin, text }`), so a counter-example names how it was made. **Loss accepted:** Markdown constructs outside the alphabet and fragments (tables, HTML blocks, link reference definitions) are reached only by chance, through arbitrary strings. **Rejected:** a grammar-based generator (an mdast tree serialized to Markdown). It needs a serializer phax does not depend on directly, and the trees it makes almost never look like a plan, so the structure check would stop at the first missing section and leave the per-phase checks unexercised.
- **"Within 2 seconds" is checked as the best of three timings.** Each parser call (`collectPlanStructureErrors`, `extractPlanDeterministic`) is timed alone with `performance.now()`. A call over 2,000 ms is timed twice more, and the property fails only when the fastest of the three is still over 2,000 ms. The bound is the spec's own 2 s, not scaled. **Loss accepted:** an input that is slow only some of the time can pass. **Rejected:** a single timing, because one GC pause or scheduler stall on a loaded runner would fail an unrelated pull request, which breaks q-budget's promise that a pull request's result depends only on its code. Also rejected: an operation counter or a growth ratio. A counter needs a hook in `src/domain`, outside the spec's rule that properties call pure functions with nothing in `src/` serving the tests, and a ratio of two timings is itself noisy.
- **§5.10 is asserted against `extractPlanDeterministic`, the function `phax run` calls, with one named exception.** For every totality input, `collectPlanStructureErrors(text)` must be empty exactly when `extractPlanDeterministic(text)` succeeds. The one exception that holds by design is `departing-test-line`. Extraction refuses a test line that departs from the grammar, while the structure check leaves test lines to the `tests` check of `phax plans lint`. The exception matches only a text on which the structure check is empty and `readPlanDeterministic` succeeds with at least one departure, so no other cause hides behind it. Exceptions live in the test file as `{ name, reason, matches }`, each with a hand-written example, like plan 1's `AGREEMENT_EXCEPTIONS`. **Loss accepted:** on a text holding a departing test line, the structure check is compared with `readPlanDeterministic` instead of with extraction. **Rejected:** comparing with `readPlanDeterministic` only, because the refusal `phax run` acts on would then stay outside the property.
- **The renderer is not changed in this plan.** phax compares a sidecar's rendering with the plan body committed beside it (`renderCurrent`, in `src/domain/artifact/sidecar.ts`). A change to `renderPlanBody`'s output therefore makes committed plans read as diverged, and the spec's §10 sends fixes to readers, parsers and the reducer only. A round-trip counter-example caused by the renderer emitting a value the plan.md cannot carry back becomes a named `RENDERABLE_RULES` entry with its example. It is then listed in the handoff and on the docs page, for its own spec. Parser and finalize bugs are fixed. **Loss accepted:** known renderer limits stay until their own spec.
- **No acceptance pair.** The code under test already exists. An acceptance test marked `it.fails` would be red at authoring unless the property already failed, and stubbing the generators would move the test's oracle into the passing phase, which the planning skill forbids. So every test line is `in-phase`. **Loss accepted:** a property is not frozen before a parser fix lands in the same phase. The hand-written case that pins each fix, and the reviewer's reading of the property, guard it instead.

---

## phase-01 — Plan-document generator and its sanity properties {#phase-01-plan-document-generator}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Above the default effort: the phase designs the boundary between what a valid plan document is and what plan.md can carry back, which no generator in the repository shows yet, and its rules decide what the round trip can find.

Adds a fast-check generator of valid plan documents. Each one decodes as a sidecar and stays clear of every named limit of the plan.md form, so the round trip in phase-03 checks the parser against documents that a correct parser must read back.

### Detailed instructions

- Create `tests/helpers/property/planDocuments.ts`. It exports `planDocuments(): fc.Arbitrary<PlanDocument>` and `RENDERABLE_RULES`. `PlanDocument` is the in-memory type from `src/schemas/planDocument.ts`: no `$schema`, no `version`. Build it by hand from fast-check pieces (`fc.record`, `fc.array`, `fc.constantFrom`, `fc.string` with token units), typed so that a missing required key fails `pnpm test:type`. Do not use `fromSchema` or the format registry's plan-document entry, as the Technical arbitrations explain. Import fast-check as the existing helpers do.
- Shape of a document: 1 to 4 phases. Ids run `phase-01`, `phase-02`, … in order with no gap. Each anchor is `#<id>-<slug>`, where the slug uses lowercase letters and hyphens. The lineage is either a `docs/specs/<stamp>-<slug>.md`-like path with a boolean `completesSpec`, or `null` with `null`. Read the closed vocabularies at run time from the schemas: effort from `PlanEffortSchema.literals` (`src/schemas/phaxPlan.ts`), mode from `PhaseModeSchema.literals`, and test-line size, technique and loop from `TEST_SIZES`, `TEST_TECHNIQUES` and `TestLoopSchema.literals` (`src/schemas/testLine.ts`). Draw a model from a few catalog-style ids, or as a single generated token.
- Make every variant occur:
  - headless and interactive phases;
  - `acceptance` as null, and as `{ passedBy, files }` with `passedBy` naming a phase id of the same plan;
  - `boundaryContracts` and `assignmentReason`, each null and set;
  - empty lists (rendered `- (none)`) and non-empty ones for all three planned-file lists, `detailedInstructions`, `implementationOrder`, `excludedScope`, `technicalArbitrations` and `run.requiredCommands`;
  - test lines with a `criterion` and with `criterion: null`;
  - open questions and arbitrated questions.
  The questions must pass the checks `decodePlanDocumentFile` runs (`firstQuestionViolation` in `src/schemas/questions.ts`): question ids unique across both lists, option ids unique and never `other` (`OTHER_OPTION_ID`), a recommendation naming an option, a verdict whose `chosen` is an option or `other` and whose `abandoned` holds every other option once, and a decided verdict's `phase` naming a phase of the plan. Write these small builders in this file and do not import `formatRegistry.ts`'s repairs: they repair derived values, while this file constructs valid ones.
- Planned-file lists hold canonical plan paths (`PlanPath`): `/`-separated segments of letters, digits, `.`, `_` and `-`, with no empty, `.` or `..` segment. Generate them canonical. The decode sanity property below confirms the schema agrees.
- Test lines follow the grammar `TestLineSchema` enforces: a guarantee may hold ` — ` and ` · `, and an oracle may hold ` · ` but never ` — `, never starts with `— ` and never ends with ` ·`. Generate fields that are trimmed and single-line. If unsure, read `src/schemas/testLine.ts` and `src/domain/plan/testLineGrammar.ts`, and let the decode property confirm.
- Prose fields draw on an adversarial inline vocabulary:
  - backticks and code spans, `*`, `_`, `[`, `]`, `<`, `>`, `&`, `\`, `#`;
  - `{#x}`, and the separators ` — ` and ` · `;
  - `phase-03` and `## phase-03` mid-line, and `Recommended model:` mid-line;
  - `(none)`, non-ASCII and astral characters.
  The fields are the summary, the required-commands note, arbitrations, objective, instructions, order, excluded scope, boundary contracts, verification, handoff, commit body and the question texts. Multi-line text (single newlines and blank lines) goes where the rendering keeps it in place: list-item prose (`listItem` indents continuation lines) and root prose blocks, subject to the rule below.
- `RENDERABLE_RULES` is a `ReadonlyArray<{ name; reason; holds(doc: PlanDocument): boolean }>`. Each name is kebab-case and states the rule. Each reason is one line naming the parser, finalize or renderer behaviour that the plan.md form cannot get past. The generator builds values that satisfy every rule by construction, never through an `fc.filter` that discards most samples. Start from these candidates, and keep only those the code confirms (phase-03 adds a failing example for each):
  - `short-name-is-the-title-slug`: the parser takes the run short name from the H1, and finalize slugifies both sides with `slugifyShortName`.
  - `run-title-is-one-trimmed-line`: `headingText` collapses line breaks and trims.
  - `model-is-one-token`: `readRecommendedFields` reads `\S+` and strips trailing `*`.
  - `anchor-fits-its-braces`: no `}`, no whitespace, no line break.
  - `phase-title-holds-no-anchor`: the parser reads the first `{#…}` of the heading, and finalize's `parsePhaseTitles` reads the title before the anchor.
  - `root-prose-opens-no-block`: in the prose `renderPlanBody` emits as root blocks, as given (summary, required-commands note, objective, boundary contracts, verification, expected handoff, commit body), no line opens a root block: an ATX heading, a setext underline, a thematic break, a fence, indented code or an HTML block.
  Add a rule only for a limit of the plan.md form or of the renderer, never to step around a parser or finalize mistake: phase-03 fixes those.
- Create `tests/unit/property/planDocuments.test.ts`. Its sanity properties go through `checkProperty`, each `it` taking `propertyTimeout()` as its timeout:
  (a) every generated document, with `$schema: currentSchemaUrl("plan-document")` (`src/schemas/persisted.ts`) placed first, decodes through `decodePlanDocumentFile`, and a failure throws the decoder's message;
  (b) every generated document satisfies every `RENDERABLE_RULES` rule, and a failure names the rule;
  (c) phase ids run `phase-01` to `phase-NN` with no gap, and each anchor starts with `#<id>-`.
  Add one example test that draws `fc.sample(planDocuments(), { seed: <a literal>, numRuns: 200 })` and checks, from a named table, that every variant and every adversarial token listed above occurs at least once. A missing one is reported by its name. `fc.sample` is not `fc.assert` or `fc.check`, so the harness guard allows it.
- Never name a release literally: take the stamp from `currentSchemaUrl`.
- Before handing off, run `PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test tests/unit/property/planDocuments.test.ts` once and record the seed and the result.

### Planned files to create

- `tests/helpers/property/planDocuments.ts`
- `tests/unit/property/planDocuments.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumers: phase-02's `mutatedPlanText` and phase-03's round-trip property, which need valid `PlanDocument` values, and phase-03's rule examples, which need the rule list. Producer: `tests/helpers/property/planDocuments.ts`, exporting `planDocuments(): fc.Arbitrary<PlanDocument>` and `RENDERABLE_RULES: ReadonlyArray<{ name: string; reason: string; holds: (doc: PlanDocument) => boolean }>`. Strict on the meaning: every generated value decodes as a sidecar and satisfies every rule. Flexible on the exact helper names inside the file.

### Test strategy

- every generated plan document, stamped with the current plan-document stamp, decodes through the sidecar decoder — small · property · decodePlanDocumentFile's success · in-phase
- every generated plan document satisfies every renderable rule — small · property · each rule's holds predicate · in-phase
- phase ids run from phase-01 with no gap and each anchor starts with its phase id — small · property · the expected id sequence and anchor prefix · in-phase
- every promised variant and adversarial token occurs in a fixed-seed sample — small · example · a named table of variants and tokens · in-phase

### Implementation order

1. Leaf pieces: paths, prose, test lines, questions.
2. Phase record, then document record, typed against `PlanDocument`.
3. `RENDERABLE_RULES` and the construction that satisfies them.
4. Sanity properties and the coverage example test.
5. The 2,000-run pass with a random seed.

### Excluded scope

- The round-trip property and the shared round-trip helper (phase-03).
- Any change to `tests/helpers/property/formatRegistry.ts` or to the persisted-format properties.
- Any change under `src/`.
- The reducer and CLI-argument slices (the spec's third plan).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names and signatures of `tests/helpers/property/planDocuments.ts`.
- Every `RENDERABLE_RULES` rule kept, with its reason, and every candidate dropped because the code did not confirm it.
- The variant and token table the example test checks.
- The 2,000-run seed and result.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(property): generate valid plan documents for the plan-parser properties`

### Commit body

Add a hand-built fast-check generator of plan documents for the plan-parser slice of the property-tests spec. Every document decodes as a plan sidecar and stays clear of the named limits of the plan.md form (RENDERABLE_RULES), so the round trip can check the parser against documents it must read back.

The closed vocabularies are read from the schemas' literals. Sanity properties hold every document to the sidecar decoder and to the rules, and a fixed-seed sample shows every variant and adversarial token occurs.

---

## phase-02 — Plan-parser text generator and its sanity properties {#phase-02-plan-text-generator}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Adds the text inputs the totality, bounded-time and agreement properties read: arbitrary strings, rendered plans mutated at the Markdown level, and adversarial inputs up to 64 KiB, each labelled with how it was made.

### Detailed instructions

- Create `tests/helpers/property/planText.ts`. Export `type PlanText = { readonly origin: string; readonly text: string }` and three arbitraries: `anyPlanText()`, `mutatedPlanText()` and `largePlanText()`. Also export the list of mutation names, `PLAN_TEXT_MUTATIONS`, and the large-input fragment kinds, `LARGE_TEXT_FRAGMENTS`. The `origin` names the source and, for a mutated or large text, the mutations or fragments applied in order, so a counter-example printed by the harness says how its text was made.
- `anyPlanText()` is an `fc.oneof` of two parts, each up to about 2,000 characters. The first is arbitrary Unicode strings with no lone surrogate (a file read as UTF-8 never holds one). The second is strings whose units come from a Markdown-and-plan token alphabet: `#`, `## `, `### `, `## phase-01 — T {#phase-01-t}`, `{#a}`, `phase-02`, ` — `, ` · `, `- `, `1. `, two and four spaces, `\n`, `\r\n`, `\t`, a backtick, a triple backtick, `~~~`, `*`, `**Recommended model:** `, `**Recommended effort:** `, `_`, `>`, `[`, `]`, `(none)`, `---`, `===`, `|` and `<div>`. Check the installed fast-check (`node_modules/fast-check`, ^4.10.2) for how `fc.string` takes an arbitrary `unit`, rather than relying on memory.
- `mutatedPlanText()` renders a `planDocuments()` value from `tests/helpers/property/planDocuments.ts` with `renderPlanBody` (`src/domain/authoring/renderPlan.ts`), splits it into lines, and applies 1 to 3 mutations. Each mutation's position is drawn as `fc.nat()` modulo the eligible lines, so that shrinking moves toward fewer and earlier mutations. The mutations, by name:
  - `heading-dropped`: an H1, H2 or H3 line is removed.
  - `section-duplicated`: an `### ` section, up to the next heading, is repeated.
  - `list-item-emptied`: a list item's text is removed, leaving `- `.
  - `path-made-non-canonical`: a planned path's code span gains `./`, a `..` segment, a backslash, a leading or trailing `/`, or an empty segment.
  - `line-inserted`: drawn from a pool holding a heading of each level, `---`, a fence, `- `, a `**Recommended model:**` line and a test-strategy line.
  - `line-removed`.
  - `lines-swapped`.
  - `fence-inserted`: an unclosed triple backtick, or a `~~~` pair around a section.
  - `test-line-departs`: in a `### Test strategy` item, one ` — ` or ` · ` separator becomes `--`, `-` or a doubled space.
- `largePlanText()` builds a text of at most 65,536 UTF-8 bytes from fragments, named in `LARGE_TEXT_FRAGMENTS`:
  - lists nested ever deeper;
  - block quotes nested ever deeper (`> > > …`);
  - a long run of one character from `#`, `*`, `_`, a backtick, `>`, `[`, `~`, `-` and `=`;
  - a rendered plan repeated;
  - mutated plans concatenated.
  Cut the result to the byte cap at a code-point boundary (never split a surrogate pair), and measure bytes with `Buffer.byteLength(text, "utf8")`. Weight the target size so that most inputs stay mid-sized and about one in four lands near the cap. The bounded-time property in phase-04 parses every one of them, at 100 runs on every pull request.
- Create `tests/unit/property/planText.test.ts`. Its sanity properties go through `checkProperty` with `propertyTimeout()`. First, every text of the three arbitraries is at most 65,536 UTF-8 bytes and holds no lone surrogate. Second, every mutated text's `origin` names one to three mutations from `PLAN_TEXT_MUTATIONS`.
- Add example tests over `fc.sample` with a literal seed. Each table reports a missing entry by name.
  - Every name in `PLAN_TEXT_MUTATIONS` occurs in a sample of `mutatedPlanText()`.
  - Every name in `LARGE_TEXT_FRAGMENTS` occurs in a sample of `largePlanText()`, and at least one sampled text is over 60 KiB.
  - In a sample of `mutatedPlanText()`, at least one text is read by `extractPlanDeterministic`, at least one is refused, and at least one is read by `readPlanDeterministic` with a departure (`departures.length > 0`). Phase-05's agreement property needs all three outcomes in its inputs.
- Export only what `planText.test.ts` uses (knip runs at the gate). Phases 04 and 05 import these same exports.
- Before handing off, run `PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test tests/unit/property/planText.test.ts` once and record the seed and the result. The parser is called here only to show that the inputs reach every outcome. A parser throw seen here is a totality counter-example: keep its text for phase-04's handoff list, and do not fix the parser in this phase.

### Planned files to create

- `tests/helpers/property/planText.ts`
- `tests/unit/property/planText.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/property/planDocuments.ts`

### Boundary contracts

Consumers: phase-04's totality and bounded-time properties, and phase-05's agreement property, which need labelled texts. Producer: `tests/helpers/property/planText.ts`, exporting `PlanText` (`{ origin, text }`), `anyPlanText()`, `mutatedPlanText()`, `largePlanText()`, `PLAN_TEXT_MUTATIONS` and `LARGE_TEXT_FRAGMENTS`. Strict on the meaning: every text is at most 65,536 UTF-8 bytes, and every mutated text names its mutations. This phase reads `planDocuments()` from phase-01's `tests/helpers/property/planDocuments.ts`.

### Test strategy

- every generated text is at most 65,536 UTF-8 bytes and holds no lone surrogate — small · property · Buffer.byteLength and a well-formed UTF-16 check · in-phase
- every mutated text names one to three known mutations in its origin — small · property · the PLAN_TEXT_MUTATIONS list · in-phase
- every mutation and large-input fragment occurs, and a sampled large text exceeds 60 KiB — small · example · named tables of mutations and fragments over a fixed-seed sample · in-phase
- mutated plans reach an extracted plan, a refusal, and a departing test line — small · example · extractPlanDeterministic and readPlanDeterministic over a fixed-seed sample · in-phase

### Implementation order

1. `PlanText` and `anyPlanText`.
2. The line-level mutations and `mutatedPlanText`.
3. The fragments and `largePlanText`, with the byte cap.
4. Sanity properties and example tests.
5. The 2,000-run pass with a random seed.

### Excluded scope

- Any property over the parser itself (phases 03 to 05).
- Any change under `src/`.
- A grammar-based Markdown generator or a new dependency.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exports of `tests/helpers/property/planText.ts`, with the final mutation and fragment names.
- The size weighting of `largePlanText` and how often a sample lands near the cap.
- The local time of `planText.test.ts` at 100 runs.
- The 2,000-run seed and result.
- Any parser throw observed, with its text, for phase-04.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(property): generate plan-parser text: arbitrary, mutated plans, 64 KiB inputs`

### Commit body

Add the text inputs of the plan-parser properties. They are arbitrary strings and strings over a Markdown-and-plan alphabet; rendered plans with named line-level mutations (heading dropped, section duplicated, item emptied, path made non-canonical, fence inserted, test line made to depart, and more); and adversarial inputs up to 64 KiB. Each text carries its origin, so a counter-example says how it was made.

Sanity properties hold every text to the byte cap, and fixed-seed samples show every mutation and fragment occurs. Mutated plans reach extraction, refusal and a departing test line.

---

## phase-03 — Round trip: a rendered plan parses back to its projection {#phase-03-plan-round-trip}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Stronger than the default: each counter-example needs a judgment across the parser, finalize, the renderer and the generator about where the fault lies, and a wrong call either hides a parser bug behind a rule or changes the reading of plans already written.

Adds the property that any valid plan document, rendered to Markdown, is read back by deterministic extraction to the plan its document projects to, with no warning. It also fixes any parser or finalize bug the property finds.

### Detailed instructions

- Create `tests/helpers/planRoundTrip.ts` and move the `roundTrip(doc, md)` helper of `tests/unit/renderPlan.test.ts` there without changing its behaviour. It runs `extractPlanDeterministic`, then `finalizeExtractedPlan` on both the extraction and `projectExtractedPlan(doc)` against the same Markdown, returns `{ parsed, fromMarkdown, fromDocument }`, and throws a descriptive `Error` on a refusal. Make `renderPlan.test.ts` import it, and change nothing else in that file.
- Create `tests/unit/property/planParser.property.test.ts` with `describe("plan parser")` and the test `it("a rendered plan parses back to its projection", …, propertyTimeout())`. The test title is final: later phases add tests beside it and never retitle it. The property runs through `checkProperty(planDocuments(), (doc) => …)`. It renders with `renderPlanBody(doc)`, calls `roundTrip`, and then requires all of the following, throwing an `Error` that names the first difference (a path and both values) when one fails:
  - `parsed.phases` equals `projectExtractedPlan(doc).phases`;
  - `parsed.run.title` and `parsed.run.requiredCommands` equal the projection's;
  - `fromMarkdown.plan` equals `fromDocument.plan`;
  - `fromMarkdown.warnings` is `[]`.
  Compare with `isDeepStrictEqual` (`node:util`), reading own keys only.
- In the same file, add `describe("renderable rules")`. A `RULE_EXAMPLES` map holds one hand-written document per rule of `RENDERABLE_RULES` (`tests/helpers/property/planDocuments.ts`). Add a test that every rule has an example and every example a rule. Then `it.each(RENDERABLE_RULES)("$name: $reason", …)` checks three things for each example: it decodes through `decodePlanDocumentFile` once stamped with `currentSchemaUrl("plan-document")`; it breaks that rule's `holds` and no other rule's; and its round trip fails, either through a refusal or through one of the differences above. A rule whose example still round-trips is unnecessary: drop it and widen the generator.
- Route each counter-example as the Technical arbitrations say:
  - A parser bug: fix it in `src/domain/plan/parsePlanMarkdown.ts`, with the counter-example as a hand-written case in `tests/unit/parsePlanMarkdown.test.ts`.
  - A finalize bug: fix it in `src/domain/plan/finalize.ts`, with a case in `tests/unit/extractPlanFinalize.test.ts`. For instance, if a `## phase-NN` written mid-line in prose raises the anchor-count warning, `detectPhaseAnchors` is counting text that is not a phase heading.
  - A limit of the plan.md form or of `renderPlanBody`: a new `RENDERABLE_RULES` entry with its example, generated around, and listed in the handoff.
  Never edit `renderPlanBody`, the frozen `renderPlanBodyV0_*` renderers, or any schema in `src/schemas/`. A fix must not change how a text that already parsed is read, unless that reading was the bug. Say which in the handoff.
- Keep the property within the unit tier: at 100 runs, the file must finish well inside the 30-second per-test timeout. If it is slow, cap the generator's sizes rather than the run count.
- Before handing off, run `PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test tests/unit/property/planParser.property.test.ts` once. Run it again after every fix, until it passes. Record each seed.

### Planned files to create

- `tests/helpers/planRoundTrip.ts`
- `tests/unit/property/planParser.property.test.ts`

### Planned files to edit

- `tests/unit/renderPlan.test.ts`

### Optional files that may be edited

- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/plan/finalize.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/testLineGrammar.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/extractPlanFinalize.test.ts`
- `tests/unit/testLineGrammar.test.ts`
- `tests/helpers/property/planDocuments.ts`
- `tests/unit/property/planDocuments.test.ts`

### Boundary contracts

Consumer: the round-trip property, which needs the render, extract, finalize and compare sequence the existing suite already trusts. Producer: `tests/helpers/planRoundTrip.ts`, exporting `roundTrip(doc: PlanDocument, md: string)` with the behaviour it had in `tests/unit/renderPlan.test.ts`. The property crosses into `src/domain` only through the pure functions `renderPlanBody`, `extractPlanDeterministic` and `finalizeExtractedPlan`, and into `src/schemas` through `projectExtractedPlan`, `decodePlanDocumentFile` and `currentSchemaUrl`. Phases 04 and 05 add tests to `tests/unit/property/planParser.property.test.ts` under the same `describe("plan parser")`.

### Test strategy

- any valid plan document, rendered to Markdown, is extracted and finalized back to its finalized projection with no warning — small · property · projectExtractedPlan finalized against the same Markdown · in-phase · ac-plan-roundtrip
- every renderable rule is needed: its example decodes, breaks only that rule, and does not round trip — small · example · the round-trip helper's refusal or the first difference · in-phase
- the existing renderPlan round-trip cases pass unchanged through the shared helper — small · example · the existing renderPlan.test.ts expectations · in-phase
- each counter-example the property found stays as a hand-written case beside its fix — small · example · the fixed function's expected plan or warning list · in-phase

### Implementation order

1. Move `roundTrip` into `tests/helpers/planRoundTrip.ts` and repoint `renderPlan.test.ts`.
2. Write the round-trip property.
3. Write the rule examples and the coverage test.
4. Run at 2,000 runs with random seeds, then fix or name each counter-example, with its hand-written case.
5. Run the gate.

### Excluded scope

- Totality, bounded time and the structure-check agreement (phases 04 and 05).
- Any change to `renderPlanBody`, the frozen renderers, or a persisted format's shape or stamp.
- The reducer and CLI-argument slices (the spec's third plan).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact test title and the `tests/helpers/planRoundTrip.ts` export.
- Every counter-example found: its seed and path, its cause (parser, finalize, or a limit of the form or renderer), the fix or the new rule, and the hand-written case added with its file.
- Every renderer limit recorded as a rule, for a follow-up spec.
- The 2,000-run seeds and results.
- The local time of the file at 100 runs.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(property): a rendered plan parses back to its projection`

### Commit body

Generalize renderPlan.test.ts's round-trip helper into tests/helpers/planRoundTrip.ts. Add the property: any valid plan document, rendered to Markdown, is extracted and finalized back to its finalized projection with no warning (spec property-tests §5.7, ac-plan-roundtrip).

Each renderable rule now carries a hand-written example that decodes yet does not round trip, so no rule narrows the generator without cause. Counter-examples are fixed in the parser or finalize, each with a hand-written case in that code's suite; the handoff lists them.

---

## phase-04 — Totality and bounded time of the plan parser {#phase-04-totality-and-bounded-time}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Above the default effort: likely counter-examples (stack depth, superlinear walks over 64 KiB) need parser fixes that must leave every existing reading unchanged, plus a timing check that must not turn flaky.

Adds the properties that the plan parser answers any text with a plan or a refusal and never throws, and that it reads any text up to 64 KiB within 2 seconds. It also fixes any parser bug these properties find.

### Detailed instructions

- In `tests/unit/property/planParser.property.test.ts`, under `describe("plan parser")`, add `it("any text yields a plan or structure errors", …, propertyTimeout())`. Its input is a file-level `const totalityInputs = () => fc.oneof(anyPlanText(), mutatedPlanText())` from `tests/helpers/property/planText.ts`, which phase-05 reuses. The predicate calls `collectPlanStructureErrors`, `readPlanDeterministic` and `extractPlanDeterministic` on `text`, each in its own `try`. A throw fails, naming the function and the error. Then it requires the following:
  - `collectPlanStructureErrors` returns an array of `{ phase: string | null; message: string }` with non-empty messages;
  - each `Result` is a success, or a failure with a non-empty message;
  - a `readPlanDeterministic` success holds at least one phase;
  - no failure message starts with `deterministic extraction produced invalid ExtractedPhaxPlan`, because the parser's own comment calls that path a parser bug.
- Add `it("parsing finishes in bounded time", …, propertyTimeout())` over `fc.oneof({ arbitrary: largePlanText(), weight: 3 }, { arbitrary: mutatedPlanText(), weight: 1 }, { arbitrary: anyPlanText(), weight: 1 })`. Time `collectPlanStructureErrors(text)` and `extractPlanDeterministic(text)` separately with `performance.now()`. A call over 2,000 ms is timed twice more, and the property fails only when the fastest of the three is over 2,000 ms. The failure reports the function, the byte length, the origin and the three timings. Keep the timing helper local to the test file, not exported. A throw here is reported as a totality failure, with the same message shape.
- Expect deep nesting or long runs to expose stack overflows or superlinear walks. Fix each in `src/domain/plan/parsePlanMarkdown.ts`, for example with a structure error instead of a crash, and add the counter-example, or a minimal hand-written text reproducing it, to `tests/unit/parsePlanMarkdown.test.ts` in the same commit. A fix must leave unchanged the reading of every text the parser already read without throwing. If a fix would need a change in `mdast-util-from-markdown` itself, stop at a structure error in phax's own code and say so in the handoff.
- Budget (ac-budget): the CI step times `pnpm test:unit tests/unit/property` against 60 s. Measure locally, at the default 100 runs, the time of `pnpm test tests/unit/property` and of `planParser.property.test.ts` alone, before and after this phase. If the plan-parser files (`planDocuments`, `planText`, `planParser`) take more than about 15 s together, lower `largePlanText`'s share of near-cap inputs. Never lower the run count or the 64 KiB cap.
- Before handing off, run `PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test tests/unit/property/planParser.property.test.ts` once, again after each fix, until it passes. Record each seed and the file's time at 2,000 runs against its `propertyTimeout()`.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/property/planParser.property.test.ts`

### Optional files that may be edited

- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/testLineGrammar.ts`
- `src/domain/plan/planPath.ts`
- `src/domain/artifact/frontmatter.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/testLineGrammar.test.ts`
- `tests/unit/planPath.test.ts`
- `tests/helpers/property/planText.ts`

### Test strategy

- the plan parser never throws on arbitrary or mutated text, and answers a plan or a refusal with a message — small · property · Result values with non-empty error messages and no parser-bug message · in-phase · ac-plan-total
- no structure check or extraction of a text up to 64 KiB takes more than 2 seconds — small · property · a 2,000 ms bound on the fastest of three timings · in-phase · ac-plan-bounded
- each parser counter-example stays as a hand-written case beside its fix — small · example · the fixed parser's plan or structure error · in-phase
- the property files at 100 runs keep within the 60 s CI budget — medium · smoke · the elapsed time of the property directory's run · in-phase · ac-budget

### Implementation order

1. The totality property and `totalityInputs`.
2. The timing helper and the bounded-time property.
3. Runs at 2,000 with random seeds, then parser fixes with their hand-written cases.
4. Budget measurement, and any weighting adjustment in `largePlanText`.
5. Run the gate.

### Excluded scope

- The structure-check agreement (phase-05).
- Any change to `renderPlanBody` or to a persisted format.
- Changes to `.github/workflows/ci.yml` or `security.yml`: the new file joins the budget step and the deep pass as it stands.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The two test titles and the `totalityInputs` constant phase-05 reuses.
- Every counter-example found, with its seed, cause, fix and hand-written case.
- The local timings: the directory, and each plan-parser file at 100 runs, before and after.
- The 2,000-run seeds, results and file time.
- Any weighting change made to `largePlanText`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(property): the plan parser is total and finishes in bounded time`

### Commit body

Add two plan-parser properties (spec property-tests §5.8 and §5.9, ac-plan-total and ac-plan-bounded). The parser answers any text, arbitrary or a mutated rendered plan, with a plan or a refusal carrying a message, and never throws. It reads any text up to 64 KiB within 2 seconds, judged as the fastest of three timings so a GC pause on a loaded runner does not fail a pull request.

Parser counter-examples are fixed in parsePlanMarkdown.ts, each with a hand-written case in its suite.

---

## phase-05 — The structure check agrees with extraction {#phase-05-structure-check-agreement}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Adds the property that `phax plans lint`'s structure check reports no error exactly when deterministic extraction reads a plan, with the one disagreement that holds by design named and shown by an example.

### Detailed instructions

- In `tests/unit/property/planParser.property.test.ts`, define the exceptions:
  - `interface StructureException { readonly name: string; readonly reason: string; readonly matches: (text: string) => boolean }`;
  - `STRUCTURE_EXCEPTIONS`, holding one entry, `departing-test-line`, with this reason: "extractPlanDeterministic refuses a test line that departs from the grammar, while collectPlanStructureErrors leaves test lines to the tests check of `phax plans lint`". Its `matches(text)` is true only when `collectPlanStructureErrors(text)` is empty, `readPlanDeterministic(text)` succeeds, and the reading's `departures` list is non-empty;
  - `STRUCTURE_EXAMPLES`, holding a hand-written plan.md text per exception name: a minimal valid plan whose one test line uses `--` in place of ` — `.
- Under `describe("plan parser")`, add `it("the structure check agrees with extraction", …, propertyTimeout())` over `totalityInputs()`, the constant phase-04 defined. The predicate takes `clean = collectPlanStructureErrors(text).length === 0` and `read = Result.isSuccess(extractPlanDeterministic(text))`. If they are equal, it passes. If not, it passes only when an exception's `matches(text)` holds. Otherwise it throws, naming both verdicts, the first structure error and the extraction's message.
- Add `describe("structure exceptions")` with two tests. First, every exception has an example and every example an exception. Second, `it.each(STRUCTURE_EXCEPTIONS)("$name: $reason", …)`: the example matches, the structure check is empty for it, and extraction refuses it.
- Any other disagreement is a parser bug. Fix it in `src/domain/plan/parsePlanMarkdown.ts`, with a hand-written case in `tests/unit/parsePlanMarkdown.test.ts`, in the same commit. Never add an exception to step around a bug. Keep each exception's `matches` as narrow as its rule, since an exception hides every disagreement it matches.
- Before handing off, run `PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test tests/unit/property/planParser.property.test.ts` once, again after each fix, until it passes. Record each seed, and re-measure the plan-parser files' time at 100 runs.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/property/planParser.property.test.ts`

### Optional files that may be edited

- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/testLineGrammar.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/testLineGrammar.test.ts`

### Test strategy

- the structure check reports no error exactly when deterministic extraction reads a plan, apart from named exceptions — small · property · extractPlanDeterministic's verdict and the exception table · in-phase · ac-plan-lint-agrees
- every structure exception has a hand-written example it matches, on which the structure check is clean and extraction refuses — small · example · the example's two verdicts · in-phase
- each disagreement found that is not by design stays as a hand-written case beside its parser fix — small · example · the fixed parser's structure errors and extraction verdict · in-phase

### Implementation order

1. The exception type, `departing-test-line` and its example.
2. The agreement property.
3. The exception tests.
4. Runs at 2,000 with random seeds, then parser fixes with their hand-written cases.
5. Run the gate.

### Excluded scope

- Changing what `phax plans lint` reports, or the lint finding vocabulary in `lint.ts`, beyond a parser fix the property requires.
- The reducer and CLI-argument slices (the spec's third plan).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The test titles and the final `STRUCTURE_EXCEPTIONS` entries, with their reasons.
- Every disagreement found, with its seed, whether it is by design or a bug, and the fix and hand-written case.
- The 2,000-run seeds and results.
- The plan-parser files' time at 100 runs.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`test(property): the plan structure check agrees with extraction`

### Commit body

Add the property that collectPlanStructureErrors reports no error exactly when extractPlanDeterministic reads a plan (spec property-tests §5.10, ac-plan-lint-agrees).

The one disagreement that holds by design is named, departing-test-line: extraction refuses a test line off the grammar, which the structure check leaves to the lint's tests check. It is shown by a hand-written example and matched only when readPlanDeterministic reads the text with a departure. Any other disagreement is fixed in the parser, with its case.

---

## phase-06 — Docs: the plan-parser slice of the property tests {#phase-06-plan-parser-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Documents the plan-parser properties in `docs/property-tests.md`, so a contributor facing a failing plan-parser property can read it, replay it, and fix it in the right place.

### Detailed instructions

- Edit `docs/property-tests.md`, written for the reader of spec §11. Read the landed files for exact names, rather than this plan: `tests/helpers/property/planDocuments.ts` (`RENDERABLE_RULES`), `tests/helpers/property/planText.ts` (`PLAN_TEXT_MUTATIONS`, `LARGE_TEXT_FRAGMENTS`), `tests/helpers/planRoundTrip.ts` and `tests/unit/property/planParser.property.test.ts` (test titles, `STRUCTURE_EXCEPTIONS`).
- `What is covered`: the plan parser is now written too, and the state machine and CLI arguments follow in a later plan. List `tests/unit/property/planParser.property.test.ts` and its four tests under `plan parser`, each with one line on what it checks, and name the failure line vitest prints, e.g. `planParser.property.test.ts > plan parser > a rendered plan parses back to its projection`. Mention the sanity files `planDocuments.test.ts` and `planText.test.ts`.
- `Where the files live`: add `tests/helpers/property/planDocuments.ts`, `tests/helpers/property/planText.ts` and `tests/helpers/planRoundTrip.ts`. Note that the plan-parser properties import from `src/domain/plan`, `src/domain/authoring` and `src/schemas`.
- Add a `## The plan parser` section with the following parts:
  - the hand-built document generator, and why it is not derived;
  - the renderable rules, with each landed rule's name and reason, and how to add one: only for a limit of the plan.md form or of the renderer, always with a failing example;
  - the text sources, the named mutations and the 64 KiB inputs;
  - the 2-second bound, checked as the fastest of three timings;
  - the structure exceptions, `departing-test-line` and the rule for adding one, mirroring `Agreement exceptions`.
- `What to do with a counter-example`: extend it. A parser counter-example is fixed in `src/domain/plan/parsePlanMarkdown.ts`, with a case in `tests/unit/parsePlanMarkdown.test.ts`. A finalize counter-example is fixed in `src/domain/plan/finalize.ts`, with a case in `tests/unit/extractPlanFinalize.test.ts`. A renderer limit becomes a renderable rule, never a `renderPlanBody` change, because phax compares a sidecar's rendering with the committed plan body. List any renderer limits phases 03 to 05 recorded, as known gaps.
- Keep the page's style: an illustrative failure, not a real seed, and no release named literally. Check the `CONTRIBUTING.md` Tests link still points at the page, and edit it only if a heading it names was renamed.

### Planned files to create

- (none)

### Planned files to edit

- `docs/property-tests.md`

### Optional files that may be edited

- `CONTRIBUTING.md`

### Test strategy

- (none)

### Implementation order

1. Read the landed helpers and test file for names and reasons.
2. Update `What is covered` and `Where the files live`.
3. Add `The plan parser` section.
4. Extend `What to do with a counter-example`.
5. Run the gate.

### Excluded scope

- Any code or test change.
- Docs for the reducer and CLI-argument slices (the spec's third plan).
- `docs/security.md`: the deep pass is unchanged.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The sections added or changed in `docs/property-tests.md`.
- The rules, mutations and exceptions documented, as found in the code.
- Whether `CONTRIBUTING.md` needed a touch.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(property-tests): the plan-parser slice`

### Commit body

Document the plan-parser properties: the four tests and their failure lines, the hand-built plan-document generator and its renderable rules, the text sources and mutations, the 2-second bound checked as the best of three timings, the departing-test-line structure exception, and where a parser, finalize or renderer counter-example is fixed or recorded.
