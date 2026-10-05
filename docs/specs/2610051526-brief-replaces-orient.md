---
status: Draft
date: 2026-10-05
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Brief replaces orient — a feed-forward brief of guarantees and their state, pushed into the first prompt and pulled with `phax brief`; the orient provider is retired

## 1. Context

Today a project can declare an `orient` provider as `{command}` in `phax.json`, `phax.local.json` or `~/.phax/config.json`; the nearest layer wins. When a phase starts, phax sends it `{"files": [...]}`: the phase's planned files to create and to edit, plus the optional ones. It expects rows `{id, title, severity: error|warn|info, trigger}` back. phax weaves at most 50 rows into the first prompt, under `## Orientation for this phase (expand a row before touching its files)`, as `- [severity] id — title (when: trigger)`. A `…and N more not shown` line follows, and the agent is told to run `phax orient <id>` to expand a row (`{"expand": id}` → `{row: {…, body}}` or `{row: null}`) and `phax orient --file <path>` for any other file. The query has no time limit. A failure is advisory: phax warns and dispatches without the section. Every phase folder gets `orient-brief.json` (`ok`, `failed` or `not-configured`). Pulls leave telemetry events only. When `orient` is configured, the in-phase agent may run `phax orient` without an `agentCommands` entry, recorded in `security.json` with source `orient`.

`phax orient` runs inside the phase worktree, but nothing ties that worktree back to its run. The call sends a file name or an id and nothing about the phase, and its telemetry uses a placeholder run id. Each worktree has a gitignored `.phax-context/` folder, written by the agent (handoff, summary) and by phax.

Two Approved specs change the gate. `gate-request` lets a gate step read `{$schema, phase, base, terminal, phases}` on stdin: the phase, the commit its branch started from, whether it is the last phase, and the plan projection `[{id, files}]` (create ∪ edit, optional files excluded). `drop-gate-scopes` makes every reported finding fail the step, so the diagnostics provider (the audit) alone decides what is due.

No project configures `orient` (phax, steme-lab, phax-cockpit and louloupapers, checked 2026-10-05). Only `examples/hello-world/orient.mjs` implements it. steme plans `steme brief` (roadmap-1.0 item 8, not built), which reads the ledger its audit builds (item 0.13). "Brief" already names the prose a person gives a headless authoring session (`phax artifact new … --headless --brief <file|->`, kept under `docs/briefs/`). NEXT_STEPS §Road to 1.0.0 freezes the CLI and config contract. This spec changes that surface on purpose before the freeze.

Ground read:

- `docs/briefs/brief-replaces-orient.md` — The author's decisions of 2026-10-05: the need by moment, state not only the rule, one provider and one request for two verbs (`steme brief`, `steme audit`), `phax brief` as the agent's way in, with or without a path, never blocking, orient retired with no shims, steme as the first provider.
- `docs/specs/2610051439-gate-request.md` — Approved. The gate request `{$schema, phase, base, terminal, phases}`. `base` is the commit the phase branch started from, and it stays stable across attempts, resumes, resets and appends. `phases` is the projection `[{id, files}]` (create ∪ edit, optional files excluded). A copy is saved beside each attempt. Facts only, never a judgement. It leaves open how phax obtains `base`.
- `docs/specs/2610051445-drop-gate-scopes.md` — Approved. Every reported finding fails the step, and the audit alone decides what is due. A retired key gets the ordinary unknown-key refusal with no migration. A finding's location is `{file, line?}`. Extra keys are ignored on decode.
- `src/app/orient.ts` — Index request `{files}`, expand request `{expand: id}`, both through runProviderQuery.
- `src/app/providerQuery.ts` — Command split on whitespace with no shell, JSON on stdin, exit 0 and JSON on stdout. Failures are typed (exit code, stderr excerpt, invalid JSON, schema failure). A `timeoutMs` exists but is optional.
- `src/schemas/orient.ts` — Rows `{id, title, severity: error|warn|info, trigger}`; the expanded row adds `body`; `{row: null}` for an unknown id.
- `src/schemas/orientBrief.ts` — `orient-brief.json` is `ok` (files, rows, rowCount, wovenRowCount), `failed` (files, error) or `not-configured`. It carries no `$schema` and is not a package format.
- `src/app/executePlan.ts` — At a fresh phase start, after setup, phax queries the index with planned create + edit + optional files and passes no timeout. On failure it warns and dispatches with no section. It always writes `orient-brief.json`. The resume path builds no prompt and queries nothing. `orientEnabled` feeds the agent-command grant.
- `src/app/promptGeneration.ts` — `MAX_ORIENTATION_ROWS = 50`. The section `## Orientation for this phase (expand a row before touching its files)` has lines `- [severity] id — title (when: trigger)`, a hidden-rows line naming `phax orient --file`, then instructions for `phax orient <id>` and `--file`.
- `src/cli/commands/orient.ts` — `phax orient <id> | --file <path>`, exactly one of the two. Not configured: exit 1. Provider error: exit 1. Empty: "No orientation available." with exit 0. No run context: telemetry uses a placeholder run id.
- `src/app/worktree.ts` — Nothing ties a worktree to its run. Each worktree has a gitignored `.phax-context/` folder, which the agent writes (handoff, summary).
- `src/domain/security/agentCommands.ts` — `phax orient` is added to the agent commands when orient is enabled, with source `orient` and explicit false (`security.json`, src/schemas/securityPosture.ts).
- `src/domain/config/mergeLayers.ts` — `orient.command` is taken from phax.local.json, then ~/.phax/config.json, then phax.json.
- `src/cli/cliDocs.ts` — The long help of `phax orient` carries the full provider contract, and `phax --usage` (phax.usage.kdl, cmd orient) mirrors it.
- `examples/hello-world/orient.mjs` — Three static rules triggered by the `src/` prefix. It answers the index and expand requests from stdin.
- `README.md` — §Extend phax: "Four hooks", §Orient provider with its request and answer shapes. Headless authoring: `phax artifact new spec|plan … --headless --brief <file|->`.
- `NEXT_STEPS.md` — §Road to 1.0.0: a CLI contract freeze and a persisted-format stability promise. Unspecced: "orient's index and expand requests carrying the plan and the files" and "a brief provider at plan authoring". The cross-run context layer item names the orient provider and `orient-brief.json`.

