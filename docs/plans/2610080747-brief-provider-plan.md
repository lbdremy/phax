---
status: Draft
source-spec: docs/specs/2610061346-brief-provider.md
---
# Brief provider

Implements the whole of the Approved spec `brief-provider` (docs/specs/2610061346-brief-provider.md), so this plan completes the spec. A configured `brief` provider gets a versioned `brief-request` on stdin and answers a versioned `brief-answer` on stdout: the guarantees that range over some paths, and their state at each place. phax pushes the phase's brief in compact form into the phase's first prompt. The agent pulls more with `phax brief [path…]` and gets the whole form. Every brief is recorded as `brief-NN.json` in the phase folder, and `phax records explain --briefs` prints them. A brief never blocks and phax judges nothing in it: decoding the answer by its own `$schema` is the only check. The spec's §9 Q1–Q10 were decided by the author and are not reopened.

Ground: `drop-orient`, `drop-gate-scopes` and `gate-request` have landed. The running release is `0.19.0` (`src/schemas/release.ts`). Read the code, not the spec's §1 ground. The phase facts come from the landed gate request: `makeGateRequest` (src/domain/gate/gateRequest.ts) builds them from the base noted in `status.json` (`readPhaseBase`, src/app/phaseStatusUpdates.ts), the terminal flag and `plan.phases`. The bridge (src/schemas/persisted.ts) already reads one provider answer, `readGateDiagnosticsAnswer`, and `brief-answer` gets a sibling reader with the same guard test. `phax run --append` is not built.

The phases go inside-out and each is green on its own: the three formats, then the config key and the provider query, the pushed brief, the `phax brief` command, the pulled records and the grant, the record view, and finally docs and the hello-world example. Every phase is verified by the `standard` gate profile. Test documents and fixtures are made up. Nothing from `~/.phax` or another repository enters this repository.

## Required commands

- `pnpm exec tsx`
- `pnpm dev schema upgrade`
- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `node`

Every command above is already allowed by `security.agentCommands` in this repository's phax.json, so the preflight passes with no configuration change. `pnpm exec tsx` runs `scripts/schemas-check.ts --write` and `scripts/schemas-json.ts`. `pnpm dev schema upgrade` regenerates `phax.schema.json` and `phax.user.schema.json`. `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate `phax.usage.kdl`, `docs/cli/reference.md` and the README CLI reference block. `node` runs the made-up provider scripts and the hello-world `brief.mjs` by hand.

## Technical arbitrations

- Answer versioning (Q10) uses a sibling reader, not a generalisation. `readBriefAnswer` in src/schemas/persisted.ts mirrors `readGateDiagnosticsAnswer`. The answer must carry its own `$schema` naming `brief-answer`. A release newer than `PHAX_RELEASE` is refused by name. A release counts as an answer release only when it equals the running release or is newer than `LAST_RELEASE_WITHOUT_BRIEF_ANSWER`, the release current when the format is added (0.19.0 at authoring). The current decoder then reads it. A guard unit test fails as soon as `snapshots/brief-answer/` holds a second answer shape. Loss accepted: the change that adds a second answer shape has to teach the reader, and the guard forces it to.
- The phase facts have one builder and one set of inputs. executePlan builds them once per phase entry with `makeGateRequest`, from the base noted in status.json, the loop's `isFinal` and `plan.phases`. The gate request and the brief request are both cut from that one value, and the brief request adds only `files`. A pull never recomputes facts: it copies them from `.phax-context/brief-request.json`. Loss accepted: a pull trusts a file the agent can edit (Q2), and this misleads only the agent's own advice.
- The pushed brief is requested once per phase folder, exactly when `brief-00.json` is absent. A rate-limited phase re-enters the fresh path with its branch and folder kept, and rebuilds its first prompt. Its brief section is re-rendered from the recorded `brief-00.json`, with no provider call (§5.6). `reset-phase` archives the folder, so the re-run asks again. `run --append` is not built, and the same rule covers it when it lands. Loss accepted: after a rate-limit pause, the prompt shows the brief as the code stood at the phase's first start.
- Pulled records go through `.phax-context/`. `phax brief` writes `.phax-context/briefs/brief-NN.json`, numbered from 01 as the next free number. A new `FileSystem.createExclusive` claims each number, so concurrent pulls never overwrite each other. At the phase's terminal outcome (committed or failed), phax copies those files into the phase folder and writes the marker `.phax-context/briefs/closed`. This happens before the phase record is written, and whether records are on or off. A pull that finds the marker is answered and not recorded (Q7). Loss accepted: the agent can edit or delete its own pulled records before they are collected, the same trust as the phase request file. A paused phase collects nothing until it ends.
- An in-phase pull reads config from the main working tree. `phax brief` finds the repository's main checkout through git's common dir and loads phax.json, phax.local.json and ~/.phax/config.json from there. It runs the provider from the phase worktree's root. Otherwise a `brief` declared only in the gitignored phax.local.json, absent from every worktree, would be invisible to pulls (§5.1). Loss accepted: `phax brief` is the one command that reads config outside the cwd's working tree. It reads the main checkout's phax.json, not the phase branch's copy. That copy is the config the run itself loaded.
- `brief-record` embeds the answer as printed, as an open JSON object. The package parser `parseBriefAnswer` resolves it by its own `$schema`. phax gets the provider's stdout through `runProviderQuery` with an identity decoder, then decodes it with `readBriefAnswer`, so the record keeps the parsed value untouched. Loss accepted: `parseBriefRecord` does not validate the embedded answer. A consumer calls `parseBriefAnswer` on `outcome.answer`.
- The 60-second limit is a constant (`BRIEF_TIMEOUT_MS`, Q9), the same for pushes and pulls. The query takes an internal `timeoutMs` override only so tests can prove the provider process is stopped without waiting a minute. Loss accepted: none in behaviour, because the override is unreachable from config or flags.
- The grant lands with the command, in phase-05, not with the config key. `phax brief` is added to the frozen agent commands with source `brief`, after `config` and `gate`, so an explicit config entry keeps source `config`. It is a narrow allowance, so it is degraded on providers without prefix enforcement, like any narrow command. Loss accepted: a secure Codex or Vibe run with a brief provider always carries the `command-precision` mark.
- Briefs emit no telemetry events: the brief records are the account (spec §10 left this open). Loss accepted: brief latency and failures appear in no OpenTelemetry span or metric. They are read from `brief-NN.json` and the run output's warnings.
- `phax records explain` with no flag prints a `briefs   N` line only when the record holds brief files, and `--briefs` prints them. A record with no brief files prints exactly as today. Loss accepted: a record from a project without a brief provider does not say why it has none.
- The compact line, the whole-form layout, the section heading, the instruction wording and the refusal wording follow spec §6's indicative examples, rendered by a pure module in src/domain/brief/render.ts. A missing or invalid phax.json makes `phax brief` exit 2, like every command (README §Exit codes). Every case the spec names exits 1. Loss accepted: an invalid config is the one `phax brief` failure that does not exit 1.
- The phase split departs from the brief's suggested six phases. It uses seven, so the `phax brief` command (phase-04) and the executePlan wiring that collects its records and grants it (phase-05) each stay reviewable. Loss accepted: one more commit, and between phase-03 and phase-05 the prompt names a command the agent is not yet granted. The run lands all seven commits together.

---

## phase-01 — The three brief formats {#phase-01-brief-formats}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

The brief's three documents become published persisted formats. phax declares their schemas. The schemas package parses each with its own parser and `parseDocument`. The bridge reads a provider's versioned answer the way it reads a diagnostics answer, so the later phases only have to write and read them.

### Detailed instructions

