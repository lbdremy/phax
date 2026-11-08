---
status: Completed
source-spec: docs/specs/2611071052-effect-4-migration.md
completes-spec: false
approved:
  date: 2026-11-07
  baseline: 7c00a08
---
# Effect 4 migration groundwork

The first plan of the effect-4-migration spec. It builds, on Effect 3 and under the `standard` gate profile with every test green, the tools and the proof the later plans need before any source changes Effect version: the behaviour corpus (captured on Effect 3, replayed by a test later plans keep unchanged), phax's own ts-morph codemod (`pnpm codemod:effect4`, with `--check` and `--ratchet`) and its fixture tests, the migration skills (`effect4-lookup` and four topic skills), the `effect-migration` gate profile with its error ratchet, and a CONTRIBUTING note.

Nothing in this plan installs Effect 4, runs the codemod on `src`, `tests`, `scripts` or `packages/schemas`, or edits an Effect call site. The one install is `pnpm add -D --save-exact ts-morph@28.0.0`. The later plans, in the spec's order: install Effect 4 and apply the codemod (the phase that records the first counts, under `effect-migration`), then the topic skills' phases, then the package and the JSON Schemas, then docs, guidance and the removal of the codemod and the vendored reference.

Shape: corpus harness (phase-01), a person's review of the corpus pattern (phase-02, interactive), the formats and frozen decoders (phase-03), the codemod's acceptance tests (phase-04) passed by the codemod (phase-05), counts, ratchet and gate profile (phase-06), skills (phase-07), CONTRIBUTING note (phase-08).

Run notes:
- phase-07 writes `.claude/skills/effect4-*/SKILL.md`, so the run needs `phax run --allow-skill-edits`.
- phase-04/phase-05 are an acceptance pair judged by the configured `acceptance` provider (vitest `.fails` markers).
- Every phase holds the spec's silencing rule on its own new code: no `any`, no `as` assertion other than `as const`, no compatibility module. JSON read from disk is narrowed by hand-written type guards, never cast.
- Every phase first line names what it follows. No phase here migrates an Effect call site, so each says `Follows skill: none (groundwork on Effect 3)`; see Technical arbitrations.

## Required commands

- `pnpm add`
- `pnpm exec tsx`

Both commands are already in `security.agentCommands` in phax.json: `pnpm add` pins ts-morph in phase-05, and `pnpm exec tsx` runs the corpus capture script in phase-01 and phase-03. The plan needs no PHAX security configuration change. `pnpm add` reaches the npm registry; if the phase session cannot, the phase stops and says so in its handoff rather than vendoring the package. The run needs `phax run --allow-skill-edits` for phase-07.

## Technical arbitrations

- Corpus storage, one file per subject group: a case file per format (`tests/effect4Corpus/cases/formats/<format-id>.json`, holding the current shape's cases, replayed through the package's `parse<Format>` function, and one case list per frozen shape, replayed through that frozen module's decoder), and one per config layer, provider answer or document decoder (`cases/config/`, `cases/answers/`, `cases/documents/`). Each case is `{ name, input, expected }`; the capture script fills only a null `expected`, never changes a non-null one, and refuses to run unless the installed `effect` major is 3. Loss accepted: a frozen shape's cases sit inside its format's file, not beside its module, so a reader looks a decoder up through its format id.
- Corpus replay boundary: `tests/effect4Corpus/subjects.ts` is the only corpus file that touches Effect (it calls the decoders and renders refusals as phax renders them). The replay and coverage tests, the case files and the baseline files are Effect-free and stay byte-identical in later plans; only `subjects.ts` is migrated, under the schema topic skill. Loss accepted: the adapter that turns a decode into a refusal line is itself migrated code, so a later plan could bend it; the frozen expectations it is compared with are what catch that.
- Corpus field coverage is computed from each format's latest released snapshot under `packages/schemas/snapshots/<id>/`: every property path the JSON Schema declares (through `$ref`/`$defs`, `anyOf`/`oneOf`/`allOf`, array `items` as `[]`, and `additionalProperties` records as `*`) must appear in the input of at least one accepted current-shape case. Loss accepted: coverage is by field presence, not by every value or union branch, so an enum value or literal variant no case uses is not forced.
- Baseline freeze: phase-03 captures the package's runtime export names and the SHA-256 of every file under `packages/schemas/snapshots/` into `tests/effect4Corpus/baseline/`. Loss accepted: no format change can land on main while the migration runs without the operator re-capturing the baseline, which the spec's no-format-change rule already demands.
- Reference lines: each codemod rule lists its mappings as `{ v3Symbol, line }`, and the line is a line number in the vendored `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md`. A test checks that line N holds the entry for that symbol (`- `<v3Symbol>` ->` or `#### `<v3Symbol>``). Loss accepted: re-vendoring at another tag fails the test even when the targets did not move. That is intended, because re-vendoring is a deliberate act.
- Rewrites replace only the matched node's text span and leave every other byte of the file as it was, so fixture outputs are predictable byte for byte. Loss accepted: the codemod never reformats, so `pnpm format` may still have work after it runs.
- Origin: an identifier is Effect's when its import binding, followed through local re-export chains (ts-morph resolves the relative modules), ends at an import whose module specifier is `effect` or starts with `effect/`. It is never decided by the installed package's types, so the codemod behaves the same before and after Effect 4 is installed. Loss accepted: a symbol reached by a dynamic import or a computed property is not matched; the report and the type errors catch it instead.
- Starting rule table, from the spec's §10 list and the vendored reference: `either-to-result` (Import Map 689; Either members 10395, 10433, 10445, 10447, 10449, 10453, 10455, 10457, 10459), `effect-either` (10057), `schema-decode-either` (14950, 14954, 14970, 14974; ParseResult.decodeUnknownEither 13130), `context-tag` (9639, 9629), `schema-filters` (14992), `schema-optional-with` (15118, deterministic option sets only), `catch-all` (10003, 10189), `parse-result-issues` (Import Map 720; 13088, 13094, 13118, 13120). The registry codemod's rule list cannot be reached from a phase session, which has no network. The cross-check against it is therefore limited to the inventory the brief records. Loss accepted: a registry rule outside that inventory is not considered here; its symbols land in the codemod's report.
- Type-error counts: `src` is the error count of `tsc --noEmit -p tsconfig.json --pretty false`; `tests` is the count of `tsc --noEmit -p tsconfig.test.json --pretty false` errors whose file is not under `src/`. Loss accepted: errors in `packages/schemas` and `site` count with the test suite, and a file with ten errors weighs ten.
- Ratchet: the counts live in `scripts/effect4-codemod/type-error-counts.json`, written only by `pnpm codemod:effect4 --ratchet`. Gates run before phax commits, so the base is the file as committed at `HEAD` (read with `git show`), never the working tree. With no file at `HEAD`, the ratchet records the measured counts and passes: that is how the first Effect 4 phase sets the first counts. Otherwise it fails when either count exceeds the base, and on a pass it writes the measured counts for the next phase's base. This plan never creates the file. Loss accepted: a phase whose gate is rerun after a manual commit outside phax compares against that commit.
- The `effect-migration` profile follows the spec's indicative one, but its terminal steps carry every terminal step of `standard` (`pnpm check:full`, `pnpm build`, `pnpm site:build`, `pnpm deno:smoke`, `pnpm deno:smoke-binary`), because §5.22 asks the last phase to pass the full standard profile and `check:full` alone omits the product steps. Loss accepted: the migration's last phase runs the slow product steps.
- Topic skills and their scope: `effect4-services` (Context, Layer, ManagedRuntime, Runtime, FiberRef, Scope, `Effect.Service`/`provide*`; `src/ports/**`, layer construction in `src/infra/**` and `src/cli/**`, test layers and fakes), `effect4-errors` (Either/Result, Exit, Cause, `Effect.either`/`catch*`/`orElse`/`sandbox`, `Data.TaggedError`; error handling across `src/app`, `src/infra`, `src/domain`, `src/cli` and their tests), `effect4-schema` (Schema, ParseResult, JSONSchema, SchemaAST; `src/schemas/**` including `history/`, `packages/schemas/**`, `scripts/schemas-*.ts`, schema tests, `tests/effect4Corpus/subjects.ts`), and `effect4-core` for every other v3 symbol. The codemod's owner table maps a v3 module to its skill, with symbol-level overrides (for example, `Effect.catchAll` goes to errors). Loss accepted: a file mixing areas is migrated by more than one phase, each changing only its own skill's symbols.
- ac-phase-skill (§5.10) governs phases that migrate code. No phase of this groundwork plan changes an Effect call site; each one opens with `Follows skill: none (groundwork on Effect 3)` and is bounded by its planned files. Loss accepted: this plan does not show the one-skill-per-phase discipline itself; the next plan is the first to hold it.
- "Pinned" for the codemod's packages means declared in devDependencies and fixed by `pnpm-lock.yaml`. ts-morph is pinned exactly at 28.0.0, as the brief asks. tsx (the runner) and typescript (the counts' `tsc`) keep their existing ranges. Loss accepted: an install that ignores the lockfile could resolve another tsx or typescript.

