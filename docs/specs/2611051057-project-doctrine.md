---
status: Draft
date: 2026-11-05
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Project doctrine: phax's base practice and the project's own taste

## 1. Context

phax bundles two doctrine skills, phax-decide-spec and phax-decide-plan, shipped through the skill catalog. A decide session loads one of them: the project's copy at .claude/skills/<name>/SKILL.md when there is one, else the bundled text. It then appends the free-form `--doctrine <file>` text when that flag is given. A verdict may cite any id that opens a list item in that text (S1, P4, …). The decision record lists each doctrine source with a sha256 fingerprint, and sourceSha names HEAD when the session started.

Only two prompts carry the doctrine: the interactive decide session, and the verdicts writer, which transcribes choices a person already made and adds the advocate, principles and reversibility. Headless authoring is where questions, options and recommendations are written, and it loads only phax-spec or phax-planning. So a recommendation is made without the doctrine, and nothing says which principle it rests on.

The bundled skills mix two kinds of rules. Some are practice that any project would follow: frame an option by the loss it abandons; argue for the abandoned option first (S0); nothing destructive without a separate gesture (S7); dissolve contradictions (S8); classify, then escalate surface changes and reversals (S9/P1); a fix stays inside the run's footprint (P4); inside-out to implement, outside-in to verify (P8); amend, don't drift (P9). Others are one author's taste at one time: the five pairs C1–C5 and their precedence, S2–S6, S10, P2, P3, P5–P7, and 'before 1.0 there is no stability contract: break freely'. The operator's other rules sit where no phax session reads them: the project's CLAUDE.md ('no back-compat shims in persisted schemas', 'prefer explicit per-variant enums') and an assistant's private memory ('runs stay autonomous', 'ship the minimal slice when questions pile up').

Ground read:

- `src/app/resolveDoctrine.ts` — A decide session's doctrine is the project copy .claude/skills/<name>/SKILL.md when it exists, else the bundled skill, then the --doctrine file appended.
- `src/domain/decide/doctrine.ts` — Citable principle ids are backticked ids opening list items; a --doctrine file must define at least one id and may not redefine a skill id; each source carries a sha256 fingerprint.
- `.claude/skills/phax-decide-spec/SKILL.md` — Mixes practice (S0, S7, S8, S9, the three modes, the verdict shape) with taste (E0, C1–C5 and their precedence, S1–S6, S10, 'before 1.0 break freely').
- `.claude/skills/phax-decide-plan/SKILL.md` — P1–P9: P1, P4, P8, P9 read as practice; P2, P3, P5, P6, P7 as taste.
- `src/schemas/decisionRecord.ts` — The decision record manifest (decision-record-manifest, last bumped 0.30.0) records doctrine: [{kind: skill, name, source, fingerprint} | {kind: file, path, fingerprint}] and sourceSha.
- `src/app/authorArtifact.ts` — Headless authoring loads only the phax-spec or phax-planning skill text: recommendations are written without any doctrine.
- `package.json` — phax is at 0.34.0; this change ships in 0.35.0.

## 2. Problem

Taste ships to every phax user as if it were practice. A project cannot say 'this rule is ours' or 'this rule changed'. Its options today are to replace a whole bundled skill with a copy, which forks practice along with taste and silently drifts from future phax releases, or to append a free-form `--doctrine` file. That file has no structure and no history, and only decide reads it.

The rules a project actually lives by are invisible to phax. Authoring sessions write recommendations with no doctrine at all. The operator cannot tell a recommendation that follows a known rule from one that is plain taste, so every question looks like it needs the same attention.

Taste also expires. 'No back-compat shims' holds while a project is before 1.0 and is retired the day 1.0 signs a stability contract. Today nothing records when a rule held, so a past decision cannot be read against the rules that were in force when it was taken. Editing the rule text rewrites, in effect, what old decisions rested on.

## 3. Product goal

Split phax's arbitration doctrine into two layers. The first is a bundled base of software-engineering practice: the same in every project, not configurable, and shipped with phax. The second is the project's own doctrine of taste: a versioned JSON document in the repository that grows one decision at a time. Its entries are retired, never deleted, and every session that writes or decides a question reads it. Every recommendation and verdict names the ids it rests on, from either layer. A recommendation that rests on none is visibly a question of taste. Each decision records which project entries were in force when it was taken.

