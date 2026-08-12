---
status: Archived
source-spec: docs/specs/22-plan-staleness-lineage.md
---
# Plan staleness and lineage

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. Source spec:
> [`docs/specs/22-plan-staleness-lineage.md`](../specs/22-plan-staleness-lineage.md).

---

## Overview

Every plan's `Source-Spec:` declaration (stamped by plan 21's migration) becomes enforced
lineage: validation requires it, plan approval is refused unless the declared spec is
`Approved`, and spec retirement is refused while non-terminal dependent plans exist. Plan
approval additionally records what the approval was given against — the plan's content
fingerprint, the declared spec's identity and fingerprint, and the repository HEAD as
baseline — in a sidecar (`docs/plans/approvals.json`) plus a human-readable `Approved:`
stamp in the plan header. From that record phax computes staleness on demand
(`spec-changed | ground-changed | self-changed`, plus missing-record), reports it via a new
`phax plans status` command (with `--apply` flipping stale plans `Approved → Stale` as an
explicit gesture), and hard-gates `phax run`: a stale repo-tracked plan does not run until
re-approved. The existing `plans-overlap` command migrates into the new `plans` group as
`plans overlap`.

Execution model caveat: none — this is ordinary feature work, fully verifiable by the
configured gates.

Post-merge operator step (not a phase): the four live Approved plans (39, 41, 44, 45)
carry no approval record, so they compute stale per §5.14 until re-approved. After this
plan merges, run `phax artifact approve docs/plans/<each>.md` once apiece to capture a
truthful post-merge baseline (user decision 2026-08-10: no in-run approval phase).

Traceability (spec §8 acceptance criteria → phase):

| Acceptance criterion                           | Phase              |
| ---------------------------------------------- | ------------------ |
| A plan without a declaration fails validation  | phase-01           |
| A dangling declaration fails validation        | phase-03, phase-04 |
| A spec-less plan skips the chain               | phase-03, phase-04 |
| Approval is chain-gated                        | phase-03           |
| Spec retirement is chain-gated                 | phase-03           |
| Approval records the ground                    | phase-03           |
| Spec edit flips the verdict                    | phase-04           |
| Ground change names the files                  | phase-04           |
| Disjoint changes do not flip                   | phase-04           |
| Plan edit flips the verdict                    | phase-04           |
| Recording status does not change fingerprint   | phase-01           |
| A stale plan does not run                      | phase-06           |
| Re-approval restores freshness                 | phase-04, phase-06 |
| The flip is a gesture                          | phase-04, phase-05 |
| No record means stale                          | phase-01, phase-04 |

## Technical arbitrations

- **Spec §9 defaults adopted as-is** (hard refuse at run start; human-meaningful header
  fields + fingerprints in a repo sidecar; footprint recomputed through extraction;
  explicit declaration; spec retirement refuses, never cascades). Not re-decided here.
- **Report command is a nested `plans` group and `plans-overlap` migrates into it as
  `plans overlap` (user-decided 2026-08-10).** Loss accepted: a breaking rename of an
  existing command inside this plan — taken to avoid a permanently inconsistent CLI
  surface (`plans status` next to flat `plans-overlap`).
- **Ground-changed diffs baseline → working tree, not baseline → HEAD (user-decided
  2026-08-10):** `git diff --name-only <baseline> --` so uncommitted edits to footprint
  files already count. Loss accepted: report stability on a dirty repo — the verdict can
  flip as you edit before committing. Untracked files stay invisible to the diff; a file
  not yet in the repository is not ground.
- **No in-run re-approval of plans 39/41/44/45 (user-decided 2026-08-10):** operator
  re-approves after merge (see Overview). Loss accepted: zero-touch rollout — refused
  because a baseline recorded on the run's own branch is falsified by the very merge that
  lands it, and approval is a human gesture.
- **Digest algorithm: SHA-256** (already the repo's content-address in
  `src/app/planCacheStore.ts`). Fingerprint input is the artifact's full text minus the
  phax-managed header lines: any `Status:` or `Approved:` line in the header region
  (before the first `## `). `Source-Spec:` is authored content and stays inside the
  fingerprint — editing it is `self-changed`.
- **Sidecar is `docs/plans/approvals.json`,** one file, keyed by repo-relative plan path,
  required fields, `version: 1` (no back-compat shims). Missing file decodes as an empty
  store; a missing or undecodable entry makes the plan compute stale (§5.14 — the safe
  direction), never fresh.
- **Chain gates and record capture live inside `transitionArtifact`** — one entry point
  no caller can bypass. Loss accepted: its requirements widen to `FileSystem | Git` and
  its signature gains `{ repoRoot, nowIso }` even for transitions that need neither.
- **Declared-spec resolution accepts the declared path or its `archivePathFor`
  counterpart.** A spec archived after its dependents went terminal moves file location;
  the declaration keeps naming the spec. Only when neither location exists is the
  declaration dangling (§5.2).
- **The run-start staleness gate applies only to repo-tracked artifact plans**
  (`classifyArtifactPath` ≠ null). A loose `plan.md` outside `docs/plans/` cannot carry
  an approval record, so gating it would refuse every such run; plan 21 set the same
  scope for the status gate. Loss accepted: §5.11 does not protect loose plans.
