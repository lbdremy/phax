---
status: Completed
source-spec: docs/specs/2610201350-assignment-bounds.md
completes-spec: false
approved:
  date: 2026-10-20
  baseline: "1819358"
---
# Architecture report parts

First plan of the spec `assignment-bounds`. It ships only the architecture-report change (spec §5.1–§5.3): the report an architecture provider prints becomes `{ $schema, body, parts: [{ id, name, description, globs }] }`. phax refuses a malformed report with one line and exit 1. `phax architecture` renders the report to Markdown on stdout: the body as is, then each part's name, id, description and globs, in the report's order. It covers the §6 `architecture-report` surface, the `phax architecture` output as far as the parts go, and three §8 criteria: "The report's parts are rendered", "The report schema requires parts" and "A body-only or malformed report is unreadable".

This plan goes first because it does not depend on the plan-document change, and the 0.26.0 cut waits for it (spec §10). The bounds (`assignments` in phax.json), `phax validate`, the bounds check shared by lint and the run preflight, `phax architecture` printing the bounds, the headless prompt and the grant with bounds, and the `modelReason` → `assignmentReason` rename all belong to later plans of this spec.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

All three are already allowed by `security.agentCommands` in phax.json (`pnpm exec tsx`, `pnpm gen:usage-spec`, `pnpm docs:cli`), so phax.json needs no change. They are declared so the preflight confirms coverage: `pnpm exec tsx scripts/schemas-check.ts --write` regenerates the `architecture-report` `next` snapshot, and the other two regenerate the usage spec and the CLI reference after the `architecture` long help changes.

## Technical arbitrations

- The `architecture-report` format is unreleased, so its shape changes in place. The only snapshot is `packages/schemas/snapshots/architecture-report/next.schema.json`; `packages/schemas/history.lock.json` names no frozen module for it; and package.json names the opened 0.26.0. The phase edits the current schema, regenerates the `next` snapshot, and adds no frozen copy, no lift and no stamp change. Loss accepted: none. A provider written against the body-only 0.26.0 `next` shape was never released.
- Glob dialect: phax's own small dialect, not Node's `path.matchesGlob`, and no glob library. Globs and the paths they match are working-tree-root-relative POSIX paths, compared case-sensitively and the same on every host. Only `**` (a whole segment, zero or more segments), `*` (zero or more characters within one segment) and `?` (one character other than `/`) are special. A leading dot is not special, so `docs/**` covers `docs/.vitepress/config.ts`. Every other character is literal, including `[`, `]` and `!`. Node's `matchesGlob` goes through its bundled minimatch with case folding on macOS and Windows, so the same bound could govern different phases on a Mac and on Linux CI. The release binary also runs on Deno's Node compatibility layer, where no gate checks the API. This plan describes the dialect in the `globs` annotation of the `architecture-report` JSON Schema and enforces its syntax at decode. The matcher itself ships with the bounds plan, which uses this dialect for both part globs and globs bounds. Loss accepted: braces and character classes. A provider writes `docs/**` and `*.md` as two globs, not `{docs/**,*.md}`.
- Part ids and glob syntax are checked at decode. A part `id` is a kebab-case slug, `^[a-z0-9]+(-[a-z0-9]+)*$`, since phax.json bounds will name it as `"part": "core-decide"`. It is unique within the report. Each glob is refused at decode when it is empty, starts with `/`, contains a backslash, `{` or `}`, has an empty, `.` or `..` segment (a trailing `/` included), or uses `**` inside a segment (`src/**.ts`, `a**`). Such a glob would never match a root-relative planned file, or would mislead its author about what it matches. Refusing it at decode turns a typo into the §5.2 one-line report error, not a silent non-match in a later lint. Loss accepted: a provider whose globs break these rules gets no answer until it fixes them.
- Rendered layout: the body with its trailing newlines stripped, then nothing more when `parts` is empty. Otherwise a blank line, `## Parts`, and per part a blank line, `### <name> (`<id>`)`, the description on the next line and one `- `<glob>`` bullet per glob, in the report's order. Name and description are folded onto one line. With path arguments, the provider answers for those paths and phax renders whatever parts it returns. Loss accepted: the body is no longer the whole stdout. An agent that parsed the old output as the body alone now also reads a `## Parts` section.
- Report flow: `pullArchitecture` answers the decoded report without `$schema`, `{ body, parts }`, not printable text. The later lint and run-preflight plans resolve part bounds from that same call with `files: null`. A pure domain function renders it, and the CLI prints the rendered string. Loss accepted: the CLI makes one render call instead of printing the result field as is.

