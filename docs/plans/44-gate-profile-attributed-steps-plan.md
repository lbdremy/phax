---
status: Approved
source-spec: docs/specs/15-gate-profile-attributed-steps.md
approved:
  date: 2026-08-21
  baseline: 32d9856
---
# Gate Profile as Attributed Steps — implementation plan

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. Source spec:
> [`docs/specs/15-gate-profile-attributed-steps.md`](../specs/15-gate-profile-attributed-steps.md).
> Fully replanned 2026-08-21 against `main` @ `191f024` (original plan July 2026;
> revised for the spec's 2026-08-21 revision, then re-audited seam by seam).

---

## Required commands

- (none)

All gate steps use `pnpm` scripts already present in `package.json`; the plan
introduces no new tool, runtime, or CLI. No `## Required PHAX security
configuration changes` section is needed.

---

## Technical arbitrations

Resolved during the 2026-08-21 spec revision and this replan; recorded so phases
execute without re-litigating them.

- **Surface is a closed enum** (`local | structural | product`), not a free
  label — abandons: a project cannot invent a fourth surface. Accepted: the
  doctrine's three-loop axis is complete, and a free label lets typos degrade
  the attribution silently (spec §9, revised).
- **"Verified" = every step of the surface that ran passed** — abandons:
  per-step granularity in the run-end summary (a half-green surface reads as
  unverified). Accepted: reporting a surface as verified while one of its steps
  failed is the misleading attribution the spec exists to eliminate (spec §5.5).
- **Record manifest v2 with required `verifiedSurfaces`** — abandons: v1 records
  written by 0.9 fail decode. Accepted per phax schema policy (no
  optional-for-old-records shim); the version literal keeps the error legible.
- **Single profile per project; no `--gate-profile` selector** — abandons:
  per-run depth choice. Accepted: firing carries the cadence, and the fast/full
  "choice" was never operator-selectable anyway (phax auto-preferred `full`).
- **The dogfood profile keeps the key `full` when fast/full collapse** —
  abandons: naming clarity (the name no longer means "the deeper of two").
  Accepted: this run is self-hosted; `runStatus.gateProfileId` and any config
  re-read key off the name, so renaming mid-run risks resolution misses. A
  rename to `standard` is a trivial follow-up commit after the run lands.

## Context

Today a gate profile is a flat array of command strings
(`Record<string, NonEmptyArray<NonEmptyString>>` in
`src/schemas/phaxConfig.ts`), and the "depth" dial is a naming convention over
profile keys: `pickGateProfileId` in `src/cli/commands/run.ts` prefers `full`,
then `fast`, then the first key (mirrored in `src/cli/commands/resume.ts` and
`src/app/dryRun.ts`). Every step of the selected profile runs at **every** phase
gate — there is no terminal-vs-every-phase distinction — and phax records only
the profile *id*, never which surfaces were verified.

Spec 15 (revised 2026-08-21) replaces this with a profile that is a named set of
**attributed steps**, each carrying two explicit dimensions:

- **surface** — a closed enum `local | structural | product`. Pure
  **attribution**: phax records it and never branches on it.
- **firing** — `every-phase | terminal`. **Behavioral**: phax schedules on it.

The depth scalar is removed, per-phase attribution is recorded, the phase's run
record carries it (manifest v2 names the verified surfaces — the run records
shipped in 0.9 are the attribution's first live consumer), and the set of
verified surfaces is legible at run end. Per phax schema policy there is **no
back-compat shim**: a profile entry still in the old flat-array form is rejected
at validation, naming the profile.

**Self-hosting caveat.** This run migrates phax's own `phax.json` to the new
shape in phase-01 while being executed by a pre-change phax binary. Within one
run this is safe (config and gate commands are loaded once, before the phase
loop), but `phax resume` with the old binary against a post-phase-01 run will
fail config decode. If the run pauses after phase-01, resume with the built
branch (`pnpm dev resume …`), not the installed binary.

### Architecture seams (audited 2026-08-21 against `main` @ `191f024`)

- Schema: `NonEmptyCommandArray` (`src/schemas/phaxConfig.ts:45`) feeds
  `GateProfilesSchema` (`:47-50`) **and** `commands.setup`/`cleanup`
  (`:121-122`, `:202-203` in the user overlay) — it must stay for the latter.
  `GateProfilesSchema` is used at `:56` (**workspaces** — workspace overlays
  carry the same profile shape, so they migrate with it), `:135` (project
  config, required), `:216` (user overlay). Decoders set
  `onExcessProperty: "error"` at `:181` and `:223`.
- Resolution: `resolveGateProfile` (`src/app/gates.ts:13-30`, workspace override
  branch first) returns the raw command list; `runGates` (`:41` onward) executes
  via the `Shell` port (`parseCommandTokens` `:32-39`) and writes
  `checks-attempt-NN.log` via the `FileSystem` port;
  `recordGateProfileInRunStatus` (`:82`) persists the profile *id* only —
  unaffected.
- Fix loop: `RunGatesWithFixLoopOptions.commands` (`src/app/fixLoop.ts:58-59`);
  `runGatesWithFixLoop` (`:79`) calls `runGates` at `:155`. The second
  `runGates` caller is `adaptGateRun` (`src/app/eventAdapter.ts:144-151`).
- Orchestration (`src/app/executePlan.ts`, 1619 lines): resolves once at
  `:400-402` into `gateCommands`; that value feeds the security preflight and
  posture at `:417`, `:710`, `:926`
  (`src/domain/security/agentCommands.ts` consumes `string[]`); the prompt reads
  `config.raw.gateProfiles[gateProfileId]?.flat(1) ?? []` at `:856-863`; the
  gate is invoked per phase via `runGatesWithFixLoop` at `:1095-1096`; the sole
  terminal test is `const isFinal = i === plan.phases.length - 1;` (`:606`,
  used again at `:1311`). Per-phase records are written by `writeRecordForPhase`
  (`:288-310`), which already passes `phaseFolderPath` into `writeRecord` —
  phase-05 needs no new threading.
- Depth selection: `pickGateProfileId` (`src/cli/commands/run.ts:65-73`, used at
  `:196-197`), `src/cli/commands/resume.ts:184-193`
  (`runStatus.gateProfileId ??` fallback), `src/app/dryRun.ts:44`
  (`?? "full"` default).
- Generators: `src/domain/init/buildConfig.ts:24`
  (`gateProfiles: { fast: commandList }`) and `src/app/initProject.ts:71`. The
  init wizard delegates to `buildPhaxConfig`
  (`src/app/initWizard.ts:13`) and emits no profiles itself.
- JSON schemas: `phax.schema.json` / `phax.user.schema.json` are generated from
  the Effect schemas via `getPhaxConfigJsonSchema` /
  `getPhaxUserOverlayJsonSchema` (`src/app/initProject.ts:3,31-58`).
- Reporting: `src/app/finalReport.ts:218-228` renders `## Run Summary` (the
  `Gate Profile` line is `:225`). **No finalReport test file exists today** —
  phase-04 creates one.
- Records (shipped 0.9): `RunRecordManifestSchema`
  (`src/schemas/runRecord.ts`, `version: Schema.Literal(1)`, no gate fields);
  `assembleRecord` (`src/domain/records/assemble.ts`) carries **every**
  phase-folder file as record artifacts — so `gate-attribution.json` rides the
  record with no records-side change; `writeRecord` (`src/app/writeRecord.ts`,
  `WriteRecordInput.phaseFolderPath`); renderers `src/app/recordsList.ts`,
  `src/app/recordsExplain.ts`.
- No `surface`/`attribution` concept exists anywhere today; `src/domain/gate/`
  does not exist yet.

### Design decisions carried into the phases

- The canonical `GateStep` type is **schema-derived**: `GateStepSchema`,
  `SurfaceSchema`, and their types live in `src/schemas/phaxConfig.ts`; pure
  domain helpers `import type` them (consistent with
  `src/domain/config/mergeLayers.ts` and `src/domain/init/buildConfig.ts`,
  which already `import type` from `schemas/phaxConfig.js` — allowed by
  `pnpm audit:architecture`).
- Behavioral (`firing`) vs attribution (`surface`) split is honored strictly:
  only `firing` changes scheduling; `surface` is recorded and never branched on.
- The security preflight/posture and the agent prompt keep consuming **command
  strings** (`steps.map(s => s.command)`); only the gate runner learns the step
  objects. The frozen effective set includes every step's command regardless of
  firing.
- One definition of "verified" — a pure domain helper shared by the final
  report (phase-04) and the record manifest (phase-05).

---

## phase-01 — Attributed gate-step schema and profile resolution {#phase-01-attributed-step-schema}

**Recommended model:** claude-opus-4-8
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
  - Add `export const SurfaceSchema = Schema.Literal("local", "structural",
    "product");` and `export type Surface = Schema.Schema.Type<typeof
    SurfaceSchema>;` — exported: phase-03/05 schemas reuse it as the single
    source of the enum.
  - Add `const GateStepSchema = Schema.Struct({ command: Schema.NonEmptyString,
    surface: SurfaceSchema, firing: FiringSchema });` and
    `export type GateStep = Schema.Schema.Type<typeof GateStepSchema>;`.
  - Change `GateProfilesSchema` (`:47-50`) value from `NonEmptyCommandArray` to
    `Schema.NonEmptyArray(GateStepSchema)`. **Keep** `NonEmptyCommandArray` —
    it still backs `commands.setup`/`cleanup` (`:121-122`, `:202-203`).
  - This one change migrates all three carriers at once — workspaces (`:56`),
    project config (`:135`), user overlay (`:216`) — confirm workspace-level
    `gateProfiles` decode the new shape too.
  - Keep `onExcessProperty: "error"` (`:181`, `:223`) so an unknown step key is
    rejected. Confirm the decode error for a flat-array entry surfaces the
    profile key in its path (e.g. `gateProfiles.full[0]`); if the default
    message is not legible, add a decode-error mapping that names the offending
    profile.
- **Resolution** (`src/app/gates.ts`):
  - Change `resolveGateProfile` (`:13-30`) return type to `readonly GateStep[]`
    (workspace override branch unchanged in logic).
  - Change `runGates` (`:41`) to accept `steps: readonly GateStep[]`; execute
    `parseCommandTokens(step.command)`; log `$ ${step.command}` and the exit as
    today. Do **not** yet record surface/firing — behavior is identical.
- **Orchestration** (`src/app/executePlan.ts`):
  - `:400-402` — `const gateSteps: readonly GateStep[] =
    resolveGateProfile(...)`. Derive
    `const gateCommandStrings = gateSteps.map((s) => s.command);` and feed
    `gateCommandStrings` into the security preflight/posture consumers (`:417`,
    `:710`, `:926`). Pass `gateSteps` into `runGatesWithFixLoop`
    (`:1095-1096`).
  - `:856-863` — replace `config.raw.gateProfiles[gateProfileId]?.flat(1) ?? []`
    with `(config.raw.gateProfiles[gateProfileId] ?? []).map((s) => s.command)`.
- **Fix loop** (`src/app/fixLoop.ts`): change
  `RunGatesWithFixLoopOptions.commands` (`:58-59`) to
  `steps: readonly GateStep[]`; pass `steps` to `runGates` (`:155`).
- **Event adapter** (`src/app/eventAdapter.ts`): change `adaptGateRun`'s first
  param (`:144`) to `steps: readonly GateStep[]`; pass through to `runGates`
  (`:151`).
- **Dry run** (`src/app/dryRun.ts`): `resolveGateProfile` now returns steps;
  keep `report.gateCommands` as `string[]` by mapping
  `steps.map((s) => s.command)` for display. Change the `?? "full"` default
  (`:44`) to the first profile key.
- **Remove the depth scalar** (§5.1):
  - `run.ts` `pickGateProfileId` (`:65-73`) — drop the `"full"`/`"fast"`
    preference; select the sole profile (`Object.keys(profiles)[0] ?? null`),
    still erroring when none. A project is expected to define one profile;
    multi-profile disambiguation is out of scope (see Excluded scope).
  - `resume.ts:184-193` — keep the persisted `runStatus.gateProfileId`
    fallback; replace the `full`/`fast` branches with the same first-key
    selection.
- **Generators**:
  - `src/domain/init/buildConfig.ts:24` — wrap each collected command as
    `{ command, surface: "local", firing: "every-phase" }` under a single
    profile key (keep the existing key to avoid touching wizard tests beyond
    the shape; the wizard delegates here and needs no direct edit).
  - `src/app/initProject.ts:71` — same wrapping for the non-wizard generated
    config.
- **Config fixtures / dogfood config** — migrate to attributed steps:
  - `phax.json` (repo root) — drop `fast`; keep the key **`full`** (see
    Technical arbitrations) holding, in current `full` order:
    `pnpm format` / `pnpm typecheck` / `pnpm test:type` / `pnpm lint` /
    `pnpm format:check` / `pnpm test` — `local`, `every-phase`;
    `pnpm knip` / `pnpm audit:architecture` /
    `pnpm gen:model-catalog --check` — `structural`, `every-phase`;
    `pnpm build` / `pnpm deno:smoke` / `pnpm deno:smoke-binary` — `product`,
    `terminal`.
  - `examples/hello-world/phax.json` — collapse `fast`+`full` into one
    `standard` profile: typecheck + test `local`/`every-phase`, build
    `product`/`terminal`.
  - `tests/e2e/fixtures/minimal-repo/phax.json` — keep the `minimal` key; wrap
    `node --version` as `local`/`every-phase`.
- **Regenerate** `phax.schema.json` and `phax.user.schema.json` from the updated
  Effect schemas (generation path: `getPhaxConfigJsonSchema` /
  `getPhaxUserOverlayJsonSchema`, `src/app/initProject.ts:31-58`). Do not
  hand-edit the generated JSON.
- **Tests** — update every fixture/assertion that constructs a profile as a
  string array to the attributed-step shape: `tests/unit/gateProfile.test.ts`,
  `tests/integration/gates.test.ts`, `tests/integration/fixLoop.test.ts`,
  `tests/integration/eventAdapter.test.ts`,
  `tests/integration/executePlan.test.ts`, `tests/unit/dryRun.test.ts`,
  `tests/unit/cli/run.test.ts`. Add:
  - a decode test asserting a flat-array profile entry is **rejected** and the
    error names the profile (§6, §9);
  - a decode test asserting a step whose surface is outside
    `local | structural | product` is rejected (closed enum, §5.2);
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

- src/app/initWizard.ts
- src/app/promptGeneration.ts
- src/domain/init/buildConfig.test.ts
- tests/unit/architecturalGuards.test.ts

### Boundary contracts

- **Config → gate runner.** Consumer (`runGates`) needs an ordered list of
  executable commands plus, later, their attributes; producer
  (`resolveGateProfile`) provides `readonly GateStep[]`. Stable shape:
  `{ command: string; surface: "local" | "structural" | "product";
  firing: "every-phase" | "terminal" }`.
- **Gate steps → security/prompt.** Consumers (`checkRequiredCommands`, security
  posture, prompt) need only command **strings**; the producer maps
  `steps.map(s => s.command)`. The frozen effective set must include **every**
  step's command regardless of firing (terminal steps still run at the last
  phase).

### Test strategy

- Schema decode/reject: unit tests on the config decoders (write the
  reject-flat-array, reject-unknown-surface, and profile-naming assertions
  **before** the schema edit — stable contract).
- `resolveGateProfile` / `pickGateProfileId`: unit tests (selection logic,
  including the workspace override returning attributed steps).
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
- Verified surfaces in the run record — phase-05.
- User-facing docs — phase-06.
- Multi-profile disambiguation / a `--gate-profile` selector — not in this plan;
  a project defines one profile and firing carries the cadence.
- Renaming the dogfood profile key (`full` → `standard`) — deliberate follow-up
  after the run lands (see Technical arbitrations).

### Verification

- The project's configured gate profile in `phax.json` (`full` — migrated to
  attributed steps by this very phase; the run's frozen command set was taken
  at run start and is unchanged in content).

