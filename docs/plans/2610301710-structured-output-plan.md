---
status: Approved
source-spec: docs/specs/2610271515-structured-output.md
completes-spec: true
approved:
  date: 2026-10-30
  baseline: 7ac6d6b
---
# Structured compliance review

Second and last plan of the spec structured-output; its run completes the spec. It covers §5.13 to §5.19, the criteria ac-vibe, ac-cr-readonly, ac-cr-render, ac-cr-phases, ac-cr-refused and ac-cr-file, ac-every-call for the compliance review, the surfaces `phax review-compliance`, compliance-review.json and compliance-review.md, and the compliance review's row on the docs page 'Structured answers and providers'.

Plan 1 (#175, merged 2026-10-30) shipped the machinery this plan builds on, and no phase redoes it:
- ANSWER_FORMATS and `answerJsonSchema` (src/schemas/answerSchemas.ts), the strict check and tests/unit/schemas/strictAnswers.test.ts, `answerSchemaUrlField` (src/schemas/answerStamp.ts) and the strict NonEmptyString (src/schemas/strictString.ts);
- STRUCTURED_CALLS with the Claude Code strip and re-stamp (src/domain/session/structuredCalls.ts), `answerJson` (src/domain/session/structuredAnswer.ts), the Codex schema file;
- the headless code review's corrective resume (src/app/reviewCode.ts, src/domain/review/codeReviewRetry.ts), which this plan mirrors for the compliance review.

After this plan, the compliance review is the eighth structured call. It is a read-only session on every provider, granted CODE_REVIEW_AGENT_COMMANDS. It answers a strict compliance-review answer, stamped 0.32.0 and carrying two required ledgers (`unplannedChanges`, `unmetPromises`). phax's decoder is the answer schema plus a phase-coverage coherence check, with one corrective resume. phax writes compliance-review.json (the answer as given) and renders compliance-review.md from the answer alone. A twice-refused answer is a failure that writes no file and no records entry. `Verdict: unknown` and `structuredVerdictMissing` are gone.

Order:
1. The two pure contracts, the Markdown renderer and the phase-coverage check, as an oracle pair: phase-01 freezes them, phase-02 implements them.
2. The compliance-review 0.32.0 format and its readers (phase-03). The session still writes its JSON file in this commit, now in the new shape.
3. The switch to a structured call (phase-04).
4. The cost backfill, help text and upgrade notes (phase-05).

Every commit is green under the `standard` gate profile.

Execution-model caveats:
- The real-CLI smoke tests (tests/e2e/claudeJsonSchema.test.ts, tests/e2e/codexOutputSchema.test.ts) gain the compliance-review answer in phase-04. They are gated on PHAX_E2E_RUN=1, and neither the gate nor a phase agent runs them. The PR review runs them by name against Claude Code 2.1.314 and codex-cli 0.165.0.
- If the Claude Code combination fails for the compliance review (its `--resume`, its read-only tools with Bash(git …), or stream-json), the remedy is to flip its STRUCTURED_CALLS line to "prompt" together with its docs row. If a provider refuses a construct, that rule becomes a coherence check for both providers (spec §10).
- The run is driven by the installed phax 0.31.0. It does not migrate this repository's live spec and plan sidecars, and no phase relies on scripts/rerender-*.ts.

No phase edits a skill, so the run needs no --allow-skill-edits. No interactive phase is declared: phase-03 applies the format-bump pattern plan 1 already set (a frozen history module, a `next` snapshot, a `$schema` const), and phase-04 repeats plan 1's corrective-resume pattern. The operator can still hold any phase with `phax run --hold`.

## Required commands

- `pnpm exec tsx`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`

All three are already in `security.agentCommands` of phax.json. `pnpm exec tsx` runs scripts/schemas-check.ts and scripts/schemas-check.ts --write. `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate phax.usage.kdl, docs/cli/reference.md and the README's generated block. The plan needs no phax.json change.

## Technical arbitrations

- The compliance answer and compliance-review.json are one shape, like code-review: `{ $schema, verdict, summary, perPhase, unplannedChanges, unmetPromises, attentionPoints, pointers }`.
  - `$schema` is `answerSchemaUrlField("compliance-review")`, the 0.32.0 const.
  - verdict, summary, perPhase (phaseId, verdict, findings of dimension, severity and message), attentionPoints and pointers keep today's rules. perPhase's phaseId moves from Effect's NonEmptyString to the strict one, which accepts the same strings.
  - `unplannedChanges` is an array of `{ phaseId, path, note }` and `unmetPromises` an array of `{ phaseId, promise, note }`, each field a strict NonEmptyString and each array possibly empty.

  phax writes the decoded answer as given, `$schema` first, through `complianceReviewFileText`. Loss accepted: the file carries no provenance phax could add (provider, model, session id, reviewed-at). That stays in the session streams and the cost ledger. Rejected, the answer plus phax-added fields: that abandons one shape for answer and file, and needs a second published schema for the file.
- Older compliance reviews read through the frozen history and are never lifted with empty ledgers.
  - Today's ComplianceReviewFileSchema moves verbatim to src/schemas/history/compliance-review/0.17.0.ts. The pre-schema module stays.
  - `readComplianceReviewFile` returns `ComplianceReviewRead`: `{ shape: "current", review: ComplianceReview }`, or `{ shape: "0.17.0" | "pre-schema", review: AnyShapeComplianceReview }`. AnyShapeComplianceReview is ComplianceReview without the two ledgers.
  - Today's readers (the PR body through publishRun's loadCompliance, and the headless code review's worklist) read only the fields both shapes carry, typed as AnyShapeComplianceReview, whatever the shape. The records entry copies the file's bytes, and the review handoff embeds compliance-review.md unchanged.
  - In the schemas package, LatestComplianceReview types each ledger as its array or the package's `Unknown` sentinel, as toLatestPhaxPlan does for testLines, and toLatestComplianceReview gives an older review `Unknown` ledgers.
  - No current reader needs the ledgers. A later one that does treats `Unknown` as 'not recorded' and says so.

  Loss accepted: every compliance reader handles a shape-tagged union. Rejected, lifting an older review with empty ledgers: that invents the fact that an older run had no unplanned change and no unmet promise, which §10 forbids.
- The Markdown renderer is pure, in src/domain/review/complianceMarkdown.ts: `renderComplianceReviewMarkdown(runId, review)`. Its input is a structural interface that phax's in-memory ComplianceReview satisfies. Exact layout, lines joined by a newline, the file ending in exactly one newline:
  - `# Compliance review — <runId>`, a blank line, `Verdict: <verdict>`, a blank line, then the summary verbatim, or `None.` when it is empty or whitespace only.
  - One section per perPhase entry, in the answer's order: a blank line, `## <phaseId> — <verdict>`, a blank line, then one `- <dimension> · <severity> — <message>` line per finding, or `None.`.
  - A blank line, `## Unplanned changes`, a blank line, then one `- <phaseId> · <path> — <note>` line each, or `None.`.
  - A blank line, `## Unmet promises`, a blank line, then one `- <phaseId> · <promise> — <note>` line each, or `None.`.
  - A blank line, `## Attention points`, a blank line, then one `- <point>` line each, or `None.`.
  - A blank line, `## Pointers`, a blank line, then one `- <pointer>` line each, or `None.`.

  Text is inserted verbatim and never rewritten. Loss accepted: the reviewer's own layout and any narrative beyond the summary, finding messages and ledger notes are gone (spec q-compliance-prose, fields-only). A message holding a newline is kept as is, inside its list item. Rejected, rendering in the app layer: that abandons a pure, oracle-tested contract.
- The phase-coverage coherence check is pure, in src/domain/review/compliancePhaseCoverage.ts: `phaseCoverageRefusal(answeredPhaseIds, runPhaseIds)`, which returns the refusal text or null. It reports:
  - walking the answered ids in order, an id not in the run as `perPhase: phase "<id>" is not a phase of this run`, and a run phase met a second time as `perPhase: phase "<id>" is named more than once` (once per id);
  - then, in run order, each run phase never answered as `perPhase: phase "<id>" is missing`.

  The parts are joined by '; '. The order of perPhase is free. The use case composes phax's decoder: `answerJson`, then `readComplianceReviewAnswer` (the schema, every root issue), then phaseCoverageRefusal. This keeps the schemas package's closure free of domain modules. Loss accepted: phax's decoder for this call is a composition in the use case, not one function in src/schemas. Ledger phase ids are not checked against the run: the spec asks only for perPhase.
- A failed compliance review writes nothing.
  - An accepted answer replaces compliance-review.json and compliance-review.md together: phax keeps both files' previous bytes, writes the JSON, then the Markdown. If the second write fails, it puts the JSON back (or removes it when there was none) and reports the failure.
  - A refused-twice answer, a session failure, or a failed write leaves an earlier review's two files byte-identical and records no entry: the records entry is written only after an accepted answer, as today.
  - The retry command names the run as the operator typed it: `phax review-compliance <ref>`, where ref is the run key when the run belongs to another project. That holds on the failure line and on the records warnings alike, which fixes today's mismatch.
  - At run end, a failed review prints `[phax] Warning: compliance review failed: <reason> — rerun it with \`phax review-compliance <shortName>\``, as the code review does, and the run stays in review_open.

  Loss accepted: after a failed re-review, the run folder (and the PR body that reads it) still shows the earlier accepted review. Rejected, deleting the earlier files on failure: that abandons an accepted review over a provider hiccup.
- The session's confinement is the spec's decision (§5.14), not this plan's. The compliance session becomes read-only on every provider, granted CODE_REVIEW_AGENT_COMMANDS (`git log`, `git diff`, `git show`, `git status`, `git ls-files`, `git blame`) and no other shell. It gets no worktree snapshot guard (§10). The session loses its write access to the worktree, including `.phax-context/`, which it used to write the two files. The prompt gives it the run's base commit and branch, so it can read the diff with those git commands.
- The corrective resume writes its own transcript, `compliance-review-retry.session.jsonl`, beside `compliance-review.session.jsonl`, as the code review does. Its Mistral Vibe export directory derives from that stream path, so the first turn's export survives. Cost backfill reads it after the first stream, with role compliance. Loss accepted: the run folder gains one more stream name that record readers may meet.
- Oracle pair: only the renderer and the coverage check. Both are pure functions with a layout and a refusal text fixed by this plan, so they are stable contracts before their code exists. phase-01 freezes them and phase-02 discharges them. The compliance-review schema is not an oracle: its acceptance is plan 1's strict test, the differential rules-kept table and the schema's own tests. Freezing the use case's internals would pin design, not behavior.
- Intermediate commit: in phase-03, the session still writes its JSON file into `.phax-context/`, now in the 0.32.0 answer shape, and phax still copies the agent's Markdown. phase-04 switches to the structured answer and the rendered Markdown. Loss accepted: phase-03's prompt sketch and file-decoding glue are replaced one commit later. Rejected, one phase for the format and the call: that phase would cross the schemas package, the persisted readers, the use case, the CLI, run end and the docs at once.

---

## phase-01 — Oracles for the compliance Markdown and the phase coverage {#phase-01-compliance-oracles}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Oracle phase:** discharged by phase-02
**Oracle files:** `tests/unit/review/complianceMarkdown.test.ts`, `tests/unit/review/compliancePhaseCoverage.test.ts`

Freeze the two pure contracts of the structured compliance review before their code exists. One is the Markdown rendered from a compliance answer. The other is the coherence check that perPhase names each of the run's phases exactly once. Both are written as expected-failure tests against stubs that throw.

### Detailed instructions

- Create `src/domain/review/complianceMarkdown.ts` as a stub with its final exported surface:
  - `interface ComplianceReviewToRender` with readonly fields: `verdict: string`; `summary: string`; `perPhase: readonly { phaseId: string; verdict: string; findings: readonly { dimension: string; severity: string; message: string }[] }[]`; `unplannedChanges: readonly { phaseId: string; path: string; note: string }[]`; `unmetPromises: readonly { phaseId: string; promise: string; note: string }[]`; `attentionPoints: readonly string[]`; `pointers: readonly string[]`. phax's in-memory ComplianceReview (phase-03) must be assignable to it, so keep the fields readonly and as wide as `string`.
  - `function renderComplianceReviewMarkdown(runId: string, review: ComplianceReviewToRender): string`, which throws `new Error("complianceMarkdown: not implemented")`. Prefix unused parameters with `_`.
- Write the layout contract in the stub's header comment, exactly as the plan preamble's Technical arbitrations state it:
  - the title line, the verdict line and the summary (`None.` when empty or whitespace only);
  - one `## <phaseId> — <verdict>` section per perPhase entry, in answer order, with `- <dimension> · <severity> — <message>` lines;
  - the `## Unplanned changes` lines `- <phaseId> · <path> — <note>`;
  - the `## Unmet promises` lines `- <phaseId> · <promise> — <note>`;
  - `## Attention points` and `## Pointers` with `- <text>` lines;
  - `None.` for every empty list, a blank line between blocks, and exactly one trailing newline.

  Text is inserted verbatim. The function is pure: no I/O, no clock, and no import beyond types.
- Create `src/domain/review/compliancePhaseCoverage.ts` as a stub: `function phaseCoverageRefusal(answeredPhaseIds: readonly string[], runPhaseIds: readonly string[]): string | null`, which throws `new Error("compliancePhaseCoverage: not implemented")`. Its header comment states the contract from the Technical arbitrations:
  - walking the answered ids in order, an unknown id is `perPhase: phase "<id>" is not a phase of this run`, and a run phase met again is `perPhase: phase "<id>" is named more than once` (reported once per id);
  - then, in run order, each run phase never answered is `perPhase: phase "<id>" is missing`;
  - the parts are joined by '; ', null when there is none, and the order of the answered ids is free.
- Create `tests/unit/review/complianceMarkdown.test.ts`. Every test carries Vitest's expected-failure marker (`it.fails`, `it.fails.each`), so `pnpm test` stays green against the stub. Every fixture and expected string is written inside this file.
  - Oracle 1, the golden: runId `notebook.audio-export`, verdict `conformant-with-deviations`, the summary `All four phases delivered; phase-02 skipped one promised test.`, and perPhase phase-01 `conformant` with no findings then phase-02 `conformant-with-deviations` with one finding (`tests`, `deviation`, `The promised integration test for export retries is missing.`).
  - In the same fixture, one unplanned change (`phase-02`, `src/export/backoff.ts`, `Shared helper, justified in the handoff.`), one unmet promise (`phase-02`, `integration test: export retries on 503`, `Not found in tests/integration.`), one attention point (`Confirm the retry backoff with the audio team.`) and no pointers.
  - Expect the exact string of the layout contract: the spec's compliance-review.md surface with phase-01's `None.` section added.
  - Oracle 2: rendering the same review twice gives identical strings.
  - Oracle 3, a table: a review whose four lists are all empty, and whose summary is empty, renders `None.` under each heading and as the summary, and still has one section per phase.
  - Oracle 4: a review with two findings in one phase and two entries in each ledger renders them in the answer's order.
- Create `tests/unit/review/compliancePhaseCoverage.test.ts`, every test marked `it.fails` or `it.fails.each`, as a table of (answered, run) → expected:
  - (phase-01, phase-02, phase-03 / the same) → null;
  - (phase-03, phase-01, phase-02 / phase-01, phase-02, phase-03) → null, since order is free;
  - (phase-01, phase-02, phase-04 / phase-01, phase-02, phase-03) → `perPhase: phase "phase-04" is not a phase of this run; perPhase: phase "phase-03" is missing`;
  - (phase-01, phase-01, phase-02 / phase-01, phase-02) → `perPhase: phase "phase-01" is named more than once`;
  - (phase-01, phase-03 / phase-01, phase-02, phase-03) → `perPhase: phase "phase-02" is missing`;
  - (empty / phase-01) → `perPhase: phase "phase-01" is missing`.
- Do not implement either function, and do not touch any schema, app module or other test.

### Planned files to create

- `src/domain/review/complianceMarkdown.ts`
- `src/domain/review/compliancePhaseCoverage.ts`
- `tests/unit/review/complianceMarkdown.test.ts`
- `tests/unit/review/compliancePhaseCoverage.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: src/domain/review/complianceMarkdown.ts. Consumer: the compliance use case (phase-04). Contract: `renderComplianceReviewMarkdown(runId, review)` is the full compliance-review.md text, a pure function of its inputs. Producer: src/domain/review/compliancePhaseCoverage.ts. Consumer: the compliance use case's decoder (phase-03 and phase-04). Contract: `phaseCoverageRefusal(answered, run)` is null or the refusal text naming each offending phase.

### Test strategy

- an accepted compliance answer renders exactly the spec's compliance-review.md layout, with None. for an empty list and one section per phase — small · example · the golden Markdown string written in the test · oracle · ac-cr-render
- rendering the same answer twice gives byte-identical Markdown — small · metamorphic · equality of two renderings of one answer · oracle · ac-cr-render
- an answer whose summary and lists are all empty renders None. for each and keeps every heading and phase section — small · table · the expected Markdown per row · oracle · ac-cr-render
- a perPhase that names a phase outside the run, repeats one or omits one is refused naming each such phase, and one that covers the run in any order passes — small · table · the expected refusal text or null per row · oracle · ac-cr-phases

### Implementation order

1. complianceMarkdown.ts stub with its layout contract
2. compliancePhaseCoverage.ts stub with its refusal contract
3. complianceMarkdown.test.ts, every test marked .fails
4. compliancePhaseCoverage.test.ts, every test marked .fails

### Excluded scope

- Implementing either function (phase-02).
- The compliance-review schema, its format bump and the use case (phase-03, phase-04).
- Any change under src/app, src/cli or src/schemas.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact exports and signatures of complianceMarkdown.ts and compliancePhaseCoverage.ts. The layout and refusal contracts as written in their header comments. The list of oracle tests in each test file, each confirmed to carry `.fails`. Any deviation from the planned file lists, with the reason.

### Commit subject

`test(review): freeze the compliance Markdown and phase coverage as oracles`

### Commit body

Add stubs for the compliance review's two pure contracts and their oracles. The Markdown is rendered from the answer alone, with a fixed layout and None. for an empty list. The phase-coverage check refuses a perPhase that names a phase outside the run, repeats one or omits one. Every test is an expected failure until phase-02 implements them.

---

## phase-02 — The compliance Markdown renderer and the phase coverage check {#phase-02-compliance-renderer-and-coverage}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Implement the compliance review's Markdown renderer and its phase-coverage check exactly as their contracts state, so the frozen oracles pass.

### Detailed instructions

- Implement `renderComplianceReviewMarkdown` in `src/domain/review/complianceMarkdown.ts` exactly as its header comment states. Build the lines in an array and join them with a newline, ending with exactly one trailing newline. Insert text verbatim, with no trimming, escaping or wrapping, except the empty-summary rule (empty or whitespace only gives `None.`).
- Implement `phaseCoverageRefusal` in `src/domain/review/compliancePhaseCoverage.ts` exactly as its header comment states: unknown and repeated ids in answered order (each repeated id once), then missing ids in run order, joined by '; ', and null when none.
- Remove the `.fails` markers from `tests/unit/review/complianceMarkdown.test.ts` and `tests/unit/review/compliancePhaseCoverage.test.ts`. That is the only change to those two files: no test is added, edited or removed there.
- Drive any edge the oracles leave open test-first in a new `tests/unit/review/complianceMarkdownEdges.test.ts`:
  - a message holding a newline stays verbatim inside its item;
  - a phase id repeated three times is reported once;
  - a whitespace-only summary renders `None.`.
- Keep both modules pure: no fs, no process, no clock, and imports of types only.

### Planned files to create

- `tests/unit/review/complianceMarkdownEdges.test.ts`

### Planned files to edit

- `src/domain/review/complianceMarkdown.ts`
- `src/domain/review/compliancePhaseCoverage.ts`
- `tests/unit/review/complianceMarkdown.test.ts`
- `tests/unit/review/compliancePhaseCoverage.test.ts`

### Optional files that may be edited

- (none)

### Test strategy

- a multi-line finding message stays verbatim inside its list item and a whitespace-only summary renders None. — small · example · the expected Markdown · in-phase · ac-cr-render
- a phase id named three times is reported once as named more than once — small · example · the expected refusal text · in-phase · ac-cr-phases

### Implementation order

1. phaseCoverageRefusal
2. renderComplianceReviewMarkdown
3. remove the .fails markers
4. edge tests

### Excluded scope

- The compliance-review schema and its format bump (phase-03).
- Calling either function from the use case (phase-03, phase-04).
- Any change outside the two modules and their tests.

### Verification

The `standard` gate profile in phax.json. The vitest-oracles provider judges the discharge: no marker left, and the oracle files changed only by their markers.

### Expected handoff content

Confirmation that every oracle in complianceMarkdown.test.ts and compliancePhaseCoverage.test.ts passes without its marker, and that those files changed only by their markers. Any reading of the contracts the oracles left open, and how it was settled. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(review): render the compliance Markdown and check phase coverage`

### Commit body

Implement renderComplianceReviewMarkdown, which renders compliance-review.md from a compliance answer alone in a fixed layout, and phaseCoverageRefusal, which refuses a perPhase that names a phase outside the run, repeats one or omits one. The frozen oracles now pass.

---

## phase-03 — The compliance-review 0.32.0 answer format {#phase-03-compliance-review-format}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Bumps a persisted format across the schemas, the schemas package's history and snapshots, the persisted readers and three of their callers, and introduces a shape-tagged read no compliance reader used before.

compliance-review becomes a strict answer format stamped 0.32.0. It carries a required `$schema` const in place of `version: 1`, and two required ledgers, `unplannedChanges` and `unmetPromises`. The answer and compliance-review.json are one shape. Older reviews (0.17.0 and pre-schema) still read through the frozen history and are never lifted with empty ledgers. Today's readers keep reading the fields both shapes carry.

### Detailed instructions

- Freeze first: copy today's ComplianceReviewFileSchema (before any edit) into `src/schemas/history/compliance-review/0.17.0.ts`. It is a self-contained module with its own release-pattern `$schema` field, its own Effect NonEmptyString and its own verdict, severity, dimension, finding and phase-verdict schemas. Export `ComplianceReviewV0_17_0Schema`, `decodeComplianceReviewV0_17_0` (`onExcessProperty: "error"`) and the type `ComplianceReviewV0_17_0`, with a header comment like src/schemas/history/code-review/0.29.0.ts. Never edit it after this phase.
- src/schemas/complianceReview.ts, as settled in the Technical arbitrations:
  - Drop ComplianceReviewSchema (`version: 1`) and `decodeComplianceReview`.
  - ComplianceReviewFileSchema becomes the answer and the file: `$schema: answerSchemaUrlField("compliance-review")`, then verdict, summary, perPhase, `unplannedChanges: Schema.Array(Struct({ phaseId, path, note }))`, `unmetPromises: Schema.Array(Struct({ phaseId, promise, note }))`, attentionPoints and pointers. The ledger strings and perPhase's phaseId use the strict NonEmptyString from src/schemas/strictString.ts, never Effect's. Add a description to each ledger.
  - `ComplianceReview` (in memory) is the struct without `$schema`, ledgers included. Export `AnyShapeComplianceReview = Omit<ComplianceReview, "unplannedChanges" | "unmetPromises">`.
  - Add `readComplianceReviewAnswer(parsed: unknown): Either<ComplianceReview, string>`, mirroring readCodeReviewAnswer: decode with `{ errors: "all", onExcessProperty: "error" }`, refuse through formatAnswerViolations, return the review without `$schema`.
  - Add `complianceReviewFileText(review)`: `$schema` first at `CURRENT_STAMPS["compliance-review"]`, then the review, indented by 2.
- src/schemas/persisted.ts:
  - `readComplianceReviewFile` returns `ComplianceReviewRead = { shape: "current"; review: ComplianceReview } | { shape: "0.17.0" | "pre-schema"; review: AnyShapeComplianceReview }`.
  - A file stamped below the current stamp is read by the frozen 0.17.0 decoder and returned without `$schema`. A file with no `$schema` is read by the pre-schema decoder.
  - Neither older shape gains a ledger key.
  - Update the module's header comment, which lists the formats that read an older `$schema` shape.
- Readers of the shared fields:
  - src/domain/publish/prBody.ts: ShortPrBodyInput's `compliance.review` becomes AnyShapeComplianceReview.
  - src/app/publishRun.ts: `loadCompliance` passes `read.review` whatever the shape.
  - src/app/reviewCode.ts: `loadCodeReviewWorklist` reads `.review` of the read.

  None of them reads a ledger.
- The schemas package, in packages/schemas/src/formats/runDirectory.ts:
  - complianceReviewFormat lists `releases: [["0.17.0", { schema: ComplianceReviewV0_17_0Schema, decode: decodeComplianceReviewV0_17_0 }]]` beside its pre-schema.
  - ComplianceReviewShapes gains `"0.17.0"`.
  - LatestComplianceReview types each ledger as its array or the package's `Unknown` sentinel (as LatestPhaxPlanPhase does for testLines).
  - `toLatestComplianceReview` keeps a current review's ledgers and gives a 0.17.0 or pre-schema review `Unknown` ledgers, never an empty list.

  Also update packages/schemas/src/index.ts exports, and the closure allowlist `CLOSURE_SRC_ALLOWLIST` in tests/unit/architecturalGuards.test.ts with the new history module (and any other src/ module the closure now reaches).
- Intermediate session contract, replaced in phase-04 (keep this minimal):
  - src/domain/review/compliancePrompt.ts: COMPLIANCE_REVIEW_JSON_SHAPE becomes the 0.32.0 shape. It shows `"$schema": "<the compliance-review stamp URL from CURRENT_STAMPS>"` in place of `"version": 1`, and the two ledgers with their entry keys. The prose asks for the ledgers as JSON fields too.
  - src/app/reviewCompliance.ts: decode the agent's JSON file with `readComplianceReviewAnswer`, then `phaseCoverageRefusal(review.perPhase ids, info.planPhases ids)` from src/domain/review/compliancePhaseCoverage.ts. A refusal keeps today's `verdict: "unknown"` path. Write compliance-review.json with `complianceReviewFileText`, and drop the `version` strip and withSchemaUrl.
  - Copying the agent's Markdown is unchanged.
- Regenerate the derived files: run `pnpm exec tsx scripts/schemas-check.ts --write`, then run it once more, so `next` carries the 0.32.0 const once CURRENT_STAMPS moves. `pnpm exec tsx scripts/schemas-check.ts` must then report the derived files current. This writes packages/schemas/snapshots/compliance-review/next.schema.json and updates src/schemas/release.ts (compliance-review at 0.32.0), packages/schemas/src/generated/index.ts and packages/schemas/history.lock.json. The published packages/schemas/json/compliance-review.schema.json is the strict answer schema. EXCESS for compliance-review already is `error`; keep it.
- Registries and fixtures the schemas tests hold:
  - tests/unit/schemasPackage/documents.ts: the current compliance-review fixture gains one entry in each ledger, so the e2e answer in phase-04 exercises both; add a 0.17.0 release fixture.
  - documents.test.ts, currentShapes.test.ts, parity.test.ts, runDirectoryFormats.test.ts, frozenHistory.test.ts, exports.test.ts and tests/type/schemasPackage.ts.
  - tests/unit/schemasPackage/parseDocument.test.ts: compliance-review is now const-stamped, so the package reads it at its own stamps and refuses one stamped above its current stamp, as plan 1 pinned for the answer formats.
  - tests/integration/persistedProducer.test.ts if its compliance fixture needs the ledgers.
- Tests:
  - tests/unit/schemas/complianceReview.test.ts:
    - a 0.32.0 answer decodes;
    - one without `unmetPromises`, or without `unplannedChanges`, is refused naming the key;
    - `{ version: 1, … }` is refused naming the missing `$schema` and the unexpected `version`;
    - complianceReviewFileText starts with `{` then `"$schema": "https://docs.phax.run/schemas/compliance-review/0.32.0.json"`.
  - tests/unit/persisted.test.ts:
    - a 0.17.0 file reads with shape `0.17.0` and no ledger keys;
    - a pre-schema file reads with shape `pre-schema`;
    - a 0.32.0 file without a ledger is refused.
  - tests/unit/schemas/answerRulesKept.test.ts: add compliance-review rows decoded by the frozen 0.17.0 module and by the new decoder. Each fixture the frozen module refuses is still refused naming the same field. Each it accepts is accepted once restamped with the const, given both ledgers, and stripped of nothing else.
  - tests/unit/publish/prBody.test.ts and tests/integration/publishRun.test.ts: a run folder holding a 0.17.0 compliance-review.json still gives the PR body its verdict and attention points.
  - tests/integration/reviewCompliance.test.ts, reviewComplianceCommand.test.ts and complianceReviewRecord.test.ts: the fake agent writes the 0.32.0 shape.
  - tests/unit/review/compliancePrompt.test.ts: the new sketch.
- Do not add compliance-review to ANSWER_FORMATS or STRUCTURED_CALLS: that is phase-04, together with the call site, the e2e tables and the docs row the tests require.

### Planned files to create

- `src/schemas/history/compliance-review/0.17.0.ts`
- `packages/schemas/snapshots/compliance-review/next.schema.json`

### Planned files to edit

- `src/schemas/complianceReview.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/domain/publish/prBody.ts`
- `src/app/publishRun.ts`
- `src/app/reviewCode.ts`
- `src/app/reviewCompliance.ts`
- `src/domain/review/compliancePrompt.ts`
- `packages/schemas/src/formats/runDirectory.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/json/compliance-review.schema.json`
- `tests/unit/schemas/complianceReview.test.ts`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemas/answerRulesKept.test.ts`
- `tests/unit/publish/prBody.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`
- `tests/unit/review/compliancePrompt.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/runDirectoryFormats.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `src/schemas/formatError.ts`
- `src/schemas/schemaUrl.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/preSchemaModules.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/reviewCodeHeadless.test.ts`
- `tests/integration/writeReviewRecord.test.ts`
- `README.md`

### Boundary contracts

Producer: src/schemas/complianceReview.ts. Consumers: the compliance use case (this phase and phase-04) and phase-04's ANSWER_FORMATS. Contract: ComplianceReviewFileSchema is the strict 0.32.0 answer and file; `readComplianceReviewAnswer(parsed)` returns the review or the refusal text; `complianceReviewFileText(review)` is the file's text. Producer: src/schemas/persisted.ts. Consumers: publishRun's loadCompliance and the code review's worklist. Contract: `readComplianceReviewFile` returns `{ shape, review }`, with an older shape's review carrying no ledger.

### Test strategy

- a 0.32.0 compliance answer or file without unmetPromises or unplannedChanges is refused naming the key, and the written file starts with the 0.32.0 $schema — small · example · the refusal text and the file text's first key · in-phase · ac-cr-file
- a compliance answer carrying version and no $schema is refused naming both — small · example · the refusal text · in-phase · ac-unstamped-answer
- every fixture the frozen 0.17.0 compliance decoder refuses the new decoder refuses naming the same field, and every one it accepts is accepted once restamped with both ledgers — small · table · the frozen 0.17.0 decoder on the same fixtures · in-phase · ac-accepts
- a 0.17.0 or pre-schema compliance-review.json reads through the history with its own shape and gains no ledger — small · table · the read's shape tag and the absence of ledger keys · in-phase · ac-cr-file
- the PR body still shows the verdict and attention points of a run folder holding a 0.17.0 compliance review — medium · example · the rendered PR body lines · in-phase
- the schemas package reads a compliance review at 0.17.0, pre-schema and its own 0.32.0 stamp, gives older ones Unknown ledgers, and refuses one stamped above its current stamp — small · table · parseComplianceReview and toLatestComplianceReview per fixture · in-phase

### Implementation order

1. frozen 0.17.0 module copied from today's shape
2. complianceReview.ts answer and file schema, reader and file text
3. persisted reader with shapes, and the shared-field readers
4. schemas package format, release and Unknown ledgers
5. intermediate prompt sketch and reviewCompliance decoding
6. schemas-check --write twice, then the check
7. registries, fixtures and tests

### Excluded scope

- ANSWER_FORMATS, STRUCTURED_CALLS, the read-only session, the corrective resume and the rendered Markdown (phase-04).
- Cost backfill, help text and upgrade notes (phase-05).
- Checking ledger phase ids against the run.
- Migrating this repository's live sidecars.

### Verification

The `standard` gate profile in phax.json; `pnpm exec tsx scripts/schemas-check.ts` also reports the derived files current.

### Expected handoff content

The new exports of src/schemas/complianceReview.ts (ComplianceReviewFileSchema, ComplianceReview, AnyShapeComplianceReview, readComplianceReviewAnswer, complianceReviewFileText) with signatures, and the refusal format. The ComplianceReviewRead type and its callers. The frozen 0.17.0 module and its package release entry. The stamp CURRENT_STAMPS now gives compliance-review. LatestComplianceReview's ledger types. The intermediate session contract left in reviewCompliance.ts and compliancePrompt.ts, which phase-04 replaces. Every registry touched and the closure allowlist as it now stands. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): compliance-review 0.32.0, a strict answer with two ledgers`

### Commit body

The compliance review's answer and compliance-review.json become one strict shape stamped 0.32.0: a $schema const in place of version, and two required ledgers, unplannedChanges and unmetPromises. The 0.17.0 shape is frozen in the history. An older review reads with its own shape and no ledger, never lifted with empty ones, and the PR body and the code review's worklist read only the fields both shapes carry. The session still writes its JSON file, now in the new shape, and a perPhase that does not cover the run is refused.

---

## phase-04 — The compliance review as a structured call {#phase-04-compliance-structured-call}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Turns a file-writing session into a structured call across the app, CLI and run-end layers, with a new result union, a paired-write rollback and a per-provider read-only confinement, a change that crosses several parts of the architecture.

The compliance review becomes the eighth structured call. It is a read-only session on every provider, granted the code review's read-only git commands. It answers the compliance-review answer, handed natively to Claude Code and Codex and stated in the prompt everywhere. phax's decoder and one corrective resume judge it, and phax writes compliance-review.json and the rendered compliance-review.md from an accepted answer. A twice-refused answer fails with no file and no records entry, and `Verdict: unknown` is gone.

### Detailed instructions

- Register the call:
  - src/schemas/answerSchemas.ts: add `"compliance-review": { label: "compliance review", schema: ComplianceReviewFileSchema }` to ANSWER_FORMATS (its label equals FORMAT_DEFINITIONS'). Update its header comment.
  - src/domain/session/structuredCalls.ts: add `"compliance-review"` to StructuredCallId and `"compliance-review": { claudeCode: "native" }` to STRUCTURED_CALLS, and say 'eight calls' in the comments.
  - src/ports/backend.ts: drop 'the compliance review' from the doc comment's list of sessions that never set `answerSchema`.
- Create `src/domain/review/complianceRetry.ts` (pure), mirroring src/domain/review/codeReviewRetry.ts:
  - `COMPLIANCE_REVIEW_STREAM_FILENAME = "compliance-review.session.jsonl"`;
  - `COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME = "compliance-review-retry.session.jsonl"`;
  - `complianceRetryPrompt(refusal)`: names the refusal and asks for the whole review again as one JSON object valid against the answer schema already given, with no fence or commentary, as the only retry;
  - `complianceRetryWarning(refusal)`, which returns `compliance-review answer refused — <refusal>\n  resuming the session once to ask for the whole answer again`;
  - `complianceRefusedTwiceMessage(first, retry)`, which returns `compliance-review answer rejected twice — first answer: <first>; retry: <retry>`.
- Rewrite src/domain/review/compliancePrompt.ts:
  - BuildCompliancePromptInput drops `mdArtifactPath` and `jsonArtifactPath` and gains `baseRef: string | null`, `runBranch: string` and `gitCommands: readonly string[]`.
  - Ground rules: read-only, write no file; read the run's change with the granted git commands only (list them, and give `git diff <baseRef>..HEAD` and `git log <baseRef>..HEAD` when a base is known).
  - Keep the per-phase review instructions and the roll-up.
  - Replace 'Required output' with: reply with one JSON object, alone, valid against this answer schema, then `JSON.stringify(answerJsonSchema("compliance-review"), null, 2)`.
  - State the coherence rule in words: perPhase names each of these phase ids exactly once, in any order (list the run's ids).
  - Say what each ledger holds: `unplannedChanges` are files touched beyond the plan (from the reconciliation), each with its phase and a note; `unmetPromises` are promised tests or artifacts not found, each with its phase and a note. Either may be `[]`.
  - Keep COMPLIANCE_REVIEW_MD_FILENAME and COMPLIANCE_REVIEW_JSON_FILENAME as the run-folder file names.
- Rewrite `reviewCompliance` in src/app/reviewCompliance.ts.
  - Read the reconciliation, plan.md, handoffs and reviewed phases as today.
  - Create nothing under the worktree's `.phax-context/`, and remove the stale-file cleanup.
  - Build the prompt with `baseRef` from the first phase's `base` (info.phaseStatuses sorted by phaseIndex), `runBranch: info.branch` and `gitCommands: CODE_REVIEW_AGENT_COMMANDS`.
  - Session options:
    - provider, model and effort as today, `cwd: info.worktreePath`;
    - `security: { ...policy, agentCommands: [...CODE_REVIEW_AGENT_COMMANDS] }`, `agentCommands: CODE_REVIEW_AGENT_COMMANDS` and `readOnly: true`;
    - `answerSchema: { call: "compliance-review", schema: answerJsonSchema("compliance-review") }`, written as that literal, so the census test finds the site.
  - No worktree snapshot guard (spec §10).
  - First session: `backend.runAgent` into `<runPath>/compliance-review.session.jsonl`, under withInvocationCost role compliance. A session failure returns `failed` with sessionFailure and its files, as today.
  - phax's decoder: `answerJson(result)`, then `readComplianceReviewAnswer`, then `phaseCoverageRefusal(perPhase ids, info.planPhases ids)`.
  - On a refusal: `opts.output.warn(complianceRetryWarning(refusal))`, then resume the first session once with `backend.resumeAgentSession(sessionId, complianceRetryPrompt(refusal), { ...same options, outputJsonlPath: <runPath>/compliance-review-retry.session.jsonl })`, under withInvocationCost role compliance on that stream. A session failure of the resume is reported like the first one's, never as a refusal. A second refusal fails with complianceRefusedTwiceMessage.
  - On acceptance, write the pair as settled in the Technical arbitrations: keep the previous bytes of both files, write compliance-review.json (`complianceReviewFileText`), then compliance-review.md (`renderComplianceReviewMarkdown(info.runId, review)`). If the second write fails, put the first back and fail. Emit artifact telemetry for both.
- Reshape ComplianceReviewResult as a union:
  - `{ kind: "disabled" }`;
  - `{ kind: "generated"; review; mdArtifactPath; jsonArtifactPath }`;
  - `{ kind: "failed"; failureReason; sessionFailure?; sessionFailureFiles? }`.

  Remove `structuredVerdictMissing` and the `"unknown"` verdict everywhere. ReviewComplianceOpts gains `output: OutputPort`. reviewComplianceAndRecord records an entry only for `generated`.
- src/cli/commands/reviewCompliance.ts:
  - pass `out` as `output`;
  - on `generated`, print `Verdict: <verdict>` and `Compliance review: <md path>`, then the records notice and warnings as today;
  - on `failed`, keep the session-failure rendering (exit 14 for network, else 1), and otherwise print `Compliance review failed: <reason>. To retry, run: phax review-compliance <ref>` with exit 1, where ref is the run key when crossProject (the same ref the records warnings use).
- src/app/executePlan.ts, at run end: pass an output that writes `[phax] …` and `[phax] Warning: …` to stderr, as the code review's call does. On a `failed` outcome, print `[phax] Warning: compliance review failed: <reason> — rerun it with \`phax review-compliance <shortName>\``. The run stays in review_open, as today.
- Tests:
  - tests/integration/structuredAnswerFlags.test.ts:
    - add a `compliance-review` driver (providers claude-code and codex-cli, retries true) through the real use case, with a run folder holding plan.md, the global reconciliation and one phase;
    - add `app/reviewCompliance.ts compliance-review` to the census list of call sites;
    - add a Mistral Vibe case for the compliance review: no schema option in argv, and the prompt states the schema.
  - tests/unit/session/structuredCalls.test.ts: the CALLS list.
  - tests/unit/schemas/strictAnswers.test.ts: the registry holds nine ids, and compliance-review passes the strict check and the Effect-NonEmptyString walk.
  - tests/unit/schemas/answerSchemas.test.ts if it lists formats.
  - tests/integration/reviewCompliance.test.ts, with the fake backend:
    - ac-vibe: routed to mistral-vibe, the first answer omits `unmetPromises`; the prompt holds the schema, the refusal is printed and the session resumed once with the first session id, and the retry's answer is written;
    - ac-cr-phases: a run of phase-01 to phase-03 and an answer naming phase-01, phase-02 and phase-04 is refused naming phase-04 and the missing phase-03, then resumed once;
    - ac-cr-readonly: on each of claude-code, codex-cli and mistral-vibe, the runAgent options carry `readOnly: true` and agentCommands equal to CODE_REVIEW_AGENT_COMMANDS, and `security.agentCommands` holds exactly those; nothing exists under the worktree's `.phax-context/` afterwards; both files are written in the run folder from the answer, and the Markdown equals renderComplianceReviewMarkdown of it;
    - ac-cr-refused: refused twice gives `failed` naming both refusals, both files byte-identical to before (and absent when there were none), and no records entry;
    - ac-cr-file: the written json starts with the 0.32.0 `$schema` and carries both ledgers;
    - an empty first answer on Vibe is refused as not JSON and resumed once.
  - tests/integration/reviewComplianceCommand.test.ts and tests/unit/cli/reviewCompliance.test.ts: the printed warning, the failure line and its retry command with exit 1, never `Verdict: unknown`.
  - tests/integration/complianceReviewRecord.test.ts: an entry only after an accepted answer.
  - tests/unit/review/complianceRetry.test.ts: the texts.
  - tests/unit/review/compliancePrompt.test.ts: no file path, the schema and the phase-id list stated.
  - Use the fake backends, tests/helpers/isolateGit.ts and temporary directories; never read `~/.phax`, `~/.claude`, `~/.codex`, `~/.vibe` or the global git config.
- Real-CLI e2e (do not run them):
  - tests/e2e/claudeJsonSchema.test.ts: add `"compliance-review": "compliance-review"` to CALL_OF. Its case runs read-only like the others.
  - tests/e2e/codexOutputSchema.test.ts: add `"compliance-review"` to FORMATS and to CALL_OF.
  - Header comments: the compliance-review cases are run by name in PR review, like the others.
- docs/structured-answers.md:
  - add the `compliance-review` row (`--json-schema`, `--output-schema`, schema in prompt), which tests/unit/structuredAnswersDocs.test.ts holds equal to STRUCTURED_CALLS;
  - replace 'The compliance review joins this table with the next release' with a section 'The compliance review': a read-only session granted the code review's git commands, which answers instead of writing files; phax writes compliance-review.json and renders compliance-review.md from the answer; a failure writes neither;
  - per spec §11, its example is one refused compliance answer: the schema let it through, the coverage check refused it for naming a phase not in the run, and the corrective resume fixed it.

### Planned files to create

- `src/domain/review/complianceRetry.ts`
- `tests/unit/review/complianceRetry.test.ts`

### Planned files to edit

- `src/schemas/answerSchemas.ts`
- `src/domain/session/structuredCalls.ts`
- `src/ports/backend.ts`
- `src/domain/review/compliancePrompt.ts`
- `src/app/reviewCompliance.ts`
- `src/app/executePlan.ts`
- `src/cli/commands/reviewCompliance.ts`
- `tests/integration/structuredAnswerFlags.test.ts`
- `tests/unit/session/structuredCalls.test.ts`
- `tests/unit/schemas/strictAnswers.test.ts`
- `tests/integration/reviewCompliance.test.ts`
- `tests/integration/reviewComplianceCommand.test.ts`
- `tests/unit/cli/reviewCompliance.test.ts`
- `tests/integration/complianceReviewRecord.test.ts`
- `tests/unit/review/compliancePrompt.test.ts`
- `tests/e2e/claudeJsonSchema.test.ts`
- `tests/e2e/codexOutputSchema.test.ts`
- `docs/structured-answers.md`

### Optional files that may be edited

- `tests/unit/schemas/answerSchemas.test.ts`
- `tests/unit/structuredAnswersDocs.test.ts`
- `tests/helpers/fakeProviderCli.ts`
- `tests/helpers/answerSchemaArgv.ts`
- `src/infra/fakes/backend.ts`
- `src/app/reviewEntry.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/telemetry/end-to-end.test.ts`
- `tests/integration/reviewedPhasesSurfaces.test.ts`

### Boundary contracts

Producer: src/app/reviewCompliance.ts. Consumer: the Backend port. Contract: `answerSchema: { call: "compliance-review", schema: answerJsonSchema("compliance-review") }`, `readOnly: true` and `agentCommands: CODE_REVIEW_AGENT_COMMANDS` on the first session and on the corrective resume. Producer: src/app/reviewCompliance.ts. Consumers: the review-compliance command and run end. Contract: ComplianceReviewResult is `disabled`, `generated` (review and both file paths) or `failed` (reason, optional session failure); no unknown verdict. The refusal warning goes through the OutputPort passed in opts.

### Test strategy

- the compliance review on Claude Code and Codex carries its answer schema on the first session and on the corrective resume, every prompt states it, and the census finds its one call site — medium · table · the recorded argv, schema file content and prompts of the fake CLIs · in-phase · ac-every-call
- a compliance review on Mistral Vibe whose first answer omits unmetPromises keeps the schema in the prompt with no schema option, is resumed once, and its retry's answer is written — medium · example · the prompt text, argv, one resume with the first session id and the written files · in-phase · ac-vibe
- the compliance session is spawned read-only with exactly the code review's git commands on every provider, nothing appears under .phax-context, and phax writes both files from the answer — medium · table · the recorded run options per provider, the worktree listing and the written files · in-phase · ac-cr-readonly
- compliance-review.md written from an accepted answer equals the renderer's output for that answer — medium · example · renderComplianceReviewMarkdown of the accepted answer · in-phase · ac-cr-render
- an answer naming phase-04 and omitting phase-03 of a three-phase run is refused naming both, printed, and resumed once — medium · example · the warning text and one resume call · in-phase · ac-cr-phases
- a compliance answer refused twice fails naming both refusals and the retry command with exit 1, writes neither file nor a records entry, and never prints Verdict: unknown — medium · example · exit code, printed lines, unchanged file bytes and the records branch · in-phase · ac-cr-refused
- an accepted compliance answer is written as compliance-review.json starting with the 0.32.0 $schema and carrying both ledgers — medium · example · the written file's text · in-phase · ac-cr-file
- an empty first compliance answer on Mistral Vibe is refused as not JSON and resumed once — medium · example · the refusal text and one resume call · in-phase · ac-vibe-empty
- the compliance-review answer schema passes the strict check and holds no Effect NonEmptyString — small · example · empty strictCheckFindings and the AST walk · in-phase · ac-strict-shape
- Claude Code's --json-schema and Codex's --output-schema accept the compliance-review answer schema on a new session and on a resume, run by name in PR review and not by the gate — large · smoke · the real CLI's answer accepted by phax's decoder · in-phase · ac-every-call

### Implementation order

1. complianceRetry.ts texts
2. ANSWER_FORMATS and STRUCTURED_CALLS entries, port comment
3. compliancePrompt rewrite
4. reviewCompliance rewrite: read-only session, decoder, corrective resume, paired writes
5. result union, CLI and run-end output
6. integration and unit tests, census and drivers
7. e2e tables
8. docs page row and section

### Excluded scope

- Cost backfill of the retry stream, help text, regenerated CLI reference and upgrade notes (phase-05).
- A worktree snapshot guard for the compliance session (spec §10).
- Running the e2e tests or flipping a STRUCTURED_CALLS entry (PR review decides).
- Any change to the headless code review beyond reading the compliance file's shared fields.
- Any .claude/skills edit.

### Verification

The `standard` gate profile in phax.json. The e2e tests skip without PHAX_E2E_RUN=1, and the PR review runs them by name.

### Expected handoff content

The exports of src/domain/review/complianceRetry.ts. The new prompt input fields. The session options the compliance review now passes. The ComplianceReviewResult union and every caller updated. The exact warning, failure and run-end lines. The paired-write behaviour on failure. The census, driver and e2e entries added. The docs page row and section. The commands the PR review runs: `pnpm test:e2e:real tests/e2e/claudeJsonSchema.test.ts` and `pnpm test:e2e:real tests/e2e/codexOutputSchema.test.ts`. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(review): the compliance review answers a structured, read-only session`

### Commit body

The compliance review becomes the eighth structured call. It is a read-only session on every provider, granted the code review's read-only git commands, and returns a compliance-review answer, handed as --json-schema to Claude Code and --output-schema to Codex and stated in every prompt. phax's decoder (the schema plus the phase-coverage check) judges it, with one corrective resume into compliance-review-retry.session.jsonl. phax writes compliance-review.json and renders compliance-review.md from an accepted answer. A twice-refused answer fails naming both refusals and writes no file and no records entry, so Verdict: unknown is gone.

---

## phase-05 — Compliance retry cost, help text and 0.32.0 upgrade notes {#phase-05-compliance-docs-and-cost}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Cost backfill counts the compliance review's corrective resume. The review-compliance help says what the command now does. The 0.32.0 upgrade notes tell records readers about compliance-review.json's new stamp and ledgers, and that `Verdict: unknown` is gone.

### Detailed instructions

- src/domain/cost/ledger.ts: import COMPLIANCE_REVIEW_STREAM_FILENAME and COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME from src/domain/review/complianceRetry.ts, replacing the local COMPLIANCE_STREAM constant. List the retry stream right after `compliance-review.session.jsonl`, with role compliance and phase null, as the code review's retry is listed.
- src/cli/cliDocs.ts:
  - review-compliance longHelp: the agent session is read-only, granted the read-only git commands, and answers a structured verdict; phax writes compliance-review.json and compliance-review.md in the run folder from that answer; a refused answer is asked once more in the same session; a review refused twice, or whose session fails, writes neither file nor a records entry and exits 1 (14 on a network failure), naming the retry command.
  - cost backfill help (the entry that names code-review-retry.session.jsonl): name compliance-review-retry.session.jsonl too.

  Then run `pnpm gen:usage-spec` and `pnpm docs:cli`. The latter also rewrites the README's generated block.
- README.md: outside the generated block, reword the `phax review-compliance <run>` line in the review commands list. An agent checks the work against the plan, phase by phase, and phax writes its verdict.
- docs/upgrading.md, under the existing `### 0.32.0`, for records and schema readers:
  - compliance-review.json is stamped 0.32.0 with `$schema` as a const and two required ledgers, `unplannedChanges` (`phaseId`, `path`, `note`) and `unmetPromises` (`phaseId`, `promise`, `note`). A 0.32.0 file without either is refused.
  - A 0.17.0 or pre-schema review still reads, with no ledgers, never empty ones; @lbdremy/phax-schemas gives them `Unknown` ledgers.
  - compliance-review.md is now rendered by phax from the answer, with fixed sections.
  - `phax review-compliance` no longer prints `Verdict: unknown`: a refused review fails with exit 1 and writes no file and no records entry.
  - The compliance session is read-only and writes nothing under `.phax-context/`.
- Tests: tests/unit/cost/ledger.test.ts (or the backfill test that covers run streams) checks that the retry stream is listed after the first, with role compliance. Update tests/unit/cli/reviewCompliance.test.ts or the help-text tests only if they pin the old help.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/cost/ledger.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `docs/upgrading.md`
- `tests/unit/cost/ledger.test.ts`

### Optional files that may be edited

- `tests/unit/cost/backfill.test.ts`
- `tests/unit/costLedgerCodeReviewRole.test.ts`
- `tests/unit/cli/reviewCompliance.test.ts`
- `tests/integration/costLedger.test.ts`
- `docs/structured-answers.md`

### Test strategy

- cost backfill lists the compliance retry stream right after the first compliance stream with role compliance — small · example · the expected run-stream order and roles · in-phase

### Implementation order

1. ledger run streams
2. help text, then gen:usage-spec and docs:cli
3. README line
4. upgrading notes

### Excluded scope

- Any behaviour change to the compliance review (phase-04).
- Running the e2e tests.
- Migrating this repository's live sidecars.

### Verification

The `standard` gate profile in phax.json, including its terminal steps (build, site:build and the deno smokes).

### Expected handoff content

The ledger's stream order for the compliance review. The new review-compliance and cost backfill help texts, and confirmation that phax.usage.kdl, docs/cli/reference.md and the README block were regenerated. The 0.32.0 upgrading bullets added. A reminder for the reviewer: run the two e2e files by name; flip the compliance-review STRUCTURED_CALLS line and docs row if its Claude Code combination fails; turn a refused construct into a coherence check for both providers. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(review): compliance retry cost, help and 0.32.0 upgrade notes`

### Commit body

Cost backfill reads compliance-review-retry.session.jsonl after the first compliance stream. The review-compliance help describes the read-only, answering session, phax writing both files, the one corrective resume and a failure that writes nothing. The 0.32.0 upgrade notes cover compliance-review.json's new stamp and required ledgers, older reviews read without ledgers, and the end of Verdict: unknown.
