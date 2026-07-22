# Model Catalog and Equivalence Routing (no canonical scale)

Status: Archived

Date: 2026-07-10

Audience: implementation planning with Claude Code

Scope: functional behavior and consumption surface

## 1. Context

phax routes phase execution across provider families (Claude Code, Mistral Vibe, OpenAI Codex)
through an **abstract capability scale** — the routing *tier*. A request `(family, effort)` is
normalized to a tier, and each tier maps to a per-provider offering:

```
cheap · fast · standard · strong · very_strong ·
frontier-low · frontier-medium · frontier-high · frontier-xhigh · frontier-max · frontier-ultra
```

Two facts about this scale matter:

- It is a **1:1 shadow of Claude's own lineup**: `cheap` = haiku, `fast/standard/strong/very_strong`
  = sonnet low/medium/high/max, `frontier-*` = opus low…ultracode. The tier names carry no
  information the Claude lineup does not already carry.
- Supported efforts are declared **per family** (`FAMILY_EFFORTS`), and plan phases are authored in
  Claude-oriented effort naming because "Claude is the routing reference scale".

Resolution is a two-hop pipeline: `model → family+effort → tier → provider offering → concrete id`.

## 2. Problem

The abstract tier scale is an invented middle layer that must be re-justified on every model
release, and model releases are not version increments:

- Coexisting usable versions. Sonnet 5 and Sonnet 4.6 can both be live, one cheaper, at
  overlapping capability. A single-occupant rung cannot hold both.
- A pushed frontier that leaves the old top in place. A new frontier family (e.g. Fable) sits
  **above** opus/max while opus/max remains a valid rung. The ladder must grow, not shift.
- The scale imposes a **total order** on a reality that is at best a partial one, and its rung
  names (`frontier-max`) are meaningless labels a human must keep re-mapping. Each release costs a
  rename of arbitrary rungs plus a rewire of two tables (`tiers`, `normalization`), for zero
  information gain over "these are the real models".

The result: the canonical scale drifts constantly and, once it drifts, means nothing.

## 3. Product goal

Remove the invented scale. The planning agent selects **concrete, versioned models** (full id +
effort) natively, in its own provider family — it already knows its family best, and it is fed the
current catalog. Running a plan on a *different* family is enabled by an **equivalence table** (a
star with Claude as the hub), each edge carrying a capability-only relation. A **run-start
preflight** validates that every phase is actually runnable; when it is not, phax emits an
actionable error plus the valid alternatives and the agent corrects the plan itself. The only
policy knob is `allowDowngrade` — a capability floor applied when translating across families.

phax never materializes a scale: the equivalence classes are latent in the table, emergent from
real-model↔real-model facts, never named or maintained as a ladder.

> phax has no invented scale — the planner names real models, equivalence translates them across
> families, and preflight refuses a plan it cannot run.

## 4. Terminology

- **Catalog** — the set of real models phax may run, grouped by family, each an entry.
- **Catalog entry** — one concrete versioned model: its id, the efforts *that model* supports, and
  its lifecycle status. Coexisting versions of a family are **separate entries**.
- **Effort** — a reasoning level a specific catalog entry supports (per entry, not per family).
- **Equivalence table** — the mapping used only to translate a plan across families. A **star**:
  every non-Claude entry has an edge to a Claude entry (the **hub**); cross-spoke translation
  routes through the hub.
- **Relation** — the capability comparison an equivalence edge carries, stated relative to the
  Claude hub node: `exact | equivalent | upgrade | downgrade | no_equivalent`. Capability only —
  never cost.
- **Plan-family / execution-family** — the family the plan's models belong to vs the family a run
  is asked to execute on. Translation happens only when they differ.
- **Preflight** — the run-start validation gate over every phase's model selection, before phase 1.

## 5. Functional requirements

### 5.1 No canonical scale; planner-native selection

THE system SHALL remove the abstract routing-tier scale and the `family+effort → tier → provider`
normalization; no rung vocabulary is consulted during resolution.

THE system SHALL express each phase's model as a **concrete versioned id plus an effort** in the
planning agent's own provider family.

WHEN the plan-family equals the execution-family THE system SHALL run each phase's model id and
effort directly, consulting no equivalence table.

### 5.2 Versioned catalog with per-entry efforts

THE system SHALL define a catalog of concrete model entries grouped by family, each entry carrying
its id, the efforts that entry supports, and an explicit lifecycle status.

THE system SHALL declare supported efforts **per catalog entry** (per version), not per family.

