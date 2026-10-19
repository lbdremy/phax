---
status: Draft
date: 2026-10-17
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Planning skill defaults — write phases first, assign their model last, and read the repository's own architecture

## 1. Context

The phax-planning skill is what both an interactive planner and a headless plan authoring session read: phax ships it, `phax skills install` copies it, and the headless prompt opens with it verbatim. Its "Choosing a model and effort" section starts from the strongest tier: "The default phase model is `claude-opus-5-5`: it is the cheapest Opus-tier entry and matches or beats `claude-fable-5-1` from `medium` effort up". It keeps `claude-sonnet-5-5` for mechanical phases. The section sits above the generated model-catalog table, but its own prose is hand-written. So a catalog change regenerates the table and can leave the prose naming a model the table no longer lists.

The skill also has the planner pick each phase's model before writing the phase. The plan document a headless planner returns lists `id`, `model` and `effort` first among a phase's keys, before `title`, `objective` and the instructions. A model writes JSON in key order, so it commits to a model before it has written what the model must do. The planner's own model is separate: it comes from `authoring.plan` (default `claude-opus-5-5` at `high`) or from `--model`/`--effort`.

The skill states one architecture as doctrine. "Planning doctrine" traces every need through page → view-model → command → domain → port → adapter → storage and orders the work domain → ports → command → adapter → view-model → view → route. "Test strategy" maps test types to those layers, and "Boundary contracts" names their boundaries.

Providers reach phax as commands declared in `phax.json`. `phax brief [path…]` is the model for a pull. It reads `brief` from the config layers (`phax.json`, `phax.local.json`, `~/.phax/config.json`) of the main checkout. It writes a `$schema`-stamped request on the provider's stdin, has a fixed 60 s limit, and reads a `$schema`-stamped answer. The phase guard allows it inside a phase worktree. With no provider it exits 1. The headless authoring session runs under the review security policy: it may write only `.phax-context/`, has provider-only network, and may run `git` and nothing else.

An experiment outside phax took one ticket and a two-phase plan written once by the headless planner. It executed that plan 24 times with `phax run`, choosing every phase's model itself. On the plan as written, every run at Sonnet 5.5 (half Opus 5.5's cost) and at Haiku 5.5 (a sixth) delivered the ticket and kept the codebase's rules. The one run that broke a rule ran at Opus. With the plan's detailed instructions removed, Haiku broke a rule in two runs of three without a guarantee gate and in none with one. The strong planner's plan carried most of the work, as the planner/executor and architect/editor splits of published practice predict. The author decided the three changes below on 2026-10-17.

Ground read:

- `.claude/skills/phax-planning/SKILL.md` — "Choosing a model and effort" opens with "The default phase model is `claude-opus-5-5`" and keeps Sonnet 5.5 for mechanical phases. "Planning doctrine" states one layer chain (page → view-model → command → domain → port → adapter → storage). "Test strategy (informational)" maps tests to that chain's layers. "Boundary contracts (informational)" lists its boundaries. "Planning constraints" keeps "Comprehensive instructions". "Headless authoring" lists a phase's keys with `model` and `effort` first.
- `scripts/generate-model-catalog.ts` — Renders the model-catalog table from DEFAULT_PROVIDER_CONFIG between the `BEGIN generated: model-catalog` markers of the planning skill. `pnpm check:full` runs it with `--check` and fails on drift. The prose above the table is hand-written.
- `src/domain/skills/catalog.ts` — The six skills `phax skills install` exposes, phax-planning among them, each shipped as its SKILL.md.
- `src/schemas/planDocument.ts` — A plan-document phase spreads the extracted fields (`id`, `model`, `effort`, `planMarkdownAnchor`, planned files, `commit`) first, then the content fields (`title`, `objective`, `detailedInstructions`, …). Every key is required. The preamble already carries `technicalArbitrations`.
- `src/domain/authoring/prompt.ts` — The headless prompt is the skill text verbatim, then the output contract, then the document JSON Schema, then the source spec and the brief. It says nothing about the repository's providers.
- `src/app/authorArtifact.ts` — Spawns the headless session with the `authoring.plan` model and effort (or `--model`/`--effort`), under the review security policy: write access to `.phax-context/` only, provider-only network, and `git` as the only agent command.
- `src/cli/commands/brief.ts` — `phax brief [path…]` reads its config from the main checkout, so `phax.local.json` serves a phase worktree too. With no provider it prints `✗ No brief provider is configured: add "brief": …` and exits 1. A config error exits 2, and a refusal or a failed provider exits 1.
- `src/app/pullBrief.ts` — Builds the brief request (paths relative to the working-tree root, deduplicated, never checked for existence, refused outside the tree), runs the provider from the tree root, and records a pull made inside a phase as `brief-NN.json`.
- `src/app/briefProvider.ts` — Runs the provider with no shell, writes the stamped request on its stdin, and has a fixed 60 s limit. It reads the answer by its own `$schema`, and every failure becomes a one-line reason.
- `src/schemas/brief.ts` — The `brief-request` (`$schema` plus phase facts plus `files`, or `$schema` plus `files` outside a phase) and the `brief-record`.
- `src/schemas/phaxConfig.ts` — `brief: { command, push }` is accepted in `phax.json` and in the user overlay. `authoring.plan` defaults to `claude-opus-5-5` at `high`. `DEFAULT_COMPLIANCE_REVIEW_MODEL` is already `claude-sonnet-5-5`.
- `src/app/loadConfig.ts` — The config layers: `phax.json`, `phax.local.json` beside it, and `~/.phax/config.json`.
- `src/domain/security/phaseGuard.ts` — Inside a phase worktree, every registered command must be classified. `brief` and the read-only commands are allowed, and an unclassified command is refused.
- `src/schemas/schemaUrl.ts` — Every format has an id in FORMAT_IDS and a `$schema` URL `https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json`. New formats join SCHEMA_BORN_FORMAT_IDS.
- `docs/release.md` — Each format's current shape is snapshotted as `next.schema.json` and renamed to the release at the cut. The manifests name the opened version (0.25.0 today).
- `docs/specs/2610171257-phase-model-assignment.md` — Draft. Adds the optional `phax.planning.json` and its lint, and also reorders the plan document and sets the Sonnet default. It is to be reworked to build on this spec and on its `modelReason`.
- `NEXT_STEPS.md` — Every provider request and answer carries `$schema`. phax stays autonomous. "The brief at plan authoring" is still unspecced.

