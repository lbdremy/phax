---
status: Draft
date: 2026-10-21
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Surface summary: one line per §6 element, in the consumer's words

## 1. Context

A spec's §6 Surface lists the elements of a change that a consumer can see or touch. In the spec document format, each element is `{ surface, binding, before, after }`:

- `surface` names where the change lands, by kind prefix and name (`cli: phax validate`, `config: phax.json assignments`).
- `binding` says whether the shape is the contract (`normative`) or the intent (`indicative`).
- `before` and `after` materialize the element.

The renderer prints each element as `### <surface> — <binding>`, followed either by the indented `after` block or by labelled `before:` and `after:` blocks. The `phax-spec` skill's sidecar field table lists the four keys. The headless spec authoring prompt embeds the JSON Schema that `phax artifact schema spec` prints, and a decide session returns its revised document against the sidecar's schema.

When a document format changes shape, phax does three things. It freezes the older shape and its rendering, as it did for spec-document 0.17.0. It stamps new sidecars with the release that made the change. It refuses `phax artifact approve`, `reopen` and `decide` across the repository until `phax artifact migrate-documents` has lifted every live sidecar below that stamp. The migration is deterministic and all-or-nothing:

- It refuses a sidecar whose body is no longer its own-shape rendering, so that no hand edit is overwritten.
- It writes everything in one commit.
- It reports the Approved specs it leaves edited since approval and the Approved plans it leaves stale.

Archived specs and their sidecars are never touched.

Five live specs in this repository carry a sidecar today, all stamped spec-document 0.25.0, with 101 surface elements between them. Four are Approved: `headless-review`, `artifact-decide-verdicts`, `oracle-phases` (its plan `oracle-phases-plan` is Approved too) and the earlier `interactive-phases`. One is a Draft: the re-authored `interactive-phases`. Two live specs are hand-authored, with no sidecar.

Ground read:

- `docs/briefs/surface-summary.md` — The brief for this spec. It records five operator decisions of 2026-10-21 that are not reopened: `summary` is required on every element of every kind; it is one sentence, in the consumer's words, saying what changes; the renderer prints it under each heading; archived specs are never touched; the headless authoring prompt and its JSON Schema carry it. It leaves three questions for §9.
- `src/schemas/specDocument.ts` — A surface element is `{ surface, binding, before, after }`. `surface` matches `^(cli|config|file|api|package|internal): `, `binding` is `normative` or `indicative`, `before` is a string or null, and `after` is a non-empty string. The same fields serve the authoring answer (`version: 1`), the sidecar file (`$schema` first) and the revised document a decide session returns (`getSpecDocumentFileJsonSchema`). A comment warns that a `$ref` plus `pattern` pair has its pattern ignored by draft-07 validators.
- `src/domain/authoring/renderSpec.ts` — `renderSurfaceElement` prints `### <surface> — <binding>`, then the indented `after` block when `before` is null, or else labelled `before:` and `after:` blocks. An empty surface renders `None.`.
- `src/domain/authoring/renderSpecV0_17_0.ts` — The frozen 0.17.0 spec rendering, used only by `phax artifact migrate-documents` as the own-shape rendering of an older sidecar. It is self-contained so that later helper changes cannot move it.
- `src/schemas/persisted.ts` — `readSpecDocumentSidecar` lifts a sidecar stamped below the current shape (0.17.0 or pre-schema) to the current in-memory document and keeps the older value for the own-shape comparison.
- `src/schemas/release.ts` — `CURRENT_STAMPS` sets `spec-document` at 0.25.0 and `plan-document` at 0.26.0. package.json is at 0.26.0.
- `src/domain/artifact/documentMigration.ts` — `decideDocumentMigration` refuses a sidecar whose body is not its own-shape rendering, because a hand edit would be overwritten. Otherwise it rewrites the sidecar at the current shape and re-renders the body with the frontmatter kept byte for byte. Its refusal remedy is `sidecarRemedy`: re-author headless, or delete the sidecar to demote the spec to hand-authored.
- `src/app/migrateDocuments.ts` — Phase A decides every live sidecar and writes nothing; any single refusal fails the whole command. Phase B writes the files and makes one commit. The report names the Approved artifacts left edited since approval and the Approved plans left stale (`spec-changed`) because their spec was re-rendered. Archived and hand-authored artifacts are never touched.
- `src/app/unmigratedDocuments.ts` — `refuseUnmigratedDocuments` makes `phax artifact approve`, `reopen` and `decide` refuse across the whole repository while any live sidecar is stamped below its current shape, and names `phax artifact migrate-documents`. `complete` and `abandon` do not call it.
- `src/domain/artifact/render.ts` — The migrate-documents report: a `spec-document 0.25.0 → <stamp>` group header, one line per artifact with status and question counts, a `now edited since approval — re-approve with …` line, a `stale (spec-changed)` block, and a `committed <hash> <subject>` line.
- `scripts/rerender-spec.ts` — Repository-only tooling, not shipped by phax. It re-renders a spec body from a hand-edited sidecar at the current shape and refuses an older one.
- `.claude/skills/phax-spec/SKILL.md` — The Surface section, the canonical Markdown template's §6, and the headless sidecar field table row `surface` — `[{ surface, binding, before, after }]`.
- `docs/upgrading.md` — Each release has a section. For 0.25.0 and 0.26.0 it tells the operator to run `phax artifact migrate-documents` once, and that approve, reopen and decide refuse until they do.
- `docs/specs/` — Five live specs carry a sidecar stamped spec-document 0.25.0, with 101 surface elements in all: `headless-review` (Approved, 14), `artifact-decide-verdicts` (Approved, 7), `oracle-phases` (Approved, 22, with the Approved plan `oracle-phases-plan` bound to it), the earlier `interactive-phases` (Approved, 24) and its re-authoring `interactive-phases` (Draft, 34). Two live hand-authored specs, `batch-execution-disjoint-plans` and `phase-decision-requests`, have no sidecar.

