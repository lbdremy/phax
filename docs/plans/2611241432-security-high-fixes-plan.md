---
status: Draft
source-spec: docs/specs/2611231049-security-high-fixes.md
completes-spec: true
---
# Security high fixes

This plan closes four High findings from the 2026-11-23 security audits, as the approved spec `docs/specs/2611231049-security-high-fixes.md` requires. It implements every requirement of §5, every surface of §6 and every acceptance criterion of §8. In each finding, phax trusts a file the agent under review can write.

- SEC-02: a skeleton record publishes transcripts. Phase records are now built from an allowlist, and a skeleton carries no transcript-class file (phase-01).
- SEC-06 and SEC-07: phax's git calls in a phase worktree run hooks and config the agent chose. They now run with `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, after a check that the `.git` pointer still names the gitdir phax created. Vibe also denies writes to `.git` (phase-02).
- SEC-08 and SEC-23: a `.phax-context` symlink redirects phax's reads and writes. phax now uses `.phax-context` only as a real directory. It ignores it through `.git/info/exclude` instead of the worktree's `.gitignore`, and decodes pulled brief records before copying them (phase-03).
- SEC-09: the code review reads its instructions from the reviewed worktree. It now reads the project review skill from the run base and reports when the run changed it (phase-04).
- The docs come last (phase-05).

The operator's verdicts of 2026-11-24 in the spec's §9b are settled and not reopened: logs-out, keep-paths, hookspath-all, leave-to-sec01, the pointer check plus both `-c` settings (the residual named), info-exclude, decode, run-base. So are the spec's §10 settled points, its constraints and its §7 non-goals.

`gate-step-times` has landed (#260), so §10's footprint constraint against it no longer binds. Its allowlist constraint still does: phase-01 reads #260's diff before writing the allowlist.

A parallel run may hold `launcher-release-fixes`, which edits `npm/`, `deno.json`, `scripts/` and the release audit. No phase here touches those paths. The operator runs `phax plans overlap` before starting.

No phase is an acceptance phase. Every criterion is checked by in-phase tests against real git or a real filesystem (§10), and each test that proves a hook or fsmonitor did not run uses a marker file, never timing. Real-git tests isolate their config and identity with `tests/helpers/isolateGit.ts`, spawn children only through `tests/helpers/boundedSpawn.ts`, and never read `~/.phax`, a real provider home or the global git config.

A correct run must commit, record (with transcripts on) and be reviewed exactly as today. Existing suites change only where they assert the old skeleton content, the old `.gitignore` line, or the old review-skill source.

## Required commands

- `pnpm test:unit`
- `pnpm test:integration`
- `git log`

Each of these commands already appears verbatim in `security.agentCommands` in `phax.json`. `git log` lets phase-01 read #260's diff (`git log -p`). The plan needs no change to the PHAX security configuration.

## Technical arbitrations

- Where the worktree git hardening lives. It lives in `src/infra/git.ts`, in the one process helper (`runGitProcess`) that every git call goes through, and is keyed by the call's working directory. A git layer built with the main checkout's root (`makeNodeGitLayer({ repoRoot })`) reads that repository's common dir (`git rev-parse --path-format=absolute --git-common-dir`, run in the main checkout) and its `worktrees/*/gitdir` registrations. It treats every registered linked worktree, other than the repository root itself, as a phase worktree. Each call whose real cwd lies in one is checked first: its `.git` must be a regular file naming that registration's gitdir. Then the call runs with `-c core.hooksPath=/dev/null -c core.fsmonitor=false`. `addWorktree` always carries both `-c` settings. Every composition that can reach a phase worktree builds the rooted layer: `provideRunLayers`, review-code, reset-phase, sessions, and run or resume wherever they build their own. The repository-less `NodeGitLayer` behaves exactly as today, for commands that stay in the main checkout and for tests. Loss accepted: the guard is only as complete as the list of compositions that build the rooted layer, which phase-02's handoff names. Each worktree call also costs one lstat and one read of `.git`. Rejected: keying on what sits at `<cwd>/.git`, because a worktree whose `.git` was replaced by a directory would pass as a main checkout; and an app-level check before each port call, because a call that forgets the check skips it.
- What a refusal leaves. A changed pointer fails the call with a `GitError`, before any git process starts. Its message carries the spec's three lines: what `.git` holds, the expected `gitdir:`, and that phax ran no git command there. The phase then fails through the existing GitError path (status failed, the run's lastError). `phax resume` alone refuses again, because the check runs again. `phax reset-phase` recovers the phase. phase-02 makes it delete a worktree whose pointer `git worktree remove --force` refuses to validate, then prune the registration. A `.phax-context` that is not a real directory raises a new tagged `PhaxContextRefusedError` (path, kind, link target). The phase fails the way it fails on a `WorktreeCreationError`. The operator recovers by removing the entry from the branch it came from, then running `phax reset-phase` and `phax resume`. Loss accepted: tampering gets no distinct exit code. It reads as a failed phase with a precise message.
- The allowlist's form. One pure table in `src/domain/records/phaseRecordFiles.ts` holds exact names plus per-attempt patterns: `checks-attempt-NN.{log,request.json,acceptance-request.json,oracle-request.json,attribution.json,report-SS.json}`, `fix-attempt-NN.jsonl`, `agent-error.failed-NN.log`, `brief-NN.json`. Each entry is tagged transcript-class or not. The record's shape is still decided by `output.jsonl` alone. Stop files, `.vibe-export` directories and archived transcripts (`*.failed-NN.jsonl`) are on no list, and `assembleRecord` keeps its explicit filters for them, so their treatment does not change. Authoring, decision and revision records keep their own allowlists and stay byte-identical. Loss accepted: a phase-folder file that a future change adds is carried by neither shape until it is added to the table. The full-record test catches a regression only for the files it lists.
- Which skeleton drops the logs. A skeleton record carries no transcript-class file, whatever made it a skeleton: transcripts off, or no `output.jsonl`. This follows the spec's terminology. Loss accepted: with transcripts on, a phase whose provider wrote no `output.jsonl` (a session that never started) no longer records its `agent-error.log`, `setup.log` or gate logs. Its `status.json` still names the failure.
- Pulled and pushed brief records (`brief-NN.json`, `brief-00.json`) are on the allowlist and are not transcript-class, so both shapes carry them, as today. phase-03 decodes each pulled record before copying it, so it holds no arbitrary agent bytes. Loss accepted: a skeleton keeps the brief provider's decoded report.
- Where `info/exclude` is resolved. A new Git port method resolves it in the main checkout, never in a worktree, with `git rev-parse --path-format=absolute --git-common-dir`. A worktree of a worktree, or a submodule, therefore finds the right file. The method appends `/.phax-context` only when no line equals it exactly. Loss accepted: phax leaves one line in the user's repository-local exclude file after the run, shared by the main checkout and every worktree. It also ignores a top-level `.phax-context` in the main checkout, where none exists.
- How the review finds the skill. It reads the entry at `.claude/skills/phax-review/SKILL.md` from the run base's tree (`firstPhase.base`) through the Git port, in the main checkout. Only a regular blob (mode 100644 or 100755) counts as a project skill. A symlink blob (120000), a tree or nothing means the bundled skill. The run changed the skill when the path's entry at the run branch tip differs from its entry at the base, in mode or oid, including added or removed. Loss accepted: an uncommitted edit in the run worktree is not reported, though it is never read either. With no recorded base, the review follows the bundled skill and says the base is unknown.

