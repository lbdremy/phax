# Plan — Remove the `*-last` CLI command family

Standalone CLI-surface cleanup. Removes the convenience `*-last` command variants
that implicitly resolve "the most recent `review_open` run" in the current
project, because they add noise to the CLI API without earning their keep — the
named-target forms (`phax <cmd> <short-name>`) cover the same need explicitly.

## Scope

The CLI currently exposes five `*-last` variants, all wired in
`src/cli/program.ts` and all sharing the application-layer resolver
`resolveLastReviewOpenRun` (`src/app/resolveRunInfo.ts`):

| Command         | Handler          | Source file                       |
| --------------- | ---------------- | --------------------------------- |
| `enter-last`    | `runEnterLast`   | `src/cli/commands/enter.ts`       |
| `shell-last`    | `runShellLast`   | `src/cli/commands/shell.ts`       |
| `path-last`     | `runPathLast`    | `src/cli/commands/path.ts`        |
| `open-last`     | `runOpenLast`    | `src/cli/commands/open.ts`        |
| `archive-last`  | `runArchiveLast` | `src/cli/commands/archive.ts`     |

All five are removed in this plan. Because these five handlers are the **only**
remaining consumers of `resolveLastReviewOpenRun`, once they are deleted the
export has zero consumers and **must** be removed too, or `pnpm knip` (part of
the `full` gate) fails on the dead export. `src/cli/commands/sessionInfo.ts` also
imports `resolveLastReviewOpenRun` but never uses it (it only uses
`findCurrentPhase` from the same module), so that stale named import must be
dropped at the same time or `pnpm typecheck`/`pnpm knip` will fail once the export
is gone.

> Note: an earlier archived plan, `docs/plans/archive/14-remove-last-commands-plan.md`,
> attempted this cleanup but is stale — it assumed `enter-last` was already
> removed, named `src/cli/main.ts` (now `src/cli/program.ts`), referenced
> `resolveRunByShortName` (now `resolveRunRef`), and predates the generated
> `phax.usage.kdl` / drift gate. This plan supersedes it. Do **not** follow the
> archived plan; do **not** edit it.

### Generated artifacts (regeneration, not hand-editing)

`phax.usage.kdl` is generated from the Commander program tree, and
`docs/cli/reference.md` plus the README "CLI command reference" section (between
the `<!-- BEGIN GENERATED CLI REFERENCE -->` / `<!-- END GENERATED CLI REFERENCE -->`
markers) are generated from that spec. They are **derived artifacts** — do not
hand-edit them. After removing the commands from `src/cli/program.ts`, regenerate
them with `pnpm gen:usage-spec` followed by `pnpm docs:cli`. The integration gate
`tests/integration/usageSpecDrift.test.ts` (run by `pnpm test`) asserts the
committed `phax.usage.kdl` is byte-identical to the generator output, so skipping
regeneration fails the `full` gate.

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli

These two regenerate the derived CLI artifacts (`phax.usage.kdl`,
`docs/cli/reference.md`, README CLI section). They are **not** part of any
`phax.json` gate profile and `pnpm` is not in `security.agentCommands`, so they
must be declared here and allowed before running (see below). All other commands
the phase uses (`pnpm typecheck`, `pnpm knip`, `pnpm build`, `pnpm test`, etc.)
are already covered as gate commands.

## Required PHAX security configuration changes

This plan requires the following commands to be added to
`security.agentCommands` in `phax.json` before running:

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

(Alternatively, add the broad token `pnpm` to cover all `pnpm` sub-commands.)
Without this configuration the preflight check will fail before any agent spawns.

## Constraints and verification notes

- The change is pure deletion plus regeneration of derived artifacts — no
  behavior change to the named-target commands (`enter`, `shell`, `path`, `open`,
  `archive`), which keep their existing signatures.
- The only test that enumerates the command set is
  `tests/integration/cliProgram.test.ts` (the `TOP_LEVEL_COMMANDS` list with an
  exact-length assertion). It must drop the five `*-last` entries or the test
  fails. No other test exercises the removed commands.
