---
status: Approved
source-spec: docs/specs/2611041509-finding-ids-and-fates.md
completes-spec: false
approved:
  date: 2026-11-18
  baseline: ab3c763
---
# Finding fates: fix, dismiss and defer

This is the second of the three plans of the spec finding-ids-and-fates (q-plans `three-plans`). It covers the fate side: §5.5 (the latest fate record decides) and §5.9 to §5.20. It adds the §6 surfaces `phax finding fix`, `phax finding dismiss` and `phax finding defer`, the fate record on `phax/records/v1`, the `Finding` trailer, and `phax finding list` showing fates and their details. A fate is written only by these commands, as one record per finding on the records branch. The latest record decides the fate, and `history` in the `finding-list` answer holds every record, oldest first.

In this plan the fate commands make no push and no GitHub call at all, whatever `publish.auto` or `records.autoPush` says. They push neither the run branch nor the records branch, post nothing, and build no GitHub layer. Their records reach the remote with the run's publish, as a run-end review entry does. Everything about the pull request is left to plan 3: §5.21 to §5.25, the push before a comment, the fate comments, and what a fate command does when a push or a comment fails.

Criteria this plan proves:
- AC-path-classes, in-phase in phase-01.
- AC-latest-wins, AC-list-json, AC-list-text and AC-lift-settable, in-phase in phase-03, with fate records written directly.
- Through the first acceptance pair (phase-04, passed by phase-05): AC-fix-commits-named-paths, AC-fix-records, AC-path-classes, AC-fix-refusals, AC-fix-state, AC-machine-fix, AC-records-off (fix), AC-record-failure, AC-list-json's non-empty `history`, and AC-rereview-continues's F2 `fixed`.
- Through the second pair (phase-06, passed by phase-07): AC-dismiss, AC-defer, AC-settle-refusals, AC-machine-never-settles, AC-records-off (dismiss and defer), AC-lift-settable, AC-latest-wins and AC-list-text.

Left to plan 3: AC-pr-section, AC-pr-description-not-rewritten, AC-pr-fix-pushes-and-comments, AC-pr-dismiss-defer-comment, AC-pr-no-pr, AC-publish-auto-off, AC-list-local and AC-never-blocks.

Release context: 0.39.0 is released and 0.40.0 is the opened version. No release has been cut since plan 1, so plan 1's `finding-list` `next` snapshot still exists and is edited in place. Every new shape is born at the opened version through a `next` snapshot. No test names the opened version or a `next` shape literally: stamps come from `CURRENT_STAMPS`, `currentSchemaUrl` and `schemaUrl`.

Tests build their repositories, run worktrees and records branches as temporary git repositories, isolated with `isolateGit` and `isolatePhaxHome`. None reads a real `~/.phax`, a credential store or the global git config. Phase-05 sets a pattern (run resolution, the records check, the arbiter, the answer and refusals of a fate command) that phase-07 repeats. An operator who wants to review it before phase-07 can hold phase-05 with `phax run --hold`.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm test:unit`
- `pnpm test:property:deep`

Every command above already equals an entry of `security.agentCommands` in phax.json, so no security configuration change is needed. `pnpm exec tsx` runs `scripts/schemas-check.ts`: once with `--write`, to generate the `next` snapshots and the generated stamp files, then once without it, to check them. `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate the usage spec and the CLI reference in each phase that adds or changes a command. `pnpm test:property:deep <file>` runs a property file once at depth before a new or changed format is handed off. `pnpm test:unit` runs the unit tier alone while iterating.

## Technical arbitrations

- Release context. Plan 1's `finding-list` `next` snapshot still exists, so phase-02 widens `history` in place and the stamp stays the opened version. If a release is cut before this plan runs, follow plan 1's procedure:
  - open a new `next` snapshot;
  - freeze the cut shape as `src/schemas/history/finding-list/<cut>.ts`;
  - register it as a release of `findingListFormat`;
  - register it as a frozen shape in `tests/helpers/property/formatRegistry.ts`.
  The new `finding-fate-record-manifest` format is born at the opened version either way. Loss accepted: a reader of 0.40.0's `finding-list` sees the item shape of `history` change within the same unreleased version, which no released reader has seen.
- The path-class rule (§5.13) lives in one place, `src/domain/findings/pathClass.ts`, over the set `PATH_CLASSES = [code, docs, gate-config, tests]` from `src/schemas/pathClass.ts`. It reads the repository-relative path alone, and the first rule that matches wins:
  1. `gate-config`: a path under `.github/workflows/`, or a basename that names a gate tool's config. The list is `phax.json`, `phax.local.json`, `knip.json`, `knip.jsonc`, `knip.config.*`, `tsconfig.json`, `tsconfig.*.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `vitest.config.*`, `vitest.*.config.*`, `vitest.workspace.*`, `jest.config.*`, `playwright.config.*`, `eslint.config.*`, `.eslintrc`, `.eslintrc.*`, `prettier.config.*`, `.prettierrc`, `.prettierrc.*`, `biome.json`, `biome.jsonc`, `deno.json`, `deno.jsonc`, `.markdownlint.json`, `.markdownlint.jsonc` and `.markdownlint.yaml`.
  2. `tests`: a directory segment `test`, `tests`, `__tests__`, `__snapshots__` or `e2e`, or a basename matching `*.test.*`, `*.spec.*`, `*_test.*` or `test_*.py`.
  3. `docs`: a first segment `docs`, or an extension `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc` or `.txt` (case-insensitive).
  4. `code`: everything else, `package.json` and lockfiles included.
  A fix records the set of its commit's classes in `PATH_CLASSES` order, without duplicates: the paths `git` reports the commit changed against its first parent, a rename counting as both its paths. Loss accepted: the rule is a fixed list, not the project's configured gate tools. A gate tool missing from it classes its config as `code`, and `package.json`, which holds the gate scripts beside the dependencies, is always `code`.
- The fate record (§5.10, §5.14, §5.15) is keyed `<runId>/finding/<id>/<NN>/record.json` on `phax/records/v1`. The manifest format is `finding-fate-record-manifest`, born with `$schema`, kind `finding-fate`. It is an explicit union of three variants, each `{ $schema, kind, runId, finding, ...entry }`:
  - a fix: `{ fate: fixed, commit, pathClasses, by, at }`, where `by` is an operator `{ kind, name }` or a machine `{ kind, grant }`;
  - a dismissal: `{ fate: dismissed, verdict }`, where `verdict` is a decided verdict and its `by` is an operator only;
  - a deferral: `{ fate: deferred, to, why, by, at }`, where `by` is an operator only.
  The entry is also the item shape of `history` in `finding-list`.
  One record is one commit on the records branch. Records are not cumulative: `phax records list` reads one `record.json` per commit. So a call naming several ids writes one records commit per id, in the order named. `NN` is one more than the highest `NN` the branch history holds for that finding, two digits zero-padded. The latest record is the last in branch order. A duplicate `NN`, left by a concurrent writer, is read as two records. Loss accepted: a call's records are not atomic. A failure part-way leaves some ids recorded and names the rest (§5.20).
  The fate record stays outside phax's record-manifest union and the package's `parseRecordManifest`. `phax records list` and `phax records explain` skip it, and `phax finding list` is its reader. The package publishes `parseFindingFateRecordManifest` on its own. Loss accepted: a reader of every `record.json` must call that parser for a fate record.
  A fate record carries no transcript, so its destination is decided without the repository's visibility, and no GitHub call is made.
- The dismissal's decided verdict (§5.14) is written with fixed values:
  - `kind: decided`;
  - `chosen: dismiss` and `abandoned: [fix, defer]`;
  - `why`: the `--why` reason;
  - `advocate`: the finding's `suggestion` for a code-review finding, or its `message` for a compliance finding (`fix <id>` when that message is blank), as the strongest case for `fix`;
  - `principles: []` and `revised: []`;
  - `reversibility: cheap`, since a later fate record supersedes it;
  - `by`: the operator, and `at`: the time.
  The schema pins each of these as a literal or an empty tuple. Loss accepted: recording principles for a dismissal later needs a new shape.
- `phax finding fix <run> <id>… --commit <sha>` (q-backfill) records an existing commit and makes none. It refuses paths, `-m` and `--body`. The sha must resolve in the run's repository and be an ancestor of, or equal to, one of two tips:
  - the run's final-phase branch, when the run is live and the branch resolves;
  - the base branch, `publish.baseBranch` when configured, else `main`, local or `refs/remotes/<publish.remote>/<base>`.
  The path classes are read from that commit's changed paths against its first parent. A commit that changes no path is refused. Because it writes only a record, `--commit` runs on any run whose records exist, archived and merged runs and `unrecorded` findings included, as dismiss and defer do. §5.12's `review_open` refusal applies to the form that makes a commit. `--commit` is also the retry of §5.20: a fix whose record failed names `phax finding fix <run> <ids> --commit <sha>`. Loss accepted: a backfilled commit has no `Finding:` trailer and may hold several fixes, so its classes are coarser. A repository whose default branch is not `main` must set `publish.baseBranch`, because phax asks GitHub nothing.
- How `phax finding fix` reads its call. The command library hands the command its operands without the place of `--`. So after the run reference, the leading operands of the finding-id form (`^[FC][1-9][0-9]*$`) are the ids, deduplicated in the order given, and every operand from the first one not of that form is a path. `--` stays the documented spelling, and flags go before it. Paths resolve as git does: relative to the current directory when it is inside the run's final worktree, else relative to that worktree's root. A path that leaves the worktree is refused. A named directory commits every change under it. Loss accepted: a path spelled like a finding id must follow another path or be written `./F2`, and the call without `--` is also accepted. The alternative is a command-library gain that exposes operands after `--`, with its conformance cases, for one command.
- The fix commit (q-subject). The default subject is `fix(review): F2, F5 of <short-name>`. `-m, --message <subject>` overrides it, declared as `prune` declares `-y`, and `--body <text>` adds an optional body paragraph. The trailers are always phax's, in the last paragraph: `Short-Name: <short-name>`, then one `Finding: <id>` per id in the order named. There is no `Run-Id`, so release notes fold the commit into its run by `Short-Name`. The commit goes through `git.commitPaths` in the run's final worktree. That port stages and commits with the paths as the pathspec, so other staged or unstaged changes stay where they are.
- Exit codes, within the existing families:
  - 64: the runner refuses the call before anything runs. That covers a missing `--why` or `--to`, an empty value, an undeclared option, and a call without `--by` and without a terminal.
  - 1: every refusal the use case makes, a git or file failure, and a fate that could not be recorded. The use case refuses an unknown run, no id, no path, an unchanged path, a path outside the worktree, a run that is not `review_open` for the commit-making fix, records off or unreachable, a machine that dismisses or defers, an untracked pointer, and an unknown, unreachable or empty `--commit`.
  - 2: a configuration that does not decode.
  The error tags are declared per command, with `MessageFields`, as `finding list` declares its own. The text of a refusal reads `✗ <verb> refused: <reason>`. Loss accepted: a refusal and a failed record share exit 1, and only the tag tells them apart under `--json`.
- Where the fate commands run (q-where). The commit-making `fix` needs a live run in `review_open` with its final worktree. `fix --commit`, `dismiss` and `defer` run on any run whose records exist. The run is resolved as `phax finding list` resolves one: `resolveRunRef`, then an archived registry entry of the current namespace. Its records target is that of a by-hand review (`reviewRecordTargetFor`), or the project's own records for an archived run. A cross-project archived run, or a project that cannot be read, is refused naming why. Phase-05 exports this resolution from `src/app/findingList.ts` as `resolveFindingRun`, so the four commands share it. Loss accepted: a run the registry no longer knows cannot be settled, as it cannot be listed.
- Records are required and checked before any write (§5.19). Before any commit or record, a fate command refuses in three cases:
  - records are off (no `records` key in phax.json), naming that key;
  - the run's project cannot be read;
  - a dedicated records clone is missing, naming `phax records sync`.
  The check and the writer need only FileSystem and Git. A records commit that fails after the fix commit landed keeps the fix commit. The command exits 1, saying which ids are not recorded and naming the `--commit` retry. A failed dismissal or deferral says that running the same command again records it.
