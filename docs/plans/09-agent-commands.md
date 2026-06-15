# Frozen Agent Commands — Implementation Plan

Implements `docs/specs/09-agent-commands.md`.

## Architecture findings (why this plan is shaped the way it is)

- **No `agentExecutables`/`agentCommands` exists today.** In secure mode the
  *only* source of agent command permissions is the **resolved gate profile**
  (`phax.json` → `gateProfiles`), threaded as `AgentRunOptions.gateCommands` and
  translated per provider. So the spec's "do not model two lists" criterion is
  already met by absence; this feature adds `security.agentCommands` as the one
  explicit list and unifies it with the implicit gate-command grant.
- **Per-provider command enforcement differs and must be modelled honestly:**
  - `claude-code` — `gateCommandAllowRules()` emits `--allowedTools Bash(<prefix>:*)`
    → **prefix** precision; empty set → `--disallowed-tools Bash`.
  - `codex-cli` — `sandbox_mode=workspace-write` + `approval_policy=never`; no
    per-command allowlist → **none** (sandbox-bounded, every command runs).
  - `mistral-vibe` — `--agent auto-approve`; "tool-level restriction not
    expressible" → **none**.
- **`security.json`** is the `SecurityPosture` artifact written per-phase in
  `src/app/executePlan.ts` (~line 546). It records mode/provider/fs/network/mcp/
  downgraded/marks today — no commands.
- **Capabilities** (`PROVIDER_SECURITY_CAPABILITIES` in
  `src/domain/security/capabilities.ts`) track `filesystemJail` + `mcpAllowlist`;
  filesystem jail is the *only* hard strict-mode gate. We add a third axis
  (`commandEnforcement`) but keep it a **warning/mark, never a strict-mode hard
  fail** (decision Q2) so codex/vibe don't regress.
- **Freezing is already structural:** config is loaded once at run start and
  never re-read; we never read `package.json`. So "agent edits don't change the
  active run" and "no auto-unroll from package scripts" are free — we just must
  compute the effective set before the agent spawns and assert this with tests.
- **Planning skill** source of truth is the single file `.skills/phax-planning.md`.

## Decisions taken (confirmed with user)

- **Q1 → B, plan-level.** The plan declares required commands. Add a **run-level**
  `requiredCommands` array to `phax-plan.json` (not per-phase). Preflight
  hard-fails when `requiredCommands ⊄ effective frozen set`.
- **Q2.** Command-precision degradation is a **warning/mark**, never a hard
  strict-mode failure.
- **Q3.** Keep `SecurityPosture` `version: 1`. The new `agentCommands` field is
  **required** (no optional-for-archived shim, per project convention); archived
  pre-feature postures will fail decode, which `finalReport` already null-guards.

## Effective frozen set — the model every phase shares

```
effective frozen set  =  security.agentCommands (source="config")
                      ∪  resolved gate commands  (source="gate")
```

