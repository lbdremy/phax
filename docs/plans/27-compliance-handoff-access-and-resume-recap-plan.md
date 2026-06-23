# Plan 27 — Compliance handoff access and resume recap follow-ups

This plan addresses the two attention points surfaced by plan-26's compliance
review:

1. **Compliance reviewer cannot read earlier-phase handoffs.** The compliance
   review agent runs jailed to the *final phase's* worktree
   (`reviewCompliance.ts` passes `cwd: info.worktreePath`, and
   `resolveReviewSecurityPolicy` only allows reading inside that worktree). The
   final phase's handoff happens to be readable because it lives in
   `<worktree>/.phax-context/phase-handoff.md`, but every earlier phase's
   handoff lives in `<runPath>/<phaseId>/phase-handoff.md` — outside the jail.
   The prompt asks the reviewer to judge the `handoff` dimension for *every*
   phase, so for all but the last phase the assessment silently degrades to
   "assessed from code only". Fix: inline each phase's handoff into the prompt
   (exactly as `plan.md` and the global reconciliation are already inlined),
   reading them in the application layer through the FileSystem port. This removes
   the dependency on the agent's FS jail entirely and is deterministic.

2. **`phax resume` of a review-open run prints a degraded recap.** The early
   `review_open` refusal branch in `resume.ts` renders
   `buildWhatsNext({ kind: "review_open", shortName })` with no `prUrl` and no
   `phaseCount`, so it shows the generic headline and suggests `phax publish-pr`
   even when a PR was already published. Both values are available from persisted
   artifacts the command already has a handle to (`info.runPath`): the PR URL from
   `publication.json` and the committed-phase count from `info.phaseStatuses`.
   Fix: populate the early-branch recap from those artifacts so it matches the
   recap `phax run` prints.

The two phases are independent and may be executed in either order; they are
ordered here core-to-surface (domain/app prompt change first, CLI surface
second).

## Required commands

- (none)

## phase-01 — Inline phase handoffs into the compliance review prompt {#phase-01-inline-handoffs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the compliance reviewer judge the `handoff` dimension from the actual
handoff text for every phase, not just the final one. The reviewer is jailed to
the final phase's worktree and cannot read earlier phases' `phase-handoff.md`
files (they live under `<runPath>/<phaseId>/`). Inline each phase's handoff into
the prompt — read in the application layer through the FileSystem port — so the
reviewer never depends on filesystem access for handoffs.

### Detailed instructions

