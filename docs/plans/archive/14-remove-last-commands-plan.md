# Plan — Remove the `-last` CLI command family

Standalone CLI-surface cleanup. Removes the convenience `-last` command variants
that resolve "the most recent `review_open` run" implicitly, because they add
noise to the CLI API without earning their keep — the named-target forms
(`phax <cmd> <short-name>`) cover the same need explicitly.

## Scope

The CLI currently exposes a `-last` variant for several commands:

| Command       | Resolver fn        | Status in this effort                       |
| ------------- | ------------------ | ------------------------------------------- |
| `enter-last`  | `runEnterLast`     | Already removed by plan 11 (`11-lock-agent-binding-phase-plan.md`, phase-05) — merged |
| `shell-last`  | `runShellLast`     | **Removed here**                            |
| `path-last`   | `runPathLast`      | **Removed here**                            |
| `open-last`   | `runOpenLast`      | **Removed here**                            |
| `archive-last`| `runArchiveLast`   | **Removed here**                            |

This plan removes the four siblings. `enter-last` and `runEnterLast` are **already
gone** — plan 11 has merged (verified: no `enter-last`/`runEnterLast` references
remain in `src/`, and `enter.ts` exports only `runEnter`). This plan owns the
shared documentation cleanup and the removal of the now-orphaned
`resolveLastReviewOpenRun` helper.

All four remaining siblings share the resolver `resolveLastReviewOpenRun`
(`src/app/resolveRunInfo.ts`). Because `enter-last` is already removed, those four
are its **only** remaining consumers — once they are deleted, the export has zero
consumers and **must** be removed too, or `knip` (part of the `full` gate) fails
on the dead export. (The earlier conditional "remove or retain" branch no longer
applies: retention was only possible while plan 11 was unmerged.)

## Required commands

- (none)

No new tool, runtime, or CLI is introduced. The change is pure deletion verified
through the existing `phax.json` gate profiles.

## Constraints and verification notes

- No tests currently reference these commands (verified: no matches under
  `tests/`), and no `--help`/usage snapshot test enumerates the command list, so
  the removal does not break an existing test.
- The `full` gate profile already runs `pnpm knip`, `pnpm typecheck`, and
  `pnpm build`, which mechanically verify that the removed exports are gone and
  nothing still imports them. This is the phase's gate-verifiable outcome.
- Historical plan documents (`docs/plans/01-plan.md`, `12-…`, `18-…`) mention
  these commands as records of past work — **do not edit them**. Only living
  docs (`README.md`, `docs/acceptance-coverage.md`) are updated.

---

## phase-01 — Remove the `-last` sibling commands {#phase-01-remove-last-commands}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Delete the `shell-last`, `path-last`, `open-last`, and `archive-last` commands,
their `run*Last` functions, the now-unused shared resolver, and the living-doc
references, leaving the named-target commands untouched.

### Detailed instructions

- `src/cli/main.ts`: remove the four `program.command("…-last")…` blocks
  (`shell-last`, `path-last`, `open-last`, `archive-last`). Update the four
  `import { runX, runXLast } from …` lines to import only the named-target
  function (`runShell`, `runPath`, `runOpen`, `runArchive`). There is no
  `enter-last` import or block to touch — plan 11 already removed it, and the
  `enter` import already reads `runEnter` only.
- `src/cli/commands/shell.ts`: delete `runShellLast`; drop
  `resolveLastReviewOpenRun` from its import (keep `resolveRunByShortName` and
  whatever `runShell` uses).
- `src/cli/commands/path.ts`: delete `runPathLast`; change the import
  `{ resolveRunByShortName, resolveLastReviewOpenRun }` to
  `{ resolveRunByShortName }`.
- `src/cli/commands/open.ts`: delete `runOpenLast`; drop `resolveLastReviewOpenRun`
  from its import.
- `src/cli/commands/archive.ts`: delete `runArchiveLast`; `resolveLastReviewOpenRun`
  is the *only* symbol imported from `resolveRunInfo.js` here (`runArchive` does
  not use `resolveRunByShortName`), so remove the entire
  `import { resolveLastReviewOpenRun } from "../../app/resolveRunInfo.js";` line
  rather than leaving an empty import.
