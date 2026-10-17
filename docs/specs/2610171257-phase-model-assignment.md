---
status: Draft
date: 2026-10-17
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Phase model assignment — an optional planning file that bounds each phase's model and effort

## 1. Context

Today the planner chooses each phase's model and effort from the phax-planning skill alone. The companion spec `planning-skill-defaults`, written at the same time and independent of this one, gives the skill its own default policy: write the phases first, then assign; `claude-sonnet-5-5` at `medium` by default; higher effort or `claude-opus-5-5` for a phase that designs what no code shows yet; `claude-haiku-5-5` for a phase that reproduces a pattern the code holds and a gate checks; a reason for every phase that leaves the default. That policy is the same for every repository.

`phax plans lint`'s models check compares each phase's model and effort with the routing catalog only. Its advisory check sends a registered `planAuditor` the projection `{"phases": [{"id", "files"}]}` and reports what it returns as warnings. Providers plug into phax as commands declared in `phax.json`. `brief` answers, for any paths, with a `$schema`-stamped brief report of rules (each with a guide naming a file to read) and findings. `planAuditor` answers with advisory findings that carry no `$schema`. The routing catalog lists each model's efforts in order and anchors every non-Claude model and effort to a Claude-hub model. phax holds the list price of every Claude catalog model.

An experiment outside phax took one ticket and a two-phase plan, written once by the headless planner, and ran it 24 times with `phax run`, setting every phase's model itself. On the detailed plan, Sonnet 5.5 and Haiku 5.5 executors delivered the ticket and kept the codebase's engineering rules. On the same plan with its detailed instructions removed, Haiku broke a rule in two runs of three without a guarantee gate in its loop, and in none with one.

Ground read:

- `.claude/skills/phax-planning/SKILL.md` — "Choosing a model and effort" picks a phase's model from the skill alone; the generated model catalog lists each model's efforts in order; "Comprehensive instructions" and "Lint before you run" with its five checks (structure, files, commands, models, advisory).
- `docs/briefs/planning-skill-defaults.md` — The companion spec, written at the same time: write phases first, then assign; claude-sonnet-5-5 at medium by default; a reason for every departure; `phax architecture`. It must stand without the planning file.
- `src/app/lintPlan.ts` — The models check calls `modelFindings` against the routing catalog only; the advisory check sends a registered `planAuditor` the projection from `makePlanAuditRequest` and turns its answer into warnings.
- `src/app/loadRouting.ts` — The routing catalog is built in or read from `~/.phax/model-routing.json`, as is the provider config.
- `src/domain/routing/prices.ts` — phax already holds the API list price of every Claude catalog model (input, output, cache), keyed by Claude catalog id; a model added in providers.json has no price.
- `src/domain/routing/defaults.ts` — Every non-Claude model is anchored, per effort, to a Claude-hub model and effort (e.g. gpt-6-sol at medium → claude-sonnet-5-5 at medium).
- `src/schemas/phaxConfig.ts` — `brief` and `planAuditor` are provider seats declared as a command split on whitespace with no shell; `authoring.plan` sets the planner's own model.
- `src/cli/commands/validate.ts` — `phax validate` checks phax.json (and optionally a plan), prints `✓ config is valid (project: …)`, and returns 2 on refusal with a `… validation failed:` line and an `at:` line. It loads no routing catalog today.
- `src/schemas/planDocument.ts` — The headless plan document: every key required, unknown keys refused; a phase carries `model` and `effort` among its extracted fields.
- `src/domain/authoring/renderPlan.ts` — Renders `**Recommended model:**` / `**Recommended effort:**` under each phase heading.
- `src/domain/plan/parsePlanMarkdown.ts` — The deterministic parser that lint and extraction share.
- `src/app/authorArtifact.ts` — Headless authoring writes brief.md and prompt.md into a recorded folder, then spawns the planner with the `authoring.plan` model.
- `src/schemas/schemaUrl.ts` — Every phax format has a format id and a `$schema` URL `https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json`; new formats are born stamped and snapshotted in `packages/schemas/`.
- `NEXT_STEPS.md` — The plan auditor's answer still carries no `$schema` (its own spec, pending); "the brief at plan authoring (the same verb, an earlier moment)" is still unspecced; inside a phase worktree only `phax brief` and read-only commands run.

## 2. Problem

Which phase deserves which model is a judgment no metric settles. Every rule a codebase checks has a part a program verifies and a part left to judgment, so neither phax nor a guarantee provider can rank phases by difficulty. Today that judgment has no owner and no record. A person who knows that one corner of their code needs Opus and another is safe with Haiku has nowhere to write it down. No planner reads it, and `phax plans lint` cannot tell a plan that respects it from one that ignores it. A guarantee provider knows the code's scopes and concepts, but has no place to hand that map to the person who should make the call. And a reader of a plan cannot see why a phase got its model.

