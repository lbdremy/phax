# Implementation plan — Provider-specific effort/thinking enums and routing corrections

> Run short name: `update-provider-effort`.
> Deliverable location: `docs/plans/03-update-provider-effort-plan.md`.
> Format: matches `.skills/phax-planning.md` so `phax extract-plan` can consume
> this file. Each phase carries a `{#phase-NN-...}` anchor for the
> `planMarkdownAnchor` field and declares its planned files.
> Scope note: the **real end-to-end provider validation** (Claude Code, Codex
> CLI, Mistral Vibe) is intentionally **not** a phase here. It lives in
> `docs/plans/03b-provider-e2e-validation.md` and is run **manually**, not via
> the phax CLI. This plan delivers the code + unit-test changes that the manual
> runbook then validates against the real CLIs.

---

## Context

This plan implements `docs/specs/03-update-provider-effort.md`. Four workstreams:

1. **Family rename** `openai-chatgpt` → `openai-gpt` (the model family; ChatGPT
   is the product, GPT is the family).
2. **Provider-specific effort enums** — replace the single flat
   `ThinkingLevel = off|low|medium|high|xhigh|max` with **per-family effort
   enums as the source of truth**, plus a derived superset and a capability map.
3. **Corrected routing rules** — fix real bugs: `claude-sonnet / low` currently
   resolves to **Haiku** (the `fast` tier pins `claude-code → claude-haiku`),
   which spec criterion 8 forbids. Enforce same-family preservation and add the
   `ultracode` level (Opus-only, no default cross-provider equivalent).
4. **Planning skill + routing docs** — expose the full per-family model/effort
   matrix and update the routing documentation.

### What exists today (anchors)

- `src/domain/routing/types.ts` — `ModelFamily` (`openai-chatgpt` literal),
  `ThinkingLevel` (flat union), `RoutingTier`, `Relationship`, `RoutingRequest`,
  `RoutingResolution`.
- `src/schemas/modelRouting.ts` — `ModelFamilySchema`, `ThinkingLevelSchema`,
  `RoutingTierSchema`, `PerEffortNormalizationSchema`, plus the full
  `ModelRoutingSchema`. `tests/type/routing.ts` is a compile-time guard that the
  domain literal unions and these schema literals stay in sync **both ways** —
  any literal added to one side must be added to the other or typecheck fails.
- `src/domain/routing/defaults.ts` — `DEFAULT_MODEL_ROUTING` (families, tiers,
  normalization, requestedModelNormalization) and `DEFAULT_PROVIDER_CONFIG`.
  The `fast` tier's `claude-code` entry is `{ family: "claude-haiku" }`, and
  `normalization["claude-sonnet"].low = "fast"` — **this is the criterion-8
  bug**: `claude-sonnet / low` → tier `fast` → `claude-code/claude-haiku`.
- `src/domain/routing/resolve.ts` — `resolveModel` walks `providerPriority` over
  `tiers[tier]`, then falls back to `claude-code`. `resolveFamily` heuristics
  include `openai-chatgpt`.
- `src/schemas/phaxPlan.ts` — `EffortSchema = Literal("low","medium","high")`,
  backing both extraction and persistence. `src/schemas/status.ts` has its own
  `EffortSchema` union with the same three values.
- `src/infra/providers/codexCli.ts` / `mistralVibe.ts` — provider adapters; the
  codex adapter references `entry.families?.["openai-chatgpt"]`.
- `src/cli/commands/agent.ts` — `THINKING_LEVELS` validation list and the
  `--effort` option help string enumerate the flat thinking levels.
- `src/schemas/telemetryEvents.ts` / `src/domain/telemetry/events.ts` — the
  `agent.model.resolved` event types reference `ModelFamilySchema` /
  `ThinkingLevelSchema` and `ModelFamily` / `ThinkingLevel` (no literal `openai`
  string, so they follow the type change with no manual edit).

### Target effort model (decided)

