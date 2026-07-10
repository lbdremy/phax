# Gate Profile as Attributed Steps — implementation plan

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. Source spec:
> [`docs/specs/15-gate-profile-attributed-steps.md`](../specs/15-gate-profile-attributed-steps.md).

---

## Required commands

- (none)

All gate steps use `pnpm` scripts already present in `package.json`; the plan
introduces no new tool, runtime, or CLI. No `## Required PHAX security
configuration changes` section is needed.

---

## Context

Today a gate profile is a flat array of command strings
(`Record<string, NonEmptyArray<NonEmptyString>>` in
`src/schemas/phaxConfig.ts`), and the "depth" dial is a naming convention over
profile keys: `pickGateProfileId` in `src/cli/commands/run.ts` prefers `full`,
then `fast`, then the first key (mirrored in `src/cli/commands/resume.ts` and
`src/app/dryRun.ts`). Every step of the selected profile runs at **every** phase
gate — there is no terminal-vs-every-phase distinction — and phax records only
the profile *id*, never which surfaces were verified.

Spec 15 replaces this with a profile that is a named set of **attributed steps**,
each carrying two explicit dimensions:

- **surface** — a recorded free-text label (convention: `local` / `structural` /
  `product`). Pure **attribution**: phax records it and never branches on it.
- **firing** — `every-phase | terminal`. **Behavioral**: phax schedules on it.

The depth scalar is removed, per-phase attribution is recorded, and the set of
verified surfaces is legible at run end. Per phax schema policy there is **no
back-compat shim**: a profile entry still in the old flat-array form is rejected
at validation, naming the profile.

### Architecture seams (discovered)

- Schema: `GateProfilesSchema` value in `src/schemas/phaxConfig.ts:38-43`; used at
  `:127` (project config, required), `:204` (user overlay), `:49` (workspace).
- Resolution: `resolveGateProfile` (`src/app/gates.ts:13-30`) returns the raw
  command list; `runGates` (`:41-80`) executes it via the `Shell` port and writes
  `checks-attempt-NN.log` via the `FileSystem` port.
- Fix loop: `runGatesWithFixLoop` (`src/app/fixLoop.ts:78-314`) reruns `runGates`
  per attempt; the second `runGates` caller is `adaptGateRun`
  (`src/app/eventAdapter.ts:144-166`).
- Orchestration: `src/app/executePlan.ts` resolves once at `:277`; the sole
  terminal test is `const isFinal = i === plan.phases.length - 1;` (`:415`); the
  gate is invoked per phase at `:816-829`. `:588` reads
  `config.raw.gateProfiles[gateProfileId]?.flat(1)` for the prompt, `:289` /
  `:512` / `:659` feed `gateCommands` (as `string[]`) into the security preflight
  and posture (`src/domain/security/agentCommands.ts`).
- Depth selection: `pickGateProfileId` (`run.ts:57-65`), `resume.ts:183-195`,
  `dryRun.ts:44`.
- Generators: `src/domain/init/buildConfig.ts:15-22`,
  `src/app/initProject.ts:71`, `src/app/initWizard.ts`.
- Reporting: `src/app/finalReport.ts:216-238` renders the run summary.
- No `surface`/`attribution` concept exists anywhere today.

### Design decisions carried into the phases

- The canonical `GateStep` type is **schema-derived**: `GateStepSchema` and
  `type GateStep` live in `src/schemas/phaxConfig.ts`; the pure domain firing
  helper `import type`s it (consistent with `src/domain/config/mergeLayers.ts`
  and `src/domain/init/buildConfig.ts`, which already `import type` from
  `schemas/phaxConfig.js` — allowed by `pnpm audit:architecture`).
- Behavioral (`firing`) vs attribution (`surface`) split is honored strictly:
  only `firing` changes scheduling; `surface` is recorded and never branched on.
- The security preflight/posture and the agent prompt keep consuming **command
  strings** (`steps.map(s => s.command)`); only the gate runner learns the step
  objects.

---

## phase-01 — Attributed gate-step schema and profile resolution {#phase-01-attributed-step-schema}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Replace the flat command-string profile with a set of attributed steps
`{ command, surface, firing }`, thread `GateStep` objects from config resolution
through the gate runner (executing `step.command`), remove the fast/full depth
selection, and reject the old flat-array form at validation — all
**behavior-preserving** (surface/firing not yet acted upon). The schema
value-type change is atomic (it breaks types repo-wide), so schema, consumers,
generators, fixtures, tests, and the generated JSON schemas land in one commit.