## 3. Product goal

A repository may carry one planning file, in a format phax owns. In it, the person responsible for the repository writes down once, for each group of files, the model and effort range a phase touching those files gets. A provider can produce the file's skeleton in its own vocabulary: names, descriptions and globs, never a model. When the file exists, the planner applies it. Each phase shows which entries governed it and why its effort sits where it does, and lint flags any phase that leaves those bounds without a stated derogation. When the file does not exist, nothing changes.

> The repository's owner decides which code deserves which model; phax applies that decision, checks plans against it, and never decides, guesses or rewrites a model.

## 4. Terminology

- **Planning file** — `phax.planning.json` at the repository root, beside `phax.json` and separate from it. It is optional. It is a `$schema`-stamped phax format holding a `default` and a list of planning entries.
- **Planning entry** — One item of the planning file. `id` is stable and is the key every merge uses. `source` is a provider's name, or null for an entry written by hand. `name` is free text that phax shows but never interprets. `description` is one sentence. `globs` are the files the entry covers. Then come `model` and an effort range.
- **Effort range** — `{ "min", "max" }`, two efforts the entry's model offers. `min` does not come after `max` in that model's catalog effort order.
- **Filled / unfilled entry** — A filled entry has a `model` and an effort range. An unfilled entry has `"model": null` and `"effort": null`. No other combination exists. Providers produce unfilled entries, and only a person fills them.
- **Default** — The planning file's `default`: either an assignment (a model and an effort range) for every planned file that no entry matches, or null. When it is null, an unmatched file is bound by nothing, and the skill's default policy guides the planner.
- **Assignment** — A model and an effort range, taken from a filled entry or from a non-null default.
- **Planning provider** — A command declared in `phax.json` that prints a planning-entries document. The document's entries carry `id`, `name`, `description` and `globs`, and never a model or an effort.
- **Model order** — How phax ranks two assignments' models to find the most demanding one. It compares API list price, output per MTok first, with input per MTok breaking ties. A non-Claude model ranks as the Claude-hub model its routing equivalence anchors it to at the range's `max`.
- **Governing assignment** — Among the assignments matched by a phase's planned files, the most demanding one. Ranges are never merged.
- **Derogation** — A phase's declared departure from its governing assignment, together with its reason. It turns lint's error into a warning.
- **Planning lines** — The lines under a phase's model and effort lines: `**Planning entries:**`, `**Effort reason:**`, and `**Model derogation:**` when a derogation is declared. A plan carries them only while a planning file exists.

## 5. Functional requirements

### 5.1 The planning file is optional

WHILE the repository has no `phax.planning.json` THE system SHALL check each phase's model and effort against the routing catalog only, require no planning line in any plan, and report nothing about the file's absence.

### 5.2 The planning file is a phax format

The system shall read the planning file from `phax.planning.json` at the repository root as a phax format stamped with its `$schema` and published with its JSON Schema, separate from `phax.json`.

### 5.3 A valid planning file is reported

WHEN `phax validate` runs and a valid planning file exists THE system SHALL report the file valid with its number of entries and of unfilled entries.

### 5.4 A malformed planning file is refused

IF the planning file lacks `$schema`, `default` or `entries`, carries an unknown key, repeats an entry `id`, has an entry with no glob, or has an entry with a model but no effort range (or a range but no model) THEN `phax validate` SHALL refuse it with exit 2, naming the file and the offending entry.

### 5.5 The planning file is checked against the catalog

IF the default or an entry names a model the routing catalog does not list, an effort that model does not offer, a range whose `min` comes after its `max` in that model's effort order, or a model phax cannot place in the model order THEN `phax validate` SHALL refuse the planning file with exit 2, naming the entry `id` (or `default`) and the field.

### 5.6 Sync adds new entries unfilled

WHEN `phax planning sync <provider>` reads an emitted entry whose `id` the planning file lacks THE system SHALL add the entry with `source` set to the provider's name and with `model` and `effort` set to null.

### 5.7 Sync refreshes its own entries but never their models

WHEN `phax planning sync <provider>` reads an emitted entry whose `id` exists with that provider as `source` THE system SHALL replace its `name`, `description` and `globs` and leave its `model` and `effort` unchanged.

### 5.8 Sync keeps entries no longer emitted

WHEN an entry whose `source` is the synced provider is missing from that provider's emission THE system SHALL keep the entry unchanged and report it as no longer emitted.

### 5.9 Sync never touches another source's entry

IF an emitted `id` names an entry whose `source` is null or another provider THEN `phax planning sync` SHALL leave that entry unchanged and report the collision.

### 5.10 A failing provider changes nothing

IF the provider exits non-zero, outruns its time cap, or prints a document that does not decode as a planning-entries document (including one whose entry carries a `model` or `effort`) THEN `phax planning sync` SHALL leave the planning file byte-identical and exit non-zero, naming the provider.