- **The gate sits in `run.ts` after `loadOrExtractPlan`** — staleness needs the footprint,
  and the run has already paid for that extraction. The staleness core takes a footprint
  as input so the run gate and the report share one computation without extracting twice.
- **`--apply` records reasons in the gesture's output, not in the plan file.** The
  evidence stays recomputable from the sidecar record; the lifecycle header stays minimal
  (§5.13's "recording the reasons" is satisfied by the command's rendered report).
- **`phax plans status` exits 0 even when stale plans exist** — it is a report, not a
  gate; the gate is `phax run`. Errors (unreadable plan, invalid artifact) still exit
  non-zero.
- **Terminal plan transitions drop the plan's sidecar entry** (the record is bound to the
  live path and an approval of a retired plan is meaningless); `Stale` and `Draft`
  transitions leave it in place — re-approval replaces it anyway (§5.12).

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli

## Required PHAX security configuration changes

No changes required: `pnpm gen:usage-spec` and `pnpm docs:cli` are already present in
`security.agentCommands` in `phax.json`; the preflight will confirm coverage.

## phase-01 — Lineage, fingerprint, and staleness domain {#phase-01-lineage-domain}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Introduce the pure vocabulary of spec 22: the `Source-Spec:` declaration grammar, the
content fingerprint's input normalization, the `Approved:` stamp helper, the staleness
verdict computation with its closed reason set, the approval-record sidecar schema, and
the new error types — plus the plan-validation extension that makes a missing declaration
an error.

### Detailed instructions

