---
status: Approved
date: 2026-09-25
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-28
  baseline: e8bd242
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

phax answers an artifact's open questions itself, in two modes. `phax artifact decide` gives the questions to a session that loads a doctrine: the default skill for the artifact kind, which a project skill of the same name can replace and a caller-owned file can extend. In interactive mode the operator decides and the agent facilitates. In headless mode the agent decides within the menu and escalates the rest, with its proposal written down. phax accepts decisions only as schema-validated JSON whose cited principles exist. It writes each decision into its question's history in the sidecar, re-renders the artifact, commits and records. decide runs on Draft only; `phax artifact reopen` brings an Approved artifact back to Draft, and `--question` re-arbitrates one question. Approval refuses while any question is undecided or escalated, for headless and hand-authored artifacts alike. Every decision and every approval names its arbiter, so nothing a machine decided or approved reads as a human's. The CLI changes are additive except `--by`, required when approve or reopen runs without a terminal; the document formats stay experimental.

> Every answer names its arbiter and its principle. A machine never decides off the menu: its proposal waits for a human instead of being lost.

## 4. Terminology

- **Open question** — A question in an artifact's sidecar, in the decision-request shape { id, question, options[{ id, label, abandons }], recommendation, rationale }, plus its history.
- **Decision** — One arbiter's answer to one open question. It carries: `chosen` (an option id); `abandoned` (exactly the options not chosen); `advocate` (the strongest case for an abandoned option, written before deciding); `why`; `principles` (the cited principle ids); `reversibility` (the cost of reversing the choice); and `escalate` (null, or the arbiter's proposal and what a human must confirm). A plan decision also carries `phase`: a phase id or null.
- **Reversibility** — The cost of undoing a decision, on the scale cheap | costly | irreversible. It is a cost, not a state. At equal value the cheaper option is preferred. `irreversible` (destructive) is a floor: a headless arbiter never takes it and escalates instead.
- **Escalation / proposal** — A headless decision whose `escalate` is non-null. It provisionally names a listed option and records the arbiter's proposal: another option, a better question, or the surface change or reversal a human must confirm. An escalated question is not decided. Only an operator decision settles it.
- **History** — The append-only list of a question's decided entries. The last entry gives the question's state. For a headless-authored artifact it lives in the sidecar; for a hand-authored artifact it is the Decision / Escalated blocks under the question and the decision log, in the §9 format.
- **Question state** — Undecided: no entry. Decided: the last entry is a decision without an escalation. Escalated: the last entry is a decision with an escalation.
- **Awaiting decision** — The questions a decide session is given. With `--question <id>`: that question alone, whatever its state. Otherwise, in headless mode, the undecided questions; in interactive mode, the escalated questions are added.
- **Interactive mode** — `phax artifact decide` without `--headless`. The operator decides and the agent facilitates. The resulting decisions are operator decisions.
- **Headless mode** — `phax artifact decide --headless`. The agent decides within the menu and escalates what is off-menu, what changes the public surface and what reverses an earlier decision. The resulting decisions are machine decisions.
- **Headless total mode** — A mode with no escalation, named by the doctrines as later. It is not specified here.
- **Doctrine** — The instructions a decide session follows: the doctrine skill for the artifact kind, plus the optional --doctrine file appended after it.
- **Principle id** — A backticked id that opens a list item in a loaded doctrine, e.g. `S1`, `C4`, `P3`, or a project's `X1`. Decisions cite principle ids, and phax checks each citation.
- **Arbiter** — Who produced a decision, an approval or an artifact reopen: a machine or the operator.
- **Grant** — The label a caller declares with `--by machine:<grant>` to name the machine performing an approval or an artifact reopen, e.g. steme-conductor.
- **Machine / operator / unattributed approval** — An approval recorded with a grant, an approval recorded with the committing git identity, or an approval that predates attribution and is recorded explicitly as unattributed.
- **Decision record** — The record phax writes on phax/records/v1 for one decide session.
- **Artifact reopen** — `phax artifact reopen <path>`: today a Stale plan back to Draft; extended here to an Approved spec or plan back to Draft. It is the only way to arbitrate an approved artifact again.
- **§9 format** — The layout the renderer already gives open questions, which a hand-authored artifact must follow for phax to read it: under the open-questions section, each question is a `### Q<n> — <question>` heading, then one bullet per option `- <option id> — <label> — abandons: <loss>`, then a `Recommendation: <option id> — <rationale>` line, then, once arbitrated, the Decision or Escalated block that decide writes. For a plan the section is `## Open questions` in the preamble.
- **Operator gesture** — An approval or an artifact reopen given with `--by operator`, or given without `--by` from a terminal. The operator is named by the committing git identity.

## 5. Functional requirements

### 5.1 Headless session is new by default

WHERE `--headless` is given THE system SHALL spawn a new decide session, not the artifact's authoring session, in which the agent decides each question awaiting decision within its listed options.

### 5.2 Resuming the authoring session on request

WHERE `--headless` and `--resume-authoring` are both given THE system SHALL run the decide session by resuming the artifact's authoring session instead of spawning a new one.

### 5.3 Unresumable authoring session refused

IF `--resume-authoring` is given and no authoring session id is kept for the artifact THEN the system SHALL refuse before spawning, stating that the authoring session is not resumable.

### 5.4 Interactive session

WHEN `phax artifact decide` runs without `--headless` THE system SHALL open an interactive session where the operator decides and the agent facilitates, resuming the artifact's authoring session when its id is kept and starting a new session otherwise, and printing which of the two it did.

