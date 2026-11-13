Write the phax spec `property-tests`: property-based tests over phax's input boundaries (the persisted formats, the
plan parser, the state machine), so that the contracts phax decodes its input with are checked against generated
input, not only against hand-written cases.

## Why

phax decodes every external input through an Effect Schema at the boundary, and its persisted formats are versioned:
each carries a `$schema` stamp, the schemas package's ledger lists 41 formats, and frozen decoders under
`src/schemas/history/` read the older shapes. The tests exercise these contracts with fixtures written by hand. A
property instead states what must hold for every input. A generator then searches for an input that breaks it, and
shrinks what it finds to the smallest counter-example.

The operator, 2026-11-13: the input validation and the contracts are strong, so property tests are worth having. They
show that the validation holds, and they find where it does not.

A side effect: OpenSSF Scorecard's Fuzzing check, at 0 in the repository's first score (6.7, 2026-11-13), counts
fast-check property tests in a TypeScript project.

## What phax has today, to read first

- **Persisted formats.**
  - `src/schemas/persisted.ts` bridges a file and phax's value: stamps, refusing a newer stamp, and the frozen
    decoders.
  - The schemas package: `packages/schemas/src/formats/`, and the ledger `packages/schemas/releases.json`.
  - `docs/json-output.md`.
- **The plan parser and renderer.**
  - `src/domain/plan/parsePlanMarkdown.ts`: `extractPlanDeterministic`, `readPlanDeterministic`,
    `collectPlanStructureErrors`.
  - `src/domain/authoring/renderPlan.ts`: `renderPlanBody`.
  - `tests/unit/parsePlanMarkdown.test.ts`, the hand-written cases.
- **The state machine.** `src/domain/state.ts`: the run and phase transitions and `TERMINAL_PHASE_STATES`.
- **The CLI contract.** `src/cli/commandLibrary/contract/conformance/`: its cases and suite.
- **Effect's own engine.** Effect 4.1.4 ships `effect/Arbitrary` (`Arbitrary.schema(schema)`), with its own runner and
  no fast-check dependency. It is marked `@stability unstable`.

## The direction (the operator's, 2026-11-13)

1. **Boundaries, not every command.** Property tests go where phax reads input it does not control, and where an
   invariant must hold whatever happens. Random arguments to every command would mostly test the argument parser's
   refusal.
2. **Slices, in order of value:**
   1. **Persisted formats.**
      - For every valid value of a format, decoding its encoding gives the value back.
      - Any JSON value decodes to a value or to a refusal, never a thrown exception or a defect.
      - A stamp newer than the running release is refused.
   2. **The plan parser.**
      - Rendering a plan document and parsing it back gives the same plan.
      - Any Markdown yields a plan or structure errors, never a throw, in bounded time.
   3. **The state machine.**
      - Any sequence of transition calls keeps the invariants: a terminal state stays terminal, and a refused
        transition changes nothing.
   4. **CLI arguments,** last.
      - Any `argv` is either accepted or refused through the contract's refusal.
3. **fast-check,** the recommendation, which the spec's open questions confirm or overturn. Scorecard counts it, and
   its API is stable. Its cost is the generators: Effect's engine derives them from the schemas, while fast-check needs
   them written, or bridged from the schemas.
4. **Reproducible in CI.** A failing property prints its seed and the shrunk counter-example, and rerunning with that
   seed reproduces it. Each property's run count is bounded, so `pnpm test:unit` stays fast.

## What the spec must cover

- Each slice's properties, as EARS requirements with acceptance criteria.
- Where the tests live and in which tier. The run budget: per property, locally and in CI. Whether the daily Security
  workflow runs a deeper pass.
- The generators: how values are produced for the 41 formats, and whether the frozen decoders' shapes are generated
  too.
- What a found counter-example becomes: a fixed case in the hand-written suite, next to the fix.

Out of scope:

- Coverage-guided fuzzing (a fuzzing engine that instruments the code).
- Fuzzing the provider CLIs phax drives.
- Fuzzing every CLI command.

## Open questions the spec must settle (§9)

- **fast-check or Effect's `Arbitrary`.** The recommendation is fast-check. Effect's engine would give up Scorecard's
  Fuzzing point and rest on an unstable API.
- **Generators:** derived from the schemas (Effect's `Arbitrary`, bridged into fast-check) or written by hand per
  format.
- **The run budget per property,** and whether the daily Security workflow runs more iterations than a pull request.
- **Which slices the first plan takes.** The recommendation is the persisted formats alone: one property shape covers
  every format.