## Arbitrated questions

### q-skill-edit — The phax-cli skill describes the `architecture` provider as answering "with the repository's architecture as a Markdown body" (`.claude/skills/phax-cli/SKILL.md`, the `architecture` config bullet). Does this plan's phase update that line, which means the run needs `--allow-skill-edits`, or does the update ride a later plan of this spec?

- defer-to-bounds-plan — Leave the skill untouched here. The bounds plan, which already has to document `assignments` among the phax-cli skill's config keys and edit the phax-planning skill, also updates the report line. — abandons: An up-to-date phax-cli skill between this plan's merge and the bounds plan's: for that window an agent reading the skill learns of the body but not of the parts. The CLI help, the docs page and the README are correct.
- edit-in-phase — List `.claude/skills/phax-cli/SKILL.md` in phase-01's planned edits, and run the plan with `phax run --allow-skill-edits`. — abandons: A phase session with no write access under `.claude/`. With the flag, the phase agent can rewrite the phax-cli skill, which Claude Code loads as instructions in every later session of this repository and which ships in the npm package. A wrong or injected instruction there steers later agents until a reviewer catches it in the PR.

Recommendation: defer-to-bounds-plan — The edit widens the phase session's write scope to a skill file, which is a security loss, so it is the operator's decision. The bounds plan has to run with `--allow-skill-edits` anyway, to document `assignments` and to teach the bounds in the phax-planning skill. Folding the one-line report update into it widens no session that would not be widened already. In the meantime the stale wording is incomplete, not wrong: the report still carries a Markdown body. The phase below is written for this recommendation. If `edit-in-phase` is chosen, add `.claude/skills/phax-cli/SKILL.md` to phase-01's planned files to edit, update the bullet to name `{ body, parts }`, and run with `--allow-skill-edits`.

Decision: defer-to-bounds-plan — by operator (Rémy Loubradou), 2026-10-20
Why: Decided by the operator on 2026-10-20, as recommended: this plan leaves the phax-cli skill untouched and runs without --allow-skill-edits. The bounds plan, which edits the skills anyway, updates the report line. Advocate: An up-to-date phax-cli skill from this plan's merge on, with no window where it names the body but not the parts. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-01.

## Decision log

- 2026-10-20 q-skill-edit decided defer-to-bounds-plan — operator (Rémy Loubradou)

---

## phase-01 — Architecture report parts, refused when malformed and rendered by phax architecture {#phase-01-architecture-report-parts}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An architecture provider's report carries `parts`, each with `id`, `name`, `description` and `globs`, beside its Markdown `body`. phax refuses a report without `parts`, with a repeated part id, an unknown key, an empty `globs` or a glob outside the dialect, with one line and exit 1. `phax architecture` prints the body followed by the parts, rendered to Markdown, in the report's order.

### Detailed instructions

