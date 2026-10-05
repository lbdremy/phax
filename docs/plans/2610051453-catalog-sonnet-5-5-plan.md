---
status: Draft
source-spec: null
---
# Catalog: Sonnet 5.5

> No source spec: this is a catalog refresh, not a feature. Planned 2026-10-05 against `main` @ `7df5237f`. Phases 01 and 03 write `.claude/skills/phax-planning/SKILL.md`, so run the plan with `phax run --allow-skill-edits`.

Add Claude Sonnet 5.5 to the routing catalog, re-anchor GPT-6 Sol on it, and make it phax's default compliance reviewer.

- **Claude Sonnet 5.5** (`claude-sonnet-5-5`) joins the `claude-code` provider at the head of `claude-sonnet`, so the `sonnet` alias resolves to it. It costs the same as Sonnet 5 ($2/$10) and scores 13 points higher at `medium`.
- **GPT-6 Sol re-anchors from Opus 5.5 to Sonnet 5.5**: `equivalent` at `medium`, `downgrade` at every other effort. Opus 5.5, the default phase model, loses its only Codex route.
- **Compliance review defaults to Sonnet 5.5 at `medium`.** Code review, plan adjustment and plan extraction are re-checked and stay as they are.
- **The phax-planning skill recommends Sonnet 5.5 for mechanical phases.** The default phase model stays Opus 5.5.

`claude-sonnet-5` stays `active`. GPT-6 Luna (→ Sonnet 5) and GPT-6 Astra (↔ Fable 5.1) keep their anchors. The plan adds no family, no effort level, no schema change and no logic change.

**Context.** The routing layer is documented in `.claude/skills/model-routing/SKILL.md` and `docs/model-routing.md`. `docs/model-catalog.md` is the standing decision record: sources (§1), entries (§2), anchors (§3), cost basis and defaults (§4), refresh checklist (§5), refresh log (§6). Every change below is recorded there in the phase that makes it. The template for this plan is the previous refresh, `docs/plans/archive/2609230815-catalog-opus-5-5-gpt-6-sol-luna-plan.md`.

**Provider facts (read 2026-10-05; cite them as given, do not re-derive them).**

- **Claude Code 2.1.289 model table** (`/Users/remyloubradou/.local/share/claude/versions/2.1.289`):
  - `claude-sonnet-5-5` is the only id, with no dated variant. Family `sonnet`, `fallback_3p: "claude-sonnet-5"`, `pricing: "tier_2_10"`, `default_effort: "medium"`, 1M context, 128k max output.
  - Its capabilities include `xhigh_effort` and `max_effort`, so its ladder is `low medium high xhigh max ultracode` (§2 lists ultracode wherever xhigh is). It has no `effort_cost_index`.
  - `claude-sonnet-5` is still in the table: `tier_2_10`, `effort_cost_index` 0.47 / 0.74 / 1 / 2.41 / 5.59.
- **Anthropic** (platform.claude.com pricing and models overview; anthropic.com/claude-sonnet-5-5):
  - Sonnet 5.5 was released 2026-09-28 at $2 / $10 per million tokens, "Active (latest)".
  - Sonnet 5 has the same price and is listed under "Legacy models (still available)", with no deprecation date.
  - The announcement claims Sonnet 5.5 is 30%+ faster than Sonnet 5 and up to 30% cheaper per task at the same price (a vendor figure). It lists breaking API changes from Sonnet 5, including that forced tool use now errors.
- **Artificial Analysis Intelligence Index**, fetched 2026-10-05 on the same scale as the 2026-09-23 read (Opus 5.5 and Fable 5.1 unchanged). Scores are low/medium/high/xhigh/max:

  | Model | Scores | Index tokens (max) |
  | --- | --- | --- |
  | Sonnet 5.5 | 36/41/47/52/56 | 420M |
  | Sonnet 5 | 24/28/32/34/38 (now listed deprecated) | 370M |
  | Opus 5.5 | 42/51/54/56/58 | 260M |
  | Fable 5.1 | 47/49/51/53/53 | 190M |

  The Codex anchors use the 2026-09-23 read already in §3: GPT-6 Sol 34/40/43/44/48, GPT-6 Luna 21/29/32/34/37, GPT-6 Astra 46/50/51/52/53.