- The answers. `phax finding fix`, `dismiss` and `defer` answer a contract object, with no `$schema`, as `phax artifact approve` does: `{ run: { namespace, shortName, runId, state }, commit, recorded, findings }`.
  - `commit` is `{ sha, made, subject, paths: [{ path, pathClass }] }` for a fix, or null. `subject` is null when `--commit` named an existing commit.
  - `recorded` lists `{ finding, key, recordCommit }`.
  - `findings` holds the named findings' `finding-list` entries, re-read after the write: their fields, fate and full history.
  Without `--json` the text is the §6 lines, rendered from that answer. §5.8, titled 'The list is a versioned answer' and proved by AC-list-json, is read as the list's contract. Loss accepted: a fate command's answer is not a published format. A script that wants the published shape runs `phax finding list --json` after it.
- Who sets a fate (§5.17, §5.18). `--by operator`, or no `--by` from a terminal, names the operator as git commits, through `src/app/resolveArbiter.ts`. `--by machine:<grant>` is accepted by `fix` only. `dismiss` and `defer` refuse it first, before any read, saying that only an operator dismisses or defers a finding. Each command declares `prompts` when `--by` is absent, as `artifact approve` does, so a call without a terminal and without `--by` is refused by the runner.
- Two acceptance pairs: phase-04 (fix), passed by phase-05, then phase-06 (dismiss and defer), passed by phase-07. An acceptance phase writes no stub. `findingGroup` holds only `list` until its passing phase, so every call of a command not yet written is refused as unknown with exit 64. Every acceptance test asserts an exit code of 0 or 1, so it fails on its own assertion. Phase-06's tests use phase-04's fixture without editing it, and phase-07 never edits it. Loss accepted: the fixture phase-06 judges with is frozen by the first pair, not listed among the second pair's acceptance files.

---

## phase-01 — Path classes of a commit {#phase-01-path-classes}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax can say how a commit fixed something, from its paths alone and deterministically. Each path gets exactly one class, `tests`, `gate-config`, `docs` or `code`, and the Git port reads the paths a commit changes against its first parent.

### Detailed instructions

- Read the Technical arbitrations first (the path-class rule). Read `src/ports/git.ts`, the real adapter `src/infra/git.ts` (how `diffNameStatus` and `changedPathsBetween` parse `-z` output with `core.quotePath=false`), the fake `src/infra/fakes/git.ts`, `tests/integration/gitRecordsBranchContract.test.ts` (its `World` interface, which runs one suite against the real adapter and the fake), and `docs/property-tests.md` (fixed seeds, `pnpm test:property:deep`).
- Create `src/schemas/pathClass.ts`, importing only `effect`. Export `PATH_CLASSES = ["code", "docs", "gate-config", "tests"] as const` (alphabetical: the order a set of classes is written in). Export `PathClassSchema`, a literals schema whose description names each class and whose refusal override names the set. Export the `PathClass` type. A later phase's published format imports it, so it must stay free of domain imports.
- Create `src/domain/findings/pathClass.ts`, pure with no I/O. Its header comment states the rule as a table and says that this module is the one place it lives (spec finding-ids-and-fates §5.13). Export `classifyPath(path: string): PathClass` over a repository-relative path with `/` separators. The first rule that matches wins:
  1. `gate-config`: the path starts with `.github/workflows/`, or its basename is exactly one of `phax.json`, `phax.local.json`, `knip.json`, `knip.jsonc`, `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.oxfmtrc.jsonc`, `biome.json`, `biome.jsonc`, `deno.json`, `deno.jsonc`, `.markdownlint.json`, `.markdownlint.jsonc`, `.markdownlint.yaml`, `.eslintrc` or `.prettierrc`. It also matches a basename of the form `tsconfig.*.json`, `knip.config.*`, `vitest.config.*`, `vitest.*.config.*`, `vitest.workspace.*`, `jest.config.*`, `playwright.config.*`, `eslint.config.*`, `.eslintrc.*`, `prettier.config.*` or `.prettierrc.*`.
  2. `tests`: a directory segment (any segment but the last) is exactly `test`, `tests`, `__tests__`, `__snapshots__` or `e2e`, or the basename matches `*.test.*`, `*.spec.*`, `*_test.*` or `test_*.py`.
  3. `docs`: the first segment is `docs`, or the extension (case-insensitive) is `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc` or `.txt`.
  4. `code`: everything else.
- In the same module export `pathClassesOf(paths: readonly string[]): readonly PathClass[]`: the classes of the paths as a set, in `PATH_CLASSES` order, each at most once. It returns `[]` for no path.
- Add `commitChangedPaths(repo: string, commit: string): Effect.Effect<readonly string[], GitError>` to `GitOps` in `src/ports/git.ts`. Its doc comment says what it answers:
  - the repository-relative paths `commit` changes against its first parent;
  - every path of its tree for a root commit;
  - a merge commit diffed against its first parent only;
  - renames not detected, so a rename lists both its paths;
  - sorted and unique, never quoted;
  - a GitError for a commit that does not exist.
- Implement `commitChangedPaths` in the real adapter (`src/infra/git.ts`). For example, use `git diff-tree -r --no-commit-id --name-only --no-renames --root -z` against the commit's first parent, with `core.quotePath=false`, as the adapter's other path readers do.
- Implement it in the fake (`src/infra/fakes/git.ts`). It records the call and answers the paths set with a new `setCommitChangedPaths(commit, paths)`, sorted and unique. It fails with a GitError for a commit it was given no paths for.
- Create `tests/integration/gitCommitChangedPathsContract.test.ts`, one suite run against both backends in the `World` style of `gitRecordsBranchContract.test.ts`. The real world is a temporary repository under `isolateGit`. The fake world sets the expected paths for each commit its setup makes. The cases are:
  - a commit that modifies one file and adds another;
  - a deletion;
  - a rename (both paths);
  - a root commit;
  - a merge commit (first-parent paths only);
  - a path with a space and a non-ASCII character;
  - an unknown sha refused with a GitError.
- Create `tests/unit/findings/pathClass.test.ts`, a table of paths and their classes covering every rule and the boundaries between them:
  - `phax.json` and `sub/phax.json` are `gate-config`;
  - `tsconfig.test.json` is `gate-config` (gate-config is checked before tests);
  - `.github/workflows/ci.yml` is `gate-config`;
  - `tests/gate.test.ts`, `src/app/gate.spec.ts`, `tests/fixtures/notes.md` and `pkg/x_test.go` are `tests`;
  - `docs/gates.md`, `docs/specs/x.md`, `README.md` and `CHANGELOG.MD` are `docs`;
  - `src/app/gate.ts`, `src/latest.ts`, `src/test-utils.ts`, `package.json` and `pnpm-lock.yaml` are `code`.
  It also checks that `pathClassesOf(["tests/gate.test.ts", "src/app/gate.ts", "docs/gates.md"])` is `["code", "docs", "tests"]`, that `pathClassesOf([])` is `[]`, and that `PathClassSchema` decodes each class and refuses `test`, naming the set.
- Create `tests/unit/findings/pathClass.property.test.ts` with fast-check on the project's fixed seed. It checks three properties:
  - `pathClassesOf` gives the same answer for any permutation and any duplication of its paths;
  - its answer is always sorted in `PATH_CLASSES` order without duplicates;
  - `classifyPath` returns a member of `PATH_CLASSES` for any path string built from arbitrary segments, and never throws.
  Run `pnpm test:property:deep tests/unit/findings/pathClass.property.test.ts` once and record the seed and the result.

### Planned files to create

- `src/schemas/pathClass.ts`
- `src/domain/findings/pathClass.ts`
- `tests/unit/findings/pathClass.test.ts`
- `tests/unit/findings/pathClass.property.test.ts`
- `tests/integration/gitCommitChangedPathsContract.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`

### Optional files that may be edited

- `knip.json`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Port: `Git.commitChangedPaths` (`src/ports/git.ts`), produced by the real adapter and the fake. Its consumer is the fix use case in phase-05. Stable contract: the sorted, unique, repository-relative paths a commit changes against its first parent (every path for a root commit), renames as two paths, and a GitError for an unknown commit. Domain: `classifyPath` and `pathClassesOf` (`src/domain/findings/pathClass.ts`) over `PATH_CLASSES` (`src/schemas/pathClass.ts`). Their consumers are the fate record schema (phase-02) and the fix (phase-05). Stable contract: one class per path from the path alone, and a set written in `PATH_CLASSES` order.

### Test strategy

- every path gets exactly one class by the rule, gate-config before tests before docs before code — small · table · a hand-written table of paths and their expected classes · in-phase · AC-path-classes
- the classes of a test file, a source file and a Markdown file under docs/ are exactly code, docs, tests — small · example · the expected array [code, docs, tests] · in-phase · AC-path-classes
- the classes of a set of paths do not depend on their order or repetition, and are always sorted and unique — small · metamorphic · pathClassesOf of a shuffled, duplicated list equals pathClassesOf of the original, on the fixed seed · in-phase · AC-path-classes
- classifyPath is total: any path string gets a class, never an exception — small · property · membership in PATH_CLASSES on generated paths, on the fixed seed · in-phase
- the real git adapter and the fake agree on the paths a commit changes, renames, root and merge commits included — medium · contract · one shared suite run against both backends · in-phase

### Implementation order

1. src/schemas/pathClass.ts
2. classifyPath and pathClassesOf, with the table test
3. the property test, then its deep run
4. the Git port method, the real adapter and the fake
5. the contract suite

### Excluded scope

- Any fate record, command or format: phases 02 to 07.
- Classifying with a model, or reading the project's configured gate commands: the rule is the fixed list in the Technical arbitrations.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exports of `src/schemas/pathClass.ts` and `src/domain/findings/pathClass.ts` with their signatures, and the rule as implemented, if it differs in any detail from this phase's list. Give the signature and doc comment of `Git.commitChangedPaths`, the git command the real adapter runs, and the fake's setter. Give the seed and result of the `pnpm test:property:deep` run. Explain any deviation from the planned file lists.

### Commit subject

`feat(findings): classify a commit's paths as tests, gate-config, docs or code`

### Commit body

Add the path-class rule of spec finding-ids-and-fates §5.13 in one
place: each repository-relative path gets exactly one class, tests,
gate-config, docs or code, from the path alone, and a set of classes is
written in a fixed order. The Git port gains commitChangedPaths, the
paths a commit changes against its first parent, with the real adapter,
the fake and a contract suite both run, so a fix can record how it was
fixed.

---

## phase-02 — The finding-fate record format and fate history in finding-list {#phase-02-fate-record-format}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Register `finding-fate-record-manifest`, born with `$schema` at the opened version. It is the `record.json` of one fate record: a fix, a dismissal or a deferral of one finding, each an explicit variant. The `finding-list` answer's `history` widens from an empty tuple to these entries, oldest first. The schemas package publishes both.

### Detailed instructions

