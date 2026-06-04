# Implementation plan — Provider-native security mode (run jail)

> Run short name: `run-jail`.
> Deliverable location: `docs/plans/04-run-jail-plan.md`.
> Format: matches `.skills/phax-planning.md` so `phax extract-plan` can consume
> this file. Each phase carries a `{#phase-NN-...}` anchor for the
> `planMarkdownAnchor` field and declares its planned files.
> Scope note: the **real end-to-end provider sandbox validation** (does the
> installed `claude` / `codex` / `vibe` actually accept and enforce the flags we
> emit?) is intentionally **not** a phax phase here. It lives in
> `docs/plans/04b-run-jail-provider-validation.md` and is run **manually**, not
> via the phax CLI — mirroring how `03b-provider-e2e-validation.md` validated the
> phase-03/04 adapter work. This plan delivers the code + unit-test changes that
> the manual runbook then validates against the real CLIs.

---

## Context

This plan implements `docs/specs/04-run-jail.md`: make PHAX safe by default by
applying the strongest available **provider-native** execution boundary for each
provider before an agent runs, with an explicit `unsafe` opt-in and a stubbed
future `isolated` mode.

### Decisions encoded in this plan

1. **Security posture is recorded in a dedicated per-phase `security.json`
   artifact** (written next to `model-resolution.json`), surfaced in a
   `security.policy.applied` telemetry event and a new **Security** section of
   `final-report.md`. It is **not** added to `run-status.json`: that schema is
   written only through the dispatcher/effect-runner (the single-writer
   architectural guard), and adding required fields there would break decoding
   of existing on-disk runs. The new artifact schema keeps every field
   **required** (per the project rule: persisted schemas get required fields, no
   optional-for-archived shims).
2. **Provider secure-mode flags are produced by pure, exported arg-builders**
   (`buildArgs` / `buildCodexArgs` / `buildVibeArgs`) and covered by unit tests
   for both `secure` and `unsafe` inputs. Whether the installed CLI accepts and
   actually enforces those flags is verified in the manual runbook `04b`.
3. **The default flip to `secure` is the last behavioral change.** The resolved
   default security profile stays `unsafe` (today's behavior) through phases
   01–07 so every intermediate commit preserves current behavior; phase-08 flips
   the default, adds the `--security` flag, the unsafe warning, the `isolated`
   stub, and `phax security status`. This avoids any window where "secure" is the
   default but silently enforces nothing.
4. **Plan extraction is out of scope** *for jailing this iteration*.
   `extractPlanCore` reads the user repo and writes only the plan; it passes a
   host/`unsafe` policy to satisfy the new port field. **Follow-up intent:** the
   extraction agent only needs the prompt to produce the plan JSON, so a later
   iteration should jail it *more strictly than phase execution* — read-only
   access (or no repo write beyond the plan output) and provider-API-only
   network — not merely the same secure profile. Tracked as a follow-up, not
   built here.

### What exists today (anchors)

- `src/ports/backend.ts` — `AgentRunOptions` (`provider`, `model`, `effort`,
  `cwd`, `outputJsonlPath?`, `phaseFolderPath?`) is the single struct every
  adapter receives. `BackendOps.runAgent` / `resumeAgentSession` carry it.
- `src/infra/providers/claudeCode.ts` — `buildArgs` (not yet exported) hardcodes
  `--permission-mode bypassPermissions` (the current host-unrestricted behavior).
- `src/infra/providers/codexCli.ts` — `buildCodexArgs` (exported) hardcodes
  `--dangerously-bypass-approvals-and-sandbox`.
- `src/infra/providers/mistralVibe.ts` — `buildVibeArgs` (exported) hardcodes
  `--agent auto-approve`, `--trust`, `--workdir <cwd>`.
- `src/infra/providers/dispatcher.ts` — `makeNodeBackendLayer` routes to the
  three adapters and maps `AgentSessionIdMissingError` → `AgentInvocationError`.
- `src/app/executePlan.ts` — builds `AgentRunOptions` (≈ line 345) from the
  routing resolution, writes `model-resolution.json`, then calls
  `backend.runAgent` and `runGatesWithFixLoop`. `worktreePath` and
  `config.stateRoot` are both in scope here.
- `src/app/fixLoop.ts` — reconstructs `AgentRunOptions` field-by-field when
  calling `resumeAgentSession` (≈ line 245).
- `src/domain/routing/resolve.ts` — `resolveModel(request, routing, providerCfg)`
  walks `routing.providerPriority`, already `continue`-ing past providers that
  fail constraints; falls back to terminal `claude-code`. `RoutingResolution`
  (`src/domain/routing/types.ts`) is a plain type (not schema-validated) written
  to `model-resolution.json` via `JSON.stringify`.
- `src/domain/routing/types.ts` — `ProviderId = "claude-code" | "mistral-vibe" |
  "codex-cli"`.
- `src/schemas/phaxConfig.ts` — `PhaxConfigSchema` + `ResolvedConfig`;
  `src/app/loadConfig.ts` resolves defaults (`expandTilde` for `state.root`).
- `src/domain/errors.ts` — `Data.TaggedError` classes;
  `src/cli/commands/runLayers.ts` `exitCodeForError` maps each to an exit code.
- `src/domain/telemetry/events.ts` + `src/schemas/telemetryEvents.ts` — the
  semantic event union + per-event maker + Effect schema (kept in lockstep).
- `src/app/finalReport.ts` — `writeFinalReport(info)` (uses `FileSystem`) renders
  `final-report.md` from `RunReviewInfo`.
- `src/app/providerProbe.ts` / `src/cli/commands/agent.ts` — `probeProviders`
  (Shell `--version`) and the `agent probe` command (capability-style report).
- `tests/unit/architecturalGuards.test.ts` — `PURE_DOMAIN_DIRS`
  (`domain/routing`, `domain/reconciliation`) purity guard: those dirs may not
  import `effect`, `@opentelemetry`, `ports/fs`, or `infra/`. `src/domain/security/`
  must join this set.
- `tests/type/routing.ts` — compile-time domain↔schema literal-sync guard;
  `tests/unit/skills.test.ts`, `tests/unit/runArgv.test.ts`,
  `tests/unit/dryRun.test.ts` guard CLI/skill/dry-run surfaces.
- `knip` treats every `tests/**/*.test.ts` and `tests/type/*.ts` as an entry
  point, so a new export consumed only by its own test is **not** flagged unused.

### Target domain model (decided)

Per the project's "explicit per-variant enums" rule, provider capabilities are an
explicit per-provider map, not a permissive superset.

```ts
// src/domain/security/types.ts
export type SecurityMode = "secure" | "unsafe" | "isolated";
export type NetworkProfile = "provider-only" | "dev-allowlist" | "open";
export type McpMode = "disabled" | "local-only" | "allowlist" | "provider-default";

export interface SecurityPolicy {
  readonly mode: SecurityMode;
  readonly filesystem: { readonly allowRead: readonly string[]; readonly allowWrite: readonly string[] };
  readonly network: { readonly profile: NetworkProfile; readonly allowDomains: readonly string[] };
  readonly mcp: { readonly mode: McpMode; readonly allow: readonly string[] };
  readonly failClosed: boolean; // true in secure mode
}

export const PROVIDER_API_DOMAINS: Record<ProviderId, string> = {
  "claude-code": "api.anthropic.com",
  "codex-cli": "api.openai.com",
  "mistral-vibe": "api.mistral.ai",
};
```

```ts
// src/domain/security/capabilities.ts
export type JailStrength = "strong" | "partial" | "none";
export type CapabilitySupport = "supported" | "unsupported";
export interface ProviderSecurityCapability {
  readonly filesystemJail: JailStrength;
  readonly networkAllowlist: CapabilitySupport;
  readonly mcpAllowlist: CapabilitySupport;
}
export const PROVIDER_SECURITY_CAPABILITIES: Record<ProviderId, ProviderSecurityCapability> = {
  "claude-code": { filesystemJail: "strong",  networkAllowlist: "supported",   mcpAllowlist: "supported" },
  "codex-cli":   { filesystemJail: "strong",  networkAllowlist: "supported",   mcpAllowlist: "supported" },
  "mistral-vibe":{ filesystemJail: "partial", networkAllowlist: "unsupported", mcpAllowlist: "supported" },
};
```

---

## phase-01 — Security policy domain model and project config block {#phase-01-security-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Add the pure security-policy domain (modes, network/MCP profiles, the resolved
`SecurityPolicy`, the provider API-domain map, and `resolveSecurityPolicy`), and
let projects declare a `security` block in `phax.json`. The resolved default
profile is **`unsafe`** in this phase (behavior unchanged); phase-08 flips it.

