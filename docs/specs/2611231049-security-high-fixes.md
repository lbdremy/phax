---
status: Draft
date: 2026-11-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Security High fixes: skeleton records, worktree git, .phax-context, review skill

## 1. Context

Two audits of main at e5c39afa (report B, and the Mistral cross-validation that checks it against the code) found one class of weakness that matters most. An agent writes a file, and then phax, or a later session, trusts it. Four of the High findings in that class are each fixed in one place. This spec covers them. The rest of the security roadmap's phase 1 (SEC-01, the implicit protected set; SEC-03, the brief's config root) and phases 2 to 6 are separate work.

Records. A phase record is built from the phase folder. Its shape is `skeleton` when `records.transcript` is false, and `full` when it is true and the provider produced a transcript. Only `output.jsonl` counts as a transcript today. Every other file in the phase folder is carried in both shapes, except archived failed-session transcripts, stop artifacts and `.vibe-export` directories. Because a skeleton "carries no transcript", phax allows an in-repo records destination for it even on a public repository. Revision and decision records already choose their files from an allowlist.

Git in a worktree. Every git call phax makes runs through one process helper, with git's default hooks and config resolution. The phase commit, the stop close's commit and `git worktree add` run every hook git resolves. With a tracked `core.hooksPath` (husky's setup), those hooks are ordinary worktree files. A linked worktree's `.git` is a one-line file, `gitdir: <path>`, and git trusts whatever it names, including that directory's `config`.

`.phax-context`. phax creates `.phax-context/` in each phase worktree and appends `.phax-context/` to the worktree's `.gitignore`. It writes `plan.md`, `brief-request.json`, `briefs/closed`, interactive seeds and review prompts there. It reads `phase-handoff.md`, `correction-handoff.md` and `briefs/brief-NN.json` from there, and copies the brief records byte for byte into the phase folder. None of these paths is checked with lstat.

Code review. `phax review-code <run>` uses `<run worktree>/.claude/skills/phax-review/SKILL.md` as the reviewer's instructions when that file exists (doctrine source `project`). Otherwise it uses the bundled skill (source `bundled`).

Ground read:

- `docs/security/reports/2026-11-23-opus-high-5.5-security-report.md` — Report B: SEC-02, SEC-06, SEC-07, SEC-08, SEC-09 and SEC-23, with each exploit and the fixes it suggests.
- `docs/security/reports/2026-11-23-mistral-large-4-0-high-cross-validation.md` — Confirms SEC-02, SEC-06, SEC-08 and SEC-09 in the code. Rates SEC-07 consistent (plausible per provider).
- `src/domain/records/assemble.ts` — selectRecordArtifacts keeps every phase-folder file except output.jsonl, archived transcripts, stop artifacts and .vibe-export directories. PHASE_TRANSCRIPT_FILES holds only output.jsonl.
- `src/domain/records/destination.ts` — decideRecordsDestination allows an in-repo destination whatever the visibility once transcript is false (lines 61-65).
- `src/app/writeRevisionRecord.ts` — Revision records already filter the folder through REVISION_RECORD_FILES, an allowlist, before selectRecordArtifacts.
- `src/domain/records/stopArtifacts.ts` — Stop files and turn streams are never carried by a phase record.
- `src/domain/gate/attemptFiles.ts` — Per-attempt names: checks-attempt-NN.log and the fix transcript fix-attempt-NN.jsonl.
- `src/app/recordsExplain.ts` — gateArtifactsInOrder shows a record's checks-attempt-NN.log files. Dropping them from a skeleton shortens what explain shows for it.
- `src/infra/git.ts` — Every git call goes through runGitProcess/gitRun. The phase commit (line 940), the stop-close commit (line 512) and worktree add (line 926) run with hooks on. Nothing sets core.hooksPath or checks the .git pointer.
- `src/app/worktree.ts` — ensurePhaxContextIgnored appends `.phax-context/` (directories only) to the worktree's .gitignore and mkdirps .phax-context without lstat.
- `src/app/pullBrief.ts` — closePulledBriefs reads each briefs/brief-NN.json as text and copies it raw into the phase folder. It never fails: an error becomes a warning.
- `src/app/reviewCode.ts` — Lines 407-417 read <run worktree>/.claude/skills/phax-review/SKILL.md when it exists (source project), else the bundled skill. The run's base is known as firstPhase.base (line 503).
- `src/cli/definitions/review.ts` — The code review command is `phax review-code <run>` with `--headless`.
- `docs/code-repository.md` — Line 176 tells users a record without a transcript still carries the gate logs. This slice changes that.
- `NEXT_STEPS.md` — Wave 1 entry for security-high-fixes (lines 46-63), and the Small follow-up 'A phase agent commits phax's own .gitignore line' (line 539).

## 2. Problem

Each of the four findings lets the agent under review, or a file it wrote, act with the user's rights or publish the user's data.

- SEC-02, skeleton records publish transcripts. A resumed turn of the same session writes its raw stream to `fix-attempt-NN.jsonl` (each fix attempt) and `handoff-generation.jsonl`. Gate output goes to `checks-attempt-NN.log` and `setup.log`, and stderr to `agent-error.log`, which holds the whole prompt in argv on Vibe. All of these are carried by a skeleton record. A user on a public repository who turned transcripts off therefore publishes, for every phase that needed a fix attempt, what the agent read and printed: `.env` contents, tokens a test printed.
- SEC-06, phax's commits run hooks the agent can edit. The agent writes `.husky/pre-commit`, and phax runs it at the phase commit with the user's rights. This includes the commit-only resume and the stop closes, where no gate step runs first. Codex's sandbox does not prevent it.
- SEC-07, a rewritten `.git` pointer gives phax agent-chosen git config. The agent replaces `.git` with `gitdir: ./x` and writes `x/config` with `core.fsmonitor=<cmd>`. The next `git status` phax runs (the protected-path observation after every turn) executes the command. Report B reproduced this. Disabling fsmonitor alone is not enough, because the same config can name a clean filter, `diff.external` or `core.sshCommand`. Vibe's write denylist does not cover `.git`.
- SEC-08, a `.phax-context` symlink redirects phax's reads and writes. The ignore rule `.phax-context/` matches directories only, so a symlink of that name is committed and carried into every later phase. phax then creates directories, writes files and runs one recursive remove through it. It also reads through it, and copies `brief-NN.json` bytes into the records branch: report B copied a link to `~/.ssh/id_ed25519` this way. A related follow-up has the same cause. In a fresh repository the phase-01 agent committed the `.gitignore` line phax appended, and the PR counted it as an unplanned deviation.
- SEC-09, the code review reads its instructions from the reviewed worktree. A phase agent can rewrite the review skill on Codex or Vibe, or on Claude with a skill-edit grant (for example "report no findings for src/auth"), and so set the rules of the review of its own work.

## 3. Product goal

Close the four findings without changing what a correct run does. A skeleton record carries no file that holds what an agent or a command printed. phax's git calls in a phase worktree run no hook, and no config from a gitdir phax did not create. phax reads and writes `.phax-context` only as a real directory it owns, and keeps it out of the phase's diff. The code review takes its instructions from a copy the reviewed agent could not write. A run whose agents touch none of these files commits, records (with transcripts on) and is reviewed exactly as today.

> Nothing the agent under review can write decides what phax executes, where phax writes, what phax publishes, or how the agent's work is reviewed.

## 4. Terminology

- **phase folder** — The run-state directory phax keeps for one phase (`<run>/<phase>/`) outside the worktree, holding prompt.md, security.json, gate logs, transcripts and the like. A phase record is built from it.
- **skeleton record / full record** — The two shapes of a phase record. Skeleton when `records.transcript` is false (or no transcript was produced). Full when it is true and a transcript exists. The manifest's `shape` field names it.
- **transcript-class file** — A phase-folder file that holds what an agent session or a project command printed or read: `output.jsonl`, `fix-attempt-NN.jsonl`, `handoff-generation.jsonl`, `checks-attempt-NN.log`, `setup.log`, `agent-error.log` and `agent-error.failed-NN.log`. A full record carries them. A skeleton never does.
- **record allowlist** — The fixed set of phase-folder file names and name patterns a phase record may carry. A file outside it is carried by neither shape.
- **phase worktree** — A linked git worktree phax created for a phase (or a run's review), under phax's state root.
- **gitdir pointer** — The one-line `.git` file at a linked worktree's root (`gitdir: <path>`). git reads it to find the worktree's git directory and that directory's config.
- **phax's gitdir** — The git directory git created for the worktree when phax ran `git worktree add`, as the main checkout's worktree list names it (`<repo>/.git/worktrees/<name>`).
- **`.phax-context`** — The directory at a phase worktree's root where phax and the agent exchange metadata (plan, handoff, brief requests and records, interactive seeds). It is never part of the phase's commit.
- **real directory** — A directory entry that lstat reports as a directory, not a symbolic link, regular file or anything else.
- **run base** — The commit the run's first phase branched from (the first phase's `base`).
- **project review skill** — A repository's own `.claude/skills/phax-review/SKILL.md`, which takes the place of the bundled code-review skill.

## 5. Functional requirements

### 5.1 Phase records are built from an allowlist

The system shall build every phase record only from the phase-folder files on the record allowlist, and shall carry a phase-folder file that is not on it in neither the skeleton nor the full shape.

### 5.2 A skeleton carries no transcript-class file

WHERE `records.transcript` is false THE system SHALL leave every transcript-class file out of the phase record.

### 5.3 A full record is unchanged

WHERE `records.transcript` is true and the phase produced a transcript THE system SHALL carry exactly the phase-folder files a full record carries today, transcript-class files included.

### 5.4 phax's git calls in a worktree run no hook

WHEN phax runs a git command in a phase worktree, including the `git worktree add` that creates it, the phase commit and the stop close's commit, THE system SHALL run it with every repository hook disabled.

### 5.5 The gitdir pointer is checked before each git call

WHEN phax is about to run a git command in a phase worktree THE system SHALL first check that the worktree's `.git` is a regular file naming phax's gitdir for that worktree, taking the expected value from the main checkout and never from the worktree.

### 5.6 A changed gitdir pointer stops the phase

IF a phase worktree's `.git` is not a regular file naming phax's gitdir THEN the system SHALL run no git command in that worktree and fail the phase with a message that names the worktree's `.git`, what it holds and what was expected.

### 5.7 Vibe cannot write the worktree's .git

WHERE a secure phase runs on Mistral Vibe THE system SHALL deny `write_file` and `edit` on the worktree's `.git` and everything under it.

### 5.8 .phax-context is used only as a real directory

IF `.phax-context`, or a directory phax uses under it, exists and is not a real directory THEN the system SHALL write, create, remove and read nothing through it and shall refuse the operation with a message naming the path and what it is.

### 5.9 phax reads no linked file from .phax-context

IF a file phax reads or copies from `.phax-context` is a symbolic link THEN the system SHALL neither read nor copy it, and shall warn naming the file.

### 5.10 The ignore rule is not part of the phase's diff

The system shall keep `.phax-context`, as a directory or any other entry, out of git through a rule that is not part of the phase's diff, and shall no longer edit the worktree's `.gitignore`.

### 5.11 Pulled brief records are decoded before they are copied

IF a `.phax-context/briefs/brief-NN.json` does not decode as a pulled brief record THEN the system SHALL not copy it into the phase folder, and shall warn naming the file.

### 5.12 Review instructions come from the run base

The system shall take the code review's instructions from the project review skill as a regular file in the run base's tree, or from the bundled skill when the run base holds no regular file at that path, and never from the run's worktree.

### 5.13 A changed review skill is reported

WHEN the run's branch changed `.claude/skills/phax-review/SKILL.md` since the run base THE system SHALL say so in the code review's output, naming the path and that the base copy was used.

### 5.14 A correct run is unchanged

The system shall commit, record and review a run whose agents write none of the worktree's `.git`, its hooks, `.phax-context` entries other than the documented files, or the review skill exactly as it does today.

## 6. Surface

### file: phase record on phax/records/v1, skeleton shape — normative

Summary: A record written with `records.transcript: false` no longer carries fix-attempt streams, handoff streams, gate and setup logs, or agent error logs.

before:

    Files of phase-02's skeleton record (records.transcript: false):
    agent-binding.json
    agent-error.log
    checks-attempt-01.log
    checks-attempt-01.request.json
    claude-session-id.txt
    diff.patch
    file-reconciliation.json
    fix-attempt-01.jsonl
    gate-attribution.json
    handoff-generation.jsonl
    model-resolution.json
    phase-handoff.md
    prompt.md
    security.json
    setup.log
    status.json

after:

    Files of phase-02's skeleton record (records.transcript: false):
    agent-binding.json
    checks-attempt-01.request.json
    claude-session-id.txt
    diff.patch
    file-reconciliation.json
    gate-attribution.json
    model-resolution.json
    phase-handoff.md
    prompt.md
    security.json
    status.json

### file: .git/info/exclude of the repository — indicative

Summary: phax keeps `.phax-context` out of git without touching the worktree's `.gitignore`, so a phase's diff never shows phax's ignore line.

before:

    # <worktree>/.gitignore, as phax leaves it today
    node_modules/
    .phax-context/

after:

    # <repository>/.git/info/exclude, shared by every worktree
    /.phax-context

    # <worktree>/.gitignore, untouched by phax
    node_modules/

### internal: phax's git calls in a phase worktree — indicative

Summary: A hook in the repository's hooks directory, tracked or not, never runs when phax creates a worktree, commits a phase or closes a stop.

before:

    git worktree add -- <path> <branch>          # runs post-checkout
    git commit -m "<subject>" -m "<body>"       # runs .husky/pre-commit, commit-msg, post-commit

after:

    git -c core.hooksPath=/dev/null worktree add -- <path> <branch>      # runs no hook
    git -c core.hooksPath=/dev/null commit -m "<subject>" -m "<body>"   # runs no hook

### cli: phax run / phax resume, gitdir pointer refusal — indicative

Summary: When an agent rewrites its worktree's `.git` file, phax stops the phase before running any git command there and shows what changed.

    $ phax resume billing
    …
    ✗ phase-02 failed: the worktree's .git no longer points at the git directory phax created
      .git holds:  gitdir: ./x
      expected:    gitdir: /Users/me/billing/.git/worktrees/phase-02
      phax ran no git command in this worktree after the change.

### cli: phax run / phax resume, .phax-context refusal — indicative

Summary: When `.phax-context` (or `.phax-context/briefs`) is a symbolic link or not a directory, phax refuses to use it and names what it found.

    $ phax run docs/plans/2611240900-billing-plan.md
    …
    ✗ phase-03 refused: .phax-context is a symbolic link (→ /Users/me/.ssh), not a directory
      phax writes and reads .phax-context only as a real directory; remove the link from the branch, then resume.

    [phax] Warning: phase "phase-03" — .phax-context/briefs/brief-01.json is a symbolic link; not recorded.

### cli: phax review-code <run> — indicative

Summary: The code review says which review skill it follows, and warns when the run changed the project's review skill, whose base copy it follows instead.

    $ phax review-code billing --headless
    review skill: project, as of base 1a2b3c4 (.claude/skills/phax-review/SKILL.md)
    ! this run changed .claude/skills/phax-review/SKILL.md; the review follows the base copy

## 7. Non-goals

- SEC-01 (the implicit protected set, including refusing a change to the hooks directory or other config files since the phase base) and SEC-03 (the brief's config root).
- Running every worktree git call with explicit GIT_DIR/GIT_WORK_TREE; the pointer check closes SEC-07 for this slice.
- Disabling `core.fsmonitor` or any other git setting the user configured: the user's own config keeps applying to phax's calls.
- Hooks on git calls phax runs in the main checkout or a records clone (records commits, publish push): those trees are not agent-writable through the phase.
- A security advisory for public repositories that already pushed skeleton records: the operator's call, outside the spec.
- Rewriting or removing records already on phax/records/v1.
- Removing the `.phax-context/` line phax appended to `.gitignore` in existing branches or worktrees.
- Verifying or changing Codex's or Claude Code's native protection of a `.git` file; only Vibe's denylist changes.
- Revision, decision, authoring and review records, which already pick their files from an allowlist; the destination rule (skeleton allowed in-repo on a public repository) is unchanged.
- A size cap or O_NOFOLLOW discipline for every agent-written file phax reads outside `.phax-context`.
- Changing what `phax records explain` does; it simply has fewer gate logs to show for a skeleton record.

## 8. Acceptance criteria

### A skeleton names exactly its allowlist

Given a real phase folder holding one file of every kind a phase writes (including output.jsonl, fix-attempt-01.jsonl, handoff-generation.jsonl, checks-attempt-01.log, setup.log, agent-error.log, agent-error.failed-01.log, security.json, status.json, prompt.md, diff.patch, brief-01.json) and `records.transcript: false`, when phax assembles the phase's record, then the manifest's shape is `skeleton` and the record carries exactly the non-transcript files of the allowlist, as in the skeleton listing of the surface, and no transcript-class file. (refs §5.1, §5.2)

### A full record carries what it carries today

Given the same phase folder and `records.transcript: true`, when phax assembles the phase's record, then the manifest's shape is `full` and the record carries the same file list as the record phax writes before this change. (refs §5.3, §5.14)

### An unlisted file is never recorded

Given a phase folder holding, besides its usual files, a file `notes.txt` that is not on the allowlist, when phax assembles the record with `records.transcript` false, then true, then neither record carries `notes.txt`. (refs §5.1)

### A husky pre-commit does not run at phax's commits

Given a real repository with a tracked `core.hooksPath=.husky` and a `.husky/pre-commit` the phase agent rewrote to create a marker file outside the worktree, when phax makes the phase commit, and separately the stop close's commit, then each commit exists and the marker file does not. (refs §5.4)

### No hook runs at worktree creation

Given a real repository whose phase base tracks a `post-checkout` hook under its `core.hooksPath` that creates a marker file, when phax creates the next phase's worktree, then the worktree exists and the marker file does not. (refs §5.4)

### A planted gitdir does not run its fsmonitor

Given a real phase worktree whose `.git` was rewritten to `gitdir: ./x`, with `x/HEAD` and an `x/config` setting `core.fsmonitor` to a command that creates a marker file, when phax reaches its next git call in that worktree (the protected-path observation after the turn), then the marker file does not exist, the phase fails, and the message names the worktree's `.git`, its content and the expected gitdir. (refs §5.5, §5.6)

### An intact pointer changes nothing

Given a phase worktree whose `.git` still names phax's gitdir, when the phase runs through its turns, gates and commit, then it runs every git call as before and commits as before. (refs §5.5, §5.14)

### Vibe denies writes to .git

Given a secure phase on Mistral Vibe, when phax builds the session's security flags, then `write_file` and `edit` deny the worktree's `.git` and everything under it. (refs §5.7)

### A .phax-context symlink is refused

Given a phase base that committed `.phax-context` as a symbolic link to a directory outside the worktree, when phax prepares the phase (writing plan.md and brief-request.json), then nothing is created, written or removed in the link's target, and the phase is refused with a message naming `.phax-context` and its target. (refs §5.8)

### A symlinked briefs directory or brief file is not copied

Given a phase worktree whose `.phax-context/briefs` is a symbolic link, and in a second case whose `.phax-context/briefs/brief-01.json` is a symbolic link to a file outside the worktree, when the phase reaches its terminal outcome and phax collects pulled briefs, then no file is copied into the phase folder from the link, nothing is written through it, and a warning names the path. (refs §5.8, §5.9)

### An undecodable brief record is not copied

Given a regular file `.phax-context/briefs/brief-01.json` that does not decode as a pulled brief record, when phax collects pulled briefs, then the phase folder holds no `brief-01.json` and a warning names the file. (refs §5.11)

### A fresh repository's phase diff carries no ignore line

Given a real repository with no `.gitignore`, when phase-01 runs, its agent stages everything, and phax commits, then the phase commit adds no `.gitignore` and no `.phax-context` entry, and `.phax-context` is ignored by a rule outside the worktree's tracked files. (refs §5.10)

### A .phax-context symlink is not committed

Given a phase agent that creates `.phax-context` as a symbolic link in a fresh worktree, when phax commits the phase, then the commit does not contain `.phax-context`. (refs §5.10)

### A rewritten review skill is not read

Given a run whose base holds a project review skill reading A, and whose phase rewrote it to read B, when `phax review-code <run> --headless` runs, then the reviewer's instructions contain A and not B, and the output says the run changed `.claude/skills/phax-review/SKILL.md` and the base copy was used. (refs §5.12, §5.13)

### A review skill added by the run is not read

Given a run whose base has no project review skill, and whose phase added one, or added a symbolic link at that path, when `phax review-code <run> --headless` runs, then the reviewer follows the bundled skill and the output says the run changed the path. (refs §5.12, §5.13)

### An untouched project skill is used as today

Given a run whose base holds a project review skill the run did not change, when `phax review-code <run> --headless` runs, then the reviewer follows that skill with doctrine source `project`, and the output carries no change warning. (refs §5.12, §5.14)

## 9. Open questions

### q-skeleton-logs — Are the gate and setup logs and the agent error logs transcript-class, left out of a skeleton?

- logs-out — Count checks-attempt-NN.log, setup.log, agent-error.log and agent-error.failed-NN.log as transcript-class — abandons: a skeleton record's gate output: `phax records explain` and readers of a skeleton see the step results and reports, not the logs
- logs-in — Keep the logs in a skeleton; only the session streams are transcript-class — abandons: the promise that a skeleton publishes nothing a command printed: a test that prints a token, or Vibe's whole prompt in agent-error.log, still reaches a public repository

Recommendation: logs-out — The user who turns transcripts off on a public repository wants nothing printed to leave the machine. Gate logs print what the project's tests print, and the gate attribution and reports keep the verdicts. Full records keep the logs.

### q-abs-paths — Do security.json and status.json keep their absolute paths in a skeleton record?

- keep-paths — Keep both files as they are — abandons: hiding the home directory and username from a public skeleton record
- relativize — Record copies with the worktree and home prefixes rewritten — abandons: recorded bytes equal to the phase folder's, and a content change to two persisted documents this slice set out not to touch

Recommendation: keep-paths — A path names the user, as the commit author already does. It discloses nothing the agent read. Rewriting it belongs with the Low-severity findings, not this High slice.

### q-hooks-off — How does phax turn hooks off?

- hookspath-all — `-c core.hooksPath=/dev/null` on every git call in a phase worktree, worktree add included — abandons: a project's own commit hooks (formatting, lint-staged) at phax's commits; they keep running for the user's own git
- no-verify-commits — `--no-verify` on phax's commits only — abandons: protection from post-checkout at worktree add and from post-commit, which `--no-verify` does not skip

Recommendation: hookspath-all — `--no-verify` leaves hooks that run with the same rights. The project's checks belong in gates, which already run before the commit.

### q-hooks-change — Should phax also refuse a phase that changed the hooks directory since its base?

- leave-to-sec01 — No: leave it to SEC-01's implicit protected set — abandons: a warning before the user's own later `git commit` on the merged branch runs a hook the agent wrote
- refuse-now — Yes: refuse such a phase in this slice — abandons: the slice's bounds: it designs part of SEC-01's protected set early, apart from the rest

Recommendation: leave-to-sec01 — Once phax runs no hook, a changed hook threatens only the user's own git. That is exactly SEC-01's protected-file question, which should be answered in one place.

### q-git-pointer — How far does the SEC-07 fix go?

- pointer-check — Check the `.git` file against phax's gitdir before each worktree git call, and refuse otherwise — abandons: defence against a change made between the check and the call, and against calls that never go through the helper
- explicit-gitdir — Set GIT_DIR/GIT_WORK_TREE on every worktree git call — abandons: a small slice: it reaches every call in the helper and its callers, and changes how git discovers the repository everywhere

Recommendation: pointer-check — The agent cannot write between phax's check and phax's call in the same process step. The check also tells the operator that something was tampered with, where explicit GIT_DIR would hide it. Explicit GIT_DIR stays a later hardening.

### q-ignore-rule — Where does the `.phax-context` ignore rule live?

- info-exclude — `/.phax-context` in the repository's `.git/info/exclude` — abandons: keeping phax's edits inside the worktree: phax writes one line into the user's repository-local exclude file, shared by every worktree and the main checkout
- gitignore-no-slash — `/.phax-context` in the worktree's `.gitignore` — abandons: a phase diff free of phax's line: agents keep committing it and the PR keeps counting a deviation

Recommendation: info-exclude — It closes SEC-08's committed-symlink path and the Small follow-up together. The line is inert in the main checkout, which has no `.phax-context`.

### q-brief-decode — Is `brief-NN.json` decoded before it is copied (SEC-23)?

- decode — Decode through the pulled-brief schema; copy only what decodes — abandons: recording an agent-written or older-format brief file that does not decode, which the phase folder then lacks
- raw-copy — Keep the raw copy, relying on the symlink refusal — abandons: defence against a regular file the agent filled with anything, which the records branch then publishes

Recommendation: decode — It is one schema call in a function this slice already edits, and it keeps arbitrary agent bytes out of the records branch.

### q-review-skill — Where does the code review's project skill come from?

- run-base — The run base's committed copy (`git show <base>:.claude/skills/phax-review/SKILL.md`) — abandons: a review skill edited on main after the run started: the review follows the older copy
- main-checkout — The main checkout's working copy — abandons: determinism and a trusted source: the main checkout may hold uncommitted edits or a later branch, and the result depends on when the review runs

Recommendation: run-base — The run base is fixed and was never writable by the run's agents. A project that changes its skill reviews the next run with it.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- One plan, about one phase per finding (SEC-02; SEC-06 with SEC-07; SEC-08 with SEC-23 and the ignore rule; SEC-09), each in its own files.
- The record manifest keeps its shape (`skeleton` | `full`). If the allowlist forces a manifest change after all, it gets a new stamp and an upgrading note, with no shim.
- The records destination rule does not change: a skeleton stays allowed in-repo on a public repository, now that it carries no transcript-class file.
- The expected gitdir comes from the main checkout (its worktree list, or what phax recorded at `git worktree add`), never from the worktree.
- Doctrine source stays `project` | `bundled`.

Left open:

- How the allowlist is expressed (names plus the per-attempt patterns), and how a stop's files and `.vibe-export` directories keep their current treatment.
- Where the run base is read for the review (reviewCode already knows the first phase's base), and how a symlink blob (mode 120000) at the skill path is treated as absent.
- Whether the gitdir check runs inside the git helper or before each port call, provided no worktree git call skips it.
- The exact refusal and warning wording, and the run or phase state a refusal leaves.

Constraints:

- Footprint disjoint from `gate-step-times`: no edit to `gates.ts`, `gateAttribution.ts`, `fixLoop.ts`, `closeStop.ts` or `recordsExplain`. Run `phax plans overlap` before starting, and expect overlap only on regenerated files.
- The record allowlist must list every phase-folder file `gate-step-times` adds, or a full record would lose it. Read that plan's file list first.
- Each fix gets a test against real git or a real filesystem, not only the fakes: a husky-style pre-commit that must not run, a planted `core.fsmonitor` that must not run, a `.phax-context` symlink that is refused, a rewritten review skill that is not read. The full-record test lists a complete phase folder and names what each shape keeps.
- What a correct run does, and what it records with transcripts on, stays the same; the existing suites pass unchanged.
- Update the sentence in docs/code-repository.md that says a record without a transcript still carries the gate logs.

## 11. Docs page

Page: docs/security.md

Reader: An operator deciding whether a run is safe on a public repository or with a less-sandboxed provider, who needs to know what a skeleton record publishes and which agent-written files phax refuses to trust.

Example: ## What phax does not take from the worktree

- **Hooks.** phax's own git calls in a phase worktree (creating it, the phase commit, a stop's commit) run with hooks off, so a hook the agent wrote never runs with your rights.
- **The `.git` file.** Before each git call, phax checks that the worktree's `.git` still names the git directory it created; if not, the phase fails and phax runs no git command there.
- **`.phax-context`.** phax uses it only as a real directory; a symbolic link there is refused, and it is ignored through `.git/info/exclude`, not your `.gitignore`.
- **The review skill.** `phax review-code` follows `.claude/skills/phax-review/SKILL.md` as it was at the run's base, and tells you when the run changed it.

With `records.transcript: false`, a phase record carries no session stream, gate or setup log, or agent error log; it keeps prompt.md, the diff, the handoff and the gate reports.
