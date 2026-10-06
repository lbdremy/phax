---
status: Approved
source-spec: docs/specs/2610060955-completes-spec.md
approved:
  date: 2026-10-06
  baseline: 539f9f9
---
# A plan says whether its run completes its source spec

This plan implements the Approved spec `completes-spec` (`docs/specs/2610060955-completes-spec.md`). A plan that names a source spec gains a required frontmatter key, `completes-spec: true|false`. A run completes the spec only when that key is `true`, and the chain gate still applies on top. A plan whose key is `false` leaves its spec untouched, and both the run output and the review handoff (and so the PR body) say so. `phax artifact new plan --spec` requires exactly one of `--last` or `--not-last`. The headless plan document mirrors the value as `completesSpec`. All six §9 questions were decided by the author on 2026-10-05 and 2026-10-06. This plan implements those decisions and does not reopen them.

This is the spec's only plan, so it completes the spec. The run is driven by the installed phax 0.19.0, which knows nothing of `completes-spec`. At run end it completes this plan and its spec as it does today, which is correct here. For the same reason this plan file itself must never gain the `completes-spec` key: 0.19.0 refuses unknown frontmatter keys and would fail the run's completion.

The plan has five phases, built inside-out, each green on its own, with tests in the same phase as the code they test:
1. the frontmatter key and its validation;
2. run completion and its reporting;
3. the creation flags;
4. the plan document mirror, recorded in the schemas package's format history;
5. docs and the hand migration of live plans.

The layers hold (`cli → app → domain ← ports ← infra`). The domain stays pure, every file write goes through the FileSystem port, and CLI command files only parse flags, call one use case and render. Every test plan and spec is made up; no test reads this repository's own docs/specs or docs/plans. There is no change to the chain gate's rule, to `phax artifact complete`, to plan completion, or to `phax-plan.json`.

Phase 5 edits `.claude/skills/phax-planning/SKILL.md`, so start this run with `phax run --allow-skill-edits`.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm exec tsx`

These are already allowed in `security.agentCommands` in `phax.json`, so `phax.json` needs no change:
- `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated CLI block (phase 3).
- `pnpm exec tsx` runs `scripts/schemas-check.ts --write`, which records the plan-document shape change (phase 4).

## Technical arbitrations

- Phase split: the brief grouped the plan document mirror with the frontmatter key in phase 1. Here it gets its own phase (phase 4), after the creation flags (phase 3), because the mirror's value comes only from the flags. Grouping them would have needed a temporary default for `completesSpec`, which is the defect this spec removes. Loss accepted: the brief's four-phase shape. Also, between phase 1 and phase 3, `phax artifact new plan --spec` writes a skeleton that validation refuses. That is acceptable because the run merges as one PR and that state never ships.
- How the spec outcome reaches the review handoff: run completion writes a Markdown fragment, `source-spec-outcome.md`, into the run folder (the `compliance-review.md` precedent). Every handoff build reads it: the first generation, `phax review-handoff` regeneration and `phax publish-pr`. Rejected: a new schema-versioned JSON format, which needs a format id, snapshots and site URLs, and re-deriving the outcome from the worktree at handoff time, which breaks once the worktree is gone. Loss accepted: no structured, versioned record of the outcome; consumers read prose.
- The `--last`/`--not-last` pairing rule is a pure domain function. The shared `resolveArtifactTarget` applies it, so the interactive and headless paths refuse the same way with ArtifactCreationError (exit 12) before anything is written. Loss accepted: commander's built-in option conflicts, which would exit 1, not 12.
- Plan sidecars written before the key: phax's own reader decodes a `$schema` sidecar with the current decoder only, so a 0.17.0–0.19.x plan sidecar reads as invalid. The 0.19.0 sidecar of the live plan own-approval-ground is one of them. Its pre-schema step yields `completesSpec: null` beside `sourceSpec: null` and refuses a sidecar beside a spec path. The schemas package reads the 0.17.0 shape through a frozen module and upgrades it with null (spec-less) or Unknown, never an invented boolean. Loss accepted: re-approving an older headless plan now needs a re-authored or deleted sidecar (no-shims rule, spec §7). Completing it still carries its sidecar along, because only approval requires an in-sync sidecar.

---

## phase-01 — Plan frontmatter carries completes-spec beside a source spec {#phase-01-frontmatter-key}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Artifact validation accepts a plan's frontmatter only in its two legal forms: `source-spec: null` with no `completes-spec`, or a spec path with a boolean `completes-spec`. It refuses anything else with exit 12, naming `completes-spec`. The lineage reader exposes the value for run completion. Changing the value on an Approved plan makes it `self-changed`.

### Detailed instructions

- In `src/schemas/artifactFrontmatter.ts`, make `PlanFrontmatterSchema` per-variant, one legal form each:
  - spec-less: `{ status, "source-spec": null, approved? }`;
  - with a spec: `{ status, "source-spec": NonEmptyString, "completes-spec": Boolean, approved? }`.
  Keep `decodePlanFrontmatter` decoding with `onExcessProperty: "error"`, so a `completes-spec` beside `source-spec: null` is refused. `PlanFrontmatter` becomes the union type. Leave `SpecFrontmatterSchema` untouched.
