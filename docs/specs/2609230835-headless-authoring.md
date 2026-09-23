---
status: Draft
date: 2026-09-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Headless Authoring — `artifact new spec|plan --headless`

## 1. Context

`phax artifact new spec|plan <slug>` writes a stamped, frontmatter-only skeleton
(`docs/specs/<YYMMDDHHMM>-<slug>.md`, `docs/plans/<YYMMDDHHMM>-<slug>-plan.md`) and does not
commit. A human, or a loop, then writes the body in a session that loads the `phax-spec` or
`phax-planning` skill. That session runs outside phax: it is not recorded, its output is a
Markdown document, and nothing validates it until `plans lint` (plans) or a human's eyes
(specs). Of the four model invocations in a phax lifecycle — spec, plan, phase, review — only
the phase and the reviews run inside phax and land in records (`phax/records/v1`, one record
per `runId/phaseId`, transcript and usage included).

`phax run` turns `plan.md` into its structured form in two stages: a deterministic parse of
the `phax-planning` shape, then a model extraction validated against the extracted-plan
schema and kept in a content-addressed cache keyed on the plan text, the extraction model and
effort. A plan written off the fast path costs one model call at every cache miss.

Spec 23 (`phase-decision-requests`) fixed the shape of a question a machine can answer:
`{ question, options[], recommendation }`. The steme roadmap-1.0 experiment (protocol §3.2,
§5) is the first consumer of this spec: its conductor writes each spec headless from a brief
carrying the roadmap item's `surface` list (typed strings such as ``cli: `phax …` `` and
``file: `<stamp>-<slug>.json` ``), its anchors and a situation report; hands the spec's open
questions **as data** to a separate arbitration session; approves; writes the plan headless;
runs. It requires the spec's surface section to show before/after artifacts with real fields
and the spec to carry a docs-page section. No session survives a usage sleep: a step is
redone from scratch, never resumed.

## 2. Problem

Two of the four model invocations sit outside phax. Their sessions are unrecorded and
unexplainable; their output is prose that a loop must parse to find the open questions, the
requirements, the surface; a plan written this way is extracted a second time through a model
at run time, on the same content, with a second chance to drift; and nothing checks the
artifact's structure at the moment it is written. A conductor that needs answerable open
questions, one recorded session per artifact and zero model calls between plan and run cannot
get them from the interactive path, and every consumer would otherwise write its own JSON
schema and its own renderer.

## 3. Product goal

Move authoring inside phax with the rule the headless review already established: phax spawns
the authoring session with the matching skill and an output schema, accepts **schema-validated
JSON only**, and materialises everything else itself — the Markdown rendering, the stamp and
name, the sidecar, the commit, the record. A plan authored this way is never extracted through
a model again. The interactive path is untouched, and every addition is additive to the CLI
contract; the spec document format is new and ships **experimental**, outside the 1.0
stability promise.

> The agent emits validated JSON only; phax materialises, names, commits and records — or
> nothing lands.

## 4. Terminology

- **Brief** — the caller's prompt file: what to write and from what ground. phax prepends the
  skill and the output schema; the brief is never the whole prompt.
- **Authoring session** — the provider session phax spawns for one `--headless` invocation.
- **Spec document** — the JSON a spec authoring session returns, in the spec document schema
  this spec introduces. **Plan document** — the JSON a plan session returns: the extracted-plan
  shape (`phax-plan.json` as the extractor emits it) plus the informational content a `plan.md`
  needs.
- **Rendering** — the Markdown artifact phax derives deterministically from a document.
- **Sidecar** — the document persisted beside its rendering under the same stamped name with a
  `.json` extension. An artifact written interactively has none.
- **Authoritative sidecar** — a sidecar whose rendering equals the artifact's body. A consumer
  reads structured content (open questions, requirements, surface) from it, never from prose.
- **Decision-request shape** — an open question as `{ id, question, options[], recommendation,
  rationale }`, where each option names what choosing it abandons.
- **Authoring record** — the record phax writes for an authoring session: brief, prompt,
  document, transcript, provider/model/effort, usage, outcome, and the artifact commit.

## 5. Functional requirements

### 5.1 Invocation, and the interactive path unchanged

- WHERE `--headless` is given THE system SHALL spawn the authoring session itself, loading the
  skill that matches the artifact kind and the output schema for that kind.
- The system SHALL leave `artifact new spec|plan <slug>` without `--headless` unchanged: a
  frontmatter-only skeleton, no session, no commit.