### Expected handoff content

- The exact new symbols and their module: `GateStepSchema`, `FiringSchema`,
  `SurfaceSchema`, `type GateStep`, `type Firing`, `type Surface` in
  `src/schemas/phaxConfig.ts`.
- The new `resolveGateProfile` return type and `runGates` signature
  (`steps: readonly GateStep[]`).
- Where command strings are still derived (`steps.map(s => s.command)`) for
  security/prompt, so phase-02/03 do not re-derive incorrectly.
- Confirmation the `full`/`fast` depth preference is removed, and that the
  dogfood `phax.json` kept the `full` key while the example collapsed to
  `standard`.
- Any deviation from the planned file lists, with the reason (e.g. an extra test
  fixture that referenced the old shape).

### Commit subject

feat(gate): model gate profiles as attributed steps

### Commit body

Replace the flat command-string gate profile with a named set of attributed
steps { command, surface, firing } and thread GateStep objects from config
resolution through the gate runner (executing step.command). Surface is a
closed enum (local | structural | product). Remove the fast/full depth-scalar
selection and reject the old flat-array form at validation, naming the
profile — no back-compat shim, per phax schema policy. Behavior is otherwise
unchanged: surface and firing are carried but not yet acted upon. Migrate the
dogfood config, example, and e2e fixture to the new shape and regenerate the
JSON schemas.

