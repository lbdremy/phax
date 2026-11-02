---
status: Draft
source-spec: docs/specs/2610271119-acceptance-tests.md
completes-spec: true
---
# Acceptance docs and skills

Last of the four plans of the spec acceptance-tests: skills, docs, site and example. Plan 1, the formats, merged as #177; plan 2, lint, CLI and config, as #178; plan 3, prompts, messages, telemetry and the source scan, as #180. After this run the four phax skills teach acceptance phases, the README and the live docs say acceptance wherever they mean phax's phase, pair, provider or step, `docs/oracle-phases.md` is `docs/acceptance-phases.md` at the site route `/guide/acceptance-phases`, the Vitest provider lives at `examples/vitest-acceptance/` and reads only an `acceptance-request`, this repository's phax.json declares it under `acceptance`, the 0.33.0 upgrading entry names every operator step, and the ac-oracle-kept scan (tests/unit/acceptanceWords.test.ts) covers the README, the live docs, the site sources, the examples and the skills. The plan covers ac-skill, ac-upgrading and ac-oracle-kept, and completes the spec.

Order, every commit green under the `standard` gate profile: phase-01 rewrites the four skills and widens the scan to `.claude/skills`. phase-02 rewrites the README prose, the live docs and the site registry, completes the upgrading entry, and widens the scan to the live docs and the site sources. phase-03, the last, renames the example with phax.json and knip.json, points the README and the docs page at the new path, and widens the scan to the README, `docs/acceptance-phases.md` and `examples/`.

This repository during the run. The installed phax 0.32.0 drives this run and reads the main checkout's phax.json (`oracles`, `node examples/vitest-oracles/main.mjs`) at run and resume; the run changes phax.json only on its branch. The plan declares no acceptance pair: 0.32.0 would send an `oracle-request` to the old example path in the phase worktree, which phase-03 renames and rewrites to read only an `acceptance-request`. So no phase carries an `**Oracle phase:**` line and every test line is `in-phase`. The phax.json and knip.json change sits in phase-03, the last phase, so that if 0.32.0 reads the worktree's phax.json at any point after a phase, only the closing steps are at risk. No phase migrates this repository's live spec and plan sidecars.

After this plan merges, the installed 0.32.0 refuses this repository's phax.json (it does not know the `acceptance` key): no `phax run` here until 0.33.0 is released and installed. Then the operator runs `phax artifact migrate-documents` on the live sidecars. Both are the operator's steps, not a phase's.

phase-01 edits `.claude/skills/` files, so the run needs `phax run --allow-skill-edits`. No interactive phase is declared: the words every phase writes are the spec's quoted strings and its §10 rename table; the operator can hold any phase with `phax run --hold`.

## Required commands

- (none)

No new command. Every phase is verified by the `standard` gate profile, whose commands phax.json already runs; the phases move files by writing the new path and deleting the old one, so no `git mv` is needed.

## Technical arbitrations

