Write the phax plan "Cost ledger" for the approved spec `docs/specs/2610160919-cost-ledger.md`. It is the only plan for that spec, so it carries `completes-spec: true`. Read the spec in full; its §9 is empty and its two arbitrations are settled: Q1 B (ledger at run time plus a one-shot backfill), Q2 A (correct the cumulative quirk by the reported Claude Code version). Do not reopen them.

Decided with the author on 2026-10-16: cost-ledger runs second among the three approved specs, after phase-prompt-scope (merged) and before plan-estimate, which reads this ledger as its history and calibration source. Shape the ledger so plan-estimate can read it without re-deriving anything from a stream.

In scope: every requirement §5.1–§5.7, the §6 surface (the ledger and the backfill command) and every §8 criterion.

Ground to read:
- **The reference:** `spikes/plan-estimate/phax_estimate.py`, `scan_streams` and `per_invocation` (the cumulative delta against the previous invocation of the same session, keyed by `session_id`, from `claude_code_version` ≥ 2.1.268 in the stream's `init` event; the rate-limit sampling interleaved with assistant-message cost), and `spikes/plan-estimate/README.md`.
- **Where Claude invocations of a run happen and where their streams land:** the phase turn and the resume paths in `src/app/executePlan.ts` (`phase-NN/output.jsonl`), the fix loop in `src/app/fixLoop.ts` with `src/domain/gate/attemptFiles.ts` (`fix-attempt-NN.jsonl`), `src/app/handoffGeneration.ts` (`handoff-generation.jsonl`), `src/app/reviewCompliance.ts` (`compliance-review.session.jsonl`, run-level, so `phase: null`), and the `Backend` port's `runAgent` (`src/ports/backend.ts`, `src/app/eventAdapter.ts`). A rate-limited invocation ends without a result event (`RateLimitDetected`); that is the §5.4 partial case.
- **Which provider ran an invocation (§5.7):** the model-routing layer decides per phase; a phase routed to `codex-cli` or Mistral Vibe writes no entry.
- **Existing stream parsing:** `src/domain/records/usage.ts` (`extractClaudeUsage`) and `src/schemas/claudeOutput.ts`. Run records' existing `usage` stays exactly as it is (§10).
- **Persisted formats:** `src/schemas/schemaUrl.ts`, `src/schemas/persisted.ts` and `src/schemas/history/` show how a versioned format with a `$schema` stamp is registered and snapshotted. The ledger is a new one: every field required, no optional fallback.
- **Archival and pruning:** `src/app/archive.ts` moves the run folder under `~/.phax/archive/<namespace>.<short-name>/`; `src/app/prune.ts` then deletes that archive folder for real, keeping only `phax/records/v1`, remote refs and tags.
- **The CLI:** `src/cli/commands/` and the `cli-view-layer` skill for a new `phax cost backfill` command; the usage spec and the completions are generated from the command tree.

Points the spec leaves to planning. Settle each or raise it as a question in the plan's `## Technical arbitrations` (framed by what each option abandons, recommendation first):
1. **The ledger's place and name** (§10): one run-level file in the run folder, or one per phase folder. Concurrent writers (phases that may run in parallel, the compliance review) and the `runCostUsd` of a rate-limit sample (the run's cumulative cost at that point, so it depends on every earlier entry) bear on it.
2. **Surviving pruning (§5.5).** `phax prune` deletes the whole archive folder, so a ledger kept only in the run folder survives archival but not pruning, and plan-estimate loses that history. Say where the ledger lives so it survives prune, and what that costs (records are opt-in; a separate store outside the run folder is a new place prune must leave alone).
3. **Pricing a partial invocation (§5.4).** Its cost is the cost of the assistant messages its stream holds, which needs per-model API list prices (input, output, cache read, cache write at 5 minutes and at 1 hour). phax has no price table today. Say where the prices live (the routing catalog is the obvious owner) and what happens to a model with no price.
4. **Rate-limit samples:** one sample per window per `rate_limit_event`, or deduplicated; the utilization is stored 0–100 as §6 shows.
5. **The backfill command's spelling** (`phax cost backfill` in §6 is indicative) and how it finds kept runs: active and archived run folders, never a pruned one.

Constraints from the spec's §10 and this repo, restated:
- Reading a stream happens at the provider edge (infra or the Claude adapter); the ledger enters the domain decoded through its schema. The per-invocation correction is a pure domain function, tested on made-up streams including a resumed session before and after 2.1.268.
- A ledger entry is written when its invocation ends, also when the run then fails or stops.
- Backfill never rewrites an existing ledger (§8 requires it byte-identical) and is idempotent.
- No reader re-derives cost from a stream once the ledger exists.

Docs: §11 says no new page; `docs/plan-estimate.md` belongs to the next spec. Update the README where it lists the run folder's files and commands, and `NEXT_STEPS.md`: tick cost-ledger and mark plan-estimate next. The generated usage spec, completions and CLI reference must include the new command.

Phase shape: as few phases as the gates allow, from the core outwards, every commit green. A likely split:
1. The ledger schema and its registration, the price table, and the pure per-invocation and sampling functions, with unit tests.
2. Writing the entry at every invocation end of a run (phase, fix, handoff, compliance), partial included, other providers skipped, and the ledger carried through archival and pruning.
3. `phax cost backfill`, its docs, README and NEXT_STEPS.

Merge them if the gates allow.

Constraints:
- The phases name only models in the installed phax's catalog (`phax agent models`): `claude-opus-5-5` (the default), or `claude-sonnet-5` for mechanical work.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Tests never spawn a real provider and never read `~/.phax`.
- Fixtures and examples are made up. None is copied from this repository's own plans, specs or run folders, from `~/.phax`, or from another repository. Prices in fixtures may be made up too; the shipped price table states Anthropic's published list prices.
- It must pass `phax plans lint`.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