### Detailed instructions

- **Schema** (`src/schemas/phaxConfig.ts`):
  - Add `const FiringSchema = Schema.Literal("every-phase", "terminal");` and
    `export type Firing = Schema.Schema.Type<typeof FiringSchema>;`.
  - Add `const GateStepSchema = Schema.Struct({ command: Schema.NonEmptyString,
    surface: Schema.NonEmptyString, firing: FiringSchema });` and
    `export type GateStep = Schema.Schema.Type<typeof GateStepSchema>;`.
  - Change `GateProfilesSchema` value from `NonEmptyCommandArray` to
    `Schema.NonEmptyArray(GateStepSchema)`. Leave `NonEmptyCommandArray` in place
    only if still referenced (e.g. `commands.setup`); otherwise remove it to keep
    `pnpm knip` green.
  - Keep `onExcessProperty: "error"` on the decoders so an unknown step key is
    rejected. Confirm the decode error for a flat-array entry surfaces the
    profile key in its path (e.g. `gateProfiles.full[0]`); if the default message
    is not legible, add a decode-error mapping that names the offending profile.
- **Resolution** (`src/app/gates.ts`):
  - Change `resolveGateProfile` return type to `readonly GateStep[]` (workspace
    override branch unchanged in logic).
  - Change `runGates` to accept `steps: readonly GateStep[]`; execute
    `parseCommandTokens(step.command)`; log `$ ${step.command}` and the exit as
    today. Do **not** yet record surface/firing — behavior is identical.
- **Orchestration** (`src/app/executePlan.ts`):
  - `:277` — `gateSteps: readonly GateStep[] = resolveGateProfile(...)`. Derive
    `const gateCommandStrings = gateSteps.map((s) => s.command);` and feed
    `gateCommandStrings` into the security preflight (`:289`), posture (`:512`,
    `:659`), and prompt generation. Pass `gateSteps` into `runGatesWithFixLoop`
    (`:817`).
  - `:588` — replace `config.raw.gateProfiles[gateProfileId]?.flat(1) ?? []`
    with `(config.raw.gateProfiles[gateProfileId] ?? []).map((s) => s.command)`.
- **Fix loop** (`src/app/fixLoop.ts`): change `RunGatesWithFixLoopOptions.commands`
  to `steps: readonly GateStep[]`; pass `steps` to `runGates`.
- **Event adapter** (`src/app/eventAdapter.ts`): change `adaptGateRun`'s first
  param to `steps: readonly GateStep[]`; pass through to `runGates`.
- **Dry run** (`src/app/dryRun.ts`): `resolveGateProfile` now returns steps; keep
  `report.gateCommands` as `string[]` by mapping `steps.map((s) => s.command)`
  for display. Remove the `?? "full"` depth default (see next bullet).
- **Remove the depth scalar** (§5.1):
  - `run.ts` `pickGateProfileId` — drop the `"full"`/`"fast"` preference; select
    the sole profile (`Object.keys(profiles)[0] ?? null`), still erroring when
    none. A project is expected to define one profile; multi-profile
    disambiguation is out of scope (see Excluded scope).
  - `resume.ts:183-195` — use persisted `runStatus.gateProfileId` if present,
    else the same first-key selection (no `full`/`fast` branches).
  - `dryRun.ts:44` — default `profileId` to the first profile key, not `"full"`.
- **Generators**:
  - `src/domain/init/buildConfig.ts` — wrap each collected command as
    `{ command, surface: "local", firing: "every-phase" }`; the generated default
    profile is a single named profile of attributed steps.
  - `src/app/initProject.ts:71` and `src/app/initWizard.ts` — same wrapping where
    they emit `gateProfiles` (the wizard still collects command strings; only the
    emitted config shape changes).
- **Config fixtures / dogfood config** — migrate to attributed steps:
  - `phax.json` (repo root) — collapse `fast` + `full` into one profile (e.g.
    `standard`): every-phase steps carry `firing: "every-phase"`; terminal-only
    steps (`pnpm build`, `pnpm deno:smoke`, `pnpm deno:smoke-binary`) carry
    `firing: "terminal"`; assign a `surface` per step (`local` for
    format/typecheck/test/lint, `structural` for `pnpm audit:architecture` and
    `pnpm knip`, `product` for build/smoke).
  - `examples/hello-world/phax.json` and
    `tests/e2e/fixtures/minimal-repo/phax.json` — migrate to attributed steps.
