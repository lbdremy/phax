Write the phax spec `protected-path-exceptions`: the operator can let one phase of a run change a protected path,
by name, when that change is wanted. The exception is the operator's act, scoped to one phase and the paths it names,
and recorded with the phase; the run goes on from that phase without being restarted.

## Why

`protected-paths` made every path of `phax.json`'s `protectedPaths` the operator's: no phase may create, change,
delete or rename one, and a phase that does fails its gate. It names one route for a change the operator wants: make
it on the base branch and start a new run. Its out-of-scope list left "a route to change a protected file while a
phase is paused" for later.

A held run of 2026-11-11, fourteen phases with holds, hit that gap at its eighth phase. The plan moved a test helper
into a folder of its own and split a place of the project's standard in two. A conformance script, protected, checks
that every test file sits in that place and reads only the folder's top level, so it refused the new layout. The
phase's agent fixed the script, which was the right change, and the gate refused the phase: protected paths changed.
The operator agreed with the change. What phax offered:

- **Start a new run** from a base branch carrying the change: redo seven committed and reviewed phases, their holds'
  corrections included.
- **Keep the run**: land the change on the base branch in a pull request, rebase the phase's branch onto it, then
  rewrite the phase's `base` in `status.json` by hand, since the check compares the worktree with the base recorded
  when the phase started (`readPhaseBase`, `src/app/phaseStatusUpdates.ts`; `checkProtectedPaths`,
  `src/app/protectedPathsCheck.ts`), never with the branch. The records of the earlier phases then name commits that
  the run's pull request no longer contains.

The operator took the second, with a hand edit of a run file. Neither route is one phax names or records.

## What phax has today, to read first

- `docs/security.md`, "Protected paths"; the archived brief `docs/briefs/archive/protected-paths.md`.
- The check and where it runs: each gate attempt (`src/app/fixLoop.ts`), the commit-only resume and a held phase's
  re-entry (`src/app/executePlan.ts`), after the handoff turn (`src/app/handoffGeneration.ts`). A stop's close is not
  checked: at a hold or an interactive stop, a person's correction may already change a protected path. The gap is a
  phase whose gate needs the change before it can reach its stop.
- The phase's posture in `security.json` (`protectedPaths`, per provider `enforced`, `partial`, `commit-check-only`)
  and the native rules each provider receives.
- `phax resume`'s per-invocation flags scoped to the phase it restarts at, `--skip-acceptance` the model: it applies
  only to that phase and only in that invocation, and is recorded in the phase's `gate-attribution.json`.
- The skill edit grants (`--allow-skill-edits`): a path opened file by file, refused on a protected path before the
  run is named.

## The direction (the operator's, 2026-11-12)

1. **An exception, not a looser list.** `protectedPaths` stays in `phax.json` only, unchanged. What changes is that
   the operator can grant, for one phase, the change of paths it names.
2. **Granted when the phase is resumed**: the operator re-runs the phase saying which protected paths it may change.
   A plan cannot grant itself one, and neither can an agent: the phase guard already refuses phax's state commands
   inside a phase.
3. **Recorded.** The phase's records say which paths were excepted, by whom and when, and the change shows in the
   run's pull request like any other.

## What the spec must cover

- **The surface**: the resume flag (or its alternative), what it names (exact paths or globs from the list), and its
  refusals: a path not protected, a phase that is not the one resumed, a run not paused on a protected-path failure.
- **What the exception lifts**: the check at the gate, at the commit and after the handoff turn, for those paths in
  that phase; whether the providers' native deny rules are dropped for them in that phase's sessions or the fix loop
  only is told the change is allowed.
- **Later phases**: whether a later phase may change the excepted path again (recommended: no, the exception is the
  phase's).
- **Recording**: where it lives (`security.json`, `gate-attribution.json`), its version bump, and how the final report
  and the pull request body show it.
- **The alternative to weigh in §9**: `phax rebase <run>` moving the run's remaining phases onto a base branch that now
  carries the change, rewriting the recorded bases. It keeps the change off the run's branch, at the cost of records
  that name commits the pull request no longer holds.

## Out of scope

- An exception declared in the plan or in any configuration file.
- Changing `protectedPaths` itself, or what a protected file means.
- Exceptions for paths outside the worktree.

## Constraints

- Additive: a run that grants no exception sees no change in behaviour, argv, prompts or output.
- Keep the spec short, with only genuine §9 questions, each with its options, what each abandons and a recommended
  default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
