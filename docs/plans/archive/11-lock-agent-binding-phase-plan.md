# Plan — Locked Agent Binding for Phase Sessions

Implements `docs/specs/11-lock-agent-binding-phase.md`.

## Goal

Make every launched phase carry a persisted, provider-aware **locked agent
binding**. Model routing runs only once, at phase launch. Every later
interaction with a launched phase (`enter`, `enter-last`, `enter-phase`,
`session-info`, automated `resume`) must read the locked binding and dispatch to
the correct provider session adapter — never the router.

## Background (current state)

- Provider IDs are `claude-code | codex-cli | mistral-vibe`
  (`src/domain/routing/types.ts`). The automated agent dispatch is already
  provider-aware (`src/infra/providers/dispatcher.ts`); `runAgent` /
  `resumeAgentSession` route per provider.
- The **interactive** re-entry path is Claude-only: `enter.ts`
  (`spawnClaudeResume` hardcodes `claude --resume`), `enterPhase.ts`, and
  `sessionInfo.ts` all read only `phaseStatus.claudeSessionId` and assume Claude.
- Per-phase routing is resolved inside `src/app/executePlan.ts` in **two**
  places: the fresh-phase branch (~line 546) and the **resumed-phase branch**
  (~line 426). The resumed-phase branch re-runs `resolveModel`, which is the
  FR-2 / FR-12 violation: a resumed phase can be re-routed to a different
  provider/model if routing config changed.
- Session IDs are persisted by `src/infra/providers/sessionWriter.ts`
  (`persistSessionId`) into `claude-session-id.txt` + `status.json.claudeSessionId`
  for every provider (the field name is Claude-centric but used generically).
- Each phase folder also already contains `model-resolution.json`
  (the `RoutingResolution`, including `selected.provider` /
  `selected.concreteModel`) and `security.json` — these are the legacy-inference
  sources for FR-10.

The relevant CLI commands are `enter`, `enter-phase`, and `session-info`. The
spec's "enter last" / "session last" convenience forms are intentionally **not**
implemented: per a product decision the `-last` command variants are considered
CLI-surface noise. The existing `enter-last` command is removed (see phase-05),
and no `session-info-last` is added. Spec FR-7 (`enter last`) and FR-9
(`session last`) are dropped accordingly; their acceptance criteria (AC-1, AC-2,
AC-4, AC-5, AC-6) are instead verified through the named-target commands
(`phax enter <short-name>` / `phax session-info <short-name>`), which exercise
the same locked-binding code path.

## Required commands

- (none)

This plan introduces no new tool, runtime, or CLI. Phases are implemented in
TypeScript and verified through the existing `phax.json` gate profiles (`pnpm`
gates, already covered by the frozen effective set). The provider CLIs (`claude`,
`codex`, `vibe`) are invoked by phax at runtime, not as agent tasks during plan
execution.

## Architecture decisions

1. **One binding artifact per phase.** A `PhaseAgentBinding` is persisted as
   `agent-binding.json` inside each phase folder
   (`runs/<shortName>/phase-NN/agent-binding.json`), alongside `status.json`,
   `model-resolution.json`, and `security.json`.
2. **`provider` uses the existing `ProviderId` taxonomy**
   (`claude-code | codex-cli | mistral-vibe`) — the source of truth the
   dispatcher and session adapters already key on — rather than a parallel
   `claude | codex | mistral` enum. An `adapter` field records the short adapter
   label for human-readable output. (Spec §5 explicitly allows field-name
   adjustments; the product requirement — enough info to re-enter without the
   router — is preserved.)
3. **Two-step write.** Provider/model/effort/worktree/cwd/lockSource are known at
   routing time and written when the phase enters `launching` (before the agent
   is considered launched, per FR-1). `sessionId` is only known after the agent
   returns; the existing `persistSessionId` path patches the binding to
   `sessionId` + status `running`.
4. **Interactive session adapters are separate from the automated backend.**
   `enter*` runs an interactive, stdio-inherited provider process; the `Backend`
   port runs non-interactive automation. A new
   `src/infra/sessionAdapters/` module builds the interactive resume invocation
   per provider and is unit-testable on its argv. Where a provider CLI has no
   interactive resume, the adapter returns an explicit provider-specific
   unsupported error — never a Claude fallback (FR-4/FR-5/AC-4).