## Arbitrated questions

### q-guard — Should phax.json protect the corpus and the ratchet from later migration phases with `protectedPaths`?

- protect — phase-06 declares `protectedPaths` for `tests/effect4Corpus/cases/**`, `tests/effect4Corpus/baseline/**`, `scripts/effect4-codemod/ratchet.ts` and `scripts/effect4-codemod/counts.ts` — abandons: Phase-editable config: declaring any protected path also protects phax.json itself for every later run. The final plan's profile removal, any fix to the ratchet, and the corpus's eventual removal then need the operator's hand edit, outside a phase.
- review-only — Declare no protected paths; the corpus and ratchet are guarded by review and the spec's diff criteria (ac-tests, ac-no-silencing) — abandons: Mechanical integrity of the proof: a later migration phase's agent can edit the ratchet or a captured expectation to turn its own gate green. Nothing stops it in the run; only a reviewer reading the diff catches it.

Recommendation: protect — The whole migration's proof rests on two things a phase must not move: the captured Effect 3 behaviour and the error ratchet. The cost of protection is a handful of operator edits to phax.json over the remaining plans. The profile itself adds no capability: its commands run repository code exactly as `standard`'s `pnpm test` already does. If `protect` is chosen, phase-06 adds the key; if `review-only`, phase-06 adds nothing.

Decision: protect — by operator (Rémy Loubradou), 2026-11-07
Why: The whole migration's proof rests on two things a phase must not move: the captured Effect 3 behaviour and the error ratchet. The cost of protection is a handful of operator edits to phax.json over the remaining plans. The profile itself adds no capability: its commands run repository code exactly as `standard`'s `pnpm test` already does. If `protect` is chosen, phase-06 adds the key; if `review-only`, phase-06 adds nothing. Advocate: The strongest case for review-only: protecting any path also protects phax.json itself for every later run, so the final plan's profile removal, any ratchet fix and the corpus's eventual removal all need a hand edit outside a phase; a reviewer reading the diff against the spec's criteria (ac-tests, ac-no-silencing) already catches a bent ratchet or edited expectation. Principles: C4, C2. Reversibility: cheap. Revised: none. Phase: phase-06.

### q-official-text — The skills must quote the official effect-v3-to-v4 skill's discipline with its source and version (q-skills own-cite), but phase sessions have no network. Where does that text come from?

- vendor-text — Before the run, the operator vendors the official `skills/effect-v3-to-v4/SKILL.md` at a pinned commit under `docs/vendor/effect-skills/effect-v3-to-v4/` with a SOURCE file (repository, commit, licence), byte-identical; phase-07 quotes from it — abandons: An unattended start: the run waits on a manual vendoring step, and another upstream file enters the repository until the final plan removes it with the reference.
- restate — phase-07 restates the discipline in phax's words from the spec's own summary, citing the upstream URL without a verbatim quote or a pinned version — abandons: Fidelity and a version: the skills paraphrase a paraphrase, so a difference from the official wording, and the version it held, is invisible to a reviewer.

Recommendation: vendor-text — q-skills settled on quoting the official discipline with its source and version, and only a local copy makes that possible offline. It mirrors how the reference was vendored, so the same SOURCE convention and the same removal at the end apply.

Decision: vendor-text — by operator (Rémy Loubradou), 2026-11-07
Why: Vendored before the run: docs/vendor/effect-skills/effect-v3-to-v4/ (SKILL.md, LICENSE, SOURCE) at Effect-TS/skills commit 155c50c911f9c99c294ef8a4461981c5bbe6453e. Advocate: The strongest case for restate: the run starts unattended with no manual vendoring step and no further upstream file in the repository, and phax's own words fit how its phases work, whereas a verbatim copy carries wording about clones and sub-agents that the skills must then work around. Principles: C1, E0. Reversibility: cheap. Revised: none. Phase: phase-07.

## Decision log

- 2026-11-07 q-guard decided protect — operator (Rémy Loubradou)
- 2026-11-07 q-official-text decided vendor-text — operator (Rémy Loubradou)

---

## phase-01 — Behaviour corpus harness, config layers and provider answers {#phase-01-corpus-harness}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** The corpus harness is a new design no code in the repository shows, and its shape freezes once captured: later plans replay it unchanged, so it needs the stronger model.

Capture, on Effect 3, how phax's config layers, provider answers and document frontmatter decode or refuse, and replay it with a test that later plans keep unchanged. The harness this phase sets (case files, subject adapter, capture script, replay test) is the pattern phase-03 repeats for every format and frozen decoder.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3). Change no file under `src/`; this phase only reads phax's decoders.
- Create `tests/effect4Corpus/corpus.ts`, which must not import `effect`. It holds the case-file types (`{ subject: string; cases: Array<{ name: string; input: unknown; expected: Expected | null }> }` for config/answers/documents files, where `Expected` is `{ ok: true; value: unknown } | { ok: false; refusal: string }`), a hand-written guard that reads a case file from parsed JSON (no `as`), a canonical JSON encoder (sorted object keys, plain objects, arrays, strings, finite numbers, booleans, null; it throws on any other value such as a class instance, `undefined` inside arrays, a bigint or a non-finite number, so capture fails loudly), and a pure `captureFile(file, replay, effectMajor)` that fills every `expected: null`, leaves every non-null `expected` untouched, and refuses unless `effectMajor === 3`.
- Create `tests/effect4Corpus/subjects.ts`, the only corpus module that touches Effect. Export `replay(subject: string, input: unknown): Expected`. It calls the decoder exactly as phax's call site does and renders a refusal exactly as phax prints it. Read `src/app/loadConfig.ts`, `src/app/loadRouting.ts`, `src/app/loadTelemetryConfig.ts`, `src/app/providerQuery.ts`, `src/app/extractPlan.ts`, `src/domain/artifact/frontmatter.ts` and `src/schemas/formatError.ts` to find each decoder and its formatter (`formatConfigParseError`, `formatFirstViolation`, `formatAnswerViolations`, `formatPlanDocumentViolation`, `formatParseError`). It normalises Effect values in a decoded value (an `Option`, for example) to plain data before it returns, so the encoder never sees an Effect class. An unknown subject throws.
- Subjects in this phase, one case file each: `config/phax-config` (phax.json through `decodePhaxConfig`), `config/phax-user-overlay` (`decodePhaxUserOverlay`), `config/provider-config` (`decodeProviderConfig`), `config/model-routing` (`decodeModelRouting`), `config/telemetry-config` (`decodeTelemetryConfig`), `config/vibe-config` (src/schemas/vibeConfig.ts), `answers/claude-output` (claudeOutput decoders), `answers/claude-stream` (claudeStream), `answers/codex-output` (codexOutput), `answers/vibe-output` (vibeOutput), `answers/vibe-export` (vibeExport), `answers/plan-extraction` (`decodePlanExtractionAnswer`), `answers/authoring-answer` (the spec and plan authoring answers in src/schemas/answerSchemas.ts and their refusal formatter), `answers/plan-audit` (`decodePlanAuditResponse`), `documents/artifact-frontmatter` (`decodeSpecFrontmatter` and its plan counterpart). When a decoder file holds several decoders, the subject's cases name which one in a field of the input envelope you define in corpus.ts (for example `{ decoder, raw }`), so a single subject covers the file.
- Write the inputs by hand, from the schemas and from existing test fixtures (grep `tests/` for each decoder). Give every subject accepted and refused cases: a missing required key, an unexpected key, a wrong type, an out-of-enum value, and, where the schema has filters or brands, an input that fails the filter. `answers/authoring-answer` must hold cases whose captured refusals are exactly `$schema: is missing; version: is unexpected` and `acceptanceCriteria[2].refs[0]: is missing` (find the formatter that produces them by grepping `tests/` for those strings).
- Create `scripts/effect4-corpus-capture.ts`: it reads `node_modules/effect/package.json`'s version, walks `tests/effect4Corpus/cases/**/*.json`, applies `captureFile` with `replay`, and writes each file back as `JSON.stringify(doc, null, 2) + "\n"`. Run it once with `pnpm exec tsx scripts/effect4-corpus-capture.ts` to fill the expectations, and commit the filled files.
- Create `tests/unit/effect4Corpus/replay.test.ts`, which must not import `effect` and must contain no subject list. It walks every case file under `tests/effect4Corpus/cases/`, fails when any case has `expected: null`, and asserts that the canonical encoding of `replay(subject, input)` equals the canonical encoding of `expected`, one test per case, named `<subject> <case name>`. It covers directories phase-03 will add without edits.
- Create `tests/unit/effect4Corpus/capture.test.ts` for `captureFile` and the encoder.
- Add `tests/effect4Corpus/cases` and `tests/effect4Corpus/baseline` to `.oxfmtrc.json`'s `ignorePatterns`, so captured bytes are never reformatted.
- No `any`, no `as` other than `as const`.

