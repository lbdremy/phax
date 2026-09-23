# Model catalog decision record

This document backs the contents of `DEFAULT_PROVIDER_CONFIG` and
`DEFAULT_MODEL_ROUTING.equivalence` (`src/domain/routing/defaults.ts`) and the
built-in default models phax uses for its own jobs. `docs/model-routing.md`
explains **how** routing works; this file records **why the catalog says what
it says**: where each id and effort ladder was read from, what the
cross-provider anchors are based on, and the cost basis behind every default.
Update it in the same change that touches the catalog or a default, and append
a row to the refresh log at the bottom.

**State described:** the catalog as it stands after
`docs/plans/2609230815-catalog-opus-5-5-gpt-6-sol-luna-plan.md` landed.

## 1. Sources of truth

Never add an id or effort from memory. Read it from the provider, then cite it
here.

| Provider   | Ground truth                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | The `claude` binary embeds a model table (`id:"claude-…",family:…,capabilities:[…],pricing:"tier_…",effort_cost_index:{…}`). `xhigh_effort` / `max_effort` in `capabilities` give the effort ladder; `pricing` names the per-token tier; `latest_per_family` says which id an alias resolves to. `ultracode` is xhigh + dynamic workflows and is refused only when xhigh is not allowed for the model or org. |
| Codex      | `~/.codex/models_cache.json` is the account-served registry (per slug: `supported_reasoning_levels`, `visibility`, `upgrade`, `minimal_client_version`); it can omit slugs the plan tier hides. The codex binary bundles OpenAI's full catalog (`npm pack @openai/codex@<ver>-<platform>`, then search the binary for `"slug": "`). A slug with an `upgrade` pointer is deprecated upstream. |
| Mistral Vibe | The `phax-mistral-medium-3.5-*` ids are phax-installed aliases (`phax agent setup vibe`), one per effort; the base model is `mistral-medium-3.5` in `~/.vibe/config.toml`.                                                                                                                                                                                                                       |
| Capability axis | Artificial Analysis Intelligence Index (`artificialanalysis.ai/leaderboards/models`) gives per-effort scores for both vendors on one axis. The Agentic Index used in July 2026 no longer exposes per-model numbers.                                                                                                                                                                              |
| Energy     | No provider publishes per-model energy or carbon figures (checked 2026-09-07: Anthropic and OpenAI disclose aggregate data-centre numbers only; third-party estimates cover older models). Inference energy scales with tokens generated, so **output tokens per task** (AA "verbosity" on the Intelligence Index run) and Claude Code's `effort_cost_index` are the proxy.                        |

## 2. Catalog entries and where each came from

Efforts are per entry, never per family. Status `active` unless stated.

### claude-code

| Id                          | Family          | Efforts                                          | Read from                                                                                              | Since                    |
| --------------------------- | --------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------ |
| `claude-haiku-4-5-20251001` | `claude-haiku`  | `none`                                           | No effort ladder in Claude Code; still the newest Haiku (`latest_per_family.haiku`)                    | initial catalog          |
| `claude-sonnet-5`           | `claude-sonnet` | `low medium high xhigh max ultracode`            | `xhigh_effort`; `ultracode` added when Claude Code 2.1.263 was confirmed to gate it on xhigh only     | `0667c17`; ultracode phase-01 |
| `claude-sonnet-4-6`         | `claude-sonnet` | `low medium high max`                            | No `xhigh_effort` capability, hence no `ultracode`                                                     | initial catalog          |
| `claude-opus-5-5`           | `claude-opus`   | `low medium high xhigh max ultracode`            | Claude Code 2.1.280 table, `xhigh_effort`, knowledge cutoff June 2026, `latest_per_family.opus`         | phase-01 (catalog-opus-5-5-gpt-6-sol-luna) |
| `claude-opus-5`             | `claude-opus`   | `low medium high xhigh max ultracode`            | Claude Code 2.1.263 table, `xhigh_effort`, knowledge cutoff May 2026; kept active — still served by Claude Code 2.1.280, no longer on the AA index | phase-01                 |
| `claude-opus-4-8`           | `claude-opus`   | `low medium high xhigh max ultracode`            | `xhigh_effort`                                                                                          | initial catalog          |
| `claude-fable-5-1`          | `claude-fable`  | `low medium high xhigh max ultracode`            | Claude Code 2.1.257+ (`latest_per_family.fable`), released 2026-09-01, `xhigh_effort`                  | phase-01                 |
| `claude-fable-5`            | `claude-fable`  | `low medium high xhigh max ultracode`            | `xhigh_effort`; ultracode added phase-01                                                                | `0667c17`; ultracode phase-01 |

