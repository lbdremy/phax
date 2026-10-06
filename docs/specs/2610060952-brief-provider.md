---
status: Approved
date: 2026-10-06
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-06
  baseline: 806805e
---
# Brief provider — a feed-forward brief of guarantees and their state, pushed into the phase's first prompt and pulled with `phax brief`

## 1. Context

When `drop-orient` and `drop-gate-scopes` have landed, nothing informs a phase agent about the project's standard before the gate judges its work. The first prompt holds the plan, the previous handoff, the current phase and the execution rules. The rules end with the gate commands, which the agent may run itself to check its work. Every extension point shares one contract: a command in `phax.json`, split on whitespace and run without a shell; a JSON request on stdin; a JSON answer on stdout. Failures are typed, and there is an optional wall-clock limit. A provider key such as `planAuditor` is `{command}`, read from phax.local.json, then ~/.phax/config.json, then phax.json.

Spec `gate-request` (Approved) lets a gate step declare `"input": "gate-request"` and read the phase facts on stdin. They are `phase`; `base`, the commit the phase branch started from, stable across attempts, resumes, resets and appends; `terminal`; and `phases`, the plan projection `[{id, files}]`. phax saves a copy beside each attempt. Under `drop-gate-scopes`, every finding a diagnostics step reports fails the step, so the audit alone decides what is due.

The retired orient provider shows what a brief must not be. It answered a list of file names with rows `{id, title, severity, trigger}`, and on expand with a body: the rule in general, never how the code stands. It received no phase, no base and no plan. A pull from inside the worktree carried nothing of the phase, pulls were not recorded, and the query at phase start had no time limit.

The agent works inside the phase worktree, and nothing ties that worktree back to its run. Each worktree has a gitignored `.phax-context/` folder, written by the agent (handoff, summary) and by phax. In `secure` mode the agent may run only the commands that `security.json` grants, with source `config` or `gate`.

The first provider is steme. It plans `steme brief` (roadmap-1.0 item 8, not built), which will read the ledger that `steme audit` builds (item 0.13). The word "brief" already names the prose a person gives a headless authoring session (`--brief <file|->`, kept under `docs/briefs/`). NEXT_STEPS §Road to 1.0.0 freezes the CLI and config contract, and this spec adds surface on purpose before that freeze.

Ground read:

- `docs/briefs/brief-provider.md` — The author's decisions of 2026-10-05/06: the need by moment (before writing, while writing; where the phase stands is the gate commands' job), state not only the rule, one provider and one request for two verbs (`steme brief`, `steme audit`), `phax brief` with or without a path, never blocking, purely additive after `drop-orient`, a hello-world brief provider, steme first. §9 Q1–Q6 decided on 2026-10-05.
- `docs/specs/archive/2610051526-brief-replaces-orient.md` — Abandoned 2026-10-06. Its context, surface and §9 are the ground for this design, minus the retirement of orient, which `drop-orient` now owns. It used exit 2 for `phax brief` usage errors, which README §Exit codes reserves for plan or config validation.
- `docs/briefs/gate-request.md` — The gate request's facts: `{$schema, phase, base, terminal, phases}`. `base` is the commit the phase branch started from, stable across attempts, resumes, resets and appends. `phases` is `[{id, files}]` (create ∪ edit, optional files excluded), every phase of the run in execution order. Only steps declaring `"input": "gate-request"` receive it, and a copy `checks-attempt-NN.request.json` is saved beside each attempt. The re-authored spec was not yet under docs/specs/ in this session, so the facts were read from its brief and from the abandoned `docs/specs/archive/2610051439-gate-request.md`.
- `docs/briefs/drop-orient.md` — orient, `phax orient`, its prompt section, `orient-brief.json`, the `orient` grant source and its telemetry are removed with no shim. The `security.json` grant source becomes `config | gate`. A leftover `orient` key is an ordinary unknown key.
- `docs/briefs/drop-gate-scopes.md` — Every finding a diagnostics step reports fails the step, so the audit alone decides what is due. A finding's location is `{file, line?}`. The hello-world example loses `scopes.mjs`.
- `src/app/providerQuery.ts` — The contract every extension point shares: the command is split on whitespace with no shell, JSON goes on stdin, exit 0 with JSON on stdout is expected, and failures are typed (exit code, stderr excerpt, invalid JSON, schema failure). There is an optional `timeoutMs`.
- `src/app/executePlan.ts` — A fresh phase start sets up the branch and worktree, then builds the first prompt. A resume reuses both and builds no prompt. As drop-orient leaves it, nothing is queried at phase start.
- `src/app/promptGeneration.ts` — The first prompt runs: plan, previous handoff, reconciliation, `## Current phase`, `## Execution rules` (which ends with the gate commands the agent may run itself), `## Required output`. As drop-orient leaves it, there is no section between `## Current phase` and `## Execution rules`.
- `src/app/worktree.ts` — Nothing ties a worktree back to its run. Each worktree has a gitignored `.phax-context/` folder (PHAX_CONTEXT_DIR), written by the agent (handoff, summary) and by phax.
- `src/domain/config/mergeLayers.ts` — Provider keys such as `planAuditor` are `{command}`, taken from phax.local.json, then ~/.phax/config.json, then phax.json.
- `src/schemas/securityPosture.ts` — A granted agent command records `source`. After drop-orient the values are `config | gate`. `security.json` is phax-internal, not a `@lbdremy/phax-schemas` format.
- `src/cli/commands/records.ts` — `phax records explain` has the flags `--prompt`, `--diff`, `--transcript` and `--gates`. Every file in the phase folder rides the phase record.
- `README.md` — §Extend phax counts the hooks. §Persisted formats has the format table. §Exit codes: 1 is generic failure (refusal, bad arguments), 2 is plan or config validation. Headless authoring uses `phax artifact new spec|plan … --headless --brief <file|->`.
- `examples/hello-world/` — phax.json plus one small script per hook (`audit.mjs`, `audit-plan.mjs`). tests/integration/exampleProviders.test.ts runs them.
- `NEXT_STEPS.md` — §Before steme's audit: drop-orient, drop-gate-scopes, gate-request, then the brief. §Road to 1.0.0: the CLI and config contract freeze.

## 2. Problem

A phase agent writes without knowing what the project's standard expects. It learns that only from the audit's findings after its turn, in the fix loop, where each lesson costs an attempt. Before writing, it cannot tell which guarantees range over the files it plans to touch, which of them are due in this phase and which later, what already breaks them, and what is accepted debt to leave alone. While writing, it touches files the plan did not predict and creates files that do not exist yet, and it has nobody to ask about them.

A provider that knows the answers, such as steme with its ledger, has no channel to tell the agent. A channel built on file names alone, as orient was, would not be enough. Without the phase, its base and the plan, the provider cannot say what is due. Its advice could also contradict the audit, which judges the same phase from different inputs. If the channel is not recorded, a run cannot be explained by what the agent was told. If it can stall or fail the phase, it becomes a second gate that nobody asked for.

## 3. Product goal

