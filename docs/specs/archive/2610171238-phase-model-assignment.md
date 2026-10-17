---
status: Abandoned
date: 2026-10-17
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Phase model assignment — phases written first, then assigned from a planning file the repository owns

## 1. Context

Today the planner picks a phase's model before it writes the phase. The phax-planning skill's "Choosing a model and effort" opens with "The default phase model is `claude-opus-5-5`: it is the cheapest Opus-tier entry and matches or beats `claude-fable-5-1` from `medium` effort up". It keeps `claude-sonnet-5-5` for mechanical phases and asks for "the lowest effort that succeeds". Its Planning constraints add: "Comprehensive instructions. Make sure each phase has enough detail for the model and effort you picked to execute it successfully."

The headless plan document lists `model` and `effort` first among a phase's keys. phax renders them as the `**Recommended model:**` / `**Recommended effort:**` lines. `phax plans lint`'s models check compares each phase's model and effort with the routing catalog only: the built-in catalog, or `~/.phax/model-routing.json`. Its advisory check sends a registered `planAuditor` the projection `{"phases": [{"id", "files"}]}` and reports the findings it returns as warnings. The planner's own model comes from `authoring.plan` in `phax.json` (default `claude-opus-5-5` at `high`).

Providers plug into phax as commands declared in `phax.json`. `brief` answers, for any paths, with a `$schema`-stamped brief report of rules (each with a guide naming a file to read) and findings. `planAuditor` gives advisory findings. Two approved specs bear on models: `cost-ledger` records the models and API-list cost of every invocation, and `plan-estimate` gives each Claude catalog entry its list prices.

An experiment outside phax took one ticket and a two-phase plan, written once by the headless planner, and ran it 24 times with `phax run`, setting every phase's model itself.
- On the plan as written, every run delivered the ticket and kept the codebase's engineering rules at Sonnet 5.5 (half the cost of Opus 5.5) and at Haiku 5.5 (a sixth). The one run that broke a rule ran at Opus.
- On the same plan stripped of its detailed instructions, Haiku broke a rule in two runs of three without a guarantee gate, and in none with one: the gate ran inside the agent's session, caught each break, and the agent repaired it.
- The plan, written by a strong planner, carried most of the work. Published practice recommends the same split: a strong planner with lighter executors.

Ground read:

- `.claude/skills/phax-planning/SKILL.md` — "Choosing a model and effort" makes `claude-opus-5-5` the default phase model; the generated model catalog; the "Comprehensive instructions" constraint; "Lint before you run" and its five checks.
- `src/app/lintPlan.ts` — The models check calls `modelFindings` against the routing catalog only. The advisory check sends a registered `planAuditor` the plan projection.
- `src/domain/plan/lint.ts` — `modelFindings` turns preflight failures into `models` errors. `advisoryFindings` turns auditor findings into warnings that never fail the lint.
- `src/app/loadRouting.ts` — The catalog is built in, or comes from `~/.phax/model-routing.json`. The provider config is read the same way.
- `src/schemas/planDocument.ts` — A plan document phase spreads the extracted fields (`model`, `effort`, …) first and puts the content fields after them. Every key is required.
- `src/domain/authoring/renderPlan.ts` — Renders `**Recommended model:**` / `**Recommended effort:**` under each phase heading.
- `src/app/authorArtifact.ts` — Headless authoring spawns the planner with the `authoring.plan` model and effort.
- `src/domain/authoring/prompt.ts` — The authoring prompt carries no model policy of its own. The policy comes from the skill.
- `src/domain/plan/parsePlanMarkdown.ts` — The deterministic parser that lint and extraction share.
- `src/schemas/phaxConfig.ts` — `brief`, `planAuditor` and `authoring` are provider and planner seats declared as commands or models. `DEFAULT_AUTHORING_MODEL` is `claude-opus-5-5` at `high`.
- `src/schemas/planAudit.ts` — The auditor answer `{findings:[{message, phases}]}` carries no `$schema`.
- `src/schemas/briefReport.ts` — A brief report is `$schema`, `rules` (rule, files, guide with a file to read) and `findings`.
- `src/schemas/schemaUrl.ts` — Every persisted format has a format id and a `$schema` URL `https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json`. New formats are born with `$schema`.
- `src/cli/commands/validate.ts` — `phax validate` checks phax.json (and optionally a plan) and exits 2 on refusal.
- `docs/specs/2610160919-cost-ledger.md` — Approved. Records the models and API-list cost of each invocation.
- `docs/specs/2610160909-plan-estimate.md` — Approved. Gives every Claude catalog entry its list prices (`price.inputPerMTok`, `price.outputPerMTok`, …).
- `NEXT_STEPS.md` — The steme guarantee-provider seams (brief, gate report) that a planning provider would sit beside.

