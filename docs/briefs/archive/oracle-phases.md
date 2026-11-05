Write the phax spec `oracle-phases`. It re-authors the spec of the same name (`docs/specs/archive/2609281159-oracle-phases.md`, reopened to Draft and abandoned on 2026-10-20), against the codebase as it is now. Read the old spec in full: its problem, product goal and most of its arbitrations stand. What changes is stated below.

The idea, unchanged: a plan can declare an oracle phase, which writes the tests first, each with its framework's expected-failure marker, and the later phase that discharges it, which writes the code and removes the markers. The agent that writes the code is not the one that writes what judges it. phax never checks this itself. At the gate of those two phases, it asks a configured `oracles` provider for a verdict. phax keeps no knowledge of test frameworks, markers or test-file conventions.

What the operator decided on 2026-10-20 (do not reopen):
1. **Any provider will do, not only steme.** The old non-goal "no oracle phase in phax's or steme-lab's plans before steme ships its provider" is dropped. The contract is a provider command declared as `"oracles": { "command": … }`, merged across the config layers as `brief` and `architecture` are.
2. **The phax repository ships an example Vitest provider as repo tooling**, under `scripts/` or `examples/`. It is not part of the CLI, and phax's own `phax.json` declares it, so phax's own plans can use oracle phases. It reads test files with tree-sitter (for instance `web-tree-sitter` with the TypeScript grammar as WebAssembly, so nothing is built natively). It compares syntax trees, not lines, so reformatting a file never changes a verdict. It answers:
   - **authored:** every test added or modified since `base` in the oracle files carries `.fails` (`test.fails`, `it.fails`). Deleting a test is allowed.
   - **discharged:** no `.fails` is left in the oracle files, and the oracle files' syntax trees at the oracle commit, with each `.fails` member access removed, equal their trees now. Removing the markers is then provably the only change.
   The spec states what the example must answer and what it is for. How it is written is left to planning.
3. **The planner may declare an oracle phase only when an `oracles` provider is configured.**
   - The headless plan authoring prompt says whether one is configured, as it does for the architecture provider.
   - The phax-planning skill states the rule.
   - Lint and the run preflight refuse an oracle phase with no provider. This keeps the old Q3 (error-and-refuse), with the exit decided under 6.
4. **The provider's request and answer are versioned phax formats, each with a required `$schema`.** The answer is the existing `gate-report` (`src/schemas/gateReport.ts`: `{ $schema, outcome: checked | refused, findings, review }`), not the old bare `{ diagnostics }`. Settle the request in §9: a new `oracle-request` format (`$schema`, `mode: authored | discharged`, `oraclePhase`, `base`, `oracleCommit`, `files`, …), or the existing `gate-request` (`src/schemas/gateRequest.ts`) extended. Frame each option by what it abandons. Avoid the key name `mode`, which the phase already uses for `headless | interactive`; for instance, use `verdict: "authored" | "discharged"`.
5. **The phase shape** follows the joint session held with `assignment-bounds` and `interactive-phases`:
   - a separate required key `oracle` on every phase, `{ dischargedBy, files }` or null (decision J1);
   - in the plan document and in `phax-plan.json`, `oracle` sits right after `mode`, which sits right after `optionalFilesToEdit`; `assignmentReason`, `model` and `effort` stay the phase's last three keys (decision J2);
   - in plan.md, the oracle lines come after the `**Mode:**` line, and only on an oracle phase (the old Q1, `oracle-side-line`).
6. **Lint and the run preflight share one oracle check** (decision J4). A misplaced declaration, a discharging phase that does not come after its oracle phase, an oracle file planned by a phase in between, or a missing provider is a lint error. The same error refuses `phax run` and `phax resume` in the start preflight, with exit 11, not the old exit 2. The rule interactive-phases handed over moves into this check: no interactive phase strictly between an oracle phase and its discharging phase.
7. **It ships in the same release as `assignment-bounds` and `interactive-phases`** if it is approved before their joint plan-document plan is cut (decision J5, revised). Then there is one frozen copy of the 0.25.0 plan-document shape and one lift by `phax artifact migrate-documents`, which writes `oracle: null` on every lifted phase. The same goes for `phax-plan.json` and the extraction cache, which `mode` already changes. Otherwise this spec takes its own lift. State both cases in §10.

Re-check against the current code, and update:
- **The gate machinery:**
  - `gate-attribution` (`src/schemas/gateAttribution.ts`): a step result is `pass | fail | refused`;
  - the surface enum (`surface.ts`): the old Q4 adds an `oracle` surface. Say which snapshots that changes.
  - how a `refused` gate report ends the fix loop.
- **The config:** `src/schemas/phaxConfig.ts`, the gate steps' `input` and `output`, and `phax schema upgrade`.
- **Model ids:** every one in an example is a current catalog entry.
- **Old Q1–Q5:** keep each as a lifted verdict unless it is stale. Re-ask a stale one in §9.

Settle in §9, framing each option by what it abandons:
- the request format (point 4);
- whether the example provider ships in the npm package or stays repository-only;
- anything the re-check finds that the old arbitrations no longer settle.

Out of scope:
- steme's own `oracles` provider;
- non-test oracles (golden files, fixtures);
- read-only enforcement of oracle files at the file-system level;
- several discharging phases for one oracle phase;
- changes to `headless-review`.

Constraints:
- No back-compat shims: new keys are required, with explicit per-variant enums.
- Every provider request and answer carries `$schema`.
- phax stays autonomous: a missing or failing provider never stops a running phase. It refuses at the start preflight or fails the gate step.
- Fixtures and examples are made up (`acme-billing`, `tests/prune.test.ts`, `refunds`).
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
