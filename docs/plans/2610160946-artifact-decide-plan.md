---
status: Approved
source-spec: docs/specs/2610140742-artifact-decide.md
completes-spec: true
approved:
  date: 2026-10-16
  baseline: ec3675b
---
# Decide and the approval lock

The third and last plan of the approved spec `artifact-decide` (`docs/specs/2610140742-artifact-decide.md`), so its run completes the spec. Plan A shipped approver attribution, `--by` and reopen from Approved. Plan B shipped the question model (`src/schemas/questions.ts`), the renderers with ids and the decision log, `parseHandAuthoredQuestions`, `migrate-documents`, the migration wait for approve and reopen, and the status `Questions:` line. This plan adds everything they left. It adds `phax artifact decide`: an interactive Claude Code session under the doctrine skill for the artifact's kind. The session raises the framing questions F1–F5, then presents the open questions, and the operator decides. phax then resumes the session headless to get the revised document, checks it deterministically, shows the body diff, writes only what the operator accepts, commits the artifact and its sidecar in one commit, and leaves a decision record on `phax/records/v1`. The plan also adds the approval lock (approve refuses while a question is open), lists the three doctrine skills in the bundled skill catalog, makes the plan-authoring prompt invite open questions, and updates the status and migrate wording that now names decide, the docs page, the README and the skills. Work runs core to surface: doctrine, the pure decide checks, the hand-authored writer, the use case and CLI, the decision record, the lock, then docs. Tests never spawn a real provider: they use the fake backend and fake session, prompt and terminal ports. Fixtures are made up. Phases 01, 06 and 07 edit files under `.claude/skills/`, each listed by exact path, so the run needs `phax run --allow-skill-edits`.

## Required commands

- (none)

No new command. Every command the phases run is already allowed by `security.agentCommands` or the `standard` gate profile in phax.json: the pnpm scripts, `pnpm exec tsx scripts/schemas-check.ts --write`, `pnpm gen:usage-spec` and `pnpm docs:cli`.

## Technical arbitrations

- The interactive session hands its document back through a headless resume (decided with the author, 2026-10-16). phax launches `claude` with a known session id: `--resume <id>` when the authoring session's id is kept and it was a Claude session, otherwise `--session-id <uuid>`. When the operator exits, phax calls `Backend.resumeAgentSession` on that id, asking for the revised document as the final JSON message. This reuses authoring's `parseFinalMessageJson`, its single corrective resume, and its rate-limit and usage-limit classification (exit 8). The spec's 'the session's final message' means the final message of that resumed session. Loss accepted: one extra model turn per decide, and the operator does not watch the document being composed.
- decide runs on Claude Code only (decided with the author, 2026-10-16). It resolves a Claude catalog model and runs the `claude` executable whatever the project's provider priority. A `--model` outside the Claude families is refused with exit 12 before any session, naming Claude Code. `src/domain/session/codex.ts` and `mistral.ts` keep returning unsupported, and the project override of a doctrine skill is read from `.claude/skills/<name>/SKILL.md`. Loss accepted: projects on Codex or Vibe cannot decide until a later plan adds their interactive launch.
- The `docs/ideas/skills/` drafts were deleted on main on 2026-10-16. The doctrine skills' only copies are `.claude/skills/phax-decide-{spec,plan,review}/SKILL.md`, and the catalog and phase-01's text updates point there. Loss accepted: no draft beside the shipped text; git history is the only record of earlier wording.
- phax sets `by` and `at` on every verdict decided in the session, overwriting whatever the session returned there, before the document is decoded. `by` is the committing identity read through `Git.committerName` (refused with exit 12 before any session when there is none, as approve does). `at` comes from the clock. Loss accepted: a session cannot attribute a verdict to anyone but the committing identity.
- The body diff comes from `git diff --no-index` through a new `Git.diffNoIndex` port operation over the two rendered files, and is accepted with `Prompt.confirm` (`initialValue: false`; cancel declines, as in `src/app/prune.ts`). A declined diff writes nothing and exits 0. Loss accepted: the diff's exact text depends on the installed git, and phax adds no diff dependency of its own.
- A hand-authored artifact has no sidecar to return, so its session answers in a new format, born with `$schema`: `hand-decision-answer`. It carries `kind`, the decided verdicts by question id, and the artifact's whole revised Markdown. phax keeps only the edits outside the frontmatter, the question sections and the decision log, then writes the question moves, Decision blocks and log entries itself (§5.6). Loss accepted: a second answer format beside the sidecar form, and the session restates the whole Markdown file (more output tokens).
- The built-in decide model is `claude-opus-5-5` at `high`, on the same basis as plan adjustment, the other interactive judgment session (`docs/model-catalog.md` §4). `--model` and `--effort` override it, and no `phax.json` key is added. Loss accepted: about twice Sonnet 5.5's per-token price on every decide session.
- The pure Claude permission-flag assembly (`gateCommandAllowRules`, the secure flag set, the unsafe bypass) moves from `src/infra/providers/claudeCode.ts` into a domain module. The headless argv and decide's interactive argv then carry the same read-only review policy (`resolveReviewSecurityPolicy` rooted at the repository). The headless argv stays byte-identical. Loss accepted: a refactor of the headless argv builder lands in the same phase as decide.
- The interactive prompt is written to the gitignored `<repoRoot>/.phax-context/decide/<decision dir>/prompt.md` and named by a short positional prompt, instead of being passed whole on argv. Linux caps one argument at 128 KiB, and the review policy lets the session read `.phax-context/`. phax removes that copy after the handback; the state-folder copy is what the record keeps. Loss accepted: the prompt sits briefly in a working-tree folder.
- §5.2's local state gains a `session.json` (`version: 1`, provider, sessionId, retrySessionId or null, cwd) in `<stateRoot>/authoring/<stamp>-<slug>/`, beside the existing `claude-session-id.txt`. decide resumes only when this file names `claude-code`. Loss accepted: artifacts authored before this release always start a new decide session, because phax will not guess the provider from the bare id file.
- `--question <id>` presents that question alone, open or arbitrated (§5.33 and the 'Framing first' criterion over the general order of §5.10). Loss accepted: a re-arbitration session cannot also decide the remaining open questions; that takes a second decide.
- A revised document whose decided verdicts all have `revised: []` may change only its question arrays: every other field must equal the original. A verdict that departs from its recommendation must name at least one revised section. Loss accepted: a session whose verdicts all follow the recommendations cannot fix an unrelated typo in the body.
- The decision record's outcome is `committed`, `declined` (the operator refused the diff), `undecided` (the document arbitrated nothing) or `failed`, keyed `decision/<stamp>-<slug>/<NN>`, with the commit trailer `Decision-Id: <stamp>-<slug>/<NN>`. NN is the next index in the local decide state folder. The record carries no session id, so a resumed authoring session's id never reaches the records branch. Loss accepted: when local state is wiped, an index can be reused, and the records writer then reports the key as refused instead of overwriting it.
- The approval lock lives in `transitionArtifact`'s approve path, after the sidecar agreement check and before the write set is computed, so `transitionArtifactBy` and every caller of the Approved target get it. Loss accepted: an artifact with open questions can no longer be approved through any path, including tests and fixtures that approved them before; those fixtures are updated.

---

## phase-01 — Doctrine resolution and the decide skills {#phase-01-doctrine}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

phax can resolve the doctrine a decide session follows: the doctrine skill for the artifact's kind (or the project's copy), with an optional `--doctrine` file appended. It collects the citable principle ids and refuses a bad doctrine file. `phax skills install` installs the three doctrine skills, now worded for the question model with ids.

### Detailed instructions

