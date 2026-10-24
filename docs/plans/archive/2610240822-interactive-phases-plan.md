---
status: Abandoned
source-spec: docs/specs/2610211403-interactive-phases.md
completes-spec: true
---
# Stop records, transcripts and the run list

Plan 3 of 3 for the interactive-phases spec (`docs/specs/2610211403-interactive-phases.md`). This run completes the spec. Plan 1 (PR #157, `docs/plans/archive/2610220954-interactive-phases-plan.md`) landed the declared stop, and plan 2 (PR #158, `docs/plans/archive/2610231043-interactive-phases-plan.md`) landed the hold. This plan extends their code rather than building copies beside it:

- one close: `src/app/closeStop.ts`;
- one record writer: `writeRecordForPhase` in `src/app/executePlan.ts` and `src/app/writeRecord.ts`;
- one stop reader: `src/app/interactiveFiles.ts`.

After this plan:

- every close records who closed it, read from the main checkout's git configuration;
- every close copies each recorded session's transcript into `<run>/<phase>/interactive-transcripts/<session id>.jsonl`, or records it as missing with a reason;
- a declared phase writes its record at closing, once, as a held phase does;
- every stop's record names its mode, cause, outcome and closer, and its sessions with their transcript digests;
- a held record names its review commit, and its usage leaves out the closing turn on every provider;
- `phax records explain` finds the record from a review commit and shows the stop's lines;
- the phase's `security.json` says that the person's work ran outside phax's enforcement, and names each turn phax ran;
- `phax ls --json` prints a versioned `run-list` document whose runs embed their review-stop document;
- the compliance reviewer, `review-handoff.md` and the PR body show each stop;
- `phax plans estimate` names an interactive phase and sizes only its turns.

The order runs from the core to the surface:

- phase-01: the closing identity;
- phase-02: transcript capture;
- phase-03: the records of a stop;
- phase-04: `records explain` on both commits, and the security record;
- phase-05: the run list;
- phase-06: the compliance review, the review handoff and the PR body, plus the check that runs without a stop are unchanged;
- phase-07: cost and the estimate;
- phase-08: the docs, the e2e trace snapshots and NEXT_STEPS.

No phase edits a file under `.claude/`, so the run needs no `--allow-skill-edits`.

Test rules for every phase:

- Fixtures are made up: the invoice-export, credit-notes and payments-fix runs, Ada Example, the session ids X0, X1, X2 and C1, and the commits C2 and R2.
- Every suite stubs HOME to a temporary directory. Fake provider CLIs keep their session stores under it (`tests/helpers/fakeProviderCli.ts`). No test reads `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, or a global git config. Suites mock `loadProviderConfig` and its siblings, as the stopped-run suites do.
- Tests assert `$schema` URLs by format id and release pattern.
- A test that starts the phax CLI as a process gives it its own temporary repository as its working directory.
- The e2e suites run only with `PHAX_E2E_RUN=1`, outside the standard gate.

The review of plan 2 (#158) left seven lessons, and this plan applies each from the start:

1. Every write at closing has a defined interrupt and refusal path (see Technical arbitrations).
2. Everything the close and the record need is read inside the close or before `RunResumeRequested`.
3. HOME is stubbed in every suite.
4. Published JSON Schemas match their strict decoders.
5. All I/O goes through ports.
6. Every in-scope §8 criterion has its own test, named on a Test strategy line.
7. Effects are traced, and the e2e snapshots are updated.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

`security.agentCommands` in `phax.json` already allows each command above, so no configuration change is needed. They are declared so the preflight confirms it:

- `pnpm exec tsx` regenerates the schema snapshots (`pnpm exec tsx scripts/schemas-check.ts --write`);
- `pnpm gen:usage-spec` regenerates `phax.usage.kdl`;
- `pnpm docs:cli` regenerates `docs/cli/`.

## Technical arbitrations

- Persisted shapes change in place, and no frozen module is added. 0.26.0 is uncut: `package.json` opens 0.26.0, the last tag is v0.25.0, and `packages/schemas/history.lock.json` freezes nothing at 0.26.0. Each format this plan changes already has a `next.schema.json` snapshot, which `pnpm exec tsx scripts/schemas-check.ts --write` rewrites:
  - phase-status: the closed `stop` gains `closedBy`;
  - interactive-session: gains `transcripts` and `builderUsage`;
  - phase-record-manifest: gains `mode` and `stop`.
  The brief assumed phase-record-manifest was still at its 0.25.0 shape. It is not: oracle-phases plan 1 already added `oracle` to its 0.26.0 shape (`CURRENT_STAMPS` names 0.26.0). Its shape did not change from 0.17.0 to 0.25.0, so the existing frozen 0.17.0 decoder reads every record stamped 0.17.0 to 0.25.0, and the pre-schema decoder reads the older ones. Both lifts gain `mode: headless` and `stop: null` beside `oracle: null`: `readPhaseRecordManifestAs` in `src/schemas/persisted.ts` and `toLatestPhaseRecordManifest` in `packages/schemas/src/formats/recordManifests.ts`.
  review-stop and cost-ledger do not change. run-list is new and born with `$schema`, so it has no frozen decoder. `security.json` is not a `$schema` format: it moves from `version: 1` to `version: 2` with a required `stop`, and its one reader lifts a version-1 file with `stop: null`.
  Loss accepted: a run started by a 0.26.0 development build before this plan, with a closed stop or an interactive-session.json, does not resume. This follows plan 2's precedent. Open question q-dev-records asks whether records that development builds wrote must still read.
- Each fact of a stop is written in one place and read from there.
  1. `closedBy` lives in the phase status's four closed `stop` variants. The close's state event (`StopCommitted`, `HeldStopClosed`) writes it, so it lands atomically with the transition.
  2. The recorded sessions stay in interactive-session.json (`current` and `history`).
  3. Each recorded session's transcript outcome lives in interactive-session.json's new required `transcripts`: null until a close captures them, then one entry per recorded session.
  4. A held phase's builder usage lives in interactive-session.json's new required `builderUsage`: the `TokenUsage` read once at the hold point, or null at a declared stop.
  5. The record manifest copies 1–4, because the run folder never reaches the records branch and a record must stand alone.
  The review handoff and the PR body read the phase statuses and the interactive handoff files. `records explain` reads only the manifest.
- The record manifest gains a required `mode` (`headless | interactive`) and a required `stop`. `stop` is null for a phase that never stopped, or one of four strict structs: declared corrected, declared unchanged, held corrected (with `reviewCommit`, a full sha) and held unchanged. Each struct carries `closedBy: { name, email }` and `sessions`, an array that is empty when there were none.
  A session is `{ provider, model, sessionId, origin: first-turn | new-session | builder, transcript }`. `transcript` is `{ status: captured, sha256 }` or `{ status: missing, reason: not-found | unreadable, detail }`.
  A held record's `sourceSha` stays the phase commit. Every struct is decoded with `onExcessProperty: error` and published with `additionalProperties: false`.
- `phax records explain` finds a held phase's record from its review commit through the trailers that commit already carries: `Run-Id` with `Held-Phase` addresses the record `<Run-Id>/<Held-Phase>`. `Run-Id` with `Phase-Id` still takes precedence, so a phase commit, and a declared commit (which carries both `Phase-Id` and `Interactive-Phase`), resolve as today. No manifest is scanned: phax writes the trailers, and the record key is the address.
- A declared phase's record names the phase's routed assignment from its `model-resolution.json`: the provider, concrete model and effort that every first and closing turn ran at (§5.7), whether or not a first turn answered. Its outcome is `committed`, its `sourceSha` is the declared commit, and its `usage` is `{ available: false }`, because no agent session built the phase; the turns' own cost is in the cost ledger. Loss accepted: a declared record shows no token usage.
- A held record's usage is the builder's usage at the moment the run stopped. The hold point reads it with `computeRecordUsage` and keeps it as `builderUsage`, and the record written at closing uses it on every provider:
  - on mistral-vibe, this leaves out the closing turn, whose resume of the builder session grows the session's `meta.json`;
  - on Claude Code and codex, it equals what `output.jsonl` gives, because no closing turn writes that file.
  `writeRecord` takes the usage as an explicit source: `{ kind: session, sessionId }` for a headless phase (as today), `{ kind: recorded, usage }` for a held phase, and `{ kind: none }` for a declared phase.
- Transcript capture goes through the existing Backend port, which gains `captureTranscript`. Each provider adapter implements it once (`src/infra/providers/claudeCode.ts`, `codexCli.ts`, `mistralVibe.ts`), and the existing dispatcher routes it. Loss accepted: Backend stops being only about running agents (it already holds the Claude-only `probe`). The alternative, a new port, would add a requirement that every one of the 39 suites running `executePlan` or `closeStop` must provide.
  Where each store is found:
  - Claude Code: `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<worktree slug>/<id>.jsonl`, falling back to a listing of `projects/`'s directory names.
  - codex: `<CODEX_HOME or ~/.codex>/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`, listing the date directories around the session's start first.
  - mistral-vibe: the `<VIBE_HOME or ~/.vibe>/logs/session/session_*` directory whose `meta.json` names the session id, as phax already finds it, then that directory's `messages.jsonl`. That file name is unverified against a current vibe, like `vibe --resume`. A directory without it gives `missing`.
  An adapter reads only the session's own files, never a credential or configuration file, and reads directories only for their names. A session id that does not match `^[A-Za-z0-9._-]+$` is never used in a path: its transcript is `missing` (`unreadable`).
- A close captures the recorded sessions of interactive-session.json, `history` then `current`, each session id once. They are the builder, the first turns that answered, and every `--new-session` session.
  A closing turn that started a new session is not a recorded session (§4 defines only three origins), so it is neither captured nor named in the record; its stream stays in the run folder as `closing-turn-NN.jsonl`. Failed and refused first turns recorded no session.
- Every write at closing has one interrupt and refusal path:
  1. The closer's identity is read first, inside the close. An unset identity refuses the close as `close-error` (`commit`) with exit 1, and the run stays awaiting review. The identity reaches status.json only through the state event.
  2. Transcripts are copied inside the close, after the handoff and the tree check and before the commit, overwriting `interactive-transcripts/<id>.jsonl`. A failed write refuses the close (`files`); a missing transcript never does. An interrupt before the commit means the next close copies again. After the commit, `finishLandedCommit` copies again, and an adapter that finds no store file keeps the copy an earlier attempt left and reports its sha256.
  3. The stop section of `security.json` is rewritten whole, in the same step.
  4. The record, declared or held, is written after the state event and before the cleanup. A refused destination dispatches `StopRecordRefused` and pauses the run. An interrupt there leaves a committed phase with a closed stop. Its re-entry lists the run's records before `RunResumeRequested`, and writes the record only when that phase has none.
  So, whatever the interrupts, each session leaves one transcript file and each phase one record. A test for each point proves it.
- Nothing the record needs is read after the close. A fresh close hands the record its facts in `CloseReport` (`closedBy`, and `sessions` with their transcript outcomes). The rest is read before `RunResumeRequested`, as `readHeldRecord` already does:
  - for a declared stop, the routed assignment;
  - for a held stop, `agent-binding.json`, `builderUsage` and `commitHash`.
  A closed stop's re-entry reads its status `stop` and interactive-session.json there too.
- Plan 2's `HeldRecordRefused` becomes `StopRecordRefused { phaseId, cause, phaseCommit, worktreePath, reason }`. With it, `HeldRecordPausedError` becomes `StopRecordPausedError`, the resume kind and stopped reason `held_record_refused` become `stop_record_refused`, and the trace `held.record.refused` becomes `stop.record.refused`. A declared record refused at closing then pauses the run exactly as a held one does. The rename goes through the matrix, the reducer, the effects and the dispatcher, and adds no state.
- Interactive transcripts reach the records branch only where `records.transcript` is true, as `output.jsonl` does. They join the record's transcript set, so the record's shape is `full`, and `decideRecordsDestination` applies its existing checks: refused on a public or unconfirmed in-repo branch. These transcripts hold what a person typed in their own session. q-transcript-records `full` already settled that they are recorded under those checks, and the checks do not depend on who wrote the transcript, so they cover this case and no question is raised. The README says so.
- The run-list rows keep today's keys and values: `qualifiedName`, `namespace`, `shortName`, `state`, `branch`, `currentPhase` as `2/6`, `gateProfile`, `updatedAt` as `YYYY-MM-DD HH:MM`, `lockState`, `recordsPending` and `archivePath`. They add `stop`, and every key is required:
  - `currentPhase` and `gateProfile` are null where the table prints `-`;
  - `recordsPending` and `archivePath` are null where `ls --json` used to drop them.
  While a run awaits review, `stop` is its review-stop document, read with `readReviewStop` and stamped again with its `$schema`. Otherwise it is null. It is also null when that document cannot be read, a case the table already shows as a plain state. A script reading the output changes once: the bare array becomes `runs`.
- The spec leaves this wording indicative; this plan settles it:
  - `## Reviewed phases` in review-handoff.md holds a table `Phase | Stop | Outcome | Closed by | Corrections | Guards`. Guards read `2`, `2 (1 no guard)`, or `—` when the phase is unchanged. Each corrected stop then gets a `### <phase> (<held|interactive>)` heading with its What was corrected and Guards sections.
  - The PR body's phase line gains a suffix: ` · held, corrected by Ada Example (2 guards)`, ` · interactive, corrected by Ada Example (1 guard)` or ` · held, reviewed without change by Ada Example`.
  - The compliance prompt gains a `## Reviewed phases` section after `## Phase handoffs`, and one sentence in each stopped phase's instructions.
  A phase that never stopped keeps today's line, section and prompt byte for byte.
- Cost and the estimate.
  - The cost ledger stays Claude Code only, as it is for every phase today (`withInvocationCost` in `src/app/costLedger.ts`). That is how the ledger is designed, not a gap left by stops, and NEXT_STEPS stops listing it.
  - The estimate's training samples now count only `phase`, `fix` and `handoff` entries, and skip historical interactive phases. Neither a closing turn nor a turn-only phase then distorts the fit.
  - An interactive phase is sized from history: the P10/P50/P90 of the first- and closing-turn cost of this repository's past interactive phases. It needs at least 3 of them; with fewer, it is `thin-interactive-history`. A phase on another provider stays `other-provider`. Its P50 joins the run-level cost, as the compliance median does.
  - A hold belongs to a run, so the estimate never sizes one and does not mention it.
- §5.70's security record is the phase's `security.json`. Version 2 adds a required `stop`, written as null when the phase is entered. At a close it becomes `{ cause, personWork: outside-phax-enforcement, turns }`. `turns` names each first and closing turn phax ran, read from the phase folder's `first-turn-NN` and `closing-turn-NN` streams (retries included), with its read-only narrowing: `read-only-tools` on Claude Code, `read-only-sandbox` on codex, and `none` on mistral-vibe. The rest of the file is the phase posture those turns ran under, with no agent commands. The record carries the file, since it is not a stop artifact.
- Telemetry.
  - The transcript copy runs inside a traced `transcripts` step (`tracedStep`).
  - Each session's outcome is one new semantic event, `stop.transcript { runId, operationId, sessionId, provider, outcome, reason? }`. It joins the event types, their schema, the semantic-trace projection and the OpenTelemetry layer, as `oracle.edits.unjudged` does.
  - When records are configured, the stop's record write runs inside a traced `stop.record` step.
  - The declared and held e2e snapshots are updated in phase-08. The e2e suites are outside the standard gate. phase-08 runs them if its session can. Otherwise it edits the snapshots from the projection, and the operator confirms them with `PHAX_E2E_RUN=1 npx vitest run --config vitest.e2e.config.ts tests/e2e/semanticTrace*.test.ts`. No command is granted for this.
- No phase is an oracle phase, although an `oracles` provider is configured. Most of what this plan builds extends the close, the record writer and the estimate from the inside. The spec leaves the shapes an oracle would freeze (the record's stop, the run-list rows, the wording) to this plan, so oracles written before the code would pin planning choices rather than spec criteria. Every test is in-phase.
- Exit codes: a close refused for an unset git identity exits 1, like the other `close-error` refusals, and `StopRecordPausedError` exits 1, like plan 2's pause. Nothing else changes.

## Open questions

### q-dev-records — phase-record-manifest already has its 0.26.0 shape (with `oracle`), and phax's own records branch holds records stamped 0.26.0 by development builds since oracle-phases plan 1. Adding the required `mode` and `stop` in place makes those records unreadable. How should a stop's facts reach the record?

- in-place — Add `mode` and `stop` to the manifest in place, as required keys, and lift the released shapes through their frozen decoders — abandons: Reading the records that development builds wrote. `phax records explain` on a commit of one of phax's own runs, made between oracle-phases plan 1 and this plan, reports its record as malformed. No released phax wrote these records, and their files stay on the branch.
- sibling-document — Leave the manifest as it is, and write a stop's facts to a second document born with `$schema` (`stop.json`), present only in a stopped phase's record — abandons: One self-describing manifest per record. A reader must know to look for a second file, and a phase that never stopped is recognized by that file's absence, not by a required `stop: null`.

Recommendation: in-place — It follows the no-shims rule and plan 2's precedent for development-build runs, and it keeps each record's facts in the one document that a review UI or a script reads. Only phax's own development records are affected, and their files stay on the branch.

---

## phase-01 — Who closed the stop: the closing identity on every closed stop {#phase-01-closing-identity}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Every close of a stop, declared or held, corrected or unchanged, records the git identity of the checkout that closed it. phax reads that identity from the main checkout's git configuration, through the Git port, inside the close. The close's state event writes it into the closed `stop` of the phase status. The record, the review handoff and the PR body can then name the closer, even when a held close leaves no commit. A checkout with no identity has its close refused, and the run keeps waiting.

### Detailed instructions

- In `src/ports/git.ts`, add `authorIdentity(repo): Effect.Effect<{ readonly name: string; readonly email: string } | null, GitError>` next to `committerName`. The name is `GIT_AUTHOR_NAME`, else `git config user.name`; the email is `GIT_AUTHOR_EMAIL`, else `git config user.email`. It returns null when either is unset or empty, and never guesses: do not use `git var GIT_AUTHOR_IDENT`, which falls back to the host name. Implement it in `src/infra/git.ts` the way `committerName` is implemented. In `src/infra/fakes/git.ts`, implement it with a settable identity that defaults to `Ada Example <ada@example.com>`.
- In `src/app/closeStop.ts`, `CloseStopInput` gains `mainCheckout: string`, the checkout that `phax resume` runs in. `src/app/executePlan.ts` passes `config.repoRoot` at both `closeStop` calls.
- The first step of `closeSteps`, before the close base, reads `authorIdentity(input.mainCheckout)`. When it is null, refuse the close as `close-error` with step `commit` and the message `no git identity in <main checkout>: set user.name and user.email, then run phax resume <run> again`. The refusal goes through `StopCloseRefused` with exit 1, so the run stays awaiting review. A close finished from a landed commit (`finishLandedCommit`) goes through this same first step. Never read the identity from HEAD, the phase commit or the review commit.
- Add `closedBy: { name; email }` to `CloseReportFacts`, and fill it from that read in every return of `closeSteps` and `finishLandedCommit`.
- In `src/domain/events.ts`, every `closure` variant of `StopCommitted` and of `HeldStopClosed` gains `closedBy`. `closedEvent` in `src/app/closeStop.ts` passes `report.closedBy`. In `src/domain/reducer.ts`, both arms persist it into the closed stop they build. Add no event, state or matrix cell.
- In `src/schemas/status.ts`, the four closed variants of `PhaseStopSchema` (declared corrected, declared unchanged, held corrected, held unchanged) gain a required `closedBy: { name: NonEmptyString, email: NonEmptyString }`. Make it a strict struct annotated like the stop variants (`strictStop`), and describe it as the git identity of the checkout that closed the stop, read from its configuration and never from a commit. The two `waiting` variants do not change.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`, which rewrites `packages/schemas/snapshots/phase-status/next.schema.json` in place. Add no frozen module, because 0.26.0 is uncut. Update the closed-stop fixtures in `tests/unit/schemasPackage/documents.ts` and `tests/helpers/phaseStatusFixture.ts`, and every test that builds a closed stop or a closure; `pnpm test:type` names them.
- Every test that runs a close sets the main checkout's identity to Ada Example (`git config user.name` and `user.email` in its temporary repository), and stubs HOME so that no global git config and no `~/.phax` is read.

### Planned files to create

- `tests/integration/gitAuthorIdentity.test.ts`
- `tests/integration/stopClosedBy.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/app/closeStop.ts`
- `src/app/executePlan.ts`
- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/schemas/status.ts`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `tests/unit/schemasPackage/documents.ts`
- `tests/helpers/phaseStatusFixture.ts`
- `tests/unit/reducerHeldStop.test.ts`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/awaitingReviewShapes.test.ts`

### Optional files that may be edited

- `src/domain/errors.ts`
- `src/cli/commands/stopOutput.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/heldStopRun.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/oraclePairReview.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/schemas/interactiveFormats.test.ts`
- `tests/e2e/semanticTrace.declaredStop.test.ts`
- `tests/e2e/semanticTrace.heldStop.test.ts`

### Boundary contracts

App → Git port: the close reads the closer only through `authorIdentity` on the main checkout, never from a commit. Close → reducer: `closedBy` travels in the closure of `StopCommitted` and of `HeldStopClosed`, and the dispatcher stays the only writer of status.json. Persisted status → readers: every closed stop names its closer, which the record, the review handoff and the PR body read in later phases.

### Test strategy

- `authorIdentity` gives the environment's identity over the repository's config, the config's when the environment sets none, and null when the name or the email is unset — medium · table · the returned identity per setup · in-phase
- a held corrected, a held unchanged, a declared corrected and a declared unchanged close each write `closedBy` Ada Example into the phase status, while the phase commit is authored by another identity — medium · table · the decoded status.json stop · in-phase
- a close in a checkout with no identity exits 1 naming user.name and user.email, commits nothing, records the refusal in review-stop.json's `lastClose` and leaves the run awaiting review — medium · example · exit code, branch tip and state · in-phase
- a held close interrupted after its review commit, then finished by the next close, writes `closedBy` from the checkout's configuration — medium · example · the status stop · in-phase
- each closed stop variant refuses a missing `closedBy` or an extra key in it, and the regenerated snapshot publishes it with `additionalProperties: false` — small · contract · the decoder and the schemas-package suites · in-phase
- StopCommitted and HeldStopClosed persist their closure's `closedBy` in every closed variant — small · table · the reducer's PersistState patch · in-phase

### Implementation order

1. the Git port method and its two implementations, with their test
2. the status schema and the snapshot
3. the events and the reducer arms
4. closeStop's identity step and `closedBy` in the report
5. executePlan passing the main checkout
6. fixtures and tests

### Excluded scope

- Naming the closer in the record, the review handoff or the PR body (phase-03, phase-06)
- Transcripts (phase-02)
- Any change to how a review commit is authored

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give `authorIdentity`'s signature and lookup order, the new `CloseStopInput.mainCheckout`, and the refusal's message and exit code. Give the `closedBy` shape as written in `src/schemas/status.ts`, `src/domain/events.ts` and `CloseReport`. Confirm that no code reads the closer from a commit. List the snapshot rewritten and the fixtures changed. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): record who closed each stop`

### Commit body

Every close reads the git identity of the checkout that runs phax
resume, through the Git port and never from a commit. Its state event
writes that identity into the phase status's closed stop, held or
declared, corrected or unchanged. A held phase reviewed without change,
which leaves no commit, still names its closer. A checkout with no
identity has its close refused, and the run keeps waiting for review.

---

## phase-02 — Transcript capture at closing, through each provider's session store {#phase-02-transcript-capture}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** It adds an operation to every provider adapter that reaches the providers' session stores, which no phax code reads yet. It also fits an idempotent step into the close's interrupt and landed-commit paths. No code in the repository shows that design yet, so Opus at high.

When a stop closes, phax copies the transcript of every recorded session of the stop from its provider's own session store into `<run>/<phase>/interactive-transcripts/<session id>.jsonl`. The recorded sessions are the held phase's builder session, the first turn's session, and every `--new-session` session. The copy happens after the closing turn, whether or not the person continued the session. A transcript that cannot be found or read is recorded as missing with its reason, and never blocks the close. Each outcome is kept in interactive-session.json and traced.

### Detailed instructions

- In `src/ports/backend.ts`, add `captureTranscript(request: TranscriptRequest): Effect.Effect<TranscriptCapture, never>` to `BackendOps`. `TranscriptRequest` is `{ provider, sessionId, startedAt, cwd, destination }`, where `cwd` is the stop's worktree and `destination` is the absolute path of the copy. `TranscriptCapture` is `{ status: 'captured'; sha256 }` or `{ status: 'missing'; reason: 'not-found' | 'unreadable'; detail }`. It never fails: any I/O error becomes `missing`.
- Create `src/infra/providers/transcriptStore.ts` with the part every provider shares:
  - before building any path, refuse a session id that does not match `^[A-Za-z0-9._-]+$` as `missing` (`unreadable`, `unsafe session id`);
  - copy the found file's bytes to `destination` (creating its folder and writing atomically) and return their sha256;
  - when the store holds no file but `destination` already holds a copy from an earlier attempt of the same close, return that copy's sha256 as captured;
  - otherwise return `missing` (`not-found`);
  - an unreadable store directory or file gives `missing` (`unreadable`), with the error as its detail.
- Implement `captureTranscript` in each provider adapter, routed by `src/infra/providers/dispatcher.ts`:
  - Claude Code (`claudeCode.ts`): the root is `CLAUDE_CONFIG_DIR` or `<home>/.claude`. Look for `projects/<slug>/<id>.jsonl`, where the slug is the cwd with every character outside `[A-Za-z0-9]` replaced by `-`. If it is not there, list the names under `projects/` and take the first `<name>/<id>.jsonl` that exists.
  - codex (`codexCli.ts`): the root is `CODEX_HOME` or `<home>/.codex`. List the file names of `sessions/YYYY/MM/DD/` for the UTC and local dates of `startedAt` and the day after, and take the file named `rollout-*-<id>.jsonl`. If none matches, walk the year, month and day directory names.
  - mistral-vibe (`mistralVibe.ts`): the root is `VIBE_HOME` or `<home>/.vibe`. Find the `logs/session/session_*` directory whose `meta.json` names the session id, as phax already finds a vibe session, and copy its `messages.jsonl`. That file name is unverified against a current vibe, like `vibe --resume`: say so in a comment. A directory without it gives `missing` (`not-found`).
  The home is `os.homedir()`, so a test's HOME governs it. An adapter reads only the session's own files, never a credential or configuration file, and reads directories only for their names.
- In `src/infra/fakes/backend.ts`, `captureTranscript` answers `missing` (`not-found`) unless a test has registered a transcript's content for the session id. It then writes that content to `destination` and hashes it.
- Create `src/domain/interactive/transcripts.ts`, pure:
  - `recordedSessions(session)` returns interactive-session.json's `history` then `current`, each session id once;
  - `transcriptFile(sessionId)` returns `interactive-transcripts/<id>.jsonl`;
  - the type `ClosedStopSession` is `{ provider, model, effort, sessionId, origin, transcript }`, where `transcript` is `{ status: 'captured'; file; sha256 }` or `{ status: 'missing'; reason; detail }`.
- In `src/schemas/interactiveSession.ts`, add a required, strict `transcripts`. It is null until a close captures the transcripts, then an array of `{ sessionId, status: 'captured', file, sha256 }` or `{ sessionId, status: 'missing', reason: 'not-found' | 'unreadable', detail }`. Every writer writes it:
  - `src/app/interactiveStop.ts` writes null at both declared and held stops, and so does closeStop's fallback document;
  - `--new-session` in `src/app/enterPhase.ts`, and the closing turn's own writes, keep the value they read.
  Run `pnpm exec tsx scripts/schemas-check.ts --write`, which rewrites interactive-session's `next.schema.json` in place, and update the fixtures in `tests/unit/schemasPackage/documents.ts`.
- In `src/app/closeStop.ts`, add a step after step 5 (the tree check) and before step 6 (the commit):
  - read interactive-session.json again, because the closing turn rewrote it;
  - call `captureTranscript` for each `recordedSessions` entry, with the stop's worktree and `<phase folder>/interactive-transcripts/<id>.jsonl`;
  - write the outcomes into interactive-session.json's `transcripts`.
  A failed write refuses the close as `close-error` (`files`); a `missing` outcome never does. The step also runs in an unchanged close, with or without a closing turn. `finishLandedCommit` runs the same step before it reports, so a close interrupted after its commit still captures. `CloseReport`'s facts gain `sessions: readonly ClosedStopSession[]`.
- Telemetry. Run the step inside `tracedStep` with step `transcripts`; it counts as a success when it completes, whatever the outcomes. Add the semantic event `stop.transcript { runId, operationId, sessionId, provider, outcome: 'captured' | 'missing', reason? }` in the same places as `oracle.edits.unjudged`:
  - `src/domain/telemetry/events.ts`, with its maker;
  - `src/schemas/telemetryEvents.ts`;
  - the projection in `src/domain/telemetry/snapshot.ts`;
  - the mapping in `src/infra/telemetry/layer.ts`.
  `traceTranscript(ctx, session, capture)` in `src/app/telemetry/stopTelemetry.ts` emits one per session.
- In `src/domain/records/stopArtifacts.ts`, `isStopArtifact` also holds for `interactive-transcripts`, so the folder never enters a phase record as the agent's work. phase-03 decides how its files enter a record.
- In `tests/helpers/fakeProviderCli.ts`, both fake CLIs append the lines they print to their session store under `$HOME`, unless the script sets `keepStore: false`. Claude writes to `.claude/projects/<slug of cwd>/<id>.jsonl`, and codex to `.codex/sessions/<UTC YYYY>/<MM>/<DD>/rollout-<timestamp>-<id>.jsonl`. A resume of the same id appends to the same file. The vibe tests write their own store fixtures under the test HOME.
- When `phax reset-phase` removes a stopped phase's recorded sessions, it also removes the phase's `interactive-transcripts/` folder.

### Planned files to create

- `src/infra/providers/transcriptStore.ts`
- `src/domain/interactive/transcripts.ts`
- `tests/unit/interactive/transcripts.test.ts`
- `tests/integration/providerTranscriptStores.test.ts`
- `tests/integration/stopTranscripts.test.ts`

### Planned files to edit

- `src/ports/backend.ts`
- `src/infra/providers/claudeCode.ts`
- `src/infra/providers/codexCli.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/infra/providers/dispatcher.ts`
- `src/infra/fakes/backend.ts`
- `src/schemas/interactiveSession.ts`
- `src/app/closeStop.ts`
- `src/app/interactiveStop.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/domain/telemetry/events.ts`
- `src/domain/telemetry/snapshot.ts`
- `src/schemas/telemetryEvents.ts`
- `src/infra/telemetry/layer.ts`
- `src/domain/records/stopArtifacts.ts`
- `packages/schemas/snapshots/interactive-session/next.schema.json`
- `tests/unit/schemasPackage/documents.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/unit/records/stopArtifacts.test.ts`
- `tests/unit/stopTelemetry.test.ts`

### Optional files that may be edited

- `src/app/enterPhase.ts`
- `src/app/interactiveFiles.ts`
- `src/app/resetPhase.ts`
- `src/app/executePlan.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/unit/telemetry/snapshot.test.ts`
- `tests/unit/schemas/interactiveFormats.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/stoppedRunFixture.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/heldStopCommands.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/unit/providers/claudeCode.test.ts`
- `tests/unit/providers/codexCli.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`

### Boundary contracts

App → Backend port: the close asks a provider adapter for one session's transcript by session id, start time and worktree, and gets back either a copy's digest or a typed `missing`. Only the adapter knows where its provider keeps sessions. Close → interactive-session.json: the outcomes are written before the commit, one per recorded session. The record (phase-03) reads them from that file, or from the CloseReport.

### Test strategy

- `recordedSessions` gives history then current, each id once, and nothing when there is no session — small · table · the expected list · in-phase
- each adapter, under a temporary HOME, copies a Claude transcript found by its slug and found by listing, a codex rollout found on its start date and on the next day, and a vibe `messages.jsonl` found through `meta.json`; each gives `missing` for an absent file, an unsafe id and an unreadable directory, and keeps an earlier copy when the store has none — medium · table · the capture outcome and the copied bytes · in-phase
- with a test HOME whose fake codex keeps rollouts for X1 (a declared stop's first turn, never continued), X2 (from `--new-session`, continued) and X0 (a held phase's builder), closing both stops leaves `interactive-transcripts/X1.jsonl` and `X2.jsonl` in phase-03's folder and `X0.jsonl` in phase-02's, and X2's copy holds the closing turn — medium · example · the copied files and their bytes · in-phase · §8 The transcripts are captured, even of a session never continued
- with X1's rollout deleted, phase-03 still commits, the run continues, and interactive-session.json records X1 as missing with reason `not-found` — medium · example · state and the transcripts entry · in-phase · §8 A missing transcript never blocks closing
- an unchanged held close and an unchanged declared close capture their sessions too — medium · example · the copied files · in-phase
- a close interrupted after the copy and before its commit, then closed again, leaves one file and one outcome per session; a close interrupted after its commit captures in `finishLandedCommit` — medium · example · the folder listing and interactive-session.json · in-phase
- no branch of the run contains a path under `interactive-transcripts/` — medium · example · `git ls-tree` of every run branch · in-phase · §8 The stop's files are never committed
- the close emits a `transcripts` step and one `stop.transcript` event per session, with its outcome — small · example · the in-memory telemetry · in-phase

### Implementation order

1. the port method and the shared copy helper
2. the three adapters and their tests
3. the fake backend and the fake CLIs' stores
4. the domain helpers and the interactive-session field
5. closeStop's step, in the close and in finishLandedCommit
6. the telemetry event
7. isStopArtifact and reset-phase
8. the integration tests

### Excluded scope

- Recording transcripts or their digests in a phase record (phase-03)
- Naming sessions in records explain (phase-04)
- Capturing a closing turn's new session, which is not a recorded session
- Lifting `unverified` interactive resume for mistral-vibe

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give `captureTranscript`'s signature, `TranscriptRequest` and `TranscriptCapture`, and each adapter's lookup as implemented, with the environment variables it honours. Give `recordedSessions`, `ClosedStopSession` and the `transcripts` field as written. Say where the step sits in `closeSteps` and in `finishLandedCommit`, how an earlier copy is kept, and what a failed write refuses. Give the `stop.transcript` event's shape, and say how the fake CLIs keep their stores. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): capture each recorded session's transcript at closing`

### Commit body

A close copies the transcript of every recorded session of its stop
(the builder's, the first turn's and every --new-session session) from
the provider's own session store into interactive-transcripts/. It
copies after the closing turn, whether or not the person continued the
session. Each provider adapter locates its own store. A transcript that
cannot be found or read is recorded as missing with its reason, and never
blocks the close. The outcomes are kept in interactive-session.json and
traced.

---

## phase-03 — The record of a stop: the declared record, the stop's review fields and the transcripts' content {#phase-03-stop-records}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** It extends a persisted record format, the record writer and assembly, the run loop's close and re-entry paths for both causes, and a reducer event across every layer, while keeping each record written exactly once through interrupts. That crosses several parts of the architecture, so Opus at high.

Every closed stop writes its phase's record at closing, once, and a declared phase now writes one too. The record manifest names the phase's mode. For a stopped phase, it also names:

- the stop's cause, outcome and closer;
- its recorded sessions, with each transcript's sha256 or the reason it is missing;
- at a held corrected close, the review commit.

Where `records.transcript` is true, the interactive transcripts' content goes into the record, under the existing destination checks. A held record's usage is the builder's usage at the stop, so on mistral-vibe it no longer counts the closing turn. A refused record write pauses the run whatever the cause, and the next resume writes the record once.

### Detailed instructions

- In `src/schemas/runRecord.ts`, add two required fields to the manifest: `mode` (the plan's `headless | interactive`) and `stop`. `stop` is null, or one of four strict structs, each with `cause`, `outcome`, `closedBy: { name, email }` and `sessions`: declared corrected, declared unchanged, held corrected (which also has `reviewCommit`, a full sha) and held unchanged. A session is `{ provider, model, sessionId, origin: first-turn | new-session | builder, transcript }`, where `transcript` is `{ status: captured, sha256 }` or `{ status: missing, reason: not-found | unreadable, detail }`. Decode them with `onExcessProperty: error`, and publish them with `additionalProperties: false`.
- Lift the older shapes:
  - in `src/schemas/persisted.ts`, `readPhaseRecordManifestAs` adds `mode: 'headless'` and `stop: null`, beside `oracle: null`, to a manifest read by the frozen 0.17.0 decoder or the pre-schema decoder;
  - in `packages/schemas/src/formats/recordManifests.ts`, `toLatestPhaseRecordManifest` does the same, with a comment saying why: no earlier phax could stop a phase.
  A manifest stamped at the current release without `mode` or `stop` stays refused. Run `pnpm exec tsx scripts/schemas-check.ts --write`, which rewrites the `next.schema.json` of phase-record-manifest and of interactive-session in place, and update the fixtures in `tests/unit/schemasPackage/documents.ts`. If the operator's answer to q-dev-records differs from its recommendation, follow the answer.
- In `src/schemas/interactiveSession.ts`, add a required `builderUsage`: the `TokenUsage` from runRecord, or null. Describe it as the held phase's builder usage, read once at the hold point, and null at a declared stop. `stopAtHeldPhase` in `src/app/interactiveStop.ts` computes it with `computeRecordUsage` (`src/app/recordPlumbing.ts`), from the phase folder and the builder's session id, before any closing turn can grow a vibe session's `meta.json`. A declared stop writes null, and every other writer keeps the value it read.
- Create `src/domain/records/stopRecord.ts`, pure:
  - `recordStopOf` builds the manifest's `stop` from a cause, an outcome, `closedBy`, the review commit of a held corrected close, and the `ClosedStopSession`s (`src/domain/interactive/transcripts.ts`);
  - `recordStopFromPersisted` builds the same from a closed status `stop` and an interactive-session document whose `transcripts` is set, and refuses a document whose `transcripts` is null.
- In `src/app/writeRecord.ts`, `WriteRecordInput` gains `mode`, `stop` and `usage`, which replaces `sessionId`. `usage` is one of:
  - `{ kind: 'session'; sessionId: string | undefined }`: computed as today;
  - `{ kind: 'recorded'; usage: TokenUsage }`: taken as given;
  - `{ kind: 'none' }`: gives `{ available: false }`.
  When the phase folder holds `interactive-transcripts/`, list it through the FileSystem port and pass its files to `assembleRecord` as `interactive-transcripts/<name>`.
- In `src/domain/records/assemble.ts`, `AssembleRecordInput` gains `mode`, `stop` and `interactiveTranscripts`. The record's transcripts are `output.jsonl` and every interactive transcript. They are kept together only when `transcriptEnabled` is true and at least one is present (shape `full`); otherwise they are all dropped (shape `skeleton`). Every other stop artifact is still dropped. `commitRecordTree` already reads nested paths through `join`.
- Rename plan 2's refusal through every layer, so a refused declared record pauses the run as a held one does:
  - `HeldRecordRefused` becomes `StopRecordRefused`, with a `cause`;
  - `HeldRecordPausedError` becomes `StopRecordPausedError`;
  - the resume kind and stopped reason `held_record_refused` become `stop_record_refused`;
  - the trace `held.record.refused` becomes `stop.record.refused`.
  The rename touches `src/domain/events.ts`, `src/domain/reducer.ts`, `src/domain/matrix.ts`, `src/domain/effects.ts`, `src/domain/errors.ts`, `src/app/resumeInstructions.ts` and `src/app/executePlan.ts`. The reducer arm is otherwise unchanged: running/{committed} to interrupted/{committed}.
- In `src/app/executePlan.ts`, `writeRecordForPhase` takes `mode`, `stop` and `usage`. Headless callers pass `phase.mode`, `stop: null` and `{ kind: 'session', sessionId }`. When records are configured, wrap the stop's record write in `tracedStep` (`src/app/telemetry/stopTelemetry.ts`) with step `stop.record`.
- Held record. `readHeldRecord` also reads interactive-session.json's `builderUsage`, before `RunResumeRequested`. After `closeStop`, the record takes `usage: { kind: 'recorded', usage: builderUsage }`, and `stop: recordStopOf(...)` from the `CloseReport` (cause, outcome, `closedBy`, `reviewCommit`, `sessions`). Its `sourceSha` is still the phase commit. On a closed held stop's re-entry, read the status `stop` and interactive-session.json before `RunResumeRequested`, and use `recordStopFromPersisted`.
- Declared record. Before `RunResumeRequested`, a declared stop's close or closed-stop re-entry calls `readDeclaredRecord`. It reads the provider, concrete model and effort from `model-resolution.json` (`readModelResolution` in `src/app/interactiveFiles.ts`), and, on a re-entry, the status `commitHash`, the status `stop` and interactive-session.json.
  In the interactive branch, after `closeStop` and before the cleanup, write the record with `mode: 'interactive'`, `outcome: 'committed'`, `sourceSha: report.commit`, `usage: { kind: 'none' }` and `stop: recordStopOf(...)`. On the closed-stop re-entry, write it from the persisted facts when `phaseRecordExists` finds none; that check now runs for both causes, before `RunResumeRequested`.
  A refused destination dispatches `StopRecordRefused` (cause `declared`) and fails with `StopRecordPausedError`, as the held record does. A cleanup re-entry writes no record.
- Tests configure records on an in-repo destination in their temporary repository, with transcripts on or off per case. For transcripts on, use a fake GitHub port that answers private, or set `records.destination.acknowledgedUnknownVisibility`. Every test stubs HOME and uses a fake backend or the fake CLIs. A vibe case writes its `meta.json` fixtures under the test HOME.

### Planned files to create

- `src/domain/records/stopRecord.ts`
- `tests/unit/records/stopRecord.test.ts`
- `tests/integration/stopRecords.test.ts`

### Planned files to edit

- `src/schemas/runRecord.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/snapshots/phase-record-manifest/next.schema.json`
- `src/schemas/interactiveSession.ts`
- `packages/schemas/snapshots/interactive-session/next.schema.json`
- `src/app/interactiveStop.ts`
- `src/app/writeRecord.ts`
- `src/domain/records/assemble.ts`
- `src/app/executePlan.ts`
- `src/domain/events.ts`
- `src/domain/reducer.ts`
- `src/domain/matrix.ts`
- `src/domain/effects.ts`
- `src/domain/errors.ts`
- `src/app/resumeInstructions.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/reducerHeldStop.test.ts`

### Optional files that may be edited

- `src/app/recordPlumbing.ts`
- `src/app/closeStop.ts`
- `src/app/interactiveFiles.ts`
- `src/app/dispatcher.ts`
- `src/app/telemetry/stopTelemetry.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/interruptHandler.ts`
- `packages/schemas/src/generated/index.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/integration/heldStopRun.test.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/stoppedRunFixture.ts`

### Boundary contracts

executePlan → record writer: everything a stop's record needs comes from the CloseReport, or from files read before `RunResumeRequested`. `writeRecord` takes the usage as an explicit source. Record writer → records branch: only assembly decides which files a record carries, and only the destination policy decides whether a record with transcripts may be written. Records → readers: the manifest's `mode` and `stop` are published in `@lbdremy/phax-schemas`, and older shapes are lifted.

### Test strategy

- `recordStopOf` and `recordStopFromPersisted` give each of the four variants, name `reviewCommit` only on a held corrected close, give an empty `sessions` when there were none, and refuse a closed stop whose `transcripts` is null — small · table · the expected stop · in-phase
- assembly keeps `output.jsonl` and the interactive transcripts together when transcripts are on (shape full), drops them all when transcripts are off (skeleton), and never carries another stop artifact — small · table · the artifact list and shape · in-phase
- the manifest round-trips with each stop variant and refuses a missing `mode` or `stop` and an extra key; 0.17.0 and pre-schema manifests read lifted with `mode: headless` and `stop: null`, in phax and in `@lbdremy/phax-schemas` — small · contract · the decoders and the schemas-package suites · in-phase
- with records on and phase-02 held at C2 with builder X0, the records branch holds no phase-02 record while it is held, and exactly one after it closes corrected with review commit R2; that record names C2 as its source, R2, cause held, outcome corrected, Ada Example, and X0 with its transcript's sha256 — medium · example · the records branch's manifests · in-phase · §8 A held phase's record is written once, at closing
- of two closed runs, the one whose phase-03 recorded X1 names codex, the model, X1 and its sha256, and the one whose first turn failed names no session; with `records.transcript` false no records commit holds transcript content, and with it true the first run's record holds `interactive-transcripts/X1.jsonl` — medium · example · the records branch's trees and manifests · in-phase · §8 Records and the security record name the review honestly
- a declared phase's record is written once at closing, naming the routed provider, model and effort, usage unavailable, mode interactive, and the declared commit as its source — medium · example · the manifest · in-phase
- a declared close interrupted after StopCommitted writes its record on the next resume, and none when resumed again; a refused destination pauses the run (exit 1, `stop_record_refused`), and the next resume writes the record once — medium · example · the records branch count and run-status · in-phase
- on mistral-vibe, a held phase whose closing turn resumed builder V0 and grew its `meta.json` records the usage read at the hold point — medium · example · the manifest's usage against `meta.json` before and after · in-phase
- every StopRecordRefused cell gives the matrix's disposition for both causes — small · table · the reducer matrix · in-phase
- with records configured, the stop's record write emits a `stop.record` step — small · example · the in-memory telemetry · in-phase

### Implementation order

1. the manifest schema, the lifts and the snapshots
2. builderUsage at the hold point
3. stopRecord.ts
4. writeRecord and assembly
5. the StopRecordRefused rename
6. executePlan's held record, with its stop and usage
7. the declared record and the closed-stop re-entry for both causes
8. the integration tests

### Excluded scope

- records explain on a review commit, and the stop's lines (phase-04)
- The security record (phase-04)
- Printing interactive transcripts with `records explain --transcript`
- Recording sessions that phax did not start

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the manifest's `mode` and `stop` as written, the two lifts, `builderUsage`, `recordStopOf` and `recordStopFromPersisted`, and `WriteRecordInput`'s new fields. Say where executePlan writes the declared record, what it reads before `RunResumeRequested` for each cause, and how the re-entry writes the record only once. List the renamed identifiers. Say which formats' snapshots were rewritten, and how q-dev-records was applied. Explain any deviation from the planned file lists.

### Commit subject

`feat(records): record every stop at closing, declared and held`

### Commit body

A declared phase now writes its record when its stop closes, once, as
a held phase does. A record names the phase's mode. For a stopped phase
it also names the stop's cause, outcome and closer, its recorded
sessions with each transcript's digest or why it is missing, and a held
close's review commit. With records.transcript on, the interactive
transcripts join the record under the existing destination checks. A
held record's usage is the builder's at the stop, so a vibe closing turn
no longer counts. A refused record write pauses the run for either cause.

---

## phase-04 — records explain on both commits, and the security record of a stop {#phase-04-explain-and-security}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** It versions security.json with a lift for every reader, and threads the stop's posture through the close's idempotent step, besides the explain change. That needs more care than the default effort.

`phax records explain` finds a held phase's record from its review commit, as it does from its phase commit. On any commit of a stopped phase, it shows the stop's line and its sessions. The phase's `security.json` states that the person's work, including a session they continued, ran outside phax's enforcement. It also names each first and closing turn phax ran, with the read-only narrowing applied to it.

### Detailed instructions

- In `src/app/recordsExplain.ts`, `addressFromTrailers` checks `Run-Id` with `Phase-Id` first. It then addresses a phase record from `Run-Id` with `Held-Phase`, taking the `Held-Phase` value as the phase id, before it checks `Authoring-Id` and `Decision-Id`. `ExplainedRecord` gains `addressedBy: 'phase-commit' | 'review-commit'`. Update the not-a-phax-commit message in `src/cli/commands/records.ts` so it names `Held-Phase` too.
- In `src/cli/commands/records.ts`, when a manifest has a stop, print after the record's first line:
  - for a held stop: `  held: <corrected|reviewed without change> by <name> — phase commit <short>[, review commit <short>]`;
  - for a declared stop: `  interactive: <corrected|reviewed without change> by <name>`;
  - then one line per session: `  sessions: <provider> <model> <id> (<origin>; transcript sha256 <first 4 hex>…)`, with `transcript missing: <reason>` for a missing one, or `  sessions: none` when there is none.
  When the record was found from a review commit, say so on the first line (`found from review commit <short>`). A manifest whose stop is null prints exactly what it prints today.
- Create `src/domain/security/stopPosture.ts`, pure:
  - `readOnlyNarrowingOf(provider)` is `read-only-tools` for claude-code, `read-only-sandbox` for codex-cli and `none` for mistral-vibe;
  - `phaxTurnsOf(names)` lists, in run order, every `first-turn-NN.jsonl` and `closing-turn-NN.jsonl` stream in a phase folder's file names, and its `-retry` stream, as `{ turn: 'first-turn-01', kind: 'first-turn' | 'closing-turn' }`. Reuse the stream pattern from `src/domain/cost/ledger.ts` rather than writing a second one;
  - `stopPostureOf({ cause, provider, names })` returns `{ cause, personWork: 'outside-phax-enforcement', turns }`, each turn with its `narrowing`.
- In `src/schemas/securityPosture.ts`, the current schema becomes `version: 2`, with a required, strict `stop`: null, or the struct above. Keep the version-1 struct as `SecurityPostureV1Schema`, and add `readSecurityPosture(input)`, which decodes version 2 or lifts version 1 with `stop: null`. Switch every decoder of `security.json` to it: `src/app/interactiveFiles.ts`, `src/app/finalReport.ts`, and any other the type checker names. `resolvePhaseAgent` in `src/app/executePlan.ts` writes version 2 with `stop: null`.
- In `src/app/closeStop.ts`, in the step that captures the transcripts (so in `finishLandedCommit` too), rewrite the phase folder's `security.json` whole, with its `stop` set by `stopPostureOf`. Read the folder's file names through the FileSystem port. A failed write refuses the close as `close-error` (`files`). The record written at closing carries this file, because `security.json` is not a stop artifact.
- Move every test that builds `security.json` through `encodeSecurityPosture` to version 2: `tests/helpers/stoppedRunFixture.ts`, and the suites the type checker names.

### Planned files to create

- `src/domain/security/stopPosture.ts`
- `tests/unit/security/stopPosture.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/integration/stopSecurityRecord.test.ts`

### Planned files to edit

- `src/app/recordsExplain.ts`
- `src/cli/commands/records.ts`
- `src/schemas/securityPosture.ts`
- `src/app/executePlan.ts`
- `src/app/closeStop.ts`
- `src/app/interactiveFiles.ts`
- `src/app/finalReport.ts`
- `tests/unit/security/posture.test.ts`
- `tests/helpers/stoppedRunFixture.ts`

### Optional files that may be edited

- `src/app/enterPhase.ts`
- `src/app/reviewCode.ts`
- `src/domain/security/postureToPolicy.ts`
- `src/domain/cost/ledger.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/stopRecords.test.ts`

### Boundary contracts

Source commit → record: a review commit's `Run-Id` and `Held-Phase` trailers are the address of its record. Close → security.json: the stop section is computed by a pure function from the phase folder's stream names and the provider, and every reader of the file goes through `readSecurityPosture`.

### Test strategy

- `phax records explain` on C2 and on R2 names the same phase-02 record, the second one found from the review commit, with the held line naming C2 and R2, Ada Example, and X0 with its digest — medium · example · the explain output · in-phase · §8 A held phase's record is written once, at closing
- on each of two closed runs' phase-03 commits, explain names phase-03 interactive with its outcome and Ada Example, then codex, the model, X1 and its digest for the first run and `sessions: none` for the second; each phase-03 `security.json` states that the person's work ran outside phax's enforcement, and lists its first and closing turns with their narrowing — medium · example · the explain output and the decoded security.json · in-phase · §8 Records and the security record name the review honestly
- a commit with `Run-Id` and `Phase-Id` resolves by them even when it also carries `Held-Phase`, and a commit with `Held-Phase` and no `Run-Id` is not a phax commit — medium · table · the explain outcome · in-phase
- `readOnlyNarrowingOf` and `phaxTurnsOf` give the expected values for each provider and stream set — small · table · the expected narrowing and turns · in-phase
- a version-1 `security.json` reads lifted with `stop: null`, and a version-2 file without `stop` is refused — small · example · the decode result · in-phase
- a phase that never stopped has `stop: null` in its security.json, and explain prints no stop line for it — medium · example · file and output · in-phase

### Implementation order

1. explain's address and its CLI lines
2. stopPosture.ts
3. security.json version 2 and its reader
4. closeStop's security write
5. fixtures and tests

### Excluded scope

- Printing interactive transcripts with --transcript
- Any change to how phax enforces a posture
- The record's content (phase-03)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the trailer order in `addressFromTrailers`, `addressedBy`, and the exact stop and session lines that explain prints. Give `stopPostureOf`, `readOnlyNarrowingOf`, `phaxTurnsOf` and the version-2 `stop` as written, and `readSecurityPosture` with every reader switched to it. Say where closeStop writes the file. Explain any deviation from the planned file lists.

### Commit subject

`feat(records): explain a review commit and record a stop's security posture`

### Commit body

phax records explain now finds a held phase's record from its review
commit, through the commit's Run-Id and Held-Phase trailers. It shows a
stopped phase's cause, outcome and closer, and its sessions with their
transcript digests. security.json moves to version 2. At a close, its
stop section says that the person's work ran outside phax's enforcement,
and names each first and closing turn phax ran with its read-only
narrowing. A version-1 file reads as a phase that never stopped.

---

## phase-05 — The versioned run list {#phase-05-run-list}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax ls --json` prints one `run-list` document, born with `$schema`. Each of its `runs` carries the run's state and a required `stop`: while the run awaits review, its review-stop document, equal in content to `review-stop.json`; otherwise null. Every row key is required, and null when unknown. `phax ls --awaiting-review --json` lists only the waiting runs. The format is published in `@lbdremy/phax-schemas` for a review UI.

### Detailed instructions

- Create `src/schemas/runList.ts`:
  - `RunListRowSchema`, with the required keys `qualifiedName`, `namespace`, `shortName`, `state` (the run state enum), `branch`, `currentPhase` (string or null), `gateProfile` (string or null), `updatedAt`, `lockState` (`none | active | stale`), `recordsPending` (a non-negative integer or null), `archivePath` (string or null), and `stop` (`ReviewStopFileSchema` from `src/schemas/reviewStop.ts`, with its `$schema`, or null);
  - `RunListFileSchema`: `{ $schema: schemaUrlField('run-list'), runs }`.
  Decode with `onExcessProperty: error`, and annotate each struct so the published JSON Schema says `additionalProperties: false`. Describe `stop` as null when the run is not awaiting review, or when its review-stop.json cannot be read. Export the decoder and the encoder.
- Register and publish the format:
  - add `run-list` to `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts`;
  - define the package format in `packages/schemas/src/formats/interactive.ts` as `review-stop` is defined (`runListFormat`, `parseRunList`, `toLatestRunList`), and export it from `packages/schemas/src/index.ts`;
  - run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/run-list/next.schema.json`, and regenerates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`;
  - add a current-shape fixture to `tests/unit/schemasPackage/documents.ts`, and extend every exhaustive format list the suites name, such as `packages/schemas/build/jsonSchemas.ts` and `tests/type/schemasPackage.ts`.
- Create `src/domain/runList.ts`, pure. `buildRunList(rows)` takes today's ls rows, each with its run's stop document or null, and returns the run list in memory. It writes null where the table prints `-` (`currentPhase`, `gateProfile`) and where `ls --json` used to drop a key (`recordsPending`, `archivePath`).
- In `src/cli/commands/ls.ts`, read the stop of each run in `awaiting_review` once, for the table and for JSON alike. Read it with `readReviewStop` from `src/app/interactiveFiles.ts` (the reader that `readStopInfo` uses), and stamp the document with `withSchemaUrl('review-stop', …)` for JSON. A document that cannot be read gives `stop: null`, and the table shows the plain state, as today; it never crashes. With `--json`, print `encodeRunList(withSchemaUrl('run-list', buildRunList(...)))`. `--complete` and the text table do not change.

### Planned files to create

- `src/schemas/runList.ts`
- `src/domain/runList.ts`
- `packages/schemas/snapshots/run-list/next.schema.json`
- `tests/unit/runList.test.ts`
- `tests/integration/runList.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `packages/schemas/src/formats/interactive.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `src/schemas/release.ts`
- `src/cli/commands/ls.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/cli/ls.test.ts`

### Optional files that may be edited

- `packages/schemas/build/jsonSchemas.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`
- `tests/integration/heldStopCommands.test.ts`
- `src/app/interactiveFiles.ts`
- `src/app/stopInfo.ts`

### Boundary contracts

CLI → files: ls reads each waiting run's review-stop.json through the existing reader and embeds it unchanged; nothing is recomputed from git. phax → review UI: the run-list document is the versioned surface, published in `@lbdremy/phax-schemas`.

### Test strategy

- with invoice-export held at phase-02, credit-notes stopped at declared phase-03 and payments-fix failed, `phax ls --json` prints one document whose `$schema` names `run-list` (format id and release pattern); the two waiting runs carry `state` `awaiting_review` and a `stop` equal in content to their review-stop.json, and payments-fix carries `stop` null; `phax ls --awaiting-review --json` lists only the two waiting runs — medium · example · the decoded document against the files · in-phase · §8 phax ls --json is a versioned run list
- `buildRunList` writes every key, with null for an unknown phase, profile, pending count and archive path — small · table · the expected rows · in-phase
- a waiting run whose review-stop.json is malformed gets `stop` null in JSON and its plain state in the table, and ls exits 0 — medium · example · output and exit code · in-phase
- the run-list decoder refuses an extra key and a missing `stop`, the published schema says `additionalProperties: false`, and `@lbdremy/phax-schemas` parses the fixture — small · contract · the decoder and the schemas-package suites · in-phase
- `phax ls --complete`, and the table of runs with no stop, print what they printed before — small · example · the output · in-phase

### Implementation order

1. the schema and the format registration
2. the package format and the snapshot
3. buildRunList
4. ls.ts
5. tests

### Excluded scope

- Moving ls's reconciliation out of the CLI
- A watch or server mode
- The docs and the upgrade note (phase-08)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give `RunListRowSchema` and `RunListFileSchema` as written, the package exports, the snapshot created, and `buildRunList`'s signature. Say how ls reads a stop and handles a defective one. List every exhaustive format list you extended. Explain any deviation from the planned file lists.

### Commit subject

`feat(ls): print a versioned run list with each run's stop`

### Commit body

phax ls --json now prints one run-list document with a $schema. Each
run carries its state and a required stop: while the run awaits review,
its review-stop document as review-stop.json holds it, and null
otherwise. Every row key is required and null when unknown. The format
is published in @lbdremy/phax-schemas for a review UI. It replaces the
bare array.

---

## phase-06 — Stops in the compliance review, the review handoff and the PR body {#phase-06-review-surfaces}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The compliance reviewer sees each stopped phase with its cause and its interactive handoff, so it judges the corrections against that handoff, not as deviations from the plan. `review-handoff.md` gains `## Reviewed phases`, and the PR body's line for a stopped phase shows the cause, the outcome, who closed it and the guard count. A run with no stop keeps every one of these surfaces byte for byte, and a dedicated test proves it.

### Detailed instructions

- In `src/domain/interactive/handoff.ts`, add `summarizeInteractiveHandoff(text)`. From a valid interactive handoff, it returns `{ corrections, guards, noGuard, correctedSection, guardsSection }`: the `## What was corrected` entries, the `## Guards` entries that name a test, lint rule or gate step, the entries that start with `no guard:`, and the text of the two sections. Reuse the parsing that `validateInteractiveHandoff` does.
- Create `src/domain/interactive/reviewedPhases.ts`, pure:
  - `ReviewedPhase` is `{ phaseId, cause, outcome, closedBy, summary }`;
  - `renderReviewedPhases(phases)` returns `## Reviewed phases`, then a table `Phase | Stop | Outcome | Closed by | Corrections | Guards` (Guards as `2`, `2 (1 no guard)`, or `—` when the phase is unchanged), then, for each corrected stop, `### <phase> (held)` or `### <phase> (interactive)` with its What was corrected and Guards sections. It returns nothing when the list is empty;
  - `prPhaseStopSuffix(phase)` returns ` · held, corrected by <name> (<n> guard|guards)`, ` · interactive, corrected by <name> (<n> guard|guards)`, or ` · <held|interactive>, reviewed without change by <name>`.
- In `src/app/loadReviewHandoffInputs.ts`, add `loadReviewedPhases(info)`. It returns the phases whose status `stop` is closed, in plan order, each with its interactive handoff: `correction-handoff.md` at a held stop, `phase-handoff.md` at a declared one. A missing handoff counts as a missing phase artifact, as it does in `loadPhaseContents`. In `src/app/reviewHandoff.ts`, render the section after `## Deviations not explained in any handoff` and the oracle pairs, and before the plan compliance review. Omit it when no phase stopped.
- In `src/domain/publish/prBody.ts`, each phase of `ShortPrBodyInput` gains `stop: ReviewedPhase | null`, and `renderPhases` appends `prPhaseStopSuffix` to a stopped phase's line. `src/app/publishRun.ts` fills it with `loadReviewedPhases`. A phase whose stop is null keeps today's line byte for byte.
- In `src/domain/review/compliancePrompt.ts`, `BuildCompliancePromptInput` gains `reviewedPhases: { phaseId, cause, handoffMd }[]`. When it is not empty, add a `## Reviewed phases` section after `## Phase handoffs`. The section says that a person reviewed and corrected these phases at a stop, and that their review corrections are judged against the interactive handoff shown there, never as deviations from the plan; then it gives each phase's cause and handoff. Also append one line to each such phase's instructions: `A person corrected this phase at a <held|declared> stop: judge its review corrections against its interactive handoff under Reviewed phases, not as plan deviations.` With no stop, the prompt is byte-identical. `src/app/reviewCompliance.ts` fills the field from the phase statuses.
- Create `tests/integration/noStopUnchanged.test.ts` for §8's last criterion. A plan with no Mode line runs without `--hold`, with records on, and the test checks the outputs against expected values it states literally:
  - the same `phax plans lint` findings;
  - no `## Review corrections` in any prompt;
  - the same states and exit codes;
  - `mode: headless` on every phase, and `hold: { selection: none }`;
  - no stop line in `phax records explain`;
  - no `## Reviewed phases` in review-handoff.md;
  - PR phase lines with no stop suffix.

### Planned files to create

- `src/domain/interactive/reviewedPhases.ts`
- `tests/unit/interactive/reviewedPhases.test.ts`
- `tests/integration/reviewedPhasesSurfaces.test.ts`
- `tests/integration/noStopUnchanged.test.ts`

### Planned files to edit

- `src/domain/interactive/handoff.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `src/app/reviewHandoff.ts`
- `src/domain/publish/prBody.ts`
- `src/app/publishRun.ts`
- `src/domain/review/compliancePrompt.ts`
- `src/app/reviewCompliance.ts`
- `tests/unit/interactive/handoff.test.ts`
- `tests/unit/publish/prBody.test.ts`
- `tests/unit/review/compliancePrompt.test.ts`

### Optional files that may be edited

- `src/domain/runReviewInfo.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/finalReview.test.ts`
- `tests/helpers/heldRunFixture.ts`
- `tests/helpers/stoppedRunFixture.ts`

### Boundary contracts

Run folder → review surfaces: each stop's cause, outcome and closer come from its phase status, and its corrections and guards from its interactive handoff file; the renderers are pure. Compliance reviewer: a stopped phase's corrections are framed by its interactive handoff, and the verdict's JSON shape does not change.

### Test strategy

- a run reaching review_open with held phase-02 corrected, declared phase-03 corrected and held phase-04 unchanged, each closed by Ada Example: review-handoff.md lists the three with their cause, outcome and Ada Example, and phase-02's and phase-03's corrections and guards; the PR lines mark phase-02 held and corrected, phase-03 interactive and corrected, and phase-04 held and reviewed without change, each by Ada Example — medium · example · the built review-handoff.md and PR body · in-phase · §8 The review handoff and the PR show the review
- `summarizeInteractiveHandoff` counts corrections, named guards and `no guard:` entries — small · table · the expected counts · in-phase
- `renderReviewedPhases` renders the table and the sections, and nothing when no phase stopped; `prPhaseStopSuffix` says `1 guard` and `2 guards` — small · table · the expected text · in-phase
- the compliance prompt presents phase-03 as declared and phase-02 as held, each with its interactive handoff, and a run with no stop builds the same prompt as before — small · example · the prompt text · in-phase · §8 Corrections are not deviations
- a plan with no Mode line run without --hold keeps its lint findings, prompts, states, exit codes, records explain output, review handoff and PR lines — medium · example · the expected values · in-phase · §8 Plans and runs without a stop are unchanged

### Implementation order

1. summarizeInteractiveHandoff
2. reviewedPhases.ts
3. the review handoff loader and section
4. the PR body line
5. the compliance prompt
6. the integration tests

### Excluded scope

- A stop dimension in the compliance verdict's JSON shape
- Any change to compliance-review.json
- The docs (phase-08)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give `summarizeInteractiveHandoff`, `ReviewedPhase`, `renderReviewedPhases` and `prPhaseStopSuffix` as written. Say where the section sits in review-handoff.md, which files `loadReviewedPhases` reads, the compliance prompt's new section and sentence, and how the no-stop test pins each surface. Explain any deviation from the planned file lists.

### Commit subject

`feat(review): show stops in the compliance review, review handoff and PR body`

### Commit body

The compliance reviewer now sees each stopped phase with its cause and
its interactive handoff, and judges the review corrections against that
handoff rather than as plan deviations. review-handoff.md gains Reviewed
phases, a table of each stop's cause, outcome, closer, corrections and
guards. The PR body's phase line shows the same. A run with no stop
keeps every surface byte for byte.

---

## phase-07 — Cost of phax's turns, and the estimate of an interactive phase {#phase-07-cost-and-estimate}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** It changes what the estimate learns from history, and adds a sizing that the cost model does not have yet, inside a fitted model whose run range and scenarios depend on it. That needs more care than the default effort.

The cost ledger holds each first and closing turn phax ran, each costed by its own increment. It holds nothing for a session the person continued, or for a session phax did not start. `phax plans estimate` names an interactive phase as interactive and sizes only its first and closing turns, in its text and `--json` output. Turn-only costs no longer distort the estimate's fit.

### Detailed instructions

- Audit `tests/integration/costLedger.test.ts` and `tests/integration/heldStopClose.test.ts` against §8 Only phax's turns are costed, and add the cases that are missing:
  - a declared phase-03 whose first turn started fake Claude session C1, which the person then continued (the fake writes to its store under the test HOME and nothing to the phase folder), closed by a turn that resumes C1, whose stream reports a cumulative $1.40 for a turn whose own cost is $0.30;
  - a held phase-02 closed by a turn that resumes its builder.
  The ledger must hold one `first-turn` and one `closing-turn` entry for phase-03, the latter $0.30; phase-02's builder entries unchanged, plus one `closing-turn` entry of its own increment; and no entry for the person's turns. Change `src/app/costLedger.ts` or `src/domain/cost/ledger.ts` only if a case fails. The ledger stays Claude Code only.
- In `src/domain/cost/history.ts`, `HistoricalPhasePlan` gains `mode`, which `src/app/estimateHistory.ts` fills from each historical plan. `trainingSamples` counts only `phase`, `fix` and `handoff` entries, and skips interactive phases. Add `interactiveTurnCosts(ledgers, sizedRuns)`, which returns, for each historical interactive phase with a ledger, the sum of its `first-turn` and `closing-turn` entries' `costUsd`.
- In `src/domain/cost/estimate.ts`, `PlanPhaseInput` gains `mode`, and every `PhaseEstimate` carries `mode`. A headless phase is estimated as today. An interactive phase is sized as follows:
  - on Claude Code, with at least 3 historical interactive phases: `{ mode: interactive, estimate: { p10, p50, p90 } }`, the nearest-rank quantiles of `interactiveTurnCosts`, rounded to cents;
  - on Claude Code, with fewer: `estimate: null, notEstimated: 'thin-interactive-history'`;
  - on another provider: `notEstimated: 'other-provider'`.
  An estimated interactive phase's P50 joins the run-level cost beside the compliance median, so the run range and the scenarios include it. `src/app/estimatePlan.ts` passes each phase's `mode`.
- In `src/domain/cost/estimateRender.ts`, an interactive phase's row reads `<id>  interactive: first and closing turns only` before its figures, and `thin-interactive-history` renders as `not estimated: too few past interactive phases`. The `--json` output carries `mode` on every phase. Nothing mentions a hold.

### Planned files to create

- (none)

### Planned files to edit

- `tests/integration/costLedger.test.ts`
- `src/domain/cost/history.ts`
- `src/domain/cost/estimate.ts`
- `src/domain/cost/estimateRender.ts`
- `src/app/estimatePlan.ts`
- `src/app/estimateHistory.ts`
- `tests/unit/cost/history.test.ts`
- `tests/unit/cost/estimate.test.ts`
- `tests/unit/cost/estimateRender.test.ts`
- `tests/integration/estimatePlan.test.ts`

### Optional files that may be edited

- `src/app/costLedger.ts`
- `src/domain/cost/ledger.ts`
- `src/domain/cost/fit.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/estimateHistory.test.ts`
- `tests/helpers/costHistory.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/unit/cost/ledger.test.ts`
- `tests/unit/cost/backtest.test.ts`

### Boundary contracts

Ledgers → estimate: the estimate reads only the ledgers and the sized history, and a phase's mode decides how it is sized. The cost ledger's entries are written only for turns that phax ran on Claude Code.

### Test strategy

- the ledger holds one first-turn and one closing-turn entry for phase-03, the closing-turn entry $0.30 and not $1.40; phase-02's builder entries unchanged, plus one closing-turn entry of its own increment; and no entry for the person's turns in C1 — medium · example · the decoded cost-ledger.json · in-phase · §8 Only phax's turns are costed, each by its own increment
- `phax plans estimate <plan> --no-probe --json`, over kept runs with interactive phases, names phase-03 interactive and sizes only its turns, and the text output says so — medium · example · the JSON report and the text · in-phase · §8 Only phax's turns are costed, each by its own increment
- training samples leave out turn entries and interactive phases — small · table · the expected samples · in-phase
- an interactive phase gets its range from 3 or more past interactive phases, `thin-interactive-history` from fewer, and `other-provider` off Claude Code — small · table · the expected estimate · in-phase
- an estimated interactive phase's P50 joins the run-level cost — small · example · the run range · in-phase
- the rendered rows for a headless and an interactive phase — small · example · the text · in-phase

### Implementation order

1. the ledger audit and its missing cases
2. history: mode, training filter and interactiveTurnCosts
3. the estimate's interactive sizing and the run level
4. the renderer and the JSON output
5. the integration test

### Excluded scope

- Sizing a hold
- Costing turns on providers other than Claude Code
- Docs (phase-08)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Say which ledger cases were already tested and which this phase added, and whether any ledger code changed. Give the training filter, `interactiveTurnCosts`, the interactive `PhaseEstimate` variants, the minimum history, how the run level includes the turns, and the rendered row. Explain any deviation from the planned file lists.

### Commit subject

`feat(estimate): size an interactive phase by its turns only`

### Commit body

phax plans estimate now names an interactive phase as interactive and
sizes only its first and closing turns, from the turn costs of past
interactive phases, or says there are too few of them. Those costs join
the run level. The fit no longer learns from turn entries or from
turn-only phases. Ledger tests now cover each case of phax's turns
costed by their own increment, with no entry for a person's turns.

---

## phase-08 — Docs, the e2e trace snapshots and the queue {#phase-08-docs-and-snapshots}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Operators, planners and review-UI authors can read how a stop's transcripts, records, security record, review handoff, PR line and run list work. The upgrade notes tell scripts what changed, and the estimate guide covers an interactive phase. The CLI help and the generated references follow. The declared and held e2e trace snapshots pin the transcript step and the stop's record. NEXT_STEPS records the spec as complete.

### Detailed instructions

- In README.md `### Interactive phases`, replace the closing not-part-of-this-release paragraph with sections on:
  - the transcripts copied at closing into `interactive-transcripts/`, and missing ones recorded with their reason;
  - the records of a stop: mode, cause, outcome, closer, sessions with their digests, the review commit, the declared phase's record, and `phax records explain` on a review commit;
  - interactive transcripts in records: kept only with `records.transcript` true, under the same destination checks, and holding what the person typed in their own session;
  - `security.json`'s stop section;
  - the review handoff's `## Reviewed phases` and the PR line;
  - `phax ls --json` and `review-stop.json` as the surface for a review UI, with a short example document;
  - closing needs a git identity in the checkout.
  State that the cost ledger covers Claude Code, as a property rather than a gap. Under README.md `## Records`, add one sentence on a stop's record.
- In `docs/upgrading.md` under `### 0.26.0`, add:
  - the run list replaces the bare array of `phax ls --json`: read `.runs[]` instead of `.[]`; `currentPhase`, `gateProfile`, `recordsPending` and `archivePath` are null when unknown; every run carries `stop`;
  - the record manifest gains `mode` and `stop`, and records written by older releases read as headless phases that never stopped;
  - `security.json` moves to version 2.
  Nothing needs to be run.
- In `docs/plan-estimate.md`, describe how an interactive phase is sized (its first and closing turns, from past interactive phases, at least 3 of them), the `mode` key in the JSON output, and that the fit leaves turn costs out.
- In `src/cli/cliDocs.ts`, update the long help:
  - `ls`: `--json` prints the versioned run list;
  - `records explain`: a review commit, and the stop lines;
  - `plans estimate`: an interactive phase;
  - `resume`: a close captures the transcripts, records the closer and writes the record, and needs a git identity.
  Then run `pnpm gen:usage-spec` and `pnpm docs:cli`.
- Extend `tests/e2e/semanticTrace.declaredStop.test.ts` and `tests/e2e/semanticTrace.heldStop.test.ts`: their temporary repository configures records (in-repo, transcript false), and their fake backend registers a transcript for their sessions. Update both snapshots for the `transcripts` step, the `stop.transcript` events and the `stop.record` step. Run `PHAX_E2E_RUN=1 npx vitest run --config vitest.e2e.config.ts tests/e2e/semanticTrace*.test.ts` if the session can. Otherwise, edit the snapshots from the projection, and say in the handoff that the operator must run that command, with `-u` if a snapshot differs.
- In `NEXT_STEPS.md`, tick `interactive-phases`. Record that plan 3 of 3 (stop records, transcripts and the run list) landed with this run and that the spec is complete, and remove the `Next` and `Gaps until then` items.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `docs/upgrading.md`
- `docs/plan-estimate.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `NEXT_STEPS.md`
- `tests/e2e/semanticTrace.declaredStop.test.ts`
- `tests/e2e/semanticTrace.heldStop.test.ts`
- `tests/e2e/__snapshots__/semanticTrace.declaredStop.test.ts.snap`
- `tests/e2e/__snapshots__/semanticTrace.heldStop.test.ts.snap`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `docs/security.md`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/usageSpecDrift.test.ts`

### Test strategy

- the generated usage spec and CLI reference match the CLI's options and long help — medium · contract · the usage-spec and CLI-docs drift suites · in-phase
- the declared and held stops' runs emit the semantic trace pinned by the updated snapshots, the transcript step and the stop's record included — medium · smoke · the semantic trace snapshots under PHAX_E2E_RUN=1 · in-phase
- the README's exit-code table still matches EXIT_CODE_MEANINGS — small · example · the README exit-code test · in-phase

### Implementation order

1. cliDocs long help and the regeneration
2. the README sections
3. docs/upgrading.md and docs/plan-estimate.md
4. the e2e suites and their snapshots
5. NEXT_STEPS

### Excluded scope

- Any code change other than `src/cli/cliDocs.ts` and the two e2e suites
- The phax-planning skill, which this plan does not change

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List each README, upgrade-note and estimate-guide section added or changed, and the stale statements removed. Confirm that the usage spec and the CLI docs were regenerated. Say whether the e2e snapshots were written by running the suites or edited by hand; if edited by hand, give the operator the exact command to confirm them. Confirm that NEXT_STEPS marks the spec complete. Explain any deviation from the planned file lists.

### Commit subject

`docs(interactive): document transcripts, stop records and the run list`

### Commit body

The README explains the transcripts a close captures, the record and
security record of a stop, the review handoff and PR lines, and phax ls
--json with review-stop.json as the surface for a review UI. The 0.26.0
upgrade notes cover the run list, the record manifest and security.json,
and the estimate guide covers interactive phases. The CLI help, the
generated references and the e2e trace snapshots follow. NEXT_STEPS
marks the spec complete.