- Schema (`src/schemas/architecture.ts`). Extend `ArchitectureReportFileSchema` to exactly `$schema`, `body` and `parts`, all three required. Every other key stays refused, since `onExcessProperty: "error"` is already set. Add an `ArchitecturePartSchema` struct with exactly `id`, `name`, `description` and `globs`, all required. This file is in the schemas-package closure (`tests/unit/architecturalGuards.test.ts`), so it may import only from `effect` and sibling schema modules: no `node:` import.
- Part `id`: a non-empty string matching `^[a-z0-9]+(-[a-z0-9]+)*$`. Use `Schema.pattern`, so the JSON Schema carries the pattern. Annotate it as the part's stable id, the one a phax.json bound names. `name`: `Schema.NonEmptyString`, described as shown to the agent and never interpreted by phax. `description`: `Schema.NonEmptyString`, described as one sentence on what the part holds.
- Part `globs`: `Schema.NonEmptyArray` of glob strings. Define the glob string as `Schema.NonEmptyString` piped through a `Schema.filter` that refuses: a leading `/`; a backslash; `{` or `}`; an empty segment (from `//` or a trailing `/`); a segment equal to `.` or `..`; and `**` that is not a whole segment (`src/**.ts`, `a**`, `**b`). The filter message names the glob and the rule broken, for example `"src/**.ts" uses ** inside a segment`. Give the filter a `jsonSchema: { description }` annotation, as `uniqueFindingIds` in `src/schemas/report.ts` does.
- The `globs` annotation states the dialect so a provider knows what to emit: working-tree-root-relative POSIX paths, matched case-sensitively and the same on every host. `**` as a whole segment matches zero or more segments, `*` matches zero or more characters within a segment, and `?` matches one character other than `/`. A leading dot is not special. Every other character is literal, `[`, `]` and `!` included. Braces are refused. A glob covers files, so write `src/core/**` to cover a directory.
- `parts`: `Schema.Array(ArchitecturePartSchema)`, possibly empty, piped through a `Schema.filter` that refuses two parts sharing an `id`. The message names the id, for example `part id "core-decide" is used twice`. Add a `jsonSchema` description saying phax's parser checks it, as `uniqueFindingIds` does. Write a small local helper, or reuse `uniqueFindingIds` only if its message reads right for parts: it says "finding id", so a local filter is likely cleaner. Annotate `parts` as the parts of the code the report describes, possibly empty, with no model or effort anywhere. Update `body`'s description to say phax prints it as is, before the parts, and never parses it. Update the file's header comment, which says phax prints the body as is.
- Types: export `ArchitectureReport = Omit<ArchitectureReportFile, "$schema">`, beside the existing `ArchitectureRequest`. Export `ArchitecturePart` (the part type) only if another module or test imports it. knip fails on unused exports. Keep the glob schema unexported unless a test imports it: the bounds plan exports it when phax.json needs it.
- Snapshot: run `pnpm exec tsx scripts/schemas-check.ts --write` to regenerate `packages/schemas/snapshots/architecture-report/next.schema.json`. Confirm that only that snapshot changes and that no file is created under `src/schemas/history/`. The format is unreleased: no frozen copy, no lift, no change to `history.lock.json` or to stamps. If the write command changes anything else, such as `packages/schemas/src/generated/index.ts`, stop and explain it in the handoff.
- Renderer: create `src/domain/architecture/render.ts`, exporting `renderArchitectureReport(report: ArchitectureReport): string`. It is pure. Output: the body with its trailing newlines removed. If `parts` is empty, nothing more. Otherwise append `\n\n## Parts`, then for each part in order `\n\n### <name> (`<id>`)\n<description>` followed by `\n- `<glob>`` for each glob in order. Fold `name` and `description` onto one line with `onOneLine` from `src/domain/reportText.ts`. The result has no trailing newline: `out.log` adds it.
- App (`src/app/architectureProvider.ts`): change `PullArchitectureResult`'s answered variant to `{ kind: "answered"; report: ArchitectureReport }`, the decoded report without `$schema`, and update its doc comments. Leave the refused and failed paths unchanged. A malformed report already fails through `readArchitectureReport` and `describeReportIssue` as one line starting `architecture provider:`. Check that the missing-`parts`, duplicate-id and unknown-part-key cases each produce one line naming the reason (`parts`, the repeated id, the unknown key `model`).
- CLI (`src/cli/commands/architecture.ts`): on `answered`, print `renderArchitectureReport(result.report)` with `out.log` and exit 0. Nothing else changes: the no-provider line and exit 1, the refusals and failures on stderr with exit 1, and the config error with exit 2. Keep the handler thin.
- Docs: rewrite the report section of `docs/architecture-provider.md` for `{ $schema, body, parts }`. Use the spec §6 example, made up (`acme-billing`, `core-decide`, `src/core/decide/**`). Say that `parts` may be empty, that ids are kebab-case and unique, and that `globs` is non-empty. Describe the glob dialect, and state that no model or effort appears anywhere. Show the rendered `phax architecture` output from §6: body, `## Parts`, each part. Add a malformed report to the "When it fails" examples, such as `✗ architecture provider: … parts …`. Update the README Architecture provider subsection so it says `phax architecture` prints the body and the parts the provider answers. The persisted-formats row names no shape, so leave it unless a column becomes wrong.
- CLI help: update the `architecture` long help in `src/cli/cliDocs.ts`. The report is `{"$schema", "body", "parts"}`: give each part's keys, the id rule and the glob dialect in one or two sentences. phax prints the body, then the parts, rendered to Markdown, and never parses the body. Also list a malformed report (missing `parts`, a repeated id, an unknown key, an empty or refused glob) among the exit-1 cases. Then run `pnpm gen:usage-spec` and `pnpm docs:cli` to regenerate `phax.usage.kdl` and `docs/cli/reference.md`. Do not hand-edit either generated file.
- `NEXT_STEPS.md`: move `assignment-bounds` from Drafts to In flight. Name the spec `docs/specs/2610201350-assignment-bounds.md` and say: plan 1 of N (architecture report parts), the report change landed, and the bounds, the plan-document rename and the rest follow in later plans. Keep the existing bullets about the joint release with `interactive-phases` and `oracle-phases`. Remove the line saying the 0.26.0 cut waits for the report change, since it no longer waits.
- Fixtures stay made up (`acme-guard`, `acme-billing`, `src/core/decide/**`). Tests never read `~/.phax`: the command test already points HOME at a temp dir. Assert `$schema` URLs by format id and release pattern, never by the running version. A snapshot assertion must hold before and after the release cut, so read the snapshot named `CURRENT_SHAPES["architecture-report"]`, which is `next` now and `X.Y.Z` after the cut.

