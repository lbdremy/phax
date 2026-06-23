# Plan — Split `phax.json` into project vs. user configuration layers

## Context and rationale

Today there is a single configuration file: the repo's `phax.json`, located by
walking up from the cwd to the git root (`src/app/loadConfig.ts`) and decoded by
`PhaxConfigSchema` (`src/schemas/phaxConfig.ts`). There is **no notion of a user
configuration layer** — no `~/.phax/config.json`, no per-developer override, no
merge or precedence. `~/.phax` is used only as the run-state root.

That single file mixes two genuinely different kinds of settings:

- **Project / team settings** that belong in the committed, shared file: gate
  profiles, setup/cleanup commands, project identity, monorepo workspaces, the
  network policy, the publish convention, and the project's filesystem/command
  grants (e.g. phax's own `security.filesystem.allowWrite: ["~/.phax"]`, a
  deliberate, repo-specific opt-in for phax debugging itself — see
  `src/domain/security/resolvePolicy.ts:32-39`).
- **User preferences** that should not be committed: the run-state root, model /
  effort / fix-attempt tuning, MCP server selection, and per-developer security
  or publish overrides.

A second insight refined the design: most user preferences are not machine-wide
— they are *tied to a specific repo* ("I trust **this** repo → run unsafe", "use
this model **for this project**", "publish to **my fork** of this project").
A single global user file cannot express that without leaking an override from
one repo into another.

### Decided design

Four configuration layers, resolved least-to-most specific (and most personal
wins), mirroring git's system/global/local model:

```
built-in defaults
  ↑ overridden by
phax.json            (committed)      — project / team baseline, shareable
  ↑ overridden by
~/.phax/config.json  (global user)    — machine-wide user defaults (state root, etc.)
  ↑ overridden by
phax.local.json      (gitignored)     — this user × this repo, the bulk of overrides
```

Merge semantics:

- **Scalars** → the highest present layer wins (override).
- **Allowlists** → **union** across all layers: `security.filesystem.allowRead`,
  `security.filesystem.allowWrite`, `security.agentCommands`,
  `security.mcp.allow`, and `gateProfiles` (union by key; a key present in a
  higher layer overrides that profile's command list). A user layer can only
  *add* to the project's safety baseline, never silently drop it.

Field allocation:

- Project-only (identity): `$schema`, `version`, `name`.
- Project baseline, user-overridable: `gateProfiles`, `commands.*`,
  `workspaces`, `fileReconciliation.mode`, `security.*`, `publish.*`,
  `review.compliance.*`.
- User layers (and a built-in default): `state.root` (default `~/.phax`),
  `agent.maxFixAttempts`, `agent.extractPlan.*`, `security.mcp.mode`.

Two concrete corrections fall out:

1. `state.root` is no longer required in (nor written into) the committed
   `phax.json`. It defaults to `~/.phax` and is overridable in the user layers.
2. We do **not** auto-derive the state root into `filesystem.allowWrite`. The
   security design deliberately withholds the state root by default; phax's own
   repo opts in explicitly, and that stays a committed, project-specific grant.

This plan is implemented inside-out: schemas first, then the pure merge in the
domain, then the application wiring that reads the three files, then the surface
(init, gitignore, schema emission, repo migration, docs).

## Required commands

- (none)

## Phases

## phase-01 — User-overlay schema and optional project state root {#phase-01-overlay-schema}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Introduce a user-overlay configuration schema (shared by the global and
per-project user layers) and make the project file's `state` block optional, so
later phases can read and merge layered config without breaking the existing
single-file load path. No layering behavior is added yet; every existing load
must keep working.

### Detailed instructions

- In `src/schemas/phaxConfig.ts`:
  - Make the top-level `state` field optional in `PhaxConfigSchema` (it remains a
    valid, low-precedence project default but is no longer required).
  - Add `PhaxUserOverlaySchema`: a struct where every overridable field is
    optional and the project-identity fields (`version`, `name`) and `$schema`
    are **absent** (an overlay must not redeclare repo identity). Cover `state`,
    `agent`, `commands`, `fileReconciliation`, `security`, `publish`, `review`,
    `gateProfiles`, and `workspaces` — reusing the existing sub-schemas
    (`PublishConfigSchema`, `SecurityConfigSchema`, `GateProfilesSchema`,
    `WorkspaceSchema`, `ExtractPlanConfigSchema`, `FileReconciliationConfigSchema`,
    `ComplianceReviewConfigSchema`).
  - Export `type PhaxUserOverlay`, `decodePhaxUserOverlay` (with
    `onExcessProperty: "error"`, matching `decodePhaxConfig`), and
    `getPhaxUserOverlayJsonSchema()` (via `JSONSchema.make`).
- In `src/app/loadConfig.ts`, update the `stateRoot` resolution to tolerate an
  absent `state` block: `expandTilde(config.state?.root ?? "~/.phax")`. No other
  behavior changes in this phase.
- Regenerate the committed `phax.schema.json` so the drift test
  (`tests/unit/phaxConfigJsonSchema.test.ts`) stays green now that `state` is
  optional. Use the existing generation path (`writeConfigSchemaFile` /
  `getPhaxConfigJsonSchema`); do not hand-edit the JSON.
- Do **not** yet remove `state` from the repo's own `phax.json` (that migration
  is phase-04); keeping it is still valid under the now-optional schema.

