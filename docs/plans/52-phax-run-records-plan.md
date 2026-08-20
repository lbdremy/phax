---
status: Draft
source-spec: docs/specs/29-phax-run-records.md
---

# phax run records

Implement `docs/specs/29-phax-run-records.md`: phax versions the per-phase artifacts it
already writes as **records** on a versioned orphan branch, addressed by the `Run-Id` and
`Phase-Id` its commit messages already carry, readable offline, and shared when the work is.

Nine phases, core-to-surface. The first four build a record that gets written; the next three
decide where it goes and how a project is set up for it; the last two make it travel and make
it readable. Every phase is independently committable and gate-verifiable.

**Ground established while planning** (read this before phase-01 — it is measured, not assumed):

- All three provider adapters already pipe raw provider stdout to `output.jsonl`
  (`src/infra/providers/claudeCode.ts:55`, `codexCli.ts:170`, `mistralVibe.ts:131`), so a
  transcript exists for every provider and each carries tool calls with inputs and results.
- **Token usage is not uniform.** Claude carries it in the `result` event, codex in
  `turn.completed.usage` — both inside `output.jsonl`. **vibe carries none in the stream**: it
  lives in `~/.vibe/logs/session/<id>/meta.json` under `.stats` (session token totals,
  `session_cost`, and `tool_calls_agreed` / `rejected` / `failed` / `succeeded`).
  `findVibeSessionId` in `src/schemas/vibeOutput.ts` already locates that directory.
- Phase commits already carry `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model`,
  `Effort`, `Worktree`, `Session-Id`, `Gate-Log` (`src/app/commit.ts:36-52`). **No new trailer
  is needed**, and spec §5.2 forbids adding one.
- `GitOps` (`src/ports/git.ts:15`) has no object plumbing, no clone and no fetch today; it has
  `pushBranch`, `commitPaths`, `diffNameStatus`, `headCommit`. `GitHubOps`
  (`src/ports/github.ts:12`) has `repoRecognized` but no visibility query.
- Extending either port means extending its fake (`src/infra/fakes/git.ts:32`,
  `src/infra/fakes/github.ts:22`). No new port is introduced by this plan, so
  `runLayers.ts` needs no new layer.
- Adding a CLI command drifts three generated artifacts that the `full` gate checks:
  `phax.usage.kdl`, `docs/cli/inventory.md`, `docs/cli/reference.md`
  (`tests/integration/docsCliDrift.test.ts`).

## Technical arbitrations

Resolved with the human before phases were written; do not re-litigate them in a phase.

- **One plan, nine phases**, rather than splitting the spec across two runs. Knowingly
  accepted: the run is longer than any in this repo's history (2–5 phases), so a red gate late
  in the run costs more, and the review diff is large.
- **An absent `records` block means records are off.** Knowingly accepted: the feature ships
  dormant and no existing project — phax included — records anything until someone runs
  `phax records init`. Chosen over defaulting to on, which would make ~2.2 MB per run appear
  in repos whose owners never asked, and would trip spec §5.4's public-repo refusal at the
  worst possible moment.
- **`claude-opus-4-8` only for the git object plumbing** (phase-03) and the writer that
  depends on it (phase-04); `claude-sonnet-5` elsewhere. Knowingly accepted: a non-uniform
  run. Writing a commit with no index and no working tree is where a plausible-but-wrong
  implementation passes the gates and corrupts the records branch. Note `claude-opus-5` is
  **not** in phax's model catalog (`src/domain/routing/defaults.ts` tops out at
  `claude-opus-4-8`) and the run-start preflight rejects unknown ids.
- **The `mistralVibe.ts` `--target` breakage is out of scope**, fixed separately. Knowingly
  accepted: phase-02's vibe usage capture cannot be exercised against a live `vibe` until that
  fix lands, so it is covered by fixture-based tests here.

## Required commands

- git log
- git show-ref
- git cat-file
- git ls-tree
- pnpm test:integration

## Required PHAX security configuration changes

This plan requires the following commands to be added to `security.agentCommands` in
`phax.json` before running:

- `git log`
- `git show-ref`
- `git cat-file`
- `git ls-tree`
- `pnpm test:integration`