### 5.5 Authoring session id kept locally

WHEN a headless authoring session is spawned THE system SHALL keep its provider session id in local state outside the records branch.

### 5.6 Model and effort

The system SHALL resolve the decide session's model and effort from `--model` and `--effort` when given, and from the built-in catalog default otherwise.

### 5.7 Inert flags refused

IF an inert flag combination listed in §6 is given THEN the system SHALL refuse before any session, naming the flag.

### 5.8 Questions come from the sidecar

WHEN `decide` reads an artifact that has an in-sync sidecar THE system SHALL take the questions from the sidecar's open questions.

### 5.9 Questions from a hand-authored §9

WHEN `decide` reads an artifact that has no sidecar THE system SHALL take its questions and their history from its open-questions section in the §9 format, and SHALL refuse before any session, naming the first line that departs from the format, if that section does not parse.

### 5.10 Hand-authored decisions written in place

WHEN decisions land on a hand-authored artifact THE system SHALL write each question's Decision or Escalated block under it and append the entries to the decision log, changing no other line of the artifact.

### 5.11 Artifact preconditions

IF the artifact is not Draft, its sidecar is diverged or invalid, or the artifact or its sidecar has uncommitted changes THEN the system SHALL refuse `decide` before any session; for an Approved or Stale artifact the refusal names `phax artifact reopen <path>`.

### 5.12 Presentation order

WHEN `decide` selects the questions awaiting decision THE system SHALL present, in order: the question named by `--question`, with its prior decision when it has one; then the undecided questions; then, in interactive mode only, the escalated questions, each with its proposal offered as a choice tagged as a machine proposal.

### 5.13 Nothing to decide

IF no question is awaiting decision, including when the artifact has no open questions at all, THEN the system SHALL spawn no session, write nothing, and exit 0 stating that there is nothing to decide.

### 5.14 Doctrine skill by artifact kind

The system SHALL load the doctrine skill `phax-decide-spec` into a decide session on a spec and `phax-decide-plan` into a decide session on a plan.

### 5.15 Project skill replaces the default

WHERE a skill of the same name is installed at project scope for the session's provider THE system SHALL load it in place of the bundled doctrine skill.

### 5.16 Doctrine file appended

WHERE `--doctrine <file>` is given THE system SHALL append the file's content after the doctrine skill in the session prompt.

### 5.17 Principle ids collected

The system SHALL take as the citable principle ids the backticked ids that open list items in the loaded doctrine skill and in the `--doctrine` file.

### 5.18 Doctrine file refused

IF the `--doctrine` file cannot be read, defines no principle id, or defines a principle id that the loaded skill also defines THEN the system SHALL refuse before spawning.

### 5.19 JSON-only decisions

WHEN a decide session ends THE system SHALL land only a decisions document that validates against the decisions schema of the artifact kind.

### 5.20 Invalid decisions land nothing

IF the session returns no decisions document, returns something that is not JSON or fails the schema, or returns a decisions document that does any of the following THEN the system SHALL fail, naming the first violation by path, and SHALL leave the working tree and HEAD unchanged: decides a question that was not presented; omits a presented question in headless mode; chooses an option the question does not list (except as §5 operator proposal allows); lists as abandoned anything other than exactly the unchosen options; cites a principle id no loaded doctrine defines; or, on a plan, names a phase the plan does not have.

### 5.21 Machine decisions cite a principle

IF a headless decision cites no principle id THEN the system SHALL reject the decisions document.

### 5.22 Destructive is a floor

IF a headless decision rates its choice `irreversible` without an escalation THEN the system SHALL reject the decisions document.

### 5.23 Reversals escalate

IF a headless decision on a question that already has a decision chooses an option other than its previous decision without an escalation THEN the system SHALL reject the decisions document.

### 5.24 Operator decisions do not escalate

IF an interactive decision carries an escalation THEN the system SHALL reject the decisions document.

### 5.25 Operator may adopt a proposal

WHERE an interactive decision answers an escalated question THE system SHALL accept `chosen: "proposal"` — the escalated proposal, presented among the choices and tagged as a machine proposal — recording it as the answer with every listed option abandoned and the operator as arbiter.

### 5.26 Rate and usage limits

IF a decide session ends on a provider rate or usage limit THEN the system SHALL fail in the existing rate-limit exit family with nothing written.

### 5.27 Artifact changed during the session

IF the artifact or its sidecar changed while the decide session ran THEN the system SHALL refuse to write the decisions back, leaving those changes in place and committing nothing.

### 5.28 Decisions written into their questions

WHEN a decisions document validates THE system SHALL append each decision to the history of its question in the sidecar.

### 5.29 Decision attribution

The system SHALL attribute each headless decision to the machine, naming the loaded doctrine sources, provider, model and effort, and each interactive decision to the operator, named by the committing git identity.

### 5.30 An escalation never wins by itself

WHILE a question's last history entry carries an escalation THE system SHALL treat the question as escalated, not decided, whatever option the entry provisionally names.

### 5.31 Artifact re-rendered

WHEN a question's history changes THE system SHALL re-render the artifact with its deterministic renderer. The rendering SHALL show under each question its state and latest entry, including any proposal, and SHALL end with a decision log listing every history entry in order.

### 5.32 One commit

WHEN `decide` writes an artifact THE system SHALL commit exactly the paths it wrote in one commit: the artifact and its sidecar, or the hand-authored artifact alone.

