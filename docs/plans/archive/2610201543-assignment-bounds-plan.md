---
status: Completed
source-spec: docs/specs/2610201350-assignment-bounds.md
completes-spec: false
approved:
  date: 2026-10-20
  baseline: be1835d
---
# Phase shape

The joint plan-document change of three approved specs: `assignment-bounds` (the source spec of this plan), `interactive-phases` and `oracle-phases`. They ship in one release, with one frozen copy per format and one lift (assignment-bounds §10, interactive-phases §10, oracle-phases §10, where the oracle key rides this lift because its spec was approved before this plan was cut). This plan lands the shape only, not the behaviour behind it.

- The plan document's `modelReason` becomes `assignmentReason`, rendered as `**Assignment reason:**` and never extracted (assignment-bounds §5.24–§5.29).
- Every phase of the plan document and of `phax-plan.json` gains `mode` (`headless` | `interactive`) and `oracle` (`{ dischargedBy, files }` or null), in that order, directly after `optionalFilesToEdit` (interactive-phases §5.1–§5.4, oracle-phases §5.1–§5.4). `assignmentReason`, `model` and `effort` stay the plan document's last three keys.
- `phax plans lint` and the run preflight of `phax run` and `phax resume` read the header lines of each phase in plan.md. A `**Model reason:**` line is a `models` error (assignment-bounds §5.19). A malformed Mode or oracle line is an `interactive` or `oracles` error (oracle-phases §5.5). Any interactive or oracle declaration is refused as not supported yet: a lint error, and exit 11 at the run's start. Nothing runs as if the phase were headless until the runtime plans replace those refusals.
- The phax-planning skill, `docs/upgrading.md` (0.26.0), the README and `NEXT_STEPS.md` follow.

Out of scope (later plans): the bounds (`assignments` in phax.json, `phax validate`, the shared bounds check, `phax architecture` printing the bounds), the interactive runtime and its placement check, and the oracle runtime (provider, `oracle-request`, gate step, placement check, prompt statement, example Vitest provider).

Operator notes:
- Start the run with `phax run --allow-skill-edits`. Only phase-04 edits a skill file.
- The installed phax drives the run. Do not install a build of this branch before the run completes.
- Once phase-01 lands, the live plan sidecars in this repository, stamped 0.25.0, are below the current shape. After the merge, run `phax artifact migrate-documents` on main. No phase can run it, because the phase guard refuses it in a worktree.

## Required commands

- (none)

No new command is needed. Phases run the `standard` gate profile's commands and commands `phax.json` already allows: `pnpm exec tsx scripts/schemas-check.ts --write` regenerates the schema snapshots, current stamps and history lock, and `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate the CLI docs if a help text changes. `phax.json` needs no change. The run needs `phax run --allow-skill-edits`, because phase-04 edits `.claude/skills/phax-planning/SKILL.md`.

## Technical arbitrations

- Four phases, inside out. phase-01 renames the reason in the plan document. phase-02 adds the header-line reader and the lint and preflight refusals. phase-03 adds the `mode` and `oracle` keys to both formats. phase-04 updates the skill and the docs. The refusals land before the keys, so no commit can extract an interactive or oracle phase that the run preflight would let through. Loss: four reviews instead of two, and the plan document's unreleased `next` shape changes twice within this run.
- One frozen copy per format: `src/schemas/history/plan-document/0.25.0.ts` and `src/schemas/history/phax-plan/0.17.0.ts`. Each is self-contained (it imports only `effect`) and pinned by `packages/schemas/history.lock.json`, and each format gets a `next` snapshot. A plan sidecar stamped 0.25.0 is read by the 0.25.0 copy and lifted: `modelReason` becomes `assignmentReason`, and every phase gets `mode: "headless"` and `oracle: null`. A sidecar stamped below 0.25.0, or written before `$schema`, keeps its 0.20.0 reading and lifts straight to the current shape with `assignmentReason: null`. Loss: two more frozen modules, and the 0.25.0 one carries its own copy of the question schemas and checks.
- `phax artifact migrate-documents` renders a 0.25.0 sidecar's own shape with a frozen renderer, `src/domain/authoring/renderPlanV0_25_0.ts`. It writes `**Model reason:**` as phax 0.25.0 did, following the `renderSpecV0_17_0.ts` precedent. A 0.25.0 body that is not that rendering is refused as hand-edited, as today. Loss: a second, self-contained copy of the plan renderer.
- A `phax-plan.json` in an older shape is never handed to a run. That covers one stamped below the format's current stamp and one without `$schema`. `loadPlan`, the reader behind `phax resume` and `phax validate --plan`, refuses it with exit 2. The message names the file and its shape, and gives two ways out: finish the run with the phax release that started it, or archive it with `phax archive <run> --force` and run its plan again. The display and sizing readers still read it through the frozen decoder, lifted with `mode: "headless"` and `oracle: null`: `resolveRunInfo` (behind `phax ls`, `session-info` and `archive`) and the `plans estimate` history. The lift is exact, because every phase such a run ran was headless. Loss: a run in flight across the upgrade cannot be resumed by the new phax.
- The extraction cache is derived data, so `EXTRACTOR_VERSION` goes from 2 to 3. An entry written in the old shape is then never looked up, and nothing of it is read or lifted. phax extracts the plan again from plan.md, deterministic parse first. Loss: a plan that needs the model fallback pays one more extraction call per workstation.
- `mode` and `oracle` are phax's own reading of a phase's header paragraph in plan.md, never the extraction model's. The model's answer schema leaves them out, as it leaves out the phase title. phax then adds them from `src/domain/plan/phaseHeader.ts`, on the deterministic path and before a model extraction is cached alike. Loss: the model answers a second schema, the extracted one minus two keys.
- Header reading always yields a value. A declaration phax cannot read or resolve extracts as `mode: "headless"` and `oracle: null`, for example a malformed line or `**Oracle phase:** yes` on the last phase. It is also an error of the `interactive` or `oracles` check. Lint and the run preflight both run those checks, before any `phax-plan.json` is written and before any phase starts. So `phax run` refuses such a plan with exit 11, as lint reports it, and extraction never fails on a declaration line. Loss: `phax run --dry-run` returns before the preflight, so it shows such a phase as headless.
- Each not-yet-supported refusal is one small, named function: `unsupportedInteractiveFindings` in `src/domain/plan/interactiveCheck.ts` and `unsupportedOracleFindings` in `src/domain/plan/oracleCheck.ts`. Both lint and the new preflight checks `interactive-phases` and `oracle-phases` (exit 11) read them from plan.md's header lines. The runtime plans of interactive-phases and oracle-phases replace these two functions with their real rules. Loss: a planner can write a well-formed interactive or oracle phase that no phax of this release will run.
- A `**Mode:**` line is an `interactive` error, not a headless phase, in three cases: its value is anything but `interactive`, it is repeated, or it sits outside the header paragraph. Under q-mode-line only an interactive phase carries the line, so a typo can never run a phase headless without a word. Loss: a redundant `**Mode:** headless` line fails lint.
- The `**Model reason:**` label error is a plan-format finding, not a bounds finding (assignment-bounds §10). Lint reports it on its `models` check, and the `phase-models` preflight refuses on it with the same text, exit 11. Loss: the `phase-models` refusal now carries one kind of failure that the catalog does not decide.
- A declaration line counts only where it starts a line of a phase section's paragraph or list item, bold or not (`**Mode:**`, `**Mode**:` or `Mode:`), with the same tolerance the model and effort lines get. In the header paragraph, it declares. Anywhere else in the section, it is a misplaced-line error. Inline code and code blocks are prose. Oracle files render as comma-separated code spans, and the reader accepts each entry with or without one backtick wrap. The `oracle` schema allows an empty `files` list and does not check `dischargedBy` against the plan: oracle-phases §5.6 and §5.8 are lint rules of the runtime plan. Loss: prose that opens a paragraph or a bullet of a phase section with one of these labels is read as a misplaced declaration and fails lint.
- Archived sidecars need no edit. Those stamped 0.25.0 already decode in the 0.25.0 shape the frozen copy keeps, and those stamped 0.20.0 to 0.24.x keep their 0.20.0 reading. Both are lifted in memory and never rewritten. A new test reads every archived plan sidecar stamped 0.20.0 or later. Those stamped below 0.20.0 were already refused for lacking `completesSpec`, and they stay refused. Loss: none beyond the new test, which reads the repository's own `docs/plans/archive/`.
- Only phase-04 edits `.claude/skills/phax-planning/SKILL.md`, and it lists that exact file. That widens one session's write scope to one file, which the rename cannot avoid (assignment-bounds §5.35), and the run is started with `phax run --allow-skill-edits`. No other grant, command, sandbox path or credential changes. Loss: until phase-04 commits, the skill on the branch still teaches `modelReason`, which the current shape refuses.