The four `git` allowances are read-only inspection, needed because phases 03 and 04 build git
object plumbing and the agent must be able to observe refs, trees and blobs it just wrote
without going through a test run. `pnpm test:integration` lets those phases iterate on
integration tests without paying for the whole `pnpm test`. Without this configuration the
preflight check will fail before any agent spawns.

## phase-01 — Records configuration schema {#phase-01-records-config}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Teach `phax.json` to describe records: whether the transcript is included, where records go,
and whether they push automatically — with the destination modelled as a two-variant
discriminated union and a records remote that only accepts safe URL forms.

### Detailed instructions

- Add `src/schemas/recordsConfig.ts` exporting `RecordsConfigSchema` and a
  `resolveRecordsConfig` in the style of `resolvePublishConfig`
  (`src/schemas/phaxConfig.ts:31`).
- Shape: `{ transcript: boolean, destination: { kind: "in-repo" } | { kind: "repo", remote: string }, autoPush: boolean }`.
  Model `destination` as an Effect `Schema.Union` of two structs discriminated on `kind` —
  spec §5.4 admits exactly these two and no third state, so do **not** model it as one struct
  with an optional `remote`.
- The `remote` field must decode only `https://…`, `ssh://…` or `git@host:path` forms.
  Anything else — notably `ext::sh -c '…'`, which is remote code execution at clone time —
  must fail decoding with a message naming the field and the accepted forms. Spec §5.6.
- Wire `records: Schema.optional(RecordsConfigSchema)` into `PhaxConfigSchema`
  (`src/schemas/phaxConfig.ts:100`) and expose the resolved value on `ResolvedConfig`.
- **An absent block means records are off.** `resolveRecordsConfig(undefined)` must return a
  disabled value, not a default-on one. Every consumer must be able to ask "are records on"
  without inspecting the raw config.
- Do **not** add `records` to `PhaxUserOverlaySchema`: the destination is a project-level
  decision shared by the team, not a per-machine override.
- Regenerate the JSON Schema artifacts if the repo tracks them for `phax.json`
  (`getPhaxConfigJsonSchema` is generated on demand, so check before assuming a file changed).

### Planned files to create

- `src/schemas/recordsConfig.ts`
- `tests/unit/recordsConfig.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`

### Optional files that may be edited

- `phax.schema.json`

### Boundary contracts

The consumer is every later phase that needs to know whether records are on and where they
go; the producer is `ResolvedConfig`. The stable shape is the resolved records value — later
phases must never read `config.raw.records` directly.

### Test strategy

Unit tests, written before the implementation, since this is a decode boundary with an
explicit accept/reject contract:

- a config with no `records` block resolves to records off;
- each destination variant decodes, and a struct carrying both `kind: "in-repo"` and a
  `remote` is rejected;
- `https://`, `ssh://` and `git@host:path` remotes decode; `ext::sh -c 'x'`, a bare path and an
  empty string are rejected with a message naming the field.

### Implementation order

Schema and its union first, then the remote-form refinement, then the resolver, then the
wiring into `PhaxConfigSchema`.

### Excluded scope

- Any wizard or CLI surface (phase-07).
- Visibility detection and the public-repo refusal (phase-05).
- Reading or writing an actual record.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact export names and path of `src/schemas/recordsConfig.ts`, and the resolved type's
  shape as later phases will destructure it.
- Where the resolved value hangs off `ResolvedConfig`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): add the records configuration schema

### Commit body

Describe records in phax.json: a transcript toggle, a two-variant destination discriminated on
kind, and an auto-push flag. The records remote decodes only https, ssh and git@ forms, so a
hostile ext:: URL in a project's config cannot reach git clone. An absent records block
resolves to records off, so the feature ships dormant for every existing project.

## phase-02 — Record schema and assembly {#phase-02-record-schema}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Define what a record *is* — its manifest and the set of artifacts it carries — and the pure
function that assembles one from a phase folder, including the provider-specific token usage
sources measured while planning.

### Detailed instructions

- Add `src/schemas/runRecord.ts` with the record manifest schema (`record.json`): record key
  (`runId`, `phaseId`), `shape: "full" | "skeleton"`, the source commit sha as a back-reference
  that may go stale, model, effort, provider, phase outcome, and token usage.
