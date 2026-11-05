Write the phax spec `assignment-bounds`. It replaces the Draft spec `phase-model-assignment` (`docs/specs/archive/2610171257-phase-model-assignment.md`, abandoned on 2026-10-20). That spec's goal survives; most of its machinery is already covered by what `planning-skill-defaults` shipped.

Goal: the repository's owner can bind the model and effort a phase gets, per part of the code, and `phax plans lint` holds every plan to those bounds. A phase that leaves its bound says why, on the phase. phax applies the owner's choice and checks plans against it. It never decides, guesses or rewrites a model.

What already exists (read it; do not restate it as new):
- **The planning skill's policy** (`src/domain/routing/phaseModelPolicy.ts`, the generated `phase-model-policy` block of `.claude/skills/phax-planning/SKILL.md`): `claude-sonnet-5-5` at `medium` by default, stronger or lighter with a reason.
- **The plan document's per-phase `modelReason`** (`src/schemas/planDocument.ts`): null on the default, a string for a departure, rendered as `**Model reason:**` and not extracted. It shipped in the 0.25.0 plan-document shape.
- **`phax architecture [path]...`** and the formats `architecture-request` / `architecture-report` (PR #148, spec `planning-skill-defaults` §5.17–§5.30). The report is `{ $schema, body }`, a Markdown body. It is still in the open 0.26.0 `next` snapshot, so its shape can change before the 0.26.0 cut with no frozen copy and no lift. The provider knows the parts of the code and never names a model.

What the operator decided on 2026-10-20 (do not reopen):
1. **The architecture report becomes structured.** It is `{ $schema, body, parts: [{ id, name, description, globs }] }`:
   - `body` keeps the overview in prose: directions of dependencies, boundaries;
   - `parts` is the map of the code.

   phax renders the report to Markdown wherever an agent reads it (the stdout of `phax architecture`), so the planner still reads text. This revises spec `planning-skill-defaults` Q6 (body only); say so in the decision log. The request stays as it is.
2. **Bounds live in `phax.json`, in the project layer only.** They are the repository's choices, not a workstation's. A key, for instance `assignments`, holds an ordered list. Each bound is one of two explicit variants:
   - `{ kind: "part", part: <a part id from the architecture report>, model, effort: { min, max } }`. It follows the architecture without copying its globs.
   - `{ kind: "globs", globs: [...], model, effort: { min, max } }`. It covers a cut finer than or across the architecture's parts, and works with no architecture provider.

   There is no separate planning file, no `phax planning sync`, no second provider, and no provider that proposes bounds.
3. **One conformity rule, with no model ranking.** A phase conforms when it uses its governing bound's model with an effort inside the range. Anything else is a departure. phax never orders models by strength, so the old `q-order` question disappears. The governing bound is the first bound in list order that matches any of the phase's planned files. The owner orders bounds from most to least demanding, as in a CODEOWNERS file.
4. **`modelReason` is renamed `assignmentReason`.** The reason is about the assignment, model and effort together. It is rendered `**Assignment reason:**`. It is null when the phase conforms to its governing bound, or to the policy default when no bound governs it, and a non-empty string otherwise. `assignmentReason`, `model` and `effort` stay the phase's last three keys. The rename is a plan-document shape change after 0.25.0, so the 0.25.0 shape is frozen and older sidecars are lifted by `phax artifact migrate-documents`, with `modelReason` becoming `assignmentReason`. The skill, the renderer, the headless prompt and the docs follow the new name.
5. **Lint holds plans to the bounds** in the `models` check of `phax plans lint`:
   - a departure with a null `assignmentReason` is an error;
   - a stated departure is a warning that quotes the reason.

Settle in §9, framing each option by what it abandons:
- **How the planner learns the bounds.** For instance, `phax architecture` prints each part with its bound, plus the `globs` bounds, so one command shows the map and the bounds. Or the headless prompt carries the bounds, and the skill tells an interactive planner where to read them. Or both. Also settle what happens with no architecture provider: today the command exits 1 with one line, yet `globs` bounds still apply.
- **How lint resolves a `part` bound.** It needs the parts' globs, which only the architecture provider knows. Does lint spawn the provider (as it spawns a plan auditor), and what does it report when the provider is missing, fails, or no longer emits a part a bound names? Lint is model-free today; a provider is not a model.
- **Whether the policy default is enforced** when no bound governs a phase:
  - an error, like a bound;
  - a warning;
  - not checked, staying guidance as today.
- **Whether the plan shows the governing bound.** For instance, phax renders a line naming it beside the model lines, or only lint reports it.
- **How `model` in a bound is validated:** against the catalog when `phax.json` is decoded (a config error, exit 2), or at lint.

Coordinate with the two other Draft or approved specs that change a phase's shape. A joint session will arbitrate the phase shape across all three, and they should land in one release so the plan document is lifted once:
- `interactive-phases` (`docs/specs/2610190947-interactive-phases.md`, per-phase `mode`);
- `oracle-phases` (`docs/specs/2609281159-oracle-phases.md`, per-phase `oracle`).

State in §10 that this spec, `interactive-phases` and `oracle-phases` change the plan document together, and must ship in the same release with one frozen copy and one lift. State also that the 0.26.0 cut waits for the architecture-report change, or that change costs a lift.

Out of scope:
- a provider that proposes bounds;
- ranking models;
- escalating a model after a failed gate;
- any change to the planner's own model (`authoring.plan`);
- the architecture request's shape.

Ground to read first:
- the abandoned spec `docs/specs/archive/2610171257-phase-model-assignment.md` (its problem statement and lint findings remain useful; its planning file, sync and provider are dropped);
- spec `docs/specs/2610171254-planning-skill-defaults.md`, or its archived copy, with its §5, §6 and Q2, Q6;
- `src/schemas/planDocument.ts`, `src/domain/authoring/renderPlan.ts`, `src/domain/routing/phaseModelPolicy.ts`;
- the `models` check of `phax plans lint`;
- `src/schemas/phaxConfig.ts` and `src/domain/config/mergeLayers.ts`;
- `src/schemas/schemaUrl.ts`, `src/schemas/persisted.ts` and `docs/release.md`, for the frozen copy and the lift;
- `docs/upgrading.md`, which gains the 0.26.0 step.

Constraints:
- No back-compat shims. New keys are required, with explicit per-variant enums (`kind: "part" | "globs"`).
- Fixtures and examples are made up (`acme-guard`, `acme-billing`, `src/core/decide/**`).
- phax stays autonomous: a missing or failing provider never stops a run or authoring.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
