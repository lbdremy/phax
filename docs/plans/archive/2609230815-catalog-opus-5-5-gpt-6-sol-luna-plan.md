---
status: Completed
source-spec: null
approved:
  date: 2026-09-23
  baseline: 60d4183
---

# Catalog: Opus 5.5, GPT-6 Sol and Luna

> Feed this `plan.md` to `phax extract-plan` to produce `phax-plan.json`, then
> run it with `phax run`. No source spec: this is a catalog refresh, not a
> feature. Planned 2026-09-23 against `main` @ `a733f85e`.

Add the late-September 2026 releases to the routing catalog and make Opus 5.5
the model phax reaches for by default.

- **Claude Opus 5.5** (`claude-opus-5-5`) joins the `claude-code` provider.
  It is cheaper per token than Opus 5 ($4/$20 against $5/$25) and scores
  above Fable 5.1 from medium effort up.
- **Family order flips to newest-first.** The `opus` alias then resolves to
  Opus 5.5, and `sonnet` / `fable` resolve to Sonnet 5 / Fable 5.1.
- **GPT-6 Sol** (`gpt-6-sol`) and **GPT-6 Luna** (`gpt-6-luna`) join the
  `codex-cli` provider.
- **The three GPT-5.6 variants become `deprecated`.** Codex's own catalog now
  points each of them at a GPT-6 replacement.
- **GPT-6 Astra becomes `equivalent` to Fable 5.1** instead of `downgrade`.
- **Opus 5.5 becomes the default** for code review and plan adjustment, and
  the phax-planning skill recommends it as the default phase model.

`claude-opus-5` stays `active`. The plan adds no family, no effort level and
no schema change. The only logic change is a single guard in the hub → spoke
lookup, so that it skips deprecated spokes.

---

## Required commands

- pnpm gen:model-catalog
- pnpm gen:usage-spec
- pnpm docs:cli

`pnpm gen:model-catalog` rewrites the marker-delimited catalog table in
`.claude/skills/phax-planning/SKILL.md` from `DEFAULT_PROVIDER_CONFIG`, in
config order. The `standard` gate runs it with `--check`, so phases 01 and 02
must regenerate it. `pnpm gen:usage-spec` regenerates `phax.usage.kdl` and
`pnpm docs:cli` regenerates `docs/cli/reference.md`. Phase-03 needs both
because it changes two `--model` help strings. All three are already granted
in `security.agentCommands` in `phax.json`.

---

## Technical arbitrations

Resolved with the human on 2026-09-23.

- **The `opus` alias must resolve to Opus 5.5: families are listed
  newest-first.** `pickActiveEntry` (`src/domain/routing/resolve.ts`)
  resolves an id that is not in the catalog (the `opus` / `sonnet` / `fable`
  / `gpt` aliases, heuristic matches, the terminal Sonnet fallback) to the
  *first* active entry of its family. The plan keeps that rule and reverses
  the order inside every versioned family (Claude families, `openai-gpt`),
  so the first active entry is the current model. Accepted loss: the
  append-only convention. Every future refresh prepends new models, and the
  planner table's row order flips. The rejected alternative ("last active
  entry") would have moved a bare `mistral` request from `-off` to `-max`,
  because Mistral's entries are one per effort, not versions. Mistral keeps
  its order.
- **`gpt-6-sol` anchors to `claude-opus-5-5` straight across, relation
  `downgrade`.** Sol (34/40/43/44/48) sits between Sonnet 5 (24…38) and
  Opus 5.5 (42…58), with no Claude model within a point of it. Accepted loss:
  an honest label at low and medium (8–11 points under). In exchange Opus 5.5,
  the new default phase model, gets a codex route under `allowDowngrade: true`
  (the default) and stays on Claude under `false`.
- **`gpt-6-astra` → `claude-fable-5-1` becomes `equivalent` at every
  effort.** On today's index Astra is 46/50/51/52/53 and Fable 5.1 is
  47/49/51/53/53, within 1 point everywhere. Accepted loss: nothing. Plan
  59's `downgrade` came from an older index revision.
