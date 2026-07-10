---
name: model-routing
description: Extend the routing layer, add provider adapters, change the resolution algorithm, or add new model families in src/domain/routing/.
---

# model-routing skill

Use this skill when extending the routing layer, adding provider adapters, changing the resolution algorithm, or adding new model families.

## Architecture overview

```
src/domain/routing/         ← PURE — no IO, no Effect, no infra imports
  types.ts                  ← ProviderId, ModelFamily, EffortLevel, ThinkingLevel, Relationship literals
  defaults.ts               ← DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG constants
  catalog.ts                ← pure catalog helpers: familyOfId, entryFor, effortsFor, isDeprecated, nearestEfforts, equivalentFor, isClaudeFamily
  resolve.ts                ← resolveModel(request, routing, providerCfg, securityFilter?): RoutingResolution (total, pure)
  preflight.ts              ← preflightPhaseModels(phases, routing, providerConfig): { failures } (pure)

src/schemas/
  modelRouting.ts           ← Effect Schema for ~/.phax/model-routing.json (version 2); re-exports literal schemas
  providerConfig.ts         ← Effect Schema for ~/.phax/providers.json (versioned catalog with per-entry efforts and status)
  vibeConfig.ts             ← VibeBaseModel schema + extractBaseModel + renderPhaxAliasBlocks

src/app/
  loadRouting.ts            ← FileSystem-port loaders; falls back to defaults when files absent
  vibeSetup.ts              ← append-only Vibe alias installer (atomic write + backup)

src/infra/providers/        ← ONLY place that may spawn provider binaries
  claudeCode.ts             ← claude spawn logic
  mistralVibe.ts            ← vibe spawn logic (VIBE_ACTIVE_MODEL env)
  codexCli.ts               ← codex spawn logic
  sessionWriter.ts          ← shared atomic session-id writer
  dispatcher.ts             ← makeNodeBackendLayer(providerConfig) — selects adapter by options.provider

src/cli/commands/agent.ts   ← phax agent models|resolve|probe|setup commands
```

## Key invariants

**Domain stays pure**: nothing under `src/domain/routing/` may import Effect, `@opentelemetry/*`, the FileSystem port, or any `infra/` module. `resolveModel` is a total pure function — it never throws. An architectural guard in `tests/unit/architecturalGuards.test.ts` enforces this.

**Only `src/infra/providers/` may spawn**: the `spawn("claude"…)`, `spawn("vibe"…)`, `spawn("codex"…)` calls live exclusively in the corresponding adapter files. The architectural guard forbids these patterns anywhere else in `src/`.

**Schemas use `onExcessProperty: "error"`**: config files are validated strictly. Config version 2 rejects `tiers`, `normalization`, and `defaultTier` fields — there is no back-compat shim. New fields must be added to the schema first.

**No back-compat shims**: new required fields are required, not optional for legacy files.

**`allowDowngrade` is the sole policy knob**: cross-family substitutions with `downgrade` or `no_equivalent` relation are skipped when `allowDowngrade: false`. Same-family resolution is always permitted.

**Efforts are per catalog entry**: each versioned model id has its own `efforts` array. There is no family-wide effort set. The preflight validates that a phase's effort is in its entry's supported set before any agent spawns.

**Terminal `claude-code` fallback**: `resolveModel` is total. If no provider in `providerPriority` resolves, the function falls through to `claude-code` — natively for Claude families, via the equivalence hub for non-Claude families.

**Telemetry never fails a run**: the `agent.model.resolved` event is emitted via `telemetry.recordEvent` and errors are swallowed.

**Atomic writes + backup**: `vibeSetup.ts` and the session writer use temp + rename; `vibeSetup.ts` backs up `~/.vibe/config.toml` before appending.

## Catalog helpers (`catalog.ts`)

| Export           | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `familyOfId`     | Look up the `ModelFamily` for a versioned id; `undefined` if not in catalog  |
| `entryFor`       | `CatalogLocation` (provider + family + entry) for a versioned id             |
| `effortsFor`     | The efforts array for a versioned id                                         |
| `isDeprecated`   | True when the entry's status is `"deprecated"`                               |
| `nearestEfforts` | Efforts sorted by proximity to a requested effort; used by preflight         |
| `equivalentFor`  | Star-lookup through the Claude hub (hub→spoke, spoke→hub, spoke→spoke)       |
| `isClaudeFamily` | True for `claude-haiku`, `claude-sonnet`, `claude-opus`                      |