- `src/app/resolveRunInfo.ts` — **remove the orphaned helper**: after the four
  deletions above, `resolveLastReviewOpenRun` has no remaining consumers (its
  only references were the four siblings; `enter-last`/`runEnterLast` is already
  gone). Delete the `resolveLastReviewOpenRun` function and its `export`. First
  confirm with a grep — `grep -rn "resolveLastReviewOpenRun" src/ tests/` should
  show only the definition line in `resolveRunInfo.ts`; record that result in the
  handoff. Do not change `resolveRunByShortName` or any other resolver.
- `README.md`: remove the entire `-last` block in the "Review loop" section —
  the intro sentence (`Append \`-last\` to any command to target the most recent
  review_open run:`) and the fenced code listing of `phax enter-last`,
  `phax shell-last`, `phax path-last`, `phax open-last` (currently around lines
  179–186). Note that this block still lists `phax enter-last`, a stale entry
  plan 11 left behind; removing the whole block clears it. Also remove the
  `phax archive-last` line in the "Archive" section (currently around line 210).
  Keep all named-target command lines (`phax shell <short-name>`, etc.).
- `docs/acceptance-coverage.md`: update the two table rows that name `-last`
  variants (currently around lines 24 and 26). The `phax archive` / `archive-last`
  row should drop the `archive-last` mention; the `phax enter` / `enter-last` row
  should drop the `enter-last` mention (that command is already gone). The
  underlying acceptance (resume / archive of the relevant run) is still covered by
  the named-target command.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/main.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/archive.ts`
- `src/app/resolveRunInfo.ts`
- `README.md`
- `docs/acceptance-coverage.md`

### Optional files that may be edited

- (none)

### Boundary contracts

This phase crosses no architectural boundary — it removes CLI registration and
command handlers, plus one now-orphaned application-layer helper. The
named-target commands (`shell`, `path`, `open`, `archive`, `enter`) keep their
existing signatures and behavior.

### Test strategy

CLI/route layer. No new tests are written: there are no existing tests for the
removed commands, and the deletion is verified mechanically by the gate
(`pnpm typecheck`, `pnpm knip`, `pnpm build`). If, contrary to the current
search, any test references a removed `run*Last` symbol or `-last` command,
update or remove that test as part of this phase rather than adding new
coverage.

### Implementation order

Remove command blocks + imports in `main.ts` → delete `run*Last` functions and
trim per-command imports → remove the orphaned `resolveLastReviewOpenRun` →
update `README.md` and `docs/acceptance-coverage.md` → run the gate.

### Excluded scope

- The `enter-last` command and `runEnterLast` function (removed by plan 11).
- Any change to the named-target commands' behavior.
- Editing historical plan documents that mention these commands as records.

### Verification

- The project's configured `full` gate profile in `phax.json` (notably
  `pnpm knip`, `pnpm typecheck`, and `pnpm build`, which confirm no dangling
  imports or unused exports remain).

### Expected handoff content

- Confirmation that `shell-last`, `path-last`, `open-last`, and `archive-last`
  (commands and `run*Last` functions) are removed.
- Confirmation that `resolveLastReviewOpenRun` was removed, with the
  `grep -rn "resolveLastReviewOpenRun" src/ tests/` result (before deletion,
  only the definition line plus the four siblings) that justified it.
- The living-doc edits in `README.md` (the removed `-last` block and
  `archive-last` line) and `docs/acceptance-coverage.md`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(cli): remove the -last command variants

### Commit body

Remove the shell-last, path-last, open-last, and archive-last convenience
commands and their handlers, plus the now-unused resolveLastReviewOpenRun
helper, to trim CLI-surface noise. The named-target commands cover the same need
explicitly. README and acceptance-coverage docs updated; no behavior change to
the remaining commands. (enter-last was already removed separately in the locked
agent-binding work.)
