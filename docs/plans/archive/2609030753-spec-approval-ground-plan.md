---
status: Completed
source-spec: docs/specs/2609030749-spec-approval-ground.md
approved:
  date: 2026-09-03
  baseline: 1ad91c2
---

# Spec approval ground

Implements spec 31: spec approval gets the same recorded ground plan approval
has — an `approved: { date, baseline }` stamp in the spec frontmatter, a
`docs/specs/approvals.json` record with the spec's content fingerprint, a legal
`Approved → Approved` re-stamp, an `artifact status` report of
edited-since-approval / unrecorded, and a plan-approval chain gate that refuses
a spec that is edited since approval or unrecorded.

Migration is deliberately **not** in this plan (spec §10): after it lands, the
five live Approved specs (18, 19, 23, 24, 30) are re-approved by hand with
`phax artifact approve`, and their `date` keys restored to plain dates in the
same commit series. Do that before approving any plan against them, since the
new chain gate refuses an unrecorded spec.

---

## Required commands

- (none)

---

## Context

- Frontmatter key sets are Effect schemas in `src/schemas/artifactFrontmatter.ts`
  (`SpecFrontmatterSchema`, `PlanFrontmatterSchema`, `PlanApprovedSchema`),
  decoded with `onExcessProperty: "error"` by `decodeArtifactFrontmatter` in
  `src/domain/artifact/frontmatter.ts`. `fingerprintSource` already deletes
  `status` and `approved` for both kinds, so a spec stamp is fingerprint-neutral
  for free.
- Transition tables live in `src/domain/artifact/status.ts`
  (`SPEC_TRANSITIONS`, `PLAN_TRANSITIONS`); `legalTargetsFrom` and
  `requestTransition` read them.
- `stampApproved` / `clearApproved` in `src/domain/artifact/lineage.ts` are
  kind-agnostic; `APPROVALS_FILE_PATH` (`docs/plans/approvals.json`) lives
  there too. `transitionWriteSet` in `writeSet.ts` adds the plan sidecar to the
  commit write-set for approve / reopen / terminal transitions.
- `src/app/approvalRecordStore.ts` reads/writes the plan sidecar through the
  `FileSystem` port with `src/schemas/approvalRecord.ts` and exposes
  `artifactFingerprint`.
- `src/app/artifactStatus.ts`: `inspectArtifact` (the `status` report),
  `transitionArtifact` (plan approve branch stamps + records; reopen clears;
  terminal moves + removes the plan record; `finalizeTransition` commits the
  write-set), the chain gate that raises `SpecNotApprovedError`.
- `src/cli/commands/artifact.ts` renders status and transition results;
  `src/cli/commands/runLayers.ts` maps artifact errors to exit 12;
  `src/cli/cliDocs.ts` holds the `artifact approve` / `artifact status` long
  help, regenerated into `phax.usage.kdl`, `docs/cli/reference.md` and the
  README by `pnpm gen:usage-spec` + `pnpm docs:cli`.
- Tests: `tests/unit/artifact/{status,writeSet,lineage,frontmatter,document}.test.ts`,
  `tests/integration/artifactStatus.test.ts` (fake fs + fake git, covers
  approval record capture, chain gate, sidecar hygiene, auto-commit),
  `tests/integration/planStaleness.test.ts`.

## Technical arbitrations

- **One sidecar I/O helper, two typed front doors.** The plan store's
  read/write is factored to take (path, decode, encode); plans keep
  `putApprovalRecord` / `removeApprovalRecord`, specs get
  `putSpecApprovalRecord` / `removeSpecApprovalRecord` / `readSpecApprovalRecord`
  over their own schema. Loss accepted: two near-identical front doors. The
  alternative (one store keyed by kind with a union record) would admit a plan
  record under a spec path, which the spec's explicit-per-variant rule forbids.
- **Spec approval verdict is a pure domain function.** "Edited since approval"
  is computed in `lineage.ts` from (record | null, current fingerprint) and
  returned as an explicit variant; the app layer only fetches inputs. Loss
  accepted: one more small domain type. It keeps the chain gate and the status
  report from computing the same thing twice.
- **Two new errors rather than widening `SpecNotApprovedError`.**
  `SpecApprovalUnrecordedError` and `SpecEditedSinceApprovalError`, both exit
  12, each with its own remedy text. Loss accepted: two classes. Overloading
  the existing error with a reason field would make its message a switch.

---

## phase-01 — Spec stamp, record schema and transition table {#phase-01-domain-stamp-and-record}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

The domain and schema layers know a spec can carry `approved`, that a spec
approval record exists with its own shape and path, that `Approved → Approved`
is legal for specs, and how to judge a spec against its record. (spec §5.2,
§5.4, §5.5)

