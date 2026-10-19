Write the phax spec `interactive-phases`: a plan can declare a phase interactive. The run stops there, a person reviews and corrects what the previous phases did, with any editor and any agent CLI, and the run then resumes so the later phases follow the corrected pattern.

Why: a plan often has one phase that sets a pattern (a record shape, a wording, an error policy, a test style) and later phases that repeat it. Today the person sees that pattern only at the final review, already copied N times, and corrects it N times. Correcting it once, right after the phase that sets it, is cheaper, and the later phases copy the corrected version. A throwaway spike (`spikes/review-screen/`, 2026-10-18, on the archived run `phax.brief-provider` stopped after phase-03 of 7) showed that the stop is enough by itself: an agent session in the stopped worktree, seeded only with the executed phases' handoffs and the upcoming phases' intent, saw unprompted that "any flaw will spread to all four" later phases, and turned a review comment into a code fix plus a test.

Decided by the author on 2026-10-18 and 2026-10-19:
- The stop is declared **in the plan, at planning time**, by the planner who sees the repeated pattern. It is never an ad-hoc flag on `phax run`, and the agent never improvises it. This is the one sanctioned exception to "a run stays autonomous": nothing else stops a run to wait for a person, and `phase-decision-requests` stays parked.
- The final review is the same idea at the last phase; today's kept-open final phase stays as it is.
- It works with **any provider** phax drives (Claude Code, Codex, Mistral Vibe) and with **no phax interface**: the person uses their own editor and agent CLI. A dedicated review screen (a separate desktop app, reading and writing files in the run folder) is a later, separate spec; this spec must leave it possible without giving the phax CLI network access, so everything the stop produces or consumes is a file.
- The run **stops** at an interactive phase and exits; it does not stay pending in a waiting process. Closing goes through `phax resume`.
- **What counts is what the phase produces, not the session.** The person may work by hand, in their own agent session, or in the session phax prepared; phax gates, commits and reconciles the worktree's diff whatever made it. A session is optional and only adds its transcript.
- **phax starts the session itself, headless, before handing over.** At the stop phax runs one headless turn of the phase's provider, model and effort, fresh (not a resume of the previous phase's session) and seeded with the phase's context: the agent reads the seed and writes its first reading (the pattern at stake, what the later phases will copy). This gives phax the session id for every provider (an interactive session phax starts has an id phax cannot know, except with Claude's `--session-id`). phax records the id, shows the first reading, and prints the provider's own command to continue that session interactively in the worktree (`claude --resume <id>`, `codex resume <id>`, `vibe --resume <id>`), plus `phax enter-phase` as a shortcut to it. The person may change model inside the session; phax does not care.
- **At closing, the known session is reused** when phax needs an artifact in a given format (the interactive handoff): phax resumes it headless and asks for the document. Its transcript is captured into the run folder. If the person worked elsewhere, only the transcript is lost: the gates, the diff, the commit (empty or not) and a handoff written from the diff remain.
- Corrections should become guards where they can (a test, a lint rule, a gate step), so the later phases are held to them by the gates, not only told about them.
- The approved plan is not rewritten mid-run: the later phases keep their plan; what changes is the code they start from and the handoff they read.

The changes:

1. **Declaring it in the plan.**
   - A per-phase mode, an explicit enum `headless | interactive`, required on every phase in `phax-plan.json` and in the plan document (`phax artifact schema plan`), rendered as a declaration line in plan.md and read by the deterministic parser, like the `oracle` field of the approved `oracle-phases` spec.
   - Settle what an interactive phase is: a phase of its own (own id, branch, worktree, commit and handoff, cumulative on the previous phase), whose body says what to review and which upcoming phases depend on it. Settle whether it may also carry planned work, and what its planned files mean.
   - `phax plans lint` and `phax validate`: settle the rules — for instance, an interactive phase as the last phase (redundant with the kept-open final phase), two interactive phases in a row, an interactive phase first.
   - The `phax-planning` skill: when to declare one (after the first phase that sets a pattern at least one later phase repeats; not by default), and what its body says.

2. **Reaching it.** When the run reaches an interactive phase, phax sets up its worktree like any phase, writes the seed, runs the headless first turn (decided above), records the session, prints the first reading and the continue commands, and stops in a state that says it waits for a person, then exits.
   - Settle what the first turn may do: it reads and reports, it must not edit the worktree (on providers without a read-only tool set, say how a change it makes is detected and refused). Settle what happens when it fails (rate limit, provider error): the stop still happens, with no session and the fresh-start command instead.
   - Settle the provider-specific continue command and what it carries (model, effort, the security posture phax applies to phase sessions). Verified on 2026-10-19 with codex-cli 0.153.4: a session started by `codex exec --json` resumes in the interactive UI with `codex resume <id>` and shows the headless turn; afterwards `codex exec resume <id>` sees the interactive turns; the transcript is one file `~/.codex/sessions/YYYY/MM/DD/rollout-*-<id>.jsonl`. The first interactive open of a new directory asks the person to trust it, then to review hooks. Not verified: Mistral Vibe (the local install is outdated; `vibe --resume <id>` exists, whether a `-p` session resumes interactively is to check) — the spec must say what a provider whose interactive resume is unverified does (print a fresh-start command; the transcript is lost, nothing else is). Today `src/domain/session/codex.ts` and `mistral.ts` mark interactive resume unsupported; the spec lifts that for what is verified.
   - Settle the run and phase states and their transitions (through `src/domain/state.ts` only), how `phax ls`, `phax report` and `phax status`-like output show them, and the exit code (not a failure).
   - The seed is files in the worktree and in the run folder: the executed phases' handoffs, the upcoming phases' intent (their plan sections), the plan, and what is expected of the person (correct the pattern, add guards, keep the scope). Settle where it lives and its name; it must not be committed with the phase's work.
   - A run without a terminal (a loop such as the steme conductor) reaching an interactive phase stops the same way and never waits on stdin.

