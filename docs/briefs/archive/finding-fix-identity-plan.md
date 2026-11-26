Write the phax plan "Finding fix identity" for the approved spec `docs/specs/2611220956-finding-fix-identity.md`. It is
the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/archive/finding-fix-identity.md`. These are settled; do not
reopen them:
- the operator's verdicts of 2026-11-22 in §9b: q-key `finding-run` (`Finding-Run: <run id>`), q-store `read-time`,
  q-ambiguous `list-all`, q-squash-description `hint`, q-phase-commits `follow-up`;
- §10's settled list and constraints: the order of the search (base branch: recorded sha, key, patch id; then the
  run's branch the same way), the search range starting at the run's start, only the latest fixed entry resolved,
  the required `landed` on the finding-list document, no `Run-Id` on a fix commit, all git access through the Git
  port, `phax finding list` local (no fetch, no GitHub call), release-notes code unchanged;
- the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion, and the §11 docs page.

## Facts read on main at 06a3df7 (2026-11-26)

- **The fix commit.** `fixCommitBody` in `src/domain/findings/fixCall.ts` writes `Short-Name` then one `Finding: <id>`
  per id as the last paragraph. `src/app/findingFix.ts` commits the paths, or with `--commit <sha>` checks that the
  commit is on the run's final-phase branch or the base branch (`publish.baseBranch`, else `main`, local then
  remote-tracking) and refuses any other.
- **The fate record.** `src/schemas/findingFateRecord.ts` (a fixed entry: `commit`, `pathClasses`, `by`, `at`);
  `src/app/findingFateRecords.ts` reads and writes them on `phax/records/v1`, the latest record deciding the fate.
  The record's shape does not change.
- **The readers.** `src/app/findingList.ts` and `src/schemas/findingList.ts` (the published `finding-list` format,
  stamped 0.40.0 in `src/schemas/release.ts`, listed in `packages/schemas/src/formats/commandAnswers.ts`);
  `src/cli/definitions/finding.ts` renders the text list; `src/domain/findings/fateComment.ts` words the comment;
  `src/app/findingPost.ts` and `src/app/findingPullRequest.ts` post it and refuse a merged or closed pull request.
- **The Git port.** `src/ports/git.ts` and `src/infra/git.ts` have `commitMessage`, `commitExists`, `mergeBase`,
  `resolveRef`, `commitBefore`, `commitPatch`, but no ancestry test over a range, no trailer or message search over
  a branch's range, and no patch id. `security-high-fixes` (#265) runs every worktree git call through one helper
  with `-c core.fsmonitor=false`, `-c core.hooksPath=/dev/null` and a checked gitdir pointer: new calls go through
  it.
- **Trailers elsewhere.** `src/app/recordsExplain.ts` finds a phase commit by its `Run-Id`/`Phase-Id` trailers;
  `scripts/release-notes.ts` reads only `Run-Id` and `Short-Name` and must not change.
- **The docs.** `docs/findings.md` ("Recording an earlier commit" is where the new section goes).

## Settle in Technical arbitrations, with the dominant loss of each

- **The run's start time** (§10, left open): where it is read for a live run and for an archived one (run-status,
  the run record, the first phase commit), and what a run without one does.
- **One walk or one per finding** (§10, left open): one log walk per branch per run serving every fixed finding of
  the run, or each finding resolved on its own.
- **The Git port's new calls**: their shape (an ancestry test, the commits of a range with their full messages, a
  patch id of a commit and of each commit of a range), so that domain code matches keys and patch ids purely and the
  port only reads. A key may sit in any paragraph of a message, not only the last: say how the message is read.
- **The finding-list format moves**: the new stamp, the frozen copy of the 0.40.0 decoder under
  `src/schemas/history/finding-list/`, the schemas package (`commandAnswers.ts`, its lift of a 0.40.0 document,
  which has no `landed`: never invent one), the behaviour corpus (accepted and refused next-shaped cases covering
  every path of `landed` and its constraints, so the release rehearsal's coverage check passes), and
  `docs/upgrading.md`.
- **The closure guard.** A new frozen module must be listed in `CLOSURE_SRC_ALLOWLIST` in
  `tests/unit/architecturalGuards.test.ts`, a protected path. The `plan-gate-profile` run handled it by the
  operator lifting the protection for the run (q-closure-guard `lift-for-run`), with a pre-merge check that the
  file's diff is exactly the new paths. Raise it as a question with that precedent; name the exact path(s) the
  phase adds.

## Shape

Indicatively: the Git port's reads and the pure resolution (domain) first, with unit tables over fixture commit
lists; then the fix commit's `Finding-Run` trailer; then `finding list` (document, text) and the format move; then
the comment, `finding post` on a merged pull request and its refusal; then `--commit` following a rewrite; then the
docs. Models: `claude-opus-5-5` at medium for the port, the resolution and the commands; a docs phase may run on
`claude-sonnet-5`.

The §8 criteria are git scenarios: drive them in temporary repositories built by the test (a Rebase and merge is a
rebase onto `main` and a fast-forward of `main` to the recreated commits, then the run branch deleted; a squash is
one commit whose message holds the squashed messages; "the repository no longer holds the old sha" is a pruned
branch plus `git gc --prune=now` or a sha never written). The GitHub side of `finding post` goes through the
existing fakes. No acceptance phase: the surface is CLI text, a JSON field and a comment, all checked by those
tests.

This plan is authored while 0.43.0 is being released. If the planning prompt lists the project's gate profiles,
declare `standard` under `## Gate profile`; if it does not, write no such section (the operator migrates the plan
with `phax artifact migrate-documents --gate-profile standard`).

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Both baselines only shrink, and their prune is the operator's.** A phase that deletes code carrying accepted
  debt (an unused export, an unsafe assertion in a test it removes) fails its gate until the operator prunes. Say in
  the phase's handoff which debt it removes, so the stop is expected.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows, `tests/unit/architecturalGuards*.test.ts` (see the closure guard above).
- **Tests never read `~/.phax`, a real provider home, the global git config or the network.** A test that spawns a
  child goes through `tests/helpers/boundedSpawn.ts`; a temporary repository sets its own `user.name` and
  `user.email`.
- **Regenerated files**: a CLI help change regenerates `phax.usage.kdl` and `docs/cli/reference.md`
  (`pnpm gen:usage-spec`, `pnpm docs:cli`); a schema change regenerates `packages/schemas/json/` (`pnpm build` runs
  `scripts/schemas-json.ts`) and its stamp goes through `pnpm exec tsx scripts/schemas-check.ts --write`, never by
  hand. Plan them in the phase that changes the source.
- **A new persisted or published shape** goes with a `docs/upgrading.md` entry and the frozen copy of the previous
  version.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `pnpm gen:usage-spec`,
`pnpm docs:cli`, `pnpm dev schema upgrade`, `git log`, `git grep`, `git mv`, `node` are `agentCommands`; `pnpm test`
is a gate command.