- **Token usage is a declared-optional value, not a number that defaults to zero.** Model it as
  a present-with-values or explicitly-unavailable variant, per spec §5.5. Reporting an
  unavailable usage as `0` is the failure this shape exists to prevent.
- Add `src/domain/records/assemble.ts`: given a phase folder listing and the records config,
  return the ordered set of artifact paths the record carries plus the manifest. Pure — no
  filesystem access, no git. Take the directory listing as input.
- Skeleton = everything except `output.jsonl`. Full = skeleton plus `output.jsonl`. Skeleton is
  produced both when `transcript: false` and when the provider produced no transcript.
- Usage extraction, per the measured table in the overview: Claude from `output.jsonl`'s
  `result` record, codex from `turn.completed.usage`, vibe from the session `meta.json`
  `.stats`. Keep the extraction functions pure over already-read text so they unit-test from
  fixtures.
- Reuse the existing fixtures where they fit (`tests/unit/providers/fixtures/`) and add richer
  ones capturing a tool-using turn for codex and vibe.

### Planned files to create

- `src/schemas/runRecord.ts`
- `src/domain/records/assemble.ts`
- `src/domain/records/usage.ts`
- `tests/unit/runRecord.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/recordsUsage.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/unit/providers/fixtures/codex-exec-sample.jsonl`
- `tests/unit/providers/fixtures/vibe-streaming-sample.jsonl`

### Boundary contracts

Consumer: the writer in phase-04, which needs a list of paths to hash and a manifest to
serialize. Producer: `assemble`. The contract is that assembly is a pure decision — the writer
performs no selection of its own.

### Test strategy

Unit, test-first — this is domain logic with no I/O:

- a phase folder with `output.jsonl` and `transcript: true` assembles a full record; the same
  folder with `transcript: false` assembles a skeleton;
- a phase folder with no `output.jsonl` assembles a skeleton whatever the toggle;
- all `checks-attempt-NN.log` files land in one record, in order — one record per phase
  whatever the number of fix-loop attempts (spec §5.1);
- usage extraction from a Claude `result` line, a codex `turn.completed` line, and a vibe
  `meta.json` `.stats` object; and a phase whose usage is absent yields the unavailable
  variant, never zero.

### Implementation order

Manifest schema, then usage extraction per provider, then assembly composing both.

### Excluded scope

- Writing anything to git (phase-03 and phase-04).
- Reading the phase folder from disk — assembly takes a listing.
- Rendering a record for a human (phase-09).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The manifest field names as serialized, and the usage variant's exact shape.
- The `assemble` signature and what it expects the caller to have read.
- Which provider usage sources are covered and which are fixture-only.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): define the record manifest and its assembly

### Commit body

A record is a manifest plus the phase artifacts it carries: the skeleton always, output.jsonl
when the transcript is enabled and the provider produced one. Assembly is pure and takes a
directory listing, so the writer performs no selection of its own.

Token usage is a declared-optional value rather than a number, because it is not uniform
across providers: Claude and codex carry it in the transcript stream, vibe carries none there
and keeps it in its session meta.json. An unavailable usage is reported as unavailable, never
as zero.

## phase-03 — Git object plumbing behind GitPort {#phase-03-git-plumbing}

**Recommended model:** claude-opus-4-8
**Recommended effort:** xhigh

Give `GitOps` the ability to write a commit from a set of files without touching the working
tree or the index, and to read one back — the one genuinely new capability this spec needs.

### Detailed instructions

- Extend `GitOps` (`src/ports/git.ts:15`) with the plumbing operations the records writer
  needs: hash a file into the object database, build a tree from a set of path/blob pairs,
  create a commit from a tree with a parent, and move a ref to it. Also add the read side:
  resolve a ref, list a tree, and read a blob's contents.
- Implement in `src/infra/git.ts` by shelling `git hash-object -w`, a temp-index
  `git write-tree` driven by `GIT_INDEX_FILE` pointing at a scratch path, `git commit-tree`,
  and `git update-ref`. **The working tree and the index must be untouched** — the temp index
  must never be the repo's own `.git/index`, and no `git add`, `git checkout` or `git stash`
  may appear anywhere in the implementation. Spec §5.3.
- The ref target is an ordinary branch, `refs/heads/phax/records/v1` — not a custom ref
  namespace. Spec §5.3 and the storage rationale in the spec's §1.