3. **Working in it.** The person opens the worktree in their editor and starts any agent CLI there, or none.
   - The phax commands help without being required: `phax path <run>` and `phax shell` already exist; `phax enter-phase` continues the session phax started at the stop. Settle whether `--new-session` starts another seeded session (and how its id is captured) or only prints the fresh-start command.
   - Edits by hand and edits by the agent are the same thing to phax: the diff of the worktree.

4. **Closing it.** `phax resume <run>` closes the interactive phase and continues.
   - The gates run on the corrected worktree. Settle what happens when they fail: no fix loop by an agent the person did not start; the run stays at the interactive phase, which the person fixes and resumes again.
   - The phase is committed like any phase, on its own branch, attributed to the person. Settle the case of no change at all (an empty phase: allowed, recorded as reviewed-without-change).
   - The interactive phase's handoff is the main channel to the later phases: what was corrected, the pattern to follow from now on, and which guard holds each correction. Decided: phax resumes the recorded session headless and asks for it (as `phax artifact decide` does after its interactive session); when there is no usable session, a fresh headless session writes it from the seed and the diff. Settle whether a handoff file the person wrote takes precedence. It must work for every provider.
   - The transcript of the recorded session is copied into the phase's run folder at closing; settle its name, whether it is copied even when the person never continued the session, and that a missing transcript never blocks closing.
   - The later phases' prompts read that handoff like any previous handoff. Settle whether it is marked as taking precedence over the earlier phases' handoffs where they disagree.

5. **What else reads it.** Settle the effects on the run records (`phax/records/v1`, `phax records explain`), the compliance review and the review handoff (the interactive phase is a phase; its corrections are not deviations from the plan), the PR body, the cost ledger and `phax plans estimate` (the first turn and the closing turn are phax sessions and are counted; settle whether the interactive turns of the recorded session are counted from its transcript; a session phax did not start is never counted), and `reset-phase` / `adjust-plan` on a run stopped at an interactive phase.

Out of scope:
- The review screen (diff viewer, comments, terminal, reading directions inside-out / outside-in): a later spec, a separate desktop app reading the run folder.
- Comments anchored on lines and structured replies (a reply file, or the Agent Client Protocol).
- Stopping a run at a phase the plan did not declare.

Ground to read first:
- `docs/specs/archive/2610190918-interactive-phases.md` (Abandoned 2026-10-19): the first draft of this spec. Reuse its structure and what this brief does not change (the per-phase `mode`, lint placement, review-only phases, `awaiting_review`, exit 13, gate first then handoff then commit, the four-section handoff, `## Review corrections` for every later phase, the empty commit when nothing changed, reset/adjust-plan/archive rules). Replace what the decisions above change: phax starts the session headless at the stop, prints the provider's continue command, reuses that session at closing, and captures its transcript.
- `src/domain/session/` (claude, codex, mistral adapters) and `src/cli/commands/enterPhase.ts`: what interactive re-entry supports per provider today.
- `spikes/review-screen/README.md`: what the spike showed, and the open questions it lists for this spec (closing the phase, session lifetime).
- `docs/ideas/desktop-app.md`, `docs/ideas/decision-queue-and-proof-chain.md`, `docs/ideas/coverage-provider.md`: the earlier brainstorms on review by trajectory.
- `docs/specs/2609281159-oracle-phases.md` (Approved): how a new per-phase field reaches `phax-plan.json`, the plan document, plan.md and the parser.
- `docs/specs/2608091526-phase-decision-requests.md` (Approved, parked): why mid-run waits on a person were dropped, and what this spec must not reopen.
- `docs/specs/2609250823-headless-review.md` (Draft): `review-code`, `review_open`, and the run states.
- `src/domain/state.ts`, `src/schemas/phaxPlan.ts`, `src/schemas/planDocument.ts`, `src/domain/plan/parsePlanMarkdown.ts`, `.claude/skills/phax-planning/SKILL.md`.
- The `resume`, `enter-phase`, `path`, `shell` and `artifact decide` commands in `phax.usage.kdl` and their use cases in `src/app/`; how a phase's prompt gathers previous handoffs.

Constraints:
- No back-compat shims in persisted schemas; new fields are required.
- Explicit per-variant enums.
- Respect the layers; state transitions only through `src/domain/state.ts`.
- The phax CLI gains no network access; every interface of the stop is a file or a CLI command.
- Provider-agnostic: nothing may require a Claude Code feature the other providers lack.
- Fixtures and examples are made up.
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