Order inside a family is newest first: `pickActiveEntry` resolves an alias
(`opus`, `sonnet`, `fable`, `gpt`, …) or any id it doesn't recognize to the
first active entry, so the first entry is the family's current model. `opus`
now resolves to `claude-opus-5-5`, `sonnet` to `claude-sonnet-5` and `fable`
to `claude-fable-5-1`. Adding a version means prepending it, never appending.

### codex-cli

Rows are newest-first, same rule as the Claude families.

| Id              | Efforts                            | Status       | Read from                                                                 | Since     |
| --------------- | ---------------------------------- | ------------ | ------------------------------------------------------------------------- | --------- |
| `gpt-6-sol`     | `low medium high xhigh max ultra`  | `active`     | codex 0.156.1 bundled catalog (`npm @openai/codex`, published 2026-09-23, `darwin-arm64`); "Workhorse model for coding and everyday work", default `medium`, `visibility: list`, `minimal_client_version` 0.155.0 | phase-02 (catalog-opus-5-5-gpt-6-sol-luna) |
| `gpt-6-luna`    | `low medium high xhigh max`        | `active`     | codex 0.156.1 bundled catalog; "Fast and affordable model for easier tasks", default `medium`, `visibility: list`, `minimal_client_version` 0.155.0 | phase-02 |
| `gpt-6-astra`   | `low medium high xhigh max ultra`  | `active`     | codex 0.153.4 bundled catalog; `minimal_client_version` 0.153.0; released 2026-09-03; unchanged in 0.156.1 | 2026-09-07 refresh |
| `gpt-5.6-luna`  | `low medium high xhigh max`        | `deprecated` | codex registry (caps at `max`); 0.156.1 gives it `upgrade.model: gpt-6-luna`, `retirement_at: null` | `0667c17`; deprecated phase-02 |
| `gpt-5.6-terra` | `low medium high xhigh max ultra`  | `deprecated` | codex registry; 0.156.1 gives it `upgrade.model: gpt-6-sol`                | `0667c17`; deprecated phase-02 |
| `gpt-5.6-sol`   | `low medium high xhigh max ultra`  | `deprecated` | codex registry (0.144.x); 0.156.1 gives it `upgrade.model: gpt-6-sol`     | `0667c17`; deprecated phase-02 |
| `gpt-5.5`       | `low medium high xhigh`            | `active`     | codex registry; no `upgrade` pointer in 0.156.1, so it stays active        | initial   |

The installed codex is 0.153.4 and its account registry
(`~/.codex/models_cache.json`, fetched 2026-09-20) lists neither GPT-6 Sol nor
Luna; both were read from 0.156.1's bundled catalog. They need codex ≥ 0.155.0
to run, so no live e2e covers them yet.

Not catalogued on purpose: `gpt-5.4` / `gpt-5.4-mini` (upstream `upgrade`
pointers to Terra / Luna), `gpt-5.6-pro` and `gpt-5.5-pro` (not in the codex
picker), hidden internal slugs (`gpt-reserve`, `codex-auto-review`,
`gpt-daybreak-*`).

### mistral-vibe

One alias per effort, `phax-mistral-medium-3.5-{off,low,medium,high,max}`,
each advertising exactly that effort.

## 3. Cross-provider anchors

Every spoke edge is stated hub-centric (`spoke id + effort → claude id +
effort + relation`); `equivalentFor` inverts `downgrade ↔ upgrade` for
spoke → hub lookups. Rules that have held since July 2026:

- Efforts map straight across; a spoke's `ultra` anchors to its peer's `max`.
- `ultracode` is never an anchor target: it stays Claude-only and is never
  routed cross-provider (`tests/unit/routing/sameFamilyPreservation.test.ts`).
- `equivalent` is used when the two sit within about one index point;
  otherwise the honest relation is stored and `allowDowngrade` decides.

The Intelligence Index was **re-scaled** between the 2026-09-07 and the
2026-09-23 reads (Fable 5.1 at max was 57, now 53), so numbers are only
comparable within a single read.