## 2. Problem

A surface element says where a change lands, and its blocks show the change. Nothing says in one sentence what the change means to whoever consumes it. A reader of §6 has to compare `before` with `after` for each element to work that out.

The phax repository wants to build its release notes from the specs a release completes, instead of GitHub's notes generated from PR titles. For each spec it would print the title, the guiding rule, and one line per surface element. Today there is no such line to print. Copying the element's name would list where changes landed, not what they are for.

The sentence cannot be derived afterwards from the blocks or the code. Only the author knows what the change means to its consumer, so the sentence has to be written with the spec and carried by it.

## 3. Product goal

Every surface element of a spec document carries a required, one-sentence `summary` in the consumer's words. The author writes it, whether that is a headless session or the operator. phax requires it in every schema an authoring or decide session writes against, and prints it in §6 under the element's heading, so the sidecar and the Markdown say the same thing. The `phax-spec` skill teaches how to write it. Live sidecars move to the new shape through `phax artifact migrate-documents`, and archived specs stay as they are. The release-notes tooling that will read the line is not part of this change.

> Every surface element says, in one sentence and in its consumer's words, what changes for them. phax requires that sentence and never writes it.

## 4. Terminology

- **surface element** — One entry of a spec document's `surface` list, one `### ` block in §6. Its kind is the prefix of its `surface` value: `cli`, `config`, `file`, `api`, `package` or `internal`.
- **summary** — The new required field of a surface element. It is one sentence, in the consumer's words, saying what the consumer of that element can now do or sees differently. It never says where the change lives or how it is built. Example: "`phax validate` checks each assignment bound against the routing catalog."
- **consumer** — Whoever touches the element. That is the operator for a `cli:` or `config:` element, a reading tool or person for a `file:` or `api:` element, a dependent package for a `package:` element, and the phax code or agent that relies on it for an `internal:` element.
- **live spec** — A spec directly under `docs/specs/`, with status Draft or Approved. An archived spec (Completed or Abandoned, under `docs/specs/archive/`) is not live.
- **own-shape rendering** — The body phax rendered for a sidecar at the shape it is stamped at. `phax artifact migrate-documents` migrates a sidecar only while its body is still this rendering.
- **summary placeholder** — The fixed, recognisable `summary` value that `phax artifact migrate-documents` writes when it lifts an element that had no summary. This applies only under q-lift's recommended default (§9). It is not a summary: approve and complete refuse a spec that still holds one.

## 5. Functional requirements

### 5.1 `summary` is required on every element

The system shall require a non-empty `summary` on every surface element of every kind (`cli: `, `config: `, `file: `, `api: `, `package: `, `internal: `). This applies to the headless authoring answer, to a spec sidecar at the current shape, and to the revised document a decide session returns.