- Add `src/domain/decide/doctrine.ts` (pure). Export `DECIDE_SKILL_FOR_KIND: Readonly<Record<ArtifactKind, string>>`, with `phax-decide-spec` for a spec and `phax-decide-plan` for a plan.
- In the same module, export `principleIdsOf(text)`. It returns the backticked ids that open list items (§5.15), in document order, deduplicated, and skips fenced code blocks. A line counts when, after optional indentation and a bullet (`-`, `*`, `+`) or an ordered marker (`1.` or `1)`), its content starts with a backticked id matching `[A-Za-z][A-Za-z0-9]*`. Only the opening id counts: ``- `S1` (`C1`) **Adopt…**`` yields `S1` only, and ``3. **Adopt the recommendation** (`S1`)`` yields nothing.
- Export `assembleDoctrine({ skill: { name, source: 'bundled' | 'project', text }, file: { path, text } | null })`, returning `Either<string, Doctrine>`. `Doctrine` = `{ text, principleIds: ReadonlySet<string>, sources }`. `text` is the skill text, then, when a file is given, a `## Project doctrine (<path>)` heading followed by the file text. `sources` is `[{ kind: 'skill', name, source, fingerprint }, { kind: 'file', path, fingerprint }?]`, each fingerprint the sha256 hex of the text (hash with `node:crypto` as `src/domain/planCache/key.ts` does).
- `assembleDoctrine` refuses (Left, a message naming the path) a file that defines no principle id, and a file that defines an id the skill also defines, naming every overlapping id (§5.16).
- Add `DecideRefusedError` to `src/domain/errors.ts`: `{ reason: 'not-draft' | 'sidecar' | 'dirty' | 'no-terminal' | 'hand-format' | 'unknown-question' | 'doctrine' | 'model' | 'operator' | 'changed'; message: string }`. Every later decide refusal uses it. Map it to exit 12 in `exitCodeForError` (`src/cli/commands/runLayers.ts`).
- Add `src/app/resolveDoctrine.ts` exporting `resolveDoctrine({ kind, bundledSkillText, doctrinePath })` → `Effect<Doctrine, DecideRefusedError | FsError, FileSystem>`. It takes the bundled `SKILL.md` text from the caller, as authoring's CLI reads its skill. When the repo-relative `.claude/skills/<name>/SKILL.md` exists through the FileSystem port, that project copy replaces the bundled text (§5.13, source `project`). `doctrinePath` (repo-relative, or null) is read through the port. An unreadable file, or a Left from `assembleDoctrine`, fails with `DecideRefusedError` reason `doctrine`, naming the path.
- In `src/domain/skills/catalog.ts`, add `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review` after `phax-spec`, each as `{ name, sourceDir: name, files: ['SKILL.md'], requiredFile: 'SKILL.md' }`, with exported name constants. They already ship in package.json `files`; do not touch package.json.
- Update `.claude/skills/phax-decide-spec/SKILL.md` and `.claude/skills/phax-decide-plan/SKILL.md` wherever they still describe the older §9 shape (`options[]`, a free-text recommendation). Describe instead: a question `{ id, question, options[{ id, label, abandons }], recommendation (an option id), rationale }`; the two sections, open and arbitrated; and the decided verdict fields `chosen` (an option id), `abandoned` (exactly the other option ids), `why`, `advocate`, `principles` (ids that open list items in the loaded doctrine), `reversibility` (cheap | costly | irreversible) and `revised` (the body sections changed, empty when none), plus `phase` on a plan. State that phax sets `by` and `at`, and that the framing questions F1–F5 come from decide's prompt.
- Keep the headless sections and every principle in both skills: each list item that opens with a backticked id keeps its id and stays a list item. Touch `.claude/skills/phax-decide-review/SKILL.md` only where it describes that question shape; if it never does, leave it unchanged and say so in the handoff.
- Edit no other `.claude/` file. The run grants exactly the skill files listed in this phase.

### Planned files to create

- `src/domain/decide/doctrine.ts`
- `src/app/resolveDoctrine.ts`
- `tests/unit/decide/doctrine.test.ts`
- `tests/integration/resolveDoctrine.test.ts`

### Planned files to edit

