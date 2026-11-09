Write the phax plan "Effect 4 migration groundwork 2" for the approved spec `docs/specs/2611071052-effect-4-migration.md`.
It is the spec's second plan, not its last, so it carries `completes-spec: false`. Like the first plan, it runs entirely
on Effect 3: nothing in it installs Effect 4, runs the codemod on `src` or `tests`, or edits a migrated call site.

Read the spec in full, sidecar included, as amended after the first plan's review (#195). These are settled; do not
reopen them:
- the seven operator decisions of 2026-11-07 in §9b, and everything §10 lists as settled;
- **phax owns its refusal format** (operator, 2026-11-08). phax keeps today's words (`is missing`,
  `is unexpected, expected: …`, `Expected X, actual Y`, `Expected an object, actual null`) but builds them itself from
  the issue's data. A refusal is a phax-owned value: a path, a kind (`missing`, `unexpected`, `invalid-type`,
  `invalid-value`, `filter`), an expected label and the actual value. One adapter turns Effect's issues into it, and
  one renderer reads only that value. A change of Effect version then moves one adapter, never a message (§5.15 as
  amended);
- **the codemod targets `Result`, not `Exit`**: `Schema.decode*Either` and `encode*Either` map to
  `Schema.decodeUnknownResult` and `encodeUnknownResult`, and `Either.getOrThrow` to `Result.getOrThrow` (operator,
  2026-11-08 and 2026-11-09);
- **a second ratchet, on passing tests** (operator, 2026-11-09, §5.22 as amended). Once Effect 4 is installed, a test
  that passed at a phase's base must still pass at its end. The phase that installs Effect 4 and applies the codemod
  records the first set, as it records the first type-error counts;
- **the schema topic comes first** after the install (operator, 2026-11-09, §10 order as amended). Nearly every
  module builds schemas when it loads (`Schema.pattern` alone has 197 uses), so until the schema phase is done almost
  no test can even load. Once it is, the test ratchet has something to hold.

What already exists (read it before planning):
- the first plan's work, merged in #195: the behaviour corpus (`tests/effect4Corpus/`, its subjects, cases, baseline
  and replay test), the codemod (`scripts/effect4-codemod/`, its rules, owners, counts and type-error ratchet), the
  skills `.claude/skills/effect4-*`, the `effect-migration` gate profile, and `docs/effect-4-mapping.md`;
- the refusal formatters that render Effect's messages today: `src/schemas/formatError.ts` (`formatParseError`,
  `formatFirstViolation`, `issueMessage`, which rewords whole-type descriptions by string surgery),
  `src/schemas/report.ts` (`describeReportIssue`), `src/domain/decide/handAuthored.ts`, `src/domain/decide/revision.ts`,
  and `packages/schemas/src/parsed.ts` (`fromEither`, which reads `ParseResult.ArrayFormatter`). The package does not
  depend on phax's `src`, and phax does not depend on the package;
- the first plan's review findings this plan answers, all in the #195 PR comments:
  - the corpus misses loosened constraints, because it has no refused case per constraint;
  - encoding is not covered;
  - `issueMessage` misses tuples (`readonly [`), unions, `Struct (Encoded side)` and description-as-label.

Deliver, each with its own named tests:
1. **The refusal model, its adapter and its renderer** (§5.15). The model and the renderer are pure, the adapter
   reads Effect 3's `ParseResult` issues. Every formatter listed above renders through them. `issueMessage` and every
   match on Effect's message text go away. A whole type is named by its kind (`an object`, `an array`, `a tuple`,
   `one of …`), never by Effect's type description. `@lbdremy/phax-schemas` renders its `Parsed` failures with the
   same words.