Each entry carries: `command`, `source` (`config`|`gate`), `explicit`
(configured by the developer), `requiredByPlan` (in the plan's
`requiredCommands`), `enforcement` (`exact`|`prefix`|`executable`|`none`, from
the selected provider's capability), `degraded` (`enforcement` coarser than the
entry's granularity warrants). `requiredCommands` is *validated against* this set
(preflight) but does not itself grant anything — a required command absent from
both config and gates is a preflight failure, the spec's core fix.

---

## phase-01 — Command-enforcement capability and frozen-set domain core {#phase-01-frozen-set-core}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure domain layer the rest of the feature builds on: a per-provider
command-enforcement precision axis, and a deterministic function that computes
the frozen `agentCommands` record set (with source/enforcement/degraded
annotations) plus the preflight missing-command check. No wiring yet — this
phase only introduces and unit-tests the pure functions.

### Detailed instructions

- In `src/domain/security/capabilities.ts`:
  - Add `export type CommandEnforcement = "exact" | "prefix" | "executable" | "none";`
  - Add `commandEnforcement: CommandEnforcement` to `ProviderSecurityCapability`
    and set it in `PROVIDER_SECURITY_CAPABILITIES`: `claude-code` → `"prefix"`,
    `codex-cli` → `"none"`, `mistral-vibe` → `"none"`.
  - Do **not** make `commandEnforcement` affect `evaluateProviderSecurity`'s
    `satisfiesStrict` — filesystem jail remains the only hard gate (Q2).
- Create `src/domain/security/agentCommands.ts` with pure functions (no Effect,
  no IO):
  - `export interface AgentCommandRecord { command: string; source: "config" | "gate"; explicit: boolean; requiredByPlan: boolean; enforcement: CommandEnforcement; degraded: boolean; }`
  - `computeFrozenAgentCommands(input: { configCommands: readonly string[]; gateCommands: readonly string[]; requiredCommands: readonly string[]; provider: ProviderId; }): { records: readonly AgentCommandRecord[]; degraded: boolean }`
    - Normalise each command (trim, collapse internal whitespace) the same way
      `gateCommandAllowRules` does (`raw.trim().split(/\s+/).filter(Boolean).join(" ")`),
      drop empties.
    - Build the union of config + gate commands, order-stable, de-duplicated.
      When a command appears in both, it is one record with `source: "config"`
      and `explicit: true` (config is the stronger provenance); pure gate-only
      commands get `source: "gate"`, `explicit: false`.
    - `requiredByPlan` = command is in the normalised `requiredCommands` set.
    - `enforcement` = the provider's `commandEnforcement`.
    - `degraded` = the command is **narrow** (contains a space, i.e. command +
      subcommand/args) **and** the provider cannot enforce at least prefix
      precision (`enforcement` is `"executable"` or `"none"`). A broad entry
      (single token, e.g. `deno`) is never degraded — it is intentionally broad.
    - Top-level `degraded` = any record degraded.
  - `checkRequiredCommands(input: { requiredCommands: readonly string[]; configCommands: readonly string[]; gateCommands: readonly string[]; }): { missing: readonly string[] }`
    - Provider-independent. `missing` = normalised `requiredCommands` not present
      in the normalised union of config + gate commands. A required command is
      "present" if an exact normalised match exists **or** a broad allowance
      covers it (a configured/gated `deno` token covers required `deno fmt`).
      Implement broad-covers-narrow: required `X Y …` is covered by an allowance
      that is a token-prefix of it.
- Keep these functions free of provider CLI specifics — they describe *policy*,
  not flags.

### Planned files to create

- `src/domain/security/agentCommands.ts`
- `tests/unit/security/agentCommands.test.ts`

### Planned files to edit

- `src/domain/security/capabilities.ts`
- `tests/unit/security/capabilities.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer of the frozen-set contract consumed by later phases: phase-04
(security.json records), phase-05 (provider allowlist input), phase-06
(preflight). The stable shapes are `AgentCommandRecord`,
`computeFrozenAgentCommands`, and `checkRequiredCommands`. Keep the input objects
plain (arrays + `ProviderId`) so callers need no Effect context.

### Test strategy

Unit tests (domain layer), all written before implementation:

- broad allowance (`deno`) → not degraded under any provider.
- narrow allowance (`deno fmt`) → `degraded: true` under `codex-cli`/`mistral-vibe`
  (`none`), `degraded: false` under `claude-code` (`prefix`).
- config+gate overlap collapses to one `explicit: true`, `source: "config"` record.
- `requiredByPlan` flag set only for commands in `requiredCommands`.
- `checkRequiredCommands`: exact match present; broad-covers-narrow present;
  genuinely missing required command reported in `missing`; whitespace variants
  normalised before comparison.
- `capabilities.test.ts`: assert `commandEnforcement` per provider and that
  `evaluateProviderSecurity` strictness is unchanged.

### Implementation order

Capability axis → record/compute function → preflight check → tests.

### Excluded scope

- Any schema, config, posture, provider, or CLI wiring (later phases).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact path `src/domain/security/agentCommands.ts` and the full signatures of
  `computeFrozenAgentCommands`, `checkRequiredCommands`, and the
  `AgentCommandRecord` shape.
- The `CommandEnforcement` type name and the per-provider values.
- Confirmation that `evaluateProviderSecurity` strictness was left unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): add command-enforcement axis and frozen agent-command model

### Commit body

Introduce a per-provider commandEnforcement precision axis (exact/prefix/
executable/none) and a pure domain module that computes the frozen agentCommands
record set (source, explicit, requiredByPlan, enforcement, degraded) and the
provider-independent required-command preflight check. Pure functions only; no
wiring. Covered by unit tests.

---

## phase-02 — `security.agentCommands` config and policy plumbing {#phase-02-config-policy}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the developer-facing `security.agentCommands` list to PHAX config and carry
it onto the resolved security policy, so later phases have an explicit configured
command list to fold into the frozen set.

### Detailed instructions

- In `src/schemas/securityConfig.ts`:
  - Add `agentCommands: Schema.optional(Schema.Array(Schema.NonEmptyString))` to
    `SecurityConfigSchema`.
  - Add `readonly agentCommands: readonly string[]` to `ResolvedSecurityConfig`.
  - In `resolveSecurityConfig`, set `agentCommands: raw?.agentCommands ?? []`.
- In `src/domain/security/types.ts`: add `readonly agentCommands: readonly string[]`
  to `SecurityPolicy`.
- In `src/domain/security/resolvePolicy.ts`: carry `config.agentCommands` onto
  the returned policy in **both** the `unsafe` branch and the secure branch
  (verbatim from config — no union with gates here; the gate union happens in
  executePlan where gate commands are known). Keep order-stable.
- This is config carriage only; do not yet compute the frozen union or touch
  providers.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/securityConfig.ts`
- `src/domain/security/types.ts`
- `src/domain/security/resolvePolicy.ts`
- `tests/unit/security/resolvePolicy.test.ts`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`

### Boundary contracts

Producer: `phax.json` `security.agentCommands` → `ResolvedSecurityConfig` →
`SecurityPolicy.agentCommands`. Consumer: executePlan (phase-04) reads
`config.security.agentCommands` to build the frozen set. The stable shape is a
`readonly string[]` defaulting to `[]`.

### Test strategy

Unit tests:

- `resolvePolicy.test.ts`: `agentCommands` carried through both unsafe and secure
  branches; empty default when config omits it; order preserved.
- If `loadConfig.test.ts` has a security fixture, extend it to assert
  `agentCommands` resolves; otherwise leave it.

### Implementation order

Schema → resolved type/default → policy type → resolvePolicy carriage → tests.

### Excluded scope

- Frozen-set union with gates (phase-04).
- Provider consumption (phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- That `SecurityPolicy` now has `agentCommands: readonly string[]` and where it
  is populated (`resolveSecurityConfig` default `[]`, carried in both
  `resolvePolicy` branches).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): add security.agentCommands config and policy carriage

### Commit body

Add the developer-facing security.agentCommands list to the security config
schema and resolved config, and carry it onto SecurityPolicy in both unsafe and
secure branches. No frozen-set computation or provider wiring yet. Covered by
resolvePolicy unit tests.

---

## phase-03 — Plan-level `requiredCommands` extraction {#phase-03-required-commands-schema}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add a run-level `requiredCommands` array to the extracted and persisted plan
schemas so a plan can declare the commands it needs, enabling the preflight in
phase-06.

### Detailed instructions

- In `src/schemas/phaxPlan.ts`, add to the `run` struct of **both**
  `ExtractedPhaxPlanSchema` and `PhaxPlanSchema`:
  - `requiredCommands: Schema.Array(Schema.String)` — **required** field that may
    be empty (mirrors the planned-files arrays: present-but-possibly-empty, no
    back-compat optionality).
- `extractPlanCore` spreads `decoded.right.run`, so `requiredCommands` flows
  through automatically; confirm the merged `plan.run` keeps it. Add a line to
  `buildExtractReport` summarising the count (e.g.
  `- Required commands: <n> (<comma-list>)`).
- The JSON Schema handed to the extraction model is derived from
  `ExtractedPhaxPlanSchema`, so adding the field makes the model emit it; no
  prompt change needed. The plan.md authoring format for this field is added in
  phase-07 (planning skill) — note the dependency in the handoff.
- Update fixtures/tests that construct a `PhaxPlan`/`ExtractedPhaxPlan` to include
  `requiredCommands` (search tests for `shortName:` run objects).

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/app/extractPlan.ts`
- `tests/unit/extractPlan.test.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`
- `tests/unit/dryRun.test.ts`

### Boundary contracts

Producer: `plan.md` → extraction model → `plan.run.requiredCommands`. Consumer:
phase-06 preflight reads `plan.run.requiredCommands`. Stable shape: a
`readonly string[]` on `run`, possibly empty.

### Test strategy

Unit/integration:

- `extractPlan.test.ts`: a fixture plan whose JSON includes
  `run.requiredCommands` decodes successfully and carries the array through; a
  plan JSON omitting it fails decode (required-field assertion).
- Fix any fixtures broken by the new required field across the suite.

### Implementation order

Schema field (both schemas) → fixture updates → extract-report line → tests.

### Excluded scope

- Preflight enforcement (phase-06).
- Planning-skill plan.md format (phase-07).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- That `run.requiredCommands: readonly string[]` is now required on both
  `ExtractedPhaxPlanSchema` and `PhaxPlanSchema`.
- The list of test fixtures updated to include the new field.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(plan): add run-level requiredCommands to plan schema

### Commit body

Add a required (possibly empty) run.requiredCommands array to the extracted and
persisted plan schemas so plans can declare the commands they need, and surface
the count in the extract report. Enables the phase-06 security preflight. Fixtures
and tests updated.

---

## phase-04 — Record the frozen set in `security.json` {#phase-04-security-json}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Compute the frozen agent-command record set in `executePlan` and persist it in
each phase's `security.json`, so a reviewer can audit why each command was
allowed and whether enforcement was degraded.

### Detailed instructions

- In `src/schemas/securityPosture.ts`, add a **required** field to
  `SecurityPostureSchema` (keep `version: 1`):
  - `agentCommands: Schema.Array(Schema.Struct({ command: Schema.NonEmptyString, source: Schema.Literal("config", "gate"), explicit: Schema.Boolean, requiredByPlan: Schema.Boolean, enforcement: Schema.Literal("exact", "prefix", "executable", "none"), degraded: Schema.Boolean }))`
  - Add `"command-precision"` to the `marks` literal union so degraded command
    enforcement surfaces as a mark.
- In `src/app/executePlan.ts`, where the posture is built (~line 546), after the
  provider is selected (`resolution.selected.provider`):
  - Call `computeFrozenAgentCommands({ configCommands: config.security.agentCommands, gateCommands, requiredCommands: plan.run.requiredCommands, provider: resolution.selected.provider })`.
  - Put `records` on `securityPosture.agentCommands`.
  - When the frozen result is `degraded`, append `"command-precision"` to
    `marks` (do not set the top-level `downgraded`, which stays tied to
    filesystem jail per Q2).
  - This computation happens before the agent spawn → the set is frozen for the
    phase (config was loaded once at run start; assert this in tests).
- Extend the `security.policy.applied` telemetry event minimally if convenient
  (e.g. a `commandsDegraded` boolean) — optional; only if it fits the existing
  event shape without churn. If it doesn't fit cleanly, skip and note it.
- Update `src/app/finalReport.ts` `formatSecurityPosture` to render the agent
  command rows (command, source, enforcement, degraded) in the security section
  so the final report stays a faithful view of the posture.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/securityPosture.ts`
- `src/app/executePlan.ts`
- `src/app/finalReport.ts`
- `tests/unit/security/posture.test.ts`

### Optional files that may be edited

- `src/schemas/telemetryEvents.ts`
- `src/domain/telemetry/events.ts`
- `src/infra/telemetry/layer.ts`
- `tests/integration/executePlan.test.ts`

### Boundary contracts

Consumer: `executePlan` consumes `computeFrozenAgentCommands` (phase-01),
`config.security.agentCommands` (phase-02), and `plan.run.requiredCommands`
(phase-03). Producer: the `security.json` artifact gains the `agentCommands`
record array — consumed by `finalReport` and human reviewers. Stable shape: the
`AgentCommandRecord` array encoded by `encodeSecurityPosture`.

### Test strategy

- `posture.test.ts`: a posture including `agentCommands` round-trips through
  `encode`/`decode`; a posture missing the field fails decode (required-field
  assertion); `"command-precision"` mark accepted.
- Integration (optional): a secure-mode phase run writes a `security.json` whose
  `agentCommands` reflects config ∪ gates with correct provider enforcement, and
  config mutated *after* resolution does not change the recorded set (freezing).

### Implementation order

Posture schema field + mark → executePlan computation/recording → finalReport
rendering → tests.

### Excluded scope

- Feeding the frozen set to the provider allowlist (phase-05).
- Preflight failure (phase-06).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `agentCommands` record shape now in `SecurityPosture` and that the
  field is required at `version: 1`.
- Where in `executePlan` the frozen set is computed (before agent spawn) and how
  `"command-precision"` is appended to `marks` while `downgraded` is left to
  filesystem jail.
- Whether the telemetry event was extended or deliberately left unchanged.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): record frozen agentCommands in phase security.json

### Commit body

Extend SecurityPosture with a required agentCommands record array (command,
source, explicit, requiredByPlan, enforcement, degraded) and a command-precision
mark, compute the frozen set in executePlan before the agent spawns, and render
it in the final report. Records why each command was allowed and whether
enforcement was degraded. Covered by posture round-trip tests.

---

## phase-05 — Enforce the frozen set in the provider allowlist {#phase-05-provider-enforce}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the agent's actual executable permissions come from the frozen
`agentCommands` set (config ∪ gates), unifying the permission model so the agent
can run explicitly-allowed commands beyond the gates — the spec's core fix.

### Detailed instructions

- In `src/ports/backend.ts`, replace `AgentRunOptions.gateCommands` with
  `agentCommands?: readonly string[] | undefined` — the frozen effective command
  strings the agent may execute. Update the doc comment to describe the unified
  concept (config ∪ gate commands, frozen before execution).
- In `src/app/executePlan.ts`, set `agentCommands` on the `agentOptions` object
  (line ~592) to the **command strings** of the frozen records computed in
  phase-04 (reuse that computation result — compute once, use for both
  security.json and the provider). Remove the old `gateCommands` field from
  `agentOptions`. The separate gate *runner* call (`runGates`, ~line 653) keeps
  using `gateCommands` directly — that is phax executing gates, not the agent.
- In `src/infra/providers/claudeCode.ts`: rename the `gateCommands` parameter of
  `buildSecureClaudeFlags` to `agentCommands` and feed `options.agentCommands ?? []`
  into `gateCommandAllowRules`. Keep the empty-set fallback to
  `--disallowed-tools Bash`. Update the surrounding comments to say the allowlist
  is the frozen agentCommands set, not only gates.
- `codex-cli` and `mistral-vibe` need no flag change (they enforce no per-command
  allowlist); confirm they ignore `agentCommands` and update their comments to
  note the frozen set is recorded in `security.json` but not enforced at command
  level by these providers (`enforcement: "none"`).
- Update all references to `options.gateCommands` / `AgentRunOptions.gateCommands`
  across providers and tests.

### Planned files to create

- (none)

### Planned files to edit

- `src/ports/backend.ts`
- `src/app/executePlan.ts`
- `src/infra/providers/claudeCode.ts`
- `tests/unit/providers/claudeCode.test.ts`

### Optional files that may be edited

- `src/infra/providers/codexCli.ts`
- `src/infra/providers/mistralVibe.ts`
- `tests/integration/executePlan.test.ts`

### Boundary contracts

Consumer/producer: `executePlan` produces `AgentRunOptions.agentCommands` (the
frozen command strings); `claudeCode` consumes it to build `--allowedTools Bash`
rules. The stable shape is `readonly string[]`; empty means full Bash deny
(claude) / sandbox-only (codex, vibe).

### Test strategy

- `claudeCode.test.ts`: `agentCommands` containing an explicit non-gate command
  (e.g. `deno fmt`) produces a matching `Bash(deno fmt:*)` allow rule; empty set
  falls back to `--disallowed-tools Bash`; existing gate-derived expectations
  updated to the renamed field.
- Integration (optional): a secure phase whose config grants an extra command
  passes that command into the claude args.

### Implementation order

Port rename → executePlan wiring (reuse phase-04 frozen result) → claudeCode
parameter/flags → codex/vibe comment updates → tests.

### Excluded scope

- Preflight (phase-06) and planning skill (phase-07).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- That `AgentRunOptions.gateCommands` is now `agentCommands` and carries the
  frozen effective set; how `executePlan` reuses the phase-04 computation.
- That claude enforces it (prefix) while codex/vibe record-but-don't-enforce.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): enforce frozen agentCommands in provider allowlist

### Commit body

Replace AgentRunOptions.gateCommands with the unified frozen agentCommands set
(config ∪ gates) and feed it into Claude's --allowedTools Bash rules so the agent
can run explicitly-allowed commands beyond the gates. Codex/Vibe record the set
without command-level enforcement. Covered by provider flag tests.

---

## phase-06 — Security preflight for required commands {#phase-06-preflight}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Validate before any agent spawns that every command the plan declares it requires
is covered by the frozen set, failing the run early with a clear diagnostic, and
surfacing enforcement-degradation warnings.

### Detailed instructions

- Add `SecurityPreflightError` to `src/domain/errors.ts`
  (`Data.TaggedError("SecurityPreflightError")<{ message: string; missing: readonly string[] }>`).
- In `src/app/executePlan.ts`, after the gate profile is resolved and the plan is
  available, **before the phase loop / first agent spawn**, run a provider-
  independent preflight:
  - Call `checkRequiredCommands({ requiredCommands: plan.run.requiredCommands, configCommands: config.security.agentCommands, gateCommands })`.
  - If `missing` is non-empty, fail with `SecurityPreflightError` carrying a
    diagnostic in the spec §14 shape (list the missing commands and instruct the
    developer to update `security.agentCommands`).
- Add `SecurityPreflightError` to the error unions threaded through
  `executePlan`'s signature and any dispatcher mapping (follow how
  `GateFailedError` / `SecurityEnforcementError` are surfaced to the CLI exit
  path; mirror their formatting in `formatError`/CLI output).
- Degradation reporting (per-phase, provider-dependent) already lands in
  `security.json` via phase-04. Additionally emit a concise stderr/telemetry
  warning when a phase's frozen result is degraded (spec §14 "precision
  warning"); reuse the existing per-phase logging path rather than inventing a
  new channel.
- Extend the `--dry-run` report (`src/app/dryRun.ts`) to show the configured
  `agentCommands` and the plan's `requiredCommands`, and flag any required
  command not covered (so `--dry-run` previews a preflight failure without
  starting the run). Note: `buildDryRunReport` currently takes `config` + plan
  context; thread `plan.run.requiredCommands` and `config.security.agentCommands`
  into the report struct.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/errors.ts`
- `src/app/executePlan.ts`
- `src/app/dryRun.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/dryRun.test.ts`

### Optional files that may be edited

- `src/schemas/formatError.ts`
- `src/cli/commands/run.ts`
- `tests/unit/security/agentCommands.test.ts`

### Boundary contracts

Consumer: preflight consumes `checkRequiredCommands` (phase-01),
`plan.run.requiredCommands` (phase-03), `config.security.agentCommands`
(phase-02), and the resolved gate commands. Producer: a `SecurityPreflightError`
on the run path and the extended dry-run report. The error must reach the CLI
exit code path the same way existing run errors do.

### Test strategy

- Integration (`executePlan.test.ts`): a plan requiring a command absent from
  config+gates fails with `SecurityPreflightError` **before** any agent runs (no
  agent invocation observed); a plan whose required commands are all covered
  proceeds.
- `dryRun.test.ts`: report lists `agentCommands` + `requiredCommands` and flags an
  uncovered required command.
- Unit: extend `agentCommands.test.ts` if any preflight edge (broad-covers-narrow)
  needs an executePlan-level assertion.

### Implementation order

Error type → executePlan preflight call + error threading → CLI/format wiring →
degradation warning → dry-run report → tests.

### Excluded scope

- Planning-skill changes (phase-07).
- Per-command provider enforcement (done in phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `SecurityPreflightError` name/shape and exactly where in `executePlan` the
  preflight runs (before the phase loop) and how the error reaches the CLI exit
  path.
- The dry-run report additions.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): preflight required agent commands before run

### Commit body

Validate that every plan-declared required command is covered by the frozen set
(config ∪ gates) before any agent spawns, failing early with a SecurityPreflight
error in the spec's diagnostic shape, and surface degradation warnings. Extend
the dry-run report to preview coverage. Covered by integration and dry-run tests.

---

## phase-07 — Planning skill: warn on new tools and emit required commands {#phase-07-planning-skill}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Teach the planning skill to detect when a plan introduces a new tool/runtime/
package manager/CLI and to emit a plan-level required-commands declaration plus a
pre-run security-configuration note, closing the loop with the phase-06 preflight.

### Detailed instructions

- Edit `.skills/phax-planning.md`:
  - Document the new **required** plan-level field: a top-of-plan
    `## Required commands` section listing the commands the plan needs (one per
    line, `- (none)` when empty), extracted into `run.requiredCommands`. Specify
    the exact authoring format so the extractor (phase-03 schema) succeeds.
  - Add guidance: when a plan introduces a new tool/runtime/package manager/
    provider CLI/command family (examples: Deno, Bun, pnpm, Vitest, Playwright,
    ESLint, Biome, Cargo, Docker, gh), the plan must (a) list the needed commands
    in `## Required commands`, and (b) include a `## Required PHAX security
    configuration changes` note instructing the developer to add those commands
    to `security.agentCommands` before running, mirroring spec §12's example.
  - State the broad-vs-narrow tradeoff (`deno` vs `deno fmt`) and that narrow
    allowances may be degraded to `none` by codex/vibe (recorded in
    `security.json`).
  - Note that newly introduced tools are **not** assumed available — they must be
    declared.
  - Add `requiredCommands` to the per-phase/plan field documentation tables as a
    run-level extracted field so the skill's field set stays accurate.

### Planned files to create

- (none)

### Planned files to edit

- `.skills/phax-planning.md`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: the planning skill instructs authors to write `## Required commands` →
`run.requiredCommands` (phase-03) → preflight (phase-06). No code contract; this
phase aligns the human-authoring format with the extractor and preflight already
built.

### Test strategy

Documentation only — no gate-testable code. Verification is the `full` gate
profile passing (the doc change must not break any test that snapshots or reads
the skill). Manually confirm the documented `## Required commands` format matches
what phase-03's extractor expects.

### Implementation order

Required-commands format section → new-tool detection guidance → broad/narrow
note → field-table update.

### Excluded scope

- Any code changes (all in prior phases).
- Skill installation mechanics (separate spec 08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `## Required commands` authoring format documented, confirmed to
  match the phase-03 extractor field `run.requiredCommands`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(skill): warn on new tools and require commands in planning skill

### Commit body

Update the phax planning skill to document the plan-level required-commands
declaration extracted into run.requiredCommands, detect plans that introduce a
new tool or command family, and emit a pre-run security-configuration note so the
phase-06 preflight passes. Documentation only.
