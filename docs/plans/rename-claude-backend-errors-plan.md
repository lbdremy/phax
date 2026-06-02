# Plan: Rename Claude-specific backend errors/telemetry → agent-generic

This plan is written for `phax extract-plan`. Each phase section carries the
extracted fields (`model`, `effort`, anchor, commit subject/body) plus
informational guidance for the executing agent.

Phases 01–03 de-Claude-ify the backend error and telemetry surface. Phases
04–05 add a probe-driven `phax agent setup providers` command that scaffolds
`~/.phax` provider/routing config. Phase 06 generalizes the real E2E harness so
it can drive any configured agent backend, completing the move away from
Claude-only assumptions.

## Guiding facts for all phases

- For each Effect tagged error, rename **both** the class name **and** the
  `Data.TaggedError("…")` discriminant string so they stay in sync.
- Do **not** rename `adapter: "claude-code-cli"` context values or
  provider-config keys (`"mistral-vibe"`, `"codex-cli"`) — those are real
  adapter/provider identifiers, not the leftover naming.
- Leave `docs/plans/*.md` untouched — they are historical phase records.
- Gates are owned by `phax.json` (the `full` profile:
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm test`,
  `pnpm audit:architecture`, `pnpm build`). Every phase must leave that profile
  green. Do not invent additional scripts.

---

## phase-01 — Rename the two domain error classes {#phase-01-rename-error-classes}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Rename the two Claude-named domain error classes to agent-generic names across
the entire `src` and `tests` tree so the codebase no longer implies the backend
is always Claude. This phase touches Effect type unions, `instanceof` guards,
and the `Data.TaggedError` discriminant strings, so the executor must run
type-check in a loop rather than one-shot it.

### Detailed instructions

- Rename `ClaudeInvocationError → AgentInvocationError` and
  `ClaudeSessionIdMissingError → AgentSessionIdMissingError`. For each, change
  the class name **and** the `Data.TaggedError("…")` tag string at the
  definition site `src/domain/errors.ts:31,40`.
- Update every consumer in `src` — imports, type-union members, `new …()`
  constructions, and `instanceof` guards:
  - `src/ports/backend.ts:4,5,33,42`
  - `src/infra/providers/dispatcher.ts` (imports + all `new …` at
    `:25,34,41,50,57,63,77,86,92` + `instanceof` at `:24,40,56`)
  - `src/infra/providers/claudeCode.ts:9,10,138,144,145,162,174,184`
  - `src/infra/providers/codexCli.ts:9,10,151,160,161,176,188,198`
  - `src/infra/providers/mistralVibe.ts:9,10,129,138,139,154,166,176`
  - `src/infra/fakes/backend.ts:5,82,92,102,121`
  - `src/app/extractPlan.ts:15,113`
  - `src/app/executePlan.ts:8,9,90,91,366`
  - `src/app/eventAdapter.ts:18,19,63,110,220,221,257,258,273,274`
  - `src/app/fixLoop.ts:6,7,80,81,129,130,258`
  - `src/app/handoffGeneration.ts:6,7,80,81`
  - `src/app/telemetry/reportBuilders.ts:2,45` (type import + param type only)
  - `src/cli/commands/runLayers.ts:22,23,76`
- Update tests — imports, `instanceof`, and `it(...)`/`describe(...)` titles
  that name the error:
  - `tests/integration/providerDispatcher.test.ts:5,31,48,63`
  - `tests/integration/eventAdapter.test.ts:6,128,130,144,216,232,598,600,608`
  - `tests/integration/telemetry/adapterFailures.test.ts:5,174`
  - `tests/unit/telemetry/reportBuilders.test.ts:3,104,105,129,140,149`
- Completeness check: `rg 'ClaudeInvocationError|ClaudeSessionIdMissingError' src tests`
  must return zero hits.

### Included scope

- The two error class definitions in `src/domain/errors.ts` and all `src`/
  `tests` references to them.

### Excluded scope

- `reportClaudeFailure` and the `adapter.claude_failed` report literal (phase-02).
- Any docs or skills prose (phase-03).
- `adapter: "claude-code-cli"` context values and provider-config keys.

### Note

The only `catchTag` calls are for `RateLimitError`/`UsageLimitError`
(`eventAdapter.ts`) — nothing catches these two tags by string, so there are no
string-literal tag matches to chase beyond the `Data.TaggedError` definitions.

### Expected handoff content

- Confirm both class names and both tag strings were renamed and that the
  `rg` completeness sweep returns zero hits.
- Confirm the `full` gate profile is green.
- Note the new exported names (`AgentInvocationError`,
  `AgentSessionIdMissingError`) and that `src/domain/errors.ts` is their
  definition module, for phase-02's type import at
  `src/app/telemetry/reportBuilders.ts`.

### Commit subject

refactor(errors): rename Claude backend errors to agent-generic

### Commit body

Rename `ClaudeInvocationError → AgentInvocationError` and
`ClaudeSessionIdMissingError → AgentSessionIdMissingError`, including the
`Data.TaggedError` tag strings, across all `src` and `tests` references. No
behaviour change; adapter and provider identifiers are untouched.

---

## phase-02 — Rename the telemetry surface {#phase-02-rename-telemetry-surface}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Rename the Claude-named telemetry helper and the failure report type literal to
agent-generic names. This is bounded string work with explicit line targets and
assertion lists.

### Detailed instructions

- Rename `reportClaudeFailure → reportAgentFailure`:
  - definition: `src/app/telemetry/reportBuilders.ts:44`
  - callers: `src/app/fixLoop.ts:26,260`, `src/app/executePlan.ts:33,368`
  - tests: `tests/integration/telemetry/adapterFailures.test.ts:15,176` plus its
    `describe(...)` title at `:151`;
    `tests/unit/telemetry/reportBuilders.test.ts:7,103,113,135,141,150`
- Rename the report type literal `"adapter.claude_failed" → "adapter.agent_failed"`:
  - producer: `src/app/telemetry/reportBuilders.ts:50`
  - assertions: `tests/integration/telemetry/adapterFailures.test.ts:192`,
    `tests/unit/telemetry/reportBuilders.test.ts:120,143`
- Completeness check: `rg 'reportClaudeFailure|adapter\.claude_failed' src tests`
  must return zero hits.

### Included scope

- The `reportAgentFailure` helper and the `adapter.agent_failed` report literal,
  plus their callers and assertions in `src`/`tests`.

### Excluded scope

- Docs and skills prose (phase-03).

### Note

`SystemErrorReport.type` is `readonly type: string` (no literal union), so
nothing else constrains this value. No `.snap` file contains `claude_failed`, so
there are no snapshots to regenerate.

### Expected handoff content

- Confirm the helper and literal were renamed and the `rg` sweep returns zero
  hits.
- Confirm the `full` gate profile is green.
- State the new emitted report type string (`adapter.agent_failed`) so phase-03
  updates the docs to match.

### Commit subject

refactor(telemetry): rename Claude failure report to agent-generic

### Commit body

Rename `reportClaudeFailure → reportAgentFailure` and the emitted report type
`adapter.claude_failed → adapter.agent_failed`, updating callers and assertions.
No behaviour change beyond the renamed identifier and string literal.

---

## phase-03 — Sync live docs and skill {#phase-03-sync-docs-and-skill}

**Recommended model:** claude-haiku-4-5-20251001
**Recommended effort:** low

### Objective

Update the live documentation and skill prose to use the new agent-generic
names, so the docs match the renamed helper and report type from phases 01–02.

### Detailed instructions

- Update prose references to the new names (function + report type) in:
  - `docs/observability.md:74` — and verify the `adapter.command_failed` example
    block around `:82`; confirm whether it should read `adapter.agent_failed`
    (it currently looks stale) and fix if so.
  - `.skills/observability.md:59`
- Leave `docs/plans/plan.md`, `docs/plans/model-routing-plan.md`, and
  `docs/plans/observability-plan.md` as historical records — do not touch them.
- Completeness check:
  `rg 'reportClaudeFailure|ClaudeInvocationError|adapter\.claude_failed' docs .skills`
  must return only intentional plan-history mentions.

### Included scope

- `docs/observability.md` and `.skills/observability.md` prose only.

### Excluded scope

- Any `src`/`tests` changes (done in phases 01–02).
- Historical `docs/plans/*.md` records.

### Expected handoff content

- Confirm the docs/skill now name `reportAgentFailure` and `adapter.agent_failed`.
- Confirm the `rg` sweep across `docs`/`.skills` is clean apart from
  plan-history mentions.
- Confirm the `full` gate profile is green.

### Commit subject

docs: sync agent-generic error and telemetry names

### Commit body

Update `docs/observability.md` and `.skills/observability.md` to reference the
renamed `reportAgentFailure` helper and `adapter.agent_failed` report type.
Historical plan records under `docs/plans/` are left unchanged.

---

## phase-04 — Provider-config reconciliation builder {#phase-04-provider-config-builder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Add a pure, IO-free function that, given the current `ProviderConfig` and a list
of executable-probe results, computes the reconciled `ProviderConfig` plus a
summary of what changed. This is the testable core of the `phax agent setup
providers` command (phase-05); isolating it keeps the merge/prune semantics
unit-tested and the CLI phase thin.

### Detailed instructions

- Create `src/domain/routing/providerSetup.ts` (pure domain module, no
  `FileSystem`/`Shell`/Effect IO). Export:
  - `interface ProviderProbeResult { readonly provider: string; readonly available: boolean }`
  - `interface ProviderConfigPlan { readonly config: ProviderConfig; readonly enabled: readonly string[]; readonly disabled: readonly string[]; readonly unchanged: readonly string[] }`
  - `function planProviderConfig(current: ProviderConfig, probes: readonly ProviderProbeResult[], opts: { readonly prune: boolean }): ProviderConfigPlan`
- Reconciliation semantics, per provider key in `current.providers`:
  - probe `available && !entry.enabled` → set `enabled: true`, record in `enabled`.
  - probe `!available && entry.enabled && opts.prune` → set `enabled: false`,
    record in `disabled`.
  - all other cases → leave the entry untouched, record in `unchanged`.
  - a provider with no matching probe result is always `unchanged` (defensive).
- Preserve every other field of each provider entry verbatim (`executable`,
  `modelEnvVar`, `defaultAgent`, `families`, `aliases`, …). Return a brand-new
  object; never mutate the input.
- Match probe results to providers by exact key. Use the provider-config keys
  (`claude-code`, `mistral-vibe`, `codex-cli`) — these are the routing provider
  ids, distinct from the `agent.backend` values (`claude-code-cli`, …).

### Included scope

- `src/domain/routing/providerSetup.ts` and a unit test
  (`tests/unit/routing/providerSetup.test.ts`).

### Excluded scope

- Any filesystem read/write, probing, or CLI wiring (phase-05).
- `model-routing.json` handling (phase-05 owns the `--with-routing` scaffold).

### Unit test coverage to include

- enables an available-but-disabled provider;
- with `prune: true`, disables an enabled-but-unavailable provider;
- with `prune: false`, leaves an enabled-but-unavailable provider untouched;
- preserves custom entry fields (e.g. a non-default `executable` and `families`);
- is idempotent (running the plan's `config` back through yields no changes);
- a provider with no probe result is reported as `unchanged`.

### Expected handoff content

- Give the module path and the exact exported signatures of
  `planProviderConfig`, `ProviderProbeResult`, and `ProviderConfigPlan` so
  phase-05 can import them.
- State the reconciliation rule for `prune` true vs false.
- Confirm the `full` gate profile is green.

### Commit subject

feat(routing): add provider-config reconciliation builder

### Commit body

Add `planProviderConfig`, a pure function that reconciles a `ProviderConfig`'s
`enabled` flags against executable-probe results and reports the enabled /
disabled / unchanged providers. Only-enable by default; `prune` also disables
providers whose executable is unavailable. Custom entry fields are preserved.

---

## phase-05 — `phax agent setup providers` command {#phase-05-agent-setup-providers}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Wire a probe-driven `phax agent setup providers` CLI command that reconciles
`~/.phax/providers.json` from live executable probes using the phase-04 builder.
Dry-run by default (preview only); `--write` persists; `--prune` performs a full
sync (disables unavailable providers); `--with-routing` scaffolds
`~/.phax/model-routing.json` from defaults when it is absent.

### Detailed instructions

- Reuse, don't duplicate, the probe logic. Extract the per-provider
  `executable --version` probe currently inlined in `runAgentProbe`
  (`src/cli/commands/agent.ts:119-140`) into a shared app-layer function — e.g.
  `probeProviders(providerConfig): Effect.Effect<ProviderProbeResult[], never, Shell>`
  in `src/app/providerProbe.ts` — and have both `runAgentProbe` and the new
  setup path call it. Return the `ProviderProbeResult` shape from phase-04.
- Add the orchestrator `src/app/providerSetup.ts`, mirroring
  `src/app/vibeSetup.ts`:
  - Resolve `PROVIDER_CONFIG_PATH` / `MODEL_ROUTING_PATH` from
    `src/app/loadRouting.ts`.
  - Read the current `providers.json` if it exists (else start from
    `DEFAULT_PROVIDER_CONFIG`); track whether the file existed so a backup is
    only written when overwriting.
  - Run `probeProviders`, then `planProviderConfig(current, probes, { prune })`.
  - On `--write`: if the file already exists, first write a timestamped backup
    (`${PROVIDER_CONFIG_PATH}.phax-backup-${Date.now()}`) via `fs.writeAtomic`,
    then `fs.writeAtomic` the new config as pretty JSON (2-space indent).
  - On `--with-routing`: only when `MODEL_ROUTING_PATH` does **not** exist, write
    `DEFAULT_MODEL_ROUTING` as pretty JSON (never overwrite an existing routing
    file). Skip silently if present.
  - Return a result describing `enabled`/`disabled`/`unchanged`, the paths
    written, the backup path, and whether routing was scaffolded.
- Register `setup providers` under the existing `setupCmd`
  (`src/cli/commands/agent.ts:258`) with options `--write`, `--prune`,
  `--with-routing`. Without `--write`, print the planned changes and write
  nothing (dry-run). With `--write`, apply and print the summary table and any
  backup path. Follow the output style of `runAgentSetupMistralVibe`.

### Included scope

- `src/app/providerProbe.ts`, `src/app/providerSetup.ts`, the `setup providers`
  registration + handler in `src/cli/commands/agent.ts`, the `runAgentProbe`
  refactor to share the probe helper, and an integration test
  (`tests/integration/agentSetupProviders.test.ts`).

### Excluded scope

- The pure reconciliation logic (imported from phase-04).
- The E2E suite (phase-06).
- Overwriting an existing `model-routing.json` (explicitly never done).

### Integration test coverage to include

- dry-run (no `--write`) writes nothing and reports the plan;
- `--write` produces a `providers.json` with the expected `enabled` flags given
  a fake `Shell` that reports specific probe results;
- `--prune` disables an enabled provider whose probe is unavailable;
- `--with-routing` writes `model-routing.json` only when absent and never
  overwrites an existing one;
- a backup is written when overwriting an existing `providers.json`.
- Drive these with a temp config dir and a fake `Shell`/`FileSystem`; do not
  touch the real `~/.phax`.

### Expected handoff content

- State the command name and its `--write` / `--prune` / `--with-routing`
  semantics, and that dry-run is the default.
- Name `src/app/providerProbe.ts` and `src/app/providerSetup.ts` and their
  exported entry points.
- Confirm `runAgentProbe` now shares the extracted probe helper with no
  behaviour change.
- Confirm the `full` gate profile is green.
- Note that the phase-06 prerequisite is now satisfiable via
  `phax agent setup providers --write --prune --with-routing`.

### Commit subject

feat(cli): add probe-driven `phax agent setup providers`

### Commit body

Add `phax agent setup providers`, which reconciles `~/.phax/providers.json`
`enabled` flags from live executable probes via `planProviderConfig`. Dry-run by
default; `--write` persists (with a timestamped backup), `--prune` disables
unavailable providers, and `--with-routing` scaffolds `model-routing.json` from
defaults when absent. The probe loop is extracted into a shared helper reused by
`phax agent probe`.

---

## phase-06 — Parameterize the real E2E flow by backend {#phase-06-parameterize-e2e-backend}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Generalize the real end-to-end suite (`tests/e2e/realFlow.test.ts`) so it can
exercise any configured agent backend — `claude-code-cli`, `mistral-vibe`, or
`codex-cli` — selected by the `PHAX_E2E_BACKEND` environment variable, instead
of being hardwired to Claude. The default must remain `claude-code-cli` so
existing invocations are unchanged, and the suite must stay CI-safe: it
auto-skips a backend whose executable is not on `PATH`.

### Key facts the executor must respect

- Backend → executable mapping: `claude-code-cli → claude`,
  `mistral-vibe → vibe`, `codex-cli → codex`. Probe availability with
  `<executable> --version` (status 0), mirroring `phax agent probe`.
- `providers.json` and `model-routing.json` are read from `homedir()/.phax`
  (`src/app/loadRouting.ts:11-12`), **not** from `state.root`, and that path is
  **not** overridable. Do **not** override `HOME` to relocate it — the agent
  CLIs read their auth from the real `$HOME`, so relocating it breaks a real
  run. The test therefore relies on the developer's real `~/.phax` having the
  target backend enabled and routable (documented prerequisite below); it does
  not write provider/routing config itself.
- The plan model is read from the fixture `plan.md` by `phax extract-plan`, so
  per-backend model selection (decision: parameterize per backend) is done by
  substituting the `**Recommended model:**` line(s) in the copied fixture
  `plan.md`, not by editing routing.

### Detailed instructions

- Add a backend registry to the e2e helpers (e.g.
  `tests/e2e/helpers/backends.ts`), keyed by backend id, each entry holding:
  - `executable` (string used for the `--version` probe),
  - `requestedModel` (the model string written into the fixture `plan.md`; must
    resolve to a tier that includes this backend under the developer's
    `~/.phax/model-routing.json`). Suggested defaults:
    `claude-code-cli → "claude-haiku-4-5-20251001"`,
    `mistral-vibe → "mistral-medium"`, `codex-cli → "gpt-5.5"` — the executor
    should confirm each resolves via `phax agent resolve` before relying on it.
- Resolve the selected backend from `PHAX_E2E_BACKEND`, defaulting to
  `"claude-code-cli"`. Fail fast with a clear error if the value is not a
  registry key.
- Replace `claudeAvailable()` with a generic probe of the selected backend's
  `executable`. Keep the `PHAX_E2E_RUN === "1"` master opt-in. The combined gate
  becomes: run only when `PHAX_E2E_RUN=1` **and** the selected backend's
  executable is available; otherwise `describe.skipIf` skips the suite.
- Extend `createTempEnv` (in `tests/e2e/helpers/tempEnv.ts`) to take the
  selected backend and, after copying the fixture:
  - patch the fixture `phax.json` `agent.backend` to the selected backend id;
  - substitute every `**Recommended model:**` line in the copied `plan.md` with
    the registry `requestedModel` for the selected backend.
- Replace the hardcoded `expect(plan.run.backend).toBe("claude-code-cli")`
  assertions (both the `phax run` block and the standalone `extract-plan` block)
  with the selected backend id.
- Surface the selected backend in `describe(...)` titles or test output so
  failures are attributable to a backend.

### Included scope

- `tests/e2e/realFlow.test.ts`, `tests/e2e/helpers/tempEnv.ts`, and a new
  `tests/e2e/helpers/backends.ts` registry helper.

### Excluded scope

- `tests/e2e/semanticTrace.test.ts` — it uses fake adapters (no real provider),
  so it does not take a real backend and is out of scope.
- Any change to `src/`, to `homedir()/.phax` config files, or to the provider
  config path resolution. Enabling/routing backends in the developer's
  `~/.phax` is a one-time prerequisite handled by the `phax agent setup
  providers` command added in phases 04–05, not by this test.
- The fixture `plan.md` phase models are substituted at runtime, not committed
  per-backend.

### Prerequisite (one-time, not part of this commit)

To actually run a non-default backend the developer's `~/.phax/providers.json`
must have that provider `enabled: true` with the correct `executable`, and
`~/.phax/model-routing.json` must resolve the registry `requestedModel` to a
tier containing that provider. With phases 04–05 in place this is a single
command: `phax agent setup providers --write --prune --with-routing`. Verify
with `phax agent probe` and `phax agent resolve` before running. With no setup,
only `claude-code-cli` runs and the other backends skip — which is the intended
CI-safe default.

### Expected handoff content

- State that `PHAX_E2E_BACKEND` selects the backend, defaults to
  `claude-code-cli`, and that absent executables skip the suite.
- Name the new registry module path and its exported shape.
- Confirm the default (`claude-code-cli`) path behaves exactly as before and the
  `full` gate profile is green (the real E2E suite stays skipped under gates
  because `PHAX_E2E_RUN` is unset).
- List the `requestedModel` chosen per backend and how each was confirmed to
  resolve (`phax agent resolve` output).

### Commit subject

test(e2e): parameterize real flow by agent backend

### Commit body

Add a `PHAX_E2E_BACKEND` selector (default `claude-code-cli`) and a backend
registry to the real E2E suite so it can drive `claude-code-cli`, `mistral-vibe`,
or `codex-cli`. Probe the selected backend's executable for availability,
patch the fixture `phax.json` backend and `plan.md` model accordingly, and
assert against the selected backend. Absent executables skip the suite, keeping
CI behaviour unchanged.

---

## Why this split / these tiers

- It is one mechanical rename, but splitting on **error classes (01)** vs
  **telemetry surface (02)** vs **docs (03)** keeps each phase independently
  compiling and lets per-phase routing send the cheap, low-ambiguity work
  (02, 03) to cheaper tiers.
- **Phase 01 gets medium effort** because it touches Effect type unions,
  `instanceof` guards, and the tag discriminant across ~16 `src` files — the
  executor should run type-check in a loop, not one-shot it.
- **Phases 02–03 are bounded string swaps** with explicit line targets and
  assertion lists, so low effort suffices.
- **Phases 04–05 split the new command** into a pure reconciliation builder
  (04, unit-tested in isolation) and the FS/CLI wiring (05), so the merge/prune
  semantics get tight unit coverage and the CLI commit stays reviewable.
- **Phase 06 gets medium effort** because it reworks spawn/probe logic, fixture
  patching, and backend-aware assertions in the E2E harness, and the executor
  must reason about routing resolution per backend.
</content>
</invoke>
