---
status: Draft
date: 2026-11-22
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Plan parser: reading time bounded whatever the Markdown nests

## 1. Context

phax reads a plan.md by parsing its Markdown into a tree (mdast-util-from-markdown over micromark) and walking that tree. There is no single entry point. The structure check, the deterministic extraction, the phase-header reading, the test-strategy reading and section location each parse the body again. As a result, one command parses the same plan several times: plans lint about six times, and phax run three or more times before it starts a phase.

The property-tests spec holds the parser to a bound: any text of at most 64 KiB yields a plan or structure errors, and each call returns within 2 seconds. The property measures CPU time, not wall-clock time, and judges the fastest of three timings. It draws large adversarial inputs from fragments, among them `character-run` (up to 20,000 copies of one character, `>` included), `nested-lists` (up to 2,000 levels) and `nested-quotes` (up to 3,000 levels). On pull requests it checks 40 inputs from a fixed seed. The daily deep pass in the Security workflow checks 2,000 inputs from a fresh seed.

Since 2026-11-18 the deep pass has been red. Security run 44320960144 (seed 1253054900) failed the bounded-time property on a `character-run` input of 61,440 `>` characters: `collectPlanStructureErrors` used 4.5 s of CPU on the CI runner. It fails on a laptop too. CPU time measured on an Apple M4 Pro on 2026-11-19:

- 7,680 `>`: 38 ms for the structure check, 51 ms for `fromMarkdown` alone.
- 15,360 `>`: 115 ms and 60 ms.
- 30,720 `>`: 252 ms and 289 ms.
- 61,440 `>`: 3,395 ms for the structure check.

A run of `>` is one blockquote per character, each nested in the previous one. Most of the time goes to the Markdown parser building that nesting, before phax's own code reads the tree. Deeply nested lists over 60 KiB sit close to the bound too: about 2 s of CPU per call on a slow runner. #246 lowered the unit tier's run count for this property but did not change the bound, the inputs or the deep pass.

Real plans nest very little. In docs/plans/, archive included, no line nests one blockquote inside another, and the deepest list item is indented 10 columns, about 6 levels.

Ground read:

- `src/domain/plan/parsePlanMarkdown.ts` — walkPlan builds the mdast tree with fromMarkdown and is shared by collectPlanStructureErrors, readPlanDeterministic and extractPlanDeterministic. readPlanTestStrategies calls fromMarkdown separately.
- `src/domain/plan/phaseHeader.ts` — readPhaseHeaders parses the plan body again with fromMarkdown.
- `src/domain/plan/sections.ts` — locatePlanSections, phaseHeadingIds and phaseHeadingSources each parse the body again with fromMarkdown.
- `src/app/loadOrExtractPlan.ts` — phax run refuses a departing test line and an unplannable path before the cache and any model call. Any other deterministic failure falls back to the model extraction.
- `src/app/lintPlan.ts` — plans lint reads the same plan through structureFindings, sequenceGapFindings, readPhaseHeaders, readPlanTestStrategies, readPlanDeterministic and finalize: one fromMarkdown parse per reader.
- `src/domain/plan/lintRender.ts` — The lint text layout: severity, check and phase columns, with '-' for a plan-level finding.
- `src/app/planOverview.ts` — plans overview prints '<plan>: the plan does not parse — run phax plans lint <plan>' on any deterministic failure.
- `src/app/estimatePlan.ts` — plans estimate reads the plan through readPlanDeterministic.
- `tests/unit/property/planParser.property.test.ts` — TIME_BOUND_MS = 2000, fastest-of-three CPU timing, BOUNDED_TIME_RUNS = 40, the four timed calls.
- `tests/helpers/property/planText.ts` — The 64 KiB cap and the large fragments: character-run (up to 20,000 of one character, '>' among them), nested-lists (up to 2,000 deep), nested-quotes (up to 3,000 deep), nested-inline capped at 400.
- `docs/property-tests.md` — The 2-second bound section, the default budget (40 runs for this property), the deep pass, and where a parser counter-example's hand-written case goes.
- `docs/specs/archive/2611131320-property-tests.md` — §5.9 bounded time (any text up to 64 KiB within 2 s), §5.18 the run counts, the deep pass in security.yml.
- `docs/specs/archive/2609080848-plan-lint.md` — How a structure error is reported: an error finding on the structure check, with a non-zero exit.
- `docs/plans/` — Grepped every plan, archive included. No line nests one blockquote inside another, and the deepest list item is indented 10 columns (about 6 levels).

