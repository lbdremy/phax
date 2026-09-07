---
status: Approved
source-spec: null
approved:
  date: 2026-09-07
  baseline: 2a1eb37
---

# Catalog: Fable 5.1, Opus 5, GPT-6 Astra

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. No source spec: this is a catalog refresh, not a
> feature. Planned 2026-09-07 against `main` @ `2290717`.

Add the September 2026 model releases to the routing catalog so plans can name
them and the run-start preflight accepts them: **Claude Fable 5.1**
(`claude-fable-5-1`, released 2026-09-01) and **Claude Opus 5**
(`claude-opus-5`) on the `claude-code` provider, and **GPT-6 Astra**
(`gpt-6-astra`, released 2026-09-03) on the `codex-cli` provider, anchored to
Fable 5.1 through the Claude-hub equivalence table. Also advertise the
`ultracode` effort on every xhigh-capable Claude entry, since Claude Code gates
ultracode on xhigh support rather than on a specific model. No new family, no
new effort level, no schema change: the July catalog refresh (`0667c17`) already
introduced `claude-fable` and `ultra`, so phases 01–02 touch only
`DEFAULT_PROVIDER_CONFIG`, `DEFAULT_MODEL_ROUTING.equivalence`, their tests,
the generated planner catalog table, and the routing doc. A closing phase-03
re-points phax's own built-in defaults (code review, plan adjustment,
compliance review, plan extraction) to whichever catalog entry is now the most
cost-efficient for that job, using published per-token prices and generated
tokens as the energy proxy, since no provider publishes per-model energy.

---

## Required commands

- pnpm gen:model-catalog
- pnpm gen:usage-spec
- pnpm docs:cli

`pnpm gen:model-catalog` rewrites the marker-delimited catalog table in
`.claude/skills/phax-planning/SKILL.md` from `DEFAULT_PROVIDER_CONFIG`; the
`standard` gate runs it with `--check` every phase, so the table must be
regenerated in the same phase that edits the catalog. `pnpm gen:usage-spec`
regenerates `phax.usage.kdl` from the Commander tree and `pnpm docs:cli`
regenerates `docs/cli/reference.md` plus the README's generated CLI section
(it shells out to the `usage` binary); phase-03 needs both because it changes
`--model` help strings. All three commands and `usage` are already granted in
`security.agentCommands` in `phax.json`; no
`## Required PHAX security configuration changes` section is needed.

---

## Technical arbitrations

Resolved with the human on 2026-09-07; recorded so phases execute without
re-litigating them.

- **`gpt-6-astra` anchors to `claude-fable-5-1` straight across, with
  relation `downgrade`.** On the Artificial Analysis Intelligence Index
  (leaderboard read 2026-09-07) Astra scores 49/52/53/54/55 at
  low/medium/high/xhigh/max against Fable 5.1's 51/53/54/56/57 and Opus 5's
  44/50/52/53/54: Astra sits 1–2 points under Fable 5.1 at every effort, which
  is outside the ~1-point tolerance the July anchoring cited for `equivalent`.
  Hub-centric `downgrade` means a Fable 5.1 phase routed to Astra is labelled
  a downgrade and an Astra phase falling back to Fable 5.1 is an `upgrade`.
  Abandons: nothing in default routing (`allowDowngrade` defaults to `true`,
  so Fable 5.1 phases still reach codex when it is first in priority); users
  who set `allowDowngrade: false` keep Fable 5.1 phases on Claude. The
  alternative Opus 5 anchor (closest at high/xhigh/max, 5 points off at low)
  would have left Fable 5.1 with no codex route at all.
- **Every xhigh-capable Claude entry advertises `ultracode`**: the two new
  entries plus the existing `claude-fable-5` and `claude-sonnet-5`. Claude
  Code 2.1.263 refuses ultracode only when "the model / your organization does
  not allow xhigh effort", so the catalog should say the same. Abandons: a
  diff limited to the new entries; the July omission on Fable 5 / Sonnet 5
  could not be confirmed deliberate. `claude-opus-4-8` keeps ultracode;
  `claude-sonnet-4-6` (no xhigh) and Haiku do not gain it.
- **phax's own defaults are re-pointed in a closing phase, on cost.** First
  decided as catalog-only, then reversed by the human the same day: the
  defaults should follow the cheapest entry that does the job at least as well
  as today's. Abandons: a diff limited to the catalog; phase-03 also touches
  the CLI help strings, the generated usage spec and CLI reference, the README
  prose and the tests pinning the defaults. The per-default picks are
  recorded under "Cost basis for phase-03" in Context.
- **Energy is scored by generated tokens, not by a published figure.** As of
  2026-09-07 neither Anthropic nor OpenAI publishes per-model energy or carbon
  numbers (only aggregate data-centre figures); third-party estimates cover
  older models only. Inference energy scales with tokens generated, so
  phase-03 ranks candidates on output tokens per task (Artificial Analysis
  "verbosity" on the Intelligence Index run) and Claude Code's own
  `effort_cost_index`, alongside the per-token price. Abandons: an absolute
  Wh figure; the proxy only orders models, and a later disclosure could
  reorder them.

