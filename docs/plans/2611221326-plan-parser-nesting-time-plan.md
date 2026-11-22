---
status: Approved
source-spec: docs/specs/2611221308-plan-parser-nesting-time.md
completes-spec: true
approved:
  date: 2026-11-22
  baseline: 3ff18b1
---
# Plan parser nesting time

phax refuses a plan whose blockquotes and lists nest more than 32 levels deep, and it does so before the Markdown parser sees the plan. A run of 61,440 `>` characters currently costs `fromMarkdown` seconds of CPU, and every plan reader re-parses the body. This plan adds one guarded entry, `readPlanTree`, as the only place a plan body is parsed. Before `fromMarkdown`, it runs a linear per-line depth measure that may over-count but never under-counts. When the measure finds a line over the limit, the readers give a refusal-shaped answer instead of parsing. On top of that guard, plans lint, run, overview and estimate name the line and the limit. The deep-pass counter-example becomes a hand-written case in the parser's unit suite. A corpus test shows that every plan under docs/plans/ (archive included) reads the same as before. Last, docs/property-tests.md's 'The 2-second bound' section describes the limit. Core to surface: the domain guard and readers (phase-01), the use cases and command output (phase-02), the docs (phase-03).

## Required commands

- `pnpm test:unit`
- `pnpm test:integration`

Both commands are already in `security.agentCommands`. `pnpm test` is a gate command. The plan needs no change to phax.json.

## Technical arbitrations