> Practice ships with phax, taste belongs to the project, and every decision names which rules it rested on at the time it was taken.

## 4. Terminology

- **base doctrine** — The practice entries phax bundles. They are the same in every project, they are not configurable, and phax releases version them.
- **project doctrine** — The project's versioned JSON document of taste entries, committed in its repository.
- **entry** — One project doctrine rule: a stable citable id, a statement, a reason, its adoption (date, who, origin) and, once retired, its retirement (date, who, why, replacing entry or none).
- **in force** — An entry adopted and not retired as of a given date or commit.
- **retired entry** — An entry that no longer applies. It stays in the document with its retirement, its id is never reused, and it cannot be cited by a new recommendation or verdict.
- **rests on** — The list of base or in-force project ids that an open question's recommendation relies on. The list may be empty.
- **question of taste** — An open question whose recommendation rests on no id. The operator's own judgment is what decides it.
- **proposal** — A candidate entry a decide session records from a departing verdict's note or from the operator answering 'this is a rule'. It is never an entry until the operator accepts it.

## 5. Functional requirements

### 5.1 Base doctrine is bundled and fixed

The system shall load the bundled base doctrine in every session that authors or decides a question, identically in every project, and no project file shall replace or extend it.

### 5.2 Base doctrine holds practice only

The bundled base doctrine shall contain only the practice entries that §9 settles as base, and no ranking of taste, no project-stage rule and no entry §9 settles as taste.

### 5.3 Project doctrine is decoded

WHERE the repository holds a project doctrine document THE system SHALL decode it against its `$schema` before any session reads it, and refuse an invalid document with a message naming the offending entry and field.

### 5.4 Entry ids are unique across both layers

IF a project doctrine entry's id repeats another entry's id or a base doctrine id THEN the system SHALL refuse the document, naming each colliding id.

### 5.5 No document, base only

WHILE the repository holds no project doctrine document THE system SHALL author and decide with the base doctrine alone and record no project source.

### 5.6 Adding an entry

WHEN the operator runs `phax doctrine add` THE system SHALL append an in-force entry with the next unused id, today's date, the committing identity, its statement, reason and origin, and commit exactly the project doctrine document.

### 5.7 Retiring an entry

WHEN the operator runs `phax doctrine retire <id>` THE system SHALL record the entry's retirement date, retiring identity and reason on the entry, keep the entry in the document, and commit exactly the project doctrine document.

### 5.8 Superseding an entry

WHEN the operator runs `phax doctrine supersede <id>` THE system SHALL, in one commit of exactly the project doctrine document, append the replacing entry and retire the named entry with the replacing entry's id.

### 5.9 Entries are never deleted

The system shall offer no command that removes an entry or reuses a retired entry's id.

### 5.10 Refusing an unknown or retired target

IF `phax doctrine retire` or `phax doctrine supersede` names an id that is unknown, belongs to the base doctrine or is already retired THEN the system SHALL refuse with a non-zero exit, name the id and its state, and write nothing.

### 5.11 Clean-file precondition

IF the project doctrine document has uncommitted changes when a `phax doctrine` verb would write it THEN the system SHALL refuse, name the file, and write nothing.

### 5.12 Listing entries over time

WHEN the operator runs `phax doctrine list` THE system SHALL show the entries in force now, or, with `--as-of <date|commit>`, those in force at that date or commit, and with `--all`, retired entries with their retirement too.

### 5.13 JSON answers

WHERE a `phax doctrine` verb is given `--json` THE system SHALL answer with a single JSON document carrying its `$schema`, under the command-contracts rules for exit codes and refusals.

### 5.14 Authoring reads both layers

WHEN a headless authoring session for a spec or plan starts THE system SHALL give it the base doctrine and the project entries in force, and the session's recommendations follow them.

### 5.15 Every decide mode reads both layers

WHEN an interactive or verdicts decide session starts THE system SHALL give it the base doctrine and the project entries in force.

### 5.16 Recommendations name what they rest on

The system shall require every open question in a spec or plan document to carry the list of ids its recommendation rests on. The list may be empty.

