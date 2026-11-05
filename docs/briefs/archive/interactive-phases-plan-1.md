Write the phax plan "Declared interactive stop" for the approved spec `docs/specs/2610211403-interactive-phases.md`. It is the first of that spec's three plans, so it carries `completes-spec: false`.
- Plan 2 adds the operator's hold (`phax run --hold`) and its oracle-pair rules.
- Plan 3 adds the review UI's run list and the records around a stop.

Read the spec in full. These are settled; do not reopen them:
- every verdict in §9b;
- the carried-over verdicts and the operator's decisions of 2026-10-21 in §10;
- the joint phase-shape decisions J1–J4.

Already landed, do not redo:
- **phase-shape (PR #151):**
  - the required `mode` key and the `**Mode:** interactive` line, its rendering and its lift (r-mode, r-mode-parse, r-mode-render, r-mode-lift);
  - the not-yet-supported refusal `unsupportedInteractiveFindings` (`src/domain/plan/interactiveCheck.ts`).

  Verify the landed requirements against their §8 criteria rather than re-implementing them.
- **oracle-phases (PRs #154–#156, complete):**
  - the oracle step in the gate loop;
  - the `oracles` check, with its §5.11 finding against an interactive phase inside a pair;
  - `phax resume --skip-oracle`;
  - `reset-phase`'s discharge rule.

In scope: a plan-declared interactive phase runs end to end. The run stops there, a person works in the worktree with any editor or agent, and `phax resume` closes the stop and continues the run. By section:
- **Lint and preflight** (§5.5–§5.10):
  - the `interactive` check replaces `unsupportedInteractiveFindings`, in lint and in the run and resume preflight (exit 11);
  - the oracles check's §5.11 finding is removed, as §10 says (the oracle-phases changes). §5.12, an interactive phase takes no oracle role, stands;
  - the planning skill's interactive section.
- **The declared stop** (§5.18, §5.19, §5.23–§5.34, §5.36–§5.38):
  - reaching the phase;
  - the seed;
  - the first turn, read-only where the provider allows it, recorded, refused if it edits, and still stopping if it fails;
  - the `awaiting_review` run and phase states, with cause `declared`;
  - exit 13;
  - the stop's output;
  - no terminal and no wait;
  - the `review-stop.json` document and its removal;
  - per-provider interactive resume support and the continue or fresh-start command.
- **While stopped** (§5.39 for `phax ls` and `phax session-info` text output only, §5.40–§5.45):
  - visible as waiting, and `phax ls --awaiting-review`;
  - path, shell and open target the stopped phase;
  - `phax enter-phase` continues the current session, codex included (§5.42 also applies to headless phases);
  - `--new-session`;
  - the worktree diff is the work;
  - the phase guard holds.
- **Closing a declared stop** (§5.46–§5.58, §5.63–§5.65):
  - the gate runs first, and a red gate returns the phase to the person;
  - the interactive handoff: the person's own `correction-handoff.md` takes precedence, otherwise the closing turn resumes the current session, or starts fresh without a usable one;
  - an editing closing turn is refused, an invalid handoff commits nothing, and a limit keeps the stop;
  - the phase commit, or the empty commit when nothing changed;
  - later phases read the corrections under `## Review corrections`;
  - the plan is not rewritten, and corrections are not deviations.
- **Cost and the other commands** (§5.71, §5.73–§5.76, §5.81):
  - phax's own turns are costed, each by its own increment;
  - reset at a declared stop, and reset the stopped phase first;
  - adjust-plan waits;
  - archive treats the stop as unfinished (`--force`);
  - plans and runs without a stop are unchanged.
- **Persisted shapes needed by the above:**
  - the `awaiting_review` states and transitions in `src/domain/state.ts` and the reducer;
  - the stop block on every phase status (null for a phase that never stopped);
  - the first-reading, interactive-handoff, interactive-session and review-stop formats, born with `$schema`, joining FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS.
  - run-status and phase-status get `next` snapshots and frozen decoders of their current shapes. Check which are already cut against `packages/schemas/history.lock.json` and `docs/release.md`.
  - `hold` on run-status belongs to plan 2. Do not add it here, so that no field is written that nothing reads.

Out of scope, for the later plans. Leave each one as it is today, and keep main honest in between:
- **Plan 2:** the hold, all of it:
  - `--hold` and its grammar, resolution, preflight and recorded hold;
  - the held stop and its seed;
  - the review commit and `Held-Phase:` trailer;
  - the correction handoff beside the builder's;
  - a held phase continuing the run, and its record at closing;
  - the oracle-pair rules (§5.11–§5.17, §5.20–§5.22, §5.59–§5.62, §5.69, §5.77–§5.80, and the oracle-phases changes r-oracle-authored and r-oracle-commit).

  Because the hold does not exist yet, no declared stop can sit inside an oracle pair until plan 2. Keep the §5.11 finding until plan 2 if removing it here would let a declared review change an oracle file with no `authored` re-run. Settle this in Technical arbitrations.
- **Plan 3:**
  - the versioned `phax ls --json` run list (§5.35, the run-list format) and docs/upgrading.md for it;
  - transcript capture (§5.55, §5.56);
  - the records, posture, compliance review, review handoff and PR body around a stop (§5.66–§5.68, §5.70);
  - estimating an interactive phase (§5.72).

  If a record or the review handoff would otherwise claim the agent wrote a person's correction, state the minimum this plan does to keep them honest, or why nothing reads them before plan 3.

Ground to read:
- `src/domain/state.ts`, the event reducer and `src/app/executePlan.ts` (how a phase starts, gates, commits and hands over to the next);
- `src/app/resume.ts` / `src/cli/commands/resume.ts`, `src/cli/commands/enterPhase.ts`, `enter.ts`, `path.ts`, `shell.ts`, `open.ts`, `ls.ts`, `sessionInfo.ts`, `resetPhase.ts`, `archive.ts`, `adjustPlan.ts`;
- the Backend port and the claude-code, codex and mistral-vibe adapters (`src/infra/providers/`): resume, read-only modes, session ids from the stream;
- the phase guard;
- the phase prompt builder (the previous-phase handoff section);
- the handoff validation;
- the file reconciliation;
- the cost ledger;
- `src/domain/plan/interactiveCheck.ts` and `src/domain/plan/oracleCheck.ts`;
- `src/app/runPreflight.ts`;
- `src/schemas/schemaUrl.ts`, `src/schemas/persisted.ts`, `packages/schemas`.

Points the spec leaves to planning (§10 "Left open"). Settle each in Technical arbitrations:
- message and output spelling;
- continue-command flags per provider;
- the seed's wording, and whether it embeds the plan;
- the document shapes beyond their normative keys;
- how the worktree is compared before and after a turn, and how a first turn's edits are restored;
- where the stop, the outcome and the sessions live in the phase status;
- how in-flight runs and extraction-cache entries from an older binary are treated;
- where the `interactive` check sits in RUN_PREFLIGHT_CHECKS.

Raise an open question for any arbitration whose options differ in a security or autonomy loss, for example:
- a first or closing turn's permissions;
- a continue command's sandbox flags;
- running a turn when a provider has no read-only mode.

Constraints:
- **Layers** as in CLAUDE.md. The seed, the worktree comparison verdict, the handoff validation, the review-stop document and the prompt section are pure domain or app logic. Every file write, git operation and provider spawn goes through its port.
- **State transitions** only through `src/domain/state.ts` and the reducer. `awaiting_review` is a real state, never `interrupted` with a reason.
- **No back-compat shims, explicit per-variant enums**, as §10 lists them (cause, outcome, session origin, resume support, first-turn outcome, guard kind, review-stop variants).
- **Provider-agnostic.** Session ids come from the headless stream, never from `--session-id`. A read-only mode narrows a turn, but is never its only guard.
- **No network.** phax prints or execs a provider's own CLI and gains no server.
- **Autonomy:**
  - only a plan-declared interactive phase stops;
  - no agent prompt mentions how to stop a run;
  - a run that has no terminal stops and exits 13 without waiting.
- **Fixtures** are made up (the invoice-export and credit-notes runs, Ada Example, the session ids). Fake provider CLIs keep their session stores under a test HOME. Tests never read `~/.phax`. They assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits:** the phax-planning skill's interactive section needs `phax run --allow-skill-edits`; say so in the plan.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`. This repository declares no assignment bounds.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- `phax --usage` for every command this plan changes (resume, enter-phase, ls --awaiting-review, session-info, path, shell, open, reset-phase, adjust-plan, archive, and the exit table with 13), regenerated with the usage spec and the CLI reference;
- README §Interactive phases (under §Run, after §Resume), for the declared stop only;
- `NEXT_STEPS.md`: interactive-phases moves to In flight, plan 1 of 3.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. Keep the refusal of an interactive phase until the phase that can run one end to end, so that no commit lets a plan start a stop it cannot close. A likely order:
1. the states, the persisted shapes and their snapshots;
2. the stop: first turn, seed, review-stop document, exit 13;
3. the commands while stopped, and enter-phase;
4. closing, with the refusal lifted and lint placement;
5. the docs and the skill.

A first draft of this plan (`docs/plans/archive/2610220924-interactive-phases-plan.md`, abandoned) was reviewed against the code. Read it: its phase order, its persisted-shape analysis, its three open questions (q-turn-shell, q-vibe-turns, q-continue-approvals) and most of its arbitrations were sound, so keep what holds. Fix what the review found:
1. **The closing turn needs the corrections' content diff** (§5.50, §5.51). No Git port operation diffs two trees' content, and a read-only Claude turn has no shell to run `git diff`. Add one, in the phase that first needs it.
2. **Snapshots and restores.** A snapshot built by `git add -A` into an empty temporary index leaves out tracked files that match an ignore pattern, so an unchanged review reads as corrected, with phantom deletions. Seed the temporary index from `HEAD` first. Restore a first turn's edits through a temporary index too, never the real one, which holds the person's staged state at `--new-session`. Do not destroy edits the person made at the same time.
3. **The commit must not credit an agent with the person's correction.** `buildCommitBody` in `src/app/commit.ts` always writes `Model:`, `Effort:` and `Session-Id:`. Specify the interactive commit's own trailer set: `Interactive-Phase:`, the closing gate's log, and no agent session claimed as the author.
4. **The commit is the gated tree.** Commit exactly the snapshot the closing gate passed, or re-snapshot and refuse on a difference. Never commit edits made after the gate.
5. **interactive-session.json holds what is recorded**, each first turn's outcome with its own per-variant fields, for example the changed paths of `refused-change` and the reason of `failed`.
6. **review-stop.json exists exactly while the run is `awaiting_review`** (§5.33, §5.34). Define the close in progress, an interrupt or crash mid-close, and `archive --force`. Define what `enter-phase` does on such a run, where an interactive phase has no `agent-binding.json`.
7. **Review corrections are visible everywhere a reconciliation is read:**
   - the global reconciliation (`src/domain/reconciliation/global.ts`), which `plans overlap --landed`, adjust-plan and review-code read;
   - `file-reconciliation.md`, through `render.ts`;
   - the previous-reconciliation lookup, which skips back over an interactive phase as the previous-handoff lookup does.
8. **File lists are complete.** The event disposition matrix (`src/domain/matrix.ts`) gains the new state and events. Every test file whose phase-status or reconciliation fixtures break once `mode`, `stop` or `reviewCorrections` are required is listed, or a shared fixture helper is planned and listed. The session port and its adapter are planned edits if a phase changes `SessionOps.resume`. Do not list files that do not exist (`src/app/modelResolution.ts`).
9. **Security choices are open questions, not arbitrations:**
   - `phax enter-phase` on a headless codex phase (§5.42) and on a Claude phase today resumes with no posture flags, so the session runs under the user's own provider defaults. Either carry the phase's posture, as the stop's continue command does, or ask.
   - Under q-vibe-turns' phase-posture option, a vibe turn can write `.phax-context/correction-handoff.md`, which the comparison excludes; at closing that file would win as the person's handoff. Guard it, for example by checking that the file is absent or unchanged after each phax turn, and say so in the question. Consider a narrower vibe agent as an option if vibe has one.
   - State that codex read-only turns keep the user's configured MCP servers, if they do.
   - q-continue-approvals: make each option's argv match its words. On Claude, `acceptEdits` already prompts for commands outside the allowlist, so "provider-prompts" must not swap it for `default` without a reason. Say what the codex fresh-start command carries under each option (`approval_policy`).
   - Quote the printed continue command for the shell, and say how codex's trust and hooks prompts are told to the person.
10. **Tests for every in-scope §8 criterion:**
   - §5.7: the bound governs an interactive phase, and the turns run at the bound's model and effort;
   - §5.26: the read-only argv of first and closing turns on Claude and codex, with the posture carried, through fake CLIs, not only the fake backend;
   - §5.38: the "session will not be captured" warning, and a vibe close resuming the vibe session headless;
   - §5.44: the same stop edited directly or through a session gives the same tree and reconciliation;
   - §5.73: reset then resume recreates the phase, runs a new first turn and exits 13;
   - §5.63: two declared phases in one plan;
   - §5.33/§5.34: review-stop.json's content and its removal;
   - the lock released at 13, and the commit author being the checkout's git identity.
11. **`--new-session`** takes the run lock, and a failed new turn keeps the previous current session.
12. **Smaller points:**
   - session-info's new logic goes through an app helper;
   - lifting `mode: "headless"` into an older phase status is justified in the plan (no older run could be interactive);
   - §5.71 covers only Claude Code's ledger: state that loss;
   - phase-07 sweeps README's "an interactive phase is refused until a later release" and documents path, shell, open and adjust-plan;
   - the skill does not announce `--hold` before plan 2.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