### 5.33 Commit failure

IF that commit fails THEN the system SHALL report an artifact error and leave both files written but uncommitted.

### 5.34 Decision record

WHEN a decide session ends after spawning and records are enabled THE system SHALL write a decision record. The record SHALL carry: the prompt; the doctrine sources with their fingerprints; the questions presented; the decisions document; the escalation count; the transcript (per the records transcript setting); provider, model, effort and usage; the outcome, committed or failed; and the commit when there is one.

### 5.35 Escalations counted

WHEN a decide session lands THE system SHALL print how many of its decisions escalated out of how many it landed.

### 5.36 Re-rendered plan never re-extracted

WHEN `decide` re-renders or rewrites a plan THE system SHALL re-seed the extraction cache with the plan's projection, so that `phax run` never extracts it through a model.

### 5.37 Re-arbitrating one question

WHERE `--question <id>` is given THE system SHALL present that question alone, decided, escalated or undecided, with its prior decision, and SHALL append the new decision to its history.

### 5.38 Unknown question refused

IF `--question` names a question the artifact does not have THEN the system SHALL refuse before any session and write nothing.

### 5.39 Artifact reopen from Approved

WHEN `phax artifact reopen` is given an Approved spec or plan THE system SHALL move it to Draft, remove its record from the approvals ledger, and commit the write-set in one commit whose trailer names the gesture's arbiter. Stale → Draft for plans is unchanged.

### 5.40 Artifact reopen refusals

IF `phax artifact reopen` is given a Draft, Completed or Abandoned artifact THEN the system SHALL refuse with exit 12 and write nothing.

### 5.41 Approval requires every question decided

IF any open question of a spec or plan — from its sidecar, or from its §9 format when hand-authored — is undecided or escalated THEN `phax artifact approve` SHALL refuse with exit 12, naming those questions and `phax artifact decide <path>`.

### 5.42 A hand-authored §9 must parse

IF a hand-authored artifact has an open-questions section that does not parse in the §9 format THEN `phax artifact approve` SHALL refuse with exit 12, naming the first line that departs. An artifact with no open-questions section approves with no question check.

### 5.43 Machine gestures

WHERE `--by machine:<grant>` is given to `phax artifact approve` or `phax artifact reopen` THE system SHALL record that gesture as performed by a machine, naming the grant.

### 5.44 Operator gestures

WHEN `--by operator` is given, or no `--by` is given and the command runs from a terminal, THE system SHALL record the approval or reopen as performed by the operator, named by the committing git identity.

### 5.45 No terminal, no default

IF `phax artifact approve` or `phax artifact reopen` runs without `--by` and not from a terminal THEN the system SHALL refuse with exit 12, naming `--by operator` and `--by machine:<grant>`.

### 5.46 Every approval record names its approver

IF an approvals ledger record carries no approver THEN the system SHALL refuse to read the ledger, naming the record and the fix.

### 5.47 Unattributed approvals stay unattributed

WHEN phax reads an approval recorded as unattributed THE system SHALL present it as unattributed, never as an operator approval.

### 5.48 Status reports questions

WHEN `phax artifact status` inspects an artifact that has open questions THE system SHALL report them as open, decided (split into machine and operator) and escalated (naming them), print each escalated question's proposal under that line, and name the decide command that answers them.

### 5.49 Status names the approver

WHEN `phax artifact status` reports an approval of a spec or a plan THE system SHALL name the approver's kind and identity.

### 5.50 Doctrine skills ship and install

The system SHALL list `phax-decide-spec`, `phax-decide-plan` and `phax-decide-review` in its bundled skill catalog, so that `phax skills install` installs them exactly as it installs `phax-spec`.

### 5.51 Plan open questions

WHERE the artifact is a plan THE system SHALL read its open questions from the plan document's open-questions section, in the decision-request shape.

### 5.52 Authoring emits no history

IF the document returned by an authoring session carries a history entry on any question THEN the system SHALL reject it as an invalid document.

## 6. Surface

### cli: phax artifact decide — normative

    phax artifact decide <artifact> --headless [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>] [--resume-authoring]
    phax artifact decide <artifact> [--question <id>] [--doctrine <file>] [--model <model>] [--effort <effort>]   # interactive

    $ phax artifact decide docs/specs/2609251400-plan-prune.md --headless --doctrine docs/doctrine/spec.md
    decide spec plan-prune — 3 questions — headless, new session — claude-opus-5-5 / high
    doctrine   phax-decide-spec (bundled) + docs/doctrine/spec.md
    Q1         decided    manual    (S1, C4)
    Q2         decided    keep-10   (S2, S5) — departs from the recommendation
    Q3         escalated  manual    (S9) — proposal: a `--keep` flag on `phax prune`, not an `archive.prune` key
    escalated  1 of 3
    commit     a1b2c3d — docs(specs): decide plan-prune Q1, Q2, Q3
    record     decision/2609251400-plan-prune/01
    $? = 0

    $ phax artifact decide docs/specs/2609251400-plan-prune.md --headless --question Q1
    decide spec plan-prune — Q1 (decided: manual) — headless, new session — claude-opus-5-5 / high
    Q1         escalated  auto      (S7) — a reversal: a human must confirm
    $? = 0

    $ phax artifact decide docs/specs/2609060715-design-system-package.md      # hand-authored, interactive
    decide spec design-system-package — hand-authored §9, 6 questions — interactive, new session
    commit     c3d4e5f — docs(specs): decide design-system-package Q1–Q6   (the .md only)
    $? = 0

    ✗ decide refused: docs/specs/2609251400-plan-prune.md is Approved — reopen it first with `phax artifact reopen docs/specs/2609251400-plan-prune.md`
    $? = 12

    ✗ decide refused: docs/specs/2609010900-legacy.md §9 line 212 departs from the §9 format — expected `### Q<n> — <question>`
    $? = 12

    ✗ decide failed: decisions document rejected — decisions[1].principles[0]: "S12" is defined by no loaded doctrine
      nothing written; the session is recorded as failed
    $? = 5

    Inert combination (refused, exit 12): --resume-authoring without --headless.
    Exit: 0  decided and committed, or nothing to decide
          5  no decisions document, not JSON, or rejected by the decisions schema or its checks
          8  provider rate or usage limit
          12 artifact refusal: not Draft, diverged/invalid sidecar, a hand-authored §9 that does not parse, uncommitted changes,
             inert flags, bad doctrine file, authoring session not resumable, unknown --question, artifact changed during the session, commit failed

    # normative: command and flag names, the exit families, the escalation count line; output layout and wording indicative

