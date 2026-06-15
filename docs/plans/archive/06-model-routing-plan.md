# Implementation plan — Simplified multi-provider model routing

> Source spec: `.context/attachments/LWiMC1/pasted_text_2026-06-01_08-42-59.txt`
> ("PHAX Spec — Simplified Multi-Provider Model Routing").
> Deliverable location: `docs/plans/model-routing-plan.md`.
> Format: matches the phax-planning skill so `phax extract-plan` can consume
> this file and produce a `phax-plan.json`. Each phase carries an HTML anchor
> (`{#phase-NN-...}`) for the `planMarkdownAnchor` field.

---

## Context

PHAX today executes every phase through a single backend. The `Backend`
Context.Tag (`src/ports/backend.ts`) exposes `runAgent` / `resumeAgentSession`
and has exactly one implementation, `makeNodeBackendLayer`
(`src/infra/claudeCli.ts`), which spawns the `claude` binary directly. The
per-phase model and effort flow verbatim from `phax-plan.json`
(`phase.model`, `phase.effort`) into `AgentRunOptions` in
`src/app/executePlan.ts:304` and onto the `claude --model … --effort …`
argv. `phax.json` pins `agent.backend` to the literal `"claude-code-cli"`.

This feature adds a **provider-routing layer** so phases can run through three
provider families — Claude Code, Mistral Vibe, and OpenAI Codex — chosen by a
user-editable global routing config while preserving a reasonable
approximation of the requested capability. The routing layer never depends on
versioned model ids; it speaks in **stable model families**
(`claude-haiku`, `claude-sonnet`, `claude-opus`, `mistral-medium`,
`openai-chatgpt`) and a normalized **effort/thinking** axis
(`off|low|medium|high|xhigh|max`).

The resolution pipeline the spec describes (§10) is:

```txt
requested model id  ──normalize──▶  family + effort
family + effort     ──normalize──▶  PHAX tier            (§9)
tier + providerPriority           ▶  selected provider    (§7,§8)
selected provider   ──downgrade──▶  relationship          (§11)
selected provider   ──providerCfg─▶  concrete model/alias (§13)
                                  ▶  agent.model.resolved  (§16)
```

The design keeps the existing single `Backend` port but makes its
implementation a **provider dispatcher** keyed on a resolved `provider` field,
with one adapter module per provider. Resolution is a **pure domain function**;
all config (`~/.phax/model-routing.json`, `~/.phax/providers.json`,
`~/.vibe/config.toml`) is decoded through Effect Schema before it crosses into
the domain. Routing is **additive**: `extract-plan` stays on Claude Code, and
`agent.backend` / `run.backend` remain `"claude-code-cli"` as the legacy
default. The default routing table is the spec's §12 table; the default
provider config is the spec's §13 example.

The work is split into **11 sequential phases**. Phases 01–03 build the pure
vocabulary, the config loaders, and the resolution algorithm. Phase 04 adds the
semantic trace event. Phases 05–07 turn the backend into a provider dispatcher
and add the Mistral Vibe and OpenAI Codex adapters. Phase 08 wires resolution
into `executePlan`. Phase 09 adds the Vibe alias-setup command. Phase 10 adds
the `phax agent` user-facing commands. Phase 11 freezes the boundaries with
architectural guards and writes the docs and skill.

Default execution model is **claude-sonnet-4-6**. **claude-opus-4-7** is
reserved for phase-03 (the resolution algorithm), where the downgrade /
fallback / no-equivalent rules and their tie-breaks benefit from deeper
reasoning. Effort is calibrated to surface area, not intrinsic difficulty.

## Architecture target

```txt
src/schemas/
  modelRouting.ts        ← Effect Schema for ~/.phax/model-routing.json (§12).
  providerConfig.ts      ← Effect Schema for ~/.phax/providers.json (§13).
  vibeConfig.ts          ← Effect Schema for the ~/.vibe/config.toml [[models]] entries (§14).

src/domain/routing/
  types.ts               ← ProviderId, ModelFamily, ThinkingLevel, RoutingTier,
                            Relationship literals; RoutingRequest / RoutingResolution.
                            NO Effect, NO IO.
  defaults.ts            ← DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG constants (pure).
  resolve.ts             ← resolveModel(request, routing, providerCfg): RoutingResolution. Pure.

src/app/
  loadRouting.ts         ← read+decode model-routing.json / providers.json, fall back to defaults.

src/infra/providers/
  claudeCode.ts          ← claude spawn logic (extracted from claudeCli.ts).
  mistralVibe.ts         ← vibe spawn logic + VIBE_ACTIVE_MODEL env wiring.
  codexCli.ts            ← codex spawn logic.
  dispatcher.ts          ← makeNodeBackendLayer(providerConfig): selects adapter by options.provider.

src/app/vibeSetup.ts     ← read/copy/append ~/.vibe/config.toml aliases, backup, atomic write.

src/cli/commands/agent.ts ← `phax agent models | resolve | probe | setup mistral-vibe`.

src/domain/telemetry/events.ts          ← + ModelResolvedTelemetryEvent ("agent.model.resolved").
src/domain/telemetry/snapshot.ts        ← + projection of the new event.
src/schemas/telemetryEvents.ts          ← + schema for the new event.
src/infra/telemetry/openTelemetry.ts    ← + OTel mapping for the new event.
```

## Cross-phase invariants (apply to every phase)

- **Domain stays pure**: nothing under `src/domain/` (including
  `src/domain/routing/`) may import Effect, any provider CLI, `@opentelemetry/*`,
  the FileSystem port, or any infra module. `resolveModel` is a total pure
  function over its inputs.
- **External config crosses a schema boundary**: `model-routing.json`,
  `providers.json`, and `~/.vibe/config.toml` are decoded through Effect Schema
  (with `onExcessProperty: "error"` where the spec implies a closed shape)
  before any value reaches the domain. Loaders never `JSON.parse` straight into
  domain types.
- **Providers own their CLI**: only modules under `src/infra/providers/` may
  `spawn` a provider binary (`claude`, `vibe`, `codex`). `src/app/` and
  `src/domain/` never spawn.
