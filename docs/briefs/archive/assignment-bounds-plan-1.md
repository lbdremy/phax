Write the phax plan "Architecture report parts" for the approved spec `docs/specs/2610201350-assignment-bounds.md`. It is the first of the spec's plans, so it carries `completes-spec: false`. Read the spec in full; its five arbitrations are settled, so do not reopen them.

This plan ships only the architecture-report change. It goes first because it does not depend on the plan-document change, and the 0.26.0 cut waits for it (spec §10). If 0.26.0 is cut with the body-only report, the change costs a frozen copy and a lift.

In scope:
- §5.1–§5.3: the report becomes `{ $schema, body, parts: [{ id, name, description, globs }] }`. It is refused when malformed, and phax renders it to Markdown on the stdout of `phax architecture`.
- The `architecture-report` §6 surface, and the `phax architecture` output as far as the parts go.
- The §8 criteria "The report's parts are rendered", "The report schema requires parts" and "A body-only or malformed report is unreadable".
- The docs that describe the report: `docs/architecture-provider.md`, the README Architecture provider subsection and persisted-formats row, the `architecture` long help in `src/cli/cliDocs.ts` (the regenerated usage spec and CLI reference), and the phax-cli skill's line on the report, if it names the shape.

Out of scope (later plans):
- the bounds (`assignments` in phax.json), `phax validate`, and the bounds check shared by lint and the run preflight;
- `phax architecture` printing the bounds, the headless prompt and the grant with bounds;
- the `modelReason` → `assignmentReason` rename and its plan-document lift. These ride the joint plan-document change with `interactive-phases` and `oracle-phases`.

Ground to read:
- `phax architecture` as it landed (PR #148): `src/schemas/architecture.ts`, `src/schemas/persisted.ts` (`readArchitectureReport`), `src/app/architectureProvider.ts`, `src/cli/commands/architecture.ts`, `packages/schemas/src/formats/architecture.ts`, and their tests (`tests/unit/schemas/architecture.test.ts`, `tests/integration/architectureProvider.test.ts`, `tests/integration/architectureCommand.test.ts`, `tests/unit/schemasPackage/architectureFormats.test.ts`).
- `src/schemas/schemaUrl.ts`, `docs/release.md`, `packages/schemas/history.lock.json`. Confirm the `architecture-report` format is still unreleased, only a `next` snapshot, so its shape changes in place with no frozen copy and no lift. Say so in Technical arbitrations. If it was cut, stop and raise an open question.
- The rendering of a report: today `pullArchitecture` returns the body and the command prints it. Rendering belongs in pure domain code (for example `src/domain/architecture/`), and the CLI prints what it gets.

Points left to the plan, settled in Technical arbitrations:
1. **The glob dialect.** Spec §10 leaves it open. It must be the one later plans use to match bounds and parts against planned files. It must be described in the `architecture-report` JSON Schema's `globs` annotation, so a provider knows what to emit. phax requires Node ≥ 24, whose `node:path` has `matchesGlob`, and the repository has no glob library today. Prefer the built-in unless the code shows a reason not to, and say what the dialect supports (`**`, `*`, `?`, braces?).
2. **What makes a part `id` valid** (for instance a kebab-case slug, as `phax.json` bounds will name it), and whether `globs` entries are checked for syntax at decode or only for non-emptiness.
3. **The rendered Markdown's exact layout** for the parts, following §6. With path arguments, the provider answers for those paths, and phax renders what it gets.

Constraints:
- **Layers** as in CLAUDE.md. Decode at the boundary, render in pure domain code, print in the CLI with no logic.
- **No back-compat shims.** `parts` is required (it may be an empty list), and unknown keys are refused. There are no optional fields.
- **Fixtures** are made up (`acme-guard`, `acme-billing`, `src/core/decide/**`). Tests never read `~/.phax`. They assert `$schema` URLs by format id and release pattern, never by the running version. A snapshot test must hold both before and after the release cut (`next` or `X.Y.Z`), as `tests/unit/schemasPackage/architectureFormats.test.ts` does now.
- **Security:** no new command, grant or session permission. If a choice would widen one, it is an open question, not a Technical arbitration.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason` not yet existing: use the current `modelReason` field.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- the pages above;
- the regenerated usage spec and CLI reference;
- `NEXT_STEPS.md`: move `assignment-bounds` to In flight, plan 1 of N, the report change landed.

Phase shape: one phase if the gates allow it. This is a format change with its renderer, tests and docs, and every commit must be green.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