---

## phase-01 — The plan document's assignmentReason, with the 0.25.0 shape frozen and lifted {#phase-01-assignment-reason}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The plan document's per-phase `modelReason` becomes `assignmentReason`, rendered as an `**Assignment reason:**` line. The 0.25.0 shape is frozen. Plan sidecars stamped 0.25.0 lift with their reasons carried over, and older ones lift straight to a null reason. `phax artifact migrate-documents` rewrites live 0.25.0 sidecars and re-renders their `**Model reason:**` lines.

### Detailed instructions

- Freeze the plan-document 0.25.0 shape. Create `src/schemas/history/plan-document/0.25.0.ts`, a self-contained module that imports only `effect`, like `src/schemas/history/plan-document/0.20.0.ts`. It reproduces exactly the sidecar shape that `PlanDocumentFileSchema` in `src/schemas/planDocument.ts` decodes today, with its keys in today's order:
  - the `plan-document` `$schema` URL pattern, `kind`, `sourceSpec`, `completesSpec` and `run`;
  - a `preamble` with `summary`, `requiredCommandsNote`, `technicalArbitrations`, `openQuestions` and `arbitratedQuestions`;
  - phases ending `commit, modelReason, model, effort`;
  - the lineage filter, and the question checks the 0.25.0 file decoder ran, with their JSON Schema annotations.
  Copy the question schemas and `firstQuestionViolation`'s logic from `src/schemas/questions.ts`, and the lineage filter from `planDocument.ts`. Never import them. Export `PlanDocumentV0_25_0Schema`, `type PlanDocumentV0_25_0` and `decodePlanDocumentV0_25_0` (`onExcessProperty: "error"`). Write a header comment in the style of 0.20.0.ts: the sidecar phax 0.25.0 wrote, never edit this module, only `src/schemas/persisted.ts` imports it in phax, and the schemas package lists it as the format's 0.25.0 release. The JSON Schema it renders must equal `packages/schemas/snapshots/plan-document/0.25.0.schema.json`.
- In `src/schemas/planDocument.ts`, rename the phase key `modelReason` to `assignmentReason`. It stays `Schema.NullOr(Schema.NonEmptyString)`, directly before `model` and `effort`, so the three stay the phase's last keys in `properties` and `required`. Its description becomes: "Why this phase's model and effort depart from the assignment the phax-planning skill gives it; null when they do not. Rendered as an **Assignment reason:** line, never extracted." Update the module comments that name `modelReason`. The strict decode already refuses `modelReason` as an unknown key; keep it that way, with no alias.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/plan-document/next.schema.json`, moves `CURRENT_STAMPS["plan-document"]` in `src/schemas/release.ts` to the opened version, sets `CURRENT_SHAPES["plan-document"]` to `next` in `packages/schemas/src/generated/index.ts`, and adds the frozen module's entry to `packages/schemas/history.lock.json`. Never hand-edit those four files. Rerun the write after any later schema change in this phase. At the end, `pnpm exec tsx scripts/schemas-check.ts` without `--write` must report nothing. If the check does not compare release snapshots with their frozen modules, add a unit test asserting that the JSON Schema of `PlanDocumentV0_25_0Schema` equals the committed 0.25.0 snapshot.
- In `src/schemas/persisted.ts`, read a plan sidecar stamped below the format's current stamp as follows:
  - At 0.25.0 or later: read it with the frozen 0.25.0 decoder as shape `0.25.0`, and lift it with a new `liftPlanDocumentV0_25_0`. The lift rebuilds every phase in the current key order with `assignmentReason` set to its recorded `modelReason`, and keeps the preamble questions as recorded.
  - Below 0.25.0: keep the frozen 0.20.0 decoder as today (shape `0.20.0`). Its lift now writes `assignmentReason: null` instead of `modelReason: null`. A sidecar written before `$schema` lifts the same way.
  Extend `PlanDocumentSidecar` with `{ kind: "plan"; shape: "0.25.0"; document; older: PlanDocumentV0_25_0Value }`, and export `PlanDocumentV0_25_0Value` (the 0.25.0 value without `$schema`) for the frozen renderer. Update the module's header comment and `readDocumentSidecar`'s doc. Check that `olderDocumentStamp` and `isStampedBelowCurrent` still name a 0.25.0 stamp as older once the current stamp moves; they read stamps only.
- In `src/domain/authoring/renderPlan.ts`, write `**Assignment reason:** <text>` where `**Model reason:** <text>` was written today. It stays directly under the `**Recommended effort:**` line, and a null reason writes no line. Update the module comment.
- Create `src/domain/authoring/renderPlanV0_25_0.ts`, the plan rendering of plan-document 0.25.0, frozen: today's `renderPlanBody` output, `**Model reason:**` line included. It takes a `PlanDocumentV0_25_0Value` imported from `src/schemas/persisted.ts`, as `renderSpecV0_17_0.ts` takes its value. It is self-contained: it copies the Markdown helpers and the question renderers it needs instead of importing `markdown.ts` or `renderQuestions.ts`, so a later change to them cannot move it. Its header comment says only `phax artifact migrate-documents` uses it, as the own-shape rendering of a 0.25.0 sidecar.
- In `src/domain/artifact/documentMigration.ts`, make `renderOwnShape` render a plan sidecar of shape `0.25.0` with `renderPlanBodyV0_25_0(sidecar.older)`. Sidecars of shape `0.20.0` and `pre-schema` keep today's rendering of the lifted document: its reason is null, so its body has no reason line. The rest of the flow stays: a body that is not the own-shape rendering is refused as hand-edited; otherwise the sidecar is rewritten at the current stamp, the body re-rendered so `**Model reason:**` lines become `**Assignment reason:**`, the extraction cache re-seeded, and exactly those paths committed. Verify that flow end to end in the integration test.
- Update the schemas package in `packages/schemas/src/formats/repository.ts`:
  - `planDocumentFormat.releases` gains `["0.25.0", { schema: PlanDocumentV0_25_0Schema, decode: decodePlanDocumentV0_25_0 }]`, and `PlanDocumentShapes` gains `"0.25.0"`.
  - `toLatestPlanDocument` lifts a 0.25.0 value with each phase's `modelReason` carried over as `assignmentReason`, in the current key order, and lifts the older shapes with `assignmentReason: null`.
  - The current shape is recognised by a key only it carries, `assignmentReason` on its first phase. Preamble questions alone no longer tell it apart, because 0.25.0 carries them too.
  Update the header comments. In `packages/schemas/src/index.ts`, export `PlanDocumentV0_25_0Schema` and `type PlanDocumentV0_25_0` beside the 0.20.0 ones.
