---
status: Draft
date: 2026-10-27
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Revise a Draft artifact

## 1. Context

`phax artifact new spec|plan <slug> --headless --brief <file|->` authors a spec or plan in a recorded agent session. phax renders the session's JSON document to Markdown and writes the `.md` with its JSON sidecar beside it. For a plan it also seeds the extraction cache, then commits both files. The artifact is Draft. phax keeps the session's ids in `<stateRoot>/authoring/<authoringId>/session.json` and its brief in `brief.md` beside it. This is local state; it never reaches the records branch.

Once the artifact exists, two commands change its body, and each needs a specific occasion:

- `phax artifact decide` changes it only through question verdicts. In verdicts mode, a writer session resumes the kept authoring session when it ran on the same provider in this checkout. It returns the whole revised document. phax checks the answer against the verdicts and commits without asking. The artifact stays Draft.
- `phax adjust-plan <plan> --landed <run>` changes a plan after a landed run has caused drift. It needs a run that reached review.

Editing the `.md` by hand leaves the sidecar `diverged`. `phax artifact approve` then refuses, and names two remedies: re-author the artifact with `--headless`, or delete the sidecar so the artifact becomes hand-authored.

Ground read:

- `src/app/authorArtifact.ts` — headless authoring, the kept `session.json`, the one corrective resume, the `Authoring-Id` trailer.
- `src/app/decideVerdicts.ts` — the writer session, resumed only when the kept session ran on the same provider in this checkout.
- `docs/arbitration.md` — verdicts mode: what phax checks in the writer's answer, the report and its `--json` form, the refusals.
- `phax --usage` (0.28.0) — `artifact approve`, `reopen`, `decide`, `new`, `status`; `adjust-plan`.

## 2. Problem

A headless Draft that needs one more requirement has no path that keeps the work already done. An agent driving a project hit this case. Its Draft plan needed one added line: a module must compile, pass clippy and pass its tests, offline, on a migrated SQLite, at the phases that touch its code. The agent's only options were to abandon the plan and re-author it from an extended brief, or to demote it to hand-authored.

Re-authoring throws away the session's exploration and the questions already arbitrated, and costs a full authoring session. Demoting gives up the sidecar: the deterministic rendering, the seeded extraction cache, and the questions phax reads from the document. Both are far out of proportion to a one-line amendment. `decide` cannot carry the change, because no open question asks it.

## 3. Product goal

A Draft headless artifact can be revised from an amendment in one command. The revision is written by the session that authored the artifact when phax can resume it. phax checks the document it returns, commits it with the amendment as its reason, and leaves the artifact Draft so the approval gate still decides.

> A revision changes the body the amendment asks for, and nothing that a verdict or the approval gate owns.

## 4. Terminology

- **Amendment** — The text that says what the revision must change, in the author's words. It is read from a file or stdin, like a brief.
- **Revision** — One `phax artifact revise` run: one writer session, its answer, phax's checks, and at most one commit.
- **Writer session** — The headless session that returns the revised document. It is the kept authoring session, resumed, or a new session.
- **Revised document** — The writer's final message: the artifact's whole sidecar document at its kind's current shape, with the amendment carried into the body.
- **Requester** — Who asked for the revision: `operator`, or `machine:<grant>`, as for `phax artifact reopen`.

## 5. Functional requirements

### 5.1 Revise from an amendment

WHEN `phax artifact revise <path> --amendment <file|->` runs on a Draft headless-authored spec or plan whose sidecar is in sync THE system SHALL run one writer session that returns the revised document carrying the amendment.

### 5.2 Writer session

WHEN the artifact's kept authoring session ran on the writer's provider in this checkout THE system SHALL resume it, and otherwise SHALL start a new session given the current document, the kept brief when it exists, and the amendment. The report SHALL say which.

### 5.3 Draft only

IF the artifact is not Draft THEN the system SHALL refuse with exit 12 before any session, naming `phax artifact reopen <path>` for an Approved or Stale artifact.

### 5.4 Headless in sync only

IF the artifact has no sidecar, or its sidecar is diverged, invalid or stamped below its current shape THEN the system SHALL refuse with exit 12 before any session. The message SHALL name the remedy: edit the `.md` directly for a hand-authored artifact, the two status remedies for a diverged or invalid sidecar, and `phax artifact migrate-documents` for an old shape.

### 5.5 Questions stay as they are

IF the revised document changes, removes or reorders an existing question, open or arbitrated THEN the system SHALL refuse the answer.

### 5.6 New open questions

WHEN the revised document appends open questions THE system SHALL accept them and list them in the report.

### 5.7 The answer is checked

IF the revised document is not JSON, lacks its kind's current `$schema`, or fails its kind's decode checks THEN the system SHALL give the writer one corrective resume, and on a second refusal SHALL exit 5 with nothing written.

### 5.8 Frontmatter untouched

The system shall write the artifact's frontmatter byte for byte as it was.

### 5.9 No change, no commit

