# Artifact Transition Auto-Commit

Status: Archived

Source-Spec: docs/specs/25-artifact-transition-autocommit.md
Approved: 2026-08-11 @ 4ae687b

> Amendment 2026-08-12: the `--no-commit` opt-out described throughout this plan was
> removed in code review — transitions now always commit. This plan is preserved as the
> as-built implementation record; see the Amendment in spec 25 for the current behavior.

Implements spec 25: every `phax artifact` status transition (`approve`, `stale`,
`reopen`, `abandon`, `archive`) creates a single git commit containing exactly its
write-set — the artifact file, the approval record when touched, and the archive move
for terminal transitions — while leaving unrelated pending changes untouched. A dirty
write-set target refuses before any write (exit 12); `--no-commit` opts out; a no-op
transition creates no commit; a failed commit after successful writes reports loudly
(spec §5.1–§5.8).

The current `Git` port has no staging or path-scoped operation — `commit` hardcodes
`git add -A` — so the work proceeds inside-out: extend the port, wire the use case,
then expose the CLI surface.

## Technical arbitrations

- **Path scoping via `git add -A -- <paths>` + `git commit -m … -- <paths>`, not
  plumbing** — abandons index-level isolation from concurrent user staging on those
  paths; accepted because the clean-target precondition (§5.4) guarantees the paths
  carry no user state when the transition runs.
- **Commit hash read back via the existing `headCommit` port method after
  `commitPaths`** — abandons a single atomic commit-and-return-hash call; accepted for
  port minimalism and consistency with `commitPhase`, which also reads the hash after
  committing.
- **Archive move stays write+delete (no `git mv` port method)** — abandons an explicit
  rename record; accepted because staging both the removed source and added
  destination captures the move in one commit (§5.3) and git infers renames from
  content.
- **`TransitionArtifactOptions.commit` is a required boolean, not optional** — per
  repo doctrine (no permissive optionality); every caller states its intent.
- Spec §9 defaults adopted as recommended: refuse on dirty target, approval baseline
  is the pre-existing HEAD, leave-and-report on commit failure.

## Required commands

- (none)

## phase-01 — Path-scoped git status and commit {#phase-01-git-port-path-ops}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Extend the `Git` port with the two path-scoped operations the auto-commit needs:
per-path dirtiness (for the clean-target precondition) and a commit restricted to a
given path set. After this phase the port can express "commit exactly these paths,
nothing else", with real-git and fake coverage.

### Detailed instructions

- In `src/ports/git.ts`, add to `GitOps`:
  - `dirtyPaths(repo: string, paths: readonly string[]): Effect.Effect<readonly string[], GitError>`
    — returns the subset of `paths` that have uncommitted changes (staged, unstaged,
    or untracked). Empty input returns empty output without invoking git.
  - `commitPaths(repo: string, paths: readonly string[], subject: string, body: string): Effect.Effect<void, GitError>`
    — stages and commits only the given paths.
- In `src/infra/git.ts`, implement both on `NodeGitLayer` via the existing `gitRun`
  helper: `dirtyPaths` runs `git status --porcelain -- <paths>`; `commitPaths` runs
  `git add -A -- <paths>` then `git commit -m <subject> -m <body> -- <paths>` so
  other staged or dirty files never enter the commit.
- In `src/schemas/git.ts`, add a parser for porcelain status output → repo-relative
  dirty paths, next to the existing parsers (`isPortcelainClean`, …). Handle rename
  lines (`R  old -> new`: both sides are dirty) and untracked (`??`) entries.
- In `src/infra/fakes/git.ts`, extend `FakeGitImpl` and the `GitCall` union with both
  methods; add knobs (e.g. `setDirtyPaths(...)`) so app-layer tests can stage
  dirty-target scenarios; record calls with their exact `paths` argument so tests can
  assert scoping.
- TypeScript will flag every other `GitOps` implementer; update them all.

### Planned files to create

- tests/integration/gitCommitPaths.test.ts

### Planned files to edit

- src/ports/git.ts
- src/infra/git.ts
- src/infra/fakes/git.ts
- src/schemas/git.ts

### Optional files that may be edited

- tests/integration/gitDiffNameStatus.test.ts
- tests/unit/branded.test.ts

### Boundary contracts

Consumer: the artifact transition use case (phase-02) needs "which of these paths are
dirty" and "commit exactly these paths". Producer: the `Git` port. The stable shape is
paths in, paths (or void) out — repo-relative POSIX paths exactly as git prints them;
no artifact-domain vocabulary leaks into the port.

### Test strategy

- Real-git integration test (create `tests/integration/gitCommitPaths.test.ts`,
  modeled on `tests/integration/gitDiffNameStatus.test.ts`): in a temp repo, with an
  unrelated dirty file present — `commitPaths` commits only the given paths (assert
  via `git show --name-status`); a delete+create pair (archive-move shape) lands in
  one commit; an untracked file commits; `dirtyPaths` reports exactly the dirty subset
  for modified, staged, untracked, and clean paths. Write these before implementation.
