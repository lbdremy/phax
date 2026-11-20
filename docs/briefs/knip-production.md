Write the phax spec `knip-production`: phax's dead-code gate sees the code that only tests use and the exports that
nothing uses, because knip starts from what phax runs and also runs in production mode; what it finds today goes into a
baseline, and the clean-up that empties it comes after, in plans of its own. A change to phax's own code and gate only;
phax gains no feature.

## Why

`pnpm knip` is a gate step that fires at every phase (`phax.json`, profile `standard`, surface `structural`). It is
there so an agent that rewrites a function deletes the old one before anyone sees it. A reader of the dead-code thread
asked whether knip flags an export whose only importer is its own test: the leftover that full coverage lets through,
since the test keeps it covered and keeps it imported. By default it does not. The test imports it, so knip counts it as
used. `knip --production` leaves the tests out, and the export shows up.

Measuring that question showed a second gap, wider than the first. `knip.json` declares every file of `src/schemas`,
`src/domain`, `src/ports`, `src/infra`, `src/infra/fakes` and `src/app` as an entry, and knip never reports what an
entry file exports. Most of phax's exports are therefore outside what the gate checks.

## Measures (main at 15ecb21c, 2026-11-20, knip 6.45)

- **Today's gate step, `pnpm knip`:** exit 0, one configuration hint. It is green because it finds nothing to report,
  not because its findings are warnings: the entries hide the exports.
Each run used a temporary config next to `knip.json`, removed afterwards. Only the `entry` and `project` keys changed.

- **Today's config, `--production`:** 5 unused dependencies, nothing else. No pattern carries the `!` suffix, so the
  production run has no file of `src/` to read.
- **Entries reduced to what runs, tests included** (default mode; `src/cli/main.ts` in place of the six `src/*` globs,
  the other entries kept): 1 unused file (`src/infra/fakes/index.ts`), **123 unused exports and 108 unused exported
  types** that no file uses, tests and scripts included. By folder: `src/schemas` 134, `src/domain` 49, `src/app` 42,
  `src/ports` 4, `src/infra` 2. The most: `src/domain/events.ts` (24), `src/schemas/phaxConfig.ts` (14),
  `src/domain/effects.ts` (14), `src/schemas/complianceReview.ts` (10).
- **Production, entries `src/cli/main.ts!` and `packages/schemas/src/index.ts!`, project `src/**/*.ts!` and
  `packages/schemas/src/**/*.ts!`:** 21 unused files, 1 unused dependency, 345 unused exports, 215 unused exported
  types. Beyond the 231 above, that is **222 exports and 107 types used only outside the product** (tests, scripts, the
  site): `src/domain` 125, `src/cli` 71, `src/app` 60, `src/schemas` 51, `src/infra` 12, `packages/schemas` 7,
  `src/ports` 3. The most: `src/domain/state.ts` (20), `src/cli/commandLibrary/contract/index.ts` (19),
  `src/domain/events.ts` (13), `src/app/resume.ts` (10).
- **The 21 files:** 12 test fakes (`src/infra/fakes/`) and 5 files of the command library's conformance suite
  (`src/cli/commandLibrary/contract/conformance/`, `conformanceReport.ts`), test support kept in `src/`; and 4 product
  files only their tests import: `src/app/eventAdapter.ts` (232 lines), `src/app/finalReview.ts` (44),
  `src/schemas/telemetryEvents.ts` (150) and `src/domain/matrix.ts` (423, the audit matrix the reducer's tests read,
  there on purpose).
- **The dependency:** `mdast-util-to-string` ships in `dependencies`, but `src/` no longer imports it
  (`src/domain/plan/nodeText.ts` names it in a comment only); the tests, the site and the scripts do.
- **`--strict`** found exactly the same: the repository is one workspace, so it has nothing to isolate. It also counts
  required peer dependencies and tells a type exposed to consumers from a type used in development.

## Settled (do not reopen)

1. **Entries are what runs.** The CLI's entry, the published package's entry, the scripts, the site and the tests; not
   every file of a folder. Exports of a library-like module are checked like any other.
2. **Two knip steps in the gate:** `knip --production --strict`, which sees in the product's code what nothing uses
   and what only tests, scripts or the site use; and the default run, which still sees the rest of the repository
   (dead code in the tests, the scripts and the site, unused dev dependencies). Both fire where `pnpm knip` fires
   today.
3. **A kept export says why.** One that stays though knip reports it (test support, the audit matrix, a schema
   published for consumers) is kept with its reason next to it, never by switching a rule off: in the baseline (item
   6), or through knip's own means where they fit better (a `!` pattern for a whole file of test support, a tag such
   as `// @internal` before a declaration, which knip reads in a plain line comment too).
4. **Nothing is removed blind.** An export goes when nothing that ships, builds or documents phax needs it; a
   module's public surface that phax publishes stays.
