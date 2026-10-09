---
status: Approved
source-spec: docs/specs/2610091304-guarantee-reports.md
completes-spec: true
approved:
  date: 2026-10-09
  baseline: d92a8c3
---
# Guarantee reports

Implements the Approved spec `guarantee-reports`, step 2 of the steme item in NEXT_STEPS. A gate step that declares `"output": "gate-report"` answers with a `gate-report`. That report is either checked (findings and review notes) or refused (a reason and a remedy). A brief provider answers with a `brief-report`: the rules over the requested paths, and the findings with their due. Both formats share one location, guide and finding definition. Both are born at the opened version 0.21.0 through `next` snapshots. phax routes each fact to whoever acts on it. Findings and their guides go to the agent, through the fix prompt, the pushed brief and `phax brief`. Review notes go to the reviewer, in a `## Review notes` section of the review handoff and the PR body. A refusal goes to the operator: exit 4 and the gate-failure pause, with no fix attempt. `gate-diagnostics`, `brief-answer` and `"output": "diagnostics"` go with no shim. Their served schema URLs stay up from frozen copies under `site/retired-schemas/`. `brief.push` becomes required.

Phases go inside-out, and each is green on its own. First the formats. Then the gate in three steps: report steps, the retirement of gate-diagnostics, then refusals and repeat findings. Then the brief, together with the retirement of brief-answer. Then review notes, and last the docs. A format leaves in the phase that stops reading it. Execution caveats: no phase runs `scripts/release.sh`, `scripts/release-open.ts` or `scripts/release-cut.ts`, and no phase tags, pushes or publishes. Once phase-05 lands, any `phax.json`, `phax.local.json` or `~/.phax/config.json` that declares `brief` without `push` exits 2 until the operator adds `push`. This repository's own `phax.json` declares no brief. The `decision` class (step 3 of the steme item) is not part of this plan.

## Required commands

- (none)

The plan adds no new command. Phases run `pnpm exec tsx scripts/schemas-check.ts --write`, `pnpm exec tsx` one-offs, `pnpm dev schema upgrade`, `pnpm gen:usage-spec`, `pnpm docs:cli`, `node`, `git grep` and `git cat-file`. `security.agentCommands` already allows all of them, and the `standard` gate profile runs as well. Phase-07 edits two skill files, so start the run with `phax run --allow-skill-edits`.

## Technical arbitrations

- brief-record gets a `next` snapshot (settled in the brief). Its `answer` description names brief-answer and parseBriefAnswer, and the spec leaves no leftover name. Its keys do not change. Loss accepted: brief-record's stamp moves to 0.21.0 for a wording-only change, which the NEXT_STEPS entry on served descriptions warns about, and its 0.20.0 shape is frozen as a history module. A leftover name of a removed format is worse.
- Vocabulary (settled in the brief). The §5.45 criterion is held by `tests/unit/reportVocabulary.test.ts`. It searches exactly the surfaces §5.45 names: the two JSON Schemas; the fix prompt, pushed brief and `phax brief` output rendered from the §6 examples; and the README's Gate report steps, Gate request and Brief provider sections. Those sections avoid the words in every sense. Loss accepted: plain English such as 'in place of' or 'for instance' is out of bounds in three README sections. The rest of the README is free.
- The gate work is split into three phases. Phase-02 adds report steps, and `"output": "diagnostics"` still works during it. Phase-03 retires gate-diagnostics. Phase-04 adds refusals and the `still failing` mark. Abandons: one commit for the gate, and for one commit phax reads both step outputs. The format still leaves in the phase that stops reading it, and each diff fits one agent session.
- Saved report name: `checks-attempt-NN.report-SS.json`, where SS is the step's 1-based position among the steps the attempt runs. Abandons: a number that always matches phax.json's declared order. On a non-terminal phase, a skipped terminal step earlier in the profile shifts the number. The number is stable within a phase, which is all that `still failing` and review notes need, and step selection does not change.
- Module layout. `src/schemas/report.ts` holds the shared definitions: location, guide, finding, the line-order and unique-id filters, and the key-path rendering. The formats live in `src/schemas/gateReport.ts` and `src/schemas/briefReport.ts`. Both package formats live in `packages/schemas/src/formats/reports.ts`. Abandons: one module per format holding everything it needs. A reader must open the shared module to see a finding. In exchange, the definitions that §5.43 requires to be identical exist only once.
- The package exports `ReportLocation`, `ReportGuide` and `ReportFinding` as named types (types only, no schemas). Abandons: the smallest public surface. These are three more names the package must keep stable. Without them, a TypeScript provider author would have to derive the types by indexing into the report types.
- Hello-world's `audit.mjs` and `brief.mjs` share `examples/hello-world/rules.mjs`, which holds the two rules, their guides and the finding computation. Abandons: each provider script readable alone as a self-contained example. In exchange, the two scripts cannot drift on rule text, ids or guides, which the acceptance criteria require to agree.
- The `GateFailed` event carries nothing to replace `diagnostics`. `GateFailedError` carries `reportFindings` for the fix loop. Abandons: findings in the event and trace stream. The saved report file is their only copy.
- `still failing` reads the previous attempt's saved report file through the FileSystem port. Abandons: an in-memory comparison with no extra read. Also, a report whose file failed to save marks nothing. In exchange, the mark holds across `phax resume`, whose previous attempt ran in another process.
- Refusal plumbing: a new `GateStepRefusedError`, a new `GateStepRefused` event, and a `gate_refused` kind for resume instructions and what's-next. The refusal lands in the existing `gates_exhausted` phase state and stop reason. Abandons: an unchanged event matrix, because every state table gains a row. Overloading `FixAttemptsExhausted` would avoid that, but the event's name would then be false for a phase that made no fix attempt.
- Each README section moves with the phase that changes its format. The two Persisted formats rows land in phase-01, Gate report steps in phase-03, and Brief provider in phase-05. The rest lands in phase-07: the refusal, review notes, Gate request, the intro and the vocabulary test. Abandons: a single docs commit. `readmePersistedFormats.test.ts` and `exampleStamps.test.ts` fail any phase that removes a format while the README still shows it.
- Broken-step messages name the gate-report URL instead of the inline expected-shape hint. Abandons: a step author seeing the expected keys in the failure message itself. The URL serves the full schema.
- Wording of the fix prompt, the pushed brief, `phax brief`, the Review notes intro, the run output and the resume instructions: the spec §6 indicative wording, used as given. Abandons: tuning the text for agents before real runs show what reads best.
- `docs/blog/announcing-phax-1.0.md` is updated. The unpublished 1.0 announcement shows `"output": "diagnostics"`, which phax now refuses, and it describes the invariant and completion classes, which no longer exist. Abandons: leaving blog posts as written. No other post is edited.

---

## phase-01 — The shared definitions and the two report formats {#phase-01-report-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax and `@lbdremy/phax-schemas` can read a `gate-report` and a `brief-report`. These are two strict formats over one location, guide and finding definition, born at 0.21.0 through `next` snapshots. Nothing produces or consumes them yet, and `gate-diagnostics` and `brief-answer` stay untouched.

### Detailed instructions

- New `src/schemas/report.ts` holds the shared definitions. Like the other schema modules, it imports only `effect` and `./schemaUrl.js`. Every string is `Schema.NonEmptyString`. The lines value is `[start, end]` (integers) or null. `ReportLocationSchema` is `{file, lines}` and `ReportRelatedLocationSchema` is `{file, lines, why}`. Each has a filter that refuses a pair starting below 1 or ending before it starts. The filter's message names the pair and the file, e.g. `lines [3, 1] of src/greet.ts are out of order` (§5.4, §5.8). `ReportGuideSchema` is `{summary, read}` (§5.5). `reportFindingFields` is `{id, rule, location, message, related: Array(ReportRelatedLocation), guide: NullOr(ReportGuide)}` (§5.6). Give location, related location and guide `identifier` annotations, so both JSON Schemas carry them as identical definitions. Export `uniqueFindingIds`, a filter over a list of findings whose message names the first id used twice (§5.7).
- Also in `report.ts`, export `describeReportIssue(error)`. It renders the first issue of a decode error as one line, `<path>: <message>`. Paths look like `findings[0].guide.kind`: indexes in brackets, keys joined by dots, and a top-level key bare (`debt`). An excess key and a missing key both name the key's own path (§5.9). A filter failure keeps its own message, which names the id or the file.
- New `src/schemas/gateReport.ts`. `GateReportFileSchema` is the union of two shapes (§5.11). The checked shape is `{$schema: schemaUrlField("gate-report"), outcome: "checked", findings, review: Array({owner, note})}`, with `findings` filtered by `uniqueFindingIds`. The refused shape is `{$schema, outcome: "refused", reason, remedy}`. `decodeGateReportFile` decodes with `onExcessProperty: "error"`. Export the types `GateReportFile`, `GateReport` (without `$schema`), `GateFinding` and `ReviewNote`. Add no encoder: phax never rewrites a report.
- New `src/schemas/briefReport.ts`. `BriefReportFileSchema` is `{$schema: schemaUrlField("brief-report"), rules: Array({rule, files: NonEmptyArray(NonEmptyString), guide: NullOr(ReportGuide)}), findings: Array({...reportFindingFields, due: NullOr(Literal("this-phase", "later"))})}`. `findings` is filtered by `uniqueFindingIds`, and there is no outcome key (§5.12). `decodeBriefReportFile` decodes with `onExcessProperty: "error"`. Export `BriefReportFile`, `BriefReport`, `BriefRule` and `BriefFinding`.
- Annotate every key with a description, in provider-neutral words (§5.45). No description uses guarantee, leg, obligation, prohibition, place, instance, blueprint, skill, judgement, debt or baseline, or their plurals, in any sense: no 'in place of', no 'for instance'. The descriptions say the following. `id` belongs to the provider, stays stable across runs and is compared by equality only. `read` is a file the agent reads and phax never opens. `due` is the provider's word. Each list is in the provider's order, which is its rank.
- `src/schemas/schemaUrl.ts`: append `gate-report` and `brief-report` to `FORMAT_IDS` and to `SCHEMA_BORN_FORMAT_IDS`, and extend both doc comments.
- `src/schemas/persisted.ts`: add `readGateReport(input, bounds = { current: CURRENT_STAMPS["gate-report"], running: PHAX_RELEASE })` and the matching `readBriefReport`, over one shared private helper. Each returns the decoded file or a `ReportError`: `malformed { reason } | newer { message } | older { message }`. Checks run in this order:
      1. A non-object, or a document without `$schema`, is malformed.
      2. A `$schema` that names any other format id, known or not, is malformed with `<format> is not read by this phax — it reads <url>` (§5.2). That covers gate-diagnostics, brief-answer and the other report format.
      3. A stamp above `running` is newer.
      4. A stamp below `current` is older: `<format> <X> is an older shape — this phax reads <url>`.
      5. Otherwise decode, and a decode failure is malformed with `describeReportIssue`'s line.
    Export `describeReportError(error)`: one line that always ends by naming the `currentSchemaUrl` of the format being read. Leave `readGateDiagnosticsAnswer` and `readBriefAnswer` untouched.