Decisions taken without a question (one viable option each):

- **Catalog order stays older-first** within a family (`claude-opus-4-8` then
  `claude-opus-5`; `claude-fable-5` then `claude-fable-5-1`; `gpt-6-astra`
  appended after the GPT-5.6 variants). `pickActiveEntry` in
  `src/domain/routing/resolve.ts` picks the *first* active entry of a family
  when the requested id is not in it (the `opus` / `gpt` heuristics), so
  prepending would silently change what an alias resolves to.
- **Astra's `ultra` anchors to Fable 5.1 `max`**, exactly as Sol/Terra's
  `ultra` anchor to their peer's `max`: `ultracode` stays Claude's exclusive
  ceiling and is never routed cross-provider (guarded by
  `tests/unit/routing/sameFamilyPreservation.test.ts`).
- **Nothing is deprecated.** Codex 0.153.4's bundled catalog still lists
  `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and `gpt-5.5` as
  `visibility: list` with no `upgrade` pointer (only the never-catalogued
  `gpt-5.4` / `gpt-5.4-mini` carry one). The account-served registry cached at
  `~/.codex/models_cache.json` on 2026-09-07 by the installed codex 0.144.3
  omits Sol, which reads as plan-tier visibility, not retirement. Claude Code
  still serves every Claude id in the catalog.

## Context

The routing layer is documented in `.claude/skills/model-routing/SKILL.md` and
`docs/model-routing.md`. `docs/model-catalog.md` (added 2026-09-07, alongside
this plan) is the standing decision record for the catalog: it already
describes the post-plan-59 state, with the new rows marked _plan 59_. Each
phase confirms the rows it lands match that file and removes the _plan 59_
marks for them; the refresh-log row flips from "pending" in phase-03. The catalog lives in `DEFAULT_PROVIDER_CONFIG` and the
hub-centric equivalence edges in `DEFAULT_MODEL_ROUTING.equivalence`, both in
`src/domain/routing/defaults.ts`. `equivalentFor` (`src/domain/routing/catalog.ts`)
does the star lookup: hub → spoke returns the stored relation, spoke → hub
inverts it (`downgrade ↔ upgrade`, `RELATION_INVERSE`). `resolveModel`
(`src/domain/routing/resolve.ts`) skips a cross-family edge whose relation is
`downgrade` or `no_equivalent` when `allowDowngrade` is `false`, both in the
priority walk (`tryProviderCrossFamily`) and in the terminal claude-code
fallback (`terminalClaudeCode`). `preflightPhaseModels`
(`src/domain/routing/preflight.ts`) applies the same rule in
`hasPermittedCrossFamilyRoute`.

### Provider facts (verified 2026-09-07)

- **Claude Code 2.1.263** (`~/.local/bin/claude`) embeds a model table with
  `claude-opus-5` (capabilities include `effort`, `max_effort`,
  `xhigh_effort`) and `claude-fable-5-1` (same, plus `per_turn_effort`); its
  `latest_per_family` map is `fable: claude-fable-5-1, opus: claude-opus-5,
  sonnet: claude-sonnet-5, haiku: claude-haiku-4-5`. Both new ids therefore
  take `low | medium | high | xhigh | max`, the same ladder as `claude-fable-5`
  and `claude-sonnet-5`. Ultracode is implemented as xhigh + dynamic
  workflows and is refused only when xhigh is not allowed.
- **Codex 0.153.4** (npm `@openai/codex`, published 2026-09-04) bundles
  `gpt-6-astra` with `supported_reasoning_levels`
  `low | medium | high | xhigh | max | ultra`, `default_reasoning_level: low`,
  `visibility: list`, `priority: 1`, `minimal_client_version: "0.153.0"`.
  Sol and Terra keep the same six-level ladder; Luna caps at `max`; `gpt-5.5`
  caps at `xhigh`. The installed codex on this machine is **0.144.3**, which
  predates Astra: `docs/model-routing.md` must say Astra needs codex ≥ 0.153.0
  and the e2e tier (`pnpm test:e2e:real`) is not part of this plan.
- **Artificial Analysis Intelligence Index** (leaderboard read 2026-09-07,
  used for the anchoring arbitration above): GPT-6 Astra 49/52/53/54/55,
  Claude Fable 5.1 51/53/54/56/57, Claude Opus 5 44/50/52/53/54 at
  low/medium/high/xhigh/max; Claude Fable 5 53 (single entry); Sonnet 5 max
  45. The July commit anchored on the Agentic Index, which no longer exposes
  per-model numbers; the Intelligence Index is the axis available today and
  gives per-effort points, which is what straight-across anchoring needs.

### Cost basis for phase-03 (read 2026-09-07)

Per-token prices are Claude Code 2.1.263's embedded `pricing` tiers (identical
to Anthropic's list prices). `effort_cost_index` is Claude Code's relative
token-spend multiplier per effort for that model (`high` = 1). Intelligence
Index, cost per task and output tokens are from the Artificial Analysis model
pages for the max-effort variant; AA's cost-per-task figures come from
different index revisions and are not comparable across models (Opus 5 costs
more per task than Opus 4.8 at the same price and fewer tokens), so they are
listed but not used to rank.

| Candidate | $/1M in / out | AA Intelligence (max) | AA $/task | Output tokens on index run | effort_cost_index low / medium / high |
| --- | --- | --- | --- | --- | --- |
| `claude-opus-4-8` (current review + adjust-plan) | 5 / 25 | 48 | 2.60 | 130M | 0.72 / 0.90 / 1 |
| `claude-opus-5` | 5 / 25 | 54 | 4.21 | 120M | 0.67 / 0.76 / 1 |
| `claude-fable-5-1` | 10 / 50 | 57 | 6.12 | 160M | 0.60 / 0.77 / 1 |
| `claude-sonnet-4-6` (current compliance) | 3 / 15 | 29 | n/a (AA lists it deprecated) | n/a | 0.47 / 0.74 / 1 |
| `claude-sonnet-5` | 2 / 10 | 45 | 3.31 | 320M | 0.47 / 0.74 / 1 |
| `claude-haiku-4-5-20251001` (current extract-plan) | 1 / 5 | — | — | — | no effort ladder |

Picks (each has one viable option under the "cheapest that does the job at
least as well" rule):

- **Code review** (`DEFAULT_CODE_REVIEW_MODEL`, effort `high`):
  `claude-opus-4-8` → `claude-opus-5`. Same per-token price, +6 index points,
  fewer generated tokens (120M vs 130M) and a cheaper `low`/`medium` curve.
  `claude-fable-5-1` is rejected: twice the per-token price and a third more
  tokens for +3 points.
- **Plan adjustment** (`adjustPlan` `DEFAULT_MODEL`, effort `high`):
  `claude-opus-4-8` → `claude-opus-5`, same reasoning.
- **Compliance review** (`DEFAULT_COMPLIANCE_REVIEW_MODEL`, effort
  `medium`): `claude-sonnet-4-6` → `claude-sonnet-5`. A third cheaper per
  token, +16 points, identical effort-cost curve, and AA already marks
  Sonnet 4.6 deprecated. The effort stays `medium`: Sonnet 5's 320M tokens at
  `max` (2.7× Opus 5) is the one place the energy proxy bites, and `medium`
  sits at 0.74 of `high`.
- **Plan extraction** (`DEFAULT_EXTRACT_MODEL`, effort `low`): unchanged.
  Claude Code's `latest_per_family` still maps `haiku` to Haiku 4.5, so there
  is no newer Haiku; the next cheapest entry, `claude-sonnet-5` at `low`, is
  twice the per-token price for a structured-extraction job Haiku already
  passes. `docs/extract-plan-model.md`'s "retry with a stronger model" example
  moves from Sonnet 4.6 to Sonnet 5.

### Architecture seams (audited 2026-09-07 against `main` @ `2290717`)

- **Catalog and edges**: `src/domain/routing/defaults.ts` only. `ModelFamily`,
  `ThinkingLevel`, every effort schema (`src/schemas/modelRouting.ts`,
  `src/schemas/phaxPlan.ts`, `src/schemas/status.ts`,
  `src/domain/plan/parsePlanMarkdown.ts`), the CLI `--effort` help
  (`src/cli/commands/agent.ts`, `phax.usage.kdl`, `docs/cli/reference.md`),
  `CLAUDE_FAMILIES` in `catalog.ts` and the `fable` heuristic in `resolve.ts`
  already cover the new ids: **do not touch them**.
- **Generated table**: `scripts/generate-model-catalog.ts` rewrites
  `.claude/skills/phax-planning/SKILL.md` between
  `<!-- BEGIN generated: model-catalog -->` / `<!-- END … -->`; rows follow
  config order, no sorting. `tests/unit/generateModelCatalog.test.ts` uses its
  own fixture config and is unaffected. `tests/unit/skills.test.ts` asserts
  the skill file names specific ids.
- **Tests pinned to the default catalog**: `tests/unit/routing/effortLevels.test.ts`
  (per-entry effort lists and the "every catalog entry is marked status
  active" id list), `tests/unit/routing/catalog.test.ts` (`familyOfId`,
  `effortsFor`, `isClaudeFamily` "all three", `equivalentFor` star lookups
  on `DEFAULT_MODEL_ROUTING`), `tests/unit/routing/resolve.test.ts`
  (native and hub translations, `downgrade` handling with a custom table at
  `:147-190`), `tests/unit/routing/sameFamilyPreservation.test.ts`
  (ultracode never leaves Claude), `tests/unit/routing/preflight.test.ts`
  (`allowDowngrade` route checks at `:268-340`),
  `tests/unit/routing/schemas.test.ts` (decodes the shipped defaults).
- **Docs**: `docs/model-routing.md` "Model families" table (`:5-15`) still
  says five families and lacks `claude-fable`; the valid-effort line (`:46`)
  lacks `ultra`; worked examples at `:167-210`. The model-routing skill's
  `isClaudeFamily` row (`.claude/skills/model-routing/SKILL.md`) also predates
  `claude-fable`.
- **Built-in defaults** (phase-03): `DEFAULT_COMPLIANCE_REVIEW_MODEL`
  (`src/schemas/phaxConfig.ts:115`, effort `medium` at `:123`),
  `DEFAULT_EXTRACT_MODEL` (`:170`), `DEFAULT_CODE_REVIEW_MODEL` (`:177`,
  effort `high` at `:186`), and `adjustPlan`'s private `DEFAULT_MODEL`
  (`src/cli/commands/adjustPlan.ts:25`). The `--model` help strings in
  `src/cli/program.ts:291,317` name `claude-opus-4-8` and flow into
  `phax.usage.kdl` (`pnpm gen:usage-spec`) and `docs/cli/reference.md` plus
  the README's generated CLI block (`pnpm docs:cli`). README prose at `:277`
  and `:288` names the review defaults by hand; `docs/extract-plan-model.md`
  names Haiku and the Sonnet 4.6 retry example. Tests pin the defaults through
  the exported constants (`tests/unit/loadConfig.test.ts:308,328`,
  `tests/unit/schemas/complianceReviewConfig.test.ts:62,69`), never by
  literal, and the integration fixtures that mention `claude-opus-4-8` /
  `claude-sonnet-4-6` set the model explicitly; no snapshot embeds a default.
- **Plan runtime**: phases resolve on this machine through `claude-code`
  only (codex and vibe ship `enabled: false`); every id this plan adds is
  exercised by unit tests, never by a live provider call.

---

## phase-01 — Claude catalog: Fable 5.1, Opus 5 and ultracode {#phase-01-claude-catalog}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Register `claude-fable-5-1` and `claude-opus-5` on the `claude-code` provider
and advertise `ultracode` on every xhigh-capable Claude entry, so a plan can
name the current-generation Claude models at any effort Claude Code accepts
and the preflight lets it run.

### Detailed instructions

- **Catalog** (`src/domain/routing/defaults.ts`, `DEFAULT_PROVIDER_CONFIG`,
  provider `claude-code`):
  - `claude-sonnet` → `claude-sonnet-5`: efforts become
    `["low", "medium", "high", "xhigh", "max", "ultracode"]`.
    `claude-sonnet-4-6` is unchanged (no xhigh, no ultracode).
  - `claude-opus` → append after `claude-opus-4-8`:
    `{ id: "claude-opus-5", efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"], status: "active" }`.
  - `claude-fable` → `claude-fable-5` gains `"ultracode"` at the end of its
    efforts; append
    `{ id: "claude-fable-5-1", efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"], status: "active" }`.
  - Keep the older entry first in each family (see the order decision in
    Technical arbitrations). Do not touch `claude-haiku`, the equivalence
    table, or `requestedModelNormalization` (`fable` → `claude-fable` already
    exists).
  - Add a short comment above the `claude-code` families stating that
    `ultracode` is listed on every entry that supports `xhigh`, because Claude
    Code gates ultracode on xhigh support (verified against 2.1.263).
- **Regenerate** the planner catalog table with `pnpm gen:model-catalog` and
  commit the rewritten `.claude/skills/phax-planning/SKILL.md`. Do not
  hand-edit the region; `pnpm gen:model-catalog --check` in the gate must pass.
- **Decision record** (`docs/model-catalog.md`, section 2, claude-code
  table): confirm the `claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`
  and `claude-sonnet-5` rows match what you committed and drop their
  _plan 59_ marks; leave the codex rows and the refresh log untouched.
- **Doc** (`docs/model-routing.md`, "Model families"): change "Five families"
  to "Six families" and add the row
  `| \`claude-fable\` | claude-code, codex-cli (equivalent) |` between
  `claude-opus` and `mistral-medium` (Sol already anchors to Fable 5; phase-02
  adds Astra). In the "Versioned catalog" JSON excerpt, add the
  `claude-opus-5` entry next to `claude-opus-4-8` so the example shows two
  versions of one family carrying their own effort sets.
- **Tests**:
  - `tests/unit/routing/effortLevels.test.ts`: add `it`s asserting
    `effortsFor("claude-opus-5")`, `effortsFor("claude-fable-5-1")`,
    `effortsFor("claude-fable-5")` and `effortsFor("claude-sonnet-5")` equal
    `["low", "medium", "high", "xhigh", "max", "ultracode"]`, and that
    `claude-sonnet-4-6` still lacks `xhigh` and `ultracode`; add the two new
    ids (and `claude-sonnet-5`, `claude-fable-5`) to the "every catalog entry
    is marked status active" list.
  - `tests/unit/routing/catalog.test.ts`: `familyOfId("claude-fable-5-1")`
    → `claude-fable`, `familyOfId("claude-opus-5")` → `claude-opus`; extend
    the `isClaudeFamily` test to cover `claude-fable` (rename "all three" to
    "all four").
  - `tests/unit/routing/resolve.test.ts`: `claude-opus-5` / `xhigh` and
    `claude-fable-5-1` / `ultracode` with claude-only priority resolve to
    `claude-code`, same id, same effort, relationship `exact`;
    `claude-opus-4-8` / `ultracode` keeps resolving to `claude-opus-4-8`
    (older-first order preserved).
  - `tests/unit/routing/sameFamilyPreservation.test.ts`: add
    `claude-fable-5-1` / `ultracode` and `claude-sonnet-5` / `ultracode` to
    the "never silently downgrades ultracode to a non-Claude provider" guard
    with mistral+codex priority and all providers enabled: selected provider
    is `claude-code`, family is the requested one, thinking is `ultracode`.
  - `tests/unit/skills.test.ts` "lists all valid model IDs": add
    `claude-fable-5-1` and `claude-opus-5`.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `docs/model-routing.md`
- `docs/model-catalog.md`
- `tests/unit/routing/effortLevels.test.ts`
- `tests/unit/routing/catalog.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`
- `tests/unit/skills.test.ts`

### Optional files that may be edited

- `.claude/skills/model-routing/SKILL.md`
- `tests/unit/routing/preflight.test.ts`

### Boundary contracts

Producer: `DEFAULT_PROVIDER_CONFIG` in `src/domain/routing/defaults.ts` now
contains `claude-opus-5` and `claude-fable-5-1` with the six-effort ladder.
Consumer: phase-02's equivalence edges point at `claude-fable-5-1` by id and
effort and rely on `xhigh` and `max` being present on that entry.

### Test strategy

Domain-layer unit tests only, written before the catalog edit: the effort-list
assertions and the ultracode guard fail on the current catalog and pass after.
No integration or e2e test is needed; no adapter changes.

### Implementation order

1. Write the failing tests (effort lists, `familyOfId`, resolve, guard).
2. Edit `DEFAULT_PROVIDER_CONFIG`.
3. `pnpm gen:model-catalog`; confirm `--check` is clean.
4. Doc table and JSON excerpt; skills test.

### Excluded scope

- `gpt-6-astra` and any equivalence edge (phase-02).
- Re-pointing `DEFAULT_CODE_REVIEW_MODEL`, `DEFAULT_COMPLIANCE_REVIEW_MODEL`,
  `DEFAULT_EXTRACT_MODEL` or the `adjustPlan` default (phase-03).
- Deprecating any entry.

### Verification

- The project's configured `standard` gate profile in `phax.json`
  (includes `pnpm gen:model-catalog --check`).

### Expected handoff content

- The exact `claude-opus` and `claude-fable` model arrays as committed, so
  phase-02 can quote `claude-fable-5-1`'s effort ladder verbatim.
- Confirmation that `pnpm gen:model-catalog --check` passed and which rows the
  generated table gained.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): add Claude Fable 5.1 and Opus 5, advertise ultracode on xhigh-capable entries

