# Plan — Address the attention points from the `project-namespaces` compliance review

## Context and rationale

The compliance review of the `project-namespaces` run
(`~/.phax/runs/project-namespaces/compliance-review.md`) returned
`conformant-with-deviations` and recorded four **attention points**. This plan
closes the actionable ones with small, independently-committable phases. Each
attention point was traced to its real root cause in the code before planning:

### AP1 — Reconciliation "false-negatives" for newly-created test files

The review flagged `tests/unit/lock.test.ts` (phase-07), `tests/unit/cli/ls.test.ts`
(phase-08), and `tests/unit/resolveRunInfo.test.ts` (phase-06) as "not touched"
despite existing with correct content, and asked whether the reconciliation tool
should detect new file creation.

Root cause (verified against the phase reconciliation artifacts and the diffs):
these files **were** detected by git — they appear as added (`A`) in the phase
`diff.patch`. The problem is that the plan listed them under *planned to edit*,
and `src/domain/reconciliation/reconcile.ts` treats the planned action (create
vs. edit) as a hard requirement:

```ts
const editedAsPlanned = planned.edit.filter((f) => edited.has(f));     // created → NOT here
const missingPlannedEdit = planned.edit.filter((f) => !edited.has(f)); // created → flagged "missing"
```

A file planned-to-edit but actually *created* lands in `missingPlannedEdit`, and
`aggregateGlobalReconciliation` (`src/domain/reconciliation/global.ts`) only marks
a file as touched when it appears in `createdAsPlanned`/`editedAsPlanned`/
`unplanned*`/`optionalTouched` — so a `missingPlannedEdit`-only file becomes
global status `missing` ("not touched"). The signal is misleading: the file *was*
touched, just with a different action than planned.

Fix: make reconciliation tolerant of a **create/edit action mismatch**. A planned
file that was touched at all is satisfied (not missing); the mismatch is surfaced
as an informational note rather than a deviation. Truly-untouched planned files
still flag as missing.

### AP2 — Phase-03 run-command-level test gap

`tests/unit/runArgv.test.ts` covers `--provider-priority`/`--security` argv
parsing, not the namespace behaviors phase-03 promised. Verified:

- (a) *config missing `name` fails before run-folder creation with the spec §5.4
  message* — the §5.4 validation message itself **is** covered at the config
  layer (`tests/unit/loadConfig.test.ts` asserts `path: "name"`,
  `tests/unit/schemas.test.ts` rejects a config missing `name`). What is **not**
  covered is the run-command sequencing guarantee that this failure happens
  before any run folder is created.
- (b) *namespace-scoped uniqueness bump that never overwrites an existing folder*
  — implemented by `ensureUniqueShortName` embedded in `src/cli/commands/run.ts`
  (lines ~76–91), with **no unit test**. Registry-level scoping is tested
  (`tests/unit/registryNamespace.test.ts`) but the bump selection is not.
- (c) *run output shows the qualified name* (`runKey(namespace, shortName)`) — no
  run-command-level test.

Fix: extract the pure bump-selection into the domain so it is directly testable,
unit-test it, and add a focused run-command test for (a) and (c).

### AP3 — `enterPhase.ts` reached its goal via a different path than planned

The phase-06 plan called for threading namespace to `resolvePhaseInfo` in
`src/cli/commands/enterPhase.ts`; the phase-05 implementation instead resolves via
`resolveRunRef` and reads `info.phaseStatuses` directly. The functional goal
(namespace-scoped phase lookup, qualified-name display) is met — **no code change
is warranted**. To address the attention point we lock the behavior in with a
regression test so a future refactor cannot silently break it.

### AP4 — `renderGlobalReconciliationMarkdown` takes an optional `qualifiedRunName`

`renderGlobalReconciliationMarkdown(global, qualifiedRunName?: string)` in
`src/domain/reconciliation/global.ts` keeps the run identifier optional, so a
caller that omits it silently produces reconciliation markdown with no `**Run**:`
header. The app-layer opts field `GenerateGlobalReconciliationOpts.qualifiedRunName`
is **already required** and the sole production caller (`src/app/reviewHandoff.ts`)
passes it — so this is not a live bug, but the optional domain parameter is a
back-compat shim that the project convention (`feedback_no_backcompat`) rejects.