### Planned files to create

- `tests/effect4Corpus/corpus.ts`
- `tests/effect4Corpus/subjects.ts`
- `scripts/effect4-corpus-capture.ts`
- `tests/unit/effect4Corpus/replay.test.ts`
- `tests/unit/effect4Corpus/capture.test.ts`
- `tests/effect4Corpus/cases/config/phax-config.json`
- `tests/effect4Corpus/cases/config/phax-user-overlay.json`
- `tests/effect4Corpus/cases/config/provider-config.json`
- `tests/effect4Corpus/cases/config/model-routing.json`
- `tests/effect4Corpus/cases/config/telemetry-config.json`
- `tests/effect4Corpus/cases/config/vibe-config.json`
- `tests/effect4Corpus/cases/answers/claude-output.json`
- `tests/effect4Corpus/cases/answers/claude-stream.json`
- `tests/effect4Corpus/cases/answers/codex-output.json`
- `tests/effect4Corpus/cases/answers/vibe-output.json`
- `tests/effect4Corpus/cases/answers/vibe-export.json`
- `tests/effect4Corpus/cases/answers/plan-extraction.json`
- `tests/effect4Corpus/cases/answers/authoring-answer.json`
- `tests/effect4Corpus/cases/answers/plan-audit.json`
- `tests/effect4Corpus/cases/documents/artifact-frontmatter.json`

### Planned files to edit

- `.oxfmtrc.json`

### Optional files that may be edited

- `knip.json`
- `tsconfig.test.json`

### Boundary contracts

Corpus to decoders: the replay test (consumer) needs one stable call, `replay(subject, input) -> { ok: true, value } | { ok: false, refusal }`, with JSON-plain values. `tests/effect4Corpus/subjects.ts` (producer) provides it over phax's decoders and refusal formatters, exactly as phax's call sites use them. Later plans migrate the producer only; the call's shape does not change.

### Test strategy

- every config, answer and frontmatter case replays to its captured value or refusal line — small · example · captured expectations in the case files · in-phase · ac-refusal
- the spec's two refusal lines are captured verbatim — small · example · the literal lines of spec §6, $schema: is missing; version: is unexpected and acceptanceCriteria[2].refs[0]: is missing · in-phase · ac-refusal
- capture fills only null expectations, never changes a captured one, and refuses any effect major but 3 — small · table · expected file contents and a typed refusal per (expected state, effect major) row · in-phase
- the canonical encoder gives one text per value whatever the key order, and refuses non-plain values — small · boundary · expected text and a thrown refusal for a class instance, bigint, NaN and undefined in an array · in-phase

### Implementation order

1. corpus.ts types, guard, encoder and captureFile, with capture.test.ts
2. subjects.ts for the config subjects, then answers and documents
3. case files, hand-written inputs
4. capture script, then one capture run
5. replay.test.ts
6. .oxfmtrc.json ignore entries

### Excluded scope

- Format and frozen-decoder subjects, field coverage and the package baseline (phase-03).
- Any change under src/, packages/schemas/ or to an existing test.
- Installing anything.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The case-file shape and the `replay` signature as written, the exact subject ids, which formatter each subject renders with and why (file and line of the phax call site it mirrors), how Effect values are normalised, the capture command, and which case holds each of the spec's two refusal lines. Any deviation from the planned file lists (a subject split or merged), with the reason.

### Commit subject

`test(effect4): capture config, answer and frontmatter behaviour on Effect 3`

### Commit body

Add the behaviour corpus harness for the Effect 4 migration: case files with captured expectations, an Effect-free replay test, a subject adapter that decodes and renders refusals exactly as phax does, and a capture script that only fills missing expectations and runs only on Effect 3.

This phase covers config layers, provider answers and artifact frontmatter, including the spec's two refusal lines. Captured files are excluded from oxfmt so their bytes never move.

---

## phase-02 — Review the behaviour corpus pattern {#phase-02-corpus-review}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Mode:** interactive

A person reviews the corpus pattern phase-01 set before phase-03 repeats it for 41 formats and 63 frozen decoders, when a correction is still cheap.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Review, with the person: the case-file shape and the input envelope for multi-decoder subjects; the boundary between `tests/effect4Corpus/subjects.ts` (Effect-touching, migrated later) and the Effect-free `corpus.ts`, replay test and case files (frozen); the formatter each subject renders refusals with, against the phax call site it claims to mirror; how Effect values are normalised to plain data; whether the refused cases cover the issue kinds (missing, unexpected, wrong type, enum, filter) that the formatters word differently.
- The pattern at stake: phase-03 repeats it per format (`cases/formats/<id>.json` with a current case list and one list per frozen shape) and adds coverage and baseline tests; once captured, later plans never re-capture it.
- Read only on the first turn; the person's correction, if any, goes in the files below.

### Planned files to create

- (none)

### Planned files to edit

- (none)

### Optional files that may be edited

- `tests/effect4Corpus/corpus.ts`
- `tests/effect4Corpus/subjects.ts`
- `scripts/effect4-corpus-capture.ts`
- `tests/unit/effect4Corpus/replay.test.ts`
- `tests/unit/effect4Corpus/capture.test.ts`
- `tests/effect4Corpus/cases/config/phax-config.json`
- `tests/effect4Corpus/cases/config/phax-user-overlay.json`
- `tests/effect4Corpus/cases/config/provider-config.json`
- `tests/effect4Corpus/cases/config/model-routing.json`
- `tests/effect4Corpus/cases/config/telemetry-config.json`
- `tests/effect4Corpus/cases/config/vibe-config.json`
- `tests/effect4Corpus/cases/answers/claude-output.json`
- `tests/effect4Corpus/cases/answers/claude-stream.json`
- `tests/effect4Corpus/cases/answers/codex-output.json`
- `tests/effect4Corpus/cases/answers/vibe-output.json`
- `tests/effect4Corpus/cases/answers/vibe-export.json`
- `tests/effect4Corpus/cases/answers/plan-extraction.json`
- `tests/effect4Corpus/cases/answers/authoring-answer.json`
- `tests/effect4Corpus/cases/answers/plan-audit.json`
- `tests/effect4Corpus/cases/documents/artifact-frontmatter.json`

### Test strategy

- (none)

### Implementation order

1. Read phase-01's handoff and files
2. Walk the review points with the person
3. Apply the person's corrections, if any

### Excluded scope

- Adding format or frozen-decoder subjects (phase-03).
- Any change outside the corpus files.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

What the person confirmed or changed in the corpus pattern, and any rule phase-03 must follow as a result (subject naming, envelope, refusal rendering, normalisation).

