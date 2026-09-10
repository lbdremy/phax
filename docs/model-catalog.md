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
`docs/plans/2609070832-catalog-fable-5-1-opus-5-gpt-6-astra-plan.md` landed.

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
| `claude-sonnet-4-6`         | `claude-sonnet` | `low medium high max`                            | No `xhigh_effort` capability, hence no `ultracode`                                                     | initial catalog          |
| `claude-sonnet-5`           | `claude-sonnet` | `low medium high xhigh max ultracode`            | `xhigh_effort`; `ultracode` added when Claude Code 2.1.263 was confirmed to gate it on xhigh only     | `0667c17`; ultracode phase-01 |
| `claude-opus-4-8`           | `claude-opus`   | `low medium high xhigh max ultracode`            | `xhigh_effort`                                                                                          | initial catalog          |
| `claude-opus-5`             | `claude-opus`   | `low medium high xhigh max ultracode`            | Claude Code 2.1.263 table, `xhigh_effort`, knowledge cutoff May 2026                                   | phase-01                 |
| `claude-fable-5`            | `claude-fable`  | `low medium high xhigh max ultracode`            | `xhigh_effort`; ultracode added phase-01                                                                | `0667c17`; ultracode phase-01 |
| `claude-fable-5-1`          | `claude-fable`  | `low medium high xhigh max ultracode`            | Claude Code 2.1.257+ (`latest_per_family.fable`), released 2026-09-01, `xhigh_effort`                  | phase-01                 |

Order inside a family is oldest first: `pickActiveEntry` resolves an alias
(`opus`, `gpt`, …) to the first active entry, so prepending a new version
silently changes what an alias means.

### codex-cli

| Id              | Efforts                            | Read from                                                                 | Since     |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------- | --------- |
| `gpt-5.5`       | `low medium high xhigh`            | codex registry                                                            | initial   |
| `gpt-5.6-sol`   | `low medium high xhigh max ultra`  | codex registry (0.144.x); still `visibility: list`, no `upgrade`, in 0.153.4's bundled catalog even though the account registry read 2026-09-07 omitted it | `0667c17` |
| `gpt-5.6-terra` | `low medium high xhigh max ultra`  | codex registry                                                            | `0667c17` |
| `gpt-5.6-luna`  | `low medium high xhigh max`        | codex registry (caps at `max`)                                            | `0667c17` |
| `gpt-6-astra`   | `low medium high xhigh max ultra`  | codex 0.153.4 bundled catalog; `minimal_client_version` 0.153.0; released 2026-09-03 | phase-02 |

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

| Spoke           | Anchor              | Relation     | Basis                                                                                                                                                             | Since     |
| --------------- | ------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `gpt-5.5`       | `claude-sonnet-4-6` (low/medium/high), `claude-opus-4-8` medium (xhigh) | `equivalent` | Original spec §12 table                                                                                                                                            | initial   |
| `gpt-5.6-sol`   | `claude-fable-5`    | `equivalent` | AA Agentic Index, July 2026: Sol 54.0 vs Fable 5 52.8                                                                                                             | `0667c17` |
| `gpt-5.6-terra` | `claude-opus-4-8`   | `equivalent` | AA Agentic Index, July 2026: Terra 47.4 vs Opus 4.8 47.2                                                                                                          | `0667c17` |
| `gpt-5.6-luna`  | `claude-sonnet-5`   | `equivalent` | AA Agentic Index, July 2026: Luna 45.6 vs Sonnet 5 46.7                                                                                                           | `0667c17` |
| `gpt-6-astra`   | `claude-fable-5-1`  | `downgrade`  | AA Intelligence Index, 2026-09-07, low/medium/high/xhigh/max: Astra 49/52/53/54/55 vs Fable 5.1 51/53/54/56/57 (1–2 under at every effort). Opus 5 (44/50/52/53/54) was rejected: it would leave Fable 5.1 with no codex route. | phase-02 |

Consequence of the one `downgrade` edge: with `allowDowngrade: true` (the
default) a Fable 5.1 phase still reaches codex when it is first in priority,
labelled `downgrade`; with `false` it stays on Claude. An Astra phase falling
back to Claude lands on Fable 5.1 as an `upgrade` in both settings.

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
2. Add entries oldest-first inside their family; efforts exactly as read.
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