- **Routing is additive and non-breaking**: existing Claude-only runs and all
  current tests must keep passing. `extract-plan`, `run.backend`, and
  `agent.backend` keep their current `"claude-code-cli"` behavior; routing only
  governs phase execution model selection.
- **No silent Opus downgrade**: when the requested family is `claude-opus` and
  `allowDowngrade` is `false`, resolution must not select a weaker provider
  unless the user explicitly configured that tier mapping; it falls through to
  `claude-code` / `claude-opus`.
- **Telemetry must never fail a run**: the new `agent.model.resolved` event
  obeys the observability doctrine (swallowed IO, snapshot projects semantics
  only, `runId` is the correlation anchor).
- **Atomic writes**: any write to `~/.vibe/config.toml` uses temp-file + rename
  and is preceded by a timestamped backup; the file is never edited in place.
- **No new `any`** in `domain/` or `app/`. New persisted/config fields are
  required, not optional-for-legacy (no back-compat shims in schemas).
- After every phase the commit must pass `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm knip`, `pnpm test`, `pnpm audit:architecture`, and
  `pnpm build` (the `full` gate profile from `phax.json`).

---

## Model & effort summary

| #   | Phase                                                   | Model               | Effort |
| --- | ------------------------------------------------------- | ------------------- | ------ |
| 01  | Routing vocabulary + config schemas                     | claude-sonnet-4-6   | medium |
| 02  | Default tables + global config loader                   | claude-sonnet-4-6   | low    |
| 03  | Pure model-resolution algorithm                         | **claude-opus-4-7** | high   |
| 04  | `agent.model.resolved` telemetry event                  | claude-sonnet-4-6   | low    |
| 05  | Provider dispatcher backend + Claude adapter extraction | claude-sonnet-4-6   | medium |
| 06  | Mistral Vibe provider adapter                           | claude-sonnet-4-6   | medium |
| 07  | OpenAI Codex provider adapter                           | claude-sonnet-4-6   | medium |
| 08  | Wire resolution into `executePlan` + `extract-plan`     | claude-sonnet-4-6   | medium |
| 09  | `phax agent setup mistral-vibe` alias installer         | claude-sonnet-4-6   | high   |
| 10  | `phax agent` models / resolve / probe commands          | claude-sonnet-4-6   | medium |
| 11  | Architectural guards, docs, and routing skill           | claude-sonnet-4-6   | low    |

---

## phase-01 — Routing vocabulary and config schemas {#phase-01-routing-schemas}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Introduce the pure-domain routing vocabulary and the Effect Schemas for the two
global config files. No IO, no resolution logic yet — just the closed type
system every later phase maps to.

### Detailed instructions

- Create `src/domain/routing/types.ts` (pure, no imports beyond `branded.js`):
  - String-literal unions and exported types:
    - `ProviderId = "claude-code" | "mistral-vibe" | "codex-cli"`.
    - `ModelFamily = "claude-haiku" | "claude-sonnet" | "claude-opus" | "mistral-medium" | "openai-chatgpt"`.
    - `ThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh" | "max"`.
    - `RoutingTier = "cheap" | "fast" | "standard" | "strong" | "very_strong" | "frontier" | "max"`.
    - `Relationship = "exact" | "equivalent" | "fallback" | "downgrade" | "no_equivalent"`.
  - `RoutingRequest` interface: `{ readonly model: string; readonly effort: ThinkingLevel }`
    (`model` is the raw requested id from the plan, e.g. `"claude-sonnet-4-6"`).
  - `RoutingResolution` interface mirroring §16:
    `{ requested: { model: string; family: ModelFamily; effort: ThinkingLevel }; normalizedTier: RoutingTier; selected: { provider: ProviderId; family: ModelFamily; thinking?: ThinkingLevel; concreteModel: string }; relationship: Relationship; reason: string }`.
- Create `src/schemas/modelRouting.ts` with `ModelRoutingSchema` matching §12,
  using `Schema.Literal` for the unions above. Shape:
  - `version: Schema.Literal(1)`.
  - `providerPriority: Schema.NonEmptyArray(ProviderIdSchema)`.
  - `allowDowngrade: Schema.Boolean`.
  - `defaultTier: RoutingTierSchema`.
  - `families: Schema.Record({ key: Schema.String, value: Schema.Array(ModelFamilySchema) })`.
  - `tiers: Schema.Record({ key: RoutingTierSchema, value: Schema.Record({ key: ProviderIdSchema, value: TierEntrySchema }) })`
    where `TierEntrySchema = { family: ModelFamilySchema, effort?: ThinkingLevelSchema, thinking?: ThinkingLevelSchema, relationship?: RelationshipSchema }`.
  - `normalization: Schema.Record({ key: ModelFamilySchema, value: NormalizationEntrySchema })`
    where `NormalizationEntrySchema` is a union of `{ defaultTier: RoutingTierSchema }`
    and a partial `Record(ThinkingLevel, RoutingTier)` (model the per-effort map
    as `Schema.partial(Schema.Struct({ off, low, medium, high, xhigh, max }))`).
  - `requestedModelNormalization: Schema.Record({ key: Schema.String, value: ModelFamilySchema })`
    — maps a raw requested model id to its family (e.g. `"claude-sonnet-4-6" → "claude-sonnet"`).
    This is the §9 model-id→family step; it is configurable.
  - Export `decodeModelRouting = Schema.decodeUnknownEither(ModelRoutingSchema, { onExcessProperty: "error" })`
    and `type ModelRouting = Schema.Schema.Type<typeof ModelRoutingSchema>`.
- Create `src/schemas/providerConfig.ts` with `ProviderConfigSchema` matching §13:
  - `providers: Schema.Record({ key: ProviderIdSchema, value: ProviderEntrySchema })`
    where `ProviderEntrySchema = { enabled: Schema.Boolean, executable: Schema.NonEmptyString, modelEnvVar?: Schema.NonEmptyString, defaultAgent?: Schema.NonEmptyString, output?: Schema.NonEmptyString, families?: Schema.Record({ key: ModelFamilySchema, value: Schema.Struct({ model: Schema.NonEmptyString }) }), aliases?: Schema.Record({ key: Schema.String, value: Schema.NonEmptyString }) }`.
  - Export `decodeProviderConfig` and `type ProviderConfig`.