## 2. Problem

phax spends the strongest tier on every phase by default, although a plan written by a strong planner carried lighter executors at a half or a sixth of the cost. The planner also chooses in the wrong order: it picks a model, then writes instructions for it, instead of choosing from what the written phase asks for. In headless authoring, the document's key order forces that wrong order. The default is named in hand-written prose beside a generated catalog, so the next catalog change can leave it pointing at a stale model.

The skill hands every repository one architecture as if it were the planner's doctrine. A repository built otherwise (no view-model, no ports, a different test pyramid) gets phases traced through layers it does not have, with tests mapped to layers that do not exist. The repository's own architecture is the one that should shape the plan. phax has no seam through which a provider that knows that architecture can say so, and the planner is never told where to look for it.

## 3. Product goal

The planner writes each phase first. It then gives the phase a model and effort from what the written phase asks for, starting from `claude-sonnet-5-5` at `medium`. It goes stronger only where the phase must design what the code does not show yet, and lighter where it reproduces a pattern a gate checks, and every departure says why on the phase itself. The skill keeps its planning principle as doctrine and treats its layer chain as one example. The planner reads the repository's own architecture from a provider through `phax architecture` when one is configured, and from the code and its documentation otherwise. A missing provider is not a failure of the repository: the command exits 1 with one line telling the agent to read the code and its documentation instead, and the agent carries on.

> The plan is written by a strong planner against the repository's own architecture; the executor's model is chosen last, from the written phase, and phax never chooses or rewrites it.

## 4. Terminology

- **Default phase assignment** — The model and effort the skill tells the planner to give a phase unless the phase calls for another: `claude-sonnet-5-5` at `medium`. It is guidance to the planner. phax never applies it to a phase.
- **Departure** — A phase whose model or effort differs from the default phase assignment. Every departure carries its reason in the phase's `modelReason`.
- **Model policy** — The skill's rules for choosing a phase's model and effort: the default phase assignment, when to go stronger, when to go lighter, and the reason a departure must carry.
- **Model reason** — `modelReason`, a required key of every plan-document phase, placed just before `model`: why the phase departs from the default phase assignment, or null when it takes the default. A hand-written plan states it as a `**Model reason:**` line.
- **Example architecture** — The skill's layer chain, test-strategy layer table and boundary list, presented as one possible shape of a repository, not as the planner's doctrine.
- **Planning principle** — Plan outside-in, implement inside-out, verify outside-in, stated without naming any layer.
- **Architecture provider** — A command declared as `architecture` in a config layer. phax writes an architecture request on its stdin and reads an architecture report from its stdout.
- **Architecture request** — The `$schema`-stamped document phax sends the architecture provider: `files`, null for the whole repository or the requested paths.
- **Architecture report** — The `$schema`-stamped document the architecture provider prints: a Markdown `body` for the agent to read, and nothing else.

## 5. Functional requirements

### 5.1 Phases are written before they are assigned

The phax-planning skill shall tell the planner to cut and write every phase before choosing that phase's model and effort from what the written phase asks for.

### 5.2 The plan document puts the reason and the assignment last

The plan document JSON Schema shall give each phase a required `modelReason` key, a string or null, and shall place `modelReason`, `model` and `effort` after every other key of the phase, in that order.

### 5.3 Earlier sidecars are lifted

WHEN `phax artifact migrate-documents` meets a plan sidecar stamped before `modelReason` THE system SHALL lift it to the current shape by adding `modelReason: null` to every phase, keeping its phases, models and efforts, and leaving its rendered body unchanged. Until it is lifted, every reader SHALL refuse it as it refuses any sidecar below its format's current shape, naming `phax artifact migrate-documents`.

### 5.4 Sonnet at medium is the default

The skill's model policy shall name `claude-sonnet-5-5` at `medium` as the default phase assignment and shall no longer name `claude-opus-5-5` as the default phase model.

### 5.5 Stronger where the phase designs something new

The skill's model policy shall direct a higher effort, or `claude-opus-5-5`, for a phase that must design something no code in the repository shows yet, such as a new state machine, an adapter to a system the code does not reach yet, or a choice that crosses several parts of the architecture.

### 5.6 Lighter where a pattern exists and a gate checks it

The skill's model policy shall direct `claude-haiku-5-5` for a phase that reproduces a pattern the repository's code already holds and that a configured gate checks.

### 5.7 Every departure says why

The skill's model policy shall require every departure to state its reason on the phase: its `modelReason` in a plan document, or a `**Model reason:**` line in a hand-written plan. It shall forbid, as defects, a departure whose reason is null and a phase at the default assignment whose reason is not null.

### 5.8 Headless departures are reasoned on the phase

The skill's Headless authoring section shall direct the reason of each departure into that phase's `modelReason`, and `modelReason: null` onto every phase at the default assignment, never into `preamble.technicalArbitrations`.

### 5.9 The reason is rendered, not extracted

The system shall render a non-null `modelReason` as a `**Model reason:**` line under the phase's `**Recommended model:**` and `**Recommended effort:**` lines, render no line for a null one, and never extract it into `phax-plan.json`. The deterministic plan parser shall read a plan with or without the line to the same projection.

### 5.10 Detailed instructions stay

The skill shall keep its "Comprehensive instructions" planning constraint.

### 5.11 The planner's own model is unchanged

The system shall spawn headless plan authoring with the model and effort from `--model`/`--effort`, else `authoring.plan`, else the built-in authoring default, as before this spec.