- **Compliance review stays on `claude-sonnet-5` / `medium`.** Opus 5.5 at
  `low` scores higher, but it costs twice as much per token on a pass that
  runs after every phase. Accepted loss: a stronger default compliance
  reviewer.
- **`claude-opus-5` stays `active`.** The human asked to keep it, and Claude
  Code 2.1.280 still serves it.

Decisions taken without a question (only one viable option each):

- **GPT-5.6 Sol, Terra and Luna become `status: "deprecated"`.** Codex
  0.156.1's bundled catalog gives each an `upgrade` pointer (Sol and Terra →
  `gpt-6-sol`, Luna → `gpt-6-luna`), and the refresh checklist
  (`docs/model-catalog.md` §5.1) says a retired id is deprecated, never
  deleted. Their equivalence edges stay, so a deprecated spoke can still fall
  back to Claude (spoke → hub).
- **The hub → spoke lookup skips deprecated spokes.** `hubToSpoke`
  (`src/domain/routing/catalog.ts`) returns the first matching edge in the
  equivalence table's insertion order and never checks status. Without the
  guard, a Sonnet 5 phase would still route to the deprecated `gpt-5.6-luna`
  rather than `gpt-6-luna`, and `preflightPhaseModels` would count a
  deprecated spoke as a valid route. With the guard, Fable 5 and Opus 4.8
  lose the routes they had through the deprecated Sol and Terra. Opus 4.8
  keeps its `gpt-5.5` xhigh edge.
- **`gpt-6-luna` anchors to `claude-sonnet-5` straight across.** Luna is
  21/29/32/34/37 and Sonnet 5 is 24/28/32/34/38. That gives `equivalent` at
  medium/high/xhigh/max, and `downgrade` at `low` (3 under).
- **`ultra` anchors to the peer's `max`** for Sol, as it already does for
  Astra and the GPT-5.6 variants, so `ultracode` stays Claude-only.
- **`gpt-5.5` stays active**: it has no `upgrade` pointer in 0.156.1.
- **Plan extraction stays on Haiku 4.5 / `low`.** There is no newer Haiku.
- **This plan's own phases name only models already in the shipped
  catalog** (`claude-sonnet-5`, `claude-opus-5`). The run-start preflight
  checks phases against the catalog of the phax binary running the plan,
  which does not know `claude-opus-5-5` yet.

## Context

The routing layer is documented in `.claude/skills/model-routing/SKILL.md` and
`docs/model-routing.md`. `docs/model-catalog.md` is the standing decision
record: sources (§1), entries (§2), anchors (§3), cost basis and defaults
(§4), refresh checklist (§5), refresh log (§6). Every catalog or default change
updates it in the same commit. The previous refresh,
`docs/plans/archive/2609070832-catalog-fable-5-1-opus-5-gpt-6-astra-plan.md`,
is the template for this plan.

### Provider facts (verified 2026-09-23)

- **Claude Code 2.1.280** embeds `claude-opus-5-5` (`display_name:"Opus 5.5"`,
  `knowledge_cutoff:"June 2026"`, `pricing:"tier_4_20_cache_read_0_20"`),
  with capabilities `effort`, `max_effort`, `xhigh_effort` and
  `per_turn_effort`. Its ladder is therefore `low | medium | high | xhigh |
  max`, plus `ultracode` (gated on xhigh). It carries **no
  `effort_cost_index`**, so record that as "not published in 2.1.280".
  `latest_per_family`: `fable: claude-fable-5-1, opus: claude-opus-5-5,
  sonnet: claude-sonnet-5, haiku: claude-haiku-4-5`. `claude-opus-5` is still
  embedded (`tier_5_25`).
