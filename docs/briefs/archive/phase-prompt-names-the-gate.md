Write the phax spec "The phase prompt names the gate". A phase session is told which gate steps phax will run after it ends, so the agent checks its change with the narrowest command that covers it and leaves the whole-suite runs to the gate.

**Why.** The feedback loop is half of the harness: how fast the agent learns whether it is right. Today the phase prompt says only "phax commits your changes after gates pass". The agent does not know what the gate runs, so it reruns whole gate steps itself before finishing, and the gate then runs them again. Analysis and numbers: `docs/ideas/harness-from-records.md`, `spikes/harness-data/`.

**Measured on phax's records (2026-11-04, 318 phase sessions, tool-call timestamps):**
- Phases spend 27% of their wall time (14.0 h of 52.4 h) waiting on feedback commands they run themselves.
- The largest share is whole-suite test runs: 6.7 h over 403 calls, against 1.3 h over 1,193 targeted calls (`pnpm test <file>`, `vitest run <file>`). The agent already targets by file most of the time; the whole-suite runs are mostly an end-of-phase check.
- The `standard` gate profile in `phax.json` runs `pnpm test` (whole suite) on every phase anyway.
- On this repository today the whole suite takes 270 s wall, `test:unit` 33 s. The median whole-suite run inside phases went 20 s (Aug) → 34 s (Oct) → 151 s (Nov).
- When a gate step fails, phax resumes the same session with the failure (the fix loop). Marginal cost of a fix attempt measured at ~$0.20 and ~30 s of agent time, plus a gate rerun. 59 of 318 phases needed one; that loop works and is not a problem to remove.

**Settled (do not reopen):**
1. **The phase prompt lists the gate steps that will run for this phase**, in order, as the resolved gate profile has them (every-phase steps, plus terminal steps on the phase where they fire), with each step's command verbatim. It is generated from the same resolution the gate uses, never from a second copy.
2. **The prompt states the contract:** phax runs these steps after the session ends; a failing step resumes this same session with its output; so in-loop the agent runs the narrowest command that checks what it changed, and need not rerun a whole gate step before finishing.
3. **Provider-agnostic and project-agnostic.** The wording names no tool (`pnpm`, `vitest`); it speaks of gate steps and of the narrowest check. Claude Code, Codex and Vibe phases get the same section.
4. **The gate itself does not change**: same steps, same order, whole suite.
5. **Fix-attempt prompts are unchanged** in this spec (they already carry the failing step's output).

**What exists (read it first):**
- `src/app/promptGeneration.ts`: `buildPhasePrompt` (the "Do not run `git commit`" line), `generatePhasePrompt`.
- `src/app/executePlan.ts`: where the phase prompt is built (around the `buildPhasePrompt` call) and where the gate runs.
- `src/app/gates.ts`: gate profile resolution, step firing (`every-phase`, `terminal`), attribution.
- `phax.json` `gateProfiles`: steps carry `command`, `surface`, `firing`.
- `docs/state-machine.md` / the fix loop, for the wording of what happens on failure.

**Out of scope:**
- phax computing which tests a change needs (a scoped check derived from the diff, `vitest related`, `--changed`): measured not to help on this repository, where core modules are imported by most integration tests (`vitest related src/app/gates.ts` selects 99 of 613 files, 203 s);
- timing gate steps and showing a phase how much slower it made the suite (a feedback-speed sensor): a separate spec;
- making the integration tests faster;
- authoring, decide and review prompts.

**Open questions for §9 (each with a recommendation):**
1. **"Need not" or "do not".** Forbid whole gate-step runs in-loop, or only say they are not needed? Recommendation: "need not" — a prompt cannot enforce it, and an agent chasing a cross-cutting failure may need the whole suite.
2. **Structural and product steps.** List every step, or only the ones the agent can act on in-loop (local surface)? Recommendation: list all, grouped by surface as the profile declares them — the agent should know a structural check (knip, architecture audit) will judge it.
3. **Prompt size.** A long profile adds lines to every phase prompt. Recommendation: commands only, one line each, no descriptions.