- IF `--headless` is given without `--brief` THEN the system SHALL refuse before spawning.
- IF the slug is off-grammar, the target name or its sidecar already exists, the brief cannot
  be read, or (plan) `--spec` is missing or not a valid spec, THEN the system SHALL refuse
  before spawning, with the same refusal family as the interactive path.

### 5.2 JSON-only result

- WHEN an authoring session ends THE system SHALL accept as its result only a JSON document
  that validates against the output schema of the artifact kind.
- IF the result is not JSON or fails validation THEN the system SHALL fail as a provider
  error naming the first violation by path, and SHALL leave the working tree unchanged — no
  artifact, no sidecar, no commit.
- IF the session ends on a provider rate or usage limit THEN the system SHALL fail in the
  existing rate-limit family, with nothing written.

### 5.3 Spec document

- WHERE the kind is `spec` THE system SHALL require the document to carry: the ground it
  read, context, problem, product goal with a guiding rule, terminology, requirements,
  surface, non-goals, acceptance criteria, open questions, a planning note, and a docs-page
  section.
- The system SHALL require every requirement to declare its EARS pattern and every
  acceptance criterion to reference at least one requirement id that exists.
- IF a requirement is referenced by no acceptance criterion THEN the system SHALL reject the
  document (an uncovered requirement breaks traceability).
- The system SHALL require every surface element to be a typed string in the roadmap form
  (`cli:`, `config:`, `file:`, `api:`, `package:`, `internal:`), bound `normative` or
  `indicative`, and to carry a materialised `after` block and a `before` block that is either
  the current artifact or explicitly null.
- The system SHALL require every open question in the decision-request shape, with at least
  two options, a recommendation naming one of them, and a rationale.

### 5.4 Plan document and extraction cache

- WHERE the kind is `plan` THE system SHALL require the document to carry a projection that is
  exactly the extracted-plan shape, and SHALL validate it against the same schema the
  extractor's output is validated against.
- WHEN a plan document is materialised THE system SHALL seed the extraction cache with its
  projection, keyed as `phax run` will look it up, so the rendered plan is never extracted
  through a model.
- The system SHALL render a plan that the deterministic parser reads and that yields the
  same structured plan as the seeded projection.
- WHERE `--spec <path>` is given THE system SHALL bind it as `source-spec` exactly as the
  interactive path does, and SHALL give the authoring session the spec's content.

### 5.5 Materialisation

- WHEN a document validates THE system SHALL render the Markdown artifact from it, name and
  stamp it exactly as the interactive path does, and write the sidecar beside it under the
  same stamped name.
- The system SHALL render the same Markdown for the same document (determinism).
- WHERE the kind is `spec` THE system SHALL render the canonical ten-section structure of the
  `phax-spec` skill followed by a docs-page section, with §6 as materialised before/after
  blocks per element and §9 in the arbitration format (one "abandons" line per option, then
  the recommendation).
- WHERE the kind is `plan` THE system SHALL render the `phax-planning` shape with every
  extracted field on the fast path and every informational section present.

### 5.6 Commit

- WHEN the artifact and sidecar are written THE system SHALL commit exactly those two paths
  in one commit.
- IF the commit fails THEN the system SHALL report it as an artifact error and leave the two
  files in the working tree, uncommitted, so the caller can inspect and retry.

### 5.7 Authoring record

- WHEN the commit lands and records are enabled THE system SHALL write an authoring record —
  brief, full prompt, document, transcript per the records transcript setting, provider,
  model, effort, usage, outcome and the artifact commit as its source — under the same
  destination policy as phase records.
- WHILE records are disabled THE system SHALL succeed without writing a record.
- WHEN an authoring session fails after spawning THE system SHALL still write its record with
  a failed outcome (see §9).

### 5.8 Sidecar authority

- WHILE a sidecar exists and its rendering equals the artifact body (frontmatter excluded)
  THE system SHALL treat the sidecar as the artifact's authoritative structured content.
- WHEN a lifecycle transition rewrites or moves the artifact THE system SHALL carry the
  sidecar in the same write-set (including the move to `archive/`).
- IF the artifact body differs from the sidecar's rendering THEN the system SHALL report the
  divergence in `artifact status` and refuse `artifact approve` naming the remedy (see §9).
- WHILE an artifact has no sidecar THE system SHALL behave exactly as today.

### 5.9 Status reporting