- Package: follow `formats/brief.ts`. New `packages/schemas/src/formats/reports.ts` defines `gateReportFormat` and `briefReportFormat` with `defineFormat` (`preSchema: null`, `releases: []`, current `CURRENT_SHAPES[...]`). It exports `parseGateReport`, `parseBriefReport`, the shape types, `LatestGateReport`, `LatestBriefReport`, `toLatestGateReport` and `toLatestBriefReport`. `packages/schemas/src/index.ts` exports:
      - all of the above;
      - the two file schemas, as `GateReportSchema` and `BriefReportSchema`;
      - the types `GateReport` and `BriefReport`;
      - the shared types `ReportLocation`, `ReportGuide` and `ReportFinding` (types only).
    It also adds both formats to `DocumentShapes` and `parseDocument`. `packages/schemas/build/jsonSchemas.ts` registers both formats with excess properties set to `"error"`, so every object gets `additionalProperties: false` (§5.43). Re-export phax's schemas; never copy them.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/gate-report/next.schema.json` and `packages/schemas/snapshots/brief-report/next.schema.json`, and regenerates `CURRENT_SHAPES` and `CURRENT_STAMPS`, with both formats at the opened version 0.21.0. Never hand-edit a generated file or a snapshot. Then run `pnpm exec tsx scripts/schemas-check.ts`; it must pass.
- README §Persisted formats: add the `gate-report` and `brief-report` rows exactly as spec §6 gives them; `readmePersistedFormats.test.ts` requires one row per format id. Touch nothing else in the README.
- Tests and fixtures:
      - `tests/integration/persistedProducer.test.ts` adds both ids to `NEVER_WRITTEN`. Comment gate-report as temporary (phase-02 saves it), and brief-report as living only inside a brief record.
      - Extend the schemasPackage fixtures (`documents.ts`) with one made-up valid document per format.
      - Fix every count or list that the new ids change: `schemaUrl.test.ts`, `exports.test.ts`, `tests/type/schemasPackage.ts`, `architecturalGuards.test.ts`, and any other suite that enumerates formats.
    Fixtures are made up. Content from the spec's §6 examples is fine; nothing comes from steme or another repository.

### Planned files to create

- `src/schemas/report.ts`
- `src/schemas/gateReport.ts`
- `src/schemas/briefReport.ts`
- `packages/schemas/src/formats/reports.ts`
- `packages/schemas/snapshots/gate-report/next.schema.json`
- `packages/schemas/snapshots/brief-report/next.schema.json`
- `tests/unit/schemas/gateReport.test.ts`
- `tests/unit/schemas/briefReport.test.ts`
- `tests/unit/schemasPackage/reportFormats.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `README.md`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/persistedProducer.test.ts`

### Optional files that may be edited

- `src/schemas/formatError.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `packages/schemas/README.md`

### Boundary contracts

Producers: `src/schemas/report.ts`, `gateReport.ts` and `briefReport.ts`, plus the readers in `src/schemas/persisted.ts`. Consumers: the gate (from phase-02), the brief provider (phase-05), the review handoff (phase-06) and the schemas package. Contract: `readGateReport` and `readBriefReport` return either the decoded file (with `$schema`) or a `ReportError`, whose `describeReportError` line names the format's current URL. Later phases render the types `GateReport`, `GateFinding`, `ReviewNote`, `BriefReport`, `BriefRule` and `BriefFinding`. The package re-exports phax's schemas and never copies them. Nothing under `src/` imports `packages/`.

### Test strategy

Write the decoder and reader tests first, since they are the stable contract.

`tests/unit/schemas/gateReport.test.ts` and `tests/unit/schemas/briefReport.test.ts` hold three §8 criteria at decode level: 'Duplicate ids and disordered lines make a report malformed', 'Keys outside the format are refused', and 'Two gate outcomes, and no outcome in the brief'. They assert the named id, the files (`src/greet.ts`, `src/cli.ts`) and the key paths (`findings[0].due`, `debt`, `findings[0].guide.kind`, `review`). They also check that the §6 checked, refused and brief examples decode, and that empty lists, null `lines`, null `guide` and null `due` decode.

`tests/unit/persisted.test.ts` gains reader cases with injected bounds and literal releases. `readGateReport`, given a `gate-diagnostics/0.20.0` document or a `brief-report/0.21.0` document, refuses each one naming `https://docs.phax.run/schemas/gate-report/0.21.0.json`. `readBriefReport` has the mirror cases. Add the newer and older stamps, and a document with no `$schema`.

New `tests/unit/schemasPackage/reportFormats.test.ts`: `parseGateReport` and `parseBriefReport` read the §6 examples. The two built JSON Schemas define location, related location and guide identically, and the finding identically apart from the brief finding's `due`, with `additionalProperties: false` on every object.

No test uses `PHAX_RELEASE` or `PACKAGE_VERSION` for a format's stamp. Use `currentSchemaUrl` or `CURRENT_STAMPS`, or literal releases with injected bounds.

### Implementation order

1. Decoder tests, then `report.ts`, `gateReport.ts` and `briefReport.ts`
2. `FORMAT_IDS`, then the reader tests and the two readers in `persisted.ts`
3. The package format module, its exports and the JSON Schema registration
4. `schemas-check.ts --write`, then the check
5. README rows and the fixture and count updates, then the standard gate

### Excluded scope

- Any gate, fix-loop, brief, config or review-handoff behavior (phase-02 onward).
- Removing or changing `gate-diagnostics`, `brief-answer`, `gate-attribution` or `brief-record`.
- README prose beyond the two rows.
- The hello-world example.

### Verification

The `standard` gate profile in `phax.json`. `frozenHistory.test.ts` runs the schemas check on the real tree inside `pnpm test`, so a stale or hand-edited snapshot, `CURRENT_SHAPES` or `CURRENT_STAMPS` fails the gate.

### Expected handoff content