- Re-export the literal schemas (`ProviderIdSchema`, `ModelFamilySchema`,
  `ThinkingLevelSchema`, `RoutingTierSchema`, `RelationshipSchema`) from
  `modelRouting.ts` so `providerConfig.ts` and later phases share one source.
- Keep `src/domain/routing/types.ts` free of any `Schema` import — schemas live
  under `src/schemas/`, domain literals are plain TS unions; the schema literal
  members must be kept in sync with the domain unions (a type-level test in
  phase-03 / a guard in phase-11 will pin this).

### Included scope

- `src/domain/routing/types.ts`, `src/schemas/modelRouting.ts`,
  `src/schemas/providerConfig.ts`.
- A unit test `tests/unit/routing/schemas.test.ts` that decodes the spec's §12
  and §13 example JSON, rejects unknown top-level keys, rejects an invalid
  provider id / tier / thinking level, and accepts both `{ defaultTier }` and
  per-effort normalization entries.

### Excluded scope

- No resolution logic, no defaults constants, no loaders, no backend changes.
- No `~/.vibe/config.toml` schema yet (phase-09).

### Expected handoff content

- Exact exported names and module paths for the literal schemas and decoders.
- The `RoutingRequest` / `RoutingResolution` field list as the contract phase-03
  must produce and phase-08 must consume.
- Confirmation that `tests/unit/routing/schemas.test.ts` passes under
  `pnpm test` and `pnpm typecheck`.

### Commit subject

feat(routing): add model-routing vocabulary and config schemas

### Commit body

Introduce the pure-domain routing literals (ProviderId, ModelFamily,
ThinkingLevel, RoutingTier, Relationship) and the RoutingRequest /
RoutingResolution contracts under src/domain/routing/types.ts, plus the Effect
Schemas for ~/.phax/model-routing.json and ~/.phax/providers.json under
src/schemas/. Schemas reject unknown keys and decode the spec's default example
files. No resolution logic or IO yet.

---

## phase-02 — Default tables and global config loader {#phase-02-config-loader}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Provide the built-in default routing table and provider config, and an
application-layer loader that reads the user's global files when present,
decodes them through the phase-01 schemas, and falls back to the defaults
otherwise.

### Detailed instructions

- Create `src/domain/routing/defaults.ts` (pure):
  - `DEFAULT_MODEL_ROUTING: ModelRouting` — the spec §12 multi-provider table, plus a
    `requestedModelNormalization` seeded with the known plan model ids:
    `"claude-haiku-4-5-20251001" → "claude-haiku"`, `"claude-sonnet-4-6" → "claude-sonnet"`,
    `"claude-opus-4-7" → "claude-opus"`, and the bare aliases `"haiku" → "claude-haiku"`,
    `"sonnet" → "claude-sonnet"`, `"opus" → "claude-opus"`.
    **Note**: This plan predates the enabled-gating plan (`model-routing-enabled-gating-plan.md`).
    The shipped implementation of this phase used a Claude-only table
    (`providerPriority: ["claude-code"]`, `allowDowngrade: false`) for
    non-breaking safety. The §12 multi-provider table became the default only
    after resolution was gated on the `enabled` flag, allowing `mistral-vibe`
    and `codex-cli` to ship disabled by default.
  - `DEFAULT_PROVIDER_CONFIG: ProviderConfig` — the spec §13 object.
  - Typecheck these constants against the schema-derived types so drift fails
    the build.
- Create `src/app/loadRouting.ts` using the `FileSystem` port:
  - `MODEL_ROUTING_PATH = join(homedir(), ".phax", "model-routing.json")` and
    `PROVIDER_CONFIG_PATH = join(homedir(), ".phax", "providers.json")`
    (spec §6 pins `~/.phax/model-routing.json` literally — use `homedir()`, not
    `config.state.root`).
  - `loadModelRouting(): Effect<ModelRouting, ConfigValidationError, FileSystem>`:
    if the file does not exist, return `DEFAULT_MODEL_ROUTING`; otherwise read,
    `JSON.parse`, `decodeModelRouting`, and on a decode failure fail with
    `ConfigValidationError` carrying `formatParseError` output and the path.
  - `loadProviderConfig()` analogously returning `DEFAULT_PROVIDER_CONFIG` when
    absent.
  - Do not auto-write the default file to disk in this phase (keep the loader
    read-only and side-effect free beyond the read).
- Reuse the existing `ConfigValidationError` (`src/domain/errors.ts`) and
  `formatParseError` (`src/schemas/formatError.ts`).

### Included scope

- `src/domain/routing/defaults.ts`, `src/app/loadRouting.ts`.
- `tests/unit/routing/loadRouting.test.ts` using the fake FileSystem
  (`src/infra/fakes/fs.ts`): returns defaults when files are absent; decodes a
  valid user file; fails with `ConfigValidationError` on malformed JSON and on
  schema violations.

### Excluded scope

- No resolution algorithm (phase-03). No writing defaults to disk. No CLI.

### Expected handoff content

- The two absolute config path constants and the loader function signatures.
- Whether the fake FileSystem needed any new capability (note it for phase-08).
- Confirmation the new tests pass under `pnpm test`.

### Commit subject

feat(routing): add default routing tables and global config loader

### Commit body

Add DEFAULT_MODEL_ROUTING and DEFAULT_PROVIDER_CONFIG (spec §12/§13) under
src/domain/routing/defaults.ts and a FileSystem-port loader (src/app/loadRouting.ts)
that reads ~/.phax/model-routing.json and ~/.phax/providers.json, decodes them
through the phase-01 schemas, and falls back to the built-in defaults when the
files are absent. Malformed or invalid files fail with ConfigValidationError.

---

## phase-03 — Pure model-resolution algorithm {#phase-03-resolve}

**Recommended model:** claude-opus-4-7
**Recommended effort:** high

### Objective