- **Codex 0.156.1** (npm `@openai/codex`, published 2026-09-23; bundled
  catalog read from the `darwin-arm64` binary). The installed codex is
  0.153.4, and its account registry (`~/.codex/models_cache.json`, fetched
  2026-09-20) lists neither GPT-6 Sol nor Luna.
  - `gpt-6-sol`: "Workhorse model for coding and everyday work"; efforts
    `low | medium | high | xhigh | max | ultra`; default `medium`;
    `visibility: list`; `minimal_client_version: 0.155.0`.
  - `gpt-6-luna`: "Fast and affordable model for easier tasks"; efforts
    `low | medium | high | xhigh | max`; default `medium`;
    `visibility: list`; `minimal_client_version: 0.155.0`.
  - `gpt-6-astra`: unchanged (`minimal_client_version: 0.153.0`).
  - `gpt-5.6-sol` and `gpt-5.6-terra`: `upgrade.model: gpt-6-sol`.
    `gpt-5.6-luna`: `upgrade.model: gpt-6-luna`. All three have
    `retirement_at: null` and are described as "Older …".
  - `gpt-5.5`: no `upgrade` pointer.
- **Artificial Analysis Intelligence Index** (leaderboard read 2026-09-23;
  low/medium/high/xhigh/max). This is a re-scaled index (Fable 5.1 max was
  57 on 2026-09-07), so compare models only within this read:

  | Model | Scores |
  | --- | --- |
  | Opus 5.5 | 42/51/54/56/58 |
  | Fable 5.1 | 47/49/51/53/53 |
  | GPT-6 Astra | 46/50/51/52/53 |
  | GPT-6 Sol | 34/40/43/44/48 |
  | GPT-5.6 Terra | 27/30/34/38/42 |
  | GPT-6 Luna | 21/29/32/34/37 |
  | Sonnet 5 | 24/28/32/34/38 |

  Opus 5, Opus 4.8, Fable 5, Sonnet 4.6, GPT-5.6 Sol/Luna and GPT-5.5 are no
  longer listed.

### Cost basis for phase-03

| Candidate | $/1M in / out | AA 2026-09-23 | effort_cost_index low/med/high/xhigh/max |
| --- | --- | --- | --- |
| `claude-opus-5` (current review + adjust-plan) | 5 / 25 | not listed | 0.67 / 0.76 / 1 / 1.60 / 1.70 |
| `claude-opus-5-5` | 4 / 20 (cache read 0.20) | 42/51/54/56/58 | not published |
| `claude-fable-5-1` | 10 / 50 (cache read 0.25) | 47/49/51/53/53 | 0.75 / 0.86 / 1 / 1.38 / 1.74 |
| `claude-sonnet-5` (compliance, unchanged) | 2 / 10 | 24/28/32/34/38 | 0.47 / 0.74 / 1 / 2.41 / 5.59 |
| `claude-haiku-4-5-20251001` (extract, unchanged) | 1 / 5 | — | no ladder |

Picks:

- Code review and plan adjustment move from `claude-opus-5` to
  `claude-opus-5-5`, effort `high`: 20% cheaper per token, and stronger.
- Compliance and extraction are unchanged.

### Architecture seams (audited 2026-09-23 against `main` @ `a733f85e`)

- **Catalog and edges**: `src/domain/routing/defaults.ts` only.
  `ModelFamily`, the effort schemas, `CLAUDE_FAMILIES` and the heuristics
  already cover every new id: **do not touch them**.
- **Alias resolution**: `pickActiveEntry` in `src/domain/routing/resolve.ts:43-57`
  takes the first active entry. It is also used by the terminal Sonnet
  fallback (`:325`). The code does not change; only the doc comment above it
  should say it returns the family's current (first-listed) model.
- **Hub → spoke lookup**: `hubToSpoke` in `src/domain/routing/catalog.ts:201-221`.
  `entryFor(spokeId, providerCfg)` returns `{ family, entry }`, and
  `isDeprecated` (`catalog.ts:82-86`) already exists. `spokeToHub` and
  `spokeToHubAny` stay as they are.
- **Preflight**: `hasPermittedCrossFamilyRoute` (`src/domain/routing/preflight.ts:44+`)
  goes through `equivalentFor`, so it picks up the guard for free. A phase
  naming a deprecated id is already rejected at `preflight.ts:110`.
