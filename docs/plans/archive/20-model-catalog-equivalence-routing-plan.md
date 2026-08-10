# Model catalog and equivalence routing

Status: Archived

Source-Spec: docs/specs/archive/20-model-catalog-equivalence-routing.md

This plan implements spec `docs/specs/20-model-catalog-equivalence-routing.md`
(Approved). It removes the invented routing-tier scale and replaces it with a
**versioned model catalog**, **planner-native concrete model selection**, a
**Claude-hub equivalence table** for cross-family execution, and a **run-start
preflight** that refuses an unrunnable plan with actionable alternatives.
`allowDowngrade` becomes the sole policy knob; there is no cost or positioning
data anywhere, and no back-compat shim for the removed scale (old
`tiers`/`normalization`/`defaultTier` configs are rejected at validation).

The change is core-heavy: the schemas and the resolution algorithm form one
typecheck unit and are replaced together in phase-01. Phase-02 adds the app-layer
preflight. Phase-03 makes the planner's catalog knowledge a generated artifact.
Phase-04 refreshes the docs and CLI surface. `claude-code` remains the guaranteed
terminal execution family throughout.

Implementation is inside-out: domain + schema first, then app, then tooling, then
surface. Every phase is verified by the project's `full` gate profile in
`phax.json`.

## Required commands

- pnpm gen:model-catalog

## Required PHAX security configuration changes

This plan requires the following command to be added to `security.agentCommands`
in `phax.json` before running:

- `pnpm gen:model-catalog`

Phase-03 wires `pnpm gen:model-catalog --check` into the `full` gate profile, so
the command must be covered by the frozen security set or the preflight will fail
before any agent spawns.

## phase-01 — Replace routing schemas and resolution core {#phase-01-routing-core}

**Recommended model:** claude-opus-4-8
**Recommended effort:** xhigh

Replace the abstract routing-tier scale with the versioned catalog and the
Claude-hub equivalence table, and rewrite `resolveModel` so a concrete versioned
model id + effort resolves natively when plan-family equals execution-family, and
translates through the Claude hub otherwise. This is the irreducible core: the
routing schemas and the resolution algorithm typecheck together and are replaced
in one coherent commit.

### Detailed instructions

- **`src/schemas/modelRouting.ts`**: bump `version` to the literal `2`. Remove
  `RoutingTierSchema`, `tiers`, `normalization`, and `defaultTier`. Add `upgrade`
  to `RelationshipSchema`. Add an `equivalence` field: a record keyed by a
  non-Claude concrete model id, whose value is a record keyed by that entry's
  effort, whose value is `{ claude: <claude model id>, effort: <claude effort>,
  relation: Relationship }`. Keep `providerPriority`, `allowDowngrade`, and
  `requestedModelNormalization`. Decode with `onExcessProperty: "error"` so an old
  config carrying `tiers`/`normalization`/`defaultTier` is rejected (no shim).
- **`src/schemas/providerConfig.ts`**: change each `families` entry value from
  `{ model }` to `{ models: NonEmptyArray<{ id, efforts: NonEmptyArray<ThinkingLevel>,
  status: "active" | "deprecated" }> }`. Coexisting versions are distinct array
  entries. Import `ThinkingLevelSchema` from the routing schema (or re-export).
- **`src/domain/routing/types.ts`**: delete `RoutingTier` and the
  `FAMILY_EFFORTS`/`isEffortSupported` family-scoped effort machinery; efforts are
  now per catalog entry. Add `Relationship` `"upgrade"`. Remove `normalizedTier`
  from `RoutingResolution`. Keep `ProviderId`, `ModelFamily`, `EffortLevel`,
  `RoutingRequest`, `RoutingResolution` (selected/relationship/reason/skipped),
  `SecurityFilter`.
- **`src/domain/routing/catalog.ts`** (new): pure catalog helpers over
  `ProviderConfig` — `familyOfId(id)`, `entryFor(id)`, `effortsFor(id)`,
  `isDeprecated(id)`, `nearestEfforts(id, requestedEffort)` (for alternatives),
  and `equivalentFor(id, effort, targetFamily, equivalence)` implementing the star
  lookup (direct hub edge for Claude↔spoke; route spoke→spoke through the Claude
  hub; invert the relation for spoke→hub direction).