- Unit tests for the porcelain parser alongside the existing schema parser tests.

### Implementation order

Parser in `src/schemas/git.ts` → port signatures → infra adapter → fake → tests green.

### Excluded scope

- Any change to `transitionArtifact` or the artifact domain (phase-02).
- Any CLI change (phase-03).
- Refactoring the existing `commit` method or `commitPhase`.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `GitOps` signatures added and the `GitCall` variants recorded by the fake.
- The fake's knob names for controlling `dirtyPaths` results.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(git): add path-scoped dirty-status and commit to the Git port

### Commit body

Add dirtyPaths and commitPaths to the Git port, implemented with porcelain
status parsing and pathspec-scoped add/commit so a caller can commit an exact
file set while unrelated changes stay untouched. Covered by a real-git
integration test and fake-port recording.

## phase-02 — Transition write-set and auto-commit in the use case {#phase-02-transition-autocommit}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Make `transitionArtifact` self-recording: compute the transition write-set, refuse on
a dirty target before any write, apply the transition, then commit exactly the
write-set — skipping the commit when nothing changed, and failing loudly (writes kept)
when the commit itself fails. Implements spec §5.1–§5.4, §5.6–§5.8.

### Detailed instructions

- Create `src/domain/artifact/writeSet.ts` (pure):
  - `transitionWriteSet(kind, repoRelPath, target): readonly string[]` — always the
    artifact path; plus `APPROVALS_FILE_PATH` when `kind === "plan"` and the target is
    `Approved` or terminal (approval record upsert/removal); plus
    `archivePathFor(repoRelPath)` when the target is terminal. Reuse
    `archivePathFor` and `APPROVALS_FILE_PATH`; no new path logic.
  - `transitionCommitMessage(kind, target, repoRelPath): { subject; body }` — subject
    `chore(plans|specs): <verb> <basename-without-extension>` where verb is the
    subcommand vocabulary (`Approved`→approve, `Stale`→stale, `Draft`→reopen,
    `Abandoned`→abandon, `Archived`→archive); body one sentence naming the transition
    and the repo-relative path. Shape is indicative per spec §6.