### 5.2 A missing or empty summary is refused

IF a headless authoring answer, a decide session's revised document or a spec sidecar at the current shape holds a surface element whose `summary` is absent or empty THEN the system SHALL refuse it as an invalid document, name the element's path (`surface[<i>].summary`) and write nothing.

### 5.3 A summary is one line

IF a surface element's `summary` contains a line break THEN the system SHALL refuse the document as invalid and name `surface[<i>].summary`. This is q-lift's sibling q-bound's recommended default: one line, no character cap.

### 5.4 The JSON Schemas carry `summary`

The system shall list `summary` as a required string property of the surface element, with a description that states the one-sentence, consumer's-words rule. This applies to the JSON Schema `phax artifact schema spec` prints, the one the headless spec authoring prompt embeds, and the sidecar schema a decide session answers against.

### 5.5 §6 prints the summary under each heading

The system shall render each surface element's `summary` in §6 as one line directly under the element's `### <surface> — <binding>` heading. It comes before the `before:` and `after:` blocks, or before the indented `after` block when `before` is null.

### 5.6 Older spec sidecars block arbitrated transitions until migrated

WHILE a live spec sidecar is stamped below the spec-document shape that adds `summary` THE system SHALL refuse `phax artifact approve`, `reopen` and `decide`, naming the sidecar, its stamped shape and `phax artifact migrate-documents`.

### 5.7 migrate-documents lifts older spec sidecars

WHEN `phax artifact migrate-documents` runs over a live spec sidecar that is stamped below the current shape and whose body is still its own-shape rendering THE system SHALL rewrite the sidecar at the current shape with every field other than `summary` unchanged, re-render its body keeping the frontmatter byte for byte, and commit it in the one migration commit.

### 5.8 A lifted element gets the summary placeholder

WHEN `phax artifact migrate-documents` lifts a surface element THE system SHALL set its `summary` to the summary placeholder. This is the recommended default of q-lift.

### 5.9 The migration report counts summaries to write

WHEN `phax artifact migrate-documents` has lifted a spec whose surface is not empty THE system SHALL report, on that spec's line, how many summaries it is left to write. This is the recommended default of q-lift.

### 5.10 Approve and complete refuse a placeholder

IF a spec's sidecar holds a surface `summary` equal to the summary placeholder THEN `phax artifact approve` and `phax artifact complete` SHALL refuse the transition, name every such element by its `surface` value, and write nothing. This is the recommended default of q-lift.

### 5.11 Archived specs are never migrated

The system shall leave every archived spec and its sidecar byte for byte unchanged when `phax artifact migrate-documents` runs.

### 5.12 The skill teaches the summary

The `phax-spec` skill shall define `summary` in its sidecar field table and its Surface section. The definition is one sentence, in the consumer's words, saying what the consumer can now do or sees differently and never where the change lives or how it is built, with one good and one bad example.

### 5.13 Hand-authored specs show the line as guidance

WHERE a spec is hand-authored THE `phax-spec` skill's Markdown template SHALL show the summary line under each §6 element heading, in the form the renderer prints, as guidance phax does not check. This is the recommended default of q-hand.

## 6. Surface

### file: docs/specs/<name>.json — surface element `summary` — normative

before:

    {
      "$schema": "https://docs.phax.run/schemas/spec-document/0.25.0.json",
      …,
      "surface": [
        {
          "surface": "cli: phax validate",
          "binding": "normative",
          "before": null,
          "after": "phax validate\n  ✗ phax.json assignments[1].model: \"claude-opus-9\" is not in the routing catalog"
        }
      ],
      …
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/spec-document/0.27.0.json",
      …,
      "surface": [
        {
          "surface": "cli: phax validate",
          "summary": "`phax validate` checks each assignment bound against the routing catalog.",
          "binding": "normative",
          "before": null,
          "after": "phax validate\n  ✗ phax.json assignments[1].model: \"claude-opus-9\" is not in the routing catalog"
        }
      ],
      …
    }

    # normative: the key `summary`, required on every element of every kind, a non-empty single-line string
    # indicative: its position after `surface`; the stamp release (the release that ships this change)

### cli: phax artifact schema spec — surface item — normative

before:

    "surface": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["surface", "binding", "before", "after"],
        "properties": {
          "surface": { "type": "string", "pattern": "^(cli|config|file|api|package|internal): " },
          "binding": { "type": "string", "enum": ["normative", "indicative"] },
          …
        },
        "additionalProperties": false
      }
    }

