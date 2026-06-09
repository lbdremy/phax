# Implementation plan — Enabled-gated routing + spec §12 default table (Option A)

> Follow-up to `docs/plans/model-routing-plan.md`. Implements "Option A":
> resolution honours each provider's `enabled` flag, and the built-in default
> routing table becomes the spec's §12 multi-provider table while staying
> non-breaking because the non-Claude providers ship `enabled: false`.
> Format matches the phax-planning skill so `phax extract-plan` can consume this
> file. Each phase carries an HTML anchor (`{#phase-NN-...}`) for the
> `planMarkdownAnchor` field.

---

## Context

The routing layer added in `docs/plans/model-routing-plan.md` resolves a
requested model id to a concrete provider/model through a pure function,
`resolveModel` (`src/domain/routing/resolve.ts`). Today that function selects
the first provider in `routing.providerPriority` that has a tier entry and a
concrete model in `providerConfig`. **It never reads
`providerConfig.providers[provider].enabled`.** The `enabled` flag is consumed
only by the `phax agent` CLI display and the `providerSetup.ts` reconciliation
builder — never by resolution or dispatch.

Because of that, the built-in `DEFAULT_MODEL_ROUTING`
(`src/domain/routing/defaults.ts`) is forced to ship
`providerPriority: ["claude-code"]` and `allowDowngrade: false` to stay
non-breaking. If it shipped the spec's §12 table
(`providerPriority: ["mistral-vibe", "codex-cli", "claude-code"]`), a clean
install with no `~/.phax/model-routing.json` would resolve standard-tier phases
to `mistral-vibe` — its aliases already exist in `DEFAULT_PROVIDER_CONFIG` — and
the dispatcher would try to spawn `vibe`, breaking the "additive and
non-breaking" invariant. The `enabled: false` flag would not stop it.

This plan closes that gap (Option A from the design discussion):

1. **Gate resolution on `enabled`.** `resolveModel` skips any provider in the
   priority walk whose `providerConfig` entry is not `enabled`. `claude-code`
   remains the guaranteed terminal provider regardless of its flag, so
   `resolveModel` stays a total function and the "no silent Opus downgrade →
   claude-code/claude-opus" fall-through is preserved.
2. **Adopt the §12 table as the default.** With the gate in place, the default
   routing table can be the rich §12 multi-provider table. On a clean install
   `mistral-vibe`/`codex-cli` are `enabled: false` in `DEFAULT_PROVIDER_CONFIG`,
   so they are skipped and every phase resolves to `claude-code` exactly as
   today. Enabling them via `phax agent setup providers` then activates the
   richer table with no config edit.