| Spoke           | Anchor              | Relation     | Basis                                                                                                                                                             | Since     |
| --------------- | ------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `gpt-5.5`       | `claude-sonnet-4-6` (low/medium/high), `claude-opus-4-8` medium (xhigh) | `equivalent` | Original spec §12 table                                                                                                                                            | initial   |
| `gpt-6-sol`     | `claude-opus-5-5`   | `downgrade`  | AA Intelligence Index, 2026-09-23, low/medium/high/xhigh/max: Sol 34/40/43/44/48 vs Opus 5.5 42/51/54/56/58. Sol sits between Sonnet 5 (24/28/32/34/38) and Opus 5.5 with no Claude entry within a point; anchoring high gives Opus 5.5, the default phase model, a codex route under `allowDowngrade: true`. | phase-02 |
| `gpt-6-luna`    | `claude-sonnet-5`   | `downgrade` at `low`, else `equivalent` | AA Intelligence Index, 2026-09-23: Luna 21/29/32/34/37 vs Sonnet 5 24/28/32/34/38 — within a point from `medium` up, 3 points under at `low`. | phase-02 |
| `gpt-6-astra`   | `claude-fable-5-1`  | `equivalent` | AA Intelligence Index, 2026-09-23: Astra 46/50/51/52/53 vs Fable 5.1 47/49/51/53/53 — within 1 point everywhere. Was `downgrade` on the 2026-09-07 revision (Astra 49/52/53/54/55 vs Fable 5.1 51/53/54/56/57). | 2026-09-07 refresh; `equivalent` phase-02 |
| `gpt-5.6-sol`   | `claude-fable-5`    | `equivalent` | AA Agentic Index, July 2026: Sol 54.0 vs Fable 5 52.8. Spoke deprecated — edge kept for fallback only.                                                            | `0667c17` |
| `gpt-5.6-terra` | `claude-opus-4-8`   | `equivalent` | AA Agentic Index, July 2026: Terra 47.4 vs Opus 4.8 47.2. Spoke deprecated — edge kept for fallback only.                                                         | `0667c17` |
| `gpt-5.6-luna`  | `claude-sonnet-5`   | `equivalent` | AA Agentic Index, July 2026: Luna 45.6 vs Sonnet 5 46.7. Spoke deprecated — edge kept for fallback only.                                                          | `0667c17` |

**Deprecated spokes are one-way.** `hubToSpoke`
(`src/domain/routing/catalog.ts`) skips any spoke whose catalog entry is
`status: "deprecated"`, so a Claude phase is never routed onto a retired
provider model; `spokeToHub` does not check status, so a phase that still
names a deprecated id falls back to its Claude anchor. (Naming one in a plan
is a separate preflight failure.)

Which Claude entries lost their codex route when the GPT-5.6 variants were
deprecated: `claude-fable-5` (its only codex anchor was `gpt-5.6-sol`) and
`claude-opus-4-8` at `low`/`high`/`xhigh`/`max` (anchored only by
`gpt-5.6-terra`). Opus 4.8 keeps `medium`, via `gpt-5.5` at `xhigh`.

Consequence of the `downgrade` edges — all of Sol, and Luna at `low`: with
`allowDowngrade: true` (the default) an Opus 5.5 phase reaches codex as
`gpt-6-sol` when codex is first in priority, labelled `downgrade`; with
`false` it stays on Claude. In the other direction a Sol phase falling back to
Claude lands on Opus 5.5 as an `upgrade` under both settings. Astra ↔ Fable
5.1 and Luna ↔ Sonnet 5 above `low` are `equivalent`, so those route under
both settings.

## 4. Cost basis and phax's built-in defaults

Per-token prices are Claude Code's embedded `pricing` tiers (equal to
Anthropic's list prices). `effort_cost_index` is Claude Code's relative
token-spend multiplier per effort (`high` = 1). Intelligence Index, cost per
task and output tokens are from the Artificial Analysis model pages for the
max-effort variant (read 2026-09-07). AA's cost-per-task figures come from
different index revisions and are **not comparable across models**; they are
listed for completeness, not used to rank.