- **`src/domain/routing/resolve.ts`**: rewrite `resolveModel(request, routing,
  providerCfg, securityFilter?)` — keep the signature. New algorithm: (1) derive
  plan-family from the requested id via `familyOfId` (fall back to the existing
  substring heuristic, then `claude-sonnet`); (2) walk `providerPriority`, skipping
  disabled/security-filtered providers; (3) if the provider serves the plan-family,
  resolve the concrete id + effort directly (relationship `exact`, or `equivalent`
  if the effort is clamped to the entry's supported set); (4) otherwise translate
  via `equivalentFor`, applying `allowDowngrade` (skip `downgrade`/`no_equivalent`
  when false); (5) terminal `claude-code` fallback via the hub, which is always
  defined. Keep `reason`/`skippedForSecurity`.
- **`src/domain/routing/defaults.ts`**: rewrite `DEFAULT_MODEL_ROUTING` (version 2,
  no tiers/normalization, an `equivalence` table mapping the current codex/mistral
  offerings to their Claude anchors with the relations from today's tier table) and
  `DEFAULT_PROVIDER_CONFIG` (family `models` arrays with per-entry `efforts` +
  `status: "active"`), preserving the current default ids and efforts.
- **`src/schemas/telemetryEvents.ts`** and **`src/app/executePlan.ts`**: remove the
  `normalizedTier` field from the model-resolved telemetry event and its
  construction (line ~638). Keep `relationship`.
- **`src/cli/commands/agent.ts`**: drop the `Normalized tier:` output line and any
  tier references; keep the relationship/selected output.

### Planned files to create

- src/domain/routing/catalog.ts
- tests/unit/routing/catalog.test.ts

### Planned files to edit

- src/schemas/modelRouting.ts
- src/schemas/providerConfig.ts
- src/domain/routing/types.ts
- src/domain/routing/resolve.ts
- src/domain/routing/defaults.ts
- src/schemas/telemetryEvents.ts
- src/app/executePlan.ts
- src/cli/commands/agent.ts
- tests/unit/routing/resolve.test.ts
- tests/unit/routing/schemas.test.ts
- tests/unit/routing/effortLevels.test.ts
- tests/unit/routing/sameFamilyPreservation.test.ts
- tests/unit/routing/securityFallback.test.ts
- tests/unit/routing/loadRouting.test.ts
- tests/type/routing.ts

### Optional files that may be edited

- src/domain/routing/priorityOverride.ts
- src/domain/routing/providerSetup.ts
- tests/unit/routing/priorityOverride.test.ts
- tests/unit/routing/providerSetup.test.ts
- tests/unit/telemetry/modelResolved.test.ts
- tests/unit/cli/agent.test.ts

### Boundary contracts

Producer: `src/schemas/modelRouting.ts` and `src/schemas/providerConfig.ts` define
the decoded routing config and catalog shapes. Consumer: `src/domain/routing/*`
and every `resolveModel` caller. The stable contract is the `resolveModel`
signature `(request, routing, providerConfig, securityFilter?) → RoutingResolution`
— unchanged — and the `RoutingResolution` shape minus `normalizedTier`. Catalog and
equivalence data enter only through the decoded `providerConfig`/`routing`, never
constructed by callers.

### Test strategy

Domain, unit-first. Rewrite `tests/unit/routing/resolve.test.ts` as the spec's
worked cases: native same-family passthrough, cross-family translation via the hub,
`allowDowngrade` floor, terminal `claude-code` fallback. `catalog.test.ts` covers
`familyOfId`, per-entry `effortsFor`, deprecation, and star `equivalentFor`
(including spoke→spoke through the hub and relation inversion). Update
`schemas.test.ts` to assert the v2 shape and rejection of a legacy
`tiers`/`normalization` config. Update `tests/type/routing.ts` for the new types.
Write the resolve and catalog tests before the implementation.

### Implementation order

Schemas (`modelRouting`, `providerConfig`) → domain types → `catalog.ts` helpers →
`resolve.ts` → `defaults.ts` → telemetry/executePlan/agent compile fixes → tests.

### Excluded scope

- The run-start model preflight over all phases (phase-02).
- The catalog codegen and skill sync (phase-03).
- `docs/model-routing.md` and the `model-routing` skill refresh (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `resolveModel` signature and `RoutingResolution` shape (fields kept and
  `normalizedTier` removed).
- The exact `catalog.ts` exported helper names and signatures, for phase-02.
- The `equivalence` table shape and the star-lookup semantics as implemented.
- Any deviation from the planned file lists, with the reason (especially which
  routing test files were touched).

### Commit subject

feat(routing): replace tier scale with versioned catalog and equivalence table

### Commit body

Remove the abstract routing-tier scale (tiers, normalization, defaultTier) and
resolve concrete versioned model ids natively, translating cross-family through a
Claude-hub equivalence table with capability-only relations. Efforts are now
per catalog entry. Config bumps to version 2 and rejects the legacy shape with no
shim. allowDowngrade remains the sole policy knob. Covered by rewritten domain
unit tests and the new catalog helper tests.

## phase-02 — Run-start model preflight and actionable alternatives {#phase-02-model-preflight}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add a run-start preflight that validates every phase's model selection before the
first phase executes, and fails the run with an actionable error listing the valid
alternatives from the catalog so the planning agent can self-correct.

### Detailed instructions

- **`src/domain/routing/preflight.ts`** (new): a pure function
  `preflightPhaseModels(phases, routing, providerConfig) → { failures:
  ReadonlyArray<{ phaseId, model, effort, reasons, alternatives }> }`. For each
  phase validate, using the phase-01 catalog helpers: the id exists in the catalog;
  the effort is in that entry's `efforts`; the entry `status` is not `deprecated`;
  the id's provider is enabled/available; and — where the phase's plan-family differs
  from the resolvable execution-family — a permitted equivalence edge exists under
  `allowDowngrade`. For each failure, compute `alternatives` from the catalog
  (other efforts of the same entry, and other active entries of the same family
  that support the requested effort).
- **`src/app/executePlan.ts`**: after the existing `checkRequiredCommands`
  preflight and before the phase loop, call `preflightPhaseModels` over
  `plan.phases`. If `failures` is non-empty, fail the run (non-zero) via the
  `OutputPort`, naming each offending phase and printing its reasons and
  alternatives, before any phase agent spawns. Do not attempt any auto-correction.
- Keep the message shape aligned with the spec §6 preflight sketch (phase id,
  offending model + effort, valid efforts, alternative entry).

### Planned files to create

- src/domain/routing/preflight.ts
- tests/unit/routing/preflight.test.ts
- tests/integration/modelPreflight.test.ts

### Planned files to edit

- src/app/executePlan.ts

### Optional files that may be edited

- src/domain/routing/catalog.ts
- tests/integration/executePlan.test.ts

### Boundary contracts

Consumer: `executePlan` (app) needs a total, pure verdict over all phases before
spawning agents. Producer: `preflight.ts` (domain) provides
`preflightPhaseModels` returning structured failures + alternatives. The app only
renders the verdict through `OutputPort`; it embeds no validation logic.

### Test strategy

Unit-first on `preflight.ts`: unsupported effort, deprecated entry, missing id,
disabled provider, refused cross-family downgrade — each yields the expected
reasons and alternatives. Integration test on `executePlan`: a plan with one
invalid phase model exits non-zero before phase 1 and names the phase; a fully
valid plan proceeds. Write both before wiring.

### Implementation order

`preflight.ts` + unit tests → `executePlan` wiring → integration test.

### Excluded scope

- Any change to the resolution algorithm itself (phase-01).
- Regenerating the planner catalog view (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `preflightPhaseModels` signature and the `failures`/`alternatives` shape.
- Where in `executePlan` the preflight runs relative to `checkRequiredCommands`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): refuse unrunnable plans at run-start model preflight

### Commit body

Validate every phase's concrete model and effort against the catalog and
equivalence table before the first phase spawns, failing the run with the offending
phases and catalog-derived alternatives so the planning agent can self-correct.
Covered by domain unit tests and an executePlan integration test.

## phase-03 — Catalog codegen and phax-planning skill sync {#phase-03-catalog-codegen}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the planner's catalog knowledge a generated artifact: a script derives a
catalog table from the catalog and writes it into a marker-delimited region of the
phax-planning skill, with a `--check` mode wired into the pre-merge gate so drift
fails CI.

### Detailed instructions

- **`scripts/generate-model-catalog.ts`** (new, mirroring
  `scripts/generate-usage-spec.ts`): read the catalog from `DEFAULT_PROVIDER_CONFIG`
  (via the phase-01 catalog helpers), render a Markdown table (columns: id, family,
  efforts) grouped by family, and rewrite only the region between
  `<!-- BEGIN generated: model-catalog -->` and `<!-- END generated: model-catalog -->`
  in the target skill file(s). Support a `--check` flag that exits non-zero if the
  committed region differs from freshly generated content (generate to a string,
  compare, do not write).
- **`package.json`**: add `"gen:model-catalog": "tsx scripts/generate-model-catalog.ts"`
  and extend `check:full` to run `npm run gen:model-catalog -- --check`.
- **`phax.json`**: add `pnpm gen:model-catalog --check` to the `full` gate profile,
  and `pnpm gen:model-catalog` to `security.agentCommands`.
- **`.claude/skills/phax-planning/SKILL.md`** and
  **`.agents/skills/phax-planning/SKILL.md`**: replace the hand-maintained
  `## Model IDs` and `## Effort values` model listings with the marker region the
  script fills; keep the surrounding prose (the "reference scale" wording is updated
  in phase-04). Run the generator so the committed region is current.

### Planned files to create

- scripts/generate-model-catalog.ts
- tests/unit/generateModelCatalog.test.ts

### Planned files to edit

- package.json
- phax.json
- .claude/skills/phax-planning/SKILL.md
- .agents/skills/phax-planning/SKILL.md

### Optional files that may be edited

- src/domain/routing/catalog.ts

### Boundary contracts

Producer: the catalog (`DEFAULT_PROVIDER_CONFIG` + catalog helpers). Consumer: the
phax-planning skill markdown, via a generated region. The contract is the marker
pair and the derived table; the script owns the region, humans own the prose
around it. `--check` is the drift gate.

### Test strategy

Unit test on the generator: given a small catalog, the rendered region matches an
expected snapshot, and `--check` returns non-zero when the region is stale. Do not
invent gate commands; the drift check runs as part of the existing `full`/`check:full`
gates.

### Implementation order

Generator + unit test → package.json/phax.json wiring → run generator to fill the
skill regions.

### Excluded scope

- Prose rewrites of the skill/docs describing the new model (phase-04).
- Any routing behavior change (phases 01–02).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The generator command names (`gen:model-catalog`, `--check`) and the exact marker
  strings used in the skill files.
- Confirmation that `check:full` and the `full` gate profile both run the drift check.
- Any deviation from the planned file lists, with the reason.

### Commit subject

build(routing): generate the planner catalog table with a drift-checked script

### Commit body

Add gen:model-catalog to render the model catalog into a marker-delimited region of
the phax-planning skill and a --check mode wired into check:full and the full gate
profile, so the planner's catalog view can never silently drift from the catalog.
Covered by a generator unit test.

## phase-04 — Docs and CLI surface refresh {#phase-04-docs-cli-surface}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Refresh the human-facing surface to the new model: rewrite the routing doc and the
`model-routing` skill to describe catalog + equivalence + preflight (no tier scale),
and update the `phax agent` command output accordingly.

### Detailed instructions

- **`docs/model-routing.md`**: rewrite to the new model — remove the tier tables and
  the two-hop pipeline; document the versioned catalog (per-entry efforts, status),
  the Claude-hub equivalence table (star, relation semantics incl. `upgrade`), the
  `allowDowngrade` floor, and the run-start preflight. Update the worked examples to
  native passthrough and cross-family translation. Keep the config v2 shapes from
  phase-01 as the reference.
- **`.claude/skills/model-routing/SKILL.md`**: align with the new model and the four
  layers; remove tier language.
- **`.claude/skills/phax-planning/SKILL.md`** and
  **`.agents/skills/phax-planning/SKILL.md`**: update the prose around the generated
  region — replace "Claude is the routing reference scale" framing with the
  catalog/equivalence model; the model/effort listing itself stays generated.
- **`src/cli/commands/agent.ts`**: ensure `phax agent models`/`resolve` output
  reflects the catalog and equivalence (no tier), including the resolved relationship.

### Planned files to create

- (none)

### Planned files to edit

- docs/model-routing.md
- .claude/skills/model-routing/SKILL.md
- .claude/skills/phax-planning/SKILL.md
- .agents/skills/phax-planning/SKILL.md
- src/cli/commands/agent.ts

### Optional files that may be edited

- tests/unit/cli/agent.test.ts

### Boundary contracts

No new architectural boundary. The `phax agent` command remains a thin view over
`resolveModel`; this phase only adjusts what it renders.

### Test strategy

Update `tests/unit/cli/agent.test.ts` to assert the tier line is gone and the
catalog/relationship output is present. Docs and skills are prose, verified by the
`full` gate (format/lint) and human review, not by new tests.

### Implementation order

Docs → skills prose → CLI output → agent test.

### Excluded scope

- Any routing behavior, schema, preflight, or codegen change (phases 01–03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `docs/model-routing.md` no longer references tiers and matches
  the shipped behavior.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(routing): describe catalog, equivalence, and preflight; drop the tier scale

### Commit body

Rewrite the routing doc and the model-routing skill to the catalog + Claude-hub
equivalence + preflight model, update the phax-planning prose around the generated
catalog region, and align the phax agent command output. No behavior change.
