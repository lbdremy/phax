Write the first of the four phax plans of the spec `acceptance-tests` (`docs/specs/2610271119-acceptance-tests.md`, re-approved 2026-10-31). Plans 2 to 4 follow, so this run does not complete the spec (`completes-spec: false`). Title it "Acceptance formats".

**Scope.** Plan (1) of the spec's §10 "Plans" line: the persisted and published formats. That is:
- the phase key, the test line's loop (`acceptance | in-phase`), the `boundary` technique and the criterion filter in `plan-document`, `phax-plan` and `phax-plan-extraction`;
- the status, gate-attribution and record-manifest names;
- the `acceptance-request` format and its saved file;
- the schemas package's exports;
- the frozen modules and lifts;
- `migrate-documents` and the extractor version (`EXTRACTOR_VERSION` 4 → 5).

It covers ac-loop, ac-boundary, ac-criterion, ac-status-record, ac-migrate, ac-unmigrated, ac-archived and ac-in-flight. It also covers the requirements those criteria reference, and the §6 surfaces of those formats.

What plans 2 to 4 rename stays as it is in this run, even where the old word remains visible:
- lint and the plan header lines, the config key, `--hold` and `--skip-oracle`, and the old-name refusals of person-written files (plan 2);
- prompts, messages, help texts and telemetry (plan 3);
- skills, docs, site, the example, and this repository's `phax.json` and `knip.json` (plan 4).

Say in the plan where an internal identifier or message keeps "oracle" until a later plan, so the reviewer does not flag it.

**What exists (read it first):**
- The spec's §1 ground list, current as of 2026-10-31.
- #175 (structured-output plan 1):
  - the strict answer schemas and the strict check (`packages/schemas/build/strictCheck.ts`, `tests/unit/schemas/strictAnswers.test.ts`);
  - the test-line coherence filters (`src/schemas/testLine.ts`), the `$schema` const answers (`src/schemas/answerStamp.ts`) and the structured call table (`src/domain/session/structuredCalls.ts`);
  - how a format got a frozen module, a `next` snapshot and a lift.
  
  This run follows the same pattern for eight formats at 0.33.0.
- `src/schemas/release.ts`, `src/schemas/schemaUrl.ts` (`FORMAT_IDS`), `packages/schemas/` (snapshots, history, `history.lock.json`, `releases.json`), `scripts/schemas-check.ts`.
- `src/domain/artifact/documentMigration.ts`, whose own-shape rendering keeps 0.28.0 and 0.32.0 plan sidecars' old header lines and loop.

**Settle in Technical arbitrations, each with its dominant loss:**
- how each renamed enum value and key is lifted from 0.32.0 and older stamps, in phax and in the package;
- how `oracle-request` stays readable at 0.26.0 while `acceptance-request` is born at 0.33.0;
- which internal identifiers and file names this plan renames, and which wait for plans 2 and 3. Some files are renamed (`oracleCheck`, `oraclePairs`, `oracleRequest`…); rename them in the plan whose surface they serve, and say which;
- how the run plan already extracted by phax 0.32.0 stays resumable (ac-in-flight).

**Constraints:**
- **No back-compat shims, and no optional field in a persisted shape.** Each changed format gets a `next` snapshot stamped 0.33.0, and its 0.32.0 (or current) shape is frozen first. Every answer schema still passes the strict check.
- **This repository during the run.** The run is driven by the installed phax 0.32.0, from this repository's `phax.json`, whose `oracles` key and `node examples/vitest-oracles/main.mjs` command 0.32.0 must keep reading. No phase changes them: plan 4 does. Do not migrate this repository's live spec and plan sidecars either; the operator runs `migrate-documents` with the released 0.33.0.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`.
- **Registries.** Respect the layer rules of `pnpm audit:architecture` and every exhaustive format registry the schemas package tests hold, including the closure allowlist in `tests/unit/architecturalGuards.test.ts` and the README's persisted-formats table, and list them as planned edits. `pnpm docs:cli` also rewrites the README's generated block.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy.
- **`### Test strategy`.** Use the line format with the spec's criterion ids, and cover every plan-1 criterion. While this run is driven by 0.32.0, the test lines must use today's loop word `oracle`; the plan's own lint runs on 0.32.0.
- **Oracle pair.** The lift tables (old value → new value per format and stamp) are pure and stable contracts. Use an oracle pair if one fits; otherwise say why.
- **Lint and skills.** The plan must pass `phax plans lint`. No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:** `docs/upgrading.md` gets a 0.33.0 entry for records and schema readers, covering the formats this plan changes. Plan 4 completes that entry.

**Phase shape:** as few phases as the gates allow, with every commit green. Freeze the shapes first, then rename.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