### file: decisions document (the decide session's final message) — normative

    { "decisions": [
      { "id": "Q3", "chosen": "manual", "abandoned": ["auto"],
        "advocate": "The strongest case for auto: the registry would shrink without anyone remembering to prune.",
        "why": "Both options add a config key the spec does not claim; the cheaper surface is a flag.",
        "principles": ["S9", "C4"],
        "reversibility": "cheap",
        "escalate": "Proposal: a `--keep` flag on `phax prune` instead of an `archive.prune` config key — a surface change a human must confirm." } ] }

    # every key required, unknown keys rejected — the shape the landed doctrine skills already emit
    # reversibility: cheap | costly | irreversible — the cost of reversing the choice; a headless `irreversible` must escalate
    # escalate: null, or the proposal and what a human must confirm (headless only; an operator decision carries null)
    # chosen: a listed option id; an operator answering an escalated question may choose "proposal" (§9 Q7)
    # plan variant: each decision also carries "phase": "<phase id>" | null

### file: docs/specs/<stamp>-<slug>.json question history — normative

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
        "rationale": "…",
        "history": [
          { "kind": "decided", "at": "2026-09-25T10:02:11Z",
            "by": { "kind": "machine",
                    "doctrine": [ { "kind": "skill", "name": "phax-decide-spec", "source": "bundled" },
                                  { "kind": "file", "path": "docs/doctrine/spec.md" } ],
                    "provider": "claude", "model": "claude-opus-5-5", "effort": "high" },
            "chosen": "manual", "abandoned": ["auto"], "advocate": "…", "why": "…",
            "principles": ["S1", "C4"], "reversibility": "cheap", "escalate": null }
        ] } ]

    # normative: every question carries `history` (required, empty until the first entry — no optional-for-back-compat);
    # entry kind decided; `by` kinds machine (the session form above) | operator ({ "kind": "operator", "name": "<git user.name>" });
    # the state is the last entry.
    # Nested key spellings indicative. The plan sidecar's questions carry the same history.

### file: rendered spec — §9 answered and a decision log — normative

before:

    ## 9. Open questions for implementation planning

    ### Q3 — Is the prune policy a config key?

    - manual — … — abandons: …
    - auto — … — abandons: …

    Recommendation: manual — …

after:

    ## 9. Open questions for implementation planning

    ### Q1 — Is pruning manual or automatic past `keep`?

    - manual — an explicit `phax prune` — abandons: the registry ever shrinking on its own
    - auto — prune past `keep` at archive time — abandons: an archived run being inspectable after the fact

    Recommendation: manual — records already keep the trajectory; the run folder is disposable but not silently.

    Decision: manual — by machine (phax-decide-spec + docs/doctrine/spec.md; claude-opus-5-5 / high), 2026-09-25
    Why: … Principles: S1, C4. Reversibility: cheap.
    Advocate for auto: …

    ### Q3 — Is the prune policy a config key?

    …

    Escalated: manual, provisionally — by machine (…), 2026-09-25
    Proposal: a `--keep` flag on `phax prune` instead of an `archive.prune` config key — a surface change a human must confirm.

    ## 10. Implementation-planning note
    …
    ## 11. Docs page
    …

    ## 12. Decision log

    - 2026-09-25 Q1 decided manual — machine (phax-decide-spec + docs/doctrine/spec.md; claude-opus-5-5 / high)
    - 2026-09-25 Q3 escalated (manual, provisionally) — machine (…)

    # normative: under each question with history, a Decision / Escalated (+ Proposal) block naming the arbiter;
    # a final Decision log section only when any question has history; the rest of the rendering unchanged. This is the §9 format a hand-authored artifact follows. Wording indicative.

### file: hand-authored §9 in the §9 format — normative

before:

    ## 9. Open questions for implementation planning

    **Q2 — Fonts: self-hosted in the package, or loaded from Google Fonts?**

    - Google Fonts link — abandons: no-third-party-request pages …
    - Self-hosted files (both faces are OFL) — abandons: package weight …

    Recommendation: self-host in `brand/fonts/` …

