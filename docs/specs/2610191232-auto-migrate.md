---
status: Draft
date: 2026-10-19
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Automatic migrations after an upgrade

## 1. Context

Some phax upgrades change a format phax has already written. Three one-time steps exist today. `phax artifact migrate-approvals` (since 0.19.0) splits the old ledgers docs/plans/approvals.json and docs/specs/approvals.json into one record file per artifact, in one commit. `phax artifact migrate-documents` (0.25.0) rewrites the live spec and plan sidecars stamped below their format's current shape, in one commit, and refuses while an old ledger exists. `phax cost backfill` (0.25.0) writes a cost ledger under the state root for every registered run that has none; only `phax plans estimate` reads those ledgers.

Today the only signal is a refusal, exit 12, in the middle of the work the person asked for:

    ✗ Approval refused: docs/plans/2610150900-x-plan.json is stamped 0.20.0 — run `phax artifact migrate-documents` first
    ✗ docs/plans/approvals.json is an approval ledger from an older phax — run `phax artifact migrate-approvals` first

The document refusal comes from approve, reopen and decide. The ledger refusal comes from every command that reads or writes approval records: artifact status, the artifact transitions (approve, reopen, abandon, complete, stale), plans status, migrate-documents, and `phax run` (before it starts, and at completion when it marks the plan Completed). Nothing ever mentions `phax cost backfill`.

Every subcommand passes through one hook before it runs, where the phase guard refuses acting commands inside a phase worktree. phax knows its own release. The state root has no version record and no lock of its own; the Lock port locks run keys. Headless authoring and decide sessions run their agent in the main checkout. The `upgrade-hints` spec, which would have printed the command to run, was abandoned on 2026-10-19 in favour of this one.

Ground read:

- `docs/specs/archive/2610190959-upgrade-hints.md` — the abandoned spec this one replaces: it told the person which command to run; its catalogue (approval-ledgers, document-shapes, cost-ledgers) is kept, its hints and `phax migrations` are dropped
- `src/app/unmigratedDocuments.ts` — scanLiveSidecars finds live sidecars stamped below their format's current shape; refuseUnmigratedDocuments refuses with "<gesture>: <sidecar> is stamped <shape> — run `phax artifact migrate-documents` first"
- `src/app/artifactStatus.ts` — inspectArtifact (artifact status) and transitionArtifact (approve, reopen, abandon, complete, stale) call refuseOldApprovalLedgers first; approve and reopen also call refuseUnmigratedDocuments
- `src/app/decideArtifact.ts` — decide calls refuseUnmigratedDocuments("Decide refused") before anything is written
- `src/app/approvalRecordStore.ts` — refuseOldApprovalLedgers: "<ledger> is an approval ledger from an older phax — run `phax artifact migrate-approvals` first" while docs/plans/approvals.json or docs/specs/approvals.json exists
- `src/app/planStaleness.ts` — computeStalenessForPlan (`phax run`, before it starts) and plansStalenessReport (`phax plans status`) refuse on an old ledger too
- `src/app/completeRunArtifacts.ts` — run completion transitions the plan and spec to Completed through transitionArtifact, so it meets the ledger refusal as well
- `src/cli/commands/runLayers.ts` — both refusals, and both migrations' own refusals, exit 12
- `src/app/migrateApprovals.ts` — splits the old ledgers into record files, refuses when a write path is dirty or untracked, and commits exactly those paths as `chore(approvals): migrate approval ledgers to record files`
- `src/app/migrateDocuments.ts` — refuses while an old ledger exists; rewrites unmigrated sidecars and bodies, re-seeds each plan's extraction cache, refuses on a dirty write set, commits as `chore(artifacts): migrate documents to their current shapes`
- `src/app/costBackfill.ts` — writes a cost-ledger.json for every registered run whose folder exists, has none and is not locked; creates each exclusively and never rewrites one, so a second pass writes nothing
- `src/cli/program.ts` — a preAction hook runs before every subcommand: the --usage flag, then the phase guard via isInPhaseWorktree(cwd)
- `src/domain/security/phaseGuard.ts` — every command path is classified allowed (read-only, plus brief and schema upgrade) or refused (acting) inside a phase worktree; a phase worktree is recognised from the cwd alone, with no environment variable
- `src/cli/commands/usage.ts` — phax knows its own version as PHAX_RELEASE (src/schemas/release.ts), 0.25.0 today
- `src/ports/lock.ts` — the Lock port locks one key at a time (run keys today); there is no state-root lock
- `src/schemas/schemaUrl.ts` — FORMAT_IDS registers every persisted format, appended in order; cost-ledger is the last; docs/release.md renames next.schema.json snapshots at each release
- `src/app/authorArtifact.ts` — headless authoring and decide sessions run their agent in the main checkout (cwd: repoRoot), not in a phase worktree
- `README.md` — the explicit commands are documented in the Artifacts and Cost sections and under Troubleshooting, by their refusal

