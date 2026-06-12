# Plan 14 — Push branch and create pull request

Implements [`docs/specs/07-push-branch-pr.md`](../specs/07-push-branch-pr.md):
optionally push the final run branch to a remote and open a GitHub pull request,
with the final review handoff attached, at the end of a successful run — plus a
`phax publish-pr <short-name>` retry command.

## Problem

A completed PHAX run ends in `review_open` with `review-handoff.md` and
`final-report.md` written, but the operator must still push the final phase
branch and hand-copy the review context into a PR by hand. The spec asks PHAX to
close that gap: when configured, push the final branch to `origin` and create a
GitHub PR whose body is the (deterministic) review handoff, then record the PR
URL in the run's metadata, the final report, and verbose output.

## Desired behavior

When `publish.enabled` is true, after the final review handoff is generated and
the run has entered `review_open`, PHAX:

```
verify gh is available, authenticated, and recognizes the repo
push the final phase branch to the configured remote (default origin)
reuse an existing PR for the branch, or create a new one
attach the review handoff as the PR body (deterministic, no LLM)
record publication metadata in publication.json
append a "Pull request" section to final-report.md
log the PR URL in verbose mode
```

Publication is **disabled by default**, **idempotent**, and **non-fatal**: a
failure never invalidates the completed run. `phax publish-pr <short-name>`
re-runs the same flow to recover from a missing/unauthenticated `gh`, a network
failure, or a partially-completed publication.

## Scope decisions

- **Run state stays `review_open`.** Push/PR status and any failure reason live
  in a new `publication.json` artifact (and are surfaced in `final-report.md`),
  not in new run states. The spec calls the status name implementation-specific
  and forbids publication failure from invalidating the run; the
  single-status-writer architectural guard (`tests/unit/architecturalGuards.test.ts`)
  only permits the dispatcher and effect runner to write run status, so
  publication metadata must be a separate artifact. `publishRun` must not import
  `encodeRunStatus`/`encodePhaseStatus`.
- **`gh` gets a dedicated port.** PR operations go through a new `GitHub` port
  with a Node `execFile` adapter mirroring `src/infra/git.ts`; `git push` is
  added to the existing `Git` port. Both use argv arrays (no shell-string
  interpolation), satisfying the command-safety model in spec §18.
- **GitHub only.** The provider field is an explicit literal `"github"` (per the
  "prefer explicit per-variant enums" project convention). Other providers are
  out of scope and must be rejected at config decode time, not silently ignored.
- **"Final instructions artifact" = `final-report.md`.** The PR section is
  appended there; no artifact is renamed (spec §12, acceptance criterion 12/14).
- **Deterministic body.** The PR body is assembled by a pure domain function
  from `review-handoff.md`; no LLM call. Oversized bodies are truncated with an
  explicit note rather than silently (spec §10).
- **Single orchestrator.** Both the end-of-run hook and the `publish-pr` command
  call one application function (`publishRun`) so behavior and idempotency are
  identical on the automatic and manual paths.

## Affected gate profile

All phases verify against the project's configured `full` gate profile in
`phax.json`.

---

## phase-01 — Publish configuration block {#phase-01-publish-config}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add an optional `publish` block to `phax.json` configuration and resolve it into
`ResolvedConfig`, so later phases can read whether publication is enabled and
with what remote/provider/base branch.

### Detailed instructions

- In `src/schemas/phaxConfig.ts`, add a `PublishConfigSchema`:
  - `enabled: Schema.Boolean`
  - `remote: Schema.optional(Schema.NonEmptyString)` (default `"origin"`)
  - `provider: Schema.optional(Schema.Literal("github"))` (default `"github"`;
    keep it an explicit literal so non-GitHub providers fail decode)
  - `pushBranch: Schema.optional(Schema.Boolean)` (default `true`)
  - `createPullRequest: Schema.optional(Schema.Boolean)` (default `true`)
  - `baseBranch: Schema.optional(Schema.NonEmptyString)`
  - `title: Schema.optional(Schema.NonEmptyString)`
  - Add `publish: Schema.optional(PublishConfigSchema)` to `PhaxConfigSchema`.
    `onExcessProperty: "error"` is already set on `decodePhaxConfig`, so unknown
    keys still fail.
