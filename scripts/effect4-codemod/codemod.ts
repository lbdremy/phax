// The Effect 4 codemod's core: reads the given files and returns each one's text before
// and after the rules in `rules.ts` ran, without writing anything. A rewrite replaces
// only the matched node's text span; every other byte of the file stays as it was.
// An identifier is Effect's when its import binding, followed through local
// re-exports, ends at the module `effect` or `effect/…`. A use of an Effect symbol that
// the reference lists and no rule rewrites is a leftover, reported under the topic
// skill that owns it.
//
// A stub until the codemod exists: it throws, so the acceptance tests under
// tests/unit/effect4Codemod/ fail recognizably.

/** What one run answers: every requested file, and the Effect symbols no rule rewrote. */
export type CodemodResult = {
  /** One entry per requested file, in request order; `path` is the repo-relative path as
   *  given, `rewrites` counts the rewrites per rule id. */
  files: Array<{ path: string; before: string; after: string; rewrites: Record<string, number> }>;
  /** One entry per use: `line` is 1-based in the file as read, `referenceLine` is the
   *  v3-to-v4.md line of the symbol's entry (null when it has none), `owner` the topic
   *  skill (`effect4-core`, `effect4-errors`, `effect4-schema` or `effect4-services`). */
  leftovers: Array<{
    path: string;
    line: number;
    v3Symbol: string;
    referenceLine: number | null;
    owner: string;
  }>;
};

/** Rewrites `files` (paths relative to `root`) in memory and reports what is left. */
export function rewriteFiles(_options: {
  root: string;
  files: ReadonlyArray<string>;
}): CodemodResult {
  throw new Error("effect4 codemod: not implemented");
}