### Detailed instructions

- Create `src/domain/security/types.ts` with `SecurityMode`, `NetworkProfile`,
  `McpMode`, the `SecurityPolicy` interface, and the `PROVIDER_API_DOMAINS`
  constant, exactly as in the Context "Target domain model" block. Pure module —
  no `effect`, no `infra/`, no `ports/fs` imports.
- Create `src/domain/security/resolvePolicy.ts` exporting
  `resolveSecurityPolicy(input): SecurityPolicy` where
  `input = { mode: SecurityMode; provider: ProviderId; worktreePath: string;
  stateRoot: string; config: ResolvedSecurityConfig }`. Behavior:
  - **secure**: `filesystem.allowWrite = [worktreePath, stateRoot,
    ...config.filesystem.allowWrite]`; `filesystem.allowRead = allowWrite ∪
    config.filesystem.allowRead`; `network.profile = config.network.profile`,
    `network.allowDomains = [PROVIDER_API_DOMAINS[provider],
    ...(profile === "provider-only" ? [] : config.network.allowDomains)]`;
    `mcp = config.mcp`; `failClosed = true`. Paths are passed already-absolute by
    the caller; de-duplicate. Default `network.profile` is `provider-only`,
    default `mcp.mode` is `disabled`.
  - **unsafe**: `failClosed = false`; empty allow-lists (adapters key off
    `mode === "unsafe"` to apply host-unrestricted flags, so the lists are
    unused). `mode` is carried through verbatim.
  - **isolated**: not resolved here — the CLI rejects it before a run starts
    (phase-08). If reached, throw/Effect-fail is unnecessary; treat like secure
    for type totality but document that the CLI gates it.
- Create `src/schemas/securityConfig.ts`:
  - `SecurityProfileSchema = Schema.Literal("secure","unsafe","isolated")`,
    `NetworkProfileSchema`, `McpModeSchema` literal schemas.
  - `SecurityConfigSchema` (all keys optional) matching spec §17:
    `profile?`, `filesystem?{ allowRead?, allowWrite? }`,
    `network?{ profile?, allowDomains? }`, `mcp?{ mode?, allow? }`.
  - `export const DEFAULT_SECURITY_PROFILE: SecurityMode = "unsafe";` (phase-08
    flips this single line to `"secure"`).
  - `ResolvedSecurityConfig` type with all fields populated, and a helper
    `resolveSecurityConfig(raw, defaultProfile)` applying the defaults
    (profile → `DEFAULT_SECURITY_PROFILE`, network.profile → `provider-only`,
    mcp.mode → `disabled`, arrays → `[]`).
