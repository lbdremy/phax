---
status: Draft
date: 2026-09-24
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Artifact decide — arbitrating a spec's or plan's open questions

## 1. Context

Headless authoring (0.16.0) made a spec's open questions data. `phax artifact new spec <slug> --headless` returns a spec document whose `openQuestions[]` take the decision-request shape `{ id, question, options[{ id, label, abandons }], recommendation, rationale }`. phax writes that document as a JSON sidecar (`<stamp>-<slug>.json`) beside the Markdown it renders from it. The sidecar travels with every lifecycle transition, and `artifact approve` refuses with exit 12 when the body diverges from the sidecar's rendering. The plan document has no equivalent structure. Its `preamble.technicalArbitrations` is a list of plain strings, rendered as a `## Technical arbitrations` bullet list. No code reads open questions back out of Markdown. The only extractor is the plan extractor, a model call that turns `plan.md` into the extracted-plan shape, and it carries no arbitrations. The authoring record (`authoring/<stamp>-<slug>` on `phax/records/v1`) keeps the brief, prompt, document, transcript, provider, model, effort, usage and outcome. It does not keep the provider session id, so no authoring session can be resumed today.

Approvals are recorded in two places. One is an `approved: { date, baseline }` frontmatter stamp. The other is a record in `docs/specs/approvals.json` or `docs/plans/approvals.json`: `specFingerprint` or `planFingerprint`, `approvedAt`, `baseline`, plus `sourceSpec` for plans. Neither records who approved. `artifact status` prints `Path`, `Kind`, `Status` and `Authored`. For specs it adds `Approved: <date> @ <baseline>` and `Edited since`. It ends with `Legal transitions`. A separate command, `phax artifact reopen`, moves a Stale plan back to Draft.

Skills ship in the package. Its `files` list includes `.claude/skills/phax-planning`, `phax-cli` and `phax-spec`. `phax skills install --target <t> --scope project|user` copies them to `.claude/skills/<name>` or `.agents/skills/<name>`. Headless authoring always inlines the bundled copy and never consults an installed project copy. Three arbitration doctrines exist as drafts in `docs/ideas/skills/`: `phax-decide-spec` (S1–S10), `phax-decide-plan` (P1–P9) and `phax-decide-review` (R1–R7). Each defines its principles as list items that open with a backticked id. Each specifies the same output, `{ decisions: [{ id, chosen, abandoned[], advocate, why, principles[], reversibility, escalate }] }`. The sibling `headless-review` draft relies on this spec for the decision shape and for the form that tells a machine approval from an operator approval.

The first consumer is the steme roadmap-1.0 conductor. It authors every spec and plan headless, hands their open questions as data to a separate arbitration session, and approves. When an answer must be reconsidered, it relays a human steering instruction, `rouvre <question>`. The steme protocol and the arbitration-reflexes note are outside this session's read access. Their contract is taken here from the phax-side summaries: the idea note, headless-authoring §1 and NEXT_STEPS.

Ground read:

- `docs/ideas/artifact-decide.md` — the idea (2026-09-24): decide command, headless and interactive modes, caller-owned doctrine, JSON out re-implanted into the sidecar, --reopen, new session by default when headless, doctrines shipped as skills, the three open points
- `docs/ideas/skills/phax-decide-spec.md` — default spec doctrine, principles S1–S10 defined as list items opening with a backticked id; output { decisions: [{ id, chosen, abandoned, advocate, why, principles, reversibility, escalate }] }
- `docs/ideas/skills/phax-decide-plan.md` — default plan doctrine P1–P9; same output plus phase; an escalated plan decision blocks plan approval
- `docs/ideas/skills/phax-decide-review.md` — default review doctrine R1–R7; shipped by this spec, consumed by review-plan (headless-review spec)
- `docs/ideas/autopilot.md` — Decision policy: a loop is a decision answerer with a policy (recommended, stop, later ask)
- `docs/specs/2608091526-phase-decision-requests.md` — spec 23: the decision-request shape and the rule that a human's answer is a first-class, reviewable event; no auto-answering of run decision requests
- `docs/specs/archive/2609230835-headless-authoring.md` — the shipped pattern composed here: JSON-only session, schema-validated at the boundary, deterministic render, sidecar authority and divergence refusal, path-scoped commit, authoring record, exit families 12/5/8
- `docs/specs/2609241219-headless-review.md` — sibling draft: relies on this spec for the decision shape and the machine-versus-operator approval form (by machine with a grant, or by operator)
- `src/schemas/specDocument.ts` — openQuestions[] in the decision-request shape; traceability checks for duplicate ids and a recommendation that names an option
- `src/schemas/planDocument.ts` — preamble.technicalArbitrations is an array of plain strings; the plan document has no question structure
- `src/domain/authoring/renderSpec.ts` — §9 renders as ### Qn — question, option bullets with abandons, then Recommendation
- `src/domain/authoring/renderPlan.ts` — ## Technical arbitrations renders as a bullet list, only when non-empty
- `src/domain/artifact/sidecar.ts` — sidecar beside the artifact under the same name; agreement is in-sync, diverged or invalid; the divergence remedy text
- `src/schemas/authoringRecord.ts` — authoring record keys; no provider session id is stored, so no authoring session can be resumed
- `src/app/extractPlan.ts` — the only extractor: a model call turning plan.md into the extracted plan; nothing reads open questions back out of Markdown
- `src/schemas/specApprovalRecord.ts` — spec approval record: specFingerprint, approvedAt, baseline; no approver
- `src/schemas/approvalRecord.ts` — plan approval record: planFingerprint, approvedAt, baseline, sourceSpec; no approver; decoded with excess properties rejected
- `docs/specs/approvals.json` — the real ledger shape: { version: 1, records: { <path>: { specFingerprint, approvedAt, baseline } } }
- `src/app/artifactStatus.ts` — transitions, approve refusal on a diverged or invalid sidecar (exit 12), the approval stamp
- `src/cli/commands/artifact.ts` — artifact status lines today (Path, Kind, Status, Authored, Approved @ baseline, Edited since, Legal transitions); headless authoring inlines the bundled skill copy
- `phax.usage.kdl` — artifact subcommands today, including artifact reopen (Stale plan → Draft), a name this spec must not collide with
- `package.json` — files ships .claude/skills/phax-planning, phax-cli, phax-spec
- `src/domain/skills/catalog.ts` — bundled skill catalog; skills install copies to .claude/skills/<name> or .agents/skills/<name>
- `src/app/adjustPlan.ts` — interactive precedent: a pre-prompted provider session with a locally kept session id, resumed or new
- `NEXT_STEPS.md` — Road to 1.0.0 (additive only); the three additive specs the steme experiment needs; headless-authoring shipped 2026-09-23

