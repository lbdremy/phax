---
status: Draft
date: 2026-10-19
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Artifact decide from verdicts — transcribing decisions already made

## 1. Context

`phax artifact decide <artifact>` (the `artifact-decide` spec, Completed) arbitrates a Draft spec's or plan's open questions in an interactive Claude Code session. Without a terminal it refuses with exit 12. The session resumes the artifact's kept authoring session when `session.json` names claude-code and the same checkout, and starts a new one otherwise. It raises the framing questions F1–F5 and then presents the open questions; the operator decides.

phax then resumes the session headless for the whole revised document. That is the sidecar form at the current shape, or, for a hand-authored artifact, a `hand-decision-answer`. phax checks the answer:
- only presented questions move;
- `chosen` and `abandoned` name the question's options;
- cited principles are ids that open list items in the loaded doctrine;
- a departing verdict names what it revised;
- traceability holds.

A refused answer gets one corrective resume. phax shows the rendered body diff and writes nothing unless the operator accepts it. Then it writes the sidecar, re-renders the artifact, re-seeds a plan's extraction cache, and commits exactly those paths with `Decided-By: operator (<name>)` and `Decision-Id` trailers.

A decided verdict is { kind: decided, chosen, abandoned, why, advocate, principles, reversibility, by, at, revised }, and a plan's adds `phase`. `by` has one variant, { kind: operator, name }, taken from the committing git identity. Every spawned session writes a decision record whose manifest says `mode: interactive`, with the outcome committed | declined | undecided | failed.

The decide model comes from `--model`/`--effort` or the built-in claude-opus-5-5 / high, and must be a Claude Code catalog entry. Headless authoring is different: it resolves its model through routing (flag, then `authoring.spec|plan`, then the catalog default), runs on any provider, and keeps its session id with the provider's name.

`approve` and `reopen` take `--by operator | --by machine:<grant>`. Without a terminal and without `--by`, they refuse. The decide doctrines describe three modes: interactive (the human decides), headless (the agent decides within the menu and escalates the rest), and headless total (later). Only interactive exists.

Ground read:

- `docs/specs/archive/2610140742-artifact-decide.md` — The shipped decide (Completed). It is interactive only and refuses without a terminal (§5.8). It runs the framing questions F1–F5, then a headless handback for the whole revised document, with a corrective resume once. Its checks are §5.19 and §5.21; the body diff must be accepted before anything is written (§5.22). Its exit families are 0/1/5/8/12, it commits in one path-scoped commit, and it writes a decision record. Its non-goals leave the headless mode unspecified and leave out a phax.json key for the decide model.
- `docs/ideas/artifact-decide.md` — The original idea: interactive and headless sessions, a caller-owned doctrine, and decisions as JSON. A steering instruction like `rouvre Q3` maps to a decide gesture.
- `src/app/decideArtifact.ts` — The order of preconditions (migration, Draft, sidecar in sync or hand §9 parses, clean write set, known --question, terminal, Claude model, doctrine, committing identity). Then the interactive session, the handBack with one corrective resume, the diff and confirm, the changed-during-session refusal, the plan cache re-seed, the commit with `Decided-By: operator (<name>)` and `Decision-Id` trailers, and the decision record on every end after spawn. Only a kept session whose `session.json` names claude-code and the same checkout is resumed.
- `src/schemas/questions.ts` — A decided verdict is { kind: decided, chosen, abandoned, why, advocate, principles, reversibility, by: { kind: operator, name }, at, revised }; plans add `phase`. `by` has one variant. The question checks: ids unique, recommendation and chosen name listed options, abandoned is exactly the others.
- `src/schemas/decisionRecord.ts` — The decision record manifest: `mode` is the single literal `interactive`; the outcome is committed | declined | undecided | failed, with a commit only when committed. It carries provider, model, effort, usage and the doctrine sources.
- `src/schemas/handDecisionAnswer.ts` — For a hand-authored artifact the handback returns a `hand-decision-answer` ($schema, kind, decisions by question id, the whole revised Markdown). phax writes the question blocks and the decision log itself.
- `.claude/skills/phax-decide-spec/SKILL.md` — The doctrine: E0, C1–C5, S1–S10, the interactive / headless / headless-total modes, and propose-and-escalate. phax sets `by` and `at`. A departing verdict revises the body it implies and names it in `revised`.
- `.claude/skills/phax-decide-plan/SKILL.md` — The same modes for plans; a plan verdict also names the `phase` it bears on.
- `src/app/authorArtifact.ts` — Headless authoring resolves model and effort through routing (flag, then phax.json authoring.spec|plan, then the catalog default) and may run on any provider. It keeps the provider session in `session.json` with its provider, for decide to resume.
- `src/schemas/authoringSession.ts` — The kept authoring session: version 1, provider, sessionId, retrySessionId, cwd. Local state only.
- `src/domain/decide/model.ts` — The decide model is `--model`/`--effort` or the built-in claude-opus-5-5 / high, and must be a claude-code catalog entry.
- `src/schemas/phaxConfig.ts` — DEFAULT_AUTHORING_MODEL and DEFAULT_DECIDE_MODEL are claude-opus-5-5 / high; compliance review defaults to claude-sonnet-5-5. phax.json has `authoring.spec` and `authoring.plan` and no decide key.
- `src/schemas/approvedBy.ts` — The approver union for approve and reopen: machine (kebab-case grant), operator (git user.name), unattributed.
- `docs/specs/2609250823-headless-review.md` — Draft. It reuses the `--by operator | --by machine:<grant>` form and records machine approvals with their grant.
- `phax.usage.kdl` — Today decide takes `--question`, `--doctrine`, `--model` and `--effort`, with no `--json` and no `--by`. `phax artifact schema <kind>` prints the spec or plan document schema.

## 2. Problem

Interactive decide makes a person open a terminal session to say verdicts they already hold. Often that is "the recommendations, except one". In that session the person decides nothing new; the session exists to transcribe.

A caller without a terminal cannot apply verdicts at all. That covers an agent session working for the person, and a loop such as the steme conductor relaying a person's instruction. decide refuses all of them, so their only paths are a hand edit of the Markdown, which diverges the sidecar and blocks approve, or no decision.

The transcription step already exists and is already headless: phax resumes the session, asks for the whole revised document, checks it and renders it. The terminal stands in front of it, and so does a confirm prompt that only a person at a terminal can answer.

Nor is the transcription made easy to verify. Whoever applied the verdicts must read the result before approving, yet nothing tells them what was transcribed per question. Nothing checks that the chosen option is the one the person gave, or that no other question or section moved.

## 3. Product goal

`phax artifact decide` gains a second mode. A verdicts file carries the decisions a person already made: for each question, the option chosen and the person's note. A headless writer session, under the doctrine, transcribes them into the artifact's revised document, together with the body revisions a departing verdict implies.