### Planned files to create

- `src/domain/architecture/render.ts`
- `tests/unit/architecture/render.test.ts`

### Planned files to edit

- `src/schemas/architecture.ts`
- `packages/schemas/snapshots/architecture-report/next.schema.json`
- `src/app/architectureProvider.ts`
- `src/cli/commands/architecture.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/unit/schemas/architecture.test.ts`
- `tests/unit/schemasPackage/architectureFormats.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/integration/architectureProvider.test.ts`
- `tests/integration/architectureCommand.test.ts`
- `docs/architecture-provider.md`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `packages/schemas/src/formats/architecture.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`
- `src/schemas/persisted.ts`

### Boundary contracts

Producer (an architecture provider) → phax: the `architecture-report` on stdout is `{ $schema, body, parts }`. `parts` is a possibly empty list of `{ id, name, description, globs }`, with ids unique kebab-case slugs and globs non-empty, in phax's dialect. No other key is allowed, and no model or effort. phax refuses any other shape with one line naming the architecture provider and exits 1.

App → consumers (the CLI now, the lint and run-preflight bounds check later): `pullArchitecture` answers `{ kind: "answered", report: { body, parts } }`. The decoded report without `$schema` is the stable shape later plans resolve part bounds from.

Domain → CLI: `renderArchitectureReport(report): string` in `src/domain/architecture/render.ts` is the only place the report becomes Markdown. The CLI prints its result as is.

### Test strategy

Write the schema and renderer tests first: they pin the contract.

- `tests/unit/schemas/architecture.test.ts` (schema, unit). Decodes `{ $schema, body, parts: [] }` and the spec §6 report with three parts. Refuses: a missing `parts`; a fourth top-level key; two parts sharing `core-decide`, where the message names the id; a part with `model`; a part missing each of its four keys; an empty `globs`; an id that is not kebab-case (`Core_Decide`, `core--decide`, `-core`); and each refused glob (`/src/**`, `src\\core`, `{docs,src}/**`, `src//x`, `src/`, `./src/**`, `src/../x`, `src/**.ts`). Accepts `*.md`, `docs/**`, `src/*/schemas/**`, `src/[id].tsx` and `.env`. `readArchitectureReport` with a body-only report stamped at `CURRENT_STAMPS["architecture-report"]` returns a malformed error whose reason names `parts`.
- `tests/unit/architecture/render.test.ts` (domain, unit). With empty parts, the output is exactly the body. The §6 report renders to the exact expected string: body, blank line, `## Parts`, three part sections in order, each glob as a bullet. Trailing newlines of the body are stripped. A name or description containing a newline is folded onto one line.
- `tests/unit/schemasPackage/architectureFormats.test.ts` and `documents.ts` (schemas package). The valid report fixture gains `parts`. Add the §8 criterion "The report schema requires parts": read the snapshot named `CURRENT_SHAPES["architecture-report"]` and assert that the top-level `required` is `$schema`, `body`, `parts`; that the part items require `id`, `name`, `description`, `globs`; and that both levels have `additionalProperties: false`. Also refuse a report without `parts` through `parseArchitectureReport`.
- `tests/integration/architectureProvider.test.ts` (app with the real shell). The answered result is `{ kind: "answered", report: { body, parts } }`. A body-only report, a report with a repeated id and one whose part carries `model` each fail as one line starting `architecture provider` and naming the reason.
- `tests/integration/architectureCommand.test.ts` (CLI). The provider fixture prints a report with `parts`. Add the §8 criterion "The report's parts are rendered": with the §6 report and no `assignments`, stdout is the body followed by `core · decide` (`core-decide`), `http · requests` (`http-requests`) and `docs` (`docs`), each with its description and globs, in that order; nothing else is printed; exit 0. Add "A body-only or malformed report is unreadable": for each of the three malformed providers, empty stdout, one stderr line naming the architecture provider and the reason, exit 1. Keep the no-provider, failure and worktree cases green, with fixtures updated to carry `parts`.