- The branch is an **orphan**: the first record commit has no parent; subsequent ones parent
  onto the current branch tip.
- Extend `FakeGitImpl` (`src/infra/fakes/git.ts:32`) with in-memory equivalents so existing
  unit tests that construct the fake keep compiling.
- Do not add clone, fetch or refspec push here — phase-06 adds those, and mixing local object
  writing with network operations in one commit makes both harder to review.

### Planned files to create

- `tests/integration/gitObjectPlumbing.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`

### Optional files that may be edited

- `tests/type/brands.ts`

### Boundary contracts

Consumer: the records writer (phase-04), which needs "write these files as a commit on this
branch" and "read that commit back". Producer: `GitOps`. The contract must be expressible
without the caller knowing about indexes, trees or refs beyond the branch name.

### Test strategy

Integration tests against real temporary git repositories — fakes would test nothing here,
since the entire subject is real git behavior. Write them before the implementation:

- writing a record commit into a repo with a dirty working tree leaves `git status` byte-for-
  byte identical, and leaves the repo's own index untouched;
- the first write creates an orphan branch with no parent; the second parents onto the first;
- the written tree is readable back through the read operations, and through plain `git
  cat-file` outside phax;
- writing while a checkout is on another branch does not switch branches.

### Implementation order

Port signatures first, then the adapter, then the fake, then the integration tests turn green.

### Excluded scope

- Clone, fetch, and pushing a refspec (phase-06).
- Any knowledge of what a record contains (phase-02 owns that).
- Retention, pruning, or garbage collection of records.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact new `GitOps` member names and signatures, as phase-04 will call them.
- How the temp index path is chosen and cleaned up.
- Confirmation, with the command used, that the working tree and index are untouched.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(git): add object plumbing for tree-only commits

### Commit body

Add the ability to write a commit from a set of files and move a branch to it without touching
the working tree or the index, plus the read side needed to get it back. Implemented with
hash-object, a temp-index write-tree driven by GIT_INDEX_FILE, commit-tree and update-ref, so
no checkout, add or stash is involved at any point.

The target is an ordinary branch rather than a custom ref namespace, because a namespace is
neither cloned nor fetched by default, which would defeat records travelling with a clone.
Covered by integration tests against real temporary repositories, asserting that a dirty
working tree is left byte-for-byte unchanged.

## phase-04 — Write a record per phase {#phase-04-record-writer}

**Recommended model:** claude-opus-4-8
**Recommended effort:** high

Assemble and write one record per phase into the source repo, at every terminal phase outcome
— including a phase that failed without committing — and wire it into the run.

### Detailed instructions

- Add `src/app/writeRecord.ts`: read the phase folder, call `assemble` (phase-02), write the
  files through the plumbing (phase-03) under a key of `Run-Id`/`Phase-Id`, and return what
  was written.
- Call it from `src/app/executePlan.ts` at every **terminal phase outcome**, not from
  `src/app/commit.ts`: spec §5.1 requires a record for a phase that failed, was abandoned or
  was interrupted, and those never reach the commit path. One call site, so the two cases
  cannot drift.
- **No record for phax's own bookkeeping commits** — the archival/completion commit has no
  agent session behind it. Spec §5.1.
- **Exactly one record per phase**, whatever the number of fix-loop attempts: the record
  carries every `checks-attempt-NN.log`, it is not written once per attempt.
- The record's source sha is a back-reference recorded when one exists, and absent for a phase
  that never committed. It is never the address.
- This phase targets the **in-repo destination only** — records land on `phax/records/v1` in
  the source repo. The dedicated destination and its local clone arrive in phase-06. When the
  configured destination is a repo, this phase writes nothing and says so; phase-06 completes
  it.
- Records are off unless configured on (phase-01), so every existing run path must behave
  exactly as today when the block is absent — assert this rather than assume it.

### Planned files to create

- `src/app/writeRecord.ts`
- `tests/integration/writeRecord.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`

### Optional files that may be edited

- `tests/integration/executePlan.test.ts`

### Boundary contracts

Consumer: `executePlan`, which knows a phase just reached a terminal state and where its folder
is. Producer: `writeRecord`. The contract is that the run hands over a phase folder and an
outcome, and gets back a written record or an explicit "records are off".

### Test strategy

