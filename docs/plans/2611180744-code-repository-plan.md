---
status: Approved
source-spec: docs/specs/2611171616-code-repository.md
completes-spec: true
approved:
  date: 2026-11-18
  baseline: 77dbe32
---
# Process and code in two repositories

This is the only plan of the spec code-repository, and it completes the spec. A process repository declares `"code": { "root": "code" }` in its phax.json, naming the directory where its code repository is checked out and ignored. phax then judges every plan of that project against the code. An approval records the code repository's HEAD as the code baseline, in the approval record file and in the frontmatter stamp. `ground-changed` diffs the plan's footprint in the code repository since that baseline. `phax run --plan ../docs/plans/<plan>.md`, started in the code repository, gates the plan as the process repository's artifact. At review it prints the `phax artifact complete` command instead of completing anything. The pull request names nothing of the process repository, and `phax plans lint` checks planned files against the code. A project with no link behaves as before. The one change it sees is that its new plan approval records carry `"code": null` under the newer `plan-approval-record` stamp.

The plan works from the core out to the surface. phase-01 adds the config link and its refusals. phase-02 gives the approval record its required `code` key and the history reader for older records. phase-03 makes the approval record the code baseline. phase-04 and phase-05 form the first acceptance pair, for staleness under the link. phase-06 and phase-07 form the second, for the linked run. phase-08 covers the pull request, phase-09 `plans lint`, and phase-10 the docs.

Stamps are never written from the spec's examples. The `plan-approval-record` format moves to the opened version through a `next` snapshot that `scripts/schemas-check.ts --write` creates. Tests read stamps from `CURRENT_STAMPS`, `currentSchemaUrl` and `schemaUrl(<id>, <released version>)`. No test names the opened version or a `next` shape literally, except behaviour-corpus cases.

Another run (finding-ids-and-the-findings-list) lands before this one. It adds formats to `src/schemas/persisted.ts`, `src/schemas/schemaUrl.ts`, the schemas package and `tests/helpers/property/formatRegistry.ts`. Expect these files to have grown. Append to their registries, and never reorder or rewrite their existing entries.

Tests build both repositories as temporary git repositories: a process repository, with the code repository checked out at `code/` inside it. They stub HOME to a temporary directory and use `tests/helpers/isolateGit.ts`, so no test reads a real `~/.phax`, a credential store or the global git config. Commands are called in-process through `phaxCall`/`runnerCall`, each with its own temporary repository as its working directory.

Criteria by phase:
- phase-01: ac-link-accepted, ac-link-overlay-rejected, and the `phax validate` halves of ac-root-not-repo and ac-root-not-ignored.
- phase-02: ac-approve-unlinked and the reader half of ac-older-record-read.
- phase-03: ac-approve-records-code and the approve half of ac-root-not-repo.
- phase-04 (acceptance), passed by phase-05: ac-code-change-stale, ac-process-change-not-ground, ac-code-baseline-gone, ac-prelink-record, ac-unlinked-code-record, and the `plans status` half of ac-root-not-ignored.
- phase-05 (in-phase): ac-code-change-outside-footprint, ac-self-and-spec, and the status half of ac-older-record-read.
- phase-06 (acceptance), passed by phase-07: ac-run-refuses-stale, ac-run-refuses-unrecorded and ac-run-review-no-complete.
- phase-07 (in-phase): ac-loose-unchanged and ac-trailers.
- phase-08: ac-pr-names-nothing.
- phase-09: ac-lint-files.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm test:property:deep`

Each of these commands already matches an entry of `security.agentCommands` in phax.json, so the security configuration needs no change. `pnpm exec tsx` runs `scripts/schemas-check.ts`: first with `--write`, to create the `next` snapshot and the generated stamp files, then without it, to check them. It also regenerates `phax.schema.json` from `getPhaxConfigJsonSchema()`. `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate the usage spec and the CLI reference in each phase that changes a command's help or adds a config key. `pnpm test:property:deep <file>` runs the persisted-formats property file once, at depth, before handing off the changed format.

## Technical arbitrations

- Spellings (§10 left them open). The link is `"code": { "root": "<dir>" }` in the process repository's project phax.json, and only there: `code` joins the project-only keys, so an overlay that carries it is refused with `"code" is accepted only in phax.json`, naming the overlay file. `code.root` is written in canonical form: relative, `/`-separated, no empty, `.` or `..` segment, no leading or trailing `/`, and never the repository root itself. The approval record's key is `"code": { "root": <dir>, "baseline": <40-hex sha> } | null`, written after `baseline`. The frontmatter stamp's key is `approved.code: <7-char short sha>`, written only on a linked approval. The record's `root` is informational; verdicts use the link's root. Loss accepted: `code` is a generic word in a config file that may later want other code-related keys. The spec's indicative spelling wins over a longer `codeRepository`.
- Link checks and exit codes (§10 left the codes open). The checks of the key's place and shape run at config load: the overlay refusal, a root that is absolute or leaves the tree, or a root not in canonical form. Each is a `ConfigValidationError`. The checks against the repository run in `resolveCodeLink` (`src/app/codeLink.ts`), through the Git and FileSystem ports: the root is missing, is not the top level of a git repository (a symlink resolves elsewhere, so it is refused here too), or is not ignored by the process repository. Each of these is also a `ConfigValidationError`, with `path` the process phax.json and a message starting `code.root "<root>": `. Its reasons are `does not exist`, `not the top level of a git repository` and `not ignored by this repository — add /<root>/ to .gitignore`. Every command that uses the link refuses with the code it already gives a configuration error: `phax validate` and `phax run` exit 2, and `artifact approve` and `plans lint` keep theirs. `phax plans status` is a report, so it reports the reason as an error entry for each Approved plan, as §8 says, and exits 0. No new exit code. Loss accepted: a script cannot tell a link failure from any other configuration error by exit code alone, only by the message.
- How a linked run finds the process repository (§10 left it open). `resolvePlanLink` (`src/app/planLink.ts`) starts from the plan's absolute path and the run's repository root. A plan inside the run's repository is not linked. Otherwise phax takes the plan's own repository: its git top level, through the Git port. The plan's path relative to that root must classify as a plan (docs/plans/...). The root phax.json must declare `code`. The declared root, asked for its git top level, must be exactly the run's repository root. When all of this holds, the run is linked and its process repository is the plan's repository. When the plan's repository declares no `code`, or its link names another repository, the plan stays loose, exactly as today and with no warning (ac-loose-unchanged). Refusals: a process phax.json that declares `code` but does not decode, or that is not a JSON object, and a link that names this repository but is not ignored by the process repository. Each refuses with exit 2. Of the process repository's config phax reads only `code`: none of its commands, gates or providers is applied. Loss accepted: the same code checked out at another path (a second clone, or a worktree outside the process repository) runs loose, without the gate.
- Where the link is known after the run starts. run-status.json keeps recording the plan path as it does today (`../docs/plans/<plan>.md`), so no persisted run format changes. The review step (`phax run`, `phax resume`) and the publish step derive the link again from that recorded path with `resolvePlanLink`. When the recorded path leaves the repository and the link cannot be read, publish fails closed: the footer omits Plan and Spec. Loss accepted: a process repository that moved or changed its link between the run's start and its publish is judged as it stands at publish.
- `phax plans status --json` (§10 left it open). The ground-changed evidence of a linked plan gains `codeRoot`: an explicit second variant `{ reason: "ground-changed", baseline, files, codeRoot }`, where `baseline` is the code baseline and `files` are relative to the code root. An unlinked plan's evidence keeps today's three keys. The text reads `ground-changed: <files> changed in <root>/ since baseline <sha>`. The same wording goes into the `phax run` refusal. Loss accepted: a JSON reader meets two shapes for one reason. The alternative, keeping today's shape, leaves a script unable to tell which repository `baseline` and `files` belong to without reading the config.
- What a linked run prints at review (§5.14). The `review_open` answer of a linked run carries the plan's process-repository path. The text then says `The plan lives in the process repository: once merged, run there` and `  phax artifact complete <plan path>`. An unlinked run's answer and text stay byte for byte as today. Loss accepted: completion stays a manual step (q-run-lifecycle).
- Missing-record verdicts under the link are checked in this order, after today's two (no record, and a vanished process baseline). A linked project's record with `code: null`, written so or read so from an older version, gives `approved without a code baseline — the project now links <root>/`. An unlinked project's record with a non-null `code` gives `the approval recorded code baseline <sha> but the project declares no code link`. A code baseline missing from the code repository gives `the recorded code baseline <sha> no longer exists in <root>/`. Each message names the full sha. Self-changed and spec-changed are judged in the process repository as today. Ground under the link is only the code repository's diff.
- Acceptance pairs. Two pairs freeze the surfaces whose behaviour changes: staleness in `plans status` (phase-04, passed by phase-05) and the linked run (phase-06, passed by phase-07). A criterion whose test already passes before its code exists cannot be an acceptance test, because its expected-failure marker would fail. These criteria are proven in-phase: ac-code-change-outside-footprint, ac-self-and-spec, ac-older-record-read, ac-loose-unchanged and ac-trailers. The config, record and approval criteria are proven in-phase in phases 01 to 03, because the acceptance fixtures build on them. ac-pr-names-nothing and ac-lint-files are in-phase in phases 08 and 09. Loss accepted: those criteria are not frozen before their code is written.

---

## phase-01 — The code link in phax.json and its refusals {#phase-01-code-link}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A process repository can declare `"code": { "root": "code" }` in its phax.json. phax validate accepts a well-formed link, refuses one declared in an overlay or naming a path outside the tree, and refuses a code root that is missing, is not a git repository's top level, or is not ignored. Each refusal names the file and the field.

### Detailed instructions

