# Plan — Agent-binding architecture hardening

Follow-up to plan 11 (`11-lock-agent-binding-phase-plan.md`), which shipped the
per-phase `PhaseAgentBinding`. A review of that work surfaced three structural
findings that were deliberately deferred out of the original run. This plan
closes them. The small display/dead-code findings from the same review were
already fixed directly on the `phax/agent-binding--phase-06` branch
(commit `refactor(binding): drop legacy binding inference …`) and are **not** in
scope here.

## Scope

Three findings, one phase each:

| # | Finding | Phase |
| - | ------- | ----- |
| 2 | The CLI drives the infra session adapters and `spawnSync` directly as plain functions, bypassing the port/Effect system; the pure adapter dispatch lives in `infra/` and is imported by `cli/`. | phase-01 |
| 1 | `src/infra/providers/sessionWriter.ts` imports `patchAgentBindingSession` from `src/app/` — the only `infra → app` edge in the repo, an inverted dependency arrow. | phase-02 |
| 4 | The binding `status` union has six values but only `launching` and `running` are ever written; `awaiting_manual_review`, `failed`, `completed`, `archived` are dead, so `session-info` effectively always prints `running`. | phase-03 |

The architecture today is `cli → app → domain ← ports ← infra` (enforced in part
by `tests/unit/architecturalGuards.test.ts`). These phases move the session
adapters to where that rule wants them and restore the dependency direction.

## Required commands

- (none)

No new tool, runtime, or CLI is introduced. Every phase is verified through the
existing `phax.json` `full` gate profile.

## Constraints and verification notes

- The `full` gate runs `pnpm knip`, `pnpm typecheck`, `pnpm build`, `pnpm lint`,
  `pnpm test`, and `pnpm audit:architecture` — these mechanically verify the
  moves (no dead exports, no broken imports, boundaries intact).
- `tests/unit/architecturalGuards.test.ts` is itself part of the gate. Phase-01
  may extend it (a `cli → infra` adapter-import guard) and phase-02 will rely on
  it staying green after the `infra → app` edge is removed.
- Provider-binary spawns are guarded by `SPAWN_PATTERN` (literal `spawn("claude"
  …)`); the session layer spawns via a variable executable, like
  `src/infra/editor.ts`, so it does not trip the guard.

---

## phase-01 — SessionPort and pure adapter dispatch in domain {#phase-01-session-port}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Route interactive session resume through a real port, and move the pure adapter
dispatch into `domain/` so the CLI no longer reaches into `infra/` for plain
functions. After this phase, `enter` / `enter-phase` run an Effect program that
yields a `Session` service, mirroring how `open` uses `Editor`.

### Detailed instructions

- Create `src/domain/session/` and move the **pure** adapter code there from
  `src/infra/sessionAdapters/`:
  - `types.ts` → `src/domain/session/types.ts` (`SessionAdapter`,
    `ResumeInvocation`).
  - `claude.ts`, `codex.ts`, `mistral.ts` → `src/domain/session/`.
  - The `getSessionAdapter(provider)` switch → `src/domain/session/index.ts`.
  These modules import only `ProviderId` and the binding type; they do no I/O, so
  they belong in `domain/` next to `domain/routing/`.
- Add a port `src/ports/session.ts` mirroring `src/ports/editor.ts`:
  - `SessionError` (`Data.TaggedError`),
  - `SessionOps` with `resume(invocation: { executable: string; args: readonly
    string[]; cwd: string }): Effect.Effect<number, SessionError>`,
  - `Session` (`Context.Tag("phax/Session")`).
- Add `src/infra/session.ts` with `makeNodeSessionLayer(): Layer.Layer<Session>`
  implementing `resume` with the `spawnSync(executable, [...args], { cwd, stdio:
  "inherit" })` logic currently in `spawnInteractive`. Map a spawn `error` to
  `SessionError`; return `result.status ?? 0` otherwise. This mirrors
  `src/infra/editor.ts`.
- Delete `spawnInteractive` and the old `src/infra/sessionAdapters/` directory
  once nothing imports them.
- Rewire `src/cli/commands/enter.ts` and `src/cli/commands/enterPhase.ts`:
  - import `getSessionAdapter` from `../../domain/session/index.js`,
  - build the invocation with the pure adapter; if `"unsupported" in invocation`,
    `out.error(invocation.unsupported)` and return 1 (no port needed),
  - otherwise run `Effect.gen(function* () { const s = yield* Session; return
    yield* s.resume(invocation); }).pipe(Effect.provide(makeNodeSessionLayer()))`
    via `Effect.runPromise(Effect.either(...))`, mapping `Left` to an error log +
    exit 1, like `runOpen` in `src/cli/commands/open.ts`.
- Update `src/cli/commands/sessionInfo.ts` to import `getSessionAdapter` from
  `../../domain/session/index.js` (it already calls the pure dispatch for its
  resume-support check; only the import path changes).
