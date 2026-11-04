---
status: Approved
date: 2026-11-04
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-04
  baseline: b3ace3e
---
# The phase prompt names the gate

## 1. Context

A phax phase runs one agent session in its own worktree. When the session ends, phax runs the gate: the steps of the resolved gate profile, in order. Every-phase steps run on every phase. Terminal steps run only on the terminal phase. Each step carries a `command`, a `surface` (local, structural, product) and a `firing`. When a step fails, phax resumes the same session with the failing step's output (the fix loop), and runs the gate again after the fix. On phax's own records, 59 of 318 phases needed a fix attempt. Each attempt cost about $0.20 and 30 s of agent time plus a gate rerun, and the loop works.

Today the phase prompt tells the agent two things about the gate. Near the top it says "Do not run `git commit` yourself — phax commits your changes after gates pass." Under "Execution rules" it says "Run the gate commands again after your changes to verify the gates are satisfied." and then lists every command of the resolved profile, one per line. That list includes the terminal steps on every phase, even though the gate runs them only on the terminal phase. It gives no surface for any step, and it does not say that a failure comes back into this same session.

Measured on phax's records (2026-11-04, 318 phase sessions, tool-call timestamps), phases spend 27% of their wall time (14.0 h of 52.4 h) waiting on feedback commands they run themselves. The largest share is whole-suite test runs: 6.7 h over 403 calls, against 1.3 h over 1,193 targeted calls. On this repository the whole suite now takes 270 s wall, and `test:unit` 33 s. The median whole-suite run inside phases went from 20 s (Aug) to 34 s (Oct) to 151 s (Nov). The `standard` profile runs `pnpm test` (the whole suite) after every phase anyway.

Ground read:

- `src/app/promptGeneration.ts` — buildPhasePrompt: the line "Do not run `git commit` yourself — phax commits your changes after gates pass." and, under Execution rules, "Run the gate commands again after your changes to verify the gates are satisfied." followed by the gate commands, one per line, with no surface and no firing.
- `src/app/executePlan.ts` — The phase prompt gets every step of the resolved profile (gateSteps.map(s => s.command)). Terminal steps are included on every phase, while the gate itself runs selectGateSteps(gateSteps, isFinal). A failing step resumes the same session through runGatesWithFixLoop.
- `src/domain/gate/selectSteps.ts` — selectGateSteps: every-phase steps always run; terminal steps run only on the terminal phase.
- `src/app/gates.ts` — resolveGateProfile(config, profileId, workspaceId): the one resolution the gate uses, including the workspace override.
- `phax.json` — The `standard` profile: six local steps including `pnpm test` (whole suite), three structural steps (knip, architecture audit, model-catalog check) and four product steps fired on the terminal phase.
- `docs/ideas/harness-from-records.md` — Measurements from 318 phase sessions: 27% of phase wall time spent on self-run feedback commands, 6.7 h of it in 403 whole-suite runs, which are mostly an end-of-phase check the gate repeats.

## 2. Problem

The phase prompt tells the agent to rerun the gate itself, then gives it the wrong list to rerun. The agent dutifully runs whole gate steps (most expensively, the whole test suite) as an end-of-phase check, and the gate then runs exactly the same steps again a moment later. That duplicated wait is the largest single block of feedback time in phax's records, and it grows with the suite: a whole-suite run in Nov costs about seven times what it did in Aug. The list is also wrong: a non-terminal phase is shown product steps (build, site build, smoke tests) the gate will not run for it, which invites even more redundant work. And the prompt never states the contract that would make skipping those reruns safe: a failing step comes back into this same session with its output. Without that contract, an agent cannot tell that the gate is its safety net, so it builds its own.

## 3. Product goal

A phase session knows exactly which gate steps phax will run after it ends, in order, and knows that a failing step comes back to it with its output. While it works, it checks each change with the narrowest command that covers it and leaves whole-step runs to the gate. Fast feedback stays in-loop, and the gate does the full check once.

> The agent is told what the gate will run and trusts it; it does not run the gate a second time.

## 4. Terminology

- **gate step** — One entry of a gate profile: a command, a surface (local, structural or product) and a firing (every-phase or terminal).
- **phase gate list** — The gate steps that phax will run for one given phase: the resolved profile's every-phase steps, plus its terminal steps when the phase is the terminal phase, in the order the gate runs them. It is the same list the gate runs, resolved once.
- **gate section** — The part of the phase prompt that shows the phase gate list and states the gate contract.
- **gate contract** — Three facts stated to the agent: phax runs the listed steps after the session ends, a failing step resumes this same session with its output, and so the agent need not run a whole gate step before finishing.
- **narrowest check** — The smallest command the agent can run that still checks what it just changed, for example one test file rather than the whole suite. The agent chooses it; phax does not compute it.
- **fix attempt prompt** — The message phax sends when it resumes the session after a failing gate step, carrying that step's output.