---

## phase-01 — Phase records from an allowlist {#phase-01-records-allowlist}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The operator's brief assigns claude-opus-5-5 to the records allowlist. The phase must inventory every phase-folder writer across the codebase and keep a full record byte-identical, and a silent omission there would drop a file from every record.

Build every phase record from a fixed allowlist of phase-folder files, so a skeleton record (transcripts off, or no transcript) carries no transcript-class file. A full record carries exactly what it carries today (SEC-02, spec §5.1–§5.3).

### Detailed instructions

- Inventory first. Find every file phax writes into a phase folder: grep `src/` for joins on the phase folder (`phaseFolderPath`, `phaseFolder`, `folder` in `executePlan.ts`, `fixLoop.ts`, `handoffGeneration.ts`, `setup.ts`, `commit.ts`, `agentBinding.ts`, `phaseStatusUpdates.ts`, `pushedBrief.ts`, `pullBrief.ts`, `gates.ts`, `gateAttribution.ts`, `src/infra/providers/sessionWriter.ts`, the provider dispatcher and the failure archive), plus the names in `src/domain/gate/attemptFiles.ts`. Read #260's diff with `git log -p` on `src/app/gates.ts`, `src/app/gateAttribution.ts` and `tests/integration/writeRecord.test.ts` to confirm whether `gate-step-times` added a phase-folder file. Record the full inventory in the handoff.
- Create `src/domain/records/phaseRecordFiles.ts`, a pure module with no I/O. It holds the record allowlist: exact names (at least `prompt.md`, `status.json`, `security.json`, `model-resolution.json`, `agent-binding.json`, `claude-session-id.txt`, `diff.patch`, `file-reconciliation.json`, `gate-attribution.json`, `phase-handoff.md`, `brief-00.json`, `output.jsonl`, `handoff-generation.jsonl`, `setup.log`, `agent-error.log`, and any other name the inventory finds) and the per-attempt patterns (`checks-attempt-NN.log`, `.request.json`, `.acceptance-request.json`, `.oracle-request.json`, `.attribution.json`, `.report-SS.json`; `fix-attempt-NN.jsonl`; `agent-error.failed-NN.log`; pulled `brief-NN.json`). Reuse the regexes of `attemptFiles.ts` and `failureArchive.ts` where they fit, rather than copying them.
- Tag each allowlist entry transcript-class or not. Transcript-class is exactly the spec's §4 list: `output.jsonl`, `fix-attempt-NN.jsonl`, `handoff-generation.jsonl`, `checks-attempt-NN.log`, `setup.log`, `agent-error.log`, `agent-error.failed-NN.log`. If the inventory finds another phase-folder file that holds what an agent or a project command printed, tag it transcript-class too and justify it in the handoff.
- Export two predicates, for example `isPhaseRecordFile(name)` and `isTranscriptClassFile(name)`. Export only what `assemble.ts` and the tests import (knip runs at the gate).
- Change `assembleRecord` in `src/domain/records/assemble.ts`. Keep its explicit filters for stop artifacts, Vibe export directories and archived transcripts. Keep only allowlisted names. Decide the shape on `output.jsonl` alone, as today: full when `transcriptEnabled` and `output.jsonl` is present. Drop every transcript-class file from a skeleton, and keep them all in a full record. Separate the question 'is there a transcript' from 'what a skeleton leaves out' without changing `selectRecordArtifacts`'s behaviour for authoring, decision and revision records. Either give the phase path its own selection, or extend the shared function with a backward-identical default. Their tests must pass unchanged.
- The manifest's `shape` stays `skeleton` | `full`. Change no persisted schema and no stamp. Do not touch `src/domain/records/destination.ts`.
- Before changing the code, write the full-record test against the current code and see it pass. It builds a real phase folder with one file of every kind the inventory found (including `output.jsonl`, `fix-attempt-01.jsonl`, `handoff-generation.jsonl`, `checks-attempt-01.log`, `checks-attempt-01.request.json`, `checks-attempt-01.attribution.json`, `setup.log`, `agent-error.log`, `agent-error.failed-01.log`, `security.json`, `status.json`, `prompt.md`, `diff.patch`, `brief-01.json`, plus stop files and a `.vibe-export` directory), writes the record with `writeRecord` to a real repository, and lists the record's tree. Freeze today's list in the test, then change the code. The test must still pass.
- In the same new integration test, cover the skeleton case. With `records.transcript: false`, the same folder records exactly the non-transcript allowlisted files: the spec's §6 skeleton listing plus the folder's `brief-01.json` and per-attempt request/attribution files. Shape is skeleton and no transcript-class file is present. Also check that `notes.txt` is carried by neither shape.
- Update the existing tests that assert the old skeleton content: in `tests/unit/recordsAssemble.test.ts`, the cases carrying `checks-attempt-NN.log` with transcripts off, and the case treating `retry-output.jsonl` as an ordinary phase file, which is now outside the allowlist; in `tests/integration/writeRecord.test.ts`, skeleton expectations that list gate logs. Do not weaken a full-record expectation. If a records-explain or stop-record test asserted a skeleton's gate logs, update its fixture or expectation only. `src/app/recordsExplain.ts` is not edited (§7).

