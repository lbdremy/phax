Write the phax plan "Decide from verdicts" for the approved spec `docs/specs/2610191226-artifact-decide-verdicts.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled, so do not reopen them:
- the operator decisions of 2026-10-19 in §9b: q-note `note-on-departure`, q-unnamed `stay-open`, q-off-menu `own-option`, q-why `phax-sets-why`, q-by `operator-declared`, q-provider `routed`, q-model `own-default` and q-hand `both`;
- everything §10 lists as settled.

**Release context.** The spec was written on 2026-10-19, at 0.25.0; read its examples' `$schema` releases as "the open release". Since then:
- 0.26.0 and 0.27.0 shipped. 0.28.0 is the open release (package.json 0.28.0, last tag v0.27.0).
- `src/schemas/release.ts` now stamps spec-document at 0.27.0 (released), and plan-document and phax-plan at 0.28.0. Both are already changed in the open release by `test-strategy` (#164), so their `next` snapshots exist and are not yet released.
- decision-record-manifest and hand-decision-answer are at 0.25.0.
- Follow `docs/release.md` to decide whether accepting `other` as a chosen id moves the spec-document stamp, and say so in Technical arbitrations. If it does, freeze spec-document 0.27.0 the way 0.25.0 was frozen for 0.27.0 (`src/schemas/history/spec-document/0.25.0.ts`, `src/domain/authoring/renderSpecV0_25_0.ts`). §10 says nothing is migrated, since every existing document stays valid.

What already exists (read it before planning):
- **Interactive decide:** `src/app/decideArtifact.ts` (its preconditions in order, the handBack with one corrective resume, the diff and confirm, the commit with its trailers, and the decision record), `src/domain/decide/`, and `src/cli/commands/` for `artifact decide`.
- **The question schemas and checks:** `src/schemas/questions.ts`. They are shared by spec-document and plan-document and used by the hand §9 parser.
- **The hand decision answer** (`src/schemas/handDecisionAnswer.ts`), the decision record (`src/schemas/decisionRecord.ts`) and the records write path.
- **Headless authoring:** `src/app/authorArtifact.ts`, with model routing, the kept session `session.json` (`src/schemas/authoringSession.ts`), and the authoring prompt (`src/domain/authoring/prompt.ts`). The prompt now carries the source spec's criterion ids; see #164.
- **The decide doctrines:** the skills `.claude/skills/phax-decide-spec/SKILL.md` and `phax-decide-plan/SKILL.md`. The phax-spec and phax-planning skills state the question rules.
- **`--by` on approve and reopen:** `src/schemas/approvedBy.ts`.
- **`phax artifact schema <kind>`.**
- **The phase guard** classification of `artifact decide`.
- **The snapshot tooling:** `packages/schemas/build/snapshots.ts`, `scripts/schemas-check.ts --write`, `packages/schemas/history.lock.json` and `tests/unit/frozenHistory.test.ts`.

Settle in Technical arbitrations what §10 leaves to the plan, with the dominant loss of each:
- the verdicts format id and its `$schema` URL;
- the `phax artifact schema` argument;
- the report layout and the `--json` key spelling;
- the commit subject and the spelling of the trailers;
- the decision record layout for `mode: verdicts`.

The decide model is also yours to settle: the writer's built-in default under q-model, and how it resolves through routing (q-provider). Use the cheapest catalog entry the spec's transcription task allows, by the phax-planning skill's model policy, and say why.

Lessons from recent reviews (#157, #158, #161–#164). Plan for these from the start:
1. **Every in-scope §8 criterion has its own test**, named in the plan with its criterion id on the test line. Every refusal and every check has its own case.
2. **Published JSON Schemas match the decoders.** The verdicts format is strict (`additionalProperties: false`, every key required), and its schema is printed by `phax artifact schema` and published.
3. **All I/O goes through ports**, including the verdicts file and stdin.
4. **Tests never read real homes:** not `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, nor the global git config. Use `tests/helpers/isolatePhaxHome.ts` and `isolateGit.ts`, and give a spawned CLI `env: phaxHomeEnv()`.
5. **A refusal names its remedy, and refuses before any session, writing nothing.**
6. **Paths read from a document or a file are guarded.** The verdicts file's `artifact` must name the artifact given on the command line, and must never lead phax to read outside the repository.
7. **The docs say exactly what the code does.** Check every README, docs and help sentence the plan dictates against the code.
8. **The drift tests pass.** They cover the generated usage spec, the CLI reference and the published schemas. Regenerate with `pnpm gen:usage-spec`, `pnpm docs:cli` and `pnpm exec tsx scripts/schemas-check.ts --write`, and never edit generated output by hand.
9. **Interactive decide is unchanged**, apart from accepting a verdict that chooses `other`. A test pins that: its prompt, its model rule and its attribution.

Constraints:
- **Layers** as in CLAUDE.md. Matching verdicts to questions and every transcription check are pure domain functions. The CLI command parses, calls one use case and renders.
- **No back-compat shims.** The verdicts format is born with `$schema` and every key required. Use explicit per-variant enums: the decision record's `mode` is interactive | verdicts, each with its own outcome set.
- **No approval.** Verdicts mode never writes approval records or the `approved` stamp. The artifact stays Draft.
- **Autonomy.** phax stays autonomous: verdicts mode needs no terminal and waits on nobody.
- **Fixtures** are made up. Tests name current-shape `$schema` URLs through the release table, never a hard-coded release.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Skill edits:** the decide doctrines, phax-spec and phax-planning skills change, so the plan says `phax run --allow-skill-edits`.
- **Models:** follow the phax-planning skill's model policy, with an `assignmentReason` for any phase that departs from the default. This repository declares no assignment bounds.
- **Lint:** the plan must pass `phax plans lint`, which now checks test lines (#164). Write every `### Test strategy` in the line format, naming the spec's criterion ids from its sidecar.
- **Oracle pair:** use one only where a phase's guarantees are a stable contract the oracles can call before the code exists (the verdict-matching and transcription checks are a candidate). If you use one, follow the skill's oracle rules, and keep the oracle files and any fixture paths they rely on fixed between the oracle and the discharging phase. If you don't, say why.

Docs:
- `docs/arbitration.md`, §11, with the example updated to the open release;
- `docs/upgrading.md` `### 0.28.0`, only if a user must do something;
- README, wherever it describes `artifact decide` and `artifact schema`;
- the skills listed above;
- `NEXT_STEPS.md`: move `artifact-decide-verdicts` out of "Approved, not yet planned" in the closing phase.

Phase shape: as few phases as the gates allow, from the core outwards, with every commit green. A likely order (adjust any boundary that is wrong):
1. the formats: the verdicts format, `other` in the question checks, and the decision record's verdicts mode;
2. matching and the transcription checks;
3. the use case and the writer session;
4. the CLI (`--verdicts`, `--by`, `--json`, `artifact schema`);
5. the skills and the docs.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