---

## phase-02 — Firing: every-phase vs terminal scheduling {#phase-02-firing-scheduling}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Make `firing` behavioral: before the terminal phase, run only the profile's
`every-phase` steps; at the terminal phase, additionally run the `terminal`
steps.

### Detailed instructions

- Create a pure domain helper `src/domain/gate/selectSteps.ts` exporting
  `selectGateSteps(steps: readonly GateStep[], isTerminal: boolean): readonly GateStep[]`
  that returns every `every-phase` step, plus every `terminal` step when
  `isTerminal` is true
  (`import type { GateStep } from "../../schemas/phaxConfig.js"`). Preserve
  input order.
- In `src/app/executePlan.ts`, inside the phase loop, compute
  `const phaseSteps = selectGateSteps(gateSteps, isFinal);` (using the existing
  `isFinal` at `:606`) and pass `phaseSteps` — not the full `gateSteps` — into
  `runGatesWithFixLoop` (`:1095-1096`).
- Keep the **security preflight/posture over the full step set**
  (`gateCommandStrings` from phase-01, consumers at `:417`, `:710`, `:926`) —
  terminal steps still execute at the last phase, so their commands must remain
  in the frozen effective set. Do not filter the preflight by firing.
- Optional: refine the agent prompt (`src/app/promptGeneration.ts`) so a
  non-terminal phase lists the every-phase gates it must pass and notes that
  terminal gates run at the final phase. Keep this light; do not change prompt
  structure.

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
  from the boolean `isTerminal` only. phax schedules on `firing` and nothing
  else.

