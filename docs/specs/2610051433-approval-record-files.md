---
status: Approved
date: 2026-10-05
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-05
  baseline: 90d7643
---
# Approval Record Files — One File per Approval Record

## 1. Context

phax records an approval when `phax artifact approve` runs and reads it back for plan staleness and for the spec approval chain. All records of a kind share one JSON ledger keyed by artifact path: `docs/plans/approvals.json`, where a plan record holds `planFingerprint`, `approvedAt`, `baseline` (a full 40-hex sha) and `sourceSpec` (null, or `{ path, fingerprint }`), and `docs/specs/approvals.json`, where a spec record holds `specFingerprint`, `approvedAt` and `baseline`.

Every transition that touches a record reads the whole ledger, edits one key and writes the whole ledger back. Approve upserts the artifact's key, a plan's reopen removes it, and complete and abandon remove it beside the move into `archive/`. The ledger path is part of each of these transitions' write-sets, so the path-scoped auto-commit carries it. A run's completion applies the same transitions inside the run worktree: the plan's, then its source spec's where the chain gate allows.

In this repository today, the plan ledger is a `$schema` document (`plan-approvals/0.18.0`) with one record, and the spec ledger is still pre-schema (`"version": 1`) with five records. steme-lab has an empty, pre-schema plan ledger and no spec ledger. phax reads both forms: a `$schema` document through its current decoder, and a `version: 1` document through the frozen pre-schema decoder. It always writes the current form back. Both formats, `plan-approvals` and `spec-approvals`, are published in `@lbdremy/phax-schemas`, which reads every shape a release ever wrote.