- In `src/schemas/phaxConfig.ts`: add `security: Schema.optional(SecurityConfigSchema)`
  to `PhaxConfigSchema`, add `security: ResolvedSecurityConfig` to
  `ResolvedConfig`, and re-export the resolved type.
- In `src/app/loadConfig.ts`: populate `resolved.security` via
  `resolveSecurityConfig(config.security, DEFAULT_SECURITY_PROFILE)`. Resolve any
  relative `filesystem.allow*` config entries against `gitRoot` and expand `~`
  with the existing `expandTilde`.
- In `tests/unit/architecturalGuards.test.ts`: add `domain/security` to
  `PURE_DOMAIN_DIRS` and add a `describe` block asserting `src/domain/security/`
  imports no `effect` / `@opentelemetry` / `ports/fs` / `infra/` (copy the
  routing/reconciliation guard).

### Planned files to create

- `src/domain/security/types.ts`
- `src/domain/security/resolvePolicy.ts`
- `src/schemas/securityConfig.ts`
- `tests/unit/security/resolvePolicy.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/loadConfig.test.ts`

### Optional files that may be edited

- `tests/type/security.ts`
- `tests/unit/schemas.test.ts`

### Boundary contracts

Config → domain: `loadConfig` (producer) resolves the raw `security` block into a
total `ResolvedSecurityConfig`; `resolveSecurityPolicy` (consumer) turns it plus a
worktree/stateRoot/provider into a concrete `SecurityPolicy`. The schema literals
in `securityConfig.ts` and the domain literals in `security/types.ts` must agree;
`tests/type/security.ts` is the optional compile-time guard (mirror
`tests/type/routing.ts`).

### Test strategy

Pure domain + schema → unit tests, written **before** implementation (stable
contract): `resolveSecurityPolicy` for secure (worktree + `~/.phax` + configured
extras, provider domain present, dev-allowlist vs provider-only) and unsafe
(failClosed false, host semantics). Assert `loadConfig` defaults in
`loadConfig.test.ts`. The architectural-guard test enforces purity.

### Implementation order

`security/types.ts` → `securityConfig.ts` → `resolvePolicy.ts` →
`phaxConfig.ts`/`loadConfig.ts` → guard + tests.

### Excluded scope

- Provider capability evaluation (phase-02).
- Any adapter, routing, CLI, or default-profile change (phases 03–08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exported names and signatures in `src/domain/security/types.ts`,
  `resolvePolicy.ts`, and `src/schemas/securityConfig.ts` (incl.
  `ResolvedSecurityConfig`, `resolveSecurityConfig`, `DEFAULT_SECURITY_PROFILE`).
- Confirmation `DEFAULT_SECURITY_PROFILE` is still `"unsafe"` and where phase-08
  flips it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): add security policy domain model and project config block

### Commit body

Introduce a pure security domain (SecurityMode/NetworkProfile/McpMode,
SecurityPolicy, PROVIDER_API_DOMAINS, resolveSecurityPolicy) and a project-level
`security` block in phax.json resolved into a total ResolvedSecurityConfig. The
resolved default profile stays `unsafe` so behavior is unchanged; the secure
default flip lands in a later phase. Adds domain/security to the purity guard.

---

## phase-02 — Provider security capability model {#phase-02-capabilities}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the explicit per-provider capability map and a pure evaluator that decides
whether a provider can satisfy a policy, what it downgrades, and how it is marked
(e.g. Mistral Vibe as "partially secured").

### Detailed instructions

- Create `src/domain/security/capabilities.ts`:
  - `JailStrength`, `CapabilitySupport`, `ProviderSecurityCapability`, and the
    `PROVIDER_SECURITY_CAPABILITIES` map exactly as in the Context block (Claude
    & Codex strong/supported; Vibe partial filesystem, network unsupported, MCP
    supported).
  - `SecurityMark = "partial-filesystem" | "network-unenforced" | "mcp-unenforced"`.
  - `SecurityEvaluation = { provider; satisfiesStrict: boolean;
    downgraded: boolean; marks: readonly SecurityMark[]; notes: readonly string[] }`.
  - `evaluateProviderSecurity(provider, policy): SecurityEvaluation`. In `secure`
    mode: `satisfiesStrict` is true only when the provider's `filesystemJail` is
    `strong` **and** (`network.profile !== "provider-only"` OR
    `networkAllowlist === "supported"`); otherwise `downgraded` is true with the
    matching marks. In `unsafe` mode everything is satisfiable, not downgraded,
    no marks.
  - `export const VIBE_PARTIAL_SECURED_MESSAGE = "Mistral Vibe is running with
    provider-native restrictions, but filesystem/network isolation is weaker than
    Claude Code or Codex. For stronger isolation, use the future external-sandbox
    mode.";` and include it in `notes` when Vibe is evaluated in secure mode.

### Planned files to create

- `src/domain/security/capabilities.ts`
- `tests/unit/security/capabilities.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/type/security.ts`

### Boundary contracts

Producer `evaluateProviderSecurity` gives consumers (routing fallback in
phase-03, `executePlan` in phase-04, `security status` in phase-08, the report in
phase-09) a single verdict object. Keep the semantic need stable
(`satisfiesStrict` / `downgraded` / `marks`); the exact mark strings can flex.

### Test strategy

Pure domain → unit tests, written **before** implementation: Claude/Codex satisfy
strict secure; Vibe does not (downgraded, `partial-filesystem` +
`network-unenforced` marks, the partial-secured note present); unsafe mode is
always satisfiable. This is a stable capability contract.

### Implementation order

`capabilities.ts` map → `evaluateProviderSecurity` → tests.

### Excluded scope

- Wiring the evaluation into routing or execution (phases 03–04).
- Any provider invocation change (phases 05–07).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `PROVIDER_SECURITY_CAPABILITIES` values and the exact `SecurityEvaluation`
  shape, plus the `SecurityMark` literals.