- WHEN `artifact status` inspects an artifact THE system SHALL report whether it was authored
  headless, the sidecar path, and whether the sidecar is in sync or diverged.

### 5.10 Schemas visible to consumers

- The system SHALL expose the spec document and plan document JSON Schemas to a consumer
  without a model call, each titled as experimental.

## 6. Surface

Invocation (`--headless` and `--brief` **normative**; `--model`/`--effort` **normative** as
names, defaults §9):

```
phax artifact new spec headless-authoring --headless --brief brief.md [--model claude-opus-5-5 --effort high]
phax artifact new plan headless-authoring --headless --brief brief.md --spec docs/specs/2609230835-headless-authoring.md
```

Output sketch (that the four facts are printed is **normative**; layout **indicative**):

```
authoring spec headless-authoring — claude-opus-5-5 / high
created docs/specs/2609230835-headless-authoring.md (Draft, headless)
sidecar docs/specs/2609230835-headless-authoring.json
commit  a1b2c3d — docs(specs): draft headless-authoring
record  authoring/2609230835-headless-authoring
```

Refusals and failures (exit-code families **normative** — they are the existing ones; wording
**indicative**):

| Situation                                                       | Exit |
| --------------------------------------------------------------- | ---- |
| bad slug, target or sidecar exists, unreadable brief, bad `--spec`, commit failed | 12 |
| session result not JSON, or fails the document schema           | 5    |
| provider rate or usage limit                                    | 8    |
| authored and committed (record written or records off)          | 0    |

```
✗ authoring failed: spec document rejected — acceptanceCriteria[2].refs[0]: "5.9" names no requirement
  nothing written; the session is recorded as failed
$? = 5
```

Spec document, at `docs/specs/<stamp>-<slug>.json` (location and top-level keys
**normative**; nested field spellings **indicative** except where marked). Abridged, real
fields, a made-up `plan-prune` example:

```json
{
  "version": 1,
  "kind": "spec",
  "title": "Plan Prune",
  "ground": [{ "path": "docs/ideas/plan-prune.md", "note": "the idea this spec makes precise" }],
  "context": "A slug is held forever by its archived run…",
  "problem": "The `-2` habit is the visible symptom…",
  "productGoal": { "statement": "…", "guidingRule": "A slug is held only by a live run." },
  "terminology": [{ "term": "live run", "definition": "a run that is not archived" }],
  "requirements": [
    { "id": "5.1", "title": "Prune eligibility", "pattern": "event",
      "statement": "WHEN a run is archived THE system SHALL make it eligible to prune." }
  ],
  "surface": [
    { "surface": "cli: `phax prune <run>`", "binding": "normative",
      "before": null,
      "after": "phax prune usage-cli\n  pruned usage-cli (archived 2026-09-01)\n  $? = 0" },
    { "surface": "config: `phax.json` `archive.prune`", "binding": "indicative",
      "before": "\"archive\": { \"keep\": 10 }",
      "after": "\"archive\": { \"keep\": 10, \"prune\": \"manual\" }" }
  ],
  "nonGoals": ["pruning a run that is not archived"],
  "acceptanceCriteria": [
    { "id": "AC-1", "name": "Prune frees the slug",
      "given": "an archived run usage-cli", "when": "`phax prune usage-cli` runs",
      "then": "the slug is free and the registry no longer lists the run", "refs": ["5.1"] }
  ],
  "openQuestions": [
    { "id": "Q1", "question": "Is pruning manual or automatic past `keep`?",
      "options": [
        { "id": "manual", "label": "an explicit `phax prune`", "abandons": "the registry ever shrinking on its own" },
        { "id": "auto",   "label": "prune past `keep` at archive time", "abandons": "an archived run being inspectable after the fact" }
      ],
      "recommendation": "manual", "rationale": "records already keep the trajectory; the run folder is disposable but not silently." }
  ],
  "planningNote": { "settled": ["…"], "open": ["…"], "constraints": ["…"] },
  "docsPage": { "kind": "page", "page": "docs/cli/prune.md", "reader": "an operator whose `-2` runs pile up", "example": "…" }
}
```

Normative within the document: `pattern` is one of `ubiquitous | event | state | unwanted |
optional`; `surface` matches `^(cli|config|file|api|package|internal): `; `binding` is
`normative | indicative`; `openQuestions[].{id, question, options[].{id, label, abandons},
recommendation, rationale}` (the decision-request shape of spec 23 plus `rationale` and the
per-option `abandons`); `docsPage` is `{ kind: "page", page, reader, example }` or
`{ kind: "none", why }`; `refs` names existing `requirements[].id`s.

