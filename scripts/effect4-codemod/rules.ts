// The Effect 4 codemod's rules: each one rewrites a family of Effect 3 symbols to the
// Effect 4 form the vendored reference gives. A mapping names the v3 symbol a rule
// rewrites and the line of
// docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md that holds its entry
// (`- `<v3Symbol>` -> …` or `#### `<v3Symbol>``), so a reader checks a rewrite against
// the line it cites.
//
// A mapping's `form` says which call shape the codemod rewrites; a use of the symbol in
// any other shape is left and reported. Every form renames the member; some also change
// the call around it:
// - `rename`: only the member changes (`Either.right` -> `Result.succeed`), anywhere.
// - `match-handlers`: a call whose last argument is an object literal of `onLeft` and
//   `onRight` handlers; the handlers become `onFailure` and `onSuccess` (line 10457).
// - `tag-class`: `Context.Tag("id")<Self, Shape>()` with a string id becomes
//   `Context.Service<Self, Shape>()("id")` (services.md, line 9639).
// - `generic-tag`: `Context.GenericTag<Shape>("id")`, one type argument and one argument.
// - `pipe-filter`: `X.pipe(Schema.filter(predicate))` with that one pipe argument, one
//   filter argument and no type-guard predicate becomes
//   `X.check(Schema.makeFilter(predicate))` (schema.md `### filter`).
// - `optional-exact`: `Schema.optionalWith(s, { exact: true })` becomes
//   `Schema.optionalKey(s)`; every other option set needs judgment.
// - `module`: the module itself (`effect/Either` -> `effect/Result`): the import binding
//   follows its uses once every use is rewritten, and a re-export of the module from the
//   barrel is renamed with it.

/** How a mapping's uses are rewritten (see the file comment). */
export type RewriteForm =
  | "rename"
  | "match-handlers"
  | "tag-class"
  | "generic-tag"
  | "pipe-filter"
  | "optional-exact"
  | "module";

/** One v3 symbol a rule rewrites, the reference line of its entry, and its v4 target:
 *  `Module.member` for a member, `effect/Module` for a module. */
export type RuleMapping = {
  readonly v3Symbol: string;
  readonly line: number;
  readonly target: string;
  readonly form: RewriteForm;
};

/** A rewrite family: its id (a fixture directory name) and the v3 symbols it rewrites. */
export type Rule = { readonly id: string; readonly mappings: ReadonlyArray<RuleMapping> };

const rename = (v3Symbol: string, line: number, target: string): RuleMapping => ({
  v3Symbol,
  line,
  target,
  form: "rename",
});

export const RULES: ReadonlyArray<Rule> = [
  {
    id: "either-to-result",
    mappings: [
      { v3Symbol: "effect/Either", line: 689, target: "effect/Result", form: "module" },
      rename("Either.Either", 10395, "Result.Result"),
      rename("Either.getOrElse", 10433, "Result.getOrElse"),
      // On a failure v4 throws the failure value itself where v3 threw an `Error`; phax only
      // unwraps values that cannot fail (a constant, a test's expected success), so no caller
      // sees the difference (operator decision 2026-11-09, reviewing #195).
      rename("Either.getOrThrow", 10435, "Result.getOrThrow"),
      rename("Either.isLeft", 10445, "Result.isFailure"),
      rename("Either.isRight", 10447, "Result.isSuccess"),
      rename("Either.left", 10449, "Result.fail"),
      rename("Either.map", 10453, "Result.map"),
      rename("Either.mapLeft", 10455, "Result.mapError"),
      { v3Symbol: "Either.match", line: 10457, target: "Result.match", form: "match-handlers" },
      rename("Either.right", 10459, "Result.succeed"),
    ],
  },
  {
    id: "effect-either",
    mappings: [rename("Effect.either", 10057, "Effect.result")],
  },
  // The reference maps these to the `Exit` decoders, but the same pass rewrites every
  // `Either` consumer to `Result`, and an `Exit` is not a `Result`. effect@4.1.2 ships
  // `Schema.decodeUnknownResult` and `Schema.encodeUnknownResult` (dist/Schema.d.ts:1402,
  // :1761), which return a `Result` and take any input, so the typed variants map onto them
  // too. Cited by the v3 entry's line; the target is read from the v4 source, as the lookup
  // skill's step 3 allows (operator decision 2026-11-08, reviewing #195).
  {
    id: "schema-decode-either",
    mappings: [
      rename("Schema.decodeEither", 14950, "Schema.decodeUnknownResult"),
      rename("Schema.decodeUnknownEither", 14954, "Schema.decodeUnknownResult"),
      rename("Schema.encodeEither", 14970, "Schema.encodeUnknownResult"),
      rename("Schema.encodeUnknownEither", 14974, "Schema.encodeUnknownResult"),
      rename("ParseResult.decodeUnknownEither", 13130, "Schema.decodeUnknownResult"),
    ],
  },
  {
    id: "context-tag",
    mappings: [
      { v3Symbol: "Context.Tag", line: 9639, target: "Context.Service", form: "tag-class" },
      {
        v3Symbol: "Context.GenericTag",
        line: 9629,
        target: "Context.Service",
        form: "generic-tag",
      },
    ],
  },
  {
    id: "schema-filters",
    mappings: [
      { v3Symbol: "Schema.filter", line: 14992, target: "Schema.makeFilter", form: "pipe-filter" },
    ],
  },
  {
    id: "schema-optional-with",
    mappings: [
      {
        v3Symbol: "Schema.optionalWith",
        line: 15118,
        target: "Schema.optionalKey",
        form: "optional-exact",
      },
    ],
  },
  {
    id: "catch-all",
    mappings: [
      rename("Effect.catchAll", 10003, "Effect.catch"),
      rename("Effect.orElse", 10189, "Effect.catch"),
    ],
  },
  // Rewrites nothing in phax today: every ParseResult binding here also uses ParseError or
  // ArrayFormatter, which no rule covers, so the binding stays for the schema phase. Its
  // `ParseResult.Type` -> `SchemaIssue.InvalidType` mapping renames a class whose constructor
  // changes too (`actual` becomes an `Option`), which the type errors then surface.
  {
    id: "parse-result-issues",
    mappings: [
      {
        v3Symbol: "effect/ParseResult",
        line: 720,
        target: "effect/SchemaIssue",
        form: "module",
      },
      rename("ParseResult.Missing", 13088, "SchemaIssue.MissingKey"),
      rename("ParseResult.ParseIssue", 13094, "SchemaIssue.Issue"),
      rename("ParseResult.Type", 13118, "SchemaIssue.InvalidType"),
      rename("ParseResult.Unexpected", 13120, "SchemaIssue.UnexpectedKey"),
    ],
  },
];