- Confirmation the Vibe partial-secured message constant is exported and emitted.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): add provider security capability model and evaluation

### Commit body

Add an explicit per-provider capability map (Claude/Codex strong, Vibe partial)
and a pure evaluateProviderSecurity verdict (satisfiesStrict, downgraded, marks,
notes) including the Vibe partial-secured message. Pure domain, unit-tested; not
yet wired into routing or execution.

---

## phase-03 — Security-aware provider fallback in routing {#phase-03-routing-fallback}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Let `resolveModel` skip a provider that cannot satisfy a strict security profile
and record the skip, so provider priority never overrides a security requirement
(spec §13, criteria 17–18). The mechanism is added here but stays inert until
`executePlan` passes a filter in phase-04.

### Detailed instructions

- In `src/domain/routing/resolve.ts`, add an **optional** last parameter to
  `resolveModel`: `securityFilter?: (provider: ProviderId) => { allowed: boolean;
  reason?: string }`. When present, inside the provider-priority walk, after a
  provider would otherwise be selected but `securityFilter(provider).allowed`
  is `false`, `continue` (record the skip) instead of returning it. The terminal
  `claude-code` fallback is **not** filtered — Claude is the guaranteed strong
  baseline (its own fail-closed lives in the adapter, phase-05). Omitting the
  parameter preserves today's behavior exactly (all existing resolve tests pass
  unchanged).
- In `src/domain/routing/types.ts`, add
  `readonly skippedForSecurity?: ReadonlyArray<{ readonly provider: ProviderId;
  readonly reason: string }>` to `RoutingResolution`, and append a sentence to
  the resolution `reason` when any provider was skipped. `RoutingResolution` is a
  plain type (serialized via `JSON.stringify`, not schema-decoded), so no schema
  edit is required.
- Keep `resolve.ts` pure: it may import the `ProviderId` type only; do **not**
  import `domain/security` (the caller supplies the predicate). This keeps the
  routing purity guard green.
- Extend `tests/unit/routing/resolve.test.ts` minimally to prove the no-filter
  path is unchanged, and add `tests/unit/routing/securityFallback.test.ts` for:
  a non-strict provider skipped to the next priority; all non-claude providers
  skipped falling through to terminal claude-code; `skippedForSecurity` and the
  reason populated.

### Planned files to create

- `tests/unit/routing/securityFallback.test.ts`

### Planned files to edit

- `src/domain/routing/resolve.ts`
- `src/domain/routing/types.ts`
- `tests/unit/routing/resolve.test.ts`

### Optional files that may be edited

- `tests/type/routing.ts`

### Boundary contracts

Consumer `executePlan` (phase-04) will build the predicate from
`evaluateProviderSecurity`; producer `resolveModel` only needs a
`(provider) => { allowed, reason }` function and reports skips on the resolution.
The predicate decouples routing from the security domain.

### Test strategy

Pure domain → unit tests. Write the fallback cases **before** implementation
(criteria 17–18 are stable invariants). Assert the existing no-filter resolutions
are byte-for-byte unchanged.

### Implementation order

`types.ts` (add field) → `resolve.ts` (predicate + skip + reason) → tests.

### Excluded scope

- Building/passing the predicate from real capabilities (phase-04).
- Adapter enforcement and the default flip (phases 05–08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `resolveModel` signature with the optional `securityFilter`, the
  `skippedForSecurity` field shape, and the rule that terminal claude-code is
  never filtered.
- Confirmation the no-filter behavior is unchanged (which tests prove it).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): skip providers that cannot satisfy the security profile

### Commit body

Add an optional securityFilter predicate to resolveModel so a provider that
cannot meet a strict security profile is skipped to the next priority and
recorded in RoutingResolution.skippedForSecurity, while terminal claude-code (the
strong baseline) is never filtered. Inert until executePlan supplies the filter;
no change to existing no-filter resolutions.

---

## phase-04 — Thread the security policy through execution {#phase-04-port-plumbing}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Carry a resolved `SecurityPolicy` on `AgentRunOptions` and build it per phase in
`executePlan` (and propagate it through the fix loop), add the typed
fail-closed error, and pass the security predicate to `resolveModel`. Adapters do
not change behavior yet (they receive the policy in phases 05–07); the default
profile is still `unsafe`, so a default run is byte-for-byte today's behavior.

### Detailed instructions

- In `src/ports/backend.ts`: add `readonly security: SecurityPolicy` to
  `AgentRunOptions` (import the type from `domain/security/types.js`). It is
  **required** — every call site must supply it.
- In `src/domain/errors.ts`: add
  `SecurityEnforcementError extends Data.TaggedError("SecurityEnforcementError")<{
  message: string; provider: string; mode: string }>`. Add it to the
  `ExecutePlanError` union in `executePlan.ts` and the error unions in
  `fixLoop.ts`, and map it in `runLayers.ts` `exitCodeForError` (new code `11`).
- In `src/infra/providers/dispatcher.ts`: let `SecurityEnforcementError` pass
  through the `mapError` in both `runAgent` and `resumeAgentSession` (it is not
  re-wrapped as `AgentInvocationError`).
- In `src/app/executePlan.ts`, per phase, before building `AgentRunOptions`:
  - Compute `mode = config.security.profile`.
  - Build the routing `securityFilter` from `evaluateProviderSecurity` against a
    policy resolved for each candidate provider (use the policy's strictness, not
    literal paths): `(provider) => { allowed: mode !== "secure" ||
    evaluateProviderSecurity(provider, policyFor(provider)).satisfiesStrict }`,
    with a reason string when disallowed. Pass it to `resolveModel`.
  - After resolution, `const security = resolveSecurityPolicy({ mode,
    provider: resolution.selected.provider, worktreePath, stateRoot:
    config.stateRoot, config: config.security })` and set
    `agentOptions.security = security`.
  - Emit nothing new yet (the artifact + telemetry land in phase-09).
