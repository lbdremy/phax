Write the phax spec `watched-paths`: a project names the files that matter, and every change a run makes to one is
raised at review on its own, apart from the reconciliation's other files. Between the files no phase may change
(`protectedPaths`) and all the others, a watched file may change, planned or not; what changes is that the operator
always sees it.

## Why

The operator, 2026-11-25. Protecting the architecture guards (`tests/unit/architecturalGuards*.test.ts`, added to
`protectedPaths` in the same pull request as this brief) left a door open in `package.json`: its `audit:architecture`
script and its `check:full` choose which tests the gate runs, so a phase that edits one line of it can switch a guard
off without touching the guard. `package.json` cannot be protected: phases add dependencies and scripts to it as a
matter of course.

phax already reconciles every phase with its plan: each phase declares the files it creates and edits, and phax
reports what was planned but not done and what was done but not planned (`src/domain/reconciliation/`). What it does
not do is tell one file from another. A planned edit to `package.json` reads like a planned edit to a README and is
never mentioned again; an unplanned one is one more deviation among the others, and leaves `## Needs your review` ›
"Unexplained deviations" (`src/domain/publish/prBody.ts`) as soon as the agent's handoff explains it. The change that
could switch a check off reaches the review as one line in a list, or not at all.

## The direction (the operator's, 2026-11-25)

1. **A list of the files that matter.** A key of `phax.json` beside `protectedPaths`, its globs in the same dialect;
   its name is a placeholder until the spec settles it. `package.json`'s scripts are the first case.
2. **Raised at review, every time.** Each watched file a run changed, with the phases that changed it and whether
   each planned it, gets its own section under `## Needs your review` in the run's pull request, before the
   unexplained deviations. A planned change and an explained one are listed too: the section says what changed in a
   file that matters, not what went wrong.
3. **The reviewers get it too.** The compliance review, `phax review-code` and the review handoff receive the same
   list, so a review session starts from those files.
4. **The reconciliation stays as it is.** Planned, planned but not done, done but not planned: nothing of it changes;
   the watched files are read from it.
5. **No warning.** The list is not a line in a log that leaves the gate green and that no one reads: it sits where the
   operator's attention already goes, at the top of what they review.

## What phax has today, to read first

- `src/domain/reconciliation/` (`reconcile.ts`, `global.ts`, `explained.ts`): planned, planned but not done, done but
  not planned, and which deviations the handoff explains.
- `src/domain/publish/prBody.ts`, `## Needs your review` (compliance attention points, unexplained deviations) and how
  its lists are cut to fit the body.
- The review handoff (`src/app/loadReviewHandoffInputs.ts`, `src/app/handoffGeneration.ts`), the compliance review's
  prompt and the code review's (`src/domain/review/codeReviewPrompt.ts`).
- `docs/security.md`, "Protected paths": the key `watched-paths` sits beside, its glob dialect and its refusals.
- `docs/briefs/review-map.md`: where review attention belongs; its map holds the reconciliation's flagged files, and
  the watched files would join it.

## What the spec must cover

- **The key**: its name, where it may be declared (`phax.json` only, like `protectedPaths`, or the overlays too), its
  refusals (a malformed glob, a directory without `**`), and a path both protected and watched.
- **What counts as a change**: a file created, edited, deleted or renamed in the run's diff against its base.
- **The pull request's section**: its title, its place under `## Needs your review`, one line per file (the path, the
  glob, the phases, planned or not, explained or not), and how it is cut when the body is long.
- **The review sessions**: what the compliance review, `phax review-code` and the review handoff receive, and in what
  order.
- **The records**: whether the list is recorded with the run (a key of the global reconciliation) or computed when
  the pull request is written.
- **The documentation to touch when it ships**: `docs/security.md` or the review guide; `docs/comparisons/agentic-practices.md`
  and its "last checked" line.

## Open questions

- **The name.** "Watched" is a placeholder: the spec looks for the literature's term before coining one.
- **A default list.** phax ships none (the project declares every glob), or a short default the project can drop
  (manifests, lockfiles, CI configuration). The lockfile changes whenever a dependency does: watching it doubles every
  dependency change.
- **Before the run too?** Whether `phax plans lint` and the approval also name the phases that plan to change a
  watched file, so the operator can say no before the run. `docs/briefs/protected-path-exceptions.md` (item 4) asks
  the lint for the same probe on protected paths.
- **Red when unplanned?** Whether a phase that changes a watched file its plan does not name fails its gate, as a
  protected path does, instead of being listed. It closes the door at the gate, at the cost of a revert and a resume
  for every change no plan could foresee.
- **A case first.** Find a past run where a change to such a file mattered, and say what the section would have shown.

## Out of scope

- What a protected path means, and the exceptions to it (`protected-path-exceptions`).
- The review map as a whole (`review-map`).
- Watching paths outside the worktree.

## Constraints

- Additive: a project that declares no watched path sees no change in behaviour, argv, prompts or output.
- Keep the spec short, with only genuine §9 questions, each with its options, what each abandons and a recommended
  default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