- **Regenerate** `phax.schema.json` and `phax.user.schema.json` from the updated
  Effect schemas (via the existing generation path in `src/app/initProject.ts` /
  `getPhaxConfigJsonSchema`). Do not hand-edit the generated JSON.
- **Tests** — update every fixture/assertion that constructs a profile as a
  string array to the attributed-step shape: `tests/unit/gateProfile.test.ts`,
  `tests/integration/gates.test.ts`, `tests/integration/fixLoop.test.ts`,
  `tests/integration/eventAdapter.test.ts`, `tests/integration/executePlan.test.ts`,
  `tests/unit/dryRun.test.ts`, `tests/unit/cli/run.test.ts`. Add:
  - a decode test asserting a flat-array profile entry is **rejected** and the
    error names the profile (§6, §9);
  - a `pickGateProfileId` test asserting the `full`/`fast` preference is gone
    (first key selected).

### Planned files to create

- (none)

### Planned files to edit

- src/schemas/phaxConfig.ts
- src/app/gates.ts
- src/app/executePlan.ts
- src/app/fixLoop.ts
- src/app/eventAdapter.ts
- src/app/dryRun.ts
- src/cli/commands/run.ts
- src/cli/commands/resume.ts
- src/domain/init/buildConfig.ts
- src/app/initProject.ts
- src/app/initWizard.ts
- phax.json
- examples/hello-world/phax.json
- tests/e2e/fixtures/minimal-repo/phax.json
- phax.schema.json
- phax.user.schema.json
- tests/unit/gateProfile.test.ts
- tests/integration/gates.test.ts
- tests/integration/fixLoop.test.ts
- tests/integration/eventAdapter.test.ts
- tests/integration/executePlan.test.ts
- tests/unit/dryRun.test.ts
- tests/unit/cli/run.test.ts

### Optional files that may be edited

- src/app/promptGeneration.ts
- src/domain/init/buildConfig.test.ts
- tests/unit/architecturalGuards.test.ts
- src/schemas/phaxConfig.test.ts

### Boundary contracts

- **Config → gate runner.** Consumer (`runGates`) needs an ordered list of
  executable commands plus, later, their attributes; producer
  (`resolveGateProfile`) provides `readonly GateStep[]`. Stable shape:
  `{ command: string; surface: string; firing: "every-phase" | "terminal" }`.
- **Gate steps → security/prompt.** Consumers (`checkRequiredCommands`, security
  posture, prompt) need only command **strings**; the producer maps
  `steps.map(s => s.command)`. The frozen effective set must include **every**
  step's command regardless of firing (terminal steps still run at the last
  phase).

### Test strategy

- Schema decode/reject: unit tests on `decodePhaxConfig` (write the reject-flat-
  array and profile-naming assertions **before** the schema edit — stable
  contract).
- `resolveGateProfile` / `pickGateProfileId`: unit tests (domain/CLI selection).
- `runGates` executing `step.command`: integration test against Shell/FileSystem
  fakes, asserting identical behavior to today.

### Implementation order

Schema → `resolveGateProfile`/`runGates` → fix loop / event adapter / dry run →
executePlan wiring → depth-scalar removal → generators → fixtures → regenerate
JSON schemas → tests.

### Excluded scope

- Firing behavior (terminal vs every-phase scheduling) — phase-02.
- Per-phase attribution record — phase-03.
- Run-end surface reporting — phase-04.
- User-facing docs — phase-05.
- Multi-profile disambiguation / a `--gate-profile` selector — not in this plan;
  a project defines one profile and firing carries the cadence.

### Verification

- The project's configured gate profile in `phax.json` (the `full`/`standard`
  profile the repo runs its own phases against).

### Expected handoff content

- The exact new symbols and their module: `GateStepSchema`, `FiringSchema`,
  `type GateStep`, `type Firing` in `src/schemas/phaxConfig.ts`.
- The new `resolveGateProfile` return type and `runGates` signature
  (`steps: readonly GateStep[]`).
- Where command strings are still derived (`steps.map(s => s.command)`) for
  security/prompt, so phase-02/03 do not re-derive incorrectly.