phax refuses a bad file before any session. It checks the answer against the file deterministically, writes and commits it without a prompt, and leaves the artifact Draft. It then prints what the caller must read before approving: each verdict as transcribed, and the body diff.

The person decides; the writer only writes it down. A mistake is undone by deciding again or reopening, never by a checker session.

> The person decides and phax checks the transcription: what the file says is applied as given, nothing it does not name moves, and nothing is approved.

## 4. Terminology

- **Verdicts file** — The input of verdicts mode, in the versioned format phax owns (format id indicative: `decide-verdicts`). It holds `$schema`, the artifact path, and a non-empty list of verdicts, each `{ question, chosen, note }`. It is given as `--verdicts <file|->`.
- **Given verdict** — One entry of the verdicts file. `question` is an id of the artifact's open or arbitrated questions; `chosen` is one of that question's option ids; `note` is the person's text or null.
- **Note** — The person's own words about a given verdict: their reason, or a precision on how to apply the chosen option. It is a required key whose value is a non-empty string or null.
- **Other** — The option with id `other` that every question of a spec or plan lists, written in its options with the label and loss phax fixes. Choosing it means the choice is the one the verdict's note describes. It is never a question's recommendation, so a verdict choosing it always departs and always carries a note. It never becomes a new option.
- **Departing verdict** — A given verdict whose `chosen` differs from its question's `recommendation`.
- **Verdicts mode** — `phax artifact decide <artifact> --verdicts <file|->`: a headless decide that needs no terminal, raises no framing questions and asks for no confirmation. The person decided before the command ran.
- **Writer session** — The one headless provider session that verdicts mode runs, under the doctrine skill for the artifact kind and any `--doctrine` file. It returns the whole revised document. It decides nothing: for each given verdict it writes the advocate, principles and reversibility, plus the body revisions and `revised` of a departing verdict.
- **Interactive mode** — `phax artifact decide` as shipped by `artifact-decide`. Unchanged by this spec.
- **Caller** — Whoever ran verdicts mode: the person, an agent session acting for them, or a loop relaying their instruction. The caller reads the result before approving.
- **Agent-decides modes** — The doctrine's `headless` and `headless total` modes, in which an agent chooses. They are not specified here, and verdicts mode is not one of them.

## 5. Functional requirements

### 5.1 Verdicts mode

WHEN `phax artifact decide <artifact> --verdicts <file|->` runs THE system SHALL arbitrate exactly the questions the verdicts file names, each with the option the file gives, without requiring a terminal and without any confirmation prompt.

### 5.2 The verdicts file format

The system SHALL accept a verdicts file only in its versioned format: `$schema` naming the format at its current shape, the `artifact` path, and a non-empty `verdicts` list whose entries hold exactly `question`, `chosen` and `note` (a non-empty string or null), with unknown keys rejected.

### 5.3 A malformed file is refused

IF the verdicts file cannot be read, is not JSON, carries no `$schema`, carries one naming another format or shape, or fails the format's schema THEN the system SHALL refuse with exit 12 before any session, naming the `$schema` it read or the first violation by path, and write nothing.

### 5.4 The file must fit the artifact

IF the verdicts file names an artifact other than the one given, names a question the artifact does not have, names the same question twice, or chooses an option its question does not list THEN the system SHALL refuse with exit 12 before any session, naming the offending verdict with the artifact's question ids or the question's option ids, and write nothing.

### 5.5 A departure carries the person's note

IF a departing verdict, which includes every verdict choosing `other`, has a null note THEN the system SHALL refuse with exit 12 before any session, naming the question and its recommendation, and write nothing.

### 5.6 Today's refusals still apply

IF any precondition interactive decide checks fails (a live sidecar awaiting migration, an artifact that is not Draft, a diverged or invalid sidecar, a hand-authored §9 that departs from the format, uncommitted changes on the write set, no committing git identity, a refused `--doctrine` file) THEN the system SHALL refuse verdicts mode with exit 12 before any session, as interactive decide does, and write nothing.

### 5.7 Never inside a run

IF verdicts mode runs inside a phase worktree THEN the system SHALL refuse it with the phase guard's refusal and exit 1 before any session.

### 5.8 Flags belong to one mode

IF `--verdicts` is given together with `--question`, or `--json` or `--by` is given without `--verdicts` THEN the system SHALL refuse with exit 12 before any session, naming the conflicting flags.

### 5.9 Unnamed questions stay as they are

WHEN verdicts mode lands THE system SHALL leave every question the file does not name exactly as it was: an open one stays open, and an arbitrated one keeps its verdict and history.

### 5.10 Naming an arbitrated question re-arbitrates it

WHEN a given verdict names an arbitrated question THE system SHALL give it the new verdict and append its previous verdict to the end of its history.

### 5.11 One writer session

WHEN every precondition passes THE system SHALL run one headless writer session under the doctrine skill for the artifact kind, followed by any `--doctrine` file. It SHALL resume the artifact's kept authoring session when that session was authored in this checkout on the provider the resolved model runs on, start a new session otherwise, and print which it did.

### 5.12 Model, effort and provider

The system SHALL resolve the writer session's model and effort from `--model` and `--effort` when given, and from the built-in verdicts default otherwise. It SHALL run the session on the provider model routing resolves for that model, and print the model, effort, their source and the provider.

### 5.13 The writer returns the whole revised document

The writer session SHALL return the artifact's whole revised document. For each given verdict it SHALL write the advocate, principles and reversibility, and, for a departing verdict, the body revisions the verdict implies, named in `revised`; for a verdict choosing `other`, those are the revisions that apply the choice its note describes.

### 5.14 The person's words are the why

WHEN a given verdict lands THE system SHALL set its `why` to the note verbatim, or to the question's rationale when the note is null. It SHALL also set the verdict's `by` and `at`, overwriting any value the writer returned for these three fields.

### 5.15 The transcription is checked against the file

IF the writer's answer fails any check interactive decide applies to a revised document or hand decision answer, chooses for a given question an option other than the one given (`other` included), adds, removes or changes an option of any question, moves or changes a question the file does not name, or changes the body outside the question sections and decision log while no given verdict departs THEN the system SHALL refuse it. After one corrective resume of the same session, the system SHALL fail with exit 5 naming the first violation by path, with the working tree and HEAD unchanged.

### 5.16 Every question lists `other`

IF a question of a spec or plan, in a document an authoring or decide session returns, in a sidecar phax reads, or in a hand-authored §9, does not list the option `other` exactly once with the label and loss phax fixes, or recommends `other` THEN the system SHALL refuse it, naming the question: exit 5 for a session's document, and exit 12 for an artifact.

### 5.17 Older documents gain `other`

