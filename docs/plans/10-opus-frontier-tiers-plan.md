# Implementation plan — Per-effort frontier tiers for the full Opus ladder

> Deliverable location: `docs/plans/opus-frontier-tiers-plan.md`.
> Format: matches the `.skills/phax-planning.md` skill so `phax extract-plan`
> can consume this file and produce a `phax-plan.json`. Each phase carries an
> HTML anchor (`{#phase-NN-...}`) for the `planMarkdownAnchor` field.

---

## Context

`claude-opus` supports six efforts — `low | medium | high | xhigh | max |
ultracode` (`FAMILY_EFFORTS` in `src/domain/routing/types.ts`). The current
routing ladder collapses them into only three tiers
(`src/domain/routing/defaults.ts` `normalization["claude-opus"]`):

- `low`, `medium` → `frontier`
- `high`, `xhigh`, `max` → `max`
- `ultracode` → `ultra`

So `opus/high`, `opus/xhigh`, and `opus/max` all resolve identically, and
`opus/low` is indistinguishable from `opus/medium`. The user wants **every Opus
effort to route distinctly**, using **frontier-prefixed tier names**, with the
cross-provider relationships taken **strictly from the reference routing
artifact** (`~/Downloads/phax_routing.json`, `schema_version 1.2`).

### Goal

Replace the three coarse top tiers (`frontier`, `max`, `ultra`) with a
six-rung, effort-suffixed frontier ladder so each Opus effort maps to its own
tier, and set the `codex-cli` (gpt-5.5) relationship on each rung to exactly the
value the reference artifact records. Update code, docs, and skills.