### Detailed instructions

- `src/schemas/artifactFrontmatter.ts`: rename `PlanApprovedSchema` to
  `ApprovedStampSchema` (same shape: `date`, `baseline`), use it in both
  frontmatter schemas, and add `approved: Schema.optional(ApprovedStampSchema)`
  to `SpecFrontmatterSchema`. Excess-property rejection stays on, so an
  `approved` mapping with any other sub-key fails.
- `src/schemas/specApprovalRecord.ts` (new): `SpecApprovalRecordSchema`
  `{ specFingerprint: NonEmptyString, approvedAt: NonEmptyString, baseline: 40-hex }`,
  `SpecApprovalRecordFileSchema` `{ version: Literal(1), records: Record<string, …> }`,
  `decodeSpecApprovalRecordFile` (excess → error) and
  `encodeSpecApprovalRecordFile`. Mirror `approvalRecord.ts`; do not share the
  plan record type.
- `src/domain/artifact/status.ts`: `SPEC_TRANSITIONS.Approved` becomes
  `["Approved", "Abandoned", "Completed"]`.
- `src/domain/artifact/lineage.ts`: add
  `SPEC_APPROVALS_FILE_PATH = "docs/specs/approvals.json"` next to
  `APPROVALS_FILE_PATH`, and a pure
  `specApprovalVerdict(record: { specFingerprint } | null, currentFingerprint)`
  returning `{ kind: "unrecorded" } | { kind: "recorded"; editedSinceApproval: boolean }`.
- `src/domain/artifact/writeSet.ts`: for `kind === "spec"`, push
  `SPEC_APPROVALS_FILE_PATH` when the target is `Approved` or terminal
  (specs have no reopen).
- Tests, written first:
  - `tests/unit/artifact/frontmatter.test.ts`: a spec with a valid `approved`
    mapping decodes; a spec whose `approved` carries an extra sub-key is
    rejected naming the allowed keys; `fingerprintSource` of a stamped spec
    equals that of the unstamped spec.
  - `tests/unit/artifact/status.test.ts`: `legalTargetsFrom("spec", "Approved")`
    includes `Approved`; `requestTransition("spec", "Approved", "Approved")` is
    Right.
  - `tests/unit/artifact/lineage.test.ts`: `stampApproved` on a spec body
    leaves other keys and body byte-identical; `specApprovalVerdict` for the
    three cases (null → unrecorded; equal → recorded/not edited; different →
    recorded/edited).
  - `tests/unit/artifact/writeSet.test.ts`: spec approve and spec terminal
    write-sets include `docs/specs/approvals.json`; spec Draft-target write-set
    is unchanged.
  - `tests/unit/schemas/specApprovalRecord.test.ts` (new): round-trip and
    rejection of a non-40-hex baseline and of an excess field.

### Planned files to create

- `src/schemas/specApprovalRecord.ts`
- `tests/unit/schemas/specApprovalRecord.test.ts`

### Planned files to edit

- `src/schemas/artifactFrontmatter.ts`
- `src/domain/artifact/status.ts`
- `src/domain/artifact/lineage.ts`
- `src/domain/artifact/writeSet.ts`
- `tests/unit/artifact/frontmatter.test.ts`
- `tests/unit/artifact/status.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/artifact/writeSet.test.ts`

### Optional files that may be edited

- `tests/unit/artifact/document.test.ts`
- `tests/type/*.ts`

### Boundary contracts

- Consumer: phase-02's app layer. Producer: this phase. Contract:
  `SPEC_APPROVALS_FILE_PATH`, `specApprovalVerdict`, the two spec-record codecs
  and the widened `SpecFrontmatterSchema`, all exported under those names.

### Test strategy

Domain and schema layers: unit tests only, no ports. Write every test listed
above before touching the source; they pin the contract phase-02 builds on.

### Implementation order

1. Schemas (frontmatter widening, new record schema) with their tests.
2. Transition table, lineage helpers, write-set, each with its test.

### Excluded scope

- Any app-layer behavior (recording, chain gate, status report) — phase-02.
- CLI output and docs — phase-03.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact exported names and signatures added to `lineage.ts`, `writeSet.ts`
  and `specApprovalRecord.ts`.
- Confirmation that `fingerprintSource` needed no change for §5.5.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): let specs carry an approval stamp and record shape

### Commit body

Widen the spec frontmatter key set with the plan-style `approved` mapping,
add the spec approval record schema and its sidecar path, make
`Approved → Approved` legal for specs, and add a pure verdict helper that
judges a spec's current fingerprint against its record. Write-sets for spec
approve and terminal transitions now include docs/specs/approvals.json.

---

