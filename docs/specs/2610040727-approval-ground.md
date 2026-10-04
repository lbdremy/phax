---
status: Draft
date: 2026-10-04
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# A plan is never stale because of its own approval

## 1. Context

`phax artifact approve <plan>` reads HEAD as the approval baseline, then writes the plan's frontmatter (`status: Approved` and `approved: { date, baseline: <short-sha> }`) and the plan's record in `docs/plans/approvals.json` (`planFingerprint`, `approvedAt`, `baseline` as a full 40-hex sha, `sourceSpec`), and commits exactly that write-set as `chore(plans): approve <slug>`. The recorded baseline is therefore HEAD just before the approval commit.

Staleness is computed from that record. A plan is stale with `spec-changed` when its source spec's fingerprint differs from the recorded one, with `self-changed` when its own fingerprint differs (the fingerprint ignores the `status` and `approved` keys), and with `ground-changed` when any file in its footprint — every create, edit and optional path of every phase — differs between the baseline and the working tree. It is `missing-record` when no record exists or the baseline commit is gone. The ground comparison is a tree diff from the baseline to the working tree, so the approval commit itself always lies inside the window.

Two commands compute staleness: `phax run`, which refuses a non-fresh plan with exit 12 before the run is named, and `phax plans status`, which reports every Approved plan and, with `--apply`, flips the stale ones to Stale. `phax resume` and `phax plans lint` do not compute staleness. Re-approving an Approved plan is a legal transition.

The ledger exists in two readable shapes: the pre-schema form (`"version": 1`, still the committed form in this repo) and the current `$schema` form; any write by phax produces the `$schema` form.

Ground read:

