---
status: Approved
source-spec: docs/specs/2609230835-headless-authoring.md
approved:
  date: 2026-09-23
  baseline: 385c37d
---

# Headless authoring

> Implements the `headless-authoring` spec (Approved 2026-09-23). Planned
> 2026-09-23 against `main` @ `5ccc9360` (v0.15.0).

`phax artifact new spec|plan <slug> --headless --brief <file|->` spawns the authoring
session itself, accepts a schema-validated JSON document only, renders the Markdown
artifact deterministically, stamps and names it as the interactive path does, writes the
JSON sidecar beside it, commits both in one path-scoped commit, seeds the extraction cache
for a plan, and writes an authoring record. The interactive path is untouched. Both
document formats ship experimental.

The plan runs core-to-surface: schemas, then renderers, then config, then the use case,
then the CLI, then the sidecar's lifecycle, then the record, then the skills and docs. Each
phase leaves `pnpm check:full` green; new modules under `src/domain/authoring/` are not
knip entries, so every one of them is imported by its unit test in the phase that creates
it.

Spec section references below are to the `headless-authoring` spec (§5.N requirements,
§8 acceptance criteria by name).

---

## Required commands

- pnpm gen:usage-spec
- pnpm docs:cli
- pnpm dev schema upgrade

All three are already granted in `security.agentCommands` in `phax.json`. `pnpm
gen:usage-spec` regenerates `phax.usage.kdl` after any CLI change (phases 01, 05, 06,
07) and `pnpm docs:cli` regenerates `docs/cli/reference.md`; both have drift tests. `pnpm
dev schema upgrade` regenerates `phax.schema.json` after the config change (phase 03).

---

## Technical arbitrations

Resolved with the human on 2026-09-23.

- **The extraction cache is keyed on the plan body without its frontmatter, and
  `EXTRACTOR_VERSION` bumps to 2.** Today the key hashes the whole file; `artifact
  approve` rewrites the frontmatter, so a seed written at Draft would never match at run
  time. Accepted loss: every existing cache entry misses once (one extraction per plan
  that is off the fast path, once). Rejected: re-seeding at every transition (couples
  artifact transitions to the cache) and seeding at Draft only (makes spec §5.4's seed
  decorative).
- **`--brief -` is read by the CLI layer; the use case receives the brief's text and its
  path (or null).** The brief is command input like any argument. Accepted loss: one
  stream read in `src/cli/` at the boundary, outside a port. Rejected: `/dev/stdin`
  through the FileSystem port (not portable, not fakeable) and a dedicated port for one
  flag (the library-readiness work plans a wider host port later).
- Decided alone, one viable option each: the session runs through `Backend.runAgent`
  under the existing read-only review posture rooted at the repository (the brief names
  corpus paths the agent must read; only `.phax-context/` is writable); the document is
  the session's final message, as extraction already does; the skill text is read from
  the bundled `.claude/skills/<name>/SKILL.md` through the repo-rooted FileSystem layer,
  whose absolute paths pass through, from the bundle root the CLI already resolves for
  `phax skills`; session artifacts live under `<stateRoot>/authoring/<stamp>-<slug>/` so
  the record assembles from a folder exactly like a phase record; the artifact commit
  carries `Artifact:` and `Authoring-Id:` trailers so `records explain <sha>` resolves an
  authoring record the way `Run-Id`/`Phase-Id` resolve a phase record.

---