- **Generated table**: `scripts/generate-model-catalog.ts`, config order.
- **Tests pinned to the catalog**: `tests/unit/routing/effortLevels.test.ts`,
  `catalog.test.ts`, `resolve.test.ts`, `sameFamilyPreservation.test.ts`,
  `preflight.test.ts`, `schemas.test.ts`, `securityFallback.test.ts`, and
  `tests/unit/skills.test.ts`. Some use GPT-5.6 ids through a real routing
  path, and preflight will now reject those as deprecated. Move such tests to
  the GPT-6 ids, or keep them where the test is *about* a deprecated entry.
- **Built-in defaults**: `DEFAULT_CODE_REVIEW_MODEL`
  (`src/schemas/phaxConfig.ts:200`), `adjustPlan` `DEFAULT_MODEL`
  (`src/cli/commands/adjustPlan.ts:26`), and the `--model` help strings at
  `src/cli/program.ts:264,290`, which flow into `phax.usage.kdl:229,254` and
  `docs/cli/reference.md:412,452`. Tests pinning them:
  `tests/unit/loadConfig.test.ts:306`,
  `tests/unit/cli/adjustPlanDefaults.test.ts:7-8`, and
  `tests/integration/adjustPlanCommand.test.ts:52,257` (edit only if it
  relies on the default).
- **Leave alone**: `docs/blog/announcing-phax-1.0.md`, and archived plans and
  specs.
- **Plan runtime**: phases run through `claude-code` only. Every new id is
  exercised by unit tests, never by a live provider call.

---

## phase-01 — Claude catalog: Opus 5.5, newest-first families {#phase-01-claude-opus-5-5}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Register `claude-opus-5-5` and list every Claude family newest-first, so the
`opus` alias (and any unknown `…opus…` id) resolves to Opus 5.5, `sonnet` to
Sonnet 5 and `fable` to Fable 5.1.

### Detailed instructions

- **Catalog** (`src/domain/routing/defaults.ts`, `claude-code` families):
  - `claude-opus`: `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`, in
    that order. The new entry is
    `{ id: "claude-opus-5-5", efforts: ["low", "medium", "high", "xhigh", "max", "ultracode"], status: "active" }`.
  - `claude-sonnet`: `claude-sonnet-5`, then `claude-sonnet-4-6`.
  - `claude-fable`: `claude-fable-5-1`, then `claude-fable-5`.
  - `claude-haiku` has a single entry and is unchanged.
  - Extend the existing comment above the families: entries are listed
    newest-first because `pickActiveEntry` resolves aliases and unknown ids
    to the first active entry, so the first entry is the family's current
    model.
  - Do not touch the equivalence table (phase-02) or
    `requestedModelNormalization`.
- **Resolver comment** (`src/domain/routing/resolve.ts`): add a doc comment
  on `pickActiveEntry` stating the newest-first contract. No logic change.
- **Regenerate** the planner table: `pnpm gen:model-catalog`.
- **Decision record** (`docs/model-catalog.md`):
  - §2: add the `claude-opus-5-5` row ("Claude Code 2.1.280 table,
    `xhigh_effort`, knowledge cutoff June 2026, `latest_per_family.opus`",
    since phase-01). Reorder the claude-code rows newest-first within each
    family.
  - Replace the "Order inside a family is oldest first…" paragraph with the
    newest-first rule and what each alias now resolves to.
  - Note that Opus 5 is kept active on purpose (still served, no longer on
    AA).
  - §5 step 2: "Add entries newest-first inside their family (prepend); the
    first active entry is what an alias resolves to."
- **Doc** (`docs/model-routing.md`): in the "Versioned catalog" JSON excerpt,
  show `claude-opus` newest-first with `claude-opus-5-5`, and add one sentence
  saying family aliases resolve to the first active entry.
