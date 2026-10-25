---
status: Completed
source-spec: docs/specs/2610191226-artifact-decide-verdicts.md
completes-spec: true
approved:
  date: 2026-10-25
  baseline: 3598faf
---
# Decide from verdicts

This plan implements the approved spec `artifact-decide-verdicts`. It adds a second mode to `phax artifact decide <artifact>`: `--verdicts <file|->`. A verdicts file holds decisions a person has already made. For each question it gives the option chosen and the person's note. One headless writer session, running under the decide doctrine, writes those verdicts into the artifact's revised document, along with the body revisions a departing verdict implies. phax refuses a bad file before any session. It then checks the writer's answer against the file deterministically and sets each verdict's `why`, `by` and `at` itself. It writes and commits the result without a prompt, leaves the artifact Draft, and prints a report to read before approving (`--json` gives the same report as one object).

The operator decisions of 2026-10-19 (spec §9b) and everything §10 lists as settled are inputs, not questions:
- q-note note-on-departure;
- q-unnamed stay-open;
- q-off-menu own-option, read as the implicit reserved id `other`;
- q-why phax-sets-why;
- q-by operator-declared;
- q-provider routed;
- q-model own-default;
- q-hand both.

Release context: the open release is 0.28.0, and the last tag is v0.27.0. Read the spec's 0.25.0/0.26.0 `$schema` examples as the open release. plan-document and phax-plan already have unreleased `next` snapshots from `test-strategy` (#164). spec-document is stamped 0.27.0 (released). decision-record-manifest and hand-decision-answer are stamped 0.25.0.

Phases go from the core outwards:
1. the formats;
2. an oracle pair on the pure verdict-binding and transcription contract (phase-02 writes the oracles, phase-03 discharges them);
3. the use case and its writer session;
4. the CLI;
5. the docs and skills.

Interactive decide stays as shipped, apart from accepting a verdict that chooses `other`. phase-01 pins its prompts, model rule and attribution in a test before anything else changes. This plan edits skill files under `.claude/skills/`, so run it with `phax run --allow-skill-edits`.

## Required commands

- (none)

No new command. Every gate step comes from the `standard` profile in phax.json. The regeneration commands the phases run are already allowed by `security.agentCommands`: `pnpm gen:usage-spec`, `pnpm docs:cli` and `pnpm exec tsx scripts/schemas-check.ts --write`. The plan writes `.claude/skills/` files, so run it with `phax run --allow-skill-edits`.

## Technical arbitrations

- Stamps follow docs/release.md: a stamp moves only with a JSON Schema shape change, compared without `description`, `title` and `examples`. Accepting `other` as a chosen id and reserving it as an option or recommendation id changes only the decoders' question checks and the wording of QUESTION_CHECKS_DESCRIPTION. So spec-document keeps 0.27.0, with no `next` snapshot and nothing frozen. plan-document's existing `next` is regenerated with the new description. hand-decision-answer keeps 0.25.0, and a verdict's `by` keeps { kind: operator, name }. Nothing is migrated. The rewritten QUESTION_CHECKS_DESCRIPTION reaches the spec-document JSON Schema, so tests/unit/schemasPackage/jsonSchemas.test.ts, which deep-compares the current spec-document authoring contract with the released 0.27.0 snapshot, compares without the annotation keywords (`description`, `title`, `examples`), as `sameShape` does in the snapshot tooling. Loss accepted: the published spec-document 0.27.0 JSON Schema, served from its released snapshot, keeps the old check description until the stamp next moves; and phax 0.27.0, reading a 0.27.0-stamped spec whose verdict chooses `other`, refuses it as a question-check failure, and nothing in the stamp says the document came from a newer build.
- decision-record-manifest changes shape, because `mode` becomes interactive | verdicts with per-mode outcomes. It is recorded as a `next` snapshot stamped with the open release 0.28.0. The released 0.25.0 shape is frozen as src/schemas/history/decision-record-manifest/0.25.0.ts, the way cost-ledger 0.25.0 is frozen, so every decision record already on phax/records/v1 still reads. Loss accepted: one more frozen module and reader branch to keep forever.
- The verdicts format id is `decide-verdicts`, born with `$schema`: `https://docs.phax.run/schemas/decide-verdicts/<X.Y.Z>.json`, first stamped 0.28.0. Every key is required, unknown keys are refused at any level, `verdicts` is non-empty, and `note` is a non-empty string or null. Loss accepted: the name ties the format to decide, so a future agent-decides mode with a different input needs a format of its own.
- `phax artifact schema` takes `spec|plan|verdicts`, and `verdicts` prints the decide-verdicts JSON Schema. Loss accepted: the `<kind>` argument now mixes two artifact kinds with an input format that is not an artifact.
- The human report follows the spec §6 layout:
  - a `decide <kind> <slug> — verdicts from <label>: <ids> — headless, resumed authoring session|new session` line;
  - `model      <concrete model> / <effort> (<built-in default|flag>) on <provider>`, followed by `, requested <model>` when routing resolved the requested model to another concrete model;
  - one line per given verdict: id, chosen, `(recommended)` or `departs from <rec> — revised: <sections>`, then an indented `why:` line;
  - one `<id> open (not in the verdicts file)` line per question left open;
  - the body diff;
  - `commit` and `status Draft — read the verdicts and the diff above, then `phax artifact approve <path>``.
  The label is the file path as given, or `stdin`. `--json` prints one object with exactly the spec's keys: artifact, status, session (new | resumed-authoring), provider, model (the concrete model the writer ran), requestedModel (the model asked for, by flag or default), effort, verdicts[{question, chosen, recommendation, departs, why, revised, by}], open, diff, commit{hash, subject} and decisionId. It carries no `$schema`, like the `plans … --json` outputs. Progress, warnings and the record lines go to stderr. Loss accepted: a script cannot detect a change of the report's keys from the output itself.