### Commit body

Register claude-fable-5-1 and claude-opus-5 on the claude-code provider with
the low|medium|high|xhigh|max|ultracode ladder, and list ultracode on
claude-fable-5 and claude-sonnet-5 as well: Claude Code gates ultracode on
xhigh support, not on a specific model. Older entries stay first in each
family so alias resolution is unchanged. Regenerates the planner catalog table
and adds the claude-fable row to the routing doc's family table.

---

## phase-02 — Codex catalog: GPT-6 Astra anchored to Fable 5.1 {#phase-02-codex-astra}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Register `gpt-6-astra` on the `codex-cli` provider and anchor each of its
efforts to `claude-fable-5-1` with a hub-centric `downgrade` relation, so an
Astra phase resolves natively when codex is enabled, falls back to Fable 5.1
as an `upgrade` when it is not, and a Fable 5.1 phase can reach codex only
under `allowDowngrade: true`.

### Detailed instructions

- **Catalog** (`src/domain/routing/defaults.ts`, `DEFAULT_PROVIDER_CONFIG`,
  provider `codex-cli`, family `openai-gpt`): append after `gpt-5.6-luna`:
  `{ id: "gpt-6-astra", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], status: "active" }`.
  Leave the four existing entries unchanged.
- **Equivalence** (`DEFAULT_MODEL_ROUTING.equivalence`): add a `"gpt-6-astra"`
  block after `"gpt-5.6-luna"`:
  - `low`, `medium`, `high`, `xhigh`, `max` → `{ claude: "claude-fable-5-1", effort: <same>, relation: "downgrade" }`.
  - `ultra` → `{ claude: "claude-fable-5-1", effort: "max", relation: "downgrade" }`.
  - Leave the existing GPT-5.6 comment untouched and add a new comment above
    the Astra block: anchored straight across to Fable 5.1
    on the Artificial Analysis Intelligence Index read 2026-09-07 (Astra
    49/52/53/54/55 vs Fable 5.1 51/53/54/56/57 at low/medium/high/xhigh/max),
    1–2 points under at every effort, hence hub-centric `downgrade`: Fable 5.1
    → Astra is a downgrade, Astra → Fable 5.1 an upgrade; `ultra` anchors to
    `max` so `ultracode` stays Claude-only.