Per-family enums are the source of truth; the superset is derived:

```ts
export type ClaudeHaikuEffort = "none";
export type ClaudeSonnetEffort = "low" | "medium" | "high" | "max";
export type ClaudeOpusEffort = "low" | "medium" | "high" | "xhigh" | "max" | "ultracode";
export type MistralMediumEffort = "off" | "low" | "medium" | "high" | "max";
export type OpenAiGptEffort = "low" | "medium" | "high" | "xhigh";

export type EffortLevel =
  | ClaudeHaikuEffort
  | ClaudeSonnetEffort
  | ClaudeOpusEffort
  | MistralMediumEffort
  | OpenAiGptEffort; // = none|off|low|medium|high|xhigh|max|ultracode

export const FAMILY_EFFORTS: Record<ModelFamily, readonly EffortLevel[]> = {
  "claude-haiku": ["none"],
  "claude-sonnet": ["low", "medium", "high", "max"],
  "claude-opus": ["low", "medium", "high", "xhigh", "max", "ultracode"],
  "mistral-medium": ["off", "low", "medium", "high", "max"],
  "openai-gpt": ["low", "medium", "high", "xhigh"],
};
```

`ThinkingLevel` is kept as an alias of `EffortLevel` to limit churn (the codebase
already imports `ThinkingLevel` widely). No back-compat alias for the old
`openai-chatgpt` family or for removed Sonnet `xhigh` — per the project rule,
the literals change hard.

---

## phase-01 — Per-family effort enums and openai-gpt rename {#phase-01-effort-enums}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Introduce per-family effort enums as the source of truth, derive the
`EffortLevel` superset and a `FAMILY_EFFORTS` capability map, and rename the
`openai-chatgpt` model family to `openai-gpt` everywhere in the same commit so
the project keeps compiling. Expand the plan/status effort schemas to the
superset so plans can later request the full per-family matrix.

### Detailed instructions

- In `src/domain/routing/types.ts`:
  - Rename the `openai-chatgpt` member of `ModelFamily` to `openai-gpt`.
  - Add the five per-family effort enum types exactly as listed in the Context
    "Target effort model" block.
  - Define `EffortLevel` as the union of the five enums and keep
    `export type ThinkingLevel = EffortLevel;` so existing imports continue to
    resolve. The superset is `none|off|low|medium|high|xhigh|max|ultracode`.
  - Add `export const FAMILY_EFFORTS: Record<ModelFamily, readonly EffortLevel[]>`
    and `export function isEffortSupported(family, effort): boolean`.
- In `src/schemas/modelRouting.ts`:
  - `ModelFamilySchema`: `openai-chatgpt` → `openai-gpt`.
  - `ThinkingLevelSchema`: add `"none"` and `"ultracode"` so it equals the
    superset (the `tests/type/routing.ts` guard forces this to match the type).
  - `PerEffortNormalizationSchema`: add optional `none` and `ultracode` keys so
    normalization maps can key on the new levels (the `ultra` tier wiring lands
    in phase-02, but the schema must already accept the keys).
- In `src/schemas/phaxPlan.ts`: expand `EffortSchema` to the full superset
  literal (`none|off|low|medium|high|xhigh|max|ultracode`). Existing
  low/medium/high plans stay valid. Per-family validity (e.g. rejecting
  `claude-haiku / high`) is enforced in the routing layer in phase-02, not by
  this flat literal.
- In `src/schemas/status.ts`: expand its `EffortSchema` union to the same
  superset so persisted phase status can record any resolved effort.
- Mechanical rename of the `openai-chatgpt` literal (no semantic routing change
  yet — that is phase-02):
  - `src/domain/routing/defaults.ts` — `families.openai`, the `tiers.*` entries,
    and the `normalization` key.
  - `src/domain/routing/resolve.ts` — the `resolveFamily` heuristic branch.
  - `src/infra/providers/codexCli.ts` — `entry.families?.["openai-gpt"]`.