- Add a `ResolvedPublishConfig` interface and a `resolvePublishConfig(raw)`
  helper (mirroring `resolveSecurityConfig`) returning fully-defaulted fields
  plus `enabled`. When `raw` is `undefined`, return `{ enabled: false, … }`.
- Add `publish: ResolvedPublishConfig` to the `ResolvedConfig` interface, and
  populate it in `src/app/loadConfig.ts` alongside `security`.
- Update `examples/` and `README.md` only if they document the full config shape
  (check first; do not invent doc sections).

### Planned files to create

- `tests/unit/schemas/publishConfig.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`
- `README.md`

### Boundary contracts

Producer: `phax.json` (user-authored config). Consumer: every later phase reads
`ResolvedConfig.publish`. Stable shape: `ResolvedPublishConfig` with
`{ enabled, remote, provider, pushBranch, createPullRequest, baseBranch?, title? }`,
all non-optional except `baseBranch` and `title`.

### Test strategy

Unit tests (schema layer → type/contract): decode a config with `publish`
present (all fields, and minimal `{ enabled: true }`), assert defaults from
`resolvePublishConfig`; assert a non-`"github"` provider and an unknown key both
fail decode. Write these before implementation — the resolved shape is a stable
contract consumed by four later phases.

### Implementation order

Schema → resolver → `ResolvedConfig` field → `loadConfig` wiring.

### Excluded scope

- Any use of the resolved config (push, PR creation) — later phases.
- New run states or metadata artifacts.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `ResolvedPublishConfig` field names and defaults.
- That `provider` is the literal `"github"` and rejects other values.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(config): add publish configuration block

### Commit body

Add an optional `publish` block to phax.json (enabled, remote, provider,
pushBranch, createPullRequest, baseBranch, title) and resolve it into
ResolvedConfig.publish with defaults. Disabled by default; provider is the
explicit literal "github". Covered by schema decode/resolve unit tests.

---

## phase-02 — Publication domain model and artifact schema {#phase-02-publication-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the pure domain logic for publication — status types, deterministic PR title
selection, and PR body assembly with oversize handling — plus the
`publication.json` artifact schema. This is the testable core that later phases
orchestrate.

### Detailed instructions

- Create `src/domain/publish/types.ts`:
  - `type PushStatus = "not_attempted" | "pushed" | "failed"`
  - `type PrStatus = "not_attempted" | "created" | "exists" | "failed"`
  - `type ProviderId = "github"`
  - `interface PublicationRecord` with the spec §14 metadata: `enabled`,
    `provider`, `remote`, `branch`, `baseBranch?`, `pushStatus`, `prStatus`,
    `pullRequestUrl?`, `createdAt`, `failureReason?`.
- Create `src/domain/publish/title.ts`:
  - `selectPrTitle(candidates: { configuredTitle?: string; runTitle?: string; phaseTitle?: string; shortName: string }): string`
  - Priority: `configuredTitle` → `runTitle` → `phaseTitle` → `shortName`.
    Trim; skip empty/whitespace candidates; when falling back to a derived
    source, prefix `"PHAX: "`; use the configured title verbatim. Never emit a
    meaningless title like `"Update files"`.
- Create `src/domain/publish/body.ts`:
  - `buildPrBody(input: { reviewHandoffMd: string; branch: string; maxBytes: number }): { body: string; truncated: boolean }`
  - Wrap with a deterministic header (`# PHAX Run Review Handoff\n\nGenerated by PHAX.\n\n` + contents).
  - If the wrapped body exceeds `maxBytes`, produce a shorter body that keeps the
    leading summary section(s), appends an explicit truncation note that names
    `review-handoff.md` on the branch, and sets `truncated: true`. Export a
    `DEFAULT_PR_BODY_MAX_BYTES` constant (GitHub PR bodies cap near 65536 bytes —
    pick a safe value below it and document the choice).
- Keep `src/domain/publish/` **pure**: no `Effect`, no `@opentelemetry`, no
  `ports/fs`, no `infra/` imports. Add `"domain/publish"` to the
  `PURE_DOMAIN_DIRS` list in `tests/unit/architecturalGuards.test.ts` so the
  purity guard covers it.
- Create `src/schemas/publication.ts`:
  - `PublicationSchema` (`version: Schema.Literal(1)` + the `PublicationRecord`
    fields, statuses as `Schema.Literal` unions, provider as `Schema.Literal("github")`).
  - Export `decodePublication` and `encodePublication`.