- How the depth is measured. For each line of the body (line endings `\r\n`, `\r` and `\n`, as micromark reads them), scan the leading container prefix with columns tracked at tab stops of 4. Spaces and tabs add to a pending whitespace count. A `>` counts as one marker; one space right after it is skipped uncounted, because CommonMark gives that space to the blockquote. A bullet (`-`, `+`, `*`) or an ordered marker (1–9 digits, then `.` or `)`) followed by a space, a tab or the line end also counts as one marker. Each marker moves the pending whitespace into the counted total. The scan stops at any other character. The line's estimate is markers + floor(counted whitespace / 2). Why it never under-counts: the line that opens a container at depth d matches every ancestor explicitly before its last marker. A continued list item needs at least 2 columns of indentation, a new list marker is followed by at least one whitespace column, and a blockquote has its `>`. Its estimate is therefore ≥ d, and no line deeper than every opening line exists. The measure is exact for 2-column list nesting and `> ` quotes. It over-counts `>` or list-marker lines inside fenced code, thematic breaks such as `- - -`, and wider indentation: a 4-space outline counts about two levels per level, so it reaches the limit near 16 real levels. Loss accepted: such over-deep-looking plans are refused, and the corpus test is where a real one would show up. Abandoned: a container-tracking pre-parser exact to CommonMark, which re-implements container rules and puts the never-under-count guarantee at risk.
- Where the check sits. A new pure domain module, `src/domain/plan/planTree.ts`, exports `readPlanTree(planMd)`. It splits the frontmatter, runs the measure and calls `fromMarkdown` only when no line is over 32. It is the one place a plan body is parsed: parsePlanMarkdown.ts (walkPlan, readPlanTestStrategies), phaseHeader.ts (readPhaseHeaders) and sections.ts (rootBlocks) all go through it. A new architectural guard keeps it so: no module under src/domain/plan/ other than planTree.ts imports mdast-util-from-markdown. In phase-02 the same module also exports `planNestingRefusal(planMd)`. lintPlan, loadOrExtractPlan and planOverview call it at their entry to name the refusal. Loss accepted: a caller that ignores the refusal sees the readers' empty or failed answers, not a typed error. Abandoned: a check at each use case's entry alone, which leaves any caller not named unguarded.
- What each reader answers over the limit, without parsing. collectPlanStructureErrors returns exactly one error, `{ phase: null, message: 'line <n>: blockquotes and lists nest over 32 levels deep' }`. readPlanDeterministic and extractPlanDeterministic fail with a PlanValidationError carrying that message. readPlanUnplannablePaths, readPlanTestStrategies, readPhaseHeaders, phaseHeadingIds and phaseHeadingSources return []. locatePlanSections fails with every requested phase id. The structure check and the extraction therefore still agree. Loss accepted: section location reports 'missing' sections, not 'too deep'. Only a resume on a plan.md edited past the limit after the run started reaches it, and the run preflight's existing exit-11 refusal answers there.
- The line number in the refusal is the line of the plan file as the editor shows it: frontmatter lines are counted, although only the body is measured. Loss accepted: on a repo-tracked plan the number differs from a count that starts at the body.
- plans lint on a plan over the limit. Artifact validation of a repo-tracked plan still runs first, and its failure stays the effect's error, as today. Then lint returns the single structure finding. It does not run lineage (a 'structure' finding), the sequence-gap, header, test-line, interactive or acceptance checks, or any check that needs the parsed plan. Loss accepted: a slug mismatch on such a plan is reported only once the nesting is fixed.
- The use cases the spec does not name. analyzePlanOverlap, planStaleness and adjustPlan read the plan through loadOrExtractPlan, so they get its refusal: a PlanValidationError naming the line, the limit and phax plans lint, with no cache access and no model call. On main, loadConfig imports no plan reader and parses no plan Markdown, so it has nothing to answer. runPreflight and executePlan only read a plan that loadOrExtractPlan already accepted. On a resume after the plan was edited past the limit, they meet the empty headers and the failed section location: the existing exit-11 preflight refusal. estimatePlan already wraps readPlanDeterministic's message as '<plan> cannot be parsed: <reason>. Run `phax plans lint <plan>` for every finding.', so it names the line, the limit and plans lint without new code.
- The bounded-time property keeps its four timed calls, its 2,000 ms bound, its fragments and BOUNDED_TIME_RUNS = 40 (operator verdict keep-40). Two hand-written cases on every pull request time readPhaseHeaders and readPlanTestStrategies, which the property does not draw: the 61,440 `>` text and a nested list over 60 KiB. Loss accepted: those two readers are not exercised on random inputs.
- Who verifies the seeded deep pass. The gate never runs 2,000 inputs. The person reviewing the kept-open final phase runs `PHAX_PROPERTY_SEED=1253054900 PHAX_PROPERTY_RUNS=2000 pnpm test:unit tests/unit/property/planParser.property.test.ts -t 'parsing finishes in bounded time'`. They do not use `pnpm test:property:deep`, because that script sets PHAX_PROPERTY_SEED=random itself and so overrides the seed. No phase runs it. Loss accepted: ac-deep-pass-seed is proven by a person's run, not by a gate. The hand-written counter-example cases guard the same input on every pull request.

---

## phase-01 — Guard every plan reader with the nesting limit {#phase-01-nesting-guard}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The phase designs a depth measure no code in the repository shows yet, and it must be argued never to under-count CommonMark's container depth. That reasoning is beyond the default assignment.

Every plan reader goes through one guarded entry that measures nesting depth in linear time and refuses a plan with a line over 32 levels before the Markdown parser sees it. On the deep-pass counter-example, a reader now answers in milliseconds instead of seconds of CPU. Every committed plan reads exactly as before.

### Detailed instructions

