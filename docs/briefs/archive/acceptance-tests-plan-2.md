Write the second of the four phax plans of the spec `acceptance-tests` (`docs/specs/2610271119-acceptance-tests.md`, re-approved 2026-10-31). Plan 1, the formats, merged as #177. Plans 3 and 4 follow, so this run does not complete the spec (`completes-spec: false`). Title it "Acceptance lint and config".

**Scope.** Plan (2) of the spec's §10 "Plans" line: lint, CLI and config refusals. That is:
- the plan.md header lines `**Acceptance phase:** yes | passed by phase-NN` and `**Acceptance test files:**`, their reader and renderer switched in one commit (the render-then-parse round trip forbids splitting them);
- lint's `acceptance` check (formerly `oracles`) and the `tests` check's loop messages, rules unchanged;
- the `acceptance` config key in phax.json, phax.local.json and ~/.phax/config.json, and the editor schemas phax.schema.json and phax.user.schema.json;
- `--hold acceptance` and `--skip-acceptance`, "Acceptance preflight failed" (exit 11 unchanged) and the run preflight check id `acceptance-phases`;
- every old-name refusal the spec's §10 "Refusal wording" quotes, word for word.

It covers ac-header, ac-header-rules, ac-header-old, ac-loop-rules, ac-loop-old, ac-provider, ac-request-authored, ac-provider-missing, ac-provider-old, ac-hold, ac-hold-old, ac-skip and ac-skip-old.

What plans 3 and 4 rename stays as it is in this run, even where the old word remains visible:
- prompts, the recovery and resume texts, help texts and the usage contract, the overview, records-explain and review-handoff rows, `oraclePairs.ts`, the internal failed-step value `oracle` and the telemetry event (plan 3);
- skills, README prose, docs, the site, `examples/vitest-oracles`, and this repository's `phax.json` and `knip.json` (plan 4).

Plan 1's Technical arbitrations list, under "These keep it until plan 2", the names this run renames: `oracleCheck.ts`, phaseHeader.ts's labels and identifiers, testLineCheck.ts's messages, the CLI words, phaxConfig's `oracles` key, the preflight text and check id. Rename each file in this plan. Say in the plan where a name keeps "oracle" until plan 3 or 4, so the reviewer does not flag it.

**What exists (read it first):**
- The spec's §5.1–§5.12, its §6 surfaces `file: plan.md acceptance phase header lines`, `cli: phax run — a plan with the old names`, `config: phax.json acceptance provider`, `cli: phax run --hold acceptance` and `cli: phax resume --skip-acceptance`, and its §10 rename table and refusal wording.
- Plan 1, `docs/plans/archive/2610311031-acceptance-tests-plan.md`: its Technical arbitrations and what it left for plan 2. Plan 1 already moved the test line's loop to `acceptance`. A plan.md line holding `oracle` in its loop position is a plain departure until this plan adds the refusal that names it. A recorded hold is already `"selection": "acceptance"`, while the CLI word is still `oracle`.
- `src/domain/plan/oracleCheck.ts`, `src/domain/plan/phaseHeader.ts`, `src/domain/plan/testLineCheck.ts`, `src/schemas/phaxConfig.ts`, `src/app/runPreflight.ts`, `src/app/lintPlan.ts`, `src/cli/commands/run.ts`, `src/cli/commands/resume.ts` and `resumeRegister.ts`.
- The existing `**Model reason:** is no longer read: write **Assignment reason:**` refusal, which the new refusals follow.

**Settle in Technical arbitrations, each with its dominant loss:**
- how the config refusal finds an `oracles` key in each of the three layers, and in a user overlay, and names the file;
- where `--hold oracle` and `--skip-oracle` are refused: at argument parsing or in the use case, and with which exit code (the spec leaves it to "the code each command already returns for an invalid argument");
- which identifiers and files this plan renames, and which wait for plans 3 and 4;
- the order of phases, so every commit is green.

**Constraints:**
- **This repository during the run.** The run is driven by the installed phax 0.32.0, which reads only the `oracles` key, the `**Oracle phase:**` / `**Oracle files:**` header lines and the test-line loop `oracle`.
  - `phax run` and `phax resume` read the main checkout's phax.json. After this plan merges, plans 3 and 4 are still driven by 0.32.0 from that file. So no phase changes this repository's `phax.json`, `knip.json` or `examples/vitest-oracles`: plan 4 does.
  - No test may decode this repository's own phax.json with the code under change. One does today: `tests/integration/vitestOraclesExample.test.ts`, "phax's own oracles declaration", passes it to `decodePhaxConfig`, which would refuse the `oracles` key from this plan on. Make that test read the key from the raw JSON until plan 4, and say so in the plan. The loss is accepted: until plan 4, no test proves this repository's phax.json loads under the phax being built.
  - The committed editor schemas `phax.schema.json` and `phax.user.schema.json` must equal the generated ones (`tests/unit/phaxConfigJsonSchema.test.ts`). They do lose `oracles`, so an editor flags this repository's phax.json until plan 4. Say so.
  - Do not migrate this repository's live spec and plan sidecars.
- **No back-compat shims.** `oracles` is refused, not read beside `acceptance`. No optional field in a persisted shape.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`. The ~/.phax/config.json refusal is tested under a temporary HOME.
- **Registries.** Respect the layer rules of `pnpm audit:architecture` and every exhaustive registry the tests hold, including the closure allowlist in `tests/unit/architecturalGuards.test.ts`. List them as planned edits. `pnpm docs:cli` rewrites the README's generated block and any generated usage file the CLI flags change; list those too.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy.
- **`### Test strategy`.** Use the line format with the spec's criterion ids, and cover every plan-2 criterion. While this run is driven by 0.32.0, this plan.md must use today's words: the test lines' loop `oracle`, and `**Oracle phase:**` / `**Oracle files:**` header lines on any acceptance pair. Its own lint runs on 0.32.0; the dev build's lint departs on those lines, as expected.
- **Acceptance pair.** The refusal messages are normative and stable, so an acceptance pair fits. One is judged by `node examples/vitest-oracles/main.mjs`, which this run leaves untouched, so the installed phax's `oracle-request` still reaches it. Use one if it fits; otherwise say why.
- **Lint and skills.** The plan must pass `phax plans lint`. No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:** `docs/upgrading.md`'s 0.33.0 entry gains the configuration, hand-written plan and command-line steps: the `acceptance` key and its overlays, the header lines and the loop, `--hold acceptance` and `--skip-acceptance`. Each names the refusal the operator sees. Drop the entry's closing line on configuration, hand-written plan and command-line steps, keeping the mention of the provider steps plan 4 adds. Fix the `oracles` description in `src/schemas/phaxConfig.ts`: it still documents `oracle-request`, `oraclePhase`, `oracleCommit` and `discharged`, while phax now writes `acceptance-request` with `acceptancePhase`, `acceptanceCommit` and `passed`.

**Phase shape:** as few phases as the gates allow, with every commit green. Switch the reader and renderer of the header lines in the same phase.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
