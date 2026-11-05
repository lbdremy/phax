---
status: Completed
source-spec: docs/specs/2611041203-phase-prompt-names-the-gate.md
completes-spec: true
approved:
  date: 2026-11-05
  baseline: c016c7d
---
# The phase prompt names the gate

Replace the phase prompt's "Run the gate commands again after your changes…" instruction and its unfiltered command list with a `## Gate` section. The section lists the phase gate list, meaning the steps the gate will actually run for this phase (every-phase steps, plus terminal steps on the terminal phase), in run order. Each step gets one `- <surface>: <command>` line. The section then states the gate contract: phax runs the steps after the session ends, a failing step resumes this same session with its output, the agent checks each change with the narrowest command that covers it, and it need not run a whole gate step before finishing.

The gate itself, fix attempt prompts, the interactive stop guide and the frozen agent-command set do not change. Only the prompt text changes: no persisted schema, config key or CLI surface. 0.34.0 is the open release. Runs on this repository use the installed phax 0.33.0, so the run that implements this plan does not read its own change.

The plan is an acceptance pair. phase-01 writes the acceptance tests for the prompt.md surface through the run harness, marked as expected failures. phase-02 implements the section, removes the markers and updates the prompt snapshots deliberately.

## Required commands

- (none)

No new commands: the phases use only the existing pnpm scripts that the `standard` gate profile already runs.

## Technical arbitrations

- Where the phase gate list is computed: `executePlan` computes `const phaseSteps = selectGateSteps(gateSteps, isFinal)` once, at the top of each phase-loop iteration. That one value goes to `buildPhasePrompt` (new option `gateSteps: readonly GateStep[]`, replacing `gateCommands: string[]`) and to `runGatesWithFixLoop`, which today computes its own copy at the gate. A resumed phase rebuilds its prompt only on the fresh-launch path, which uses the same per-index `isFinal`, so it gets the same section. Loss accepted: the selection stays at the one call site rather than inside the builder, so a future second caller of `buildPhasePrompt` must select the steps itself. There is one caller today.
- The frozen agent-command set (`computeFrozenAgentCommands`) keeps the unfiltered `gateCommandStrings`. The commands the session may run do not change, so this plan makes no security change. Loss accepted: a non-terminal session may still run a product step it is no longer shown, which is the same permission as today.
- Heading, wording and position: a `## Gate` section placed directly after `## Execution rules` and before `## Required output`. It reads "After this session ends, phax runs these gate steps, in order:", then one `- <surface>: <command>` line per step, then three lines: "If a step fails, phax resumes this same session with its output and you fix it here.", "While you work, check each change with the narrowest command that covers it." and "You need not run a whole gate step before finishing: the gate runs it." (this is q-need-not `need-not`, q-which-steps `all-tagged` and q-size `commands-only`). An empty selection renders `- (none)`. The rendering is a pure domain function `renderGateSection(steps)` in `src/domain/gate/gateSection.ts`. Loss accepted: the gate facts sit near the end of the prompt, below the scope rules, rather than beside the `git commit` line near the top. That line stays where it is.
- Acceptance check (q-acceptance-step `leave-to-role`): the `## Gate` section lists profile steps only. `acceptanceRoleLines` is untouched and still says that the acceptance provider checks the phase at the gate. Loss accepted: the agent reads the acceptance check in a different section.
- Providers: Claude Code, Codex and Mistral Vibe all receive the same prompt text. `executePlan` builds it with `buildPhasePrompt` before `resolvePhaseAgent` picks the provider, and passes it unchanged to `backend.runAgent`. `buildPhasePrompt` takes no provider input, so the section is identical by construction, and no per-provider work is planned. Loss accepted: none beyond a unit test that pins the builder's provider-free input.
- Snapshots change deliberately. The changed expectations are: `tests/unit/__snapshots__/promptGeneration.test.ts.snap` (the buildPhasePrompt snapshot); the phase-01 and phase-02 `prompt.md` entries in `tests/integration/__snapshots__/executePlan.test.ts.snap`; and the three prompt entries in `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`. In every changed hunk, the rerun bullet and command lines are removed and the `## Gate` section is added. Any other changed hunk is a defect. The fix-attempt and handoff snapshots in `executePlan.test.ts.snap`, and the interactive stop guide tests, must not change. The phase-02 handoff names each changed snapshot entry. Loss accepted: updating the snapshots by hand and checking each diff costs more agent time than a blanket update.
- Docs: §11 of the spec records no docs page, because each phase's prompt.md already shows the result. So there is no docs phase. Loss accepted: the operator learns of the change from the release notes and prompt.md only.

