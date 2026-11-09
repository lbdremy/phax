# Effect 3 → Effect 4: what maps to what in phax

A reading aid for the Effect 4 migration (spec `effect-4-migration`). It shows how the Effect 3
symbols phax uses translate to Effect 4, which of them the codemod rewrites and which it leaves to
the topic-skill phases. It is a snapshot, not a source of truth: the rule table is
`scripts/effect4-codemod/rules.ts`, the owners are `scripts/effect4-codemod/owners.ts`, every target
is read from `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md` at the line cited, and
`pnpm codemod:effect4 --check` prints the current list. It goes with the codemod and the reference
when the migration's last plan removes them.

The counts below come from one trial run of the codemod on this branch (commit `b897913c`, still on
Effect 3), discarded afterwards: **613 files would change, 4,213 rewrites; 2,097 uses are left to
the phases.** The type-error counts it printed (0 → 1,901 in `src`, 0 → 3,394 in tests) only say
that Effect 3 has no `Result` or `Context.Service`; the counts that matter are the ones the first
Effect 4 phase records.

## 1. What the codemod rewrites

| Rule                   | Effect 3                                              | Effect 4                                | `v3-to-v4.md` | Rewrites |
| ---------------------- | ----------------------------------------------------- | --------------------------------------- | ------------- | -------- |
| `either-to-result`     | `effect/Either` (the import)                          | `effect/Result`                         | 689           | 3,437 (393 files) |
|                        | `Either.Either<A, E>`                                 | `Result.Result<A, E>`                   | 10395         |          |
|                        | `Either.right(a)`                                     | `Result.succeed(a)`                     | 10459         |          |
|                        | `Either.left(e)`                                      | `Result.fail(e)`                        | 10449         |          |
|                        | `Either.isRight` / `Either.isLeft`                    | `Result.isSuccess` / `Result.isFailure` | 10447 / 10445 |          |
|                        | `Either.map` / `Either.mapLeft`                       | `Result.map` / `Result.mapError`        | 10453 / 10455 |          |
|                        | `Either.getOrElse`                                    | `Result.getOrElse`                      | 10433         |          |
|                        | `Either.match(x, { onLeft, onRight })`                | `Result.match(x, { onFailure, onSuccess })` | 10457     |          |
| `effect-either`        | `Effect.either`                                       | `Effect.result`                         | 10057         | 394 (179 files) |
| `schema-decode-either` | `Schema.decodeEither`, `Schema.decodeUnknownEither`   | `Schema.decodeUnknownResult`            | 14950, 14954  | 204 (150 files) |
|                        | `Schema.encodeEither`, `Schema.encodeUnknownEither`   | `Schema.encodeUnknownResult`            | 14970, 14974  |          |
|                        | `ParseResult.decodeUnknownEither`                     | `Schema.decodeUnknownResult`            | 13130         |          |
| `context-tag`          | `Context.Tag("id")<Self, Shape>()`                    | `Context.Service<Self, Shape>()("id")`  | 9639          | 11 (11 files) |
|                        | `Context.GenericTag<Shape>("id")`                     | `Context.Service<Shape>("id")`          | 9629          |          |
| `schema-filters`       | `X.pipe(Schema.filter(predicate))`                    | `X.check(Schema.makeFilter(predicate))` | 14992         | 2 (1 file) |
| `schema-optional-with` | `Schema.optionalWith(s, { exact: true })`             | `Schema.optionalKey(s)`                 | 15118         | 122 (52 files) |
| `catch-all`            | `Effect.catchAll` / `Effect.orElse`                   | `Effect.catch`                          | 10003 / 10189 | 43 (24 files) |
| `parse-result-issues`  | `effect/ParseResult`, `Missing`, `ParseIssue`, `Type`, `Unexpected` | `effect/SchemaIssue`, `MissingKey`, `Issue`, `InvalidType`, `UnexpectedKey` | 720, 13088–13120 | 0 (see below) |

Real rewrites from the trial run:

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

## 2. What the codemod leaves to the phases (2,097 uses)

Each leftover is reported under the topic skill that owns its module
(`.claude/skills/effect4-*`), with the reference line a phase reads before changing it.

| Skill              | Uses  | In `src` / `tests` / `packages` |
| ------------------ | ----- | ------------------------------- |
| `effect4-errors`   | 1,375 | 283 / 1,092 / 0                 |
| `effect4-schema`   | 690   | 619 / 56 / 15                   |
| `effect4-core`     | 31    | 24 / 7 / 0                      |
| `effect4-services` | 1     | 0 / 1 / 0                       |

### Blocked uses: a covered symbol held back by an uncovered neighbour

1,045 leftovers are symbols the codemod covers (`Either.isLeft`, `Either.right`, …) in a file that
also uses an `Either` member no rule covers. The codemod cannot rename the `Either` import while
something still needs it, so it leaves the whole file's `Either` uses and names the blocker. Once a
phase migrates the blocker, re-running `pnpm codemod:effect4` rewrites the rest.

| Blocker                 | Uses it blocks | Why no rule covers it (reference line)                                                  |
| ----------------------- | -------------- | --------------------------------------------------------------------------------------- |
| `Either.getOrThrow`     | 738            | → `Result.getOrThrow`, but v4 throws the raw failure value, not an `Error` (10435)       |
| `Either.flatMap`        | 233            | the reference says `TODO: needs guidance` (10423)                                       |
| `Either.Left`           | 35             | → `Result.Failure`, and `.left` becomes `.failure` on the value (10407)                 |
| `Either.getOrNull`      | 28             | no entry in the reference                                                               |
| `Either.getOrUndefined`, `getOrThrowWith`, `flip` | 10 | → `Result.getOrUndefined`, `getOrThrowWith`, `flip` (10439, 10437, 10425) |
| `ParseResult.ParseError` | 1              | no stated target (13090); the schema phase's                                            |

### `effect4-errors`: `Either`, `Exit`, `Cause`, `Effect.catch*`

| Effect 3                     | Effect 4                       | Line  | Uses |
| ---------------------------- | ------------------------------ | ----- | ---- |
| `Either.getOrThrow`          | `Result.getOrThrow`            | 10435 | 299  |
| `Either.flatMap`             | (no stated target)             | 10423 | 6    |
| `Either.getOrNull`           | (no entry)                     | –     | 5    |
| `Effect.catchAllCause`       | `Effect.catchCause`            | 10005 | 5    |
| `Either.flip`                | `Result.flip`                  | 10425 | 4    |
| `Exit.isInterrupted`         | `Exit.hasInterrupts`           | 10601 | 3    |
| `Cause.failureOption`        | `Cause.findErrorOption`        | 9137  | 3    |
| `Either.Left`                | `Result.Failure`               | 10407 | 3    |
| `Either.getOrUndefined`      | `Result.getOrUndefined`        | 10439 | 2    |
| `Either.getOrThrowWith`      | `Result.getOrThrowWith`        | 10437 | 1    |
| blocked covered `Either.*`   | as in §1                       |       | 1,044 |

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
