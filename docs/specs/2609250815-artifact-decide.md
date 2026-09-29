---
status: Approved
date: 2026-09-25
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-29
  baseline: 50ea26c
---
# Artifact decide — arbitrating a spec's or plan's open questions

## 1. Context

Headless authoring (0.16.0) made a spec's open questions data. The spec document's `openQuestions[]` use spec 23's decision-request shape, `{ id, question, options[{ id, label, abandons }], recommendation, rationale }`. phax writes the document as a JSON sidecar (`<stamp>-<slug>.json`) beside the Markdown it renders from it. The sidecar travels with every lifecycle transition, and `artifact approve` refuses with exit 12 when the body diverges from the sidecar's rendering.

The plan document has no question structure. `preamble.technicalArbitrations` is a list of plain strings, rendered as a `## Technical arbitrations` bullet list. No code reads open questions back out of Markdown. The only extractor turns plan.md into the extracted plan and carries no arbitrations. The authoring record does not keep the provider session id, so no authoring session can be resumed today. `adjust-plan` is the precedent for a session id kept locally and resumed.

Approvals are recorded in two places:
- an `approved: { date, baseline }` frontmatter stamp;
- a record in `docs/specs/approvals.json` (`specFingerprint`, `approvedAt`, `baseline`) or `docs/plans/approvals.json` (the same plus `sourceSpec`).

Neither records who approved. Re-approving an Approved spec or plan is legal and is the supported in-place revision. An edited spec reads `Edited since: yes` and blocks plan approval against it. An edited plan is stale with `self-changed` evidence. The name `phax artifact reopen` is already taken: it moves a Stale plan back to Draft.

The three arbitration doctrines landed by hand on 2026-09-25 at `.claude/skills/phax-decide-spec`, `phax-decide-plan` and `phax-decide-review`, and `package.json` `files` already ships them. The skill catalog behind `phax skills install` still lists only `phax-planning`, `phax-cli` and `phax-spec`. Each doctrine rests on the ground `E0` (explicit over implicit) and five pairs, `C1`–`C5`, with a precedence order. Each adds its own principles: `S1`–`S10`, `P1`–`P9` or `R1`–`R7`. Every principle is a list item that opens with a backticked id.

The doctrines name two live modes:
- **interactive**: the human decides everything and the agent facilitates;
- **headless**: the agent decides within the menu and escalates three things: what is off-menu, what changes the public surface, and what reverses an earlier decision.

A third mode, headless total, is marked later. When no option fits, the arbiter writes its proposal and escalates. The proposal never wins by itself, but it is always recorded, so it is deferred rather than lost. Reversal is a cost, not a state: at equal value the arbiter prefers the option that is cheaper to reverse, and destruction is a floor that stops. The doctrines' output is `{ decisions: [{ id, chosen, abandoned[], advocate, why, principles[], reversibility, escalate }] }`, and the plan variant adds `phase`.

The first consumer is the steme roadmap-1.0 conductor. It authors every spec and plan headless, hands their open questions to a separate arbitration session and approves. When an answer must be reconsidered, it relays a human steering instruction, `rouvre <question>`.

Ground read:

- `docs/specs/archive/2609241227-artifact-decide.md` — The first draft, Abandoned 2026-09-25. I reused its structure. I replaced the content that the 2026-09-25 decisions changed: two modes, propose and escalate, reversibility as a cost, a decided doctrine format, and skills that have already landed.
- `docs/briefs/artifact-decide.md` — The brief, revised 2026-09-25.
- `docs/ideas/artifact-decide.md` — The idea (2026-09-24). It covers the decide command, the headless and interactive modes, the caller-owned doctrine, JSON output re-implanted into the sidecar, --reopen, a new session by default when headless and the authoring session resumed when interactive. Its open points are the question of re-running after approval, plan questions and the doctrine format.
- `.claude/skills/phax-decide-spec/SKILL.md` — Landed doctrine. It holds ground E0 and the pairs C1–C5 with a precedence order. S1–S10 are list items that open with a backticked id. S0 is a step, not a list-item id, and the advocate carries it. It defines the interactive, headless and headless-total (later) modes, propose and escalate, and reversal as a cost with destruction as a floor. Its output has reversibility cheap | costly | irreversible.
- `.claude/skills/phax-decide-plan/SKILL.md` — Landed doctrine P1–P9. Under P1, surface or §9 questions escalate to decide on the spec. The output adds phase. An escalated plan decision blocks plan approval.
- `.claude/skills/phax-decide-review/SKILL.md` — Landed doctrine R1–R7. This spec ships it, and review-plan loads it (headless-review spec).
- `package.json` — files already ships .claude/skills/phax-decide-spec, phax-decide-plan and phax-decide-review.
- `src/domain/skills/catalog.ts` — EXPOSED_SKILLS lists only phax-planning, phax-cli and phax-spec, so phax skills install does not know the decide skills.
- `src/schemas/specDocument.ts` — openQuestions[] uses the decision-request shape with no history. There are checks for duplicate ids and for a recommendation that names an option.
- `src/schemas/planDocument.ts` — preamble.technicalArbitrations is an array of plain strings. The plan document has no question structure.
- `src/domain/authoring/renderSpec.ts` — §9 renders each question as a heading, then option bullets with their abandons, then the Recommendation.
- `src/domain/authoring/renderPlan.ts` — ## Technical arbitrations renders as a bullet list, and only when it is non-empty.
- `src/domain/artifact/sidecar.ts` — The sidecar sits beside the artifact under the same name. Agreement is in-sync, diverged or invalid, and it ignores frontmatter.
- `src/app/artifactStatus.ts` — Status and transitions. Approval info is computed for specs only. Approve refuses a diverged or invalid sidecar with exit 12.
- `src/domain/artifact/status.ts` — Approved → Approved is legal for both specs and plans (in-place re-approval). Plans also have Stale.
- `src/domain/artifact/lineage.ts` — A spec has editedSinceApproval. Plan staleness evidence includes self-changed and spec-changed.
- `src/schemas/specApprovalRecord.ts` — Spec approval record: specFingerprint, approvedAt, baseline. No approver. Excess properties are rejected.
- `src/schemas/approvalRecord.ts` — Plan approval record: planFingerprint, approvedAt, baseline, sourceSpec. No approver. Excess properties are rejected.
- `src/schemas/authoringRecord.ts` — No provider session id is kept. The code comment says a headless session is never resumed.
- `src/schemas/adjustPlanSession.ts` — The interactive precedent: a locally kept sessionId, resumed later.
- `src/app/extractPlan.ts` — The only extractor turns plan.md into the extracted plan and carries no arbitrations. A grep of src/ finds no code that reads open questions back out of Markdown.
- `phax.usage.kdl` — Includes artifact reopen (a Stale plan back to Draft). A question reopen must not collide with that name.
- `docs/ideas/autopilot.md` — Decision policy: a loop is a decision answerer with a policy, and a machine-distinguishable approval is a prerequisite.
- `docs/specs/2608091526-phase-decision-requests.md` — Spec 23: the decision-request shape, and the rule that run decision requests are human-answered.
- `NEXT_STEPS.md` — Road to 1.0.0: additive only, and the persisted-format promise is still undecided. Three additive specs for the steme experiment; headless-authoring shipped 2026-09-23.
- `/Volumes/Work/steme/steme-corpus/docs/doctrine/01-vision/roadmap-1.0-experiment-protocol.md` — Not readable from this session (permission denied). The first consumer's contract (§3.3, §5.2, §8 rouvre) is taken from the brief, the idea note and NEXT_STEPS.

