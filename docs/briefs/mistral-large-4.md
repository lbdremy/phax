Write the phax spec `mistral-large-4`: phax's catalog lists Mistral Large 4 (Vibe's alias `mistral-large-4-0`), a
plan phase or a configured job can name it, its equivalence edges say honestly where it sits on the Claude ladder,
and a provider the operator disabled is never the one that runs.

## Why

- The operator chose on 2026-11-19 to add `mistral-large-4-0` to phax's catalog and route to it explicitly
  (NEXT_STEPS, "Waiting on the operator"). It is Vibe 3.1.3's default model, served on the Mistral Pro subscription.
  It has already done real work for phax: the 2026-11-23 security audit
  (`docs/security/reports/2026-11-23-mistral-large-4-0-high-security-report.md`) ran on it at `high`, outside phax,
  because a plan cannot name it today: preflight answers `model id "mistral-large-4-0" not found in catalog`
  (`src/domain/routing/preflight.ts:94`).
- The only Mistral model in the catalog, `mistral-medium-3.5`, sits a generation below its anchors (figures below).
- Routing falls back to Claude Code even when the operator disabled it. `resolveModel` skips disabled providers in its
  priority loop (`src/domain/routing/resolve.ts:384`), then calls `terminalClaudeCode` (`:403-406`), which never reads
  `enabled` (`:271-364`); its last resort is `"No matching provider …; defaulted to claude-code/claude-sonnet."`. Only
  plan phases are protected, by preflight (`preflight.ts:120-133`). A job configured to run on Mistral — code review,
  compliance, authoring, verdicts — therefore runs on Claude without an error when Vibe is disabled, and runs on Claude
  even when Claude is the one disabled.

## Facts (read 2026-11-24)

**Vibe 3.1.3's built-in table** (`vibe/core/config/vibe_schema.py`, `DEFAULT_ACTIVE_MODEL_CONFIG`): alias and name
`mistral-large-4-0`, display name "Mistral Large 4", `thinking_levels = ["low", "medium", "high"]`, default
`thinking = "high"`, input $0.70 / output $2.10 / cached input $0.07 per million tokens, context 1,048,576, auto-compact
at 400,000, images supported. Mistral's announcement gives the same prices.

**A real call per level** (2026-11-24, Vibe 3.1.3, `vibe -p "Reply with the single word OK." --model mistral-large-4-0
--thinking <level> --max-turns 1 --output-dir …`):

| `--thinking` | Exit | Answer | Export `config.models.mistral-large-4-0.thinking` | Output tokens |
| --- | --- | --- | --- | --- |
| `off` | 0 | OK | `"off"` | 17 |
| `low` | 0 | OK | `"low"` | 23 |
| `medium` | 0 | OK | `"medium"` | 23 |
| `high` | 0 | OK | `"high"` | 23 |
| `xhigh` | 2 | — | — | HTTP 400 `reasoning_effort xhigh is not supported for this model, supported values: [high, low, medium]` |
| `max` | 2 | — | — | HTTP 400, same message for `max` |

The API serves `low`, `medium` and `high`. It also accepts `off`, which Vibe's own table does not list. The export
records the level phax asked for (`config.models.<alias>.thinking`), so a confined turn can check it.

**Where it sits.** One question per axis, each from a single read:

| Axis | What it measures | Mistral Large 4 | Claude neighbours |
| --- | --- | --- | --- |
| Epoch Capabilities Index (`epoch.ai/data/eci_scores.csv`) | Model alone, one scale across generations, one score per model | 154.6 (CI 151.8–157.4) | Opus 4.6 156.3, Sonnet 4.6 152.9, Opus 4.5 151.9; Opus 4.8 159.9, Haiku 5.5 160.3, Sonnet 5.5 166.6 |
| AA Intelligence Index v5.0.1 | Model alone, per effort | `high` 26, `medium` 23 | Sonnet 5.5 26/31/42/50/55, Haiku 5.5 19/25/30/35/36 (low→max) |
| AA Coding Agent Index v2.1 (`artificialanalysis.ai/agents`, data embedded in the page) | Model in its own harness | Vibe + `high` 40.6 ($1.34/task), Vibe + `medium` 29.6 | Claude Code + Haiku 5.5 max 29.6 ($2.25), + Fable 5.2 low 48.0, + Sonnet 5.5 max 56.3 |
| Terminal-Bench 4.1 (`tbench.ai`), all in Claude Code | Model in another vendor's harness | `max` 27.6% | Opus 4.8 max 23.6%, Haiku 5.5 max 40.0% |