### Planned files to create

- `src/domain/publish/types.ts`
- `src/domain/publish/title.ts`
- `src/domain/publish/body.ts`
- `src/schemas/publication.ts`
- `tests/unit/publish/title.test.ts`
- `tests/unit/publish/body.test.ts`
- `tests/unit/schemas/publication.test.ts`

### Planned files to edit

- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/domain/publish/index.ts`

### Boundary contracts

Producer: this pure domain + schema. Consumers: `publishRun` (phase-05) calls
`selectPrTitle`/`buildPrBody` and reads/writes `publication.json` via the schema;
`final-report.md` rendering (phase-05) reads the `PublicationRecord`. Stable
shape: `PublicationRecord` and the literal status unions.

### Test strategy

Unit tests (domain → unit). Write before implementation: title priority and
fallback prefixing across all candidate combinations; body wrapping, the
under-limit pass-through, and the over-limit truncation (assert `truncated` and
that the note references `review-handoff.md`); schema round-trip
(decode∘encode) and rejection of a bad provider/status literal.

### Implementation order

Types → schema → title → body → guard list update.

### Excluded scope

- Reading/writing files, running git/gh — phases 03–05.
- Wiring into the run — phases 05–07.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Exact module paths and the `selectPrTitle` / `buildPrBody` signatures.
- The `DEFAULT_PR_BODY_MAX_BYTES` value and the truncation contract.
- The `PublicationRecord` field set and `publication.json` schema version.
- That `src/domain/publish/` is now under the purity guard.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(publish): add publication domain model and PR body assembly

### Commit body

Add pure publication domain (status types, deterministic PR title selection,
PR body assembly with explicit oversize truncation) and the publication.json
artifact schema. domain/publish/ is added to the purity architectural guard.
Covered by unit tests for title priority, body truncation, and schema round-trip.

---

## phase-03 — Git port: branch push and remote inspection {#phase-03-git-push}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add the git capabilities publication needs — pushing a branch to a remote and
checking that a remote exists — to the `Git` port, its Node adapter, and the
fake.

### Detailed instructions

- In `src/ports/git.ts`, extend `GitOps` with:
  - `remoteExists(remote: string, repo: string): Effect.Effect<boolean, GitError>`
  - `pushBranch(branch: BranchName, remote: string, repo: string): Effect.Effect<void, GitError>`
- In `src/infra/git.ts`, implement them via `gitRun`:
  - `remoteExists`: `git remote get-url <remote>` through `gitRunAllowFail`,
    succeed boolean on exit code.
  - `pushBranch`: `git push --set-upstream <remote> <branch>`. A re-push of an
    already-pushed, up-to-date branch exits 0 — that is the idempotent path. Do
    not force-push.
- In `src/infra/fakes/git.ts`, add `remoteExists`/`pushBranch` to `FakeGitImpl`:
  record calls in the `GitCall` union; add `existingRemotes: Set<string>` (with
  a setter) and a `pushedBranches: Set<string>`; allow enqueuing a push failure
  (mirror `failNextWorktreeAdd`).

### Planned files to create

- (none)

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `tests/integration/gitDiffNameStatus.test.ts`

### Optional files that may be edited

- `tests/unit/schemas/git.test.ts`

### Boundary contracts

Consumer: `publishRun` (phase-05) needs to push the final phase branch and
verify the remote. Producer: `Git` port. Stable shape: `pushBranch(branch,
remote, repo)` is idempotent on an up-to-date branch; `remoteExists(remote,
repo)` returns a boolean and never fails for a missing remote.

### Test strategy

Adapter behavior is exercised against a real temp git repo in the existing
integration suite (`tests/integration/gitDiffNameStatus.test.ts` already drives
the Node git layer) — add a remote and assert `remoteExists` true/false and that
`pushBranch` to a bare local remote succeeds and is safely repeatable. The fake's
call recording is exercised indirectly by phase-05's tests.

### Implementation order

Port signature → Node adapter → fake → integration test.

### Excluded scope

- PR creation / `gh` — phase-04.
- Deciding when to push — phase-05.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `pushBranch` / `remoteExists` signatures and the idempotent-push
  contract.
- The new `FakeGitImpl` setters (`existingRemotes`, push-failure enqueue).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(git): add branch push and remote inspection to Git port

### Commit body

Add remoteExists and idempotent pushBranch to the Git port, Node adapter, and
fake. pushBranch uses `git push --set-upstream` and never force-pushes; a
re-push of an up-to-date branch is a no-op. Covered by an integration test
against a temp repo with a bare local remote.

---

## phase-04 — GitHub CLI port and adapter {#phase-04-github-port}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a `GitHub` port wrapping the `gh` CLI, a Node `execFile` adapter (mirroring
`src/infra/git.ts`), and a fake, so publication can check availability/auth and
create or recover a PR without shelling out from `app/`.

### Detailed instructions

- Create `src/ports/github.ts`:
  - `GitHubError extends Data.TaggedError("GitHubError")` with `message`,
    `command`, `stderr?`, `exitCode?`, `args?`.
  - `interface GitHubOps`:
    - `isAvailable(): Effect.Effect<boolean, GitHubError>` (`gh --version`)
    - `isAuthenticated(repo: string): Effect.Effect<boolean, GitHubError>`
      (`gh auth status`)
    - `repoRecognized(repo: string): Effect.Effect<boolean, GitHubError>`
      (`gh repo view`)
    - `defaultBaseBranch(repo: string): Effect.Effect<string, GitHubError>`
      (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`)
    - `findPullRequestForBranch(branch: BranchName, repo: string): Effect.Effect<string | null, GitHubError>`
      (`gh pr list --head <branch> --state all --json url -q '.[0].url'`; `null`
      when none)
    - `createPullRequest(input: { branch; base; title; bodyFile; repo }): Effect.Effect<string, GitHubError>`
      (`gh pr create --head <branch> --base <base> --title <title> --body-file <path>`,
      returns the printed URL)
  - `class GitHub extends Context.Tag("phax/GitHub")<GitHub, GitHubOps>() {}`
