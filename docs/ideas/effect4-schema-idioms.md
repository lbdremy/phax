# Idea: Effect 4's schema idioms, after the upstream correction

> Status: **brainstorm**. Captured 2026-11-11, after Effect's maintainers merged our migration
> guide PR ([Effect-TS/effect#10525](https://github.com/Effect-TS/effect/pull/10525)) with
> their own corrections
> ([88477dc](https://github.com/Effect-TS/effect/commit/88477dc7060ae410e68b4f6045c9bcce186e7d15)).
> Not a spec, not a plan. Nothing below is committed. Related:
> [`effect4-migration-article.md`](./effect4-migration-article.md).

## What the maintainers corrected

Our PR documented the `parseOptions` annotation v4 removed and the JSON Schema output changes.
The merge changed three of our statements in `migration/schema.md`:

1. **Only two parse options remain.** We wrote "pass the options to the decoder" for all four
   v3 options. v4 keeps `onExcessProperty` and `errors`; `exact` and `propertyOrder` are gone
   ("model required and optional keys in the schema itself; output key order is unspecified").
   phax uses neither, so nothing to change.
2. **Not the `StructWithRest` recipe.** We suggested closing one struct inside a lenient parse
   with `Schema.StructWithRest` and a record whose values are `Schema.Never`. They removed it and
   recommend decoding that struct's raw input separately with `{ onExcessProperty: "error" }`,
   before a surrounding parse strips the extra keys. Our recipe was wrong as written: on Effect
   4.1.2, `StructWithRest(Struct({ x: String }), [Record(String, Never)])` refuses `{ x: "a" }`,
   because the record's `String` key matches the declared `x` too.
3. **Named definitions did not go away.** We wrote that v4 "no longer moves identified schemas
   into `$defs`". A schema annotated with an `identifier` still gets a named definition and a
   `$ref`; only Effect's built-ins (`NonEmptyString`, `Int`) lost their `identifier`, so they
   render inline. The document keeps the definitions in `definitions`, and the root refers to
   them through `#/$defs/...`.

Point 3 made one line of the 0.36.0 upgrading note too broad ("shared definitions are written
inline"): it holds for the editor schemas and `decide-verdicts`, built on Effect's
`NonEmptyString`, not for the answer and artifact schemas, built on phax's own
(`src/schemas/strictString.ts`, `identifier: "NonEmptyString"`), whose `$defs` are unchanged
(57 `$ref`s in `phax artifact schema spec`, 50 in `plan`, before and after). Fixed in
`docs/upgrading.md`.

## Candidate: the closed stop

`closed()` in `src/schemas/status.ts` (29 lines, from #198's review, 561a22cd) keeps a phase
status's `stop` refusing unknown keys while the rest of `status.json` ignores them, which v3 did
with the `parseOptions` annotation. It is the careful form of the recipe the maintainers dropped:
a key schema that excludes the declared names, a `Never` rest with a refusal override, a
`propertyNames` check so the JSON Schema stays closed, and `decodeTo(... passthrough)` to keep
the decoded type. It works and is tested, but it is ours to keep working across Effect upgrades,
on a route Effect chose not to recommend.

Question: how should `stop` refuse unknown keys?

- **Close the whole file** (`onExcessProperty: "error"` on `decodePhaseStatusFile` and
  `decodeRunStatusFile`, as 14 other schema modules already decode) — abandons: tolerance of
  unknown keys in `status.json` and `run-status.json`, whose reason no comment states (they only
  say "Unknown keys are ignored").
- **Decode `stop` separately**, the maintainers' route — abandons: one decode per file (two
  passes, the second's refusal re-rooted at `stop`), and the JSON Schema's closed `stop`, since
  the generator's option is per document.
- **Keep `closed()`** — abandons: nothing today; we carry a pattern upstream does not support.

Leaning: close the whole file, if nothing legitimate writes extra keys into a status file (to
check: an older or newer phax within one release, a person's hand edit, the desktop app). The
frozen `phase-status/0.26.0` module keeps its own copy either way.

## Checked, nothing to do

- **Two `NonEmptyString`s.** phax's (a `pattern`, in `$defs`) is for answer schemas a provider
  fills, because Codex's strict output documents no `minLength`; Effect's (`minLength`, inline)
  serves the config and `decide-verdicts`, which people write. The two renderings follow that
  rule.
- **Definitions.** `src/cli/commandLibrary/contract/catalogue.ts` and `draft07Document` in
  `src/schemas/schemaUrl.ts` already read `document.definitions` beside `document.schema`, as
  the corrected guide describes.
