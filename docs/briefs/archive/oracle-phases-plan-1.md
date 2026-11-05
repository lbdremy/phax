Write the phax plan "Oracle phases" for the approved spec `docs/specs/2610201518-oracle-phases.md`. It is the first of that spec's two plans, so it carries `completes-spec: false`. The second plan ships the example Vitest provider (§5.41–§5.48) and declares it in phax's own phax.json (§5.43).

Read the spec in full. These are settled; do not reopen them:
- its three arbitrations: q-request `oracle-request`, q-example-ships `repo-only`, q-interactive-role `refuse`;
- the lifted verdicts Q1–Q5 in §10;
- the joint phase-shape decisions J1–J5.

Already landed, do not redo:
- **phase-shape (PR #151):**
  - the required `oracle` key on every phase of the plan document and of `phax-plan.json` (`{ dischargedBy, files }` or null);
  - the `**Oracle phase:**` and `**Oracle files:**` lines, read by `src/domain/plan/phaseHeader.ts`, rendered after the Mode line, and extracted;
  - the lift that writes `oracle: null`;
  - the well-formedness lint of the declaration lines (`src/domain/plan/oracleCheck.ts`);
  - the not-yet-supported refusal `unsupportedOracleFindings`, used by lint and by the run and resume preflight.

  So §5.1–§5.5 and the plan-document side of §5.40 are done, and so is the phase-shape row of the §6 "package: @lbdremy/phax-schemas" surface.
- **assignment-bounds (PR #150, #152):** the pattern this plan should follow for a provider config block, a domain check shared by lint and the preflight (exit 11), and the headless prompt line and grant. See `src/app/assignmentBounds.ts`, `src/domain/plan/assignmentCheck.ts`, `RUN_PREFLIGHT_CHECKS` in `src/app/runPreflight.ts`, and `src/domain/authoring/prompt.ts`.

In scope: everything else in the spec except the example provider. This plan makes an oracle phase runnable with any configured `oracles` provider.
- **The `oracles` check** (§5.6–§5.15):
  - pairing, roles, the oracle files, nothing planned between the pair, no interactive phase inside a pair or in an oracle role, and a provider is configured;
  - one pure domain check, called by `phax plans lint` and by the `phax run` and `phax resume` start preflight, which refuses on its errors with exit 11;
  - it replaces `unsupportedOracleFindings`: delete that function and its refusal. Keep the interactive refusal (`unsupportedInteractiveFindings`) as it is; the interactive runtime is a later spec's plans.
- **Config** (§5.16–§5.18): the `oracles: { command }` block merged across layers like `brief` and `architecture`, `phax schema upgrade`, and a configured step refused at decode when it claims `"surface": "oracle"`.
- **The oracle step** (§5.19–§5.30):
  - the `oracle-request` format, born with `$schema`, joining FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS;
  - the spawn contract and its time limit;
  - judging the answer as a `gate-report` step, with findings driving the fix loop, a refusal pausing with no fix attempt (exit 4), and provider errors failing the step;
  - an undischargeable oracle pausing the run;
  - attribution;
  - the `oracle` surface. Under the spec's §10 and §6 package surface, this widens `gate-attribution` and `phase-record-manifest` (`verifiedSurfaces`), each with a `next` snapshot and a frozen decoder for its current shape.
- **Around the run** (§5.31–§5.36): oracle pairs in the review handoff, the role in the records, the role paragraph in the phase prompt (naming no framework), discharge edits counted as planned edits, the discharge judging the current oracle commit, and `phax reset-phase` resetting the discharge first.
- **Planner** (§5.37–§5.39):
  - the headless plan authoring prompt states whether an `oracles` provider is configured;
  - the phax-planning skill states the rule;
  - the skill also teaches the declaration lines, now that they run;
  - the phax-decide-plan skill's P3 changes as spec §10 says.
- **§5.40:** a plan without an oracle phase runs, lints and records exactly as before.

Ground to read:
- the gate machinery:
  - `src/schemas/gateReport.ts`, `src/schemas/gateRequest.ts`, `src/schemas/gateAttribution.ts`;
  - the surface enum;
  - how a gate step with `output: "gate-report"` is run and judged today, and how a refused report pauses a phase (exit 4) and is resumed;
- `src/schemas/phaxConfig.ts`, `src/domain/config/mergeLayers.ts`, and how `brief` and `architecture` are merged;
- `src/schemas/schemaUrl.ts`, `src/schemas/persisted.ts`, `docs/release.md`, `packages/schemas/history.lock.json`, for which formats are already cut and need a frozen decoder, and which are only `next`;
- the phase prompt builder, the review handoff, `phax records explain`, `phax reset-phase`, and the file reconciliation;
- `.claude/skills/phax-planning/SKILL.md` and the phax-decide-plan skill.

Points the spec leaves to planning, to settle in Technical arbitrations:
- the provider time cap (120 s is indicative);
- where the `oracles` check sits in `RUN_PREFLIGHT_CHECKS`, and whether `phax run --dry-run` reports its errors;
- how the oracle role reaches `phax records explain`: a new required record field, or derived from the recorded `phax-plan.json`;
- the request's saved file name;
- the exact wording of messages, prompt paragraphs, handoff table and skill text.

For any arbitration whose options differ in a security or autonomy loss, raise an open question.

Out of scope:
- the example provider and phax's own `oracles` declaration (plan 2);
- the interactive runtime and its refusal;
- steme's provider;
- non-test oracles;
- read-only enforcement of oracle files;
- several discharging phases;
- `headless-review`.

Constraints:
- **Layers** as in CLAUDE.md:
  - the check and the pair resolution are pure domain;
  - the provider runs through the Shell port, as gate steps do;
  - the config is decoded through schemas, and the request is encoded through them.
- **No test-framework knowledge in `src/`:** no marker list, no test-file convention, no built-in provider (§5.41).
- **No back-compat shims, explicit enums:**
  - `verdict` is `authored | discharged`, and each request variant carries exactly its keys, `oracleCommit` on `discharged` only;
  - a configured step's surface stays `local | structural | product`;
  - the recorded surface adds `oracle`.
- **Autonomy:** a missing provider refuses only at lint and the start preflight; a failing provider fails the step; a refusing provider pauses the phase. Nothing waits for a person.
- **Security:**
  - the oracles provider runs as gate steps do, from phax, never inside an agent session;
  - granting the headless planner a new command, or any other new grant or permission, is an open question.
- **Fixtures** are made up (`acme-billing`, `refunds`, `tests/prune.test.ts`, `tests/refunds.test.ts`), with fake provider scripts. Tests never read `~/.phax`. They assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits** (phax-planning, phax-decide-plan) need `phax run --allow-skill-edits`; say so in the plan. They are required by §5.39 and §10, so they are not an open question.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`. This repository declares no assignment bounds, so the policy default governs.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- `phax --usage` (cmd run, cmd resume, cmd plans lint, the oracles contract), regenerated with the usage spec and the CLI reference;
- README §Oracle provider, beside the other providers;
- a docs page for oracle phases following spec §11, linked from the README;
- `docs/upgrading.md`, if a step is needed;
- `NEXT_STEPS.md`: oracle-phases moves to In flight, plan 1 of 2, and no longer waits for `steme oracles`.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely split:
1. The config block and the `oracles` check, with lint and the preflight. The refusal of an oracle phase stays until phase 2 can run it, so no commit lets an oracle phase run without its step.
2. The request format, the oracle step in the gate loop, the surface and its snapshots, the pause, attribution, and reset.
3. The handoff, the records, the prompts, the skills and the docs.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
