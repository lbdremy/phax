Write the phax plan "Planning skill defaults" for the approved spec `docs/specs/2610171254-planning-skill-defaults.md`. It is the first of the spec's two plans, so it carries `completes-spec: false`; the second plan adds `phax architecture` and completes the spec. Read the spec in full. Its six arbitrations are settled; do not reopen them:
- Q1: a generated block.
- Q2: a per-phase `modelReason` field, chosen against the recommendation.
- Q3: pull.
- Q4: both commands exit 1 with no provider, and `phax architecture` explains.
- Q5: no record.
- Q6: a Markdown body.

In scope: §5.1–§5.16 and every `modelReason` requirement Q2 added, with their §6 surfaces and §8 criteria, as §10 assigns them to this plan:
- the skill's model policy: write the phase first, assign last; `claude-sonnet-5-5` at `medium` by default; when to go stronger and when lighter; a reason for every departure;
- the generated policy block, checked against the catalog by `pnpm check:full`;
- the plan document's `modelReason`, `model` and `effort` as the last keys of a phase, with older sidecars lifted;
- `modelReason` rendered and validated as §5 says;
- the planning principle stated without layers, and the layer chain, test table and boundary list turned into one example architecture;
- the skill's architecture paragraph, telling the planner to read the code and its documentation. It does not mention `phax architecture`; plan 2 adds that.

Out of scope: `phax architecture`, its config key, its two formats, the prompt statements of §5.28–§5.30 and the §11 docs page. All of that is plan 2.

Ground to read:
- **The skill:** `.claude/skills/phax-planning/SKILL.md`, the sections "Choosing a model and effort", "Planning doctrine", "Test strategy", "Boundary contracts", "Planning constraints" and "Headless authoring". It is shipped through `src/domain/skills/catalog.ts` and copied by `phax skills install`. Check whether an installed or bundled copy of it is checked for drift, and keep every copy in step.
- **The generator:** `scripts/generate-model-catalog.ts`. It renders the catalog table between markers and `--check` fails on drift. The policy constant (the default model and effort, and the stronger and lighter models) belongs in domain code that the generator reads, checked against `DEFAULT_PROVIDER_CONFIG`.
- **The plan document:**
  - `src/schemas/planDocument.ts`;
  - its history under `src/schemas/history/plan-document/` and how a previous shape is lifted (`src/app/migrateDocuments.ts`, `src/schemas/persisted.ts`);
  - `src/schemas/schemaUrl.ts` and `docs/release.md`. Decide from these whether the change rides the current `next` snapshot of `plan-document` or needs a frozen copy and a lift, and say which in the plan's Technical arbitrations.
- **Rendering and extraction:** `src/domain/authoring/renderPlan.ts` (the rendered `**Recommended model:**` lines) and the deterministic extraction from plan.md to `phax-plan.json`. The extracted projection and `phax-plan.json` stay unchanged unless §5 says otherwise.
- **The headless prompt:** `src/domain/authoring/prompt.ts`, which opens with the skill verbatim, then the output contract and the document JSON Schema.

Constraints:
- **Layers** as in CLAUDE.md: the policy constant and its check are pure; the generator is a script; no CLI logic.
- **Persisted formats:** no back-compat shims, and `modelReason` is required (null for a phase on the default). An older sidecar is lifted, never read with an optional field.
- **Model names:** phases name only models in the installed phax's catalog. This plan changes the skill's policy, not phax's catalog. Plan phases still name `claude-opus-5-5` where they design, and `claude-sonnet-5-5` for mechanical work. Following the policy this plan writes is welcome, with each departure's reason in the phase's `modelReason`.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Fixtures:** made up (`acme-billing`, `src/core/billing/totals.ts`); none copied from this repository's own plans, specs or run folders, from `~/.phax` or from another repository.
- **Tests** assert `$schema` URLs by format id and release pattern, never by the running version.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- the skill itself;
- `docs/` pages that describe the plan document or the model choice (search for "Recommended model" and "default phase model");
- the regenerated CLI reference, if any command help changes;
- `NEXT_STEPS.md`: add planning-skill-defaults as in flight (plan 1 of 2), and correct the line that says headless-review runs next.

Phase shape: as few phases as the gates allow, from the core outwards, every commit green. A likely split, merged if the gates allow:
1. The policy constant, the generated block and its check, and the skill rewrite.
2. `modelReason`, the key order of the plan document, the lift and the rendering.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
