Write the phax plan "Property tests over the run reducer and the CLI arguments" for the approved spec
`docs/specs/2611131320-property-tests.md`. It is the spec's third and last plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the six operator decisions of 2026-11-13 in §9 (q-engine `fast-check`, q-generators `derive-effect`, q-budget
  `fixed-100-daily-2000`, q-first-slice `formats-only`, q-machine `reducer`, q-phase-terminal `next-or-terminal`);
- everything §10 lists as settled, and its constraints.

This plan takes the last two slices, §5.11 to §5.16 and their criteria: ac-sm-total, ac-sm-archived, ac-sm-finished,
ac-sm-phase-terminal, ac-sm-refused and ac-cli-argv. The state-machine properties check the reducer phax executes
(`interpret` in `src/domain/reducer.ts`, returning a `Disposition` from `src/domain/disposition.ts`), never the
deprecated transition functions in `src/domain/state.ts`. The terminal-phase invariant is the next-or-terminal form:
from a terminal phase state, a handled event leads to no phase, a terminal phase state, or pending.

The criteria the earlier plans already met (ac-tier, ac-budget, ac-seed-fixed, ac-deep-pass, ac-repro-print,
ac-repro-rerun, and the format and plan-parser criteria) need no new test. Since this plan completes the spec, check
that each of them still names a test that exists, and say so in the last phase's handoff.

Release context. 0.38.0 is released and installed; 0.39.0 is the opened version. Runs on this repository use the
installed phax.

What already exists (read it before planning). Plans 1 and 2 landed it, in #232, #233 and #234:
- **The harness** (`tests/helpers/property/harness.ts`): `checkProperty`, `runProperty`, `propertyTimeout`, the
  `PHAX_PROPERTY_SEED`, `PHAX_PROPERTY_PATH` and `PHAX_PROPERTY_RUNS` parameters, one random seed per property file, and
  the anchored replay line. Every new property goes through `checkProperty`, never a bare `fc.assert` or `fc.check`;
  a test enforces it.
- **The bridge** (`tests/helpers/property/fromEffect.ts`): fast-check arbitraries from Effect schemas.
- **Registries with coverage tests that fail by name**: the format registry (`formatRegistry.ts`, one generator per
  format id, `missingGenerators`) and the plan generator's `RENDERABLE_RULES`, each rule with its example. Copy this
  pattern wherever the slice must cover a closed set.
- **The docs page** `docs/property-tests.md`, with its import rule, its sections per slice and its deep-pass section.
- **`pnpm test:property:deep <files>`** (#235): the unit project at 2,000 runs from a random seed, with no
  environment prefix.

The state machine (read `src/domain/state.ts`, `src/domain/events.ts`, `src/domain/disposition.ts`, the reducer and
its hand-written suites):
- `PhaxState` is a union over the run state, with a `PhaseSubState` for the running, rate-limited and interrupted runs.
  `PhaxEvent` is a union of about forty event interfaces. Neither is an Effect schema, so `derive-effect` applies only
  to the fields that already have one (branded ids, paths, stop causes); say which parts are hand-built and why.
- The spec says *reachable* run states.

The CLI arguments (read `src/cli/commandLibrary/`, in particular `contract/conformance/` with its program and
`memoryIo.ts`, and `tests/unit/commandLibrary/conformance.test.ts`):
- ac-cli-argv runs the command library's runner on the conformance suite's program, over in-memory IO. The runner lives
  in `src/cli/commandLibrary/commander/`. The exit codes and the refusal contract (exit 64, nothing on standard output,
  a message on standard error, never the defect code) come from the contract, not from a literal in the test.

Settle in Technical arbitrations, with the dominant loss of each:
- **How reachable states are generated.** Build them from the state and sub-state unions directly, or reach them by
  folding generated event sequences through `interpret` from the initial state, or a mix. A state the reducer can
  never reach may legitimately hit its `assertNever`, so an over-approximation needs a named filter or a named
  exception; a fold may never reach the rare states (review stops, held stops, protected paths).
- **How events are generated, and how a missing event type fails the suite.** A new event type added to `PhaxEvent`
  must fail by name until it has a generator, like `missingGenerators` for formats. Decide whether that is a
  type-level check, a runtime list, or both.
- **The argv generator.** Arbitrary strings, and known command words taken from the program's own usage spec followed
  by arbitrary flags and values. Decide where the command words come from so that a new command is covered without
  editing the generator.
- **The import rule.** §10 says property tests import only from `src/domain` and `src/schemas` (and
  `packages/schemas`), but ac-cli-argv names the command library's runner, under `src/cli/commandLibrary/`. Read the
  criterion as the narrower and later statement: the argv property may import the command library and its conformance
  program, and nothing else under `src/cli/`. Confirm that what it imports performs no I/O and touches no port, record
  the exception in the plan, and update the import rule in `docs/property-tests.md`. If the runner cannot be driven
  without real I/O, stop and say so in Technical arbitrations: that is a spec question, not a planning one.

Shape. Every in-scope §8 criterion has its own named test. Generators first, each with its own sanity property and
coverage test. Then the reducer properties, then the argv property. Docs last: the state-machine and CLI-argument
sections of `docs/property-tests.md`, the import rule, and the spec-completion check above.

A counter-example found during the run is a reducer or runner bug unless the generator made it. Fix the reducer or the
runner, add the counter-example as a hand-written case in that boundary's existing suite in the same commit, and say so
in the handoff. Never change a persisted format's shape or stamp, and never change the contract to make a property
pass.

Lessons from the runs on this repository:
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase
  that creates it, or export it where it is first used.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **Run each new property file once with `pnpm test:property:deep <file>` before handing off,** and record the seed
  and result. Plan 1's 100-run gate missed a case that the first deep pass found at run 1,927. Plan 2's agents could
  not run the pass because their session refuses an environment prefix; the script removes that obstacle, so a
  handoff without a recorded seed is incomplete.
- **Keep each property file within budget.** At 100 runs, all property files together must stay well under the CI
  budget step's 60 s (they take about 11 s today). At 2,000 runs the plan-parser file takes about 3 minutes; say what
  the new files take.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. The agent's session allows `pnpm test:property:deep` through the gate's `pnpm test` entry,
but it is not itself a gate command or an `agentCommands` entry, so do not list it under Required commands: name it in
the phases' instructions only. This plan should need nothing beyond the gate.
