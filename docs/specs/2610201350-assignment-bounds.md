---
status: Draft
date: 2026-10-20
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Assignment bounds — the repository's owner bounds each phase's model and effort per part of the code, and lint holds plans to them

## 1. Context

Three pieces already exist.

First, the phax-planning skill teaches a phase model policy, generated from one phax constant: `claude-sonnet-5-5` at `medium` by default; a higher effort or `claude-opus-5-5` for a phase that designs what no code shows yet; `claude-haiku-5-5` for a phase that reproduces a pattern a gate checks. Every departure carries a reason. The policy is the same for every repository, and phax never applies it to a phase.

Second, the plan document carries that reason on each phase as `modelReason`, a non-empty string or null. It sits with `model` and `effort` as the phase's last three keys. phax renders a non-null reason as a `**Model reason:**` line under `**Recommended model:**` and `**Recommended effort:**`, and never extracts it. That shape was cut in 0.25.0: its JSON Schema snapshot is published, and `phax artifact migrate-documents` lifts older sidecars to it.

Third, `phax architecture [path]...` asks the `architecture` provider, declared in any config layer, for an architecture report and prints it. The report is `{ $schema, body }`: a Markdown body phax never parses. The provider knows the parts of the code and never names a model. The format is still in the open 0.26.0 `next` snapshot, so its shape can change before the 0.26.0 cut with no frozen copy and no lift. Without a provider, the command prints one line telling the agent to read the code and its documentation, and exits 1.

`phax plans lint` reads plan.md through the deterministic parser. Its `models` check compares each phase's model and effort with the routing catalog only, and never reads the reason line. Lint is model-free, and it already spawns one provider: the plan auditor.

phax.json's top-level keys are optional. They merge across `phax.json`, `phax.local.json` and `~/.phax/config.json`, except `records`, which is project-only. The routing catalog lists each model's efforts in order. It is built in or read from `~/.phax/model-routing.json`, so it can differ between workstations.

The Draft spec `phase-model-assignment`, abandoned on 2026-10-20, wanted the same thing this spec wants: an owner who bounds each phase's model per group of files. It built that with a separate planning file, a sync command fed by a planning provider, and a model order based on price. This spec keeps that goal and its lint findings, and drops the rest.

Ground read:

- `docs/specs/archive/2610171257-phase-model-assignment.md` — Abandoned 2026-10-20. Its goal survives: the owner bounds a phase's model and effort per group of files, and lint flags an unstated departure. Its lint findings are reused. Its separate `phax.planning.json`, `phax planning sync`, planning provider, unfilled entries and price-based model order are dropped.
- `docs/specs/2610171254-planning-skill-defaults.md` — Approved. §5.2–§5.9 add a per-phase `modelReason`, which is required, a string or null, and placed with `model` and `effort` as the last three keys. It is rendered as `**Model reason:**` and never extracted. §5.17–§5.30 add `phax architecture [path]...` and the `architecture-request` / `architecture-report` formats. Q2 chose the per-phase field. Q3 chose pull. Q4: no provider means one stdout line and exit 1. Q6 made the report a Markdown body only.
- `src/schemas/planDocument.ts` — A phase ends with `commit`, `modelReason` (NullOr NonEmptyString, described as the departure from the skill's default), `model`, `effort`. `projectExtractedPlan` copies only the extracted fields, so `modelReason` never reaches `phax-plan.json`.
- `src/domain/authoring/renderPlan.ts` — Renders `**Recommended model:**` and `**Recommended effort:**`, then `**Model reason:** <text>` when `modelReason` is non-null, directly under the phase heading.
- `src/domain/routing/phaseModelPolicy.ts` — PHASE_MODEL_POLICY: default `claude-sonnet-5-5` at `medium`, stronger `claude-opus-5-5`, lighter `claude-haiku-5-5`. It is guidance rendered into the skill and never applied to a phase.
- `src/app/lintPlan.ts` — Read-only, model-free lint over the deterministic parse of plan.md. The `models` check is `modelFindings` against the routing catalog only, like the run preflight. The plan auditor is the one provider lint already spawns. A failing auditor becomes a finding, never an effect error.
- `src/domain/plan/lint.ts` — LintCheck is structure | files | commands | models | advisory. A `models` finding names the phase and the reason, and today it is always an error.
- `src/schemas/phaxConfig.ts` — Every top-level key is optional. `brief` and `planAuditor` are provider seats whose command is split on whitespace with no shell. The phax.json effort literal is low | medium | high. The user overlay schema (phax.local.json, ~/.phax/config.json) omits `records`.
- `src/domain/config/mergeLayers.ts` — Merges project < global user < local user per key. `records` is project-only and never overlaid: the precedent for a project-layer-only key.
- `src/schemas/persisted.ts` — A plan sidecar stamped below its current stamp is read by the frozen 0.20.0 decoder and lifted with empty preamble questions and `modelReason: null`. A pre-schema sidecar is lifted the same way. Readers refuse an older shape and name `phax artifact migrate-documents`.
- `src/app/migrateDocuments.ts` — The one writer of older sidecars. It rewrites the sidecars and re-rendered bodies, re-seeds the extraction cache and commits exactly the rewritten paths. It reports Approved artifacts whose text changes. It never touches archived or hand-authored artifacts.
- `packages/schemas/snapshots/plan-document/` — 0.25.0.schema.json is cut, so the shape that carries `modelReason` is released and renaming it needs a frozen copy and a lift.
- `docs/release.md` — A format's shape lives in `next.schema.json` until the cut renames it to the release. A stamp names the release that last changed the format's shape.
- `docs/upgrading.md` — Lists, per release, the steps that release asks for. 0.25.0 asks for `phax artifact migrate-documents`. 0.26.0 has no entry yet.
- `docs/specs/2610190947-interactive-phases.md` — Draft. Adds a required per-phase `mode` (`headless` | `interactive`) to `phax-plan.json` and the plan document. An interactive phase plans no file.
- `docs/specs/2609281159-oracle-phases.md` — Approved. Adds a required per-phase `oracle` (`{ dischargedBy, files }` or null) to `phax-plan.json` and the plan document.

## 2. Problem

Which code deserves which model is a judgment no metric settles. Today that judgment has no owner and no record. A person may know that `src/core/decide/**` needs Opus at medium effort or more, and that the docs are safe with Haiku, but they have nowhere to write it down. The skill's policy is the same for every repository, so no planner reads that person's choice, and `phax plans lint` cannot tell a plan that respects it from one that ignores it.

The architecture provider knows the parts of the code but hands them over only as prose, so nothing can name a part, let alone bind one. The reason a phase carries, `modelReason`, measures a departure from phax's own policy. It has no notion of the owner's bound, and its name ties it to the model although it explains the effort too.

## 3. Product goal

The repository's owner writes in phax.json an ordered list of bounds. Each bound gives the model and effort range for one part of the code: a part the architecture report names, or a set of globs. The first bound that matches a phase's planned files governs the phase. The architecture report names the parts as data, beside its prose. The planner sees the bounds before it assigns. It gives each phase its governing bound's model at an effort inside the range, or says why on the phase in `assignmentReason`. `phax plans lint` holds every plan to the bounds: a departure with no reason is an error, and a stated departure is a warning that quotes the reason. phax applies the owner's choice and checks plans against it. It never decides, guesses, ranks or rewrites a model.

> The repository's owner decides which code gets which model; phax applies that decision, checks plans against it, and never decides, ranks or rewrites a model.

## 4. Terminology

- **Part** — One entry of the architecture report's `parts`: a stable `id`, a `name` phax shows but never interprets, a one-sentence `description`, and the `globs` of the files it covers. Only the architecture provider produces parts.
- **Bound** — One entry of `assignments` in phax.json: a `model` and an effort range `{ min, max }`, over either a part (a part bound) or a set of globs (a globs bound). A bound is named by its position, `assignments[N]`, counted from 0.
- **Part bound** — `{ "kind": "part", "part", "model", "effort" }`. It covers the files of the part whose `id` is `part`, through the globs the architecture report gives that part. It copies no glob.
- **Globs bound** — `{ "kind": "globs", "globs", "model", "effort" }`. It covers the files its own globs match: a cut finer than the architecture's parts, or one across them. It needs no architecture provider.
- **Effort range** — `{ "min", "max" }`: two efforts the bound's model offers, with `min` not after `max` in that model's catalog effort order. The range includes both ends.
- **Planned files** — Every file a phase plans to create, plans to edit, or may optionally edit.
- **Governing bound** — The first bound, in list order, that matches any of a phase's planned files. A phase with no matching bound, or with no planned files, has none. The owner orders bounds from most to least demanding, as in a CODEOWNERS file. phax never reorders them.
- **Conforming phase** — A phase whose model is its governing bound's model and whose effort lies within that bound's range. When no bound governs the phase, it conforms when it takes the policy default.
- **Departure** — A phase that does not conform. phax never ranks models, so a departure is neither stronger nor lighter: it is only different.
- **Policy default** — The skill's default phase assignment, `claude-sonnet-5-5` at `medium`, from PHASE_MODEL_POLICY. It stands in for a bound when none governs a phase.
- **Assignment reason** — `assignmentReason`, a required key of every plan-document phase, placed just before `model`: why the phase departs, or null when it conforms. It covers the model and the effort together. A plan.md states it as an `**Assignment reason:**` line. It replaces `modelReason` and its `**Model reason:**` line.

## 5. Functional requirements

### 5.1 The architecture report carries parts

The system shall read the architecture report as `{ $schema, body, parts }`, with `parts` a list (possibly empty) of parts that each carry exactly `id`, `name`, `description` and `globs`, and shall publish that shape as the `architecture-report` JSON Schema.

### 5.2 A malformed report is unreadable

IF an architecture report lacks `parts`, carries a key other than `$schema`, `body` and `parts`, repeats a part `id`, or holds a part with an unknown key or an empty `globs` THEN `phax architecture` SHALL print one line naming the architecture provider and the reason, and exit 1.

### 5.3 phax renders the report for the agent

WHEN `phax architecture` prints an architecture report THE system SHALL render it to Markdown: the body as is, then each part's name, id, description and globs, in the report's order.

### 5.4 Bounds live in phax.json

WHERE `phax.json` declares `assignments` THE system SHALL read it as a non-empty ordered list of bounds, each exactly a part bound `{ kind: "part", part, model, effort: { min, max } }` or a globs bound `{ kind: "globs", globs, model, effort: { min, max } }`.

### 5.5 A malformed bound is a config error

IF `assignments` is empty, or a bound has a `kind` other than `part` or `globs`, lacks a key of its variant, carries a key of the other variant or an unknown key, has an empty `globs`, or names an effort outside phax's effort vocabulary THEN loading `phax.json` SHALL fail with exit 2, naming the bound as `assignments[N]` and the field.

### 5.6 Bounds are the repository's, not a workstation's

IF `assignments` appears in `phax.local.json` or `~/.phax/config.json` THEN loading the config SHALL fail with exit 2, naming that file.

### 5.7 phax validate checks bounds against the catalog

WHEN `phax validate` runs and `phax.json` declares bounds THE system SHALL refuse with exit 2, naming the bound and the field, any bound whose model the routing catalog does not list, whose `min` or `max` that model does not offer, or whose `min` comes after its `max` in that model's effort order.

### 5.8 The first matching bound governs

The system shall take as a phase's governing bound the first bound in list order that matches any of the phase's planned files. A globs bound matches through its own globs, and a part bound through its part's globs.

### 5.9 One conformity rule

The system shall hold a phase conforming to its governing bound when the phase's model is the bound's model and its effort lies within the bound's range in that model's catalog effort order, and departing otherwise, without ordering models.

### 5.10 An unstated departure is an error

IF a phase departs from its governing bound and carries no `**Assignment reason:**` line THEN `phax plans lint` SHALL report a `models` error for the phase naming the bound.

### 5.11 A stated departure is a warning

WHEN a phase departs from its governing bound and carries an `**Assignment reason:**` line THE system SHALL report in `phax plans lint` a `models` warning for the phase that names the bound and quotes the reason.

### 5.12 A conforming phase states no reason

IF a phase conforms to its governing bound and carries an `**Assignment reason:**` line THEN `phax plans lint` SHALL report a `models` warning for the phase naming the bound.

### 5.13 Lint asks the provider for the parts

WHEN `phax plans lint` runs on a plan that parses and at least one bound is a part bound THE system SHALL run the architecture provider once, with an architecture request whose `files` is null, and resolve each part bound to the globs of the part its report gives that `id`.

### 5.14 An unresolved part bound is an error

IF a part bound cannot be resolved, because no architecture provider is configured, the provider fails or prints an unreadable report, or its report carries no part with the bound's `part` id, THEN `phax plans lint` SHALL report one `models` error for each such bound, naming the bound and the cause, and compare no phase with the bounds or with the policy default.

### 5.15 An invalid bound is an error in lint

IF a bound names a model the routing catalog does not list, an effort that model does not offer, or a `min` after its `max` THEN `phax plans lint` SHALL report one `models` error naming the bound and the field, and compare no phase with the bounds or with the policy default.

### 5.16 Globs bounds need no provider

WHILE every declared bound is a globs bound THE system SHALL check plans against the bounds in `phax plans lint` without running the architecture provider, whether or not one is configured.

### 5.17 An unstated departure from the policy default warns

IF no bound governs a phase, the phase departs from the policy default, and it carries no `**Assignment reason:**` line THEN `phax plans lint` SHALL report a `models` warning for the phase naming the policy default.

### 5.18 A phase at the policy default states no reason

IF no bound governs a phase, the phase takes the policy default, and it carries an `**Assignment reason:**` line THEN `phax plans lint` SHALL report a `models` warning for the phase naming the policy default.

### 5.19 The model-reason line is removed

IF a phase in plan.md carries a `**Model reason:**` line THEN `phax plans lint` SHALL report a `models` error for the phase that names `**Assignment reason:**` as the line to write.

### 5.20 The plan document carries assignmentReason

The plan document shall require on every phase an `assignmentReason` key, a non-empty string or null, shall carry no `modelReason` key, and shall keep `assignmentReason`, `model` and `effort` as the phase's last three keys, in that order.

### 5.21 The reason is rendered

The system shall render a non-null `assignmentReason` as an `**Assignment reason:**` line directly under the phase's `**Recommended model:**` and `**Recommended effort:**` lines, and shall render no line for a null one.

### 5.22 The reason is not extracted

The system shall extract neither `assignmentReason` nor the `**Assignment reason:**` line into `phax-plan.json`, and shall project a plan with or without the line to the same extracted plan.

### 5.23 0.25.0 sidecars are lifted

WHEN `phax artifact migrate-documents` meets a live plan sidecar stamped at the 0.25.0 plan-document shape THE system SHALL rewrite it at the current shape, carrying each phase's `modelReason` value over as its `assignmentReason`, re-render each `**Model reason:**` line of its plan.md as `**Assignment reason:**`, and commit both files.

### 5.24 Older sidecars lift straight to the current shape

WHEN `phax artifact migrate-documents` meets a live plan sidecar stamped below 0.25.0 or written before `$schema` THE system SHALL lift it to the current shape with `assignmentReason: null` on every phase.

### 5.25 Readers refuse an unlifted sidecar

IF a reader other than `phax artifact migrate-documents` meets a plan sidecar below the current plan-document shape THEN it SHALL refuse the sidecar, naming `phax artifact migrate-documents`.

### 5.26 The headless planner is given the bounds

WHERE `phax.json` declares bounds THE system SHALL state in the headless plan authoring prompt every bound in list order, with its part id or its globs, its model and its range, together with the first-match and conformity rules.

### 5.27 The headless planner is told none exist

WHERE `phax.json` declares no bounds THE system SHALL state in the headless plan authoring prompt that no bound is declared and that the policy default guides each phase's assignment.

### 5.28 phax architecture shows the bounds beside the map

WHEN `phax architecture` prints a report and `phax.json` declares bounds THE system SHALL print every bound in list order after the parts, showing each part bound with its part's name and globs when the report carries that part.

### 5.29 Bounds are shown without a provider

IF no architecture provider is configured and `phax.json` declares bounds THEN `phax architecture` SHALL print its no-provider line, then every bound in list order with each part bound marked unresolved, and exit 1.

### 5.30 The skill teaches the conformity rule

The phax-planning skill shall teach the governing bound, the conformity rule, the policy default as what stands in when no bound governs, and that `assignmentReason` (or the `**Assignment reason:**` line) is null exactly when the phase conforms, and shall no longer name `modelReason` or `**Model reason:**`.

### 5.31 The skill says where the bounds are read

The phax-planning skill shall tell the planner to read the bounds from `phax architecture` before assigning, including when the command exits 1 with its no-provider line.

### 5.32 Only lint checks the bounds

The system shall check plans against the bounds only in `phax plans lint`, and shall author, approve, extract and run a plan whatever its conformity, the bounds, or the state of the architecture provider.

### 5.33 phax never rewrites a model

The system shall never write, replace or adjust a model or effort that a plan states, nor a bound's model or effort, in lint, validation, rendering, migration, extraction or a run.

### 5.34 The upgrade guide names the step

The upgrading guide shall carry, under the release that ships the change, a step naming `phax artifact migrate-documents` for plan sidecars, and the renaming of a hand-written plan's `**Model reason:**` lines to `**Assignment reason:**`.

## 6. Surface

### file: architecture-report (the architecture provider's stdout) — normative

before:

    { "$schema": "https://docs.phax.run/schemas/architecture-report/0.26.0.json",
      "body": "# Architecture — acme-billing\n\nThree parts. `src/core` decides; …" }

after:

    { "$schema": "https://docs.phax.run/schemas/architecture-report/0.26.0.json",
      "body": "# Architecture — acme-billing\n\n`src/core` decides and imports nothing outside itself. `src/http` decodes requests and calls `src/core`. …",
      "parts": [
        { "id": "core-decide", "name": "core · decide",
          "description": "Pure functions that decide a command against the current state.",
          "globs": ["src/core/decide/**"] },
        { "id": "http-requests", "name": "http · requests",
          "description": "Schemas that decode every inbound HTTP request.",
          "globs": ["src/http/requests/**"] },
        { "id": "docs", "name": "docs",
          "description": "User-facing documentation pages.",
          "globs": ["docs/**", "*.md"] }
      ] }

    Normative: exactly the keys `$schema`, `body`, `parts`, all required; `parts` a list, possibly empty; each part exactly `id`, `name`, `description`, `globs`, all required; `id` unique within the report; `globs` non-empty, relative to the working-tree root; no model or effort anywhere. The request is unchanged: `{ $schema, files }`. Indicative: the release in the URL.

### config: phax.json assignments — normative

    "assignments": [
      { "kind": "part",  "part": "core-decide",
        "model": "claude-opus-5-5",   "effort": { "min": "medium", "max": "high" } },
      { "kind": "globs", "globs": ["src/*/schemas/**"],
        "model": "claude-sonnet-5-5", "effort": { "min": "medium", "max": "high" } },
      { "kind": "part",  "part": "docs",
        "model": "claude-haiku-5-5",  "effort": { "min": "low",    "max": "medium" } }
    ]

    Ordered from most to least demanding: the first bound that matches any planned file governs the phase.

    Normative: the key `assignments`, accepted in phax.json only (refused in phax.local.json and ~/.phax/config.json); absent means no bounds, and present means non-empty; the two variants by `kind` (`part` | `globs`), each with exactly its keys and all of them required; `effort.min` and `effort.max` drawn from phax's effort vocabulary (the plan's). Indicative: none.