## phase-01 — Spec and plan document schemas, `artifact schema` {#phase-01-document-schemas}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Introduce the two document formats as Effect Schemas with their JSON Schema export, and
the `phax artifact schema spec|plan` subcommand that prints them, so a consumer can read
the contract without a model call (spec §5.3, §5.4, §5.10; §6 "Spec document", "Plan
document", "Schema access").

### Detailed instructions

- `src/schemas/specDocument.ts`: `SpecDocumentSchema` with `version: 1`, `kind: "spec"`,
  `title`, `ground[] {path, note}`, `context`, `problem`, `productGoal {statement,
  guidingRule}`, `terminology[] {term, definition}`, `requirements[] {id, title, pattern,
  statement}` with `pattern` a literal union `ubiquitous | event | state | unwanted |
  optional`, `surface[] {surface, binding, before, after}` where `surface` matches
  `^(cli|config|file|api|package|internal): ` (pattern-refined `NonEmptyString`),
  `binding` is `normative | indicative`, `before` is `NullOr(String)` and `after` a
  `NonEmptyString`; `nonGoals[]`, `acceptanceCriteria[] {id, name, given, when, then,
  refs[]}`, `openQuestions[] {id, question, options[] {id, label, abandons},
  recommendation, rationale}`, `planningNote {settled[], open[], constraints[]}`, and
  `docsPage` as a discriminated union `{kind: "page", page, reader, example} | {kind:
  "none", why}`. No optional fields.
- Add schema-level refinements (`Schema.filter`) for spec §5.3's traceability: every
  `refs` entry names an existing `requirements[].id`; every requirement is referenced by
  at least one criterion; every question has ≥ 2 options and `recommendation` names one
  of its option ids; requirement ids and question ids are unique. Refinement messages
  must name the offending path (`acceptanceCriteria[2].refs[0]: "5.9" names no
  requirement`) — the CLI prints the first violation verbatim (spec §5.2).
- `src/schemas/planDocument.ts`: `PlanDocumentSchema` with `version: 1`, `kind:
  "plan"`, `sourceSpec: NullOr(NonEmptyString)`, `run {shortName, title,
  requiredCommands[]}`, `preamble {summary, requiredCommandsNote, technicalArbitrations[]}`,
  and `phases[]` (non-empty) whose extracted fields reuse the exact field schemas of
  `ExtractedPhaseSchema` in `src/schemas/phaxPlan.ts` (export the per-phase pieces from
  there rather than duplicating them) plus `title`, `objective`, `detailedInstructions[]`,
  `boundaryContracts`, `testStrategy`, `implementationOrder[]`, `excludedScope[]`,
  `verification`, `expectedHandoff`. Export `projectExtractedPlan(doc): ExtractedPhaxPlan`
  — a pure projection that drops the informational fields and `title` and must decode
  through `ExtractedPhaxPlanSchema` with `onExcessProperty: "error"` (spec §5.4).
- Both files export `decodeSpecDocument` / `decodePlanDocument` (`decodeUnknownEither`,
  `onExcessProperty: "error"`) and `getSpecDocumentJsonSchema()` /
  `getPlanDocumentJsonSchema()` via `JSONSchema.make`, with a schema `title` of `phax
  spec document (experimental)` / `phax plan document (experimental)` (use
  `Schema.annotations({ title })` on the root struct).
- CLI: add `schema` under the `artifact` parent in `src/cli/commands/artifact.ts` with
  one positional `<kind>` restricted to `spec | plan` (Commander `choices`), printing the
  JSON Schema pretty-printed to stdout, exit 0; an unknown kind is a Commander usage
  error. Keep the command file free of logic beyond the choice → getter mapping.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`; give the new subcommand a `help`, a
  `long_help` that says both formats are experimental, and one `example`.

### Planned files to create

- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `tests/unit/specDocument.test.ts`
- `tests/unit/planDocument.test.ts`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/cli/artifact.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `tests/integration/usageSpecExamples.test.ts`

### Boundary contracts

- Consumer: phase-02's renderers and phase-04's use case need decoded `SpecDocument` /
  `PlanDocument` types and `projectExtractedPlan`. Producer: this phase, from
  `src/schemas/`. The projection's output type is `ExtractedPhaxPlan`, unchanged.

### Test strategy

- Unit, written first: a full valid spec document decodes; each refinement rejects with a
  message naming the path (missing ref target, uncovered requirement, one-option
  question, recommendation off-list, duplicate ids); an unknown top-level key is
  rejected; the JSON Schema title says experimental.
- Unit: a plan document projects to an `ExtractedPhaxPlan` that decodes strictly; a phase
  missing a required list is rejected; `kind` must be `"plan"`.
- Existing `tests/unit/cli/artifact.test.ts`: `artifact schema spec|plan` prints valid JSON
  with the expected title and exits 0.

### Implementation order

1. Schemas and refinements with their unit tests.
2. Projection and its tests.
3. CLI subcommand, usage/docs regeneration, CLI test.

### Excluded scope

- Rendering (phase-02), authoring (phase-04), config keys (phase-03).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported names from both schema files (decoders, JSON Schema getters,
  `projectExtractedPlan`, and the per-phase field schemas re-exported from
  `phaxPlan.ts`).
- The exact refinement message format, so phase-04's error rendering can cite it.
- Any file-plan deviation, with the reason.

### Commit subject

feat(schemas): spec and plan document schemas with `phax artifact schema`

### Commit body

Add the experimental spec document and plan document formats as Effect Schemas
with traceability refinements (criteria reference existing requirements, every
requirement is covered, questions carry two or more options and a
recommendation among them), a strict projection from a plan document to the
extracted-plan shape, and JSON Schema export. `phax artifact schema spec|plan`
prints either schema, titled experimental. Unit-tested; usage spec and CLI
reference regenerated.

---

## phase-02 — Deterministic renderers and body-keyed extraction cache {#phase-02-renderers-and-cache-key}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Render a spec document to the canonical ten-section Markdown plus a docs-page section,
and a plan document to the `phax-planning` shape that the deterministic parser reads back
to exactly its projection; re-key the extraction cache on the plan body so a seed
survives `artifact approve` (spec §5.4, §5.5; §6 "Rendered spec", "Rendered plan").

### Detailed instructions

- `src/domain/authoring/renderSpec.ts`: pure `renderSpecBody(doc: SpecDocument): string`
  producing the body only (no frontmatter; the caller prepends the interactive
  skeleton's frontmatter so the stamp/date logic stays in one place). Sections, in
  order: `# <title>`, `## 1. Context`, `## 2. Problem`, `## 3. Product goal` ending with
  the guiding rule as a blockquote, `## 4. Terminology` (bullets `**term** — definition`),
  `## 5. Functional requirements` with `### 5.N <title>` subsections and the statement,
  `## 6. Surface` with one `### <surface> — <binding>` per element, then the `after`
  block indented four spaces, or `before:` / `after:` labelled blocks when `before` is
  non-null, `## 7. Non-goals`, `## 8. Acceptance criteria` with `### <name>` and `Given
  …, when …, then …. (refs §5.a, §5.b)`, `## 9. Open questions for implementation
  planning` with `### Qn — <question>`, one `- <option label> — abandons: <abandons>`
  line per option, then `Recommendation: <label> — <rationale>.`, `## 10.
  Implementation-planning note` (Settled / Left open / Constraints paragraphs), `## 11.
  Docs page` (page, reader, example, or "None — <why>"), and a closing `## Ground`
  list is NOT added — ground goes into §1 as a trailing "Ground read:" list. Normalise
  line endings to `\n` and end with a single newline. Wrap nothing: prose is emitted as
  given.
- `src/domain/authoring/renderPlan.ts`: pure `renderPlanBody(doc: PlanDocument):
  string` emitting `# <run.title>`, the preamble summary, `## Required commands` (the
  list, or `- (none)`, then `requiredCommandsNote`), `## Technical arbitrations` (omitted
  when the list is empty), a `---` rule, then per phase `## <id> — <title>
  {<planMarkdownAnchor>}`, `**Recommended model:** <model>` / `**Recommended effort:**
  <effort>` on consecutive lines, the objective paragraph, and the `###` sections in the
  skill's order (Detailed instructions, Planned files to create, Planned files to edit,
  Optional files that may be edited, Boundary contracts, Test strategy, Implementation
  order, Excluded scope, Verification, Expected handoff content, Commit subject, Commit
  body), with `- (none)` for every empty list. Follow `src/domain/plan/parsePlanMarkdown.ts`
  as the oracle for every extracted field's spelling.
