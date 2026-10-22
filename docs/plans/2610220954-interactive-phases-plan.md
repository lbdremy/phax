---
status: Approved
source-spec: docs/specs/2610211403-interactive-phases.md
completes-spec: false
approved:
  date: 2026-10-22
  baseline: c37458e
---
# Declared interactive stop

Plan 1 of 3 for the interactive-phases spec (`docs/specs/2610211403-interactive-phases.md`). After this plan, a phase the plan declares interactive (`**Mode:** interactive`) runs end to end. The run sets up the phase's worktree, writes the seed and runs one read-only first turn. It then stops in `awaiting_review` with cause `declared`, writes `review-stop.json` and exits 13 without waiting for input. A person works in the worktree with any editor or agent. `phax resume` runs the gate first and takes the person's `.phax-context/correction-handoff.md` or the handoff a read-only closing turn writes. It commits exactly the gated tree with an `Interactive-Phase:` trailer (an empty commit when nothing changed) and continues the run. Later phases read the correction under `## Review corrections`. Plan 2 adds the operator's hold (`phax run --hold`), the held stop and the oracle-pair rules. Plan 3 adds the versioned `phax ls --json` run list, transcript capture, and the records, compliance review, review handoff and PR body around a stop.

This plan replaces an abandoned first draft (`docs/plans/archive/2610220924-interactive-phases-plan.md`) that was reviewed against the code. It keeps that draft's phase order, persisted-shape analysis and open questions, and fixes what the review found:
- a Git port operation for the corrections' content diff;
- snapshots seeded from HEAD, and restores through a temporary index that never lose an edit the person made;
- a commit of exactly the gated tree, whose trailers credit no agent session;
- a record of every first turn with its own fields per outcome;
- a review-stop.json lifecycle driven by the reducer;
- review corrections shown in every reconciliation reader;
- complete file lists;
- security choices raised as open questions.

The order runs from the core to the surface:
- phase-01: the stop's formats;
- phase-02: the awaiting_review state and the persisted shapes;
- phase-03: the pure builders and the continue commands;
- phase-04: reaching a stop;
- phase-05: the commands on a stopped run;
- phase-06: closing a stop, as a use case;
- phase-07: the run loop, the prompts and lint, with the interactive refusal lifted in the same commit;
- phase-08: the docs and the skill.

Until phase-07, lint and the run preflight still refuse every interactive phase, so no commit lets a plan start a stop it cannot close. Phases 04 to 06 test their use cases directly. Closing (phase-06) and the run-loop wiring (phase-07) are separate phases because each is a full review on its own.

phase-08 edits `.claude/skills/phax-planning/SKILL.md`, so run this plan with `phax run --allow-skill-edits`. Fixtures are made up: the invoice-export and credit-notes runs, Ada Example and the session ids. Fake provider CLIs run from a temporary bin directory under a test HOME. Tests never read `~/.phax`, and they assert `$schema` URLs by format id and release pattern, never by the running release. No agent prompt this plan writes mentions how to stop a run.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

`security.agentCommands` in `phax.json` already allows every command above. `pnpm exec tsx` regenerates the schema snapshots (`pnpm exec tsx scripts/schemas-check.ts --write`). `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate `phax.usage.kdl` and `docs/cli/`. No configuration change is needed: they are declared so that the preflight confirms they are allowed.

## Technical arbitrations

- The oracles check's finding against an interactive phase inside an oracle pair stays until plan 2. That is oracle-phases §5.11, `interactiveRows(...).inside` in `src/domain/plan/oracleCheck.ts`. Removing it here would let a declared review change an oracle file with no `authored` re-run, because r-oracle-authored and r-oracle-commit land with the hold. §5.12 (an interactive phase takes no oracle role) stands, and this plan does not change the `oracles` check. Loss accepted: until plan 2, a planner cannot place a declared review between an oracle phase and its discharge.
- Each new enum admits only the values this plan writes:
  - the stop cause is `declared` only;
  - a session's `origin` is `first-turn | new-session`;
  - review-stop has only its declared variant;
  - run-status gains no `hold`.
  Plan 2 widens each enum together with the hold. Loss accepted: if a release is cut between the two plans, the widened formats need one more snapshot.
- Persisted shapes. Which formats change:
  - run-status (stamped 0.17.0), phase-status (0.20.0) and registry (0.17.0) gain `awaiting_review`;
  - phase-status also gains the required `mode` and `stop`;
  - phase-file-reconciliation (0.17.0) gains a required `reviewCorrections`;
  - cost-ledger (0.25.0) gains the `first-turn` and `closing-turn` roles.
  Each gets a `next` snapshot and a frozen decoder of its current shape under `src/schemas/history/`, recorded in `packages/schemas/history.lock.json`. A document stamped at the older release is read through that decoder and lifted in memory, never by decoding a new key as optional. A 0.20.0 phase status is lifted with `mode: "headless"` and `stop: null`. That lift is safe because no earlier binary could run an interactive phase: PR #151's preflight refuses every one, and older binaries never knew the key. So every phase they wrote was headless, and none stopped. A 0.17.0 reconciliation is lifted with `reviewCorrections: []`. In-flight runs therefore keep resuming, and none of them can be in `awaiting_review`. phax-plan and extraction-cache entries do not change, because `mode` landed in PR #151.
- The global reconciliation, `global-file-reconciliation.json`, has no `$schema`. `plans overlap --landed`, adjust-plan and review-code read it from live and archived runs. Each file entry gains a required `reviewCorrectedInPhases`, and the status list gains `review-corrected`. `src/schemas/globalReconciliation.ts` keeps a frozen copy of today's shape, which its decoder falls back to, lifting `reviewCorrectedInPhases: []`. A review correction never counts as a touch. A file that only a stop changed reads `review-corrected` with attention `ok`. Any other file keeps the status its plan and agent touches give it, with a `corrected by review in:` note.
- Where the stop lives. A phase's `status.json` carries `mode` (copied from the plan) and `stop`:
  - `null` for a phase that never stopped;
  - `{ cause: "declared", status: "waiting" }` while the phase waits or its close runs;
  - `{ cause: "declared", status: "closed", outcome: "corrected" | "unchanged" }` once committed.
  While a close runs, the run is `running` and the phase stays `awaiting_review`. One event, `StopCommitted`, then moves the phase to `committed` with its outcome, so an interruption before the commit always returns to the stop. The recorded sessions and every first turn live in `<run>/<phase>/interactive-session.json`. An interactive phase writes `model-resolution.json` and `security.json` like any phase, which the later turns read. It writes no `agent-binding.json` and no `claudeSessionId` in its status, because no agent session built it.
- `review-stop.json` exists exactly while the run is `awaiting_review`. The reducer drives it through four effects, which the effect runner applies:
  - `WriteReviewStop` on `ReviewStopReached`.
  - `ParkReviewStop` on `RunResumeRequested` from `awaiting_review`. It moves the file to `<run>/<phase>/review-stop.closing.json`, where the close reads it.
  - `RestoreReviewStop` on `StopCloseRefused` or an interrupted close. It moves the file back with `lastClose` set.
  - `DiscardReviewStop` on `StopCommitted`, on a reset at the stop and on `archive --force`, before the run folder moves.
  A SIGINT or SIGTERM during a close returns the run to `awaiting_review` with lastClose `interrupted`. That goes through the interrupt handler's sanctioned synchronous write, which matches the reducer's verdict for the event. A crash during a close leaves the run `running` with a stale lock, as for any phase. `phax resume` then re-enters the close from the phase's persisted `awaiting_review` and the parked document. `phax enter-phase` refuses a stopped phase while its run is not `awaiting_review`, naming the close in progress and `phax resume`. Only `phax enter-phase --new-session` rewrites the document's content while it exists, and it holds the run lock to do so.
- Worktree snapshots. A snapshot is a tree id built in a temporary index (`GIT_INDEX_FILE` in a temporary directory). phax seeds that index from `HEAD` with `git read-tree HEAD`, then runs `git add -A -- . ':(exclude).phax-context'` and `git write-tree`. Seeding from HEAD keeps the tracked files that match an ignore pattern, so an unchanged review never reads as corrected with phantom deletions. The real index, which may hold the person's staged changes, is never touched. Two snapshots differ exactly when their tree ids differ, and the changed paths come from `git diff-tree -r --name-status --no-renames`. Loss accepted: an edit to an ignored, untracked file goes unseen.
- Restoring a refused first turn. Before restoring anything, phax copies the turn's version of every changed path to `<run>/<phase>/refused-turn-NN/` and names that folder in the output. So an edit the person made in the worktree while a `--new-session` turn ran is never lost. phax then reads the before-tree into another temporary index, checks the modified and deleted paths out of it with `git checkout-index -f`, and deletes the paths the turn added. A restore never touches the real index, ignored files or `.phax-context/`.
- The person's handoff file and the seed sit in `.phax-context/`, which snapshots leave out. Before every phax turn, first or closing, phax records whether `.phax-context/correction-handoff.md` exists and its sha256, and checks both again after the turn:
  - A change made by a first turn is refused and restored like any edit (`refused-change`).
  - A change made by a closing turn is `closing-turn-edited`. In that case phax moves the turn's file to `refused-turn-NN/` instead of leaving it in place. Left in place, it would become the person's handoff on the next close.
  So no phax turn can write the handoff that takes precedence at closing. After each turn, phax also rewrites the worktree's seed from its run-folder copy.
- The commit is the gated tree. The gated tree is the snapshot taken after the closing gate's last step. So a step that writes, such as this repository's `pnpm format`, lands in the correction commit, as it lands in a headless phase's commit. After the handoff, phax takes another snapshot and refuses on any difference: `closing-turn-edited` (exit 5) when a closing turn ran, `worktree-changed` (exit 1) otherwise. It then commits that tree id with a new Git port operation, `commitTree`, never with `git add -A`:
  - `git commit-tree <tree> -p HEAD`, under the checkout's git identity;
  - the phase branch advanced with `git update-ref`, checked against the old HEAD;
  - the real index reset to the new HEAD.
  An unchanged declared phase commits HEAD's own tree through the same operation: that is its empty commit.
- An interactive commit's body is the plan's commit body, then `---` and these trailers: `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Interactive-Phase: <phase id>`, `Worktree` and `Gate-Log: <closing gate attempt log>`. It carries no `Model`, `Effort` or `Session-Id`, because no agent session wrote the correction. `Phase-Id` stays, because `phax records explain` finds a phase's commits by it.
- The closing turn gets the corrections as content, not just file names. A read-only Claude turn has no shell to run `git diff`. So a new Git port operation, `diffTrees(repo, fromTree, toTree)`, returns the output of `git diff-tree -p -r --no-color --no-ext-diff --no-textconv --no-renames` between HEAD's tree and the gated tree. The prompt embeds up to 200 000 bytes of it. Past that, it embeds the first 200 000 bytes, says the diff was cut, and lists every changed path, which the turn can read in the worktree. The same diff is saved as the phase's `diff.patch`.
- The seed points to `.phax-context/plan.md`, which phax already writes into every phase worktree, rather than embedding the full plan. It embeds the phase's Detailed instructions, every executed phase's handoff and the upcoming phases' plan sections, in the order and wording of the spec's §6 example.
- Later prompts. `## Previous phase handoff` and the previous reconciliation both skip back over interactive phases to the nearest earlier headless phase. So a correction is not printed twice, and the reconciliation shown is an agent's. Every closed stop reaches a later phase through `## Review corrections`, which holds the stop's interactive handoff and the files its reconciliation lists under `reviewCorrections`. The section is absent when the run has no closed stop, so the prompts of plans without a stop stay byte-identical.
- Cost. The ledger gains the roles `first-turn` and `closing-turn`, read from `first-turn-NN.jsonl`, `closing-turn-NN.jsonl` and their `-retry` corrective streams in the phase folder. A closing turn is priced from its own stream's assistant messages, never from the result's `modelUsage`. When the person continued the session, that result reports cost cumulatively, including turns the ledger never saw. Losses accepted:
  - a closing turn's entry misses any cost the result reports but its messages do not;
  - as today, the ledger records Claude Code invocations only, so a stop on codex or vibe leaves no entry.
- Records and review surfaces until plan 3:
  - phax writes no phase record for an interactive phase, committed or failed. `phax records explain` then finds no record, rather than one claiming an agent session wrote the person's correction.
  - `final-report.md` labels an interactive phase's row `(interactive)`, shows no session, and links its first-turn and closing-turn streams instead of `output.jsonl`.
  - `review-handoff.md` and the PR body already link the phase's `phase-handoff.md`, which for a declared phase is the interactive handoff.
  - The phase's reconciliation lists the review corrections as not deviations.
  Losses accepted until plan 3: the records branch has a gap at each declared phase, and the compliance review may still question a correction.
- Exit codes and errors. Reaching a stop fails the run's effect with a tagged `AwaitingReviewStopError`. It is a pause, like a rate limit: no `RunFailed`, no record, exit 13. A refused close is a tagged `StopCloseRefusedError`, carrying its `lastClose` and that variant's exit code:
  - a red gate: 4;
  - a closing turn that edits, or a closing answer still invalid after one corrective resume: 5;
  - an invalid person's handoff file, or a worktree changed after the gate: 1;
  - a limit: 8.
  EXIT_CODE_MEANINGS gains `13  Awaiting review at an interactive phase (resumable)`; plan 2 widens the wording to held phases. The preflight check keeps its id `interactive-phases` and its last place in RUN_PREFLIGHT_CHECKS, after `oracle-phases`.
- Printed commands. A continue or fresh-start command is printed as `cd <worktree> && [NAME=value …] <argv>`, with every word POSIX single-quoted by one pure helper. review-stop.json carries the same command as `{ cwd, argv, env }`. Under a codex command, the output adds a note: the first time codex opens the worktree, it asks you to trust the directory, then to review its hooks. A continued session never carries skill-edit grants: Claude Code asks the person before any `.claude/` edit.
- `phax enter-phase --new-session` takes the run lock for its first turn and file writes, and releases it before the interactive session starts. A new turn that fails or is refused leaves the previous current session, `first-reading.md` and review-stop.json as they were.
- Message and output wording follows the spec's §6 indicative examples.

## Arbitrated questions

### q-turn-shell — phax's own first turn and closing turn run read-only where the provider allows it. On Claude Code, does that read-only turn get a shell for the phase's frozen agent commands, or no shell at all?