- In `src/app/fixLoop.ts`: when calling `resumeAgentSession`, **spread**
  `agentOptions` and override only `outputJsonlPath` (instead of rebuilding the
  struct field-by-field), so `security` propagates automatically.
- In `src/app/extractPlan.ts`: pass `security` on the extraction `runAgent` call
  using an `unsafe`/host policy (`resolveSecurityPolicy({ mode: "unsafe",
  provider: "claude-code", worktreePath: opts.cwd, stateRoot: opts.cwd, ... })`
  or a small `hostSecurityPolicy()` helper). Document that extraction jailing is
  out of scope this iteration, and leave a `// TODO(security): jail extraction
  stricter than execution — read-only repo, provider-API-only network` marker so
  the follow-up has a home (see "Decisions encoded in this plan" §4).
- Update `src/infra/fakes/backend.ts` if its recorded-options type needs the new
  field. Extend `tests/integration/executePlan.test.ts` to assert the fake
  backend receives an `AgentRunOptions.security` with `mode === "unsafe"`
  (default) and the worktree present in a `secure`-mode case if easily forced.

### Planned files to create

- (none)

### Planned files to edit

- `src/ports/backend.ts`
- `src/domain/errors.ts`
- `src/infra/providers/dispatcher.ts`
- `src/app/executePlan.ts`
- `src/app/fixLoop.ts`
- `src/app/extractPlan.ts`
- `src/cli/commands/runLayers.ts`
- `tests/integration/executePlan.test.ts`

### Optional files that may be edited

- `src/infra/fakes/backend.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/unit/providers/codexCli.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`

### Boundary contracts

Producer `executePlan` → consumer adapters: `AgentRunOptions.security` is the
single concrete contract the adapters (phases 05–07) read. `executePlan` →
`resolveModel`: the `securityFilter` predicate (phase-03). `executePlan` →
`fixLoop`: the same `agentOptions` (carrying `security`) flow into the resume.

### Test strategy

Application/integration layer → integration tests with fake ports. Assert the
fake backend records a populated `security` policy (default `unsafe`); the
provider arg-level effects are unit-tested in phases 05–07. No test-first
requirement for plumbing, but keep the integration assertion.

### Implementation order

`backend.ts` + `errors.ts` (types) → `dispatcher.ts` + `runLayers.ts` (error
flow) → `executePlan.ts` (build + pass) → `fixLoop.ts`/`extractPlan.ts`
(propagate) → tests + fakes.

### Excluded scope

- Mapping the policy to provider flags (phases 05–07).
- Flipping the default to secure / CLI `--security` (phase-08).
- Persisting the posture / telemetry (phase-09).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final `AgentRunOptions` shape (with `security`), the
  `SecurityEnforcementError` fields, its exit code (`11`), and the exact place in
  `executePlan` where the policy and filter are built.
- The `fixLoop` spread change and the `extractPlan` host-policy decision.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): thread resolved security policy through phase execution

### Commit body

Carry a required SecurityPolicy on AgentRunOptions, build it per phase in
executePlan (and pass the routing securityFilter), propagate it through the fix
loop via option spread, and supply a host policy for plan extraction. Add a
SecurityEnforcementError (exit 11) that flows through the dispatcher unwrapped.
No adapter behavior change yet; default profile remains unsafe.

---

## phase-05 — Claude Code secure-mode enforcement {#phase-05-claude-enforce}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Map the `SecurityPolicy` onto Claude Code invocation flags: sandboxed,
worktree + `~/.phax` filesystem access, network allowlist, MCP disabled/
allowlisted, no unsandboxed commands — and **fail closed** if the sandbox cannot
be requested in secure mode (criteria 6–10). `unsafe` keeps today's
`bypassPermissions` behavior.

### Detailed instructions

- Export `buildArgs` from `src/infra/providers/claudeCode.ts` and make it take the
  full `AgentRunOptions` (so it can read `options.security`). Branch on
  `security.mode`:
  - **unsafe**: emit today's vector (`--permission-mode bypassPermissions`).
  - **secure**: emit the strongest native policy PHAX can apply — sandbox enabled,
    filesystem limited to `security.filesystem.allow*` (worktree + `~/.phax` +
    configured), a network allowlist from `security.network.allowDomains`, MCP
    per `security.mcp` (disabled or an explicit allowlist), and disallow
    unsandboxed bash. Use the real flag/settings surface confirmed against the
    installed `claude` CLI (see runbook `04b`); centralize the secure flag set in
    a small documented helper so `04b` findings map to one place.
  - If secure mode is requested but the sandbox cannot be expressed (capability
    missing), **fail closed** with `SecurityEnforcementError` (provider
    `claude-code`) — never silently fall back to `bypassPermissions`.
- Keep `runClaudeAgent` / `resumeAgentSession` otherwise unchanged; only the arg
  construction and the fail-closed branch are new.
- Create `tests/unit/providers/claudeCode.test.ts` asserting `buildArgs` for:
  unsafe (contains `bypassPermissions`); secure (sandbox flag present,
  `bypassPermissions` absent, worktree + `~/.phax` in the filesystem flags,
  provider domain in the network flags, MCP disabled); and that a secure request
  with an impossible policy yields the fail-closed error path.

### Planned files to create

- `tests/unit/providers/claudeCode.test.ts`

### Planned files to edit

- `src/infra/providers/claudeCode.ts`

### Optional files that may be edited