5. **No warning: a finding fails the gate.** A gate is red or green, and green means nothing to fix; a report that
   leaves it green is read by no one. Every issue type knip checks is already `error` (knip's default); what still
   reports without failing are the configuration hints (today one: `esbuild` in `ignoreDependencies` is redundant),
   so `treatConfigHintsAsErrors: true` goes in `knip.json`. phax's lint already holds to it: `.oxlintrc.json` sets
   its categories to `error` and declares no `warn`.
6. **A baseline, outside knip, for what is accepted.** knip has no baseline of its own (its guide stages adoption
   with `warn` rules, which item 5 refuses, or a `--max-issues` budget, a count that lets a new finding replace a
   fixed one). phax keeps one: knip's JSON report (`--reporter json`) goes through a small script that compares it
   with a committed baseline file and fails on any finding the file does not hold. Each entry says why it is
   accepted. The baseline only shrinks: an entry that knip no longer reports fails the gate too, until it is removed,
   so a fixed finding cannot come back unseen. The baseline file is a protected path, or the agent adds its own line;
   a phase that fixes a finding leaves a stale entry it may not remove itself, which is what `gate-tolerances`
   (`docs/briefs/gate-tolerances.md`) is for. oxlint's suppressions get a baseline of the same shape
   (`docs/briefs/lint-baseline.md`).
7. **Two stages: the baseline first, then the rest.** This spec switches the stricter check on and lays the
   baseline under it, written from every finding of today, so the gate is strict and green the day it lands and
   anything new fails from then on. The clean-up is not in it: plans of their own, one folder or one rule at a time,
   each shrinking the baseline. Until `gate-tolerances` gives a run its own route, the script has a `--prune` command
   that drops the entries nothing matches any more, which the operator runs after such a run, as ESLint's
   `--prune-suppressions` does.

## What the spec must cover

- **The new `knip.json`:** its entries, its production patterns, and where the test support lives (the fakes and the
  conformance suite left in `src/` and excluded from production, or moved out of `src/`). Say which, and why.
- **The audit matrix, the worked case** (tried on the same main, 2026-11-20). A negated production pattern in
  `project`, `"!src/domain/matrix.ts!"`, takes the file out of the production run, as knip's documentation does for
  test helpers, and the default run still checks it; knip reads `knip.json` with comments, so the reason sits on the
  line above. `ignoreFiles` with the `!` suffix did not take it out. Two types of `src/domain/disposition.ts` that only
  the matrix uses, `DispositionKind` and `EventDispositionMatrix`, are then still reported: moved into `matrix.ts`
  with it, or tagged `/** @internal */` with their reason. The five interfaces above them (`Handled` … `Unexpected`),
  used only in their own file, lose their `export`.
- **What ships besides the CLI:** `packages/schemas` and the JSON schemas `scripts/schemas-json.ts` builds from
  `src/schemas` (so a schema that only the build reads is not dead), the usage spec and the model catalog the scripts
  generate. Say how each is kept out of the production findings, or counted as production.
- **What this spec leaves to the clean-up plans** (named, not done): each unused file, export and type removed or kept
  with its reason; the 4 product files first; `mdast-util-to-string` moved to `devDependencies`; an export only its
  own file uses loses its `export`. The audit matrix above is the worked case those plans follow.
- **The baseline:** where the file lives and its format; what identifies a finding (the file, the issue type and the
  symbol's name, never the line, which moves with every edit); the reason each entry carries; the script that
  compares, in phax's own scripts, and whether the gate step reads its result as a log or as a `gate-report`, so each
  new finding lands in the fix loop with its file. knip's JSON is one object per file, `{"issues": [{"file": …,
  "exports": [{"name": …, "line": …}], "types": […], "files": […], "dependencies": […], …}]}` (knip 6.45, 233 files
  in the production run). Its first content is every finding of today (item 7), each with the reason `debt` until a
  clean-up plan settles it; the script's `--prune`.
- **Protected paths:** `knip.json` and `.github/workflows/**` are protected, so a phase cannot change them. Say which
  changes the operator makes by hand outside the run (the new `knip.json`, the second gate step) and in what order
  against the phases, so the gate is never red on code a phase was not allowed to fix.
- **Acceptance:** both knip runs green on today's code with the baseline in place; a new finding and a stale entry
  each shown failing the step, and `--prune` shown removing the stale entry; the baseline's count by issue type and
  folder in the plan's last phase; the full suite and `pnpm typecheck` green.

## Open questions

- **One step or two.** On the product's code the production run sees everything the default run sees (the 345 exports
  hold the 123); the default run adds the tests, the scripts, the site and the dev dependencies. Two steps cost two
  runs per phase; whether one is enough is for the spec to measure.
- **Dead, or used only by tests** (for the clean-up plans). The two are reported alike in production. The 123 go with
  nothing else; the 222 go with the tests that hold them, which changes what the suite checks. Whether the plan removes
  those tests, or keeps some exports as test support with their reason, is the operator's to decide, export by export or
  by folder.
- **The order of the clean-up plans.** About 460 exports and types in all: one plan per folder, `src/schemas` first,
  or by kind of finding, the unused files first.