- Create `src/domain/plan/planTree.ts`, a pure domain module with no I/O. It holds the constant nesting limit 32, the depth measure, the refusal message and `readPlanTree(planMd)`. `readPlanTree` splits the frontmatter as the readers do today (`splitFrontmatter(planMd)?.body ?? planMd`). It returns either `{ body, root }`, with root = `fromMarkdown(body)`, or a refusal `{ line, message }`; use an Effect `Result` or a discriminated union, whichever fits the readers best. Export only what another module imports: knip runs default and `--production --strict` at the gate, so an export used only by tests or only within its own file fails it.
- The refusal message is exactly `line <n>: blockquotes and lists nest over 32 levels deep`, with <n> the 1-based line number in the plan file. Frontmatter lines are counted, but only the body is measured. Compute the offset as the number of line endings in the text before the body.
- The depth measure, per body line, with line endings `\r\n`, `\r` and `\n` as micromark reads them. Walk the line's leading container prefix from column 0, tracking columns with tab stops of 4, and keep two counters: pending whitespace and counted whitespace. Spaces and tabs add their columns to pending. On `>`: count one marker, move pending into counted, consume the `>`; then a following space is consumed and not counted, and a following tab adds its expanded width minus 1 to pending. On `-`, `+` or `*` followed by a space, a tab or the line end: count one marker, move pending into counted, consume the marker. On 1 to 9 ASCII digits followed by `.` or `)` and then a space, a tab or the line end: the same. Stop at anything else. The line's depth estimate is markers + floor(counted / 2). The plan is over the limit at the first line whose estimate exceeds 32. Stop scanning there. The whole measure is one linear pass and only looks at each line's prefix.
- Keep the reason the measure never under-counts as a short comment above it. The line that opens a container at depth d matches every ancestor explicitly before its last marker. A continued list item needs at least 2 columns of whitespace, a new list marker is followed by whitespace, and a blockquote has its `>`. So that line's estimate is at least d. A lazy continuation line never opens a container. The measure is exact for 2-column list nesting and for `> ` quotes, and it may over-count elsewhere (fenced code, `- - -`, wider indents).
- In `src/domain/plan/parsePlanMarkdown.ts`, route `walkPlan` and `readPlanTestStrategies` through `readPlanTree`; neither calls `fromMarkdown` any more. Over the limit: `collectPlanStructureErrors` returns exactly `[{ phase: null, message: <refusal message> }]`. `readPlanDeterministic` and `extractPlanDeterministic` fail with a `PlanValidationError` whose message is the refusal message. `readPlanUnplannablePaths` and `readPlanTestStrategies` return []. Within the limit, every function behaves exactly as today: same errors, same order, same candidate, same offsets.
- In `src/domain/plan/phaseHeader.ts`, route `readPhaseHeaders` through `readPlanTree`; over the limit it returns []. In `src/domain/plan/sections.ts`, route `rootBlocks` (and therefore `locatePlanSections`, `phaseHeadingIds` and `phaseHeadingSources`) through `readPlanTree`. Over the limit, `phaseHeadingIds` and `phaseHeadingSources` return [], and `locatePlanSections` returns `Result.fail` with every requested phase id, in plan order. Remove the `mdast-util-from-markdown` import from all three modules.
- In `tests/unit/architecturalGuards.test.ts`, add a guard in the file's existing style: no `.ts` file under `src/domain/plan/` other than `planTree.ts` imports `mdast-util-from-markdown`.
- Create `tests/unit/planNesting.test.ts` for the measure through `readPlanTree`. Include boundary cases: a 2-space bullet list 32 levels deep is read and the same at 33 levels is refused on its line; `>` runs of 32 and 33; `> ` with spaces; mixed `> - > -` on one line; ordered markers; tabs. Check the line numbering after a frontmatter block and with CRLF and lone-CR endings. Check that a `>` inside a fenced code block may count (an over-count is allowed). Add a fast-check property through `tests/helpers/property/harness.js` (`checkProperty`, fixed seed by default). It generates nested blockquote and list text at about 20 to 45 levels: mixed containers, varied but valid indentation, `>` with and without a space, ordered markers, lazy lines and blank lines. The oracle is the depth the mdast tree itself shows (count the blockquote and listItem ancestors of every node of `fromMarkdown(body)`, called directly in the test). Whenever that depth exceeds 32, `readPlanTree` must refuse. For minimal-form inputs (2-space bullets, `> ` quotes), it refuses exactly when the depth exceeds 32. Also add a no-parse check: mock `mdast-util-from-markdown` with a pass-through spy (`vi.mock` with `importOriginal`). Over the limit, each reader (collectPlanStructureErrors, readPlanDeterministic, extractPlanDeterministic, readPlanUnplannablePaths, readPlanTestStrategies, readPhaseHeaders, locatePlanSections, phaseHeadingIds, phaseHeadingSources) leaves the spy uncalled. Within the limit, the spy is called.
- In `tests/unit/parsePlanMarkdown.test.ts`, which is where docs/property-tests.md puts a parser counter-example, add the hand-written deep-pass counter-examples. The first is `'>'.repeat(61_440)` (seed 1253054900, origin `large: character-run`). The second is a nested list over 60 KiB built like the `nested-lists` fragment: lines `${'  '.repeat(i)}- item` joined by `\n`, cut to just under 64 KiB. For each text and each reader: collectPlanStructureErrors, readPlanDeterministic, extractPlanDeterministic, readPlanUnplannablePaths, readPlanTestStrategies, readPhaseHeaders, locatePlanSections with one probe phase, phaseHeadingIds and phaseHeadingSources. Assert the expected refusal answer (line 1 for the `>` run, the first line deeper than 32 for the list) and a CPU time of at most 2,000 ms, fastest of three. Use `process.cpuUsage()` as the property file does, never wall-clock time.
- Create `tests/unit/planNestingCorpus.test.ts` (a test, not a one-off measurement). It reads every `.md` file under `docs/plans/`, archive included, from the repository root with node:fs. For each plan: `readPlanTree` gives no refusal, and its root deep-equals `fromMarkdown` called directly on the same body. Every reader goes through `readPlanTree`, which the architectural guard enforces, so equal trees mean every reading is the same with and without the limit. Compute the deepest true nesting depth over the corpus from the mdast trees (blockquote and listItem ancestors). Report it in the test title, e.g. `every committed plan reads as before (deepest nesting: N)`, and assert that it is under 32.
- Do not change `tests/unit/property/planParser.property.test.ts` or `tests/helpers/property/planText.ts`. TIME_BOUND_MS, BOUNDED_TIME_RUNS, the timed calls, the fragments and their caps all stay as they are. The gate runs the property at its default seed. The seeded 2,000-run deep pass is run by the review, not by this phase.
- Run `pnpm test:unit` on the touched test files while you work. Fix lint findings in the code; never add a disable directive.

