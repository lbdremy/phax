Write the phax spec `lint-baseline`: every lint suppression in phax's code is one the operator accepted, listed with
its reason in a committed baseline; a directive the baseline does not hold fails the gate, and so does an entry no
directive matches any more. A change to phax's own code and gate only; phax gains no feature.

## Why

A gate passes when the agent fixes the code, or when it switches off what the gate checks. Protected paths close that
door at the configuration (`.oxlintrc.json` is protected since PR #240). One line at a time it stays open:
`// oxlint-disable-next-line <rule>` above an error makes the lint gate pass, and nothing tells the operator a new one
came in. `docs/briefs/suppression-directives.md` (2026-11-18) asks that each directive name its rule and say why; that
makes a directive readable, not accepted. A phase can still write one, with a fine reason, and pass.

`docs/briefs/knip-production.md` (2026-11-20) settles a baseline for knip: its JSON report compared with a committed,
protected file of accepted findings, each with its reason, shrinking only. This brief asks the same of oxlint, so a
new exception to the lint is the operator's decision, made in a file a phase cannot write.

## Measures (main at 473806fb, 2026-11-20, oxlint 1.93.0)

- **The lint today:** `oxlint .` reports 0 diagnostics on 1,509 files and 129 rules, exit 0. `.oxlintrc.json` sets the
  `correctness` and `suspicious` categories to `error` and declares no `warn`.
- **The directives:** 74 comments `oxlint-disable…` or `eslint-disable…` in the tracked `.ts`, `.tsx`, `.mjs` and `.js`
  files: 54 for one line, 20 for a whole file; 18 say why after `--`, 56 say nothing. By rule: 42 `unicorn/no-thenable`, 20
  `no-control-regex`, 10 `no-explicit-any` (under both prefixes), 1 `no-unused-vars`, 1
  `@typescript-eslint/no-unsafe-type-assertion`.
- **The frozen modules:** 20 of them are in `src/schemas/history/`, whose bytes `packages/schemas/history.lock.json`
  pins. They cannot change, so their reason cannot be written next to them.
- **Unused:** `oxlint . --report-unused-disable-directives --format json` reports 9 directives that silence nothing,
  each with severity `warning`, so the run still exits 0.
- **The JSON report:** `--format json` gives `{"diagnostics": [{"code": "eslint(no-debugger)", "severity": …,
  "filename": …, "labels": [{"span": {"line": …, "column": …}}], …}], "number_of_files": …}`. oxlint has no baseline
  or bulk-suppression file of its own, and no option to lint as if the directives were absent.

## Settled (do not reopen)

1. **A baseline, outside oxlint.** A committed file lists the accepted suppressions, each with its reason; a small
   script in phax's scripts compares the code with it, and the gate step fails on anything outside it.
2. **It only shrinks.** An entry that matches nothing in the code fails the step too, until it is removed, so a
   suppression that went away cannot come back unseen.
3. **The baseline is a protected path**, like `.oxlintrc.json`, or the agent adds its own line.
4. **No warning.** Unused directives fail the step (`--report-unused-disable-directives-severity=error`, or the
   script's own check); a report that leaves the gate green is read by no one.
5. **The frozen modules are left alone.** Their directives are entries of the baseline like any other, their reason
   written in the baseline since their bytes cannot change; they are never edited to fit.
6. **The same shape as knip's baseline** (`docs/briefs/knip-production.md`): one format, one way of identifying an
   entry, one way of failing, so an operator reads both the same way.

## What the spec must cover

- **Where an exception lives.** Two ways, the spec says which and why:
  - **The directive stays in the code**, named and reasoned in oxlint's own grammar (`-- why`), and the baseline lists
    the directives allowed: the script reads every directive comment in the linted files and fails on one the
    baseline does not hold, or one with no reason. The reason sits next to the line it excuses; the baseline is the
    operator's permission. This keeps `suppression-directives`'s settled grammar.
  - **No directive in the code**: they are all removed, the script fails on any it finds, and the baseline lists the
    accepted diagnostics of `oxlint --format json`, each with its reason. The code carries no exception, and one
    script serves oxlint and knip alike; the reason sits away from the line.
  The first is the recommendation: a directive excuses one line, where a diagnostic in a baseline excuses a rule in a
  file wherever it fires next.
- **What identifies an entry:** the file, the rule and the kind (one line or the whole file), with a count per file,
  never the line number, which moves with every edit. Say what a count lets through (one fixed, another added in the
  same file for the same rule) and whether that is accepted.
- **The baseline's first content:** the clean-up of `suppression-directives` first (each directive kept with its
  reason or removed, the unused ones gone, the `eslint-disable` spelling replaced), then the baseline written from
  what is left; or today's 74 written as they are and burnt down plan by plan. Say which.
- **Protected paths and order:** `.oxlintrc.json`, the baseline and the workflows are protected, so a phase cannot
  change them. Say which changes the operator makes by hand outside the run, and in what order against the phases.
- **The gate step:** the lint step and the baseline check, one step or two; read as a log or as a `gate-report`, so
  each new directive lands in the fix loop with its file.
- **Acceptance:** the step red on a directive added outside the baseline, on a directive without a reason, on an
  unused directive and on a stale entry, each shown in a test; green on the code as it stands after the clean-up; the
  count of entries by rule, with their reasons, in the plan's last phase.

## Open questions

- **One spec or two.** `suppression-directives` (no spec yet) cleans the directives; this one holds the result. One
  spec can take both, the clean-up as its first phases.
- **One script for knip and oxlint**, or one each sharing a format. Depends on where an exception lives, above.
