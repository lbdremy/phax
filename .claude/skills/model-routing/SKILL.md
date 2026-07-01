---
name: model-routing
description: Extend the routing layer, add provider adapters, change the resolution algorithm, or add new model families/tiers in src/domain/routing/.
---

# model-routing skill

Use this skill when extending the routing layer, adding provider adapters, changing the resolution algorithm, or adding new model families / tiers.

## Architecture overview

```
src/domain/routing/         ← PURE — no IO, no Effect, no infra imports
  types.ts                  ← ProviderId, ModelFamily, EffortLevel, ThinkingLevel, RoutingTier, Relationship literals
  defaults.ts               ← DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG constants
  resolve.ts                ← resolveModel(request, routing, providerCfg): RoutingResolution (total, pure)

src/schemas/
  modelRouting.ts           ← Effect Schema for ~/.phax/model-routing.json; re-exports literal schemas
  providerConfig.ts         ← Effect Schema for ~/.phax/providers.json
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

**Schemas use `onExcessProperty: "error"`**: config files are validated strictly. New fields in `model-routing.json` or `providers.json` must be added to the schema first.

**No back-compat shims**: new required fields are required, not optional for legacy files.

**No silent Opus downgrade**: when `allowDowngrade: false` (the default), `resolveModel` skips candidates with `downgrade` or `no_equivalent` relationship when the requested family is `claude-opus`. It always has a terminal fallback to `claude-code`.

**Same-family preservation**: effort never changes model family for Claude families. A `claude-sonnet / low` request resolved to `claude-code` stays Sonnet (not Haiku). A same-family switch (e.g. Sonnet → Haiku) requires an explicit `relationship: "downgrade"` entry **and** `allowDowngrade: true`. The `resolveModel` function enforces this invariant regardless of the user-edited routing table.

**`ultracode` is Opus-only**: `claude-opus / ultracode` resolves through the `frontier-ultra` tier. No Mistral/OpenAI equivalent exists — it is never silently downgraded when `allowDowngrade: false`.

**Telemetry never fails a run**: the `agent.model.resolved` event is emitted via `telemetry.recordEvent` and errors are swallowed.

**Atomic writes + backup**: `vibeSetup.ts` and the session writer use temp + rename; `vibeSetup.ts` backs up `~/.vibe/config.toml` before appending.

## Per-family effort sets

| Family           | Valid efforts                                                  |
| ---------------- | -------------------------------------------------------------- |
| `claude-haiku`   | `none`                                                         |
| `claude-sonnet`  | `low` \| `medium` \| `high` \| `xhigh` \| `max`                |
| `claude-opus`    | `low` \| `medium` \| `high` \| `xhigh` \| `max` \| `ultracode` |
| `mistral-medium` | `off` \| `low` \| `medium` \| `high` \| `max`                  |
| `openai-gpt`     | `low` \| `medium` \| `high` \| `xhigh`                         |

`FAMILY_EFFORTS` in `types.ts` is the authoritative capability map. Use `isEffortSupported(family, effort)` to check membership. The superset `EffortLevel` is derived from the union of all five; `ThinkingLevel` is an alias for backwards compatibility.

## Resolution pipeline

1. `request.model` → look up `routing.requestedModelNormalization` → `ModelFamily`
2. `family + request.effort` → look up `routing.normalization[family]` → `RoutingTier`
3. Walk `routing.providerPriority`; for each provider skip it if its `providers.json` entry is `enabled: false`; check `routing.tiers[tier][provider]`
4. Classify the substitution as `exact | equivalent | fallback | downgrade | no_equivalent`
5. If `allowDowngrade: false` and family is `claude-opus`, skip `downgrade` / `no_equivalent`
6. Same-family preservation guard: when requested family is a Claude family and provider is `claude-code`, force the resolved family to match the requested Claude family; clamp effort to `FAMILY_EFFORTS` for that family
7. Resolve concrete model: claude/codex → `families[family].model`; vibe → `aliases["<family>/<thinking>"]`
8. Build `RoutingResolution` with `reason` string

## Routing tiers

| Tier              | Typical use                                  |
| ----------------- | -------------------------------------------- |
| `cheap`           | Haiku-class, no thinking                     |
| `fast`            | Sonnet/low — fast path, stays Sonnet         |
| `standard`        | Sonnet/medium — default                      |
| `strong`          | Sonnet/high                                  |
| `sonnet-xhigh`    | Sonnet/xhigh — best coding/agentic setting   |
| `very_strong`     | Sonnet/max or codex/high                     |
| `frontier-low`    | Opus/low; codex gpt/high (`equivalent`)      |
| `frontier-medium` | Opus/medium; codex gpt/xhigh (`equivalent`)  |
| `frontier-high`   | Opus/high; codex gpt/xhigh (`equivalent`)    |
| `frontier-xhigh`  | Opus/xhigh; codex gpt/xhigh (`equivalent`)   |
| `frontier-max`    | Opus/max; codex gpt/xhigh (`downgrade`)      |
| `frontier-ultra`  | Opus/ultracode only — no Mistral/OpenAI peer |

## Adding a new provider

1. Add the literal to `ProviderId` in `src/domain/routing/types.ts`.
2. Add the corresponding literal to `ProviderIdSchema` in `src/schemas/modelRouting.ts`.
3. Add tier entries in `DEFAULT_MODEL_ROUTING.tiers` (in `defaults.ts`).
4. Add a `ProviderEntry` in `DEFAULT_PROVIDER_CONFIG.providers`.
5. Create `src/infra/providers/<newProvider>.ts` with `runNewProviderAgent` + resume variant returning `AgentRunResult`.
6. Wire the new branch in `src/infra/providers/dispatcher.ts`.
7. Add tests in `tests/unit/providers/<newProvider>.test.ts` (no real CLI — mock the spawn).

## Adding a new model family

1. Add the literal to `ModelFamily` in `types.ts` and `ModelFamilySchema` in `modelRouting.ts`.
2. Add tier mappings in `DEFAULT_MODEL_ROUTING.normalization` and any `tiers` entries.
3. Add `requestedModelNormalization` entries for known versioned IDs.
4. Update `docs/model-routing.md` family table.

## Per-invocation provider priority override

Both `phax run` and `phax resume` accept `--provider-priority <list>` to override `providerPriority` for that invocation without touching any config file:

```bash
phax run --provider-priority mistral-vibe,claude-code
phax resume my-run --yes --provider-priority codex-cli,claude-code
```

Valid ids: `claude-code`, `mistral-vibe`, `codex-cli`. The list is parsed by `parseProviderPriority` in `src/domain/routing/priorityOverride.ts` (deduped, trimmed, validated; fails fast on empty/unknown). The override is applied by `applyProviderPriorityOverride` which returns a new `ModelRouting` with only `providerPriority` replaced.

**Caveat**: `claude-code` remains the guaranteed terminal fallback in `resolveModel` regardless of the override. An override that omits `claude-code` may still resolve to it when no listed provider can serve a tier.

## Worked examples (spec §15)

| Request        | Priority           | allowDowngrade | Result                                                                         |
| -------------- | ------------------ | -------------- | ------------------------------------------------------------------------------ |
| sonnet/medium  | mistral-vibe first | —              | mistral-vibe, `phax-mistral-medium-3.5-medium`, `equivalent`                   |
| sonnet/high    | codex-cli first    | —              | codex-cli, `gpt-5.5`, effort `medium`, `equivalent`                            |
| sonnet/low     | claude-code        | —              | claude-code, `claude-sonnet` (NOT haiku — same-family preserved)               |
| opus/low       | codex-cli first    | true           | codex-cli, `gpt-5.5`, effort `high`, `equivalent` (tier `frontier-low`)        |
| opus/medium    | codex-cli first    | true           | codex-cli, `gpt-5.5`, effort `xhigh`, `equivalent` (tier `frontier-medium`)    |
| opus/high      | codex-cli first    | true           | codex-cli, `gpt-5.5`, effort `xhigh`, `equivalent` (tier `frontier-high`)      |
| opus/xhigh     | codex-cli first    | true           | codex-cli, `gpt-5.5`, effort `xhigh`, `equivalent` (tier `frontier-xhigh`)     |
| opus/max       | codex-cli first    | true           | codex-cli, `gpt-5.5`, effort `xhigh`, `downgrade` (tier `frontier-max`)        |
| opus/max       | codex-cli first    | false          | claude-code, `claude-opus`, `exact` (`downgrade` skipped)                      |
| opus/ultracode | any                | false          | claude-code, `claude-opus/ultracode`, `frontier-ultra` tier (no peer anywhere) |