This is a hard rename (per the project's "no back-compat shims" rule): the
`frontier`, `max`, and `ultra` tier literals are removed, not aliased.

### Out of scope (explicitly not supported here)

The reference artifact also models a Cursor provider, a Composer family, a
`standard`/`fast` variant axis, a `patch | agentic | general` phase-type
taxonomy with per-phase relationships, and provenance metadata. **None of these
are introduced.** PHAX does not support the phase-type taxonomy, so for the
artifact rows that split a relationship by phase, the **`patch` column is used**
as the single conservative value (it is the most correctness-critical and never
weaker than the others on the Opus band). New relationship literals
(`approximate`, `overshoot`, `no_default_equivalent`) are **not** added; the
artifact's terms are mapped onto PHAX's existing vocabulary
(`exact | equivalent | fallback | downgrade | no_equivalent`):

- `approximate` → `equivalent`
- `no_default_equivalent` → the entry is **omitted** (nothing maps).

### Target mapping (strict, from the artifact `equivalence_table`)

| Tier             | `claude-code`          | `codex-cli` (gpt-5.5) | relationship  | Artifact source (patch where split)         |
| ---------------- | ---------------------- | --------------------- | ------------- | ------------------------------------------- |
| `frontier-low`   | `claude-opus/low`      | `openai-gpt/high`     | `equivalent`  | opus/low → approximate                       |
| `frontier-medium`| `claude-opus/medium`   | `openai-gpt/xhigh`    | `equivalent`  | opus/medium → approximate (high-xhigh→xhigh) |
| `frontier-high`  | `claude-opus/high`     | `openai-gpt/xhigh`    | `equivalent`  | opus/high patch → approximate                |
| `frontier-xhigh` | `claude-opus/xhigh`    | `openai-gpt/xhigh`    | `equivalent`  | opus/xhigh patch → approximate               |
| `frontier-max`   | `claude-opus/max`      | `openai-gpt/xhigh`    | `downgrade`   | opus/max patch → downgrade                   |
| `frontier-ultra` | `claude-opus/ultracode`| *(none)*              | —             | opus/ultracode patch → no_default_equivalent |

**Mistral is excluded from the entire Opus band**, unchanged from today. Even
though the artifact's `equivalence_table` lists `mistral-medium/max` as a
*downgrade* reference at opus/low and opus/medium, the artifact's own
`phase_routing` policy sets `keep_mistral_out_of_opus_tier: true` for every
phase — so no `mistral-vibe` entry is added to any frontier tier. This is both
faithful to the artifact's routing policy and conservative.

This corrects a parity error in today's defaults: gpt-5.5 currently appears as a
`fallback`/`downgrade` on the Opus band, but the artifact records it at
**parity** (`approximate`/`equivalent`) for opus/low through opus/xhigh.

### Existing top-tier entries being replaced

Today (`defaults.ts`):

- `frontier`: `claude-opus/medium`; `codex-cli openai-gpt/xhigh` (`fallback`)
- `max`: `claude-opus/max`; `codex-cli openai-gpt/xhigh` (`downgrade`)
- `ultra`: `claude-opus/ultracode` (claude-code only)

These are removed and redistributed into the six new tiers per the target
mapping above.

### Invariants to preserve (`.skills/model-routing.md`)

- **Domain purity** — `src/domain/routing/` imports no Effect/infra/FS; enforced
  by `tests/unit/architecturalGuards.test.ts`.
- **Strict schemas** (`onExcessProperty: "error"`) — the tier literal set in
  `RoutingTierSchema` must exactly match the `RoutingTier` union.
- **No silent Opus downgrade** — when `allowDowngrade: false`, `resolveModel`
  skips `downgrade` / `no_equivalent` candidates for `claude-opus`; this logic
  is unchanged, it just operates over more tiers. (Note: `DEFAULT_MODEL_ROUTING`
  ships `allowDowngrade: true`, so the `frontier-max` `downgrade` codex entry is
  selectable by default when codex-cli is enabled and ahead of claude-code in
  `providerPriority` — this is intended and matches the artifact's parity-aware
  intent; call it out in the handoff so it is not mistaken for a regression.)
- **`ultracode` is Opus-only** — `claude-opus/ultracode` resolves through
  `frontier-ultra` with no non-Claude peer.
- **Terminal fallback** — every tier keeps a `claude-code` entry so
  `resolveModel` stays total.

---

## phase-01 — Expand Opus tiers into a frontier ladder {#phase-01-frontier-ladder}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Replace the `frontier` / `max` / `ultra` tier literals with the six
effort-suffixed frontier tiers across the type union, the schema literal set,
and the default routing table, applying the strict artifact mapping for the
`codex-cli` relationships. This is a single coherent commit because the three
files must change together to keep the repo compiling.

### Detailed instructions

- `src/domain/routing/types.ts`: in the `RoutingTier` union, remove `"frontier"`,
  `"max"`, `"ultra"` and add `"frontier-low"`, `"frontier-medium"`,
  `"frontier-high"`, `"frontier-xhigh"`, `"frontier-max"`, `"frontier-ultra"`.
  Keep `cheap | fast | standard | strong | very_strong` as the leading rungs.
- `src/schemas/modelRouting.ts`: update `RoutingTierSchema` to the identical
  eleven-literal set so a config decodes iff it matches the union.
- `src/domain/routing/defaults.ts`:
  - In `DEFAULT_MODEL_ROUTING.tiers`, remove the `frontier`, `max`, `ultra`
    blocks and add the six new tier blocks exactly per the target mapping:
    - `frontier-low`: `claude-code { family: "claude-opus", effort: "low" }`;
      `codex-cli { family: "openai-gpt", thinking: "high" }` (no `relationship`
      → classified `equivalent` by cross-family default).
    - `frontier-medium`: `claude-code { family: "claude-opus", effort: "medium" }`;
      `codex-cli { family: "openai-gpt", thinking: "xhigh" }` (`equivalent`).
    - `frontier-high`: `claude-code { family: "claude-opus", effort: "high" }`;
      `codex-cli { family: "openai-gpt", thinking: "xhigh" }` (`equivalent`).
    - `frontier-xhigh`: `claude-code { family: "claude-opus", effort: "xhigh" }`;
      `codex-cli { family: "openai-gpt", thinking: "xhigh" }` (`equivalent`).
    - `frontier-max`: `claude-code { family: "claude-opus", effort: "max" }`;
      `codex-cli { family: "openai-gpt", thinking: "xhigh", relationship:
      "downgrade" }`.
    - `frontier-ultra`: `claude-code { family: "claude-opus", effort:
      "ultracode" }` only (no codex peer — artifact patch =
      no_default_equivalent; matches today's `ultra`).
  - In `normalization["claude-opus"]`, remap each effort to its own tier:
    `low → "frontier-low"`, `medium → "frontier-medium"`,
    `high → "frontier-high"`, `xhigh → "frontier-xhigh"`,
    `max → "frontier-max"`, `ultracode → "frontier-ultra"`.
  - In `normalization["openai-gpt"]`, change `xhigh: "frontier"` to
    `xhigh: "frontier-high"` (the frontier rung whose codex entry is gpt/xhigh).
  - Leave all other tiers, `families`, `providerPriority`, `defaultTier:
    "standard"`, `allowDowngrade`, and `requestedModelNormalization` unchanged.
    Do **not** add any `mistral-vibe` entry to any frontier tier.
- Do not introduce new providers, families, variants, relationship literals, or
  phase-type fields.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/types.ts`
- `src/schemas/modelRouting.ts`
- `src/domain/routing/defaults.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/schemas.test.ts`
- `tests/integration/routing.test.ts`

### Optional files that may be edited

- `tests/type/routing.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`
- `tests/unit/telemetry/modelResolved.test.ts`
- `tests/e2e/__snapshots__/semanticTrace.test.ts.snap`

### Boundary contracts

Producer: `RoutingTier` (types) and `RoutingTierSchema` (schema) define the tier
vocabulary; `DEFAULT_MODEL_ROUTING` is the executable table. Consumer:
`resolveModel` reads `normalization` → tier → `tiers[tier]`. The schema literal
set and the type union must stay identical or a valid default fails to decode.

### Test strategy

Domain + schema + integration → unit/integration tests. Test-first (stable
contract / critical behaviour):
- `decodeModelRouting(DEFAULT_MODEL_ROUTING)` succeeds (default-validity guard).
- Each Opus effort resolves to its own tier with the right `claude-code`
  concrete model and effort: `opus/low → frontier-low` … `opus/ultracode →
  frontier-ultra`.
- With `codex-cli` enabled and ahead of `claude-code` in priority, the
  codex relationship matches the strict mapping: `equivalent` at
  opus/low–xhigh (gpt `high` at low, gpt `xhigh` at medium–xhigh), `downgrade`
  at opus/max, and **no** codex candidate at opus/ultracode (resolves to
  claude-code).
- `opus/ultracode` has no non-Claude peer and is never silently downgraded when
  `allowDowngrade: false`.
- A config using a removed literal (`"frontier"`, `"max"`, `"ultra"`) now fails
  to decode.

### Implementation order

`types.ts` union → `modelRouting.ts` schema literal set → `defaults.ts` tier
blocks → `defaults.ts` normalization maps → update/add tests → refresh any
affected snapshots.

### Excluded scope

- New providers (Cursor), families (Composer), variants, relationship literals,
  phase-type routing, and metadata — all out of scope.
- Adding Mistral to the Opus band (excluded by `keep_mistral_out_of_opus_tier`).
- Changing the lower tiers or non-Opus normalization (except the single
  `openai-gpt` `xhigh` remap required by the rename).

### Verification

- The project's configured `full` gate profile in `phax.json` (typecheck, lint,
  format:check, knip, test, audit:architecture, build).

### Expected handoff content

- The final `RoutingTier` union (exact literals).
- The `normalization["claude-opus"]` and `normalization["openai-gpt"]` maps as
  implemented.
- The per-tier `claude-code` / `codex-cli` entries and their relationships, so
  phase-02 can transcribe the docs table without re-deriving from the artifact.
- An explicit note on the `allowDowngrade: true` default interaction at
  `frontier-max`.
- Which snapshots changed and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): split Opus band into per-effort frontier tiers

### Commit body

Replace the coarse frontier/max/ultra tiers with a six-rung frontier ladder
(frontier-low … frontier-ultra) so every claude-opus effort
(low|medium|high|xhigh|max|ultracode) routes to its own tier. Set the codex-cli
(gpt-5.5) relationship on each rung strictly from the reference routing artifact
(equivalent at opus/low–xhigh, downgrade at opus/max, no peer at
opus/ultracode), correcting the prior fallback/downgrade parity error. Mistral
stays out of the Opus band per the artifact's keep_mistral_out_of_opus_tier
policy. No new providers, families, relationships, or phase-type taxonomy.

---

## phase-02 — Sync docs and skills {#phase-02-docs-sync}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Update the routing documentation and skills so the tier tables and worked
examples describe the six-rung frontier ladder and the corrected codex parity.

### Detailed instructions

- `.skills/model-routing.md`:
  - In the "Routing tiers" table, replace the `frontier` / `max` / `ultra` rows
    with the six `frontier-*` rows (one per Opus effort) and their typical use.
  - Update the "Worked examples" table so `opus/*` rows reference the new tier
    names and the corrected codex relationships (e.g. `opus/high`, codex-cli
    first → gpt-5.5 `xhigh`, `equivalent`; `opus/ultracode … frontier-ultra`).
- `docs/model-routing.md`: apply the same tier-name and relationship updates
  wherever `frontier` / `max` / `ultra` tiers are described.
- Grep `docs/` and `.skills/` (excluding `docs/plans/` and `docs/specs/`
  historical files) for any remaining reference to the removed tier literals and
  fix it.

### Planned files to create

- (none)

### Planned files to edit

- `.skills/model-routing.md`
- `docs/model-routing.md`

### Optional files that may be edited

- `README.md`

### Boundary contracts

Producer: docs/skills describe the routing tier contract for humans and future
agents. Consumer: `tests/unit/skills.test.ts` validates skill files — confirm it
does not pin removed tier names; update it if it does.

### Test strategy

Doc/skill layer → the existing `tests/unit/skills.test.ts` structure check. No
new tests required; ensure the suite stays green after the edits.

### Implementation order

`.skills/model-routing.md` tier table → its worked examples →
`docs/model-routing.md` → grep sweep for stragglers.

### Excluded scope

- Any code change (all behaviour landed in phase-01).

### Verification

- The project's configured `full` gate profile in `phax.json` (lint/format and
  `tests/unit/skills.test.ts` run under it).

### Expected handoff content

- Confirmation the docs/skills no longer reference `frontier` / `max` / `ultra`
  as tiers and that `tests/unit/skills.test.ts` passes.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(routing): describe per-effort frontier tier ladder

### Commit body

Update .skills/model-routing.md and docs/model-routing.md to document the
six-rung frontier ladder (frontier-low … frontier-ultra) that replaced the
coarse frontier/max/ultra tiers, including the routing-tier table and the Opus
worked examples with the corrected gpt-5.5 parity relationships.
