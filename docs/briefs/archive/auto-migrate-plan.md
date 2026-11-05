Write the phax plan "Auto migrate" for the approved spec `docs/specs/2610191232-auto-migrate.md`. It is the only plan for that spec, so it carries `completes-spec: true`. Read the spec in full. Its five arbitrations are settled, so do not reopen them:
- q-trigger: every command, read-only ones included;
- q-machine-when: before the command's own work;
- q-machine-where: any command;
- q-agent: on a terminal only;
- q-concurrency: idempotent, with no lock.

Release 0.25.0 waits on this plan, so keep it tight.

In scope: §5.1–§5.24, the §6 surface, every §8 criterion, and the docs page `docs/upgrading.md` with its links.

Ground to read:
- **The three migrations as they exist:**
  - `src/app/migrateApprovals.ts`, with the old ledger paths in `src/domain/artifact/approvalRecordFile.ts` and the refusal `ApprovalLedgerMigrationRequiredError` in `src/app/approvalRecordStore.ts`;
  - `src/app/migrateDocuments.ts`, with detection in `src/app/unmigratedDocuments.ts` (`scanLiveSidecars`, `refuseUnmigratedDocuments`) and its refusal points in `src/app/artifactStatus.ts` and `src/app/decideArtifact.ts`;
  - `src/app/costBackfill.ts` and its CLI command.

  §5.4 requires the automatic runs to do exactly what these commands do, so reuse their use cases and do not write a second implementation.
- **Where commands start:** the `preAction` hook in `src/cli/program.ts`. Also see how the CLI knows that `--json` was passed, how stderr's TTY-ness can be read through a port (no `process` in `app/` or `domain/`), and how phax knows its own version.
- **Phase worktrees:** `src/domain/security/phaseGuard.ts` decides whether the current directory is inside one.
- **The state root and how a persisted format is registered and snapshotted:** `src/schemas/schemaUrl.ts`, `src/schemas/persisted.ts`, `docs/release.md`. The version record is a new schema-born format and rides the opened 0.25.0 `next` snapshots.
- **Commits written by a transition:** how a path-scoped commit is made today. The repository migrations already commit; reuse that.

Points the spec leaves to planning, settled in the plan's Technical arbitrations:
1. **How the hook reaches the use cases without breaking the layers.** The CLI calls one use case that decides and runs the migrations. The decision of what is pending and what to do (run, skip with its reason, refuse) is pure domain over detected facts.
2. **Where each command's "refusal point" status comes from** (§5.10 vs §5.11): a classification held in one place and tested complete against the CLI, as the phase guard's is.
3. **How the "migrating is unsafe" conditions of §5.10/§5.11 are detected:** dirty paths a migration writes, a detached HEAD, a rebase or merge in progress. Use the Git port, adding operations only where needed.
4. **The version record's file name, format id and fields**, as §6 sketches them.
5. **Tests for the TTY rule.** The port is faked; no test depends on the test runner's own terminal.

Constraints:
- Layers as in CLAUDE.md; side effects only through ports.
- No back-compat shims, `$schema` on the new format, explicit per-variant enums.
- Tests never read `~/.phax` and fixtures are made up.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Phases name only models in the installed phax's catalog. Follow the phax-planning skill's model policy: `claude-sonnet-5-5` at `medium` by default, a reason in `modelReason` for every departure.
- It must pass `phax plans lint`.

Docs:
- `docs/upgrading.md` (§5.24, §11), linked from `site/pages.ts` and the README;
- the help and doc pages of `migrate-documents`, `migrate-approvals` and `cost backfill`, saying that phax runs them by itself;
- the regenerated usage spec and CLI reference if any help text changes;
- `NEXT_STEPS.md`: tick `auto-migrate`.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely split:
1. The catalogue, the decision logic, the version record format and the detection ports.
2. The hook wiring, the refusal-point integration, the lines, the docs and NEXT_STEPS.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