- Fixtures. Every test fixture holding a current-shape plan document renames `modelReason` to `assignmentReason`. Fixtures that stand for a 0.25.0 sidecar keep `modelReason` and stamp `schemaUrl("plan-document", "0.25.0")` literally. Hand-written plan.md fixtures switch `**Model reason:**` to `**Assignment reason:**`. Extraction and the extracted plan do not change: `projectExtractedPlan` never copied the reason.
- Create `tests/unit/archivedPlanSidecars.test.ts`. It picks every `.json` directly under `docs/plans/archive/` that has an `.md` of the same name beside it and whose `$schema` names `plan-document` at 0.20.0 or later (compare with `parseSchemaUrl` and `compareReleases`, never with the running version). Each must read through `readDocumentSidecar("plan", …)` without error. Those stamped 0.25.0 must read as shape `0.25.0`, with every phase's `assignmentReason` equal to the `modelReason` recorded in the file. Edit nothing under `docs/`.
- Leave alone: the phax-planning skill, which still says `modelReason` until phase-04 (`tests/unit/skills.test.ts` keeps passing), lint, the run preflight, `phax-plan.json` and the extraction cache.

### Planned files to create

- `src/schemas/history/plan-document/0.25.0.ts`
- `src/domain/authoring/renderPlanV0_25_0.ts`
- `packages/schemas/snapshots/plan-document/next.schema.json`
- `tests/unit/archivedPlanSidecars.test.ts`

### Planned files to edit

- `src/schemas/planDocument.ts`
- `src/schemas/persisted.ts`
- `src/domain/authoring/renderPlan.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/decide/revision.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/decideLifecycle.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/approvalLock.test.ts`

### Optional files that may be edited

- `src/domain/artifact/sidecar.ts`
- `src/app/migrateDocuments.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

- `src/schemas/persisted.ts` (producer) and every reader of a plan sidecar (consumers: artifact status, approve, reopen, decide, migrate-documents). The contract is the `PlanDocumentSidecar` union: a current document, or an older one tagged with its shape (`0.25.0`, `0.20.0` or `pre-schema`) together with the value its frozen decoder read. Consumers that refuse an unmigrated sidecar keep refusing it, naming `phax artifact migrate-documents`.
- `src/domain/artifact/documentMigration.ts` (consumer) and the frozen renderers (producers). The contract: one own-shape rendering per older shape, whose output is exactly what that release wrote.
- The schemas package (consumer) and the frozen modules (producers). The contract: `releases` lists `0.25.0`, and `toLatestPlanDocument` returns the in-memory document phax's own reader lifts to.

### Test strategy

Write these first:
- `tests/unit/planDocument.test.ts`: `assignmentReason`, `model` and `effort` are the last three entries of the phase's `properties` and `required` in `phax artifact schema plan`'s JSON Schema; `assignmentReason` admits a non-empty string or null; a phase carrying `modelReason` is refused as an unknown key.
- `tests/unit/persisted.test.ts`: a sidecar stamped 0.25.0 reads as shape `0.25.0` and lifts with each reason carried over; one stamped 0.20.0 lifts with `assignmentReason: null`; a current sidecar decodes as `current`.
- `tests/unit/artifact/documentMigration.test.ts`: a 0.25.0 sidecar whose body is its 0.25.0 rendering migrates, its new body showing `**Assignment reason:**`; the same with a hand-edited body is refused.
- `tests/unit/schemasPackage/repositoryFormats.test.ts`: the package parses a 0.25.0 document as shape `0.25.0` and `toLatestPlanDocument` carries the reason over.
Then:
- `tests/unit/renderPlan.test.ts`: the reason line sits directly under the effort line; a null reason renders no line; rendering then parsing still yields the document's projection.
- `tests/integration/migrateDocuments.test.ts` covers the spec's "A 0.25.0 sidecar is lifted with its reasons" and "An older sidecar lifts to a null reason" criteria. Before the migration, `phax artifact status` refuses the sidecar and names `phax artifact migrate-documents`. After it, the sidecar is committed at the current stamp, with phase-02's `assignmentReason` and no `modelReason`, beside plan.md showing `**Assignment reason:**`, and status reports the pair in sync. Assert the current stamp through `currentSchemaUrl("plan-document")` or by format id and release pattern, never through a literal of the running version.
- `tests/unit/archivedPlanSidecars.test.ts` as described.
- Update every fixture that names `modelReason`.

### Implementation order

1. The frozen 0.25.0 module, then `pnpm exec tsx scripts/schemas-check.ts --write` once the current schema is renamed.
2. The rename in `src/schemas/planDocument.ts`, then the readers and lifts in `src/schemas/persisted.ts`.
3. The renderer, then the frozen 0.25.0 renderer and `renderOwnShape` in documentMigration.ts.
4. The schemas package format and its exports.
5. The fixtures, the new archived-sidecar test, and a final `schemas-check` run without `--write`.

### Excluded scope

- `mode` and `oracle` in either format (phase-03).
- `phax-plan.json`, its frozen copy and the extraction cache (phase-03).
- Any lint or run preflight finding, including the `**Model reason:**` label error (phase-02).
- The phax-planning skill, `docs/upgrading.md`, README and `NEXT_STEPS.md` (phase-04).
- Editing any sidecar or plan under `docs/`, live or archived. The operator runs `phax artifact migrate-documents` after the merge.

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The frozen module's path and exports (`PlanDocumentV0_25_0Schema`, `PlanDocumentV0_25_0`, `decodePlanDocumentV0_25_0`), and confirmation that its JSON Schema equals the 0.25.0 snapshot.
- The new `PlanDocumentSidecar` variant and the exported `PlanDocumentV0_25_0Value`.
- The names and locations of the lift functions in `src/schemas/persisted.ts` and of `toLatestPlanDocument` in `packages/schemas/src/formats/repository.ts`. phase-03 adds `mode` and `oracle` to exactly these.
- `renderPlanBodyV0_25_0`'s path, and how `renderOwnShape` dispatches.
- The stamps after `--write`: `plan-document` is at the opened version, with a `next` snapshot.
- That live 0.25.0 sidecars in this repository are now unmigrated.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(plans): rename modelReason to assignmentReason in the plan document`

### Commit body

Rename the plan document's per-phase modelReason to assignmentReason,
rendered as an **Assignment reason:** line under the model and effort
lines and still never extracted. The current shape refuses modelReason
as an unknown key.