### 5.17 Only in-force ids are citable

IF an open question's rests-on list or a verdict's principles name an id that is neither a base id nor a project entry in force when the document is written THEN the system SHALL refuse the document, naming the id and whether it is unknown or retired.

### 5.18 Questions of taste are marked

WHEN the system renders an open question whose recommendation rests on no id THE system SHALL mark it as a question of taste.

### 5.19 Decisions record what was in force

WHEN a decide session writes its decision record THE system SHALL list among its doctrine sources the base doctrine with its phax version and fingerprint and, when a project doctrine exists, its path, fingerprint and the ids in force.

### 5.20 Past decisions keep their meaning

The system shall leave past decision records and past spec and plan sidecars as they are, byte for byte, and read them against the formats they were written in.

### 5.21 Proposals are recorded, not adopted

WHEN a departing verdict carries a note or the operator answers a question with 'this is a rule' THE system SHALL record a proposal in the decision record and leave the project doctrine document unchanged.

### 5.22 Accepting a proposal

WHEN the operator runs `phax doctrine add --from <decision-id>/<question-id>` THE system SHALL create the entry with that decision and question as its origin, and pre-fill its statement and reason from the proposal unless the operator gives them.

### 5.23 Old doctrine overrides are refused

IF `phax artifact decide` is given `--doctrine`, or the repository holds a project copy of a bundled decide skill, THEN the system SHALL refuse the session and name `phax doctrine add` as the way to record a project rule.

## 6. Surface

### file: docs/doctrine.json — indicative

Summary: A project keeps its own arbitration rules in one versioned file, and a retired rule stays readable with when, why and what replaced it.

    {
      "$schema": "https://docs.phax.run/schemas/project-doctrine/0.35.0.json",
      "entries": [
        { "id": "T1",
          "statement": "No back-compat shims in persisted formats: new fields are required.",
          "reason": "Before 1.0 there is no stability contract to keep.",
          "adopted": { "at": "2026-11-05", "by": "Ada Example", "from": { "kind": "hand" } },
          "retired": { "at": "2027-03-01", "by": "Ada Example",
                       "why": "1.0 signs the stability contract.", "supersededBy": "T4" } },
        { "id": "T4",
          "statement": "Persisted formats change only with a documented upgrade step.",
          "reason": "From 1.0 readers rely on the contract.",
          "adopted": { "at": "2027-03-01", "by": "Ada Example",
                        "from": { "kind": "decision", "decision": "2702281000-stable-formats/01", "question": "q-shims" } },
          "retired": null }
      ]
    }

### cli: phax doctrine add — indicative

Summary: Adding a project rule writes it to the doctrine file and commits that file alone.

    $ phax doctrine add --statement "Prefer explicit per-variant enums over a permissive superset." \
        --reason "A superset admits combinations nobody meant."
    ✓ T2 adopted — committed docs/doctrine.json

    $ phax doctrine add --from 2611041530-widget-cache/01/q-ttl
    ✓ T3 adopted from 2611041530-widget-cache/01 q-ttl — committed docs/doctrine.json

### cli: phax doctrine retire / supersede — indicative

Summary: Retiring or replacing a rule keeps the old one on file with its date and reason, so past decisions still read as taken under it.

    $ phax doctrine retire T2 --why "Enums moved to the schema generator."
    ✓ T2 retired — committed docs/doctrine.json

    $ phax doctrine supersede T1 --statement "Persisted formats change only with a documented upgrade step." \
        --reason "From 1.0 readers rely on the contract." --why "1.0 signs the stability contract."
    ✓ T4 adopted, T1 retired (superseded by T4) — committed docs/doctrine.json

    $ phax doctrine retire T1 --why "again"
    ✗ T1 is already retired (2027-03-01, superseded by T4)
    $? = 1

### cli: phax doctrine list — indicative