## 2. Problem

orient answers with the rule in general: an id, a title, a severity, a trigger and, on expand, a body. It never says how the code stands. An agent about to edit a file learns that `core-no-adapters` applies. It does not learn that line 3 already breaks it, that a registration is still missing, or that a known violation is accepted debt to leave alone. It cannot tell which guarantees this phase must satisfy and which a later phase will.

The provider could not say so even if it knew, because it receives only file names. It gets no phase, no base and no plan, so it can see neither what this phase changed nor what is due now. A pull from inside the worktree carries nothing of the phase at all. The audit that judges the phase reads a different input, the gate request, so the advice and the verdict can disagree about the same file.

The rest of the contract also works against the agent. Expanding a row costs a second round trip per rule. Severity is a second rank beside the provider's order. Pulls are not recorded, so a run cannot be explained by what the agent was told. The query at phase start has no time limit, so a wedged provider wedges the phase it was meant to inform. All of this is CLI and config surface that is about to freeze for 1.0.

## 3. Product goal

A brief tells the agent what the project's standard expects of the files it touches, and how each expectation stands there. For each guarantee and place it gives the state (met, missing, forbidden, or accepted debt), what is wrong, the repair, and whether it is due this phase or later. phax pushes the phase's brief, in compact form, into the first prompt. The agent pulls more with `phax brief` on any path, planned or not, existing or not, and gets the answer in whole form. The brief provider receives the same facts of the phase that the audit receives in the gate request, plus the paths asked about. The provider's two verbs (`steme brief`, `steme audit`) therefore read one account of the phase and cannot disagree. A brief never blocks: when the provider fails, is too slow or has nothing to say, phax reports it and the phase goes on. `orient`, `phax orient`, the row format and `orient-brief.json` are retired with no shim.

> A brief informs and the audit decides: phax carries the phase's facts to the provider and its answer to the agent, and judges, ranks and filters nothing in between.

## 4. Terminology

- **Brief** — The brief provider's answer about a set of paths: the guarantees that range over them, and the state of each guarantee at each place. It feeds forward and only informs: it never fails, blocks or retries anything.
- **Audit** — The gate's diagnostics step (for steme, `steme audit` declaring `"input": "gate-request"`). It blocks: its findings fail the gate. This spec does not change it.
- **Brief provider** — The command configured under `brief`. It reads a brief request on stdin and prints a brief answer on stdout.
- **Pushed brief** — The phase's brief. phax requests it once, when a fresh phase starts, and weaves its compact form into the phase's first prompt.
- **Pulled brief** — A brief the agent asks for during the phase with `phax brief`. phax prints its whole form.
- **Phase facts** — The keys `phase`, `base`, `terminal` and `phases`, with the values and meanings that the gate request of the same phase carries.
- **Brief request** — The JSON document on the provider's stdin, in the persisted format `brief-request`. Inside a phase it holds `$schema`, the phase facts and `files`. Outside a phase it holds `$schema` and `files` only.
- **Phase request file** — `.phax-context/brief-request.json` in a phase worktree, written by phax. It holds the phase's brief request with `files: null`, and it is how `phax brief` knows which phase it runs in.
- **Guarantee** — One expectation of the project's standard, as the provider knows it: an `id` and a `statement`.
- **Place** — A location `{file, line?}` where a guarantee ranges, with the guarantee's state there. A file that does not exist yet can be a place.
- **State** — `met`: the guarantee holds there. `missing`: something it requires is absent. `forbidden`: something it forbids is present. `accepted`: a known violation recorded as accepted debt, to leave alone.
- **Due** — Carried by a `missing` or `forbidden` place: the provider's word on when the place must be resolved. It is `this-phase`, `later`, or `null` when the request carried no phase facts.
- **Compact form** — One line per guarantee: its id and statement, then each non-`met` place's state, location and due. It omits `what` and repair.
- **Whole form** — Every guarantee with its id and statement, and every place with its state, location, due, `what` and repair.
- **Brief time limit** — A fixed wall-clock limit. When it passes, phax stops the provider and treats the brief as failed. The limit is not configurable.
- **Brief record** — A file `brief-NN.json` in the phase folder, in the persisted format `brief-record`. It holds one brief call's request as sent and its outcome. `00` is the pushed brief; pulled briefs are numbered from `01` in call order.
- **Authoring brief** — The prose a person writes for a headless authoring session (`--brief <file|->`, kept under `docs/briefs/`). It shares one sense with the provider brief: what an agent is given before it writes. They share no command, key, file or format. A person writes the authoring brief for an authoring agent; the brief provider computes a provider brief for a phase agent. A brief at plan authoring, where the provider's verb reaches the authoring moment, is a later spec.

## 5. Functional requirements

### 5.1 The `brief` provider key

WHERE `"brief": { "command": … }` is declared in `phax.json`, `phax.local.json` or `~/.phax/config.json` THE system SHALL use that command as the brief provider, with a nearer layer overriding a farther one in the order `orient` used, and SHALL run it split on spaces with no shell, from the phase worktree inside a phase or from the current directory outside one.

### 5.2 `orient` leaves the configuration contract

The system shall have no `orient` key in the configuration contract of `phax.json`, `phax.local.json` and `~/.phax/config.json`, so a layer that still declares it meets the refusal every unknown key meets today (exit 2), with no message of its own and no migration.