Implement `resolveModel` — the pure function that maps a `RoutingRequest` to a
`RoutingResolution` using the routing table and provider config, honoring
provider priority, downgrade policy, and the §11 relationship classification.
This is the heart of the feature.

### Detailed instructions

- Create `src/domain/routing/resolve.ts` exporting
  `resolveModel(request: RoutingRequest, routing: ModelRouting, providerCfg: ProviderConfig): RoutingResolution`.
  Pure, total, no throws — return a resolution for every input.
- Steps (spec §9, §10, §11):
  1. **Model → family**: look up `request.model` in
     `routing.requestedModelNormalization`. If unknown, fall back to a
     deterministic heuristic (substring match on `sonnet`/`opus`/`haiku`/
     `mistral`/`gpt|openai|chatgpt`), and if still unknown route to
     `routing.defaultTier` with family treated as `claude-sonnet`.
  2. **Family + effort → tier**: read `routing.normalization[family]`. If the
     entry is `{ defaultTier }`, use it; otherwise look up `request.effort` in
     the per-effort map, falling back to `routing.defaultTier` when the level is
     absent.
  3. **Tier + priority → provider**: walk `routing.providerPriority` in order;
     for each provider take `routing.tiers[tier][provider]` if present.
  4. **Relationship classification** for a candidate entry:
     - `exact` when the candidate provider's family equals the requested family
       and the candidate thinking/effort equals the requested effort.
     - `equivalent` when the entry has no explicit `relationship` and is not the
       requested family but the tier is a same-level mapping.
     - `fallback` / `downgrade` / `no_equivalent` taken from the entry's
       explicit `relationship` field when present (the §12 table marks
       `frontier`/`max` codex entries as `fallback`/`downgrade`).
  5. **Downgrade gate**: if the requested family is `claude-opus` and the
     candidate's relationship is `downgrade` (or `no_equivalent`), skip the
     candidate when `routing.allowDowngrade` is `false`. `fallback` candidates
     for opus low/medium are allowed (§11). Always keep walking the priority
     list; if no acceptable non-claude candidate is found, select
     `claude-code` for the tier (the guaranteed terminal provider), with
     relationship `exact` when its family/effort match the request, else
     `equivalent`.
  6. **Concrete model resolution** via provider config:
     - `claude-code`: `providerCfg.providers["claude-code"].families[family].model`.
     - `codex-cli`: `providerCfg.providers["codex-cli"].families[family].model`;
       carry the entry's `thinking` separately.
     - `mistral-vibe`: `providerCfg.providers["mistral-vibe"].aliases["<family>/<thinking>"]`
       (e.g. `"mistral-medium/medium"`). If the alias is missing, that
       candidate is unusable — skip it and continue the priority walk.
  7. Build `reason` as a short human sentence echoing the spec's §16 example
     ("Provider priority selected …; <family> <effort> maps to <tier>; …").
- Keep all branching data-driven off the decoded config; no hard-coded tier
  names beyond the literal unions.

### Included scope

- `src/domain/routing/resolve.ts`.
- `tests/unit/routing/resolve.test.ts` covering, against
  `DEFAULT_MODEL_ROUTING` / `DEFAULT_PROVIDER_CONFIG`, at minimum:
  - Spec §15 Example 1 — sonnet/medium, mistral priority → mistral-vibe,
    `mistral-medium`, thinking `medium`, alias `phax-mistral-medium-3.5-medium`,
    relationship `equivalent`.
  - Spec §15 Example 2 — sonnet/high, codex priority → codex-cli,
    `openai-chatgpt`, thinking `medium`, relationship `equivalent`.
  - Spec §15 Example 3 — opus/medium, mistral priority, allowDowngrade true →
    tier `frontier`, codex-cli `xhigh`, relationship `fallback`.
  - Spec §15 Example 4 — opus/high, mistral priority: `allowDowngrade: true` →
    codex-cli downgrade; `allowDowngrade: false` → claude-code / `opus`.
  - An unknown requested model id routes to `defaultTier`.
- A type-level test `tests/type/routing.ts` asserting the literal unions in
  `domain/routing/types.ts` and the schema literals stay in sync (exhaustive
  `satisfies` check).

### Excluded scope

- No telemetry emission (phase-04/08), no backend changes, no IO. `resolveModel`
  takes already-decoded config as plain arguments.

### Expected handoff content

- The exact `resolveModel` signature and the `RoutingResolution` shape returned.
- The skip/fallthrough rules implemented for downgrade and missing aliases, so
  phase-08 can rely on the terminal `claude-code` guarantee.
- Confirmation all §15 example tests pass under `pnpm test`.

### Commit subject

feat(routing): implement pure model-resolution algorithm

### Commit body

Add resolveModel under src/domain/routing/resolve.ts: a total, pure function
mapping a RoutingRequest to a RoutingResolution. It normalizes the requested
model id to a family, maps family+effort to a PHAX tier, walks providerPriority,
classifies the substitution (exact|equivalent|fallback|downgrade|no_equivalent),
enforces the no-silent-Opus-downgrade rule, and resolves the concrete model or
Vibe alias from provider config. Covers all four spec §15 resolution examples.

---

## phase-04 — `agent.model.resolved` telemetry event {#phase-04-telemetry-event}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Add the `agent.model.resolved` semantic telemetry event (spec §16) end to end
through the observability stack — domain event, factory, snapshot projection,
schema, and OTel mapping — without yet emitting it.

### Detailed instructions

- `src/domain/telemetry/events.ts`: add `ModelResolvedTelemetryEvent` with
  `type: "agent.model.resolved"`, `runId: RunId`, optional `operationId`, and
  the §16 payload fields as plain strings:
  `requestedFamily`, `requestedEffort`, `normalizedTier`, `selectedProvider`,
  `selectedFamily`, `selectedConcreteModel`, optional `selectedThinking`,
  `relationship`, `reason`. Add it to the `SemanticTelemetryEvent` union and
  add `makeModelResolvedTelemetryEvent`.
- `src/domain/telemetry/snapshot.ts`: extend `SemanticTraceSnapshotEntry` with
  the new optional fields and add the `case "agent.model.resolved"` projection
  (semantics only — no timestamps/ids).
