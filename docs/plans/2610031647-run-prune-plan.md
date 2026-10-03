---
status: Approved
source-spec: docs/specs/2610031513-run-prune.md
approved:
  date: 2026-10-03
  baseline: 8ba1ed7
---
# Prune archived runs

Add `phax prune`. It deletes archived runs of the current namespace for real: the archive folder, the worktree metadata in the current repository, the run's local branches (`<branch>` and `<branch>--phase-NN`) and, last, the registry entry. Pruning frees the run's name and its disk space. It never touches `phax/records/v1`, remote branches, remote-tracking refs or pull requests, and it never contacts a remote. The spec's §9 decisions are implemented as decided on 2026-10-03:

- Q1: a run whose local branches hold unpreserved commits is kept whole unless `--force` is given. A branch checked out in a worktree keeps the run even with `--force`.
- Q2: runs are selected by name or with `--all`.
- Q3: only the current namespace can be pruned.
- Q4: the command always previews first. It asks on a TTY, accepts `--yes`, refuses without a TTY and supports `--dry-run`.
- Q5, as amended: exit codes follow `exitCodeForError`. A kept run exits 3 (unsafe git state) and a lock conflict exits 7. The README exit-code table is rewritten from the code, and a test keeps the two in sync (§5.21).

The work has five phases, each green on its own:

1. Rewrite the stale README exit-code table from the code and add the sync test.
2. Add the read-only git and filesystem queries prune needs, behind the existing ports.
3. Add the pure prune domain and the `prune` use case.
4. Add the CLI command, the generated CLI surface and the end-to-end acceptance suite, which runs against a temporary repository and state root.
5. Update the README prose and the phax-cli skill's lifecycle.

Phase 5 edits `.claude/skills/phax-cli/SKILL.md`, so run this plan with `phax run --allow-skill-edits`.

No persisted format changes. The registry only loses the pruned entries, and it is written exactly as `upsertRun` writes it today. All fixtures are made up: nothing from ~/.phax or from another repository enters this repository. This plan lands after preflight-before-naming, which edits `src/app/worktree.ts`, `src/app/executePlan.ts` and `src/cli/commands/run.ts`. This plan writes none of those files.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`

`security.agentCommands` in phax.json already allows both commands, so phax.json needs no change. Phase 4 runs them to regenerate `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated CLI block. The existing `standard` gate profile verifies every phase.

## Technical arbitrations

- Exit codes follow spec §5.20 and the amended Q5: 0 when every selected run is pruned (or for a preview, or when there is nothing to prune), 1 when nothing was deleted because of a refusal or a missing or declined confirmation, 3 when at least one selected run was kept, and 7 on a lock conflict. Several §8 acceptance criteria, and §10's 'Exit codes are 0, 1, 3 and 4', still say 4. They predate the amendment, so the tests assert 3. Accepted loss: those criteria's literal exit codes.
- The code states its own exit-code meanings in one `EXIT_CODE_MEANINGS` const (codes 0 to 12) next to `exitCodeForError` in `src/cli/commands/runLayers.ts`. A unit test checks three things: the README table rows equal the const, one sample error per family maps through `exitCodeForError` to its code, and every numeric literal a command returns appears in the const. Accepted loss: the meanings are written by hand rather than derived from the error classes. A new error class mapped to an existing code with a different sense is caught only in review.
- Archive size is the apparent size: the sum of the lstat sizes of the regular files under the archive folder, with symlinks not followed, and 0 when the folder is absent. The preview, the confirmation question, the report and the JSON all use this one number. Accepted loss: it can differ from `du` (APFS clones, sparse files, block rounding), so the reported bytes freed may not match what the disk actually reclaims.
- The discard flag keeps the name `--force`, matching `phax archive --force` and the spec's usage.kdl sample. Accepted loss: it is less self-describing than `--discard-unpreserved`. Its help text says that it discards commits.
- Unpreserved commits are counted per branch with `git rev-list --count refs/heads/<b> --not --exclude=<each branch this command would delete> --branches --tags --remotes`. The excluded set is the union of all selected runs' present branches (spec §4). Accepted loss: some commits count as unpreserved even though something still references them. That covers commits reachable only from a detached HEAD, the stash, a reflog or a non-branch ref. It also covers a selected run that ends up kept: its branches still do not preserve another selected run's commits. Both cases keep more and never lose work.
- Deletion order per run: the archive folder, then the worktree metadata, then the local branches with `git branch -D`, then the registry entry last. `-D` is safe because reachability was already checked, and `-d` would refuse a branch preserved only by a remote-tracking ref or a tag. Accepted loss: if branch deletion fails, the folder is already gone. The run is then kept with reason `removal-failed`, and a re-run finishes it through the already-absent path (§5.18).
- Worktree metadata is cleared with a repository-wide `git worktree prune`, as archive already does. Any remaining entry owned by the run (a path under `<stateRoot>/worktrees/<ns>.<name>` or under the archive folder) is then removed with `git worktree remove --force`. Accepted loss: like archive, this also drops other runs' stale admin records.
- A run's expected branches are its entry's `branch`, `<branch>--phase-01..NN` up to the entry's `phasesCount`, and any other present `<branch>--phase-NN`. This lets prune report an absent branch by name as already absent. Accepted loss: an absent phase branch numbered beyond `phasesCount` is not reported. Present branches are always found by listing refs.
- Prune is one use case that takes a confirmation mode and an `onPreview` callback. The CLI derives the mode from the flags and the TTY through a pure domain helper, and does nothing but render. Accepted loss: the use case carries a rendering callback. In exchange, the CLI can print the preview before the question with a single use-case call.
- Without a TTY and without `--yes` or `--dry-run`, prune refuses with exit 1 and names `--yes` whenever the selection is non-empty, even when every run would be kept. §5.15 has no 'planned for pruning' condition. With a TTY or `--yes` and no run planned for pruning, prune asks nothing and reports the kept runs with exit 3. `--all` with nothing selected exits 0 before any confirmation. Accepted loss: without a TTY, a script learns that runs would be kept only through `--dry-run` or `--yes`.
- When no project config loads, prune exits 1 (§5.4), as archive and ls do, even though `exitCodeForError` maps ConfigValidationError to 2. Every other error goes through `exitCodeForError`. PruneRefusedError falls to its default 1, and LockConflictError maps to 7. Accepted loss: a malformed phax.json exits 1 under prune and 2 under run.
- Prune reads each selected run's lock status and refuses on an active lock (§5.6), but it takes no lock itself. It also does not go through `dispatch` or the RunState machine. The run is already in its last state (`archived`), and prune deletes it rather than transitioning it, re-checking `state: archived` from the registry. Accepted loss: no reducer guards the deletion, and a command started on the same run mid-prune is not excluded. No command other than prune acts on an archived run's parts.

