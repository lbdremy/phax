# model-routing skill

Use this skill when extending the routing layer, adding provider adapters, changing the resolution algorithm, or adding new model families / tiers.

## Architecture overview

```
src/domain/routing/         ← PURE — no IO, no Effect, no infra imports
  types.ts                  ← ProviderId, ModelFamily, ThinkingLevel, RoutingTier, Relationship literals
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

**Telemetry never fails a run**: the `agent.model.resolved` event is emitted via `telemetry.recordEvent` and errors are swallowed.

**Atomic writes + backup**: `vibeSetup.ts` and the session writer use temp + rename; `vibeSetup.ts` backs up `~/.vibe/config.toml` before appending.

## Resolution pipeline

1. `request.model` → look up `routing.requestedModelNormalization` → `ModelFamily`
2. `family + request.effort` → look up `routing.normalization[family]` → `RoutingTier`
3. Walk `routing.providerPriority`; for each provider skip it if its `providers.json` entry is `enabled: false`; check `routing.tiers[tier][provider]`
4. Classify the substitution as `exact | equivalent | fallback | downgrade | no_equivalent`
5. If `allowDowngrade: false` and family is `claude-opus`, skip `downgrade` / `no_equivalent`
6. Resolve concrete model: claude/codex → `families[family].model`; vibe → `aliases["<family>/<thinking>"]`
7. Build `RoutingResolution` with `reason` string

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

## Worked examples (spec §15)

| Request       | Priority           | allowDowngrade | Result                                                       |
| ------------- | ------------------ | -------------- | ------------------------------------------------------------ |
| sonnet/medium | mistral-vibe first | —              | mistral-vibe, `phax-mistral-medium-3.5-medium`, `equivalent` |
| sonnet/high   | codex-cli first    | —              | codex-cli, `gpt-5.5`, thinking `medium`, `equivalent`        |
| opus/medium   | codex-cli          | true           | codex-cli, thinking `xhigh`, `fallback`                      |
| opus/high     | codex-cli          | false          | claude-code, `claude-opus`, `exact`                          |