- Optionally add a guard to `tests/unit/architecturalGuards.test.ts` asserting no
  `src/cli/**` file imports from `src/infra/sessionAdapters` (now gone) or calls a
  bare session spawn — keep it consistent with the existing guards' style.

### Planned files to create

- `src/domain/session/types.ts`
- `src/domain/session/claude.ts`
- `src/domain/session/codex.ts`
- `src/domain/session/mistral.ts`
- `src/domain/session/index.ts`
- `src/ports/session.ts`
- `src/infra/session.ts`

### Planned files to edit

- `src/cli/commands/enter.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/commands/sessionInfo.ts`
- `tests/unit/sessionAdapters.test.ts`
- `tests/integration/enter.test.ts`
- `tests/integration/enterPhase.test.ts`

### Optional files that may be edited

- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/sessionInfo.test.ts`

### Boundary contracts

- **CLI → Session port:** `enter`/`enter-phase` need "resume this invocation
  interactively and give me the exit code." The port provides
  `resume(invocation) → Effect<number, SessionError>`. The CLI owns the
  `unsupported` decision (pure, pre-port); the port owns only the spawn.
- **CLI → domain session dispatch:** `getSessionAdapter(provider)` is a pure
  total function over `ProviderId`; the CLI depends on it the same way it depends
  on `domain/routing`.

### Test strategy

- Adapter argv / `unsupported` messages / registry exhaustiveness: keep the
  existing unit coverage, retargeted to `src/domain/session/`
  (`tests/unit/sessionAdapters.test.ts`).
- `enter` / `enter-phase` dispatch + spawn: integration tests already mock
  `node:child_process` `spawnSync`; update them so the mock is exercised through
  the new layer and assert the same `spawnSync("claude", ["--resume", id], …)`
  call and exit codes. Keep the codex-unsupported and no-binding cases.
- Port contract: a type-level check is optional; the integration tests cover the
  behavior.

### Implementation order

Domain adapters → port → infra layer → CLI rewire → tests. Core-to-surface, so
the CLI never references a module that does not yet exist.

### Excluded scope

- Binding-state ownership and the `infra → app` edge (phase-02).
- Status lifecycle (phase-03).
- Any change to codex/mistral resume behavior — they still return `unsupported`.

### Verification

- The project's configured `full` gate profile in `phax.json`. `knip` confirms
  `spawnInteractive` and the old directory are fully removed; `audit:architecture`
  confirms boundaries; integration tests confirm dispatch + spawn.

### Expected handoff content

- The new module paths and the `Session` port shape (`resume` signature,
  `SessionError`).
- That `src/infra/sessionAdapters/` is deleted and `getSessionAdapter` now lives
  at `src/domain/session/index.js`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(session): route interactive resume through a SessionPort

### Commit body

Move the pure session adapters to src/domain/session and add a Session port with
a Node spawn layer, so enter/enter-phase resume through Effect DI instead of
calling infra spawnSync directly. Mirrors the Editor port/layer pattern.

---

## phase-02 — Restore binding-state ownership to the app layer {#phase-02-binding-ownership}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Remove the sole `infra → app` import in the repo. The app/run layer becomes the
single owner of binding mutations; infra stops reaching up into `app/`.

### Detailed instructions

- In `src/infra/providers/sessionWriter.ts`, remove the
  `patchAgentBindingSession` call and its `../../app/agentBinding.js` import.
  `persistSessionId` returns to writing only `session-id.txt` + phase status
  (its documented metadata-writer role).
- Confirm `src/app/executePlan.ts` already patches the binding
  (`launching → running` + captured `sessionId`) on every launch path: it patches
  immediately after `agentResult.sessionId` is captured following
  `backend.runAgent`. This covers real provider CLIs too, because `agentResult`
  carries the captured session. Verify no launch path captures a session without
  reaching that patch; if one exists, move the patch so it always runs.
- Add an integration test that drives a backend which *does* call
  `persistSessionId` (or otherwise simulates the real-provider path) and asserts
  `agent-binding.json` still ends at `status: "running"` with the captured
  `sessionId` — proving the app-layer patch is sufficient without the infra call.
- Fold in the deferred dedup: `writeAtomic` is duplicated in
  `src/app/agentBinding.ts` and `src/infra/providers/sessionWriter.ts`. Extract a
  single helper both can use **without** re-introducing an `infra → app` edge —
  put it in a neutral infra-importable module (e.g. `src/infra/atomicWrite.ts`)
  and have `src/app/agentBinding.ts` import it (app → infra is allowed). Decide
  during the phase whether the dedup is worth the churn; if it would reintroduce a
  bad edge, leave the two copies and note it in the handoff.

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/providers/sessionWriter.ts`
- `tests/integration/executePlan.test.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/app/agentBinding.ts`
- `src/infra/atomicWrite.ts`
- `tests/unit/agentBinding.test.ts`

### Boundary contracts