A brief tells the agent what the project's standard expects of the paths it is about to touch, and how each expectation stands there. For each guarantee and place it gives the state (met, missing, forbidden or accepted debt), what is wrong, the repair, and whether the place is due in this phase or later. phax pushes the phase's brief, in compact form, into the first prompt. The agent pulls more with `phax brief` on any path, planned or not, existing or not, and gets the whole form. The brief provider receives the same phase facts that the audit receives in the gate request, plus the paths asked about. The provider's two verbs (`steme brief`, `steme audit`) therefore read one account of the phase and cannot disagree. Every brief, pushed or pulled, is recorded with the phase. A brief never blocks: when the provider fails, is too slow or has nothing to say, phax reports it and the phase goes on.

> A brief informs and the audit decides: phax carries the phase's facts to the provider and its answer to the agent, and it judges, ranks and filters nothing in between.

## 4. Terminology

- **Brief** — The brief provider's answer about a set of paths: the guarantees that range over them, and the state of each guarantee at each place. It feeds forward and only informs. It never fails, blocks or retries anything.
- **Audit** — The gate's diagnostics step (for steme, `steme audit` declaring `"input": "gate-request"`). It blocks: its findings fail the gate. This spec does not change it.
- **Brief provider** — The command configured under `brief`. It reads a brief request on stdin and prints a brief answer on stdout.
- **Pushed brief** — The phase's brief. phax requests it once, when a phase starts fresh, and weaves its compact form into the phase's first prompt.
- **Pulled brief** — A brief the agent asks for with `phax brief`. phax prints it in whole form.
- **Phase facts** — The keys `phase`, `base`, `terminal` and `phases`, with the values and meanings that the gate request of the same phase carries (spec `gate-request`).
- **Brief request** — The JSON document on the provider's stdin, in the persisted format `brief-request`. Inside a phase it holds `$schema`, the phase facts and `files`. Outside a phase it holds `$schema` and `files` only.
- **Phase request file** — `.phax-context/brief-request.json` in a phase worktree, written by phax. It holds the phase's brief request with `files: null`, and it is how `phax brief` learns which phase it runs in.
- **Working tree root** — The top directory of the phase worktree inside a phase. Outside a phase, the top of the git working tree that contains the current directory. Paths in `files` are relative to it, and the provider runs from it.
- **Guarantee** — One expectation of the project's standard, as the provider knows it: an `id` and a `statement`, with the places it ranges over.
- **Place** — A location `{file, line?}` where a guarantee ranges, with the guarantee's state there. A file that does not exist yet can be a place.
- **State** — `met`: the guarantee holds there. `missing`: something it requires is absent. `forbidden`: something it forbids is present. `accepted`: a known violation recorded as accepted debt, to leave alone.
- **Due** — Carried by a `missing` or `forbidden` place: the provider's word on when the place must be resolved. It is `this-phase`, `later`, or `null` when the request carried no phase facts. phax never computes or checks it.
- **Compact form** — One line per guarantee: its id and statement, then the state, location and due of each place that is not `met`. It omits `what` and repair.
- **Whole form** — Every guarantee with its id and statement, and every place with its state, location, due, `what` and repair where the state has them.
- **Brief time limit** — A fixed wall-clock limit on one brief call. When it passes, phax stops the provider and treats the brief as failed.
- **Brief record** — A file `brief-NN.json` in the phase folder, in the persisted format `brief-record`. It holds one brief call's moment, its request as sent and its outcome. `00` is the pushed brief, and pulled briefs are numbered from `01` in call order.
- **Authoring brief** — The prose a person writes for a headless authoring session (`--brief <file|->`, kept under `docs/briefs/`). It shares one sense with the provider brief: what an agent is given before it writes. A person writes the authoring brief for an authoring agent, while the brief provider computes a provider brief for a phase agent. They share no command, key, file or format. Bringing the provider's brief to the authoring moment, the brief at plan authoring, is a later spec.

## 5. Functional requirements

### 5.1 The `brief` provider key

WHERE `"brief": { "command": … }` is declared in `phax.json`, `phax.local.json` or `~/.phax/config.json` THE system SHALL use that command as the brief provider, a nearer layer overriding a farther one in the order phax.local.json, then ~/.phax/config.json, then phax.json.

### 5.2 How the provider is run

The system shall run the brief provider split on whitespace with no shell, from the working tree root of the call.

### 5.3 One request on stdin

The system shall write exactly one brief request to the brief provider's stdin and then close stdin, for every brief it requests.

### 5.4 The local schemas describe `brief`

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` and a `phax.user.schema.json` that describe the `brief` key, leaving `phax.json` unchanged.

### 5.5 The pushed brief, once per fresh phase start

WHEN a phase starts fresh with a brief provider configured, whether first run, re-run after `phax reset-phase`, or appended by `phax run --append`, THE system SHALL request the pushed brief once, after the phase worktree is ready and before building the phase's first prompt.

### 5.6 No new pushed brief on resume

WHEN a phase is resumed THE system SHALL NOT request the pushed brief again.

### 5.7 The phase facts are the gate request's

WHILE a brief is requested for a phase THE system SHALL put the phase facts in the request, with exactly the values that the gate request of that phase carries.

### 5.8 The phase's brief has `files: null`

WHEN the pushed brief is requested, or `phax brief` runs inside a phase with no path, THE system SHALL send the phase's brief request with `files` set to `null`.

### 5.9 Named paths, existing or not

WHEN `phax brief` runs with one or more paths THE system SHALL set `files` to those paths, resolved against the current directory and made relative to the working tree root, in the order given and without duplicates, sending a path that does not exist exactly as it sends one that does.

### 5.10 Outside a phase, no phase facts

WHEN `phax brief` runs with paths outside a phase THE system SHALL send a request holding only `$schema` and `files`.

### 5.11 Bad arguments

IF `phax brief` runs outside a phase with no path, outside any git working tree, or with a path that resolves outside the working tree root THEN the system SHALL refuse the call with exit 1 and a message naming the problem, without running the provider.

### 5.12 Facts, never a judgement

The system shall put no key in a brief request other than `$schema`, the phase facts and `files`: no state, rank, filter, touched files, diff or judgement.

### 5.13 The phase request file

WHEN a phase starts or resumes with a brief provider configured THE system SHALL write the phase request file into the phase worktree before the agent's turn.

### 5.14 `phax brief` learns its phase from the file

WHEN `phax brief` runs from any directory of a worktree THE system SHALL take the phase facts from that worktree's phase request file, and SHALL treat the call as outside a phase when the worktree has none.

### 5.15 An unreadable phase request file

IF the phase request file exists but does not decode as a brief request THEN `phax brief` SHALL exit 1 with a message naming the file, without running the provider.

### 5.16 The brief answer

The system shall accept as a brief answer only a document `{ "guarantees": [...] }` whose guarantees are `{id, statement, places}` with at least one place, and whose places are, by state, `met` `{location, state}`, `missing` or `forbidden` `{location, state, due, what, repair}`, or `accepted` `{location, state, what}`, ignoring any key beyond these.

### 5.17 The provider's order is the rank

The system shall render and record guarantees and places in the provider's order, never sorting, grouping, filtering or deduplicating them.

### 5.18 The compact form in the first prompt

WHEN the pushed brief is answered THE system SHALL weave its compact form into a `## Brief for this phase` section of the phase's first prompt.

### 5.19 A cap of 50 guarantees on the pushed form