## 2. Problem

Reading time grows faster than the plan grows: doubling a run of `>` from 30,720 to 61,440 characters multiplies the parse time by more than ten. One plan file of under 64 KiB can therefore make any command that reads it take seconds of CPU per parse. Commands parse a plan several times, so `phax plans lint` on such a plan spends tens of seconds and then reports three generic structure errors ("missing top-level heading", …) that do not say what is actually wrong. `phax run` spends the same time, then falls back to a model extraction of a plan phax itself could not read. `phax plans overview` says only that the plan does not parse.

The plan comes from the operator's own repository, so this is not a way in. But a plan written by a headless planner or pasted from elsewhere can carry such nesting by accident, and a command that takes seconds to refuse a plan is a bad answer. The property that should guard against this, the 2-second bound, is red in the deep pass for a real defect. While it stays red, a new counter-example in the same property goes unnoticed.

## 3. Product goal

Reading a plan takes time linear in its size, whatever its blockquotes and lists nest. A plan nested deeper than any real plan reaches is refused before phax parses it, with a message that names the first offending line and the limit. Every command that reads a plan applies the same refusal in the same way. A plan that reads today reads exactly the same afterwards. The bounded-time property keeps its 2-second bound and its large inputs, and goes green in the deep pass.

> phax never hands the Markdown parser a plan whose nesting it has not bounded, and it says which line crossed the bound.

## 4. Terminology

- **nesting depth (of a line)** — The number of blockquotes and list items that hold the line, as CommonMark reads it. A run of n `>` characters opens n blockquotes. A list item inside another list item adds one level. Emphasis and other inline markup add nothing.
- **nesting limit** — The greatest nesting depth phax reads: 32. A plan with any line deeper than that is over the limit.
- **plan reader** — Any reading of a plan's Markdown structure by phax: the structure check, the deterministic extraction, the phase-header reading, the test-strategy reading, section location and finalize. Commands that use them: phax run, plans lint, plans overview, plans estimate.
- **nesting refusal** — phax's answer to a plan over the nesting limit. It names the first line over the limit and the limit, and phax gives it without parsing the plan.
- **CPU time** — User plus system time of the process, as `process.cpuUsage()` reports it. Never wall-clock time.
- **deep pass** — The daily `property-tests` job of the Security workflow: 2,000 inputs per property from a fresh seed.

## 5. Functional requirements

### 5.1 Plans over the nesting limit are refused before parsing

IF any line of a plan has a nesting depth over 32 THEN the system SHALL refuse the plan without parsing its Markdown.

### 5.2 The refusal names the line and the limit

WHEN the system gives a nesting refusal THE system SHALL name the first line of the plan body over the limit, by its line number, and the limit of 32.

### 5.3 Every plan reader applies the limit

The system shall apply the nesting limit to every plan reader, so that no command parses the Markdown of a plan over the limit.

### 5.4 Bounded reading time

The system shall answer every plan reader call on any text of at most 64 KiB within 2 seconds of CPU time, whatever the text's blockquotes and lists nest.

### 5.5 phax run refuses before the model and any write

IF the plan given to phax run is over the nesting limit THEN the system SHALL refuse the run before reading or writing the extraction cache, before any model call and before writing any run state.

### 5.6 plans lint reports the nesting as a structure error

WHEN phax plans lint reads a plan over the nesting limit THE system SHALL report one error finding on the structure check, with no phase, whose message names the line and the limit, and SHALL exit non-zero.