Since 2026-10-05 (PR #117), a missing ledger reads as empty. An unreadable one (written by a newer release, undecodable, or not JSON) is refused with `ApprovalLedgerUnreadableError`, exit 12, and is never rewritten.

A headless-authored artifact's JSON sidecar already sits beside it under the same base name with `.json` (`<YYMMDDHHMM>-<slug>[-plan].json`). The walks of `docs/plans/` (dependent-plan check, `phax plans status`) keep only `.md` entries, which is how they skip `archive/`. Artifact classification works by path prefix, so any path under `docs/plans/` or `docs/specs/` counts as an artifact path.

Ground read:

- `NEXT_STEPS.md` — The 'A run's completion conflicts with approvals made on main during the run' entry (decided 2026-10-05: one file per record) and the 1.0 persisted-format stability promise that names approvals.json.
- `src/domain/artifact/lineage.ts` — APPROVALS_FILE_PATH and SPEC_APPROVALS_FILE_PATH (the two shared ledgers), computeStaleness, ApprovalRecordLike and specApprovalVerdict.
- `src/domain/artifact/writeSet.ts` — transitionWriteSet adds the whole ledger path to the write-set of a plan's approve, reopen and terminal transitions, and of a spec's approve and terminal transitions.
- `src/domain/artifact/document.ts` — classifyArtifactPath classifies any path under docs/plans/ or docs/specs/ by prefix, so a record file under an approvals/ subfolder would today classify as an artifact; archivePathFor.
- `src/domain/artifact/sidecar.ts` — sidecarPathFor: the headless sidecar takes the artifact's base name with .json beside it, so the record cannot live there.
- `src/app/approvalRecordStore.ts` — Every put/remove reads the whole ledger, edits one key and rewrites it; a missing ledger reads as empty, an unreadable one fails with ApprovalLedgerUnreadableError.
- `src/app/artifactStatus.ts` — Transitions write and remove records; spec approval info for artifact status; findDependentPlans walks docs/plans/ keeping only .md entries.
- `src/app/completeRunArtifacts.ts` — Run completion transitions the plan, then its source spec when the chain gate allows, through transitionArtifact in the run worktree — the commit that removes ledger entries on the run branch.
- `src/app/planStaleness.ts` — computeStalenessForPlan reads the whole plan ledger to find one record; plansStalenessReport walks docs/plans/ keeping only .md entries.
- `src/app/lintPlan.ts` — plans lint has no tree walk: it classifies the one path it is given and validates it as an artifact when classified.
- `src/schemas/approvalRecord.ts` — Plan record fields: planFingerprint, approvedAt, baseline (40-hex), sourceSpec (null or { path, fingerprint }); ledger file format plan-approvals.
- `src/schemas/specApprovalRecord.ts` — Spec record fields: specFingerprint, approvedAt, baseline (40-hex); ledger file format spec-approvals.
- `src/schemas/persisted.ts` — readPersisted: a $schema document is read by the current decoder, a document without $schema by the frozen pre-schema decoder; a newer release is refused; withSchemaUrl stamps the writer's $schema.
- `packages/schemas/src/formats/repository.ts` — plan-approvals and spec-approvals are published formats with a pre-schema shape and a current $schema shape.
- `phax.usage.kdl` — cmd artifact (status, approve, stale, abandon, complete, reopen, new, schema) and cmd plans (status, overlap, lint); help text names docs/plans/approvals.json and docs/specs/approvals.json; lifecycle refusals exit 12.
- `docs/plans/approvals.json` — This repository's plan ledger: a $schema document (plan-approvals/0.18.0) with one record.
- `docs/specs/approvals.json` — This repository's spec ledger: still pre-schema ("version": 1) with five records — not a $schema document as the brief assumed.
- `docs/specs/2610040727-approval-ground.md` — Draft spec whose §9 Q2 (recognising the own approval write) and Q4 (comparing the ledger as records or bytes) exist because a plan's own record sits inside the shared ledger.
- `src/domain/artifact/render.ts` — Current plans status report shape: '=== Plan Staleness Report ===', one line per Approved plan, missing-record hint naming phax artifact approve.
- `README.md` — Persisted formats table rows for plan-approvals and spec-approvals; known issue 'A plan is stale right after its approval'; exit code 12 = artifact lifecycle refusal.

## 2. Problem

Every record of a kind lives in one JSON object, so any two transitions of different artifacts edit the same file. This was found on 2026-10-03 on PR #112. On the run branch, a run's completion commit removed the completed plan's entry from `docs/plans/approvals.json`. Meanwhile, approving another plan on main edited the same object. The PR conflicted, and CI never ran until the branch was rebased by hand, keeping main's ledger minus the completed entry. The spec ledger has the same exposure whenever a run completes its source spec while another spec is approved on main.

The conflict is structural, so it cannot be patched around:
- A git merge driver lives only in each clone's local config, and GitHub's mergeability check never runs one.
- Keeping completed records and ignoring them on read still leaves two edits to adjacent lines of one object, which conflict, and stale records pile up.

The shared ledger also leaks into staleness. A plan whose footprint names `docs/plans/approvals.json` reads any other plan's approval, reopen or completion as a ground change, and its own approval too. The Draft spec `approval-ground` works around this with a ledger comparison (its §9 Q2 and Q4).

This is a persisted-format change. It must land before the 1.0 persisted-format stability promise freezes the record formats.

## 3. Product goal

Every approval record lives in its own file, beside the artifacts of its kind and named after its artifact, so a transition writes only the files of the artifact it transitions. Two branches that approve, reopen, complete or abandon different artifacts then never edit the same file. They merge in either order without conflict, both on the command line and in GitHub's mergeability check. Existing ledgers move to the new layout through one explicit migration command that makes one commit. After that, phax never writes a ledger again.

> A transition touches its own artifact's files and no other artifact's.

## 4. Terminology

- **Approval record** — The facts phax records when an artifact is approved. For a plan: `planFingerprint`, `approvedAt`, `baseline`, `sourceSpec`. For a spec: `specFingerprint`, `approvedAt`, `baseline`. Both now also carry `artifact`.
- **Record file** — A file holding exactly one approval record: `docs/plans/approvals/<plan file name, .md replaced by .json>` or `docs/specs/approvals/<spec file name, .md replaced by .json>`.
- **Own record file** — The record file whose name derives from a given artifact's path. It is the only record file a transition of that artifact may create, replace or delete.
- **Old ledger** — `docs/plans/approvals.json` or `docs/specs/approvals.json`, in any released shape: pre-schema `version: 1`, or `$schema` `plan-approvals` / `spec-approvals`. After this change, phax reads an old ledger only to migrate it.
- **Orphan record** — A record file whose artifact does not exist. The artifact is the live path the record file's name derives.
- **Unreadable record** — A record file that exists but is not JSON, fails to decode, carries no `$schema`, names a release newer than the running phax, or has an `artifact` that differs from the path its file name derives.
- **Live artifact path** — A path directly under `docs/plans/` (a plan) or `docs/specs/` (a spec) that ends in `.md`. Paths under `archive/` or `approvals/` are not live artifact paths.
- **Write-set** — The paths a transition writes, creates or deletes, and commits in its single path-scoped commit, under the clean-file precondition.

## 5. Functional requirements

### 5.1 One record file per artifact

The system shall store each approval record in its own record file: a plan's at `docs/plans/approvals/<plan file name with .md replaced by .json>`, and a spec's at `docs/specs/approvals/<spec file name with .md replaced by .json>`.

### 5.2 Lookup from the artifact path alone

The system shall locate an artifact's approval record from the artifact's path alone, without reading any other record file or any index.

### 5.3 Record file format

The system shall write each record file as a `$schema` document of format `plan-approval-record` or `spec-approval-record` at the running release. The document shall carry the artifact's repo-relative path in `artifact` and every field of the record it replaces, and no other key.

### 5.4 Record files are never artifacts

IF a path lies under `docs/plans/approvals/` or `docs/specs/approvals/` THEN the system SHALL refuse it as an artifact path and SHALL never list, validate, transition or archive it as a spec or plan.

### 5.5 Approve writes its own record file

WHEN an artifact is approved or re-approved THE system SHALL create or replace its own record file in the transition commit, beside the artifact and its sidecar.

### 5.6 Reopen deletes its own record file

WHEN a plan is reopened THE system SHALL delete its own record file in the transition commit.

### 5.7 Complete and abandon delete their own record file

WHEN an artifact is completed or abandoned THE system SHALL delete its own record file in the same commit as the artifact's move into `archive/`, and SHALL NOT move any record file into `archive/`.

### 5.8 No transition touches another artifact's record

The system shall never create, rewrite or delete any record file other than the transitioned artifact's own, during a transition or a run's completion.

### 5.9 Path-scoped commit with a record file

WHEN a transition's write-set includes its own record file THE system SHALL apply the clean-file precondition to it and commit it path-scoped. This holds when the transition deletes the record file, and when the file is absent both before and after the transition.

### 5.10 A missing record file is no record

IF an artifact's own record file does not exist THEN the system SHALL treat the artifact as having no approval record (a plan reports missing-record; a spec is unrecorded), as it does today for an absent ledger entry.

### 5.11 An unreadable record file is refused, never rewritten

IF an artifact's own record file is unreadable THEN the system SHALL refuse the operation with `ApprovalLedgerUnreadableError` (or its renamed successor) and exit code 12, naming the record file, and SHALL leave the file byte-identical.

### 5.12 A record must name its own artifact

IF a record file's `artifact` differs from the live artifact path its file name derives THEN the system SHALL treat the record file as unreadable.

### 5.13 Orphan records warn

WHEN `phax plans status` or `phax artifact status` runs and a record file of the reported kind is an orphan THE system SHALL print a warning naming the record file to delete, without changing the exit code or any file; and `phax plans status --json` SHALL carry every orphan plan record in a required `orphanRecords` array beside `report` (empty when there is none), each entry naming the record file and the artifact path it derives.

### 5.14 Refusal while an old ledger exists

WHILE `docs/plans/approvals.json` or `docs/specs/approvals.json` exists THE system SHALL refuse the following with exit code 12 before writing anything: every `phax artifact` transition, `phax artifact status`, `phax plans status`, and `phax run`'s staleness gate and run completion. The refusal SHALL name the old ledger and `phax artifact migrate-approvals`.

### 5.15 Migration splits ledgers in one commit

WHEN `phax artifact migrate-approvals` runs and an old ledger exists THE system SHALL create one record file per ledger entry and delete the ledger, in a single commit containing exactly those paths for both ledgers. Each record file SHALL equal its entry field for field, with `artifact` set to the entry's key.

### 5.16 Migration reads every released ledger shape

The migration command shall read an old ledger in every released shape (pre-schema `version: 1`, and every `$schema` release of `plan-approvals` and `spec-approvals`) and shall write record files only in the current record formats.

### 5.17 Nothing to migrate

WHEN `phax artifact migrate-approvals` runs and neither old ledger exists THE system SHALL report that there is nothing to migrate and exit 0 without writing or committing anything.

### 5.18 Empty ledger

WHEN `phax artifact migrate-approvals` runs on an old ledger with no records THE system SHALL delete the ledger, create no record file, and commit the deletion.

### 5.19 Migration keeps orphan entries

WHEN `phax artifact migrate-approvals` meets an old ledger entry whose artifact does not exist THE system SHALL migrate the entry to its record file like any other entry and report it as an orphan record, with the path to delete.

### 5.20 Migration refusals write nothing

IF an old ledger is unreadable, an entry's key is not a live artifact path of the ledger's kind, any path the migration would write has uncommitted changes, or a target record file already exists with a different record, THEN the migration command SHALL exit 12 naming the cause and SHALL write nothing.

### 5.21 Old formats stay readable, never written

The `@lbdremy/phax-schemas` package shall keep reading `plan-approvals` and `spec-approvals` in every released shape, and phax shall never write either format.

### 5.22 Other artifacts' transitions are not ground change

WHEN another artifact is approved, reopened, completed or abandoned after a plan's recorded baseline THE system SHALL NOT report that plan ground-changed, unless the plan's footprint names one of that other artifact's own files.

### 5.23 Documentation names record files

The system's CLI help, README and shipped skills shall describe approval records as per-artifact record files, and shall name an old ledger only as the input of `phax artifact migrate-approvals`.

## 6. Surface

### file: docs/plans/approvals/<plan file name>.json — normative

before:

    docs/plans/approvals.json — one ledger for every plan, rewritten whole by every transition:

    {
      "$schema": "https://docs.phax.run/schemas/plan-approvals/0.18.0.json",
      "records": {
        "docs/plans/2610051200-foo-plan.md": {
          "planFingerprint": "3f9a…",
          "approvedAt": "2026-10-05T12:00:00.000Z",
          "baseline": "<40-hex sha>",
          "sourceSpec": { "path": "docs/specs/2610041100-foo.md", "fingerprint": "8c21…" }
        },
        "docs/plans/2610051300-bar-plan.md": { … }
      }
    }

after:

    Layout (the subfolder name `approvals/` and the name derivation are normative):

    docs/plans/
      2610051200-foo-plan.md
      2610051200-foo-plan.json        ← headless sidecar (unchanged)
      approvals/
        2610051200-foo-plan.json      ← foo's approval record
        2610051300-bar-plan.json      ← bar's approval record
      archive/                        ← record files never move here

    docs/plans/approvals/2610051200-foo-plan.json (keys normative; key order indicative):

    {
      "$schema": "https://docs.phax.run/schemas/plan-approval-record/<release>.json",
      "artifact": "docs/plans/2610051200-foo-plan.md",
      "planFingerprint": "3f9a…",
      "approvedAt": "2026-10-05T12:00:00.000Z",
      "baseline": "<40-hex sha>",
      "sourceSpec": { "path": "docs/specs/2610041100-foo.md", "fingerprint": "8c21…" }
    }

### file: docs/specs/approvals/<spec file name>.json — normative

before:

    docs/specs/approvals.json — one ledger for every spec (this repository's is still pre-schema):

    {
      "version": 1,
      "records": {
        "docs/specs/2609281159-oracle-phases.md": {
          "specFingerprint": "e706…",
          "approvedAt": "2026-09-28T16:08:36.591Z",
          "baseline": "<40-hex sha>"
        },
        …
      }
    }

after:

    docs/specs/approvals/2609281159-oracle-phases.json:

    {
      "$schema": "https://docs.phax.run/schemas/spec-approval-record/<release>.json",
      "artifact": "docs/specs/2609281159-oracle-phases.md",
      "specFingerprint": "e706…",
      "approvedAt": "2026-09-28T16:08:36.591Z",
      "baseline": "<40-hex sha>"
    }

### package: @lbdremy/phax-schemas formats (README persisted-formats table) — normative

before:

    | Plan approvals | `plan-approvals` | `docs/plans/approvals.json` | `parsePlanApprovals` | `json/plan-approvals.schema.json` |
    | Spec approvals | `spec-approvals` | `docs/specs/approvals.json` | `parseSpecApprovals` | `json/spec-approvals.schema.json` |

after:

    | Plan approval record | `plan-approval-record` | `docs/plans/approvals/<plan>.json` | `parsePlanApprovalRecord` | `json/plan-approval-record.schema.json` |
    | Spec approval record | `spec-approval-record` | `docs/specs/approvals/<spec>.json` | `parseSpecApprovalRecord` | `json/spec-approval-record.schema.json` |
    | Plan approvals (old ledger, read to migrate) | `plan-approvals` | `docs/plans/approvals.json` | `parsePlanApprovals` | `json/plan-approvals.schema.json` |
    | Spec approvals (old ledger, read to migrate) | `spec-approvals` | `docs/specs/approvals.json` | `parseSpecApprovals` | `json/spec-approvals.schema.json` |

    Normative: the two new format ids (per §9 Q10), and that `plan-approvals` / `spec-approvals` stay with every released shape (pre-schema, and the `$schema` shapes written by 0.17.0 and 0.18.0). Indicative: the parse function names and the row labels. The new formats have no pre-schema shape: a record file without `$schema` is unreadable.

### cli: phax artifact migrate-approvals — normative

    phax.usage.kdl, under cmd "artifact" (placement, name per §9 Q6, and exit codes normative; help wording indicative):

        cmd "migrate-approvals" {
            help "Split the old approval ledgers into one record file per artifact (one-time)"
            long_help "Reads docs/plans/approvals.json and docs/specs/approvals.json in any released shape, writes one record file per entry under docs/plans/approvals/ and docs/specs/approvals/, deletes the ledgers, and commits exactly those paths in one commit. Exits 0 when migrated or when there is nothing to migrate; exits 12, writing nothing, on an unreadable ledger, an entry that is not a live artifact path, an uncommitted change to any path it would write, or an existing record file holding a different record."
            example "phax artifact migrate-approvals"
        }

    Output sketch (wording indicative):

        $ phax artifact migrate-approvals
        docs/plans/approvals.json → 1 record file
          docs/plans/approvals/2606291247-smolvm-isolation-spike-plan.json
        docs/specs/approvals.json → 5 record files
          docs/specs/approvals/2608091526-batch-execution-disjoint-plans.json
          …
        warning: orphan approval record docs/specs/approvals/2609010000-gone.json — docs/specs/2609010000-gone.md does not exist; delete the record file
        committed a1b2c3d chore(approvals): migrate approval ledgers to record files
        $? = 0

        $ phax artifact migrate-approvals
        nothing to migrate: no docs/plans/approvals.json or docs/specs/approvals.json
        $? = 0

        $ phax artifact migrate-approvals
        ✗ docs/plans/approvals.json: entry docs/plans/archive/2609010000-old-plan.md is not a live plan path — remove the entry, then rerun
        $? = 12

### cli: refusal while an old ledger exists — normative

before:

    $ phax artifact approve docs/plans/2610051200-foo-plan.md
    ✓ docs/plans/2610051200-foo-plan.md → Approved (writes docs/plans/approvals.json)
    $? = 0

after:

    $ phax artifact approve docs/plans/2610051200-foo-plan.md
    ✗ docs/plans/approvals.json is an approval ledger from an older phax — run `phax artifact migrate-approvals` first
    $? = 12

    The same refusal is given by every `phax artifact` transition, `phax artifact status`, `phax plans status`, and `phax run` (staleness gate and run completion), whichever old ledger exists. Exit code 12, and naming the ledger and the command, are normative; wording is indicative.

### cli: orphan warning in phax plans status and phax artifact status — indicative

before:

    === Plan Staleness Report ===

    docs/plans/2610051200-foo-plan.md: fresh
    $? = 0

after:

    === Plan Staleness Report ===

    docs/plans/2610051200-foo-plan.md: fresh
    warning: orphan approval record docs/plans/approvals/2609300900-gone-plan.json — docs/plans/2609300900-gone-plan.md does not exist; delete the record file
    $? = 0

    The warning goes to stderr. With `--json`, the document gains a required `orphanRecords` array beside `report` (per §9 Q8), and stdout stays one JSON document:

        {
          "report": [ { "path": "docs/plans/2610051200-foo-plan.md", "result": { "kind": "fresh" } } ],
          "orphanRecords": [ { "recordFile": "docs/plans/approvals/2609300900-gone-plan.json", "artifact": "docs/plans/2609300900-gone-plan.md" } ]
        }

    `phax artifact status <path>` prints the same warning for orphan records of the inspected artifact's kind. Normative: a warning, naming the record file, with an unchanged exit code; and the required `orphanRecords` key of `phax plans status --json`, each entry naming the record file and its artifact path (key names indicative).

### cli: unreadable record refusal — indicative

before:

    ✗ docs/plans/approvals.json: not valid JSON — fix it or restore it from git
    $? = 12

after:

    ✗ docs/plans/approvals/2610051200-foo-plan.json: not valid JSON — fix it or restore it from git
    $? = 12

    ✗ docs/plans/approvals/2610051200-foo-plan.json: records docs/plans/2610051300-bar-plan.md, not docs/plans/2610051200-foo-plan.md — restore it from git, or delete it and re-approve
    $? = 12

    Normative: exit code 12, the record file named, and the file left byte-identical.

### cli: transition help text (approve, reopen, abandon, complete) — indicative

before:

    For plans: stamps `approved: { date, baseline }` in the frontmatter and writes a record to docs/plans/approvals.json.

after:

    For plans: stamps `approved: { date, baseline }` in the frontmatter and writes the plan's approval record file, docs/plans/approvals/<plan file name>.json. Reopen, abandon and complete delete it in the transition commit; no transition touches another artifact's record file.

## 7. Non-goals

- Fixing approval-ground. A plan whose footprint names its own record file is still ground-changed by its own approval; approval-ground's §9 is redrafted on top of this spec.
- The `completesSpec` plan field, and when a run completes its source spec while more plans are to come.
- Any change to what a fingerprint covers, to the meaning of `baseline`, or to the staleness reasons.
- A git merge driver, a record index file, or keeping completed records and ignoring them on read.
- Avoiding the conflict when both branches transition the same artifact. A modify/delete on one record file is a real divergence and stays a conflict.
- Migrating implicitly on any command other than `phax artifact migrate-approvals`, and migrating another repository's ledgers for it.
- Any CLI command, flag or exit code beyond `phax artifact migrate-approvals`, and any `--json` change beyond the additive `orphanRecords` key of `phax plans status --json`.
- Removing `plan-approvals` or `spec-approvals` from `@lbdremy/phax-schemas`.

## 8. Acceptance criteria

### Plan transitions on two branches merge cleanly

Given two branches cut from the same main, one running `phax artifact approve` on Draft plan A and the other running `phax artifact complete` (and, in variants, `reopen` or `abandon`) on plan B, when each branch is merged into main, in either order, then git reports no conflict, and main holds `docs/plans/approvals/<A>.json` and no record file for a completed or abandoned B. (refs §5.8, §5.5, §5.7)

### Spec transitions on two branches merge cleanly

Given two branches cut from the same main, one approving Draft spec S1 and the other completing (in a variant, abandoning) Approved spec S2, when each branch is merged into main, in either order, then git reports no conflict, and main holds `docs/specs/approvals/<S1>.json` and no record file for S2. (refs §5.8, §5.5, §5.7)

### A run's PR merges after an approval on main

Given a run started from main on Approved plan B, which declares an Approved source spec, and plan A approved on main while the run is in progress, when the run completes, with its completion commit deleting B's record file and, where the chain gate allows, its spec's record file, and the run branch is merged into main, then the merge is conflict-free, and main holds A's record file and neither of the record files the run deleted. (refs §5.7, §5.8)

### Plan approval writes its own record file

Given Draft plan `docs/plans/2610051200-foo-plan.md` declaring an Approved, recorded source spec, when `phax artifact approve docs/plans/2610051200-foo-plan.md` runs, then `docs/plans/approvals/2610051200-foo-plan.json` exists with a `$schema` naming `plan-approval-record`. Its `artifact` equals `docs/plans/2610051200-foo-plan.md`, and it carries `planFingerprint`, `approvedAt`, a 40-hex `baseline` and `sourceSpec`, with no other key. The transition commit's paths are exactly the plan, its sidecar if any, and that record file. (refs §5.1, §5.3, §5.5, §5.9)

### Spec approval writes its own record file

Given a Draft spec `docs/specs/2610041100-foo.md`, when `phax artifact approve` runs on it, and runs again after an edit to its body, then `docs/specs/approvals/2610041100-foo.json` holds a `spec-approval-record` document with `artifact`, `specFingerprint`, `approvedAt` and `baseline`. The re-approval replaces only that file. (refs §5.1, §5.3, §5.5)

### Reopen deletes the plan's record file

Given a Stale plan with its record file and another plan's record file beside it, when `phax artifact reopen` runs on the Stale plan, then the transition commit deletes the Stale plan's record file and rewrites the plan, and the other record file is byte-identical. (refs §5.6, §5.9)

### Complete and abandon delete the record file

Given an Approved plan and an Approved spec, each with its record file, and a Draft spec that was never approved, when `phax artifact complete` runs on the plan and the spec (and, in a variant, `phax artifact abandon`), and `phax artifact abandon` runs on the Draft spec, then each commit moves the artifact and its sidecar into `archive/` and deletes its record file, no path exists under `docs/plans/archive/approvals/` or `docs/specs/archive/approvals/`, and the never-approved Draft's abandonment commits successfully. (refs §5.7, §5.9)

### Another plan's record is never read

Given Approved plans A and B with their record files, where B's record file has been replaced by text that is not JSON, when `phax artifact approve` runs on a Draft plan C, and the `phax run` staleness gate evaluates A, then both succeed. B's record file is byte-identical, and `phax plans status` reports A fresh and an error only for B. (refs §5.2, §5.8)

### Record files are not artifacts

Given `docs/plans/approvals/2610051200-foo-plan.json` and `docs/specs/approvals/2610041100-foo.json` exist, when `phax artifact status docs/plans/approvals/2610051200-foo-plan.json` runs, `phax plans status` runs, and a spec with no dependent plans is completed, then `artifact status` exits 12 as not a recognized artifact path. No `plans status` entry names a path under `approvals/`. The dependent-plan check reads no record file as a plan. (refs §5.4)

### A missing record file is no record

Given an Approved plan and an Approved spec, neither with a record file, when `phax plans status` runs, `phax artifact status` runs on the spec, and `phax artifact approve` runs on a Draft plan declaring that spec, then the plan reports missing-record, the spec reports unrecorded, and the plan approval exits 12 because the spec's approval is unrecorded. (refs §5.10)

### Unreadable record files are refused and kept

Given an Approved plan whose own record file is, in turn, not JSON, missing `$schema`, naming a release newer than the running phax, and failing to decode, when `phax artifact approve` or `phax artifact complete` runs on it, and `phax plans status` runs, then approve and complete exit 12 naming the record file, the record file is byte-identical and the plan is not moved, and `phax plans status` reports an error entry for that plan. (refs §5.11)

### A copied record does not approve another artifact

Given plan A's valid record file copied by hand to `docs/plans/approvals/<B>.json` for Approved plan B, when `phax plans status` runs, and `phax artifact approve` runs on B, then B is reported with an error naming its record file as unreadable, never fresh. The approval exits 12, and the copied file is byte-identical. (refs §5.12)

### Orphan record files warn

Given `docs/plans/approvals/2609300900-gone-plan.json` whose plan does not exist, and `docs/specs/approvals/2609010000-gone.json` whose spec does not exist, when `phax plans status` (with and without `--json`) runs, and `phax artifact status` runs on a live spec, then each prints a warning naming the orphan record file of its kind to delete. Exit codes are those the commands give without the orphan, the `--json` document keeps `report` unchanged and lists the plan orphan in `orphanRecords` (an empty array when the orphan is deleted), and no file changes. (refs §5.13)

### An old ledger refuses until migrated

Given a repository containing `docs/plans/approvals.json` and, in a variant, only `docs/specs/approvals.json`, when `phax artifact approve`, `phax artifact complete`, `phax artifact status`, `phax plans status` or `phax run` runs, then each exits 12 naming the old ledger and `phax artifact migrate-approvals`, and the working tree and HEAD are unchanged. (refs §5.14)

### Migration splits made-up ledgers with no record lost

Given made-up ledgers: a pre-schema (`"version": 1`) plan ledger with two records, one with a `sourceSpec`, and a `$schema` spec ledger with three records, each record keyed by an existing live artifact, when `phax artifact migrate-approvals` runs, then it exits 0 with one new commit whose paths are exactly the two deleted ledgers and five created record files. Each record file decodes to its ledger entry field for field, with `artifact` equal to the entry's key, so no record is lost or duplicated. The same holds for a ledger in each released `$schema` shape. (refs §5.15, §5.16)

### Running the migration again is a no-op

Given a repository already migrated, and one that never had a ledger, when `phax artifact migrate-approvals` runs, then it reports nothing to migrate, exits 0, and HEAD and the working tree are unchanged. (refs §5.17)

### An empty ledger is deleted

Given a made-up, empty, pre-schema plan ledger and no spec ledger, when `phax artifact migrate-approvals` runs, then one commit deletes the ledger, and no record file exists. (refs §5.18)

### A gone artifact's entry migrates as an orphan

Given a made-up ledger with an entry whose artifact does not exist, when `phax artifact migrate-approvals` runs, then `phax plans status` runs, then the entry's record file is created in the migration commit, the migration output names it as an orphan record to delete, and `phax plans status` warns about it. (refs §5.19, §5.13)

### Migration refusals write nothing

Given in turn: an unreadable ledger; an entry keyed `docs/plans/archive/2609010000-old-plan.md`; a ledger with uncommitted changes; and an existing target record file holding a different record, when `phax artifact migrate-approvals` runs, then it exits 12 naming the cause, and the working tree and HEAD are unchanged. When the existing target record file holds the same record, the migration proceeds and keeps the file. (refs §5.20)

### Old formats stay readable and are never written

Given made-up documents in every released shape of `plan-approvals` and `spec-approvals` (pre-schema, and the `$schema` shapes written by 0.17.0 and 0.18.0), when they are parsed by `@lbdremy/phax-schemas`, and a test repository is put through every transition, a run completion and a migration, then every document parses, and no `docs/plans/approvals.json` or `docs/specs/approvals.json` is written at any point. (refs §5.21)

### Another plan's lifecycle no longer stales a plan

Given Approved plan P whose footprint names `docs/plans/approvals.json` and none of plan Q's files, when plan Q is approved and then completed after P's baseline, then `phax plans status` reports P fresh. (refs §5.22)

### Existing staleness, chain-gate and unreadable tests keep passing

Given the existing tests for staleness (spec-changed, ground-changed, self-changed, missing-record), the spec chain gate (spec unrecorded, spec edited since approval, retirement blocked) and the unreadable-ledger rule, when they run against record files instead of ledgers, then each passes, and its behavioural assertions are unchanged. (refs §5.22, §5.2, §5.11)

### Help and docs name record files

Given the built CLI, the README and the shipped skills, when `phax --usage`, the README and `.claude/skills/phax-cli/SKILL.md` and `.claude/skills/phax-spec/SKILL.md` are read, then the approve, reopen, abandon and complete help names the record file under `approvals/`, and `migrate-approvals` is listed under `artifact` with its exit codes. `approvals.json` appears only in the migration command's text and in the persisted-formats rows of the old ledgers. (refs §5.23)

## 9. Open questions for implementation planning

### Q1 — Where does a record file live? (Decided by the author on 2026-10-05; not reopened.)

- A subfolder beside the artifacts: `docs/plans/approvals/<plan>.json`, `docs/specs/approvals/<spec>.json` — abandons: A walk-free layout: every walker of `docs/plans/` and `docs/specs/` must skip one more subfolder, as it already skips `archive/`.
- A separate `docs/approvals/{plans,specs}/` tree — abandons: Proximity: the record sits far from its artifact, under a new top-level folder.
- The artifact's own frontmatter — abandons: A JSON format the schemas package reads. It also puts fingerprints and full SHAs into a file people edit by hand.

Recommendation: A subfolder beside the artifacts: `docs/plans/approvals/<plan>.json`, `docs/specs/approvals/<spec>.json` — Decided by the author on 2026-10-05. The name beside the artifact is taken by the headless sidecar, and skipping a subfolder is a cost the walkers already pay for `archive/`.

### Q2 — How do existing ledgers become record files? (Decided by the author on 2026-10-05; not reopened.)

- A one-time command that splits a ledger and deletes it in a single commit; every approval transition and staleness computation refuses while an old ledger exists — abandons: A frozen command tree: one more CLI command lands before the contract freeze.
- Split automatically at the next transition — abandons: Conflict freedom during the switch: a run branch that splits while main still edits the old ledger reintroduces the edit-versus-delete conflict.
- Migrate by hand, with no code — abandons: Every other user's ledger, which is left to them.

Recommendation: A one-time command that splits a ledger and deletes it in a single commit; every approval transition and staleness computation refuses while an old ledger exists — Decided by the author on 2026-10-05. One explicit, one-commit step is the only option that never produces the conflict this spec removes. The command lives under `artifact` and goes through `phax.usage.kdl`.

### Q3 — What happens to a record file whose artifact is gone? (Decided by the author on 2026-10-05; not reopened.)

- `phax plans status` and `phax artifact status` warn, naming the path to delete; nothing fails — abandons: Enforcement: an orphan lingers until someone reads the warning.
- A `phax plans lint` error — abandons: Independent lint: every plan's lint is blocked by an unrelated leftover.
- Ignore orphans — abandons: Visibility: dead files pile up unnoticed.

Recommendation: `phax plans status` and `phax artifact status` warn, naming the path to delete; nothing fails — Decided by the author on 2026-10-05. An orphan affects no decision phax makes, so it deserves a visible pointer, not a failure.

### Q4 — Does a record file name its artifact? (Decided by the author on 2026-10-05; not reopened.)

- Each record carries the artifact's repo-relative path in `artifact`; a mismatch with its file name makes it unreadable — abandons: A single source of the path: it is stored twice, in the file name and in the record.
- Rely on the file name alone — abandons: Protection against a record copied or renamed by hand silently approving another artifact.

Recommendation: Each record carries the artifact's repo-relative path in `artifact`; a mismatch with its file name makes it unreadable — Decided by the author on 2026-10-05. A duplicated path is cheap, and a silent wrong approval is not.

### Q5 — What becomes of `plan-approvals` and `spec-approvals`? (Decided by the author on 2026-10-05; not reopened.)

- They stay in `@lbdremy/phax-schemas` with their released shapes (pre-schema, 0.17.0, 0.18.0); phax never writes them and reads them only to migrate — abandons: A smaller package: two formats nobody writes are carried indefinitely.
- Remove them from the package — abandons: The package's promise to read every format version ever written, and the decoder the migration itself needs.

Recommendation: They stay in `@lbdremy/phax-schemas` with their released shapes (pre-schema, 0.17.0, 0.18.0); phax never writes them and reads them only to migrate — Decided by the author on 2026-10-05. It is consistent with the no-back-compat-shims rule: the old format is never written again, yet existing files stay readable for migration.

### Q6 — What is the migration command called? (Decided by the author on 2026-10-05; not reopened.)

- `phax artifact migrate-approvals` — abandons: A generic `migrate` verb that later format migrations could share.
- `phax artifact migrate` — abandons: Self-description: the name does not say what it migrates, and a later, unrelated migration would have to share or rename it after the freeze.
- `phax migrate approvals`, a new top-level group — abandons: Command-tree locality: approval records are artifact state, and a new top-level group would join the contract just before the freeze.

Recommendation: `phax artifact migrate-approvals` — Decided by the author on 2026-10-05. Losing a shared verb costs nothing today: no other migration is planned, and a future one can take its own name. The other two options give up either clarity or a frozen top level.

### Q7 — What does the migration do with a ledger entry whose artifact is gone? (Decided by the author on 2026-10-05; not reopened.)

- Migrate it to its record file and report it as an orphan to delete — abandons: A clean result: the migration can create files that immediately warn.
- Drop it and report the drop — abandons: The no-record-lost invariant: the migration alone would decide that a record is dead.

Recommendation: Migrate it to its record file and report it as an orphan to delete — Decided by the author on 2026-10-05. The migration must be verifiable as lossless. An orphan record file costs one warning and one deletion by a human who can judge it.

### Q8 — Where does a `phax plans status --json` consumer find orphan records? (Decided by the author on 2026-10-05; not reopened.)

- stderr only, in both modes; `--json` stdout is unchanged — abandons: Machine-readable orphan detection: a `--json` consumer cannot see an orphan without scraping stderr.
- A required `orphanRecords` key in the `--json` document, beside `report` — abandons: A byte-identical `--json` document: it gains one always-present key. The document is an object (`{ "report": [...] }`), not a top-level array, so the key is additive and existing readers of `report` are unaffected.

Recommendation: A required `orphanRecords` key in the `--json` document, beside `report` — Decided by the author on 2026-10-05, after checking the current shape: `phax plans status --json` prints `{ "report": [...] }`, so an always-present `orphanRecords` array (empty when there is none) is additive. The text mode keeps the stderr warning.

### Q9 — Does an old ledger of one kind refuse commands for both kinds? (Decided by the author on 2026-10-05; not reopened.)

- Either old ledger refuses every command listed in §5 legacy-refuse — abandons: Working on specs while only the plan ledger remains. That state lasts one command.
- Each old ledger refuses only the commands that touch its kind — abandons: A single rule. Plan approval reads spec records, so the per-kind boundary leaks and needs its own exceptions.

Recommendation: Either old ledger refuses every command listed in §5 legacy-refuse — Decided by the author on 2026-10-05. The migration handles both ledgers in one command, so a single rule costs nothing and leaves no half-migrated state to reason about.

### Q10 — What are the new format ids? (Decided by the author on 2026-10-05; not reopened.)

- `plan-approval-record` and `spec-approval-record` — abandons: Brevity in `$schema` URLs and the README table.
- `plan-approval` and `spec-approval` — abandons: Distinctness: each would differ by one letter from the ledger ids that stay in the package.

Recommendation: `plan-approval-record` and `spec-approval-record` — Decided by the author on 2026-10-05. Both pairs live side by side in the package indefinitely, so a reader must never confuse a record with a ledger.

## 10. Implementation-planning note

Settled:

- The five author decisions (§9 Q1–Q5): `approvals/` subfolder beside the artifacts, one-time migration command, orphans warn, the record stores its artifact path in `artifact`, and the old formats stay readable but are never written.
- Write-sets. Approve: artifact, sidecar, own record file. Plan reopen: artifact, sidecar, own record file (deleted). Complete and abandon: artifact, sidecar, their archive paths, own record file (deleted). `stale` writes no record file. No transition lists another artifact's record file.
- The PR #117 rule carries over per file: a missing record file is no record, and an unreadable one is refused with exit 12 and never rewritten or deleted.
- The migration is the only reader of old ledgers. While either ledger exists, the commands in §5 legacy-refuse exit 12.
- The record fields keep their names, types and meaning; `artifact` is the only addition.

Left open:

- Whether `ApprovalLedgerUnreadableError` is renamed (e.g. to an approval-record error). Exit code 12 is fixed either way.
- The migration commit's subject (indicative: `chore(approvals): migrate approval ledgers to record files`) and the exact wording of the orphan warning and the legacy refusal.
- A run started before migration keeps the old ledger in its worktree, so its completion refuses and the run pauses as ArtifactCompletionFailed. The remedy (migrate on the run branch, or complete after merging) is documented, not automated.
- Whether this repository's own ledgers (pre-schema spec ledger, `$schema` plan ledger) are migrated inside the implementing PR or by the released command afterwards. Default: afterwards, so the run completing this plan does not refuse itself.

Constraints:

- Readers that change: `classifyArtifactPath` (paths under `docs/plans/approvals/` and `docs/specs/approvals/` classify as no artifact, so `archivePathFor` never applies to them); `transitionWriteSet` (the own record path replaces APPROVALS_FILE_PATH / SPEC_APPROVALS_FILE_PATH); `approvalRecordStore` (per-file read, put and delete, with no read-modify-write of a shared object); `artifactStatus` (transitions, spec approval info, orphan warning); `completeRunArtifacts`; `planStaleness` (`computeStalenessForPlan` reads the own record file; `plansStalenessReport` emits the orphan warning).
- The `.md`-only walks in `findDependentPlans` and `plansStalenessReport` already skip the `approvals/` entry. Keep them that way and cover it with a test. `phax plans lint` has no tree walk: it classifies the one path it is given, so it changes only through `classifyArtifactPath`.
- New formats `plan-approval-record` and `spec-approval-record` are declared in `src/schemas/` and `packages/schemas/src/formats/repository.ts`, with readers in `src/schemas/persisted.ts`. They have no pre-schema shape: a record file without `$schema` is unreadable. If the package's format definition requires a pre-schema entry, the planner decides how a format born with `$schema` declares none. `plan-approvals` and `spec-approvals` keep their decoders, including the frozen ones in `src/schemas/history/`, which only the migration uses; the frozen files and `history.lock.json` entries stay untouched.
- The path-scoped commit must accept a write-set path that is absent before and after (abandoning a never-approved Draft). A pathspec that matches nothing must not fail the commit, and a deleted path must be committed as a deletion.
- No CLI change beyond `phax artifact migrate-approvals` and the additive `orphanRecords` key of `phax plans status --json`, added through `phax.usage.kdl`, `src/cli/cliDocs.ts` and the regenerated `docs/cli/reference.md`. Also update the README (persisted-formats table, the 'stale right after its approval' known issue), `.claude/skills/phax-cli/SKILL.md`, `.claude/skills/phax-spec/SKILL.md`, and the docs-site pages built from them.
- Merge acceptance criteria are integration tests using real git merges in temporary repositories. Every ledger and record in the tests is made up; nothing from `~/.phax` or another repository enters this repository.
- Do not touch staleness reasons, fingerprint coverage or `baseline` semantics. approval-ground is redrafted on top of this spec: its §9 Q2 and Q4 reduce to the plan's own record file and own path.

## 11. Docs page

Page: README §Persisted formats, plus an upgrade note 'Approval records are per-artifact files', which the docs site builds from it, beside the generated `phax artifact migrate-approvals` reference.

Reader: A phax user upgrading to the release that ships this. Their repository holds `docs/plans/approvals.json` or `docs/specs/approvals.json`, and their next `phax artifact approve` or `phax run` refuses with exit 12.

Example: $ phax artifact approve docs/plans/2610051200-foo-plan.md
✗ docs/plans/approvals.json is an approval ledger from an older phax — run `phax artifact migrate-approvals` first
$ phax artifact migrate-approvals
docs/plans/approvals.json → 1 record file
  docs/plans/approvals/2606291247-smolvm-isolation-spike-plan.json
committed a1b2c3d chore(approvals): migrate approval ledgers to record files
$ phax artifact approve docs/plans/2610051200-foo-plan.md   # now writes docs/plans/approvals/2610051200-foo-plan.json