### Commit subject

`test(effect4): apply the corpus pattern review`

### Commit body

Record the person's review of the behaviour corpus pattern before it is repeated for every format and frozen decoder.

---

## phase-03 — Behaviour corpus for every format and frozen decoder, with coverage {#phase-03-corpus-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** Repeats phase-01's pattern, but over 104 decoders whose captured expectations freeze for every later plan: a field missed now cannot be captured on Effect 3 again, so it needs more effort than the default.

Extend the corpus to every persisted format (through the package's parse functions) and every frozen decoder, prove that the accepted documents exercise every field of every format's latest released JSON Schema, and capture the package's export names and the released snapshots' bytes, so the later equivalence check, frozen-decoder replay and package checks have their Effect 3 baseline.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3). Change no file under `src/` or `packages/schemas/`.
- Follow the pattern phase-01 set and phase-02 confirmed (read both handoffs). A format case file `tests/effect4Corpus/cases/formats/<format-id>.json` holds `{ format, current: Case[], shapes: { [shape]: Case[] } }`: `current` replays through the package's `parse<Format>` function in `packages/schemas/src/index.ts`, with expected `{ ok: true, shape, value }` or `{ ok: false, refusal }`, the refusal being `<path>: <message>` from its `{ path, message }`. Each `shapes[<shape>]` list replays through that frozen module's decoder (`src/schemas/history/<format-id>/<shape>.ts`). Its refusal is rendered as phax's persisted reader renders it (`src/schemas/persisted.ts`), or, where phax has no such path, as the package's `{ path, message }` first issue. Extend `corpus.ts`'s guard for this file shape, keeping it Effect-free.
- Extend `tests/effect4Corpus/subjects.ts` with subjects `format:<id>` for every `FORMAT_IDS` entry (a map typed over `FormatId`, so a missing format fails typecheck) and `frozen:<format-id>/<shape>` for every module listed in `packages/schemas/history.lock.json`.
- Write inputs from the latest released snapshot of each format (`packages/schemas/snapshots/<id>/<highest release>.schema.json`) and from existing fixtures in `tests/`. Every format's accepted current cases together set every property path the snapshot declares. Every format has refused cases (missing key, unexpected key, wrong type, enum, filter). Every frozen shape has at least one accepted and one refused case. Every pre-schema shape has a document without `$schema`.
- Extend `scripts/effect4-corpus-capture.ts`: fill format files like the others, and write `tests/effect4Corpus/baseline/package-exports.json` (the sorted runtime export names of `packages/schemas/src/index.ts`) and `tests/effect4Corpus/baseline/snapshot-digests.json` (repo-relative path to SHA-256 for every file under `packages/schemas/snapshots/`) only when absent. Run it once with `pnpm exec tsx scripts/effect4-corpus-capture.ts` and commit the results.
- Create `tests/unit/effect4Corpus/coverage.test.ts`, which must not import `effect`. For each `FORMAT_IDS` entry it requires a case file, walks the latest released snapshot's property paths (resolve `$ref` into `$defs` with a cycle guard; descend `anyOf`/`oneOf`/`allOf`, `items` as `[]`, `additionalProperties` schemas as `*`), and fails naming each path no accepted current case's input sets. It also requires at least one refused current case per format, and at least one accepted and one refused case for every module key in `history.lock.json`.
- Create `tests/unit/effect4Corpus/package.test.ts`, which must not import `effect`: the sorted runtime export names of `packages/schemas/src/index.ts` equal `baseline/package-exports.json`; the set of files under `packages/schemas/snapshots/` and each one's SHA-256 equal `baseline/snapshot-digests.json`; no `next.schema.json` exists.
- `replay.test.ts` must need no edit: it walks the new directory. If its walk cannot read format files, extend `corpus.ts`, not the test.
- No `any`, no `as` other than `as const`.

### Planned files to create

- `tests/unit/effect4Corpus/coverage.test.ts`
- `tests/unit/effect4Corpus/package.test.ts`
- `tests/effect4Corpus/baseline/package-exports.json`
- `tests/effect4Corpus/baseline/snapshot-digests.json`
- `tests/effect4Corpus/cases/formats/registry.json`
- `tests/effect4Corpus/cases/formats/run-status.json`
- `tests/effect4Corpus/cases/formats/phase-status.json`
- `tests/effect4Corpus/cases/formats/phax-plan.json`
- `tests/effect4Corpus/cases/formats/compliance-review.json`
- `tests/effect4Corpus/cases/formats/plan-approvals.json`
- `tests/effect4Corpus/cases/formats/spec-approvals.json`
- `tests/effect4Corpus/cases/formats/phase-record-manifest.json`
- `tests/effect4Corpus/cases/formats/authoring-record-manifest.json`
- `tests/effect4Corpus/cases/formats/gate-attribution.json`
- `tests/effect4Corpus/cases/formats/phase-file-reconciliation.json`
- `tests/effect4Corpus/cases/formats/spec-document.json`
- `tests/effect4Corpus/cases/formats/plan-document.json`
- `tests/effect4Corpus/cases/formats/plan-approval-record.json`
- `tests/effect4Corpus/cases/formats/spec-approval-record.json`
- `tests/effect4Corpus/cases/formats/gate-request.json`
- `tests/effect4Corpus/cases/formats/brief-request.json`
- `tests/effect4Corpus/cases/formats/brief-record.json`
- `tests/effect4Corpus/cases/formats/gate-report.json`
- `tests/effect4Corpus/cases/formats/brief-report.json`
- `tests/effect4Corpus/cases/formats/hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/decision-record-manifest.json`
- `tests/effect4Corpus/cases/formats/cost-ledger.json`
- `tests/effect4Corpus/cases/formats/architecture-request.json`
- `tests/effect4Corpus/cases/formats/architecture-report.json`
- `tests/effect4Corpus/cases/formats/oracle-request.json`
- `tests/effect4Corpus/cases/formats/first-reading.json`
- `tests/effect4Corpus/cases/formats/interactive-handoff.json`
- `tests/effect4Corpus/cases/formats/interactive-session.json`
- `tests/effect4Corpus/cases/formats/review-stop.json`
- `tests/effect4Corpus/cases/formats/run-list.json`
- `tests/effect4Corpus/cases/formats/decide-verdicts.json`
- `tests/effect4Corpus/cases/formats/review-record-manifest.json`
- `tests/effect4Corpus/cases/formats/code-review.json`
- `tests/effect4Corpus/cases/formats/phax-plan-extraction.json`
- `tests/effect4Corpus/cases/formats/spec-hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/plan-hand-decision-answer.json`
- `tests/effect4Corpus/cases/formats/acceptance-request.json`
- `tests/effect4Corpus/cases/formats/artifact-status.json`
- `tests/effect4Corpus/cases/formats/plan-overview.json`
- `tests/effect4Corpus/cases/formats/plan-lint.json`

### Planned files to edit

- `tests/effect4Corpus/corpus.ts`
- `tests/effect4Corpus/subjects.ts`
- `scripts/effect4-corpus-capture.ts`

### Optional files that may be edited

- `tests/unit/effect4Corpus/capture.test.ts`
- `knip.json`

### Boundary contracts

Corpus to the schemas package: the corpus consumes the package's public parse functions and runtime export names as a consumer would, and the frozen modules' decoders as phax's reader does. The package provides `{ ok, shape, value } | { ok: false, error: { path, message } }`, unchanged by this phase.

### Test strategy

- every format's accepted documents together set every property path of its latest released snapshot — small · table · property paths walked from packages/schemas/snapshots latest release per format · in-phase · ac-json-schema
- every frozen decoder replays its accepted values and refusal lines as captured — small · example · captured expectations, one shape list per history.lock.json module · in-phase · ac-frozen
- every format's parse function replays its captured shape, value or refusal — small · example · captured expectations in the format case files · in-phase · ac-package
- every format's current refusals replay with the same path and message — small · example · captured refusal lines · in-phase · ac-refusal
- the package's runtime export names are those of 0.36.0 — small · example · baseline/package-exports.json · in-phase · ac-package
- no released snapshot changes, appears or disappears, and no next snapshot exists — small · example · baseline/snapshot-digests.json · in-phase · ac-no-bump