- Create `src/infra/github.ts`: `NodeGitHubLayer` using `node:child_process`
  `execFile` with argv arrays (no shell string concatenation), mirroring the
  `gitRun` helper in `src/infra/git.ts`. Pass the PR body via `--body-file`
  pointing at a temp/run-folder file to avoid argv length limits and quoting
  issues. Parse the PR URL from stdout.
- Create `src/infra/fakes/github.ts`: `FakeGitHubImpl` recording calls, with
  setters for availability/auth/recognized, a configurable default branch, a
  pre-seeded existing-PR map keyed by branch, and a created-PR URL. Mirror the
  `makeFakeShell`/`makeFakeGit` `{ impl, layer }` factory shape; export from
  `src/infra/fakes/index.ts`.
- The provider-spawn architectural guard only restricts `claude`/`vibe`/`codex`
  binaries to `src/infra/providers/`, so a `gh` adapter in `src/infra/github.ts`
  is permitted (like `src/infra/git.ts`). Confirm the guard still passes.

### Planned files to create

- `src/ports/github.ts`
- `src/infra/github.ts`
- `src/infra/fakes/github.ts`
- `tests/unit/publish/githubFake.test.ts`

### Planned files to edit

- `src/infra/fakes/index.ts`

### Optional files that may be edited

- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Consumer: `publishRun` (phase-05) needs availability/auth/repo gating, a base
branch, existing-PR lookup, and PR creation. Producer: `GitHub` port. Stable
shape: `findPullRequestForBranch` returns `string | null` (idempotency hinge);
`createPullRequest` takes a `bodyFile` path and returns the PR URL.

### Test strategy

Unit test the fake's contract (`tests/unit/publish/githubFake.test.ts`): seeded
availability/auth, existing-PR returns the URL, create returns the configured
URL, calls recorded. The real `execFile` adapter is not unit-tested against live
`gh` (no network/auth in CI); its behavior is covered by manual/e2e validation
documented in the handoff. Write the fake contract test before phase-05.

### Implementation order

Port → Node adapter → fake → fake export → fake contract test.

### Excluded scope

- Orchestration / deciding when to call these — phase-05.
- `git push` — phase-03.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `GitHubOps` method signatures, especially `findPullRequestForBranch`
  (`string | null`) and `createPullRequest` (takes `bodyFile`, returns URL).