---

## phase-01 — Acceptance tests for the phase prompt's gate section {#phase-01-acceptance-tests}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-02
**Acceptance test files:** `tests/integration/phasePromptGate.test.ts`

Write frozen acceptance tests that read each phase's prompt.md through the run harness and pin the spec's gate-section surface: the per-phase list, the surface tags, the contract, the absence of the rerun instruction, equality with the commands the gate runs, and stability across resume. Each test carries vitest's expected-failure marker, so the suite stays green until phase-02 makes them pass.

### Detailed instructions

- Create `tests/integration/phasePromptGate.test.ts`. Drive real runs through the existing `executePlan` integration harness, with a fake backend, a fake shell answering every gate command with exit 0, and a temporary repository as working directory. Model it on the run scenarios in `tests/integration/executePlan.test.ts` (for example the baseline scenario that pins each first prompt, and the 'runs only every-phase steps before the terminal phase' case). Read each phase's `prompt.md` from the run folder. Do not import or call `buildPhasePrompt` or any new module: the entry is the run and its prompt.md file.
- Add a local helper in the test file that extracts the `## Gate` section of a prompt: from the `## Gate` heading line to the next `## ` heading. Every test first asserts that the heading is present and the section is non-empty, so each test fails today on that assertion and never passes vacuously.
- ac-nonterminal-list: decode the `standard` gate profile from the repository's `phax.json` (read the file from the repository root and decode it with the existing config schema) and use those steps as the run's profile, in a two-phase plan. For phase-01's prompt.md, assert that the section's step lines equal `- <surface>: <command>` for exactly the profile's every-phase steps, in profile order, and that no terminal step's command appears anywhere in the prompt. Derive the expected lines from the decoded profile, and also assert the counts the spec states (nine every-phase, four terminal) so that the fixture is pinned.
- ac-terminal-list: in the same run, assert that phase-02's (the terminal phase's) section lists the every-phase lines followed by the terminal lines, in profile order.
- ac-prompt-equals-gate: use a small synthetic profile with interleaved every-phase and terminal steps of mixed surfaces, plus a workspace override (the `workspaceId` resolution that `resolveGateProfile` applies) that changes the step list. For each phase, assert that the commands the gate executed, read from the fake shell's calls or the phase's gate log `$ <command>` lines in order, equal the commands of that phase's section lines, in order.
- ac-contract: assert that the section contains the facts "phax runs these gate steps" after the session ends, that a failing step "resumes this same session with its output", "the narrowest command that covers it", and "need not run a whole gate step". Match the key phrases, not the whole paragraph, so that phase-02 keeps freedom over punctuation.
- ac-no-rerun: assert that no prompt contains "Run the gate commands again". Also assert that the unfiltered list does not come back: no line of a non-terminal prompt is a bare terminal-step command, and no run of bare command lines equal to the whole profile appears. Assert that the line "Do not run `git commit` yourself — phax commits your changes after gates pass." is still present.
- ac-resume: interrupt a run during its non-terminal phase-01 (for example let its gate exhaust, then `reset-phase` and resume, as the executePlan baseline 'case 3' does). Assert that the regenerated phase-01 prompt's `## Gate` section is byte-identical to the one in its first prompt.
- Mark every test with vitest's expected-failure marker (`it.fails`), so that `pnpm test` stays green against today's code. The acceptance provider checks the markers at the gate.
- Keep the test deterministic: no randomness, fixed fixtures, its own temporary repository per test.

### Planned files to create

- `tests/integration/phasePromptGate.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/helpers/fakePorts.ts`

### Boundary contracts