### Implementation order

1. corpus.ts guard for format files
2. subjects.ts format and frozen subjects
3. coverage.test.ts, to see what is missing
4. format case files, until coverage passes
5. capture script baseline, then one capture run
6. package.test.ts

### Excluded scope

- The ajv equivalence check between Effect 4's generated JSON Schema and the snapshots (a later plan, on Effect 4).
- Any change to src/, packages/schemas/ or an existing test.
- Edits to replay.test.ts.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The format-file shape, the subject ids, how frozen refusals are rendered (and for which modules the persisted reader path applies), the path notation coverage uses, the baseline file formats, and the capture command. State that `subjects.ts` is the one corpus file later plans migrate (schema skill) and that the case files, baseline files and the three corpus tests stay byte-identical. List any deviation from the planned files.

### Commit subject

`test(effect4): capture every format and frozen decoder on Effect 3`

### Commit body

Extend the behaviour corpus to all 41 persisted formats, read through the schemas package's parse functions, and to all 63 frozen decoders.

A coverage test requires the accepted documents to set every property path of each format's latest released JSON Schema, which the later equivalence check depends on. The package's runtime export names and the released snapshots' digests are captured as a baseline, so later plans can prove that neither moves.

---

## phase-04 — Codemod acceptance tests and fixtures {#phase-04-codemod-acceptance}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** Every expected output must be the correct Effect 4 form, derived from the vendored reference without a v4 install to check it, and it freezes once committed; the codemod's API is designed here.
**Acceptance phase:** passed by phase-05
**Acceptance test files:** `tests/unit/effect4Codemod/rules.test.ts`, `tests/unit/effect4Codemod/report.test.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/either-to-result/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/either-to-result/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/effect-either/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/effect-either/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/schema-decode-either/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/schema-decode-either/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/context-tag/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/context-tag/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/schema-filters/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/schema-filters/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/schema-optional-with/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/schema-optional-with/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/catch-all/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/catch-all/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/parse-result-issues/input.ts`, `tests/unit/effect4Codemod/__fixtures__/rules/parse-result-issues/expected.ts`, `tests/unit/effect4Codemod/__fixtures__/namesakes/input.ts`, `tests/unit/effect4Codemod/__fixtures__/uncovered/input.ts`