- `src/infra/providers/dispatcher.ts`
- `src/schemas/claudeOutput.ts`

### Boundary contracts

Adapter → CLI: in secure mode `buildArgs` must emit a vector the installed
`claude` accepts and that actually sandboxes (verified in `04b`). Adapter →
domain: a secure request that cannot be sandboxed surfaces
`SecurityEnforcementError`, which `executePlan` does not downgrade.

### Test strategy

Adapter layer → unit tests over the pure `buildArgs` for both modes and the
fail-closed branch. Live enforcement (does the sandbox really deny `~/.ssh`,
etc.) is the manual runbook `04b`. Write the unsafe-parity test **before**
changing the function so the unsafe vector is provably preserved.

### Implementation order

Export + reshape `buildArgs` → unsafe parity branch → secure flag helper →
fail-closed branch → tests.

### Excluded scope

- Codex and Vibe adapters (phases 06–07).
- Live sandbox validation (runbook `04b`).
- Default flip / CLI surface (phase-08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact secure-mode Claude flag set (sandbox, filesystem, network, MCP,
  unsandboxed-command denial) and the unsafe vector, plus where the fail-closed
  `SecurityEnforcementError` is raised.
- The open items for runbook `04b` (which flags still need live confirmation).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(claude): enforce provider-native sandbox in secure mode, fail closed

### Commit body

Map the resolved SecurityPolicy onto Claude Code flags: secure mode enables the
sandbox, limits filesystem to the worktree and ~/.phax, applies a network
allowlist, disables/allowlists MCP, and disallows unsandboxed commands; unsafe
mode preserves bypassPermissions. A secure request that cannot be sandboxed fails
closed with SecurityEnforcementError instead of running unrestricted. Unit-tested
for both modes.

---

## phase-06 — Codex CLI secure-mode enforcement {#phase-06-codex-enforce}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Map the `SecurityPolicy` onto a restrictive Codex permission profile (workspace
write limited to the worktree + `~/.phax`, network allowlist, MCP disabled/
allowlisted, non-interactive approvals that do not escape the sandbox) and fail
closed if the profile cannot be enforced (criteria 11–14). `unsafe` keeps today's
`--dangerously-bypass-approvals-and-sandbox`.

### Detailed instructions

- Rework `buildCodexArgs` in `src/infra/providers/codexCli.ts` to read
  `options.security` and branch on `mode`:
  - **unsafe**: today's vector (`--dangerously-bypass-approvals-and-sandbox`).
  - **secure**: a restrictive sandbox (e.g. `--sandbox workspace-write`) with
    writable roots set to `security.filesystem.allowWrite` (worktree + `~/.phax`),
    network access governed by `security.network` (denied unless the policy lists
    domains), MCP per `security.mcp`, and an approval mode that does not silently
    escape the sandbox — using the real `codex exec` config surface confirmed
    against the installed CLI (runbook `04b`); express network/roots via the
    documented `-c` config keys where flags do not exist.
  - If the restrictive profile cannot be applied in secure mode, **fail closed**
    with `SecurityEnforcementError` (provider `codex-cli`).