Summary: The operator can list the project rules in force now, or those that were in force at a past date or commit.

    $ phax doctrine list
    T3  Cache lifetimes are named, never bare numbers.    since 2026-11-05
    T4  Persisted formats change only with a documented upgrade step.   since 2027-03-01

    $ phax doctrine list --as-of 2026-12-01
    T1  No back-compat shims in persisted formats: new fields are required.   since 2026-11-05
    T2  Prefer explicit per-variant enums over a permissive superset.          since 2026-11-05
    T3  Cache lifetimes are named, never bare numbers.                         since 2026-11-05

    $ phax doctrine list --as-of 2026-12-01 --json
    { "$schema": "https://docs.phax.run/schemas/doctrine-list/0.35.0.json",
      "asOf": "2026-12-01", "entries": [ { "id": "T1", … } ] }

### file: spec and plan document open questions — normative

Summary: Every open question now says which rules its recommendation rests on, and a question resting on none reads as a question of taste.

before:

    { "id": "q-ttl", "question": "How long does a cached widget live?",
      "options": [ … ], "recommendation": "ttl-named", "rationale": "…" }

after:

    { "id": "q-ttl", "question": "How long does a cached widget live?",
      "options": [ … ], "recommendation": "ttl-named", "rationale": "…",
      "restsOn": ["S7", "T3"] }

    Rendered in §9:
    Recommendation: ttl-named — …
    Rests on: S7, T3

    or, with "restsOn": []:
    Rests on: nothing — a question of taste

### file: decision record doctrine sources — normative

Summary: Each decision record says which base doctrine and which project rules were in force when the decision was taken.

before:

    "doctrine": [
      { "kind": "skill", "name": "phax-decide-spec", "source": "bundled", "fingerprint": "9f2c…" },
      { "kind": "file", "path": "docs/house-rules.md", "fingerprint": "41ab…" }
    ]

after:

    "$schema": "https://docs.phax.run/schemas/decision-record-manifest/0.35.0.json",
    "doctrine": [
      { "kind": "base", "name": "phax-decide-spec", "phax": "0.35.0", "fingerprint": "9f2c…" },
      { "kind": "project", "path": "docs/doctrine.json", "fingerprint": "c07e…", "inForce": ["T1", "T2", "T3"] }
    ],
    "proposals": [ { "question": "q-ttl", "statement": "Cache lifetimes are named, never bare numbers." } ]

### cli: phax artifact decide --doctrine — indicative

Summary: The `--doctrine` flag and project copies of the decide skills are refused, and the refusal points to `phax doctrine add`.

before:

    $ phax artifact decide docs/specs/2611041530-widget-cache.md --doctrine docs/house-rules.md
    (house rules appended to the decide doctrine)

after:

    $ phax artifact decide docs/specs/2611041530-widget-cache.md --doctrine docs/house-rules.md
    ✗ decide refused: --doctrine is gone; record project rules with `phax doctrine add`
    $? = 2

## 7. Non-goals

- Making the base doctrine configurable, overridable or partially disabled by a project.
- A headless decide that settles questions without a person, including routine questions.
- Rewriting, re-rendering or re-attributing past decision records or past spec and plan sidecars.
- A migration command or upgrade hook that converts existing `--doctrine` files or skill copies. docs/upgrading.md describes the step instead.
- Applying project doctrine to phase execution, gates, code review or the run-time fix loop. This spec covers only authoring and deciding questions.
- Recording doctrine sources in authoring records. A sidecar's rests-on ids already resolve, because ids are never reused and retired entries are kept.
- Scoring or ranking entries, or any precedence among project entries.

## 8. Acceptance criteria

### The base doctrine is the same in every project

Given two repositories, one with a project copy of nothing and one with a docs/doctrine.json holding T1, when a headless spec authoring session starts in each, then both prompts carry the identical bundled base doctrine text, and only the second also carries T1. (refs §5.1, §5.14)

### Taste is out of the bundled base

Given the bundled base doctrine of a released phax, when its citable ids are listed, then it lists the base ids §9 settles (for example S0, S7, S9, P4, P8), and none of the ids §9 settles as taste, nor the text 'before 1.0 there is no stability contract'. (refs §5.2)

### An invalid doctrine document is refused

Given a docs/doctrine.json whose entry T2 has no `reason`, when `phax artifact decide` runs on a spec, then it exits non-zero, names T2 and `reason`, and starts no session. (refs §5.3)

### A project id cannot shadow a base id