- `src/domain/planCache/key.ts`: `planCacheKey` hashes `splitFrontmatter(planMd)`'s body
  (fallback: the whole text when there is no block) and `EXTRACTOR_VERSION` becomes 2.
  Update the doc comment: moving, renaming or transitioning the file is a hit; any body
  edit is a miss.

### Planned files to create

- `src/domain/authoring/renderSpec.ts`
- `src/domain/authoring/renderPlan.ts`
- `tests/unit/renderSpec.test.ts`
- `tests/unit/renderPlan.test.ts`

### Planned files to edit

- `src/domain/planCache/key.ts`
- `tests/unit/planCacheKey.test.ts`

### Optional files that may be edited

- `tests/unit/loadOrExtractPlan.test.ts`
- `tests/integration/planCacheStore.test.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/unit/__snapshots__/renderSpec.test.ts.snap`
- `tests/unit/__snapshots__/renderPlan.test.ts.snap`

### Boundary contracts

- Consumer: phase-04 needs `renderSpecBody` / `renderPlanBody` and a stable cache key
  computed from the rendered text. Producer: this phase. Both renderers are total and
  pure; the key function keeps its signature.

### Test strategy

- Unit, written first: **round trip** — for a fixture plan document, `renderPlanBody` →
  `extractPlanDeterministic` (from `src/domain/plan/parsePlanMarkdown.ts`) succeeds and
  `finalizeExtractedPlan` equals `finalizeExtractedPlan(projectExtractedPlan(doc))`
  including titles; a phase with all three lists empty renders `- (none)` and parses.
- Unit: `renderSpecBody` is deterministic (two calls, identical output); §6 shows
  `before:`/`after:` blocks when `before` is non-null and only the `after` block when
  null; §9 shows one "abandons" line per option and the recommendation line; §11 renders
  both `docsPage` variants. A snapshot of a full fixture is acceptable in addition to
  the targeted assertions, not instead of them.
- Unit (`tests/unit/planCacheKey.test.ts`): same body with two different frontmatter
  blocks → same key; a body edit → different key; a plan without frontmatter keys on
  its full text.

### Implementation order

1. Cache key change and its tests (smallest, unblocks nothing but fails fast).
2. `renderPlan` with the round-trip test.
3. `renderSpec` with its tests.

### Excluded scope

- Frontmatter emission and file naming (phase-04 composes the interactive skeleton).
- Any change to `parsePlanMarkdown.ts` — the parser is the oracle, not the subject.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The two renderer signatures and the exact section/heading spellings they emit.
- Confirmation that the round-trip test covers titles, anchors, model/effort, the three
  lists and the commit fields.
- The new `EXTRACTOR_VERSION` value and the key's input (body sans frontmatter).
- Any file-plan deviation, with the reason.

### Commit subject

feat(authoring): deterministic spec and plan renderers; key the extraction cache on the plan body

### Commit body

Add pure renderers from a spec document to the canonical ten-section spec
(plus a docs-page section, §6 as before/after blocks, §9 in the arbitration
format) and from a plan document to the phax-planning shape, proven by a
round trip through the deterministic parser back to the document's
projection. Key the extraction cache on the plan body without its
frontmatter (extractor version 2) so a seed written at Draft still matches
after approval.

---

## phase-03 — Authoring config keys and default resolution {#phase-03-authoring-config}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Add the optional `authoring.{spec,plan}.{model,effort}` keys to `phax.json` and resolve
the three-layer default (flag → config → catalog) in one place (spec §5.1; §6
"`phax.json`, before → after"; §9 decision on defaults).

### Detailed instructions

- `src/schemas/phaxConfig.ts`: `AuthoringKindConfigSchema = Struct({ model:
  optional(NonEmptyString), effort: optional(EffortLiteral) })`, `AuthoringConfigSchema =
  Struct({ spec: optional(...), plan: optional(...) })`, wired as `authoring:
  Schema.optional(AuthoringConfigSchema)` in both `PhaxConfigSchema` and
  `PhaxUserOverlaySchema`. Export `DEFAULT_AUTHORING_MODEL = "claude-opus-5-5"`,
  `DEFAULT_AUTHORING_EFFORT: Effort = "high"`, `ResolvedAuthoringConfig = { spec:
  {model, effort}, plan: {model, effort} }`, and `resolveAuthoringConfig(raw)` mirroring
  `resolveCodeReviewConfig`. Add `authoring: ResolvedAuthoringConfig` to `ResolvedConfig`
  and fill it in `src/app/loadConfig.ts` (the overlay merge follows the pattern used for
  `review`).