### 5.11 Sync creates a missing planning file

WHEN `phax planning sync` runs and no planning file exists THE system SHALL create one with its `$schema`, a null `default` and the emitted entries, all unfilled.

### 5.12 Every file a phase may write is matched

WHILE a planning file exists THE system SHALL match every file a phase plans to create, edit or optionally edit against every entry's globs, and SHALL give a file that no entry matches the file's `default`, which binds nothing when null.

### 5.13 The most demanding assignment governs

WHEN a phase's files match more than one assignment THE system SHALL take as governing the one whose model ranks highest in the model order, then the one with the highest `max`, then the one with the highest `min`, then the one listed first in the file, with the default after every entry.

### 5.14 Unfilled entries are reported, not guessed

IF a phase's file matches an unfilled entry THEN `phax plans lint` SHALL report a models warning naming the entry by its `name` and naming the phase, and that entry SHALL constrain nothing.

### 5.15 A phase outside its assignment is an error

IF a phase's model differs from its governing assignment's model, or its effort falls outside the governing range, and the phase declares no derogation, THEN `phax plans lint` SHALL report a models error naming the governing entry by its `name`.

### 5.16 A declared derogation is a warning

WHERE a phase declares a model derogation with its reason THE system SHALL report the phase's departure from its governing assignment as a models warning carrying the entry's `name` and the reason, not as an error.

### 5.17 Planning lines are required while the file exists

IF a planning file exists and a phase lacks its `**Planning entries:**` or `**Effort reason:**` line THEN `phax plans lint` SHALL report a models error for that phase naming the missing line.

### 5.18 Stale entry names are flagged

IF the entry names a phase states on its `**Planning entries:**` line differ from the entries phax matches against the current planning file THEN `phax plans lint` SHALL report a models warning listing both.

### 5.19 An invalid planning file in lint

IF the planning file fails validation THEN `phax plans lint` SHALL report one models error naming the file and skip every comparison drawn from the planning file.

### 5.20 The planner sees the planning file

WHEN headless plan authoring starts while a planning file exists THE system SHALL put in the planner's prompt the default and, for every entry, its name, description, globs, and either its model and effort range or that it has no model yet.

### 5.21 An invalid planning file stops authoring

IF the planning file fails validation THEN headless plan authoring SHALL refuse to start, naming the file, before it spawns the planner.

### 5.22 The plan document carries the phase's planning variant

The plan document shall require on every phase a `planning` key that is `{"kind": "none"}` when no planning file exists and `{"kind": "file", "effortReason", "derogation"}` when one does, with `derogation` a reason or null.

### 5.23 A planning variant that disagrees is refused

IF a headless planner returns a phase whose `planning` kind disagrees with whether the planning file exists THEN the system SHALL refuse the plan document, naming the phase.

### 5.24 The plan shows why

WHILE a planning file exists THE system SHALL render under each phase's model and effort lines, in a headless-authored plan, the names of the entries its files matched (each with its model and range, or that it has no model yet), the planner's effort reason, and its derogation when one is declared.

### 5.25 Extraction is unaffected

The system shall neither extract the planning lines into `phax-plan.json` nor require them, and shall extract a plan with or without them on the deterministic path with the same phase keys as before this spec.

### 5.26 phax never rewrites a stated model

The system shall never write, replace or adjust a model or effort that a plan states, nor a planning entry's `model` or `effort`, in lint, sync, validation, rendering, extraction or run.

### 5.27 Nothing waits for a model to be filled

The system shall complete sync, plan authoring, lint and runs while entries are unfilled, reporting those entries and never waiting for a person to fill them.

### 5.28 Provider facts during planning

WHERE `phax.json` declares a `brief` provider THE system SHALL let the headless plan authoring session run `phax brief` on any paths and return the provider's brief report.

## 6. Surface

### file: phax.planning.json — normative

    {
      "$schema": "https://docs.phax.run/schemas/planning/<X.Y.Z>.json",
      "default": { "model": "claude-sonnet-5-5", "effort": { "min": "low", "max": "medium" } },
      "entries": [
        {
          "id": "core-decider",
          "source": "acme-guard",
          "name": "core · decider",
          "description": "Pure functions that decide a command against the current state.",
          "globs": ["src/core/decide/**"],
          "model": "claude-opus-5-5",
          "effort": { "min": "medium", "max": "high" }
        },
        {
          "id": "http-request-contract",
          "source": "acme-guard",
          "name": "http · request contract",
          "description": "Schemas that decode every inbound HTTP request.",
          "globs": ["src/http/requests/**"],
          "model": null,
          "effort": null
        },
        {
          "id": "docs",
          "source": null,
          "name": "docs",
          "description": "User-facing documentation pages.",
          "globs": ["docs/**", "*.md"],
          "model": "claude-haiku-5-5",
          "effort": { "min": "low", "max": "medium" }
        }
      ]
    }

    "default": null is the other variant: unmatched files are bound by nothing.

    Normative: the file name and location; the keys $schema, default, entries, id, source, name, description, globs, model, effort.min, effort.max; every key required; source a provider name or null; model and effort both set or both null; default an assignment or null. Indicative: the format id `planning`.