3. **Sync the docs and plan wording** to describe the new default and the
   enabled gate (and stop claiming the previous default was the "exact §12
   object").

The change is small but load-bearing: the §12 default table is only safe
_because_ of the enabled gate, so phase-01 must land before phase-02. Several
existing tests encode the current no-`enabled` behaviour and must be updated in
the same commit that introduces the gate.

## Architecture target

```txt
src/domain/routing/resolve.ts   ← skip providers whose providerConfig entry is not enabled
                                  (priority walk only; terminal claude-code stays unconditional).
src/domain/routing/defaults.ts  ← DEFAULT_MODEL_ROUTING := spec §12 table
                                  (+ preserved requestedModelNormalization);
                                  DEFAULT_PROVIDER_CONFIG unchanged
                                  (claude-code enabled, mistral-vibe/codex-cli disabled).
tests/unit/routing/resolve.test.ts        ← §15 examples run against an all-enabled
                                             provider config; add a disabled-skip case.
tests/integration/routing.test.ts         ← enable mistral-vibe in the passed providerConfig.
docs/model-routing.md, README.md, .skills/model-routing.md ← default table + enabled gate.
docs/plans/model-routing-plan.md           ← correct the "exact §12 object" wording.
```

## Cross-phase invariants (apply to every phase)

- **Domain stays pure.** `resolve.ts` and `defaults.ts` remain free of Effect,
  IO, provider CLIs, `@opentelemetry/*`, and infra imports. `resolveModel` stays
  a total pure function over `(request, routing, providerConfig)`.
- **`resolveModel` stays total.** The enabled gate applies only to the
  `providerPriority` walk. The terminal `claude-code` block
  (`resolve.ts` lines ~204–267) remains unconditional so a resolution is always
  returned; `claude-code` is the guaranteed always-available baseline and its
  `enabled` flag does not remove that guarantee.
- **No silent Opus downgrade.** The existing `claude-opus` + `allowDowngrade:
false` skip of `downgrade`/`no_equivalent` candidates is unchanged; combined
  with the enabled gate it still falls through to `claude-code`/`claude-opus`.
- **Additive and non-breaking.** A clean install (no `~/.phax/model-routing.json`,
  no `~/.phax/providers.json`) must resolve every phase to `claude-code`, byte
  for byte as before this plan. `extract-plan`, `run.backend`, and
  `agent.backend` keep `"claude-code-cli"`.
- **External config crosses a schema boundary.** No schema changes are needed;
  `ProviderConfigSchema` already carries `enabled: Schema.Boolean`. Do not add
  new optional-for-legacy fields.
- **No new `any`** in `domain/` or `app/`.
- After every phase the commit must pass the `full` gate profile from
  `phax.json`: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`,
  `pnpm test`, `pnpm audit:architecture`, `pnpm build`.

---

## Model & effort summary

| #   | Phase                                       | Model             | Effort |
| --- | ------------------------------------------- | ----------------- | ------ |
| 01  | Gate resolution on provider `enabled`       | claude-sonnet-4-6 | medium |
| 02  | Adopt spec §12 routing table as the default | claude-sonnet-4-6 | medium |
| 03  | Sync docs and plan wording                  | claude-sonnet-4-6 | low    |

---

## phase-01 — Gate resolution on provider `enabled` {#phase-01-enabled-gate}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Make `resolveModel` honour each provider's `enabled` flag during the
`providerPriority` walk, so a disabled provider is never selected even when the
routing table lists it first and its concrete model/alias exists. Keep the
function total by leaving the terminal `claude-code` fallback unconditional.
Update the existing tests that encode the current no-`enabled` behaviour.

### Detailed instructions

- In `src/domain/routing/resolve.ts`, inside the
  `for (const provider of routing.providerPriority)` loop, after looking up
  `const entry = tierEntries?.[provider]` and the `if (!entry) continue;` guard,
  add an enabled check **before** computing `relationship` / `resolveConcrete`:
  - `const providerEntry = providerCfg.providers[provider];`
  - `if (!providerEntry?.enabled) continue;`
  - This skips both providers absent from `providerConfig` and providers present
    but `enabled: false`. Place it so a disabled provider never even reaches the
    Opus-downgrade gate or `resolveConcrete`.
- **Do not** add an `enabled` check to the terminal `claude-code` blocks
  (the `tierEntries?.["claude-code"]` block, the direct
  `providerCfg.providers["claude-code"]?.families?.[requestedFamily]` block, and
  the final sonnet fallback). `claude-code` is the guaranteed baseline and these
  paths must keep returning a resolution so `resolveModel` stays total. Add a
  short code comment at the start of the terminal section noting that the
  enabled gate intentionally applies only to the priority walk.
- Do not change `resolveConcrete`, `classifyRelationship`, `resolveTier`,
  `resolveFamily`, or any types. No schema changes (`ProviderConfigSchema`
  already has `enabled`). No `app/` or `infra/` changes in this phase.
- Update `tests/unit/routing/resolve.test.ts`:
  - Add a fixture `const allEnabledProviderConfig: ProviderConfig` derived from
    `DEFAULT_PROVIDER_CONFIG` with `mistral-vibe` and `codex-cli` set to
    `enabled: true` (spread each provider entry, override `enabled`). The §15
    example tests are demonstrating routing _behaviour_, so they must run against
    enabled providers.
  - Switch the provider-config argument in the §15 example tests that select a
    non-Claude provider — **Example 1** (mistral-vibe), **Example 2**
    (codex-cli), **Example 3** (codex-cli fallback), **Example 4a** (codex-cli
    downgrade) — and the **"emits a reason string …"** test from
    `DEFAULT_PROVIDER_CONFIG` to `allEnabledProviderConfig`. Their expected
    provider/family/thinking/concreteModel/relationship assertions are unchanged.
  - **Example 4b** (opus/high, `allowDowngrade: false` → claude-code/claude-opus)
    is unaffected and may stay on `DEFAULT_PROVIDER_CONFIG`.
  - Update the existing **"skips a Vibe candidate when the alias is missing"**
    test so its `mistral-vibe` entry is `enabled: true` (otherwise it would now
    be skipped for being disabled rather than for the missing alias, defeating
    the test's intent). It must still assert the selected provider is not
    `mistral-vibe`.
  - Add a new test **"skips a disabled provider even when its concrete model
    exists"**: resolve `{ model: "claude-sonnet-4-6", effort: "medium" }` with
    `mistralPriority` and the unmodified `DEFAULT_PROVIDER_CONFIG`
    (`mistral-vibe` disabled, alias present). Assert
    `result.selected.provider === "claude-code"` and family `claude-sonnet`,
    proving the gate skips a disabled-but-resolvable provider.
- Update `tests/integration/routing.test.ts`: the test passes
  `providerConfig: DEFAULT_PROVIDER_CONFIG` while expecting `mistral-vibe` to be
  selected. Replace that argument with an inline provider config equal to
  `DEFAULT_PROVIDER_CONFIG` but with `mistral-vibe` `enabled: true` (spread the
  provider entry, override `enabled`). All other assertions stay the same.

### Included scope

- `src/domain/routing/resolve.ts` (enabled gate in the priority walk + comment).
- `tests/unit/routing/resolve.test.ts` (all-enabled fixture, §15 example fixes,
  alias-test fix, new disabled-skip test).
- `tests/integration/routing.test.ts` (enable mistral-vibe in the passed config).

### Excluded scope

- No change to `DEFAULT_MODEL_ROUTING` / `DEFAULT_PROVIDER_CONFIG` (phase-02).
- No change to the terminal `claude-code` fallback behaviour.
- No schema, loader, dispatcher, CLI, or docs changes.

### Expected handoff content

- The exact location and form of the enabled check in `resolve.ts` and
  confirmation the terminal `claude-code` block was left unconditional.
- The name of the new all-enabled provider-config fixture in `resolve.test.ts`
  so phase-02 can reuse the pattern.
- Confirmation that `pnpm test`, `pnpm typecheck`, and `pnpm audit:architecture`
  pass (domain purity preserved).

### Commit subject

feat(routing): skip disabled providers during resolution

### Commit body

resolveModel now skips any provider in providerPriority whose providers.json
entry is not enabled, so a disabled provider is never selected even when the
routing table lists it first and its alias/model exists. The terminal
claude-code fallback stays unconditional so resolveModel remains total and the
no-silent-Opus-downgrade fall-through is preserved. Updates the §15 example and
integration tests to run against enabled providers and adds a disabled-skip
case. No schema or default-table changes.

---

## phase-02 — Adopt spec §12 routing table as the default {#phase-02-spec12-default}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

### Objective

Replace the Claude-only `DEFAULT_MODEL_ROUTING` with the spec's §12
multi-provider table (preserving `requestedModelNormalization`), relying on the
phase-01 enabled gate to keep clean installs Claude-only. Prove the
non-breaking default with a test.

### Detailed instructions

- In `src/domain/routing/defaults.ts`, set `DEFAULT_MODEL_ROUTING` to the §12
  table below. Keep `version`, the existing `requestedModelNormalization` block
  verbatim (the spec §12 example omits it but the schema requires it and
  resolution consumes it), and the typed `ModelRouting` annotation.

  ```ts
  version: 1,
  providerPriority: ["mistral-vibe", "codex-cli", "claude-code"],
  allowDowngrade: true,
  defaultTier: "standard",
  families: {
    claude: ["claude-haiku", "claude-sonnet", "claude-opus"],
    mistral: ["mistral-medium"],
    openai: ["openai-chatgpt"],
  },
  tiers: {
    cheap: {
      "claude-code": { family: "claude-haiku" },
      "mistral-vibe": { family: "mistral-medium", thinking: "off" },
      "codex-cli": { family: "openai-chatgpt", thinking: "low" },
    },
    fast: {
      "claude-code": { family: "claude-haiku" },
      "mistral-vibe": { family: "mistral-medium", thinking: "low" },
      "codex-cli": { family: "openai-chatgpt", thinking: "low" },
    },
    standard: {
      "claude-code": { family: "claude-sonnet", effort: "medium" },
      "mistral-vibe": { family: "mistral-medium", thinking: "medium" },
      "codex-cli": { family: "openai-chatgpt", thinking: "low" },
    },
    strong: {
      "claude-code": { family: "claude-sonnet", effort: "high" },
      "mistral-vibe": { family: "mistral-medium", thinking: "high" },
      "codex-cli": { family: "openai-chatgpt", thinking: "medium" },
    },
    very_strong: {
      "claude-code": { family: "claude-sonnet", effort: "xhigh" },
      "mistral-vibe": { family: "mistral-medium", thinking: "max" },
      "codex-cli": { family: "openai-chatgpt", thinking: "high" },
    },
    frontier: {
      "claude-code": { family: "claude-opus", effort: "medium" },
      "codex-cli": { family: "openai-chatgpt", thinking: "xhigh", relationship: "fallback" },
    },
    max: {
      "claude-code": { family: "claude-opus", effort: "max" },
      "codex-cli": { family: "openai-chatgpt", thinking: "xhigh", relationship: "downgrade" },
    },
  },
  normalization: {
    "claude-haiku": { defaultTier: "cheap" },
    "claude-sonnet": { low: "fast", medium: "standard", high: "strong", xhigh: "very_strong", max: "very_strong" },
    "claude-opus": { low: "frontier", medium: "frontier", high: "max", xhigh: "max", max: "max" },
    "mistral-medium": { off: "cheap", low: "fast", medium: "standard", high: "strong", max: "very_strong" },
    "openai-chatgpt": { low: "standard", medium: "strong", high: "very_strong", xhigh: "frontier" },
  },
  // requestedModelNormalization: keep the existing block unchanged.
  ```

- **Leave `DEFAULT_PROVIDER_CONFIG` exactly as-is**: `claude-code`
  `enabled: true`; `mistral-vibe` and `codex-cli` `enabled: false`. This is what
  makes the rich default safe — the gate from phase-01 skips the disabled
  providers on a clean install.
- Note for the executing agent: `routing.families` is **not read by
  `resolveModel`** (verify with a search — it is unused in `resolve.ts`), so the
  vendor-keyed §12 form has no resolution impact; it is metadata only.
- Be deliberate about the normalization deltas versus the previous default,
  since they change tier outcomes for some inputs:
  - `claude-sonnet` loses the `off` key and `max` maps to `very_strong`
    (previously `frontier`).
  - `claude-opus` `low` maps to `frontier` (previously `strong`).
  - `mistral-medium` / `openai-chatgpt` gain per-effort maps (previously
    `{ defaultTier: "standard" }`).
    Confirm no existing test asserts the old outcomes for these inputs; the
    documented §15 examples (opus/medium→frontier, opus/high→max,
    sonnet/medium→standard, sonnet/high→strong) are unchanged by §12.
- Add a unit test to `tests/unit/routing/resolve.test.ts`,
  **"clean-install default resolves every phase to claude-code"**: call
  `resolveModel({ model: "claude-sonnet-4-6", effort: "medium" }, DEFAULT_MODEL_ROUTING, DEFAULT_PROVIDER_CONFIG)`
  (both unmodified defaults) and assert `result.selected.provider === "claude-code"`,
  family `claude-sonnet`, `relationship === "exact"`. This pins the non-breaking
  invariant against the new default `providerPriority`.
- Run the full suite and reconcile any incidental breakage in
  `tests/unit/routing/loadRouting.test.ts`, `tests/unit/routing/schemas.test.ts`,
  and `tests/integration/routing.test.ts` caused by the new default values
  (e.g. any assertion that hard-codes `providerPriority`, `allowDowngrade`, or a
  normalization outcome). Fixtures that build on `{ ...DEFAULT_MODEL_ROUTING,
providerPriority: [...] }` continue to work and should not be rewritten.

### Included scope

- `src/domain/routing/defaults.ts` (`DEFAULT_MODEL_ROUTING` only).
- `tests/unit/routing/resolve.test.ts` (new clean-install default test) and any
  minimal reconciliation in `loadRouting.test.ts` / `schemas.test.ts` /
  `integration/routing.test.ts`.

### Excluded scope

- No change to `DEFAULT_PROVIDER_CONFIG` or any `enabled` flag.
- No change to `resolveModel` (phase-01 already added the gate).
- No docs changes (phase-03).

### Expected handoff content

- Confirmation `DEFAULT_PROVIDER_CONFIG` was left unchanged and the new default
  `providerPriority` is `["mistral-vibe", "codex-cli", "claude-code"]` with
  `allowDowngrade: true`.
- The result of the clean-install default test (must select `claude-code`).
- A list of any test fixtures that needed reconciliation, for phase-03's doc
  examples to match.

### Commit subject

feat(routing): default to the spec §12 multi-provider routing table

### Commit body

DEFAULT_MODEL_ROUTING is now the spec §12 multi-provider table
(providerPriority mistral-vibe, codex-cli, claude-code; allowDowngrade true;
per-effort normalization for every family). DEFAULT_PROVIDER_CONFIG is
unchanged, so on a clean install the disabled mistral-vibe/codex-cli providers
are skipped by the enabled gate and every phase resolves to claude-code exactly
as before. Enabling them via providers.json activates the richer table with no
routing edit. Adds a clean-install default test pinning the non-breaking
behaviour.

---

## phase-03 — Sync docs and plan wording {#phase-03-docs-sync}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

### Objective

Bring the prose in step with the new behaviour: document the §12 default table,
the enabled gate as the mechanism that keeps clean installs Claude-only, and
correct the original plan's claim that the previous default was the "exact §12
object".

### Detailed instructions

- `docs/model-routing.md`:
  - Update the "Default routing table" section (around line 37–45) to state that
    `DEFAULT_MODEL_ROUTING` is the §12 multi-provider table
    (`providerPriority: ["mistral-vibe", "codex-cli", "claude-code"]`,
    `allowDowngrade: true`), and that it is **non-breaking because
    `mistral-vibe` and `codex-cli` ship `enabled: false`** in the default
    `providers.json`; the enabled gate skips them until the user enables them
    (e.g. via `phax agent setup providers`).
  - Ensure the "Tier + priority → provider" step (around line 93) and the
    "To disable a provider" note (around line 145) both state that resolution
    **skips providers whose `providers.json` entry is `enabled: false`** — the
    walk now enforces this, it is no longer only advisory.
- `README.md`: update the routing paragraph (around line 135) that currently
  says the default `providerPriority` is `["claude-code"]`. Replace it with the
  §12 default + the "non-Claude providers ship disabled, so phases still run
  through Claude Code until you enable a provider" framing.
- `.skills/model-routing.md`: update any statement about the default
  `providerPriority`/`allowDowngrade` and add the enabled gate to the resolution
  walk description (the numbered steps around lines 52–54) and to the
  "No silent Opus downgrade" note if it implies claude-only defaults.
- `docs/plans/model-routing-plan.md`: correct the phase-02 detailed instructions
  (around lines 259 and 264) and any other spot that says the default tables are
  "the exact §12 object". Replace with a note that the **shipped** default was a
  Claude-only, downgrade-disabled table for non-breaking safety, and that the
  §12 multi-provider table became the default once the enabled gate landed
  (cross-reference this plan, `model-routing-enabled-gating-plan.md`). Do not
  rewrite the historical phases beyond fixing the inaccurate wording.

### Included scope

- `docs/model-routing.md`, `README.md`, `.skills/model-routing.md`,
  `docs/plans/model-routing-plan.md` (wording only).

### Excluded scope

- No code or test changes. No new schema fields.

### Expected handoff content

- The list of doc files touched and a one-line summary of each correction.
- Confirmation that `pnpm format:check` and `pnpm lint` still pass (Markdown/
  prose only, but the `full` gate must stay green).

### Commit subject

docs: describe §12 default table and the enabled-gated routing walk

### Commit body

Update docs/model-routing.md, README.md, and .skills/model-routing.md to
describe the new §12 multi-provider default routing table and the enabled gate
that keeps clean installs routing through Claude Code (mistral-vibe/codex-cli
ship enabled: false). Correct docs/plans/model-routing-plan.md where it claimed
the original shipped default was the "exact §12 object"; the §12 table became
the default only once resolution honoured the enabled flag.
