Write the phax spec `drop-gate-scopes`: completion diagnostics stop naming scopes and fail the step like invariants; the `scopes` provider, the pending state and the `gate-pending` record are retired. What is due is the diagnostics provider's decision, made from the gate request (spec `gate-request`); phax runs the step and reads its verdict.

Decided with the author on 2026-10-05 — the spec must reflect these, not reopen them:
- **The problem.** phax schedules completion findings itself: before each non-terminal gate with a diagnostics step it asks the `scopes` provider which scopes are closed, then keeps a completion pending while any scope it names is open, shows it to the agent as optional work, and writes a `gate-pending` record. That splits one decision across two commands and two formats, makes phax keep closure and pending state it cannot judge, and makes a provider express "not due yet" in phax's vocabulary of scopes. Once the provider receives the gate request (base, terminal, the plan's projection), it can decide what is due by itself and report only that (steme-corpus `02-product/phax-steme-coordination.md`, change 9).
- **A completion finding fails the step, like an invariant.** The two classes stay: they tell the agent and the reader what kind of failure it is (something required is missing; something forbidden is there), and the fix prompt can keep saying so. Neither carries `scopes`.
- **Retired entirely**: the `scopes` key in `phax.json` and its provider contract, the closure resolution before the gate (terminal closes all, query otherwise, `unavailable` when missing), the pending diagnostics and their section in the fix prompt, the `missing-provider` failure, and the `gate-pending` persisted format (no longer written). The gate has no scheduling of its own.
- **A new `gate-diagnostics` version** without `scopes`. The spec decides what phax does with a document that still carries `scopes` on a completion.
- **It depends on `gate-request`** and lands after it: a provider that needed the plan to decide closure now reads it from the request. Both should ship in the same release, so no release has a scoped gate without a request or a request without a reason.
- **No shims (0.x), but a clear way out**: a `phax.json` that still declares `scopes` is either refused with an actionable message or rewritten by `phax schema upgrade` — the spec decides, with the CLI/config freeze before 1.0 in mind.
- **The first consumer is steme's audit** (`steme audit`, roadmap-1.0 item 0.13, not built yet); it reports only what is due and never emits a scope. No other provider of scopes is known; `examples/hello-world/scopes.mjs` is phax's own example.

Ground to read first, in this order:
- docs/specs/<stamp>-gate-request.md (the spec this one depends on) and its brief, docs/briefs/gate-request.md.
- /Volumes/Work/steme/steme-corpus/docs/corpus/02-product/phax-steme-coordination.md — §"The changes" (row 9), §"The past from git, the future from the plan".
- README §"Diagnostics gate steps", §"Scope provider", §"Persisted formats" (the `gate-pending` row).
- `src/domain/gate/scheduleDiagnostics.ts`, `src/app/gates.ts` (closure, pending, `pendingPathFor`), `src/domain/gate/fixPrompt.ts` (the pending section), `src/schemas/gateDiagnostics.ts`, `src/schemas/gatePending.ts`, `src/schemas/scopes.ts`, `src/schemas/phaxConfig.ts`, `examples/hello-world/` (`scopes.mjs`, `audit.mjs`, `phax.json`).
- `packages/schemas` (snapshots of `gate-diagnostics` and `gate-pending`; what "a `$schema` URL stays up for good" means for a retired format, and how records written before keep reading).
- docs/specs/2609281159-oracle-phases.md (Approved, not built): its brief quotes `scopes?` in the diagnostics document and the `scopes` provider as a contract to mirror. Say how this spec affects it; do not change that spec.
- NEXT_STEPS.md §"Road to 1.0.0" (CLI contract freeze).

What the spec must cover:
- The verdict rule after the change: which findings fail the step, what the fix prompt shows for each class, what the attempt log and `gate-attribution.json` record.
- The new `gate-diagnostics` version, before → after, and the treatment of a stray `scopes`.
- The config migration: `phax.json` with `scopes`, `phax schema upgrade`, `phax validate`.
- Records already written: old `gate-pending` files and old diagnostics with `scopes` in runs and in `phax/records/v1` — still readable by `phax records explain` and the parsers, or not.
- The docs to change: README sections, `phax --usage`, the hello-world example.
- Open questions in §9 with options, losses and a recommended default; at least: refuse or rewrite a config with `scopes`; refuse, ignore or warn on a diagnostic with `scopes`; keep or drop the `gate-pending` parser for old records; whether the fix prompt distinguishes the two classes.

Constraints: this one removes surface on purpose; keep everything else of the gate as it is (steps, `firing`, `output`, the fix loop, attribution); phax gains no notion of what is due; name what is out of scope (the diagnostic `id` and oscillation, accepted debt, ranges, structured repair, a decision class — later specs from the same coordination note).

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