Reading:
- The ECI places Mistral Large 4 in the Claude 4.5/4.6 generation, statistically tied with Opus 4.5, Sonnet 4.6 and
  Opus 4.6. The operator's planning ran well on Opus 4.5.
- No current Claude rung is equivalent to it, so from any current Claude model it can only be a `downgrade`.
- Across one harness, Vibe ≈ Claude Code: AA ran GLM-5.3-Flash at 38.9 in Claude Code and 36.8 in Vibe, and
  GPT-6 Luna at 22.2 and 21.4.

**AA re-scaled its index again (v5.0.1).** Sonnet 5.5 went from 36/41/47/52/56 to 26/31/42/50/55. So every Claude
figure in `docs/model-catalog.md` is from an older scale.

**`mistral-medium-3.5`** is level with Claude Haiku 4.5 on every axis that scores both:

| Axis | `mistral-medium-3.5` | Claude Haiku 4.5 |
| --- | --- | --- |
| ECI | 141.6 | 142.7 |
| Vals SWE-bench Verified | 66.4% | 66.6% |
| Vals Terminal-Bench 2.0 | 30.3% | 38.2% |

It scores 5 on AA v5.0.1. Its `high` edge to Sonnet 4.6 `high` overstates it: Sonnet 4.6 scores 152.9 on the ECI
and 59.6% on Terminal-Bench 2.0.

**Rejected sources.** BenchLM ("56.4" for ML4) and LLM Stats score on their own unnamed composites. A table mixing
BenchLM's 56.4 with AA's 59.1 / 54.5 for Claude compares two scales. Use neither.

## Settled (operator, 2026-11-24 — do not reopen)

1. **Explicit routing.** A plan phase or a configured job names `mistral-large-4-0`. A request for a current Claude
   model never reaches it by equivalence.
2. **Level equivalence, not task equivalence.** The edges state the model's level honestly: the Claude 4.x generation.
   Whether a task can run on a lower generation than the plan's default is its own question, in
   `docs/briefs/single-provider.md`, not here.
3. **Axes.** The ECI decides which Claude generation and model anchors a spoke, because it is the only axis that stays
   comparable across generations. AA's Intelligence Index places efforts, compared only within one read.
   The Coding Agent Index is the check in the harness phax actually runs. `docs/model-catalog.md` §1 records all three.

## What the spec must cover