- `src/domain/skills/catalog.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `.claude/skills/phax-decide-spec/SKILL.md`
- `.claude/skills/phax-decide-plan/SKILL.md`
- `tests/unit/skills/catalog.test.ts`

### Optional files that may be edited

- `.claude/skills/phax-decide-review/SKILL.md`
- `tests/unit/skills/bundled.test.ts`
- `tests/unit/skills/installSkill.test.ts`
- `tests/unit/skills.test.ts`
- `tests/unit/skillsArgv.test.ts`
- `tests/unit/approvalRecordDocs.test.ts`
- `tests/unit/readmeExitCodes.test.ts`

### Boundary contracts

`src/app/resolveDoctrine.ts` (producer) gives the decide use case (consumer, phase-04) a `Doctrine`: the assembled text it inlines in the prompt, the set of citable principle ids the revision check (phase-02) validates citations against, and the sources with fingerprints the decision record (phase-05) stores. The caller provides the bundled `SKILL.md` text; the FileSystem port provides the project copy and the `--doctrine` file. `DecideRefusedError` is the single exit-12 refusal type for every later decide precondition.

### Test strategy

Write the unit tests first, against made-up doctrine text: list items with ids, a parenthesised secondary id after an opening id, a numbered step that names an id in prose (`S0`, not citable), ids inside a fenced block, and nested bullets. Cover `assembleDoctrine`'s two refusals and the source fingerprints. A unit test reads the shipped `.claude/skills/phax-decide-spec/SKILL.md` and `phax-decide-plan/SKILL.md` and asserts the ids they must define (`E0`, `C1`–`C5`, and `S1`–`S10` or `P1`–`P9`), so the rewording cannot drop one. An integration test with a temporary directory and the rooted FileSystem covers the project override winning over the bundled text, a `--doctrine` file appended after it, and an unreadable file refused with reason `doctrine`. The catalog test lists six skills in order.

### Implementation order

1. Unit tests for `principleIdsOf` and `assembleDoctrine`, then `src/domain/decide/doctrine.ts`.
2. `DecideRefusedError` and its exit-12 mapping.
3. `src/app/resolveDoctrine.ts` and its integration test.
4. The skills catalog and its test.
5. The two (or three) doctrine SKILL.md texts, then the id-guard test.

### Excluded scope

- The decide command, its prompt and its session (phase-02, phase-04).
- The README, phax-cli, phax-spec and phax-planning skill texts (phase-06, phase-07).
- Any change to how headless authoring loads `phax-spec` or `phax-planning`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the exact exports and signatures of `src/domain/decide/doctrine.ts` (`DECIDE_SKILL_FOR_KIND`, `principleIdsOf`, `assembleDoctrine`, the `Doctrine` type) and of `src/app/resolveDoctrine.ts`. Record the `DecideRefusedError` reason union, the heading that separates the doctrine file from the skill, and the principle ids each shipped skill defines. Say whether `phax-decide-review/SKILL.md` changed. Explain any deviation from the planned file lists.

### Commit subject

`feat(decide): resolve decide doctrine and ship the decide skills`

### Commit body

Resolve the doctrine of a decide session: the phax-decide-spec or
phax-decide-plan skill (a project copy under .claude/skills/ wins over
the bundled one), then an optional --doctrine file. Collect the citable
principle ids, the backticked ids that open list items, and refuse a
doctrine file that is unreadable, defines no id, or redefines a skill id.

List the three doctrine skills in the bundled skill catalog, so
`phax skills install` installs them like phax-spec, and reword them for
the question model with ids, two sections and verdict fields.

---

## phase-02 — Revised-document checks and the decide prompt {#phase-02-revision}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax can deterministically accept or refuse a decide session's revised document for a headless-authored spec or plan. It checks the answer's `$schema`, stamps the operator and the time on each verdict decided in the session, names the first violation by path, and re-renders the artifact with its frontmatter kept. phax can also build the decide prompts: interactive, handback and corrective.

### Detailed instructions

- Add `src/domain/decide/revision.ts` (pure). Export `decideScope(questions, questionFlag)`. Given the current open and arbitrated questions and `--question` (or null), it returns `Either<string, DecideScope>`, where `DecideScope = { presented: readonly string[]; reArbitrated: string | null }`. With no flag, `presented` is every open id. A flag naming an open question presents it alone. A flag naming an arbitrated question presents it alone, with `reArbitrated` set to it. An unknown id is a Left whose message names every question id of the artifact (§5.34, §5.27).
- Export `answerStampViolation(kind, json)`, which returns a message or undefined. The answer must be an object whose `$schema` parses (`parseSchemaUrl`) to format `<kind>-document` at `CURRENT_STAMPS[<kind>-document]`. A missing `$schema`, another format, or another release is refused by name: the message quotes the URL read, or says there is none. It never lifts (§5.18).
- Export `stampSessionVerdicts(json, kind, scope, operator: { name }, atIso, original)`, working on the parsed unknown before decoding. For each entry of `arbitratedQuestions` (a spec) or `preamble.arbitratedQuestions` (a plan) whose id is in `scope.presented` and whose `verdict` is an object, it sets `verdict.by = { kind: 'operator', name }` and `verdict.at = atIso`. On a plan it also sets `sourceSpec` and `completesSpec` from the original sidecar, so the lineage is kept whatever the session said (§5.32).
- Export `decodeRevisedDocument(kind, json, …)`. It runs `answerStampViolation`, then `stampSessionVerdicts`, then the current-shape sidecar decoder for the kind (the decoder `src/schemas/persisted.ts` uses for a current-shape `spec-document` or `plan-document` sidecar; it already runs `firstQuestionViolation`, a plan verdict's `phase` check and the spec's traceability checks). It returns `Either<{ path, message }, document>`, with the first schema violation rendered as `formatFirstViolation` renders it.
- Export `firstRevisionViolation({ kind, before, after, scope, principleIds })`, returning `{ path, message } | undefined` from fixed-order checks with document-relative paths (§5.19). (1) Every question of `before` is in `after`, and `after` has no question `before` lacks. (2) An open question not in `presented` is unchanged and still open. (3) An arbitrated question other than `reArbitrated` is unchanged. (4) A presented question that moved, or the re-arbitrated one when its verdict changed, keeps `id`, `question`, `options`, `recommendation` and `rationale`, and gets a `decided` verdict, never `lifted`. Its `history` is `[]` for a question that was open, or the previous history plus the previous verdict for the re-arbitrated one (§5.33). (5) Every cited principle is in `principleIds`. (6) A verdict whose `chosen` differs from the question's `recommendation` has a non-empty `revised` (§5.21). (7) When no verdict decided in the session departs and all have `revised: []`, every field outside the two question arrays equals `before`'s, and the path names the first that differs.
- Export `decidedInSession(before, after, scope)`, listing `{ id, verdict, departs }` for each question decided in this session, in document order. The CLI output and the record counts (`arbitrated`, `departed`) use it. An empty list means the document arbitrated nothing.
- Export `renderRevisedArtifact(kind, originalMd, after)`. It returns the original frontmatter block byte for byte followed by `renderCurrent`'s body (src/domain/artifact/sidecar.ts), plus `serializeSidecar`'s sidecar text. Reuse the frontmatter split `src/domain/artifact/documentMigration.ts` uses; extract it into `src/domain/artifact/frontmatter.ts` if it is private.
- Add `src/domain/decide/prompt.ts` (pure). Export `FRAMING_QUESTIONS`, F1–F5 worded exactly as the spec's §4 defines them.
- In the same module, export `buildDecidePrompt({ kind, artifactPath, doctrine, scope, questions, document })`. In order, the prompt says: you facilitate, and the operator decides; never write a file or run a command that changes the repository. Then: first raise F1–F5 and let the operator correct the framing; then present each question in `scope.presented` order, an arbitrated one with its current verdict. For each verdict, gather `chosen`, `why`, `advocate` (the strongest case for an abandoned option), `principles` (only ids the doctrine defines), `reversibility` and, on a plan, `phase`. When a verdict departs from the recommendation, propose the body revisions it implies (requirements, surface, acceptance criteria, planning note) and name them in `revised`. When the operator is done, tell them to exit the session; phax then asks for the document. The doctrine text, the sidecar JSON and the JSON Schema of the answer follow.
- Export `buildHandbackPrompt({ kind, schemaUrl })`: return now, as your final message alone, the artifact's whole revised document in its sidecar form, `$schema` first at `<schemaUrl>`, with decided questions moved to the arbitrated array; phax sets `by` and `at`; when nothing was decided, return the document unchanged. Export `buildDecideRetryPrompt(refusal)` for the single corrective resume, naming the refusal and asking for the whole document again.
- Export `positionalPrompt(promptRelPath)`, the short initial message pointing the session at the prompt file (`Read <path> and follow it.`), as `src/domain/planOverlap/adjustPrompt.ts` does for adjust-plan.
- Write fixtures by hand: made-up spec and plan documents at the current shape, built in the test files. Never copy this repository's specs.

### Planned files to create

- `src/domain/decide/revision.ts`
- `src/domain/decide/prompt.ts`
- `tests/unit/decide/revision.test.ts`
- `tests/unit/decide/prompt.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `src/domain/artifact/frontmatter.ts`
- `src/domain/artifact/documentMigration.ts`
- `src/domain/artifact/sidecar.ts`
- `src/schemas/persisted.ts`
- `src/schemas/specDocument.ts`
- `src/schemas/planDocument.ts`
- `src/schemas/questions.ts`
- `tests/unit/artifact/documentMigration.test.ts`

### Boundary contracts

`src/domain/decide/revision.ts` produces, for the decide use case (phase-04): a scope from `--question`, a decoded current-shape document or a `{ path, message }` refusal (exit 5), the first revision violation, the verdicts decided in the session, and the re-rendered artifact text and sidecar text. Its consumers need a stable shape for each: refusals carry a document-relative path. `src/domain/decide/prompt.ts` produces the prompt texts the use case writes to disk and passes to the session and to `Backend.resumeAgentSession`. Phase-03 extends both modules for the hand-authored answer.

### Test strategy

Write the unit tests first; this is the contract later phases rely on. Cover `decideScope` with no flag, an open id, an arbitrated id and an unknown id (the message names every id). Cover `answerStampViolation` with no `$schema`, an older `spec-document` stamp, a `plan-document` stamp on a spec, and the current stamp. Cover `stampSessionVerdicts`: by and at are overwritten, and an absent by or at is filled, before decoding; a plan's lineage is restored. Cover `firstRevisionViolation` with one fixture per violation: a question that was not presented moves; an undecided open question is edited; another arbitrated question is dropped; a moved question's fields change; a lifted verdict is returned; the history is wrong on re-arbitration; a principle is unknown (`S12`); a departing verdict has an empty `revised`; a field outside the questions changes while every revised list is empty. Cover the decoder's own checks too (a chosen option not listed, abandoned not exactly the others, a plan phase the plan lacks, broken traceability), each named by path. Cover `renderRevisedArtifact`: the frontmatter is kept byte for byte, and a plan with empty question arrays renders a body identical to its input. The prompt tests assert that F1–F5 come before the presented questions, in scope order, and that the doctrine text and the JSON Schema are present.

### Implementation order

1. Tests for scope, stamp and verdict stamping, then those functions.
2. Tests for `firstRevisionViolation` and `decidedInSession`, then those functions.
3. The re-render and its test.
4. The prompt builders and their tests.

### Excluded scope

- The hand-authored answer, its format and the in-place writer (phase-03).
- Spawning sessions, writing files, the diff and the commit (phase-04).
- The decision record (phase-05).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the exact exports and signatures of `src/domain/decide/revision.ts` and `src/domain/decide/prompt.ts`, the order of the revision checks, which decoder `decodeRevisedDocument` composes, and where the frontmatter split now lives. Say how a re-arbitrated question that the session returns unchanged is treated (not decided). Explain any deviation from the planned file lists.

### Commit subject

`feat(decide): check revised documents and build decide prompts`

### Commit body

Add the pure core of artifact decide for headless-authored specs and
plans: the question scope (--question presents one question alone), the
answer's $schema refused by name unless it is the document format's
current shape, the operator and time stamped on each verdict decided in
the session, and the revision checks. Only presented questions move, the
others stay as they were, a re-arbitrated verdict keeps its predecessor
in history, citations name loaded principle ids, and a departing verdict
names what it revised. Also add the re-render that keeps the frontmatter,
and the interactive, handback and corrective prompts with the framing
questions F1-F5.

---

## phase-03 — Hand-authored decisions written in place {#phase-03-hand-authored}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

phax can decide a hand-authored spec or plan. A new born-with-`$schema` answer format, `hand-decision-answer`, carries the decided verdicts and the revised Markdown. phax validates it against the parsed §9 sections and writes the decisions in place: each decided block moves to the arbitrated section with its Decision block, the accepted body edits apply, the decision log gains entries, and no other line changes.