## 2. Problem

A person who upgrades phax has to learn a migration command from a refusal, then run it, then run their command again. For an optional step such as the cost backfill, no refusal ever comes, so they never learn of it. Telling them the command (the abandoned `upgrade-hints` spec) still leaves the chore with them, and every later release that changes a format would add another command to learn. Release 0.25.0 adds two such steps and waits on this spec. Install hooks are no way out: npm `preinstall`/`postinstall` run in the package's directory rather than in the person's repositories, pnpm 10 and `--ignore-scripts` skip them, and the standalone release binaries run none.

## 3. Product goal

After an upgrade, phax brings what it has already written up to date by itself, when it is used, as git, Terraform and VS Code upgrade their formats. It does so on any command a person runs at a terminal: never when stderr is not a terminal, never with `--json`, and never inside a phase worktree.
- A machine migration runs once, on the first such command after the installed release changes.
- A repository migration runs on any such command inside a phax project, and commits as its own commit.

Where migrating is unsafe, a command that refuses today still refuses, naming the command as today. Any other command skips the migration, says so on one stderr line, and keeps its exit. One catalogue declares every migration, so adding one in a later release is one entry, and a test keeps the catalogue, the refusals and the explicit commands in step.

> phax migrates what it owns by itself, exactly as the explicit command would, for a person at a terminal; it refuses only where it refuses today and migrating is unsafe, and never changes another command's exit.

## 4. Terminology

- **migration** — A one-time rewrite that brings files phax wrote in an older release up to the installed release: an entry in the catalogue.
- **catalogue** — The one ordered list of migrations. Each entry has an id, a scope, the release that introduced it, its explicit command, a detection and a runner.
- **scope** — Exactly `repository` (files in the phax project the command runs in) or `machine` (files under the state root in effect: `state.root`, else ~/.phax).
- **pending** — A migration whose detection finds work its runner would do.
- **explicit command** — The existing command that runs a migration by hand: `phax artifact migrate-approvals`, `phax artifact migrate-documents`, `phax cost backfill`.
- **migration point** — A command that runs the pending repository migrations before its own work: every command run inside a phax project, read-only ones included, while migrations are on (§5.5). An entry's own explicit command is not a migration point for that entry.
- **unsafe to migrate** — A path the migration writes has uncommitted changes or is untracked; HEAD is detached; or a rebase, merge, cherry-pick or revert is in progress.
- **version record** — A file under the state root naming the last release whose machine migrations completed there.
- **migrations on** — stderr is a terminal, the command has no `--json`, and the current directory is not inside a phase worktree. Both scopes run automatically only then (q-agent). An agent's shell is recognised by its stderr not being a terminal.
- **refusal point** — A command that refuses today while a given repository migration is pending, for that migration (the §6 "before" list). `phax run` is one for `approval-ledgers` but not for `document-shapes`.

## 5. Functional requirements

### 5.1 One catalogue

The system shall declare every migration once, in one catalogue, each entry with an id, a scope that is exactly `repository` or `machine`, the release that introduced it, its explicit command, its detection and its runner.

### 5.2 The migrations of 0.25.0

The catalogue shall hold, in this order: `approval-ledgers` (repository, since 0.19.0, `phax artifact migrate-approvals`), `document-shapes` (repository, since 0.25.0, `phax artifact migrate-documents`) and `cost-ledgers` (machine, since 0.25.0, `phax cost backfill`).

### 5.3 Catalogue, refusals and commands in step

The system shall name, as each entry's explicit command, a command registered in the phax CLI, and shall name that same command in every refusal and every skip line for a pending repository migration of that entry.

### 5.4 Same work as the explicit command

The system shall make each automatic migration detect, write and refuse exactly as its explicit command does, and, for a repository migration, commit with the same subject and body.

### 5.5 Repository migrations on every command

WHEN a command starts inside a phax project with migrations on, and a repository migration is pending, THE system SHALL run that migration before the command's own work. Read-only commands such as `phax ls`, `phax validate`, `phax plans lint` and `phax artifact status` are included. `phax run`, `--dry-run` included, migrates before extraction.

### 5.6 Where repository migrations stay off

WHILE stderr is not a terminal, the command has `--json`, or the current directory is inside a phase worktree, THE system SHALL run no repository migration and print no migration line. A refusal point SHALL refuse as today, naming the explicit command, and any other command SHALL run as it does today.

### 5.7 Catalogue order

The system shall run pending repository migrations in catalogue order, so `approval-ledgers` runs before `document-shapes`.

### 5.8 Its own commit

WHEN an automatic repository migration has written its files THE system SHALL commit exactly those paths as one commit of their own before the command continues.

### 5.9 One line per repository migration

