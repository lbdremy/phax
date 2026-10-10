---
status: Approved
source-spec: docs/specs/2610100823-pr-description.md
completes-spec: true
approved:
  date: 2026-10-10
  baseline: a065f2e
---
# Short pull request description

Replace the PR body that `phax publish-pr` (and `publish.auto`) writes. Today it is the whole review handoff behind a `# PHAX Run Review Handoff` header, cut from its end at 60000 bytes, with a note that wrongly says the handoff is on the PR branch. The new body is a short document of its own. It holds a run summary, one line per phase, `## Needs your review` (compliance attention points and unexplained deviations), the `## Review notes` section, and `## Full detail`, which points to the review handoff in the run folder. The body is built in the domain from decoded inputs. The cap cuts unexplained deviations first, then attention points, then review notes. `review-handoff.md` keeps every section it has today. Phase 1 builds the pure body builder and moves the unexplained-deviation test into one domain helper that the handoff and the body both use. Phase 2 has publishing use the new builder, deletes the old builder, and updates README and NEXT_STEPS.

## Required commands

- (none)

The plan uses only the project's existing pnpm scripts through the `standard` gate profile. No new command is needed.

## Technical arbitrations

- The new builder lives in a new module, `src/domain/publish/prBody.ts`. The old `src/domain/publish/body.ts` is deleted in phase-02, when `publishRun` switches over. Accepted loss: one commit where both builders exist and only the old one is live. In return, each phase is green on its own.
- Unexplained deviations come from one domain helper, `findUnexplainedGlobalDeviations` in `src/domain/reconciliation/explained.ts`. The review handoff's `buildUnexplainedSection` and the PR body both use it. Accepted loss: the review handoff's builder code changes, although its output does not. The existing `reviewHandoffContent` tests pin that output byte for byte.
- Per-phase deviation counts: an unplanned entry counts once against each phase in its `touchedInPhases`. A missing entry counts once against each phase in its `plannedInPhases`. Whether an entry is explained is decided per entry, using the combined handoffs of every phase it is attributed to (the spec's test). An unexplained entry therefore counts as unexplained against every phase it is attributed to. Accepted loss: explanation is not tracked per phase. If phase-02 explains a shared deviation and phase-03 does not, it counts as explained for both.
- The plan path comes from `run-status.json` (`planRepoRelPath`). `publishRun` reads it through the FileSystem port. `RunReviewInfo` does not get a new field. Accepted loss: run facts are no longer all on one value. In return, about 17 test fixtures that build `RunReviewInfo` stay as they are.
- The compliance verdict comes from `compliance-review.json`, decoded with `readComplianceReviewFile`. A missing or undecodable file reads as `not reviewed`. Accepted loss: a corrupt review file does not fail publishing. phax stays autonomous, and a review artifact never fails a publish.
- Shortening review notes works on the gathered `ReviewNoteGroup[]`, not on rendered text. The kept notes are rendered again through `renderReviewNotes`, and one count line is appended. Accepted loss: `loadReviewHandoffInputs` must also expose the groups, beside the rendered section it already returns. In return, the PR body's notes can never drift from the handoff's rendering.
- Wording, which §10 leaves open:
  - Summary: `**Run** … · **Plan** … · **Gate profile** …` / `**Spec** …` / `**Phases** N/M passed · **Verified surfaces** …` / `**Compliance** …`, one per line.
  - Phase line: `- `phase-NN` <title> — <verdict> · <n> deviation(s), <u> unexplained`, or `no deviation`, or `skipped`.
  - Cut-count line: `- …and N more <list noun>`.
  - Shortened note: `*This description was shortened to fit GitHub's limit. The review handoff named under Full detail lists every entry.*`
  Accepted loss: none of this matches the review handoff's own phrasing. The spec makes this wording indicative only.

---

## phase-01 — The PR body builder {#phase-01-pr-body-builder}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Provide a pure domain builder that turns a run's decoded review inputs into the short PR body of spec §5.1–§5.14, size cap and cut order included, so publishing can switch to it in the next phase. The unexplained-deviation test is shared with the review handoff, so the two can never disagree.

### Detailed instructions

- Shared deviation helper, in `src/domain/reconciliation/explained.ts`:
  - Add and export `findUnexplainedGlobalDeviations(global: GlobalFileReconciliation, phaseHandoffs: ReadonlyArray<{ phaseId: string; handoffMd: string }>): ReadonlyArray<UnexplainedDeviation>`.
  - `UnexplainedDeviation` is `{ path: string; kind: "unplanned" | "missing"; phaseIds: readonly string[] }`.
  - Walk `global.unplanned` first (`phaseIds` = `touchedInPhases`), then `global.missing` (`phaseIds` = `plannedInPhases`).
  - For each entry, join the handoffs of its phases with `\n` (a missing handoff counts as `""`). Keep the entry when `findUnexplainedDeviations([path], combined)` is non-empty.
  - This is exactly the logic of today's `buildUnexplainedSection` in `src/app/reviewHandoff.ts`; keep its order.
- In `src/app/reviewHandoff.ts`, rewrite `buildUnexplainedSection` to call the new helper. Map the `PhaseContent` list to `{ phaseId, handoffMd: phaseHandoffMd }`, then render `- `<path>`` lines, or `_None._`. The review handoff's output must stay byte-identical: change nothing else in that file.
- Create `src/domain/publish/prBody.ts`.
  - Keep the 60000-byte default cap as an exported constant there, e.g. `PR_BODY_MAX_BYTES = 60000`, with the same GitHub-limit comment as `body.ts`.
  - Export `buildShortPrBody(input: ShortPrBodyInput): { body: string; shortened: boolean }`.
  - `ShortPrBodyInput` uses explicit per-variant enums (no optional booleans):
    - `qualifiedName: string` (e.g. `acme.greet-cli`) and `shortName: string` (e.g. `greet-cli`).
    - `plan: { kind: "path"; path: string } | { kind: "loose" }`.
    - `sourceSpecOutcome: string | undefined`: the one-line fragment of `source-spec-outcome.md`; trim it.
    - `gateProfileId: string | undefined`.
    - `phases: ReadonlyArray<{ phaseId: string; title: string; status: "passed" | "skipped" | "unfinished" }>`, in plan order.
    - `verifiedSurfaces: readonly Surface[]`.
    - `compliance: { kind: "reviewed"; review: ComplianceReview } | { kind: "not-reviewed" }`; the types come from `src/schemas/complianceReview.ts`.
    - `global: GlobalFileReconciliation` and `phaseHandoffs: ReadonlyArray<{ phaseId: string; handoffMd: string }>`. The handoffs are used only to decide whether a deviation is explained.
    - `reviewNoteGroups: ReadonlyArray<ReviewNoteGroup>`, from `src/domain/review/reviewNotes.ts`.
    - `runFolder: { path: string; homeDir: string }`.
    - `records: "configured" | "not-configured"`.
    - `maxBytes?: number`, defaulting to the constant.
- Run summary: no heading. Each line ends with a Markdown hard break (a trailing `\`), except the last, so GitHub shows one line each.
  - `**Run** `<qualifiedName>` · **Plan** `<path>` · **Gate profile** `<id>``: write `loose plan` (no code span) for a loose plan, and `(none)` for an absent gate profile.
  - `**Spec** <sourceSpecOutcome>`: only when the outcome is defined.
  - `**Phases** <passed>/<total> passed · **Verified surfaces** <comma-joined, or none>`: passed counts the `status === "passed"` phases.
  - `**Compliance** <review.verdict>`, or `not reviewed`.
- `## Phases`: one line per phase, in input order.
  - Normal phase: `- `<id>` <title> — <verdict> · <count>`.
  - `<verdict>` is the phase's entry in `review.perPhase` (matched by `phaseId`), or `not reviewed` when there is no review or no entry for the phase.
  - `<count>` is `no deviation` when the phase has 0 deviations. Otherwise it is `<n> deviation(s), <u> unexplained`, with the singular `1 deviation`.
  - A phase's deviations: every `global.unplanned` entry whose `touchedInPhases` includes it, plus every `global.missing` entry whose `plannedInPhases` includes it.
  - A phase's unexplained count: those of its deviations that `findUnexplainedGlobalDeviations` returns.
  - A skipped phase's line is `- `<id>` <title> — skipped`, with no verdict and no counts.
- `## Needs your review`:
  - `### Compliance attention points` comes first, and only when `compliance.kind === "reviewed"`. List each attention point verbatim as a `- ` item, or write `None.` when there are none.
  - `### Unexplained deviations` comes next, always. Each entry is `- `<path>` — unplanned, touched in <phaseIds joined ", ">` or `- `<path>` — missing, planned in <phaseIds>`. Write `None.` when there are none.
  - Never render the compliance summary, the pointers, or any finding message.
- `## Review notes`: only when `reviewNoteGroups` is non-empty. Use `renderReviewNotes(groups)` verbatim, so the heading, the intro line `Notes the gate steps left for a person. None was sent to the agent.` and the `### <owner>` groups all match the review handoff. Do not re-implement the rendering.
- `## Full detail`, two lines:
  - `The full review handoff (file reconciliation, phase handoffs, compliance review) is in the run folder on the machine that ran it: `<tilde path>/review-handoff.md`. `phax review-handoff <shortName>` writes it again.`
  - When `records === "configured"`, add a second line: `A phase commit's prompt, diff, gates and handoff: `phax records explain <commit>`.`
  - The tilde path: replace `homeDir` with `~` when `runFolder.path` equals `homeDir` or starts with `homeDir + "/"`; otherwise keep the path as it is. Use a small pure helper.
  - The body must never say the handoff is on a branch.
- Join sections with blank lines, in the order: summary, `## Phases`, `## Needs your review`, `## Review notes` (when there are notes), `## Full detail`. The body has no `# ` line.
- Size cap: measure with `Buffer.byteLength(body, "utf8")`. When the full body is at most `maxBytes`, return it with `shortened: false`. Otherwise, the three cuttable lists are, in cut order: the unexplained-deviation entries, the attention-point entries, then the review notes (flattened in render order across groups).
  - Find the largest keep-count for deviations (attention points and notes whole) that fits. If even 0 deviations do not fit, keep 0 deviations and find the largest keep-count for attention points. If even 0 attention points do not fit, find the largest keep-count for notes.
  - Size is monotone in each keep-count, so a binary search is fine. Avoid quadratic re-rendering: the 2000-entry acceptance case must stay fast.
  - Count every size check with the shortened note included.
  - Cut entries come from the end of their list.
  - Each list that lost entries gets one final line counting them: `- …and <N> more unexplained deviation(s)`, `- …and <N> more attention point(s)`, `- …and <N> more review note(s)`.
  - When every entry of a list is cut, the subsection holds only its count line, not `None.`.
  - For notes, drop trailing notes from the last group backwards, and drop a group whose notes are all cut. Render the kept groups through `renderReviewNotes`, then append the count line. The `## Review notes` heading and intro are always kept (even with 0 notes kept), and the section never disappears when notes were gathered.
  - A shortened body ends with `\n\n---\n\n*This description was shortened to fit GitHub's limit. The review handoff named under Full detail lists every entry.*` and returns `shortened: true`.
  - The summary, the phase lines and `## Full detail` are never cut. If they alone exceed the cap, return the fully-cut body as it is.
- Keep the module pure: no I/O and no `node:os`. Import only domain or schema types. `src/domain/publish/body.ts` stays as it is in this phase; phase-02 deletes it.

### Planned files to create

- `src/domain/publish/prBody.ts`
- `tests/unit/publish/prBody.test.ts`

### Planned files to edit

- `src/domain/reconciliation/explained.ts`
- `tests/unit/reconciliation/explained.test.ts`
- `src/app/reviewHandoff.ts`

### Optional files that may be edited

- `tests/unit/reviewHandoffContent.test.ts`
- `src/domain/review/reviewNotes.ts`

### Boundary contracts

Consumer: publishing (`src/app/publishRun.ts`, phase-02). Producer: `buildShortPrBody` in `src/domain/publish/prBody.ts`. It needs decoded facts only: the run's names, the plan path or loose, the spec outcome line, the gate profile, the phase statuses in plan order, the verified surfaces, the decoded compliance review or none, the global reconciliation with the phase handoff texts, the gathered review-note groups, the run folder with the home directory, and records configured or not. It returns `{ body, shortened }`. The shared producer `findUnexplainedGlobalDeviations` in `src/domain/reconciliation/explained.ts` serves both the review handoff and the PR body. Its contract is the spec's "unexplained deviation" test. The exact field names may adapt; what must not change is that the domain receives decoded data, never paths to read.

### Test strategy

Write the tests before the implementation.

`tests/unit/reconciliation/explained.test.ts` covers `findUnexplainedGlobalDeviations`:
- an unplanned entry named in its phase's handoff is excluded;
- an unplanned entry absent from its phases' handoffs is listed with kind `unplanned` and its phases;
- a missing entry is listed with kind `missing`;
- unplanned entries come before missing ones.

The existing `tests/unit/reviewHandoffContent.test.ts` must pass unchanged. It pins that the review handoff's output does not move. Extend it only if no case pins `## Deviations not explained in any handoff`.

`tests/unit/publish/prBody.test.ts` covers the §8 acceptance criteria with made-up inputs: run `acme.greet-cli`, plan `docs/plans/2610101200-greet-cli-plan.md`, spec `docs/specs/2610091100-greet-cli.md`, gate profile `standard`, surfaces `local`, `structural`. None of it is copied from a real PR.
- Section order: summary, `## Phases`, `## Needs your review`, `## Full detail`. No line starts with `# `. No `## Phase details`, `File reconciliation`, `## Plan compliance review` or `Global File Reconciliation`. No handoff line, no compliance summary, no finding message, no shortened note.
- Summary values: the plan path or `loose plan`, the spec line, `3/3`, `local, structural`, `conformant-with-deviations`.
- Phase lines: phase-02 shows `conformant-with-deviations`, 2 deviations and 1 unexplained; a skipped phase-03 shows `skipped`.
- Only unexplained deviations are listed: `src/render/colors.ts` unplanned in phase-02 and `tests/render/plain.test.ts` missing in phase-02 are listed; `src/render/index.ts`, named in the handoff, is not.
- `None.` when there is no unexplained deviation.
- Attention points appear verbatim and no finding appears.
- With no compliance review: `not reviewed` everywhere and no `### Compliance attention points`.
- Review notes sit between Needs your review and Full detail, render identically to `renderReviewNotes`, and list once a note that two phases share. With no groups, there is no `## Review notes`.
- The pointer names `~/.phax/runs/acme.greet-cli/review-handoff.md` and `phax review-handoff greet-cli`. The body holds no absolute home path and no `branch` claim about the handoff.
- `phax records explain <commit>` appears only with `records: "configured"`.
- Over the cap: 2000 unexplained deviations, 30 attention points and 5 notes give a body of at most 60000 bytes. Deviations are cut with a count line, attention points stay whole while that suffices, all 5 notes are present, and the body ends with the shortened note.
- Notes alone over the cap: the body is at most 60000 bytes. No deviation or attention-point entry remains (only count lines). The heading and intro are present, then the first notes, then a count line, then the shortened note.

### Implementation order

1. Write the explained.test.ts cases, add `findUnexplainedGlobalDeviations`, and switch `buildUnexplainedSection` in `src/app/reviewHandoff.ts` to it. reviewHandoffContent tests stay green.
2. Write `tests/unit/publish/prBody.test.ts` for the uncapped shape: summary, phases, needs-your-review, review notes, full detail.
3. Implement `buildShortPrBody` without the cap until those tests pass.
4. Add the cap tests, then implement the cut order, the count lines and the shortened note.
5. Run the `standard` gate profile.

### Excluded scope

- Wiring the builder into `src/app/publishRun.ts`, and deleting `src/domain/publish/body.ts` (phase-02).
- Loading `compliance-review.json`, `run-status.json`, verified surfaces or the home directory: that is app-layer work for phase-02.
- Changing the review handoff's sections, order or text.
- README and NEXT_STEPS updates (phase-02).
- Editing any skill file. If a skill describes the PR body, report it in the handoff instead.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact module paths and signatures: `buildShortPrBody` and its input type in `src/domain/publish/prBody.ts`, the exported cap constant's name, and `findUnexplainedGlobalDeviations` with `UnexplainedDeviation` in `src/domain/reconciliation/explained.ts`.
- How the caller must shape each input field, especially the `phases[].status` mapping it expects and the `runFolder` / `records` variants.
- The final wording chosen for the summary, phase lines, count lines and shortened note.
- Confirmation that the review handoff's output is unchanged, and which test pins it.
- Any deviation from the planned file lists, with the reason. Also any skill found describing the PR body (reported, not edited).

### Commit subject

`feat(publish): add the short PR body builder`

### Commit body

Add buildShortPrBody in src/domain/publish/prBody.ts. It is a pure builder that turns decoded run inputs into the short pull request description. The description holds a run summary with no heading, ## Phases with one line per phase, ## Needs your review (compliance attention points, unexplained deviations), ## Review notes rendered exactly as the review handoff renders them, and ## Full detail, which points to the review handoff in the run folder (home written as ~) and, when records are configured, to phax records explain.

The 60000-byte cap cuts unexplained deviations first, then attention points, then review notes. Each run of cut entries becomes one count line, and a shortened note ends the body. The summary, the phase lines, the review-notes heading and intro, and Full detail are never cut.

The unexplained-deviation test moves into a shared domain helper, findUnexplainedGlobalDeviations. The review handoff and the new body both use it. The handoff's output is unchanged.

Publishing does not use the builder yet; the next phase switches it.

---

## phase-02 — Publishing uses the short PR body, and the docs {#phase-02-publish-uses-it}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

When phax creates a run's pull request, the description is the short body from phase-01. It is written byte for byte to `pr-body.md` before `gh pr create`, the old header and false truncation note are gone, and the README describes it, while `review-handoff.md` keeps its full detail.

### Detailed instructions

- In `src/app/loadReviewHandoffInputs.ts`:
  - Expose the gathered review-note groups beside the rendered section: add `reviewNoteGroups: ReadonlyArray<ReviewNoteGroup>` to `ReviewHandoffInputs`.
  - Split `loadReviewNotes` into a `loadReviewNoteGroups(info)` that returns `gatherReviewNotes(phases)`, and keep `loadReviewNotes` as `renderReviewNotes(yield* loadReviewNoteGroups(info))`, so the review handoff's callers are unchanged.
  - `loadReviewHandoffInputs` returns both.
- In `src/app/publishRun.ts`, in the create path only (after the existing-PR check; reuse keeps today's behavior and never touches an existing PR's body), gather the inputs and call `buildShortPrBody` from `src/domain/publish/prBody.ts`:
  - `qualifiedName: runKey(info.namespace, info.shortName)` and `shortName: info.shortName`.
  - `plan`: read `run-status.json` in `info.runPath` through the FileSystem port, `JSON.parse` it, and decode it with `readRunStatusFile` from `src/schemas/persisted.ts`. Its `planRepoRelPath` gives `{ kind: "path", path }`; an absent value gives `{ kind: "loose" }`. Treat a read or decode failure like the other input-load failures, through the existing `fail(..., pushStatus, "failed", { baseBranch })` path.
  - `sourceSpecOutcome`: the loaded `sourceSpecOutcomeMd`.
  - `gateProfileId: info.gateProfileId`.
  - `phases`: from `info.phaseStatuses`, sorted by `phaseIndex`, with the title from `info.planPhases` (falling back to the phaseId). Status is `skipped` when state is `skipped`; `passed` when `isPhaseTerminal(state)` from `src/domain/state.ts` and not skipped (the same count the review handoff uses); otherwise `unfinished`.
  - `verifiedSurfaces`: `aggregateVerifiedSurfaces(info.runPath, phaseIds)` from `src/app/gateAttribution.ts`.
  - `compliance`: read `compliance-review.json` in the run folder (reuse `COMPLIANCE_REVIEW_JSON_FILENAME` from `src/domain/review/compliancePrompt.ts`) and decode it with `readComplianceReviewFile`. A decoded review gives `{ kind: "reviewed", review }`; an absent or undecodable file gives `{ kind: "not-reviewed" }`.
  - `global`, plus `phaseHandoffs` mapped from the loaded `phaseContents` (`{ phaseId, handoffMd: phaseHandoffMd }`), plus `reviewNoteGroups`.
  - `runFolder: { path: info.runPath, homeDir }`.
  - `records`: `opts.records?.enabled === true ? "configured" : "not-configured"`.
- Add `readonly homeDir?: string` to `PublishRunOpts`, defaulting to `homedir()` from `node:os`, as `now` defaults today. Its comment says it exists so tests can pin the `~` rewrite. The callers (`src/cli/commands/publishPr.ts`, `src/app/executePlan.ts`) need no change; touch them only if typechecking requires it.
- Remove from `publishRun`:
  - the `buildReviewHandoffContent` call;
  - the `compliance-review.md` read and the `COMPLIANCE_REVIEW_FILENAME` constant;
  - the `buildPrBody` import.
  Keep the `review-handoff.md` existence precondition as it is.
- Delete `src/domain/publish/body.ts` and `tests/unit/publish/body.test.ts`. No back-compat shim, no switch, and no export of the old header or truncation note remains. Afterwards, grep `src/` and `tests/` for `PHAX Run Review Handoff`, `truncated because it exceeded` and `buildPrBody`, and remove every remaining use.
- Keep writing the body to `pr-body.md` with `fs.writeAtomic(join(info.runPath, PR_BODY_FILENAME), built.body)` before `github.createPullRequest`, and pass that same path as `bodyFile`. Nothing in publishing sends the body or a review note to an agent.
- Update `tests/integration/publishRun.test.ts`:
  - Replace the cases that assert the old body: the compliance-section-before-phase-details case, the unchanged-without-compliance case, and the source-spec cases. Their new forms assert the short body: the compliance verdict and attention points come from a made-up `compliance-review.json` (with no finding message in the body); `not reviewed` appears without it; the spec line appears in the summary when `source-spec-outcome.md` exists and is absent otherwise.
  - Add a case: at `gh pr create` time, `pr-body.md` exists and its content equals the body file passed to the fake (read the file when the fake records the call, or compare the recorded `bodyFile` path and the persisted content).
  - Add a case: the body holds `~/.phax/runs/<key>/review-handoff.md` when `homeDir` is the run folder's ancestor, and holds no absolute home path and no `branch` claim about the handoff.
  - Add a case: `phax records explain` appears only when `records.enabled` is true.
  - Add a case: the plan path appears when `run-status.json` records `planRepoRelPath`, and `loose plan` appears when it does not.
  - Add a case: after publishing, `review-handoff.md` in the run folder (generated as the existing fixtures do, or with `generateReviewHandoff`) still holds `## Phase details`, each phase's `#### File reconciliation` and `#### Phase handoff`, and the global file reconciliation heading.
  - All fixtures are made up.
- README.md:
  - In the review and publish section, replace the sentence at the line saying the compliance verdict "goes into the pull request's description". `phax publish-pr <run>` writes a short description: a run summary with the compliance verdict, one line per phase, what needs your review (unexplained deviations, compliance attention points), the review notes, and where to read the full review handoff, `~/.phax/runs/<namespace>.<name>/review-handoff.md`, on the machine that ran it.
  - In the review-notes paragraph ("phax gathers the notes … into a `## Review notes` section of the review handoff and the PR body"), keep the meaning and make sure it still holds. Say that the PR body cuts review notes last when it must be shortened.
- NEXT_STEPS.md: remove the `- [ ] **A terser PR description.**` entry and its indented continuation lines (around line 392). This spec covers it.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/publishRun.ts`
- `src/app/loadReviewHandoffInputs.ts`
- `tests/integration/publishRun.test.ts`
- `src/domain/publish/body.ts`
- `tests/unit/publish/body.test.ts`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `tests/integration/loadReviewHandoffInputs.test.ts`
- `tests/unit/cli/publishPr.test.ts`
- `tests/integration/recordsPush.test.ts`
- `src/cli/commands/publishPr.ts`
- `src/app/executePlan.ts`

### Boundary contracts

Consumer: `publishRun` (app). Producer: `buildShortPrBody` (domain, phase-02 adds no change to it). The app owns every read: `run-status.json`, `compliance-review.json`, gate attributions and phase handoffs, through the FileSystem port. It decodes each one through its schema reader before handing plain values to the domain. Consumer: `gh pr create` through the GitHub port. Contract: the `bodyFile` it reads is `<run folder>/pr-body.md`, holding exactly the returned body. Producer change in `loadReviewHandoffInputs`: `ReviewHandoffInputs` gains `reviewNoteGroups`, and the existing `reviewNotesMd` keeps its meaning for the review-handoff callers.

### Test strategy

Integration tests with fake ports in `tests/integration/publishRun.test.ts`. Write the new assertions before switching `publishRun`:
- the body file is the persisted `pr-body.md`;
- the summary carries the plan path or `loose plan`, the spec line and the compliance verdict or `not reviewed`;
- the pointer uses `~`, and there is no branch claim;
- `phax records explain` appears only with records enabled;
- `review-handoff.md` keeps `## Phase details`, the per-phase file reconciliation and handoff, and the global reconciliation.
The reuse path still never calls `createPullRequest`. If `tests/integration/loadReviewHandoffInputs.test.ts` asserts the full returned shape, extend it with `reviewNoteGroups`. The domain cut logic is already covered by phase-01's unit tests; do not duplicate it here.

### Implementation order

1. Expose `reviewNoteGroups` from `loadReviewHandoffInputs` (and `loadReviewNoteGroups`); existing tests stay green.
2. Rewrite the publishRun integration assertions for the short body.
3. Switch `publishRun` to `buildShortPrBody` with the new input loading and the `homeDir` option.
4. Delete `src/domain/publish/body.ts` and its unit test, and grep for leftovers.
5. Update README.md and NEXT_STEPS.md.
6. Run the `standard` gate profile.

### Excluded scope

- Changing `review-handoff.md`, `buildReviewHandoffContent`'s output, `phax review-handoff`, or the review-code session.
- Updating the body of an already-existing pull request (the reuse path is unchanged).
- Committing any run-folder file to the run's branch.
- PR title, push, base-branch choice, `publish.auto` behavior, or running/waiting for a compliance review.
- Adding `planRepoRelPath` to `RunReviewInfo`.
- Editing any skill file. If a skill describes the PR body, report it in the handoff instead.

### Verification

The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- How `publishRun` now builds the body, and which run-folder files it reads, with their decoders.
- The `homeDir` option on `PublishRunOpts`.
- The new `reviewNoteGroups` field and `loadReviewNoteGroups` export.
- Confirmation that `src/domain/publish/body.ts` and its test are deleted and no old header or truncation-note text remains in `src/` or `tests/`.
- Which test pins that `review-handoff.md` keeps its detail.
- The README sentences changed and the NEXT_STEPS entry removed.
- Any deviation from the planned file lists, with the reason, including which optional files were touched and why. Also any skill found describing the PR body (reported, not edited).

### Commit subject

`feat(publish): write the short PR body when opening a pull request`

### Commit body

publish-pr and publish.auto now build the pull request description with buildShortPrBody. The handoff with a header in front is gone. The body holds the run summary (plan path from run-status.json, verified surfaces, compliance verdict from compliance-review.json), one line per phase, the unexplained deviations and compliance attention points, the review notes, and a pointer to review-handoff.md in the run folder.

The old builder, its header and its truncation note, which wrongly said the handoff is on the PR branch, are deleted rather than kept behind a switch. pr-body.md still holds the exact body given to gh pr create. review-handoff.md is unchanged; a test pins that it keeps its phase details and global file reconciliation.

README's review and publish section now describes the short description. The NEXT_STEPS entry it covers is removed.