## 5. Functional requirements

### 5.1 The prompt lists the phase gate list

The system shall include in every phase prompt a gate section that lists each step of the phase gate list, one per line, with the step's command verbatim, in the order the gate will run them.

### 5.2 Terminal steps appear on the terminal phase only

IF the phase is not the terminal phase THEN the system SHALL omit the profile's terminal steps from the gate section.

### 5.3 One resolution for prompt and gate

The system shall produce the gate section's list from the same resolved steps the gate runs for that phase (profile, workspace and firing applied), so that the listed commands equal the commands the gate executes, in the same order.

### 5.4 Each step shows its surface

The system shall show each listed step's declared surface (local, structural or product) on that step's line.

### 5.5 The prompt states the gate contract

The system shall state in the gate section that phax runs the listed steps after the session ends and that a failing step resumes this same session with the step's output.

### 5.6 The prompt directs the narrowest check

The system shall state in the gate section that, while working, the agent checks each change with the narrowest command that covers it, and that it need not run a whole gate step before finishing.

### 5.7 The rerun instruction is gone

The system shall not instruct the agent, anywhere in the phase prompt, to run the gate commands again after its changes.

### 5.8 Provider- and project-agnostic wording

The system shall render the same gate section for the same phase regardless of the provider running it, and the section's fixed wording shall name no tool or package manager. Only the quoted step commands may name one.

### 5.9 A resumed phase gets the same section

WHEN a phase prompt is regenerated on `phax resume` THE system SHALL render the same gate section that the phase's first prompt carried.

### 5.10 The gate does not change

The system shall run, for every phase, the same gate steps in the same order as before this change.

### 5.11 Fix attempt prompts do not change

The system shall send fix attempt prompts whose content is unchanged by this spec.

## 6. Surface

### internal: phase prompt gate section — indicative

Summary: A phase agent sees which gate steps will run after it ends, with their surfaces, and is told that a failing step comes back to it, so it no longer reruns the whole suite before finishing.

before:

    ## Execution rules

    - Respect the current phase scope.
    ...
    - Run the gate commands again after your changes to verify the gates are satisfied.
    pnpm format
    pnpm typecheck
    pnpm test:type
    pnpm lint
    pnpm format:check
    pnpm test
    pnpm knip
    pnpm audit:architecture
    pnpm gen:model-catalog --check
    pnpm build
    pnpm site:build
    pnpm deno:smoke
    pnpm deno:smoke-binary

after:

    ## Gate

    After this session ends, phax runs these gate steps, in order:

    - local: pnpm format
    - local: pnpm typecheck
    - local: pnpm test:type
    - local: pnpm lint
    - local: pnpm format:check
    - local: pnpm test
    - structural: pnpm knip
    - structural: pnpm audit:architecture
    - structural: pnpm gen:model-catalog --check

    If a step fails, phax resumes this same session with its output and you fix it here.
    While you work, check each change with the narrowest command that covers it.
    You need not run a whole gate step before finishing: the gate runs it.

### internal: phase prompt gate section on the terminal phase — indicative

Summary: On the last phase, the agent also sees the product steps that the gate runs only there.

    After this session ends, phax runs these gate steps, in order:

    - local: pnpm format
    ...
    - structural: pnpm gen:model-catalog --check
    - product: pnpm build
    - product: pnpm site:build
    - product: pnpm deno:smoke
    - product: pnpm deno:smoke-binary

### file: <phase folder>/prompt.md — normative

Summary: An operator who reads a phase's prompt.md sees the same gate list the gate ran for that phase.

before:

    - Run the gate commands again after your changes to verify the gates are satisfied.
    <every profile command, terminal steps included>

after:

    ## Gate

    After this session ends, phax runs these gate steps, in order:

    <the phase gate list, one `- <surface>: <command>` line per step>

    <the gate contract>

## 7. Non-goals

- phax computing which tests a change needs (a scoped check derived from the diff, `vitest related`, `--changed`): measured not to help on this repository, where `vitest related src/app/gates.ts` selects 99 of 613 files and takes 203 s.
- Timing gate steps or showing a phase how much slower it made the suite (a feedback-speed sensor): a separate spec.
- Making the integration tests faster.
- Changing the gate: its steps, order, firing, whole-suite runs, fix budget or the protected-paths check.
- Changing fix attempt prompts.
- Authoring, decide, review, brief and plan-extraction prompts, and the guide printed for an interactive stop.
- Enforcing the guidance: phax does not watch for or refuse whole-step runs inside a session.
- Adding descriptions, timings or per-step advice to gate steps in `phax.json`.

