`lint-baseline`: phax's own lint suppressions each name their rule and say why, the unused ones go,
and every one that stays is listed with its reason in a committed, protected baseline; a directive the baseline does
not hold fails the gate, and so does an entry no directive matches any more. A change to phax's own code and gate only;
phax gains no feature. It also makes the rules the config switches on run: 26 of them, `no-floating-promises` among
them, need oxlint's type-aware mode, which phax's lint never turns on, and none of them has ever run. What they find
goes into the baseline with today's directives; the clean-up of the brief `suppression-directives` (2026-11-18,
archived), which this one takes over, comes after, in plans of its own.

**How it is done** (operator, 2026-11-20): no spec and no plan. Two pull requests made in an interactive session,
one after the other: the first lays the mechanism and the baseline (stage 1), the second does the clean-up (stage 2).
knip and oxlint are never mixed in one pull request. Where this brief says "the spec", read "the first pull request";
"the clean-up plans" are the second.

## Why

A gate passes when the agent fixes the code, or when it switches off what the gate checks. Protected paths close that
door at the configuration (`.oxlintrc.json` is protected since PR #240). One line at a time it stays open:
`// oxlint-disable-next-line <rule>` above an error makes the lint gate pass, and nothing tells the operator a new one
came in. A reader of the linter thread asked whether we fix the root cause or reach for a disable comment. phax's own
code should answer it: every suppression it keeps is one a person can read and agree with, and one the operator
accepted. A directive that names its rule and says why is readable; it is not yet accepted, since a phase can still
write one with a fine reason and pass.

`docs/briefs/knip-production.md` (2026-11-20) settles a baseline for knip: its JSON report compared with a committed,
protected file of accepted findings, each with its reason, shrinking only. This brief asks the same of oxlint, so a
new exception to the lint is the operator's decision, made in a file a phase cannot write.

## Measures (main at 473806fb, 2026-11-20, oxlint 1.93.0)

- **The lint today:** `oxlint .` reports 0 diagnostics on 1,509 files and 129 rules, exit 0. `.oxlintrc.json` sets the
  `correctness` and `suspicious` categories to `error` and declares no `warn`.
- **The directives:** 74 comments in the tracked `.ts`, `.tsx`, `.mjs` and `.js` files, none switching every rule off.
  - **By rule:** 42 `unicorn/no-thenable`, 20 `no-control-regex`, 10 `no-explicit-any` (under both prefixes), 1
    `no-unused-vars`, 1 `@typescript-eslint/no-unsafe-type-assertion`.
  - **By kind:** 54 for one line, 20 for a whole file. Two of the whole-file ones are in product code:
    `src/cli/commandLibrary/contract/command.ts` and `define.ts`, `/* oxlint-disable typescript/no-explicit-any */`.
  - **By prefix:** 48 `eslint-disable…`, 26 `oxlint-disable…`. oxlint reads both; the eslint spelling is a leftover.
  - **Reasons:** 18 say why after `--`; 56 say nothing.
  - **By place:** 23 `src/schemas` (20 of them in `src/schemas/history/`), 22 `tests/integration`, 20 `tests/unit`, 4
    `tests/fixtures`, 2 `src/cli`, 2 `src/domain`, 1 `tests/helpers`.
- **What they are:** most are the rule being wrong, not an escape. `no-thenable` fires on JSON Schema's `then` key in
  test documents, `no-control-regex` on the regexes that strip ANSI colours. The ones that look like escapes are the
  `no-explicit-any`, the two whole-file ones in the command library's contract first.
- **Unused:** `oxlint . --report-unused-disable-directives --format json` reports 9 directives that silence nothing,
  with severity `warning`, so the run still exits 0: 6 in `src/schemas/history/`, `src/schemas/testLine.ts:46`,
  `tests/unit/security/posture.test.ts:538`, `tests/unit/telemetry/composite.test.ts:58`.
- **The frozen modules:** the 20 directives of `src/schemas/history/` are in modules whose bytes
  `packages/schemas/history.lock.json` pins ("Never edit this module"), unused ones included.
- **What oxlint offers:** `--format json` gives `{"diagnostics": [{"code": "eslint(no-debugger)", "severity": …,
  "filename": …, "labels": [{"span": {"line": …, "column": …}}], …}], …}`. oxlint has no baseline or bulk-suppression
  file of its own, and no option to lint as if the directives were absent.
- **Rules that never run.** `.oxlintrc.json` sets `no-floating-promises` to `error`, and the `correctness` and
  `suspicious` categories switch on 25 more rules that need type information (`oxlint --rules --format json`, field
  `type_aware`): `await-thenable`, `no-misused-spread`, `no-unsafe-type-assertion`, `restrict-template-expressions`,
  `unbound-method` and the others of the `typescript/` scope. They run only with `--type-aware`, which needs the
  `oxlint-tsgolint` package; phax's lint is `oxlint .` and the package is not installed. Without the mode oxlint skips
  them and says nothing: a floating promise in a file linted with phax's config gives no diagnostic and exit 0, and
  `--type-aware` stops on "Failed to find type-aware linter executable". The disable comment of
  `@typescript-eslint/no-unsafe-type-assertion` in `tests/unit/telemetry/composite.test.ts` is unused for that reason:
  its rule never runs.

## Settled (do not reopen)

1. **phax's code only.** No phax feature, no `phax.json` key, no record: the type-aware mode, the baseline check and
   the baseline are the whole change.
2. **The tool's own grammar.** A directive names the rules it silences and says why after `--`, oxlint's syntax; the
   `oxlint-disable` spelling everywhere. The directive stays in the code, next to the line it excuses.
3. **A baseline, outside oxlint, is the operator's permission.** A committed file lists the directives allowed, each
   with its reason; a small script in phax's scripts reads every directive comment in the linted files and fails on
   one the baseline does not hold, or one with no reason. A diagnostic baseline with no directive in the code was
   weighed and set aside: an entry there excuses a rule in a file wherever it fires next, where a directive excuses
   one line.
4. **It only shrinks.** An entry that matches nothing in the code fails the step too, until it is removed, so a
   suppression that went away cannot come back unseen.
5. **The baseline is a protected path**, like `.oxlintrc.json`, or the agent adds its own line. A phase that removes a
   directive leaves a stale entry it may not remove itself: that is what `gate-tolerances`
   (`docs/briefs/gate-tolerances.md`) is for, the one writer in a run that may tighten a protected tolerance file.
6. **No warning.** Unused directives fail the step (`--report-unused-disable-directives-severity=error`, or the
   script's own check); a report that leaves the gate green is read by no one.
7. **The frozen modules are left alone.** Their bytes stay as they are, unused directives included; their directives
   are entries of the baseline, their reason written there since it cannot be written next to them.
8. **A rule that is wrong for a whole kind of file** (`no-thenable` on JSON Schema documents) may keep one directive
   per file, with its reason, rather than one per line; it is not switched off in `.oxlintrc.json`.
9. **The same shape as knip's baseline**: one format, one way of identifying an entry, one way of failing, so an
   operator reads both the same way.
10. **Two stages: the baseline first, then the rest.** This spec switches the stricter check on and lays the
    baseline under it, written from every finding of today, so the gate is strict and green the day it lands and
    anything new fails from then on. The clean-up is not in it: plans of their own, one folder or one rule at a time,
    each shrinking the baseline. Until `gate-tolerances` gives a run its own route, the script has a `--prune` command
    that drops the entries nothing matches any more, which the operator runs after such a run, as ESLint's
    `--prune-suppressions` does.

## What the spec must cover

- **What this spec leaves to the clean-up plans** (named, not done), outside `src/schemas/history/`: each directive
  kept with its reason or removed because the code is fixed; the 3 unused ones removed; the `eslint-disable` spelling
  replaced; the two whole-file `no-explicit-any` of `src/cli/commandLibrary/contract/` narrowed to the lines that need
  it, replaced by a type that is not `any`, or kept with a reason that says why no narrower form works; the 8
  `no-explicit-any` in tests, the same question line by line; what the type-aware rules found.
- **The baseline:** where the file lives and its format; what identifies an entry (the file, the rule and the kind,
  one line or the whole file, with a count per file, never the line number, which moves with every edit); what a
  count lets through (one fixed, another added in the same file for the same rule) and whether that is accepted.
- **The first content:** today's 74 directives and what the type-aware rules find, each with the reason it gives in
  the code, or `debt` when it gives none, until a clean-up plan settles it; the script's `--prune`.
- **The unused directives of the frozen modules:** how the step fails on an unused directive while the 6 in
  `src/schemas/history/` cannot go: the frozen modules out of the unused check, or their 6 held by the baseline.
- **Protected paths and order:** `.oxlintrc.json`, the baseline and the workflows are protected, so a phase cannot
  change them. Say which changes the operator makes by hand outside the run, and in what order against the phases,
  until `gate-tolerances` gives a run its own route.
- **The type-aware rules:** the lint runs with `--type-aware` and `oxlint-tsgolint` as a dev dependency, at a version
  that matches the TypeScript the project pins (7.x); what the 26 rules find on today's code, counted by rule and held
  by the baseline; the time the mode adds to a gate step that fires at every phase.
- **Every rule switched on runs:** a check, in the lint step or beside it, that fails when a rule the config enables
  cannot run (a type-aware rule without the mode, a plugin not loaded), so a rule set to `error` is never silently
  skipped again. For instance, one sample per enabled rule that breaks it, linted in a test that expects the error.
- **The gate step:** the lint and the baseline check, one step or two; read as a log or as a `gate-report`, so each new
  directive lands in the fix loop with its file.
- **Acceptance:** the step red on a directive added outside the baseline, on a directive without a reason, on an
  unused directive, on a stale entry and on a new floating promise, each shown in a test, and `--prune` shown removing
  a stale entry; green on today's code with the baseline in place; the count of entries by rule and by reason in the
  plan's last phase.

## Open questions

- **One script for knip and oxlint**, or one each sharing a format.