### file: planning-entries document (a planning provider's stdout) — normative

    {
      "$schema": "https://docs.phax.run/schemas/planning-entries/<X.Y.Z>.json",
      "entries": [
        { "id": "core-decider", "name": "core · decider",
          "description": "Pure functions that decide a command against the current state.",
          "globs": ["src/core/decide/**"] },
        { "id": "http-request-contract", "name": "http · request contract",
          "description": "Schemas that decode every inbound HTTP request.",
          "globs": ["src/http/requests/**"] }
      ]
    }

    Normative: $schema required; exactly the keys id, name, description, globs per entry; any other key (model, effort, source) is refused. Indicative: the format id `planning-entries`.

### config: phax.json planning providers — indicative

before:

    (no key)

after:

    "planning": {
      "providers": {
        "acme-guard": { "command": "acme-guard planning-entries" }
      }
    }

    The provider's key is the `source` its entries receive. The command is split on whitespace with no shell, like `brief` and `planAuditor`.

### cli: phax planning sync — normative

    $ phax planning sync acme-guard
    phax.planning.json ← acme-guard (4 entries emitted)
      + core-refund-decider    core · refund decider     added — model to fill
      ~ http-request-contract  http · request contract   globs updated
      = core-decider           core · decider            unchanged
      ? core-legacy            core · legacy             no longer emitted — kept
      ! docs                   docs                      id belongs to a hand-written entry — not touched
    2 entries have no model yet: core-refund-decider, http-request-contract
    $? = 0

    $ phax planning sync acme-guard
    planning sync refused: provider "acme-guard" exited 3; phax.planning.json unchanged
    $? = 1

    Normative: the invocation `phax planning sync <provider>`; exit 0 while entries are unfilled; non-zero exit with the file unchanged on refusal; sync writes the file and does not commit it. Indicative: the layout and wording, and whether a bare `phax planning sync` syncs every declared provider.

### file: plan.md phase planning lines — normative

before:

    ## phase-02 — Decide refunds {#phase-02-decide-refunds}

    **Recommended model:** claude-opus-5-5
    **Recommended effort:** medium

after:

    ## phase-02 — Decide refunds {#phase-02-decide-refunds}

    **Recommended model:** claude-opus-5-5
    **Recommended effort:** medium
    **Planning entries:** core · decider (claude-opus-5-5, medium–high); docs (claude-haiku-5-5, low–medium)
    **Effort reason:** two deciders of this kind already exist to follow; the floor of core · decider's range suffices.

    With a derogation, one more line:

    **Model derogation:** rename only; no decision logic changes.

    An unfilled match renders as `http · request contract (no model yet)`; files matched by no entry render as `default (…)`, or `no entry` when default is null. Without a planning file the phase is unchanged. Normative: the three line labels, and that the derogation line exists only when declared. Indicative: how each entry's model and range are rendered.

### file: plan document phase (phax artifact schema plan) — normative

before:

    { "id": "phase-02", "model": "claude-opus-5-5", "effort": "medium",
      "planMarkdownAnchor": "#phase-02-decide-refunds",
      "plannedFilesToCreate": ["src/core/decide/refund.ts"], …, "commit": { … } }

after:

    { "id": "phase-02", "model": "claude-opus-5-5", "effort": "medium",
      "planning": {
        "kind": "file",
        "effortReason": "two deciders of this kind already exist to follow; the floor of core · decider's range suffices",
        "derogation": null
      },
      "planMarkdownAnchor": "#phase-02-decide-refunds",
      "plannedFilesToCreate": ["src/core/decide/refund.ts"], …, "commit": { … } }

    Without a planning file: "planning": { "kind": "none" }.

    Normative: the `planning` key, required; its two variants `none` and `file`; `effortReason` a string; `derogation` a string or null. The planner never writes the `**Planning entries:**` line: phax renders it from the planning file. Indicative: the key's position among the phase's keys.

### cli: phax plans lint models findings — indicative

before:

    error    models  phase-02  claude-sonnet-9 / high: not in the catalog (alternatives: claude-sonnet-5-5, …)