- Export a pure `resolveAuthoringSelection({ flagModel, flagEffort, configured }) ->
  { model, effort }` next to `resolveAuthoringConfig` so the CLI passes flags through
  and the use case never reads config itself.
- Regenerate `phax.schema.json` with `pnpm dev schema upgrade`; update
  `phax.user.schema.json` the same way the review keys are reflected there.
- README `## Configure`: one paragraph documenting the `authoring` block with the exact
  §6 before → after example and the flag → config → catalog precedence.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`
- `tests/unit/loadConfig.test.ts`
- `README.md`

### Optional files that may be edited

- `phax.user.schema.json`
- `tests/unit/buildConfig.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`
- `tests/integration/loadConfigLayers.test.ts`

### Boundary contracts

- Consumer: phase-05's CLI needs `config.authoring` and `resolveAuthoringSelection`.
  Producer: this phase. The selection function is pure and takes only the flags and the
  resolved config for one kind.

### Test strategy

- Unit, written first: a config without `authoring` resolves to the catalog defaults; a
  config with only `authoring.spec.model` keeps the effort default; the user overlay can
  set `authoring`; `resolveAuthoringSelection` honours flag over config over default for
  each of model and effort independently.
- Existing schema-upgrade tests keep passing against the regenerated `phax.schema.json`.

### Implementation order

1. Schema and resolver with tests.
2. `loadConfig` wiring and overlay.
3. Schema regeneration, README paragraph.

### Excluded scope

- Reading the flags (phase-05); any use of the selection (phase-04 receives model/effort
  as input).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The `ResolvedConfig.authoring` shape and the `resolveAuthoringSelection` signature.
- Any file-plan deviation, with the reason.

### Commit subject

feat(config): optional authoring.{spec,plan} model and effort defaults

### Commit body

Add optional `authoring.spec` and `authoring.plan` blocks to `phax.json` and the
user overlay, resolved to Opus 5.5 / high when absent so a `version: 1` config
keeps loading unchanged, plus a pure flag → config → catalog selection used by
the headless authoring command. Schema files regenerated; README documents the
block.

---

## phase-04 — Authoring use case: session, validation, materialisation, commit, cache seed {#phase-04-author-artifact}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

The core: from a brief, spawn the recorded session with the skill and the output schema,
accept JSON only, render, write the artifact and its sidecar under the interactive
naming, commit both in one path-scoped commit, and seed the extraction cache for a plan.
Nothing lands on failure (spec §5.1 refusals, §5.2, §5.4, §5.5, §5.6; §8 "Headless spec
lands whole", "Invalid JSON lands nothing", "Refusals precede the session", "Plan never
re-extracts", "Rendering is deterministic").

### Detailed instructions

- `src/domain/authoring/prompt.ts`: pure `buildAuthoringPrompt({ kind, skillText,
  jsonSchema, brief, sourceSpecMd | null, slug })` returning the full prompt: the skill
  text verbatim, then the output contract ("return ONLY a JSON object valid against this
  schema; no fences; write no files; the JSON is your final message"), the JSON Schema,
  the source spec (plan only), then the brief. Export the prompt's filename constant for
  the session folder (`prompt.md`).
- `src/app/authorArtifact.ts`: `authorArtifact(input): Effect<AuthorArtifactResult,
  AuthorArtifactError, FileSystem | Git | Backend>` with input `{ kind, slug, brief: {
  text, path: string | null }, sourceSpec: string | null, model, effort, provider
  resolution (from `resolveModel`), skillText, security: ResolvedSecurityConfig,
  repoRoot, stateRoot, extractPlanModel, extractPlanEffort, nowIso }`. Steps, in order,
  every refusal before any write:
  1. Reuse `createArtifact`'s validations by extracting from it a pure/effectful
     `resolveArtifactTarget` (slug grammar, name build, target-exists) that both paths
     call; additionally refuse when the sidecar path (`<name>.json` beside the `.md`)
     exists. Refusals are `ArtifactCreationError` (exit 12).
  2. Create `<stateRoot>/authoring/<stamp>-<slug>/`, write `brief.md` and `prompt.md`.
  3. `backend.runAgent(prompt, { provider, model, effort, cwd: repoRoot, security:
     resolveReviewSecurityPolicy({ mode, worktreePath: repoRoot, config }),
     outputJsonlPath: <folder>/output.jsonl, phaseFolderPath: <folder> })`. Rate/usage
     limit errors propagate untouched (exit 8).
  4. Parse `finalText` with the same fence-stripping `extractPlan.ts` uses (move
     `stripJsonCodeFence` to a shared domain helper rather than duplicating it), decode
     with the kind's decoder; on failure fail with a new `AuthoringDocumentError { kind,
     slug, message }` whose message is the first violation path (use
     `formatParseError`), mapped to exit 5 in `runLayers.ts`. Write `document.json` to
     the session folder on success only.
  5. Render: frontmatter from the interactive skeleton (`specSkeleton` /
     `planSkeleton`, exported from `createArtifact.ts`) followed by the rendered body.
     Write the `.md` and the sidecar (pretty-printed encoded document) with
     `writeAtomic`.
  6. Plan only: compute `planCacheKey(renderedMd, extractPlanModel, extractPlanEffort)`
     and `writeCacheEntry(stateRoot, key, { planMdSha256, model: extractPlanModel,
     effort: extractPlanEffort, extractorVersion: EXTRACTOR_VERSION, extractedAt: nowIso,
     extracted: projectExtractedPlan(doc) })`.
  7. Commit exactly `[mdPath, sidecarPath]` via `git.commitPaths` with subject
     `docs(<specs|plans>): draft <slug>` and a body carrying the trailers `Artifact:
     <mdPath>` and `Authoring-Id: <stamp>-<slug>`; on failure fail with
     `ArtifactCommitFailedError` (exit 12) and leave the two files in place (spec §5.6).
     Return `{ path, sidecarPath, commit: { hash, subject }, sessionFolder }`.
- Do not write the record here (phase-07 adds it as a step after the commit); leave a
  clearly named seam (`onSessionEnded` hook or a returned `sessionOutcome`) so phase-07
  can record both outcomes without restructuring.

### Planned files to create

- `src/app/authorArtifact.ts`
- `src/domain/authoring/prompt.ts`
- `src/domain/authoring/jsonText.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/authoringPrompt.test.ts`

### Planned files to edit

- `src/app/createArtifact.ts`
- `src/app/extractPlan.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `tests/integration/createArtifact.test.ts`