Given a docs/doctrine.json with an entry `S7` and two entries `T3`, when `phax doctrine list` runs, then it refuses and names `S7` as a base id and `T3` as repeated. (refs §5.4)

### Without a document only the base applies

Given a repository with no docs/doctrine.json, when an interactive decide session completes, then the decision record's `doctrine` holds a single `base` source and no `project` source. (refs §5.5, §5.19)

### Adding an entry commits only the doctrine file

Given a clean docs/doctrine.json holding T1 and an unrelated staged file, when `phax doctrine add --statement "…" --reason "…"` runs, then T2 is appended in force, dated today and attributed to the committing identity, and HEAD's commit touches docs/doctrine.json alone while the other file stays staged. (refs §5.6)

### Retiring keeps the entry

Given a docs/doctrine.json with T2 in force, when `phax doctrine retire T2 --why "…"` runs, then T2 is still in the file with `retired.at`, `retired.by`, `retired.why` and `supersededBy: null`, and one commit touches docs/doctrine.json alone. (refs §5.7, §5.9)

### Superseding is one commit

Given a docs/doctrine.json with T1 in force and highest id T3, when `phax doctrine supersede T1 --statement "…" --reason "…" --why "…"` runs, then a single commit adds T4 in force and retires T1 with `supersededBy: "T4"`. (refs §5.8)

### Retiring twice or retiring a base id is refused

Given T1 already retired, when `phax doctrine retire T1` and then `phax doctrine retire S7` run, then each exits non-zero, the first names T1 as retired with its date, the second names S7 as a base id, and the file and HEAD are unchanged. (refs §5.10)

### A dirty doctrine file is refused

Given docs/doctrine.json has uncommitted edits, when `phax doctrine add` runs, then it exits non-zero naming docs/doctrine.json and writes nothing. (refs §5.11)

### Listing as of a past date

Given T1 adopted 2026-11-05 and retired 2027-03-01, T4 adopted 2027-03-01, when `phax doctrine list --as-of 2026-12-01`, `phax doctrine list` and `phax doctrine list --all` run, then the first shows T1 and not T4, the second T4 and not T1, the third both with T1's retirement. (refs §5.12)

### JSON answers carry their schema

Given any docs/doctrine.json, when `phax doctrine list --json` and a refused `phax doctrine retire T9 --json` run, then each prints one JSON document whose `$schema` names its 0.35.0 format, and the refusal's exit code follows command-contracts. (refs §5.13)

### Both decide modes read the project entries

Given a docs/doctrine.json with T2 in force and T1 retired, when an interactive decide session and a `--verdicts` session start, then both prompts carry the base doctrine and T2, neither carries T1 as citable, and a verdict citing T2 is accepted. (refs §5.15)

### An open question without rests-on is refused

Given a headless spec answer whose open question q-ttl has no `restsOn`, when phax decodes the answer, then it is refused naming q-ttl and `restsOn`. (refs §5.16)

### A retired id cannot be cited

Given T1 retired, when a spec answer has `"restsOn": ["T1"]` or a verdict has `"principles": ["T1"]`, then the document is refused naming T1 as retired. (refs §5.17)

### A question of taste reads as one

Given an open question with `"restsOn": []` and another with `"restsOn": ["S7", "T3"]`, when the spec is rendered, then §9 shows `Rests on: nothing — a question of taste` under the first and `Rests on: S7, T3` under the second. (refs §5.18)

### Retiring does not rewrite a past decision

Given a decision recorded while T1 was in force, then T1 retired, when the decision record and the spec sidecar are read again, then the record still lists `inForce` with T1 and the project fingerprint at the time, and both files are byte for byte what they were. (refs §5.19, §5.20)

### Old records still read

Given a decision record written at decision-record-manifest 0.30.0 and a spec sidecar at spec-document 0.32.0, when phax reads them, then both decode against their own formats without change. (refs §5.20)

### A note becomes a proposal, not an entry

Given an interactive decide session in which the operator departs on q-ttl with a note and answers 'this is a rule', when the session ends, then the decision record's `proposals` names q-ttl with its statement, and docs/doctrine.json is unchanged. (refs §5.21)

### Accepting a proposal records its origin

