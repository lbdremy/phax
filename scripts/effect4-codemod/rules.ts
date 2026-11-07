// The Effect 4 codemod's rules: each one rewrites a family of Effect 3 symbols to the
// Effect 4 form the vendored reference gives. A mapping names the v3 symbol a rule
// rewrites and the line of
// docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md that holds its entry
// (`- `<v3Symbol>` -> …` or `#### `<v3Symbol>``), so a reader checks a rewrite against
// the line it cites.
//
// The table is empty until the codemod exists; tests/unit/effect4Codemod/ holds what it
// must hold.

/** One v3 symbol a rule rewrites, and the reference line of its entry. */
export type RuleMapping = { readonly v3Symbol: string; readonly line: number };

/** A rewrite family: its id (a fixture directory name) and the v3 symbols it rewrites. */
export type Rule = { readonly id: string; readonly mappings: ReadonlyArray<RuleMapping> };

export const RULES: ReadonlyArray<Rule> = [];