5. **No back-compat shims in the schema.** New binding fields are required;
   genuinely-absent values (`sessionId` before capture, `sessionHandle`) use
   `Schema.NullOr`, not optional. Legacy runs without an `agent-binding.json` are
   handled by the explicit FR-10 inference/error path, not by softening the
   schema.

## Implementation order (inside-out)

Domain schema → launch-time persistence → automated-resume lock → session
adapters + legacy inference → interactive `enter*` rewire → `session-info`
rewire.

---

## phase-01 — PhaseAgentBinding schema and provider mapping {#phase-01-binding-schema}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Introduce the persisted `PhaseAgentBinding` schema and the provider↔adapter
mapping so later phases have a stable, decodable binding artifact to read and
write. No write or read sites change yet.

### Detailed instructions

- Add `src/schemas/phaseAgentBinding.ts` exporting `PhaseAgentBindingSchema`,
  its `PhaseAgentBinding` type, and `decodePhaseAgentBinding` /
  `encodePhaseAgentBinding` (mirror the encode/decode pattern in
  `src/schemas/status.ts`).
- Fields (all required; use `Schema.NullOr` for genuinely-absent values, never
  `optional`):
  - `version: Schema.Literal(1)`
  - `shortName: Schema.NonEmptyString` (phax's run identifier)
  - `runId: Schema.NonEmptyString`
  - `phaseId: Schema.NonEmptyString` (matches `^phase-\d{2}$`)
  - `phaseIndex: Schema.Number`
  - `phaseName: Schema.NonEmptyString` (plan phase title; fall back to phaseId)
  - `provider` — reuse the `ProviderId` union literals
    (`claude-code | codex-cli | mistral-vibe`) as an explicit Schema union.
  - `adapter` — explicit union `claude | codex | mistral`.
  - `model: Schema.NonEmptyString` (the resolved concrete model)
  - `effort: Schema.NonEmptyString` (the resolved thinking/effort)
  - `sessionId: Schema.NullOr(Schema.NonEmptyString)`
  - `sessionHandle: Schema.NullOr(Schema.NonEmptyString)`
  - `worktreePath: Schema.NonEmptyString`
  - `cwd: Schema.NonEmptyString`
  - `launchedAt: Schema.NonEmptyString`
  - `lockSource` — explicit union
    `routing_at_phase_start | manual_override | legacy_inferred`.
  - `status` — explicit union
    `launching | running | awaiting_manual_review | failed | completed | archived`
    (the binding lifecycle from spec §7; kept separate from phax's `PhaseState`).
- Add `src/domain/providerAdapter.ts` (or extend `src/domain/routing/types.ts`)
  with a pure, total mapping `providerToAdapter(provider: ProviderId): "claude" | "codex" | "mistral"`.
  Make it exhaustive (no default branch) so a new ProviderId fails the type
  check — per the explicit-per-variant-enum doctrine.
- Per the per-variant-enum feedback, define each union explicitly; do not derive
  the adapter set from a permissive superset.

### Planned files to create

- `src/schemas/phaseAgentBinding.ts`
- `src/domain/providerAdapter.ts`
- `tests/unit/phaseAgentBinding.test.ts`
- `tests/unit/providerAdapter.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/domain/routing/types.ts`

### Boundary contracts

Producer of a stable persisted contract consumed by phases 02–06. Consumers
(executePlan write path, sessionWriter, session adapters, `enter*`,
`session-info`) need: a decodable binding with `provider`, `adapter`, `model`,
`effort`, `sessionId`, `worktreePath`, `status`, `lockSource`. The stable shape
is the `PhaseAgentBinding` type exported from `src/schemas/phaseAgentBinding.ts`.

### Test strategy

Domain/schema layer → unit tests, written before implementation:

- `decodePhaseAgentBinding` accepts a fully-populated valid binding and a binding
  with `sessionId: null` / `sessionHandle: null`.
- It rejects an unknown `provider`, unknown `adapter`, unknown `lockSource`,
  unknown `status`, and a missing required field.
- `encode`→`decode` round-trips.
- `providerToAdapter` maps each ProviderId to the correct adapter exhaustively.

### Implementation order

Schema → encode/decode → provider mapping → tests.

### Excluded scope

- Writing or reading the binding anywhere (phases 02+).
- Any change to `PhaseStatus` / `RunStatus`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact path `src/schemas/phaseAgentBinding.ts` and the `PhaseAgentBinding` field
  list with each field's type and which are `NullOr`.
- The `providerToAdapter` signature and its module path.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(schema): add PhaseAgentBinding schema and provider-adapter mapping

### Commit body

Introduce the persisted PhaseAgentBinding schema (agent-binding.json contract)
and a total ProviderId→adapter mapping so later phases can lock and re-enter a
phase's exact provider session without consulting the router. Covered by unit
tests for decode/encode validity and the provider mapping.

---

## phase-02 — Persist the locked binding at phase launch {#phase-02-persist-binding}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Write `agent-binding.json` when a fresh phase enters launching (before the agent
is considered launched), and patch it with the captured `sessionId` once the
agent returns. After this phase every newly launched phase has a complete locked
binding.

### Detailed instructions

- Add `src/app/agentBinding.ts` with:
  - `writeAgentBinding(phaseFolderPath, binding)` — atomic write of
    `agent-binding.json` (reuse the atomic-write pattern from
    `sessionWriter.ts`).
  - `patchAgentBindingSession(phaseFolderPath, { sessionId, status })` — read
    the existing binding, set `sessionId` and `status`, bump nothing else;
    no-op silently if the file is absent or malformed (mirror the defensive
    `try/catch` in `persistSessionId`).
  - `readAgentBinding(phaseFolderPath)` returning
    `Either<string, PhaseAgentBinding>` for later phases.
- In `src/app/executePlan.ts`, in the **fresh-phase** branch, after
  `resolveModel` and after `model-resolution.json` / `security.json` are written
  but **before** `backend.runAgent`, build a `PhaseAgentBinding` from the
  resolution and write it with status `launching`, `sessionId: null`,
  `sessionHandle: null`, `lockSource: "routing_at_phase_start"`,
  `launchedAt: new Date().toISOString()`, `adapter: providerToAdapter(provider)`,
  `worktreePath`/`cwd` from `agentOptions.cwd`, `phaseName` from the plan phase
  title (fall back to `phase.id`). Use `manual_override` for `lockSource` if a
  provider-priority override / manual provider selection is in effect for this
  run (FR-11) — check whether `priorityOverride` flowed into routing; if not
  cleanly determinable here, keep `routing_at_phase_start` and note it in the
  handoff for phase-03/05 to refine.
- Extend the post-run session persistence so the binding is patched to
  `sessionId: <captured>` and `status: "running"`. Prefer doing this in
  `persistSessionId` (`src/infra/providers/sessionWriter.ts`) right after it
  updates `status.json`, calling `patchAgentBindingSession`, so all three
  providers benefit without per-provider edits. Keep `persistSessionId`'s
  existing behavior intact (still writes `claude-session-id.txt` and
  `status.json`).
- Do not change the resumed-phase branch yet (phase-03).

### Planned files to create

- `src/app/agentBinding.ts`
- `tests/unit/agentBinding.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/infra/providers/sessionWriter.ts`
- `tests/integration/executePlan.test.ts`

### Optional files that may be edited

- `tests/integration/dispatcher.test.ts`

### Boundary contracts

Producer: executePlan writes the launching binding; the provider session-write
path patches in the sessionId. Consumer (phases 03–06): a phase folder with a
valid `agent-binding.json` whose `provider`/`model` reflect the routing decision
made once at launch, and whose `sessionId` is populated after the agent runs.

### Test strategy

- Unit (`agentBinding.test.ts`, write before implementation): `writeAgentBinding`
  then `readAgentBinding` round-trips; `patchAgentBindingSession` sets sessionId
  + status and is a no-op when the file is absent.
- Integration (`executePlan.test.ts`): after a run reaches review_open, the phase
  folder contains `agent-binding.json` with the expected provider/model, status
  `running`, and a non-null sessionId. Assert it is written before the agent run
  by checking it exists even when the agent fails after launch (status remains
  `launching` with `sessionId: null`) — add a fake-backend failure case if the
  existing harness supports it; otherwise assert the success-path contents and
  note the launch-ordering guarantee in the handoff.

### Implementation order

`agentBinding.ts` helpers → wire write in executePlan fresh-phase branch →
patch in sessionWriter → tests.

### Excluded scope

- Reading the binding for resume/enter/session (phases 03–06).
- Removing `claude-session-id.txt` (kept for legacy/back-compat reads).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact paths and signatures: `writeAgentBinding`, `patchAgentBindingSession`,
  `readAgentBinding`.
- The exact line/branch in `executePlan.ts` where the launching binding is
  written, and where in `sessionWriter.ts` the sessionId patch happens.
- Whether `lockSource: "manual_override"` was wired or deferred, and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): persist locked agent binding at phase launch