## 2. Problem

The open questions are data, but nothing answers them. A loop that wants them decided runs its own arbitration session outside phax. That session is unrecorded, its policy is a private brief, and it returns prose. The loop must splice the prose into the Markdown by hand, which diverges the sidecar and blocks `approve`.

The answers land nowhere structured. Neither `artifact status` nor a later reader can tell which questions are open or decided, on what principle, what was given up, or what the arbiter declined to decide. An arbiter that sees a better option than the menu offers has nowhere to put it, so the proposal is lost or, worse, silently adopted. A reconsideration such as `rouvre Q3` has no command.

The doctrines exist, but phax neither installs nor loads them, so no citation of `S1` or `P3` can be checked. Finally, an approval issued by a loop is recorded exactly like a human's. The approvals ledger cannot say that no human looked, and an unattended pipeline must never hide that.

## 3. Product goal

phax arbitrates an artifact's open questions with the operator, interactively. A spec or plan carries two sections: open questions and arbitrated questions. `phax artifact decide` opens a session under the doctrine: the agent raises the framing questions `F1`–`F5` first, then presents the open questions; the operator decides; the session returns the revised document — each decided question moved to the arbitrated section with its verdict, and the body revised where the verdict departs from the recommendation. phax checks the document deterministically, shows the body diff, and writes only what the operator accepts. decide runs on Draft only; `phax artifact reopen` brings an Approved artifact back to Draft, and `--question` re-arbitrates one question. Approval refuses while the open-questions section is not empty, for headless-authored and hand-authored artifacts alike. Every verdict and every approval names its arbiter. A headless mode is not specified: it will be built from the decision records these sessions leave. The CLI changes are additive except `--by`, required when approve or reopen runs without a terminal; every new or changed format carries `$schema` and stays readable in every shape (schemas-package).

> The operator decides. A question is open or arbitrated, never in between, and an arbitration that departs from the recommendation revises the body in the same gesture.

## 4. Terminology

- **Open question** — A question in `openQuestions`, in the decision-request shape { id, question, options[{ id, label, abandons }], recommendation, rationale }.
- **Arbitrated question** — An open question moved to `arbitratedQuestions` with its verdict, keeping every field it had. Earlier verdicts of a re-arbitrated question stay in its `history`.
- **Verdict** — The operator's answer to one question: `chosen` (an option id), `abandoned` (exactly the options not chosen), `why`, `advocate` (the strongest case for an abandoned option), `principles` (cited ids), `reversibility`, the arbiter and date, and `revised` (the body sections the verdict changed; empty when the verdict is the recommendation and nothing needed to change). A plan verdict also carries `phase`.
- **Framing questions** — `F1` who consumes this and what exactly does it read; `F2` what persists and how it is read in a year; `F3` how a thing is identified without its location; `F4` what can be removed; `F5` does the cited doctrine still say the operator's intent. From steme-corpus `roadmap-1.0-arbitration-reflexes.md` (2026-09-28/29): the decisive changes of the first real arbitrations came from these, never from the menus.
- **Revised document** — What an interactive session returns: the artifact's document with the decided questions moved to `arbitratedQuestions` and the body revised as their verdicts imply.
- **Interactive mode** — `phax artifact decide`: the framing questions, then the open questions; the operator decides, the agent facilitates and returns the revised document. The only mode.
- **Headless mode** — Not specified. It will be built from the decision records interactive sessions leave (verdicts, departures from the recommendation, framing corrections); steme's roadmap protocol measures when it is warranted.
- **Arbiter** — Who produced a verdict (the operator), an approval or an artifact reopen (a machine or the operator).
- **Reversibility** — The cost of undoing a verdict, on the scale cheap | costly | irreversible. It is a cost, not a state: at equal value the cheaper option is preferred.
- **Doctrine** — The instructions a decide session follows: the doctrine skill for the artifact kind, plus the optional --doctrine file appended after it.
- **Principle id** — A backticked id that opens a list item in a loaded doctrine, e.g. `S1`, `C4`, `P3`, or a project's `X1`. Decisions cite principle ids, and phax checks each citation.
- **Grant** — The label a caller declares with `--by machine:<grant>` to name the machine performing an approval or an artifact reopen, e.g. steme-conductor.
- **Machine / operator / unattributed approval** — An approval recorded with a grant, an approval recorded with the committing git identity, or an approval that predates attribution and is recorded explicitly as unattributed.
- **Decision record** — The record phax writes on phax/records/v1 for one decide session.
- **Artifact reopen** — `phax artifact reopen <path>`: today a Stale plan back to Draft; extended here to an Approved spec or plan back to Draft. It is the only way to arbitrate an approved artifact again.
- **Operator gesture** — An approval or an artifact reopen given with `--by operator`, or given without `--by` from a terminal. The operator is named by the committing git identity.
- **§9 format** — The layout the renderer gives both sections, which a hand-authored artifact follows for phax to read it: a `## 9. Open questions` section and a `## 9b. Arbitrated questions` section; each question a `### Q<n> — <question>` heading, one bullet per option `- <option id> — <label> — abandons: <loss>`, a `Recommendation: <option id> — <rationale>` line, then, in the arbitrated section, the `Decision:` block. For a plan, both sections sit in the preamble.

## 5. Functional requirements

### 5.1 An interactive session

WHEN `phax artifact decide` runs THE system SHALL open an interactive session where the agent first raises the framing questions `F1`–`F5`, then presents the open questions; the operator decides and the agent returns the revised document. The session resumes the artifact's authoring session when its id is kept and starts a new one otherwise, and prints which it did.

### 5.2 Authoring session id kept locally

WHEN a headless authoring session is spawned THE system SHALL keep its provider session id in local state outside the records branch.

### 5.3 Model and effort

The system SHALL resolve the decide session's model and effort from `--model` and `--effort` when given, and from the built-in catalog default otherwise.

### 5.4 Questions come from the sidecar

WHEN `decide` reads an artifact that has an in-sync sidecar THE system SHALL take the questions from the sidecar's `openQuestions` and `arbitratedQuestions`.

### 5.5 Questions from a hand-authored §9

WHEN `decide` reads an artifact that has no sidecar THE system SHALL take its open and arbitrated questions from its two sections in the §9 format, and SHALL refuse before any session, naming the first line that departs from the format, if they do not parse.

### 5.6 Hand-authored decisions written in place

WHEN verdicts land on a hand-authored artifact THE system SHALL move each decided question's block from the open-questions section to the arbitrated-questions section with its `Decision:` block, apply the body edits the operator accepted, and append the entries to the decision log, changing no other line.

### 5.7 Artifact preconditions

IF the artifact is not Draft, its sidecar is diverged or invalid, or the artifact or its sidecar has uncommitted changes THEN the system SHALL refuse `decide` before any session; for an Approved or Stale artifact the refusal names `phax artifact reopen <path>`.

### 5.8 Presentation order

WHEN `decide` starts THE system SHALL present, in order: the framing questions `F1`–`F5`; then the question named by `--question`, with its verdict when it is arbitrated; then the open questions.