after:

    "surface": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["surface", "summary", "binding", "before", "after"],
        "properties": {
          "surface": { "type": "string", "pattern": "^(cli|config|file|api|package|internal): " },
          "summary": {
            "type": "string",
            "pattern": "^[^\\n\\r]+$",
            "description": "One sentence, in the consumer's words: what whoever consumes this element can now do or sees differently. Never where it lives or how it is built."
          },
          "binding": { "type": "string", "enum": ["normative", "indicative"] },
          …
        },
        "additionalProperties": false
      }
    }

    # normative: `summary` in `required`, typed string, in this schema, in the headless authoring prompt and in the decide session's sidecar schema
    # indicative: the description wording; the one-line pattern follows q-bound

### file: docs/specs/<name>.md — §6 element layout — normative

before:

    ### cli: phax validate — normative

        phax validate
          ✗ phax.json assignments[1].model: "claude-opus-9" is not in the routing catalog

    ### config: phax.json assignments — indicative

    before:

        …

    after:

        …

after:

    ### cli: phax validate — normative

    Summary: `phax validate` checks each assignment bound against the routing catalog.

        phax validate
          ✗ phax.json assignments[1].model: "claude-opus-9" is not in the routing catalog

    ### config: phax.json assignments — indicative

    Summary: The operator can bound which model and effort a phase may get, per part of the code.

    before:

        …

    after:

        …

    # normative: one summary line, directly under the heading, before the blocks
    # indicative: the `Summary: ` label spelling

### cli: phax artifact migrate-documents — report — indicative

before:

    spec-document 0.25.0 → 0.25.0
      docs/specs/2610201518-oracle-phases.md  Approved  open 0 · arbitrated 4 (0 lifted)
        now edited since approval — re-approve with `phax artifact approve docs/specs/2610201518-oracle-phases.md`
    stale (spec-changed)
      docs/plans/2610211221-oracle-phases-plan.md  its spec docs/specs/2610201518-oracle-phases.md was re-rendered
    committed 1a2b3c4 chore(artifacts): migrate documents to their current shapes

    # the shape of the report today; the question counts here are illustrative

after:

    spec-document 0.25.0 → 0.27.0
      docs/specs/2609250823-headless-review.md          Approved  open 0 · arbitrated … · 14 summaries to write
      docs/specs/2610191226-artifact-decide-verdicts.md  Approved  open 0 · arbitrated … · 7 summaries to write
      docs/specs/2610190947-interactive-phases.md       Approved  open 0 · arbitrated … · 24 summaries to write
      docs/specs/2610201518-oracle-phases.md            Approved  open 0 · arbitrated … · 22 summaries to write
        now edited since approval — write its summaries, then re-approve with `phax artifact approve docs/specs/2610201518-oracle-phases.md`
      docs/specs/2610211403-interactive-phases.md       Draft     open … · arbitrated … · 34 summaries to write
    stale (spec-changed)
      docs/plans/2610211221-oracle-phases-plan.md       its spec docs/specs/2610201518-oracle-phases.md was re-rendered
    committed 1a2b3c4 chore(artifacts): migrate documents to their current shapes

    # follows q-lift's recommended default; under another option the per-spec count disappears

### cli: phax artifact approve / complete — summary placeholder refusal — indicative

    $ phax artifact approve docs/specs/2610201518-oracle-phases.md --by operator
    ✗ Approval refused: docs/specs/2610201518-oracle-phases.md has 22 surface summaries still to write
      file: plan.md — oracle phase declaration
      file: phax-plan.json — per-phase oracle
      …
      Write each one in docs/specs/2610201518-oracle-phases.json and on its §6 `Summary:` line, then rerun.
    $? = 12

    $ phax artifact complete docs/specs/2610201518-oracle-phases.md
    ✗ Completion refused: docs/specs/2610201518-oracle-phases.md has 22 surface summaries still to write
      …

    # follows q-lift's recommended default. Placeholder in the sidecar (indicative text):
    #   "summary": "(summary to write — lifted by phax artifact migrate-documents)"

### file: .claude/skills/phax-spec/SKILL.md — sidecar field table and Surface section — normative

before:

    | `surface`            | `[{ surface, binding, before, after }]`                      | §6 Surface                               |

