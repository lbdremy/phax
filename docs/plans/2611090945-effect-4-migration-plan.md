---
status: Draft
source-spec: docs/specs/2611071052-effect-4-migration.md
completes-spec: false
---
# Effect 4 migration groundwork 2

This is the second plan of the approved spec `docs/specs/2611071052-effect-4-migration.md`, and not its last (`completes-spec: false`). Like the first plan (merged in #195), it runs entirely on Effect 3. No phase installs Effect 4, runs `pnpm codemod:effect4` on `src`, `tests`, `scripts` or `packages/schemas`, or migrates a call site to an Effect 4 API. Every phase is verified by the `standard` gate profile.

What it delivers, in order:

1. **phax's own refusal model** (§5.15 as amended, operator 2026-11-08). A refusal is a phax value: a path, a kind (`missing`, `unexpected`, `invalid-type`, `invalid-value` or `filter`), an expected label and the actual value. It lives in `src/schemas/refusal/`: `model.ts` (the type), `render.ts` (pure, reads only that value) and `adapter.ts` (the one module that reads Effect 3's `ParseResult` issues). phase-01 writes the acceptance tests, phase-02 passes them. phase-03 moves phax's formatters onto it (`src/schemas/formatError.ts`, `src/schemas/report.ts`, `src/domain/decide/handAuthored.ts`, `src/domain/decide/revision.ts`) and deletes `issueMessage` along with every match on Effect's message text. phase-04 is a person's review of the moved words. phase-05 moves `@lbdremy/phax-schemas` (`packages/schemas/src/parsed.ts`), the command library's two decode reasons and the corpus's package renderer.
2. **A denser behaviour corpus** (§5.16, §5.19). phase-06 writes the coverage tests as acceptance tests: one refused case per constrained leaf of each format's latest snapshot and of each frozen decoder's shape, and an encode case file for every format phax writes. phase-07 passes them, with a generator script, encode subjects and a capture on Effect 3.
3. **The test ratchet** (§5.22 as amended, operator 2026-11-09), in phase-08. `pnpm codemod:effect4 --ratchet` also runs the unit and integration suites and holds the passing tests to a record committed at `HEAD`.
4. **Docs and guidance**, in phase-09: the `0.36.0` entry of `docs/upgrading.md`, the `CONTRIBUTING.md` lines, and the `effect4-schema` skill's behaviour guard.

Corpus discipline. The corpus replay (`tests/unit/effect4Corpus/replay.test.ts`) stays green at the end of every phase. A captured expectation may be captured a second time only when its line moves under the refusal model's rules (phase-03 and phase-05). To do that, set exactly that case's `expected` to `null` and re-run `pnpm exec tsx scripts/effect4-corpus-capture.ts` on Effect 3. Each such line is listed in that phase's handoff (case file, case name, before, after), and phase-09 lists them in `docs/upgrading.md`. Any other replay failure is a defect in the code, not in the corpus. `tests/effect4Corpus/corpus.ts` stays byte-identical. `src/schemas/history/**` and `packages/schemas/history.lock.json` are not touched. No `next` snapshot is recorded.

Protected paths. phax.json's `protectedPaths` protect the corpus and the ratchet code, and phax.json itself is protected, so no phase can lift them. Before the run, the operator lifts exactly these four entries: `tests/effect4Corpus/cases/**`, `tests/unit/effect4Corpus/**`, `scripts/effect4-codemod/ratchet.ts` and `scripts/effect4-codemod/main.ts`. The other entries stay protected: `tests/effect4Corpus/baseline/**`, `tests/effect4Corpus/corpus.ts`, `scripts/effect4-codemod/counts.ts`, both tsconfigs and `vitest.config.ts`. `tests/unit/effect4Codemod/gateProfile.test.ts` asserts the exact `protectedPaths` list, so the operator's lifting commit must update its expected list too. Otherwise every phase's `pnpm test` fails. The same applies at the merge. Which protected paths each phase edits:

- phase-01, phase-02, phase-04, phase-09: none.
- phase-03: `tests/effect4Corpus/cases/**` (recapturing the moved lines).
- phase-05: `tests/effect4Corpus/cases/**` (recapturing the moved lines) and `tests/unit/effect4Corpus/wording.test.ts`.
- phase-06: `tests/unit/effect4Corpus/coverage.test.ts`.
- phase-07: `tests/effect4Corpus/cases/**` (new constraint cases and the new `cases/encode/` files) and `tests/unit/effect4Corpus/coverage.test.ts` (removing the markers).
- phase-08: `scripts/effect4-codemod/ratchet.ts` and `scripts/effect4-codemod/main.ts`.

When the run's PR merges, the operator restores the four lifted entries. They also add `scripts/effect4-codemod/passingTests.ts`, but not the test ratchet's record, `scripts/effect4-codemod/passing-tests.json`, which every migration phase rewrites like `type-error-counts.json`, and protect the test contract for the rest of the migration: `**/__snapshots__/**`, `packages/schemas/snapshots/**`, `tests/fixtures/help/**`, `tests/fixtures/usage/**`, `tests/unit/commandLibrary/contract/fixtures/**`, `tests/e2e/realFlow.test.ts`, `tests/e2e/headlessAuthoring.test.ts`, `tests/e2e/claudeProtectedPaths.test.ts`, `tests/e2e/claudeSkillEditGrant.test.ts`, `tests/unit/generateModelCatalog.test.ts` and `tests/unit/reconciliation/global.test.ts`. This plan may still change snapshot lines that hold refusal wording, which is why that protection starts at the merge. `packages/schemas/history.lock.json` stays unprotected: the schema phase refreshes it once (§5.17).

phase-09 edits `.claude/skills/effect4-schema/SKILL.md`, so run this plan with `phax run --allow-skill-edits`.

No phase commits `scripts/effect4-codemod/type-error-counts.json` or `scripts/effect4-codemod/passing-tests.json`, and no phase runs `pnpm codemod:effect4 --ratchet` on the repository tree. The phase of the next plan that installs Effect 4 and applies the codemod records the first counts and the first set of passing tests.

Out of scope: installing Effect 4, the Effect 4 adapter (the schema phase writes it against `SchemaIssue`), JSON Schema generation, and any codemod rule beyond those the spec lists.

## Required commands

- `pnpm exec tsx`
- `git log`

Both commands are already in `security.agentCommands` in phax.json: `pnpm exec tsx` runs `scripts/effect4-corpus-capture.ts` and the new `scripts/effect4-corpus-densify.ts`, and `git log` lets phase-09 read the case-file diffs of phase-03 and phase-05. No change to phax.json's security configuration is needed. The operator's protected-path edits described above are needed before the run, together with the matching update of `tests/unit/effect4Codemod/gateProfile.test.ts`.

## Technical arbitrations