### 5.9 Nothing to decide

IF the open-questions section is empty and `--question` is not given THEN the system SHALL spawn no session, write nothing, and exit 0 stating that there is nothing to decide.

### 5.10 Doctrine skill by artifact kind

The system SHALL load the doctrine skill `phax-decide-spec` into a decide session on a spec and `phax-decide-plan` into a decide session on a plan.

### 5.11 Project skill replaces the default

WHERE a skill of the same name is installed at project scope for the session's provider THE system SHALL load it in place of the bundled doctrine skill.

### 5.12 Doctrine file appended

WHERE `--doctrine <file>` is given THE system SHALL append the file's content after the doctrine skill in the session prompt.

### 5.13 Principle ids collected

The system SHALL take as the citable principle ids the backticked ids that open list items in the loaded doctrine skill and in the `--doctrine` file.

### 5.14 Doctrine file refused

IF the `--doctrine` file cannot be read, defines no principle id, or defines a principle id that the loaded skill also defines THEN the system SHALL refuse before spawning.

### 5.15 JSON-only decisions

WHEN a decide session ends THE system SHALL land only a revised document that validates against the artifact kind's document schema.

### 5.16 Invalid decisions land nothing

IF the session returns no document, returns something that is not JSON or fails the schema, or returns a document that does any of the following THEN the system SHALL fail, naming the first violation by path, and SHALL leave the working tree and HEAD unchanged: moves a question that was not presented; changes an open question it did not decide, or an arbitrated question other than one re-arbitrated; chooses an option the question does not list; lists as abandoned anything other than exactly the unchosen options; cites a principle id no loaded doctrine defines; breaks traceability (an acceptance criterion without its requirement, a requirement uncovered); or, on a plan, names a phase the plan does not have.

### 5.17 A decided question moves with its verdict

WHEN the operator decides a question THE system SHALL move it from `openQuestions` to `arbitratedQuestions` with its verdict, keeping every field it had.

### 5.18 A verdict revises the body it implies

WHEN a verdict departs from its question's recommendation THE revised document SHALL carry the body changes the verdict implies — requirements, surface, acceptance criteria, planning note — and the verdict SHALL name the sections it revised in `revised`.

### 5.19 The operator accepts the body diff

WHEN an interactive session returns its revised document THE system SHALL show the operator the diff of the rendered body before writing anything, and SHALL write nothing unless the operator accepts it.

### 5.20 Rate and usage limits

IF a decide session ends on a provider rate or usage limit THEN the system SHALL fail in the existing rate-limit exit family with nothing written.

### 5.21 Artifact changed during the session

IF the artifact or its sidecar changed while the decide session ran THEN the system SHALL refuse to write the decisions back, leaving those changes in place and committing nothing.

### 5.22 Decision attribution

The system SHALL attribute each verdict to the operator, named by the committing git identity, and record the loaded doctrine sources, provider, model and effort of the session.

### 5.23 Artifact re-rendered

WHEN a decide document lands THE system SHALL re-render the artifact with its deterministic renderer: the open questions, then the arbitrated questions with their verdicts, then a decision log listing every verdict in order.

### 5.24 One commit

WHEN `decide` writes an artifact THE system SHALL commit exactly the paths it wrote in one commit: the artifact and its sidecar, or the hand-authored artifact alone.

### 5.25 Commit failure

IF that commit fails THEN the system SHALL report an artifact error and leave both files written but uncommitted.

### 5.26 Decision record

WHEN a decide session ends after spawning and records are enabled THE system SHALL write a decision record. The record SHALL carry: the prompt; the doctrine sources with their fingerprints; the questions presented; the landed document and the body diff the operator accepted; the count of questions arbitrated and of verdicts that departed from the recommendation; the transcript (per the records transcript setting); provider, model, effort and usage; the outcome, committed or failed; and the commit when there is one.

### 5.27 Re-rendered plan never re-extracted

WHEN `decide` re-renders or rewrites a plan THE system SHALL re-seed the extraction cache with the plan's projection, so that `phax run` never extracts it through a model.

### 5.28 Re-arbitrating one question

WHERE `--question <id>` names an arbitrated question THE system SHALL present it with its verdict and, on a new verdict, keep the previous one in its history; WHERE it names an open question THE session SHALL take that question alone.

### 5.29 Unknown question refused

IF `--question` names a question the artifact does not have THEN the system SHALL refuse before any session and write nothing.

### 5.30 Artifact reopen from Approved

WHEN `phax artifact reopen` is given an Approved spec or plan THE system SHALL move it to Draft, remove its record from the approvals ledger, and commit the write-set in one commit whose trailer names the gesture's arbiter. Stale → Draft for plans is unchanged.

### 5.31 Artifact reopen refusals

IF `phax artifact reopen` is given a Draft, Completed or Abandoned artifact THEN the system SHALL refuse with exit 12 and write nothing.

### 5.32 Approval requires no open question

IF the open-questions section of a spec or plan — in its sidecar, or in the §9 format when hand-authored — is not empty THEN `phax artifact approve` SHALL refuse with exit 12, naming the open questions and `phax artifact decide <path>`.

### 5.33 A hand-authored §9 must parse

IF a hand-authored artifact has question sections that do not parse in the §9 format THEN `phax artifact approve` SHALL refuse with exit 12, naming the first line that departs. An artifact with neither section approves with no question check.

### 5.34 Machine gestures

WHERE `--by machine:<grant>` is given to `phax artifact approve` or `phax artifact reopen` THE system SHALL record that gesture as performed by a machine, naming the grant.

### 5.35 Operator gestures

WHEN `--by operator` is given, or no `--by` is given and the command runs from a terminal, THE system SHALL record the approval or reopen as performed by the operator, named by the committing git identity.

### 5.36 No terminal, no default

IF `phax artifact approve` or `phax artifact reopen` runs without `--by` and not from a terminal THEN the system SHALL refuse with exit 12, naming `--by operator` and `--by machine:<grant>`.

### 5.37 Every approval record names its approver

IF an approvals ledger record carries no approver THEN the system SHALL refuse to read the ledger, naming the record and the fix.

### 5.38 Unattributed approvals stay unattributed

WHEN phax reads an approval recorded as unattributed THE system SHALL present it as unattributed, never as an operator approval.

### 5.39 Status reports questions

WHEN `phax artifact status` inspects an artifact that has question sections THE system SHALL report the number of open and arbitrated questions, name the open ones, and name the decide command that answers them.

### 5.40 Status names the approver

WHEN `phax artifact status` reports an approval of a spec or a plan THE system SHALL name the approver's kind and identity.

### 5.41 Doctrine skills ship and install

The system SHALL list `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review` in its bundled skill catalog, so that `phax skills install` installs them exactly as it installs `phax-spec`.

### 5.42 Plan open questions

WHERE the artifact is a plan THE system SHALL read its questions from the plan document's `openQuestions` and `arbitratedQuestions` in the preamble, in the same shapes as a spec's.

### 5.43 Authoring emits open questions only

IF the document returned by an authoring session carries an arbitrated question THEN the system SHALL reject it as an invalid document.

## 6. Surface