- `src/schemas/telemetryEvents.ts`: add `ModelResolvedTelemetryEventSchema` and
  include it in the union so JSON-file telemetry round-trips.
- `src/infra/telemetry/openTelemetry.ts`: map `agent.model.resolved` to an OTel
  span event / log consistent with the existing adapter mappings, putting the
  payload on attributes (follow the established `phax.*` attribute convention).
- Follow the doctrine: the new event is recorded via `recordEvent` and must
  never throw.

### Included scope

- The five files above plus the matching unit tests in
  `tests/unit/telemetry/` (events factory, snapshot projection, schema decode)
  and any OTel mapping test under `tests/unit/telemetry/openTelemetry.test.ts`.
- Update existing telemetry snapshot fixtures only if the union-exhaustiveness
  check requires it; do not emit the event anywhere yet.

### Excluded scope

- No emission from `executePlan` (phase-08). No routing logic changes.

### Expected handoff content

- The `makeModelResolvedTelemetryEvent` signature and field names, so phase-08
  can populate it directly from a `RoutingResolution`.
- Any snapshot fixture that changed and why.

### Commit subject

feat(telemetry): add agent.model.resolved semantic event

### Commit body

Add the ModelResolvedTelemetryEvent ("agent.model.resolved", spec §16) through
the full observability stack: domain event + factory, snapshot projection,
Effect Schema for JSON-file round-trip, and OpenTelemetry attribute mapping.
The event is defined but not yet emitted; phase-08 will record it from a
RoutingResolution. Telemetry still never fails a run.

---

## phase-05 — Provider dispatcher backend and Claude adapter extraction {#phase-05-dispatcher}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Turn the single Claude backend into a provider dispatcher. Extract the existing
`claude` spawn logic into `src/infra/providers/claudeCode.ts`, add a `provider`
field to `AgentRunOptions`, and make `makeNodeBackendLayer(providerConfig)`
select the adapter by `options.provider`. Behavior for Claude must be identical.

### Detailed instructions

- `src/ports/backend.ts`: add `readonly provider: ProviderId` to
  `AgentRunOptions` (import `ProviderId` from `domain/routing/types.js`).
- Move the spawn/argv/output-parsing/`persistSessionId` logic from
  `src/infra/claudeCli.ts` into `src/infra/providers/claudeCode.ts`, exposing
  `runClaudeAgent(prompt, options): Effect<AgentRunResult, …>` and the resume
  variant. Keep the exact `claude` argv (`--print --output-format stream-json
--verbose --permission-mode bypassPermissions --model … --effort …`) and the
  rate-limit classification unchanged.
- Create `src/infra/providers/dispatcher.ts` exporting
  `makeNodeBackendLayer(providerConfig: ProviderConfig): Layer<Backend>`. The
  implementation switches on `options.provider`: `"claude-code"` → claudeCode
  adapter; `"mistral-vibe"` / `"codex-cli"` → throw a clear
  `ClaudeInvocationError`-style "provider not yet wired" failure for now
  (phases 06/07 fill these in). Pass `providerConfig.providers[provider]` to
  each adapter so it knows its executable/env/agent.
- Keep `src/infra/claudeCli.ts` as a thin re-export of
  `makeNodeBackendLayer` from `dispatcher.ts` (and `runClaudeAgent` from
  `claudeCode.ts`) so existing import sites (`runLayers.ts`,
  `extractPlan.ts`) keep compiling. Update the signature: callers now pass a
  `ProviderConfig`. In `runLayers.provideRunLayers` and `extractPlan.ts`, thread
  the loaded provider config (from phase-02) into `makeNodeBackendLayer(...)`.
- Update the architectural guard allowlist: the status-writer
  (`persistSessionId`) now lives in `src/infra/providers/claudeCode.ts`, so add
  that path to `DOCUMENTED_METADATA_WRITERS` in
  `tests/unit/architecturalGuards.test.ts` and remove `src/infra/claudeCli.ts`
  if it no longer imports a status encoder.
- All existing call sites that build `AgentRunOptions` must now set
  `provider: "claude-code"` (executePlan, extractPlan); fixLoop and
  handoffGeneration reuse the passed options, so they inherit it automatically.

### Included scope

- `src/ports/backend.ts`, `src/infra/providers/claudeCode.ts`,
  `src/infra/providers/dispatcher.ts`, `src/infra/claudeCli.ts` (re-export),
  call-site updates in `runLayers.ts`, `extractPlan.ts`, `executePlan.ts`, the
  fake backend (`src/infra/fakes/backend.ts` — add `provider` to recorded
  options), and the guard allowlist update.
- `tests/integration/dispatcher.test.ts` (or extend the existing one): a
  `claude-code` option routes to the Claude adapter; an unwired provider fails
  clearly.

### Excluded scope

- No Mistral/Codex spawn logic yet. No resolution wiring (phase-08).

### Expected handoff content

- The new `makeNodeBackendLayer(providerConfig)` signature and the
  `claudeCode.ts` exported functions.
- Confirmation the full existing test suite (`pnpm test`) still passes — this is
  a behavior-preserving refactor for Claude.
- The exact guard allowlist change made.

### Commit subject

refactor(backend): make the backend a provider dispatcher

### Commit body

Add a provider field to AgentRunOptions and turn makeNodeBackendLayer into a
dispatcher keyed on options.provider. Extract the existing claude spawn logic
into src/infra/providers/claudeCode.ts unchanged, add src/infra/providers/
dispatcher.ts, and keep src/infra/claudeCli.ts as a thin re-export so existing
import sites keep working. The layer now takes a ProviderConfig. Claude behavior
is identical; Mistral/Codex providers fail with a clear "not yet wired" error
until phases 06/07. Guard allowlist updated for the moved status writer.

---

## phase-06 — Mistral Vibe provider adapter {#phase-06-mistral-vibe}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Implement the `mistral-vibe` adapter: spawn the `vibe` CLI with the resolved
PHAX-owned alias selected through its model env var, capture the session id and
final text into an `AgentRunResult`, and wire it into the dispatcher.