### Test strategy

- `selectGateSteps`: unit tests (pure domain) — write **before**
  implementation: non-terminal returns every-phase only; terminal returns
  every-phase + terminal; order preserved; all-every-phase and all-terminal
  edge cases.
- executePlan integration: a profile with one every-phase and one terminal step
  runs only the every-phase step at a non-terminal phase gate and both at the
  terminal phase gate (§5.3 acceptance).

### Implementation order

`selectGateSteps` (+ unit tests) → wire into `executePlan` → integration test.

### Excluded scope

- Recording which steps ran (attribution) — phase-03.
- Any behavior keyed on `surface`.

### Verification

- The project's configured gate profile in `phax.json` (`full`).

### Expected handoff content

- The `selectGateSteps` signature and module path.
- Confirmation the security preflight still covers terminal-step commands
  (frozen set unchanged), and that only the gate invocation is filtered.
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

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

When a phase gate completes, record which steps ran and, for each, its surface
and result (§5.4). Fail-fast semantics are preserved: the record lists the steps
that actually ran up to and including the first failing one.

### Detailed instructions

- Add an attribution schema `src/schemas/gateAttribution.ts`:
  - `GateStepResultSchema = Schema.Struct({ command: NonEmptyString, surface:
    SurfaceSchema, result: Schema.Literal("pass", "fail") })` — import
    `SurfaceSchema` from `./phaxConfig.js`; one source of truth for the enum.
  - `GateAttributionSchema = Schema.Struct({ phase: NonEmptyString, steps:
    Schema.Array(GateStepResultSchema) })` with `decode`/`encode` helpers,
    following the pattern in `src/schemas/status.ts`.
