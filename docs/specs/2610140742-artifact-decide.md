---
status: Approved
date: 2026-10-14
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-14
  baseline: a005dbb
---
# Artifact decide — arbitrating a spec's or plan's open questions

## 1. Context

Headless authoring (0.16.0) made a spec's open questions data. The spec document's `openQuestions[]` use the decision-request shape `{ id, question, options[{ id, label, abandons }], recommendation, rationale }`. phax writes the document as a JSON sidecar (`<stamp>-<slug>.json`) beside the Markdown it renders from it, and the sidecar travels with every lifecycle transition. `artifact approve` refuses with exit 12 when the body is not the sidecar's rendering; the frontmatter never counts. The renderer writes §9 as `## 9. Open questions for implementation planning` and numbers each heading `Q<n>` by position, not by the question's id. Its option bullets and `Recommendation:` line print labels, not option ids.

The data never marks a question as decided. By convention, a question the author has decided stays in `openQuestions`, and its `rationale` opens with `Decided by the author on <date>`. Some specs also append ` (Decided by the author on <date>; not reopened.)` to `question`, as the drafts of this spec do. The two other in-flight specs, `headless-review` and `oracle-phases`, mark their 13 decided questions with the rationale prefix alone. Where the author decided against the recommendation, `recommendation` was rewritten to the option chosen. Nothing in phax reads the marker.

The plan document has no question structure: `preamble.technicalArbitrations` is plain strings. It carries the lineage `sourceSpec` and `completesSpec`, mirrored in the frontmatter as `source-spec` and `completes-spec`. `artifact new plan --spec` requires exactly one of `--last` and `--not-last`. A headless plan seeds the extraction cache with its projection.

The authoring record keeps no provider session id. Since 0.23.0, when the decoder refuses a document, phax retries it by resuming the same session once, within the same process. The id lives only in memory, for that resume and to locate usage, so no authoring session can be resumed after phax exits. `adjust-plan` is the precedent for a session id kept locally (`version: 1`, `sessionId`) and resumed later.

Approvals are recorded in two places:
- an `approved: { date, baseline }` frontmatter stamp;
- one record file per artifact: `docs/specs/approvals/<spec file name>.json` (format `spec-approval-record`: `$schema`, `artifact`, `specFingerprint`, `approvedAt`, `baseline`) or `docs/plans/approvals/<plan file name>.json` (`plan-approval-record`, which adds `sourceSpec`).

Neither records who approved. The old `docs/{specs,plans}/approvals.json` ledgers are read only by `phax artifact migrate-approvals`, and every command that reads or writes approval records refuses while one exists. That command is phax's precedent for a one-time migration. It decides everything before writing, refuses a write-set with uncommitted changes, commits exactly the paths it wrote in one commit, and prints `nothing to migrate` when there is nothing to do. Re-approving an Approved artifact is how an in-place revision is recorded. The fingerprint ignores `status` and `approved`. `artifact status` reports approval for specs only. `phax artifact reopen` moves a Stale plan to Draft: it clears the stamp and deletes the plan's record file. A spec cannot be completed or abandoned while a live plan names it.

Persisted formats are versioned by shape. A file's `$schema` stamp names the release that last changed its format: today spec-document 0.17.0, plan-document 0.20.0, and 0.19.0 for both approval record formats. A shape change is recorded as `packages/schemas/snapshots/<format>/next.schema.json` and released by the cut. The previous shape is frozen under `src/schemas/history/<format>/<release>.ts`, pinned by `packages/schemas/history.lock.json`. Today phax lifts an older file through its frozen shape in one case only: an authoring record manifest stamped 0.17.0 is lifted with `retry: "none"` (0.23.0). Elsewhere it refuses. A plan document stamped 0.17.0–0.19.x lacks `completesSpec` and is refused; its frozen module serves only the schemas package. The rule for provider answers was decided on 2026-10-08: before 1.0, an answer in an older shape of a format that changed is refused by name, never lifted.

The three arbitration doctrines landed at `.claude/skills/phax-decide-spec`, `phax-decide-plan` and `phax-decide-review`, and `package.json` `files` ships them. The skill catalog behind `phax skills install` lists only `phax-planning`, `phax-cli` and `phax-spec`. Each doctrine rests on `E0` (explicit over implicit) and on the pairs `C1`–`C5` with a precedence order. Each adds its own principles, `S1`–`S10`, `P1`–`P9` or `R1`–`R7`, every one a list item that opens with a backticked id. The doctrines describe an interactive mode, a headless mode that decides and escalates, and a later headless-total mode. They output `{ decisions: [{ id, chosen, abandoned[], advocate, why, principles[], reversibility, escalate }] }` and carry no framing questions.

phax runs stay autonomous (decided 2026-10-10). The `decision` class was dropped, `phase-decision-requests` stays parked, and a person reaches a run only through its review notes, after it. Inside a phase worktree, the phase guard refuses every command not classified as allowed, including a new one, and exits 1.

The first consumer is the steme roadmap-1.0 conductor. It authors every spec and plan headless, has their open questions arbitrated, and approves them. When an answer must be reconsidered, it relays a human steering instruction, `rouvre <question>`.

Ground read:

- `docs/specs/archive/2610140718-artifact-decide.md` — The third draft, drafted and abandoned 2026-10-14, and the base of this one. Its re-grounding stands, and so do its structure, terminology, requirements, surfaces, criteria, question ids and §9 options and losses. This draft changes only what the author's decisions of 2026-10-14 on Q4 and Q15–Q19 require. The Q16 decision went against the third draft's recommendation, so every part written for `frozen-layout` is rewritten for the migrate command.
- `docs/specs/archive/2610140718-artifact-decide.json` — The third draft's sidecar, with its option ids and its §9 questions Q1–Q4, Q6, Q8–Q12 and Q14–Q19.
- `docs/specs/archive/2609250815-artifact-decide.md` — The second draft: approved 2026-09-29 at baseline bc84612, abandoned 2026-10-14. It is the origin of the design and of the carried-over answers. Its §11 docs page is kept as it was.
- `docs/specs/archive/2609250815-artifact-decide.json` — The second draft's sidecar, with the option ids and dates of its §9 answers. Its decided rationales open "Decided by the author on <date>." and its questions carry no suffix marker.
- `docs/specs/2609250823-headless-review.json` — In flight. Eight decided questions, each marked only by a rationale that opens `Decided by the author on 2026-09-2x`, with no suffix on the question. Where the author departed from the recommendation, the rationale says so and `recommendation` names the option chosen.
- `docs/specs/2609281159-oracle-phases.json` — In flight. Five decided questions, marked the same way, by the rationale only. One reads "against the previous recommendation (`structural`)" with `recommendation: new-oracle-surface`, so the recommendation names the choice.
- `src/schemas/specApprovalRecord.ts` — `spec-approval-record`: `$schema`, then `artifact`, then specFingerprint, approvedAt and a 40-hex baseline. Excess keys are rejected, and no approver is recorded. The old `spec-approvals` ledger shape is kept only to migrate it.
- `src/schemas/approvalRecord.ts` — `plan-approval-record`: the same fields plus `sourceSpec` (a path and fingerprint, or null). No approver is recorded. The old `plan-approvals` ledger is read only to migrate it.
- `src/domain/artifact/approvalRecordFile.ts` — One record file per live artifact: `docs/specs/approvals/<spec>.json` and `docs/plans/approvals/<plan>.json`. While an old ledger exists, every command that reads or writes records refuses until `phax artifact migrate-approvals` splits it.
- `src/app/migrateApprovals.ts` — The precedent for a one-time migration. It decides everything before writing and writes nothing on a refusal. It refuses a write-set with uncommitted changes. It writes, then commits exactly those paths in one commit, and prints `nothing to migrate` when there is nothing to do.
- `src/domain/artifact/sidecar.ts` — Agreement is in-sync, diverged or invalid, computed from the body and the sidecar's rendering with the frontmatter ignored. The remedy for a diverged or invalid sidecar is to re-author the artifact headless, or to delete the sidecar and demote the artifact to hand-authored.
- `src/app/artifactStatus.ts` — Status and transitions. Approval info is computed for specs only. Approve refuses a diverged or invalid sidecar with exit 12. Reopen (Stale → Draft) clears the `approved` stamp and deletes the plan's record file. A spec's terminal transition is refused while live plans name it. Status and every transition refuse while an old ledger exists.
- `src/domain/artifact/status.ts` — The transition tables. Specs have no edge back to Draft. A plan reaches Draft only from Stale. Approved → Approved is legal for both kinds.
- `src/domain/artifact/frontmatter.ts` — `fingerprintSource` deletes `status` and `approved` before hashing, so a reopen alone does not change an artifact's fingerprint.
- `src/domain/artifact/lineage.ts` — A plan is stale with `spec-changed` evidence when its recorded source-spec fingerprint differs from the spec's current one, and with `self-changed` evidence when its own content differs.
- `src/schemas/release.ts` — CURRENT_STAMPS: spec-document 0.17.0, plan-document 0.20.0, spec-approval-record and plan-approval-record 0.19.0, authoring-record-manifest 0.23.0. PHAX_RELEASE, the opened version, is 0.24.0.
- `src/schemas/persisted.ts` — The reader bridge. Only one format is lifted from an older `$schema` shape today: an authoring record manifest stamped 0.17.0 is read through its frozen decoder and lifted with `retry: "none"`. A plan document stamped 0.17.0–0.19.x (no completesSpec) is refused, and approval record files are read at their current shape only.
- `src/schemas/history/plan-document/0.17.0.ts` — A frozen shape that phax itself never imports; only the schemas package lists it. A frozen module therefore does not by itself mean that phax lifts the format.
- `packages/schemas/history.lock.json` — Pins the bytes of every frozen module under src/schemas/history/.
- `docs/release.md` — A `$schema` stamp names the release that last changed the format's shape. A shape change is a `next` snapshot, which the cut renames to the release. A wording-only schema change moves no stamp.
- `src/schemas/specDocument.ts` — openQuestions[] uses the decision-request shape with no verdict or history, under traceability checks: ids are unique, and a recommendation names one of its question's options. The authoring answer is `version: 1` plus the fields; the sidecar is `$schema` plus the fields.
- `src/schemas/planDocument.ts` — preamble.technicalArbitrations is plain strings, with no question structure. The lineage `sourceSpec`/`completesSpec` is either a path with a boolean, or null with null.
- `src/domain/authoring/renderSpec.ts` — §9 renders as `## 9. Open questions for implementation planning`. Headings are numbered `Q<n>` by position, not by id. Option bullets and the Recommendation line print labels, not option ids.
- `src/domain/authoring/renderPlan.ts` — `## Technical arbitrations` renders only when non-empty.
- `src/schemas/authoringRecord.ts` — The authoring manifest keeps no provider session id. Its `retry` (none | retried) records whether a refused document was retried by resuming the session once.
- `src/app/authorArtifact.ts` — The 0.23.0 retry resumes the same session once, within the same process, to retry a refused document. The session ids live only in memory.
- `src/app/writeAuthoringRecord.ts` — The session ids are used only to locate usage; they are never written to the manifest.
- `src/schemas/adjustPlanSession.ts` — The precedent for a session id kept locally and resumed later: `version: 1`, `sessionId`.
- `src/domain/security/phaseGuard.ts` — Inside a phase worktree, every command not classified `allowed` is refused, including an unclassified one. `artifact approve`, `artifact reopen` and `artifact migrate-approvals` are refused.
- `src/cli/program.ts` — The phase guard prints its refusal and exits 1 before the action runs.
- `phax.usage.kdl` — `artifact reopen` covers a Stale plan only. `artifact new plan --spec` requires exactly one of `--last` and `--not-last`. `artifact migrate-approvals` splits the old ledgers.
- `src/domain/skills/catalog.ts` — EXPOSED_SKILLS lists only phax-planning, phax-cli and phax-spec.
- `.claude/skills/phax-decide-spec/SKILL.md` — The landed doctrine: E0, C1–C5 and S1–S10 as list items that open with a backticked id; interactive, headless and headless-total (later) modes; propose and escalate; and the `{ decisions: [...] }` output. It carries no framing questions.
- `package.json` — `files` already ships .claude/skills/phax-decide-spec, phax-decide-plan and phax-decide-review.
- `NEXT_STEPS.md` — artifact-decide is next, and its first consumer is the steme roadmap-1.0 conductor. The `decision` class was dropped and runs stay autonomous (2026-10-10). Before 1.0, a provider answer in an older shape is refused by name (2026-10-08). headless-review reopens after this spec. oracle-phases needs re-authoring.