Freeze the 0.25.0 shape in src/schemas/history/plan-document/0.25.0.ts.
A sidecar stamped 0.25.0 is lifted with each reason carried over; one
stamped below it, or written before $schema, lifts straight to a null
reason. phax artifact migrate-documents renders a 0.25.0 body with a
frozen 0.25.0 renderer, then rewrites the sidecar and its
**Model reason:** lines. The schemas package lists the 0.25.0 release
and lifts it the same way.

Refs: docs/specs/2610201350-assignment-bounds.md §5.24–§5.29

---

## phase-02 — Phase header lines, read for lint and the run preflight {#phase-02-header-checks}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax reads the header lines of every phase in plan.md: Assignment reason, Model reason, Mode, Oracle phase and Oracle files. `phax plans lint` and the start preflight of `phax run` and `phax resume` report three things on them:
- a `**Model reason:**` line, on `models`;
- a malformed Mode or oracle declaration, on `interactive` or `oracles`;
- any interactive or oracle declaration, as not supported yet.
The preflight refuses all three with exit 11, so no plan declaring a phase kind this phax cannot run ever starts.

### Detailed instructions

- Create `src/domain/plan/phaseHeader.ts`, pure, with no I/O. It exports two readers:
  - `readHeaderParagraph(source)`: the line grammar of one header paragraph's raw source text, not its flattened text.
  - `readPhaseHeaders(planMd)`: one `PhaseHeader` per root-level `## phase-NN` heading, in document order, with the frontmatter skipped (`splitFrontmatter`). It uses the heading recognition and the header-paragraph rule of `src/domain/plan/parsePlanMarkdown.ts`: the header paragraph is the first root-level paragraph of the phase block that carries `Recommended model:`.
  A label is recognised at the start of a line, bold or not (`**Mode:**`, `**Mode**:` or `Mode:`), with a case-insensitive label, the tolerance `readRecommendedFields` gives the model and effort lines. Its value is the rest of the line, trimmed. A `PhaseHeader` carries:
  - the phase id;
  - `assignmentReason`: the `**Assignment reason:**` text, or null;
  - whether a `**Model reason:**` line is present;
  - the raw values of the `**Mode:**` and `**Oracle phase:**` lines, each null when absent;
  - the `**Oracle files:**` entries, or null when the line is absent. Entries are split on commas, trimmed, stripped of one backtick wrap, with empty entries dropped;
  - the labels among Mode, Oracle phase and Oracle files that appear more than once in the header paragraph;
  - the labels among those three found at the start of a line of any other paragraph or list item of the phase section. Inline code and code blocks never count.
  Also export two helpers that phase-03 builds extraction on:
  - `declaresInteractive(header)`: true exactly when the Mode value is `interactive`;
  - `oracleDeclaration(header)`: when both oracle lines appear exactly once and only in the header, and the Oracle phase value is exactly `yes` or `discharged by phase-NN`, it returns `{ dischargedBy: { kind: "next" } | { kind: "phase", id }, files }`; otherwise null.
- Create `src/domain/plan/interactiveCheck.ts`. It exports `interactiveFindings(headers): readonly LintFinding[]`, every finding an `error` on check `interactive` with its phase. It reports a `**Mode:**` value other than `interactive` (quote the value, and say a headless phase carries no Mode line), a repeated Mode line, and a Mode line outside the header paragraph. It also composes one small exported function, `unsupportedInteractiveFindings(headers)`: one error per phase that `declaresInteractive` and has no other interactive defect, with the message "declared interactive (**Mode:** interactive): this phax cannot run an interactive phase yet; remove the line". Keep that function self-contained: the interactive-phases runtime plan replaces it with the placement and planned-work rules.
- Create `src/domain/plan/oracleCheck.ts`. It exports `oracleFindings(headers)`, every finding an `error` on check `oracles` with its phase. It reports, one finding per defect and naming the line:
  - `**Oracle phase:**` without `**Oracle files:**`, and the reverse;
  - an `**Oracle phase:**` value other than `yes` or `discharged by phase-NN`;
  - either line outside the header paragraph;
  - either line repeated.
  It composes `unsupportedOracleFindings(headers)`: one error per phase whose `oracleDeclaration` is not null, with the message "declared an oracle phase (**Oracle phase:**): this phax cannot run an oracle phase yet; remove the oracle lines". A phase with a malformed declaration gets only its malformed-line errors, so each oracle-phases §5.5 case gives exactly one row. The oracle-phases runtime plan replaces `unsupportedOracleFindings` with §5.6–§5.13.
- In `src/domain/plan/lint.ts`, widen `LintCheck` with `"interactive" | "oracles"`. Add `reasonLabelFindings(headers)`: one `models` error per phase whose header carries a `**Model reason:**` line, with the message "**Model reason:** is no longer read: write **Assignment reason:**".
- In `src/app/lintPlan.ts`, read the headers once from `planMd`. Push `reasonLabelFindings`, `interactiveFindings` and `oracleFindings` right after the structure and sequence-gap findings, before the deterministic parse, so they are reported whether or not the plan parses. They read no config, spawn no provider, and change no other check.
- In `src/app/runPreflight.ts`, read the same headers once from `input.planMd`.
  - `phase-models` also refuses when `reasonLabelFindings` is non-empty. Each label finding becomes a `ModelPreflightError` failure for its phase, with the model and effort taken from `input.plan`, the lint message as its one reason, and no alternatives. The refusal then prints lint's error text under the existing "Model preflight failed" header.
  - Add the checks `interactive-phases` and `oracle-phases` to `RUN_PREFLIGHT_CHECKS`, in that order, after `phase-sections`. Each refuses when its findings are non-empty, with a new `InteractivePreflightError` or `OraclePreflightError` from `src/domain/errors.ts`. Each error carries the findings and `planPath`. Its message is "Interactive preflight failed: N error(s)." (or "Oracle preflight failed: …"), then one line per finding: two spaces, the phase, two spaces, the message. It ends with "Fix the plan, then check it with `phax plans lint <planPath>`."
  - Add both errors to `RunPreflightRefusal`, to `ExecutePlanError` in `src/app/executePlan.ts`, and to the exit-11 branch of `exitCodeForError` in `src/cli/commands/runLayers.ts`.
  executePlan's resume re-check runs the shared set, so `phax resume` refuses on the run folder's plan.md and leaves the run's state and last error unchanged. `phax run` refuses before the run is named.
- A plan with no declaration line and no `**Model reason:**` line gets no new finding and no new refusal (interactive-phases §5.58, oracle-phases §5.40). Assert it on an ordinary plan in both lint and the preflight.
- Update the tests keyed by `RunPreflightCheck` and `FreshRunPreflightStep`, such as the step-guard table in `tests/unit/runPreflight.test.ts`, for the two new check ids.

### Planned files to create

- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/interactiveCheck.ts`
- `src/domain/plan/oracleCheck.ts`
- `tests/unit/phaseHeader.test.ts`
- `tests/unit/interactiveCheck.test.ts`
- `tests/unit/oracleCheck.test.ts`

### Planned files to edit

- `src/domain/plan/lint.ts`
- `src/app/lintPlan.ts`
- `src/app/runPreflight.ts`
- `src/domain/errors.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/planLint.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`

### Optional files that may be edited

- `src/domain/plan/lintRender.ts`
- `tests/unit/planLintRender.test.ts`
- `tests/integration/modelPreflight.test.ts`
- `tests/integration/helpers/preflightRepo.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `tests/unit/cli/run.test.ts`