---

## phase-01 — README exit-code table from the code {#phase-01-exit-code-table}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

The README's exit-code table lists every code that phax's commands return (0 to 12), with the meaning the code gives it. A test fails, naming the code, whenever the table and the code disagree. prune then has a truthful table to point at.

### Detailed instructions

- In `src/cli/commands/runLayers.ts`, next to `exitCodeForError`, export `EXIT_CODE_MEANINGS: ReadonlyArray<{ readonly code: number; readonly meaning: string }>` in ascending code order. Use exactly these meanings: 0 `Success`; 1 `Generic failure (refusal, bad arguments, no project config)`; 2 `Plan or config validation`; 3 `Unsafe git state`; 4 `Gate failure (after the fix loop is exhausted)`; 5 `Agent invocation error (Claude, Vibe, or Codex)`; 6 `Archive blocked by a dirty worktree`; 7 `Lock conflict`; 8 `Rate or usage limit hit (resumable)`; 9 `Phase produced no changes (resumable)`; 10 `Registry corruption`; 11 `Security or preflight refusal`; 12 `Artifact lifecycle refusal`. Give the const a doc comment saying that it is the code's statement of what each exit code means, that the README § Exit codes table must list exactly these rows, and that `tests/unit/readmeExitCodes.test.ts` enforces this. Do not change `exitCodeForError` or `exitCodeForAuthoringError`.
- Rewrite the table under `## Exit codes` in README.md with two columns, `Code` and `Meaning`, and one row per entry of EXIT_CODE_MEANINGS. Each meaning must be byte-identical to the const. Keep the section heading. Do not add prune rows: prune does not exist yet, and phase 5 documents its codes in prose.
- Create `tests/unit/readmeExitCodes.test.ts`, following the structure of `tests/unit/readmePersistedFormats.test.ts`. Read README.md and extract the `## Exit codes` table rows with the same tableRows approach. Define a local `compareExitCodeTables(readme, code): string[]` that returns one human message per disagreement, each naming the code: a code missing from the README, an extra README code, or a meaning mismatch (`exit code 7: README says '…', code says '…'`). Test that it returns [] for the README rows against EXIT_CODE_MEANINGS.
- In the same file, add a family test. Build `const FAMILY_SAMPLES` with one constructed error instance per code from 2 to 12, as handled by `exitCodeForError`: PlanValidationError (2), UnsafeGitStateError (3), GateFailedError (4), AgentInvocationError (5), ArchiveBlockedByDirtyWorktreeError (6), LockConflictError (7), RateLimitError (8), PhaseHadNoChangesError (9), RegistryCorruptionError (10), SecurityPreflightError (11) and InvalidArtifactTransitionError (12). Read each class's payload in `src/domain/errors.ts` to construct it. Assert that `exitCodeForError(sample) === code` for each, that `exitCodeForError(new Error('x')) === 1`, and that every code returned appears in EXIT_CODE_MEANINGS.
- Add a literal-returns test. Read every `src/cli/commands/*.ts` file and collect the numeric literals in `return <n>;` statements that sit in command entry points returning an exit code. Assert that each value is listed in EXIT_CODE_MEANINGS, and name the file and the value on failure. If a non-exit-code numeric return matches the scan (a count, an index), exclude it through a small named allowlist with a comment saying why, and report it in the handoff.
- Add a test-double check: copy EXIT_CODE_MEANINGS and change one entry's meaning (for example, code 7 to `Gate failure`). Assert that `compareExitCodeTables(readmeRows, mutated)` returns exactly one message, and that it contains `7`.

### Planned files to create

- `tests/unit/readmeExitCodes.test.ts`

### Planned files to edit

- `src/cli/commands/runLayers.ts`
- `README.md`

### Optional files that may be edited

- (none)

### Test strategy

Write `tests/unit/readmeExitCodes.test.ts` first. It fails against today's stale table, then passes once the const and the table are written. It is a unit test that reads README.md from disk, like the existing readmePersistedFormats test, and the standard gate runs it through `pnpm test`.

### Implementation order

1. Write tests/unit/readmeExitCodes.test.ts against the intended EXIT_CODE_MEANINGS.
2. Add EXIT_CODE_MEANINGS to src/cli/commands/runLayers.ts.
3. Rewrite the README § Exit codes table from it.
4. Run the standard gate.

### Excluded scope

- Any change to exitCodeForError, exitCodeForAuthoringError or any command's exit behaviour.
- Any prune code or prune documentation (phases 2 to 5).
- README prose outside the § Exit codes table.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Quote EXIT_CODE_MEANINGS as committed and the rewritten README table. Name the exported symbols the test imports and any allowlisted literal returns, with the reason for each. Confirm that exitCodeForError is unchanged. Explain any file-plan deviation phax flags.

### Commit subject

`docs(readme): rewrite the exit-code table from exitCodeForError`

### Commit body

The README's exit-code table was stale. It listed gate failure as 2, lock conflict as 3 and unsafe git state as 4, and it omitted 7, 10, 11 and 12. exitCodeForError and the commands say otherwise.

State the code's meanings once, in EXIT_CODE_MEANINGS next to exitCodeForError, and rewrite the table from it, listing codes 0 to 12. A new unit test fails, naming the code, when the README table and the const disagree, when a family's sample error maps to a different code, or when a command returns a numeric code the table does not list (spec run-prune §5.21).

---

## phase-02 — Git and filesystem queries for prune {#phase-02-prune-git-fs-queries}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Give the app layer the read-only facts prune decides on: which local branches and remote-tracking refs exist, how many commits a branch holds that nothing else keeps, which branch each worktree has checked out, and how big a folder is. Each fact comes through the existing Git and FileSystem ports, with node adapters, fakes, and parsers at the schema boundary. Nothing calls them yet.

### Detailed instructions