## 2. Problem

The open questions are data, but nothing answers them. A loop that wants them decided runs its own arbitration session outside phax: unrecorded, under a private brief, returning prose. The loop then splices that prose into the Markdown by hand, which diverges the sidecar and blocks `approve`.

The answers land nowhere structured. A decision survives only as a prose marker, applied inconsistently across specs, and nothing reads it. Neither `artifact status` nor a later reader can tell which questions are open or decided, on what principle, or what was given up, and approval does not check. A reconsideration such as `rouvre Q3` has no command: `artifact reopen` takes only a Stale plan.

The doctrines exist, but phax neither installs nor loads them, so no citation of `S1` or `P3` can be checked. Finally, an approval issued by a loop is recorded exactly like a human's. An approval record cannot say that no human looked, and an unattended pipeline must never hide that.

## 3. Product goal

phax arbitrates an artifact's open questions with the operator, interactively, as an artifact gesture before any run. A spec or plan carries two sections: open questions and arbitrated questions.

`phax artifact decide` opens a session under the doctrine. The agent first raises the framing questions `F1`–`F5`, then presents the open questions, and the operator decides. The session returns the revised document: each decided question moves to the arbitrated section with its verdict, and the body is revised wherever a verdict departs from the recommendation. phax checks the document deterministically, shows the body diff, and writes only what the operator accepts.

decide runs on Draft only, from a terminal, and never inside a phase worktree. `phax artifact reopen` brings an Approved artifact back to Draft, and `--question` re-arbitrates one question. Approval refuses while the open-questions section is not empty, for headless-authored and hand-authored artifacts alike. Every verdict and every approval names its arbiter.

Each of the four formats this changes gets a new shape. An approval record in an older shape is read through its frozen shape and lifted. Live spec and plan documents are lifted once by `phax artifact migrate-documents`, which re-renders them in the new layout. Until it has run, approve, reopen and decide refuse. No lift presents an old approval or an old decision as an operator's. A headless mode is not specified; it will be built from the decision records these sessions leave.

> The operator decides. A question is open or arbitrated, never in between, and an arbitration that departs from the recommendation revises the body in the same gesture.

## 4. Terminology

- **Open question** — A question in `openQuestions`, in the decision-request shape { id, question, options[{ id, label, abandons }], recommendation, rationale }.
- **Arbitrated question** — A question moved to `arbitratedQuestions` with its verdict, keeping every field it had. The earlier verdicts of a re-arbitrated question stay in its `history`.
- **Verdict** — The answer to one question, in one of two variants. `decided` is the operator's: `chosen` (an option id), `abandoned` (exactly the options not chosen), `why`, `advocate` (the strongest case for an abandoned option), `principles` (cited ids), `reversibility`, `by` (the operator), `at`, and `revised` (the body sections the verdict changed, empty when it changed none). `lifted` is read from a marked question (see Lifted verdict). A plan's decided verdict also carries `phase`.
- **Marked question** — A question decided before this spec, by convention: its `rationale` opens with `Decided by the author on <YYYY-MM-DD>`. Some marked questions also end their `question` with ` (Decided by the author on <date>; not reopened.)`, but phax does not read that suffix. Where the author decided against the recommendation, `recommendation` was rewritten to the option chosen, so it names the choice.
- **Lift** — Reading a file stamped below its format's current shape through the frozen decoder of that shape, then stepping it to the current shape in memory. A lifted approval record stays unchanged on disk until phax next writes it for its own reasons. A lifted spec or plan document is written at its current shape by `phax artifact migrate-documents`.
- **Lifted verdict** — The verdict a lift gives a marked question. It holds only: `chosen`, the question's recommendation; `abandoned`, its other options; `why`, its rationale; `at`, the marker's date; and `by: { kind: unattributed }`.
- **Document migration** — `phax artifact migrate-documents`, the one-time command beside `migrate-approvals`. It lifts every live spec and plan sidecar stamped below its document format's current shape, writes the sidecar at that shape and re-renders its body in the new layout, all in one commit.
- **Own-shape rendering** — The body an older sidecar renders to in the layout of the shape it is stamped with. Migration compares a body with it to prove that no hand edit would be overwritten.
- **Framing questions** — `F1`: who consumes this, and what exactly does it read? `F2`: what persists, and how is it read in a year? `F3`: how is a thing identified without its location? `F4`: what can be removed? `F5`: does the cited doctrine still say what the operator intends? phax puts them in the decide prompt, because the doctrine skills do not carry them. The decisive changes of the first real arbitrations (2026-09-28/29) came from these questions, never from the menus.
- **Revised document** — What an interactive session returns: the artifact's document in its sidecar form, with the decided questions moved to `arbitratedQuestions` and the body revised as their verdicts imply.
- **Interactive mode** — `phax artifact decide`, run from a terminal: the framing questions, then the open questions. The operator decides; the agent facilitates and returns the revised document. It is the only mode.
- **Headless mode** — Not specified. It will be built from the decision records that interactive sessions leave: verdicts, departures from the recommendation, and framing corrections.
- **Arbiter** — Who produced a verdict (the operator, or unattributed when lifted), an approval, or an artifact reopen (a machine or the operator).
- **Reversibility** — The cost of undoing a verdict, on the scale cheap | costly | irreversible. It is a cost, not a state: at equal value, the cheaper option is preferred.
- **Doctrine** — The instructions a decide session follows: the doctrine skill for the artifact kind, plus the optional --doctrine file appended after it.
- **Principle id** — A backticked id that opens a list item in a loaded doctrine, e.g. `S1`, `C4`, `P3`, or a project's `X1`. Verdicts cite principle ids, and phax checks each citation.
- **Grant** — The label a caller declares with `--by machine:<grant>` to name the machine performing an approval or an artifact reopen, e.g. roadmap-loop.
- **Machine / operator / unattributed approval** — A machine approval is recorded with a grant. An operator approval is recorded with the committing git identity. An unattributed approval has no recorded approver; every record written before this change is lifted to it.
- **Decision record** — The record phax writes on phax/records/v1 for one decide session.
- **Artifact reopen** — `phax artifact reopen <path>`: today, it moves a Stale plan back to Draft. This spec extends it to move an Approved spec or plan back to Draft. It is the only way to arbitrate an approved artifact again.
- **Operator gesture** — An approval or an artifact reopen given with `--by operator`, or without `--by` from a terminal. The operator is named by the committing git identity.
- **§9 format** — The layout the renderer gives both sections. A hand-authored artifact follows it so that phax can read it. A spec has a `## 9. Open questions` section and a `## 9b. Arbitrated questions` section. Each question is a `### <id> — <question>` heading, followed by one bullet per option, `- <option id> — <label> — abandons: <loss>`, and a `Recommendation: <option id> — <rationale>` line. In the arbitrated section, the `Decision:` block follows. A plan puts both sections in its preamble, as `## Open questions` and `## Arbitrated questions`.

## 5. Functional requirements

### 5.1 An interactive session

WHEN `phax artifact decide` runs THE system SHALL open an interactive session in which the agent first raises the framing questions `F1`–`F5` and then presents the open questions; the operator decides, and the agent returns the revised document. The session SHALL resume the artifact's authoring session when its id is kept, start a new one otherwise, and print which it did.

### 5.2 Authoring session id kept locally

WHEN a headless authoring session is spawned THE system SHALL keep its provider session id in local state outside the records branch, and, when the session is retried, the id of the retried session.

### 5.3 Model and effort

The system SHALL resolve the decide session's model and effort from `--model` and `--effort` when they are given, and from the built-in catalog default otherwise.

### 5.4 Questions come from the sidecar

WHEN `decide` reads an artifact that has an in-sync sidecar at its format's current shape THE system SHALL take the questions from the sidecar's `openQuestions` and `arbitratedQuestions`.

### 5.5 Questions from a hand-authored §9

WHEN `decide` reads an artifact that has no sidecar THE system SHALL take its open and arbitrated questions from its two sections in the §9 format, and SHALL refuse before any session, naming the first line that departs from the format, if they do not parse.

### 5.6 Hand-authored decisions written in place

WHEN verdicts land on a hand-authored artifact THE system SHALL move each decided question's block from the open-questions section to the arbitrated-questions section with its `Decision:` block, apply the body edits the operator accepted, and append the entries to the decision log, changing no other line.

### 5.7 Artifact preconditions

IF the artifact is not Draft, its sidecar is diverged or invalid, or the artifact or its sidecar has uncommitted changes THEN the system SHALL refuse `decide` with exit 12 before any session; for an Approved or Stale artifact, the refusal SHALL name `phax artifact reopen <path>`.

### 5.8 Interactive only

IF `phax artifact decide` runs without a terminal THEN the system SHALL refuse with exit 12 before any session, stating that decide is interactive only.

### 5.9 Never inside a run

IF `phax artifact decide` runs inside a phase worktree THEN the system SHALL refuse it with the phase guard's refusal and exit 1 before any session.

### 5.10 Presentation order

WHEN `decide` starts THE system SHALL present, in order: the framing questions `F1`–`F5`; then the question named by `--question`, with its verdict when it is arbitrated; then the open questions.

### 5.11 Nothing to decide

IF the open-questions section is empty and `--question` is not given THEN the system SHALL spawn no session, write nothing, and exit 0, stating that there is nothing to decide.

### 5.12 Doctrine skill by artifact kind

The system SHALL load the doctrine skill `phax-decide-spec` into a decide session on a spec, and `phax-decide-plan` into a decide session on a plan.

### 5.13 Project skill replaces the default

WHERE a skill of the same name is installed at project scope for the session's provider THE system SHALL load it in place of the bundled doctrine skill.

### 5.14 Doctrine file appended

WHERE `--doctrine <file>` is given THE system SHALL append the file's content after the doctrine skill in the session prompt.

### 5.15 Principle ids collected

The system SHALL take as the citable principle ids the backticked ids that open list items in the loaded doctrine skill and in the `--doctrine` file.

### 5.16 Doctrine file refused

IF the `--doctrine` file cannot be read, defines no principle id, or defines a principle id that the loaded skill also defines THEN the system SHALL refuse with exit 12 before spawning.

### 5.17 Only a revised document lands

WHEN a decide session ends THE system SHALL land only a revised document that validates against the artifact kind's document schema at its current shape.

### 5.18 The answer names its shape

IF the revised document carries no `$schema`, or a `$schema` that names another format or a shape other than the artifact kind's current one THEN the system SHALL refuse it with exit 5, naming the `$schema` URL it reads, and SHALL never lift it.

### 5.19 Invalid decisions land nothing

IF the session returns no document, returns something that is not JSON or fails the schema, or returns a document with any of the violations below THEN the system SHALL fail with exit 5, naming the first violation by path, and SHALL leave the working tree and HEAD unchanged. The violations: it moves a question that was not presented; it changes an open question it did not decide, or an arbitrated question other than the one being re-arbitrated; it chooses an option the question does not list; it lists as abandoned anything other than exactly the unchosen options; it cites a principle id that no loaded doctrine defines; it breaks traceability (an acceptance criterion without its requirement, or a requirement left uncovered); or, on a plan, it names a phase the plan does not have.

### 5.20 A decided question moves with its verdict

WHEN the operator decides a question THE system SHALL move it from `openQuestions` to `arbitratedQuestions` with a `decided` verdict, keeping every field it had.

### 5.21 A verdict revises the body it implies

WHEN a verdict departs from its question's recommendation THE revised document SHALL carry the body changes the verdict implies (requirements, surface, acceptance criteria, planning note), and the verdict SHALL name the sections it revised in `revised`.

### 5.22 The operator accepts the body diff

WHEN an interactive session returns its revised document THE system SHALL show the operator the diff of the rendered body before writing anything, and SHALL write nothing unless the operator accepts it.

### 5.23 Rate and usage limits

IF a decide session ends on a provider rate or usage limit THEN the system SHALL fail in the existing rate-limit exit family with nothing written.

### 5.24 Artifact changed during the session

IF the artifact or its sidecar changed while the decide session ran THEN the system SHALL refuse with exit 12 to write the decisions back, leaving those changes in place and committing nothing.

