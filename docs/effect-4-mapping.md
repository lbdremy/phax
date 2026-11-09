# Effect 3 → Effect 4: what maps to what in phax

A reading aid for the Effect 4 migration (spec `effect-4-migration`). It shows how the Effect 3
symbols phax uses translate to Effect 4, which of them the codemod rewrites and which it leaves to
the topic-skill phases. It is a snapshot, not a source of truth: the rule table is
`scripts/effect4-codemod/rules.ts`, the owners are `scripts/effect4-codemod/owners.ts`, every target
is read from `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md` at the line cited, and
`pnpm codemod:effect4 --check` prints the current list. It goes with the codemod and the reference
when the migration's last plan removes them.

The counts below come from the first Effect 4 run of the codemod (phase-01 of the migration run), on
effect 4.1.2: **654 files changed, 5,219 rewrites; 1,308 uses are left to the phases.** The
type-error counts it printed are, for `src`, 5,827 before and 4,996 after, and for the test suite,
4,628 before and 4,489 after. The counts after are the ones the ratchet holds
(`scripts/effect4-codemod/type-error-counts.json`) and later phases are measured against.

## 1. What the codemod rewrites

| Rule                   | Effect 3                                              | Effect 4                                | `v3-to-v4.md` | Rewrites |
| ---------------------- | ----------------------------------------------------- | --------------------------------------- | ------------- | -------- |
| `either-to-result`     | `effect/Either` (the import)                          | `effect/Result`                         | 689           | 4,437 (494 files) |
|                        | `Either.Either<A, E>`                                 | `Result.Result<A, E>`                   | 10395         |          |
|                        | `Either.right(a)`                                     | `Result.succeed(a)`                     | 10459         |          |
|                        | `Either.left(e)`                                      | `Result.fail(e)`                        | 10449         |          |
|                        | `Either.isRight` / `Either.isLeft`                    | `Result.isSuccess` / `Result.isFailure` | 10447 / 10445 |          |
|                        | `Either.map` / `Either.mapLeft`                       | `Result.map` / `Result.mapError`        | 10453 / 10455 |          |
|                        | `Either.getOrElse`                                    | `Result.getOrElse`                      | 10433         |          |
|                        | `Either.getOrThrow`                                   | `Result.getOrThrow`                     | 10435         |          |
|                        | `Either.match(x, { onLeft, onRight })`                | `Result.match(x, { onFailure, onSuccess })` | 10457     |          |
| `effect-either`        | `Effect.either`                                       | `Effect.result`                         | 10057         | 394 (179 files) |
| `schema-decode-either` | `Schema.decodeEither`, `Schema.decodeUnknownEither`   | `Schema.decodeUnknownResult`            | 14950, 14954  | 210 (154 files) |
|                        | `Schema.encodeEither`, `Schema.encodeUnknownEither`   | `Schema.encodeUnknownResult`            | 14970, 14974  |          |
|                        | `ParseResult.decodeUnknownEither`                     | `Schema.decodeUnknownResult`            | 13130         |          |
| `context-tag`          | `Context.Tag("id")<Self, Shape>()`                    | `Context.Service<Self, Shape>()("id")`  | 9639          | 11 (11 files) |
|                        | `Context.GenericTag<Shape>("id")`                     | `Context.Service<Shape>("id")`          | 9629          |          |
| `schema-filters`       | `X.pipe(Schema.filter(predicate))`                    | `X.check(Schema.makeFilter(predicate))` | 14992         | 2 (1 file) |
| `schema-optional-with` | `Schema.optionalWith(s, { exact: true })`             | `Schema.optionalKey(s)`                 | 15118         | 122 (52 files) |
| `catch-all`            | `Effect.catchAll` / `Effect.orElse`                   | `Effect.catch`                          | 10003 / 10189 | 43 (24 files) |
| `parse-result-issues`  | `effect/ParseResult`, `Missing`, `ParseIssue`, `Type`, `Unexpected` | `effect/SchemaIssue`, `MissingKey`, `Issue`, `InvalidType`, `UnexpectedKey` | 720, 13088–13120 | 0 (see below) |

Real rewrites from the first run:

```ts
// context-tag
-export class Backend extends Context.Tag("phax/Backend")<Backend, BackendOps>() {}
+export class Backend extends Context.Service<Backend, BackendOps>()("phax/Backend") {}

// schema-optional-with (only the `{ exact: true }` form)
-const Switch = Schema.optionalWith(Schema.Boolean, { exact: true });
+const Switch = Schema.optionalKey(Schema.Boolean);

// schema-filters (one pipe argument, no type-guard predicate)
-Schema.Struct({ n: Schema.Number }).pipe(Schema.filter(({ n }) => isEven(n)));
+Schema.Struct({ n: Schema.Number }).check(Schema.makeFilter(({ n }) => isEven(n)));

// catch-all
-Effect.catchAll((e) => Effect.succeed({ kind: "write-failed", message: e.message } as const)),
+Effect.catch((e) => Effect.succeed({ kind: "write-failed", message: e.message } as const)),
```

Where the codemod departs from the reference, and why:

- **`Either.getOrThrow` → `Result.getOrThrow` is a rename, though it throws differently.** On a
  failure, v4 throws the failure value itself where v3 threw an `Error`. phax only unwraps values
  that cannot fail (three constant branch names in `src`, expected successes in tests), and no test
  asserts the thrown error, so no caller sees the difference (operator decision 2026-11-09).

- **`decode*Either` → `decodeUnknownResult`, not `decode*Exit`.** The reference maps them to the
  `Exit` decoders, but the same pass turns every `Either` consumer into a `Result` consumer, and an
  `Exit` is not a `Result`. effect@4.1.2 ships `Schema.decodeUnknownResult` and
  `Schema.encodeUnknownResult` (`dist/Schema.d.ts:1402`, `:1761`); there is no typed
  `decodeResult`, so the typed variants map to the unknown-input ones (operator decision
  2026-11-08).
- **`parse-result-issues` rewrites nothing today**: every file that imports `ParseResult` also
  uses `ParseError` or `ArrayFormatter`, which no rule covers, so the import stays for the schema
  phase.

A rule only fires on the call shape it knows. Any other shape (`Schema.optionalWith` with
`default`, a type-guard `Schema.filter`, a multi-argument pipe) is left untouched and reported.

## 2. What the codemod leaves to the phases (1,308 uses)

Each leftover is reported under the topic skill that owns its module
(`.claude/skills/effect4-*`), with the reference line a phase reads before changing it.

| Skill              | Uses  | In `src` / `tests` / `packages` |
| ------------------ | ----- | ------------------------------- |
| `effect4-errors`   | 484   | 278 / 206 / 0                   |
| `effect4-schema`   | 792   | 702 / 76 / 14                   |
| `effect4-core`     | 31    | 24 / 7 / 0                      |
| `effect4-services` | 1     | 0 / 1 / 0                       |

### Blocked uses: a covered symbol held back by an uncovered neighbour

474 leftovers are symbols the codemod covers (`Either.isLeft`, `Either.right`, …) in a file that
also uses an `Either` member no rule covers. The codemod cannot rename the `Either` import while
something still needs it, so it leaves the whole file's `Either` uses and names the blocker. Once a
phase migrates the blocker, re-running `pnpm codemod:effect4` rewrites the rest.

| Blocker                 | Uses it blocks | Why no rule covers it (reference line)                                                  |
| ----------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `Either.flatMap`        | 233            | the reference says `TODO: needs guidance` (10423)                                       |
| `Either.flip`           | 137            | → `Result.flip` (10425); no rule yet                                                    |
| `Either.Left`           | 47             | → `Result.Failure`, and `.left` becomes `.failure` on the value (10407)                 |
| `Either.getOrNull`      | 28             | no entry in the reference                                                               |
| `Either.getOrUndefined`, `getOrThrowWith` | 7 | → `Result.getOrUndefined`, `getOrThrowWith` (10439, 10437); no rule yet        |
| `ParseResult.ParseError` | 22             | no stated target (13090); the schema phase's                                            |

### `effect4-errors`: `Either`, `Exit`, `Cause`, `Effect.catch*`