- Read the Technical arbitrations (release context, the fate record, the dismissal's decided verdict). Read these files:
  - `src/schemas/revisionRecord.ts` and `src/schemas/reviewRecord.ts`: manifest formats born with `$schema`;
  - `src/schemas/questions.ts`: the decided-verdict fields and the timestamp pattern;
  - `src/schemas/approvedBy.ts`: `GRANT_PATTERN`;
  - `src/schemas/findingList.ts` and `src/schemas/schemaUrl.ts`;
  - `src/schemas/persisted.ts`: `readRevisionRecordManifest` and `readRecordManifestFile`;
  - `packages/schemas/src/formats/recordManifests.ts` and `packages/schemas/src/formats/commandAnswers.ts`: `findingListFormat`;
  - `packages/schemas/build/jsonSchemas.ts`, `docs/property-tests.md` and `tests/helpers/property/formatRegistry.ts`.
  Grep the repository outside docs/ for `revision-record-manifest` to see every place a manifest format is registered.
- Create `src/schemas/findingFateRecord.ts`. It imports only `effect` and schema modules, because the package publishes it. Export these building blocks:
  - `FindingIdSchema`: a string matching `^[FC][1-9][0-9]*$`, whose refusal override names the form `F<n>` or `C<n>`.
  - `CommitShaSchema`: lowercase hex of 40 or 64 characters.
  - `FixedBySchema`: a union of `{ kind: "operator", name: NonEmptyString }` and `{ kind: "machine", grant }`, with `grant` checked by `GRANT_PATTERN`.
  - `OperatorBySchema`: the operator member alone.
  - A timestamp: reuse the ISO-8601 UTC pattern of `src/schemas/questions.ts` (export it from there if needed) and redefine nothing.
- In the same module, export the three entry variants, each strict about its keys:
  - `FixedFateEntrySchema`: `{ fate: "fixed", commit: CommitShaSchema, pathClasses, by: FixedBySchema, at }`. `pathClasses` is a non-empty array of `PathClassSchema` (from `src/schemas/pathClass.ts`), checked to be in `PATH_CLASSES` order without duplicates, with a refusal naming that order.
  - `DismissedFateEntrySchema`: `{ fate: "dismissed", verdict }`. `verdict` is `FindingDismissalVerdictSchema`: `{ kind: "decided", chosen: "dismiss", abandoned: ["fix", "defer"] as a two-literal tuple, why: NonEmptyString, advocate: NonEmptyString, principles: empty tuple, reversibility: "cheap", by: OperatorBySchema, at, revised: empty tuple }`, in that key order.
  - `DeferredFateEntrySchema`: `{ fate: "deferred", to: NonEmptyString, why: NonEmptyString, by: OperatorBySchema, at }`. Describe `to` as the repository-relative path of the brief, spec or NEXT_STEPS.md that takes the finding over, tracked when recorded.
- Also export:
  - `FindingFateEntrySchema`, the union of the three, and its type `FindingFateEntry`;
  - `FindingFateRecordManifestFileSchema`: a union of three structs, each `{ $schema: schemaUrlField("finding-fate-record-manifest"), kind: "finding-fate", runId: NonEmptyString, finding: FindingIdSchema, ...the variant's fields }`, unknown keys refused;
  - the in-memory type `FindingFateRecordManifest`, without `$schema`;
  - `decodeFindingFateRecordManifestFile` (`onExcessProperty: "error"`, `reportInput: true`) and `encodeFindingFateRecordManifest`.
  The header comment says that one record is one commit keyed `<runId>/finding/<id>/<NN>`, that the latest record in branch order decides the fate, and that the entry is also the item of `finding-list`'s `history`.
- Register the format. Append `finding-fate-record-manifest` at the end of `FORMAT_IDS` and of `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts`. Extend both doc comments: the `record.json` of a finding's fate record on phax/records/v1, of spec finding-ids-and-fates, born at this release.
- In `src/schemas/persisted.ts`, add `readFindingFateRecordManifestFile: Reader<FindingFateRecordManifest>`, modelled on `readRevisionRecordManifest`. It refuses a stamp newer than this phax by release, a missing `$schema`, and any other format. Do not add it to `MANIFEST_READERS` or to `readRecordManifestFile`: the arbitration keeps fate records outside the record-manifest union.
- Widen the history in `src/schemas/findingList.ts`. Replace the empty-tuple `historySchema` with `Schema.Array(FindingFateEntrySchema)`, described as `The finding's fate records, oldest first: each a fix, a dismissal or a deferral. The latest decides the fate.` Change no other field, and update the header comment. No cross-field check ties `fate` to the last entry: the producer guarantees it (phase-03).
- Schemas package:
  - In `packages/schemas/src/formats/recordManifests.ts`, add `findingFateRecordManifestFormat` (`preSchema: null`, `releases: []`, the current shape from `CURRENT_SHAPES`), with `parseFindingFateRecordManifest`, `toLatestFindingFateRecordManifest` (drops `$schema`), and the `LatestFindingFateRecordManifest`, `FindingFateRecordManifestShapes` and `FindingFateRecordManifestShape` types. Keep it out of `RecordManifestShapes` and `parseRecordManifest`.
  - Export them, `FindingFateRecordManifestFileSchema` and `FindingFateEntrySchema` from `packages/schemas/src/index.ts`, and add the format to its format map.
  - Add it to `packages/schemas/build/jsonSchemas.ts`: `FORMAT_DEFINITIONS`, the excess map with `error`, and any list there that names every manifest format.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It does four things:
  - creates `packages/schemas/snapshots/finding-fate-record-manifest/next.schema.json`;
  - rewrites `packages/schemas/snapshots/finding-list/next.schema.json` in place;
  - sets `CURRENT_STAMPS["finding-fate-record-manifest"]` in `src/schemas/release.ts` to the opened version;
  - updates `packages/schemas/src/generated/index.ts` and `packages/schemas/shipped-json.json`.
  Then run `pnpm exec tsx scripts/schemas-check.ts` without the flag and make it pass. Never edit generated files by hand. If the `finding-list` stamp in `src/schemas/release.ts` no longer comes from a `next` snapshot, a release was cut since plan 1. In that case follow the release-cut procedure of the Technical arbitrations, and say so in the handoff.
- Create `tests/behaviourCorpus/cases/formats/finding-fate-record-manifest.json`, modelled on `revision-record-manifest.json` of that folder. Its valid documents are a fix by an operator, a fix by a machine, a dismissal and a deferral. Its refusals:
  - an unknown key, and a missing `$schema`;
  - `fate: "open"`, and `kind` other than `finding-fate`;
  - a fix without `commit`;
  - a fix with an empty `pathClasses`, one with `["tests", "code"]` (out of order), and one with a duplicated class;
  - a dismissal whose `chosen` is `fix`, and one whose `revised` is not empty;
  - a dismissal by a machine, and a deferral by a machine;
  - `finding: "X1"`.
  Register the subject in `tests/behaviourCorpus/subjects.ts` and in the coverage list of `tests/unit/behaviourCorpus/coverage.test.ts`. Update `tests/behaviourCorpus/baseline/snapshot-digests.json` only if its check asks for it.
- Edit `tests/behaviourCorpus/cases/formats/finding-list.json`. The refusal of a non-empty `history` becomes a valid document whose finding carries a dismissal then a fix, with `fate: fixed`. Add refusals for a history entry with `fate: "open"` and an entry with an unknown key.
- In `tests/helpers/property/formatRegistry.ts`:
  - Register `finding-fate-record-manifest` with phax's reader `readFindingFateRecordManifestFile`, wrapped as the registry expects, `parse: fromPackage(parseFindingFateRecordManifest)`, and a `valid` generator derived from the file schema, `$schema` first.
  - If the derivation cannot satisfy the ordered, unique `pathClasses`, add a named repair (for example `path-classes-in-order`) that sorts and deduplicates. Never loosen the schema.
  - `finding-list`'s generator now derives non-empty histories. Repair it the same way if needed.
  Run `pnpm test:property:deep tests/unit/property/persistedFormats.property.test.ts` once and record the seed and the result.
- Create `tests/unit/schemas/findingFateRecord.test.ts`. Each variant decodes and round-trips through `encodeFindingFateRecordManifest`. The corpus refusals are refused with their paths. `readFindingFateRecordManifestFile` refuses a stamp newer than this phax by release.
- Edit `tests/unit/schemas/findingList.test.ts`: a document whose findings carry histories of each variant decodes and round-trips, and the two new refusals name their paths. Update the per-format tables the compiler or a test names: `tests/unit/schemaUrl.test.ts`, `tests/type/schemasPackage.ts` and `tests/unit/schemasPackage/documents.ts` (one valid fate record). Never name the opened version: take stamps from `CURRENT_STAMPS`.
- Add a row to README.md's `## Persisted formats` table, after the finding list row: `Finding fate record manifest` | `finding-fate-record-manifest` | the `record.json` of a finding's fate record on `phax/records/v1`, keyed `<runId>/finding/<id>/<NN>` | `parseFindingFateRecordManifest` | `json/finding-fate-record-manifest.schema.json`.

### Planned files to create

- `src/schemas/findingFateRecord.ts`
- `packages/schemas/snapshots/finding-fate-record-manifest/next.schema.json`
- `tests/behaviourCorpus/cases/formats/finding-fate-record-manifest.json`
- `tests/unit/schemas/findingFateRecord.test.ts`

### Planned files to edit

- `src/schemas/findingList.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/shipped-json.json`
- `packages/schemas/snapshots/finding-list/next.schema.json`
- `tests/behaviourCorpus/cases/formats/finding-list.json`
- `tests/behaviourCorpus/subjects.ts`
- `tests/unit/behaviourCorpus/coverage.test.ts`
- `tests/helpers/property/formatRegistry.ts`
- `tests/unit/schemas/findingList.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/documents.ts`
- `README.md`

### Optional files that may be edited

- `src/schemas/questions.ts`
- `src/schemas/approvedBy.ts`
- `src/app/findingList.ts`
- `tests/behaviourCorpus/baseline/snapshot-digests.json`
- `tests/behaviourCorpus/cases/encode/finding-list.json`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/shippedJson.test.ts`
- `tests/unit/schemasPackage/commandAnswersFormat.test.ts`

### Boundary contracts

Producer: `src/schemas/findingFateRecord.ts`, `readFindingFateRecordManifestFile` in `src/schemas/persisted.ts`, and the schemas package's `parseFindingFateRecordManifest`. Consumers: the fate record writer and reader (phase-03), the fate commands (phases 05 and 07), the `finding-list` answer, and external readers such as the knowledge index. Stable shape:
- a fate record is `$schema` first, then `kind: finding-fate`, `runId`, `finding` (`F<n>` or `C<n>`) and one of three fate variants, each with its own required keys;
- a dismissal carries a decided verdict with fixed `chosen`, `abandoned`, `principles`, `reversibility` and `revised`;
- `finding-list`'s `history` items are exactly these variants without the record's envelope.

### Test strategy

- each fate variant decodes and round-trips, and a wrong fate, a machine dismissal or deferral, unordered path classes and an unknown key are refused by path — small · example · decode of encode equals the input; the refusal's path and message · in-phase
- a finding-list document whose findings carry fate histories decodes, and a history entry with fate open or an unknown key is refused — small · example · decodeFindingListFile's verdict and refusal path · in-phase
- the published JSON Schemas of finding-fate-record-manifest and finding-list accept exactly the corpus documents their decoders accept — small · table · the behaviour corpus cases against the next snapshots and the schemas check · in-phase
- phax's readers and the schemas package's parsers reach the same verdict on generated fate records and finding lists and on arbitrary JSON — small · property · the persisted-formats property suite on its fixed seed · in-phase

### Implementation order

1. src/schemas/findingFateRecord.ts
2. schemaUrl.ts registration and the phax reader in persisted.ts
3. finding-list's widened history
4. the schemas package format, index and build tables
5. schemas-check --write, then the check
6. corpus cases, property registry, then its deep run
7. the schema unit tests and per-format tables
8. README row

### Excluded scope

- Writing or reading fate records on the records branch, and any command: phases 03 to 07.
- Listing fate records in `phax records list` or `phax records explain`, or adding them to `parseRecordManifest`: the arbitration keeps them out.
- Any change to the code-review, compliance-review or review-record-manifest formats.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

List the exports of `src/schemas/findingFateRecord.ts` and of the schemas package, and the name and contract of the phax reader. Say how `finding-list`'s `history` is now declared and how both JSON Schemas render the variants. Give both stamps as `src/schemas/release.ts` holds them, and whether they come from `next` snapshots. Name the property repairs, if any, and give the seed and result of the `pnpm test:property:deep` run. Explain any deviation from the planned file lists.

### Commit subject

`feat(schemas): add the finding-fate record format and fate history in finding-list`

### Commit body

Register finding-fate-record-manifest, born with $schema: the
record.json of one fate record of a finding on phax/records/v1, keyed
<runId>/finding/<id>/<NN>. It is an explicit union of a fix (commit,
path classes, operator or machine), a dismissal (a decided verdict that
chooses dismiss, abandons fix and defer, by an operator) and a deferral
(pointer, reason, by an operator). finding-list's history widens from an
empty tuple to these entries, oldest first. The schemas package
publishes both.

---

## phase-03 — Fate records on the records branch, read into the findings list {#phase-03-fate-records-read}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax writes a finding's fate as one record on `phax/records/v1` and reads a run's fate records back. `phax finding list` gives each finding the fate of its latest record and its full history, oldest first. Under `--json` that is the `history` array; in text, a detail line under a fixed, dismissed or deferred finding names its commits, its reason or its pointer.

### Detailed instructions

- Read the Technical arbitrations: the fate record, records being required, and that nothing is pushed. Read these files:
  - `src/app/recordPlumbing.ts`: `commitRecordTree` and `resolveRecordDestination`;
  - `src/app/recordsBranch.ts`: `recordsBranchLocation` and `RECORDS_BRANCH_NAME`;
  - `src/app/writeReviewRecord.ts` and `src/app/runReviews.ts`: the records tip resolution and `RunReviewSource`;
  - `src/app/reviewEntry.ts`, `src/app/findingList.ts`, `src/domain/findings/runFindings.ts` and `src/cli/definitions/finding.ts`;
  - `src/schemas/findingFateRecord.ts` (phase-02) and `src/app/recordsList.ts` (one record per commit).
- Create `src/app/findingFateRecords.ts`, an Effect module over FileSystem and Git only: no GitHub in any requirement. Export `fateRecordKey(runId: string, finding: string, n: number): string`, giving `<runId>/finding/<id>/<NN>`, with NN zero-padded to two digits and more digits past 99.
- In the same module, export the tagged errors `FindingRecordsOffError` and `FindingRecordsUnavailableError`, each `{ message }`, and `fateRecordDestination(target: ReviewRecordTarget | ReviewRecordUnresolved)`. It returns `Effect<{ repo: string; remote: string }, FindingRecordsOffError | FindingRecordsUnavailableError, FileSystem>`:
  - Records disabled refuses with `records are off for this project: a fate is a record on phax/records/v1, so add a records key to phax.json to set fates`.
  - An unresolved target refuses with its reason.
  - A `repo` destination with no clone path, or a clone path that does not exist, refuses naming `phax records sync`.
  - Otherwise it answers the location `recordsBranchLocation` gives. Never ask for the repository's visibility: a fate record carries no transcript.
- In the same module, export `writeFateRecord(input: { destination: { repo; remote }; runId; finding; entry: FindingFateEntry })`, returning `Effect<{ key: string; recordCommit: string }, GitError | FsError, FileSystem | Git>`. Its steps:
  1. Resolve the records tip: local `phax/records/v1`, else the remote-tracking ref, as `readRunReviews` does. Extract a shared helper from `src/app/runReviews.ts` if that avoids a copy.
  2. Walk the branch history with `listCommitFiles` to find the highest NN under `<runId>/finding/<finding>/`. The next NN is that plus one, or 1.
  3. Encode `withSchemaUrl("finding-fate-record-manifest", { kind: "finding-fate", runId, finding, ...entry })`.
  4. Commit it with `commitRecordTree` (`artifactPaths: []`, the manifest alone at `<key>/record.json`). The message is `records(finding): <id> <fate>`, a blank line, then the trailers `Run-Id: <runId>`, `Finding: <id>` and `Fate: <fate>`.
  It never pushes.
- In the same module, export `readRunFateRecords(input: { runId: string; source: RunReviewSource })`. It returns `Effect<{ records: readonly ReadFateRecord[]; unreadable: readonly { where; message }[]; notes: readonly string[] }, never, FileSystem | Git>`, where `ReadFateRecord = { finding: string; key: string; recordCommit: string; entry: FindingFateEntry }`. Its steps:
  - Records come oldest first in branch order: walk `listCommitFiles(path, tip, null)` and keep paths matching `<runId>/finding/<id>/<NN>/record.json`.
  - Read each with `readTree`, then `readBlob`, then `readFindingFateRecordManifestFile`, labelled `<sha8>:<path>`.
  - A manifest whose `runId` or `finding` disagrees with its key is unreadable.
  - A source `off` or `unavailable` answers no record.
  - A git failure answers no record and a note, as `readRunReviews` does.
- In `src/domain/findings/runFindings.ts`, change `findingFate(finding)` to `findingFate(finding: RunFinding, history: readonly FindingFateEntry[]): FindingFate`. It answers the fate of the last entry, else `open` for a persisted finding and `unrecorded` for a lifted one. Add `groupFateRecords(findings: readonly RunFinding[], records: readonly { finding: string; entry: FindingFateEntry }[])`. It answers `{ histories: ReadonlyMap<string, readonly FindingFateEntry[]>; orphans: readonly string[] }`: each finding's entries in the order given (oldest first), and the ids that hold records but no finding of the run. Both stay pure.
- In `src/app/findingList.ts`, after reading the reviews, read the fate records with the same source:
  - An unreadable fate record refuses the list with a new `FindingFateRecordUnreadableError` (`{ message }`, exit 1) naming it, as an unreadable review is refused.
  - Each entry's `history` is its grouped entries and its `fate` is `findingFate(finding, history)`.
  - Each orphan id adds the note `fate records name <id>, which no review of the run holds: not listed`.
  - Notes from the fate read join the list's notes.
  Update the module's header comment.
- In `src/cli/definitions/finding.ts`:
  - Add `FindingFateRecordUnreadableError` to `list`'s exits (1), errors and texts.
  - In `renderFindingList`, after a finding's row, add detail lines indented to the start of the fate column, keeping the column widths the rows already use:
    - fate `fixed`: one line per fix entry of its history, oldest first, reading `<first 7 of commit> (<classes joined by ", ">)`;
    - fate `dismissed`: one line `<verdict.by.name>: <verdict.why>` from the latest entry;
    - fate `deferred`: one line `→ <to>` from the latest entry;
    - `open` and `unrecorded`: none.
  - Update `list`'s help: a fate other than open or unrecorded comes from the finding's latest fate record on phax/records/v1, and the text shows a fixed finding's commits, a dismissed finding's reason and a deferred finding's pointer.
  Then run `pnpm gen:usage-spec` and `pnpm docs:cli` and commit what they change.
- Edit `tests/unit/findings/runFindings.test.ts` with a table of `findingFate` and `groupFateRecords`:
  - no entry gives `open` for a persisted finding and `unrecorded` for a lifted one;
  - one dismissal gives `dismissed`;
  - a dismissal then a fix gives `fixed`, with the history in that order;
  - a fix then a deferral gives `deferred`;
  - a record of an unknown id is an orphan.
- Create `tests/integration/findingFateRecords.test.ts`, with real git in a temporary repository and records in-repo, set up as `tests/integration/runReviews.test.ts` does. It covers:
  - two records for F3, then one for F1, keyed `<runId>/finding/F3/01`, `<runId>/finding/F3/02` and `<runId>/finding/F1/01`;
  - each records commit holding exactly one `record.json`, with its message trailers;
  - `readRunFateRecords` answering them oldest first with their entries;
  - `fateRecordDestination` refusing records off (naming the records key), a missing dedicated clone (naming `phax records sync`) and an unresolved target (with its reason);
  - `listRecords` (`src/app/recordsList.ts`) still answering the run's review records, with no failure, when fate records sit on the branch.
- Create `tests/integration/findingListFates.test.ts`. It runs through `runnerCall([findingGroup], argv)` with the working directory at the fixture of `tests/fixtures/findings/findingRunRepo.ts`, which it imports and never edits. Fate records are written with `writeFateRecord`. Cases:
  - After `reviewOnce` of four findings, F1 is fixed, F2 dismissed and F3 deferred. `--json` answers those fates, F4 `open`, and histories equal to the written entries. The text shows a detail line holding F1's short commit and `tests`, F2's `<name>: <why>` and F3's `→ <to>`.
  - F3 dismissed then fixed answers `fixed`, with a history of the dismissal then the fix.
  - After `writeOlderReviews`, a dismissal record on F2 lists F2 `dismissed`, and F1 and F3 stay `unrecorded`.
  - A damaged fate record (a blob that is not JSON, committed under a fate key) is refused with exit 1 naming it.
  - A fate record for `F9` adds the orphan note on stderr, and the list exits 0.
- Edit `tests/unit/cli/findingList.test.ts`: the detail lines of each fate, and the row alignment kept. Leave plan 1's acceptance files, `tests/integration/findingList.test.ts` and `tests/fixtures/findings/findingRunRepo.ts`, as they are: they still pass, with every history empty.

### Planned files to create

- `src/app/findingFateRecords.ts`
- `tests/integration/findingFateRecords.test.ts`
- `tests/integration/findingListFates.test.ts`

### Planned files to edit

- `src/domain/findings/runFindings.ts`
- `src/app/findingList.ts`
- `src/cli/definitions/finding.ts`
- `tests/unit/findings/runFindings.test.ts`
- `tests/unit/cli/findingList.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/runReviews.ts`
- `src/app/recordPlumbing.ts`
- `src/app/recordsBranch.ts`
- `src/app/recordsList.ts`
- `docs/cli/inventory.md`
- `knip.json`
- `tests/integration/findingListSources.test.ts`

### Boundary contracts

Producer: `src/app/findingFateRecords.ts`, which exports `fateRecordKey`, `fateRecordDestination`, `writeFateRecord`, `readRunFateRecords` and the two records errors. Its consumers are `listRunFindings` (this phase) and the fate commands (phases 05 and 07). Contract:
- one fate record is one commit on `phax/records/v1`, holding only `<runId>/finding/<id>/<NN>/record.json`, with the `Run-Id`, `Finding` and `Fate` trailers;
- records are read oldest first in branch order;
- the destination check refuses records off, an unreadable project and a missing records clone;
- nothing reaches GitHub or pushes.
Domain: `findingFate` and `groupFateRecords`, where the last entry decides. CLI: `phax finding list`'s answer keeps its shape. `history` now carries entries, and the text gains detail lines.

### Test strategy

- the latest fate record decides a finding's fate and its history keeps every record oldest first, open or unrecorded when it has none — small · table · a hand-written table of histories and their fates · in-phase · AC-latest-wins
- a finding dismissed then fixed lists fixed with the dismissal then the fix in its history — medium · example · the finding-list answer after two records written by writeFateRecord · in-phase · AC-latest-wins
- each fate record is one commit holding only its record.json at <runId>/finding/<id>/<NN>, numbered per finding, and reads back oldest first — medium · example · the records branch's commits, trees and trailers in a temporary repository · in-phase
- finding list --json carries each finding's fate and its full history of fate records — medium · example · the decoded answer against the entries written · in-phase · AC-list-json
- the text list shows a fixed finding's commits and path classes, a dismissed finding's reason and a deferred finding's pointer — small · example · the rendered text of a document with one finding of each fate · in-phase · AC-list-text
- a finding lifted as unrecorded lists dismissed once a dismissal record names it — medium · example · the answer's fate for F2 after writeOlderReviews and one record · in-phase · AC-lift-settable
- records off, an unreadable project and a missing records clone are refused before any write, naming the records key, the reason or phax records sync — medium · example · the typed error and its message · in-phase
- a damaged fate record refuses the list naming it, and a record of an unknown id is noted, not listed — medium · example · the exit code and the stderr lines · in-phase

### Implementation order

1. fateRecordKey and fateRecordDestination
2. writeFateRecord
3. readRunFateRecords
4. findingFate and groupFateRecords in runFindings.ts
5. listRunFindings reading fates
6. the text detail lines, the help, then gen:usage-spec and docs:cli
7. the unit and integration tests

### Excluded scope

- Any fate command: `phax finding fix` (phase-05), `dismiss` and `defer` (phase-07).
- Pushing the records branch, any GitHub call, and the pull request (plan 3).
- Showing fate records in `phax records list` or `phax records explain`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exports of `src/app/findingFateRecords.ts` with their signatures, and the exact refusal and note wordings. Say how the records tip is resolved, and whether a helper was extracted from `src/app/runReviews.ts`. Give the new signatures of `findingFate` and `groupFateRecords`, and the new error of `listRunFindings` with its exit. Show one rendered text list with a detail line of each fate. Confirm that plan 1's `tests/integration/findingList.test.ts` and `tests/fixtures/findings/findingRunRepo.ts` are unchanged and that `phax.usage.kdl` and `docs/cli/reference.md` were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(findings): record fates on phax/records/v1 and list them`

### Commit body

A finding's fate is now one record on phax/records/v1, one commit
keyed <runId>/finding/<id>/<NN>, written without any GitHub call or
push, and refused up front when records are off, the project cannot be
read or the records clone is missing. phax finding list reads a run's
fate records oldest first: the latest decides the fate, the history
holds them all, and the text names a fixed finding's commits and path
classes, a dismissed finding's reason and a deferred finding's pointer.

---

## phase-04 — Acceptance tests of phax finding fix {#phase-04-finding-fix-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-05
**Acceptance test files:** `tests/integration/findingFix.test.ts`, `tests/fixtures/findings/fateRunRepo.ts`

This phase writes what `phax finding fix` must do as frozen acceptance tests, through the command runner:
- commit exactly the named paths with the `Short-Name` and `Finding` trailers;
- record each finding `fixed` with its path classes and who fixed it;
- refuse an incomplete call, a run that is not open for review, and records off;
- keep the commit when its record fails;
- let a machine fix.
Each test fails today on its own assertion, because `finding fix` is not a command yet. Phase-05 passes them.

### Detailed instructions

- Read the Technical arbitrations (how fix reads its call, the commit, `--commit`, exit codes, the answers, who sets a fate, the acceptance pairs) and phase-03's handoff. Read these files:
  - `tests/fixtures/findings/findingRunRepo.ts`: import it and never edit it;
  - `tests/integration/findingList.test.ts`: the `vi.mock("node:os")` hoisting, the working directory, `runnerCall`;
  - `tests/helpers/runnerCall.ts`: `stdinIsTerminal` defaults to no terminal;
  - `src/cli/definitions/finding.ts`.
- Write no stub and change no source file. `findingGroup` holds only `list`, so every `finding fix` call is refused as an unknown command, with exit 64. Every test asserts an exit code of 0 or 1 and the state of git, so it fails on its own assertion.
- Create `tests/fixtures/findings/fateRunRepo.ts`, built on `buildFindingRunRepo()` and `reviewOnce` from `findingRunRepo.ts`. It reads nothing outside its temporary directories and never names the opened version. It exports:
  - `buildFateRunRepo()`. It calls `buildFindingRunRepo()`, then reads the run's worktree path and branch through `resolveRun`, as `reviewOnce` does. In the worktree, it commits on the run branch `tests/gate.test.ts`, `src/app/gate.ts`, `docs/gates.md` and a `README.md` with initial contents. In the main checkout, it commits `docs/briefs/gate-retry-docs.md` on main. It returns the `FindingRunRepo` fields plus `worktreePath` and `runBranch`.
  - `writeInWorktree(repo, path, content)` and `stageInWorktree(repo, path)`.
  - `setRunState(repo, state)`, which rewrites the state in run-status.json.
  - `turnRecordsOff(repo)`, which rewrites phax.json without its `records` key.
  - `lockRecordsBranch(repo)`, which creates `.git/refs/heads/phax/records/v1.lock` and its directories, so the next records commit fails.
  - `head(repo, ref)`, which answers a ref's sha in the main checkout or null.
  - `commitMessage(repo, sha)` and `commitPaths(repo, sha)`, the paths a commit changes.
  - `worktreeStatus(repo)`, the porcelain v1 lines of the worktree.
  - `findingListJson(repo)`, which runs `finding list <run> --json` through `runnerCall([findingGroup], …)` and decodes stdout with `decodeFindingListFile`.
- Create `tests/integration/findingFix.test.ts`. Every test is its own `it.fails(...)`. Each builds a repo, sets the working directory to `repoDir` (outside the worktree, so paths resolve against the worktree root), seeds reviews with `reviewOnce(repo, messages)` (F1 to Fn), and calls `runnerCall([findingGroup], argv)`. Every option goes before `--`. Judge only what the spec states and this plan's arbitrations fix:
  - AC-fix-commits-named-paths: five findings; `tests/gate.test.ts` and `src/app/gate.ts` changed in the worktree, and `README.md` changed and staged. `finding fix <run> F2 F5 --by operator -- tests/gate.test.ts` exits 0. The run branch moved by exactly one commit. Its paths are exactly `tests/gate.test.ts`. Its subject is `fix(review): F2, F5 of <short-name>`. Its message ends with the lines `Short-Name: <short-name>`, `Finding: F2` and `Finding: F5`, in that order, and holds no `Run-Id`. The worktree status still shows `src/app/gate.ts` modified and unstaged and `README.md` staged.
  - AC-fix-records and AC-list-json, after the same fix: the list answer's first key is `$schema`, equal to `currentSchemaUrl("finding-list")`. F2 and F5 are `fixed`, each with one history entry `{ fate: fixed, commit: <the new head sha>, pathClasses: [tests], by: { kind: operator, name: phax test }, at }`, where `at` matches an ISO-8601 UTC timestamp. F1, F3 and F4 are `open`. Every stderr line of the list parses as a message line.
  - AC-path-classes: changes in `tests/gate.test.ts`, `src/app/gate.ts` and `docs/gates.md`. `finding fix <run> F1 --by operator -- tests/gate.test.ts src/app/gate.ts docs/gates.md` exits 0, and F1's entry has `pathClasses` `[code, docs, tests]`. Then `finding fix <run> F3 --commit <that sha> --by operator` exits 0: F3's entry has the same commit and `[code, docs, tests]`, and the run branch head is unchanged.
  - AC-fix-refusals: F2 open, `docs/gates.md` clean, `src/app/gate.ts` changed. `finding fix <run> F2 --by operator` exits 1, and stderr says no path was given. `finding fix <run> F2 --by operator -- docs/gates.md` exits 1 naming `docs/gates.md`. `finding fix <run> F9 --by operator -- src/app/gate.ts` exits 1 naming `F9`. The run branch head and the records branch head are as before the three calls.
  - AC-fix-state: `setRunState(repo, "running")` and `src/app/gate.ts` changed. `finding fix <run> F1 --by operator -- src/app/gate.ts` exits 1, and stderr names `running`. Both heads are unchanged.
  - AC-machine-fix: `src/app/gate.ts` changed. `finding fix <run> F1 --by machine:review-bot -- src/app/gate.ts` exits 0, and F1's entry has `by` `{ kind: machine, grant: review-bot }`. Then `docs/gates.md` changed: the same call for F2 without `--by`, and without a terminal, exits non-zero, and the run branch head is unchanged.
  - AC-records-off, fix part: after the review, `turnRecordsOff(repo)` and `src/app/gate.ts` changed. `finding fix <run> F1 --by operator -- src/app/gate.ts` exits 1, stderr names the `records` key, and the run branch head is unchanged.
  - AC-record-failure: after the review, `lockRecordsBranch(repo)` and `tests/gate.test.ts` changed. `finding fix <run> F2 --by operator -- tests/gate.test.ts` exits 1. The run branch has one new commit whose paths are `tests/gate.test.ts`. Stderr says F2's fate is not recorded and contains `phax finding fix <short-name> F2 --commit <the new head sha>`.
  - AC-rereview-continues: `reviewOnce` with three messages, then with two, and `tests/gate.test.ts` changed. `finding fix <run> F2 --by operator -- tests/gate.test.ts` exits 0. The list holds F1 to F5: F2 `fixed`, and F1, F3, F4 and F5 `open`, with F1 to F3 holding the first review's messages.
- Reach the command only through the runner and the fixture, never through a definition's or a use case's internals. Run the gate and check that each marked test fails on its own assertion (an exit code), not on a missing module or export.

### Planned files to create

- `tests/integration/findingFix.test.ts`
- `tests/fixtures/findings/fateRunRepo.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-05's `fix` command in `findingGroup` (`src/cli/definitions/finding.ts`). Consumer: these acceptance tests, through `runnerCall` over a memory Io, with the working directory at the fixture's main checkout. Contract:
- `finding fix <run> <id>… [--by …] [-m …] [--body …] [--commit <sha>] -- <path>…`;
- exit 0 on success;
- exit 1 for every refusal the use case makes and for a fate not recorded;
- a call without `--by` and without a terminal refused by the runner;
- one commit holding exactly the named paths, with `Short-Name` and one `Finding` trailer per id;
- one fate record per id, read back through `finding list --json`.

### Test strategy

- a fix commits exactly the named paths with Short-Name and one Finding trailer per id, and leaves every other staged or unstaged change in place — medium · example · the new commit's paths and message, and the worktree's porcelain status before and after · acceptance · AC-fix-commits-named-paths
- each id named is recorded fixed with the new commit, its path classes, the operator and a timestamp, and the list answers it with $schema first — medium · example · the finding-list answer's fates and history entries against the new head sha · acceptance · AC-fix-records
- the list answer's history holds the fate record a fix wrote — medium · example · decodeFindingListFile of stdout and each stderr line parsed as a message line · acceptance · AC-list-json
- a commit changing a test, a source and a docs file is classed code, docs, tests, and recording it again gives the same set — medium · example · the pathClasses of both fate records · acceptance · AC-path-classes
- a call with no path, an unchanged path or an unknown id exits 1 naming it, and commits and records nothing — medium · example · the exit code, the stderr text, and both branch heads before and after · acceptance · AC-fix-refusals
- a fix on a run that is not review_open exits 1 naming its state and commits nothing — medium · example · the exit code, the stderr text and the run branch head · acceptance · AC-fix-state
- a machine fixes with --by machine:<grant>, and a call without --by and without a terminal is refused — medium · example · the fate record's by and the refused call's exit code and unchanged head · acceptance · AC-machine-fix
- with records off a fix exits 1 naming the records key before any commit — medium · example · the exit code, the stderr text and the run branch head · acceptance · AC-records-off
- a fix whose record fails keeps its commit, exits 1 and names the --commit retry — medium · example · the run branch's new commit and the stderr retry command · acceptance · AC-record-failure
- after a re-review, F2 fixed and F1, F3, F4, F5 open are listed together — medium · example · the list answer's ids, fates and messages against the two reviews · acceptance · AC-rereview-continues

### Implementation order

1. fateRunRepo.ts
2. findingFix.test.ts with a marker on each test
3. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing `phax finding fix` (phase-05).
- Dismissal and deferral (phases 06 and 07).
- Any pull request behaviour (plan 3).
- Editing `tests/fixtures/findings/findingRunRepo.ts` or any source file.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files.

### Expected handoff content

Give what `fateRunRepo.ts` builds and the signatures of its helpers, including the tracked files it commits and where. For each acceptance test, give the assertion it fails on today. Confirm that every test carries its own `.fails` marker, that no test names the opened version, and that no source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(findings): acceptance tests for phax finding fix`

### Commit body

Freeze what phax finding fix must do before it exists: commit exactly
the named paths with Short-Name and one Finding trailer per id, leaving
other changes in place; record each finding fixed with its commit, path
classes, who and when; refuse no path, an unchanged path, an unknown id,
a run not open for review and records off with exit 1; keep the commit
and name the --commit retry when its record fails; let a machine fix.
Each fails today because finding fix is not yet a command.

---

## phase-05 — phax finding fix {#phase-05-finding-fix}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** This phase designs a new command that crosses the CLI, a use case, the records branch and several git operations: path-scoped commits, path resolution, reachability, partial record failure. Its refusals must all come before any write, and it must satisfy frozen acceptance tests it cannot change, so the default effort is not enough.

Operators and machines can run `phax finding fix <run> <id>… -- <path>…`. phax commits exactly the named paths in the run's final worktree, with `Short-Name` and one `Finding` trailer per id and a default or given subject. It records each finding `fixed` with the commit's path classes and who fixed it. `--commit <sha>` records an existing commit instead. Nothing is pushed and GitHub is never called. The acceptance tests of phase-04 pass.

### Detailed instructions

- Read the Technical arbitrations, which settle every choice this phase makes, then phase-04's handoff and its two acceptance files. In `tests/integration/findingFix.test.ts`, remove only the `.fails` markers. Change nothing else in it or in `tests/fixtures/findings/fateRunRepo.ts`, and never retype a test's title. Read `src/app/findingFateRecords.ts` (phase-03), `src/domain/findings/pathClass.ts` and `Git.commitChangedPaths` (phase-01), `src/app/resolveArbiter.ts`, `src/app/findingList.ts`, `src/cli/definitions/artifactTransitions.ts` (`--by`, `prompts`, `unprompted`), and how `prune` declares its `-y` alias.
- Create `src/domain/findings/fixCall.ts`, pure, exporting:
  - `isFindingId(word: string): boolean`, for `^[FC][1-9][0-9]*$`;
  - `splitFixOperands(operands: readonly string[]): { ids: readonly string[]; paths: readonly string[] }`. The leading id-form operands are the ids, deduplicated in the order given. Every operand from the first one not of that form is a path.
  - `defaultFixSubject(ids, shortName)`, giving `fix(review): F2, F5 of gate-retry`;
  - `fixCommitBody({ shortName, ids, body })`. It answers the body paragraph and a blank line when a body is given, then the trailer lines `Short-Name: <shortName>` and `Finding: <id>` per id, in order, and never `Run-Id`.
- In `src/app/findingList.ts`, export `resolveFindingRun(ref, config)`. It answers the run as the list resolves it (namespace, shortName, runId, state, runFolder, source, notes) plus three fields:
  - `target: ReviewRecordTarget | ReviewRecordUnresolved`: `reviewRecordTargetFor` for a live run, `runEndReviewRecordTarget` for an archived run of this namespace, and unresolved otherwise;
  - `worktreePath: string | null`, from `info.worktreePath` for a live run;
  - `runBranch: string | null`, from `info.finalPhaseBranch` for a live run.
  `listRunFindings` uses it. Keep its answer and errors.
- Create `src/app/findingFix.ts` exporting `fixFindings(input: { ref; operands; commit: string | undefined; subject: string | undefined; body: string | undefined; by: string | undefined; cwd: string; nowIso: string; config: ResolvedConfig })`. It requires FileSystem, Git and Terminal, never GitHub. Every refusal is a `FindingFixRefusedError` (`{ message }`), and comes before any write. The steps, in order:
  1. Split the operands. No id refuses. `--commit` given with a path, a subject or a body refuses. No `--commit` and no path refuses with `no path given: name the changed paths after --`.
  2. `resolveFindingRun`. Without `--commit`, the run must be live, in `review_open` and with a worktree. Otherwise refuse naming its state, for example `gate-retry is running, not review_open: a fix rides the run while it is open for review`.
  3. `fateRecordDestination(target)`. Its two errors pass through.
  4. `resolveArbiter(by, <the run's repository>)`. An operator or a machine is accepted, and its refusal becomes a `FindingFixRefusedError`.
  5. Read the run's findings through `listRunFindings`. Refuse naming every id the run does not have, for example `gate-retry has no finding F7`.
  6. Path form:
     - Resolve each path relative to `cwd` when `git.repoTopLevel(cwd)` is the worktree's real path, else relative to the worktree root.
     - Refuse a path that leaves the worktree.
     - Refuse naming every path for which `git.dirtyPaths(worktree, [path])` answers nothing, for example `docs/gates.md has no change`.
     - Commit with `git.commitPaths(worktree, paths, subject ?? defaultFixSubject(ids, shortName), fixCommitBody(...))`. The sha is `git.headCommit(worktree)`, and the commit is `made`.
  7. `--commit` form:
     - Resolve the sha with `git.resolveRef` in the run's repository (the worktree when present, else the target's repoRoot). An unknown sha refuses.
     - Check reachability through `git.mergeBase(repo, sha, tip) === sha` against the run branch when it resolves, and against the base branch (`publish.baseBranch`, else `main`, local else `refs/remotes/<publish.remote>/<base>`). Refuse naming the refs checked when neither holds it.
  8. Read the commit's paths with `git.commitChangedPaths`, and its classes with `pathClassesOf`. A `--commit` that changes no path refuses.
  9. Write one record per id, in order, with `writeFateRecord`: `{ fate: fixed, commit: <full sha>, pathClasses, by, at: nowIso }`. Collect failures. If any id was not recorded, fail with `FindingFateNotRecordedError`, `{ message, commit, recorded, unrecorded, retry }`. The message says which ids are recorded, which are not and why (one git line), that the commit stays, and the retry `phax finding fix <ref as given> <unrecorded ids> --commit <full sha>`.
  10. Answer `{ run: { namespace, shortName, runId, state }, commit: { sha, made, subject (null for --commit), paths: [{ path, pathClass }] }, recorded: [{ finding, key, recordCommit }], findings }`. `findings` holds the named findings' entries, read again through `listRunFindings` after the write.
  No push of any branch and no GitHub layer, whatever `publish.auto` or `records.autoPush` says.
