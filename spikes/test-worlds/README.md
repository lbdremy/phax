# test-worlds measures

Measuring script for the spec `test-worlds-built-once` (§5.11, §5.12): it times the whole
suite and compares two runs test by test.

## Modes

Run the whole suite through vitest's own binary (JSON reporter, what `pnpm test` runs) and
write a report:

```
node spikes/test-worlds/measure.mjs run --out spikes/test-worlds/after.tsv
```

Compare two reports. Prints the §6-shaped measures and exits 1 on a missing, failing, newly
skipped or unexpected new test, or on a cached world left behind:

```
node spikes/test-worlds/measure.mjs compare spikes/test-worlds/before.tsv spikes/test-worlds/after.tsv \
  --allow-new tests/integration/worldCache.test.ts
```

`--allow-new <repo-relative test file>` (repeatable) names files whose new tests are expected.

## Report format

Tab-separated, one record per line, sorted, paths relative to the repository root:

- `M<TAB>key<TAB>value` — `wall-seconds`, `cores`, `vitest`, `commit`, `node`, `world-cache-left`.
- `F<TAB>file<TAB>project<TAB>seconds` — one per test file; project is `unit` or `integration`.
- `T<TAB>file<TAB>project<TAB>full name<TAB>state<TAB>duration ms` — one per test.

## Result

The before report has been removed; its numbers, the three after runs and the comparison
are in `measures.md`. The script stays. `run` puts `node_modules/.bin` on `PATH` as `pnpm`
does, and `compare` also reports a new test that fails.