`equivalentFor` semantics: equivalence table edges are stated hub-centric. Hub → spoke uses the stored relation directly; spoke → hub inverts it (`downgrade ↔ upgrade`); spoke → spoke composes two hops.

## Resolution pipeline

1. Derive plan family from `request.model`: catalog lookup → `requestedModelNormalization` → substring heuristic → default `claude-sonnet`.
2. Walk `routing.providerPriority`; skip disabled providers and security-filtered providers.
3. If the provider serves the plan family, resolve natively from its catalog (relationship `exact` or `equivalent` if effort is clamped).
4. Otherwise translate through the Claude hub via `equivalentFor`; skip when `allowDowngrade: false` and relation is `downgrade` or `no_equivalent`.
5. Terminal `claude-code`: same-family natively, or spoke → hub via equivalence table. Relationship `no_equivalent` on a complete miss.

## Adding a new provider

1. Add the literal to `ProviderId` in `src/domain/routing/types.ts`.
2. Add the corresponding literal to `ProviderIdSchema` in `src/schemas/modelRouting.ts`.
3. Add equivalence edges in `DEFAULT_MODEL_ROUTING.equivalence` (in `defaults.ts`) for each of the provider's model ids and efforts, anchoring each to its Claude hub peer.
4. Add a `ProviderEntry` in `DEFAULT_PROVIDER_CONFIG.providers` with a `families` record and per-model `models` arrays.
5. Create `src/infra/providers/<newProvider>.ts` with `runNewProviderAgent` + resume variant returning `AgentRunResult`.
6. Wire the new branch in `src/infra/providers/dispatcher.ts`.
7. Add tests in `tests/unit/providers/<newProvider>.test.ts` (no real CLI — mock the spawn).

## Adding a new model family

1. Add the literal to `ModelFamily` in `types.ts` and `ModelFamilySchema` in `modelRouting.ts`.
2. Add `requestedModelNormalization` entries for known versioned ids in `DEFAULT_MODEL_ROUTING`.
3. Add the family's `models` arrays (with per-entry `efforts` and `status`) to the relevant provider entry in `DEFAULT_PROVIDER_CONFIG`.
4. If the family belongs to a spoke provider, add equivalence edges in `DEFAULT_MODEL_ROUTING.equivalence`.
5. Update `docs/model-routing.md` family table.

## Per-invocation provider priority override

Both `phax run` and `phax resume` accept `--provider-priority <list>` to override `providerPriority` for that invocation without touching any config file:

```bash
phax run --provider-priority mistral-vibe,claude-code
phax resume my-run --yes --provider-priority codex-cli,claude-code
```

Valid ids: `claude-code`, `mistral-vibe`, `codex-cli`. The list is parsed by `parseProviderPriority` in `src/domain/routing/priorityOverride.ts` (deduped, trimmed, validated; fails fast on empty/unknown). The override is applied by `applyProviderPriorityOverride` which returns a new `ModelRouting` with only `providerPriority` replaced.

**Caveat**: `claude-code` remains the guaranteed terminal fallback in `resolveModel` regardless of the override.

## Worked examples

| Request                               | Priority           | allowDowngrade | Result                                                                     |
| ------------------------------------- | ------------------ | -------------- | -------------------------------------------------------------------------- |
| `claude-sonnet-4-6` / `medium`        | claude-code only   | —              | claude-code, `claude-sonnet-4-6`, `medium`, `exact`                        |
| `claude-sonnet-4-6` / `medium`        | mistral-vibe first | —              | mistral-vibe, `phax-mistral-medium-3.5-medium`, `medium`, `equivalent`     |
| `gpt-5.5` / `xhigh`                  | codex-cli first    | —              | codex-cli, `gpt-5.5`, `xhigh`, `exact`                                    |
| `gpt-5.5` / `xhigh` (codex disabled) | —                  | true           | claude-code, `claude-opus-4-8`, `medium`, `equivalent` (hub translation)   |
| `claude-opus-4-8` / `ultracode`       | any                | any            | claude-code, `claude-opus-4-8`, `ultracode`, `exact`                       |