### 5.12 phax never rewrites a stated model

The system shall render, extract and run each phase with exactly the model and effort the planner stated, never substituting the default phase assignment.

### 5.13 The policy's model names follow the catalog

IF the skill's model-policy text differs from the text phax generates from its default phase assignment and the policy's named models THEN `pnpm check:full` SHALL fail.

### 5.14 The policy names only catalog entries

IF a model or effort that the skill's model policy names is absent from the shipped catalog THEN `pnpm check:full` SHALL fail, naming that model or effort.

### 5.15 The planning principle stays doctrine

The skill's Planning doctrine shall state plan outside-in, implement inside-out and verify outside-in without naming any layer.

### 5.16 The layer chain is an example

The skill shall present the layer chain, the test-strategy layer table and the boundary-contract list as one example architecture, to use only where the repository's own architecture matches it.

### 5.17 Where the repository's architecture comes from

The skill shall tell the planner to read the repository's architecture before cutting phases, by running `phax architecture`. When that command exits 1 with its no-provider line, the planner reads the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carries on: that exit is not a failure of the repository.

### 5.18 The architecture provider is configured like brief

WHERE `architecture` is declared in `phax.json`, `phax.local.json` or `~/.phax/config.json` THE system SHALL use its `command` as the architecture provider, merged across layers as `brief` is.

### 5.19 No path asks for the whole repository

WHEN `phax architecture` runs with no path and an architecture provider is configured THE system SHALL send the provider an architecture request whose `files` is null and print the body of its architecture report.

### 5.20 Paths ask for the parts that hold them

WHEN `phax architecture <path>...` runs and an architecture provider is configured THE system SHALL send the provider an architecture request whose `files` lists the paths, relative to the working-tree root, deduplicated, in the order given and never checked for existence, and print the body of its architecture report.

### 5.21 Paths outside the working tree are refused

IF a path given to `phax architecture` resolves outside the working tree THEN the system SHALL exit 1 naming the path, without running the provider.

### 5.22 The request and the report are phax formats

The system shall stamp the architecture request and read the architecture report by their `$schema` URLs, as the formats `architecture-request` and `architecture-report`, and publish both JSON Schemas with every phax format.

### 5.23 A failed provider is one line and exit 1

IF the architecture provider exits non-zero, outruns its time limit, or prints anything that does not decode as an architecture report THEN `phax architecture` SHALL print one line naming the architecture provider and the reason, and exit 1.

### 5.24 No provider: exit 1 with an explanation

IF no architecture provider is configured THEN `phax architecture` SHALL print, on stdout, one line meant for the agent, and exit 1. The line says that none is configured, that the agent should read the architecture from the code and its documentation (README, CLAUDE.md or equivalent), and that this is not a failure of the repository.

### 5.25 phax brief keeps its exit

IF no brief provider is configured THEN `phax brief` SHALL keep its current message and exit 1, the same exit as `phax architecture` without a provider.

### 5.26 Allowed inside a phase worktree

WHILE the current directory is inside a phase worktree THE system SHALL run `phax architecture` as it runs outside one, reading the config of the repository's main checkout.

### 5.27 A pull leaves no trace

The system shall write no file when `phax architecture` runs, inside or outside a phase worktree.

### 5.28 The planner is told a provider exists

WHERE an architecture provider is configured THE system SHALL state in the headless plan authoring prompt that one is configured and that the planner runs `phax architecture`, with no path or with the paths the plan touches, before cutting phases.

### 5.29 The planner is told none exists

WHERE no architecture provider is configured THE system SHALL state in the headless plan authoring prompt that none is configured and that the planner reads the architecture from the code and its documentation instead.

### 5.30 The headless planner may run the command

WHERE an architecture provider is configured THE system SHALL allow the headless plan authoring session to run `phax architecture`.

## 6. Surface

### file: .claude/skills/phax-planning/SKILL.md — Choosing a model and effort — indicative

before:

    ### Choosing a model and effort

    - The default phase model is `claude-opus-5-5`: it is the cheapest Opus-tier entry and matches or beats `claude-fable-5-1` from `medium` effort up.
    - Use `claude-sonnet-5-5` for mechanical phases (catalog/table edits, renames, doc sweeps).
    - Use `claude-fable-5-1` only for a stated reason that Opus 5.5 cannot serve, and record that reason in Technical arbitrations.
    - Use the lowest effort that succeeds. Opus 5.5 is weakest at `low` (below Fable 5.1), so use `medium` or above for phases that need real reasoning.
    - A plan that changes the catalog itself must name only models already in the shipped catalog: …

after:

    ### Choosing a model and effort

    Cut and write every phase first. Choose its model and effort last, from what the written phase asks for.

    <!-- BEGIN generated: phase-model-policy -->
    - Default: `claude-sonnet-5-5` at `medium`.
    - Stronger (a higher effort, or `claude-opus-5-5`): the phase must design something no code in the repository shows yet — a new state machine, an adapter to a system the code does not reach yet, a choice that crosses several parts of the architecture.
    - Lighter (`claude-haiku-5-5`): the phase reproduces a pattern the code already holds, and a configured gate checks it.
    <!-- END generated: phase-model-policy -->

    - Any other catalog model only for a stated reason.
    - Every phase that leaves the default says why, on the phase: its `modelReason` (headless), or a `**Model reason:**` line under its model and effort (by hand). A phase at the default has no reason: `modelReason: null`, and no line. A departure without a reason, or a default phase with one, is a defect.
    - A lighter model needs the detail: see "Comprehensive instructions".
    - A plan that changes the catalog itself must name only models already in the shipped catalog: …

    Normative: the order (write, then assign); the default `claude-sonnet-5-5` at `medium`; the stronger and lighter cases and their models; a reason on every departing phase and none on a default phase; the model names generated, not hand-written (per Q1). Indicative: the wording, the marker name, and the placement of the generated block.

