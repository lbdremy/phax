Write the phax plan "The phase prompt names the gate" for the approved spec `docs/specs/2611041203-phase-prompt-names-the-gate.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the four operator decisions of 2026-11-04 in §9b: q-need-not `need-not`, q-which-steps `all-tagged`, q-size `commands-only`, q-acceptance-step `leave-to-role`;
- everything §10 lists as settled, and its constraints.

Release context. 0.33.0 is released (tag v0.33.0) and installed; 0.34.0 is the open release (package.json 0.34.0). This change touches the phase prompt only: no persisted schema, no config key, no CLI surface. Runs on this repository use the installed phax, so nothing this plan changes is read by the run that implements it.

What already exists (read it before planning):
- `src/app/promptGeneration.ts`: `buildPhasePrompt` — the "Do not run `git commit` yourself — phax commits your changes after gates pass." line, and under "Execution rules" the line "Run the gate commands again after your changes to verify the gates are satisfied." followed by every command of the resolved profile, terminal steps included; `generatePhasePrompt`.
- `src/app/executePlan.ts`: where the phase prompt is built (the `buildPhasePrompt` call) and where the gate runs; how a resumed run rebuilds the prompt.
- `src/app/gates.ts`: profile resolution, workspace, `firing` (`every-phase`, `terminal`), the per-phase selection the gate actually runs, attribution.
- `src/schemas/phaxConfig.ts`: `GateStepSchema` (`command`, `surface`, `firing`, `output`, `input`).
- The acceptance role section (`acceptanceRoleLines`) the spec leaves as the place that explains the acceptance check.
- The interactive stop guide, which also prints gate commands and must not change (§10).
- Prompt tests and snapshots under `tests/unit` and `tests/integration` that pin today's prompt text.

Settle in Technical arbitrations, with the dominant loss of each:
- where the per-phase gate selection is computed so the prompt and the gate share it (one function both call), including on resume and on the terminal phase;
- the exact heading, wording and position of the gate section, within the spec's §6 sketch;
- which prompt snapshots change, and how the plan keeps that deliberate (each changed expectation named in the phase handoff, never regenerated blindly);
- whether Codex and Mistral Vibe phase prompts go through the same builder; if not, how all three get the same section.

Shape. Keep it small: this is a prompt change. Prefer one or two phases. Every in-scope §8 criterion has its own named test; the removal of the rerun instruction has a test that fails if the sentence or the unfiltered list comes back; a non-terminal phase's prompt lists no terminal step; the terminal phase's prompt lists them; the stop guide's text is unchanged. Docs last (the §11 page).
