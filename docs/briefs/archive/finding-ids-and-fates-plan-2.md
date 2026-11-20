Write the phax plan "Finding fates: fix, dismiss and defer" for the approved spec
`docs/specs/2611041509-finding-ids-and-fates.md`. It is the spec's second plan of three, not its last: it carries
`completes-spec: false`. The pull request's findings section and the fate comments follow in the third plan.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the nine operator decisions of 2026-11-04 in §9b (q-fix-paths `named-paths`, q-where `review-open`, q-family
  `finding-group`, q-subject `default-override`, q-rereview `records-history`, q-backfill `commit-flag`, q-pr-refresh,
  q-plans `three-plans`);
- everything §10 lists as settled, and its constraints;
- plan 1's Technical arbitrations (`docs/plans/archive/2611171555-finding-ids-and-fates-plan.md`), as amended by its
  review fixes in #239: where a run's reviews are read, the id lift, how a run is named, the `finding-list` answer's
  shape, and `history` left empty for this plan to fill.

Two of the spec's ground paths moved: the headless-review spec is `docs/specs/archive/2609250823-headless-review.md`
(Abandoned) and the command-contracts spec is `docs/specs/archive/2611031738-command-contracts.md` (Completed).

This plan takes the fate side: §5.5 (the latest fate record decides), §5.9 to §5.20, the §6 surfaces `phax finding
fix`, `phax finding dismiss`, `phax finding defer`, the fate record on `phax/records/v1` and the `Finding` trailer, and
`phax finding list` showing fates and their details. Its acceptance criteria are those plan 1 left to plan 2:
AC-rereview-continues's F2 `fixed`, AC-list-json's non-empty `history`, AC-lift-settable, AC-list-text,
AC-fix-commits-named-paths, AC-fix-records, AC-path-classes, AC-fix-refusals, AC-fix-state, AC-machine-fix, AC-dismiss,
AC-defer, AC-settle-refusals, AC-machine-never-settles, AC-records-off, AC-record-failure and AC-latest-wins. Leave to
plan 3 everything about the pull request: §5.21 to §5.25, the push before a comment, the fate comments, and what a
fate command does when a push or a comment fails. In this plan the fate commands make no push and no GitHub call at
all, whatever `publish.auto` says; say so in the plan.

Release context. 0.39.0 is released and installed; 0.40.0 is the opened version, and no release has been cut since
plan 1, so plan 1's `finding-list` `next` snapshot still exists: fill `history` by editing it in place, as plan 1's
arbitration says. If a release is cut before this plan runs, follow plan 1's procedure for that case instead. Every new
shape is born at the opened version; no test names it literally.

What exists (read it before planning):
- Plan 1's code: `src/app/runReviews.ts` (records history, kept unrecorded reviews, the id fold), `src/app/findingList.ts`,
  `src/cli/definitions/finding.ts`, the `finding-list` format and `docs/findings.md`.
- The records branch: how a record is keyed and committed (`src/app/writeReviewRecord.ts`, the decision record in
  `src/schemas/decisionRecord.ts`), how a failed record write degrades, `phax records status`.
- The decided-verdict shape (`src/schemas/questions.ts`) for the dismissal (§5.14).
- How artifact transitions commit exactly the paths they wrote (`phax artifact approve` and the others): the pattern for
  the fix commit, with `git commit -o <paths>` semantics that never sweep other staged changes.
- How `phax artifact approve` takes `--by` without a terminal, and the operator name from the committing Git identity
  (§5.18).
- How a run's final worktree is found (`phax path`, `phax enter`) and how the run state is read (`review_open`).
- The release notes' reading of `Short-Name` (`scripts/releaseNotes.ts`): fixing commits keep `Short-Name` and carry no
  `Run-Id`, so they fold into their run.

Settle in Technical arbitrations, with the dominant loss of each, the points §10 leaves open that this plan needs:
- **The path-class rule**: which paths are `tests`, which `gate-config` (`phax.json` and the gate tools' config files),
  `docs` and `code`; each path gets exactly one class, the rule lives in one place, and is derived from the path alone.
- **The fate record**: its key layout and manifest name on `phax/records/v1` (indicative `<runId>/finding/<id>/<NN>`,
  kind `finding-fate`), its shape per fate (an explicit variant per fate, not one permissive shape), and whether one
  fix call writes its per-id records in one records commit.
- **The dismissal's decided verdict**: `advocate`, `principles` and `reversibility` (indicative: the finding's
  suggestion, or its message for a compliance finding; empty; `cheap`).
- **`--commit <sha>`** (q-backfill): which commits it accepts (reachable from the run branch or `main`), how path
  classes are read from that commit, and how it is the retry for a fix whose record failed (§5.20).
- **How `phax finding fix` resolves paths**: relative to the run's final worktree root, or to the current directory
  when it is inside that worktree.
- **Exit codes** of the refusals, within the existing families and declared per command-contracts.
- **Where dismiss and defer run**: q-where says on any run whose records exist, archived and merged runs and
  `unrecorded` findings included; say how such a run is resolved, reusing plan 1's run naming.

Shape. Every in-scope §8 criterion, or in-scope part, has its own named test. Core to surface: the path classes and the
fate record format first, then reading fates into the list (latest decides, history oldest first), then the fix
command, then dismiss and defer, docs last. Show the commands' surface in an acceptance phase before their code when an
acceptance provider is configured. Tests build their repositories, run worktrees and records branches as temporary git
repositories; none reads a real `~/.phax`, a credential store or the global git config. Docs: extend
`docs/findings.md` with the fate commands (§11's example).

A counter-example found during the run is a bug in the code under test unless the test made it. Never change a
persisted format's shape or stamp except as the spec says, and never change the command contract to make a test pass.

Lessons from the runs on this repository:
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase
  that creates it, or export it where it is first used.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **A new or changed persisted format needs its property-test generator in the same phase** (the fate record manifest,
  the `finding-list` answer's history). Run that property file once with `pnpm test:property:deep <file>` before
  handing off, and record the seed and the result.
- **A new command or flag regenerates the usage spec and the CLI docs** (`pnpm gen:usage-spec`, `pnpm docs:cli`) in
  the phase that adds it; the cross-command tests (`everyCommandJson`, `usageSpecDeclarations`, the root help text)
  need the new commands too, so list them as planned files.
- **The phase gate runs the whole suite on a busy machine.** A test that measures wall-clock time fails there; measure
  CPU time or count operations instead.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. `pnpm gen:usage-spec`, `pnpm docs:cli`, `pnpm exec tsx`, `pnpm test:unit` and
`pnpm test:property:deep` are `agentCommands` entries.