after:

    $ phax plans lint docs/plans/2611020930-refunds-plan.md
    error    models  phase-02  claude-sonnet-5-5 / medium: outside planning entry "core · decider" (claude-opus-5-5, medium–high); declare a model derogation with its reason
    warning  models  phase-03  planning entry "http · request contract" has no model yet; it constrains nothing
    warning  models  phase-04  derogation from planning entry "core · decider" (claude-opus-5-5, medium–high): rename only; no decision logic changes
    warning  models  phase-05  planning entries stated: "docs"; matched now: "docs", "core · decider"
    error    models  phase-06  missing **Effort reason:** line
    $? = 1

    Normative in the criteria: each finding's severity, the `models` check, the phase, and the entry's `name` in the message. Indicative: the wording.

### cli: phax validate — normative

before:

    $ phax validate
    ✓ config is valid (project: refunds)
      …
    $? = 0

after:

    $ phax validate
    ✓ config is valid (project: refunds)
      …
    ✓ phax.planning.json is valid (3 entries, 1 without a model)
    $? = 0

    $ phax validate
    ✓ config is valid (project: refunds)
      …
    Planning file validation failed: entry "core-decider": effort.min "high" comes after effort.max "low" for claude-opus-5-5
      at: phax.planning.json
    $? = 2

    Without a planning file the output is unchanged. Normative: exit 2 on refusal, naming the file, the entry id and the field; the valid line's entry counts. Indicative: the wording.

## 7. Non-goals

- The skill's default policy, its architecture guidance and `phax architecture`: the `planning-skill-defaults` spec.
- Requiring the planning file anywhere: no command, check or prompt depends on its existence.
- Escalating a phase's model after a failed gate (a cascade): a later spec.
- Calibrating models or effort ranges from the cost ledger.
- phax proposing, ranking or filling a model for an entry: models come only from a person.
- Enforcing the planning file in `phax run` or its preflight: the run uses the models the plan states, as today, and lint is the only check against the planning file.
- Changing the planner's own model or the `authoring.plan` default.
- Deleting entries on sync, or committing the planning file on sync.
- A new provider seat for planning facts, and versioning the `planAuditor` request and answer (its own pending spec).
- Ordering models by benchmark score or by any ranking phax maintains itself.
- Rewriting existing plans: a plan approved before a planning file appears gets lint findings, which are fixed like any other.

## 8. Acceptance criteria

### Without a planning file nothing changes

Given a repository with no `phax.planning.json` and a plan whose phase states `claude-opus-5-5` / `high` and carries no planning line, when `phax plans lint` runs, `phax validate` runs, and `phax artifact new plan refunds --headless --brief brief.md` starts, then lint reports no models finding for the phase, validate prints no planning-file line and exits 0, and the planner's prompt carries no planning-file section and asks for `"planning": {"kind": "none"}`. (refs §5.1, §5.22)

### A valid planning file validates

Given the §6 `phax.planning.json` example, when `phax validate` runs, then it exits 0 and reports `phax.planning.json` valid with 3 entries and 1 without a model. (refs §5.2, §5.3)

### The planning file is a stamped format

Given a planning file with no `$schema` key, when `phax validate` runs, then it exits 2 naming `phax.planning.json`, and the published JSON Schema for the format id `planning` matches the file's `$schema` URL by format id and release pattern. (refs §5.2, §5.4)

### A malformed planning file is refused

Given a planning file with two entries whose `id` is `core-decider`, or with an entry carrying `"model": "claude-opus-5-5"` and `"effort": null`, when `phax validate` runs, then it exits 2, naming `phax.planning.json` and `core-decider`. (refs §5.4)

### Unknown models and inverted ranges are refused

Given an entry `core-decider` with `"model": "claude-sonnet-9"`, or with `claude-opus-5-5` and `{ "min": "high", "max": "low" }`, when `phax validate` runs, then it exits 2, naming `core-decider` and the field (`model`, or `effort`). (refs §5.5)

### Sync adds new entries to fill

Given `acme-guard` declared under `planning.providers` and emitting `core-refund-decider`, which the planning file lacks, when `phax planning sync acme-guard` runs, then the file gains `core-refund-decider` with `"source": "acme-guard"`, `"model": null` and `"effort": null`, the output lists it as having no model yet, and the command exits 0. (refs §5.6, §5.27)

### Sync never touches a model

Given `core-decider` with source `acme-guard`, `claude-opus-5-5` and medium–high, and `acme-guard` now emitting it with other globs and description, when `phax planning sync acme-guard` runs, then the entry's `globs` and `description` are replaced, and its `model` and `effort` are unchanged. (refs §5.7, §5.26)

### Sync keeps entries no longer emitted

Given `core-legacy` with source `acme-guard`, which `acme-guard` no longer emits, when `phax planning sync acme-guard` runs, then `core-legacy` is still in the file unchanged, and the output reports it as no longer emitted. (refs §5.8)

### Sync leaves hand-written entries alone

Given a hand-written entry `docs` (`"source": null`) and `acme-guard` emitting an entry with id `docs`, when `phax planning sync acme-guard` runs, then the hand-written `docs` entry is unchanged and the output reports the collision. (refs §5.9)