WHEN an automatic repository migration has committed THE system SHALL print one stderr line naming what it migrated and the commit, then carry on with the command.

### 5.10 Refuse where migrating is unsafe

IF a repository migration is pending at one of its refusal points with migrations on, and migrating is unsafe, THEN the system SHALL refuse as today, with exit 12, naming the explicit command and why it did not migrate.

### 5.11 Skip, with no new refusal, elsewhere

IF a repository migration is pending at a command that is not one of its refusal points with migrations on, and migrating is unsafe, THEN the system SHALL skip it, print one stderr line naming the explicit command and why it did not migrate, and run the command with the stdout and exit code it has today. For example, `phax ls` with a dirty sidecar, or `phax run` with `document-shapes` pending.

### 5.12 A failed repository migration

IF an automatic repository migration fails at one of its refusal points THEN the system SHALL refuse the command with exit 12, naming the explicit command and the migration's own reason. At any other command, it SHALL print one stderr line naming them and run the command with the stdout and exit code it has today. In both cases it SHALL leave the repository as the explicit command leaves it on that failure.

### 5.13 Migrated meanwhile

IF an automatic repository migration fails and a fresh detection finds it no longer pending THEN the system SHALL carry on with the command without a refusal.

### 5.14 Machine migrations after a version change

WHEN a command starts with migrations on, and the version record is absent, unreadable, or names a release older than the running phax, THE system SHALL run every machine migration in the catalogue before the command's own work. Read-only commands, and commands run outside a phax project, are included.

### 5.15 Recording the release

WHEN every machine migration has succeeded THE system SHALL write the running release to the version record.

### 5.16 One line, or none

WHEN the machine migrations have finished THE system SHALL print one stderr line naming the previous release, the running release and what was written, or nothing when nothing was written.

### 5.17 A failed machine migration never fails the command

IF a machine migration fails THEN the system SHALL print one stderr line naming it and its reason, leave the version record unchanged, and run the command with the stdout and exit code it would have had without migrations.

### 5.18 A newer record

IF the version record names a release newer than the running phax THEN the system SHALL run no machine migration and leave the record unchanged.

### 5.19 Where machine migrations stay off

WHILE stderr is not a terminal, the command has `--json`, or the current directory is inside a phase worktree, THE system SHALL run no machine migration and leave the version record unchanged.

### 5.20 An explicit command does not trigger itself

WHEN an entry's explicit command runs THE system SHALL not run that entry automatically before it: `phax artifact migrate-approvals`, `phax artifact migrate-documents` and `phax cost backfill` do not trigger their own migration.

### 5.21 Version record format

The system shall write the version record as a registered, snapshotted persisted format with a `$schema` and every field required, and shall treat a record it cannot decode as absent.

### 5.22 Never waits on a person

The system shall run automatic migrations without prompting, without reading input and without waiting on a person.

### 5.23 stdout untouched

The system shall print automatic-migration lines on stderr only, and shall leave a command's stdout unchanged by them.

### 5.24 Upgrading page

The upgrading page shall list every catalogue entry under the release that introduced it, with its scope and its explicit command.

## 6. Surface

### cli: where migrations run — normative

before:

    Each command below refuses with exit 12 while its migration is pending:

        phax artifact status <path>                       refuses on an old ledger
        phax artifact approve | reopen <path>             refuses on an old ledger or an unmigrated sidecar
        phax artifact decide <path>                       refuses on an unmigrated sidecar
        phax artifact abandon | complete | stale <path>   refuses on an old ledger
        phax plans status [--apply]                       refuses on an old ledger
        phax artifact migrate-documents                   refuses on an old ledger
        phax run --plan <plan>                            refuses on an old ledger

after:

    Every command run inside a phax project, read-only ones included, runs the pending repository migrations first,
    in catalogue order, when migrations are on: stderr a terminal, no --json, not inside a phase worktree.
    Every command, inside a project or not, runs the machine migrations first under the same condition.
    `phax run` (--dry-run included) migrates before extraction. An entry's own explicit command does not trigger that entry.

        $ phax ls                       # on a terminal, an old ledger and a 0.20.0 sidecar pending
        phax: migrated approval ledgers to record files — committed 9b1e2d0
        phax: migrated 3 documents to their current shapes — committed 4f2a9c1
        <ls's own output, unchanged>

        $ phax ls --json                # no migration, no line, stdout as today
        $ phax ls | cat                 # stderr still a terminal: migrates; `phax ls 2>log` does not

    Where migrating is unsafe (dirty or untracked write path, detached HEAD, rebase/merge/cherry-pick/revert in progress):

        refusal points (they refuse today, and still do):
            phax artifact status <path>                       approval-ledgers
            phax artifact approve | reopen <path>             approval-ledgers, document-shapes
            phax artifact decide <path>                       document-shapes
            phax artifact abandon | complete | stale <path>   approval-ledgers
            phax plans status [--apply]                       approval-ledgers
            phax artifact migrate-documents                   approval-ledgers
            phax run --plan <plan>                            approval-ledgers

        any other command, or a refusal point for another entry: skips, with one stderr line, and keeps its exit
            $ phax ls
            phax: not migrated (docs/plans/2610150900-x-plan.json has uncommitted changes) — run `phax artifact migrate-documents` when it is clean
            <ls's own output, unchanged>
            $? = 0

    With migrations off, a refusal point refuses as today and any other command runs as today, with no line.

    Normative: every command as a migration point, and the three off conditions; the refusal-point list and their exit 12; the skip with one stderr line and an unchanged exit everywhere else. Wording is indicative.