- The example's new name is `examples/vitest-acceptance/` (the spec's §10 names it). What names its path: this repository's phax.json and knip.json, the README (its Acceptance provider section and its Extend phax line), `docs/acceptance-phases.md`'s example section, the example's own README, tests/unit/exampleStamps.test.ts, the renamed integration test, and the 0.33.0 upgrading entry (as a code span naming both paths, for anyone who copied it). `phax init`, the skills and `src/` do not name it (the integration test keeps checking `src/`). NEXT_STEPS.md is the maintainer's working notes, outside the spec's scan, and is left alone. Loss accepted: a checkout elsewhere whose config points at `examples/vitest-oracles/main.mjs`, or a copy following the old path, breaks; the upgrade entry names the move. Rejected: keeping the old folder name, which gives up the spec's rename and keeps `oracle` in a path the scan reads.
- The old route `/guide/oracle-phases` is gone: no redirect and no stub page. The site build has no redirect mechanism (rspress static output, no redirect table in site/pages.ts or site/rspress.config.ts), and a stub page would be a registered page that keeps the old name alive, which §7 forbids as an alias. Release notes link into the repository at their tag (the release-notes script absolutizes links to `blob/v<release>/`), so their links keep resolving. Loss accepted: an external page or bookmark pointing at docs.phax.run/guide/oracle-phases gets a 404 once the 0.33.0 site deploys. Rejected: a redirect, which gives up the plan's scope for a new site-build feature that phax's pre-1.0 docs have never needed.
- docs/ideas/ and docs/comparisons/: prose about what judges a test keeps the word, mentions of phax's feature are renamed. Kept (literature sense): docs/ideas/headless-code-review.md's "oracle-separation" lint and "a file and its oracle"; docs/ideas/change-gates-from-the-harness.md's "oracle-separation lint" and "a file and its oracle (its test …)"; docs/ideas/artifact-decide.md's "An oracle is independent of what it …"; docs/comparisons/agentic-practices.md's quoted "The task verifier, or oracle". Renamed (phax's feature): change-gates-from-the-harness.md's declared `oracles` concept, "oracle files" and *oracle-authoring* phase become the acceptance provider, acceptance test files and an acceptance phase; agentic-practices.md's "the oracle step", "Oracle phases" link, "discharged", `--skip-oracle`, "the oracle surface" and "Oracle phases keep the tests apart" become the acceptance step, Acceptance phases, passed, `--skip-acceptance`, the acceptance surface and Acceptance phases. Loss accepted: the idea notes, which record thinking of their day, change a few words; each kept occurrence is an allowlist line pattern with the reason "prose about what judges a test".
- How the scan reads the new files. One line-based reader for every file type (Markdown, the site's TypeScript and TSX, the example's `.mjs`, `.md` and `.json`): a word is an occurrence wherever it appears, code spans and fences included. SCANNED_ROOTS becomes a list of `{ dir, extensions, exclude }`: `.claude/skills` (`.md`, phase-01); `docs` (`.md`, excluding docs/specs, docs/plans, docs/briefs and docs/releases, phase-02; docs/cli/reference.md moves from SCANNED_FILES into it); `site` (`.ts`, `.tsx`, excluding site/generated, site/doc_build and site/node_modules, phase-02); `examples` (every file, phase-03); README.md joins SCANNED_FILES in phase-03. docs/upgrading.md is read only through the end of its `### 0.33.0` entry (up to the next `### ` heading), so the entries of earlier releases are out of scope as §8 says. Two categories join KeptCategory: "0.33.0 upgrading entry" and "archived spec slug oracle-phases" (the latter added only if the scan finds the slug in a scanned file). A new entry kind `section` (a heading whose section an entry allows in full) holds the 0.33.0 entry, and the test allows a section entry only with the "0.33.0 upgrading entry" reason, as it allows whole-file entries only for frozen, reader and lift modules; a stale section entry fails like any other. Everything else is line patterns: the README's generated CLI block and the skills' `<oracle>` (test line fourth field), the README formats table's `oracle-request` row (retired oracle-request format id and exports), a sentence naming the 0.32.0 `.oracle-request.json` file (reader or lift of an earlier shape), `wrong-oracle` (wrong-oracle escape). Loss accepted: a new oracle word written into the 0.33.0 upgrading entry passes unflagged. Rejected: line patterns for that entry, which gives up a readable allowlist for some twenty patterns pinning one release's prose.
- The docs page does not narrate the rename: `docs/acceptance-phases.md` names no old name, except, if kept, one sentence saying records written by 0.32.0 and before list a `.oracle-request.json` (a reader, allowlisted). The refusals of old names are quoted only in the 0.33.0 upgrading entry. Loss accepted: a reader landing on the page with an old plan learns the new spellings from lint and the upgrading guide, not from the page.
- Phase order, each commit green: skills first (phase-01), README prose, live docs and site second (phase-02), the example with phax.json and knip.json last (phase-03). The scan widens only over files already clean: README.md and `docs/acceptance-phases.md` still name `examples/vitest-oracles/` after phase-02, so phase-02 excludes `docs/acceptance-phases.md` from the docs root and leaves README.md out, and phase-03 moves those mentions with the example and adds both files and `examples/` to the scan. The 0.33.0 upgrading entry is complete in phase-02, naming the example's new path as a code span, one commit before the folder exists. Loss accepted: between phase-02's and phase-03's commits the README and the docs page are not scanned. Rejected: pointing the README at the new path in phase-02, which gives up a README whose links resolve at every commit.
- No acceptance pair in this run, and every test line is `in-phase`: the installed 0.32.0 drives the run and would send an `oracle-request` to the old example path, which phase-03 rewrites to refuse it. Loss accepted: the skill, upgrading and scan tests are written in the phase whose text they judge, and a reviewer checks their expected strings against the spec's §5.22, §5.23, §8 and §10 quotes.

---

## phase-01 — Skills teach acceptance phases {#phase-01-acceptance-skills}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The four bundled skills that taught oracle phases (phax-planning, phax-decide-plan, phax-decide-review, phax-review) teach acceptance phases, acceptance tests, acceptance test files, passing phases and the acceptance provider; phax-planning gains the `boundary` technique and states that acceptance names a test's purpose, not its size; and the ac-oracle-kept scan reads every skill under `.claude/skills`.

### Detailed instructions