**Architecture seams (audited 2026-10-05 against `main` @ `7df5237f`).**

- **Catalog and edges** live in `src/domain/routing/defaults.ts` only. `ModelFamily`, the effort schemas, `CLAUDE_FAMILIES`, the heuristics and `requestedModelNormalization` already cover `claude-sonnet-5-5`, so do not touch them.
- **Alias resolution.** `pickActiveEntry` (`src/domain/routing/resolve.ts`) returns a family's first active entry. Families have been listed newest-first since the 2026-09-23 refresh, so prepending the entry is enough: the `sonnet` alias and the terminal unknown-id fallback both move to Sonnet 5.5 with no code change.
- **Hub → spoke.** `hubToSpoke` (`src/domain/routing/catalog.ts`) returns the first non-deprecated edge in the equivalence table's insertion order.
  - After the re-anchor, no edge targets `claude-opus-5-5`.
  - Two Sol edges target Sonnet 5.5 at `max`: Sol's own `max` edge and its `ultra` edge. The `max` edge comes first, so Sonnet 5.5 / `max` routes to Sol / `max`.
- **Tests pinned to the Sonnet family's first entry or to Sol's anchor:**
  - `tests/unit/routing/resolve.test.ts`: `sonnet` alias at :227, unknown-id fallback at :447-457, Sol/Opus 5.5 at :310-364.
  - `tests/unit/routing/catalog.test.ts`: Opus 5.5 → Sol at :345.
  - `tests/unit/routing/sameFamilyPreservation.test.ts`: Sol `ultra` → Opus 5.5 at :149.
  - `tests/unit/routing/effortLevels.test.ts`: the active-status list.
  - `tests/unit/skills.test.ts`: the listed ids.
  - `tests/unit/schemas/complianceReviewConfig.test.ts:62`: the compliance default.
- **Fixtures that use `claude-sonnet-5` as an arbitrary valid id stay as they are**, because Sonnet 5 remains active. That covers config fixtures, plan fixtures, records tests, `tests/unit/planLint.test.ts` and `examples/hello-world/plan.md`.
- **Built-in default.** `DEFAULT_COMPLIANCE_REVIEW_MODEL` is at `src/schemas/phaxConfig.ts:179`, and `README.md:318` states it in prose. No CLI help string names it, so `phax.usage.kdl` and `docs/cli/reference.md` do not change.
- **Leave alone:** `docs/blog/announcing-phax-1.0.md`, archived plans and specs, and current specs whose examples name `claude-sonnet-5`.
- **Plan runtime.** Phases run through `claude-code` only. The gates never call a real provider: the new id is exercised by unit tests only. A real-provider check of the new compliance default is the author's post-merge step; see phase-03's handoff.

## Required commands

- `pnpm gen:model-catalog`

`pnpm gen:model-catalog` rewrites the marker-delimited catalog table in `.claude/skills/phax-planning/SKILL.md` from `DEFAULT_PROVIDER_CONFIG`, in config order. The `standard` gate runs it with `--check`, so phase-01 must regenerate it. It is already granted in `security.agentCommands` in `phax.json`.

No phase changes a CLI help string, so `pnpm gen:usage-spec` and `pnpm docs:cli` are not required. Both are granted too, in case an agent finds a help string that names a changed default.

## Technical arbitrations