### 5.25 Decision attribution

The system SHALL attribute each `decided` verdict to the operator, named by the committing git identity, and SHALL record the loaded doctrine sources and the session's provider, model and effort.

### 5.26 Artifact re-rendered

WHEN a decide document lands THE system SHALL write the sidecar at its format's current shape and re-render the artifact with its deterministic renderer: the open questions, then the arbitrated questions with their verdicts (decided or lifted), then a decision log listing every verdict in order.

### 5.27 Questions are named by id

The system SHALL head every rendered question with its id, open every option bullet and the `Recommendation:` line with an option id, and name questions by id in `--question`, `artifact status`, refusals and the decision log.

### 5.28 One commit

WHEN `decide` writes an artifact THE system SHALL commit exactly the paths it wrote in one commit: the artifact and its sidecar, or the hand-authored artifact alone.

### 5.29 Commit failure

IF the commit made by `decide` or by `migrate-documents` fails THEN the system SHALL report an artifact error with exit 12 and leave the files written but uncommitted.

### 5.30 Decision record

WHEN a decide session ends after spawning and records are enabled THE system SHALL write a decision record whose manifest is stamped with its format's shape. The record SHALL carry: the prompt; the doctrine sources with their fingerprints; the questions presented; the landed document and the body diff the operator accepted; the count of questions arbitrated and the count of verdicts that departed from the recommendation; the transcript (per the records transcript setting); provider, model, effort and usage; the outcome, committed or failed; and the commit when there is one.

### 5.31 Re-rendered plan never re-extracted

WHEN `decide` or `migrate-documents` re-renders or rewrites a plan THE system SHALL re-seed the extraction cache with the plan's projection, so that `phax run` never extracts it through a model.

### 5.32 A re-rendered plan keeps its lineage

WHEN `decide` or `migrate-documents` re-renders a plan THE system SHALL keep its `sourceSpec` and `completesSpec`, and its frontmatter `source-spec` and `completes-spec`, exactly as they were.

### 5.33 Re-arbitrating one question

WHERE `--question <id>` names an arbitrated question THE system SHALL present it with its verdict and, on a new verdict, keep the previous one in its history; WHERE it names an open question THE session SHALL take that question alone.

### 5.34 Unknown question refused

IF `--question` names a question the artifact does not have THEN the system SHALL refuse with exit 12 before any session, naming the artifact's question ids, and write nothing.

### 5.35 Artifact reopen from Approved

WHEN `phax artifact reopen` is given an Approved spec or plan THE system SHALL move it to Draft, clear its `approved` stamp, delete its approval record file, and commit the write-set in one commit whose trailer names the gesture's arbiter. Stale → Draft for plans is unchanged, apart from naming the arbiter.

### 5.36 Artifact reopen refusals

IF `phax artifact reopen` is given a Draft, Completed or Abandoned artifact THEN the system SHALL refuse with exit 12 and write nothing.

### 5.37 Reopening a spec leaves its plans

WHEN `phax artifact reopen` moves an Approved spec to Draft THE system SHALL leave every live plan bound to it unchanged and name each one in its output.

### 5.38 Approval requires no open question

IF the open-questions section of a spec or plan is not empty, in its sidecar or, when hand-authored, in the §9 format THEN `phax artifact approve` SHALL refuse with exit 12, naming the open questions and `phax artifact decide <path>`.

### 5.39 A hand-authored §9 must parse

IF a hand-authored artifact has question sections that do not parse in the §9 format THEN `phax artifact approve` SHALL refuse with exit 12, naming the first line that departs. An artifact with neither section is approved with no question check.

### 5.40 Machine gestures

WHERE `--by machine:<grant>` is given to `phax artifact approve` or `phax artifact reopen` THE system SHALL record that gesture as performed by a machine, naming the grant.

### 5.41 Operator gestures

WHEN `--by operator` is given, or no `--by` is given and the command runs from a terminal, THE system SHALL record the approval or reopen as performed by the operator, named by the committing git identity.

### 5.42 No terminal, no default

IF `phax artifact approve` or `phax artifact reopen` runs without `--by` and not from a terminal THEN the system SHALL refuse with exit 12, naming `--by operator` and `--by machine:<grant>`.

### 5.43 New approvals name their approver

WHEN `phax artifact approve` writes an approval record file THE system SHALL write it at its format's new shape, with an `approvedBy` that names the machine's grant or the operator.

### 5.44 Older approval records are lifted, never refused

WHEN phax reads an approval record file stamped 0.19.0, or splits an old approvals ledger, THE system SHALL lift each record through its frozen shape to `approvedBy: { kind: unattributed }`, and SHALL leave a record file that it only reads unchanged on disk.

### 5.45 Unattributed approvals stay unattributed

WHEN phax reads an approval recorded or lifted as unattributed THE system SHALL present it as unattributed, never as an operator approval.

### 5.46 Older spec documents are lifted by the rationale marker

WHEN phax lifts a spec document stamped below its format's current shape THE system SHALL move to `arbitratedQuestions`, with a lifted verdict and an empty history, each question whose `rationale` opens with `Decided by the author on <YYYY-MM-DD>`, and SHALL leave every other question open, whatever its `question` text says.

### 5.47 A lifted verdict invents nothing

WHEN phax lifts a marked question THE system SHALL give it a `lifted` verdict that holds only its recommendation as `chosen`, its other options as `abandoned`, its rationale as `why`, the marker's date as `at`, and `by: { kind: unattributed }`; it SHALL present the verdict as lifted and unattributed, never as an operator's.

### 5.48 Older plan documents are lifted

WHEN phax reads a plan document stamped 0.20.0 THE system SHALL lift it with empty `openQuestions` and `arbitratedQuestions` in its preamble; a plan document stamped 0.17.0–0.19.x stays refused, as it is today.

### 5.49 Document migration

WHEN `phax artifact migrate-documents` runs THE system SHALL lift every live spec and plan sidecar stamped below its document format's current shape, write it at that shape, and re-render its body in the new layout, keeping its frontmatter as it was.

### 5.50 Migration never overwrites a hand edit

IF a live sidecar to migrate is invalid, its body is not the sidecar's own-shape rendering, or a path the command would write has uncommitted changes THEN `phax artifact migrate-documents` SHALL refuse with exit 12 before writing anything, naming each such artifact and its remedy.

### 5.51 Migration names what it unsettles

WHEN `phax artifact migrate-documents` migrates THE system SHALL report each migrated artifact with its status and question counts. It SHALL also name each Approved artifact that now reads edited since approval, with its open questions when it has any, and each live plan that the migration leaves stale with `spec-changed` evidence.

### 5.52 Migration in one commit

WHEN `phax artifact migrate-documents` writes THE system SHALL commit exactly the paths it rewrote in one commit.

### 5.53 Nothing to migrate

IF no live spec or plan sidecar is stamped below its document format's current shape THEN `phax artifact migrate-documents` SHALL write nothing, make no commit, and exit 0, stating that there is nothing to migrate.

### 5.54 Approval waits for migration

IF any live spec or plan sidecar is stamped below its document format's current shape THEN `phax artifact approve`, `phax artifact reopen` and `phax artifact decide` SHALL refuse with exit 12 before writing anything, naming the sidecar and `phax artifact migrate-documents`.

### 5.55 Status names an unmigrated sidecar

WHEN `phax artifact status` inspects an artifact whose sidecar is stamped below its document format's current shape THE system SHALL report the sidecar's stamped shape and `phax artifact migrate-documents` in place of an agreement value, and report its questions as lifted.

### 5.56 Status reports questions

WHEN `phax artifact status` inspects an artifact that has question sections THE system SHALL report the number of open and arbitrated questions, how many of the arbitrated ones are lifted, the ids of the open ones, and the decide command that answers them.

### 5.57 Status names the approver

WHEN `phax artifact status` reports an approval of a spec or a plan THE system SHALL name the approver's kind and identity: machine and grant, operator and name, or unattributed.

### 5.58 Doctrine skills ship and install

The system SHALL list `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review` in its bundled skill catalog, so that `phax skills install` installs them exactly as it installs `phax-spec`.

### 5.59 Plan open questions

WHERE the artifact is a plan THE system SHALL read its questions from the plan document's `openQuestions` and `arbitratedQuestions` in the preamble, in the same shapes as a spec's.

### 5.60 Authoring emits open questions only

IF the document returned by an authoring session carries an arbitrated question THEN the system SHALL reject it as an invalid document.

## 6. Surface

### cli: phax artifact decide — normative

    phax artifact decide <artifact> [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>]

    $ phax artifact decide docs/specs/2609251400-plan-prune.md
    decide spec plan-prune — framing F1–F5, then Q1, Q2, Q3 — interactive, resumed authoring session
    Q1         arbitrated  manual       (recommended)
    Q2         arbitrated  keep-20      — departs: revises §5.4, §6 prune output, AC "keep bound"
    Q3         open        (not decided this session)
    body diff  3 sections — accept? [y/N] y
    commit     b2c3d4e — docs(specs): decide plan-prune Q1, Q2
    $? = 0

    ✗ decide refused: docs/specs/2609251400-plan-prune.md is Approved — reopen it first with `phax artifact reopen docs/specs/2609251400-plan-prune.md`
    $? = 12

    ✗ decide refused: docs/specs/2609281200-log-rotation.json is stamped spec-document 0.17.0 — run `phax artifact migrate-documents` first
    $? = 12

    ✗ decide refused: no terminal — phax artifact decide is interactive only
    $? = 12

    ✗ phax artifact decide is not available inside a phase worktree; run it from the main checkout (inside, only phax brief and read-only commands run)
    $? = 1

    Exit: 0  decided and committed, declined diff, or nothing to decide
          1  inside a phase worktree (the phase guard)
          5  no document, not JSON, an answer not stamped with the current document shape, or rejected by the schema or its checks
          8  provider rate or usage limit
          12 artifact refusal: not Draft, no terminal, a live sidecar not yet migrated, diverged/invalid sidecar, a hand-authored §9 that
             does not parse, uncommitted changes, bad doctrine file, unknown --question, artifact changed during the session, commit failed

    # normative: command and flag names, the exit families, the diff accepted before writing; output layout and wording indicative
    # no --headless: a headless mode is built later from the decision records

### cli: phax artifact migrate-documents — normative

before:

    phax artifact migrate-approvals        # splits the old approval ledgers; the only migrate command today

after:

    phax artifact migrate-documents

    $ phax artifact migrate-documents
    spec-document 0.17.0 → 0.24.0
      docs/specs/2609281200-log-rotation.md      Draft      open 1 (Q2) · arbitrated 3 (3 lifted)
      docs/specs/2609251400-plan-prune.md        Approved   open 0 · arbitrated 2 (2 lifted)
        now edited since approval — re-approve with `phax artifact approve docs/specs/2609251400-plan-prune.md`
      docs/specs/2609271000-cache-keys.md        Approved   open 1 (Q3) · arbitrated 1 (1 lifted)
        now edited since approval, with open questions — reopen it and decide Q3 before re-approving
    plan-document 0.20.0 → 0.24.0
      docs/plans/2609261000-plan-prune-store-plan.md   Approved   body unchanged
    stale (spec-changed)
      docs/plans/2609261000-plan-prune-store-plan.md   its spec docs/specs/2609251400-plan-prune.md was re-rendered
    committed e5f6a7b chore(artifacts): migrate documents to their current shapes
    $? = 0

    $ phax artifact migrate-documents
    nothing to migrate: every live spec and plan sidecar is at its current shape
    $? = 0

    ✗ migrate refused: docs/specs/2609281200-log-rotation.md is not its sidecar's spec-document 0.17.0 rendering — a hand edit would be overwritten
      Re-author it headless (remove the artifact and its sidecar, then run `phax artifact new spec log-rotation --headless --brief <file|->`),
      or delete docs/specs/2609281200-log-rotation.json to demote the artifact to hand-authored; then rerun
    $? = 12

    Exit: 0  migrated and committed, or nothing to migrate
          1  inside a phase worktree (the phase guard)
          12 an invalid sidecar, a body that is not its sidecar's own-shape rendering, uncommitted changes on a path it would write,
             commit failed

    # normative: the command name; its scope (live spec and plan sidecars stamped below their current shape, never archived ones,
    # never approval records); a refusal writes nothing; every Approved artifact left edited since approval and every plan left stale
    # is named; exactly the rewritten paths in one commit. Layout, wording and commit subject indicative.
    # Until it has run, approve, reopen and decide refuse, naming it, as the approval commands refuse while an old ledger exists.