- no-shell — Claude Code gets its reading tools only (Read, Grep, Glob, `--strict-mcp-config`, no Bash), and codex's read-only sandbox stays as it is — abandons: A first reading or closing handoff that has run anything. On Claude Code the turn cannot run the gate or a test to confirm the pattern it reports. Codex behaves differently: its read-only sandbox still runs commands, and it keeps the MCP servers the user configured in `~/.codex/config.toml`, because phax has no override for them, as for every headless codex phase today.
- phase-commands — Claude Code gets its reading tools plus Bash for exactly the phase's frozen agent commands, as headless plan authoring grants `phax architecture` — abandons: A turn that cannot run code. The frozen set holds this repository's `node`, `pnpm exec tsx` and `pnpm format`, so the turn can run any script with the user's rights and no write sandbox: Claude's read-only flags carry none. It can write anywhere outside the worktree, where no comparison checks, and it can reach the network.

Recommendation: no-shell — These turns only read and report. The person is about to work in the worktree and can run the gate themselves, and closing runs the gate anyway. Granting the phase's commands would turn a read-only turn into code execution outside any sandbox. The before/after comparison only sees the worktree, so it cannot catch an edit made elsewhere.

Decision: no-shell — by operator (Rémy Loubradou), 2026-10-22
Why: Decided by the operator on 2026-10-22, as recommended: These turns only read and report. The person is about to work in the worktree and can run the gate themselves, and closing runs the gate anyway. Granting the phase's commands would turn a read-only turn into code execution outside any sandbox. The before/after comparison only sees the worktree, so it cannot catch an edit made elsewhere. Advocate: A turn with the phase's commands could confirm the pattern it reports by running the gate or a test. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-04.

### q-vibe-turns — mistral-vibe has no read-only mode that phax has verified. How do phax's first turn and closing turn run on a vibe phase?

- phase-posture — Under the phase's own security posture and `--agent`, guarded by the worktree comparison and by the check of `.phax-context/correction-handoff.md` after each turn (spec §5.26, §5.27, §5.52) — abandons: A narrowed turn on vibe. During the turn, vibe can do anything the headless vibe phase it reviews could do: write in its writable roots outside the worktree (`~/.phax` included), edit an ignored file or another `.phax-context/` file, and reach the network. phax never refuses those edits. It refuses only edits to the worktree and to the person's handoff file.
- plan-agent — Run vibe's turns with vibe's built-in `plan` agent (`--agent plan`), with the same comparison and check — abandons: Certainty. phax has never run vibe with that agent, and a phase cannot verify that it denies writes and the shell in a `vibe -p` session. If it does not, the narrowing is nominal. If it asks for approval when headless, every vibe first turn fails, and every vibe close needs the person's handoff file.
- refuse-vibe — The run preflight refuses a declared interactive phase routed to mistral-vibe until vibe has a verified read-only mode — abandons: Interactive phases on vibe. That goes against the spec's first turn on every provider (§5.24) and its criterion that a vibe first turn which edits is refused.

Recommendation: phase-posture — A vibe turn under the phase posture can do no more than the vibe phase it reviews already did. The comparison and the handoff-file check refuse and restore every edit that would reach the commit or the closing. The plan-agent narrowing is unverified, and refuse-vibe breaks the spec. Revisit once an e2e run verifies vibe's `plan` agent.

Decision: phase-posture — by operator (Rémy Loubradou), 2026-10-22
Why: Decided by the operator on 2026-10-22, as recommended: A vibe turn under the phase posture can do no more than the vibe phase it reviews already did. The comparison and the handoff-file check refuse and restore every edit that would reach the commit or the closing. The plan-agent narrowing is unverified, and refuse-vibe breaks the spec. Revisit once an e2e run verifies vibe's `plan` agent. Advocate: Refusing vibe, or narrowing it with its plan agent, would keep an unconfined turn from running at a stop. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-04.

### q-enter-phase-posture — Today `phax enter-phase` resumes a headless phase's session with no posture flags (`claude --resume <id>`), so the re-entered session runs under the user's own provider defaults. Now that codex phases resume too (§5.42), should a re-entered headless session carry the phase's posture, as the stop's continue command does (§5.37)?

- carry-posture — Rebuild the phase's filesystem, network and MCP flags from its `security.json`, and on Claude Code its allowed-command flags too (codex has none), with the same builder and approval policy as the stop's continue command (q-continue-approvals), on Claude Code and codex — abandons: The user's own interactive defaults in a re-entered session, which the phase's flags override. Also, a phase whose `security.json` is missing or unreadable can no longer be re-entered: phax refuses it rather than open it unconfined.
- provider-defaults — `claude --resume <id>` and `codex resume <id>` with the phase's model and effort only. Today Claude Code resumes with no flag at all; this option adds the model and effort and nothing else — abandons: The phase's confinement once it is re-entered. Under the user's defaults, the agent that built the phase can write outside the worktree, reach the network and run any command. On codex those defaults may be `danger-full-access` with `approval_policy="never"`; on Claude Code, whatever permission mode the user's settings name. It does so inside a session that phax started under its sandbox.

Recommendation: carry-posture — A re-entered session is the same agent, with the same context, that phax confined while it built the phase. Carrying the posture keeps one rule for every interactive session phax opens, at a stop or not. The only things lost are defaults the person can still apply by running the provider by hand.

Decision: carry-posture — by operator (Rémy Loubradou), 2026-10-22
Why: Decided by the operator on 2026-10-22, as recommended: A re-entered session is the same agent, with the same context, that phax confined while it built the phase. Carrying the posture keeps one rule for every interactive session phax opens, at a stop or not. The only things lost are defaults the person can still apply by running the provider by hand. Advocate: Resuming with the provider's defaults keeps the person's own interactive settings in a re-entered session. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-05.

### q-continue-approvals — The continue and fresh-start commands carry the phase's filesystem and network posture (§5.37). Which approval policy do they carry, and can the continued session therefore step outside the posture with the person's approval?

- provider-prompts — Claude Code: the phase's own flags unchanged (`--permission-mode acceptEdits`, `--add-dir` per writable root, `--allowedTools` for the frozen commands, the MCP flags), so edits inside the working dirs are auto-approved and anything else prompts the person. codex: the sandbox, writable-root and network flags with `approval_policy="on-request"`, on the continue and the fresh-start command alike — abandons: The guarantee that a continued session stays inside the phase's sandbox. One yes from the person lets the agent run a command outside the allowlist or write outside the worktree, and on codex escalate out of the sandbox with network access.
- sealed — Claude Code: `--permission-mode dontAsk` with the phase's `--add-dir` and an allowlist of the frozen commands plus Edit and Write, a mode phax has not verified interactively. codex: the same flags with `approval_policy="never"`, as headless runs use — abandons: A person approving a one-off command through the agent: they must run it in another shell. On Claude Code the seal also rests on an interactive no-prompt mode that phax has never run, which may deny edits the person asks for.

Recommendation: provider-prompts — At a stop the person is present and is the approver, and plan 3 records that their work, a continued session included, ran outside phax's enforcement (§5.70). A sealed command promises a boundary that the person can drop by editing the printed line, and on Claude Code it depends on an unverified mode. With prompts on, every step outside the posture still needs the person's explicit yes. Under either option, a phase in unsafe mode carries its unsafe flags.

Decision: provider-prompts — by operator (Rémy Loubradou), 2026-10-22
Why: Decided by the operator on 2026-10-22, as recommended: At a stop the person is present and is the approver, and plan 3 records that their work, a continued session included, ran outside phax's enforcement (§5.70). A sealed command promises a boundary that the person can drop by editing the printed line, and on Claude Code it depends on an unverified mode. With prompts on, every step outside the posture still needs the person's explicit yes. Under either option, a phase in unsafe mode carries its unsafe flags. Advocate: A sealed command would keep a continued session inside the phase's sandbox even with the person's approval. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-03.

## Decision log

- 2026-10-22 q-turn-shell decided no-shell — operator (Rémy Loubradou)
- 2026-10-22 q-vibe-turns decided phase-posture — operator (Rémy Loubradou)
- 2026-10-22 q-enter-phase-posture decided carry-posture — operator (Rémy Loubradou)
- 2026-10-22 q-continue-approvals decided provider-prompts — operator (Rémy Loubradou)

---

## phase-01 — The stop's formats, review corrections in the reconciliation and turn roles in the cost ledger {#phase-01-stop-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Define every document a declared stop reads or writes: the first-reading and interactive-handoff answers, interactive-session.json and review-stop.json. Each is born with `$schema` and published through `@lbdremy/phax-schemas`. Give the phase and global file reconciliations their review corrections, and the cost ledger its first-turn and closing-turn roles. Freeze the older shapes and read them lifted.

### Detailed instructions

- Create `src/schemas/firstReading.ts` with the shape `{ $schema, pattern: NonEmptyArray<NonEmptyString>, copiedBy: Array<{ phase: phase-NN, what: NonEmptyString }>, toCheck: Array<NonEmptyString> }`, refusing unknown keys. Export the file schema, its type and the in-memory type without `$schema`.
- Create `src/schemas/interactiveHandoff.ts` with the shape `{ $schema, corrections: NonEmptyArray<{ what: NonEmptyString, guard }>, patternFromNowOn: Array<NonEmptyString>, nextPhasesNeedToKnow: Array<NonEmptyString> }`. `guard` is exactly `{ kind: "test" | "lint" | "gate-step", ref: NonEmptyString }` or `{ kind: "none", reason: NonEmptyString }`. Refuse unknown keys.
- Create `src/schemas/interactiveSession.ts` with the shape `{ $schema, phaseId, provider (ProviderIdSchema), interactiveResume: "verified" | "unverified", current: Session | null, history: Session[], firstTurns: FirstTurn[], turnInProgress: TurnInProgress | null }`.
  - `Session` is `{ provider, model, effort, sessionId, startedAt, origin: "first-turn" | "new-session" }`.
  - `FirstTurn` has one variant per outcome, each with `origin`, `startedAt` and `endedAt`:
    - `{ outcome: "answered", sessionId }`;
    - `{ outcome: "refused-change", changedPaths: NonEmptyArray<string>, keptAt: NonEmptyString }`, where `keptAt` is the folder holding the turn's versions of those paths. It has no session id, because a refused turn records no session;
    - `{ outcome: "failed", reason: "rate-limit" | "usage-limit" | "provider-error" | "invalid-answer" | "interrupted", detail: NonEmptyString, resetAt: string | null }`.
  - `TurnInProgress` is `{ turn: NN, origin, beforeTree, personHandoffBefore: sha256 | null, startedAt }`. It is set while a first turn runs, and null otherwise.
  - Refuse unknown keys on every variant.
- Create `src/schemas/reviewStop.ts`, with the declared variant only. Its shape is `{ $schema, run (qualified name), state: "awaiting_review", cause: "declared", phase: { id, title, mode: "interactive", position, of }, firstReading: string | null, worktree, seed, session: { provider, sessionId, origin, interactiveResume } | null, commands: { continue: Command | null, freshStart: Command, enterPhase: Command, close: Command, reset: Command }, lastClose: LastClose | null, closeBase: string | null }`.
  - `closeBase` is the HEAD sha a close recorded before its gate, or null before any close.
  - `Command` is `{ cwd, argv: NonEmptyArray<string>, env: Record<string, string> }`.
  - `LastClose` has one variant per result, each with `at` and its exit code as a literal:
    - `gate-failed`: 4, with `log`;
    - `worktree-changed`: 1, with `paths`;
    - `closing-turn-edited`: 5, with `paths`;
    - `handoff-invalid`: 1, with `defects`;
    - `closing-answer-invalid`: 5, with `reason`;
    - `limit`: 8, with `resetAt: string | null`;
    - `close-error`, with `step` and `detail`: 5 when `step` is `closing-turn` (a provider error in the closing session), 1 when it is `gate`, `commit` or `files` (a Git, file or shell error);
    - `interrupted`: 130.
  - Refuse unknown keys, so the declared variant refuses a `phaseCommit` key.
- In `src/schemas/schemaUrl.ts`, append `first-reading`, `interactive-handoff`, `interactive-session` and `review-stop` to `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS`, and extend both doc comments. In `src/schemas/persisted.ts`:
  - add `readInteractiveSessionFile` and `readReviewStopFile`, both through `readSchemaBornPersisted`. The new modules export the file decoders `decodeFirstReadingFile`, `decodeInteractiveHandoffFile`, `decodeInteractiveSessionFile` and `decodeReviewStopFile`, and only `src/schemas/persisted.ts` names them;
  - add `readFirstReadingAnswer` and `readInteractiveHandoffAnswer`, written like `readGateReport` with `AnswerBounds`. They refuse an answer with no `$schema`, of another format, or of a release outside the bounds, with a message naming the format.
- Publish the four formats:
  - create `packages/schemas/src/formats/interactive.ts` with one `defineFormat` per format, written like `packages/schemas/src/formats/oracleRequest.ts` (`preSchema: null`, `releases: []`);
  - register them in `packages/schemas/src/index.ts` and `packages/schemas/build/jsonSchemas.ts`;
  - add a row per format to README.md §Persisted formats (`parseFirstReading`, `parseInteractiveHandoff`, `parseInteractiveSession`, `parseReviewStop`).
- Reconciliation:
  - Add a required `reviewCorrections: readonly string[]` to `ReconciliationResult` in `src/domain/reconciliation/types.ts`. `reconcile` returns `[]` for it, and the field is required in `src/schemas/reconciliation.ts`.
  - Freeze today's shape as `src/schemas/history/phase-file-reconciliation/0.17.0.ts`. Read a document stamped 0.17.0 through it, lifted with `reviewCorrections: []`; the pre-schema lift gains the same field. Register the frozen shape in `packages/schemas/src/formats/recordTimeline.ts`.
  - Every literal `ReconciliationResult` in `src/` gains `reviewCorrections: []`, including the fallback in `src/app/executePlan.ts`.
- In `src/domain/reconciliation/render.ts`, when `reviewCorrections` is not empty, render a `### Review corrections` section before the summary: the line `> Changed by a person at an interactive stop: not a deviation.`, then one bullet per path. A review correction never sets `hasDeviations`.
- Global reconciliation, in `src/domain/reconciliation/global.ts`:
  - Each `GlobalFileEntry` gains a required `reviewCorrectedInPhases`, and `GlobalFileStatus` gains `review-corrected`.
  - A phase's `reviewCorrections` go into that set only, never into `touchedInPhases`, so they never make a file `unplanned` or `extra-touch`.
  - A file with no other entry gets status `review-corrected` with attention `ok`. Any other file keeps the status its other entries give it.
  - `renderGlobalReconciliationMarkdown` shows `<phase> (review)` in the Touched-in column and adds the note `corrected by review in: <phases>`.
  In `src/schemas/globalReconciliation.ts`, add the field and the status, and keep a frozen copy of today's entry and document shape in the same module. Its decoder reads the current shape, and otherwise reads the frozen one, lifted with `reviewCorrectedInPhases: []`. This file has no `$schema`, and `plans overlap --landed`, adjust-plan and review-code read it from archived runs.