- In `src/ports/git.ts`, export `interface GitWorktreeEntry { readonly path: string; readonly branch: string | null; readonly prunable: boolean }`. `branch` is the short name without `refs/heads/`, or null for a detached or bare entry.
- Add three methods to `GitOps`, each with a short doc comment. (1) `listRefs(repo: string, prefix: string): Effect.Effect<readonly string[], GitError>` returns the full ref names under `prefix` (e.g. `refs/heads/`, `refs/remotes/`), sorted. (2) `countUnpreservedCommits(repo: string, branch: BranchName, deleting: readonly BranchName[]): Effect.Effect<number, GitError>` returns the number of commits reachable from `refs/heads/<branch>` that no local branch outside `deleting`, no tag and no remote-tracking ref reaches. (3) `listWorktrees(repo: string): Effect.Effect<readonly GitWorktreeEntry[], GitError>`.
- In `src/schemas/git.ts`, add three pure parsers next to the existing ones. `parseRefList(stdout)` returns one ref per non-empty line, trimmed. `parseRevListCount(stdout)` returns a non-negative integer, or null when the output is malformed. `parseWorktreeListPorcelain(stdout)` reads blank-line-separated blocks of `worktree <path>`, `HEAD <sha>`, one of `branch refs/heads/<name>` | `detached` | `bare`, then `locked [reason]` and `prunable [reason]`, and returns GitWorktreeEntry[] with the `refs/heads/` prefix stripped from the branch.
- In `src/infra/git.ts` (NodeGitLayer), implement the three methods with the existing `gitRun` helper. `listRefs` runs `git for-each-ref --format=%(refname) <prefix>` and sorts the result. `listWorktrees` parses `git worktree list --porcelain` with `parseWorktreeListPorcelain`. `countUnpreservedCommits` runs `git rev-list --count refs/heads/<branch> --not`, then one `--exclude=<b>` per entry of `deleting`, then `--branches --tags --remotes`. Pass short branch names to `--exclude`: for `--branches`, git matches exclude patterns without the `refs/heads/` prefix, and each exclude applies only to the next `--branches`. Fail with a GitError when the count does not parse. Branch names are BranchName-validated, so they carry no glob metacharacters.
- In `src/ports/fs.ts`, add `apparentSize(path: string): Effect.Effect<number, FsError>` to `FileSystemOps`. Its doc comment says it returns the sum of the lstat sizes of the regular files at or under `path`, with symlinks not followed, and 0 when `path` does not exist. In `src/infra/fs.ts`, implement it with lstat and a recursive readdir walk from node:fs/promises, resolving the path like the other ops, and forward it in `rootedAt`.
- In `src/infra/fakes/fs.ts`, make three changes. Implement `apparentSize` as the sum of the UTF-8 byte lengths of the files at or under the path (0 when there are none), and forward it in the rooted fake view. Make `remove` recursive, matching the real `rm -rf`: delete the key itself and every file and dir under `path + '/'`. Add `failRemove(path: string, message: string)`, which makes the next `remove` of exactly that path fail with an FsError carrying the message. If the recursive remove breaks an existing test, report it in the handoff and do not change that test's intent.
- In `src/infra/fakes/git.ts`, add GitCall variants for the three methods and these seeding helpers. `addRef(fullRef)`: `listRefs` then returns the sorted union of `refs/heads/<existingBranches>` and the added refs that start with the prefix. `setUnpreservedCount(branch, n)`: `countUnpreservedCommits` returns n, defaults to 0, and records `deleting` in the call. `addWorktreeEntry(entry: GitWorktreeEntry)`: `listWorktrees` returns the added entries. Make `pruneWorktrees` drop the entries marked prunable, and make `removeWorktree` drop the entry with that path. Add `failNextDeleteBranch(stderr)`, mirroring `failNextPushBranch`, and make `deleteBranch` remove the branch from `existingBranches`. Keep every existing behaviour unchanged.
- Write no app, domain or CLI code in this phase.

### Planned files to create

- `tests/integration/gitPruneQueries.test.ts`
- `tests/integration/fsApparentSize.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/ports/fs.ts`
- `src/schemas/git.ts`
- `src/infra/git.ts`
- `src/infra/fs.ts`
- `src/infra/fakes/git.ts`
- `src/infra/fakes/fs.ts`
- `tests/unit/schemas/git.test.ts`

### Optional files that may be edited

- `tests/unit/fakeRootedFileSystem.test.ts`

### Boundary contracts

ports → infra. The consumer is the app layer (phase 3), which needs three read-only git facts and one filesystem fact. The producers are the Git and FileSystem ports, which provide `listRefs`, `countUnpreservedCommits`, `listWorktrees` and `apparentSize`. These semantics are stable:

- `listRefs` returns full ref names.
- `countUnpreservedCommits` ignores exactly the `deleting` branches and treats every other local branch, tag and remote-tracking ref as preserving.
- `listWorktrees` returns entries with a short branch name (or null) and a prunable flag.
- `apparentSize` returns 0 for an absent path.

Git's raw output is decoded in src/schemas/git.ts before it leaves infra.

### Test strategy

Write the tests before the adapters.

`tests/unit/schemas/git.test.ts` covers the parsers:
- The porcelain parser on a main worktree, a linked worktree on a branch, a detached entry, a bare entry, and a prunable or locked entry.
- The rev-list count on a valid value, empty output and garbage.
- The ref list with blank lines.

`tests/integration/gitPruneQueries.test.ts` uses a real temporary git repository: a realpath'd mkdtemp, a local user.name and user.email, no remote and no network.
- `listRefs` returns heads, plus refs created with `git update-ref refs/remotes/origin/...`.
- `countUnpreservedCommits` counts 1 for a commit only on `phax/x--phase-02`. It still counts 1 when the sibling `phax/x--phase-01` also reaches the commit but is in `deleting`.
- It counts 0 when the commit is reached by a tag, by a remote-tracking ref (`update-ref refs/remotes/origin/phax/x--phase-02`), or by an unrelated branch, and 0 for a branch fully merged into main.
- `listWorktrees` reports a linked worktree's path and branch, and reports a worktree whose folder was moved away as prunable.

`tests/integration/fsApparentSize.test.ts` runs on a real temp dir: the sum over nested files, 0 for an absent path, and a symlink to a large file that is not followed.

### Implementation order

1. Write the parser tests, then add the parsers to src/schemas/git.ts.
2. Extend src/ports/git.ts and src/ports/fs.ts.
3. Implement the node adapters in src/infra/git.ts and src/infra/fs.ts, with their integration tests.
4. Extend the fakes: git seeding helpers, recursive remove, failRemove and apparentSize.
5. Run the standard gate.

### Excluded scope