Rendered spec (structure **normative**: ten canonical sections then `## 11. Docs page`; the §6
and §9 renderings below are **normative** in shape, prose framing **indicative**):

```
## 6. Surface

### cli: `phax prune <run>` — normative

    phax prune usage-cli
      pruned usage-cli (archived 2026-09-01)
      $? = 0

### config: `phax.json` `archive.prune` — indicative

before:
    "archive": { "keep": 10 }
after:
    "archive": { "keep": 10, "prune": "manual" }

## 9. Open questions for implementation planning

### Q1 — Is pruning manual or automatic past `keep`?

- manual — an explicit `phax prune` — abandons: the registry ever shrinking on its own
- auto — prune past `keep` at archive time — abandons: an archived run being inspectable after the fact

Recommendation: manual — records already keep the trajectory; the run folder is disposable but not silently.
```

Plan document, at `docs/plans/<stamp>-<slug>-plan.json` (location **normative**; the
extracted projection — `version`, `run.{shortName,title,requiredCommands}`,
`phases[].{id,model,effort,planMarkdownAnchor,plannedFilesToCreate,plannedFilesToEdit,optionalFilesToEdit,commit}`
— **normative** and equal to the extracted-plan schema; the informational keys **indicative**):

```json
{
  "version": 1,
  "kind": "plan",
  "sourceSpec": "docs/specs/2609230835-headless-authoring.md",
  "run": { "shortName": "headless-authoring", "title": "Headless authoring", "requiredCommands": ["pnpm gen:usage-spec"] },
  "preamble": { "summary": "…", "requiredCommandsNote": "…", "technicalArbitrations": ["…"] },
  "phases": [
    { "id": "phase-01", "title": "Spec document schema and renderer",
      "model": "claude-opus-5-5", "effort": "high",
      "planMarkdownAnchor": "#phase-01-spec-document-schema",
      "plannedFilesToCreate": ["…"], "plannedFilesToEdit": ["…"], "optionalFilesToEdit": [],
      "commit": { "subject": "feat(schemas): spec document schema", "body": "…" },
      "objective": "…", "detailedInstructions": ["…"], "boundaryContracts": "…",
      "testStrategy": "…", "implementationOrder": ["…"], "excludedScope": ["…"],
      "verification": "standard", "expectedHandoff": "…" }
  ]
}
```

Rendered plan: the `phax-planning` shape (`## phase-NN — <Title> {#anchor}`, the recommended
model/effort lines, the three planned-file sections with `- (none)` for empty, the commit
subsections, every informational section) — **normative** that it passes `phax plans lint`
with no structure error and parses on the deterministic path.

`artifact status` (that authoring mode and sidecar agreement are reported is **normative**;
wording **indicative**):

```
Path:              docs/specs/2609230835-headless-authoring.md
Kind:              spec
Status:            Draft
Authored:          headless — sidecar docs/specs/2609230835-headless-authoring.json (in sync)
Legal transitions: Approved, Abandoned
```

with `(diverged — body differs from the sidecar's rendering)` and, for an interactive
artifact, `Authored: interactive (no sidecar)`.

Authoring record on `phax/records/v1` (that it exists with these facts is **normative**; key
and manifest layout are §9):

```
authoring/2609230835-headless-authoring/
  record.json    { version: 1, kind: "authoring", artifact: "docs/specs/2609230835-headless-authoring.md",
                   artifactKind: "spec", sourceSha: "a1b2c3d…", provider, model, effort,
                   outcome: "committed" | "failed", usage: { available, … } }
  brief.md  prompt.md  document.json  output.jsonl
```

Commit message (that it is one path-scoped commit of the artifact and sidecar is
**normative**; subject **indicative**): `docs(specs): draft headless-authoring` /
`docs(plans): draft headless-authoring`.

Schema access (**indicative**): `phax artifact schema spec|plan` prints the document JSON
Schema, titled `phax spec document (experimental)` / `phax plan document (experimental)`.

No visual UI, no design annex. No `phax.json` change (defaults are §9).

## 7. Non-goals

- **The interactive flow** — `artifact new` without `--headless`, the skills' Markdown-first
  workflow and hand-edited artifacts change in nothing.
- **Resuming an authoring session** — a failed or interrupted session is re-run from scratch
  (the first consumer discards sessions on sleep by protocol); the record is for explanation.