2. **The denser corpus** (§5.16, §5.19):
   - one refused case per constrained leaf (pattern, minLength, maxLength, minItems, enum or literal, const,
     required key) of each format's latest snapshot and of each frozen decoder's shape;
   - encode subjects for every format phax writes, with their encoded JSON;
   - the coverage test extended to prove both.
   New cases are captured on Effect 3 by the existing capture script. Capturing a case already in the corpus a second
   time is allowed only for the lines that deliverable 1 changes. Each such line is listed in the phase's handoff and
   in `docs/upgrading.md`.
3. **The test ratchet** (§5.22 as amended). `pnpm codemod:effect4 --ratchet` also runs the unit and integration
   suites and compares the passing tests with a committed record, the way it compares type-error counts. A test is
   identified by its file and its full name. A recorded test that fails, is skipped or no longer exists fails the
   gate; a test passing for the first time is added. The record is written by `--ratchet` itself and read at `HEAD`,
   so no phase lowers its own base. On this tree every test passes. The phase that installs Effect 4 records the
   first set.
4. **Docs**: the `0.36.0` entry of `docs/upgrading.md` names the refusal lines that changed and why, plus a line in
   `CONTRIBUTING.md` on the test ratchet.

Protected paths. The first plan protected the corpus files and the ratchet code in `phax.json`
(`protectedPaths`), and `phax.json` itself is protected, so a phase cannot lift that. Deliverables 2 and 3 edit those
paths. The operator lifts exactly those entries before the run and restores them, with the test ratchet's record
added, when the run's PR merges. The plan lists, in its preamble, the protected paths each phase edits.

At the same merge the operator also protects the files that hold the test contract, for the rest of the migration
(§5.14 made mechanical where a path can carry it; the last plan lifts them with the codemod):
- **the snapshot files** `**/__snapshots__/**` (semantic traces, state-machine contract, telemetry, prompts, spec
  rendering, reconciliation);
- **the released JSON Schema snapshots** `packages/schemas/snapshots/**`, which §5.19 keeps byte-identical. This also
  refuses a `next` snapshot, which the schema skill forbids;
- **the CLI contract fixtures** `tests/fixtures/help/**`, `tests/fixtures/usage/**` and
  `tests/unit/commandLibrary/contract/fixtures/**`;
- **the happy-path tests with no Effect code in them**: `tests/e2e/realFlow.test.ts`,
  `tests/e2e/headlessAuthoring.test.ts`, `tests/e2e/claudeProtectedPaths.test.ts`,
  `tests/e2e/claudeSkillEditGrant.test.ts`, `tests/unit/generateModelCatalog.test.ts`,
  `tests/unit/reconciliation/global.test.ts`.

Nine snapshot lines hold refusal wording, so this plan may still change them under deliverable 1. That is why the
protection starts at its merge, not before. `packages/schemas/history.lock.json` stays unprotected, because the schema
phase refreshes it once (§5.17). Test files that use Effect cannot be protected, because their plumbing has to move;
for them §5.14 stays the review's check.

Settle in Technical arbitrations, with the dominant loss of each:
- where the model and the renderer live so phax and `@lbdremy/phax-schemas` print the same words: phax depends on the
  package, the package carries its own copy held equal by a test, or the package exports the renderer;
- the expected label: the schema's `identifier`, its `description` or its kind, and which wins when a schema has
  several;
- how a union is named (`one of "a" | "b"` for literals; what for unions of shapes);
- how the test ratchet runs the suites and reads their results (vitest's JSON reporter or its API), what it does with
  a test that fails once under machine load (rerun the failures once before judging, or not), and what it costs a
  gate in time.

Shape. Model, adapter and renderer first, inside-out, with the corpus replay green at every step (the words do not
move except where deliverable 1 says). Then the formatters and the package move onto the renderer, then the corpus is
densified and recaptured, then the test ratchet, docs last. The refusal model and the test ratchet are the phases
that need care.

Out of scope: installing Effect 4, the Effect 4 adapter (it is written in the schema phase, against
`SchemaIssue`), JSON Schema generation, any codemod rule beyond the ones the spec lists.