- The schema-failure detail must name `completes-spec` in all three refusals:
  - missing beside a spec path;
  - a non-boolean value such as `"yes"` or `yes`;
  - present beside `source-spec: null`, saying it is inconsistent with `source-spec: null`.
  If the raw union parse error does not name the key clearly, add a targeted check in the schema (annotations or a refinement) or in `decodeArtifactFrontmatter` (`src/domain/artifact/frontmatter.ts`). It must stay pure, and the result must still be a `FrontmatterProblem` of kind `schema`.
- In `src/domain/artifact/document.ts`, change `ALLOWED_KEYS.plan` to `status, source-spec, completes-spec (required with a source spec, absent without), approved`. Exit code 12 already applies through `ArtifactValidationError`; do not add a new error type.
- In `src/domain/artifact/lineage.ts`, the `spec` variant of `SourceSpecDeclaration` gains `readonly completesSpec: boolean`. `readSourceSpec` reads it from the decoded frontmatter, narrowing on the union instead of the current cast. The `none` variant stays as it is. Existing callers (`findDependentPlans`/the chain gate in `src/app/artifactStatus.ts`, `src/app/planStaleness.ts`) only use `path` and keep their behaviour; adjust them only if the type change requires it.
- Leave `fingerprintSource` as it is: it still drops only `status` and `approved`, so `completes-spec` is fingerprinted. Lock this in with tests: the fingerprint changes when the value flips, and `computeStalenessForPlan` (or the integration path `phax plans status` uses) reports `self-changed` for an Approved plan whose value flipped from `false` to `true`.
- Sweep test fixtures. Every helper that writes a plan frontmatter with a spec path (the `planMd`/`plan` helpers in the listed integration tests, and the fixtures in `frontmatter.test.ts`, `document.test.ts`, `lineage.test.ts`) must emit `completes-spec: true` right after `source-spec` when the path is non-null, and nothing when it is null. Use `true` so completion behaviour stays exactly as today. Phase 2 adds the `false` cases.
- Do not change plan creation (`planSkeleton`, `createArtifact`, `authorArtifact`): phase 3 owns it. Between this phase and phase 3, `phax artifact new plan --spec` writes a skeleton that validation refuses. That is expected; record it in the handoff.
- Do not change run completion (`src/app/completeRunArtifacts.ts`): phase 2 owns it.
- Do not touch any file under the repository's own docs/plans or docs/specs, including this plan file, which must not gain the key.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/artifactFrontmatter.ts`
- `src/domain/artifact/document.ts`
- `src/domain/artifact/lineage.ts`
- `tests/unit/artifact/frontmatter.test.ts`
- `tests/unit/artifact/document.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/planStaleness.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/migrateApprovals.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/approvalLedgerRefusal.test.ts`

### Optional files that may be edited

- `src/domain/artifact/frontmatter.ts`
- `src/app/artifactStatus.ts`
- `src/app/planStaleness.ts`
- `src/app/lintPlan.ts`
- `src/domain/plan/lint.ts`
- `tests/integration/cliErrors.test.ts`
- `tests/unit/renderPlan.test.ts`

### Boundary contracts