- Confirmation the `full`/`fast` depth preference is removed and which profile
  key each migrated `phax.json` now uses.
- Any deviation from the planned file lists, with the reason (e.g. an extra test
  fixture that referenced the old shape).

### Commit subject

feat(gate): model gate profiles as attributed steps

### Commit body

Replace the flat command-string gate profile with a named set of attributed
steps `{ command, surface, firing }` and thread GateStep objects from config
resolution through the gate runner (executing step.command). Remove the
fast/full depth-scalar selection and reject the old flat-array form at
validation, naming the profile — no back-compat shim, per phax schema policy.
Behavior is otherwise unchanged: surface and firing are carried but not yet
acted upon. Migrate the dogfood config, example, and e2e fixture to the new
shape and regenerate the JSON schemas.

---

## phase-02 — Firing: every-phase vs terminal scheduling {#phase-02-firing-scheduling}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `firing` behavioral: before the terminal phase, run only the profile's
`every-phase` steps; at the terminal phase, additionally run the `terminal`
steps.

### Detailed instructions

- Create a pure domain helper
  `src/domain/gate/selectSteps.ts` exporting
  `selectGateSteps(steps: readonly GateStep[], isTerminal: boolean): readonly GateStep[]`
  that returns every `every-phase` step, plus every `terminal` step when
  `isTerminal` is true (`import type { GateStep } from "../../schemas/phaxConfig.js"`).
  Preserve input order.
- In `src/app/executePlan.ts`, inside the phase loop, compute
  `const phaseSteps = selectGateSteps(gateSteps, isFinal);` (using the existing
  `isFinal` at `:415`) and pass `phaseSteps` — not the full `gateSteps` — into
  `runGatesWithFixLoop` (`:816-829`).
- Keep the **security preflight/posture over the full step set**
  (`gateCommandStrings` from phase-01) — terminal steps still execute at the last
  phase, so their commands must remain in the frozen effective set. Do not filter
  the preflight by firing.
- Optional: refine the agent prompt (`promptGeneration.ts`) so a non-terminal
  phase lists the every-phase gates it must pass and notes that terminal gates
  run at the final phase. Keep this light; do not change prompt structure.

### Planned files to create

- src/domain/gate/selectSteps.ts
- tests/unit/selectGateSteps.test.ts

### Planned files to edit

- src/app/executePlan.ts
- tests/integration/executePlan.test.ts

### Optional files that may be edited

- src/app/promptGeneration.ts

### Boundary contracts

- **Plan phase index → firing filter.** Consumer (the gate invocation) needs the
  subset of steps valid at this phase; producer (`selectGateSteps`) derives it
  from the boolean `isTerminal` only. phax schedules on `firing` and nothing else.

### Test strategy

- `selectGateSteps`: unit tests (pure domain) — write **before** implementation:
  non-terminal returns every-phase only; terminal returns every-phase + terminal;
  order preserved; all-every-phase and all-terminal edge cases.
- executePlan integration: a profile with one every-phase and one terminal step
  runs only the every-phase step at a non-terminal phase gate and both at the
  terminal phase gate (§5.3 acceptance).

### Implementation order

`selectGateSteps` (+ unit tests) → wire into `executePlan` → integration test.

### Excluded scope

- Recording which steps ran (attribution) — phase-03.
- Any behavior keyed on `surface`.

### Verification

- The project's configured gate profile in `phax.json`.

### Expected handoff content

- The `selectGateSteps` signature and module path.
- Confirmation the security preflight still covers terminal-step commands (frozen
  set unchanged), and that only the gate invocation is filtered.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): schedule steps by firing (every-phase vs terminal)

### Commit body

Add a pure selectGateSteps helper and apply it in the phase loop so only
every-phase steps run before the terminal phase and terminal steps additionally
run at the final phase gate. The security preflight continues to cover every
step's command, since terminal steps still execute at run end. Surface remains
pure attribution.

---

## phase-03 — Per-phase attribution record {#phase-03-attribution-record}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

When a phase gate completes, record which steps ran and, for each, its surface
and result (§5.4). Fail-fast semantics are preserved: the record lists the steps
that actually ran up to and including the first failing one.

### Detailed instructions

