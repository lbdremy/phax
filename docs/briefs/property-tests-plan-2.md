Write the phax plan "Property tests over the plan parser" for the approved spec `docs/specs/2611131320-property-tests.md`.
It is the spec's second plan, not its last: it carries `completes-spec: false`. The reducer and the CLI arguments
follow in a third plan.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the six operator decisions of 2026-11-13 in §9 (q-engine `fast-check`, q-generators `derive-effect`, q-budget
  `fixed-100-daily-2000`, q-first-slice `formats-only`, q-machine `reducer`, q-phase-terminal `next-or-terminal`);
- everything §10 lists as settled, and its constraints. In particular, the plan round trip generalizes the existing
  helper in `tests/unit/renderPlan.test.ts`: render, extract, finalize, then compare with the finalized projection.

This plan takes the plan-parser slice, §5.7 to §5.10 and their criteria: ac-plan-roundtrip, ac-plan-total,
ac-plan-bounded and ac-plan-lint-agrees. Leave §5.11 to §5.16 (the reducer, the CLI) to the third plan.

Release context. 0.38.0 is released and installed; 0.39.0 is the opened version. Runs on this repository use the
installed phax.

What already exists (read it before planning). Plan 1 landed it, in #232 and #233:
- **The harness** (`tests/helpers/property/harness.ts`): `checkProperty`, `runProperty`, `propertyTimeout`, the
  `PHAX_PROPERTY_SEED`, `PHAX_PROPERTY_PATH` and `PHAX_PROPERTY_RUNS` parameters, one random seed per property file, and
  the anchored replay line. Every new property goes through `checkProperty`, never a bare `fc.assert` or `fc.check`;
  a test enforces it.
- **The bridge** (`tests/helpers/property/fromEffect.ts`): fast-check arbitraries from Effect schemas. It honours the
  `PlanPath` refinement (canonical plan paths), which the plan document's three file lists carry.
- **The format registry and JSON inputs** (`tests/helpers/property/formatRegistry.ts`, `jsonInputs.ts`): the
  plan-document entry, its repairs and the plain-object rebuild. Generated objects are rebuilt with
  `Object.fromEntries`, because effect/Arbitrary builds null-prototype objects that JSON.parse never does. A key named
  `__proto__` is own data: read only own keys (#233).
- **The parser and renderer**: `src/domain/plan/parsePlanMarkdown.ts` (`extractPlanDeterministic`,
  `readPlanDeterministic`, `collectPlanStructureErrors`), `src/domain/plan/finalize.ts`, and
  `src/domain/authoring/renderPlan.ts` (`renderPlanBody`). Their hand-written suites are
  `tests/unit/parsePlanMarkdown.test.ts` and `tests/unit/renderPlan.test.ts`.
- **The daily deep pass**: the `property-tests` job of `.github/workflows/security.yml` runs `pnpm test:unit
  tests/unit/property` at 2,000 runs with a fresh seed. New property files under `tests/unit/property/` join it with no
  workflow change, and the CI budget step (`.github/workflows/ci.yml`) times them against 60 s.

Settle in Technical arbitrations, with the dominant loss of each:
- **The plan-document generator for the round trip.** Derive it from the plan document's schema through the bridge and
  the registry entry, or build it from hand-picked pieces. Valid documents must render to a plan.md that the
  deterministic reading accepts, with no warning.
- **The text generator for totality, bounded time and lint agreement.** It needs arbitrary text, rendered plans
  mutated at the Markdown level (a heading dropped, a section duplicated, a list item emptied, a path made
  non-canonical), and large inputs up to 64 KiB.
- **How "within 2 seconds" is checked** without making the suite flaky on a loaded machine.
- **The exact equivalence §5.10 asserts** between `collectPlanStructureErrors` and `extractPlanDeterministic`. If they
  disagree by design on some input, how the disagreement is named, like plan 1's agreement exceptions.

Shape. Every in-scope §8 criterion has its own named test. Generators first, each with its own sanity property. Then the
round trip, then totality and bounded time, then lint agreement. Docs last: the plan-parser section of
`docs/property-tests.md`.

A counter-example found during the run is a reader or parser bug unless the generator made it. Fix the parser, add the
counter-example as a hand-written case in that parser's suite in the same commit, and say so in the handoff. Never
change a format's shape or stamp.

Lessons from the runs on this repository:
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase
  that creates it, or export it where it is first used.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **Run each new property file once at 2,000 runs with a random seed before handing off**
  (`PHAX_PROPERTY_RUNS=2000 PHAX_PROPERTY_SEED=random pnpm test:unit <file>`). Plan 1's 100-run gate missed a case that
  the first deep pass found at run 1,927.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. This plan should need none beyond the gate.