### Detailed instructions

- Create `src/infra/providers/mistralVibe.ts` exposing
  `runVibeAgent(prompt, options, providerEntry)` and the resume variant,
  matching the `claudeCode.ts` shape and returning the same `AgentRunResult`.
- Invocation (spec §13 provider config):
  - Spawn `providerEntry.executable` (`vibe`) with the working directory
    `options.cwd`; set `process` env so `providerEntry.modelEnvVar`
    (`VIBE_ACTIVE_MODEL`) equals `options.model` (the resolved alias such as
    `phax-mistral-medium-3.5-medium`).
  - Use `providerEntry.defaultAgent` (`auto-approve`) and the streaming output
    mode for non-interactive runs (mirror the headless guarantees the Claude
    adapter has: no interactive approval prompts).
  - Stream stdout to `options.outputJsonlPath` exactly like the Claude adapter,
    and persist the session id to the phase folder when
    `options.phaseFolderPath` is set (reuse the shared `persistSessionId` /
    atomic-write helper — extract it to a small shared module under
    `src/infra/providers/` if needed so both adapters use one writer).
  - Parse the Vibe stream to extract a session id and the final assistant text.
    Encapsulate the parse in a tiny schema/helper under `src/schemas/` so the
    boundary is decoded, not hand-walked; on a missing session id fail with
    `ClaudeSessionIdMissingError` (the generic "agent session id missing" error
    — keep the existing error type, it is provider-agnostic in meaning).
  - Reuse the existing rate-limit classification path if Vibe surfaces a
    comparable signal; otherwise map a non-zero exit to `ClaudeInvocationError`
    with the captured argv/stderr.
- Wire the `"mistral-vibe"` branch of `dispatcher.ts` to this adapter.

### Included scope

- `src/infra/providers/mistralVibe.ts`, the shared session-writer extraction (if
  any), the Vibe output schema/helper, the dispatcher branch, and a unit test
  `tests/unit/providers/mistralVibe.test.ts` driving the parse helper and argv
  builder over recorded sample output (no real `vibe` process — abstract the
  spawn the same way the Claude adapter is exercised in tests).

### Excluded scope

- No alias installation (phase-09) — this phase assumes the aliases already
  exist. No resolution wiring (phase-08). No Codex adapter.

### Expected handoff content

- The exact env var / argv used to invoke `vibe`, and the output-parse contract
  (where session id and final text come from).
- Any shared session-writer module path created.
- Confirmation tests pass under `pnpm test`.

### Commit subject

feat(providers): add Mistral Vibe backend adapter

### Commit body

Implement src/infra/providers/mistralVibe.ts: spawn the vibe CLI headlessly with
the resolved PHAX alias selected via VIBE_ACTIVE_MODEL and the auto-approve
agent, stream output to the phase folder, decode the session id and final text
through a schema boundary, and persist the session id atomically. Wire the
mistral-vibe branch of the dispatcher. Tests drive the argv builder and output
parser over recorded samples without a real vibe process.

---

## phase-07 — OpenAI Codex provider adapter {#phase-07-codex}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Implement the `codex-cli` adapter: spawn the `codex` CLI with the resolved
OpenAI model and reasoning/thinking level, capture the result, and wire it into
the dispatcher.

### Detailed instructions

- Create `src/infra/providers/codexCli.ts` exposing `runCodexAgent` and the
  resume variant, returning `AgentRunResult`, mirroring the other adapters.
- Invocation (spec §13): spawn `providerEntry.executable` (`codex`) in
  `options.cwd`, pass the concrete model (`providerEntry.families["openai-chatgpt"].model`,
  e.g. `gpt-5.5`) and the normalized thinking level (`options.effort`) mapped to
  Codex's reasoning flag. Run non-interactively with no approval prompts.
- Stream output to `options.outputJsonlPath`, decode the session id + final text
  through a small schema/helper, persist the session id via the shared writer.
- Map failures to `ClaudeInvocationError` / `ClaudeSessionIdMissingError` and
  reuse rate-limit classification if Codex surfaces a comparable signal.
- Wire the `"codex-cli"` branch of `dispatcher.ts` to this adapter.

### Included scope

- `src/infra/providers/codexCli.ts`, the Codex output schema/helper, the
  dispatcher branch, and `tests/unit/providers/codexCli.test.ts` driving the
  argv builder and parser over recorded samples (no real `codex` process).

### Excluded scope

- No resolution wiring (phase-08). No Vibe/Claude changes.

### Expected handoff content

- The Codex argv (model + reasoning flag) and the output-parse contract.
- Confirmation that all three provider branches of the dispatcher are now
  implemented, and tests pass under `pnpm test`.

### Commit subject

feat(providers): add OpenAI Codex backend adapter

### Commit body

Implement src/infra/providers/codexCli.ts: spawn the codex CLI headlessly with
the resolved openai-chatgpt model and normalized reasoning/thinking level,
stream output to the phase folder, decode the session id and final text through
a schema boundary, and persist the session id atomically. Wire the codex-cli
branch of the dispatcher. Tests drive the argv builder and parser over recorded
samples without a real codex process.

---

## phase-08 — Wire resolution into executePlan and extract-plan {#phase-08-wire-execute}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Make `executePlan` resolve each phase's model through the routing layer before
invoking the backend: load the global config once, call `resolveModel`, emit
`agent.model.resolved`, and build the resolved `AgentRunOptions`
(`provider` + concrete `model` + `effort`/thinking). Record the resolution in
the phase trace.

### Detailed instructions

- In the `run` command path (`src/cli/commands/run.ts` and `runLayers.ts`):
  load `ModelRouting` and `ProviderConfig` via phase-02 loaders, pass the
  provider config to `makeNodeBackendLayer(providerConfig)`, and thread the
  routing table into `executePlan` (extend `ExecutePlanOptions` with
  `routing: ModelRouting`).