Consumer: the phase agent and the operator, who read `<phase folder>/prompt.md`. Producer: `executePlan`, which writes it. The contract pinned is the normative prompt.md shape of the spec's §6: a `## Gate` heading, one `- <surface>: <command>` line per step of the phase gate list in run order, and the gate contract. Wording is matched on key phrases only.

### Test strategy

- a non-terminal phase's prompt.md lists exactly the standard profile's every-phase steps as surface-tagged lines in profile order, and names no terminal step anywhere — medium · example · lines derived from phax.json's decoded standard profile, nine every-phase steps · acceptance · ac-nonterminal-list
- the terminal phase's prompt.md lists the every-phase steps followed by the terminal steps in profile order — medium · example · lines derived from the decoded standard profile, nine plus four · acceptance · ac-terminal-list
- for every phase of a run with interleaved firings and a workspace override, the commands the gate executes equal the commands listed in that phase's gate section, in order — medium · example · the fake shell's executed gate commands compared with the section's lines · acceptance · ac-prompt-equals-gate
- every phase prompt's gate section states that phax runs the steps after the session, that a failure resumes this session with its output, the narrowest check, and need-not — medium · example · the key phrases of the gate contract · acceptance · ac-contract
- no phase prompt carries the rerun instruction or the unfiltered command list, and the git commit line remains — medium · example · absence of the old sentence and of bare terminal-command lines; presence of the git commit line · acceptance · ac-no-rerun
- a non-terminal phase's prompt regenerated on resume carries a gate section byte-identical to its first prompt's — medium · example · the first prompt's gate section · acceptance · ac-resume

### Implementation order

1. Build the run fixture (temporary repository, fake ports, two-phase plan) and the `## Gate` section extractor.
2. Write the profile-driven tests (non-terminal, terminal, contract, no-rerun).
3. Write the gate-equals-prompt test with the synthetic profile and workspace override.
4. Write the resume test.
5. Mark every test `it.fails` and confirm that `pnpm test` is green.

### Excluded scope

- Any change under `src/`: the prompt builder, `executePlan` and the gate are phase-02's.
- Updating existing prompt snapshots or unit tests of `buildPhasePrompt`.
- The provider-agnostic criterion, the unchanged gate and the unchanged fix prompts: phase-02 covers them in-phase.
- The interactive stop guide and fix attempt prompts.

### Verification

The `standard` gate profile in `phax.json`; the configured acceptance provider checks the expected-failure markers at the gate.

### Expected handoff content

The exact path `tests/integration/phasePromptGate.test.ts`, the name of each test and the criterion id it proves, and the section-extraction helper's rule (heading to next `## `). How the fixture obtains the standard profile and the workspace override, and which fake-shell or gate-log record the gate-equals-prompt test reads. The exact phrases the contract test matches, so phase-02 renders them. Any deviation from the planned files, with the reason.

### Commit subject

`test(prompt): acceptance tests for the phase prompt's gate section`

### Commit body

Add frozen acceptance tests, marked as expected failures, that read each phase's prompt.md through the run harness. They pin the phase gate list: every-phase steps on a non-terminal phase, terminal steps added on the terminal phase, and one surface-tagged line per step in run order. They also pin the gate contract, the absence of the rerun instruction, equality with the commands the gate executes (workspace override included), and an identical section after resume.

---

## phase-02 — Render the phase gate list in the phase prompt {#phase-02-gate-section}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Give every phase prompt a `## Gate` section built from the same per-phase step selection the gate runs. Remove the rerun instruction and its unfiltered list, and pass phase-01's acceptance tests. The gate, fix attempt prompts and the interactive stop guide stay byte-for-byte unchanged.

### Detailed instructions