after:

    ## 9. Open questions for implementation planning

    ### Q2 — Fonts: self-hosted in the package, or loaded from Google Fonts?

    - google — a Google Fonts link — abandons: no-third-party-request pages …
    - self-hosted — self-hosted files (both faces are OFL) — abandons: package weight …

    Recommendation: self-hosted — self-host in `brand/fonts/` …

    Decision: self-hosted — by operator (Rémy Loubradou), 2026-09-28      ← written by decide, or by hand
    Why: … Principles: … Reversibility: cheap.

    ## 12. Decision log

    - 2026-09-28 Q2 decided self-hosted — operator (Rémy Loubradou)

    # normative: the heading, option-bullet, Recommendation and Decision/Escalated line shapes; a hand-authored artifact is
    # converted to them once. Approve counts a question decided when its last block is a Decision block. Wording indicative.

### file: docs/plans/<stamp>-<slug>-plan.json open questions — indicative

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
          "recommendation": "p2", "rationale": "…", "history": [] } ]
    }

    # per §9 Q2: rendered in the preamble before the first phase as "## Open questions" (the §9 layout) and "## Decision log";
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
    Status:            Approved
    Authored:          headless — sidecar docs/specs/2609251400-plan-prune.json (in sync)
    Questions:         3 — open 0 · decided 2 (machine 1, operator 1) · escalated 1 (Q3)
      Q3 — proposal (machine, S9): a `--keep` flag on `phax prune` instead of an `archive.prune` config key —
           a surface change a human must confirm
      answer with `phax artifact decide docs/specs/2609251400-plan-prune.md`
    Approved:          2026-09-25 @ a1b2c3d by machine (steme-conductor)
    Edited since:      no
    Legal transitions: Draft (reopen), Completed, Abandoned

    # other approver forms:  by operator (Ada Lovelace)  |  unattributed
    # a hand-authored artifact whose §9 parses prints the same Questions line; plans gain the same Questions and Approved lines.
    # normative: the three counts, the machine/operator split, the escalated ids with their proposals (§9 Q5), the approver
    # kind and identity; layout indicative

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

    ✗ Approval refused: docs/specs/2609251400-plan-prune.md still owes decisions — escalated Q3, undecided Q4
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
                      mode: "headless" | "interactive", session: "new" | "resumed-authoring",
                      doctrine: [ { kind: "skill", name: "phax-decide-spec", source: "bundled" | "project", fingerprint: "…" },
                                  { kind: "file", path: "docs/doctrine/spec.md", fingerprint: "…" } ],
                      questions: ["Q1", "Q2", "Q3"], escalated: 1, sourceSha: "…", provider, model, effort,
                      outcome: "committed" | "failed", commit: "…" | null, usage: { … } }
      prompt.md  decisions.json  output.jsonl

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

- Headless total mode (no escalation, the destructive floor only). The doctrines mark it as later, and what headless mode escalates in practice will decide whether it is wanted.
- A decision queue UI or desktop inbox. This spec provides the data and the status line, nothing visual.
- Multi-human arbitration: several operators, votes, required reviewers or per-question owners. The operator is whoever commits.
- Automatic routing of an escalation, e.g. running decide on the spec when a plan decision escalates under P1. The escalation blocks approval, and the caller routes it.
- Editing a question, its options, or the artifact's requirements from within decide. The only departure from the menu is an operator adopting an escalated proposal (§9 Q7).
- Writing or rewriting the doctrine skills' text. They landed by hand and ship as they are.
- Loading `phax-decide-review` from decide. It ships here and is consumed by review-plan (headless-review spec).
- Changing how headless authoring loads `phax-spec` and `phax-planning`. The project-skill override applies to the decide doctrines only.
- A `phax.json` key for the decide model and effort. One can be added later without breaking anything.
- Answering run decision requests (spec 23) or any autopilot loop. Run decision requests stay human-answered.
- Parsing a steering file. Mapping `rouvre Q3` to `phax artifact reopen` plus `decide --question Q3` is the caller's job.
- The approver in the frontmatter `approved` stamp. The approvals ledger is the single source of who approved.
- Stability of the question-history, decisions and approver formats. They are experimental, like the documents that carry them.
- Extracting open questions from a free-form Markdown layout. A hand-authored artifact follows the §9 format, converted once by hand.

## 8. Acceptance criteria

### Headless decide lands whole

Given a headless-authored spec whose sidecar has two undecided questions, when `phax artifact decide <spec> --headless` runs and the session returns a valid decisions document, then The system spawned a new session (not the authoring session) with `phax-decide-spec`. Each question's history gains one decided entry, attributed to the machine with its doctrine sources, provider, model and effort. §9 shows a Decision block under each question, and a Decision log lists both entries. The output prints `escalated 0 of 2`. The artifact and its sidecar are the only paths in the new HEAD commit, the sidecar is in sync, and the exit code is 0. (refs §5.1, §5.8, §5.14, §5.19, §5.28, §5.29, §5.31, §5.32, §5.35)

### Resume authoring only when kept

Given a spec authored headless on this machine, and another whose local authoring state is gone, when `phax artifact decide <spec> --headless --resume-authoring` runs on each, then The first run resumes the provider session id kept from authoring, and that id appears nowhere on the records branch. The second run exits 12 stating the authoring session is not resumable, and no session is spawned. (refs §5.2, §5.3, §5.5)

### Interactive resumes or starts new and names the operator

Given a headless-authored spec with a kept authoring session id, and one without, when `phax artifact decide <spec>` runs without `--headless` on each, the operator decides one of two presented questions in the first run, and the operator ends the second session without a decisions document, then The first run resumes the authoring session and the second starts a new one, and each prints which it did. In the first run, one decision lands, attributed to the operator by the committing git identity, and the other question stays undecided. The second run exits without writing anything. (refs §5.4, §5.29, §5.20)