- Cost ledger:
  - Add `first-turn` and `closing-turn` to the phase roles in `src/schemas/costLedger.ts` and to `InvocationRole` in `src/domain/cost/ledger.ts`.
  - `ledgerEntryFor` prices a `closing-turn` stream from its own deduplicated assistant messages (`partialModels`), whether or not the stream has a result. It never prices from the result's `modelUsage`, and never subtracts earlier entries. The entry is `complete` when the stream has a result, and its `agentMs` is the result's duration.
  - `runStreamsInOrder` picks up `first-turn-NN.jsonl`, `first-turn-NN-retry.jsonl`, `closing-turn-NN.jsonl` and `closing-turn-NN-retry.jsonl` in a phase folder, under their roles.
  - Freeze today's ledger as `src/schemas/history/cost-ledger/0.25.0.ts`, read lifted unchanged, and register it in `packages/schemas/src/formats/runDirectory.ts`.
- Keep the tests keyed by format whole, as the oracle-request format did (commit b9b54692):
  - in `tests/unit/architecturalGuards.test.ts`, add the four formats and their decoders to `BRIDGE_ONLY_DECODERS`, and add the six new `src/schemas/` modules (the four formats and the two frozen shapes) to `CLOSURE_SRC_ALLOWLIST`, in its sorted order;
  - add the four decoders to `PHAX_DECODERS` in `tests/unit/schemasPackage/documents.test.ts`, and the four formats to the per-format maps of `tests/unit/schemasPackage/parity.test.ts` and `tests/unit/schemasPackage/currentShapes.test.ts`;
  - the typed `GlobalFileEntry` literals in `tests/unit/publish/prBody.test.ts`, `tests/unit/review/codeReviewWorklist.test.ts` and `tests/unit/reconciliation/explained.test.ts` gain `reviewCorrectedInPhases: []`.
- Create `tests/helpers/reconciliationFixture.ts`, which exports `reconciliationResult(overrides)` and `phaseReconciliationFile(phaseId, overrides)`, the latter stamped with `currentSchemaUrl`. Use it in every test whose reconciliation literal or persisted fixture breaks on the new required field. `pnpm test:type` names every literal left.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes the `next.schema.json` snapshots of the four new formats, phase-file-reconciliation and cost-ledger, and updates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`. Then:
  - record the two frozen modules in `packages/schemas/history.lock.json`, with the hashes the frozen-history test expects;
  - add current-shape fixtures for every new or changed format to `tests/unit/schemasPackage/documents.ts`.

### Planned files to create

- `src/schemas/firstReading.ts`
- `src/schemas/interactiveHandoff.ts`
- `src/schemas/interactiveSession.ts`
- `src/schemas/reviewStop.ts`
- `src/schemas/history/phase-file-reconciliation/0.17.0.ts`
- `src/schemas/history/cost-ledger/0.25.0.ts`
- `packages/schemas/src/formats/interactive.ts`
- `packages/schemas/snapshots/first-reading/next.schema.json`
- `packages/schemas/snapshots/interactive-handoff/next.schema.json`
- `packages/schemas/snapshots/interactive-session/next.schema.json`
- `packages/schemas/snapshots/review-stop/next.schema.json`
- `packages/schemas/snapshots/phase-file-reconciliation/next.schema.json`
- `packages/schemas/snapshots/cost-ledger/next.schema.json`
- `tests/helpers/reconciliationFixture.ts`
- `tests/unit/schemas/interactiveFormats.test.ts`
- `tests/unit/costLedgerTurnRoles.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/schemas/reconciliation.ts`
- `src/schemas/globalReconciliation.ts`
- `src/schemas/costLedger.ts`
- `src/domain/cost/ledger.ts`
- `src/domain/reconciliation/types.ts`
- `src/domain/reconciliation/reconcile.ts`
- `src/domain/reconciliation/render.ts`
- `src/domain/reconciliation/global.ts`
- `src/app/executePlan.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/documents.ts`
- `README.md`
- `tests/unit/reconciliation/reconcile.test.ts`
- `tests/unit/reconciliation/render.test.ts`
- `tests/unit/reconciliation/global.test.ts`
- `tests/unit/schemas/reconciliation.test.ts`
- `tests/integration/generateGlobalReconciliation.test.ts`
- `tests/integration/finalReview.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/publish/prBody.test.ts`
- `tests/unit/review/codeReviewWorklist.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/reconciliation/explained.test.ts`

### Optional files that may be edited

- `src/app/reconcilePhaseFiles.ts`
- `src/domain/reconciliation/explained.ts`
- `src/app/generateGlobalReconciliation.ts`
- `src/app/costBackfill.ts`
- `src/app/costLedger.ts`
- `src/domain/cost/history.ts`
- `packages/schemas/README.md`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/adjustPlan.test.ts`

### Boundary contracts

Provider → phax: the first and closing turns answer a first-reading or interactive-handoff document in their final message. phax decodes it at the boundary and refuses a missing or unknown `$schema`. phax → review UI: a UI reads review-stop.json and interactive-session.json without running phax, so their shapes are versioned and published in `@lbdremy/phax-schemas`. Reconciliation → readers: file-reconciliation.json and global-file-reconciliation.json keep every existing key and add the review corrections. Archived runs' files stay readable through the frozen shapes.

### Test strategy

Write `tests/unit/schemas/interactiveFormats.test.ts` first. For each new format:
- a valid document decodes;
- a missing `$schema`, an unknown release, an unknown key, or a value outside any enum is refused;
- a `none` guard without `reason` is refused;
- a review-stop with `phaseCommit` is refused;
- each first-turn and lastClose variant decodes with exactly its own keys and refuses the keys of another variant;
- `turnInProgress` and `closeBase` decode both null and set, and `close-error` refuses a `step` outside its list.
Write `tests/unit/costLedgerTurnRoles.test.ts`:
- a closing-turn stream whose result reports a cumulative $1.40, over assistant messages priced at $0.30, gives an entry of $0.30;
- a first-turn entry is priced like a complete entry;
- the stream scanner lists both roles and their `-retry` streams.
Extend the reconciliation tests: the `### Review corrections` section renders, `hasDeviations` stays false, and a file that only a stop changed reads `review-corrected` with attention `ok` in the global reconciliation. A file planned in phase-02 and corrected in phase-03 keeps `matched` and gets the note. Today's global-file-reconciliation.json, a 0.17.0 phase reconciliation and a 0.25.0 ledger still decode, lifted. The schemas-package tests check the snapshots, parity and README rows.

### Implementation order

1. the four schemas and their decoders, with their tests
2. FORMAT_IDS, the readers and the package formats
3. the reconciliation field, its rendering and its frozen decoder
4. the global reconciliation status and its frozen fallback
5. the cost-ledger roles, their pricing and the frozen decoder
6. the fixture helper and the broken test fixtures
7. snapshot regeneration, the history lock, the fixtures and the README rows

### Excluded scope

- Building or writing any of these documents at runtime (phase-03, phase-04, phase-06)
- Filling `reviewCorrections` from a stop's commit (phase-06)
- The run-list format and `phax ls --json` (plan 3)
- The `held` cause, the `builder` origin and a held review-stop variant (plan 2)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give:
- the exported schema, type and decoder names of each new module in `src/schemas/`, and the reader names in `src/schemas/persisted.ts`;
- the exact `reviewCorrections` field, the new global field `reviewCorrectedInPhases` and the `review-corrected` status rule;
- the frozen fallback in `src/schemas/globalReconciliation.ts`;
- the new cost-ledger roles, the function that prices a closing turn from its own messages, and the stream file names the scanner reads;
- the helpers in `tests/helpers/reconciliationFixture.ts`.
Explain any deviation from the planned file lists, including any listed test that needed no change.

### Commit subject

`feat(schemas): add the declared stop's formats, review corrections and turn roles`

### Commit body

first-reading, interactive-handoff, interactive-session and review-stop
are born with $schema and published in @lbdremy/phax-schemas. A phase's
file reconciliation gains a required reviewCorrections list, and the
global reconciliation reads a correction as review-corrected, never as an
unplanned touch. The cost ledger gains the first-turn and closing-turn
roles; a closing turn is priced from its own messages, never from a
session's cumulative cost. The older shapes are frozen and read lifted.

---

## phase-02 — The awaiting_review state, its events and effects, and the run, phase and registry shapes {#phase-02-awaiting-review-state}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** This phase designs a new state machine arm that no code in the repository shows yet: awaiting_review with its close in progress, refused and interrupted closes, and reducer-driven file effects, across the reducer and three persisted shapes.

Give phax a real state for a run that waits for a person. Through the reducer only, the run and its phase enter `awaiting_review` with cause `declared`, leave it to close, and return to it when a close is refused or interrupted. The reducer drives review-stop.json's lifecycle through dedicated effects. run-status.json, a phase's status.json and the registry persist the state in new shapes, and frozen decoders keep every run that an earlier binary wrote readable.

### Detailed instructions

- In `src/domain/state.ts`:
  - add `awaiting_review` to `RunState` and `PhaseState`;
  - add `export type StopCause = "declared"` (plan 2 adds `held`);
  - add the `PhaseSubState` variant `{ state: "awaiting_review"; cause: StopCause }` and the `PhaxState` variant `{ run: "awaiting_review"; phase: { state: "awaiting_review"; cause: StopCause } }`.
  `awaiting_review` is not in `TERMINAL_PHASE_STATES`. Add no deprecated flat transition function.
- In `src/domain/events.ts`, add three events:
  - `ReviewStopReached { phaseId, cause, worktreePath, reviewStop }`, where `reviewStop` is the in-memory value of `src/schemas/reviewStop.ts`;
  - `StopCloseRefused { phaseId, lastClose }`;
  - `StopCommitted { phaseId, hash, outcome: "corrected" | "unchanged" }`.
- In `src/domain/effects.ts`, add the resume context reason `Awaiting review` with kind `awaiting_review`, and four commands:
  - `WriteReviewStop { reviewStop }`;
  - `ParkReviewStop`;
  - `RestoreReviewStop { lastClose }`;
  - `DiscardReviewStop`.
  In `src/app/effectRunner.ts`, apply them through the FileSystem port. Paths come from the dispatch context: `<run>/review-stop.json`, and `<run>/<phase>/review-stop.closing.json` for the parked copy.
  - `WriteReviewStop` writes the document stamped with `withSchemaUrl("review-stop")`.
  - `ParkReviewStop` moves it to the phase folder.
  - `RestoreReviewStop` reads the parked copy (through `readReviewStopFile`), sets `lastClose`, keeps every other field (`closeBase` included), writes it back to the run folder and removes the parked copy.
  - `DiscardReviewStop` removes both files when present.
- Add these arms to `src/domain/reducer.ts`:
  - `ReviewStopReached` on running/{running} → awaiting_review/{awaiting_review, cause}. Effects: PersistState (run `stoppedReason: "awaiting_review"`; phase state `awaiting_review` and `stop: { cause, status: "waiting" }`), WriteReviewStop, WriteResumeInstructions with kind `awaiting_review`, EmitTrace `review.stop.reached`.
  - `RunResumeRequested` on awaiting_review → running, with the phase still {awaiting_review, cause}. Effects: PersistState and ParkReviewStop.
  - `StopCloseRefused` on running/{awaiting_review} → awaiting_review/{awaiting_review, cause}. Effects: PersistState (`lastError` naming the result), RestoreReviewStop and WriteResumeInstructions.
  - `StopCommitted` on running/{awaiting_review} → running/{committed, hash}. Effects: the same PersistState and RecordCommitMetadata that `CommitCreated` emits, plus phase `stop: { cause, status: "closed", outcome }`, then DiscardReviewStop.