WHEN `phax artifact migrate-documents` lifts a live spec or plan sidecar stamped below the shape that introduces `other` THE system SHALL append the fixed `other` option to every question, append `other` to the `abandoned` of every verdict, current and in history, write the sidecar at the current shape, and re-render its body.

### 5.18 Written and committed without a prompt

WHEN the writer's answer passes every check THE system SHALL write the sidecar, re-render the artifact, and re-seed a plan's extraction cache, keeping its lineage. It SHALL then commit exactly the paths it wrote in one commit, without asking for confirmation.

### 5.19 Deciding never approves

The system SHALL leave the artifact Draft after verdicts mode, whatever the file says, and SHALL never approve it as part of a decide.

### 5.20 A report to read before approving

WHEN verdicts mode commits THE system SHALL print the following, then the commit and the artifact's Draft status with the approve command:
- each given verdict's question id;
- its chosen option;
- whether it follows or departs from the recommendation;
- its why;
- its revised sections;
- each question left open;
- the rendered body diff.

### 5.21 Machine-readable report

WHERE `--json` is given THE system SHALL print the report as one JSON object on stdout and nothing else there, sending progress and warnings to stderr.

### 5.22 The commit says where the verdicts came from

The system SHALL give the verdicts-mode commit trailers naming the verdicts' arbiter, the verdicts-file channel, and the decision id.

### 5.23 Operator verdicts

WHEN `--by operator` is given, or no `--by` is given and the command runs from a terminal, THE system SHALL attribute each given verdict to the operator, named by the committing git identity.

### 5.24 A machine is refused

IF `--by machine:<grant>` is given in verdicts mode THEN the system SHALL refuse with exit 12 before any session, stating that a verdict always comes from the operator and naming `--by operator`, and write nothing.

### 5.25 No terminal, no guessed arbiter

IF verdicts mode runs without `--by` and not from a terminal THEN the system SHALL refuse with exit 12 before any session, naming `--by operator`.

### 5.26 Hand-authored artifacts

WHEN verdicts mode runs on a hand-authored artifact whose §9 parses THE system SHALL have the writer return a hand decision answer, and SHALL write the decided question blocks, their Decision blocks and the decision-log entries in place, as interactive decide does.

### 5.27 Rate and usage limits

IF the writer session ends on a provider rate or usage limit THEN the system SHALL fail in the rate-limit exit family (8) with nothing written.

### 5.28 Artifact changed during the session

IF the artifact or its sidecar changed while the writer session ran THEN the system SHALL refuse with exit 12 to write the verdicts, leaving the change in place and committing nothing.

### 5.29 Commit failure

IF the verdicts-mode commit fails THEN the system SHALL report an artifact error with exit 12 and leave the written files uncommitted.

### 5.30 Decision record

WHEN a writer session ends after spawning and records are enabled THE system SHALL write a decision record. Its manifest SHALL be stamped with its format's shape and say mode `verdicts`. The record SHALL carry: the verdicts file as given, the prompt, the doctrine sources, the landed document, the body diff, the counts arbitrated and departed, provider, model, effort and usage, the outcome (committed or failed), and the commit when there is one.

## 6. Surface

### cli: phax artifact decide --verdicts — normative

before:

    phax artifact decide <artifact> [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>]

    ✗ decide refused: no terminal — phax artifact decide is interactive only
    $? = 12

after:

    phax artifact decide <artifact> [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>]          # interactive, unchanged
    phax artifact decide <artifact> --verdicts <file|-> [--by operator]
                         [--doctrine <file>] [--model <model>] [--effort <effort>] [--json]

    $ phax artifact decide docs/specs/2610201015-log-rotation.md --verdicts verdicts.json --by operator
    decide spec log-rotation — verdicts from verdicts.json: q-keep, q-scope — headless, resumed authoring session
    model      claude-sonnet-5-5 / medium (built-in default) on claude-code
    q-keep     keep-20   departs from keep-10 — revised: §5.2, §6 rotate output, AC keep bound
               why: Twenty runs cover one release cycle; ten dropped the previous release's runs.
    q-scope    per-run   (recommended)
               why: One log per run is what a bug report attaches.
    q-names    open      (not in the verdicts file)
    --- a/docs/specs/2610201015-log-rotation.md
    +++ b/docs/specs/2610201015-log-rotation.md
    @@ -41,7 +41,7 @@
    -WHEN a rotation runs THE system SHALL keep the 10 most recent run logs.
    +WHEN a rotation runs THE system SHALL keep the 20 most recent run logs.
    …
    commit     c4d5e6f — docs(specs): decide log-rotation q-keep, q-scope
    status     Draft — read the verdicts and the diff above, then `phax artifact approve docs/specs/2610201015-log-rotation.md`
    $? = 0

    ✗ decide refused: verdicts.json chooses keep-30 for q-keep — its options: keep-10, keep-20, other
    $? = 12
    ✗ decide refused: verdicts.json departs from q-keep's recommendation (keep-10) with a null note — write the reason in "note"
    $? = 12
    ✗ decide refused: verdicts.json chooses other for q-names with a null note — describe the choice in "note"
    $? = 12
    ✗ decide refused: verdicts.json is for docs/specs/2610190900-cache-keys.md, not docs/specs/2610201015-log-rotation.md
    $? = 12
    ✗ decide refused: no terminal and no --by — pass `--by operator`: a verdict always comes from the operator
    $? = 12
    ✗ decide refused: --by machine:roadmap-loop — a verdict always comes from the operator; pass `--by operator`
    $? = 12
    ✗ decide refused: --question and --verdicts are exclusive — the verdicts file names the questions
    $? = 12

    Exit: 0  decided and committed (the artifact stays Draft)
          1  inside a phase worktree (the phase guard)
          5  writer answer refused after one corrective resume
          8  provider rate or usage limit
          12 refusal before the session (verdicts file, artifact, flags, --by, doctrine, model), artifact changed during the session, commit failed

    # normative: `--verdicts <file|->` (- reads stdin), `--by operator` as the only `--by` value, the refusal of `--by machine:<grant>`, the
    # no-terminal refusal, `--json`, no prompt in this mode, the exit families, the artifact left Draft, and a report that lists each verdict
    # (chosen, follows/departs, why, revised), the questions left open and the body diff. Layout, wording and the commit subject are indicative.