- In `src/cli/definitions/finding.ts`, add the `fix` command to `findingGroup`:
  - args: `reject` of a tuple of `ShortNameArg` with a rest of strings, declared as the command library's rest-after-an-element gain declares it;
  - flags, each optional: `by` (described as on `artifact approve`), `commit` (a sha), `message` with the short alias `m` (the subject), and `body`;
  - `prompts: (input) => input.flags.by === undefined` and `unprompted: "pass --by"`;
  - output: the answer as a contract object, with no `$schema`, named `FindingFixOutput` and built from `CodeReviewFindingEntrySchema` and `ComplianceFindingEntrySchema`;
  - exits, all with `MessageFields` except the not-recorded error, which declares its own fields: `FindingFixRefusedError` 1, `FindingRecordsOffError` 1, `FindingRecordsUnavailableError` 1, `FindingFateNotRecordedError` 1, `FindingRunRefError` 1, `FindingReviewUnreadableError` 1, `FindingFateRecordUnreadableError` 1, `GitError` 1, `FsError` 1, `RegistryCorruptionError` 1, `ConfigValidationError` 2;
  - texts `✗ fix refused: <message>`, except for the not-recorded error, whose text is its message;
  - help in a few sentences: what it commits, the trailers, the classes, `--commit`, that it pushes nothing and calls no GitHub;
  - examples: `phax finding fix gate-retry F2 -- tests/gate.test.ts`, `phax finding fix gate-retry F2 F5 -m "fix(gate): keep the exit code" -- src/app/gate.ts`, `phax finding fix gate-retry F3 --commit 9f8e7d6 --by operator`.
  The render prints `✓ committed <sha7> <subject>` and `  paths: <path> (<class>), …` for a made commit. Then, per recorded finding, it prints `✓ recorded <id> fixed on phax/records/v1`, or for `--commit`, `✓ recorded <id> fixed by <sha7> (<classes>) on phax/records/v1`. The definition holds no business logic: it calls `fixFindings` with `process.cwd()` and `new Date().toISOString()` and provides the Node file system, Git and terminal layers.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit `phax.usage.kdl` and `docs/cli/reference.md` (and `docs/cli/inventory.md` if it changes). Add `{ command: "finding fix", provedBy: "tests/integration/findingFix.test.ts" }` to `tests/integration/everyCommandJson.test.ts`, and `finding fix` to the list of `tests/integration/usageSpecDeclarations.test.ts`. Update any other per-command table a test names.