- Resolved with the author on 2026-10-05.
- **`claude-sonnet-5-5` heads the `claude-sonnet` family, and `claude-sonnet-5` stays `active`.** The `sonnet` alias and the terminal unknown-id fallback move to Sonnet 5.5. Sonnet 5 stays active, as Opus 5 did, because Anthropic still serves it (Legacy, still available, no deprecation date). Accepted loss: the catalog keeps a same-priced, weaker Sonnet that AA now lists as deprecated. Rejected: deprecating Sonnet 5, which would cut GPT-6 Luna's anchor.
- **GPT-6 Sol re-anchors from `claude-opus-5-5` to `claude-sonnet-5-5`.** Sonnet 5.5 is closer at every effort. Relations follow §3's rule (`equivalent` within about one point): low 34 vs 36 is `downgrade`, medium 40 vs 41 is `equivalent`, and high 43 vs 47, xhigh 44 vs 52 and max 48 vs 56 are `downgrade`. `ultra` anchors to Sonnet 5.5 `max`, `downgrade`. Accepted loss: **Opus 5.5 loses its only Codex route.** The default phase model becomes Claude-only, so an Opus 5.5 phase never reaches Codex, whatever the priority or `allowDowngrade` says. A Sol phase that falls back to Claude lands on Sonnet 5.5. Rejected: keeping Sol → Opus 5.5 (a less exact anchor), and splitting Sol's anchor by effort (an anchor table that is hard to reason about).
- **Compliance review defaults to `claude-sonnet-5-5` at `medium`.** It costs the same per token as Sonnet 5 and scores 41 against 28 at `medium`. Accepted loss: about 13% more output tokens on the max-effort index run (420M vs 370M); no per-effort figure exists.
- **Code review and plan adjustment stay on `claude-opus-5-5` at `high`** (54). Sonnet 5.5 beats that only at `max` (56). There, Sonnet 5's cost index was 5.59× its `high` cost, and Sonnet 5.5 spent 420M index tokens against Opus 5.5's 260M. Accepted loss: none at the same capability.
- **The phax-planning skill recommends `claude-sonnet-5-5` for mechanical phases.** The default phase model stays `claude-opus-5-5`. The generated catalog table in the skill is refreshed by `pnpm gen:model-catalog` and never edited by hand.
- **The real-provider check stays out of the gates.** The gates never call a real provider, and Sonnet 5.5 changed API behaviour (forced tool use now errors). Phase-03's handoff names `pnpm test:e2e:real` (or one real `phax review-compliance`) as the author's post-merge check of the new compliance default. No phase runs it. Accepted loss: a merged default that no automated check has exercised against the live model.
- Decided without a question (only one viable option each): GPT-6 Luna stays anchored to Sonnet 5 (within a point from `medium` up), and GPT-6 Astra stays ↔ Fable 5.1. Plan extraction stays on `claude-haiku-4-5-20251001` at `low`, since there is no newer Haiku. This plan's own phases name only models already in the shipped catalog (`claude-sonnet-5`, `claude-opus-5-5`): the run-start preflight checks phases against the installed binary's catalog (0.18.0), which does not know `claude-sonnet-5-5`.

---

## phase-01 — Claude catalog: Sonnet 5.5 at the head of the sonnet family {#phase-01-claude-sonnet-5-5}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Register `claude-sonnet-5-5` as the first entry of `claude-sonnet`. The `sonnet` alias and any unrecognised id then resolve to Sonnet 5.5, while `claude-sonnet-5` stays active and keeps its own exact resolution.

### Detailed instructions

- **Catalog** (`src/domain/routing/defaults.ts`, `claude-code` → `claude-sonnet`): prepend `{ id: "claude-sonnet-5-5", efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"], status: "active" }`. The order becomes `claude-sonnet-5-5`, `claude-sonnet-5`, `claude-sonnet-4-6`. `claude-sonnet-5` stays `active`, with its efforts unchanged. Do not touch the equivalence table (phase-02), `requestedModelNormalization`, `ModelFamily`, the effort schemas or the heuristics.
- **Regenerate** the planner table with `pnpm gen:model-catalog`. Never edit the generated region of `.claude/skills/phax-planning/SKILL.md` by hand.
- **Decision record, §2** (`docs/model-catalog.md`): add a `claude-sonnet-5-5` row above `claude-sonnet-5`.
    - Efforts: `low medium high xhigh max ultracode`.
    - Read from: Claude Code 2.1.289 table, `xhigh_effort` + `max_effort`, `pricing: tier_2_10`, `default_effort: medium`, `fallback_3p: claude-sonnet-5`, 1M context, 128k max output; released 2026-09-28; no dated variant.
    - Since: 2026-10-05 refresh.