- Read the Technical arbitrations (spellings, link checks and exit codes). Read `src/app/loadConfig.ts` (`PROJECT_ONLY_KEYS`, `readUserOverlay`, `validateWorkspacePaths`), `src/domain/config/mergeLayers.ts` (how `records` and `assignments` stay project-only), `src/schemas/phaxConfig.ts`, `src/cli/definitions/validate.ts`, the Git port `src/ports/git.ts`, its adapter `src/infra/git.ts` and fake `src/infra/fakes/git.ts`, and `tests/integration/gitRecordsBranchContract.test.ts` (a contract suite run against the fake and the real adapter).
- Config schema. In `src/schemas/phaxConfig.ts`, add `CodeLinkConfigSchema = Schema.Struct({ root: Schema.NonEmptyString })` and `code: Schema.optional(CodeLinkConfigSchema)` to `PhaxConfigSchema` (never to `PhaxUserOverlaySchema`). Give it an `annotateKey` description: the directory, relative to this repository's root, where the code repository is checked out and ignored; phax judges plans against it; accepted in phax.json only. Add `readonly code?: { readonly root: string }` to `ResolvedConfig`, documented 'From phax.json alone', like `assignments`.
- Domain checks. Create `src/domain/config/codeLink.ts`, which is pure. Export:
    - `codeRootProblem(root: string): string | null`, a refusal reason for a root that is absolute, has an empty, `.` or `..` segment, has a leading or trailing `/`, contains a backslash, or is `.`. Use `must be a relative path inside this repository` for a root that is absolute or leaves the tree, and `must be written <canonical>` when only the spelling differs and a canonical spelling exists.
    - `codeRootMessage(root: string, reason: string)`, which returns `code.root "<root>": <reason>`.
    - The reason strings `CODE_ROOT_MISSING = "does not exist"` and `CODE_ROOT_NOT_TOP_LEVEL = "not the top level of a git repository"`, and `codeRootNotIgnored(root)`, which returns `not ignored by this repository — add /<root>/ to .gitignore`.
    Export only what this phase uses (knip).
- loadConfig. Append `"code"` to `PROJECT_ONLY_KEYS`, so an overlay carrying it is refused with today's sentence `"code" is accepted only in phax.json`, whose `path` is the overlay file. After the project decode, refuse a `code.root` for which `codeRootProblem` returns a reason, with a `ConfigValidationError` whose message is `codeRootMessage(root, reason)` and whose `path` is the phax.json path. Put `code` on the `ResolvedConfig` only when phax.json declares it. In `mergeConfigLayers`, carry `project.code` through unchanged, as `records` is.
- Git port. Add two operations to `GitOps` in `src/ports/git.ts`, each with a doc comment:
    - `repoTopLevel(path: string): Effect<string | null, GitError>`: the top level of the working tree holding the existing directory `path` (`git rev-parse --show-toplevel` run there), or null when `path` does not exist or is in no repository.
    - `isIgnored(repo: string, path: string): Effect<boolean, GitError>`: whether `repo` ignores the directory `path`, relative to `repo` (`git check-ignore -q --no-index -- <path>/`, where exit 1 means not ignored).
    Implement both in `src/infra/git.ts` with the existing `gitRunAllowFail` helpers. Implement them in `src/infra/fakes/git.ts` with recorded calls and setters (`setRepoTopLevel(path, top | null)`, `setIgnored(repo, path, boolean)`); an unset path answers null or false.
- Contract suite. Create `tests/integration/gitCodeLinkContract.test.ts`, modelled on `gitRecordsBranchContract.test.ts`. One suite runs against the real adapter, on temporary repositories under `isolateGit()`, and against the fake set up to the same facts. Cases: the top level of a repository's root and of its subdirectory; a nested repository's own top level; a missing path gives null; a plain directory outside any repository gives null; a directory ignored by `/code/` and by `code/`; one that is not ignored.
- Use case. Create `src/app/codeLink.ts`. Export `CodeLink = { readonly root: string; readonly path: string }`, where `path` is absolute (`join(config.repoRoot, root)`). Also export `resolveCodeLink(config: ResolvedConfig): Effect<CodeLink | null, ConfigValidationError | GitError | FsError, Git | FileSystem>`. It answers null without `config.code`. Otherwise it refuses with `ConfigValidationError({ message: codeRootMessage(root, reason), path: <phax.json path> })`, in this order:
    - the root does not exist (FileSystem `exists`);
    - `git.repoTopLevel(path)` is not exactly `path`. This covers a plain directory, a subdirectory of the process repository or of another repository, and a symlink to a repository elsewhere;
    - `git.isIgnored(config.repoRoot, root)` is false.
    Find the phax.json path the way `describeConfigSources` does, or carry it on the config, whichever the compiler and knip accept with the smaller change. Put no node:fs or child_process call in it.
- validate. After the bounds check, `phax validate` runs `resolveCodeLink(config)` with the repo-rooted FileSystem layer and `makeNodeGitLayer()`. A refusal becomes `ConfigInvalidError({ message, path })`, so it exits 2 with today's `Config validation failed: <message>\n  at: <path>` text. On success `ValidateOutput` is unchanged: no field and no line is added, so an unlinked project's output stays byte for byte as today. Extend the help text by one paragraph: the code link (`code.root`), accepted only in phax.json, and the three checks. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Editor schemas. Regenerate `phax.schema.json` from `getPhaxConfigJsonSchema()` with `pnpm exec tsx -e` (JSON.stringify, two-space indent, trailing newline), then let `pnpm format` format it. `phax.user.schema.json` must not change. `tests/unit/phaxConfigJsonSchema.test.ts` compares the generated schema with the 0.35.0 contract fixture. Make that comparison drop the generated `properties.code` by name before comparing, with a one-line comment naming spec code-repository. Never edit `tests/fixtures/editorSchemas/0.35.0/`.
- Tests:
    - `tests/unit/config/codeLink.test.ts`: a table of roots and their `codeRootProblem` verdicts (`code`, `deps/code`, `/abs`, `../elsewhere`, `code/..`, `./code`, `code/`, `.`, `a\\b`, empty).
    - `tests/integration/codeLinkConfig.test.ts`. A process repository is built in a temporary directory, with HOME stubbed to a temporary directory and `isolateGit()`, holding a git repository at `code/` and `/code/` in its `.gitignore`. Each case calls `phaxCall(["validate"])` with the process repository as the working directory:
      - ac-link-accepted: exit 0, and stdout starts with `✓ config is valid`.
      - ac-link-overlay-rejected: a phax.local.json declaring `code` exits 2, naming `phax.local.json` and `code`. Separately, a phax.json whose `code.root` is `../elsewhere` exits 2, naming `phax.json` and `code.root`. An absolute root is refused the same way.
      - ac-root-not-repo (validate half): `code/` missing, `code/` a plain directory, and `code/` a subdirectory of another repository (a nested directory under `code/` that is itself the repository, with `code.root` naming the subdirectory) each exit 2, naming `code.root "code"` and the reason.
      - ac-root-not-ignored (validate half): with `/code/` absent from `.gitignore`, exit 2 naming `code.root` and saying `add /code/ to .gitignore`.
      - A repository with no link gives exactly today's stdout.

### Planned files to create

