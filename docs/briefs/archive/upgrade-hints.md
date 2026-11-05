Write the phax spec `upgrade-hints`: after phax is upgraded, phax itself tells the person which migration or refresh commands are pending, in the repository and on the machine, and names the command to run for each.

Why (the author, 2026-10-19): release 0.25.0 adds two such commands, `phax artifact migrate-documents` (once per repository with specs or plans) and `phax cost backfill` (once per machine, needed for `phax plans estimate` to have a history). Today nothing tells a person who upgraded. The GitHub release notes are generated from pull requests and carry no upgrade section. The only signal is a refusal: `artifact approve` and `reopen` refuse until `migrate-documents` has run (`src/app/unmigratedDocuments.ts`, `refuseUnmigratedDocuments`). The author wants phax to say it before 0.25.0 is released, so the release waits on this spec's plan.

What exists (read each):
- **Repository-level, one-time:**
  - `phax artifact migrate-approvals` (since 0.19.0): the old ledgers `docs/plans/approvals.json` and `docs/specs/approvals.json` (`src/domain/artifact/approvalRecordFile.ts`, `src/app/migrateApprovals.ts`).
  - `phax artifact migrate-documents` (0.25.0): live sidecars stamped below their format's current shape (`src/app/migrateDocuments.ts`; `scanLiveSidecars` in `src/app/unmigratedDocuments.ts` already detects them).
- **Repository-level, refresh:**
  - `phax schema upgrade` regenerates `phax.schema.json` from the installed binary's config contract.
  - `phax skills install` copies the bundled skills into an agent's skill directory (`src/domain/skills/catalog.ts`), so an installed copy can lag the binary's.
  - Say whether each can be detected as stale cheaply and reliably (for instance by content or a stamp), and leave out any that cannot.
- **Machine-level:** `phax cost backfill` (0.25.0) writes a cost ledger for every registered run that has none (`src/app/costBackfill.ts`). It is optional: only `plans estimate` needs it.
- **The CLI:** `src/cli/program.ts` has a `preAction` hook; `src/domain/security/phaseGuard.ts` classifies every command inside a phase worktree; `--json` commands print one document on stdout and warnings on stderr; the installed version is the package version.

What the spec must cover, settling each point or raising it as a §9 question framed by what each option abandons, recommendation first:
1. **One registry of migrations:** a pure domain table with, for each migration, its id, its scope (repository or machine), the release that introduced it, whether it is required or optional, how it is detected, and the command that clears it. Adding a migration in a later release means adding a row, and a test should hold the table and the CLI in step.
2. **When phax checks.** Options include every command (with cheap detectors only), only after the installed version changes (the last version seen recorded under the state root, per machine, and per repository for repository-level checks), or only in some commands (`run`, `artifact …`, `plans …`). Weigh the latency of scanning sidecars and registered run folders on every call.
3. **How it tells.** One stderr line per pending migration, naming the command, perhaps with one summary line. It never changes an exit code, never writes to stdout (so `--json` output and scripts are unaffected), never prompts, and never runs a migration by itself, since migrations rewrite and commit files. Say how often an optional one (backfill) is repeated, and how a person silences a hint they chose to ignore.
4. **Where it stays quiet:** inside a phase worktree or an authoring session (agents must not be told to migrate), under the phase guard's rules, and possibly with a non-TTY stderr or an environment variable.
5. **A command that lists them all** (for example `phax upgrade --check`, `phax doctor` or `phax migrations`): whether one is needed, and what it prints and exits.
6. **Release notes:** whether the release workflow also prepends an "Upgrade" section listing the migrations introduced since the previous tag, generated from the same table (`.github/workflows/release.yml` uses `softprops/action-gh-release` with `generate_release_notes`), or whether that is a non-goal.
7. **The existing refusal:** `refuseUnmigratedDocuments` stays; say whether its message and the hint share wording.

Constraints:
- Layers as in CLAUDE.md: detection reads through ports, and the decision of what to tell is pure domain.
- Any new persisted state (for example a last-seen version file) has a `$schema`, every field required, and a registered and snapshotted format.
- Explicit per-variant enums (scope, required or optional).
- phax stays autonomous: a hint never stops or slows a run, and a run never waits on it.
- Fixtures are made up. Tests never read `~/.phax`.
- Keep the scope small: the release waits on it. Prefer the smallest design that makes 0.25.0's two commands visible, with the table shaped so later rows are cheap.

Docs: a page `docs/upgrading.md`, which explains the hints, lists the migrations by release, and is linked from the docs site (`site/pages.ts`) and the README.