IF the pushed brief holds more than 50 guarantees THEN the system SHALL weave the first 50 and one line that gives the number not shown and names `phax brief`.

### 5.20 The whole form on demand

WHEN `phax brief` receives an answer THE system SHALL print the answer's whole form to stdout and exit 0.

### 5.21 Nothing to report

WHEN an answer holds no guarantee THE system SHALL say that the provider has nothing to report, in the brief section for the pushed brief and on stdout with exit 0 for a pulled brief.

### 5.22 The brief time limit

WHEN the brief provider has not exited within the brief time limit THE system SHALL stop it and treat the brief as failed.

### 5.23 A failed pushed brief does not stop the phase

IF the pushed brief fails (the provider exits non-zero, prints no answer that decodes, or exceeds the brief time limit) THEN the system SHALL warn in the run output naming the phase and the reason, weave the brief section with a line saying the brief is unavailable and why, and run the phase.

### 5.24 A failed pulled brief is reported

IF a pulled brief fails THEN `phax brief` SHALL print the reason on stderr and exit 1.

### 5.25 A brief changes no verdict

The system shall let no brief, brief answer or brief failure change a gate verdict, the fix loop, a phase or run state, or the exit code of `phax run` or `phax resume`.

### 5.26 `phax brief` is granted to the in-phase agent

WHERE a brief provider is configured THE system SHALL allow `phax brief` to the in-phase agent without an `agentCommands` entry, recording the grant in `security.json` with source `brief`.

### 5.27 No provider, no brief in the phase

WHERE no brief provider is configured THE system SHALL weave no brief section, write no phase request file and no brief record, and grant no `phax brief`.

### 5.28 No provider, `phax brief` says so

IF `phax brief` runs with no brief provider configured THEN the system SHALL exit 1 with a message naming the `brief` key.

### 5.29 What the agent is told

WHERE a brief provider is configured THE system SHALL end the brief section with instructions to run `phax brief <path>…` before touching any file, planned or not and existing or not; to run `phax brief` with no path for the phase's brief in whole form; and to run the gate commands listed in the prompt to learn where the phase stands.

### 5.30 The pushed brief is recorded

WHEN the pushed brief is answered or fails THE system SHALL save `brief-00.json` in the phase folder, holding `moment: "pushed"`, the request exactly as sent and the outcome.

### 5.31 Each pulled brief is recorded

WHEN `phax brief` runs inside a phase whose record is not yet written THE system SHALL add to that phase's folder a brief record holding `moment: "pulled"`, the request exactly as sent and the outcome, numbered from `01` in call order across all of the phase's sessions.

### 5.32 What is not recorded

The system shall record nothing for a `phax brief` call made outside a phase or after the phase's record is written.

### 5.33 Two persisted formats

The system shall define `brief-request` and `brief-record` as persisted formats in `@lbdremy/phax-schemas`, each with `$schema` `https://docs.phax.run/schemas/<format>/<release>.json`, a parser (`parseBriefRequest`, `parseBriefRecord`), recognition by `parseDocument`, and a JSON Schema under `json/`.

### 5.34 `records explain` shows the briefs

WHEN `phax records explain <commit> --briefs` runs on a phase record THE system SHALL print each of the phase's brief records in number order, each under its file name.

### 5.35 The docs describe the brief

The system's README (§Extend phax and §Persisted formats), `phax --usage`, CLI reference and generated config schemas shall describe the brief provider, its request and answer, and `phax brief`.

### 5.36 The hello-world example has a brief provider

The hello-world example shall declare a `brief` provider backed by a small static script that answers both the phase's brief and named paths, exercised by the example-provider tests.

## 6. Surface

### config: `brief` provider key in phax.json / phax.local.json / ~/.phax/config.json — normative

before:

    {
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": {
        "standard": [
          { "command": "steme audit", "surface": "structural", "firing": "every-phase",
            "output": "diagnostics", "input": "gate-request" }
        ]
      }
    }

after:

    {
      "brief": { "command": "steme brief" },
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": {
        "standard": [
          { "command": "steme audit", "surface": "structural", "firing": "every-phase",
            "output": "diagnostics", "input": "gate-request" }
        ]
      }
    }

    # `brief` is {command} only, split on whitespace, no shell, accepted in all three layers:
    # phax.local.json, then ~/.phax/config.json, then phax.json (as planAuditor).
    # phax ties `brief` to no gate step: the provider's two verbs are configured separately
    # and share only the facts phax sends.

### cli: phax schema upgrade — indicative

before:

    phax.schema.json / phax.user.schema.json: no "brief" property

after:

    $ phax schema upgrade          # phax.json is not read, validated or modified
    phax.schema.json, phax.user.schema.json: property "brief"
    "brief": { "command": … }  — "The brief provider command, split on whitespace with no shell. phax writes a brief request on its stdin and reads a brief answer on stdout. A brief informs and never blocks. Full contract: `phax --usage`, cmd brief."

    # Normative: `brief` present in both, phax.json untouched. Indicative: the description wording.

### api: brief request on the provider's stdin — normative

    # The pushed brief at phase start, and `phax brief` with no path inside the phase:
    {
      "$schema": "https://docs.phax.run/schemas/brief-request/0.20.0.json",
      "phase": "phase-02",
      "base": "3f2a91c0d6e84b1f9a7c2e5d8b0a4f6c1e3d7b92",
      "terminal": false,
      "phases": [
        { "id": "phase-01", "files": ["src/core/billing/port.ts"] },
        { "id": "phase-02", "files": ["src/core/billing/invoice.ts"] },
        { "id": "phase-03", "files": ["src/cli/invoice.ts", "tests/invoice.test.ts"] }
      ],
      "files": null
    }

    # `phax brief billing/tax.ts billing/invoice.ts billing/tax.ts`, run from src/core inside phase-02
    # (tax.ts does not exist yet):
    { "$schema": "…/brief-request/0.20.0.json", "phase": "phase-02", "base": "3f2a91c0…", "terminal": false,
      "phases": [ …as above… ],
      "files": ["src/core/billing/tax.ts", "src/core/billing/invoice.ts"] }

    # `phax brief src/core/billing/invoice.ts` outside a phase:
    { "$schema": "…/brief-request/0.20.0.json", "files": ["src/core/billing/invoice.ts"] }

    # Normative: the two variants and their keys. `phase`, `base`, `terminal` and `phases` hold the values of the phase's
    # gate request. `files` is null for the phase's brief, otherwise working-tree-root-relative paths, deduplicated,
    # in the order given, never checked for existence. Values and the release number are illustrative.

### file: <phase worktree>/.phax-context/brief-request.json — normative

before:

    <worktree>/.phax-context/   phase-handoff.md, summary.md (written by the agent)

after:

    <worktree>/.phax-context/brief-request.json
    { "$schema": "…/brief-request/0.20.0.json", "phase": "phase-02", "base": "3f2a91c0…",
      "terminal": false, "phases": [ … ], "files": null }

    # Written by phax at phase start and on resume, before the agent's turn, only when `brief` is configured.
    # Gitignored like the rest of .phax-context/. `phax brief` reads it from any directory of the worktree.
    # Replay by hand: steme brief < .phax-context/brief-request.json