- In-phase tests:
  - Create `tests/unit/findings/fixCall.test.ts`: a table of operand splits (ids then paths, a duplicate id, no id, a path spelled like an id after another path) and the default subject. It also checks the body with and without a body paragraph, with the trailers last and in order.
  - Create `tests/unit/cli/findingFate.test.ts`: the text a fix answer renders, for a made commit and for `--commit`.
  - Create `tests/integration/findingFixPaths.test.ts`, with the fixture of `fateRunRepo.ts`, imported and never edited, and the runner. It covers:
    - a relative path given from a subdirectory of the worktree;
    - a path leaving the worktree, refused;
    - `-m` and `--body` in the commit message, the trailers still last;
    - `--commit` with an unknown sha, refused;
    - `--commit` with a sha on neither the run branch nor the base, refused naming both (a commit on a side branch);
    - `--commit` on a run whose state is not `review_open`, accepted;
    - `--commit` together with a path, refused;
    - a named directory, which commits its changed files;
    - an id named twice, which writes one record and one trailer;
    - a dedicated records destination whose clone is missing, refused naming `phax records sync` with no commit.

### Planned files to create

- `src/domain/findings/fixCall.ts`
- `src/app/findingFix.ts`
- `tests/unit/findings/fixCall.test.ts`
- `tests/unit/cli/findingFate.test.ts`
- `tests/integration/findingFixPaths.test.ts`