Record the following in the handoff:
- The module paths and every exported name: schemas, decoders, types, the readers (`readGateReport`, `readBriefReport`, `ReportError`, `describeReportError`), `describeReportIssue`, and the package's parsers and types.
- The exact refusal spellings for another format, a newer stamp, an older stamp and a malformed report, and the key-path rendering.
- The JSON Schema definition names the two formats share.
- The new `FORMAT_IDS` count, and every test that enumerates formats and had to change.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): add the gate-report and brief-report formats`

### Commit body

Two new formats replace what gate steps and brief providers will print. A gate-report is either checked (findings and review notes) or refused (reason and remedy). A brief-report carries rules and findings with their due. Both share one location ({file, lines}), guide ({summary, read}) and finding ({id, rule, location, message, related, guide}) definition, in a provider-neutral vocabulary.

The decoders refuse any key a format does not name, at any level, as well as a finding id used twice and a lines pair out of order. Each refusal names the key path, the id or the file. readGateReport and readBriefReport read a report only under its own $schema, and refuse another format by name, giving the URL phax reads. @lbdremy/phax-schemas gains parseGateReport and parseBriefReport, with JSON Schemas whose shared definitions are identical. Both formats are born at 0.21.0 through next snapshots. Nothing produces or consumes them yet.

---

## phase-02 — Gate report steps {#phase-02-gate-report-steps}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A gate step that declares `"output": "gate-report"` is judged from the gate report it prints. Any finding fails it, and an empty list on exit 0 passes it. Anything else is a broken step that gets the raw-log fix prompt. Every readable report is saved as printed and shown by `records explain --gates`. The fix prompt shows each finding with its rule, location, related locations and guide. The hello-world audit prints a gate report. `"output": "diagnostics"` still works in this phase; phase-03 removes it.

### Detailed instructions

- `src/schemas/phaxConfig.ts`: in this phase only, `GateOutputSchema` accepts `"log"`, `"diagnostics"` and `"gate-report"`. Add `gate-report` to the `output` description: phax reads a gate report on stdout, judges the step from it and saves it as `checks-attempt-NN.report-SS.json`. A report step does not have to declare `input` (§6). Regenerate `phax.schema.json` and `phax.user.schema.json` with `pnpm dev schema upgrade`; `phax.json` must stay byte-identical.
- New `src/domain/gate/reportPath.ts`, pure like `requestPathFor` in `gateRequest.ts`. `reportPathFor(attemptLogPath, step)` gives `checks-attempt-NN.report-SS.json` beside the log, where `SS` is the step's 1-based position, in two digits, among the steps the attempt runs. `parseReportName(name)` gives `{ attempt, step }` for such a name, or undefined for any other.
- `src/app/gates.ts`, for a step with `output: "gate-report"`: write the log lines as today, then parse stdout as JSON and read it with `readGateReport`. Empty output, invalid JSON or any `ReportError` makes a broken step (§5.2, §5.16):
      - push `fail`;
      - log `provider error: <line>`;
      - fail with the raw-log path and the message `Gate step "<command>": <describeReportError line>`, which names the gate-report URL;
      - write no report file.
- A readable report is saved first, whatever the verdict, with `fs.writeAtomic(reportPathFor(...), result.stdout)`. That is the exact string the step printed: never re-serialized, trimmed or re-stamped (§5.40). Then judge it:
      - a checked report with findings fails the step, whatever the exit code (§5.13);
      - a checked report with no finding and exit 0 passes, with or without review notes (§5.14);
      - a checked report with no finding and a non-zero exit is a broken step (§5.15);
      - a refused report is, in this phase only, a broken step with the message `Gate step "<command>" refused to run: <reason> (remedy: <remedy>)`. Phase-04 turns it into the pause.
    Steps stay fail-fast (§5.18).
- `GateFailedError` in `src/domain/errors.ts` gains a required field, `reportFindings: { readonly step: number; readonly findings: readonly GateFinding[] } | null`. It holds the findings and step position of a checked report that failed its step, and is null otherwise: for a log step, a broken step or a diagnostics step. Keep `diagnostics` in this phase. Fix every constructor, including those in tests.
- `src/domain/gate/fixPrompt.ts`: when `reportFindings` is non-null, render the spec §6 findings prompt. Keep today's heading, attempt line and shared Required action lines. The prompt reads, in order:
      - `**Failed step:** \`<command>\` (1 finding)`, or `(N findings)`;
      - `## Findings`, then each finding in the report's order: a `- <location>` line, then indented lines `rule: …`, `found: …`, one `also involves <location> — <why>` per related entry, and `guide: <summary>. Read <read> and follow it.` A finding whose guide is null gets no guide line;
      - `Full output: <logPath>`;
      - the Required action lines, whose first line becomes `Read the file each guide names before changing code, then fix every finding under **Findings**.`
    A location renders as `file`, as `file:N` when start equals end, or as `file:N-M` (§5.24, §5.25). Never render a finding id, a review note or anything else from the report (§5.26), and never read the guide's file. Broken and log steps keep the raw-log prompt (§5.17). The diagnostics rendering stays until phase-03. Write the new text without the §5.45 words.
- `src/app/fixLoop.ts` passes `reportFindings` to `buildFixPrompt`. `src/app/eventAdapter.ts` and the `GateFailed` event do not change in this phase.
- `src/app/recordsExplain.ts`, `gateArtifactsInOrder`: after each attempt's log and request, list every `<stem>.report-SS.json` of that attempt in step order, printed as stored (§5.42). Update the doc comment.
- Grants (§5.28): nothing in a report or a guide becomes a grant. The `security.agentCommands` handling does not change; a test holds this.
- Hello-world: new `examples/hello-world/rules.mjs`, used by `audit.mjs` now and by `brief.mjs` in phase-05. It exports the two rules:
      - `a module under src/ imports no node: module`, with guide `{ summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" }`;
      - `a module under src/ exports its function`, with guide null.
    It also exports a function that takes the working directory and repo-relative `.ts` paths under `src/`, and returns findings for the files that exist:
      - one per file and imported `node:` module, at that module's first import: `lines [n, n]`, id `no-node-import <file> node:<module>`;
      - one per file with no exported function: `lines` null, id `exports-function <file>`, guide null.
    Every finding's `related` is empty. Use `brief.mjs`'s `NODE_IMPORT_RE`, which captures the module. A file that imports one module twice gives one finding, and ids are stable across runs.
- `examples/hello-world/audit.mjs` keeps reading the gate request and picking the changed `.ts` files under `src/` (all of them on the terminal phase). It prints `{ $schema: "https://docs.phax.run/schemas/gate-report/0.21.0.json", outcome: "checked", findings, review: [] }` with that literal stamp, which the example-stamp test holds. New `examples/hello-world/guides/no-node-import.md`: a short made-up guide that says to keep I/O in the caller and pass values into the pure function. `examples/hello-world/phax.json`: the audit step's `output` becomes `"gate-report"`, and `input` stays.

### Planned files to create

- `src/domain/gate/reportPath.ts`
- `tests/unit/reportPath.test.ts`
- `examples/hello-world/rules.mjs`
- `examples/hello-world/guides/no-node-import.md`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/domain/errors.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/app/recordsExplain.ts`
- `examples/hello-world/audit.mjs`
- `examples/hello-world/phax.json`
- `tests/unit/fixPrompt.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/integration/agentCommandGrants.test.ts`
- `tests/integration/exampleProviders.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/telemetry/reportBuilders.test.ts`

### Optional files that may be edited

- `src/app/eventAdapter.ts`
- `src/schemas/report.ts`
- `src/schemas/persisted.ts`
- `src/cli/commands/records.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/gateProfile.test.ts`
- `tests/unit/exampleStamps.test.ts`

### Boundary contracts

Producers: `runGates` in `src/app/gates.ts`, and `reportPathFor` / `parseReportName` in `src/domain/gate/reportPath.ts`. Consumers: `src/app/fixLoop.ts` and `buildFixPrompt`, which use `GateFailedError.reportFindings`; `src/app/recordsExplain.ts`, which uses the saved file names; and, later, phase-04 (`still failing`) and phase-06 (review notes). Contract: a readable report of step SS in attempt NN is saved at `reportPathFor(<attempt log>, SS)` with the exact bytes printed. `reportFindings` is non-null exactly when a checked report's findings failed the step.

### Test strategy

Write first: `reportPath.test.ts`, and the fix-prompt cases in `fixPrompt.test.ts` for the §8 criterion 'The fix prompt shows each finding and nothing else', without the still-failing mark (phase-04). They check the order, the rule, `imports node:fs`, `src/cli.ts:3-5` with its why, the guide summary, and the instruction to read `guides/no-node-import.md`. They check that `src/farewell.ts` has no guide line, and that no finding id or review-note text appears.

Then `tests/integration/gates.test.ts`, on fake steps, one case per §8 criterion:
    - 'A finding fails the step, whatever the exit code': exit 0 and exit 1;
    - 'An empty list passes, and is saved': a byte-identical file beside `checks-attempt-01.log`;
    - 'An empty list with a non-zero exit is broken': a raw-log failure, attribution `fail`, the report saved;
    - 'No readable report is broken': empty stdout and `not json`, nothing saved;
    - the gate half of 'Another format is refused by name': a `gate-diagnostics/0.20.0` document and a `brief-report/0.21.0` document each name the gate-report URL;
    - the step-level half of the malformed criteria: one table of the §8 duplicate-id, line-order, extra-key and outcome cases, each a broken step;
    - the checked half of 'No step runs after a failure or a refusal': no `$ pnpm test` line;
    - 'Every readable gate report is saved as printed': pretty-printed with a trailing newline, attempt 1 checked, attempt 2 refused, and no `.diagnostics.json`;
    - the gate half of 'phax judges nothing in the content': `src/nowhere.ts` and `guides/missing.md`.

Other suites:
    - `fixLoop.test.ts`: a broken step spends one fix attempt on the raw-log prompt, and a failing report's prompt lists its findings.
    - `recordsExplain.test.ts`: §8 '`records explain --gates` prints the reports'.
    - `agentCommandGrants.test.ts`: §8 'A report grants nothing'.
    - `exampleProviders.test.ts`: the audit half of §8 'The hello-world providers answer both formats', where `parseGateReport` reads the output and the guide file exists.
    - `persistedProducer.test.ts` maps `.report-NN.json` to `gate-report` and drops `gate-report` from `NEVER_WRITTEN`.

### Implementation order

1. `reportPath.ts` with its tests
2. Fix-prompt tests, then the findings prompt
3. `GateFailedError.reportFindings` and its constructors
4. The gate-report branch of `runGates`, with the integration tests
5. `fixLoop.ts` and `recordsExplain.ts`
6. Config value, schema regeneration, then the hello-world files and example tests
7. Standard gate

### Excluded scope

- Removing `"output": "diagnostics"`, gate-diagnostics or the `GateFailed` event's `diagnostics` (phase-03).
- The refusal pause, gate-attribution `refused` and the `still failing` mark (phase-04).
- Review notes in the review handoff (phase-06).
- README prose (phase-03 and phase-07).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record the following in the handoff:
- The exact signatures of `reportPathFor` and `parseReportName` in `src/domain/gate/reportPath.ts`.
- The shape of `GateFailedError.reportFindings`.
- The broken-step message spellings.
- The fix prompt as rendered for the §6 checked example.
- The exports of `examples/hello-world/rules.mjs`.
- Every place that still handles `"output": "diagnostics"` and must go in phase-03.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(gate): judge report steps from the gate report they print`