### cli: repository migration line — indicative

before:

    $ phax artifact approve docs/plans/2610150900-x-plan.md --by operator
    ✗ Approval refused: docs/plans/2610150900-x-plan.json is stamped 0.20.0 — run `phax artifact migrate-documents` first
    $? = 12

after:

    $ phax artifact approve docs/plans/2610150900-x-plan.md --by operator
    phax: migrated 3 documents to their current shapes — committed 4f2a9c1 "chore(artifacts): migrate documents to their current shapes"
    <approve's own output, unchanged>

    Normative: one stderr line per migration that committed, before the command's own output; the commit subject equals the explicit command's. Wording is indicative.

### cli: refusal where migrating is unsafe — indicative

before:

    ✗ Approval refused: docs/plans/2610150900-x-plan.json is stamped 0.20.0 — run `phax artifact migrate-documents` first
    $? = 12

after:

    ✗ Approval refused: docs/plans/2610150900-x-plan.json is stamped 0.20.0 — run `phax artifact migrate-documents` first
      not migrated automatically: docs/plans/2610150900-x-plan.json has uncommitted changes
    $? = 12

    Normative: at a refusal point only, exit 12, the explicit command named verbatim, and a reason that is one of: uncommitted or untracked write path, detached HEAD, rebase/merge/cherry-pick/revert in progress. With migrations off (stderr not a terminal, `--json`, phase worktree), a refusal point prints today's refusal alone. Wording is indicative.

### cli: machine migration line — indicative

    $ phax plans estimate docs/plans/2610200900-y-plan.md      # first command on a terminal after upgrading
    phax 0.24.0 → 0.25.0: wrote 12 cost ledgers
    <estimate output, on stdout, unchanged>

    With no version record:   phax → 0.25.0: wrote 12 cost ledgers
    Nothing to write:         (no line)
    On failure:               phax 0.24.0 → 0.25.0: cost-ledgers not run (registry.json is corrupt) — will retry on the next command

    Normative: at most one line, on stderr, naming both releases when the record names one; no line when nothing was written. Wording is indicative.

### file: <state root>/version.json — indicative

    {
      "$schema": "https://docs.phax.run/schemas/version-record/0.25.0.json",
      "version": "0.25.0"
    }

    Normative: a `$schema` naming a registered format, and a required `version`. The file name and the format id are indicative.

## 7. Non-goals

- npm `preinstall`/`postinstall` or any other install hook.
- Hint lines, a listing command (`phax migrations`) or a new environment variable.
- Removing or changing the explicit commands `phax artifact migrate-approvals`, `phax artifact migrate-documents` and `phax cost backfill`; they stay for scripts and for a person who wants to run them by hand.
- Migrating archived artifacts, other repositories, or a state root other than the one in effect.
- Migrating inside a run's worktrees: a run started before the upgrade and resumed after may still meet today's ledger refusal when it completes.
- Migrating `phax.schema.json` or the installed skills (`phax schema upgrade`, `phax skills install`): those files carry no version stamp.
- A switch to turn automatic migrations off.
- Checking the network for a newer phax, and telemetry on migrations.
- Migrating for a script, CI or an agent: with stderr not a terminal, under `--json` or inside a phase worktree, phax migrates nothing, and the explicit commands remain the way to migrate there.

## 8. Acceptance criteria

### Catalogue, refusals and commands in step

Given the catalogue and the registered CLI, when the catalogue contract test runs, then the entries are `approval-ledgers`, `document-shapes`, `cost-ledgers` in that order with the scopes, releases and commands §5 declares; every command is a registered command path; each repository refusal names its entry's command verbatim; and an entry naming an unregistered command fails the test. (refs §5.1, §5.2, §5.3)

### Approve migrates documents, then approves

Given a made-up phax project on a branch with a clean tree, one committed live plan sidecar stamped 0.20.0, and stderr on a pseudo-terminal, when `phax artifact approve <that plan> --by operator` runs, then a commit with subject `chore(artifacts): migrate documents to their current shapes` precedes the approval, holding exactly the paths `phax artifact migrate-documents` writes in a copy of the same project; stderr has one migration line before approve's output; and stdout and the exit code equal those of approve in that migrated copy. (refs §5.5, §5.8, §5.9, §5.4, §5.23)