- Any prune domain, use case or CLI code (phases 3 and 4).
- Deleting refs or worktrees beyond the existing deleteBranch, removeWorktree and pruneWorktrees methods.
- Any network access: no fetch, push or remote query.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exact signatures added to GitOps (`listRefs`, `countUnpreservedCommits`, `listWorktrees`), the GitWorktreeEntry interface and `FileSystemOps.apparentSize`, with the exact git command lines used. Name the new fake helpers (`addRef`, `setUnpreservedCount`, `addWorktreeEntry`, `failNextDeleteBranch`, `failRemove`) and the GitCall shapes. Confirm that the fake `remove` is now recursive, and say whether any existing test needed adjusting. Note how the git tests realpath their temp paths (macOS /var vs /private/var). Explain any file-plan deviation phax flags.

### Commit subject

`feat(git): add ref, reachability and worktree queries for prune`

### Commit body

Add the read-only queries phax prune needs, behind the existing ports.

The Git port gains three queries:
- listRefs: the full ref names under a prefix.
- countUnpreservedCommits: the commits a branch reaches that no other local branch, tag or remote-tracking ref keeps, ignoring a set of branches about to be deleted.
- listWorktrees: the parsed output of git worktree list --porcelain.

The FileSystem port gains apparentSize: the bytes of the regular files under a path, or 0 when it is absent.

Git output is decoded in src/schemas/git.ts. The fakes model the new queries, and the fake remove is now recursive like the real one. Integration tests against real git and a real filesystem pin the semantics. No command uses the queries yet.

---

## phase-03 — Prune domain and use case {#phase-03-prune-domain-and-use-case}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Provide the whole prune behaviour as an app use case over fake-testable ports. It covers selection and its refusals, the lock refusal, the per-run keep/prune decision, the confirmation modes, idempotent deletion with the registry entry last, per-run removal failures and the result-to-exit-code mapping. Phase 4 then only has to parse arguments and render.

### Detailed instructions

- In `src/domain/errors.ts`, add `PruneRefusedError` (a Data.TaggedError) with `message` and `refusals: ReadonlyArray<PruneRefusal>`. Its message lists every offending run with its reason, one per line. Do not add it to `exitCodeForError`: it falls to the default 1, which is the code §5.20 wants.
- Create `src/domain/prune.ts`: pure, no I/O, importing only domain modules, schema types and node:path for path arithmetic. It exports:

  1. `parsePruneSelection(names: readonly string[], all: boolean): Either<PruneSelection, string>`, where PruneSelection is `{ kind: 'names'; refs: readonly string[] } | { kind: 'all' }`. Neither form, or both, gives a Left whose message names both accepted forms (`phax prune <short-name>...` and `phax prune --all`). Deduplicate the names.
  2. `selectPruneRuns(entries, namespace, selection): Either<readonly RegistryEntry[], NonEmptyReadonlyArray<PruneRefusal>>`.
     - Parse each ref with `parseRunRef`. A parse error is refused as `{ kind: 'invalid', message }`.
     - A qualified ref whose namespace differs from the current one is refused as `{ kind: 'other-namespace', namespace }`.
     - An unqualified ref, or one qualified with the current namespace, is looked up in that namespace. Missing gives `{ kind: 'not-found' }`. Any state other than archived gives `{ kind: 'not-archived', state }`.
     - Collect every refusal: one refusal refuses the whole selection.
     - `all` selects every archived entry of the namespace, in registry order.
  3. `expectedRunBranches(entry, localBranches)`: entry.branch, then `<branch>--phase-01..NN` for NN up to entry.phasesCount, plus any present branch that is exactly `<branch>--phase-` followed by two digits. Deduplicate, and sort the phase branches after the run branch. `phax/x-2--phase-01` never matches `phax/x`, and `phax/records/v1` never matches.
  4. `remoteTrackingRefsFor(branches, remoteRefs)`: from full `refs/remotes/<remote>/<rest>` names, keep the short `<remote>/<rest>` form where `<rest>` is one of the branches, and skip `*/HEAD`.
  5. `runOwnedWorktreeRoots(stateRoot, namespace, shortName, archivePath)` and `isUnderRoot(path, root)`, a separator-aware prefix test.
  6. `decideRun(facts, force)`, which returns the planned run.
     - If a worktree that is neither prunable nor run-owned has one of the run's present branches checked out, the run is kept with reason `branch-checked-out` and `{ branch, worktreePath }[]`, even with force.
     - Otherwise, if any branch has unpreserved commits and force is off, the run is kept with reason `unpreserved-commits` and `{ branch, unpreservedCommits }[]`.
     - Otherwise the run is pruned. With force on, `branchesDiscarded` lists the unpreserved branches with their counts.
  7. `confirmationMode({ dryRun, yes, json, stdinIsTTY }): PruneConfirmation`, where PruneConfirmation is `'dry-run' | 'yes' | 'prompt' | 'missing'`. dry-run wins, then yes. json never prompts, so json without yes is missing. Otherwise a TTY gives prompt and no TTY gives missing.
  8. `formatBytes(n)`: one decimal with B, KB, MB, GB or TB in powers of 1024. The app and the CLI both use it.
  9. `pruneExitCode(result)`: nothing-to-prune 0, previewed 0, declined 1, confirmation-missing 1, and applied 3 when any run was kept, 0 otherwise.
- Domain result types. Outcomes are the enum `'pruned' | 'kept' | 'would-prune' | 'would-keep'`, and kept reasons are the enum `'unpreserved-commits' | 'branch-checked-out' | 'removal-failed'` (spec §6 intent).

  - A planned run carries qualifiedName, runId, archivePath, archiveBytes, its present branches, remoteBranchesKept, its planned outcome and its kept details.
  - A run report carries outcome, bytesFreed, branchesDeleted, branchesDiscarded, alreadyAbsent, remoteBranchesKept, and kept, which is `{ reason, branches?, worktrees?, part?, message? } | null`. alreadyAbsent holds part labels: `archive folder`, `worktree metadata`, and `branch <name>`.
  - Totals carry pruned, kept and bytesFreed.

  Export the types the CLI renders.
- In `src/app/registry.ts`, add `removeRun(stateRoot, namespace, shortName): Effect<void, FsError | RegistryCorruptionError, FileSystem>`. It reads the registry, filters out that one entry, and writes the result exactly as `upsertRun` does (same encodeRegistryFile, withSchemaUrl and 2-space JSON). It does not bump any other entry's updatedAt, and it does nothing when the entry is absent.
- In `src/app/prune.ts`, export three things:
  - `PruneInput { namespace, stateRoot, repoRoot, selection: PruneSelection, force: boolean, confirmation: PruneConfirmation, onPreview: (plan: PrunePlan) => Effect.Effect<void> }`.
  - `PruneResult = { kind: 'nothing-to-prune' } | { kind: 'previewed'; plan } | { kind: 'declined'; plan } | { kind: 'confirmation-missing'; plan } | { kind: 'applied'; plan; report }`.
  - `prune(input): Effect<PruneResult, PruneRefusedError | LockConflictError | FsError | GitError | RegistryCorruptionError | PromptError, FileSystem | Git | Lock | Prompt>`.