### api: brief answer on the provider's stdout — normative

    {
      "guarantees": [
        {
          "id": "core-no-adapters",
          "statement": "src/core imports no adapter from src/infra",
          "places": [
            { "location": { "file": "src/core/billing/invoice.ts", "line": 3 }, "state": "forbidden",
              "due": "this-phase", "what": "imports src/infra/stripe.ts",
              "repair": "depend on PaymentPort from src/core/billing/port.ts" },
            { "location": { "file": "src/core/billing/port.ts" }, "state": "met" }
          ]
        },
        {
          "id": "cli-commands-registered",
          "statement": "every command module is registered in src/cli/index.ts",
          "places": [
            { "location": { "file": "src/cli/index.ts" }, "state": "missing", "due": "later",
              "what": "invoiceCommand is not registered",
              "repair": "register invoiceCommand in src/cli/index.ts" }
          ]
        },
        {
          "id": "money-as-cents",
          "statement": "amounts are integer cents",
          "places": [
            { "location": { "file": "src/core/billing/legacy.ts", "line": 40 }, "state": "accepted",
              "what": "floats kept until the legacy export is retired" }
          ]
        }
      ]
    }

    # Place variants: met {location, state}; missing | forbidden {location, state, due, what, repair}; accepted {location, state, what}.
    # due: "this-phase" | "later" | null (null when the request carried no phase facts). location: {file, line?}, as in a diagnostics finding.
    # A guarantee has at least one place. The order is the provider's rank; phax never re-sorts.
    # { "guarantees": [] } means nothing to report. Extra keys are ignored. No severity, title, trigger or body.

### internal: brief section of the phase's first prompt — indicative

before:

    ## Current phase

    { …current phase JSON… }

    ## Execution rules
    …
    - Run the gate commands again after your changes to verify the gates are satisfied.
    <gate commands>

after:

    ## Current phase

    { …current phase JSON… }

    ## Brief for this phase

    What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.

    - core-no-adapters — src/core imports no adapter from src/infra · forbidden src/core/billing/invoice.ts:3 (this phase)
    - cli-commands-registered — every command module is registered in src/cli/index.ts · missing src/cli/index.ts (later)
    - money-as-cents — amounts are integer cents · accepted src/core/billing/legacy.ts:40
    - …and 12 more not shown. `phax brief` prints the phase's brief whole.

    Before touching any file, planned or not, existing or not yet created, run `phax brief <path> [<path>…]` to see the guarantees over it, their state there, what is wrong and how to repair it.
    `phax brief` with no path prints this phase's brief whole, as the code stands now.
    To learn where the phase stands, run the gate commands listed under Execution rules. The brief never fails the phase.

    ## Execution rules
    …

    # Pushed brief unavailable: "The brief is unavailable at phase start (brief provider exited with code 1). `phax brief` may still answer." then the same instructions.
    # Empty answer: "The brief provider has nothing to report on this phase's planned files." then the same instructions.
    # Normative: the section is present whenever `brief` is configured and absent otherwise; one line per guarantee in provider order,
    # each with id, statement and the non-met places' state, location and due, and no `what` or repair; the cap of 50 with a
    # not-shown line naming `phax brief`; the three instructions. Indicative: heading, position, separators and wording.

### cli: phax brief [path…] — normative

    $ phax brief src/core/billing/invoice.ts src/core/billing/tax.ts      # inside phase-02
    core-no-adapters — src/core imports no adapter from src/infra
      forbidden  src/core/billing/invoice.ts:3   due this phase
        what:    imports src/infra/stripe.ts
        repair:  depend on PaymentPort from src/core/billing/port.ts
      met        src/core/billing/port.ts
    money-as-cents — amounts are integer cents
      missing    src/core/billing/tax.ts   due this phase
        what:    tax amounts are computed as floats in the plan
        repair:  compute tax in integer cents
    $? = 0

    $ phax brief                       # inside a phase: the phase's brief, whole
    $ phax brief src/util/x.ts
    No brief for src/util/x.ts.
    $? = 0

    $ phax brief                       # outside a phase
    ✗ phax brief: outside a phase, name at least one path
    $? = 1

    $ phax brief ../elsewhere.ts
    ✗ phax brief: ../elsewhere.ts is outside the working tree
    $? = 1

    $ phax brief src/a.ts              # .phax-context/brief-request.json does not decode
    ✗ phax brief: .phax-context/brief-request.json is not a brief request: <reason>
    $? = 1

    $ phax brief src/a.ts              # the provider exits 1, prints non-JSON, or exceeds the time limit
    ✗ brief provider exited with code 1: <stderr excerpt>
    $? = 1

    $ phax brief src/a.ts              # no `brief` key
    ✗ No brief provider is configured: add "brief": { "command": "…" } to phax.json
    $? = 1

    # Normative: the command name, variadic paths and no other argument or flag; the request each form sends;
    # exit 0 on any answer and 1 otherwise (README §Exit codes: 1 covers bad arguments); a whole-form answer carries every field.
    # Indicative: layout and wording.

### cli: run output when the pushed brief fails — indicative

    [phax] Warning: phase "phase-02" — brief unavailable (brief provider exited with code 1). The phase runs without it.

    # Normative: one warning naming the phase and the reason, and the phase is dispatched. Indicative: the wording.

### file: <phase folder>/brief-NN.json — normative

before:

    <phase folder>/
      prompt.md
      checks-attempt-01.log
      checks-attempt-01.request.json
      …

after:

    <phase folder>/
      prompt.md
      brief-00.json        # the pushed brief
      brief-01.json        # the first `phax brief` of the phase
      brief-02.json
      checks-attempt-01.log
      checks-attempt-01.request.json
      …
      (no brief file at all when `brief` is not configured)

    brief-01.json:
    {
      "$schema": "https://docs.phax.run/schemas/brief-record/0.20.0.json",
      "moment": "pulled",
      "request": { "$schema": "…/brief-request/0.20.0.json", "phase": "phase-02", "base": "3f2a91c0…",
                   "terminal": false, "phases": [ … ], "files": ["src/core/billing/tax.ts"] },
      "outcome": { "kind": "answered", "answer": { "guarantees": [ … ] } }
    }

    # moment: "pushed" (00 only) | "pulled".
    # outcome: { "kind": "answered", "answer" } | { "kind": "failed", "reason": "brief provider exited with code 1" }
    # Every brief file rides the phase record on phax/records/v1. Replay: jq -c .request brief-01.json | steme brief

### file: security.json agent commands — normative

before:

    { "command": "pnpm test", "source": "gate", "explicit": false, … }
    # source: "config" | "gate"

after:

    { "command": "phax brief", "source": "brief", "explicit": false, … }
    # source: "config" | "gate" | "brief". Present only when `brief` is configured.
    # security.json is phax-internal, not a @lbdremy/phax-schemas format.

### package: @lbdremy/phax-schemas — formats `brief-request` and `brief-record` — normative

before:

    README §Persisted formats has no brief row; the package exports no brief parser.

after:

    | Brief request | `brief-request` | `<worktree>/.phax-context/brief-request.json`, `request` in a brief record | `parseBriefRequest` | `json/brief-request.schema.json` |
    | Brief record  | `brief-record`  | `<record>/brief-NN.json`                                              | `parseBriefRecord`  | `json/brief-record.schema.json`  |

    import { parseBriefRecord } from "@lbdremy/phax-schemas";
    const parsed = parseBriefRecord(JSON.parse(raw));
    // parsed.ok === true → parsed.value: { moment, request, outcome }
    // parseDocument identifies each by its `$schema`. Unreleased shapes are recorded as `<format>/next.schema.json`.