### cli: phax artifact decide — normative

    phax artifact decide <artifact> [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>]

    $ phax artifact decide docs/specs/2609251400-plan-prune.md
    decide spec plan-prune — framing F1–F5, then Q1–Q3 — interactive, resumed authoring session
    Q1         arbitrated  manual       (recommended)
    Q2         arbitrated  keep-20      — departs: revises §5.4, §6 prune output, AC "keep bound"
    Q3         open        (not decided this session)
    body diff  3 sections — accept? [y/N] y
    commit     b2c3d4e — docs(specs): decide plan-prune Q1, Q2
    $? = 0

    ✗ decide refused: docs/specs/2609251400-plan-prune.md is Approved — reopen it first with `phax artifact reopen docs/specs/2609251400-plan-prune.md`
    $? = 12

    Exit: 0  decided and committed, declined diff, or nothing to decide
          5  no document, not JSON, or rejected by the schema or its checks
          8  provider rate or usage limit
          12 artifact refusal: not Draft, diverged/invalid sidecar, a hand-authored §9 that does not parse, uncommitted changes,
             bad doctrine file, unknown --question, artifact changed during the session, commit failed

    # normative: command and flag names, the exit families, the diff accepted before writing; output layout and wording indicative
    # no --headless: a headless mode is built later from the decision records

### file: revised document (the session's final message) — normative

    # the artifact's full spec (or plan) document, with openQuestions minus the decided ones and
    # arbitratedQuestions plus them, each with its verdict:
    "verdict": { "chosen": "keep-20", "abandoned": ["keep-10"], "why": "…", "advocate": "…",
                 "principles": ["S2"], "reversibility": "cheap", "by": { "kind": "operator", "name": "Ada Lovelace" },
                 "at": "2026-09-29T08:02:11Z", "revised": ["§5.4", "§6 phax prune output", "AC keep bound"] }

    # every key required, unknown keys rejected; chosen: a listed option id; plan verdicts add phase

### file: docs/specs/<stamp>-<slug>.json open and arbitrated questions — normative

before:

    "openQuestions": [
      { "id": "Q2", "question": "…", "options": [ … ], "recommendation": "keep-10", "rationale": "…" } ]

after:

    "openQuestions": [
      { "id": "Q4", "question": "…", "options": [ … ], "recommendation": "…", "rationale": "…" } ],
    "arbitratedQuestions": [
      { "id": "Q2", "question": "…", "options": [ … ], "recommendation": "keep-10", "rationale": "…",
                            "advocates": [ … ], "framing": { … }, "proposal": null, "principles": ["S2", "S5"], "reversibility": { … } },
        "verdict": { "chosen": "keep-20", "abandoned": ["keep-10"], "why": "…", "advocate": "…", "principles": ["S2"],
                     "reversibility": "cheap", "by": { "kind": "operator", "name": "Ada Lovelace" }, "at": "…",
                     "revised": ["§5.4", "§6 phax prune output", "AC keep bound"] },
        "history": [] } ]

    # normative: the two arrays, both required (empty when nothing), a question in exactly one of them; history holds earlier verdicts of a re-arbitrated question. Nested key spellings indicative.

### file: rendered spec — §9 answered and a decision log — normative

before:

    ## 9. Open questions for implementation planning

    ### Q3 — Is the prune policy a config key?

    - manual — … — abandons: …
    - auto — … — abandons: …

    Recommendation: manual — …

after:

    ## 9. Open questions

    ### Q4 — …

    - a — … — abandons: …
    - b — … — abandons: …

    Recommendation: a — …

    ## 9b. Arbitrated questions

    ### Q2 — …

    - keep-10 — … — abandons: …
    - keep-20 — … — abandons: …

    Recommendation: keep-10 — …

    Decision: keep-20 — by operator (Ada Lovelace), 2026-09-29
    Why: … Principles: S2. Reversibility: cheap. Revised: §5.4, §6 phax prune output, AC keep bound.

    ## 12. Decision log

    - 2026-09-29 Q2 decided keep-20 — operator (Ada Lovelace) — revised 3 sections

    # normative: two sections, open then arbitrated; under an arbitrated question its
    # Decision block with the revised sections; a final Decision log when any question is arbitrated. Wording indicative.

### file: hand-authored §9 in the §9 format — normative

before:

    ## 9. Open questions for implementation planning

    **Q2 — Fonts: self-hosted in the package, or loaded from Google Fonts?**

    - Google Fonts link — abandons: no-third-party-request pages …
    - Self-hosted files (both faces are OFL) — abandons: package weight …

    Recommendation: self-host in `brand/fonts/` …

after:

    ## 9. Open questions

    ### Q3 — …
    - a — … — abandons: …
    - b — … — abandons: …

    Recommendation: a — …

    ## 9b. Arbitrated questions

    ### Q2 — Fonts: self-hosted in the package, or loaded from Google Fonts?

    - google — a Google Fonts link — abandons: no-third-party-request pages …
    - self-hosted — self-hosted files (both faces are OFL) — abandons: package weight …

    Recommendation: self-hosted — self-host in `brand/fonts/` …

    Decision: self-hosted — by operator (Rémy Loubradou), 2026-09-28      ← written by decide, or by hand
    Why: … Principles: … Reversibility: cheap. Revised: none.

    ## 12. Decision log

    - 2026-09-28 Q2 decided self-hosted — operator (Rémy Loubradou)

    # normative: the two section headings, the question, option-bullet, Recommendation and Decision line shapes; a hand-authored
    # artifact is converted to them once. Approve requires the open section to be empty. Wording indicative.

### file: docs/plans/<stamp>-<slug>-plan.json open and arbitrated questions — indicative

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
        { "id": "Q1", "question": "Does phase-02 or phase-03 own the registry write?",
          "options": [ { "id": "p2", "label": "phase-02 writes it", "abandons": "…" },
                       { "id": "p3", "label": "phase-03 writes it", "abandons": "…" } ],
          "recommendation": "p2", "rationale": "…" } ],
          "arbitratedQuestions": []
    }

    # per §9 Q2: rendered in the preamble before the first phase as "## Open questions" and "## Arbitrated questions" (the §9 layout) and "## Decision log";
    # settled arbitrations stay prose in technicalArbitrations; the rendered plan still passes `phax plans lint`
    # and projects to the same extracted plan

### cli: phax artifact status — normative

before:

    Path:              docs/specs/2609251400-plan-prune.md
    Kind:              spec
    Status:            Approved
    Authored:          headless — sidecar docs/specs/2609251400-plan-prune.json (in sync)
    Approved:          2026-09-25 @ a1b2c3d
    Edited since:      no
    Legal transitions: Completed, Abandoned

after:

    Path:              docs/specs/2609251400-plan-prune.md
    Kind:              spec
    Status:            Draft
    Authored:          headless — sidecar docs/specs/2609251400-plan-prune.json (in sync)
    Questions:         4 — open 2 (Q3, Q4) · arbitrated 2
      decide with `phax artifact decide docs/specs/2609251400-plan-prune.md`
    Legal transitions: Approved (once no question is open), Abandoned

    # an Approved artifact prints `Approved: <date> @ <sha> by machine (steme-conductor)` (or operator (…) | unattributed);
    # a hand-authored artifact whose §9 parses prints the same Questions line; plans print the same lines.
    # normative: open and arbitrated counts, the open ids, the approver kind and identity; layout indicative

### cli: phax artifact approve — normative