- **Tests** (write first, confirm they fail on the current catalog):
  - `tests/unit/routing/effortLevels.test.ts`: `effortsFor("claude-opus-5-5")`
    equals `["low", "medium", "high", "xhigh", "max", "ultracode"]`, and the
    id is added to the active-status list.
  - `tests/unit/routing/catalog.test.ts`: `familyOfId("claude-opus-5-5")` →
    `claude-opus`.
  - `tests/unit/routing/resolve.test.ts`:
    - `claude-opus-5-5` / `xhigh`, claude-only priority → `claude-code`, same
      id and effort, `exact`.
    - Alias resolution, requested through `requestedModelNormalization`:
      `opus` / `high` → `claude-opus-5-5`; `sonnet` / `medium` →
      `claude-sonnet-5`; `fable` / `high` → `claude-fable-5-1`. All
      `equivalent`.
    - Extend the existing "unknown opus id" test (`claude-opus-9-9`) to
      assert `concreteModel` is `claude-opus-5-5`, and the
      "totally-unknown-model" fallback test to assert `claude-sonnet-5`.
    - Exact requests for older ids (`claude-opus-4-8` / `ultracode`,
      `claude-sonnet-4-6` / `medium`) still resolve to themselves.
  - `tests/unit/routing/sameFamilyPreservation.test.ts`: `claude-opus-5-5` /
    `ultracode` never leaves Claude.
  - `tests/unit/skills.test.ts`: add `claude-opus-5-5` to the listed ids.
  - Fix any other test that silently depended on oldest-first order, and
    name each one in the handoff.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `src/domain/routing/resolve.ts`
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

Producer: `DEFAULT_PROVIDER_CONFIG` lists `claude-opus-5-5` first in
`claude-opus`, with the six-effort ladder. Consumers:
- phase-02's `gpt-6-sol` edges target `claude-opus-5-5` at `low…max`;
- phase-03's defaults name `claude-opus-5-5` / `high`;
- `pickActiveEntry` treats the first active entry as the alias target.

### Test strategy

Domain unit tests written before the edit: the new-id ladder, alias
resolution to the newest entry, and the ultracode guard. No adapter or
integration change.

### Implementation order

1. Failing tests.
2. Reorder the families and add the entry.
3. Resolver doc comment.
4. `pnpm gen:model-catalog`.
5. Docs.

### Excluded scope

- Codex entries, deprecations, equivalence edges and `hubToSpoke`
  (phase-02).
- Built-in defaults, CLI help and planning guidance (phase-03).
- Reordering `mistral-medium` (its entries are per-effort, not versions).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The committed `claude-sonnet`, `claude-opus` and `claude-fable` arrays, in
  order.
- Every test changed because of the reorder, with the reason.
- Confirmation that `pnpm gen:model-catalog --check` passed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): add Claude Opus 5.5, list Claude families newest-first so aliases track the current model

### Commit body

Register claude-opus-5-5 (Claude Code 2.1.280, latest_per_family.opus) with
the low|medium|high|xhigh|max|ultracode ladder. List each Claude family
newest-first. pickActiveEntry resolves aliases and unknown ids to the first
active entry, so opus now means Opus 5.5, sonnet means Sonnet 5 and fable
means Fable 5.1. claude-opus-5 stays active. Regenerates the planner table
and records the order rule in docs/model-catalog.md.

---

## phase-02 — Codex catalog: GPT-6 Sol and Luna, GPT-5.6 deprecated, anchors {#phase-02-codex-gpt-6}

**Recommended model:** claude-opus-5
**Recommended effort:** medium

Add GPT-6 Sol and Luna, deprecate the GPT-5.6 variants Codex has superseded,
and re-anchor the Codex spokes. A Claude phase routed to Codex then lands on
a current GPT-6 model and never on a deprecated one.

### Detailed instructions