### Ledgers before documents

Given a project with a committed docs/specs/approvals.json and an unstamped live sidecar, stderr on a pseudo-terminal, when `phax artifact approve` runs, then two new commits exist, `chore(approvals): migrate approval ledgers to record files` before `chore(artifacts): migrate documents to their current shapes`. (refs §5.7, §5.5)

### Artifact status migrates the ledgers

Given a project with a committed docs/plans/approvals.json, stderr on a pseudo-terminal, when `phax artifact status <a plan>` runs, then the ledger is gone in a new commit, the record files exist, and the status is reported with exit 0. (refs §5.5)

### Run migrates before it starts

Given a project whose plan's live sidecar is stamped 0.20.0 and a fake provider, when `phax run --plan <that plan>` starts, then the migration commit is on the current branch before the run's first worktree is created, and the run branch contains it. (refs §5.5)

### Dirty write path keeps the refusal

Given a project whose stamped-0.20.0 plan sidecar has uncommitted edits, stderr on a pseudo-terminal, when `phax artifact approve` runs, then it exits 12, stderr names `phax artifact migrate-documents` and the dirty path as the reason, and no commit is created. (refs §5.10)

### Detached HEAD and mid-rebase keep the refusal

Given a project with a committed old ledger, first with HEAD detached, then with a rebase in progress, when `phax artifact status <a plan>` runs in each, then each exits 12 naming `phax artifact migrate-approvals` and the reason, and no commit is created. (refs §5.10)

### Phase worktree keeps the refusal

Given a phase worktree (a linked worktree with .phax-context/) whose project holds an old ledger, when `phax artifact status` runs there, then it exits 12 naming `phax artifact migrate-approvals`, and no commit is created. (refs §5.10)

### A non-terminal stderr keeps the refusal

Given a project with a committed old ledger, and stderr redirected to a file, when `phax artifact status <a plan>` runs, then it exits 12 with today's refusal naming `phax artifact migrate-approvals`, and no commit is created. (refs §5.6)

### No new refusal at run

Given a project whose plan sidecar is stamped 0.20.0 with uncommitted edits, no old ledger, and `--allow-dirty`, when `phax run --plan <that plan>` starts, then stderr has one line naming `phax artifact migrate-documents` and the dirty path, no migration commit is made, and the run starts as it does today. (refs §5.11)

### A failed migration names its reason

Given a project with a live sidecar whose body is not its sidecar's own rendering, when `phax artifact approve` runs, then it exits 12, stderr names `phax artifact migrate-documents` and the migration's refusal, and the working tree and git log are unchanged. (refs §5.12)

### Migrated meanwhile carries on

Given a fake Git port whose migration commit fails, after which the detection finds nothing pending, when a migration point runs, then the command carries on and exits as it would on a migrated project. (refs §5.13)

### Machine migration once per upgrade

Given a temporary state root whose version record names 0.24.0, with a registered run whose folder exists without a cost ledger, stderr on a pseudo-terminal, when `phax plans estimate <plan> --no-probe` runs, then again, then the first prints one line naming 0.24.0, 0.25.0 and one cost ledger written, the ledger exists before the estimate reads its history, and the record's `version` is 0.25.0; the second prints no migration line and writes nothing. (refs §5.14, §5.15, §5.16)

### No record, nothing to write

Given a temporary state root with no version record and no run lacking a ledger, stderr on a pseudo-terminal, when `phax ls` runs, then no migration line is printed and the record's `version` is 0.25.0. (refs §5.14, §5.16, §5.15)

### Failure never fails the command

Given a temporary state root whose registry is corrupt and whose record names 0.24.0, stderr on a pseudo-terminal, when `phax ls` runs, then stderr has one line naming `cost-ledgers` and its reason, the record still names 0.24.0, and stdout and the exit code equal those of `phax ls` with stderr redirected. (refs §5.17)

### A newer record is left alone

Given a temporary state root whose record names 0.26.0 and a run without a cost ledger, when `phax ls` runs on a terminal, then no ledger is written and the record is byte-identical. (refs §5.18)

### Machine migrations stay off

Given a temporary state root with no record and a run without a cost ledger, when `phax ls` runs with stderr redirected, then `phax ls --json` on a terminal, then `phax ls` inside a phase worktree, then none writes a cost ledger or a version record. (refs §5.19)

### Backfill does not trigger itself

Given a temporary state root whose record names 0.24.0 and a run without a cost ledger, stderr on a pseudo-terminal, when `phax cost backfill` runs, then stderr has no automatic migration line and the command's own output reports the ledger it wrote. (refs §5.20)

### Version record format