- `src/domain/config/codeLink.ts`
- `src/app/codeLink.ts`
- `tests/unit/config/codeLink.test.ts`
- `tests/integration/codeLinkConfig.test.ts`
- `tests/integration/gitCodeLinkContract.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/cli/definitions/validate.ts`
- `phax.schema.json`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `tests/unit/loadConfig.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `knip.json`

### Boundary contracts

Producer: `src/app/codeLink.ts` (`resolveCodeLink`, `CodeLink`) over the Git port's new `repoTopLevel` and `isIgnored`, and `src/domain/config/codeLink.ts` (the reason sentences). Consumers: `phax validate` now, and the approval (phase-03), staleness (phase-05), the linked run (phase-07) and plans lint (phase-09) later. Contract: `resolveCodeLink` answers null for an unlinked project. For a linked one it answers `{ root, path }` only when the root exists, is exactly a repository's top level and is ignored by the process repository. Otherwise it refuses with a `ConfigValidationError` whose message starts `code.root "<root>": ` and whose path is the process phax.json.

### Test strategy

- a declared, ignored code root that is a repository's top level passes phax validate with today's output — medium · example · exit 0 and stdout starting with the config-valid line · in-phase · ac-link-accepted
- code in phax.local.json, and a code.root of ../elsewhere or an absolute path, are refused naming the file and the field — medium · example · exit 2 and the refusal text naming phax.local.json and code, or phax.json and code.root · in-phase · ac-link-overlay-rejected
- a missing code root, a plain directory and a subdirectory of another repository are each refused by phax validate with the reason — medium · example · exit 2 and the reason sentence after code.root "code" · in-phase · ac-root-not-repo
- a code root the process repository does not ignore is refused by phax validate, telling the operator to ignore it — medium · example · exit 2 and the text naming code.root and add /code/ to .gitignore · in-phase · ac-root-not-ignored
- every spelling of code.root is accepted only in canonical relative form inside the tree — small · table · hand-written roots and their expected refusal reason or null · in-phase
- the fake and the real git adapter agree on a path's repository top level and on whether a directory is ignored — medium · contract · one shared suite run against both adapters · in-phase
- an unlinked project's phax validate output is unchanged — medium · example · stdout against today's lines for the same config · in-phase

### Implementation order

1. the config schema and ResolvedConfig field
2. src/domain/config/codeLink.ts and its table test
3. loadConfig and mergeConfigLayers
4. the Git port operations, adapter, fake and contract suite
5. src/app/codeLink.ts
6. phax validate, its help, gen:usage-spec and docs:cli
7. phax.schema.json and the editor-schema test
8. the validate integration tests

### Excluded scope

- Any command other than phax validate using the link (phases 03, 05, 07, 09).
- The approval record's code key (phase-02).
- A field or line in phax validate's answer that reports the link.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exports of `src/domain/config/codeLink.ts` and `src/app/codeLink.ts` with their signatures, the exact reason sentences, the two new Git port operations and the fake's setters. Say where the phax.json path for a refusal comes from. Confirm that `phax.user.schema.json` did not change, that the usage spec and CLI reference were regenerated, and how the 0.35.0 contract test now drops `code`. Explain any deviation from the planned file lists.

### Commit subject

`feat(config): declare a code repository with code.root in phax.json`

### Commit body

A process repository can name, in its phax.json only, the directory where
its code repository is checked out: "code": { "root": "code" }. phax
validate refuses the key in an overlay, a root that is absolute or leaves
the tree, and a root that is missing, is not a repository's top level or
is not ignored, naming the file and code.root. The Git port gains
repoTopLevel and isIgnored, with a contract suite run against the fake and
the real adapter.

---

## phase-02 — The plan approval record carries a required code key {#phase-02-approval-record-code}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The `plan-approval-record` format moves to the opened version with a required `code` key: `{ root, baseline }` or `null`. Every new plan approval records `"code": null` for now. Records stamped 0.25.0 or 0.19.0 stay readable through frozen decoders as `code: null` and are never rewritten. The schemas package reads every shape.

### Detailed instructions

- Read the Technical arbitrations (spellings). Read `src/schemas/approvalRecord.ts`, `src/schemas/history/plan-approval-record/0.19.0.ts`, and `readPlanRecordFile` in `src/schemas/persisted.ts`. Also read how `readCodeReviewFile` there routes one frozen decoder per stamp range (it does so since the finding-ids run), `src/app/approvalRecordStore.ts`, `src/app/migrateApprovals.ts`, `packages/schemas/src/formats/repository.ts`, `docs/property-tests.md` (frozen shapes) and the `plan-approval-record` entries of `tests/helpers/property/formatRegistry.ts`.
- Freeze the current shape first. Create `src/schemas/history/plan-approval-record/0.25.0.ts`, modelled on the 0.19.0 module. It is self-contained and imports only `effect`, with its own `SchemaUrlSchema`, source-spec binding and a local copy of the approver schema. Its fields are `$schema`, `artifact`, `planFingerprint`, `approvedAt`, `baseline` (40-hex), `sourceSpec` and `approvedBy`. It renders exactly as `packages/schemas/snapshots/plan-approval-record/0.25.0.schema.json`. Export `PlanApprovalRecordV0_25_0Schema`, `PlanApprovalRecordV0_25_0` and `decodePlanApprovalRecordV0_25_0` (`onExcessProperty: "error"`, `reportInput: true`). Its header says it is the shape phax 0.25.0 through 0.39.x wrote, and that it must never be edited because `packages/schemas/history.lock.json` pins its bytes.
- New shape. In `src/schemas/approvalRecord.ts`, export `CodeBaselineSchema = Schema.Struct({ root: Schema.NonEmptyString, baseline: Schema.NonEmptyString.check(isExportedPattern(/^[0-9a-f]{40}$/)) })` and its type `CodeBaseline`. Write `planRecordFields` out explicitly in this order: `artifact`, `planFingerprint`, `approvedAt`, `baseline`, `code: Schema.NullOr(CodeBaselineSchema)`, `sourceSpec`, `approvedBy`. Leave `ApprovalRecordSchema` (the old ledger's entry) and `ApprovalRecordFileSchema` unchanged. Update the doc comments of `PlanRecord` and `PlanRecordFileSchema`.
- Reader. `readPlanRecordFile` routes by stamp:
    - below 0.25.0: the frozen 0.19.0 decoder, giving `approvedBy: { kind: "unattributed" }` and `code: null`;
    - from 0.25.0 up to, but not including, the current stamp: the frozen 0.25.0 decoder, giving `code: null`;
    - the current stamp: the current decoder, which refuses a record without `code`.
    Update the reader's comment. A read never rewrites the file.
- Writers. `putPlanApprovalRecord(planPath, record: ApprovalRecord, code: CodeBaseline | null, approvedBy)` writes `{ artifact, ...record, code, approvedBy }`. `renderPlanRecordFile` keeps the key order above. In `src/app/artifactStatus.ts`, the plan approval passes `code: null` in this phase. In `src/app/migrateApprovals.ts`, every record split from the old ledger is written with `code: null`. Fix any other writer the compiler names the same way.
- Schemas package. In `packages/schemas/src/formats/repository.ts`, add the 0.25.0 frozen shape as a release of `planApprovalRecordFormat`, after 0.19.0. Extend `PlanApprovalRecordShapes` with `"0.25.0"`. `toLatestPlanApprovalRecord` gives `code: null` for both older shapes, and `approvedBy: unattributed` for 0.19.0. Its doc comment says why: no record before this release ever had a code baseline. Update the exports in `packages/schemas/src/index.ts` (`CodeBaselineSchema`, `CodeBaseline` if the package exposes record schemas).
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/plan-approval-record/next.schema.json`, moves `CURRENT_STAMPS["plan-approval-record"]` in `src/schemas/release.ts` to the opened version, and updates `packages/schemas/src/generated/index.ts`, `packages/schemas/shipped-json.json` and `packages/schemas/history.lock.json`. Then run it without the flag and make it pass. Never edit the generated files by hand.
- Corpus and property registry. In `tests/behaviourCorpus/cases/formats/plan-approval-record.json`, add current-shape documents with `code: null` and with `code: { root, baseline }`. Add refusals for a missing `code`, a `code.baseline` that is not 40-hex, an empty `code.root`, and an unknown key inside `code`. Keep a document stamped 0.25.0 and one stamped 0.19.0, each read as its frozen shape. Update the `encode/plan-approval-record.json` case to write `code`. In `tests/helpers/property/formatRegistry.ts`, make the frozen list `[shape("0.19.0", …), shape("0.25.0", PlanApprovalRecordV0_25_0Schema)]`, appended and never reordered. Run `pnpm test:property:deep tests/unit/property/persistedFormats.property.test.ts` once and record the seed and the result.
- Tests:
    - `tests/unit/persisted.test.ts`: a 0.19.0 record and a 0.25.0 record each read with `code: null` (and `unattributed` for 0.19.0); a current-stamp record without `code` is refused, naming `code`; a current record with a code baseline round-trips.
    - `tests/unit/schemas/approvalRecordFile.test.ts`: the rendered key order.
    - `tests/integration/approvalRecordCode.test.ts`, the reader half of ac-older-record-read: the 0.25.0 record `docs/plans/approvals/2611171555-finding-ids-and-fates-plan.json`, copied into a temporary repository, reads through `readPlanApprovalRecord` with `code: null`, and its bytes are unchanged afterwards.
    - The same file covers ac-approve-unlinked: in a temporary repository with no code link, `phaxCall(["artifact", "approve", <plan>, "--by", "operator"])` writes a record whose `$schema` equals `currentSchemaUrl("plan-approval-record")` and whose `code` is null, every other key as before. The plan's frontmatter `approved` block holds exactly `date` and `baseline`.
    Update the per-format tables a test or the compiler names: `tests/type/schemasPackage.ts`, `tests/unit/schemasPackage/repositoryFormats.test.ts` and `tests/unit/schemasPackage/documents.ts`. Never name the opened version in a test.

### Planned files to create

- `src/schemas/history/plan-approval-record/0.25.0.ts`
- `packages/schemas/snapshots/plan-approval-record/next.schema.json`
- `tests/integration/approvalRecordCode.test.ts`

### Planned files to edit

- `src/schemas/approvalRecord.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/app/approvalRecordStore.ts`
- `src/app/artifactStatus.ts`
- `src/app/migrateApprovals.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/shipped-json.json`
- `packages/schemas/history.lock.json`
- `tests/behaviourCorpus/cases/formats/plan-approval-record.json`
- `tests/behaviourCorpus/cases/encode/plan-approval-record.json`
- `tests/helpers/property/formatRegistry.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemas/approvalRecordFile.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/schemasPackage/documents.ts`

### Optional files that may be edited

- `packages/schemas/build/jsonSchemas.ts`
- `tests/behaviourCorpus/baseline/snapshot-digests.json`
- `tests/behaviourCorpus/subjects.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/integration/approvalAttribution.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/migrateApprovals.test.ts`
- `tests/integration/approvalLedgerRefusal.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/artifact/lineage.test.ts`

### Boundary contracts

Producer: `src/schemas/approvalRecord.ts` (`CodeBaselineSchema`, the record file schema), `readPlanRecordFile` in `src/schemas/persisted.ts`, `putPlanApprovalRecord` in `src/app/approvalRecordStore.ts`, and the schemas package's `parsePlanApprovalRecord` / `toLatestPlanApprovalRecord`. Consumers: the approval (this phase writes null, phase-03 writes the link), staleness (phase-05), and external readers of `docs/plans/approvals/<plan>.json`. Stable shape: `$schema`, `artifact`, `planFingerprint`, `approvedAt`, `baseline`, `code` (null or `{ root, baseline }`), `sourceSpec`, `approvedBy`, with unknown keys refused. Every older record reads as `code: null` and is never rewritten.

### Test strategy

- an unlinked approval writes its record at the current stamp with code null and every other key as before, and the frontmatter stamp keeps exactly date and baseline — medium · example · the record file against currentSchemaUrl and the expected keys, and the plan's approved block · in-phase · ac-approve-unlinked
- a record stamped 0.25.0 or 0.19.0 reads as code null and its file bytes are unchanged by the read — medium · example · readPlanApprovalRecord's value and the file's bytes before and after · in-phase · ac-older-record-read
- a current-stamp record without code is refused naming code, and one with a code baseline round-trips — small · example · the reader's refusal path and decode of encode equal to the input · in-phase
- every plan-approval-record shape, current and frozen, reads its written encoding back and agrees with the schemas package — small · property · the persisted-formats property suite on its fixed seed · in-phase
- the published JSON Schema of plan-approval-record accepts exactly the corpus documents its decoder accepts — small · table · the behaviour corpus cases against the next snapshot and the schemas check · in-phase

### Implementation order