- **Catalog** (`src/domain/routing/defaults.ts`, `codex-cli` → `openai-gpt`),
  newest-first:
  1. `{ id: "gpt-6-sol", efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], status: "active" }`
  2. `{ id: "gpt-6-luna", efforts: ["low", "medium", "high", "xhigh", "max"], status: "active" }`
  3. `gpt-6-astra` (unchanged)
  4. `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, all `status: "deprecated"`,
     with efforts unchanged
  5. `gpt-5.5` (unchanged, active)

  The `gpt` alias therefore resolves to `gpt-6-sol`.
- **Equivalence** (`DEFAULT_MODEL_ROUTING.equivalence`):
  - Add `"gpt-6-sol"`: `low|medium|high|xhigh|max` → `claude-opus-5-5`, same
    effort, `downgrade`; `ultra` → `claude-opus-5-5` `max`, `downgrade`.
  - Add `"gpt-6-luna"`: `low` → `claude-sonnet-5` `low`, `downgrade`;
    `medium|high|xhigh|max` → `claude-sonnet-5`, same effort, `equivalent`.
  - `"gpt-6-astra"`: every relation becomes `equivalent`. Rewrite its comment
    with the 2026-09-23 numbers.
  - Put the new edges before the GPT-5.6 edges, and keep the GPT-5.6 edges
    (a deprecated spoke still falls back to Claude). Update their comment:
    deprecated upstream, kept for spoke → hub fallback, and skipped for hub →
    spoke.
  - Every new comment cites the AA read date and the numbers, like the
    existing ones do.
- **Deprecated-spoke guard** (`src/domain/routing/catalog.ts`, `hubToSpoke`):
  skip a spoke whose catalog entry is `status: "deprecated"`, next to the
  family check. Add one line of doc comment. Do not change `spokeToHub`,
  `spokeToHubAny` or `equivalentFor`.
- **Regenerate** the planner table: `pnpm gen:model-catalog`.
- **Decision record** (`docs/model-catalog.md`):
  - §2 codex table: add rows for `gpt-6-sol` and `gpt-6-luna` ("codex 0.156.1
    bundled catalog; `minimal_client_version` 0.155.0"). Mark the three
    GPT-5.6 rows `deprecated` (upgrade pointers → `gpt-6-sol` /
    `gpt-6-luna`). List rows newest-first.
  - §3 anchors: add rows for Sol → Opus 5.5 `downgrade` and Luna → Sonnet 5
    (`downgrade` at low, otherwise `equivalent`). Change Astra to
    `equivalent`. Cite the 2026-09-23 numbers and say the index was
    re-scaled. Add a paragraph on the deprecated-spoke rule and on which
    Claude entries lose their codex route (Fable 5; Opus 4.8 except
    `gpt-5.5` xhigh → Opus 4.8 medium).
  - Rewrite the "Consequence of the one `downgrade` edge" paragraph for the
    new downgrade edges (all of Sol, and Luna at low).
- **Doc** (`docs/model-routing.md`): GPT-6 Sol and Luna need codex ≥
  0.155.0. Update line 78's Astra sentence (now `equivalent`) and the Astra
  worked example (spoke → hub relation is now `equivalent`). Add a sentence
  saying deprecated spokes are never chosen hub → spoke.
- **Tests** (write first):
  - `tests/unit/routing/catalog.test.ts`:
    - `familyOfId("gpt-6-sol")` / `("gpt-6-luna")` → `openai-gpt`.
    - `equivalentFor("claude-opus-5-5", "high", "openai-gpt", …)` →
      `gpt-6-sol` / `high` / `downgrade`.
    - `equivalentFor("claude-sonnet-5", "medium", "openai-gpt", …)` →
      `gpt-6-luna` / `medium` / `equivalent` (not `gpt-5.6-luna`).
    - `equivalentFor("claude-fable-5-1", "xhigh", "openai-gpt", …)` →
      `gpt-6-astra` / `equivalent`.
    - `equivalentFor("claude-fable-5", "high", "openai-gpt", …)` →
      `undefined` (only deprecated spoke).
    - `equivalentFor("gpt-5.6-terra", "high", "claude-opus", …)` still
      returns `claude-opus-4-8` (spoke → hub kept).
    - `isDeprecated("gpt-5.6-sol")` is true.
  - `tests/unit/routing/effortLevels.test.ts`: ladders for `gpt-6-sol` and
    `gpt-6-luna`. Move the three GPT-5.6 ids out of the "every catalog entry
    is marked status active" list into a deprecated assertion.
  - `tests/unit/routing/resolve.test.ts`: with codex first and enabled:
    - `claude-opus-5-5` / `high` → `codex-cli` `gpt-6-sol` `downgrade` when
      `allowDowngrade: true`, and stays on `claude-code` when `false`;
    - `claude-fable-5-1` / `high` → `gpt-6-astra` `equivalent` even with
      `allowDowngrade: false`.
  - `tests/unit/routing/preflight.test.ts`:
    - a phase naming `gpt-5.6-terra` fails as deprecated;
    - a `claude-fable-5` phase with only codex enabled has no permitted
      cross-family route.
  - `tests/unit/routing/sameFamilyPreservation.test.ts`: `gpt-6-sol` /
    `ultra` falling back to Claude lands on `claude-opus-5-5` `max`, never on
    `ultracode`.
  - Existing tests that route through GPT-5.6 ids: switch them to the GPT-6
    equivalent, unless the test is about deprecation.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/routing/defaults.ts`