### file: verdicts file (given as --verdicts <file|->) — normative

    {
      "$schema": "https://docs.phax.run/schemas/decide-verdicts/0.26.0.json",
      "artifact": "docs/specs/2610201015-log-rotation.md",
      "verdicts": [
        { "question": "q-keep",  "chosen": "keep-20", "note": "Twenty runs cover one release cycle; ten dropped the previous release's runs." },
        { "question": "q-scope", "chosen": "per-run", "note": null },
        { "question": "q-names", "chosen": "other",   "note": "Name each log by run id and phase, never by date." }
      ]
    }

    # normative: the keys artifact, verdicts, question, chosen, note; every key required; chosen is one of the question's listed option ids,
    # `other` included; note a non-empty string or null (null refused on a departing verdict, and so always on `other`, §9 q-note);
    # verdicts non-empty, one entry per question; unknown keys rejected at any level; born with $schema.
    # The same file decides a plan's questions; the writer names a plan verdict's phase and phax checks it.
    # indicative: the format id `decide-verdicts`; 0.26.0 stands for the release that ships this spec.

### file: docs/specs/<stamp>-<slug>.json question options, and the rendered §9 — normative

before:

    "options": [
      { "id": "by-date", "label": "Name each log by its date", "abandons": "…" },
      { "id": "by-run",  "label": "Name each log by its run id", "abandons": "…" } ],
    "recommendation": "by-date"

    ### q-names — How are run logs named?

    - by-date — Name each log by its date — abandons: …
    - by-run — Name each log by its run id — abandons: …

    Recommendation: by-date — …

after:

    "options": [
      { "id": "by-date", "label": "Name each log by its date", "abandons": "…" },
      { "id": "by-run",  "label": "Name each log by its run id", "abandons": "…" },
      { "id": "other",   "label": "Another choice, described in the note",
        "abandons": "an argued option: the choice exists only in the note, with no loss named in advance" } ],
    "recommendation": "by-date"

    ### q-names — How are run logs named?

    - by-date — Name each log by its date — abandons: …
    - by-run — Name each log by its run id — abandons: …
    - other — Another choice, described in the note — abandons: an argued option: the choice exists only in the note, with no loss named in advance

    Recommendation: by-date — …

    Decision: other — by operator (Ada Lovelace), 2026-10-20
    Why: Name each log by run id and phase, never by date. …

    # normative: every question of a spec or plan (open or arbitrated, sidecar or hand-authored §9, plans in their preamble) lists `other`
    # exactly once, as its last option, with the label and loss phax fixes, the same text for every question and checked verbatim; `other` is
    # never the recommendation; a verdict choosing it abandons every other listed option, and its why is the note. The fixed English wording is
    # indicative until the plan pins it. A new spec-document and plan-document shape: older live sidecars are lifted by migrate-documents.

### cli: phax artifact schema verdicts — indicative

before:

    phax artifact schema spec|plan

after:

    phax artifact schema spec|plan|verdicts

    $ phax artifact schema verdicts
    { "$schema": "http://json-schema.org/draft-07/schema#", "title": "phax decide verdicts", "type": "object",
      "required": ["$schema", "artifact", "verdicts"], … }

    # the verdicts format's JSON Schema, also published under https://docs.phax.run/schemas/ like every phax format

### cli: phax artifact decide --verdicts --json — indicative

    $ phax artifact decide docs/specs/2610201015-log-rotation.md --verdicts - --by operator --json < verdicts.json
    { "artifact": "docs/specs/2610201015-log-rotation.md", "status": "Draft",
      "session": "resumed-authoring", "provider": "claude-code", "model": "claude-sonnet-5-5", "effort": "medium",
      "verdicts": [
        { "question": "q-keep", "chosen": "keep-20", "recommendation": "keep-10", "departs": true,
          "why": "Twenty runs cover one release cycle; ten dropped the previous release's runs.",
          "revised": ["§5.2", "§6 rotate output", "AC keep bound"], "by": { "kind": "operator", "name": "Ada Lovelace" } },
        { "question": "q-scope", "chosen": "per-run", "recommendation": "per-run", "departs": false,
          "why": "One log per run is what a bug report attaches.", "revised": [], "by": { "kind": "operator", "name": "Ada Lovelace" } } ],
      "open": ["q-names"],
      "diff": "--- a/docs/specs/2610201015-log-rotation.md\n+++ …",
      "commit": { "hash": "c4d5e6f…", "subject": "docs(specs): decide log-rotation q-keep, q-scope" },
      "decisionId": "2610201015-log-rotation/03" }

    # one object on stdout, nothing else there; key spelling indicative; its content is the human report's (normative per r-report)

### cli: the decide commit (git log) — indicative

before:

    docs(specs): decide log-rotation q-keep

    Decided in an interactive session (claude-opus-5-5 / high).

    Artifact: docs/specs/2610201015-log-rotation.md
    Decided-By: operator (Ada Lovelace)
    Decision-Id: 2610201015-log-rotation/02

after:

    docs(specs): decide log-rotation q-keep, q-scope

    Decided from a verdicts file, transcribed in a headless session (claude-sonnet-5-5 / medium on claude-code).

    Artifact: docs/specs/2610201015-log-rotation.md
    Decided-By: operator (Ada Lovelace)
    Decided-Via: verdicts
    Decision-Id: 2610201015-log-rotation/03

    # normative per r-commit-trailer: trailers naming the operator, the verdicts channel and the decision id; spelling indicative

### file: decision record on phax/records/v1 — indicative

before:

    decision/<stamp>-<slug>/<NN>/record.json   { "$schema": "…/decision-record-manifest/0.25.0.json", kind: "decision", mode: "interactive",
                                                 outcome: "committed" | "declined" | "undecided" | "failed", … }

after:

    decision/2610201015-log-rotation/03/
      record.json   { "$schema": "https://docs.phax.run/schemas/decision-record-manifest/0.26.0.json", kind: "decision",
                      mode: "verdicts", session: "new" | "resumed-authoring", questions: ["q-keep", "q-scope"],
                      arbitrated: 2, departed: 1, provider: "claude-code", model, effort, usage,
                      outcome: "committed" | "failed", commit: "…" | null, … }
      verdicts.json  prompt.md  document.json  body.diff  output.jsonl

    # per-variant: mode interactive keeps committed | declined | undecided | failed; mode verdicts admits committed | failed only.
    # Resolved by `phax records explain <sha>`. That the record exists with these facts is normative (r-record); the layout is indicative.

## 7. Non-goals

- The doctrine's `headless` and `headless total` modes, in which an agent chooses an option or escalates. Verdicts mode transcribes a person's choices, and those modes stay unspecified.
- A checker session run by phax to judge the transcription. The caller reads the report and the diff; a mistake is undone with `phax artifact reopen` and decide `--question` (interactive) or another verdicts file.
- Approving as part of deciding. There is no `--approve`, and verdicts mode never touches approval records.
- Changing interactive decide: its framing questions, its diff confirmation, its Claude Code-only model and its operator attribution stay as shipped.
- Recording a relaying machine in a verdict: a verdict always comes from the operator, a loop relaying a person's instruction runs with `--by operator`, and a verdict's `by` keeps its shape.
- Turning an `other` verdict into a new option of its question, or editing a question's wording or options from a verdicts file: `other` stays `other`, and its note is the only description of the choice.
- A shorthand such as "every other question as recommended": each decided question is written out (subject to §9 q-unnamed).
- Turning steering text (`rouvre q-keep`, a chat message) into a verdicts file. That is the caller's job.
- Deciding several artifacts in one call.
- Framing questions F1–F5 in verdicts mode: nobody is present to answer them.
- A phax.json key for the verdicts model and effort (subject to §9 q-model).
- Lifting or migrating any document or record written before this change beyond what the shape changes in §6 require.