## 2. Problem

The open questions are data, but nothing answers them. A loop that wants them decided runs its own arbitration session outside phax. That session is unrecorded, its decision policy is a private brief, and it returns prose. The loop must splice that prose back into the spec by hand, which diverges the sidecar and blocks `approve`. The answers land nowhere structured. Neither `artifact status` nor a later reader can tell which questions are open, which were decided, on what principle, or what was given up. A reconsideration such as `rouvre Q3` has no command. And an approval issued by a loop is recorded exactly like an approval a human gave. The approvals ledger cannot say that no human looked, and an unattended pipeline must never hide that fact.

## 3. Product goal

phax answers an artifact's open questions itself. `phax artifact decide` presents the questions to a session that loads a doctrine: a default skill that phax ships, which a project can replace and a caller-owned file can extend. phax accepts the decisions only as schema-validated JSON. It writes each decision into its question in the sidecar, re-renders the artifact, commits and records. A decided question can be reopened by command. Every decision and every approval names its arbiter, either a machine (doctrine, model, or a declared grant) or the operator. Status, sidecar and approvals ledger therefore never present a machine's judgement as a human's. Everything is additive to the CLI. The document formats stay experimental.

> Every answer names its arbiter and its principle. A machine's answer never passes for a human's, and nothing half-lands.

## 4. Terminology

