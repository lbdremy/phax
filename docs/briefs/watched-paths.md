Write the phax spec `watched-paths`: a project names the files whose change the operator must see, between the ones
no phase may change (`protectedPaths`) and all the others. A phase may change a watched file only if its plan names it,
so the operator sees the change when approving the plan; a phase that changes one its plan does not name fails its
gate; and the run's pull request lists the watched files the run changed in a section of their own.

## Why

The operator, 2026-11-25. Protecting the architecture guards (`tests/unit/architecturalGuards*.test.ts`, added to
`protectedPaths` in the same pull request as this brief) left a door open in `package.json`: its `audit:architecture`
script and its `check:full` choose which tests the gate runs, so a phase that edits one line of it can switch a guard
off without touching the guard. `package.json` cannot be protected: phases add dependencies and scripts to it as a
matter of course.

The file reconciliation weighs every path the same. Each phase declares the files it creates and edits; phax compares
them with the diff and reports what was planned but not done and what was done but not planned
(`src/domain/reconciliation/`). A planned edit to `package.json` reads like a planned edit to a README, and nobody
looks at it again. An unplanned one is one more deviation the agent justifies in its handoff: a model's sentence, read
at review among the others (`## Needs your review` › "Unexplained deviations", `src/domain/publish/prBody.ts`), or not
read at all when the agent explained it.

The operator's attention goes to two moments: the plan's approval, before the run, and the review, after it. A watched
file must show at the first, and fail the run when it was not shown there. A line in a report that leaves the gate
green is read by no one (`docs/briefs/knip-production.md`, item 5).

## The direction (the operator's, 2026-11-25)

1. **A third tier.** Protected: no phase may change it. Watched: a phase may change it only if its plan names it.
   The rest: reconciled as today. A key of `phax.json` beside `protectedPaths`, its globs in the same dialect; its name
   is a placeholder until the spec settles it.
2. **Seen at approval.** When a plan is linted and approved, phax names each phase that plans to create, change,
   delete or rename a watched file, with the glob that watches it. That is where the operator says no, before the run,
   when it costs a sentence. `docs/briefs/protected-path-exceptions.md` (item 4) asks `phax plans lint` for the same
   probe on protected paths: one probe for both.
3. **Unplanned means red.** A phase that changes a watched file its plan does not name fails its gate, naming the file
   and the glob, as a protected path does. It is not a deviation to explain in the handoff.
4. **Planned means listed.** The watched files a run changed, each with the phases that changed it, get their own
   section in the run's pull request, under `## Needs your review`, and reach the compliance review and the review
   handoff.
5. **No warning.** Nothing of this is a line that leaves the gate green: it is shown at approval, fails the gate, or is
   listed for review.

## What phax has today, to read first

- `docs/security.md`, "Protected paths", and `src/app/protectedPathsCheck.ts`: the key, its glob dialect, its
  refusals, and where it is checked (each gate attempt in `src/app/fixLoop.ts`, the commit-only resume and a held
  phase's re-entry in `src/app/executePlan.ts`, after the handoff turn in `src/app/handoffGeneration.ts`).
- `src/domain/reconciliation/` (`reconcile.ts`, `global.ts`, `explained.ts`): planned, planned but not done, done but
  not planned, and which deviations the handoff explains.
- `src/domain/publish/prBody.ts`, `## Needs your review`.
- `phax plans lint`, which already reads `phax.json` (the assignment bounds) and probes the paths each phase names.
- `docs/briefs/protected-path-exceptions.md` (the operator lets one phase change a protected path, granted at the
  phase's resume) and `docs/briefs/review-map.md` (where review attention belongs; its map holds the reconciliation's
  flagged files).

## What the spec must cover

- **The key**: its name, where it may be declared (`phax.json` only, like `protectedPaths`, or the overlays too), its
  refusals (a malformed glob, a directory without `**`), and a path both protected and watched (protected wins, or
  refused).
- **What "the plan names it" means**: the phase's file entries matched against the globs, for a file created, edited,
  deleted or renamed; whether an earlier phase's entry counts for a later phase (recommended: no, each phase names its
  own).
- **The approval surface**: what `phax plans lint` and `phax artifact approve` show, in text and in `--json`; whether
  approval asks anything more of the operator than reading it.
- **The gate failure**: where it is checked (the moments protected paths are), its wording, and what the fix loop is
  told: revert the change, since the agent cannot amend an approved plan. The route when the operator wants the
  change: the same as a protected path's (`protected-path-exceptions`), or a plan revised before the phase resumes.
- **The records and the review**: where the watched changes are recorded with the phase, the pull request's section,
  and what the compliance review and `phax review-code` receive.
- **The documentation to touch when it ships**: `docs/security.md`; `docs/comparisons/agentic-practices.md`, its row
  "Files only a person may change" and its "last checked" line.

## Open questions

- **The name.** "Watched" is a placeholder: the spec looks for the literature's term before coining one.
- **A default list.** phax ships none (the project declares every glob), or a short default the project can drop
  (manifests, lockfiles, CI configuration). The lockfile changes whenever a dependency does: watching it doubles every
  dependency change.
- **What the compliance review does with a planned change**: list it only, or check it against what the plan says
  the phase does to that file.
- **A case first.** Find a past run where a planned or unplanned change to such a file mattered, and say what each
  part of this would have shown, before the spec settles the surface.

## Out of scope

- What a protected path means, and the exceptions to it (`protected-path-exceptions`).
- The review map (`review-map`).
- Watching paths outside the worktree.

## Constraints

- Additive: a project that declares no watched path sees no change in behaviour, argv, prompts or output.
- Keep the spec short, with only genuine §9 questions, each with its options, what each abandons and a recommended
  default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