1. the frozen 0.25.0 module
2. CodeBaselineSchema and the record fields
3. the stamp-routed reader
4. putPlanApprovalRecord and its callers
5. the schemas package format
6. schemas-check --write, then the check
7. corpus, property registry and per-format tests
8. approvalRecordCode.test.ts

### Excluded scope

- Writing a non-null code baseline (phase-03).
- Any verdict that reads code (phase-05).
- Migrating or rewriting any stored approval record.
- Spec approval records: they gain no key.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the new exports of `src/schemas/approvalRecord.ts` and of the 0.25.0 module, the new signature of `putPlanApprovalRecord`, and how `readPlanRecordFile` routes each stamp. State `CURRENT_STAMPS["plan-approval-record"]` as `release.ts` now holds it (the opened version, with a `next` snapshot). Give the seed and result of the `pnpm test:property:deep` run. List the tests whose record fixtures gained `code`. Explain any deviation from the planned file lists.

### Commit subject

`feat(approval): give the plan approval record a required code key`

### Commit body

plan-approval-record moves to a new shape with a required code key, null
when the project declares no code link and { root, baseline } once it
does. Every new plan approval writes it, null for now. Records stamped
0.25.0 and 0.19.0 stay readable through frozen decoders as code: null and
are never rewritten. The schemas package reads all three shapes.

---

## phase-03 — Approval records the code baseline {#phase-03-approval-code-baseline}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

In a linked process repository, `phax artifact approve` records the code root and the code repository's HEAD commit as the plan's code baseline, in the approval record's `code` key and as `approved.code` in the frontmatter stamp. When the code link fails its checks, the approval is refused before anything is written.

### Detailed instructions

- Read the Technical arbitrations (spellings, link checks and exit codes), phase-01's and phase-02's handoffs, `src/app/codeLink.ts`, the plan approval branch of `transitionArtifact` in `src/app/artifactStatus.ts`, `stampApproved` in `src/domain/artifact/lineage.ts`, `src/schemas/artifactFrontmatter.ts`, and `src/cli/definitions/artifactTransitions.ts` (the approve definition).
- Frontmatter. In `src/schemas/artifactFrontmatter.ts`, add `PlanApprovedStampSchema = Schema.Struct({ date, baseline, code: Schema.optional(Schema.NonEmptyString) })` and use it as `approved` in both plan frontmatter schemas. Specs keep `ApprovedStampSchema`. `stampApproved(md, dateIso, shortBaseline, shortCode: string | null)` writes `{ date, baseline }` when `shortCode` is null and `{ date, baseline, code }` otherwise. Spec approvals pass null. The fingerprint is unchanged, because `fingerprintSource` already drops `approved`.
- Options. Add a required `codeLink: CodeLink | null` to `TransitionArtifactOptions`. Only a plan's approval reads it. Every caller passes it explicitly: the approve definition passes the resolved link, and every other caller the compiler names passes null (run completion, `applyStalenessReport`, decide, migrations).
- Approval. When `kind === "plan"` and the link is not null, read `git.headCommit(codeLink.path)` before anything is written. Stamp the frontmatter with its first 7 characters, and pass `{ root: codeLink.root, baseline: <full sha> }` to `putPlanApprovalRecord`. When the link is null, write `code: null`, as phase-02 does.
- The approve definition. Before calling the use case, resolve `resolveCodeLink(config)` with the Git and repo-rooted FileSystem layers. A refusal fails the command with the code the definition already gives a `ConfigValidationError`, and its message. Nothing is written or committed, and no approval record exists afterwards. Add one sentence to the approve help: in a project that declares a code link, the approval also records the code repository's HEAD as the code baseline. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Tests in `tests/integration/codeLinkApproval.test.ts`. Build a temporary process repository and a code repository at `code/`, with `/code/` ignored and `"code": { "root": "code" }` declared. Stub HOME and use `isolateGit()`. Run commands with `phaxCall` from the process repository.
    - ac-approve-records-code: a Draft plan whose spec is Approved and recorded (approve the spec first with `phaxCall`), and the code repository at commit C. `artifact approve <plan> --by operator` exits 0. The record file's `$schema` equals `currentSchemaUrl("plan-approval-record")` and its `code` equals `{ root: "code", baseline: C }`. The frontmatter's `approved.code` equals C's first 7 characters, and `approved.baseline` is the process repository's short HEAD.
    - ac-root-not-repo (approve half): for each of `code/` missing, `code/` a plain directory and `code/` a subdirectory of another repository, `artifact approve` fails naming `code.root "code"` and the reason. The plan's status is still Draft, no record file exists, and the process repository's HEAD is unchanged.
    - A spec approval in a linked project writes no `code` key in its stamp.

### Planned files to create

- `tests/integration/codeLinkApproval.test.ts`

### Planned files to edit

- `src/schemas/artifactFrontmatter.ts`
- `src/domain/artifact/lineage.ts`
- `src/app/artifactStatus.ts`
- `src/cli/definitions/artifactTransitions.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/planStaleness.ts`
- `src/app/completeRunArtifacts.ts`
- `src/app/decideArtifact.ts`
- `src/app/migrateDocuments.ts`
- `src/cli/definitions/plansStatus.ts`
- `src/cli/definitions/artifactDecide.ts`
- `docs/cli/inventory.md`
- `tests/unit/artifact/frontmatter.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/approvalAttribution.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/lifecycleCommandsJson.test.ts`

### Boundary contracts

The approve definition (CLI) resolves the link through `resolveCodeLink` and passes it to `transitionArtifact` (app) as `codeLink`. The use case reads the code HEAD through the Git port only. Contract toward later phases and readers: in a linked project, the record's `code` is `{ root, baseline: <40-hex code HEAD> }` and the frontmatter's `approved.code` is its 7-character prefix. In an unlinked project, `code` is null and `approved` has no `code` key. A failing link refuses the approval before any write.

### Test strategy

- approving a plan in a linked project records the code root and the full code HEAD under the current stamp, and the frontmatter stamp carries its short form — medium · example · the record file's $schema and code against currentSchemaUrl and commit C, and approved.code against C's prefix · in-phase · ac-approve-records-code
- a code root that is missing, a plain directory or a subdirectory of another repository refuses the approval with the reason, writing nothing — medium · example · the refusal text, the plan still Draft, no record file and the process HEAD unchanged · in-phase · ac-root-not-repo
- a spec approval in a linked project stamps no code key — medium · example · the spec's approved block · in-phase
- stampApproved writes the code key only when given one and leaves every other byte as it was — small · example · the stamped Markdown against expected text · in-phase

### Implementation order

1. PlanApprovedStampSchema and stampApproved
2. the codeLink option and its callers
3. the plan approval's code baseline
4. the approve definition, its help, gen:usage-spec and docs:cli
5. codeLinkApproval.test.ts

### Excluded scope

- Any staleness verdict that reads the code baseline (phase-05).
- Uncommitted changes in the code checkout: the baseline is HEAD.
- A code baseline for spec approvals.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the new `stampApproved` signature, the `codeLink` option and every caller that passes null, and the exact refusal path of the approve definition with its exit code. Give the frontmatter and record file of a linked approval as the test writes them. Explain any deviation from the planned file lists.

### Commit subject

`feat(approval): record the code baseline when approving a linked plan`

### Commit body

In a process repository that declares a code link, phax artifact approve
records the code root and the code repository's HEAD as the plan's code
baseline: in the approval record's code key and as approved.code in the
frontmatter stamp. A code root that is missing, is not a repository's top
level or is not ignored refuses the approval before anything is written.

---

## phase-04 — Acceptance tests of staleness under the code link {#phase-04-staleness-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-05
**Acceptance test files:** `tests/integration/codeLinkStaleness.test.ts`, `tests/fixtures/codeLink/linkedProject.ts`

This phase writes, as frozen acceptance tests through `phax plans status`, what staleness must say in a linked project. A code change in the footprint makes a plan stale. A change in the process repository is not ground. A vanished code baseline, a pre-link approval and a code baseline without a link each give missing-record. A code root that is not ignored makes every Approved plan an error. Each test fails today on its own assertion, and phase-05 passes them.

### Detailed instructions

- Read the Technical arbitrations (link checks, `plans status --json`, missing-record verdicts, acceptance pairs) and the handoffs of phases 01 to 03. Read `src/cli/definitions/plansStatus.ts`, `src/domain/artifact/render.ts`, `tests/helpers/runnerCall.ts` (`phaxCall`), `tests/helpers/planMarkdown.ts` (a plan.md the deterministic parser reads, so no extraction model is called), `tests/helpers/isolateGit.ts` and `tests/integration/helpers/preflightRepo.ts`.
- Write `tests/fixtures/codeLink/linkedProject.ts`, a builder `createLinkedProject(opts?: { link?: boolean; ignored?: boolean })`. In a fresh temporary directory it makes:
    - a process repository holding phax.json (`version: 1`, a `name`, `state.root` set to a temporary directory outside both repositories, records disabled, one gate profile with the step `true`, and `"code": { "root": "code" }` unless `link: false`), plus `.gitignore` holding `/code/` unless `ignored: false`;
    - a code repository at `code/` holding `src/export/csv.ts`, `src/other.ts` and its own phax.json (another `name`, the same kind of state root and gate profile, records disabled, publish off), so later run tests can reuse it;
    - a temporary HOME (`vi.stubEnv("HOME", …)` is left to the caller, or done here and undone by `dispose()`), and git isolated with `isolateGit()`.
    Each repository has its own `user.name`/`user.email` and an initial commit. It returns `{ root, processRepo, codeRepo, stateRoots, dispose }` and these helpers:
    - `writePlan(slug, { edits: string[]; sourceSpec: string | null })`: writes `docs/plans/<stamp>-<slug>-plan.md` with a Draft frontmatter, built by `planMdFor`, whose single phase plans to edit `edits`, and commits it. Use a fixed stamp, never the clock.
    - `writeSpec(slug)`: writes an Approved-ready spec.
    - `approve(path)`: `phaxCall(["artifact", "approve", path, "--by", "operator"])` from the process repository; it throws when the exit is not 0.
    - `commitInCode(path, text)` and `commitInProcess(path, text)`.
    - `dropCodeCommit(sha)`: reset the code repository to the commit's parent, then expire the reflog and `git gc --prune=now`, so `sha` no longer exists.
    - `setLink(root: string | null)`: rewrites and commits the process phax.json.
    - `setIgnored(boolean)`: rewrites and commits `.gitignore`.
    - `plansStatus(flags: string[])`: `phaxCall(["plans", "status", ...flags])` from the process repository, returning `{ code, stdout, stderr, json }`, with `json` parsed under `--json`.
    - `codeHead()`: the code repository's HEAD sha.
    It reads nothing outside its temporary directories and never names the opened version.