- The `full` gate profile (`pnpm typecheck`, `pnpm knip`, `pnpm build`,
  `pnpm test`, `pnpm audit:architecture`) mechanically verifies that the removed
  exports are gone, nothing still imports them, and the regenerated spec is in
  sync.
- Historical/narrative documents that mention these commands as records
  (`docs/plans/archive/*`, `docs/cli/inventory.md`) are **not** edited.

---

## phase-01 — Remove the `*-last` command family {#phase-01-remove-last-commands}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Delete the `enter-last`, `shell-last`, `path-last`, `open-last`, and
`archive-last` commands, their `run*Last` handlers, the now-orphaned
`resolveLastReviewOpenRun` resolver, the stale `sessionInfo.ts` import, and the
command-set test entries — then regenerate the derived CLI docs. The
named-target commands are left untouched.

### Detailed instructions

- `src/cli/program.ts`:
  - Remove the five `program.command("…-last")…` registration blocks:
    `enter-last` (~lines 125–131), `shell-last` (~162–168), `path-last`
    (~179–185), `open-last` (~196–204), `archive-last` (~239–246).
  - Trim the five import lines so they import only the named-target function:
    `import { runEnter } from "./commands/enter.js";`,
    `import { runShell } from "./commands/shell.js";`,
    `import { runPath } from "./commands/path.js";`,
    `import { runOpen } from "./commands/open.js";`,
    `import { runArchive } from "./commands/archive.js";`.
- `src/cli/commands/enter.ts`: delete the `runEnterLast` function (~lines 69–88)
  and remove the
  `import { resolveLastReviewOpenRun } from "../../app/resolveRunInfo.js";` line.
  Keep the `import type { RunReviewInfo }` line — `enterRun`/`runEnter` still use
  it.
- `src/cli/commands/shell.ts`: delete `runShellLast` (~lines 52–71) and remove the
  `resolveLastReviewOpenRun` import. Keep the `RunReviewInfo` type import —
  `shellIntoRun`/`runShell` still use it.
- `src/cli/commands/path.ts`: delete `runPathLast` (~lines 34–59) and remove the
  `resolveLastReviewOpenRun` import (this file does not import `RunReviewInfo`).
- `src/cli/commands/open.ts`: delete `runOpenLast` (~lines 56–75) and remove the
  `resolveLastReviewOpenRun` import. Keep the `RunReviewInfo` type import.
- `src/cli/commands/archive.ts`: delete `runArchiveLast` (~lines 107–128) and
  remove the
  `import { resolveLastReviewOpenRun } from "../../app/resolveRunInfo.js";` line.
  Update the comment at ~line 58 that names `resolveLastReviewOpenRun` so it
  refers only to `resolveRunRef`.
- `src/cli/commands/sessionInfo.ts`: change the import on line 6 from
  `import { resolveLastReviewOpenRun, findCurrentPhase } from "../../app/resolveRunInfo.js";`
  to `import { findCurrentPhase } from "../../app/resolveRunInfo.js";`
  (`resolveLastReviewOpenRun` is already unused here).
- `src/app/resolveRunInfo.ts`: delete the `resolveLastReviewOpenRun` function and
  its `export` (~lines 165–197). First confirm with
  `grep -rn "resolveLastReviewOpenRun" src/ tests/` that, after the edits above,
  only the definition line remains; record that result in the handoff. Do not
  touch `resolveRun`, `resolvePhaseInfo`, `findCurrentPhase`, or any other
  resolver.
- `tests/integration/cliProgram.test.ts`: remove `"enter-last"`, `"shell-last"`,
  `"path-last"`, `"open-last"`, and `"archive-last"` from the
  `TOP_LEVEL_COMMANDS` array (the exact-length assertion makes this mandatory).