### 5.7 plans lint reports nothing that needs the parsed plan

WHEN phax plans lint reads a plan over the nesting limit THE system SHALL report no finding from a check that reads the plan's Markdown structure other than the nesting finding.

### 5.8 Other plan commands name the nesting

WHEN phax plans overview or phax plans estimate reads a plan over the nesting limit THE system SHALL fail with a message that names the line and the limit and points to phax plans lint.

### 5.9 Plans within the limit read as before

The system shall read every plan within the nesting limit exactly as it reads it today: the same plan, structure errors, findings and sections.

## 6. Surface

### cli: phax plans lint — indicative

Summary: A plan whose blockquotes or lists nest over 32 levels gets one structure error naming the line and the limit, without the long wait.

before:

    $ phax plans lint deep-plan.md        # tens of seconds of CPU
    deep-plan.md: 3 errors, 0 warnings
    error    structure    -         missing top-level "# " heading for run title
    error    structure    -         missing "## Required commands" section
    error    structure    -         no phase headings found
    $? = 1

after:

    $ phax plans lint deep-plan.md
    deep-plan.md: 1 error, 0 warnings
    error    structure    -         line 1: blockquotes and lists nest over 32 levels deep
    $? = 1

### cli: phax plans lint --json — normative

Summary: Scripts reading the lint report see the nesting refusal as an ordinary structure finding with no phase.

before:

    "findings": [
      { "severity": "error", "check": "structure", "phase": null,
        "message": "missing top-level \"# \" heading for run title" },
      …
    ]

after:

    "findings": [
      { "severity": "error", "check": "structure", "phase": null,
        "message": "line 1: blockquotes and lists nest over 32 levels deep" }
    ]

### cli: phax run — indicative

Summary: phax run refuses a plan nested over 32 levels at once, naming the line, instead of parsing for seconds and falling back to a model extraction.

before:

    $ phax run deep-plan.md
    warning: Deterministic extraction failed (missing top-level "# " heading for run title); fell back to LLM.
    …

after:

    $ phax run deep-plan.md
    ✗ deep-plan.md: line 1: blockquotes and lists nest over 32 levels deep — run phax plans lint deep-plan.md
    $? ≠ 0

### cli: phax plans overview — indicative

Summary: The overview of a plan nested over 32 levels says which line is too deep, not just that the plan does not parse.

before:

    $ phax plans overview deep-plan.md
    deep-plan.md: the plan does not parse — run phax plans lint deep-plan.md

after:

    $ phax plans overview deep-plan.md
    deep-plan.md: line 1: blockquotes and lists nest over 32 levels deep — run phax plans lint deep-plan.md

### internal: the plan-parser suite's deep-pass counter-example — indicative

Summary: The plan-parser tests keep the deep pass's 61,440 `>` counter-example and a nested list over 60 KiB as hand-written cases, so the bound is checked on every pull request.

    Property failed (seed 1253054900), origin: large: character-run
    collectPlanStructureErrors used over 2000 ms of CPU on 61440 bytes

    → hand-written case: ">".repeat(61_440) is refused with
      "line 1: blockquotes and lists nest over 32 levels deep",
      by every plan reader, within the 2-second CPU bound

## 7. Non-goals

- Emphasis and other inline nesting. The parser's cost on deeply nested emphasis grows with the square of the delimiters, and the `nested-inline` fragment stays capped at 400 levels. That known gap is left for its own spec.
- Markdown readers outside plan reading: specs, briefs, §9 questions, release notes.
- Replacing the Markdown parser, changing its configuration, or forking it.
- Changing the bounded-time property's 2-second bound, its 64 KiB cap, its fragments or their caps, or the deep pass's schedule and run count.
- Treating a plan as untrusted input beyond its reading time: no sandboxing, no limits on other resources.
- A persisted-format change: no file phax writes gains or loses a field.
- Reporting the nesting cost to micromark: the guard settles phax's case, and no upstream issue is opened. If phax's other Markdown readers meet the nesting cost, that is the moment to look upstream.

