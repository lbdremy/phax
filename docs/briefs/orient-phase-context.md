Write the phax spec `orient-phase-context`: the orient provider's two requests carry the phase they serve — the index request the plan's projection, so the provider ranks its rows by what this phase is to do before phax keeps the first 50; the expand request the files, so a row expanded during a phase answers *where do I stand here*, not only *what is this rule*.

Decided with the author on 2026-10-05 — the spec must reflect these, not reopen them:
- **The problem.** The index request is `{"files": [...]}`, the phase's planned files and nothing else; phax weaves at most 50 rows (`MAX_ORIENTATION_ROWS`) in the provider's order and hides the rest. A provider that knows a whole standard returns every row that applies to those files, unranked: in steme's example change, 62 rows, so twelve are hidden by position, not by relevance. The provider cannot rank by what the phase is to do, because it does not know which phase it is or what the later phases plan. The expand request is `{"expand": "<id>"}`: the provider can only return the rule in general, never the rule's state in the files at hand (where it applies, what is already met, what is still missing, the repair). steme-corpus `02-product/phax-steme-coordination.md`, changes 4 and 5.
- **phax ranks nothing and filters nothing.** The provider's order is the rank; phax keeps the first 50 as today and says how many are hidden. What the requests gain is facts, never a judgement, as with the gate request.
- **The facts are the gate request's.** The phase, the commit it started from, whether it is terminal, and the plan's projection `{id, files}` per phase (spec `gate-request`, Approved). Orient should not invent a second shape for the same facts; the spec decides how the two share it.
- **Additive.** A provider that reads only `files` and `expand` keeps working unchanged; `phax orient --file <path>` and `phax orient <id>` outside a run keep working without phase context.
- **The first consumer is steme's orient projection** (roadmap-1.0 item 0.13, not built yet): it ranks the index by what is due in the phase (the places the phase closes first) and fills the expand body with the guarantee, its instances in those files with their state, and the repair. It is built against these requests, so the spec lands before that item.
- **The severity word stays phax's** (`"warn"`); steme aligns on it. Nothing to change in phax there.

Ground to read first, in this order:
- /Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md — §"Along a run" (phase start, in phase), §"What is lost, or latent" (the cap), §"The changes" (rows 4 and 5).
- docs/specs/2610051439-gate-request.md (Approved): the request's fields, `base` for a fresh, resumed, reset and appended phase, `phases` for an appended run.
- `phax --usage`, cmd orient; README §Orient provider.
- `src/app/orient.ts`, `src/app/providerQuery.ts`, `src/schemas/orient.ts`, `src/schemas/orientBrief.ts` (the `orient-brief.json` record), `src/app/executePlan.ts` (where the index is queried at phase start), `src/app/promptGeneration.ts` (the weaving, `MAX_ORIENTATION_ROWS`, the hidden-rows line), `src/cli/commands/orient.ts` (`phax orient` runs in the phase worktree with no run context: no marker file or env var ties the worktree back to its run — see `src/app/worktree.ts`).
- `examples/hello-world/orient.mjs`.
- NEXT_STEPS.md §"Road to 1.0.0": CLI and config contract about to freeze; additive changes only.

What the spec must cover:
- The index request after the change, in full, and what phax sends at phase start, on a resumed or reset phase, and for `phax orient --file <path>` run inside and outside a phase.
- The expand request after the change: which files it carries (the phase's planned files; or those plus what the phase has touched so far, read from git; or files the agent names), and how `phax orient <id>`, run by the agent inside the phase worktree, learns the phase it is in.
- Whether the requests gain a `$schema` and become persisted, and whether `orient-brief.json` records the request it was answered for.
- The weaving: the cap and the hidden-rows line unchanged, the provider's order kept and documented as its rank.
- Docs: `phax --usage` (cmd orient), README §Orient provider, the hello-world example.
- Open questions in §9 with options, losses and a recommended default; at least: how the facts are shared with the gate request (the same document with `files`/`expand` added, the same fields inline, or a nested `phase` object); how `phax orient` inside a worktree finds its phase (a marker written by phax into the worktree, an environment variable in the agent's session, flags the agent passes, or no context at all); which files the expand request carries; whether `--file` inside a phase sends the phase context; whether the requests are persisted.

Constraints: additive; nothing changes for a provider that ignores the new fields; phax computes no rank, no relevance and no state; keep to what the first consumer needs and name what is out of scope (the cap's value, a diagnostic `id`, accepted debt, the `brief` provider at plan authoring — later specs from the same coordination note).

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
