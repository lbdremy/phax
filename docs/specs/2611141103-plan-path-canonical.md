---
status: Draft
date: 2026-11-14
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Plan paths in one canonical form

## 1. Context

A plan phase names its files in three lists: `plannedFilesToCreate`, `plannedFilesToEdit` and `optionalFilesToEdit`. They reach phax by three routes. The first is the deterministic reading of a plan.md's `### Planned files to create`, `### Planned files to edit` and `### Optional files that may be edited` sections. The second is the extraction model's answer, used when that reading fails. The third is the plan document, which is both a headless planner's answer and a plan's JSON sidecar. All three end in the persisted `phax-plan.json`. Every route decodes the lists as plain strings (`Schema.Array(Schema.String)`), so `./src/widget.ts`, `src//widget.ts` and `src/a/../widget.ts` decode as written, and none of them equals the `src/widget.ts` that git reports.

Several readers compare those strings as written: reconciliation (planned paths against the run's diff), plan lint (create/edit collision, "already created by", the working-tree probe), assignment bounds (globs over the three lists), `phax plans overlap` (plan footprints), and plan staleness (the footprint against git's changes since approval). Only the skill-edit grant normalizes, with its own private helper.

Pull request #205 normalized inside the overlap footprints only. It was declined: every other reader would still compare raw strings and disagree with the overlap report. On 2026-11-13 the operator gave the direction: one schema for a plan path, shared by the three lists on every route; canonical means repository-relative, `/` separators, no `.`, empty or `..` segment, and no leading or trailing `/`; and readers do no normalizing of their own.

Ground read:

- `src/schemas/phaxPlan.ts` — ExtractedPhaseFields: the three file lists are bare Schema.Array(Schema.String), shared by the extracted plan, the persisted phax-plan.json and (through answerPhaseFields) the extraction answer.
- `src/schemas/planDocument.ts` — PlanDocumentPhaseSchema reuses ExtractedPhaseFields' file lists; a headless planner's answer and a plan's JSON sidecar decode through it.
- `src/schemas/planExtraction.ts` — PlanExtractionAnswerSchema: the extraction model's answer, phases built from answerPhaseFields.
- `src/domain/plan/parsePlanMarkdown.ts` — The deterministic plan.md reader: list items taken as written, the candidate decoded through ExtractedPhaxPlanSchema; a structure error makes the caller fall back to the extraction model.
- `src/domain/reconciliation/reconcile.ts` — Planned paths matched against the run's diff by string equality.
- `src/domain/plan/lint.ts` — filePlanFindings and plannedPaths: create/edit collision, already-created and working-tree probe, all on the string as written.
- `src/domain/plan/assignmentCheck.ts` — Assignment bounds govern a phase through matchesAnyGlob over its three lists.
- `src/domain/security/skillEditGrants.ts` — Its own normaliseRepoRelative: today the one reader that normalizes, silently skipping absolute and `..` paths.
- `src/domain/planOverlap/fromPhaxPlan.ts` — planInputFromPhaxPlan feeds the overlap footprints straight from the plan's lists.
- `src/app/planStaleness.ts` — The plan's footprint (buildFootprint) is compared with what git says changed since approval.
- `src/domain/decide/verdicts.ts` — posix.normalize already used in the domain to tell a path that leaves the repository.
- `src/schemas/persisted.ts` — readPhaxPlanFile: a phax-plan.json stamped below the current stamp is read by a frozen decoder, displayed, never handed to a run; older plan sidecars are lifted, and a lift can be refused.
- `src/domain/artifact/documentMigration.ts` — migrate-documents refuses a plan whose lift is refused, naming the phase and the departing value.
- `src/schemas/release.ts` — Current stamps: phax-plan, plan-document and phax-plan-extraction at 0.33.0; PHAX_RELEASE 0.38.0, not yet cut.

## 2. Problem

The same file can be written several ways, and phax treats each spelling as a different file. A phase that plans `./src/x.ts` and changes `src/x.ts` gets two deviations: one missing file and one unplanned file. Two plans that edit the same file under two spellings are reported as clean by `phax plans overlap`. Lint does not see a create/edit collision. The model-assignment bound for `src/**` does not apply to the phase. Staleness misses a change to a file the plan touches. A path that leaves the repository (`../x.ts`) or is absolute (`/src/x.ts`) decodes without complaint and simply never matches anything. Fixing this in one reader, as #205 did, makes the readers disagree with each other. Any reader added later would also have to remember to normalize.