Given decision 2611041530-widget-cache/01 holding a proposal for q-ttl, when `phax doctrine add --from 2611041530-widget-cache/01/q-ttl` runs, then the new entry's statement is the proposal's and its `adopted.from` names that decision and question. (refs §5.22)

### Old overrides are refused

Given a repository holding .claude/skills/phax-decide-spec/SKILL.md, and separately a `--doctrine docs/house-rules.md` flag, when `phax artifact decide` runs in each case, then each is refused with a message naming `phax doctrine add`, and no session starts. (refs §5.23)

## 9. Open questions

### q-base-set — Which practice entries does the bundled base keep: the brief's proposal (dominant-loss framing, S0, S7, S8, S9/P1, P4, P8, P9, the three decide modes and the verdict shape), or a narrower base?

- as-proposed — Base keeps the full proposed set — abandons: A project that rejects S8, P4, P8 or P9 cannot say so, because the base is not configurable
- narrow — Base keeps only dominant-loss framing, S0, S7, S9/P1, the modes and the verdict shape; S8, P4, P8, P9 become taste — abandons: Every new project starts without the fix-footprint and inside-out rules any project needs, and has to rediscover them

Recommendation: as-proposed — Each of these rules protects the run or the reader whatever the project's taste. A project that truly disagrees is rarer than a project that would lose them by starting empty.

### q-default-rule — Are S1 (adopt the default unless a principle says otherwise) and S2 (deviate only toward the stricter) base or taste?

- s1-base-s2-taste — S1 is base, S2 is taste — abandons: A project that wants every deviation pushed toward strictness has to re-add S2 itself
- both-taste — Both are taste, as the brief proposes — abandons: The base decide procedure has no rule for when a deviation is allowed, so 'a departure cites a principle' has no grounding in a project with an empty doctrine
- both-base — Both are base — abandons: Every project inherits one author's lean toward strictness as practice, which is the problem this spec exists to fix

Recommendation: s1-base-s2-taste — The base procedure needs S1 to stay well-formed. The direction of a deviation is a preference.

### q-pairs — Do E0 and the five pairs C1–C5, with their precedence and the ids that rank under them (S3–S6, S10, P2, P3, P5–P7), leave the base for the project?

- taste — All move to taste; the bundled base cites no pair — abandons: Projects lose a ready-made ranking for conflicts between principles, and conflicting entries in an empty project go unranked
- pairs-base — The pairs and precedence stay base; only the ids under them move — abandons: The ranking that ships to everyone stays one author's, and the base keeps taste in it

Recommendation: taste — The ranking is the clearest case of one author's taste. Whether a project needs ranking can wait until it has conflicting entries.

### q-seed — How does a project's doctrine document start?

- empty — It starts empty; a project adds entries with `phax doctrine add`, and docs/upgrading.md lists the taste the base no longer carries — abandons: Existing projects silently lose the taste rules their decide sessions cited until they add them back
- seed-on-init — `phax init` writes today's bundled taste as entries T1… — abandons: Every new project adopts one author's taste as its own, the exact conflation being removed
- migrate-once — A one-time command converts existing taste and `--doctrine` files into entries — abandons: Migration machinery, which phax has dropped before as too complex for its payoff

Recommendation: empty — Taste has to be chosen. phax's own repository seeds its document by hand in the release, and that also serves as the example.

### q-apply — Does headless authoring apply the project's entries, so its recommendations follow them, or only show them?

- apply — Authoring follows the entries in force and cites them in `restsOn` — abandons: A recommendation already bent by a taste entry no longer looks like a neutral default
- show — Authoring cites entries it sees but recommends as if they were absent — abandons: The operator re-applies the project's known rules by hand on every question, and the doctrine never saves attention

Recommendation: apply — `restsOn` names the taste entry a recommendation follows, so applying it stays visible, while showing only throws away the reason entries exist.

### q-routine — Is a question whose recommendation rests only on base ids and is cheap to reverse marked routine, and what does phax do with it?

- not-yet — No routine mark in this spec; `restsOn` makes it computable later — abandons: The operator still reads base-only questions with the same attention as taste questions
- mark — Open questions gain a reversibility field, and the rendering marks base-only, cheap ones as routine — abandons: A second new required field and a label that leads to no action until a headless decide exists