Given a record written by the machine migrations, and one missing `version`, when the format's snapshot test runs and the next command on a terminal reads the second, then the first carries a `$schema` naming the registered format at its current stamp with every field required in the snapshot, and the second counts as absent: the migrations run and rewrite it. (refs §5.21)

### Never reads input

Given pending repository and machine migrations, stdin closed and stderr on a pseudo-terminal, when `phax artifact approve --by operator` runs, then it completes without reading input and `--json` stdout of `phax artifact status --json` in the same state is one JSON document. (refs §5.22, §5.23)

### Upgrading page lists the catalogue

Given the catalogue and docs/upgrading.md, when the docs check runs, then the page lists every entry's command under its release with its scope, and an entry missing from the page fails the check. (refs §5.24)

### phax ls on a terminal migrates and commits

Given a made-up phax project on a branch with a clean tree, a committed docs/plans/approvals.json and one committed live plan sidecar stamped 0.20.0; a temporary state root whose record names 0.24.0, with a registered run lacking a cost ledger; stderr on a pseudo-terminal, when `phax ls` runs, then two commits are made, `chore(approvals): migrate approval ledgers to record files` then `chore(artifacts): migrate documents to their current shapes`. The cost ledger is written, and the record names 0.25.0. stderr has one line per migration, and stdout and the exit code equal those of `phax ls` on the migrated project. (refs §5.5, §5.7, §5.8, §5.9, §5.14, §5.23)

### phax ls --json migrates nothing

Given the same project and state root, stderr on a pseudo-terminal, when `phax ls --json` runs, then no commit is made, no ledger or record is written, stderr has no migration line, and stdout is the one JSON document `phax ls --json` prints today. (refs §5.6, §5.19, §5.23)

### A non-terminal phax ls migrates nothing

Given the same project and state root, stderr redirected to a file, when `phax ls` runs, then no commit is made, no ledger or record is written, no migration line is printed, and stdout and the exit code are today's. (refs §5.6, §5.19)

### A dirty sidecar makes phax ls skip with no exit change

Given a project whose stamped-0.20.0 plan sidecar has uncommitted edits, stderr on a pseudo-terminal, when `phax ls` runs, then no commit is created. stderr has one line naming `phax artifact migrate-documents` and the dirty path. stdout and the exit code equal those of `phax ls` today. (refs §5.11, §5.3)

### A failed migration at a non-refusal command keeps its exit

Given a project with a live sidecar whose body is not its sidecar's own rendering, stderr on a pseudo-terminal, when `phax plans lint <that plan>` runs, then stderr has one line naming `phax artifact migrate-documents` and the migration's refusal, the working tree and git log are unchanged, and the exit code is lint's own. (refs §5.12)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-trigger — Which commands run the repository migrations?

- refusal-points-and-run — Exactly the commands that refuse today, plus `phax run` running `document-shapes` before extraction — abandons: the smallest change: one command migrates where it refuses for nothing today, and a read-only `phax artifact status` can commit
- refusal-points — Exactly the commands that refuse today, nothing more — abandons: a run on a plan with an old sidecar: it pays a fresh extraction (the migration re-seeds the cache) and archives the sidecar unmigrated
- every-command — Every command run inside a phax project — abandons: read-only commands staying write-free: `phax ls`, `validate` and `plans lint` start committing to the repository

Recommendation: refusal-points-and-run — Migrating where phax refuses today replaces each refusal with the commit the person would have made, and touches no command that works today. `phax run` is the one place where a missing migration costs something without a refusal: a paid extraction and an archived sidecar left in the old shape. A commit from `artifact status` is the same path-scoped commit its refusal asked for, so accepting it is the smaller loss.

Decision: every-command — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, against the recommendation (refusal-points-and-run). A person who upgrades should have nothing to learn: whatever command they run first in a project brings it up to date, read-only commands included. The limits follow from the other answers: only with stderr a terminal (q-agent), never with `--json`, never inside a phase worktree. Where migrating is unsafe, a command that refuses today still refuses, and any other command skips with one stderr line naming the explicit command and why. phax picks the line over silence, because a silent skip would leave the person as uninformed as before; there is no new refusal and no exit change. An entry's own explicit command does not trigger it, and `phax run` migrates before extraction. Advocate: Migrating only where phax refuses today replaces each refusal with the commit the person would have made, and keeps every command that works today, read-only ones above all, free of writes and commits. Principles: none. Reversibility: costly. Revised: §3, §4, §5.3, §5.5, §5.6, §5.10, §5.11, §5.12, §5.20, §6, §7, §8, §10, §11.

### q-machine-when — Do machine migrations run before the command's own work, or after it?

- before — Before the command's own work — abandons: the command's prompt start: the first acting command after an upgrade waits seconds on a large state root
- after — After the command's own work, before exit — abandons: a correct first answer: the first `phax plans estimate` after the upgrade reads its history before the ledgers are backfilled

