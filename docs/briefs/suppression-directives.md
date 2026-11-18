Write the phax spec `suppression-directives`: phax's own lint suppressions each name their rule and say why, the unused
ones go, and the two that switch a type check off for a whole file of product code are narrowed or explained. A
clean-up of phax's code only; phax gains no mechanism.

## Why

A gate passes when the agent fixes the code, or when it switches off what the gate checks. Protected paths close that
door at the configuration (phax's `phax.json` protects the configs its gates read since PR #240, 2026-11-18). One line
at a time it stays open: `// oxlint-disable-next-line <rule>` above an error makes the lint gate pass. A reader of the
linter thread asked whether we fix the root cause or reach for a disable comment. phax's own code should answer it:
every suppression it keeps is one a person can read and agree with.

## Audit of phax's own directives (main at 8856140, 2026-11-18)

75 directives, in `.ts` files only:

- **By rule:** 42 `unicorn/no-thenable`, 20 `no-control-regex`, 11 `no-explicit-any` (9 under `typescript/`, 2 under
  `@typescript-eslint/`), 1 `no-unused-vars`, 1 `@typescript-eslint/no-unsafe-type-assertion`. None switches every rule
  off; each names its rule.
- **By kind:** 55 for one line (`-next-line`, `-line`), 20 for a whole file (17 `unicorn/no-thenable`, 3
  `no-explicit-any`). Two of the whole-file ones are in product code: `src/cli/commandLibrary/contract/command.ts` and
  `define.ts`, `/* oxlint-disable typescript/no-explicit-any */`.
- **By prefix:** 48 `eslint-disable…`, 27 `oxlint-disable…`. oxlint reads both; the eslint spelling is a leftover.
- **Reasons:** 18 say why after `--`; 57 say nothing.
- **Unused:** `oxlint --report-unused-disable-directives` (oxlint 1.93.0) reports 9 that silence nothing: 6 in
  `src/schemas/history/`, `src/schemas/testLine.ts:46`, `tests/unit/security/posture.test.ts:538` and
  `tests/unit/telemetry/composite.test.ts:58`.
- **By place:** 22 `tests/integration`, 20 `tests/unit`, 20 `src/schemas/history`, 5 `tests/fixtures`, 3
  `src/schemas`, 2 `src/cli`, 2 `src/domain`, 1 `tests/helpers`.
- **What they are:** most are the rule being wrong, not an escape: `no-thenable` fires on JSON Schema's `then` key in
  test documents, `no-control-regex` on the regexes that strip ANSI colours. The ones that look like escapes are the
  `no-explicit-any`, the two whole-file ones in the command library's contract first.
- **Frozen bytes:** the 20 under `src/schemas/history/` are in frozen modules whose bytes
  `packages/schemas/history.lock.json` pins ("Never edit this module"). They stay as they are, unused ones included.

## Settled (do not reopen)

1. **phax's code only.** No phax feature, no `phax.json` key, no record: the clean-up is the whole change.
2. **The tool's own grammar.** A directive names the rules it silences and says why after `--`, oxlint's syntax; the
   `oxlint-disable` spelling everywhere.
3. **The frozen modules are left alone**, their bytes pinned by `history.lock.json`.
4. **A rule that is wrong for a whole kind of file** (`no-thenable` on JSON Schema documents) may keep one directive per
   file, with its reason, rather than one per line; it is not switched off in `.oxlintrc.json`.

## What the spec must cover

- **Each directive outside `src/schemas/history/`**: kept with its reason, or removed because the code is fixed.
- **The 3 unused directives outside the frozen modules** removed.
- **The two whole-file `no-explicit-any` of `src/cli/commandLibrary/contract/`**: narrowed to the lines that need it,
  or replaced by a type that is not `any`, or kept for the file with a reason that says why no narrower form works.
- **The 11 `no-explicit-any` in tests**: the same question, line by line.
- **Unused directives as errors from then on**: how, given that the 6 unused ones in the frozen modules cannot go and
  that `.oxlintrc.json` is now a protected path (a phase cannot change it; the operator does, outside the run). For
  instance the lint script's `--report-unused-disable-directives-severity=error`, with the frozen modules out of the
  lint, or the report left off. Say which, and why.
- **Acceptance**: a count of the directives after the change, by rule and with their reasons, in the plan's last phase.