## phase-02 — Record, re-approve, report and chain-gate {#phase-02-app-record-and-gate}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Approving a spec stamps and records it, re-approval replaces both, terminal
transitions drop the record, `inspectArtifact` reports the approval verdict,
and plan approval refuses a spec that is edited since approval or unrecorded.
(spec §5.1, §5.3, §5.4, §5.6, §5.7, §5.8, §5.9)

### Detailed instructions

- `src/app/approvalRecordStore.ts`: factor the read/write pair to take the
  sidecar path and codecs; keep the existing plan exports byte-for-byte in
  behavior. Add `readSpecApprovalRecord(specPath)` (record | null),
  `putSpecApprovalRecord(specPath, record)` and
  `removeSpecApprovalRecord(specPath)` over `SPEC_APPROVALS_FILE_PATH` and the
  phase-01 codecs. A corrupt spec sidecar must not block a transition, matching
  the existing "does not block a transition when approvals.json is corrupt"
  behavior for plans.
- `src/domain/errors.ts`: add `SpecApprovalUnrecordedError { planPath, specPath }`
  ("… is Approved but its approval is unrecorded — re-approve the spec first")
  and `SpecEditedSinceApprovalError { planPath, specPath, baseline }` ("… is
  Approved but edited since its approval (<short baseline>) — re-approve the
  spec first"). Map both to exit 12 in `src/cli/commands/runLayers.ts`.
- `src/app/artifactStatus.ts`:
  - `transitionArtifact`, `kind === "spec" && target === "Approved"`: read HEAD,
    `stampApproved(updatedMd, nowIso, short)`, compute
    `artifactFingerprint(updatedMd)`, `putSpecApprovalRecord` with
    `{ specFingerprint, approvedAt: nowIso, baseline }`, set `approvedBaseline`
    so the CLI prints it. This branch also serves `Approved → Approved`.
  - Terminal branch: `removeSpecApprovalRecord` for specs, next to the plan
    removal.
  - Chain gate (plan approve with a declared spec): after the existing
    `status !== "Approved"` check, read the spec record; `null` →
    `SpecApprovalUnrecordedError`; fingerprint mismatch →
    `SpecEditedSinceApprovalError`. Only then read the spec fingerprint into
    `sourceSpec` as today.
  - `inspectArtifact`: extend `ArtifactReport` with
    `approval: { kind: "none" } | { kind: "unrecorded" } | { kind: "recorded"; date; baseline; editedSinceApproval }`
    for specs (`none` when status is not Approved and no stamp; read `date` and
    `baseline` from the frontmatter stamp, the verdict from
    `specApprovalVerdict`). Plans report `{ kind: "none" }` — their report is
    out of scope.
- Tests, written first, in `tests/integration/artifactStatus.test.ts` with the
  existing fake fs / fake git helpers:
  - spec approve stamps `approved` with the short HEAD and writes the record
    with the full HEAD, fingerprint and timestamp; body byte-identical.
  - re-approval on an Approved spec succeeds, replaces the record's baseline,
    and commits exactly the write-set (spec file + `docs/specs/approvals.json`).
  - spec terminal transition removes the record; the archived file keeps the
    stamp.
  - `inspectArtifact` on a stamped, unedited spec → recorded / not edited;
    after a body edit → edited; on an Approved spec without a record →
    unrecorded and `Approved` among legal targets.
  - chain gate: plan approve against an edited spec → `SpecEditedSinceApprovalError`,
    nothing written; against an unrecorded spec → `SpecApprovalUnrecordedError`;
    against a recorded, unedited spec → succeeds.
  - `tests/integration/planStaleness.test.ts`: approve a plan against spec S,
    re-approve S with no edit, `plans status` reports the plan fresh (§5.5).

### Planned files to create

- (none)

### Planned files to edit

- `src/app/approvalRecordStore.ts`
- `src/app/artifactStatus.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`

### Optional files that may be edited

- `src/infra/fakes/fs.ts`
- `tests/integration/completeRunArtifacts.test.ts`

### Boundary contracts

- Consumer: `transitionArtifact` and the chain gate. Producer: the spec record
  store. Contract: `readSpecApprovalRecord` returns `null` for a missing entry
  or a missing/corrupt file; put/remove are idempotent.
- Consumer: phase-03's CLI renderer. Producer: `inspectArtifact`. Contract:
  the `approval` variant above, and `approvedBaseline` present on a spec
  approve result exactly as on a plan approve result.

### Test strategy

Application layer with fake ports (integration tier), following the existing
`artifactStatus.test.ts` structure. Every listed case is written before the
source changes; the chain-gate cases and the fingerprint-neutral case are the
critical ones.

### Implementation order

1. Store front doors and errors (with the unit-level error message tests if
   the suite has a pattern for them; otherwise covered by the integration
   messages).
2. Transition branches (approve, terminal), then `inspectArtifact`.
3. Chain gate last, once approve produces records the gate can read.

### Excluded scope

- Rendering in `phax artifact status` / `approve` output — phase-03.
- Any change to plan staleness reasons or the `plans status` report.
- Backfilling records or stamps for existing Approved specs.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `ArtifactReport.approval` variant shape and the two error class
  names and messages, verbatim, for the CLI phase.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): record spec approvals and chain plan approval on them

