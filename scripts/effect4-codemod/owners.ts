// Which topic skill owns the migration of a v3 symbol the codemod leaves: a symbol
// override first (`Effect.catchAll` belongs to errors although `Effect` is core), then
// the symbol's module, then `effect4-core` for every other module.

/** The topic skills a leftover is reported under. */
export type Owner = "effect4-core" | "effect4-errors" | "effect4-schema" | "effect4-services";

/** v3 module to the topic skill that migrates it; a module not listed is core's. */
export const MODULE_OWNERS: ReadonlyMap<string, Owner> = new Map<string, Owner>([
  ["Context", "effect4-services"],
  ["Layer", "effect4-services"],
  ["ManagedRuntime", "effect4-services"],
  ["Runtime", "effect4-services"],
  ["FiberRef", "effect4-services"],
  ["Scope", "effect4-services"],
  ["Either", "effect4-errors"],
  ["Exit", "effect4-errors"],
  ["Cause", "effect4-errors"],
  ["Schema", "effect4-schema"],
  ["ParseResult", "effect4-schema"],
  ["JSONSchema", "effect4-schema"],
  ["SchemaAST", "effect4-schema"],
]);

/** Symbol-level overrides, checked before the module: an exact symbol, or a prefix
 *  ending in `*` (`Effect.catch*` covers `Effect.catchAll`, `Effect.catchTag`, …). */
export const SYMBOL_OWNERS: ReadonlyArray<{ readonly pattern: string; readonly owner: Owner }> = [
  { pattern: "Effect.either", owner: "effect4-errors" },
  { pattern: "Effect.catch*", owner: "effect4-errors" },
  { pattern: "Effect.orElse*", owner: "effect4-errors" },
  { pattern: "Effect.sandbox", owner: "effect4-errors" },
  { pattern: "Data.TaggedError", owner: "effect4-errors" },
  { pattern: "Effect.Service", owner: "effect4-services" },
  { pattern: "Effect.Tag", owner: "effect4-services" },
  { pattern: "Effect.provide*", owner: "effect4-services" },
];

function matches(pattern: string, symbol: string): boolean {
  return pattern.endsWith("*") ? symbol.startsWith(pattern.slice(0, -1)) : symbol === pattern;
}

/** The v3 module a symbol belongs to: `ParseResult` for `ParseResult.ArrayFormatter` and
 *  for `effect/ParseResult`. */
export function moduleOf(v3Symbol: string): string {
  if (v3Symbol.startsWith("effect/")) return v3Symbol.slice("effect/".length).split("/")[0] ?? "";
  return v3Symbol.split(".")[0] ?? "";
}

/** The topic skill that owns a v3 symbol's migration. */
export function ownerOf(v3Symbol: string): Owner {
  const override = SYMBOL_OWNERS.find(({ pattern }) => matches(pattern, v3Symbol));
  if (override !== undefined) return override.owner;
  return MODULE_OWNERS.get(moduleOf(v3Symbol)) ?? "effect4-core";
}