## 8. Acceptance criteria

### The deep-pass counter-example is a structure error

Given a loose plan.md whose body is 61,440 `>` characters, as in the character-run counter-example of seed 1253054900, when `phax plans lint --json` runs on it, then the findings are exactly one `{ "severity": "error", "check": "structure", "phase": null, "message": "line 1: blockquotes and lists nest over 32 levels deep" }`, and the command exits non-zero. (refs §5.1, §5.2, §5.6)

### No parse-based finding beside the nesting

Given a plan with a valid preamble and phases whose 40th line holds a list nested 40 levels deep, when `phax plans lint --json` runs on it, then the report holds the nesting finding naming line 40 and no other finding from the structure, interactive, acceptance or tests checks. (refs §5.7, §5.2)

### The limit is inclusive

Given two plans that are otherwise the same and valid, one whose deepest line is a list item 32 levels deep, the other 33 levels deep on line 12, when `phax plans lint` runs on each, then the first has no nesting finding and reads as it does today, and the second has the single nesting finding naming line 12. (refs §5.1, §5.2)

### phax run refuses without the model

Given a plan over the nesting limit and a fake provider that records every spawn, when `phax run` runs on it, then it exits non-zero with a message naming the line, the limit and `phax plans lint`, no provider is spawned, the extraction cache is neither read nor written, and no run state is written. (refs §5.5, §5.2, §5.3)

### Overview and estimate name the nesting

Given a plan over the nesting limit, when `phax plans overview` and `phax plans estimate` each run on it, then each fails with a message that names the line and the limit and points to `phax plans lint`. (refs §5.8, §5.3)

### Every reader answers the counter-examples in bounded time

Given the 61,440 `>` text and a nested list of over 60 KiB, when each plan reader is called on each text, then each answers (a refusal, structure errors or a failed section location) within 2,000 ms of CPU time, fastest of three, and none parses the Markdown. (refs §5.3, §5.4)

### The deep pass goes green on the failing seed

Given the bounded-time property with its 2-second bound, its 64 KiB cap and its fragments unchanged, when it runs with PHAX_PROPERTY_SEED=1253054900 and PHAX_PROPERTY_RUNS=2000, then it passes. (refs §5.4)

### Every committed plan reads as before

Given every plan under docs/plans/, archive included, when each plan reader reads it with the limit and without it, then no plan gets a nesting refusal, every reading is the same with and without the limit, and the test reports the deepest nesting depth found in the corpus, which is well under 32. (refs §5.9)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-where — Where is the bound enforced?

- guard — A depth check before parsing, refusing a plan over the limit with a structure error naming the line — abandons: Plans deeper than the limit, which no human writes but a fuzzer or a broken generator does, are refused instead of read
- linear-parser — Make the parse linear by construction: another micromark configuration, or a pre-pass that flattens nesting phax never reads — abandons: Leaving every plan reading untouched: the change runs on every plan, and a flattening pass shifts the source offsets that verbatim slices (commit body, sections) rely on
- upstream-only — Get the nesting cost fixed in micromark and pin the release that has it — abandons: Control over the timing: the deep pass stays red, and every reader stays slow, until a release phax does not control ships

Recommendation: guard — The guard's loss is plans no real plan resembles: the corpus nests about 6 levels deep against a limit of 32. Leaving every plan's reading untouched, which the linear-parser option gives up, is what lets this spec promise r-unchanged. Losing control over timing, as upstream-only does, keeps a real defect live in the deep pass.

Decision: guard — by operator (Rémy Loubradou), 2026-11-22
Why: The guard's loss is plans no real plan resembles: the corpus nests about 6 levels deep against a limit of 32. Leaving every plan's reading untouched, which the linear-parser option gives up, is what lets this spec promise r-unchanged. Losing control over timing, as upstream-only does, keeps a real defect live in the deep pass. Advocate: A parse linear by construction would fix the cost for every plan and every reader at the root, with no refusal and no arbitrary limit to defend. Principles: S1. Reversibility: costly. Revised: none.