- Create `src/domain/gate/gateSection.ts` exporting a pure `renderGateSection(steps: readonly GateStep[]): string[]` (or a string; pick one and keep it consistent with `buildPhasePrompt`'s line arrays). It returns: `## Gate`, a blank line, `After this session ends, phax runs these gate steps, in order:`, a blank line, one `- <surface>: <command>` line per step in the given order with the command verbatim (`- (none)` when the list is empty), a blank line, then `If a step fails, phax resumes this same session with its output and you fix it here.`, `While you work, check each change with the narrowest command that covers it.`, `You need not run a whole gate step before finishing: the gate runs it.`, and a trailing blank line. Its fixed wording names no tool or package manager. Check that the phrases phase-01's contract test matches (see its handoff) appear verbatim.
- In `src/app/promptGeneration.ts`, replace the `gateCommands: string[]` option of `BuildPhasePromptOptions` and `GeneratePhasePromptOptions` with `gateSteps: readonly GateStep[]`, documented as the phase gate list (already selected for this phase). Delete the bullet "- Run the gate commands again after your changes to verify the gates are satisfied." and the `gateCommands.join("\n")` line under `## Execution rules`. Insert `...renderGateSection(gateSteps)` directly after the Execution rules list and before `## Required output`. Keep the `git commit` line and `acceptanceRoleLines` unchanged.
- In `src/app/executePlan.ts`, compute `const phaseSteps = selectGateSteps(gateSteps, isFinal);` once, near the top of the per-phase loop body, right after `isFinal` is defined. Pass it as `gateSteps: phaseSteps` to `buildPhasePrompt`. Replace the existing `const phaseSteps = selectGateSteps(gateSteps, isFinal);` at the gate call with that same value, so the prompt and the gate consume one selection. Do not touch `gateCommandStrings` where it feeds `computeFrozenAgentCommands` or `resolvePhaseAgent`: the frozen agent-command set stays the unfiltered profile. Do not touch the `selectGateSteps(gateSteps, false)` calls that feed the interactive stop guide.
- Remove the `it.fails` marker from every test in `tests/integration/phasePromptGate.test.ts`. That is the only change allowed to that file. If an acceptance test cannot pass unchanged, stop and say so in the handoff.
- Add `tests/unit/gateSection.test.ts` covering `renderGateSection`: lines in the given order, the surface tag on each line, the empty-list rendering, the contract lines, and that the section minus the step commands contains none of `pnpm`, `npm`, `vitest`, `jest` or `cargo`.
- In `tests/unit/promptGeneration.test.ts`, replace `sampleGateCommands` with sample `GateStep` values (mixed surfaces) passed as `gateSteps`. Add tests showing that the `## Gate` section sits between Execution rules and Required output, that "Run the gate commands again" never appears, and that passing one step list twice yields byte-identical sections. That last test covers ac-agnostic: the builder has no provider input, and the prompt is built before `resolvePhaseAgent`. Update the inline `buildPhasePrompt` snapshot in `tests/unit/__snapshots__/promptGeneration.test.ts.snap` by hand, or with the runner's update flag scoped to that file, and check that its diff only removes the rerun bullet and command lines and adds the `## Gate` section.
- Update `tests/integration/reviewCorrectionsPrompt.test.ts` to pass `gateSteps` (one local every-phase step for `pnpm test`) instead of `gateCommands`.
- Update the prompt snapshots in the same deliberate way: the phase-01 and phase-02 `prompt.md` entries in `tests/integration/__snapshots__/executePlan.test.ts.snap`, and the three prompt entries in `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`. Review each changed hunk: only the rerun bullet and command lines go, and only the `## Gate` section comes. The fix-attempt and handoff snapshots in `executePlan.test.ts.snap` must not change. If one does, the change is a defect: fix the code, not the snapshot.
- Leave unchanged, and check that they still pass: `tests/integration/gates.test.ts`, `tests/integration/fixLoop.test.ts`, `tests/unit/selectGateSteps.test.ts`, `tests/unit/fixPrompt.test.ts`, `tests/unit/interactive/seed.test.ts` and `tests/integration/declaredStop.test.ts`.

### Planned files to create

- `src/domain/gate/gateSection.ts`
- `tests/unit/gateSection.test.ts`

### Planned files to edit

- `src/app/promptGeneration.ts`
- `src/app/executePlan.ts`
- `tests/integration/phasePromptGate.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/integration/reviewCorrectionsPrompt.test.ts`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`
- `tests/integration/__snapshots__/protectedPathsAdditive.test.ts.snap`

### Optional files that may be edited

- `src/domain/gate/selectSteps.ts`
- `tests/integration/protectedPathsAdditive.test.ts`
- `tests/integration/executePlan.test.ts`

### Boundary contracts

app → domain: `buildPhasePrompt` (app) consumes `renderGateSection(steps)` (domain, pure). The stable shape is an ordered list of `GateStep` (command, surface, firing) in and the section text out. executePlan → prompt and gate: `executePlan` is the single producer of the phase gate list (`selectGateSteps(gateSteps, isFinal)`). Its two consumers, the prompt builder and `runGatesWithFixLoop`, take that list as given and never re-select.

### Test strategy

- the gate section renders one `- <surface>: <command>` line per step in input order, `- (none)` for an empty list, and the three contract lines — small · example · expected section text · in-phase · ac-contract
- the same phase's gate section is byte-identical whatever provider runs it, and its fixed wording minus step commands names no pnpm, npm, vitest, jest or cargo — small · example · equality of two builds from one step list; absence of the tool names · in-phase · ac-agnostic
- the built prompt places the gate section between Execution rules and Required output and never carries the rerun sentence — small · example · section order and absence of the old sentence in the prompt text · in-phase · ac-no-rerun
- the gate executes the same steps in the same order with the same fix-loop behaviour as before — medium · example · the existing gates, fixLoop and selectGateSteps tests, unchanged · in-phase · ac-gate-unchanged
- a failing gate step's fix attempt prompt is unchanged — medium · example · the existing fix-attempt snapshot in executePlan.test.ts.snap and fixPrompt.test.ts, unchanged · in-phase · ac-fix-unchanged
- the interactive stop guide's text is unchanged — small · example · the existing interactive seed and declaredStop tests, unchanged · in-phase

### Implementation order

1. Write `renderGateSection` and its unit test.
2. Switch `buildPhasePrompt` and `generatePhasePrompt` to `gateSteps`, remove the rerun bullet and list, and insert the section; update the unit prompt test and its snapshot.
3. Hoist the per-phase selection in `executePlan` and pass it to both the prompt and the gate.
4. Update `reviewCorrectionsPrompt.test.ts` and the integration prompt snapshots, reviewing each hunk.
5. Remove the `it.fails` markers from `phasePromptGate.test.ts` and run the gate.

### Excluded scope

- Changing the gate: its steps, order, firing, fix budget or protected-paths check.
- Changing fix attempt prompts, the interactive stop guide, authoring, decide, review, brief or plan-extraction prompts.
- Changing the frozen agent-command set or any security policy.
- Listing the acceptance check in the gate section; it stays in the Acceptance role section.
- Adding descriptions or timings to gate steps in `phax.json`, or any config or schema change.
- Docs pages: the spec's §11 records none.

### Verification

The `standard` gate profile in `phax.json` (terminal phase: its product steps run too); the configured acceptance provider checks that phase-01's acceptance tests pass with only their markers removed.

### Expected handoff content

The path `src/domain/gate/gateSection.ts` and the `renderGateSection` signature. The new `gateSteps` option of `buildPhasePrompt`, and where `executePlan` computes `phaseSteps`. A list naming each snapshot entry that changed (file and entry name), each confirmed to differ only by the removed rerun lines and the added `## Gate` section, and a confirmation that the fix-attempt, handoff and stop-guide expectations are unchanged. Any deviation from the planned files, with the reason.

### Commit subject

`feat(prompt): name the phase gate list and its contract in the phase prompt`

### Commit body

Replace the phase prompt's "Run the gate commands again" instruction, and its unfiltered list of every profile command, with a `## Gate` section. The section lists the steps the gate will run for this phase, with terminal steps on the terminal phase only, as one surface-tagged line each in run order. It states that a failing step resumes the same session with its output, that the agent checks each change with the narrowest command, and that the agent need not run a whole gate step before finishing.

executePlan now selects the phase's steps once and hands the same list to the prompt and the gate. The gate, fix attempt prompts, the interactive stop guide and the agent-command set are unchanged. Prompt snapshots were updated by hand, hunk by hunk.
