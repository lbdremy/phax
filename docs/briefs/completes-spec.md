Write the phax spec `completes-spec`: a plan says whether its run completes its source spec, so a spec shipped in several plans is completed by the last one, not the first.

The defect (NEXT_STEPS.md §"Small follow-ups", "A run completes its source spec even when more plans are to come"): found 2026-09-29 on `schemas-package` plan 1/5 (PR #104), and again on plans 2 and 3. At the end of a run, `src/app/completeRunArtifacts.ts` completes the plan and then rides its source spec along whenever the chain gate allows. The chain gate only blocks while another **live** plan names the spec. When the plans of a multi-plan spec are authored one at a time, each after the previous one lands (as schemas-package's five were), no other live plan exists at run end. So the first plan's run completes the spec: it moves it to `archive/` and deletes its approval record, although plans 2–5 remain. It was reverted by hand on each PR branch.

Decided by the author on 2026-10-05. Write it into §9 as a decided question, giving its options and losses, and do not reopen it:
- **A required plan field says it**, e.g. `completes-spec: true|false` (the spec pins the name, place and spelling). The run completes the source spec only when the field is true, and the chain gate still applies on top. `plans lint` and the `phax-planning` skill carry the field.
- Rejected: completing a spec only by hand (`phax artifact complete`, never at run end). That loses the spec's completion landing in the same merge as the last plan's work, which spec 27 put there on purpose (the run PR carries the archival commit).
- Rejected: inferring "last" from anything phax can see. Nothing persisted says how many plans a spec will have.

Project rules that apply:
- **No back-compat shims in persisted formats.** The new field is required, not optional for old plans.
- **Explicit per-variant values over a permissive superset.** Say what the field means, and whether it may appear, on a plan with `source-spec: null`.

What the spec must cover:
- **Where the field lives.** The plan's YAML frontmatter, beside `status`, `source-spec` and `approved`, is the natural place: lineage lives there. Weigh it against the plan document (the headless JSON sidecar, `src/schemas/planDocument.ts`, which carries `sourceSpec`) and `phax-plan.json`, and say how the three stay consistent. That includes `phax artifact new plan` writing it, and headless authoring's plan document schema and renderer.
- **Fingerprint and staleness.** The approval fingerprint ignores only `status` and `approved` (`fingerprintSource`). Say whether changing the field makes a plan `self-changed`, and confirm that is intended.
- **Run completion.** In `completeRunArtifacts.ts`, `true` with the chain gate clear completes the spec. `true` with the gate blocked by another live plan keeps today's skip report. `false` never touches the spec, and the run's report and PR body say so.
- **Validation.** `plans lint` refuses a missing field, and a value inconsistent with `source-spec` if the spec makes one. Say whether lint also warns about two live plans that both say `true` for the same spec, or a spec whose live plans all say `false`. These are judgement calls; keep them advisory or out.
- **Migration of live plans.** Every live plan (not under `archive/`) must gain the field; archived plans are never revalidated. In this repository that is a handful of plans. Say how: by hand in the implementing plan, or by a one-time command. Recommend by hand, since nobody else runs multi-plan specs.
- **Docs.** The planning skill (when a plan is the last of its spec), the README's plan-lifecycle text, and `phax --usage` if any help text names the completion.

Ground to read first:
- `src/app/completeRunArtifacts.ts`; `src/app/artifactStatus.ts` (`findDependentPlans`, the chain gate);
- `src/domain/artifact/frontmatter.ts`, `src/domain/artifact/lineage.ts` (`readSourceSpec`), `src/domain/artifact/document.ts` (validation);
- `src/schemas/planDocument.ts`, `src/domain/authoring/` (the plan renderer), `src/app/lintPlan.ts`;
- `.claude/skills/phax-planning/SKILL.md` §"Plan frontmatter block";
- the archived spec that put the archival commit on the run PR (spec 27: search `docs/specs/archive/` for "run-pr" or "carries");
- NEXT_STEPS.md (the entry above, and §"Road to 1.0.0" — this changes the plan format before the freeze).

Constraints:
- No change to the chain gate's own rule, to spec completion by hand (`phax artifact complete`), or to plan completion.
- Test plans and specs are made up.
- Out of scope: approval-ground; the per-file approval records (shipped in 0.19.0); batching multiple plans per run (spec 24).
- Keep §9 to the decided question above, plus genuine choices the ground forces, each with options, losses and a recommended default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
