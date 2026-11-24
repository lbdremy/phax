Write the phax plan "Security high fixes" for the approved spec `docs/specs/2611231049-security-high-fixes.md`.
It is the spec's only plan: it carries `completes-spec: true`.

Read the spec in full, sidecar included, and its brief `docs/briefs/security-high-fixes.md`. These are settled; do
not reopen them:
- the operator's verdicts of 2026-11-24 in §9b: q-skeleton-logs `logs-out`, q-abs-paths `keep-paths`, q-hooks-off
  `hookspath-all`, q-hooks-change `leave-to-sec01`, q-git-pointer `other` (the pointer check plus
  `-c core.fsmonitor=false` beside `-c core.hooksPath=/dev/null`, the residual named), q-ignore-rule `info-exclude`,
  q-brief-decode `decode`, q-review-skill `run-base`;
- everything §10 lists as settled, and its constraints; the non-goals of §7.

This plan takes every requirement of §5, every §6 surface and every §8 criterion.

## Facts read on main at 27989cf (2026-11-24)

- **`gate-step-times` has landed** (#260, 2026-11-23). §10's footprint constraint against it no longer binds; its
  allowlist constraint does. It changed the content of `checks-attempt-NN.attribution.json` and
  `gate-attribution.json` (step and attempt times), not, as far as read, the set of phase-folder files: confirm from
  #260's diff (`src/app/gates.ts`, `src/app/gateAttribution.ts`, `tests/integration/writeRecord.test.ts`) before
  writing the allowlist.
- **A parallel run** may hold `launcher-release-fixes` (`docs/plans/2611241412-launcher-release-fixes-plan.md`): it
  edits `npm/`, `deno.json`, `scripts/` and the release audit. Stay off those paths, and check with
  `phax plans overlap` once both plans exist.
- **Records.** `src/domain/records/assemble.ts`: `selectRecordArtifacts` (about line 64) keeps every file but the
  transcripts, and `PHASE_TRANSCRIPT_FILES` holds only `output.jsonl`; `assembleRecord` first drops stop artifacts
  (`stopArtifacts.ts`), Vibe export directories (`usage.ts`) and archived transcripts (`session/failureArchive.ts`).
  `fix-attempt-NN.jsonl` is named in `src/app/fixLoop.ts`, `handoff-generation.jsonl` in
  `src/app/handoffGeneration.ts`. Revision, decision, authoring and review records already pick their files from an
  allowlist: follow them. `src/domain/records/destination.ts` stays as it is (§10).
- **Git.** `src/infra/git.ts` (1,339 lines): every call goes through `runGitProcess` (about line 57) via `gitRun`,
  `gitRunBuffer` or `gitRunAllowFail`. `git worktree add` is at about line 926, the phase commit at about line 940,
  the stop close's commit in `commitTreeEffect` (about line 493). The port (`src/ports/git.ts`) does not say today
  which calls run in a phase worktree and which in the main checkout or a records clone; the fake is
  `src/infra/fakes/git.ts` with `src/infra/fakes/backend.ts`.
- **`.phax-context`.** `ensurePhaxContextIgnored` in `src/app/worktree.ts` appends `.phax-context/` to the worktree's
  `.gitignore`. Writers and readers: `worktree.ts`, `pushedBrief.ts`, `pullBrief.ts` (copies `brief-NN.json`, about
  lines 116–150), `interactiveFiles.ts` (one recursive `rm`), `interactiveStop.ts`, `closeStop.ts`,
  `handoffGeneration.ts`, `promptGeneration.ts`, `reviewCode.ts`, `resetPhase.ts`, `briefProvider.ts`;
  `isInsidePhaxContext` in `src/infra/git.ts`. The pulled-brief schema is in `src/schemas/brief.ts`.
- **Vibe.** `src/domain/session/vibeFlags.ts` builds the `write_file` and `edit` denylists (`configGuards` plus the
  protected entries, about line 137); `.git` is not in them.
- **Review.** `src/app/reviewCode.ts` reads `<worktree>/.claude/skills/phax-review/SKILL.md` when it exists (about
  lines 407–416) and already knows the run base (`firstPhase?.base`, about line 503).
- **Docs.** The spec's §11 page, `docs/security.md` (the residual of SEC-07, next to the gate-step residual), and the
  sentence in `docs/code-repository.md` about a record without a transcript.

## Settle in Technical arbitrations, with the dominant loss of each

- **Where the worktree git hardening lives** so no worktree call skips it: in `runGitProcess` keyed by the working
  directory, or a worktree-scoped helper the port's worktree methods use. The expected gitdir comes from the main
  checkout (§10), never from the worktree.
- **What a refused pointer or `.phax-context` leaves**: the phase failed with which error, and whether
  `phax resume` or `phax reset-phase` recovers it.
- **The allowlist's form**: exact names plus the per-attempt patterns, and how stop files and `.vibe-export`
  directories keep today's treatment.
- **Where `info/exclude` is resolved** (`git rev-parse --git-common-dir`, so a worktree of a worktree or a
  submodule finds the right file), and that the line is appended once.

## Shape

One phase per finding, as §10 says: SEC-02; SEC-06 with SEC-07; SEC-08 with SEC-23 and the ignore rule; SEC-09;
then the docs. Each phase brings its real-git or real-filesystem tests (§10's constraint). Models:
`claude-opus-5-5` at medium for the git helper and the records allowlist; `claude-sonnet-5-5` at medium for the
review skill and the docs. No acceptance phase: every criterion is read by tests against real git or files.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add
  a disable directive.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows.
- **CI rehearses the release cut and the next opening on every pull request.** No test may name the opened version.
- **Tests never read `~/.phax`, a real provider home or the global git config.** A real-git test sets its own
  identity and isolates its config (`tests/helpers/isolateGit.ts`); a test that spawns a child goes through
  `tests/helpers/boundedSpawn.ts`; the architectural guard refuses a new unbounded spawn.
- **A test of a hook or an fsmonitor command** proves it did not run by a marker file it would have created, never
  by timing.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `node`, `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `git log`,
`git grep` are `agentCommands`; `pnpm test` is a gate command.