### Planned files to create

- `tests/unit/phaxUserOverlaySchema.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`

### Boundary contracts

Schema layer (`src/schemas/`) → application layer (`src/app/loadConfig.ts`): the
overlay decoder is the producer of a validated `PhaxUserOverlay`; phase-02/03 are
the consumers. The stable shape is "a deep-partial of the overridable config
universe, excluding identity fields, decoded strictly."

### Test strategy

- Unit (schema layer): `decodePhaxUserOverlay` accepts an empty object, accepts
  partial overlays (e.g. only `state.root`, only `security.profile`), and
  rejects an overlay carrying `version`/`name`/`$schema` or any excess
  property. Write these before implementation — the overlay's accepted surface is
  a stable contract.
- Keep `tests/unit/loadConfig.test.ts` green; adjust only if the optional-state
  change surfaces a fixture assumption.

### Implementation order

Schema additions and the optional-state change, then regenerate
`phax.schema.json`, then the overlay decode tests.

### Excluded scope

- The pure merge function (phase-02).
- Reading `~/.phax/config.json` or `phax.local.json` (phase-03).
- Migrating the repo's `phax.json` and `initProject` (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exported names from `src/schemas/phaxConfig.ts`:
  `PhaxUserOverlaySchema`, `PhaxUserOverlay`, `decodePhaxUserOverlay`,
  `getPhaxUserOverlayJsonSchema`.
- Confirmation that `state` is now optional and `phax.schema.json` was
  regenerated (not hand-edited).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(schemas): add user-overlay config schema and optional state root

### Commit body

Add PhaxUserOverlaySchema (a strict deep-partial of the overridable config
fields, excluding repo identity) and make the project file's state block
optional, defaulting the state root to ~/.phax. Regenerate phax.schema.json.
Groundwork for layered project/user configuration; no layering behavior yet.

## phase-02 — Pure config-layer merge in the domain {#phase-02-merge-layers}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add the pure function that merges the configuration layers into a single raw
config, applying scalar-override and allowlist-union semantics. This is pure
logic with no I/O, so it lives in the domain and is exhaustively unit-tested
before it is wired into the loader.

### Detailed instructions

- Create `src/domain/config/mergeLayers.ts` exporting
  `mergeConfigLayers(input: { project: PhaxConfig; globalUser?: PhaxUserOverlay;
  localUser?: PhaxUserOverlay }): PhaxConfig` (return the merged raw config in
  the project schema's shape so the existing `resolve*` helpers consume it
  unchanged).
- Precedence (lowest → highest): `project` < `globalUser` < `localUser`.
- Scalar fields override: `state.root` (default `~/.phax` when no layer sets it),
  `agent.maxFixAttempts`, `agent.extractPlan.model`, `agent.extractPlan.effort`,
  `security.profile`, `security.network.profile`, `security.mcp.mode`,
  `fileReconciliation.mode`, each `publish.*` scalar, and
  `review.compliance.enabled` / `review.compliance.model` /
  `review.compliance.effort`.
- Allowlists union (concatenate then de-duplicate, preserving first-seen order):
  `security.filesystem.allowRead`, `security.filesystem.allowWrite`,
  `security.agentCommands`, `security.mcp.allow`.
- `gateProfiles`: union by key across layers; when the same profile key appears
  in more than one layer, the higher layer's command array wins for that key.
