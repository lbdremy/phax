Write the phax spec "Acceptance tests, not oracles". It renames phax's "oracle phases" to acceptance tests, keeps "oracle" for its established meaning only, and adds one test technique. phax is not at 1.0: breaking these names is intended.

**Why.** In testing literature an oracle is the mechanism that decides whether a test passes. Barr, Harman, McMinn, Shahbaz and Yoo, *The Oracle Problem in Software Testing: A Survey* (IEEE TSE, 2015), class them as specified, derived, implicit or human. Every test has one, so "oracle phase" does not say what the phase does.

What phax calls an oracle phase is something else. One phase writes failing tests from the spec's acceptance criteria, behind an expected-failure marker, and a later phase makes them pass without editing them. That is acceptance test-driven development:
- Koskela, *Test Driven*, 2007;
- Pugh, *Lean-Agile Acceptance Test-Driven Development*, 2010;
- Adzic, *Specification by Example*, 2011;
- the outer loop of Freeman and Pryce, *Growing Object-Oriented Software, Guided by Tests*, 2009.

"Test-first" was rejected because readers would take it for TDD: the same author, at unit level, in one loop. Here the test's author is a separate phase and the source is the spec.

The word now carries two meanings in one test line, `<guarantee> — <size> · <technique> · <oracle> · <oracle | in-phase>`. The fourth field is a real oracle; the fifth is the loop. The `phax-review` skill's `wrong-oracle` escape already uses the right meaning.

**Settled by the operator on 2026-10-27 (do not reopen):**
1. **"Acceptance" everywhere, never "test-first".** A phase that writes failing tests is an *acceptance phase*. Its tests are *acceptance tests*, in *acceptance test files*. The later phase *passes* them; "discharge" goes, and "pass" replaces it everywhere: verbs, nouns and verdicts.
2. **"Oracle" keeps its literature meaning only.** It stays in the test line's fourth field (what judges the result), in the review skill's `wrong-oracle` escape, and in prose about a test's oracle. Every other use is renamed.
3. **The test line's loop becomes `acceptance | in-phase`.** An example of the new line:
   ```
   - every (state, transition) pair is accepted or refused as the table says — small · table · transition table · acceptance · AC-3
   ```
4. **A new technique, `boundary`.** It covers equivalence partitions and boundary values: empty, limits, just outside a limit. It joins the closed technique list after `example`.
5. **The `phax-planning` skill is rewritten to match:**
   - its "Oracle phases" section becomes "Acceptance phases";
   - the "Oracle candidate" column of the defaults table becomes "Acceptance candidate";
   - the rules use the new names;
   - it says that "acceptance" names the test's *purpose*, checking a specified acceptance criterion, not its *size*: an acceptance test may be `small`, since size is its own field;
   - it describes `boundary`.

   The plan's runs will need `--allow-skill-edits`.
6. **No back-compat shims.** An old name in a file a person writes is refused, naming the new one: the plan header lines, the `phax.json` provider key and the `--hold` selection. Live plan sidecars are lifted by `phax artifact migrate-documents`. Archived plans and specs stay readable as they are. Records already written stay readable, the way phax reads older record shapes today. Runs in flight are refused by `phax resume`, as in 0.28.0. `docs/upgrading.md` gets a 0.29.0 entry.

**What exists (inventory every use; do not miss one):**
- **Plan Markdown:** `**Oracle phase:** yes | discharged by phase-NN` and `**Oracle files:** …` (`src/domain/plan/oracleCheck.ts`, `phaseHeader.ts`, `parsePlanMarkdown.ts`).
- **`phax-plan.json` and the plan document:** the phase key `oracle: { dischargedBy, files } | null` (`src/schemas/phaxPlan.ts`, `planDocument.ts`, the renderers).
- **Test lines:** `TestLoopSchema` `oracle | in-phase` and the technique list (`src/schemas/testLine.ts`, `src/domain/plan/testLineCheck.ts`, `testLineGrammar.ts`), and lint's `oracles` and `tests` categories.
- **Configuration:** the `oracles` provider in `phax.json` and its overlays (`src/schemas/phaxConfig.ts`).
- **The published format `oracle-request`** (verdicts `authored`/`discharged`, keys `oraclePhase`, `oracleCommit`), and the gate's `oracle` surface in gate attributions.
- **Run and phase status:** `oracleStep`, and the `--hold oracle` selection (`src/schemas/status.ts`).
- **The phase record manifest:** the `oracle` role, `oracle | discharging` (`src/schemas/runRecord.ts`).
- **CLI:** `--skip-oracle`, the "Oracle preflight failed" message, every help text in `src/cli/cliDocs.ts`, and `phax.usage.kdl`.
- **Telemetry:** the events and spans named after oracles.
- **The prompt:** the `## Oracle role` section (`src/app/promptGeneration.ts`) and the fix prompt (`src/domain/gate/fixPrompt.ts`).
- **Docs:** README, `docs/`, the site, and the skills (`.claude/skills/phax-planning/SKILL.md` and its bundled copy, `phax-review`, `phax-decide-plan`).

**Settle in the spec's body:**
- each new identifier, in a rename table from old to new (keys, literals, format names, flags, messages, event names);
- the new published format names, with `$schema` at 0.29.0;
- what each refusal of an old name says.

Leave §9 empty unless something cannot be settled from the decisions above; two questions at most.

**Out of scope:** typing the test line's `<oracle>` field (for example with Barr's four kinds); other new techniques (golden or snapshot is an oracle, `example · the golden file`; pairwise and mutation are not wanted now); any change to how acceptance phases behave.

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.

**Note, 2026-10-31: audit, retarget to 0.33.0, four plans.** An audit against main, after releases 0.29.0 to 0.32.0, brought the spec up to date. It now:
- stamps every renamed format 0.33.0 through `next` snapshots, and adds `phax-plan-extraction`, which also carries the loop and the technique;
- freezes each format's 0.32.0-release shape, and keeps `oracle-request` readable at 0.26.0;
- keeps the strict answer schemas strict: an old name in an answer is refused by the enum, never by name;
- makes the criterion refusal `a criterion is neither 'acceptance', 'in-phase' nor 'oracle'` normative;
- covers the protected-path recovery texts;
- keeps the code review's `acceptance` and `boundary` lenses as they are;
- names the risk to this repository's `phax.json` while the installed phax drives the runs.

The operator kept the full rename in one spec, shipped as four plans:
1. persisted and published formats;
2. lint, CLI and config refusals;
3. prompts, messages and telemetry;
4. skills, docs, site and example, under `--allow-skill-edits`. Plan 4 completes the spec.