### q-limit — What nesting limit?

- limit-16 — 16 levels — abandons: Margin: a little over twice the deepest committed plan, so a legitimately deep outline from a generator could be refused
- limit-32 — 32 levels — abandons: The tightest bound on per-line container work. A 64 KiB plan at 32 levels must still fit the 2-second bound, which the property has to show
- limit-64 — 64 levels — abandons: Headroom under the time bound: nested-list inputs near 64 KiB at that depth sit closer to the slow-runner timings that motivated this spec

Recommendation: limit-32 — Five times the deepest committed plan is a margin no hand-written plan reaches. The bounded-time property checks the cost of a near-cap input at 32 levels on every run, so the loss is measured, not assumed.

Decision: limit-32 — by operator (Rémy Loubradou), 2026-11-22
Why: Five times the deepest committed plan is a margin no hand-written plan reaches. The bounded-time property checks the cost of a near-cap input at 32 levels on every run, so the loss is measured, not assumed. Advocate: 16 levels is still more than twice the deepest committed plan and gives the tightest time bound, with the most headroom under the 2-second limit on a slow runner. Principles: S1. Reversibility: cheap. Revised: none.

### q-size — Should a maximum plan size be enforced alongside the depth limit?

- depth-only — Depth limit only — abandons: An absolute ceiling on reading time: a very large plan within the depth limit still costs time in proportion to its size, beyond what the 64 KiB property proves
- depth-and-size — Depth limit plus a maximum size — abandons: Large legitimate plans, some of which are long and were never measured against a size cap, at the risk of refusing a plan that reads today

Recommendation: depth-only — Once depth is bounded, the cost is linear in size, which is the goal. A size cap would add a second refusal no committed plan has been measured against, and it could break r-unchanged.

Decision: depth-only — by operator (Rémy Loubradou), 2026-11-22
Why: Once depth is bounded, the cost is linear in size, which is the goal. A size cap would add a second refusal no committed plan has been measured against, and it could break r-unchanged. Advocate: A size cap gives an absolute ceiling on reading time, so no plan, however large, can take longer than the bound the property proves. Principles: S1. Reversibility: cheap. Revised: none.

### q-configurable — Is the nesting limit configurable?

- constant — A constant in phax, not configurable — abandons: An escape hatch for a project whose plans genuinely nest deeper than 32 levels
- config-key — A phax.json key with 32 as the default — abandons: A single bound the property can prove: a raised value puts the time bound back in the operator's hands, and adds a config surface to validate

Recommendation: constant — No real plan comes near the limit. A configurable limit would leave the bounded-time property proving only the default.

Decision: constant — by operator (Rémy Loubradou), 2026-11-22
Why: No real plan comes near the limit. A configurable limit would leave the bounded-time property proving only the default. Advocate: A phax.json key gives a project with genuinely deep plans an escape hatch, instead of leaving it with a refusal it cannot lift. Principles: S1. Reversibility: cheap. Revised: none.

### q-upstream — Should the nesting cost be reported to micromark?

- report — Open an upstream issue with a minimal reproduction (a run of `>` and its CPU timings), whatever phax does locally — abandons: A little maintainer time, plus a public description of a slowdown in a dependency phax ships
- no-report — Fix it locally only — abandons: A chance that the parser fixes it for every user, including phax's other Markdown readers that this spec leaves out

Recommendation: report — The reproduction costs nothing extra: the deep-pass counter-example is already minimal. Reporting does not block the guard, and the slowdown is a cost, not a way in.

Decision: no-report — by operator (Rémy Loubradou), 2026-11-22
Why: Not worth the time: the guard settles phax's case, and an upstream issue is a thread to follow for no gain to phax. If phax's other Markdown readers ever meet the nesting cost, that is the moment to look upstream. Advocate: The reproduction already exists and is minimal, so an issue costs almost nothing and might get the nesting cost fixed for every user of the parser, including phax's other Markdown readers. Principles: E0. Reversibility: cheap. Revised: nonGoals.