### 5.3 The local schemas describe `brief`

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` and a `phax.user.schema.json` that describe the `brief` key and have no `orient` property, and SHALL leave `phax.json` unchanged.

### 5.4 `phax orient` and its artifacts are gone

The system shall have no `phax orient` command, shall write no `orient-brief.json`, and shall put no orientation section in any prompt.

### 5.5 One request on stdin

The system shall write one brief request to the brief provider's stdin and then close stdin, for every brief it requests.

### 5.6 The pushed brief, once per phase start

WHEN a phase starts with a brief provider configured THE system SHALL request the pushed brief once, before building the phase's first prompt, and SHALL NOT request it again when the phase is resumed.

### 5.7 The phase facts are the gate request's

WHILE a brief is requested for a phase THE system SHALL put the phase facts in the request, with exactly the values that the gate request of that phase carries.

### 5.8 The phase's brief has `files: null`

WHEN the pushed brief is requested, or `phax brief` runs inside a phase with no path, THE system SHALL send the phase's brief request with `files` set to `null`.

### 5.9 Named paths, existing or not

WHEN `phax brief` runs with one or more paths THE system SHALL set `files` to those paths, each relative to the worktree root, in the order given and without duplicates, sending a path that does not exist exactly as it sends one that does.

### 5.10 Outside a phase, no phase facts

WHEN `phax brief` runs with paths outside a phase THE system SHALL send a request holding only `$schema` and `files`.

### 5.11 Usage errors

IF `phax brief` runs outside a phase with no path, or is given a path that resolves outside the worktree, THEN the system SHALL refuse the call as a usage error (exit 2) without running the provider.

### 5.12 Facts, never a judgement

The system shall put no key in a brief request other than `$schema`, the phase facts and `files`: no state, rank, filter, touched files, diff or judgement.

### 5.13 The phase request file

WHEN a phase starts or resumes with a brief provider configured THE system SHALL write the phase request file into the phase worktree before the agent's turn.

### 5.14 `phax brief` learns its phase from the file

WHEN `phax brief` runs from any directory of a worktree that holds a phase request file THE system SHALL take the phase facts from that file, and it SHALL treat the call as outside a phase when no such file exists.

### 5.15 The brief answer

The system shall accept as a brief answer only a document `{ "guarantees": [...] }` whose guarantees are `{id, statement, places}` and whose places are, by state, `met` `{location, state}`, `missing` or `forbidden` `{location, state, due, what, repair}`, or `accepted` `{location, state, what}`, ignoring any key beyond these.

### 5.16 The provider's order is the rank

The system shall render and record guarantees and places in the provider's order, never sorting, grouping, filtering or deduplicating them.

### 5.17 The compact form in the first prompt

WHEN the pushed brief is answered THE system SHALL weave its compact form into a `## Brief for this phase` section of the phase's first prompt.

### 5.18 A cap of 50 guarantees on the pushed form

IF the pushed brief holds more than 50 guarantees THEN the system SHALL weave the first 50 and one line that gives the number not shown and names `phax brief`.

### 5.19 The whole form on demand

WHEN `phax brief` receives an answer THE system SHALL print the answer's whole form to stdout and exit 0.

### 5.20 Nothing to report

WHEN an answer holds no guarantee THE system SHALL say that the provider has nothing to report, in the brief section for the pushed brief, and on stdout with exit 0 for a pulled brief.

### 5.21 The brief time limit

WHEN the brief provider has not exited within the brief time limit THE system SHALL stop it and treat the brief as failed.

### 5.22 A failed pushed brief does not stop the phase

IF the pushed brief fails (the provider exits non-zero, prints no answer that decodes, or exceeds the brief time limit) THEN the system SHALL warn in the run output, naming the phase and the reason, SHALL weave the brief section with a line saying the brief is unavailable and why, and SHALL run the phase.

### 5.23 A failed pulled brief is reported

IF a pulled brief fails THEN `phax brief` SHALL print the reason on stderr and exit 1.

### 5.24 A brief changes no verdict

The system shall let no brief, no brief answer and no brief failure change a gate verdict, the fix loop, a phase or run state, or the exit code of `phax run` or `phax resume`.

### 5.25 `phax brief` is allowed to the in-phase agent

WHERE a brief provider is configured THE system SHALL allow `phax brief` to the in-phase agent without an `agentCommands` entry, recording it in `security.json` with source `brief`.

### 5.26 No provider, no brief in the phase

WHERE no brief provider is configured THE system SHALL weave no brief section, SHALL write no phase request file and no brief record, and SHALL not grant `phax brief`.

### 5.27 No provider, `phax brief` says so

IF `phax brief` runs with no brief provider configured THEN the system SHALL exit 1 with a message naming the `brief` key.

### 5.28 What the agent is told

WHERE a brief provider is configured THE system SHALL end the brief section with instructions to run `phax brief <path>…` before touching any file, planned or not and existing or not; to run `phax brief` with no path for the phase's brief in whole form; and to run the gate commands listed in the prompt to learn where the phase stands.

### 5.29 The pushed brief is recorded

WHEN the pushed brief is answered or fails THE system SHALL save `brief-00.json` in the phase folder, holding `moment: "pushed"`, the request exactly as sent, and the outcome.

### 5.30 Each pulled brief is recorded

WHEN `phax brief` runs inside a phase THE system SHALL include in that phase's record a brief record holding `moment: "pulled"`, the request exactly as sent and the outcome, numbered from `01` in call order across all of the phase's sessions.

### 5.31 Nothing recorded outside a phase

The system shall record nothing for a `phax brief` call made outside a phase.

### 5.32 Two persisted formats

The system shall define `brief-request` and `brief-record` as persisted formats in `@lbdremy/phax-schemas`, each with `$schema` `https://docs.phax.run/schemas/<format>/<release>.json`, a parser (`parseBriefRequest`, `parseBriefRecord`), recognition by `parseDocument`, and a JSON Schema under `json/`.

### 5.33 `records explain` shows the briefs

WHEN `phax records explain <commit> --briefs` runs on a phase record THE system SHALL print each of the phase's brief records in number order, each under its file name.

### 5.34 The docs describe the brief, not orient

The system's README, `phax --usage`, CLI reference, generated config schemas, 1.0 announcement draft and hello-world example shall describe the brief provider and `phax brief`, and none of them shall describe `orient` or `phax orient`.

## 6. Surface

### config: `brief` provider key in phax.json / phax.local.json / ~/.phax/config.json — normative