- Where the model and the renderer live: in phax's `src/schemas/refusal/` (`model.ts`, `render.ts`, `adapter.ts`). `@lbdremy/phax-schemas` imports them by relative source path and compiles them into its build, as it already does with `src/schemas/schemaUrl.ts`, `src/schemas/report.ts` and `src/schemas/acceptanceLift.ts` (its tsconfig.build.json has `rootDir: ../..`). Set aside: phax depending on the package, which inverts the source layering; a copy in the package held equal by a test, which leaves two renderers and two adapters for the schema phase to port; and the package exporting the renderer, which adds an export name and breaks §5.20's export list equal to 0.36.0's. Loss accepted: the package's build stays tied to phax's source tree, and a consumer cannot render a refusal from their own decode.
- The refusal model is a per-variant union. `missing` has `{ path }`. `unexpected` has `{ path, expected }`, where `expected` is the allowed keys' label. `invalid-type`, `invalid-value` and `filter` each have `{ path, expected, actual, message }`, where `message` is phax's own `message` annotation text or null. The renderer prints `is missing`, `is unexpected, expected: <expected>`, the `message` alone when it is set, and otherwise `Expected <expected>, actual <actual>`. It formats `actual` with its own printer, which reproduces what Effect 3 printed for JSON data. Loss accepted: a non-JSON actual value (a class instance, a symbol) is printed by phax's printer, not Effect's.
- The expected label, in precedence order. (1) A whole type is named by its kind, even when it carries an annotation: a struct or record is `an object`, an array is `an array`, a tuple is `a tuple`, and a union is `one of …`. (2) A schema's own `message` annotation is phax's text and is rendered alone. (3) A built-in filter (pattern, minLength, maxLength, minItems, maxItems and the like) is labelled from its constraint data, in today's words (`a string matching the pattern <re>`, `a string at least <n> character(s) long`), never from Effect's description text. (4) An `identifier` annotation on a leaf or declaration is its label. (5) A literal is its JSON text, and a keyword is its name (`string`, `number`, `boolean`, `null`, `undefined`). `title` and `description` annotations never label: they document the JSON Schema. Loss accepted: lines where Effect 3 used a description as the label (for example the `verdict:` lines of acceptance-request and oracle-request) move once, to the literal or `one of` form.
- Union naming. A union where every member refuses at the union's own path (no member got deeper) is one refusal: its member labels joined by ` | `, duplicates removed in first-seen order, prefixed `one of ` unless every label is a literal. Its kind is `invalid-value` when every member is a literal, and `invalid-type` otherwise. A union of literals alone keeps today's words, `"a" | "b"` (operator, 2026-11-09), and `Struct | Null` reads `one of an object | null`. A union whose members all collapse to one label is named by that label, so two object shapes read `an object`. A union where some member got deeper reports only the deeper members' refusals, in Effect 3's order, and drops the shallow mismatches of the other members. formatConfigParseError already drops them by hand today (`brief: Expected undefined`, `assignments: Expected undefined`), and that filtering becomes dead code. Loss accepted: a union reads in two forms (literals alone, or `one of` once a whole type or keyword is among its members), a union of object shapes no longer lists its variants (the discriminator's own refusal does), and the shallow member lines disappear outside the config too. Each moved line is listed.
- The test ratchet runs the vitest CLI as a subprocess: `node_modules/.bin/vitest run --project unit --project integration --reporter=json --outputFile=<temp file>`, with the same `vitest.config.ts` as `pnpm test`. It reads the JSON report: each test is `testResults[].name` made repository-relative and POSIX, and `[...ancestorTitles, title].join(" > ")`. Set aside: vitest's Node API inside the codemod's tsx process, which loses isolation (config resolution, globals and the setup files run inside the gate's own process). Loss accepted: the ratchet depends on the JSON reporter's shape, so a run that writes no report it can read fails loudly rather than reading as zero tests.
- Flakiness and cost. Recorded tests that failed are rerun once, by file, before judging. A test that passes on the rerun counts as passing and is printed as a flaky notice. A skipped or missing recorded test is not rerun. The suites run only when the type-error check has passed, and the two records are written only when both checks pass. Loss accepted: a test that fails once in every run is hidden by the rerun. Each `effect-migration` phase also pays one full unit and integration run (what `pnpm test` costs in `standard` today), plus the rerun of the failing files only. vitest.config.ts's history of failures under load is why the rerun is worth it.
- The test record is `scripts/effect4-codemod/passing-tests.json`: an object from file to a sorted list of full names, with the keys sorted. A name that occurs several times in one file passes only when every occurrence passed. The record is read at `HEAD` with `git show`, like the counts file, and is never read from the working tree. A recorded test that fails, is skipped or no longer exists fails the gate, and a test passing for the first time is added. With no record at HEAD, the measured set is recorded. Loss accepted: renaming a test, or moving it to another file, fails the ratchet until the record at HEAD carries the new name. That is the intended signal.
- Encode subjects are a round trip from the encoded side: `encode/<format-id>` decodes the document with phax's current file decoder for the format, encodes it with phax's `encode…File` writer, and answers the encoded JSON as `{ ok: true, value }`. The inputs are the accepted current documents of the format's case file. The case files are `tests/effect4Corpus/cases/encode/<format-id>.json`, in the existing `{ subject, cases }` shape, so `corpus.ts`, the replay test and the capture script read them unchanged. "Phax writes the format" means one of phax's `src/schemas` modules exports a `Schema.encode*` writer of that format's file. A format phax only reads, or writes without a Schema encoder, has no encode subject, and the coverage test gives its reason in a comment. Loss accepted: a format written by JSON.stringify alone carries no encode evidence, since Effect plays no part in writing it.
- Constraint cases are named `constraint <path> <keyword>`, with the coverage test's path notation (`a.b`, `a[]`, `a.*`). There is one case per distinct (path, keyword) of a shape's snapshot, for pattern, minLength, maxLength, minItems, enum, const and required (a required key's path is the key's own path). Effect-free code generates them (`scripts/effect4-corpus-densify.ts`): it mutates one leaf of an accepted case of the same shape, appends the case with `expected: null`, and never changes an existing case. The capture script then fills them. Loss accepted: two branches that constrain the same path with the same keyword share one case.
- Following §5.10: every phase opens its instructions with `Follows skill: none (groundwork on Effect 3)`. This plan reworks Effect 3 code (the refusal adapter reads `ParseResult`) but migrates no call site to Effect 4, and no topic skill governs Effect 3 code. Loss accepted: like the first plan, this plan does not show the one-skill-per-phase discipline.
- The command library's two decode reasons (`src/cli/commandLibrary/commander/run.ts` `reasonOf`, and `src/cli/commandLibrary/commander/json.ts` `detailsOf`) print Effect's message verbatim, so §5.15 covers them even though the brief's list omits them. phase-05 moves them onto the model. Loss accepted: a larger phase-05.
- An interactive phase (phase-04) follows phase-03. The first move of the words sets the label and union rules and the recapture-and-list procedure, and phase-05 and phase-07 repeat both. A person reads the moved lines before they spread to the package and the command library.

---

## phase-01 — Refusal model and its acceptance tests {#phase-01-refusal-model-acceptance}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Stronger than the default: this phase designs a model no code in the repository shows yet, and its frozen tests bind the label and union rules for every later phase of the migration.
**Acceptance phase:** passed by phase-02
**Acceptance test files:** `tests/unit/schemas/refusal/render.test.ts`, `tests/unit/schemas/refusal/adapter.test.ts`

Fix the shape of phax's refusal model, and write the frozen acceptance tests that the renderer and the Effect 3 adapter must pass. The renderer and adapter are stubs that throw, so the tests fail on their assertions.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3). Do not change any formatter, the package or the corpus.
- Create `src/schemas/refusal/model.ts` with no imports and no Effect code: `export type RefusalPath = ReadonlyArray<PropertyKey>` and a per-variant `Refusal` union, every field readonly. `{ kind: "missing"; path }`; `{ kind: "unexpected"; path; expected: string }`, where `expected` is the allowed keys' label, the keys JSON-quoted and joined by ` | ` as today's `is unexpected, expected: …` line shows them; and `{ kind: "invalid-type" | "invalid-value" | "filter"; path; expected: string; actual: unknown; message: string | null }`. Write those three as three separate variants, not one with a kind union. `message` is phax's own `message` annotation text, or null. Document each kind in a comment: `invalid-type` means the value has the wrong JSON type, `invalid-value` means the right type but not an allowed value (a literal or a literal union), and `filter` means a refinement refused it.
- Create `src/schemas/refusal/render.ts`, pure, importing only the model. Export `refusalMessage(refusal: Refusal): string`, `refusalPath(path: RefusalPath, notation: "bracketed" | "dotted"): string` and `formatActual(value: unknown): string`. Every body throws `new Error("refusal renderer: not implemented")`. The specified behaviour, for phase-02: `missing` prints `is missing`; `unexpected` prints `is unexpected, expected: <expected>`; any other kind prints `message` alone when it is set, and otherwise `Expected <expected>, actual <formatActual(actual)>`. `bracketed` renders `acceptanceCriteria[2].refs[0]`, as formatError's formatIssuePath does today. `dotted` renders `a.0.b`, as `path.map(String).join(".")` does today. Both give `""` for the root.
- Create `src/schemas/refusal/adapter.ts`. It is the only module of the three that imports `effect`, and it imports only `ParseResult` and the AST types it needs. Export `refusalsOf(error: ParseResult.ParseError): ReadonlyArray<Refusal>`, listing the refusals in the order of `ParseResult.ArrayFormatter.formatErrorSync`'s issues, and `firstRefusal(error: ParseResult.ParseError): Refusal | undefined`. Both throw `new Error("refusal adapter: not implemented")`.
- Create `tests/unit/schemas/refusal/render.test.ts`, a table test over hand-built `Refusal` values: each kind with and without `message`; `formatActual` for a string, a number, a boolean, null, undefined, an array and a nested object; and both path notations, including the root and a mix of numeric and string segments. Every expected `formatActual` text is what Effect 3 prints today for the same value. Read it from `ParseResult.ArrayFormatter` on a probe while you write the test, and do not commit the probe.
- Create `tests/unit/schemas/refusal/adapter.test.ts`. It builds small Effect 3 schemas in the file itself and asserts `refusalsOf` and `firstRefusal` give these exact `Refusal` values: a missing key; an excess key under `onExcessProperty: "error"` (unexpected, with the allowed keys' label); a struct given null (`an object`); an array given a number (`an array`); a tuple given an object (`a tuple`); a literal given another string (invalid-value, `"a"`); a literal union (`"a" | "b"`, no prefix); a union of a struct and null given a number (`one of an object | null`); a union of two struct shapes given a number (`an object`); a union where one member got deeper (only that member's nested refusal); a struct behind a transformation given null (`an object`, with no `(Encoded side)`); a literal annotated with a description (labelled by the literal, not the description); `Schema.String` with an identifier annotation (labelled by the identifier); `Schema.pattern` (a filter labelled `a string matching the pattern <source>`); `Schema.minLength(1)` (a filter labelled `a string at least 1 character(s) long`); a filter with a `message` annotation (that message set); `Schema.String` given a number (invalid-type, `string`); and a struct decoded with `errors: "all"` holding three issues, whose refusals are in ArrayFormatter's order with ArrayFormatter's paths.
- Every expected label that is not a deliberate move (whole type, union, description-as-label) must equal the text today's `ArrayFormatter` message carries for the same input. Check each one against the installed Effect 3 while you write the test.
- Mark every test in both files with vitest's expected-failure marker (`it.fails`, `it.fails.each`), so `pnpm test` stays green. Each test must fail because the stub throws, never because of a missing module, export or type. The tests compile against the real model type and the stubs' signatures.
- These are frozen acceptance tests: they pin the model's I/O, never the adapter's internals. Name no helper and no traversal order beyond ArrayFormatter's.

### Planned files to create

- `src/schemas/refusal/model.ts`
- `src/schemas/refusal/render.ts`
- `src/schemas/refusal/adapter.ts`
- `tests/unit/schemas/refusal/render.test.ts`
- `tests/unit/schemas/refusal/adapter.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: `src/schemas/refusal/` (model, renderer, adapter). Consumers: phax's formatters (phase-03), the package's `Parsed` failures, the command library and the corpus subjects (phase-05). The stable shape between them is the `Refusal` value and the two rendering functions. The adapter is the only module that knows Effect's issue types, so a change of Effect version moves only the adapter.

### Test strategy

- every refusal kind renders today's words (`is missing`, `is unexpected, expected: …`, `Expected X, actual Y`, a phax message alone), and both path notations render as today — small · table · the words Effect 3 prints today for the same issue, read once with ArrayFormatter · acceptance · ac-refusal
- an Effect 3 decode failure becomes the specified refusal values: whole types by kind, unions as `one of …` or the deeper member, filters labelled from their data, descriptions never as labels — small · example · hand-written Refusal values per schema · acceptance · ac-refusal
- the adapter lists refusals in ArrayFormatter's order and at its paths — small · example · ArrayFormatter.formatErrorSync paths on the same error · acceptance · ac-refusal

### Implementation order

1. src/schemas/refusal/model.ts
2. src/schemas/refusal/render.ts and src/schemas/refusal/adapter.ts stubs
3. tests/unit/schemas/refusal/render.test.ts
4. tests/unit/schemas/refusal/adapter.test.ts, every test marked

### Excluded scope

- Implementing the renderer or the adapter (phase-02).
- Any change to formatError.ts, report.ts, the decide formatters, the package, the command library or the corpus.
- Any Effect 4 code or reference to SchemaIssue.

### Verification

The `standard` gate profile in phax.json, with the acceptance provider judging the markers.

### Expected handoff content

The exact `Refusal` type and the three modules' exported signatures. The list of adapter cases with their expected labels, marking which ones deliberately differ from Effect 3's message (whole type, union, description-as-label). The `formatActual` texts observed on Effect 3. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(refusal): pin phax's refusal model with acceptance tests`

### Commit body

Add phax's refusal model (src/schemas/refusal/model.ts): a path, a kind (missing, unexpected, invalid-type, invalid-value, filter), an expected label and the actual value. The renderer and the Effect 3 adapter are stubs that throw.

The acceptance tests fix the renderer's words and the adapter's refusal values for each case the #195 review raised: tuples, unions, the encoded side of a struct, and a description used as a label. Every test carries it.fails until the next phase implements both.

---

## phase-02 — Refusal renderer and Effect 3 adapter {#phase-02-refusal-renderer-adapter}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Stronger than the default: the adapter must match Effect 3's issue traversal exactly, by reading its source, without calling its formatter. A mistake here moves refusal lines across the whole corpus.

Implement the refusal renderer and the adapter from Effect 3's ParseResult issues, so phase-01's frozen acceptance tests pass. No formatter uses them yet.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- In `tests/unit/schemas/refusal/render.test.ts` and `tests/unit/schemas/refusal/adapter.test.ts`, remove the `fails` markers. That is the only change you may make to these two files. If a frozen test looks wrong, stop and say so in the handoff; never edit its expectation.
- Implement `src/schemas/refusal/render.ts` as phase-01 specified: `refusalMessage`, `refusalPath` (bracketed and dotted) and `formatActual`. `formatActual` is phax's own printer and reproduces Effect 3's output for JSON data: strings JSON-quoted, numbers and booleans as written, `null`, `undefined`, arrays as `[a,b]` and objects as `{"k":v}`, recursively. It must not import `effect`.
- Implement `src/schemas/refusal/adapter.ts` by walking the `ParseResult.ParseIssue` tree yourself. Never call `ArrayFormatter` and never read `.message` text. Read Effect 3's own traversal in `node_modules/effect/src/ParseResult.ts` (the ArrayFormatter section) and match its order and paths. Handle the tags this way: `Pointer` extends the path; `Composite` visits its issues in order; `Refinement` with kind `From` recurses, and with kind `Predicate` gives a `filter` refusal; `Transformation` recurses into its issue, whatever its side; `Missing` gives `missing`; `Unexpected` gives `unexpected`, with the allowed keys' label built from the struct's property signatures; `Type` gives a refusal labelled by the label rules.
- Label rules, in precedence order. (1) Whole types by kind: a TypeLiteral is `an object`, a TupleType with only rest elements is `an array`, any other TupleType is `a tuple`, and a Union is `one of …`. (2) A `message` annotation (resolved as Effect 3 resolves it on that AST, including the override semantics) sets `message`. (3) A built-in filter is labelled from its constraint data, through its schema id and parameters (for example the pattern's regex source, or minLength's number), in today's words. (4) An `identifier` annotation. (5) A literal is its JSON text, and a keyword is its name. Look through Refinement, Transformation, Suspend and Declaration to the side that decides the kind. `title` and `description` are never labels.
- Unions. When every member's issue is a Type issue at the union's own path, emit one refusal at that path: labels in first-seen order, duplicates removed, joined by ` | ` and prefixed `one of ` unless every label is a literal (a union of literals alone keeps today's `"a" | "b"`), or the single label when only one remains. Its kind is `invalid-value` when every member is a literal, and `invalid-type` otherwise. When some member got deeper, emit only the deeper members' refusals, in order, and drop the shallow mismatches.
- A `Forbidden` issue cannot arise in phax's synchronous decoders. Map it to an `invalid-value` refusal labelled `a value decoded synchronously`, and cover it with one small test in the new order test.
- Create `tests/unit/schemas/refusal/adapterOrder.test.ts` (in-phase). Decode invalid inputs with `errors: "all"` through some of phax's real decoders (`decodePhaxConfig`, `decodeAuthoredPlanDocument`'s schema, a frozen decoder from `src/schemas/history/`). Assert that `refusalsOf` gives one refusal per ArrayFormatter issue, at the same paths and in the same order, except where the union rule collapses or drops member issues. Assert those exceptions explicitly.
- Do not wire the model into any formatter: phase-03 does that.

### Planned files to create

- `tests/unit/schemas/refusal/adapterOrder.test.ts`

### Planned files to edit

- `src/schemas/refusal/render.ts`
- `src/schemas/refusal/adapter.ts`
- `tests/unit/schemas/refusal/render.test.ts`
- `tests/unit/schemas/refusal/adapter.test.ts`

### Optional files that may be edited

- `src/schemas/refusal/model.ts`

### Boundary contracts

The adapter is the one place phax reads Effect's issue types (`ParseResult.ParseIssue` on Effect 3). The renderer reads only the `Refusal` value. Consumers, from phase-03 on, call `refusalsOf` or `firstRefusal`, then `refusalMessage` and `refusalPath`.

### Test strategy

- the adapter keeps ArrayFormatter's issue count, order and paths on phax's real decoders, except the documented union collapses — small · example · ArrayFormatter.formatErrorSync on the same ParseError · in-phase · ac-refusal
- a Forbidden issue renders as a refusal, never a crash — small · example · the specified invalid-value refusal · in-phase

### Implementation order

1. src/schemas/refusal/render.ts
2. src/schemas/refusal/adapter.ts: the tree walk, then labels, then unions
3. remove the markers from the two acceptance test files
4. tests/unit/schemas/refusal/adapterOrder.test.ts

### Excluded scope

- Changing any formatter, the package, the command library or the corpus.
- Editing the acceptance tests beyond removing their markers.
- Any Effect 4 adapter.

### Verification

The `standard` gate profile in phax.json, with the acceptance provider judging the passed tests.

### Expected handoff content

How each ParseIssue tag is mapped, and the label precedence as implemented. The `message` annotation resolution you matched. The union rule with an example of each branch. Any acceptance test you believe is wrong (it stays frozen), with the reason. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(refusal): render refusals from phax's model and adapt Effect 3 issues`

### Commit body

Implement the refusal renderer, which is pure and reads only the Refusal value, and the adapter that walks Effect 3's ParseIssue tree into it. The adapter never reads Effect's message text. Whole types are named by their kind, a union is one refusal named `one of …` unless a member got deeper, and filters are labelled from their constraint data.

This passes the acceptance tests of the previous phase. No formatter uses the model yet.

---

## phase-03 — phax's formatters render through the refusal model {#phase-03-phax-formatters}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Higher effort than the default: the config formatter's special cases must be rebuilt on kinds and paths without moving their lines, and each corpus replay failure must be judged a deliberate move or a defect before anything is recaptured.

Every refusal line phax itself prints is built from the refusal model. `issueMessage` and every match on Effect's message text are gone. The corpus is recaptured only for the lines that move under the model's rules.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- In `src/schemas/formatError.ts`, rewrite `formatParseError`, `formatConfigParseError`, `formatViolationAt`, `formatFirstViolation`, `formatAnswerViolations` and `formatPlanDocumentViolation` on `refusalsOf` or `firstRefusal`, `refusalMessage` and `refusalPath`, imported from `src/schemas/refusal/`. Keep each function's signature and its line shapes: the two-space indent and the `(root)` of formatParseError, the bracketed paths, the `; ` join with `$schema` first, and the `<phase id> test line <n>` prefix.
- Remove `issueMessage`, `LITERAL_MISMATCH_RE` and the `ConfigIssue` alias. Replace each message-text test with the refusal's kind: `isEmptyListIssue` checks `kind === "missing"`, and formatAnswerViolations' own-key filter checks `kind === "missing" || kind === "unexpected"`. The literal-union merge of assignmentIssueLines goes: the adapter already gives one `one of …` refusal. The `brief: Expected undefined` and `assignments: Expected undefined` filters go too, since the adapter drops shallow union mismatches. Keep the gate-step output line, the `brief.push` line, the empty-list lines and the `assignments[N]` naming, all keyed on paths and kinds.
- In `src/schemas/report.ts`, rewrite `describeReportIssue` on `firstRefusal` and remove its `issueMessage` import. In `src/domain/decide/handAuthored.ts` and `src/domain/decide/revision.ts`, replace `ParseResult.ArrayFormatter.formatErrorSync(error)` plus `issueMessage(first.message)` with `firstRefusal(error)` and `refusalMessage`, keeping their `refusal(path, message)` calls. The domain may import `src/schemas/refusal/` as it imports formatError today. Check `pnpm audit:architecture`.
- After this phase no module under `src/schemas/`, `src/domain/` or `src/app/` calls `ArrayFormatter` or reads an Effect issue's `.message`, apart from `src/schemas/refusal/adapter.ts`, which reads neither. The command library and `packages/schemas` move in phase-05.
- Delete `tests/unit/schemas/issueMessage.test.ts`. First carry each of its cases into a new `tests/unit/schemas/refusal/formatters.test.ts`, which goes through the public formatters (formatFirstViolation, formatParseError, formatConfigParseError, formatAnswerViolations), keeping each expected line unless it is a deliberate move. Add the review's misses: a tuple, a union of shapes, a struct behind a transformation, and a literal with a description.
- Recapture. Run `pnpm test`. For each corpus replay failure, decide whether the new line is a deliberate move under the model's rules: whole type by kind, `one of …` unions, description no longer a label, or a shallow union mismatch dropped. If it is, set exactly that case's `expected` to `null` in its case file and run `pnpm exec tsx scripts/effect4-corpus-capture.ts`. If it is not, the code is wrong: fix the formatter or the adapter, never the case. Never null a case whose line did not move.
- Update any other test whose expected refusal line moved for the same reasons, and only those lines. Candidates are in the optional list. Do not touch a `__snapshots__` file unless its line is a deliberate move, and list each such line.
- Format subjects (`format:<id>`) and the `package` render of `tests/effect4Corpus/subjects.ts` still read the package and ArrayFormatter. Their lines must not move in this phase.

### Planned files to create

- `tests/unit/schemas/refusal/formatters.test.ts`

### Planned files to edit

- `src/schemas/formatError.ts`
- `src/schemas/report.ts`
- `src/domain/decide/handAuthored.ts`
- `src/domain/decide/revision.ts`
- `tests/unit/schemas/issueMessage.test.ts`

### Optional files that may be edited

- `src/schemas/refusal/render.ts`
- `src/schemas/refusal/adapter.ts`
- `tests/effect4Corpus/cases/config/model-routing.json`
- `tests/effect4Corpus/cases/config/phax-config.json`
- `tests/effect4Corpus/cases/config/phax-user-overlay.json`
- `tests/effect4Corpus/cases/config/provider-config.json`
- `tests/effect4Corpus/cases/config/telemetry-config.json`
- `tests/effect4Corpus/cases/answers/authoring-answer.json`
- `tests/effect4Corpus/cases/answers/plan-audit.json`
- `tests/effect4Corpus/cases/answers/plan-extraction.json`
- `tests/effect4Corpus/cases/answers/vibe-export.json`
- `tests/effect4Corpus/cases/documents/artifact-frontmatter.json`
- `tests/effect4Corpus/cases/formats/acceptance-request.json`
- `tests/effect4Corpus/cases/formats/architecture-report.json`
- `tests/effect4Corpus/cases/formats/architecture-request.json`
- `tests/effect4Corpus/cases/formats/artifact-status.json`
- `tests/effect4Corpus/cases/formats/authoring-record-manifest.json`
- `tests/effect4Corpus/cases/formats/brief-record.json`
- `tests/effect4Corpus/cases/formats/brief-report.json`
- `tests/effect4Corpus/cases/formats/brief-request.json`
- `tests/effect4Corpus/cases/formats/code-review.json`
- `tests/effect4Corpus/cases/formats/compliance-review.json`
- `tests/effect4Corpus/cases/formats/cost-ledger.json`
- `tests/effect4Corpus/cases/formats/decide-verdicts.json`
- `tests/effect4Corpus/cases/formats/decision-record-manifest.json`
- `tests/effect4Corpus/cases/formats/first-reading.json`
- `tests/effect4Corpus/cases/formats/gate-attribution.json`
- `tests/effect4Corpus/cases/formats/gate-report.json`
- `tests/effect4Corpus/cases/formats/gate-request.json`
- `tests/effect4Corpus/cases/formats/hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/interactive-handoff.json`
- `tests/effect4Corpus/cases/formats/interactive-session.json`
- `tests/effect4Corpus/cases/formats/oracle-request.json`
- `tests/effect4Corpus/cases/formats/phase-file-reconciliation.json`
- `tests/effect4Corpus/cases/formats/phase-record-manifest.json`
- `tests/effect4Corpus/cases/formats/phase-status.json`
- `tests/effect4Corpus/cases/formats/phax-plan-extraction.json`
- `tests/effect4Corpus/cases/formats/phax-plan.json`
- `tests/effect4Corpus/cases/formats/plan-approval-record.json`
- `tests/effect4Corpus/cases/formats/plan-approvals.json`
- `tests/effect4Corpus/cases/formats/plan-document.json`
- `tests/effect4Corpus/cases/formats/plan-hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/plan-lint.json`
- `tests/effect4Corpus/cases/formats/plan-overview.json`
- `tests/effect4Corpus/cases/formats/registry.json`
- `tests/effect4Corpus/cases/formats/review-record-manifest.json`
- `tests/effect4Corpus/cases/formats/review-stop.json`
- `tests/effect4Corpus/cases/formats/run-list.json`
- `tests/effect4Corpus/cases/formats/run-status.json`
- `tests/effect4Corpus/cases/formats/spec-approval-record.json`
- `tests/effect4Corpus/cases/formats/spec-approvals.json`
- `tests/effect4Corpus/cases/formats/spec-document.json`
- `tests/effect4Corpus/cases/formats/spec-hand-decision-answer.json`
- `tests/unit/planDocument.test.ts`
- `tests/unit/specDocument.test.ts`
- `tests/unit/schemas/handDecisionAnswer.test.ts`
- `tests/unit/schemas/decideVerdicts.test.ts`
- `tests/unit/schemas/assignments.test.ts`
- `tests/unit/schemas/briefConfig.test.ts`
- `tests/unit/schemas/answerRulesKept.test.ts`
- `tests/unit/decide/handAuthored.test.ts`
- `tests/unit/decide/revision.test.ts`
- `tests/unit/cli/reportConfigError.test.ts`
- `tests/integration/report.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Consumer: every phax call site that prints a refusal (config loading, persisted readers, authoring answers, gate and brief reports, decide). Producer: `src/schemas/formatError.ts`, `src/schemas/report.ts` and the decide formatters, now built on `src/schemas/refusal/`. The stable shape is each formatter's signature and line shape. Only the words the model's rules move change.

### Test strategy

- phax's formatters print the review's missed cases (tuple, union of shapes, transformed struct, described literal) by kind, and keep every other line of the old issueMessage tests — small · example · expected lines carried over from issueMessage.test.ts plus the label rules · in-phase · ac-refusal
- every corpus refusal replays to its captured line, recaptured only where a line moved under the model's rules — small · table · the corpus case files captured on Effect 3 · in-phase · ac-refusal
- no module of src/schemas, src/domain or src/app calls ArrayFormatter or reads an Effect issue's message — small · example · pnpm audit:architecture and a source search in formatters.test.ts · in-phase · ac-refusal

### Implementation order

1. src/schemas/formatError.ts
2. src/schemas/report.ts
3. src/domain/decide/handAuthored.ts and src/domain/decide/revision.ts
4. tests/unit/schemas/refusal/formatters.test.ts, then delete tests/unit/schemas/issueMessage.test.ts
5. run pnpm test, null the moved cases, run the capture script
6. update other tests' moved lines

### Excluded scope

- packages/schemas/src/parsed.ts, the command library and the `package` render in tests/effect4Corpus/subjects.ts (phase-05).
- New corpus cases (phase-07).
- docs/upgrading.md (phase-09).
- tests/effect4Corpus/corpus.ts, the baseline and the frozen decoders under src/schemas/history/.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Every recaptured line: case file, case name, before, after, and which rule moved it (whole type, one of, description, shallow union member dropped). Every other test line changed, with the same detail. The functions removed from formatError.ts. Confirmation that no non-moved case was recaptured. Any deviation from the planned file lists, with the reason.

### Commit subject

`refactor(refusal): build phax's refusal lines from its own model`

### Commit body

formatError.ts, report.ts and the decide formatters now build every refusal line from phax's refusal model through one adapter. issueMessage, the literal-mismatch regex and every test on Effect's message text are gone.

Lines moved only under the model's rules: whole types are named by their kind, unions read `one of …`, a description is no longer a label, and shallow union mismatches are dropped. Those corpus cases were recaptured on Effect 3, and the handoff lists each one.

---

## phase-04 — Review the moved refusal words {#phase-04-review-moved-words}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Mode:** interactive

A person reviews the refusal lines phase-03 moved and the label and union rules behind them, before phase-05 and phase-07 repeat the same rules and the same recapture procedure.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Present the reviewer with phase-03's handoff list of moved lines, grouped by rule: whole type by kind, `one of …` unions, description no longer a label, and shallow union member dropped. Give a before and after example for each group.
- What to review: whether each moved line reads well to a person who sees it in a terminal; whether the union rule (one refusal versus the deeper member) picks the useful line; and whether any recaptured case was not a deliberate move.
- The pattern at stake: phase-05 applies the same model to the package's `Parsed` failures and the command library and recaptures the format lines the same way, and phase-07 captures hundreds of new refused cases whose lines all follow these rules.
- A correction goes into the renderer, the adapter or the formatters, never into a frozen acceptance test of phase-01. A changed rule means the affected corpus cases are recaptured the same way (null, then the capture script) and listed.

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/schemas/refusal/render.ts`
- `src/schemas/refusal/adapter.ts`
- `src/schemas/formatError.ts`
- `tests/unit/schemas/refusal/formatters.test.ts`
- `tests/unit/schemas/refusal/adapterOrder.test.ts`

### Test strategy

- (none)

### Implementation order

1. show the grouped moved lines
2. collect the reviewer's corrections
3. apply them and recapture only the affected cases

### Excluded scope

- The package, the command library and new corpus cases.
- Editing tests/unit/schemas/refusal/render.test.ts or tests/unit/schemas/refusal/adapter.test.ts.

### Verification

The `standard` gate profile in phax.json, run by `phax resume` on the person's correction.

### Expected handoff content

The reviewer's verdict on each rule, every correction made, and the updated list of moved lines (case file, case name, before, after) if the review changed any.

### Commit subject

`refactor(refusal): apply the review of the moved refusal words`

### Commit body

Apply a person's review of the refusal lines that the move onto phax's refusal model changed, before the package and the denser corpus repeat the same rules.

---

## phase-05 — Package, command library and corpus subjects render through the model {#phase-05-package-and-command-library}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`@lbdremy/phax-schemas`'s `Parsed` failures, the command library's decode reasons and the corpus's package renderer use the same refusal words as phax. No module outside the adapter reads Effect's message text.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- In `packages/schemas/src/parsed.ts`, rewrite `fromEither` on `firstRefusal` and `refusalMessage`, imported by relative source path from `../../../src/schemas/refusal/` (as shapes.ts already imports `src/schemas/schemaUrl.ts`). Keep the failure's path dotted (`refusalPath(path, "dotted")`, `""` at the root) and the `invalid document` fallback. Do not add, rename or remove any export of `packages/schemas/src/index.ts`. `tests/unit/effect4Corpus/package.test.ts` holds the export names to the baseline, and §5.20 requires 0.36.0's names.
- In `tests/effect4Corpus/subjects.ts`, `renderFrozen`'s `package` branch reads ArrayFormatter directly. Make it render the first refusal exactly as the package's `fromEither` does, `<dotted path>: <message>` with `: invalid document` when there is none. Leave every other subject unchanged.
- In `src/cli/commandLibrary/commander/run.ts` (`reasonOf`) and `src/cli/commandLibrary/commander/json.ts` (`detailsOf`), replace `ParseResult.ArrayFormatter.formatErrorSync(...)[0]` and `first.message` with `firstRefusal` and `refusalMessage`. Keep `pathOf` and the line shapes. Update both doc comments, which name ArrayFormatter.
- Extend `tests/unit/effect4Corpus/wording.test.ts` so no captured refusal holds an Effect whole-type or union description. Keep the existing pattern and add tuple types (`readonly [`), struct sides (`(Encoded side)`, `(Type side)`), and a union with a member that is not a JSON literal in an `Expected …, actual` line that does not follow `Expected one of ` (a union of literals alone keeps today's `"a" | "b"`). Keep it Effect-free.
- Recapture as in phase-03. Run `pnpm test`. For each replay failure that is a deliberate move under the model's rules (now in `format:<id>` lines and package-rendered frozen shapes), null exactly that case and run `pnpm exec tsx scripts/effect4-corpus-capture.ts`. Any other failure is a defect in the code. Update other tests' moved lines only for the same reasons (the package tests in the optional list).
- After this phase, a search for `ArrayFormatter` and for `.message` on a ParseResult issue across `src/`, `packages/schemas/src/` and `tests/effect4Corpus/` finds only `src/schemas/refusal/adapter.ts`, which uses neither. Add that search as a test in `tests/unit/schemas/refusal/formatters.test.ts`, extending phase-03's search to the package, the command library and the corpus subjects.

### Planned files to create

- (none)

### Planned files to edit

- `packages/schemas/src/parsed.ts`
- `tests/effect4Corpus/subjects.ts`
- `src/cli/commandLibrary/commander/run.ts`
- `src/cli/commandLibrary/commander/json.ts`
- `tests/unit/effect4Corpus/wording.test.ts`
- `tests/unit/schemas/refusal/formatters.test.ts`

### Optional files that may be edited

- `tests/effect4Corpus/cases/formats/acceptance-request.json`
- `tests/effect4Corpus/cases/formats/architecture-report.json`
- `tests/effect4Corpus/cases/formats/architecture-request.json`
- `tests/effect4Corpus/cases/formats/artifact-status.json`
- `tests/effect4Corpus/cases/formats/authoring-record-manifest.json`
- `tests/effect4Corpus/cases/formats/brief-record.json`
- `tests/effect4Corpus/cases/formats/brief-report.json`
- `tests/effect4Corpus/cases/formats/brief-request.json`
- `tests/effect4Corpus/cases/formats/code-review.json`
- `tests/effect4Corpus/cases/formats/compliance-review.json`
- `tests/effect4Corpus/cases/formats/cost-ledger.json`
- `tests/effect4Corpus/cases/formats/decide-verdicts.json`
- `tests/effect4Corpus/cases/formats/decision-record-manifest.json`
- `tests/effect4Corpus/cases/formats/first-reading.json`
- `tests/effect4Corpus/cases/formats/gate-attribution.json`
- `tests/effect4Corpus/cases/formats/gate-report.json`
- `tests/effect4Corpus/cases/formats/gate-request.json`
- `tests/effect4Corpus/cases/formats/hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/interactive-handoff.json`
- `tests/effect4Corpus/cases/formats/interactive-session.json`
- `tests/effect4Corpus/cases/formats/oracle-request.json`
- `tests/effect4Corpus/cases/formats/phase-file-reconciliation.json`
- `tests/effect4Corpus/cases/formats/phase-record-manifest.json`
- `tests/effect4Corpus/cases/formats/phase-status.json`
- `tests/effect4Corpus/cases/formats/phax-plan-extraction.json`
- `tests/effect4Corpus/cases/formats/phax-plan.json`
- `tests/effect4Corpus/cases/formats/plan-approval-record.json`
- `tests/effect4Corpus/cases/formats/plan-approvals.json`
- `tests/effect4Corpus/cases/formats/plan-document.json`
- `tests/effect4Corpus/cases/formats/plan-hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/plan-lint.json`
- `tests/effect4Corpus/cases/formats/plan-overview.json`
- `tests/effect4Corpus/cases/formats/registry.json`
- `tests/effect4Corpus/cases/formats/review-record-manifest.json`
- `tests/effect4Corpus/cases/formats/review-stop.json`
- `tests/effect4Corpus/cases/formats/run-list.json`
- `tests/effect4Corpus/cases/formats/run-status.json`
- `tests/effect4Corpus/cases/formats/spec-approval-record.json`
- `tests/effect4Corpus/cases/formats/spec-approvals.json`
- `tests/effect4Corpus/cases/formats/spec-document.json`
- `tests/effect4Corpus/cases/formats/spec-hand-decision-answer.json`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemasPackage/reportFormats.test.ts`
- `src/schemas/refusal/render.ts`
- `src/schemas/refusal/adapter.ts`

### Boundary contracts

Consumer: a package user calling a parse function, who reads `{ ok: false, error: { path, message } }`. Producer: `packages/schemas/src/parsed.ts` on phax's shared `src/schemas/refusal/` source. The stable shape is `ParseFailure` and the package's export names, both unchanged; only the message words follow the model. A second consumer is a CLI user reading a command library refusal (`Details.expected`, and the reason line), whose shapes are unchanged.

### Test strategy

- the package's parse functions give the captured shape, value or refusal for every corpus document, with the same export names as the baseline — small · table · the corpus case files and tests/effect4Corpus/baseline/package-exports.json · in-phase · ac-package
- no captured refusal holds an Effect whole-type, tuple, struct-side or unprefixed union description — small · table · the wording patterns in wording.test.ts over every case file · in-phase · ac-refusal
- only the adapter reads Effect issues, and nothing in src, packages/schemas/src or the corpus subjects reads ArrayFormatter or an issue's message text — small · example · a source search over the three trees · in-phase · ac-refusal

### Implementation order

1. packages/schemas/src/parsed.ts
2. tests/effect4Corpus/subjects.ts package render
3. src/cli/commandLibrary/commander/run.ts and json.ts
4. tests/unit/effect4Corpus/wording.test.ts and the extended source search
5. run pnpm test, null the moved cases, run the capture script

### Excluded scope

- New exports of @lbdremy/phax-schemas or changes to its parse functions' result shapes.
- New corpus cases (phase-07).
- docs/upgrading.md and the package README (phase-09 and the later release).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Every recaptured line (case file, case name, before, after, rule). The command library lines whose words changed, if any test showed one. Confirmation that the package's export names are unchanged. Any deviation from the planned file lists, with the reason.

### Commit subject

`refactor(refusal): render package and command library refusals through the model`

### Commit body

@lbdremy/phax-schemas' Parsed failures, the command library's decode reasons and the corpus's package renderer now use phax's refusal model, compiled into the package from phax's source. The package's export names are unchanged.

The wording test now also refuses tuple, struct-side and unprefixed union descriptions. Format lines that moved under the model's rules were recaptured on Effect 3, and the handoff lists each one.

---

## phase-06 — Corpus coverage acceptance tests for constraints and encoding {#phase-06-corpus-coverage-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-07
**Acceptance test files:** `tests/unit/effect4Corpus/coverage.test.ts`

Extend the corpus coverage test so it demands one refused case for every constrained leaf of every format's latest snapshot and every frozen decoder's shape, and an encode case file for every format phax writes. The new tests are written first and marked as expected failures.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Edit `tests/unit/effect4Corpus/coverage.test.ts` only. Keep it Effect-free. It reads snapshots, `history.lock.json` and case files, and imports nothing from `effect`, directly or through the corpus.
- Add `constraintPaths(schema)`, which walks a snapshot with the existing notation and cycle guard (`a.b`, `a[]`, `a.*`, `$ref` into `$defs`, every `anyOf`/`oneOf`/`allOf` branch) and returns every distinct `{ path, keyword }`. For `pattern`, `minLength`, `maxLength`, `minItems`, `enum` and `const`, the path is the node's own path. For `required`, each listed key gives the key's own path. Each (path, keyword) appears once, sorted.
- Add, for each format id: a test that, for every constraint of its latest released snapshot, `file.current` holds a case named exactly `constraint <path> <keyword>` whose `expected` is a refusal (`ok: false`).
- Add, for each frozen module `<id>/<shape>` of `history.lock.json`: a test that reads `packages/schemas/snapshots/<id>/<shape>.schema.json` and requires the same of `file.shapes[<shape>]`. It fails, naming the module, when that snapshot is missing.
- Add a `WRITTEN_FORMATS` list in the file: the formats one of whose `src/schemas` modules exports a `Schema.encode*` writer of the format's file. Confirm each entry by reading the module, and comment beside the list on every format left out and why (phax only reads it, or writes it without a Schema encoder). The plan's reading, to confirm: registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record-manifest, authoring-record-manifest, gate-attribution, phase-file-reconciliation, spec-document, plan-document, plan-approval-record, spec-approval-record, gate-request, brief-request, brief-record, decision-record-manifest, first-reading, interactive-handoff, interactive-session, review-stop, run-list, review-record-manifest, code-review, phax-plan-extraction, acceptance-request, artifact-status, plan-overview, plan-lint.
- Add, for each written format: a test that `tests/effect4Corpus/cases/encode/<id>.json` exists as a subject case file naming `encode/<id>`, that every case's `expected` is accepted (`ok: true`), and that the accepted values together set every property path of the format's latest released snapshot (reuse `documentPaths` and `schemaPaths`).
- Mark every test you add with vitest's expected-failure marker (`it.fails`), so `pnpm test` stays green. Each must fail on its assertion: a constraint case is missing, or an encode file is missing. Do not add a test that already passes, such as a self-test of the walker on a small schema: a passing marked test fails the gate. Leave the existing tests unchanged.
- These are frozen acceptance tests: phase-07 may only remove their markers. The list of written formats, the case-name convention and the constraint keywords are frozen with them.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/effect4Corpus/coverage.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: the Effect 4 migration's later phases, which rely on the corpus refusing what each constraint refuses and encoding what phax writes. Producer: the case files under `tests/effect4Corpus/cases/`. The stable shape is the case name `constraint <path> <keyword>`, the `cases/encode/<id>.json` subject files, and the snapshots they are measured against.

### Test strategy

- every constrained leaf (pattern, minLength, maxLength, minItems, enum, const, required) of each format's latest snapshot has a refused current case — small · table · the constraints read from packages/schemas/snapshots · acceptance · ac-frozen
- every constrained leaf of each frozen decoder's shape has a refused case in that shape's list — small · table · the frozen shape's snapshot and history.lock.json · acceptance · ac-frozen
- every format phax writes has encode cases whose encoded JSON sets every property path of its latest snapshot — small · table · the WRITTEN_FORMATS list and the latest snapshot's property paths · acceptance · ac-json-schema

### Implementation order

1. constraintPaths
2. the per-format and per-frozen-module constraint tests
3. WRITTEN_FORMATS and the encode tests
4. mark every added test

### Excluded scope

- Adding any case, case file or subject (phase-07).
- Changing the existing coverage tests, corpus.ts or the replay test.

### Verification

The `standard` gate profile in phax.json, with the acceptance provider judging the markers.

### Expected handoff content

The final WRITTEN_FORMATS list and every format left out with its reason. The number of constraints per format and per frozen module. Any frozen module without a snapshot. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(corpus): demand a refused case per constraint and encode cases per written format`

### Commit body

Extend the corpus coverage test. Every constrained leaf of each format's latest snapshot and of each frozen decoder's shape needs a refused case named `constraint <path> <keyword>`, and every format phax writes needs encode cases that set every field of its latest snapshot. These answer the #195 review: loosened constraints and encoding were not covered.

Every new test carries it.fails until the next phase adds the cases.

---

## phase-07 — Denser corpus: constraint cases and encode subjects {#phase-07-denser-corpus}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Higher effort than the default: hundreds of cases across 41 formats and 63 frozen shapes, where every case that captures as accepted must be repaired by reading its union branch, and no existing case may change.

The corpus holds a refused case for every constrained leaf and encode cases for every format phax writes, all captured on Effect 3, so phase-06's coverage acceptance tests pass.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- In `tests/unit/effect4Corpus/coverage.test.ts`, remove the `fails` markers. That is the only change you may make to this file. If a frozen test cannot be satisfied, stop and say so in the handoff.
- Create `scripts/effect4-corpus-densify.ts` (run it with `pnpm exec tsx scripts/effect4-corpus-densify.ts`). It is Effect-free and imports only `tests/effect4Corpus/corpus.ts` and node built-ins. For every format case file, it reads the latest snapshot (for `current`) and each frozen shape's snapshot (for `shapes[<shape>]`), and lists the constraints in the coverage test's notation (same walk). For each constraint with no case named `constraint <path> <keyword>`, it copies an accepted case of the same list whose input sets that path, mutates exactly that leaf, and appends `{ name, input, expected: null }`.
- Mutations: `pattern` gives a string the regex refuses (try `""`, `" "`, `"bogus value"` and `"!"`, checked with `new RegExp`). `minLength` gives a string one character too short. `maxLength` gives one character too long. `minItems` gives the array cut to one item fewer. `enum` and `const` give `"bogus-value"`, or a value of another type when that is accepted. `required` deletes the key. Inside `a[]` mutate the first element, and inside `a.*` the first entry. When no accepted case sets the path, report it and do not invent one.
- For every format of `WRITTEN_FORMATS` with no `tests/effect4Corpus/cases/encode/<id>.json`, the script writes `{ subject: "encode/<id>", cases }`, one case per accepted current case of the latest shape, with the same name, the same input and `expected: null`. The script never changes or removes an existing case. Run twice, it changes nothing.
- In `tests/effect4Corpus/subjects.ts`, add an `encode/<id>` subject per written format, in a table typed over the written format ids. It decodes the document with phax's current file decoder for the format (the one phax's reader uses), encodes the decoded value with that format's `encode…File` writer, and answers `accepted(encoded)`. A decode failure throws, because an encode input must decode. Comment each entry with the phax call site it mirrors, as the other subjects do.
- Run the densify script, then `pnpm exec tsx scripts/effect4-corpus-capture.ts`. Read every new constraint case that captured `ok: true`: the mutation did not violate the constraint alone (another union branch accepted it). Edit only that new case's input by hand so it violates the constraint within its branch, reset its `expected` to null, and capture again. Never edit an existing case.
- Run `pnpm test`. The replay, wording and coverage tests must all pass, with no existing expectation changed. Commit the densify script, the subjects change and the case files.

### Planned files to create

- `scripts/effect4-corpus-densify.ts`
- `tests/effect4Corpus/cases/encode/registry.json`
- `tests/effect4Corpus/cases/encode/run-status.json`
- `tests/effect4Corpus/cases/encode/phase-status.json`
- `tests/effect4Corpus/cases/encode/phax-plan.json`
- `tests/effect4Corpus/cases/encode/compliance-review.json`
- `tests/effect4Corpus/cases/encode/plan-approvals.json`
- `tests/effect4Corpus/cases/encode/spec-approvals.json`
- `tests/effect4Corpus/cases/encode/phase-record-manifest.json`
- `tests/effect4Corpus/cases/encode/authoring-record-manifest.json`
- `tests/effect4Corpus/cases/encode/gate-attribution.json`
- `tests/effect4Corpus/cases/encode/phase-file-reconciliation.json`
- `tests/effect4Corpus/cases/encode/spec-document.json`
- `tests/effect4Corpus/cases/encode/plan-document.json`
- `tests/effect4Corpus/cases/encode/plan-approval-record.json`
- `tests/effect4Corpus/cases/encode/spec-approval-record.json`
- `tests/effect4Corpus/cases/encode/gate-request.json`
- `tests/effect4Corpus/cases/encode/brief-request.json`
- `tests/effect4Corpus/cases/encode/brief-record.json`
- `tests/effect4Corpus/cases/encode/decision-record-manifest.json`
- `tests/effect4Corpus/cases/encode/first-reading.json`
- `tests/effect4Corpus/cases/encode/interactive-handoff.json`
- `tests/effect4Corpus/cases/encode/interactive-session.json`
- `tests/effect4Corpus/cases/encode/review-stop.json`
- `tests/effect4Corpus/cases/encode/run-list.json`
- `tests/effect4Corpus/cases/encode/review-record-manifest.json`
- `tests/effect4Corpus/cases/encode/code-review.json`
- `tests/effect4Corpus/cases/encode/phax-plan-extraction.json`
- `tests/effect4Corpus/cases/encode/acceptance-request.json`
- `tests/effect4Corpus/cases/encode/artifact-status.json`
- `tests/effect4Corpus/cases/encode/plan-overview.json`
- `tests/effect4Corpus/cases/encode/plan-lint.json`

### Planned files to edit

- `tests/unit/effect4Corpus/coverage.test.ts`
- `tests/effect4Corpus/subjects.ts`
- `tests/effect4Corpus/cases/formats/acceptance-request.json`
- `tests/effect4Corpus/cases/formats/architecture-report.json`
- `tests/effect4Corpus/cases/formats/architecture-request.json`
- `tests/effect4Corpus/cases/formats/artifact-status.json`
- `tests/effect4Corpus/cases/formats/authoring-record-manifest.json`
- `tests/effect4Corpus/cases/formats/brief-record.json`
- `tests/effect4Corpus/cases/formats/brief-report.json`
- `tests/effect4Corpus/cases/formats/brief-request.json`
- `tests/effect4Corpus/cases/formats/code-review.json`
- `tests/effect4Corpus/cases/formats/compliance-review.json`
- `tests/effect4Corpus/cases/formats/cost-ledger.json`
- `tests/effect4Corpus/cases/formats/decide-verdicts.json`
- `tests/effect4Corpus/cases/formats/decision-record-manifest.json`
- `tests/effect4Corpus/cases/formats/first-reading.json`
- `tests/effect4Corpus/cases/formats/gate-attribution.json`
- `tests/effect4Corpus/cases/formats/gate-report.json`
- `tests/effect4Corpus/cases/formats/gate-request.json`
- `tests/effect4Corpus/cases/formats/hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/interactive-handoff.json`
- `tests/effect4Corpus/cases/formats/interactive-session.json`
- `tests/effect4Corpus/cases/formats/oracle-request.json`
- `tests/effect4Corpus/cases/formats/phase-file-reconciliation.json`
- `tests/effect4Corpus/cases/formats/phase-record-manifest.json`
- `tests/effect4Corpus/cases/formats/phase-status.json`
- `tests/effect4Corpus/cases/formats/phax-plan-extraction.json`
- `tests/effect4Corpus/cases/formats/phax-plan.json`
- `tests/effect4Corpus/cases/formats/plan-approval-record.json`
- `tests/effect4Corpus/cases/formats/plan-approvals.json`
- `tests/effect4Corpus/cases/formats/plan-document.json`
- `tests/effect4Corpus/cases/formats/plan-hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/plan-lint.json`
- `tests/effect4Corpus/cases/formats/plan-overview.json`
- `tests/effect4Corpus/cases/formats/registry.json`
- `tests/effect4Corpus/cases/formats/review-record-manifest.json`
- `tests/effect4Corpus/cases/formats/review-stop.json`
- `tests/effect4Corpus/cases/formats/run-list.json`
- `tests/effect4Corpus/cases/formats/run-status.json`
- `tests/effect4Corpus/cases/formats/spec-approval-record.json`
- `tests/effect4Corpus/cases/formats/spec-approvals.json`
- `tests/effect4Corpus/cases/formats/spec-document.json`
- `tests/effect4Corpus/cases/formats/spec-hand-decision-answer.json`

### Optional files that may be edited

- `scripts/effect4-corpus-capture.ts`

### Boundary contracts

Consumer: the corpus replay and coverage tests, and through them every later migration phase. Producer: the case files and `tests/effect4Corpus/subjects.ts`'s new `encode/<id>` subjects, which mirror phax's decode-then-encode write path. The stable shape is corpus.ts's `{ subject, cases }` and `{ format, current, shapes }` files, which are unchanged.

### Test strategy

- the densify script never changes an existing case, and a second run changes no file — medium · example · git status after a second run, and the replay test's unchanged expectations · in-phase · ac-frozen
- every new constraint and encode case replays to the expectation captured on Effect 3 — small · table · the case files captured by scripts/effect4-corpus-capture.ts · in-phase · ac-frozen

### Implementation order

1. remove the coverage test markers
2. scripts/effect4-corpus-densify.ts
3. encode subjects in tests/effect4Corpus/subjects.ts
4. run densify, then the capture script
5. repair by hand only new constraint cases that captured as accepted
6. run pnpm test

### Excluded scope

- Changing any existing case or expectation.
- Changing tests/effect4Corpus/corpus.ts, the replay test, the baseline or any frozen decoder.
- Encode subjects for formats outside WRITTEN_FORMATS.

### Verification

The `standard` gate profile in phax.json, with the acceptance provider judging the passed tests.

### Expected handoff content

The counts of new constraint cases per format and per frozen shape, and of encode cases per format. Every constraint case whose input was repaired by hand, and why. Any path no accepted case set, and how it was resolved. The encode subjects' decoder and writer per format. Any deviation from the planned file lists (an encode file planned for a format phase-06 excluded, or the reverse), with the reason.

### Commit subject

`test(corpus): add a refused case per constraint and encode cases captured on Effect 3`

### Commit body

Add scripts/effect4-corpus-densify.ts, which derives one refused case per constrained leaf of each format's latest snapshot and of each frozen shape, plus encode case files for every format phax writes. Add encode subjects that decode with phax's reader and encode with its writer.

Every new expectation was captured on Effect 3, and no existing case changed. This passes the coverage acceptance tests of the previous phase.

---

## phase-08 — The test ratchet {#phase-08-test-ratchet}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Stronger than the default: this phase builds an adapter to a tool the code does not drive yet (vitest's CLI and JSON reporter, run from a gate), with a rerun rule and an atomic two-record write the migration's every later phase relies on.

`pnpm codemod:effect4 --ratchet` also runs the unit and integration suites and holds the passing tests to the record committed at HEAD. A recorded test that fails, is skipped or no longer exists fails the gate, and a test passing for the first time is added.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Create `scripts/effect4-codemod/passingTests.ts`. Export `PASSING_TESTS_FILE = "scripts/effect4-codemod/passing-tests.json"`; the type `TestRecord`, a map from repository-relative POSIX file to a sorted list of full names; a hand-written guard `toTestRecord(value: unknown): TestRecord | null` with no assertion; `serializeTestRecord`, which sorts the keys and names and writes two-space JSON with a final newline; and `readTestBase(root)`, which reads the file at HEAD with git exactly like ratchet.ts's `readBase` and never reads the working tree (outcomes none, found, malformed, unreadable).
- Also export the measured outcome type: each test is `{ file, name, status: "passed" | "failed" | "skipped" }`, with vitest's pending, todo and disabled counted as skipped. Export `parseVitestJson(text, root)`. It reads the JSON reporter's `testResults[].name` (absolute, made relative to `root` and POSIX) and `assertionResults[]` (`ancestorTitles`, `title`, `status`); the full name is `[...ancestorTitles, title].join(" > ")`. A file that failed to load contributes no tests. Text that is not a JSON report throws.
- Export `judgeTests(base: TestRecord | null, measured)`. No base means `record`. Otherwise, every recorded (file, name) must be present with every occurrence passed. The verdict is `pass` with the names added, or `fail` with the failed, skipped and missing names. The next record is the measured passing set: names that passed in every occurrence.
- Export a `TestRunner` type, `(root: string, files: ReadonlyArray<string> | null) => string`, which returns the JSON report text, and `vitestRunner`, which runs `<root>/node_modules/.bin/vitest run --project unit --project integration --reporter=json --outputFile=<temp file> [files…]` with spawnSync, then reads and removes the temp file. Accept a binary path option so a test can point it at a fixture project. A run that leaves no readable report throws, as counts.ts's spawnRunner does for tsc. A non-zero exit with a report is expected when tests fail.
- Rerun rule: when the verdict fails only on failed recorded tests, rerun once the files holding them (`files` argument). A recorded test that passes on the rerun counts as passed and is reported as `flaky`. Skipped and missing tests are not rerun.
- Edit `scripts/effect4-codemod/ratchet.ts`. `RatchetOptions` gains `runTests?: TestRunner`, defaulting to `vitestRunner`. In `runRatchet`, check the bases and the scripts guard first, as today. Run the type-error check, and if it fails, print as today and return 1 without running the suites. Then run the suites and judge the tests. Write `type-error-counts.json` and `passing-tests.json` only when both checks pass (or record). Print the type-error table, then `tests  recorded <n>  passing <n>  added <n>`, then one line per failed, skipped, missing or flaky test (`failed   <file> > <name>`), then the outcome line.
- Edit `scripts/effect4-codemod/main.ts`. `RunDependencies` gains `runTests: TestRunner` (`vitestRunner` in `processDependencies`), passed to runRatchet. Update the header comment: `--ratchet` also runs the unit and integration suites. Do not change package.json's scripts: the scripts guard refuses that.
- Edit `tests/integration/effect4Ratchet.test.ts` so each existing test injects a recorded-report runner and never spawns vitest. Add cases to it in the same temporary-git-repository style: first record of both files; pass with an added test; fail on a failed, a skipped and a missing recorded test (nothing written); a flaky test passing on rerun; a malformed record at HEAD; and the working tree's record ignored in favour of HEAD's.
- Create `tests/unit/effect4Codemod/passingTests.test.ts`: a table over judgeTests (every combination of recorded and measured status, duplicate names, no base), the guard's refusals, serialization, and parseVitestJson on hand-written reports (a load failure, ancestor titles, todo and pending as skipped).
- Create a fixture vitest project under `tests/unit/effect4Codemod/__fixtures__/vitest-project/`. Its `vitest.config.ts` defines `unit` and `integration` projects that include `*.check.ts`, so the repository's own suite never collects the fixture. Add `passing.check.ts`, `failing.check.ts`, `skipped.check.ts` and `flaky.check.ts`. The flaky one fails while the file named by `PHAX_RATCHET_FLAKY_MARK` is absent, then creates it. Create `tests/integration/effect4TestRatchet.test.ts`, which runs the real `vitestRunner` with the repository's vitest binary against the fixture and checks the parsed outcomes and the rerun rule.
- Never run `pnpm codemod:effect4 --ratchet` on the repository tree, and commit neither `scripts/effect4-codemod/passing-tests.json` nor `scripts/effect4-codemod/type-error-counts.json`: the next plan's install phase records the first set. Every test of the ratchet works in a temporary repository or the fixture project.

### Planned files to create

- `scripts/effect4-codemod/passingTests.ts`
- `tests/unit/effect4Codemod/passingTests.test.ts`
- `tests/integration/effect4TestRatchet.test.ts`
- `tests/unit/effect4Codemod/__fixtures__/vitest-project/vitest.config.ts`
- `tests/unit/effect4Codemod/__fixtures__/vitest-project/passing.check.ts`
- `tests/unit/effect4Codemod/__fixtures__/vitest-project/failing.check.ts`
- `tests/unit/effect4Codemod/__fixtures__/vitest-project/skipped.check.ts`
- `tests/unit/effect4Codemod/__fixtures__/vitest-project/flaky.check.ts`

### Planned files to edit

- `scripts/effect4-codemod/ratchet.ts`
- `scripts/effect4-codemod/main.ts`
- `tests/integration/effect4Ratchet.test.ts`

### Optional files that may be edited

- `tests/unit/effect4Codemod/ratchet.test.ts`
- `tests/integration/effect4CodemodCli.test.ts`
- `knip.json`
- `.oxlintrc.json`

### Boundary contracts

Consumer: the `effect-migration` gate profile's every-phase step `pnpm codemod:effect4 --ratchet`, which passes or fails a phase. Producer: `scripts/effect4-codemod/ratchet.ts` with `passingTests.ts`, reading vitest's JSON reporter through a subprocess. The stable shapes are the exit code (0 on record or pass, 1 on failure), the two record files read at HEAD, and the printed report.

### Test strategy

- every (recorded status, measured status) pair, duplicates and the no-base case judge as §5.22 says — small · table · a verdict table written from §5.22 as amended · in-phase · ac-green
- a malformed record or vitest report is refused with a typed outcome or a thrown error, never read as zero tests — small · boundary · the guard's null and parseVitestJson's throw · in-phase · ac-green
- the ratchet reads both records at HEAD, writes them only when both checks pass, and fails on a failed, skipped or missing recorded test — medium · example · temporary git repositories with injected reports, file contents and exit codes · in-phase · ac-green
- the real vitest runner reports passed, failed and skipped tests, and a test that fails once passes on the rerun — medium · smoke · the fixture project's known outcomes · in-phase · ac-green

### Implementation order

1. scripts/effect4-codemod/passingTests.ts: record, guard, parser, judge
2. tests/unit/effect4Codemod/passingTests.test.ts
3. vitestRunner and the rerun rule, with the fixture project and tests/integration/effect4TestRatchet.test.ts
4. ratchet.ts and main.ts wiring
5. tests/integration/effect4Ratchet.test.ts

### Excluded scope

- Changing package.json scripts, vitest.config.ts or the effect-migration profile in phax.json.
- Committing passing-tests.json or type-error-counts.json.
- Running the ratchet on the repository tree.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The record path and shape, the identity of a test, the exact vitest command, the rerun rule, the printed report format, and the order in which both checks run and write. How long the fixture smoke takes, and an estimate of a full `--ratchet` on this tree (one unit and integration run plus the type-error counts). Which new paths the operator should protect at the merge (passingTests.ts and passing-tests.json). Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(effect4): hold passing tests in the migration ratchet`

### Commit body

`pnpm codemod:effect4 --ratchet` now also runs the unit and integration suites through vitest's JSON reporter and compares the passing tests with scripts/effect4-codemod/passing-tests.json at HEAD. A recorded test that fails, is skipped or no longer exists fails the gate, and a new passing test is added. Failed tests are rerun once before judging, and both records are written only when both checks pass.

No record is committed: the phase that installs Effect 4 records the first set.

---

## phase-09 — Upgrading notes, contributing guide and schema skill {#phase-09-docs-and-guidance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The `0.36.0` entry of docs/upgrading.md names the refusal lines that changed and why. CONTRIBUTING.md explains the test ratchet and the one recapture. The effect4-schema skill points the schema phase at the one adapter it ports.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- In `docs/upgrading.md`, under `### 0.36.0`, add a part on refusal lines. phax now builds every refusal line from its own refusal model, so a later change of Effect version moves no message. List the rules that moved lines, each with a before and after example: whole types by their kind (`an object`, `an array`, `a tuple`); unions as `one of …`; a description no longer used as a label; and a union member's shallow mismatch no longer printed beside the member that got deeper.
- Then list every moved line. Derive the list from the case-file diffs of this run, `git log -p -- tests/effect4Corpus/cases`, keeping only changed `refusal` values of existing cases (not new cases), and cross-check it with the phase-03, phase-04 and phase-05 handoffs in `.phax-context/`. Group the lines by surface (config, provider answers, documents, persisted formats and the package) and give before → after for each.
- Say which words stayed the same: `is missing`, `is unexpected, expected: …`, `Expected X, actual Y`, `Expected an object, actual null`, and the config's `gate step` and `brief.push` lines. Say that `@lbdremy/phax-schemas`'s `Parsed` failures use the same words.
- In `CONTRIBUTING.md`, under `## The Effect 4 migration`, add the test ratchet: `pnpm codemod:effect4 --ratchet` also runs the unit and integration suites; it reads the passing tests recorded in `scripts/effect4-codemod/passing-tests.json` at HEAD; a recorded test that fails, is skipped or no longer exists fails the gate, failures are rerun once, and a new passing test is added; and the phase that installs Effect 4 records the first set. Amend the sentence that says the case files are never recaptured: on Effect 3, this plan recaptured exactly the lines the refusal model moved (listed in docs/upgrading.md), and also added constraint and encode cases.
- In `.claude/skills/effect4-schema/SKILL.md`, rewrite the first behaviour guard. Refusal words are built by `src/schemas/refusal/render.ts` from phax's refusal model. The schema phase ports only `src/schemas/refusal/adapter.ts`, from ParseResult issues to SchemaIssue, and changes no message. No formatter reads Effect's message text. Add `src/schemas/refusal/adapter.ts` to the skill's May change list. Keep the rest of the skill.
- In `docs/effect-4-mapping.md`, update any mention of `issueMessage` or of formatError reading ArrayFormatter, if there is one.

### Planned files to create

- (none)

### Planned files to edit

- `docs/upgrading.md`
- `CONTRIBUTING.md`
- `.claude/skills/effect4-schema/SKILL.md`

### Optional files that may be edited

- `docs/effect-4-mapping.md`

### Test strategy

- (none)

### Implementation order

1. derive the moved lines from git log
2. docs/upgrading.md
3. CONTRIBUTING.md
4. .claude/skills/effect4-schema/SKILL.md
5. docs/effect-4-mapping.md if needed

### Excluded scope

- The release's Effect 4 entry for docs/upgrading.md and the package README note (§5.21), which ship with the migration's release.
- Any code or corpus change.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The number of moved lines listed, by surface, and any disagreement found between the git diffs and the earlier handoffs. The exact skill text changed. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(effect4): list the moved refusal lines and explain the test ratchet`

### Commit body

docs/upgrading.md's 0.36.0 entry names the refusal lines that moved when phax began building them from its own refusal model, with the rules and every moved line. CONTRIBUTING.md explains the test ratchet and the one recapture on Effect 3. The effect4-schema skill now says the schema phase ports only the refusal adapter.
