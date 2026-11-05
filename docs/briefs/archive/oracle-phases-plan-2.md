Write the phax plan "Skip oracle" for the approved spec `docs/specs/2610201518-oracle-phases.md`. It is the second of that spec's three plans, so it carries `completes-spec: false`. The third plan ships the example Vitest provider.

Read the spec in full, especially these parts, amended and re-approved on 2026-10-21 after PR #154's review; they are settled:
- §5.49 and §5.50 (`phax resume <run> --skip-oracle`);
- §5.36 (a committed oracle phase is never reset);
- §5.28 (the remedy names both ways on);
- the §6 surfaces "file: <run>/phase-NN/gate-attribution.json" and "cli: phax reset-phase and phax resume --skip-oracle — a wrong oracle";
- the §8 criteria "An undischargeable oracle pauses the run", "A wrong oracle is corrected in place", "A skip needs an oracle role" and "A skip keeps the configured gate";
- the last bullet of §10 Settled.

Already landed (plan 1, PR #154), do not redo:
- the `oracles` block;
- the shared `oracles` check;
- the oracle step in the gate loop: `oracleStepFor` in `src/app/executePlan.ts`, `runGates` in `src/app/gates.ts`, the fix prompt's oracle line;
- the `oracle` surface, with gate-attribution and phase-record-manifest at their `next` shapes and frozen decoders of 0.21.0 and 0.17.0;
- the review handoff's "Oracle pairs" table, `records explain`, `OracleCommitMissingError`;
- the reset refusal `phase_blocked_by_discharge`. Its message currently says to archive the run and run a corrected plan.

In scope:
1. **The flag.** `phax resume <run> --skip-oracle`.
   - It applies only to the phase the resume restarts at, and only in that invocation. It is never persisted for a later phase.
   - It is refused before any phase runs when that phase has no oracle role (§5.50). Choose the exit code that matches how resume refuses an invalid option today.
   - The resumed gate runs every configured step, with the usual fix loop, and no oracle step.
2. **The attribution**, as an explicit per-variant enum.
   - Today gate-attribution's step is one struct with `surface: RecordedSurface` and `result: pass | fail | refused`. Make it a union:
     - a configured step: surface `local | structural | product`, result `pass | fail | refused`;
     - the oracle step: surface `oracle`, result `pass | fail | refused | skipped`.
   - A skipped oracle step is recorded as `{ command: <oracles command>, surface: "oracle", result: "skipped" }`, last, like the oracle step.
   - gate-attribution is at its unreleased `next` shape, so it changes in place, with no new frozen copy. Check this against `packages/schemas/history.lock.json` and `docs/release.md`. Regenerate its JSON Schema and the package types.
   - The frozen 0.21.0 and 0.20.0 decoders still lift into the new union.
3. **What a skip must not claim.**
   - `oracle` is not a verified surface of a phase whose oracle step was skipped. This holds for the phase record manifest's `verifiedSurfaces`, the final report and the PR body.
   - The review handoff's "Oracle pairs" table shows `skipped` in that verdict's column.
   - `phax records explain` shows the skip where it shows the oracle result.
4. **The texts that name the recovery:**
   - the reset refusal (§6 surface);
   - the next steps printed when an oracle step pauses or fails a phase, including the exhausted fix loop and a refused report (§5.28);
   - `resume-instructions.md`.

   Each names `phax enter-phase <run> <phase>`, correcting the oracle, then `phax resume <run> --skip-oracle`, and that the configured gate still applies. Replace the archive-and-replan wording plan 1 shipped.
5. **The tests of §8's four criteria**, plus:
   - an integration test of the whole recovery: the discharge pauses on a failing oracle step; a resume without the flag runs the oracle step again; a resume with it commits;
   - the attribution union's decode and encode, and the lift of older documents.

Ground to read:
- `src/cli/commands/resume.ts`, `src/app/executePlan.ts` (the resume options and `oracleStepFor`), `src/app/gates.ts` (the attribution);
- `src/schemas/gateAttribution.ts`, `src/schemas/surface.ts`, `src/schemas/history/gate-attribution/`;
- `src/domain/gate/verifiedSurfaces.ts`, `src/app/gateAttribution.ts`, the review handoff and records code;
- `src/app/resetPhase.ts`, `src/app/resumeInstructions.ts`;
- `packages/schemas` (gate-attribution format, types, fixtures).

Constraints:
- **Layers** as in CLAUDE.md. Whether a phase may skip is pure domain. The CLI parses the flag and renders.
- **No back-compat shims, explicit per-variant enums**: no widened shared literal.
- **Autonomy**: the skip is an operator's choice at resume, never an agent's. No agent prompt, grant or fix prompt mentions `--skip-oracle`.
- **Fixtures** are made up (`acme-billing`, `refunds`, `tests/refunds.test.ts`), with fake provider scripts. Tests never read `~/.phax`, and assert `$schema` URLs by format id and release pattern.
- **Gates**: every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Models**: follow the phax-planning skill's model policy, with `assignmentReason`.
- **Lint**: the plan must pass `phax plans lint`.
- **Skill edits**: if a phase edits `.claude/skills/`, say that the run needs `--allow-skill-edits`. Only do so if a skill describes the recovery; the phax-cli skill may.

Docs:
- the `resume` long help in `src/cli/cliDocs.ts` (the flag) and the `run` text where the oracle step's failure is described, then the regenerated usage spec and CLI reference;
- README §Oracle provider and `docs/oracle-phases.md` (the recovery);
- `NEXT_STEPS.md`: oracle-phases plan 2 landed.

Phase shape: one phase if the gates allow it; otherwise two, from the core outwards, with every commit green.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