- **Regenerate** the planner catalog table with `pnpm gen:model-catalog`.
- **Decision record** (`docs/model-catalog.md`): confirm the `gpt-6-astra`
  row in section 2 and the Astra anchor row in section 3 match what you
  committed (ids, efforts, relation, the index numbers) and drop their
  _plan 59_ marks.
- **Docs** (`docs/model-routing.md`):
  - Valid effort values line: append `| ultra`.
  - "Claude-hub equivalence table": after the JSON excerpt, add one sentence
    noting that the shipped table uses `downgrade` for `gpt-6-astra` →
    `claude-fable-5-1`, so under `allowDowngrade: false` Fable 5.1 phases stay
    on Claude while Astra phases still fall back to Fable 5.1 (an `upgrade`).
  - "Default provider config": add one sentence that `gpt-6-astra` requires
    codex ≥ 0.153.0 (its `minimal_client_version`).
  - Worked examples: add "Example 6 — gpt-6-astra/ultra, codex-cli disabled
    (spoke → hub upgrade)" in the style of Example 3's fallback paragraph:
    request `gpt-6-astra` / `ultra`, plan family `openai-gpt` (catalog
    lookup), codex disabled, terminal translates `equivalence["gpt-6-astra"]["ultra"]`
    → `{claude: "claude-fable-5-1", effort: "max"}` with relation inverted to
    `upgrade`; result `claude-code`, `claude-fable-5-1`, `max`, `upgrade`.