### cli: phax records explain <commit> --briefs — indicative

before:

    $ phax records explain 9c1e2f4 --gates
    # flags: --prompt, --diff, --transcript, --gates

after:

    $ phax records explain 9c1e2f4 --briefs
    phase-02 · claude-code (claude-sonnet-5, medium)
    --- brief-00.json ---
    { "$schema": "…/brief-record/0.20.0.json", "moment": "pushed", … }
    --- brief-01.json ---
    { "$schema": "…/brief-record/0.20.0.json", "moment": "pulled", … }

    # Normative: the `--briefs` flag, and every brief record printed in number order under its file name. Indicative: the header line.

### cli: phax --usage — normative

before:

    (no cmd "brief"; records explain flags: --prompt, --diff, --transcript, --gates)

after:

    cmd "brief" {
        help "Ask the configured brief provider which guarantees range over the given paths and how each stands there; with no path, inside a phase, the phase's brief"
        arg "[path]..."
    }
    (`records explain` gains flag "--briefs")

    # Normative: `brief` takes variadic paths and has no flags. The long help carries the request and answer contract.
    # Indicative: the help wording.

### file: examples/hello-world/ — indicative

before:

    phax.json  "planAuditor": { "command": "node ./audit-plan.mjs" }, a diagnostics gate step `node ./audit.mjs`
    audit.mjs, audit-plan.mjs

after:

    phax.json  adds "brief": { "command": "node ./brief.mjs" }
    brief.mjs  # reads the brief request; for files null, briefs the gated phase's planned files from `phases`;
               # reports `hw-no-io` over src/: met, or forbidden with what and repair where greet.ts imports node:fs;
               # due from `phases` when phase facts are present, null otherwise

## 7. Non-goals

- The brief at plan authoring (the architecture brief): the same provider verb at an earlier moment, left to a later spec.
- The audit and the gate: the gate request, verdicts, fix prompts and attribution belong to `gate-request` and `drop-gate-scopes`, and nothing in them changes here.
- Anything about orient: its removal is spec `drop-orient`, and this spec adds no alias, migration or reading of orient's leftovers.
- A diagnostic `id`, accepted debt in the audit's document, ranges, structured repair and a decision class.
- phax ranking, filtering, grouping or deduplicating guarantees, computing a state or a due, or checking an answer against its request. Decoding the shape is the only check.
- Telling the agent where the phase stands: the agent runs the gate commands listed in its prompt, and a provider run by hand with no request on stdin uses its own flags.
- Briefs in fix-loop prompts or in review or compliance prompts, and weaving the brief again on resume.
- Asking for a guarantee by id (`phax brief <id>`), a `--json` output, or any flag on `phax brief`.
- Severity, title, trigger or a body in the answer.
- A configurable time limit or cap, or per-provider options in the `brief` key.
- Recording `phax brief` calls made outside a phase or after the phase's record is written.
- Renaming the authoring `--brief` flag or `docs/briefs/`.
- Building steme's `steme brief`, and the cross-run durable context layer (NEXT_STEPS).

## 8. Acceptance criteria

### The pushed brief carries the gate request's facts

Given a three-phase run whose phax.json declares `"brief": { "command": "node ./brief.mjs" }` and a gate step declaring `"input": "gate-request"`, where brief.mjs saves its stdin and working directory and prints `{ "guarantees": [] }`, when phase-02 starts and its gate later runs, then brief.mjs ran once for phase-02, before `prompt.md` was written, from the phase worktree's root. Its saved stdin is a JSON object with exactly the keys `$schema`, `phase`, `base`, `terminal`, `phases` and `files`. `$schema` starts with `https://docs.phax.run/schemas/brief-request/` and `files` is `null`. `phase`, `base`, `terminal` and `phases` equal those of phase-02's `checks-attempt-01.request.json`. (refs §5.1, §5.2, §5.3, §5.5, §5.7, §5.8, §5.12)

### A nearer layer overrides the provider

Given `"brief": { "command": "node ./a.mjs" }` in phax.json and `"brief": { "command": "node ./b.mjs" }` in phax.local.json, when a phase starts, then b.mjs receives the pushed brief request, run without a shell from the worktree root, and a.mjs is not run. (refs §5.1, §5.2)

### `phax schema upgrade` describes `brief`

Given a project whose `phax.schema.json` predates the change, when `phax schema upgrade` runs, then it succeeds, `phax.schema.json` and `phax.user.schema.json` each have a `brief` property with a required `command`, and `phax.json` is byte-for-byte unchanged. (refs §5.4)

### Every fresh start gets its own pushed brief

Given a run with `brief` configured whose phase-02 failed its gate, and a later run in `review_open`, when `phax reset-phase <run> phase-02` then `phax resume <run> --yes` re-run phase-02, and `phax run <run> --append --plan <review-plan.md>` starts phase-04, then brief.mjs runs once at the re-run of phase-02 and once at phase-04's start. Each request's phase facts equal that phase's gate request, and each new phase folder holds its own `brief-00.json`. (refs §5.5, §5.7)

### The worktree knows its phase, across a resume

Given phase-02 started with `brief` configured, then stopped with its gate exhausted, and `.phax-context/brief-request.json` deleted from its worktree, when the agent's first turn begins, and later `phax resume <run>` runs, then at the first turn, the file holds a JSON value equal to the `request` of `brief-00.json`. After the resume the file exists again with the same value. brief.mjs was not run by the resume, `brief-00.json` is unchanged, and the resumed session's prompt gains no new brief section. (refs §5.13, §5.6)

### A pull names paths, existing or not

Given phase-02's worktree, where `src/core/billing/tax.ts` does not exist, when the agent runs `phax brief billing/tax.ts billing/invoice.ts billing/tax.ts` from `src/core`, then brief.mjs runs from the worktree root and receives phase-02's phase facts, identical to those in the phase request file, with `files` equal to `["src/core/billing/tax.ts", "src/core/billing/invoice.ts"]`. Nothing in the request marks tax.ts as absent. (refs §5.9, §5.14, §5.2)

### `phax brief` with no path is the phase's brief, whole

Given phase-02's worktree and a provider that answers one guarantee with a `forbidden` place carrying `due`, `what` and `repair`, when the agent runs `phax brief` with no argument, then the request sent equals the phase request file, with `files` `null`. stdout shows the guarantee's id and statement and the place's state, location, due, `what` and repair. The exit code is 0. (refs §5.8, §5.14, §5.20)

### Outside a phase: files only, nothing recorded

Given a clone of the repository with no `.phax-context/brief-request.json` and `brief` configured, when `phax brief src/greet.ts`, then `phax brief`, then `phax brief ../elsewhere.ts` run from its root, and `phax brief src/greet.ts` runs from a directory outside any git working tree, then the first sends exactly `{ "$schema": …, "files": ["src/greet.ts"] }` and writes nothing under any run or phase folder. The other three exit 1 with a message naming the problem, without running the provider. (refs §5.10, §5.11, §5.14, §5.32)