- Regenerate the derived artifacts, in order: run `pnpm gen:usage-spec` (rewrites
  `phax.usage.kdl`), then `pnpm docs:cli` (rewrites `docs/cli/reference.md` and
  the README CLI section). Do not hand-edit those three files — let the
  generators produce them.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/program.ts`
- `src/cli/commands/enter.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/open.ts`
- `src/cli/commands/archive.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/app/resolveRunInfo.ts`
- `tests/integration/cliProgram.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `docs/cli/inventory.md`

### Boundary contracts

This phase crosses no architectural boundary. It removes CLI registration and
command handlers (cli layer) plus one now-orphaned application-layer helper
(`resolveLastReviewOpenRun`). The named-target commands (`enter`, `shell`,
`path`, `open`, `archive`) keep their existing signatures and behavior, and no
domain, port, schema, or adapter contract changes.

### Test strategy

CLI/route layer. No new tests are written — there is no behavior to add, and the
removed commands have no functional test coverage. The existing
`tests/integration/cliProgram.test.ts` is updated (not added to) to reflect the
new command set; its exact-length assertion is the regression guard that the five
commands are gone and nothing else changed. `tests/integration/usageSpecDrift.test.ts`
verifies the regenerated `phax.usage.kdl` matches the program. `pnpm knip`,
`pnpm typecheck`, and `pnpm build` mechanically confirm no dangling imports or
dead exports remain.

### Implementation order

Remove the five command blocks and trim imports in `src/cli/program.ts` → delete
the five `run*Last` handlers and trim per-command imports → fix the stale
`sessionInfo.ts` import → grep-confirm and delete the orphaned
`resolveLastReviewOpenRun` → update `cliProgram.test.ts` → regenerate
`phax.usage.kdl` (`pnpm gen:usage-spec`) then the docs (`pnpm docs:cli`) → run the
`full` gate.

### Excluded scope

- Any change to the named-target commands' behavior or signatures.
- Editing historical/narrative docs that mention these commands as records
  (`docs/plans/archive/*`, `docs/cli/inventory.md` — its claim that the `*-last`
  commands are absent becomes accurate after this removal, so it needs no edit).
- Hand-editing the generated artifacts (`phax.usage.kdl`,
  `docs/cli/reference.md`, README CLI section) instead of regenerating them.

### Verification

- The project's configured `full` gate profile in `phax.json` — notably
  `pnpm knip`, `pnpm typecheck`, `pnpm build` (no dangling imports / dead
  exports), and `pnpm test` (which runs both `cliProgram.test.ts` and
  `usageSpecDrift.test.ts`).

### Expected handoff content

- Confirmation that all five `*-last` commands and their `run*Last` handlers are
  removed, and that `src/cli/program.ts` imports only the named-target functions.
- Confirmation that `resolveLastReviewOpenRun` was deleted, with the
  `grep -rn "resolveLastReviewOpenRun" src/ tests/` result (after the handler/
  import edits, before deletion: only the definition line) that justified it, and
  that `sessionInfo.ts` no longer imports it.
- Confirmation that `phax.usage.kdl`, `docs/cli/reference.md`, and the README CLI
  section were regenerated (not hand-edited) via `pnpm gen:usage-spec` and
  `pnpm docs:cli`, and that `usageSpecDrift.test.ts` passes.
- The updated `TOP_LEVEL_COMMANDS` list in `cliProgram.test.ts`.
- Any deviation from the planned file lists, with the reason (e.g. whether
  `docs/cli/inventory.md` was touched).

### Commit subject

refactor(cli): remove the *-last command variants

### Commit body

Remove the enter-last, shell-last, path-last, open-last, and archive-last
convenience commands and their handlers, plus the now-orphaned
resolveLastReviewOpenRun resolver and a stale import in sessionInfo.ts, to trim
CLI-surface noise. The named-target commands (enter/shell/path/open/archive
<short-name>) cover the same need explicitly. Regenerate phax.usage.kdl,
docs/cli/reference.md, and the README CLI section from the updated Commander
program; update the cliProgram command-set test. No behavior change to the
remaining commands.