- In `src/app/executePlan.ts`, before building `agentOptions` (currently
  `executePlan.ts:304`):
  - Build a `RoutingRequest` from the phase: `{ model: phase.model, effort: phase.effort }`
    (the plan `effort` is `low|medium|high`, a subset of `ThinkingLevel`).
  - Call `resolveModel(request, routing, providerConfig)`.
  - Emit `makeModelResolvedTelemetryEvent` populated from the resolution
    (`runId`, `operationId: phase.id`, plus the §16 fields) via
    `telemetry.recordEvent`.
  - Build `agentOptions` with `provider: resolution.selected.provider`,
    `model: resolution.selected.concreteModel`,
    `effort: resolution.selected.thinking ?? phase.effort`, keeping `cwd`,
    `outputJsonlPath`, `phaseFolderPath` as today. fixLoop and handoffGeneration
    keep reusing this `agentOptions` unchanged.
  - Update the adapter-call telemetry `adapter` label from the hard-coded
    `"claude-code-cli"` to `resolution.selected.provider` so the trace reflects
    the real provider.
- Persist a small `model-resolution.json` (or extend the phase `status.json` —
  prefer a separate artifact to avoid touching the single-status-writer guard)
  in the phase folder via the FileSystem port's atomic write, so the resolution
  is inspectable post-run (spec §16 "record the resolution in the run trace").
- `extract-plan` stays Claude-only: keep its explicit
  `provider: "claude-code"` option; do not route it.

### Included scope

- `src/cli/commands/run.ts`, `src/cli/commands/runLayers.ts`,
  `src/app/executePlan.ts`, and an integration test
  `tests/integration/routing.test.ts`: with a fake dispatcher backend and a
  routing table whose priority is `mistral-vibe` first, a `claude-sonnet-4-6` /
  `medium` phase resolves to `mistral-vibe` and the fake records
  `provider: "mistral-vibe"` and the resolved alias in its captured options; the
  `agent.model.resolved` event appears in the in-memory snapshot.

### Excluded scope

- No new CLI subcommands (phase-10). No changes to the plan schema or
  phax-planning skill.

### Expected handoff content

- Where the resolution artifact is written and its shape.
- The updated `ExecutePlanOptions` and `run` command wiring.
- Confirmation the routing integration test and the full suite pass under
  `pnpm test`.

### Commit subject

feat(routing): resolve per-phase model through the routing layer

### Commit body

Load ~/.phax/model-routing.json and providers.json in the run path, thread them
into executePlan and the backend dispatcher, and resolve each phase's requested
model+effort through resolveModel before invoking the agent. Emit the
agent.model.resolved telemetry event, build AgentRunOptions from the resolution
(provider + concrete model/alias + thinking), label adapter telemetry with the
real provider, and persist a per-phase model-resolution artifact. extract-plan
stays Claude-only.

---

## phase-09 — `phax agent setup mistral-vibe` alias installer {#phase-09-vibe-setup}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

### Objective

Add the helper that prepares PHAX-owned Vibe model aliases in
`~/.vibe/config.toml` (spec §14) using an **append-only** strategy: read the
base model's scalar fields with a targeted read-only scan, then append five new
`phax-mistral-medium-3.5-*` `[[models]]` blocks changing only `alias` and
`thinking`. Existing bytes are never rewritten, so user entries and
`active_model` cannot be corrupted. Support `--dry-run` and
`--install-model-aliases`.

### Detailed instructions

- **No TOML parser dependency.** This is deliberately append-only: PHAX only
  ever concatenates new `[[models]]` blocks onto the end of the file; it never
  parses, reformats, or rewrites existing content.
- Create `src/schemas/vibeConfig.ts` with a small typed `VibeBaseModel`
  describing only the scalar fields PHAX needs to copy (spec §14):
  `name`, `provider`, `temperature`, `input_price`, `output_price`,
  `auto_compact_threshold`. Provide a pure helper
  `extractBaseModel(tomlText, baseAlias): Either<VibeBaseModel, string>` that
  does a line-oriented read-only scan: locate the `[[models]]` block whose
  `alias = "<baseAlias>"`, read that block's `key = value` scalar lines, and
  decode them through an Effect Schema (fail with a clear message if the block
  or a required scalar is missing). It must not attempt to understand the rest
  of the file.
- Create a pure helper `renderPhaxAliasBlocks(base, levels): string` that emits
  the spec §14 TOML shape — one `# Added by PHAX.` comment + `[[models]]` block
  per thinking level, reusing the base scalars verbatim and setting only
  `alias = "phax-mistral-medium-3.5-<level>"` and `thinking = "<level>"`.
- Create `src/app/vibeSetup.ts` using the FileSystem port:
  1. Read `~/.vibe/config.toml`; if absent, fail with a clear
     `ConfigValidationError`.
  2. Run `extractBaseModel` for the base alias (default `mistral-medium-3.5`);
     if the base block is not found, report clearly and abort.
  3. Determine which of the five aliases
     (`phax-mistral-medium-3.5-{off,low,medium,high,max}`) are **already
     present** by scanning the text for their `alias = "…"` lines. Render
     blocks only for the missing ones (idempotent — re-running appends nothing
     when all five exist).
  4. New file content = original text (unchanged, byte-for-byte) + a separating
     newline + the rendered blocks. `active_model` is untouched because nothing
     existing is rewritten.
  5. Create a timestamped backup (`~/.vibe/config.toml.phax-backup-<ts>`)
     before writing; write atomically (temp + rename).
  6. If `off` or `max` thinking levels are not supported by the installed Vibe
     version, report that clearly (best-effort: note it; do not silently drop).
- `--dry-run`: print the aliases that would be appended and the backup path;
  make no writes.

### Included scope

- `src/schemas/vibeConfig.ts` (the `VibeBaseModel` schema + `extractBaseModel` +
  `renderPhaxAliasBlocks` helpers), `src/app/vibeSetup.ts`, and a unit test
  `tests/unit/routing/vibeSetup.test.ts` using the fake FileSystem:
  dry-run lists the five aliases and writes nothing; install appends all five
  preserving the base scalars; re-running appends nothing (idempotent, no
  duplicates); a partially-installed file appends only the missing aliases; a
  missing base block is reported; the original bytes (including `active_model`
  and unrelated user entries) are present unchanged in the output; a backup is
  created before any write.