### Boundary contracts

- `src/domain/plan/phaseHeader.ts` (producer) and its consumers: the three checks now, and the deterministic parser and the model-extraction path in phase-03. The contract: one `PhaseHeader` per `## phase-NN` heading, read from the raw header lines with one grammar, plus the `declaresInteractive` and `oracleDeclaration` helpers.
- The check functions (producers) and `phax plans lint` and the run preflight (consumers). The contract: lint reports exactly the errors the preflight refuses on, and both call the same functions on the same plan.md.
- `src/cli/commands/runLayers.ts` maps the two new preflight errors to exit 11, as the other plan preflights are mapped.

### Test strategy

Write these first:
- `tests/unit/phaseHeader.test.ts`: each label in bold and plain forms; the Assignment reason text; Model reason presence; oracle files with and without backticks; repeated labels; a misplaced line in a paragraph and in a list item under `### Detailed instructions`; a mention in inline code or a code block, which does not count; frontmatter skipped; `declaresInteractive` and `oracleDeclaration` for `yes`, `discharged by phase-04` and malformed values.
- `tests/unit/interactiveCheck.test.ts`: `**Mode:** review`, a repeated Mode line and a misplaced Mode line each give one `interactive` error; `**Mode:** interactive` gives the not-supported error; no Mode line gives nothing.
- `tests/unit/oracleCheck.test.ts`: each case of oracle-phases' "Lint rejects malformed declaration lines" criterion gives exactly one `oracles` error naming the phase and the line; a well-formed declaration (`yes`, or `discharged by phase-04`) gives the not-supported error; no oracle line gives nothing.
- `tests/unit/planLint.test.ts`: `reasonLabelFindings`.
Then the integration tests:
- `tests/integration/lintPlan.test.ts`: assignment-bounds' "A model-reason line is an error" criterion (a `models` error naming `**Assignment reason:**`); an interactive and an oracle declaration each fail lint; an ordinary plan has no new finding.
- `tests/integration/runPreflightBeforeNaming.test.ts`: `phax run` refuses each of the three with exit 11, prints lint's error text, and leaves no run folder, registry entry or branch.
- `tests/integration/resumePreflightRechecks.test.ts`: an interrupted run whose run-folder plan.md gains one of them is refused by `phax resume` with exit 11, with its state and last error unchanged.
- An ordinary plan passes both preflights as before.

### Implementation order

1. `src/domain/plan/phaseHeader.ts` and its tests.
2. `src/domain/plan/interactiveCheck.ts`, `src/domain/plan/oracleCheck.ts` and `reasonLabelFindings`, with their tests.
3. Lint wiring in `src/app/lintPlan.ts`.
4. The preflight checks, the errors and the exit-code mapping.
5. The integration tests for lint, `phax run` and `phax resume`.

### Excluded scope

- Extracting `mode` or `oracle`, or any schema change (phase-03).
- interactive-phases' placement and planned-work rules, and oracle-phases §5.6–§5.13 (their runtime plans).
- The bounds check, `assignments` and `phax validate` (the bounds plan).
- Reporting preflight errors in `phax run --dry-run`.
- Skill and docs text (phase-04).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact exports of `src/domain/plan/phaseHeader.ts` (`readHeaderParagraph`, `readPhaseHeaders`, `PhaseHeader`, `declaresInteractive`, `oracleDeclaration`) and the line grammar they implement. phase-03 builds extraction on them.
- The names and paths of `unsupportedInteractiveFindings` and `unsupportedOracleFindings`, which the runtime plans replace.
- The new `RUN_PREFLIGHT_CHECKS` entries, the two error classes and their messages.
- How the label error rides `phase-models`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(plans): read phase header lines and refuse phase kinds phax cannot run yet`

### Commit body

Read every phase's header lines in plan.md with one pure reader
(src/domain/plan/phaseHeader.ts): Assignment reason, Model reason,
Mode, Oracle phase and Oracle files.

phax plans lint reports a **Model reason:** line as a models error and
malformed Mode or oracle lines on the new interactive and oracles
checks. It refuses any interactive or oracle declaration as not
supported yet. The start preflight of phax run and phax resume runs
the same checks (phase-models, interactive-phases, oracle-phases) and
refuses with exit 11 before the run is named or a phase resumes. A
plan with none of these lines lints and runs as before.

Refs: docs/specs/2610201350-assignment-bounds.md §5.19,
docs/specs/2610190947-interactive-phases.md §5.58,
docs/specs/2610201518-oracle-phases.md §5.5, §5.40

---

## phase-03 — mode and oracle on every phase of the plan document and phax-plan.json {#phase-03-mode-and-oracle}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Model reason:** Crosses the schemas, the deterministic parser, the extraction app, the persisted readers, the schemas package and the resume path in one change to two persisted formats, and must keep extraction, the lifts and the reader split consistent across all of them.

Every phase of the plan document, the extracted plan, the extraction cache entry and `phax-plan.json` carries `mode` and `oracle`, directly after `optionalFilesToEdit`. phax reads them from plan.md's header lines and renders them back. The 0.17.0 `phax-plan` shape is frozen, and a run whose `phax-plan.json` predates the change is refused on resume, naming the way out. Older plan sidecars lift with `mode: "headless"` and `oracle: null`.

### Detailed instructions

- In `src/schemas/phaxPlan.ts`, add the per-phase keys and the model's answer schema:
  - Add `PhaseModeSchema = Schema.Literal("headless", "interactive")`.
  - Add `PhaseOracleSchema = Schema.NullOr(Schema.Struct({ dischargedBy: <the phase-id pattern of ExtractedPhaseFields.id>, files: Schema.Array(Schema.NonEmptyString) }))`, with exactly those two keys. An empty `files` list is admitted: oracle-phases §5.8 is a later lint rule.
  - Add `mode` and `oracle` to `ExtractedPhaseFields`, then to `ExtractedPhaseSchema` and the persisted `PhaseSchema`, directly after `optionalFilesToEdit` and in that order.
  - Add `ExtractionAnswerSchema`: the extracted plan whose phases carry no `mode` and no `oracle`, built from the same field schemas. `getExtractedPlanJsonSchema` renders it, because it is the schema the extraction model is given. Update the comments: mode and oracle are read from plan.md by phax, as the title is.
- In `src/schemas/planDocument.ts`, add `mode: ExtractedPhaseFields.mode` and `oracle: ExtractedPhaseFields.oracle` directly after `optionalFilesToEdit`. `assignmentReason`, `model` and `effort` stay last. `projectExtractedPlan` copies both, key by key, right after `optionalFilesToEdit`.
- Freeze the 0.17.0 `phax-plan` shape. Create `src/schemas/history/phax-plan/0.17.0.ts`, a self-contained copy of today's `PhaxPlanFileSchema`: the `phax-plan` `$schema` pattern, `run`, and phases ending with `commit`. It imports only `effect` and exports `PhaxPlanV0_17_0Schema`, `type PhaxPlanV0_17_0` and `decodePhaxPlanV0_17_0` (`onExcessProperty: "error"`). Give it the header comment of the other frozen modules. Its JSON Schema must equal `packages/schemas/snapshots/phax-plan/0.17.0.schema.json`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write` after the schema changes. It writes `packages/schemas/snapshots/phax-plan/next.schema.json`, refreshes `packages/schemas/snapshots/plan-document/next.schema.json`, moves `CURRENT_STAMPS["phax-plan"]` and `CURRENT_SHAPES["phax-plan"]`, and adds the lock entry. At the end, the check without `--write` must report nothing.
- In `src/domain/plan/phaseHeader.ts`, add `phaseKinds(header, nextPhaseId)`, which returns `{ mode, oracle }`:
  - `mode` is `interactive` exactly when `declaresInteractive`, else `headless`.
  - `oracle` is `oracleDeclaration` resolved: `next` becomes `nextPhaseId`, and `discharged by phase-NN` keeps its id. It is null when the declaration is null, or when it says `next` and no phase follows.
  In `src/domain/plan/parsePlanMarkdown.ts`, `walkPlan` reads each phase's header paragraph source through `readHeaderParagraph`, so both readers share one grammar. It adds `mode` and `oracle` to each candidate phase directly after `optionalFilesToEdit`, using `phaseKinds` with the next phase block's id. A declaration line never adds a structure error and never fails extraction: its defects are the errors of phase-02's `interactive` and `oracles` checks, which lint and the run preflight report before any `phax-plan.json` is written.