- `commands.setup`/`commands.cleanup` and `workspaces`: scalar/array override
  (higher layer replaces wholesale) — these are not safety allowlists.
- Keep the function total and side-effect free; do not read the filesystem,
  environment, or clock. Do not call schema decoders here — inputs are
  already-decoded values.
- Import `PhaxConfig`/`PhaxUserOverlay` from `src/schemas/phaxConfig.ts` as
  `import type` only (type-only imports from schemas are the established pattern
  in `src/domain/`; the strict domain-purity guard forbids `node:*` and Effect
  imports here, which this function does not need).

### Planned files to create

- `src/domain/config/mergeLayers.ts`
- `tests/unit/mergeLayers.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Application loader (phase-03) is the consumer: it supplies decoded project +
overlay values and receives one merged `PhaxConfig`. The merge must not assume
any layer is present beyond `project`.

### Test strategy

- Unit (domain): write tests first. Cover scalar precedence (local beats global
  beats project), the `state.root` default when absent everywhere, allowlist
  union with de-duplication and order preservation, `gateProfiles` union-by-key
  with higher-layer override of a shared key, and `commands`/`workspaces`
  wholesale override. Include a "no user layers" case that returns the project
  config unchanged.

### Implementation order

Tests for the contract, then the merge implementation core-to-edges (scalars,
then allowlists, then `gateProfiles`).

### Excluded scope

- File discovery and decoding (phase-03).
- Any change to `resolveSecurityConfig` / `resolvePublishConfig` (they continue
  to run on the merged result downstream).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path and signature: `src/domain/config/mergeLayers.ts`,
  `mergeConfigLayers(input)`.
- The precise union vs. override rule per field, so phase-03 wires inputs
  correctly.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(domain): add pure config-layer merge with union allowlists

### Commit body

Add mergeConfigLayers, a pure domain function merging project, global-user, and
local-user configuration. Scalars override (most specific wins); security
allowlists and gateProfiles union so user layers can only extend the project
baseline, never silently drop it. Fully unit-tested.

## phase-03 — Load and merge the three configuration layers {#phase-03-load-layers}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Wire the loader to discover and decode the global user file (`~/.phax/config.json`)
and the per-project user file (`phax.local.json`, sibling of the located
`phax.json`), merge all layers via `mergeConfigLayers`, and resolve as before.
Absent user files are treated as empty overlays.

### Detailed instructions

- In `src/app/loadConfig.ts`:
  - After locating and decoding the project `phax.json`, also look for:
    - `phax.local.json` in the same directory as the located `phax.json`.
    - `~/.phax/config.json` (resolve `~` via `homedir()`), independent of the
      repo location.
  - For each user file: if it exists, read and decode it with
    `decodePhaxUserOverlay`; if absent, use an empty overlay. A present-but-invalid
    user file is a hard error (return `ConfigValidationError` naming the file),
    consistent with how an invalid `phax.json` is handled.
  - Call `mergeConfigLayers({ project, globalUser, localUser })` and run the
    existing workspace validations (`validateUniqueWorkspaceIds`,
    `validateWorkspacePaths`) and the `resolveSecurityConfig` /
    `resolvePublishConfig` resolution on the **merged** config.
  - The `stateRoot` is now taken from the merged config's `state.root` (still
    falling back to `~/.phax`).
- Keep `locatePhaxConfig` returning the project file path only; add a small
  internal helper for the per-project local file path rather than overloading it.
- Follow the file-reading pattern already present in this module (it reads via
  `node:fs` directly — keep that established pattern; do not introduce a new port
  here).

### Planned files to create

- `tests/integration/loadConfigLayers.test.ts`

### Planned files to edit

- `src/app/loadConfig.ts`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`

### Boundary contracts

`loadConfig` (consumer) depends on `decodePhaxUserOverlay` (phase-01) and
`mergeConfigLayers` (phase-02). The resolved output type `ResolvedConfig` is
unchanged — downstream callers are unaffected.

### Test strategy

- Integration (application with real temp filesystem): create a temp `HOME` and a
  temp git repo; assert precedence end to end — a `phax.local.json` override beats
  `~/.phax/config.json` beats `phax.json`; allowlist union across all three;
  absent user files behave as empty; an invalid user file produces a
  `ConfigValidationError` naming that file. Reuse the temp-repo harness style in
  `tests/unit/loadConfig.test.ts`.