### Detailed instructions

- Add `src/schemas/handDecisionAnswer.ts`: the file schema of format `hand-decision-answer`, an explicit union on `kind`. `{ $schema: schemaUrlField('hand-decision-answer'), kind: 'spec', decisions: [{ id, verdict: SpecDecidedVerdictSchema }], markdown: NonEmptyString }`, and the same with `kind: 'plan'` and `PlanDecidedVerdictSchema`. Every key is required; decode with `onExcessProperty: 'error'`. Export the decoder and a JSON Schema getter for the prompt.
- Register the format: append `hand-decision-answer` to `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS` in `src/schemas/schemaUrl.ts` (update the doc comment).
- Add `packages/schemas/src/formats/answers.ts` declaring it with `defineFormat` (`preSchema: null`, `releases: []`, current shape from `CURRENT_SHAPES`), as `packages/schemas/src/formats/reports.ts` declares the gate report. Export it from `packages/schemas/src/index.ts`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write` to create `packages/schemas/snapshots/hand-decision-answer/next.schema.json` and regenerate `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`. Never hand-edit those two files or `packages/schemas/history.lock.json`.
- Add the format's row to the README's persisted-formats table, as its test requires.
- Extend `parseHandAuthoredQuestions` (`src/domain/artifact/questions.ts`) so each parsed question also exposes its `recommendation` option id and the 1-based line range of its block (heading through the line before the next question heading or the section end). Expose each section's heading line and range, and the decision log section when there is one (a spec's `## 12. Decision log`, a plan's `## Decision log` in the preamble). Existing callers and tests keep working.
- Add `src/domain/decide/handAuthored.ts` (pure). Export `handAnswerStampViolation(json)`, the same by-name stamp rule as phase-02 for format `hand-decision-answer`.
- Export `stampHandVerdicts(json, scope, operator, atIso)`, which sets by and at on each `decisions[].verdict` before decoding, as phase-02 does for documents.
- Export `firstHandAnswerViolation({ kind, md, parsed, answer, scope, principleIds, phaseIds })`, with paths into the answer. In order, it checks that: `kind` matches; each decision id is presented and appears once; `chosen` is one of the parsed option ids and `abandoned` is exactly the others; principles are loaded ids; a plan verdict's `phase` is one of the plan's `## phase-NN` headings; and a departing verdict (chosen ≠ the parsed recommendation) has a non-empty `revised`.
- It also checks the answer's `markdown`: its frontmatter block, its question sections and its decision log must equal the original's (the session edits only outside them; path `markdown`). And when every decision has `revised: []`, the `markdown` must equal the original.
- Export `writeHandDecisions({ kind, md, answer, parsed, reArbitrated })` → the new Markdown. Start from the answer's `markdown`. Cut each decided open question's block from the open section, append it to the arbitrated section, and follow it with its Decision block. When the open section becomes empty, it holds `None.`.
- For the re-arbitrated question, `writeHandDecisions` replaces its Decision block with the new one and keeps the previous Decision line as an `Earlier decision:` line. It appends one decision-log entry per new verdict.
- When a section is missing, `writeHandDecisions` creates it. A spec's `## 9b. Arbitrated questions` goes right after its open section, and a missing `## 12. Decision log` goes at the end of the file. A plan's `## Arbitrated questions` and `## Decision log` go after its open section, before the first phase. No other line changes.
- Render the Decision block and the log entries with the same functions the renderer uses (`src/domain/authoring/renderQuestions.ts`; export a per-verdict Decision-block and log-line helper there if none is exported), so a hand-authored artifact reads like a rendered one. Finally, re-parse the result with `parseHandAuthoredQuestions` and return a Left when it does not parse, or when its open and arbitrated ids are not the expected ones.
- Extend `src/domain/decide/prompt.ts`: `buildDecidePrompt` and `buildHandbackPrompt` take an authoring variant, `headless` (sidecar JSON plus the document JSON Schema) or `hand` (the artifact Markdown plus the `hand-decision-answer` JSON Schema). The hand handback asks for the decided verdicts and the whole revised Markdown, with question sections, decision log and frontmatter left exactly as they were, because phax writes those.
- Fixtures are made-up hand-authored specs and plans written in the test files.

### Planned files to create

- `src/schemas/handDecisionAnswer.ts`
- `src/domain/decide/handAuthored.ts`
- `packages/schemas/src/formats/answers.ts`
- `packages/schemas/snapshots/hand-decision-answer/next.schema.json`
- `tests/unit/decide/handAuthored.test.ts`
- `tests/unit/schemas/handDecisionAnswer.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/domain/artifact/questions.ts`
- `src/domain/decide/prompt.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `README.md`
- `tests/unit/artifact/questions.test.ts`
- `tests/unit/decide/prompt.test.ts`

### Optional files that may be edited

- `src/domain/authoring/renderQuestions.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `tests/unit/renderSpec.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/reportFormats.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/type/schemasPackage.ts`

### Boundary contracts

`src/domain/decide/handAuthored.ts` produces, for the decide use case (phase-04): the stamped and decoded answer or a refusal named by path (exit 5), and the new Markdown or a Left when the result does not re-parse. The schemas package gains the `hand-decision-answer` format as a parse-only consumer of `src/schemas/handDecisionAnswer.ts`. `parseHandAuthoredQuestions` keeps its result variants (none / parsed / departs) and only adds fields.

### Test strategy

Write the unit tests first. For the schema: both kinds decode; an unknown key, a lifted verdict and a missing `phase` on a plan are refused. For the checks: one fixture per violation, each named by its path. For the writer: a spec with open Q1 and Q2 and no arbitrated section; decide Q1, and the result has Q1's block under a new `## 9b. Arbitrated questions` with its Decision block, Q2 still open, a new `## 12. Decision log` entry, and every other line unchanged (compare line by line). Also cover re-arbitrating an arbitrated question (`Earlier decision:` kept), an open section emptied to `None.`, a plan's preamble sections placed before the first phase, and body edits outside the sections carried over. The parser tests cover the new recommendation id and line ranges. The schemas-package tests cover the new format as the other born formats are covered.

### Implementation order

1. Parser extension and its tests.
2. The answer schema, its format registration, the generated files via schemas-check, the package format and the README row.
3. The hand-answer checks and the writer, test first.
4. The prompt variants.

### Excluded scope

- Spawning the session, the diff, the commit (phase-04).
- Converting a free-form §9 to the §9 format: a hand-authored artifact is converted by hand.
- The approval lock (phase-06).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the `hand-decision-answer` schema module and its exports, the generated stamp it got, the new fields on `parseHandAuthoredQuestions`' result, and the exports of `src/domain/decide/handAuthored.ts`. Say where the Decision block and the decision-log line helpers live, and where missing sections are inserted. Explain any deviation from the planned file lists.

### Commit subject

`feat(decide): write hand-authored decisions in place`

### Commit body