- In `src/app/gates.ts` `runGates`:
  - Accept an attribution target: refactor the signature to an options object
    `{ steps, cwd, attemptLogPath, attributionPath?, phaseId? }` to avoid a
    long positional list; update both callers (`src/app/fixLoop.ts:155`,
    `src/app/eventAdapter.ts:151`).
  - Accumulate a `GateStepResult` per executed step (`pass` on exit 0). On the
    first non-zero exit, push a `fail` result for that step and stop
    (fail-fast, as today).
  - When `attributionPath`/`phaseId` are provided, write the attribution record
    via the `FileSystem` port on **both** the success and failure paths
    (symmetric with how `attemptLogPath` is already written), so the on-disk
    record reflects the steps that ran this attempt. The fix loop overwrites
    the same per-phase path each attempt, so the final file reflects the last
    (passing or exhausted) evaluation.
- In `src/app/fixLoop.ts`, pass
  `attributionPath = join(phaseFolderPath, "gate-attribution.json")` and
  `phaseId` into `runGates`.
- In `src/app/eventAdapter.ts` `adaptGateRun`, thread the same options through
  (or leave attribution unset where the call site owns no phase folder — decide
  by whether one is available; document the choice in the handoff).
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
  `gate-attribution.json` per phase via the `FileSystem` port; consumers are
  phase-04 (final report) and phase-05 (record manifest — note the file itself
  already rides the phase's run record automatically, since `assembleRecord`
  carries every phase-folder artifact). Stable shape:
  `{ phase, steps: [{ command, surface, result }] }` (fields normative;
  filename indicative).