- `NEXT_STEPS.md` — Road to 1.0.0: 'Two known happy-path defects' (preflight-before-naming fixed 2026-10-03, this one open); Small follow-ups: 'A plan whose footprint names docs/plans/approvals.json is stale at its own approval' (found 2026-09-10) and 'A run's completion conflicts with approvals made on main during the run' (out of scope here).
- `src/domain/artifact/lineage.ts` — computeStaleness: spec-changed (spec fingerprint), ground-changed (changed files since baseline ∩ footprint), self-changed (plan fingerprint), missing-record (no record or baseline commit gone). APPROVALS_FILE_PATH = docs/plans/approvals.json.
- `src/app/planStaleness.ts` — computeStalenessForPlan feeds computeStaleness from the approval record, the plan/spec fingerprints and git.changedFilesSince(record.baseline); computePlanStaleness / plansStalenessReport / applyStalenessReport serve phax plans status and --apply.
- `src/infra/git.ts` — changedFilesSince runs `git diff --name-only <baseline> --`: a tree diff from the baseline to the working tree, not a commit walk — the approval commit is always inside the window.
- `src/app/artifactStatus.ts` — transitionArtifact: on plan approve, baseline = HEAD before writing; stamps `approved: { date, baseline: <short> }`, puts the plan's ledger record (full 40-hex baseline), then finalizeTransition commits exactly the write-set.
- `src/domain/artifact/writeSet.ts` — Plan approve write-set: the plan .md, its sidecar if any, docs/plans/approvals.json; commit subject `chore(plans): approve <slug>`.
- `src/domain/artifact/status.ts` — Plan transitions: Approved → Approved is legal (re-approve), as is Approved → Stale.
- `src/domain/artifact/frontmatter.ts` — fingerprintSource drops `status` and `approved` before hashing, so the plan's own approval never changes its fingerprint.
- `src/app/approvalRecordStore.ts` — Ledger read/write: records sorted by path; an undecodable ledger reads as empty; written in the `$schema` form.
- `src/schemas/approvalRecord.ts` — Record shape: planFingerprint, approvedAt, baseline (40-hex), sourceSpec; file shape: $schema + records.
- `src/schemas/persisted.ts` — readPlanApprovalsFile also accepts the pre-schema `version: 1` ledger (the form this repo's committed ledger is still in).
- `docs/plans/approvals.json` — Committed ledger in pre-schema form (`"version": 1`, records) — an approval rewrites its header to `$schema`.
- `src/cli/commands/run.ts` — Staleness gate before the run: any verdict other than fresh raises PlanStaleError, exit 12.
- `src/cli/commands/plans.ts` — phax plans status: report, --apply flips stale plans Approved → Stale, --json. No other command (resume, plans lint) computes staleness.
- `src/domain/errors.ts` — PlanStaleError message: '<plan> is stale (ground-changed: <files> changed since baseline <sha>) — re-approve with "phax artifact approve <plan>"'.
- `README.md` — The phax plans status paragraph describes the three reasons and missing-record.

## 2. Problem

A plan whose footprint names `docs/plans/approvals.json` — or its own path — is stale the moment it is approved: the approval commit rewrites both files after the baseline was taken, so `phax run` reports `ground-changed` and refuses with exit 12 before anything starts. Re-approving cannot help: it takes a new baseline and commits a new rewrite of the same two files, recreating the same evidence. Because optional files count in the footprint too, there is no list in which to hide the ledger; the only workaround has been to leave both ledgers out of such a plan's file lists, which a plan that genuinely works on approvals cannot honestly do. This is the last of the two happy-path defects blocking 1.0: an `approve` → `run` sequence that refuses itself.

## 3. Product goal

The writes a plan's own approval makes stop counting as ground change for that plan, so a plan is fresh right after `phax artifact approve` whatever its footprint names, while every other change to its ground — including another transition's edit of the ledger — still makes it stale. The rule is derived from what is already persisted (the approval record and its baseline), applies identically wherever staleness is computed, and needs no CLI change, no persisted-format change and no migration of existing records.

> A plan's own approval is never evidence against it; everything else that lands on its ground still is.

## 4. Terminology

- **baseline** — The commit recorded in a plan's approval record (`baseline`, 40-hex): HEAD immediately before the approval commit. Its meaning does not change in this spec.
- **footprint** — The union of every create, edit and optional path declared by a plan's phases.
- **approval ledger** — `docs/plans/approvals.json`: the plan approval records keyed by plan path, in either the pre-schema (`version: 1`) or the `$schema` form.
- **own record** — The approval ledger entry keyed by the plan's own path.
- **own approval write** — What `phax artifact approve` writes for the plan being judged: the plan file's `status` and `approved` frontmatter keys, and its own record in the approval ledger (including the ledger header rewrite the write implies).
- **ground change** — A difference, between the baseline and the working tree, in a footprint file, reported as `ground-changed` evidence naming the files.
- **transition commit** — A commit made by a `phax artifact` lifecycle transition (approve, stale, reopen, abandon, complete) or by a run's completion, writing frontmatter, ledgers and archive/ moves.

## 5. Functional requirements

### 5.1 The plan's own ledger record is not ground change

WHEN phax computes ground change for an Approved plan whose footprint names the approval ledger THE system SHALL not count the ledger as changed if its records at the baseline and in the working tree differ only in the plan's own record.

### 5.2 A ledger created by the approval

WHEN the approval ledger did not exist at the baseline THE system SHALL compare against a ledger with no records.

### 5.3 Any other ledger change still counts

WHEN any record other than the plan's own record was added, changed or removed in the approval ledger since the baseline THE system SHALL report the ledger as ground-changed evidence.

### 5.4 An unreadable ledger falls back to the file rule

IF the approval ledger cannot be decoded at the baseline or in the working tree THEN the system SHALL count it as ground-changed whenever its bytes differ, as it does today.

### 5.5 The plan's own file is judged only by self-changed

The system shall never report the plan's own file as ground-changed evidence; a change to it is reported only as `self-changed` when it changes the plan's fingerprint.

### 5.6 Every other footprint file keeps the file rule

WHEN a footprint file other than the plan's own file and the approval ledger differs between the baseline and the working tree THE system SHALL report it as ground-changed evidence, unchanged from today.

### 5.7 Other staleness reasons are unchanged

The system shall keep computing `spec-changed`, `self-changed` and `missing-record` exactly as before this change.

### 5.8 One rule for every staleness consumer

The system shall apply the same staleness rule in the `phax run` staleness gate and in `phax plans status`, with and without `--apply` and `--json`.

### 5.9 Records written before the fix keep working

The system shall read every approval record's `baseline` as HEAD before its approval commit, so records written before this change are judged by the same rule without migration.

## 6. Surface

### cli: phax run <plan> — normative

before:

    $ phax artifact approve docs/plans/2609100902-artifact-timestamp-naming-plan.md
    $ phax run docs/plans/2609100902-artifact-timestamp-naming-plan.md
    docs/plans/2609100902-artifact-timestamp-naming-plan.md is stale (ground-changed: docs/plans/approvals.json, docs/plans/2609100902-artifact-timestamp-naming-plan.md changed since baseline <baseline-sha>) — re-approve with "phax artifact approve docs/plans/2609100902-artifact-timestamp-naming-plan.md"
    $? = 12

after:

    $ phax artifact approve docs/plans/2609100902-artifact-timestamp-naming-plan.md
    $ phax run docs/plans/2609100902-artifact-timestamp-naming-plan.md
    (passes the staleness gate; the run proceeds as for any fresh plan)

    After another plan is approved on the same branch:
    $ phax run docs/plans/2609100902-artifact-timestamp-naming-plan.md
    docs/plans/2609100902-artifact-timestamp-naming-plan.md is stale (ground-changed: docs/plans/approvals.json changed since baseline <baseline-sha>) — re-approve with "phax artifact approve docs/plans/2609100902-artifact-timestamp-naming-plan.md"
    $? = 12

    (verdicts normative; message wording and exit code unchanged from today)

### cli: phax plans status — normative

before:

    $ phax plans status
    === Plan Staleness Report ===

    docs/plans/2609100902-artifact-timestamp-naming-plan.md: STALE
      ground-changed: docs/plans/approvals.json, docs/plans/2609100902-artifact-timestamp-naming-plan.md changed since baseline <baseline-sha>

after:

    $ phax plans status
    === Plan Staleness Report ===

    docs/plans/2609100902-artifact-timestamp-naming-plan.md: fresh

    (`--apply` flips nothing for this plan; `--json` emits the same verdict in its existing shape; report format unchanged)

### file: docs/plans/approvals.json — normative

before:

    Identical to after — this spec changes neither the shape nor the meaning of any field.

after:

    {
      "$schema": "<plan-approvals schema url>",
      "records": {
        "docs/plans/<YYMMDDHHMM>-<slug>-plan.md": {
          "planFingerprint": "<sha256>",
          "approvedAt": "<ISO-8601>",
          "baseline": "<40-hex: HEAD before the approval commit>",
          "sourceSpec": null
        }
      }
    }
    (the pre-schema form with "version": 1 in place of "$schema" remains readable)

## 7. Non-goals

- The conflict between a run's completion commit and approvals made on main during the run (NEXT_STEPS 'A run's completion conflicts with approvals made on main during the run') — a merge question with its own spec.
- Any change to the approve, stale, reopen, abandon or complete transitions or to run completion: same baseline, frontmatter stamp, ledger record, write-set and commit message.
- Excusing other transitions' writes: another plan's approval, reopen or completion, a spec transition, or an archive/ move still counts as ground change when it touches a footprint file (see §9 Q1).
- A new commit trailer, commit-message convention, or any persisted field.
- Any CLI change: no new command, flag, exit code, or output format.
- Adding a staleness check to `phax resume` or `phax plans lint`; neither computes staleness today and neither starts to.
- Changing the ground window itself: it stays the baseline-to-working-tree comparison, so uncommitted edits to footprint files still count.
- Spec staleness: specs keep their `editedSinceApproval` check, untouched.

