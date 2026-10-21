Write the phax plan "Assignment bounds" for the approved spec `docs/specs/2610201350-assignment-bounds.md`. It is the third and last of that spec's plans, so it carries `completes-spec: true`. Read the spec in full; its arbitrations (q-learn, q-part, q-default, q-render, q-validate) and the joint phase-shape decisions (J1–J5) are settled, so do not reopen them.

Already landed, do not redo:
- **plan 1 (PR #150):** the structured architecture report (§5.1–§5.3), its renderer under `src/domain/architecture/`, and the glob dialect, documented in the `architecture-report` JSON Schema (`src/schemas/architecture.ts`). Bounds reuse this dialect and its matcher: one dialect for parts and globs bounds.
- **plan 2 (PR #151):** the `assignmentReason` rename, the plan-document and `phax-plan.json` lift, the header-line reader `src/domain/plan/phaseHeader.ts`, which already reads the `**Assignment reason:**` line, the `**Model reason:**` lint error (§5.19), the upgrade guide (§5.39), and the not-yet-supported refusals for interactive and oracle phases (`src/domain/plan/interactiveCheck.ts` and its oracle counterpart). Leave those refusals as they are.

In scope, everything else:
- **The bounds in `phax.json`** (§5.4–§5.6, §6 "config: phax.json assignments"):
  - the ordered `assignments` list of `{ kind: "part", part, model, effort: { min, max } }` or `{ kind: "globs", globs, model, effort: { min, max } }`;
  - shape refused at decode on every command (exit 2);
  - project layer only, absent from the user overlay schema and never merged, like `records`;
  - `phax schema` or the generated config JSON Schema, plus `phax schema upgrade`, if they are affected.
- **`phax validate`** (§5.7): refuses a bound whose model or effort the routing catalog lacks, exit 2.
- **One bounds check** (§5.8–§5.18, §5.20): pure domain.
  - The governing bound is the first match over the create, edit and optional lists.
  - Conformity means the same model with an effort in range; phax never ranks models.
  - An unstated departure is an error. A stated one is a warning quoting the reason. A conforming phase with a reason warns.
  - When a part bound exists, the architecture provider runs once with `files: null`, under `phax architecture`'s time limit. An unresolved part bound is an error under which no phase is compared.
  - Globs bounds need no provider.
  - Where no bound governs, the policy default applies as a warning.
  - An invalid bound is an error.
  - The reason is read from plan.md's `**Assignment reason:**` line, never from `phax-plan.json`.
- **Lint and the run preflight call that check** (§5.21–§5.23, §5.37):
  - lint's `models` check calls it;
  - so does the `phax run` and `phax resume` start preflight, which refuses on its errors with exit 11, from the plan.md the run reads (the run folder's copy on resume), after `phase-sections`. Warnings never refuse.
  - Authoring, approval and extraction never read the bounds, and phax never rewrites a model (§5.38).
- **`phax architecture` shows the bounds** (§5.33–§5.34, §6 "cli: phax architecture"):
  - after the parts, each bound in list order; a part bound shows its part's name and globs;
  - with a path-scoped report that lacks a bound's part, settle how it shows in Technical arbitrations;
  - with no provider and bounds declared: the no-provider line, then the bounds, part bounds marked unresolved, exit 1;
  - with neither: the one line, exit 1, as today.
- **Headless prompt and grant** (§5.30–§5.32): `src/domain/authoring/prompt.ts` sends the planner to `phax architecture` when a provider OR bounds are configured, and the read-only session is granted `phax architecture` in both cases. With neither, the prompt and grant are unchanged.
- **Skills:**
  - phax-planning (§5.35–§5.36): "Choosing a model and effort" and "Headless authoring" teach the first-match governing bound, the conformity rule, the policy default fallback, `assignmentReason` null exactly on a conforming phase, and reading the bounds through `phax architecture` even when it exits 1 with its no-provider line.
  - phax-cli: its `architecture` config bullet still says the provider answers "with the repository's architecture as a Markdown body". Update it to the structured report (plan 1's q-skill-edit deferred it to this plan), and add `assignments` wherever the skill lists phax.json keys.

Ground to read:
- `src/schemas/phaxConfig.ts`, `src/domain/config/mergeLayers.ts`, and how `records` stays project-only;
- `src/schemas/architecture.ts` (the glob dialect and its matcher), `src/domain/architecture/`, `src/app/architectureProvider.ts`, `src/cli/commands/architecture.ts`;
- `src/domain/plan/lint.ts`, `src/app/lintPlan.ts`, `src/domain/routing/preflight.ts` (`preflightPhaseModels`, the model shared by lint and preflight), `src/app/runPreflight.ts` (`RUN_PREFLIGHT_CHECKS`, `freshRunPreflight`), and the resume re-check in `src/app/executePlan.ts`;
- `src/domain/plan/phaseHeader.ts`;
- `phax validate`'s use case and command;
- `src/domain/authoring/prompt.ts`, `src/app/authorArtifact.ts`, `src/domain/session/claudePermissionFlags.ts`;
- `.claude/skills/phax-planning/SKILL.md`, `.claude/skills/phax-cli/SKILL.md`.

Points left to the plan by spec §10, settled in Technical arbitrations:
- how `phax architecture <path>...` shows a part bound whose part the path-scoped report does not carry;
- how often one `phax run` invocation runs the architecture provider (the fresh preflight and the resume re-check both run the shared set);
- whether `phax run --dry-run` reports bounds errors as a "Preflight will fail" line, as it does for uncovered commands;
- the exact wording of findings, validate lines, the rendered bounds, the prompt bullet and the skill text.

Note: `NEXT_STEPS.md` "Small follow-ups" records that a refused `phax resume` currently marks the run failed, for every re-check. Fixing that is out of scope. The bounds refusal on resume simply joins the existing re-checks.

Out of scope:
- the interactive and oracle runtimes and their placement checks;
- a provider that proposes bounds;
- ranking or rewriting models;
- `authoring.plan`;
- the architecture request's shape.

Constraints:
- **Layers** as in CLAUDE.md:
  - bounds are decoded through schemas;
  - matching, conformity and the governing bound are pure domain;
  - the provider runs through the Shell port;
  - the catalog loads through the existing loader;
  - the CLI holds no logic.
- **No back-compat shims, explicit enums.** `kind: "part" | "globs"`, each variant with exactly its keys. `assignments` is optional at the top level but non-empty when present. Bound efforts use the plan's effort vocabulary.
- **Security.** The only widening is the one the spec decided: `phax architecture` is granted to the read-only authoring session when bounds alone are configured. Any other new command, grant or permission is an open question, not a Technical arbitration.
- **Autonomy.** Bounds refuse a run only at its start, never mid-phase. A missing or failing provider never stops authoring.
- **Fixtures** are made up (`acme-guard`, `acme-billing`, `src/core/decide/**`, `refunds`). Tests never read `~/.phax`. They assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits** need `phax run --allow-skill-edits`; say so in the plan. They cannot be avoided here (§5.35, §5.36, plan 1's q-skill-edit), so they are not an open question.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`. This repository declares no bounds.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- a new page `docs/assignment-bounds.md` following spec §11, linked from the README;
- `docs/architecture-provider.md` (bounds shown after the parts, and the no-provider case);
- the README's config reference;
- the `architecture` and `validate` long help in `src/cli/cliDocs.ts`, with the regenerated usage spec and CLI reference;
- `NEXT_STEPS.md`: assignment-bounds done.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely split:
1. Config schema, `phax validate`, and the pure bounds check with lint and the run and resume preflight.
2. `phax architecture` showing bounds, the prompt and grant, the skills and the docs.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