### An unreadable phase request file is named

Given phase-02's worktree whose `.phax-context/brief-request.json` holds `{ "phase": 2 }`, when the agent runs `phax brief src/a.ts`, then it exits 1 with a message naming `.phax-context/brief-request.json`, and brief.mjs is not run. (refs §5.15)

### The pushed form is compact, ordered and capped

Given a provider answering 53 guarantees `g01` … `g53` in that order, `g01` with a `forbidden` place at `src/a.ts:3` due `this-phase` whose `what` is `W1` and repair is `R1`, when a phase starts, then `prompt.md` has a `## Brief for this phase` section listing `g01` through `g50`, one line each, in that order. `g01`'s line holds its id, its statement, `forbidden`, `src/a.ts:3` and `this phase`, but neither `W1` nor `R1`. A following line says 3 more are not shown and names `phax brief`. (refs §5.18, §5.19, §5.17)

### A pull prints everything in the provider's order

Given the same 53-guarantee answer, with places in the order the provider gave, when `phax brief src/a.ts` runs in the phase, then stdout lists all 53 guarantees in the provider's order, and every place in its order with its state, location, due, `what` and repair where the state has them. The exit code is 0. (refs §5.20, §5.17)

### The answer's variants are checked, extra keys ignored

Given in turn, an answer with a place `"state": "stale"`, one with a `missing` place lacking `repair`, one with a guarantee whose `places` is empty, and one with a `met` place `{ "location": { "file": "src/a.ts" }, "state": "met", "score": 3 }`, when each is returned to `phax brief src/a.ts` and as the pushed brief, then the first three make `phax brief` exit 1 with a schema failure on stderr, and mark the pushed brief unavailable while the phase runs. The fourth is printed and woven with no error. (refs §5.16, §5.24, §5.23)

### Nothing to report

Given a provider answering `{ "guarantees": [] }`, when a phase starts and the agent runs `phax brief src/x.ts`, then the brief section says the provider has nothing to report and keeps the instructions, and `phax brief` prints `No brief for src/x.ts.` and exits 0. (refs §5.21)

### A failing, silent or slow pushed brief never blocks

Given in turn, a provider that exits 1, one that prints `not json` with exit 0, and one that never exits, when phase-01 of a one-phase run starts each time, then each time the agent is dispatched; for the never-exiting provider this happens after the brief time limit, and that provider process is no longer running. The run output warns, naming `phase-01` and the reason. The brief section says the brief is unavailable and why, and keeps the instructions. `brief-00.json` has `moment` `pushed` and outcome `{ "kind": "failed", "reason": … }`. The run ends with the same state and exit code as the same run with no `brief` configured. (refs §5.23, §5.22, §5.30, §5.25)

### A failing pull is reported and recorded

Given phase-02 with a provider that exits 1 on a pull, when the agent runs `phax brief src/a.ts`, then stderr carries the reason and the exit code is 1. The phase goes on, and the phase's folder holds a brief record with `moment` `pulled`, the request as sent, and outcome `failed`. (refs §5.24, §5.31)

### A brief judges nothing

Given a provider whose answer holds a `forbidden` place due `this-phase` on a planned file, and an audit step that prints `{ "diagnostics": [] }`, when the phase's gate runs, then the gate passes, `gate-attribution.json` records `pass` for the audit step, and the phase commits. (refs §5.25)

### `phax brief` is granted only with a provider

Given a run in `secure` mode on a provider with a command allowlist, first with `brief` configured and then without it, when a phase runs, then with `brief` configured, `security.json` lists `{ "command": "phax brief", "source": "brief", "explicit": false, … }` and the agent's `phax brief` call succeeds. Without it, no such entry exists. (refs §5.26)

### No provider, no brief

Given a project with no `brief` key in any layer, when a phase runs and `phax brief src/a.ts` runs in its worktree, then `prompt.md` has no brief section, the phase folder has no `brief-NN.json`, and the worktree has no `.phax-context/brief-request.json`. `phax brief` exits 1 with a message naming the `brief` key. (refs §5.27, §5.28)

### The agent is told how to pull and where to look for the verdict

Given `brief` configured, when a phase's first prompt is built, then the brief section tells the agent to run `phax brief <path>` before touching any file, planned or not and existing or not, and to run `phax brief` with no path for the phase's whole brief. It also says that the gate commands listed in the prompt are how to learn where the phase stands. (refs §5.29)

### The record carries and shows every brief

Given a committed phase with records enabled, whose agent ran `phax brief` three times across two sessions (a resume in between), the second call failing, when `phax records explain <record commit> --briefs` runs, and `jq -c .request brief-01.json | node ./brief.mjs` runs in the same tree, then the record holds `brief-00.json` (`pushed`) and `brief-01.json` through `brief-03.json` (`pulled`) in call order, each with its request as sent and its outcome, with `brief-02.json` `failed`. The command prints the four files in number order, each under `--- brief-NN.json ---`. The replay prints the answer recorded in `brief-01.json`. (refs §5.30, §5.31, §5.34)

### Pulls after the record are answered, not recorded

Given a run in `review_open` whose final phase's record is written and whose worktree still holds its phase request file, when `phax brief src/a.ts` runs in that worktree, then the request carries the final phase's facts, the answer is printed with exit 0, and no new brief record appears in the phase folder or on `phax/records/v1`. (refs §5.32)

### The two formats are published

Given a `brief-01.json` written by phax and the `request` it holds, when they are passed to `parseBriefRecord`, `parseBriefRequest` and `parseDocument` from `@lbdremy/phax-schemas`, then each parse succeeds, and `parseDocument` identifies `brief-record` and `brief-request`. The package ships `json/brief-record.schema.json` and `json/brief-request.schema.json`, README §Persisted formats has both rows, and the snapshot gate passes with both `next` shapes recorded. (refs §5.33)

### Docs and example describe the brief

Given the repository after the change, when `examples/hello-world/` is inspected, `phax validate` runs there, and README.md, docs/cli/reference.md, phax.usage.kdl, phax.schema.json and phax.user.schema.json are read, then hello-world's phax.json declares `brief`, `brief.mjs` exists, `phax validate` exits 0, and the example-provider integration test passes against `brief.mjs` for a request with `files: null` and for one with paths. README §Extend phax has a Brief provider section, and its hook count includes it. The usage spec has `cmd "brief"` and `records explain` lists `--briefs`. (refs §5.35, §5.36)

## 9. Open questions for implementation planning

### Q1 — What shape does the brief answer take? (Decided by the author on 2026-10-05; not reopened.)

- Structured: guarantees → places with a per-state variant; phax renders the compact and whole forms and records the data — abandons: The provider's control over wording and layout. A field set is frozen before 1.0 for a provider that is not built yet.
- Text the provider renders: `{compact, whole}` strings that phax weaves and prints verbatim — abandons: The brief as data. Records would hold prose no tool can read back, phax could not cap the pushed form by guarantee or check the states, and the provider would maintain two renderings.
- Both: the structured answer plus provider-rendered text — abandons: One account of the answer. The two renderings can disagree, and both become contract.