### Commit body

Write agent-binding.json when a fresh phase enters launching and patch it with
the captured session id after the agent returns, via a new app/agentBinding
helper and the shared session-write path so all providers are covered. Newly
launched phases now carry a complete provider-aware locked binding. Covered by
unit and integration tests.

---

## phase-03 — Lock automated resume to the binding (no reroute) {#phase-03-resume-lock}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Stop the resumed-phase branch in `executePlan` from calling the router. A phase
that already has a locked binding resumes with its locked provider/model/effort,
even if routing config changed (FR-2, FR-12, AC-5, AC-6).

### Detailed instructions

- In `src/app/executePlan.ts` resumed-phase branch (~line 426), replace the
  unconditional `resolveModel(...)` call with: read the locked binding via
  `readAgentBinding(phaseFolderPath)`.
  - If a binding exists, build `agentOptions` from it
    (`provider`, `model`, `effort`) instead of from a fresh resolution. Do
    **not** call `resolveModel`. Recompute only provider-independent pieces that
    legitimately depend on the current worktree/security policy (the frozen
    agentCommands via `computeFrozenAgentCommands` for the bound provider).
  - If no binding exists (legacy run), fall back to the existing `resolveModel`
    path **only** as the controlled compatibility route, and persist a
    `legacy_inferred` binding for it (reuse the inference helper if phase-04 is
    already merged; if not, inline a minimal inference from
    `model-resolution.json` and note the follow-up). Since phases are sequential
    and merged in order, prefer: this phase handles the binding-present case
    cleanly and keeps the existing `resolveModel` fallback for the binding-absent
    case unchanged; full legacy inference lands in phase-04/05.
