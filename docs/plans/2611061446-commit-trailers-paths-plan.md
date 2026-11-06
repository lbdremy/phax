---
status: Draft
source-spec: null
---
# Commit trailers without machine paths

A phase commit must say nothing about the machine that ran phax: not the user's account name, and not how their disk is laid out. Right now every phase commit (`buildCommitBody` in `src/app/commit.ts`), every declared interactive commit (`buildInteractiveCommitBody`) and every held review commit (`buildHeldReviewCommitBody`) ends with `Worktree:` and `Gate-Log:` trailers. Both hold absolute paths under the state root, which sits in the user's home. A phase commit also carries the provider's `Session-Id` in clear, although decision and authoring records withhold session ids (`[session id withheld]`, `src/app/recordPlumbing.ts`).

After this plan, a commit no longer carries `Worktree` or `Session-Id`. `Gate-Log` stays, but as a path relative to the run folder (`phase-02/checks-attempt-01.log`, or `phase-03/review-gate/checks-attempt-01.log` for a held close), and `Gate-Log: none` keeps its meaning. `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model`, `Effort`, `Interactive-Phase` and `Held-Phase` keep their names and meanings, so `phax records explain` and the release notes still find a phase's commits. `closeStop` still finds the gate attempt that let a landed commit through: it resolves a relative `Gate-Log` against the run folder it already knows. It reads an absolute one, written before this change, as it does today, so an older commit still closes. No setting is added, and no persisted record or run file changes version. phax rewrites no history. The docs list the trailers older commits carry, and the git tools a user may run on their own history to remove them.

The single phase is written for the recommended answer to each open question below. If the operator decides otherwise, the decision is recorded in the arbitrated section, and the phase follows the decision wherever it differs from its own text.

## Required commands

- (none)

No new command: the phase uses the repository's existing pnpm scripts through the `standard` gate profile.

## Technical arbitrations

- No setting governs any trailer. A trailer that only ever leaks something is removed, not made configurable. The trailers that stay are ones a reader of the history needs, and they name no person and no disk. Loss accepted: a user who wanted `Worktree` or `Session-Id` back in their own history cannot turn them on.
- One phase covers the code, its tests and the docs. The change is a few lines in the body builders and one resolution in `closeStop`, with no seam worth a commit of its own. No acceptance pair is declared: the guarantees live in the body builders and one close path, which the phase's own tests pin. Loss accepted: no test is frozen ahead of the code.
- The `CloseReport.gateLog` fact that `closeStop` returns stays an absolute path. Only the commit's trailer becomes relative, because the report never leaves the machine. Loss accepted: the in-memory and on-disk path differs in form from the trailer, so the conversion lives in two small functions (one to write the trailer, one to resolve it).

## Open questions

### Q1 — What becomes of the `Worktree` trailer on phase, interactive and held review commits?

- drop — Remove it from all three commit bodies — abandons: A reader of the history can no longer see which worktree folder a phase ran in. The run folder and the phase's branch name (`phax/<name>--phase-NN`) still say so on the machine that ran it.
- relative — Keep it, relative to the state root (`worktrees/<namespace>.<short name>/phase-02`) — abandons: Every commit keeps a line that no command reads and that means nothing on any other machine, and the project's namespace stays in the history for no use.

Recommendation: drop — Nothing reads `Worktree` back: `closeStop` and `phax records explain` both find what they need without it, and once a run is pruned the folder it names is gone. A relative path keeps a line that has no reader. Removing it is the only option that loses nothing a reader uses.

### Q2 — In what form does the `Gate-Log` trailer stay, and what finds the gate attempt when a stop is closed?

- run-relative — Keep `Gate-Log`, relative to the run folder (`phase-02/checks-attempt-01.log`); `closeStop` resolves it against the run folder it already has, and reads an absolute value as it does today — abandons: On its own, the trailer does not name the run folder: to find the run's `<namespace>.<short name>` folder, a reader combines it with `Short-Name` and the project's namespace.
- state-relative — Keep `Gate-Log`, relative to the state root (`runs/<namespace>.<short name>/phase-02/checks-attempt-01.log`) — abandons: `closeStop` and the commit builders have to be given the state root, which is a new required input on `CloseStopInput`. Every test that calls `closeStop` (a dozen integration files) must pass it, to put a namespace in the history that `Run-Id` and `Short-Name` already imply.
- drop — Remove `Gate-Log`; a landed close takes the last `checks-attempt-NN.log` in its gate folder — abandons: The commit no longer names the attempt that let it through. A landed close guesses the attempt from what is on disk instead of reading it from the commit, and a reader of the history loses the link to the gate log.

Recommendation: run-relative — The value contains no name and no disk layout, `closeStop` resolves it with the `runPath` it already receives, and an older absolute value still closes. Its only loss is that the line does not name the run folder on its own, and only the machine that ran the gate can use the trailer anyway.

### Q3 — What becomes of the `Session-Id` trailer on phase commits?