### Commit body

Approving a spec now stamps `approved: { date, baseline }` and writes a record
to docs/specs/approvals.json; re-approval replaces both; terminal transitions
remove the record. `inspectArtifact` reports whether an Approved spec matches
its record or is unrecorded. Approving a plan against a spec that is edited
since approval or unrecorded is refused with exit 12 and a re-approve remedy.

---

## phase-03 — CLI rendering and documentation {#phase-03-cli-and-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

`phax artifact status` shows a spec's approval and verdict, `phax artifact
approve` prints the baseline for specs, and the usage spec, CLI reference,
README and skills describe the new key, transition and gate. (spec §5.7, §6)

### Detailed instructions

- `src/cli/commands/artifact.ts`, `runArtifactStatus`: after the `Status:`
  line, for a spec with `approval.kind === "recorded"` print
  `Approved:          <date> @ <baseline>` and `Edited since:      yes|no`;
  for `unrecorded` print
  `Approved:          (unrecorded — run phax artifact approve to record)`; for
  `none` print nothing. Keep the existing label column width. The approve
  path already prints `Baseline:` when `approvedBaseline` is set; no change
  needed beyond confirming it fires for specs.
- `src/cli/cliDocs.ts`: update `artifact approve` (legal from Draft for both
  kinds, from Stale for plans, and from Approved for both kinds as a
  re-approval that re-records; specs stamp `approved` and write
  `docs/specs/approvals.json`; plan approval refuses a spec edited since its
  approval or unrecorded, exit 12) and `artifact status` (reports a spec's
  approval date/baseline and whether it is edited since approval or
  unrecorded). Add an example `phax artifact status docs/specs/2609030749-spec-approval-ground.md`.
- Run `pnpm gen:usage-spec` then `pnpm docs:cli`; commit the regenerated
  `phax.usage.kdl`, `docs/cli/reference.md` and README generated section. Do
  not hand-edit them.
- `.claude/skills/phax-spec/SKILL.md`: in the Lifecycle section, note that
  `phax artifact approve` stamps `approved: { date, baseline }` and records the
  approval, that re-approving an Approved spec is the way to record an
  in-place revision (never prose in `date`), and add the optional `approved`
  mapping to the frontmatter block description ("written by phax, not by
  hand"). `.claude/skills/phax-cli/SKILL.md`: extend the `phax artifact approve`
  bullet with the re-approval and the chain-gate refusal.
- Tests, written first: extend the CLI-level test that covers `artifact status`
  output if one exists (look in `tests/integration/cliProgram.test.ts` and
  `tests/unit/cli/`); otherwise add `tests/unit/cli/artifactStatusRender.test.ts`
  exercising `runArtifactStatus` with a fake `OutputPort` and a stubbed
  `inspectArtifact` for the three variants. `usageSpecExamples`, the usage and
  docs drift gates cover the regenerated files.

### Planned files to create

- `tests/unit/cli/artifactStatusRender.test.ts`

### Planned files to edit

- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `.claude/skills/phax-spec/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`

### Optional files that may be edited

- `tests/integration/cliProgram.test.ts`
- `tests/integration/usageOutput.test.ts`

### Test strategy

CLI view layer: a unit test on the renderer with a fake output port (cheapest
pin on the three report variants). The regenerated docs are verified by the
existing drift gates.

### Implementation order

1. Renderer test, then `artifact.ts`.
2. `cliDocs` text, regenerate usage + docs, run `pnpm test:integration`.
3. Skill docs last.

### Excluded scope

- Re-approving the live specs and restoring their `date` keys (manual
  migration after the run, per spec §10).
- Any `phax plans status` change.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact `artifact status` lines for the three variants, so the migration
  can be walked by hand on specs 18, 19, 23, 24 and 30.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): show spec approval in artifact status and document re-approval

### Commit body

`phax artifact status` on a spec now prints its approval date and baseline
and whether it is edited since approval or unrecorded. The artifact approve
and status long help describe the spec stamp, the legal re-approval and the
plan-approval refusal; usage spec, CLI reference and README regenerated; the
phax-spec and phax-cli skills describe the `approved` key and the remedy for
in-place revisions.