- prune, step 1, before any deletion:
  - Read the registry and run selectPruneRuns. A Left fails with PruneRefusedError.
  - If the selection is empty, return nothing-to-prune.
  - Check `lock.status(runKey(ns, name))` for every selected run. Any `active` lock fails with a LockConflictError whose message names each locked run and `phax unlock <name>`. Fill the payload fields from the first locked run, as archive does.
- prune, step 2, gather the facts once:
  - Call `listRefs(repoRoot, 'refs/heads/')`, `listRefs(repoRoot, 'refs/remotes/')` and `listWorktrees(repoRoot)`.
  - For each run, take its archive folder (entry.archivePath, or else `<stateRoot>/archive/<ns>.<name>`) and measure it with `apparentSize`.
  - The `deleting` set is the union of the present branches of all selected runs. Call `countUnpreservedCommits` for each present branch, then build the plan with decideRun.
  - Call `onPreview(plan)`.
- prune, step 3, confirmation:
  - dry-run returns previewed.
  - missing returns confirmation-missing (spec §5.15), whatever the plan holds.
  - When no run is planned for pruning, go to apply without asking: apply only reports the kept runs.
  - prompt asks through `Prompt.confirm` with the message `Prune <n> run(s), freeing <formatBytes(total)>?` and initialValue false. A false answer or a PromptCancelled returns declined.
  - yes proceeds.
- prune, step 4, apply each run in plan order. A kept run gets a kept report and no deletion. A run planned for pruning goes through these steps:
  - (a) Archive folder: remove it if it exists, or else add `archive folder` to alreadyAbsent.
  - (b) Worktree metadata: if listWorktrees shows no entry under the run-owned roots, record `worktree metadata` as already absent. Otherwise run `pruneWorktrees(repoRoot)`, list the worktrees again, and call `removeWorktree(path, true)` on every run-owned entry still present.
  - (c) Branches: re-list `refs/heads/`. Call `deleteBranch(b, true)` for each expected branch that is present, and record each absent one as already absent.
  - (d) Call `removeRun`.

  Catch the first FsError or GitError in steps (a) to (d) and stop that run there. It becomes kept with reason `removal-failed`, the failing `part`, and a one-line `message` (the first line of the error message, no stack). Then continue with the next run. bytesFreed is the planned archiveBytes when step (a) removed the folder, and 0 otherwise.
- Never touch remote refs, tags, `phax/records/v1` or any branch outside the selected runs' expected branches. Never call fetch, push or the GitHub port.
- Do not route prune through dispatch or the RunState machine: it deletes an archived run and makes no state transition. Say so in the module doc comment of `src/app/prune.ts`, together with the deletion order and the rule that the registry entry goes last.

### Planned files to create

- `src/domain/prune.ts`
- `src/app/prune.ts`
- `tests/unit/prune.test.ts`
- `tests/integration/prune.test.ts`

### Planned files to edit

- `src/app/registry.ts`
- `src/domain/errors.ts`
- `tests/integration/registry.test.ts`

### Optional files that may be edited

- `src/infra/fakes/git.ts`
- `src/infra/fakes/fs.ts`

### Boundary contracts

app → ports: the consumer is `prune`, which uses Git (listRefs, countUnpreservedCommits, listWorktrees, pruneWorktrees, removeWorktree, deleteBranch), FileSystem (exists, apparentSize, remove, plus the registry read and write), Lock (status) and Prompt (confirm). It does no direct I/O.

cli → app: the consumer is the phase 4 CLI. It provides a PruneSelection, force, a confirmation mode from `confirmationMode`, and an onPreview renderer. It gets back one of two things:
- A whole-command error raised before anything is deleted. The CLI maps it through `exitCodeForError`: PruneRefusedError → 1 and LockConflictError → 7.
- A PruneResult, which `pruneExitCode` maps to 0, 1 or 3.

The plan and report shapes carry the outcome and kept-reason enums from spec §6. The CLI renders them as human lines or as the JSON document.

### Test strategy

Write the tests first.

`tests/unit/prune.test.ts` covers the domain:
- parsePruneSelection: none, both, names and all.
- selectPruneRuns: not-found, not-archived with its state, other-namespace for a qualified ref, a qualified current-namespace ref that resolves the same as the short form, all refusals collected together, and `all` filtering by namespace and state.
- expectedRunBranches: expansion up to phasesCount, with `phax/x-2--phase-01` and `phax/records/v1` excluded.
- remoteTrackingRefsFor: skips HEAD.
- decideRun: a checked-out branch beats force, a run-owned or prunable worktree does not block, unpreserved commits keep the run without force, and force discards them.
- confirmationMode: a table typed `satisfies Record<PruneConfirmation, …>`.
- pruneExitCode: every result kind, with applied-with-kept returning 3.
- formatBytes.

`tests/integration/prune.test.ts` runs the use case on makeFakeFileSystem, makeFakeGit, makeFakeLock and makeFakePrompt, and covers the spec ACs at use-case level:
- A full prune deletes the folder, the worktree metadata, every branch and the entry.
- An unknown, non-archived or other-namespace name refuses with nothing deleted.
- A locked run refuses with LockConflictError and nothing deleted.
- Unpreserved commits keep the run whole, and --force discards them.
- A checked-out branch keeps the run even under --force.
- dry-run previews with no deletion call.
- prompt: answers yes and no, with PromptCancelled treated as declined.
- missing never asks and returns confirmation-missing even when every run would be kept.
- An interrupted re-run (no folder, no branches) reports the parts as already absent and removes the entry.
- failRemove on one run's folder keeps its entry while the next run is pruned.
- nothing-to-prune.
- The records branch and remote refs are never passed to deleteBranch.
- onPreview is called before Prompt.confirm.

`tests/integration/registry.test.ts`: removeRun drops one entry, leaves the others deep-equal (updatedAt included) and keeps the $schema.

### Implementation order

