Write the phax plan "Plan estimate" for the approved spec `docs/specs/2610160909-plan-estimate.md`. It is the only plan for that spec, so it carries `completes-spec: true`. Read the spec in full; its §9 is empty and its three arbitrations are settled: Q1 A (list prices maintained by phax), Q2 C (the OAuth usage endpoint by default, `--no-probe` for the last sample), Q3 A (exit 0 whatever the verdict). Do not reopen them.

Decided with the author, binding on this plan:
- **Prices (2026-10-17, cost-ledger plan).** The list prices already live in `src/domain/routing/prices.ts` (`CLAUDE_LIST_PRICES`, `listPriceFor`), keyed by Claude catalog id, with a test requiring one per shipped Claude entry. That is how §10's "catalog prices required on every Claude entry" is met: do not add a `price` field to providers.json entries as §6 sketches. A Claude model with no price (one a user added to providers.json) is never priced $0.
- **History is the cost ledger.** No reader re-derives cost from a stream once the ledger exists (cost-ledger §10). Kept runs have `<run folder>/cost-ledger.json`; pruned runs' ledgers are copies at `<state root>/cost-ledgers/<namespace>.<short-name>.<run-id>.json` (`src/app/prune.ts`, `COST_LEDGERS_DIR`). Read both.
- **The spike's arithmetic is not ported where it is wrong.** It sums the repeated `modelUsage` of streams holding several `result` events; the ledger already takes the last one and sums `duration_ms`. Port the spike's model, not its stream scan.

In scope: every requirement §5.1–§5.15, the §6 surface (`phax plans estimate` with `--json` and `--no-probe`), every §8 criterion, and the §11 docs page `docs/plan-estimate.md`.

Ground to read:
- **The reference:** `spikes/plan-estimate/phax_estimate.py` — `features`, `training_set`, `fit` (weighted least squares on log token volume at a reference price, half-life 30 days), `reprice`, the resampled-residual quantiles, `calibrate`, `play` — and `spikes/plan-estimate/README.md` for its findings and its "Not covered" list.
- **The ledger:** `src/schemas/costLedger.ts` (entries by role, per-model tokens and cost, `agentMs`, `endedAt`, rate-limit samples with `runCostUsd`), `src/domain/cost/ledger.ts`, `src/app/costLedger.ts`, `src/app/costBackfill.ts` (how it finds active and archived run folders through the registry).
- **The plan read:** `src/app/lintPlan.ts` and `src/cli/commands/plans.ts` (`plans lint` reads with the deterministic parser, with no Backend in its layer so it cannot reach a model; artifact validation and exit 12). `phax plans estimate` belongs beside it.
- **Routing (§5.6):** `src/app/loadRouting.ts` and the resolution `phax run` applies per phase; the estimate decides a phase's provider the same way, never by guessing from the model id.
- **Run-level invocations (§5.5):** how `phax.json` enables the compliance review (`src/schemas/phaxConfig.ts`).
- **Ports:** `src/ports/`. There is no HTTP port and no credential port today; the endpoint call and the credential read are new side effects behind ports, with infra adapters (`effect-services`, `infrastructure-adapters` skills). The endpoint's answer is decoded through a schema at the edge (`validation-boundaries`).

Points the spec leaves to planning. Settle each or raise it as a question in the plan's `## Technical arbitrations` (framed by what each option abandons, recommendation first):
1. **A historical phase's features.** The ledger records cost per phase, not the phase's model, effort or planned files. Kept run folders hold `phax-plan.json` (active and archived); a pruned run keeps only its ledger copy. Planned-file bytes must be measured at the commit the run started from, and `run-status.json` records no base commit (the spike approximated it with `git rev-list --before=<first prompt mtime>` in the plan's own repository). Say where each feature comes from, which history is sized (this repository's runs only, as the spike did, or every repository the registry can reach), and what pruned runs contribute: calibration, burn rate and the run-level median only, or features too, which would need prune to keep more than the ledger.
2. **The regression's features and weighting** (§10 leaves them open). Start from the spike: effort indicators, log planned-to-edit bytes, log optional bytes, count of files to create, half-life 30 days, fit on log token volume priced at a reference model, repriced per phase with the history's token mix. Quantiles from resampled residuals need a fixed seed so the output and the tests are reproducible. The ledger keeps one `cacheWriteTokens` per model (no 5-minute/1-hour split); say which write price the token volume uses.
3. **A phase whose Claude model has no list price.** Never $0. Say whether that phase is listed as not estimated (and then whether the run estimate and verdict still print without it) or whether the whole estimate is refused.
4. **The burn rate's window** (§10 leaves it open): the spike uses the last 30 days of entries, cost over `agentMs`. Say what happens when there are none.
5. **Calibration with too few samples.** §5.10 calibrates from the last 28 days. Say how sample pairs are formed (same run and window, same `resetsAt`, consecutive), and what the verdict is when a window has no usable pair in 28 days; never a constant.
6. **The OAuth credentials.** Where the token is read on each platform (macOS Keychain, `~/.claude/.credentials.json`; §10 leaves it open), how API-key authentication is told apart from an unreadable store (`no-subscription` vs `windows-unavailable`), and what an expired token gives — never refreshed (§5.14). The token never enters the domain, a log, telemetry, an error message or a record. Tests use fake adapters and never read a real credential store; do not read one while planning either.
7. **The §10 yardstick.** "On recent runs the run-level median error must stay within ×1.35 against held-out runs." Tests never read `~/.phax`, so say how it is checked: a test on a made-up history with a known generating model, a script outside the gates, or the end-to-end review after the run. Do not add a flag §6 does not name.

Constraints:
- Layers as in CLAUDE.md: the estimate, the quantiles, the calibration and the forward play are pure domain functions, unit-tested on made-up ledgers and plans; reading the windows never invokes a model; `phax plans estimate`'s layer has no Backend, like `plans lint`.
- New persisted formats, if any: every field required, a `$schema` stamp, registered and snapshotted like the others. Changing `cost-ledger`'s shape is a format change, not an optional field.
- Explicit per-variant enums (`verdict`, `windows.source`).
- The phases name only models in the installed phax's catalog: `claude-opus-5-5` (the default), or `claude-sonnet-5` for mechanical work.
- Every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- Tests never spawn a real provider, never call the network, never read `~/.phax` or a real credential store.
- Fixtures and examples are made up. None is copied from this repository's own plans, specs or run folders, from `~/.phax`, or from another repository. The spec's §6 numbers are made up and may be reused.
- It must pass `phax plans lint`.

Docs: the §11 page `docs/plan-estimate.md` (reader and example as §11 states), linked wherever the docs site lists pages; the README's command list; the generated usage spec, completions and CLI reference include the new command; `NEXT_STEPS.md`: tick plan-estimate.

Phase shape: as few phases as the gates allow, from the core outwards, every commit green. A likely split:
1. The pure domain: history rows from ledgers and plans, the fit, the quantiles, the repricing, the calibration, the burn rate and the forward play with the verdict, with unit tests.
2. The edges and the surface: the history reader, the credential and endpoint ports with their adapters and schema, `phax plans estimate` and its rendering, the docs, README and NEXT_STEPS.

Merge or split them as the gates allow.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