- **Answering open questions** — no arbiter, no `artifact decide`, no write-back of answers
  into the spec; the conductor's journal is its own file.
- **Reverse rendering** — Markdown is never parsed back into a document; a hand edit demotes
  the sidecar (§9), it does not update it.
- **Back-filling sidecars** for existing specs and plans.
- **Quality lint of a spec** (EARS wording, page budget, layer discipline) beyond schema
  validation and traceability — that stays with the human gate.
- **A brief on stdin** (§9), **`phax.json` authoring defaults** (§9), other artifact kinds,
  the docs page itself (only its section is authored), the `review-as-plan` and
  `schemas-package` specs, and any change to spec 23's persisted decision record.
- **Stability of the document formats** — both ship experimental; the 1.0 promise does not
  cover them until a later spec says so.

## 8. Acceptance criteria

### Headless spec lands whole

Given a readable brief, when `phax artifact new spec <slug> --headless --brief <file>` runs
and the session returns a valid spec document, then `docs/specs/<stamp>-<slug>.md` and
`docs/specs/<stamp>-<slug>.json` exist, are the only paths in the new HEAD commit, the
Markdown has the ten canonical sections and `## 11. Docs page`, and the exit code is 0.
(refs §5.1, §5.5, §5.6)

### Interactive path untouched

Given the same slug, when `phax artifact new spec <slug>` runs without `--headless`, then
the file written is byte-identical to today's skeleton, no sidecar exists, and no commit is
made. (refs §5.1)

### Refusals precede the session

Given a slug that already names a spec, or `--headless` without `--brief`, when the command
runs, then it exits 12 and no session was spawned. (refs §5.1)

### Invalid JSON lands nothing

Given a session that returns prose, or a document whose acceptance criterion references a
missing requirement id, when the session ends, then the command exits 5 naming the violation
path, and the working tree and HEAD are unchanged. (refs §5.2, §5.3)

### Surface elements are materialised

Given a spec document with a surface element whose `before` is a config block and `after` a
config block, when rendered, then §6 shows both blocks under a `### <typed surface> —
<binding>` heading, and a document with an element lacking `after` is rejected. (refs §5.3,
§5.5)

### Open questions are decision requests

Given a spec document with an open question, when rendered, then §9 shows one "abandons"
line per option and a recommendation line naming the recommended option, and a question whose
`recommendation` names no option is rejected. (refs §5.3, §5.5)

### Plan never re-extracts

Given a headless plan, when `phax plans lint` and then `phax run` (or `phax plans overlap
--no-extract`) read it, then lint reports no structure error, the structured plan equals the
sidecar's projection, and no provider session was spawned for extraction. (refs §5.4)

### Rendering is deterministic

Given the same spec document rendered twice, when the outputs are compared, then they are
identical. (refs §5.5)

### Record explains the artifact

Given records enabled and a headless spec committed at `<sha>`, when
`phax records explain <sha>` runs, then it shows the brief, the prompt, the document, the
transcript (if enabled), model, effort, usage and outcome `committed`. (refs §5.7)

### Failed session still recorded

Given records enabled and a session whose result fails validation, when the command exits 5,
then a record exists with outcome `failed` and the transcript, and no artifact commit exists.
(refs §5.2, §5.7)

### Sidecar travels and is checked

Given a headless spec, when `phax artifact approve` then `phax artifact complete` run, then
each transition commit contains the sidecar alongside the artifact and the sidecar ends under
`docs/specs/archive/`; and given a hand edit to the body after authoring, when
`phax artifact status` runs, then it reports `diverged`, and `phax artifact approve` exits 12
naming the remedy. (refs §5.8, §5.9)

### Schemas are printable

Given an installed phax, when `phax artifact schema spec` runs, then it prints a JSON Schema
whose title says experimental, with no provider call. (refs §5.10)

## 9. Open questions for implementation planning

Question: is the sidecar authoritative, and what happens when the Markdown is hand-edited?

- Authoritative when present and in sync; divergence demotes it silently to "interactive" —
  abandons: any guarantee that what the arbiter answered is what the human approved.
- Authoritative when present; divergence is reported and blocks `approve` until the sidecar
  is deleted (explicit demotion) or the artifact is re-authored — abandons: touching up a
  rendered spec by hand without a visible extra gesture.
- Sidecar always authoritative, Markdown regenerated by a command — abandons: the skills'
  edit-the-Markdown workflow and adds a render command to the CLI surface.