- **Tests**:
  - `tests/unit/routing/effortLevels.test.ts`: `effortsFor("gpt-6-astra")`
    equals the six-level ladder; add `gpt-6-astra` to the active-status list.
  - `tests/unit/routing/catalog.test.ts` (`equivalentFor` on
    `DEFAULT_MODEL_ROUTING`): hub → spoke
    `equivalentFor("claude-fable-5-1", "xhigh", "openai-gpt")` →
    `{ id: "gpt-6-astra", effort: "xhigh", relation: "downgrade" }`;
    spoke → hub `equivalentFor("gpt-6-astra", "max", "claude-fable")` →
    `{ id: "claude-fable-5-1", effort: "max", relation: "upgrade" }`;
    `equivalentFor("gpt-6-astra", "ultra", "claude-fable")` → `max` /
    `upgrade`; `equivalentFor("claude-fable-5-1", "ultracode", "openai-gpt")`
    → `undefined`.
  - `tests/unit/routing/resolve.test.ts`, using the file's existing
    `codexPriority` / `allEnabled` fixtures:
    - `gpt-6-astra` / `ultra` with codex first and enabled → `codex-cli`,
      `gpt-6-astra`, `ultra`, `exact`.
    - `gpt-6-astra` / `high` against `DEFAULT_PROVIDER_CONFIG` (codex
      disabled) → `claude-code`, `claude-fable-5-1`, `high`, `upgrade`.
    - `claude-fable-5-1` / `high` with codex first, enabled,
      `allowDowngrade: true` → `codex-cli`, `gpt-6-astra`, `high`,
      `downgrade`.
    - same request with `allowDowngrade: false` → `claude-code`,
      `claude-fable-5-1`, `high`, `exact`.
  - `tests/unit/routing/preflight.test.ts`: a phase on `gpt-6-astra` /
    `ultra` with codex disabled and `allowDowngrade: false` produces no
    failure (the only route to Claude is an `upgrade`), mirroring the
    existing "passes when allowDowngrade is false but the equivalence is
    equivalent" case.
  - `tests/unit/routing/sameFamilyPreservation.test.ts`: assert
    `claude-fable-5-1` / `ultracode` with codex first and enabled still
    resolves to `claude-code` (Astra has no `ultracode` edge).
  - `tests/unit/skills.test.ts` "lists all valid model IDs": add
    `gpt-6-astra`.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `docs/model-routing.md`
