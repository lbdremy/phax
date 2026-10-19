---
status: Abandoned
date: 2026-10-19
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Upgrade hints

## 1. Context

Some phax upgrades leave work behind that only a command can do. Since 0.19.0, `phax artifact migrate-approvals` splits the old ledgers `docs/plans/approvals.json` and `docs/specs/approvals.json` into one record file per artifact. Release 0.25.0 adds two more: `phax artifact migrate-documents`, which rewrites the live spec and plan sidecars stamped below their format's current shape (once per repository), and `phax cost backfill`, which writes a cost ledger for every registered run that has none (once per state root; only `phax plans estimate` reads those ledgers). The order matters: migrate-documents refuses while an old approval ledger exists.

Today the only signal is a refusal. `phax artifact approve` and `reopen` refuse with exit 12 until migrate-documents has run ("Approval refused: docs/plans/x.json is stamped 0.20.0 — run `phax artifact migrate-documents` first"), and approve and `run` refuse with exit 12 while an old ledger exists. Nothing at all mentions `phax cost backfill`. The GitHub release notes are generated from pull requests and have no upgrade section.

Two other commands refresh files after an upgrade: `phax schema upgrade` (phax.schema.json, phax.user.schema.json) and `phax skills install` (the bundled skills, copied into an agent's skill directory). Neither file carries a version stamp.

Every phax subcommand already passes through one hook before it runs, where the phase guard refuses lifecycle commands inside a phase worktree. Commands with `--json` print one document on stdout and warnings on stderr. phax reads no environment variable for its configuration.

Ground read:

- `src/app/unmigratedDocuments.ts` — scanLiveSidecars detects live sidecars stamped below their format's current shape; refuseUnmigratedDocuments refuses approve and reopen naming `phax artifact migrate-documents`
- `src/domain/errors.ts` — DocumentMigrationRequiredError's message: "… — run `phax artifact migrate-documents` first"
- `src/app/migrateDocuments.ts` — migrate-documents refuses while an old approval ledger exists, so migrate-approvals must run first
- `src/app/migrateApprovals.ts` — migrate-approvals splits docs/plans/approvals.json and docs/specs/approvals.json into record files in one commit
- `src/app/approvalRecordStore.ts` — refuseOldApprovalLedgers: "… is an approval ledger from an older phax — run `phax artifact migrate-approvals` first"
- `src/app/costBackfill.ts` — backfill writes a ledger for every registered run whose folder exists, has no ledger and whose lock is not active; archived runs included
- `src/cli/program.ts` — a preAction hook already runs before every subcommand (the --usage flag, the phase guard)
- `src/domain/security/phaseGuard.ts` — every command path is classified allowed or refused inside a phase worktree; an unclassified command fails a unit test
- `src/app/initProject.ts` — `phax schema upgrade` rewrites phax.schema.json and phax.user.schema.json from the binary; the files carry no version stamp
- `src/app/skills/installSkill.ts` — `phax skills install` compares bytes per target and scope; installed copies carry no version stamp and may be edited on purpose
- `src/schemas/release.ts` — PHAX_RELEASE is 0.25.0; the release ledger ends at 0.24.0
- `.github/workflows/release.yml` — softprops/action-gh-release with generate_release_notes: true and no body
- `site/pages.ts` — docs pages from docs/ files are listed under `files` with a route and a description
- `README.md` — Environment: phax honours no environment variable except PHAX_E2E_RUN; Troubleshooting already explains migrate-approvals by its refusal

## 2. Problem

A person who upgrades phax learns about a pending step only when a command refuses, in the middle of the work the refused command was for, and never learns about an optional one. In 0.25.0 that means a person's first approval after the upgrade is refused, and `phax plans estimate` reports a thin history with no word on how to fill it. The maintainer will not release 0.25.0 until phax says this itself. Each later release that adds a step would repeat the problem unless the steps are declared in one place that phax, its tests and its docs all read.

## 3. Product goal

After an upgrade, phax tells the person at the terminal which upgrade steps are pending in the current repository and on the machine, and names the command for each, before any command refuses. One catalogue declares every step, so the hints, `phax migrations`, the refusals and the upgrading page all name the same commands, and adding a step in a later release means adding one entry.

> A hint tells the person at the terminal what to run; it never acts, never blocks, and never reaches an agent or a script.

## 4. Terminology

- **upgrade step** — A command a person runs once after an upgrade to bring a repository or a state root up to the installed phax: an entry in the catalogue.
- **catalogue** — The one list of upgrade steps, in release order. Each entry has an id, a scope, the release that introduced it, a need, a detection and the command that clears it.
- **scope** — Where a step applies: `repository` (the phax project the command runs in, found by its phax.json) or `machine` (the state root in effect: `state.root`, else ~/.phax).
- **need** — `required`: a phax command refuses until the step has run. `optional`: only a feature that is not always used needs it.
- **pending** — A step whose detection finds work its command would do. `done`: the detection finds none. `unknown`: the detection failed. `not-applicable`: a repository step outside any phax project.
- **hint** — One line on stderr naming a pending step and its command.
- **interactive terminal** — A command whose stderr is a terminal.
- **last-seen record** — A file under the state root naming the last phax version that ran the machine check there.

## 5. Functional requirements

### 5.1 One catalogue

The system shall declare every upgrade step once, in one catalogue, with an id, a scope that is exactly `repository` or `machine`, the release that introduced it, a need that is exactly `required` or `optional`, its detection, and the command that clears it.

### 5.2 The steps of 0.25.0

The catalogue shall hold, in this order: `approval-ledgers` (repository, required, since 0.19.0, pending while docs/plans/approvals.json or docs/specs/approvals.json exists, cleared by `phax artifact migrate-approvals`); `document-shapes` (repository, required, since 0.25.0, pending while a live spec or plan sidecar is stamped below its format's current shape or has no stamp, cleared by `phax artifact migrate-documents`); `cost-ledgers` (machine, optional, since 0.25.0, pending while a registered run whose folder exists and whose lock is not active has no cost ledger, cleared by `phax cost backfill`).

### 5.3 Catalogue and CLI in step

The system shall name, as each step's command, a command registered in the phax CLI.

### 5.4 Repository check on every interactive command

WHEN a phax subcommand starts in an interactive terminal inside a phax project THE system SHALL print a hint for each pending repository step.

### 5.5 Machine check after a version change

WHEN a phax subcommand starts in an interactive terminal and the installed version differs from the version in the state root's last-seen record, or there is no readable record, THE system SHALL print a hint for each pending machine step.

### 5.6 Recording the version seen

WHEN the machine check has run THE system SHALL write the installed version to the state root's last-seen record.

### 5.7 Hint line

The system shall print each hint as one stderr line naming the step's command verbatim, its need, the release that introduced it and what the detection found, followed by one line naming `phax migrations` whenever any hint was printed.

### 5.8 Release order

The system shall print hints in catalogue order.

### 5.9 Hints leave the command alone

The system shall print hints on stderr only, and shall leave a command's stdout, exit code and input unchanged by them.

### 5.10 Hints never act

The system shall never run, or offer to run, an upgrade step it hints at.

### 5.11 A failed detection is silent

IF detecting a step fails, or the last-seen record cannot be written, THEN the system SHALL print no hint for that step and run the command as it would without hints.

### 5.12 Quiet without a terminal

WHILE stderr is not a terminal THE system SHALL print no hint and write no last-seen record.

### 5.13 Quiet in a phase worktree

WHILE a command runs inside a phase worktree THE system SHALL print no hint and write no last-seen record, whatever the phase guard allows.

### 5.14 Quiet under an agent

WHILE a command runs under an agent session that phax spawned (a phase, an authoring, decide, review or adjust session) THE system SHALL print no hint and write no last-seen record.

### 5.15 A clearing command is not told to run itself

WHEN the command that clears a step runs THE system SHALL print no hint for that step.

### 5.16 `phax migrations` lists every step

WHEN `phax migrations` runs THE system SHALL print every catalogue step with its scope, need, release, command and status (`done`, `pending`, `unknown` or `not-applicable`), detecting each step whatever the last-seen record says and writing no last-seen record.

### 5.17 `phax migrations` exit

IF a required step is `pending` or `unknown` THEN `phax migrations` SHALL exit 1, and otherwise exit 0.

### 5.18 `phax migrations` inside a phase worktree

The phase guard shall allow `phax migrations` inside a phase worktree, as a read-only command.

### 5.19 Refusals and hints name the same command

The system shall name, in the refusals for an old approval ledger and for an unmigrated sidecar, the same command as the matching step's hint, and shall keep those refusals and their exit code 12.

### 5.20 Last-seen record format

The system shall write the last-seen record as a registered, snapshotted persisted format with a `$schema` and every field required, and shall treat a record it cannot decode as no record.

### 5.21 Upgrading page

The upgrading page shall list every catalogue step under the release that introduced it, with its scope, need and command.

### 5.22 Release notes link

WHERE a release is published to GitHub THE release notes SHALL begin with a line pointing to `phax migrations` and the upgrading page, above the notes generated from pull requests.

## 6. Surface

### cli: hint lines on stderr — indicative

    $ phax ls            # stderr is a terminal, inside a phax project, first command after upgrading to 0.25.0
    phax: upgrade step pending (required since 0.25.0) — run `phax artifact migrate-documents`: 3 live sidecars are stamped below their current shape
    phax: upgrade step pending (optional since 0.25.0) — run `phax cost backfill`: 12 runs have no cost ledger, which `phax plans estimate` reads (shown once per upgrade)
    phax: `phax migrations` lists every upgrade step
    <phax ls output, on stdout, unchanged>

    Normative: one line per pending step, on stderr, in catalogue order; each names the command verbatim, `required` or `optional`, and the release; the `phax migrations` line follows any hint. Wording, prefix and punctuation are indicative.

### cli: phax migrations — normative

    $ phax migrations
    phax 0.25.0 — upgrade steps

    repository  /work/acme
      approval-ledgers  required  0.19.0  phax artifact migrate-approvals  done
      document-shapes   required  0.25.0  phax artifact migrate-documents  pending: 3 live sidecars are stamped below their current shape
    machine     ~/.phax
      cost-ledgers      optional  0.25.0  phax cost backfill               pending: 12 runs have no cost ledger
    $? = 1    # a required step is pending or unknown; 0 otherwise

    Outside a phax project the repository steps read `not-applicable`.

    Normative: the command name, the four statuses `done | pending | unknown | not-applicable`, the step ids, and exit nonzero exactly when a required step is pending or unknown. The layout and the exit code's value (1) are indicative.

### cli: phax migrations --json — normative

    $ phax migrations --json
    {
      "version": "0.25.0",
      "steps": [
        { "id": "approval-ledgers", "scope": "repository", "introducedIn": "0.19.0", "need": "required", "command": "phax artifact migrate-approvals", "status": "done", "detail": null },
        { "id": "document-shapes", "scope": "repository", "introducedIn": "0.25.0", "need": "required", "command": "phax artifact migrate-documents", "status": "pending", "detail": "3 live sidecars are stamped below their current shape" },
        { "id": "cost-ledgers", "scope": "machine", "introducedIn": "0.25.0", "need": "optional", "command": "phax cost backfill", "status": "pending", "detail": "12 runs have no cost ledger" }
      ]
    }

    Normative: the step field names and their allowed values. `detail` wording is indicative.

### file: <state root>/last-seen-version.json — indicative

    {
      "$schema": "https://docs.phax.run/schemas/last-seen-version/0.25.0.json",
      "version": "0.25.0"
    }

    Normative: a `$schema` naming a registered format, and a required `version`. File name and format id are indicative.

### config: README Environment section — indicative

before:

    phax reads no environment variable for its configuration: everything is in `phax.json`, its layers and `~/.phax/`. The one variable it honours, `PHAX_E2E_RUN=1`, enables its own end-to-end tests.

after:

    phax reads no environment variable for its configuration: everything is in `phax.json`, its layers and `~/.phax/`. It honours two variables: `PHAX_E2E_RUN=1` enables its own end-to-end tests, and `PHAX_AGENT_SESSION=1`, which phax sets on every agent it spawns, keeps upgrade hints quiet there.

    (Only if q-agent-quiet is decided `marker`. Variable name indicative.)

### file: .github/workflows/release.yml — indicative

before:

          - name: Create GitHub Release
            uses: softprops/action-gh-release@… # v2
            with:
              # Notes from the merged pull requests, grouped by .github/release.yml.
              generate_release_notes: true

after:

          - name: Create GitHub Release
            uses: softprops/action-gh-release@… # v2
            with:
              # Prepended to the notes generated from the merged pull requests.
              body: "Upgrading from an earlier phax? Run `phax migrations`, and see https://docs.phax.run/guide/upgrading for the steps each release adds."
              generate_release_notes: true

    (Only if q-release-notes is decided `link`. Wording and route indicative; a link above the generated notes normative.)

## 7. Non-goals

- Running an upgrade step automatically, offering to run it, or prompting.
- Hints for `phax schema upgrade` and `phax skills install`. Neither file carries a version stamp, so its content alone cannot tell a copy older than the binary from one written by a teammate's newer phax or edited on purpose, and a hint could tell a person to downgrade a committed file. A step can be added once those files carry a stamp.
- Telling a person that a newer phax is published (no network check).
- Detecting steps in archived artifacts, in other repositories, or on a state root other than the one in effect.
- Changing the wording or exit code of the existing refusals for old approval ledgers and unmigrated sidecars.
- A switch to turn hints off. Optional hints show once per upgrade, and required ones repeat until the one command that clears them has run, since a command will refuse until then anyway.
- Telemetry on hints.

## 8. Acceptance criteria

### The catalogue is observable

Given a made-up phax project and a temporary state root, when `phax migrations --json` runs, then stdout is one JSON document whose `steps` are `approval-ledgers`, `document-shapes`, `cost-ledgers` in that order, each with `id`, `scope` (`repository` or `machine`), `introducedIn`, `need` (`required` or `optional`), `command`, `status` and `detail`, carrying the scope, need, release and command §5 declares. (refs §5.1, §5.2)

### Catalogue and CLI in step

Given the catalogue and the registered CLI, when the catalogue contract test runs, then every step's `command` is a registered command path, and a step naming an unregistered command fails the test. (refs §5.3)

### A pending repository step is named

Given a phax project with one live plan sidecar that has no stamp, and stderr on a pseudo-terminal, when `phax ls` runs, then stderr has one line naming `phax artifact migrate-documents`, `required` and 0.25.0, followed by the `phax migrations` line, and stdout and the exit code equal those of `phax ls` in the same project with the sidecar migrated. (refs §5.4, §5.7, §5.9)

### A required hint repeats until cleared

Given the project of ac-repo-hint, when `phax ls` runs twice, then `phax artifact migrate-documents` runs, then `phax ls` runs again, then both first runs print the migrate-documents hint and the last run prints none. (refs §5.4)

### Hints in release order

Given a phax project with docs/specs/approvals.json and an unstamped live sidecar, stderr on a pseudo-terminal, when any subcommand runs, then the `phax artifact migrate-approvals` line comes before the `phax artifact migrate-documents` line. (refs §5.8)

### An optional machine hint shows once per upgrade

Given a temporary state root whose last-seen record names 0.24.0, or has none, with a registered run whose folder exists without a cost ledger, and stderr on a pseudo-terminal, when a subcommand runs, then another, then the first prints a hint naming `phax cost backfill`, `optional` and 0.25.0, and leaves a last-seen record whose `version` is 0.25.0; the second prints no cost-ledgers hint. (refs §5.5, §5.6)

### The detection matches what backfill would write

Given a temporary state root whose only runs without a cost ledger are one with an active lock and one whose folder is missing, and no last-seen record, when a subcommand runs with stderr on a pseudo-terminal, then no cost-ledgers hint is printed. (refs §5.2)

### Quiet without a terminal

Given pending repository and machine steps and no last-seen record, when a subcommand runs with stderr redirected to a file, then the file has no hint line and no last-seen record exists. (refs §5.12)

### Quiet in a phase worktree

Given a phase worktree (a linked worktree with .phax-context/) whose project has a pending step, stderr on a pseudo-terminal, when `phax artifact status` runs there, then no hint is printed and no last-seen record is written. (refs §5.13)

### Quiet under an agent

Given a pending step, and a command run as a child of an agent session phax spawned, with stderr on a pseudo-terminal, when the agent's shell runs `phax artifact status`, then no hint is printed and no last-seen record is written. (refs §5.14)

### A failed detection is silent

Given a temporary state root whose registry is corrupt, no last-seen record, and stderr on a pseudo-terminal, when `phax artifact status` runs, then no cost-ledgers hint is printed and the exit code equals that of the same command with stderr redirected. (refs §5.11)

### `--json` output untouched

Given pending steps and stderr on a pseudo-terminal, when `phax ls --json` runs, then stdout parses as one JSON document byte-identical to the same command's stdout with stderr redirected. (refs §5.9)

### Hints never act

Given a phax project with pending repository steps, a state root with a pending machine step, and stdin closed, when `phax ls` runs with stderr on a pseudo-terminal, then it completes without reading input, the git log and the sidecars are unchanged, and no cost ledger is written. (refs §5.10, §5.9)

### A clearing command is not told to run itself

Given a phax project with an unstamped live sidecar, stderr on a pseudo-terminal, when `phax artifact migrate-documents` runs, then stderr has no document-shapes hint. (refs §5.15)

### `phax migrations` exits on required steps only

Given first a project where only `document-shapes` is pending, then one where only `cost-ledgers` is pending, when `phax migrations` runs in each, then it exits nonzero in the first and 0 in the second, lists every step with its status both times, and writes no last-seen record. (refs §5.16, §5.17)

### `phax migrations` outside a project

Given a directory outside any phax project, when `phax migrations` runs, then `approval-ledgers` and `document-shapes` read `not-applicable` and `cost-ledgers` reads its status on the default state root. (refs §5.16)

### `phax migrations` runs in a phase worktree

Given a phase worktree, when `phax migrations` runs, then the phase guard does not refuse it. (refs §5.18)

### Refusal and hint name the same command

Given a phax project with an unstamped live sidecar, then one with docs/plans/approvals.json, when `phax artifact approve` runs in each, then each refusal exits 12 and contains the `command` of `document-shapes`, then of `approval-ledgers`, verbatim. (refs §5.19)

### Last-seen record format

Given a last-seen record written by the machine check, and one missing `version`, when the format's snapshot test runs and the next interactive subcommand reads the second, then the first carries a `$schema` naming the registered format at its current stamp, with every field required in the snapshot, and the second counts as no record: the machine check runs and rewrites it. (refs §5.20)

### Upgrading page lists the catalogue

Given the catalogue and docs/upgrading.md, when the docs check runs, then the page lists every step's command under its release with its scope and need, and a catalogue step missing from the page fails the check. (refs §5.21)

### Release notes point to the steps

Given the release workflow, when its release step is read, then it publishes a body naming `phax migrations` and the upgrading page above the generated notes. (refs §5.22)

## 9. Open questions

### q-when — When does phax check for pending steps?

- split — Repository steps on every interactive subcommand; machine steps only when the installed version differs from the state root's last-seen record — abandons: one rule for both scopes: two triggers to explain, plus a new persisted record per state root
- version-change — Both scopes only after a version change, with a last-seen record per state root and per repository — abandons: repetition of required hints: a person who ignores the one hint is next told by the refusal, which is the problem this spec exists to remove; and a per-repository record keyed under the state root
- every-command — Both scopes on every interactive subcommand, with a dismiss command for optional ones — abandons: a bounded cost per call: the machine detection checks every registered run's folder, archived ones included, and that list only grows; plus a dismiss command and its state

Recommendation: split — Repository detection reads only the live sidecars and two ledger paths, so running it on every interactive command costs little, and a required hint repeats until the one command that clears it has run. The machine detection grows with the registry, and its one step is optional, so showing it once per upgrade is both cheap and enough. Of the losses, a second trigger and one small record is the cheapest.

### q-agent-quiet — How does phax keep hints away from agents it spawned outside a phase worktree (authoring, decide, review-code, adjust-plan sessions)?

- marker — phax sets a marker variable on every agent process it spawns, and hints stay quiet wherever it is set, on top of the terminal and phase-worktree rules — abandons: phax's rule of honouring no environment variable: a second variable joins PHAX_E2E_RUN in the README
- tty-only — Rely on the terminal rule and the phase-worktree rule alone — abandons: quiet under a provider whose shell tool gives commands a pseudo-terminal: its agent would be told to migrate, breaking the guiding rule

Recommendation: marker — A marker phax puts on its own children is inherited by everything the agent runs, which is the behaviour wanted here, unlike the phase-worktree case where inheritance was the reason to avoid a variable. It works whatever terminal the provider gives its shell. One documented variable that phax itself sets, and that is not configuration, is the smaller loss.

### q-release-notes — What do the GitHub release notes say about upgrade steps?

- link — A fixed line above the generated notes naming `phax migrations` and the upgrading page — abandons: naming this release's own steps on the release page: the reader follows a link to see them
- generated — An Upgrade section generated at release time from the catalogue entries introduced since the previous tag — abandons: a small release: a generation step that must run, and be tested, before 0.25.0 can ship
- none — Nothing; the CLI hints and the docs page are enough — abandons: the one page people read before upgrading

Recommendation: link — The CLI hint already reaches everyone who upgrades, and the upgrading page lists the steps by release from the same catalogue. A fixed line costs one workflow input and cannot fail the release. A generated section can follow later as its own change.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Three steps, in this order: approval-ledgers, document-shapes, cost-ledgers. `phax schema upgrade` and `phax skills install` are left out because their files carry no stamp.
- Hints go only to stderr, only in an interactive terminal, never inside a phase worktree, and never change stdout, the exit code or input. They never run a step.
- Required hints repeat until cleared. An optional machine hint shows once per version change, and there is no off switch.
- `phax migrations` (with `--json`) lists every step, exits nonzero exactly when a required step is pending or unknown, and is allowed inside a phase worktree.
- The existing refusals stay as they are; they and the hints name the same command.
- Docs: docs/upgrading.md, linked from site/pages.ts and from the README's Install section.

Left open:

- q-when, q-agent-quiet and q-release-notes (above).
- Exact hint wording, the last-seen file name and format id, the docs route, and the value of the nonzero exit code.

Constraints:

- Layers: the catalogue, and the decision of which hints to print from the detections, the terminal and worktree facts and the last-seen version, are pure domain. Detection reads only through ports (FileSystem, Lock, the registry), and the CLI hook renders the hints through OutputPort.
- Detection must agree with what the clearing command would do. Reuse scanLiveSidecars for document-shapes, the old-ledger paths for approval-ledgers, and the backfill's own selection of runs for cost-ledgers, rather than writing a second definition.
- The last-seen record has a `$schema`, every field required, and a registered format with a snapshot, served like the other formats.
- Classify `migrations` in PHASE_GUARD_CLASSIFICATION; the existing unit test fails until it is.
- phax stays autonomous: hint detection never waits on anything, its errors are swallowed per step, and the machine detection runs only after a version change.
- Fixtures are made up and tests use temporary state roots; no test reads ~/.phax. Tests that need a terminal give stderr a pseudo-terminal.
- Check that softprops/action-gh-release prepends `body` to the generated notes before relying on it.
- The 0.25.0 release waits on this plan: prefer the smallest design that makes these three steps visible.

## 11. Docs page

Page: docs/upgrading.md

Reader: A person who has just upgraded phax, or is about to, and wants to know what to run in each repository and on each machine

Example: ## Upgrading phax

After an upgrade, phax names any pending step on the first command you run in a terminal:

    phax: upgrade step pending (required since 0.25.0) — run `phax artifact migrate-documents`: 3 live sidecars are stamped below their current shape

`phax migrations` lists every step and its status.

### 0.25.0

| Step | Scope | Need | Command |
| --- | --- | --- | --- |
| document-shapes | repository | required | `phax artifact migrate-documents` |
| cost-ledgers | machine | optional | `phax cost backfill` |

### 0.19.0

| approval-ledgers | repository | required | `phax artifact migrate-approvals` |