- Interpret the existing events on the new state:
  - `RunInterruptRequested` on running with the phase awaiting_review → awaiting_review/{awaiting_review}, with RestoreReviewStop (lastClose `interrupted`, exit 130, at the event's `occurredAt`) and WriteResumeInstructions. On awaiting_review it is ignored: `nothing is running while the run awaits review`.
  - `RunArchiveRequested` on awaiting_review is handled with `force`, with DiscardReviewStop before the MoveRunToArchive effects. Without `force` it is rejected with `run is awaiting_review, not finished; pass --force to archive it anyway`.
  - `PhaseResetRequested` on awaiting_review → interrupted/{pending}, with today's PersistState plus DiscardReviewStop. On running with the phase awaiting_review it is rejected: `a close of the stop is in progress`.
  - `RunStarted`, `RunFailed`, `RunCompleted`, `PhaseStartRequested` and `FinalReviewOpened` are rejected on awaiting_review.
  - Every agent, gate, fix, handoff, commit, cleanup, rate-limit and completion event is `stale` on awaiting_review.
  - `RateLimitDetected` on running/{awaiting_review} is `unexpected`, because a close reports a limit with `StopCloseRefused`.
  Keep the `assertNever` default in every inner switch.
- In `src/domain/matrix.ts`, add the `awaiting_review` row and the three new event columns to every row. In `tests/unit/reducer.test.ts`, give `representativeState` the canonical `{ run: "awaiting_review", phase: { state: "awaiting_review", cause: "declared" } }`.
- In `src/app/resumeInstructions.ts`, render kind `awaiting_review`: the run waits for a person at the phase. The text names the worktree, `phax enter-phase <run> <phase>`, `phax resume <run>` (run from the main checkout) and `phax reset-phase <run> <phase>`.
- In `src/app/phaxState.ts`, compose awaiting_review from the run status and the stopped phase's status, taking the cause from `stop.cause`. A run that is `running` with its current phase `awaiting_review` composes running/{awaiting_review, cause}. In `src/app/resume.ts`, give awaiting_review no refusal message, since `RunResumeRequested` is handled there.
- Schemas:
  - In `src/schemas/status.ts`, add `awaiting_review` to both state unions.
  - Add the required phase-status fields `mode` (the `PhaseModeSchema` of `src/schemas/phaxPlan.ts`) and `stop`. `stop` is `Schema.NullOr` of a union of `{ cause: Literal("declared"), status: Literal("waiting") }` and `{ cause: Literal("declared"), status: Literal("closed"), outcome: Literal("corrected", "unchanged") }`.
  - Add `awaiting_review` to the run state in `src/schemas/registry.ts`.
  - Add no `hold` field.
- Write `mode` (from the plan phase) and `stop: null` wherever a phase status is first written (`src/app/phaseFolder.ts`). Every other writer keeps both; the compiler names any that drop them.
- Freeze the current shapes:
  - create `src/schemas/history/run-status/0.17.0.ts`, `src/schemas/history/phase-status/0.20.0.ts` and `src/schemas/history/registry/0.17.0.ts`, each a self-contained copy of today's schema, written like the frozen modules beside them;
  - in `src/schemas/persisted.ts`, route a document stamped at that release to its frozen decoder, as the phax-plan reader routes its 0.17.0 shape, and lift it in memory. A 0.20.0 phase status gets `mode: "headless"` and `stop: null`, because no earlier binary could run an interactive phase or stop; run-status and registry are lifted unchanged;
  - keep refusing a phase status without `base`;
  - register the frozen shapes in `packages/schemas/src/formats/runDirectory.ts` (`releases` and the upgrade to latest), and add the three modules to `CLOSURE_SRC_ALLOWLIST` in `tests/unit/architecturalGuards.test.ts`, in its sorted order.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/{run-status,phase-status,registry}/next.schema.json` and updates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`. Record the three frozen modules in `packages/schemas/history.lock.json` and update the current-shape fixtures in `tests/unit/schemasPackage/documents.ts`.
- Create `tests/helpers/phaseStatusFixture.ts`. It exports `phaseStatus(fields)`, the in-memory value with `mode: "headless"` and `stop: null` unless given, and `phaseStatusFile(fields)`, the same value stamped with `currentSchemaUrl("phase-status")`. Use it in every test that writes a phase status at the current stamp or builds a `PhaseStatus` literal. The planned edit list names those that write `currentSchemaUrl("phase-status")` or a typed literal, and `pnpm test:type` names any literal left in the optional list.

### Planned files to create

- `src/schemas/history/run-status/0.17.0.ts`
- `src/schemas/history/phase-status/0.20.0.ts`
- `src/schemas/history/registry/0.17.0.ts`
- `packages/schemas/snapshots/run-status/next.schema.json`
- `packages/schemas/snapshots/phase-status/next.schema.json`
- `packages/schemas/snapshots/registry/next.schema.json`
- `tests/helpers/phaseStatusFixture.ts`
- `tests/unit/reducerAwaitingReview.test.ts`
- `tests/unit/awaitingReviewShapes.test.ts`

### Planned files to edit

- `src/domain/state.ts`
- `src/domain/reducer.ts`
- `src/domain/events.ts`
- `src/domain/effects.ts`
- `src/domain/matrix.ts`
- `src/app/effectRunner.ts`
- `src/app/resumeInstructions.ts`
- `src/app/phaxState.ts`
- `src/app/resume.ts`
- `src/app/phaseFolder.ts`
- `src/schemas/status.ts`
- `src/schemas/registry.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/resolveRunInfo.test.ts`
- `tests/unit/resolveRunRef.test.ts`
- `tests/unit/phaseStatusUpdates.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/legacyRunFiles.test.ts`
- `tests/integration/finalReview.test.ts`
- `tests/integration/enterPhase.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/gateLogTrailer.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/reviewCodeCommand.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/telemetry/adapterFailures.test.ts`
- `tests/integration/enter.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/integration/finalReport.test.ts`
- `tests/integration/publishRun.test.ts`

### Optional files that may be edited

- `src/app/dispatcher.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/infra/providers/sessionWriter.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/registry.ts`
- `src/domain/whatsNext.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/cli/interruptHandler.ts`
- `packages/schemas/src/index.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/state.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/unit/cli/publishPr.test.ts`
- `tests/unit/cli/reviewCompliance.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`

### Boundary contracts

Reducer → effect runner: for the new transitions the reducer only emits PersistState, WriteResumeInstructions, RecordCommitMetadata, EmitTrace and the four review-stop effects. The dispatcher and the effect runner remain the only writers of run-status.json, status.json and review-stop.json. Persisted shapes → readers: every reader decodes through `src/schemas/persisted.ts`, which routes a document by its `$schema` release to the current decoder or a frozen one, and returns the latest in-memory shape. Package → consumers: `@lbdremy/phax-schemas` parses the new and frozen shapes with the same verdicts as phax.

### Test strategy

Write the reducer tests first, in `tests/unit/reducerAwaitingReview.test.ts`. They cover:
- every new transition and its effect list;
- a refused close, and an interrupted close, returning to awaiting_review with RestoreReviewStop;
- StopCommitted landing `committed` with DiscardReviewStop;
- archive with and without force (DiscardReviewStop ordered before the move);
- reset at the stop, and reset refused while a close runs;
- interrupt ignored at awaiting_review, and stale agent events.
The matrix audit in `tests/unit/reducer.test.ts` covers every new cell.
Write `tests/unit/awaitingReviewShapes.test.ts` for the readers:
- a 0.20.0 phase status decodes lifted (`mode: "headless"`, `stop: null`);
- a 0.17.0 run-status and registry still decode;
- a current status with `awaiting_review` and each `stop` variant round-trips;
- a `stop` with an unknown cause, or a missing `mode`, is refused;
- a phase status without `base` stays refused.
An effect-runner test parks, restores and discards review-stop.json in a temporary run folder. The schemas-package snapshot, frozen-history and current-shapes tests check the snapshots and the lock.

### Implementation order

1. state.ts types and the events
2. reducer arms and their unit tests
3. the matrix row and columns
4. the effects, the effect runner and the resume-instructions kind
5. the status and registry schemas, and the writers of mode and stop
6. frozen decoders, persisted readers and the package formats
7. snapshot regeneration and the history lock
8. the fixture helper and the broken test fixtures

### Excluded scope

- Any code that reaches or closes a stop (phase-04, phase-06, phase-07)
- The interrupt handler's write during a close (phase-07)
- The `hold` field, the `held` cause and the `builder` origin (plan 2)
- `phax ls` and `phax session-info` output for the new state (phase-05)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Name the exact new types, events and effects with their fields: `StopCause`, `ReviewStopReached`, `StopCloseRefused`, `StopCommitted`, `WriteReviewStop`, `ParkReviewStop`, `RestoreReviewStop` and `DiscardReviewStop`. Give the paths the effect runner resolves for review-stop.json and its parked copy. Give the persisted `stop` variants as written in `src/schemas/status.ts`, and the resume-instructions kind. List the frozen decoder modules and the snapshot files created, and the helpers in `tests/helpers/phaseStatusFixture.ts`. Note any exhaustive switch outside the planned files that had to handle the new state. Explain any deviation from the planned file lists, including any listed test that needed no change.

### Commit subject

`feat(state): add the awaiting_review run and phase state`

### Commit body

A run can now wait for a person: the reducer moves a run and its phase to
awaiting_review with cause declared, returns a refused or interrupted
close there, commits a closed stop in one event, and lets resume, reset and
a forced archive leave it. review-stop.json is written, parked, restored
and discarded only through reducer effects. run-status, phase-status and
the registry gain the state, and a phase status records its required mode
and stop. The current shapes are frozen and read lifted, with next
snapshots for the three formats.

---

## phase-03 — Pure builders for the seed, the turn prompts, the interactive handoff, the review-stop document and the continue commands {#phase-03-stop-builders}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The continue-command contract crosses the domain, the app, the CLI output and three provider CLIs, and its argv depends on an open security question, so it needs more care than the default effort.

Provide the pure domain logic of a declared stop:
- the seed text and the first and closing turns' prompts;
- the interactive handoff's validation and rendering;
- the worktree-change verdict;
- the review-stop document and the `## Review corrections` section;
- the quoted command line.
Also give each provider adapter its interactive resume support and its continue and fresh-start commands, carrying the phase's posture.

### Detailed instructions

- Create `src/domain/interactive/seed.ts` with `buildDeclaredSeed(input)`. Its input:
  - the run's short name and the phase id and title;
  - the phase's Detailed instructions;
  - the executed phases' handoffs in plan order (`{ id, title, text }`);
  - the upcoming phases' plan sections in plan order;
  - the gate commands and the close command.
  It returns the markdown of the spec's §6 declared seed:
  - a title, and why the run stopped, naming the later phases;
  - `## What is expected of you`: correct the pattern, add a guard per correction, keep the scope, and optionally write `.phax-context/correction-handoff.md` in the four sections;
  - `## What to review`, `## Executed phases`, `## Upcoming phases`;
  - `Full plan: .phax-context/plan.md`;
  - `## Gate`;
  - `## Close the phase`, with the close command, run from the main checkout.
  It never tells an agent how to stop a run.
- Create `src/domain/interactive/turnPrompts.ts`:
  - `firstTurnPrompt({ seedPath, schemaJson })`;
  - `correctivePrompt(defect)`, for the one corrective resume after an invalid answer;
  - `closingTurnPrompt({ diff, seedPath, schemaJson })`, where `diff` is `{ text, truncated, paths }` and `seedPath` is null on a resumed session and set on a new one;
  - `freshStartPrompt(phaseId)`, which returns `Read .phax-context/interactive-review.md, then review <phase> with me.`;
  - `CLOSING_DIFF_LIMIT_BYTES = 200_000` and `cutDiff(text, paths)`.
  Every turn prompt tells the session to change nothing and to answer only a document valid against the given schema. None mentions stopping a run.
- Create `src/domain/interactive/firstReading.ts` with `renderFirstReading(doc)`, which returns the markdown of `first-reading.md`: the pattern at stake, what each upcoming phase copies, and what to check.
- Create `src/domain/interactive/handoff.ts`:
  - `INTERACTIVE_HANDOFF_SECTIONS`: `## What was corrected`, `## The pattern to follow from now on`, `## Guards` and `## What the next phases need to know`.
  - `validateInteractiveHandoff(markdown)` returns the validated text, or a list of defects: a missing section, a section out of order, or a count mismatch. `## Guards` must hold exactly one list entry per `## What was corrected` entry, in order, each naming a ref or starting `no guard:`.
  - `renderInteractiveHandoff(answer)` renders an interactive-handoff document in those sections, with a `none` guard as `no guard: <reason>`.
  - `REVIEWED_WITHOUT_CHANGE_HANDOFF` is the fixed text for an unchanged stop, and itself passes validation.
- Create `src/domain/interactive/worktreeChange.ts` with `worktreeChangeVerdict({ before, after, changed, personHandoffBefore, personHandoffAfter })`. `before` and `after` are snapshot tree ids, `changed` is the name-status list between them, and each `personHandoff*` is a sha256 or null. It returns `{ kind: "unchanged" }`, or `{ kind: "changed", paths, personHandoff }`, where `paths` is sorted and never empty, and holds no path under `.phax-context/` except `.phax-context/correction-handoff.md` when the person's handoff file changed, and `personHandoff` is `"unchanged" | "created" | "modified" | "deleted"`. Any change to the person's handoff file makes the verdict `changed`.
- Create `src/domain/interactive/reviewStop.ts` with `buildDeclaredReviewStop(input)`, which returns the in-memory review-stop value (the shape of `src/schemas/reviewStop.ts` without `$schema`), with `closeBase: null`.
  - It takes the qualified run name, the phase (id, title, position, of), the worktree, the seed path, the first-reading path or null, the current session or null, the interactive resume support, the continue command or null, the fresh-start command and `lastClose`.
  - `enterPhase` is `phax enter-phase <run> <phase>`, `close` is `phax resume <run>` and `reset` is `phax reset-phase <run> <phase>`, each with the main checkout as `cwd` and an empty `env`.
  - `continue` is null when there is no current session or the provider is unverified.
- Create `src/domain/interactive/reviewCorrections.ts` with `renderReviewCorrectionsSection(stops)`. `stops` are `{ phaseId, handoff, changedFiles }` in plan order. It returns null when there are none. Otherwise it returns:
  - `## Review corrections`;
  - a sentence saying that a person reviewed and corrected the run at the listed phases, that this section wins where it disagrees with an earlier handoff, and that the phase's own plan section still binds;
  - `### <phase> (interactive)` per stop, with its handoff verbatim and its changed files.
- Create `src/domain/interactive/commandLine.ts` with `renderCommandLine({ cwd, argv, env })`, which returns `cd <cwd> && [NAME=value …] <argv>` with every word POSIX single-quoted (an embedded `'` written as `'\''`).
- Create `src/domain/security/postureToPolicy.ts` with `policyFromPosture(posture)`. It rebuilds the phase's `SecurityPolicy` from the `SecurityPosture` in its `security.json`: mode, filesystem, network, mcp, and the agent commands from their records, with `failClosed` set as `resolveSecurityPolicy` sets it for that mode.
- In `src/domain/session/types.ts`, add three members to `SessionAdapter`:
  - `interactiveResume: "verified" | "unverified"`;
  - `buildContinueCommand(opts)`;
  - `buildFreshStartCommand(opts)`.
  Both builders return `StopCommand = { executable, args, cwd, env }`, or `{ unsupported }`. Their options are: `cwd`; `sessionId` (continue only); `model` (the resolved concrete model); `effort`; `posture`, either the phase's `SecurityPolicy` and frozen agent commands or `none`; and `prompt` (fresh start only). Implement only the operator's verdict on q-continue-approvals.
- Claude Code (`src/domain/session/claude.ts`) is `verified`.
  - Continue is `claude --resume <id> --model <model> --effort <effort>`, then the posture flags. Under provider-prompts, those are `claudePermissionFlags` of the phase's policy unchanged. Under sealed, `--permission-mode dontAsk` with the phase's `--add-dir` and `--allowedTools` extended with `Edit` and `Write`.
  - Fresh start is the same without `--resume`, ending `-- <prompt>`.
  - With posture `none`, no permission flags are added.
  - No skill-edit grant settings are ever added.
- codex (`src/domain/session/codex.ts`) is `verified`.
  - Move `buildCodexSecurityFlags` and `mapReasoningEffort` from `src/infra/providers/codexCli.ts` into a new pure `src/domain/session/codexFlags.ts`, and make codexCli import them. Its headless argv must stay byte-identical.
  - Move the model id lookup there too, as `codexModelId(entry, model)`: the provider entry's first `openai-gpt` model id when `providers.json` names one, else the resolved model. `buildCodexArgs`, `buildCodexCompletionArgs` and the callers of the continue and fresh-start builders all use it, so a continued session runs the model the headless phase ran.
  - Continue is `codex resume <id> -m <model> -c model_reasoning_effort="<effort>"`, then the posture flags. Under provider-prompts, `approval_policy` is `"on-request"`; under sealed, it is `"never"`. An unsafe posture keeps `--dangerously-bypass-approvals-and-sandbox`.
  - Fresh start is `codex -m <model> -c model_reasoning_effort=… <posture flags> <prompt>`.
  - Leave `buildResumeInvocation` and `describe` unchanged. `phax enter` (`src/cli/commands/enter.ts`) uses them, and this plan does not change `phax enter`; phase-05 moves `phax enter-phase` to the continue command.
- mistral-vibe (`src/domain/session/mistral.ts`) is `unverified`.
  - `buildContinueCommand` answers `unsupported`, naming `vibe --resume <session-id>` as unverified.
  - Fresh start is `vibe --workdir <cwd>`, then the posture's `--add-dir` flags, then the prompt, with `env: { <modelEnvVar>: <model> }`. `modelEnvVar` is an option that defaults to `VIBE_ACTIVE_MODEL`.
  - `buildResumeInvocation` keeps its unsupported answer.

### Planned files to create

- `src/domain/interactive/seed.ts`
- `src/domain/interactive/turnPrompts.ts`
- `src/domain/interactive/firstReading.ts`
- `src/domain/interactive/handoff.ts`
- `src/domain/interactive/worktreeChange.ts`
- `src/domain/interactive/reviewStop.ts`
- `src/domain/interactive/reviewCorrections.ts`
- `src/domain/interactive/commandLine.ts`
- `src/domain/security/postureToPolicy.ts`
- `src/domain/session/codexFlags.ts`
- `tests/unit/interactive/seed.test.ts`
- `tests/unit/interactive/turnPrompts.test.ts`
- `tests/unit/interactive/handoff.test.ts`
- `tests/unit/interactive/worktreeChange.test.ts`
- `tests/unit/interactive/reviewStop.test.ts`
- `tests/unit/interactive/reviewCorrections.test.ts`
- `tests/unit/interactive/commandLine.test.ts`
- `tests/unit/continueCommands.test.ts`

### Planned files to edit

- `src/domain/session/types.ts`
- `src/domain/session/claude.ts`
- `src/domain/session/codex.ts`
- `src/domain/session/mistral.ts`
- `src/infra/providers/codexCli.ts`
- `tests/unit/sessionAdapters.test.ts`

### Optional files that may be edited

- `src/domain/session/index.ts`
- `src/domain/session/claudePermissionFlags.ts`
- `src/infra/fakes/session.ts`

### Boundary contracts

Domain → app: every builder is pure and takes plain values. The app supplies the handoff texts, plan sections, snapshots, postures and resolved models, which it reads through ports. Domain → provider CLIs: each adapter's argv is the provider's own CLI form. `claude --resume` and `codex resume` are verified; vibe's interactive resume is never built. Infra codexCli → domain codex flags: the headless argv stays byte-identical after the move.

### Test strategy

Unit tests only, written before the builders.
- Seed: every section the spec lists, in order, for the made-up invoice-export plan, and no text about stopping a run.
- Prompts: each says to change nothing and to answer only the schema. A diff over the limit is cut, marked as cut, and lists every path.
- Handoff: each defect (a missing `## Guards`, sections out of order, three corrections with two guards) and a valid handoff. Both the rendered answer and the fixed text validate.
- Worktree verdict: unchanged; changed; `.phax-context/` filtered; a created or modified person's handoff file read as a change, with its path in `paths`, so a turn that only writes it gives exactly `.phax-context/correction-handoff.md`.
- Review-stop: `continue` is null with no session and with an unverified provider; the enterPhase, close and reset argv.
- Review corrections: none gives null; two stops keep plan order; the precedence sentence is present.
- Command line: quoting of spaces, quotes and env.
- Posture to policy: round-trips a secure and an unsafe posture.
In `tests/unit/continueCommands.test.ts`:
- the claude and codex argv carry the model, the effort and the posture flags of the decided approval policy, and codex's model comes from `codexModelId`;
- posture `none` carries none;
- vibe's fresh start carries the env and the prompt, and vibe's continue is unsupported.
The existing codexCli argv tests must pass unchanged.

### Implementation order

1. handoff validation and rendering
2. the seed, the turn prompts and the first-reading rendering
3. the worktree verdict and the review-stop builder
4. the review corrections section and the command line
5. posture to policy and the codex flags move
6. the session adapters and their argv tests

### Excluded scope

- Writing any file, spawning any session or running git (phase-04 to phase-07)
- Switching `phax enter-phase` to the continue command (phase-05)
- The held seed, the builder origin and a correction handoff beside a builder's handoff (plan 2)
- Transcript capture and its session-store lookup (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List every exported function and constant with its module path under `src/domain/interactive/`, `src/domain/security/postureToPolicy.ts` and `src/domain/session/`. Give the new `SessionAdapter` members with their option and return shapes. Say which q-continue-approvals verdict the argv implements, and give the exact argv per provider for a secure posture. Confirm that codexCli's headless argv is unchanged and that `buildResumeInvocation` and `describe` are untouched. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): add the declared stop's pure builders and continue commands`

### Commit body

The seed, the first and closing turn prompts, the interactive handoff's
validation and rendering, the worktree-change verdict, the review-stop
document, the Review corrections section and a quoted command line are
pure domain functions. Each provider declares its interactive resume
support and builds its own continue and fresh-start commands, carrying the
phase's posture rebuilt from security.json; codex's flag builder moves to
the domain with its headless argv unchanged.

---

## phase-04 — Reaching a declared stop: worktree snapshots, the read-only first turn, the seed, review-stop.json and exit 13 {#phase-04-declared-stop}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase adds Git capabilities that no adapter in the repository shows yet (snapshots and restores through temporary indexes seeded from HEAD) and a use case crossing git, the backend, files and the reducer.

Add the use case that stops a run at a declared interactive phase. It writes the seed and runs one read-only first turn. A turn that edits the worktree, or the person's handoff file, is refused and restored without losing anyone's edit. The use case records the session and the first reading, moves the run to `awaiting_review` through the reducer (which writes review-stop.json), and its caller exits 13. It is tested at the use-case level; executePlan does not call it yet, because lint and the run preflight still refuse interactive phases.

### Detailed instructions

- The Git port (`src/ports/git.ts`), the Node adapter (`src/infra/git.ts`) and the fake (`src/infra/fakes/git.ts`) gain four operations:
  - `headTree(path)`: `git rev-parse HEAD^{tree}`.
  - `snapshotWorktree(path)`: in a temporary index file (`GIT_INDEX_FILE` in a temporary directory, removed afterwards), run `git read-tree HEAD`, then `git add -A -- . ':(exclude).phax-context'`, then `git write-tree`, and return the tree id. It never touches the real index.
  - `changedPathsBetween(path, fromTree, toTree)`: name-status entries from `git diff-tree -r --name-status --no-renames`.
  - `restorePaths(path, tree, paths)`: in another temporary index, run `git read-tree <tree>`, then `git checkout-index -f -- <each path present in tree>`, and delete each path absent from the tree. It never touches the real index, ignored files or `.phax-context/`.
- codex read-only, in `src/infra/providers/codexCli.ts`: when `AgentRunOptions.readOnly` is true, both `exec` and `exec resume` use `-c sandbox_mode="read-only"` and `-c approval_policy="never"`, with no writable roots and no network override, whatever the policy (unsafe included). Claude Code already honours `readOnly` with `claudeReadOnlyFlags`. A read-only turn carries no posture flag beyond its provider's read-only set: that set is narrower than any phase posture, which is how phax's turns meet §5.26.
- Apply the operator's decision on q-turn-shell: with `no-shell`, phax's turns pass no agent commands; with `phase-commands`, they pass the phase's frozen agent commands. Apply q-vibe-turns:
  - `phase-posture`: a vibe turn runs under the phase posture, guarded by the comparison and the handoff-file check.
  - `plan-agent`: `src/infra/providers/mistralVibe.ts` maps `readOnly` to `--agent plan`.
  - `refuse-vibe`: `stopAtDeclaredPhase` refuses a phase resolved to mistral-vibe, and phase-07 adds the run-preflight refusal.
- Create `src/app/interactiveFiles.ts`, which goes through the FileSystem port:
  - the seed paths: `.phax-context/interactive-review.md` in the worktree and `review-seed.md` in the phase folder;
  - reading and writing `interactive-session.json`, stamped with `withSchemaUrl` and read with `readInteractiveSessionFile`;
  - writing `first-reading.md`;
  - the sha256 fingerprint of `.phax-context/correction-handoff.md` with a copy of its bytes, or null when absent;
  - copying a refused turn's versions of its changed paths to `<phase folder>/refused-turn-NN/`;
  - reading review-stop.json from the run folder or its parked copy;
  - `refreshReviewStop`, used only by `--new-session` while the file exists.
- Create `src/app/interactiveStop.ts` with `runFirstTurn(input)`. Its input: the run and phase folders, the worktree, the phase, the resolved provider, model and effort, the policy, the agent commands and `origin`. The turn number NN is one past the highest `first-turn-NN.jsonl` in the phase folder. A `turnInProgress` left by an interrupted or crashed turn is settled first: snapshot, compare with its before-tree, keep and restore any change as below, and record that turn as `refused-change`, or as `failed` with reason `interrupted` when nothing changed. In order:
  1. Fingerprint the person's handoff file and snapshot the worktree, then record the turn as `turnInProgress`.
  2. Run `Backend.runAgent` with `firstTurnPrompt`, `readOnly: true` and output `first-turn-NN.jsonl`, wrapped in `withInvocationCost` with role `first-turn`.
  3. Decode the final message with `parseFinalMessageJson` and `readFirstReadingAnswer`. On an invalid answer, run one corrective `resumeAgentSession` to `first-turn-NN-retry.jsonl`.
  4. Snapshot and fingerprint again, and compute `worktreeChangeVerdict`.
  Step 4 and the outcome run whatever the turn's outcome, a failure included (an Effect finalizer). Then record the outcome:
  - A change keeps the turn's versions in `refused-turn-NN/`, restores the worktree with `restorePaths` (the person's handoff file is restored from its copy, or deleted when the turn created it; `restorePaths` never gets its path), records `refused-change` with the paths and `keptAt`, and keeps no session.
  - A rate or usage limit, a provider error, or a still-invalid answer records `failed` with its reason and keeps no session.
  - `answered` makes the session current (moving the previous current one into `history`) and writes `first-reading.md`.
  Every outcome rewrites the worktree seed from its run-folder copy and writes `interactive-session.json` with `turnInProgress: null`. The session id always comes from the turn's stream (`AgentRunResult.sessionId`), never from `--session-id`.
- In the same module, add `stopAtDeclaredPhase(input)`, for a phase whose worktree, setup commands, `.phax-context/plan.md`, `model-resolution.json` and `security.json` are already in place. It takes the run identity, the run path, the main checkout path, the plan phases, the phase and its index, the phase folder, the worktree, the resolved provider, model and effort, the policy, the agent commands, the gate commands, the located plan sections and the executed phases' handoffs (read from `<run>/<phase>/phase-handoff.md`). In order:
  1. Build the seed with `buildDeclaredSeed` and write both copies.
  2. Run `runFirstTurn` with origin `first-turn`.
  3. Build the continue command (when there is a current session and the provider is verified) and the fresh-start command with the adapters, with the posture from the policy.
  4. Build the review-stop value with `buildDeclaredReviewStop`.
  5. Dispatch `ReviewStopReached` with cause `declared` and that value.
  It returns a stop report: the review-stop value and its path, the first-reading markdown or null, the first-turn failure or refusal (with `keptAt`) or null, and whether the provider is unverified. It never reads stdin.
- Add `AwaitingReviewStopError` (run, phase, the stop report) to `src/domain/errors.ts`. In `src/cli/commands/runLayers.ts`, map it to exit 13 and add `{ code: 13, meaning: "Awaiting review at an interactive phase (resumable)" }` to `EXIT_CODE_MEANINGS`. Add row 13 to README.md §Exit codes, then run `pnpm gen:usage-spec` and `pnpm docs:cli` so the drift tests stay green.
- Create `tests/helpers/fakeProviderCli.ts`, which writes executable Node scripts named `claude` and `codex` into a temporary bin directory.
  - Each appends `{ argv, cwd }` as a JSON line to a log file named by an environment variable.
  - Each prints a canned stream: Claude's stream-json init, assistant message and result; codex's `--json` thread, item and turn events. The final text and the session id come from a JSON script file.
  - Each can be told to write a file in its cwd, or to report a rate limit.
  Tests prepend the bin directory to PATH (phax spawns `claude` by name), point the codex provider entry's `executable` at it, and set HOME to a temporary directory.
- Do not call `stopAtDeclaredPhase` from `src/app/executePlan.ts`, and do not change the `interactive` lint check or the run preflight's refusal of interactive phases.

### Planned files to create

- `src/app/interactiveFiles.ts`
- `src/app/interactiveStop.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/integration/gitWorktreeSnapshot.test.ts`
- `tests/integration/declaredStop.test.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/unit/codexReadOnlyArgs.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/infra/providers/codexCli.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `README.md`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/infra/fakes/backend.ts`
- `src/infra/providers/mistralVibe.ts`
- `src/infra/providers/claudeCode.ts`
- `src/app/costLedger.ts`
- `docs/cli/inventory.md`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/usageSpecDrift.test.ts`

### Boundary contracts

App → Git port: the stop compares and restores a worktree only through the snapshot, diff and restore operations, all on temporary indexes. App → Backend port: a first turn is `runAgent` with `readOnly: true`, and its session id comes from the stream. A read-only mode narrows the turn, but the before/after comparison and the handoff-file check always guard it. App → reducer: the stop transitions only by dispatching `ReviewStopReached`, whose effects write review-stop.json and resume-instructions.md. Use case → CLI: `AwaitingReviewStopError` carries the stop report, which the run and resume commands render in phase-07.

### Test strategy

Write `tests/integration/gitWorktreeSnapshot.test.ts` first, against a temporary repository (`tests/helpers/tempGit.ts`):
- the snapshot leaves out `.phax-context/` and untracked ignored files;
- a tracked file matching an ignore pattern keeps an unchanged snapshot equal to HEAD's tree;
- a modified, an added and a deleted file each change the tree;
- the real index's staged content is unchanged after a snapshot and after a restore;
- restore brings the listed paths back and leaves other paths, ignored files and `.phax-context/` alone.
`tests/unit/codexReadOnlyArgs.test.ts` covers the read-only `exec` and `exec resume` argv.
`tests/integration/declaredStop.test.ts` drives `stopAtDeclaredPhase` with the fake backend on a temporary repository and the made-up invoice-export plan:
- A valid first turn: the session is current with origin `first-turn`, `first-reading.md` is written, both seed copies are identical and hold every §5.19 part, and `readOnly` is passed.
- review-stop.json holds `$schema` (by format id and release pattern), cause `declared`, phase-03, the worktree, the seed, the session, a `continue` command naming it, and the `enterPhase`, `close` and `reset` commands.
- The run and phase are `awaiting_review` with cause `declared`, and `resume-instructions.md` is written.
- A turn that edits a file is restored and kept in `refused-turn-01/`, recorded `refused-change` with no session, and gets the fresh-start command only.
- A turn that writes `.phax-context/correction-handoff.md` is refused as `refused-change` naming that path, and the file is removed.
- A turn interrupted after it edited a file is settled on the next call: the edit is kept in `refused-turn-01/` and restored, that turn is recorded `refused-change`, and the new turn writes `first-turn-02.jsonl`.
- A rate limit, a provider error, and two answers without `$schema` each record `failed` with no session, with exactly one corrective resume in the last case.
- A mistral-vibe phase gets the unverified flag and no `continue`.
- No stdin is read.
`tests/integration/declaredStopProviderArgv.test.ts` runs the first turn through the fake `claude` and `codex` CLIs with the real backend. The test asserts the whole claude argv: `--permission-mode default`, `--tools Read,Grep,Glob` (or the shell rules, per q-turn-shell), `--strict-mcp-config` and the phase's model and effort, with no `--add-dir` and no other posture flag. The codex argv carries `sandbox_mode="read-only"`, with no writable roots and no network override. A runLayers test maps the error to 13.

### Implementation order

1. the Git port operations, with their integration tests
2. codex read-only argv
3. interactiveFiles
4. runFirstTurn
5. stopAtDeclaredPhase
6. the fake provider CLIs and the argv tests
7. the error, exit code 13, the README row and usage regeneration

### Excluded scope

- Wiring the stop into executePlan, or lifting the interactive refusal (phase-07)
- Rendering the stop's output in `phax run` and `phax resume` (phase-07)
- enter-phase, ls, session-info, reset-phase, archive and adjust-plan at a stop (phase-05)
- The closing turn, the diff of contents and the commit (phase-06)
- The held stop (plan 2); transcripts, posture records and estimates (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the exact signatures of `headTree`, `snapshotWorktree`, `changedPathsBetween` and `restorePaths`; of `runFirstTurn` and `stopAtDeclaredPhase` in `src/app/interactiveStop.ts`; and of the helpers in `src/app/interactiveFiles.ts`. Give the shapes of the stop report and `AwaitingReviewStopError`, and how to drive `tests/helpers/fakeProviderCli.ts`. Say how the q-turn-shell and q-vibe-turns decisions were applied. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): stop a run at a declared phase after a read-only first turn`

### Commit body

stopAtDeclaredPhase writes the seed, runs one read-only first turn that
is refused and restored if it edits the worktree or the person's handoff
file, keeping the turn's versions aside, records its session and first
reading, and moves the run to awaiting_review, whose effect writes
review-stop.json. Worktree snapshots and restores go through temporary
indexes behind the Git port, seeded from HEAD; codex honours read-only
turns. Exit 13 joins the exit table. Not wired into runs yet: the
interactive refusal stays.

---

## phase-05 — Commands on a stopped run: enter-phase, ls, session-info, path, reset, archive and adjust-plan {#phase-05-commands-while-stopped}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase reworks eight commands around a new state and moves enter-phase's logic into a use case that reuses the first turn under the run lock, so it needs more care than the default effort.

Make a run in `awaiting_review` visible and workable from the CLI:
- `phax ls` and `phax session-info` show it as waiting, with its cause and stopped phase, and `phax ls --awaiting-review` filters it;
- `phax path`, `phax shell` and `phax open` target the stopped worktree;
- `phax enter-phase` continues the current session or starts a fresh one, `--new-session` runs a new first turn under the run lock, and a headless codex phase resumes interactively;
- reset-phase, archive and adjust-plan treat the stop correctly.

### Detailed instructions

- The Session port gains a required `env`: `SessionOps.resume({ executable, args, cwd, env })`. Its other callers pass `env: {}`: `src/cli/commands/enter.ts`, `src/cli/commands/reviewCode.ts`, `src/cli/commands/adjustPlan.ts` and `src/app/decideArtifact.ts`. `src/infra/session.ts` merges a non-empty `env` over `process.env`. With an empty one it spawns with today's options (`{ cwd, stdio: "inherit" }`), which the existing spawn assertions expect. The fake records `env`.
- Create `src/app/enterPhase.ts` with the enter-phase use case, and make `src/cli/commands/enterPhase.ts` a thin caller: it renders the result's notices through the OutputPort, then spawns its command through the Session port. The use case handles five cases:
  - **The stopped phase of a run in `awaiting_review`.** Read the stop with `src/app/interactiveFiles.ts`, the provider, model and effort from `model-resolution.json`, and the policy from `security.json` (`policyFromPosture`). With `newSession`, first acquire the run lock (Lock port, the run's key) and read the run's state again under it: a run that is no longer `awaiting_review` (a close started meanwhile) releases the lock and is refused as in the next case. Then run `runFirstTurn` with origin `new-session`, refresh review-stop.json when it answers, and release the lock. Then return the continue command when a session is current and its provider is verified, and the fresh-start command otherwise, with the notices: the first-turn outcome, the unverified warning, the codex trust note, and the `refused-turn-NN/` folder.
  - **A phase in `awaiting_review` whose run is not.** Refuse with exit 1, naming the close in progress and `phax resume <run>`.
  - **A closed interactive phase.** Continue its current recorded session from `interactive-session.json` when its provider is verified, or refuse, naming why.
  - **A headless phase.** Read its `agent-binding.json` and build `buildContinueCommand` with the binding's session, model and effort. Under q-enter-phase-posture `carry-posture`, it carries the posture from `security.json` and refuses when that file is missing or unreadable. Under `provider-defaults` it carries none. codex resumes with `codex resume <id>` (§5.42), its model id from `codexModelId`; vibe stays unsupported.
  - **`--new-session` on a phase that is not stopped.** Refuse with exit 1, naming the phase's state.
- Leave `buildResumeInvocation`, `describe` and `phax enter` (`src/cli/commands/enter.ts`) unchanged. `phax enter` is outside the spec, and `tests/integration/enter.test.ts` expects a codex binding to exit 1 as unsupported. enter-phase builds every command, codex's resume included, with the continue and fresh-start builders. `src/app/enterPhase.ts` exports `planEnterPhase(input)`, which returns the command and its notices, or the refusal, without spawning. `phax session-info` takes its `Resume:` line and its suggested `phax enter-phase` from `planEnterPhase`, never from `buildResumeInvocation`, so a headless codex phase reads as enterable.
- Add `--new-session` to `enter-phase` and `--awaiting-review` to `ls` in `src/cli/program.ts`, and describe both in `src/cli/cliDocs.ts`. Regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and the CLI docs with `pnpm docs:cli`.
- Create `src/app/stopInfo.ts` with `readStopInfo(info)`. It returns null for a run that is not `awaiting_review`. Otherwise it returns `{ cause, phaseId, phaseTitle, position, of, worktree, seed, session | null, enterPhase }`, read from review-stop.json through the readers. `ls` and `session-info` take everything they print about a stop from it.
- In `src/cli/commands/ls.ts`:
  - `--awaiting-review` lists only runs in `awaiting_review`;
  - in the text table, a waiting run's state reads `awaiting_review (declared)`, and its PHASE column appends the stopped phase id (for example `3/6 phase-03`);
  - leave `phax ls --json` as it is (plan 3 versions it).
- In `src/cli/commands/sessionInfo.ts`, for a run in `awaiting_review`, print from `readStopInfo`: the state with its cause, the stopped phase (mode interactive), its worktree, the seed path, and the current session (provider, id, origin) with `phax enter-phase <run> <phase>`, or `none`.
- path, shell and open already target the highest-index phase's worktree (`src/app/resolveRunInfo.ts`), which is the stopped phase. Add tests that prove it with a fake shell and a fake editor, and change code only if a test fails.
- Reset at a stop, in `src/app/resetPhase.ts` and `src/cli/commands/resetPhase.ts`:
  - When the target is the stopped phase of a run in `awaiting_review`, the preview printed without `--yes` names every uncommitted correction (`snapshotWorktree` against `headTree`, then `changedPathsBetween`, shown as `M`/`A`/`D` lines). It says that `phax resume` will set the phase up again and stop there.
  - With `--yes`, today's reset runs. `PhaseResetRequested` discards review-stop.json. The phase folder is renamed to `.reset-<stamp>`, taking `interactive-session.json`, `first-reading.md`, `review-seed.md` and the turn streams with it. The worktree and the phase branch are removed.
  - When the target comes before the stopped phase, refuse in the app before any dispatch, naming the stopped phase to reset first, and change nothing.
- Archive: the reducer already refuses `awaiting_review` without `--force`. Make the refusal name the state and the flag, and test that `--force` archives the run with no review-stop.json left, and with the worktree, holding any uncommitted corrections, moved to the archive.
- In `src/app/adjustPlan.ts`, refuse `--landed` on a run in `awaiting_review` before any session starts, naming the run's state.
- The phase guard (`src/domain/security/phaseGuard.ts`) is unchanged. Add a test that `phax resume` and `phax enter-phase`, run inside a stopped phase's worktree, are refused with the phase-guard message, and that the run stays `awaiting_review`.
- Build the fixtures for a stopped run by calling `stopAtDeclaredPhase` (`src/app/interactiveStop.ts`) with the fake backend on a temporary repository. Use the made-up invoice-export run (stopped) and credit-notes run.

### Planned files to create

- `src/app/enterPhase.ts`
- `src/app/stopInfo.ts`
- `tests/integration/enterPhaseStop.test.ts`
- `tests/integration/stoppedRunCommands.test.ts`

### Planned files to edit

- `src/ports/session.ts`
- `src/infra/session.ts`
- `src/infra/fakes/session.ts`
- `src/cli/commands/enter.ts`
- `src/cli/commands/reviewCode.ts`
- `src/app/decideArtifact.ts`
- `src/cli/commands/enterPhase.ts`
- `src/cli/commands/ls.ts`
- `src/cli/commands/sessionInfo.ts`
- `src/cli/commands/resetPhase.ts`
- `src/app/resetPhase.ts`
- `src/app/adjustPlan.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/integration/enterPhase.test.ts`
- `tests/unit/cli/enterPhase.test.ts`
- `tests/integration/sessionInfo.test.ts`
- `tests/integration/resetPhase.test.ts`
- `tests/integration/archive.test.ts`
- `tests/integration/adjustPlan.test.ts`
- `tests/unit/cli/ls.test.ts`
- `src/cli/commands/adjustPlan.ts`

### Optional files that may be edited

- `src/app/archive.ts`
- `src/cli/commands/archive.ts`
- `src/cli/commands/path.ts`
- `src/cli/commands/shell.ts`
- `src/cli/commands/open.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/interactiveFiles.ts`
- `src/app/interactiveStop.ts`
- `src/cli/cliCompleters.ts`
- `docs/cli/inventory.md`
- `README.md`
- `tests/integration/phaseGuard.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`

### Boundary contracts

CLI → app: each command parses its arguments, calls one use case and renders its result through the OutputPort. So enter-phase's logic moves into `src/app/enterPhase.ts`, and every fact ls and session-info show about a stop comes from `src/app/stopInfo.ts`. App → Session port: an interactive continue or fresh start is spawned with the command's cwd, argv and env, and phax never parses its output. App → Lock port: `--new-session` holds the run lock only for its first turn and file writes. App → files: the stop's facts come from review-stop.json, interactive-session.json, model-resolution.json and security.json, read through `src/app/interactiveFiles.ts` and the schema readers.

### Test strategy

Integration tests use a fake Session port, a fake shell and a fake editor that record cwd, argv and env. In `tests/integration/enterPhaseStop.test.ts`, enter-phase:
- spawns `codex resume X1` in phase-03's worktree for a stop whose current session is a codex session, carrying the posture flags of the decided policy;
- spawns the fresh-start command for a stop whose first turn failed;
- spawns `codex resume X9` in phase-01's worktree for a committed headless codex phase with binding session X9, carrying the posture under carry-posture;
- refuses a run whose close is in progress.
None of these refuses as unsupported. `phax enter` on a codex binding still exits 1 as unsupported, and session-info suggests `phax enter-phase` for a committed headless codex phase. `--new-session` runs a new read-only first turn under the run lock (a held lock refuses it with exit 7, and a run whose close started before the lock was taken is refused), makes X2 current with origin `new-session` while keeping X1 in history, and refreshes review-stop.json. A failing new turn keeps X1 and review-stop.json unchanged. A vibe stop prints the warning that a fresh-start session will not be captured.
`tests/integration/stoppedRunCommands.test.ts` covers:
- ls lists the waiting run with `awaiting_review (declared)` and `phase-03`, `--awaiting-review` lists it alone, and a failed and an interrupted run do not show as waiting;
- session-info prints the state, cause, phase, worktree, seed and session;
- path, shell and open target phase-03's worktree;
- the reset preview names three uncommitted files, and `--yes` removes the worktree, the branch and the session files and discards review-stop.json;
- a reset of phase-02 is refused, naming phase-03, with nothing changed;
- archive is refused without `--force`, and with it the run is archived and no review-stop.json remains;
- adjust-plan `--landed` is refused, naming awaiting_review, and starts no session;
- the phase guard refuses resume and enter-phase inside the worktree.

### Implementation order

1. the Session port env
2. the stopInfo helper
3. the enterPhase use case, the thin CLI command and session-info's resume line
4. program flags, cliDocs and usage regeneration
5. the ls and session-info views
6. reset-phase at a stop
7. the archive and adjust-plan refusals
8. path, shell, open and phase-guard tests

### Excluded scope

- Closing the stop through `phax resume` (phase-06, phase-07)
- The versioned `phax ls --json` run list and its `stop` field (plan 3)
- Resetting a held phase's commit (plan 2)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the signature of `src/app/enterPhase.ts` and its result variants, and the shape `readStopInfo` returns. Give the exact text of the new refusals: a reset before the stop, archive without force, adjust-plan, a close in progress, and `--new-session` on a phase that is not stopped. Say how the q-enter-phase-posture decision was applied, and whether path, shell or open needed a code change. Give `planEnterPhase`'s signature, and confirm that `buildResumeInvocation`, `describe` and `phax enter`'s behaviour are unchanged. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): act on a run awaiting review from the CLI`

### Commit body

phax ls and session-info show a run awaiting review with its cause and
stopped phase, and ls --awaiting-review filters it. enter-phase continues
the stop's current session or starts a fresh one, runs a new read-only
first turn under the run lock with --new-session, and resumes codex
sessions interactively. reset-phase resets the stopped phase first and
names the corrections it would discard, archive needs --force, and
adjust-plan waits for the run to land.

---

## phase-06 — Closing a declared stop: gate first, the interactive handoff and a commit of the gated tree {#phase-06-close-stop}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs a close sequence that no code in the repository shows yet: gate, handoff, re-check and commit of a snapshotted tree through a temporary index, with a return to the stop at every step.

Add the use case that closes a declared stop. It gates the worktree first and returns a red gate to the person. It then takes the person's handoff, or a read-only closing turn's, given the corrections' content diff. It commits exactly the gated tree with an `Interactive-Phase:` trailer, or an empty commit when nothing changed, and reconciles every changed file as a review correction. Every refusal leaves the stop as it was. It is tested at the use-case level; executePlan calls it in phase-07.

### Detailed instructions

- The Git port, Node adapter and fake gain two operations:
  - `diffTrees(repo, fromTree, toTree)`: the output of `git diff-tree -p -r --no-color --no-ext-diff --no-textconv --no-renames`.
  - `commitTree(worktree, tree, subject, body)`: in a temporary index (`GIT_INDEX_FILE` in a temporary directory, removed afterwards), run `git read-tree <tree>`, then `git commit --allow-empty -m <subject> -m <body>` with that index. The repository's pre-commit and commit-msg hooks and its signing config run as they do for `commit` in `src/infra/git.ts`. Then compare the new commit's tree with `<tree>`. When a hook changed it, move the branch back with `git update-ref HEAD <old HEAD> <new>` and fail with a `GitError` naming the paths. Otherwise reset the real index to the new HEAD with `git read-tree HEAD` and return the new sha.
- In `src/app/commit.ts`, add `buildInteractiveCommitBody(opts)`: the plan's commit body, then `---` and the trailers `Run-Id`, `Short-Name`, `Phase-Id`, `Phase-Title`, `Interactive-Phase: <phase id>`, `Worktree` and `Gate-Log: <closing gate log>`, with no `Model`, `Effort` or `Session-Id`. Leave `commitPhase` and `buildCommitBody` unchanged for headless phases.
- In `src/domain/reconciliation/reconcile.ts`, add `reconcileReview(entries)`. It returns a `ReconciliationResult` whose planned and unplanned lists are empty, whose `reviewCorrections` lists every changed path (both paths of a rename) and whose `hasDeviations` is false. In `src/app/reconcilePhaseFiles.ts`, add a `review` kind that uses it, so file-reconciliation.json and .md list the stop's files as review corrections.
- Add `StopCloseRefusedError { lastClose }` to `src/domain/errors.ts`, where `lastClose` is any variant but `interrupted`: an interrupted close never raises it, so it carries no exit 130. In `src/cli/commands/runLayers.ts`, map it to its `lastClose.exitCode`.
- Create `src/app/closeStop.ts` with `closeDeclaredStop(input)`. It is called after `RunResumeRequested` has made the run `running`, with the phase still `awaiting_review` and review-stop.json parked. It reads the provider, model and effort from `model-resolution.json`, the policy from `security.json`, and the sessions from `interactive-session.json`. In order:
  1. **Close base.** When the parked document's `closeBase` is null, write HEAD into it. When it is set and HEAD has moved, check HEAD: its parent must be `closeBase`, and its message (read with `git log -1 --format=%B`, as `src/app/recordsExplain.ts` reads one) must carry this run's `Run-Id` and `Interactive-Phase: <phase>`. Then the commit landed before an interruption: rewrite `diff.patch` and skip to step 7, with outcome `unchanged` when HEAD's tree equals `closeBase`'s tree. Any other move is a `close-error` (`commit`).
  2. **Gate.** Run the phase's gate profile once with `runGates` (`src/app/gates.ts`), on its non-terminal steps, with the gate request and the next free `checks-attempt-NN.log`, and no fix loop. A red or refused step dispatches `StopCloseRefused` (`gate-failed`, with the log) and fails with exit 4.
  3. **Gated tree.** `gated = snapshotWorktree`, `head = headTree`, and the changed paths come from `changedPathsBetween`.
  4. **Handoff.** If `.phax-context/correction-handoff.md` exists, validate it with `validateInteractiveHandoff` and use it verbatim. If invalid: `handoff-invalid` with the defects, exit 1. Otherwise, with no change, use `REVIEWED_WITHOUT_CHANGE_HANDOFF` with no turn. Otherwise, run the closing turn (next instruction).
  5. **Check.** Snapshot again. On a difference from `gated`, refuse: `closing-turn-edited` (exit 5) when a closing turn ran, `worktree-changed` (exit 1) otherwise, naming the paths.
  6. **Commit.** Write the handoff to `<run>/<phase>/phase-handoff.md`. Then `commitTree(worktree, changed ? gated : head, subject, body)`, with the plan's subject and `buildInteractiveCommitBody`, and save `diffTrees(head, gated)` as `diff.patch`. Never raise `PhaseHadNoChangesError`.
  7. **Reconcile** with the `review` kind.
  8. **State.** Dispatch `StopCommitted` with outcome `corrected` or `unchanged`. Its effect discards the parked review-stop.
  No step writes the run's `phax-plan.json` or plan.md. Every failure before step 8 returns the run to the stop by dispatching `StopCloseRefused`. A listed refusal carries its own lastClose. Any other failure carries `close-error`, with its `step` and the error's message: a provider error in a new closing session, a Git, file or shell error in the gate, the commit or the close's files, or a hook that changed the committed tree. No failure dispatches `RunFailed`, and none restores or resets the worktree, so the person's corrections stay in place. A failure after `commitTree` leaves its commit, which the next close finishes through step 1.
- A closing turn records a `turnInProgress` entry before it starts, as a first turn does. When the next close finds one, a vibe closing turn (the only closing turn that can write) was interrupted: restore its edits from the before-snapshot through a temporary index, as a refused first turn's are, before the gate runs, so its edits are never committed as the person's corrections. Test it with the fake vibe CLI.
- The closing turn, in `closeDeclaredStop`:
  - Fingerprint the person's handoff file, then cut `diffTrees(head, gated)` with `cutDiff`.
  - When a session is current, run `Backend.resumeAgentSession(current.sessionId, closingTurnPrompt(diff, null), { readOnly: true, … })` to `closing-turn-NN.jsonl`, wrapped in `withInvocationCost` with role `closing-turn`.
  - With no current session, or when the resume fails for any reason but a rate or usage limit, run `Backend.runAgent` with `closingTurnPrompt(diff, seedPath)` instead: a new read-only session of the phase's provider, model and effort. A provider error in that session is a `close-error` (`closing-turn`), exit 5.
  - A rate or usage limit is refused as `limit` with the reset time, exit 8.
  - Decode the answer with `readInteractiveHandoffAnswer`, with one corrective resume to `closing-turn-NN-retry.jsonl`. Still invalid: `closing-answer-invalid`, exit 5.
  - Render the answer with `renderInteractiveHandoff`.
  - After the turn, a changed person's handoff file is moved to `refused-turn-NN/`, and the close refuses with `closing-turn-edited`. Rewrite the worktree seed from its run-folder copy.
  - The q-turn-shell and q-vibe-turns decisions apply as they do to first turns.
- Return a close report: the outcome, the commit sha, the handoff source (`person`, `closing-turn-resumed`, `closing-turn-new` or `unchanged`), the gate log, the gate steps' results and the changed paths.

### Planned files to create

- `src/app/closeStop.ts`
- `tests/integration/gitCommitTree.test.ts`
- `tests/integration/declaredStopClose.test.ts`

### Planned files to edit

- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/app/commit.ts`
- `src/domain/reconciliation/reconcile.ts`
- `src/app/reconcilePhaseFiles.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `tests/integration/declaredStopProviderArgv.test.ts`
- `tests/unit/reconciliation/reconcile.test.ts`

### Optional files that may be edited

- `src/app/gates.ts`
- `src/app/interactiveStop.ts`
- `src/app/interactiveFiles.ts`
- `src/infra/fakes/backend.ts`
- `src/app/costLedger.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/integration/gateLogTrailer.test.ts`

### Boundary contracts

App → Git port: the close commits only through `commitTree`, with a tree id it snapshotted, never `git add -A`, and through `git commit`, so the repository's hooks and signing apply. The corrections reach the closing turn only through `diffTrees`. App → Backend port: the closing turn resumes the current session read-only, or starts a new read-only session, and its answer is decoded at the boundary. App → reducer: the close transitions only through `StopCloseRefused` and `StopCommitted`. Close → reconciliation: the stop's files reach every reconciliation reader as `reviewCorrections`.

### Test strategy

Write `tests/integration/gitCommitTree.test.ts` first, against a temporary repository whose config names `Ada Example`:
- `commitTree` commits exactly the given tree, with HEAD as parent and Ada Example as author;
- it advances the checked-out branch and leaves the index at the new HEAD;
- it runs the repository's pre-commit and commit-msg hooks: a pre-commit hook that exits 1 fails it with HEAD and the real index unchanged, and one that rewrites and stages a file fails it with the branch back at the old HEAD;
- given HEAD's own tree, it lands an empty commit;
- `diffTrees` returns the content diff of a modified, an added and a deleted file.
`tests/integration/declaredStopClose.test.ts` drives `closeDeclaredStop` on stops built with `stopAtDeclaredPhase` and the fake backend:
- the gate runs before any turn;
- a closing turn resumes X1 read-only with the content diff, and its answer is rendered to `phase-handoff.md`;
- the commit carries the plan's subject and body, `Interactive-Phase: phase-03`, no `Session-Id`, Ada Example as author, and no `.phax-context/` path;
- a person's handoff file is used byte for byte, with no turn;
- with no change, an empty commit lands, the outcome is `unchanged`, and the exit is never 9;
- with no session, or with a resume that reports the session not found, a new session gets the seed and the diff;
- a vibe stop's close is a headless resume of V1 on mistral-vibe;
- a red gate exits 4, keeps its log, commits nothing and returns review-stop.json with `lastClose`;
- an invalid person's file exits 1, naming the missing section or the uncovered correction;
- a closing answer invalid twice exits 5 after exactly one corrective resume;
- a closing turn that writes `src/export/labels.ts` exits 5 and leaves the file in place, and one that writes the person's handoff file has it moved aside, with its path in lastClose's `paths`;
- an edit made after the gate is refused as `worktree-changed`;
- a usage limit exits 8 with its reset time;
- a pre-commit hook that rejects the commit gives `close-error` (`commit`), exit 1, with the worktree byte-identical and no `RunFailed`; a provider error in a new closing session gives `close-error` (`closing-turn`), exit 5;
- a close whose parked `closeBase` is HEAD's parent, with HEAD the stop's `Interactive-Phase:` commit, lands `StopCommitted` with no new commit.
In every refused case the run stays `awaiting_review` and review-stop.json exists again. A corrected close lists the files under `reviewCorrections`, with no unplanned edit and `hasDeviations` false, and review-stop.json no longer exists anywhere.
§5.44: two identical stops, one corrected directly by the test and one through `src/app/enterPhase.ts` with a fake session that writes the same bytes, closed with the same person's handoff file, give commits with the same tree and equal reconciliations.
`tests/integration/declaredStopProviderArgv.test.ts` gains the closing turn through the fake `claude` and `codex` CLIs: read-only argv, with the phase's model and effort.

### Implementation order

1. diffTrees and commitTree, hooks included, with their integration tests
2. the interactive commit body
3. reconcileReview and the review reconciliation kind
4. StopCloseRefusedError and its exit mapping
5. closeDeclaredStop's close base, gate, handoff and commit sequence, and its close errors
6. the closing turn with its fallbacks and refusals
7. the close tests and the provider argv tests

### Excluded scope

- Calling the close from executePlan, the cleanup that follows and continuing to the next phase (phase-07)
- Rendering the close in `phax resume` (phase-07)
- Review corrections in later prompts (phase-07)
- The held stop's review commit (plan 2); transcripts and records (plan 3)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the signatures of `diffTrees`, `commitTree`, `buildInteractiveCommitBody`, `reconcileReview` and `closeDeclaredStop`, and the shape of its close report. Give `StopCloseRefusedError`, with each lastClose result and its exit code (the `close-error` steps included), and the exact trailer block of an interactive commit. Say how `closeBase` finishes a close interrupted after its commit, and how `commitTree` refuses a hook that changed the tree. Say where the closing turn's streams are written and how the fallback to a new session is decided. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): close a declared stop with a gated commit`

### Commit body

closeDeclaredStop runs the gate before any agent turn and returns a red
gate to the person. It takes the person's correction-handoff.md, or a
read-only closing turn given the corrections' content diff, and commits
exactly the tree the gate passed with git commit from a temporary index,
so the repository's hooks still run, with an Interactive-Phase trailer
and no agent session claimed. An unchanged stop leaves an empty commit.
Every changed file is reconciled as a review correction, and every
failure of a close returns the run to awaiting_review.

---

## phase-07 — Run and close a declared interactive phase end to end, with the interactive refusal lifted {#phase-07-run-end-to-end}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Wiring adds a new re-entry path to executePlan's resume sequence and a phase no agent builds, and it touches the run loop, the prompts, lint and the interrupt handler, which no existing code shows together.

Make a plan-declared interactive phase run end to end. `phax run` stops at it with exit 13 and prints the stop. `phax resume` closes the stop, runs the cleanup and continues in the same invocation, and later phases read the correction under `## Review corrections`. In the same commit, lint and the run preflight replace the not-yet-supported refusal with the placement and planned-work rules.

### Detailed instructions

- In `src/domain/plan/interactiveCheck.ts`, delete `unsupportedInteractiveFindings`. `interactiveFindings({ headers, phases })` reports, in order:
  - the malformed Mode lines, as today;
  - the placement rule, read from the headers: an interactive phase that is the first phase, the last phase, or directly follows another interactive phase. Messages as in the spec's §6, for example `an interactive phase cannot be the last phase (the final phase is already kept open)` and `directly follows interactive phase-03`;
  - the planned-work rule: one error per planned file to create or edit, naming the file (`plans src/export/csv.ts to edit; an interactive phase plans no work`). It reports nothing when `phases` is null.
  Pass the parsed phases from `src/app/lintPlan.ts` and the plan's phases from `src/app/runPreflight.ts`. The check id stays `interactive-phases`, the refusal heading `Interactive preflight failed: N error(s).`, and the exit 11. With q-vibe-turns `refuse-vibe`, the same check also refuses an interactive phase resolved to mistral-vibe. The `oracles` check is untouched.
- Wire `src/app/executePlan.ts`. On reaching a phase whose `mode` is `interactive`, outside a resume re-entry:
  - Create its branch, its folder (status `mode: "interactive"`), its worktree and its setup, and write `.phax-context/plan.md`, as for any phase, dispatching `PhaseStartRequested` and `WorktreeCreated`.
  - Run the same model resolution and security-posture block as a headless phase, which writes `model-resolution.json` and `security.json`. Move that block into a local helper so both paths share it.
  - Call `stopAtDeclaredPhase` and fail with `AwaitingReviewStopError`. Run no work session, gate or fix loop for the phase.
- On resume, read the start phase's status before `RunResumeRequested`, like the other re-entry markers. When it is `awaiting_review`:
  - call `closeDeclaredStop`;
  - then run the cleanup commands as for a committed phase (`CleanupStarted`, `CleanupCompleted`);
  - continue with the next phase in the same invocation, branched from the interactive phase's branch.
  The cleanup re-entry branches on the phase's `mode`. An interactive phase whose cleanup fails pauses as `cleaning_up` with no `claudeSessionId` and no `agent-binding.json`. Today's re-entry would then fail with `AgentSessionIdMissingError` or `RegistryCorruptionError`, and reset-phase refuses that state, so the run would be stuck. For an interactive phase, the cleanup re-entry needs only the recorded worktree: it reads no session id, binding or agent options, runs the cleanup commands and continues with the next phase.
  An interactive phase interrupted before its stop (status `running`) re-enters through the fresh-phase path, which reuses its branch and worktree, and `stopAtDeclaredPhase` settles the first turn left in progress.
  Add `AwaitingReviewStopError` and `StopCloseRefusedError` to the pause errors, so the top-level guard never dispatches `RunFailed` for them. Skip `writeRecordForPhase` for an interactive phase, both after its commit and on the failed-phase path.
- In `src/app/handoffInjection.ts`:
  - `readPreviousHandoff` and `readPreviousReconciliation` take the plan phases with their `mode` and skip back over interactive phases to the nearest earlier headless phase;
  - add `readReviewCorrections(runPath, phases, phaseIndex, phaseStatuses)`, which collects, in plan order, every earlier interactive phase whose status `stop.status` is `closed`: its `phase-handoff.md` and the `reviewCorrections` of its `file-reconciliation.json`.
  In `src/app/promptGeneration.ts`, append `renderReviewCorrectionsSection` after `## Previous phase handoff` when it is not null, and only then.
- Create `src/cli/commands/stopOutput.ts`, the view for a stop report, laid out as in the spec's §6 declared-stop example:
  - the cause;
  - the first reading, or the failure with its reset time, or the refused paths with their `refused-turn-NN/` folder;
  - the worktree and the seed;
  - the continue or fresh-start command (`renderCommandLine`), with the codex trust note under a codex command and the not-captured warning for an unverified provider;
  - `phax enter-phase`, `phax resume`, and the review-stop path.
  Use it in `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` on `AwaitingReviewStopError`, exiting 13. On `StopCloseRefusedError`, print the reason and that the phase stays awaiting review, and exit with its code. On a close, print the gate lines, the handoff source and `committed <hash> (corrected|unchanged)`. Neither command reads stdin at a stop, with or without a terminal, and the run lock is released before the exit.
- In `src/cli/interruptHandler.ts`, when the run is `running` and its current phase's status is `awaiting_review` (a close in progress), synchronously:
  - write run state `awaiting_review`;
  - move the parked `<run>/<phase>/review-stop.closing.json` back to `<run>/review-stop.json` with lastClose `interrupted`, keeping `closeBase`;
  - print that the stop is still waiting.
  The state written must equal the reducer's verdict for `RunInterruptRequested` on that state.
- In `src/app/finalReport.ts`, an interactive phase's row reads `<title> (interactive)` and shows `-` for its session, and its artifact links list its first-turn and closing-turn streams instead of `output.jsonl`.
- Update the tests that assert the old refusal to the new rules: `tests/unit/interactiveCheck.test.ts`, `tests/unit/runPreflight.test.ts`, `tests/integration/lintPlan.test.ts`, `tests/integration/runPreflightBeforeNaming.test.ts` and `tests/integration/resumePreflightRechecks.test.ts`. The interrupted run keeps its state and last error when its plan's last phase is interactive.

### Planned files to create

- `src/cli/commands/stopOutput.ts`
- `tests/integration/declaredStopRun.test.ts`
- `tests/integration/reviewCorrectionsPrompt.test.ts`
- `tests/unit/interruptDuringClose.test.ts`

### Planned files to edit

- `src/domain/plan/interactiveCheck.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/app/executePlan.ts`
- `src/app/handoffInjection.ts`
- `src/app/promptGeneration.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/interruptHandler.ts`
- `src/app/finalReport.ts`
- `tests/unit/interactiveCheck.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`
- `tests/unit/promptGeneration.test.ts`

### Optional files that may be edited

- `src/domain/whatsNext.ts`
- `src/app/cleanup.ts`
- `src/app/resume.ts`
- `src/app/closeStop.ts`
- `src/app/interactiveStop.ts`
- `src/app/interactiveFiles.ts`
- `src/infra/fakes/backend.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/integration/finalReport.test.ts`
- `tests/integration/executePlan.test.ts`

### Boundary contracts

executePlan → stop use cases: executePlan only decides when to stop (mode interactive) and when to close (status awaiting_review). Everything else goes through `stopAtDeclaredPhase` and `closeDeclaredStop`, which reach git, the backend and files through ports, and the state only through the reducer. Lint and the preflight share one domain check, so a lint error is the preflight's refusal. Later prompts depend on a closed stop's `phase-handoff.md`, its status `stop.status` and its reconciliation's `reviewCorrections`. CLI → view: run and resume render stops and closes only through `src/cli/commands/stopOutput.ts`.

### Test strategy

Write the check tests first, in `tests/unit/interactiveCheck.test.ts`:
- the first, last and directly-following placements;
- a planned edit naming its file, while an optional file reports nothing;
- malformed Mode lines unchanged;
- no row saying the phase cannot run yet.
The interrupted-run case also lands in the run and resume preflight tests: lint exits 1, while run and resume each exit 11 with the same error and create no run, worktree or branch.
Integration tests run executePlan with the fake backend on temporary repositories. `tests/integration/declaredStopRun.test.ts` uses a six-phase made-up invoice-export plan whose phase-03 is interactive:
- phase-01 and phase-02 commit; phase-03's worktree sits on phase-02's commit with the setup marker; the fake is spawned exactly once for phase-03, read-only and headless; no gate runs; the run ends `awaiting_review`; `phax run` exits 13, prints the §5.30 lines and releases the lock.
- A run with no TTY and an idle stdin pipe never reads stdin.
- `phax resume --yes` closes phase-03 and starts phase-04 in the same invocation. phase-04's prompt carries `## Review corrections`, `## Previous phase handoff` holds phase-02's handoff, and `phax-plan.json` and plan.md stay byte-identical.
- `phax reset-phase invoice-export phase-03 --yes`, then `phax resume --yes`, recreates phase-03 at phase-02's commit, rewrites the seed, runs a new first turn and exits 13.
- A plan with no interactive phase never stops, keeps the same prompts (no `## Review corrections`), states and exit codes, and writes `mode: "headless"` and `stop: null` on every phase status.
- A plan whose phase-02 agent ends its handoff with a question to a person never stops.
- With a `phax.json` declaring one globs bound on `src/export/**` at `claude-opus-5-5` from `medium` to `high`: an interactive phase-03 at `gpt-6-luna` `medium` gets a `models` error naming `assignments[0]`. A conforming phase-03 at `claude-opus-5-5` `high` has its first and closing turns run, through the fake `claude` CLI, with `--model claude-opus-5-5 --effort high`. The run's `cost-ledger.json` then holds exactly one `first-turn` and one `closing-turn` entry for phase-03 (§5.71).
- A cleanup command that fails after phase-03's close pauses the run with phase-03 `cleaning_up`. Once the command passes, `phax resume --yes` runs only the cleanup and starts phase-04.
- final-report.md labels phase-03 interactive with no session.
`tests/integration/reviewCorrectionsPrompt.test.ts` uses a plan whose phase-03 and phase-05 are both interactive: phase-06's prompt holds phase-03's handoff, then phase-05's, with their changed files and the precedence sentence.
`tests/unit/interruptDuringClose.test.ts` checks that the handler's write equals the reducer's verdict and that review-stop.json is restored with lastClose `interrupted`.

### Implementation order

1. interactiveCheck placement and planned-work rules, with lint and the preflight
2. executePlan wiring for the stop and the close, with the skipped record
3. the review corrections in later prompts, and the skip-back lookups
4. the stop output and the exit mapping in run and resume
5. the interrupt handler during a close
6. the final report row
7. the integration tests and the updated refusal tests

### Excluded scope

- The hold, held stops, review commits and the oracle-pair changes (plan 2)
- Transcript capture, records, posture records, the compliance presentation, the review-handoff and PR-body stop lines, and estimates (plan 3)
- Removing the oracles check's finding against an interactive phase inside a pair (plan 2)

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

Give the new `interactiveFindings` input and its exact messages. Say where executePlan calls the stop and the close, and which errors are pauses. Say how review corrections reach a later prompt, and which phase `## Previous phase handoff` and the previous reconciliation read after an interactive phase. Confirm that no record is written for an interactive phase, and give the interrupt handler's rule and how the cleanup re-entry handles an interactive phase. Explain any deviation from the planned file lists.

### Commit subject

`feat(interactive): run and close a declared interactive phase`

### Commit body

A plan may now declare an interactive phase. The run stops there after a
read-only first turn with exit 13; phax resume gates the worktree first,
commits the gated corrections with an Interactive-Phase trailer (an empty
commit when nothing changed), runs the cleanup and continues. Later phases
read the corrections under Review corrections. An interrupted close
returns to the stop. Lint and the run preflight now place interactive
phases and refuse planned work in them instead of refusing them all.

---

## phase-08 — Docs and the planning skill for the declared stop {#phase-08-docs-and-skill}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Tell planners, operators and review-UI authors how a declared interactive stop works:
- the README gains an Interactive phases section and loses its not-yet-supported wording;
- the phax-planning skill gains an interactive-phase section and loses the refusal;
- the CLI help describes the new behaviour;
- NEXT_STEPS records plan 1 of 3 as in flight.

### Detailed instructions

- In README.md, add `### Interactive phases` under `## Run a plan`, after `### When a run stops`, for the declared stop only. The README has no Resume section, so closing a stop is explained here. Use the made-up invoice-export example. Cover:
  - when a plan declares one, with the `**Mode:** interactive` line;
  - what the run does at it: worktree, seed, read-only first turn, `awaiting_review`, exit 13, no waiting for input;
  - the continue or fresh-start command, and codex's trust and hooks prompts;
  - `phax enter-phase` and `--new-session`;
  - `phax ls --awaiting-review` and `phax session-info`;
  - `phax path`, `phax shell` and `phax open` targeting the stopped worktree;
  - closing with `phax resume` from the main checkout: the gate first, a red gate returning the phase, the person's `.phax-context/correction-handoff.md` (its four sections) or a read-only closing turn, the commit of the gated tree with `Interactive-Phase:`, and an empty commit when nothing changed;
  - later phases reading `## Review corrections`;
  - `phax reset-phase` at a stop, `phax archive --force`, and `phax adjust-plan --landed` waiting;
  - `review-stop.json` for a UI.
  Say that held stops, transcripts and the records of a stop are not part of this release.
- Sweep README.md's other statements:
  - in `### Check a plan`, replace `an interactive phase is refused until a later release runs it` with the placement and planned-work rules;
  - update `### When a run stops` to name exit 13 and the stop;
  - add row 13's meaning wherever the README describes stops.
- In `.claude/skills/phax-planning/SKILL.md`, add an `## Interactive phases` section after `## Oracle phases`. It says:
  - the `**Mode:** interactive` line sits after the model, effort and Assignment reason lines;
  - declare one directly after the first phase that sets a pattern at least one later phase repeats, and never by default;
  - an interactive phase plans no file to create or edit; its optional files name what the person may touch; its Detailed instructions name what to review, the pattern at stake and the later phases that repeat it;
  - it is never the first or last phase, and never directly follows another interactive phase;
  - it is held to the assignment bounds through its optional files;
  - in this release it may not sit inside an oracle pair, and it never takes an oracle role.
  Do not mention `phax run --hold`: plan 2 adds that sentence when the hold ships.
- In the same skill, replace every statement that an interactive phase is refused or that a plan writes no Mode line: the `mode` table row, the Lint section (`any interactive declaration, which this release refuses`), the paragraph after the field table, and the headless-authoring `mode` bullet. Headless authoring writes `mode: "interactive"` only on a phase meant for review, and `mode: "headless"` everywhere else.
- In `src/cli/cliDocs.ts`, update the long help of:
  - `run` and `resume`: stopping at and closing an interactive phase, exit 13;
  - `enter-phase`: the continue command and `--new-session`;
  - `ls`: `--awaiting-review`;
  - `plans lint`: replace `so is any interactive declaration, which this release does not run yet` with the placement and planned-work rules;
  - `session-info`, `path`, `shell`, `open`, `reset-phase`, `archive` and `adjust-plan`: a run awaiting review.
  Regenerate `phax.usage.kdl` with `pnpm gen:usage-spec` and the CLI docs with `pnpm docs:cli`.
- In NEXT_STEPS.md, move `interactive-phases` from `Approved, not yet planned` to `In flight`. Record:
  - plan 1 of 3 (the declared stop) landing with this run;
  - plan 2 (the hold and the oracle-pair rules) and plan 3 (the run list, transcripts and records around a stop) as next;
  - the gaps until then: no record for a declared phase, no review inside an oracle pair until plan 2, and the cost ledger covering Claude Code turns only.
- This phase writes a `.claude/skills/` file, so the run needs `phax run --allow-skill-edits`.

### Planned files to create

- (none)

### Planned files to edit

- `README.md`
- `.claude/skills/phax-planning/SKILL.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `docs/security.md`
- `tests/unit/skills.test.ts`
- `tests/unit/authoringPrompt.test.ts`

### Test strategy

No new behaviour. The usage-spec drift, CLI-docs drift, README exit-code and skills tests check that the generated files and the docs match the CLI. Read the README section against the behaviour that `tests/integration/declaredStopRun.test.ts` and `tests/integration/declaredStopClose.test.ts` cover. Change no test expectation to fit the prose.

### Implementation order

1. cliDocs long help and regeneration
2. the README section and the stale-wording sweep
3. the phax-planning skill section and its stale-wording sweep
4. NEXT_STEPS

### Excluded scope

- docs/upgrading.md for `phax ls --json` (plan 3)
- Documenting `--hold`, held stops or the run list as available (plans 2 and 3)
- Any code change

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

List the README and skill sections added or changed, and every stale not-yet-supported statement removed, with its location. Confirm that the usage spec and the CLI docs were regenerated, that the `plans lint` help no longer calls an interactive declaration unsupported, and that the skill does not mention `--hold`. Explain any deviation from the planned file lists.

### Commit subject

`docs(interactive): document declared interactive phases`

### Commit body

The README explains a declared interactive stop from the plan line to
phax resume, including the commands that act on a waiting run; the
phax-planning skill says when and how to declare one and no longer calls
it refused; the CLI help covers exit 13, enter-phase --new-session and
ls --awaiting-review; NEXT_STEPS records plan 1 of 3 as in flight.