### Test strategy

- Schema round-trip: unit test on `GateAttributionSchema` decode/encode,
  including rejection of a surface outside the enum.
- `runGates` attribution: integration tests — a passing profile records every
  run step as `pass` with its surface; a profile whose second step fails
  records the first as `pass`, the second as `fail`, and no steps after it
  (fail-fast, §5.4).
- Fix loop overwrite: the record reflects the final attempt.

### Implementation order

Attribution schema (+ unit test) → `runGates` options-object refactor +
accumulation + write → fix loop / event adapter wiring → integration tests.

### Excluded scope

- Aggregating surfaces across phases for the run-end summary — phase-04.
- Carrying verified surfaces into the run record manifest — phase-05.
- Any change to gate pass/fail semantics (still fail-fast on first non-zero
  exit).

### Verification

- The project's configured gate profile in `phax.json` (`full`).

### Expected handoff content

- The `gate-attribution.json` path (`<runPath>/<phaseId>/gate-attribution.json`)
  and the exact record shape, so phase-04/05 can read it.
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
the GateAttribution schema; the artifact automatically rides the phase's run
record.

---

## phase-04 — Run-end surface legibility {#phase-04-run-end-surfaces}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

When a run completes, report the set of surfaces that were verified during the
run (§5.5).

### Detailed instructions

- Add a pure domain helper `src/domain/gate/verifiedSurfaces.ts` exporting
  `verifiedSurfaces(record: GateAttribution): readonly Surface[]` — the
  surfaces where at least one step ran and **every** step of that surface that
  ran has `result: "pass"` (spec §5.5: a surface with any failing step is not
  verified). Sorted, deduped. Phase-05 reuses this exact helper for the record
  manifest — one definition of "verified".
- Add `src/app/gateAttribution.ts` (app layer) with a reader/aggregator that,
  given a run path and its phase ids, reads each phase's
  `gate-attribution.json` via the `FileSystem` port, applies
  `verifiedSurfaces` per record, and unions the result across phases.
  Missing/unreadable records are skipped (a phase may have been reset); never
  throw on absence.
- In `src/app/finalReport.ts`, render the verified-surface set in the
  `## Run Summary` section near the `Gate Profile` line (`:218-228`), e.g.
  `- **Surfaces Verified**: local, product` (presence normative; exact
  rendering indicative). Render an explicit empty state
  (`(none)`) when no attribution records exist, so a run that exercised no
  surfaces is visible rather than hidden (§3). Locate the call site that
  assembles the report's info and invoke the aggregator there — keep
  `finalReport.ts` itself a pure renderer if that is its current shape.
- Keep this read-only: the final report already runs at review time; no new
  port is introduced.

### Planned files to create

- src/domain/gate/verifiedSurfaces.ts
- src/app/gateAttribution.ts
- tests/unit/verifiedSurfaces.test.ts
- tests/unit/gateAttribution.reader.test.ts
- tests/integration/finalReport.test.ts