Fix: make the parameter required and update the unit-test call sites that omit it.

## Ordering

The four items are independent; phases run sequentially and each assumes the
previous is merged. Order chosen by blast radius (smallest, purest first):

1. AP4 — required parameter (domain + its unit tests only).
2. AP1 — reconciliation action-mismatch tolerance (domain + its unit tests only).
3. AP2 — extract the bump selector and add the run-command tests.
4. AP3 — regression test pinning `enterPhase` namespace-scoped resolution.

## Required commands

- (none)

---

## phase-01 — Make `renderGlobalReconciliationMarkdown` require the qualified run name {#phase-01-required-qualified-run-name}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Remove the optional `qualifiedRunName?: string` parameter shim from the global
reconciliation renderer so the run identifier is always present in generated
output, matching the already-required app-layer opts field and the
no-back-compat-shim convention.

### Detailed instructions

- In `src/domain/reconciliation/global.ts`, change
  `renderGlobalReconciliationMarkdown(global, qualifiedRunName?: string)` to take
  `qualifiedRunName: string` (required). Drop the `if (qualifiedRunName)` guard so
  the `**Run**: <name>` line is always emitted.
- The sole production caller (`src/app/generateGlobalReconciliation.ts`, which
  passes `opts.qualifiedRunName` — already required on
  `GenerateGlobalReconciliationOpts`) needs no signature change; confirm it still
  type-checks.
- Update every unit-test call site that omits the argument so it passes an
  explicit qualified run name: `tests/unit/reconciliation/global.test.ts` calls
  `renderGlobalReconciliationMarkdown(...)` at roughly lines 328, 336, 346, 359,
  370, and 390. Pass a representative value (e.g. `"acme.fixbug"`).
- Refresh the affected snapshot in
  `tests/unit/reconciliation/__snapshots__/global.test.ts.snap` (the `**Run**:`
  line now appears unconditionally) via the project's snapshot-update flow.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/reconciliation/global.ts`
- `tests/unit/reconciliation/global.test.ts`
- `tests/unit/reconciliation/__snapshots__/global.test.ts.snap`

### Optional files that may be edited

- `src/app/generateGlobalReconciliation.ts`

### Boundary contracts

Producer `renderGlobalReconciliationMarkdown` (domain) now requires a qualified
run name from its consumer. The only consumer
(`generateGlobalReconciliation`, app) already holds a required
`qualifiedRunName`, so the contract tightens without a new data source.

### Test strategy

Unit (domain). Update the existing `global.test.ts` cases to pass the new required
argument and assert the `**Run**:` header is present. No new test file.

### Implementation order

Change the domain signature, fix call sites, regenerate the snapshot.

### Excluded scope

- No change to `aggregateGlobalReconciliation` or status derivation.
- No change to `GenerateGlobalReconciliationOpts` (already required).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The new required signature
  `renderGlobalReconciliationMarkdown(global, qualifiedRunName: string)`.
- Confirmation that `generateGlobalReconciliation` and `reviewHandoff` still pass
  the value, and the snapshot was regenerated (not hand-edited).

### Commit subject

refactor(reconciliation): require qualifiedRunName in global markdown renderer

### Commit body

Drop the optional qualifiedRunName parameter from
renderGlobalReconciliationMarkdown so the **Run** header is always emitted. The
app-layer opts field was already required and the only production caller passes
it; this removes a back-compat shim per project convention. Updates the unit-test
call sites and regenerates the global reconciliation snapshot.

---

## phase-02 — Reconciliation tolerates a planned create/edit action mismatch {#phase-02-action-mismatch-tolerance}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Stop reporting a planned file as "missing / not touched" when it was touched with
the other action (planned to edit but created, or planned to create but edited).
Treat it as satisfied and surface the action mismatch as an informational note,
so newly-created test files listed under *planned to edit* no longer show as
false-negative deviations in the per-phase and global reconciliation.

### Detailed instructions