- In `src/cli/commands/agent.ts`: update `THINKING_LEVELS` and the `--effort`
  option help string to the superset values.
- Update affected tests: `tests/unit/routing/schemas.test.ts`,
  `tests/unit/routing/resolve.test.ts`,
  `tests/unit/routing/providerSetup.test.ts`,
  `tests/unit/providers/codexCli.test.ts` — replace `openai-chatgpt` with
  `openai-gpt`. Add a new unit test for `FAMILY_EFFORTS` / `isEffortSupported`.

### Planned files to create

- `tests/unit/routing/effortLevels.test.ts`

### Planned files to edit

- `src/domain/routing/types.ts`
- `src/schemas/modelRouting.ts`
- `src/schemas/phaxPlan.ts`
- `src/schemas/status.ts`
- `src/domain/routing/defaults.ts`
- `src/domain/routing/resolve.ts`
- `src/infra/providers/codexCli.ts`
- `src/cli/commands/agent.ts`
- `tests/unit/routing/schemas.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `tests/unit/providers/codexCli.test.ts`

### Optional files that may be edited

- `tests/type/routing.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`

### Boundary contracts

Domain → schema: the literal unions in `types.ts` and the schema literals in
`modelRouting.ts` must stay in sync; `tests/type/routing.ts` is the contract
guard. Consumer (`agent.ts`, providers, telemetry) need the renamed family and
expanded effort set; producer (`types.ts`) provides them.

### Test strategy

Domain/schema layer → unit and type tests. Write the `FAMILY_EFFORTS` /
`isEffortSupported` unit test **before** implementation (stable capability
contract). Let the existing `tests/type/routing.ts` guard catch any
schema/type drift at typecheck.

### Implementation order

`types.ts` → `modelRouting.ts` → `phaxPlan.ts`/`status.ts` → rename call sites
(`defaults.ts`, `resolve.ts`, `codexCli.ts`, `agent.ts`) → tests.

### Excluded scope

- Any routing-semantics change (tier table, same-family preservation,
  `ultra` tier, `ultracode` handling) — that is phase-02.
- Provider invocation flag fixes — phases 03 and 04.
- Planning skill / docs content — phase-05.

### Verification

- The project's configured `full` gate profile in `phax.json` (typecheck, lint,
  format:check, knip, test, audit:architecture, build).

### Expected handoff content

- The exact new types in `src/domain/routing/types.ts`: the five per-family
  effort enums, `EffortLevel`, the `ThinkingLevel` alias, `FAMILY_EFFORTS`, and
  the `isEffortSupported` signature.
- Confirmation that `openai-gpt` fully replaces `openai-chatgpt` (no remaining
  references outside `docs/`, which phase-05 handles).
- Any deviation from the planned file lists, with the reason (e.g. an extra
  test file that asserted the old literal).

### Commit subject

feat(routing): add per-family effort enums and rename openai-gpt family

### Commit body

Replace the flat ThinkingLevel union with per-family effort enums
(claude-haiku/sonnet/opus, mistral-medium, openai-gpt) as the source of truth,
deriving the EffortLevel superset and a FAMILY_EFFORTS capability map with
isEffortSupported. Rename the openai-chatgpt model family to openai-gpt across
the domain, schemas, providers, and CLI in one commit, and expand the plan and
status effort schemas to the superset. No routing-semantics change yet.

---

## phase-02 — Same-family preservation, corrected table, ultracode {#phase-02-routing-rules}

**Recommended model:** claude-opus-4-7
**Recommended effort:** high

Correct the routing semantics so effort never changes model family within the
Claude reference scale, fix the `claude-sonnet / low → Haiku` bug, and add the
Opus-only `ultracode` level with no default cross-provider equivalent.

### Detailed instructions

- Add a top routing tier `ultra` to `RoutingTier` in `src/domain/routing/types.ts`
  and to `RoutingTierSchema` in `src/schemas/modelRouting.ts` (and update the
  exhaustiveness samples in `tests/type/routing.ts`). `ultra` carries only a
  `claude-code` entry — it is the declarative, user-overridable home for
  `claude-opus / ultracode` with no Mistral/OpenAI offering.
- Rework `DEFAULT_MODEL_ROUTING` in `src/domain/routing/defaults.ts` to match the
  spec's corrected equivalence table:
  - `normalization["claude-sonnet"]`: `low→fast, medium→standard, high→strong,
