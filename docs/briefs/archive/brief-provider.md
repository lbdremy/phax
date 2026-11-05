Write the phax spec `brief-provider`: a brief provider, designed from the agent's need on a green field. `drop-orient` has already removed the `orient` provider, `phax orient`, its prompt section and `orient-brief.json`, so this spec only adds and removes nothing. A **brief** is feed-forward and only informative: it never blocks. The gate's diagnostics step is the **audit**: it blocks. The brief is woven into the phase's first prompt from the plan, and the agent asks for more during the phase with the same command, `phax brief`, on any file it sees fit — existing or not.

This replaces the spec approved on 2026-10-05 as `brief-replaces-orient` (`docs/specs/archive/2610051526-brief-replaces-orient.md`, abandoned 2026-10-06), which also retired orient. The author has since decided that the removals come first (2026-10-06): `drop-orient`, `drop-gate-scopes` and then `gate-request` land before this spec. So this spec is purely additive. It names orient only where the ground needs history (what the old orient lacked, which motivates the design), never as something to retire, alias or migrate. Its §9 Q1–Q6 (structured answer; `.phax-context/brief-request.json`; its own `brief-request` format sharing the gate request's facts by value; a cap of 50 guarantees; no `phax brief <id>`; no severity) were decided by the author on 2026-10-05. Carry each over verbatim as a decided question, and do not reopen any of them.

**Provider answers carry `$schema` too (author, 2026-10-06).** Every JSON document that crosses a provider boundary is versioned, in both directions, so several versions can be supported.
- The brief answer a provider prints carries a required `$schema` naming its own persisted format (e.g. `brief-answer`) and the release whose shape it is written in.
- phax decodes every answer version it supports and refuses a newer one by name.
- An answer with no `$schema` is a failed brief (reported, never blocking, as any failure). There is no fallback.
- The answer format is published in `@lbdremy/phax-schemas` beside `brief-request` and `brief-record`. Say how `brief-record` holds the answer: as printed, with its `$schema`.
- Update every surface example, acceptance criterion and the hello-world brief provider so they print `$schema`.

**This spec is re-authored a second time (2026-10-06).** The version approved earlier that day (`docs/specs/archive/2610060952-brief-provider.md`) is abandoned only to add the rule above. Carry over its §9 Q1–Q9 verbatim as decided questions, and add the answer-`$schema` rule as one more decided question.

Decided with the author on 2026-10-05/06 — the spec must reflect these, not reopen them:
- **The need, by moment.** Before writing, the agent needs what the project's standard expects of what it is about to touch: which guarantees range over the planned files, and which of them are due at the end of this phase rather than later. While writing, on any file it sees fit, planned or not, existing or not yet created: which guarantees range over that path and the **state** of each there — met, missing (what, where), something forbidden present, accepted debt to leave alone — with the statement and the repair. Where the phase stands before handing in is not the brief's job: the agent already runs the gate's commands itself — they are listed in its first prompt — `steme audit` among them, with the provider's own flags when no request is on stdin.
- **The answer carries state, not only the rule.** The retired orient returned rows `{id, title, severity, trigger}` and, on expand, a body: the rule in general. A brief answers from what the provider knows of the code (for steme, its ledger): per guarantee and place, its state and repair. The pushed brief is compact (it is in the prompt); a pulled one comes whole.
- **One provider, one request, two verbs.** The brief and the audit are two commands of the same provider (`steme brief`, `steme audit`) and read the same request document: the facts of the phase from spec `gate-request` (Approved) — phase, base, terminal, the plan's projection — plus, for a brief, the files asked about when the agent names some. Reading the same facts and the same ledger, the two cannot disagree on a state. phax sends facts, never a judgement: it ranks nothing, filters nothing, computes no state.
- **`phax brief` is how the agent reaches it**: phax adds the phase's facts, stays provider-neutral, and records the call. It is allowed to the in-phase agent without an `agentCommands` grant. `drop-orient` removed the grant orient had, so this spec defines its own grant and its `security.json` source. Run outside a phase, it sends no phase facts and the provider briefs the files as the code stands.
- **`phax brief` with no path** during a phase asks again for the phase's brief, the one woven at phase start; with paths, for those paths.
- **Never blocks.** A brief that fails, times out or answers nothing is reported and the phase goes on.
- **Purely additive.** orient is already gone (spec `drop-orient`). Add the `brief` provider key, `phax brief`, the prompt section, the records, the README section and a hello-world example provider. Nothing is retired here.
- **The hello-world example gains a brief provider** (a small static one), so the README's example and the example-provider tests have something to run.
- **The first provider is steme** (`steme brief`, steme roadmap-1.0 item 8, not built yet; it reads the ledger built by item 0.13). The spec lands before steme builds it.

Ground to read first, in this order:
- /Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md — §"Along a run", §"What is lost, or latent" (severity, the cap), §"The changes" (rows 4 and 5, which this spec supersedes), §"The architecture brief, at plan authoring" (a later moment of the same verb, out of scope here).
- the specs `gate-request`, `drop-gate-scopes` and `drop-orient` (Drafts or Approved under `docs/specs/`): the request's facts, `base` for fresh/resumed/reset/appended phases, how a step declares the request, the saved copy beside the attempt, and the extension points as the drops leave them.
- The abandoned spec `docs/specs/archive/2610051526-brief-replaces-orient.md` and its sidecar: its context and surface are the ground for this design, minus the retirement.
- `src/app/providerQuery.ts` (the provider contract every extension point shares), `src/app/executePlan.ts` (where a phase starts), `src/app/promptGeneration.ts` (the first prompt), `src/app/worktree.ts` (nothing ties a worktree back to its run, which is why §9 Q2 chose a file in `.phax-context/`). Read them as `drop-orient` leaves them.
- The headless authoring `--brief` flag and `docs/briefs/`: "brief" already names what an authoring agent is given before it writes; say how the two uses sit together.
- NEXT_STEPS.md §"Road to 1.0.0": the CLI and config contract freeze — this changes surface on purpose before it.

What the spec must cover:
- The config: the `brief` provider key, its schema and `phax schema upgrade`. No special treatment for a leftover `orient` key: it is an unknown key like any other since `drop-orient`.
- The request in full: the gate request's facts plus `files`; what is sent at phase start (pushed), by `phax brief` with no argument, with paths, inside and outside a phase; how a path that does not exist is sent; whether the document is the gate request's format or its own.
- How `phax brief`, run by the agent inside the phase worktree, learns the phase it is in.
- The answer: its shape (structured, so phax renders the pushed and pulled forms and records them; or text the provider renders), the states, the statement and repair, the compact form woven into the prompt and the whole form printed on demand, the order (the provider's, as rank) and whether a cap remains on the pushed form.
- What is recorded: the request and answer of the pushed brief and of each pulled one, in the phase record and `phax records explain`.
- The in-phase prompt: the brief section and its instructions to the agent.
- §9: the six decided questions carried over, plus any genuine new choice the ground forces, with options, losses and a recommended default.

Constraints: the brief never blocks and phax judges nothing in it; keep to what the first consumer needs; name what is out of scope (the brief at plan authoring — the same verb at an earlier moment, a later spec; the audit and the gate — `gate-request` and `drop-gate-scopes`; orient's removal — `drop-orient`; a diagnostic `id`, accepted debt in the audit's document, ranges, structured repair, a decision class).

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