- Keep the resume branch's security-policy computation and frozen-commands logic;
  only the provider/model **source** changes.
- Add a guard/assertion (or test) proving `resolveModel` is not invoked when a
  binding is present — e.g. inject a routing config whose router would select a
  different provider and assert the bound provider is used.

### Planned files to edit

- `src/app/executePlan.ts`
- `tests/integration/executePlan.test.ts`

### Planned files to create

- (none)

### Optional files that may be edited

- `tests/integration/dispatcher.test.ts`

### Boundary contracts

Consumer: the resumed-phase branch consumes the `PhaseAgentBinding` produced in
phase-02 as the authoritative provider/model source. Producer side unchanged.
The invariant crossed here: for a launched phase, `provider`/`model` are
immutable; resume reads the binding, never the router.

### Test strategy

- Integration (`executePlan.test.ts`, write the routing-changed assertion before
  implementing): launch a phase bound to a non-claude provider via the fake
  backend; mutate the routing config so the router would now pick a different
  provider; resume; assert the agent dispatch used the **bound** provider/model.
- A regression test that a binding-present resume does not read the routing
  config at all (e.g. pass routing that would throw/select wrongly and assert the
  bound provider still wins).

### Implementation order

Read binding → branch on presence → build agentOptions from binding → tests
proving no reroute.

### Excluded scope

