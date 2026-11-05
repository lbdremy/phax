Write the phax plan "Phase shape" for the approved spec `docs/specs/2610201350-assignment-bounds.md`. It is the second of that spec's plans, so it carries `completes-spec: false`; the bounds plan comes after it.

It is the joint plan-document change of three approved specs, which ship in one release with one frozen copy and one lift (assignment-bounds §10, interactive-phases §10, oracle-phases §10):
- `docs/specs/2610201350-assignment-bounds.md`;
- `docs/specs/2610190947-interactive-phases.md`;
- `docs/specs/2610201518-oracle-phases.md`.

It lands the shape only, not the behaviour behind it. Read the three specs in full. Their decisions, including the joint phase-shape session of 2026-10-20 (J1–J5), are settled; do not reopen them.

In scope:
- **assignment-bounds:**
  - §5.24–§5.29: `modelReason` is renamed `assignmentReason`, rendered as `**Assignment reason:**` and not extracted; the 0.25.0 shape is frozen; older sidecars lift straight to the current shape; readers refuse an unlifted sidecar.
  - §5.19: the old `**Model reason:**` line is a lint error.
  - §5.39: the upgrade guide step.
  - The rename in the phax-planning skill (part of §5.35).
- **interactive-phases:**
  - §5.1–§5.4: the required `mode` key on every phase of the plan document and of `phax-plan.json`, right after `optionalFilesToEdit`; the `**Mode:** interactive` line read from plan.md (no line means headless) and rendered after the `**Assignment reason:**` line; the lift sets `mode: "headless"`.
  - §5.58: plans without an interactive phase are unchanged.
- **oracle-phases:**
  - §5.1–§5.5: the required `oracle` key, right after `mode`, which is `{ dischargedBy, files }` or null; the `**Oracle phase:**` and `**Oracle files:**` lines read from plan.md and rendered after the Mode line; the lift sets `oracle: null`; lint checks that the declaration lines are well formed.
  - §5.40: nothing changes without an oracle phase.
- **The second persisted format.** `mode` and `oracle` also change `phax-plan.json` and the extraction cache entry, which embeds its schema. Settle in Technical arbitrations how that format is frozen and lifted, how a cached extraction from the old shape is treated, and what a run still in flight with an old `phax-plan.json` does on `phax resume`. Choose the option that refuses with a named remedy, not a silent fallback.

Behaviour that is not here yet must not run. Between this plan and the runtime plans of interactive-phases and oracle-phases, a plan that declares an interactive phase or an oracle phase:
- lints with an error saying the phase kind is not supported yet;
- is refused by the `phax run` and `phax resume` start preflight with the same error, exit 11.

It never runs as if the phase were headless. The runtime plans replace these refusals with their real checks. Keep each refusal one small, clearly named check that the runtime plan swaps out.

Out of scope (later plans):
- the bounds (`assignments` in phax.json), `phax validate`, the bounds check shared by lint and the run preflight, and `phax architecture` printing the bounds;
- the interactive runtime: the stop, exit 13, the first and closing turns, the handoff, transcripts, records, the cost ledger;
- the interactive placement check of interactive-phases;
- the oracle runtime: the provider, `oracle-request`, the gate step, the placement check, the prompt statement and the example Vitest provider.

Ground to read:
- **The plan document:** `src/schemas/planDocument.ts` and its history under `src/schemas/history/plan-document/`, plus how `modelReason` was added and lifted in 0.25.0 (`git log -S modelReason`).
- **`phax-plan.json`:** its schema and history (latest snapshot 0.17.0), and the extraction cache (`src/domain/planCache`).
- **The migrations:** `src/app/migrateDocuments.ts`, `src/schemas/persisted.ts`, `src/schemas/schemaUrl.ts`, `docs/release.md`, `packages/schemas/history.lock.json`.
- **Rendering and extraction:** `src/domain/authoring/renderPlan.ts` and the deterministic plan.md extraction (the mdast parser).
- **Lint and preflight:** `src/domain/plan/lint.ts`, `src/app/lintPlan.ts`, `src/app/runPreflight.ts`.
- **The skill:** `.claude/skills/phax-planning/SKILL.md`. It names `modelReason` and `**Model reason:**` in "Choosing a model and effort" and "Headless authoring", and the headless prompt opens with it.
- **The upgrade guide:** `docs/upgrading.md`, which gets a 0.26.0 section.

Constraints:
- **Layers** as in CLAUDE.md. Parsing and rendering stay pure, and readers decode through schemas.
- **No back-compat shims.** Every new key is required; `modelReason` is refused as an unknown key in the current shape; older shapes are lifted, never read with keys missing.
- **Explicit enums.** `mode` is `"headless" | "interactive"`. `oracle` is null or exactly `{ dischargedBy, files }`.
- **Fixtures** are made up. Tests never read `~/.phax`. They assert `$schema` URLs by format id and release pattern, never by the running version. Snapshot tests hold both before and after the release cut.
- **Archived sidecars.** Archived dev-build sidecars under `docs/plans/archive/` and `docs/specs/archive/` must still decode after the lift. 0.25.0 needed `modelReason: null` added to six of them; check what this change needs.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits.** The phase that edits `.claude/skills/phax-planning/SKILL.md` needs `phax run --allow-skill-edits`; say so in the plan. That edit widens a session's write scope, so it is an open question only if the plan could avoid it. The rename cannot avoid it.
- **Models:** follow the phax-planning skill's model policy. This repository has no bounds yet. Use the current `modelReason` field, since the rename is what this plan ships.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- `docs/upgrading.md` (0.26.0: `phax artifact migrate-documents`, and renaming a hand-written plan's `**Model reason:**` lines);
- the docs pages that name `modelReason`, the plan document or `phax-plan.json`'s keys;
- the regenerated CLI reference, if any help changes;
- `NEXT_STEPS.md`: the plan-document change landed.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely split:
1. The plan document and `phax-plan.json` shapes, frozen copies, lifts, cache handling, parser and renderer.
2. Lint and preflight (the old-label error, the not-yet-supported refusals, the declaration-line checks), the skill rename, the upgrade guide and the docs.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