- **Decision record, Sonnet 5 row** (`docs/model-catalog.md` §2): append that it is kept active on purpose. Claude Code 2.1.289 still serves it, Anthropic lists it as Legacy (still available) with no deprecation date, AA now lists it deprecated, and it anchors GPT-6 Luna.
- **Decision record, alias paragraph** (`docs/model-catalog.md` §2, the newest-first paragraph under the claude-code table): `sonnet` now resolves to `claude-sonnet-5-5`.
- **Decision record, §1:** leave as is. No source changed kind.
- **Doc** (`docs/model-routing.md`): in the "Versioned catalog" JSON excerpt, show `claude-sonnet` newest-first: `claude-sonnet-5-5`, then `claude-sonnet-5`, then the existing `claude-sonnet-4-6`, each with its real efforts.
- **Tests** (write first, and confirm they fail on the current catalog):
    - `tests/unit/routing/effortLevels.test.ts`: `effortsFor("claude-sonnet-5-5")` equals `["low", "medium", "high", "xhigh", "max", "ultracode"]`, and the id joins the "every catalog entry is marked status active" list.
    - `tests/unit/routing/catalog.test.ts`: `familyOfId("claude-sonnet-5-5")` → `claude-sonnet`.
    - `tests/unit/routing/resolve.test.ts`:
      - `claude-sonnet-5-5` / `medium`, claude-only priority → `claude-code`, same id and effort, `exact`.
      - Rename and update the alias test at :227: `sonnet` / `medium` → `claude-sonnet-5-5`, `equivalent`.
      - Update the "totally-unknown-model" fallback test at :447-457 to assert `claude-sonnet-5-5`.
      - `claude-sonnet-5` / `medium`, claude-only → still `claude-sonnet-5`, `exact`.
    - `tests/unit/routing/sameFamilyPreservation.test.ts`: `claude-sonnet-5-5` / `ultracode` with `mistralPriority` and every provider enabled stays on `claude-code`, `claude-sonnet`, `ultracode`.
    - `tests/unit/skills.test.ts`: assert the generated table contains `claude-sonnet-5-5`.
    - Fix any other test that silently depended on `claude-sonnet-5` being the family's first entry, and name each one in the handoff. Leave tests that use `claude-sonnet-5` as an arbitrary valid id alone.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `docs/model-catalog.md`
- `docs/model-routing.md`
- `tests/unit/routing/effortLevels.test.ts`
- `tests/unit/routing/catalog.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`
- `tests/unit/skills.test.ts`

### Optional files that may be edited

- `tests/unit/routing/preflight.test.ts`
- `tests/unit/routing/securityFallback.test.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `.claude/skills/model-routing/SKILL.md`

### Boundary contracts

Producer: `DEFAULT_PROVIDER_CONFIG` lists `claude-sonnet-5-5` first in `claude-sonnet`, with the six-effort ladder.

Consumers:

- phase-02's `gpt-6-sol` edges target `claude-sonnet-5-5` at `low`…`max`;
- phase-03's compliance default names `claude-sonnet-5-5` at `medium`;
- `pickActiveEntry` treats the first active entry as the target of the `sonnet` alias and of the unknown-id fallback.

### Test strategy

Write the domain unit tests before the edit:

- the new id's ladder and active status;
- its family lookup;
- exact resolution of both Sonnet 5.5 and Sonnet 5;
- the `sonnet` alias and the unknown-id fallback moving to Sonnet 5.5;
- the ultracode guard.

No adapter or integration change.

### Implementation order

1. Failing tests.
2. Prepend the catalog entry.
3. `pnpm gen:model-catalog`.
4. `docs/model-catalog.md` §2 and `docs/model-routing.md`.

### Excluded scope

- The equivalence table and the GPT-6 Sol re-anchor (phase-02).
- The compliance default, the planning-guidance prose and the §4/§6 decision record (phase-03).
- Deprecating `claude-sonnet-5` or changing any other family.
- Rewriting fixtures that use `claude-sonnet-5` as an arbitrary valid id.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The committed `claude-sonnet` array, in order.
- Every test changed because Sonnet 5.5 is now the family's first entry, with the reason.
- Confirmation that `pnpm gen:model-catalog --check` passed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(routing): add Claude Sonnet 5.5 at the head of the sonnet family`

### Commit body

Register claude-sonnet-5-5 (Claude Code 2.1.289 table: tier_2_10,
xhigh_effort and max_effort) with the low|medium|high|xhigh|max|ultracode
ladder, first in claude-sonnet. pickActiveEntry resolves aliases and
unknown ids to a family's first active entry, so the sonnet alias and
the terminal unknown-id fallback now resolve to Sonnet 5.5.

claude-sonnet-5 stays active: Anthropic still serves it, and it anchors
GPT-6 Luna. Regenerate the planner table and record the entry in
docs/model-catalog.md.

---