Integration, since this composes real git plumbing with real phase folders:

- a phase folder with two `checks-attempt` logs produces exactly one record holding both;
- a phase that ends without a commit still produces a record, and the manifest records no
  source sha;
- records off means nothing is written and no branch is created;
- writing a record leaves the run's own worktree clean.

### Implementation order

The writer against a fabricated phase folder first, then the `executePlan` call site, then the
failed-phase path.

### Excluded scope

- Choosing the destination and refusing on a public repo (phase-05).
- The dedicated records repo and its local clone (phase-06).
- Pushing anything (phase-08).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `writeRecord` signature and where in `executePlan` it is called from, by function name.
- How a failed phase reaches the writer, and what its manifest looks like.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): write one record per phase into the source repo

### Commit body

Assemble each phase's artifacts and write them as a record on phax/records/v1, keyed by the
Run-Id and Phase-Id the commit message already carries, so no new trailer is needed and the key
survives a rebase that rewrites the sha.

Called from the run at every terminal phase outcome rather than from the commit path, because a
phase that failed without committing still deserves a record and never reaches a commit. The
source sha is recorded as a back-reference expected to go stale, never as an address. With no
records block configured, nothing is written and the run behaves exactly as before.

## phase-05 — Destination policy and the visibility guard {#phase-05-destination-policy}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Decide where records go from the source repo's visibility, and refuse the one combination that
would publish transcripts — without ever making that choice silently.

### Detailed instructions

- Add `visibility()` to `GitHubOps` (`src/ports/github.ts:12`) beside `repoRecognized`,
  shelling `gh` in `src/infra/github.ts`, returning public / private / unknown. Extend
  `FakeGitHubImpl`.
- Add `src/domain/records/destination.ts`: a pure decision from (records config, detected
  visibility) to either an allowed destination or a named refusal. Spec §5.4.
- Rules: private source → in-repo is allowed; transcripts on + in-repo + **detected public** →
  refuse, naming the destination and the remedy; host visibility undetectable → require the
  explicit acknowledgement recorded in configuration; transcripts **off** → in-repo is allowed
  whatever the visibility.
- **Detection guards, it never chooses.** The configured destination is the input; visibility
  can only reject it. A wrong auto-guess in the unsafe direction leaks transcripts, so there
  must be no code path where phax picks a destination on the user's behalf.
- Surface the refusal through `OutputPort` wherever records are about to be written, with the
  exit code and named cause of spec §6.

### Planned files to create

- `src/domain/records/destination.ts`
- `tests/unit/recordsDestination.test.ts`

### Planned files to edit

- `src/ports/github.ts`
- `src/infra/github.ts`
- `src/infra/fakes/github.ts`
- `src/app/writeRecord.ts`

### Optional files that may be edited

- `src/schemas/recordsConfig.ts`

### Boundary contracts

Consumer: the writer and, later, the setup command — both need "may I write here, and if not,
why". Producer: the pure destination decision. The refusal must carry enough to render a
message without the caller re-deriving the reason.

### Test strategy

Unit tests over the decision table, test-first — this is the security-relevant core of the
spec, and every row is a named case:

- private + transcripts on + in-repo → allowed;
- public + transcripts on + in-repo → refused, and the refusal names the destination;
- public + transcripts off + in-repo → allowed;
- unknown visibility + transcripts on + no acknowledgement → refused;
- a dedicated destination is allowed whatever the visibility.

Plus one integration test that the refusal reaches the CLI with a non-zero exit.

### Implementation order

The pure decision and its table first, then the port and adapter, then the call site in the
writer.

### Excluded scope

- Cloning or syncing the dedicated destination (phase-06).
- Asking any of this interactively (phase-07).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The decision function's signature and the exact refusal cases it can return.
- The `visibility()` contract, including what `unknown` means for a non-GitHub host.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): follow repo visibility and refuse unsafe destinations

### Commit body

Decide the records destination from the source repo's visibility and refuse the one
combination that would publish transcripts with the code: transcripts on, records in-repo, and
a repo detected public. Where the host's visibility cannot be determined, an explicit
acknowledgement is required instead.

Detection guards the configured choice, it never makes one — a wrong guess in the unsafe
direction leaks transcripts, so there is no path where phax picks a destination on the user's
behalf. With transcripts off, in-repo is allowed whatever the visibility, since a skeleton
record carries no agent transcript.

