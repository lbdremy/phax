Write the phax spec `security-high-fixes`: the four High findings of the 2026-11-23 security audits that are
each a small change in a file of its own. A skeleton record carries no transcript-class file. phax's own git calls
in a phase worktree run no hook and no config the agent wrote. phax refuses a `.phax-context` that is not a real
directory. The code review reads its instructions from somewhere the reviewed agent cannot write.

This is the quick slice of the security roadmap's phase 1 (NEXT_STEPS, wave 1). The rest of phase 1 (SEC-01, the
implicit protected set; SEC-03, the brief's config root) and phases 2 to 6 are separate work.

## Why

The two audits of main at `e5c39afa` (`docs/security/reports/2026-11-23-opus-high-5.5-security-report.md`, report B;
`docs/security/reports/2026-11-23-mistral-large-4-0-high-cross-validation.md`, which confirms each finding in the
code) found one class that matters most: files an agent writes that phax, or a later session, then trusts. Four of
these findings are High, confirmed, and each fixed in one place:

- **SEC-02: skeleton records publish transcripts.** With `records.transcript: false` the record is `skeleton`, and
  `decideRecordsDestination` allows an in-repo destination on a public repository for that reason
  (`src/domain/records/destination.ts:62-66`). But `selectRecordArtifacts` counts only `output.jsonl` as a
  transcript (`src/domain/records/assemble.ts`, `PHASE_TRANSCRIPT_FILES`). The same session's resumed turns write
  their raw stream into `fix-attempt-NN.jsonl` (`src/app/fixLoop.ts`) and `handoff-generation.jsonl`
  (`src/app/handoffGeneration.ts`). The skeleton record also carries `checks-attempt-NN.log`, `agent-error.log` (on
  Vibe, the whole prompt in argv), and `security.json`/`status.json` with absolute paths. So a user on a public
  repository who turned transcripts off publishes, for every phase that needed a fix attempt, what the agent read
  and printed. phax's own records are not exposed: they go to a private repository with transcripts on.
- **SEC-06: phax's `git commit` runs hooks the agent can edit.** The phase commit (`src/infra/git.ts`, around line
  940) and the stop close's commit (around line 512) run with hooks on. With a tracked `core.hooksPath`, as husky
  sets up, the hooks are ordinary worktree files every provider may write, Codex's sandbox included. They run with
  the user's rights, including at the commit-only resume and stop closes, where no gate step runs first.
- **SEC-07: a rewritten `.git` pointer gives phax agent-chosen git config.** An agent replaces the worktree's
  `.git` file with `gitdir: ./x` and writes `x/config` with `core.fsmonitor=<cmd>`. The next `git status` phax runs
  (the protected-paths observation after every turn) runs the command; report B reproduced it. Vibe's write denylist
  does not cover `.git` (`src/domain/session/vibeFlags.ts`); Codex's coverage of a `.git` *file* is unverified.
- **SEC-08: a `.phax-context` symlink makes phax write and read outside the worktree.** The ignore rule
  `.phax-context/` (`ensurePhaxContextIgnored`, `src/app/worktree.ts`) matches directories only, so a symlink of
  that name is committed and lives on in every later phase. phax then `mkdirp`s and writes `plan.md`, brief
  requests, interactive seeds and review prompts into its target (`worktree.ts`, `pushedBrief.ts`,
  `interactiveFiles.ts`, one path of which is a recursive `rm`, `reviewCode.ts`, `pullBrief.ts`). It also reads the
  handoff and `briefs/brief-NN.json` through it, and `closePulledBriefs` copies those raw bytes into the phase
  folder and on to the records branch. Report B copied a link to `~/.ssh/id_ed25519` this way.
- **SEC-09: the code review's instructions come from the reviewed worktree.** `src/app/reviewCode.ts` (around line
  407) prefers `<run worktree>/.claude/skills/phax-review/SKILL.md` over the bundled skill, following symlinks. A
  phase agent that rewrites it (on Codex or Vibe, or on Claude with a skill-edit grant) sets the rules of the
  review of its own work.

None of them needs the others, and none changes what a correct run does.

## What phax has today, to read first

- The four findings in report B (SEC-02, SEC-06, SEC-07, SEC-08, SEC-09, with SEC-23 for the brief files) and their
  confirmation in the cross-validation's table.
