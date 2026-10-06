Write the phax spec `drop-gate-scopes`: a hard drop of gate scopes. Completion diagnostics stop naming scopes and fail the step like invariants. The `scopes` provider, closure resolution, the pending state and the `gate-pending` record are removed. phax runs the diagnostics step and reads its verdict, and nothing more.

This replaces the spec drafted and approved on 2026-10-05 (`docs/specs/2610051445-drop-gate-scopes.md`, abandoned 2026-10-06). That spec carried compatibility niceties, and it depended on `gate-request`. The author's decisions of 2026-10-05 and 2026-10-06 below are final: write each into §9 as a decided question, giving its options and losses, and do not reopen any of them.

**A hard drop (author, 2026-10-06).**
- Nobody configures `scopes`, ships a scope provider or reads the diagnostics output: phax, steme-lab, phax-cockpit and louloupapers were checked on 2026-10-05, and `examples/hello-world/scopes.mjs` is phax's own example.
- So nothing eases the removal: no shim, no migration, no dedicated refusal or message, no deprecation, no "removed" section or upgrade note in the README, and no reading of earlier-release gate files.
- After the change, `scopes`, closure and pending appear nowhere in phax's contracts, code paths, tests or docs, except where history is kept on purpose: archived specs and plans, the git history, and the release ledger of served `$schema` URLs.
- No requirement or acceptance criterion may name a leftover `scopes`, whether in a config layer or on a finding. Once dropped, the key is unknown like any other: the existing unknown-key refusal of the config layers (exit 2) and the existing tolerance of extra keys on decode apply unchanged. The spec neither restates nor tests them for `scopes`.

**It does not depend on `gate-request` (author, 2026-10-06).** The removals come first, so the new features are built on a green field. This spec lands after `drop-orient` (a new spec retiring the `orient` provider) and before `gate-request` and the brief.
- Until `gate-request` lands, a diagnostics provider decides what is due from git alone. With no provider in use, nobody is left without the plan.
- No requirement, surface or example names the gate request, its `input` key or its request file.
- The hello-world example has no `orient` hook either, since `drop-orient` lands first.

Decided 2026-10-05, carried over unchanged:
- **The problem.** phax schedules completion findings itself. Before each non-terminal gate with a diagnostics step, it asks the `scopes` provider which scopes are closed. It keeps a completion pending while any scope that finding names is open, shows it to the agent as optional work, and writes a `gate-pending` record. That splits one decision across two commands and two formats, and it makes phax keep closure and pending state it cannot judge. The provider decides what is due and reports only that (steme-corpus `02-product/phax-steme-coordination.md`, change 9).
- **A completion finding fails the step, exactly like an invariant.** Both classes stay in the document, because they say which kind of failure it is: something required is missing, or something forbidden is present. Neither carries `scopes`.
- **The fix prompt makes no distinction** between the classes (old Q4). It lists failing findings in the provider's order, both classes alike, as it renders failing findings today, with no class tag and no legend.
- **Removed:**
  - the `scopes` key in `phax.json`, `phax.local.json` and `~/.phax/config.json`, and its provider contract;
  - closure resolution before the gate (the terminal phase closes all, a query otherwise, `unavailable` when no provider is configured);
  - pending diagnostics, their `.pending.json` file and their section in the fix prompt;
  - the `missing-provider` failure;
  - the `pending` step result.
- **Formats.**
  - `gate-diagnostics` gets a next shape without `scopes`.
  - `gate-attribution` gets a next shape whose step `result` is `pass|fail`.
  - `gate-pending` leaves `@lbdremy/phax-schemas` entirely (old Q3): parser, format id, snapshots, JSON Schema and README row.
  - Nothing reads earlier-release gate files (old Q5, old §7): no diagnostics output was in use before this change.
- **`phax schema upgrade`** regenerates `phax.schema.json` and `phax.user.schema.json` without `scopes`, and with no scope or pending wording in the gate step's `output` description. It never reads or writes `phax.json`.
- **The first consumer is steme's audit** (`steme audit`, roadmap-1.0 item 0.13, not built yet). It reports only what is due and never emits a scope.

What the spec must cover:
- The verdict rule after the change: which findings fail the step, what the fix prompt shows, and what the attempt log and `gate-attribution.json` record.
- The two next shapes, before → after, and how `gate-pending` leaves the package. Say how that sits with the package's history convention (the frozen modules under `src/schemas/history/`, `packages/schemas/history.lock.json`, the snapshot gate) and with the docs site, whose deploy guard refuses to drop a `$schema` URL that docs.phax.run already serves (`docs/release.md`).
  - If the guard and the hard drop conflict, put that as the one open question in §9 for the author, with options and losses.
  - Keep code and frozen modules that exist only to read earlier-release gate files only where the history lock requires them, and say which ones that is.
- The docs: delete the README "Scope provider" section and the scope and pending wording in "Diagnostics gate steps", and fix the hook count. Delete `examples/hello-world/scopes.mjs` and the example's `scopes` key. Update `phax --usage`, the generated config schemas, and the 1.0 announcement draft if it names scopes. Add no "removed" note anywhere.
- The effect on `oracle-phases` (Approved, not built). It quotes `scopes?` in the diagnostics shape, says its `oracles` key "mirrors `scopes`", and lists "deriving oracles from `scopes`" as a non-goal. Say what wording its plan must sweep, without changing that spec.

Ground to read first:
- the abandoned spec `docs/specs/archive/2610051445-drop-gate-scopes.md` and its sidecar: its context, surface and §9 are the ground for the decisions above;
- README §"Diagnostics gate steps", §"Scope provider", §"Persisted formats";
- `src/domain/gate/scheduleDiagnostics.ts`, `src/app/gates.ts` (closure, pending, `pendingPathFor`, `writePendingDoc`), `src/domain/gate/fixPrompt.ts`, `src/schemas/gateDiagnostics.ts`, `src/schemas/gatePending.ts`, `src/schemas/scopes.ts`, `src/schemas/phaxConfig.ts`, `src/domain/config/mergeLayers.ts`;
- `examples/hello-world/` (`scopes.mjs`, `audit.mjs`, `phax.json`);
- `packages/schemas` (the gate formats' snapshots and history), `docs/release.md` (the docs-site guard), `site/`;
- `docs/specs/2609281159-oracle-phases.md`;
- NEXT_STEPS.md §"Before steme's audit" (the new order) and §"Road to 1.0.0" (the freeze).

Constraints:
- This removes surface on purpose. Keep everything else of the gate as it is: steps, profile order, `surface`, `firing`, `output`, the stop at the first failing step, the fix loop, attribution.
- phax gains no notion of what is due.
- Out of scope, named: the gate request (spec `gate-request`), the brief (spec `brief-replaces-orient`), orient's retirement (spec `drop-orient`), and the coordination note's later items (a diagnostic `id` and oscillation, accepted debt, ranges, structured repair, a decision class).
- Keep §9 to the decided questions above, plus at most the docs-site guard question if it is real.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