### Commit body

A gate step that declares "output": "gate-report" is now judged from the gate report it prints. Any finding fails the step whatever the exit code, and an empty list passes it on exit 0. Anything else is a broken step: no readable report, another format, or an empty list with a non-zero exit. A broken step gets the raw-log fix prompt. Every readable report is saved byte for byte as checks-attempt-NN.report-SS.json, and records explain --gates prints it after the attempt's log and request.

The fix prompt lists each finding with its rule, location, message, related locations and guide, and tells the agent to read the guide's file and follow it. phax never opens that file, and grants nothing because a report names a command. The hello-world audit prints a gate report over two rules, which it shares with the future brief provider through rules.mjs, and ships its guide. "output": "diagnostics" still works until the next commit retires it.

---

## phase-03 — Retire gate-diagnostics {#phase-03-retire-gate-diagnostics}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

phax stops reading `gate-diagnostics`. `"output": "diagnostics"` is refused at config load with exit 2, and the format leaves phax and `@lbdremy/phax-schemas` with no shim and no leftover name. Every `gate-diagnostics` URL docs.phax.run serves today keeps serving the same bytes, from frozen copies. The README's gate section becomes "Gate report steps".

### Detailed instructions

- Make the frozen copies first, before deleting anything (§5.44). For each ledger release, the site serves the format's latest release-named snapshot at or before that release. So `/schemas/gate-diagnostics/0.17.0.json`, `0.18.0.json` and `0.19.0.json` are the bytes of `packages/schemas/snapshots/gate-diagnostics/0.17.0.schema.json`, and `0.20.0.json` is the bytes of `0.20.0.schema.json`. Confirm that list with the site build's own functions, `readSchemaSources` and `publicSchemas` from `site/build/schemas.ts`, run through `pnpm exec tsx`. Copy each file with `node` and `fs.copyFileSync` to `site/retired-schemas/gate-diagnostics/<release>.json`, then verify every copy byte for byte against the served bytes. `.oxfmtrc.json` already ignores `site/retired-schemas`. Leave the deploy guard and the ledger untouched.
- Config (§5.3): `GateOutputSchema` becomes `"log" | "gate-report"`. Config loading fails with a `ConfigValidationError` (exit 2) for any gate step whose `output` is anything else, `"diagnostics"` included, in any layer or workspace profile. The message names the step's command and both values, e.g. `gate step "node ./audit.mjs": output must be "log" or "gate-report"`. Put the check where config decode errors become messages (`src/app/loadConfig.ts` or `src/schemas/formatError.ts`), not in a CLI file. Remove the diagnostics text from the `output` description, then regenerate `phax.schema.json` and `phax.user.schema.json` with `pnpm dev schema upgrade`.
- `src/app/gates.ts`: delete the diagnostics branch, `DIAGNOSTICS_EXPECTED_SHAPE`, the `.diagnostics.json` write and the imports they leave unused. Delete `src/domain/gate/diagnosticsPath.ts` and `tests/unit/diagnosticsPath.test.ts`, and fix the comment in `gateRequest.ts` that names `diagnosticsPathFor`.
- `GateFailedError` loses `diagnostics`. The `GateFailed` event loses `diagnostics` and carries nothing to replace it; the saved report holds the findings. Update `src/domain/events.ts`, `src/app/eventAdapter.ts` and `src/app/fixLoop.ts`. `buildFixPrompt` loses its `diagnostics` input and its diagnostics rendering.
- `src/schemas/persisted.ts`: delete `readGateDiagnosticsAnswer`, `GateDiagnosticsAnswerError` and `LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE`. In `tests/unit/persisted.test.ts`, delete the gate-diagnostics reader block, but move its 'is written for a single answer shape' guard to `readGateReport`, reading `packages/schemas/snapshots/gate-report`, so the 1.0 rule keeps a test.
- Delete the format from phax and the package:
      - `src/schemas/gateDiagnostics.ts`;
      - `src/schemas/history/gate-diagnostics/pre-schema.ts` and `src/schemas/history/gate-diagnostics/0.17.0.ts`;
      - the three snapshots under `packages/schemas/snapshots/gate-diagnostics/`, and the directory with them;
      - `gate-diagnostics` in `FORMAT_IDS`, fixing the doc comment;
      - the gate-diagnostics section of `packages/schemas/src/formats/recordTimeline.ts`, and its mention in the header comment;
      - every gate-diagnostics export of `packages/schemas/src/index.ts`: parser, upgrade function, types, schema, frozen-module re-exports, and the `DocumentShapes` and `parseDocument` entries;
      - the format's two entries in `packages/schemas/build/jsonSchemas.ts`.
    Run `pnpm exec tsx scripts/schemas-check.ts --write`, then the check. `history.lock.json` must lose exactly the two gate-diagnostics entries, and `CURRENT_SHAPES` and `CURRENT_STAMPS` lose the format.
- README.md: replace `### Diagnostics gate steps` with `### Gate report steps`. Cover:
      - the spec §6 checked example and `"output": "gate-report"`;
      - the verdict rules: a finding fails the step whatever the exit code; an empty list passes on exit 0; anything else is a broken step that gets the raw log;
      - the saved `checks-attempt-NN.report-SS.json`;
      - that `id` is compared by equality only, and that phax never opens a guide's file.
    Remove the `Gate diagnostics` row. Fix every other README mention of `gate-diagnostics`, `"diagnostics"` or `.diagnostics.json`; the Gate request section names diagnostics steps. Write without the §5.45 words. The refusal, review notes and the full pass come in phase-07, so describe nothing this phase does not ship.
- Tests:
      - Delete `tests/unit/schemas/gateDiagnostics.test.ts`.
      - Remove gate-diagnostics from the schemasPackage suite and fixtures, the type tests, `schemaUrl.test.ts` (the `FORMAT_IDS` and `PRE_SCHEMA_FORMAT_IDS` counts), `architecturalGuards.test.ts`, `persistedProducer.test.ts`, and the gate, fix-loop, event, dispatcher and reducer tests.
      - Where gate-diagnostics was only an arbitrary fixture id, use another real format id or a made-up one.
      - Switch every remaining `"output": "diagnostics"` test step to `"gate-report"`, with a report fixture.
      - Add the §8 cases for 'Only `log` and `gate-report` are outputs': a step with `diagnostics` exits 2, naming the step and both values; a `gate-report` step with no `input` loads.
- Sweep: run `git grep -n -E 'gate-diagnostics|GateDiagnostic|gateDiagnostics|readGateDiagnosticsAnswer|diagnosticsPathFor|diagnostics.json|"diagnostics"' -- . ':!docs/specs' ':!docs/plans' ':!docs/briefs' ':!site/retired-schemas'`. Every hit must be in a file phase-05 or phase-07 owns (`src/cli/cliDocs.ts`, `phax.usage.kdl`, `docs/cli/reference.md`, `docs/blog/announcing-phax-1.0.md`, `.claude/skills/`, `NEXT_STEPS.md`), or be an unrelated use of the word. Paste the command and its output into the handoff, with a reason for each hit.

### Planned files to create

- `site/retired-schemas/gate-diagnostics/0.17.0.json`
- `site/retired-schemas/gate-diagnostics/0.18.0.json`
- `site/retired-schemas/gate-diagnostics/0.19.0.json`
- `site/retired-schemas/gate-diagnostics/0.20.0.json`

### Planned files to edit