- Update `tests/unit/providers/codexCli.test.ts` to assert the secure vector
  (sandbox not `danger-full-access`, writable roots include worktree + `~/.phax`,
  approval does not bypass) and that the unsafe vector is unchanged.

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/providers/codexCli.ts`
- `tests/unit/providers/codexCli.test.ts`

### Optional files that may be edited

- `src/schemas/codexOutput.ts`

### Boundary contracts

Adapter → CLI: secure `buildCodexArgs` must emit a vector the installed `codex`
accepts and that confines writes/network as configured (verified in `04b`).
Adapter → domain: an unenforceable secure profile surfaces
`SecurityEnforcementError`.

### Test strategy

Adapter layer → unit tests over the pure `buildCodexArgs` for both modes and the
fail-closed branch. Live confinement is runbook `04b`. Keep the unsafe-parity
assertion.

### Implementation order

Branch `buildCodexArgs` on mode → secure sandbox/roots/network/approval →
fail-closed branch → tests.

### Excluded scope

- Claude and Vibe adapters (phases 05, 07).
- Live confinement validation (runbook `04b`).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact secure `codex exec` vector (sandbox value, writable roots, network
  config keys, approval mode) and the unsafe vector, plus the fail-closed point.
- Open items for runbook `04b`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(codex): enforce workspace-write sandbox in secure mode, fail closed

### Commit body

Map the resolved SecurityPolicy onto a restrictive codex exec profile in secure
mode (workspace-write sandbox, writable roots limited to the worktree and
~/.phax, network allowlist, MCP disabled/allowlisted, non-escaping approvals);
unsafe mode preserves the danger-full-access bypass. An unenforceable secure
profile fails closed with SecurityEnforcementError. Unit-tested for both modes.

---

## phase-07 — Mistral Vibe hardening and partial-secured marking {#phase-07-vibe-enforce}

**Recommended model:** claude-opus-4-8
**Recommended effort:** medium

Harden Vibe as far as its provider-native controls allow (workdir, restricted
additional directories, restricted tools/agent, MCP allowlisting) and make its
weaker isolation explicit as **partially secured** (criteria 15–16). PHAX must not
pretend Vibe matches Claude/Codex.

### Detailed instructions

- Rework `buildVibeArgs` in `src/infra/providers/mistralVibe.ts` to read
  `options.security` and branch on `mode`:
  - **unsafe**: today's vector (`--agent auto-approve --trust --workdir <cwd>`).
  - **secure**: constrain to `--workdir <worktree>`, add `--add-dir` only for the
    `~/.phax` write path when present, restrict tools to the minimum required
    (and/or a PHAX-specific restricted agent rather than blanket
    `auto-approve`), and apply MCP per `security.mcp` — using the real `vibe`
    surface confirmed in runbook `04b`. Do not emit a blanket `--trust` for the
    whole host when it can be scoped.
  - Because Vibe's filesystem/network jail is weaker, secure mode here is
    **partial**, not fail-closed on the (unsupported) network controls: the
    weakness is surfaced (the `partial-filesystem` / `network-unenforced` marks
    and `VIBE_PARTIAL_SECURED_MESSAGE` from phase-02), and strict callers skip
    Vibe via the phase-03 fallback. Keep the existing `VIBE_ACTIVE_MODEL` env
    injection.
- Update `tests/unit/providers/mistralVibe.test.ts` to assert the secure vector
  (`--workdir` = worktree, restricted tools/agent, no blanket `--trust` where
  scoped, MCP handled) and that the unsafe vector is unchanged.

### Planned files to create

- (none)

### Planned files to edit

- `src/infra/providers/mistralVibe.ts`
- `tests/unit/providers/mistralVibe.test.ts`

### Optional files that may be edited

- `src/app/vibeSetup.ts`

### Boundary contracts

Adapter → CLI: secure `buildVibeArgs` must emit a vector the installed `vibe`
accepts non-interactively while scoping the workdir/tools (verified in `04b`).
Adapter → domain: Vibe is marked partially secured (phase-02 evaluation), which
the report and fallback consume.

### Test strategy

Adapter layer → unit tests over the pure `buildVibeArgs` for both modes. Live
behavior and the exact tool-restriction surface are runbook `04b`. Keep the
unsafe-parity assertion.

### Implementation order

Branch `buildVibeArgs` on mode → secure workdir/add-dir/tools/MCP →
partial-secured wiring (reuse phase-02 marks/message) → tests.

### Excluded scope

- Claude and Codex adapters (phases 05–06).
- Live validation (runbook `04b`).
- The future external-sandbox mode.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact secure `vibe` vector (workdir, add-dir, tool/agent restriction, MCP)
  and the unsafe vector, and how the partial-secured marking is surfaced.
- Open items for runbook `04b`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(vibe): harden provider-native restrictions and mark partially secured

### Commit body

Map the resolved SecurityPolicy onto vibe flags in secure mode (scoped --workdir,
--add-dir only for ~/.phax, restricted tools/agent instead of blanket
auto-approve, MCP allowlisting) while keeping the unsafe vector unchanged. Surface
Vibe's weaker isolation as partially secured via the phase-02 marks and message;
strict callers skip Vibe through the routing fallback. Unit-tested for both modes.

---

## phase-08 — Default secure, --security flag, unsafe warning, isolated stub, status command {#phase-08-cli-default}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Make `secure` the default, expose `--security <secure|unsafe|isolated>` on
`phax run`, print the unsafe warning, stub `isolated`, and add `phax security
status` (criteria 1–5, 14, 21). After this phase secure mode is reachable and
default.

### Detailed instructions

- In `src/schemas/securityConfig.ts`: flip `DEFAULT_SECURITY_PROFILE` from
  `"unsafe"` to `"secure"`. Update `tests/unit/loadConfig.test.ts` /
  `tests/unit/security/*` expectations and add
  `tests/unit/security/defaultProfile.test.ts` asserting the default is `secure`.
- In `src/cli/main.ts`: add `--security <mode>` to the `run` command
  (`secure|unsafe|isolated`) and pass it through `globalTraceOpts`-style merge to
  `runRun`. Register a new top-level `security` command group with a `status`
  subcommand.
- In `src/cli/commands/run.ts` (`RunCommandOptions` + `runRun`):
  - Resolve the effective mode: `--security` overrides `config.security.profile`.
    Validate against the three literals (exit 2 on invalid).
  - `isolated` → print "external sandbox mode is planned but not available yet"
    and exit non-zero (do not start a run).
  - `unsafe` → print the spec §12 warning block before running.
  - Pass the effective mode into `executePlan` (extend `ExecutePlanOptions` with
    `securityMode`, used by phase-04's per-phase resolution instead of reading the
    config profile directly).
- In `src/app/dryRun.ts`: include the resolved security mode in the dry-run report
  and its formatted output.
- Create `src/app/securityStatus.ts`: combine `probeProviders` with
  `PROVIDER_SECURITY_CAPABILITIES` to produce the spec §14 report (per provider:
  filesystem jail, network allowlist, MCP allowlist, default-secure support).
- Create `src/cli/commands/security.ts`: `runSecurityStatus(out)` +
  `registerSecurityCommand(program, out)` rendering that report.
- Update `tests/unit/runArgv.test.ts` for `--security` parsing (incl. invalid +
  isolated) and `tests/unit/dryRun.test.ts` for the mode line.

### Planned files to create

- `src/app/securityStatus.ts`
- `src/cli/commands/security.ts`
- `tests/unit/security/defaultProfile.test.ts`

### Planned files to edit

- `src/schemas/securityConfig.ts`
- `src/cli/main.ts`
- `src/cli/commands/run.ts`
- `src/app/executePlan.ts`
- `src/app/dryRun.ts`
- `tests/unit/runArgv.test.ts`
- `tests/unit/dryRun.test.ts`
- `tests/unit/loadConfig.test.ts`

### Optional files that may be edited

- `examples/*/phax.json`
- `README.md`
- `tests/unit/security/resolvePolicy.test.ts`

### Boundary contracts

CLI/surface → application: `runRun` resolves the effective `SecurityMode`
(flag over config) and hands it to `executePlan` as `securityMode`. `security
status` (page/CLI) → application `securityStatus` (probe + capabilities) →
domain `PROVIDER_SECURITY_CAPABILITIES`.

### Test strategy

CLI/E2E smoke + unit: argv parsing for `--security` (valid/invalid/isolated) and
the dry-run mode line are unit-tested; the default-profile constant has a
dedicated unit test. The unsafe-warning text and isolated message are asserted via
the CLI command tests / output port.

### Implementation order

Flip the default constant → `executePlan` `securityMode` param → `run.ts`
flag/validation/warning/isolated → `dryRun.ts` → `securityStatus.ts` +
`security.ts` command → register in `main.ts` → tests.

### Excluded scope

- Persisting posture / telemetry / final report (phase-09).
- The external-sandbox implementation (future).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- That `DEFAULT_SECURITY_PROFILE` is now `secure`, the `--security` flag wiring,
  the exact unsafe warning + isolated message strings, and the `securityMode`
  param added to `ExecutePlanOptions`.
- The `phax security status` output format and how it is registered.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): default to secure mode with --security flag and status command

### Commit body

Flip the default security profile to secure, add `phax run --security
secure|unsafe|isolated` (flag over config), print the host-unrestricted warning,
stub isolated as not-yet-available, and surface the resolved mode in the dry-run
report. Add `phax security status` reporting per-provider jail/network/MCP
capabilities from live probes. Secure mode is now reachable and default.

---

## phase-09 — Security posture artifact, telemetry, and final report {#phase-09-posture-report}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Make the applied security posture durable and visible: a per-phase `security.json`
artifact, a `security.policy.applied` semantic event (verbose + trace), and a
**Security** section in `final-report.md` recording mode, applied filesystem/
network/MCP policy, whether the sandbox was enabled, any provider skipped for
security, and any downgrade (criteria 19–20).

### Detailed instructions

- Create `src/schemas/securityPosture.ts`: `SecurityPostureSchema`
  (`version: 1`) with **all required** fields — `mode`, `provider`, `sandboxEnabled`,
  `filesystem { allowRead, allowWrite }`, `network { profile, allowDomains }`,
  `mcp { mode, allow }`, `downgraded`, `marks`, `providerSkippedForSecurity` (array
  of `{ provider, reason }`, possibly empty). No optional fields. Provide
  `decodeSecurityPosture` / `encodeSecurityPosture`.
- In `src/domain/telemetry/events.ts` + `src/schemas/telemetryEvents.ts`: add
  `SecurityPolicyAppliedTelemetryEvent` (`security.policy.applied`) with `runId`,
  `operationId`, `mode`, `provider`, `sandboxEnabled`, `networkProfile`,
  `mcpMode`, `downgraded`, `skippedForSecurity` — added to the union, the maker,
  and the Effect schema union (keep both in lockstep, matching the existing
  events).
- In `src/app/executePlan.ts`: after writing `model-resolution.json`, write
  `<phaseFolder>/security.json` (encoded `SecurityPosture` built from the resolved
  policy + `evaluateProviderSecurity` + `resolution.skippedForSecurity`) and emit
  the `security.policy.applied` event.
- In `src/app/finalReport.ts`: read each `<runPath>/<phaseId>/security.json`
  (via `FileSystem`, tolerate missing) and render a **Security** section: the run
  security mode, a per-phase row (provider, sandbox enabled, network profile, MCP
  mode, downgraded?), and any providers skipped for security.
- Update telemetry unit tests and, if they shift, the e2e/integration semantic
  trace and final-review snapshots. Add `docs/security.md` documenting the modes,
  the default policy, the `security` config block, and `phax security status`;
  link it from `README.md`.

### Planned files to create

- `src/schemas/securityPosture.ts`
- `tests/unit/security/posture.test.ts`
- `docs/security.md`

### Planned files to edit

- `src/domain/telemetry/events.ts`
- `src/schemas/telemetryEvents.ts`
- `src/app/executePlan.ts`
- `src/app/finalReport.ts`
- `README.md`

### Optional files that may be edited

- `tests/e2e/__snapshots__/semanticTrace.test.ts.snap`
- `tests/e2e/semanticTrace.test.ts`
- `tests/integration/telemetry/__snapshots__/end-to-end.test.ts.snap`
- `tests/integration/finalReview.test.ts`
- `tests/integration/__snapshots__/finalReview.test.ts.snap`
- `tests/unit/telemetry/events.test.ts`

### Boundary contracts

Producer `executePlan` writes the `SecurityPosture` artifact and emits the
semantic event; consumers are `finalReport` (reads the per-phase artifacts) and
the telemetry sinks (verbose stdout + JSONL trace). The artifact schema is the
durable contract — all fields required, mirroring `run-status`/`status` discipline.

### Test strategy

Schema → unit test for `SecurityPosture` round-trip (all-required enforced).
Telemetry → unit test for the new event maker/schema. Report/trace → integration
+ e2e snapshot updates. Write the posture-schema test **before** implementation
(stable persisted contract).

### Implementation order

`securityPosture.ts` (+ test) → telemetry event (domain + schema) →
`executePlan` artifact write + event → `finalReport` section → docs + snapshot
updates.

### Excluded scope

- Any change to provider enforcement, routing, or the default (phases 01–08).
- The future external-sandbox mode.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `SecurityPosture` schema (all required), the `security.policy.applied`
  event fields, the `<phase>/security.json` write location, and the final-report
  Security section format.
- Which snapshots were regenerated and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): record applied posture in artifact, trace, and final report

### Commit body

Persist a per-phase security.json posture artifact (all-required schema), emit a
security.policy.applied semantic event for verbose output and trace logs, and add
a Security section to final-report.md recording mode, applied filesystem/network/
MCP policy, sandbox-enabled, downgrades, and providers skipped for security. Adds
docs/security.md.
```