- `docs/model-catalog.md`
- `tests/unit/routing/effortLevels.test.ts`
- `tests/unit/routing/catalog.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/preflight.test.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`
- `tests/unit/skills.test.ts`

### Optional files that may be edited

- `.claude/skills/model-routing/SKILL.md`
- `tests/unit/routing/schemas.test.ts`

### Boundary contracts

Consumer: the Astra edges reference `claude-fable-5-1` at `low` … `max`,
produced by phase-01. Producer: the shipped `DEFAULT_MODEL_ROUTING` now
contains a `downgrade` edge; `resolveModel` and `preflightPhaseModels` already
implement the `allowDowngrade` floor for it, so no resolver change.

### Test strategy

Domain-layer unit tests, written first: the four `resolve` cases and the
`equivalentFor` lookups fail on the current table and pass after. The
`allowDowngrade: false` cases are the behaviour that distinguishes this edge
from every existing `equivalent` one and must be pinned. No live codex call
(installed codex predates Astra; e2e is out of scope).

### Implementation order

1. Failing tests (`equivalentFor`, `resolve`, `preflight`, guard).
2. Catalog entry, then the equivalence block and its comment.
3. `pnpm gen:model-catalog`; confirm `--check` is clean.
4. Doc edits (effort line, equivalence note, codex version, Example 6).