before:

    phax artifact approve <path>
    Status:   Approved
    Baseline: a1b2c3d
    Commit:   c3d4e5f — …

after:

    phax artifact approve <path> [--by operator | --by machine:<grant>]

    $ phax artifact approve docs/specs/2609251400-plan-prune.md --by machine:steme-conductor
    Status:   Approved
    Approver: machine (steme-conductor)
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

    # normative: the --by values, the terminal default, the refusals with exit 12; wording indicative

### cli: phax artifact reopen — normative

before:

    phax artifact reopen <plan>        # Stale plan → Draft only

after:

    phax artifact reopen <path> [--by operator | --by machine:<grant>]   # Approved spec or plan → Draft; Stale plan → Draft

    $ phax artifact reopen docs/specs/2609251400-plan-prune.md --by machine:steme-conductor
    Status:   Draft (was Approved; approval record removed)
    Commit:   d4e5f6a — chore(specs): reopen plan-prune   [Reopened-By: machine (steme-conductor)]
    $? = 0

    ✗ reopen refused: docs/specs/2609251400-plan-prune.md is Draft
    $? = 12

    # normative: the transitions, the removed approval record, the arbiter in the commit; trailer spelling indicative

### file: docs/specs/approvals.json and docs/plans/approvals.json records — normative

before:

    "docs/specs/2609251400-plan-prune.md": {
      "specFingerprint": "b19da59f…",
      "approvedAt": "2026-09-25T09:28:11.427Z",
      "baseline": "67e20c37…"
    }

after:

    "docs/specs/2609251400-plan-prune.md": {
      "specFingerprint": "b19da59f…",
      "approvedAt": "2026-09-25T09:28:11.427Z",
      "baseline": "67e20c37…",
      "approvedBy": { "kind": "machine", "grant": "steme-conductor" }
    }

    # or { "kind": "operator", "name": "Ada Lovelace" }, or { "kind": "unattributed" } for a record that predates this change;
    # required on every record (§9 Q4); the same key joins plan records. Kinds normative; key spelling indicative;
    # the form is shared with the headless-review spec. The grant comes from `--by machine:<grant>`.

    ✗ docs/plans/approvals.json: record "docs/plans/2609010900-legacy-plan.md" has no approvedBy —
      add "approvedBy": { "kind": "unattributed" } to records that predate approver attribution
    $? = 12