after:

    | `surface`            | `[{ surface, summary, binding, before, after }]`             | §6 Surface                               |

    - **`summary`** — one sentence, in the consumer's words: what whoever consumes this element
      can now do or sees differently. Never where the change lives, never how it is built.
      Good: "`phax validate` checks each assignment bound against the routing catalog."
      Bad: "Adds a bounds check to the validate command's config loader."

    Canonical template §6 (per q-hand):

        ### <kind>: <name> — normative | indicative

        Summary: <one sentence: what the consumer can now do or sees differently>

    # normative: the table row's key list; one good and one bad example
    # indicative: the prose and the examples' wording

## 7. Non-goals

- The release-notes script under `scripts/` that reads the summaries. It is repository tooling, and a separate change.
- Dropping the `PHAX: ` prefix from PR titles (`src/domain/publish/title.ts`). That is a separate change.
- Giving archived specs a summary, or reading or rewriting any archived sidecar.
- Any phax command that writes or edits a summary. The author writes it, in the authoring session or by hand in the sidecar and its §6 line.
- Judging a summary's wording. phax checks presence and the one-line shape, and the skill teaches the rest. There is no lint for "says where, not what".
- Filtering elements by kind. A consumer that wants only user-visible elements filters on the `surface` prefix itself.
- Checking that a hand-authored spec's §6 carries a summary line.
- The plan document format, `plan.md`, and `phax-plan.json`, which have no surface elements and are unchanged.

## 8. Acceptance criteria

### An authoring answer without a summary is refused

Given a headless spec authoring answer whose second surface element has no `summary` key, when phax decodes the answer, then it is refused as an invalid document naming `surface[1].summary`, and no spec, sidecar or commit is written. (refs §5.1, §5.2)

### `internal:` elements need a summary too

Given an authoring answer whose only surface element is `internal: phax-plan.json reconciliation` without a `summary`, when phax decodes the answer, then it is refused as an invalid document naming `surface[0].summary`. (refs §5.1)

### An empty summary is refused

Given an authoring answer with a surface element whose `summary` is the empty string, when phax decodes the answer, then it is refused as an invalid document naming `surface[0].summary`. (refs §5.2)

### A decide answer that drops a summary is refused

Given a spec whose sidecar is at the current shape, and a decide session whose revised document has no `summary` on one surface element, when `phax artifact decide` reads the revised document, then the answer is refused as an invalid document naming that element's `surface[<i>].summary`, and the spec and its sidecar are unchanged. (refs §5.2, §5.1)

### A current-shape sidecar without a summary is invalid

Given a live spec whose sidecar is stamped at the current shape but has a surface element without `summary`, when `phax artifact approve <spec> --by operator` runs, then it refuses for an invalid sidecar, naming `surface[<i>].summary`, and writes nothing. (refs §5.2)

### A two-line summary is refused

Given an authoring answer with a surface element whose `summary` contains a line break between two sentences, when phax decodes the answer, then it is refused as an invalid document naming `surface[0].summary`. (refs §5.3)

### The schemas list `summary` as required

Given the phax build that ships this change, when `phax artifact schema spec` runs, a headless spec authoring prompt is built, and a decide session's prompt is built for a spec, then each embedded JSON Schema's surface item lists `summary` in `required`, declares it `"type": "string"`, and carries a description stating the one-sentence, consumer's-words rule. (refs §5.4)

### §6 prints the summary before the before/after blocks

Given a sidecar element `config: phax.json assignments`, indicative, with a summary and a non-null `before`, when phax renders the spec, then §6 shows `### config: phax.json assignments — indicative`, then the `Summary: …` line with the sidecar's sentence, then `before:` and `after:`, in that order. (refs §5.5)

### §6 prints the summary before an `after`-only block

Given a sidecar element `cli: phax validate`, normative, with a summary and `before: null`, when phax renders the spec, then §6 shows the heading, then the `Summary: …` line, then the indented `after` block. (refs §5.5)

### An older spec sidecar blocks approval until migrated

Given a repository with a live spec sidecar stamped `spec-document 0.25.0`, when `phax artifact approve` runs on any spec or plan in it, then it refuses, naming the sidecar, `spec-document 0.25.0` and `phax artifact migrate-documents`, and writes nothing. (refs §5.6)

### migrate-documents lifts a 0.25.0 spec