Recommendation: not-yet — This is the minimal slice. A routine mark only pays off with a headless decide, which is a non-goal.

### q-records — How does a decision record carry the project doctrine it was taken under?

- fingerprint-ids — Path, fingerprint and the ids in force; the text comes back from `sourceSha` — abandons: Reading the entries' text needs the repository at `sourceSha`, not the record alone
- full-copy — A full copy of the in-force entries in the record — abandons: Small records: the doctrine is duplicated into every decision and drifts from the file it copies
- fingerprint-only — Path and fingerprint only — abandons: Seeing which entries were in force without resolving git history

Recommendation: fingerprint-ids — The ids answer 'what did this rest on' directly. The text already travels with the repository.

### q-legacy — What happens to `--doctrine <file>` and to a project copy of a bundled decide skill?

- retire-both — Both are refused with a pointer to `phax doctrine add` — abandons: Projects using a free-form doctrine file must re-enter its rules as entries before their next decide
- keep-flag — `--doctrine` stays as a per-session addition; skill copies are refused — abandons: There are two sources of project rules, and only one of them has history and attribution
- ignore-copy — Both are silently ignored — abandons: The operator's belief that their copy still applies, which a silent ignore never corrects

Recommendation: retire-both — With one source and one gesture, nothing stays as a shim, and the refusal tells the operator what to do.

### q-proposals-store — Where do proposals live until the operator accepts them?

- records — In the decision record; `phax doctrine add --from` reads them — abandons: Listing pending proposals needs a pass over decision records, not a glance at the doctrine file
- in-document — In the doctrine document as entries with a `proposed` state — abandons: The document stops being only rules: a proposal sits beside entries and a reader must filter it out

Recommendation: records — A proposal is never an entry, and keeping it out of the document makes that structural.

### q-render — Does the doctrine document get a human-readable rendering beside it?

- json-only — JSON only; `phax doctrine list` is the readable view — abandons: A reader browsing the repository on GitHub sees raw JSON
- rendered-md — phax renders docs/doctrine.md on every write, committed with the JSON — abandons: A second file in every doctrine commit, which a hand edit can push out of sync

Recommendation: json-only — This is the minimal slice. `list` already answers the reader, and a rendering can be added once someone asks for it.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Dominant-loss framing is base. The 'arbitrate on the dominant loss' rule in an assistant's memory is the same rule, not a project entry.
- 'Before 1.0, break freely', no back-compat shims, explicit per-variant enums, runs stay autonomous and ship the minimal slice are taste. phax's own repository records them as entries of its own docs/doctrine.json in the release that ships this.
- Project entry ids are assigned by phax as T<n>, never reused, and never colliding with base ids (spelling indicative).
- New fields are required: `restsOn` on every open question, base and project doctrine sources, and `proposals` on decision records. The spec-document, plan-document and decision-record-manifest formats bump to 0.35.0, and earlier versions are read through their history decoders unchanged.
- Every `phax doctrine` write commits exactly the doctrine file, under the clean-file precondition that artifact transitions use.

Left open:

- Every §9 question, above all the base and taste triage (q-base-set, q-default-rule, q-pairs).
- The document's final path and the verbs' flag spellings (indicative).
- Exit codes for the doctrine verbs' refusals, within command-contracts.

Constraints:

- No back-compat shims: `--doctrine` and project skill copies are refused, not tolerated.
- Past decision records and sidecars stay byte for byte; no command rewrites them.
- Tests never read a real ~/.claude or ~/.phax; fixtures use made-up names and decision ids.
- The doctrine document is decoded through a schema before any session reads it; all reads and commits go through ports.
- The bundled base keeps one citable id per rule, so verdict citations stay checkable against the loaded base.

## 11. Docs page

Page: Project doctrine: recording your own arbitration rules

Reader: An operator who wants phax's recommendations and decisions to follow, cite and date their project's own rules

Example: Adding 'No back-compat shims' as T1 with `phax doctrine add`, seeing a spec's open question show `Rests on: S7, T1`, then superseding T1 at 1.0 and running `phax doctrine list --as-of` to show that past decisions still read under it.
