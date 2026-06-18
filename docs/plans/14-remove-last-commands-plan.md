# Plan — Remove the `-last` CLI command family

Standalone CLI-surface cleanup. Removes the convenience `-last` command variants
that resolve "the most recent `review_open` run" implicitly, because they add
noise to the CLI API without earning their keep — the named-target forms
(`phax <cmd> <short-name>`) cover the same need explicitly.

## Scope

The CLI currently exposes a `-last` variant for several commands:

| Command       | Resolver fn        | Status in this effort                       |
| ------------- | ------------------ | ------------------------------------------- |
| `enter-last`  | `runEnterLast`     | Removed by plan 11 (`11-lock-agent-binding-phase-plan.md`, phase-05) |
| `shell-last`  | `runShellLast`     | **Removed here**                            |
| `path-last`   | `runPathLast`      | **Removed here**                            |
| `open-last`   | `runOpenLast`      | **Removed here**                            |
| `archive-last`| `runArchiveLast`   | **Removed here**                            |

This plan removes the four siblings. `enter-last` is removed by plan 11; this
plan does not duplicate that code removal but does own the shared documentation
and the cleanup of the now-orphaned `resolveLastReviewOpenRun` helper (see the
conditional-removal note below), so the doc/help surface ends up coherent
regardless of which plan merges first.

All four siblings share the resolver `resolveLastReviewOpenRun`
(`src/app/resolveRunInfo.ts`). Once every `*Last` command — the four here plus
`enter-last` from plan 11 — is gone, that export has no consumers and must be
removed too, or `knip` (part of the `full` gate) fails on the dead export.

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
  function (`runShell`, `runPath`, `runOpen`, `runArchive`). Leave the
  `enter-last` import/block alone — plan 11 owns it (if plan 11 is already
  merged, that import will read `runEnter` only, which is fine).
- `src/cli/commands/shell.ts`: delete `runShellLast`; drop
  `resolveLastReviewOpenRun` from its import (keep `resolveRunByShortName` and
  whatever `runShell` uses).
- `src/cli/commands/path.ts`: delete `runPathLast`; change the import
  `{ resolveRunByShortName, resolveLastReviewOpenRun }` to
  `{ resolveRunByShortName }`.
- `src/cli/commands/open.ts`: delete `runOpenLast`; drop `resolveLastReviewOpenRun`
  from its import.
- `src/cli/commands/archive.ts`: delete `runArchiveLast`; drop
  `resolveLastReviewOpenRun` from its import.
- `src/app/resolveRunInfo.ts` — **conditional removal**: after the deletions
  above, grep the source tree for `resolveLastReviewOpenRun`. If the only
  remaining occurrence is its own definition (i.e. `enter-last`/`runEnterLast`
  is already gone via plan 11), delete the `resolveLastReviewOpenRun` function
  and its `export`. If `runEnterLast` still references it (plan 11 not yet
  merged), leave the helper in place and record this in the handoff — `knip`
  will pass either way (it flags only genuinely-unused exports). Do not change
  `resolveRunByShortName` or any other resolver.
- `README.md`: remove the `phax shell-last`, `phax path-last`, `phax open-last`
  lines (and `phax enter-last` if still listed) from the command listing around
  lines 106–109, and the `phax archive-last` line around line 134. Keep the
  named-target command lines.
- `docs/acceptance-coverage.md`: update the table rows that name `-last`
  variants — row 18 (`phax archive` / `archive-last`) should drop the
  `archive-last` mention; if row 16 still reads `enter` / `enter-last`, drop the
  `enter-last` mention there too. The underlying acceptance (resume / archive of
  the relevant run) is still covered by the named-target command.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/main.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/archive.ts`
- `README.md`
- `docs/acceptance-coverage.md`

### Optional files that may be edited

- `src/app/resolveRunInfo.ts`

### Boundary contracts

This phase crosses no architectural boundary — it removes CLI registration and
command handlers, and (conditionally) one orphaned application-layer helper. The
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
trim per-command imports → conditionally remove `resolveLastReviewOpenRun` →
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
- Whether `resolveLastReviewOpenRun` was removed or retained, and the grep
  result that justified the decision.
- The living-doc lines updated in `README.md` and `docs/acceptance-coverage.md`.
- Any deviation from the planned file lists, with the reason (e.g. retaining
  `resolveRunInfo.ts` unchanged because `enter-last` was still present).

### Commit subject

refactor(cli): remove the -last command variants

### Commit body

Remove the shell-last, path-last, open-last, and archive-last convenience
commands and their handlers, plus the now-unused resolveLastReviewOpenRun
helper, to trim CLI-surface noise. The named-target commands cover the same need
explicitly. README and acceptance-coverage docs updated; no behavior change to
the remaining commands. (enter-last is removed separately in the locked
agent-binding work.)