### A failing provider changes nothing

Given `acme-guard` exiting 3, or printing an entry that carries `"model"`, when `phax planning sync acme-guard` runs, then `phax.planning.json` is byte-identical to before, and the command exits non-zero naming `acme-guard`. (refs §5.10)

### Sync creates the planning file

Given a repository with no `phax.planning.json` and `acme-guard` declared, when `phax planning sync acme-guard` runs, then `phax.planning.json` exists with its `$schema`, `"default": null`, and the emitted entries, all unfilled, and no commit was made. (refs §5.11)

### A phase below its entry is an error

Given the §6 planning file and a phase creating `src/core/decide/refund.ts` and editing `README.md`, stated at `claude-sonnet-5-5` / `medium` with both planning lines and no derogation, when `phax plans lint` runs, then it reports a `models` error for the phase naming `core · decider` and exits 1; stated at `claude-opus-5-5` / `medium`, the phase gets no models finding. (refs §5.12, §5.13, §5.15)

### Optional files count

Given the §6 planning file and a phase whose only file under `src/core/decide/**` is in its optional files, stated at `claude-sonnet-5-5` / `medium` with no derogation, when `phax plans lint` runs, then it reports a `models` error naming `core · decider`. (refs §5.12)

### Unmatched files take the default

Given the §6 planning file and a phase editing only `src/app/main.ts`, stated at `claude-sonnet-5-5` / `high`, when `phax plans lint` runs, then it reports a `models` error naming `default` (claude-sonnet-5-5, low–medium); with `"default": null`, the same phase gets no models finding. (refs §5.12, §5.15)

### The higher-priced model governs

Given two filled entries, one at `claude-haiku-5-5` and one at `claude-sonnet-5-5`, both matched by one phase stated at `claude-haiku-5-5` with no derogation, when `phax plans lint` runs, then it reports a `models` error naming the `claude-sonnet-5-5` entry. (refs §5.13)

### Same model, higher range governs

Given two filled entries at `claude-opus-5-5`, one low–medium and one medium–high, both matched by one phase stated at `claude-opus-5-5` / `low`, when `phax plans lint` runs, then it reports a `models` error naming the medium–high entry. (refs §5.13)

### An exact tie goes to the entry listed first

Given entries `alpha` at `claude-sonnet-5-5` low–medium and, listed after it, `beta` at `claude-sonnet-5` low–medium (the same list price), both matched by one phase stated at `claude-sonnet-5` / `low`, when `phax plans lint` runs, then it reports a `models` error naming `alpha`. (refs §5.13)

### A non-Claude model ranks as its Claude anchor

Given an entry at `gpt-6-sol` with range low–medium and an entry at `claude-haiku-5-5` with range low–medium, both matched by one phase stated at `claude-haiku-5-5` / `low`, when `phax plans lint` runs, then it reports a `models` error naming the `gpt-6-sol` entry, which ranks as `claude-sonnet-5-5`. (refs §5.13)

### Unfilled entries warn and constrain nothing

Given a planning file with `"default": null` and a phase whose only matched entry is the unfilled `http · request contract`, stated at `claude-haiku-5-5` / `low`, when `phax plans lint` runs, then it reports a `models` warning naming `http · request contract` and the phase, reports no models error, and exits 0. (refs §5.14, §5.27)

### A derogation turns the error into a warning

Given a phase matching `core · decider`, stated at `claude-sonnet-5-5` / `medium` with `**Model derogation:** rename only; no decision logic changes.`, when `phax plans lint` runs, then it reports a `models` warning carrying `core · decider` and the reason, no models error for the phase, and exits 0. (refs §5.16)

### Missing planning lines fail lint while the file exists

Given the §6 planning file and a plan whose phase-06 has no `**Effort reason:**` line, when `phax plans lint` runs, then it reports a `models` error for phase-06 naming the missing line and exits 1. (refs §5.17)

### Stale entry names warn

Given a phase stating `**Planning entries:** docs (claude-haiku-5-5, low–medium)` whose files now also match `core · decider`, when `phax plans lint` runs, then it reports a `models` warning listing the stated `docs` and the matched `docs`, `core · decider`. (refs §5.18)

### An invalid planning file is one lint error

Given a planning file with an inverted range, when `phax plans lint` runs, then it reports exactly one `models` error naming `phax.planning.json` and no other finding drawn from the planning file. (refs §5.19)

### The prompt carries every entry

Given the §6 planning file, when `phax artifact new plan refunds --headless --brief brief.md` starts, then the prompt carries the default and all three entries' names, descriptions and globs, with `core · decider` at `claude-opus-5-5` medium–high and `http · request contract` marked as having no model yet. (refs §5.20)