- In `src/domain/errors.ts`, add:
  - `ArtifactDirtyWriteSetError` (`paths: readonly string[]`, computed `message`
    naming the dirty paths and the remedy "commit or stash them first, or pass
    --no-commit", wording per spec §6).
  - `ArtifactCommitFailedError` (`paths: readonly string[]`, `cause: string`,
    computed `message` naming the written paths left uncommitted, per §5.8).
- In `src/app/artifactStatus.ts`:
  - `TransitionArtifactOptions` gains required `commit: boolean`.
  - When `commit` is true: before any filesystem write, compute the write-set and call
    `git.dirtyPaths(repoRoot, writeSet)`; any hit fails with
    `ArtifactDirtyWriteSetError` leaving the repository byte-identical (§5.4). After
    the existing writes complete, call `git.dirtyPaths` again on the write-set: empty
    → no commit (§5.6); otherwise `git.commitPaths(repoRoot, writeSet, subject, body)`
    (a `GitError` here maps to `ArtifactCommitFailedError` carrying the write-set),
    then `git.headCommit(repoRoot)` for the hash.
  - When `commit` is false: behavior is exactly today's — no precondition, no commit.
  - `ArtifactTransitionResult` gains
    `commit?: { readonly hash: string; readonly subject: string }`, present only when
    a commit was created.
  - The approval `baseline` keeps its current read (pre-existing HEAD, fetched before
    the transition commit exists) — do not reorder it after the commit.
- Widen the use case's error union with the two new errors; keep `FileSystem | Git`
  as the requirement set (`Git` is now used on every committing transition, not only
  plan approval).

### Planned files to create

- src/domain/artifact/writeSet.ts
- tests/unit/artifact/writeSet.test.ts

### Planned files to edit

- src/domain/errors.ts
- src/app/artifactStatus.ts
- tests/integration/artifactStatus.test.ts

### Optional files that may be edited

- src/app/approvalRecordStore.ts
- tests/unit/artifact/status.test.ts

### Boundary contracts

Consumer: `transitionArtifact` (app) needs the write-set and commit message for a
transition. Producer: `src/domain/artifact/writeSet.ts` (pure domain). The contract is
(kind, path, target) → paths/message with no I/O; the app layer alone talks to the
`Git` port using phase-01's operations.

### Test strategy

Write the domain unit tests and the first two integration cases before implementation.

- Unit (`tests/unit/artifact/writeSet.test.ts`): write-set for every kind × target
  combination (plan approve includes approvals.json; terminal includes the archive
  destination; spec stale/reopen do not exist — only legal transitions);
  commit-message verb mapping.
- Integration (`tests/integration/artifactStatus.test.ts`, fakes):
  - approve with an unrelated dirty file: `commitPaths` called with exactly the
    write-set; the unrelated path never appears in any git call (spec AC "Transition
    commits its write-set").
  - archive: one `commitPaths` call whose paths include source and destination (AC
    "Archive move is one commit").
  - dirty target: fails `ArtifactDirtyWriteSetError`, fake fs proves no write occurred
    (AC "Dirty target refuses before writing").
  - `commit: false`: no `dirtyPaths`/`commitPaths` calls, transition applies (AC
    "Opt-out skips the commit").
  - re-approve no-op: post-write `dirtyPaths` returns empty → no `commitPaths` (AC
    "No-op transition creates no commit").
  - `commitPaths` failing: `ArtifactCommitFailedError` names the write-set, files
    remain written (AC "Commit failure is loud").

### Implementation order

Domain write-set + message (tests first) → errors → app precondition → app commit path
→ integration tests green.

### Excluded scope

- CLI flag, output rendering, exit-code mapping (phase-03).
- Any change to the `phax run` phase-commit flow.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact exported names in `src/domain/artifact/writeSet.ts` and the two error
  class names, for phase-03's exit-code mapping and rendering.
- The final shape of `ArtifactTransitionResult.commit`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(artifact): auto-commit transition write-set with clean-target precondition

### Commit body

transitionArtifact now computes its write-set, refuses before writing when a
target path is dirty, and commits exactly the write-set after a successful
transition — skipping empty commits and surfacing commit failures with the
paths left uncommitted. Opt-out via the new required commit option.
Implements spec 25 §5.1–§5.4 and §5.6–§5.8.

## phase-03 — CLI flag, exit codes, and regenerated CLI docs {#phase-03-cli-surface}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Expose the behavior on the CLI: `--no-commit` on the five transition subcommands, a
commit line in the success output, exit code 12 for the dirty-target refusal, and the
regenerated usage spec / CLI reference. Implements spec §5.5 surface and §6.

### Detailed instructions

- In `src/cli/commands/artifact.ts`:
  - Add `.option("--no-commit", …)` to each transition subcommand registered from the
    `TRANSITIONS` loop (Commander's negated flag yields `options.commit === false`;
    default true). Thread it into `runArtifactTransition` and pass
    `commit: options.commit` in `TransitionArtifactOptions`.
  - On success, after the existing `Status:` / `Path:` / `Baseline:` lines, render
    `Commit:` with the short hash and subject when `result.commit` is present
    (aligned-label style of the existing output; hash presence is normative per spec
    §6).
  - Update the transition subcommands' long-help "Side effects:" text to name the
    transition commit and `--no-commit`.
- In `src/cli/commands/runLayers.ts`, extend `exitCodeForError`: add
  `ArtifactDirtyWriteSetError` to the exit-12 family (spec §6 normative);
  `ArtifactCommitFailedError` stays on the non-zero fallthrough.
- Regenerate the derived CLI artifacts with the existing scripts: `pnpm gen:usage-spec`
  (→ `phax.usage.kdl`) and `pnpm docs:cli` (→ `docs/cli/reference.md`). Do not edit
  either file by hand.

### Planned files to create

- (none)

### Planned files to edit

- src/cli/commands/artifact.ts
- src/cli/commands/runLayers.ts
- tests/unit/cli/artifact.test.ts
- phax.usage.kdl
- docs/cli/reference.md

### Optional files that may be edited

- tests/integration/cliErrors.test.ts
- tests/integration/usageSpecExamples.test.ts
- tests/integration/docsCliDrift.test.ts

### Boundary contracts

Consumer: the CLI command layer renders whatever `ArtifactTransitionResult` carries
and maps domain errors to exit codes; it contains no commit logic of its own.
Producer: phase-02's use case. The stable shape is the `commit?: { hash; subject }`
result field and the two error classes named in phase-02's handoff.

### Test strategy

- Unit (`tests/unit/cli/artifact.test.ts`, mocked use case): `--no-commit` reaches the
  use case as `commit: false` and the default as `commit: true`; the `Commit:` line
  renders hash + subject when present and is absent otherwise;
  `ArtifactDirtyWriteSetError` exits 12; `ArtifactCommitFailedError` exits non-zero.
  Write the flag-threading and exit-code cases before implementation.
- The drift suites (`usageSpecExamples`, `docsCliDrift`) verify the regenerated
  artifacts mechanically.

### Implementation order

Exit-code mapping → flag + threading → output rendering → long-help text →
regeneration → tests green.

### Excluded scope

- Any behavior change in the use case or the git port (phases 01–02).
- No `phax.json` configuration surface (spec §6: none exists).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final flag spelling and the rendered success/refusal output lines, quoted.
- Confirmation that `phax.usage.kdl` and `docs/cli/reference.md` were regenerated via
  the package scripts, not edited.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add --no-commit and commit reporting to artifact transitions

### Commit body

Artifact transition subcommands gain --no-commit, print the transition commit
hash and subject on success, and refuse dirty write-set targets with exit
code 12. Usage spec and CLI reference regenerated. Completes spec 25 (§5.5,
§6 surface).