- Write `tests/integration/codeLinkStaleness.test.ts`. Every test is its own `it.fails(...)`. It drives only the builder and `phax plans status`, and judges only what the spec states and the arbitrations fix:
    - ac-code-change-stale: a plan editing `src/export/csv.ts` is approved at code commit C. A later code commit changes `code/src/export/csv.ts`. `plans status --json` gives the plan `stale`, with ground-changed evidence whose `files` contain `src/export/csv.ts`, whose `baseline` equals C and whose `codeRoot` equals `code`. The text form holds `src/export/csv.ts changed in code/ since baseline ` followed by C. `plans status --apply` then leaves the plan's frontmatter `status: Stale`.
    - ac-process-change-not-ground: the plan is approved at C. A later process-repository commit adds `src/export/csv.ts` in the process tree. `plans status --json` gives `fresh`.
    - ac-code-baseline-gone: after `dropCodeCommit(C)`, the plan is `missing-record`, and the detail holds C and `code/`. The text holds `re-approve with "phax artifact approve <plan path>"`.
    - ac-prelink-record: two cases. In the first, the project starts with `link: false`, the plan is approved, then `setLink("code")`. In the second, a literal record is written stamped `schemaUrl("plan-approval-record", "0.25.0")` and committed, with `planFingerprint` from `artifactFingerprint` of the plan's Approved text and `baseline` the process HEAD, after hand-setting the plan to Approved. Each gives `missing-record` whose detail contains `without a code baseline`.
    - ac-unlinked-code-record: the plan is approved with the link, then `setLink(null)`. It gives `missing-record` whose detail contains `declares no code link`.
    - ac-root-not-ignored (plans status half): two plans are approved, then `setIgnored(false)`. `plans status --json` exits 0, and each Approved plan's entry is `{ kind: "error" }` with a message containing `not ignored` and `/code/`.
    Plans without a source spec are enough here, except where a case needs one.
- Change no source file. Run the gate and check that each marked test fails on its own assertion, a verdict kind or a message, and never on a missing module, a fixture error or a refused approval. The builder's approvals must succeed today, because phases 01 to 03 are in place.
- Do not write tests for ac-code-change-outside-footprint, ac-self-and-spec or ac-older-record-read here. They already pass today, so phase-05 proves them in-phase.

### Planned files to create

- `tests/fixtures/codeLink/linkedProject.ts`
- `tests/integration/codeLinkStaleness.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-05's `phax plans status` in a linked process repository. Consumer: these acceptance tests, through `phaxCall` with the working directory at the process repository. Contract:
- each Approved plan's verdict is `fresh`, `stale` with evidence, `missing-record` with a detail, or `error` with a message;
- a linked plan's ground-changed evidence is `{ reason, baseline, files, codeRoot }`, where `baseline` is the code baseline and `files` are relative to the code root;
- the text reads `changed in <root>/ since baseline <sha>`;
- `--apply` flips stale and missing-record plans to Stale.

### Test strategy

- a code commit that changes a footprint file after the code baseline makes the plan stale with ground-changed evidence naming the file, the code baseline and the code root, and --apply flips it to Stale — medium · example · the --json verdict, the text line and the plan's frontmatter status after --apply · acceptance · ac-code-change-stale
- a process-repository commit adding a file at a footprint path leaves the linked plan fresh — medium · example · the --json verdict fresh · acceptance · ac-process-change-not-ground
- a code baseline removed by a reset and garbage collection gives missing-record naming the baseline and code/ with the re-approve command — medium · example · the missing-record detail and the text's re-approve line · acceptance · ac-code-baseline-gone
- a plan approved before the link, with a null-code record or a 0.25.0 record, is missing-record saying it was approved without a code baseline — medium · example · the missing-record detail of each case · acceptance · ac-prelink-record
- a record with a code baseline in a project that declares no link is missing-record saying the project declares no code link — medium · example · the missing-record detail · acceptance · ac-unlinked-code-record
- with the code root no longer ignored, plans status reports each Approved plan as an error carrying the not-ignored reason and exits 0 — medium · example · the exit code and each entry's error message · acceptance · ac-root-not-ignored

### Implementation order

1. linkedProject.ts
2. codeLinkStaleness.test.ts with a marker on each test
3. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing staleness under the link (phase-05).
- The criteria that already pass today: ac-code-change-outside-footprint, ac-self-and-spec, ac-older-record-read (phase-05, in-phase).
- Any phax run test (phase-06).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files.

### Expected handoff content

Give what `createLinkedProject` builds and returns, with each helper's signature, including the code repository's phax.json written for later run tests. For each acceptance test, give the assertion it fails on today. Confirm that every test carries its own `.fails` marker, that no test names the opened version, and that no source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(staleness): acceptance tests for staleness under the code link`

### Commit body

Freeze what phax plans status must say in a process repository that links
its code: a footprint change in the code repository makes a plan stale
with the code baseline and code root, a process-repository change is not
ground, and a vanished code baseline, a pre-link approval and a code
baseline without a link are missing-record. A code root no longer ignored
makes every Approved plan an error. Each fails today; the next phase
passes them.

---

## phase-05 — Staleness judged in the code repository {#phase-05-staleness-in-code}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Wherever phax judges staleness, a plan of a linked project is judged against the code. Ground-changed is the code repository's diff since the code baseline, on footprint paths relative to the code root. The new missing-record verdicts cover a vanished code baseline, a pre-link approval and a code baseline without a link. Self-changed and spec-changed stay in the process repository. phase-04's acceptance tests pass.

### Detailed instructions

- Read the Technical arbitrations (link checks, `plans status --json`, missing-record verdicts), phase-04's handoff and its two acceptance test files. In `tests/integration/codeLinkStaleness.test.ts`, remove only the `.fails` markers. Change nothing else in it or in `tests/fixtures/codeLink/linkedProject.ts`, and never retype a test's title.
- Domain. In `src/domain/artifact/lineage.ts`:
    - `ApprovalRecordLike` gains `code: { root: string; baseline: string } | null`.
    - `ComputeStalenessInput` gains `code`, either `{ kind: "unlinked" }` or `{ kind: "linked"; root: string; baselineExists: boolean; changedFilesSinceBaseline: readonly string[] }`, where the linked files are the code repository's.
    - `computeStaleness` keeps today's first two missing-record verdicts. It then adds, in this order:
      - linked with `record.code === null`: `approved without a code baseline — the project now links <root>/`;
      - unlinked with `record.code !== null`: `the approval recorded code baseline <sha> but the project declares no code link`;
      - linked with a code baseline that no longer exists: `the recorded code baseline <sha> no longer exists in <root>/`.
    - Under the link, ground-changed is judged only on the code files against the footprint, and the process repository's diff is never ground. Its evidence is the explicit variant `{ reason: "ground-changed"; baseline: <code sha>; files; codeRoot: <root> }`. Unlinked evidence keeps today's three keys.
    Spec-changed and self-changed are unchanged.
- App. In `src/app/planStaleness.ts`, `computeStalenessForPlan` takes `{ repoRoot, codeLink: CodeLink | null }`. With a link and a record whose code is not null, it asks `git.commitExists(record.code.baseline, codeLink.path)` and `git.changedFilesSince(record.code.baseline, codeLink.path)`, and never diffs the process repository. Without a link it works as today. `computePlanStaleness` and `plansStalenessReport` resolve the link once with `resolveCodeLink`. When it refuses, every Approved plan's entry is `{ kind: "error", message }` with the refusal's message, and the command still exits 0. In `src/cli/definitions/run.ts`, the existing call passes the run repository's own link, resolved with `resolveCodeLink(config)`; a refusal is a configuration refusal with exit 2. phase-07 adds the linked run.
- Rendering. Write one helper that renders a ground-changed evidence line, used by both `src/domain/artifact/render.ts` and `PlanStaleError` in `src/domain/errors.ts`. Linked evidence reads `ground-changed: <files> changed in <root>/ since baseline <sha>`; unlinked evidence keeps today's text.
- `phax plans status`. In `src/cli/definitions/plansStatus.ts`, `Evidence` gains the linked ground-changed variant with `codeRoot`, and today's variant stays. An unlinked project's `--json` stays byte for byte as today. Its help gains one sentence: in a project that declares a code link, ground-changed is judged in the code repository from the approval's code baseline. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- In-phase tests:
    - `tests/unit/artifact/lineage.test.ts`: a table over linked and unlinked inputs crossed with record code null and non-null, code baseline present or gone, footprint hit or miss, and process files changed. Each row has its expected verdict.
    - `tests/unit/artifact/render.test.ts`: both ground-changed lines.
    - `tests/integration/planStaleness.test.ts`, which may build with `tests/fixtures/codeLink/linkedProject.ts` without editing it:
      - ac-code-change-outside-footprint: a code commit changing only `src/other.ts` leaves the plan fresh.
      - ac-self-and-spec: a linked plan approved with its spec, with no code change since, is stale with `self-changed` after its text is edited. Separately, it is stale with `spec-changed` naming the spec after the spec's text is edited.
      - ac-older-record-read (status half): in an unlinked repository, a plan whose record is stamped 0.25.0 keeps the verdict it has before this change (fresh). The record file's bytes are unchanged after `plans status`.
      - An unlinked project's `--json` evidence has exactly `reason`, `baseline` and `files`.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/artifact/lineage.ts`