### Excluded scope

- Any change to `claude-code` catalog entries (phase-01).
- Deprecating `gpt-5.6-sol` or any other entry.
- Re-anchoring the GPT-5.6 variants (Sol stays on Fable 5, Terra on Opus 4.8,
  Luna on Sonnet 5).
- Changes to `resolveModel`, `preflightPhaseModels`, schemas, or the codex
  adapter in `src/infra/providers/codexCli.ts`.

### Verification

- The project's configured `standard` gate profile in `phax.json`
  (includes `pnpm gen:model-catalog --check`).

### Expected handoff content

- The committed `"gpt-6-astra"` equivalence block verbatim.
- The four `resolve` outcomes as observed (provider, id, effort, relationship)
  so the reviewer can check the `downgrade` / `upgrade` labelling without
  re-running.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): add GPT-6 Astra anchored to Fable 5.1 as a downgrade

### Commit body

Register gpt-6-astra on the codex-cli provider with the
low|medium|high|xhigh|max|ultra ladder read from codex 0.153.4's bundled
catalog, and anchor every effort straight across to claude-fable-5-1 with a
hub-centric downgrade relation (Astra trails Fable 5.1 by 1-2 points at every
effort on the Artificial Analysis Intelligence Index); ultra anchors to max so
ultracode stays Claude-only. Under allowDowngrade:false a Fable 5.1 phase now
stays on Claude while an Astra phase still falls back to Fable 5.1 as an
upgrade. Regenerates the planner catalog table and documents the edge, the
codex >= 0.153.0 requirement, and a worked fallback example.

---

## phase-03 — Re-point built-in defaults on cost {#phase-03-defaults-on-cost}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Move phax's built-in review, plan-adjustment and compliance defaults to the
catalog entries phase-01 registered, following the picks in "Cost basis for
phase-03": `claude-opus-5` for code review and plan adjustment (same price as
Opus 4.8, fewer tokens, stronger), `claude-sonnet-5` for compliance review (a
third cheaper than Sonnet 4.6), Haiku 4.5 unchanged for plan extraction.
Efforts are unchanged. Users who set `review.code`, `review.compliance` or
`agent.extractPlan` in `phax.json` are unaffected.

### Detailed instructions

- **Constants**:
  - `src/schemas/phaxConfig.ts`: `DEFAULT_COMPLIANCE_REVIEW_MODEL =
    "claude-sonnet-5"`, `DEFAULT_CODE_REVIEW_MODEL = "claude-opus-5"`.
    `DEFAULT_EXTRACT_MODEL` stays `"claude-haiku-4-5-20251001"`. Leave the
    `effort` fallbacks (`"medium"`, `"high"`) as they are.
  - `src/cli/commands/adjustPlan.ts`: `DEFAULT_MODEL = "claude-opus-5"`;
    `DEFAULT_EFFORT` stays `"high"`.
  - Above each changed constant add a one-line comment naming the basis:
    "same per-token tier as Opus 4.8, fewer generated tokens" for Opus 5,
    "$2/$10 vs Sonnet 4.6's $3/$15, same effort curve" for Sonnet 5, so the
    next refresh can re-check the numbers rather than the reasoning.
- **Help strings** (`src/cli/program.ts:291,317`): replace `claude-opus-4-8`
  with `claude-opus-5` in both `--model` descriptions. Then run
  `pnpm gen:usage-spec` and `pnpm docs:cli` and commit the regenerated
  `phax.usage.kdl`, `docs/cli/reference.md` and README generated block. Do
  not hand-edit the generated files; `pnpm format:check` must stay clean.