Freeze, as acceptance tests, what phax's Effect 4 codemod must do: rewrite each rule's fixture to its expected output, cite a real line of the vendored reference for every mapping, leave local namesakes and uncovered symbols byte-identical, list an uncovered symbol under its topic skill with its reference line, and change nothing on a second run. The tests run against stubs that fail recognizably.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3); it writes the codemod's tests, not migrated code.
- Create the stub API under `scripts/effect4-codemod/`. `rules.ts` exports `type RuleMapping = { readonly v3Symbol: string; readonly line: number }`, `type Rule = { readonly id: string; readonly mappings: ReadonlyArray<RuleMapping> }` and `RULES: ReadonlyArray<Rule> = []`. `codemod.ts` exports `rewriteFiles(options: { root: string; files: ReadonlyArray<string> }): CodemodResult`, where `CodemodResult = { files: Array<{ path: string; before: string; after: string; rewrites: Record<string, number> }>; leftovers: Array<{ path: string; line: number; v3Symbol: string; referenceLine: number | null; owner: string }> }`. `rewriteFiles` reads files and returns new text without writing, and the stub throws `Error("effect4 codemod: not implemented")`.
- Rules and their mappings (each line number is from `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md`; re-check each one there): `either-to-result` (`effect/Either` 689; `Either.Either` 10395, `Either.getOrElse` 10433, `Either.isLeft` 10445, `Either.isRight` 10447, `Either.left` 10449, `Either.map` 10453, `Either.mapLeft` 10455, `Either.match` 10457, `Either.right` 10459); `effect-either` (`Effect.either` 10057); `schema-decode-either` (`Schema.decodeEither` 14950, `Schema.decodeUnknownEither` 14954, `Schema.encodeEither` 14970, `Schema.encodeUnknownEither` 14974, `ParseResult.decodeUnknownEither` 13130); `context-tag` (`Context.Tag` 9639, `Context.GenericTag` 9629); `schema-filters` (`Schema.filter` 14992, predicate filters piped on a schema, to `.check(Schema.makeFilter(...))`); `schema-optional-with` (`Schema.optionalWith` 15118, only the option sets whose v4 form the schema guide states without judgment, such as `{ exact: true }`); `catch-all` (`Effect.catchAll` 10003, `Effect.orElse` 10189); `parse-result-issues` (`effect/ParseResult` 720; `ParseResult.Missing` 13088, `ParseResult.ParseIssue` 13094, `ParseResult.Type` 13118, `ParseResult.Unexpected` 13120).
- For each rule, write `tests/unit/effect4Codemod/__fixtures__/rules/<rule-id>/input.ts` (Effect 3 code importing from `effect`, using every mapping of the rule, in phax's own style) and `expected.ts` (the same file with only the matched spans rewritten to the v4 target the reference line and its topic guide give; every other byte unchanged). Derive each target from the vendored `MIGRATION.md`, `migration/<topic>.md` and the reference line, never from memory. Class syntax for `Context.Tag` follows line 9639: `Context.Service<Self, Shape>()(id)`. A rule rewrites an import binding only when it rewrites at least one use in the file.
- Write `__fixtures__/namesakes/input.ts`: a local `type Either<A, E>`, a local `function catchAll`, and a local object with a `Tag` member named `Context`, none imported from `effect`, used the way Effect's are. Write `__fixtures__/uncovered/input.ts`: `import { ParseResult } from "effect"` used only as `ParseResult.ArrayFormatter.formatErrorSync(...)`, which no rule rewrites (reference heading line 13066).
- Create `tests/unit/effect4Codemod/rules.test.ts`. Write one explicit `it.fails(...)` per rule that its input rewrites byte-for-byte to its `expected.ts` with a non-zero rewrite count under that rule id. Write one explicit `it.fails(...)` per rule that its rewritten output, fed back to `rewriteFiles`, comes back unchanged with zero rewrites. Add one `it.fails` that `RULES`' ids equal the fixture directory names, and one that every mapping's line in the vendored v3-to-v4.md starts with `- `<v3Symbol>` ->` or is `#### `<v3Symbol>``. The test reads the vendored file itself.
- Create `tests/unit/effect4Codemod/report.test.ts`, with explicit `it.fails` tests: the namesakes fixture comes back byte-identical with no rewrite and no leftover; the uncovered fixture comes back byte-identical; and its leftovers hold exactly one entry, `ParseResult.ArrayFormatter` at its file and line, `referenceLine` 13066, owner `effect4-schema`.
- Write each test with an explicit `it.fails(...)`, never a loop, `.each` or a generated name, so the acceptance provider reads every marker statically. Call `rewriteFiles` with the repository root and the fixture's repo-relative path, so its imports resolve in place.
- Exclude `tests/unit/effect4Codemod/__fixtures__` from `tsconfig.test.json` (an expected output is Effect 4 code), from oxfmt (`.oxfmtrc.json` ignorePatterns, since the bytes are the oracle), and from knip (`knip.json` ignoreFiles). oxlint already ignores `tests/**/__fixtures__/`.
- Do not install ts-morph; the stubs need none. No `any`, no `as` other than `as const`.

### Planned files to create

- `scripts/effect4-codemod/rules.ts`
- `scripts/effect4-codemod/codemod.ts`
- `tests/unit/effect4Codemod/rules.test.ts`
- `tests/unit/effect4Codemod/report.test.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/either-to-result/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/either-to-result/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/effect-either/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/effect-either/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/schema-decode-either/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/schema-decode-either/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/context-tag/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/context-tag/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/schema-filters/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/schema-filters/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/schema-optional-with/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/schema-optional-with/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/catch-all/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/catch-all/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/parse-result-issues/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/rules/parse-result-issues/expected.ts`
- `tests/unit/effect4Codemod/__fixtures__/namesakes/input.ts`
- `tests/unit/effect4Codemod/__fixtures__/uncovered/input.ts`

### Planned files to edit

- `tsconfig.test.json`
- `.oxfmtrc.json`
- `knip.json`

### Optional files that may be edited

- (none)

### Boundary contracts

Tests to codemod: the acceptance tests (consumer) need `RULES` (id plus `{ v3Symbol, line }` mappings) and a non-writing `rewriteFiles({ root, files })` returning each file's before/after text, per-rule rewrite counts and leftovers `{ path, line, v3Symbol, referenceLine, owner }`. `scripts/effect4-codemod/` (producer) provides them in phase-05; the CLI wraps them. Be strict on the semantics (byte-preserving spans, leftover fields), adaptable on internals.

### Test strategy

- each rule rewrites its fixture input to its expected output, byte for byte — small · example · the rule's expected.ts · acceptance · ac-codemod-rules
- every rule mapping names a vendored v3-to-v4.md line that holds its v3 symbol's entry — small · table · the vendored v3-to-v4.md at effect@4.1.2 · acceptance · ac-codemod-rules
- a file whose Effect symbol no rule covers is left byte-identical — small · example · the uncovered fixture's own bytes · acceptance · ac-codemod-rules
- a local Either type, catchAll function and Context object not imported from effect are left untouched — small · example · the namesakes fixture's own bytes and an empty leftover list · acceptance · ac-codemod-origin
- ParseResult.ArrayFormatter is listed by file and line under effect4-schema with its reference line — small · example · one expected leftover entry, reference line 13066 · acceptance · ac-codemod-report
- rewriting an already rewritten file changes nothing — small · metamorphic · the first run's output equals the second run's · acceptance · ac-codemod-idempotent

### Implementation order

1. stubs rules.ts and codemod.ts
2. per-rule fixtures, each target checked against the vendored reference and guide
3. namesakes and uncovered fixtures
4. rules.test.ts and report.test.ts with .fails markers
5. tsconfig.test.json, .oxfmtrc.json and knip.json exclusions

### Excluded scope

- Implementing any rule, the reference index, the owner table or the CLI (phase-05).
- Counts and ratchet (phase-06).
- Installing ts-morph.
- Running anything on src/, tests/, scripts/ or packages/schemas/.

### Verification

The `standard` gate profile in phax.json, with the acceptance provider judging the markers.

### Expected handoff content

The stub signatures exactly as written, the rule ids and every mapping with its verified line, which topic guide section justifies each non-rename target (context-tag, schema-filters, schema-optional-with), the option sets schema-optional-with covers, and the import-binding rule. List any reference line that differed from the plan's and what it is now.

### Commit subject

`test(effect4): freeze the codemod's rules, origin and report as acceptance tests`

### Commit body

Add the Effect 4 codemod's acceptance tests, marked to fail until the codemod exists. There is one input and expected output per rule, each rule mapping cites a line of the vendored v3-to-v4.md, local namesakes and uncovered symbols are left byte-identical, ParseResult.ArrayFormatter is reported under effect4-schema, and a second run changes nothing.

Stubs give the tests the API they compile against. The fixtures are excluded from typecheck, oxfmt and knip, since their bytes are the oracle.

---

## phase-05 — The Effect 4 codemod on ts-morph {#phase-05-codemod}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high
**Assignment reason:** A new adapter to a library the repository does not use yet (ts-morph), with origin resolution and byte-preserving rewrites that must meet frozen acceptance tests exactly.

Implement phax's own codemod, `pnpm codemod:effect4`, on ts-morph pinned at 28.0.0. It applies its rule table to `src`, `tests`, `scripts` and `packages/schemas` by byte-preserving spans, resolves origin through import bindings, reports every v3 symbol it leaves by file, line, reference line and owning topic skill, supports `--check`, and fetches nothing at run time. It passes phase-04's acceptance tests.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3); it builds the codemod and runs it only on fixtures and temporary trees.
- Run `pnpm add -D --save-exact ts-morph@28.0.0`. If the registry is unreachable, stop and say so in the handoff; do not vendor the package.
- Create `scripts/effect4-codemod/reference.ts`: it parses the vendored `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md` as data (Import Map entries, No Counterpart Imports and Removed Modules, and API Reference entries `- `Old` -> `New`: ...` and `#### `Old`` headings, each with its 1-based line). It exposes the symbol-to-line lookup and the set of v3 symbols whose entry maps to a different symbol or to `none`.
- Create `scripts/effect4-codemod/owners.ts`: v3 module to topic skill (`effect4-services`, `effect4-errors`, `effect4-schema`, `effect4-core`, as listed in Technical arbitrations), symbol overrides first (for example `Effect.either`, `Effect.catchAll`, `Effect.orElse`, `Effect.catch*` to errors; `Effect.Service`, `Effect.provide*` to services), and `effect4-core` as the default.
- Implement `rules.ts` (the eight rules and their mappings, as phase-04 froze them) and `codemod.ts`'s `rewriteFiles`. Build a ts-morph `Project` with NodeNext module resolution and add files explicitly, without loading the repository's tsconfig. Origin: follow an identifier's import binding through relative re-export chains to an import whose specifier is `effect` or `effect/*`; never use the installed package's types. Edit by replacing matched node spans in the original text, keeping every other byte. After the rewrites, scan each file for remaining v3 symbols (Effect-origin property accesses, named imports and module specifiers the reference maps elsewhere) and emit leftovers with owner and reference line (`null` when the reference has no entry).
- Create `scripts/effect4-codemod/main.ts`, wired as the package script `codemod:effect4` (`tsx scripts/effect4-codemod/main.ts`). Its targets are `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.ts` and `packages/schemas/**/*.ts`, excluding `**/dist/**`, `tests/e2e/fixtures/**`, `tests/unit/effect4Codemod/__fixtures__/**` and `scripts/effect4-codemod/**`. `--root <dir>` defaults to the current directory. The default mode writes the changed files and prints a per-rule table (rule, files, rewrites, reference) and `left to phases (<n>):` with one line per leftover (`<owner>  <path>:<line>  <v3Symbol> -> <target>  v3-to-v4.md:<line>`). `--check` writes nothing, prints `<n> files would change` and the leftovers, and exits 1 when n > 0. Counts and `--ratchet` come in phase-06.
- Remove the `.fails` markers from `tests/unit/effect4Codemod/rules.test.ts` and `report.test.ts`; change nothing else in them or in their fixtures.
- Add in-phase tests: `tests/unit/effect4Codemod/reference.test.ts` (the parser finds the Import Map, an API entry, a `-> none` entry and a `####` heading at their known lines); `tests/unit/effect4Codemod/origin.test.ts` with fixtures `__fixtures__/reexport/effectReexport.ts` (`export { Either } from "effect"`), `__fixtures__/reexport/uses.ts` (imports `Either` from `./effectReexport.js`) and `__fixtures__/reexport/expected-uses.ts`; `tests/unit/effect4Codemod/offline.test.ts` (ts-morph is in devDependencies at exactly `28.0.0` and in `pnpm-lock.yaml`; every import in `scripts/effect4-codemod/*.ts` is `node:*`, `ts-morph` or relative; tsx and typescript are devDependencies); `tests/integration/effect4CodemodCli.test.ts` (in a temporary directory holding a small TypeScript tree, `--check` reports and exits 1, a write run rewrites, and a second `--check` prints `0 files would change` and exits 0).
- Do not run `pnpm codemod:effect4` on this repository. No `any`, no `as` other than `as const`.

### Planned files to create

- `scripts/effect4-codemod/reference.ts`
- `scripts/effect4-codemod/owners.ts`
- `scripts/effect4-codemod/main.ts`
- `tests/unit/effect4Codemod/reference.test.ts`
- `tests/unit/effect4Codemod/origin.test.ts`
- `tests/unit/effect4Codemod/offline.test.ts`
- `tests/unit/effect4Codemod/__fixtures__/reexport/effectReexport.ts`
- `tests/unit/effect4Codemod/__fixtures__/reexport/uses.ts`
- `tests/unit/effect4Codemod/__fixtures__/reexport/expected-uses.ts`
- `tests/integration/effect4CodemodCli.test.ts`

### Planned files to edit

