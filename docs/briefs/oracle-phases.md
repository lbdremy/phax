Write the phax spec `oracle-phases`: test-first ("oracle-first") phases, where one phase authors the oracles and a later phase must make them pass, with phax staying agnostic of test frameworks and delegating the detection to a pluggable provider.

Decided with the author on 2026-09-28 — the spec must reflect these, not reopen them:
- **The problem.** An oracle-first plan writes the tests before the code (steme-corpus `roadmap-1.0-arbitration-reflexes.md`, P3, decided 2026-09-24: "oracle d'abord" as a preference). The gate runs the test suite at every phase, so the oracle phase can never be green: its new tests are red by construction. Old tests edited to state new behaviour are red too, and some tests are legitimately deleted. All three are valid in an oracle phase; that set of changes *is* the arbitration the oracle phase exists for, read like a spec before the code exists.
- **The mechanism is the test framework's own expected-failure marker** (Vitest `test.fails`, pytest `xfail(strict=True)`, …). In the oracle phase every added or modified test carries the marker, so the ordinary test command stays green (a marked test that fails passes; a marked test that passes is red — the runner itself catches a vacuous oracle). In the discharging phase every marker must be gone, and the only change allowed to those test files is the removal of the markers.
- **phax does not know what a test or a marker is.** It never parses test files and never runs a test command specially. It knows the plan's structure (which phase authors oracles, which phase discharges them, their files and commits) and asks a registered provider for a verdict, the same way it already asks the `scopes`, `orient` and `planAuditor` providers.
- **The provider's answer is the existing gate diagnostics document** (`{"diagnostics": [{rule, class, scopes?, location, message, repair}]}`, see README §`output: diagnostics` and `src/schemas/gateDiagnostics.ts`); exit 0 with an empty list is a pass. Its failing diagnostics drive the fix prompt like any other diagnostics step.
- **The first provider is steme** (`steme oracles`, a separate steme-lab spec), which is **not built yet**. This spec makes the mechanism pluggable in phax now; nothing in phax's own plans or in steme-lab's plans uses oracle phases until steme ships its provider. Until then, plans keep test and code in the same phase as today.
- **Why the discharge phase can edit the oracle files at all:** removing the marker is an edit. Read-only oracles in the discharge phase are replaced by a *proved-minimal* edit: the provider proves the only difference from the oracle phase's commit is marker removal (no assertion changed, no test deleted, no `skip`/`todo` substituted). An oracle that was red for the wrong reason (a typo, a `TypeError`) cannot be discharged — the runner keeps it red if the marker goes, the provider refuses any other edit — so the fix loop exhausts, the run pauses, and the question surfaces. That is the intended behaviour (P3, P1): a spec disagreement, not a bug.

Ground to read first, in this order:
- /Volumes/Work/steme/steme-corpus/docs/corpus/01-vision/roadmap-1.0-arbitration-reflexes.md §P3 (oracle separation; the 2026-09-24 decision and the 2026-09-28 complement below it).
- docs/ideas/change-gates-from-the-harness.md — the oracle-separation lint idea (an agent never edits what judges its work); this spec is its first mechanical piece for the oracle-first case.
- README §gate profiles (`surface`, `firing`, `output: diagnostics`, the `completion`/`invariant` classes, the `scopes` provider) and `src/app/gates.ts`, `src/domain/gate/scheduleDiagnostics.ts`, `src/schemas/phaxConfig.ts`.
- The existing provider contracts to mirror (command string split on whitespace, no shell, JSON request on stdin, JSON on stdout, provider error on anything else): `scopes` (README §Scope provider), `orient` (`phax --usage`, cmd orient), `planAuditor` (`phax --usage`, cmd plans lint).
- The plan shapes: `phax artifact schema plan`, `src/schemas/phaxPlan.ts`, the phax-planning skill (phase fields), and `phax plans lint` (`src/app/lintPlan.ts`).
- `src/app/commit.ts` / `executePlan.ts`: each phase is committed on its own branch, so the oracle phase's commit and the discharging phase's base are known exactly.
- docs/specs/2609250823-headless-review.md Q5 (how `--append` identifies oracle files before the lint exists) — say how the two relate; do not change that spec.
- NEXT_STEPS.md §"Road to 1.0.0": additive only, CLI and config contract about to freeze.

What the spec must cover:
- The plan-side declaration: a phase marked as an oracle phase, and which later phase discharges it (default: the next phase). Where it lives in plan.md (phax-planning shape) and in `phax-plan.json` / the plan document schema.
- `phax plans lint`: an oracle phase without a discharging phase, a discharging phase that is not after it, oracle files planned in a phase between the two, and an oracle phase in a project with no provider registered — say which are errors.
- The config: a new provider key in `phax.json` (name it; `oracles.command` is the working name), its schema, and `phax schema upgrade` output.
- The provider contract, in full: when phax calls it (the oracle phase's gate; the discharging phase's gate; every fix-loop attempt of those phases), the request on stdin (mode `authored` | `discharged`, the oracle phase id, the base commit before the oracle phase, the oracle phase's commit when discharging, the oracle files), the response (the diagnostics document), and how a provider error, a timeout and a missing provider are reported (exit families).
- How the provider's verdict sits among the gate steps: an implicit step appended to the phase's gate, recorded in `gate-attribution.json` with a surface (which one?), visible in the handoff, the records and `phax records explain`.
- Resume, `reset-phase` and `--append` interplay: what happens when the oracle phase or the discharging phase is reset or re-run.
- Open questions in §9 with options, losses and a recommended default; at least: the plan syntax for the declaration; whether a discharge may span several phases (several discharging phases, or one designated); whether an oracle phase with no provider registered is a lint error or runs without the check; the surface under which the verdict is recorded.

Constraints: additive; nothing changes for a plan with no oracle phase; phax gains no knowledge of any test framework; keep to what the first consumer (steme's `oracles` provider and the steme conductor) needs and name what is out of scope (a generic oracle concept for non-test oracles such as matrices, read-only enforcement at the file-system level, the full change-gates lint).

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.


Decisions taken by the author on 2026-09-28 on the previous draft's §9 — the spec must reflect them, not reopen them. Fold each into the requirements, surface and acceptance criteria. Keep each in §9 as a decided question: the chosen option is the recommendation, and the rationale opens with "Decided by the author on 2026-09-28." Where the author answered off-menu, the answer becomes an option of its own.
- Q1: the declaration is a bold header line on the oracle phase (`**Oracle phase:** yes`, or `discharged by phase-NN`); the discharging role is derived and shown by lint, the prompt and the handoff.
- Q2: exactly one discharging phase per oracle phase; no phase in both roles.
- Q3: an oracle phase with no provider registered is a lint error, and `run`/`resume` refuse (exit family 2).
- Q4 (differs from the previous recommendation): a new `oracle` surface value, recorded in gate-attribution.json, run records and the run summary. Say what the widening costs (the persisted enum, the schemas-package spec's stable formats) and that no configured gate step may declare it.
- Q5 (differs from the previous recommendation): the declaration lists the oracle files explicitly, as a subset of the oracle phase's planned files (so the oracle phase may also carry stubs). Lint checks the list is a subset of the planned files; only the listed files are sent to the provider and guarded between the pair.


Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.

Previous draft: `docs/specs/archive/2609281159-oracle-phases.md` (Abandoned 2026-09-28, with its sidecar). Reuse its structure and every part the decisions above do not change; re-read the ground only where a decision reaches.