### cli: phax architecture [path]... — normative

before:

    $ phax architecture
    # Architecture — acme-billing

    Three parts. `src/core` decides; …
    $? = 0

    $ phax architecture            # no provider configured
    No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.
    $? = 1

after:

    $ phax architecture
    # Architecture — acme-billing

    `src/core` decides and imports nothing outside itself. …

    ## Parts

    ### core · decide (`core-decide`)
    Pure functions that decide a command against the current state.
    - `src/core/decide/**`

    ### http · requests (`http-requests`)
    …

    ## Bounds (phax.json `assignments`; the first match governs)

    - assignments[0] part core-decide (`src/core/decide/**`): claude-opus-5-5, medium–high
    - assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high
    - assignments[2] part docs (`docs/**`, `*.md`): claude-haiku-5-5, low–medium
    $? = 0

    $ phax architecture            # no provider configured, bounds declared
    No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.

    ## Bounds (phax.json `assignments`; the first match governs)

    - assignments[0] part core-decide (unresolved: no architecture provider): claude-opus-5-5, medium–high
    - assignments[1] globs `src/*/schemas/**`: claude-sonnet-5-5, medium–high
    - assignments[2] part docs (unresolved: no architecture provider): claude-haiku-5-5, low–medium
    $? = 1

    $ phax architecture            # provider printed { $schema, body } with no parts
    ✗ architecture provider: not an architecture report (https://docs.phax.run/schemas/architecture-report/0.26.0.json): parts is missing
    $? = 1

    Normative: the report rendered to Markdown, body first and then the parts; the bounds after the parts, in list order, each named `assignments[N]`, only when bounds are declared; without a provider and with no bounds, the single no-provider line, exit 1, as today; with bounds, that line followed by the bounds, exit 1. Indicative: headings, layout and wording; how a part bound whose part a path-scoped report does not carry is shown.

### cli: phax validate — indicative

before:

    $ phax validate
    ✓ config is valid (project: acme-billing)
      …
    $? = 0

after:

    $ phax validate
    ✓ config is valid (project: acme-billing)
      …
      3 assignment bounds (2 part, 1 globs)
    $? = 0

    $ phax validate
    Config validation failed: assignments[0].effort: min "high" comes after max "medium" for claude-opus-5-5
      at: phax.json
    $? = 2

    $ phax validate
    Config validation failed: assignments[1].model: claude-opus-9 is not in the catalog
      at: phax.json
    $? = 2

    $ phax validate            # assignments declared in phax.local.json
    Config validation failed: "assignments" is accepted only in phax.json
      at: phax.local.json
    $? = 2

    Normative in the criteria: exit 2, naming the file, `assignments[N]` and the field. Indicative: the wording and the count line.

### file: plan document phase (`phax artifact schema plan`) — normative

before:

    { "id": "phase-02", "title": "Decide refunds", …, "commit": { "subject": "…", "body": "…" },
      "modelReason": "Renames the decider's inputs only; no decision logic changes.",
      "model": "claude-sonnet-5-5",
      "effort": "medium" }

after:

    { "id": "phase-02", "title": "Decide refunds", …, "commit": { "subject": "…", "body": "…" },
      "assignmentReason": "Renames the decider's inputs only; no decision logic changes.",
      "model": "claude-sonnet-5-5",
      "effort": "medium" }

    { "id": "phase-03", …, "assignmentReason": null, "model": "claude-opus-5-5", "effort": "medium" }

    Normative: `assignmentReason` is required, a non-empty string or null; `modelReason` is gone and refused as an unknown key; `assignmentReason`, `model` and `effort` are the last three keys, in that order, in both `properties` and `required`; not extracted, so `phax-plan.json` is unchanged by this spec. Indicative: the order of the other keys, including where `mode` (interactive-phases) and `oracle` (oracle-phases) sit, which the joint phase-shape session arbitrates.

### file: plan.md phase header lines — normative

before:

    ## phase-02 — Decide refunds {#phase-02-decide-refunds}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium
    **Model reason:** Renames the decider's inputs only; no decision logic changes.

after:

    ## phase-02 — Decide refunds {#phase-02-decide-refunds}

    **Recommended model:** claude-sonnet-5-5
    **Recommended effort:** medium
    **Assignment reason:** Renames the decider's inputs only; no decision logic changes.

    Normative: the label `**Assignment reason:**`, present only for a non-null reason, directly under the two model lines; lint reads it from plan.md, so headless and hand-written plans are checked alike; a `**Model reason:**` line is a lint error. No line names the governing bound (per q-render).

### cli: phax plans lint — models findings — indicative

before:

    error    models  phase-02  claude-sonnet-9 / high: not in the catalog (alternatives: claude-sonnet-5-5, …)

after:

    $ phax plans lint docs/plans/2611020930-refunds-plan.md
    error    models  phase-02  claude-sonnet-5-5 / medium: outside assignments[0] (part core-decide: claude-opus-5-5, medium–high) with no **Assignment reason:** line
    warning  models  phase-03  claude-sonnet-5-5 / low: outside assignments[2] (part docs: claude-haiku-5-5, low–medium): "the page embeds a generated table no gate checks"
    warning  models  phase-04  conforms to assignments[1] (globs src/*/schemas/**: claude-sonnet-5-5, medium–high) but carries an **Assignment reason:** line
    warning  models  phase-05  claude-opus-5-5 / high: no bound governs; departs from the policy default (claude-sonnet-5-5 / medium) with no **Assignment reason:** line
    error    models  phase-06  **Model reason:** is no longer read: write **Assignment reason:**
    $? = 1

    $ phax plans lint docs/plans/2611020930-refunds-plan.md     # provider exits 3
    error    models  -         assignments[0] (part core-decide): unresolved: architecture provider exited 3; no phase was compared with the bounds
    error    models  -         assignments[2] (part docs): unresolved: architecture provider exited 3; no phase was compared with the bounds
    $? = 1

    Normative in the criteria: each finding's severity, the `models` check, the phase (or none), the bound as `assignments[N]`, and the quoted reason on a stated departure. Indicative: the wording and the layout.

### file: ~/.phax/authoring/<id>/prompt.md (headless plan authoring) — indicative

before:

    # Headless authoring — output contract

    You are authoring the plan `refunds` in a headless session spawned by `phax artifact new plan --headless`.

    - An architecture provider is configured: before cutting phases, run `phax architecture` …
    - Return ONLY a JSON object …

after:

    # Headless authoring — output contract

    You are authoring the plan `refunds` in a headless session spawned by `phax artifact new plan --headless`.

    - An architecture provider is configured: before cutting phases, run `phax architecture` …
    - Assignment bounds (phax.json `assignments`). The first bound that matches any file a phase plans to create, edit or optionally edit governs it; with none, the policy default (claude-sonnet-5-5 at medium) stands in. A phase conforms when it uses that model at an effort inside the range: set `assignmentReason` to null then, and to why otherwise. A part's globs come from `phax architecture`.
      - assignments[0] part core-decide: claude-opus-5-5, medium–high
      - assignments[1] globs src/*/schemas/**: claude-sonnet-5-5, medium–high
      - assignments[2] part docs: claude-haiku-5-5, low–medium
    - Return ONLY a JSON object …

    With no bounds declared, the bounds bullet reads instead:
    - No assignment bounds are declared: the policy default guides each phase's assignment.

    Normative: one of the two statements in every plan authoring prompt, matching phax.json; the bounds are stated as declared, with no provider run before the session. Indicative: wording and position. Spec authoring prompts are unchanged.

### file: .claude/skills/phax-planning/SKILL.md — Choosing a model and effort — indicative

before:

    - Every phase that leaves the default says why, on the phase: its `modelReason` (headless), or a `**Model reason:**` line under its model and effort (by hand). A phase at the default has no reason: `modelReason: null`, and no line. A departure without a reason, or a default phase with one, is a defect.

after:

    - Read the bounds before you assign: `phax architecture` prints them after the parts, also when it exits 1 with no provider. The first bound that matches any file the phase plans to create, edit or optionally edit governs it. With none, the default above stands in.
    - A phase conforms when it uses its governing bound's model (or the default) at an effort inside the range. A conforming phase has no reason: `assignmentReason: null`, and no line. Any other phase says why, on the phase: its `assignmentReason` (headless), or an `**Assignment reason:**` line under its model and effort (by hand). `phax plans lint` fails an unstated departure from a bound.

    Normative: no `modelReason` or `**Model reason:**` left in the skill; the first-match rule; the default as the fallback; where the bounds are read. Indicative: wording and placement.

### file: docs/upgrading.md — indicative

before:

    ## Release by release

    …

    ### 0.25.0

    - **Spec and plan sidecars move to their current shapes.** …

after:

    ## Release by release

    …

    ### 0.26.0

    - **Plan sidecars: `modelReason` becomes `assignmentReason`.** Run `phax artifact migrate-documents` once in each repository with plans under `docs/`. It renames the key in every live plan sidecar, rewrites the plan's `**Model reason:**` lines as `**Assignment reason:**`, and commits the result. Until then, readers of a plan sidecar refuse and name the command.
    - **Hand-written plans.** Rename each `**Model reason:**` line to `**Assignment reason:**`. `phax plans lint` reports the old label as an error.

    ### 0.25.0
    …

    Normative: the step lives under the release that ships the plan-document change. Indicative: the wording, and whether the joint change with interactive-phases and oracle-phases adds its own bullets to the same entry.

## 7. Non-goals

- A provider that proposes bounds, a planning file separate from phax.json, or a sync command: bounds are written by the owner, in phax.json.
- Ranking, ordering or pricing models: a phase either conforms or departs.
- Escalating a phase's model after a failed gate.
- Changing the planner's own model, `authoring.plan` or its default.
- Changing the architecture request's shape.
- Enforcing bounds in `phax run`, its preflight, extraction, plan approval or authoring: lint is the only check.
- Bounds per workstation: `phax.local.json` and `~/.phax/config.json` refuse `assignments`.
- A name or id on a bound: lint and `phax architecture` name a bound by its position.
- Detecting shadowed or redundant bounds, or reordering bounds for the owner.
- Changing the policy default or the skill's stronger and lighter cases.
- Rewriting the models of existing plans: a plan written before the bounds appear gets lint findings, which are fixed like any other.
- Bringing `phax brief` into plan authoring.

## 8. Acceptance criteria

### The report's parts are rendered

Given `"architecture": { "command": "acme-guard architecture" }` in phax.json and a fake provider printing the §6 architecture report, with no `assignments` declared, when `phax architecture` runs, then stdout holds the body as is, followed by the parts `core · decide` (`core-decide`), `http · requests` (`http-requests`) and `docs` (`docs`), each with its description and globs, in that order; no bounds section is printed; the exit is 0. (refs §5.1, §5.3)

### The report schema requires parts

Given the schemas package, when the `architecture-report` JSON Schema snapshot is read, then it requires `$schema`, `body` and `parts`, and requires each part to carry exactly `id`, `name`, `description` and `globs`, refusing any other key. (refs §5.1)

### A body-only or malformed report is unreadable

Given a configured fake provider that prints `{ $schema, body }` with no `parts`, then one whose two parts share the id `core-decide`, then one whose part carries `"model": "claude-opus-5-5"`, when `phax architecture` runs against each, then each run prints one line naming the architecture provider and the reason (`parts` missing, the repeated id, the unknown key) and exits 1. (refs §5.2)

### The example bounds validate

Given phax.json carrying the §6 `assignments` and the shipped catalog, when `phax validate` runs, then it exits 0 and reports the config valid. (refs §5.4, §5.7)

### Malformed bounds are config errors

Given phax.json whose `assignments[1]` has `"kind": "path"`, then one whose part bound also carries `globs`, then one whose globs bound has `"globs": []`, then `"assignments": []`, when `phax validate` and `phax plans lint docs/plans/2611020930-refunds-plan.md` run against each, then each exits 2 naming phax.json, the bound as `assignments[1]` (or `assignments` for the empty list) and the field. (refs §5.5, §5.4)

### Bounds outside phax.json are refused

Given `assignments` declared in phax.local.json, then in ~/.phax/config.json, with a valid phax.json, when `phax validate` runs, then it exits 2 naming phax.local.json, then ~/.phax/config.json. (refs §5.6)

### phax validate checks bounds against the catalog

Given phax.json whose `assignments[0]` names `claude-opus-9`, then one whose `assignments[0]` is `claude-opus-5-5` with `{ "min": "high", "max": "medium" }`, when `phax validate` runs, then it exits 2 naming `assignments[0]` and the field (`model`, then `effort`), and `phax architecture` with a configured provider still prints the report and exits 0. (refs §5.7)

### An invalid bound is one lint error

Given phax.json whose `assignments[0]` names `claude-opus-9`, and a plan whose phase-02 creates `src/core/decide/refund.ts` at `claude-sonnet-5-5` / `medium` with no reason line, when `phax plans lint` runs, then it reports exactly one `models` error drawn from the bounds, naming `assignments[0]` and `model`, no bound or policy-default finding for phase-02, and exits 1. (refs §5.15)

### The first matching bound governs

Given the §6 bounds, a provider answering the §6 report, and a phase-02 that creates `src/core/decide/refund.ts` and edits `src/http/schemas/refund.ts` at `claude-sonnet-5-5` / `medium` with no `**Assignment reason:**` line, when `phax plans lint` runs, then it reports a `models` error for phase-02 naming `assignments[0]`, not `assignments[1]` (to which it would conform), and exits 1; restated at `claude-opus-5-5` / `medium`, phase-02 gets no `models` finding. (refs §5.8, §5.9, §5.10)

### Optional files count

Given the §6 bounds and report, and a phase whose only file under `src/core/decide/**` is in its optional files, at `claude-sonnet-5-5` / `medium` with no reason line, when `phax plans lint` runs, then it reports a `models` error for the phase naming `assignments[0]`. (refs §5.8, §5.10)

### Effort outside the range departs

Given the §6 bounds and report, and a phase creating `src/core/decide/refund.ts`, when `phax plans lint` runs with the phase at `claude-opus-5-5` / `low`, then at `claude-opus-5-5` / `high`, with no reason line, then the first reports a `models` error naming `assignments[0]`, and the second reports no `models` finding. (refs §5.9, §5.10)

### A stated departure is a warning that quotes the reason

Given the §6 bounds and report, and a phase creating `src/core/decide/refund.ts` at `claude-sonnet-5-5` / `medium` with `**Assignment reason:** Renames the decider's inputs only; no decision logic changes.`, when `phax plans lint` runs, then it reports a `models` warning for the phase naming `assignments[0]` and quoting the reason, no `models` error for it, and exits 0. (refs §5.11)

### A conforming phase with a reason warns

Given the §6 bounds and report, and a phase editing only `src/http/schemas/refund.ts` at `claude-sonnet-5-5` / `high` with an `**Assignment reason:**` line, when `phax plans lint` runs, then it reports a `models` warning for the phase naming `assignments[1]` and exits 0. (refs §5.12)

### Lint asks the provider once for the whole repository

Given the §6 bounds and a fake provider that appends each stdin it receives to a file and prints the §6 report, when `phax plans lint` runs on a plan of three phases, then the provider ran once and received `{"$schema": <an architecture-request URL>, "files": null}`. (refs §5.13)

### An unresolved part bound fails lint and compares nothing

Given the §6 bounds and a plan whose phase-02 creates `src/core/decide/refund.ts` at `claude-sonnet-5-5` / `medium` with no reason line, when `phax plans lint` runs with no `architecture` key in any layer, then with a provider that exits 3, then with a provider whose report carries no `docs` part, then the first two report a `models` error for each of `assignments[0]` and `assignments[2]` naming the cause, the third a `models` error for `assignments[2]` alone, none reports a bound or policy-default finding for phase-02, and each exits 1. (refs §5.14)

### Globs bounds are checked without a provider

Given phax.json declaring only `{ "kind": "globs", "globs": ["src/core/decide/**"], "model": "claude-opus-5-5", "effort": { "min": "medium", "max": "high" } }` and a configured fake provider that records whether it ran, then no `architecture` key, when `phax plans lint` runs on a phase creating `src/core/decide/refund.ts` at `claude-sonnet-5-5` / `medium` with no reason line, then both runs report a `models` error naming `assignments[0]`, and the provider never ran. (refs §5.16)

### The policy default warns where no bound governs

Given no `assignments` in phax.json, then the §6 bounds and report with a phase whose only file is `src/app/main.ts`, when `phax plans lint` runs with the phase at `claude-opus-5-5` / `high` and no reason line, then with a reason line, then at `claude-sonnet-5-5` / `medium` with a reason line, then the first reports a `models` warning naming the policy default, the second no `models` finding, the third a `models` warning naming the policy default, and each exits 0. (refs §5.17, §5.18, §5.8)

### A model-reason line is an error

Given a hand-written plan whose phase-02 carries `**Model reason:** Renames the decider's inputs only.` and no `**Assignment reason:**` line, when `phax plans lint` runs, then it reports a `models` error for phase-02 naming `**Assignment reason:**`, and exits 1. (refs §5.19)

### The plan document carries assignmentReason last

Given the plan document JSON Schema, when `phax artifact schema plan` prints it, then in the phase object, `assignmentReason`, `model` and `effort` are the last three entries of both `properties` and `required`, in that order, `assignmentReason` admits a non-empty string or null, and no `modelReason` appears. (refs §5.20)

### The reason is rendered and not extracted

Given a headless plan document whose phase-02 has `assignmentReason` set and whose phase-03 has `assignmentReason: null`, when phax renders the plan, then `phax run` extracts it on the deterministic path, then phase-02 shows `**Assignment reason:**` with the reason directly under its model and effort lines, phase-03 shows no reason line, and `phax-plan.json` carries both phases' models and efforts and no reason; a copy of the plan with the line removed extracts to the same `phax-plan.json`. (refs §5.21, §5.22)

### A 0.25.0 sidecar is lifted with its reasons

Given a live Draft plan whose sidecar is stamped at the 0.25.0 plan-document shape, with phase-02 carrying `modelReason: "Designs the refund state machine."`, and whose plan.md shows the matching `**Model reason:**` line, when `phax plans lint` reads its sidecar through `phax artifact status`, then `phax artifact migrate-documents` runs, then `phax artifact status` runs, then the first read refuses, naming `phax artifact migrate-documents`; the migration commits the sidecar with phase-02 `assignmentReason: "Designs the refund state machine."` and no `modelReason`, together with plan.md showing `**Assignment reason:** Designs the refund state machine.`; and the final status reports the sidecar in sync. (refs §5.23, §5.25)

### An older sidecar lifts to a null reason

Given a live plan sidecar stamped at the 0.20.0 shape, when `phax artifact migrate-documents` runs, then the rewritten sidecar is at the current shape with `assignmentReason: null` on every phase, and its models and efforts are unchanged. (refs §5.24)

### The prompt carries the bounds

Given the §6 `assignments` in phax.json, then no `assignments`, when `phax artifact new plan refunds --headless --brief brief.md` writes the session's `prompt.md`, then the first prompt lists `assignments[0]` part core-decide `claude-opus-5-5` medium–high, `assignments[1]` globs `src/*/schemas/**` `claude-sonnet-5-5` medium–high and `assignments[2]` part docs `claude-haiku-5-5` low–medium in that order, with the first-match and conformity rules; the second states that no bound is declared and that the policy default guides; and in neither case did phax run the architecture provider before the session. (refs §5.26, §5.27)

### phax architecture shows the bounds after the parts

Given the §6 `assignments` and a configured fake provider printing the §6 report, when `phax architecture` runs, then after the parts, stdout lists `assignments[0]`, `assignments[1]` and `assignments[2]` in that order, the part bounds showing `core · decide` with `src/core/decide/**` and `docs` with `docs/**` and `*.md`, and the exit is 0. (refs §5.28)

### Without a provider the bounds still show

Given the §6 `assignments` and no `architecture` key in any layer, then no `assignments` either, when `phax architecture` runs, then the first prints the no-provider line, then the three bounds with `assignments[0]` and `assignments[2]` marked unresolved, and exits 1; the second prints exactly the one no-provider line and exits 1. (refs §5.29)

### The skill teaches the bounds

Given the shipped phax-planning skill, when its "Choosing a model and effort" and Headless authoring sections are read, then they state the first-match governing bound, the conformity rule, the policy default as the fallback, `assignmentReason` null exactly on a conforming phase, and reading the bounds through `phax architecture` even when it exits 1 with the no-provider line; and the skill contains neither `modelReason` nor `**Model reason:**`. (refs §5.30, §5.31)

### Nothing but lint reads the bounds, and no model is rewritten

Given the §6 `assignments`, an architecture provider that exits 3, and an Approved plan whose phase-02 creates `src/core/decide/refund.ts` at `claude-sonnet-5-5` / `low` with no reason line, when `phax artifact new plan refunds --headless --brief brief.md` runs, `phax run --plan <plan> --dry-run` extracts the Approved plan, and `phax plans lint` and `phax validate` run, then authoring spawns its session and the extraction completes, neither reporting the bounds; plan.md still states `claude-sonnet-5-5` / `low`; `phax-plan.json` carries `claude-sonnet-5-5` / `low` for phase-02; and phax.json's bounds are byte-identical. (refs §5.32, §5.33)

### The upgrade guide names the step

Given docs/upgrading.md in the release that ships the plan-document change, when its entry for that release is read, then it names `phax artifact migrate-documents` for plan sidecars and the rename of `**Model reason:**` lines to `**Assignment reason:**` in hand-written plans. (refs §5.34)

## 9. Open questions

### q-learn — How does the planner learn the bounds, and what does `phax architecture` show when no provider is configured but bounds are declared?

- architecture — Only `phax architecture` shows them: each part with its bound, then the globs bounds; with no provider, the no-provider line followed by the bounds — abandons: The headless planner without a provider: its prompt tells it not to run `phax architecture` (planning-skill-defaults §5.29), so it never sees the globs bounds that apply to it.
- prompt — Only the headless prompt carries the bounds as declared; the skill points an interactive planner at `assignments` in phax.json — abandons: One place where the map and the bounds read together: an interactive planner joins part ids in phax.json to globs in `phax architecture` by hand.
- both — The prompt carries the bounds as declared, and `phax architecture` prints them after the parts, also after its no-provider line — abandons: A single rendering and the one-line no-provider answer: two outputs show the bounds, and `phax architecture` with no provider prints more than its line when bounds are declared, revising planning-skill-defaults §5.24 for that case.

Recommendation: both — Each planner gets the bounds where it already looks. The headless planner reads them in its prompt, as declared, so no provider runs before the session (Q3 of planning-skill-defaults stays pull) and globs bounds reach it with no provider at all. An interactive planner runs `phax architecture` before cutting phases, as the skill already says, and sees each part's globs next to its bound. The no-provider line stays first and the exit stays 1, so an agent still reads it as "carry on". The extra lines appear only in a repository that declared bounds, which is exactly where they are needed.

### q-part — How does `phax plans lint` resolve a part bound, whose globs only the architecture provider knows, and what does it report when the provider is missing, fails, or no longer emits the part?

- spawn-error — Lint runs the architecture provider once (`files: null`) when any part bound exists; an unresolved part bound is a `models` error and no phase is compared with the bounds — abandons: Lint passing on a workstation without the provider: a teammate who has not installed it, or a provider that is down, gets exit 1 on every plan while a part bound exists, until the provider answers or the owner rewrites the bound as globs.
- spawn-warning — Lint runs the provider the same way; an unresolved part bound is a `models` warning, and the bound matches nothing — abandons: The guarantee: lint exits 0 on a plan whose phases were never compared with a part bound, and a later bound silently governs the files the unresolved one would have taken.
- no-spawn — Lint never runs the provider; part bounds are guidance in the prompt and in `phax architecture`, and lint checks globs bounds only — abandons: Holding plans to part bounds at all: the variant that follows the architecture becomes advice, and an owner who wants enforcement must copy the provider's globs into globs bounds.

Recommendation: spawn-error — Lint is the only place bounds are enforced, and failing it stops nothing else: authoring, approval and runs never read the bounds, so autonomy holds. Lint already runs a provider (the plan auditor), and a provider is not a model, so lint stays model-free. Bound order decides which bound governs, so one unresolved bound changes the verdict of every bound below it. That is why lint compares nothing rather than guessing. A teammate without the provider has a local fix: configure it, or ask the owner for a globs bound.

### q-default — When no bound governs a phase, is a departure from the policy default without a reason enforced?

- error — A `models` error, as for a bound — abandons: The owner as the only source of binding choices: phax's own constant fails plans in repositories that declared nothing, and live plans written at the old Opus default fail lint until every phase gains a reason.
- warning — A `models` warning, as is a reason on a phase at the default — abandons: A hard check where no bound governs: a departure with no reason still passes lint, with a warning.
- unchecked — Not checked: the policy stays guidance, as today — abandons: Any visible check of the reason outside the bounds: a repository with no bounds gets no word about an Opus phase that says nothing about why.

Recommendation: warning — The policy default is phax's guidance, not the owner's choice, so under the guiding rule it may inform but not fail a plan. A warning still makes an unstated departure visible in every repository. An owner who wants the default binding writes a last catch-all globs bound (`["**"]` at `claude-sonnet-5-5`, medium–medium). That turns the warning into an error, and the choice is the owner's.

### q-render — Does the plan show a phase's governing bound?

- rendered-line — phax renders a `**Governing bound:**` line beside the model lines in a headless plan — abandons: A plan body that stays true: the line is computed at render time from phax.json and the provider's parts, so it goes stale when either changes. It needs the provider at authoring time, a push planning-skill-defaults Q3 rejected, and hand-written plans lack it.
- lint-only — Only lint names the bound, in each finding — abandons: Seeing in the plan itself what a departure departs from: a reviewer reads the reason on the phase and runs `phax plans lint` to see the bound.

Recommendation: lint-only — Lint computes the governing bound from the current phax.json and parts every time it runs, so its answer cannot be stale. The reason on the phase is the planner's judgment, and it stays meaningful when a bound moves. A rendered line would need its own staleness check (the abandoned spec's §5.18) and a provider run at authoring time.

### q-validate — Where is a bound's `model` (and its efforts) checked against the routing catalog?

- decode — When phax.json is decoded, on every command (exit 2) — abandons: A phax.json that is valid on every workstation: the catalog is read from ~/.phax/model-routing.json, so a bound naming a model one workstation's catalog lacks makes every phax command exit 2 there, `phax run` included.
- validate-and-lint — `phax validate` refuses it (exit 2), and `phax plans lint` reports it as a `models` error; other commands decode only the bound's shape — abandons: A check on every command: `phax run`, `phax architecture` and authoring load a bound naming `claude-opus-9` without a word, until validate or lint runs.
- lint — Only `phax plans lint` checks it — abandons: Catching a typo before any plan is linted: `phax validate` passes a phax.json whose bound names a model no catalog lists.

Recommendation: validate-and-lint — Only lint consumes the bounds, so only lint and the command that exists to check config need the catalog. That keeps the catalog's per-workstation contents from breaking runs, which must stay autonomous. The bound's shape (variant, keys, effort vocabulary) is still refused at decode on every command, so a malformed bound never loads silently.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Decided by the operator on 2026-10-20, not to reopen: (1) the architecture report is `{ $schema, body, parts: [{ id, name, description, globs }] }`, and phax renders it to Markdown on the stdout of `phax architecture`, while the request is unchanged; (2) bounds live in phax.json only, in an ordered `assignments` list of two explicit variants, `part` and `globs`, with no planning file, no sync, no second provider, and no provider that proposes bounds; (3) one conformity rule with no model ranking: the first bound in list order that matches any planned file governs; (4) `modelReason` is renamed `assignmentReason`, rendered `**Assignment reason:**`, still among the phase's last three keys, with the 0.25.0 shape frozen and sidecars lifted by `phax artifact migrate-documents`; (5) in lint's `models` check, an unstated departure is an error and a stated one a warning that quotes the reason.
- This spec revises spec `planning-skill-defaults` Q6 (decided body only on 2026-10-19): the report gains `parts`. It also revises §5.19/§5.20 (the body printed as is becomes the report rendered) and, under q-learn, §5.24's single line when bounds are declared. The headless spec document renders no decision log, so record the Q6 revision in `## 12. Decision log` when this spec's questions are decided.
- The §5 requirements are written under the §9 recommendations: q-learn `both` (prompt-bounds, prompt-no-bounds, arch-shows-bounds, arch-no-provider-bounds, skill-where); q-part `spawn-error` (part-resolve, part-unresolved); q-default `warning` (default-unreasoned, default-reason-on-default); q-render `lint-only` (no governing-bound line); q-validate `validate-and-lint` (validate-catalog, invalid-bound-lint, and shape-only decode in bounds-shape). A different decision revises those requirements, their §6 blocks and their criteria.
- `assignments` is optional at the top level, as every phax.json key is: absent means no bounds. When present it is non-empty, and every key of a bound is required. Bounds effort values use the plan's effort vocabulary, not phax.json's low | medium | high literal.
- Lint reads a phase's reason from its `**Assignment reason:**` line in plan.md, so headless and hand-written plans are checked the same way. Matching covers the create, edit and optional lists. A phase with no planned files (an interactive phase, for example) has no governing bound and falls under the policy default.
- `phax-plan.json`, its schema and runs are unchanged by this spec. Only the plan document and plan.md change.

Left open:

- The glob dialect. It must be the same for globs bounds and report parts, and it must be documented in both JSON Schemas' descriptions. Choose a matcher, or Node's built-in path glob matching.
- The architecture provider's time limit in lint: reuse `phax architecture`'s.
- How `phax architecture <path>...` shows a part bound whose part the path-scoped report does not carry.
- The exact wording of the lint findings, the validate lines, the rendered report and bounds, the prompt bullet and the skill text.
- The position of `mode` (interactive-phases) and `oracle` (oracle-phases) among the phase's keys: the joint phase-shape session arbitrates it.
- Which release carries the joint plan-document change. If it is not 0.26.0, the upgrading step moves with it.

Constraints:

- This spec, `interactive-phases` (per-phase `mode`) and `oracle-phases` (per-phase `oracle`) change the plan document together. They must ship in the same release, with one frozen copy of the 0.25.0 plan-document shape and one lift by `phax artifact migrate-documents`. A joint session arbitrates the phase shape across the three, and `assignmentReason`, `model` and `effort` stay the last three keys.
- The architecture-report change does not depend on the plan-document change and should be planned first. The 0.26.0 cut waits for it. Otherwise the report's body-only shape is cut as 0.26.0, and the change costs a frozen copy and a lift of the report.
- No back-compat shims: `modelReason` is removed and refused as an unknown key in the current shape, an older sidecar is lifted and never read with the key missing, and `**Model reason:**` is a lint error, not an alias.
- Explicit per-variant enums: `kind: "part" | "globs"`, each variant with exactly its keys.
- Respect the layers. Bounds and the report are decoded through schemas at the boundary. Matching, conformity and the choice of the governing bound are pure domain. The provider runs through the Shell port, and the catalog loads through the existing loader. The CLI holds no logic. `assignments` is project-only, like `records`: absent from the user overlay schema and never merged.
- phax stays autonomous: a missing or failing provider never stops a run or authoring, and only lint reports bounds.
- phax never chooses, ranks or rewrites a model: only the planner and the owner write one.
- Fixtures and examples are made up (`acme-guard`, `acme-billing`, `src/core/decide/**`, `refunds`).
- Tests hold across a release cut: assert `$schema` URLs by format id and the release pattern, never by the running version.

## 11. Docs page

Page: Assignment bounds — `assignments` in phax.json

Reader: A repository owner who wants phax plans to spend strong models only where their code needs them, and wants lint to hold planners to that choice, together with the author of an architecture provider (such as acme-guard) who supplies the parts.

Example: Declare the §6 `assignments`: a part bound on `core-decide` at `claude-opus-5-5` medium–high, a globs bound on `src/*/schemas/**`, and a part bound on `docs`. Run `phax architecture` and see the parts, then the bounds. Remove the provider and see the bounds still listed after the no-provider line. Lint a plan: a phase at `claude-sonnet-5-5` under `src/core/decide/**` fails with an error naming `assignments[0]`, and adding an `**Assignment reason:**` line turns it into a warning that quotes the reason. A last catch-all `["**"]` bound makes the policy default binding. A provider prints an architecture report with `parts` beside its `body`.