### file: revised document (the session's final message) — normative

    { "$schema": "https://docs.phax.run/schemas/spec-document/0.24.0.json",
      "kind": "spec", "title": "…", …,
      "openQuestions": [ …the questions not decided… ],
      "arbitratedQuestions": [ …,
        { …the question as it was…,
          "verdict": { "kind": "decided", "chosen": "keep-20", "abandoned": ["keep-10"], "why": "…", "advocate": "…",
                       "principles": ["S2"], "reversibility": "cheap", "by": { "kind": "operator", "name": "Ada Lovelace" },
                       "at": "2026-10-20T08:02:11Z", "revised": ["§5.4", "§6 phax prune output", "AC keep bound"] },
          "history": [] } ],
      … }

    # the artifact's whole document in its sidecar form, `$schema` first at the format's current shape
    # (0.24.0 stands for the release that ships this spec); every key required, unknown keys rejected;
    # chosen: a listed option id; plan verdicts add "phase"
    # an answer without $schema, or naming another format or shape, is refused by name (exit 5), never lifted (§9 Q19)

### file: docs/specs/<stamp>-<slug>.json open and arbitrated questions — normative

before:

    "$schema": "https://docs.phax.run/schemas/spec-document/0.17.0.json",
    …
    "openQuestions": [
      { "id": "Q1", "question": "Is pruning manual? (Decided by the author on 2026-09-28; not reopened.)", "options": [ … ],
        "recommendation": "manual", "rationale": "Decided by the author on 2026-09-28, …" },
      { "id": "Q2", "question": "…", "options": [ … ], "recommendation": "keep-10", "rationale": "…" },
      { "id": "Q3", "question": "Where do pruned runs go?", "options": [ … ],
        "recommendation": "trash", "rationale": "Decided by the author on 2026-09-30, against the previous recommendation (`delete`). …" } ]

after:

    "$schema": "https://docs.phax.run/schemas/spec-document/0.24.0.json",
    …
    "openQuestions": [
      { "id": "Q4", "question": "…", "options": [ … ], "recommendation": "…", "rationale": "…" } ],
    "arbitratedQuestions": [
      { "id": "Q1", "question": "Is pruning manual? (Decided by the author on 2026-09-28; not reopened.)", "options": [ … ],
        "recommendation": "manual", "rationale": "Decided by the author on 2026-09-28, …",
        "verdict": { "kind": "lifted", "chosen": "manual", "abandoned": ["auto"], "why": "Decided by the author on 2026-09-28, …",
                     "at": "2026-09-28", "by": { "kind": "unattributed" } },
        "history": [] },
      { "id": "Q2", "question": "…", "options": [ … ], "recommendation": "keep-10", "rationale": "…",
        "verdict": { "kind": "decided", "chosen": "keep-20", "abandoned": ["keep-10"], "why": "…", "advocate": "…", "principles": ["S2"],
                     "reversibility": "cheap", "by": { "kind": "operator", "name": "Ada Lovelace" }, "at": "2026-10-20T08:02:11Z",
                     "revised": ["§5.4", "§6 phax prune output", "AC keep bound"] },
        "history": [] },
      { "id": "Q3", "question": "Where do pruned runs go?", "options": [ … ], "recommendation": "trash", "rationale": "Decided by the author on 2026-09-30, …",
        "verdict": { "kind": "lifted", "chosen": "trash", "abandoned": ["delete"], "why": "Decided by the author on 2026-09-30, …",
                     "at": "2026-09-30", "by": { "kind": "unattributed" } },
        "history": [] } ]

    # normative: the two arrays, both required (empty when nothing); a question in exactly one of them; ids unique across both;
    # verdict kinds decided | lifted (a lifted verdict holds exactly the keys shown, §9 Q15); history holds earlier verdicts of a
    # re-arbitrated question. A question lifts when its rationale opens `Decided by the author on <YYYY-MM-DD>`; the question suffix
    # is not read (Q3 lifts without it). Nested key spellings indicative. The before block is lifted and rewritten at the new shape
    # by `phax artifact migrate-documents` (§9 Q16); Q2's decided verdict is a later decide.

### file: rendered spec — §9 answered and a decision log — normative

before:

    ## 9. Open questions for implementation planning

    ### Q1 — Is pruning manual? (Decided by the author on 2026-09-28; not reopened.)

    - Manual pruning only — abandons: …
    - A prune policy key — abandons: …

    Recommendation: Manual pruning only — Decided by the author on 2026-09-28, …

    ### Q2 — …

after:

    ## 9. Open questions

    ### Q4 — …

    - a — … — abandons: …
    - b — … — abandons: …

    Recommendation: a — …

    ## 9b. Arbitrated questions

    ### Q1 — Is pruning manual? (Decided by the author on 2026-09-28; not reopened.)

    - manual — Manual pruning only — abandons: …
    - auto — A prune policy key — abandons: …

    Recommendation: manual — Decided by the author on 2026-09-28, …

    Decision: manual — lifted, unattributed, 2026-09-28

    ### Q2 — …

    - keep-10 — … — abandons: …
    - keep-20 — … — abandons: …

    Recommendation: keep-10 — …

    Decision: keep-20 — by operator (Ada Lovelace), 2026-10-20
    Why: … Principles: S2. Reversibility: cheap. Revised: §5.4, §6 phax prune output, AC keep bound.

    ## 12. Decision log

    - 2026-09-28 Q1 lifted manual — unattributed
    - 2026-10-20 Q2 decided keep-20 — operator (Ada Lovelace) — revised 3 sections

    # normative: two sections, open then arbitrated; headings and bullets name ids (§9 Q17); under an arbitrated question its Decision block;
    # a final Decision log when any question is arbitrated. `phax artifact migrate-documents` re-renders every live headless spec from the
    # before layout to the after layout once (§9 Q16); agreement afterwards compares with the after layout only. Wording indicative.

### file: hand-authored §9 in the §9 format — normative

before:

    ## 9. Open questions for implementation planning

    **Q2 — Logs: kept per run, or rotated daily?**

    - Kept per run — abandons: a bounded log directory …
    - Rotated daily — abandons: one log per run to attach to a report …

    Recommendation: keep logs per run …

after:

    ## 9. Open questions

    ### Q3 — …

    - a — … — abandons: …
    - b — … — abandons: …

    Recommendation: a — …

    ## 9b. Arbitrated questions

    ### Q2 — Logs: kept per run, or rotated daily?

    - per-run — kept per run — abandons: a bounded log directory …
    - daily — rotated daily — abandons: one log per run to attach to a report …

    Recommendation: per-run — keep logs per run …

    Decision: per-run — by operator (Grace Hopper), 2026-10-20      ← written by decide, or by hand
    Why: … Principles: … Reversibility: cheap. Revised: none.

    ## 12. Decision log

    - 2026-10-20 Q2 decided per-run — operator (Grace Hopper)

    # normative: the two section headings and the question, option-bullet, Recommendation and Decision line shapes; a hand-authored
    # artifact is converted to them once by hand (migrate-documents touches sidecars only). Approve requires the open section to be empty.
    # Wording indicative.

### file: docs/plans/<stamp>-<slug>-plan.json open and arbitrated questions — indicative

before:

    "$schema": "https://docs.phax.run/schemas/plan-document/0.20.0.json",
    "kind": "plan",
    "sourceSpec": "docs/specs/2609251400-plan-prune.md",
    "completesSpec": true,
    …
    "preamble": {
      "summary": "…",
      "requiredCommandsNote": "…",
      "technicalArbitrations": ["Keep prune in app/, not a domain service — …"]
    }

after:

    "$schema": "https://docs.phax.run/schemas/plan-document/0.24.0.json",
    "kind": "plan",
    "sourceSpec": "docs/specs/2609251400-plan-prune.md",
    "completesSpec": true,
    …
    "preamble": {
      "summary": "…",
      "requiredCommandsNote": "…",
      "technicalArbitrations": ["Keep prune in app/, not a domain service — …"],
      "openQuestions": [
        { "id": "Q1", "question": "Does phase-02 or phase-03 own the registry write?",
          "options": [ { "id": "p2", "label": "phase-02 writes it", "abandons": "…" },
                       { "id": "p3", "label": "phase-03 writes it", "abandons": "…" } ],
          "recommendation": "p2", "rationale": "…" } ],
      "arbitratedQuestions": []
    }

    # per §9 Q2: rendered in the preamble before the first phase as "## Open questions", "## Arbitrated questions" and "## Decision log",
    # each only when non-empty, so a 0.20.0 plan that migrate-documents restamps keeps its body byte for byte; settled arbitrations stay
    # prose in technicalArbitrations; sourceSpec, completesSpec and the frontmatter source-spec and completes-spec are kept as they are;
    # the rendered plan passes `phax plans lint` and projects to the same extracted plan

### cli: phax artifact status — normative

before:

    Path:              docs/specs/2609251400-plan-prune.md
    Kind:              spec
    Status:            Approved
    Authored:          headless — sidecar docs/specs/2609251400-plan-prune.json (in sync)
    Approved:          2026-09-25 @ a1b2c3d
    Edited since:      no
    Legal transitions: Approved, Abandoned, Completed

after:

    Path:              docs/specs/2609251400-plan-prune.md
    Kind:              spec
    Status:            Draft
    Authored:          headless — sidecar docs/specs/2609251400-plan-prune.json (in sync)
    Questions:         4 — open 2 (Q3, Q4) · arbitrated 2 (1 lifted)
      decide with `phax artifact decide docs/specs/2609251400-plan-prune.md`
    Legal transitions: Approved (once no question is open), Abandoned

    Authored:          headless — sidecar docs/specs/2609281200-log-rotation.json (spec-document 0.17.0 — migrate with `phax artifact migrate-documents`)
    Questions:         4 — open 1 (Q2) · arbitrated 3 (3 lifted)

    # an Approved spec or plan prints `Approved: <date> @ <sha> by machine (roadmap-loop)`, `by operator (Ada Lovelace)` or `unattributed`,
    # and lists Draft among its legal transitions; a hand-authored artifact whose §9 parses prints the same Questions line; plans print the same lines;
    # a sidecar not yet migrated prints its stamped shape and the migrate command instead of an agreement value, its questions as lifted.
    # normative: the open and arbitrated counts, the lifted count, the open ids, the approver kind and identity, the migrate pointer; layout indicative

### cli: phax artifact approve — normative

before:

    phax artifact approve <path>
    Status:   Approved
    Baseline: a1b2c3d
    Commit:   c3d4e5f — …

after:

    phax artifact approve <path> [--by operator | --by machine:<grant>]

    $ phax artifact approve docs/specs/2609251400-plan-prune.md --by machine:roadmap-loop
    Status:   Approved
    Approver: machine (roadmap-loop)
    Baseline: a1b2c3d
    Commit:   c3d4e5f — docs(specs): approve plan-prune
    $? = 0

    $ phax artifact approve docs/specs/2609251400-plan-prune.md           # from a terminal
    Status:   Approved
    Approver: operator (Ada Lovelace)
    …

    ✗ Approval refused: docs/specs/2609251400-plan-prune.md has open questions — Q3, Q4
      answer them with `phax artifact decide docs/specs/2609251400-plan-prune.md`
    $? = 12

    ✗ Approval refused: no terminal and no --by — pass `--by operator` or `--by machine:<grant>`
    $? = 12

    ✗ Approval refused: docs/specs/2609281200-log-rotation.json is stamped spec-document 0.17.0 — run `phax artifact migrate-documents` first
    $? = 12

    # normative: the --by values, the terminal default, the refusals with exit 12; wording indicative

### cli: phax artifact reopen — normative

before:

    phax artifact reopen <plan>        # Stale plan → Draft only