- In `src/domain/review/compliancePrompt.ts`:
  - Extend `BuildCompliancePromptInput` with
    `phaseHandoffs: ReadonlyArray<{ phaseId: string; handoffMd: string }>`.
  - Add a new section to the assembled prompt — e.g. `## Phase handoffs` — that,
    for each entry, emits a labelled block: a `### Phase <phaseId> handoff`
    subheading followed by the `handoffMd` text verbatim. Place this section
    after the global reconciliation block and before `## Per-phase review
    instructions` so the reviewer reads the handoffs before judging.
  - Reword the `handoff` dimension line in `perPhaseInstructions` so it points the
    reviewer at the inlined handoff for that phase (e.g. "Does the inlined
    phase-handoff.md for this phase, shown above, cover the required handoff
    content?") rather than implying the reviewer must locate the file on disk.
  - Keep the function pure and deterministic: identical input must still yield an
    identical string (preserve the existing determinism guarantee).
- In `src/app/reviewCompliance.ts`:
  - After the plan and reconciliation are read, read each phase's handoff from
    `join(info.runPath, phaseId, "phase-handoff.md")` via the `FileSystem` port
    (`fs.readText`), iterating over `info.planPhases` in order so the handoffs
    line up with the per-phase instructions.
  - Use `Effect.either` per read and treat a missing/unreadable handoff as
    non-fatal: substitute a clear marker string (e.g.
    `> phase-handoff.md unavailable for <phaseId>`) as that phase's `handoffMd`.
    A missing handoff must not fail the (advisory) compliance step.
  - Pass the assembled `phaseHandoffs` array into `buildCompliancePrompt`.
- Do not widen the review security policy or the FS jail — the whole point is to
  stop relying on the agent's filesystem access for handoffs.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/review/compliancePrompt.ts`
- `src/app/reviewCompliance.ts`
- `tests/unit/review/compliancePrompt.test.ts`
- `tests/integration/reviewCompliance.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/app/reviewCompliance.ts` reads the persisted per-phase handoffs
through the `FileSystem` port and assembles a `phaseHandoffs` array. Consumer:
`buildCompliancePrompt` (pure domain) embeds them in the prompt string. Stable
shape: `phaseHandoffs` is an ordered array of `{ phaseId, handoffMd }`, one entry
per planned phase, with `handoffMd` either the file contents or an explicit
"unavailable" marker — never silently absent.

### Test strategy

- Unit tests (domain layer), written before implementation, in
  `tests/unit/review/compliancePrompt.test.ts`:
  - The prompt contains each supplied phase's `handoffMd` text.
  - The prompt contains a per-phase handoff heading for each supplied phase.
  - The `handoff` dimension instruction references the inlined handoff (not a
    disk path).
  - Determinism: same input still yields an identical string.
- Integration test (application layer) in
  `tests/integration/reviewCompliance.test.ts`: with phase handoff files written
  into the fake run folder, assert the prompt handed to the fake `Backend`
  contains each phase's handoff content; with a handoff file absent, assert the
  prompt contains the "unavailable" marker for that phase and the step still
  succeeds.

### Implementation order

Update the prompt input type and its unit tests first, then wire the handoff
reads in `reviewCompliance.ts`, then extend the integration test.

### Excluded scope

- Any change to the review security policy / FS jail
  (`resolveReviewSecurityPolicy`).
- Any change to the compliance review JSON schema, verdict enums, or dimension
  set.
- The aggregated `review-handoff.md` generation (`reviewHandoff.ts`) — it already
  inlines handoffs and is unaffected.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The new `BuildCompliancePromptInput.phaseHandoffs` field shape and the prompt
  section/heading titles used.
- That `reviewCompliance.ts` now reads `<runPath>/<phaseId>/phase-handoff.md` via
  the `FileSystem` port for each `info.planPhases` entry, with the non-fatal
  "unavailable" marker behavior on read failure.
- Confirmation that the review security policy was not changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(compliance): inline phase handoffs into the review prompt

### Commit body

The compliance reviewer runs jailed to the final phase worktree, so it could
read only that phase's handoff; earlier phases' phase-handoff.md files live under
the run folder, outside the jail, and the handoff dimension silently degraded to
"assessed from code only". Read every phase's handoff in the application layer
through the FileSystem port and inline it into the prompt, mirroring how plan.md
and the global reconciliation are already passed. Missing handoffs become an
explicit in-prompt marker and never fail the advisory step. Covered by domain
unit tests and an application integration test.

## phase-02 — Enrich the resume review-open recap from persisted artifacts {#phase-02-resume-recap}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Make `phax resume` of an already-review-open run print the same enriched recap as
`phax run`: a phase-count headline and the published PR URL when one exists. The
early `review_open` refusal branch in `resume.ts` currently renders the recap
with neither value, even though both are available from persisted artifacts the
command already references via `info.runPath`.

### Detailed instructions

- In `src/cli/commands/resume.ts`, in the early
  `if (refusal.reason === "review_open")` branch (currently rendering
  `buildWhatsNext({ kind: "review_open", shortName }, new Date())`):
  - Derive `phaseCount` from `info.phaseStatuses`: the count of phases whose
    state is neither `"failed"` nor `"skipped"` (the committed-phase count — the
    same definition `reviewHandoff.ts` uses for "passed"). Pass it as
    `phaseCount`.
  - Read `publication.json` from `join(info.runPath, "publication.json")` and
    decode it with `decodePublication` from `src/schemas/publication.ts`; when the
    decoded record has a `pullRequestUrl`, pass it as `prUrl`. Treat a missing
    file, read error, or decode failure as "no PR URL" — leave `prUrl` undefined
    and still render the recap. Match the file's existing local pattern for
    reading run artifacts (the synchronous `readFileSync` + schema-decode used for
    `run-status.json` in the same file); do not introduce a new port.
  - Pass `prUrl` and `phaseCount` into the existing
    `buildWhatsNext({ kind: "review_open", shortName, prUrl, phaseCount }, ...)`
    call for this branch.
- Leave the terminal success branch unchanged — it already passes `prUrl` and
  `phaseCount` from the `executePlan` result.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/resume.ts`
- `tests/unit/resume.test.ts`

### Optional files that may be edited

- `tests/integration/resume.test.ts`

### Boundary contracts

Consumer: the resume CLI command renders via `OutputPort` and the
`review_open` scenario of `buildWhatsNext` (already extended in plan-26 with
optional `prUrl`/`phaseCount`). It reads the published PR URL through the existing
`decodePublication` schema. No new ports and no new domain shape.

### Test strategy

CLI unit tests in `tests/unit/resume.test.ts`, exercising the early
`review_open` refusal branch with a temporary run folder:

- With a `publication.json` carrying a `pullRequestUrl`, the rendered recap shows
  the URL and "View the pull request" and omits `phax publish-pr`.
- With no `publication.json` (or one without a URL), the recap shows the
  `phax publish-pr` command.
- The headline reflects the committed-phase count derived from
  `info.phaseStatuses`.

If the unit harness cannot supply a run folder with a `publication.json` for this
branch, cover the same cases in `tests/integration/resume.test.ts` instead.

### Implementation order

Add/extend the failing recap tests for the early branch, then wire the
`phaseCount` derivation and `publication.json` read.

### Excluded scope

- The terminal success branch (already enriched in plan-26).
- Other refusal reasons (`limit`, `gates_exhausted`, `phase_no_changes`, etc.).
- Any change to `buildWhatsNext` / the `whatsNext` domain.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- That the early `review_open` branch now derives `phaseCount` from
  `info.phaseStatuses` and reads `prUrl` from `publication.json` via
  `decodePublication`, with read/decode failure treated as "no PR URL".
- Which test file ended up covering the branch (unit vs integration) and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(resume): enrich review-open recap with PR URL and phase count

### Commit body

When phax resume is run against an already-review-open run, the early refusal
branch rendered the recap with no PR URL and no phase count, suggesting
publish-pr even when a PR was already published. Populate the recap from
persisted artifacts the command already references: the committed-phase count
from the phase statuses and the PR URL from publication.json (non-fatal when
absent). The resume recap now matches what phax run prints. Covered by CLI tests.