- Interactive `enter*` and `session-info` (phases 04–06).
- Full legacy inference helper (phase-04); only the minimal binding-absent
  fallback is retained here.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact resumed-phase branch location and how `agentOptions` is now sourced
  from the binding.
- Confirmation that `resolveModel` is unreachable when a binding is present, and
  the test that proves it.
- The binding-absent fallback behavior and what phase-04/05 must finish for
  legacy inference.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(run): resume launched phases from the locked binding, never the router

### Commit body

The resumed-phase branch in executePlan now reads the persisted
PhaseAgentBinding for provider/model/effort instead of re-running model routing,
so changing routing config after launch cannot re-route an already-launched
phase. Covered by an integration test that mutates routing after launch and
asserts the bound provider is still used.

---

## phase-04 — Provider session adapters and legacy inference {#phase-04-session-adapters}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add provider-specific interactive session adapters and a legacy-binding
inference helper, so the `enter*`/`session-info` commands (phases 05–06) can
dispatch by provider instead of assuming Claude.

### Detailed instructions

- Add `src/infra/sessionAdapters/` with one module per provider plus a registry:
  - `types.ts` — `SessionAdapter` interface: at minimum
    `buildResumeInvocation(binding): { executable: string; args: string[]; cwd: string } | { unsupported: string }`
    and `describe(binding): string` for `session-info` output. Keep the spawn
    itself in a thin shared runner so adapters stay pure/testable on argv.
  - `claude.ts` — interactive resume `claude --resume <sessionId>` in
    `binding.worktreePath` (matches today's `spawnClaudeResume`).
  - `codex.ts` — interactive resume for the codex CLI. **Verify the actual
    interactive invocation against the installed `codex` CLI** (the automated
    path uses `codex exec resume <id>`; the interactive form must be confirmed,
    not assumed). If codex has no interactive resume, return an explicit
    `unsupported` message naming codex.
  - `mistral.ts` — interactive resume for the vibe CLI (automated path uses
    `--resume <id>`). **Verify against the installed `vibe` CLI.** Return an
    explicit provider-specific `unsupported` message if interactive resume is not
    supported — never fall back to Claude (FR-5, AC-4).
  - `index.ts` / `registry.ts` — `getSessionAdapter(provider: ProviderId): SessionAdapter`,
    exhaustive over ProviderId.
  - a shared `spawnInteractive(invocation, out)` helper (stdio inherit) reused by
    `enter*` in phase-05.
- Add `src/app/inferLegacyBinding.ts`: given a phase folder, attempt to build a
  `legacy_inferred` `PhaseAgentBinding` from existing artifacts —
  `model-resolution.json` (`selected.provider`, `selected.concreteModel`,
  `selected.thinking`), `status.json` (`worktreePath`, `claudeSessionId`,
  `phaseIndex`), and the plan phase title. Persist it via `writeAgentBinding`
  with `lockSource: "legacy_inferred"`. Return `Either<string, PhaseAgentBinding>`
  so callers can show the FR-10 explicit error when inference fails.
- Do not wire these into the CLI commands yet (phases 05–06), but export them so
  the next phases consume them.

### Planned files to create

- `src/infra/sessionAdapters/types.ts`
- `src/infra/sessionAdapters/claude.ts`
- `src/infra/sessionAdapters/codex.ts`
- `src/infra/sessionAdapters/mistral.ts`
- `src/infra/sessionAdapters/index.ts`
- `src/app/inferLegacyBinding.ts`
- `tests/unit/sessionAdapters.test.ts`
- `tests/unit/inferLegacyBinding.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/infra/sessionAdapters/registry.ts`

### Boundary contracts

Producer of the interactive-session capability consumed by phases 05–06.
Consumer contract: `getSessionAdapter(binding.provider)` returns an adapter that
either yields a spawnable invocation in the bound worktree or an explicit
unsupported message; `inferLegacyBinding(phaseFolder)` yields a persisted
`legacy_inferred` binding or an error string.

### Test strategy

- Unit (`sessionAdapters.test.ts`, write before implementation): each adapter
  builds the expected `executable`/`args`/`cwd` from a binding; the registry is
  exhaustive over ProviderId; an unsupported provider path returns the explicit
  message (no Claude substitution).
- Unit (`inferLegacyBinding.test.ts`): inference succeeds from a fixture phase
  folder containing `model-resolution.json` + `status.json` and persists a
  `legacy_inferred` binding; inference fails with a clear error when the
  artifacts are missing/insufficient.
- Provider-CLI invocation strings are asserted as data; live CLI behavior is
  verified manually during implementation and recorded in the handoff (the
  spec's FR-4/FR-5 verification requirement).

### Implementation order

`types.ts` → claude adapter (mirror current behavior) → codex/mistral adapters
(verify CLIs) → registry → `inferLegacyBinding` → tests.

### Excluded scope

- Rewiring `enter`/`enter-last`/`enter-phase` (phase-05).
- Rewiring `session-info` (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `SessionAdapter` interface and `getSessionAdapter` signature with module
  paths.
- The **verified** interactive resume invocation for each provider CLI
  (claude/codex/vibe), including any that are unsupported and the exact message
  returned.
- The `inferLegacyBinding` signature and which artifacts it reads.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(session): add provider session adapters and legacy binding inference

### Commit body

Add per-provider interactive session adapters (claude/codex/mistral) behind an
exhaustive registry, a shared interactive spawn helper, and a legacy-binding
inference helper that reconstructs a legacy_inferred PhaseAgentBinding from
existing phase artifacts. Unsupported providers return explicit messages rather
than falling back to Claude. Covered by unit tests for adapter argv, registry
exhaustiveness, and inference success/failure.

---

## phase-05 — Rewire enter / enter-phase to the binding; remove enter-last {#phase-05-enter-rewire}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the interactive re-entry commands read the locked binding and dispatch to
the provider session adapter, with the FR-10 legacy compatibility path. Remove
the `enter-last` command as part of the agreed `-last` CLI-surface cleanup.

### Detailed instructions

- `src/cli/commands/enter.ts` (`runEnter`): resolve the target run/phase, read
  the locked binding for the relevant phase via `readAgentBinding`. If present,
  get `getSessionAdapter(binding.provider)` and spawn its interactive invocation
  in `binding.worktreePath`. If the adapter returns `unsupported`, print that
  provider-specific message and exit non-zero.
- If no binding exists (legacy), call `inferLegacyBinding`; on success persist and
  proceed; on failure stop with the FR-10 error message
  (`Cannot enter this phase because it was launched before phase agent bindings
  were introduced …`). Never silently route a new provider.
- `src/cli/commands/enterPhase.ts` (`runEnterPhase`): same flow for an explicit
  phase id.
- Replace the hardcoded `spawnClaudeResume` usage with the shared
  `spawnInteractive` + adapter dispatch. Keep `spawnClaudeResume` only if still
  used elsewhere; otherwise remove it (knip will flag dead exports).
- **Remove `enter-last`:** delete `runEnterLast` from `src/cli/commands/enter.ts`
  and the `enter-last` subcommand + its import in `src/cli/main.ts`. Leave the
  shared `resolveLastReviewOpenRun` helper in place — it is still consumed by
  `path-last` / `open-last` / `shell-last` / `archive-last` (their removal, if
  desired, is a separate cleanup outside this plan). Confirm knip stays green
  after deleting `runEnterLast`.

### Planned files to edit

- `src/cli/commands/enter.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/main.ts`
- `tests/integration/enterPhase.test.ts`

### Planned files to create

- `tests/integration/enter.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: the `enter` / `enter-phase` commands consume the `PhaseAgentBinding`
(phase-02) and the session adapters + legacy inference (phase-04). They must not
call `resolveModel`. Contract: given a launched phase, dispatch to the bound
provider's adapter in the bound worktree.

### Test strategy

- Integration (`enter.test.ts` / `enterPhase.test.ts`): with a fixture phase
  folder bound to codex, assert the codex adapter invocation is selected (assert
  on the built argv via an injected/captured spawn, not a real process). Verify
  no Claude session assumption is made (AC-2, via `phax enter <short-name>`).
- Legacy: a phase folder without `agent-binding.json` but with
  `model-resolution.json` infers and proceeds; one with neither stops with the
  explicit FR-10 error (AC-7).
- If any existing test references `enter-last` / `runEnterLast`, update or remove
  it as part of this phase.

### Implementation order

`runEnterPhase` (single phase, simplest) → `runEnter` → remove `enter-last`
wiring → legacy path → tests.

### Excluded scope

- `session-info` (phase-06).
- Removing the sibling `-last` commands (`path-last`, `open-last`, `shell-last`,
  `archive-last`) — separate cleanup, not part of this plan.
- Changing the remaining command names (non-goal).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- How `enter` / `enter-phase` resolve and read the binding and dispatch to the
  adapter.
- The legacy inference + error behavior and the exact error text.
- Confirmation that `enter-last` and `runEnterLast` are removed and knip is green.
- Whether `spawnClaudeResume` was removed or retained, and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): enter launched phases via the locked binding; remove enter-last

### Commit body

enter and enter-phase now read the persisted PhaseAgentBinding and dispatch to
the provider session adapter (claude/codex/mistral) in the bound worktree,
replacing the hardcoded claude --resume path. Legacy phases infer a
legacy_inferred binding or fail with an explicit error; no command re-routes a
launched phase. The enter-last command is removed as CLI-surface noise. Covered
by integration tests for codex dispatch and the legacy paths.

---

## phase-06 — session-info shows the locked binding {#phase-06-session-info}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `session-info` display the locked, provider-aware binding (FR-8, AC-3,
AC-6). No `-last` variant is added.

### Detailed instructions

- `src/cli/commands/sessionInfo.ts` (`runSessionInfo`): for the resolved current
  phase, read the locked binding and print at least: run identifier, phase
  name/index, locked **provider**, locked **model**, **adapter**, **session
  id/handle** (if available), **worktree path**, **phase status**, **launchedAt**,
  and **lockSource**. The output must make the locked provider/model
  unmistakable (see spec §10 example). Keep the existing run/state diagnostics.
- For legacy phases without a binding, attempt `inferLegacyBinding`; if it fails,
  fall back to the existing best-effort fields and clearly mark them as inferred,
  or print the FR-10 hint (`Run \`phax session-info <target> --debug\` for
  available metadata`). Do not infer the provider/model from current routing.
- Add a `--debug` flag to `session-info` that dumps available raw metadata
  (binding JSON / model-resolution.json) to satisfy the FR-10 error hint.

### Planned files to edit

- `src/cli/commands/sessionInfo.ts`
- `src/cli/main.ts`
- `tests/integration/sessionInfo.test.ts`

### Planned files to create

- (none — extend the existing `sessionInfo` test; create
  `tests/integration/sessionInfo.test.ts` if it does not exist)

### Optional files that may be edited

- (none)

### Boundary contracts

Consumer: `session-info` consumes the `PhaseAgentBinding` (phase-02) and legacy
inference (phase-04) as the display source of truth. It must not derive
provider/model from routing.

### Test strategy

- Integration (`sessionInfo.test.ts`): a phase bound to codex prints
  `Provider: codex-cli` / locked model / adapter / status / lockSource (AC-3); a
  phase bound to mistral still shows mistral after routing config is changed to
  prefer claude (AC-6). Snapshot or field-level assertions on the output.
- Legacy phase without a binding shows inferred fields or the explicit debug hint.

### Implementation order

`runSessionInfo` binding rendering → legacy/inference handling → `--debug` flag
→ tests.

### Excluded scope

- Any new provider or routing-algorithm change (non-goals).
- A `session-info-last` variant (dropped — `-last` CLI-surface noise).
- Renaming the existing `session-info` command.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `session-info` output fields and an example for a codex binding.
- Legacy/`--debug` behavior.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): show the locked provider/model in session-info

### Commit body

session-info now renders the persisted PhaseAgentBinding — locked provider,
model, adapter, session id, worktree, status, lock source — for the resolved
phase. Provider/model are read from the binding, never inferred from current
routing, with a legacy inference fallback and a --debug metadata dump. Covered by
integration tests including a routing-changed regression.