## 8. Acceptance criteria

### A plan naming the ledger is fresh after its approval

Given a Draft plan whose footprint names `docs/plans/approvals.json` and an existing ledger holding another plan's record, when `phax artifact approve <plan>` runs and then `phax run <plan>` runs, then the staleness gate reports the plan fresh and the run is not refused with exit 12. (refs §5.1, §5.8)

### The approval that creates the ledger does not make the plan stale

Given a repository with no `docs/plans/approvals.json` and a Draft plan whose footprint names it, when `phax artifact approve <plan>` creates the ledger and `phax plans status` runs, then the plan is reported `fresh`. (refs §5.2, §5.1)

### A plan naming its own path is fresh after its approval

Given a Draft plan whose footprint names its own path, when `phax artifact approve <plan>` runs and staleness is computed, then the plan is fresh and no `ground-changed` evidence names its own path. (refs §5.5)

### Editing the plan after approval is self-changed only

Given an Approved plan whose footprint names its own path, when its body is edited and staleness is computed, then the verdict is stale with `self-changed` evidence and no `ground-changed` evidence naming the plan's own path. (refs §5.5, §5.7)

### Re-approval leaves the plan fresh

Given an Approved plan whose footprint names `docs/plans/approvals.json`, when `phax artifact approve <plan>` runs again (Approved → Approved) and staleness is computed, then the plan is fresh. (refs §5.1)