### Planned files to create

- `src/domain/records/phaseRecordFiles.ts`
- `tests/unit/records/phaseRecordFiles.test.ts`
- `tests/integration/phaseRecordAllowlist.test.ts`

### Planned files to edit

- `src/domain/records/assemble.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/integration/writeRecord.test.ts`

### Optional files that may be edited

- `src/domain/gate/attemptFiles.ts`
- `src/domain/session/failureArchive.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/recordsExplainStop.test.ts`
- `tests/integration/stopRecords.test.ts`
- `tests/integration/bulkRecords.test.ts`
- `tests/integration/vibeModelRecords.test.ts`

### Boundary contracts

Domain → app: `writeRecord` (producer of the folder listing) still hands `assembleRecord` the phase folder's names and receives the ordered artifact paths and manifest. Only the selection changes, and the writer still performs none of its own. `selectRecordArtifacts`'s contract with the authoring, decision and revision writers is unchanged.

### Test strategy

- a real phase folder holding one file of every kind, recorded with transcripts off, carries exactly the non-transcript allowlisted files and no transcript-class file, with shape skeleton — medium · example · the spec's §6 skeleton listing plus the folder's brief and per-attempt request files, as the record's tree on phax/records/v1 · in-phase · ac-skeleton-set
- the same folder recorded with transcripts on carries the same file list the pre-change writer recorded, with shape full — medium · example · file list frozen from the pre-change code, written before the change and passing on it · in-phase · ac-full-set
- a notes.txt beside the usual files is carried by neither the skeleton nor the full record — small · example · artifact paths without notes.txt for both toggles · in-phase · ac-unknown-file
- every phase-folder name phax writes is classified as transcript-class, carried, or never carried, as the table says — small · table · classification table of spec §4 and the phase-folder inventory · in-phase
- authoring, decision and revision records select exactly what they selected before — small · example · the existing selectRecordArtifacts cases, unchanged · in-phase

### Implementation order

1. Inventory the phase-folder files and read #260's diff.
2. Write the full-record integration test against the current code; see it pass.
3. Add phaseRecordFiles.ts and its table test.
4. Change assembleRecord; add the skeleton and notes.txt cases.
5. Update the existing tests that asserted the old skeleton content.
6. Run the standard gate profile.

### Excluded scope