### Implementation order

Discovery + decode of the two user files, then the merge call, then move the
resolution/validation onto the merged config.

### Excluded scope

- Emitting a JSON schema for the user files (phase-04).
- Migrating the repo `phax.json` / `initProject` / `.gitignore` (phase-04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The discovery rules: `phax.local.json` is resolved as a sibling of the located
  `phax.json`; `~/.phax/config.json` via `homedir()`.
- Error semantics for a present-but-invalid user file.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): load and merge global and per-project user config layers

### Commit body

loadConfig now discovers ~/.phax/config.json (global user) and phax.local.json
(per-project user, sibling of phax.json), decodes them as strict overlays, and
merges them over the committed phax.json via mergeConfigLayers before resolving.
Absent user files are empty overlays; an invalid one is a hard error.

## phase-04 — Surface: init, gitignore, schema emission, repo migration, docs {#phase-04-surface}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Stop writing user-specific settings into the committed file, emit a JSON schema
for the user layers, ignore the local file, migrate this repo's own `phax.json`
to the new shape, and document the layering.

### Detailed instructions

- `src/app/initProject.ts`:
  - Remove `state: { root: "~/.phax" }` from the generated project config (the
    default now lives in the resolver / user layer).
  - Extend `writeConfigSchemaFile` / `upgradeConfigSchema` to also emit a
    `phax.user.schema.json` next to `phax.schema.json`, generated from
    `getPhaxUserOverlayJsonSchema()`. Keep the existing byte-identical no-op
    behavior. `upgradeConfigSchema`'s result should report both files (or remain
    `updated`/`current` based on whether either changed — keep it simple and
    deterministic).
- `src/cli/commands/schema.ts`: surface the user-schema file in the `upgrade`
  command's success output so developers know it exists.
- `.gitignore`: add `phax.local.json`.
- Migrate the repo's own `phax.json`: remove the `state` block and the
  `agent.maxFixAttempts` entry (its value `1` equals the built-in default).
  Keep `security.filesystem.allowWrite: ["~/.phax"]` — it is a deliberate
  project-specific grant for phax debugging itself. Regenerate `phax.schema.json`
  and add `phax.user.schema.json`.
- Update `README.md` with a short "Configuration layers" section describing the
  four layers, precedence, and the override-vs-union rule, and noting that
  `phax.local.json` is gitignored.

### Planned files to create

- `phax.user.schema.json`

### Planned files to edit

- `src/app/initProject.ts`
- `src/cli/commands/schema.ts`
- `.gitignore`
- `phax.json`
- `phax.schema.json`
- `README.md`
- `tests/unit/initProject.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`

### Optional files that may be edited

- `tests/unit/cli/schemaUpgrade.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`

### Boundary contracts

CLI `schema upgrade` (view) → `upgradeConfigSchema` (application command): the
command still returns a discriminated result the thin CLI renders; adding the
user-schema file must not put logic in the command file.

### Test strategy

- Unit (application): `initProject` no longer emits `state`; the generated config
  decodes cleanly under `PhaxConfigSchema`. `upgradeConfigSchema` writes both
  `phax.schema.json` and `phax.user.schema.json` and reports `current` when both
  are already byte-identical. Update existing init/upgrade tests accordingly.
- The schema drift test must pass against the regenerated files.

### Implementation order

`initProject`/schema emission first (with tests), then `.gitignore`, then the
repo `phax.json` migration + schema regeneration, then the README note.

### Excluded scope

- Any change to merge precedence or discovery rules (phases 02–03).
- Scaffolding a default `~/.phax/config.json` on init (out of scope; the default
  state root already applies without a file).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that the repo `phax.json` no longer carries `state` or
  `agent.maxFixAttempts`, and that both schema files were regenerated (not
  hand-edited).
- The new `phax.user.schema.json` path and how `phax schema upgrade` emits it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(config): finalize user/project config split across init, schema, and docs

### Commit body

Stop writing the state root into generated project config, emit
phax.user.schema.json for the user layers, gitignore phax.local.json, and migrate
this repo's phax.json to the new shape (drop the machine-specific state block and
the default-valued maxFixAttempts; keep the deliberate ~/.phax write grant).
Document the four configuration layers and their precedence in the README.