- src/schemas/gateRequest.ts: export the existing `gateRequestFields` object, or rename it `phaseFactFields` and keep a re-export, so the brief request spreads exactly the same field schemas. Change nothing else. The `gate-request` next snapshot must stay byte-identical, and `scripts/schemas-check.ts` proves it.
- Create src/schemas/brief.ts. Location: `Schema.Struct({ file: Schema.NonEmptyString, line: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), { exact: true }) })`, the same shape as a diagnostics finding's location. Define it locally rather than changing src/schemas/gateDiagnostics.ts.
- In the same file, the place variants are keyed by `state`. `met` is `{location, state}`. `missing` and `forbidden` are each `{location, state, due, what, repair}`. `accepted` is `{location, state, what}`. `due` is `Schema.NullOr(Schema.Literal("this-phase", "later"))`. `what` and `repair` are `Schema.NonEmptyString`.
- A guarantee is `{ id: NonEmptyString, statement: NonEmptyString, places: Schema.NonEmptyArray(Place) }`. `BriefAnswerFileSchema = Struct({ $schema: schemaUrlField("brief-answer"), guarantees: Schema.Array(Guarantee) })`. `decodeBriefAnswerFile = Schema.decodeUnknownEither(BriefAnswerFileSchema)` keeps effect's default, so unknown keys are ignored at every level (§5.16). Export the types `BriefAnswer` (no `$schema`), `BriefGuarantee`, `BriefPlace` and `BriefAnswerFile`.
- Request: `PhaseBriefRequestFileSchema = Struct({ $schema: schemaUrlField("brief-request"), ...gate request fields (phase, base, terminal, phases), files: Schema.NullOr(Schema.NonEmptyArray(Schema.NonEmptyString)) })`, keys in that order. `OutsideBriefRequestFileSchema = Struct({ $schema, files: Schema.NonEmptyArray(Schema.NonEmptyString) })`. `BriefRequestFileSchema = Schema.Union(Phase…, Outside…)`, decoded with `onExcessProperty: "error"` (§5.12). Annotate `files` from spec §4: null for the phase's brief, otherwise working-tree-root-relative paths, deduplicated, in the order given, never checked for existence. Export the file types, the in-memory types without `$schema`, `decodeBriefRequestFile` and `encodeBriefRequestFile`.
- Record: `BriefRecordFileSchema = Struct({ $schema: schemaUrlField("brief-record"), moment: Literal("pushed", "pulled"), request: BriefRequestFileSchema, outcome: Union(Struct({ kind: Literal("answered"), answer: Schema.Record({ key: Schema.String, value: Schema.Unknown }) }), Struct({ kind: Literal("failed"), reason: Schema.NonEmptyString })) })`. Decode it with `onExcessProperty: "error"`. `answer` is an open object holding the provider's document as printed, its own `$schema` and any extra key included. Annotate it that way. Export `decodeBriefRecordFile`, `encodeBriefRecordFile` and the types.
- src/schemas/schemaUrl.ts: append `"brief-request"`, `"brief-answer"` and `"brief-record"` to `FORMAT_IDS`, after `gate-request`, and to `SCHEMA_BORN_FORMAT_IDS`.
- Bridge (src/schemas/persisted.ts), part 1: add the constant `LAST_RELEASE_WITHOUT_BRIEF_ANSWER`. Set it to the value of `PHAX_RELEASE` in src/schemas/release.ts when this phase runs (0.19.0 at authoring). Its comment says it is a historical fact that never moves at a cut. Add `BriefAnswerError = { kind: "schema"; reason } | { kind: "newer"; reason } | { kind: "shape"; reason }`.
- Bridge, part 2: add `readBriefAnswer(input): Either<BriefAnswer, BriefAnswerError>`. It never throws, and checks in order. (1) A non-object is a `shape` error. (2) A document without its own `$schema` is a `schema` error: 'a brief-answer document must carry $schema'. (3) If `parseSchemaUrl` gives undefined or another format, it is a `schema` error naming the value. (4) A release newer than `PHAX_RELEASE` is a `newer` error: 'brief-answer written by phax <R> is newer than this phax (<P>) — upgrade phax to read it'. (5) A release that is neither the running one nor newer than `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` is a `schema` error: 'brief-answer <R> has no known shape'. (6) A decode failure is a `shape` error: 'schema mismatch: <first violation>'. On success it returns `{ guarantees }` only.
- Bridge, part 3: add `describeBriefAnswerError(error): string`. It returns 'brief answer refused at $schema: <reason>' for `schema` and `newer`, and 'brief answer refused: <reason>' for `shape`.
- Bridge, part 4: add `readBriefRequestFile` and `readBriefRecordFile` as `Reader`s through `readSchemaBornPersisted`, labels 'brief request' and 'brief record', each `fromCurrent` dropping `$schema`. Update the module header comment: the bridge now reads two answers.
- Create packages/schemas/src/formats/brief.ts, modelled on the gate-request block of recordTimeline.ts. It has three `defineFormat` calls with `preSchema: null`, `releases: []` and current shape `CURRENT_SHAPES[<id>]`, labels 'brief request', 'brief answer' and 'brief record'. Add the parsers `parseBriefRequest`, `parseBriefAnswer` and `parseBriefRecord`, each with a doc comment naming where the document lives (spec §6 table). Add `LatestBriefRequest`, `LatestBriefAnswer` and `LatestBriefRecord`, and `toLatest…` functions that drop the top-level `$schema` and keep every other fact; a record's embedded request and answer stay as recorded.
- packages/schemas/src/index.ts: export the schemas as `BriefRequestSchema`, `BriefAnswerSchema` and `BriefRecordSchema`, the file types as `BriefRequest`, `BriefAnswer` and `BriefRecord`, plus the parsers, the toLatest functions and the shape types. Add the three ids to `DocumentShapes` and to `parseDocument`'s definitions. packages/schemas/build/jsonSchemas.ts: add the three formats to `FORMAT_DEFINITIONS` and to `EXCESS`, with `brief-request` "error", `brief-answer` "ignore" and `brief-record` "error".
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It records the three `next` snapshots and their `CURRENT_SHAPES` entries in packages/schemas/src/generated/index.ts. Then run `pnpm exec tsx scripts/schemas-json.ts` (json/ is gitignored build output). Never write snapshots or generated files by hand.
- README.md §Persisted formats: add three rows after the Gate request row, with the spec §6 locations and keeping the table aligned. Brief request (`<worktree>/.phax-context/brief-request.json`, `request` in a brief record). Brief answer (the brief provider's stdout, `outcome.answer` in a brief record). Brief record (`<record>/brief-NN.json`).
- tests/integration/persistedProducer.test.ts: add all three ids to `NEVER_WRITTEN`. `brief-answer` stays there for good: its comment says phax never writes one as a file, because it is the provider's stdout held inside a brief record. `brief-request` and `brief-record` carry a comment that the brief-provider plan's phase-03 starts writing them.
- All test documents are made up: a 40-hex base, `phase-01`/`phase-02`, invented paths and guarantee ids.

### Planned files to create

- `src/schemas/brief.ts`
- `packages/schemas/src/formats/brief.ts`
- `packages/schemas/snapshots/brief-request/next.schema.json`
- `packages/schemas/snapshots/brief-answer/next.schema.json`
- `packages/schemas/snapshots/brief-record/next.schema.json`
- `tests/unit/schemas/brief.test.ts`
- `tests/unit/schemasPackage/briefFormats.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/gateRequest.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `README.md`
- `tests/unit/persisted.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/type/schemasPackage.ts`

### Optional files that may be edited

- `tests/unit/schemaUrl.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/parseDocument.test.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/site/schemas.test.ts`
- `site/build/schemas.ts`
- `packages/schemas/README.md`
- `scripts/schemas-smoke.ts`

### Boundary contracts

phax schemas → schemas package: the package re-exports phax's own file schemas and decoders and declares nothing of its own. The contracts fixed here are inherited by every later phase and by steme's `steme brief`. The request is two variants with exactly their keys. The answer is `{$schema, guarantees: [{id, statement, places}]}` with per-state places, and extra keys are ignored. The record is `{$schema, moment, request, outcome}`, with the answer kept as printed. Bridge → app: `readBriefAnswer` returns the decoded `{guarantees}` or a typed error, and `describeBriefAnswerError` gives the one-line reason the run output, the prompt and `phax brief` all show.

### Test strategy

Write first. In tests/unit/schemas/brief.test.ts, the request: both variants decode; an extra key, a missing key, `files: []`, a 7-character base and a `$schema` naming another format are each refused. The answer: the spec §6 example decodes; `state: "stale"`, a `missing` place without `repair` and a guarantee with `places: []` are each refused; a `met` place with an extra `score` decodes. The record: a pushed record with an answered outcome, and a pulled record with a failed outcome, both decode; an extra top-level key is refused.

In tests/unit/persisted.test.ts, a `readBriefAnswer` block mirrors the diagnostics one. A running-release answer decodes and drops `$schema` and extra keys. A newer release gives `newer` naming `brief-answer` and the release. No `$schema`, another format, `not a url`, and 0.18.0 when 0.19.0 is the last release without the format each give `schema`. A variant violation gives `shape`. A non-object never throws. Add `describeBriefAnswerError` cases and readBriefRequestFile/readBriefRecordFile round-trips, and refusals without `$schema`. Add the guard test: the `next` and release-named snapshots under `packages/schemas/snapshots/brief-answer/` newer than `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` number exactly one, with the message 'a second brief-answer answer shape: teach readBriefAnswer to decode each answer release with its own shape'.

Then tests/unit/schemasPackage/briefFormats.test.ts: each parser reads a next document as the current shape and refuses the same document without `$schema`, at `$schema`. `parseDocument` identifies all three. `parseBriefAnswer` reads a record's `outcome.answer`. Update documents.ts and parity.test.ts with one entry per format, and tests/type/schemasPackage.ts for the exports and `DocumentShapes`. Adjust any test that enumerates FORMAT_IDS or the JSON Schema files.

### Implementation order

1. Export the gate request fields; write src/schemas/brief.ts with tests/unit/schemas/brief.test.ts.
2. FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS.
3. Bridge readers and the guard test in tests/unit/persisted.test.ts.
4. Package formats file, index exports, parseDocument, build/jsonSchemas.ts.
5. Run scripts/schemas-check.ts --write and scripts/schemas-json.ts.
6. README rows, persistedProducer NEVER_WRITTEN, package and type tests.

### Excluded scope

- Writing any brief document, the `brief` config key, querying a provider (phases 02–04).
- Releasing the formats: they stay `next` until a release cut.
- Any change to the gate-request, gate-diagnostics or other formats' shapes.
- A pre-schema shape, a fallback for an unstamped answer, or re-stamping an answer.
- Any `.claude/skills/` edit: report a skill that should mention the formats in the handoff.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exact exports of src/schemas/brief.ts and of the bridge (`readBriefAnswer`, `BriefAnswerError`, `describeBriefAnswerError`, `readBriefRequestFile`, `readBriefRecordFile`, `LAST_RELEASE_WITHOUT_BRIEF_ANSWER` and its value). The name under which the gate request's fields are exported. Confirmation that all three ids are in FORMAT_IDS, SCHEMA_BORN_FORMAT_IDS and persistedProducer's NEVER_WRITTEN, and which two phase-03 removes. The generated files the scripts wrote, the package exports added, and confirmation that the gate-request snapshot is unchanged. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(schemas): add the brief-request, brief-answer and brief-record formats`

### Commit body

Define the three documents a brief provider exchanges with phax: `brief-request` (in a phase, `$schema` plus the gate request's phase facts plus `files`; outside one, `$schema` and `files` only), `brief-answer` (`{$schema, guarantees}`, with per-state place variants) and `brief-record` (one brief call: moment, request as sent, outcome, with the answer as printed).

All three are born with `$schema`, join FORMAT_IDS, are read by the schemas package's parseBriefRequest, parseBriefAnswer, parseBriefRecord and parseDocument, and record `next` snapshots. The bridge gains readBriefAnswer, a sibling of readGateDiagnosticsAnswer. It requires the answer's own `$schema`, refuses a newer release by name, and has a guard test that fails when a second answer shape appears. It also gains readers for the request and record files. README §Persisted formats gets the three rows.

---

## phase-02 — The brief provider key and its query {#phase-02-brief-provider-query}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A project can declare a brief provider in any config layer, and phax can ask it a versioned question and get back either a decoded answer, kept as printed, or a one-line reason why there is none. Nothing in a run calls it yet.

### Detailed instructions

- src/schemas/phaxConfig.ts: add `BriefConfigSchema = Schema.Struct({ command: Schema.NonEmptyString.annotations({ description }) })`. The description follows spec §6: 'The brief provider command, split on whitespace with no shell. phax writes a brief request on its stdin and reads a brief answer, carrying its own $schema, on stdout. A brief informs and never blocks. Full contract: `phax --usage`, cmd brief.' Export `type BriefConfig`. Add `brief: Schema.optional(BriefConfigSchema)` to `PhaxConfigSchema` and `PhaxUserOverlaySchema`, placed before `planAuditor`, and `readonly brief?: BriefConfig` to `ResolvedConfig`.
- src/domain/config/mergeLayers.ts: `briefCommand = localUser?.brief?.command ?? globalUser?.brief?.command ?? project.brief?.command`, and emit `brief: { command }` only when defined, exactly as `planAuditor`. src/app/loadConfig.ts: pass `brief` through to the resolved config like `planAuditor`. Nothing about `orient` anywhere.
- Run `pnpm dev schema upgrade` to regenerate phax.schema.json and phax.user.schema.json; phax.json must stay byte-identical.
- Create src/domain/brief/request.ts (pure). It exports `phaseBriefRequest(facts: GateRequest, files: readonly [string, ...string[]] | null)`, which returns `{ phase, base, terminal, phases, files }` in that key order and copies `phase`, `base`, `terminal` and `phases` from `facts` unchanged, never recomputing them. It also exports `outsideBriefRequest(files: readonly [string, ...string[]])`, which returns `{ files }`. Type the results with phase-01's in-memory request types.
- Create src/app/briefProvider.ts, part 1. Export `BRIEF_TIMEOUT_MS = 60_000` with a comment citing spec Q9: fixed, not a config key. Export `BriefOutcome = { kind: "answered"; answer: unknown /* the parsed stdout, as printed */; decoded: BriefAnswer } | { kind: "failed"; reason: string }`. Export `stampBriefRequest(request)` = `withSchemaUrl("brief-request", request)`.
- src/app/briefProvider.ts, part 2: export `queryBrief({ command, request, cwd, timeoutMs = BRIEF_TIMEOUT_MS }): Effect<BriefOutcome, never, Shell>`. It calls `runProviderQuery("brief provider", command, cwd, request, Either.right, (failure) => failure, { timeoutMs })`. The identity decoder keeps the parsed value untouched. On Left, the reason is `failure.message`, plus `: <trimmed stderrExcerpt>` when present. On Right, the raw value goes through `readBriefAnswer`: a Left gives `failed` with `describeBriefAnswerError`, and a Right gives `answered` with `answer` as the raw value and `decoded` as the result. It never fails. Change src/app/providerQuery.ts only if the identity decoder does not type-check, and then only its decode parameter's type.
- src/app/briefProvider.ts, part 3: export `serializeBriefRequest(request: BriefRequestFile): string` and `serializeBriefRecord(moment, request, outcome): string`. Each is `JSON.stringify(encode…(withSchemaUrl(…)), null, 2)` with no trailing newline, the way phax writes every other JSON file in a phase folder. The record's outcome is `{ kind: "answered", answer: outcome.answer }` or `{ kind: "failed", reason }`, so the answer is never re-stamped or re-shaped (§5.35).
- Every provider script in the tests is a made-up node script in a temp dir, run through the real NodeShellLayer.

### Planned files to create

- `src/domain/brief/request.ts`
- `src/app/briefProvider.ts`
- `tests/unit/briefRequest.test.ts`
- `tests/unit/schemas/briefConfig.test.ts`
- `tests/integration/briefProvider.test.ts`

### Planned files to edit

- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `tests/unit/mergeLayers.test.ts`
- `tests/unit/upgradeConfigSchema.test.ts`

### Optional files that may be edited

- `src/app/providerQuery.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/loadConfig.test.ts`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/cli/schemaUpgrade.test.ts`
- `tests/unit/cli/validate.test.ts`

### Boundary contracts

config → app: `ResolvedConfig.brief?: { command }` is the only switch every later phase reads. The key is present exactly when some layer declares it. app → Shell port, through `runProviderQuery`: the command is split on whitespace with no shell and runs from the given cwd, with one compact JSON request on stdin, then stdin is closed. A `timeoutMs` stops it, and the Node adapter sends SIGTERM and then SIGKILL. app producer → phases 03–05 as consumers: `queryBrief` returns a `BriefOutcome` and never fails. `serializeBriefRequest` and `serializeBriefRecord` produce the bytes of `.phax-context/brief-request.json` and `brief-NN.json`.

### Test strategy

Write first: tests/unit/briefRequest.test.ts checks that `phaseBriefRequest` gives the key order, facts copied by value from a made-up `GateRequest`, and `files: null` or a list. `outsideBriefRequest` gives exactly `{ files }`.

Then tests/integration/briefProvider.test.ts, with the real Node shell and made-up scripts:
- A provider that saves stdin and `process.cwd()` gets the stamped request, which parses back equal, and runs from the given root.
- An answer with a current-release `$schema` and an extra top-level `note` is `answered`. `answer` deep-equals the printed document, `note` and `$schema` included, and `decoded` drops them.
- Exit 1 with stderr gives a reason starting 'brief provider exited with code 1' and holding the stderr text.
- `not json` with exit 0 gives a reason naming invalid JSON.
- A script that writes its pid to a file and never exits, run with `timeoutMs: 300`, gives a reason naming the timeout, and shortly after, `process.kill(pid, 0)` throws (the process is gone).
- No `$schema`, `brief-answer/99.0.0`, a gate-diagnostics URL and `not a url` each give a reason containing `$schema`, and the 99.0.0 reason names `brief-answer` and `99.0.0`.
- `state: "stale"`, `missing` without `repair` and empty `places` each give a 'brief answer refused' schema reason.
- `serializeBriefRecord` output read back through `readBriefRecordFile` has an answer deep-equal to the printed document.

tests/unit/schemas/briefConfig.test.ts: `brief` decodes in phax.json and in the overlay, an empty command is refused, and an extra key is refused. tests/unit/mergeLayers.test.ts: local overrides global, which overrides project; with none, no key. tests/unit/upgradeConfigSchema.test.ts: both local schemas have `brief` with a required `command`, and phax.json is unchanged.

### Implementation order

1. Config schema, merge and resolved config, with config tests.
2. `pnpm dev schema upgrade` and its test.
3. Domain request builders with unit tests.
4. briefProvider.ts with its integration tests.

### Excluded scope

- Any call from executePlan, the phase request file, the prompt section, brief-00.json (phase-03).
- The `phax brief` command, path resolution, pulled records (phase-04).
- The `brief` grant source (phase-05).
- A configurable time limit, cap or per-provider option in the `brief` key.
- Telemetry events for briefs (none, per Technical arbitrations).
- Any `.claude/skills/` edit.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The `BriefConfig` type and where `ResolvedConfig.brief` is set. The signatures of `phaseBriefRequest` and `outsideBriefRequest` (src/domain/brief/request.ts), and of `BRIEF_TIMEOUT_MS`, `BriefOutcome`, `stampBriefRequest`, `queryBrief`, `serializeBriefRequest` and `serializeBriefRecord` (src/app/briefProvider.ts). The exact reason strings observed for exit 1, invalid JSON, timeout and a refused answer. Whether providerQuery.ts needed a type change. Confirmation that phax.json is unchanged by `schema upgrade`. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(brief): add the brief provider key and its versioned query`

### Commit body

Accept `"brief": { "command": … }` in phax.json, phax.local.json and ~/.phax/config.json, with a nearer layer overriding a farther one, like planAuditor. phax schema upgrade describes it in both local schemas, and phax.json is untouched.

Add the brief request builders: the phase's request copies the gate request's facts and adds `files`, and the out-of-phase request holds `files` only. Add the provider query: run without a shell from a given root, one stamped request on stdin, a fixed 60-second limit, the answer read by its own `$schema`. Every failure (exit code, invalid JSON, timeout, refused or malformed answer) becomes a failed outcome with a one-line reason, never an error. An answered outcome keeps the document as printed for the record.

---

## phase-03 — The pushed brief {#phase-03-pushed-brief}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

When a phase starts fresh with a brief provider configured, its agent starts with the project's standard in view: what is expected of the planned files and how each expectation stands. phax requests that brief once, weaves it compactly into the first prompt, records it as `brief-00.json`, and leaves `.phax-context/brief-request.json` in the worktree. A provider failure never blocks the phase.

### Detailed instructions

- Phase facts, one builder (src/app/executePlan.ts): add a local helper `phaseFactsFor(phaseFolderPath, phaseId, isFinal)` = `readPhaseBase(phaseFolderPath)` then `makeGateRequest({ phaseId, base, terminal: isFinal, phases: plan.phases })`. The gate block calls it instead of building the request inline, and passes `serializeGateRequest(facts)` as today. The gate request bytes must not change, and tests/integration/gateRequest.test.ts must stay green unchanged.
- Create src/app/pushedBrief.ts. Export `PHASE_BRIEF_REQUEST_FILE = join(PHAX_CONTEXT_DIR, "brief-request.json")` and `PUSHED_BRIEF_RECORD = "brief-00.json"`. Export `writePhaseBriefRequest(worktreePath, request: BriefRequestFile)`: it does `mkdirp` on `<worktree>/.phax-context` and then `fs.writeAtomic` with `serializeBriefRequest(request)`.
- src/app/pushedBrief.ts also exports `pushBrief({ command, request, worktreePath, phaseFolderPath, phaseId }): Effect<string, never, FileSystem | Shell>`, which returns the brief section text. Case 1: when `<phase folder>/brief-00.json` exists, read it with `readBriefRecordFile` and make no provider call (§5.6). An answered outcome is decoded again with `readBriefAnswer` and rendered. A failed outcome renders the unavailable line with its recorded reason. An unreadable record renders the unavailable line naming the file, with a warning.
- pushBrief, case 2: otherwise `queryBrief({ command, request, cwd: worktreePath })` and write `brief-00.json` with `serializeBriefRecord("pushed", request, outcome)`. On `failed`, write the warning to stderr: `[phax] Warning: phase "<id>" — brief unavailable (<reason>). The phase runs without it.` An FsError while writing the record becomes a warning of the same form, never a failure. pushBrief must not fail the phase (§5.26, §5.28).
- executePlan fresh path, when `config.brief` is defined: after `setupPhase` and before `buildPhasePrompt`, compute `facts = phaseFactsFor(...)` and `request = stampBriefRequest(phaseBriefRequest(facts, null))`. Call `writePhaseBriefRequest(worktreePath, request)`, then `briefSection = pushBrief({ command: config.brief.command, request, … })`, and pass `briefSection` to `buildPhasePrompt`.
- executePlan resume paths (from gate, handoff, commit, cleanup and completion), when `config.brief` is defined: right after the worktree path is validated, compute the facts and write the request file (§5.13). Do not call the provider and do not build a prompt. With `brief` undefined, write no request file, call no provider, write no brief-00.json and pass no section (§5.30).
- Create src/domain/brief/render.ts (pure), part 1. Export `BRIEF_PUSH_CAP = 50`. Export `renderBriefSection(input: { kind: "answered"; answer: BriefAnswer } | { kind: "failed"; reason: string }): string`. It renders the heading `## Brief for this phase`, a blank line, and the intro: 'What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.' Then one of three bodies. Answered and non-empty: the first 50 compact lines in provider order, plus, when more, '- …and <n> more not shown. `phax brief` prints the phase's brief whole.' Answered and empty: 'The brief provider has nothing to report on this phase's planned files.' Failed: 'The brief is unavailable at phase start (<reason>). `phax brief` may still answer.' Then a blank line and the three instructions (part 3).
- render.ts, part 2, the compact line: `- <id> — <statement>`, then, for each place whose state is not `met`, in order, ` · <state> <file>[:<line>]` plus ` (this phase)` or ` (later)` when the place has a non-null `due`. When every place is `met`, append ` · met`. Never print `what` or `repair` in the compact form. Never sort, group, filter or deduplicate.
- render.ts, part 3, the three instructions (§5.32). First: 'Before touching any file, planned or not, existing or not yet created, run `phax brief <path> [<path>…]` to see the guarantees over it, their state there, what is wrong and how to repair it.' Second: '`phax brief` with no path prints this phase's brief whole, as the code stands now.' Third: 'To learn where the phase stands, run the gate commands listed under Execution rules. The brief never fails the phase.'
- src/app/promptGeneration.ts: add `briefSection?: string | undefined` to `BuildPhasePromptOptions` and `GeneratePhasePromptOptions`. When defined, insert it after the `## Current phase` JSON block and its blank line, before `## Execution rules`, followed by a blank line. When undefined, the prompt is byte-identical to today.
- tests/integration/persistedProducer.test.ts: remove `brief-request` and `brief-record` from `NEVER_WRITTEN`, keeping `brief-answer` with its comment. Map a file named `brief-request.json` to `brief-request`, and names matching `^brief-\d{2,}\.json$` to `brief-record`. Configure a brief provider in the driven run, answered by the fake shell with a current-release answer, so both files are written and checked against their formats. Include the worktree's `.phax-context/` in the scan if the test does not reach it already.
- Fake shell: if a test needs a provider that times out, add a minimal `setFailure(command, message)` to src/infra/fakes/shell.ts that makes `run` fail with the port's error type for that command. The real kill is already proven in phase-02. Every provider answer in tests is made up.

### Planned files to create

- `src/domain/brief/render.ts`
- `src/app/pushedBrief.ts`
- `tests/unit/briefRender.test.ts`
- `tests/integration/pushedBrief.test.ts`

### Planned files to edit

- `src/app/executePlan.ts`
- `src/app/promptGeneration.ts`
- `tests/unit/promptGeneration.test.ts`
- `tests/integration/persistedProducer.test.ts`

### Optional files that may be edited

- `src/infra/fakes/shell.ts`
- `src/app/gates.ts`
- `src/app/phaseStatusUpdates.ts`
- `src/domain/gate/gateRequest.ts`
- `tests/integration/gateRequest.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/resume.test.ts`
- `tests/integration/rateLimit.test.ts`
- `tests/integration/fixLoop.test.ts`
- `tests/unit/fakeShell.test.ts`

### Boundary contracts

executePlan → pushedBrief: on a fresh start, the consumer (the prompt) needs one section string and must never see an error. pushedBrief returns the string and owns the provider call, the record and the warning. phase facts → both requests: the gate request and the brief request are cut from the same `makeGateRequest` value per phase entry, so for one phase `phase`, `base`, `terminal` and `phases` are equal by construction. app → worktree: `.phax-context/brief-request.json` is the stamped phase request with `files: null`. phase-04's `phax brief` reads it as the phase's identity and must find it after every start or resume. app → phase folder: `brief-00.json` is a `brief-record` with `moment: "pushed"`, and its `request` deep-equals the request file's JSON value.

### Test strategy

Write first: tests/unit/briefRender.test.ts.
- 53 guarantees `g01`…`g53` give lines for g01 through g50 in order, then a not-shown line naming 3 and `phax brief`.
- g01's forbidden place at `src/a.ts:3`, due this-phase, gives a line with its id, statement, `forbidden`, `src/a.ts:3` and `this phase`, but neither `W1` nor `R1`.
- `later` and null due, accepted places and an all-met guarantee render as specified.
- An empty answer gives the nothing-to-report line, and a failed outcome gives the unavailable line with its reason.
- Every variant ends with the three instructions.

tests/unit/promptGeneration.test.ts: the section sits between the current-phase JSON and `## Execution rules`, and is absent when undefined.

Then tests/integration/pushedBrief.test.ts drives executePlan with fakes on a made-up three-phase plan. The gate step declares `input: gate-request` and `config.brief` is `{ command: "node ./brief.mjs" }`.
- One brief call per phase start, with `cwd` the phase worktree. Its stdin parses to exactly `$schema` (brief-request prefix), `phase`, `base`, `terminal`, `phases` and `files: null`, and the four facts equal that phase's `checks-attempt-01.request.json`.
- prompt.md (and the prompt the fake backend received) holds the section built from the answer.
- brief-00.json has `moment: "pushed"` and a `request` deep-equal to `.phax-context/brief-request.json`.
- Exit 1, `not json`, a fake timeout failure and a 99.0.0 answer each give a stderr warning naming `phase-01` and the reason, the unavailable line, and a failed brief-00.json. The agent still runs, and the run ends in the same state with the same result as the same run without `brief`.
- After gates are exhausted and the request file is deleted, a resume rewrites the file equal to brief-00's request, makes no brief call, and leaves brief-00.json byte-identical.
- A rate-limited re-entry with brief-00.json present makes no brief call and re-renders the section.
- With no `brief` key there is no brief call, no section, no brief-00.json and no request file.
- `command: "node ./b.mjs"` is the command called.

### Implementation order

1. render.ts and its unit tests.
2. promptGeneration briefSection with its test.
3. pushedBrief.ts (request file, pushBrief).
4. executePlan: phaseFactsFor, fresh-path push, resume-path request file.
5. tests/integration/pushedBrief.test.ts and persistedProducer update; confirm gateRequest.test.ts unchanged.

### Excluded scope

- The `phax brief` command and pulled records (phase-04), their collection and the grant (phase-05).
- Briefs in fix-loop, handoff, review or compliance prompts, or a new section on resume (spec non-goals).
- Any change to the gate request bytes, gate steps, verdicts, the fix loop or run/phase state transitions.
- `run --append` (not built).
- Telemetry events for briefs.
- Any `.claude/skills/` edit.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The signatures and file names exported by src/app/pushedBrief.ts (`PHASE_BRIEF_REQUEST_FILE`, `PUSHED_BRIEF_RECORD`, `writePhaseBriefRequest`, `pushBrief`) and src/domain/brief/render.ts (`BRIEF_PUSH_CAP`, `renderBriefSection`). Where executePlan builds the phase facts (`phaseFactsFor`) and confirmation that the gate request bytes are unchanged. Each resume path that writes the request file. The exact warning, unavailable and nothing-to-report wording. Whether the fake shell gained `setFailure`. Which two ids left persistedProducer's NEVER_WRITTEN. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(brief): push the phase's brief into its first prompt`

### Commit body

With a brief provider configured, phax writes the phase's brief request to `.phax-context/brief-request.json` when a phase starts or resumes. It asks the provider once per phase folder, after the worktree is ready and before the first prompt. The request's facts are the gate request's, built once from the same inputs.

The first prompt gains `## Brief for this phase`: one compact line per guarantee in the provider's order, capped at 50 with a not-shown line naming `phax brief`, then the three instructions. A failing, silent, slow or refused provider produces a run-output warning, an unavailable line and a failed record, and the phase runs. The call is recorded as brief-00.json. A rate-limited re-entry re-renders the section from that record instead of asking again. With no provider, nothing changes.

---

## phase-04 — The phax brief command {#phase-04-phax-brief-command}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

An agent, or a person, can ask the brief provider about any path at any time and read the whole answer. Inside a phase, the request carries the phase's facts and every pull is recorded for the phase. Outside one, it carries the paths alone and nothing is recorded.

### Detailed instructions

- FileSystem port (src/ports/fs.ts): add `createExclusive(path: string, content: string): Effect.Effect<boolean, FsError>`. It writes only when nothing exists at `path`, returns false when something does, and never overwrites. Node adapter (src/infra/fs.ts): `writeFile` with flag `wx`, mapping EEXIST to false, honoured by `rootedAt` views. Fake (src/infra/fakes/fs.ts): the same over its map, including rooted views.
- src/app/loadConfig.ts: export `locateWorkingTree(cwd): { readonly root: string; readonly mainRoot: string } | undefined`. `root` is `git rev-parse --show-toplevel`, reusing `findGitRoot`. `mainRoot` is the parent of `git rev-parse --path-format=absolute --git-common-dir` when that path's basename is `.git`, otherwise `root`. It returns undefined outside any git working tree. Use the file's existing `execSync` import and add no new Node I/O import anywhere.
- Create src/domain/brief/pull.ts (pure). `resolveBriefPaths({ cwd, root, paths }): Either<readonly [string, ...string[]], { refused: string }>` resolves each argument against `cwd` with node:path and makes it relative to `root` with POSIX separators. It deduplicates, keeping the first occurrence in the order given, and never checks existence. A result that is absolute, starts with `..`, or is empty (the root itself) is refused as '<arg> is outside the working tree'. The empty case may be worded '<arg> is the working tree itself'.
- pull.ts also exports `PULLED_BRIEFS_DIR = .phax-context/briefs`, `BRIEFS_CLOSED_MARKER = closed`, and `nextPulledBriefName(existing: readonly string[])`. That function takes one plus the highest NN among names matching `brief-NN.json` (two or more digits), at least 01, zero-padded to two digits.
- src/domain/brief/render.ts: add `renderWholeBrief(answer: BriefAnswer): string` following spec §6. For each guarantee, `<id> — <statement>`. For each place in order, `  <state padded>  <file>[:<line>]` plus `   due this phase` or `   due later` when due is non-null, then `    what:    …` and `    repair:  …` wherever the state has them. Add `renderNoBrief(files: readonly string[] | null)`: 'No brief for <files joined by ", ">.' or, for null, 'No brief for this phase's planned files.'
- Create src/app/pullBrief.ts, part 1. Export `pullBrief({ command, root, cwd, paths, timeoutMs? }): Effect<PullBriefResult, never, FileSystem | Shell>`. `PullBriefResult = { kind: "refused"; message } | { kind: "answered"; answer: BriefAnswer; files: readonly string[] | null; recordWarning?: string } | { kind: "failed"; reason; recordWarning?: string }`. Steps 1–3 follow.
- pullBrief, step 1. If `<root>/.phax-context/brief-request.json` exists, parse it and read it with `readBriefRequestFile`. It must be the in-phase variant with `files: null`; otherwise refuse with '.phax-context/brief-request.json is not a brief request: <reason>' (Q8) and do not run the provider. With no file, the call is outside a phase.
- pullBrief, step 2. With no path inside a phase, the request is the file's request as is. With no path outside a phase, refuse 'outside a phase, name at least one path'. With paths, run `resolveBriefPaths`, refuse what it refuses, and build `phaseBriefRequest(<the file's facts>, files)` or `outsideBriefRequest(files)`, stamped.
- pullBrief, step 3. Run `queryBrief({ command, request, cwd: root })`. Then, only inside a phase and only when `<root>/.phax-context/briefs/closed` is absent: `mkdirp` the briefs dir, list it, and claim `nextPulledBriefName` with `createExclusive(serializeBriefRecord("pulled", request, outcome))`, retrying with the next number on false. A record-write failure becomes `recordWarning` and never changes the result. Outside a phase, or with the marker present, write nothing (§5.36).
- Create src/cli/commands/brief.ts. `runBrief(paths, out, cwd = process.cwd())`: `locateWorkingTree(cwd)` undefined prints '✗ phax brief: <cwd> is not inside a git working tree' and exits 1. `loadConfig(tree.mainRoot)` Left prints its message and exits 2. `config.brief` undefined prints '✗ No brief provider is configured: add "brief": { "command": "…" } to phax.json' and exits 1.
- runBrief then runs `pullBrief` with `makeRootedNodeFileSystemLayer(tree.root)` and NodeShellLayer, and renders. `refused` prints `✗ phax brief: <message>` and exits 1. `failed` prints `✗ <reason>` on stderr and exits 1. Answered and non-empty prints the whole form on stdout and exits 0. Answered and empty prints `renderNoBrief` on stdout and exits 0. A `recordWarning` goes to stderr. No other logic. Register `brief [path...]` in src/cli/program.ts with the description 'Ask the configured brief provider which guarantees range over the given paths and how each stands there; with no path, inside a phase, the phase's brief', no options.
- src/cli/cliDocs.ts: add a `brief` entry. Its long help carries the request variants, the answer contract with its required `$schema`, per-state places and `due`, the 60-second limit, the exit codes, and the fact that pulls inside a phase are recorded. Examples: `phax brief src/core/billing/invoice.ts src/core/billing/tax.ts` and `phax brief`. Then run `pnpm gen:usage-spec` and `pnpm docs:cli`, which regenerate phax.usage.kdl, docs/cli/reference.md and the README's generated CLI block. Edit no other README prose in this phase.
- Tests build their own temp git repositories with made-up phax.json files and provider scripts. Never read the user's ~/.phax: set HOME to a temp dir for the CLI tests if loadConfig would otherwise read a real ~/.phax/config.json.

### Planned files to create

- `src/domain/brief/pull.ts`
- `src/app/pullBrief.ts`
- `src/cli/commands/brief.ts`
- `tests/unit/briefPull.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/fsCreateExclusive.test.ts`

### Planned files to edit

- `src/ports/fs.ts`
- `src/infra/fs.ts`
- `src/infra/fakes/fs.ts`
- `src/app/loadConfig.ts`
- `src/domain/brief/render.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/briefRender.test.ts`

### Optional files that may be edited

- `tests/unit/loadConfig.test.ts`
- `tests/unit/fakeRootedFileSystem.test.ts`
- `tests/unit/generateUsageSpec.test.ts`
- `tests/integration/usageSpecExamples.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `src/cli/cliCompleters.ts`
- `docs/cli/inventory.md`

### Boundary contracts

cli → app: the command needs, from a cwd and paths, one of refused, answered (with the paths, or null for the phase's brief) and failed. `pullBrief` provides it and owns the request, the provider call and the pulled record. The command only locates the tree, loads config and renders. app → worktree: it reads `.phax-context/brief-request.json`, written by phase-03, as the only source of phase identity. It writes `.phax-context/briefs/brief-NN.json` and honours the `.phax-context/briefs/closed` marker that phase-05 writes. app → FileSystem port: `createExclusive` is the only way a number is claimed. app → config: in a linked worktree, config comes from the main working tree (`locateWorkingTree().mainRoot`), and the provider runs from the worktree's own root.

### Test strategy

Write first: tests/unit/briefPull.test.ts. Paths from `src/core` resolve (`billing/tax.ts` becomes `src/core/billing/tax.ts`). Duplicates are removed, keeping the first occurrence in order. `../elsewhere.ts` and an absolute path outside the root are refused. An absolute path inside the root is accepted. Numbering: [] gives brief-01.json, and [brief-01.json, brief-03.json, notes.txt] gives brief-04.json. tests/unit/briefRender.test.ts adds the whole form: 53 guarantees in order with every field, and the no-brief lines. tests/integration/fsCreateExclusive.test.ts: the Node adapter creates once, and a second call returns false with the content unchanged; the same through a rooted view and the fake.

Then tests/integration/briefCommand.test.ts drives `runBrief` against a temp repo with a linked phase worktree (`git worktree add`) holding a made-up `.phax-context/brief-request.json`, and provider scripts that save stdin and cwd.
- From `src/core`, `billing/tax.ts billing/invoice.ts billing/tax.ts` sends the file's facts with `files` equal to the two resolved paths, runs from the worktree root, and writes `.phax-context/briefs/brief-01.json` (pulled).
- No argument sends the file's request; with a forbidden place, stdout shows id, statement, state, location, due, what and repair, and the exit is 0.
- Three pulls give brief-01..03 in call order. A failing pull exits 1 with its reason on stderr and still records a failed brief.
- With the `closed` marker present, the call is answered and no record is added.
- `{ "phase": 2 }` in the request file exits 1 naming the file, and the provider does not run.
- In the main checkout (no request file), `src/greet.ts` sends exactly `{ $schema, files }` and nothing is written; no path, `../elsewhere.ts`, and a cwd outside any git tree each exit 1 without running the provider.
- An empty answer prints `No brief for src/x.ts.`. No `brief` key exits 1 naming `brief`. A 99.0.0 answer exits 1 naming `brief-answer` and `99.0.0`.
- A `brief` declared only in the main checkout's phax.local.json is used by a pull from the linked worktree.

### Implementation order

1. FileSystem.createExclusive in port, adapter and fake, with its test.
2. Domain pull.ts and whole-form render, with unit tests.
3. locateWorkingTree in loadConfig.ts.
4. pullBrief.ts.
5. CLI command, registration, cliDocs; gen:usage-spec and docs:cli.
6. tests/integration/briefCommand.test.ts.

### Excluded scope

- Collecting pulled records into the phase folder and writing the `closed` marker (phase-05).
- Granting `phax brief` to the agent and the `brief` security source (phase-05).
- Any flag on `phax brief`, lookup by guarantee id, or `--json` output (spec non-goals).
- A provider that needs to read data outside the worktree from inside the agent's sandbox (for steme, its ledger): left to steme item 8.
- Changing config discovery for any other command.
- Any `.claude/skills/` edit: report in the handoff any skill (e.g. phax-cli) that should mention `phax brief`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The signatures of `createExclusive`, `locateWorkingTree`, `resolveBriefPaths`, `nextPulledBriefName`, `renderWholeBrief`, `renderNoBrief`, `pullBrief` and `runBrief`, and the constants `PULLED_BRIEFS_DIR` and `BRIEFS_CLOSED_MARKER` that phase-05 uses. The exact refusal, failure and no-brief wording and each exit code. Which generated files gen:usage-spec and docs:cli changed. Any skill that should mention `phax brief` (reported, not edited). Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(cli): add phax brief to pull a brief from inside or outside a phase`

### Commit body

`phax brief [path…]` asks the configured brief provider about the named paths, existing or not, and prints the whole form: every guarantee and place in the provider's order, with state, location, due, what and repair. Inside a phase worktree it takes the phase facts from `.phax-context/brief-request.json` from any directory, and with no path it asks for the phase's brief. Outside a phase it sends `files` only.

It exits 0 on any answer and 1 otherwise: provider failure, refused answer, no `brief` key, an unreadable phase request file, no path outside a phase, a path outside the working tree, or no working tree at all. Config is read from the main working tree, so a phax.local.json provider works from a phase worktree.

In a phase whose briefs are not yet collected, each pull is recorded as `.phax-context/briefs/brief-NN.json`, numbered from 01 through a new exclusive-create FileSystem operation.

---

## phase-05 — Pulled records reach the phase, and the grant {#phase-05-pulled-records-and-grant}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Every brief that shaped a phase's gated work is kept with the phase and its record. The agent may actually run `phax brief` under a command allowlist whenever a brief provider is configured.

### Detailed instructions

- src/app/pullBrief.ts, part 1: export `closePulledBriefs({ worktreePath, phaseFolderPath, phaseId }): Effect<void, never, FileSystem>`. When `<worktree>/.phax-context/briefs/closed` already exists, do nothing. Otherwise list `<worktree>/.phax-context/briefs/` (absent means none). Copy every file named `brief-NN.json` (NN of two or more digits, skipping `brief-00.json` should one appear) into the phase folder under the same name, in number order, with `readText` then `writeAtomic`. Then write the empty `closed` marker with `mkdirp` and `writeAtomic`.
- closePulledBriefs, part 2: any FsError becomes the stderr warning `[phax] Warning: phase "<id>" — failed to collect pulled briefs (<message>).` It never fails the phase.
- src/app/executePlan.ts, committed path: when `config.brief` is defined, call `closePulledBriefs` with the phase's worktree and phase folder after the phase commit and handoff steps and right before the terminal-committed record block. It must run whether or not `config.records.enabled` is true, so the copies land before `writeRecordForPhase` lists the phase folder.
- src/app/executePlan.ts, failed path: in the tapError path that writes a failed phase's record, call it first, for non-resumable errors only and when `config.brief`, `currentWorktreePath` and `currentPhaseFolderPath` are all known. Never call it on a resumable pause (rate limit, gates exhausted, handoff, commit, cleanup or completion pause). Its pulls keep accumulating across sessions.
- src/domain/security/agentCommands.ts: `AgentCommandRecord.source` becomes `"config" | "gate" | "brief"`. `computeFrozenAgentCommands` gains `briefCommands: readonly string[]`, inserted after the gate entries with `{ source: "brief", explicit: false }`, so an identical config or gate command keeps its own source. Enforcement and degradation apply as to any other entry. `checkRequiredCommands` is unchanged.
- src/schemas/securityPosture.ts: the source literal becomes `Schema.Literal("config", "gate", "brief")`. security.json is phax-internal and stays version 1. Add no other field.
- src/app/executePlan.ts, grant: at both `computeFrozenAgentCommands` call sites (fresh and resume), pass `briefCommands: config.brief !== undefined ? ["phax brief"] : []`. Then the fresh path's security.json and both paths' `agentOptions.agentCommands` carry it exactly when a provider is configured (§5.29, §5.30).
- Test brief records and answers are made up. To simulate pulls inside the agent's turns, use the fake backend's `setOnRunAgent` hook to write made-up `brief-NN.json` documents into the worktree's `.phax-context/briefs/`, or call `pullBrief` with the fake shell, whichever exercises the real numbering.

### Planned files to create

- `tests/integration/briefRecords.test.ts`

### Planned files to edit

- `src/app/pullBrief.ts`
- `src/app/executePlan.ts`
- `src/domain/security/agentCommands.ts`
- `src/schemas/securityPosture.ts`
- `tests/unit/security/agentCommands.test.ts`

### Optional files that may be edited

- `tests/integration/writeRecord.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/pushedBrief.test.ts`
- `tests/integration/briefCommand.test.ts`
- `tests/integration/skillEditConsent.test.ts`
- `tests/unit/schemas.test.ts`
- `src/infra/fakes/backend.ts`
- `docs/security.md`

### Boundary contracts

pullBrief (phase-04) → executePlan: pulled records wait in `.phax-context/briefs/`. `closePulledBriefs` is the only bridge into the phase folder, and the `closed` marker is the only signal back to `phax brief` that the record is written (Q7). executePlan → records writer: `writeRecord` lists every file of the phase folder, so collection must happen first. domain → security posture: an agent-command record may now carry source `brief`. Provider adapters consume only the command strings, so their contract does not change.

### Test strategy

Write first: tests/unit/security/agentCommands.test.ts. A brief command is appended with source `brief` and explicit false. A config entry `phax brief` keeps source `config` and appears once. An empty brief list leaves records unchanged. On a provider without prefix enforcement, `phax brief` is degraded like any narrow command.

Then tests/integration/briefRecords.test.ts drives executePlan with fakes and a made-up plan with `config.brief` set.
(a) In a secure-mode run, security.json lists `{ command: "phax brief", source: "brief", explicit: false, … }` and the agent options' commands include it. The same run without `brief` has no such entry.
(b) Three pulls happen across two sessions, with a gates-exhausted pause and a resume between them, and the second one fails. After commit, the phase folder holds brief-00.json (pushed) and brief-01..03 (pulled, in call order, brief-02 failed), and the worktree holds the `closed` marker. With records enabled, the written record lists all four files. A later `pullBrief` in that worktree is answered and adds no file.
(c) A phase that fails terminally also collects.
(d) With records disabled, the briefs still land in the phase folder.
(e) A run without `brief` writes no marker and no brief files.

### Implementation order

1. agentCommands and securityPosture source, with unit tests.
2. executePlan grant at both call sites.
3. closePulledBriefs and its executePlan call sites.
4. tests/integration/briefRecords.test.ts.

### Excluded scope

- Granting `phax brief` to review, compliance or authoring sessions.
- Amending an already-written record with later pulls (Q7).
- Any change to records layout, the records manifest, or `phax records explain` (phase-06).
- Run-level or preflight changes beyond the frozen command set.
- Any `.claude/skills/` edit.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The signature of `closePulledBriefs` and the exact places in executePlan where it is called, and where it is deliberately not called. The new `computeFrozenAgentCommands` input and the source precedence. Confirmation that collected brief files appear in a written record. The exact collection-warning wording. Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(brief): collect pulled briefs into the phase and grant phax brief`

### Commit body

At a phase's terminal outcome, committed or failed, and before its record is written, phax copies the phase's pulled brief records from `.phax-context/briefs/` into the phase folder and closes the folder to further recording. This happens whether or not records are enabled. The phase record on phax/records/v1 therefore carries brief-00 and every pull in call order across sessions. A pull after that point is answered and not recorded.

With a brief provider configured, the in-phase agent is allowed `phax brief` without an agentCommands entry. security.json records the grant with the new source `brief`, after config and gate entries. Without a provider there is no such grant.

---

## phase-06 — Briefs in records explain {#phase-06-records-explain-briefs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Someone explaining a recorded phase commit can read every brief the agent was given or asked for, exactly as recorded, without leaving the record.

### Detailed instructions

- src/app/recordsExplain.ts: export a pure `briefArtifactsInOrder(artifacts: ReadonlyMap<string, Uint8Array>): ReadonlyArray<readonly [string, Uint8Array]>`, mirroring `gateArtifactsInOrder`. It keeps only names matching `^brief-(\d{2,})\.json$` and sorts them by numeric value, so brief-10 comes after brief-02.
- src/cli/commands/records.ts: add `--briefs` to `records explain` with the description 'Print the phase's brief records (brief-NN.json) in number order', and `briefs?: boolean` to `RecordsExplainOptions`. In `renderFoundRecord`, after the prompt/diff/handoff line, print `briefs   <n> (--briefs prints them)` only when `n > 0`.
- records.ts, continued: when `opts.briefs`, print each entry as `--- <name> ---` followed by its decoded text, or '(no brief records in this record)' when there are none. In `renderFoundAuthoringRecord`, `--briefs` prints '(an authoring record carries no provider briefs)'. The existing `brief` size line there is the authoring brief and stays untouched. No other logic in the command file.
- Run `pnpm gen:usage-spec` and `pnpm docs:cli`. Edit README prose only if `docs:cli` itself changes the generated block.
- Test records are made up; nothing from ~/.phax or another repository.

### Planned files to create

- (none)

### Planned files to edit

- `src/app/recordsExplain.ts`
- `src/cli/commands/records.ts`
- `tests/integration/recordsExplain.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `README.md`
- `src/cli/cliDocs.ts`
- `tests/unit/generateUsageSpec.test.ts`
- `tests/integration/usageSpecExamples.test.ts`

### Boundary contracts

cli → app: for the `--briefs` view and the count line, the command needs the ordered list of brief artifacts. The app provides it from the record's artifact map. The stable shape is (file name, bytes) in ascending brief number.

### Test strategy

Write first, in tests/integration/recordsExplain.test.ts, a made-up phase record holding brief-00.json, brief-01.json, brief-02.json and brief-10.json, two gate logs and a request file. `--briefs` prints exactly the four brief files, in that order, each under its header, and no gate log. The summary shows `briefs   4`. A record without brief files shows no count line and prints the none-message under `--briefs`. An authoring record under `--briefs` prints its message. A unit check of `briefArtifactsInOrder` ordering may live in the same file. The regenerated usage spec passes its existing tests.

### Implementation order

1. `briefArtifactsInOrder` with its test.
2. CLI flag, count line and rendering.
3. `pnpm gen:usage-spec` and `pnpm docs:cli`.

### Excluded scope

- Decoding or reformatting brief records when printing them: they print as recorded.
- Changing `--gates` or any other flag's output.
- README prose outside the generated block (phase-07).
- Any `.claude/skills/` edit.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The exported function in src/app/recordsExplain.ts, the `--briefs` help text, the exact count-line and none-message wording, and which generated files changed (and whether README.md did). Any deviation from the planned file lists, with the reason.

### Commit subject

`feat(records): print a phase's brief records with records explain --briefs`

### Commit body

`phax records explain <commit> --briefs` prints every brief-NN.json the phase record carries, in number order, each under `--- brief-NN.json ---`, so anyone can see what the agent was told from the record alone. Without a flag, a record holding briefs gains a one-line count. A record without briefs prints as before. On an authoring record, --briefs says it carries no provider briefs.

The ordering lives in the app layer, and the command only renders it. The usage spec and CLI reference are regenerated.

---

## phase-07 — Docs and the hello-world brief provider {#phase-07-docs-example}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

A brief-provider author, such as steme's `steme brief`, learns from the README what phax sends at phase start and on each pull, what versioned answer it expects, and that phax judges nothing. They can see it work in the hello-world example.

### Detailed instructions

- README §Extend phax intro: three hooks let your own tools inform a run: a gate step that prints diagnostics, a brief provider and a plan auditor. Keep the stdin/stdout sentence and the gate-request sentence true.
- README, new `### Brief provider` subsection after `### Gate request` and before `### Plan auditor`, written from spec §11 for the provider author, with made-up values and `0.20.0` `$schema` URLs as the other README examples use. Part 1: the `brief` key (any layer, nearer overrides) and that phax ties it to no gate step. Then the two moments: pushed once per fresh phase start into `## Brief for this phase` (compact, 50 guarantees max), and pulled with `phax brief [path…]` (whole form, exit 0 on any answer, 1 otherwise).
- Brief provider subsection, part 2: both request variants and their keys. The phase facts equal the gate request's for the same phase. `files: null` means brief the phase's planned files. Paths may not exist yet. The provider runs from the working tree root.
- Brief provider subsection, part 3: the answer, `{"$schema": "https://docs.phax.run/schemas/brief-answer/0.20.0.json", "guarantees": [...]}`, with per-state places, `due`, order as rank, extra keys ignored, and `[]` meaning nothing to report. A missing, foreign or newer `$schema` makes the brief fail, never the phase. Then the 60-second limit and that a failure is a warning plus an unavailable line. Then `.phax-context/brief-request.json` and replay with `node ./brief.mjs < .phax-context/brief-request.json`, and the records: `brief-NN.json`, `jq -c .request brief-01.json | node ./brief.mjs`, and `phax records explain --briefs`.
- Brief provider subsection, part 4: in secure mode `phax brief` is granted with source `brief`, and a pull runs inside the agent's sandbox. Add one sentence that the authoring `--brief` flag and docs/briefs/ are a different, person-written brief. Keep the plan auditor section and the closing example link.
- Create examples/hello-world/brief.mjs, part 1. Read the request from `process.stdin` to end of file with `for await`, never `readFileSync(0)`, then `JSON.parse` it. Its files are `request.files` when non-null, otherwise the `files` of the `phases` entry whose `id` equals `request.phase`. For each file under `src/` ending in `.ts`, make one `hw-no-io` place. When the file exists and has an import from a `node:` module, the place is `forbidden` at the first such line, with `what: imports node:<module>` and `repair: remove the import; greet is pure`. Otherwise the place is `met`; a file that does not exist yet is `met`.
- brief.mjs, part 2: `due` is null when the request has no `phase`. Otherwise it is `later` when a later `phases` entry plans the file and the current one does not, and `this-phase` in every other case. Print `{ "$schema": "https://docs.phax.run/schemas/brief-answer/<release>.json", "guarantees": [...] }`, with one guarantee `{ id: "hw-no-io", statement: "nothing under src/ imports a node: module", places }` when there are places, else `[]`. The script must hold exactly one brief-answer `$schema` literal. `<release>` is the value of `PHAX_RELEASE` in src/schemas/release.ts.
- examples/hello-world/phax.json: add `"brief": { "command": "node ./brief.mjs" }` before `planAuditor`.
- scripts/release-cut.ts: also rewrite brief.mjs's single brief-answer literal to the cut release, the same way as audit.mjs's gate-diagnostics literal. It refuses, cutting nothing, when brief.mjs is missing or does not hold exactly one literal, and reports brief.mjs among the changed paths. Update the header and doc comments. tests/unit/releaseCut.test.ts: cover the rewrite and both refusals.
- tests/integration/exampleProviders.test.ts, part 1, a `brief` describe block that spawns `node brief.mjs` on temp copies with made-up requests. A request with phase facts and `files: null` briefs the gated phase's files, and `parseBriefAnswer` (packages/schemas/src/index.ts) accepts the answer. A request with paths including a temp `src/io.ts` importing `node:fs` gives a `forbidden` place there, due `this-phase`, with `what` and `repair`. The same paths outside a phase give `due: null`. A path not under src/ gives `guarantees: []`.
- exampleProviders.test.ts, part 2: update the phax.json tests so the example ships brief.mjs for its `brief` hook and decodes with `brief` set.
- NEXT_STEPS.md: tick `brief-provider` in §'Before steme's audit' in the style of the earlier ticks. Update the status paragraph near the top only as far as needed to stay true. Touch no other section.

### Planned files to create

- `examples/hello-world/brief.mjs`

### Planned files to edit

- `README.md`
- `examples/hello-world/phax.json`
- `tests/integration/exampleProviders.test.ts`
- `scripts/release-cut.ts`
- `tests/unit/releaseCut.test.ts`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `examples/hello-world/plan.md`
- `tests/unit/examplePlanDeterministic.test.ts`
- `tests/integration/lintPlan.test.ts`
- `packages/schemas/README.md`
- `docs/security.md`
- `scripts/release.sh`

### Boundary contracts

README → provider author: the documented request and answer must match the formats from phase-01 and the behaviour from phases 03–06, word for word on keys and values. The example script and the README use the same command and replay lines. release-cut → example: brief.mjs holds exactly one brief-answer literal, which every cut rewrites.

### Test strategy

Write first: the exampleProviders brief block, against a missing brief.mjs, so it fails until the script exists. Then the releaseCut tests for brief.mjs. Run the existing hello-world tests (deterministic example plan, plan lint, audit) and keep them green. README changes are covered by the format check and the persisted-formats table test. The integration tests spawn node and git only inside temp dirs, never against the user's state.

### Implementation order

1. exampleProviders brief tests.
2. brief.mjs and the example's phax.json.
3. release-cut rewrite with its tests.
4. README Extend phax intro and Brief provider section.
5. NEXT_STEPS tick.

### Excluded scope

- Any change under src/.
- The brief at plan authoring, and making the example's audit and brief share code.
- A docs-site page beyond the README section and the generated reference.
- Building steme's `steme brief` or its ledger access under the sandbox.
- Any `.claude/skills/` edit: report any skill (phax-cli, phax-planning) that should mention the brief provider in the handoff.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

The README sections touched and the new subsection's anchor. brief.mjs's behaviour (files null vs paths, due rule) and its one `$schema` literal value. The release-cut change and its new refusals. Any project skill that should now mention the brief provider (reported, not edited). Confirmation that NEXT_STEPS ticks brief-provider. Any deviation from the planned file lists, with the reason.

### Commit subject

`docs: document the brief provider; hello-world ships brief.mjs`

### Commit body

README §Extend phax counts three hooks and gains a Brief provider section for provider authors. It covers the `brief` key, the two moments (pushed at phase start, pulled with `phax brief`), the request variants, the versioned answer with its required `$schema` and per-state places, never blocking, the phase request file, the brief-NN.json records, and replay with `node ./brief.mjs < .phax-context/brief-request.json`.

The hello-world example declares `"brief": { "command": "node ./brief.mjs" }`. Its brief.mjs answers both the phase's brief and named paths with one `hw-no-io` guarantee, and stamps one brief-answer `$schema` literal that the release cut rewrites like audit.mjs's. NEXT_STEPS ticks brief-provider.