- In `src/domain/reconciliation/types.ts`, extend `ReconciliationResult` (and
  therefore `PhaseFileReconciliation`) with two informational arrays:
  - `createdButPlannedEdit: readonly string[]` — files in `planned.edit` that were
    actually added.
  - `editedButPlannedCreate: readonly string[]` — files in `planned.create` that
    were actually modified.
- In `src/domain/reconciliation/reconcile.ts`:
  - A planned file touched by *either* action counts as satisfied. Compute the
    mismatch sets above, and exclude them from `missingPlannedCreate` /
    `missingPlannedEdit`. `missingPlanned*` must contain only files that were not
    touched at all (neither created, edited, nor renamed-to).
  - Keep `createdAsPlanned` / `editedAsPlanned` meaning "planned with the action
    that actually happened" (i.e. do not move mismatched files into them — they
    are reported via the new arrays). Decide and document whether an action
    mismatch contributes to `hasDeviations`; it must be a softer signal than a
    missing/unplanned file — recommended: it does **not** set `hasDeviations`,
    because the planned file was genuinely delivered.
- In `src/domain/reconciliation/render.ts`, render the mismatches: a planned-edit
  file that was created should show as satisfied (checked) in "Planned to edit"
  rather than unchecked, and an "Action note" line (e.g.
  `created though planned as edit`) should appear. Do the symmetric thing for
  "Planned to create". Do not label these as deviations requiring a handoff
  explanation.
- In `src/domain/reconciliation/global.ts`, fold the new arrays into
  `aggregateGlobalReconciliation` so mismatched files are marked **touched**:
  - `createdButPlannedEdit` → `plannedInPhases` + `touchedInPhases`,
    `expectedActions.add("edit")`, `actualActions.add("added")`.
  - `editedButPlannedCreate` → `plannedInPhases` + `touchedInPhases`,
    `expectedActions.add("create")`, `actualActions.add("modified")`.
  - Result: such a file derives to a touched status (not `missing`). Consider a
    distinct note in `deriveNotes` (e.g. `action mismatch: planned edit, created`)
    rather than reusing the `partially-matched`/`missing` wording. Keep
    `deriveStatus` precedence sane (an action-mismatch is closer to `matched` than
    to `missing`).