### Planned files to create

- `src/domain/plan/planTree.ts`
- `tests/unit/planNesting.test.ts`
- `tests/unit/planNestingCorpus.test.ts`

### Planned files to edit

- `src/domain/plan/parsePlanMarkdown.ts`
- `src/domain/plan/phaseHeader.ts`
- `src/domain/plan/sections.ts`
- `tests/unit/parsePlanMarkdown.test.ts`
- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- `tests/unit/phaseHeader.test.ts`
- `tests/unit/planSections.test.ts`
- `src/domain/plan/finalize.ts`

### Boundary contracts

Producer: `src/domain/plan/planTree.ts` gives the plan readers a parsed tree, or a refusal `{ line, message }` with no parse. Consumers: the readers in parsePlanMarkdown.ts, phaseHeader.ts and sections.ts. They need the body and root exactly as `splitFrontmatter` plus `fromMarkdown` produce them today, so their offsets and slices stay the same. Over the limit they need a refusal they can turn into their own answer shape. The message wording is normative (spec §6, the --json finding).

### Test strategy

- a line nested 33 levels deep is refused naming its file line, and the same line at 32 levels is read — small · boundary · expected refusal line and message, or a parsed tree · in-phase · ac-at-limit
- the measure never under-counts: any generated nesting the parser reads deeper than 32 is refused, and minimal-form nesting is refused exactly above 32 — small · property · the container depth the mdast tree itself shows · in-phase
- the refusal's line number counts frontmatter lines and reads CRLF and lone-CR endings as micromark does — small · example · expected line numbers · in-phase
- every plan reader answers the 61,440 '>' text and a nested list over 60 KiB with the refusal within 2,000 ms of CPU, fastest of three — small · example · the expected refusal answers and the 2,000 ms CPU bound · in-phase · ac-every-reader-time
- no plan reader calls the Markdown parser on a text over the limit, and each still calls it within the limit — small · example · call count of a pass-through fromMarkdown spy · in-phase · ac-every-reader-time
- every plan under docs/plans/, archive included, gets no refusal and the same tree as an unguarded parse, and the deepest nesting found is reported and under 32 — medium · table · fromMarkdown called directly on the same body · in-phase · ac-corpus
- no plan reader module other than planTree.ts imports the Markdown parser — small · example · the architectural guard's import scan · in-phase
- the bounded-time property passes on seed 1253054900 with 2,000 runs, its bound, cap and fragments unchanged (run by the review, the default seed by the gate) — medium · property · the property's 2,000 ms CPU bound · in-phase · ac-deep-pass-seed