- `scripts/effect4-codemod/rules.ts`
- `scripts/effect4-codemod/codemod.ts`
- `tests/unit/effect4Codemod/rules.test.ts`
- `tests/unit/effect4Codemod/report.test.ts`
- `package.json`
- `pnpm-lock.yaml`

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Codemod to ts-morph: the codemod consumes ts-morph only for parsing, import resolution through relative modules, and node spans; it never uses the bundled compiler's type checker for origin. Codemod to vendored reference: it consumes v3-to-v4.md as read-only data at fixed line numbers. Codemod to its later callers: `rewriteFiles` and the CLI output the spec §6 shows; phase-06 adds counts and `--ratchet` on top of `main.ts`.

### Test strategy

- a symbol reached through a local re-export of effect is rewritten — small · example · __fixtures__/reexport/expected-uses.ts · in-phase · ac-codemod-origin
- the codemod loads only node builtins, ts-morph pinned exactly, and local modules, all from devDependencies — small · example · package.json devDependencies and pnpm-lock.yaml · in-phase · ac-codemod-offline
- the reference parser places Import Map, API entries, none entries and headings at their lines — small · example · known lines 689, 10003, 13066 and a -> none entry of the vendored file · in-phase
- on a temporary tree, --check reports and exits 1, a write run rewrites, and a second --check reports 0 files would change — medium · smoke · exit codes and printed lines · in-phase · ac-codemod-idempotent

### Implementation order

1. pnpm add ts-morph
2. reference.ts and its test
3. owners.ts
4. rules.ts and codemod.ts, until the acceptance tests pass with markers removed
5. origin re-export fixture and test
6. main.ts and the package script
7. offline and CLI tests

### Excluded scope

- Type-error counts, the counts file and --ratchet (phase-06).
- Running the codemod on this repository, installing Effect 4, or editing any Effect call site.
- The skills the owner table names (phase-07).

### Verification

The `standard` gate profile in phax.json, with the acceptance provider judging the passed tests.

### Expected handoff content

The exact module paths and exports of `scripts/effect4-codemod/` (rules, codemod, reference, owners, main), the CLI flags and output format, the target globs and exclusions, the owner table (modules and overrides), and the ts-morph version installed. Note any rule whose behaviour is narrower than its mapping list suggests, and any deviation from the planned files.

### Commit subject

`feat(effect4): add the codemod:effect4 rewriter on ts-morph`

### Commit body

Add phax's own Effect 4 codemod, pinned on ts-morph 28.0.0. It applies eight rules taken from the vendored v3-to-v4.md and rewrites only matched spans. It decides that a symbol comes from effect through its import bindings, including local re-exports, and lists every v3 symbol it leaves by file, line, reference line and owning topic skill.

`pnpm codemod:effect4` writes the changes and `--check` reports what would change. It fetches nothing at run time. This passes the acceptance tests frozen in the previous phase.

---

## phase-06 — Type-error counts, the ratchet and the effect-migration gate profile {#phase-06-ratchet-and-profile}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A new gate mechanism whose base must be read from the right commit: a mistake lets a later phase pass with more errors. It needs more effort than the default.

Make the codemod measure the type-error counts of `src` and of the test suite before and after a write run. Add `--ratchet`, which compares the counts against those committed at the phase's base and records them for the next phase. Add the `effect-migration` gate profile that runs it every phase and the full standard checks at the end.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Create `scripts/effect4-codemod/counts.ts`. A pure `parseTscErrors(output)` counts `error TS` diagnostics by file. `measureCounts(root, run)` runs `node_modules/.bin/tsc --noEmit -p tsconfig.json --pretty false` (src) and `node_modules/.bin/tsc --noEmit -p tsconfig.test.json --pretty false` (tests: errors whose file is not under `src/`), through an injected runner so tests can supply output.
- Create `scripts/effect4-codemod/ratchet.ts`. `RATCHET_FILE = "scripts/effect4-codemod/type-error-counts.json"` holds `{ "src": number, "tests": number }`. A pure `judge(base: Counts | null, measured: Counts)` returns record-first (base null), pass (each count at or below its base) or fail (naming each count above its base). `runRatchet(root)` reads the base with `git show HEAD:<RATCHET_FILE>`, treating a missing path as null and a malformed file as a failure. It never reads the working tree's copy. It measures, judges, and on a pass or record writes `JSON.stringify(counts, null, 2) + "\n"`; on a failure it writes nothing and exits 1. Do not create the counts file in this plan.
- Extend `main.ts`. A default (write) run measures before, rewrites, measures after, and prints `type errors   before  after` with `src` and `tests` rows after the rule table. `--ratchet` runs `runRatchet` only. `--check` stays as it is.
- Add to phax.json's `gateProfiles` an `effect-migration` profile: every-phase `pnpm format` (local), `pnpm codemod:effect4 --ratchet` (local), `pnpm lint` (local); terminal `pnpm check:full` (local), `pnpm build` (product), `pnpm site:build` (product), `pnpm deno:smoke` (product), `pnpm deno:smoke-binary` (product). Leave `standard` unchanged.
- Per open question q-guard: if decided `protect`, also add `"protectedPaths": ["tests/effect4Corpus/cases/**", "tests/effect4Corpus/baseline/**", "scripts/effect4-codemod/ratchet.ts", "scripts/effect4-codemod/counts.ts"]` to phax.json, check with `pnpm dev` (or the config tests) that it decodes, and never list the counts file. If decided `review-only`, add no key.
- Tests: `tests/unit/effect4Codemod/counts.test.ts` (parsing recorded tsc output: zero errors, src-only, tests-only, mixed, a multi-line diagnostic); `tests/unit/effect4Codemod/ratchet.test.ts` (the `judge` table); `tests/integration/effect4Ratchet.test.ts` (a temporary git repository with a committed counts file and a fake measure: the run passes and writes at or under the base, fails and writes nothing above it, records when HEAD has no file, and still compares against HEAD after the working-tree file is edited to a higher base); `tests/unit/effect4Codemod/gateProfile.test.ts` (phax.json decodes through phax's config decoder, `effect-migration` exists, its every-phase steps include the ratchet, and its terminal steps include `pnpm check:full` and every terminal step of `standard`).
- No `any`, no `as` other than `as const`.

### Planned files to create

- `scripts/effect4-codemod/counts.ts`
- `scripts/effect4-codemod/ratchet.ts`
- `tests/unit/effect4Codemod/counts.test.ts`
- `tests/unit/effect4Codemod/ratchet.test.ts`
- `tests/integration/effect4Ratchet.test.ts`
- `tests/unit/effect4Codemod/gateProfile.test.ts`

### Planned files to edit

- `scripts/effect4-codemod/main.ts`
- `phax.json`

### Optional files that may be edited

- `tests/integration/effect4CodemodCli.test.ts`
- `scripts/effect4-codemod/offline.test.ts`

### Boundary contracts

Gate to ratchet: phax's gate (consumer) runs `pnpm codemod:effect4 --ratchet` before it commits a phase and needs only an exit code and readable output. The ratchet (producer) owns `scripts/effect4-codemod/type-error-counts.json`: it reads it from HEAD, writes it to the working tree on a pass, and phax's commit carries it to the next phase's base.

### Test strategy

- the ratchet records with no base, passes at or under the base, and fails above it on either count — small · table · judge table over (base absent, equal, lower, higher per count) · in-phase · ac-green
- the base comes from HEAD, so editing the working-tree counts file cannot raise it — medium · example · a temporary git repository with a committed counts file · in-phase · ac-green
- tsc output is counted per side, src versus tests — small · example · recorded tsc outputs and their expected counts · in-phase · ac-codemod-measure
- a write run prints before and after counts for src and tests — small · example · expected printed table with an injected counter · in-phase · ac-codemod-measure
- phax.json decodes with an effect-migration profile whose terminal steps cover check:full and every standard terminal step — small · example · phax.json's standard profile and the spec §6 profile · in-phase · ac-green

### Implementation order

1. counts.ts and its test
2. ratchet.ts judge and its table test
3. runRatchet and the git integration test
4. main.ts wiring
5. phax.json profile (and protectedPaths per q-guard), with gateProfile.test.ts

### Excluded scope

- Creating type-error-counts.json; the first Effect 4 phase records it.
- Running the codemod or the ratchet on this repository's gates (the standard profile stays this plan's gate).
- Commit-body content of the later codemod commit.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The counts file path and shape, the exact tsc invocations and how test-side errors are separated, the ratchet's outcomes and exit codes, the printed table format, the `effect-migration` profile as committed, and whether `protectedPaths` was added (and its globs) per q-guard.