- Add an attribution schema `src/schemas/gateAttribution.ts`:
  - `GateStepResultSchema = Schema.Struct({ command: NonEmptyString, surface:
    NonEmptyString, result: Schema.Literal("pass", "fail") })`.
  - `GateAttributionSchema = Schema.Struct({ phase: NonEmptyString, steps:
    Schema.Array(GateStepResultSchema) })` with `decode`/`encode` helpers,
    following the pattern in `src/schemas/status.ts`.
- In `src/app/gates.ts` `runGates`:
  - Accept an attribution target: extend the signature (prefer refactoring to an
    options object `{ steps, cwd, attemptLogPath, attributionPath?, phaseId? }`
    to avoid a long positional list; update both callers).
  - Accumulate a `GateStepResult` per executed step (`pass` on exit 0). On the
    first non-zero exit, push a `fail` result for that step and stop (fail-fast,
    as today).
  - When `attributionPath`/`phaseId` are provided, write the attribution record
    via `fs.writeAtomic` on **both** the success and failure paths (symmetric
    with how `attemptLogPath` is already written), so the on-disk record reflects
    the steps that ran this attempt. The fix loop overwrites the same per-phase
    path each attempt, so the final file reflects the last (passing or exhausted)
    evaluation.
- In `src/app/fixLoop.ts`, pass `attributionPath = join(phaseFolderPath,
  "gate-attribution.json")` and `phaseId` into `runGates`.
- In `src/app/eventAdapter.ts` `adaptGateRun`, thread the same options through (or
  leave attribution unset where it is used purely for event mapping — decide by
  whether the call site owns a phase folder; document the choice in the handoff).
- Do **not** branch any behavior on `surface`; it is copied verbatim from the
  `GateStep` into the record (§5.2 acceptance: identical behavior regardless of
  surface value).

### Planned files to create

- src/schemas/gateAttribution.ts
- tests/unit/gateAttribution.test.ts

### Planned files to edit

- src/app/gates.ts
- src/app/fixLoop.ts
- src/app/eventAdapter.ts
- tests/integration/gates.test.ts
- tests/integration/fixLoop.test.ts

### Optional files that may be edited

- tests/integration/eventAdapter.test.ts
- src/app/executePlan.ts

### Boundary contracts

- **Gate runner → phase folder.** Producer (`runGates`) writes a
  `gate-attribution.json` per phase via the `FileSystem` port; consumer
  (phase-04) reads it. Stable shape: `{ phase, steps: [{ command, surface,
  result }] }` (fields normative; filename indicative).

### Test strategy

- Schema round-trip: unit test on `GateAttributionSchema` decode/encode.
- `runGates` attribution: integration tests — a passing profile records every run
  step as `pass` with its surface; a profile whose second step fails records the
  first as `pass`, the second as `fail`, and no steps after it (fail-fast, §5.4).
- Fix loop overwrite: the record reflects the final attempt.

### Implementation order

Attribution schema (+ unit test) → `runGates` accumulation + write → fix loop /
event adapter wiring → integration tests.

### Excluded scope

- Aggregating surfaces across phases for the run-end summary — phase-04.
- Any change to gate pass/fail semantics (still fail-fast on first non-zero exit).

### Verification

- The project's configured gate profile in `phax.json`.

### Expected handoff content

- The `gate-attribution.json` path (`<runPath>/<phaseId>/gate-attribution.json`)
  and the exact record shape, so phase-04 can read it.
- The final `runGates` signature (options object) and how both callers pass (or
  omit) the attribution target.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): record per-phase gate attribution

### Commit body

Record, after each phase gate, which steps ran with their surface and pass/fail
result in a gate-attribution.json under the phase folder. runGates accumulates a
result per executed step and writes the record on both the success and failure
paths, preserving fail-fast semantics (steps after the first failure are not
run and not recorded). Surface is copied verbatim and never branched on. Adds
the GateAttribution schema.

---

## phase-04 — Run-end surface legibility {#phase-04-run-end-surfaces}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

When a run completes, report the set of surfaces that were verified during the
run (§5.5).

### Detailed instructions

- Add `src/app/gateAttribution.ts` (app layer) with a reader/aggregator that,
  given a run path and its phase ids, reads each phase's `gate-attribution.json`
  via the `FileSystem` port and returns the sorted set of surfaces that were
  **verified** — a surface is verified when at least one step of that surface has
  `result: "pass"`. Missing/unreadable records are skipped (a phase may have been
  reset); never throw on absence.