## 8. Acceptance criteria

### A non-terminal phase lists its every-phase steps only

Given a plan of two phases run with the `standard` profile from phax.json, when phax writes the first phase's prompt.md, then its `## Gate` section lists exactly the nine every-phase steps, one `- <surface>: <command>` line each, in profile order, and no product step appears anywhere in the prompt. (refs §5.1, §5.2, §5.4)

### The terminal phase lists terminal steps too

Given the same two-phase plan and profile, when phax writes the second (terminal) phase's prompt.md, then its `## Gate` section lists the nine every-phase steps followed by the four product steps, in profile order. (refs §5.1, §5.4)

### The listed commands are the commands the gate runs

Given a run whose profile mixes every-phase and terminal steps, with a workspace override that changes the step list, when each phase's gate runs, then the commands it executes, in order, equal the commands in that phase's `## Gate` section, in order. (refs §5.3, §5.2)

### The contract is stated

Given any phase prompt, when it is generated, then its `## Gate` section says that phax runs the listed steps after the session ends, that a failing step resumes this same session with its output, that the agent checks each change with the narrowest command that covers it, and that it need not run a whole gate step before finishing. (refs §5.5, §5.6)

### No rerun instruction remains

Given any phase prompt, when it is generated, then it does not contain "Run the gate commands again" or any other instruction to rerun the gate commands, and the `git commit` line is still present. (refs §5.7)

### Same section for every provider

Given the same phase routed once to Claude Code, once to Codex and once to Vibe, when each prompt is generated, then the three `## Gate` sections are byte-identical, and with the step commands removed the section contains none of `pnpm`, `npm`, `vitest`, `jest` or `cargo`. (refs §5.8)

### Resume keeps the section

Given a run interrupted during a non-terminal phase, when `phax resume` regenerates that phase's prompt, then its `## Gate` section is identical to the one in the phase's first prompt. (refs §5.9)

### The gate runs as before

Given the existing gate and fix-loop integration tests, when they run after this change, then they pass unchanged: the same steps in the same order, and the same fix-loop behaviour on failure. (refs §5.10)

### Fix prompts unchanged

Given a phase whose gate step fails, when phax resumes the session for a fix attempt, then the fix attempt prompt is identical to the one phax sent before this change for the same failure. (refs §5.11)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-need-not — Should the gate section forbid whole gate-step runs in-loop ("do not") or only say they are not needed ("need not")?

- need-not — "You need not run a whole gate step before finishing" — abandons: Some of the saving: an agent may still choose to run the whole suite out of caution.
- do-not — "Do not run a whole gate step" — abandons: The agent's judgement on a cross-cutting failure that really does need the whole suite, and the prompt's honesty, since phax cannot enforce the rule.

Recommendation: need-not — A prompt cannot enforce a ban, and an agent chasing a failure that cuts across modules may need the whole suite. Most of the measured waste comes from the end-of-phase habit that the old rerun instruction asked for, and removing that instruction and stating the contract targets it directly. Losing some of the saving to caution is the acceptable loss; a ban that phax cannot enforce, and that is sometimes wrong, is not.

Decision: need-not — by operator (Rémy Loubradou), 2026-11-04
Why: A prompt cannot enforce a ban, and an agent chasing a failure that cuts across modules may need the whole suite. Most of the measured waste comes from the end-of-phase habit that the old rerun instruction asked for, and removing that instruction and stating the contract targets it directly. Losing some of the saving to caution is the acceptable loss; a ban that phax cannot enforce, and that is sometimes wrong, is not. Advocate: The strongest case for "do not": the measured waste is 6.7 h of whole-suite runs, and "need not" leaves each agent free to keep its caution habit, so a firm ban would capture the whole saving. Principles: S1. Reversibility: cheap. Revised: none.

### q-which-steps — Should the section list every step of the phase gate list, or only the ones the agent can act on in-loop (local surface)?

- all-tagged — Every step, in run order, each line tagged with its surface — abandons: A few prompt lines on every phase for structural steps that the agent rarely runs itself.
- local-only — Local steps only — abandons: The agent's knowledge that a structural check (knip, architecture audit) will judge its change, which it learns only after a failed gate and a fix attempt.

Recommendation: all-tagged — The goal is that the agent knows what will judge it. Hiding structural steps turns a cheap check the agent could anticipate into a fix attempt. Tagging each line with its surface, rather than grouping by surface, keeps the list in the gate's run order even when a profile interleaves surfaces. A few extra lines is the smaller loss.