### Implementation order

1. Write the schema tests and change `src/schemas/architecture.ts` (part struct, id pattern, glob syntax filter, unique-id filter, annotations, the `ArchitectureReport` type).
2. Regenerate the `next` snapshot with `pnpm exec tsx scripts/schemas-check.ts --write`, then update the schemas-package tests and `documents.ts`.
3. Write the renderer test, then `src/domain/architecture/render.ts`.
4. Change `pullArchitecture`'s answered variant and its integration tests.
5. Change the CLI handler and the command integration tests (§8 criteria).
6. Update `src/cli/cliDocs.ts`, then run `pnpm gen:usage-spec` and `pnpm docs:cli`.
7. Update `docs/architecture-provider.md`, `README.md` and `NEXT_STEPS.md`.
8. Run the standard gate profile locally: format, typecheck, test:type, lint, test, knip, audit:architecture.

### Excluded scope

- Bounds: `assignments` in phax.json, its schema, the project-only refusal and `phax validate` (later plan).
- The glob matcher itself. This phase fixes the dialect, documents it in the schema and enforces its syntax at decode. Matching a planned file against a glob ships with the bounds plan.
- The bounds check shared by `phax plans lint` and the run preflight, and the architecture provider call it makes with `files: null`.
- `phax architecture` printing the bounds, the headless plan prompt and the `phax architecture` grant with bounds declared.
- The `modelReason` → `assignmentReason` rename, the plan-document shape and its lift: these ride the joint plan-document change with `interactive-phases` and `oracle-phases`.
- `.claude/skills/phax-cli/SKILL.md` and every other `.claude/` file, pending q-skill-edit (recommended: the bounds plan updates the report line).
- The architecture request's shape, and the `architecture` key's description in `src/schemas/phaxConfig.ts` and the generated config JSON Schemas.
- `docs/upgrading.md`: the format is unreleased, so there is no upgrade step.

### Verification

The project's configured `standard` gate profile in phax.json: format, typecheck, test:type, lint, format:check, test, knip, audit:architecture and the model-catalog check on every phase; build, site:build, deno:smoke and deno:smoke-binary at the terminal phase.

### Expected handoff content

- The final shape of `ArchitectureReportFileSchema`, the exported `ArchitectureReport` type, and whether `ArchitecturePart` and the glob schema are exported, with their exact names. The bounds plan reuses the glob syntax check and the dialect.
- The exact rules the glob filter refuses, and its message format.
- The path and signature of `renderArchitectureReport` in `src/domain/architecture/render.ts`.
- The new answered variant of `PullArchitectureResult`.
- Confirmation that only `packages/schemas/snapshots/architecture-report/next.schema.json` changed among snapshots, with no frozen module and no `history.lock.json` change.
- The one-line messages observed for a body-only report, a repeated id and an unknown part key.
- An explanation for every deviation phax flags in the file reconciliation, such as an optional file touched for a reason worth noting, or a planned file left untouched.

### Commit subject

`feat(architecture): add parts to the architecture report and render them`

### Commit body

The architecture report an architecture provider prints is now
{ $schema, body, parts }. Each part carries exactly id, name, description
and globs: the id is a unique kebab-case slug, and globs is non-empty and
written in phax's dialect (root-relative POSIX, case-sensitive, only **, *
and ?). A report without parts, with a repeated id, an unknown key, an
empty globs or a refused glob fails with one line and exit 1.

`phax architecture` now renders the report to Markdown: the body as is,
then each part's name, id, description and globs, in the report's order.
The rendering is pure domain code; pullArchitecture answers the decoded
report, so later plans can resolve part bounds from it.

The format is unreleased, so the next snapshot is regenerated in place,
with no frozen copy and no lift. The provider guide, the README, the
architecture long help, the usage spec and the CLI reference describe the
new shape.

First plan of the assignment-bounds spec (spec §5.1–§5.3).