## 3. Product goal

Every plan path reaches phax's readers in one canonical, repository-relative form. phax decides that form once, when it decodes the plan, so every check compares the same strings that git reports. A path with no canonical form is refused at that point, with a message naming the phase and the path. Plans whose paths are already canonical behave exactly as before.

> A plan path is made canonical, or refused, where the plan is decoded, and nowhere else.

## 4. Terminology

- **plan path** — One entry of a phase's `plannedFilesToCreate`, `plannedFilesToEdit` or `optionalFilesToEdit`. It names a file.
- **written path** — A plan path exactly as it appears in its source: a plan.md list item (backticks unwrapped, as today), an extraction answer, or a plan document.
- **canonical path** — A non-empty path relative to the repository root, using `/` as the separator. It has no empty segment, no `.` segment and no `..` segment, and no leading or trailing `/`. Example: `src/widget.ts`.
- **canonical form (of a written path)** — The path obtained by dropping empty and `.` segments and resolving each `..` against the segment before it. `./src/x.ts`, `src//x.ts` and `src/a/../x.ts` all have the canonical form `src/x.ts`.
- **unplannable path** — A written path that has no canonical form. This covers five cases: it is empty, or its canonical form is empty (`.`, `./`, `a/..`); it starts with `/` (absolute); its `..` segments climb above the repository root (it leaves the repository); it ends with `/` (it names a directory); or it contains `\` (a backslash, which phax will not read as a separator).
- **reader** — A check that compares plan paths: reconciliation, plan lint's file checks, assignment bounds, `phax plans overlap`, plan staleness and the skill-edit grant.

## 5. Functional requirements

### 5.1 Only canonical paths are held

The system shall hold only canonical paths in every phase file list it decodes, persists to `phax-plan.json` or a plan document, or hands to a reader.

### 5.2 Unplannable paths are refused

IF a written path is unplannable THEN the system SHALL refuse the plan with a message naming the phase, the list, the written path and why it is unplannable.

### 5.3 No model fallback for an unplannable path

IF the deterministic reading of a plan.md meets an unplannable path THEN the system SHALL refuse the plan with that path's refusal, without falling back to the extraction model.

### 5.4 Reading a plan.md rewrites to canonical form

WHEN phax reads a plan from a plan.md, deterministically or through the extraction model's answer, and a written path is plannable but not canonical, THE system SHALL replace it with its canonical form.

### 5.5 The plan document refuses a non-canonical path

IF a plan document (a headless planner's answer or a plan's JSON sidecar) holds a plannable path that is not canonical THEN the system SHALL refuse it with a message naming the phase, the list, the written path and its canonical form.

### 5.6 Readers treat spellings of one file alike

The system shall report the same reconciliation, lint, assignment-bound, overlap and staleness results for a plan whose plan.md writes a path in a non-canonical form as for the same plan written with that path's canonical form.

### 5.7 Canonical plans are unchanged

The system shall give a plan whose paths are all canonical the same behaviour and the same output as before this change, apart from the `$schema` stamps of the documents it writes.

### 5.8 An earlier-shape phax-plan.json is never run

IF a run is resumed from a `phax-plan.json` stamped at a shape before this change THEN the system SHALL refuse it as it refuses any earlier-shape phax-plan, while still reading it for display with its paths as written.

### 5.9 An earlier-shape sidecar with a non-canonical path is not migrated

IF `phax artifact migrate-documents` meets a plan sidecar stamped at an earlier shape that holds a plan path that is not canonical THEN the system SHALL refuse to migrate that plan, naming the phase, the list and the path, and leave its files unchanged.

### 5.10 The published schemas state the rule

The system shall describe the canonical-path rule on each of the three file lists in the published plan-document and phax-plan JSON Schemas.

## 6. Surface

### file: docs/plans/<stamp>-<slug>-plan.json (plan document) — normative

Summary: A plan document, whether a headless planner's answer or a sidecar, is refused when a file list holds a path that is not canonical, and the refusal names the spelling to write instead.

before:

    {
      "$schema": "https://docs.phax.run/schemas/plan-document/0.33.0.json",
      "phases": [{ "id": "phase-02",
        "plannedFilesToEdit": ["./src/x.ts", "../shared/y.ts"], … }]
    }
    # accepted as written

after:

    {
      "$schema": "https://docs.phax.run/schemas/plan-document/0.38.0.json",
      "phases": [{ "id": "phase-02",
        "plannedFilesToEdit": ["./src/x.ts", "../shared/y.ts"], … }]
    }
    # refused at the first violation:
    phases[1].plannedFilesToEdit[0]: phase-02 plans "./src/x.ts", which is not canonical: write "src/x.ts"
    # with plannedFilesToEdit ["src/x.ts", "../shared/y.ts"]:
    phases[1].plannedFilesToEdit[1]: phase-02 plans "../shared/y.ts", which leaves the repository

### cli: phax plans lint — indicative

Summary: Lint reads `./src/x.ts` in a plan.md as `src/x.ts`, names files by that spelling in its findings, and reports an unplannable path as an error on its phase.

before:

    $ phax plans lint docs/plans/2611140900-widget-plan.md
    # phase-01 create: ./src/x.ts   edit: src/x.ts   → no finding

after:

    $ phax plans lint docs/plans/2611140900-widget-plan.md
    ✗ phase-01 files: create and edit both list src/x.ts

    # a plan.md listing `../shared/y.ts` under Planned files to edit:
    ✗ phase-02: Planned files to edit: "../shared/y.ts" leaves the repository
    $? = 1

### cli: phax plans overlap — indicative

Summary: Two plans that write the same file under two spellings are reported as overlapping on that file's canonical path.

before:

    $ phax plans overlap plan-a.md plan-b.md
    no shared files

after:

    $ phax plans overlap plan-a.md plan-b.md
    shared: src/x.ts  (plan-a edit, plan-b edit)

### cli: phax run (phase reconciliation) — indicative

Summary: A phase that plans `./src/x.ts` and changes `src/x.ts` is reconciled as having edited a planned file, with no missing or unplanned entry.

before:

    Missing planned edits:
      ./src/x.ts
    Unplanned edits:
      src/x.ts

after:

    Edited as planned:
      src/x.ts

### cli: phax artifact migrate-documents — indicative

Summary: An older plan sidecar holding a path that is not canonical is refused by name, so the operator can fix the path and re-approve.

    $ phax artifact migrate-documents
    ✗ docs/plans/2610020800-widget-plan.md phase-02 plannedFilesToEdit "./src/x.ts" is not canonical: write "src/x.ts"
      edit the path in the plan, then re-approve it

### file: .phax/runs/<run>/phax-plan.json — normative

Summary: A run's phax-plan.json holds only canonical paths and is stamped with the release that introduced the rule.

before:

    { "$schema": "https://docs.phax.run/schemas/phax-plan/0.33.0.json",
      "phases": [{ "plannedFilesToEdit": ["./src/x.ts"], … }] }

after:

    { "$schema": "https://docs.phax.run/schemas/phax-plan/0.38.0.json",
      "phases": [{ "plannedFilesToEdit": ["src/x.ts"], … }] }

### internal: PlanPath schema — indicative

Summary: phax code decodes every plan file list through one plan-path schema, so a reader can rely on canonical strings and never normalizes them itself.

before:

    plannedFilesToCreate: Schema.Array(Schema.String)
    plannedFilesToEdit:   Schema.Array(Schema.String)
    optionalFilesToEdit:  Schema.Array(Schema.String)

after:

    plannedFilesToCreate: Schema.Array(PlanPath)   // on ExtractedPhaseFields, src/schemas/planPath.ts
    plannedFilesToEdit:   Schema.Array(PlanPath)
    optionalFilesToEdit:  Schema.Array(PlanPath)
    // the extraction answer and the plan.md reading decode through a
    // rewriting variant that yields a PlanPath

## 7. Non-goals

- Symbolic links: a path through a symlinked directory is not resolved to its target.
- Case-only differences (`Src/x.ts` vs `src/x.ts`) and Unicode normalization of file names.
- Globs in plans: the file lists name files, and a glob character is not given any meaning.
- Normalizing paths that come from git, which are canonical already.
- A lint finding that a plan.md writes a non-canonical spelling which phax rewrote.
- Planning a file whose name contains a backslash.
- Lifting an earlier-shape phax-plan.json so an in-flight run can continue across the upgrade.

## 8. Acceptance criteria

### Reconciliation matches a non-canonical planned path

Given a plan.md whose phase-01 lists `./src/x.ts` under Planned files to edit, and a phase session that modifies `src/x.ts` and nothing else, when `phax run` reconciles phase-01, then `src/x.ts` is reported as edited as planned, with no missing planned edit, no unplanned edit and no deviation. The report is identical to the one for the same plan written with `src/x.ts`. (refs §5.4, §5.6)

### Lint sees a create/edit collision across spellings

Given a plan.md whose phase-01 lists `./src/x.ts` under Planned files to create and `src/x.ts` under Planned files to edit, when `phax plans lint` runs on it, then it reports the error `create and edit both list src/x.ts` on phase-01. (refs §5.6)

### Lint sees a file already created under another spelling

Given a plan.md where phase-01 creates `src//x.ts` and phase-02 creates `src/x.ts`, and `src/x.ts` is absent from the working tree, when `phax plans lint` runs on it, then it reports `create src/x.ts: already created by phase-01` on phase-02. (refs §5.6)