Recommendation: before — The only reader of the backfilled ledgers is an acting command, and its first answer after an upgrade should be right. A delay of seconds, once per upgrade, on a person's terminal is the cheaper loss.

Decision: before — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: machine migrations run before the command's own work, so the first answer after an upgrade is right. Advocate: Running them after the command keeps the first command after an upgrade as prompt as any other. Principles: none. Reversibility: cheap. Revised: none.

### q-machine-where — On which commands do machine migrations run (always on a terminal, never with `--json`, never inside a phase worktree)?

- acting — Acting commands only, including `phax run` and `resume` — abandons: migrating on the very first command: a person whose first command is `phax ls` waits for the next acting one, and a run's start is delayed once
- acting-except-run — Acting commands except `phax run` and `resume` — abandons: one rule: a second exclusion list to keep in step with the CLI, for a delay paid once
- any — Any command on a terminal, read-only included — abandons: read-only commands staying write-free: `phax ls` writes ledgers under the state root

Recommendation: acting — The phase guard already classifies every command as read-only or acting, and a unit test keeps that classification complete, so the rule costs no new list. The backfill skips locked runs, so it is safe before a run starts; seconds once is the smaller loss.

Decision: any — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, against the recommendation (acting). Machine migrations run on any command, read-only included, under the same limits as repository migrations: stderr a terminal, never with `--json`, never inside a phase worktree. The first command a person types after an upgrade does the work, whatever it is, and one rule covers both scopes. Advocate: Acting commands only would keep read-only commands write-free and reuse the phase guard's existing classification, at the cost of waiting for the first acting command. Principles: none. Reversibility: costly. Revised: §3, §4, §5.14, §5.19, §6, §8, §10, §11.

### q-agent — How does phax recognise an agent session it spawned outside a phase worktree (authoring, decide, review, adjust run in the main checkout), with no new environment variable?

- tty — Automatic migrations of both scopes run only when stderr is a terminal; otherwise the refusal stays as today — abandons: migrating for scripts and CI: a scripted `phax artifact approve` keeps today's refusal (they have the explicit commands); and a provider whose shell gives commands a pseudo-terminal is read as a person
- session-marker — While phax has an agent session open in a repository it keeps a marker naming its pid; a command in that repository while the pid lives counts as under an agent — abandons: a small change: a new persisted file and stale-marker handling, and the person's own terminal in that repository is treated as an agent during the session
- ancestry — phax checks whether a phax process is among its ancestors — abandons: a cheap check: a process-table read through a new port on every migration point, with platform-specific behaviour

Recommendation: tty — One rule covers both scopes and reuses what machine migrations already need. A refused script loses nothing it has today, and the phase-worktree rule stays the hard guard where an agent writes code. A provider pseudo-terminal is a known gap the planner should check for the three providers before relying on the rule.

Decision: tty — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: automatic migrations of both scopes run only when stderr is a terminal. Otherwise, refusal points refuse as today, and the other commands skip silently. The known gap stays a §10 note for the planner: a provider whose shell gives commands a pseudo-terminal is read as a person. Advocate: A session marker names exactly the processes phax spawned, so a provider's pseudo-terminal cannot pass for a person. Principles: none. Reversibility: cheap. Revised: none.

### q-concurrency — What happens when two phax processes start together after an upgrade?

- idempotent — No lock: each ledger is created exclusively and never rewritten, the record is written atomically, and a repository migration whose commit fails re-detects before refusing (§5 r-repo-race) — abandons: a single reporter: two processes may each print a line for the ledgers it wrote, and both write the same record
- lock — A `machine-migrations` key on the existing Lock port; the loser skips and retries on its next command — abandons: the run-key namespace of the Lock port and stale-lock handling for a crashed migration, to prevent a race that is already harmless

Recommendation: idempotent — The backfill already creates each ledger exclusively and never rewrites one, and the record names the same release whoever writes it. A lock would guard a race whose worst outcome is a second stderr line.