### Optional files that may be edited

- `src/infra/fakes/backend.ts`
- `src/infra/fakes/git.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/integration/cliErrors.test.ts`

### Boundary contracts

- Consumer: phase-05's CLI calls `authorArtifact` once with everything resolved (brief
  text, model/effort selection, provider resolution, skill text, config slices). Producer:
  this phase. The use case never reads `phax.json`, stdin, or the skill bundle itself.
- Consumer: phase-07 needs the session folder path and outcome from this use case.

### Test strategy

- Integration with `makeFakeBackend`, `makeFakeFileSystem` and the fake Git, written
  first: valid spec document → `.md` with frontmatter + rendered body, sidecar equal to
  the encoded document, `commitPaths` called once with exactly the two paths and the
  trailers; valid plan document → additionally a cache entry under
  `<stateRoot>/cache/plans/<key>.json` whose `extracted` equals the projection and whose
  key equals `planCacheKey` of the written file; non-JSON final text → error names
  "not JSON", no file written, no commit; schema-invalid document → error message names
  the path, no file, no commit; existing target or sidecar → refused before `runAgent`
  is called (assert `runCalls.length === 0`); rate limit from the backend → propagates
  as `RateLimitError`.
- Unit: the prompt contains the skill text, the JSON Schema and the brief in that order;
  plan prompts include the source spec.

### Implementation order

1. Shared JSON-text helper and the `createArtifact` refactor (tests stay green).
2. Prompt builder with its unit test.
3. Use case with the integration tests, spec first, then plan (cache seed), then the
   failure paths.

### Excluded scope

- CLI flags and stdin (phase-05); sidecar lifecycle on transitions (phase-06); records
  (phase-07).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The `authorArtifact` input/result types and error union, and the exit-code mapping
  added for `AuthoringDocumentError`.
- The session folder layout (`brief.md`, `prompt.md`, `document.json`, `output.jsonl`)
  and the seam phase-07 will use to write the record on both outcomes.
- The commit trailers' exact spelling.
- Any file-plan deviation, with the reason.

### Commit subject

feat(authoring): headless authoring use case — JSON-only session, render, sidecar, commit, cache seed

### Commit body

Add the use case behind `artifact new --headless`: refuse before spawning on
the interactive path's grounds plus an existing sidecar; run the authoring
session under the read-only review posture rooted at the repository with the
skill, the output JSON Schema and the brief; accept a schema-valid document as
the session's final message or fail as a provider error with nothing written;
render the artifact with the interactive frontmatter, write the JSON sidecar
beside it, seed the extraction cache for a plan, and commit exactly the two
paths with Artifact and Authoring-Id trailers. Integration-tested against the
fake backend, filesystem and git.

---

## phase-05 — CLI: `artifact new --headless --brief <file|-> --model --effort` {#phase-05-cli-headless}

**Recommended model:** claude-sonnet-5
**Recommended effort:** high