Decision: all-tagged — by operator (Rémy Loubradou), 2026-11-04
Why: The goal is that the agent knows what will judge it. Hiding structural steps turns a cheap check the agent could anticipate into a fix attempt. Tagging each line with its surface, rather than grouping by surface, keeps the list in the gate's run order even when a profile interleaves surfaces. A few extra lines is the smaller loss. Advocate: The strongest case for local-only: the agent can only act on local steps in-loop, so listing structural ones adds prompt lines on every phase for checks it rarely runs itself. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-size — How much should each step line carry, given that a long profile adds lines to every phase prompt?

- commands-only — One line per step: surface and command, no description — abandons: Context on what an opaquely named step checks (for example `pnpm gen:model-catalog --check`).
- with-descriptions — A line per step plus a description, which needs a new description field per step in phax.json — abandons: A small prompt, and a config shape that stays unchanged; every profile would have to be edited.

Recommendation: commands-only — The agent can read the project's scripts to learn what a command does. A new per-step description field is a config change outside this spec's scope, and every profile would have to carry it. One line per step keeps the prompt cost bounded by the profile length.

Decision: commands-only — by operator (Rémy Loubradou), 2026-11-04
Why: The agent can read the project's scripts to learn what a command does. A new per-step description field is a config change outside this spec's scope, and every profile would have to carry it. One line per step keeps the prompt cost bounded by the profile length. Advocate: The strongest case for descriptions: an opaquely named step such as `pnpm gen:model-catalog --check` tells the agent nothing about what will judge it, and a one-line description would let it anticipate the failure. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-acceptance-step — On a phase of an acceptance pair, the gate also runs the acceptance check, which is not a profile step. Should the gate section list it?

- leave-to-role — No: the existing Acceptance role section already says the acceptance provider checks the phase at the gate — abandons: One complete list of everything the gate runs: the acceptance check lives in a different section of the prompt.
- list-it — Yes: add it to the gate section as its own line after the profile steps — abandons: The rule that the list comes only from the resolved profile, plus a second mention of the acceptance check in the prompt that could drift from the Acceptance role section.

Recommendation: leave-to-role — The settled scope is the resolved gate profile, and the acceptance check is already explained, with its rule, in the Acceptance role section on exactly the phases where it runs. Mentioning it in two places is the drift risk this spec's single-resolution rule exists to avoid.

Decision: leave-to-role — by operator (Rémy Loubradou), 2026-11-04
Why: The settled scope is the resolved gate profile, and the acceptance check is already explained, with its rule, in the Acceptance role section on exactly the phases where it runs. Mentioning it in two places is the drift risk this spec's single-resolution rule exists to avoid. Advocate: The strongest case for listing it: the agent should see one complete list of everything the gate runs, instead of assembling it from two sections of the prompt. Principles: S1, S4. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The gate section lists the phase gate list (every-phase steps, plus terminal steps on the terminal phase), in run order, with each command verbatim.
- It is built from the same resolved steps the gate runs (profile, workspace, firing), never from a second copy.
- It states the gate contract: phax runs the steps after the session ends, a failing step resumes this same session with its output, the agent uses the narrowest check, and it need not run a whole gate step before finishing.
- The existing "Run the gate commands again after your changes to verify the gates are satisfied." instruction and its unfiltered command list are removed.
- The wording is provider- and project-agnostic, and all three providers get the same section.
- The gate itself and fix attempt prompts are unchanged.

Left open:

- The exact wording, the heading, and where the section sits in the prompt (the §6 sketches are indicative).
- The answers to the §9 questions: need not vs do not, which steps to list, line size, and the acceptance check.

Constraints:

- Today the phase prompt is given every profile command, while the gate filters by firing at gate time. The prompt must receive the per-phase selection, which means terminal-phase knowledge is needed when the prompt is built, including on resume.
- Prompt snapshots under tests/unit and tests/integration will change and must be updated deliberately, not regenerated blindly.
- The guide printed for an interactive stop also carries gate commands. It is out of scope and must not change as a side effect.
- Release with the installed phax: the prompt change ships in a release before runs rely on it.

## 11. Docs page

None — Only the prompt phax writes to the phase agent changes. No command, flag or config key changes for operators, and each phase's prompt.md already shows the result.

## 12. Decision log

- 2026-11-04 q-need-not decided need-not — operator (Rémy Loubradou)
- 2026-11-04 q-which-steps decided all-tagged — operator (Rémy Loubradou)
- 2026-11-04 q-size decided commands-only — operator (Rémy Loubradou)
- 2026-11-04 q-acceptance-step decided leave-to-role — operator (Rémy Loubradou)