- The verdicts-mode commit subject is the interactive one: `docs(specs|plans): decide <slug> <ids>`. Its body is `Decided from a verdicts file, transcribed in a headless session (<model> / <effort> on <provider>).`, then the trailers `Artifact: <path>`, `Decided-By: operator (<name>)`, `Decided-Via: verdicts` and `Decision-Id: <stamp>-<slug>/<NN>`. Interactive commits are unchanged and carry no Decided-Via. Loss accepted: a reader cannot expect a Decided-Via trailer on every decide commit; its absence means interactive.
- The decision record for mode verdicts reuses the interactive manifest fields:
  - `mode: verdicts` and `session` (new | resumed-authoring);
  - `questions`: the named ids in document order;
  - `arbitrated`, `departed`, `doctrine`, `sourceSha`, `shape`, provider, `model` (the concrete model the writer ran), `requestedModel` (required on the verdicts variants only, the model asked for), effort and usage;
  - `outcome`: committed (with its commit) or failed (with commit null).
  Its files are verdicts.json (the file's text exactly as given), prompt.md, retry-prompt.md, document.json, body.diff, output.jsonl and retry-output.jsonl. There is no handback prompt, because the writer answers in its first turn. Loss accepted: the manifest does not list each given verdict's choice; a reader opens verdicts.json or document.json for that.
- The writer's built-in default is `claude-sonnet-5-5` / `medium`, as q-model decided. New constants DEFAULT_VERDICTS_MODEL and DEFAULT_VERDICTS_EFFORT sit beside DEFAULT_DECIDE_MODEL in src/schemas/phaxConfig.ts. There is no phax.json key. `--model`/`--effort` override the default (source `flag`, otherwise `built-in default`). The pair then goes through model routing (`resolveModel` with the loaded routing and provider config), and the session runs on the provider routing selects. The Claude-Code-only check of interactive decide does not apply. `resolveModel` never fails: it always resolves, falling back when the requested model has no equivalent on the selected provider. So the only model refusal is an effort outside the Effort literal (low | medium | high), refused before any session with reason `model` (exit 12); an unknown model id is not refused, it routes like headless authoring does. claude-haiku-5-5 is the cheaper catalog entry and is rejected: a departing verdict, `other` included, makes the writer revise requirements, surface and acceptance criteria while keeping traceability, which is more than reproducing a pattern a gate checks. Loss accepted: a file whose verdicts all follow their recommendations, where haiku would do, is still priced at sonnet unless the caller passes `--model`.
- Session choice: the writer resumes the kept authoring session only when <stateRoot>/authoring/<stamp>-<slug>/session.json meets three conditions: it decodes, its `provider` equals the provider routing selected, and its `cwd` resolves to this checkout. It resumes `retrySessionId` when set, otherwise `sessionId`. In every other case it starts a new session, and it prints which it did. Loss accepted: a spec authored on another provider than the one the writer routes to never gets its authoring context back.
- Stdin goes through a port. The Terminal port (src/ports/terminal.ts) gains `readStdin`, with its real adapter in src/infra/terminal.ts and a fake that takes the stdin text. A shared contract suite holds the two to the same behavior. A path given to `--verdicts` is read through the FileSystem port. The authoring `--brief -` read stays where it is, out of scope. Loss accepted: the Terminal port, so far a probe only, now does input I/O, and `--brief -` remains the one stream read outside a port.
- Precondition order in verdicts mode. Every step runs before any session and writes nothing:
  1. the CLI's flag rules (§5.8);
  2. the migration refusal;
  3. the artifact (Draft, uncommitted changes, sidecar in sync or hand §9 that parses);
  4. reading the verdicts file;
  5. parsing it (§5.3);
  6. binding it to the artifact (§5.4, §5.5);
  7. the arbiter: `--by machine:<grant>` refused, no `--by` without a terminal refused, then the operator's committing identity;
  8. the model through routing;
  9. the doctrine.
  The file and the binding take the place `--question` holds in interactive decide, and the arbiter takes the place of its terminal check. New DecideRefusedError reasons: `verdicts-file`, `verdicts-binding`, `by-machine`, `no-by`. Loss accepted: a caller with both a bad file and no `--by` learns only the file problem first.
- The file's `artifact` key is compared and never read. It must equal the repo-relative POSIX path of the CLI argument after `path.posix.normalize`. An absolute path, or one that normalizes to a path starting with `..`, is refused as naming another artifact, quoting both paths. Loss accepted: a verdicts file cannot name its artifact by an absolute path, even when that path is the same file.
- The pure contract of verdicts mode lives in src/domain/decide/verdicts.ts. Its exported types and signatures are frozen from phase-02, and the oracles call them:
  - `type GivenVerdict = { question: string; chosen: string; note: string | null }`.
  - `type VerdictsFile = { artifact: string; verdicts: readonly GivenVerdict[] }`, the decoded file without `$schema`.
  - `type VerdictsRefusal = { path: string; message: string }`, with path "" at the root.
  - `parseVerdictsFile(text: string): Either<VerdictsFile, VerdictsRefusal>`. It refuses text that is not JSON (path ""), a missing `$schema` (path "$schema", saying there is none and naming the URL phax reads), and a `$schema` naming another format or release than CURRENT_STAMPS["decide-verdicts"] (path "$schema", quoting the URL read and the URL phax reads). For any decoder violation it returns the first issue with its path, rendered like `verdicts[0].note`.
  - `type QuestionFacts = { id: string; state: "open" | "arbitrated"; optionIds: readonly string[]; recommendation: string; rationale: string }`. For a hand-authored artifact, `rationale` is the parser's whole rationale: the Recommendation line's text after `<id> — ` plus its continuation paragraphs, up to the `Decision:` line or the next block, joined with a blank line.
  - `questionFactsOfDocument(sidecar: SidecarDocument): readonly QuestionFacts[]` and `questionFactsOfHand(parsed: ParsedHandQuestions): readonly QuestionFacts[]`, open questions then arbitrated, in document order. An artifact with no §9 section (`parsed: null` in interactive decide's terms) gives `[]`.
  - `type BoundVerdict = { question: string; state: "open" | "arbitrated"; chosen: string; note: string | null; recommendation: string; departs: boolean; why: string }`. `why` is the note verbatim, or the question's rationale when the note is null.
  - `type BoundVerdicts = { verdicts: readonly BoundVerdict[]; open: readonly string[] }`. Both lists are in document order; `open` holds the open question ids the file does not name.
  - `bindVerdicts(input: { file: VerdictsFile; artifactPath: string; questions: readonly QuestionFacts[]; label: string }): Either<BoundVerdicts, string>`. The message has no `Decide refused:` prefix. It checks in this order and names:
    1. a different artifact: both paths;
    2. an unknown question: the artifact's question ids;
    3. a question named twice: that id;
    4. a chosen id neither listed nor `other`: the question's option ids and `other`;
    5. a departing verdict, `other` included, with a null note: the question and its recommendation.
  - `type TranscribedVerdict = { question: string; chosen: string; recommendation: string; departs: boolean; why: string; revised: readonly string[]; by: { kind: "operator"; name: string } }`.
  - `checkTranscription(input: { original: SidecarDocument; answer: unknown; bound: BoundVerdicts; operator: { name: string }; atIso: string; principleIds: ReadonlySet<string> }): Either<{ document: SidecarDocument; verdicts: readonly TranscribedVerdict[] }, RevisionRefusal>`.
  - `checkHandTranscription(input: { kind: ArtifactKind; md: string; parsed: ParsedHandQuestions; answer: unknown; bound: BoundVerdicts; operator: { name: string }; atIso: string; principleIds: ReadonlySet<string>; phaseIds: readonly string[] }): Either<{ answer: HandDecisionAnswer; md: string; verdicts: readonly TranscribedVerdict[] }, RevisionRefusal>`.
  `RevisionRefusal` is the existing { path, message } of src/domain/decide/revision.ts.

  Transcription rules for the headless document:
  - the answer is stamped with the document format's current shape;
  - before decoding, phax overwrites `why` (from the bound verdict), `by` and `at` on each named question's verdict, and restores a plan's sourceSpec and completesSpec;
  - the current-shape decoder passes: question checks, traceability and a plan verdict's phase;
  - the question set is unchanged;
  - every named question is arbitrated with a decided verdict whose `chosen` is the given one, `other` included, and whose `abandoned` is every other listed option;
  - every question keeps its id, question, options, recommendation and rationale;
  - a named question that was open has history [];
  - a named question that was arbitrated has its earlier history followed by its previous verdict, even when the new choice equals the old one;
  - every unnamed question is unchanged and keeps its place;
  - cited principles are loaded ids;
  - a departing verdict names a non-empty `revised`;
  - a following verdict has `revised: []`; a non-empty one is refused at that verdict's `revised` path;
  - when no given verdict departs, every field outside the two question arrays is unchanged.

  The hand decision answer is checked the same way. Its decisions are exactly the named questions, each once. Its frontmatter, question sections and decision log are returned unchanged. When no verdict departs, its markdown equals the artifact's. phax then writes the blocks in place. Loss accepted: the discharging phase cannot reshape these signatures; a disagreement pauses the run.
- Verdicts are bound, transcribed, reported and recorded in the artifact's document order, never in the file's order. Loss accepted: a caller who ordered the file deliberately sees that order nowhere in the output.
- Decided by the operator on 2026-10-25: a following verdict must carry `revised: []`. A writer that fills `revised` on a verdict that follows its recommendation gives a transcription refusal, which spends the one corrective resume and exits 5 if it persists. With that, when no given verdict departs, the body outside the question sections and decision log stays byte-identical. Loss accepted: one corrective resume spent on a field with no effect on the body; and a person whose note on a followed recommendation asks for a body precision must choose `other` and describe the choice, because the follow path cannot revise the body.
- A hand-authored §9 that lists an option `- other — …` or `Recommendation: other — …` is reported through the parser's existing `departs` variant. Its text names the question and the reserved id, for example `Q1 lists the reserved option id other`. Approve and decide then refuse it with exit 12 through their existing path, and `phax artifact status` reports it as a §9 that does not parse (exit 0). A `Decision: other — …` line is accepted. Loss accepted: the reserved id gets no variant of its own, so a consumer tells it from another malformed line only by the text.
- The oracle pair covers only the pure contract in src/domain/decide/verdicts.ts: binding (§5.2–§5.5, §5.9, §5.14) and the transcription checks (§5.10, §5.13–§5.16, §5.26). Those are stable entries the spec states as I/O, and phax judges them before the code exists. The use-case acceptance criteria (exit codes, commit, record, session choice, limits, a concurrent edit, a failed commit) and the CLI ones are written in-phase. Their entry, the use case's input, is designed in that same phase, so an oracle would freeze a design the code has not settled. Loss accepted: those criteria are not frozen before the code that serves them.
- Verdicts mode is a new use case in src/app/decideVerdicts.ts. It reuses interactive decide's helpers by exporting them from src/app/decideArtifact.ts without moving them: readArtifact, the snapshot types, nextDecisionIndex and the refusal helper. writeHandDecisions' `reArbitrated` widens from `string | null` to `readonly string[]`, because a verdicts file can re-arbitrate several questions; interactive decide passes zero or one. Loss accepted: decideArtifact.ts exposes internals that were private, and two use cases now share them.
- Decided by the operator on 2026-10-25: when `--model` (or the default) routes to a `no_equivalent` fallback, verdicts mode runs on the concrete model routing chose, like headless authoring. The report's model line names the concrete model and adds `requested <model>`; `--json` carries `model` (concrete) and `requestedModel`; the decision record carries both, `model` and `requestedModel`, on its verdicts variants. Loss accepted: the caller's explicit model choice is replaced, and the replacement shows only on the model line and in the record.
- The interactive pin test builds its prompts with a made-up doctrine, never the bundled skill text, so phase-06's doctrine edits cannot move it. It asserts the prompts with their embedded JSON Schema block cut out (the text between the schema heading and the next section), because phase-01 rewrites QUESTION_CHECKS_DESCRIPTION, which that block carries. No later phase edits the pin. Loss accepted: the pin does not hold the embedded schema text; the schema snapshot tests do.
- The `--by` value goes through parseArbiterDeclaration. `machine:<grant>` is refused `by-machine`; any value that does not parse (for example `--by bob`) is refused with the parser's message, exit 12, before any session. Loss accepted: none beyond approve's existing grammar.

---

## phase-01 — Formats: the reserved other id, the decide-verdicts format, the verdicts record mode {#phase-01-formats}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax accepts `other` as a verdict's chosen id on every question and reserves the id wherever a question is read: sidecars, session answers and hand-authored §9. The `decide-verdicts` input format exists with a strict decoder and a published JSON Schema. The decision record manifest admits a `verdicts` mode with its own outcome set. Interactive decide is pinned as shipped.

### Detailed instructions

- Pin interactive decide first, before any other change. Create tests/unit/decide/interactivePin.test.ts against today's code, using made-up fixtures and a made-up doctrine text (never the bundled skills, which phase-06 edits):
  - buildDecidePrompt for a fixed headless spec and for a fixed hand-authored spec, as inline snapshots of the prompt with its embedded JSON Schema block cut out (the schema text changes in this phase, through QUESTION_CHECKS_DESCRIPTION);
  - buildHandbackPrompt and buildDecideRetryPrompt for both variants, cut the same way;
  - resolveDecideModel(undefined, undefined): claude-opus-5-5 / high, source `catalog default`;
  - resolveDecideModel refusing `gpt-6-luna` and naming Claude Code;
  - decideCommitMessage: `Decided in an interactive session (…)`, `Decided-By: operator (<name>)`, `Decision-Id`, no `Decided-Via`.
  It must pass on the unchanged code and after every change of this phase. No later phase edits it.
- In src/schemas/questions.ts, export `OTHER_OPTION_ID = "other"`. In firstQuestionViolation, add a check after the option-id uniqueness check and before the recommendation check. It refuses an option whose id is `other` (path `…options[i].id`) and a recommendation `other` (path `…recommendation`). Each message names the question id and says `other` is reserved and implicit on every question.
- In firstVerdictViolation, accept chosen `other` when `abandoned` is exactly every listed option, each once. An unlisted chosen keeps its refusal, and its message now lists the option ids and `other`. Rewrite QUESTION_CHECKS_DESCRIPTION to state both rules. Never edit the frozen modules under src/schemas/history/.
- Stamps follow docs/release.md: the change touches checks and a description, not the JSON Schema shape. Run `pnpm exec tsx scripts/schemas-check.ts --write`. Confirm that it rewrites only packages/schemas/snapshots/plan-document/next.schema.json (the description) for this part, and that no packages/schemas/snapshots/spec-document/next.schema.json appears. If one appears, you changed the shape: undo that shape change, never the description. The description reaches the spec-document authoring contract, so change tests/unit/schemasPackage/jsonSchemas.test.ts's spec-document comparison (around line 258) to compare without `description`, `title` and `examples`, as the snapshot tooling's sameShape does, with a comment saying why: the released 0.27.0 snapshot keeps the old description, and only the shape must match.
- In the hand §9 parser, src/domain/artifact/questions.ts:
  - add `rationale: string` to ParsedQuestion: the Recommendation line's text after `<id> — `, plus its continuation paragraphs up to the `Decision:` line or the next block, joined with a blank line (the parser already carries those paragraphs, around src/domain/artifact/questions.ts:323);
  - report an option bullet whose id is `other`, or a Recommendation line naming `other`, as `{ kind: "departs", line, text }`, with a text that names the question id and the reserved id (for example `Q1 lists the reserved option id other`);
  - accept a `Decision: other — …` line.
  Approve and decide then refuse such an artifact with exit 12 through their existing departs handling, and `phax artifact status` reports the departure and exits 0. Change no consumer.
- In src/domain/decide/handAuthored.ts, verdictOptionViolation accepts chosen `other` with `abandoned` exactly every parsed option. An unlisted chosen is still refused, and its message lists the option ids and `other`. Check, with a test, that writeHandDecisions and renderVerdictDecision render `Decision: other — by operator (<name>), <date>` followed by its `Why:` paragraph; change them only if the test fails.
- In the authoring prompt, src/domain/authoring/prompt.ts, add one sentence to the answer contract for both kinds: `other` is a reserved id, implicit on every question; never list an option with the id `other`, and never recommend it.
- Create src/schemas/decideVerdicts.ts:
  - `DecideVerdictsFileSchema = Schema.Struct({ $schema: schemaUrlField("decide-verdicts"), artifact: Schema.NonEmptyString, verdicts: Schema.NonEmptyArray(Schema.Struct({ question, chosen, note: Schema.NullOr(Schema.NonEmptyString) })) })`;
  - `question` and `chosen` are ids without whitespace, like the question ids in questions.ts;
  - annotations: `chosen` is one of the question's option ids or the reserved `other`; phax refuses a null `note` on a departing verdict, a check this schema does not express; title `phax decide verdicts`;
  - `decodeDecideVerdictsFile` with `onExcessProperty: "error"`, the types DecideVerdictsFile and DecideVerdicts (without `$schema`), and `getDecideVerdictsFileJsonSchema()` built with JSONSchema.make.
- Register `decide-verdicts` as a format born with `$schema`:
  - append it to FORMAT_IDS and SCHEMA_BORN_FORMAT_IDS in src/schemas/schemaUrl.ts, and extend their doc comments with spec artifact-decide-verdicts;
  - declare `decideVerdictsFormat` in packages/schemas/src/formats/answers.ts beside handDecisionAnswerFormat: preSchema null, releases [], current from CURRENT_SHAPES, a parse function and a toLatest that drops `$schema`;
  - register it in packages/schemas/src/index.ts, and in packages/schemas/build/jsonSchemas.ts (FORMAT_DEFINITIONS, and excess properties set to "error");
  - add a current-shape bridge decoder in src/schemas/persisted.ts if hand-decision-answer has one (decodeCurrentHandDecisionAnswer);
  - add the format to every per-format table in the tests. Grep tests/ for `run-list`, the format added last, to find them.
- Make the decision record manifest per-variant in src/schemas/decisionRecord.ts. The file union holds four structs:
  - mode `interactive`, outcome `committed`, commit string;
  - mode `interactive`, outcome `declined|undecided|failed`, commit null;
  - mode `verdicts`, outcome `committed`, commit string;
  - mode `verdicts`, outcome `failed`, commit null.
  Both verdicts variants also carry a required `requestedModel` (non-empty string), the model asked for; `model` stays the concrete model the session ran.
  Export `DecisionRecordModeSchema = Schema.Literal("interactive", "verdicts")` and the per-mode outcome literals. Every other field stays required in every variant, with no optional field. src/app/writeDecisionRecord.ts keeps writing mode `interactive` and must still compile.
- This is a shape change. Run `pnpm exec tsx scripts/schemas-check.ts --write`. It writes packages/schemas/snapshots/decide-verdicts/next.schema.json and packages/schemas/snapshots/decision-record-manifest/next.schema.json, and stamps both at 0.28.0 in src/schemas/release.ts and packages/schemas/src/generated/index.ts. Never hand-edit generated files or snapshots.
- Freeze decision-record-manifest 0.25.0 the way cost-ledger 0.25.0 is frozen:
  - src/schemas/history/decision-record-manifest/0.25.0.ts: a self-contained copy of today's file schema and decoder, importing only effect;
  - its packages/schemas/history.lock.json entry, written by `--write`;
  - the format's `releases` entry in packages/schemas/src/formats/recordManifests.ts, upgrading a 0.25.0 manifest to the latest value as it is (it is an interactive record);
  - readDecisionRecordManifest in src/schemas/persisted.ts reading a 0.25.0-stamped manifest through the frozen decoder.
- Tests use made-up fixtures only and name `$schema` URLs through currentSchemaUrl or CURRENT_STAMPS, never a hard-coded release. Integration tests isolate homes and git with tests/helpers/isolatePhaxHome.ts and tests/helpers/isolateGit.ts, and never read a real ~/.phax, ~/.claude, ~/.codex or ~/.vibe, or the global git config.

### Planned files to create

- `tests/unit/decide/interactivePin.test.ts`
- `src/schemas/decideVerdicts.ts`
- `src/schemas/history/decision-record-manifest/0.25.0.ts`
- `packages/schemas/snapshots/decide-verdicts/next.schema.json`
- `packages/schemas/snapshots/decision-record-manifest/next.schema.json`
- `tests/unit/schemas/decideVerdicts.test.ts`

### Planned files to edit

- `src/schemas/questions.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/decisionRecord.ts`
- `src/schemas/persisted.ts`
- `src/schemas/release.ts`
- `src/domain/artifact/questions.ts`
- `src/domain/decide/handAuthored.ts`
- `src/domain/authoring/prompt.ts`
- `packages/schemas/src/formats/answers.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `packages/schemas/history.lock.json`
- `packages/schemas/snapshots/plan-document/next.schema.json`
- `tests/unit/schemas/questions.test.ts`
- `tests/unit/artifact/questions.test.ts`
- `tests/unit/decide/handAuthored.test.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/unit/decisionRecord.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/decideHandAuthored.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/integration/approvalLock.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`

### Optional files that may be edited

- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/domain/authoring/renderQuestions.ts`
- `src/app/writeDecisionRecord.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/frozenHistory.test.ts`

### Boundary contracts

schemas → domain and app. The decode functions are the producer: decodeDecideVerdictsFile, the decision-record-manifest file union and the question checks in firstQuestionViolation. The decide domain (phase-02 onwards), the records writer and readers, and the schemas package consume them. The stable shapes are: a decoded verdicts file without `$schema`; a manifest whose `mode` selects its outcome set; and question checks that accept `other` as a chosen id and refuse it as an option or recommendation id. The published JSON Schemas of both formats render from the same Effect schemas the decoders use.

### Test strategy

- interactive decide's prompts, default model rule, commit body and attribution stay as shipped, with a made-up doctrine and the schema block cut out — small · example · pinned prompt text and commit message · in-phase
- an option or recommendation named other is refused naming its question, and a verdict choosing other with every listed option abandoned is accepted — small · table · firstQuestionViolation path and message · in-phase · ac-other-reserved
- an authoring answer listing an option other, or recommending other, exits 5 naming the question and writes nothing — medium · example · exit code and unchanged tree · in-phase · ac-other-reserved
- a hand-authored spec whose §9 lists an option bullet with the id other is refused by approve and by interactive decide with exit 12 naming Q1, with no session spawned — medium · example · refusal message and fake session call count · in-phase · ac-other-reserved
- a hand-authored Recommendation spread over several paragraphs gives the whole rationale, joined, up to its Decision line — small · example · parsed rationale · in-phase · ac-recommended
- a headless spec written before this change, with no other anywhere, reads in sync with no migration — medium · example · artifact status agreement · in-phase · ac-other-reserved
- an interactive decide in which the operator chooses other lands chosen other, every option abandoned and a non-empty revised, and renders Decision: other — medium · example · committed sidecar and rendered §9 · in-phase · ac-other
- a verdicts file decodes only with every key, a non-empty list and a string or null note, refusing unknown keys at every level — small · table · decoder refusal path · in-phase · ac-file-refused
- the published decide-verdicts JSON Schema accepts and refuses the same documents as its decoder — small · contract · decoder and JSON Schema validation agree · in-phase · ac-file-refused
- a decision manifest decodes in each of its four mode and outcome variants, refuses mode verdicts with outcome declined, and a 0.25.0 manifest still reads — small · table · decoder result per variant · in-phase · ac-record
- snapshots, stamps and frozen modules agree with the decoders, and spec-document keeps 0.27.0 — small · example · schemas-check findings and history lock · in-phase

### Implementation order

1. The interactive pin test, green on the unchanged code.
2. The `other` checks in questions.ts, then the hand parser and handAuthored.ts, then the authoring prompt sentence.
3. src/schemas/decideVerdicts.ts and its registration as a format.
4. The per-variant decision record manifest, then the 0.25.0 freeze and its reader.
5. `pnpm exec tsx scripts/schemas-check.ts --write`, then the per-format test tables.

### Excluded scope

- Matching a verdicts file to an artifact and checking a transcription (phase-02, phase-03).
- The verdicts-mode use case, writer session, writer prompt and record writing (phase-04).
- Any CLI flag or `artifact schema verdicts` (phase-05).
- Skills and docs (phase-06), apart from the authoring prompt sentence.
- Moving the spec-document stamp or freezing spec-document 0.27.0.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record:
- the exact exports: OTHER_OPTION_ID (src/schemas/questions.ts); DecideVerdictsFileSchema, decodeDecideVerdictsFile, DecideVerdicts, DecideVerdictsFile and getDecideVerdictsFileJsonSchema (src/schemas/decideVerdicts.ts); DecisionRecordModeSchema and the per-mode outcome literals (src/schemas/decisionRecord.ts);
- the new `rationale` field of ParsedQuestion;
- the exact refusal text the hand parser gives for the reserved id;
- the stamps after `--write`: decide-verdicts and decision-record-manifest at 0.28.0, spec-document still 0.27.0, hand-decision-answer 0.25.0;
- the path of the frozen 0.25.0 module and how persisted.ts reads it;
- the path of the interactive pin test, which no later phase may edit, and how it cuts the schema block;
- the jsonSchemas.test.ts comparison change and its reason;
- every deviation from the planned file lists, with its reason.

### Commit subject

`feat(schemas): reserve the other option id, add the decide-verdicts format and the verdicts record mode`

### Commit body

A verdict may now choose the reserved id `other`, abandoning every listed option. An option or recommendation named `other` is refused wherever a question is read: sidecars, session answers and hand-authored §9. The authoring prompt states the rule.

Add the decide-verdicts input format, born with $schema and strict, with its published JSON Schema. The decision record manifest becomes per-variant: mode interactive keeps committed | declined | undecided | failed, and mode verdicts admits committed | failed. decide-verdicts and decision-record-manifest are recorded as next snapshots at 0.28.0, and decision-record-manifest 0.25.0 is frozen so existing records still read. spec-document keeps 0.27.0, because only its checks changed.

A new test pins interactive decide's prompts, model rule and attribution as shipped.

---

## phase-02 — Oracles for verdict binding and transcription checks {#phase-02-verdicts-oracles}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A higher effort than the default: the oracles fix a contract no code in the repository holds yet (verdict binding and the verdicts-mode transcription rules), and they are frozen once committed, so a mistake pauses the run instead of being fixed.
**Oracle phase:** discharged by phase-03
**Oracle files:** `tests/unit/decide/verdicts.test.ts`, `tests/unit/decide/transcription.test.ts`, `tests/unit/decide/verdictsFixtures.ts`

Write the acceptance oracles for verdicts mode's pure contract before the code exists: parsing and binding a verdicts file, and checking a writer's transcription of a headless document or a hand decision answer. They run against stubs that throw not-implemented, marked as expected failures, so the test command stays green.

### Detailed instructions

- Create src/domain/decide/verdicts.ts as stubs carrying the exact contract in this plan's Technical arbitrations (`The pure contract of verdicts mode…`):
  - every type, fully declared;
  - every exported function with its exact signature and a body of `throw new Error("not implemented: <function name>")`. tsconfig.json sets noUnusedParameters, so prefix each stub parameter with `_` (parameter names are not part of the frozen signature) or start the body with `void input;`.
  Import types only from the existing modules: SidecarDocument (src/domain/artifact/sidecar.ts), ParsedHandQuestions (src/domain/artifact/questions.ts), RevisionRefusal (src/domain/decide/revision.ts), HandDecisionAnswer (src/schemas/handDecisionAnswer.ts), DecideVerdicts (src/schemas/decideVerdicts.ts) and ArtifactKind. The discharging phase keeps these signatures, and the oracles compile against them.
- Create tests/unit/decide/verdictsFixtures.ts with made-up, frozen fixtures. Build every `$schema` with currentSchemaUrl; never hard-code a release. It holds:
  - a headless spec SidecarDocument for `log-rotation` with open questions q-keep (options keep-10 and keep-20, recommends keep-10, with a requirement and an acceptance criterion written for keep-10), q-scope (per-run and per-day, recommends per-run) and q-names (by-date and by-run, recommends by-date, with a requirement written for by-date);
  - a variant of that spec in which q-keep is already arbitrated with keep-10 by an operator verdict;
  - writer answers derived from them: a valid transcription; one choosing keep-10 when keep-20 was given; one that also moves q-names; one that adds an option run-phase to q-names and chooses it; one that edits §5 while every verdict follows; one citing `S12`; one departing without `revised`; one filling `revised` on a verdict that follows its recommendation; one returning a writer-chosen why, by and at;
  - a hand-authored spec in the §9 format with open Q1 and Q2, and hand decision answers for it;
  - a headless plan document with open Q1 and Q2 and phases phase-01 and phase-02;
  - verdicts file texts for each case of the tests;
  - literal BoundVerdicts values for every transcription case, written out by hand (the transcription oracles never call bindVerdicts);
  - operator { name: "Ada Lovelace" }, a fixed atIso, and the principle ids E0, C1–C5 and S1–S10.
  Check by hand, with a throwaway script you do not commit, that every fixture document decodes with decodeCurrentDocumentSidecar (traceability included). A fixture cannot be fixed after this phase.
- Create tests/unit/decide/verdicts.test.ts with oracles for parseVerdictsFile, bindVerdicts and questionFactsOfDocument/questionFactsOfHand:
  - §5.3 table: text that is not JSON, no `$schema`, a `$schema` naming spec-document, an extra key `reason`, an empty `verdicts`, a verdict without `note`; each with its refusal path and, for the `$schema` cases, the URL read;
  - §5.4 table, on q-keep: another spec's path, q-nine, q-keep twice, keep-30; asserting that the message contains both paths, the artifact's question ids, the duplicate id, and q-keep's option ids with `other`;
  - §5.5: keep-20 with a null note, and other with a null note; the message names the question and its recommendation;
  - why: the note verbatim, or the rationale when the note is null;
  - `open` lists q-names when only q-keep and q-scope are named;
  - the bound order is document order.
  Assert facts with toContain or toEqual on paths and ids, never full wording.
- Create tests/unit/decide/transcription.test.ts with oracles for checkTranscription and checkHandTranscription:
  - §5.15: wrong option, moving q-names, adding run-phase, editing §5 while every verdict follows, citing S12, departing without revised, a following verdict with a non-empty revised; each a Left with the violating path (the q-names case names its options);
  - the valid transcription lands chosen as given, why as bound (the note verbatim or the rationale), and by and at set by phax over whatever the writer returned;
  - other with a note lands chosen other, abandoned [by-date, by-run], the note as why, a non-empty revised, and q-names' options unchanged with no `other` listed;
  - re-arbitrating the arbitrated q-keep with keep-20 lands the new verdict, history ending with the previous keep-10 verdict unchanged, and every other question deep-equal;
  - hand: naming Q1 lands its block in the arbitrated section with its Decision block and one decision-log entry, Q2 stays open, and an answer choosing another option is refused;
  - plan: a verdict whose phase is phase-07 is refused, and one naming phase-02 lands.
- Mark every test in the two test files with vitest's expected-failure marker, `it.fails(…)`, as examples/vitest-oracles/README.md defines it. Each fails on its stub's not-implemented throw, so the test command stays green. Add no test that is not an oracle. Call a stub only inside a test body, never at module or describe level, where its throw would fail the whole file at collection. Each transcription oracle takes its `bound` input from a literal BoundVerdicts fixture, so it does not depend on binding.
- Tests are small: pure functions, no I/O, no real home or git.

### Planned files to create

- `src/domain/decide/verdicts.ts`
- `tests/unit/decide/verdictsFixtures.ts`
- `tests/unit/decide/verdicts.test.ts`
- `tests/unit/decide/transcription.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

The domain contract src/domain/decide/verdicts.ts is consumed by the verdicts-mode use case (phase-04) and produced by the discharging phase (phase-03). The use case needs a decoded verdicts file or a typed refusal, the file bound to the artifact's questions (document order, why resolved, questions left open), and a checked transcription with the landed verdicts. The signatures are frozen as the Technical arbitrations spell them; the implementation behind them is not.

### Test strategy

- a verdicts file is read only in its current shape: not JSON, no $schema, a spec-document stamp, an extra key, an empty list and a missing note are each refused with the $schema read or the first violating path — small · table · typed refusal and its path · oracle · ac-file-refused
- a file naming another artifact, an unknown question, a question twice or an unlisted choice is refused naming both paths, the question ids, the duplicate, and the option ids with other — small · table · refusal message facts · oracle · ac-binding
- a departing verdict with a null note, other included, is refused naming the question and its recommendation — small · table · refusal message facts · oracle · ac-other
- a bound verdict's why is its note verbatim or its question's rationale, and unnamed open questions are listed as left open — small · example · expected bound value · oracle · ac-recommended
- a transcription choosing another option, moving an unnamed question, adding an option, editing the body while none departs, or citing an unloaded principle is refused with its path — small · table · RevisionRefusal path · oracle · ac-checked
- phax sets why, by and at over whatever the writer returned — small · example · landed verdict fields · oracle · ac-recommended
- a following verdict whose writer filled revised is refused at its revised path — small · example · RevisionRefusal path · oracle · ac-checked
- a departing verdict lands with its revised sections and the note as why, and one without revised is refused — small · example · landed verdict and refusal path · oracle · ac-departs
- other with a note lands chosen other, every option abandoned, the note as why, options unchanged, and an added option is refused naming the options — small · example · expected document and refusal path · oracle · ac-other
- naming an arbitrated question appends its previous verdict to its history and leaves every other question equal — small · example · expected document · oracle · ac-rearbitrate
- a hand answer for Q1 lands its block, Decision block and one log entry with Q2 open, and a wrong option is refused — small · example · expected Markdown and refusal path · oracle · ac-hand
- a plan verdict must name one of the plan's phases — small · example · landed phase and refusal path · oracle · ac-plan

### Implementation order

1. The stub module with its full types.
2. The fixtures, checked by hand to decode.
3. The binding oracles, then the transcription oracles, each marked it.fails.

### Excluded scope

- Implementing any function of src/domain/decide/verdicts.ts (phase-03).
- Any test of the use case, the CLI or the record (phase-04, phase-05).
- Any test without the expected-failure marker.

### Verification

The `standard` gate profile in phax.json; the oracles provider judges the oracle files.

### Expected handoff content

Record:
- the exact exported names and signatures of src/domain/decide/verdicts.ts as committed;
- the fixture names in tests/unit/decide/verdictsFixtures.ts, and which test uses which;
- the facts each refusal test asserts (paths and ids), so the discharging phase knows what its messages must contain;
- that every test carries it.fails, and that removing the markers is the only change phase-03 may make to the oracle files;
- every deviation from the planned file lists, with its reason.

### Commit subject

`test(decide): oracles for verdict binding and transcription checks`

### Commit body

Freeze the acceptance oracles for verdicts mode's pure contract in src/domain/decide/verdicts.ts: parsing a verdicts file, binding it to an artifact's questions, and checking a writer's transcription of a headless document or a hand decision answer. The oracles run against stubs that throw not-implemented and are marked it.fails until phase-03 discharges them. The fixtures are made up and frozen with the oracles.

---

## phase-03 — Bind verdicts files and check their transcription {#phase-03-verdicts-core}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

Implement the pure core of verdicts mode in src/domain/decide/verdicts.ts so that the frozen oracles pass. It parses a verdicts file, binds it to the artifact's questions, and accepts or refuses a writer's transcription. Interactive decide's checks keep their behavior.

### Detailed instructions

- Implement every function of src/domain/decide/verdicts.ts to the contract in this plan's Technical arbitrations. Keep the exported types and signatures exactly as the committed stubs declare them, because the oracles compile against them.
- parseVerdictsFile:
  - JSON.parse first, and on failure give the parser's message at path "";
  - then a stamp check modeled on answerStampViolation in src/domain/decide/revision.ts against CURRENT_STAMPS["decide-verdicts"]: refuse a missing `$schema`, one naming another format and one naming another release, each quoting the URL read and the URL phax reads;
  - then decodeDecideVerdictsFile, with the first issue rendered as revision.ts does (ParseResult.ArrayFormatter, paths like `verdicts[0].note`);
  - return the value without `$schema`.
- bindVerdicts:
  - compare `path.posix.normalize(file.artifact)` with artifactPath; refuse an absolute path or one that normalizes to start with `..` as naming another artifact, never reading it;
  - then the checks in the contract's order: unknown question, duplicate, a chosen neither listed nor OTHER_OPTION_ID, a departing verdict with a null note (`other` always departs);
  - each message starts with the label, as in the spec: `verdicts.json chooses keep-30 for q-keep — its options: keep-10, keep-20, or other`;
  - `why` is the note verbatim, or the rationale when the note is null;
  - output in document order;
  - `open` holds the open ids not named.
- checkTranscription:
  - reuse revision.ts's building blocks, exporting what you need (firstDifference/sameJson, the question-set and order checks, withoutQuestions, answerStampViolation and the decoding path) without changing what firstRevisionViolation, decodeRevisedDocument or stampSessionVerdicts do;
  - stamp each named question's verdict with the bound `why`, `{ kind: "operator", name }` and atIso before decoding, and restore a plan's sourceSpec and completesSpec;
  - decode with decodeCurrentDocumentSidecar;
  - then apply every transcription rule of the contract, including the refusal of a non-empty `revised` on a following verdict;
  - return the landed document and the TranscribedVerdict list in document order.
- checkHandTranscription:
  - stamp each named decision's verdict with the bound why, the operator and atIso before decodeCurrentHandDecisionAnswer;
  - check the kind, that decisions are exactly the named questions each once, that chosen is the given one with abandoned the rest (`other` included), cited principles, the plan phase against phaseIds, that a departing verdict revises, that the frontmatter, question sections and decision log are unchanged, and that the markdown equals the artifact's when none departs;
  - then write the blocks with writeHandDecisions.
- Widen writeHandDecisions' `reArbitrated` in src/domain/decide/handAuthored.ts from `string | null` to `readonly string[]`, so that several named arbitrated questions are rewritten in place, each with its previous Decision line kept as an `Earlier decision:` line. In src/app/decideArtifact.ts, interactive decide passes `scope.reArbitrated === null ? [] : [scope.reArbitrated]`. Update the existing calls in tests/unit/decide/handAuthored.test.ts to the new argument and nothing else. Interactive behavior, and the pin test tests/unit/decide/interactivePin.test.ts, stay unchanged.
- Remove the `.fails` marker from every test in tests/unit/decide/verdicts.test.ts and tests/unit/decide/transcription.test.ts. That is the only change you make to them. Never edit tests/unit/decide/verdictsFixtures.ts. If an oracle seems wrong, do not adjust it: explain the disagreement in the handoff.
- Write in-phase tests for what the oracles do not pin in tests/unit/decide/verdictsCore.test.ts:
  - binding the same file with its verdicts in another order gives the same result;
  - writeHandDecisions with two re-arbitrated questions;
  - a path in the file that normalizes outside the repository is refused without being read.

### Planned files to create

- `tests/unit/decide/verdictsCore.test.ts`

### Planned files to edit

- `src/domain/decide/verdicts.ts`
- `tests/unit/decide/verdicts.test.ts`
- `tests/unit/decide/transcription.test.ts`
- `src/domain/decide/revision.ts`
- `src/domain/decide/handAuthored.ts`
- `src/app/decideArtifact.ts`
- `tests/unit/decide/handAuthored.test.ts`

### Optional files that may be edited

- `tests/unit/decide/revision.test.ts`
- `src/domain/artifact/questions.ts`

### Boundary contracts

domain → app. src/domain/decide/verdicts.ts produces the binding and transcription results the verdicts-mode use case consumes, through the signatures the oracle phase froze. revision.ts and handAuthored.ts stay the producers for interactive decide, and their behavior toward it is unchanged.

### Test strategy

- binding a file whose verdicts are listed in another order gives the same bound result — small · metamorphic · equal results across orders · in-phase
- several re-arbitrated questions of a hand-authored artifact are rewritten in place, each keeping its earlier decision — small · example · expected Markdown · in-phase · ac-rearbitrate
- an artifact key that normalizes outside the repository is refused as naming another artifact without being read — small · example · refusal message facts · in-phase · ac-binding

### Implementation order

1. parseVerdictsFile and the question-facts helpers.
2. bindVerdicts.
3. The revision.ts exports, then checkTranscription.
4. The widened writeHandDecisions, then checkHandTranscription.
5. Remove the oracle markers, then add the in-phase tests.

### Excluded scope

- The use case, the writer session, its prompt and the record (phase-04).
- Any CLI change (phase-05).
- Changing any oracle beyond removing its marker, or any fixture.

### Verification

The `standard` gate profile in phax.json; the oracles provider judges the discharge.

### Expected handoff content

Record:
- the exported functions of src/domain/decide/verdicts.ts, and the revision.ts helpers newly exported for it;
- the new writeHandDecisions signature and how interactive decide calls it;
- confirmation that tests/unit/decide/interactivePin.test.ts, revision.test.ts and the other interactive tests pass unchanged (handAuthored.test.ts changed only in its call arguments);
- any oracle you believe is wrong, with why;
- every deviation from the planned file lists, with its reason.

### Commit subject

`feat(decide): bind verdicts files and check their transcription`

### Commit body

Implement the pure core of decide's verdicts mode:
- parse a verdicts file in its current shape;
- bind it to the artifact's questions, refusing another artifact, an unknown or repeated question, an unlisted choice and a departure without a note;
- check a writer's transcription of a headless document or a hand decision answer against the given verdicts, with phax setting why, by and at.

writeHandDecisions now rewrites several re-arbitrated questions in one pass; interactive decide passes at most one. This discharges the phase-02 oracles.

---

## phase-04 — Transcribe a verdicts file in a headless writer session {#phase-04-verdicts-use-case}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** A higher effort than the default: one use case crosses model routing, provider session resume, the writer's corrective loop, the commit and the records branch, with a strict refusal order before any session, and no existing use case combines these.

A new use case runs decide's verdicts mode end to end, behind ports. It checks every precondition before any session. It runs one routed headless writer session, resuming the kept authoring session only on its own provider, with one corrective resume. It writes and commits the checked result without a prompt, leaves the artifact Draft, writes a decision record with mode verdicts, and returns the report facts.

### Detailed instructions

- Add stdin to the Terminal port, src/ports/terminal.ts: `readStdin: Effect.Effect<string, StdinReadError>`, with a tagged StdinReadError defined in the port.
  - src/infra/terminal.ts: `makeNodeTerminalLayer(stream = process.stdin)` reads the stream to its end as UTF-8; `NodeTerminalLayer = makeNodeTerminalLayer()`.
  - src/infra/fakes/terminal.ts: makeFakeTerminal takes an optional `stdin` text; readStdin returns it, or fails with StdinReadError when none was given.
  - Create tests/integration/terminalContract.test.ts: one suite run against the fake and the real adapter (fed by Readable.from), covering text, empty input and stdinIsTerminal.
- In src/schemas/phaxConfig.ts, add DEFAULT_VERDICTS_MODEL = "claude-sonnet-5-5" and DEFAULT_VERDICTS_EFFORT: Effort = "medium", with a comment: transcription needs less judgment than authoring, so it takes the tier compliance review defaults to.
- In src/domain/decide/model.ts, add `resolveVerdictsModel(flagModel, flagEffort, routing, providerConfig): Either<VerdictsModel, string>`:
  - the model and effort come from the flags, else the defaults;
  - `modelSource` and `effortSource` are `flag` or `built-in default`;
  - an effort outside the Effort literal (low | medium | high) is the only Left, naming the effort and the allowed values; the use case refuses it with reason `model` (exit 12);
  - the pair goes through `resolveModel` from src/domain/routing/resolve.ts, which never fails: a requested model with no equivalent on the selected provider falls back, and verdicts mode runs on that fallback (operator decision 2026-10-25);
  - VerdictsModel carries the requested model, effort, both sources, `provider` (resolution.selected.provider), `concreteModel`, `relationship` and `thinking`.
  Leave resolveDecideModel unchanged.
- Create the writer prompt in src/domain/decide/verdictsPrompt.ts: a pure `buildVerdictsPrompt({ kind, artifactPath, doctrine, bound, authoring, schemaUrl })`, where authoring is either a headless document or a hand Markdown text. In a fixed order, it gives:
  1. the role: transcribe verdicts a person has made, decide nothing, write no file and run no command that changes the repository;
  2. the given verdicts in document order, each with its question, its options and what each abandons, its recommendation and rationale, the chosen option, whether it follows or departs, and the note;
  3. for each verdict, what to write: advocate (the strongest case for an abandoned option), principles (only the loaded ids, listed), reversibility, and, on a plan, `phase`;
  4. for a departing verdict, the body revisions it implies, keeping traceability, named in `revised`; for `other`, the revisions that apply the choice the note describes, never adding an option;
  5. every question not named stays exactly as it was;
  6. phax sets `why`, `by` and `at`;
  7. the final-message contract: the whole document in sidecar form, `$schema` first set to schemaUrl, or a hand decision answer for a hand-authored artifact;
  8. then the doctrine text, the artifact and the answer's JSON Schema.
  It has no framing questions. The corrective resume reuses buildDecideRetryPrompt.
- Export from src/app/decideArtifact.ts, without changing their behavior, the helpers verdicts mode reuses: readArtifact, ArtifactSnapshot and Authored, nextDecisionIndex, and the refusal constructor. Add the DecideRefusedError reasons `verdicts-file`, `verdicts-binding`, `by-machine`, `by` and `no-by` in src/domain/errors.ts.
- Create src/app/decideVerdicts.ts with `decideVerdicts(input)`. The input holds: path; `verdicts: { kind: "file"; path } | { kind: "stdin" }`; label; by (raw string or undefined); doctrinePath; model; effort; the routing and provider config; bundledSkills; security; repoRoot; stateRoot; extractPlanModel and extractPlanEffort; nowIso; records; recordsClonePath; publishRemote; output (log and warn).
  Preconditions, in this order, all before any session and writing nothing:
  1. refuseUnmigratedDocuments;
  2. readArtifact;
  3. read the file (FileSystem.readText for a path, Terminal.readStdin for stdin); a failure is refused `verdicts-file`, naming the path;
  4. parseVerdictsFile, refused `verdicts-file` with its message;
  5. bindVerdicts with questionFactsOfDocument or questionFactsOfHand (an artifact with no §9 section gives `[]`), refused `verdicts-binding`;
  6. the arbiter: parseArbiterDeclaration, whose Left (for example `--by bob`) is refused `by-machine`'s sibling reason `by` with the parser's message, exit 12; `machine:<grant>` is refused `by-machine` with `--by machine:<grant> — a verdict always comes from the operator; pass `--by operator``; no `--by` and Terminal.stdinIsTerminal false is refused `no-by` with `no terminal and no --by — pass `--by operator`: a verdict always comes from the operator`; otherwise the operator by Git.committerName, and a missing name is refused `operator` with the message approve gives;
  7. resolveVerdictsModel, refused `model` for an effort outside low | medium | high;
  8. resolveDoctrine.
- Session choice: read <stateRoot>/authoring/<stamp>-<slug>/session.json with decodeAuthoringSession. Resume it only when its provider equals the routed provider and its cwd resolves to repoRoot; resume retrySessionId when set, else sessionId. Otherwise start a new session. Log `decide <kind> <slug> — verdicts from <label>: <ids> — headless, resumed authoring session|new session`, then `model      <concrete model> / <effort> (<source>) on <provider>`, with `, requested <model>` appended when the concrete model differs from the requested one. When the two sources differ, the source reads `model <s>, effort <s>`.
- The run:
  - decision folder <stateRoot>/decide/<stamp>-<slug>/<NN>/, indexed by nextDecisionIndex;
  - write verdicts.json (the text exactly as read) and prompt.md;
  - agent options: provider; concreteModel; effort from `thinking` or the effort; cwd repoRoot; security from resolveReviewSecurityPolicy; readOnly true; output.jsonl as outputJsonlPath; the folder as phaseFolderPath;
  - run with backend.resumeAgentSession(keptId, prompt, options) or backend.runAgent(prompt, options);
  - parse the final message with parseFinalMessageJson, then checkTranscription or checkHandTranscription;
  - a first refusal writes retry-prompt.md, warns, and resumes the same session once into retry-output.jsonl;
  - a second refusal fails with DecideDocumentError, path the first violation's (exit 5);
  - limits and provider errors are never retried (exit 8 or as today).
- Landing:
  - write document.json, then before.md and after.md, then the diff via git.diffNoIndex into body.diff;
  - if the artifact or its sidecar changed since readArtifact, refuse `changed` (exit 12) and leave the change in place;
  - re-seed a plan's extraction cache with seedPlanCache;
  - write the artifact (frontmatter kept byte for byte by renderRevisedArtifact, or the hand Markdown) and its sidecar;
  - commit exactly those paths with an exported verdictsCommitMessage (subject, body and trailers as the Technical arbitrations settle);
  - a commit failure fails with ArtifactCommitFailedError (exit 12), leaving the files written.
  There is no prompt or confirmation. The status, the `approved` stamp and the approval records are never touched.
- Decision record: give writeDecisionRecord (src/app/writeDecisionRecord.ts) a mode variant input: `{ mode: "interactive"; end }` with today's outcomes, or `{ mode: "verdicts"; end }` with outcome committed or failed. Add DECIDE_VERDICTS_FILENAME = "verdicts.json" to the record files.
  In verdicts mode it records:
  - questions: the named ids in document order;
  - arbitrated and departed;
  - provider, `model` (the concrete model), `requestedModel` and effort;
  - usage over output.jsonl and retry-output.jsonl, passing the writer's session ids when the provider is not claude-code (as writeAuthoringRecord does for vibe);
  - every session id redacted.
  Write it on every end after the writer session was started, committed or failed. It never fails the decide, and it is pushed as interactive decide pushes. Interactive decide passes `mode: "interactive"` and keeps its record byte-identical.
- The result `DecideVerdictsResult` is `{ kind: "committed" }` with: path; paths; status "Draft"; session; provider; model (concrete); requestedModel; effort; modelSource and effortSource; verdicts (TranscribedVerdict[]); open; diff; commit { hash, subject }; decisionId; record; recordPush. Errors reuse DecideArtifactError's members plus StdinReadError. Map StdinReadError to exit 12 in src/cli/commands/runLayers.ts (exitCodeForAuthoringError), naming stdin.
- Write integration tests with real git in a temp repo and fake backend and terminal, like tests/integration/decideArtifact.test.ts. Use tests/helpers/isolatePhaxHome.ts and tests/helpers/isolateGit.ts, made-up specs, plans, operators and doctrines, and `$schema` URLs through currentSchemaUrl. Put spec cases in tests/integration/decideVerdicts.test.ts, and plan and hand-authored cases in tests/integration/decideVerdictsPlanHand.test.ts. Every in-scope criterion below gets its own test, and every refusal its own case.

### Planned files to create

- `src/app/decideVerdicts.ts`
- `src/domain/decide/verdictsPrompt.ts`
- `tests/unit/decide/verdictsPrompt.test.ts`
- `tests/integration/terminalContract.test.ts`
- `tests/integration/decideVerdicts.test.ts`
- `tests/integration/decideVerdictsPlanHand.test.ts`

### Planned files to edit

- `src/ports/terminal.ts`
- `src/infra/terminal.ts`
- `src/infra/fakes/terminal.ts`
- `src/schemas/phaxConfig.ts`
- `src/domain/decide/model.ts`
- `src/domain/errors.ts`
- `src/app/decideArtifact.ts`
- `src/app/writeDecisionRecord.ts`
- `tests/unit/decide/model.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`
- `src/cli/commands/runLayers.ts`

### Optional files that may be edited

- `tests/type/terminal.ts`
- `src/app/recordsExplain.ts`
- `src/domain/decide/verdicts.ts`
- `src/domain/decide/revision.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/recordsExplain.test.ts`

### Boundary contracts

cli → app: the CLI (phase-05) needs one call that takes the artifact path, the verdicts source (a path or stdin) with its label, the raw `--by`, `--doctrine`, `--model` and `--effort`, and the loaded config and routing. It gets back the report facts (verdicts as transcribed, the questions left open, the diff, the commit, the decision id, the session, provider and model) or a typed error the existing exit-code mapping turns into 1/5/8/12. app → ports: the verdicts file through FileSystem, stdin through Terminal.readStdin, the terminal probe through Terminal.stdinIsTerminal, the writer session through Backend (runAgent or resumeAgentSession with the routed provider), and the diff, identity and commit through Git. app → domain: the src/domain/decide/verdicts.ts contract, buildVerdictsPrompt and resolveVerdictsModel.

### Test strategy

- the fake terminal and the real adapter read stdin and probe the terminal alike — small · contract · shared suite · in-phase
- the writer's model defaults to claude-sonnet-5-5 at medium as the built-in default, a flag overrides it, routing picks the provider, a model with no equivalent runs on its fallback with both models kept, and an effort outside low, medium and high is refused — small · table · resolved model, source, provider and relationship · in-phase · ac-session
- the writer prompt carries the given verdicts, notes and recommendations, no framing question, and the answer contract of the artifact's form — small · example · prompt contents · in-phase · ac-session
- verdicts for q-keep and q-scope land headless with no prompt: the note or the rationale as why, the operator by git user.name, q-names open, the spec Draft, a commit of exactly the spec and its sidecar with the verdicts trailers — medium · example · committed sidecar, trailers and HEAD file list · in-phase · ac-recommended
- a departing verdict lands with the requirement and criterion rewritten and named in revised, and the result marks it departing — medium · example · committed sidecar and result facts · in-phase · ac-departs
- other with a note lands chosen other with every option abandoned, a null note exits 12 before any session, and a writer adding an option exits 5 after one resume — medium · example · exit code, session calls and committed sidecar · in-phase · ac-other
- a wrong option, a moved question, a body edit while none departs, and an unloaded principle each resume once, exit 5 naming the path, leave the tree and HEAD unchanged, and record mode verdicts with outcome failed — medium · table · exit code, git state and record manifest · in-phase · ac-checked
- malformed files are refused with exit 12 before any session, naming the $schema or the path, and nothing is written — medium · table · exit code and backend call count · in-phase · ac-file-refused
- a file naming another spec, an unknown question, a duplicate, an unlisted option, or a departure with a null note exits 12 before any session — medium · table · exit code and refusal message facts · in-phase · ac-binding
- an Approved spec, a diverged sidecar, an unmigrated sidecar, a hand §9 that departs, an uncommitted change, a refused --doctrine and a missing git user.name each exit 12 with interactive decide's refusals, with no terminal, no session and nothing written — medium · table · exit code, message and backend call count · in-phase · ac-preconditions
- a hand-authored spec whose §9 lists an option bullet with the id other is refused by decide --verdicts with exit 12 naming Q1, with no session spawned — medium · example · exit code, message and backend call count · in-phase · ac-other-reserved
- a following verdict whose writer fills revised resumes once and exits 5 when the second answer still fills it, with nothing written — medium · example · exit code, session calls and git state · in-phase · ac-checked
- naming an arbitrated question gives it the new verdict, its history ends with the previous one, and the other questions are byte-identical — medium · example · committed sidecar · in-phase · ac-rearbitrate
- --by machine:roadmap-loop exits 12 naming --by operator; --by bob exits 12 with the arbiter parser's message; --by operator and a terminal without --by both record the operator by git user.name; no --by and no terminal exits 12 — medium · table · exit code and verdict by · in-phase · ac-attribution
- the kept claude-code authoring session is resumed without --model, and with codex-cli enabled in an isolated provider config, --model gpt-6-luna starts a new session on provider codex-cli — medium · example · backend calls, provider and logged lines · in-phase · ac-session
- a headless plan's Q1 lands with a phase among its phases, Q2 stays open, the plan lints clean and phax run finds its projection with no extraction, lineage unchanged — medium · example · lint findings, cache entry and frontmatter · in-phase · ac-plan
- a hand-authored spec's Q1 moves to the arbitrated section with its Decision block and one log entry, Q2 stays open, and HEAD holds that file alone — medium · example · committed Markdown and HEAD file list · in-phase · ac-hand
- a writer ending on a usage limit exits 8 with nothing written or committed — medium · example · exit code and git state · in-phase · ac-limits
- a spec edited while the writer ran exits 12, keeps the edit and makes no commit — medium · example · exit code, file content and HEAD · in-phase · ac-changed
- a failed commit exits 12 with the spec and sidecar written but uncommitted — medium · example · exit code and porcelain status · in-phase · ac-commit-fail
- records explain on a verdicts commit shows mode verdicts, the verdicts file as given, the prompt, the doctrine, the document, the diff, arbitrated 2, departed 1, provider, model, effort, usage and committed — medium · example · explained record contents · in-phase · ac-record
- interactive decide still writes its record with mode interactive, byte-identical — medium · example · record manifest · in-phase

### Implementation order

1. The Terminal port, its adapters and the contract suite.
2. The default constants and resolveVerdictsModel.
3. buildVerdictsPrompt.
4. The decideArtifact.ts exports and the new refusal reasons.
5. writeDecisionRecord's mode variant.
6. decideVerdicts: the preconditions, then the session choice, the writer turn and the corrective resume, then landing, the commit and the record.
7. The integration tests, criterion by criterion.

### Excluded scope

- The CLI flags, rendering, --json and `artifact schema verdicts` (phase-05).
- The phase-guard path (phase-05).
- Docs and skills (phase-06).
- Any change to interactive decide's behavior, prompt, model rule or attribution.
- Approving, or writing approval records, in any path.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record:
- the decideVerdicts signature (DecideVerdictsInput and DecideVerdictsResult fields);
- the exact logged progress lines;
- the new DecideRefusedError reasons and their messages;
- verdictsCommitMessage's output;
- the Terminal port's readStdin with its error, and how the CLI builds the terminal layer with stdin;
- resolveVerdictsModel's signature, how a no_equivalent fallback is reported (requested and concrete model), and what the CLI must load for it (loadModelRouting and loadProviderConfig);
- how each error maps to an exit code through exitCodeForAuthoringError (DecideRefusedError 12, DecideDocumentError 5, limits 8, ArtifactCommitFailedError 12, StdinReadError, and anything you added);
- confirmation that tests/unit/decide/interactivePin.test.ts still passes unchanged;
- every deviation from the planned file lists, with its reason.

### Commit subject

`feat(decide): transcribe a verdicts file in a headless writer session`

### Commit body

Add the use case behind `phax artifact decide --verdicts`. Before any session it refuses an unmigrated repository, a non-Draft or dirty artifact, a bad or misfit verdicts file, a machine or malformed arbiter, a missing --by without a terminal, an effort outside low, medium and high, and a refused doctrine.

One headless writer session then runs on the provider model routing selects (claude-sonnet-5-5 / medium by default). It resumes the kept authoring session only on that provider and in this checkout, with one corrective resume. phax checks the transcription against the file, writes and commits it with Decided-By, Decided-Via: verdicts and Decision-Id trailers, leaves the artifact Draft, and writes a decision record with mode verdicts.

The verdicts file and stdin are read through ports: the Terminal port gains readStdin.

---

## phase-05 — CLI: artifact decide --verdicts, --by, --json and artifact schema verdicts {#phase-05-verdicts-cli}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A caller can run `phax artifact decide <artifact> --verdicts <file|-> [--by operator] [--doctrine] [--model] [--effort] [--json]` and get the human report, or one JSON object on stdout. Conflicting flags are refused before anything else. `phax artifact schema verdicts` prints the verdicts format's JSON Schema. The help, the usage spec and the CLI reference say exactly what the code does.

### Detailed instructions

- In src/cli/commands/artifactDecide.ts, DecideCommandOptions gains `verdicts?`, `by?` and `json?`. Before loading anything, refuse with exit 12:
  - `--verdicts` together with `--question`: `--question and --verdicts are exclusive — the verdicts file names the questions`;
  - `--json` or `--by` without `--verdicts`: name the flag, for example `--json needs --verdicts` or `--by needs --verdicts`.
  Without `--verdicts`, the interactive path is unchanged.
- With `--verdicts`:
  - load the config and the routing the way runCreateArtifactHeadless does (loadModelRouting and loadProviderConfig);
  - build the terminal layer with stdin through the Terminal port's readStdin (DecideCommandDeps.terminalLayer stays injectable);
  - call decideVerdicts once, with the verdicts source `-` → stdin (label `stdin`), else the path as given (label the path) and the repo-relative path for reading;
  - map errors with exitCodeForAuthoringError, keeping the agent-invocation rendering of the interactive path.
- Rendering lives in a pure exported renderVerdictsReport(result): lines for the human layout the Technical arbitrations settle:
  - the verdict lines with `why:`;
  - `open` lines;
  - the diff;
  - `commit     <short hash> — <subject>`;
  - `status     Draft — read the verdicts and the diff above, then `phax artifact approve <path>``;
  - then the record lines as renderResult prints them.
  The progress lines come from the use case.
- `--json`: give the use case an output whose log and warn write to stderr. Print only `JSON.stringify(report)` on stdout with out.log, holding exactly the keys artifact, status, session, provider, model, requestedModel, effort, verdicts[{question, chosen, recommendation, departs, why, revised, by}], open, diff, commit{hash, subject} and decisionId. On a failure, stdout stays empty and the refusal goes to stderr. Follow how `phax plans … --json` separates the two streams.
- In src/cli/commands/artifact.ts:
  - register `--verdicts <file|->` (`Decide from a verdicts file, or - for stdin, without an interactive session`), `--by <arbiter>` (`operator: who gave the verdicts; required without a terminal (with --verdicts)`) and `--json` (`Print the report as one JSON object (with --verdicts)`) on `decide`;
  - update decide's description to cover both modes;
  - `artifact schema`: choices `spec`, `plan` and `verdicts`; runArtifactSchema prints getDecideVerdictsFileJsonSchema() for `verdicts`; its argument help reads `Document kind: spec, plan or verdicts`.
- In src/cli/cliDocs.ts:
  - scope every existing interactive-only sentence of the `artifact decide` longHelp to interactive mode, rather than leaving it false for verdicts mode: "in an interactive Claude Code session" (the opening), "decide runs on Claude Code only", "no terminal (decide is interactive only)" among the refusals, "a model outside Claude Code" among the refusals, "chosen and abandoned name the question's options" (now: the question's options or the reserved `other`), and the Side effects sentence naming "an interactive and then a headless Claude Code session";
  - extend the `artifact decide` longHelp with a verdicts-mode paragraph stating exactly what the code does: the file's keys and `other`; the note rule; no terminal needed with `--by operator`; `--by machine:<grant>` refused; the routed writer (default claude-sonnet-5-5 at medium, `--model`/`--effort`, a fallback model reported beside the requested one); the kept session resumed on its own provider; the checks; no prompt; the artifact left Draft; the report and `--json`; the trailers; the record mode; the exit codes 0/1/5/8/12;
  - add made-up examples (`--verdicts verdicts.json --by operator`, and `--verdicts - --by operator --json`);
  - extend `artifact schema` with `verdicts` and its example.
- Regenerate, never hand-edit: `pnpm gen:usage-spec` (phax.usage.kdl) and `pnpm docs:cli` (docs/cli/reference.md and the generated CLI summary in README.md). The usage drift, lint and example tests must pass.
- The phase guard keeps `artifact decide` classified `refused` in src/domain/security/phaseGuard.ts. Add a case to tests/integration/phaseGuard.test.ts: inside a phase worktree of a running plan, `artifact decide <spec> --verdicts <file> --by operator` exits 1 with the guard's refusal, with no session and nothing written.
- Tests:
  - tests/unit/cli/artifactDecideVerdicts.test.ts: the flag refusals and the rendering;
  - tests/integration/artifactDecideVerdictsCommand.test.ts: runArtifactDecide in a temp repo with fake backend and terminal layers (stdin given to the fake), using tests/helpers/isolatePhaxHome.ts and tests/helpers/isolateGit.ts, with made-up fixtures and `$schema` through currentSchemaUrl;
  - tests/unit/cli/artifact.test.ts: `artifact schema verdicts`.

### Planned files to create

- `tests/unit/cli/artifactDecideVerdicts.test.ts`
- `tests/integration/artifactDecideVerdictsCommand.test.ts`

### Planned files to edit

- `src/cli/commands/artifactDecide.ts`
- `src/cli/commands/artifact.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/unit/cli/artifact.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `README.md`

### Optional files that may be edited

- `src/cli/commands/runLayers.ts`
- `src/domain/security/phaseGuard.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `tests/integration/usageSpecExamples.test.ts`

### Boundary contracts

cli → app. The command parses flags, enforces the mode's flag rules, loads the config and routing, calls decideVerdicts once with the verdicts source and the raw `--by`, and renders the result through the OutputPort. It holds no business logic: preconditions, checks and attribution stay in the use case. The `--json` object is the stable surface for scripts: one object on stdout with the keys the Technical arbitrations list, and nothing else there.

### Test strategy

- --verdicts with --question, --json without --verdicts and --by without --verdicts each exit 12 naming the conflicting flags, with no session spawned — small · table · exit code, message and backend call count · in-phase · ac-flags
- the human report lists each verdict with chosen, follows or departs, why and revised, the questions left open, the diff, the commit and the Draft status with the approve command — small · example · rendered lines · in-phase · ac-recommended
- with --verdicts - --by operator --json and the file on stdin, stdout parses as one JSON object holding every report key and nothing else is on stdout — medium · example · parsed stdout and stderr split · in-phase · ac-json
- inside a phase worktree, decide with --verdicts exits 1 with the phase guard's refusal and spawns no session — medium · example · exit code and backend call count · in-phase · ac-preconditions
- artifact schema verdicts prints the JSON Schema the decoder renders — small · example · equality with getDecideVerdictsFileJsonSchema · in-phase
- the usage spec and CLI reference match the registered commands — medium · smoke · existing drift tests · in-phase

### Implementation order

1. The flag rules and the verdicts path in artifactDecide.ts.
2. renderVerdictsReport and the --json stream split.
3. The option registration and `artifact schema verdicts` in artifact.ts.
4. cliDocs.ts, then regenerate the usage spec and the CLI reference.
5. The unit, command and phase-guard tests.

### Excluded scope

- Any change to the use case's preconditions, checks or record (phase-04).
- README, docs pages and skills (phase-06), apart from the README's generated CLI summary that `pnpm docs:cli` rewrites.
- Any change to interactive decide's flags or output.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record:
- the final flag help strings and refusal messages;
- the exact human report layout and the `--json` keys as the code prints them;
- how stdin and the label reach the use case;
- the regenerated files;
- the phase-guard test case;
- anything in cliDocs.ts that phase-06's docs must match word for word;
- every deviation from the planned file lists, with its reason.

### Commit subject

`feat(cli): artifact decide --verdicts, --by and --json, and artifact schema verdicts`

### Commit body

Expose decide's verdicts mode. `phax artifact decide <artifact> --verdicts <file|->` takes `--by operator`, `--doctrine`, `--model`, `--effort` and `--json`. It refuses `--question` with `--verdicts`, and `--json` or `--by` without it, before anything else. It prints the report to read before approving: each verdict, the questions left open, the body diff, the commit and the Draft status. With --json it prints one JSON object on stdout and sends progress to stderr.

`phax artifact schema verdicts` prints the verdicts format's JSON Schema. The help, usage spec and CLI reference are regenerated.

---

## phase-06 — Document verdicts mode and the reserved other id {#phase-06-verdicts-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A reader finds verdicts mode in docs/arbitration.md, the README and the skills, with an example at the open release. The decide doctrines describe the writer's transcription. The authoring skills state that `other` is reserved. docs/upgrading.md says what to do about an existing option named `other`. NEXT_STEPS.md no longer lists the spec as not yet planned. Every sentence matches the code.

### Detailed instructions

- docs/arbitration.md:
  - the opening paragraph says decide has two modes;
  - the sentence `decide needs a terminal` is limited to interactive mode;
  - add a `## Deciding from a verdicts file` section for the reader of spec §11: a person who already knows their verdicts, or the agent or loop applying them for that person;
  - the section shows the §11 example with `$schema` set to `https://docs.phax.run/schemas/decide-verdicts/0.28.0.json`, then the decide command, then the approve command;
  - it explains what the file holds, `other` and its required note, the note rule for departures, `--by operator` and why a machine is refused, that no terminal is needed, the writer model and how routing picks its provider, when the authoring session is resumed, what phax checks, that why is the note or the rationale, the report and `--json`, that the artifact stays Draft and must be read before approving, the trailers, and how to undo with reopen and decide;
  - update the Models section (interactive is Claude Code only; verdicts mode is routed, and a fallback model is reported beside the requested one), the exit-code table, and the decision record section (mode verdicts, its files, `model` and `requestedModel`);
  - scope the refusal list around line 122 (`no terminal`, `a model outside Claude Code`) to interactive mode, and list verdicts mode's own refusals beside it;
  - in the session section, say that a verdict may choose `other`.
- docs/upgrading.md, `### 0.28.0`: add only what a user must do. A live spec or plan that lists an option, or a recommendation, with the id `other` is now refused (an authored answer exits 5; approve and decide on the artifact exit 12, and `phax artifact status` reports the problem). Rename that option before upgrading. Check the wording against the phase-01 code.
- README.md (outside the generated CLI summary, which phase-05 regenerated): wherever it describes `artifact decide` and `artifact schema`, add verdicts mode (one line, linking to docs/arbitration.md) and `artifact schema verdicts`.
- Doctrine skills, .claude/skills/phax-decide-spec/SKILL.md and .claude/skills/phax-decide-plan/SKILL.md:
  - under the modes section, describe verdicts mode as a transcription of a person's choices, not the agent-decides `headless` mode: the writer writes advocate, principles, reversibility and, for a departure, the body revisions and `revised`; on a plan it also writes `phase`; phax sets why (the note, or the rationale), by and at; the writer never adds an option;
  - in the Output section, say that `chosen` may be the reserved `other`, implicit on every question, with `abandoned` holding every listed option.
  Keep every principle id that opens a list item unchanged, so `Doctrine.principleIds` stays the same.
- The authoring skills, .claude/skills/phax-spec/SKILL.md and .claude/skills/phax-planning/SKILL.md: where they state the question rules (the §9 format and the headless keys for open questions), add that `other` is a reserved id, implicit on every question, never listed among the options and never recommended.
- The CLI skill, .claude/skills/phax-cli/SKILL.md: add the verdicts form of `phax artifact decide` (`--verdicts <file|-> [--by operator] [--doctrine] [--model] [--effort] [--json]`) and `artifact schema spec|plan|verdicts`, matching phase-05's help.
- NEXT_STEPS.md: remove `artifact-decide-verdicts` from `### Approved, not yet planned` and add one line saying it is implemented by the `artifact-decide-verdicts` plan (this run).
- Create tests/unit/arbitrationDocs.test.ts. It extracts the verdicts-file example from docs/arbitration.md and decodes it with decodeDecideVerdictsFile, and checks that its `$schema` equals currentSchemaUrl("decide-verdicts") and that every `phax artifact decide` flag the page names is registered. Check every other sentence you write against src/ and the phase-05 help by reading the code. Do not invent a behavior.

### Planned files to create

- `tests/unit/arbitrationDocs.test.ts`

### Planned files to edit

- `docs/arbitration.md`
- `docs/upgrading.md`
- `README.md`
- `.claude/skills/phax-decide-spec/SKILL.md`
- `.claude/skills/phax-decide-plan/SKILL.md`
- `.claude/skills/phax-spec/SKILL.md`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `tests/unit/decide/doctrine.test.ts`
- `tests/integration/resolveDoctrine.test.ts`
- `tests/integration/decideArtifact.test.ts`

### Test strategy

- the verdicts-file example in docs/arbitration.md decodes as a verdicts file at its current stamp, and every decide flag the page names is registered — small · example · decoder result and registered options · in-phase
- the bundled decide doctrines still yield the same principle ids — small · example · Doctrine.principleIds of the bundled skills · in-phase

### Implementation order

1. docs/arbitration.md and its test.
2. docs/upgrading.md and README.md.
3. The decide doctrines, then the authoring and CLI skills.
4. NEXT_STEPS.md.

### Excluded scope

- Any code change beyond the docs test.
- Generated docs (docs/cli/reference.md, phax.usage.kdl), which phase-05 regenerated.
- Release notes or a release cut.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record:
- each docs and skill section changed;
- the code each claim was checked against (file and function);
- the upgrading entry's exact wording;
- the NEXT_STEPS.md change;
- confirmation that the doctrines' principle ids are unchanged;
- every deviation from the planned file lists, with its reason.

### Commit subject

`docs(decide): document verdicts mode and the reserved other id`

### Commit body

docs/arbitration.md gains `Deciding from a verdicts file`: the file, `other` and the note rule, `--by operator`, the routed writer and its default, the checks, the report and --json, the Draft status and what to read before approving, the trailers and the record. The README and the phax-cli skill list the new flags and `artifact schema verdicts`.

The decide doctrines describe the writer's transcription. The phax-spec and phax-planning skills state that `other` is reserved. docs/upgrading.md tells a user with an option named `other` to rename it. NEXT_STEPS.md no longer lists the spec as unplanned.