Producer: `src/schemas/artifactFrontmatter.ts`, the decoder of the plan frontmatter. Consumers: `validateArtifact` (artifact validation, behind every command's exit 12) and `readSourceSpec` (lineage), and through them `transitionArtifact`, `checkPlanRunnable`, `lintPlan` and the staleness check. Contract: a decoded plan frontmatter is either spec-less with no completes-spec, or names a spec with a boolean completes-spec; anything else is a FrontmatterProblem of kind schema whose detail names completes-spec. `readSourceSpec(md)` returns `{ kind: "none" }` or `{ kind: "spec", path, completesSpec }`, and null only for frontmatter that validation already refuses. Phase 2 consumes `completesSpec` from this declaration.

### Test strategy

Write the domain and schema tests first: they pin the contract every later phase relies on.

Unit tests:
- `tests/unit/artifact/frontmatter.test.ts`: decode accepts both legal forms. It refuses a missing key beside a path, a non-boolean value, and the key beside null, each with a detail containing `completes-spec`. The fingerprint differs when the value flips.
- `tests/unit/artifact/document.test.ts`: `validateArtifact` refuses the three cases, with the message naming `completes-spec` and the new allowed-keys list. It accepts `true`, `false`, and a spec-less plan without the key.
- `tests/unit/artifact/lineage.test.ts`: `readSourceSpec` returns `completesSpec` true and false.

Integration tests with fake ports:
- `tests/integration/lintPlan.test.ts`: `plans lint` on a made-up docs/plans plan with a spec and no key fails with ArtifactValidationError (exit 12) naming `completes-spec`. A value of `"yes"` fails the same way. A spec-less plan carrying `completes-spec: false` fails. Plans with `true` or with `false` lint without a validation refusal.
- `tests/integration/artifactStatus.test.ts`: approving a plan that lacks the key fails naming `completes-spec` and writes nothing: no frontmatter change, no record file, no commit.
- `tests/integration/planStaleness.test.ts`: flipping the value on an Approved, fresh plan reports `self-changed`.

The other listed integration tests change only their fixtures.

### Implementation order

1. Schema variants and the targeted refusal detail in `src/schemas/artifactFrontmatter.ts` (and `frontmatter.ts` if needed), with their unit tests.
2. `ALLOWED_KEYS` in `document.ts` and the `validateArtifact` unit tests.
3. The `completesSpec` field in `SourceSpecDeclaration` and `readSourceSpec`, with the lineage tests.
4. Fingerprint and staleness tests.
5. The fixture sweep across the integration tests, then the lint and approve refusal tests.

### Excluded scope

- Plan creation (`planSkeleton`, `createArtifact`, `authorArtifact`, CLI flags): phase 3.
- Run completion honouring the key, run output, review handoff and PR body: phase 2.
- The plan document (`completesSpec` in the sidecar) and the schemas package: phase 4.
- Docs, skill text and the hand migration of live plans: phase 5.
- Any change to the chain gate's rule, `phax artifact complete`, plan completion or `phax-plan.json`.
- Cross-plan lint advisories (spec §9 Q5: none).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The final shape of `PlanFrontmatterSchema` and the exported `PlanFrontmatter` type, from `src/schemas/artifactFrontmatter.ts`.
- The new `SourceSpecDeclaration` from `src/domain/artifact/lineage.ts`: `{ kind: "spec"; path; completesSpec: boolean } | { kind: "none" }`.
- How the refusal detail names `completes-spec` in each of the three cases, and where that wording lives.
- That `artifact new plan --spec` temporarily writes a skeleton validation refuses, until phase 3.
- Which fixture helpers gained `completes-spec: true`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(artifact): require completes-spec beside a plan's source spec`

### Commit body

A plan whose source-spec names a spec must now carry completes-spec: true or false.
The key is refused beside source-spec: null. Each variant has exactly one legal form,
and every command that validates a plan (plans lint, approve, run, the loose-plan
runnable check) refuses a violation with exit 12, naming completes-spec.

readSourceSpec returns the value with the declared spec path. The key stays
fingerprinted (fingerprintSource still drops only status and approved), so flipping it
on an Approved plan reports self-changed. Test fixtures that declare a source spec now
carry the key.

---

## phase-02 — Run completion honours completes-spec and reports the spec outcome {#phase-02-run-completion}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A run whose plan says `completes-spec: false` leaves the source spec live and untouched on the run branch. A run whose plan says `true` keeps today's ride-along, chain gate included. The run output and the review handoff, and so the PR body, state the spec outcome: completed, kept because live plans block it, or kept because the plan does not complete it.

### Detailed instructions

- In `src/app/completeRunArtifacts.ts`, replace `RunCompletionSkippedSpec` and `skippedSpec` with `keptSpec?: RunCompletionKeptSpec`, a union of named variants:
  - `{ reason: "blocked"; path; blockedBy: readonly { path; status }[] }`;
  - `{ reason: "not-completing"; path }`.
  The completed outcome stays a `kind: "spec"` entry of `transitions`, as today.
- In `completeInWorktree`, after the plan transition (or the idempotent re-entry read from the archive path), call `readSourceSpec(planMd)`. If the declaration is a spec with `completesSpec === false`, return `{ transitions, keptSpec: { reason: "not-completing", path: declaration.path } }` at once. Do not resolve, read, validate or transition the spec. If `completesSpec` is `true`, keep today's code path unchanged, mapping `SpecRetirementBlockedError` to `keptSpec: { reason: "blocked", ... }`. The chain gate rule and `transitionArtifact` are not touched.
- Add a pure renderer for the handoff section, exported from `src/app/completeRunArtifacts.ts`: `renderSourceSpecOutcome(report): string | undefined`. Return undefined when the report has neither a spec transition nor a `keptSpec`. Indicative wording, one line each:
  - completed: `<archive path> — completed on this branch (<short hash>)`, or `— already complete` on re-entry;
  - blocked: `<path> — kept: live plans remain (<plan path>, <status>; ...)`;
  - not-completing: `<path> — kept: this plan does not complete it (completes-spec: false)`.
  Export the fragment filename constant `SOURCE_SPEC_OUTCOME_FILENAME = "source-spec-outcome.md"`.
- In `src/app/executePlan.ts`, after `completeRunArtifacts` succeeds and before the `FinalReviewOpened` dispatch, write the rendered outcome to `join(infoResult.right.runPath, SOURCE_SPEC_OUTCOME_FILENAME)` through the FileSystem port (`writeAtomic`), when the renderer returns a value. A resume that re-enters completion rewrites it identically. Do not write the file for a loose plan or a spec-less plan.
- In `src/app/reviewHandoff.ts`, `buildReviewHandoffContent` gains an optional source-spec outcome. When it is present, render a `## Source spec` section right after `## Run summary`, holding the outcome text; when it is absent, render no section. `generateReviewHandoff` reads the fragment from `info.runPath` when it exists, so the first generation and `phax review-handoff` regeneration both include it. You may centralise the read in `src/app/loadReviewHandoffInputs.ts`.
- In `src/app/publishRun.ts`, read the same fragment (or take it from `loadReviewHandoffInputs`) and pass it to `buildReviewHandoffContent`. `src/domain/publish/body.ts` wraps the handoff unchanged, so the PR body carries the section with no change there.
- In `src/cli/commands/run.ts`, `renderArtifactCompletions` keeps the blocked rendering (the kept line plus one indented line per blocker). It adds `○ spec <path> kept: this plan does not complete it (completes-spec: false)` for `not-completing`. `src/cli/commands/resume.ts` reuses the function; touch it only if the type change requires it.
- Update every reader of `skippedSpec` to `keptSpec`, including tests.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/completeRunArtifacts.ts`
- `src/app/executePlan.ts`
- `src/app/reviewHandoff.ts`
- `src/app/publishRun.ts`
- `src/cli/commands/run.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/integration/publishRun.test.ts`

### Optional files that may be edited

- `src/app/loadReviewHandoffInputs.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/reviewHandoff.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/migrateApprovals.test.ts`
- `tests/integration/approvalLedgerRefusal.test.ts`

### Boundary contracts

Producer: `completeRunArtifacts` (app). Consumers: the CLI renderer `renderArtifactCompletions` (run and resume), `executePlan` (which persists the outcome), and the review handoff builders.
- `RunCompletionReport = { transitions; keptSpec?: { reason: "blocked"; path; blockedBy } | { reason: "not-completing"; path } }`.
- The run folder file `source-spec-outcome.md` is the only bridge from completion to every later handoff build (generate, regenerate, publish). Its absence means the plan has no spec outcome to state.
- `buildReviewHandoffContent` takes the outcome text as an optional input and owns the `## Source spec` heading.

### Test strategy

Write the `completeRunArtifacts` integration tests first; they encode spec §5.4–§5.5.

Integration tests with fake ports, in `tests/integration/completeRunArtifacts.test.ts`, on a made-up Approved spec with an approval record file:
- its only live plan with `completes-spec: false`: the report has the plan transition only and `keptSpec.reason === "not-completing"`. Exactly one commit (the plan's) is made. The spec still reads Approved under docs/specs/, and its record under docs/specs/approvals/ still exists.
- with `true`, gate clear: both completions, as today.
- with `true` and a second live Approved plan naming the spec: `keptSpec.reason === "blocked"`, naming that plan.
- idempotent re-entry with `false`.

In `tests/integration/runCarriesCompletion.test.ts`, an executePlan run with `completes-spec: false` leaves the run branch with only the plan completion. `source-spec-outcome.md` exists in the run folder, and `review-handoff.md` contains the `## Source spec` section with the kept wording. The `true` run's handoff states the completed outcome.

Unit tests:
- `tests/unit/cli/run.test.ts`: the kept line for not-completing, and the blocked lines unchanged.
- `tests/unit/reviewHandoffContent.test.ts`: each of the three outcomes renders under `## Source spec`, and no section appears when the outcome is absent.

`tests/integration/publishRun.test.ts`: with the fragment in the run folder, the PR body contains the outcome. Without it, there is no `## Source spec` section.

### Implementation order

1. `RunCompletionKeptSpec` and the `completes-spec: false` branch in `completeRunArtifacts`, with integration tests.
2. `renderSourceSpecOutcome` and the filename constant.
3. The review handoff section and the fragment reading in `generateReviewHandoff`/`publishRun`, with unit and publish tests.
4. Persisting the fragment in `executePlan`, with the `runCarriesCompletion` test.
5. The CLI kept line in `renderArtifactCompletions`, with the run unit test.

### Excluded scope

- Creating plans with the key (`--last`/`--not-last`): phase 3.
- The plan document `completesSpec`: phase 4.
- Any change to the chain gate rule, `transitionArtifact`, `phax artifact complete` or plan completion.
- A spec outcome for a spec in Draft or Abandoned at run end: the existing silent path is unchanged.
- README and skill text: phase 5.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The final `RunCompletionReport` / `RunCompletionKeptSpec` types and the exported `renderSourceSpecOutcome` and `SOURCE_SPEC_OUTCOME_FILENAME` (module `src/app/completeRunArtifacts.ts`).
- Where in `executePlan` the fragment is written.
- How `buildReviewHandoffContent`'s signature changed, and where the fragment is read for generation, regeneration and publish.
- The exact CLI kept-line wording.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(run): complete the source spec only when the plan says it is the last`

### Commit body

Run completion now reads completes-spec from the pre-transition plan. With true it
rides the source spec along exactly as before, chain gate included. With false it
makes no spec transition and no spec commit, and leaves the spec's status, location
and approval record file untouched.

The completion report replaces skippedSpec with a keptSpec carrying named variants:
blocked by live plans (with the blockers), or not completed by this plan. phax run
and phax resume print a kept line for each. Run completion writes the spec outcome to
source-spec-outcome.md in the run folder; the review handoff renders it as a Source
spec section, so the PR body states it too.

---

## phase-03 — artifact new plan requires --last or --not-last with --spec {#phase-03-creation-flags}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

`phax artifact new plan` makes the author state whether the plan completes its spec. With `--spec`, exactly one of `--last` / `--not-last` is required, and the frontmatter reads `completes-spec: true|false` after `source-spec`. A missing, doubled or meaningless flag refuses with exit 12 before anything is written, in both the interactive and the headless path.

### Detailed instructions

- In `src/domain/artifact/lineage.ts`, add a pure function, for example `resolveCompletesSpec({ hasSourceSpec, last, notLast }): Either<boolean | null, string>`:
  - spec with exactly one flag → `true` (`--last`) or `false` (`--not-last`);
  - spec with neither flag → Left `--spec needs --last (this plan is the spec's last) or --not-last (more plans follow)`;
  - spec with both flags → Left naming them as opposites, pass exactly one;
  - no spec with a flag → Left `--last needs --spec: a plan without a source spec completes none` (name the flag actually given);
  - no spec and no flag → Right null.
  The wording is indicative.
- In `src/app/createArtifact.ts`:
  - `ArtifactTargetInput` (and through it `CreateArtifactInput`) gains `completion: { readonly last: boolean; readonly notLast: boolean }`.
  - `resolveArtifactTarget` applies `resolveCompletesSpec` for a plan before any filesystem read, failing with `ArtifactCreationError`, which already maps to exit 12. A spec ignores the flags; the CLI never offers them on `new spec`.
  - `ArtifactTarget` gains `completesSpec: boolean | null`.
  - `planSkeleton` takes the lineage (path + boolean, or none) and writes `completes-spec: <bool>` on the line right after `source-spec` only when a spec is bound.
  - `CreateArtifactResult` gains `completesSpec`.
- In `src/app/authorArtifact.ts`, `AuthorArtifactInput` gains the same `completion` field, which it passes to `resolveArtifactTarget`, so a bad flag pair refuses before the session spawns and records nothing. `renderArtifact` renders the frontmatter through `planSkeleton` with the target's source spec and `completesSpec`. Do not change the plan document here: the sidecar gains `completesSpec` in phase 4.
- In `src/cli/commands/artifact.ts`, register `--last` and `--not-last` on `artifact new plan` only, with short descriptions (`this plan is its spec's last: its run completes the spec`, `more plans of the spec follow: its run leaves the spec live`). Pass both booleans to `runCreateArtifact` and `runCreateArtifactHeadless`. The interactive confirmation becomes `created <path> (Draft, source-spec <spec>, completes-spec <true|false>)` with a spec, and stays `created <path> (Draft, source-spec null)` without one. Check that `exitCodeForAuthoringError` maps `ArtifactCreationError` to 12 on the headless path, and fix `runLayers.ts` only if it does not.
- In `src/cli/cliDocs.ts`:
  - Update the `artifact new` parent long help: the refusals now include a `--spec` without exactly one of `--last`/`--not-last`, or either flag without `--spec`, all exit 12 before anything is written.
  - Update the `artifact new plan` long help: the skeleton is status, source-spec, and completes-spec when a spec is bound. Explain both flags and the rule that every plan of a spec except the last says `--not-last`.
  - Update the examples: `--spec ... --not-last`, `--spec ... --last`, the spec-less example unchanged, and the headless example with `--last`.
- Regenerate with `pnpm gen:usage-spec`, then `pnpm docs:cli`. Commit the regenerated `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated CLI block. Do not hand-edit README prose in this phase; phase 5 updates the README examples and the lifecycle text.
- Do not touch the repository's own docs/plans or docs/specs.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/lineage.ts`
- `src/app/createArtifact.ts`
- `src/app/authorArtifact.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/createArtifact.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `src/cli/program.ts`
- `tests/integration/usageOutput.test.ts`
- `tests/integration/cliErrors.test.ts`

### Boundary contracts

CLI → app: the CLI passes the raw flag booleans as `completion: { last, notLast }` together with the `--spec` path, and does no pairing logic itself. App → domain: `resolveArtifactTarget` asks `resolveCompletesSpec` for `boolean | null` or a refusal message, and returns `completesSpec` on `ArtifactTarget`. App → file: `planSkeleton` emits `completes-spec` exactly when a spec is bound, in the form phase 1's validation accepts. Phase 4 consumes `ArtifactTarget.completesSpec` to set the plan document's `completesSpec`.

### Test strategy

Write the domain function's unit tests first in `tests/unit/artifact/lineage.test.ts`: all six flag/spec combinations.

Integration tests:
- `tests/integration/createArtifact.test.ts`:
  - with a made-up spec, `--not-last` writes `completes-spec: false` on the line after `source-spec`, and `--last` writes `true`;
  - the created plan passes `validateArtifact`;
  - neither flag, both flags, and `--last` without `--spec` each fail with ArtifactCreationError, with no file written;
  - the spec-less plan has no key.
- `tests/integration/authorArtifact.test.ts`: the headless-rendered frontmatter carries the flag value, and a bad flag pair refuses before the stubbed backend is called, with nothing written.

CLI tests:
- `tests/unit/cli/artifact.test.ts`: the confirmation line names the value, and exit 12 for each refusal.
- `tests/integration/artifactNewHeadlessCommand.test.ts`: exit 12 before the session for a bad pair.

The existing usage-spec and docs drift tests verify the regenerated files.

### Implementation order

1. `resolveCompletesSpec` and its unit tests.
2. `createArtifact.ts`: input, target, skeleton and result, with integration tests.
3. `authorArtifact.ts` input and frontmatter rendering, with integration tests.
4. CLI flags, confirmation line and exit codes, with CLI tests.
5. `cliDocs.ts`, then `pnpm gen:usage-spec` and `pnpm docs:cli`.

### Excluded scope

- The plan document `completesSpec`, the authoring prompt and the schemas package: phase 4.
- README prose, the phax-planning skill and NEXT_STEPS: phase 5.
- Any default when the flags are missing: none is ever inferred (spec §9 Q4).
- Flags on `artifact new spec`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The signature and messages of the domain flag function.
- The new `completion` input field on `ArtifactTargetInput`/`CreateArtifactInput`/`AuthorArtifactInput`.
- `ArtifactTarget.completesSpec` and the `planSkeleton` signature; phase 4 relies on these.
- The exact flag names and confirmation line.
- Confirmation that `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated block were regenerated, not hand-edited.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(cli): require --last or --not-last with artifact new plan --spec`

### Commit body

phax artifact new plan --spec now needs exactly one of --last (this plan is the spec's
last) or --not-last (more plans follow). It writes completes-spec: true or false right
after source-spec. Neither or both flags with --spec, or either flag without --spec,
refuse with exit 12 before anything is written, in interactive and headless mode alike.
The pairing rule is a pure domain function applied in the shared resolveArtifactTarget.

The headless path renders the same frontmatter from the flags. The confirmation line
names the value. phax.usage.kdl, docs/cli/reference.md and the README's generated CLI
block are regenerated.

---

## phase-04 — The plan document mirrors completesSpec {#phase-04-plan-document}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

The headless plan document carries `completesSpec` per variant, set from the CLI flags. The rendered frontmatter and the committed sidecar always agree. `phax artifact schema plan` lists the field as required. The schemas package records the shape change in its format history, so external readers can still read sidecars written by earlier releases.

### Detailed instructions

- Freeze today's shape first, before changing anything. Create `src/schemas/history/plan-document/0.17.0.ts` with a self-contained copy of today's `PlanDocumentFileSchema` and its decoder (`onExcessProperty: "error"`), in the style of `src/schemas/history/plan-document/pre-schema.ts`. It must not import live schemas that may change later; copy the field schemas it needs. In `packages/schemas/src/formats/repository.ts`, add `["0.17.0", { schema, decode }]` to `planDocumentFormat.releases`, and add `"0.17.0"` to `PlanDocumentShapes`. Never edit `packages/schemas/snapshots/plan-document/0.17.0.schema.json` or `pre-schema.schema.json`.
- In `src/schemas/planDocument.ts`, add a required `completesSpec` next to `sourceSpec` in `planDocumentFields`: a boolean beside a non-null `sourceSpec`, null beside `sourceSpec: null`. Refuse a missing field and both cross pairs. Choose the encoding (a refinement over the struct, or a union of two variants) so that:
  - `decodePlanDocument` and `decodePlanDocumentFile` keep refusing excess keys;
  - `getPlanDocumentJsonSchema()` still builds;
  - the printed schema lists `completesSpec` as required.
  `projectExtractedPlan` is unchanged: no lineage in `phax-plan.json`.
- In `packages/schemas/src/formats/repository.ts`, `toLatestPlanDocument` accepts the pre-schema, 0.17.0 and current values. For the older shapes it sets `completesSpec` to null when `sourceSpec` is null; the variant allows nothing else. Beside a spec path it sets `UNKNOWN`, from `packages/schemas/src/shapes.ts`. Never invent a boolean. Widen `LatestPlanDocument` accordingly.
- In `src/schemas/persisted.ts`, update `readPlanDocumentFile`:
  - `fromPreSchema` yields `completesSpec: null` beside `sourceSpec: null`, and returns `Left({ fact: "completesSpec" })` beside a spec path, which gives the existing `lacks completesSpec, which phax needs — not supported` refusal;
  - `$schema` sidecars keep being decoded by the current decoder only, so a sidecar from 0.17.0–0.19.x without the field is refused, as the technical arbitration records.
  Update the function's comment.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/plan-document/next.schema.json`, regenerates `packages/schemas/src/generated/index.ts` (CURRENT_SHAPES `plan-document` → `next`) and adds the 0.17.0 module's entry to `packages/schemas/history.lock.json`. Then run `pnpm exec tsx scripts/schemas-check.ts`; it must report nothing. Never rewrite an existing lock entry.
- In `src/app/authorArtifact.ts`, `runAuthoringSession` overrides both `sourceSpec` and `completesSpec` on the session's plan document with the target's values (`target.sourceSpec?.path ?? null`, `target.completesSpec` from phase 3), whatever the session returned. The sidecar, the document.json in the session folder and the rendered frontmatter then agree.
- In `src/domain/authoring/prompt.ts`, the prompt input gains `completesSpec: boolean | null`. For a plan with a spec, add a bullet `Set \`completesSpec\` to \`true\`` (or `false`) beside the `sourceSpec` bullet. For a spec-less plan, add `Set \`completesSpec\` to null: this plan has no source spec.` Pass the value from `authorArtifact`.
- Update fixtures and package tests:
  - Add `completesSpec` to every current-shape plan document fixture (`tests/unit/planDocument.test.ts`, `tests/unit/renderPlan.test.ts`, `tests/unit/artifact/sidecar.test.ts`, `tests/integration/authorArtifact.test.ts`, `tests/unit/schemasPackage/documents.ts`).
  - `tests/type/schemasPackage.ts` gains the `0.17.0` shape in its exact `Equals` checks.
  - Keep the bridge-parity tests in `tests/unit/schemasPackage/currentShapes.test.ts` meaningful. For example, use a spec-less pre-schema fixture on which phax and the package agree on `completesSpec: null`, plus a dedicated test that a pre-schema sidecar beside a spec path is refused by phax's reader and upgrades to Unknown in the package.
  - Add a package test that a `$schema` 0.17.0 document parses as shape `0.17.0` through the frozen module.
- Do not touch the repository's own sidecars under docs/plans (live or archived); the arbitration accepts that older sidecars read as invalid.

### Planned files to create

- `src/schemas/history/plan-document/0.17.0.ts`
- `packages/schemas/snapshots/plan-document/next.schema.json`

### Planned files to edit

- `src/schemas/planDocument.ts`
- `src/schemas/persisted.ts`
- `src/app/authorArtifact.ts`
- `src/domain/authoring/prompt.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/planDocument.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `packages/schemas/src/index.ts`
- `packages/schemas/README.md`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `README.md`

### Boundary contracts

Producer: `src/schemas/planDocument.ts`, the authoring contract and sidecar file schema. Consumers: the headless authoring session (through the JSON Schema in its prompt), `authorArtifact` (decode, override, encode), phax's sidecar reader `readPlanDocumentFile` (the sidecar agreement check), and external readers through `@phax/schemas`, where `parsePlanDocument` and `toLatestPlanDocument` define a stable upgrade path. Contract: `completesSpec` is a boolean beside a spec path and null beside no spec. Older shapes upgrade to null or Unknown, never to an invented boolean.

### Test strategy

Write the schema tests first.

Unit tests:
- `tests/unit/planDocument.test.ts`: decode refuses a missing `completesSpec`, `sourceSpec: null` with `completesSpec: true`, and a spec path with `completesSpec: null`. It accepts both legal pairs. `getPlanDocumentJsonSchema()` lists `completesSpec` in `required`.
- `tests/unit/authoringPrompt.test.ts`: the prompt states `true`, `false`, or null for a spec-less plan.
- Schemas package tests (`documents.ts` fixtures, `currentShapes`, `frozenHistory`, `snapshots`): the frozen 0.17.0 module reads today's shape, `toLatestPlanDocument` upgrades as specified, and the snapshot check is clean.
- `tests/unit/persisted.test.ts`: phax's reader steps a spec-less pre-schema sidecar to null, refuses one beside a spec path, and refuses a `$schema` sidecar that lacks the field.

Integration tests with a stubbed backend, in `tests/integration/authorArtifact.test.ts`:
- a session returning `completesSpec: true` under `--not-last` commits a sidecar with `false` and a frontmatter reading `completes-spec: false`;
- a session document that omits `completesSpec`, or pairs `sourceSpec: null` with `true`, is refused with nothing written.

`tests/type/schemasPackage.ts` passes under `pnpm test:type`.

### Implementation order

1. Freeze 0.17.0 (the history module plus its `releases` entry) while the current schema is still unchanged.
2. Add `completesSpec` to `planDocument.ts`, with `planDocument.test.ts`.
3. `toLatestPlanDocument` and the `readPlanDocumentFile` stepping, with package and persisted tests.
4. `scripts/schemas-check.ts --write`, then the check run.
5. The `authorArtifact` override and the prompt bullet, with their tests.
6. The remaining fixture and type-test updates.

### Excluded scope

- `completesSpec` in `phax-plan.json` or the extraction cache seed (spec §7).
- Rewriting, migrating or re-stamping any existing sidecar in this repository.
- A release cut: `next` stays `next` until the next release renames it.
- Release-aware decoding of older `$schema` sidecars inside phax's own reader.
- Docs and skill text: phase 5.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The final encoding of `completesSpec` in `src/schemas/planDocument.ts`, and how the JSON Schema shows it.
- The frozen module path `src/schemas/history/plan-document/0.17.0.ts` and its `releases` entry.
- The `toLatestPlanDocument` mapping and the `LatestPlanDocument` type.
- The `readPlanDocumentFile` behaviour for pre-schema and older `$schema` sidecars.
- The schemas-check commands run and their clean result.
- How the bridge-parity tests were kept meaningful.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): mirror completesSpec in the plan document`

### Commit body

The plan document (the headless plan's JSON sidecar and the authoring contract) now
requires completesSpec. It is a boolean beside a sourceSpec path and null beside
sourceSpec: null; the cross pairs are refused. Headless authoring sets it from
--last/--not-last whatever the session returned, as it does for sourceSpec, and the
authoring prompt states the value. phax-plan.json stays lineage-free.

The shape change follows the schemas package's history procedure. Today's shape is
frozen as src/schemas/history/plan-document/0.17.0.ts, listed in the format's releases
and pinned in history.lock.json. The new shape is recorded as next.schema.json, and
CURRENT_SHAPES names next. toLatestPlanDocument upgrades older shapes with
completesSpec null beside no spec and Unknown otherwise, never an invented value.

---

## phase-05 — Docs and live-plan migration for completes-spec {#phase-05-docs-and-migration}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Operators and planning agents learn the key where they look. The phax-planning skill defines it, the README shows how to keep a multi-plan spec live until its last plan, and NEXT_STEPS records the defect as fixed. Any live plan with a source spec is checked for the key by hand, as decided in §9 Q6.

### Detailed instructions

- Hand migration (§9 Q6): list every `docs/plans/*.md` directly under docs/plans/, not archive/. Ignore this run's own plan file (the `completes-spec` plan, whose source-spec is `docs/specs/2610060955-completes-spec.md`): it must NOT gain the key, because the installed phax 0.19.0 that drives this run refuses unknown keys. If any other live plan names a spec, do not guess whether it is its spec's last. Leave it unchanged and list it in the handoff under `Needs a human decision`, so the reviewer adds the key (and re-approves an Approved plan) before merging. At planning time none exists: `2606291247-smolvm-isolation-spike-plan.md` and `2610060955-own-approval-ground-plan.md` both have `source-spec: null`.
- In `.claude/skills/phax-planning/SKILL.md`, §Plan frontmatter block:
  - add `completes-spec: false` after `source-spec` in the example block;
  - add a `completes-spec` bullet: `true` when this plan is its spec's last and its run completes the spec, `false` when more plans of the spec follow; required when `source-spec` names a spec and absent (refused) when it is `null`; every plan of a spec except the last says `false`; the chain gate still applies on top; the value is fingerprinted, so changing it on an Approved plan makes it stale;
  - update the creation sentence to `phax artifact new plan <slug> --spec <spec path> --last|--not-last`, and say that both flags are refused without `--spec`.
  In §Headless authoring, add `completesSpec` next to `sourceSpec`: phax sets it from `--last`/`--not-last` regardless, null without `--spec`.
- In `README.md`:
  - Replace the lifecycle sentence `A run completes its own plan, and its spec where it can, on the run's branch.` with: a run completes its own plan, and its spec only when the plan says it is the spec's last (`completes-spec: true`) and no other live plan still needs it.
  - Add the spec §11 example for an operator splitting one spec across plans: `--not-last` for plan 1 of 3, `--last` for plan 3 of 3, and plan 1's frontmatter.
  - Update the hand-written examples that run `artifact new plan ... --spec` (quick start, Create them, Let phax write them) to carry `--last`.
  - Update the run section's `Its plan, and its spec where it can, are completed` sentence the same way.
  - Add a Troubleshooting upgrade note: a plan with a source spec but no `completes-spec` is refused with exit 12; add the key by hand and re-approve.
  Leave the generated CLI block alone; phase 3 regenerated it.
- In `NEXT_STEPS.md`, tick `A run completes its source spec even when more plans are to come` under §Small follow-ups, noting that the `completes-spec` spec shipped. Drop the `artifact-decide` note `If the spec ships in more than one plan, revert the run's spec completion on every plan but the last (see *Small follow-ups*).`
- Create `tests/unit/completesSpecDocs.test.ts`, in the style of `tests/unit/approvalRecordDocs.test.ts`. It reads the bundled SKILL.md and README and asserts:
  - the skill's plan frontmatter section defines `completes-spec` with `true` and `false`;
  - the skill says the key is absent when `source-spec` is `null`;
  - the skill says every plan except the last carries `false`;
  - the README shows `--not-last`.
  Keep the assertions on stable phrases, not whole paragraphs.
- The `phax-cli` skill does not describe `artifact new plan`; leave it unchanged.

### Planned files to create

- `tests/unit/completesSpecDocs.test.ts`

### Planned files to edit

- `README.md`
- `.claude/skills/phax-planning/SKILL.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- (none)

### Test strategy

Write `tests/unit/completesSpecDocs.test.ts` first; it encodes the spec's acceptance criterion `The planning skill teaches the key` and fails until the skill text lands. The existing docs and site tests (README drift, site generation) confirm the README edits keep the generated block intact.

### Implementation order

1. The hand-migration check of live plans; record the result.
2. The docs test.
3. The phax-planning SKILL.md text.
4. The README lifecycle text, examples and upgrade note.
5. NEXT_STEPS.md.

### Excluded scope

- Adding `completes-spec` to this run's own plan file.
- Guessing `completes-spec` for any live plan; that is a human decision.
- Editing the regenerated CLI reference or `phax.usage.kdl`.
- Editing archived plans or sidecars (spec §7: no migration of archived plans).
- The `phax-cli` skill, which does not describe `artifact new plan`.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The result of the live-plan check: the plans inspected and, if any plan with a spec lacked the key, its path under `Needs a human decision`.
- Confirmation that this plan file was left without the key.
- The sections changed in SKILL.md, README.md and NEXT_STEPS.md.
- What the new docs test asserts.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs: teach completes-spec and close the multi-plan follow-up`

### Commit body

The phax-planning skill's plan frontmatter block now defines completes-spec: true or
false, absent when source-spec is null, and false on every plan of a spec except the
last. It shows the --last/--not-last flags and adds completesSpec to the headless
document keys. The README lifecycle text says a run completes its spec only when its
plan says it is the last, with the multi-plan example; its examples carry the flags,
and an upgrade note covers plans that lack the key. NEXT_STEPS ticks the follow-up and
drops the note about reverting a run's spec completion by hand. No live plan with a
source spec needed the key.