### Another plan's approval makes a ledger-naming plan stale

Given an Approved, fresh plan whose footprint names `docs/plans/approvals.json`, when `phax artifact approve` runs on a different plan and then `phax run <plan>` runs, then it is refused with exit 12 and `ground-changed` evidence naming `docs/plans/approvals.json`. (refs §5.3)

### A real change on a footprint file still makes the plan stale

Given an Approved, fresh plan whose footprint names `src/a.ts`, when a commit (or an uncommitted edit) changes `src/a.ts` and `phax plans status` runs, then the plan is reported STALE with `ground-changed` evidence naming `src/a.ts`. (refs §5.6)

### An undecodable ledger falls back to the file rule

Given an Approved plan whose footprint names `docs/plans/approvals.json`, when the ledger in the working tree is replaced with bytes that do not decode and staleness is computed, then the verdict is stale with `ground-changed` evidence naming `docs/plans/approvals.json`. (refs §5.4)

### spec-changed keeps its behaviour

Given an Approved plan with a source spec, whose footprint names `docs/plans/approvals.json`, when the spec's content changes after the plan's approval and staleness is computed, then the verdict is stale with `spec-changed` evidence and no `ground-changed` evidence for the ledger. (refs §5.7)

### missing-record keeps its behaviour

Given an Approved plan whose recorded baseline commit no longer exists, when `phax run <plan>` runs, then it is refused with exit 12 reporting `missing-record`. (refs §5.7)

### A record written before the fix in a pre-schema ledger is judged fresh

Given a ledger in the pre-schema form (`"version": 1`) at the baseline and a plan whose footprint names it, approved by a phax that rewrote the ledger header to `$schema` and recorded `baseline` as HEAD before its approval commit, when `phax plans status` runs with no other change, then the plan is reported `fresh`, with no migration of the record or the ledger. (refs §5.9, §5.1)

### plans status --apply agrees with the run gate

Given one plan fresh only by this rule and one plan stale by another plan's approval, both naming `docs/plans/approvals.json`, when `phax plans status --apply` runs, then only the second plan is flipped Approved → Stale, and `phax run` on the first is not refused. (refs §5.8, §5.1, §5.3)

## 9. Open questions for implementation planning

### Q1 — Which changes stop counting as ground change: only the plan's own approval write, or every transition commit made after the baseline?

- Narrow — only the plan's own approval write — abandons: Quiet for ledger-naming plans in a busy repo: approving, reopening or completing any other plan before this one runs makes it stale again, and the operator must re-approve (a legal one-command Approved → Approved).
- Broad — every transition commit after the baseline — abandons: The ground signal for every transition-written path: a plan would no longer see a footprint file restatused or moved into archive/ under it, nor another transition's edit of ledger content it depends on — and the tree diff must become a per-commit history walk that recognises transition commits.

Recommendation: Narrow — only the plan's own approval write — The narrow loss is a cheap, explicit re-approval in a rare case (only plans that work on the ledger name it); the broad loss silently hides real ground changes — including deletions of footprint files by archive moves — and widens the change from a staleness rule to history interpretation right before the 1.0 freeze.

### Q2 — How does phax recognise the own approval write deterministically?

