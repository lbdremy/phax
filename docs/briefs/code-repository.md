Write the phax spec `code-repository`: a project whose process (specs, plans, briefs, their approvals) lives in one
repository and whose code lives in another, checked out inside it, keeps every guarantee phax gives a plan, the plan's
staleness against the code it reads above all.

## Why

A project may open its code and keep its process private: the code, its tests and its samples in a public repository;
the specs, plans and briefs, which say where the work is going, in a private one. The private repository holds the
public one checked out inside it and ignored by it (`code/`, say). This layout already works with phax, unchanged, as
a trial with phax 0.27 measured:

- headless authoring runs in the process repository and reads the code under `code/` (Grep and Glob find it, though
  the process repository's `.gitignore` lists `/code/`); a brief tells the plan to write its paths relative to the
  code's root, and it does;
- `phax artifact approve` and `phax artifact complete` commit in the process repository;
- `phax run --plan ../docs/plans/<plan>.md`, from the code repository, runs the plan as a loose plan: the plan must be
  `Approved`, the phases get it through their prompt and `.phax-context/plan.md`, the gates pass, the run reaches
  review;
- with `records.destination` `{ "kind": "repo", "remote": <the process repository's URL> }` in the code repository's
  `phax.json`, each phase's record goes to the process repository's remote on `phax/records/v1`, and the code
  repository holds no records ref.

What it loses, against a plan that lives with its code:

- **The plan's staleness against its ground.** A plan is stale on three kinds of evidence (`src/app/planStaleness.ts`,
  `computeStaleness` in `src/domain/artifact/lineage.ts`): `self-changed` (the plan's fingerprint) and `spec-changed`
  (its spec's) still hold, both being in the process repository; `ground-changed` does not. It diffs the files of the
  plan's footprint since the approval's baseline in the plan's own repository, where the code is not: a plan approved
  on code that changed since runs as if fresh. This is the loss that matters, and the reason for this spec.
- **The completion at a run's end.** A loose plan is not a lifecycle artifact (`completeRunArtifacts.ts`), so the plan,
  and a last plan's spec, are completed by hand in the process repository after the merge.
- **What the pull request shows.** Its body names the plan by its path, `../docs/plans/<plan>.md`, in a code span. When
  the code repository is public and the process private, the pull request should name nothing of the process
  repository: no path, no slug a reader cannot open.

## What the spec must cover

- **The link between the two repositories**, declared once: which side names the other (the process repository naming
  its code root, `code`, the code repository naming its process root, `..`, or both), in which config layer, and what
  phax refuses (a code root that is not a git repository, or not ignored by the process repository). Indicative:
  `"code": { "root": "code" }` in the process repository's `phax.json`.
- **The approval's baseline for the code.** `phax artifact approve` on a plan records, beside its baseline, the code
  repository's commit (`HEAD` of the code root), in the plan's approval record file and its frontmatter stamp; an
  approval without a code link records nothing new. The persisted formats change only by adding a field, at their
  current version.
- **Staleness against the code.** `ground-changed` diffs the plan's footprint in the code repository, from the
  recorded code commit, wherever staleness is computed: `phax run`'s and `phax resume`'s preflight, `phax plans status`,
  `phax artifact status`. A footprint path is relative to the code's root. A code commit that no longer exists (a
  rebased branch) is reported as such, as a missing baseline is today.
- **Running the plan from the code repository.** Whether a plan run from the code repository through the link is still
  a loose plan, or phax resolves it as the process repository's artifact (its lineage, its approval record, its
  completion at the run's end, committed in the process repository).
- **What the code repository's pull request and commits carry.** The plan's path and slug, the spec's, the phase
  trailers (`Worktree` and `Gate-Log` are local paths, with the user's name): which stay, which go when the process is
  linked, and whether that is a setting.
- **`phax plans lint`**: its `files` check walks the planned files against the working tree; under the link, against
  the code's.

## Constraints

- **Additive.** A project with no link sees no change in argv, environment, records or persisted formats.
- **phax knows no project.** The words are phax's: a process repository, a code repository, a code root.
- **§9 holds genuine choices only**, each with its options, what each abandons and a recommended default. At least:
  which side declares the link; whether a run through the link is a lifecycle run; what the code repository's pull
  request names.

## Out of scope

- Moving a project's files between the two repositories, and any tool that does it.
- A code repository outside the process repository's tree (a sibling checkout): the code root is inside it.
- Submodules and subtrees.
- Records: their destination to another repository exists already.