Given a live Approved spec whose sidecar is stamped `spec-document 0.25.0`, whose body is its own-shape rendering, and which has three surface elements, with an Approved plan bound to it, when `phax artifact migrate-documents` runs, then the sidecar is stamped at the current shape, each element's `summary` is the summary placeholder and every other field is equal to before; §6 shows the placeholder line under each heading with the frontmatter byte for byte unchanged; one commit `chore(artifacts): migrate documents to their current shapes` holds both files; and the report lists the spec as edited since approval and the plan under `stale (spec-changed)`. (refs §5.7, §5.8)

### The report counts the summaries to write

Given the spec of "migrate-documents lifts a 0.25.0 spec", when `phax artifact migrate-documents` reports, then that spec's line reads `3 summaries to write`. (refs §5.9)

### A hand-edited 0.25.0 spec is not lifted

Given a live spec whose sidecar is stamped `spec-document 0.25.0` and whose body was edited by hand after rendering, when `phax artifact migrate-documents` runs, then it refuses with `migrate refused: <path> is not its sidecar's spec-document 0.25.0 rendering — a hand edit would be overwritten`, and no file is written or committed. (refs §5.7)

### Approve refuses a placeholder

Given a migrated spec whose sidecar still holds the summary placeholder on two of its elements, when `phax artifact approve <spec> --by operator` runs, then it exits 12, names both elements by their `surface` value, and writes nothing. (refs §5.10)

### Complete refuses a placeholder

Given an Approved spec whose sidecar still holds the summary placeholder on one element, when `phax artifact complete <spec>` runs, then it refuses, names that element by its `surface` value, and the spec stays under `docs/specs/` unchanged. (refs §5.10)

### Writing the summaries unblocks approval

Given a migrated spec where every placeholder has been replaced by the same sentence in its sidecar and on its §6 `Summary:` line, when `phax artifact approve <spec> --by operator` runs, then the spec is approved and its record file is written. (refs §5.10)

### Archived sidecars stay as they are

Given an archived spec whose sidecar is stamped `spec-document 0.25.0`, beside a live spec sidecar at the same stamp, when `phax artifact migrate-documents` runs, then the archived spec and its sidecar are byte for byte unchanged and absent from the migration commit, and a later `phax artifact approve` is not refused on their account. (refs §5.11)

### The skill teaches the summary

Given the `phax-spec` skill phax ships, when it is read, then its sidecar field table lists `surface` as `[{ surface, summary, binding, before, after }]`, and its Surface section defines `summary` as one sentence in the consumer's words saying what changes, with exactly one good and one bad example. (refs §5.12)

### The Markdown template shows the line

Given the `phax-spec` skill phax ships, when its canonical spec template is read, then its §6 shows a `Summary:` line directly under the element heading, in the form the renderer prints. (refs §5.13)

## 9. Open questions

### q-lift — What does `phax artifact migrate-documents` write for a live sidecar element that has no summary?

- lift-refuse — Refuse every spec sidecar with a non-empty surface, and name re-authoring or a hand edit — abandons: The one-command upgrade. Because the migration is all-or-nothing and approve, reopen and decide refuse repository-wide while any sidecar is older, every approval in the repository stops until all five live specs (101 elements) are fixed. The ways out are expensive. Re-authoring gives the spec a new file name, so `oracle-phases-plan`'s `source-spec` no longer resolves, and it drops Approved status. Demoting a spec by deleting its sidecar loses the summary for good. A hand edit means restamping the sidecar and re-rendering the body, which phax has no command for.
- lift-marker — Lift with a fixed summary placeholder that approve and complete refuse until it is replaced — abandons: The rule that every persisted value of a required field is real content. For a while a sidecar holds a sentinel the schema accepts, and phax has to recognise it. Each live spec then needs its summaries written by hand, the same sentence in the sidecar and on its §6 line, before it can be approved or completed: 34 for the Draft `interactive-phases`, and 22 for `oracle-phases` before both it and its now-stale plan are re-approved.
- lift-copy — Lift by copying the element's `surface` value into its `summary` — abandons: The guarantee that a summary says what changed. All 101 live elements get a "where" line that cannot be told apart from an authored one. These live specs are exactly the ones the release-notes script will read when they complete after this ships, so its first release notes would print the content this change exists to replace.