### Implementation order

1. The depth measure and the refusal message in planTree.ts, with the boundary and line-number cases in planNesting.test.ts.
2. readPlanTree, and the never-under-count property against the mdast depth.
3. Route parsePlanMarkdown.ts, phaseHeader.ts and sections.ts through readPlanTree, with their over-limit answers.
4. The no-parse spy check, the hand-written counter-examples in parsePlanMarkdown.test.ts, and the architectural guard.
5. The corpus test.

### Excluded scope

- plans lint, run, overview and estimate use cases and their messages (phase-02).
- docs/property-tests.md (phase-03).
- Any change to the bounded-time property, its fragments, caps or run counts, or to the deep pass.
- Emphasis and other inline nesting; Markdown readers outside plan reading (specs, briefs, §9 questions).
- Reducing how many times a command parses a plan within the limit.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact module path `src/domain/plan/planTree.ts`, what it exports and the shape of `readPlanTree`'s refusal. The exact refusal message. Each reader's answer over the limit. The deepest nesting depth the corpus test found. The CPU timings the counter-example cases measured locally. The replay command for the review: `PHAX_PROPERTY_SEED=1253054900 PHAX_PROPERTY_RUNS=2000 pnpm test:unit tests/unit/property/planParser.property.test.ts -t 'parsing finishes in bounded time'`. Any deviation from the planned file lists, with the reason.

### Commit subject

`fix(plan): refuse a plan nested over 32 levels before parsing it`

### Commit body

A run of 61,440 '>' characters cost the Markdown parser seconds of CPU per plan read, which turned the bounded-time property red in the deep pass (seed 1253054900). Every plan reader now parses through readPlanTree in src/domain/plan/planTree.ts. It measures each line's blockquote and list nesting in one linear pass that may over-count but never under-counts, and it refuses a plan with a line deeper than 32 levels before parsing: 'line <n>: blockquotes and lists nest over 32 levels deep'. The structure check reports that refusal as its single error, the extraction fails with it, and the other readers answer empty without parsing. The deep-pass counter-example and a nested list over 60 KiB are hand-written cases timed in CPU. A corpus test shows that every plan under docs/plans/ parses to the same tree as before, and an architectural guard keeps the parser behind the one entry.

---

## phase-02 — Name the nesting refusal in plans lint, run, overview and estimate {#phase-02-command-refusals}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium
**Assignment reason:** The refusal crosses the domain, four use cases and the command surface. phax run must provably refuse before the cache, the model and any run state, checked through command-level tests with a fake provider. That cross-layer choice is beyond the default assignment.

Every command that reads a plan answers a plan over the nesting limit by naming the line and the limit. plans lint reports one structure error and exits non-zero. phax run refuses before the extraction cache, any model call or any run state. plans overview and plans estimate fail with a message that points to phax plans lint.

### Detailed instructions