after:

    phax artifact reopen <path> [--by operator | --by machine:<grant>]   # Approved spec or plan → Draft; Stale plan → Draft

    $ phax artifact reopen docs/specs/2609251400-plan-prune.md --by machine:roadmap-loop
    Status:   Draft (was Approved; docs/specs/approvals/2609251400-plan-prune.json deleted)
    Bound:    docs/plans/2609261000-plan-prune-store-plan.md (Approved) — left as is
    Commit:   d4e5f6a — chore(specs): reopen plan-prune   [Reopened-By: machine (roadmap-loop)]
    $? = 0

    ✗ reopen refused: docs/specs/2609251400-plan-prune.md is Draft
    $? = 12

    # normative: the transitions, the deleted approval record file, the bound plans named, the arbiter in the commit, the refusal
    # while a live sidecar is not yet migrated (as approve); trailer spelling and layout indicative

### file: docs/specs/approvals/<spec>.json and docs/plans/approvals/<plan>.json — normative

before:

    {
      "$schema": "https://docs.phax.run/schemas/spec-approval-record/0.19.0.json",
      "artifact": "docs/specs/2609251400-plan-prune.md",
      "specFingerprint": "b19da59f…",
      "approvedAt": "2026-09-25T09:28:11.427Z",
      "baseline": "67e20c37…"
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/spec-approval-record/0.24.0.json",
      "artifact": "docs/specs/2609251400-plan-prune.md",
      "specFingerprint": "b19da59f…",
      "approvedAt": "2026-10-21T09:28:11.427Z",
      "baseline": "67e20c37…",
      "approvedBy": { "kind": "machine", "grant": "roadmap-loop" }
    }

    # or { "kind": "operator", "name": "Ada Lovelace" }; { "kind": "unattributed" } is what a 0.19.0 record and a migrated ledger entry
    # lift to (§9 Q4). The same key joins plan records after sourceSpec. Kinds normative, required on every record at the new shape;
    # key spelling indicative; the form is shared with the headless-review spec. The grant comes from `--by machine:<grant>`.
    # A 0.19.0 file is read and lifted, never rewritten by a read or by migrate-documents; reopen, completion and abandonment delete it as today.

### file: persisted formats this spec changes, and how an older file is read — normative

before:

    spec-document          0.17.0   openQuestions only
    plan-document          0.20.0   preamble without questions
    spec-approval-record   0.19.0   no approver
    plan-approval-record   0.19.0   no approver

after:

    format                    new shape   change                                          an older file
    spec-document             0.24.0      + arbitratedQuestions (verdict, history)        0.17.0 and pre-schema: lifted and rewritten once by
                                                                                          `phax artifact migrate-documents` — a question whose rationale
                                                                                          opens with the marker is arbitrated with a lifted verdict, the
                                                                                          rest stay open (§9 Q15, Q16); approve, reopen and decide refuse
                                                                                          until then
    plan-document             0.24.0      + preamble.openQuestions, arbitratedQuestions   0.20.0: lifted with both empty, on read and by migrate-documents;
                                                                                          0.17.0–0.19.x and a pre-schema plan with a spec: refused as today
    spec-approval-record      0.24.0      + approvedBy                                    0.19.0: lifted on read to { "kind": "unattributed" } (§9 Q4)
    plan-approval-record      0.24.0      + approvedBy                                    0.19.0: lifted on read to { "kind": "unattributed" } (§9 Q4)
    decision-record-manifest  0.24.0      new, born with $schema                          none
    spec-approvals, plan-approvals        unchanged; read only by migrate-approvals, whose entries are written as unattributed

    # 0.24.0 stands for the release that ships this spec. Each changed format is recorded as a next snapshot and released by the cut;
    # its previous shape is frozen and pinned, and phax lifts through it. No field becomes optional.
    # normative: the four formats, their additions and each lift rule; the new format's id indicative

### file: decision record on phax/records/v1 — indicative

    decision/2609251400-plan-prune/01/
      record.json   { "$schema": "https://docs.phax.run/schemas/decision-record-manifest/0.24.0.json",
                      kind: "decision", artifact: "docs/specs/2609251400-plan-prune.md", artifactKind: "spec",
                      mode: "interactive", session: "new" | "resumed-authoring",
                      doctrine: [ { kind: "skill", name: "phax-decide-spec", source: "bundled" | "project", fingerprint: "…" },
                                  { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "…" } ],
                      questions: ["Q1", "Q2", "Q3"], arbitrated: 2, departed: 1, sourceSha: "…", provider, model, effort,
                      outcome: "committed" | "failed", commit: "…" | null, usage: { … } }
      prompt.md  document.json  body.diff  output.jsonl

    # resolved by `phax records explain <sha>` like an authoring record; that the record exists with these facts is normative

### cli: phax skills install — normative

before:

    $ phax skills install --target claude --scope project
    created          .claude/skills/phax-planning/SKILL.md
    created          .claude/skills/phax-cli/SKILL.md
    created          .claude/skills/phax-spec/SKILL.md

after:

    $ phax skills install --target claude --scope project
    created          .claude/skills/phax-planning/SKILL.md
    created          .claude/skills/phax-cli/SKILL.md
    created          .claude/skills/phax-spec/SKILL.md
    created          .claude/skills/phax-decide-spec/SKILL.md
    created          .claude/skills/phax-decide-plan/SKILL.md
    created          .claude/skills/phax-decide-review/SKILL.md

    # skill names normative; each installed SKILL.md is byte-identical to the landed .claude/skills/<name>/SKILL.md;
    # a project copy of the same name replaces the bundled default for decide; install output layout indicative

## 7. Non-goals

- Headless arbitration. It will be built from the decision records that interactive sessions leave (verdicts, departures from the recommendation, framing corrections). There is no machine proposal, no escalation and no machine reversal.
- A decision queue UI or desktop inbox. This spec provides the data and the status line, nothing visual.
- Multi-human arbitration: several operators, votes, required reviewers or per-question owners. The operator is whoever commits.
- Arbitration during a run. decide is an artifact gesture before any run, and it is refused inside a phase worktree. Answering run decision requests (`phase-decision-requests` stays parked), any mid-run stop for a person, and autopilot loops are out of scope.
- Editing a question's wording or its options from within decide. The body is revised only as a verdict implies, and only once the operator accepts the diff.
- Writing the doctrine skills' text. It is the author's, and their headless sections stay unused until a headless mode is specified.
- `headless-review`, which reopens after this spec ships and adopts its approver form, and loading `phax-decide-review` from decide. That skill ships here, and review-plan consumes it.
- `oracle-phases`, which needs re-authoring on its own.
- Changing how headless authoring loads `phax-spec` and `phax-planning`. The project-skill override applies to the decide doctrines only.
- A `phax.json` key for the decide model and effort. One can be added later without breaking anything.
- Parsing a steering file. Mapping `rouvre Q3` to `phax artifact reopen` plus `decide --question Q3` is the caller's job.
- The approver in the frontmatter `approved` stamp. The approval record file is the single source of who approved.
- A migration command for approval records. A 0.19.0 record is lifted on read and rewritten at the new shape only when the next approval writes it (§9 Q4); `migrate-documents` migrates spec and plan documents only.
- Migrating archived (Completed or Abandoned) artifacts, or hand-authored ones. `migrate-documents` touches live sidecars only; a hand-authored §9 is converted to the §9 format once, by hand.
- Re-approving the artifacts that migration leaves edited since approval, or refreshing the plans it leaves stale. The command names them; the operator re-approves them, or reopens and decides them first.
- Blocking `phax artifact complete` and `phax artifact abandon` until migration. They carry an older sidecar as it is, as they carry any sidecar today.
- Reading plan documents stamped 0.17.0–0.19.x, which stay refused as today.
- Extracting open questions from a free-form Markdown layout.
- Changing the authoring answer's `version: 1` form, or promising stability for these formats beyond the provider-answer rule decided on 2026-10-08.

## 8. Acceptance criteria

### An interactive session lands the revised document and names the operator

Given a headless-authored Draft spec with a kept authoring session id and open questions Q1 and Q2, and another spec whose local authoring state is gone, when `phax artifact decide <spec>` runs on each from a terminal; in the first, the operator decides Q1 and accepts the diff; in the second, the operator ends the session without a document, then The first run resumes the kept authoring session and the second starts a new one. Each prints which it did, and the kept id appears nowhere on the records branch. In the first run, the agent raises `F1`–`F5` first. Q1 moves to `arbitratedQuestions` with a `decided` verdict attributed to the operator by the committing git identity, and Q2 stays open. §9 is re-rendered, and the sidecar's `$schema` names `spec-document` at its new shape. The artifact and its sidecar are the only paths in the new HEAD commit. The second run writes nothing. (refs §5.1, §5.2, §5.4, §5.12, §5.17, §5.25, §5.26, §5.28, §5.20)

### Model resolves from flag, then catalog

Given a headless-authored Draft spec, when `phax artifact decide <spec>` runs without `--model`, and again with `--model` and `--effort`, then The first session uses the catalog default and prints it. The second uses the flags. (refs §5.3)

### Hand-authored artifact decided in place

Given a spec with no sidecar whose §9 format holds open questions Q1 and Q2, and another spec whose questions use bold headings, when interactive `phax artifact decide` runs on the first, the operator decides Q1 and accepts the body diff, and `phax artifact approve` then runs on it; afterwards, decide runs on the second, then Q1's block moves to the arbitrated-questions section with its `Decision:` block, the accepted body edits apply, and one decision-log entry is added; the new HEAD commit holds that file alone. Approve exits 12 naming Q2. Decide on the second spec exits 12 naming the first bold heading, and no session is spawned. (refs §5.5, §5.6, §5.28, §5.38)

### Preconditions refuse before the session

Given a spec whose sidecar has diverged, a spec with an uncommitted change, a Completed spec, and an Approved spec, when `phax artifact decide <spec>` runs on each, then Each run exits 12 and no session is spawned. The Approved spec's refusal names `phax artifact reopen`. (refs §5.7)

### Interactive only, never inside a run

Given a Draft spec with open questions, and a phase worktree of a running plan, when `phax artifact decide <spec>` runs with stdin not a terminal, and again from a shell inside the phase worktree, then The first exits 12, stating that decide is interactive only. The second exits 1 with the phase guard's refusal. Neither spawns a session or writes anything. (refs §5.8, §5.9)

### Framing first; re-arbitrating one question

Given a Draft spec where Q1 is arbitrated and Q2 and Q3 are open, when interactive decide runs, then runs again with `--question Q1`, then with `--question Q9`, then The first session raises `F1`–`F5` first, then presents Q2 and Q3. The second presents Q1 alone with its verdict, and a new verdict keeps the previous one in Q1's history. The third exits 12 and writes nothing. (refs §5.10, §5.33, §5.34)

### Nothing to decide

Given a headless-authored Draft spec whose `openQuestions` is empty (every question arbitrated), when `phax artifact decide <spec>` runs, then It exits 0, stating that there is nothing to decide. No session is spawned and no commit is made. (refs §5.11)

### Project skill replaces the default and the doctrine file is appended

Given a project-scoped `.claude/skills/phax-decide-spec/SKILL.md` that differs from the bundled one, and a `docs/doctrine/spec.md` with a list item that opens with `X1`, when `phax artifact decide <spec> --doctrine docs/doctrine/spec.md` runs, then The prompt contains the project skill's text followed by the doctrine file. Verdicts citing `X1` or `C4` are accepted. A verdict citing `S0`, which is named only inside a step and never opens a list item, is rejected. The decision record names the skill source as project, with its fingerprint. (refs §5.13, §5.14, §5.15)

### Bad doctrine file refused

Given a `--doctrine` file that is unreadable, one that defines no principle id, and one with a list item that opens with `S1`, when decide runs with each, then Each run exits 12 and no session is spawned. (refs §5.16)

### Invalid decisions land nothing

Given records enabled, and sessions that return, respectively: prose; a verdict citing `S12`; a revised document that moves a question that was not presented; a `chosen` option the question does not list; an `abandoned` list that is not exactly the unchosen options; and a plan verdict naming a phase the plan lacks, when each session ends, then Each run exits 5 naming the violation path, and the working tree and HEAD are unchanged. A decision record exists with outcome `failed`. (refs §5.19, §5.30)

### The answer is read at the current shape only

Given sessions on a spec that return, respectively, a revised document without `$schema`, one stamped `spec-document/0.17.0`, and one stamped `plan-document` at its current shape, when each session ends, then Each run exits 5 naming the `$schema` URL phax reads. Nothing is written, and no answer is lifted. (refs §5.18)

### Revision rules