Recommendation: lift-marker — The cost of the placeholder is bounded and visible: it shows in §6 and in the migration report, and approve and complete refuse it. That means no spec can reach Completed, the only state the release-notes script reads, with a placeholder in it. Refusing instead freezes the whole repository's artifact workflow behind 101 hand edits that phax gives no tool for. Copying the surface name silently fills the release notes with the wrong content. Either way, `oracle-phases` and its plan need re-approving after migration because the body is re-rendered, so the placeholder adds only the writing, which no option can avoid.

### q-hand — Does a hand-authored spec (no sidecar) show the summary line too?

- hand-template — The skill's Markdown template carries the `Summary:` line under each §6 heading, as guidance phax does not check — abandons: A checked contract. The line exists in hand-authored specs only when the author follows the template, so a reader of §6 Markdown cannot rely on it there the way it can in a rendered spec.
- hand-sidecar-only — Only the sidecar format requires `summary`; the template is unchanged — abandons: The same reading for every spec. A hand-authored §6 carries no one-line summary for human readers, and nothing marks where one would go, so hand-authored specs drift further from the rendered layout.

Recommendation: hand-template — A hand-authored §6 is already unchecked as a whole, so an unchecked summary line takes away nothing that phax enforced before. One template line keeps the two kinds of spec reading the same, in the same form the renderer prints.

### q-bound — Does `summary` have a length bound?

- bound-one-line — One line: a non-empty string with no line break, and no character cap — abandons: Any mechanical limit on length. A run-on 300-character sentence decodes, and keeping it short is left to the skill's teaching.
- bound-cap — One line and at most a fixed number of characters (e.g. 160) — abandons: Whole authoring and decide answers. A paid provider session whose output is otherwise valid is refused for a stylistic overrun, against an arbitrary number frozen into a persisted format.
- bound-free — Any non-empty string; the skill describes the one-sentence rule — abandons: The one-line shape that the renderer's single line and a per-element release-notes bullet both depend on. A multi-line summary breaks §6's layout and every consumer that prints one line per element.

Recommendation: bound-one-line — A line break is structural: both §6 and the release notes print one line per element. Length is a matter of style, which the skill teaches and a reviewer catches. Refusing a whole provider answer over a character count costs more than a long sentence does.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- The five operator decisions of 2026-10-21: `summary` is required on every element of every kind, with no optional field for older sidecars; it is one sentence, in the consumer's words, saying what changes; the renderer prints it under each heading before the blocks; archived specs are never touched; the headless authoring prompt and its JSON Schema carry it.
- The spec-document format gets a new stamp, at the release that ships this change. Every live 0.25.0 sidecar becomes an older shape that approve, reopen and decide refuse until `phax artifact migrate-documents` runs.
- The plan document format is unchanged.

Left open:

- The exact text of the summary placeholder, if q-lift's default stands.
- The spelling of the `Summary: ` label in §6, and the key's position in the element.
- Whether `phax artifact status` also reports the number of summaries still to write.
- Whether the run that implements this migrates this repository's own five live sidecars, or leaves that to the operator after merge as `docs/upgrading.md` instructs.

Constraints:

- No back-compat shim: the current shape requires `summary`, and only `phax artifact migrate-documents` lifts an older sidecar. No reader treats a missing `summary` as optional.
- The own-shape check must keep refusing hand-edited bodies. The spec-document 0.25.0 shape and its rendering must be frozen the way 0.17.0 is, and every older shape phax still lifts (0.17.0, pre-schema) must also lift to the new current shape.
- The one-line rule must reach the exported JSON Schema. A `pattern` placed beside a `$ref` is ignored by draft-07 validators (see the comment in `specDocument.ts`).
- A decide session's revised document is decoded against the sidecar schema, so the same `summary` requirement applies to it.
- `docs/upgrading.md` gains an entry for the release that ships this change.

## 11. Docs page

Page: docs/upgrading.md — the section for the release that ships this change

Reader: An operator upgrading phax in a repository that has live headless-authored specs. They need to know what to run, what it leaves them to write, and what stays refused until then.

Example: - **Spec sidecars gain a `summary` on every surface element.** Run `phax artifact migrate-documents` once. It restamps every live spec sidecar, writes a placeholder summary on each element, re-renders §6, and commits; the report counts the summaries left to write per spec. Then write each summary — one sentence, in the consumer's words, in the sidecar and on its §6 `Summary:` line. `phax artifact approve` and `complete` refuse a spec until its placeholders are gone. Archived specs are not touched.