### q-runs — Once the guard lands, does the bounded-time property go back to 100 inputs on pull requests?

- keep-40 — Keep BOUNDED_TIME_RUNS at 40 — abandons: 60 extra inputs searched on every pull request
- restore-100 — Restore the harness default of 100 — abandons: Confidence that the property stays inside the unit tier's 30-second timeout on a loaded runner: repeated-plan and mutated-plans inputs near 64 KiB still cost real time

Recommendation: keep-40 — The run count is a CI budget decision, measured on CI runs, and this spec's non-goals leave the budget as it is. The deep pass still checks 2,000 inputs a day.

Decision: keep-40 — by operator (Rémy Loubradou), 2026-11-22
Why: The run count is a CI budget decision, measured on CI runs, and this spec's non-goals leave the budget as it is. The deep pass still checks 2,000 inputs a day. Advocate: With the slow inputs refused by the guard, 100 runs would search 60 more inputs on every pull request and catch a regression a day sooner than the deep pass. Principles: S1. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- The nesting limit is 32 levels of blockquotes and list items combined, a constant (pending q-limit and q-configurable).
- The refusal comes before any Markdown parse, in every plan reader, and the messages read 'line <n>: blockquotes and lists nest over 32 levels deep'. The JSON finding is normative.
- phax run refuses a plan over the limit as it refuses a departing test line today: before the extraction cache and before any model call, with no fallback to the model extraction.
- plans lint reports the nesting as a single error on the structure check, with phase null, and runs no other check that reads the Markdown structure.
- The bounded-time property keeps TIME_BOUND_MS = 2000, the 64 KiB cap, CPU timing with fastest of three, and its fragments and caps.
- Following docs/property-tests.md, the counter-example becomes a hand-written case in the parser's unit suite in the same commit as the fix.

Left open:

- How the depth is measured before parsing. The measure may over-count CommonMark's depth, for example by counting `>` inside a fenced code block, but must never under-count. An under-count shows up as a property failure. An over-count on a real plan shows up in the corpus check.
- Where the check sits, so that the readers listed in the terminology share it instead of each re-implementing it.
- Whether plans lint still runs the checks that do not parse the Markdown (artifact validation, lineage) beside the nesting finding.
- How section location (whose failure today is a list of missing phase ids) answers a plan over the limit.

Constraints:

- No test measures wall-clock time: CPU time, as the property does, or counted work.
- The depth check's own work is linear in the plan's size and stops at the first line over the limit.
- Every refusal follows phax's refusal model and comes before any write.
- The corpus check reads every plan under docs/plans/, archive included, and is a test, not a one-off measurement.
- No persisted format changes.
- docs/property-tests.md's 'The 2-second bound' section is updated to describe the limit and the cleared deep-pass failure.

## 11. Docs page

Page: docs/property-tests.md, section 'The 2-second bound'

Reader: A contributor whose deep pass failed the bounded-time property, or who meets a nesting refusal on a generated plan and wants to know why the limit exists and what it costs.

Example: $ phax plans lint deep-plan.md
deep-plan.md: 1 error, 0 warnings
error    structure    -         line 1: blockquotes and lists nest over 32 levels deep
$? = 1

## 12. Decision log

- 2026-11-22 q-where decided guard — operator (Rémy Loubradou)
- 2026-11-22 q-limit decided limit-32 — operator (Rémy Loubradou)
- 2026-11-22 q-size decided depth-only — operator (Rémy Loubradou)
- 2026-11-22 q-configurable decided constant — operator (Rémy Loubradou)
- 2026-11-22 q-upstream decided no-report — operator (Rémy Loubradou) — revised 1 section
- 2026-11-22 q-runs decided keep-40 — operator (Rémy Loubradou)