- `src/domain/artifact/render.ts`
- `src/domain/errors.ts`
- `src/app/planStaleness.ts`
- `src/cli/definitions/plansStatus.ts`
- `src/cli/definitions/run.ts`
- `tests/integration/codeLinkStaleness.test.ts`
- `tests/unit/artifact/lineage.test.ts`
- `tests/unit/artifact/render.test.ts`
- `tests/integration/planStaleness.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/codeLink.ts`
- `docs/cli/inventory.md`
- `tests/integration/lifecycleCommandsJson.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `tests/unit/cli/plansInspectionContracts.test.ts`

### Boundary contracts

Domain (`computeStaleness`) receives the code side as facts: the link's root, whether the code baseline exists, and the code repository's changed files. The app (`computeStalenessForPlan`) gathers those facts through the Git port, from `resolveCodeLink`'s `CodeLink`. Consumers: `phax plans status` (and `--apply`), the `phax run` gate in this phase, and the linked run in phase-07. Stable contract:
- verdicts are `fresh`, `stale` with evidence, or `missing-record` with a detail;
- a linked plan's ground-changed evidence carries `codeRoot`;
- an unlinked plan's verdicts and JSON are as before.

### Test strategy

- a code change only outside the footprint leaves a linked plan fresh — medium · example · the plans status --json verdict fresh · in-phase · ac-code-change-outside-footprint
- editing a linked plan's text gives self-changed, and editing its spec gives spec-changed naming the spec, with no code change — medium · example · the evidence reasons and the spec path of each case · in-phase · ac-self-and-spec
- an unlinked plan whose record is stamped 0.25.0 keeps its verdict, and its record file is byte for byte unchanged by plans status — medium · example · the verdict fresh and the file bytes before and after · in-phase · ac-older-record-read
- every combination of link, record code, code baseline existence, footprint hit and process change gives the verdict the arbitrations fix — small · table · hand-written rows of inputs and expected verdicts · in-phase
- an unlinked project's ground-changed evidence and text are as before — small · example · the evidence keys and the rendered line · in-phase

### Implementation order

1. lineage.ts input, verdicts and its table test
2. the shared ground-changed line
3. computeStalenessForPlan and the report with resolveCodeLink
4. the run's existing call
5. plans status output, help, gen:usage-spec and docs:cli
6. remove the acceptance markers
7. the in-phase tests

### Excluded scope

- The linked run from the code repository (phase-07).
- Staleness in phax resume or phax artifact status: they do not compute it today.
- Judging uncommitted changes at approval.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-04's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give the new `ComputeStalenessInput` and `computeStalenessForPlan` signatures, each missing-record detail sentence, the shared ground-changed line helper and its module, and the `plans status --json` evidence variants. Say how `run.ts` now passes the link. Confirm that only the `.fails` markers changed in the acceptance test files, and that the usage spec and CLI reference were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(staleness): judge a linked plan's ground in the code repository`

### Commit body

In a process repository that links its code, ground-changed diffs the
plan's footprint in the code repository since the approval's code
baseline, and the process repository's own changes are no longer ground.
A vanished code baseline, a plan approved before the link and a code
baseline without a link each give missing-record. phax plans status names
the code root in its text and, for linked plans only, in its --json
evidence. The previous commit's acceptance tests pass.

---

## phase-06 — Acceptance tests of the linked run {#phase-06-linked-run-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-07
**Acceptance test files:** `tests/integration/linkedRun.test.ts`, `tests/fixtures/codeLink/linkedRun.ts`

This phase writes, as frozen acceptance tests through `phax run`, what a run from the code repository on `../docs/plans/<plan>.md` must do. It refuses a stale plan before any phase starts and leaves no run folder or branch. It refuses an unapproved or unrecorded plan exactly as a plan living with its code is refused. At review it leaves the process repository untouched and prints the `phax artifact complete` command. Each test fails today on its own assertion, and phase-07 passes them.

### Detailed instructions

- Read the Technical arbitrations (how a linked run finds the process repository, what a linked run prints at review), phase-04's and phase-05's handoffs, `tests/fixtures/codeLink/linkedProject.ts`, `tests/integration/holdCli.test.ts` (how `phax run` is called through `phaxCall` with telemetry, routing and the provider dispatcher mocked), `tests/integration/helpers/preflightRepo.ts` (`snapshotRepo`), `tests/helpers/heldRunFixture.ts` and `tests/integration/declaredStopRun.test.ts` (a scripted backend whose turn writes files in the phase worktree, so a run reaches review).
- Write `tests/fixtures/codeLink/linkedRun.ts`. It imports `createLinkedProject` from `tests/fixtures/codeLink/linkedProject.ts` and never edits that file. It exports:
    - `runInCode(world, planRel: string)`: `phaxCall(["run", "--plan", "../" + planRel])` with the working directory at the code repository. It returns `{ code, stdout, stderr }`.
    - `runInRepo(repo, planRel)`: the same from any repository with `--plan <planRel>`, for the control.
    - `createControlRepo()`: a single repository that holds its own code and plans. It has phax.json (state root outside, gate `true`, records off, publish off), `src/export/csv.ts`, and the same plan file under `docs/plans/`. It is the plan living with its code.
    - `scriptedBackend()`: a fake backend for the dispatcher mock whose phase turn writes `src/export/csv.ts` in the phase worktree and a valid phase handoff, so the one-phase plan commits and the run reaches review, modelled on the scripted backends above.
    - `runState(world)`: the code repository's state root `runs/` listing, its registry file (or null), and its `phax/*` branches.
    The plan is one phase that edits `src/export/csv.ts`, built with `planMdFor` so extraction is deterministic. Its `# ` title is `CSV export`, so the run's short name differs from the plan's slug.
- Write `tests/integration/linkedRun.test.ts`, with the vi mocks of `holdCli.test.ts` and the dispatcher mocked to `scriptedBackend()`. Every test is its own `it.fails(...)`:
    - ac-run-refuses-stale: the plan is approved at code commit C, and a later code commit changes `src/export/csv.ts`. `runInCode` exits non-zero, and its output names `ground-changed` and `src/export/csv.ts`. `runState` shows no run folder, no registry and no `phax/` branch in the code repository.
    - ac-run-refuses-unrecorded, Draft: the same Draft plan in the linked layout and in `createControlRepo()`. Both refusals have the same exit code and the same message text, which names `docs/plans/<plan file>`.
    - ac-run-refuses-unrecorded, unrecorded: the plan's frontmatter is set to `status: Approved` by hand and committed, with no approval record, in both layouts. Both refusals have the same exit code and the same message text.
    - ac-run-review-no-complete: a spec approved and recorded, and a plan with `completes-spec: true` approved fresh. `runInCode` exits 0 and the run reaches review. The process repository's HEAD sha, the plan's bytes and the spec's bytes are unchanged, and both still say `status: Approved`. stdout contains `phax artifact complete docs/plans/<plan file>`.
- Change no source file. Run the gate and check that each marked test fails on its own assertion. In today's code:
    - the stale and unrecorded linked runs are not refused, so a run folder exists or the messages differ;
    - the Draft refusal names `../docs/plans/…`;
    - the review run reaches review without the complete line.
    Confirm in the handoff that today's review run does reach review, so the test fails only on the missing line.

### Planned files to create

- `tests/fixtures/codeLink/linkedRun.ts`
- `tests/integration/linkedRun.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-07's `phax run` (and `phax resume`) in a code repository given a plan under docs/plans/ of a process repository whose link names it. Consumer: these acceptance tests, through `phaxCall` with the working directory at the code repository. Contract:
- the plan is gated as the process repository's artifact, with the same refusals, exit codes and messages a plan living with its code gets, naming its process-relative path;
- a refusal happens before the run is named;
- at review, the plan and spec are not touched, and stdout carries `phax artifact complete <plan path>`.

### Test strategy

- a linked run on a plan whose footprint file changed in the code repository exits non-zero naming ground-changed and the file, and creates no run folder, registry or branch — medium · example · the exit code, the refusal text and the state root and branch listing · acceptance · ac-run-refuses-stale
- a Draft plan, and an Approved plan with no approval record, are refused by a linked run with the same exit code and message as the same plan living with its code — medium · example · the control repository's refusal for the same plan · acceptance · ac-run-refuses-unrecorded
- a linked run reaching review leaves the plan, the spec and the process repository's history unchanged and prints phax artifact complete with the plan's process path — medium · example · the process HEAD, the two files' bytes and status, and the stdout line · acceptance · ac-run-review-no-complete

### Implementation order

1. linkedRun.ts with the control repository and scripted backend
2. linkedRun.test.ts with a marker on each test
3. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing the linked run (phase-07).
- ac-loose-unchanged and ac-trailers, which already hold today (phase-07, in-phase).
- The pull request (phase-08).

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files.

### Expected handoff content

Give the exports of `linkedRun.ts` and how the scripted backend makes the phase commit. For each acceptance test, give the assertion it fails on today, and confirm that today's review run reaches review. Confirm that every test carries its own `.fails` marker, that no test names the opened version, and that no source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(run): acceptance tests for a run linked to its process repository`

### Commit body

Freeze what phax run must do from a code repository given a plan of the
process repository that links it: refuse a plan stale against the code,
or unapproved or unrecorded, exactly as a plan living with its code is
refused and before the run is named, and at review leave the plan and
spec untouched and print the phax artifact complete command. Each fails
today; the next phase passes them.

---

## phase-07 — A run from the code repository gates the plan as the process repository's artifact {#phase-07-linked-run}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs something the code does not show yet: finding a second repository from a plan path, decoding that repository's config, and gating an artifact that lives outside the run's repository through the FileSystem and Git ports. It must also satisfy frozen acceptance tests it cannot change. The default effort is not enough.