- The fake factory shape and its setters.
- The `gh` argv commands used by the adapter (for the trace/log audit in
  phase-05/§18).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(publish): add GitHub CLI port and adapter

### Commit body

Add a GitHub port wrapping the gh CLI (availability, auth, repo recognition,
default base branch, existing-PR lookup, PR creation), a Node execFile adapter
using argv arrays and --body-file, and a fake. Covered by a fake-contract unit
test; the live adapter is validated manually/e2e.

---

## phase-05 — publishRun application command {#phase-05-publish-run}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Add the single orchestrator that performs the full publication flow against the
`Git`, `GitHub`, and `FileSystem` ports: precondition checks, push, PR
reuse-or-create, `publication.json`, and the `final-report.md` PR section. Used
by both the CLI command (phase-06) and the auto-publish hook (phase-07).

### Detailed instructions

- First extend `RunReviewInfo` with `runTitle` (the plan's `run.title`) and
  populate it in `src/app/resolveRunInfo.ts` (the plan is already decoded there;
  read `plan.run.title`). This feeds `selectPrTitle`.
- Create `src/app/publishRun.ts` exporting
  `publishRun(info: RunReviewInfo, publish: ResolvedPublishConfig, opts: { repoRoot: string; verbose?: boolean }): Effect.Effect<PublicationResult, …, FileSystem | Git | GitHub | SystemTelemetry>`
  doing, in order:
  1. If `!publish.enabled`, return a `disabled` result (no-op).
  2. Preconditions (fail with a clear diagnostic; spec §4): `review-handoff.md`
     exists in `info.runPath`; the final phase branch exists
     (`git.branchExists`); the remote exists (`git.remoteExists`); `gh`
     available + authenticated + repo recognized. Each failure produces a
     `PublicationRecord` with the relevant `pushStatus`/`prStatus` and a
     `failureReason`, writes `publication.json`, updates `final-report.md`, and
     returns a `failed` result — it does **not** throw the run away.
  3. If `publish.pushBranch`, push `info.finalPhaseBranch` to `publish.remote`;
     set `pushStatus`. An already-pushed branch is success (phase-03 contract).
  4. If `publish.createPullRequest`, resolve base branch
     (`publish.baseBranch ?? gh.defaultBaseBranch`), then
     `findPullRequestForBranch`: if found, `prStatus: "exists"` and reuse the
     URL (no duplicate); else build the title via `selectPrTitle({ configuredTitle: publish.title, runTitle: info.runTitle, phaseTitle: info.finalPhaseTitle, shortName: info.shortName })`,
     read `review-handoff.md`, build the body via `buildPrBody`, write it to a
     body file under `info.runPath`, call `createPullRequest`, set
     `prStatus: "created"` and the URL.
  5. Write `publication.json` to `info.runPath` (via `encodePublication` +
     `fs.writeAtomic`). Do **not** import status encoders.
  6. Append/replace a `## Pull request` section in `final-report.md` from the
     `PublicationRecord` (PR URL, remote branch `origin/<branch>`, base branch,
     publication status, next action — or the failure reason + manual fallback
     `phax publish-pr <short-name>` on failure, per spec §12). Add a pure
     renderer (e.g. `renderPublicationSection(record)`) in `src/app/finalReport.ts`
     or a small helper module, and have `publishRun` rewrite the file.
  7. Emit `SystemTelemetry` events / verbose lines for: publication enabled,
     remote, branch, push result, PR attempt, PR URL or failure reason (spec
     §13). Record the git/gh commands for the trace audit (spec §18).
- Define `PublicationResult` (`{ kind: "disabled" | "published" | "failed"; record?; prUrl?; failureReason? }`).

### Planned files to create

- `src/app/publishRun.ts`
- `tests/integration/publishRun.test.ts`

### Planned files to edit

- `src/domain/runReviewInfo.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/finalReport.ts`

### Optional files that may be edited

- `src/domain/publish/index.ts`
- `tests/integration/finalReview.test.ts`

### Boundary contracts

Consumer (surface): CLI `publish-pr` (phase-06) and the executePlan hook
(phase-07) both call `publishRun(info, publish, opts)` and render its
`PublicationResult`. Producer: `publishRun`. Ports consumed: `Git.pushBranch`/
`branchExists`/`remoteExists`, all `GitHub` ops, `FileSystem`, `SystemTelemetry`.
Stable shape: `publishRun` never fails the effect for a publication problem —
problems are returned as a `failed` result with a written `PublicationRecord`;
it only fails the effect for unexpected I/O errors.

### Test strategy

Integration tests with the `Git`/`GitHub`/`FileSystem` fakes (domain↔app with
fake ports), modeled on `tests/integration/reviewHandoff.test.ts`:

- happy path: pushes, no existing PR → creates PR, writes `publication.json`
  with `prStatus: "created"` + URL, appends the PR section to `final-report.md`,
  verbose lines emitted;
- idempotency: existing PR for branch → `prStatus: "exists"`, reuses URL, no
  duplicate `createPullRequest` call;
- already-pushed branch → still success;
- `gh` unavailable / unauthenticated → `failed` result, `publication.json`
  written with the failure reason, `final-report.md` shows the manual fallback,
  effect does **not** fail;
- `enabled: false` → `disabled`, no side effects.
  Write the happy-path and idempotency tests before implementation.

### Implementation order

`RunReviewInfo.runTitle` plumbing → `PublicationResult` type → precondition
checks → push → PR reuse/create → `publication.json` write → `final-report.md`
section → telemetry/verbose.

### Excluded scope

- CLI registration — phase-06.
- The automatic end-of-run trigger — phase-07.
- New run states.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `publishRun` signature, `PublicationResult` shape, and the
  "publication failure is returned, never thrown" contract.
- The `final-report.md` PR-section renderer name/location and its success vs.
  failure layouts.
- That `RunReviewInfo` now carries `runTitle`.
- Confirmation `publishRun` does not import status encoders (single-writer
  guard).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(publish): add publishRun application command

### Commit body

Add publishRun, the single orchestrator for branch push + GitHub PR creation:
precondition checks, idempotent push, reuse-or-create PR with the deterministic
review-handoff body, publication.json metadata, and a Pull request section in
final-report.md. Publication failures are returned (not thrown) so the run is
never invalidated. Plumb run.title into RunReviewInfo. Covered by integration
tests with fake Git/GitHub/FS ports.

---

## phase-06 — `phax publish-pr` command {#phase-06-publish-pr-command}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add the manual retry command `phax publish-pr <short-name>` that resolves a
`review_open` run and invokes `publishRun`, wiring the real `Git`/`GitHub`/
`FileSystem`/`SystemTelemetry` layers.

### Detailed instructions

- Create `src/cli/commands/publishPr.ts`, modeled on
  `src/cli/commands/reviewHandoff.ts`:
  - Load config; if `publish.enabled` is false, still allow the command to run
    (the user is explicitly asking to publish) — but require a `provider` of
    `"github"`. Decide and document: the command publishes using the resolved
    `publish` config; if the block is entirely absent, error telling the user to
    configure `publish`. (Confirm this against the spec's intent that
    `publish-pr` recovers a configured-but-failed publication.)
  - Decode the short name, `resolveRunByShortName`; require `runState === "review_open"`
    (matching `review-handoff`'s guard) with a clear diagnostic otherwise.
  - Build a layer merging `NodeFileSystemLayer`, `NodeGitLayer`,
    `NodeGitHubLayer`, and the telemetry layer; run `publishRun`.
  - On `disabled`/`failed`/`published`, print the appropriate message; surface
    the PR URL prominently and copy-friendly on success, and the failure reason +
    `phax publish-pr <short-name>` retry hint on failure. Return exit code 0 when
    the run is intact even if publication failed? — return non-zero only when the
    operation itself could not be attempted; document the chosen convention in
    the handoff (recommended: exit 0 on `published`, non-zero on `failed`/usage
    errors so scripts can detect failure).
- Register the command in `src/cli/main.ts` (after `review-handoff`), passing
  `globalTraceOpts()` so `--verbose` controls logging.

### Planned files to create

- `src/cli/commands/publishPr.ts`
- `tests/unit/cli/publishPr.test.ts`

### Planned files to edit

- `src/cli/main.ts`

### Optional files that may be edited

- `tests/e2e/...` (only if an e2e harness for CLI commands already exists)
- `README.md`

### Boundary contracts

Producer: CLI surface. Consumer: the operator. Crosses surface → application via
`publishRun(info, publish, { repoRoot, verbose })`. Stable shape: exit-code
convention (document it) and the human-readable PR-URL / failure output.

### Test strategy

CLI smoke/unit test (`tests/unit/cli/publishPr.test.ts`) using the `OutputPort`
capture pattern from existing CLI tests and fake layers: asserts the
`review_open` guard, the disabled/absent-config error, and that a successful
`publishRun` prints the PR URL with exit 0. E2E only if the repo already has a
CLI e2e harness for similar commands.

### Implementation order

Command handler → layer wiring → `main.ts` registration → CLI test.

### Excluded scope

- The automatic end-of-run trigger — phase-07.
- Changing `publishRun` behavior — phase-05.

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The command name/signature and the exit-code convention chosen.
- The behavior when `publish` config is absent vs. `enabled: false`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): add phax publish-pr command

### Commit body

Add `phax publish-pr <short-name>`, the idempotent manual retry that resolves a
review_open run and invokes publishRun with the real Git/GitHub/FS layers,
printing the PR URL on success and the failure reason + retry hint otherwise.
Registered in main.ts with --verbose support. Covered by a CLI unit test.

---

## phase-07 — Auto-publish after final review {#phase-07-auto-publish}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Trigger publication automatically at the end of a successful run, after the run
has entered `review_open` and `review-handoff.md` is written, guarded by
`publish.enabled` and non-fatal on failure.

### Detailed instructions

- In `src/app/executePlan.ts`, after the `FinalReviewOpened` dispatch for the
  final phase succeeds (the run is now `review_open` and `review-handoff.md`/
  `final-report.md` exist), if `config.publish.enabled`, call
  `publishRun(infoResult.right, config.publish, { repoRoot: config.repoRoot, verbose })`.
  - Wrap it so a publication failure never fails the run: on a `failed`
    `PublicationResult`, the metadata + `final-report.md` already record it
    (phase-05); just log/trace. Catch unexpected port errors and convert to a
    recorded failure rather than propagating — the run already committed and is
    in `review_open`.
  - Ensure `GitHub` is in the layer stack the `executePlan` program runs under
    (add `NodeGitHubLayer` where the run command builds its layers — check
    `src/cli/commands/run.ts` / `runLayers.ts`). When `publish.enabled` is false,
    `publishRun` short-circuits, so the extra layer is harmless.
- Verbose output should match spec §13 (`Publishing branch to origin…`,
  `Branch pushed: …`, `Creating GitHub pull request…`, `Pull request created: <url>`).

### Planned files to create

- (none)

### Planned files to edit

- `src/app/executePlan.ts`
- `src/cli/commands/run.ts`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `tests/integration/executePlan.test.ts`

### Boundary contracts

Consumer: end-of-run flow needs publication exactly once after `review_open`.
Producer: `publishRun` (phase-05). Crosses application → application. Stable
shape: the hook calls `publishRun` and ignores its result for run-control
purposes (the run stays `review_open` regardless).

### Test strategy

Integration test extending `tests/integration/executePlan.test.ts` with fake
`Git`/`GitHub` layers: with `publish.enabled` and a single final phase, assert
the run reaches `review_open`, `publication.json` is written with a PR URL, and
`final-report.md` has the PR section; with `gh` unavailable, assert the run
still reaches `review_open` (non-fatal) and the failure is recorded. With
`publish.enabled` false, assert no publication side effects and no `GitHub`
calls.

### Implementation order

Layer wiring (add `NodeGitHubLayer` to the run layers) → guarded `publishRun`
call after `FinalReviewOpened` → non-fatal wrapping → verbose lines → tests.

### Excluded scope

- The `publish-pr` command — phase-06.
- New run states (publication failure is recorded, not a state).

### Verification

The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Where in `executePlan.ts` the hook lives relative to the `FinalReviewOpened`
  dispatch, and how failure is made non-fatal.
- That `NodeGitHubLayer` is now part of the run command's layer stack.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): auto-publish PR after final review when configured

### Commit body

After a successful run enters review_open and the review handoff is written,
invoke publishRun when publish.enabled, pushing the final branch and creating
the GitHub PR with the review handoff as its body. Publication failures are
non-fatal and recorded in publication.json/final-report.md; the run stays in
review_open. Adds NodeGitHubLayer to the run layer stack. Covered by executePlan
integration tests with fake Git/GitHub ports.