Recommendation: the second — a hand-edited artifact has no sidecar by definition, so make
the demotion a deliberate deletion; `approve` already refuses on an unrecorded or edited
spec, this is the same posture.

Question: where does the authoring record live?

- Reuse the phase record manifest with `runId` = the artifact name and `phaseId` =
  `authoring` — abandons: an honest manifest; `records list` would show a run that never ran.
- A distinct `authoring` record kind keyed `authoring/<stamp>-<slug>`, its own manifest,
  resolved by `records explain` through the artifact commit sha — abandons: a single record
  shape on the branch; every records consumer learns a second manifest.

Recommendation: the distinct kind — records are a persisted format the 1.0 promise will
cover; a lie in the manifest is worse than a second, explicit shape.

Question: seed the extraction cache, or rely on the deterministic render alone?

- Both: seed with the projection under the key `phax run` will compute (the configured
  extraction model and effort at authoring time), and render on the fast path — abandons:
  nothing observable; a cache entry that a config change can orphan.
- Deterministic render only — abandons: the "never re-extracted" guarantee the moment a
  renderer bug drops a plan off the fast path (a silent model call).

Recommendation: both — the seed is cheap and the acceptance criterion checks the outcome
(no extraction session), not the mechanism.

Question: where do the model and effort defaults come from?

- Flags with built-in defaults from the catalog (the planning skill's recommended model,
  `high`) — abandons: per-project pinning without passing flags.
- New `phax.json` `authoring.{spec,plan}.{model,effort}` keys — abandons: keeping this spec
  off the config contract right before its freeze.

Recommendation: flags with built-in defaults — the first consumer passes flags on every call;
a config key can be added later without breaking anything.

Question: `--brief` from a file only, or also stdin?

- File only — abandons: one temp file per call for a scripted caller.
- Also `--brief -` — abandons: a brief path the record can name verbatim; the recorded brief
  becomes a copy phax made.

Recommendation: file only — the record must name and carry the brief; the conductor writes
files anyway.

Question: record a failed session?

- Record it with outcome `failed` — abandons: the symmetry "no artifact, no trace" in the tree
  (the trace is on the records branch, not in the tree).
- No record on failure — abandons: the loop's only diagnostic for a session that produced
  nothing.

Recommendation: record it — this mirrors phase records, and a failed authoring session is the
most useful transcript a loop will ever read.

Question: is the docs-page section required in every spec document?

- Required, with an explicit `{ kind: "none", why }` variant — abandons: nothing; a
  phax-internal spec writes `none` with a reason.
- Optional — abandons: the explicit-over-permissive rule; a consumer cannot tell "forgot"
  from "not applicable".

Recommendation: required with the `none` variant.

## 10. Implementation-planning note

Settled: the two `--headless` invocations and their flags; JSON-only results validated at the
boundary with nothing written on failure; the spec document's section set, EARS `pattern`,
typed `surface` strings with `binding` and before/after blocks, traceability check, the
decision-request shape of open questions, the required docs-page section; the plan document
as extracted-plan projection plus informational content; deterministic rendering to the
canonical spec structure and the `phax-planning` shape; one path-scoped commit of artifact
plus sidecar; the sidecar in every transition write-set; an authoring record when records are
on; `artifact status` reporting authoring mode and sidecar agreement; both schemas printable
and titled experimental; the exit-code families in §6.

Left open until the §9 defaults are reviewed: sidecar demotion posture, record kind and key,
cache seeding, default model/effort, stdin brief, failed-session record, the `none` docs-page
variant. Also open to the planner: the exact rendering prose, the section anchors, and the
schema-print spelling.

Constraints the plan must respect: the authoring session is a recorded provider session in the
repository root under the read-only review posture (the brief names corpus paths the agent
must read; it must write nothing — the document is the session's final message); the result
crosses into phax as external input and is decoded through a schema before anything else
happens; the extracted projection of a plan document must be the extracted-plan schema itself,
not a copy; the deterministic parser is the oracle for the plan rendering (render → parse →
equals projection is a unit test, not a hope); the interactive `createArtifact` path is not
touched — the headless path composes it; transition write-sets extend to the sidecar through
the existing write-set discipline; the spec document schema is versioned (`version: 1`) with no
optional-for-back-compat fields, and its experimental status is stated in the schema title and
in the README's persisted-formats note, never as a field of the instance. Keep the spec's
`ground` list as the citation the first consumer expects ("the spec cites what it read").