### Model resolves from flag, then catalog

Given a headless-authored spec, when `phax artifact decide <spec> --headless` runs without `--model`, and again with `--model` and `--effort`, then The first session uses the catalog default and prints it. The second uses the flags. (refs §5.6)

### Inert flags refused

Given a headless-authored spec, when `decide` runs with `--resume-authoring` without `--headless`, then it exits 12 naming the flag, and no session is spawned. (refs §5.7)

### Hand-authored artifact decided in place

Given a spec with no sidecar whose §9 follows the §9 format with undecided Q1 and Q2, and another whose §9 uses bold headings, when interactive `phax artifact decide` runs on the first and the operator decides Q1, then `phax artifact approve` runs on it, then decide runs on the second, then Only Q1's Decision block and one decision-log entry are added to the first spec; the new HEAD commit holds that file alone. Approve exits 12 naming Q2. Decide on the second exits 12 naming the first bold heading, and no session is spawned. (refs §5.9, §5.10, §5.32, §5.41)

### Preconditions refuse before the session

Given a spec whose sidecar has diverged, a spec with an uncommitted change, a Completed spec, and an Approved spec, when `phax artifact decide <spec> --headless` runs on each, then each run exits 12 and no session is spawned; the Approved spec's refusal names `phax artifact reopen`. (refs §5.11)

### Re-arbitrating one question; escalated only interactively

Given a Draft spec where Q1 is decided, Q3 is undecided and Q2 is escalated with a proposal, when headless decide runs with `--question Q1`, then headless decide runs, then interactive decide runs, then decide runs with `--question Q9`, then The first prompt presents Q1 alone with its prior decision. The second presents Q3 only. The third presents Q3, then Q2 with its proposal offered as a choice tagged as a machine proposal. The fourth exits 12 and writes nothing. (refs §5.12, §5.37, §5.38)

### Nothing to decide

Given a headless-authored spec with an empty openQuestions, and another whose questions are all decided or escalated, when `phax artifact decide <spec> --headless` runs on each, then each run exits 0 stating that there is nothing to decide, no session is spawned, and no commit is made. (refs §5.13)

### Project skill replaces the default and the doctrine file is appended

Given a project-scoped `.claude/skills/phax-decide-spec/SKILL.md` that differs from the bundled one, and a `docs/doctrine/spec.md` whose list item opens with `X1`, when `phax artifact decide <spec> --headless --doctrine docs/doctrine/spec.md` runs, then The prompt contains the project skill's text followed by the doctrine file. Decisions citing `X1` or `C4` are accepted. A decision citing `S0` (named only inside a step, never opening a list item) is rejected. The decision record names the skill source as project, with its fingerprint. (refs §5.15, §5.16, §5.17)

### Bad doctrine file refused

Given a `--doctrine` file that is unreadable, one that defines no principle id, and one whose list item opens with `S1`, when headless decide runs with each, then each run exits 12 and no session is spawned. (refs §5.18)

### Invalid decisions land nothing

Given records enabled, and sessions that return, respectively: prose; a decision citing `S12`; a document omitting a presented question; a `chosen` option the question does not list; an `abandoned` list that is not exactly the unchosen options; a decision for a question not presented; a plan decision naming a phase the plan lacks, when each session ends, then Each run exits 5 naming the violation path. The working tree and HEAD are unchanged. A decision record exists with outcome `failed`. (refs §5.20, §5.34)

### Per-arbiter rules

Given these decisions: a headless decision with empty `principles`; a headless decision rated `irreversible` with `escalate: null`; a headless decision on an already decided question that switches option with `escalate: null`; an interactive decision carrying an `escalate` string; and an interactive decision with empty `principles`, when each document is validated, then the first four are rejected with exit 5 and nothing written, and the fifth is accepted. (refs §5.21, §5.22, §5.23, §5.24)

### A proposal waits for a human

Given a spec on which headless decide escalates Q3, provisionally naming `manual`, with a proposal, when `phax artifact approve <spec>` runs, then interactive decide runs and the operator chooses `proposal` for Q3, then approve runs again, then Q3 is counted as escalated, not decided, and §9 shows its proposal. The first approve exits 12 naming Q3. The interactive session offers the proposal as a choice tagged as a machine proposal. The operator decision lands with every listed option abandoned and the proposal as the answer, and Q3 reads decided (operator). The second approve succeeds. (refs §5.30, §5.25, §5.41)

### Rate limit lands nothing

Given a headless decide session that ends on a provider usage limit, when the session ends, then the run exits 8 and nothing is written or committed. (refs §5.26)

### Concurrent edit refused

Given an interactive decide session during which the artifact file is modified, when the session returns a valid decisions document, then the run exits 12, the modification is left in place, and no commit is made. (refs §5.27)

### Commit failure leaves the files

Given a valid decisions document and a commit that fails, when decide writes the artifact and sidecar, then the run exits 12, and both files are written but uncommitted. (refs §5.33)

### Record explains the decisions

Given records enabled and a decide commit at `<sha>` that escalated one of three decisions, when `phax records explain <sha>` runs, then It shows the prompt, the doctrine sources with fingerprints, the questions presented, the decisions document, `escalated: 1`, model, effort, usage and outcome `committed`. (refs §5.34)

### Status counts questions by state and arbiter