`phax run --plan ../docs/plans/<plan>.md`, started in a code repository that a process repository links, finds that process repository from the plan path and gates the plan as its artifact: Approved, recorded and fresh against the code. At review, `phax run` and `phax resume` leave completion to the operator and print the `phax artifact complete` command. A plan outside any link stays loose exactly as today. phase-06's acceptance tests pass.

### Detailed instructions

- Read the Technical arbitrations (how a linked run finds the process repository, where the link is known after the run starts, what a linked run prints at review), phase-06's handoff and its two acceptance test files. In `tests/integration/linkedRun.test.ts`, remove only the `.fails` markers. Change nothing else in it or in `tests/fixtures/codeLink/linkedRun.ts`, and never retype a test's title.
- Create `src/app/planLink.ts`. It exports `PlanLink = { kind: "loose" } | { kind: "linked"; processRoot: string; planPath: string; link: CodeLink }`, where `planPath` is process-relative and POSIX. It also exports `resolvePlanLink(input: { runRepoRoot: string; planAbsolute: string }): Effect<PlanLink, ConfigValidationError | GitError | FsError, Git | FileSystem>`. It works through the ports only:
    - A plan inside `runRepoRoot` is `loose`; the caller keeps today's path.
    - `processRoot = git.repoTopLevel(dirname(planAbsolute))`. null gives `loose`.
    - The plan path relative to `processRoot` must classify as a plan (`classifyArtifactPath(...)?.kind === "plan"`); otherwise `loose`.
    - Read `phax.json` at `processRoot` through `fs.rootedAt(processRoot)`. Absent gives `loose`. Present but not a JSON object refuses with `ConfigValidationError` naming that file.
    - Without an own `code` key, `loose`. With one, decode the whole file with `decodePhaxConfig` and check the root with `codeRootProblem`. A failure refuses with `ConfigValidationError` naming that file.
    - `git.repoTopLevel(join(processRoot, root))` must equal `runRepoRoot`; otherwise `loose`, with no warning.
    - `git.isIgnored(processRoot, root)` false refuses with `codeRootMessage(root, codeRootNotIgnored(root))`.
    - Otherwise `linked`.
    Read no other key of the process config: none of its commands, gates or providers is applied.