- Keep the change purely additive to the data shape — these are required fields on
  the result (no optional shims); every constructor of `ReconciliationResult`
  (only `reconcile`) must populate them.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/reconciliation/types.ts`
- `src/domain/reconciliation/reconcile.ts`
- `src/domain/reconciliation/render.ts`
- `src/domain/reconciliation/global.ts`
- `tests/unit/reconciliation/reconcile.test.ts`
- `tests/unit/reconciliation/render.test.ts`
- `tests/unit/reconciliation/global.test.ts`

### Optional files that may be edited

- `tests/unit/reconciliation/__snapshots__/global.test.ts.snap`

### Boundary contracts

Pure domain change. `PhaseFileReconciliation` gains two required fields; the only
producer is `reconcile` (called from `src/app/reconcilePhaseFiles.ts`) and the
only consumers are the renderers and `aggregateGlobalReconciliation`, all updated
in this phase.

### Test strategy

Unit (domain), test-first for the new invariants:

- `reconcile.test.ts`: a file in `planned.edit` reported by git as `added` →
  appears in `createdButPlannedEdit`, **not** in `missingPlannedEdit`, and does
  not (on its own) set `hasDeviations`. Symmetric case for `planned.create`
  reported as `modified`. A planned file that is genuinely untouched still appears
  in `missingPlanned*`.
- `global.test.ts`: aggregating a phase whose only entry is a
  `createdButPlannedEdit` file yields a **touched** (non-`missing`) status with the
  action-mismatch note. This is the exact `lock.test.ts` / `ls.test.ts` scenario.
- `render.test.ts`: the per-phase markdown checks the box and prints the action
  note for a mismatched file.

### Implementation order

`types.ts` → `reconcile.ts` → `render.ts` → `global.ts`, writing the failing unit
tests first at each step.

### Excluded scope

- No change to `parseNameStatus` or the git adapter (`src/infra/git.ts`).
- No retroactive re-run of past reconciliations; this only affects future runs.
- No edits to the external phax-planning skill docs.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The new field names `createdButPlannedEdit` / `editedButPlannedCreate` and which
  modules populate vs. consume them.
- The decision on whether an action mismatch sets `hasDeviations` (and why).
- The new global status/note string used for mismatches.

### Commit subject

fix(reconciliation): treat planned create/edit action mismatch as satisfied

### Commit body

A file listed under planned-to-edit but actually created (common for new test
files) was reported as missing/not-touched in both the per-phase and global
reconciliation, even though git saw it as added. Record create/edit action
mismatches as informational and exclude them from the missing sets and from
touched-status derivation, so genuinely-delivered files stop showing as
false-negative deviations. Truly-untouched planned files still flag. Covered by
new unit tests across reconcile, render, and global.

---

## phase-03 — Close the phase-03 run-command namespace test gap {#phase-03-run-command-tests}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Extract the namespace-scoped uniqueness bump from `phax run` into a pure,
unit-testable domain helper, and add run-command-level tests for the three
behaviors phase-03 promised but left untested: the bump is namespace-scoped and
never overwrites an existing run, a config missing `name` fails before any run
folder is created, and `phax run` output shows the qualified name.

### Detailed instructions

- Extract the bump selection from `ensureUniqueShortName` in
  `src/cli/commands/run.ts` into a pure function in `src/domain/runRef.ts`, e.g.
  `nextAvailableShortName(base: ShortName, isUsed: (name: string) => boolean): ShortName`.
  It returns `base` if unused, otherwise the first of `base-2`, `base-3`, … for
  which `isUsed` is false. The separator/format must stay consistent with the
  current implementation. The function is pure — all I/O stays in the caller.
- Refactor `ensureUniqueShortName` in `run.ts` to build the `isUsed` predicate
  (namespace-scoped registry membership **and** `existsSync` of the run folder, as
  today) and delegate to `nextAvailableShortName`. Behavior must be unchanged;
  cross-namespace independence comes from the caller scoping the predicate to
  `r.namespace === namespace`.
- Add unit tests for `nextAvailableShortName` in `tests/unit/runRef.test.ts`
  (covers AP2-b): returns the base when free; bumps within a namespace when the
  predicate reports the base used; never returns a name the predicate marks used;
  two predicates scoped to different namespaces independently keep the same base
  (the cross-namespace-independence property).
- Add `tests/unit/cli/run.test.ts` covering the run-command surface (AP2-a, AP2-c).
  Follow the existing Commander harness pattern in `tests/unit/runArgv.test.ts`
  and the fake-port style in the other `tests/unit/cli/*.test.ts` files:
  - (a) When `loadConfig` yields a config missing `name`, the command surfaces the
    spec §5.4 validation error (`path: "name"`) and **does not** create a run
    folder — assert via a fake/spy that the `createRunFolder` path is never
    reached and the command returns a non-zero exit.
  - (c) On a successful run, the printed output includes the qualified name
    `runKey(namespace, shortName)` (e.g. `acme.fixbug`).
  - If `run.ts` has no clean seam to inject the config loader / run-folder
    creator, add the **minimal** seam needed (e.g. export the helper(s) under test
    or accept injected dependencies) — do not undertake a broad refactor of the
    command. Prefer exercising the real namespace logic over mocking it away.
- Leave `tests/unit/runArgv.test.ts` as the argv-parsing test; do not overload it
  with namespace behavior.

### Planned files to create

- `tests/unit/cli/run.test.ts`

### Planned files to edit

- `src/domain/runRef.ts`
- `src/cli/commands/run.ts`
- `tests/unit/runRef.test.ts`

### Optional files that may be edited

- `tests/unit/runArgv.test.ts`

### Boundary contracts

Producer `nextAvailableShortName` (domain) provides pure bump selection given a
membership predicate; consumer `ensureUniqueShortName` (cli) provides the
predicate (registry + filesystem) and stays the only place I/O happens. CLI
command logic must remain thin — the extraction moves business logic out of the
view layer, not into it.

### Test strategy

- Domain unit (`runRef.test.ts`): the `nextAvailableShortName` invariants above —
  written first.
- CLI test (`tests/unit/cli/run.test.ts`): missing-`name` short-circuit before
  folder creation, and qualified-name output, via fakes/spies.

### Implementation order

Extract the pure helper and unit-test it, refactor `run.ts` to delegate (behavior
unchanged), then add the run-command test.

### Excluded scope

- No new uniqueness *policy* (still slug then `-2`, `-3`, …) — only extraction and
  tests.
- No change to registry or run-status schemas.
- No broad restructuring of `run.ts` beyond the minimal seam required to test.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact signature of `nextAvailableShortName` and that `ensureUniqueShortName`
  now delegates to it with an unchanged predicate.
- Which seam (if any) was added to `run.ts` to make (a)/(c) testable, and why.
- The three scenarios now covered and where (`runRef.test.ts` vs
  `tests/unit/cli/run.test.ts`).

### Commit subject

test(run): cover namespace-scoped uniqueness and qualified-name output

### Commit body

Extract the namespace-scoped short-name bump from phax run into a pure
nextAvailableShortName domain helper and unit-test it (within-namespace bump,
cross-namespace independence, never overwrites). Add a run-command test asserting
a config missing `name` fails before any run folder is created and that run
output shows the qualified name. Closes the phase-03 run-command-level test gap
from the project-namespaces compliance review.

---

## phase-04 — Pin `enterPhase` namespace-scoped resolution with a regression test {#phase-04-enterphase-regression}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

The phase-06 plan's `enterPhase.ts` edit was superseded by the phase-05
`resolveRunRef` approach with no functional impact, so no code change is needed.
Lock the working behavior in with a regression test so a future refactor cannot
silently regress namespace-scoped phase entry or qualified-name display.

### Detailed instructions

- Add `tests/unit/cli/enterPhase.test.ts` asserting that the `enter-phase` command
  resolves a run via `resolveRunRef` (namespace-scoped, by qualified key) and:
  - reads the target phase from the resolved run's `phaseStatuses` (the path the
    implementation actually uses), and
  - displays the qualified name (`<namespace>.<shortName>`) in its output.
- Include a cross-namespace case: two runs sharing a short name in different
  namespaces resolve independently (the unqualified-inside-a-project path resolves
  against the current namespace; a qualified reference selects the exact run).
- Use the existing fake-port / harness style from the neighboring
  `tests/unit/cli/*.test.ts` files. Read `src/cli/commands/enterPhase.ts` and the
  `ResolveRunRefResult` shape in `src/app/resolveRunRef.ts` to mirror the real
  control flow rather than asserting an implementation that no longer exists
  (there is no separate `resolvePhaseInfo` call).
- This is test-only. Do **not** modify `enterPhase.ts` unless a missing test seam
  forces a minimal, behavior-preserving export.

### Planned files to create

- `tests/unit/cli/enterPhase.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/cli/commands/enterPhase.ts`

### Boundary contracts

None crossed — the test exercises the CLI command against its existing app-layer
resolver (`resolveRunRef`) using fakes.

### Test strategy

CLI unit test pinning observable behavior: namespace-scoped resolution and
qualified-name display, including the same-short-name-different-namespace case.
Written against the current `resolveRunRef`-based control flow.

### Implementation order

Read the current `enterPhase` flow and `ResolveRunRefResult`, then write the test.

### Excluded scope

- No functional change to `enterPhase` (the behavior is already correct).
- No reintroduction of a `resolvePhaseInfo` call.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `enterPhase.ts` was not functionally changed.
- The behaviors the new test pins (namespace-scoped resolution, qualified-name
  display, cross-namespace independence) and the harness/fakes used.

### Commit subject

test(enter-phase): pin namespace-scoped resolution and qualified-name display

### Commit body

The phase-06 enterPhase edit was superseded by the phase-05 resolveRunRef
approach with no functional impact. Add a regression test that pins the working
behavior — namespace-scoped resolution via resolveRunRef, qualified-name display,
and independence of same-short-name runs across namespaces — so a future refactor
cannot silently regress it. Addresses the enterPhase attention point from the
project-namespaces compliance review.
```