Write the phax plan "Surface summaries" for the approved spec `docs/specs/2610211432-surface-summary.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full. These are settled; do not reopen them:
- the five operator decisions of 2026-10-21 in §10;
- q-lift `lift-marker`, q-hand `hand-template` and q-bound `bound-one-line` in §9b.

What already exists (read it before planning):
- **The spec document format** (`src/schemas/specDocument.ts`). Mind its comment on draft-07 ignoring a `pattern` beside a `$ref`.
- **The renderer of §6.**
- **The frozen snapshots** under `src/schemas/history/spec-document/` (0.17.0, pre-schema). `src/schemas/release.ts` stamps spec-document at 0.25.0, and 0.26.0 is the open release (last tag v0.25.0).
- **`phax artifact migrate-documents`** (`src/domain/artifact/documentMigration.ts`), its own-shape check and its report.
- **`phax artifact approve` and `complete`.**
- **The headless authoring and decide prompts, and their JSON Schemas.**
- **The `phax-spec` skill** (`.claude/skills/phax-spec/SKILL.md`): its sidecar field table, its Surface section and its Markdown template.
- **How plan-document 0.25.0 was frozen when it moved to 0.26.0.** Follow the same path for spec-document: freeze the 0.25.0 schema and its rendering, stamp the new shape 0.26.0, and lift 0.17.0 and pre-schema to the new current shape.

Settle in Technical arbitrations (§10 "Left open"):
- the placeholder text, which must be one line, fixed, and recognised by approve and complete;
- the `Summary: ` label and the key's position in the element;
- whether `phax artifact status` reports the summaries still to write.

Settled for this plan, because other runs are in flight:
- **The run does not migrate this repository's own live sidecars.** Several live specs sit on main beside other runs: `interactive-phases`, whose plan 3 runs at the same time as this plan, plus `test-strategy`, `artifact-decide-verdicts`, `headless-review` and this spec itself. Migrating them on the run branch would conflict with those runs and make their approved specs stale. The operator runs `phax artifact migrate-documents` after merge, as `docs/upgrading.md` instructs.
- The plan must therefore leave this repository's live sidecars untouched, and the run's own completion of this spec must still work. Check that the run's archival commit of `surface-summary`, written while the spec is at its 0.25.0 shape, passes whatever completion check the plan adds. If it cannot, raise an open question rather than migrating the spec on the branch.

Lessons from recent reviews (#157, #158). Plan for these from the start:
1. **Every in-scope §8 criterion has its own test, named in the plan.**
2. **Published JSON Schemas match the decoders.** The one-line rule reaches the exported schema, and a strict decoder publishes `additionalProperties: false`.
3. **All I/O goes through ports**, and tests never read `~/.phax`.
4. **A refusal names its remedy.** Approve and complete name the specs, and the elements, that still hold a placeholder.
5. **The drift tests** of the generated usage spec, the CLI reference and the published schemas pass.

Constraints:
- **Layers** as in CLAUDE.md. Placeholder detection and the migration decision are pure domain logic.
- **No back-compat shims.** `summary` is required, and only migrate-documents lifts an older sidecar.
- **Fixtures** are made up. Tests assert `$schema` URLs by format id and release pattern.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits:** the `phax-spec` skill changes, so the plan says `phax run --allow-skill-edits`.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`. This repository declares no assignment bounds.
- **Lint:** the plan must pass `phax plans lint`.
- **Test strategy:** write every `### Test strategy` in the phax-planning skill's line format (size · technique · oracle · loop, plus a criterion id).

Docs:
- `docs/upgrading.md` 0.26.0: the entry of §11;
- README, wherever it describes the spec's §6 or migrate-documents;
- the `phax-spec` skill;
- `NEXT_STEPS.md`: this spec, landed.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely order:
1. the format, the freeze, the renderer and the authoring and decide schemas;
2. the migration and the placeholder refusals;
3. the skill and the docs.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