Given three revised documents: one that edits open question Q2, which the operator did not decide; one that drops arbitrated question Q3; and one whose acceptance criterion references a requirement it removed, when each is validated, then Each is rejected with exit 5 naming the violating path, and nothing is written. (refs §5.19)

### Rate limit lands nothing

Given a decide session that ends on a provider usage limit, when the session ends, then The run exits 8, and nothing is written or committed. (refs §5.23)

### Concurrent edit refused

Given an interactive decide session during which the artifact file is modified, when the session returns a valid revised document, then The run exits 12, the modification is left in place, and no commit is made. (refs §5.24)

### Commit failure leaves the files

Given a valid revised document whose diff the operator accepts, and a commit that fails; separately, a `migrate-documents` run whose commit fails, when decide writes the artifact and its sidecar, and migrate-documents writes its files, then Each run exits 12, and its files are written but uncommitted. (refs §5.29)

### Record explains the decisions

Given records enabled, and an interactive decide commit at `<sha>` that arbitrated two questions and revised one requirement, when `phax records explain <sha>` runs, then It shows the prompt, the doctrine sources with fingerprints, the questions presented, the landed document, the accepted body diff, `arbitrated: 2`, `departed: 1`, model, effort, usage and outcome `committed`. The manifest carries a `$schema` naming the decision record format. (refs §5.30)

### Status counts questions by state and arbiter

Given an Approved spec where Q1 is arbitrated by a lifted verdict, Q2 by a decided verdict, and Q3 and Q4 are open, approved with `--by machine:roadmap-loop`, when `phax artifact status <spec>` runs, then It prints open 2, naming Q3 and Q4; arbitrated 2, 1 of them lifted; the decide command; and `by machine (roadmap-loop)` on the Approved line. A plan in the same situation prints the same lines. (refs §5.56, §5.57)

### Approval requires no open question

Given a headless-authored Draft spec with open questions; a hand-authored Draft spec whose §9 format has an empty open section, with every question arbitrated; and a hand-authored Draft spec with no question section, when `phax artifact approve` runs on each from a terminal, then The first exits 12 naming its open questions and `phax artifact decide`. The second and third are approved. (refs §5.38, §5.39)

### Approvals name their approver

Given a Draft spec ready for approval, when `phax artifact approve <spec> --by machine:roadmap-loop` runs; separately, the same command runs from a terminal without `--by`; separately, it runs without `--by` from a script with no terminal, then In the first case, the record file `docs/specs/approvals/<spec file name>.json` is stamped at the new `spec-approval-record` shape and carries `approvedBy` `{ kind: machine, grant: roadmap-loop }`. In the second, it carries `{ kind: operator, name: <git user.name> }`. `phax artifact status` prints `by machine (roadmap-loop)` or `by operator (<name>)` accordingly. The third exits 12 naming `--by`, and nothing is written. (refs §5.40, §5.41, §5.42, §5.43, §5.57)

### Records written before attribution read as unattributed

Given a spec approval record file and a plan approval record file, both stamped 0.19.0 with no `approvedBy`, and, in another repository, an old `docs/plans/approvals.json` ledger, when `phax artifact status` runs on the spec, `phax plans status` runs, and `phax artifact migrate-approvals` splits the ledger, then Status prints the spec's approval as unattributed, never as operator. The plan's staleness is computed as before. The migrated record files carry `approvedBy: { kind: unattributed }` at the new shape. The two 0.19.0 files are byte-identical afterwards. (refs §5.44, §5.45)

### Artifact reopen returns an Approved artifact to Draft

Given an Approved spec, a Draft spec, and a Stale plan, when `phax artifact reopen <path> --by machine:roadmap-loop` runs on each, then `decide --question Q1` runs on the reopened spec, then The Approved spec is Draft with its `approved` stamp cleared, its record file `docs/specs/approvals/<spec file name>.json` is deleted, and the transition commit names `machine (roadmap-loop)`. The Draft spec's reopen exits 12 and writes nothing. The Stale plan reopens to Draft as today, its commit naming the arbiter. The decide then runs on the reopened spec. (refs §5.35, §5.36, §5.40, §5.7)

### Reopening a spec names its plans and leaves them

Given an Approved spec with an Approved plan bound to it, when `phax artifact reopen <spec> --by operator` runs, then `phax plans status`, then a decide on the spec whose diff the operator accepts, then `phax plans status` again, then The reopen names the bound plan and leaves its file and record untouched. The first `plans status` reports the plan fresh, because reopen changes nothing the fingerprint covers. The second reports it stale with `spec-changed` evidence. (refs §5.37)

### Doctrine skills ship and install

Given an installed phax package, when `phax skills install --target claude --scope project` runs in an empty project, then `.claude/skills/phax-decide-spec/SKILL.md`, `phax-decide-plan/SKILL.md` and `phax-decide-review/SKILL.md` exist, each byte-identical to the landed copy in the phax repository. (refs §5.58)

### Plan decide keeps the plan executable

Given a headless Draft plan with `completes-spec: false`, whose preamble holds open questions Q1 and Q2, when interactive decide runs and the operator decides Q1 with `phase: phase-02`, then The session loads `phax-decide-plan`, and Q1 is in `arbitratedQuestions` with `phase: phase-02`. The re-rendered plan passes `phax plans lint` with no structure error, and `phax run` finds its projection without spawning an extraction session. The frontmatter `source-spec` and `completes-spec: false` and the sidecar's `sourceSpec` and `completesSpec` are unchanged. `phax artifact approve <plan>` exits 12 naming Q2. (refs §5.59, §5.31, §5.32, §5.12, §5.38)

### Plan documents in flight are lifted and restamped, older ones still refused

Given a Draft plan whose sidecar is stamped `plan-document/0.20.0` and whose body is that sidecar's rendering, and, in another repository, a Draft plan whose sidecar is stamped `plan-document/0.19.0` beside a source spec, when `phax plans status` and `phax artifact status` run on the first, then `phax artifact migrate-documents`; in the other repository, `phax artifact status` and then `phax artifact migrate-documents` run, then Before migration, the first plan reads with no Questions line, and status names `phax artifact migrate-documents`. Migration rewrites its sidecar at the new `plan-document` shape with both question arrays empty, leaves its body byte-identical with its lineage unchanged, and `phax run` then finds its projection without spawning an extraction session. In the other repository, status is refused as today, naming the missing `completesSpec`, and migration exits 12 naming the plan's invalid sidecar, writing nothing. (refs §5.48, §5.49, §5.50, §5.32, §5.31, §5.55)

### Spec documents in flight are lifted by the rationale marker

Given a repository whose only older sidecar belongs to a Draft headless spec stamped `spec-document/0.17.0`, with a body that is that sidecar's rendering. Q1 is marked in both its question and its rationale with 2026-09-28. Q2 is unmarked. Q3 is marked in its question only. Q4 is marked in its rationale only, with 2026-09-30, and its `recommendation` names the option the author chose against the previous recommendation., when `phax artifact status` runs, then `phax artifact approve`, then `phax artifact migrate-documents`, then status and approve again, then `phax artifact decide`, in which the operator decides Q2 and Q3, then The first status names the stamped shape and `phax artifact migrate-documents`, with open 2 (Q2, Q3) and arbitrated 2 (2 lifted). The first approve exits 12 naming the sidecar and `phax artifact migrate-documents`. Migration commits the sidecar at the new shape and the re-rendered body. In the sidecar, Q1 and Q4 sit in `arbitratedQuestions`, each with a `lifted` verdict that holds only its recommendation as `chosen`, its other options as `abandoned`, its rationale as `why`, its marker's date as `at`, and `by: unattributed`; Q2 and Q3 stay open. Status then reads in sync with the same counts. The second approve exits 12 naming Q2 and Q3. Decide presents Q2 and Q3 only, and the re-rendered body prints the Decision lines of Q1 and Q4 as lifted and unattributed. (refs §5.46, §5.47, §5.49, §5.54, §5.55, §5.38)

### Migration refuses rather than overwrite a hand edit

Given a repository with two Draft headless specs stamped `spec-document/0.17.0`: one in sync with its own-shape rendering, and one whose body was edited by hand after authoring, when `phax artifact migrate-documents` runs; then the hand edit is committed elsewhere and the in-sync spec's sidecar is left with an uncommitted change, and it runs again; then the edit is reverted and the change discarded, and it runs again; then it runs once more, then The first run exits 12, naming the edited spec and both remedies, and leaves every file and HEAD unchanged. The second exits 12 naming the uncommitted path and writes nothing. The third migrates both specs in one commit. The fourth exits 0 stating that there is nothing to migrate, with no commit. (refs §5.50, §5.49, §5.52, §5.53)

### Migration names the approvals and plans it unsettles

Given an Approved spec stamped `spec-document/0.17.0` with no open question once lifted, and a 0.19.0 approval record; an Approved plan bound to it, stamped `plan-document/0.20.0`; and a second Approved spec stamped 0.17.0 with an unmarked question Q3, when `phax artifact migrate-documents` runs, then `phax plans status`, then `phax artifact status` on the first spec, then The output names both specs as now edited since approval, names Q3 as open on the second spec, and names the plan as stale with `spec-changed`. The commit holds exactly the two specs, their sidecars and the plan's sidecar. The plan's body and lineage are unchanged, and both approval record files are byte-identical. `plans status` reports the plan stale with `spec-changed` evidence. Status on the first spec reads `Edited since: yes`, with its approval unattributed. (refs §5.51, §5.52, §5.32, §5.44)

### Approve, reopen and decide wait for migration

Given a repository with one live spec sidecar stamped `spec-document/0.17.0`, plus a Draft spec and an Approved spec, both at the current shape, when `phax artifact approve` runs on the Draft spec, `phax artifact reopen --by operator` on the Approved spec, and `phax artifact decide` on the Draft spec from a terminal, then Each exits 12, naming the 0.17.0 sidecar and `phax artifact migrate-documents`. No session is spawned, and nothing is written or committed. (refs §5.54)

### Questions are named by their ids

Given a Draft headless spec whose questions have the ids `q-keep` and `q-scope`, with options `keep-10` and `keep-20` under `q-keep`, when `phax artifact decide <spec> --question q-scope` runs and the operator decides it, then `phax artifact status` runs, then decide runs with `--question Q2`, then The §9 headings read `### q-keep — …` and `### q-scope — …`. The bullets under `q-keep` open with `keep-10 —` and `keep-20 —`, and its `Recommendation:` line names an option id. Status names `q-keep` as open. The last run exits 12 naming `q-keep` and `q-scope`. (refs §5.27, §5.34)

### Authoring emits open questions only

Given a headless authoring session whose document carries an arbitrated question, when the session ends, then The run exits 5, and nothing is written. (refs §5.60)

### A departing verdict revises the body, after the operator accepts the diff

Given a spec whose open question Q4 recommends `structural`, with a requirement written for that recommendation and an acceptance criterion that references it, when interactive decide runs, the operator chooses `oracle` for Q4, and the session returns the revised document; the operator first declines the diff, then runs decide again and accepts it, then The declined run writes nothing. The accepted run commits Q4 in `arbitratedQuestions` with `chosen: "oracle"` and a `revised` list naming the requirement and the criterion, both rewritten for `oracle`, with traceability intact. A verdict equal to the recommendation lands with `revised: []` and no body change beyond §9 and the decision log. (refs §5.21, §5.22, §5.20)

## 9. Open questions for implementation planning

### Q1 — May `decide` and a question reopen run on an Approved artifact, and what becomes of its approval? (Decided by the author on 2026-09-28; not reopened.)

- Allowed on Draft and Approved. The artifact stays Approved but reads edited since approval (spec) or self-changed (plan) until it is re-approved, which is the existing in-place revision. — abandons: a status that says the approval is void: until re-approval, the artifact still reads Approved, and only `Edited since` and the Questions line show the change
- A decide or reopen on an Approved artifact moves it back to Draft through a new Approved → Draft transition. — abandons: the lifecycle graph of specs 21/22 (it gains a backward edge) and approval continuity: every plan bound to the spec loses its Approved source at once
- Refuse decide and reopen once the artifact is Approved. — abandons: steering after approval: a `rouvre` on an approved spec would force abandoning and re-authoring it
- Decide runs on Draft only; `phax artifact reopen` moves an Approved spec or plan back to Draft, removing its approval record. — abandons: steering an approved artifact without voiding its approval: every re-arbitration first costs a reopen and a re-approval