- **Open question** — A question in an artifact's sidecar, in the decision-request shape { id, question, options[{ id, label, abandons }], recommendation, rationale }, plus its history. For a plan it also names the phase it concerns, or none.
- **Decision** — One arbiter's answer to one open question. It carries the chosen option, the abandoned options (exactly the ones not chosen), an advocate sentence (the strongest case for an abandoned option, written before deciding), why, the principle ids it cites, a reversibility (cheap | costly | irreversible) and an escalation (null, or what a human must confirm).
- **History** — The append-only list of a question's entries in the sidecar, each either decided or reopened. The last entry is the question's state.
- **Question state** — Undecided (no entry), decided (last entry is a decision without an escalation), escalated (last entry is a decision with an escalation) or reopened (last entry is a reopen).
- **Awaiting decision** — The questions a decide session is given. In headless mode these are reopened and undecided questions. In interactive mode, escalated questions are included as well.
- **Doctrine** — The instructions a decide session follows: the doctrine skill for the artifact kind, plus the optional --doctrine file appended after it.
- **Principle id** — An id a doctrine defines as a list item opening with a backticked id (e.g. `S1`, `P3`, or a project's own). Decisions cite principle ids, and phax checks each citation against the loaded doctrines.
- **Arbiter** — Who produced a decision, an approval or a reopen: a machine or the operator.
- **Machine decision** — A decision from a headless decide session. It is attributed to the doctrine sources it loaded and to the provider, model and effort.
- **Operator decision** — A decision from an interactive decide session, where the human judges and the agent facilitates. It is attributed to the git identity that commits it.
- **Grant** — The label a caller declares with --machine to name the machine performing an approval or a reopen, e.g. steme-conductor.
- **Machine approval / operator approval / unattributed approval** — An approval recorded with a grant, one recorded with the committing git identity, or one written before approver attribution existed.
- **Escalation** — A machine decision that provisionally adopts an option and names what a human must confirm. It blocks approval until an operator decides the question.
- **Question reopen** — `phax artifact decide <artifact> --question <id> --reopen`. It makes a decided or escalated question open again, with a note. It is distinct from `phax artifact reopen`, which moves a Stale plan back to Draft.
- **Arbitrated artifact** — An artifact with at least one history entry on any of its questions.
- **Decision record** — The record phax writes on phax/records/v1 for one decide session.

## 5. Functional requirements

### 5.1 Headless session is new by default

WHERE `--headless` is given THE system SHALL spawn a new decide session, not the artifact's authoring session, loading the doctrine for the artifact kind and the decisions schema for that kind.

### 5.2 Resuming the authoring session on request

WHERE `--headless` and `--resume-authoring` are both given THE system SHALL run the decide session by resuming the artifact's authoring session instead of spawning a new one.

### 5.3 Unresumable authoring session refused

IF `--resume-authoring` is given and no resumable authoring session is kept for the artifact THEN the system SHALL refuse before spawning, stating that the authoring session is not resumable.

### 5.4 Interactive session

WHEN `phax artifact decide` runs without `--headless` THE system SHALL open an interactive session that resumes the artifact's authoring session when one is kept, or starts a new session otherwise, and prints which of the two it did.

### 5.5 Authoring session id kept locally

WHEN a headless authoring session is spawned THE system SHALL keep its provider session id in the local authoring session state, outside the records branch.

### 5.6 Model and effort

The system SHALL resolve the decide model and effort from the flag if given, else from the built-in catalog default.

### 5.7 Inert flags refused

IF an inert flag combination is given (`--resume-authoring` without `--headless`; `--question` or `--note` without `--reopen`; `--reopen` together with `--headless`, `--doctrine`, `--model`, `--effort` or `--resume-authoring`) THEN the system SHALL refuse before any session, naming the flag.

### 5.8 Questions come from the sidecar

WHEN `decide` reads an artifact that has an in-sync sidecar THE system SHALL take the questions from the sidecar's open questions.

### 5.9 Hand-authored artifacts refused

IF the artifact has no sidecar THEN the system SHALL refuse `decide` and question reopen before any session, naming the remedy: re-author the artifact headless, or answer its questions by hand.

### 5.10 Artifact preconditions

IF the sidecar is diverged or invalid, the artifact or its sidecar has uncommitted changes, or the artifact is Completed or Abandoned THEN the system SHALL refuse before any session.

### 5.11 Presentation order

WHEN `decide` selects the questions awaiting decision THE system SHALL present the reopened questions first, each with its reopen note and prior decision, then the undecided questions, and, in interactive mode only, the escalated questions.

### 5.12 Nothing to decide

IF no question is awaiting decision THEN the system SHALL spawn no session, write nothing, and exit 0 stating that there is nothing to decide.

### 5.13 Doctrine skill by artifact kind

The system SHALL load the doctrine skill `phax-decide-spec` for a spec and `phax-decide-plan` for a plan.

### 5.14 Project skill replaces the default

WHERE a skill of the same name is installed in the project-scope skills directory of the session's provider THE system SHALL load it in place of the bundled default.

### 5.15 Doctrine file appended

WHERE `--doctrine <file>` is given THE system SHALL append the file's content after the doctrine skill in the session prompt.

### 5.16 Doctrine file refused

IF the `--doctrine` file cannot be read, defines no principle id, or defines a principle id that the loaded skill also defines THEN the system SHALL refuse before spawning.

### 5.17 JSON-only decisions

WHEN a decide session ends THE system SHALL accept as its result only a decisions document that validates against the decisions schema of the artifact kind.

### 5.18 Invalid decisions land nothing

IF the result is not JSON, fails the schema, decides a question that was not presented, omits a presented question in headless mode, chooses an option the question does not list, lists as abandoned anything other than exactly the unchosen options, or cites a principle id that no loaded doctrine defines THEN the system SHALL fail as a provider error naming the first violation by path, and SHALL leave the working tree and HEAD unchanged.

### 5.19 Per-arbiter decision rules

The system SHALL require every machine decision to cite at least one principle id, and SHALL reject any operator decision that carries an escalation.

### 5.20 Rate and usage limits

IF a decide session ends on a provider rate or usage limit THEN the system SHALL fail in the existing rate-limit family with nothing written.

### 5.21 Artifact changed during the session

IF the artifact or its sidecar changed while the decide session ran THEN the system SHALL refuse to write the decisions back, leaving those changes in place and committing nothing.

### 5.22 Decisions written into their questions

WHEN a decisions document validates THE system SHALL append each decision to the history of its question in the sidecar.

### 5.23 Decision attribution

The system SHALL attribute each headless decision to the machine, naming the loaded doctrine sources, provider, model and effort, and each interactive decision to the operator, named by the git identity that commits it.

### 5.24 Artifact re-rendered

WHEN a question's history in the sidecar changes THE system SHALL re-render the artifact with its deterministic renderer, showing under each question its current state and decision, and ending with a decision log that lists every history entry in order.

### 5.25 One commit

WHEN `decide` or a question reopen writes the artifact and its sidecar THE system SHALL commit exactly those two paths in one commit.

### 5.26 Commit failure

IF that commit fails THEN the system SHALL report an artifact error and leave both files written but uncommitted.

### 5.27 Decision record

WHEN a decide commit lands and records are enabled THE system SHALL write a decision record carrying: the prompt, the doctrine sources with their fingerprints, the questions presented, the decisions document, the transcript (per the records transcript setting), provider, model, effort, usage, outcome and the commit.

### 5.28 Failed session recorded

WHEN a decide session fails after spawning and records are enabled THE system SHALL write its decision record with a failed outcome.

### 5.29 Status reports questions

WHEN `artifact status` inspects an artifact that has a sidecar THE system SHALL report its questions as open (naming the reopened ones), decided (split into machine and operator) and escalated (naming them).

### 5.30 Status names the approver

WHEN `artifact status` reports an approval THE system SHALL name the approver's kind and identity.

### 5.31 Approval blocked while arbitration is incomplete

IF an artifact is arbitrated and any of its questions is undecided, reopened or escalated THEN `artifact approve` SHALL refuse, naming those questions and the remedy.

### 5.32 Unarbitrated artifacts approve as today

WHILE an artifact is not arbitrated THE system SHALL approve it exactly as today, even if it has open questions.

### 5.33 Machine gestures

WHERE `--machine <grant>` is given to `artifact approve` or to a question reopen THE system SHALL record that approval or reopen as performed by a machine, naming the grant.

### 5.34 Operator gestures

The system SHALL record every approval or question reopen given without `--machine` as performed by the operator, naming the git identity that commits it.

### 5.35 Pre-existing approvals are unattributed

WHEN phax reads an approval record written before approver attribution existed THE system SHALL present it as unattributed, never as an operator approval.

### 5.36 Question reopen

WHEN `--question <id> --reopen` names a decided or escalated question THE system SHALL append to that question's history a reopened entry carrying the note, making the question open again.

### 5.37 Reopen refusals

IF `--reopen` names an unknown question, or a question that is undecided or already reopened, THEN the system SHALL refuse and write nothing.

### 5.38 Approved artifact revised in place

WHEN `decide` or a question reopen rewrites an Approved artifact THE system SHALL leave its status Approved, so that the existing approval-fingerprint checks treat it as edited since approval until it is re-approved.

### 5.39 Doctrine skills ship

The system SHALL ship `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review` as bundled skills, which `phax skills install` installs exactly as it installs `phax-spec`.

### 5.40 Plan open questions

WHERE the artifact is a plan THE system SHALL accept open questions in the plan document, in the decision-request shape, each naming the phase it concerns or none.

### 5.41 Authoring emits no history

IF the document returned by an authoring session carries a history entry on any question THEN the system SHALL reject it as an invalid document.

### 5.42 Re-rendered plan never re-extracted

WHEN `decide` or a question reopen re-renders a plan THE system SHALL re-seed the extraction cache with the plan's projection, so that `phax run` never extracts it through a model.

## 6. Surface

### cli: `phax artifact decide` — normative

    phax artifact decide <artifact> --headless [--doctrine <file>] [--model <model>] [--effort <effort>] [--resume-authoring]
    phax artifact decide <artifact> [--doctrine <file>] [--model <model>] [--effort <effort>]        # interactive
    phax artifact decide <artifact> --question <id> --reopen [--note <text>] [--machine <grant>]

    # command and flag names normative, except --machine (spelling indicative, see approve); exit families normative; output layout indicative

    $ phax artifact decide docs/specs/2609241300-plan-prune.md --headless --doctrine docs/doctrine/spec.md
    decide spec plan-prune — 3 questions — claude-opus-5-5 / high (headless, new session)
    doctrine  phax-decide-spec (bundled) + docs/doctrine/spec.md
    Q1        decided    manual   (S1, S7)
    Q2        decided    keep-10  (S2, S5) — departs from the recommendation
    Q3        escalated  manual   — a human must confirm: adds the `archive.prune` config key
    commit    a1b2c3d — docs(specs): decide plan-prune Q1, Q2, Q3
    record    decision/2609241300-plan-prune/01
    $? = 0

    $ phax artifact decide docs/specs/2609241300-plan-prune.md --headless
    decide spec plan-prune — nothing to decide (decided 2 · escalated 1 · open 0)
    $? = 0

    $ phax artifact decide docs/specs/2609241300-plan-prune.md --question Q1 --reopen --note "auto is cheap now that records keep the trajectory"
    reopened  Q1 — by operator (Ada Lovelace)
    commit    b2c3d4e — docs(specs): reopen plan-prune Q1
    $? = 0

    ✗ decide refused: docs/specs/2609010900-legacy.md has no sidecar — decide needs a headless-authored artifact
      re-author it with `phax artifact new spec legacy --headless --brief <file|->`, or answer its questions by hand
    $? = 12

    ✗ decide failed: decisions document rejected — decisions[1].principles[0]: "S12" is defined by no loaded doctrine
      nothing written; the session is recorded as failed
    $? = 5

    Exit: 0 decided and committed, reopened, or nothing to decide
          1 interactive session ended without a decisions document, nothing written (value indicative)
          5 result not JSON, or fails the decisions schema or its checks
          8 provider rate or usage limit
          12 artifact refusal: no sidecar, diverged or invalid sidecar, uncommitted changes, terminal status, inert flags,
             bad doctrine file, authoring session not resumable, unknown/undecided question on --reopen,
             artifact changed during the session, commit failed

### file: decisions document (the decide session's final message) — normative

    { "decisions": [
      { "id": "Q1", "chosen": "manual", "abandoned": ["auto"],
        "advocate": "The strongest case for auto: the registry would shrink without anyone remembering to prune.",
        "why": "The recommendation stands; no principle is violated and deletion stays a separate gesture.",
        "principles": ["S1", "S7"],
        "reversibility": "cheap",
        "escalate": null } ] }

    # every key required, unknown keys rejected; reversibility: cheap | costly | irreversible;
    # escalate: null, or a string naming what a human must confirm (machine decisions only);
    # plan variant: each decision also carries "phase": "<phase id>" | null

### file: `docs/specs/<stamp>-<slug>.json` question history — normative

before:

    "openQuestions": [
      { "id": "Q1", "question": "Is pruning manual or automatic past `keep`?",
        "options": [ { "id": "manual", "label": "an explicit `phax prune`", "abandons": "the registry ever shrinking on its own" },
                     { "id": "auto", "label": "prune past `keep` at archive time", "abandons": "an archived run being inspectable after the fact" } ],
        "recommendation": "manual",
        "rationale": "records already keep the trajectory; the run folder is disposable but not silently." } ]

after:

    "openQuestions": [
      { "id": "Q1", "question": "Is pruning manual or automatic past `keep`?",
        "options": [ … unchanged … ],
        "recommendation": "manual",
        "rationale": "records already keep the trajectory; the run folder is disposable but not silently.",
        "history": [
          { "kind": "decided", "at": "2026-09-24T10:02:11Z",
            "by": { "kind": "machine",
                    "doctrine": [ { "kind": "skill", "name": "phax-decide-spec", "source": "bundled" },
                                  { "kind": "file", "path": "docs/doctrine/spec.md" } ],
                    "provider": "claude", "model": "claude-opus-5-5", "effort": "high" },
            "chosen": "manual", "abandoned": ["auto"], "advocate": "…", "why": "…",
            "principles": ["S1", "S7"], "reversibility": "cheap", "escalate": null },
          { "kind": "reopened", "at": "2026-09-25T08:40:00Z",
            "by": { "kind": "operator", "name": "Ada Lovelace" },
            "note": "auto is cheap now that records keep the trajectory" }
        ] } ]

    # normative: every question carries `history` (empty until its first entry, required, no optional-for-back-compat);
    # entry kinds decided | reopened; by kinds machine | operator; a machine `by` is either the session form above
    # or { "kind": "machine", "grant": "steme-conductor" } for a reopen; nested spellings indicative.
    # A question's state is its last entry: none → undecided; decided + escalate null → decided;
    # decided + escalate → escalated; reopened → reopened.

### file: rendered spec — §9 answered and a decision log — normative

before:

    ## 9. Open questions for implementation planning

    ### Q1 — Is pruning manual or automatic past `keep`?

    - manual — an explicit `phax prune` — abandons: the registry ever shrinking on its own
    - auto — prune past `keep` at archive time — abandons: an archived run being inspectable after the fact

    Recommendation: manual — records already keep the trajectory; the run folder is disposable but not silently.

after:

    ## 9. Open questions for implementation planning

    ### Q1 — Is pruning manual or automatic past `keep`?

    - manual — an explicit `phax prune` — abandons: the registry ever shrinking on its own
    - auto — prune past `keep` at archive time — abandons: an archived run being inspectable after the fact

    Recommendation: manual — records already keep the trajectory; the run folder is disposable but not silently.

    Decision: manual — by machine (phax-decide-spec + docs/doctrine/spec.md; claude-opus-5-5 / high), 2026-09-24
    Why: The recommendation stands; no principle is violated and deletion stays a separate gesture.
    Principles: S1, S7. Reversibility: cheap.
    Advocate for auto: the registry would shrink without anyone remembering to prune.

    ### Q3 — Is the prune policy a config key?

    …

    Decision (escalated): manual — by machine (…), 2026-09-24 — a human must confirm: adds the `archive.prune` config key

    ## 10. Implementation-planning note
    …
    ## 11. Docs page
    …

    ## 12. Decision log

    - 2026-09-24 Q1 decided manual — machine (phax-decide-spec + docs/doctrine/spec.md; claude-opus-5-5 / high)
    - 2026-09-24 Q3 escalated manual — machine (phax-decide-spec + docs/doctrine/spec.md; claude-opus-5-5 / high)
    - 2026-09-25 Q1 reopened — operator (Ada Lovelace): auto is cheap now that records keep the trajectory

    # normative: a Decision / Decision (escalated) / Reopened line under each question that has history, naming the arbiter;
    # a final Decision log section present only when any question has history; the rest of the rendering unchanged.
    # Prose and line wording indicative. A reopened question shows "Reopened: <note> — by <arbiter>" in place of its Decision line.

### file: `docs/plans/<stamp>-<slug>-plan.json` open questions — indicative

before:

    "preamble": {
      "summary": "…",
      "requiredCommandsNote": "…",
      "technicalArbitrations": ["Keep prune in app/, not a domain service — …"]
    }

after:

    "preamble": {
      "summary": "…",
      "requiredCommandsNote": "…",
      "technicalArbitrations": ["Keep prune in app/, not a domain service — …"],
      "openQuestions": [
        { "id": "Q1", "phase": "phase-02",
          "question": "Does phase-02 or phase-03 own the registry write?",
          "options": [ { "id": "p2", "label": "phase-02 writes it", "abandons": "…" },
                       { "id": "p3", "label": "phase-03 writes it", "abandons": "…" } ],
          "recommendation": "p2", "rationale": "…", "history": [] } ]
    }

    # rendered in the plan preamble, before the first phase, as "## Open questions" (the same question/decision
    # layout as a spec's §9) and "## Decision log"; the rendered plan still passes `phax plans lint` with no structure
    # error and parses on the deterministic path to the same projection (per §9 Q2)

### cli: `phax artifact status` — normative

before:

    Path:              docs/specs/2609241300-plan-prune.md
    Kind:              spec
    Status:            Approved
    Authored:          headless — sidecar docs/specs/2609241300-plan-prune.json (in sync)
    Approved:          2026-09-25 @ a1b2c3d
    Edited since:      no
    Legal transitions: Completed, Abandoned

after:

    Path:              docs/specs/2609241300-plan-prune.md
    Kind:              spec
    Status:            Approved
    Authored:          headless — sidecar docs/specs/2609241300-plan-prune.json (in sync)
    Questions:         3 — open 0 · decided 3 (machine 2, operator 1) · escalated 0
    Approved:          2026-09-25 @ a1b2c3d by machine (steme-conductor)
    Edited since:      no
    Legal transitions: Completed, Abandoned

    # other forms:
    #   Questions:  4 — open 1 (Q4 reopened) · decided 2 (machine 1, operator 1) · escalated 1 (Q3)
    #   Approved:   2026-09-25 @ a1b2c3d by operator (Ada Lovelace)
    #   Approved:   2026-09-04 @ c545cb1 unattributed (approved before attribution)
    # a hand-authored artifact prints no Questions line; plans gain the same Questions line and approver.
    # normative: the three counts, the machine/operator split, the named reopened and escalated ids, the approver kind and identity; layout indicative

### cli: `phax artifact approve` — normative

before:

    phax artifact approve <path>
    Status:   Approved
    Baseline: a1b2c3d
    Commit:   c3d4e5f — …

after:

    phax artifact approve <path> [--machine <grant>]

    $ phax artifact approve docs/specs/2609241300-plan-prune.md --machine steme-conductor
    Status:   Approved
    Approver: machine (steme-conductor)
    Baseline: a1b2c3d
    Commit:   c3d4e5f — docs(specs): approve plan-prune
    $? = 0

    $ phax artifact approve docs/specs/2609241300-plan-prune.md
    Status:   Approved
    Approver: operator (Ada Lovelace)
    …

    ✗ Approval refused: docs/specs/2609241300-plan-prune.md still owes decisions — escalated Q3
      answer them with `phax artifact decide docs/specs/2609241300-plan-prune.md` (interactive)
    $? = 12

    # normative: that a machine declaration exists and is recorded with its grant, the operator default,
    # the refusal and its exit 12 naming the questions; --machine spelling and wording indicative (§9 Q6)

### file: `docs/specs/approvals.json` and `docs/plans/approvals.json` records — normative

before:

    "docs/specs/2609241300-plan-prune.md": {
      "specFingerprint": "b19da59f…",
      "approvedAt": "2026-09-25T09:28:11.427Z",
      "baseline": "67e20c37…"
    }

after:

    "docs/specs/2609241300-plan-prune.md": {
      "specFingerprint": "b19da59f…",
      "approvedAt": "2026-09-25T09:28:11.427Z",
      "baseline": "67e20c37…",
      "approvedBy": { "kind": "machine", "grant": "steme-conductor" }
    }

    # or "approvedBy": { "kind": "operator", "name": "Ada Lovelace" }; the same key joins plan records.
    # Written on every new approval. A record written before this change has no approvedBy and reads as
    # unattributed (§9 Q5). Kinds machine | operator normative; key spelling indicative; the form is shared with headless-review.

### file: decision record on `phax/records/v1` — indicative

    decision/2609241300-plan-prune/01/
      record.json   { version: 1, kind: "decision", artifact: "docs/specs/2609241300-plan-prune.md", artifactKind: "spec",
                      mode: "headless" | "interactive", session: "new" | "resumed-authoring",
                      doctrine: [ { kind: "skill", name: "phax-decide-spec", source: "bundled" | "project", fingerprint: "…" },
                                  { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "…" } ],
                      questions: ["Q1", "Q2", "Q3"], sourceSha: "a1b2c3d…", provider, model, effort,
                      outcome: "committed" | "failed", usage: { available, … } }
      prompt.md  decisions.json  output.jsonl

    # resolved by `phax records explain <sha>` like an authoring record; that the record exists with these facts is normative (§5.27)

### package: bundled doctrine skills — normative

before:

    "files": ["dist", "phax.usage.kdl", ".claude/skills/phax-planning", ".claude/skills/phax-cli", ".claude/skills/phax-spec"]

after:

    "files": ["dist", "phax.usage.kdl", ".claude/skills/phax-planning", ".claude/skills/phax-cli", ".claude/skills/phax-spec",
              ".claude/skills/phax-decide-spec", ".claude/skills/phax-decide-plan", ".claude/skills/phax-decide-review"]

    $ phax skills install --target claude --scope project
    created          .claude/skills/phax-decide-spec/SKILL.md
    created          .claude/skills/phax-decide-plan/SKILL.md
    created          .claude/skills/phax-decide-review/SKILL.md
    already present  .claude/skills/phax-spec/SKILL.md
    …

    # skill names normative; each SKILL.md is the draft in docs/ideas/skills/ with its "Draft, not installed" banner
    # removed and nothing else rewritten; a project copy under .claude/skills/<name>/ (or .agents/skills/<name>/ for
    # providers that read there) replaces the default for decide; install output layout indicative

## 7. Non-goals

- A decision queue UI or desktop inbox. This spec provides the data and the status line, nothing visual.
- Multi-human arbitration: several operators, votes, required reviewers or per-question owners. The operator is whoever commits.
- Arbitrating hand-authored artifacts, or extracting questions from Markdown. An artifact without a sidecar is refused (§9 Q4), and sidecars are not back-filled.
- Automatic routing of an escalation, e.g. running decide on the spec when a plan decision escalates under P1. The escalated decision blocks approval and the caller routes it.
- Choosing an option the question does not list, or editing a question, its options or the requirements from within decide. A question is changed by re-authoring the artifact.
- Rewriting the doctrine drafts. Their content ships as written, minus the draft banner.
- Loading `phax-decide-review` from decide. The review doctrine ships here and is consumed by review-plan (the headless-review spec).
- Changing how headless authoring loads `phax-spec` and `phax-planning`. The project-skill override applies to the decide doctrines only.
- A `phax.json` key for the decide model and effort. It can be added later without breaking anything.
- Answering phase decision requests (spec 23) or any autopilot loop. Run decision requests stay human-answered.
- Parsing a steering file. Mapping `rouvre Q3` to a question reopen is the caller's job.
- Changing `phax skills install`'s behaviour of overwriting a locally edited copy.
- Stability of the question history and decisions formats. Like the documents that carry them, they are experimental and outside the 1.0 promise.

## 8. Acceptance criteria

### Headless decide lands whole

Given a headless-authored spec whose sidecar has two undecided questions, when `phax artifact decide <spec> --headless` runs and the session returns a valid decisions document, then a new session (not the authoring session) was spawned with `phax-decide-spec`. Each question's history gains one decided entry attributed to the machine with its doctrine sources, provider, model and effort. §9 shows a Decision line under each question, and a `## 12. Decision log` lists both entries. The artifact and sidecar are the only paths in the new HEAD commit, the sidecar is in sync, and the exit code is 0. (refs §5.1, §5.8, §5.13, §5.17, §5.22, §5.23, §5.24, §5.25)

### Resume authoring only when kept

Given a spec authored headless on this machine, and another whose local authoring state is gone, when `phax artifact decide <spec> --headless --resume-authoring` runs on each, then the first run resumes the provider session id kept from authoring. The second exits 12, stating that the authoring session is not resumable, and no session is spawned. (refs §5.2, §5.3, §5.5)

### Interactive resumes or starts new and names the operator

Given a headless-authored spec with a kept authoring session id, and one without, when `phax artifact decide <spec>` runs without `--headless` on each and the operator decides a question, then the first run resumes the authoring session and the second starts a new one, each printing which it did. The resulting decisions are attributed to the operator by the committing git identity. (refs §5.4, §5.23)

### Model resolves flag then catalog

Given no `--model` flag, when `phax artifact decide <spec> --headless` runs, then the session uses the catalog default and prints it. Given `--model` and `--effort`, the flags win. (refs §5.6)

### Inert flags refused

Given a headless-authored spec, when `decide` runs with `--question Q1` without `--reopen`, with `--resume-authoring` without `--headless`, or with `--reopen --headless`, then each run exits 12 naming the flag, and no session is spawned. (refs §5.7)

### Hand-authored artifact refused

Given a spec with no sidecar, when `phax artifact decide <spec> --headless` or `--question Q1 --reopen` runs, then it exits 12 naming the remedy, no session is spawned, and the working tree and HEAD are unchanged. (refs §5.9)

### Preconditions refuse before the session

Given a spec whose sidecar diverged, a spec with an uncommitted change, and a Completed spec, when `phax artifact decide <spec> --headless` runs on each, then each run exits 12 and no session is spawned. (refs §5.10)

### Reopened questions come first

Given a spec where Q2 is reopened with a note, Q3 is undecided and Q1 is escalated, when headless decide runs, and then interactive decide runs, then the headless prompt presents Q2 with its note and prior decision, then Q3, and not Q1. The interactive prompt presents Q2, then Q3, then Q1. (refs §5.11)

### Nothing to decide

Given a spec whose questions are all decided, when `phax artifact decide <spec> --headless` runs, then it exits 0 stating there is nothing to decide, no session is spawned and no commit is made. (refs §5.12)

### Project skill replaces the default and the doctrine file is appended

Given a project-scoped `.claude/skills/phax-decide-spec/SKILL.md` that differs from the bundled one, and a `docs/doctrine/spec.md` defining `X1`, when `phax artifact decide <spec> --headless --doctrine docs/doctrine/spec.md` runs, then the prompt contains the project skill's text, not the bundled text, followed by the doctrine file. A decision citing `X1` is accepted, and the decision record names the skill source as project. (refs §5.14, §5.15)

### Bad doctrine file refused

Given a `--doctrine` file that is unreadable, one that defines no principle id, and one that defines `S1`, when headless decide runs with each, then each run exits 12 and no session is spawned. (refs §5.16)

### Invalid decisions land nothing

Given sessions that return, respectively: prose; a decision citing `S12`; a document omitting a presented question; a `chosen` option the question does not list; an `abandoned` list that is not exactly the unchosen options; a decision for a question not presented, when each session ends, then each run exits 5 naming the violation path, the working tree and HEAD are unchanged, and with records enabled a decision record exists with outcome `failed`. (refs §5.17, §5.18, §5.28)

### Per-arbiter rules

Given a headless decision with empty `principles`, an interactive decision carrying an `escalate` string, and an interactive decision with empty `principles`, when each document is validated, then the first two are rejected with exit 5, and the third is accepted. (refs §5.19)

### Rate limit lands nothing

Given a headless decide session that ends on a provider usage limit, when the session ends, then the run exits 8 and nothing is written or committed. (refs §5.20)

### Concurrent edit refused

Given an interactive decide session during which the artifact file is modified, when the session returns a valid decisions document, then the run exits 12, the modification is left in place, and no commit is made. (refs §5.21)

### Commit failure leaves the files

Given a valid decisions document and a commit that fails, when decide writes the artifact and sidecar, then the run exits 12, and both files are written but uncommitted. (refs §5.26)

### Record explains the decisions

Given records enabled and a decide commit at `<sha>`, when `phax records explain <sha>` runs, then it shows the prompt, the doctrine sources with fingerprints, the questions presented, the decisions document, model, effort, usage and outcome `committed`. (refs §5.27)

### Status counts questions by state and arbiter

Given a spec with Q1 decided by machine, Q2 decided by operator, Q3 escalated and Q4 reopened, when `phax artifact status <spec>` runs, then it prints open 1 naming Q4 as reopened, decided 2 split machine 1 and operator 1, and escalated 1 naming Q3. (refs §5.29)

### Arbitration must finish before approval

Given an arbitrated spec with Q3 escalated, and another arbitrated spec with one question still undecided, when `phax artifact approve` runs on each, then each run exits 12 naming the questions and the remedy. After an interactive decide answers Q3, approve on the first spec succeeds. (refs §5.31)

### Unarbitrated artifacts approve as today

Given a headless-authored spec with undecided open questions and no history on any question, when `phax artifact approve <spec>` runs, then it approves exactly as today. (refs §5.32)

### Approvals name their approver

Given a spec ready for approval, when `phax artifact approve <spec> --machine steme-conductor` runs, and separately the same command runs without `--machine`, then the approvals.json record carries `approvedBy` `{ kind: machine, grant: steme-conductor }` or `{ kind: operator, name: <git user.name> }` respectively, and `phax artifact status` prints `by machine (steme-conductor)` or `by operator (<name>)`. (refs §5.30, §5.33, §5.34)

### Pre-existing approvals read as unattributed

Given an approvals.json record written before this change, without `approvedBy`, when `phax artifact status` inspects its artifact, and a plan citing that spec is approved, then status prints the approval as unattributed, never as operator, and the plan approval succeeds as today. (refs §5.35)

### Reopen appends and re-renders

Given a spec where Q1 is decided, when `phax artifact decide <spec> --question Q1 --reopen --note "auto is cheap now"` runs, then Q1's history gains a reopened entry with the note and an operator `by`. §9 shows Q1 as reopened, the decision log gains the entry, and a single commit contains the artifact and sidecar. Given `--question Q9`, or an undecided question, the run exits 12 and writes nothing. (refs §5.36, §5.37, §5.24, §5.25)

### Approved artifact revised in place

Given an Approved spec with all questions decided, when `--question Q1 --reopen --machine steme-conductor` runs, then its status stays Approved, `Edited since` reads yes, the reopen entry's `by` names the grant, approving a plan against the spec exits 12, and after decide and re-approval both succeed. (refs §5.38, §5.33)

### Doctrine skills ship and install

Given an installed phax package, when `phax skills install --target claude --scope project` runs, then `.claude/skills/phax-decide-spec/SKILL.md`, `phax-decide-plan/SKILL.md` and `phax-decide-review/SKILL.md` exist, each equal to its draft in docs/ideas/skills/ minus the draft banner. (refs §5.39)

### Plan decide keeps the plan executable

Given a headless plan whose document has open question Q1 concerning phase-02, when `phax artifact decide <plan> --headless` runs, then the session loads `phax-decide-plan` and the decision carries `phase: phase-02`. The re-rendered plan passes `phax plans lint` with no structure error, and `phax run` finds its projection without spawning an extraction session. An escalated plan decision makes `phax artifact approve <plan>` exit 12. (refs §5.40, §5.42, §5.13, §5.31)

### Authoring emits no history

Given an authoring session whose spec document carries a history entry on a question, when the session ends, then the run exits 5 and nothing is written. (refs §5.41)

## 9. Open questions for implementation planning

### Q1 — May `decide` and a question reopen run on an Approved artifact, and what becomes of its approval?

- allowed on Draft and Approved. An Approved artifact stays Approved, but its fingerprint no longer matches, so it reads edited since approval and must be re-approved (the existing in-place revision) — abandons: a status that changes on reopen. Until re-approval the artifact still reads Approved, and only `Edited since` and the Questions line show the reopened question
- a decide or reopen on an Approved artifact moves it back to Draft through a new Approved → Draft transition — abandons: the lifecycle graph of specs 21/22 (it gains a backward edge) and the approval's continuity: every plan bound to the spec loses its Approved source at once
- refuse decide and reopen once the artifact is Approved — abandons: steering after approval. A `rouvre` on an approved spec would force abandoning and re-authoring it

Recommendation: allowed on Draft and Approved. An Approved artifact stays Approved, but its fingerprint no longer matches, so it reads edited since approval and must be re-approved (the existing in-place revision) — Re-approving an Approved spec is already the supported way to revise it in place. The fingerprint checks already stop a plan from being approved against an edited spec. §5.31 keeps a reopened question from being approved over, so no new transition is needed.

### Q2 — Do plans need a structured open-questions section in their document schema?

- add `openQuestions` to the plan preamble, in the decision-request shape plus `phase` and `history`, rendered before the first phase — abandons: an unchanged plan document schema. The experimental format and the planning skill's document table change, and in-repo plan sidecars are migrated
- decide specs only in this spec, and refuse plans until a later spec — abandons: the plan doctrine (P1–P9) and the first consumer's plan arbitrations, which would stay in a private session
- turn `technicalArbitrations` itself into decision requests — abandons: settled arbitrations as one-line prose. Every already-decided arbitration would have to be restated as a question with options

Recommendation: add `openQuestions` to the plan preamble, in the decision-request shape plus `phase` and `history`, rendered before the first phase — Today's plan document has no question structure (`technicalArbitrations` is plain strings), so decide on plans needs one. Adding it beside the settled list keeps what is decided as prose and gives what is open the same shape as a spec's §9.

### Q3 — What format does a doctrine take, and can decisions cite it mechanically?

- prose, where a principle is a list item opening with a backticked id (the drafts' existing form). phax collects the ids from the skill and the --doctrine file and rejects a citation that names none — abandons: freedom of form for a project's doctrine file: without at least one anchored principle it is refused
- free prose. The agent reads it, and phax checks nothing about cited ids — abandons: any mechanical guarantee that a decision's `principles` exist; a hallucinated `S12` lands
- prose with `[[S1]]` anchors, as the idea note suggests — abandons: the drafts as written; shipping them would mean rewriting every principle line, which this spec excludes
- a structured list (JSON or YAML of { id, text }) — abandons: a doctrine a human reads and writes as prose, and the drafts, which would be rewritten

Recommendation: prose, where a principle is a list item opening with a backticked id (the drafts' existing form). phax collects the ids from the skill and the --doctrine file and rejects a citation that names none — It is the drafts' form already, so they ship unchanged. It makes every citation checkable, turning 'a decision without a cited principle is invalid' from a doctrine sentence into a validation. The draft's `S0` (argue for the abandoned option) is carried by the `advocate` field and is not a citable principle.

### Q4 — What does decide do with a hand-authored artifact that has no sidecar?

- decide and reopen refuse it, naming the remedy (re-author it headless, or answer by hand) — abandons: arbitration of hand-authored artifacts. A human who writes a spec interactively still answers its §9 by hand, as today
- a new model extraction of §9 or the plan's arbitrations (the plan extractor's mechanism), decisions kept in a decisions-only file beside the artifact, and decision lines spliced into the hand-written Markdown — abandons: one home for decisions and the rule that phax edits Markdown only by rendering it. Decisions would live in the sidecar for one artifact and in another file for the next, and phax would splice text into a body it never rendered

Recommendation: decide and reopen refuse it, naming the remedy (re-author it headless, or answer by hand) — The brief assumed an extractor that headless authoring already uses. None exists: the only extractor turns plan.md into the extracted plan and carries no arbitrations. The first consumer authors everything headless, and parsing Markdown back was a headless-authoring non-goal. Refusing leaves hand-authored artifacts changed in nothing.

### Q5 — How are approval records written before attribution read?

- `approvedBy` is written on every new record. A record without it reads as unattributed — abandons: the strict no-optional rule on the approvals ledger: the key is required on write and absent-tolerated on read, a deliberate exception like the optional `authoring` config keys
- a record without `approvedBy` reads as an operator approval — abandons: the guarantee this spec exists for: a scripted pre-change approval would be presented as human
- `approvedBy` is required everywhere, and existing ledgers must be rewritten by a migration before phax reads them — abandons: loading every approvals ledger written before. Plan approval and `run` would be blocked in every repo until migrated, and a migration command joins the CLI, contrary to the additive constraint

Recommendation: `approvedBy` is written on every new record. A record without it reads as unattributed — The only honest reading of a record that predates attribution is 'unknown'. Presenting it as an operator approval breaks the guiding rule, and a forced migration breaks the additive constraint.

### Q6 — How does phax know an approval (or reopen) is a machine's?

- the caller declares it with `--machine <grant>`; without it the gesture is the operator's — abandons: enforcement: a loop that omits the flag is recorded as the operator; attribution is honest by declaration
- no TTY means machine — abandons: determinism and scripted operators: the same command records differently by terminal, and a human's scripted approval is labelled machine
- approve always requires `--by operator|machine` — abandons: every existing `artifact approve` invocation, a breaking CLI change against the additive constraint

Recommendation: the caller declares it with `--machine <grant>`; without it the gesture is the operator's — The first consumer is a cooperating loop that wants its approvals marked. phax cannot tell a human from a script without guessing, and a guess is worse than a declared, recorded grant.

## 10. Implementation-planning note

Settled:

- The three invocations and their flags: `decide --headless [--doctrine] [--model --effort] [--resume-authoring]`, interactive `decide [--doctrine] [--model --effort]`, and `decide --question <id> --reopen [--note] [--machine]`. Inert combinations are refused.
- The input is the sidecar only. An artifact with no sidecar is refused (Q4). When nothing awaits decision, exit 0 with no session.
- Doctrine resolution: `phax-decide-spec` or `phax-decide-plan` by kind; a project-scope copy of the same name wins over the bundled one; `--doctrine` is appended after the skill; principle ids are anchored list items and citations are validated (Q3).
- A JSON-only decisions document validated at the boundary, with the total/complement/citation checks and per-arbiter rules. Nothing is written on failure. Exit families 0/5/8/12 as in §6.
- Each decision is appended to its question's `history` in the sidecar. The artifact is re-rendered with the deterministic renderer (§9 answered plus a decision log), one path-scoped commit, one decision record, and a failed session is recorded.
- Approve refuses on an arbitrated artifact with undecided, reopened or escalated questions. Unarbitrated artifacts approve as today.
- Approver attribution in both approvals ledgers (`approvedBy`: machine with grant | operator with name), with pre-existing records read as unattributed (Q5). Machine declaration via `--machine` (Q6).
- Decide and reopen allowed on Approved artifacts as in-place revisions (Q1). Plans gain structured `openQuestions` (Q2).
- The three doctrine skills ship and install like `phax-spec`, with content taken unchanged from the drafts.

Left open:

- Rendering prose for the Decision, Decision (escalated) and Reopened lines and the decision log entries; the spec's decision-log section number; the plan preamble section names.
- The spelling of `--machine` and of `history` / `approvedBy` and their nested keys; the decision record key and manifest layout.
- How the interactive session hands its decisions document to phax: a phax-named output file read on exit, or an in-session phax command. The document and its validation are the same either way.
- Where the local authoring session id is kept within the existing authoring session state directory.
- Whether a provider whose skills live in `.agents/skills` resolves the project override there. This follows `phax skills install`'s target mapping.

Constraints:

- Compose the headless-authoring machinery (prompt assembly, JSON-only provider session under the read-only posture, boundary decoding, deterministic renderers, path-scoped commit, record writer, sidecar agreement check). Do not fork it.
- The history in the sidecar is the single source of a question's state. §9, the decision log, `artifact status` and the approve refusal all derive from it and never from Markdown.
- `history` is required on every question and `openQuestions` is required in the plan document, with no optional-for-back-compat fields. Existing in-repo sidecars are migrated in the same change, and both document formats stay experimental (schema titles, README note). The authoring output either omits history or constrains it empty; the persisted sidecar requires it.
- `approvedBy` is required on every record phax writes. Tolerating its absence on read is the one deliberate exception (Q5), stated in the schema's documentation, not a general relaxation.
- The machine/operator approval form is shared with the headless-review spec; whichever lands second adopts the first's form.
- A re-rendered plan must still pass `phax plans lint`, parse on the deterministic path to the same projection, and have its extraction cache re-seeded. Plan open questions and the decision log therefore render in the preamble, before the first phase.
- The doctrine skills ship with the drafts' content unchanged except for the removed draft banner. The draft's `S0` stays a step, carried by `advocate`, not a citable principle.
- Transitions keep carrying the sidecar in their write-set, and the clean-file precondition of artifact auto-commits applies to decide and reopen.
- The local authoring session id never goes to the records branch, so the authoring record format is unchanged.

## 11. Docs page

Page: docs/arbitration.md

Reader: a loop author or operator who wants a spec's or plan's open questions answered under a written doctrine, reconsidered on demand, and needs to tell a machine's answer or approval from a human's

Example: phax artifact new spec plan-prune --headless --brief brief.md
phax artifact decide docs/specs/2609241300-plan-prune.md --headless --doctrine docs/doctrine/spec.md
phax artifact status docs/specs/2609241300-plan-prune.md
  Questions: 3 — open 0 · decided 2 (machine 2, operator 0) · escalated 1 (Q3)
phax artifact decide docs/specs/2609241300-plan-prune.md          # interactive: the operator answers Q3
phax artifact approve docs/specs/2609241300-plan-prune.md --machine steme-conductor
phax artifact decide docs/specs/2609241300-plan-prune.md --question Q1 --reopen --note "auto is cheap now"
phax artifact decide docs/specs/2609241300-plan-prune.md --headless   # Q1 is presented first, with its note
