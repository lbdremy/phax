Write the phax plan "Finding fates on the pull request" for the approved spec
`docs/specs/2611041509-finding-ids-and-fates.md`. It is the spec's third and last plan: it carries
`completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the operator decisions in §9b, above all q-pr-refresh as revised on 2026-11-04 (a fate set after the PR opened
  reaches it as one comment per finding, when the fate is set; the description is written once, at creation, and never
  rewritten; posting follows `publish.auto`; no pull request yet, nothing posted) and q-plans `three-plans`;
- everything §10 lists as settled, and its constraints;
- the Technical arbitrations of plan 1 (`docs/plans/archive/2611171555-finding-ids-and-fates-plan.md`) and plan 2
  (`docs/plans/archive/2611181515-finding-ids-and-fates-plan.md`), as amended by their review fixes (#239, #242). In
  particular: the fate record layout and its reader, the run naming, the `review_open` rule for `fix`, dismiss and
  defer running on any run whose records exist, and §5.8 read as the list's contract only (the spec now says so).

This plan takes the pull-request side: §5.21 to §5.25, §5.26 and §5.27 where they are not yet proved, the §6 surfaces
"run pull request description — findings section" and "run pull request comment", and the acceptance criteria plan 2
left: AC-pr-section, AC-pr-description-not-rewritten, AC-pr-fix-pushes-and-comments, AC-pr-dismiss-defer-comment,
AC-pr-no-pr, AC-publish-auto-off, AC-list-local and AC-never-blocks. Plan 2's commands make no push and no GitHub call today; this plan adds both,
only when the run has a pull request and `publish.auto` is on.

What exists (read it before planning):
- Plan 1 and 2's code: `src/app/runReviews.ts`, `src/app/findingList.ts`, `src/app/findingFateRecords.ts`,
  `src/app/findingFix.ts`, `src/app/findingSettle.ts`, `src/cli/definitions/finding.ts`, `docs/findings.md`.
- Publication: `src/app/publishRun.ts` (push, PR creation, `pr-body.md`, `publication.json` in the run folder),
  `src/domain/publish/prBody.ts` (the short PR body and its byte cap), `src/schemas/publication.ts`,
  `src/app/resolveRunInfo.ts` (the final phase's branch is the one its status recorded), `phax publish-pr`.
- The order of the run-end reviews and the publication in `src/app/executePlan.ts`: the description must see the
  findings of the reviews that ran before it.
- The GitHub port `src/ports/github.ts` (it has no comment operation yet), its `gh` adapter and its fake; the Git port's
  push.
- How an archived or pruned run is resolved by dismiss and defer (plan 2), and what remains of its run folder.

Settle in Technical arbitrations, with the dominant loss of each, the points §10 leaves open that this plan needs:
- **How a fate command finds the run's pull request**: from `publication.json` in the run folder, from the host
  (`findPullRequestForBranch` on the run branch), or both in that order; what happens for an archived or pruned run
  whose folder is gone; and whether a merged or closed pull request still gets a comment.
- **What a fate command does when its push or its comment fails** after the commit and the record landed (indicative
  in the spec: keep both, report that the pull request was not updated, name the retry). Say which exit code, what
  `--json` answers, and what the retry is; a retry must never record the fate twice.
- **Which branch `phax finding fix` pushes and how**: the pull request's head branch, a plain push, never a force-push;
  what happens when the remote branch has moved (refuse to post, keep commit and record).
- **The findings section in the description**: where it sits in the short body, how it renders under the byte cap
  (what is dropped first when the body is shortened, and that the counts always stay), and how a finding with no
  location renders (a compliance finding names its phase).
- **The comment's text**: the §6 lines, one comment per finding settled; whether one `fix` naming several ids posts
  them in one call or several (the spec says one comment per finding).
- **Exit codes and the `--json` answer** of the fate commands once they push and post (what was pushed, which comments
  were posted, which failed), within the existing families and declared per command-contracts.

Shape. Every in-scope §8 criterion, or in-scope part, has its own named test. Core to surface: the findings-section
renderer and the comment text first (pure, domain), then the GitHub port's comment operation (adapter contract test
against a fake `gh`, never the real one), then the description at PR creation, then the fate commands' push and
comments, docs last. Show the surface in an acceptance phase before its code when an acceptance provider is configured.
Tests build their repositories, run worktrees, records branches and bare remotes as temporary git repositories, and
stand in for GitHub with the fake port or a fake `gh` on PATH; none reads a real `~/.phax`, a credential store, a real
`gh` login or the global git config, and none reaches the network. Docs: extend `docs/findings.md` with the pull-request
behaviour (§11's example) and say what happens offline and with `publish.auto` off.

A counter-example found during the run is a bug in the code under test unless the test made it. Never change a
persisted format's shape or stamp except as the spec says, and never change the command contract to make a test pass.

Lessons from the runs on this repository:
- **Acceptance oracles must match how the existing code works.** Plan 2's acceptance phase wrote two wrong oracles: it
  read a `phax/records/v1` commit's diff, but each records commit holds only its own record (its diff also shows the
  previous record removed), and it forgot findings its own fixture wrote. Before writing an expected value, read the
  fixture and the helper it relies on; check a records commit by its tree (`git ls-tree`), never by its diff.
- **knip runs at every phase's gate.** An export that only a later phase uses fails the gate. Test it in the phase that
  creates it, or export it where it is first used.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version or
  expect a `next` shape literally, except behaviour-corpus cases.
- **A new or changed persisted format needs its property-test generator in the same phase.** Run that property file
  once with `pnpm test:property:deep <file>` before handing off, and record the seed and the result.
- **A new command, flag or help text regenerates the usage spec and the CLI docs** (`pnpm gen:usage-spec`,
  `pnpm docs:cli`) in the phase that changes it; list `phax.usage.kdl`, `docs/cli/reference.md` and the README's
  generated CLI list as planned files.
- **The phase gate runs the whole suite on a busy machine.** A test that measures wall-clock time fails there, and a
  test that spawns a child must give it a timeout.
- **After the acceptance phase, edit only the expected-failure markers in an acceptance test file.** Never retype a
  test's title.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly. An entry with a space
in it covers only itself. `pnpm gen:usage-spec`, `pnpm docs:cli`, `pnpm exec tsx`, `pnpm test:unit` and
`pnpm test:property:deep` are `agentCommands` entries.
