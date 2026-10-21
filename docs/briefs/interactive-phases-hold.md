Write the phax spec `interactive-phases`. It re-authors the approved spec of the same name (`docs/specs/2610190947-interactive-phases.md`), which no plan has started to implement. The re-authored spec adds a second way into the stop: a hold the operator chooses when the run starts. Read the current spec in full. Its problem, its product goal and its arbitrations (§9b: q-mode-line, q-planned-work, q-person-handoff, q-new-session, q-precedence, q-exit-code, q-unchanged-commit, q-transcript-records, q-count-interactive) all stand, and so do the joint phase-shape decisions J1–J5. Carry them over unless the hold changes what they settle; if it does, say which ones and re-ask them in §9.

Already landed, do not redo (PR #151): the required per-phase `mode` key, the `**Mode:** interactive` line, its rendering and lift, and the not-yet-supported refusal of an interactive phase (`unsupportedInteractiveFindings` in `src/domain/plan/interactiveCheck.ts`). The runtime plans of this spec replace that refusal.

Why the hold. A friend runs a fork of phax with a "hold mode", which he built with phax and uses daily through his own review UI. He reviewed our three specs, and two of his points change this one:
1. **A stop the plan did not declare.** The person often learns which phase needs them while reading it, not while planning. Today §7 rules this out ("no phax run flag", "stopping a run at a phase the plan did not declare interactive"). That non-goal is dropped.
2. **A review inside an oracle pair.** An oracle phase's tests define the API before the code exists, so a person should be able to review them, the way a spec is reviewed. oracle-phases (`docs/specs/2610201518-oracle-phases.md`, §5.11, §5.12) refuses an interactive phase between an oracle phase and its discharging phase, and refuses one in an oracle role. Its first plan implements that refusal as it stands.

His fork, for reference only. It does not bind this spec.
- `phax run --hold`, or `"review": { "holdPhases": true }` in phax.json, persisted per run in `run-status.json`.
- Every non-final phase, after it commits and writes its handoff, stops `held` and exits 0. The worktree, the branch and the builder's agent session stay.
- `phax phase revise <run> <phase>` runs the gate profile and the usual fix loop in the builder's own session, then commits `fixup! <subject>` with a `Phax-Revision: <n>` trailer. It then rewrites the reconciliation, diff, handoff and record across the phase's whole range. phax never squashes.
- `phax phase approve <run> <phase>` continues as resume does, and the next phase branches from the approved tip.
- `--json` returns one object per call, with an outcome (`revised | approved | refused`) and a fixed list of reason codes. A UI polls `phax ls --json`, which shows `state: "held"` and `heldPhase`.
- He wants to fold hold into our `awaiting_review` once this ships, so that his fork carries only a flag.

What the operator decided on 2026-10-21 (do not reopen):
1. **The operator may hold a run when it starts.** The hold is a second way into the stop that a plan-declared interactive phase reaches. There is one state, `awaiting_review`, and one exit code (13). A run never stops on its own initiative: the operator asks for the hold, and the planner declares an interactive phase. The memory "runs stay autonomous" keeps its meaning, since no agent ever stops a run to ask.
2. **A held phase is the headless phase that just committed**, not a new phase. The plan is not rewritten, and the phase keeps its id, branch and worktree.
3. **A person may review an oracle phase before its discharge.** A held oracle phase, or a plan-declared interactive phase between the pair, is allowed. If the review changes an oracle file, phax runs the `authored` verdict again on the reviewed commit, and the discharge is judged against the latest commit that passed it. This revises oracle-phases §5.11, §5.35 and the rule it took over from this spec. Say so in §10, listing the sections of oracle-phases that change and that its plans must follow. An interactive phase still takes no oracle role (q-interactive-role).
4. **A stable, machine-readable surface for a review UI.** `phax ls --json` and the stop's own output give the state, the stopped phase, why the run stopped (declared or held), and the commands that close it, as a normative `$schema` format. Today's ls output is indicative.

Settle in §9, framing each option by what it abandons:
- **How the hold is asked for.** A `phax run --hold` flag only; or also a project or user config key; whether it is fixed per run at start (persisted) or can change on resume; and whether `phax resume --hold` exists.
- **Which phases hold.** Every non-final phase, or a list (`--hold phase-02,phase-03`). The final phase reaches `review_open` anyway, so say whether it can hold.
- **Who continues a held phase.** The builder's own session, resumed, has all its context but was the one writing the code. A new read-only first turn, as for a declared phase, takes a fresh look but has to rebuild context. Or the person chooses. This decides what `phax enter-phase` opens at a held phase.
- **What closing does on a red gate.** The current spec returns the phase to the person with no fix loop. The fork runs the fix loop in the builder's session. The current rule is that phax's own turns never write; a fix loop would be phax writing code after a person's review. Frame this by the autonomy and the authorship it abandons.
- **What the corrections leave on the branch.** One more commit on the phase's branch with a trailer, an amended phase commit, or a `fixup!` commit. Also how the reconciliation, the handoff (the interactive handoff's four sections, or a rewrite of the phase's own), the records and the cost ledger cover the phase's whole range.
- **Whether a held phase reviewed without change** leaves an empty commit, as q-unchanged-commit decided for a declared phase, or nothing.
- **The surface format of point 4:** its name, whether it is a new format or extends an existing one, and which commands print it.
- **Anything in the current §9b that the hold reopens.**

Re-check against the current code:
- the run and phase state machines (`src/domain/state.ts`);
- `phax ls --json`;
- `run-status.json` and its schema history;
- the phase guard;
- how `executePlan` moves from one phase to the next;
- the codex and vibe session adapters.

Keep each §5 requirement and §8 criterion the hold does not touch. Add the hold's own, with fixtures that are made up (the invoice-export run, Ada Example).

Out of scope:
- the review UI itself, which is a separate app or plugin;
- a stop requested by an agent;
- the Prover or any outside verifier;
- the oracle runtime, which is oracle-phases' plans; here only the rule it must follow changes.

Constraints:
- No back-compat shims: new keys are required, with explicit per-variant enums. For example, the stop's cause is `declared | held`.
- State transitions go only through `src/domain/state.ts`.
- Every provider answer and every new format carries a required `$schema`.
- Provider-agnostic: nothing may depend on a Claude Code feature the other providers lack.
- The phax CLI gains no network access.
- Tests hold across a release cut.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
