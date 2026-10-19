Write the phax spec `auto-migrate`: after phax is upgraded, phax runs its own migrations, so the person never has to know a migration command. It replaces the abandoned `upgrade-hints` spec (`docs/specs/archive/2610190959-upgrade-hints.md`), which told the person what to run. The author, on 2026-10-19, wants phax to do it instead.

Why: release 0.25.0 adds two one-time steps, `phax artifact migrate-documents` (per repository with specs or plans) and `phax cost backfill` (per machine). Today phax tells nobody. The only signal is a refusal: approve, reopen and decide refuse until `migrate-documents` has run (`refuseUnmigratedDocuments` in `src/app/unmigratedDocuments.ts`, used by `src/app/artifactStatus.ts` and `src/app/decideArtifact.ts`), and approval refuses while the old ledgers `docs/{plans,specs}/approvals.json` remain (`ApprovalLedgerMigrationRequiredError`, `src/app/approvalRecordStore.ts`). The release waits on this spec's plan.

The design, decided with the author (state these as settled in §10; do not reopen them):
- **No install hooks.** npm `preinstall`/`postinstall` are rejected. They run in the package's directory, not in the person's repositories. pnpm 10 and `--ignore-scripts` skip them. The standalone release binaries run none.
- **Migrations run at use, as git, Terraform and VS Code upgrade their formats.**
- **Machine migrations** (today: `cost backfill`, which only adds `cost-ledger.json` files under the state root) run automatically on the first phax command after the installed version changes. phax records the last version it ran as under the state root. When that record is absent or names an older version, phax runs every machine migration the catalogue holds, then updates the record. It prints one stderr line saying what it did (for example `phax 0.24.0 → 0.25.0: wrote 12 cost ledgers`), or nothing when there was nothing to do.
- **Repository migrations** (today: `migrate-approvals` and `migrate-documents`) run automatically where phax refuses today: before a command that needs the current shapes, phax migrates, commits the migration as its own commit (as `phax artifact migrate-documents` already does), prints one stderr line, then carries on with the command. phax still refuses, naming the command as today, only where migrating is unsafe: the files the migration writes carry uncommitted changes, HEAD is detached or mid-rebase or merge, or the current directory is inside a phase worktree or an agent session.
- **One catalogue** in the pure domain lists every migration: its id, its scope (repository or machine), the release that introduced it, its detector and its runner. Adding a migration in a later release is one entry, and a test holds the catalogue, the refusals and the existing commands in step.
- **Out:** no hint lines, no listing command and no new environment variable. The existing explicit commands (`migrate-documents`, `migrate-approvals`, `cost backfill`) stay for scripts and for a person who wants to run them by hand.

What the spec must settle, as §9 questions only where two options are both viable, each framed by what it abandons, recommendation first:
1. **Which commands trigger the repository migrations:**
   - exactly those that refuse today, the smallest change;
   - every command run inside a repository (more eager: `artifact status`, `plans lint` and `run` would migrate too);
   - and whether `phax run` (whose plan sidecar may be at an old shape) migrates before it starts.
2. **When the machine migration runs:** before the command's own work or after it, and what happens when it fails. It never fails the person's command: report one line, keep the old version record so it retries next time, and exit as the command would.
3. **Where machine migrations stay off:** in a phase worktree, under an agent phax spawned, and for read-only or `--json` invocations. Decide whether the backfill may run inside a `phax run` or only on an interactive command. It can take seconds on a large state root.
4. **The version record:** one small persisted file under the state root, with `$schema` and every field required, registered and snapshotted like every format. Say how a downgrade is treated (a record newer than the running version): no migration, no rewrite of the record.
5. **Concurrency:** two phax processes starting together after an upgrade. Reuse the existing state lock if one fits, or say the migration is idempotent (backfill never rewrites a ledger) so a race is harmless.

Ground to read:
- `src/app/migrateDocuments.ts`, `src/app/migrateApprovals.ts`, `src/app/unmigratedDocuments.ts`, `src/app/approvalRecordStore.ts`, `src/app/costBackfill.ts` and its CLI;
- `src/cli/program.ts` (`preAction` hook);
- `src/domain/security/phaseGuard.ts`;
- how phax knows its own version;
- the state-root lock, if any (`src/ports/lock.ts`);
- the persisted-format registry (`src/schemas/schemaUrl.ts`, `docs/release.md`).

Constraints:
- **Layers** as in CLAUDE.md: deciding which migrations apply is pure domain; detection and running go through ports.
- **Persisted formats:** no back-compat shims, `$schema` everywhere, explicit per-variant enums (scope).
- **Autonomy:** phax stays autonomous. An automatic migration never prompts and never waits on a person, and a failed one never fails the person's command (except where a refusal exists today and migrating was unsafe, which keeps its exit).
- **Tests and fixtures:** tests never read `~/.phax`, and fixtures are made up.
- **Scope:** keep it small, since the release waits on it.

Docs: a page `docs/upgrading.md` for the reader who upgrades. It says what phax migrates by itself and when, lists the migrations by release, says when phax still refuses and what to do then, and names the explicit commands. Link it from `site/pages.ts` and the README. Update the pages of `migrate-documents`, `migrate-approvals` and `cost backfill` to say that phax runs them by itself.