- `src/infra/git.ts`: every git call goes through `runGitProcess`/`gitRun`. Nothing in `src/` sets
  `core.hooksPath`, `core.fsmonitor`, `--no-verify`, `GIT_DIR` or `GIT_WORK_TREE` today.
- `src/domain/records/assemble.ts` (`selectRecordArtifacts`, `PHASE_TRANSCRIPT_FILES`), `destination.ts`, and how
  revision and decision records already pick their files from an allowlist.
- `src/app/worktree.ts` (`ensurePhaxContextIgnored`, `PHAX_CONTEXT_DIR`), and every writer and reader of
  `.phax-context` that report B lists.
- `src/app/reviewCode.ts` (the doctrine's `source: "project" | "bundled"`), and how the run's base commit is known
  there.
- The Small follow-up "a phase agent commits phax's own `.gitignore` line": in a fresh repository, the phase-01
  agent committed the line phax appended, and the PR counted it as a deviation. It is the same function as SEC-08.

## What to decide

- **SEC-02, what a skeleton carries.** An allowlist of the files a skeleton record keeps, rather than a longer
  denylist, as revision and decision records do. Which files are transcript-class: report B names
  `fix-attempt-*.jsonl`, `handoff-generation.jsonl` and `*.vibe-export`, and probably the gate logs and
  `agent-error.log`. Whether the absolute paths in `security.json` and `status.json` stay. Whether to publish an
  advisory for public repositories that already pushed skeleton records: this is the operator's call, outside the
  spec. A test that lists a full phase folder and names what each record shape keeps.
- **SEC-07, how far the slice goes.** `-c core.fsmonitor=false` alone does not close it: a planted config can also
  run a clean filter on `git add`, a `diff.external` or a `core.sshCommand`. Two ways to close it:
  1. phax checks before each git call in a worktree that the `.git` file still names the gitdir phax created, and
     refuses otherwise. Small; recommended.
  2. phax sets `GIT_DIR`/`GIT_WORK_TREE` explicitly on every worktree call. Larger, since it reaches every call in
     the helper.
  Adding `.git` to the native deny rules of each provider is the matching feed-forward.
- **SEC-06, hooks off.** `-c core.hooksPath=/dev/null` on every phax git call, or `--no-verify` on its commits only.
  The first also covers `post-checkout` and the other hooks git runs at `worktree add`. Whether to also refuse a
  change of the hooks directory since the phase base, or leave that to SEC-01.
- **SEC-08 and the `.gitignore` line.** `lstat` `.phax-context` and its subdirectories and refuse anything that is
  not a real directory, before every write and read. Where the ignore rule lives:
  - `/.phax-context` in `.gitignore`, without the trailing slash. This closes SEC-08 but leaves the committed-line
    follow-up.
  - The repository's `info/exclude`. It is shared by every worktree of the repository, and nothing reaches the
    phase's diff.
  Whether `brief-NN.json` is decoded through its schema before it is copied (SEC-23).
- **SEC-09, where the review skill comes from.** `git show <base>:.claude/skills/phax-review/SKILL.md`, which keeps
  a project's own skill as it was before the run. The alternative is the main checkout's copy. Either way, a run
  that changed the skill says so in the review.

## Constraints

- One plan, about one phase per finding, each in its own files. Its footprint must stay disjoint from
  `gate-step-times`, which runs beside it: no edit to `gates.ts`, `gateAttribution.ts`, `fixLoop.ts`, `closeStop.ts`
  or `recordsExplain`. Check with `phax plans overlap` before starting.
- Each fix gets a test with real git or a real filesystem, not only the fakes: a husky-style pre-commit that must not
  run, a planted `core.fsmonitor` that must not run, a `.phax-context` symlink that is refused, a rewritten review
  skill that is not read.
- No persisted format change is expected. If the skeleton allowlist changes the record manifest's shape, it gets a
  new stamp and an upgrading note, with no shim.
- What a correct run does, and what it records with transcripts on, stays the same.
- The rest of phase 1 is out of scope: SEC-01's implicit protected set, SEC-03's brief config, and explicit
  `GIT_DIR` everywhere if the pointer check is chosen.
