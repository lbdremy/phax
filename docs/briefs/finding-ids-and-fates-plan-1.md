Write the phax plan "Finding ids and the findings list" for the approved spec
`docs/specs/2611041509-finding-ids-and-fates.md`. It is the spec's first plan of three, not its last: it carries
`completes-spec: false`. The fate commands and their records follow in the second plan, the PR description and the
fate comments in the third (q-plans `three-plans`).

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the nine operator decisions of 2026-11-04 in §9b (q-fix-paths, q-where, q-family, q-subject, q-rereview, q-backfill,
  q-pr-refresh, q-plans);
- everything §10 lists as settled, and its constraints.

Two of the spec's ground paths moved when their specs were retired: the headless-review spec is
`docs/specs/archive/2609250823-headless-review.md` (Abandoned, so §10's "when revived" stands) and the command-contracts
spec is `docs/specs/archive/2611031738-command-contracts.md` (Completed). Read them there.

This plan takes the ids and the read side: §5.1 to §5.8 and the §6 surfaces `code-review.json`,
`compliance-review.json`, `phax finding list` and `phax finding list --json`. Its acceptance criteria are "A new code
review gets F ids", "Compliance findings get C ids across phases", "A session that writes ids is refused", "An older
review lists as unrecorded" and "The list answers a versioned document", plus the part of "A second review continues
the numbering and drops nothing" that needs no fate record (F4 and F5 after F1–F3, and F1–F5 all listed). The parts
of those criteria that need a fate record (F2 `fixed`, a non-empty `history`) and every criterion about `fix`,
`dismiss`, `defer` and the pull request belong to plans 2 and 3. Say in the plan which criteria, or which parts, it
leaves to them.

Release context. 0.39.0 is released and installed; 0.40.0 is the opened version. Runs on this repository use the
installed phax. The spec's examples stamp 0.33.0; every new or changed shape in this plan is born at the opened
version, whatever the examples say.

What exists (read it before planning; the spec's baseline predates the Effect 4 migration, so trust the code, not the
spec's descriptions of it):
- `src/schemas/codeReview.ts` and `src/schemas/complianceReview.ts`: today the session's answer and the persisted file
  are one strict shape. §5.2 and §5.3 split them: the answer keeps refusing an `id` as an unknown key, the file
  requires one.
- `src/schemas/persisted.ts` and `packages/schemas`: the readers, their frozen shapes and the schema history. An older
  file is read through its reader and gets its ids at read time (§5.4), with no migration step and no rewrite.
- `src/schemas/reviewRecord.ts`, `src/app/writeReviewRecord.ts`, `src/app/reviewCode.ts` and the compliance review's
  use case: where a review is persisted and recorded on `phax/records/v1`.
- The command library and its contracts (`src/cli/commandLibrary/`, `src/cli/definitions/`, the command-contracts
  spec): `phax finding list` is a new `finding` group (q-family) with `--json`, message lines on stderr, refusals
  before any write.
- The property tests (`docs/property-tests.md`): a new persisted format or answer must register a generator in
  `tests/helpers/property/formatRegistry.ts`, or the coverage test fails by name.

Settle in Technical arbitrations, with the dominant loss of each:
- **Where `finding list` and the numbering read a run's reviews.** q-rereview settles that earlier reviews come from
  the records branch's history of the review's key. Decide what happens for a run whose project has records off, or
  whose run folder is gone (an archived run), and where the highest id already given (§5.1) is read from at persist
  time.
- **Lifting ids when a run has more than one review persisted before ids.** §5.4 lifts by position in document order.
  Two older code reviews of one run would both lift to `F1`…, which breaks "never reused within a run". Read the lift
  as continuing across the run's reviews, oldest first, as §5.1's numbering does, unless you find a reason not to;
  name the choice.
- **The `finding-list` answer's history.** No fate record exists until plan 2, so every history is empty here. Decide
  how the answer's shape carries `history` now so that plan 2 fills it rather than reshaping it, and say what plan 2
  must do to the stamp if a release is cut between the two plans.
- **How a run is named on the command line**, consistently with the other run commands (`phax path`, `phax enter`).

Shape. Every in-scope §8 criterion, or in-scope part, has its own named test. Core to surface: the file shapes and
their readers first, then id assignment at persist time, then the read model (reviews, lift, fates), then the
command, docs last. The docs page is `docs/findings.md` (§11): this plan writes the parts about ids, fates and
`phax finding list`, and leaves the fate commands to plan 2.

Never change a persisted format's shape or stamp except as the spec says, and never change the command contract to
make a test pass.

Lessons from the runs on this repository:
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase
  that creates it, or export it where it is first used.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **A new command regenerates the usage spec and the CLI docs** (`pnpm gen:usage-spec`, `pnpm docs:cli`), in the phase
  that adds the command.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.
- **A new persisted format or answer needs its property-test generator in the same phase.** Run that property file
  once with `pnpm test:property:deep <file>` before handing off, and record the seed and the result.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. `pnpm gen:usage-spec`, `pnpm docs:cli`, `pnpm test:unit` and `pnpm test:property:deep` are
`agentCommands` entries.