| Model                       | $/1M in / out | AA Intelligence (max) | AA $/task | Output tokens on index run | effort_cost_index low / medium / high / xhigh / max |
| --------------------------- | ------------- | --------------------- | --------- | -------------------------- | --------------------------------------------------- |
| `claude-haiku-4-5-20251001` | 1 / 5         | —                     | —         | —                          | no ladder                                           |
| `claude-sonnet-4-6`         | 3 / 15        | 29                    | n/a (AA: deprecated) | n/a              | 0.47 / 0.74 / 1 / 2.41 / 5.59                       |
| `claude-sonnet-5`           | 2 / 10        | 45                    | 3.31      | 320M                       | 0.47 / 0.74 / 1 / 2.41 / 5.59                       |
| `claude-opus-4-8`           | 5 / 25        | 48                    | 2.60      | 130M                       | 0.72 / 0.90 / 1 / 1.65 / 1.88                       |
| `claude-opus-5`             | 5 / 25        | 54                    | 4.21      | 120M                       | 0.67 / 0.76 / 1 / 1.60 / 1.70                       |
| `claude-fable-5`            | 10 / 50       | 53                    | —         | —                          | 0.60 / 0.77 / 1 / 1.74 / 1.91                       |
| `claude-fable-5-1`          | 10 / 50 (cache read 0.25) | 57        | 6.12      | 160M                       | 0.60 / 0.77 / 1 / 1.74 / 1.91                       |

Rule for a default: **the cheapest entry that does the job at least as well
as the current default**, judged on per-token price first, then tokens
generated (the energy proxy), then the index. Efforts change only when the
data says so.

| Job                | Where                                                      | Default                        | Effort   | Justification                                                                                                                                                          | Previous            |
| ------------------ | ---------------------------------------------------------- | ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Code review        | `DEFAULT_CODE_REVIEW_MODEL`, `src/schemas/phaxConfig.ts`   | `claude-opus-5`                | `high`   | Same per-token tier as Opus 4.8, fewer generated tokens (120M vs 130M), +6 index points, cheaper low/medium curve. Fable 5.1 rejected: 2× per token, a third more tokens, +3 points. | `claude-opus-4-8`   |
| Plan adjustment    | `DEFAULT_MODEL`, `src/cli/commands/adjustPlan.ts`          | `claude-opus-5`                | `high`   | Same reasoning as code review.                                                                                                                                         | `claude-opus-4-8`   |
| Compliance review  | `DEFAULT_COMPLIANCE_REVIEW_MODEL`, `src/schemas/phaxConfig.ts` | `claude-sonnet-5`          | `medium` | A third cheaper per token than Sonnet 4.6, +16 points, identical effort-cost curve; AA lists Sonnet 4.6 deprecated. Effort stays `medium`: Sonnet 5 at `max` generates 2.7× Opus 5's tokens. | `claude-sonnet-4-6` |
| Plan extraction    | `DEFAULT_EXTRACT_MODEL`, `src/schemas/phaxConfig.ts`       | `claude-haiku-4-5-20251001`    | `low`    | Cheapest tier; no newer Haiku; next candidate (`claude-sonnet-5` low) is 2× per token for a structured-extraction job Haiku passes.                                    | unchanged           |

Explicit `review.code`, `review.compliance` and `agent.extractPlan` settings
in `phax.json` always win over these defaults.

## 5. Refresh checklist

Run through this each time a provider ships or retires a model:

1. Read the ground truth for each provider (section 1); note the client
   version you read it from. Check `upgrade` pointers and `visibility` for
   retirements; a retired id becomes `status: "deprecated"`, never deleted.
2. Add entries newest-first inside their family (prepend); the first active
   entry is what an alias resolves to. Efforts exactly as read.
3. Anchor every new spoke effort straight across to the closest Claude entry
   on one capability axis; record the numbers and the relation in section 3.
   Keep `ultracode` unanchored.
4. Rebuild the cost table in section 4 and re-apply the default rule to each
   job; record the pick, the previous value and the justification.
5. `pnpm gen:model-catalog` (planner table), and if a help string changed
   `pnpm gen:usage-spec` + `pnpm docs:cli`.
6. Update `docs/model-routing.md` if a family or effort value was added, and
   append a row to the refresh log below.

## 6. Refresh log

| Date       | Change                                                                                                                             | Where                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 2026-07-13 | GPT-5.6 Sol/Terra/Luna, Claude Fable 5, Claude Sonnet 5, `ultra` effort; anchors on AA Agentic Index                              | `0667c17`                                 |
| 2026-09-07 | Claude Fable 5.1, Claude Opus 5, GPT-6 Astra (→ Fable 5.1, `downgrade`); `ultracode` on every xhigh-capable Claude entry; defaults re-pointed on cost (Opus 5, Sonnet 5) | `phax/catalog-fable-5-1-opus-5-gpt-6-astra` |
