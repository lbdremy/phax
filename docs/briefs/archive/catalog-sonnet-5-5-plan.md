Write the phax plan "Catalog: Sonnet 5.5". There is no source spec: this is a catalog refresh, like `docs/plans/archive/2609230815-catalog-opus-5-5-gpt-6-sol-luna-plan.md`. Read that plan first and follow its shape and its conventions. `docs/model-catalog.md` is the standing record: §1 sources, §2 entries, §3 anchors, §4 cost basis and defaults, §5 refresh checklist, §6 log. Every change below is recorded there in the same phase that makes it.

Ground truth, read 2026-10-05. Do not re-derive it from memory; cite it as given.
- **Claude Code 2.1.289 model table**: `/Users/remyloubradou/.local/share/claude/versions/2.1.289`.
  - `claude-sonnet-5-5` is the only id (no dated variant). Family `sonnet`, `fallback_3p: "claude-sonnet-5"`, `pricing: "tier_2_10"`, `default_effort: "medium"`, 1M context, 128k max output.
  - Its capabilities include `xhigh_effort` and `max_effort`, so its ladder is `low medium high xhigh max ultracode` (ultracode wherever xhigh is, per §2's rule). It has no `effort_cost_index`.
  - `claude-sonnet-5` is still in the table: `tier_2_10`, `effort_cost_index` 0.47 / 0.74 / 1 / 2.41 / 5.59.
- **Anthropic** (platform.claude.com pricing and models overview; anthropic.com/claude-sonnet-5-5):
  - Sonnet 5.5: released 2026-09-28, $2 / $10 per million tokens, "Active (latest)". Sonnet 5: same price, listed under "Legacy models (still available)", no deprecation date.
  - The announcement claims 30%+ faster and up to 30% cheaper per task than Sonnet 5 at the same price (a vendor figure). It lists breaking API changes from Sonnet 5, including that forced tool use now errors.
- **Artificial Analysis Intelligence Index**, fetched 2026-10-05, same scale as the 2026-09-23 read: Opus 5.5 and Fable 5.1 are unchanged. Scores low/medium/high/xhigh/max:

  | Model | Low | Medium | High | Xhigh | Max | Index tokens (max) |
  |---|---|---|---|---|---|---|
  | Sonnet 5.5 | 36 | 41 | 47 | 52 | 56 | 420M |
  | Sonnet 5 | 24 | 28 | 32 | 34 | 38 (now listed deprecated) | 370M |
  | Opus 5.5 | 42 | 51 | 54 | 56 | 58 | 260M |
  | Fable 5.1 | 47 | 49 | 51 | 53 | 53 | 190M |

  Codex models for the anchors (the 2026-09-23 read, still in §3): GPT-6 Sol 34/40/43/44/48, GPT-6 Luna 21/29/32/34/37, GPT-6 Astra 46/50/51/52/53.

Decided with the author on 2026-10-05; record each in the plan's `## Technical arbitrations` with the loss accepted:
- **Add `claude-sonnet-5-5` at the head of the `claude-sonnet` family** in `DEFAULT_PROVIDER_CONFIG` (`src/domain/routing/defaults.ts`), so the `sonnet` alias resolves to it.
  - `claude-sonnet-5` stays `active`, as Opus 5 did: Anthropic still serves it.
  - Rejected: deprecating Sonnet 5, which would cut GPT-6 Luna's anchor.
- **Re-anchor GPT-6 Sol from Opus 5.5 to Sonnet 5.5.** Sonnet 5.5 is closer at every effort.
  - Relations, under §3's rule (`equivalent` within about one point): low 34 vs 36 is `downgrade`; medium 40 vs 41 is `equivalent`; high 43 vs 47, xhigh 44 vs 52 and max 48 vs 56 are `downgrade`.
  - Loss accepted: **Opus 5.5 loses its only Codex route.** phax's default phase model becomes Claude-only, so an Opus 5.5 phase never reaches Codex whatever the priority or `allowDowngrade` says. A Sol phase falling back to Claude lands on Sonnet 5.5.
  - Record this consequence in §3's "Which Claude entries lost their codex route" paragraph, and cover it with routing tests: Opus 5.5 has no Codex spoke; Sonnet 5.5 routes to Sol, labelled per effort.
  - Rejected: keeping Sol → Opus 5.5 (a less exact anchor), and splitting Sol by effort (an anchor table hard to reason about).
- **GPT-6 Luna stays anchored to Sonnet 5** (within a point from `medium` up), and **GPT-6 Astra stays ↔ Fable 5.1**. Neither moves.
- **Compliance review default → `claude-sonnet-5-5` at `medium`** (`DEFAULT_COMPLIANCE_REVIEW_MODEL`, `src/schemas/phaxConfig.ts`): same price, 41 vs 28 at medium.
  - Loss accepted: about 13% more output tokens on the max-effort index run (420M vs 370M); no per-effort figure exists.
  - Code review and plan adjustment stay on `claude-opus-5-5` `high` (54). Sonnet 5.5 beats that only at `max`, where Sonnet 5's cost index was 5.59× high, and it spent 420M index tokens against Opus 5.5's 260M.
  - Plan extraction stays on `claude-haiku-4-5-20251001` `low`.
  - Rebuild §4's cost table with Sonnet 5.5 (no `effort_cost_index`; say so, as for Opus 5.5).
- **Planning guidance.** The `phax-planning` skill's "Choosing a model and effort" (`.claude/skills/phax-planning/SKILL.md`) recommends `claude-sonnet-5` for mechanical phases; it becomes `claude-sonnet-5-5`. The default phase model stays `claude-opus-5-5`.
  - The generated catalog table in that skill is refreshed by `pnpm gen:model-catalog`, never edited by hand.
- **Real-provider check, not in the gates.** The gates never call a real provider, and Sonnet 5.5 changed API behaviour (forced tool use errors). The plan's last handoff names `pnpm test:e2e:real` (or one real `phax review-compliance`) as the author's post-merge check of the new compliance default. No phase runs it.

Phase shape, following the 2026-09-23 plan: (1) the Claude catalog entry; (2) the Sol re-anchor with its routing tests; (3) defaults, planning guidance and the `docs/model-catalog.md` refresh-log row. Merge or split phases only if the gates require it. Every test fixture that hard-codes the Sonnet family's first entry or Sol's anchor must be updated in the phase that changes it. Find them with `grep` for `claude-sonnet-5` and `gpt-6-sol` across `tests/`.

Constraints:
- A plan that changes the catalog must name only models already in the shipped catalog for its own phases: the run-start preflight uses the installed binary's catalog (0.18.0), which has no `claude-sonnet-5-5`. Use `claude-opus-5-5` or `claude-sonnet-5` for the phases.
- Ids and efforts exactly as read above. Status `active`.
- `pnpm gen:model-catalog` after the catalog change. `pnpm gen:usage-spec` and `pnpm docs:cli` only if a help string changes.
- Gate: the plan must pass `phax plans lint`; every phase is verified by the `standard` gate profile, and every phase's commands must be allowed by `phax.json`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