IF the revised document renders the same body as the current one THEN the system SHALL write nothing, say that the amendment changed nothing, and exit 0.

### 5.10 Write and commit without asking

WHEN the revised document passes the checks THE system SHALL write the rendered `.md` and its sidecar, re-seed a plan's extraction cache, and commit exactly those paths in one commit, leaving the artifact Draft.

### 5.11 The commit names the amendment and the requester

WHEN a revision commits THE system SHALL put the amendment verbatim in the commit body, followed by the trailers `Artifact`, `Revised-By` and `Revision-Id`.

### 5.12 Requester

WHEN `--by` is absent and there is no terminal THE system SHALL refuse with exit 12, naming `--by operator` and `--by machine:<grant>`.

### 5.13 Report

WHEN a revision ends THE system SHALL print the session kind, the model, the new open questions, the body diff, the commit and the status line naming `phax artifact approve`. With `--json` it SHALL print the same report as one JSON object on stdout.

### 5.14 Artifact changed during the session

IF the artifact or its sidecar changes on disk while the writer runs THEN the system SHALL refuse with exit 12 and leave that change in place.

### 5.15 Read-only writer

The system shall run the writer session read-only, and SHALL refuse before any session a writer model routed to a provider that ignores read-only.

### 5.16 Revision record

WHERE records are configured THE system SHALL write one revision record per writer session that ran, committed or failed, and `phax records explain <commit>` SHALL resolve it through the `Revision-Id` trailer.

## 6. Surface

### cli: phax artifact revise — normative

```
phax artifact revise <path> --amendment <file|-> [--by operator|machine:<grant>] [--model <id>] [--effort low|medium|high] [--json]
```

The command name and `--by`, `--json` and `--model`/`--effort` are normative. The `--amendment` spelling is indicative. The model defaults follow headless authoring: the flag, then phax.json's `authoring.<kind>`, then the catalog default.

### file: an amendment — indicative

Plain text, read as written:

```
The identity crate must compile, pass clippy and pass its tests, offline,
on a migrated SQLite, at every phase that touches its code.
```

### cli: the report — indicative

```
revise plan identity-store — amendment from amendment.md — headless, resumed authoring session
model      claude-sonnet-5-5 / medium (authoring.plan) on claude-code
questions  1 new open: Q4 — Run the SQLite migration in the gate, or assume it?
--- body diff ---
…
commit     8b2e4d1 — docs(plans): revise identity-store
status     Draft — read the diff above, then `phax artifact decide docs/plans/2610271402-identity-store-plan.md` (Q4 open)
```

`--json` keys (normative): `artifact`, `status`, `session` (`new` | `resumed-authoring`), `provider`, `model`, `requestedModel`, `effort`, `newQuestions`, `diff`, `commit` (`hash`, `subject`) or `null`, `revisionId`. Progress, warnings and record lines go to stderr.

### cli: refusals — wording indicative, exit codes normative

```
✗ revise refused: docs/plans/…-plan.md is Approved — reopen it first: phax artifact reopen docs/plans/…-plan.md
✗ revise refused: docs/plans/…-plan.md is hand-authored (no sidecar) — edit the .md directly
✗ revise refused: the writer changed question Q2 — a revision never touches a question; decide it with phax artifact decide
```

Exit codes: 0 revised and committed, or no change; 1 inside a phase worktree; 5 refused answer after the corrective resume; 8 provider rate or usage limit, nothing written; 12 refusal.

### cli: the commit — normative

```
docs(plans): revise identity-store

Revised headless (claude-sonnet-5-5 / medium, claude-code) from this amendment:

The identity crate must compile, pass clippy and pass its tests, offline,
on a migrated SQLite, at every phase that touches its code.

Artifact: docs/plans/2610271402-identity-store-plan.md
Revised-By: machine (plan-loop)
Revision-Id: 2610271402-identity-store/01
```

## 7. Non-goals

- Hand-authored artifacts. They are edited directly; there is no sidecar to keep in sync.
- Approved or Stale artifacts. `reopen` comes first, and revise never voids an approval.
- Changing, answering or removing a question. That is `decide`.
- Frontmatter: `source-spec`, `completes-spec` and `status` are not revised.
- An interactive revise session, or a confirmation prompt before the commit.
- Revising a plan from a landed run. That is `adjust-plan`.
- Revising several artifacts at once, such as a spec and its plans.
- Archived artifacts.

## 8. Acceptance criteria

### A plan is revised from an amendment

Given a Draft headless plan in sync, with its kept authoring session on the writer's provider, when `phax artifact revise <plan> --amendment amendment.md --by operator` runs and the writer returns a valid document, then the `.md` and sidecar are rewritten and committed in one commit, the extraction cache holds the new document, `phax artifact status` reports Draft and `in sync`, and the report says `resumed authoring session`. (refs §5.1, §5.2, §5.10)

### A spec is revised in a new session