- **README prose**: `README.md:277` (review-code default "else
  `claude-opus-4-8` at `high` effort" → `claude-opus-5`) and `:288`
  (compliance default `claude-sonnet-4-6` → `claude-sonnet-5`). Leave the
  `phax agent resolve --model claude-sonnet-4-6` example at `:343` alone; it
  is a routing example, not a default.
- **`docs/extract-plan-model.md`**: keep the Haiku default text; change the
  "retrying with a stronger model" example and the config excerpt from
  `claude-sonnet-4-6` to `claude-sonnet-5` (effort `medium` unchanged).
- **Decision record** (`docs/model-catalog.md`): confirm the defaults table
  in section 4 matches the committed constants, drop the remaining _plan 59_
  marks and the "after plan 59" wording in the state line, and change the
  2026-09-07 refresh-log row from "plan 59 (pending until it lands)" to the
  plan's run branch or merge commit.
- **Tests** (pin the new values by literal so a silent revert fails the gate):
  - `tests/unit/loadConfig.test.ts`: next to the existing
    `codeReview.model` assertions, add
    `expect(DEFAULT_CODE_REVIEW_MODEL).toBe("claude-opus-5")` and
    `expect(DEFAULT_EXTRACT_MODEL).toBe("claude-haiku-4-5-20251001")`, plus
    an assertion that both ids are present in `DEFAULT_PROVIDER_CONFIG` via
    `entryFor` (imports from `src/domain/routing/catalog.js` and
    `defaults.js`) so a default can never name an id the preflight rejects.
  - `tests/unit/schemas/complianceReviewConfig.test.ts`: add
    `expect(DEFAULT_COMPLIANCE_REVIEW_MODEL).toBe("claude-sonnet-5")` and the
    same `entryFor` presence check.
  - New `tests/unit/cli/adjustPlanDefaults.test.ts`: `adjustPlan.ts` exports
    only `runAdjustPlan(opts)` and `AdjustPlanCommandOptions` (registration
    lives in `src/cli/program.ts:312`). Call `runAdjustPlan` with `model` and
    `effort` absent, mocking the app use case module the way
    `tests/unit/cli/reviewCompliance.test.ts` mocks its module, and assert the
    model/effort handed to the use case are `claude-opus-5` / `high`. If the
    mock seam proves awkward, export `DEFAULT_MODEL` / `DEFAULT_EFFORT` from
    `adjustPlan.ts` and assert on them directly (knip must still pass: an
    export used only by a test counts as used).

### Planned files to create

- `tests/unit/cli/adjustPlanDefaults.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/cli/commands/adjustPlan.ts`
- `src/cli/program.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `docs/extract-plan-model.md`
- `docs/model-catalog.md`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/schemas/complianceReviewConfig.test.ts`

### Optional files that may be edited

- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `src/cli/cliDocs.ts`

### Boundary contracts

Consumer: the new defaults name `claude-opus-5` and `claude-sonnet-5`, which
must exist in `DEFAULT_PROVIDER_CONFIG` with efforts `high` and `medium`
respectively (phase-01 added Opus 5; Sonnet 5 was already present). Producer:
`resolveCodeReviewConfig`, `resolveComplianceReviewConfig` and `loadConfig`
keep their signatures; only the fallback values change.

### Test strategy

Unit tests first: the literal assertions fail on the current constants and
pass after. The `entryFor` presence checks tie the defaults to the catalog so
future catalog pruning cannot strand a default. Integration tests set models
explicitly and need no change; touch them only if one turns out to rely on
the fallback.

### Implementation order

1. Failing unit tests (constants, catalog presence, adjust-plan default).
2. Constants and help strings.
3. `pnpm gen:usage-spec`, `pnpm docs:cli`; README prose; extract-plan doc.

### Excluded scope

- Changing any default effort.
- Changing `DEFAULT_EXTRACT_MODEL`.
- Adding a `review.adjustPlan` config block (adjust-plan keeps its CLI-only
  default).
- Any catalog or equivalence change (phases 01–02).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The four resolved defaults (model + effort) as committed, and the exact
  commands used to regenerate the usage spec and CLI reference.
- Whether `adjustPlan.ts` needed a new export to be testable.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(config): default reviews and plan adjustment to Opus 5 and Sonnet 5

### Commit body

Code review and plan adjustment now default to claude-opus-5 at high effort
(same per-token tier as Opus 4.8, fewer generated tokens, higher benchmark
scores) and compliance review to claude-sonnet-5 at medium (a third cheaper
per token than Sonnet 4.6 with the same effort curve). Plan extraction stays
on Haiku 4.5, the cheapest tier with no newer sibling. Explicit phax.json
settings are unaffected. Help strings, the generated usage spec, CLI
reference, README and extract-plan doc follow; unit tests pin the new
defaults and check each one exists in the routing catalog.