## 8. Acceptance criteria

### Verdicts land headless and the artifact stays Draft

Given a headless-authored Draft spec with open questions q-keep (recommends keep-10), q-scope (recommends per-run) and q-names, and a verdicts file naming q-keep → keep-10 with note null and q-scope → per-run with a note, when `phax artifact decide <spec> --verdicts verdicts.json --by operator` runs with stdin not a terminal, then It exits 0 without prompting. q-keep and q-scope are in `arbitratedQuestions` with the chosen options given. q-keep's `why` is its rationale verbatim and q-scope's is the note verbatim; both are attributed to the operator by the git user.name. q-names is still open, and the spec is still Draft. The new HEAD commit holds exactly the spec and its sidecar, with the arbiter, `verdicts` channel and Decision-Id trailers. The output lists both verdicts as recommended with their why, lists q-names as open, and prints the body diff and the commit. (refs §5.1, §5.2, §5.9, §5.14, §5.18, §5.19, §5.20, §5.22, §5.23)

### A departing verdict revises the body

Given a Draft spec whose q-keep recommends keep-10, with a requirement and an acceptance criterion written for keep-10, and a verdicts file choosing keep-20 with a note, when verdicts mode runs, then The committed sidecar holds q-keep with `chosen: keep-20`, `why` equal to the note, a non-empty `revised` naming the requirement and the criterion, and both rewritten for keep-20 with traceability intact. The report marks q-keep as departing from keep-10 and the diff shows the rewritten requirement. (refs §5.13, §5.14, §5.20)

### Choosing other applies the note, and nothing else is written

Given a Draft spec whose q-names lists by-date, by-run and other, recommends by-date, and has a requirement written for by-date; and verdicts files choosing, respectively, other for q-names with the note "Name each log by run id and phase, never by date.", and other for q-names with a null note; and a writer answer that adds an option run-phase to q-names and chooses it, when verdicts mode runs with each file, then The first lands q-names with `chosen: other`, `abandoned` holding by-date and by-run, `why` equal to the note verbatim, a non-empty `revised`, and the requirement rewritten for naming by run id and phase; q-names' options are unchanged. The null-note file exits 12 naming q-names before any session. The run whose writer adds run-phase resumes the session once, then exits 5 naming q-names' options, writing nothing. (refs §5.5, §5.13, §5.14, §5.15)

### Every question must list other

Given an authoring session returning a spec whose question q-a lists no `other`; one returning a question that recommends `other`; one returning an `other` option with a label other than the fixed one; and a hand-authored Draft spec whose §9 question Q1 has no `- other —` bullet, when each authoring session ends, and `phax artifact approve` and `phax artifact decide --verdicts` run on the hand-authored spec, then Each authoring run exits 5 naming the question and writes nothing. Approve and decide on the hand-authored spec exit 12 naming Q1's lines as departing from the §9 format, with no session spawned. (refs §5.16)

### Older documents gain other once

Given a live Draft spec whose sidecar is stamped at the spec-document shape before `other`, with open q-a (options a1, a2) and arbitrated q-b whose verdict chose b1 and whose history holds one earlier verdict, and a live Draft plan stamped at the plan-document shape before `other` with one open question, when `phax artifact migrate-documents` runs, then Both sidecars are written at the current shape. Every question lists the fixed `other` as its last option. q-b's verdict and its history verdict each end their `abandoned` with `other`. Both bodies are re-rendered with the `- other —` bullets, and the commit holds exactly the rewritten paths. `phax artifact status` then reads both in sync. (refs §5.17)

### A wrong transcription lands nothing

Given records enabled, and writer sessions that answer, respectively: q-keep with keep-10 when the file gave keep-20; a document that also moves q-names, which the file does not name; a document that edits §5 while every given verdict follows its recommendation; and a verdict citing `S12`, when each session ends and its corrective resume returns the same violation, then Each run resumes the session once, then exits 5 naming the violating path. The working tree and HEAD are unchanged, and a decision record with mode `verdicts` and outcome `failed` exists. (refs §5.15, §5.30)

### A malformed verdicts file is refused before any session

Given verdicts files that, respectively: are not JSON, have no `$schema`, are stamped `spec-document`, carry an extra key `reason`, have an empty `verdicts` list, and omit `note` on one verdict, when verdicts mode runs with each, then Each exits 12 naming the `$schema` read or the first violating path. No session is spawned, and nothing is written or committed. (refs §5.3, §5.2)

### A file that does not fit the artifact is refused

Given a Draft spec with q-keep (options keep-10, keep-20, other; recommends keep-10), and verdicts files that, respectively: name another spec's path, name q-nine, name q-keep twice, choose keep-30, and choose keep-20 with a null note, when verdicts mode runs with each, then Each exits 12 before any session. The messages name, in turn: both paths; the artifact's question ids; the duplicate; q-keep's option ids; and q-keep with its recommendation. Nothing is written. (refs §5.4, §5.5)

### Today's refusals apply and no terminal is needed

Given an Approved spec, a spec with a diverged sidecar, a Draft spec with an uncommitted change, a repository with no git user.name, and a phase worktree of a running plan, when verdicts mode runs with a valid file and `--by operator` on each, from a script with no terminal, then The first four exit 12 with interactive decide's refusals (the Approved one naming `phax artifact reopen`). The worktree run exits 1 with the phase guard's refusal. No run spawns a session or writes anything, and none is refused for lacking a terminal. (refs §5.6, §5.7)

### Flags belong to one mode

Given a Draft spec with open questions, when decide runs with `--verdicts verdicts.json --question q-keep`, then with `--json` and no `--verdicts`, then with `--by operator` and no `--verdicts`, then Each exits 12 naming the conflicting flags. No session is spawned. (refs §5.8)

### Naming an arbitrated question re-arbitrates it

Given a Draft spec whose q-keep is arbitrated with keep-10 by an operator verdict, and a verdicts file choosing keep-20 for q-keep with a note, when verdicts mode runs, then q-keep's verdict chooses keep-20, and its history ends with the previous keep-10 verdict unchanged. The other questions are byte-identical in the sidecar. (refs §5.10, §5.9)

### A verdict always comes from the operator