- In `src/domain/plan/planTree.ts` (created by phase-01, which also holds `readPlanTree` and the refusal message), export `planNestingRefusal(planMd)`. It returns the refusal `{ line, message }`, or null within the limit, and it uses the same measure and frontmatter split as `readPlanTree` without parsing. Do not duplicate the measure: refactor so both share it. Export only what the use cases import (knip runs `--production --strict`).
- In `src/app/lintPlan.ts`, right after reading the plan: when `planNestingRefusal` returns a refusal, first run artifact validation for a repo-tracked plan (`classifyArtifactPath(repoRelPath) !== null`), exactly as today. Its failure stays the effect's error. Then return `{ plan: reportPath, findings: [{ severity: 'error', check: 'structure', phase: null, message: refusal.message }] }`. Run no other check: not lineage, sequence gap, headers, test lines, interactive, acceptance, files, commands, models, bounds or the plan auditor. The CLI's exit code follows from the error finding (exit 1), as for any error finding.
- In `src/app/loadOrExtractPlan.ts`, check `planNestingRefusal` first, before the departing-test-line refusal, the cache key, any cache read or write and any Backend call. Fail with `new PlanValidationError({ message: `${opts.planMdPath}: ${refusal.message} — run phax plans lint ${opts.planMdPath}`, path: opts.planMdPath })`, in the same form as the departing-test-line refusal. This covers phax run and the use cases that read through it (analyzePlanOverlap, planStaleness, adjustPlan). Do not change `src/cli/definitions/run.ts`. Its existing 'Plan extraction failed:' refusal path already carries the message, and nothing it does before loadOrExtractPlan writes run state.
- In `src/app/planOverview.ts`, after artifact validation and before the deterministic extraction: on a refusal, fail with `{ kind: 'unparsable', line: `${reportPath}: ${refusal.message} — run phax plans lint ${reportPath}` }`. Keep the generic 'the plan does not parse' line for every other failure.
- `src/app/estimatePlan.ts` needs no new code. Its `readPlanDeterministic` failure already carries the refusal message, so the error reads `<repoRelPath> cannot be parsed: line <n>: blockquotes and lists nest over 32 levels deep. Run `phax plans lint <repoRelPath>` for every finding.`. Touch the file only if the command-level test shows the message does not reach the user.
- Unit tests. In `tests/unit/loadOrExtractPlan.test.ts`, a plan over the limit is refused with the exact message, and neither the fake Backend nor the cache files are touched, with `refresh` and without. In `tests/unit/planOverview.test.ts`, the overview failure line for a plan over the limit. Follow the existing departing-test-line cases in those files.
- Create `tests/integration/planNestingCommands.test.ts` with command-level tests. Each test uses its own temporary repository as the working directory and an isolated phax home, and never reads `~/.phax`, a real provider home or the global git config. Follow `tests/integration/plansOverviewCommand.test.ts` (makeFakeProviderCli, isolateGit, phaxHomeEnv) and `tests/integration/runPreflightBeforeNaming.test.ts` (phaxCall). A child process goes through `tests/helpers/boundedSpawn.ts` or the existing helpers. Cover: (a) a loose plan.md whose body is `'>'.repeat(61_440)`: `phax plans lint plan.md --json` has findings that are exactly the one normative structure finding with message `line 1: blockquotes and lists nest over 32 levels deep`, and a non-zero exit. (b) A plan with a valid preamble and phases whose 40th line holds a 2-space bullet list item nested 40 levels deep: the only finding is the nesting finding naming line 40. (c) Two otherwise identical valid plans, one whose deepest line is a 2-space list item 32 levels deep, the other 33 levels deep on line 12: the first has no nesting finding and the same findings as without the deep list, and the second has the single nesting finding naming line 12. (d) `phax run` on a plan over the limit, with a fake provider CLI that records every spawn: non-zero exit, a message naming the line, the limit and `phax plans lint`, an empty spawn log, no extraction cache entry under the state root, and no run folder or run state written. (e) `phax plans overview` and `phax plans estimate` on a plan over the limit: each fails with a message naming the line, the limit and `phax plans lint`.
- Run `pnpm test:unit` and `pnpm test:integration` on the touched files while you work. Fix lint findings in the code; never add a disable directive. No test measures wall-clock time.

### Planned files to create