- `src/schemas/gateDiagnostics.ts`
- `src/schemas/history/gate-diagnostics/pre-schema.ts`
- `src/schemas/history/gate-diagnostics/0.17.0.ts`
- `packages/schemas/snapshots/gate-diagnostics/pre-schema.schema.json`
- `packages/schemas/snapshots/gate-diagnostics/0.17.0.schema.json`
- `packages/schemas/snapshots/gate-diagnostics/0.20.0.schema.json`
- `src/domain/gate/diagnosticsPath.ts`
- `tests/unit/diagnosticsPath.test.ts`
- `tests/unit/schemas/gateDiagnostics.test.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/schemas/phaxConfig.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/eventAdapter.ts`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/domain/gate/gateRequest.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `README.md`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/schemasPackage/shapes.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/unit/schemas/gateRequest.test.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/unit/gateProfile.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/telemetry/reportBuilders.test.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/dispatcher.test.ts`
- `tests/integration/eventAdapter.test.ts`
- `tests/integration/persistedProducer.test.ts`

### Optional files that may be edited

- `src/schemas/formatError.ts`
- `src/schemas/brief.ts`
- `scripts/schemas-check.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/unit/schemasPackage/repositoryFormats.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/integration/briefProvider.test.ts`
- `tests/unit/schemas/brief.test.ts`

### Boundary contracts

Inputs to the site build: the retired copies under `site/retired-schemas/gate-diagnostics/`, served byte for byte and listed in `/schemas/index.json` by the existing generic code. `FORMAT_IDS` no longer holds `gate-diagnostics`. Consumers are the package's format table, `parseDocument`, the schemas check and the site build. Config loading: a gate step's `output` is `"log" | "gate-report"`, and anything else is a `ConfigValidationError` that names the step.

### Test strategy

The removal is covered by the existing schemasPackage suite, the type tests, the schemas check (run inside `pnpm test`) and `tests/unit/site/schemas.test.ts`, which already serves every file under `site/retired-schemas/` from the real repository. Write first: the config-refusal cases in `loadConfig.test.ts` and `gateProfile.test.ts` (§8 'Only `log` and `gate-report` are outputs', in the project layer and in a user overlay). The gate, fix-loop and event tests keep their meaning on report-step fixtures.

### Implementation order

1. Copy the served bytes into `site/retired-schemas/gate-diagnostics/` and verify them
2. Config refusal tests, then the output literal, the refusal message and schema regeneration
3. Remove the gate branch, the path helper, the error and event field, and the prompt rendering
4. Remove the reader, the format, the frozen modules, the snapshots and the package entries; run the schemas write and check
5. README section and row
6. Tests, the sweep, then the standard gate

### Excluded scope

- The refusal pause and gate-attribution `refused` (phase-04).
- Anything about the brief or brief-answer (phase-05).
- `src/cli/cliDocs.ts`, the usage spec, skills, blog and NEXT_STEPS (phase-07).
- Any change to `site/build/deploy-guard.ts`, the ledger, or which URLs a current format is served at.

### Verification

The `standard` gate profile in `phax.json`. Also run `pnpm exec tsx scripts/schemas-check.ts`, which must pass, and the byte comparison of the four retired copies against the bytes the site served before the deletion.

### Expected handoff content

Record the following in the handoff:
- The byte-comparison result for the four retired copies, and how the served list was confirmed.
- The `history.lock.json` diff for this phase: exactly two entries removed.
- The new `FORMAT_IDS` count.
- The exact config-refusal message.
- The sweep command, its output and the owner of each remaining hit.
- Every test where gate-diagnostics was a fixture id, and what replaced it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`refactor(gate)!: retire gate-diagnostics and keep its served URLs`

### Commit body

phax stops reading gate-diagnostics. "output": "diagnostics" is refused at config load with exit 2, naming the step and the two allowed values, "log" and "gate-report". The diagnostics branch of the gate goes, together with its expected-shape hint, the .diagnostics.json write and its path helper, the diagnostics carried by GateFailedError and the GateFailed event, and the answer reader with its last-release constant.

The format leaves phax and @lbdremy/phax-schemas with no shim: no format id, schema, parser, type, frozen history module, lock entry, snapshot or JSON Schema. The gate-diagnostics schemas that docs.phax.run serves for 0.17.0 to 0.20.0 stay up byte for byte, from frozen copies under site/retired-schemas/. The README's Diagnostics gate steps becomes Gate report steps, and its Persisted formats row goes.

BREAKING CHANGE: a gate step declaring "output": "diagnostics" is refused; declare "gate-report" and print a gate report.

---

## phase-04 — Refusals and repeat findings {#phase-04-refusals-repeat-findings}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A refused gate report stops the phase with exit 4 and no fix attempt, naming the step, the reason and the remedy. It pauses the phase exactly as exhaustion does, and `phax resume` reruns the gate with a full budget. gate-attribution records the step as `refused`. A finding the same step reported in the previous attempt is marked `still failing`.

### Detailed instructions

- gate-attribution gains `refused` (§5.23).
      1. Freeze its current 0.20.0 shape (pass | fail) as `src/schemas/history/gate-attribution/0.20.0.ts`, self-contained like `0.17.0.ts`.
      2. List it in the format's `releases` in `packages/schemas/src/formats/recordTimeline.ts`, and re-export its schema from `packages/schemas/src/index.ts` as the 0.17.0 schema is.
      3. In `src/schemas/gateAttribution.ts`, `result` becomes `"pass" | "fail" | "refused"`.
      4. Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes `packages/schemas/snapshots/gate-attribution/next.schema.json`, moves gate-attribution's `CURRENT_STAMPS` entry to 0.21.0 and adds the lock entry.
    Check that verified surfaces count only `pass`.
- Refused reports in the gate (§5.18, §5.19). `src/domain/errors.ts` gets a new `GateStepRefusedError { message, command, reason, remedy, logPath, phaseId }`. In `src/app/gates.ts`, a refused report is already saved as printed. The step is then recorded as `refused` and logs `refused: <reason> — remedy: <remedy>`. phax writes the log and the attribution and fails with `GateStepRefusedError`, and no later step runs. The step's exit code does not matter.
- State machine (follow the `state-machines` skill). Add a new event to `src/domain/events.ts`: `GateStepRefused { attempt, phaseId, worktreePath, sessionId, command, reason, remedy }`. Give it a row in every state table of `src/domain/matrix.ts`. In `src/domain/reducer.ts`, from `running` with the phase in `gates_failed`, it does what `FixAttemptsExhausted` does: run `interrupted`, phase `gates_exhausted`, `stoppedReason: "gates_exhausted"` (§5.21). Three things differ:
      - `lastError` is `Gate step refused: <command> — <reason>`;
      - the resume context is `{ reason: "Gate step refused", kind: "gate_refused", phaseId, worktreePath, sessionId, refusal: { command, reason, remedy } }`;
      - the trace is `gate.refused`.
    Add no phase state or stop reason. In `src/domain/effects.ts`, extend `ResumeContext` with that reason, kind and `refusal`, and with whatever `src/app/effectRunner.ts` maps.
- `src/app/resumeInstructions.ts`: the `gate_refused` instructions say the step refused, give the reason and the remedy, say that no fix attempt was made, and end with `phax resume <short name>`. `src/domain/whatsNext.ts`: add a `gate_refused` scenario that carries the command, reason and remedy and renders the spec §6 run output: `<phase> gate: \`<command>\` refused to run: <reason>`, `remedy: <remedy>`, then `No fix attempt was made. Fix the cause, then: phax resume <name>`.
- On `GateStepRefusedError`, `src/app/fixLoop.ts`:
      1. records the gate as rejected (`refused: <command>`);
      2. dispatches `GateFailed`, then `GateStepRefused`;
      3. fails with the error. There is no `FixStarted`, no fix prompt and no fix attempt counted (§5.19).
    `src/app/executePlan.ts` treats the error like `GateAttemptsExhaustedError`: the run pauses rather than fails. `src/cli/commands/run.ts` and `resume.ts` print the `gate_refused` what's-next and the path to the resume instructions. `exitCodeForError` in `src/cli/commands/runLayers.ts` maps the error to 4 (§5.20). `adaptGateRun` in `eventAdapter.ts` lets the refusal error through.
- Resume (§5.22): check that a `gates_exhausted` phase re-enters at the gate before any agent turn, and that `runGatesWithFixLoop` starts with the full `maxFixAttempts` budget. Change nothing if both already hold.
- Still failing (§5.27). `buildFixPrompt` takes `stillFailing: ReadonlySet<string>` and marks a finding whose id is in the set with ` · still failing` after its location. `fixLoop.ts` builds the set from the same step's report in the phase's previous gate attempt:
      - when `attempt > 1`, read `reportPathFor(logPath(attempt - 1), reportFindings.step)` through the `FileSystem` port;
      - when that file exists and `readGateReport` reads it as checked, its finding ids are the set;
      - a missing, unreadable or refused file gives the empty set.
    Reading the saved file keeps the mark across a resume, whose previous attempt ran in another process. Never show anything else from earlier attempts (§5.26).

### Planned files to create

- `src/schemas/history/gate-attribution/0.20.0.ts`
- `packages/schemas/snapshots/gate-attribution/next.schema.json`
- `tests/unit/reducerGateRefusal.test.ts`
- `tests/integration/gateRefusal.test.ts`

### Planned files to edit