Given a Draft spec and a valid verdicts file, when verdicts mode runs with `--by machine:roadmap-loop` and no terminal; separately, with `--by operator` and no terminal; separately, from a terminal with no `--by`; separately, with no `--by` and no terminal, then The first exits 12, stating that a verdict always comes from the operator and naming `--by operator`, with no session spawned and nothing written. The second and third record each verdict with `by: { kind: operator, name: <git user.name> }`, and `by` keeps its current shape. The fourth exits 12 naming `--by operator`, with no session spawned. (refs §5.24, §5.23, §5.25)

### The kept session is resumed only on its own provider

Given a headless-authored Draft spec whose kept authoring session ran on claude-code in this checkout, when verdicts mode runs without `--model`, then again (after reopening and re-deciding) with `--model gpt-6-luna --effort medium`, then The first resumes the kept authoring session, prints `resumed authoring session` and `claude-sonnet-5-5 / medium (built-in default) on claude-code`, and loads `phax-decide-spec`. The second starts a new session on the provider routing resolves for gpt-6-luna and prints `new session` with that provider. (refs §5.11, §5.12)

### A plan is decided and stays executable

Given a headless Draft plan whose preamble holds open questions Q1 and Q2, and a verdicts file naming Q1, when verdicts mode runs, then The session loads `phax-decide-plan`. Q1 lands with a `phase` that names one of the plan's phases, and Q2 stays open. The plan passes `phax plans lint`, `phax run` finds its projection without an extraction session, and its lineage in sidecar and frontmatter is unchanged. (refs §5.18, §5.11)

### Hand-authored artifacts are decided in place

Given a Draft spec with no sidecar whose §9 format holds open Q1 and Q2, and a verdicts file naming Q1, when verdicts mode runs, then Q1's block moves to the arbitrated section with its Decision block, one decision-log entry is added, Q2 stays open, and the new HEAD commit holds that file alone. (refs §5.26)

### The JSON report

Given a Draft spec and a valid verdicts file read from stdin, when `phax artifact decide <spec> --verdicts - --by operator --json` runs, then stdout parses as one JSON object holding the artifact, status Draft, each verdict's question, chosen, recommendation, departs, why, revised and by, the questions left open, the body diff, the commit and the decision id. Nothing else is on stdout. (refs §5.21, §5.20)

### A limit lands nothing

Given a writer session that ends on a provider usage limit, when verdicts mode runs, then It exits 8, and nothing is written or committed. (refs §5.27)

### A concurrent edit is left in place

Given a writer session during which the spec file is modified, when the session returns a valid answer, then The run exits 12, the modification is left in place, and no commit is made. (refs §5.28)

### A failed commit leaves the files

Given a valid writer answer and a commit that fails, when verdicts mode writes the artifact and its sidecar, then It exits 12, and both files are written but uncommitted. (refs §5.29)

### The record explains the transcription

Given records enabled and a verdicts-mode commit at `<sha>` that arbitrated two questions, one departing, when `phax records explain <sha>` runs, then It shows mode `verdicts`, the verdicts file as given, the prompt, the doctrine sources, the landed document, the body diff, `arbitrated: 2`, `departed: 1`, provider, model, effort, usage and outcome `committed`. (refs §5.30)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-note — Is the person's note required on every verdict?

- note-on-departure — `note` is a required key holding a string or null, and null is refused on a departing verdict — abandons: a bare file for departures: a person who departs must write one sentence, even when the reason seems obvious to them
- note-always — A non-empty note on every verdict — abandons: the one-line case the mode exists for: accepting a recommendation needs a sentence that restates its rationale
- note-free — `note` is a string or null on every verdict — abandons: the person's reason for a departure: the writer must invent the why of a choice the recommendation argued against

Recommendation: note-on-departure — A recommended choice already carries its reason: the question's rationale. A departure has no written reason except the person's, and E0 forbids the writer inventing one. The key stays required on every verdict, with null as the explicit "nothing to add", so the format has no optional key.

Decision: note-on-departure — by operator (Rémy Loubradou), 2026-10-19
Why: Adopted as recommended. A recommended choice already carries its reason: the question's rationale. A departure has no written reason except the person's, and E0 forbids the writer inventing one. Refusing a null note on a departure is a condition phax checks before any session. Advocate: The strongest case for note-free: a note is often an agent's paraphrase of what the person said, so forcing one on a departure can produce a confident-looking reason that is not the person's, where an honest null would say that nothing was recorded. Principles: S1, E0, C4. Reversibility: cheap. Revised: none.

### q-unnamed — What becomes of questions the verdicts file does not name?

- stay-open — They stay as they are: open stays open, arbitrated keeps its verdict — abandons: a one-gesture close: a person who wants every question decided must list each one, and an omitted one surfaces only in the report and when approve refuses
- all-required — The file must name every open question — abandons: deciding part of an artifact now and the rest later, which interactive decide allows with `--question`
- rest-recommended — A file-level switch decides every unnamed open question as recommended — abandons: a verdict written per question: questions nobody named would be recorded as decided by the person (E0)

Recommendation: stay-open — This matches `--question`, which presents one question alone (C1). The safety stays a condition phax verifies (C4): approve refuses while a question is open. The report and `--json` list the questions left open, so the caller sees them before approving.

Decision: stay-open — by operator (Rémy Loubradou), 2026-10-19
Why: Adopted as recommended. Leaving unnamed questions as they are matches `--question` (C1); approve still refuses while a question is open (C4), and the report lists the questions left open. Every decided question is written out, so none is recorded as decided without being named (E0). Advocate: The strongest case for rest-recommended: "the recommendations, except one" is the most common case, and a file-level switch would state it in one line instead of listing every question. Principles: S1, C1, C4, E0. Reversibility: cheap. Revised: none.

### q-off-menu — May a verdict choose an option the question does not list, described in the note?

- refuse — `chosen` must name a listed option; the note can only refine how a listed option applies — abandons: a person's own answer: an option outside the menu has no path through decide, and the question itself must be re-authored
- own-option — A verdict may choose `own`; the writer adds it as a new option with its loss, then chooses it — abandons: the deterministic check that `chosen` names a listed option, and the rule that decide never edits a question's options; the new option and its loss would be authored by the writer, unchecked

Recommendation: refuse — The check that `chosen` is a listed option is what makes the transcription verifiable without a checker (C4). Interactive decide refuses unlisted options too (C1). An option outside the menu rewrites the question, which is a spec change, not a verdict. A precision on applying a listed option fits in the note.