before:

    {
      "orient": { "command": "node ./orient.mjs" },
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": { … }
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

    # `brief` is {command} only, split on spaces, no shell. It is accepted in all three layers: phax.local.json, then ~/.phax/config.json, then phax.json.
    # `orient` is no longer a key in any layer. phax does not tie `brief` to any gate step.
    # Each provider has two verbs, configured separately, and they share only the facts phax sends.

### cli: a config that still declares `orient` — indicative

before:

    $ phax validate
    ✓ phax.json is valid

after:

    $ phax validate
    ✗ phax.json: is unexpected  at: orient
    $? = 2

    # This is the refusal every unknown key meets today: no dedicated message, no migration.
    # Normative: exit 2. Indicative: the wording, which is the existing unknown-key message.

### cli: phax schema upgrade — indicative

before:

    phax.schema.json / phax.user.schema.json: property "orient" ("The orient provider command. … Full contract: `phax --usage`, cmd orient.")

after:

    $ phax schema upgrade          # phax.json is not read, validated or modified
    phax.schema.json, phax.user.schema.json: property "brief", no "orient"
    "brief": { "command": … }  — "The brief provider command, split on whitespace with no shell. phax writes a brief request on its stdin and reads a brief answer on stdout. A brief informs and never blocks. Full contract: `phax --usage`, cmd brief."

    # Normative: `brief` present, `orient` absent, phax.json untouched. Indicative: the description wording.

### api: brief request on the provider's stdin — normative

before:

    {"files": ["src/core/billing/invoice.ts", "src/core/billing/old.ts"]}     # index
    {"expand": "core-no-adapters"}                                             # expand

after:

    # The pushed brief at phase start, and `phax brief` with no path inside the phase:
    {
      "$schema": "https://docs.phax.run/schemas/brief-request/0.19.0.json",
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
    { "$schema": "…/brief-request/0.19.0.json", "phase": "phase-02", "base": "3f2a91c0…", "terminal": false,
      "phases": [ …as above… ],
      "files": ["src/core/billing/tax.ts", "src/core/billing/invoice.ts"] }

    # `phax brief src/core/billing/invoice.ts` outside a phase:
    { "$schema": "…/brief-request/0.19.0.json", "files": ["src/core/billing/invoice.ts"] }

    # Normative: the two variants and their keys. `phase`, `base`, `terminal` and `phases` hold the same values as the
    # phase's gate request. `files` is null for the phase's brief, otherwise worktree-root-relative paths, deduplicated,
    # in the order given, never checked for existence. Values above are illustrative; the release number is illustrative.

### file: <phase worktree>/.phax-context/brief-request.json — normative

    <worktree>/.phax-context/brief-request.json
    { "$schema": "…/brief-request/0.19.0.json", "phase": "phase-02", "base": "3f2a91c0…",
      "terminal": false, "phases": [ … ], "files": null }

    # Written by phax at phase start and on resume, before the agent's turn, only when `brief` is configured.
    # It is gitignored like the rest of .phax-context/. `phax brief` reads it from any directory of the worktree.
    # Replay by hand: steme brief < .phax-context/brief-request.json

### api: brief answer on the provider's stdout — normative

before:

    {"rows": [{"id": "core-no-adapters", "title": "…", "severity": "error", "trigger": "src/core/"}]}
    {"row": {"id": "core-no-adapters", "title": "…", "severity": "error", "trigger": "src/core/", "body": "…"}}

after:

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
    # The order is the provider's rank; phax never re-sorts. { "guarantees": [] } means nothing to report. Extra keys are ignored.
    # No severity, no title, no trigger, no body.

### api: brief section of the phase's first prompt — indicative

before:

    ## Orientation for this phase (expand a row before touching its files)

    - [error] core-no-adapters — src/core imports no adapter (when: src/core/)
    - …and 12 more not shown. Use `phax orient --file <path>` to reach any file's rows.

    Expand a row's full detail with `phax orient <id>`.
    For a file not listed above — including one the plan did not predict — get its index with `phax orient --file <path>`.

after:

    ## Brief for this phase

    What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.

    - core-no-adapters — src/core imports no adapter from src/infra · forbidden src/core/billing/invoice.ts:3 (this phase)
    - cli-commands-registered — every command module is registered in src/cli/index.ts · missing src/cli/index.ts (later)
    - money-as-cents — amounts are integer cents · accepted src/core/billing/legacy.ts:40
    - …and 12 more not shown. `phax brief` prints the phase's brief whole.

    Before touching any file, whether planned or not and existing or not yet created, run `phax brief <path> [<path>…]` to see the guarantees over it, their state there, what is wrong and how to repair it.
    `phax brief` with no path prints this phase's brief whole.
    To learn where the phase stands, run the gate commands listed below. The brief never fails the phase.

    # Pushed brief unavailable:  "The brief is unavailable at phase start (brief provider exited with code 1). `phax brief` may still answer." followed by the same instructions.
    # Empty answer:              "The brief provider has nothing to report on this phase's planned files." followed by the same instructions.
    # Normative: the section is present whenever `brief` is configured and absent otherwise; it has one line per guarantee in provider order,
    # each with id, statement and the non-met places' state, location and due, and no `what` or repair; it has a cap of 50 with a not-shown line naming `phax brief`;
    # and it carries the three instructions. Indicative: the heading, the separators and the wording.

### cli: phax brief [path…] — normative

before:

    $ phax orient core-no-adapters
    $ phax orient --file src/jobs/sync.ts
    [error] core-no-adapters — src/core imports no adapter

after:

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
    $? = 2

    $ phax brief ../elsewhere.ts
    ✗ phax brief: ../elsewhere.ts is outside the worktree
    $? = 2

    $ phax brief src/a.ts              # the provider exits 1, prints non-JSON, or exceeds the time limit
    ✗ brief provider exited with code 1: <stderr excerpt>
    $? = 1

    $ phax brief src/a.ts              # no `brief` key
    ✗ No brief provider is configured: add "brief": { "command": "…" } to phax.json
    $? = 1

    # Normative: the command name, variadic paths and no other argument or flag; the request each form sends;
    # exit 0 on any answer, 1 on failure or no provider, 2 on usage errors; a whole-form answer carries every field.
    # Indicative: the layout and the wording.

### cli: run output when the pushed brief fails — indicative

before:

    [phax] Warning: phase "phase-02" — orient provider query failed (Orient provider exited with code 1). Dispatching without an orientation brief.

after:

    [phax] Warning: phase "phase-02" — brief unavailable (brief provider exited with code 1). The phase runs without it.

    # Normative: one warning naming the phase and the reason, and the phase is dispatched. Indicative: the wording.

### file: <phase folder>/brief-NN.json — normative

before:

    orient-brief.json
    { "kind": "ok", "files": [ … ], "rows": [ … ], "rowCount": 3, "wovenRowCount": 3 }
    # or { "kind": "failed", "files": [ … ], "error": "…" } or { "kind": "not-configured" }

after:

    <phase folder>/
      prompt.md
      brief-00.json        # the pushed brief
      brief-01.json        # the first `phax brief` of the phase
      brief-02.json
      checks-attempt-01.log
      checks-attempt-01.request.json
      …
      (no orient-brief.json; no brief file at all when `brief` is not configured)

    brief-01.json:
    {
      "$schema": "https://docs.phax.run/schemas/brief-record/0.19.0.json",
      "moment": "pulled",
      "request": { "$schema": "…/brief-request/0.19.0.json", "phase": "phase-02", "base": "3f2a91c0…",
                   "terminal": false, "phases": [ … ], "files": ["src/core/billing/tax.ts"] },
      "outcome": { "kind": "answered", "answer": { "guarantees": [ … ] } }
    }

    # moment: "pushed" (00 only) | "pulled".
    # outcome: { "kind": "answered", "answer" } | { "kind": "failed", "reason": "brief provider exited with code 1" }
    # Every brief file rides the phase record on phax/records/v1. Replay: jq -c .request brief-01.json | steme brief

### file: security.json agent commands — normative

before:

    { "command": "phax orient", "source": "orient", "explicit": false, … }

after:

    { "command": "phax brief", "source": "brief", "explicit": false, … }

    # source: "config" | "gate" | "brief". The value "orient" leaves the enum.

### package: @lbdremy/phax-schemas — formats `brief-request` and `brief-record` — normative

before:

    README §Persisted formats has no brief row; the package exports no brief parser. orient-brief.json is not a package format.

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
    { "$schema": "…/brief-record/0.19.0.json", "moment": "pushed", … }
    --- brief-01.json ---
    { "$schema": "…/brief-record/0.19.0.json", "moment": "pulled", … }

    # Normative: the `--briefs` flag, and every brief record printed in number order under its file name. Indicative: the header line.

### cli: phax --usage — normative

before:

    cmd "orient" {
        help "Pull orientation from the configured orient provider: expand a row by id, or pass --file to get an index for an arbitrary file"
        arg "[id]"
        flag "--file" { arg "<path>" }
    }

after:

    cmd "brief" {
        help "Ask the configured brief provider which guarantees range over the given paths and how each stands there; with no path, inside a phase, the phase's brief"
        arg "[path]..."
    }
    (cmd "orient" removed; `records explain` gains flag "--briefs")

    # Normative: `brief` replaces `orient`, takes variadic paths and has no flags. The long help carries the request and answer contract.
    # Indicative: the help wording.

### file: examples/hello-world/ — indicative

before:

    phax.json  "orient": { "command": "node ./orient.mjs" }
    orient.mjs # static rows by prefix, index and expand

after:

    phax.json  "brief": { "command": "node ./brief.mjs" }, no "orient"
    brief.mjs  # reads the brief request; for files null, briefs the gated phase's planned files from `phases`;
               # reports `hw-no-io` over src/: met, or forbidden with what and repair where greet.ts imports node:fs
    (orient.mjs deleted)

## 7. Non-goals

- The brief at plan authoring (the architecture brief): the same provider verb at an earlier moment, left to a later spec.
- The audit and the gate: the gate request, verdicts, fix prompts and attribution belong to `gate-request` and `drop-gate-scopes`, and nothing in them changes here.
- A diagnostic `id`, accepted debt in the audit's document, ranges, structured repair and a decision class.
- phax ranking, filtering, grouping or deduplicating guarantees, computing a state or a due, or checking an answer against its request. Decoding the shape is the only check.
- Briefs in fix-loop prompts, in review or compliance prompts, or woven again on resume.
- Asking for a guarantee by id (`phax brief <id>`), a `--json` output for `phax brief`, or any flag on it.
- Severity, title, trigger or a body in the answer.
- A configurable time limit or cap, or per-provider options in the `brief` key.
- Recording `phax brief` calls made outside a phase.
- Renaming the authoring `--brief` flag or `docs/briefs/`.
- Migrating a config that declares `orient`, refusing it with a message of its own, or reading `orient-brief.json` and the `orient` agent-command source in earlier records.
- Building steme's `steme brief`, and the cross-run durable context layer (NEXT_STEPS) that once named the orient provider.

## 8. Acceptance criteria

### The pushed brief carries the gate request's facts

Given a three-phase run whose phax.json declares `"brief": { "command": "node ./brief.mjs" }` and a gate step declaring `"input": "gate-request"`, where brief.mjs saves its stdin and prints `{ "guarantees": [] }`, when phase-02 starts and its gate later runs, then brief.mjs ran once, before the first prompt was written. Its saved stdin is a JSON object with exactly the keys `$schema`, `phase`, `base`, `terminal`, `phases` and `files`. `$schema` starts with `https://docs.phax.run/schemas/brief-request/` and `files` is `null`. `phase`, `base`, `terminal` and `phases` equal those of phase-02's `checks-attempt-01.request.json`. (refs §5.1, §5.5, §5.6, §5.7, §5.8, §5.12)

### A nearer layer overrides the provider

Given `"brief": { "command": "node ./a.mjs" }` in phax.json and `"brief": { "command": "node ./b.mjs" }` in phax.local.json, when a phase starts, then b.mjs receives the pushed brief request and a.mjs is not run. (refs §5.1)

### A config with `orient` meets the ordinary refusal

Given in turn, `phax.json`, `phax.local.json` and `~/.phax/config.json` each declaring `"orient": { "command": "node ./orient.mjs" }`, with the other layers clean, when `phax validate` runs, then `phax run --plan <plan>` runs, then both exit 2 before any run or worktree is created, with the message every unknown key gets today and no message specific to `orient`. (refs §5.2)

### `phax schema upgrade` describes `brief`

Given a project whose `phax.json` still declares `orient` and whose `phax.schema.json` predates the change, when `phax schema upgrade` runs, then it succeeds, `phax.schema.json` and `phax.user.schema.json` have a `brief` property and no `orient` property, and `phax.json` is byte-for-byte unchanged. (refs §5.3)

### orient leaves no trace

Given a run with `brief` configured, when `phax orient --file src/a.ts` runs, `phax --usage` is read, and phase-01 completes, then `phax orient` fails as an unknown command. The usage spec has `cmd "brief"` and no `cmd "orient"`. The phase folder has no `orient-brief.json`. `prompt.md` contains neither `Orientation` nor `phax orient`. (refs §5.4)

### The worktree knows its phase, across a resume

Given phase-02 started with `brief` configured, then stopped with its gate exhausted, and `.phax-context/brief-request.json` deleted from its worktree, when the agent's first turn begins, and later `phax resume <run>` runs, then at the first turn, the file holds a JSON value equal to the `request` of `brief-00.json`. After the resume, the file exists again with the same value. brief.mjs was not run by the resume, and `brief-00.json` is unchanged. (refs §5.13, §5.6)

### A pull names paths, existing or not

Given phase-02's worktree, where `src/core/billing/tax.ts` does not exist, when the agent runs `phax brief billing/tax.ts billing/invoice.ts billing/tax.ts` from `src/core`, then brief.mjs receives phase-02's phase facts, identical to those in the phase request file, and `files` equal to `["src/core/billing/tax.ts", "src/core/billing/invoice.ts"]`. Nothing marks tax.ts as missing. (refs §5.14, §5.9)

### `phax brief` with no path is the phase's brief, whole

Given phase-02's worktree and a provider that answers one guarantee with a `forbidden` place carrying `due`, `what` and `repair`, when the agent runs `phax brief` with no argument, then the request sent equals the phase request file, with `files` `null`. stdout shows the guarantee's id and statement and the place's state, location, due, `what` and repair. The exit code is 0. (refs §5.8, §5.14, §5.19)

### Outside a phase, files only and nothing recorded

Given a clone of the repository with no `.phax-context/brief-request.json` and `brief` configured, when `phax brief src/greet.ts`, then `phax brief`, then `phax brief ../elsewhere.ts` run, then the first sends exactly `{ "$schema": …, "files": ["src/greet.ts"] }` and writes nothing under any run or phase folder. The second and third exit 2 without running the provider. (refs §5.10, §5.11, §5.31)

### The pushed form is compact, ordered and capped

Given a provider answering 53 guarantees `g01` … `g53` in that order, `g01` with a `forbidden` place at `src/a.ts:3` due `this-phase` whose `what` is `W1` and repair is `R1`, when a phase starts, then `prompt.md` has a `## Brief for this phase` section listing `g01` through `g50`, one line each, in that order. `g01`'s line holds its id, its statement, `forbidden`, `src/a.ts:3` and `this phase`, but neither `W1` nor `R1`. A following line says 3 more are not shown and names `phax brief`. (refs §5.17, §5.18, §5.16)

### A pull prints everything in the provider's order

Given the same 53-guarantee answer, with places in the order the provider gave, when `phax brief src/a.ts` runs in the phase, then stdout lists all 53 guarantees in the provider's order, and every place in its order with state, location, due, `what` and repair where the state has them. The exit code is 0. (refs §5.19, §5.16)

### The answer's variants are checked, extra keys ignored

Given in turn, an answer with a place `"state": "stale"`, one with a `missing` place lacking `repair`, and one with a `met` place `{ "location": { "file": "src/a.ts" }, "state": "met", "score": 3 }`, when each is returned to `phax brief src/a.ts` and as the pushed brief, then the first two make `phax brief` exit 1 with a schema failure on stderr, and the pushed brief is marked unavailable while the phase runs. The third is printed and woven with no error. (refs §5.15, §5.23, §5.22)

### Nothing to report

Given a provider answering `{ "guarantees": [] }`, when a phase starts and the agent runs `phax brief src/x.ts`, then the brief section says the provider has nothing to report and keeps the instructions, and `phax brief` prints `No brief for src/x.ts.` and exits 0. (refs §5.20)

### A failing, silent or slow pushed brief never blocks

Given in turn, a provider that exits 1, one that prints `not json` with exit 0, and one that never exits, when phase-01 of a one-phase run starts each time, then each time the agent is dispatched; for the never-exiting provider this happens after the brief time limit, and that provider process is no longer running. The run output warns naming `phase-01` and the reason. The brief section says the brief is unavailable and why, and keeps the instructions. `brief-00.json` has `moment` `pushed` and outcome `{ "kind": "failed", "reason": … }`. The run ends with the same state and exit code as the same run with no `brief` configured. (refs §5.22, §5.21, §5.29, §5.24)

### A failing pull is reported and recorded

Given phase-02 with a provider that exits 1 on a pull, when the agent runs `phax brief src/a.ts`, then stderr carries the reason and the exit code is 1. The phase goes on. The phase's record holds a brief record with `moment` `pulled`, the request as sent, and outcome `failed`. (refs §5.23, §5.30)

### A brief judges nothing

Given a provider whose answer holds a `forbidden` place due `this-phase` on a planned file, and an audit step that prints `{ "diagnostics": [] }`, when the phase's gate runs, then the gate passes, `gate-attribution.json` records `pass` for the audit step, and the phase commits. (refs §5.24)

### `phax brief` is granted only with a provider

Given a run in `secure` mode on a provider with a command allowlist, first with `brief` configured and then without it, when a phase runs, then with `brief` configured, `security.json` lists `{ "command": "phax brief", "source": "brief", "explicit": false, … }` and the agent's `phax brief` call succeeds. Without it, no such entry exists. (refs §5.25)

### No provider, no brief

Given a project with no `brief` key in any layer, when a phase runs and `phax brief src/a.ts` runs in its worktree, then `prompt.md` has no brief section. The phase folder has no `brief-NN.json`. The worktree has no `.phax-context/brief-request.json`. `phax brief` exits 1 with a message naming the `brief` key. (refs §5.26, §5.27)

### The agent is told how to pull and where to look for the verdict

Given `brief` configured, when a phase's first prompt is built, then the brief section tells the agent to run `phax brief <path>` on any file, planned or not and existing or not, before touching it, and to run `phax brief` with no path for the phase's whole brief. It also says the gate commands listed in the prompt are how to learn where the phase stands. (refs §5.28)

### The record carries and shows every brief

Given a committed phase with records enabled, whose agent ran `phax brief` three times across two sessions (a resume in between), the second call failing, when `phax records explain <record commit> --briefs` runs, and `jq -c .request brief-01.json | node ./brief.mjs` runs in the same tree, then the record holds `brief-00.json` (`pushed`) and `brief-01.json` through `brief-03.json` (`pulled`), in call order, each with its request as sent and its outcome, `brief-02.json` being `failed`. The command prints the four files in number order, each under `--- brief-NN.json ---`. The replay prints the answer recorded in `brief-01.json`. (refs §5.29, §5.30, §5.33)

### The two formats are published

Given a `brief-01.json` written by phax and the `request` it holds, when they are passed to `parseBriefRecord`, `parseBriefRequest` and `parseDocument` from `@lbdremy/phax-schemas`, then each parse succeeds, and `parseDocument` identifies `brief-record` and `brief-request`. The package ships `json/brief-record.schema.json` and `json/brief-request.schema.json`. README §Persisted formats has both rows. The snapshot gate passes with both `next` shapes recorded. (refs §5.32)

### Docs and example describe the brief

Given the repository after the change, when `examples/hello-world/` is inspected, `phax validate` runs there, and README.md, docs/cli/reference.md, phax.usage.kdl, phax.schema.json, phax.user.schema.json and docs/blog/announcing-phax-1.0.md are searched, then hello-world's phax.json declares `brief` and no `orient`. `brief.mjs` exists and `orient.mjs` does not. `phax validate` exits 0, and the example-provider integration test passes against `brief.mjs`. README §Extend phax has a Brief provider section and no Orient provider section. No searched file mentions `phax orient` or an `orient` key. (refs §5.34)

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
- The gate request extended with `files` (null for the gate) — abandons: gate-request's settled "exactly five keys" (Approved §5.6), and a gate step would receive a key that means nothing to it. It also leaves no shape for a call outside a phase.
- The gate request verbatim on stdin, with the paths as arguments to the provider command — abandons: Stdin as the single channel. Paths become argv that the provider must parse, and outside a phase there is no gate request to send.

Recommendation: Its own format `brief-request`: the gate request's four fact keys with the same names, types and values, plus `files`; outside a phase, `$schema` and `files` only — Decided by the author on 2026-10-05, as recommended. The facts are shared by value, not by format: for the same phase, `phase`, `base`, `terminal` and `phases` are identical in both documents, which is what keeps the two verbs from disagreeing. The approved gate request stays untouched. The out-of-phase call gets an explicit variant instead of null facts, and `$schema` tells a provider which verb it is serving. A second, nearly identical parser is a small price.

### Q4 — Does the pushed form keep a cap, and which? (Decided by the author on 2026-10-05; not reopened.)

- Keep a cap of 50 guarantees, in provider order, with a not-shown line naming `phax brief` — abandons: The provider's whole word in the prompt. Guarantees past the 50th reach the agent only if it pulls, whether or not they are due this phase.
- No cap — abandons: A bound on every phase prompt. A provider answering with thousands of guarantees inflates the cost of each first prompt.
- A cap in bytes or lines — abandons: A cut the agent can reason about. Where the text stops depends on statement lengths, not on rank, and the cut can fall mid-guarantee.

Recommendation: Keep a cap of 50 guarantees, in provider order, with a not-shown line naming `phax brief` — Decided by the author on 2026-10-05, as recommended. Order is the provider's rank, so the cut drops what the provider ranks lowest, and the not-shown line says how to reach the rest. Counting guarantees keeps each one whole. 50 is today's value and has caused no trouble. Losing the tail from the prompt is acceptable because the tail is one `phax brief` away and a provider that ranks due guarantees first loses nothing that matters.

### Q5 — Can a guarantee be asked for by id (`phax brief <id> [paths]`)? (Decided by the author on 2026-10-05; not reopened.)

- No: `phax brief [path…]` only — abandons: Re-reading one guarantee without the others on the same paths. The agent finds it in the whole answer instead.
- Yes: `phax brief <id> [paths]`, with the request gaining a `guarantee` key — abandons: One argument grammar: an id and a path are both bare words, and `money-as-cents` could be a file. It also adds a request key and a provider behaviour the first consumer does not need.

Recommendation: No: `phax brief [path…]` only — Decided by the author on 2026-10-05, as recommended. orient needed expand because its index carried no body. A whole brief already carries every statement, state, `what` and repair, so the agent never needs a second round trip. Keeping to what the first consumer needs, the lost convenience is small and can be added later as a new key without breaking the request.

### Q6 — Does severity survive once state is in the answer? (Decided by the author on 2026-10-05; not reopened.)

- Drop severity — abandons: A per-guarantee weight independent of order. A provider can no longer say error versus info.
- Keep `severity: error|warn|info` per guarantee, beside state — abandons: One ranking signal. Severity and order can disagree, and phax would render a second rank that it did not make and cannot reconcile.

Recommendation: Drop severity — Decided by the author on 2026-10-05, as recommended. State says what to do at a place (fix what is missing or forbidden, leave accepted debt alone), and due says when; order says what matters most. Severity added a third axis that only made sense when the answer carried no state, and the audit, not the brief, is where weight becomes a verdict. Losing the explicit label is acceptable because the provider still ranks by order.

## 10. Implementation-planning note

Settled:

- Config: `brief: {command}` in the three layers, with `orient`'s precedence. `orient` leaves the contract and gets the ordinary unknown-key refusal (exit 2) with no migration. `phax schema upgrade` regenerates both local schemas and never touches `phax.json`.
- Request: its own format, `brief-request`. Inside a phase it holds `$schema`, the phase facts (the same values as the phase's gate request) and `files`: `null` for the phase's brief, otherwise the named paths, worktree-root-relative, deduplicated, in the order given and never checked for existence. Outside a phase it holds `$schema` and `files` only. Usage errors exit 2.
- Phase identity: the phase request file `.phax-context/brief-request.json`, written at phase start and on resume when `brief` is configured. `phax brief` reads it from any directory of the worktree, and without it the call is outside a phase.
- Answer: structured `{guarantees: [{id, statement, places}]}` with per-state place variants. `due` sits on `missing` and `forbidden` places. `location` is shaped like a diagnostics finding's `{file, line?}`. Extra keys are ignored. The provider's order is the rank. There is no severity, title, trigger or body.
- Pushed brief: requested once per fresh phase start, before the first prompt, and not on resume or in fix and review prompts. It is woven in compact form under `## Brief for this phase`, capped at 50 guarantees with a not-shown line, and followed by the three instructions. It covers the projection's files (create ∪ edit, optional files excluded); the agent pulls an optional file when it decides to touch it.
- Pulled brief: `phax brief [path…]` prints the whole form. It exits 0 on any answer, 1 on failure or a missing provider, and 2 on usage errors. There is no lookup by id.
- Never blocks: every call has a brief time limit. A failure produces a run-output warning, an unavailable line in the prompt and a `failed` record, and it never affects a verdict, a state or an exit code of `phax run` or `phax resume`.
- Records: `brief-NN.json` (format `brief-record`), with `00` the pushed brief and `01`… the pulled ones in call order across sessions. They ride the phase record and print with `phax records explain --briefs`. Nothing is recorded outside a phase, and `orient-brief.json` is no longer written.
- Grant: `phax brief` is allowed automatically when `brief` is configured, with `security.json` source `brief`.

Left open:

- The value of the brief time limit. Recommended: 60 seconds for both moments, held as a constant.
- How a pulled call's record reaches the phase folder. The in-phase agent's sandbox may confine `phax brief`'s writes to the worktree, so writing under `.phax-context/` and collecting before the phase record is written is the likely route. Pulls made after the phase's record is written (a kept-open final phase in review) need a defined answer; not recording them is acceptable.
- A phase request file that is present but does not decode. Recommended: refuse with exit 1 naming the file, rather than silently briefing as outside a phase.
- How `base` is available before the agent's first turn. gate-request leaves open whether `base` is recorded at branch creation or derived later. The pushed brief needs it at phase start, which favours recording it when the branch is created, and one mechanism should serve both.
- The exact compact line, the whole-form layout, the section heading and the instruction wording (indicative in §6).
- Whether `phax records explain` without flags mentions the briefs. A one-line count is suggested.
- Renaming the `orient.*` telemetry events and the orient internals.
- The steme-corpus coordination note (`02-product/phax-steme-coordination.md`: §Along a run, §What is lost, or latent, §The changes rows 4 and 5, §The architecture brief, at plan authoring) could not be read from this authoring session. It is reflected as the brief summarizes it, and the planner should cross-check it. This spec supersedes rows 4 and 5.

Constraints:

- A brief never blocks, and phax judges nothing in it: it ranks, filters and deduplicates nothing, computes no state or due, and does not cross-check the answer against the request. Decoding the shape is the only check.
- Depends on gate-request (Approved): the phase facts are the gate request's, with the same values for the same phase.
- Independent of drop-gate-scopes, but both rewrite the hello-world example and README §Extend phax. Coordinate so the example ends with `brief`, no `orient` and no `scopes`, and the README hook count is right.
- No shims: `orient` is an unknown key, and `orient-brief.json`, the row format, the index and expand contract and the `orient` agent-command source are gone. Earlier records are neither rewritten nor read specially.
- phax does not tie the `brief` provider to any gate step. `steme brief` and `steme audit` are configured separately and share only the facts phax sends.
- This spec lands before steme builds item 8 (`steme brief`). Keep the answer to the fields named here so the first consumer is not frozen into more.
- Relation to oracle-phases (Approved, not built; its text is unchanged): its `oracles: {command}` key mirrored `orient`, and it now sits beside `brief` and `planAuditor` with the same shape.
- This changes CLI and config surface on purpose before the 1.0 freeze: one command and one key are replaced, one flag is added to `records explain`, and two persisted formats are added.

## 11. Docs page

Page: README §Extend phax › Brief provider (replacing §Orient provider), with the `brief-request` and `brief-record` rows in §Persisted formats and `phax brief` in docs/cli/reference.md

Reader: The author of a brief provider, such as steme's `steme brief`, who needs to know what phax sends at phase start and on each pull, what answer it expects, and that phax never judges the answer. A secondary reader is the operator who wants to see what the agent was told during a run.

Example: Declare `"brief": { "command": "node ./brief.mjs" }`. In brief.mjs, read stdin to the end and parse it. When `files` is null, brief the files of the `phases` entry whose `id` is `phase`. Otherwise brief `files`, which may include paths that do not exist yet. When `phase` is present, set `due` to `this-phase` or `later` from what later entries of `phases` still plan; outside a phase, set it to null. Print `{ "guarantees": [{ "id": "hw-no-io", "statement": "greet has no I/O", "places": [{ "location": { "file": "src/greet.ts", "line": 1 }, "state": "forbidden", "due": "this-phase", "what": "imports node:fs", "repair": "remove the import; greet is pure" }] }] }`, most important first. Replay a phase's brief with `node ./brief.mjs < .phax-context/brief-request.json`, and a recorded one with `jq -c .request brief-01.json | node ./brief.mjs`.