- `tests/integration/planNestingCommands.test.ts`

### Planned files to edit

- `src/domain/plan/planTree.ts`
- `src/app/lintPlan.ts`
- `src/app/loadOrExtractPlan.ts`
- `src/app/planOverview.ts`
- `tests/unit/loadOrExtractPlan.test.ts`
- `tests/unit/planOverview.test.ts`

### Optional files that may be edited

- `src/app/estimatePlan.ts`
- `tests/integration/lintPlan.test.ts`
- `tests/integration/loadOrExtractPlan.test.ts`
- `tests/integration/plansEstimateCommand.test.ts`
- `tests/unit/cli/plans.test.ts`

### Boundary contracts

Producer: `planNestingRefusal(planMd)` in the domain gives `{ line, message } | null` without parsing. Consumers: the use cases lintPlan, loadOrExtractPlan and planOverview. They turn the refusal into their own answer: a structure LintFinding with phase null, a PlanValidationError before any port is used beyond reading the plan, or an 'unparsable' overview failure line. The CLI layer renders those answers unchanged. The --json finding `{ severity: 'error', check: 'structure', phase: null, message }` is normative (spec §6).

### Test strategy

- plans lint --json on a loose plan of 61,440 '>' reports exactly the one structure finding with phase null naming line 1 and the limit, and exits non-zero — medium · example · the normative JSON finding and the exit code · in-phase · ac-counterexample-lint
- plans lint on a plan whose 40th line nests 40 levels reports the nesting finding naming line 40 and no structure, interactive, acceptance or tests finding beside it — medium · example · the complete findings list · in-phase · ac-lint-alone
- a plan whose deepest list item is 32 levels deep lints as without it, and its 33-level twin gets only the nesting finding naming line 12 — medium · boundary · findings of the 32-level plan against its shallow twin, and the single expected finding · in-phase · ac-at-limit
- phax run on a plan over the limit exits non-zero naming the line, the limit and phax plans lint, spawns no provider, touches no extraction cache and writes no run state — medium · example · fake provider spawn log, cache directory and state root contents · in-phase · ac-run-refused
- loadOrExtractPlan refuses a plan over the limit before the cache key, any cache read or write and any backend call, with and without refresh — small · example · the exact refusal message and untouched fake backend and cache · in-phase · ac-run-refused
- plans overview and plans estimate on a plan over the limit each fail with a message naming the line, the limit and phax plans lint — medium · example · expected failure lines and exit codes · in-phase · ac-overview-estimate

### Implementation order

1. planNestingRefusal in planTree.ts, sharing the measure with readPlanTree.
2. loadOrExtractPlan's refusal with its unit test.
3. lintPlan's single-finding answer.
4. planOverview's failure line with its unit test.
5. The command-level tests for lint, run, overview and estimate.

### Excluded scope

- The depth measure and the plan readers themselves (phase-01).
- docs/property-tests.md (phase-03).
- Any change to run.ts, the run preflight or executePlan: an over-limit plan never reaches them on a fresh run.
- A plan size cap, a configurable limit, or any persisted-format change.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exported `planNestingRefusal` signature. The exact message each command prints: lint text and --json, run, overview, estimate. A note that estimatePlan.ts needed no change, or why it did. Confirmation that analyzePlanOverlap, planStaleness and adjustPlan inherit loadOrExtractPlan's refusal. The file and test names of the command-level cases. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(plan): name the nesting refusal in plans lint, run, overview and estimate`

### Commit body

A plan whose blockquotes or lists nest over 32 levels now gets a direct answer from every command that reads it. plans lint reports one structure error with phase null, 'line <n>: blockquotes and lists nest over 32 levels deep', and exits 1 without running the checks that need a parsed plan. phax run, and the use cases that read through loadOrExtractPlan, refuse before the extraction cache and any model call, pointing to phax plans lint. plans overview and plans estimate name the line and the limit instead of a generic parse failure. Command-level tests cover the deep-pass counter-example, a plan deep at line 40, the inclusive limit at 32 and 33 levels, and a run with a fake provider that is never spawned.