### file: .claude/skills/phax-planning/SKILL.md — Planning doctrine, Test strategy, Boundary contracts — indicative

before:

    ## Planning doctrine

    - **Plan outside-in.** Start from the user-visible need and trace the path it must take through the system (page → view-model → command → domain → port → adapter → storage). …
    - **Implement inside-out.** Order the work core-to-surface (domain → ports → command → adapter → view-model → view → route) …
    - **Verify outside-in.** …

    ## Test strategy (informational)

    Map tests to the layer they exercise …
    | Layer | Preferred test type |
    | Domain | Unit tests | …

after:

    ## Planning doctrine

    - **Plan outside-in.** Start from the need the consumer sees and trace the path it takes through the repository's parts. This is how you discover which files each phase touches.
    - **Implement inside-out.** Order the work from the parts others depend on to the surface, so the surface never claims a behavior the core does not yet provide.
    - **Verify outside-in.** End by checking the consumer-visible behavior end to end, then let the gates confirm it.

    ### The repository's architecture

    Read it before cutting phases. Run `phax architecture` (or `phax architecture <path>...`): with a provider configured it prints the architecture. Without one it exits 1 with one line saying so. That exit means: read the code and its documentation (README, CLAUDE.md or equivalent) instead, and carry on. It is not a failure of the repository.

    ### One example architecture

    A layered application: page → view-model → command → domain → port → adapter → storage, implemented domain → ports → command → adapter → view-model → view → route. Use it only where the repository is built this way.

    ## Test strategy (informational)

    Map tests to the parts of the repository's architecture and pick the cheapest reliable test for each. For the example architecture:
    | Layer | Preferred test type | …   (table unchanged)

    ## Boundary contracts (informational)

    When a phase crosses a boundary of the repository's architecture (in the example: page/cli/surface → view-model, …), …

    Normative: no layer named in the doctrine bullets; the chain, the table and the boundary list marked as the example; the two sources of the repository's architecture, and that the no-provider exit 1 means read the code and docs and carry on. Indicative: headings and wording.

### file: plan document phase (`phax artifact schema plan`) — normative

before:

    { "id": "phase-02", "model": "claude-opus-5-5", "effort": "high",
      "planMarkdownAnchor": "#phase-02-invoice-totals",
      "plannedFilesToCreate": ["src/billing/totals.ts"], "plannedFilesToEdit": [], "optionalFilesToEdit": [],
      "commit": { "subject": "…", "body": "…" },
      "title": "Invoice totals", "objective": "…", "detailedInstructions": ["…"], …, "expectedHandoff": "…" }

after:

    { "id": "phase-02", "title": "Invoice totals", "objective": "…", "detailedInstructions": ["…"],
      "planMarkdownAnchor": "#phase-02-invoice-totals",
      "plannedFilesToCreate": ["src/billing/totals.ts"], "plannedFilesToEdit": [], "optionalFilesToEdit": [],
      …, "expectedHandoff": "…", "commit": { "subject": "…", "body": "…" },
      "modelReason": null,
      "model": "claude-sonnet-5-5",
      "effort": "medium" }

    { "id": "phase-03", "title": "Invoice state machine", …,
      "modelReason": "Designs the invoice state machine, which no code in the repository shows yet.",
      "model": "claude-opus-5-5",
      "effort": "high" }

    rendered under phase-03's heading:

        **Recommended model:** claude-opus-5-5
        **Recommended effort:** high
        **Model reason:** Designs the invoice state machine, which no code in the repository shows yet.

    Normative: `modelReason` is required, a string or null; `modelReason`, `model` and `effort` are the last three keys of a phase, in that order, in the JSON Schema's `properties` and `required`. A non-null reason renders as a `**Model reason:**` line under the model and effort lines, and a null one renders nothing. `modelReason` is not extracted: the projection and `phax-plan.json` are unchanged. A sidecar stamped earlier is lifted by `phax artifact migrate-documents` with `modelReason: null`. Indicative: the order of the other keys.

### config: architecture — normative

    "architecture": { "command": "acme-guard architecture" }

    Accepted in `phax.json`, `phax.local.json` and `~/.phax/config.json`, merged as `brief` is. `command` is required and split on whitespace with no shell. No other key. Normative: the key `architecture` and its single required key `command`.

### cli: phax architecture [path]... — normative

    $ phax architecture
    # Architecture — acme-billing

    Three parts. `src/core` decides; it imports nothing outside itself. `src/http` decodes requests and calls `src/core`. `src/store` persists what `src/core` returns. …
    $? = 0

    $ phax architecture src/core/billing/totals.ts
    ## src/core

    Pure functions over invoices. …
    $? = 0

    $ phax architecture            # no provider configured
    No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.
    $? = 1

    $ phax architecture
    ✗ architecture provider exited 3: acme-guard: no standard found
    $? = 1

    $ phax architecture
    ✗ architecture provider: not an architecture report (https://docs.phax.run/schemas/architecture-report/0.25.0.json): body is missing
    $? = 1

    $ phax architecture ../elsewhere
    ✗ phax architecture: ../elsewhere is outside the working tree
    $? = 1

    Normative: the invocation, with paths optional and relative to the current directory; the report body printed as is on stdout; exit 1 with one stdout line meant for the agent when no provider is configured, as `phax brief` exits 1; exit 1 on a failed provider, an unreadable answer or a path outside the tree; exit 2 on a config error, as `phax brief`; allowed inside a phase worktree. Indicative: the wording of each line. `phax --usage` gains `cmd "architecture"`, whose long help carries the request and report contract.

### file: architecture-request (the provider's stdin) — normative

    { "$schema": "https://docs.phax.run/schemas/architecture-request/0.25.0.json", "files": null }

    { "$schema": "https://docs.phax.run/schemas/architecture-request/0.25.0.json",
      "files": ["src/core/billing/totals.ts", "src/http"] }

    Normative: the format id `architecture-request`; exactly the keys `$schema` and `files`; `files` is null (the whole repository) or a non-empty list of working-tree-root-relative paths, deduplicated, in the order given, never checked for existence. No phase facts, inside a phase or outside it. Indicative: the release in the URL.

### file: architecture-report (the provider's stdout) — normative

    { "$schema": "https://docs.phax.run/schemas/architecture-report/0.25.0.json",
      "body": "# Architecture — acme-billing\n\nThree parts. `src/core` decides; …" }

    Normative: the format id `architecture-report`; exactly the keys `$schema` and `body`, any other key refused; `body` is a non-empty Markdown string that phax prints as is and never parses. A provider that declines to answer exits non-zero. Indicative: the release in the URL.

### file: ~/.phax/authoring/<id>/prompt.md (headless plan authoring) — indicative

before:

    # Headless authoring — output contract

    You are authoring the plan `invoice-totals` in a headless session spawned by `phax artifact new plan --headless`.

    - Return ONLY a JSON object …

after:

    # Headless authoring — output contract

    You are authoring the plan `invoice-totals` in a headless session spawned by `phax artifact new plan --headless`.

    - An architecture provider is configured: before cutting phases, run `phax architecture` (or `phax architecture <path>...` for the parts the plan touches) and plan against its answer.
    - Return ONLY a JSON object …

    With no provider, the first bullet reads instead:
    - No architecture provider is configured: do not run `phax architecture`; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).

    Normative: one of the two statements is present in every plan authoring prompt, matching the config. Indicative: wording and position. Spec authoring prompts are unchanged.

