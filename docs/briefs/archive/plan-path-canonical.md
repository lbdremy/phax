Write the phax spec `plan-path-canonical`: every file path a plan names reaches phax in one canonical,
repository-relative form, decided once where the plan is decoded, so that each check reading those paths compares the
same strings.

## Why

A phase's `plannedFilesToCreate`, `plannedFilesToEdit` and `optionalFilesToEdit` are bare `Schema.String` arrays
(`ExtractedPhaseFields`, `src/schemas/phaxPlan.ts`). Nothing says what shape a path takes, so `./src/widget.ts`,
`src//widget.ts` and `src/a/../widget.ts` all decode, and each one is a different string from the `src/widget.ts`
that git reports.

Pull request #205 (2026-11-11, an outside contribution) found the gap in `plans overlap`: two plans editing the same
file under two spellings were reported as clean. It fixed the overlap footprints alone, normalizing in
`buildFootprint` and `buildLandedFootprint` (`src/domain/planOverlap/compute.ts`). It was declined in favour of this
brief, because every other reader compares the raw strings and would still disagree with the overlap report:

- **Reconciliation** (`src/domain/reconciliation/reconcile.ts`) matches planned paths against the run's diff. A
  phase that plans `./src/x.ts` and changes `src/x.ts` reports one missing and one unplanned file.
- **Plan lint** (`src/domain/plan/lint.ts`): "create and edit both list", "already created by", and the
  working-tree probe of each create and edit path all use the string as written.
- **Glob checks**: the assignment bounds (`src/domain/plan/assignmentCheck.ts`, `matchesAnyGlob`) and the protected
  paths, whose globs are written in canonical form; `./src/x.ts` does not match `src/**`.
- **Staleness** (`src/app/planStaleness.ts`): the plan's footprint is compared with what git says changed since the
  approval.

Normalizing in each reader repeats the fix in every one of them and leaves the next reader to forget it. The plan is
decoded in one place, so its paths can be made canonical there.

## What phax has today, to read first

- The two ways a plan's paths arrive: the extraction model's answer (`PlanExtractionAnswerSchema`,
  `src/schemas/planExtraction.ts`) and the headless planner's plan document (`PlanDocumentPhaseSchema`,
  `src/schemas/planDocument.ts`). Both carry `ExtractedPhaseFields`.
- `posix.normalize` already in the domain: `src/domain/decide/verdicts.ts`.
- The readers listed above, and `planInputFromPhaxPlan` (`src/domain/planOverlap/fromPhaxPlan.ts`).
- The `validation-boundaries` skill: external input is decoded through a schema before it enters the domain.
- Pull request #205's two tests (`tests/unit/planOverlap/compute.test.ts`), a ready statement of the overlap case.

## The direction (the operator's, 2026-11-13)

1. **One schema for a plan path**, shared by the three file lists of both entry points, so that the persisted
   `phax-plan.json` and the plan document only ever hold canonical paths.
2. **Canonical means**: relative to the repository root, `/` separators, no `.` or empty segments, no `..` segment,
   no leading `/`, no trailing `/`.
3. **The readers stay as they are**: once the decode guarantees the form, no reader normalizes again.

## What the spec must cover

- **The schema**: its name and home, the rule it states, and whether it lives on `ExtractedPhaseFields` so both entry
  points share it.
- **What the decode does with a path that is not canonical but has one** (`./src/x.ts`, `src//x.ts`): rewrite it, or
  refuse it. To weigh in §9: rewriting keeps a model's harmless variation from failing an extraction; refusing keeps
  the plan document byte-for-byte what was written and approved. Recommended: rewrite on the extraction answer,
  refuse in the plan document, which a planner writes and an operator approves.
- **What is always refused**: an absolute path, a path that leaves the repository (`..`), an empty one; and the
  refusal's wording, naming the phase and the path.
- **Persisted plans**: versioned schemas, so the version bump and what an existing `phax-plan.json` or plan document
  holding a non-canonical path does on read, in line with the project's no-back-compat-shims rule.
- **The acceptance criteria**: one per reader above, each showing that a plan written with `./src/x.ts` and a change
  to `src/x.ts` agree.

## Out of scope

- Symbolic links, case-only differences, Unicode normalization of file names.
- Globs in plans: the file lists name files.
- Normalizing paths that come from git, which are canonical already.

## Constraints

- Additive for canonical plans: a plan whose paths are already canonical sees no change in behaviour or output.
- Keep the spec short, with only genuine §9 questions, each with its options, what each abandons and a recommended
  default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