Given a spec with Q1 decided by machine, Q2 decided by operator and Q3 escalated with a proposal, approved earlier with `--by machine:steme-conductor`, when `phax artifact status <spec>` runs, then It prints: open 0; decided 2, split machine 1 and operator 1; escalated 1, naming Q3 with its proposal text and the decide command; and `by machine (steme-conductor)` on the Approved line. A plan in the same situation prints the same lines. (refs §5.48, §5.49)

### Approval requires every question decided

Given a headless-authored spec with undecided questions and no history, a hand-authored spec whose §9 is in the §9 format with every question decided, and a hand-authored spec with no open-questions section, when `phax artifact approve` runs on each, then The first exits 12 naming its undecided questions and `phax artifact decide`. The second and third approve. (refs §5.41, §5.42)

### Approvals name their approver

Given a spec ready for approval, when `phax artifact approve <spec> --by machine:steme-conductor` runs; separately the same command runs from a terminal without `--by`; separately it runs without `--by` from a script with no terminal, then The approvals.json record carries `approvedBy` `{ kind: machine, grant: steme-conductor }` in the first case and `{ kind: operator, name: <git user.name> }` in the second; `phax artifact status` prints `by machine (steme-conductor)` or `by operator (<name>)` accordingly. The third exits 12 naming `--by`, and nothing is written. (refs §5.43, §5.44, §5.45, §5.49)

### Pre-attribution records are explicit

Given an approvals.json record with `approvedBy: { kind: unattributed }`, and a ledger with a record lacking `approvedBy`, when `phax artifact status` inspects the first record's artifact, and `phax artifact approve` runs on a plan whose ledger is the second, then Status prints the first approval as unattributed, never as operator. The approve exits 12 naming the record and the fix. (refs §5.47, §5.46)

### Artifact reopen returns an Approved artifact to Draft

Given an Approved spec, a Draft spec, and a Stale plan, when `phax artifact reopen <path> --by machine:steme-conductor` runs on each, then `decide --headless --question Q1` runs on the reopened spec, then The Approved spec is Draft, its record is gone from docs/specs/approvals.json, and the transition commit names `machine (steme-conductor)`. The Draft spec's reopen exits 12 and writes nothing. The Stale plan reopens to Draft as today. The decide then runs on the reopened spec. (refs §5.39, §5.40, §5.43, §5.11)

### Doctrine skills ship and install

Given an installed phax package, when `phax skills install --target claude --scope project` runs in an empty project, then `.claude/skills/phax-decide-spec/SKILL.md`, `phax-decide-plan/SKILL.md` and `phax-decide-review/SKILL.md` exist, each byte-identical to the landed copy in the phax repository. (refs §5.50)

### Plan decide keeps the plan executable

Given a headless plan whose document has open questions Q1 and Q2, when `phax artifact decide <plan> --headless` runs, deciding Q1 with `phase: phase-02` and escalating Q2, then The session loads `phax-decide-plan`. The decision carries `phase: phase-02`. The re-rendered plan passes `phax plans lint` with no structure error, and `phax run` finds its projection without spawning an extraction session. `phax artifact approve <plan>` exits 12 naming Q2. (refs §5.51, §5.36, §5.14, §5.41)

### Authoring emits no history

Given a headless authoring session whose document carries a history entry on a question, when the session ends, then the run exits 5 and nothing is written. (refs §5.52)

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

Recommendation: Print each pending proposal under the Questions line. — Decided by the author on 2026-09-28. Status is where an operator looks first; the proposal text is printed there so no escalation waits unseen. The rendered artifact stays the source of the text.

### Q6 — What does decide do with a hand-authored artifact that has no sidecar?

- Decide and reopen refuse it, naming the remedy: re-author it headless, or answer its §9 by hand. — abandons: arbitration of hand-authored artifacts: a human who writes a spec interactively still answers its §9 by hand, as today
- A new model extraction of §9 or the plan's arbitrations, with decisions kept in a file beside the artifact and decision lines spliced into the hand-written Markdown. — abandons: one home for decisions and the rule that phax edits Markdown only by rendering it: decisions would live in the sidecar for one artifact and in another file for the next
- decide reads and writes a hand-authored §9 in the §9 format — abandons: phax editing Markdown only by rendering it: for a hand-authored artifact it writes the question blocks and the decision log in place

Recommendation: decide reads and writes a hand-authored §9 in the §9 format — Decided by the author on 2026-09-28. Every question is answered before approval, whatever authored the artifact, so phax must read a hand-written §9. It does so deterministically in the layout the renderer already produces, and decide writes only the question blocks and the decision log.

### Q7 — How does an operator adopt an escalated off-menu proposal?

- An interactive decision on an escalated question may set `chosen: "proposal"`: the escalated proposal becomes the answer, and every listed option is abandoned. — abandons: every answer being one of the authored options with a pre-named loss: the adopted proposal's loss is only what the operator writes in `why` and `advocate`
- A proposal is adopted only by re-authoring the artifact with a brief that folds it in. — abandons: the question's history, and a cheap path for an accepted proposal: one accepted idea costs a whole re-authoring
- The operator chooses within the menu only, and the proposal stays a record. — abandons: the better move the arbiter found: the proposal is recorded but can never win

Recommendation: An interactive decision on an escalated question may set `chosen: "proposal"`: the escalated proposal becomes the answer, and every listed option is abandoned. — Decided by the author on 2026-09-28. The operator re-runs decide interactively; the escalated proposal appears among the choices, tagged as a machine proposal, and choosing it is an operator decision. A headless arbiter never chooses a proposal.

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