THE system SHALL represent coexisting versions of one family as distinct catalog entries.

### 5.3 Equivalence table (star, Claude hub)

WHERE the execution-family differs from the plan-family THE system SHALL translate each phase's
`(id, effort)` to the execution-family via the equivalence table.

THE system SHALL key the equivalence table as a star with Claude as the hub: every non-Claude entry
edge references a Claude entry, and cross-spoke translation routes through the Claude hub.

THE system SHALL state each edge's relation relative to the Claude hub node, applying it directly
for hub→spoke translation and inverting it (downgrade ↔ upgrade) for spoke→hub translation.

### 5.4 Downgrade policy (capability floor)

THE system SHALL treat an equivalence relation as a capability comparison only and SHALL NOT encode
cost in it.

IF `allowDowngrade` is false and a required translation is classified `downgrade` or
`no_equivalent` THEN the system SHALL refuse the translation.

THE system SHALL retain claude-code as the guaranteed terminal execution family, reachable because
every non-Claude entry has a hub edge.

### 5.5 Run-start preflight and self-correction

WHEN a run starts THE system SHALL validate, before the first phase executes, that every phase's
model selection is runnable: the id exists in the catalog, the effort is supported by that entry,
the entry is not deprecated, the entry's provider is available, and — where plan-family differs from
execution-family — a permitted equivalence edge exists.

IF any phase fails preflight THEN the system SHALL fail the run before phase 1 with a non-zero exit,
naming each offending phase and listing the valid alternatives drawn from the catalog.

THE system SHALL surface the preflight failure as an actionable error the planning agent can consume
to correct the plan without further guidance.

### 5.6 Planner catalog stays in sync

THE system SHALL present the current catalog to the planning agent as generated content derived from
the catalog, not hand-maintained.

IF the generated catalog view diverges from the catalog THEN the pre-merge gate SHALL fail.

## 6. Surface

### Model config — before → after

`~/.phax/model-routing.json` loses the scale. `tiers`, `normalization`, `defaultTier` are **removed**
(rejected at validation — no shim); `allowDowngrade` stays; an `equivalence` table is added. Field
presence is **normative**; exact key spellings **indicative**.

```json
// before
{ "version": 1, "allowDowngrade": false,
  "defaultTier": "standard", "tiers": { … }, "normalization": { … } }

// after
{ "version": 2, "allowDowngrade": false,
  "equivalence": {
    "gpt-5.6":   { "high":   { "claude": "claude-opus-4-8",  "effort": "max",  "relation": "downgrade" },
                   "medium": { "claude": "claude-sonnet-5",  "effort": "high", "relation": "equivalent" } },
    "mistral-…": { "high":   { "claude": "claude-sonnet-5",  "effort": "high", "relation": "equivalent" } }
  } }
```

The relation enum `exact | equivalent | upgrade | downgrade | no_equivalent` and the edge shape
`spoke (id, effort) → { claude id, effort, relation }` are **normative**.

### Catalog — before → after

The provider config's family entries gain per-entry efforts and status, and admit coexisting
versions (`~/.phax/providers.json`; per-entry `efforts` and `status` **normative**, layout
**indicative**):

```json
// before
"claude-code": { "families": { "claude-opus": { "model": "claude-opus-4-8" } } }

// after
"claude-code": { "families": { "claude-opus": { "models": [
  { "id": "claude-opus-4-8", "efforts": ["low","medium","high","xhigh","max","ultracode"], "status": "active" },
  { "id": "claude-opus-4-7", "efforts": ["low","medium","high","xhigh","max"],             "status": "deprecated" }
] } } }
```

### Plan phase — before → after

A phase names a concrete id and effort in the planner's family (id **normative**; effort drawn from
the entry's `efforts`):

```
before:  model: "opus"          effort: "max"     (Claude-oriented, tier-normalized)
after:   model: "claude-opus-4-8"  effort: "max"  (concrete versioned id)
```

### Preflight failure — CLI output sketch

Non-zero exit, offending phase named, and catalog alternatives listed are **normative**; wording
**indicative**:

```
✗ preflight refused: 1 phase cannot run
  phase-03  model "claude-opus-4-8" effort "ultracode" — effort not supported by this entry
            valid efforts: low, medium, high, xhigh, max
            or pick another opus entry: claude-opus-4-9 (ultracode)
$? = 1
```

### Catalog codegen — command + generated region

Command and drift check are **normative**; command spelling **indicative**:

```
pnpm gen:model-catalog          # regenerate the catalog table in the phax-planning skill
pnpm gen:model-catalog --check  # non-zero if the committed table is stale (run in check:full)
```

The generated table lives inside a marker-delimited region of the phax-planning skill markdown;
only the region is rewritten, surrounding prose is hand-authored. **Normative** that the region is
generated and drift-checked; the table columns are **indicative** (id, family, efforts).

## 7. Non-goals

- **Cost, price, or positioning metadata** in the catalog — explicitly excluded. There is no
  `cheapest-qualifying` selection and no cost input to any relation. The planner names the version.
- **Automated version selection or deprecation redirects** (`supersedes`) — the planner pins the id;
  a deprecated or missing id is *caught by preflight*, never silently redirected.
- **Ranking models the planner does not know** — with no positioning column, a brand-new frontier
  family the planner cannot rank from its own knowledge is backstopped by the human **plan-review
  gate**, not by phax.
- **Mid-run vendor churn guarantees** — preflight is a start gate, not a running guarantee; a model
  pulled after phase 1 falls to the same-session fix loop and the claude-code terminal.
- **The planning agent's per-phase model-choice heuristics** — how it decides which model fits a
  phase is the agent's concern, not phax's.
- **A full mesh equivalence graph** — translation is star-only through the Claude hub.

## 8. Acceptance criteria

### Same-family runs need no translation

Given a plan whose phases name Claude ids and a run executing on claude-code, when the run starts,
then each phase runs its id and effort directly and no equivalence table is consulted. (refs §5.1)

### Catalog efforts are per entry

Given two coexisting entries of one family with different `efforts`, when an effort valid for one
but not the other is requested against the other, then preflight rejects it. (refs §5.2, §5.5)

### Cross-family translation via the hub

Given a plan authored with GPT ids and a run executing on claude-code, when the run starts, then
each phase is translated to a Claude entry via its hub edge with the edge's relation applied.
(refs §5.3)

### Downgrade floor is enforced

Given `allowDowngrade` false and a required translation classified `downgrade`, when preflight runs,
then the translation is refused and the run does not start. (refs §5.4)

### Preflight refuses an unrunnable plan with alternatives

Given a phase whose effort is unsupported by its catalog entry, when the run starts, then it exits
non-zero before phase 1, names `phase-03`, and lists the entry's valid efforts and/or another entry
that supports the requested effort. (refs §5.5)

### Generated catalog view is drift-checked

Given the catalog changed but the phax-planning skill table was not regenerated, when
`pnpm gen:model-catalog --check` runs (in `check:full`), then it exits non-zero. (refs §5.6)

## 9. Open questions for implementation planning

All resolved by the recommended default (confirmed 2026-07-10):

- **Config placement of catalog vs equivalence.** *Default:* the catalog (ids, efforts, status)
  lives with the provider/family config; the equivalence table and `allowDowngrade` live in the
  routing config. Placement is indicative.
- **`upgrade` relation.** Whether the relation enum needs `upgrade` for a spoke that exceeds the
  Claude hub's top. *Default:* include it — the frontier can be pushed by a non-Claude family.
- **Deprecated-entry handling at preflight.** *Default:* a `deprecated` entry fails preflight (with
  the active alternative listed); it is not auto-substituted.
- **Correction actor.** *Default:* phax emits error + alternatives only; the planning agent
  self-corrects. phax orchestrates no re-plan step of its own.
- **Config version bump / migration.** *Default:* bump the routing config version and reject the old
  `tiers`/`normalization`/`defaultTier` shape at validation — no shim, per phax schema policy.

## 10. Implementation-planning note

Settled: the abstract tier scale, `tiers`, and `normalization` are removed; phases carry concrete
versioned ids + per-entry efforts; cross-family execution translates through a Claude-hub star with
capability-only relations; `allowDowngrade` is the sole policy; a run-start preflight validates every
phase and, on failure, emits an actionable error the planning agent self-corrects from; the
phax-planning skill's catalog table is generated from the catalog and drift-checked in `check:full`.

Left open: nothing blocking — every §9 item has a default.

Constraints the plan must respect: **no cost/positioning** anywhere in the catalog or relations;
**star topology only** (Claude hub), never a mesh; **claude-code remains the guaranteed terminal**
execution family; **no back-compat shim** for the removed scale (old configs are rejected, not
mapped); efforts are **per entry**, so the effort-support check is entry-scoped, not family-scoped.
This spec replaces the routing core defined in `docs/model-routing.md`; that document is updated by
the resulting plan, not kept in sync by hand.