Recommendation: Decide runs on Draft only; `phax artifact reopen` moves an Approved spec or plan back to Draft, removing its approval record. — Decided by the author on 2026-09-28, because an approved artifact is not arbitrated: `decide` runs on Draft only, and `phax artifact reopen`, extended from Stale plans to Approved specs and plans, is the one gesture back to Draft. The approval is voided visibly, with its record file deleted, instead of lingering as an in-place revision.

### Q2 — Do plans need a structured open-questions section in their document schema? (Decided by the author on 2026-09-28; not reopened.)

- Add `openQuestions` to the plan preamble, in the decision-request shape plus `history`, rendered before the first phase. Settled arbitrations stay prose in `technicalArbitrations`. — abandons: an unchanged plan document: the format gains a new shape, and the planning skill's document table changes
- Decide specs only in this spec, and refuse plans until a later spec. — abandons: the plan doctrine (P1–P9) and the first consumer's plan arbitrations, which would stay in a private session
- Turn `technicalArbitrations` itself into decision requests. — abandons: settled arbitrations as one-line prose: every already-decided arbitration would have to be restated as a question with options

Recommendation: Add `openQuestions` to the plan preamble, in the decision-request shape plus `history`, rendered before the first phase. Settled arbitrations stay prose in `technicalArbitrations`. — Decided by the author on 2026-09-28, because the plan document has no question structure, so decide on plans needs one. Adding it beside the settled list keeps decided things as prose and gives open things the same shape as a spec's §9 (C1). Rendering in the preamble keeps plan lint and the deterministic projection untouched.

### Q3 — How does phax know that an approval or a reopen is a machine's? (Decided by the author on 2026-09-28; not reopened.)

- The caller declares it with `--machine <grant>`. Without the flag, the gesture is the operator's. — abandons: enforcement: a loop that omits the flag is recorded as the operator, so attribution is honest by declaration only
- No TTY means machine. — abandons: determinism and scripted operators: the same command records differently depending on the terminal, and a human's scripted approval is labelled machine
- `phax artifact approve` always requires `--by operator|machine:<grant>`. — abandons: every existing `artifact approve` invocation: a breaking CLI change against the additive constraint
- `--by operator | machine:<grant>`, required when not run from a terminal; from a terminal without it, the operator. — abandons: an unchanged scripted `approve`: every non-terminal caller must add `--by`

Recommendation: `--by operator | machine:<grant>`, required when not run from a terminal; from a terminal without it, the operator. — Decided by the author on 2026-09-28. At a terminal, the operator is the honest default; without one, phax refuses to guess and asks for `--by`. A loop that forgets to declare itself is refused rather than recorded as a human. A machine inside a pseudo-terminal would still default to the operator, a risk accepted as far narrower than 'no flag means human'. Scripted approvals must add `--by`, the one non-additive CLI change.

### Q4 — What does an approval record written before attribution read as? (Decided by the author on 2026-10-14; not reopened.)

- A record stamped 0.19.0 is read through its frozen 0.19.0 shape and lifted to `approvedBy: { kind: unattributed }`. `approvedBy` is required at the new shape, approve writes it, and `migrate-approvals` writes each migrated entry as unattributed. — abandons: attribution written in the file itself: an untouched 0.19.0 record says nothing on disk, and every reader (phax, the schemas package) must apply the same lift to read it as unattributed
- `approvedBy` is required. A record stamped 0.19.0 is refused, naming the record and the one-line fix, and this repository's record files are rewritten to `unattributed` in the same change. — abandons: reading the approvals made before this release in any other repository: status, approve, plans status and run refuse there until each record file is edited by hand; it also sets aside phax's way of reading its older files through their frozen shape

Recommendation: A record stamped 0.19.0 is read through its frozen 0.19.0 shape and lifted to `approvedBy: { kind: unattributed }`. `approvedBy` is required at the new shape, approve writes it, and `migrate-approvals` writes each migrated entry as unattributed. — Decided by the author on 2026-10-14, as recommended. The 2026-09-28 answer chose refusal when approvals were a shared ledger whose shape had no name. Today a 0.19.0 stamp says exactly which shape a record has, and that no phax before this one recorded an approver. So `unattributed` is a fact phax knows and can write explicitly in the lift (E0), as it writes `retry: "none"` for authoring manifests stamped 0.17.0. Neither option reads an old approval as an operator's. The field stays required at the new shape, so the lift is not a shim. The loss is bounded: a lifted record is rewritten at the next approval, and deleted by reopen, completion or abandonment.

### Q5 — What does decide do with a hand-authored artifact that has no sidecar? (Decided by the author on 2026-09-28; not reopened.)

- Decide and reopen refuse it, naming the remedy: re-author it headless, or answer its §9 by hand. — abandons: arbitration of hand-authored artifacts: a human who writes a spec interactively still answers its §9 by hand, as today
- A new model extraction of §9 or the plan's arbitrations, with decisions kept in a file beside the artifact and decision lines spliced into the hand-written Markdown. — abandons: one home for decisions and the rule that phax edits Markdown only by rendering it: decisions would live in the sidecar for one artifact and in another file for the next
- decide reads and writes a hand-authored §9 in the §9 format. — abandons: phax editing Markdown only by rendering it: for a hand-authored artifact it writes the question blocks and the decision log in place

Recommendation: decide reads and writes a hand-authored §9 in the §9 format. — Decided by the author on 2026-09-28, because every question is answered before approval, whatever authored the artifact, so phax must read a hand-written §9. It does so deterministically, in the layout the renderer produces, and decide writes only the question blocks and the decision log.

### Q6 — How is an already decided question arbitrated again? (Decided by the author on 2026-09-28; not reopened.)

- On a Draft, `decide --question <id>` re-arbitrates it; the new decision joins its history. — abandons: a note-carrying reopened state that waits for the next decide
- Keep `decide --question <id> --reopen --note`, a reopened state presented first. — abandons: one fewer state and flag, and a name distinct from `phax artifact reopen`

Recommendation: On a Draft, `decide --question <id>` re-arbitrates it; the new decision joins its history. — Decided by the author on 2026-09-28, because with decide on Draft only, reopening the artifact is the gesture; a question needs no state of its own.

### Q7 — Which artifacts does the approval lock cover? (Decided by the author on 2026-09-28; not reopened.)

- Every spec and plan: undecided questions refuse approval, with or without a sidecar. — abandons: approving a hand-authored artifact whose §9 is not in the §9 format until it is converted
- Every artifact with a sidecar. — abandons: the guarantee for hand-authored artifacts
- Only artifacts already arbitrated. — abandons: the guarantee for any artifact never passed through decide

Recommendation: Every spec and plan: undecided questions refuse approval, with or without a sidecar. — Decided by the author on 2026-09-28, because the choice taken is now recorded in every case, interactively or by hand, so every open question is answered before approval.

### Q8 — How does approve know that a hand-authored question is decided? (Decided by the author on 2026-09-28; not reopened.)

- Each question follows the §9 format and is decided when its last block is a `Decision:` block. — abandons: free-form §9 layouts: hand-authored artifacts are converted once
- A hand-authored artifact approves only with no open-questions section left. — abandons: the arbitration trail in the document

Recommendation: Each question follows the §9 format and is decided when its last block is a `Decision:` block. — Decided by the author on 2026-09-28, because the layout the renderer produces keeps one format for both kinds of artifact, and the trail stays in the document.

### Q9 — Where does an arbitrated question go? (Decided by the author on 2026-09-29; not reopened.)

- An `arbitratedQuestions` section: arbitrating moves the question with everything it had, plus its verdict. — abandons: one list to read: the decided questions sit apart from the open ones
- One section; each question gains a Decision block. — abandons: seeing at a glance that nothing is left: every question must be read

Recommendation: An `arbitratedQuestions` section: arbitrating moves the question with everything it had, plus its verdict. — Decided by the author on 2026-09-29, because an empty open section says there is nothing left to do, and approval checks exactly that.

### Q10 — Who rewrites the body when a verdict departs from the recommendation? (Decided by the author on 2026-09-29; not reopened.)

- The interactive session returns the revised document; phax checks it and shows the body diff; the operator accepts. — abandons: a decide gesture that writes only verdicts
- decide writes the verdict; a separate `artifact revise` rewrites the body; approval is blocked in between. — abandons: one gesture, and a spec that never contradicts its verdicts
- The operator revises the body by hand. — abandons: a spec consistent with its verdicts until someone fixes it

Recommendation: The interactive session returns the revised document; phax checks it and shows the body diff; the operator accepts. — Decided by the author on 2026-09-29, because a headless-authored body is written for its recommendations, and the 2026-09-28 arbitrations had to rewrite requirements, surfaces and criteria by hand wherever the verdict departed.

### Q11 — Is there a headless mode at all in this spec? (Decided by the author on 2026-09-29; not reopened.)

- No: decide is interactive only; a headless mode is built later from the recorded sessions. — abandons: any unattended arbitration for now
- Headless pre-arbitration: the case for each abandoned option, a recommendation and answers to `F1`–`F5`, deciding nothing. — abandons: not redoing work: the authoring session already wrote the options, their losses and a recommendation, and the operator arbitrates again anyway

Recommendation: No: decide is interactive only; a headless mode is built later from the recorded sessions. — Decided by the author on 2026-09-29, because pre-arbitration repeats what authoring already did and the operator redoes it; the recorded interactive sessions are what a headless mode will be built from.

### Q12 — How are spec and plan documents written before this change lifted, given that decided questions stay in `openQuestions`, marked only in prose? (Decided by the author on 2026-10-14; not reopened.)

- The lift moves each question whose `rationale` opens with `Decided by the author on <YYYY-MM-DD>` to `arbitratedQuestions`, whatever its `question` says. It gets a `lifted` verdict holding only its recommendation as chosen, its other options as abandoned, its rationale as why, the marker's date and `by: unattributed`; every other question stays open. A 0.20.0 plan document lifts with both arrays empty, since plans carry no questions today. — abandons: a lift that reads only structure: phax recognizes a prose prefix inside a field; a rationale that departs from the prefix by one character stays open
- Every question lifts as open, and `arbitratedQuestions` lifts empty. — abandons: the author's recorded decisions on in-flight artifacts: each Draft must be re-decided before approval, and its decision record dates a September decision to the day it is restated
- A spec document stamped below the new shape is refused, as plan documents without `completesSpec` were, and this repository's live sidecars are rewritten by hand in the same change. — abandons: reading an untouched in-flight headless artifact in any other repository, and the frozen-shape reading this spec otherwise uses

Recommendation: The lift moves each question whose `rationale` opens with `Decided by the author on <YYYY-MM-DD>` to `arbitratedQuestions`, whatever its `question` says. It gets a `lifted` verdict holding only its recommendation as chosen, its other options as abandoned, its rationale as why, the marker's date and `by: unattributed`; every other question stays open. A 0.20.0 plan document lifts with both arrays empty, since plans carry no questions today. — Decided by the author on 2026-10-14, as recommended. The rule is corrected: the third draft required both the question suffix and the rationale prefix, but the two other in-flight specs, `headless-review` and `oracle-phases`, mark their 13 decided questions with the rationale prefix alone, so the rationale is the marker. Where the author decided against a recommendation, `recommendation` was rewritten to the option chosen (`oracle-phases` reads "against the previous recommendation (`structural`)" beside `recommendation: new-oracle-surface`), so the recommendation is the choice. The marker is the only record of these decisions. Lifting it keeps the author's decisions decided without inventing what was never recorded: a lifted verdict holds only what the marker and the question carry, names no arbiter, and keeps the marker's date (E0). An exact prefix match is conservative: a question that does not match stays open, which costs one decide, never a false decision. Completed and Abandoned artifacts are never approved again, so the lift matters only for artifacts still in flight.

### Q13 — The renderer changes §9 (ids, a 9b section, a decision log), and agreement compares the body with the sidecar's rendering. How does an untouched older artifact agree with its sidecar? (Decided by the author on 2026-10-14; not reopened.)