## 7. Non-goals

- The optional planning file `phax.planning.json`, its sync and its lint, and any lint check of the default or of departure reasons: the `phase-model-assignment` spec, which builds on `modelReason` rather than replacing it.
- Raising a phase's model after a failed gate (a cascade).
- What a provider puts in an architecture report beyond a Markdown body: parts, guarantees, dependency order, or any structure phax would read.
- Pushing the architecture into a phase's prompt or into the authoring prompt. The planner and phases pull it.
- Recording `phax architecture` calls in a phase folder or in `records explain`.
- Changing the planner's own model, `authoring.plan` or its default.
- Changing `phax brief`'s behaviour, its no-provider exit included (see Q4).
- Changing the spec authoring prompt or the phax-spec skill.
- Rewriting the models of plans written before this spec, or moving where a rendered plan shows `**Recommended model:**` and `**Recommended effort:**`.
- Bringing the brief into plan authoring ("the brief at plan authoring" in NEXT_STEPS).

## 8. Acceptance criteria

### The skill assigns after it writes

Given the shipped phax-planning skill, when its "Choosing a model and effort" section is read, then it tells the planner to cut and write every phase first and to choose its model and effort last, from what the written phase asks for. (refs §5.1)

### The plan document puts the reason and the assignment last

Given the plan document JSON Schema, when `phax artifact schema plan` prints it, then in the phase object, `modelReason`, `model` and `effort` are the last three entries of both `properties` and `required`, in that order, and `modelReason` admits a string or null. (refs §5.2)

### A sidecar from before `modelReason` is lifted

Given a plan sidecar written before this spec, with phase-01 at `claude-opus-5-5` / `high` and model and effort listed first, when `phax plans lint` reads it, then `phax artifact migrate-documents` runs, then `phax plans lint` and `phax run`'s extraction read it, then the first read refuses it, naming `phax artifact migrate-documents`. After the migration, every phase carries `modelReason: null`, phase-01 keeps `claude-opus-5-5` / `high` in `phax-plan.json`, and the rendered body is unchanged, so `artifact status` reports the sidecar in sync. (refs §5.3)

### Sonnet at medium is the named default

Given the shipped skill, when its model policy is read, then it names `claude-sonnet-5-5` at `medium` as the default and no longer calls `claude-opus-5-5` the default phase model. (refs §5.4)

### The policy names when to go stronger and lighter

Given the shipped skill, when its model policy is read, then it directs a higher effort or `claude-opus-5-5` for a phase that designs something no code in the repository shows yet (naming a new state machine, an adapter to a system not yet reached, and a choice across several parts), and `claude-haiku-5-5` for a phase that reproduces an existing pattern a configured gate checks. (refs §5.5, §5.6)

### Departures carry a reason

Given the shipped skill, when its model policy and Headless authoring section are read, then the policy requires a reason on every departing phase and none on a default phase, and names both mismatches as defects. The Headless authoring section directs each departure's reason into the phase's `modelReason`, `null` on a default phase, and nothing into `preamble.technicalArbitrations`. (refs §5.7, §5.8)

### A model-reason line does not change the projection

Given two hand-written plans identical except that one carries a `**Model reason:**` line under phase-02's model and effort lines, when `phax plans lint` reads both and `phax run`'s extraction parses both on the deterministic path, then both lint with no structure error and project to the same `phax-plan.json`. (refs §5.9)

### Comprehensive instructions stay

Given the shipped skill, when its Planning constraints are read, then the "Comprehensive instructions" constraint is present. (refs §5.10)

### The planner keeps its configured model

Given `authoring.plan` set to `claude-opus-5-5` at `high`, when `phax artifact new plan invoice-totals --headless --brief brief.md` runs, then the session is spawned with `claude-opus-5-5` at `high`, and with `--model claude-sonnet-5-5 --effort medium` it is spawned with those instead. (refs §5.11)

### A stated model survives render and extraction

Given a headless plan document whose phase-02 states `claude-haiku-5-5` / `low` with a `modelReason`, and whose phase-03 states `claude-sonnet-5-5` / `medium` with `modelReason: null`, when phax renders the plan and `phax run` extracts it, then plan.md shows `claude-haiku-5-5` / `low` and a `**Model reason:**` line under phase-02's heading, and `claude-sonnet-5-5` / `medium` with no reason line under phase-03's. `phax-plan.json` carries the same models and efforts, and no `modelReason`. (refs §5.12, §5.9)

### Hand-edited policy names fail the check