---

## phase-03 — Document the nesting limit under the 2-second bound {#phase-03-docs-bound}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A contributor whose deep pass failed the bounded-time property, or who meets a nesting refusal on a generated plan, finds in docs/property-tests.md why the limit exists, what it costs and how the deep-pass failure was cleared.

### Detailed instructions

- Edit the section 'The 2-second bound' (a `###` heading) in `docs/property-tests.md`. Keep its existing paragraphs about CPU timing, fastest of three and the `nested-inline` cap. Add a few sentences that say what follows. Every plan reader parses through `readPlanTree` (`src/domain/plan/planTree.ts`). It refuses before parsing any plan with a line whose blockquotes and list items nest more than 32 levels deep, a constant that is not configurable. Plans lint reports the refusal as one structure error: `line <n>: blockquotes and lists nest over 32 levels deep`, with <n> counted in the plan file, frontmatter included. phax run, plans overview and plans estimate name the same line and point to phax plans lint. Explain the measure in one or two sentences: one linear pass over each line's prefix, exact for 2-column list nesting and `> ` quotes, never under the parser's depth. It may over-count, for example `>` lines inside fenced code or 4-space indented outlines, which reach the limit near 16 real levels. Say why the limit is 32: the committed plans nest about 6 levels at most, and the corpus test `tests/unit/planNestingCorpus.test.ts` reports the deepest one and fails if a committed plan would be refused.
- Record the cleared failure in the same section. Security run 44320960144 (seed 1253054900) failed the property on 61,440 `>` characters on 2026-11-18. That counter-example and a nested list over 60 KiB are now hand-written cases in `tests/unit/parsePlanMarkdown.test.ts`, timed in CPU on every pull request. Give the replay command for the seeded deep pass: `PHAX_PROPERTY_SEED=1253054900 PHAX_PROPERTY_RUNS=2000 pnpm test:unit tests/unit/property/planParser.property.test.ts -t 'parsing finishes in bounded time'`. Note that `pnpm test:property:deep` sets its own random seed. Include the plans lint example from the spec's docs page as a fenced `text` block.
- In the list under 'For the plan parser, the fix goes where the bug is', add one bullet. A nesting counter-example (the measure under-counted) is fixed in `src/domain/plan/planTree.ts`, with a case in `tests/unit/parsePlanMarkdown.test.ts`.
- Do not change the section on the run counts (40 runs for the bounded-time property stays), the environment-variable table or any other section. Write plain sentences in the document's existing style. `pnpm format:check` covers Markdown, so run `pnpm format` if the gate flags the file.

### Planned files to create

- (none)

### Planned files to edit

- `docs/property-tests.md`

### Optional files that may be edited

- (none)

### Test strategy

- (none)

### Implementation order

1. The limit, the refusal and the measure in 'The 2-second bound'.
2. The cleared deep-pass failure, the hand-written cases and the replay command.
3. The bullet in the plan-parser fix list.

### Excluded scope

- Any code or test change.
- Other docs pages, the README and the CLI reference.
- The run-count section and the deep-pass schedule.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The sections changed in docs/property-tests.md. For the reviewer of this kept-open final phase: the exact seeded deep-pass command to run, `PHAX_PROPERTY_SEED=1253054900 PHAX_PROPERTY_RUNS=2000 pnpm test:unit tests/unit/property/planParser.property.test.ts -t 'parsing finishes in bounded time'`, which proves ac-deep-pass-seed outside the gate. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs(property-tests): describe the plan nesting limit under the 2-second bound`

### Commit body

The 2-second bound section now explains the 32-level nesting limit every plan reader applies before parsing: the refusal message, the measure that may over-count but never under-counts, and the corpus test that keeps committed plans readable. It also records the cleared deep-pass failure (seed 1253054900, 61,440 '>') and the replay command for the seeded 2,000-run pass. The plan-parser fix list gains where a nesting counter-example goes.