### An invalid planning file stops authoring before spawn

Given a planning file naming `claude-sonnet-9`, when `phax artifact new plan refunds --headless --brief brief.md` runs, then it refuses, naming `phax.planning.json`, and no planner session is spawned. (refs §5.21)

### The plan document's planning variant

Given the plan document JSON Schema, when `phax artifact schema plan` prints it, then every phase requires `planning`, whose variants are `{"kind": "none"}` and `{"kind": "file", "effortReason", "derogation"}`, with `derogation` a string or null. (refs §5.22)

### A disagreeing variant is refused

Given the §6 planning file and a headless planner returning phase-02 with `"planning": {"kind": "none"}`, when phax decodes the plan document, then it refuses the document naming phase-02, and no plan file is written. (refs §5.23)

### A rendered phase shows its entries and reasons

Given the §6 planning file and a headless planner returning phase-02 with `effortReason` set and `"derogation": null`, when phax renders the plan, then phase-02 shows `**Planning entries:** core · decider (claude-opus-5-5, medium–high); docs (claude-haiku-5-5, low–medium)` and its `**Effort reason:**` directly after its model and effort lines, and no `**Model derogation:**` line. (refs §5.24)

### Extraction ignores planning lines

Given two Approved plans that differ only by their planning lines, when `phax run` extracts each, then both extract on the deterministic path without a model fallback, and their `phax-plan.json` phases carry the same keys and values. (refs §5.25)

### Stated models survive every step

Given a plan whose phase states `claude-sonnet-5-5` / `low`, outside its governing entry, when `phax plans lint`, `phax validate` and `phax planning sync acme-guard` run and `phax run` extracts the plan, then plan.md still states `claude-sonnet-5-5` / `low`, `phax-plan.json` carries `claude-sonnet-5-5` / `low` for that phase, and every entry's `model` and `effort` are unchanged. (refs §5.26)

### The planner can read the brief

Given `phax.json` declaring a `brief` provider, when the headless plan authoring session runs `phax brief src/core/decide/refund.ts`, then the command is allowed and returns the provider's brief report for that path. (refs §5.28)

## 9. Open questions for implementation planning

### Q1 — How does phax rank models to find the most demanding assignment?

- By API list price (output per MTok, then input); a non-Claude model ranks as its Claude-hub anchor at the range's max — abandons: A generation-aware order: an older, pricier model (`claude-opus-4-8`, $25 output) outranks the newer `claude-opus-5-5` ($20), and a model with no price and no Claude anchor cannot be placed, so an entry naming it is refused.
- By family tier (haiku < sonnet < opus < fable), then by price within a family — abandons: A single factual source: phax states and maintains its own ladder of families, a judgment about the models, and non-Claude families still need anchoring.
- The planning file lists its own model ladder, lowest to highest — abandons: The catalog as the one order: each repository maintains a ladder beside its entries, and a catalog model missing from it is unusable there.

Recommendation: By API list price (output per MTok, then input); a non-Claude model ranks as its Claude-hub anchor at the range's max — Price is a fact phax already holds for every Claude catalog model, and the routing equivalence already places every other model next to a Claude one. Reading "most demanding" as "most costly to run" adds no judgment of phax's own, which fits the guiding rule. The ordering only decides between entries that conflict on the same phase. Each entry's assignment stays the person's, and a person mixing generations sees the governing entry named in every finding.

### Q2 — Where does `phax planning sync` get a provider's entries?

- A provider command declared in `phax.json` (`planning.providers`), like `brief` and `planAuditor` — abandons: Zero configuration: a provider must be declared before it can be synced, and phax takes on its spawn (time cap, failure handling).
- A file or stdin: `acme-guard planning-entries | phax planning sync --source acme-guard -` — abandons: A trusted `source`: the caller asserts whose entries these are, so one mistyped pipe rewrites another provider's entries under the wrong name.

Recommendation: A provider command declared in `phax.json` (`planning.providers`), like `brief` and `planAuditor` — `source` is what stops a merge from touching anyone else's entries, so it must come from configuration, not from the caller. Every other provider seam in phax is a declared command. The entries document stays a format of its own, so a provider can produce it without knowing `phax.json`.

### Q3 — Within an entry's range, through which seam does the planner ask the provider for facts about a phase's files (for example, whether the code already holds instances of what the phase will write, or whether it is the first of its kind)?

- `phax brief <paths>` and its brief report — abandons: A dedicated channel for facts: "first of its kind" has to be read from rules and their guides (a rule whose guide names an existing file shows an instance to follow), in a shape built for obligations rather than observations.
- Extend the `planAuditor` seam (`{phases:[{id, files}]}` → advisory findings) — abandons: Timing: the auditor answers at lint, after the plan is written, so its facts arrive after the assignment. Its request and answer are not yet versioned either.
- A new provider seat with its own request and answer formats — abandons: Economy: a third provider contract to version and implement before `phax brief` has been shown to be insufficient.