### Excluded scope

- No CLI registration yet (phase-10 registers `phax agent setup`). The function
  is exercised directly by tests in this phase.
- No full TOML parsing/round-tripping — strictly read-only scan + append.

### Expected handoff content

- The `vibeSetup` function signature and option shape (`{ dryRun, install }`).
- The `extractBaseModel` / `renderPhaxAliasBlocks` signatures and the
  `VibeBaseModel` field list.
- The backup naming scheme, and confirmation the append-only write leaves the
  original bytes intact.
- Confirmation tests pass under `pnpm test`.

### Commit subject

feat(routing): add Mistral Vibe alias setup helper

### Commit body

Add src/app/vibeSetup.ts and src/schemas/vibeConfig.ts implementing spec §14
with an append-only strategy: a read-only scan extracts the mistral-medium-3.5
base model's scalar fields, then five phax-mistral-medium-3.5-\* [[models]]
blocks are appended changing only alias and thinking. Existing bytes are never
rewritten, so active_model and user entries cannot be corrupted. Idempotent
(appends only missing aliases), backs up before writing, and writes atomically.
No TOML parser dependency. Exercised directly by tests; CLI wiring lands in
phase-10.

---

## phase-10 — `phax agent models | resolve | probe` commands {#phase-10-agent-cli}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Expose the user-facing `phax agent` command group (spec §17): `models` prints
the routing table, `resolve` explains how a request would resolve, `probe`
checks provider availability, and `setup mistral-vibe` runs the phase-09
installer (with `--dry-run` / `--install-model-aliases`).

### Detailed instructions

- Create `src/cli/commands/agent.ts` with a `registerAgentCommand(program, out)`
  that adds an `agent` subcommand group (mirror `registerResumeCommand`):
  - `phax agent models` — load routing + provider config, print the tiers /
    provider mappings and provider priority in a readable table via the output
    port.
  - `phax agent resolve --model <id> --effort <level>` — load config, call
    `resolveModel`, and print the resolution (selected provider, family,
    thinking, concrete model/alias, relationship, reason) — the §16 shape.
    Support `--json` for machine output.
  - `phax agent probe` — for each enabled provider, check the executable is
    runnable (resolve on PATH / `--version` through the Shell port) and print
    available/unavailable per provider. Never throw on an unavailable provider.
  - `phax agent setup mistral-vibe [--dry-run] [--install-model-aliases]` —
    call `vibeSetup` from phase-09 and print the result.
- Register the group in `src/cli/main.ts` (call `registerAgentCommand`).
- All printing goes through the output port; commands return an exit code and
  the action wrapper calls `process.exit`, matching the existing command style.

### Included scope

- `src/cli/commands/agent.ts`, the `main.ts` registration, and unit tests
  `tests/unit/cli/agent.test.ts` (or integration where a Shell/FS fake is
  needed) asserting `resolve` output for a sonnet/medium request, `models`
  output contains the tiers and priority, `probe` reports per-provider status
  without throwing, and `setup --dry-run` lists the aliases.

### Excluded scope

- No changes to resolution or adapters. No `run`-path changes (done in
  phase-08).

### Expected handoff content

- The registered command names/flags and their exit-code conventions.
- Confirmation the new CLI tests and full suite pass under `pnpm test`.

### Commit subject

feat(cli): add phax agent models/resolve/probe/setup commands

### Commit body

Add the phax agent command group (spec §17): `agent models` prints the routing
table and provider priority, `agent resolve --model --effort [--json]` explains
a resolution via resolveModel, `agent probe` reports per-provider executable
availability through the Shell port without throwing, and `agent setup
mistral-vibe [--dry-run|--install-model-aliases]` drives the phase-09 installer.
Registered in main.ts; all output goes through the output port.

---

## phase-11 — Architectural guards, docs, and routing skill {#phase-11-guards-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Freeze the routing boundaries with architectural guards, document the feature,
and add a `.skills/model-routing.md` so future agents extend it correctly.

### Detailed instructions

- Extend `tests/unit/architecturalGuards.test.ts` (or add
  `tests/unit/routing/guards.test.ts`) with guards that fail the build when:
  - any file under `src/domain/` (including `src/domain/routing/`) imports
    `effect`, `@opentelemetry/*`, the FileSystem port, or an `infra/` module;
  - any `spawn(` of `claude` / `vibe` / `codex` appears outside
    `src/infra/providers/`;
  - `resolveModel` (in `src/domain/routing/resolve.ts`) imports no IO/Effect
    module — keep it in the pure-domain allowlist.
- Write `docs/model-routing.md`: the families, the effort/thinking axis, the
  tiers, the default §12 table, how to edit `~/.phax/model-routing.json` and
  `~/.phax/providers.json`, the resolution pipeline, the §11 relationship
  semantics, and the four §15 worked examples.
- Update `README.md` with a short "Multi-provider model routing" section and the
  `phax agent …` command list.
- Add `.skills/model-routing.md` describing the routing architecture
  (pure resolution, schema boundaries, provider adapters, the no-silent-Opus-
  downgrade rule) for future planning/execution agents.
- Add a `skills` test entry if `tests/unit/skills.test.ts` enumerates skill
  files (keep that test green).

### Included scope

- The guard test(s), `docs/model-routing.md`, `README.md` edits,
  `.skills/model-routing.md`, and any `skills.test.ts` update.

### Excluded scope

- No behavior changes to resolution, adapters, or CLI.

### Expected handoff content

- The list of guards added and what each forbids.
- Confirmation `pnpm audit:architecture`, `pnpm test`, and `pnpm knip` pass and
  that the docs/skill render the four §15 examples accurately.

### Commit subject

docs(routing): add architectural guards, docs, and routing skill

### Commit body

Freeze the routing boundaries with architectural guard tests (domain stays pure,
only src/infra/providers may spawn provider CLIs, resolveModel imports no IO),
add docs/model-routing.md and .skills/model-routing.md documenting the families,
tiers, default table, resolution pipeline, relationship semantics, and the four
spec §15 worked examples, and update the README with the multi-provider routing
section and the phax agent command list.