A hand-authored spec or plan has no sidecar for a decide session to
return, so add the hand-decision-answer format, born with $schema: the
decided verdicts by question id and the revised Markdown. phax checks
the verdicts against the parsed section 9 (chosen and abandoned options,
loaded principle ids, a plan's phases), and keeps only the session's
edits outside the frontmatter, the question sections and the decision
log. It then moves each decided block to the arbitrated section with its
Decision block and appends to the decision log, changing no other line.

---

## phase-04 — The decide command {#phase-04-decide-command}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

An operator can run `phax artifact decide <artifact> [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>]` from a terminal on a Draft spec or plan. phax checks every precondition before any session, launches an interactive Claude Code session (resumed from the authoring session when its id is kept), hands the revised document back through a headless resume, validates it, shows the body diff, and writes and commits only what the operator accepts. The phase guard refuses the command inside a phase worktree.

### Detailed instructions

- §5.2: in `src/app/authorArtifact.ts`, after the session returns (and again after a retry), write `<stateRoot>/authoring/<authoringId>/session.json`. Its schema is a new `src/schemas/authoringSession.ts`, the `version: 1` local-state precedent of `src/schemas/adjustPlanSession.ts`: `{ version: 1, provider, sessionId, retrySessionId: string | null, cwd }`. First confirm that the authoring id's stamp is the artifact file's stamp (both come from `formatStamp(nowIso)`) and record the finding in the handoff. Nothing here reaches the records branch.
- §5.3: add `DEFAULT_DECIDE_MODEL = 'claude-opus-5-5'` and `DEFAULT_DECIDE_EFFORT = 'high'` beside the other defaults in `src/schemas/phaxConfig.ts`. Add `src/domain/decide/model.ts`, whose `resolveDecideModel(flagModel, flagEffort)` returns the flag values or the defaults, plus whether each came from a flag. It refuses (Left) a model that is not a `claude-code` catalog entry in `DEFAULT_PROVIDER_CONFIG` (`src/domain/routing/defaults.ts`), and an effort that entry does not list. The refusal names Claude Code as the one provider decide supports.
- Move the pure Claude permission-flag assembly out of `src/infra/providers/claudeCode.ts` into `src/domain/session/claudePermissionFlags.ts`: `gateCommandAllowRules`, the secure flag set and the unsafe `bypassPermissions` branch, taking the policy, cwd, agent commands and an already-built skill-grant settings object. Infra keeps `realpathSync`, the grant settings and the `SecurityEnforcementError`, and its argv stays byte-identical (the `tests/unit/providers/claudeCode.test.ts` expectations stay unchanged).
- Add `buildDecideInvocation({ cwd, session: { kind: 'new' | 'resume', id }, model, effort, permissionFlags, prompt })` to `src/domain/session/claude.ts`. It returns `claude --session-id <id>` or `claude --resume <id>`, then `--model <model> --effort <effort>`, the permission flags, and the positional prompt. Do not change `SessionAdapter`; codex and mistral stay unsupported.
- Add `diffNoIndex(repo, beforePath, afterPath)` → `Effect<string, GitError>` to the Git port (`src/ports/git.ts`). Implement it in `src/infra/git.ts` with `git diff --no-index --no-color`, treating exit 1 (differences) as success, and in the fake (`src/infra/fakes/git.ts`).
- Add `DecideDocumentError` `{ path, message }` to `src/domain/errors.ts`, mapped to exit 5 in `exitCodeForError`. Map an interactive launch failure (`SessionError`) to `AgentInvocationError`, also exit 5.
- Add the use case `src/app/decideArtifact.ts`, composing phase-01 to phase-03 and authoring's machinery without forking it. Its input carries the path, the flags, the bundled skill text for the kind, repoRoot, stateRoot, nowIso, the resolved security config, the extract-plan model and effort, and an output port. It needs FileSystem, Git, Backend, Session, Prompt and Terminal.
- Preconditions, in order, all before any session and none writing. (1) `refuseUnmigratedDocuments('Decide refused')` (§5.54). (2) The artifact validates and is Draft; an Approved or Stale artifact's message names `phax artifact reopen <path>` (reason `not-draft`, §5.7). (3) With a sidecar, its agreement must be in-sync, else reason `sidecar` naming `sidecarRemedy`; without one, `parseHandAuthoredQuestions` must not depart, else reason `hand-format` naming the line (§5.5). (4) `git.dirtyPaths` over the artifact and its sidecar is empty, else reason `dirty`.
- Preconditions, continued. (5) `decideScope`, else reason `unknown-question`. (6) With no open question and no `--question`, print `nothing to decide: <path> has no open question` and return exit 0 with no session (§5.11). (7) `Terminal.stdinIsTerminal`, else reason `no-terminal`, 'decide is interactive only' (§5.8). (8) `resolveDecideModel`, else reason `model`. (9) `resolveDoctrine`. (10) `resolveArbiter('operator', repoRoot)`, else reason `operator`.
- Session. Read `session.json` from `<stateRoot>/authoring/<stamp>-<slug>/`, using `parseArtifactName` on the artifact file name. When it decodes and names `claude-code`, resume `retrySessionId ?? sessionId` from its recorded cwd; otherwise start a new session with `randomUUID()` from repoRoot. Print which it did (§5.1). Decision folder: `<stateRoot>/decide/<stamp>-<slug>/<NN>/`, NN the next two-digit index. Write `prompt.md` there and to `<repoRoot>/.phax-context/decide/<stamp>-<slug>-<NN>/prompt.md`, and pass `positionalPrompt` naming the latter. The permission flags come from `resolveReviewSecurityPolicy` rooted at the session's cwd, exactly as authoring's.
- Interactive run. Read the artifact and sidecar texts, print `decide <kind> <slug> — framing F1–F5, then <ids> — interactive, <resumed authoring session | new session>` and the model line (`<model> / <effort> (flag | catalog default)`). Run `Session.resume(invocation)` and ignore its exit status. Then remove the `.phax-context` copy.
- Handback. Call `backend.resumeAgentSession(id, buildHandbackPrompt(...), options)` with provider `claude-code`, the resolved model and effort, the session's cwd, the review policy, `outputJsonlPath` set to the decision folder's `output.jsonl`, and `phaseFolderPath` set to the decision folder. Parse with `parseFinalMessageJson`. On a refusal (not JSON, a wrong stamp, a decode failure or a revision violation), resume once with `buildDecideRetryPrompt`, transcript in `retry-output.jsonl`. A second refusal fails with `DecideDocumentError` naming both. Rate and usage limits propagate (exit 8, §5.23) with nothing written.
- Validation by authoring variant: headless runs `decodeRevisedDocument` then `firstRevisionViolation`; hand-authored runs phase-03's stamp, decode, checks and writer. When `decidedInSession` (or the hand answer's decisions) is empty, print that nothing was decided, write nothing, and exit 0.
- Diff. Write `before.md` (the current artifact) and `after.md` (the re-rendered or hand-written artifact) into the decision folder, run `git.diffNoIndex`, save the output as `body.diff`, print it, then print one line per presented question: `<id> arbitrated <chosen> (recommended)`, `<id> arbitrated <chosen> — departs: revises <revised…>` or `<id> open (not decided this session)`. Ask `Prompt.confirm({ message: 'accept the body diff?', initialValue: false })`. A decline or a cancel writes nothing and exits 0 (§5.22).
- Changed during the session. Re-read the artifact and sidecar right before writing. If either differs from the snapshot, fail with reason `changed`, leaving them in place and committing nothing (§5.24).
- Write. For a headless plan, first `seedPlanCache` with the re-rendered Markdown, the document and the extract model and effort (§5.31); the lineage is already restored (§5.32). Write the artifact, then the sidecar when there is one (§5.26).
- Commit. Run `git.commitPaths` over exactly those paths (§5.28) with subject `docs(specs|plans): decide <slug> <ids>` and a body naming the model and effort, `Decided-By: operator (<name>)` and `Decision-Id: <stamp>-<slug>/<NN>`. A commit failure is `ArtifactCommitFailedError`, with the files left written (exit 12 through `exitCodeForAuthoringError`, §5.29). Return a result union `nothing | undecided | declined | committed`, the last with its commit.
- CLI. Add `src/cli/commands/artifactDecide.ts` (`runArtifactDecide`) and register `decide` under `artifact` in `src/cli/commands/artifact.ts`. Resolve phax.json (security, extract-plan model and effort, records), stateRoot and the bundled skill text from `defaultBundleRoot()`, as headless `artifact new` does. Normalise the artifact and `--doctrine` paths to repo-relative. Provide the rooted FileSystem, Git, Terminal, Prompt, Session (`makeNodeSessionLayer`) and Backend layers. Render the result, and map errors with `exitCodeForAuthoringError`. The command file holds no business logic.
- Classify `artifact decide` as `refused` in `src/domain/security/phaseGuard.ts` (§5.9). Add `artifact decide` to `src/cli/cliDocs.ts` (summary, the flags, an example, and the exit families 0, 1, 5, 8, 12 from the spec's §6), then run `pnpm gen:usage-spec` and `pnpm docs:cli`. Never edit `phax.usage.kdl` by hand.
- Add a Decide row to the defaults table in `docs/model-catalog.md` §4: `DEFAULT_DECIDE_MODEL`, `claude-opus-5-5`, `high`, with the plan-adjustment justification and its accepted loss.
- Tests use a temporary git repository (`tests/helpers/tempGit.ts`), the rooted FileSystem, the fake Backend (scripted final texts, plus a usage-limit failure), the fake Session (records the invocation, returns 0), and the fake Prompt and Terminal. Never start a real provider.

### Planned files to create

- `src/app/decideArtifact.ts`
- `src/domain/decide/model.ts`
- `src/domain/session/claudePermissionFlags.ts`
- `src/schemas/authoringSession.ts`
- `src/cli/commands/artifactDecide.ts`
- `tests/unit/decide/model.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/decideHandAuthored.test.ts`
- `tests/integration/gitDiffNoIndex.test.ts`

### Planned files to edit

- `src/app/authorArtifact.ts`
- `src/schemas/phaxConfig.ts`
- `src/domain/session/claude.ts`
- `src/infra/providers/claudeCode.ts`
- `src/ports/git.ts`
- `src/infra/git.ts`
- `src/infra/fakes/git.ts`
- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/artifact.ts`
- `src/domain/security/phaseGuard.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `docs/model-catalog.md`
- `tests/unit/sessionAdapters.test.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `tests/integration/authorArtifact.test.ts`

### Optional files that may be edited

- `src/domain/authoring/retry.ts`
- `src/domain/decide/revision.ts`
- `src/domain/decide/prompt.ts`
- `src/domain/decide/handAuthored.ts`
- `src/domain/artifact/frontmatter.ts`
- `src/app/unmigratedDocuments.ts`
- `src/infra/fakes/session.ts`
- `src/infra/fakes/backend.ts`
- `src/infra/fakes/prompt.ts`
- `src/infra/fakes/terminal.ts`
- `src/cli/cliCompleters.ts`
- `tests/unit/providers/claudeCode.test.ts`
- `tests/integration/authorArtifactRetry.test.ts`
- `tests/integration/phaseGuard.test.ts`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/cliErrors.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/loadConfig.test.ts`

### Boundary contracts

CLI → app: `runArtifactDecide` parses the flags and resolves config, then calls `decideArtifact` once and renders its result union (`nothing | undecided | declined | committed`) through the OutputPort. App → ports: Session (the interactive launch, which returns an exit code only), Backend (`resumeAgentSession` for the handback and its one corrective resume), Git (`dirtyPaths`, `committerName`, `diffNoIndex`, `commitPaths`, `headCommit`), Prompt (`confirm`), Terminal (`stdinIsTerminal`), FileSystem. Authoring → decide: `session.json` in the authoring state folder (`version: 1`, provider, sessionId, retrySessionId, cwd) is the only handoff, and it stays local. Phase-05 consumes the decision folder (`prompt.md`, handback prompts, `document.json`, `body.diff`, transcripts), the decision id and the result to write the record.

### Test strategy

Write the unit tests for `resolveDecideModel` and for `buildDecideInvocation`'s argv (new vs resume, flags, permission flags equal to the headless secure flags for the same policy) first. Integration tests in `tests/integration/decideArtifact.test.ts` cover the §8 criteria through the use case. An interactive session lands: resumed vs new, the printed mode, Q1 moved with an operator verdict named by the committer, Q2 open, the sidecar at the current `spec-document` stamp, exactly two paths in HEAD, and the second run writes nothing. Model from flag, then catalog. Preconditions refuse before the session: diverged, dirty, Completed, Approved naming reopen, no terminal, a `--model` outside Claude. Framing first and re-arbitrating Q1 with history. Unknown `--question Q9`. Nothing to decide. Project skill override plus `--doctrine` order, `X1` and `C4` accepted, `S0` rejected. Bad doctrine files. Invalid decisions and wrong-stamped answers give exit 5 with tree and HEAD unchanged. Revision rules. A usage limit gives 8 with nothing written. A concurrent edit gives 12 with no commit. A commit failure gives 12 with the files left. A plan decide keeps the plan executable (`lintPlan` has no structure error, `loadOrExtractPlan` finds the seeded projection without calling the backend, the lineage is unchanged). Ids name questions (`q-keep`, `q-scope`). A departing verdict is declined, then accepted. Decide waits for migration. `tests/integration/decideHandAuthored.test.ts` covers the hand-authored criterion's decide steps. `tests/integration/gitDiffNoIndex.test.ts` exercises the real git adapter on two temp files. The phase-guard unit test classifies `artifact decide` as refused, and the authoring test asserts `session.json` after a first answer and after a retry.

### Implementation order

1. `session.json` written by authoring, and its test.
2. Decide model defaults and `resolveDecideModel`.
3. The permission-flag extraction (headless argv unchanged), then `buildDecideInvocation`.
4. `Git.diffNoIndex` (port, infra, fake) and its integration test.
5. `DecideDocumentError` and the exit mappings.
6. `decideArtifact` (preconditions, session, handback, validation, diff, write, commit) with its integration tests, headless then hand-authored.
7. CLI command, phase guard, cliDocs, `pnpm gen:usage-spec`, `pnpm docs:cli`, and the model-catalog row.

### Excluded scope

- The decision record and `records explain` (phase-05).
- The approval lock and the status and migrate wording (phase-06).
- Interactive launch for Codex or Vibe; a `phax.json` key for the decide model.
- A headless decide mode.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the `decideArtifact` input and result types and the decision-folder layout (file names), and the decision id and commit trailer. Record the `session.json` schema and what the stamp check found. Record `diffNoIndex`'s signature, the new module path of the permission flags, the decide defaults, and the phase-guard entry. Say exactly where the decide use case writes nothing (every early return), so phase-05 can attach the record to every outcome after the session spawned. Explain any deviation from the planned file lists.

### Commit subject

`feat(decide): add phax artifact decide`

### Commit body

Add the decide command: on a Draft spec or plan, from a terminal, phax
checks every precondition (migration, Draft, sidecar in sync or a
parsable hand-authored section 9, a clean write set, a known --question,
a Claude model, the doctrine, the committing identity), then launches an
interactive Claude Code session under the read-only review policy. The
session resumes the authoring session when its id was kept. When the
operator exits, phax resumes it headless for the revised document,
validates it, shows the body diff, and writes, re-seeds a plan's
extraction cache and commits exactly the artifact and its sidecar once
the operator accepts. Authoring now keeps its provider, session ids and
cwd in local state. The phase guard refuses decide inside a phase
worktree.

---

## phase-05 — The decision record {#phase-05-decision-record}

**Recommended model:** claude-opus-5-5
**Recommended effort:** high

Every decide session that spawned leaves a decision record on `phax/records/v1` when records are enabled. Its manifest is stamped with the new `decision-record-manifest` format, and `phax records explain <sha>` resolves a decide commit to it.

### Detailed instructions

- Add `src/schemas/decisionRecord.ts`. Define the manifest fields: `kind: 'decision'`; `decisionId` (`<stamp>-<slug>/<NN>`); `artifact`; `artifactKind: 'spec' | 'plan'`; `mode: 'interactive'`; `session: 'new' | 'resumed-authoring'`; `doctrine: Array<{ kind: 'skill', name, source: 'bundled' | 'project', fingerprint } | { kind: 'file', path, fingerprint }>`; `questions` (the presented ids); `arbitrated` and `departed` (counts); `sourceSha` (HEAD when the session started); `shape` (`RecordShapeSchema`); `provider`, `model` and `effort`; `outcome: 'committed' | 'declined' | 'undecided' | 'failed'`; `commit: string | null`; `usage` (`TokenUsageSchema`).
- Every key is required, with explicit per-variant enums. There is no session id, so a resumed authoring session's id never reaches the records branch. Export the file schema (`$schema: schemaUrlField('decision-record-manifest')` first), the decoder (`onExcessProperty: 'error'`), the encoder and `isDecisionRecordManifest`.
- Register `decision-record-manifest` in `FORMAT_IDS` and `SCHEMA_BORN_FORMAT_IDS` (`src/schemas/schemaUrl.ts`). Add it to the `RecordManifestFileSchema` union and the `RecordManifest` type in `src/schemas/authoringRecord.ts`.
- Declare the format in `packages/schemas/src/formats/recordManifests.ts` (born with `$schema`: no pre-schema, no releases), include it in `parseRecordManifest`'s format map, and export it from `packages/schemas/src/index.ts`. Run `pnpm exec tsx scripts/schemas-check.ts --write` for `packages/schemas/snapshots/decision-record-manifest/next.schema.json` and the generated files. Add the README persisted-formats row.
- Add `src/app/writeDecisionRecord.ts`, following `src/app/writeAuthoringRecord.ts` and `src/app/recordPlumbing.ts`: the same destination policy, transcript setting and tree-only commit. The key is `decision/<decisionId>`, with commit message `records(decision): <outcome>` plus `Decision-Id:` and `Artifact:` lines.
- The record files come from the decision folder: `prompt.md`, `handback-prompt.md`, `retry-prompt.md` when retried, `document.json` (the accepted answer, when one decoded), `body.diff` (when shown), and `output.jsonl` and `retry-output.jsonl` per `records.transcript`. Usage comes from `computeSessionUsage` over the handback turns, as authoring locates it for `claude-code`.
- Wire the record into `src/app/decideArtifact.ts`. After the interactive session has spawned, every end (committed, declined, undecided, or failed: a document refusal, a rate or usage limit, a concurrent edit, a commit failure) writes one record. A committed record carries the commit; a failed one is written before the error is re-raised. Push it with `pushRecordsBranch`, and warn on a refused, deferred or failed record or push, with authoring's `recordWarning` and `recordPushWarning` wording adapted to 'decision record'. A record never fails the decide. Refusals before the session write no record.
- Teach `src/app/recordsExplain.ts` the `Decision-Id` trailer: the address is `{ kind: 'decision', decisionId }`, the key is `decision/<id>`, and a `found-decision` result holds the manifest and the record's file list. A phase or authoring manifest under a decision key, or the reverse, is reported malformed, as today. Render it in `src/cli/commands/records.ts`: the prompt and document file paths, the doctrine sources with fingerprints, the questions presented, `arbitrated` and `departed`, provider, model, effort, usage, outcome and commit.
- Update the decide CLI rendering to print the record status as headless `artifact new` does.

### Planned files to create

- `src/schemas/decisionRecord.ts`
- `src/app/writeDecisionRecord.ts`
- `packages/schemas/snapshots/decision-record-manifest/next.schema.json`
- `tests/unit/decisionRecord.test.ts`
- `tests/integration/writeDecisionRecord.test.ts`

### Planned files to edit

- `src/schemas/authoringRecord.ts`
- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/app/decideArtifact.ts`
- `src/app/recordsExplain.ts`
- `src/cli/commands/records.ts`
- `src/cli/commands/artifactDecide.ts`
- `packages/schemas/src/formats/recordManifests.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `README.md`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/recordsExplain.test.ts`
- `tests/unit/schemasPackage/recordManifests.test.ts`

### Optional files that may be edited

- `src/app/recordPlumbing.ts`
- `src/app/writeAuthoringRecord.ts`
- `src/app/recordsList.ts`
- `src/domain/records/assemble.ts`
- `src/schemas/persisted.ts`
- `packages/schemas/src/formats/recordTimeline.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `tests/unit/authoringRecord.test.ts`
- `tests/unit/recordsAssemble.test.ts`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/recordTimeline.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/decideHandAuthored.test.ts`

### Boundary contracts

`writeDecisionRecord` (producer) takes the decision folder and the session facts from `decideArtifact` (consumer of the result: written, records-off, refused, deferred) and never fails it. `parseRecordManifest` in the schemas package and phax's `decodeRecordManifestFile` both read the new format. `records explain` maps the commit trailer `Decision-Id` to the key `decision/<id>`.

### Test strategy

Write the schema unit tests first: the manifest decodes with every outcome; an unknown key, a missing `commit`, and a `sessionId` key are refused. `tests/integration/writeDecisionRecord.test.ts` covers the record tree per transcript setting and records off as a no-op. Extend `tests/integration/decideArtifact.test.ts` with the §8 criteria. 'Record explains the decisions': a committed decide that arbitrated two questions, one departing, then `records explain <sha>` shows the facts with `arbitrated: 2` and `departed: 1`, and the manifest's `$schema` names `decision-record-manifest`. 'Invalid decisions land nothing': a record with outcome `failed`. A declined diff gives a `declined` record. A resumed authoring session's id appears nowhere in the record tree (grep the committed blobs). The schemas-package tests cover the new format beside the other record manifests.

### Implementation order

1. Schema, format registration, schemas-check, the package format and the README row.
2. `writeDecisionRecord` and its integration test.
3. Wire it into `decideArtifact` for every outcome after spawn.
4. `records explain` and its CLI rendering.

### Excluded scope

- Any change to the authoring record format.
- `phax records list` or timeline presentation beyond what the union requires.
- The approval lock (phase-06).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the manifest's final key spelling and the stamp it got, the record file names, the `records explain` result variant, and the warnings decide prints for a record or push. List every outcome path in `decideArtifact` and whether it writes a record. Explain any deviation from the planned file lists.

### Commit subject

`feat(records): record decide sessions`

### Commit body

Every decide session that spawned now writes a decision record on
phax/records/v1 when records are enabled, under the new
decision-record-manifest format, born with $schema. The record holds the
prompt, the doctrine sources with their fingerprints, the questions
presented, the accepted document and body diff, the arbitrated and
departed counts, the transcript per the records setting, provider, model,
effort, usage, and the outcome: committed, declined, undecided or
failed. It never carries a session id. `phax records explain` resolves a
decide commit through its Decision-Id trailer.

---

## phase-06 — The approval lock and the wording that names decide {#phase-06-approval-lock}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Approval refuses while a spec or plan has an open question, whether headless or hand-authored, and refuses a hand-authored §9 that does not parse. Status points at decide, the legal transitions say approval waits for no open question, migrate-documents names decide for an Approved artifact left with open questions, and plan authoring invites open questions.

### Detailed instructions

- Add `ArtifactOpenQuestionsError` `{ path, open: readonly string[] }` to `src/domain/errors.ts`, whose message is `Approval refused: <path> has open questions — <ids>` plus `answer them with \`phax artifact decide <path>\``. Add `ArtifactQuestionsUnparsedError` `{ path, line, text }`, naming the departing line. Map both to exit 12 in `exitCodeForError`.
- In `src/app/artifactStatus.ts`, in `transitionArtifact`'s approve path, after the sidecar agreement check and before the write set: a sidecar's `openQuestions` (a spec) or `preamble.openQuestions` (a plan) must be empty. Without a sidecar, `parseHandAuthoredQuestions` must not depart and its open list must be empty. An artifact with neither section is approved with no question check (§5.38, §5.39). Nothing is written on refusal.
- In `src/cli/commands/artifact.ts`'s status rendering: under the `Questions:` line, when any question is open, print `  decide with \`phax artifact decide <path>\``. In `Legal transitions`, print `Approved` as `Approved (once no question is open)` while a question is open.
- In `src/domain/artifact/render.ts`, the migrate-documents report for an Approved artifact left with open questions now reads `now edited since approval, with open questions <ids> — reopen it and decide <ids> before re-approving`.
- In `src/domain/authoring/prompt.ts`, the plan branch no longer asks for an empty `preamble.openQuestions` (§5.59). It invites the planner to leave each technical arbitration it cannot settle as an open question in `preamble.openQuestions`, in the same shape as a spec's (`id`, `question`, options with `id`, `label` and `abandons`, `recommendation` naming an option id, `rationale`), with settled ones staying prose in `technicalArbitrations`. `preamble.arbitratedQuestions` stays `[]` (§5.60, already enforced by the decoder). The spec branch is unchanged.
- Update `.claude/skills/phax-planning/SKILL.md` to match. In the Technical arbitrations and questions text and the Headless authoring section, a headless plan may now leave unsettled arbitrations in `openQuestions`; `arbitratedQuestions` stays `[]`; `phax artifact decide <plan>` answers them; and approval needs the open section to be empty. Do not touch the generated model-catalog block between its BEGIN/END markers.
- Update test fixtures that approve an artifact which still has open questions: empty their open questions or decide them through fixtures, without weakening what each test asserts.
- Add `tests/integration/approvalLock.test.ts` for the lock criteria: a headless Draft spec with open questions refused naming them and decide; a hand-authored spec whose open section is empty approved; one with no question section approved; a hand-authored §9 that does not parse refused naming the line; a plan with open Q2 refused naming Q2.
- Add `tests/integration/decideLifecycle.test.ts` for the decide steps of the criteria plans A and B left, through `decideArtifact` with the fakes. Covered: reopen an Approved spec, then `decide --question Q1`. Reopening a spec with a bound plan: plans status fresh, then after an accepted decide, stale with `spec-changed`. A lifted 0.17.0 spec after migration: the second approve refused naming Q2 and Q3, and decide presents only Q2 and Q3 with Q1's and Q4's lifted Decision lines in the re-rendered body. Status counts by state and arbiter after a decide and a `--by machine:roadmap-loop` approval, for a spec and for a plan. A hand-authored spec decided in place, then approve refused naming Q2.

### Planned files to create

- `tests/integration/approvalLock.test.ts`
- `tests/integration/decideLifecycle.test.ts`

### Planned files to edit

- `src/domain/errors.ts`
- `src/cli/commands/runLayers.ts`
- `src/app/artifactStatus.ts`
- `src/cli/commands/artifact.ts`
- `src/domain/artifact/render.ts`
- `src/domain/authoring/prompt.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `tests/unit/authoringPrompt.test.ts`
- `tests/unit/artifact/render.test.ts`
- `tests/unit/cli/artifactStatusRender.test.ts`
- `tests/integration/migrateDocuments.test.ts`

### Optional files that may be edited

- `src/domain/artifact/questions.ts`
- `src/app/migrateDocuments.ts`
- `tests/integration/artifactStatus.test.ts`
- `tests/integration/artifactQuestionsStatus.test.ts`
- `tests/integration/approvalAttribution.test.ts`
- `tests/integration/approvalRecordMerge.test.ts`
- `tests/integration/approvalRecordGround.test.ts`
- `tests/integration/artifactReopen.test.ts`
- `tests/integration/completeRunArtifacts.test.ts`
- `tests/integration/documentMigrationRefusal.test.ts`
- `tests/integration/createArtifact.test.ts`
- `tests/integration/decideArtifact.test.ts`
- `tests/integration/decideHandAuthored.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/cli/artifact.test.ts`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/integration/cliErrors.test.ts`

### Boundary contracts

The approve path (producer of the refusal) reads the question state from the single source per artifact: the sidecar's arrays, or the hand-authored §9 parsed by `parseHandAuthoredQuestions`. Status, the approve refusal and decide all derive from that same source. The plan-authoring prompt (producer) and the plan document decoder (consumer) agree that `preamble.openQuestions` may be non-empty and `arbitratedQuestions` must be `[]`.

### Test strategy

Write the approval-lock integration tests first (they fail until the lock lands). Update the unit tests for the status rendering (decide pointer, annotated legal transition), the migrate report wording and the plan-authoring prompt. The lifecycle integration test drives decide with the fake backend, session, prompt and terminal, and chains it with the real approve, reopen, status and plans-status use cases on a temporary git repository. Fixtures are made up.

### Implementation order

1. Errors and exit mapping.
2. The lock in `transitionArtifact`, with `approvalLock.test.ts`.
3. Fixture updates for tests that approved artifacts with open questions.
4. Status rendering and migrate wording, with their unit tests.
5. Plan-authoring prompt and the phax-planning skill.
6. `decideLifecycle.test.ts`.

### Excluded scope

- Rewriting any file under `docs/specs/` or `docs/plans/` of this repository; the two parked hand-authored specs are already Approved and stay as they are.
- Blocking complete or abandon on open questions.
- README, docs page, phax-cli and phax-spec skills (phase-07).

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Record the two new error classes and their messages, exactly where the lock sits in `transitionArtifact`, the status and migrate wording as printed, and the plan-authoring prompt line. List every test fixture changed for the lock and why. Explain any deviation from the planned file lists.

### Commit subject

`feat(artifact): refuse approval while questions are open`

### Commit body

phax artifact approve now refuses a spec or plan whose open-questions
section is not empty, naming the open ids and `phax artifact decide`.
This covers headless and hand-authored artifacts alike. A hand-authored
section 9 that does not parse is refused at its first departing line,
and an artifact with no question section is approved as before. Status
points at decide and says approval waits for no open question,
migrate-documents tells an Approved artifact left with open questions to
reopen and decide, and plan authoring now invites unsettled arbitrations
as open questions.

---

## phase-07 — Arbitration docs, README, skills and NEXT_STEPS {#phase-07-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator can learn decide from `docs/arbitration.md`, the README, and the phax-cli and phax-spec skills, and NEXT_STEPS records `artifact-decide` as done with headless-review next.

### Detailed instructions

- Create `docs/arbitration.md` per the spec's §11. The reader is an operator who wants a spec's or plan's open questions decided under a written doctrine. Cover: framing first (F1–F5, listed); then each question; the revised document and the body diff accepted before writing; `--question` re-arbitration keeping history; reopen to go back from Approved; the approval lock; machine vs operator vs unattributed approvals; the doctrine skills, the project override in `.claude/skills/` and `--doctrine`; Claude Code only; the decision record and `phax records explain`; and the exit codes.
- Use the spec's §11 example sequence with made-up artifact names, and keep it consistent with the command's actual output from phase-04 to phase-06.
- Register the page in `site/pages.ts` with a route under the guide (for example `/guide/arbitration`), a title and a one-sentence description, following the existing entries.
- README: document `phax artifact decide` and its flags; the approval lock (approve refuses while a question is open, naming decide); the three doctrine skills installed by `phax skills install`; and link `docs/arbitration.md`. Keep the persisted-formats table rows that phases 03 and 05 added accurate.
- .claude/skills/phax-cli/SKILL.md: add decide to the artifact flow (status → decide → approve; reopen → decide --question) and the lock; decide is refused inside a phase worktree and needs a terminal.
- .claude/skills/phax-spec/SKILL.md: approval needs an empty `## 9. Open questions` section, and `phax artifact decide` answers it; a hand-authored §9 follows the §9 format with option ids.
- NEXT_STEPS.md: mark the `artifact-decide` entry done (all three plans shipped), and name headless-review as next, adopting the machine/operator approval form.
- Touch the three `phax-decide-*` skills only to fix a reference this phase's docs make inconsistent; otherwise leave them. Edit no other `.claude/` file.

### Planned files to create

- `docs/arbitration.md`

### Planned files to edit

- `README.md`
- `site/pages.ts`
- `.claude/skills/phax-cli/SKILL.md`
- `.claude/skills/phax-spec/SKILL.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `.claude/skills/phax-decide-spec/SKILL.md`
- `.claude/skills/phax-decide-plan/SKILL.md`
- `.claude/skills/phax-decide-review/SKILL.md`
- `tests/unit/readmeExitCodes.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/npmReadme.test.ts`
- `tests/unit/approvalRecordDocs.test.ts`
- `tests/unit/completesSpecDocs.test.ts`
- `tests/unit/exampleStamps.test.ts`
- `tests/unit/site/pageMap.test.ts`
- `tests/unit/site/links.test.ts`

### Test strategy

No new tests. The existing README, docs and site tests (exit codes, persisted formats, example stamps, page map, links) must stay green; update them only where the new page or text requires it.

### Implementation order

1. `docs/arbitration.md` and its `site/pages.ts` entry.
2. README sections.
3. phax-cli and phax-spec skills.
4. NEXT_STEPS.

### Excluded scope

- Any code change.
- The phax-planning skill (phase-06) and its generated model-catalog block.
- Any file under `docs/specs/` or `docs/plans/`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

List the docs and skill sections added or changed, the site route of `docs/arbitration.md`, and the NEXT_STEPS wording. Say whether any `phax-decide-*` skill changed and why. Explain any deviation from the planned file lists.

### Commit subject

`docs: document artifact decide and the approval lock`

### Commit body

Add docs/arbitration.md for operators: framing questions first, then
each open question under a doctrine, the body diff accepted before
writing, re-arbitration with --question, reopen, the approval lock, and
telling a machine's approval from a human's. Document decide, the lock
and the doctrine skills in the README and the phax-cli and phax-spec
skills, and mark artifact-decide done in NEXT_STEPS, with headless-review
next.