- Subtract it using what is persisted: the record's baseline, the plan's own record, and the approve write-set (ledger compared with the own record restored to its baseline value; the plan's own file left to self-changed) — abandons: Detection of a hand edit to the plan's own ledger record or to its `approved`/`status` keys as ground change — machine state that the fingerprint and validation already own.
- Locate the approval commit (child of the baseline, subject `chore(plans): approve <slug>`, paths within the write-set) and start the window after it — abandons: Robustness to history rewriting: a squash merge or rebase of the approval commit makes the plan stale again, and a subject is a convention any human commit can imitate.
- Add a commit trailer to transition commits and skip trailered commits — abandons: Every approval made before the fix (no trailer) stays stale at approval, and it changes the approve transition and adds a convention the 1.0 freeze would have to carry.

Recommendation: Subtract it using what is persisted: the record's baseline, the plan's own record, and the approve write-set (ledger compared with the own record restored to its baseline value; the plan's own file left to self-changed) — It needs no commit recognition at all, works for every record already written, survives squash and rebase as long as the baseline exists (already required), and touches neither the transitions nor any format.

### Q3 — Does `baseline` keep meaning HEAD before the approval commit, or move to the approval commit?

- Keep: HEAD before the approval commit — abandons: A window that excludes the approval by construction — the own-write subtraction (Q2) has to exist instead.
- Move: the approval commit — abandons: Transition and format stability: a record cannot name the commit that contains it, so approve would need a second commit or an amend, and old and new records would carry different meanings with nothing in their shape to tell them apart.

Recommendation: Keep: HEAD before the approval commit — Moving the baseline requires changing the transition (a non-goal) and silently splits the meaning of a persisted field; keeping it lets every existing record work unchanged.

### Q4 — When the own record is neutralised, is the ledger compared as decoded records or as bytes re-encoded from the baseline?

- Decoded records (absent ledger = no records) — abandons: Seeing a non-transition edit to the ledger header alone (`$schema` url or pre-schema `version`) as ground change.
- Bytes: the baseline ledger re-encoded with the own record set, compared byte for byte — abandons: Stability across phax versions and ledger forms: a pre-schema ledger rewritten by the approval, or a schema-url change between approval and run, makes plans stale for no change in content.

Recommendation: Decoded records (absent ledger = no records) — The header is written only by phax and carries no fact a plan depends on; byte comparison would reintroduce the very defect for every repo whose ledger is still in pre-schema form, including this one.

## 10. Implementation-planning note

Settled:

- Scope is the plan's own approval write only (§9 Q1); other transitions' writes remain ground change.
- Recognition subtracts the own write from persisted state — record, baseline, approve write-set — with no commit walk, subject match or trailer (§9 Q2).
- `baseline` keeps its meaning; no record or ledger is migrated (§9 Q3).
- The ledger is compared as decoded records with the own record restored to its baseline value; an absent ledger is a ledger with no records; an undecodable one falls back to the byte rule (§9 Q4).
- The plan's own path is never ground-changed evidence; self-changed is its only signal.
- Consumers: the `phax run` staleness gate and `phax plans status` (report, `--apply`, `--json`); resume and plans lint compute no staleness and gain none.

Left open:

- Whether the plan's own sidecar joins the plan's own path in the exclusion: approve does not write it, so the default is no — it stays under the file rule.

Constraints:

- No CLI change (commands, flags, exit codes, output formats) and no change to `docs/plans/approvals.json` or any `@lbdremy/phax-schemas` format.
- The verdict stays a pure domain decision; reading the ledger as it was at the baseline goes through the Git port.
- Each acceptance criterion becomes a staleness test; the ledger-naming and own-path cases cover both `phax run` and `phax plans status`.
- No change to the approve, stale, reopen, abandon, complete transitions or run completion.

## 11. Docs page

Page: README.md — the `phax plans status` paragraph

Reader: An operator whose plan works on approvals and who wonders why `docs/plans/approvals.json` in its footprint does not make it stale right after approval, yet does after another plan is approved.

Example: A plan's own approval — its `approved` stamp and its own record in `docs/plans/approvals.json` — never counts as `ground-changed`; any other change to a footprint file, including another plan's approval rewriting the ledger, still does.