### Planned files to edit

- src/app/finalReport.ts

### Optional files that may be edited

- src/app/executePlan.ts
- src/app/reviewCode.ts

### Boundary contracts

- **Phase attribution records → run summary.** Consumer (`finalReport`) needs
  the aggregate set of verified surfaces; producer (the `gateAttribution`
  reader) derives it from the per-phase records via the pure
  `verifiedSurfaces` helper. phax does not interpret surface labels beyond set
  membership.

### Test strategy

- `verifiedSurfaces` unit tests (pure domain, write **before**
  implementation): all-pass surface is verified; a surface with any `fail` —
  even alongside passes — is not; a surface that never ran is absent; output
  sorted and deduped.
- Reader unit tests (with FileSystem fake): unions across phases; missing files
  are skipped; empty input yields an empty set.
- finalReport integration (new file — none exists today): a completed run with
  local+product passing steps renders the verified surfaces line; a run with no
  records renders the empty state (§5.5 acceptance).

### Implementation order

`verifiedSurfaces` (+ unit tests) → reader/aggregator (+ unit tests) →
finalReport rendering → integration test.

### Excluded scope

- Any live/streamed surface output during the run (the run-end report is the
  legibility surface).
- Changing how attribution is recorded — that is phase-03.
- The record manifest field — phase-05.

### Verification

- The project's configured gate profile in `phax.json` (`full`).

### Expected handoff content

- The pure `verifiedSurfaces` helper's module path and signature (phase-05
  depends on it), the reader's signature, and the exact final-report line
  format (including the empty state).
- Where the aggregator is invoked (the report-info assembly site).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(gate): report verified surfaces at run end

### Commit body

Aggregate the per-phase gate attribution records into the set of surfaces
verified during the run and render it in the final report's run summary. A
surface counts as verified only when every step of it that ran passed; a run
that exercised no surfaces renders an explicit empty state so unverified
surfaces are visible rather than hidden. The per-record derivation is a pure
domain helper reused by the record manifest in phase-05.

---

## phase-05 — Verified surfaces in the run record {#phase-05-record-surfaces}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Give the surface attribution its first cross-run consumer: the per-phase run
record (spec 29, shipped in 0.9). The `gate-attribution.json` artifact already
rides the record for free — `assembleRecord` carries every phase-folder file —
so this phase adds only the queryable dimension: the record manifest names the
phase's verified surfaces.

### Detailed instructions

- `src/schemas/runRecord.ts` — add
  `verifiedSurfaces: Schema.Array(SurfaceSchema)` (imported from
  `./phaxConfig.js`) to `RunRecordManifestSchema`, and bump
  `version: Schema.Literal(1)` to `Schema.Literal(2)`. The field is
  **required** — no optional-for-existing-records shim, per phax schema policy;
  v1 records fail decode by design and the version literal keeps the error
  legible.
- `src/domain/records/assemble.ts` — extend `AssembleRecordInput` with
  `verifiedSurfaces: readonly Surface[]` and copy it into the manifest
  (`version: 2`). Assembly stays pure; the caller computes the value.
- `src/app/writeRecord.ts` — before calling `assembleRecord`, read
  `gate-attribution.json` from the already-supplied
  `WriteRecordInput.phaseFolderPath` via the `FileSystem` port; when present
  and decodable, derive the set with the pure `verifiedSurfaces` helper from
  phase-04; when absent or undecodable (gate never ran, phase failed before
  the gate), pass `[]`. Never fail the record write over the attribution file.
- `src/app/recordsList.ts` — render the manifest field in the listing (e.g. a
  surfaces column: `local,structural`, or `-` when empty).
- `src/app/recordsExplain.ts` — render the verified surfaces in the explain
  output and note the attribution artifact when present.

### Planned files to create

- (none)

### Planned files to edit

- src/schemas/runRecord.ts
- src/domain/records/assemble.ts
- src/app/writeRecord.ts
- src/app/recordsList.ts
- src/app/recordsExplain.ts
- tests/unit/runRecord.test.ts
- tests/unit/recordsAssemble.test.ts
- tests/integration/writeRecord.test.ts
- tests/integration/recordsExplain.test.ts