- In `src/app/extractPlan.ts`, decode the model's answer with `ExtractionAnswerSchema`. Then add `mode` and `oracle` to every phase from `readPhaseHeaders(planMd)` through `phaseKinds`, using a pure domain helper in `src/domain/plan/phaseHeader.ts` (for example `withPhaseKinds(answer, planMd)`). The helper fails with a `PlanValidationError` naming any answer phase that has no `## phase-NN` heading. Decode the result through `ExtractedPhaxPlanSchema`; that result is what `loadOrExtractPlan` caches. The prompt text is unchanged apart from the schema it embeds.
- In `src/domain/planCache/key.ts`, set `EXTRACTOR_VERSION` to 3, with a comment line saying that 3 means phases carry mode and oracle, read from the header lines. A cache entry keyed under version 2 is never looked up.
- In `src/domain/authoring/renderPlan.ts`, extend the header paragraph after the optional `**Assignment reason:**` line:
  - an interactive phase gets `**Mode:** interactive`, and a headless phase gets no Mode line;
  - a phase whose `oracle` is not null gets `**Oracle phase:** discharged by <dischargedBy>`, then `**Oracle files:** ` followed by each file as a code span, joined by `, `;
  - a null oracle writes no oracle line.
  Keep the module's oracle property: rendering then parsing yields the document's projection, `mode` and `oracle` included.
- Extend the plan-document lifts in `src/schemas/persisted.ts` (from phase-01: 0.25.0, 0.20.0 and pre-schema) so every lifted phase also gets `mode: "headless"` and `oracle: null`, in the current key order. Do the same in `toLatestPlanDocument` in `packages/schemas/src/formats/repository.ts`, which still recognises the current shape by a key only it carries. `renderPlanBodyV0_25_0` is unchanged. Re-rendering a lifted plan adds no Mode or oracle line, so `phax artifact migrate-documents` writes `mode: "headless"` and `oracle: null` on every phase of the sidecar, and only the reason label changes in plan.md.
- Make the phax-plan reader report the shape it read. `readPhaxPlanFile` in `src/schemas/persisted.ts` returns `{ shape: "current" | "0.17.0" | "pre-schema", plan }`:
  - a file at the current stamp is read by the current decoder;
  - a file stamped below it is read by the frozen 0.17.0 decoder;
  - a file without `$schema` is read by the pre-schema decoder.
  An older shape is lifted with `mode: "headless"` and `oracle: null` on every phase, because every phase of a run an older phax ran was headless and no oracle phase existed.
  The callers then split by what they do:
  - `src/app/resolveRunInfo.ts` and `src/app/estimateHistory.ts` take `.plan` whatever the shape. They only display and size.
  - `src/app/loadPlan.ts`, the reader behind `phax resume` and `phax validate --plan`, refuses any shape other than `current` with a `PlanValidationError`. The error names the file and its stamped shape, and says an older phax wrote it. It gives the way out: finish the run with the phax release that started it, or archive it with `phax archive <run> --force` and run its plan again. `src/cli/commands/resume.ts` names the run in that remedy. Exit 2, with nothing written and the run's state unchanged.
  Update the persisted.test entry that reads a `phax-plan` stamped 0.20.0: it now reads as shape `0.17.0`.
- Update the schemas package and fixtures:
  - In `packages/schemas/src/formats/runDirectory.ts`, `phaxPlanFormat.releases` gains `["0.17.0", …]`, `PhaxPlanShapes` gains `"0.17.0"`, and `toLatestPhaxPlan` lifts 0.17.0 and pre-schema values with `mode: "headless"` and `oracle: null`, documenting why that invents no fact.
  - In `packages/schemas/src/index.ts`, export `PhaxPlanV0_17_0Schema` and `type PhaxPlanV0_17_0` beside the other frozen ones.
  - Every typed fixture of a `PhaxPlan`, `ExtractedPhaxPlan` or plan-document phase gains `mode: "headless"` and `oracle: null` after `optionalFilesToEdit`. Fixtures of older shapes stay without them, with literal stamps.
  - A snapshot that changes (the phase definition in prompts, for example) may change only by those two keys. Check its diff shows nothing else, as interactive-phases §5.58 and oracle-phases §5.40 require.
- Leave alone: the phax-planning skill and the docs (phase-04), and phase-02's checks.

### Planned files to create

- `src/schemas/history/phax-plan/0.17.0.ts`
- `packages/schemas/snapshots/phax-plan/next.schema.json`

### Planned files to edit