- Read the spec's §4, §5.21, §5.22, §6 `file: the phax-planning skill` and §10 rename table first (docs/specs/2610271119-acceptance-tests.md). The word oracle stays only for the test line's fourth field (`<oracle>`, the "Oracle — what judges the result" coordinate, `{ guarantee, size, technique, oracle, loop, criterion }`), the `wrong-oracle` review escape, and prose about what judges a test. The word discharge goes everywhere.
- .claude/skills/phax-planning/SKILL.md: rename `## Oracle phases` to `## Acceptance phases` and every `#oracle-phases` link to `#acceptance-phases`; `### What makes a good oracle` to `### What makes a good acceptance test`; header lines to `**Acceptance phase:** yes`, `**Acceptance phase:** passed by phase-NN` and `**Acceptance test files:** <paths>`; "oracle files" to "acceptance test files", "oracle phase" to "acceptance phase", "discharging phase"/"discharges" to "passing phase"/"passes", "oracle pair" to "acceptance pair", "oracles provider" / `oracles` key to "acceptance provider" / `acceptance` key, the lint check name `oracles` to `acceptance` (the check list reads **interactive** and **acceptance**), "oracle role" to "acceptance role". Keep every rule's meaning unchanged (§7: behaviour does not change).
- In phax-planning's Test strategy section: the line format becomes `- <guarantee> — <size> · <technique> · <oracle> · <acceptance | in-phase>[ · <acceptance criterion id>]`; the Where coordinate's loops are `acceptance` and `in-phase`; every example line ending `· oracle` or `· oracle · AC-n` ends `· acceptance` / `· acceptance · AC-n`; the technique list is exactly `example, boundary, table, property, metamorphic, stateful, fuzz, contract, smoke`, with `boundary` described as equivalence partitions and boundary values: the empty case, each limit, just outside it (and not the code review's `boundary` lens); the defaults table's last column is `Acceptance candidate`; add one sentence stating that acceptance names a test's purpose (checking a specified acceptance criterion), not its size, so an acceptance test may be `small`. Keep "Oracle — what judges the result" and the grammar's rules on the oracle field (they name the fourth field).
- In phax-planning's per-phase field table, mode/oracle rows and Headless authoring section: the phase key is `acceptance` (`acceptance: null`, or `acceptance: { passedBy: "phase-NN", files: [...] }` on an acceptance phase when the authoring prompt says an `acceptance` provider is configured), and the phase key order lists `mode`, `acceptance`. Check the names against src/schemas/planDocument.ts and src/schemas/phaxPlan.ts as built in this repository (plan 1 renamed them). Do not touch the generated `phase-model-policy` and `model-catalog` blocks.
- .claude/skills/phax-decide-plan/SKILL.md: the frontmatter description and `P3` say "Acceptance first, when the surface is shown and a provider is configured"; an `acceptance` provider; the `oracle-authoring` phase becomes an acceptance phase; "judged by the acceptance provider"; "An acceptance test is the acceptance loop, never the inner loop"; "acceptance test files"; the reference to the planning skill's "What makes a good acceptance test".
- .claude/skills/phax-decide-review/SKILL.md: `R4` becomes "Acceptance tests are not fix targets.", an oracle question becomes an acceptance-test question, "no oracle files" becomes "no acceptance test files".
- .claude/skills/phax-review/SKILL.md: "acceptance pairs", the loop (`acceptance` or `in-phase`), "from a frozen acceptance test inward", "the acceptance test when the plan froze one", "after its acceptance phase was passed", "The acceptance test failed for the wrong reason. At its acceptance phase …", "the gate, the acceptance step or the compliance review". In the `wrong-oracle` row keep the id and say a frozen acceptance test whose oracle is wrong passes the whole run, and "Review the acceptance tests first". Keep `<oracle>` in the line format and prose where oracle means what judges the code.
- Move tests/unit/planningSkillOracles.test.ts to tests/unit/planningSkillAcceptance.test.ts (write the new file, delete the old). Keep each case's scenario and assert the new strings: the `## Acceptance phases` section after the planned-files section, the provider rule naming an `acceptance` provider, the three header lines, the subset rule, marker removal as the passing phase's only change to the acceptance test files, lint exit 1 with an `acceptance` error and run/resume exit 11, and the decide-plan P3 strings. Add: the `Acceptance candidate` column, the purpose-not-size sentence with `small`, the `boundary` description and its place directly after `example` in the technique list, the loop `acceptance | in-phase`; decide-review's `R4` "Acceptance tests are not fix targets"; phax-review keeps `wrong-oracle`.
- In the same new test file, add ac-skill's install check: run `installSkill` (src/app/skills/installSkill.ts) for `phax-planning`, target `claude`, project scope, into a fresh temporary project directory with `bundleRoot` the repository root and `homeDir` another temporary directory, provided with `NodeFileSystemLayer` (src/infra/fs.js); read the installed SKILL.md and assert it is byte-identical to .claude/skills/phax-planning/SKILL.md and holds `## Acceptance phases`. Never read a real HOME.
- tests/unit/skills.test.ts: the expected line becomes `- <guarantee> — <size> · <technique> · <oracle> · <acceptance | in-phase>[ · <acceptance criterion id>]`; delete the workaround that rewrites ` · oracle` to ` · acceptance` before reading the skill's example lines (read them as written, departures empty); the section test reads `### What makes a good acceptance test` and its rewritten sentences ("**Not every test is an acceptance test.**" or the wording you write). Keep the `wrong-oracle` blind-spot case.
- tests/unit/acceptanceWords.test.ts: replace `SCANNED_ROOTS: string[]` with a list of `{ dir, extensions, exclude }` (exclude a list of repo-relative prefixes, empty here), keep `src` and `packages/schemas/src` as `.ts` roots, and add `.claude/skills` with `.md`. Update the top comment (phase-02 and phase-03 widen it further) and the first `it` to expect `.claude/skills/phax-planning/SKILL.md` and `.claude/skills/phax-review/SKILL.md` among the scanned files. Add line-pattern entries for every kept occurrence in the skills, each spanning only the word it allows, each with one §5.21 reason: `<oracle>` and the `oracle` in `{ guarantee, size, technique, oracle, loop, criterion }` (test line fourth field), "Oracle — what judges the result" and the oracle-field grammar (test line fourth field), `wrong-oracle` in phax-review (wrong-oracle escape), and each sentence about what judges a test (prose about what judges a test). Every pattern must allow something, or the stale-entry test fails.
- Run `grep -niE 'oracle|discharg' .claude/skills/*/SKILL.md` at the end: every hit must be an allowlisted kept sense.

### Planned files to create

- `tests/unit/planningSkillAcceptance.test.ts`

### Planned files to edit

- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-decide-plan/SKILL.md`
- `.claude/skills/phax-decide-review/SKILL.md`
- `.claude/skills/phax-review/SKILL.md`
- `tests/unit/planningSkillOracles.test.ts`
- `tests/unit/skills.test.ts`
- `tests/unit/acceptanceWords.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

The skills are a product surface: `phax skills install` copies `.claude/skills/<name>/SKILL.md` verbatim (src/domain/skills/catalog.ts, package.json `files`), and resolveDoctrine reads the decide skills into decide prompts. The consumer is a planning or review agent; the contract is that the skill's names match the plan-document schema and lint as built in this repository (`acceptance` key with `passedBy`, loop `acceptance`, `**Acceptance phase:**` lines, the `acceptance` lint check).

### Test strategy

- the phax-planning skill holds `## Acceptance phases`, the `Acceptance candidate` column, the purpose-not-size statement, `boundary` directly after `example`, and the loop `acceptance | in-phase` — small · example · the spec's §5.22 and §10 strings · in-phase · ac-skill
- the phax-planning skill `installSkill` writes into a temporary project is byte-identical to the copy under `.claude/skills/` — medium · example · the repository's .claude/skills/phax-planning/SKILL.md bytes · in-phase · ac-skill
- every test line the planning skill shows reads as written with no departure — small · example · readTestStrategyText's empty departures · in-phase · ac-skill
- the decide-plan, decide-review and review skills say Acceptance first, Acceptance tests are not fix targets and acceptance pairs, and keep `wrong-oracle` — small · example · the spec's §10 docs-and-skills row · in-phase · ac-skill
- the skills hold oracle only in an allowlisted kept sense, and every allowlist pattern stays live — small · table · the allowlist and its §5.21 reasons · in-phase · ac-oracle-kept

### Implementation order

1. phax-planning SKILL.md (sections, header lines, test-line grammar, boundary, purpose-not-size, headless keys)
2. phax-decide-plan, phax-decide-review and phax-review SKILL.md
3. tests/unit/planningSkillAcceptance.test.ts (moved from planningSkillOracles) with the install check, and tests/unit/skills.test.ts
4. tests/unit/acceptanceWords.test.ts: roots with extensions, `.claude/skills`, the skills' allowlist entries

### Excluded scope

- Any skill other than the four named (none of the others says oracle).
- README, docs pages, the site and the upgrading entry (phase-02).
- examples/vitest-oracles, phax.json and knip.json (phase-03).
- Any change to src/ or to how acceptance pairs behave.
- Migrating this repository's live spec and plan sidecars (the operator, after 0.33.0 is installed).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The headings and anchors the skill now has (`## Acceptance phases`, `### What makes a good acceptance test`), the exact purpose-not-size and `boundary` sentences, the new shape of SCANNED_ROOTS in tests/unit/acceptanceWords.test.ts (field names and how `exclude` is matched) so phase-02 and phase-03 can add roots, every allowlist entry added with its id and reason, and any deviation from the planned file lists with the reason.

### Commit subject

`docs(skills): teach acceptance phases in the four phax skills`

### Commit body

phax-planning, phax-decide-plan, phax-decide-review and phax-review now say acceptance phase, acceptance test, acceptance test files, passing phase and acceptance provider. phax-planning gains the boundary technique, the Acceptance candidate column and the loop acceptance | in-phase, and states that acceptance names a test's purpose, not its size. oracle stays for the test line's fourth field, the wrong-oracle escape and prose about what judges a test.

The skill tests move to planningSkillAcceptance.test.ts, which also checks that the installed skill is the repository's copy, and the acceptance-words scan now reads every skill. Covers ac-skill.

---

## phase-02 — README, live docs and site say acceptance {#phase-02-acceptance-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A judgment-heavy sweep across the README, six docs pages, the site registry and the scan's new range and section mechanics, where each mention must be classified as phax's feature or the literature sense and the docs' quoted outputs must match what the code now prints: more than the default effort reliably carries in one commit.

The README's prose, the live docs and the docs site say acceptance wherever they mean phax's phase, pair, provider, step or request: `docs/oracle-phases.md` becomes `docs/acceptance-phases.md` at `/guide/acceptance-phases`, titled "Acceptance phases"; the 0.33.0 upgrading entry names every operator step; and the ac-oracle-kept scan reads the live docs and the site sources.

### Detailed instructions

- Read the spec's §5.20, §5.21, §5.23, §6 (every surface's after), §10 rename table and §11 first. Use only the new names; keep oracle only for the test line's fourth field, `wrong-oracle`, and prose about what judges a test (see the preamble's Technical arbitrations for the docs/ideas and docs/comparisons split).
- Move docs/oracle-phases.md to docs/acceptance-phases.md (write the new file, delete the old). Title `# Acceptance phases`. Rewrite it with the new names: the `acceptance` key in phax.json, phax.local.json or ~/.phax/config.json with the example command `node scripts/acceptance-verdicts.mjs` (spec §11); "Acceptance preflight failed"; the `acceptance-request` stamped `https://docs.phax.run/schemas/acceptance-request/0.33.0.json`, verdicts `authored` and `passed`, keys `phase`, `acceptancePhase`, `base`, `files`, plus `acceptanceCommit`; the saved `checks-attempt-NN.acceptance-request.json`; the `acceptance` surface; finding ids `acceptance-changed:…` etc. (phase-03 renames the example's ids to `acceptance-unmarked`, `acceptance-not-run`, `acceptance-marker-left`, `acceptance-changed`, `acceptance-unparsable`); the plan example with `**Acceptance phase:** yes` / `passed by phase-NN` and `**Acceptance test files:**` and a test line in the `acceptance` loop (§11: `- publishing refuses a red gate — medium · example · the refusal naming the gate · acceptance · AC-1` or the refunds equivalent); `--skip-acceptance`; `phax run --hold acceptance`; `## Acceptance pairs` in the review handoff; the records-explain acceptance role. Rename the headings, e.g. `## Write an acceptance-first plan`, `## When an acceptance test cannot pass`, `## Reviewing acceptance tests before they are passed`. Leave the example section's path `examples/vitest-oracles/` and `node examples/vitest-oracles/main.mjs` as they are: phase-03 moves them with the folder. Narrate no rename; the only old name the page may keep is a sentence saying records written by 0.32.0 and before list a `.oracle-request.json`.
- README.md, outside the generated CLI block (between `<!-- BEGIN GENERATED CLI REFERENCE -->` and its END marker, untouched): the plans lint paragraph (an acceptance phase runs with a configured `acceptance` provider; an acceptance-loop line off an acceptance phase); the plans overview paragraph (the acceptance pair); the interactive phases paragraph (an acceptance pair linking `docs/acceptance-phases.md`, takes no acceptance role); `--hold acceptance  # the acceptance phases` and "the acceptance tests of a pair"; `#### Reviews inside an acceptance pair` with its link to the new page's review heading anchor, `--hold acceptance`, the acceptance provider, `passed`, `--skip-acceptance`; `### Acceptance provider` with `{ "acceptance": { "command": "node scripts/acceptance-verdicts.mjs" } }` and its paragraph in the new names (`acceptance-request`, `authored`/`passed`, `checks-attempt-NN.acceptance-request.json`, the `acceptance` error, `--skip-acceptance`, `acceptance` among verified surfaces, a link to Acceptance phases). In that paragraph and in the Extend phax line ending "whose example is …", keep the path `examples/vitest-oracles/` and the command `node examples/vitest-oracles/main.mjs` for phase-03, but say "the acceptance provider". Keep the formats table's `oracle-request` row (a retired read-only format). Update every in-README link whose anchor changes.
- docs/plan-overview.md: rewrite the example output and the prose with the strings src/domain/plan/overviewRender.ts and src/domain/plan/overview.ts now produce: the phase title e.g. "Acceptance tests for the export", `acceptance role  acceptance phase, passed by phase-02`, `acceptance role   passes phase-01`, test lines ending `· acceptance · ac-1`, coverage `phase-01 acceptance, phase-02 in-phase`, the JSON `acceptanceRole` with kinds `acceptance` (with `passedBy`), `passing` (with `acceptancePhase`) or `none`; link `acceptance-phases.md`. Keep `<oracle>` and `oracle` in `{ guarantee, size, technique, oracle, loop, criterion }` (fourth field).
- docs/comparisons/agentic-practices.md and docs/ideas/change-gates-from-the-harness.md: rename the feature mentions listed in the preamble's Technical arbitrations, link `../acceptance-phases.md`; keep the literature-sense mentions. docs/ideas/headless-code-review.md, docs/ideas/artifact-decide.md and docs/structured-answers.md keep their kept-sense mentions unchanged (edit them only if the scan finds a feature mention).
- site/pages.ts: the page entry becomes route `/guide/acceptance-phases`, title "Acceptance phases", source `docs/acceptance-phases.md`, description e.g. "Declare an acceptance provider, and write a plan whose acceptance tests are written in one phase and passed in the next."; the plan-overview entry's description says "acceptance pairs". No page keeps `/guide/oracle-phases` (no redirect, no stub). site/build/sources.ts lists `docs/acceptance-phases.md` in place of `docs/oracle-phases.md`.
- docs/upgrading.md `### 0.33.0` entry, editing only that entry: add bullets for what plan 3 and this plan change for an operator, and keep the existing ones: an acceptance provider you wrote must read an `acceptance-request` (verdict `passed`, `acceptancePhase`, `acceptanceCommit`) and refuse anything else; the Vitest example moved from `examples/vitest-oracles/` to `examples/vitest-acceptance/` (code spans, not links), reads only an `acceptance-request`, names `--skip-acceptance` in its remedy and reports `acceptance-*` finding ids; the telemetry event `oracle.edits.unjudged` is `acceptance.edits.unjudged` (console line `phax·acceptance.edits.unjudged`); `phax plans overview --json` gives `acceptanceRole` (kind `acceptance` with `passedBy`, `passing` with `acceptancePhase`, or `none`) in place of `oracleRole`, and the overview and records-explain rows say `acceptance role` / `acceptance`; the bundled skills teach acceptance phases, so rerun `phax skills install` (point to After every upgrade). Make sure the entry names every §5.23 item: `phax artifact migrate-documents`, hand-written plans' header lines and loop, the `acceptance` key in phax.json and its overlays, `--hold acceptance`, `--skip-acceptance`, the `acceptance-request`, scripts reading renamed status, record and overview names or the schemas package's renamed exports, and runs in flight. Delete the closing line "The provider steps of this release are listed here when they ship." and edit no earlier entry.
- Create tests/unit/acceptanceDocs.test.ts. ac-upgrading: slice docs/upgrading.md from `### 0.33.0` to the next `### ` heading and assert it holds `phax artifact migrate-documents`, `**Acceptance phase:**`, `**Acceptance test files:**`, the loop `acceptance`, `"acceptance"`, `phax.local.json`, `~/.phax/config.json`, `--hold acceptance`, `--skip-acceptance`, `acceptance-request`, `passed`, `acceptancePhase`, `acceptanceCommit`, `acceptanceStep`, `parseAcceptanceRequest`, `acceptanceRole`, `acceptance.edits.unjudged`, `examples/vitest-acceptance/`, `phax archive <run> --force`, and does not hold "when they ship". Site registry: the pages registry exported by site/pages.ts has a page at `/guide/acceptance-phases` titled "Acceptance phases" from `docs/acceptance-phases.md`, and no page whose route or source says oracle; site/build/sources.ts's listSources over the repository root includes `docs/acceptance-phases.md` and not `docs/oracle-phases.md`.
- tests/unit/acceptanceWords.test.ts: add the `docs` root (`.md`, exclude `docs/specs/`, `docs/plans/`, `docs/briefs/`, `docs/releases/` and, until phase-03, `docs/acceptance-phases.md`) and drop `docs/cli/reference.md` from SCANNED_FILES since the root covers it; add the `site` root (`.ts`, `.tsx`, exclude `site/generated/`, `site/doc_build/`, `site/node_modules/`). Read docs/upgrading.md only from its start through the end of its `### 0.33.0` entry (stop at the first `### ` heading after it). Add the KeptCategory values "0.33.0 upgrading entry" and "archived spec slug oracle-phases" (the latter only with an entry, if the scan finds the slug), and an entry kind with a `section` heading allowing every word inside that Markdown section; add one section entry for `### 0.33.0` in docs/upgrading.md, and a test that a section entry carries only the "0.33.0 upgrading entry" reason; extend the stale-entry test to section entries. Add line-pattern entries for the kept docs occurrences (docs/structured-answers.md's fourth field, docs/plan-overview.md's `<oracle>` and test-line keys, the docs/ideas and docs/comparisons literature mentions, docs/cli/reference.md's existing `<oracle>` entry moved as needed). Update the first `it` to expect `docs/upgrading.md`, `docs/plan-overview.md` and `site/pages.ts` among the scanned files and `docs/plans/…` files absent.
- Run `grep -rniE 'oracle|discharg' README.md docs site/pages.ts site/build` at the end: outside docs/specs, docs/plans, docs/briefs, docs/releases and the entries before 0.33.0, every hit is a kept sense, the 0.33.0 entry, the README's generated block, its formats-table row, or one of the example-path mentions phase-03 moves.

### Planned files to create

- `docs/acceptance-phases.md`
- `tests/unit/acceptanceDocs.test.ts`

### Planned files to edit

- `docs/oracle-phases.md`
- `README.md`
- `docs/plan-overview.md`
- `docs/comparisons/agentic-practices.md`
- `docs/ideas/change-gates-from-the-harness.md`
- `docs/upgrading.md`
- `site/pages.ts`
- `site/build/sources.ts`
- `tests/unit/acceptanceWords.test.ts`

### Optional files that may be edited

- `docs/ideas/headless-code-review.md`
- `docs/ideas/artifact-decide.md`
- `docs/structured-answers.md`
- `tests/unit/site/pageMap.test.ts`
- `tests/unit/site/links.test.ts`

### Boundary contracts

The site renders the files site/build/sources.ts lists at the routes site/pages.ts registers; a source with no page, or a page with no source, fails the site build, and relative links between rendered sources become site routes checked by site/build/links.ts. The rename moves the source and the route together, and every link into the page (README, plan-overview, comparisons) moves with it. The upgrading entry is read by the release-notes script at the 0.33.0 cut as that release's Upgrading section.

### Test strategy

- the 0.33.0 upgrading entry names every operator step §5.23 lists, plus the telemetry event, the overview JSON and the example's new path, and no longer defers the provider steps — small · example · the spec's §5.23 list and §8 upgrade-entry strings · in-phase · ac-upgrading
- the site registers `/guide/acceptance-phases` from docs/acceptance-phases.md titled Acceptance phases, and no route or source says oracle — small · example · site/pages.ts's registry and listSources · in-phase
- the scan reads the live docs and site sources, docs/upgrading.md only through its 0.33.0 entry, and allows a section entry only for that entry — small · example · the expected scanned set and the section-entry reason · in-phase · ac-oracle-kept
- the live docs and the site sources hold oracle or discharge only in an allowlisted kept sense, and every allowlist entry stays live — small · table · the allowlist and its §5.21 reasons · in-phase · ac-oracle-kept

### Implementation order

1. docs/acceptance-phases.md (moved and rewritten), site/pages.ts and site/build/sources.ts
2. README.md prose and its links into the new page
3. docs/plan-overview.md, docs/comparisons/agentic-practices.md, docs/ideas/change-gates-from-the-harness.md
4. docs/upgrading.md 0.33.0 entry
5. tests/unit/acceptanceDocs.test.ts, then tests/unit/acceptanceWords.test.ts (docs and site roots, upgrading range, section entry, allowlist)

### Excluded scope

- The skills (phase-01).
- The example folder, its path in README.md and docs/acceptance-phases.md, phax.json, knip.json and their tests (phase-03).
- Scanning README.md and docs/acceptance-phases.md (phase-03, once their example path moves).
- The README's generated CLI block, docs/cli/reference.md's content and src/cli/cliDocs.ts (plan 3 rewrote them).
- docs/specs/, docs/plans/, docs/briefs/, docs/releases/, the upgrading entries before 0.33.0, and NEXT_STEPS.md.
- A redirect or stub page for `/guide/oracle-phases`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The new page's headings and their anchors (in particular the review section's anchor the README links to), the site entry as written, the 0.33.0 entry's added bullets, how the scan reads docs/upgrading.md and the section entry kind (field names), the docs and site roots with their exclusions (and that `docs/acceptance-phases.md` is excluded until phase-03), every allowlist entry added with its id and reason, the exact README lines and docs lines still naming `examples/vitest-oracles/` for phase-03, and any deviation from the planned file lists with the reason.

### Commit subject

`docs: acceptance phases in the README, the live docs and the site`

### Commit body

docs/oracle-phases.md becomes docs/acceptance-phases.md, published at /guide/acceptance-phases as Acceptance phases; the old route is gone. The README, the plan-overview page, the agentic-practices comparison and the idea notes say acceptance wherever they mean phax's phase, pair, provider, step or request, and keep oracle where it means what judges a test.

The 0.33.0 upgrading entry now names every operator step: the provider's acceptance-request, the moved Vitest example, the acceptance.edits.unjudged telemetry event, the overview's acceptanceRole and the skills, and drops its closing placeholder. The acceptance-words scan reads the live docs and the site sources, the upgrading guide only through its 0.33.0 entry. Covers ac-upgrading.

---

## phase-03 — Vitest acceptance example and phax.json {#phase-03-acceptance-example}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The Vitest provider lives at `examples/vitest-acceptance/`, reads only an `acceptance-request` (an `oracle-request` is refused like any unknown format) and names `--skip-acceptance` in its remedy; this repository's phax.json declares it under `acceptance` and knip.json points at it; the README and the docs page name the new path; and the ac-oracle-kept scan reads the README, `docs/acceptance-phases.md` and every example, completing the criterion.

### Detailed instructions

- This is the last phase on purpose: the installed phax 0.32.0 driving this run refuses an `acceptance` key, so phax.json changes here and nowhere earlier. Do not run any phax lifecycle command.
- Move every file of examples/vitest-oracles/ (README.md, git.mjs, main.mjs, request.mjs, syntax.mjs, verdicts.mjs) to examples/vitest-acceptance/ (write the new files, delete the old). git.mjs and syntax.mjs move unchanged unless a comment says oracle.
- request.mjs: accept only `$schema` matching `^https://docs\.phax\.run/schemas/acceptance-request/\d+\.\d+\.\d+\.json$`, refused otherwise with `does not name the acceptance-request format`; KEYS `authored: ["$schema", "verdict", "phase", "acceptancePhase", "base", "files"]` and `passed: ["$schema", "verdict", "phase", "acceptancePhase", "base", "acceptanceCommit", "files"]`; the verdict refusal `is neither "authored" nor "passed"`; the phase-id and commit checks over `acceptancePhase` and `acceptanceCommit`; FROM_PHAX "Run this provider only as phax's acceptance command, which writes a valid request."; the path remedy names acceptance test files. No branch reads an `oracle-request` or an old key.
- main.mjs: the header comment says acceptance provider and acceptance-request; `judge` checks `base` and `acceptanceCommit`, with a remedy naming the acceptance phase's commits; it calls `authoredFindings` or `passedFindings`. Keep the gate-report literal at its current stamp.
- verdicts.mjs: rule ids `acceptance-unmarked`, `acceptance-not-run`, `acceptance-marker-left`, `acceptance-changed`, `acceptance-unparsable` with their rule texts in the new names ("In the acceptance phase, every test added or modified in an acceptance test file …", "After the acceptance phase, …", "An acceptance test file parses"); `dischargedFindings` becomes `passedFindings`, reading `request.acceptanceCommit`; messages say "since the acceptance commit"; the unparsable remedy says `Correct the acceptance test in the phase's worktree, then run phax resume <run> --skip-acceptance; the fix loop cannot repair a committed acceptance test.`
- examples/vitest-acceptance/README.md: rewrite in the new names, linking `../../docs/acceptance-phases.md`, with `{ "acceptance": { "command": "node examples/vitest-acceptance/main.mjs" } }`, the shell example piping into `node examples/vitest-acceptance/main.mjs`, any `$schema` literal stamped `acceptance-request/0.33.0` (gate-report at its current stamp), and the finding ids above.
- phax.json: replace `"oracles": { "command": "node examples/vitest-oracles/main.mjs" }` with `"acceptance": { "command": "node examples/vitest-acceptance/main.mjs" }`, nothing else. knip.json: both `examples/vitest-oracles` entries become `examples/vitest-acceptance` (`main.mjs` entry and the `**/*.mjs` project glob).
- README.md: the Acceptance provider paragraph's path and command, and the Extend phax line, name `examples/vitest-acceptance/` and `node examples/vitest-acceptance/main.mjs`. docs/acceptance-phases.md: its example section names the same path and command. Fix any oracle word phase-02 left in either file outside the kept senses.
- Move tests/integration/vitestOraclesExample.test.ts to tests/integration/vitestAcceptanceExample.test.ts. mainScript is examples/vitest-acceptance/main.mjs, the temp prefix `phax-vitest-acceptance-`, describe names `examples/vitest-acceptance, …` with the `passed verdict` block. Build every request from phax's own code: `serializeAcceptanceRequest` (src/app/gates.ts) of `makeAcceptanceRequest` (src/domain/gate/acceptanceRequest.ts) with an AcceptanceRole `{ role: "acceptance" | "passing", pair: { acceptancePhase, passingPhase, files } }`; delete serializeOracleRequest. Keep every scenario and assert the new finding ids and the `--skip-acceptance` remedy. In the unreadable-requests table, the valid literal is an `acceptance-request` stamped `currentSchemaUrl("acceptance-request")` with `acceptancePhase`; the verdict case is "a verdict other than authored or passed" (use `discharged`); the extra-key case uses `acceptanceCommit`; add a case refusing an `oracle-request` 0.26.0 document (reason naming `$schema`). "accepts any X.Y.Z release of the acceptance-request format" uses `acceptance-request/9.9.9.json`. phax's own declaration: decode this repository's phax.json with `decodePhaxConfig` (src/schemas/phaxConfig.ts), expect Right, its `acceptance.command` equal to `node examples/vitest-acceptance/main.mjs`, then spawn it at HEAD with an authored request built as above and expect a checked report with no finding and exit 0; remove the plan-2 comment about reading the raw key. The outside-the-CLI checks look for `examples/vitest-acceptance` under src/ and in phax.usage.kdl.
- tests/unit/exampleStamps.test.ts: FILES list `examples/vitest-acceptance/main.mjs` and `examples/vitest-acceptance/README.md`.
- tests/unit/acceptanceWords.test.ts: drop the `docs/acceptance-phases.md` exclusion, add README.md to SCANNED_FILES and an `examples` root over every file. Add line-pattern entries for the README's kept occurrences: `<oracle>` in its generated CLI block (test line fourth field), the formats table's `oracle-request` row (retired oracle-request format id and exports), and any sentence naming the 0.32.0 `.oracle-request.json` (reader or lift of an earlier shape); and for docs/acceptance-phases.md's, if any. The examples should need none. Update the top comment to say the scan now covers the sources, the usage contract, the JSON Schemas, the README, the live docs, the site sources, the examples and the skills (ac-oracle-kept), and the first `it` to expect README.md, docs/acceptance-phases.md and examples/vitest-acceptance/main.mjs among the scanned files.
- Run `grep -rniE 'oracle|discharg' README.md docs/acceptance-phases.md examples phax.json knip.json` at the end: every hit is an allowlisted kept sense.

### Planned files to create

- `examples/vitest-acceptance/README.md`
- `examples/vitest-acceptance/git.mjs`
- `examples/vitest-acceptance/main.mjs`
- `examples/vitest-acceptance/request.mjs`
- `examples/vitest-acceptance/syntax.mjs`
- `examples/vitest-acceptance/verdicts.mjs`
- `tests/integration/vitestAcceptanceExample.test.ts`

### Planned files to edit

- `examples/vitest-oracles/README.md`
- `examples/vitest-oracles/git.mjs`
- `examples/vitest-oracles/main.mjs`
- `examples/vitest-oracles/request.mjs`
- `examples/vitest-oracles/syntax.mjs`
- `examples/vitest-oracles/verdicts.mjs`
- `tests/integration/vitestOraclesExample.test.ts`
- `phax.json`
- `knip.json`
- `README.md`
- `docs/acceptance-phases.md`
- `tests/unit/exampleStamps.test.ts`
- `tests/unit/acceptanceWords.test.ts`

### Optional files that may be edited

- `docs/upgrading.md`

### Boundary contracts

phax (producer) writes an `acceptance-request` on the acceptance provider's stdin and reads a `gate-report` on its stdout; the example (consumer of the request, producer of the report) must accept exactly what `serializeAcceptanceRequest(makeAcceptanceRequest(…))` writes and refuse anything else with a one-line reason and remedy. phax.json is read by phax's config loader, which refuses an `oracles` key in the built phax and accepts only `acceptance`; the integration test holds the repository's own declaration to that decoder.

### Test strategy

- the example judges `authored` and `passed` requests built by phax's own serializer with the same findings as before under the `acceptance-*` ids, and its remedy names `--skip-acceptance` — medium · example · the gate-report findings per scenario · in-phase
- the example refuses an oracle-request, a wrong verdict, a missing or extra key, malformed ids, commits and paths with a one-line reason and remedy — medium · table · the refused gate-report naming the defect · in-phase
- this repository's phax.json decodes with decodePhaxConfig, declares the example under `acceptance`, and the example answers a checked report with no finding at HEAD — medium · smoke · the decoded config and the checked report with exit 0 · in-phase
- every `$schema` literal the moved example prints and shows names its format's current stamp — small · example · CURRENT_STAMPS · in-phase
- the README, docs/acceptance-phases.md and the examples hold oracle or discharge only in an allowlisted kept sense, completing the scan over every surface §8 names — small · table · the allowlist and its §5.21 reasons · in-phase · ac-oracle-kept

### Implementation order

1. examples/vitest-acceptance/ request.mjs, verdicts.mjs, main.mjs, then git.mjs, syntax.mjs and README.md; delete examples/vitest-oracles/
2. tests/integration/vitestAcceptanceExample.test.ts and tests/unit/exampleStamps.test.ts
3. phax.json and knip.json
4. README.md and docs/acceptance-phases.md example paths
5. tests/unit/acceptanceWords.test.ts: README, the docs page and examples scanned

### Excluded scope

- Any back-compat reading of an `oracle-request` in the example.
- src/ changes; the example stays outside the CLI and every package.
- Migrating this repository's live spec and plan sidecars (the operator runs `phax artifact migrate-documents` once 0.33.0 is installed).
- NEXT_STEPS.md and archived plans, specs, briefs and release notes that name the old path.
- Any other phax.json key.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The example's final file list, its accepted request shape and its refusal strings, the finding ids, the exact phax.json and knip.json lines, the README and docs lines changed, the final scanned set and every allowlist entry added, a reminder that the installed 0.32.0 now refuses this repository's phax.json until 0.33.0 is installed and that the operator then runs `phax artifact migrate-documents`, and any deviation from the planned file lists with the reason.

### Commit subject

`refactor(examples): move the Vitest provider to vitest-acceptance`

### Commit body

The Vitest provider moves from examples/vitest-oracles to examples/vitest-acceptance. It reads only an acceptance-request (an oracle-request is refused like any other format), reports acceptance-* finding ids and names --skip-acceptance in its remedy. This repository's phax.json declares it under acceptance and knip.json follows; the README and the Acceptance phases page name the new path.

The example's tests build every request with phax's own serializeAcceptanceRequest and decode phax.json with decodePhaxConfig again. The acceptance-words scan now reads the README, the docs page and the examples too, completing ac-oracle-kept. The installed phax 0.32.0 refuses this phax.json: run here again once 0.33.0 is installed, then migrate the live sidecars.