| Effect 3                     | Effect 4                       | Line  | Uses |
| ---------------------------- | ------------------------------ | ----- | ---- |
| `Either.flatMap`             | (no stated target)             | 10423 | 6    |
| `Either.getOrNull`           | (no entry)                     | –     | 5    |
| `Effect.catchAllCause`       | `Effect.catchCause`            | 10005 | 5    |
| `Either.flip`                | `Result.flip`                  | 10425 | 4    |
| `Exit.isInterrupted`         | `Exit.hasInterrupts`           | 10601 | 3    |
| `Cause.failureOption`        | `Cause.findErrorOption`        | 9137  | 3    |
| `Either.Left`                | `Result.Failure`               | 10407 | 3    |
| `Either.getOrUndefined`      | `Result.getOrUndefined`        | 10439 | 2    |
| `Either.getOrThrowWith`      | `Result.getOrThrowWith`        | 10437 | 1    |
| blocked covered `Either.*`   | as in §1                       |       | 452  |

Not in the report but the same phase's work: member accesses on the values these types give
(`.left` / `.right` → `.failure` / `.success`, `_tag: "Left"` / `"Right"` expectations in tests).

### `effect4-schema`: `Schema`, `ParseResult`, `JSONSchema`, `SchemaAST`

| Effect 3                                   | Effect 4                                                       | Line  | Uses |
| ------------------------------------------ | -------------------------------------------------------------- | ----- | ---- |
| `Schema.pattern`                           | `Schema.isPattern`                                             | 15128 | 197  |
| `Schema.annotations`                       | `Schema.annotate`                                              | 14912 | 125  |
| `Schema.Schema.Any` / `All` / `AnyNoContext` | none (use the v4 schema type)                                | 14712–14716 | 50 |
| `Schema.filter` (other shapes)             | `.check(Schema.makeFilter(p))` or `Schema.refine(r)`           | 14992 | 42   |
| `ParseResult.ParseError`                   | (no stated target; `Schema.SchemaError`)                       | 13090 | 39   |
| `Schema.minLength` / `maxLength` / `minItems` | `Schema.isMinLength` / `isMaxLength` / `isMinLength`        | 15080, 15076, 15078 | 49 |
| `ParseResult.ArrayFormatter`               | `SchemaIssue.makeFormatterStandardSchemaV1`                    | 13066 | 16   |
| `Schema.optionalElement`                   | none                                                           | 15112 | 12   |
| `JSONSchema.make` / `fromAST`              | `Schema.toJsonSchemaDocument`                                  | 11712, 11700 | 12 |
| `Schema.optionalWith` (other options)      | `Schema.optional` / `optionalKey` / `withDecodingDefaultType`  | 15118 | 8    |
| `Schema.greaterThanOrEqualTo` / `between` / `nonNegative` / `positive` / `finite` / `int` | `Schema.isGreaterThanOrEqualTo` / `isBetween` / `isGreaterThanOrEqualTo(0)` / `isGreaterThan(0)` / `isFinite` / `isInt` | 15016, 14924, 15096, 15136, 14996, 15036 | 29 |
| `Schema.NonNegativeInt` / `NonNegative`    | `Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))` / `…check(Schema.isGreaterThanOrEqualTo(0))` | 14610, 14600 | 12 |
| `Schema.ReadonlySet`                       | `Schema.toCodecJson(Schema.ReadonlySet(value))`                | 14692 | 4    |
| `Schema.propertySignature`                 | none                                                           | 15142 | 3    |
| `Schema.DateFromSelf`                      | `Schema.Date`                                                  | 14392 | 1    |
| `SchemaAST.isTypeLiteral` / `isTupleType` / `TypeLiteral` / `TupleType` | `SchemaAST.isObjects` / `isArrays` / `Objects` / `Arrays` | 15464, 15462, 15356, 15348 | 18 |
| `SchemaAST.isRefinement` / `Refinement` / `isTransformation` | `SchemaAST.Check` / `Check` / `Encoding`            | 15454, 15320, 15460 | 17 |
| `SchemaAST.encodedAST`                     | `SchemaAST.toEncoded`                                          | 15382 | 5    |
| `SchemaAST.get{Identifier,Title,Description,JSONSchema}Annotation` | `SchemaAST.resolve{Identifier,Title,Description}`, `resolveAt("toJsonSchema")` | 15406, 15432, 15400, 15412 | 8 |
| `SchemaAST.*Keyword`, `is*Keyword` (string, number, boolean, …) | `SchemaAST.string`, `isString`, …                  | 15372–15502 | 23 |
| `ParseResult.isParseError` / `parseError` / `Pointer` / `ArrayFormatterIssue` | `Schema.isSchemaError` / `Schema.SchemaError` / `SchemaIssue.Pointer` / `StandardSchemaV1.FailureResult["issues"][number]` | 13154, 13160, 13098, 13078 | 5 |
| other `SchemaAST` annotation ids and types | see the cited lines in the `--check` output                    | 15210–15370 | 9 |
| `effect/ParseResult`, `effect/JSONSchema` (imports), `JSONSchema.JsonSchema7` | `effect/SchemaIssue` + `effect/SchemaParser`, `effect/JsonSchema`, `JsonSchema.JsonSchema` | 720, 700, 11658 | 5 |
| `ParseResult.Unexpected` (blocked by `ParseError`) | `SchemaIssue.UnexpectedKey`                          | 13120 | 1 |