- drop — Remove it, as decision and authoring records withhold session ids — abandons: Nothing in the history links a phase commit to a provider session, so a reader can no longer join a commit to the provider's transcript store or to a tool keyed on session ids (such as the Entire checkpoint join tried in the archived spike) from the commit alone. The phase folder's agent binding still holds the id on the machine.
- keep — Keep it in clear — abandons: phax stays inconsistent: it withholds session ids from the records branch but publishes them in every pull request merged by rebase or merge.
- setting — Remove it by default, with a setting to write it — abandons: A config key and its schema, docs and tests have to be maintained for a trailer no phax command reads, and the history then differs from one repository to the next.

Recommendation: drop — No phax code reads `Session-Id` back from a commit. The run already keeps the id in the phase folder's agent binding, and the records already treat it as something not to publish. A setting would maintain a key for a value that only leaves the machine.

---

## phase-01 — Commit trailers name no path of the machine {#phase-01-commit-trailers}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

After this phase, a phase commit, a declared interactive commit and a held review commit carry no absolute path and no provider session id. `Worktree` and `Session-Id` are gone, and `Gate-Log` is a path relative to the run folder. Closing a stop still finds the gate attempt from either form, and the docs say what changed and what a user may do about history phax has already written.

### Detailed instructions

- Follow the preamble's arbitrated questions where they exist. This section is written for the recommended answers: Q1 drop, Q2 run-relative, Q3 drop.
- In `src/app/commit.ts`, add and export two small pure functions. `gateLogTrailerValue(runPath: string, gateLogPath: string | null): string` returns `none` for null. For a log inside the run folder, it returns its POSIX path relative to `runPath` (use `node:path` `relative`, then replace `\` with `/`). For a log outside the run folder (the relative path starts with `..` or is absolute), it returns `none`, so the commit never carries a path outside the run. `resolveGateLogTrailer(runPath: string, value: string | null): string | null` returns null for null or `none`. It returns an absolute value as is (a commit written before this change), and joins any other value onto `runPath`.
- In `buildCommitBody`, remove the `Worktree:` and `Session-Id:` lines and write `Gate-Log: ${gateLogTrailerValue(opts.runPath, opts.gateLogPath)}`. Keep the order and spelling of `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model` and `Effort` unchanged. `CommitPhaseOptions` keeps `worktreePath` and `sessionId`: `commitPhase` uses them to commit and in its `PhaseHadNoChanges` event. Only the body stops writing them.
- In `InteractiveCommitBodyOptions`, replace `worktreePath` with `runPath: string`, and keep `gateLogPath` absolute. In `buildInteractiveCommitBody` and `buildHeldReviewCommitBody`, remove the `Worktree:` line and write `Gate-Log:` through `gateLogTrailerValue`. `Interactive-Phase` and `Held-Phase` stay as they are. Update the doc comments of both builders so they say which trailers are written and that none names a path outside the run.
- In `src/app/closeStop.ts`, at step 6, build `bodyOptions` with `runPath: input.runPath` in place of `worktreePath`. In `finishLandedCommit`, compute `gateLog` as `resolveGateLogTrailer(input.runPath, trailerValue(message, "Gate-Log"))`, so that `CloseReport.gateLog` and `landedAcceptanceStep` still receive an absolute path or null. Update the `gateLog` doc comment on `CloseReportFacts`.
- Check that `src/app/executePlan.ts` already passes `runPath` and the absolute `gateLogPath` to `commitPhase` (around the `gateLogPath` assignments near line 2423). If it does, the file needs no edit. Touch it only if the type change requires it.
- Tests. Create `tests/unit/commitTrailers.test.ts` covering the three body builders and the two functions, using the cases listed under Test strategy. In `tests/integration/gateLogTrailer.test.ts`, change the expected trailers from `join(phaseFolder, ...)` to the run-relative form (for example `Gate-Log: phase-01/checks-attempt-03.log`); keep the `Gate-Log: none` case. In `tests/integration/declaredStopClose.test.ts`, `tests/integration/heldStopClose.test.ts` and `tests/integration/stopClosedBy.test.ts`, pass `runPath` instead of `worktreePath` to the builders. Add one test per cause (declared, held) where the landed commit carries an absolute `Gate-Log` written by hand, in the old body's shape including `Worktree:` and `Session-Id:` lines. The close must finish from it, with `gateLog` equal to that absolute path. Also assert that a commit the close writes has no `Worktree:` or `Session-Id:` line.
- Docs, all in phax's own words and naming no project. In `README.md`, add a short `### The phase commit` subsection under `## Run a plan`, before `### When a run stops`. List the trailers a phase commit carries and what each means, then the interactive and held variants (`Interactive-Phase`, `Held-Phase`). Say that no trailer names a path outside the run folder or a provider session. Say that commits written by earlier versions may carry `Worktree:`, `Gate-Log:` with an absolute path, and `Session-Id:`. Say that rewriting history is the user's choice and never phax's, and name `git filter-repo --message-callback` and `git filter-branch --msg-filter` as the tools a user may run on their own branches, without giving a ready-made command that rewrites a shared branch.
- In `docs/upgrading.md`, add a `### 0.35.0` section at the top of `## Release by release`, or extend it if one exists by then. Add one bullet: phase, interactive and held review commits no longer carry `Worktree` or `Session-Id`, and `Gate-Log` is relative to the run folder. Say that a stop whose commit was written by an older version still closes, and that no record or run file changes. A script that read those trailers reads the phase folder (`agent-binding` for the session, the attempt logs) instead. Link to the new README subsection for history already written.
- Search `README.md`, `docs/*.md` and `docs/cli/reference.md` for any remaining description of `Worktree`, `Session-Id` or an absolute `Gate-Log` as a commit trailer, and update it. Archived specs, plans, briefs and spikes under `docs/**/archive/` and `docs/spikes/` are history: leave them unchanged.

### Planned files to create

- `tests/unit/commitTrailers.test.ts`

### Planned files to edit

- `src/app/commit.ts`
- `src/app/closeStop.ts`
- `tests/integration/gateLogTrailer.test.ts`
- `tests/integration/declaredStopClose.test.ts`
- `tests/integration/heldStopClose.test.ts`
- `tests/integration/stopClosedBy.test.ts`
- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `docs/cli/reference.md`
- `docs/security.md`
- `tests/integration/stopRecords.test.ts`
- `tests/integration/acceptancePairReview.test.ts`
- `tests/integration/heldStopRun.test.ts`

### Boundary contracts

Commit body → git history (producer: `src/app/commit.ts`; consumers: `closeStop`, `phax records explain`, release notes). The trailer names `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Model`, `Effort`, `Interactive-Phase` and `Held-Phase` keep their meaning. `Gate-Log` changes form (run-relative, or `none`), and its only reader, `closeStop`, accepts both the old and the new form. The `CloseReport` that `closeStop` returns to `executePlan` keeps `gateLog` as an absolute path or null.

### Test strategy

- a phase commit body carries Run-Id, Short-Name, Phase-Id, Phase-Title, Model, Effort and Gate-Log in that order, and no Worktree or Session-Id line — small · example · expected body text · in-phase
- the interactive and held review bodies carry no Worktree line and a run-relative Gate-Log — small · example · expected body text · in-phase
- no line of any of the three bodies contains the run path, the state root or the home folder used to build it — small · table · substring absence over every builder × gate log case · in-phase
- a gate log inside the run folder, null, and one outside the run folder are written as its relative path, none and none — small · boundary · expected trailer value · in-phase
- resolving the written trailer against the run folder gives back the gate log path, and an absolute or none value resolves as before — small · table · the original absolute path, or null · in-phase
- a run's phase commits carry the run-relative Gate-Log of the attempt that passed, and Gate-Log: none on a commit-only resume — medium · example · trailer read from the real git commit · in-phase
- a declared and a held close whose landed commit has the new trailer, and one whose landed commit has an old absolute Gate-Log, both finish with the absolute gate log in the report — medium · example · CloseReport.gateLog and the phase status · in-phase

### Implementation order

1. `gateLogTrailerValue` and `resolveGateLogTrailer` in `src/app/commit.ts`, with their unit tests.
2. The three body builders and `InteractiveCommitBodyOptions`, with the body unit tests.
3. `closeStop`: the body options and the landed-commit resolution.
4. The integration tests: gateLogTrailer, declaredStopClose, heldStopClose, stopClosedBy, and any other caller the type change breaks.
5. README.md and docs/upgrading.md.

### Excluded scope

- Rewriting any repository's existing history, phax's included; phax runs no history-rewriting command.
- The pull request body phax opens.
- The records branch, its manifests and its redaction of session ids.
- Any new setting in phax.json or its schema.
- Any version bump of a persisted record or run file.
- Archived specs, plans, briefs and spike findings that quote the old trailers.

### Verification

The `standard` gate profile configured in `phax.json`.

### Expected handoff content

List the trailers each of the three commit bodies now writes, in order. Give the signatures and module path (`src/app/commit.ts`) of `gateLogTrailerValue` and `resolveGateLogTrailer`, and how `closeStop` reads a landed commit's `Gate-Log` in both forms. Name the tests that cover an old absolute-trailer commit closing. Say where the README now describes the trailers and the history already written, and what the 0.35.0 upgrading entry says. Explain any deviation from the planned file lists that phax flags, such as an extra test file the `InteractiveCommitBodyOptions` change forced you to update.

### Commit subject

`fix(commit): drop machine paths and session id from phase commit trailers`

### Commit body

Phase, interactive and held review commits wrote Worktree and Gate-Log as absolute paths under the state root, which sits in the user's home, and the phase commit wrote the provider Session-Id in clear. A pull request merged by rebase or merge published both in the repository's history.

Worktree and Session-Id are no longer written. Gate-Log is now relative to the run folder, or none, and closeStop resolves it against the run folder it already has. A landed commit written before this change, with an absolute Gate-Log, still closes. Run-Id, Short-Name, Phase-Id, Phase-Title, Model, Effort, Interactive-Phase and Held-Phase are unchanged, and no record or run file changes version.

The README describes the trailers and names the git tools a user may run to clean history written by earlier versions; phax rewrites none. docs/upgrading.md records the change for 0.35.0.