- `src/schemas/gateAttribution.ts`
- `src/schemas/release.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `src/domain/errors.ts`
- `src/domain/events.ts`
- `src/domain/matrix.ts`
- `src/domain/reducer.ts`
- `src/domain/effects.ts`
- `src/domain/whatsNext.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/app/resumeInstructions.ts`
- `src/app/gates.ts`
- `src/app/fixLoop.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/runLayers.ts`
- `tests/unit/fixPrompt.test.ts`
- `tests/unit/whatsNext.test.ts`
- `tests/unit/resumeInstructions.test.ts`
- `tests/unit/cli/run.test.ts`
- `tests/unit/gateAttribution.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/gates.test.ts`
- `tests/integration/fixLoop.test.ts`

### Optional files that may be edited

- `src/app/effectRunner.ts`
- `src/app/eventAdapter.ts`
- `src/app/gateAttribution.ts`
- `src/domain/gate/verifiedSurfaces.ts`
- `tests/unit/cli/resume.test.ts`
- `tests/unit/reducer.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/state.test.ts`
- `tests/unit/gateAttribution.reader.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/executePlan.test.ts`

### Boundary contracts

Producer: `runGates`, which fails with `GateStepRefusedError` carrying `command`, `reason`, `remedy`, `logPath` and `phaseId`. Consumers: `fixLoop.ts` (events, no fix), `executePlan.ts` (pause), and the CLI's `run` and `resume` (render and exit 4). Domain contract: `GateStepRefused` takes `running`/`gates_failed` to `interrupted`/`gates_exhausted`, with stop reason `gates_exhausted` and resume kind `gate_refused`. File contract: the previous attempt's saved report at `reportPathFor(<previous log>, step)` is the only input to `still failing`. `gate-attribution.json`'s step result is `pass | fail | refused`, stamped at gate-attribution's current stamp.

### Test strategy

Write first:
    - the reducer cases, in new `tests/unit/reducerGateRefusal.test.ts` following `reducerCommitPause.test.ts`: from `gates_failed` to `gates_exhausted`, stopped reason `gates_exhausted`, the refusal lastError, the `gate_refused` resume context, and stale or unexpected outcomes as the matrix says;
    - `whatsNext.test.ts` and `resumeInstructions.test.ts`, for the step, the reason and the remedy;
    - `fixPrompt.test.ts`, for the mark.

New `tests/integration/gateRefusal.test.ts`, with fakes:
    - §8 'A refusal stops the phase without a fix attempt': `maxFixAttempts` 3, no fix prompt sent, attribution `refused`, and an error carrying the step, reason and remedy;
    - §8 'A refusal pauses like exhaustion, and resume runs the gate': the phase is `gates_exhausted` with the same stopped reason, and lastError and resume-instructions.md name the remedy. On resume the gate runs before any agent turn, and up to 3 fix attempts follow its failure.

Other suites:
    - `tests/unit/cli/run.test.ts`: `exitCodeForError` gives 4 for the refusal.
    - `gates.test.ts`: the refusal half of 'No step runs after a failure or a refusal', and a refused report saved as printed.
    - `fixLoop.test.ts`: §8 'Still failing, by id alone', with ids across attempts at different lines. The case where `pnpm test` fails first marks nothing. A `startAttempt` above 1, with the previous attempt's report on disk, still marks.
    - `gateAttribution.test.ts` and the package's `recordTimeline.test.ts`: a 0.20.0 attribution reads as shape 0.20.0, and a 0.21.0 one with `refused` reads as `next`.

### Implementation order

1. Freeze gate-attribution 0.20.0, then widen the result, run the schemas write, and add the package tests
2. Reducer tests, then the event, the matrix rows, the reducer case and the resume context
3. Resume instructions and what's-next, with their tests
4. `GateStepRefusedError` in the gate, then the fix loop, `executePlan` and the CLI exit code
5. The still-failing set in the fix loop and the prompt mark
6. Integration tests, then the standard gate

### Excluded scope

- A new phase state or stop reason.
- Escalating or stopping on a finding that keeps coming back; counting fixed or new findings.
- Review notes (phase-06) and README prose (phase-07).
- Any brief change (phase-05).

### Verification

The `standard` gate profile in `phax.json`. The schemas check inside `pnpm test` holds the gate-attribution `next` snapshot, the frozen 0.20.0 module and its lock entry.

### Expected handoff content

Record the following in the handoff:
- The exact names and fields of `GateStepRefusedError`, the `GateStepRefused` event and the `gate_refused` resume and what's-next kinds.
- The `lastError` and run-output spellings.
- How the fix loop finds the previous report.
- The gate-attribution lock entry that was added.
- Confirmation that resume already re-enters at the gate with a full budget, or what had to change.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(gate): pause on a refused gate report and mark repeat findings`

### Commit body

A report step that prints a refused gate report now stops the phase without a fix attempt. The run exits 4, naming the step, the reason and the remedy. The phase reuses the gate-failure pause: phase gates_exhausted and stop reason gates_exhausted, with a lastError and resume instructions that say the step refused and give the remedy. phax resume runs the gate first, with the full fix budget. A new GateStepRefused event and a gate_refused what's-next carry the refusal. No phase state or stop reason is added.

gate-attribution records such a step as refused. Its 0.20.0 shape is frozen as a history module, and the format gets a next snapshot at 0.21.0.

The fix prompt marks a finding still failing when the same step's checked report in the phase's previous gate attempt listed the same id. The fix loop reads that report from its saved file, so the mark holds across a resume.

---

## phase-05 — Brief reports and brief.push {#phase-05-brief-reports}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

A brief provider answers with a brief report. `brief.push` is required, and chooses what the phase's first prompt lists: the findings due this phase, or those findings and the rules. `phax brief` prints the whole report. A declining or unreadable provider is a failed brief, and records keep the report as printed. `brief-answer` leaves phax and the package, with its served URL kept, and brief-record's description names the new format.

### Detailed instructions

- Config (§5.29): `BriefConfigSchema` becomes `{ command, push: "findings" | "findings-and-rules" }`. `push` is required with no default, in `phax.json` and in the user overlay schema (`phax.local.json`, `~/.phax/config.json`). A `brief` block without `push`, or with another value, fails config loading with exit 2. The message names the layer's file, `brief.push` and both values, e.g. `phax.json: brief.push must be "findings" or "findings-and-rules"`. `mergeConfigLayers` takes `push` from the same highest layer as `command`. Rewrite the `brief` and `command` descriptions to say the provider prints a brief report on stdout and what each push value lists, then run `pnpm dev schema upgrade`.
- `src/app/briefProvider.ts`: read the answer with `readBriefReport`. A failure becomes a failed outcome whose reason is `describeReportError`'s line (§5.35). `BriefOutcome.decoded` is a `BriefReport`. A non-zero exit stays a failed brief carrying the provider's stderr, as today.
- Pushed section in `src/domain/brief/render.ts` (§5.30–§5.33). `renderBriefSection` takes the push mode. The items are:
      - first, the findings due `this-phase`, in the provider's order, each `- <location> — <rule> — <message>`, plus ` · guide: <summary> (read <read>)` when it has a guide;
      - then, with `findings-and-rules` only, each rule as `- rule: <rule> — <files joined by ", ">`, plus the same guide suffix.
    Show at most `BRIEF_PUSH_CAP` (50) item lines, then `- …and N more not shown. \`phax brief\` prints the phase's brief whole.`, where N counts the items left. With no item, the body is one line: `Nothing in this phase's planned files is due in this phase.` (findings) or `The brief lists nothing for this phase's planned files.` (findings-and-rules). A finding due `later` or null is never pushed.
- Pushed section, continued. The intro follows the mode: `What fails in this phase's planned files and is due in this phase, in the provider's order. It informs; the gate decides.` for findings, and a variant that also names the rules over the planned files for findings-and-rules. The first instruction becomes: run `phax brief <path> [<path>…]` to see the rules over it, what fails there and how to fix it. The failed line is unchanged.
- `renderWholeBrief(report)` (§5.34) follows the spec §6 layout:
      - `Rules`, then for each rule its text, a `files:` line and a `guide:` line;
      - `Findings`, then for each finding `<location>` with `due this phase` or `due later` (nothing when due is null), followed by `rule:`, `found:`, one `also involves <location> — <why>` per related entry, and `guide:`.
    An empty report (no rule and no finding) prints `renderNoBrief`. A location renders as in the fix prompt (`file`, `file:N`, `file:N-M`); share one pure helper if both need it. None of the §5.45 words appears in any text this module renders.