- `src/schemas/phaxPlan.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/persisted.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/authoring/renderPlan.ts`
- `src/domain/planCache/key.ts`
- `src/app/extractPlan.ts`
- `src/app/loadPlan.ts`
- `src/app/resolveRunInfo.ts`
- `src/app/estimateHistory.ts`
- `src/cli/commands/resume.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/snapshots/plan-document/next.schema.json`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/formats/repository.ts`
- `packages/schemas/src/index.ts`
- `tests/unit/phaseHeader.test.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/renderPlan.test.ts`
- `tests/unit/planDocument.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemas.test.ts`
- `tests/unit/extractPlan.test.ts`
- `tests/unit/extractedPlanCacheEntry.test.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/integration/planCacheStore.test.ts`
- `tests/integration/migrateDocuments.test.ts`
- `tests/integration/resume.test.ts`
- `tests/unit/cli/validate.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/helpers/costHistory.ts`

### Optional files that may be edited

- `src/schemas/extractedPlanCacheEntry.ts`
- `src/domain/plan/finalize.ts`
- `src/cli/commands/validate.ts`
- `tests/unit/archivedPlanSidecars.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/__snapshots__/promptGeneration.test.ts.snap`
- `tests/integration/__snapshots__/executePlan.test.ts.snap`
- `tests/e2e/resetPhase.test.ts`
- `tests/e2e/gateExhaustionResume.test.ts`
- `tests/e2e/semanticTrace.test.ts`
- `tests/e2e/semanticTrace.providers.test.ts`
- `tests/unit/resume.test.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/unit/security/skillEditGrants.test.ts`
- `tests/unit/extractPlanFinalize.test.ts`
- `tests/unit/planOutline.test.ts`
- `tests/unit/loadOrExtractPlan.test.ts`
- `tests/unit/planLint.test.ts`
- `tests/unit/runPreflight.test.ts`
- `tests/unit/gateRequest.test.ts`
- `tests/unit/planProjection.test.ts`
- `tests/unit/dryRun.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/decide/revision.test.ts`
- `tests/unit/artifact/sidecar.test.ts`
- `tests/unit/artifact/documentMigration.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/plansOverlapLanded.test.ts`
- `tests/integration/extractPlanSealed.test.ts`
- `tests/integration/stateMachineContract.test.ts`
- `tests/integration/runCarriesCompletion.test.ts`
- `tests/integration/runFolder.test.ts`
- `tests/integration/resumeFromCleanup.test.ts`
- `tests/integration/resumeHandoff.test.ts`
- `tests/integration/reviewCode.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/integration/resetResume.test.ts`
- `tests/integration/approvalLock.test.ts`
- `tests/integration/gateRefusal.test.ts`
- `tests/integration/modelPreflight.test.ts`
- `tests/integration/costLedger.test.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/resumeFromCompletion.test.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/decideLifecycle.test.ts`
- `tests/integration/extractPlanTitles.test.ts`
- `tests/integration/skillEditGrants.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`
- `tests/integration/reconciliation.test.ts`
- `tests/integration/run.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/gateRequest.test.ts`
- `tests/integration/runBranchDirtyTree.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/perPhaseBranch.test.ts`
- `tests/integration/adjustPlan.test.ts`
- `tests/integration/routing.test.ts`
- `tests/integration/plansOverlapCommand.test.ts`
- `tests/integration/resumeFromCommit.test.ts`
- `tests/integration/adjustPlanCommand.test.ts`
- `tests/integration/setupFailure.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/integration/analyzePlanOverlap.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/gateLogTrailer.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/estimateHistory.test.ts`
- `tests/integration/runPreflightBeforeNaming.test.ts`
- `tests/integration/resumePreflightRechecks.test.ts`

### Boundary contracts

- `src/domain/plan/phaseHeader.ts` (producer) and its consumers, the deterministic walk and the model-extraction path. The contract: `phaseKinds` is the only source of `mode` and `oracle`, so both paths and the phase-02 checks read the same lines the same way.
- `src/schemas/persisted.ts` `readPhaxPlanFile` (producer) and its consumers, split by what they do. `loadPlan`, which hands a plan to a run, accepts only `shape: "current"`. `resolveRunInfo` and `estimateHistory`, which only display and size, accept any shape lifted.
- The plan document, through `projectExtractedPlan` (producer), and the extraction cache seed and `phax-plan.json` (consumers). The contract: `mode` and `oracle` are projected unchanged, directly after `optionalFilesToEdit`.

### Test strategy

Write these first:
- `tests/unit/schemas.test.ts` or the phax-plan schema tests: `mode` and `oracle` are required, in that order after `optionalFilesToEdit`; `"mode": "review"`, a missing `mode`, and `"oracle": { "dischargedBy": "phase-03" }` are each refused.
- `tests/unit/planDocument.test.ts`: in the JSON Schema, `mode` and `oracle` follow `optionalFilesToEdit` and `assignmentReason`, `model`, `effort` stay last.
- `tests/unit/parsePlanMarkdown.test.ts`: interactive-phases' "The mode is extracted" criterion (six phases, phase-03 interactive, the rest headless); oracle-phases' "An oracle phase defaults to the next phase" and "An explicit discharging phase is kept" criteria, files in declaration order; a malformed line extracts as headless/null and the plan still extracts.
- `tests/unit/renderPlan.test.ts`: the Mode line, then the oracle lines, after the Assignment reason line, on those phases only; rendering then parsing yields the document's projection.
Then:
- `tests/unit/persisted.test.ts`: the 0.25.0 and 0.20.0 lifts give `mode: "headless"` and `oracle: null`; `readPhaxPlanFile` reports `current`, `0.17.0` and `pre-schema`.
- `tests/integration/resume.test.ts`: a run folder whose `phax-plan.json` is in the 0.17.0 shape makes `phax resume` exit 2, naming the remedy, with the run state unchanged.
- `tests/unit/cli/validate.test.ts`: `phax validate --plan` exits 2 on the same file.
- `tests/unit/extractPlan.test.ts`: a model answer without `mode` and `oracle` gains them from the header lines; an answer carrying them is refused.
- `tests/integration/planCacheStore.test.ts` and `tests/integration/loadOrExtractPlan.test.ts`: an entry under extractor version 2 is not read.
- `tests/integration/migrateDocuments.test.ts`: interactive-phases' "One lift gives every phase its mode" and oracle-phases' "Lifted sidecars get oracle null" criteria. Assert stamps by format id and release pattern.
- `tests/unit/schemasPackage/*`: the package's 0.17.0 phax-plan shape and its lift.

### Implementation order

1. The schemas: phaxPlan.ts, then planDocument.ts and the projection.
2. The frozen phax-plan 0.17.0 module, then `schemas-check --write`.
3. `phaseKinds`, then the deterministic walk, the model-answer path and the cache version.
4. The renderer.
5. The lifts in persisted.ts and the schemas package.
6. The phax-plan reader's shapes, `loadPlan`'s refusal and the resume remedy.
7. The fixtures and snapshots, then a final `schemas-check` without `--write`.

### Excluded scope

- Running an interactive or oracle phase in any way: phase-02's refusals stay.
- oracle-phases §5.6–§5.13 and interactive-phases' placement rules.
- `phax run --dry-run` preflight lines.
- The skill and docs (phase-04).
- gate-request, gate-report, gate-attribution, phase-record-manifest and `oracle-request` (the oracle runtime plan).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

- The exported schemas (`PhaseModeSchema`, `PhaseOracleSchema`, `ExtractionAnswerSchema`) and their key order in both formats.
- `phaseKinds` and the extraction helper, with their paths.
- `readPhaxPlanFile`'s new return shape and which callers accept which shapes.
- `loadPlan`'s refusal text and exit code.
- `EXTRACTOR_VERSION` 3.
- The frozen phax-plan 0.17.0 module, and the stamps after `--write`.
- Which snapshots changed, and that only `mode` and `oracle` changed in them.
- Any deviation from the planned file lists, with the reason. Fixture files edited from the optional list need no explanation.

### Commit subject

`feat(plans): carry mode and oracle on every phase of the plan document and phax-plan.json`

### Commit body

Every phase of the plan document, the extracted plan, the extraction
cache entry and phax-plan.json carries mode (headless | interactive)
and oracle ({ dischargedBy, files } or null) directly after
optionalFilesToEdit. phax reads them from plan.md's header lines on
both extraction paths; the extraction model's answer schema leaves
them out. The renderer writes **Mode:** interactive and the oracle
lines after the Assignment reason line.

Freeze phax-plan 0.17.0. A phax-plan.json in an older shape is lifted
for display and sizing, but phax resume and phax validate --plan
refuse it (exit 2) and name the way out. Plan sidecars lift with
mode headless and oracle null. The extraction cache key moves to
extractor version 3.

Refs: docs/specs/2610190947-interactive-phases.md §5.1–§5.4,
docs/specs/2610201518-oracle-phases.md §5.1–§5.4

---

## phase-04 — The planning skill and the 0.26.0 upgrade steps {#phase-04-skill-and-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The phax-planning skill teaches `assignmentReason` and the `**Assignment reason:**` line, and lists the new `mode` and `oracle` keys and the two new lint checks. `docs/upgrading.md` names the 0.26.0 steps. The README and `NEXT_STEPS.md` describe what landed.

### Detailed instructions

- Edit `.claude/skills/phax-planning/SKILL.md`. It must no longer contain `modelReason` or `**Model reason:**` anywhere. Never edit inside the generated `phase-model-policy` and `model-catalog` blocks.
  - "Per-phase field set": the Model reason row becomes an Assignment reason row: an `**Assignment reason:**` line under the effort line, only on a phase that departs from the default, not extracted. Add `mode` and `oracle` rows: extracted, read from the `**Mode:** interactive` line and the `**Oracle phase:**` and `**Oracle files:**` lines. Say that this phax refuses both kinds of phase until a later release runs them, so a plan writes neither line.
  - "Phase section structure": the template line becomes `**Assignment reason:** <why this phase leaves the default — omit the line at the default>`.
  - "Lint before you run": the check list gains `interactive` and `oracles`. They report malformed Mode or oracle lines, and refuse any interactive or oracle declaration in this release. The run preflight (`phax run`, `phax resume`) refuses the same errors with exit 11.
  - "Choosing a model and effort": the bullet now reads `assignmentReason` (headless) or an `**Assignment reason:**` line (by hand), and `assignmentReason: null` with no line at the default. Add no bounds text: that is the bounds plan's.
  - "Headless authoring": the phase key order becomes `…, optionalFilesToEdit, mode, oracle, boundaryContracts, …, commit, assignmentReason, model, effort`. The extracted fields gain `mode` and `oracle`: write `mode: "headless"` and `oracle: null` on every phase in this release. The `modelReason` bullet becomes `assignmentReason`, and it is still never put in `preamble.technicalArbitrations`.
- Update `tests/unit/skills.test.ts`. The headless reasons test now expects `assignmentReason` and `` `assignmentReason: null` ``. Add an assertion that the skill contains neither `modelReason` nor `**Model reason:**` (assignment-bounds criterion "The skill teaches the bounds", for the rename part). Keep the other skill tests, including `tests/unit/completesSpecDocs.test.ts`, passing.
- In `docs/upgrading.md`, add a `### 0.26.0` entry above `### 0.25.0` with these bullets:
  - Plan sidecars: `modelReason` becomes `assignmentReason`, and every phase gains `mode` and `oracle`. Run `phax artifact migrate-documents` once in each repository with plans under `docs/`. It renames the key, writes `mode: "headless"` and `oracle: null` on every phase, rewrites `**Model reason:**` lines as `**Assignment reason:**`, and commits the result. Until then, `phax artifact approve`, `reopen` and `decide` refuse and name the command.
  - Hand-written plans: rename each `**Model reason:**` line to `**Assignment reason:**`. `phax plans lint` reports the old label as an error, and `phax run` and `phax resume` refuse it with exit 11.
  - Runs in flight: a run started by an older phax keeps a `phax-plan.json` in the older shape, which this phax refuses to resume. Finish the run before upgrading, or archive it with `phax archive <run> --force` and run its plan again.
  Keep the guide's style: steps only, each naming its command.
- In `README.md`:
  - In the `phax plans lint` paragraph, add each phase's declaration lines to the list of what the lint checks: an interactive or oracle phase is refused until a later release runs it, and a `**Model reason:**` line is an error.
  - In the paragraph under the Persisted formats table, say that a plan sidecar stamped 0.25.0 or 0.20.0 (or written before `$schema` without a source spec) is lifted when phax reads it, and that a `phax-plan.json` in an older shape is still shown by `phax ls` and `phax session-info`, but `phax resume` and `phax validate --plan` refuse it.
- Check the long help of `plans lint`, `resume` and `validate` in `src/cli/commands/../cliDocs.ts` (`src/cli/cliDocs.ts`). If one names the lint checks, or which `phax-plan.json` a command reads, update it, then run `pnpm gen:usage-spec` and `pnpm docs:cli` so `phax.usage.kdl`, `docs/cli/reference.md` and `docs/cli/inventory.md` follow. Leave them untouched otherwise.
- In `NEXT_STEPS.md`:
  - In the `assignment-bounds` entry, record that plan 2, the joint plan-document change (`assignmentReason`, `mode`, `oracle`, one lift), landed, and that the bounds plan comes next.
  - In the `interactive-phases` and `oracle-phases` entries, replace the "rides the lift" lines: their phase shape landed, lint and the run preflight refuse their phases for now, and their runtime plans replace those refusals.
  Keep the file's style, and say nothing about things that have not landed.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-planning/SKILL.md`
- `tests/unit/skills.test.ts`
- `docs/upgrading.md`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/cli/inventory.md`
- `tests/unit/completesSpecDocs.test.ts`

### Test strategy

Update `tests/unit/skills.test.ts` first, so it fails on the current skill: it should expect `assignmentReason`, `` `assignmentReason: null` `` and `preamble.technicalArbitrations` in Headless authoring, and the absence of `modelReason` and `**Model reason:**` from the whole skill. Then edit the skill until it passes. `pnpm gen:model-catalog --check` in the gate keeps the generated blocks untouched. If a help text changes, the CLI-docs drift test keeps `docs/cli/reference.md` in step. The docs pages have no tests: read them back against the behaviour phases 01–03 shipped.

### Implementation order

1. `tests/unit/skills.test.ts`, then `.claude/skills/phax-planning/SKILL.md`.
2. `docs/upgrading.md`.
3. README.md, then the CLI long help and regenerated docs, if needed.
4. `NEXT_STEPS.md`.

### Excluded scope

- The skill's bounds teaching (the rest of assignment-bounds §5.35–§5.36), and its interactive-phase and oracle-phase sections (interactive-phases §5.10, oracle-phases §5.39). These come with later plans.
- Any other skill file.
- Any code change beyond help text.
- Running `phax artifact migrate-documents` or any other phax lifecycle command.

### Verification

The `standard` gate profile in `phax.json`. Its terminal build, site and Deno smoke steps fire on this last phase.

### Expected handoff content

- The skill sections changed, and confirmation that the skill no longer names `modelReason` or `**Model reason:**`.
- The 0.26.0 bullets added to `docs/upgrading.md`.
- Whether any CLI help changed and the docs were regenerated.
- The `NEXT_STEPS.md` lines changed.
- A reminder for the operator: after the merge, run `phax artifact migrate-documents` on main.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(plans): teach assignmentReason, mode and oracle, and name the 0.26.0 upgrade steps`

### Commit body

The phax-planning skill teaches assignmentReason and the
**Assignment reason:** line, lists mode and oracle among a phase's keys
(headless and null in this release), and adds the interactive and
oracles lint checks. It no longer names modelReason.

docs/upgrading.md gains a 0.26.0 entry: run phax artifact
migrate-documents, rename hand-written **Model reason:** lines, and
finish or archive runs started by an older phax. The README and
NEXT_STEPS.md describe the landed phase shape.

Refs: docs/specs/2610201350-assignment-bounds.md §5.35, §5.39