Given the skill's generated model-policy block edited by hand to name `claude-sonnet-5` as the default, when `pnpm check:full` runs, then it fails, naming the planning skill's stale model-policy block. (refs §5.13)

### A policy model absent from the catalog fails the check

Given phax's default phase assignment set to a model id the shipped catalog does not list, such as `claude-sonnet-9`, when `pnpm check:full` runs, then it fails, naming `claude-sonnet-9`. (refs §5.14)

### The doctrine names no layer

Given the shipped skill, when its Planning doctrine bullets are read, then they state plan outside-in, implement inside-out and verify outside-in, and none of them contains `view-model`, `port`, `adapter` or `domain`. (refs §5.15)

### The layer chain is marked as an example

Given the shipped skill, when it is read, then the layer chain page → view-model → command → domain → port → adapter → storage, the test-strategy layer table and the boundary-contract list each appear under or beside a statement that they are one example architecture. (refs §5.16)

### The skill says where the architecture comes from

Given the shipped skill, when it is read, then it tells the planner to read the repository's architecture before cutting phases by running `phax architecture`, and that an exit 1 with the no-provider line means read the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on, not a failure. (refs §5.17)

### No path asks for the whole repository

Given `"architecture": { "command": "acme-guard architecture" }` in `phax.json`, with a fake provider that saves its stdin and prints a valid report whose body is `# Architecture — acme-billing`, when `phax architecture` runs, then the provider received `{"$schema": <an architecture-request URL>, "files": null}`, stdout is the body, and the exit is 0. (refs §5.18, §5.19, §5.22)

### A provider in phax.local.json is used

Given `architecture` declared only in `phax.local.json`, when `phax architecture` runs, then that provider is asked and its body printed. (refs §5.18)

### Paths are sent relative to the tree root

Given a configured fake provider, and a current directory of `src` inside the working tree, when `phax architecture core/billing/totals.ts core/billing/totals.ts http/missing.ts` runs, then the request's `files` is `["src/core/billing/totals.ts", "src/http/missing.ts"]` and the body is printed with exit 0. (refs §5.20)

### A path outside the tree is refused

Given a configured fake provider, when `phax architecture ../elsewhere` runs, then it exits 1 naming `../elsewhere`, and the provider was never run. (refs §5.21)

### Both formats are published

Given the schemas package, when its format snapshots are listed, then `architecture-request` and `architecture-report` each have a JSON Schema snapshot, and the report schema refuses a document with a key other than `$schema` and `body`. (refs §5.22)

### A failing or malformed provider is one line and exit 1

Given a configured provider that exits 3, then one that prints `{"body": "x"}` with no `$schema`, then one that sleeps past the time limit, when `phax architecture` runs against each, then each run prints one line naming the architecture provider and the reason (the exit code, the missing `$schema` naming the architecture-report URL, the time limit) and exits 1. (refs §5.23)

### No provider: exit 1 with an explanation

Given no `architecture` key in any config layer, when `phax architecture` runs, then stdout holds exactly one line saying no architecture provider is configured, naming the code and its documentation (README, CLAUDE.md) as where to read the architecture, and saying this is not a failure of the repository. stderr is empty, and the exit is 1. (refs §5.24)

### phax brief still exits 1 without a provider

Given no `brief` key in any config layer, when `phax brief src/a.ts` runs, then it prints `✗ No brief provider is configured: …` and exits 1, as before this spec. (refs §5.25)

### Allowed in a phase worktree, with no trace

Given a phase worktree (a linked worktree whose root holds `.phax-context/`) of a repository whose `phax.local.json` declares a fake architecture provider, when `phax architecture src/core` runs from inside it, then the phase guard lets it run, the provider's body is printed with exit 0, and the worktree and the run folder hold no new or changed file. (refs §5.26, §5.27)

### The prompt says a provider is configured

Given `architecture` declared in `phax.json`, when `phax artifact new plan invoice-totals --headless --brief brief.md` writes the session's `prompt.md`, then the prompt states that an architecture provider is configured and that the planner runs `phax architecture` before cutting phases. (refs §5.28)

### The prompt says none is configured

Given no `architecture` key in any config layer, when `phax artifact new plan invoice-totals --headless --brief brief.md` writes the session's `prompt.md`, then the prompt states that no architecture provider is configured and that the planner reads the code and its documentation instead, and it does not ask the planner to run `phax architecture`. (refs §5.29)

### The headless planner may run the command

Given `architecture` declared in `phax.json` and a secure security profile, when headless plan authoring spawns its session, then the session's agent commands admit `phax architecture`, and with no `architecture` key they are the same as before this spec. (refs §5.30)

## 9. Open questions

None.

## 9b. Arbitrated questions

### Q1 — How does the skill name the default phase assignment and the policy's models, so that a catalog change cannot leave them stale?

- generated — A generated block in the skill, rendered from one phax constant (default model and effort, stronger and lighter models), with the constant checked against the catalog by the existing `gen:model-catalog --check` step of `pnpm check:full` — abandons: Hand-editable prose: changing the default means changing code and regenerating, and the default becomes a phax constant that the later `phase-model-assignment` built-in default must reuse rather than restate.
- hand-checked — Hand-written prose naming the ids, plus a test that every model id the prose names is in the catalog — abandons: Catching a stale default: when a newer Sonnet joins and the old one stays listed, the prose still passes while pointing at the older model.
- family-names — Name families, not ids ("the newest active claude-sonnet entry") — abandons: A concrete id the planner can copy: each planner resolves the family to an id itself, two planners can pick differently, and a non-Claude catalog has no "sonnet".

Recommendation: generated — The catalog table is already generated and drift-checked in `pnpm check:full`. Putting the policy's model names behind the same mechanism makes the catalog the single source of truth. A hand edit or a missing model then fails the check instead of shipping. The cost is a constant in code, which `phase-model-assignment` needs anyway for its built-in default.