## phase-02 — Re-anchor GPT-6 Sol from Opus 5.5 to Sonnet 5.5 {#phase-02-sol-to-sonnet-5-5}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Point every `gpt-6-sol` edge at `claude-sonnet-5-5`, labelled per effort. A Sonnet 5.5 phase can then reach Codex as Sol, a Sol phase falls back to Sonnet 5.5, and Opus 5.5 becomes Claude-only.

### Detailed instructions

- **Equivalence** (`src/domain/routing/defaults.ts`, `DEFAULT_MODEL_ROUTING.equivalence["gpt-6-sol"]`). Keep its position in the table and replace every edge:
    - `low` → `claude-sonnet-5-5` `low`, `downgrade`
    - `medium` → `claude-sonnet-5-5` `medium`, `equivalent`
    - `high` → `claude-sonnet-5-5` `high`, `downgrade`
    - `xhigh` → `claude-sonnet-5-5` `xhigh`, `downgrade`
    - `max` → `claude-sonnet-5-5` `max`, `downgrade`
    - `ultra` → `claude-sonnet-5-5` `max`, `downgrade`
- **Sol comment** (in the same file): rewrite it with the 2026-10-05 read, which is on the same scale as 2026-09-23. Sol is 34/40/43/44/48 and Sonnet 5.5 is 36/41/47/52/56. Sol was anchored to Opus 5.5 (42/51/54/56/58), and Sonnet 5.5 is closer at every effort. `medium` is within a point, so it is `equivalent`. `ultra` anchors to `max` so that `ultracode` stays Claude-only. No edge targets Opus 5.5 any more, so the default phase model has no Codex route.
- **Unchanged edges:** leave the `gpt-6-luna` (→ `claude-sonnet-5`), `gpt-6-astra` (→ `claude-fable-5-1`), GPT-5.6, `gpt-5.5` and Mistral edges untouched. Do not change `hubToSpoke`, `spokeToHub` or `equivalentFor`.
- **Decision record, §3 anchors** (`docs/model-catalog.md`):
    - Rewrite the `gpt-6-sol` row: anchor `claude-sonnet-5-5`; relation `equivalent` at `medium`, else `downgrade`.
    - Basis: AA Intelligence Index, Sol 34/40/43/44/48 (2026-09-23 read) vs Sonnet 5.5 36/41/47/52/56 (2026-10-05 read, same scale). It was anchored to Opus 5.5 (42/51/54/56/58), and Sonnet 5.5 is closer at every effort.
    - Since: 2026-09-23 refresh; re-anchored 2026-10-05 refresh.
    - Add one sentence under the re-scaling note: the 2026-10-05 read is on the 2026-09-23 scale (Opus 5.5 and Fable 5.1 unchanged).
- **Decision record, "Which Claude entries lost their codex route" paragraph** (§3): add that `claude-opus-5-5` lost its only Codex route when Sol re-anchored to Sonnet 5.5 (2026-10-05). The default phase model is therefore Claude-only: an Opus 5.5 phase never reaches Codex, whatever the priority or `allowDowngrade` says. In `claude-opus`, only Opus 4.8 at `medium` keeps a Codex route, via `gpt-5.5` at `xhigh`.
- **Decision record, "Consequence of the `downgrade` edges" paragraph** (§3): rewrite it. The downgrade edges are now Sol at every effort except `medium`, and Luna at `low`.
    - With `allowDowngrade: true` (the default) and codex first in priority, a Sonnet 5.5 phase reaches Codex as `gpt-6-sol`: labelled `equivalent` at `medium` and `downgrade` at `low`/`high`/`xhigh`/`max`.
    - With `false`, it reaches Codex only at `medium`.
    - A Sol phase falling back to Claude lands on Sonnet 5.5: `equivalent` at `medium` and `upgrade` elsewhere, under both settings.
    - Keep the Astra and Luna sentences.
- **Doc** (`docs/model-routing.md`):
    - Rewrite the "shipped table uses `downgrade`" paragraph (line 83) for Sol → `claude-sonnet-5-5`: `equivalent` at `medium`, `downgrade` elsewhere. Say that `claude-opus-5-5` has no Codex spoke.
    - In the "Model families" table, add `codex-cli (equivalent)` to the `claude-sonnet` row.
    - Add a worked example after Example 7: `claude-sonnet-5-5` / `high`, codex-cli first, `allowDowngrade: true` → `codex-cli`, `gpt-6-sol`, `high`, `downgrade`. With `false`, the request falls through to `claude-code` `claude-sonnet-5-5` `exact`.