Recommendation: Structured: guarantees → places with a per-state variant; phax renders the compact and whole forms and records the data — Decided by the author on 2026-10-05, as recommended. One structured answer serves both moments: phax cuts the compact form from it and prints the whole form, so the provider answers once. steme's ledger is structured already, and the states are exactly what the agent needs to read. The frozen field set is the acceptable loss because it is kept to what the first consumer needs (id, statement, location, state, due, what, repair), and extra keys pass decoding, so steme can add fields before phax reads them.

### Q2 — How does `phax brief`, run by the agent inside the phase worktree, learn the phase it is in? (Decided by the author on 2026-10-05; not reopened.)

- A file phax writes into the worktree: `.phax-context/brief-request.json`, the phase's brief request with `files: null` — abandons: Tamper-proof facts. `.phax-context/` is writable by the agent, which could edit or delete the file and so mislead its own brief, though never a verdict.
- An environment variable in the agent's session (run and phase ids) — abandons: Provider neutrality. Whether a variable reaches the commands an agent runs is up to each provider CLI (Codex filters its shell environment by policy), and every resumed session must be launched with it.
- Flags on the command: `phax brief --run <id> --phase <id> [paths]` — abandons: An agent that never handles plumbing. Every call repeats ids phax already knows, and a wrong id sends another phase's facts.
- None: `phax brief` always briefs as the code stands — abandons: The phase facts on every pull. A pulled brief could not say what is due this phase, which is half the need.

Recommendation: A file phax writes into the worktree: `.phax-context/brief-request.json`, the phase's brief request with `files: null` — Decided by the author on 2026-10-05, as recommended. The file works the same under every provider and under a sandbox that confines the agent to its worktree. It survives a resume because phax rewrites it. It holds the facts themselves, so `phax brief` never has to reach into the run state, and a person can replay it with `steme brief < .phax-context/brief-request.json`. The tampering risk is the acceptable loss: an edited file can only mislead the agent's own advice, and the audit reads its facts from phax, not from the worktree.

### Q3 — Is the brief's request the gate request's format, or its own? (Decided by the author on 2026-10-05; not reopened.)

- Its own format `brief-request`: the gate request's four fact keys with the same names, types and values, plus `files`; outside a phase, `$schema` and `files` only — abandons: A single parser for both verbs. A provider reads two formats, one being the other plus `files`.
- The gate request extended with `files` (null for the gate) — abandons: gate-request's settled "exactly five keys", and a gate step would receive a key that means nothing to it. It also leaves no shape for a call outside a phase.
- The gate request verbatim on stdin, with the paths as arguments to the provider command — abandons: Stdin as the single channel. Paths become argv that the provider must parse, and outside a phase there is no gate request to send.

Recommendation: Its own format `brief-request`: the gate request's four fact keys with the same names, types and values, plus `files`; outside a phase, `$schema` and `files` only — Decided by the author on 2026-10-05, as recommended. The facts are shared by value, not by format: for the same phase, `phase`, `base`, `terminal` and `phases` are identical in both documents, which is what keeps the two verbs from disagreeing. The approved gate request stays untouched. The out-of-phase call gets an explicit variant instead of null facts, and `$schema` tells a provider which verb it is serving. A second, nearly identical parser is a small price.

### Q4 — Does the pushed form keep a cap, and which? (Decided by the author on 2026-10-05; not reopened.)

- Keep a cap of 50 guarantees, in provider order, with a not-shown line naming `phax brief` — abandons: The provider's whole word in the prompt. Guarantees past the 50th reach the agent only if it pulls, whether or not they are due this phase.
- No cap — abandons: A bound on every phase prompt. A provider answering with thousands of guarantees inflates the cost of each first prompt.
- A cap in bytes or lines — abandons: A cut the agent can reason about. Where the text stops depends on statement lengths, not on rank, and the cut can fall mid-guarantee.

Recommendation: Keep a cap of 50 guarantees, in provider order, with a not-shown line naming `phax brief` — Decided by the author on 2026-10-05, as recommended. Order is the provider's rank, so the cut drops what the provider ranks lowest, and the not-shown line says how to reach the rest. Counting guarantees keeps each one whole. 50 was orient's cap and caused no trouble. Losing the tail from the prompt is acceptable because the tail is one `phax brief` away, and a provider that ranks due guarantees first loses nothing that matters.

### Q5 — Can a guarantee be asked for by id (`phax brief <id> [paths]`)? (Decided by the author on 2026-10-05; not reopened.)

- No: `phax brief [path…]` only — abandons: Re-reading one guarantee without the others on the same paths. The agent finds it in the whole answer instead.
- Yes: `phax brief <id> [paths]`, with the request gaining a `guarantee` key — abandons: One argument grammar: an id and a path are both bare words, and `money-as-cents` could be a file. It also adds a request key and a provider behaviour the first consumer does not need.

Recommendation: No: `phax brief [path…]` only — Decided by the author on 2026-10-05, as recommended. orient needed expand because its index carried no body. A whole brief already carries every statement, state, `what` and repair, so the agent never needs a second round trip. Keeping to what the first consumer needs, the lost convenience is small and can be added later as a new key without breaking the request.

### Q6 — Does severity survive once state is in the answer? (Decided by the author on 2026-10-05; not reopened.)

- Drop severity — abandons: A per-guarantee weight independent of order. A provider can no longer say error versus info.
- Keep `severity: error|warn|info` per guarantee, beside state — abandons: One ranking signal. Severity and order can disagree, and phax would render a second rank that it did not make and cannot reconcile.

Recommendation: Drop severity — Decided by the author on 2026-10-05, as recommended. State says what to do at a place (fix what is missing or forbidden, leave accepted debt alone), and due says when; order says what matters most. Severity added a third axis that only made sense when the answer carried no state, and the audit, not the brief, is where weight becomes a verdict. Losing the explicit label is acceptable because the provider still ranks by order.

### Q7 — What happens to a `phax brief` call made in a phase worktree after that phase's record is written (the kept-open final phase in review)? (Decided by the author on 2026-10-06; not reopened.)

- Answer it with the phase's facts and record nothing — abandons: A complete account of what was asked during review. Pulls made while the final phase is kept open leave no trace in the record.
- Record it into the already-written record, or a follow-up record — abandons: A phase record written once. `phax/records/v1` would need an amendment path it does not have, for calls that no longer shape the phase's gated work.
- Refuse the call once the record is written — abandons: The brief during review, when a person or a review session still edits files in that worktree and needs the same advice.

Recommendation: Answer it with the phase's facts and record nothing — Decided by the author on 2026-10-06, as recommended. The record explains the gated phase, and every brief that shaped that work was made before the record was written, so it is captured. Review-time pulls inform edits that the review itself accounts for. Losing their trace is the cheapest of the three losses: amending records changes a persisted contract, and refusing removes the advice when it is still useful.

### Q8 — What does `phax brief` do when the phase request file is present but does not decode? (Decided by the author on 2026-10-06; not reopened.)

- Exit 1 naming the file, without running the provider — abandons: An answer while the file is damaged. The agent must restore it (a resume rewrites it), or delete it to brief as outside a phase.
- Brief as outside a phase — abandons: Noticing the damage. Every pull silently loses the phase facts and `due`, and nothing says why.

Recommendation: Exit 1 naming the file, without running the provider — Decided by the author on 2026-10-06, as recommended. A present file means the call is inside a phase. Silently falling back would hand the agent advice without the half of the need that depends on the phase (what is due now). A loud refusal costs one call and names the file to fix.