## 10. Implementation-planning note

Settled:

- Two modes only. Headless: a new session by default, `--resume-authoring` on request; the agent decides within the menu and escalates. Interactive: the operator decides, the agent facilitates, and the authoring session is resumed when kept. Headless total is out.
- The three invocations and their flags as in §6, with the inert combinations refused.
- Doctrine resolution: `phax-decide-spec` or `phax-decide-plan` by kind; a project-scope copy of the same name wins over the bundled one; `--doctrine` is appended after it. Principle ids are the backticked ids that open list items, and every citation is validated. This format is decided, not open.
- The decisions document is the landed skills' output shape (`id, chosen, abandoned[], advocate, why, principles[], reversibility, escalate`, plus `phase` for plans). It is validated at the boundary with these checks: total, complement, citation, phase, per-arbiter, the irreversible floor and the reversal escalation. Nothing is written on failure.
- An escalation never wins by itself. It blocks approval until an operator decision, which may adopt the proposal (Q7). Escalations are counted in decide's output, the decision record and status.
- Each decision is appended to its question's `history` in the sidecar. Then: the deterministic re-render (§9 answered plus a decision log), one path-scoped commit, one decision record (a failed session is recorded too), and a plan extraction-cache re-seed.
- The three doctrine skills are registered in the skill catalog and install like `phax-spec`, with their text unchanged.
- The input is the sidecar, or for a hand-authored artifact its §9 in the §9 format (Q6, Q10). With nothing awaiting decision, decide exits 0 with no session.
- decide runs on Draft only; `phax artifact reopen` extends to Approved → Draft and removes the approval record (Q1). `--question` re-arbitrates one question; there is no reopened state (Q8).
- Approval refuses while any question is undecided or escalated, for every artifact with an open-questions section (Q9).
- Approver attribution in both approvals ledgers: `--by machine:<grant>`, `--by operator`, the operator by default from a terminal, a refusal without a terminal, and explicit unattributed for old records (Q3, Q4). Status prints escalated proposals (Q5). Plans gain structured `openQuestions` (Q2).

Left open:

- Rendering prose for the Decision and Escalated/Proposal blocks and the decision-log entries; the plan preamble section names.
- The spelling of the `--by` values, the reopen trailer, `history` and `approvedBy` and their nested keys; the decision record key and manifest layout.
- How the interactive session hands its decisions document to phax: a phax-named output file read on exit, or an in-session phax command. The document and its validation are the same either way.
- Where the authoring session id is kept within local state (the adjust-plan session precedent).
- How a provider whose skills live in `.agents/skills` resolves the project override. This follows `phax skills install`'s target mapping.
- The built-in default model and effort for decide, chosen from the catalog on cost.

Constraints:

- Compose the headless-authoring machinery: prompt assembly, the JSON-only provider session, boundary decoding, deterministic renderers, the path-scoped commit, the record writer and the sidecar agreement check. Do not fork it.
- For a headless-authored artifact the sidecar's history is the single source of a question's state; for a hand-authored one, its §9 in the §9 format is, parsed deterministically. §9, the decision log, `artifact status`, the approve refusal and the escalation counts derive from that source.
- `history` is required on every question, and `openQuestions` is required in the plan document; no optional-for-back-compat fields. Existing in-repo sidecars are migrated in the same change. The authoring output emits no history (rejected otherwise), and the formats stay experimental (schema titles, README note).
- `approvedBy` is required on every approvals record. phax's own ledgers are rewritten to `unattributed` in the same change (Q4).
- The decisions schema must accept exactly what the landed doctrine skills instruct the agent to emit. Change the schema, never the skill text.
- The machine/operator approval form is shared with the headless-review spec; whichever spec lands second adopts the first's form.
- A re-rendered plan must still pass `phax plans lint`, parse on the deterministic path to the same projection, and have its extraction cache re-seeded.
- The local authoring session id never goes to the records branch, so the authoring record format is unchanged.
- Transitions keep carrying the sidecar in their write-set, and the clean-file precondition of artifact auto-commits applies to decide and to artifact reopen.
- A project that installs the default skills at project scope pins that copy. The decision record's skill source and fingerprint make that drift visible; nothing else is added for it.

## 11. Docs page

Page: docs/arbitration.md

Reader: A loop author or operator who wants a spec's or plan's open questions answered under a written doctrine. They need to see what a machine escalated and why, reconsider an answer on demand, and tell a machine's answer or approval from a human's.

Example: phax artifact new spec plan-prune --headless --brief brief.md
phax artifact decide docs/specs/2609251400-plan-prune.md --headless --doctrine docs/doctrine/spec.md
  escalated  1 of 3
phax artifact status docs/specs/2609251400-plan-prune.md
  Questions: 3 — open 0 · decided 2 (machine 2, operator 0) · escalated 1 (Q3)
    Q3 — proposal (machine, S9): a `--keep` flag on `phax prune` …
phax artifact decide docs/specs/2609251400-plan-prune.md          # interactive: the operator answers Q3, may choose the tagged proposal
phax artifact approve docs/specs/2609251400-plan-prune.md --by machine:steme-conductor
phax artifact reopen docs/specs/2609251400-plan-prune.md --by machine:steme-conductor   # back to Draft to reconsider
phax artifact decide docs/specs/2609251400-plan-prune.md --headless --question Q1        # a changed answer escalates