## phase-06 — Local records clone and reconciliation {#phase-06-records-sync}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Make the dedicated destination work: a persistent local clone that is the read and write path,
a reconciliation that brings it in line with the configured remote, and a run that refuses
early when it is not there.

### Detailed instructions

- Extend `GitOps` with clone, fetch and a branch push against an explicit remote URL — the
  network half deliberately left out of phase-03.
- Add `src/app/recordsSync.ts` implementing the reconciliation table of spec §5.7 as a single
  function over (desired config, actual local state): no clone + reachable remote → clone;
  clone present with matching origin → fetch; clone present with **different** origin → refuse
  rather than re-point; local-only repo holding commits + non-empty remote configured → refuse
  with the remedy; in-repo destination → nothing to bootstrap.
- The clone lives at `~/.phax/records/<name>/`, keyed by the project `name` from `phax.json`,
  matching the existing `~/.phax/runs/<name>.<shortName>` layout. It is a **full** clone: a
  blobless partial clone would defeat the offline read this design exists to guarantee.
- Teach phase-04's writer to target the local clone when the destination is a dedicated repo,
  so the write path is identical offline.
- Add the run preflight: a dedicated destination with no local clone **refuses the run before
  any phase spawns**, naming `phax records sync` and the destination it would clone. Spec
  §5.7. phax never clones on its own here — the URL comes from a config someone else authored.
- phax never creates the records repo: a configured destination that does not exist is a
  refusal with a remedy, not an opportunity.

### Planned files to create

- `src/app/recordsSync.ts`
- `tests/integration/recordsSync.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/app/writeRecord.ts`
- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/app/phaxState.ts`

### Boundary contracts

Consumer: the run preflight and the future `records sync` command, both needing "make the
local state match the config, or tell me precisely why you won't". Producer: `recordsSync`.
Every refusal must name its remedy.

### Test strategy

Integration against real temporary repositories acting as remotes — the failure modes are all
real git states:

- no local clone + a reachable remote → cloned, and a second call fetches rather than
  re-clones;
- a local clone whose origin differs → refused, and the local clone is left untouched;
- a local-only repo with commits + a non-empty remote → refused with the remedy;
- a run configured for a dedicated destination with no clone refuses before the first phase
  spawns, and the message names the command and the destination.

### Implementation order

Port additions, then the reconciliation function against fabricated states, then the writer's
new target, then the run preflight.

### Excluded scope

- Pushing at publish (phase-08) — this phase pushes only when reconciliation is explicitly
  asked to.
- The `phax records sync` CLI command surface (phase-07 registers the command group).
- Retention and pruning.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The clone path convention and the reconciliation function's signature.
- Every refusal case and its message, verbatim, since phase-07 and phase-08 render them.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): reconcile a local records clone with its remote

### Commit body

Make the dedicated destination usable offline: a full persistent clone under the state root is
the read and write path, and the network is a sync concern only. One reconciliation function
covers every pairing of desired config and actual local state, refusing rather than guessing
when the origin differs or when a local-only history meets a non-empty remote.

A run configured for a dedicated destination with no local clone refuses before the first
phase spawns, naming the command and the destination. phax does not clone on its own there:
the URL comes from a config someone else authored.

## phase-07 — Setup surface {#phase-07-setup-surface}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Let a project turn records on: the three-question block in `phax init`, the same questions as
`phax records init` for projects that already exist, and the `records` command group.

### Detailed instructions

- Add `src/app/configureRecords.ts` — the single use case that asks the questions through the
  `Prompt` port, writes the `records` block, and calls the phase-06 reconciliation. Both entry
  points call it; no logic in either CLI file.
- Extend the `phax init` wizard (`src/app/initWizard.ts:77`) with the block, in order:
  (1) include the transcript?, (2) the records remote — **asked only where spec §5.4 requires a
  dedicated destination**, required and with no default, (3) push automatically?
- **The destination is announced, never asked.** There must be no select between in-repo and a
  dedicated repo: it follows visibility, and offering it would exist only to let someone pick
  the combination phase-05 refuses. Show the consequence as a note instead.
- When the destination is the source repo and transcripts are on, **state that making the repo
  public later publishes every transcript already in its history** (spec §5.6). This is a
  disclosure the wizard owes the user at the moment of the choice.
- `phax records init [--force]` refuses on an already-configured project unless `--force`,
  mirroring `phax init`'s `already_initialized` behavior (`src/cli/commands/init.ts:36`).
- Register a `records` command group in `src/cli/program.ts` with `init` and `sync`
  subcommands; `status`, `list` and `explain` join it in phases 08 and 09.
- Regenerate the three CLI artifacts the gate checks: `phax.usage.kdl`, `docs/cli/inventory.md`
  and `docs/cli/reference.md`.

### Planned files to create

- `src/app/configureRecords.ts`
- `src/cli/commands/records.ts`
- `tests/integration/recordsInit.test.ts`

### Planned files to edit

- `src/app/initWizard.ts`
- `src/cli/program.ts`
- `phax.usage.kdl`
- `docs/cli/inventory.md`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/cli/commands/init.ts`
- `tests/integration/initWizard.test.ts`