### Planned files to edit

- `src/app/findingList.ts`
- `src/cli/definitions/finding.ts`
- `tests/integration/findingFix.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `tests/integration/usageSpecDeclarations.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/findingFateRecords.ts`
- `src/app/resolveArbiter.ts`
- `src/cli/definitions/shared.ts`
- `docs/cli/inventory.md`
- `knip.json`
- `tests/unit/commandLibrary/commander/catalogue.test.ts`
- `tests/integration/rootHelp.test.ts`

### Boundary contracts

The CLI layer (`src/cli/definitions/finding.ts`) calls one use case, `fixFindings` in `src/app/findingFix.ts`, and renders its answer. It holds no business logic. The use case uses these:
- `resolveFindingRun` and `listRunFindings` (`src/app/findingList.ts`);
- `fateRecordDestination` and `writeFateRecord` (`src/app/findingFateRecords.ts`);
- `resolveArbiter`;
- the pure `src/domain/findings/fixCall.ts` and `pathClass.ts`;
- the Git port: `commitPaths`, `headCommit`, `dirtyPaths`, `repoTopLevel`, `resolveRef`, `mergeBase` and `commitChangedPaths`.
It reaches no GitHub port and pushes nothing. Phase-07 reuses `resolveFindingRun`, the records check, the arbiter and the answer's shape. Stable contract toward the acceptance tests:
- the call `finding fix <run> <id>… [flags] -- <path>…`;
- exit 0, or 1 for a refusal and for a fate not recorded;
- one path-scoped commit with the trailers, and one fate record per id.

### Test strategy

- operands split into ids and paths by the id form, ids deduplicated in order, and the default subject and trailer body are written as decided — small · table · hand-written operand lists and their expected ids, paths, subject and body · in-phase
- a path is resolved relative to the current directory inside the worktree and refused when it leaves it, and a named directory commits its changes — medium · example · the commit's paths and the refusal text · in-phase
- --commit records only a commit reachable from the run branch or the base branch, refuses one with paths or an unknown sha, and runs on a run not open for review — medium · example · the exit code, the refusal text and the fate record written · in-phase
- -m and --body set the subject and body while phax's trailers stay last, and an id named twice gives one trailer and one record — medium · example · the commit message and the records branch commits · in-phase
- a missing records clone refuses before any commit, naming phax records sync — medium · example · the exit code, the stderr text and the run branch head · in-phase
- a fix answer renders the committed, paths and recorded lines, and the --commit form its own recorded line — small · example · the expected text lines · in-phase
- the usage spec, the CLI reference and the every-command JSON table hold phax finding fix as generated — small · example · the usage, CLI-reference and every-command drift tests · in-phase

### Implementation order

1. src/domain/findings/fixCall.ts and its table test
2. resolveFindingRun in findingList.ts
3. fixFindings: refusals, path form, --commit form, records, answer
4. the fix command, its render, exits and help
5. gen:usage-spec, docs:cli and the cross-command tables
6. remove the acceptance markers
7. the in-phase tests

### Excluded scope

- `phax finding dismiss` and `defer` (phase-07).
- Pushing the run branch or the records branch, posting on the pull request, and any GitHub call (plan 3).
- Fixing on `main` after the merge by making a commit there (a follow-up of the spec).
- A change to the command library: ids and paths are told apart by the id form.
- Editing `tests/fixtures/findings/fateRunRepo.ts` or anything but the markers in `tests/integration/findingFix.test.ts`.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-04's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give the signature of `fixFindings`, its failure tags with their exit codes, and the exact refusal, not-recorded and retry wordings. Give `resolveFindingRun`'s signature and the shape of the `fix` answer. Give the exports of `src/domain/findings/fixCall.ts`, and say how paths are resolved and how reachability of `--commit` is checked. Confirm that only the `.fails` markers changed in the acceptance test file, that `fateRunRepo.ts` is unchanged, and that `phax.usage.kdl` and `docs/cli/reference.md` were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): add phax finding fix`