### Lint's working-tree probe finds a non-canonical path

Given a working tree holding `src/x.ts` and a plan.md whose phase-01 lists `./src/x.ts` under Planned files to edit, when `phax plans lint` runs on it, then it reports no `does not exist` error for that path. (refs §5.6)

### Assignment bounds govern a non-canonical path

Given an assignment bound governing `src/**` and a plan.md whose phase-01 lists only `./src/x.ts` and has a model outside the bound with no assignment reason, when `phax plans lint` runs on it, then it reports the `outside` error naming that bound on phase-01, as it does for the same plan written with `src/x.ts`. (refs §5.6)

### Overlap sees one file under two spellings

Given plan A whose plan.md edits `./src/x.ts` and plan B whose plan.md edits `src/x.ts`, when `phax plans overlap` runs on both, then it reports both plans as sharing `src/x.ts`. (refs §5.6)

### Staleness sees a change to a non-canonical planned file

Given an approved plan whose plan.md edits `./src/x.ts`, and a commit since its approval that changes `src/x.ts`, when `phax plans status` reports on the plan, then its staleness verdict is the one it gives the same plan written with `src/x.ts`. (refs §5.6)

### phax-plan.json holds the canonical form

Given a plan.md listing `./src/x.ts`, `src//y.ts` and `src/a/../z.ts`, read both deterministically and through an extraction answer that writes those spellings, when a run starts from it, then the run's `phax-plan.json` lists `src/x.ts`, `src/y.ts` and `src/z.ts` and is stamped `https://docs.phax.run/schemas/phax-plan/0.38.0.json`. (refs §5.1, §5.4)