Recommendation: `phax brief <paths>` and its brief report — The brief already answers for any paths at the moment the planner needs it. It is versioned and carries no model name or score, so a provider stays one that knows no model. NEXT_STEPS already names the brief at plan authoring as the missing moment of the same verb. This spec adds no seat, and one can follow if the brief proves too indirect.

### Q4 — While a planning file exists, is a phase missing its `**Planning entries:**` or `**Effort reason:**` line a lint error or a warning?

- A models error — abandons: A smooth adoption: every plan drafted before the planning file appeared, or written by hand without the lines, fails lint until each phase gains them.
- A models warning — abandons: The guarantee that the plan shows why: a reader can meet a phase with no stated reason and lint still passes.

Recommendation: A models error — The file is optional. A repository that writes one has asked for plans that show why each phase got its model, and an unstated reason is exactly the judgment going unrecorded. Adding two lines fixes the finding, and headless authoring renders both lines itself.

## 10. Implementation-planning note

Settled:

- The planning file is optional. With no file, phax behaves exactly as without this spec: no prompt section, no planning lines, a catalog-only models check, and `{"kind": "none"}` in the plan document.
- `source` and `default` are required and nullable: `source` is null for a hand-written entry, and `default` is null when the skill's default policy governs unmatched files. Sync seeds `default` as null and never picks a model.
- An entry is either filled (a model and a range) or unfilled (both null). A half-filled entry is refused.
- Matching covers the create, edit and optional lists. An unmatched file takes `default`. An unfilled entry constrains nothing and is reported.
- The governing assignment is the highest in the model order (list price, output then input; non-Claude models via their Claude-hub anchor at `max`), then the highest `max`, then the highest `min`, then the entry listed first, with the default last. Ranges are never merged. Effort order is each model's catalog effort list order.
- In a headless plan, phax renders `**Planning entries:**` from the planning file. The planner supplies only `effortReason` and `derogation`.
- Planning lines are checked by lint's models check, not by its structure check, and they are not extracted. `phax-plan.json` and runs are unchanged.
- Sync writes the planning file and never commits it. The person fills in the models and commits.
- `phax validate` validates the planning file alongside `phax.json` when it exists, with exit 2 on refusal. This means validate now loads the routing catalog.
- Resolved recommendations: Q `q-order` price, Q `q-source` declared provider command, Q `q-facts` `phax brief`, Q `q-lines` error.

Left open:

- The format ids (`planning`, `planning-entries`) and the release that first stamps them.
- The glob dialect. No glob matcher is among phax's dependencies today: choose one, or Node's built-in path glob matching, and document it in the format's JSON Schema descriptions.
- Whether the headless plan authoring session's command allowance already admits `phax brief`, or needs it added.
- Sync's time cap, and whether a bare `phax planning sync` syncs every declared provider in name order.
- The exact wording of the lint findings, the sync output and the validate lines.
- How `planning-skill-defaults` records a phase's reason for leaving the skill's default. If it adds a reason to the plan document phase, `planning.effortReason` should reuse it rather than add a second reason field. Whichever spec ships second reconciles the two.

Constraints:

- No back-compat shims in persisted schemas: every new key is required, and `source`, `default`, `model`, `effort` and `derogation` use explicit null variants. The plan document's `planning` key is required on every phase.
- Explicit per-variant enums: filled and unfilled entries are two variants, and so are `planning.kind` `none` and `file`. Efforts are checked per model against the catalog.
- Respect the layers: reading the planning file and spawning the provider go through ports; matching, ordering, choosing the governing assignment and the merge are pure domain; the planning file and the entries document are decoded through schemas at the boundary.
- This spec must not depend on `planning-skill-defaults`, and that spec must not depend on this one: either can ship first.
- phax stays autonomous: unfilled entries and provider failures are reported, and nothing waits on a person.
- phax never chooses or rewrites a model silently: only the planner and the person write a model or an effort.
- Both new formats are stamped and snapshotted in `packages/schemas` like every phax format, and their JSON Schemas are published.
- Fixtures and examples are made up (`acme-guard`, `src/core/decide/**`, `refunds`).
- Tests hold across a release cut: assert `$schema` by format id and the release pattern, never by the running version.

## 11. Docs page

Page: Bounding phase models — phax.planning.json

Reader: The person responsible for a repository who wants phax plans to spend strong models only where their code needs them, and wants lint to hold planners to that choice.

Example: A planning file with one filled provider entry, one unfilled provider entry, one hand-written entry and a default. `phax planning sync acme-guard` then adds an entry to fill. A plan phase shows its matched entries and its effort reason. `phax plans lint` raises an error for a phase outside its entry, and a derogation turns that error into a warning.