- **Run/app layer owns binding writes:** every binding mutation
  (`writeAgentBinding`, the session/status patch) originates in `app/`. Infra
  adapters never call into `app/`. The dependency arrow stays
  `app → ports ← infra`.

### Test strategy

- Application/integration: `executePlan.test.ts` with fake and real-ish backends
  to prove the app-layer patch covers the session-capture path. Write the
  real-provider-path assertion before deleting the infra call.
- `audit:architecture` (already in the gate) is the mechanical proof the
  `infra → app` import is gone — optionally add an explicit guard forbidding
  `src/infra/**` from importing `src/app/`.

### Implementation order

Add/confirm the app-layer patch coverage and its test first; then delete the
infra call; then (optionally) dedup `writeAtomic`.

### Excluded scope

- The SessionPort move (phase-01).
- New status values (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`, plus the new
  real-provider-path integration assertion.

### Expected handoff content

- Confirmation the `infra → app` edge is removed and where binding mutations now
  live.
- Whether `writeAtomic` was deduped and where the shared helper lives, or why it
  was left duplicated.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(binding): make the app layer the sole owner of binding writes

### Commit body

Remove the infra → app import in sessionWriter; rely on executePlan's app-layer
patch (which covers the real-provider session-capture path) for the
launching → running transition. Add a regression test and optionally dedup the
atomic-write helper behind an infra module.

---

## phase-03 — Wire the full binding-status lifecycle {#phase-03-status-lifecycle}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the binding `status` field reflect reality. Today it is stuck at `running`;
this phase drives it to the terminal states at the existing state-machine
transitions so `session-info` reports the true lifecycle.

### Detailed instructions

- Add a status-only patch to `src/app/agentBinding.ts`:
  `patchAgentBindingStatus(phaseFolderPath, status: PhaseAgentBinding["status"])`
  — read-modify-write the binding's `status` only (mirrors
  `patchAgentBindingSession`'s atomic read/decode/write and its silent no-op on an
  absent/malformed file).
- Set each terminal status at the matching existing transition in
  `src/app/executePlan.ts`:
  - `completed` — after a **non-final** phase commits (`commitPhase` /
    `committedPhases.push(phase.id)`).
  - `awaiting_manual_review` — when the **final** phase opens review (the
    `FinalReviewOpened` dispatch).
  - `failed` — on the phase-failure path (the error handling that drives a phase
    to `gates_exhausted`/`failed`); patch the binding before the failure
    propagates. Pick the narrowest point that covers agent-invocation and
    gate-exhaustion failures.
- Set `archived` in the archive use-case `src/app/archive.ts`: for each phase
  folder in the run being archived, patch the binding to `archived` (no-op when a
  phase has no binding).
- Do not create a second source of truth: patch alongside the existing status
  transitions, keeping `src/domain/state.ts` as the authority for `PhaseState`;
  the binding `status` is a derived projection updated at the same points.
- `src/cli/commands/sessionInfo.ts` already renders `Binding status:` — no change
  needed beyond confirming the new values display. Extend its integration tests to
  assert terminal statuses.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/agentBinding.ts`
- `src/app/executePlan.ts`
- `src/app/archive.ts`
- `tests/unit/agentBinding.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/sessionInfo.test.ts`

### Optional files that may be edited

- `tests/integration/archive.test.ts`

### Boundary contracts

- **Binding status mirrors phase state:** the binding `status` is updated only at
  the points where `PhaseState`/`RunState` already transition. No new state
  authority is introduced; `src/domain/state.ts` remains canonical.

### Test strategy

- Application/unit: `agentBinding.test.ts` for `patchAgentBindingStatus`
  (round-trip + absent-file no-op), written before wiring.
- Integration: `executePlan.test.ts` asserts `completed` after a non-final commit
  and `awaiting_manual_review` for the final phase; a failure-path test asserts
  `failed`. `archive.test.ts` (or `sessionInfo.test.ts`) asserts `archived`.

### Implementation order

Helper + its unit test → wire `completed`/`awaiting_manual_review` in executePlan
→ wire `failed` → wire `archived` in archive → display assertions.

### Excluded scope

- `lockSource: "manual_override"` detection — still unwired and out of scope for
  this plan (no phase here sets it).
- The SessionPort move (phase-01) and binding-ownership cleanup (phase-02).

### Verification

- The project's configured `full` gate profile in `phax.json`, plus the new
  status-transition assertions across executePlan / archive / session-info tests.

### Expected handoff content

- The `patchAgentBindingStatus` signature and the exact transition points where
  each of `completed` / `awaiting_manual_review` / `failed` / `archived` is set.
- Confirmation that `lockSource: "manual_override"` remains unwired (known gap).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(binding): wire the full binding-status lifecycle

### Commit body

Drive the binding status to completed, awaiting_manual_review, failed, and
archived at the existing phase/run transitions via a new status-only patch, so
session-info reports the real lifecycle instead of always showing running.