## 2. Problem

phax spends the strongest tier on every phase by default, although a plan written this well carried lighter executors. The planner also chooses in the wrong order: it commits to a model first, then writes instructions for that model, instead of choosing from what the written phase asks for.

No metric settles which code deserves which model. Every rule a codebase checks has a part a program can verify and a part left to judgment. Today that judgment belongs to nobody. Each planner makes it again for each plan, and it is never written down, never checked, and never visible to someone reading the plan. A guarantee provider knows the codebase's scopes and concepts but cannot hand that map to the person who should make the call. And `phax plans lint` cannot tell a plan that follows the person's call from one that ignores it.

## 3. Product goal

The planner writes each phase first. It then gives the phase a model and effort based on what the written phase asks for, starting from Sonnet 5.5 at medium instead of the strongest tier. The person responsible for the repository writes down once which files deserve which model and effort range, in a planning file whose format phax owns. Providers propose the map of files but never the models. The planner applies the file, the plan shows why each phase got its model, and lint flags any phase that departs from the file without a stated reason.

> The repository's owner decides which code deserves which model; the planner applies it, lint checks it, and phax never decides or rewrites it.

## 4. Terminology

- **Planning file** — `phax.planning.json` at the repository root, beside `phax.json` and separate from it. A `$schema`-stamped phax format holding a `default` assignment and a list of planning entries.
- **Planning entry** — One item of the planning file: `id` (stable, the key every merge uses), `source` (a provider's name, or null when written by hand), `name` (free text phax shows but never interprets), `description` (one sentence), `globs` (the files it covers), `model`, and an effort range.
- **Effort range** — `{ "min", "max" }`, two efforts the entry's model offers. `min` must not come after `max` in that model's catalog effort order.
- **Filled / unfilled entry** — A filled entry has both a `model` and an effort range. An unfilled entry has `model: null` and `effort: null`. There is no other combination. Providers produce unfilled entries, and only the person fills them.
- **Default assignment** — The planning file's `default`: a model and effort range for any planned file that no filled entry matches. With no planning file, the built-in default applies instead: `claude-sonnet-5-5` at effort `medium` (range medium–medium).
- **Planning provider** — A command declared in `phax.json` that prints a planning-entries document: entries carrying `id`, `name`, `description` and `globs`, and never a model or an effort.
- **Model order** — How phax ranks catalog models to find the most demanding one: by catalog list price, output price per MTok first and input price breaking ties. A model the catalog does not price ranks as its Claude-hub equivalent.
- **Governing assignment** — Among all the assignments matched by a phase's planned files, the most demanding one: the highest model in the model order, then the highest `max`, then the highest `min`. Its range is used as it stands; ranges are never merged.
- **Derogation** — A phase's declared departure from its governing assignment, with a reason. It turns lint's error into a warning.
- **Phase assignment lines** — The `**Planning entries:**`, `**Effort reason:**` and `**Model derogation:**` lines placed under a phase's model and effort lines.

## 5. Functional requirements

### 5.1 Phases are written before they are assigned

The system shall order each phase of the plan document JSON Schema so that the phase's content (title, objective, instructions, planned files, contracts, tests, verification, handoff, commit) precedes its `model`, `effort` and `assignment`.

### 5.2 The planning policy follows the planning file

The planning skill's model-and-effort policy shall tell the planner to write each phase first. It shall then take the phase's model and effort range from its governing assignment, require a recorded derogation for any departure, and keep the "Comprehensive instructions" constraint.

### 5.3 Built-in default

WHERE the repository has no planning file THE system SHALL give the planner `claude-sonnet-5-5` at effort `medium` as the assignment of every planned file.

### 5.4 The planner's own model is unchanged

The system shall spawn headless plan authoring with the model and effort of `authoring.plan`, whatever the planning file says.

### 5.5 The planner sees the planning file

WHEN headless plan authoring starts THE system SHALL put in the planner's prompt the default assignment and, for every entry, its name, description, globs, and either its model and effort range or that it has no model yet.

### 5.6 The planning file is a phax format

The system shall read the planning file from `phax.planning.json` at the repository root as a phax format stamped with its `$schema` and published with its JSON Schema.

### 5.7 Malformed planning file refused

IF the planning file lacks `$schema`, `default` or `entries`, carries an unknown key, repeats an entry `id`, has an entry with no glob, or has an entry with a model but no range (or a range but no model) THEN `phax validate` SHALL refuse it with exit 2, naming the file and the offending entry.

### 5.8 Planning file checked against the catalog

IF the default or an entry names a model the routing catalog does not list, an effort that model does not offer, or a range whose `min` comes after its `max` in that model's effort order THEN `phax validate` SHALL refuse it with exit 2, naming the entry `id` and the field.

### 5.9 Sync adds new entries unfilled

WHEN `phax planning sync <provider>` reads an emitted entry whose `id` the planning file lacks THE system SHALL add the entry with `source` set to the provider's name and `model` and `effort` set to null.

### 5.10 Sync refreshes its own entries but not their models

WHEN `phax planning sync <provider>` reads an emitted entry whose `id` exists with that provider as `source` THE system SHALL replace its `name`, `description` and `globs` and leave its `model` and `effort` unchanged.

### 5.11 Sync keeps entries no longer emitted

WHEN an entry whose `source` is the synced provider is missing from that provider's emission THE system SHALL keep the entry unchanged and report it as no longer emitted.

### 5.12 Sync never touches another source's entry

IF an emitted `id` names an entry from another source, whether written by hand or by another provider, THEN `phax planning sync` SHALL leave that entry unchanged and report the collision.

### 5.13 A failing provider changes nothing

IF the provider exits non-zero, outruns its time cap, or prints a document that does not decode as a planning-entries document (including one carrying a `model` or `effort`) THEN `phax planning sync` SHALL leave the planning file unchanged and exit non-zero, naming the provider.

### 5.14 Sync creates a missing planning file

WHEN `phax planning sync` runs and there is no planning file THE system SHALL create one with the built-in default as its `default` before merging.

### 5.15 Every file a phase may write is matched

The system shall match every file a phase plans to create, edit or optionally edit against the globs of every entry, and shall give a file that no filled entry matches the planning file's `default`.

### 5.16 The most demanding assignment governs

WHEN a phase's files match more than one assignment THE system SHALL take as governing the one whose model ranks highest in the model order, then the one with the highest `max`, then the one with the highest `min`.

### 5.17 Unfilled entries are reported, not guessed

IF a phase's file matches an unfilled entry THEN `phax plans lint` SHALL report a models warning naming the entry by its `name` and naming the phase, and that entry SHALL constrain nothing.

### 5.18 A phase outside its assignment is an error

IF a phase's model differs from its governing assignment's model, or its effort falls outside the governing range, and the phase declares no derogation, THEN `phax plans lint` SHALL report a models error naming the governing entry by its `name`.

### 5.19 A declared derogation is a warning

WHERE a phase declares a model derogation with its reason THE system SHALL report the phase's departure from its governing assignment as a models warning that carries the entry's `name` and the reason, not as an error.

### 5.20 Without a planning file, lint checks the catalog only

WHERE the repository has no planning file THE system SHALL check each phase's model and effort against the routing catalog only.

### 5.21 phax never rewrites a stated model

The system shall never write, replace or adjust a model or effort that a plan states, whether in lint, extraction, rendering, sync or run.

### 5.22 The plan shows why

The system shall show next to each phase's model and effort, in a rendered plan, the names of the entries the phase's files matched (each with its model and effort range), the reason for the chosen effort, and the derogation or `none`.

### 5.23 Assignment lines are required by lint

IF a phase lacks its `**Planning entries:**`, `**Effort reason:**` or `**Model derogation:**` line THEN `phax plans lint` SHALL report a structure error for that phase.

### 5.24 Extraction is unaffected

The system shall neither extract the phase assignment lines into `phax-plan.json` nor require them to extract a plan for a run.

### 5.25 Stale entry names are flagged

IF the entry names a phase states differ from the entries phax matches against the current planning file THEN `phax plans lint` SHALL report a models warning listing both.

### 5.26 An invalid planning file in lint

IF the planning file fails validation THEN `phax plans lint` SHALL report one models error naming the file and skip every planning-file comparison.

### 5.27 An invalid planning file in authoring

IF the planning file fails validation THEN headless plan authoring SHALL refuse to start, naming the file, before it spawns the planner.

### 5.28 Nothing waits for a model to be filled

The system shall complete sync, plan authoring, lint and runs while entries are still unfilled. It shall report those entries and never wait for a person to fill them.

### 5.29 Provider facts during planning

WHERE `phax.json` declares a `brief` provider THE system SHALL let the headless plan authoring session run `phax brief` on any phase's planned files.

## 6. Surface

### file: phax.planning.json — normative

    {
      "$schema": "https://docs.phax.run/schemas/planning/0.26.0.json",
      "default": { "model": "claude-sonnet-5-5", "effort": { "min": "medium", "max": "medium" } },
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

    Normative: the file name and location; the keys `$schema`, `default`, `entries`, `id`, `source`, `name`, `description`, `globs`, `model`, `effort.min`, `effort.max`; every key required; `source` is a provider name or null; `model` and `effort` are both set or both null. Indicative: the format id `planning` and the release in the URL.

### file: planning-entries document (a provider's stdout) — normative

    {
      "$schema": "https://docs.phax.run/schemas/planning-entries/0.26.0.json",
      "entries": [
        { "id": "core-decider", "name": "core · decider",
          "description": "Pure functions that decide a command against the current state.",
          "globs": ["src/core/decide/**"] },
        { "id": "http-request-contract", "name": "http · request contract",
          "description": "Schemas that decode every inbound HTTP request.",
          "globs": ["src/http/requests/**"] }
      ]
    }

    Normative: exactly the keys `id`, `name`, `description`, `globs` per entry; any other key is refused, so a provider cannot carry `model` or `effort`. Indicative: the format id `planning-entries`.

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
    ✗ planning sync refused: provider "acme-guard" exited 3; phax.planning.json unchanged
    $? = 1

    Normative: the invocation `phax planning sync <provider>`, a zero exit with unfilled entries, a non-zero exit with the file unchanged on refusal. Indicative: the output layout and wording, and whether a bare `phax planning sync` syncs every declared provider. Sync writes the file and does not commit it.

### file: plan.md phase assignment lines — normative

before:

    ## phase-02 — Decide refunds {#phase-02-decide-refunds}

    **Recommended model:** claude-opus-5-5
    **Recommended effort:** high

after:

    ## phase-02 — Decide refunds {#phase-02-decide-refunds}

    **Recommended model:** claude-opus-5-5
    **Recommended effort:** medium
    **Planning entries:** core · decider (claude-opus-5-5, medium–high); default (claude-sonnet-5-5, medium)
    **Effort reason:** two deciders of this kind already exist to follow; medium, the floor of core · decider's range, suffices.
    **Model derogation:** none

    Without a planning file: `**Planning entries:** built-in default (claude-sonnet-5-5, medium)`. An unfilled match renders as `http · request contract (no model yet)`. A derogation replaces `none` with its reason. Normative: the three line labels and `none`. Indicative: how each entry's model and range are rendered.

### file: plan document phase (phax artifact schema plan) — normative

before:

    { "id": "phase-02", "model": "claude-opus-5-5", "effort": "high",
      "planMarkdownAnchor": "#phase-02-decide-refunds", "plannedFilesToCreate": ["src/core/decide/refund.ts"],
      "plannedFilesToEdit": ["README.md"], "optionalFilesToEdit": [], "commit": { … },
      "title": "Decide refunds", "objective": "…", "detailedInstructions": ["…"], … }

after:

    { "id": "phase-02", "title": "Decide refunds", "objective": "…", "detailedInstructions": ["…"],
      "planMarkdownAnchor": "#phase-02-decide-refunds", "plannedFilesToCreate": ["src/core/decide/refund.ts"],
      "plannedFilesToEdit": ["README.md"], "optionalFilesToEdit": [], …, "commit": { … },
      "model": "claude-opus-5-5",
      "effort": "medium",
      "assignment": {
        "effortReason": "two deciders of this kind already exist to follow; medium, the floor of core · decider's range, suffices",
        "derogation": null
      } }

    Normative: `model`, `effort` and `assignment` come after every content field; `assignment.effortReason` is a string; `assignment.derogation` is a string or null; both are required. phax renders the `**Planning entries:**` line from the planning file and the planner never writes it.

### cli: phax plans lint models findings — indicative

before:

    error  models  phase-02  claude-sonnet-9 / high: not in the catalog (alternatives: claude-sonnet-5-5, …)

after:

    $ phax plans lint docs/plans/2611020930-refunds-plan.md
    error    models     phase-02  claude-sonnet-5-5 / medium: outside planning entry "core · decider" (claude-opus-5-5, medium–high); declare a model derogation with its reason
    warning  models     phase-03  planning entry "http · request contract" has no model yet; phase checked against the default
    warning  models     phase-04  derogation from planning entry "core · decider" (claude-opus-5-5, medium–high): rename only, no decision logic changes
    warning  models     phase-05  planning entries stated: "docs"; matched now: "docs", "core · decider"
    error    structure  phase-06  missing **Effort reason:** line
    $? = 1

    Normative: the severity of each finding, the `models`/`structure` check, the phase, and the entry's `name` in the message. Indicative: the wording.

### cli: phax validate — normative

before:

    $ phax validate
    ✓ config is valid (project: refunds)
    $? = 0

after:

    $ phax validate
    ✓ config is valid (project: refunds)
    ✓ phax.planning.json is valid (3 entries, 1 without a model)
    $? = 0

    $ phax validate
    ✓ config is valid (project: refunds)
    ✗ Planning file validation failed: entry "core-decider": effort.min "high" comes after effort.max "low" for claude-opus-5-5
      at: phax.planning.json
    $? = 2

    Normative: exit 2 on refusal, naming the file, the entry `id` and the field. Indicative: the wording.

### file: .claude/skills/phax-planning/SKILL.md — Choosing a model and effort — indicative

before:

    - The default phase model is `claude-opus-5-5`: it is the cheapest Opus-tier entry and matches or beats `claude-fable-5-1` from `medium` effort up.
    - Use `claude-sonnet-5-5` for mechanical phases (catalog/table edits, renames, doc sweeps).
    - Use `claude-fable-5-1` only for a stated reason that Opus 5.5 cannot serve, and record that reason in Technical arbitrations.

after:

    - Write every phase first. Choose its model and effort last, from what the written phase asks for.
    - A phase's model is its governing planning entry's model (`phax.planning.json`), and its effort lies within that entry's range. With no planning file, use `claude-sonnet-5-5` at `medium`.
    - Say in **Effort reason:** why the effort sits where it does in the range. `phax brief` on the phase's files tells you whether the code already holds instances to follow.
    - Leave the assignment only for a reason, written as the phase's **Model derogation:** (and in Technical arbitrations when it binds several phases).
    - An entry with no model yet constrains nothing. Never guess a model for it.

## 7. Non-goals

- Having a provider supply the skill's architecture guidance (the inside-out / outside-in example, the layer table): a later spec.
- Raising a phase's model after a gate fails (a cascade): a later spec.
- Calibrating effort ranges or models from the cost ledger.
- phax proposing, ranking or filling a model for an entry: models come only from the person.
- Enforcing the planning file in `phax run` or its preflight: the run reads the models the plan states, as today, and lint is the only check against the planning file.
- Changing the planner's own model or the `authoring.plan` default.
- Deleting entries on sync, or committing the planning file on sync.
- A new provider seat for planning facts (see §9 Q3).
- Rewriting the models of plans written before this spec: lint reports their missing assignment lines, and they are fixed like any other lint finding.
- Ordering models by benchmark score or by any ranking phax maintains itself.

## 8. Acceptance criteria

### The plan document assigns after it writes

Given the plan document JSON Schema, when `phax artifact schema plan` prints it, then in the phase object, `model`, `effort` and `assignment` come after `commit` and after every content field, and `assignment` requires `effortReason` and `derogation`. (refs §5.1)

### The skill no longer defaults to the strongest tier

Given the shipped phax-planning skill, when its "Choosing a model and effort" section is read, then it tells the planner to write the phase first and to take the model and range from the governing planning entry (or `claude-sonnet-5-5` at `medium` with no planning file); it requires a **Model derogation:** for any departure; it no longer names `claude-opus-5-5` as the default phase model; and the "Comprehensive instructions" constraint is still present. (refs §5.2)

### Without a planning file the planner starts from Sonnet at medium

Given a repository with no `phax.planning.json`, when `phax artifact new plan refunds --headless --brief brief.md` starts, then the planner's prompt gives `claude-sonnet-5-5` at `medium` as the assignment of every planned file. (refs §5.3, §5.5)

### The planner keeps its configured model

Given `authoring.plan` set to `claude-opus-5-5` at `high` and a planning file whose default is `claude-haiku-5-5`, when headless plan authoring starts, then the planner session is spawned with `claude-opus-5-5` at `high`. (refs §5.4)

### The prompt carries every entry

Given a planning file with the filled entry `core-decider` and the unfilled entry `http-request-contract`, when headless plan authoring starts, then the prompt carries the default and both entries' names, descriptions and globs, with `core · decider` at `claude-opus-5-5` medium–high and `http · request contract` marked as having no model yet. (refs §5.5)

### A valid planning file validates

Given the §6 `phax.planning.json` example, when `phax validate` runs, then it exits 0 and reports `phax.planning.json` valid, with 3 entries and 1 without a model. (refs §5.6)

### A malformed planning file is refused

Given a planning file with two entries whose `id` is `core-decider`, or with an entry carrying a `model` and `"effort": null`, when `phax validate` runs, then it exits 2, naming `phax.planning.json` and `core-decider`. (refs §5.7)

### Unknown models and inverted ranges are refused

Given an entry `core-decider` with `"model": "claude-sonnet-9"`, or with `claude-opus-5-5` and `{ "min": "high", "max": "low" }`, when `phax validate` runs, then it exits 2, naming `core-decider` and the field (`model`, or `effort`). (refs §5.8)

### Sync adds new entries to fill

Given `acme-guard` declared under `planning.providers`, emitting `core-refund-decider`, which the planning file lacks, when `phax planning sync acme-guard` runs, then the file gains `core-refund-decider` with `"source": "acme-guard"`, `"model": null` and `"effort": null`; the output lists it as having no model yet; and the command exits 0. (refs §5.9, §5.28)

### Sync never touches a model

Given `core-decider` with source `acme-guard`, `claude-opus-5-5` and medium–high, and `acme-guard` now emitting it with different globs and description, when `phax planning sync acme-guard` runs, then the entry's `globs` and `description` are replaced, and its `model` and `effort` are unchanged. (refs §5.10, §5.21)

### Sync keeps entries no longer emitted

Given `core-legacy` with source `acme-guard`, which `acme-guard` no longer emits, when `phax planning sync acme-guard` runs, then `core-legacy` is still in the file, unchanged, and the output reports it as no longer emitted. (refs §5.11)

### Sync leaves hand-written entries alone

Given a hand-written entry `docs` (`"source": null`) and `acme-guard` emitting an entry with id `docs`, when `phax planning sync acme-guard` runs, then the hand-written `docs` entry is unchanged, and the output reports the collision. (refs §5.12)

### A failing provider changes nothing

Given `acme-guard` exiting 3, or printing an entry that carries `"model"`, when `phax planning sync acme-guard` runs, then `phax.planning.json` is byte-identical to before, and the command exits non-zero naming `acme-guard`. (refs §5.13)

### Sync creates the planning file

Given a repository with no `phax.planning.json` and `acme-guard` declared, when `phax planning sync acme-guard` runs, then `phax.planning.json` exists with its `$schema`, a `default` of `claude-sonnet-5-5` at medium–medium, and the emitted entries, all unfilled. (refs §5.14)

### A phase below its entry is an error

Given the §6 planning file and a phase creating `src/core/decide/refund.ts` and editing `README.md`, stated at `claude-sonnet-5-5` / `medium` with `**Model derogation:** none`, when `phax plans lint` runs, then it reports a `models` error for the phase naming `core · decider` and exits 1; when the same phase is stated at `claude-opus-5-5` / `medium`, it reports no models finding for the phase. (refs §5.15, §5.16, §5.18)

### Optional files count

Given a phase whose only file under `src/core/decide/**` is listed in Optional files that may be edited, stated at `claude-sonnet-5-5` / `medium` with no derogation, when `phax plans lint` runs, then it reports a `models` error naming `core · decider`. (refs §5.15)

### Same model, higher range governs

Given two filled entries both at `claude-opus-5-5`, one low–medium and one medium–high, both matched by one phase stated at `claude-opus-5-5` / `low`, when `phax plans lint` runs, then it reports a `models` error naming the medium–high entry. (refs §5.16)

### The higher-priced model governs

Given two filled entries, one at `claude-haiku-5-5` and one at `claude-sonnet-5-5`, both matched by one phase stated at `claude-haiku-5-5` with no derogation, when `phax plans lint` runs, then it reports a `models` error naming the `claude-sonnet-5-5` entry. (refs §5.16)

### Unfilled entries warn and constrain nothing

Given a phase whose only matched entry is the unfilled `http · request contract`, stated at the default's `claude-sonnet-5-5` / `medium`, when `phax plans lint` runs, then it reports a `models` warning naming `http · request contract` and the phase, reports no models error, and exits 0. (refs §5.17, §5.28)

### A derogation turns the error into a warning

Given a phase matching `core · decider`, stated at `claude-sonnet-5-5` / `medium` with `**Model derogation:** rename only, no decision logic changes`, when `phax plans lint` runs, then it reports a `models` warning carrying `core · decider` and the reason, no models error for the phase, and exits 0. (refs §5.19)

### Without a planning file only the catalog binds

Given a repository with no `phax.planning.json` and a phase stated at `claude-opus-5-5` / `high` with `**Planning entries:** built-in default (claude-sonnet-5-5, medium)`, when `phax plans lint` runs, then it reports no models finding for the phase. (refs §5.20)

### Stated models survive every step

Given a plan whose phase states `claude-sonnet-5-5` / `low`, outside its governing entry, when `phax plans lint` runs, then `phax run` extracts the plan, then plan.md still states `claude-sonnet-5-5` / `low`, and `phax-plan.json` carries `claude-sonnet-5-5` / `low` for that phase. (refs §5.21)

### A rendered phase shows its entries and reasons

Given the §6 planning file and a headless planner returning phase-02 with `assignment.effortReason` set and `assignment.derogation: null`, when phax renders the plan, then phase-02 shows `**Planning entries:** core · decider (claude-opus-5-5, medium–high); default (claude-sonnet-5-5, medium)`, the effort reason, and `**Model derogation:** none`, directly after its model and effort lines. (refs §5.22)

### A phase without its assignment lines fails structure

Given a plan whose phase-06 has no `**Effort reason:**` line, when `phax plans lint` runs, then it reports a `structure` error for phase-06 naming the missing line and exits 1. (refs §5.23)

### Older plans still extract deterministically

Given an Approved plan written before this spec, with no assignment lines, when `phax run` extracts it, then the deterministic path succeeds without falling back to the model, and each phase in `phax-plan.json` carries the same keys as before this spec. (refs §5.24)

### Stale entry names warn

Given a phase stating `**Planning entries:** docs (claude-haiku-5-5, low–medium)` whose files now also match `core · decider`, when `phax plans lint` runs, then it reports a `models` warning listing the stated `docs` and the matched `docs`, `core · decider`. (refs §5.25)

### An invalid planning file is one lint error

Given a planning file with an inverted range, when `phax plans lint` runs, then it reports exactly one `models` error naming `phax.planning.json` and no other finding drawn from the planning file. (refs §5.26)

### An invalid planning file stops authoring before spawn

Given a planning file naming `claude-sonnet-9`, when `phax artifact new plan refunds --headless --brief brief.md` runs, then it refuses, naming `phax.planning.json`, and no planner session is spawned or recorded. (refs §5.27)

### The planner can read the brief

Given `phax.json` declaring a `brief` provider, when the headless plan authoring session runs `phax brief src/core/decide/refund.ts`, then the command is allowed and returns the provider's brief report for that path. (refs §5.29)

## 9. Open questions for implementation planning

### Q1 — How does phax rank models to find the most demanding assignment?

- By catalog list price (output per MTok, then input); a model with no price ranks as its Claude-hub equivalent — abandons: Independence from plan-estimate: this spec cannot ship before the catalog carries prices, and a provider repricing its models reorders them.
- A new required `rank` integer on every catalog entry — abandons: A single source of truth: a second number phax maintains beside price, free to contradict it, and encoding phax's own opinion of the models.
- The planning file lists its own model ladder, lowest to highest — abandons: One order across repositories: each repository maintains its own ladder, and a catalog model missing from it is unusable there.

Recommendation: By catalog list price (output per MTok, then input); a model with no price ranks as its Claude-hub equivalent — Price is a fact, and the approved plan-estimate spec already adds it to the catalog. Reading "most demanding" as "most costly to run" adds no judgment of phax's own, in line with the guiding rule. A repricing changes only which entry wins when entries conflict; each entry's assignment stays the person's.

### Q2 — Without a planning file, does `phax plans lint` enforce the built-in default?

- Yes: a phase above `claude-sonnet-5-5` / `medium` needs a derogation — abandons: Every plan written under the Opus default, in every repository without a planning file, fails lint until each of its phases states a derogation.
- No: lint checks the catalog only; the default steers the planner through the skill and the prompt — abandons: Mechanical enforcement of the default: a planner that ignores it still passes lint.

Recommendation: No: lint checks the catalog only; the default steers the planner through the skill and the prompt — Lint checks the person's written judgment. With no planning file there is none, and enforcing phax's built-in default as if it were the person's judgment would make phax decide. The default still binds the planner through the skill and the prompt.

### Q3 — Within an entry's range, through which seam does the planner ask the provider for facts about a phase's files (for example, whether the code already holds instances of what the phase will write)?

- `phax brief <paths>` and its brief report — abandons: A dedicated fact channel: "first of its kind" has to be read from rules and their guides (a rule whose guide names an existing file is an instance), a shape built for obligations rather than observations.
- Extend the `planAuditor` seam — abandons: Timing: the auditor runs at lint, after the plan is written, so its facts arrive after the assignment; and its answer carries no `$schema`.
- A new `planning.facts` provider command with its own request and answer formats — abandons: Economy: a third provider contract to version and implement, before brief has been shown to be insufficient.

Recommendation: `phax brief <paths>` and its brief report — The brief already answers for any paths at the moment the planner needs it, is versioned, and carries no model. A rule's guide pointing at an existing file is exactly the "instances exist" fact. A dedicated seat can follow if brief proves too indirect, and this spec adds none.

### Q4 — Where does `phax planning sync` get a provider's entries?

- A provider command declared in `phax.json` (`planning.providers`), like `brief` and `planAuditor` — abandons: Zero configuration: a provider must be declared before it can be synced, and phax takes on its spawn (time cap, failure handling).
- A file or stdin: `acme-guard planning-entries | phax planning sync --source acme-guard -` — abandons: A trusted `source`: the caller asserts whose entries these are, so one mistyped pipe overwrites another provider's entries under the wrong name.

Recommendation: A provider command declared in `phax.json` (`planning.providers`), like `brief` and `planAuditor` — `source` is what keeps a merge from touching anyone else's entries, so it must come from configuration, not from the caller. Every other provider seam in phax is a declared command, and the planning file stays separate from `phax.json`, as the brief requires.

## 10. Implementation-planning note

Settled:

- The built-in default is `claude-sonnet-5-5` at effort medium–medium. It applies with no planning file, and sync seeds it as `default` when it creates the file.
- The planner's own model stays `authoring.plan`. This spec changes what the planner assigns to phases, not the planner.
- `source` is required: a provider's name, or null for a hand-written entry. The brief's "absent" becomes an explicit null, per the no-optional-keys schema policy.
- An entry is either filled (model and range) or unfilled (both null). A half-filled entry is refused.
- Matching covers the create, edit and optional lists. An unmatched file takes `default`. An unfilled entry constrains nothing and is reported.
- The governing assignment is the highest model in the model order, then the highest `max`, then the highest `min`. Ranges are never merged. Effort order is the model's catalog effort list order.
- In a headless plan, phax renders `**Planning entries:**` from the planning file. The planner supplies only `assignment.effortReason` and `assignment.derogation`.
- The assignment lines are required by lint's structure check, but not by extraction. `phax-plan.json` and runs are unchanged.
- Sync writes the planning file and never commits it. The person fills the models and commits.
- `phax validate` validates the planning file alongside `phax.json`, with exit 2 on refusal.
- Resolved recommendations: Q1 price order, Q2 catalog-only without a file, Q3 `phax brief`, Q4 declared provider command.

Left open:

- The format ids (`planning`, `planning-entries`) and the release that first stamps them.
- The glob dialect: reuse whatever path-pattern matcher phax already has, if any; otherwise choose one and document it.
- Whether the headless plan authoring session's command allowance already admits `phax brief`, or needs it added.
- Sync's time cap, and whether a bare `phax planning sync` syncs every declared provider in name order.
- The exact wording of the lint findings and the sync output.
- How a non-Claude model with no price maps to its Claude-hub equivalent for ordering, when its equivalence depends on effort.

Constraints:

- No back-compat shims in persisted schemas: every new key is required, and `source`, `model` and `effort` use explicit null variants.
- Explicit per-variant enums: filled and unfilled entries are two variants; efforts are checked per model against the catalog.
- Respect the layers: reading the planning file and spawning the provider go through ports; matching, ordering and choosing the governing assignment are pure domain; the planning file and the provider document are decoded through schemas at the boundary.
- phax stays autonomous: unfilled entries and provider failures are reported, and nothing waits on a person.
- phax never chooses or rewrites a model silently: no step writes a model or effort except the planner and the person.
- Model order depends on the catalog prices from the approved plan-estimate spec: plan after that catalog change, or include it.
- Both new formats are stamped and snapshotted with `packages/schemas` like every phax format, and their JSON Schemas are published.
- The skill keeps its "Comprehensive instructions" constraint: a phase given a lighter model needs the detail.
- Fixtures and examples are made up (`acme-guard`, `src/core/decide/**`).
- Tests hold across a release cut: assert `$schema` by format id and the release pattern, never by the running version.

## 11. Docs page

Page: Assigning models to phases — phax.planning.json

Reader: The person responsible for a repository, who wants phax plans to spend strong models only where their code needs them and wants lint to hold planners to that choice.

Example: A planning file with one provider entry, one unfilled provider entry, one hand-written entry and the default. Then `phax planning sync acme-guard` adds an entry to fill, a plan phase shows its matched entries and effort reason, `phax plans lint` raises an error for a phase outside its entry, and a derogation turns that error into a warning.