### file: decision record on phax/records/v1 — indicative

    decision/2609251400-plan-prune/01/
      record.json   { version: 1, kind: "decision", artifact: "docs/specs/2609251400-plan-prune.md", artifactKind: "spec",
                      mode: "interactive", session: "new" | "resumed-authoring",
                      doctrine: [ { kind: "skill", name: "phax-decide-spec", source: "bundled" | "project", fingerprint: "…" },
                                  { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "…" } ],
                      questions: ["Q1", "Q2", "Q3"], arbitrated: 3, departed: 1, sourceSha: "…", provider, model, effort,
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

- A headless mode. It will be built from the decision records interactive sessions leave (verdicts, departures from the recommendation, framing corrections); steme's roadmap protocol measures when.
- A decision queue UI or desktop inbox. This spec provides the data and the status line, nothing visual.
- Multi-human arbitration: several operators, votes, required reviewers or per-question owners. The operator is whoever commits.
- Editing a question's wording or its options from within decide. The body is revised only as a verdict implies, and only once the operator accepts the diff.
- Writing the doctrine skills' text. It is the author's; their headless sections stay unused until a headless mode is specified.
- Loading `phax-decide-review` from decide. It ships here and is consumed by review-plan (headless-review spec).
- Changing how headless authoring loads `phax-spec` and `phax-planning`. The project-skill override applies to the decide doctrines only.
- A `phax.json` key for the decide model and effort. One can be added later without breaking anything.
- Answering run decision requests (spec 23) or any autopilot loop. Run decision requests stay human-answered.
- Parsing a steering file. Mapping `rouvre Q3` to `phax artifact reopen` plus `decide --question Q3` is the caller's job.
- The approver in the frontmatter `approved` stamp. The approvals ledger is the single source of who approved.
- A stability promise for the question-history, decisions and approver formats beyond schemas-package's: they are new shapes, identified by `$schema` and readable in every shape, like every persisted format.
- Extracting open questions from a free-form Markdown layout. A hand-authored artifact follows the §9 format, converted once by hand.

## 8. Acceptance criteria

### An interactive session lands the revised document and names the operator

Given a headless-authored spec with a kept authoring session id and open questions Q1 and Q2, and another spec whose local authoring state is gone, when `phax artifact decide <spec>` runs on each; in the first the operator decides Q1 and accepts the diff, in the second the operator ends the session without a document, then The first run resumes the kept authoring session, the second starts a new one, and each prints which it did; the kept id appears nowhere on the records branch. In the first run the agent raised the framing questions first; Q1 moves to `arbitratedQuestions` with a verdict attributed to the operator by the committing git identity; Q2 stays open; §9 is re-rendered; the artifact and its sidecar are the only paths in the new HEAD commit. The second run writes nothing. (refs §5.1, §5.2, §5.4, §5.10, §5.15, §5.22, §5.23, §5.24, §5.17, §5.16)

### Model resolves from flag, then catalog

Given a headless-authored spec, when `phax artifact decide <spec>` runs without `--model`, and again with `--model` and `--effort`, then The first session uses the catalog default and prints it. The second uses the flags. (refs §5.3)

### Hand-authored artifact decided in place

Given a spec with no sidecar whose §9 format holds open Q1 and Q2, and another whose questions use bold headings, when interactive `phax artifact decide` runs on the first and the operator decides Q1 and accepts the body diff, then `phax artifact approve` runs on it, then decide runs on the second, then Q1's block moves to the arbitrated-questions section with its `Decision:` block, the accepted body edits apply, and one decision-log entry is added; the new HEAD commit holds that file alone. Approve exits 12 naming Q2. Decide on the second exits 12 naming the first bold heading, and no session is spawned. (refs §5.5, §5.6, §5.24, §5.32)

### Preconditions refuse before the session

Given a spec whose sidecar has diverged, a spec with an uncommitted change, a Completed spec, and an Approved spec, when `phax artifact decide <spec>` runs on each, then each run exits 12 and no session is spawned; the Approved spec's refusal names `phax artifact reopen`. (refs §5.7)

### Framing first; re-arbitrating one question

Given a Draft spec where Q1 is arbitrated and Q2 and Q3 are open, when interactive decide runs, then interactive decide runs with `--question Q1`, then with `--question Q9`, then The first session raises `F1`–`F5` first, then presents Q2 and Q3. The second presents Q1 alone with its verdict; a new verdict keeps the previous one in Q1's history. The third exits 12 and writes nothing. (refs §5.8, §5.28, §5.29)

### Nothing to decide

Given a headless-authored spec whose `openQuestions` is empty (every question arbitrated), when `phax artifact decide <spec>` runs, then it exits 0 stating that there is nothing to decide, no session is spawned, and no commit is made. (refs §5.9)

### Project skill replaces the default and the doctrine file is appended

Given a project-scoped `.claude/skills/phax-decide-spec/SKILL.md` that differs from the bundled one, and a `docs/doctrine/spec.md` whose list item opens with `X1`, when `phax artifact decide <spec> --doctrine docs/doctrine/spec.md` runs, then The prompt contains the project skill's text followed by the doctrine file. Decisions citing `X1` or `C4` are accepted. A decision citing `S0` (named only inside a step, never opening a list item) is rejected. The decision record names the skill source as project, with its fingerprint. (refs §5.11, §5.12, §5.13)

### Bad doctrine file refused

Given a `--doctrine` file that is unreadable, one that defines no principle id, and one whose list item opens with `S1`, when decide runs with each, then each run exits 12 and no session is spawned. (refs §5.14)

### Invalid decisions land nothing

Given records enabled, and sessions that return, respectively: prose; a verdict citing `S12`; a revised document moving a question that was not presented; a `chosen` option the question does not list; an `abandoned` list that is not exactly the unchosen options; a plan verdict naming a phase the plan lacks, when each session ends, then Each run exits 5 naming the violation path. The working tree and HEAD are unchanged. A decision record exists with outcome `failed`. (refs §5.16, §5.26)

### Revision rules

Given these revised documents: one that edits open question Q2, which the operator did not decide; one that drops arbitrated question Q3; one whose acceptance criterion references a requirement it removed, when each is validated, then each is rejected with exit 5, naming the violating path, and nothing is written. (refs §5.16)

### Rate limit lands nothing

Given a headless decide session that ends on a provider usage limit, when the session ends, then the run exits 8 and nothing is written or committed. (refs §5.20)

### Concurrent edit refused

Given an interactive decide session during which the artifact file is modified, when the session returns a valid decisions document, then the run exits 12, the modification is left in place, and no commit is made. (refs §5.21)

### Commit failure leaves the files

Given a valid decisions document and a commit that fails, when decide writes the artifact and sidecar, then the run exits 12, and both files are written but uncommitted. (refs §5.25)

### Record explains the decisions

Given records enabled and an interactive decide commit at `<sha>` that arbitrated two questions and revised one requirement, when `phax records explain <sha>` runs, then It shows the prompt, the doctrine sources with fingerprints, the questions presented, the landed document, the accepted body diff, `arbitrated: 2`, `departed: 1`, model, effort, usage and outcome `committed`. (refs §5.26)

### Status counts questions by state and arbiter

Given a spec with Q1 and Q2 arbitrated and Q3 and Q4 open, approved earlier with `--by machine:steme-conductor`, when `phax artifact status <spec>` runs, then It prints: open 2, naming Q3 and Q4; arbitrated 2; the decide command; and `by machine (steme-conductor)` on the Approved line. A plan in the same situation prints the same lines. (refs §5.39, §5.40)

### Approval requires no open question

Given a headless-authored spec with open questions, a hand-authored spec whose §9 format has an empty open section and every question arbitrated, and a hand-authored spec with no question section, when `phax artifact approve` runs on each, then The first exits 12 naming its open questions and `phax artifact decide`. The second and third approve. (refs §5.32, §5.33)

### Approvals name their approver

Given a spec ready for approval, when `phax artifact approve <spec> --by machine:steme-conductor` runs; separately the same command runs from a terminal without `--by`; separately it runs without `--by` from a script with no terminal, then The approvals.json record carries `approvedBy` `{ kind: machine, grant: steme-conductor }` in the first case and `{ kind: operator, name: <git user.name> }` in the second; `phax artifact status` prints `by machine (steme-conductor)` or `by operator (<name>)` accordingly. The third exits 12 naming `--by`, and nothing is written. (refs §5.34, §5.35, §5.36, §5.40)

### Pre-attribution records are explicit

Given an approvals.json record with `approvedBy: { kind: unattributed }`, and a ledger with a record lacking `approvedBy`, when `phax artifact status` inspects the first record's artifact, and `phax artifact approve` runs on a plan whose ledger is the second, then Status prints the first approval as unattributed, never as operator. The approve exits 12 naming the record and the fix. (refs §5.38, §5.37)

### Artifact reopen returns an Approved artifact to Draft

Given an Approved spec, a Draft spec, and a Stale plan, when `phax artifact reopen <path> --by machine:steme-conductor` runs on each, then `decide --question Q1` runs on the reopened spec, then The Approved spec is Draft, its record is gone from docs/specs/approvals.json, and the transition commit names `machine (steme-conductor)`. The Draft spec's reopen exits 12 and writes nothing. The Stale plan reopens to Draft as today. The decide then runs on the reopened spec. (refs §5.30, §5.31, §5.34, §5.7)

### Doctrine skills ship and install

Given an installed phax package, when `phax skills install --target claude --scope project` runs in an empty project, then `.claude/skills/phax-decide-spec/SKILL.md`, `phax-decide-plan/SKILL.md` and `phax-decide-review/SKILL.md` exist, each byte-identical to the landed copy in the phax repository. (refs §5.41)

### Plan decide keeps the plan executable

Given a headless plan whose preamble holds open questions Q1 and Q2, when interactive decide runs and the operator decides Q1 with `phase: phase-02`, then The session loads `phax-decide-plan`. Q1 is in `arbitratedQuestions` with `phase: phase-02`. The re-rendered plan passes `phax plans lint` with no structure error, and `phax run` finds its projection without spawning an extraction session. `phax artifact approve <plan>` exits 12 naming Q2. (refs §5.42, §5.27, §5.10, §5.32)

### Authoring emits open questions only

Given a headless authoring session whose document carries an arbitrated question, when the session ends, then the run exits 5 and nothing is written. (refs §5.43)

### A departing verdict revises the body, after the operator accepts the diff

Given a spec whose open question Q4 recommends `structural`, a requirement written for that recommendation, and an acceptance criterion referencing it, when interactive decide runs and the operator chooses `oracle` for Q4; the session returns the revised document; the operator first declines the diff, then runs again and accepts it, then The declined run writes nothing. The accepted run commits Q4 in `arbitratedQuestions` with `chosen: "oracle"` and `revised` naming the requirement and the criterion, both rewritten for `oracle`, and traceability intact. A verdict equal to the recommendation lands with `revised: []` and no body diff. (refs §5.18, §5.19, §5.17)

## 9. Open questions for implementation planning

### Q1 — May `decide` and a question reopen run on an Approved artifact, and what becomes of its approval?

- Allowed on Draft and Approved. The artifact stays Approved but reads edited since approval (spec) or self-changed (plan) until it is re-approved, which is the existing in-place revision. — abandons: a status that says the approval is void. Until re-approval, the artifact still reads Approved, and only `Edited since` and the Questions line show the change.
- A decide or reopen on an Approved artifact moves it back to Draft through a new Approved → Draft transition. — abandons: the lifecycle graph of specs 21/22 (it gains a backward edge) and approval continuity: every plan bound to the spec loses its Approved source at once
- Refuse decide and reopen once the artifact is Approved. — abandons: steering after approval: a `rouvre` on an approved spec would force abandoning and re-authoring it
- Decide runs on Draft only; `phax artifact reopen` moves an Approved spec or plan back to Draft, removing its approval record — abandons: steering an approved artifact without voiding its approval: every re-arbitration first costs a reopen and a re-approval

Recommendation: Decide runs on Draft only; `phax artifact reopen` moves an Approved spec or plan back to Draft, removing its approval record — Decided by the author on 2026-09-28. An approved artifact is not arbitrated: `decide` runs on Draft only, and `phax artifact reopen` — extended from Stale plans to Approved specs and plans — is the one gesture back to Draft. The approval is voided visibly instead of lingering as an in-place revision.

### Q2 — Do plans need a structured open-questions section in their document schema?

- Add `openQuestions` to the plan preamble, in the decision-request shape plus `history`, rendered before the first phase. Settled arbitrations stay prose in `technicalArbitrations`. — abandons: an unchanged plan document schema: the experimental format and the planning skill's document table change, and in-repo plan sidecars are migrated
- Decide specs only in this spec, and refuse plans until a later spec. — abandons: the plan doctrine (P1–P9) and the first consumer's plan arbitrations, which would stay in a private session
- Turn `technicalArbitrations` itself into decision requests. — abandons: settled arbitrations as one-line prose: every already-decided arbitration would have to be restated as a question with options

Recommendation: Add `openQuestions` to the plan preamble, in the decision-request shape plus `history`, rendered before the first phase. Settled arbitrations stay prose in `technicalArbitrations`. — Decided by the author on 2026-09-28. Today the plan document has no question structure, so decide on plans needs one. Adding it beside the settled list keeps decided things as prose and gives open things the same shape as a spec's §9 (C1). Rendering in the preamble keeps plan lint and the deterministic projection untouched.

### Q3 — How does phax know that an approval or a reopen is a machine's?

- The caller declares it with `--machine <grant>`. Without the flag, the gesture is the operator's. — abandons: enforcement: a loop that omits the flag is recorded as the operator, so attribution is honest by declaration only
- No TTY means machine. — abandons: determinism and scripted operators: the same command records differently depending on the terminal, and a human's scripted approval is labelled machine
- `phax artifact approve` always requires `--by operator|machine:<grant>`. — abandons: every existing `artifact approve` invocation: a breaking CLI change against the additive constraint
- `--by operator | machine:<grant>`, required when not run from a terminal; from a terminal without it, the operator — abandons: an unchanged scripted `approve`: every non-terminal caller must add `--by`

Recommendation: `--by operator | machine:<grant>`, required when not run from a terminal; from a terminal without it, the operator — Decided by the author on 2026-09-28. At a terminal the operator is the honest default; without one, phax refuses to guess and asks `--by`. A loop that forgets to declare itself is refused rather than recorded as a human. A machine inside a pseudo-terminal would still default to the operator; the risk is accepted as far narrower than 'no flag means human'. Scripted approvals must add `--by`.

### Q4 — What does an approval record without attribution read as?

- `approvedBy` is required on every record, with an explicit `{ kind: unattributed }` variant. In-repo ledgers are rewritten to it in the same change. A record lacking the key is refused, naming the record and the one-line fix. — abandons: loading an untouched pre-change ledger in another repo as is: it must be edited once before phax reads it again
- `approvedBy` is written on every new record, and an absent key reads as unattributed. — abandons: the no-shims rule on a persisted schema: a field required on write but tolerated absent on read, which is a standing back-compat path
- A record without `approvedBy` reads as an operator approval. — abandons: the guarantee this spec exists for: a scripted pre-change approval would be presented as human

Recommendation: `approvedBy` is required on every record, with an explicit `{ kind: unattributed }` variant. In-repo ledgers are rewritten to it in the same change. A record lacking the key is refused, naming the record and the one-line fix. — Decided by the author on 2026-09-28. Unknown is the only honest reading of a record that predates attribution, and E0 says to write it rather than infer it. phax's rule is that new persisted fields are required, not optional-for-old-data. approvals.json is not yet under a stability promise (Road to 1.0 leaves that open). The steme experiment pins the release that carries this change and has not started, so the ledgers that need migrating are phax's own, rewritten in the same change. The refusal names the exact fix for any other repo.

### Q5 — What does `artifact status` show for an artifact with an escalated proposal pending?

- The Questions line names the escalated ids and the decide command that answers them. The proposal text lives only in the rendered artifact, under its question. — abandons: reading the proposal without opening the artifact
- Print each pending proposal under the Questions line. — abandons: a status whose length stays bounded, and one reading surface for the proposal: the text is duplicated between status and the artifact
- No status change: escalations appear only in decide's output. — abandons: a later reader or loop learning of pending escalations without re-running decide

Recommendation: Print each pending proposal under the Questions line. — Superseded on 2026-09-29 by Q14: with no headless mode, no machine proposal exists. Decided by the author on 2026-09-28. Status is where an operator looks first; the proposal text is printed there so no escalation waits unseen. The rendered artifact stays the source of the text.

### Q6 — What does decide do with a hand-authored artifact that has no sidecar?

- Decide and reopen refuse it, naming the remedy: re-author it headless, or answer its §9 by hand. — abandons: arbitration of hand-authored artifacts: a human who writes a spec interactively still answers its §9 by hand, as today
- A new model extraction of §9 or the plan's arbitrations, with decisions kept in a file beside the artifact and decision lines spliced into the hand-written Markdown. — abandons: one home for decisions and the rule that phax edits Markdown only by rendering it: decisions would live in the sidecar for one artifact and in another file for the next
- decide reads and writes a hand-authored §9 in the §9 format — abandons: phax editing Markdown only by rendering it: for a hand-authored artifact it writes the question blocks and the decision log in place

Recommendation: decide reads and writes a hand-authored §9 in the §9 format — Decided by the author on 2026-09-28. Every question is answered before approval, whatever authored the artifact, so phax must read a hand-written §9. It does so deterministically in the layout the renderer already produces, and decide writes only the question blocks and the decision log.

### Q7 — How does an operator adopt an escalated off-menu proposal?

- An interactive decision on an escalated question may set `chosen: "proposal"`: the escalated proposal becomes the answer, and every listed option is abandoned. — abandons: every answer being one of the authored options with a pre-named loss: the adopted proposal's loss is only what the operator writes in `why` and `advocate`
- A proposal is adopted only by re-authoring the artifact with a brief that folds it in. — abandons: the question's history, and a cheap path for an accepted proposal: one accepted idea costs a whole re-authoring
- The operator chooses within the menu only, and the proposal stays a record. — abandons: the better move the arbiter found: the proposal is recorded but can never win

Recommendation: An interactive decision on an escalated question may set `chosen: "proposal"`: the escalated proposal becomes the answer, and every listed option is abandoned. — Superseded on 2026-09-29 by Q14: with no headless mode, no machine proposal exists. Decided by the author on 2026-09-28. The operator re-runs decide interactively; the escalated proposal appears among the choices, tagged as a machine proposal, and choosing it is an operator decision. A headless arbiter never chooses a proposal.

### Q8 — How is an already decided question arbitrated again?

- On a Draft, `decide --question <id>` re-arbitrates it; the new decision joins its history, and a machine reversal escalates — abandons: a note-carrying reopened state that waits for the next decide
- Keep `decide --question <id> --reopen --note`, a reopened state presented first — abandons: one fewer state and flag, and a name distinct from `phax artifact reopen`

Recommendation: On a Draft, `decide --question <id>` re-arbitrates it; the new decision joins its history, and a machine reversal escalates — Decided by the author on 2026-09-28. With decide on Draft only, reopening the artifact is the gesture; a question needs no state of its own.

### Q9 — Which artifacts does the approval lock cover?

- Every spec and plan: undecided or escalated questions refuse approval, with or without a sidecar — abandons: approving a hand-authored artifact whose §9 is not in the §9 format until it is converted
- Every artifact with a sidecar — abandons: the guarantee for hand-authored artifacts
- Only artifacts already arbitrated — abandons: the guarantee for any artifact never passed through decide

Recommendation: Every spec and plan: undecided or escalated questions refuse approval, with or without a sidecar — Decided by the author on 2026-09-28. The choice taken is now recorded in every case — interactive, by hand or headless — so every open question is answered before approval.

### Q10 — How does approve know that a hand-authored question is decided?

- Each question follows the §9 format and is decided when its last block is a `Decision:` block — abandons: free-form §9 layouts: hand-authored artifacts are converted once
- A hand-authored artifact approves only with no open-questions section left — abandons: the arbitration trail in the document

Recommendation: Each question follows the §9 format and is decided when its last block is a `Decision:` block — Decided by the author on 2026-09-28. The same layout the renderer produces keeps one format for both kinds of artifact, and the trail stays in the document.

### Q11 — Where does an arbitrated question go?

- An `arbitratedQuestions` section: arbitrating moves the question with everything it had, plus its verdict — abandons: one list to read: the decided questions sit apart from the open ones
- One section; each question gains a Decision block — abandons: seeing at a glance that nothing is left: every question must be read

Recommendation: An `arbitratedQuestions` section: arbitrating moves the question with everything it had, plus its verdict — Decided by the author on 2026-09-29: an empty open section says there is nothing left to do, and approval checks exactly that.

### Q12 — Who rewrites the body when a verdict departs from the recommendation?

- The interactive session returns the revised document; phax checks it and shows the body diff; the operator accepts — abandons: a decide gesture that writes only verdicts
- decide writes the verdict; a separate `artifact revise` rewrites the body; approval blocked in between — abandons: one gesture, and a spec that never contradicts its verdicts
- The operator revises the body by hand — abandons: a spec consistent with its verdicts until someone fixes it

Recommendation: The interactive session returns the revised document; phax checks it and shows the body diff; the operator accepts — Decided by the author on 2026-09-29. A headless-authored body is written for its recommendations; the 2026-09-28 arbitrations had to rewrite requirements, surfaces and criteria by hand wherever the verdict departed.

### Q13 — What does a headless decide session produce?

- Pre-arbitration: the case for each abandoned option, a recommendation, answers to `F1`–`F5`, proposals; it decides nothing — abandons: an unattended loop that settles questions
- The same, plus a prepared body revision for every option — abandons: a small output: much generated text for options that will not be taken
- Machine verdicts within the menu, escalating the rest (the previous design) — abandons: the author's framing judgement, which made the decisive changes of the first arbitrations

Recommendation: Pre-arbitration: the case for each abandoned option, a recommendation, answers to `F1`–`F5`, proposals; it decides nothing — Superseded on 2026-09-29 by Q14. Decided by the author on 2026-09-29 (steme-corpus protocol §5 complement): arbitration stays interactive until the measure says otherwise.

### Q14 — Is there a headless mode at all in this spec?

- No: decide is interactive only; a headless mode is built later from the recorded sessions — abandons: any unattended arbitration for now
- Headless pre-arbitration (Q13) — abandons: not redoing work: the authoring session already wrote the options, their losses and a recommendation, and the operator arbitrates again anyway

Recommendation: No: decide is interactive only; a headless mode is built later from the recorded sessions — Decided by the author on 2026-09-29: pre-arbitration repeats what authoring already did, and the operator redoes it; the recorded interactive sessions are what a headless mode will be built from.

## 10. Implementation-planning note

Settled:

- One mode, interactive: the framing questions `F1`–`F5`, the operator's verdicts, the revised document, the body diff accepted before writing (Q14). No `--headless`, no `--resume-authoring`, no machine proposal.
- Two sections, `openQuestions` and `arbitratedQuestions`; a decided question moves with its verdict; approval requires the open section to be empty (Q11, Q9).
- A verdict that departs from the recommendation revises the body in the same document; phax checks what moved, what stayed and traceability, shows the body diff, and writes only what the operator accepts (Q12).
- The three doctrine skills are registered in the skill catalog and install like `phax-spec`.
- Doctrine resolution: `phax-decide-spec` or `phax-decide-plan` by kind; a project-scope copy of the same name wins over the bundled one; `--doctrine` is appended after it. Principle ids are the backticked ids that open list items, and every citation is validated. This format is decided, not open.
- The input is the sidecar, or for a hand-authored artifact its §9 in the §9 format (Q6, Q10). With nothing awaiting decision, decide exits 0 with no session.
- decide runs on Draft only; `phax artifact reopen` extends to Approved → Draft and removes the approval record (Q1). `--question` re-arbitrates one question; there is no reopened state (Q8).
- Approver attribution in both approvals ledgers: `--by machine:<grant>`, `--by operator`, the operator by default from a terminal, a refusal without a terminal, and explicit unattributed for old records (Q3, Q4). Status prints escalated proposals (Q5). Plans gain structured `openQuestions` (Q2).

Left open:

- Rendering prose for the Decision block and the decision-log entries; the plan preamble section names.
- The spelling of the `--by` values, the reopen trailer, `history` and `approvedBy` and their nested keys; the decision record key and manifest layout.
- How the interactive session hands its revised document to phax, and how the body diff is shown and accepted: a phax-named output file read on exit, or an in-session phax command. The document and its validation are the same either way.
- Where the authoring session id is kept within local state (the adjust-plan session precedent).
- How a provider whose skills live in `.agents/skills` resolves the project override. This follows `phax skills install`'s target mapping.
- The built-in default model and effort for decide, chosen from the catalog on cost.

Constraints:

- Compose the headless-authoring machinery: prompt assembly, the JSON-only provider session, boundary decoding, deterministic renderers, the path-scoped commit, the record writer and the sidecar agreement check. Do not fork it.
- For a headless-authored artifact the sidecar's `openQuestions` and `arbitratedQuestions` are the single source of a question's state; for a hand-authored one, its two §9 sections are, parsed deterministically. §9, the decision log, `artifact status` and the approve refusal derive from that source.
- `history` is required on every question, and `openQuestions` is required in the plan document; no optional-for-back-compat fields. Existing in-repo sidecars are migrated in the same change. The authoring output emits no history (rejected otherwise); every new or changed format carries `$schema` and is recorded as a new shape by schemas-package's snapshot gate.
- `approvedBy` is required on every approvals record. phax's own ledgers are rewritten to `unattributed` in the same change (Q4).
- The machine/operator approval form is shared with the headless-review spec; whichever spec lands second adopts the first's form.
- A re-rendered plan must still pass `phax plans lint`, parse on the deterministic path to the same projection, and have its extraction cache re-seeded.
- The local authoring session id never goes to the records branch, so the authoring record format is unchanged.
- Transitions keep carrying the sidecar in their write-set, and the clean-file precondition of artifact auto-commits applies to decide and to artifact reopen.
- A project that installs the default skills at project scope pins that copy. The decision record's skill source and fingerprint make that drift visible; nothing else is added for it.
- The landed doctrine skills describe a headless mode that decides and escalates; decide loads them for the interactive session, whose facilitation they guide, and their headless sections stay unused until a headless mode is specified.

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