Decision: idempotent — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: no lock. Each ledger is created exclusively, the record is written atomically, and a repository migration whose commit fails re-detects before refusing. Advocate: A lock gives one reporter and one writer of the record, with no reliance on each migration's own idempotence. Principles: none. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- No install hooks: npm `preinstall`/`postinstall` run in the package's directory, pnpm 10 and `--ignore-scripts` skip them, and the release binaries run none.
- Migrations run at use, on any command run with migrations on: stderr a terminal, no `--json`, not inside a phase worktree. Machine migrations run on the first such command after the installed release changes, then the version record is updated. Repository migrations run on any such command inside a phax project, and commit as their own commit. `phax run` migrates before extraction, and an entry's own explicit command does not trigger it.
- Where migrating is unsafe (a dirty or untracked write path, detached HEAD, a rebase/merge/cherry-pick/revert in progress), a refusal point still refuses, exit 12, naming the explicit command and why. Any other command skips with one stderr line and keeps its exit: no new refusal. With migrations off, a refusal point refuses as today and any other command runs as today, silently.
- When the version record is absent, unreadable or older, every machine migration in the catalogue runs; a newer record means no migration and no rewrite. A failed machine migration prints one line, keeps the record and never fails the command.
- One catalogue lists every migration with id, scope (`repository` | `machine`), release, explicit command, detection and runner; adding one later is one entry.
- No hint lines, no listing command, no new environment variable. The explicit commands stay as they are.
- Docs: docs/upgrading.md, linked from site/pages.ts and the README; the README's Artifacts, Cost and Troubleshooting passages and docs/plan-estimate.md say that phax runs the explicit commands by itself.
- Decided by the operator on 2026-10-19: q-trigger every-command and q-machine-where any, both against the recommendation; q-machine-when before, q-agent tty and q-concurrency idempotent, as recommended.

Left open:

- Line wording, the version record's file name and format id, and the docs route.

Constraints:

- Layers: the catalogue and the decision of which migrations apply (from the detections, the version record, the running release and the safety facts) are pure domain; detection and running go through ports (FileSystem, Git, Lock, the registry); lines render through OutputPort.
- Reuse the explicit commands' own use cases (migrateApprovals, migrateDocuments, backfillCostLedgers) and detections (the old ledger paths, scanLiveSidecars, the backfill's run selection) rather than a second definition; a test holds the catalogue, the refusals and the registered commands in step.
- Detached HEAD and an in-progress rebase/merge/cherry-pick/revert need a read through the Git port; the dirty-path check is the existing one.
- The version record is a new persisted format: `$schema`, every field required, appended to FORMAT_IDS with a next.schema.json snapshot, served like the other formats. No back-compat shims.
- Do not add a command, and leave the phase-guard classification unchanged. Migrations no longer follow its read-only/acting split: they run on every command with migrations on, and the guard's phase-worktree test is one of the off conditions.
- phax stays autonomous: no prompt, no input read, no wait; a failed machine migration never changes a command's exit code.
- Fixtures are made up and tests use temporary state roots; no test reads ~/.phax. Tests that need a terminal give stderr a pseudo-terminal.
- Known gap (q-agent): a provider whose shell tool gives commands a pseudo-terminal is read as a person, so its agent's commands would migrate and commit. Check whether Claude Code, Codex and Mistral Vibe do, before relying on the rule.
- The 0.25.0 release waits on this plan: prefer the smallest design that makes these three migrations automatic.
- Every command now pays the detections on start. Keep them to cheap reads (two ledger paths, the sidecar scan, the version record) so read-only commands stay fast when nothing is pending.

## 11. Docs page

Page: docs/upgrading.md

Reader: A person who has just upgraded phax, or is about to, and wants to know what phax will change by itself and what they may still have to do

Example: ## Upgrading phax

You don't run migration commands. After an upgrade, phax brings what it wrote earlier up to date the first time you run any command in a terminal:

- **On your machine** — on the first command (`phax ls`, `phax run`, `phax plans estimate`, …), phax updates what it keeps under `~/.phax` and says so on one line:

      phax 0.24.0 → 0.25.0: wrote 12 cost ledgers

- **In a repository** — on any command run inside it, phax migrates the files, commits them as their own commit, and carries on:

      phax: migrated 3 documents to their current shapes — committed 4f2a9c1

phax migrates nothing when stderr is not a terminal (a script, CI or an agent), with `--json`, or inside a phase worktree. Run the commands by hand there.

### When phax does not migrate

phax will not commit for you when a file it would rewrite has uncommitted changes, HEAD is detached, or a rebase or merge is in progress. A command that refused before (`phax artifact approve`, `status`, `decide`, `phax plans status`, `phax run`) still refuses and names the command. Any other command says on one line why it did not migrate, and carries on. Commit or stash your changes, finish the rebase, or run the command by hand.

### Migrations by release

| Release | Migration | Scope | Run by hand |
| --- | --- | --- | --- |
| 0.25.0 | document-shapes | repository | `phax artifact migrate-documents` |
| 0.25.0 | cost-ledgers | machine | `phax cost backfill` |
| 0.19.0 | approval-ledgers | repository | `phax artifact migrate-approvals` |

## 12. Decision log

- 2026-10-19 q-trigger decided every-command — operator (Rémy Loubradou) — revised 14 sections
- 2026-10-19 q-machine-when decided before — operator (Rémy Loubradou)
- 2026-10-19 q-machine-where decided any — operator (Rémy Loubradou) — revised 8 sections
- 2026-10-19 q-agent decided tty — operator (Rémy Loubradou)
- 2026-10-19 q-concurrency decided idempotent — operator (Rémy Loubradou)