### Commit body

phax finding fix <run> <id>… -- <path>… commits exactly the named paths
in the run's final worktree while it is review_open, with Short-Name and
one Finding trailer per id under a default subject that -m overrides,
and records each finding fixed on phax/records/v1 with the commit's path
classes and who fixed it, an operator or a machine. --commit <sha>
records an existing commit reachable from the run branch or the base
branch, and is the retry when a record fails after the commit landed.
It refuses before any write, pushes nothing and never calls GitHub. The
acceptance tests of the previous commit pass.

---

## phase-06 — Acceptance tests of phax finding dismiss and defer {#phase-06-settle-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-07
**Acceptance test files:** `tests/integration/findingSettle.test.ts`

This phase writes what `phax finding dismiss` and `phax finding defer` must do as frozen acceptance tests, through the command runner:
- a dismissal recorded as a stamped decided verdict;
- a deferral naming its successor;
- refusals of incomplete calls, of a machine and of records off;
- an `unrecorded` finding settled later;
- the latest record deciding;
- the text list naming every fate's details.
Each test fails today on its own assertion, because neither command exists. Phase-07 passes them.

### Detailed instructions

- Read the Technical arbitrations (the dismissal's verdict, where the commands run, exit codes, who sets a fate, the acceptance pairs) and phase-05's handoff. Read these files:
  - `tests/fixtures/findings/fateRunRepo.ts` and `tests/fixtures/findings/findingRunRepo.ts`: import them, never edit them;
  - `tests/integration/findingFix.test.ts`: how a test is set up;
  - `src/schemas/findingFateRecord.ts`: `decodeFindingFateRecordManifestFile`.
- Write no stub and change no source file. `findingGroup` holds `list` and `fix` only, so every `finding dismiss` or `finding defer` call is refused as an unknown command, with exit 64. Every test asserts an exit code of 0 or 1, so it fails on its own assertion.
- Create `tests/integration/findingSettle.test.ts`. Every test is its own `it.fails(...)`. Each builds a repo with `buildFateRunRepo()`, sets the working directory to its `repoDir` (the main checkout, where `docs/briefs/gate-retry-docs.md` is tracked at HEAD), seeds reviews with `reviewOnce` (whose findings carry the suggestion `Cover it with a test.`), and calls `runnerCall([findingGroup], argv)` with every option before any `--`. Operator calls pass `--by operator`, and the operator is the fixture's git user, `phax test`.
- The tests in `tests/integration/findingSettle.test.ts`, part 1:
  - AC-dismiss: three findings. `finding dismiss <run> F3 --by operator --why "the second check guards --resume"` exits 0. The records branch gained exactly one commit, whose tree holds only `<runId>/finding/F3/01/record.json`. That file decodes with `decodeFindingFateRecordManifestFile` as `fate: dismissed`, whose verdict has `kind: decided`, `chosen: dismiss`, `abandoned: [fix, defer]`, the given `why`, `advocate: Cover it with a test.`, `principles: []`, `reversibility: cheap`, `revised: []`, `by: { kind: operator, name: phax test }` and an ISO-8601 UTC `at`.
  - AC-defer: three findings. `finding defer <run> F3 --by operator --to docs/briefs/gate-retry-docs.md --why "docs pass after the gate rework"` exits 0. The list answer gives F3 `deferred`, with one history entry `{ fate: deferred, to: docs/briefs/gate-retry-docs.md, why: <as given>, by: { kind: operator, name: phax test }, at }`.
  - AC-settle-refusals: five findings.
    - `finding dismiss <run> F5 --by operator`, without `--why`, exits non-zero, and stderr names `--why`.
    - `finding defer <run> F5 --by operator --to docs/briefs/nope.md --why x` exits 1 naming `docs/briefs/nope.md`.
    - `finding dismiss <run> F9 --by operator --why x` exits 1 naming `F9`.
    - The records branch head is unchanged after the three calls.
  - AC-machine-never-settles: three findings. `finding dismiss <run> F3 --by machine:review-bot --why x` exits 1, and stderr says only an operator dismisses a finding. `finding defer <run> F3 --by machine:review-bot --to docs/briefs/gate-retry-docs.md --why x` exits 1 and says only an operator defers a finding. F3 is still `open`, and the records head is unchanged.
- The tests in `tests/integration/findingSettle.test.ts`, part 2:
  - AC-records-off, dismiss and defer: three findings, then `turnRecordsOff`. A dismiss and a defer of F1, each with `--by operator` and a reason, each exit 1, and stderr names the `records` key.
  - AC-lift-settable: `writeOlderReviews(repo)`. `finding dismiss <run> F2 --by operator --why "superseded by the gate rework"` exits 0. The list gives F2 `dismissed`, with that reason in its history, and F1 and F3 `unrecorded`. The text list holds the reason on the line after F2's row.
  - AC-latest-wins: three findings. F3 is dismissed. Then `tests/gate.test.ts` is changed and `finding fix <run> F3 --by operator -- tests/gate.test.ts` runs. The list gives F3 `fixed`, with a history of the dismissal then the fix, oldest first.
  - AC-list-text: four findings.
    - F1 is fixed (a change to `tests/gate.test.ts`), F2 dismissed with reason `the second check guards --resume`, F3 deferred to `docs/briefs/gate-retry-docs.md`, and F4 left open.
    - `finding list <run>` exits 0. Each finding's row holds its id, `concern`, `src/reviewed.ts:7`, its message and its fate.
    - The output holds the first seven characters of the fix commit and `tests`, the dismissal's reason, and `docs/briefs/gate-retry-docs.md`.
  - A dismissal of two ids, `finding dismiss <run> F1 F2 --by operator --why x`, adds two records commits, and the list gives both `dismissed`.
- Reach the commands only through the runner and the fixtures, never through a definition's or a use case's internals. Pin no layout of the text beyond what each test names. Run the gate and check that each marked test fails on its own assertion, not on a missing module or export.

### Planned files to create

- `tests/integration/findingSettle.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-07's `dismiss` and `defer` commands in `findingGroup`. Consumer: these acceptance tests, through `runnerCall` with the working directory at the fixture's main checkout. Contract:
- the calls `finding dismiss <run> <id>… --why <reason> [--by operator]` and `finding defer <run> <id>… --to <path> --why <reason> [--by operator]`;
- exit 0 on success;
- exit 1 for a use-case refusal (a machine, an untracked pointer, an unknown id, records off);
- non-zero from the runner for a missing `--why`;
- one fate record per id, read back through `finding list` and its `--json`.

### Test strategy

- a dismissal is one fate record holding a decided verdict that chooses dismiss, abandons fix and defer, carries the reason, an empty revised list and the operator with a timestamp — medium · example · the records commit's tree and its decoded record.json · acceptance · AC-dismiss
- a deferral records its pointer and reason, stamped by the operator — medium · example · the finding-list answer's fate and history entry · acceptance · AC-defer
- a missing reason, an untracked pointer and an unknown id are refused naming them, and no record is written — medium · example · the exit codes, the stderr text and the records branch head · acceptance · AC-settle-refusals
- a machine is refused when it dismisses or defers, and the finding stays open — medium · example · the exit code, the stderr text and the finding's fate · acceptance · AC-machine-never-settles
- with records off, dismiss and defer exit 1 naming the records key — medium · example · the exit code and the stderr text · acceptance · AC-records-off
- an unrecorded finding of an older review can be dismissed later and lists dismissed with its reason — medium · example · the list answer and text after the dismissal · acceptance · AC-lift-settable
- a finding dismissed then fixed lists fixed with both records oldest first — medium · example · the list answer's fate and history order · acceptance · AC-latest-wins
- the text list prints each finding with its id, severity, location, message and fate, and the fixed, dismissed and deferred ones with their commit and classes, reason and pointer — medium · example · the stdout of finding list against the four settled findings · acceptance · AC-list-text

### Implementation order

1. findingSettle.test.ts with a marker on each test
2. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing `phax finding dismiss` and `defer` (phase-07).
- Editing `tests/fixtures/findings/fateRunRepo.ts`, `tests/fixtures/findings/findingRunRepo.ts` or any source file.
- Any pull request behaviour (plan 3).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files.

### Expected handoff content

For each acceptance test, give the assertion it fails on today. Confirm that every test carries its own `.fails` marker, that no test names the opened version, and that no fixture or source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(findings): acceptance tests for phax finding dismiss and defer`

### Commit body

Freeze what phax finding dismiss and defer must do before they exist: a
dismissal recorded as a decided verdict that chooses dismiss with the
operator's reason, a deferral naming the tracked file that takes the
finding over, refusals of a missing reason, an untracked pointer, an
unknown id, a machine and records off, an unrecorded finding settled
later, the latest record deciding, and the text list naming every fate's
details. Each fails today because neither command exists.

---

## phase-07 — phax finding dismiss and defer {#phase-07-finding-dismiss-defer}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator can run `phax finding dismiss <run> <id>… --why <reason>` and `phax finding defer <run> <id>… --to <path> --why <reason>` on any run whose records exist, including archived runs and `unrecorded` findings. phax records one fate record per id, stamped with the operator's name and the time. A machine is refused. Nothing is pushed and GitHub is never called. The acceptance tests of phase-06 pass.

### Detailed instructions

- Read the Technical arbitrations (the dismissal's verdict, where the commands run, exit codes, the answers, who sets a fate), phase-05's handoff and phase-06's acceptance file. In `tests/integration/findingSettle.test.ts`, remove only the `.fails` markers, change nothing else, and never retype a test's title. Never edit `tests/fixtures/findings/fateRunRepo.ts` or `findingRunRepo.ts`. Read `src/app/findingFix.ts`, `resolveFindingRun` in `src/app/findingList.ts`, `src/app/findingFateRecords.ts` and `src/cli/definitions/finding.ts`, and follow the patterns phase-05 set.
- Create `src/app/findingSettle.ts`, exporting `dismissFindings(input: { ref; operands; why; by: string | undefined; nowIso; config })` and `deferFindings(input: { ref; operands; to; why; by: string | undefined; cwd; nowIso; config })`. They require FileSystem, Git and Terminal, never GitHub. Every refusal is a `FindingSettleRefusedError` (`{ message }`) and comes before any write. The steps, in order:
  1. A `--by` starting with `machine:` refuses at once with `only an operator dismisses a finding` (dismiss) or `only an operator defers a finding` (defer).
  2. Every operand after the run must satisfy `isFindingId`, else refuse naming it as not a finding id. At least one id is required, and ids are deduplicated in order.
  3. Resolve the run with `resolveFindingRun`, in any state, live or archived.
  4. `fateRecordDestination(target)`.
  5. `resolveArbiter(by, <the run's repository>)`. Only an operator is possible here. A malformed `--by` refuses.
  6. Read the findings with `listRunFindings`, and refuse naming every unknown id.
  7. For defer only: resolve `to` relative to `cwd` within the checkout `git.repoTopLevel(cwd)`. It must be a blob path in `git.readTree(<that checkout>, "HEAD")`, else refuse with `<to as given> is not a tracked file`. The repository-relative path is what gets recorded.
  Then write one record per id, in order, with `writeFateRecord`:
  - a dismissal: `{ fate: dismissed, verdict: { kind: decided, chosen: dismiss, abandoned: [fix, defer], why, advocate, principles: [], reversibility: cheap, by, at: nowIso, revised: [] } }`. `advocate` is the code-review finding's `suggestion`, or the compliance finding's `message`, or `fix <id>` when that message is blank.
  - a deferral: `{ fate: deferred, to, why, by, at: nowIso }`.
  If any id was not recorded, fail with `FindingFateNotRecordedError` (`commit: null`). Its message names the ids recorded and not recorded and why, and says that running the same command again for the rest records them. The answer has phase-05's shape, with `commit: null`.
- In `src/cli/definitions/finding.ts`, add `dismiss` and `defer` to `findingGroup`:
  - args: `ShortNameArg` with a rest of strings, as `fix` declares them;
  - flags: `why`, a required non-empty string; `to`, a required non-empty string on `defer`; `by`, optional;
  - `prompts` and `unprompted` as on `fix`;
  - the output schema phase-05 named, shared, not copied;
  - exits as `fix` declares them, with `FindingSettleRefusedError` 1 in place of `FindingFixRefusedError`;
  - texts `✗ dismiss refused: <message>` and `✗ defer refused: <message>`.
  The render prints `✓ recorded <id> dismissed on phax/records/v1 (by <name>)` and `✓ recorded <id> deferred → <to> on phax/records/v1`, one line per id. Write short help: what each records, that only an operator may run them, that they run on any run whose records exist, archived included, and that they push nothing and call no GitHub. Give examples taken from spec §6.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit what they change. Add `finding dismiss` and `finding defer`, proved by `tests/integration/findingSettle.test.ts`, to `tests/integration/everyCommandJson.test.ts`, and both to the list of `tests/integration/usageSpecDeclarations.test.ts`.
- In-phase tests:
  - Extend `tests/unit/cli/findingFate.test.ts` with the text a dismiss and a defer answer render.
  - Create `tests/integration/findingSettleRuns.test.ts`, with the fixtures, imported and never edited, and the runner. It covers:
    - an archived run, its folder moved under its archive path and its registry entry archived as `tests/integration/findingListSources.test.ts` does, dismissed and then listed `dismissed`;
    - a compliance finding's dismissal, whose `advocate` is its message;
    - `--to` given relative from a subdirectory of the checkout, recorded as the repository-relative path;
    - an operand that is not a finding id, refused naming it;
    - a dedicated records destination whose clone is missing, refused naming `phax records sync`;
    - a malformed `--by`, refused with exit 1.

### Planned files to create

- `src/app/findingSettle.ts`
- `tests/integration/findingSettleRuns.test.ts`

### Planned files to edit

- `src/cli/definitions/finding.ts`
- `tests/integration/findingSettle.test.ts`
- `tests/unit/cli/findingFate.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `tests/integration/usageSpecDeclarations.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/findingFix.ts`
- `src/app/findingList.ts`
- `src/app/findingFateRecords.ts`
- `src/domain/findings/fixCall.ts`
- `src/cli/definitions/shared.ts`
- `docs/cli/inventory.md`
- `knip.json`
- `tests/unit/commandLibrary/commander/catalogue.test.ts`

### Boundary contracts

The CLI layer calls one use case per command, `dismissFindings` or `deferFindings` in `src/app/findingSettle.ts`, and renders its answer. It holds no business logic. The use cases reuse `resolveFindingRun`, `listRunFindings`, `fateRecordDestination`, `writeFateRecord`, `resolveArbiter` and `isFindingId`, and the Git port's `repoTopLevel` and `readTree` for the pointer. They reach no GitHub port and push nothing. Stable contract toward the acceptance tests:
- the calls `finding dismiss|defer <run> <id>… --why … [--to …] [--by operator]`;
- exit 0, or 1 for a refusal and for a fate not recorded;
- one record per id, with the dismissal's verdict values as decided.

### Test strategy

- an archived run's finding can be dismissed and lists dismissed — medium · example · the list answer after the dismissal of a run whose folder moved under its archive path · in-phase
- a compliance finding's dismissal advocates with its message — medium · example · the decoded record.json's verdict.advocate · in-phase
- a pointer given relative to a subdirectory is recorded as the repository-relative path of a file tracked at HEAD — medium · example · the history entry's to · in-phase
- an operand that is not a finding id, a malformed --by and a missing records clone are refused before any record — medium · example · the exit code, the stderr text and the records branch head · in-phase
- dismiss and defer answers render one recorded line per id — small · example · the expected text lines · in-phase
- the usage spec, the CLI reference and the every-command JSON table hold phax finding dismiss and defer as generated — small · example · the usage, CLI-reference and every-command drift tests · in-phase

### Implementation order

1. dismissFindings and deferFindings with their refusals
2. the two commands, their renders, exits and help
3. gen:usage-spec, docs:cli and the cross-command tables
4. remove the acceptance markers
5. the in-phase tests

### Excluded scope

- Posting a fate comment, pushing, or any GitHub call (plan 3).
- Accepting a machine for dismiss or defer.
- Editing the fixtures `tests/fixtures/findings/fateRunRepo.ts` and `findingRunRepo.ts`, or anything but the markers in `tests/integration/findingSettle.test.ts`.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-06's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give the signatures of `dismissFindings` and `deferFindings`, their failure tags with exit codes, and the exact refusal wordings, including the two operator-only sentences. Say how the pointer is resolved and checked. Confirm that only the `.fails` markers changed in the acceptance test file, that the fixtures are unchanged, and that the usage spec and CLI reference were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): add phax finding dismiss and defer`

### Commit body

phax finding dismiss <run> <id>… --why records each finding dismissed as
a decided verdict that chooses dismiss and abandons fix and defer, with
the finding's suggestion as the case for fixing it; phax finding defer
<run> <id>… --to <path> --why records it deferred to a file tracked at
HEAD. Only an operator settles a finding without fixing it; both run on
any run whose records exist, archived runs and unrecorded findings
included, refuse before any write, push nothing and never call GitHub.
The acceptance tests of the previous commit pass.

---

## phase-08 — Docs: fixing, dismissing and deferring findings {#phase-08-fates-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator with a `review_open` run can read on `docs/findings.md` how to settle its findings:
- fix them with `phax finding fix`, and record an earlier commit with `--commit`;
- dismiss or defer them;
- see their fates and details in `phax finding list`.
The page says what a fate record is and that this release posts nothing to the pull request. The README and the upgrading notes name the new commands and format.

### Detailed instructions

- Read spec §3, §4, §6 and §11, the Technical arbitrations, and the handoffs of phases 01 to 07. Use the exact command output, refusal wordings and help phases 05 and 07 produced, and the example run `gate-retry`.
- Edit `docs/findings.md`:
  - Fates: replace the sentence saying fixing, dismissing and deferring come in a later release. Each fate is set by a command as a fate record. The latest record decides, and every record stays in the history.
  - Fixing a finding: change the files, then `phax finding fix gate-retry F2 -- tests/gate.test.ts`. Cover:
    - only while the run is `review_open`, in its final worktree;
    - exactly the named paths committed, other changes left in place;
    - paths resolved from the current directory inside the worktree, else from its root;
    - the default subject, `-m` and `--body`;
    - the `Short-Name` and `Finding` trailers, and no `Run-Id`;
    - who fixed it (`--by operator`, `--by machine:<grant>`, required without a terminal);
    - the path classes table: the rule of phase-01, in order, with an example.
  - Recording an earlier commit: `--commit <sha>` for an `unrecorded` finding fixed before ids existed, and as the retry printed when a record fails. Say which commits it accepts and that it runs on any run whose records exist.
  - Dismissing and deferring: the §11 examples. Only an operator, a required reason, and a pointer tracked at HEAD. Both run on any run whose records exist, archived runs and `unrecorded` findings included.
  - Listing fates: update the text example to show a fixed, a dismissed and a deferred finding with their detail lines as the command now prints them, and the `--json` example with a non-empty `history`.
  - Fate records: a new section. The key `<runId>/finding/<id>/<NN>` on `phax/records/v1`, one commit per record, the `finding-fate-record-manifest` format, and that records must be on (the refusals). Fate commands push nothing and call no GitHub, whatever `publish.auto` says. Their records reach the remote with the run's publish. The pull request's findings section and comments come in a later release; say so in one sentence.
  - Exit codes: 0, 1 for a refusal or a fate not recorded, 2 for a configuration error, and 64 for a refused call.
  Keep the page concrete and the sections short.
- README.md: next to the `phax finding list <run>` line, add one line each for `phax finding fix <run> <id>… -- <path>…`, `phax finding dismiss <run> <id>… --why …` and `phax finding defer <run> <id>… --to <path> --why …`, each pointing to docs/findings.md. Check that phase-02 added the `finding-fate-record-manifest` row to `## Persisted formats`.
- docs/upgrading.md: in the `### 0.40.0` section, add bullets:
  - `phax finding fix`, `dismiss` and `defer` record fates as `finding-fate-record-manifest` records on `phax/records/v1`, keyed `<runId>/finding/<id>/<NN>`, which `phax records list` does not show. An `@lbdremy/phax-schemas` before 0.40.0 cannot read them, and `parseRecordManifest` refuses them: read them with `parseFindingFateRecordManifest`.
  - `finding-list`'s `history` now holds fate records.
  - Fixing commits carry `Finding:` trailers beside `Short-Name`.
  - No step is needed in a repository.

### Planned files to create

- (none)

### Planned files to edit

- `docs/findings.md`
- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `docs/json-output.md`
- `docs/cli/reference.md`
- `phax.usage.kdl`
- `tests/unit/site/pages.test.ts`

### Test strategy

- the findings page still builds on the docs site with its route, and its links resolve — medium · smoke · pnpm site:build at the terminal gate and the site's page tests · in-phase

### Implementation order

1. docs/findings.md
2. README lines
3. upgrading bullets

### Excluded scope

- Any code change.
- The pull request's findings section and fate comments (plan 3), beyond the one sentence saying they come later.

### Verification

The `standard` gate profile in phax.json, including its terminal `pnpm site:build`.

### Expected handoff content

List the sections of `docs/findings.md` as they now stand, and every other doc changed, with one line each. Name the parts plan 3 must extend: the sentence about the pull request, and the fate commands' push and comment behaviour. Explain any deviation from the planned file lists.

### Commit subject

`docs(findings): document fixing, dismissing and deferring findings`

### Commit body

docs/findings.md now shows how to settle a run's findings: phax finding
fix with its named paths, trailers, path classes and --commit for an
earlier commit or a failed record; phax finding dismiss and defer, by an
operator only, on any run whose records exist; the fate records on
phax/records/v1 and how phax finding list shows fates and their details.
The README and the 0.40.0 upgrading notes name the new commands and the
finding-fate-record-manifest format.