- **Efforts, from the real calls above** (the catalog's rule, §1 of `docs/model-catalog.md`): `low`, `medium`, `high`.
  `xhigh` and `max` are refused by the API. Whether `off` joins them is a §9 choice: the API accepts it, but Vibe's
  table omits it, and nothing shows it disables reasoning beyond a shorter answer. tbench.ai's "max" label is not a
  level the API serves.
- **The catalog entry and its family.** Whether `mistral-large` is a new family, or Large 4 joins the existing
  `mistral-medium` one. It is a different model line, and a family's first active entry is what an alias resolves to.
- **The edges** (see §9), stated hub-centric as today, with the numbers and read dates in `docs/model-catalog.md` §3.
- **A disabled provider never runs** (see §9), for phases and for every configured job. That covers code review,
  compliance, authoring and revise, verdicts, and the decide and extraction paths where they route. The refusal names
  the request, the disabled provider, and the setting that enables it.
- **Defaults re-checked on cost**, as every catalog addition does (`docs/model-catalog.md` §4). ML4 sits below Sonnet 5.5
  and Opus 5.5, so the review, compliance and authoring defaults should stay put. Plan extraction and decide stay on
  Claude (hard-coded, see `single-provider`). Record the re-check either way.
- **The planner's catalog table** (`pnpm gen:model-catalog`) lists the new id. `PHASE_MODEL_POLICY` keeps naming Claude
  models (settled 1).
- **Acceptance**:
  - a real Vibe session at each catalogued effort;
  - a one-phase run naming `mistral-large-4-0` that records the model, the effort and the cost;
  - `phax plans lint` accepting the id;
  - a job configured on Mistral with Vibe disabled, refused rather than run on Claude.
- **Docs**:
  - `docs/model-catalog.md` §1–§6: the sources, the entry, the edges with the three axes, the cost table, and a
    refresh-log row.
  - `docs/model-routing.md` if a family is added.
  - The README's Vibe section.
  - `docs/upgrading.md` if `mistral-medium-3.5` is retired.

## §9 — choices (options, the dominant loss of each, a recommended default)

- **The anchor of Large 4's efforts.**
  - **Sonnet 4.6, straight across** (`low`/`medium`/`high` → same effort): the ECI tie, and the catalog's "efforts map
    straight across" rule. Loses: a Large 4 phase falling back to Claude runs on Sonnet 4.6, which costs $3/$15 against
    Sonnet 5.5's $2/$10 and is weaker.
  - **Sonnet 5.5 `low`** for `high` (26 = 26 on AA v5.0.1). Loses: Mistral is first in the default priority, so with
    Vibe enabled every Sonnet 5.5 `low` phase would reach Large 4 as `equivalent`. That is implicit routing, against
    settled 1.
  - **Recommended: Sonnet 4.6.** Nobody names Sonnet 4.6 any more, so it keeps the routing explicit in practice.
    Fallback is the rare case.
- **`mistral-medium-3.5`.**
  - **Deprecate it** (a deprecated id is kept, never deleted; its edges become fallback-only). Loses: Vibe's `off`
    level, the only Mistral route for a Haiku 4.5 `none` request.
  - **Keep it active, re-anchored on the ECI** (`high` → Haiku 4.5). Loses: two Mistral spokes, and a spec that must
    say which one a hub request picks.
  - **Recommended: deprecate**, unless the effort check finds Large 4 serves no cheap level.
- **`off` for Large 4.**
  - **Leave it out** (recommended): Vibe's own table, the model's publisher's word, omits it. Loses: a cheap no-reasoning
    level on Large 4, which matters only if `mistral-medium-3.5` is deprecated and its `off` route to Haiku 4.5 `none`
    goes with it.
  - **List it**, anchored to Haiku 4.5 `none`, as Medium 3.5's `off` is today. Loses: a level resting on an API leniency
    that Mistral may close without notice.
- **A disabled provider.**
  - **Claude stays the terminal fallback only while `claude-code` is enabled; with nothing enabled to serve the
    request, refuse** (recommended). Loses: an install with Claude disabled and a gap in its edges stops instead of
    running.
  - **Refuse whenever the requested provider is disabled**, even with Claude enabled. Loses: the fallback AGENTS.md
    promises ("Claude Code is the default and fallback").
  - **Keep the fallback, and print the substitution as a warning.** Loses: the operator's switch still means nothing.

## Constraints and scope

- Out of scope:
  - the catalog refresh that re-reads every other anchor on AA v5.0.1 and adds Claude Fable 5.2 (AA lists it at 65);
  - everything in `single-provider` (decide and extraction on Vibe, cost ledger and estimate for Vibe, planner doctrine
    per provider, task floors).
- A real-provider test runs deliberately (`pnpm test:e2e:real`). Unit tests never reach the Mistral API.
- No persisted format changes beyond what a new catalog id needs. Records already carry the model id and Vibe's
  `costUsd`.