### Each kind of unplannable path is refused

Given for each of `""`, `./`, `/src/x.ts`, `../x.ts`, `src/../../x.ts`, `src/` and `src\x.ts`, a plan document whose phase-02 lists it under plannedFilesToEdit, and a plan.md whose phase-02 lists it under Planned files to edit, when the plan document is decoded, and `phax plans lint` runs on the plan.md, then each is refused with a message naming phase-02, the list, the written path and its reason (empty, absolute, leaves the repository, names a directory, or backslash). (refs §5.2)

### An unplannable path in plan.md never reaches the model

Given a plan.md otherwise well formed whose phase-02 lists `../x.ts`, with a stub extraction backend that records calls, when `phax plans lint` runs on it, then the plan is refused naming phase-02 and `../x.ts`, and the backend records no call. (refs §5.3)

### A plan document with a non-canonical path is refused

Given a headless planner answer whose phase-02 lists `./src/x.ts` under plannedFilesToEdit, when phax decodes the answer, then it is refused with `phases[1].plannedFilesToEdit[0]` naming phase-02, `./src/x.ts` and the canonical form `src/x.ts`, and no plan file is written. (refs §5.5, §5.1)

### A canonical plan is unchanged

Given the repository's existing canonical plans and the hello-world example plan, when `phax plans lint`, `phax plans overlap` and `phax plans status` run on them before and after the change, then their outputs are byte-identical. (refs §5.7)

### An earlier-shape phax-plan.json is displayed, never run

Given a `phax-plan.json` stamped `https://docs.phax.run/schemas/phax-plan/0.33.0.json` listing `./src/x.ts`, when phax displays its run, and then a resume of that run is attempted, then the display shows `./src/x.ts` as written, and the resume is refused as for any earlier-shape plan. (refs §5.8)

### An earlier-shape sidecar with a non-canonical path is not migrated

Given a plan sidecar stamped `https://docs.phax.run/schemas/plan-document/0.33.0.json` whose phase-02 lists `./src/x.ts`, when `phax artifact migrate-documents` runs, then that plan is refused, with a message naming phase-02, plannedFilesToEdit and `./src/x.ts`, and its .md and .json are unchanged. (refs §5.9)