### Boundary contracts

Consumer: two CLI entry points needing the same configuration outcome. Producer:
`configureRecords`. The CLI files must reduce to argument parsing, one call, and rendering —
the repo's `cli-view-layer` rule.

### Test strategy

Integration with a fake `Prompt`, since the subject is a scripted interaction:

- answering "no" to the transcript question still configures records (a skeleton record is
  written, not none) — spec §5.5;
- a public source repo with transcripts on demands a remote and never offers in-repo;
- an in-repo destination with transcripts on emits the public-later disclosure;
- `phax records init` on an already-configured project refuses, and `--force` reconfigures;
- a rejected remote URL fails before anything is written.

### Implementation order

The use case first, then the wizard block, then the command group, then regenerate the CLI
artifacts.

### Excluded scope

- `records status`, `list` and `explain` (phases 08 and 09).
- Creating a repository on a hosting account — always a refusal with a remedy.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `configureRecords` signature and the exact question order.
- The registered command names and flags, as the remaining phases extend the same group.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): add the records setup surface

### Commit body

Let a project turn records on, through the init wizard for new projects and phax records init
for existing ones, both behind a single use case so the CLI stays a view layer. The destination
is announced rather than asked: it follows the source repo's visibility, and a select between
in-repo and a dedicated repo would exist only to let someone pick the combination phax refuses.

Choosing an in-repo destination with transcripts on states plainly that making the repo public
later republishes every transcript already in its history — the one residual risk of this
design, disclosed where the choice is made.

## phase-08 — Push at publish and pending visibility {#phase-08-push-and-pending}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Share records exactly when the work is shared, and make an unpushed record impossible to miss.

### Detailed instructions

- Where auto-push is on, push the run's records when the run is **published**
  (`src/app/publishRun.ts`), whatever the destination. Records mirror the work rather than lead
  it: the record is already committed locally when its phase commits, so publish adds sharing
  only. Spec §5.8.
- **A failed records push must never fail the run, the phase, or the publish.** It leaves the
  records pending.
- Track pending records durably enough to be reported after the process exits — a run whose
  records never pushed must still be reportable tomorrow.
- Report the pending count in `phax ls` as a column, and the detail — which run, which phases —
  in a new `phax records status` naming the destination and the local clone.
- Regenerate the three CLI artifacts.

### Planned files to create

- `src/app/recordsStatus.ts`
- `tests/integration/recordsPush.test.ts`

### Planned files to edit