- `src/app/pushedBrief.ts` passes `config.brief.push`. `src/app/pullBrief.ts` and `src/cli/commands/brief.ts` print the whole report and keep their exit codes: 0 with a report, 1 on a failed brief. Records (§5.41): `serializeBriefRecord` keeps the parsed answer as printed, with its keys and their order, never re-stamped. Check this, and change nothing if it already holds.
- brief-record: rewrite the answered outcome's `answer` description to name the brief report and `parseBriefReport`. Before that, freeze brief-record's 0.20.0 shape as `src/schemas/history/brief-record/0.20.0.ts`, self-contained like the other frozen modules (its nested brief request included), and list it in `briefRecordFormat`'s `releases`. The schemas write then gives brief-record a `next` snapshot and moves its stamp to 0.21.0. brief-request is unchanged.
- Retire brief-answer as phase-03 retired gate-diagnostics. Before deleting anything, copy the bytes served at `/schemas/brief-answer/0.20.0.json` (the 0.20.0 snapshot; confirm with the site build's functions) to `site/retired-schemas/brief-answer/0.20.0.json`, and verify them byte for byte. Then delete:
      - the brief answer section of `src/schemas/brief.ts`;
      - `readBriefAnswer`, `BriefAnswerError`, `describeBriefAnswerError` and `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` from `persisted.ts`;
      - `brief-answer` from `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS`;
      - the package's brief-answer section, exports and JSON Schema entry;
      - `packages/schemas/snapshots/brief-answer/`.
    Run `pnpm exec tsx scripts/schemas-check.ts --write`, then the check. Move the 'is written for a single answer shape' guard to `readBriefReport` and the brief-report snapshots.
- Hello-world: `examples/hello-world/brief.mjs` keeps `briefedFiles` and `dueOf`, and keeps only `.ts` files under `src/`. It prints `{ $schema: "https://docs.phax.run/schemas/brief-report/0.21.0.json", rules, findings }`:
      - `rules`: both rules from `rules.mjs`, each with the briefed files (existing or not) and its guide, or `[]` when no file is briefed;
      - `findings`: `rules.mjs`'s findings for those files, each with `due` from `dueOf` (null outside a phase).
    `examples/hello-world/phax.json`: `"brief": { "command": "node ./brief.mjs", "push": "findings-and-rules" }`.
- README.md: rewrite `### Brief provider` around the spec §6 brief report. Cover the rules and findings, `due`, an empty report, `brief.push` with both values, that a provider that declines to run exits non-zero, and that phax never opens a guide's file. Remove the `Brief answer` row. Write without the §5.45 words.

### Planned files to create

- `site/retired-schemas/brief-answer/0.20.0.json`
- `src/schemas/history/brief-record/0.20.0.ts`
- `packages/schemas/snapshots/brief-record/next.schema.json`

### Planned files to edit

- `src/schemas/brief.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/domain/brief/render.ts`
- `src/app/briefProvider.ts`
- `src/app/pushedBrief.ts`
- `src/app/pullBrief.ts`
- `packages/schemas/src/formats/brief.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/snapshots/brief-answer/0.20.0.schema.json`
- `phax.schema.json`
- `phax.user.schema.json`
- `examples/hello-world/brief.mjs`
- `examples/hello-world/phax.json`
- `README.md`
- `tests/unit/schemas/brief.test.ts`
- `tests/unit/schemas/briefConfig.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/unit/briefRender.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/briefFormats.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/briefProvider.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/briefRecords.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/exampleProviders.test.ts`

### Optional files that may be edited

- `src/cli/commands/brief.ts`
- `src/domain/brief/pull.ts`
- `src/domain/gate/fixPrompt.ts`
- `src/app/loadConfig.ts`
- `src/app/executePlan.ts`
- `src/schemas/formatError.ts`
- `tests/unit/briefPull.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`
- `tests/unit/cli/schemaUpgrade.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/unit/exampleStamps.test.ts`

### Boundary contracts

Producer: `queryBrief` in `src/app/briefProvider.ts`, returning `{ kind: "answered", answer (as printed), decoded: BriefReport } | { kind: "failed", reason }`. Consumers: `pushedBrief.ts` (renders with `config.brief.push`), `pullBrief.ts` and `phax brief` (render the whole report), and brief records (store `answer` as printed). Config contract: `ResolvedConfig.brief` is `{ command, push }`, and both are always present when `brief` is declared. Package contract: `parseBriefRecord` reads 0.20.0 records as shape 0.20.0 and 0.21.0 records as `next`. The record's `outcome.answer` is read with `parseBriefReport`.

### Test strategy

Write first:
    - `briefRender.test.ts`, for these §8 criteria: 'Pushing findings lists only what is due this phase'; 'Pushing findings and rules'; 'The pushed brief stops at 50 lines' (45 due, 5 later and 10 rules give 45 findings, 5 rules and '5 more'); and 'Nothing to push', in both setups. It also covers the whole form of '`phax brief` prints the whole report'.
    - `briefConfig.test.ts` and `mergeLayers.test.ts`, for §8 '`brief.push` is required and explicit': a missing `push` and `rules` both fail, naming `brief.push` and both values; `findings` loads; in each layer.

Then integration tests on fakes:
    - `pushedBrief.test.ts`: the §6 report pushed in both modes. The brief half of 'Another format is refused by name': `brief-answer/0.20.0` and `gate-report/0.21.0` answers make the brief unavailable, naming the brief-report URL, and the phase continues. The malformed brief cases of §8 name the shared id and `review`, and an `outcome` key is refused.
    - `briefCommand.test.ts`: '`phax brief` prints the whole report', exiting 0. 'A declining brief provider is a failed brief', exiting 1 with the provider's stderr. The brief half of 'phax judges nothing': due this-phase outside a phase prints as is.
    - `briefRecords.test.ts`: 'Brief reports are recorded as printed', with keys reordered, in `brief-00.json` and `brief-01.json`.
    - `briefProvider.test.ts`.
    - `exampleProviders.test.ts`: the brief half of the hello-world criterion. Given `{"files": ["src/greet.ts", "src/farewell.ts"]}`, both rules cover both files, the greet finding has due null, and `parseBriefReport` reads the output.
    - The package's `briefFormats.test.ts`: a 0.20.0 brief record reads as shape 0.20.0, and a 0.21.0 one as `next`.

### Implementation order

1. Config tests, then `push` in both schemas, the refusal message, `mergeConfigLayers` and schema regeneration
2. Render tests, then the pushed section and the whole form
3. `briefProvider.ts` on `readBriefReport`, then `pushedBrief.ts` and `pullBrief.ts`
4. Freeze brief-record 0.20.0, then its description change
5. Copy the brief-answer served bytes, then remove the format and run the schemas write and check
6. Hello-world `brief.mjs` and `phax.json`, then the README section and row
7. Integration tests, then the standard gate

### Excluded scope

- Any change to `brief-request` or the gate request.
- The 60 s limit, the `phax brief` grant, the phase guard, or the pushed and pulled moments.
- A refused outcome for the brief report, or a push value that pushes nothing.
- Review notes (phase-06); the usage spec, skills, blog and NEXT_STEPS (phase-07).

### Verification

The `standard` gate profile in `phax.json`. Also run `pnpm exec tsx scripts/schemas-check.ts`, which must pass, and the byte comparison of the retired brief-answer copy against the bytes the site served before the deletion.

### Expected handoff content

Record the following in the handoff:
- The exact config refusal message, and how each layer reports it.
- The pushed section as rendered for the §6 report in both modes, and the nothing-to-push lines.
- The `phax brief` output for the §6 report.
- The byte-comparison result for the retired brief-answer copy, and the `history.lock.json` diff for this phase (brief-record 0.20.0 added).
- A reminder that any operator config declaring `brief` must now add `push`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(brief)!: answer with brief reports and require brief.push`

### Commit body

A brief provider now answers with a brief report: the rules over the requested paths, and the findings there with their due. brief.push is required in every config layer that declares brief, with no default. "findings" pushes the findings due in this phase into the phase's first prompt. "findings-and-rules" pushes those findings, then the rules with their files and guides. Either way the list stops at 50 lines, with an overflow line, and says so in one line when there is nothing to list. phax brief prints the whole report. A provider that exits non-zero or prints no readable report is a failed brief. Brief records keep the report as printed.

brief-answer leaves phax and @lbdremy/phax-schemas with no shim. Its served 0.20.0 schema stays up from a frozen copy under site/retired-schemas/. brief-record's answer description now names the brief report. Its 0.20.0 shape is frozen as a history module, and it gets a next snapshot at 0.21.0. The hello-world brief provider prints a brief report through the shared rules module, and pushes findings and rules.

BREAKING CHANGE: a brief block without push, or with any other value, fails config loading with exit 2; brief providers must print a brief report.

---

## phase-06 — Review notes {#phase-06-review-notes}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

The review handoff, and so the PR body, carries a `## Review notes` section before `## Phase details`. It lists every review note that the report steps left in each phase's last gate attempt, grouped by owner, with a shared note listed once with its phases. No note ever reaches the agent.

### Detailed instructions

- New `src/domain/review/reviewNotes.ts`, pure.
      - `gatherReviewNotes(phases: ReadonlyArray<{ phaseId; notes: ReadonlyArray<ReviewNote> }>)` groups the notes by owner, owners in first-seen order (phase order, then the report's order). Within an owner, each distinct note text is listed once, with every phase that reported it, in phase order (§5.36, §5.37).
      - `renderReviewNotes(groups)` returns undefined when there is no note. Otherwise it returns `## Review notes`, the intro `Notes the gate steps left for a person. None was sent to the agent.`, then for each owner `### <owner>` followed by `- <note> (<phase ids joined by ", ">)` (§6).
- `src/app/loadReviewHandoffInputs.ts`: for each phase folder, find the last gate attempt (the highest `checks-attempt-NN.log`) through the `FileSystem` port. Read every `checks-attempt-NN.report-SS.json` of that attempt, in step order, with `readGateReport`, and keep the review notes of the checked reports. A phase with no attempt contributes nothing, and neither does a report that is missing, unreadable or refused. Earlier attempts are never read. Use `parseReportName` from `src/domain/gate/reportPath.ts`.
- `src/app/reviewHandoff.ts`: `ReviewHandoffExtras` gains `reviewNotesMd`. `buildReviewHandoffContent` renders it, only when present, after the compliance review and directly before `## Phase details` (§5.38). `generateReviewHandoff` passes it in. The PR body carries the section because it carries the handoff. Check that `src/domain/publish/body.ts` cuts the body from its end, so the section survives truncation, and change nothing there if it does.
- Nothing else changes: no prompt, brief or fix-prompt path reads review notes (§5.39).

### Planned files to create

- `src/domain/review/reviewNotes.ts`
- `tests/unit/reviewNotes.test.ts`

### Planned files to edit

- `src/app/reviewHandoff.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `tests/unit/reviewHandoffContent.test.ts`
- `tests/integration/reviewHandoff.test.ts`
- `tests/unit/publish/body.test.ts`

### Optional files that may be edited

- `src/domain/gate/reportPath.ts`
- `tests/unit/reportPath.test.ts`
- `src/domain/publish/body.ts`
- `tests/integration/reviewHandoffCommand.test.ts`
- `tests/integration/publishRun.test.ts`

### Boundary contracts

Producer: the saved gate reports, `checks-attempt-NN.report-SS.json` from phase-02, in each phase folder. Consumer: `loadReviewHandoffInputs.ts`, which turns them into per-phase review notes for the pure `gatherReviewNotes`/`renderReviewNotes`. Its consumer is `buildReviewHandoffContent`, and through the handoff the PR body. Contract: only the last attempt's checked reports count, and an unreadable report is skipped, never an error.

### Test strategy

Write first: `tests/unit/reviewNotes.test.ts`, covering grouping, ordering, dedup by owner and text, and the empty case. Then `reviewHandoffContent.test.ts`: the section sits before `## Phase details`, and is absent without notes. `tests/integration/reviewHandoff.test.ts`, with made-up phase folders, covers two §8 criteria. 'Review notes reach the review, grouped by owner': phase-01 and phase-03 share a hw-maintainers note, and phase-02 has a docs-team note. 'Only the last gate attempt counts': a note in attempt 01 and none in attempt 02. `tests/unit/publish/body.test.ts`: a handoff with the section and an oversized Phase details keeps the section after the cut at 60000 bytes.

### Implementation order

1. `reviewNotes.ts` with its unit tests
2. Loading the last attempt's reports in `loadReviewHandoffInputs.ts`
3. Rendering in `reviewHandoff.ts`, with the content and integration tests
4. The PR body truncation test, then the standard gate

### Excluded scope

- A `decision` class, or any note that stops a phase.
- Showing review notes anywhere but the review handoff and the PR body.
- README prose (phase-07).

### Verification

The `standard` gate profile in `phax.json`.

### Expected handoff content

Record the following in the handoff:
- The signatures of `gatherReviewNotes` and `renderReviewNotes`.
- The new `ReviewHandoffExtras` field.
- The rendered section for the §8 example.
- Confirmation that `body.ts` needed no change, or what changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(review): gather gate review notes into the review handoff`

### Commit body

The review handoff, and with it the PR body, now carries a Review notes section before Phase details. It gathers every review note that the report steps left in each phase's last gate attempt, read from the saved gate reports. Notes are grouped by owner, and a note that several phases reported with the same owner and text is listed once, naming those phases. The section appears only when there is a note, and sits early enough that a truncated PR body keeps it. Review notes never reach a prompt or a brief.

---

## phase-07 — Docs, vocabulary and the steme step {#phase-07-docs}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Gate-step and brief-provider authors, and the operator, learn the reports from the README, `phax --usage`, the skills and the announcement post, in a provider-neutral vocabulary that a test holds. NEXT_STEPS ticks step 2 of the steme item. No live file outside the archive and the retired copies names `gate-diagnostics` or `brief-answer`.

### Detailed instructions

- README §Extend phax (§5.47):
      - Update the intro paragraph for report steps and brief reports.
      - `### Gate report steps`: add the spec §6 refused example and what a refusal does: exit 4, no fix attempt, the gate-failure pause, and `phax resume` rerunning the gate with a full budget. Add review notes: they never fail a step and reach only the reviewer, in `## Review notes`. Add the `still failing` mark, by id. Add that nothing in a report grants a command, so the operator grants any tool a guide calls for through `security.agentCommands`.
      - `### Gate request`: a report step reads the request when it declares `input`, and does not have to declare it.
      - `### Brief provider`: check that it covers the brief report, `brief.push` and both values.
      - §Persisted formats: the rows as spec §6 gives them.
    Neither `gate-diagnostics` nor `brief-answer` appears anywhere in the README. Every `$schema` literal names its format's current stamp, which `exampleStamps.test.ts` holds.
- Vocabulary (§5.45): write the three README sections without guarantee, leg, obligation, prohibition, place, instance, blueprint, skill, judgement, debt or baseline, or their plurals, in any sense: no 'in place of', no 'for instance', no 'skill' for a guide. New `tests/unit/reportVocabulary.test.ts` searches exactly the surfaces §5.45 names, case-insensitively, as whole words with plurals:
      - the `gate-report` and `brief-report` JSON Schemas, built in memory by `packages/schemas/build/jsonSchemas.ts`;
      - the fix prompt, the pushed brief in both modes and the `phax brief` whole form, rendered from the spec §6 examples, which the test holds as made-up fixtures;
      - the README's Gate report steps, Gate request and Brief provider sections.
    It also asserts that the README has `### Gate report steps` and no `gate-diagnostics` or `brief-answer` anywhere (§5.47). The rest of the README is not searched. Fix any surface the test catches.
- `src/cli/cliDocs.ts`: update the `phax --usage` contract text for gate steps (`output: "gate-report"`) and for `phax brief`, which prints the rules over the paths and the findings with their due, with exit codes unchanged. Then run `pnpm gen:usage-spec` and `pnpm docs:cli` to regenerate `phax.usage.kdl` and `docs/cli/reference.md`; never hand-edit them. If the phax.json descriptions of `output` or `brief` still need a word, edit `src/schemas/phaxConfig.ts` and run `pnpm dev schema upgrade`.
- Skills. In `.claude/skills/phax-cli/SKILL.md`, section 'Gate steps, briefs and records': `"output": "gate-report"` and what a report carries (findings, review notes, or a refusal), `brief.push` and its two values, and the brief report. In `.claude/skills/phax-planning/SKILL.md`, section 'Planned files and end-of-phase reconciliation': `A diagnostics step` and `a diagnostics gate` become a report step and a report-step gate. Edit only those passages. The run is started with `--allow-skill-edits`, and both files are declared in this phase.
- `docs/blog/announcing-phax-1.0.md`: the gate profile example's `"output": "diagnostics"` becomes `"output": "gate-report"`. The paragraph after it describes the gate report: findings with a rule, location, message and a guide file to read; review notes to the reviewer; a refusal to the operator. It drops the invariant and completion classes. Edit no other blog post.
- `NEXT_STEPS.md`: mark step 2 (`guarantee-reports`) of the steme item as shipped, matching how step 1 is marked. Reword any mention of `gate-diagnostics` or `brief-answer` there so the sweep below is clean. Leave the entry on the served schemas' `$schema` description untouched.
- Final sweep: `git grep -n -i -E 'gate-diagnostics|brief-answer|parseGateDiagnostics|parseBriefAnswer|"output": "diagnostics"' -- . ':!docs/specs' ':!docs/plans' ':!docs/briefs' ':!site/retired-schemas'` prints nothing and exits 1. Paste the command and its output into the handoff.

### Planned files to create

- `tests/unit/reportVocabulary.test.ts`

### Planned files to edit

- `README.md`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `.claude/skills/phax-cli/SKILL.md`
- `.claude/skills/phax-planning/SKILL.md`
- `NEXT_STEPS.md`
- `docs/blog/announcing-phax-1.0.md`

### Optional files that may be edited

- `src/schemas/phaxConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `src/domain/gate/fixPrompt.ts`
- `src/domain/brief/render.ts`
- `tests/unit/generateUsageSpec.test.ts`
- `tests/integration/usageSpecExamples.test.ts`
- `tests/unit/exampleStamps.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `docs/security.md`

### Test strategy

`tests/unit/reportVocabulary.test.ts` is the oracle for §5.45, and for the README side of §5.47. Write it first against the current text, then fix whatever it catches. It renders the fix prompt, the pushed brief and the `phax brief` output through the real domain functions, from fixtures copied from the spec's §6 made-up examples. It builds the JSON Schemas through the package's build module. It never searches outside the named surfaces. The usage-spec drift and example tests hold `phax.usage.kdl` and `docs/cli/reference.md` to `cliDocs.ts`. `exampleStamps.test.ts` holds the README literals. `readmePersistedFormats.test.ts` holds the rows.

### Implementation order

1. The vocabulary test, run against the current text
2. README Extend phax sections and rows, until the test passes
3. `cliDocs.ts`, then `pnpm gen:usage-spec` and `pnpm docs:cli`
4. The two skill passages
5. The blog paragraph and NEXT_STEPS
6. The final sweep, then the standard gate (this terminal phase also runs build, site:build and the Deno smokes)

### Excluded scope

- Any behavior change.
- Rewording the served schemas' `$schema` description (the NEXT_STEPS entry).
- Other blog posts, and archived specs, plans or briefs.
- Skill passages other than the two named.

### Verification

The `standard` gate profile in `phax.json`. This is the terminal phase, so it also runs `pnpm build`, `pnpm site:build` (which serves the retired copies) and the Deno smokes. The final `git grep` sweep must print nothing and exit 1.

### Expected handoff content

Record the following in the handoff:
- The surfaces the vocabulary test searches, and any wording it forced to change.
- The regenerated `phax.usage.kdl` and `docs/cli/reference.md`, confirmed as generated rather than hand-edited.
- The exact skill passages edited.
- The blog paragraph as rewritten.
- The sweep command and its empty output.
- What the operator must do next: add `brief.push` to any personal config that declares `brief`, and nothing else until the 0.21.0 release.
- Any deviation from the planned file lists, with the reason.

### Commit subject

`docs: describe gate and brief reports`

### Commit body

The README's Extend phax section now covers the whole report contract. Gate report steps describes the checked and refused gate reports, the verdict rules, the refusal and its pause, review notes, the still-failing mark, and that nothing in a report grants a command. Gate request says a report step need not declare input. Brief provider describes the brief report and both brief.push values. The phax --usage contract, the CLI reference, the phax-cli and phax-planning skills and the 1.0 announcement follow. NEXT_STEPS ticks step 2 of the steme item.

A new test holds the provider-neutral vocabulary on exactly the surfaces the spec names: the two JSON Schemas, the fix prompt, the pushed brief and phax brief output rendered from the spec's examples, and the README's three sections. No live file outside the archive and the retired schema copies names gate-diagnostics or brief-answer.