### The published schema states the rule

Given the change is built, when `phax artifact schema plan` runs, then each of the three file lists' items carries the canonical-path rule in its JSON Schema. (refs §5.10)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-rewrite — A path that is not canonical but has a canonical form (`./src/x.ts`, `src//x.ts`, `src/a/../x.ts`): should the decode rewrite it or refuse it, and on which route?

- rewrite-reading — Rewrite when phax reads a plan.md (the deterministic reading and the extraction answer); refuse in the plan document — abandons: Exact correspondence between a hand-written plan.md and phax-plan.json: the plan.md keeps `./src/x.ts` while every report says `src/x.ts`.
- refuse-everywhere — Refuse on every route — abandons: Tolerance of harmless variation: a model's or an author's `./` fails extraction, and the operator must edit a plan.md and re-approve it over a cosmetic spelling.
- rewrite-everywhere — Rewrite on every route, the plan document included — abandons: The plan document as written and approved: phax would hold different paths from the sidecar's bytes, and any rewrite of the sidecar (decide, migrate) would silently change approved content.

Recommendation: rewrite-reading — phax-plan.json is a projection of a plan.md and never a byte-for-byte copy, so rewriting while reading a plan.md loses nothing that was approved. It also keeps a model's harmless `./` from failing an extraction. The plan document is the artifact itself, written by a planner and approved by an operator, so it should hold exactly what phax reads; a refusal that names the canonical spelling costs the planner one retry.

Decision: rewrite-reading — by operator (Rémy Loubradou), 2026-11-14
Why: phax-plan.json is a projection of a plan.md and never a byte-for-byte copy, so rewriting while reading a plan.md loses nothing that was approved. It also keeps a model's harmless `./` from failing an extraction. The plan document is the artifact itself, written by a planner and approved by an operator, so it should hold exactly what phax reads; a refusal that names the canonical spelling costs the planner one retry. Advocate: The strongest case for refuse-everywhere: one rule on every route is simpler to state and to test, a plan.md and the phax-plan.json derived from it then agree byte for byte, and a cosmetic `./` is cheap for an author to fix once, where a silent rewrite hides that the written plan departs from what phax reads. Principles: S1, S3. Reversibility: cheap. Revised: none.

## 10. Implementation-planning note

Settled:

- One plan-path schema is used by all three file lists on every route: plan.md reading, extraction answer, plan document, phax-plan.json and the extracted-plan cache.
- The meanings of canonical and unplannable are as defined in §4. Unplannable paths are refused on every route.
- Readers are not changed to normalize. The skill-edit grant's private normalizer becomes redundant and may be removed, provided its output is unchanged.
- The phax-plan, plan-document and phax-plan-extraction formats each move to the stamp of the next release cut (currently 0.38.0), each with a frozen 0.33.0 decoder, following the existing persisted.ts pattern.
- No back-compat shim: an earlier-shape sidecar holding a path that is not canonical is a refused lift, not rewritten.

Left open:

- If q-rewrite is decided as refuse-everywhere, the per-reader criteria are restated with the plan written as `src/x.ts`, and ac-unplannable is extended to cover non-canonical spellings. If it is decided as rewrite-everywhere, ac-document-refuses is dropped.
- The exact refusal wording. The content is normative: the phase, the list (its field name in JSON and its section title in plan.md), the written path, the reason, and the canonical form where one exists.
- How the extracted-plan cache drops entries written before the change, for example by bumping the extractor version.

Constraints:

- Changes are additive for canonical plans: no change in output apart from `$schema` stamps.
- The canonical-path rule is pure domain logic with no filesystem access. It never consults the working tree to decide a path's form.
- The extraction answer's JSON Schema, which the model is shown, must still admit a plannable non-canonical path if q-rewrite is decided as rewrite-reading, so that the model's `./` is rewritten rather than refused.
- The two tests from pull request #205 (overlap across spellings) should pass unchanged against the decoded plan, not against a normalizing footprint.

## 11. Docs page

None — There is no user docs page for plan file lists. The rule appears in the published plan-document schema (`phax artifact schema plan`) and in refusal messages; the planner may add one line to the phax-planning skill.

## 12. Decision log

- 2026-11-14 q-rewrite decided rewrite-reading — operator (Rémy Loubradou)