max→very_strong` (remove the `xhigh` entry — Sonnet has no `xhigh`).
  - `normalization["claude-opus"]`: `low→frontier, medium→frontier, high→max,
xhigh→max, max→max, ultracode→ultra`.
  - `normalization["openai-gpt"]`: `low→standard, medium→strong,
high→very_strong, xhigh→frontier` (renamed key).
  - `tiers.fast.claude-code`: change from `{ family: "claude-haiku" }` to
    `{ family: "claude-sonnet", effort: "low" }` so the Sonnet-low reference
    stays Sonnet (criterion 8) even on the terminal claude-code fallback.
  - `tiers.cheap` keeps `claude-code → claude-haiku` (Haiku's own home).
  - Cross-provider entries per the spec table (`standard`: mistral medium /
    openai medium; `strong`: mistral high / openai medium; `very_strong`:
    mistral max / openai high; `frontier`: openai xhigh `fallback`; `max`:
    openai xhigh `downgrade`; `ultra`: claude-code only).
  - `tiers.ultra.claude-code = { family: "claude-opus", effort: "ultracode" }`.
  - Bump `requestedModelNormalization` and `DEFAULT_PROVIDER_CONFIG` Opus model
    id `claude-opus-4-7` → `claude-opus-4-8`.
- In `src/domain/routing/resolve.ts`, add a **same-family preservation guard**
  so the invariant holds even if a user edits the table (criterion 12):
  - When the requested family is a Claude family and the selected provider is
    `claude-code`, force the resolved family to the requested Claude family and
    the effort to the requested effort clamped into that family's
    `FAMILY_EFFORTS` set. A `claude-opus` request on `claude-code` therefore
    never yields `claude-sonnet`, and `claude-sonnet / low` never yields
    `claude-haiku`.
  - Permit a cross-Claude-family downgrade only when `allowDowngrade` is true
    **and** the tier entry's `relationship` is an explicit `downgrade`.
  - Treat `claude-opus / ultracode` as having no Mistral/OpenAI equivalent
    (`no_equivalent`): it resolves through the `ultra` tier to
    `claude-opus / ultracode` and is never silently downgraded by default
    (criterion 10).
  - Effort clamping uses the `FAMILY_EFFORTS` ordering (nearest supported level)
    for any out-of-set request reaching the claude-code path.
- Extend `tests/unit/routing/resolve.test.ts` with explicit cases for
  criteria 8, 9, 10, plus same-family preservation under both `allowDowngrade`
  settings, and the new `ultra` tier resolution.

### Planned files to create

- `tests/unit/routing/sameFamilyPreservation.test.ts`

### Planned files to edit

- `src/domain/routing/types.ts`
- `src/schemas/modelRouting.ts`
- `src/domain/routing/defaults.ts`
- `src/domain/routing/resolve.ts`
- `tests/type/routing.ts`
- `tests/unit/routing/resolve.test.ts`

### Optional files that may be edited

- `tests/unit/routing/schemas.test.ts`
- `tests/unit/routing/loadRouting.test.ts`

### Boundary contracts

Producer `resolveModel` guarantees to consumers (`executePlan`, `agent resolve`)
that a Claude-family request resolved to `claude-code` preserves the family.
The `ultra` tier addition must round-trip through `ModelRoutingSchema` decode
and the `tests/type/routing.ts` exhaustiveness guard.

### Test strategy

Domain layer → unit tests, written **before** implementation for the four
acceptance criteria (8, 9, 10, and same-family preservation). These are stable
invariants and must be test-first.

### Implementation order

Add `ultra` tier (types + schema + type guard) → rework `defaults.ts` table →
add preservation guard + ultracode handling in `resolve.ts` → tests.

### Excluded scope

- Effort enum definitions and the family rename (phase-01).
- Provider invocation flags (phases 03–04).
- Documenting the new table for humans (phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final tier set including `ultra`, and the corrected
  `normalization`/`tiers` for each family.
- The exact preservation-guard rule in `resolve.ts` (when family is forced,
  when a cross-family downgrade is permitted, how effort is clamped).
- Confirmation that criteria 8/9/10 each have a dedicated passing test.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): preserve model family across effort and add ultracode tier

### Commit body

Rework DEFAULT_MODEL_ROUTING so claude-sonnet/low stays Sonnet and
claude-opus/low stays Opus, fixing the criterion-8/9 family-downgrade bugs. Add
an ultra tier for the Opus-only ultracode level with no default Mistral/OpenAI
equivalent, and add a same-family preservation guard in resolveModel that holds
even against user table edits. Bump the default Opus model id to claude-opus-4-8.

---

## phase-03 — Fix Codex CLI invocation and output parsing {#phase-03-codex-cli}

**Recommended model:** claude-opus-4-7
**Recommended effort:** medium

Make the Codex adapter invoke the real `codex` CLI correctly. The current build
targets a top-level `codex` invocation with flags that do not exist
(`--approval-mode`, `--print`, `--output-format`, `--verbose`,
`--reasoning-effort`), so clap rejects the args and the process exits with
**code 2**. The real non-interactive entry point is the `codex exec` subcommand.

### Detailed instructions

- Rewrite `buildCodexArgs` in `src/infra/providers/codexCli.ts` to produce a
  `codex exec` invocation:
  - Lead with the `exec` subcommand.
  - `--model <model>`, `--sandbox danger-full-access` (or
    `--dangerously-bypass-approvals-and-sandbox` for fully non-interactive
    automation), `--cd <cwd>`, and `--json` (JSONL events on stdout).
  - Reasoning effort is **not** a flag: pass `-c model_reasoning_effort="<level>"`.
    The resolved effort reaching this adapter is already an `openai-gpt` level
    (`low|medium|high|xhigh`). Map it to the value `codex` accepts and verify
    the accepted set against the installed CLI (`codex` config); fall back to
    `high` if `xhigh` is not accepted, and document the mapping.
  - Resume: emit `codex exec resume <session_id> [flags]` instead of a
    top-level `--resume`.
  - Keep passing the prompt on stdin (codex `exec` reads stdin when no prompt
    arg is given).
- Update `src/schemas/codexOutput.ts` to match the **real** `codex exec --json`
  event shapes. Capture a representative sample by running the real CLI once
  (e.g. `codex exec --json -c model_reasoning_effort="low" "print ok"`), commit
  a trimmed, secret-free sample as a fixture, and write the session-id /
  final-text extractor against it. Adjust `findCodexResultEvent` /
  `hasCodexErroredResultEvent` to the captured event types.
- Update `tests/unit/providers/codexCli.test.ts` to assert the new arg vector
  (run and resume forms) and to parse the committed fixture.

### Planned files to create

- `tests/unit/providers/fixtures/codex-exec-sample.jsonl`

### Planned files to edit

- `src/infra/providers/codexCli.ts`
- `src/schemas/codexOutput.ts`
- `tests/unit/providers/codexCli.test.ts`

### Optional files that may be edited

- `src/schemas/claudeOutput.ts`

### Boundary contracts

Adapter → CLI: `buildCodexArgs` must emit a vector the installed `codex` accepts
(exit 0 path). Adapter → domain: the output parser must return a non-empty
session id (`decodeClaudeSessionId` accepts any non-empty string) and final
text from the real event stream.

### Test strategy

Adapter layer → unit tests over `buildCodexArgs` (pure) and the output parser
against the committed fixture. The real CLI run that produced the fixture is a
manual capture step; the live end-to-end check is in
`docs/plans/03b-provider-e2e-validation.md`.

### Implementation order

`buildCodexArgs` → capture fixture → rewrite `codexOutput.ts` parser → tests.

### Excluded scope

- Mistral Vibe (phase-04).
- Running the live Codex E2E flow (manual runbook 03b).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `codex exec` arg vector for both run and resume, including the
  `-c model_reasoning_effort` mapping and which value is used for `xhigh`.
- The real event types observed in `codex exec --json` and how session id and
  final text are extracted.
- Note that the live exit-code-2 fix must be confirmed in runbook 03b.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(codex): invoke codex exec with correct flags and parse JSONL output

### Commit body

Rewrite buildCodexArgs to use the codex exec subcommand with --model,
--sandbox, --cd, --json, and -c model_reasoning_effort, and emit
`codex exec resume` for resumes. This fixes the clap exit-code-2 caused by the
old nonexistent top-level flags. Rewrite the codexOutput parser against a
captured real --json sample committed as a fixture.

---

## phase-04 — Fix Mistral Vibe invocation and output parsing {#phase-04-mistral-vibe}

**Recommended model:** claude-opus-4-7
**Recommended effort:** medium

Make the Vibe adapter invoke the real `vibe` CLI correctly. The current build
uses flags that do not exist (`--print`, `--output-format stream-json`,
`--verbose`) and never handles directory trust, so non-interactive runs fail or
block on the trust prompt.

### Detailed instructions

- Rewrite `buildVibeArgs` in `src/infra/providers/mistralVibe.ts` for the real
  `vibe` programmatic mode:
  - `-p` (programmatic mode), `--agent auto-approve`, `--output streaming`
    (newline-delimited JSON per message).
  - Directory trust: pass `--trust` (and/or `--workdir <cwd>`) so automation
    does not hang on the trust prompt. Confirm against the live CLI whether the
    prompt is the empirical cause of the current failure.
  - Resume: `--resume <session_id>`.
  - Decide and document prompt delivery (positional `PROMPT` vs stdin) based on
    what the real CLI accepts in `-p` mode; keep the chosen path consistent with
    `spawnVibe`.
  - Keep the `VIBE_ACTIVE_MODEL` env injection of the resolved alias
    (`phax-mistral-medium-3.5-<level>`) — the alias map in `defaults.ts` already
    covers `off|low|medium|high|max`.
- Update `src/schemas/vibeOutput.ts` to match the real `--output streaming`
  event shape. Capture a representative sample from a live run, commit a trimmed
  fixture, and rewrite `findVibeResultEvent` / `hasVibeErroredResultEvent`
  against it (session id and final text extraction).
- Update `tests/unit/providers/mistralVibe.test.ts` to assert the new arg vector
  (run and resume) and to parse the committed fixture.

### Planned files to create

- `tests/unit/providers/fixtures/vibe-streaming-sample.jsonl`

### Planned files to edit

- `src/infra/providers/mistralVibe.ts`
- `src/schemas/vibeOutput.ts`
- `tests/unit/providers/mistralVibe.test.ts`

### Optional files that may be edited

- `src/app/vibeSetup.ts`

### Boundary contracts

Adapter → CLI: `buildVibeArgs` plus `VIBE_ACTIVE_MODEL` must produce an
invocation the installed `vibe` accepts non-interactively (no trust prompt).
Adapter → domain: the parser returns a non-empty session id and final text from
the streaming event log.

### Test strategy

Adapter layer → unit tests over `buildVibeArgs` (pure) and the output parser
against the committed fixture. The live run is the manual runbook (03b).

### Implementation order

`buildVibeArgs` → capture fixture → rewrite `vibeOutput.ts` parser → tests.

### Excluded scope

- Codex (phase-03).
- Running the live Vibe E2E flow (manual runbook 03b).
- Changing the alias naming scheme.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `vibe` arg vector for run and resume, the trust handling chosen, and
  the prompt-delivery decision.
- The real streaming event shape and how session id / final text are extracted.
- The list of diagnosed failure causes (wrong args, trust, output parsing, …)
  to feed runbook 03b.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(vibe): use programmatic mode with trust handling and parse streaming output

### Commit body

Rewrite buildVibeArgs to use vibe -p programmatic mode with --agent
auto-approve, --output streaming, --trust, and --resume, fixing the nonexistent
--print/--output-format/--verbose flags and the missing directory-trust
handling. Rewrite the vibeOutput parser against a captured real streaming sample
committed as a fixture.

---

## phase-05 — Planning skill and routing documentation {#phase-05-skill-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Expose the full per-family model/effort matrix in the planning skill and bring
the routing documentation in line with `openai-gpt`, the per-family effort sets,
the `ultra` tier, and the same-family preservation rule.

### Detailed instructions

- Update `.skills/phax-planning.md`:
  - Model IDs: `claude-sonnet-4-6`, `claude-opus-4-8`,
    `claude-haiku-4-5-20251001` (bump Opus to 4.8).
  - Replace the `low | medium | high` effort note with the full per-family
    matrix from the spec's "Updated planning skill requirement" sample
    (Haiku → `none`; Sonnet → low/medium/high/max; Opus →
    low/medium/high/xhigh/max/ultracode; Mistral → off/low/medium/high/max;
    OpenAI GPT → low/medium/high/xhigh). Keep the guidance that plans prefer
    Claude-oriented naming because Claude is the routing reference scale.
- Update `.skills/model-routing.md` and `docs/model-routing.md`: rename
  `openai-chatgpt` → `openai-gpt`, document per-family effort sets, the new
  `ultra` tier, the corrected equivalence table, and the same-family
  preservation rule (effort never changes family).
- Update `tests/unit/skills.test.ts`: it asserts `claude-opus-4-7` and the
  effort values — change the expected Opus id to `claude-opus-4-8` and align the
  effort assertions with the per-family matrix.
- Align `tests/e2e/helpers/backends.ts` requested-model strings if needed so the
  manual E2E runbook drives the intended families.

### Planned files to create

- (none)

### Planned files to edit

- `.skills/phax-planning.md`
- `.skills/model-routing.md`
- `docs/model-routing.md`
- `tests/unit/skills.test.ts`

### Optional files that may be edited

- `tests/e2e/helpers/backends.ts`
- `README.md`

### Boundary contracts

Skill ↔ schema: the effort values the planning skill presents must be a subset
of the `phaxPlan.ts` `EffortSchema` superset from phase-01, so any plan the
skill teaches is extractable. `tests/unit/skills.test.ts` is the guard that the
skill content matches the supported ids/efforts.

### Test strategy

Docs/skill layer → the existing `skills.test.ts` assertions. Update them in the
same commit as the skill so the `full` gate stays green.

### Implementation order

`phax-planning.md` → routing docs → `skills.test.ts` → backends helper.

### Excluded scope

- Any code/schema behavior change (phases 01–04).
- The manual E2E runbook content (03b, authored separately/manually).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation the planning skill exposes the complete per-family matrix and the
  updated model ids.
- Confirmation `skills.test.ts` passes against the new content.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(routing): expose per-family effort matrix and openai-gpt in skill and docs

### Commit body

Update the phax-planning skill to present the full per-family model/effort
matrix (Haiku none; Sonnet low–max; Opus low–ultracode; Mistral off–max; GPT
low–xhigh) and bump the Opus id to claude-opus-4-8. Rename openai-chatgpt to
openai-gpt across the routing docs and skill, document the ultra tier and the
same-family preservation rule, and update skills.test.ts to match.