Given a Draft headless spec whose kept session ran on another provider, when revise runs, then a new session starts, its prompt carries the current document, the kept brief and the amendment, and the report says `new`. (refs §5.1, §5.2)

### Only a Draft is revised

Given an Approved plan, and then a Stale one, when revise runs, then each exits 12 naming `phax artifact reopen <path>`, no session starts, and HEAD is unchanged. (refs §5.3)

### Only a headless artifact in sync is revised

Given a hand-authored plan, a diverged sidecar, an invalid one and one stamped below its shape, when revise runs, then each exits 12 before any session, naming its remedy. (refs §5.4)

### A changed question is refused

Given a writer that edits an arbitrated question's verdict, removes an open question, or reorders two questions, when the session ends, then the answer is refused, one corrective resume runs, and on a second refusal revise exits 5 with nothing written. (refs §5.5, §5.7)

### A new open question is accepted

Given a writer that appends one open question, when revise commits, then the question is in the sidecar and in `## Open questions` (a plan) or `## 9. Open questions` (a spec), and the report lists it under `newQuestions`. (refs §5.6, §5.13)

### A malformed answer is refused

Given a writer that returns prose, then a document without `$schema`, when the session ends, then revise exits 5 naming the violation, and the working tree and HEAD are unchanged. (refs §5.7)

### Frontmatter is kept

Given a writer whose document would render a different `source-spec`, when revise commits, then the frontmatter bytes are identical to those before the revision. (refs §5.8)

### No change is not a commit

Given a writer that returns the current document, when revise ends, then it exits 0, says the amendment changed nothing, and HEAD is unchanged. (refs §5.9)

### The commit carries the amendment and the requester

Given `--by machine:plan-loop`, when revise commits, then the commit subject is `docs(plans): revise <slug>`, the body carries the amendment verbatim, and the trailers are `Artifact`, `Revised-By: machine (plan-loop)` and `Revision-Id`. (refs §5.11)

### No requester without a terminal

Given no terminal and no `--by`, when revise runs, then it exits 12 naming `--by operator` and `--by machine:<grant>`, before any session. (refs §5.12)

### The JSON report

Given `--json`, when revise commits, then stdout is one JSON object with exactly the normative keys, and progress goes to stderr. (refs §5.13)

### A concurrent edit is kept

Given the plan file edited on disk while the writer runs, when the session ends, then revise exits 12, writes nothing of its own, and the edit is still in the working tree. (refs §5.14)

### A writer routed to Vibe is refused

Given `--model` routed to Mistral Vibe, when revise runs, then it exits 12 before any session. (refs §5.15)

### The revision is explained

Given records configured, when a revision commits, then `phax records explain <commit>` shows its revision record. When a revision fails with exit 5, a revision record with outcome `failed` exists. (refs §5.16)

## 9. Open questions

### Q1 — What may a revision do to the questions?

- frozen-append — existing questions frozen, new open questions may be appended — abandons: an amendment that settles an open question still needs a `decide` to close it.
- frozen — every question frozen, nothing appended — abandons: an ambiguity the amendment raises has no place but the body, where the approval gate cannot see it as open.
- open-free — arbitrated frozen, open questions freely added, edited or removed — abandons: an open question can vanish with no verdict and no trace of who settled it.

Recommendation: frozen-append — a verdict comes only from `decide`, and naming a new ambiguity costs nothing, while one extra `decide` is cheap and records who settled the question.

### Q2 — Confirm the diff before committing?

- never — always commit, then print the report — abandons: a person at a terminal sees the diff only after the commit, and undoes it with a revert.
- on-terminal — ask when there is a terminal, commit without asking otherwise — abandons: one command that behaves two ways depending on a TTY, and an agent driving a PTY that hangs on the prompt.

Recommendation: never — the artifact stays Draft and `approve` is the gate where a person reads it, as in decide's verdicts mode.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The writer session, its resume rule, its read-only posture, the Vibe refusal, the one corrective resume and the concurrent-edit check work as in `decide --verdicts`; reuse that path rather than build a second one.
- Rendering, sidecar writing and extraction-cache seeding are headless authoring's.
- `Revision-Id` is `<authoringId>/<NN>`, numbered per artifact like `Decision-Id`. The revision's prompts, answer, amendment and diff are kept under the state root beside decide's.

Left open:

- The `--amendment` spelling (indicative).
- Whether the writer's prompt shows the amendment as a diff target or as a brief addendum.

Constraints:

- The decide doctrine skills do not apply; the writer follows the authoring skill of the artifact's kind (`phax-spec` or `phax-planning`).
- A spec revision runs the spec document's traceability checks, and a plan revision runs the plan document's decode checks, as authoring does.

## 11. Docs page

Page: docs/revising-drafts.md, published at /guide/revising-drafts

Reader: An operator or an agent holding a Draft headless spec or plan that needs a change no open question asks for.

Example: `phax artifact revise docs/plans/2610271402-identity-store-plan.md --amendment amendment.md --by machine:plan-loop`, then the report, then `phax artifact approve`.