### Commit subject

`feat(effect4): add type-error counts, the ratchet and the effect-migration profile`

### Commit body

The codemod now prints the type-error counts of src and of the test suite before and after a write run. `--ratchet` reads the counts committed at the phase's base from HEAD. With none there, it records the first counts; otherwise it fails when either count rises, and on a pass it records the new counts for the next phase.

phax.json gains the effect-migration gate profile: format, the ratchet and lint every phase, and check:full plus every standard terminal step at the end.

---

## phase-07 — Migration skills: lookup and topic skills {#phase-07-migration-skills}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Install the project skills the later plans' phases follow: `effect4-lookup`, which says how to resolve one error from local files only, and one topic skill per migration area (services, errors, schema, core), each stating the files and v3 symbols a phase following it may change.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Per open question q-official-text: if decided `vendor-text`, read the official skill from `docs/vendor/effect-skills/effect-v3-to-v4/SKILL.md` (vendored by the operator before the run, with its SOURCE) and quote its lookup discipline, hard prohibitions and done condition verbatim, citing repository, path and commit. If decided `restate`, restate them in phax's words from the spec's §1 and §10, citing `https://github.com/Effect-TS/skills` `skills/effect-v3-to-v4/SKILL.md` with no version. Carry over none of its clones, sub-agents or `disable-model-invocation`.
- `.claude/skills/effect4-lookup/SKILL.md`: frontmatter `name`, `description`. Resolve one error in this order: search `docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md` for the symbol (grep, never read it whole), then the topic guide under `migration/` or `MIGRATION.md`, then the installed source under `node_modules/effect/`. Check `SOURCE` names tag `effect@4.1.2`. No compatibility module, no `any` or `as` to silence an error (`as const` and fixture brand casts are not silencing), no API absent from both the reference and the installed source. Never clone, fetch, `npx` or start a sub-agent. Never hand-apply a rename a codemod rule covers: run the codemod.
- Each topic skill (`effect4-services`, `effect4-errors`, `effect4-schema`, `effect4-core`) has frontmatter; the line every plan phase writes first (`Follows skill: effect4-<topic> (with effect4-lookup for every symbol)`); a `## May change` section listing file globs; a `## v3 symbols` section listing the modules and symbols it owns, matching `scripts/effect4-codemod/owners.ts`; the behaviour guards that apply (schema: refusal wording and `formatError.ts`'s `is missing`, `is unexpected`, `Expected X, actual Y`, frozen decoders and the `history.lock.json` refresh in the same commit naming the Effect 4 migration, JSON Schema equivalence by the corpus, no `next` snapshot; services: ports keep their names and shapes; errors: defect and interruption semantics per the reference lines 10003, 10057, 10189); and the done condition: the ratchet passes and the phase's leftovers in `pnpm codemod:effect4 --check` are gone. Scopes are as listed in Technical arbitrations; `effect4-schema` owns `tests/effect4Corpus/subjects.ts` and never the case files, baseline files or corpus tests.
- Create `tests/unit/effect4Skills.test.ts`: every topic skill has non-empty `## May change` and `## v3 symbols` sections; the lookup skill names the vendored reference path, `node_modules/effect`, and none of `git clone`, `fetch`, `curl`, `npx` or `sub-agent`; every owner `owners.ts` can return is an existing `.claude/skills/<owner>/SKILL.md`; every path the skills cite under `docs/vendor/` exists; the reference's `SOURCE` names the tag the skills cite.
- The skills are not added to package.json's `files`; they ship with no npm package and are removed by the spec's last plan.

### Planned files to create

- `.claude/skills/effect4-lookup/SKILL.md`
- `.claude/skills/effect4-services/SKILL.md`
- `.claude/skills/effect4-errors/SKILL.md`
- `.claude/skills/effect4-schema/SKILL.md`
- `.claude/skills/effect4-core/SKILL.md`
- `tests/unit/effect4Skills.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `scripts/effect4-codemod/owners.ts`
- `CLAUDE.md`

### Boundary contracts

Skills to plan phases: a later plan's phase (consumer) names one topic skill and needs from it a closed file scope and symbol list. The skills (producer) state both, consistent with the codemod's owner table, which is what the codemod's leftover report routes each symbol to.

### Test strategy

- each topic skill names the files and v3 symbols it may change, and the lookup skill names no clone, fetch, npx or sub-agent — small · example · the skill files' sections and a forbidden-word list · in-phase · ac-skills
- every owner the codemod reports is an installed topic skill — small · table · owners.ts against .claude/skills directories · in-phase · ac-skills
- the lookup skill reads the reference from local files at the tag its SOURCE names — small · example · docs/vendor/effect-migration/effect@4.1.2/SOURCE · in-phase · ac-reference-offline

### Implementation order

1. effect4-lookup
2. effect4-schema, effect4-services, effect4-errors, effect4-core, each checked against owners.ts
3. effect4Skills.test.ts

### Excluded scope

- Migrating any code by following the skills (later plans).
- Editing the vendored reference or vendoring anything (the operator does, per q-official-text).
- CLAUDE.md's Effect 4 wording (the spec's last plan).

### Verification

The `standard` gate profile in phax.json. The run needs `phax run --allow-skill-edits`.

### Expected handoff content

The five skill paths, each topic skill's file scope and symbol list, which q-official-text option was applied and the source cited, and any change made to owners.ts to keep it consistent with the skills.

### Commit subject

`docs(skills): add the effect4 lookup and topic skills`

### Commit body

Add effect4-lookup, which resolves one error from the vendored reference, its topic guides and the installed effect source, with no network, sub-agent, compatibility layer or silencing cast. Add the four topic skills (services, errors, schema, core), each stating the files and v3 symbols a phase following it may change.

The skills agree with the codemod's owner table, and a test holds both to it.

---

## phase-08 — CONTRIBUTING note on the Effect 4 migration tools {#phase-08-contributing-note}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Tell a maintainer how the Effect 4 migration tools work: `pnpm codemod:effect4` and its flags, the behaviour corpus and why it is never re-captured, the `effect-migration` gate profile and its ratchet, the vendored reference and the migration skills, and that all of it leaves with the spec's last plan.

### Detailed instructions

- Follows skill: none (groundwork on Effect 3).
- Add a short `## The Effect 4 migration` section to CONTRIBUTING.md, after `## Tests`. Cover: `pnpm codemod:effect4` (writes, prints per-rule rewrites, the leftovers by owner and the before/after type-error counts), `--check`, `--ratchet` and its counts file; the behaviour corpus under `tests/effect4Corpus/` (captured on Effect 3 by `pnpm exec tsx scripts/effect4-corpus-capture.ts`, which refuses any other major; the case files and baseline are never re-captured, and only `subjects.ts` is migrated); the `effect-migration` gate profile; the vendored reference under `docs/vendor/effect-migration/effect@4.1.2/`; the `effect4-*` skills; and that the codemod, its dependency and the reference are removed by the migration's last plan.
- Use phax's words; name commands exactly as the package scripts and phax.json have them (read both). Keep it to a handful of short paragraphs or a table.

### Planned files to create

- (none)

### Planned files to edit

- `CONTRIBUTING.md`

### Optional files that may be edited

- (none)

### Test strategy

- (none)

### Implementation order

1. Read package.json, phax.json and the previous handoffs
2. Write the section

### Excluded scope

- docs/upgrading.md and packages/schemas/README.md (the release that ships the migration).
- README.md and the docs site.
- CLAUDE.md.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The section's heading and what it covers; any command it names that does not exist yet in the tree, which should be none.

### Commit subject

`docs(contributing): describe the Effect 4 migration tools`

### Commit body

Document, for maintainers, the Effect 4 migration tools this plan adds: pnpm codemod:effect4 and its --check and --ratchet modes, the behaviour corpus captured on Effect 3, the effect-migration gate profile, the vendored reference and the effect4 skills. Also note that they leave with the migration's last plan.