Not in the report but the same phase's work: method calls on schema values
(`.annotations(` → `.annotate(`). The refusal wording (`is missing`, `is unexpected`,
`Expected X, actual Y`) must not move. The corpus holds it; groundwork plan 2 gives phax its own
refusal model before any of this is touched.

### `effect4-core` and `effect4-services`

| Effect 3                          | Effect 4                             | Line  | Uses |
| --------------------------------- | ------------------------------------ | ----- | ---- |
| `Effect.dieMessage`               | `Effect.die`                         | 10045 | 14   |
| `Effect.zipRight`                 | `Effect.andThen`                     | 10367 | 7    |
| `Array.isNonEmptyReadonlyArray`   | `Array.isReadonlyArrayNonEmpty`      | 8947  | 5    |
| `Effect.async`                    | `Effect.callback`                    | 9989  | 1    |
| `Effect.timeoutTo`                | `Effect.timeoutOrElse` + `Effect.map`| 10275 | 1    |
| `Effect.fork`                     | `Effect.forkChild`                   | 10093 | 1    |
| `Effect.Effect.Context`           | `Effect.Services`                    | 9911  | 1    |
| `Predicate.isRecord`              | `Predicate.isObject`                 | 13304 | 1    |
| `Context.Tag.Service` (services)  | `Context.Service.Shape<T>`           | 9641  | 1    |

The ports' `Context.Tag` classes are the codemod's (§1). The services phase keeps every port's
name and shape, and reads `layer-memoization.md` before it changes how a layer is built.

## 3. What Effect 4's JSON Schema generator renders differently

phax renders a format's JSON Schema with `Schema.toJsonSchemaDocument`, converted by
`JsonSchema.toDocumentDraft07` (`draft07Document` in `src/schemas/schemaUrl.ts`). It keeps
phax's published form: definitions under `$defs`, and a non-empty array of one schema as
`items` with `minItems`. The table compares that rendering with each format's latest
released snapshot, parsed, annotations aside (`withoutAnnotations` in
`packages/schemas/build/equivalence.ts`). `record-manifest` has no snapshot; it is compared
with its `packages/schemas/shipped-json.json` entry. A path is a JSON Pointer into the
generated schema where the two differ.

**Same contract, every format.** The equivalence judge gives every corpus document the same
verdict under both schemas, for every format and every frozen decoder's released snapshot.
No format records a `next` snapshot, and the package keeps shipping the Effect 3 bytes from
`shipped-json.json`. 7 formats render identically. The other 35 differ in form only:

- **Built-ins inlined.** Effect 3 named its built-in refinements as definitions
  (`$ref: "#/$defs/NonEmptyString"`, `"#/$defs/Int"`). Effect 4 inlines them: `NonEmptyString`
  is `{ "type": "string", "minLength": 1 }`, `Int` is `{ "type": "integer" }` with the safe
  integer bounds. This accounts for nearly every `type`, `minLength`, `maximum` and `$ref`
  path below.