- **Tests** (write first):
    - `tests/unit/routing/catalog.test.ts`:
      - Replace the "claude-opus-5-5/high anchors to gpt-6-sol" test with "claude-opus-5-5 has no openai-gpt anchor". For each of `low`, `medium`, `high`, `xhigh`, `max` and `ultracode`, `equivalentFor("claude-opus-5-5", effort, "openai-gpt", …)` is `undefined`.
      - Hub → spoke: `claude-sonnet-5-5` → `gpt-6-sol` at the same effort, with relation `downgrade` at `low`/`high`/`xhigh`/`max` and `equivalent` at `medium`. One table-driven test is fine.
      - Hub → spoke: `claude-sonnet-5-5` / `ultracode` → `undefined`.
      - Spoke → hub: `gpt-6-sol` / `medium` → `claude-sonnet-5-5` `medium` `equivalent`, and `gpt-6-sol` / `high` → `claude-sonnet-5-5` `high` `upgrade`.
      - The existing `claude-sonnet-5` → `gpt-6-luna` tests still pass, unchanged.
    - `tests/unit/routing/resolve.test.ts`, in the "GPT-6 Sol and Luna" describe:
      - `claude-opus-5-5` / `high` with codex first, codex enabled and `allowDowngrade: true` → `claude-code`, `claude-opus-5-5`, `exact`. This replaces the routes-to-Sol test; keep the `false` case as well.
      - `claude-sonnet-5-5` / `high` → `codex-cli` `gpt-6-sol` `downgrade` under `true`, and `claude-code` `claude-sonnet-5-5` `exact` under `false`.
      - `claude-sonnet-5-5` / `medium` → `codex-cli` `gpt-6-sol` `equivalent`, even under `allowDowngrade: false`.
      - `gpt-6-sol` / `max` with codex disabled → `claude-code` `claude-sonnet-5-5` `max` `upgrade`. This replaces the Opus 5.5 expectation.
      - `gpt-6-sol` / `medium` with codex disabled → `claude-sonnet-5-5` `medium` `equivalent`.
    - `tests/unit/routing/sameFamilyPreservation.test.ts`:
      - The `gpt-6-sol` / `ultra` fallback lands on `claude-code`, family `claude-sonnet`, `claude-sonnet-5-5`, effort `max`, never `ultracode`.
      - `claude-sonnet-5-5` / `ultracode` with codex first and enabled stays on `claude-code` at `ultracode`.
    - Any other test that asserted Sol ↔ Opus 5.5 moves to Sonnet 5.5. Name each one in the handoff.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `docs/model-catalog.md`
- `docs/model-routing.md`
- `tests/unit/routing/catalog.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`

### Optional files that may be edited

- `tests/unit/routing/preflight.test.ts`
- `tests/unit/routing/securityFallback.test.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `.claude/skills/model-routing/SKILL.md`
- `README.md`

### Boundary contracts

Producer: `DEFAULT_MODEL_ROUTING.equivalence["gpt-6-sol"]` anchors to `claude-sonnet-5-5`, which must exist from phase-01.

Consumers, all unchanged:

- `equivalentFor` and `hubToSpoke`;
- `resolveModel`;
- `preflightPhaseModels` / `hasPermittedCrossFamilyRoute`, which now find no Codex route for `claude-opus-5-5` and a per-effort-labelled Sol route for `claude-sonnet-5-5`.

### Test strategy

Write the domain unit tests first: hub ↔ spoke lookups in both directions for Sonnet 5.5, the absence of any Opus 5.5 spoke, and `resolveModel` under both `allowDowngrade` settings. These are the behaviours a mislabelled edge or a stale anchor would break silently.

### Implementation order

1. Failing tests.
2. Rewrite the `gpt-6-sol` edges and their comment.
3. `docs/model-catalog.md` §3.
4. `docs/model-routing.md`.

### Excluded scope

- Moving the GPT-6 Luna or GPT-6 Astra anchors.
- Splitting Sol's anchor across Claude models by effort.
- Any change to `hubToSpoke`, `equivalentFor` or the resolution algorithm.
- Defaults, planning guidance, and §4/§6 of the decision record (phase-03).
- Live codex e2e.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The committed `gpt-6-sol` equivalence block.
- Confirmation that no edge targets `claude-opus-5-5`.
- The Claude entries whose Codex route changed: Opus 5.5 lost one, Sonnet 5.5 gained one.
- Every test moved from Opus 5.5 to Sonnet 5.5, with the reason.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(routing): re-anchor GPT-6 Sol from Opus 5.5 to Sonnet 5.5`