- For a sidecar stamped below the new shape, agreement compares the body with that shape's rendering: today's §9 layout is kept for this check only. The first decide that writes the artifact re-renders it in the new layout, under the operator's diff review. — abandons: one rendering per document: the 0.17.0 §9 layout stays in phax for as long as such sidecars are read
- Agreement gains a fourth value, `older shape`. Approve refuses it, naming decide, which re-renders even with nothing to decide. — abandons: detecting a hand edit on an older-shape body, which decide's re-render would then overwrite unseen, and approving an in-flight artifact in place
- A one-time command lifts and re-renders every live sidecar and body, and approval refuses until it has run, like `migrate-approvals`. — abandons: approval continuity: re-rendering an Approved artifact edits it after its approval, so its record no longer matches and its bound plans go stale

Recommendation: A one-time command lifts and re-renders every live sidecar and body, and approval refuses until it has run, like `migrate-approvals`. — Decided by the author on 2026-10-14, against the recommendation (`frozen-layout`). A document has one rendering: no 0.17.0 §9 layout is kept for agreement. `phax artifact migrate-documents`, beside `migrate-approvals`, lifts every live spec and plan sidecar stamped below the new document shapes by Q15's rule, writes it at the current shape and re-renders its body in the new layout, once, in one path-scoped commit. Until it has run, approve, reopen and decide refuse, naming it, as the approval commands refuse while an old approvals ledger exists. A hand edit is never overwritten unseen: the command alone reads a body against its sidecar's own-shape rendering, and it refuses, writing nothing, when they differ or the sidecar is invalid. The loss is accepted: re-rendering an Approved artifact edits it after its approval, so a migrated Approved spec reads edited since approval and its bound plans go stale (`spec-changed`). The command says so, naming each artifact. A 0.20.0 plan's body does not change, because its question sections render only when non-empty.

### Q14 — How is a question named in the Markdown and on the command line, given that the renderer numbers headings by position and prints option labels, not ids? (Decided by the author on 2026-10-14; not reopened.)

- Headings render the question id (`### <id> — <question>`), and option bullets and the `Recommendation:` line open with option ids. `--question`, status, refusals and the decision log name ids. — abandons: today's short positional headings: a question whose id is `q-release-name` is headed by that id, and every live headless spec's §9 changes when `migrate-documents` re-renders it
- Keep `Q<n>` by position, counted across the open section and then the arbitrated one. — abandons: a stable name: a heading's number changes when a question moves between sections, which is exactly what decide does, so `--question`, status and the decision log could name a different question after each decide

Recommendation: Headings render the question id (`### <id> — <question>`), and option bullets and the `Recommendation:` line open with option ids. `--question`, status, refusals and the decision log name ids. — Decided by the author on 2026-10-14, as recommended. An id is the question's identity in the document, on the command line and in its history (F3: a thing is identified without its location). Hand-authored artifacts already write `Q<n>`, which stays a valid id, and headless sessions choose their own. Existing artifacts change where `migrate-documents` re-renders them (Q16), so the heading change needs no re-render of its own.

### Q15 — What does `phax artifact reopen` do to the live plans bound to an Approved spec? (Decided by the author on 2026-10-14; not reopened.)

- Reopen proceeds and leaves each bound plan as it is, naming it in its output. A plan goes stale (`spec-changed`) once decide rewrites the spec. — abandons: a guard against running a plan whose spec is under reconsideration: between reopen and decide, an Approved plan bound to a Draft spec still reads fresh and can run
- Reopen refuses while a live plan names the spec, as completion and abandonment do. — abandons: reconsidering a spec with plans in flight: each plan must first be abandoned, losing plan work even when the verdict changes nothing the plan relies on
- Reopen also moves each Approved bound plan to Stale. — abandons: one artifact per gesture: reopen would write other artifacts' frontmatter, and its write-set would grow beyond the reopened artifact

Recommendation: Reopen proceeds and leaves each bound plan as it is, naming it in its output. A plan goes stale (`spec-changed`) once decide rewrites the spec. — Decided by the author on 2026-10-14, as recommended. Staleness already answers this (C1). Reopening changes only `status` and `approved`, which the fingerprint ignores, so a bound plan stays fresh until decide rewrites the spec, and then reads `spec-changed`. Approving a plan against a Draft spec is already refused. Naming the bound plans in reopen's output makes the window visible without adding a guard.

### Q16 — What identifies the shape of the document a decide session returns? (Decided by the author on 2026-10-14; not reopened.)

- The answer takes the sidecar form: `$schema` first, naming the document format at its current shape. Any other stamp, or none, is refused by name and never lifted. — abandons: one answer form across authoring and decide: authoring keeps answering `version: 1`, while decide answers with `$schema`
- The answer takes the authoring form, `version: 1` then the document, decoded by the authoring contract. — abandons: naming the shape the answer was written against: an answer in an older document shape fails only as schema-invalid, never refused by name as the provider-answer rule requires

Recommendation: The answer takes the sidecar form: `$schema` first, naming the document format at its current shape. Any other stamp, or none, is refused by name and never lifted. — Decided by the author on 2026-10-14, as recommended. The revised document is a provider answer, and the rule decided on 2026-10-08 is that before 1.0 an answer in an older shape is refused by name. The session reads the sidecar in its file form and returns it in the same form, so its `$schema` says which shape it answered against. Aligning the authoring answer's `version: 1` is not this spec's job.

## 10. Implementation-planning note

Settled:

- One mode, interactive: the framing questions `F1`–`F5`, the operator's verdicts, the revised document, and the body diff accepted before writing (Q14). There is no `--headless`, no machine proposal, no escalation and no machine reversal. decide refuses without a terminal and, through the phase guard, inside a phase worktree: it never runs inside a run.
- Two sections, `openQuestions` and `arbitratedQuestions`. A decided question moves with its verdict, and approval requires the open section to be empty (Q11, Q9).
- A verdict that departs from the recommendation revises the body in the same document. phax checks what moved, what stayed and traceability, shows the body diff, and writes only what the operator accepts (Q12).
- The three doctrine skills are registered in the skill catalog and install like `phax-spec`.
- Doctrine resolution: `phax-decide-spec` or `phax-decide-plan` by kind, a project-scope copy of the same name winning over the bundled one, and `--doctrine` appended after it. Principle ids are the backticked ids that open list items, and every citation is validated; this format is decided, not open. decide's prompt carries the framing questions, because the doctrine skills do not hold them.
- The input is the sidecar at its current shape or, for a hand-authored artifact, its §9 in the §9 format (Q6, Q10). With nothing awaiting decision, decide exits 0 with no session.
- decide runs on Draft only. `phax artifact reopen` extends to Approved → Draft, clearing the stamp and deleting the approval record file (Q1); it leaves bound plans as they are and names them (Q18). `--question` re-arbitrates one question, and there is no reopened state (Q8).
- Approver attribution in both approval record formats: `--by machine:<grant>`, `--by operator`, the operator by default from a terminal, and a refusal without a terminal (Q3). A 0.19.0 record is lifted on read to unattributed (Q4). Plans gain structured `openQuestions` and `arbitratedQuestions` (Q2).
- Formats: `spec-document`, `plan-document`, `spec-approval-record` and `plan-approval-record` get new shapes, and a decision record manifest is born with `$schema`. Each older file is read as §6's format table states. The decide session answers in the sidecar form at the current shape, and any other stamp is refused by name (Q19).
- Spec documents lift by the rationale marker alone; the question suffix is not read (Q15). Questions are named by id in the Markdown, on the command line, in status, refusals and the decision log (Q17).
- Document migration (Q16): `phax artifact migrate-documents` lifts every live spec and plan sidecar stamped below its document shape and re-renders its body, once. It refuses, writing nothing, on an invalid sidecar, a body that is not its sidecar's own-shape rendering, or uncommitted changes on a path it would write. It names every Approved artifact left edited since approval and every plan left stale, and commits exactly the paths it rewrote. Until it has run, approve, reopen and decide refuse, naming it; complete and abandon carry an older sidecar as it is.
- Left to the plan, as §6 marks indicative: the rendering prose of the Decision block and decision-log entries, and the plan preamble section names; the spelling of the `--by` values, the reopen trailer, `history`, `verdict`, `approvedBy` and their nested keys, and the decision record's format id and manifest layout; how the session hands its revised document to phax and how the diff is shown and accepted; whether the session returns a decided verdict's `by` and `at` for phax to check, or phax sets them; where the authoring session id is kept in local state; how a provider whose skills live in `.agents/skills` resolves the project override (following `phax skills install`'s target mapping); the built-in decide model and effort, chosen from the catalog on cost; and `migrate-documents`' output layout and commit subject.

Left open: none.

Constraints:

- Compose the headless-authoring machinery: prompt assembly, the JSON-only provider session, boundary decoding, deterministic renderers, the path-scoped commit, the record writer and the sidecar agreement check. Do not fork it.
- For a headless-authored artifact, the sidecar's `openQuestions` and `arbitratedQuestions` are the single source of a question's state. For a hand-authored one, its two §9 sections are, parsed deterministically. §9, the decision log, `artifact status` and the approve refusal all derive from that source.
- New persisted fields are required and use explicit per-variant enums: `arbitratedQuestions` in both documents, `openQuestions` in the plan preamble, `verdict` and `history` on every arbitrated question, and `approvedBy` on every approval record at the new shape. `approvedBy.kind` is machine | operator | unattributed, and `verdict.kind` is decided | lifted. No field becomes optional. The authoring answer gains `arbitratedQuestions`, which must be empty.
- Each changed format records its new shape as `packages/schemas/snapshots/<format>/next.schema.json`, released by the cut (`docs/release.md`). Its previous shape is frozen under `src/schemas/history/<format>/<release>.ts` and pinned by `packages/schemas/history.lock.json`, and phax's reader lifts through it as it lifts the authoring record manifest. A frozen-shape lift is the sanctioned way to read an older file; it is not a back-compat shim.
- Agreement compares a body with its sidecar's rendering at the current shape only; no older §9 layout is kept for it. The one use of an older shape's rendering is `migrate-documents`' check that a body is untouched before the command re-renders it. Plan question sections render only when non-empty.
- `migrate-documents` follows `migrate-approvals`: it decides everything before writing anything, refuses a dirty write-set, writes, then commits exactly the paths it rewrote in one commit, and keeps frontmatter, `approved` stamps and approval record files as they are.
- A re-rendered plan, whether by decide or by migration, must still pass `phax plans lint`, parse on the deterministic path to the same projection, have its extraction cache re-seeded, and keep its lineage.
- The local authoring session id never goes to the records branch, so the authoring record format is unchanged.
- Transitions keep carrying the sidecar in their write-set, and the clean-file precondition of artifact auto-commits applies to decide, artifact reopen and migrate-documents. Approval commands keep refusing while an old approvals ledger exists; approve, reopen and decide also refuse while a live sidecar is stamped below its document shape.
- `artifact decide` and `artifact migrate-documents` are classified `refused` in the phase guard's classification.
- The CLI stays additive: two new commands, new flags and new transitions. The only non-additive behaviors are Q3's decided refusal of `approve` and `reopen` without `--by` outside a terminal, and Q16's one-time refusal of approve, reopen and decide until `migrate-documents` has run.
- The machine/operator approval form is shared with the headless-review spec, which reopens after this spec ships and adopts it.
- A project that installs the default skills at project scope pins that copy. The decision record's skill source and fingerprint make that drift visible; nothing else is added for it.
- The landed doctrine skills describe a headless mode that decides and escalates. decide loads them for the interactive session, whose facilitation they guide, and their headless sections stay unused until a headless mode is specified.
- Every example and test fixture is made up; none is copied from another repository.

## 11. Docs page

Page: docs/arbitration.md

Reader: An operator who wants a spec's or plan's open questions decided under a written doctrine: framing first, then each question, seeing what each verdict changed in the body, and telling a machine's approval from a human's.

Example: phax artifact new spec plan-prune --headless --brief brief.md
phax artifact status docs/specs/2609251400-plan-prune.md
  Questions: 3 — open 3 (Q1, Q2, Q3) · arbitrated 0
phax artifact decide docs/specs/2609251400-plan-prune.md          # framing F1–F5, then decide; accept the body diff
phax artifact approve docs/specs/2609251400-plan-prune.md --by operator
phax artifact reopen docs/specs/2609251400-plan-prune.md --by operator     # back to Draft to reconsider
phax artifact decide docs/specs/2609251400-plan-prune.md --question Q1     # re-arbitrate one question; the old verdict stays in its history
