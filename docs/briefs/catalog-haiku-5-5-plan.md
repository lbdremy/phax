Write the phax plan "Catalog: Haiku 5.5". There is no source spec: this is a catalog refresh, like `docs/plans/archive/2610051453-catalog-sonnet-5-5-plan.md`. Read that plan first and follow its shape and conventions. `docs/model-catalog.md` is the standing record: §1 sources, §2 entries, §3 anchors, §4 cost basis and defaults, §5 refresh checklist, §6 log. Each phase records its own changes there.

Ground truth, read 2026-10-13. Do not re-derive it from memory; cite it as given.
- **Claude Code 2.1.296 model table**: `/Users/remyloubradou/.local/share/claude/versions/2.1.296`.
  - `claude-haiku-5-5` is the only id (no dated variant). Family `haiku`, `fallback_3p: "claude-haiku-4-5"`, `default_effort: "medium"`, 1M context (`native_1m`), 128k max output.
  - Its capabilities include `effort`, `xhigh_effort`, `max_effort`, `adaptive_thinking` and `rejects_disabled_thinking`. Its ladder is therefore `low medium high xhigh max ultracode`, with ultracode wherever xhigh is (§2's rule). It has no `none` effort, and no `effort_cost_index` was found.
  - `claude-haiku-4-5-20251001` is still in the table.
- **Anthropic** (anthropic.com/claude-haiku-5-5):
  - Haiku 5.5 was released 2026-10-07. It costs $0.10 / $0.50 per million input / output tokens for prompts up to 100k tokens, and $0.50 / $2.50 above 100k. Cache reads are $0.01 / $0.05.
  - It is "our first Haiku-class model to come with an adjustable effort setting" (low, medium, high, xhigh, max).
  - Against Haiku 4.5, it costs "around 75% less to run" on average, and uses "slightly more tokens per task" because of an updated tokenizer.
  - "Sonnet 5.5 and Opus 5.5 remain better choices for complex agentic coding tasks." Haiku 5.5 is "best suited to more narrowly scoped tasks."
  - Terminal-Bench 4.0: Haiku 5.5 39.2%, Sonnet 5.5 70.6%.
  - These are vendor figures.
- **Artificial Analysis Intelligence Index**, fetched 2026-10-13. The scale is unchanged since 2026-10-05: Sonnet 5.5 still reads 56 at max with 420M tokens.

  | Model | Low | Medium | High | Xhigh | Max |
  |---|---|---|---|---|---|
  | Haiku 5.5 | 29 (32M tokens, $0.02/task) | 34 | 38 (97M, $0.08/task) | 41 (180M, $0.12/task) | 43 (440M, $0.21/task) |
  | Sonnet 5.5 | 36 | 41 (31M, $0.48/task) | 47 | 52 | 56 (420M) |

  No index score exists for Haiku 4.5 on this scale.

Decided with the author on 2026-10-13. Record each one in the plan's `## Technical arbitrations` with the loss accepted:
- **Add `claude-haiku-5-5` at the head of the `claude-haiku` family** in `DEFAULT_PROVIDER_CONFIG` (`src/domain/routing/defaults.ts`), so the `haiku` alias resolves to it.
  - Efforts exactly `low medium high xhigh max ultracode`. Status `active`.
  - `claude-haiku-4-5-20251001` stays `active`: Anthropic still serves it, and Mistral Vibe's `off` alias anchors to it at `none`, which Haiku 5.5 does not offer. That Vibe anchor does not move.
  - Check what a request for the `haiku` alias at effort `none` now resolves to, and cover it with a routing test. Keep whatever the resolution rules give, and record it in §2 if it changes.
- **No Codex or Vibe anchor moves.**
  - GPT-6 Luna (21/29/32/34/37) stays on Sonnet 5 (24/28/32/34/38). Haiku 5.5 (29/34/38/41/43) is not closer.
  - Haiku 5.5 gets no Codex spoke.
  - Record in §3 that it was considered and why it was not used.
- **Plan extraction default → `claude-haiku-5-5` at `low`** (`DEFAULT_EXTRACT_MODEL`, `src/schemas/phaxConfig.ts`).
  - A tenth of Haiku 4.5's per-token price ($0.10/$0.50 vs $1/$5) for a newer model.
  - Loss accepted: slightly more tokens per task (the new tokenizer).
  - Every test fixture or snapshot that hard-codes the extraction default moves in the same phase. Find them with `grep` for `claude-haiku-4-5` across `tests/` and `src/`. Keep the fixtures that only use Haiku 4.5 as a sample id.
- **Compliance review stays on `claude-sonnet-5-5` at `medium`.** Haiku 5.5 reaches the same index (41) only at `xhigh`. That is about 4× cheaper per task ($0.12 vs $0.48), but it generates about 6× more tokens (180M vs 31M), the energy proxy, and Anthropic ranks Haiku below Sonnet for agentic work. Record this re-check in §4's justification column.
- **Code review and plan adjustment stay on `claude-opus-5-5` at `high`** (54). Haiku 5.5 tops out at 43.
- **The planning skill does not recommend Haiku 5.5 for phases.** Phases are agentic coding, where Terminal-Bench puts Haiku 5.5 at 39.2% against Sonnet 5.5's 70.6%. The default phase model stays `claude-opus-5-5`, and mechanical phases stay on `claude-sonnet-5-5`.
  - The generated catalog table in `.claude/skills/phax-planning/SKILL.md` is refreshed only by `pnpm gen:model-catalog`, never by hand.
- **Real-provider check, outside the gates.** The plan's last handoff names one real `phax run` extraction (or `pnpm test:e2e:real`) as the author's check, after the merge, of the new extraction default on Claude Code 2.1.296. No phase runs it. The e2e fixture's explicit `claude-haiku-4-5-20251001` at `none` is left alone: its own follow-up in NEXT_STEPS covers it.

Phase shape: two phases, as few as the gates allow.
1. The Claude catalog entry, its routing tests, §2 of `docs/model-catalog.md`, and `pnpm gen:model-catalog`.
2. The extraction default and its fixtures; the §3 note; the §4 cost table (Haiku 5.5 row, with no `effort_cost_index`) and its re-checked defaults table; and the §6 refresh-log row.

Constraints:
- The plan's own phases name only models in the installed binary's catalog (0.22.0), which has no `claude-haiku-5-5`. Use `claude-opus-5-5` or `claude-sonnet-5-5`.
- Ids and efforts exactly as read above.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli` only if a help string changes. Check whether any help string names the extraction default.
- The plan carries `completes-spec: false`, since there is no source spec.
- It must pass `phax plans lint`. Every phase is verified by the `standard` gate profile, and every command a phase runs must be allowed by `phax.json`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