Decision: own-option — by operator (Rémy Loubradou), 2026-10-19
Why: Not own-option as the spec formulated it: no option is written by the agent. Every question lists, written in its options, an option `other` whose label and loss phax fixes, and whose required note describes the choice. On output the check is: the choice is the given option, or `other`. Simpler, and verifiable. Advocate: The strongest case for refuse: with `other`, the writer applies to the body a choice nobody wrote as an option, with no loss named and no comparison with the others; only the caller's reading of the diff can check that the rewritten requirements, surface and criteria say what the note describes. Principles: C4, E0, C3. Reversibility: costly. Revised: §4 Terminology: Other added, §5 r-note: a verdict choosing other always departs, §5 r-writer: other applies the note's choice, §5 r-checks: chosen is the given option, other included; no option added, removed or changed, §5 r-other-required added, §5 r-other-lift added, §6 cli: phax artifact decide --verdicts refusals, §6 verdicts file: chosen may be other, §6 question options and rendered §9: the fixed other option, added, §7 Non-goals: other never becomes a new option, AC ac-other added, AC ac-other-required added, AC ac-other-lift added, AC ac-binding, AC ac-attribution, §10 settled, constraints: other, document shapes and migration.
Earlier decision: refuse — by operator (Rémy Loubradou), 2026-10-19

### q-why — Who writes a given verdict's `why`?

- phax-sets-why — phax sets `why`: the note verbatim, or the question's rationale when the note is null — abandons: a why that reads as prose in context: a terse note becomes the recorded reason exactly as typed
- writer-writes-why — The writer writes `why` from the note or the rationale — abandons: a why guaranteed to be the person's: a paraphrase can shift the reason, and only the caller's reading would catch it

Recommendation: phax-sets-why — The why is the one field that states the person's decision, so making it the person's words verbatim is a condition phax guarantees (C4), not something the caller must check by reading. phax already sets `by` and `at` the same way. What the writer still writes (advocate, principles, reversibility, body revisions) is what the report and diff put in front of the caller.

Decision: phax-sets-why — by operator (Rémy Loubradou), 2026-10-19
Why: Adopted as recommended. The why states the person's decision, so phax copying the note verbatim (or the rationale when the note is null) is a condition it guarantees (C4), as it already sets `by` and `at`, rather than something the caller must check by reading (E0). Advocate: The strongest case for writer-writes-why: a terse note becomes the permanent recorded reason exactly as typed, where the writer could turn it into a why that reads in context. Principles: S1, C4, E0. Reversibility: cheap. Revised: none.

### q-by — How is a verdict given through a file attributed?

- operator-only — Always the operator, by the committing git identity; no `--by`; the channel shows only in the commit trailer and the record — abandons: an honest arbiter without a terminal: a loop committing under someone's git identity is recorded as that person, the guess approve has refused since its Q3
- operator-declared — `--by operator` is required without a terminal and machine is refused, so a verdict is always the operator's — abandons: any trace of the relaying machine in the document: a loop must declare itself the operator, and its grant appears nowhere in the verdict
- relayed — `--by operator | machine:<grant>`, required without a terminal; machine records `by: { kind: relayed, grant }`, naming no person — abandons: unchanged document shapes: spec-document, plan-document and hand-decision-answer gain a verdict variant. Unless that rides the shape still unreleased at the next cut, every live sidecar must pass `phax artifact migrate-documents` again

Recommendation: relayed — Choosing `relayed` keeps attribution explicit (E0) and consistent with how approve and reopen take `--by` (C1). A loop never records itself as a person, and a person is never named by a guess. `relayed` is not the doctrine's machine-decides mode: it says a machine carried a decision, not that a machine made it. The shape change is the accepted loss: a union widening that the release cut records, costing at most one known migrate gesture.

Decision: operator-declared — by operator (Rémy Loubradou), 2026-10-19
Why: A verdict always comes from the operator. Without a terminal, `--by operator` is required and `--by machine:…` is refused. The sidecar format does not change. Advocate: The strongest case for relayed: a loop like the steme conductor must now declare itself the operator, so nothing in the document, the commit or the record says a machine carried the verdict, while with auto-migrate the shape change would have cost almost nothing. Principles: E0, C1, C2, S3. Reversibility: cheap. Revised: §4 Terminology: Relayed verdict removed, §5 r-by-machine: a machine is refused, §5 r-by-required: names --by operator only, §6 cli: phax artifact decide --verdicts, §6 decided verdict `by` element removed, §6 the decide commit, §7 Non-goals: no relaying machine in a verdict, AC ac-attribution, §10 constraints: enums and changed formats.
Earlier decision: relayed — by operator (Rémy Loubradou), 2026-10-19

### q-provider — Does the writer session go through model routing, or run on Claude Code only like interactive decide?

- routed — Routed like headless authoring: any provider the catalog maps; the kept session is resumed only on its own provider — abandons: one provider rule for one command: interactive decide stays Claude Code only while its verdicts mode runs anywhere
- claude-only — Claude Code only, like interactive decide — abandons: callers on Codex or Vibe: a loop on another provider cannot apply verdicts at all

Recommendation: routed — The writer is a headless JSON-answer session, the kind authoring already routes (C1 with the session it most resembles). Interactive decide is Claude-only because of its terminal session, which verdicts mode does not have. `session.json` already records the authoring provider, so resuming on the same provider is a check, not a guess.

Decision: routed — by operator (Rémy Loubradou), 2026-10-19
Why: Adopted as recommended. The writer is a headless JSON-answer session, the kind authoring already routes (C1). Interactive decide is Claude-only because of its terminal session, which verdicts mode does not have, and `session.json` records the authoring provider, so resuming on the same provider is a check. Advocate: The strongest case for claude-only: one command keeps one provider rule, the same as interactive decide. Principles: S1, C1. Reversibility: cheap. Revised: none.

### q-model — What are the writer's default model and effort, and is there a phax.json key?

- own-default — `--model`/`--effort`, else a built-in claude-sonnet-5-5 / medium; no phax.json key — abandons: a project-wide setting: a project on another provider passes `--model` on every call
- follow-authoring — `--model`/`--effort`, else phax.json `authoring.spec|plan`, else claude-opus-5-5 / high — abandons: the cheaper default: every transcription is priced as authoring a whole spec
- own-key — `--model`/`--effort`, else a new phax.json `decide.verdicts`, else claude-sonnet-5-5 / medium — abandons: an unchanged config surface: a new key, which artifact-decide deliberately did not add

Recommendation: own-default — Transcribing given verdicts and revising the body they imply needs less judgment than authoring or interactive facilitation. Following the catalog on cost, it takes the tier compliance review already defaults to: claude-sonnet-5-5, at medium effort. No key matches interactive decide (C1). A loop scripts its flags once, and a key can be added later without breaking anything.

Decision: own-default — by operator (Rémy Loubradou), 2026-10-19
Why: Adopted as recommended. Transcription needs less judgment than authoring, so the default follows the catalog on cost: claude-sonnet-5-5 / medium, the tier compliance review uses. No phax.json key, as interactive decide has none (C1); an output or config surface is added only for a named reader (S5), and a key can be added later without breaking anything. Advocate: The strongest case for own-key: a project on Codex or Vibe would set its writer model once in phax.json instead of passing --model on every call. Principles: S1, C1, S5. Reversibility: cheap. Revised: none.