1. Add PruneRefusedError to src/domain/errors.ts.
2. Write tests/unit/prune.test.ts, then implement src/domain/prune.ts.
3. Add removeRun to src/app/registry.ts, with its registry test.
4. Write tests/integration/prune.test.ts, then implement src/app/prune.ts.
5. Run the standard gate.

### Excluded scope

- The CLI command, the Commander registration, usage.kdl, the generated docs and the human and JSON rendering (phase 4).
- README prose and the phax-cli skill (phase 5).
- Any change to archive, run, ls, publish-pr, resolveRunRef, exitCodeForError or the registry schema.
- Pruning other namespaces, non-archived runs, or stray phax/* branches that have no registry entry.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exact exports of `src/domain/prune.ts`: parsePruneSelection, PruneSelection, selectPruneRuns, PruneRefusal, expectedRunBranches, remoteTrackingRefsFor, runOwnedWorktreeRoots, isUnderRoot, decideRun, confirmationMode, PruneConfirmation, formatBytes and pruneExitCode, plus the plan, report and outcome types with their field names. Give the exports of `src/app/prune.ts` (PruneInput, PruneResult, prune) and the signature of `removeRun`. State the deletion order as implemented, the exact alreadyAbsent part labels, the wording of the confirm question, and which fake helpers the tests rely on. Explain any file-plan deviation phax flags.

### Commit subject

`feat(prune): plan and apply the prune of archived runs`

### Commit body

Add the prune domain (src/domain/prune.ts) and the prune use case (src/app/prune.ts). The domain turns the selection, the registry and the git facts into a per-run plan: prune, or keep because of unpreserved commits or a checked-out branch. --force discards unpreserved commits but never overrides a checkout.

The use case refuses the whole command, before deleting anything, when a name is unknown, not archived or in another namespace, or when a selected run is locked. Otherwise it gathers the git facts once and hands the preview to the caller. Once confirmed, it deletes each planned run's archive folder, worktree metadata and local branches, and its registry entry last. An absent part counts as removed. A part that cannot be removed keeps that run's entry, and the use case moves on to the next run. A kept run exits 3, through pruneExitCode.

A new removeRun drops one registry entry and leaves every other entry field-for-field unchanged.

---

## phase-04 — phax prune command and acceptance suite {#phase-04-prune-cli}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

An operator can run `phax prune` from a phax project to preview and delete archived runs, with the CLI contract the spec pins: the command, the variadic positional, --all, --force, --dry-run, --yes/-y and --json, with exit codes 0, 1, 3 and 7. An end-to-end suite proves every acceptance criterion against throwaway roots.

### Detailed instructions

- In `src/cli/commands/prune.ts`, export `PruneCommandOptions { all?: boolean; force?: boolean; dryRun?: boolean; yes?: boolean; json?: boolean }` and `runPrune(names: string[], opts, out: OutputPort): Promise<number>`. Keep business logic out of this file. The flow:
  1. Call `loadConfig(process.cwd())`. On a Left, call `reportConfigError` and return 1 (§5.4).
  2. Call `parsePruneSelection`. On a Left, call `out.error('✗ prune refused: ' + message)` and return 1.
  3. Call `confirmationMode({ dryRun, yes, json, stdinIsTTY: Boolean(process.stdin.isTTY) })`.
  4. Build the layer from `makeRepoRootedFileSystemLayer(config)`, `makeNodeGitLayer()`, `makeNodeLockLayer(config.stateRoot)` and `makeClackPromptLayer()`.
  5. Call `prune({ namespace: config.namespace, stateRoot, repoRoot, selection, force, confirmation, onPreview })` exactly once.
- Error rendering. Print no stack trace, and return `exitCodeForError(err)` for every error. That gives 1 for PruneRefusedError and 7 for LockConflictError.
  - A PruneRefusedError prints `✗ prune refused:` and then one line per refusal. A not-archived line names the state and the remedy `archive it first: phax archive <name>`. An other-namespace line names the namespace and says to run phax prune from that repository. A not-found line says not found.
  - A LockConflictError prints its message, which names `phax unlock`.
  - Any other error prints `✗ prune failed: <first line of message>`.
- Human rendering; the wording is indicative per spec §6, and every size goes through `formatBytes` from src/domain/prune.ts.
  - The preview opens with `Prune from namespace "<ns>":`. Each run then gets one line: the qualified name, `prune` or `keep`, the size, and either `branches: <list> (<n>)` or the keep reason. A keep reason lists each unpreserved branch with its count and a `--force discards them` hint, or each checked-out branch with its worktree path.
  - `nothing-to-prune` prints that there is nothing to prune.
  - `confirmation-missing` prints `✗ prune refused: no TTY to confirm; pass --yes to proceed or --dry-run to preview only`. With --json, the line says instead that --json never prompts, and still names --yes.
  - `declined` prints that nothing was deleted.
  - `applied` prints one line per run. A pruned run gets `✓ <name> pruned — <size> freed, <n> local branches deleted`, plus any discarded branches with their counts and any already-absent parts. A kept run gets `○ <name> kept — <reason>`.
  - Each pruned run with remoteBranchesKept also gets `  ! remote branches kept: <list> — a future run named <short-name> will meet them at publish-pr`.
  - The output closes with `Pruned <p> of <n> runs, <size> freed.`
- JSON rendering (`--json`). onPreview is a no-op, and on success the command makes exactly one `out.log(JSON.stringify(doc, null, 2))` call.
  - The document is `{ namespace, dryRun, runs: [{ name, runId, outcome, archiveBytes, branchesDeleted, branchesDiscarded, alreadyAbsent, remoteBranchesKept, kept }], totals: { pruned, kept, bytesFreed } }`.
  - Outcomes are `would-prune` and `would-keep` for a preview, and `pruned` and `kept` after apply. `kept` is `{ reason, … } | null`.
  - For confirmation-missing or declined, emit the preview document (dryRun false, would-* outcomes) and return 1.
  - Refusals still go to stderr through out.error, and nothing is written to stdout.
  - Every exit code for a PruneResult comes from `pruneExitCode`.
- In `src/cli/commands/pruneRegister.ts`, add `registerPruneCommand(program, runPruneImpl, out)`, following resumeRegister.ts:
  - `.command('prune')` with `.description('Delete archived runs of the current namespace for real, freeing their names and disk space')`.
  - `.argument('[short-name...]', 'Archived run short name, e.g. old-idea')`.
  - The options `--all`, `--force` ('Also prune runs whose branches hold unpreserved commits (discards those commits)'), `--dry-run`, `-y, --yes` and `--json`.

  Wire it in `src/cli/program.ts` next to archive, and add `prune` to TOP_LEVEL_COMMANDS in tests/integration/cliProgram.test.ts.
- In `src/cli/cliDocs.ts`, add a `prune` entry. Base the long help on the spec §6 usage.kdl sample: what prune deletes, what it never touches, the unpreserved-commit rule and --force, the preview and confirmation, and a `Side effects:` paragraph. The examples are `phax prune old-idea`, `phax prune --all --dry-run` and `phax prune --all --yes`.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit the regenerated phax.usage.kdl, docs/cli/reference.md and README.md generated block. Do not hand-edit the generated content, and do not edit README prose outside the generated block in this phase. If docs/cli/inventory.md lists every command, add a prune row there.
- `tests/integration/helpers/pruneRepo.ts` provides these helpers:
  - A realpath'd temporary git repository (git init, a local identity, an initial commit on main) and a separate realpath'd temporary state root.
  - A fixture phax.json with `name`, `state.root` set to the temp state root, a one-step `true` standard gate profile, and publishing and records disabled.
  - `seedArchivedRun(...)`. It creates the branches `phax/<name>` and `phax/<name>--phase-NN`, optionally with commits that only they hold. It writes an archived registry entry (namespace, shortName, runId, branch, projectName, phasesCount, timestamps, archivePath) and an archive folder `<stateRoot>/archive/<ns>.<name>/{runs,worktrees}` of known byte size. Optionally it adds a real linked worktree under `<stateRoot>/worktrees/<ns>.<name>/phase-01` and then moves it into the archive folder, leaving stale git metadata as archive does.
  - Helpers to add a remote-tracking ref (`git update-ref refs/remotes/origin/...`), a records branch tip and a non-archived entry.

  All content is made up. Reuse a helper from preflight-before-naming's `tests/integration/helpers/preflightRepo.ts` only by importing it, without editing it.
- `tests/integration/pruneCommand.test.ts` drives `runPrune` with a recording OutputPort, chdir'd into the temp repo; afterwards it restores the cwd and removes both temp roots. `vi.mock` on src/infra/prompt.js replaces makeClackPromptLayer with a makeFakePrompt layer scripted per test. Each test sets `process.stdin.isTTY` through Object.defineProperty and restores it afterwards. Cover every spec §8 AC, with spec §5.20's exit codes (kept → 3, lock → 7):
  - Deleted for real: the folder, the entry and the 4 branches are gone, `git worktree list` no longer shows the run's worktrees, and the command exits 0.
  - A qualified name in the current namespace prunes the run.
  - --all prunes only the namespace's archived runs, and every other entry stays deep-equal.
  - --all with nothing to prune: no prompt, exit 0.
  - Neither selection form, or both: exit 1.
  - Outside a project (a cwd with no phax.json): exit 1, registry bytes unchanged.
  - A non-archived, unknown or other-namespace name: exit 1, nothing pruned.
  - A locked run (lock acquired through the real Lock layer): exit 7, naming phax unlock, and neither run is pruned.
  - Records, remotes and neighbours survive: the records tip is unchanged, `origin/phax/old-idea--phase-02` is kept, and both `phax/old-idea-2*` branches are kept.
  - Unpreserved commits keep the run whole: exit 3, with the branch named with a count of 2.
  - A remote-tracking ref preserves commits, and the run is pruned.
  - --force discards the unpreserved commits: exit 0.
  - A branch checked out in the main worktree keeps the run even under --force: exit 3, naming the worktree path.
  - --dry-run previews and deletes nothing.
  - A declined prompt deletes nothing (exit 1), and an accepted prompt prunes (exit 0); in both, the preview is printed before the question.
  - No TTY without --yes: exit 1, naming --yes.
  - The report's bytes equal the preview's bytes.
  - Surviving remote branches are flagged.
  - Re-running an interrupted prune reports the parts as already absent and exits 0.
  - A permission failure (chmod 0o555 on the archive folder, restored in afterEach, the test skipped when running as root): exit 3, a one-line reason, and the other run pruned.
  - --json with --dry-run parses as a single document with would-prune and would-keep (reason unpreserved-commits) and exits 0. --json on a TTY without --yes asks nothing, deletes nothing and exits 1.
  - The registry keeps its format: `parseRegistry` from @lbdremy/phax-schemas decodes it, $schema is kept, and the other entries are deep-equal.
- AC 'The next run gets the bare name'. After pruning `run-prune`, assert that the registry holds no entry for `run-prune` in the namespace and that no run folder of that name exists under `<stateRoot>/runs`. Then assert that `nextAvailableShortName` (src/domain/runRef.ts), with the registry-plus-runs-folder predicate `phax run` uses, returns `run-prune`. Last, run `prepareRunBranch` from src/app/worktree.ts with the real Git layer, and assert that `phax/run-prune` is created fresh at the current main HEAD rather than reusing the old tip.
- Edit src/domain/prune.ts or src/app/prune.ts only to fix a defect this suite exposes, and record each fix in the handoff.

### Planned files to create

- `src/cli/commands/prune.ts`
- `src/cli/commands/pruneRegister.ts`
- `tests/integration/helpers/pruneRepo.ts`
- `tests/integration/pruneCommand.test.ts`

### Planned files to edit

- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/integration/cliProgram.test.ts`

### Optional files that may be edited

- `src/domain/prune.ts`
- `src/app/prune.ts`
- `docs/cli/inventory.md`
- `tests/integration/usageOutput.test.ts`

### Boundary contracts

cli → app: the consumer, `runPrune`, needs one call that either refuses as a whole or returns a PruneResult. The producer is `prune` from src/app/prune.ts (phase 3), which provides that call. The CLI makes only two decisions, the selection parse and the confirmation mode, both through pure domain helpers. Every error's exit code comes from `exitCodeForError`, every result's from `pruneExitCode`, and a failed config load gives 1. The CLI surface itself (command, positional, flags) is spec §6's normative contract, published through phax.usage.kdl, which is generated from Commander.

### Test strategy

Write tests/integration/pruneCommand.test.ts against the intended command before wiring the renderer. Most ACs fail until runPrune exists. This suite is the end-to-end layer: real config loading, git, filesystem, lock and registry against throwaway roots, with only the prompt layer and the TTY flag replaced. tests/integration/cliProgram.test.ts gains `prune`. The existing usage-spec drift, parity and lint tests (tests/integration/usageSpecDrift.test.ts, usageParity.test.ts, usageSpecLint.test.ts) and the docs:cli drift test (tests/integration/docsCliDrift.test.ts) guard the generated files.

### Implementation order

1. Write tests/integration/helpers/pruneRepo.ts and the acceptance tests in tests/integration/pruneCommand.test.ts.
2. Implement src/cli/commands/prune.ts: the flow, the error rendering, and the human and JSON rendering.
3. Add pruneRegister.ts, wire it in program.ts, and update cliProgram.test.ts.
4. Add the cliDocs entry, then run pnpm gen:usage-spec and pnpm docs:cli.
5. Run the standard gate.

### Excluded scope

- README prose outside the generated CLI block, and the phax-cli skill (phase 5).
- Any change to archive, run, ls or publish-pr behaviour, to exitCodeForError, or to persisted formats.
- Age or pattern filters, pruning other namespaces, deleting remote branches or pull requests, and any network access.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exact signatures of `runPrune` and `registerPruneCommand`, and the rendered wording of the preview, outcome, remote-warning, total and refusal lines. Give the final field names of the JSON document. List the ACs covered in pruneCommand.test.ts, the exit code each asserts, and any that are skipped conditionally (such as the permission test under root). Name the vi.mock seam for the prompt layer and say how isTTY is set. Confirm that the generated files came only from pnpm gen:usage-spec and pnpm docs:cli. Report any fix made to src/domain/prune.ts or src/app/prune.ts. Explain any file-plan deviation phax flags.

### Commit subject

`feat(cli): add phax prune`

### Commit body

Add phax prune <short-name>... | --all, with --force, --dry-run, --yes/-y and --json. The command parses its arguments, derives the confirmation mode from the flags and the TTY, and calls the prune use case once. It renders a preview line per run, then one outcome line per run with any surviving remote branches, then a total. With --json it renders a single JSON document instead. It exits 0, 1, 3 or 7, as exitCodeForError gives those families everywhere else.

Regenerate phax.usage.kdl, docs/cli/reference.md and the README's generated CLI block, and add the cliDocs entry.

An acceptance suite drives the real command against a temporary git repository and state root. It covers:
- what is deleted, and what survives (the records branch, remote-tracking refs, neighbouring runs' branches);
- every refusal;
- the preview, prompt and no-TTY paths;
- re-running an interrupted prune;
- a permission failure;
- the JSON document;
- the name being free afterwards.

---

## phase-05 — Document prune in the README and the phax-cli skill {#phase-05-prune-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

An operator whose ~/.phax/archive has grown, or whose new runs keep getting -2 names, finds in the README what prune deletes, what it keeps and how to run it safely. An agent driving phax learns from the phax-cli skill that an archived run can be pruned.

### Detailed instructions

- In README.md, rename `## Archive` to `## Archive and prune`. Keep the existing archive content, but replace the opening claim `Archive is the **only** operation that touches worktrees/` with wording that says archive moves and keeps, while prune deletes. Fix the archive paths shown to the current `~/.phax/runs/<namespace>.<short-name>` → `~/.phax/archive/<namespace>.<short-name>/runs/` layout, and do the same for worktrees.
- Add the prune subsection from spec §11:
  - One paragraph on what prune deletes, and on what it never touches: records on phax/records/v1, remote branches, remote-tracking refs and pull requests.
  - The three-line bash block: `phax prune --all --dry-run`, `phax prune old-idea` and `phax prune --all --yes`.
  - The rules. Unpreserved commits (commits no other branch, tag or remote-tracking ref keeps) keep a run whole, and --force discards them. A checked-out branch keeps the run even with --force. A preview always comes first, then a TTY confirmation or --yes; without a TTY the command refuses. Only the current namespace's archived runs can be pruned, so run prune from the repository that owns them. Surviving remote branches are listed as a warning, because a future run with the same name will meet them at publish-pr.
- Under `## Exit codes`, after the table (which phase 1 rewrote from the code), add a short paragraph on prune's codes: 0 when every selected run was pruned, for a --dry-run preview, or when there is nothing to prune; 1 when nothing was deleted (bad selection, outside a project, confirmation declined or missing); 3 when at least one selected run was kept; 7 when a selected run is locked. Do not change the table: tests/unit/readmeExitCodes.test.ts pins it.
- Do not touch the generated CLI reference block between the BEGIN and END GENERATED CLI REFERENCE markers.
- In `.claude/skills/phax-cli/SKILL.md`, update the lifecycle line `created → running → review_open → archived` so that archived leads on to gone through prune, e.g. `created → running → review_open → archived → (prune) gone`. Rewrite the `**archived**` bullet: the run folder and worktrees are moved under ~/.phax/archive and the name stays held; `phax prune` deletes the run for real and frees its name and disk space; archived is no longer terminal. In the canonical flow, after `phax archive my-feature`, add an optional `phax prune my-feature` line with a short comment. Keep the rest of the skill unchanged.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `.claude/skills/phax-cli/SKILL.md`

### Optional files that may be edited

- (none)

### Test strategy

Documentation only. The standard gate covers the Markdown through its format check, and tests/unit/readmeExitCodes.test.ts checks that the exit-code table is untouched. Check by hand that every command and flag mentioned matches phax.usage.kdl as regenerated in phase 4, and that the README's generated block is unchanged.

### Implementation order

1. Edit README § Archive and prune.
2. Add the prune paragraph under README § Exit codes.
3. Edit the phax-cli skill's lifecycle and canonical flow.
4. Run the standard gate.

### Excluded scope

- Any source or test change.
- Regenerating or hand-editing the generated CLI docs (done in phase 4).
- Changing the README exit-code table (phase 1).

### Verification

The `standard` gate profile in phax.json. This phase writes a `.claude/skills/` file, so the run must be started with `phax run --allow-skill-edits`.

### Expected handoff content

Quote the new README headings, the prune exit-code paragraph, and the new lifecycle line and archived bullet from the skill. Confirm that neither the generated CLI block nor the exit-code table was touched. Explain any file-plan deviation phax flags.

### Commit subject

`docs: document phax prune and the archived-to-gone run lifecycle`

### Commit body

Rename README § Archive to § Archive and prune. Archive moves a finished run aside and keeps everything. Prune deletes archived runs for real (archive folder, worktree metadata, local branches, registry entry), so their names and disk space come back. Records, remote branches and pull requests are never touched.

Drop the claim that archive is the only operation that touches worktrees/, fix the archive paths to the <namespace>.<short-name> layout, and give prune's exit codes under § Exit codes.

The phax-cli skill's run lifecycle now ends archived → gone: archived is no longer terminal, and prune is the step that removes a run.