### Optional files that may be edited

- tests/integration/recordsPush.test.ts
- src/app/executePlan.ts

### Boundary contracts

- **Attribution record → record manifest.** Producer (`writeRecord`) derives
  `verifiedSurfaces` from the phase's `gate-attribution.json` using the same
  pure helper as the final report — one definition of "verified"; consumers
  (records list/explain, cross-run queries) read it from the manifest without
  opening artifacts. Stable shape: `verifiedSurfaces: readonly ("local" |
  "structural" | "product")[]`, sorted, deduped.

### Test strategy

- Manifest schema unit tests: a v2 manifest with `verifiedSurfaces`
  round-trips; a v1 manifest (no field) fails decode.
- `assembleRecord` unit test: the field is copied verbatim into the manifest.
- `writeRecord` integration: a phase folder with a passing attribution record
  yields a manifest naming its surfaces; a folder without one yields `[]`; a
  corrupt attribution file does not fail the write.
- recordsList / recordsExplain integration: the surfaces render.

### Implementation order

Schema (+ unit tests) → `assembleRecord` → `writeRecord` derivation →
list/explain rendering → integration tests.

### Excluded scope

- Any run-level aggregation inside records (the manifest is per-phase;
  run-level legibility is phase-04's final report).
- Migration tooling for v1 records — none, per schema policy.

### Verification

- The project's configured gate profile in `phax.json` (`full`).

### Expected handoff content

- The final `RunRecordManifestSchema` shape and version literal.
- Where `writeRecord` reads the attribution file and the fallback behavior.
- Confirmation list/explain render the field, with sample output lines.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): name verified surfaces in the phase record manifest

### Commit body

Bump the run-record manifest to version 2 with a required verifiedSurfaces
field derived from the phase's gate-attribution.json at write time, using the
same verified-surface semantics as the final report (every executed step of
the surface passed). The attribution artifact itself already rides the record;
the manifest field makes surface coverage queryable across runs without
opening artifacts. Records list and explain render the new field.

---

## phase-06 — Documentation and reference {#phase-06-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Update user-facing documentation to describe the attributed-step profile shape,
the two dimensions, firing scheduling, per-phase attribution, and run-end
surface legibility. No code changes.

### Detailed instructions

- `README.md` — update any `gateProfiles` example and prose from the flat-array
  form to the attributed-step form; explain `surface` (closed enum
  local | structural | product, attribution only) and `firing`
  (every-phase | terminal), and that the depth (fast/full) convention is
  removed.
- `docs/cli/reference.md` — update the gate-profile configuration reference to
  the new shape; note the flat-array form is rejected at validation, and that
  `records list` / `records explain` show the phase's verified surfaces
  (record manifest v2).
- `CLAUDE.md` — only if it references gate profiles or the fast/full
  convention; today it does not appear to.
- `docs/security.md` — if it describes the gate command frozen set, note that
  all step commands (every-phase and terminal) are covered by the preflight.
- Do not touch archived plans/specs under `docs/plans/archive/` or
  `docs/specs/archive/`; the source spec `docs/specs/15-*.md` was revised
  2026-08-21 and needs no edit.
- Verify Markdown renders and no dead links.

### Planned files to create

- (none)

### Planned files to edit

- README.md
- docs/cli/reference.md

### Optional files that may be edited

- CLAUDE.md
- docs/security.md

### Boundary contracts

- (none — documentation only.)

### Test strategy

- No unit/integration tests. Verification is the configured gate profile's
  format/lint steps over the changed Markdown; confirm examples match the
  regenerated `phax.schema.json`.

### Implementation order

README → CLI reference → security doc.

### Excluded scope

- Any code or schema change.
- Regenerating `phax.schema.json` (done in phase-01).

### Verification

- The project's configured gate profile in `phax.json` (`full`).

### Expected handoff content

- Which docs were updated and confirmation the examples match the regenerated
  `phax.schema.json`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(gate): document attributed gate-step profiles

### Commit body

Update the README and CLI reference to describe gate profiles as attributed
steps carrying surface (closed enum) and firing, the every-phase vs terminal
scheduling, per-phase attribution, run-end surface legibility, the verified
surfaces in record manifests, and the removal of the fast/full depth
convention.