- The records destination rule (`destination.ts`): a skeleton stays allowed in-repo on a public repository.
- Absolute paths in security.json and status.json (q-abs-paths: keep-paths).
- Revision, decision, authoring and review records.
- Any change to `src/app/recordsExplain.ts` or to records already on phax/records/v1.
- Docs (phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The phase-folder inventory: every name or pattern phax writes into a phase folder, the file that writes it, and its class (transcript-class, carried, never carried). What #260 changed in that set, if anything. The exported predicates of `src/domain/records/phaseRecordFiles.ts` and how `assembleRecord` now selects. Which existing test expectations changed and why. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(records): build phase records from an allowlist, no transcript in a skeleton`

### Commit body

A skeleton record carried every phase-folder file but output.jsonl, so fix-attempt and handoff streams, gate and setup logs and agent error logs reached the records branch with transcripts off (SEC-02).

Phase records now keep only the files of a fixed allowlist, each tagged transcript-class or not. A skeleton leaves every transcript-class file out; a full record carries what it carried before. A file outside the allowlist is carried by neither shape. The manifest's shape and the destination rule are unchanged.

Covered by a real phase folder recorded in both shapes against a real repository, with the full-record list frozen from the pre-change writer.

---

## phase-02 — Worktree git calls run no hook, no fsmonitor, and check the gitdir pointer {#phase-02-worktree-git-hardening}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The operator's brief assigns claude-opus-5-5 to the git helper. The phase designs a guard the code does not hold yet, inside the one helper every git call crosses, and wires it through several CLI compositions without a bypass.

Every git command phax runs in a phase worktree, including the `git worktree add` that creates it, runs with hooks off and `core.fsmonitor=false` on its command line. Before each such call, phax checks that the worktree's `.git` still names the gitdir phax created, taken from the main checkout, and fails the phase otherwise. Vibe sessions can no longer write the worktree's `.git` (SEC-06, SEC-07, spec §5.4–§5.8).

### Detailed instructions

- Create `src/domain/security/gitdirPointer.ts`, pure with no I/O. It parses a `.git` pointer's text (`gitdir: <path>`, trailing newline tolerated, a relative path resolved against the worktree root as git does with `worktree.useRelativePaths`). It decides a verdict from the entry kind (regular file, directory, symlink, other, absent), the parsed path and the expected gitdir, comparing normalised absolute paths. It also renders the refusal message with the spec's lines: `the worktree's .git no longer points at the git directory phax created`, `.git holds:  <content, or what the entry is>`, `expected:    gitdir: <expected>`, `phax ran no git command in this worktree after the change.` Include the worktree's `.git` path in the message.
- Create `src/infra/gitWorktreeGuard.ts`. Given the main checkout's root, it resolves the common dir once by running `git rev-parse --path-format=absolute --git-common-dir` in the main checkout (never in a worktree) and reads the registrations `<common>/worktrees/<name>/gitdir`. Each one names `<worktree>/.git`, and the expected pointer is `gitdir: <common>/worktrees/<name>`. Cache the registrations and re-read them when a cwd is not found and after `addWorktree`, `removeWorktree` or `pruneWorktrees`. A cwd is a phase-worktree call when its realpath lies inside a registered worktree other than the main checkout itself. For such a call, the guard lstats and reads `<worktree>/.git` and asks `gitdirPointer.ts` for the verdict.
- In `src/infra/git.ts`, route the hardening through `runGitProcess`, which every call reaches through `gitRun`, `gitRunBuffer`, `gitRunAllowFail` or directly in `diffNoIndex`. For a phase-worktree call on a rooted layer, run the pointer check first and reject with a `GitError` carrying the rendered message, without spawning git. Otherwise prepend `-c core.hooksPath=/dev/null -c core.fsmonitor=false` to the arguments. `addWorktree` always carries both `-c` settings, whatever the layer, so `post-checkout` never runs when phax creates a worktree. Calls in the main checkout and in a records clone are unchanged, so the user's own hooks still run at phax's artifact commits there.
- Change the layer factory: `makeNodeGitLayer({ repoRoot })` builds the rooted, hardened layer. `makeNodeGitLayer()` and `NodeGitLayer` with no repository keep today's behaviour exactly, except that `addWorktree` is always hardened. Then make every composition in `src/` that can run git in a phase worktree build the rooted layer from its config's repository root. At least: `provideRunLayers` in `src/cli/commands/runLayers.ts` (run and resume), `src/cli/definitions/review.ts`, `src/cli/definitions/resetPhase.ts` and `src/cli/definitions/sessions.ts`. Check every other `NodeGitLayer` or `makeNodeGitLayer` use in `src/cli/` and list each with its verdict in the handoff. Keep `NodeGitLayer` exported and used in `src/` so knip's production run stays clean. Do not edit knip.json or its baseline.
- Grep `src/` for any other spawn of `git` outside `src/infra/git.ts`. If one runs in a phase worktree, route it through the adapter; list what you found in the handoff.
- Recovery: `phax reset-phase` must recover a phase whose pointer was rewritten. `git worktree remove --force` refuses to validate such a worktree. When that removal fails for the recorded phase worktree under phax's state root, `src/app/resetPhase.ts` deletes the worktree directory through the FileSystem port, never following links, then calls `git.pruneWorktrees(repoRoot)`. A later `phax resume` then recreates the worktree. If `previewResetPhase` or the reset CLI runs a git call in the worktree first, make sure the reset still proceeds for a failed phase. `phax resume` alone keeps refusing, because the check runs again.
- Vibe: in `src/domain/session/vibeFlags.ts`, add the worktree's `.git` and everything under it (`<cwd>/.git` and `<cwd>/.git/**`) to the `write_file` and `edit` denylists that secure sessions build. Leave read-only and sealed flags as they are unless they share the denylist. Update `tests/unit/session/vibeFlags.test.ts`.
- Write `tests/integration/gitWorktreeHardening.test.ts` against the real adapter (`makeNodeGitLayer({ repoRoot })`) and real git, in temporary repositories isolated with `tests/helpers/isolateGit.ts`. (1) A tracked `core.hooksPath=.husky` whose `.husky/pre-commit` the 'agent' rewrote to create a marker outside the worktree. Call the phase commit (`commit`) and, separately, the stop close's commit (`commitTree`): each commit exists and the marker does not. (2) A tracked `post-checkout` under the hooks path that creates a marker: `addWorktree` creates the worktree and the marker does not exist. (3) A `.git` rewritten to `gitdir: ./x`, with `x/HEAD` and an `x/config` setting `core.fsmonitor` to a marker-creating script: `observeWorktree` fails, its message names the `.git` path, its content and the expected gitdir, and the marker does not exist. (4) `core.fsmonitor` written into the common `.git/config` with the pointer intact: `observeWorktree` succeeds and the marker does not exist. (5) An intact worktree: `status`, `snapshotWorktree`, `commit` behave as before. (6) A `commitPaths` in the main checkout still runs the user's pre-commit (marker present), so the hardening is scoped to phase worktrees. Prove each not-run case by a marker file, never by timing.
- Write `tests/integration/worktreePointerRun.test.ts` at the run level. Use a real repository and real git with the fake backend, following an existing run harness with real git (for example `tests/integration/protectedPathsCheck.test.ts`). The fake agent's turn rewrites `.git` to `gitdir: ./x` with a planted fsmonitor. The phase ends failed, its error names `.git`, its content and the expected gitdir, and the marker does not exist. Then `resetPhase` removes the tampered worktree, and a resume recreates it with an intact pointer.
- Run the existing suites unchanged. The run, resume, stop and review suites use the repository-less layer or fakes and must pass as they are (§5.15).

### Planned files to create

- `src/domain/security/gitdirPointer.ts`
- `src/infra/gitWorktreeGuard.ts`
- `tests/unit/security/gitdirPointer.test.ts`
- `tests/integration/gitWorktreeHardening.test.ts`
- `tests/integration/worktreePointerRun.test.ts`

### Planned files to edit

- `src/infra/git.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/definitions/review.ts`
- `src/cli/definitions/resetPhase.ts`
- `src/cli/definitions/sessions.ts`
- `src/app/resetPhase.ts`
- `src/domain/session/vibeFlags.ts`
- `tests/unit/session/vibeFlags.test.ts`

### Optional files that may be edited

- `src/cli/definitions/run.ts`
- `src/cli/definitions/resume.ts`
- `src/cli/definitions/finding.ts`
- `src/cli/definitions/publishPr.ts`
- `src/cli/definitions/records.ts`
- `src/cli/definitions/archive.ts`
- `src/cli/definitions/prune.ts`
- `src/ports/git.ts`
- `src/domain/errors.ts`
- `tests/integration/protectedPathsCheck.test.ts`
- `tests/unit/cli/run.test.ts`

### Boundary contracts

CLI composition → infra: each composition that can reach a phase worktree supplies the main checkout's root when it builds the git layer. The adapter, never the app layer, decides which calls are phase-worktree calls and hardens them, so no port call can skip the guard. Git port → app: the port's method signatures do not change. A refused pointer surfaces as a `GitError` whose message carries the refusal lines, on the same error channel every port method already has. Domain → infra: `gitdirPointer.ts` takes the entry kind, the pointer text and the expected gitdir, and returns a verdict and a message, with no I/O.

### Test strategy

- a husky pre-commit the agent rewrote does not run at the phase commit nor at the stop close's commit, and both commits land — medium · example · marker file absent and HEAD advanced on each commit · in-phase · ac-husky-commit
- a post-checkout hook tracked under core.hooksPath does not run when phax creates a phase worktree — medium · example · worktree present and marker file absent · in-phase · ac-post-checkout
- a .git rewritten to gitdir: ./x with a planted fsmonitor is refused before git runs, naming .git, its content and the expected gitdir — medium · example · marker file absent and the refusal message lines · in-phase · ac-pointer-fsmonitor
- a phase whose agent rewrote .git ends failed with the refusal message, and reset-phase then resume recreates an intact worktree — medium · example · phase status failed, its error text, marker absent, recreated pointer · in-phase · ac-pointer-fsmonitor
- a core.fsmonitor written into the common .git/config does not run at phax's next worktree call, which succeeds — medium · example · marker file absent and the observation returned · in-phase · ac-common-fsmonitor
- a worktree with an intact pointer runs its turns, gates and commit as before — medium · example · existing run and commit suites unchanged, plus an intact-pointer commit · in-phase · ac-pointer-intact
- a git call in the main checkout still runs the user's own hooks — medium · example · marker file present after commitPaths in the main checkout · in-phase
- every .git entry kind and pointer content gets the right verdict: regular file naming the gitdir, relative path to it, another gitdir, directory, symlink, absent — small · table · pointer verdict table · in-phase
- a secure Vibe session's write_file and edit deny the worktree's .git and everything under it — small · example · expected VIBE_TOOLS denylists · in-phase · ac-vibe-deny

### Implementation order

1. gitdirPointer.ts and its table test.
2. gitWorktreeGuard.ts and the runGitProcess hardening in git.ts; addWorktree always hardened.
3. The rooted layer factory and the compositions that build it.
4. resetPhase recovery for a tampered worktree.
5. Vibe denylist and its test.
6. Adapter-level and run-level real-git tests.
7. Run the standard gate profile.

### Excluded scope

- Explicit GIT_DIR/GIT_WORK_TREE on every call (§7).
- A clean filter, diff.external or core.sshCommand planted in the common config by gate code. This is the named residual, closed by a later OS-sandbox brief.
- Hooks on git calls in the main checkout or a records clone.
- Refusing a phase that changed the hooks directory (q-hooks-change: left to SEC-01).
- Codex's and Claude Code's native protection of `.git`.
- `.phax-context` and the ignore rule (phase-03); docs (phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The exact module paths and exports: `src/domain/security/gitdirPointer.ts` and `src/infra/gitWorktreeGuard.ts`, the `makeNodeGitLayer` signature, and how a phase-worktree call is recognised. Every `src/cli` composition that builds a git layer, with the layer it now builds and why. Any git spawn found outside `src/infra/git.ts`. The refusal message as rendered. How `phax reset-phase` recovers a tampered worktree. The Vibe denylist entries added. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(git): run worktree git calls with no hook, no fsmonitor, and a checked gitdir pointer`

### Commit body

phax's commits in a phase worktree ran hooks the agent could edit (SEC-06), and a rewritten .git pointer gave phax agent-chosen git config, such as a core.fsmonitor command run at the next git status (SEC-07).

Every git call phax runs in a phase worktree, worktree creation included, now carries -c core.hooksPath=/dev/null -c core.fsmonitor=false. Before each call, the adapter checks that the worktree's .git is a regular file naming the gitdir registered in the main checkout. Otherwise it runs no git there and fails the phase with what .git holds and what was expected. phax reset-phase recovers such a phase. Secure Vibe sessions can no longer write the worktree's .git.

Covered by real-git tests: a husky pre-commit, a post-checkout hook, a planted gitdir and a common-config fsmonitor, each proven not to run by a marker file.

---

## phase-03 — .phax-context only as a real directory, ignored through info/exclude {#phase-03-phax-context-real-directory}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The guard crosses several parts of the architecture: a new FileSystem port query and a new Git port method with their fakes and contract suites, a new tagged error, and a dozen app call sites that must all go through it. A missed site keeps the SEC-08 hole open.

phax creates, writes, removes and reads `.phax-context` and its subdirectories only when lstat reports a real directory. It never reads or copies a linked file from it, and copies a pulled brief record only once it decodes. phax keeps `.phax-context` out of git through `.git/info/exclude` instead of the worktree's `.gitignore`, so no phase diff carries phax's ignore line (SEC-08, SEC-23, spec §5.9–§5.12).

### Detailed instructions

- FileSystem port: add a non-following query to `src/ports/fs.ts`, for example `entryKind(path)`, returning `absent`, `directory`, `file`, `symlink` (with its link target, read with readlink) or `other`. Implement it with lstat in `src/infra/fs.ts`, rooted variant included, and in `src/infra/fakes/fs.ts`. Write `tests/integration/fsEntryKindContract.test.ts`, one suite that both the fake and the real adapter run, for absent, directory and file; the symlink and other cases run on the real adapter only if the fake cannot model them.
- Create `src/app/phaxContext.ts`, the one guard every `.phax-context` access goes through. `ensurePhaxContextDir(worktree, subdir?)` checks `.phax-context` and each subdirectory phax uses under it (for example `briefs`) level by level. It creates an absent level as a real directory, uses an existing real directory, and refuses anything else with a new tagged `PhaxContextRefusedError` added to `src/domain/errors.ts` (path, kind, link target). The message follows the spec's surface: `.phax-context is a symbolic link (→ <target>), not a directory` and `phax writes and reads .phax-context only as a real directory; remove the link from the branch, then resume.` A read helper returns a file's text only when it is a regular file. For a symlink it returns a 'linked' outcome, so the caller warns and treats the file as absent.
- Route every writer and reader of `.phax-context` through the guard before it creates, writes, removes or reads: `src/app/worktree.ts` (`writePhasePlanFile`, `createPhaseWorktree`), `pushedBrief.ts` (brief-request.json), `promptGeneration.ts`, `interactiveFiles.ts` (including its recursive remove), `interactiveStop.ts`, `closeStop.ts`, `handoffGeneration.ts` (phase-handoff.md), `briefProvider.ts`, `reviewCode.ts` (review prompts), `resetPhase.ts`, and `pullBrief.ts` (both `recordPull` and `closePulledBriefs`). Grep `PHAX_CONTEXT_DIR`, `.phax-context` and `SEED_WORKTREE_PATH` to make sure none is missed. List every call site in the handoff.
- A refusal during phase preparation must fail the phase, the way a `WorktreeCreationError` does, with the refusal message as its error. Check the path in `src/app/executePlan.ts` and map the new error there if it does not already flow. Nothing may be created, written or removed in a link's target.
- `closePulledBriefs` in `src/app/pullBrief.ts`: if `.phax-context/briefs` is not a real directory, copy nothing, write no `closed` marker through it, and warn naming the path. For each `brief-NN.json`: if it is a symbolic link, do not read or copy it, and warn `[phax] Warning: phase "<id>" — .phax-context/briefs/brief-NN.json is a symbolic link; not recorded.` Otherwise decode it with `readBriefRecordFile` (`src/schemas/persisted.ts`) as a pulled record. If it does not decode, do not copy it and warn naming the file. A record that decodes is written to the phase folder byte-identical to what phax writes for a correct pull today; a test asserts this. `closePulledBriefs` keeps never failing: every problem is a warning.
- Ignore rule: add a Git port method to `src/ports/git.ts`, for example `ensureInfoExclude(repo, line)`. Implement it in `src/infra/git.ts` by resolving the common dir in the main checkout with `git rev-parse --path-format=absolute --git-common-dir`, creating `info/` if needed, and appending `line` only when no line equals it exactly (atomic write). Implement it in `src/infra/fakes/git.ts`, so the fake agrees with the real adapter on what the port shows. Write `tests/integration/gitInfoExcludeContract.test.ts`, run against both, covering an append, a second call that adds nothing, and the path then being ignored in a linked worktree.
- In `src/app/worktree.ts`, replace `ensurePhaxContextIgnored` with a call to `ensureInfoExclude(repoRoot, "/.phax-context")` plus `ensurePhaxContextDir(worktree)`, on both the new-worktree and the existing-worktree paths. phax no longer reads or writes the worktree's `.gitignore`. Update the comment on `commit` in `src/infra/git.ts` that says `.gitignore` excludes `.phax-context/`. Do not remove a `.phax-context/` line already in existing branches.
- Tests against a real filesystem and real git. `tests/integration/phaxContextSymlink.test.ts`: (1) a phase base that committed `.phax-context` as a symlink to a directory outside the worktree; preparing the phase (worktree, plan.md, brief-request.json) is refused with a message naming `.phax-context` and the target, and the target directory's listing is unchanged. (2) A run-level case, with the fake backend and real git, where the phase ends failed with that message. (3) `.phax-context/briefs` as a symlink, and separately `brief-01.json` as a symlink to a file outside the worktree: `closePulledBriefs` copies nothing from the link, writes nothing through it and warns naming the path. (4) An undecodable regular `brief-01.json`: not copied, with a warning. (5) A correct pulled brief: copied byte-identical. `tests/integration/phaxContextIgnore.test.ts`: (1) a real repository with no `.gitignore`; create the phase worktree, stage everything as an agent would, and commit with phax's `commit`. The commit adds no `.gitignore` and no `.phax-context` entry, and `git check-ignore -v .phax-context` names `info/exclude` as the source. (2) An agent that replaces `.phax-context` with a symlink in a fresh worktree: phax's commit does not contain `.phax-context`. Add a small table test of the guard's decisions with the fake filesystem in `tests/unit/phaxContext.test.ts`.
- Update existing tests that asserted the `.gitignore` line or wrote through `.phax-context` in a way the guard now refuses. Do not weaken them for a correct run.

### Planned files to create

- `src/app/phaxContext.ts`
- `tests/unit/phaxContext.test.ts`
- `tests/integration/fsEntryKindContract.test.ts`
- `tests/integration/gitInfoExcludeContract.test.ts`
- `tests/integration/phaxContextSymlink.test.ts`
- `tests/integration/phaxContextIgnore.test.ts`

### Planned files to edit

- `src/ports/fs.ts`
- `src/infra/fs.ts`
- `src/infra/fakes/fs.ts`
- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/domain/errors.ts`
- `src/app/worktree.ts`
- `src/app/pullBrief.ts`
- `src/app/pushedBrief.ts`
- `src/app/promptGeneration.ts`
- `src/app/interactiveFiles.ts`
- `src/app/interactiveStop.ts`
- `src/app/closeStop.ts`
- `src/app/handoffGeneration.ts`
- `src/app/briefProvider.ts`
- `src/app/reviewCode.ts`
- `src/app/resetPhase.ts`

### Optional files that may be edited

- `src/app/executePlan.ts`
- `src/infra/fakes/backend.ts`
- `src/infra/fakes/index.ts`
- `src/schemas/brief.ts`
- `src/schemas/persisted.ts`
- `src/domain/brief/pull.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/reviewCodeHeadless.test.ts`
- `tests/integration/run.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/integration/heldStopRun.test.ts`

### Boundary contracts

App → FileSystem port: the guard needs a non-following answer to 'what is at this path', with a link's target. The FileSystem port provides it, the real adapter and the fake agree through a contract suite, and the app never calls lstat itself. App → Git port: worktree preparation needs `.phax-context` ignored in every worktree without touching tracked files. The Git port provides an idempotent 'ensure this exclude line' on the repository, resolved through the main checkout's common dir. Schema boundary: a pulled brief record is decoded through `readBriefRecordFile` before it enters the phase folder.

### Test strategy

- a .phax-context committed on the phase base as a symlink to an outside directory is refused at phase preparation, naming .phax-context and its target, and nothing is created, written or removed in the target — medium · example · target directory listing unchanged and the refusal message · in-phase · ac-context-symlink
- a run whose phase base carries a .phax-context symlink ends with that phase failed and the refusal as its error — medium · example · phase status failed and its error text · in-phase · ac-context-symlink
- a symlinked briefs directory, or a symlinked brief-01.json, is neither copied nor written through, and a warning names the path — medium · example · phase folder listing, link target unchanged, warning text · in-phase · ac-briefs-symlink
- a regular brief-01.json that does not decode as a pulled brief record is not copied and a warning names it — medium · example · phase folder without brief-01.json and the warning text · in-phase · ac-brief-undecodable
- a correct pulled brief record is copied byte-identical, as today — medium · example · bytes equal to the record phax wrote · in-phase
- in a fresh repository with no .gitignore, the phase commit adds no .gitignore and no .phax-context entry, and the ignore rule comes from info/exclude — medium · example · the commit's changed paths and git check-ignore -v's source · in-phase · ac-ignore-fresh-repo
- a .phax-context symlink the agent creates in a fresh worktree is not in phax's commit — medium · example · commit tree without .phax-context · in-phase · ac-ignored-symlink
- every entry kind at .phax-context and at each subdirectory leads to create, use or refuse as the guard's table says — small · table · guard decision table · in-phase
- the fake and the real filesystem agree on entry kinds — medium · contract · shared suite · in-phase
- the fake and the real git adapter agree on ensureInfoExclude: one line appended once, the path then ignored — medium · contract · shared suite · in-phase

### Implementation order

1. FileSystem port query, both adapters and the contract suite.
2. PhaxContextRefusedError and the phaxContext.ts guard with its table test.
3. Git port ensureInfoExclude, both adapters and the contract suite.
4. worktree.ts: info/exclude instead of .gitignore, guard on every write.
5. Route the remaining writers and readers through the guard; map the refusal to a failed phase.
6. closePulledBriefs: lstat, decode, warn.
7. Real-filesystem and real-git tests, then the standard gate profile.

### Excluded scope

- Removing the `.phax-context/` line already in existing branches' `.gitignore` (§7).
- O_NOFOLLOW or size caps for agent-written files read outside `.phax-context` (§7).
- SEC-03, the brief's config root.
- Git hardening (phase-02); the review skill (phase-04); docs (phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

The FileSystem port method's name and result type. The exports of `src/app/phaxContext.ts`. `PhaxContextRefusedError`'s fields and message. The Git port method that writes `info/exclude` and how it resolves the common dir. Every `.phax-context` call site and how it now goes through the guard. What a refusal leaves (phase state, lastError) and the operator's recovery. The warning texts. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(worktree): use .phax-context only as a real directory, ignored via info/exclude`

### Commit body

The ignore rule `.phax-context/` matched directories only, so a symlink of that name was committed and phax then wrote, removed and read through it. Pulled brief records were copied raw into the records branch, including through a link (SEC-08, SEC-23). In a fresh repository, the phase agent also committed phax's own .gitignore line.

phax now checks `.phax-context` and its subdirectories with lstat before any access, refuses anything but a real directory, and never reads a linked file there. It decodes each pulled brief record before copying it. It keeps `.phax-context` out of git through one `/.phax-context` line in the repository's info/exclude and no longer edits the worktree's .gitignore.

Covered by real-filesystem and real-git tests: a committed symlink refused, symlinked and undecodable brief records not copied, and a fresh repository's phase commit free of any ignore line.

---

## phase-04 — Code review skill from the run base {#phase-04-review-skill-from-base}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

`phax review-code <run>` takes the project review skill from the run base's tree, never from the run's worktree. It falls back to the bundled skill when the base holds no regular file at that path, and says in its output when the run changed `.claude/skills/phax-review/SKILL.md` (SEC-09, spec §5.13–§5.14).

### Detailed instructions

- In `loadCodeReviewWorklist` (`src/app/reviewCode.ts`, around the doctrine at lines 407–417), stop reading `<worktree>/.claude/skills/phax-review/SKILL.md`. Read the run base, the first phase's `base` as already computed for the prompt (`firstPhase?.base`), through the Git port: `readTree(repo, base)` to find the entry at `.claude/skills/phax-review/SKILL.md`, then `readBlob`. Run these in the main checkout when `RunReviewInfo` carries it, otherwise in the run worktree, where phase-02 already hardens git calls.
- Only a regular blob (mode 100644 or 100755) is a project skill: the doctrine is `{ source: "project", text }`. A symlink blob (120000), a tree or no entry means the bundled skill, `{ source: "bundled" }`. The doctrine source type stays `project` | `bundled`. With no recorded base, use the bundled skill.
- Detect a change: compare the path's entry (mode and oid, or absence) at the base with its entry at the run branch tip (`info.branch`). If they differ, the run changed the skill, whether by adding, editing, removing or replacing it with a symlink. Return this beside the doctrine, for example a `skill` fact holding the source, the abbreviated base sha and `changedByRun`. Do not add it to any persisted schema (`code-review-session.json` and `code-review.json` are unchanged).
- Render in `src/cli/definitions/review.ts`, for both the headless and the interactive review: `review skill: project, as of base <short sha> (.claude/skills/phax-review/SKILL.md)`, or `review skill: bundled`. When the run changed the path, add `! this run changed .claude/skills/phax-review/SKILL.md; the review follows the base copy`. For a bundled skill, say the bundled skill is followed. Under `--json`, put these lines where the command already puts its notes and warnings; do not change a JSON contract's shape.
- Write `tests/integration/reviewSkillBase.test.ts` against real git, with a temporary repository isolated via `tests/helpers/isolateGit.ts`, and the fake backend capturing the reviewer's prompt. (1) The base holds a skill reading A and a phase commit rewrites it to B: the prompt contains A and not B, and the output says the run changed the path and the base copy was used. (2) The base has no skill and the run adds one: bundled skill followed, change reported. (3) The same, but the run adds a symbolic link at that path: bundled followed, change reported. (4) The base holds a skill the run did not change: doctrine source `project`, no change line. (5) The base holds a symlink blob at that path: treated as absent, bundled followed.
- Update `tests/integration/reviewCodeHeadless.test.ts`, `tests/integration/reviewCode.test.ts` or `tests/unit/cli/reviewCode.test.ts` where they seeded the skill only in the worktree. Seed it in the base commit instead, without weakening what they check.

### Planned files to create

- `tests/integration/reviewSkillBase.test.ts`

### Planned files to edit

- `src/app/reviewCode.ts`
- `src/cli/definitions/review.ts`

### Optional files that may be edited

- `src/domain/review/codeReviewPrompt.ts`
- `src/ports/git.ts`
- `tests/integration/reviewCodeHeadless.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/unit/cli/reviewCode.test.ts`

### Boundary contracts

App → Git port: the review needs one file's mode and bytes at a fixed commit, and the entry at the run branch tip. It uses the existing `readTree` and `readBlob`, with no new port method. App → CLI: `loadCodeReviewWorklist` returns the doctrine plus a skill fact (source, base sha, changed by run). The review command renders it; the CLI holds no logic beyond formatting.

### Test strategy

- a project skill the run rewrote is not read: the reviewer's instructions carry the base copy, and the output says the run changed the path and the base copy was used — medium · example · prompt contains A and not B, plus the two output lines · in-phase · ac-review-rewritten
- a skill the run added, as a file or as a symbolic link, is not read: the reviewer follows the bundled skill and the output says the run changed the path — medium · example · doctrine source bundled and the change line · in-phase · ac-review-added
- an untouched project skill is followed with source project and no change warning — medium · example · doctrine source project, the skill text, no change line · in-phase · ac-review-unchanged
- a symlink blob at the skill path in the base is treated as absent — medium · example · doctrine source bundled · in-phase

### Implementation order

1. Read the base entry and decide the doctrine in reviewCode.ts.
2. Compute the change against the run branch tip.
3. Render the skill line and the change warning in review.ts.
4. Real-git tests, then adjust the existing review tests' seeding.
5. Run the standard gate profile.

### Excluded scope

- Reading the skill from the main checkout's working copy (q-review-skill: run-base).
- Any change to the doctrine source enum or to persisted review schemas.
- Docs (phase-05).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

How the doctrine is now chosen: base, modes, fallback, no-base case. The shape of the skill fact `loadCodeReviewWorklist` returns. The exact output lines and where they appear under `--json`. Which existing review tests changed their seeding. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(review): read the project review skill from the run base`

### Commit body

The code review took its instructions from the reviewed worktree's .claude/skills/phax-review/SKILL.md, which a phase agent could rewrite (SEC-09).

The review now reads the skill as a regular blob from the run base's tree, falls back to the bundled skill when the base holds none (a symlink blob counts as none), and says when the run changed the path. The doctrine source stays project or bundled.

Covered by real-git tests: a rewritten skill, an added skill or link, an untouched skill, and a symlink at the base.

---

## phase-05 — Docs: what phax does not take from the worktree {#phase-05-security-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Tell operators what a skeleton record now carries, which agent-written files phax refuses to trust, and which residual stays open, so they can judge a run on a public repository or with a less-sandboxed provider (spec §11).

### Detailed instructions

- In `docs/security.md`, add a section `## What phax does not take from the worktree`, following the spec's §11 example. Hooks: phax's git calls in a phase worktree (creating it, the phase commit, a stop's commit) run with hooks off and `core.fsmonitor=false`. The `.git` file: checked against the gitdir in the main checkout before each git call; on a mismatch, the phase fails, phax runs no git command there, and `phax reset-phase` recovers. `.phax-context`: used only as a real directory, a symbolic link is refused, pulled brief records are decoded before they are recorded, and it is ignored through `.git/info/exclude`, not your `.gitignore`. The review skill: followed as it was at the run's base, with a warning when the run changed it. Also state that Vibe sessions cannot write the worktree's `.git`.
- In the same page, state what a record with `records.transcript: false` carries now. It holds no session stream, gate or setup log, or agent error log. It keeps prompt.md, the diff, the handoff, the gate reports and attribution, and the brief records. A full record is unchanged. `security.json` and `status.json` keep their absolute paths.
- Name the residual of SEC-07 next to the existing gate-step residual ('What the check does not resist', around line 257). Gate steps and allowed commands run agent-written code unconfined on Claude Code and Vibe. That code can plant a clean filter, `diff.external` or `core.sshCommand` in the repository's common `.git/config` or a worktree's `config.worktree`. This slice does not close that; a later change that runs gate steps and allowed commands under an OS sandbox keeping `.git` read-only will.
- In `docs/code-repository.md`, replace line 176's claim that a record without a transcript still carries the gate logs. Say what it carries now (prompt.md, the handoff, the diff, the gate reports), keeping the paragraph's point about `prompt.md` on a public repository.
- Check the rest of `docs/` (not specs, plans, briefs or archives) for other claims that a skeleton carries gate logs, or that phax appends `.phax-context/` to `.gitignore`, and correct them. Do not edit generated pages such as `docs/cli/reference.md`. Do not edit `NEXT_STEPS.md` unless an entry names this slice's work as still to do.

### Planned files to create

- (none)

### Planned files to edit

- `docs/security.md`
- `docs/code-repository.md`

### Optional files that may be edited

- `docs/upgrading.md`
- `NEXT_STEPS.md`
- `README.md`

### Test strategy

- (none)

### Implementation order

1. docs/security.md: the new section, the skeleton paragraph, the SEC-07 residual.
2. docs/code-repository.md: the record sentence.
3. Sweep docs/ for stale claims.
4. Run the standard gate profile, whose terminal steps build the site.

### Excluded scope

- Any code change.
- A security advisory for public repositories that already pushed skeleton records (the operator's call, §7).
- Generated docs (`docs/cli/reference.md`).

### Verification

The `standard` gate profile in `phax.json`, including its terminal `pnpm site:build`.

### Expected handoff content

The sections added or changed in each page, the residual's wording, and any other stale claim corrected elsewhere in docs/. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(security): what phax does not take from the worktree`

### Commit body

Document the security-high-fixes slice for operators. A skeleton record carries no session stream, gate or setup log, or agent error log. phax's worktree git calls run no hook or fsmonitor and check the .git pointer. .phax-context is used only as a real directory and ignored through info/exclude. The code review follows the review skill from the run base.

Name the residual of SEC-07, config planted in the common .git/config by gate code, closed later by an OS sandbox for gate steps. Correct docs/code-repository.md, which said a record without a transcript still carries the gate logs.