### q-hand — Does verdicts mode decide hand-authored artifacts (no sidecar)?

- both — Yes: the writer returns a hand decision answer and phax writes the blocks in place, as interactive decide does — abandons: a single answer form for the new mode: its checks and writer prompt cover the hand decision answer too
- sidecar-only — No: refuse a hand-authored artifact with exit 12, naming interactive decide — abandons: applying verdicts without a terminal to a hand-authored spec or plan: those callers stay blocked

Recommendation: both — Interactive decide already reads both forms, and approve's open-question lock covers both (C1). The mode should be total on the artifacts decide accepts (S5). The hand-answer checks and the in-place writer exist, so the mode reuses them.

Decision: both — by operator (Rémy Loubradou), 2026-10-19
Why: Adopted as recommended. Interactive decide already reads both forms, and approve's open-question lock covers both (C1). The mode stays total on the artifacts decide accepts (S5), reusing the existing hand-answer checks and in-place writer. Advocate: The strongest case for sidecar-only: the new mode stays smaller, with one answer form to prompt for and check. Principles: S1, C1, S5. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- Decided by the author on 2026-10-19: the mode lives in phax as a mode of `phax artifact decide`; the person decides and the writer only transcribes (it is not the doctrine's headless mode); a departing verdict still revises the body, so a writer session is needed; phax runs no checker session; deciding never approves, so the artifact stays Draft.
- Refusals happen before any session and write nothing. They cover: a verdicts file that is malformed or refused by its `$schema`, one naming another artifact, an unknown or duplicate question, an unlisted option, every refusal interactive decide makes, and the phase guard (exit 1). No terminal is required.
- The writer composes the existing decide machinery: doctrine resolution (bundled or project skill, plus `--doctrine`), kept-session resume, the handback document form at the current shape, today's revision and hand-answer checks, one corrective resume, the plan cache re-seed, the path-scoped commit and the decision record. It adds the checks of r-checks, and phax sets `why`, `by` and `at`.
- The writer prompt carries the given verdicts and no framing questions. A plan verdict's `phase` is written by the writer and checked against the plan's phases, as today.
- Exit families follow interactive decide: 0 committed, 1 phase guard, 5 refused answer after the corrective resume, 8 limits, 12 refusals. The only files left written on failure are those of a failed commit, as today.
- The requirements are written for the §9 recommendations. Where the author decides otherwise, the plan follows the decision: r-note follows q-note, r-unnamed q-unnamed, r-why q-why, r-by-* q-by, r-session and r-model q-provider and q-model, r-hand q-hand.
- q-off-menu (decided 2026-10-19): every question of a spec or plan lists a written `other` option whose label and loss phax fixes, never recommended. A verdict choosing `other` carries the required note that describes the choice, and its why is that note. The output check is that `chosen` is the given option, `other` included. No session ever writes a new option.

Left open:

- The eight §9 questions: q-note, q-unnamed, q-off-menu, q-why, q-by, q-provider, q-model, q-hand.
- Left to the plan, as §6 marks indicative: the format id and `$schema` URL of the verdicts file, the `phax artifact schema` argument, the report layout and `--json` key spelling, the commit subject and trailer spelling, and the decision record layout.

Constraints:

- No back-compat shims in persisted schemas. The verdicts format is born with `$schema` and every key required. New record variants are required fields of their variant, never optional fields.
- Use explicit per-variant enums. The decision record's `mode` is interactive | verdicts, and each mode carries its own outcome set (interactive: committed | declined | undecided | failed; verdicts: committed | failed).
- Each changed format (the verdicts format is new; decision-record-manifest; spec-document and plan-document, whose questions now list the fixed `other` option) is recorded as a `next` snapshot and released by the cut. A verdict's `by` stays { kind: operator, name } (q-by), and hand-decision-answer does not change. Tests must hold across a release cut, so they name current-shape URLs through the release table, never a hard-coded release.
- The `other` rule is a new document shape, never read leniently. Older live sidecars are lifted once by `phax artifact migrate-documents` (run at use under the auto-migrate decision of 2026-10-19): `other` is appended to every question and to every verdict's `abandoned`, history included. Hand-authored §9 sections are converted once by hand. The authoring answer's JSON Schema and prompt carry the fixed `other` option, and the phax-spec and phax-planning skills state it.
- Respect the layers. Reading the verdicts file and stdin goes through ports, and decoding happens at the boundary through an Effect Schema. Matching verdicts to questions and every transcription check are pure domain functions. The CLI command parses, calls one use case and renders.
- Interactive decide's behavior, prompt, model rule and attribution are unchanged, apart from presenting `other` as one of each question's listed options.
- Verdicts mode never writes approval records or the `approved` stamp.
- `artifact decide` stays classified `refused` by the phase guard in both modes.
- Every example and test fixture is made up.

## 11. Docs page

Page: docs/arbitration.md

Reader: A person who already knows their verdicts, or the agent or loop applying them for that person, who wants them recorded without an interactive session and needs to know what to read before approving.

Example: cat > verdicts.json <<'EOF'
{ "$schema": "https://docs.phax.run/schemas/decide-verdicts/0.26.0.json",
  "artifact": "docs/specs/2610201015-log-rotation.md",
  "verdicts": [ { "question": "q-keep", "chosen": "keep-20", "note": "Twenty runs cover one release cycle." },
                { "question": "q-scope", "chosen": "per-run", "note": null } ] }
EOF
phax artifact decide docs/specs/2610201015-log-rotation.md --verdicts verdicts.json --by operator
# read the verdicts and the body diff it prints, then:
phax artifact approve docs/specs/2610201015-log-rotation.md --by operator

## 12. Decision log

- 2026-10-19 q-note decided note-on-departure — operator (Rémy Loubradou)
- 2026-10-19 q-unnamed decided stay-open — operator (Rémy Loubradou)
- 2026-10-19 q-off-menu decided refuse — operator (Rémy Loubradou)
- 2026-10-19 q-off-menu decided own-option — operator (Rémy Loubradou) — revised 16 sections
- 2026-10-19 q-why decided phax-sets-why — operator (Rémy Loubradou)
- 2026-10-19 q-by decided relayed — operator (Rémy Loubradou)
- 2026-10-19 q-by decided operator-declared — operator (Rémy Loubradou) — revised 9 sections
- 2026-10-19 q-provider decided routed — operator (Rémy Loubradou)
- 2026-10-19 q-model decided own-default — operator (Rémy Loubradou)
- 2026-10-19 q-hand decided both — operator (Rémy Loubradou)