### Commit body

Sonnet 5.5 is closer to GPT-6 Sol than Opus 5.5 at every effort on
the Artificial Analysis Intelligence Index (2026-10-05 read, same
scale as 2026-09-23): Sol 34/40/43/44/48 vs Sonnet 5.5 36/41/47/52/56.
Anchor Sol's efforts straight across to claude-sonnet-5-5: equivalent
at medium, downgrade elsewhere; ultra anchors to max.

No edge targets claude-opus-5-5 any more, so the default phase model
never routes to Codex. A Sol phase falling back to Claude lands on
Sonnet 5.5. Luna (-> Sonnet 5) and Astra (<-> Fable 5.1) are unchanged.

---

## phase-03 — Compliance default and planning guidance to Sonnet 5.5 {#phase-03-defaults-sonnet-5-5}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Make `claude-sonnet-5-5` / `medium` phax's default compliance reviewer and the planning skill's recommendation for mechanical phases. Then close the refresh in `docs/model-catalog.md`: §4 cost basis and defaults, and the §6 log row.

### Detailed instructions

- **Default** (`src/schemas/phaxConfig.ts`): set `DEFAULT_COMPLIANCE_REVIEW_MODEL = "claude-sonnet-5-5"`. The effort stays `medium` in `resolveComplianceReviewConfig`. Rewrite the one-line comment above it: same $2/$10 as Sonnet 5, 41 vs 28 at `medium` on AA (2026-10-05). Leave `DEFAULT_CODE_REVIEW_MODEL`, `DEFAULT_AUTHORING_MODEL` and `DEFAULT_EXTRACT_MODEL` unchanged, as well as `adjustPlan`'s `DEFAULT_MODEL`.
- **Test:** in `tests/unit/schemas/complianceReviewConfig.test.ts:62`, expect `"claude-sonnet-5-5"`. Keep the `entryFor` catalog-presence assertion.
- **README:** in `README.md:318`, the compliance review default becomes `claude-sonnet-5-5` at `medium`. Leave the `phax agent resolve --model claude-sonnet-5` example at :355 as it is, since Sonnet 5 stays a valid id.
- **CLI help:** no `--model` help string names the compliance default (checked 2026-10-05). If one turns up, update it, run `pnpm gen:usage-spec` and `pnpm docs:cli`, and say so in the handoff.
- **Planning guidance** (`.claude/skills/phax-planning/SKILL.md`, the `### Choosing a model and effort` subsection outside the generated region): the mechanical-phases bullet becomes "Use `claude-sonnet-5-5` for mechanical phases (catalog/table edits, renames, doc sweeps)." Leave the other bullets, including the default phase model `claude-opus-5-5`. Do not touch the generated table.
- **Decision record, "State described"** (`docs/model-catalog.md`): point it at this plan's archived path, `docs/plans/archive/<this plan's stamp>-catalog-sonnet-5-5-plan.md`, using the same stamp as this plan's file.
- **Decision record, §4 prose:** add a paragraph after the Opus 5.5 exception paragraph. Sonnet 5.5's figures are from the 2026-10-05 read, on the same scale as 2026-09-23. On that scale (low/medium/high/xhigh/max, max-effort index tokens):
    - Sonnet 5.5: 36/41/47/52/56, 420M.
    - Sonnet 5: 24/28/32/34/38, 370M; AA now lists it deprecated.
    - Opus 5.5: 42/51/54/56/58, 260M.
    - Fable 5.1: 47/49/51/53/53, 190M.

    Claude Code 2.1.289 publishes no `effort_cost_index` for Sonnet 5.5. Anthropic's announcement (anthropic.com/claude-sonnet-5-5, read 2026-10-05) claims it is 30%+ faster than Sonnet 5 and up to 30% cheaper per task; these are vendor figures. The announcement also lists breaking API changes from Sonnet 5, including that forced tool use now errors.
- **Decision record, §4 cost table:**
    - Add a `claude-sonnet-5-5` row above `claude-sonnet-5`: price `2 / 10`, AA Intelligence (max) `56 (2026-10-05 scale)`, AA $/task `—`, output tokens `420M (2026-10-05)`, effort_cost_index `not published`.
    - Fill Opus 5.5's empty output-tokens cell with `260M (2026-10-05)`.
    - Leave the other rows' 2026-09-07 figures as they are.
- **Decision record, §4 defaults table:**
    - **Compliance review** → `claude-sonnet-5-5`, `medium`, previous `claude-sonnet-5`. Justification: same price per token, 41 vs 28 at `medium` on the 2026-10-05 index. Accepted loss: about 13% more output tokens on the max-effort index run (420M vs 370M); no per-effort figure exists. Opus 5.5 is still 2× per token.
    - **Code review and plan adjustment:** append "Re-checked 2026-10-05, unchanged: Sonnet 5.5 beats Opus 5.5 `high` (54) only at `max` (56), where Sonnet 5's cost index was 5.59× `high`, and it spent 420M index tokens against Opus 5.5's 260M."
    - **Plan extraction:** "Re-checked 2026-10-05, unchanged: still no newer Haiku."
- **Decision record, §6:** append `| 2026-10-05 | Claude Sonnet 5.5 (`sonnet` alias → Sonnet 5.5; Sonnet 5 kept active); GPT-6 Sol re-anchored Opus 5.5 → Sonnet 5.5 (`equivalent` at medium, else `downgrade`), Opus 5.5 left with no codex route; compliance default → Sonnet 5.5; planning skill recommends Sonnet 5.5 for mechanical phases | `phax/catalog-sonnet-5-5` |`.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `tests/unit/schemas/complianceReviewConfig.test.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `docs/model-catalog.md`
- `README.md`