- `src/app/publishRun.ts`
- `src/app/recordsSync.ts`
- `src/cli/commands/records.ts`
- `src/cli/commands/ls.ts`
- `src/cli/program.ts`
- `phax.usage.kdl`
- `docs/cli/inventory.md`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/app/registry.ts`
- `tests/integration/publishRun.test.ts`

### Boundary contracts

Consumer: `publishRun`, which must not learn how records are stored, and `ls`, which needs a
count. Producer: the records push and status functions. Publishing must degrade to a warning,
never to a failure.

### Test strategy

Integration:

- a run that completes without being published leaves its records committed locally and absent
  from the remote; publishing the same run puts them on the remote;
- a remote that rejects the push leaves the publish successful and the records pending;
- `phax ls` shows the pending count and `phax records status` names the run and its phases;
- with records off, neither surface changes.

### Implementation order

The push at publish, then pending tracking, then `records status`, then the `ls` column.

### Excluded scope

- `records list` and `records explain` (phase-09).
- Retrying a failed push automatically.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Where the push hooks into `publishRun`, and how a failure is recorded rather than raised.
- How pending state is persisted and read back.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): push records at publish and surface pending ones

### Commit body

Share records exactly when the work is shared. The record is already committed locally when its
phase commits, so deferring the push to publish loses nothing and keeps records from describing
commits that exist on no remote: phase commit to record committed, run publish to records
pushed.

A failed push never fails the run, the phase or the publish — it leaves the records pending,
counted in ls and detailed in records status, because a push that silently never happened is
the failure mode this design has to avoid.

## phase-09 — Read a record back {#phase-09-records-read}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Deliver the payoff: from a commit sha to the prompt, diff, gate outcome, handoff, transcript
and token usage that produced it — offline, and without ever reporting a local miss as an
absence.

### Detailed instructions

- Add `phax records list [--run <id>]` and `phax records explain <sha>` to the command group.
- `explain` resolves the record key from the commit's `Run-Id` and `Phase-Id` trailers — never
  by sha. A commit with **no phax trailers** is a distinct outcome: report that it was not
  produced by a phax phase, which is not the same as "no record for this commit". Spec §5.2.
- Read from the local records clone or the source repo's **remote-tracking ref**
  (`refs/remotes/origin/phax/records/v1`), never requiring a checked-out local records branch —
  otherwise a fresh clone would need a sync before the one command that should just work.
- A local miss with a reachable remote refreshes and re-resolves before reporting. A local miss
  while offline reports **"no record locally; the remote was not consulted"** — never "no
  record". Spec §5.9; this is the false-negative class that would have inverted a spike verdict.
- Report the record's shape (full or skeleton) and its token usage, including the explicitly
  unavailable case from phase-02 — never as zero.
- Render through `OutputPort` following the §6 sketch: identity line, run, record shape, gates,
  source sha with a note when it is unreachable, and the sizes of prompt, diff and handoff,
  with sub-flags to print each in full.
- Regenerate the three CLI artifacts.

### Planned files to create

- `src/app/recordsExplain.ts`
- `src/app/recordsList.ts`
- `tests/integration/recordsExplain.test.ts`

### Planned files to edit

- `src/cli/commands/records.ts`
- `src/cli/program.ts`
- `phax.usage.kdl`
- `docs/cli/inventory.md`
- `docs/cli/reference.md`

### Optional files that may be edited

- `docs/acceptance-coverage.md`

### Boundary contracts

Consumer: a human at a terminal holding a sha. Producer: `recordsExplain`. The three outcomes —
record found, commit not produced by a phax phase, and no record found locally — must be
distinguishable by exit code and message, not by prose alone.

### Test strategy

Integration, covering the full acceptance list of spec §8:

- a rebase-merged commit whose sha changed still resolves its record through its trailers;
- a hand-written commit with no trailers reports "not produced by a phax phase" and exits
  non-zero;
- a record present only on the remote, with the network down, reports "no record locally; the
  remote was not consulted";
- a skeleton record reports as a skeleton, and a vibe phase reports usage from its captured
  session statistics;
- `records list` shows a failed phase's record.

### Implementation order

Trailer resolution, then reading from the clone or the tracking ref, then rendering, then
`list`.

### Excluded scope

- Cross-run summaries, digests, `activity` or `recap`.
- Semantic search of any kind.
- A machine-readable `--json` output — not in the spec's surface.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The three outcomes, their exit codes and their messages verbatim.
- Where the reader resolves refs from, and the fallback order.
- A note on which spec §8 acceptance criteria are now covered by tests, and any that are not.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(records): explain a commit from its record

### Commit body

Turn a commit sha into the prompt, diff, gate outcome, handoff, transcript and token usage that
produced it, resolving the record through the Run-Id and Phase-Id trailers rather than by sha,
so a rebase that rewrites history keeps the record reachable.

Reads from the local clone or the remote-tracking ref, so a fresh clone needs no sync first. A
local miss refreshes when the remote is reachable and, when it is not, reports that no record
was found locally and the remote was not consulted — never that no record exists, which is the
false negative this command must never produce.