Decision: generated — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: the policy's model names are generated from one phax constant and drift-checked with the catalog in `pnpm check:full`. Advocate: Hand-written prose stays editable by anyone, with no generator to change, and a test can still catch an id missing from the catalog. Principles: none. Reversibility: cheap. Revised: none.

### Q2 — Where does a headless phase that leaves the default state why?

- arbitrations — In `preamble.technicalArbitrations`, one entry per departing phase naming its id, model and effort, and the reason — abandons: A checkable link: nothing mechanical tells a departure without a reason from one with, and the reason is written away from its phase.
- phase-field — A new required per-phase key `modelReason` (a string, or null on the default), placed before `model` — abandons: Shape stability ahead of `phase-model-assignment`, which will replace it with its `assignment` block: two plan-document shape changes in a row for one concern.

Recommendation: arbitrations — This spec steers the planner, and lint does not check the reason (that is `phase-model-assignment`'s job, with its own per-phase block). The preamble already holds cross-phase decisions and is required. Adding a field now that the next spec replaces would churn a persisted format for no check that reads it.

Decision: phase-field — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, against the recommendation (arbitrations). The reason belongs on the phase it explains, where a reader and a later lint find it beside the model it justifies. `modelReason` is required, a string or null, just before `model`. It is rendered as a `**Model reason:**` line and not extracted. `phase-model-assignment` builds on it rather than replacing it, so there is one shape change, and earlier sidecars are lifted by `migrate-documents` with `modelReason: null`. Advocate: Technical arbitrations already hold cross-phase decisions and need no format change: no persisted shape moves now, ahead of a spec that may restructure the phase again. Principles: none. Reversibility: costly. Revised: §3, §4, §5.2, §5.3, §5.7, §5.8, §5.9, §6, §7, §8, §10.

### Q3 — How does the headless planner reach the architecture?

- pull — Pull: the prompt says whether a provider is configured, and the session may run `phax architecture` when one is — abandons: The authoring session's narrow jail: today it runs only `git`. It now runs a command that spawns a provider inside the session's read-only filesystem and provider-only network, which a provider that writes a cache or reaches the network will not survive.
- push — Push: phax queries the provider once, for the whole repository, before spawning the session, and puts the body in the prompt — abandons: Asking for the parts the plan touches: the planner gets one whole-repository answer it cannot narrow. The prompt grows by that answer for every plan, and this departs from the author's stated design.

Recommendation: pull — The author chose pull. It keeps one path to the architecture for interactive planners, headless planners and phases, and lets the planner ask about the parts it is cutting. The jail's limits are a constraint for the provider to meet, stated in the docs page. `phase-model-assignment` widens the same session for `phax brief` on the same terms.

Decision: pull — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: the prompt says whether a provider is configured, and the headless planner pulls with `phax architecture` when one is. Advocate: A push keeps the authoring session's jail as narrow as today, since phax queries the provider before the session and the session runs only `git`. Principles: none. Reversibility: cheap. Revised: none.

### Q4 — Do `phax brief` and `phax architecture` answer a missing provider the same way?

- split — `phax architecture` exits 0 with one stdout line; `phax brief` keeps its exit 1 — abandons: Consistency between two sibling provider commands: the same situation answers 0 from one and 1 from the other.
- both-zero — Both exit 0 with one stdout line — abandons: `phax brief`'s shipped contract before the CLI freeze: a script, gate step or test that reads exit 1 as "no brief provider" starts reading success instead.
- both-one — Both exit 1 — abandons: The author's rule for `phax architecture`: an agent reads exit 1 as a failure and retries or stops, although a missing architecture provider is an ordinary repository.
- both-one-explained — Both exit 1. `phax architecture` prints one stdout line meant for the agent: none is configured, read the architecture from the code and its documentation instead, and this is not a failure of the repository. The skill reads that exit as "read the code and docs, and carry on" — abandons: A zero exit for an ordinary repository: an agent or script that reads any exit 1 as a failure must learn this command's line, and the skill must say it

Recommendation: split — The two commands' callers differ. The skill tells a planner to run `phax architecture` in every repository, so a missing provider there is ordinary and must read as information. A phase is told to run `phax brief` only when the project configures a brief provider, so a missing one there is a misconfiguration worth a non-zero exit. Changing brief's exit would also spend CLI-contract churn just before the freeze for no caller's benefit.

Decision: both-one-explained — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, off the previous menu (against the recommendation, split). Both commands exit 1 without a provider, so the two siblings agree and `phax brief` keeps its shipped contract. `phax architecture` prints one stdout line meant for the agent: none is configured, read the code and its documentation instead, and this is not a failure of the repository. The skill tells the planner that this exit with that line means "read the code and docs, and carry on". The headless prompt still says when none is configured, so a headless planner without a provider is not told to run the command (§5.29). Advocate: An exit 0 lets every agent and script treat a repository with no provider as the ordinary case it is, with nothing to learn about one command's line. Principles: none. Reversibility: cheap. Revised: §3, §5.17, §5.24, §5.25, §6, §8, §10, §11.

### Q5 — Is a `phax architecture` call inside a phase worktree recorded, as a pulled brief is?

- no-record — Not recorded: nothing is written — abandons: The trace of which architecture a phase agent read, which a reviewer could otherwise replay from the phase folder.
- record — Recorded as `architecture-NN.json` beside the brief records, with a new `architecture-record` format — abandons: Minimality of the seam: a third format to version and snapshot, and the brief's collect-and-close machinery duplicated, before any provider says more than a Markdown body.

Recommendation: no-record — The brief asks for the minimal seam. An architecture report informs the plan rather than a phase's compliance, so nothing downstream reads it, and a record format can be added if a consumer appears.

Decision: no-record — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: a `phax architecture` call writes nothing, inside a phase or outside it. Advocate: A record beside the brief records would let a reviewer replay which architecture a phase agent read. Principles: none. Reversibility: cheap. Revised: none.

### Q6 — What shape is the architecture report?

- body — `{ $schema, body }`: one Markdown string phax prints and never parses — abandons: Anything phax could compute from the answer, such as the parts, their paths or their dependency order: a later consumer must parse prose or wait for a new shape.
- structured — `{ $schema, parts: [{ name, paths, guarantees }], order }` — abandons: A seam that exists before any provider says much: every provider must compute parts and an order up front, and phax freezes a structure no consumer reads yet.

Recommendation: body — The only reader today is an agent, which reads Markdown best. Adding structure later is a new shape under the versioned-format rules. Requiring it now would force providers to compute what nobody consumes.

Decision: body — by operator (Rémy Loubradou), 2026-10-19
Why: Decided by the operator on 2026-10-19, as recommended: the report is `{ $schema, body }`, one Markdown string phax prints and never parses. Advocate: A structured report lets phax and later consumers compute parts and an order without parsing prose, and avoids a second shape later. Principles: none. Reversibility: costly. Revised: none.

## 10. Implementation-planning note

Settled:

- The default phase assignment is `claude-sonnet-5-5` at `medium`. Stronger means a higher effort or `claude-opus-5-5` for a phase that designs what the code does not show yet. Lighter means `claude-haiku-5-5` for a phase that reproduces an existing pattern a gate checks. Every departure states its reason in the phase's `modelReason`, and a default phase has `modelReason: null`.
- The planner's own model and `authoring.plan` are untouched. The spec changes what the planner assigns, not the planner.
- The plan document's phase gains a required `modelReason` (a string, or null on the default), and `modelReason`, `model` and `effort` become its last three keys. This is a plan-document format change: the shape is snapshotted, the earlier shape frozen, and earlier sidecars lifted by `phax artifact migrate-documents` with `modelReason: null`. The extracted projection and `phax-plan.json` are unchanged. The rendered Markdown keeps the model lines where they are and gains a `**Model reason:**` line for a non-null reason.
- The planning principle stays doctrine. The layer chain, the test table and the boundary list become one example architecture.
- `phax architecture [path]...` follows `phax brief`: config from the main checkout's layers, stdin request, `$schema`-read answer, no shell, allowed by the phase guard, exit 2 on a config error. Without a provider, both exit 1; `phax architecture` prints one stdout line telling the agent to read the code and its documentation, which is not a failure of the repository.
- Two new schema-born formats, `architecture-request` (`$schema`, `files`) and `architecture-report` (`$schema`, `body`), are snapshotted and published like every format.
- Decided by the operator on 2026-10-19: Q1 generated block; Q2 a per-phase `modelReason`, against the recommendation; Q3 pull with a grant; Q4 both exit 1, `phax architecture` with an explanatory line for the agent, off the previous menu; Q5 no record; Q6 body only.
- The spec ships in two plans. Plan 1 is the skill and plan-document part (§5.1–§5.16, `modelReason` included), without `phax architecture`. In plan 1, the skill's architecture paragraph says to read the code and its documentation. Plan 2 is `phax architecture` (§5.17–§5.30, the two formats and the docs page). It adds the command to that paragraph and carries `completes-spec`.

Left open:

- The architecture provider's time limit: reuse the brief's fixed 60 s, or another fixed value (not a config key).
- How the headless session's grant is expressed (a narrow `phax architecture` allowance), and what the session's read jail must admit for phax to read `~/.phax/config.json` and `phax.local.json` and run the provider.
- The exact wording of the no-provider line, the failure lines, the prompt statements and the skill's new text.
- The name of the generated skill block and whether the existing catalog generator renders it or a sibling does.

Constraints:

- No back-compat shims in persisted schemas: both new formats are born with a required `$schema`, every key is required, and unknown keys are refused.
- Explicit per-variant enums: the request's `files` is null or a non-empty list, with no third form.
- Respect the layers: the provider is spawned through the Shell port and its config read through the existing loader. Building the request and choosing the prompt statement are pure domain. The report is decoded through a schema at the boundary. The CLI command holds no logic.
- phax stays autonomous: a missing or failing architecture provider never stops authoring or a phase, and nothing waits on a person.
- phax never chooses or rewrites a model silently: the default is guidance in the skill, and no step substitutes it for a stated model.
- `phase-model-assignment` overlaps this spec on the reorder and the default (its §5.1, §5.3). Plan this spec first, and rework that spec to build on it, and on `modelReason`, rather than restate or replace it.
- The new command must be classified in the phase guard, or the guard's own test refuses it.
- Fixtures and examples are made up (`acme-guard`, `acme-billing`, `src/core/billing/totals.ts`).
- Tests hold across a release cut: assert `$schema` URLs by format id and the release pattern, never by the running version.
- No back-compat shims for `modelReason`: it is required in the current shape, and an earlier sidecar is lifted, never read with the key missing.

## 11. Docs page

Page: Architecture provider — `phax architecture`

Reader: A repository owner who wants phax planners to plan against their repository's own architecture, and the author of a provider (such as steme) who wants to supply it.

Example: Declare `"architecture": { "command": "acme-guard architecture" }` in `phax.json`. Run `phax architecture` and `phax architecture src/core` and see the provider's Markdown body. Read the architecture-request on the provider's stdin and the minimal architecture-report it must print. Remove the key and see the one-line "none configured" answer with exit 1, which tells the agent to read the code and its documentation instead and carry on. Note the limits a provider runs under inside a headless planning session (read-only filesystem, provider-only network).

## 12. Decision log

- 2026-10-19 Q1 decided generated — operator (Rémy Loubradou)
- 2026-10-19 Q2 decided phase-field — operator (Rémy Loubradou) — revised 11 sections
- 2026-10-19 Q3 decided pull — operator (Rémy Loubradou)
- 2026-10-19 Q4 decided both-one-explained — operator (Rémy Loubradou) — revised 8 sections
- 2026-10-19 Q5 decided no-record — operator (Rémy Loubradou)
- 2026-10-19 Q6 decided body — operator (Rémy Loubradou)