- `src/domain/routing/catalog.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `docs/model-catalog.md`
- `docs/model-routing.md`
- `tests/unit/routing/catalog.test.ts`
- `tests/unit/routing/effortLevels.test.ts`
- `tests/unit/routing/resolve.test.ts`
- `tests/unit/routing/preflight.test.ts`
- `tests/unit/routing/sameFamilyPreservation.test.ts`

### Optional files that may be edited

- `tests/unit/routing/schemas.test.ts`
- `tests/unit/routing/securityFallback.test.ts`
- `tests/unit/routing/providerSetup.test.ts`
- `tests/unit/skills.test.ts`
- `.claude/skills/model-routing/SKILL.md`
- `README.md`

### Boundary contracts

Producer: `hubToSpoke` never returns a deprecated spoke. `equivalentFor`,
`resolveModel` and `preflightPhaseModels` consume it unchanged. Producer:
`DEFAULT_MODEL_ROUTING.equivalence` anchors `gpt-6-sol` to `claude-opus-5-5`,
which must exist from phase-01.

### Test strategy

Domain unit tests first: the deprecated-spoke guard, and the new
hub ↔ spoke lookups in both directions under both `allowDowngrade` settings.
These are the behaviours a wrong insertion order or a missing guard would
break silently.

### Implementation order

1. Failing tests.
2. `hubToSpoke` guard.
3. Catalog entries and statuses.
4. Equivalence edges.
5. `pnpm gen:model-catalog`.
6. Docs.

### Excluded scope

- Built-in defaults and planning guidance (phase-03).
- Removing any GPT-5.6 entry or edge.
- Live codex e2e (`pnpm test:e2e:real`): the installed codex is 0.153.4, older
  than GPT-6 Sol and Luna's 0.155.0 minimum.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The committed `openai-gpt` array and the new or changed equivalence
  blocks.
- The exact `hubToSpoke` change.
- The Claude entries that lost a codex route.
- Tests migrated off GPT-5.6 ids.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(routing): add GPT-6 Sol and Luna, deprecate GPT-5.6, anchor Sol to Opus 5.5 and Astra equivalent to Fable 5.1

### Commit body

Codex 0.156.1 ships gpt-6-sol and gpt-6-luna (client >= 0.155.0) and points
every GPT-5.6 variant at them. Register both newest-first, mark the three
GPT-5.6 entries deprecated, and anchor on the 2026-09-23 Artificial Analysis
index:
- Sol → Opus 5.5, downgrade;
- Luna → Sonnet 5, equivalent (downgrade at low);
- Astra → Fable 5.1, now equivalent.
hubToSpoke skips deprecated spokes, so a Claude phase never routes to a
retired Codex model. Their spoke → hub edges remain for fallback.

---

## phase-03 — Default phax jobs and planning guidance to Opus 5.5 {#phase-03-defaults-opus-5-5}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Point phax's Opus-tier built-in defaults (code review, plan adjustment) at
`claude-opus-5-5`, and make it the recommended default phase model in the
planning skill.

### Detailed instructions

- **Defaults**:
  - `src/schemas/phaxConfig.ts`: `DEFAULT_CODE_REVIEW_MODEL = "claude-opus-5-5"`
    (effort stays `high`). Compliance and extraction are unchanged.
  - `src/cli/commands/adjustPlan.ts`: `DEFAULT_MODEL = "claude-opus-5-5"`
    (effort stays `high`).
- **CLI help** (`src/cli/program.ts:264,290`): `claude-opus-5` →
  `claude-opus-5-5`. Then run `pnpm gen:usage-spec` and `pnpm docs:cli`, and
  commit the regenerated `phax.usage.kdl` and `docs/cli/reference.md`, plus
  `README.md` if its generated block changes.
- **Planning guidance** (`.claude/skills/phax-planning/SKILL.md`, outside the
  generated region): add a `### Choosing a model and effort` subsection after
  the `## Model catalog` intro paragraph, before the BEGIN marker. It should
  say:
  - The default phase model is `claude-opus-5-5`: it is the cheapest
    Opus-tier entry and matches or beats `claude-fable-5-1` from `medium` up.
  - Use `claude-sonnet-5` for mechanical phases (catalog/table edits, renames,
    doc sweeps).
  - Use `claude-fable-5-1` only for a stated reason that Opus 5.5 cannot
    serve, recorded in Technical arbitrations.
  - Use the lowest effort that succeeds. Opus 5.5 is weakest at `low` (below
    Fable 5.1), so use `medium` or above for phases that need real reasoning.
  - A plan that changes the catalog itself must name only models already in
    the shipped catalog: the run-start preflight uses the running binary's
    catalog.