- Create `src/domain/artifact/lineage.ts` (pure, no I/O):
  - `SourceSpecDeclaration = { kind: "spec"; path: string } | { kind: "none" }`.
  - `readSourceSpecLine(md): SourceSpecDeclaration | null` — first line matching
    `Source-Spec: <value>` in the header region (reuse the same header-region rule as
    `readStatusLine`: lines before the first `## `); `(none)` → `{ kind: "none" }`, any
    other non-empty value → `{ kind: "spec", path }`; absent line or empty value → `null`.
  - `fingerprintableContent(md): string` — the markdown with every header-region line
    matching `/^Status:/` or `/^Approved:/` removed; lines at or below the first `## `
    are never touched. This is the digest input for both kinds (§4 "content
    fingerprint"); do not hash here — hashing lives in the app layer (phase-03), like
    `planMdSha256`.
  - `upsertApprovedLine(md, dateIso, shortBaseline): string` — inserts or replaces the
    header-region line `Approved: <YYYY-MM-DD> @ <shortBaseline>` (date = the ISO
    string's date part), placed directly after the `Source-Spec:` line when present,
    else after the `Status:` line. Format is indicative per spec §6.
  - `STALENESS_REASONS = ["spec-changed", "ground-changed", "self-changed"] as const`
    with `StalenessReason` derived — a closed enum per spec §10; do not add reasons.
  - Verdict types:
    - `StalenessEvidence = { reason: "spec-changed"; specPath: string } | { reason: "ground-changed"; baseline: string; files: readonly string[] } | { reason: "self-changed" }`
    - `PlanStalenessVerdict = { kind: "fresh" } | { kind: "stale"; evidence: readonly StalenessEvidence[] } | { kind: "missing-record"; detail: string }`
      (`missing-record` renders as stale per §5.14 but is a distinct variant — explicit
      per-variant shapes over a permissive superset).
  - `computeStaleness(input): PlanStalenessVerdict` where `input` is
    `{ record: ApprovalRecord | null; baselineExists: boolean; currentPlanFingerprint: string; currentSpecFingerprint: string | null; changedFilesSinceBaseline: readonly string[]; footprint: readonly string[] }`:
    no record → `missing-record` naming the absence; record present but
    `baselineExists === false` → `missing-record` naming the vanished baseline commit;
    otherwise collect evidence in enum order — `spec-changed` when the record has a spec
    binding and `currentSpecFingerprint` differs (§5.7), `ground-changed` when
    `changedFilesSinceBaseline ∩ footprint` is non-empty, carrying the intersecting
    files (§5.8), `self-changed` when the plan fingerprint differs (§5.9); empty
    evidence → `fresh`.
  - `APPROVALS_FILE_PATH = "docs/plans/approvals.json"` exported constant.
- Edit `src/domain/artifact/document.ts`: `validateArtifact` gains the §5.1 rule — for
  `kind === "plan"` (live or archived), a `null` `readSourceSpecLine` result fails with
  an `ArtifactValidationError` naming the missing/empty `Source-Spec:` declaration.
  Existence of the declared path is deliberately not checked here (pure function; the
  app layer checks it at approve and staleness time).
- Create `src/schemas/approvalRecord.ts` decoding the sidecar file (idiom of
  `src/schemas/extractedPlanCacheEntry.ts`):
  - `ApprovalRecord = { planFingerprint: string; approvedAt: string; baseline: string; sourceSpec: { path: string; fingerprint: string } | null }`
    — `baseline` constrained to 40-char lowercase hex.
  - `ApprovalRecordFile = { version: 1; records: Record<string, ApprovalRecord> }` via
    `Schema.Record`; export `decodeApprovalRecordFile` / `encodeApprovalRecordFile` and
    the inferred types (the domain `computeStaleness` input references `ApprovalRecord`
    — bridge or re-export so there is exactly one shape).
- Edit `src/domain/errors.ts`, adding:
  - `SpecNotApprovedError` — `{ planPath; specPath; specStatus: string }`, message per
    §5.3/§6: the plan, the declared spec, its current status, "approve the spec first".
  - `SpecRetirementBlockedError` — `{ specPath; dependents: readonly { path: string; status: string }[] }`,
    message naming each dependent and its status, "abandon or archive them first" (§5.4).
  - `PlanStaleError` — `{ path; verdict: PlanStalenessVerdict }` with a `message` getter
    rendering every reason with its evidence and naming re-approval
    (`phax artifact approve <path>`) as the remedy (§5.11).
- Update existing fixtures that `validateArtifact` now rejects: the inline plan markdown
  in `tests/unit/artifact/document.test.ts` and `tests/integration/artifactStatus.test.ts`
  gains `Source-Spec:` lines (use `(none)` unless the case needs a spec binding).

### Planned files to create

- src/domain/artifact/lineage.ts
- src/schemas/approvalRecord.ts
- tests/unit/artifact/lineage.test.ts

### Planned files to edit

- src/domain/artifact/document.ts
- src/domain/errors.ts
- tests/unit/artifact/document.test.ts
- tests/integration/artifactStatus.test.ts

### Optional files that may be edited

- tests/unit/schemas.test.ts
- tests/unit/cli/artifact.test.ts

### Boundary contracts

- Domain → schemas: `ApprovalRecord` has one canonical shape consumed by
  `computeStaleness`; the schema decodes the sidecar into exactly that shape.
- Later phases consume `readSourceSpecLine`, `fingerprintableContent`,
  `upsertApprovedLine`, `computeStaleness`, the verdict/evidence types,
  `APPROVALS_FILE_PATH`, and the three error classes — keep the names stable and export
  them all.

### Test strategy

Unit tests, written **before** implementation (domain invariants):

- `tests/unit/artifact/lineage.test.ts` —
  - declaration grammar: path form, `(none)` form, absent line, empty value, a
    `Source-Spec:` line below the first H2 ignored;
  - fingerprint input: changing only the `Status:` line leaves
    `fingerprintableContent` unchanged; adding/replacing the `Approved:` stamp leaves it
    unchanged (§8 "Recording status does not change the fingerprint"); editing the
    `Source-Spec:` line or any body text changes it; `Status:`-looking lines below the
    first H2 are preserved;
  - `upsertApprovedLine`: insert after `Source-Spec:`, replace an existing stamp,
    round-trip with `fingerprintableContent`;
  - `computeStaleness`: full matrix — fresh; each single reason with its evidence
    (ground-changed names exactly the intersection); all three reasons together in enum
    order; disjoint changes → fresh (§8); no record → `missing-record`; record with
    vanished baseline → `missing-record`; spec-less record never reports `spec-changed`.
- `tests/unit/artifact/document.test.ts` — new cases: plan without `Source-Spec:` fails
  naming the declaration (§5.1, live and archived paths); spec without one still
  validates; plan with `(none)` validates.
- Sidecar schema decode/encode round-trip, missing-field rejection, and bad-baseline
  rejection — inline in the lineage test or in `tests/unit/schemas.test.ts`.

### Implementation order

Tests first, then `lineage.ts`, then the `document.ts` validation extension, then
`schemas/approvalRecord.ts`, then the error classes, then the fixture repairs.

### Excluded scope

- Hashing (SHA-256 lives in the app layer, phase-03).
- Any file or git I/O; existence checks for declared specs (phase-03/04).
- CLI surface (phase-05) and run gating (phase-06).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact exported symbol names and signatures from `lineage.ts`,
  `schemas/approvalRecord.ts`, and the new error classes, so phases 02–04 import them
  without re-reading this phase.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): add lineage, fingerprint, and staleness domain model

### Commit body

Pure vocabulary for spec 22: Source-Spec declaration grammar with explicit (none) form,
fingerprint input normalization excluding phax-managed header lines, Approved-stamp
helper, staleness computation over the closed reason set with per-reason evidence and
missing-record as the safe default, approval-record sidecar schema, and errors for the
two chain gates and the run refusal. Plan validation now fails without a Source-Spec
declaration. Unit coverage over the grammar, fingerprint invariance, and the full
staleness matrix.

## phase-02 — Git port baseline operations {#phase-02-git-baseline-ops}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Give the Git port the three read operations the approval record and staleness computation
need: current HEAD, commit existence, and files changed since a baseline (working-tree
inclusive).

### Detailed instructions

- Edit `src/ports/git.ts`, adding to `GitOps`:
  - `headCommit(repo: string): Effect<string, GitError>` — the full 40-hex HEAD sha.
  - `commitExists(commit: string, repo: string): Effect<boolean, GitError>` — false when
    the sha is unknown to the repository (rebased/GC'd baseline).
  - `changedFilesSince(baseline: string, repo: string): Effect<readonly string[], GitError>`
    — repo-relative POSIX paths changed between the baseline commit and the current
    **working tree** (user decision: uncommitted edits count; untracked files do not).
- Edit `src/infra/git.ts`:
  - `headCommit` → `git rev-parse HEAD`, trimmed and validated 40-hex (parse helper in
    `src/schemas/git.ts`, idiom of `parseBranchOutput`); malformed output fails with
    `GitError`.
  - `commitExists` → `gitRunAllowFail(["rev-parse", "--verify", "--quiet", baseline + "^{commit}"], repo)`,
    exit code 0 ⇒ true. The baseline always comes from the decoded sidecar record
    (40-hex by schema), never raw user input.
  - `changedFilesSince` → `git diff --name-only <baseline> --`, stdout split into
    non-empty trimmed lines (parse helper in `src/schemas/git.ts`).
- Edit `src/infra/fakes/git.ts`: extend `GitCall` and `FakeGitImpl` — settable
  `headCommitValue`, an `existingCommits` set (default: contains `headCommitValue`), and
  a `changedFilesSinceResults` map from baseline → file list (default empty list), all
  recorded in `calls`.

### Planned files to create

- tests/integration/gitBaseline.test.ts

### Planned files to edit

- src/ports/git.ts
- src/infra/git.ts
- src/infra/fakes/git.ts
- src/schemas/git.ts

### Optional files that may be edited

- tests/unit/mergeLayers.test.ts
- tests/unit/schemas.test.ts

### Boundary contracts

- Port → consumers: phase-03 calls `headCommit`; phase-04 calls `commitExists` and
  `changedFilesSince`. Keep the three names and signatures stable.
- All three are reads; none mutate repository state.

### Test strategy

- `tests/integration/gitBaseline.test.ts` — template
  `tests/integration/gitDiffNameStatus.test.ts` (real git in a temp dir): `headCommit`
  returns the sha `git rev-parse HEAD` reports; `commitExists` true for HEAD, false for
  a well-formed unknown sha; `changedFilesSince` across a follow-up commit lists exactly
  the touched files, **includes** an uncommitted working-tree edit, excludes an
  untracked file, and returns empty for baseline == HEAD with a clean tree.
- Fake behavior (queue/set semantics) asserted where first consumed (phase-03/04
  integration tests); no dedicated fake test needed.

### Implementation order

Port interface, then the infra adapter with its parse helpers, then the fake, then the
integration test (test-first is impractical against real git plumbing; write the test
alongside the adapter).

### Excluded scope

- Any consumer wiring (phases 03, 04, 06).
- No changes to existing Git operations.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The three exact signatures as landed in `src/ports/git.ts` and the fake's
  configuration surface (field names), so phases 03–04 can drive them in tests.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(git): add headCommit, commitExists, and changedFilesSince port operations

### Commit body

Three read operations backing spec 22's approval baseline: HEAD resolution for record
capture, commit-existence probing so a vanished baseline degrades to stale instead of
crashing, and baseline-to-working-tree changed-file listing (uncommitted edits included,
untracked files excluded) for ground-change detection. Implemented in the node adapter
with schema-parsed output, mirrored in the fake, covered by a real-git integration test.

## phase-03 — Chain-gated approval with record capture {#phase-03-gated-approval}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

`transitionArtifact` becomes lineage-aware: plan approval is chain-gated on the declared
spec and captures the approval record (sidecar entry + header stamp); spec retirement is
refused while non-terminal dependents exist; terminal plan transitions drop the sidecar
entry.

### Detailed instructions

- Create `src/app/approvalRecordStore.ts` (conventions of `src/app/planCacheStore.ts`):
  - `readApprovalStore(): Effect<ApprovalRecordFile, FsError, FileSystem>` — reads
    `APPROVALS_FILE_PATH`; a missing file yields `{ version: 1, records: {} }`; an
    unparsable or undecodable file also yields the empty store (a corrupt store must
    degrade toward stale, §5.14, never crash a transition — but surface a warning
    string in the return if trivial, else silently empty).
  - `putApprovalRecord(planPath, record)` / `removeApprovalRecord(planPath)` —
    read-modify-write via `fs.writeAtomic`, keys sorted so diffs stay stable.
  - `artifactFingerprint(md): string` — SHA-256 hex over
    `fingerprintableContent(md)` (`createHash` from `node:crypto`, exactly like
    `planMdSha256`). Exported; phase-04 reuses it.
- Edit `src/app/artifactStatus.ts` — `transitionArtifact(repoRelPath, target, opts)`
  with `opts: { repoRoot: string; nowIso: string }`; requirements widen to
  `FileSystem | Git`; error channel gains `SpecNotApprovedError | SpecRetirementBlockedError | GitError`:
  - **Plan → `Approved`** (first approval and re-approval, §5.3/§5.5): after the
    existing validate + `requestTransition` steps and before any write —
    `readSourceSpecLine` (validation guarantees presence). When it names a spec:
    resolve the declared path, falling back to `archivePathFor(declaredPath)`; neither
    exists → `ArtifactValidationError` naming the dangling reference (§5.2); the
    resolved path must classify as a spec; read + `validateArtifact` it; status must be
    `Approved`, else `SpecNotApprovedError` (an archived spec refuses here too — its
    status is terminal, not `Approved`). Then capture: `baseline = headCommit(repoRoot)`,
    `planFingerprint = artifactFingerprint(updatedMd)` where `updatedMd` already carries
    the new status line and the `upsertApprovedLine` stamp (date from `opts.nowIso`,
    short baseline = first 7 chars) — the fingerprint is stamp-invariant by phase-01, so
    compute it after stamping; `sourceSpec` = `{ path: <declared path as written>,
    fingerprint: artifactFingerprint(specMd) }` or `null` for `(none)` (§5.5, §8 "A
    spec-less plan skips the chain"). `putApprovalRecord` under the plan's repo-relative
    path, then write the stamped markdown in place.
  - **Spec → terminal** (`Abandoned`/`Archived`, §5.4): before any write, list
    `docs/plans/` (`fs.list`, `.md` entries only, skip the `archive/` subdirectory
    entry), read each plan, and collect those whose declaration names this spec (match
    the declared path against the spec's current path or its `archivePathFor`
    counterpart). Plans in the live directory are non-terminal by the location
    invariant, so any match blocks: fail with `SpecRetirementBlockedError` naming each
    dependent with its status. A dependent that fails validation blocks too (fail with
    its validation error — the safe direction). Never transition a plan as a side
    effect.
  - **Plan → terminal**: after the move, `removeApprovalRecord(oldPath)`.
  - All other transitions (including plan → `Stale`, `Stale → Draft`, spec approve)
    keep today's behavior; they simply ignore `opts` beyond plumbing.
- Edit `src/cli/commands/artifact.ts`: `buildLayer` merges `NodeGitLayer`
  (`makeNodeGitLayer()` from `src/infra/git.js` — layer composition is the CLI's allowed
  infra touch); pass `{ repoRoot: findGitRoot(process.cwd()), nowIso: new Date().toISOString() }`;
  on a successful `approve` of a plan, additionally log the recorded baseline (short
  sha).
- Edit `src/cli/commands/runLayers.ts`: add `SpecNotApprovedError`,
  `SpecRetirementBlockedError`, and `PlanStaleError` to the exit-code-12 group (all
  lifecycle refusals share 12; distinctness lives in the message, per plan 21).

### Planned files to create

- src/app/approvalRecordStore.ts

### Planned files to edit

- src/app/artifactStatus.ts
- src/cli/commands/artifact.ts
- src/cli/commands/runLayers.ts
- tests/integration/artifactStatus.test.ts
- tests/unit/cli/artifact.test.ts

### Optional files that may be edited

- src/domain/errors.ts
- tests/integration/cliErrors.test.ts

### Boundary contracts

- App → ports only: `FileSystem` for artifact and sidecar I/O, `Git` for `headCommit`.
  The chain-gate and record logic lives in the app layer; the CLI still only parses,
  calls, renders.
- Phase-04 consumes `readApprovalStore` and `artifactFingerprint`; phase-04's `--apply`
  and phase-06's remedy path rely on `transitionArtifact`'s widened signature. Keep all
  three stable and record them in the handoff.

### Test strategy

Integration tests with `makeFakeFileSystem()` + `FakeGitImpl`, written **before**
implementation (application-command behavior, spec §8 criteria):

- Chain gate: approving a plan whose declared spec is `Draft` refuses with
  `SpecNotApprovedError` naming spec and status; same spec `Approved` → approval
  proceeds (§8 "Approval is chain-gated"); declared spec resolved at its archive path
  refuses (terminal ≠ Approved); dangling declaration refuses naming the reference (§8
  "A dangling declaration fails validation").
- Record capture: after approve, the sidecar holds plan fingerprint, spec identity +
  fingerprint, and the fake's HEAD as baseline; the plan header carries the `Approved:`
  stamp; re-approval replaces the entry (§8 "Approval records the ground"). `(none)`
  plan: approval proceeds, `sourceSpec` is null (§8 "A spec-less plan skips the chain").
- Retirement gate: archiving a spec with a live dependent refuses naming the plan and
  status; after abandoning the dependent, the archive proceeds and no plan changed
  status as a side effect (§8 "Spec retirement is chain-gated"); a spec nothing depends
  on archives cleanly.
- Sidecar hygiene: abandoning an approved plan removes its entry; corrupt
  `approvals.json` does not block a transition.
- `tests/unit/cli/artifact.test.ts`: approve renders the baseline; refusals exit 12.

### Implementation order

Tests first, then `approvalRecordStore.ts`, then the `transitionArtifact` extension
(approve path, then retirement gate, then terminal cleanup), then the CLI wiring.

### Excluded scope

- Staleness computation and the report (phase-04); run gating (phase-06).
- Any transition-table change — the legal-transition tables of plan 21 are untouched.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `transitionArtifact` signature and error-channel union, and the exact
  exports of `approvalRecordStore.ts`.
- The sidecar's JSON shape as written (one sample entry) so phase-04 tests can seed it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): chain-gate plan approval and capture approval records

### Commit body

Plan approval now enforces spec 22's chain — the declared source spec must exist and be
Approved — and records what the approval was given against: plan and spec content
fingerprints plus the repository HEAD baseline, persisted in docs/plans/approvals.json
with a human-readable Approved stamp in the plan header. Spec retirement refuses while
live dependent plans exist; terminal plan transitions drop their sidecar entry. New
refusals exit 12. Covered by fake-fs/fake-git integration tests over §5.2–§5.5.

## phase-04 — Staleness computation and report use cases {#phase-04-staleness-usecases}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Compute, for any Approved repo-tracked plan, whether its approval still holds — and
produce the every-Approved-plan report plus the explicit `--apply` gesture.

### Detailed instructions

- Create `src/app/planStaleness.ts`:
  - `computeStalenessForPlan(planPath, planMd, footprint, opts): Effect<PlanStalenessVerdict, FsError | GitError | ArtifactValidationError, FileSystem | Git>`
    — the core, extraction-free: `opts = { repoRoot: string }`, `footprint` is the
    plan's file-level footprint (already-extracted). Steps: read the sidecar
    (`readApprovalStore`); no entry for `planPath` → `missing-record` (§5.14);
    `commitExists(record.baseline)` false → `missing-record` naming the vanished
    baseline; current plan fingerprint via `artifactFingerprint(planMd)`; when the
    record has a spec binding, resolve the spec at its recorded path or
    `archivePathFor` fallback (neither → `ArtifactValidationError`, dangling, §5.2) and
    fingerprint it; `changedFilesSince(record.baseline, repoRoot)`; feed
    `computeStaleness`. Purely a read — never writes anything (§5.13).
  - `computePlanStaleness(planPath, opts): Effect<..., ..., FileSystem | Git | Backend>`
    — wrapper that reads the plan and obtains the footprint through
    `loadOrExtractPlan` (`opts` additionally `{ stateRoot, model, effort, nowIso, noExtract? }`,
    the `analyzePlanOverlap` loader pattern): map the extracted plan through
    `planInputFromPhaxPlan` + `buildFootprint` (`src/domain/planOverlap/`), footprint =
    the `all` set (create ∪ edit ∪ optional, §4). Deterministic extraction or a cache
    hit makes this free; content changed since approval also means `self-changed`, so a
    fresh verdict never depends on an LLM call.
  - `plansStalenessReport(opts): Effect<StalenessReport, ...>` — list `docs/plans/`
    (`.md` files, live directory only — archived plans are terminal by invariant),
    `validateArtifact` each; entries with status `Approved` get a verdict via
    `computePlanStaleness`; per-plan failures (validation, extraction) become error
    entries in the report rather than aborting the sweep (`Effect.either` per plan).
    `StalenessReport = readonly { path: string; result: PlanStalenessVerdict | { kind: "error"; message: string } }[]`
    covering **every** Approved plan (§5.10).
  - `applyStalenessReport(report, opts): Effect<...>` — for each entry whose verdict is
    `stale` or `missing-record`, `transitionArtifact(path, "Stale", opts)` (§5.13 — the
    lifecycle table's `Approved → Stale`); return the flipped paths with their reasons.
    Report-only callers never reach this function; nothing else writes status.
- Create `src/domain/artifact/render.ts` (pure, idiom of
  `src/domain/planOverlap/render.ts`): `renderStalenessReport(report): string` — the
  §6 table shape: path, `fresh` or `STALE`, one line per reason with evidence
  (ground-changed lists the intersecting files and the short baseline; missing-record
  says so and names re-approval); and `renderStalenessApply(flipped): string`.

### Planned files to create

- src/app/planStaleness.ts
- src/domain/artifact/render.ts
- tests/integration/planStaleness.test.ts

### Planned files to edit

- (none)

### Optional files that may be edited

- src/domain/errors.ts
- src/app/approvalRecordStore.ts
- tests/unit/artifact/lineage.test.ts

### Boundary contracts

- App → ports: `FileSystem`, `Git`, and `Backend` (only inside the
  `loadOrExtractPlan` wrapper). The core (`computeStalenessForPlan`) must stay
  Backend-free — phase-06 calls it with the run's own extraction result.
- Phase-05 consumes `plansStalenessReport`, `applyStalenessReport`, and the two
  renderers; phase-06 consumes `computeStalenessForPlan`. Keep the four names and
  signatures stable.

### Test strategy

Integration tests with `makeFakeFileSystem()` + `FakeGitImpl` + the fake backend,
written **before** implementation (spec §8 criteria; seed the sidecar with the phase-03
handoff's JSON shape and use deterministic-parseable plan fixtures so the backend is
never invoked):

- Fresh plan → `fresh`; spec content edit → `spec-changed` (§8 "Spec edit flips the
  verdict"); footprint file in `changedFilesSince` → `ground-changed` naming exactly
  that file (§8 "Ground change names the files"); non-footprint changes → `fresh` (§8
  "Disjoint changes do not flip"); plan body edit → `self-changed` (§8 "Plan edit flips
  the verdict"); several at once → all reasons in enum order.
- No sidecar entry → `missing-record` (§8 "No record means stale"); baseline sha absent
  from the fake's `existingCommits` → `missing-record` naming it.
- Re-approval (`transitionArtifact` to Approved) then recompute → `fresh` (§8
  "Re-approval restores freshness", §5.12).
- Report: one Approved-fresh, one Approved-stale, one Draft plan → report lists exactly
  the two Approved entries; the Draft plan's status is untouched; computing/reporting
  rewrote no plan file (§5.13, §8 "The flip is a gesture" — report side).
- Apply: flips exactly the stale-computed plans to `Stale` through the lifecycle
  transition (file now reads `Stale`), leaves fresh ones `Approved` (§8 "The flip is a
  gesture" — apply side); a per-plan extraction failure yields an error entry and the
  sweep still completes.

### Implementation order

Tests first, then `computeStalenessForPlan`, then the extraction wrapper, then the
report/apply sweeps, then the renderers.

### Excluded scope

- CLI registration and flags (phase-05); the run gate (phase-06).
- Acting on staleness beyond the flip — no re-planning, scheduling, or batching (spec
  §7).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exports and signatures of `planStaleness.ts` and `render.ts`, flagging
  which functions phase-06 may call without a Backend in scope.
- The `StalenessReport` entry shape for phase-05's `--json` output.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plans): compute plan staleness and the report/apply use cases

### Commit body

Staleness of an Approved plan is now computable: the approval record's fingerprints and
baseline are checked against the current spec content, plan content, and
baseline-to-working-tree changed files intersected with the extraction-derived footprint,
yielding fresh or per-reason evidence, with missing or invalidated records reporting
stale by design. A report sweep covers every live Approved plan without writing anything;
apply flips stale-computed plans Approved→Stale through the lifecycle transition. Covered
by fake-port integration tests over §5.6–§5.14.

## phase-05 — plans command group: status, apply, overlap migration {#phase-05-plans-cli}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Expose the report over the CLI as a nested `plans` group — `phax plans status
[--apply] [--json]` — and migrate the existing flat `plans-overlap` into it as
`phax plans overlap`, with all four command satellites kept in sync.

### Detailed instructions

- Create `src/cli/commands/plans.ts` exporting `registerPlansCommand(program, out)`
  (nested-subcommand shape of `src/cli/commands/artifact.ts` — never a space-separated
  command name):
  - `plans status` with `--apply` and `--json`: load config (`loadConfig`) for
    `extractPlanModel` / `extractPlanEffort` / `stateRoot`; provide
    `makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)` + `NodeFileSystemLayer` +
    `makeNodeGitLayer()` + `NoopSystemTelemetryLayer` (the `plansOverlap.ts` layer
    pattern plus Git); call `plansStalenessReport`, render via
    `renderStalenessReport` (or JSON); with `--apply`, then call
    `applyStalenessReport` and render the flipped set. Exit 0 whether or not stale
    plans exist (report, not gate); errors exit via `exitCodeForError`.
  - `plans overlap <plan...>` with `--json`, `--no-extract`, `--landed <run>`:
    delegate to the existing `runPlansOverlap` unchanged.
- Edit `src/cli/program.ts`: remove the flat `plans-overlap` registration (a breaking
  rename, user-decided) and register `registerPlansCommand` alongside the other
  `register*` calls; keep the `runPlansOverlap` import path working via `plans.ts`.
- Edit `src/cli/cliDocs.ts`: remove the `plans-overlap` entry; add `plans`,
  `plans status`, and `plans overlap` entries, each with `longHelp` and at least one
  example (`usageSpecExamples` enforces this). `plans status` examples: plain report
  and `--apply`.
- Regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and the CLI docs
  (`docs/cli/reference.md` + README section) with `pnpm docs:cli` — both drift-guarded;
  never hand-edit.
- Edit `tests/integration/cliProgram.test.ts`: `TOP_LEVEL_COMMANDS` — remove
  `plans-overlap`, add `plans` (the test asserts exact length equality); repoint the
  "plans-overlap has variadic <plan...> arg" case at the nested `plans overlap`
  subcommand.

### Planned files to create

- src/cli/commands/plans.ts
- tests/unit/cli/plans.test.ts

### Planned files to edit

- src/cli/program.ts
- src/cli/cliDocs.ts
- phax.usage.kdl
- docs/cli/reference.md
- README.md
- tests/integration/cliProgram.test.ts

### Optional files that may be edited

- src/cli/commands/plansOverlap.ts
- tests/integration/plansOverlapCommand.test.ts
- tests/integration/plansOverlapLanded.test.ts
- src/cli/cliCompleters.ts

### Boundary contracts

- CLI → app only: `plans.ts` parses flags, calls `plansStalenessReport` /
  `applyStalenessReport` / `runPlansOverlap`, renders through `OutputPort`; verdict
  logic and the flip all live below. Infra imports restricted to layer composition.

### Test strategy

- `tests/unit/cli/plans.test.ts` — template `tests/unit/cli/artifact.test.ts`: mock
  `src/app/planStaleness.js`; `status` renders fresh and stale entries with reasons and
  exits 0; `status --apply` calls the apply use case and reports the flipped plans;
  without `--apply` the apply use case is **not** called (§8 "The flip is a gesture" at
  the surface); an app error exits non-zero with the message.
- The drift suites (`usageSpecDrift`, `usageSpecExamples`, `usageSpecLint`,
  `docsCliDrift`, `cliProgram`) mechanically prove the satellites and the
  `plans-overlap` → `plans overlap` rename are consistent.

### Implementation order

Command file + unit test first, then program registration and the flat-command removal,
then cliDocs, then the two regenerations, then the `cliProgram` test edits.

### Excluded scope

- The run gate (phase-06).
- Any behavior change to the overlap analysis itself — `runPlansOverlap` moves, its
  logic does not.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final subcommand spellings and flags as registered.
- Confirmation that `phax.usage.kdl`, `docs/cli/reference.md`, and the README were
  regenerated via the package scripts.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add plans command group with staleness status and migrated overlap

### Commit body

New nested plans command group: plans status reports every Approved plan as fresh or
stale with per-reason evidence, and --apply flips the stale-computed ones
Approved→Stale as an explicit gesture; the flat plans-overlap command migrates to plans
overlap unchanged in behavior. Usage KDL, CLI reference, README, and the command-tree
test are regenerated and updated in the same commit.

## phase-06 — Gate phax run on fresh plans {#phase-06-run-staleness-gate}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

`phax run` computes staleness for repo-tracked plans right after extraction and refuses
to start when the ground has moved, naming each reason and re-approval as the remedy.

### Detailed instructions

- Edit `src/cli/commands/run.ts`: after `loadOrExtractPlan` succeeds and before the run
  pipeline continues, and only when the plan path classifies as an artifact
  (`classifyArtifactPath(planRepoRel) !== null` — the same repo-relative path already
  computed for the status gate): derive the footprint from the just-extracted plan
  (`planInputFromPhaxPlan` + `buildFootprint`, the `all` set) and run
  `computeStalenessForPlan(planRepoRel, planMd, footprint, { repoRoot })` with
  `NodeFileSystemLayer` + `makeNodeGitLayer()` provided locally. Verdict `fresh` →
  proceed. `stale` or `missing-record` → `out.error(new PlanStaleError({...}).message)`
  (every reason with evidence, remedy `phax artifact approve <plan>`, §5.11) and return
  `exitCodeForError` (12). A `GitError`/`FsError` during the check refuses too (the
  gate must not silently pass on failure) with the underlying message.
- Loose plans outside `docs/plans/` skip the gate entirely (arbitration above) — the
  e2e `minimal-repo` fixture keeps running with no approval record.
- Do **not** touch `resume` or extraction paths — resuming stays ungated per plan 21,
  and `phax extract-plan` still works on any plan.

### Planned files to create

- (none)

### Planned files to edit

- src/cli/commands/run.ts
- tests/unit/cli/run.test.ts
- tests/integration/cliErrors.test.ts

### Optional files that may be edited

- src/app/planStaleness.ts
- tests/integration/run.test.ts
- tests/e2e/helpers/runCli.ts

### Boundary contracts

- CLI → app: the gate is one call to `computeStalenessForPlan` (Backend-free core from
  phase-04) plus rendering; reason wording lives in `PlanStaleError`, not in the
  command file.

### Test strategy

Written **before** implementation (spec §8 "A stale plan does not run" /
"Re-approval restores freshness"):

- `tests/unit/cli/run.test.ts` — new cases mocking `src/app/planStaleness.js`: an
  Approved `docs/plans/` plan with a fresh verdict proceeds into the mocked pipeline;
  a stale verdict refuses with exit 12, the message naming each reason, its evidence,
  and the approve remedy, and the pipeline is never entered; a `missing-record` verdict
  refuses likewise; a plan at a non-artifact path never invokes the staleness check
  (assert the mock uncalled).
- `tests/integration/cliErrors.test.ts` — spawn the real CLI in a temp repo against an
  Approved `docs/plans/` plan with no approval record: exit 12, message names the
  missing record and the approve remedy, no stack trace.

### Implementation order

Unit-test cases first, then the gate in `run.ts`, then the integration case.

### Excluded scope

- Gating `resume` or extraction.
- Auto-flipping status at run start — the run refuses; the flip stays a `--apply` /
  `artifact stale` gesture (§5.13).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The line-level anchor of the gate in `run.ts` and the final refusal wording.
- Confirmation that loose-plan runs and `resume` are unaffected.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): refuse to start runs from stale plans

### Commit body

phax run now computes staleness for repo-tracked plans after extraction, reusing the
run's own footprint: spec-changed, ground-changed, and self-changed verdicts — and
missing approval records — refuse with exit 12, naming each reason with its evidence and
re-approval as the remedy. Loose plan.md files outside docs/plans/ and the resume path
stay ungated. Covered by CLI unit cases and a real-CLI integration refusal test.