- In `src/app/finalReport.ts`, compute the verified-surface set and render it in
  the run summary, e.g. a line `surfaces verified: local, product` (presence
  normative; exact rendering indicative). Place it in the `## Run Summary`
  section near the Gate Profile line (`:216-238`). Render an explicit empty state
  (e.g. `surfaces verified: (none)`) when no attribution records exist, so a run
  that exercised no surfaces is visible rather than hidden (§3).
- Keep this read-only: the final report already runs at review time; no new port
  is introduced.

### Planned files to create

- src/app/gateAttribution.ts
- tests/unit/gateAttribution.reader.test.ts

### Planned files to edit

- src/app/finalReport.ts
- tests/integration/finalReport.test.ts

### Optional files that may be edited

- tests/unit/finalReport.test.ts

### Boundary contracts

- **Phase attribution records → run summary.** Consumer (`finalReport`) needs the
  aggregate set of verified surfaces; producer (`gateAttribution` reader) derives
  it from the per-phase records written in phase-03. phax does not interpret
  surface labels beyond set membership.

### Test strategy

- Reader unit tests (with FileSystem fake): dedupes surfaces across phases; a
  surface with only `fail` results is not reported as verified; missing files are
  skipped; empty input yields an empty set.
- finalReport integration: a completed run with local+product passing steps
  renders `surfaces verified: local, product`; a run with no records renders the
  empty state (§5.5 acceptance).

### Implementation order

Reader/aggregator (+ unit tests) → finalReport rendering → integration test.

### Excluded scope

- Any live/streamed surface output during the run (the run-end report is the
  legibility surface).
- Changing how attribution is recorded — that is phase-03.

### Verification

- The project's configured gate profile in `phax.json`.

### Expected handoff content

- The reader function signature and module path, and the exact final-report line
  format for verified surfaces (including the empty state).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): report verified surfaces at run end

### Commit body

Aggregate the per-phase gate attribution records into the set of surfaces
verified during the run and render it in the final report's run summary. A
surface counts as verified when at least one of its steps passed; a run that
exercised no surfaces renders an explicit empty state so unverified surfaces are
visible rather than hidden.

---

## phase-05 — Documentation and reference {#phase-05-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Update user-facing documentation to describe the attributed-step profile shape,
the two dimensions, firing scheduling, per-phase attribution, and run-end surface
legibility. No code changes.

### Detailed instructions

- `README.md` — update any `gateProfiles` example and prose from the flat-array
  form to the attributed-step form; explain `surface` (recorded, convention
  local/structural/product) and `firing` (every-phase | terminal), and that the
  depth (fast/full) convention is removed.
- `docs/cli/reference.md` — update the gate-profile configuration reference to
  the new shape; note the flat-array form is rejected at validation.
- `CLAUDE.md` — if it references gate profiles or the fast/full convention,
  update to the attributed-step model.
- `docs/security.md` — if it describes the gate command frozen set, note that all
  step commands (every-phase and terminal) are covered by the preflight.
- Do not touch archived plans/specs under `docs/plans/archive/` or
  `docs/specs/archive/`; the source spec `docs/specs/15-*.md` is already approved
  and needs no edit.
- Verify Markdown renders (the doc gate step) and no dead links.

### Planned files to create

- (none)

### Planned files to edit

- README.md
- docs/cli/reference.md
- CLAUDE.md

### Optional files that may be edited

- docs/security.md

### Boundary contracts

- (none — documentation only.)

### Test strategy

- No unit/integration tests. Verification is the configured gate profile's
  format/lint steps over the changed Markdown; confirm examples match the current
  `phax.schema.json`.

### Implementation order

README → CLI reference → CLAUDE.md → security doc.

### Excluded scope

- Any code or schema change.
- Regenerating `phax.schema.json` (done in phase-01).

### Verification

- The project's configured gate profile in `phax.json`.

### Expected handoff content

- Which docs were updated and confirmation the examples match the regenerated
  `phax.schema.json`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(gate): document attributed gate-step profiles

### Commit body

Update the README, CLI reference, CLAUDE.md, and security doc to describe gate
profiles as attributed steps carrying surface and firing, the every-phase vs
terminal scheduling, per-phase attribution, run-end surface legibility, and the
removal of the fast/full depth convention.