### Optional files that may be edited

- `tests/unit/skills.test.ts`
- `tests/unit/loadConfig.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `src/cli/program.ts`

### Boundary contracts

Producer: `DEFAULT_COMPLIANCE_REVIEW_MODEL` names `claude-sonnet-5-5`, and `resolveComplianceReviewConfig` keeps effort `medium`.

Consumer: `phax review-compliance` and the per-phase compliance review, whenever neither `review.compliance` in `phax.json` nor `--model` overrides them.

### Test strategy

Update the constant-pinning test in `tests/unit/schemas/complianceReviewConfig.test.ts` first so that it fails, then change the constant. No new behaviour: the catalog-presence assertion already guarantees the id resolves.

### Implementation order

1. Pinning test.
2. Constant and its comment.
3. README line.
4. Planning-skill bullet.
5. `docs/model-catalog.md`: State described, §4 prose, cost table, defaults table, §6 row.

### Excluded scope

- Code review, plan adjustment, authoring and extraction defaults.
- Fixtures, examples and specs that use `claude-sonnet-5` as an arbitrary valid id.
- Running `pnpm test:e2e:real` or any live provider call.
- `docs/blog/announcing-phax-1.0.md`, and archived plans and specs.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final values of the four built-in defaults in §4, with their efforts: code review, plan adjustment, compliance review and plan extraction.
- The new text of the planning-skill mechanical-phases bullet.
- Whether any CLI help string or generated file changed. None is expected.
- **Post-merge check for the author, not run by any phase:** the gates never call a real provider, and Sonnet 5.5 changed API behaviour (forced tool use now errors). Run `pnpm test:e2e:real`, or one real `phax review-compliance` on a finished run, to confirm the new compliance default works against the live model.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(defaults): default compliance review and mechanical-phase guidance to Sonnet 5.5`

### Commit body

Sonnet 5.5 costs the same per token as Sonnet 5 ($2/$10) and scores 41
against 28 at medium on the 2026-10-05 Artificial Analysis Intelligence
Index. Point DEFAULT_COMPLIANCE_REVIEW_MODEL at claude-sonnet-5-5,
keeping effort medium, and have the phax-planning skill recommend it
for mechanical phases.

Code review and plan adjustment stay on Opus 5.5 high, and plan
extraction stays on Haiku 4.5 low. Rebuild the cost table in
docs/model-catalog.md and append the refresh-log row.