Expose the use case on both `artifact new` subcommands, additively, with the output
sketch and exit codes of spec §6 (spec §5.1; §8 "Interactive path untouched", "Brief from
stdin", "Defaults resolve flag, then config, then catalog").

### Detailed instructions

- `src/cli/commands/artifact.ts`: add `--headless`, `--brief <file|->`, `--model
  <model>`, `--effort <effort>` to both `new spec` and `new plan`. Without `--headless`
  the existing `runCreateArtifact` path runs unchanged (assert in a test that its output
  is byte-identical). With `--headless`: refuse `--brief` missing (exit 12, message names
  the flag) before anything else; read the brief — a path is read through the
  repo-rooted FileSystem layer, `-` is read from `process.stdin` in this file (the one
  sanctioned stream read; keep it a small helper, `readStdinText()`); load config
  (`loadConfig`), routing (`loadModelRouting`/`loadProviderConfig`) and resolve the
  model with `resolveAuthoringSelection` then `resolveModel` as `reviewCompliance.ts`
  does; read the bundled skill text (`.claude/skills/phax-spec/SKILL.md` or
  `phax-planning`) from the bundle root that `skills.ts` computes — lift that path
  computation into a shared helper in `src/cli/commands/skills.ts`; call
  `authorArtifact` under `makeRepoRootedFileSystemLayer(config)`, `NodeGitLayer` and
  `makeNodeBackendLayer(providerConfig)`.
- Print, on success: `authoring <kind> <slug> — <model> / <effort>` before spawning,
  then `created <path> (Draft, headless)`, `sidecar <sidecarPath>`, `commit <short sha>
  — <subject>`; phase-07 adds the `record` line. On failure print `✗ authoring failed:
  <message>` and return `exitCodeForError`.
- `pnpm gen:usage-spec` and `pnpm docs:cli`; usage `long_help` for both subcommands
  gains a paragraph on `--headless` (side effects: spawns a recorded provider session,
  writes and commits the artifact and its sidecar, seeds the extraction cache for a
  plan) and one `example` each with `--headless --brief`.
- README: a `### Headless authoring` subsection under `## Write a plan` (or beside the
  spec workflow, wherever `artifact new` is documented) with the invocation lines and the
  exit-code table from spec §6.

### Planned files to create

- `tests/integration/artifactNewHeadlessCommand.test.ts`

### Planned files to edit

- `src/cli/commands/artifact.ts`
- `src/cli/commands/skills.ts`
- `tests/unit/cli/artifact.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `tests/integration/usageSpecExamples.test.ts`
- `tests/integration/cliProgram.test.ts`
- `src/cli/commands/runLayers.ts`

### Boundary contracts

- Consumer: the CLI. Producer: phase-04's `authorArtifact`, phase-03's selection. The CLI
  file holds no logic beyond argument reading, layer composition and output rendering.

### Test strategy

- Unit (`tests/unit/cli/artifact.test.ts`, mocking the use case as the file already does
  for transitions): `--headless` without `--brief` exits 12 without calling the use case;
  success prints the four lines; a use-case failure prints the message and maps the exit
  code (5 for `AuthoringDocumentError`, 12 for creation refusals, 8 for rate limits);
  the flag/config/default precedence reaches the use case's `model`/`effort`.
- Integration (`artifactNewHeadlessCommand.test.ts`, real temp git via
  `tests/helpers/tempGit.ts`, fake backend layer injected the way
  `reviewComplianceCommand.test.ts` does): end-to-end through the command function with
  a canned document → files exist, HEAD commit lists exactly the two paths, exit 0;
  `--brief -` with a stubbed stdin → same result.
- Existing interactive tests unchanged and green.

### Implementation order

1. Flags and refusals with unit tests.
2. Layer composition and the happy path with the integration test.
3. Usage/docs regeneration and README.

### Excluded scope

- The `record` output line (phase-07); `artifact status` changes (phase-06).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact output lines and exit codes as implemented.
- Where the bundle-root helper lives and how the fake backend is injected in the
  command test (phase-07 extends that test).
- Any file-plan deviation, with the reason.

### Commit subject

feat(cli): artifact new --headless --brief for specs and plans

### Commit body

Add `--headless`, `--brief <file|->`, `--model` and `--effort` to `phax artifact
new spec|plan`. Without `--headless` the command is unchanged. With it, the CLI
reads the brief (file or stdin), resolves model and effort as flag, then
`authoring` config, then catalog default, loads the matching bundled skill and
runs the headless authoring use case, printing the created artifact, its
sidecar and the commit. Usage spec, CLI reference and README updated.

---

## phase-06 — Sidecar lifecycle: write-set, divergence, `artifact status` {#phase-06-sidecar-lifecycle}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Make the sidecar travel with every transition, detect a hand-edited body, report it in
`artifact status`, and refuse `approve` on divergence naming the remedy (spec §5.8, §5.9;
§8 "Sidecar travels and is checked"; §9 decision on sidecar authority).

### Detailed instructions

- `src/domain/artifact/sidecar.ts`: pure `sidecarPathFor(repoRelPath)` (`.md` →
  `.json`, archive path mapping via `archivePathFor` applies to both) and
  `sidecarAgreement({ md, sidecarJson, kind }) -> "in-sync" | "diverged" | { kind:
  "invalid", message }`: decode the sidecar with the kind's decoder, render its body with
  phase-02's renderer, compare with `splitFrontmatter(md).body` after trailing-whitespace
  normalisation. An undecodable sidecar is `invalid` (reported like diverged, remedy:
  delete or re-author).
- `src/domain/artifact/writeSet.ts`: `transitionWriteSet(kind, path, target, { hasSidecar
  })` adds the sidecar path and, on a terminal target, the archived sidecar path.
  `transitionArtifact` in `src/app/artifactStatus.ts` checks the sidecar's existence and
  moves it alongside the artifact on terminal transitions (write then remove, same
  never-clobber guard as the `.md`).
- `approve` (both kinds): when a sidecar exists and agreement is not `in-sync`, fail with
  a new `ArtifactSidecarDivergedError { path, sidecarPath, remedy }` (exit 12) whose
  message says: re-author with `--headless`, or delete the sidecar to demote the artifact
  to hand-authored. Other transitions are not blocked.
- `inspectArtifact` returns `authoring: { kind: "interactive" } | { kind: "headless",
  sidecarPath, agreement }`; `runArtifactStatus` prints `Authored: interactive (no
  sidecar)` or `Authored: headless — sidecar <path> (in sync)` /
  `(diverged — body differs from the sidecar's rendering)` / `(invalid sidecar — <message>)`.
- Regenerate usage/docs: `artifact status` and `approve` `long_help` mention the sidecar.

### Planned files to create

- `src/domain/artifact/sidecar.ts`
- `tests/unit/artifact/sidecar.test.ts`

### Planned files to edit

- `src/domain/artifact/writeSet.ts`
- `src/app/artifactStatus.ts`
- `src/cli/commands/artifact.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/artifact/writeSet.test.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/domain/artifact/document.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `docs/cli/inventory.md`

### Boundary contracts

- Consumer: `transitionArtifact` and `inspectArtifact`. Producer: the pure sidecar module.
  Agreement is computed from content only; the app layer supplies the two texts.

### Test strategy

- Unit, written first: `sidecarPathFor` for live and archived paths; `sidecarAgreement`
  on identical, body-edited, frontmatter-only-changed (still in sync) and undecodable
  inputs.
- Unit: `transitionWriteSet` with and without a sidecar for every target.
- Integration (`artifactStatus.test.ts`, fake fs + fake git): approve of a headless spec
  commits `[md, json, approvals]`; complete moves both files under `archive/`; a body
  edit → `status` reports diverged and `approve` fails with exit 12 naming both remedies;
  an interactive artifact reports `interactive (no sidecar)` and behaves exactly as
  before (existing tests untouched).
- Run-carried completion (`completeRunArtifacts`) still passes: it calls
  `transitionArtifact`, so the sidecar rides along without further change — add one
  assertion.

### Implementation order

1. Pure sidecar module and write-set change with unit tests.
2. `transitionArtifact` / `inspectArtifact` changes with integration tests.
3. CLI rendering, error mapping, usage/docs.

### Excluded scope

- Reverse rendering or updating the sidecar from Markdown (spec non-goal).
- Back-filling sidecars for existing artifacts.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The `authoring` field of `ArtifactReport` and the exact status lines.
- The write-set signature change and every caller updated.
- Any file-plan deviation, with the reason.

### Commit subject

feat(artifact): sidecar travels with transitions; divergence reported and blocks approve

### Commit body

A headless-authored artifact's JSON sidecar is now part of every transition
write-set, including the move to archive/. `artifact status` reports whether an
artifact was authored headless and whether its sidecar still renders to its
body; `artifact approve` refuses a diverged or invalid sidecar with exit 12 and
names the remedies (re-author headless, or delete the sidecar to demote the
artifact to hand-authored). Interactive artifacts are unaffected.

---

## phase-07 — Authoring records, explained through the artifact commit {#phase-07-authoring-records}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Write one record per authoring session — committed or failed — on `phax/records/v1` as a
distinct `authoring` kind, and let `records explain` and `records list` resolve and show
it (spec §5.7; §8 "Record explains the artifact", "Failed session still recorded"; §9
decisions on the record kind and failed sessions).

### Detailed instructions

- `src/schemas/authoringRecord.ts`: `AuthoringRecordManifestSchema` `{ version: 1, kind:
  "authoring", authoringId, artifact, artifactKind: "spec" | "plan", shape, sourceSha?
  (absent on failure), provider, model, effort, outcome: "committed" | "failed", usage:
  TokenUsageSchema }` with strict decode/encode. Keep `RunRecordManifestSchema` untouched;
  export a `RecordManifestSchema = Union(run, authoring)` decoder for readers.
- `src/app/writeAuthoringRecord.ts`: mirror `writeRecord.ts` — same destination policy
  (`decideRecordsDestination`), same usage extraction, same `git.writeTreeCommit`
  plumbing, key `authoring/<authoringId>`, files from the session folder (`brief.md`,
  `prompt.md`, `document.json` when present, `output.jsonl` per the transcript setting),
  commit message `records(authoring): <outcome>` with trailers `Authoring-Id:` and
  `Artifact:`. Factor the shared pieces out of `writeRecord.ts` (usage computation, tree
  commit assembly) into a module both import rather than copying them.
- `src/app/authorArtifact.ts`: through phase-04's seam, write the record after the
  artifact commit (`committed`, `sourceSha` = the artifact commit) and after a document
  failure or agent failure (`failed`, no `sourceSha`), then re-raise the failure. Records
  off → no-op; a refused destination is reported like phase records (warning, never a
  failure of the authoring).
- `src/app/recordsExplain.ts`: when the commit's trailers carry `Authoring-Id` (and no
  `Run-Id`), find the record commit by `Authoring-Id:` and return a found outcome whose
  manifest is the authoring manifest; `src/cli/commands/records.ts` renders it (artifact,
  kind, outcome, model/effort, usage, brief and prompt sizes, `--prompt` / `--transcript`
  print the files). `src/app/recordsList.ts` lists authoring records under their key with
  the artifact path where phase records show verified surfaces.
- CLI success output gains the `record authoring/<id>` line (or `record off` / the
  refusal warning).

### Planned files to create

- `src/schemas/authoringRecord.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/app/recordPlumbing.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`

### Planned files to edit

- `src/app/writeRecord.ts`
- `src/app/authorArtifact.ts`
- `src/app/recordsExplain.ts`
- `src/app/recordsList.ts`
- `src/cli/commands/records.ts`
- `src/cli/commands/artifact.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/artifactNewHeadlessCommand.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `src/domain/records/assemble.ts`
- `tests/integration/writeRecord.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `docs/cli/inventory.md`

### Boundary contracts

- Consumer: `records explain`/`list` readers need a manifest decoder that accepts both
  kinds. Producer: `src/schemas/authoringRecord.ts`. The phase manifest's shape and
  version do not change.

### Test strategy

- Unit, written first: the authoring manifest decodes strictly; the union decoder
  accepts both kinds and rejects a mixed object.
- Integration (real temp git, as `writeRecord.test.ts`): a committed session writes one
  commit on `phax/records/v1` whose tree holds the four files under
  `authoring/<id>/` and whose manifest has `outcome: committed` and the artifact sha; a
  failed session writes a `failed` manifest without `sourceSha` and without
  `document.json`; records off writes nothing.
- Integration (`recordsExplain.test.ts`): `explainRecord` on the artifact commit sha
  resolves the authoring record through the `Authoring-Id` trailer; `listRecords` shows
  it.
- `authorArtifact.test.ts`: both outcomes call the record writer; the artifact commit
  precedes the record write.

### Implementation order

1. Manifest schema and unit test.
2. Shared plumbing extraction (existing record tests stay green).
3. Writer with its integration test.
4. Use-case wiring, explain/list, CLI line, usage/docs.

### Excluded scope

- Resuming sessions; any change to phase records' manifest; the records `sync`/`status`
  commands (they operate on the branch, not the record kind).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The authoring manifest shape and record key, and the union decoder's name.
- How `records explain` distinguishes the two trailer families.
- Any file-plan deviation, with the reason.

### Commit subject

feat(records): authoring records — one per headless session, explained through the artifact commit

### Commit body

Every headless authoring session writes a record of a distinct `authoring`
kind on phax/records/v1 — brief, prompt, document, transcript per config,
provider, model, effort, usage and outcome — whether it committed an artifact
or failed. The artifact commit's Authoring-Id trailer lets `records explain`
resolve it, and `records list` shows it beside phase records. Shared record
plumbing is factored out of writeRecord; the phase manifest is unchanged.

---

## phase-08 — Skills, README and the experimental-formats note {#phase-08-skills-and-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Teach the two bundled skills the document shape they must emit in a headless session,
document the feature for a reader of the README, state that both formats are
experimental, and add the deliberate real-provider e2e test (spec §3 "experimental",
§10 constraints; §8 "Headless spec lands whole" end to end).

### Detailed instructions

- `.claude/skills/phax-spec/SKILL.md`: add a `## Headless authoring` section: when the
  session is spawned by `phax artifact new spec --headless`, the deliverable is the
  spec document JSON (name every top-level key and the `pattern`, `surface`, `binding`,
  `docsPage` and open-question shapes, cross-referencing the canonical sections), the
  session writes no files, and the JSON is the final message. Keep the Markdown-first
  guidance for interactive use intact.
- `.claude/skills/phax-planning/SKILL.md`: the same for the plan document (projection =
  the extracted fields; informational fields per phase; `- (none)` semantics are
  rendered by phax, so lists are plain arrays). Edit outside the generated model-catalog
  markers only.
- README: under the existing `## Schema upgrade` / persisted-formats vicinity, a short
  `## Experimental formats` note listing the spec document, the plan document and the
  authoring record as formats outside the `version: 1` stability promise, printable
  with `phax artifact schema spec|plan`. Cross-link from the headless subsection phase-05
  added.
- `NEXT_STEPS.md`: tick the `headless-authoring` item under "Three additive specs" and
  note what it shipped; leave `review-as-plan` and `schemas-package` as they are.
- `tests/e2e/headlessAuthoring.test.ts`: under the real-provider config
  (`vitest.e2e.config.ts`, run deliberately with `pnpm test:e2e:real`), author a spec
  from a three-line brief in a temp repo, assert the artifact and sidecar exist, HEAD
  lists both, and `artifact status` reports in sync. Follow `tests/e2e/realFlow.test.ts`
  for setup and skipping when the provider CLI is absent.

### Planned files to create

- `tests/e2e/headlessAuthoring.test.ts`

### Planned files to edit

- `.claude/skills/phax-spec/SKILL.md`
- `.claude/skills/phax-planning/SKILL.md`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `docs/e2e-testing.md`
- `docs/plan-extraction-model.md`
- `docs/cli/inventory.md`

### Test strategy

- The e2e test is not run by the gates (its config is separate); it is the deliberate
  real-provider check the spec's first acceptance criterion asks for. Unit and
  integration coverage from phases 01–07 remains the mechanical proof.
- `pnpm gen:model-catalog --check` (in the `standard` profile) must stay green after the
  planning-skill edit.

### Implementation order

1. Skill sections.
2. README and NEXT_STEPS.
3. E2E test.

### Excluded scope

- Any code change; any change to the interactive guidance of either skill.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The section names added to each skill and the README anchors.
- Whether the e2e test was executed locally (it is optional; say so either way).
- Any file-plan deviation, with the reason.

### Commit subject

docs(authoring): teach the skills the document shape; README headless section; experimental formats note

### Commit body

The phax-spec and phax-planning skills now describe the JSON document a
headless session must return, alongside their unchanged Markdown-first
guidance. The README documents `artifact new --headless` and lists the spec
document, plan document and authoring record as experimental formats outside
the version 1 stability promise. NEXT_STEPS ticks the spec. A deliberate
real-provider e2e test authors a spec from a brief end to end.