- **Decision record** (`docs/model-catalog.md`):
  - "State described": point it at this plan.
  - §4 cost table: add the `claude-opus-5-5` row, with a note that the
    2026-09-23 AA numbers are re-scaled and not comparable with the
    2026-09-07 column.
  - §4 defaults: Code review and Plan adjustment → `claude-opus-5-5`,
    Previous `claude-opus-5`. Compliance and extraction: "re-checked
    2026-09-23, unchanged", with the reasons.
  - §6: append
    `| 2026-09-23 | Claude Opus 5.5; Claude families newest-first (aliases → current model); GPT-6 Sol → Opus 5.5 (downgrade), GPT-6 Luna → Sonnet 5; GPT-5.6 deprecated; Astra ↔ Fable 5.1 equivalent; review/adjust-plan defaults → Opus 5.5; planning skill recommends Opus 5.5 | phax/catalog-opus-5-5-gpt-6-sol-and-luna |`.
- **Tests**:
  - `tests/unit/loadConfig.test.ts:306` → `"claude-opus-5-5"`.
  - `tests/unit/cli/adjustPlanDefaults.test.ts`: rename the test to
    "defaults to claude-opus-5-5 at high effort" and update the expectation.
  - `tests/integration/adjustPlanCommand.test.ts:52,257`: update only if the
    assertion depends on the default.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/cli/commands/adjustPlan.ts`
- `src/cli/program.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `.claude/skills/phax-planning/SKILL.md`
- `docs/model-catalog.md`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/cli/adjustPlanDefaults.test.ts`

### Optional files that may be edited

- `README.md`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/unit/skills.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`

### Boundary contracts

Producer: `DEFAULT_CODE_REVIEW_MODEL` and `adjustPlan`'s `DEFAULT_MODEL` name
`claude-opus-5-5` / `high`. Consumer: `phax review-code` and
`phax adjust-plan`, when neither `phax.json` nor `--model` overrides them.

### Test strategy

Update the constant-pinning tests first so they fail, then change the
constants. No new behaviour.

### Implementation order

1. Tests.
2. Constants.
3. Help strings and regeneration.
4. Planning skill subsection.
5. `docs/model-catalog.md`.

### Excluded scope

- Compliance and extraction defaults.
- `docs/blog/announcing-phax-1.0.md`, and archived plans and specs.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The final values of all four built-in defaults, with their efforts.
- Whether README changed after regeneration.
- The text of the new planning-skill subsection.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(defaults): default code review, plan adjustment and planning guidance to Opus 5.5

### Commit body

Opus 5.5 is 20% cheaper per token than Opus 5 and scores above Fable 5.1
from medium effort up. Point DEFAULT_CODE_REVIEW_MODEL and adjust-plan's
default at claude-opus-5-5, keeping effort high. Update the --model help
strings and the generated usage spec and CLI reference. Add model-choice
guidance to the phax-planning skill so new plans default to Opus 5.5.
Compliance (Sonnet 5 medium) and extraction (Haiku 4.5 low) were re-checked
and are unchanged.