### Q9 — Is the brief time limit fixed or configurable, and how long is it? (Decided by the author on 2026-10-06; not reopened.)

- A fixed 60 seconds, the same for pushed and pulled briefs — abandons: A provider that needs longer on a large repository. It is cut off, and the phase runs without its brief, or the pull fails.
- A `timeoutSeconds` beside `command` in the `brief` key — abandons: The `{command}`-only shape every provider key shares, and one more config key frozen at 1.0 before the first consumer has shown it needs one.
- No limit — abandons: Never blocking. A wedged provider wedges the phase start, as orient's unbounded query could.

Recommendation: A fixed 60 seconds, the same for pushed and pulled briefs — Decided by the author on 2026-10-06, as recommended. A brief reads a ledger the audit has already built, so it should answer in seconds. A fixed limit keeps every provider key `{command}` and keeps the config contract small before the freeze. If a real provider is too slow, the cost is a brief marked unavailable, never a blocked phase, and a key can be added later without breaking any existing config.

## 10. Implementation-planning note

Settled:

- Config: `brief: {command}` in the three layers, read from phax.local.json, then ~/.phax/config.json, then phax.json, like `planAuditor`. `phax schema upgrade` regenerates both local schemas and never touches `phax.json`. Nothing about `orient` appears: since `drop-orient` it is an unknown key like any other.
- Request: its own format, `brief-request`. Inside a phase it holds `$schema`, the phase facts (the same values as the phase's gate request) and `files`. `files` is `null` for the phase's brief; otherwise it holds the named paths, relative to the working tree root, deduplicated, in the order given and never checked for existence. Outside a phase the request holds `$schema` and `files` only. The provider runs from the working tree root.
- Phase identity: the phase request file `.phax-context/brief-request.json`, written at phase start and on resume when `brief` is configured. `phax brief` reads it from any directory of the worktree. With no file the call is outside a phase, and a file that does not decode is refused (Q8).
- Answer: structured `{guarantees: [{id, statement, places}]}` with at least one place per guarantee and per-state place variants. `due` sits on `missing` and `forbidden` places. `location` is `{file, line?}`, as in a diagnostics finding. Extra keys are ignored. The provider's order is the rank. There is no severity, title, trigger or body.
- Pushed brief: requested once per fresh phase start (first run, after reset-phase, appended), after the worktree is ready and before the first prompt; not on resume, and not in fix-loop, review or compliance prompts. It is woven in compact form under `## Brief for this phase`, capped at 50 guarantees with a not-shown line, and followed by the three instructions. With `files: null`, the provider briefs the gated phase's entry in `phases` (create ∪ edit, optional files excluded); the agent pulls an optional file when it decides to touch it.
- Pulled brief: `phax brief [path…]` prints the whole form. It exits 0 on any answer and 1 otherwise: failure, missing provider, unreadable phase request file, or bad arguments. README §Exit codes files bad arguments under 1 and reserves 2 for plan or config validation, so this departs from the abandoned spec's exit 2. There is no lookup by id.
- Never blocks: every call has the fixed brief time limit (Q9: 60 seconds). A failure produces a run-output warning, an unavailable line in the prompt and a `failed` record, and never affects a verdict, a state or an exit code of `phax run` or `phax resume`.
- Records: `brief-NN.json` (format `brief-record`), where `00` is the pushed brief and `01`… are the pulled ones in call order across sessions. They ride the phase record and print with `phax records explain --briefs`. Nothing is recorded outside a phase or after the phase's record is written (Q7).
- Grant: `phax brief` is allowed automatically when `brief` is configured, and `security.json` gains the source value `brief` (phax-internal, not a package format).

Left open:

- How a pulled call's record reaches the phase folder. `phax brief` runs as a child of the agent and may be confined to the worktree by the sandbox. Writing under `.phax-context/` and collecting the files into the phase folder before the record is written is the likely route.
- How `base` is available before the agent's first turn. The pushed brief needs it at phase start, which favours recording it when the phase branch is created. Use the one mechanism spec `gate-request` settles for the gate, so the two documents cannot differ.
- Whether a pulled brief's provider, run inside the agent's sandbox, can read what it needs (for steme, its ledger). If the ledger lives outside the worktree, the sandbox posture for `phax brief` must allow it. Raise this with the steme item 8 design.
- The exact compact line, the whole-form layout, the section heading and position, and the instruction wording (indicative in §6).
- Whether `phax records explain` without flags mentions the briefs. A one-line count is suggested.
- Whether briefs emit telemetry events (the observability port) in addition to the records. They are not required by this spec.
- The steme-corpus coordination note (`02-product/phax-steme-coordination.md`: §Along a run, §What is lost, or latent, §The changes rows 4 and 5, §The architecture brief, at plan authoring) could not be read from this authoring session. The re-authored `gate-request`, `drop-gate-scopes` and `drop-orient` specs were not yet under docs/specs/, so they were read from their briefs. The planner should cross-check all of these. This spec supersedes rows 4 and 5 of the note.

Constraints:

- A brief never blocks, and phax judges nothing in it: it ranks, filters and deduplicates nothing, computes no state or due, and does not cross-check the answer against the request. Decoding the shape is the only check.
- Lands after `drop-orient`, `drop-gate-scopes` and `gate-request`. The phase facts are the gate request's, with the same values for the same phase.
- Purely additive: one key, one command, one prompt section, one `records explain` flag, one grant source value and two persisted formats. Nothing is retired, aliased or migrated.
- phax ties the `brief` provider to no gate step. `steme brief` and `steme audit` are configured separately and share only the facts phax sends.
- This spec lands before steme builds item 8 (`steme brief`). Keep the answer to the fields named here, so the first consumer is not frozen into more.
- Relation to oracle-phases (Approved, not built; its text is unchanged): its `oracles: {command}` key sits beside `brief` and `planAuditor` with the same shape.
- This changes the CLI and config surface on purpose before the 1.0 freeze.

## 11. Docs page

Page: README §Extend phax › Brief provider, with the `brief-request` and `brief-record` rows in §Persisted formats and `phax brief` in docs/cli/reference.md

Reader: The author of a brief provider, such as steme's `steme brief`, who needs to know what phax sends at phase start and on each pull, what answer it expects, and that phax never judges the answer. A secondary reader is the operator who wants to see what the agent was told during a run.

Example: Declare `"brief": { "command": "node ./brief.mjs" }`. In brief.mjs, read stdin to the end and parse it. When `files` is null, brief the files of the `phases` entry whose `id` is `phase`. Otherwise brief `files`, which may include paths that do not exist yet. When `phase` is present, set `due` to `this-phase` or `later` from what later entries of `phases` still plan; outside a phase, set it to null. Print `{ "guarantees": [{ "id": "hw-no-io", "statement": "greet has no I/O", "places": [{ "location": { "file": "src/greet.ts", "line": 1 }, "state": "forbidden", "due": "this-phase", "what": "imports node:fs", "repair": "remove the import; greet is pure" }] }] }`, most important first. Replay a phase's brief with `node ./brief.mjs < .phax-context/brief-request.json`, and a recorded one with `jq -c .request brief-01.json | node ./brief.mjs`.