- **Annotated copies of a definition.** A `NonEmptyString` with its own description becomes
  its own definition (`NonEmptyString_1`, …), where Effect 3 inlined it.
- **A filter's fragment that cannot sit on its node goes under `allOf`.** For example, a
  description-only filter on an object, or a key's `annotateKey` beside a node's own
  description.
- **Effect 4 renders the JSON codec.** `Schema.Number` admits `"NaN"`, `"Infinity"` and
  `"-Infinity"` strings and drops its own annotations. An optional value
  (`Schema.optional`, `withDecodingDefaultType`) renders as `anyOf [X, { "type": "null" }]`.
  A record keyed by a non-empty string is `propertyNames` plus `additionalProperties`, not
  `patternProperties: { "": … }`. phax's decoders accept neither the null nor the strings,
  so the generated schema is looser there than the released one. No corpus document
  exercises the difference.
- **`isPattern` exports a pattern only for a `u`-flag RegExp.** phax's patterns keep their
  flags and export their source through `isExportedPattern` (`src/schemas/strictString.ts`),
  as Effect 3 did.
- **The v3 `jsonSchema` annotation is gone.** It became the `toJsonSchema` key on a check.
  A key Effect places under `allOf` but phax states on its node (an answer's `$schema`
  `const`, the config partial's `anyOf`) is an annotation that `draft07Document` copies
  with `includeAnnotationKey`.

| Format | Compared with | Paths that differ |
| ------ | ------------- | ----------------- |
| `registry` | 0.26.0 | 27: `/properties/runs/items/properties/namespace/type`, `/properties/runs/items/properties/namespace/minLength`, `/properties/runs/items/properties/namespace/$ref`, … |
| `run-status` | 0.33.0 | 32: `/properties/namespace/type`, `/properties/namespace/minLength`, `/properties/namespace/$ref`, … |
| `phase-status` | 0.33.0 | 25: `/properties/phaseId/type`, `/properties/phaseId/minLength`, `/properties/phaseId/$ref`, … |
| `phax-plan` | 0.33.0 | identical |
| `compliance-review` | 0.32.0 | identical |
| `plan-approvals` | 0.17.0 | 18: `/properties/records/additionalProperties/properties/planFingerprint/type`, `…/minLength`, `…/$ref`, … |
| `spec-approvals` | 0.17.0 | 12: `/properties/records/additionalProperties/properties/specFingerprint/type`, `…/minLength`, `…/$ref`, … |
| `phase-record-manifest` | 0.34.0 | 43: `/properties/runId/type`, `/properties/runId/minLength`, `/properties/runId/$ref`, … |
| `authoring-record-manifest` | 0.30.0 | 41: `/properties/authoringId/type`, `/properties/authoringId/minLength`, `/properties/authoringId/$ref`, … |
| `gate-attribution` | 0.33.0 | 11: `/properties/phase/type`, `/properties/phase/minLength`, `/properties/phase/$ref`, … |
| `phase-file-reconciliation` | 0.26.0 | 4: `/properties/phaseId/type`, `/properties/phaseId/minLength`, `/properties/phaseId/$ref`, `/$defs` |
| `spec-document` | 0.32.0 | identical |
| `plan-document` | 0.33.0 | 1: `/allOf` |
| `plan-approval-record` | 0.25.0 | 19: `/properties/artifact/type`, `/properties/artifact/minLength`, `/properties/artifact/$ref`, … |
| `spec-approval-record` | 0.25.0 | 13: `/properties/artifact/type`, `/properties/artifact/minLength`, `/properties/artifact/$ref`, … |
| `gate-request` | 0.20.0 | identical |
| `brief-request` | 0.20.0 | 7: `/anyOf/0/properties/files/anyOf/0/items/type`, `…/minLength`, `…/$ref`, … |
| `brief-record` | 0.21.0 | 10: `/properties/request/anyOf/0/properties/files/anyOf/0/items/type`, `…/minLength`, `…/$ref`, … |
| `gate-report` | 0.21.0 | 51: `/anyOf/0/properties/outcome/allOf`, `/anyOf/0/properties/findings/allOf`, `/anyOf/0/properties/findings/items/properties/id/type`, … |
| `brief-report` | 0.21.0 | 46: `/properties/rules/allOf`, `/properties/rules/items/properties/rule/type`, `/properties/rules/items/properties/rule/minLength`, … |
| `hand-decision-answer` | 0.25.0 | 43: `/anyOf/0/properties/decisions/items/properties/verdict/properties/chosen/type`, `…/minLength`, `…/$ref`, … |
| `decision-record-manifest` | 0.34.0 | 278: `/anyOf/0/properties/artifact/type`, `/anyOf/0/properties/artifact/minLength`, `/anyOf/0/properties/artifact/$ref`, … |
| `cost-ledger` | 0.29.0 | 47: `/properties/entries/items/anyOf/0/properties/sessionId/type`, `…/minLength`, `…/$ref`, … |
| `architecture-request` | 0.26.0 | 4: `/properties/files/anyOf/0/items/type`, `…/minLength`, `…/$ref`, `/$defs` |
| `architecture-report` | 0.26.0 | 7: `/properties/parts/items/properties/id/type`, `/properties/parts/items/properties/id/minLength`, `/properties/parts/items/properties/id/$ref`, … |
| the retired request format `acceptance-request` replaced | 0.26.0 | 7: `/anyOf/0/properties/files/items/type`, `/anyOf/0/properties/files/items/minLength`, `/anyOf/0/properties/files/items/$ref`, … |
| `first-reading` | 0.32.0 | 4: `/properties/copiedBy/items/properties/what/$ref`, `…/type`, `…/pattern`, `/$defs/NonEmptyString_1` |
| `interactive-handoff` | 0.32.0 | 14: `/properties/corrections/items/properties/what/$ref`, `…/type`, `…/pattern`, … |
| `interactive-session` | 0.30.0 | 22: `/properties/current/anyOf/0/properties/model/type`, `…/minLength`, `…/$ref`, … |
| `review-stop` | 0.30.0 | 95: `/anyOf/0/properties/phase/properties/title/type`, `…/minLength`, `…/$ref`, … |
| `run-list` | 0.34.0 | 11: `/properties/runs/items/properties/shortName/type`, `…/minLength`, `…/$ref`, … |
| `decide-verdicts` | 0.28.0 | 4: `/properties/verdicts/items/properties/note/anyOf/0/type`, `…/minLength`, `…/$ref`, `/$defs` |
| `review-record-manifest` | 0.29.0 | 4: `/properties/runId/type`, `/properties/runId/minLength`, `/properties/runId/$ref`, `/$defs` |
| `code-review` | 0.32.0 | 11: `/properties/findings/items/properties/file/$ref`, `…/type`, `…/pattern`, … |
| `phax-plan-extraction` | 0.33.0 | identical |
| `spec-hand-decision-answer` | 0.32.0 | 4: `/properties/markdown/$ref`, `/properties/markdown/type`, `/properties/markdown/pattern`, `/$defs/NonEmptyString_1` |
| `plan-hand-decision-answer` | 0.32.0 | 4: `/properties/markdown/$ref`, `/properties/markdown/type`, `/properties/markdown/pattern`, `/$defs/NonEmptyString_1` |
| `acceptance-request` | 0.33.0 | 7: `/anyOf/0/properties/files/items/type`, `/anyOf/0/properties/files/items/minLength`, `/anyOf/0/properties/files/items/$ref`, … |
| `artifact-status` | 0.34.0 | 16: `/properties/authoring/anyOf/1/properties/agreement/anyOf/1/properties/message/type`, `…/minLength`, `…/$ref`, … |
| `plan-overview` | 0.34.0 | identical |
| `plan-lint` | 0.34.0 | identical |
| `record-manifest` | `shipped-json.json` | 3: `/anyOf`, `/$defs/NonEmptyString`, `/$defs/Int` |

The answer schemas phax hands a model (`answerJsonSchema`, in prompts and provider flags) are
the Effect 4 rendering, not the shipped bytes. Each is equivalent to its shipped schema over
the corpus, and each passes the Codex and Claude Code strict check. plan-document keeps one
root description, so that no root `allOf` reaches a provider.