- The run's gate in `src/cli/definitions/run.ts`. Before the status gate, resolve `resolvePlanLink({ runRepoRoot: config.repoRoot, planAbsolute: planMdPath })` with the Node Git layer and a FileSystem layer. A refusal exits 2 with `phax run refused: <message>`. When `linked`:
    - `checkPlanRunnable(planMd, planPath)` runs with the process-relative path.
    - The staleness gate runs as for an artifact plan. `computeStalenessForPlan(planPath, planMd, footprint, { repoRoot: processRoot, codeLink: link })` is given a FileSystem rooted at `processRoot`, and the footprint is built with the process-relative path.
    - A refusal has the exit code and message a plan living with its code gets: `PlanNotApprovedError` and `PlanStaleError` naming `docs/plans/<plan file>`.
    - Everything else (extraction, preflight, `createRunFolder` with today's recorded `../docs/plans/…` path, `executePlan`) is unchanged. Run completion already completes nothing for that path.
    When `loose`, every step is exactly as today.
- Review output. In `src/cli/definitions/runOutcome.ts`, a linked run's `review_open` outcome carries the plan's process path, as an explicit variant or a field present only for linked runs. An unlinked run's answer and text stay byte for byte as today. The text after the review line is `The plan lives in the process repository: once merged, run there` and then `  phax artifact complete <plan path>`. `phax run` fills it from the link it resolved. `phax resume` (`src/cli/definitions/resume.ts`), on reaching review, derives it again with `resolvePlanLink` from the run's recorded plan path, resolved against `config.repoRoot`. A resolver refusal at that point never fails the resume: it becomes one warning line, and the complete line is left out.
- Help. `phax run`'s help gains one paragraph: a plan under docs/plans/ of a process repository whose `code.root` names this repository is gated as that repository's artifact, and at review the run prints the `phax artifact complete` command instead of completing it. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- In-phase tests:
    - `tests/integration/planLink.test.ts`, with real git in temporary directories:
      - a plan inside the run repository is loose;
      - a plan in a directory of no repository is loose;
      - a plan outside docs/plans/ of the process repository is loose;
      - a process repository without `code` is loose;
      - one whose link names another repository is loose;
      - one that links this repository is linked, with the process-relative path;
      - a process phax.json that is not JSON is refused, naming it;
      - a link that is not ignored is refused.
    - `tests/integration/linkedRunInPhase.test.ts`, which may build with both fixture files without editing them:
      - ac-loose-unchanged: a plan file in a directory that is not under docs/plans/ of a linking process repository. Cover a sibling directory of the code repository, and the docs/plans/ of a process repository whose link names another code repository. `phax run` behaves as a loose run does today: it reaches review, its recorded plan path is as given, and stdout has no complete line.
      - ac-trailers: after the linked run reaches review, `git log -1 --format=%B` of the phase commit on the run branch carries the trailers Run-Id, Short-Name, Phase-Id, Phase-Title, Model, Effort and Gate-Log, and no trailer value contains `../` or starts with `/`.
      - `phax resume` of a linked run paused before review prints the complete line when it reaches review, if the fixture allows a pause cheaply; otherwise unit-test the derivation in `runOutcome.ts`.

### Planned files to create

- `src/app/planLink.ts`
- `tests/integration/planLink.test.ts`
- `tests/integration/linkedRunInPhase.test.ts`

### Planned files to edit

- `src/cli/definitions/run.ts`
- `src/cli/definitions/runOutcome.ts`
- `src/cli/definitions/resume.ts`
- `tests/integration/linkedRun.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/codeLink.ts`
- `src/app/planStaleness.ts`
- `src/app/artifactStatus.ts`
- `src/domain/config/codeLink.ts`
- `src/domain/errors.ts`
- `docs/cli/inventory.md`
- `knip.json`
- `tests/unit/cli/run.test.ts`
- `tests/integration/runCommandsAnswers.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Producer: `src/app/planLink.ts` (`resolvePlanLink`, `PlanLink`), over the Git and FileSystem ports, the process repository's phax.json decoded through `decodePhaxConfig`, and `codeRootProblem`. Consumers: `phax run`'s gate and review output, `phax resume`'s review output, and in phase-08 the publish step. Contract:
- `loose` means today's behaviour, untouched;
- `linked` means the plan is the process repository's artifact at `planPath`, gated with today's artifact refusals, and completion is left to the operator;
- a refusal is a configuration error naming the process phax.json.
run-status.json keeps today's recorded plan path, so the link can be derived again from it.

### Test strategy

- a plan outside docs/plans/ of a process repository linking this code repository runs exactly as a loose plan does today — medium · example · the run reaching review, its recorded plan path and its output without a complete line · in-phase · ac-loose-unchanged
- a linked run's phase commit carries exactly today's trailers and none names ../ or an absolute path — medium · example · the phase commit's trailer lines read with git log · in-phase · ac-trailers
- the plan path resolves as loose or linked, or is refused, as the discovery arbitration says, for every layout — medium · table · hand-built layouts and their expected PlanLink or refusal · in-phase
- an unlinked run's review answer and text are unchanged — small · example · the rendered outcome against today's lines · in-phase

### Implementation order

1. src/app/planLink.ts and planLink.test.ts
2. the run's gate under the link
3. the review outcome for run and resume
4. help, gen:usage-spec and docs:cli
5. remove the acceptance markers
6. linkedRunInPhase.test.ts

### Excluded scope

- Completing the plan or spec from the code repository: completion stays the operator's (q-run-lifecycle).
- Running a plan from the process repository against the code.
- The pull request footer (phase-08).
- Any change to run-status.json or another persisted run format.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-06's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give the signature of `resolvePlanLink` and every way it answers loose, linked or a refusal. Say where `run.ts` calls it and with which layers, and how `resume.ts` derives the link at review. Give the exact review lines and the outcome's shape for a linked run. Confirm that only the `.fails` markers changed in the acceptance test files, and that the usage spec and CLI reference were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(run): gate a plan of a linked process repository as its artifact`

### Commit body

phax run --plan ../docs/plans/<plan>.md, started in a code repository
that a process repository links through code.root, now finds that
process repository from the plan's path and gates the plan as its
artifact: approved, recorded and fresh against the code, with the same
refusals a plan living with its code gets. At review, run and resume
leave the plan and spec alone and print the phax artifact complete
command to run in the process repository. Any other plan outside the
repository stays loose, as before.

---

## phase-08 — The code repository's pull request names nothing of the process repository {#phase-08-pr-names-nothing}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A pull request published from a linked run carries no `**Plan**` or `**Spec**` entry. Its body names neither the plan's or spec's path or slug, nor any process-repository URL. Every other pull request's footer is unchanged.

### Detailed instructions

- Read the Technical arbitrations (where the link is known after the run starts), phase-07's handoff (`resolvePlanLink`), `src/domain/publish/prFooter.ts`, `src/app/publishRun.ts` (`planRefAtHead`, `loadSpecRef`, the recorded plan path) and `tests/integration/publishRun.test.ts`.
- Domain. In `src/domain/publish/prFooter.ts`, `PrPlanRef` gains `{ kind: "withheld" }`. When the plan is withheld, `renderPrFooter` leaves out the whole Plan/Spec line, so the footer is the generated line, then Agents (when any), then Run. Every other variant renders as today.
- App. In `src/app/publishRun.ts`, when the recorded plan path leaves the repository (it starts with `../`), derive the link with `resolvePlanLink({ runRepoRoot: repoRoot, planAbsolute: resolve(repoRoot, recorded) })`. A `linked` answer, or a refusal (fail closed), makes the plan `withheld` and the spec `none`, without reading the plan copy's source spec. A `loose` answer keeps today's behaviour. A recorded path inside the repository never calls the resolver. A failed derivation never fails a publish.
- Tests:
    - `tests/unit/publish/prFooter.test.ts`: the withheld footer's exact text, and today's footers unchanged.
    - `tests/integration/publishRun.test.ts`, ac-pr-names-nothing: build a linked layout on disk with real directories. `tests/fixtures/codeLink/linkedProject.ts` may be reused without editing it. Use a run folder whose run-status.json records `../docs/plans/<plan file>` and whose plan copy declares a source spec. The run's short name must differ from the plan's slug. Publish through the fake GitHub as the existing tests do. The captured body contains no `**Plan**` and no `**Spec**`, neither plan or spec path, neither file name, neither slug, and no URL of the process repository (give it a remote URL and assert its absence). The `**Run**` line is present.
    - A loose recorded path outside any linking repository still renders `**Plan** \`../…\``.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/publish/prFooter.ts`
- `src/app/publishRun.ts`
- `tests/unit/publish/prFooter.test.ts`
- `tests/integration/publishRun.test.ts`

### Optional files that may be edited

- `src/app/planLink.ts`
- `src/cli/definitions/publishPr.ts`
- `tests/unit/publish/prBody.test.ts`

### Boundary contracts

`publishRun` (app) derives the link from the recorded plan path through `resolvePlanLink` and hands `renderPrFooter` (domain) a `withheld` plan ref for a linked run. Contract: a linked run's pull request body names nothing of the process repository. Its footer keeps the generated line, Agents and Run. Unlinked footers are unchanged.

### Test strategy

- a linked run's pull request body has no Plan or Spec entry and names neither the plan's or spec's path or slug nor the process repository's URL — medium · example · the body the fake GitHub captured, searched for each forbidden string · in-phase · ac-pr-names-nothing
- a withheld plan drops the Plan and Spec line and every other footer renders as before — small · example · the expected footer texts · in-phase
- a loose plan path outside any linking repository is still named in the footer — medium · example · the captured body's Plan entry · in-phase

### Implementation order

1. the withheld plan ref and its footer
2. the derivation in publishRun
3. the tests

### Excluded scope

- A publish setting that names the plan (q-pr-names: omit).
- The text of commit bodies, which the plan author writes.
- Commit trailers: they already name nothing of the process repository.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the new `PrPlanRef` variant, the withheld footer text, and when `publishRun` calls the resolver and how it fails closed. Explain any deviation from the planned file lists.

### Commit subject

`feat(publish): name nothing of the process repository in a linked pull request`

### Commit body

A pull request published from a run whose plan lives in a linking
process repository now leaves out the footer's Plan and Spec entries, so
its body names neither the plan nor the spec, by path, slug or link. The
link is derived again from the recorded plan path, and a link that cannot
be read omits them too. Every other pull request's footer is unchanged.

---

## phase-09 — plans lint checks planned files against the code {#phase-09-lint-against-code}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

In a process repository that declares a code link, `phax plans lint` checks each planned file against the code root's working tree, so a plan that edits `src/export/csv.ts` present at `code/src/export/csv.ts` reports no missing file. An unlinked repository is checked as today, and a failing link refuses the lint.

### Detailed instructions

- Read phase-01's handoff (`resolveCodeLink`), `src/app/lintPlan.ts` (the files check probes `join(config.repoRoot, path)`), `src/cli/definitions/plansLint.ts` and `tests/integration/lintPlan.test.ts`.
- In `lintPlan`, resolve `resolveCodeLink(config)` once. With a link, the files check probes `join(link.path, path)`; without one, it probes as today. The commands and models checks keep reading the configuration of the repository lint runs in. A refusal fails the lint with its `ConfigValidationError`. Add `Git` to the use case's requirements and provide `makeNodeGitLayer()` in the definition. The plan-lint document's shape does not change.
- Help: one sentence. In a project that declares a code link, the files check walks planned paths against the code root's working tree. Run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Tests in `tests/integration/lintPlan.test.ts`. `tests/fixtures/codeLink/linkedProject.ts` may be reused without editing it.
    - ac-lint-files: a linked process repository whose plan edits `src/export/csv.ts`, present at `code/src/export/csv.ts` and absent from the process tree. `phax plans lint <plan>` reports no `files` finding about it.
    - The same plan in the same repository without the link reports the missing file, as today.
    - A link whose root is not ignored refuses the lint with the not-ignored reason.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/lintPlan.ts`
- `src/cli/definitions/plansLint.ts`
- `tests/integration/lintPlan.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `tests/unit/cli/plansInspectionContracts.test.ts`
- `tests/integration/everyCommandJson.test.ts`

### Boundary contracts

`phax plans lint` (CLI) provides the Git layer, and `lintPlan` (app) resolves the link through `resolveCodeLink`. Contract: with a link, the files check walks the code root's working tree; without one, the repository's own, as today. The plan-lint document is unchanged.

### Test strategy

- a linked process repository's plan editing a file present only under code/ gets no missing-file finding — medium · example · the lint report's files findings · in-phase · ac-lint-files
- without the link the same plan still reports the file missing, and a link not ignored refuses the lint — medium · example · today's files finding and the refusal text · in-phase

### Implementation order

1. the link in lintPlan's files check
2. the definition's layers and help
3. gen:usage-spec and docs:cli
4. the tests

### Excluded scope

- The commands and models checks: they read the configuration of the repository lint runs in.
- phax plans overview and phax plans estimate.
- Any change to the plan-lint document.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Say where the link is resolved in `lintPlan`, what a refusal does to the lint and its exit code, and confirm that the plan-lint document is unchanged and the usage spec and CLI reference were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(lint): check a linked plan's files against the code root`

### Commit body

In a process repository that declares a code link, phax plans lint now
checks each planned file against the code root's working tree rather
than the process repository's, where none of them exists. A failing
link refuses the lint; an unlinked repository is checked as before.

---

## phase-10 — Docs: process and code in two repositories {#phase-10-code-repository-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A maintainer who keeps a project's specs and plans private and its code public can read, on one page, how to link the two repositories and what phax then guarantees. The upgrading notes say that new plan approval records carry a required `code` key, which an older @lbdremy/phax-schemas cannot read.

### Detailed instructions

- Read spec §3, §6 and §11, the Technical arbitrations, and the handoffs of phases 01 to 09. Use the exact messages, output lines and keys those phases produced, and read the release that ships this change from `PHAX_RELEASE` in `src/schemas/release.ts`, never from the spec's examples.
- Create `docs/code-repository.md`, titled `# Process and code in two repositories`, for the reader of §11. Sections:
    - **The layout:** a process repository holding specs, plans, briefs and their approvals, with the code repository checked out at `code/` and `/code/` in its `.gitignore`.
    - **Declaring the link:** `"code": { "root": "code" }` in the process repository's phax.json only, and the refusals of `phax validate`.
    - **Approving a plan:** the record's `code` key and the frontmatter's `approved.code`, with an example of each. An unlinked project records `"code": null`.
    - **Staleness against the code:** ground-changed in the code repository, and the three missing-record cases with their remedy, re-approving. Include a `phax plans status` example.
    - **Running from the code repository:** `cd code && phax run --plan ../docs/plans/<plan>.md`, how phax finds the process repository, the refusals, and the `phax artifact complete` line at review.
    - **What the code repository receives:** a pull request that names neither plan nor spec, commits whose trailers name nothing outside the code repository, and records as before.
    - **plans lint:** checked against `code/`.
    - **Limits:** the non-goals that matter to a maintainer (no sibling checkout, no submodules, no completion from the code repository, a second checkout elsewhere runs loose).
    Follow §11's example from start to finish with one plan.
- Publish it: add `docs/code-repository.md` to `SOURCE_FILES` in `site/build/sources.ts`. Add a page to `site/pages.ts`'s `files` with route `/guide/code-repository`, title `Process and code in two repositories` and a one-sentence description. Update any site test that lists the pages, if it asks.
- docs/upgrading.md: under `## Release by release`, in the section for the release `PHAX_RELEASE` names (create `### <release>` above the latest section if it does not exist yet, or add to it if the finding-ids run created it), say:
    - `plan-approval-record` moves to a new shape with a required `code` key: null without a code link, `{ root, baseline }` with one.
    - An `@lbdremy/phax-schemas` older than that release must be upgraded to read new plan approval records.
    - Records written earlier are read as `code: null` and never rewritten.
    - Declaring a code link makes plans approved before it missing-record, so re-approve them.
    - No step is needed in a repository that declares no link.
- README.md: one line where the plan lifecycle or configuration is described, pointing to docs/code-repository.md.

### Planned files to create

- `docs/code-repository.md`

### Planned files to edit

- `site/build/sources.ts`
- `site/pages.ts`
- `docs/upgrading.md`
- `README.md`

### Optional files that may be edited

- `docs/json-output.md`
- `docs/cli/reference.md`
- `phax.usage.kdl`
- `tests/unit/site/pages.test.ts`
- `tests/unit/site/sources.test.ts`

### Test strategy

- the code-repository page builds on the docs site with its route, and its links resolve — medium · smoke · pnpm site:build at the terminal gate and the site's page tests · in-phase

### Implementation order

1. docs/code-repository.md
2. site sources and pages
3. the upgrading section
4. the README line

### Excluded scope

- Any code change.
- Tools that move files between the two repositories.

### Verification

The `standard` gate profile in phax.json, including its terminal `pnpm site:build`.

### Expected handoff content

List the sections of `docs/code-repository.md` and the route it is published at, the upgrading entry as written with the release it names, and every other doc changed, with one line each. Explain any deviation from the planned file lists.

### Commit subject

`docs(code-repository): document a plan's process and code in two repositories`

### Commit body

Add docs/code-repository.md, published at /guide/code-repository: how a
process repository links the code repository checked out inside it, what
an approval records, how staleness is judged against the code, how a run
from the code repository is gated and what its pull request and commits
carry. The upgrading notes say that new plan approval records carry a
required code key, which an older @lbdremy/phax-schemas cannot read.
