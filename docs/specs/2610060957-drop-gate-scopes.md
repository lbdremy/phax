---
status: Approved
date: 2026-10-06
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-06
  baseline: adf270e
---
# Drop gate scopes: completion findings fail the step like invariants; the scope provider, closure, the pending state and `gate-pending` are removed

## 1. Context

This spec starts from the gate as `drop-orient` leaves it: there is no `orient` hook, and README §Extend phax lists three hooks (Diagnostics gate steps, Scope provider, Plan auditor).

A gate step with `"output": "diagnostics"` prints `{ "diagnostics": [...] }`. Each finding is either an `invariant` (something forbidden is present) or a `completion` (something required is missing), and carries `rule`, `location: {file, line?}`, `message` and `repair`. A completion must also carry `scopes`, a non-empty list of names. An empty list with exit 0 passes. A missing or undecodable document, or an empty list with a non-zero exit, is a provider error that fails the step.

Once per gate attempt, before any step runs, phax resolves scope closure. On the terminal phase every scope is closed. On any other phase whose profile has a diagnostics step, phax runs the configured `scopes` command with `{phase, phases}` on stdin, writes `$ <cmd>`, `stdin: <json>` and the answer to the attempt log, and reads `{"closed": [...]}`. If the provider fails, the gate fails. If no provider is configured, any completion finding fails the step as a configuration error (`missing-provider`). An invariant fails the step, and so does a completion whose scopes are all closed. A completion with a scope still open is pending.

When a step returns only pending findings, `gate-attribution.json` records it as `pending`, which verifies no surface. Pending findings are written to `checks-attempt-NN.pending.json` (format `gate-pending`) and listed in the attempt's fix prompts under `## Pending (optional — not required to pass this gate)`. A green gate announces them as `N completion diagnostic(s) pending (scopes still open: …)`.

`scopes: {command}` is a key of `phax.json`, `phax.local.json` and `~/.phax/config.json`, and the nearest layer wins. `phax schema upgrade` regenerates `phax.schema.json` and `phax.user.schema.json`, whose gate-step `output` description ends with the pending rule. It never touches `phax.json`.

Nobody configures `scopes`, ships a scope provider or reads the diagnostics output: phax, steme-lab, phax-cockpit and louloupapers were checked on 2026-10-05. The only scope provider is phax's own `examples/hello-world/scopes.mjs`, and the example's `audit.mjs` emits only invariants. So no completion finding, `.pending.json` or `pending` result has ever been written outside phax's tests. The first real diagnostics provider will be steme's audit (`steme audit`, roadmap-1.0 item 0.13, not built yet), which reports only what is due and never emits a scope.

Persisted files carry the `$schema` URL `https://docs.phax.run/schemas/<format>/<release>.json`. `@lbdremy/phax-schemas` 0.19.0 reads `gate-diagnostics`, `gate-attribution` and `gate-pending`. Each has a frozen pre-schema module under `src/schemas/history/`, pinned by `packages/schemas/history.lock.json`, and each still has `0.17.0` as its current shape. The package's history convention works like this: a changed shape is recorded as `next.schema.json` and renamed by the release cut; a released snapshot is never removed; and a released snapshot that is no longer current needs a frozen decoder `src/schemas/history/<id>/<release>.ts` of its own.

docs.phax.run has been live since v0.18.0. For every release in the ledger (0.17.0 through 0.19.0) and every format, it serves the latest released snapshot at `/schemas/<id>/<release>.json` and lists that path in `/schemas/index.json`. Its deploy guard refuses any build that would stop serving a listed path, and README §Persisted formats promises that each URL "stays up for good".

The author's order (NEXT_STEPS §Before steme's audit, 2026-10-06) is drop-orient, then this spec, then gate-request and the brief. The first version of this spec, approved on 2026-10-05, depended on gate-request and carried compatibility niceties. It was abandoned on 2026-10-06.

Ground read:

- `docs/specs/archive/2610051445-drop-gate-scopes.md` — The abandoned first version (approved 2026-10-05, abandoned 2026-10-06), with its sidecar. Its context, surface and §9 Q1–Q5 are the ground for the decisions carried over here. It depended on gate-request, put `"input": "gate-request"` on the hello-world step, and left open how the format changes meet the history convention and the docs site.
- `docs/specs/2610060950-drop-orient.md` — Draft. Lands first. Its after-state is this spec's before-state: hello-world declares `scopes`, `planAuditor` and the diagnostics step, README §Extend phax says "Three hooks", and the announcement draft counts two providers. It defines kept history and the live tree, and checks its removal with a mechanical sweep. This spec reuses both definitions.
- `docs/specs/2610060951-gate-request.md` — Draft. Lands after this spec and describes the gate as this spec leaves it: no `scopes` provider, closure, pending state, `pending` result or `gate-pending`, and no `stdin:` line in the attempt log. Nothing in it needs changing.
- `README.md` — §Extend phax: "Four hooks" today (three after drop-orient). §Diagnostics gate steps: "A `completion` finding names the `scopes` it belongs to, and fails the step only once all of them are closed according to your scope provider; until then it is pending, shown to the agent as optional work." §Scope provider: the `{phase, phases}` request and the `{"closed": [...]}` answer. §Persisted formats: the `gate-pending` row, and the promise that each `$schema` URL "stays up for good".
- `src/app/gates.ts` — Once per attempt and before any step, the closure is resolved: `all` on the terminal phase, otherwise a query to the scope provider when the profile has a diagnostics step, or `unavailable` when no provider is configured. The query is logged as `$ <cmd>`, `stdin: <json>` and the answer. Also here: `scheduleDiagnostics`, the `missing-provider` configuration error, `result: "pending"`, `writePendingDoc` and `pendingPathFor`, and `DIAGNOSTICS_EXPECTED_SHAPE`, which names `"scopes"?`. The diagnostics file holds the whole decoded document.
- `src/domain/gate/scheduleDiagnostics.ts` — `ScopeClosure` is all | closed | unavailable. An invariant always fails. A completion fails when every scope it names is closed and is pending otherwise. With `unavailable`, any completion yields `missing-provider`.
- `src/domain/gate/fixPrompt.ts` — A failing finding renders as `- <rule> at <file:line> — <message>` plus `  repair guide: …`, with no class shown. `## Pending (optional — not required to pass this gate)` is appended to both the diagnostics prompt and the log-failure prompt whenever the attempt holds pending findings.
- `src/schemas/gateDiagnostics.ts` — A completion is `{class: "completion", scopes: NonEmptyArray, rule, location, message, repair}`. An invariant is the same without `scopes`. The file shape is `$schema` followed by the stdout document.
- `src/schemas/gatePending.ts` — `{closed: [...], steps: [{command, pending: [{diagnostic, openScopes}]}]}` under a `gate-pending` `$schema`.
- `src/schemas/gateAttribution.ts` — A step result is `"pass" | "fail" | "pending"`. Only `pass` verifies a surface.
- `src/schemas/scopes.ts` — The scope provider's answer `{closed: [...]}`. The request type `ScopesRequest` and `makeScopesRequest` live in src/domain/plan/projection.ts, beside `projectPhases` and `makePlanAuditRequest`, which the plan auditor keeps using. The query itself runs through src/app/scopes.ts.
- `src/schemas/phaxConfig.ts` — `ScopesConfigSchema {command}` sits in the project schema and the user overlay, and its description names closure and pending. `GATE_OUTPUT_DESCRIPTION` names `"scopes"?` and ends with the pending rule. Both schemas reject excess properties.
- `src/domain/config/mergeLayers.ts` — `scopes.command` comes from phax.local.json, then ~/.phax/config.json, then phax.json. src/app/loadConfig.ts passes it through.
- `src/app/executePlan.ts` — Passes `scopesProvider` and `makeScopesRequest(...)` to the gate. On a green gate with pending findings it prints `[phax] phase "<id>" gate: green — N completion diagnostic(s) pending (scopes still open: …)`. `PendingStep` (src/domain/errors.ts) flows through `GatePassed`/`GateFailed` (src/domain/events.ts), src/app/eventAdapter.ts and src/app/fixLoop.ts. `ScopesProviderError` is in src/domain/errors.ts.
- `src/schemas/persisted.ts` — phax reads `gate-attribution.json` for verified surfaces: a `$schema` document with its current decoder only, a document without one with the frozen pre-schema module. A document that fails to decode counts as no verified surface. phax never reads `.diagnostics.json` or `.pending.json`.
- `examples/hello-world/` — `phax.json` declares `scopes` (`node ./scopes.mjs`), `planAuditor` and the diagnostics step `node ./audit.mjs`. `audit.mjs` ignores stdin and emits only invariants (`HW_NO_IO`), so the example never produces a completion. tests/integration/exampleProviders.test.ts runs `scopes.mjs`.
- `packages/schemas/src/formats/recordTimeline.ts` — `gate-attribution`, `gate-diagnostics` and `gate-pending` each have a frozen pre-schema module, `releases: []`, and a current shape that is phax's own file schema. Each `toLatest*` drops `$schema` and keeps every other fact.
- `packages/schemas/build/snapshots.ts` — A shape change is recorded as `next.schema.json`, which the release cut renames. A released snapshot is never rewritten or removed. A released snapshot that is no longer current needs a frozen decoder in the format's `releases` ("freeze it as src/schemas/history/<id>/<release>.ts").
- `scripts/schemas-check.ts` — Checks the generated index (`CURRENT_SHAPES`), the history lock against every module under src/schemas/history/ in both directions (a lock entry for a missing module is a finding, as is a module with no entry), and the snapshots.
- `packages/schemas/history.lock.json` — Pins 15 pre-schema modules, among them gate-attribution, gate-diagnostics and gate-pending. The gate-diagnostics module holds `scopes` and the gate-attribution module holds `"pending"`.
- `packages/schemas/src/generated/index.ts` — PACKAGE_VERSION 0.19.0, FIRST_SUPPORTED_RELEASE 0.17.0. The current shape of gate-attribution, gate-diagnostics and gate-pending is `0.17.0`. This is the first change to a gate format since `$schema`.
- `packages/schemas/README.md` — Promises that every file written from phax 0.17.0 on stays readable.
- `site/build/schemas.ts` — For every release in packages/schemas/releases.json (0.17.0, 0.18.0, 0.19.0) and every id in FORMAT_IDS, serves the latest released snapshot at /schemas/<id>/<release>.json and lists the path in /schemas/index.json. `pre-schema` and `next` are never served.
- `site/build/deploy-guard.ts` — Refuses any build that does not serve a path the live https://docs.phax.run/schemas/index.json lists. Removing `gate-pending` from FORMAT_IDS and its snapshots would drop /schemas/gate-pending/0.17.0.json, 0.18.0.json and 0.19.0.json, so the guard would refuse.
- `docs/release.md` — The guard runs before any upload in the release and docs-deploy workflows, and a refusal stages nothing. The release cut renames `next` snapshots and appends the release to the ledger. docs.phax.run has been live since v0.18.0 (NEXT_STEPS).
- `docs/specs/2609281159-oracle-phases.md` — Approved, not built. It quotes the diagnostics shape with `scopes?` (ground), the attribution result as pass|fail|pending (ground and §5), and `scopes` in §1, in its projection and README ground lines, and in two config examples. Its non-goals list "deriving oracles from `scopes`". Its `oracles` key "mirrors `scopes` and `planAuditor`" and appears in the user overlay "like `scopes`".
- `docs/blog/announcing-phax-1.0.md` — The gates section (lines ~88–95) describes completion findings as pending work until the phase that owns them lands. The providers list (after drop-orient: two providers) has a `scopes` bullet, and the closing line says "offered at … points".
- `docs/ideas/` — coverage-provider.md lists `scopes` among the existing providers. change-gates-from-the-harness.md mentions "`scopes` closure".
- `phax.usage.kdl` — Has no scope, closure or pending-finding text. Its only occurrences of "pending" concern pending phases and pending records, which are unrelated.
- `NEXT_STEPS.md` — §Before steme's audit (reordered 2026-10-06): drop-orient, then drop-gate-scopes, then gate-request and the brief. It records that nobody configures `scopes` or reads the diagnostics output, and has an item to sweep the `oracle-phases` wording. §Road to 1.0.0: the CLI and config contract freeze and the persisted-format stability promise.

## 2. Problem

phax schedules completion findings itself, so the question "is this finding due yet?" is split across two commands and two formats. The diagnostics step says what is wrong. A second provider, queried before the gate with its own request and answer shapes, says which scopes are closed. phax joins the two answers and keeps state it cannot judge: closure, pending findings, a `pending` step result that is neither pass nor fail, and a `gate-pending` record.

A provider that wants to say "not due yet" has to use phax's vocabulary. It must invent scope names, tag every completion with them, and ship a second command that recomputes closure from the plan. steme's audit, the first real provider, would have to build exactly that and later throw it away.

The agent pays too: its fix prompt mixes required work with "optional" work. And all of this is about to freeze with the 1.0 CLI and config contract (NEXT_STEPS §Road to 1.0.0). A key, a format and a step result that are still here at the freeze would have to be carried, or broken, after it. Nobody uses any of it, so removing it costs nothing now, and the cost only grows later.

## 3. Product goal

The diagnostics provider decides what is due and reports only that. phax runs the diagnostics step and reads its verdict, and does nothing more. A completion finding fails the step exactly as an invariant does. Both classes stay in the document, where they say which kind of failure it is: something required is missing, or something forbidden is present.

The `scopes` provider, closure resolution, the pending state, the `missing-provider` failure, the `pending` step result and the `gate-pending` record are removed. Nothing replaces them, and nothing eases their removal. `gate-diagnostics` and `gate-attribution` get next shapes, and `gate-pending` leaves the schemas package. The README, the example, the generated config schemas and the announcement draft stop describing any of it. Scope machinery survives only where history is kept on purpose. Everything else about the gate stays as it is.

> Every finding a diagnostics step reports is due: phax fails the step on it and keeps no schedule of its own.

## 4. Terminology

- **Finding** — One entry of a diagnostics document's `diagnostics` array: `{rule, class, location: {file, line?}, message, repair}`.
- **Completion finding** — A finding with `class: "completion"`: something the change requires is missing.
- **Invariant finding** — A finding with `class: "invariant"`: something the change forbids is present.
- **Diagnostics provider** — The command of a gate step that declares `"output": "diagnostics"`, such as hello-world's `audit.mjs` or, later, `steme audit`.
- **Due** — Ready to be judged now. After this spec, only the diagnostics provider decides what is due, from what it can read itself: git and the worktree. phax treats every reported finding as due.
- **Scope machinery** — What this spec removes: the `scopes` config key and its provider contract, closure resolution and its query, pending findings, the `pending` step result, `.pending.json` and the `gate-pending` format, the fix prompt's pending section, the green-gate pending line and the `missing-provider` failure. The term is used only to say what goes.
- **Next shape** — A format's changed shape. It is recorded as `packages/schemas/snapshots/<id>/next.schema.json` and published under the release that ships it, when the release cut renames the snapshot.
- **Frozen history** — The modules under `src/schemas/history/` that `packages/schemas/history.lock.json` pins, and the released snapshots under `packages/schemas/snapshots/`. The package's history convention keeps them byte for byte.
- **Served schema** — A JSON Schema that docs.phax.run serves at `/schemas/<id>/<release>.json` and lists in `/schemas/index.json`. The deploy guard protects every listed path.
- **Kept history** — As drop-orient defines it: `docs/specs/` and `docs/plans/` (archived and live, with sidecars and approval records), `docs/briefs/`, `docs/spikes/` and `NEXT_STEPS.md`, plus the untracked git history, records on `phax/records/v1` and earlier phase folders. For this spec it also includes the frozen history of `gate-diagnostics` and `gate-attribution` and the served `gate-pending` schemas (§9 q-served).
- **Live tree** — Every tracked file that is not kept history: code, tests, scripts, packages, generated contract files, the README, `docs/` outside the kept paths (`docs/ideas/` included), examples and the shipped skills.

## 5. Functional requirements

### 5.1 Any finding fails the step

The system shall fail a diagnostics step whose document holds at least one finding, of either class, whatever the step's exit code.

### 5.2 One rule on every phase

The system shall judge a diagnostics step's findings by the same rule on the terminal phase and on every other phase, taking nothing from the plan, the phase's position or git into the verdict.

### 5.3 The other verdict rules stay

The system shall keep every other verdict rule of a diagnostics step as it is today: an empty list with exit 0 passes, and a missing or undecodable document, or an empty list with a non-zero exit, is a provider error that fails the step with the raw log.

### 5.4 The rest of the gate stays

The system shall keep gate steps, their profile order, `surface`, `firing`, `output`, the stop at the first failing step, the fix loop and the attribution of every step that ran exactly as they are today.

### 5.5 Only the selected steps run

WHEN a gate attempt runs THE system SHALL start no process other than the profile's selected steps and SHALL write to the attempt log only those steps' entries.

### 5.6 Attribution is pass or fail

The system shall record every step that ran in `gate-attribution.json`, in the next `gate-attribution` shape, with a `result` of `"pass"` or `"fail"`.

### 5.7 The diagnostics file is the next shape

WHEN a diagnostics step fails on its findings THE system SHALL save its document as `checks-attempt-NN.diagnostics.json` in the next `gate-diagnostics` shape.

### 5.8 No pending file

The system shall write no `checks-attempt-NN.pending.json` file.

### 5.9 The provider error states the next shape

IF a diagnostics step's document is missing or undecodable THEN the system SHALL state the expected document as `{"diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]}` in the provider error it logs and reports.

### 5.10 The fix prompt lists both classes alike

WHEN a fix prompt lists a failing step's findings THE system SHALL list every finding in the provider's order, both classes alike, as it renders failing findings today, with no class tag and no legend.

### 5.11 No pending section

The system shall build every fix prompt with no pending or optional-work section.

### 5.12 A green gate announces nothing pending

WHEN a phase's gate passes THE system SHALL print the output it prints today for a passing gate with no findings, with no line counting pending findings.

### 5.13 No scope provider in the configuration contract

The configuration contract of `phax.json`, `phax.local.json` and `~/.phax/config.json` shall have no scope provider key, and shall keep every other key and its layer precedence as they are today.

### 5.14 The local schemas follow the contract

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` and a `phax.user.schema.json` whose top-level properties are exactly those of the configuration contract and whose gate-step `output` description names no scope, closure or pending finding, and SHALL leave `phax.json` unchanged.

### 5.15 `gate-diagnostics` next shape

The schemas package shall publish as the `gate-diagnostics` next shape a document in which an invariant finding and a completion finding carry exactly the same fields: `rule`, `class`, `location: {file, line?}`, `message` and `repair`.

### 5.16 `gate-attribution` next shape

The schemas package shall publish as the `gate-attribution` next shape a step `result` of exactly `pass` or `fail`.

### 5.17 `gate-pending` leaves the package

The schemas package shall have no `gate-pending` format (no format id, parser, upgrade function, type, current or frozen shape, snapshot or JSON Schema), and README §Persisted formats shall have no `gate-pending` row.

### 5.18 The gate formats' history is kept as the convention requires

The schemas package shall keep the frozen pre-schema modules and every released snapshot of `gate-diagnostics` and `gate-attribution` byte for byte, and shall read each of these formats' `0.17.0` shape through a frozen module of its own.

### 5.19 The history lock changes by three entries

`packages/schemas/history.lock.json` shall differ from today's by exactly three entries: `src/schemas/history/gate-pending/pre-schema.ts` removed, and `src/schemas/history/gate-diagnostics/0.17.0.ts` and `src/schemas/history/gate-attribution/0.17.0.ts` added.

### 5.20 Served `gate-pending` URLs stay up

The docs site shall keep serving byte for byte, and keep listing in `/schemas/index.json`, every `gate-pending` schema URL that docs.phax.run serves before this change, and shall serve no `gate-pending` URL for any later release.

### 5.21 The example has no scope provider

The hello-world example shall declare no scope provider, ship no scope provider script, and keep its diagnostics step and `audit.mjs` as they are.

### 5.22 The docs describe no scope machinery

The README, `phax --usage`, `phax.usage.kdl`, `docs/cli/reference.md`, the generated config schemas, `docs/blog/announcing-phax-1.0.md`, `docs/ideas/` and `examples/hello-world/` shall describe no scope provider, scope closure or pending finding, and README §Diagnostics gate steps shall state that an invariant finding and a completion finding both fail the step.

### 5.23 Counts match what is listed

README §Extend phax shall state a hook count equal to the number of hook subsections it lists, and the 1.0 announcement draft shall state a provider count equal to the number of providers it lists.

### 5.24 The live tree is swept

The live tree shall contain none of the scope machinery's identifiers, file names, config key or section names.

## 6. Surface

### config: phax.json / phax.local.json / ~/.phax/config.json — normative

before:

    {
      "version": 1,
      "name": "hello-world",
      "security": { "agentCommands": ["node"] },
      "scopes": { "command": "node ./scopes.mjs" },
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": {
        "standard": [
          { "command": "node ./audit.mjs", "surface": "structural",
            "firing": "every-phase", "output": "diagnostics" }
        ]
      }
    }

    # As drop-orient leaves it.

after:

    {
      "version": 1,
      "name": "hello-world",
      "security": { "agentCommands": ["node"] },
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": {
        "standard": [
          { "command": "node ./audit.mjs", "surface": "structural",
            "firing": "every-phase", "output": "diagnostics" }
        ]
      }
    }

    # `scopes` is not part of the contract in any of the three layers. Every other key and its precedence is unchanged. `version` stays 1.
    # Nothing is added for the removal: no message, no migration, no deprecation.

### file: phax.schema.json and phax.user.schema.json (written by `phax schema upgrade`, committed at the repo root) — normative

before:

    phax.schema.json top-level properties:
      $schema, version, name, state, agent, commands, fileReconciliation, security, publish,
      scopes, planAuditor, review, authoring, gateProfiles, workspaces, records
    phax.user.schema.json top-level properties:
      state, agent, commands, fileReconciliation, security, publish,
      scopes, planAuditor, review, authoring, gateProfiles, workspaces

    gate step "output" description:
      '"log" (default) streams raw command output. "diagnostics" expects {"diagnostics": [{"rule", "class": "invariant"|"completion", "scopes"?: [...], "location": {"file", "line"?}, "message", "repair"}]} on stdout. Verdict rules: … A completion diagnostic names one or more scopes and is pending — not failing — until every scope it names is closed by the "scopes" provider.'

    # As drop-orient leaves them.

after:

    phax.schema.json top-level properties:
      $schema, version, name, state, agent, commands, fileReconciliation, security, publish,
      planAuditor, review, authoring, gateProfiles, workspaces, records
    phax.user.schema.json top-level properties:
      state, agent, commands, fileReconciliation, security, publish,
      planAuditor, review, authoring, gateProfiles, workspaces

    gate step "output" description (wording indicative):
      '"log" (default) streams raw command output. "diagnostics" expects {"diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]} on stdout. Verdict rules: a non-empty list fails the step whatever the exit code, an invariant and a completion alike; exit 0 with an empty list passes; …'

    $ phax schema upgrade      # phax.json is not read, validated or modified (unchanged behavior)

    # Normative: the property lists, and no scope, closure or pending wording anywhere in either file.

### api: diagnostics document printed by a gate step on stdout — normative

before:

    {
      "diagnostics": [
        { "rule": "wire-invoice-cli", "class": "completion", "scopes": ["cli"],
          "location": { "file": "src/cli/index.ts", "line": 12 },
          "message": "the invoice command is not registered",
          "repair": "register invoiceCommand in src/cli/index.ts" },
        { "rule": "no-cycles", "class": "invariant",
          "location": { "file": "src/a.ts", "line": 3 },
          "message": "…", "repair": "…" }
      ]
    }
    # The completion is pending while "cli" is open and fails once it is closed. The invariant fails.

after:

    {
      "diagnostics": [
        { "rule": "wire-invoice-cli", "class": "completion",
          "location": { "file": "src/cli/index.ts", "line": 12 },
          "message": "the invoice command is not registered",
          "repair": "register invoiceCommand in src/cli/index.ts" },
        { "rule": "no-cycles", "class": "invariant",
          "location": { "file": "src/a.ts", "line": 3 },
          "message": "…", "repair": "…" }
      ]
    }
    # Both findings fail the step. The provider reports a completion only once it is due.

### cli: provider error for a missing or undecodable diagnostics document (attempt log and gate failure message) — normative

before:

    provider error: step declared diagnostics output but returned none: invalid JSON: … — expected {"diagnostics": [{"rule", "class": "invariant"|"completion", "scopes"?: [...], "location": {"file", "line"?}, "message", "repair"}]} on stdout

after:

    provider error: step declared diagnostics output but returned none: invalid JSON: … — expected {"diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]} on stdout

    # Normative: the expected document. Indicative: the surrounding wording, which is unchanged.

### file: <phase folder>/checks-attempt-NN.log — the attempt log — normative

before:

    $ node ./scopes.mjs
    stdin: {"phase":"phase-02","phases":[{"id":"phase-01","files":[…]},…]}
    {"closed":["core"]}

    $ pnpm test
    …
    exit 0

    $ node ./audit.mjs
    {"diagnostics":[…]}
    exit 0

after:

    $ pnpm test
    …
    exit 0

    $ node ./audit.mjs
    {"diagnostics":[…]}
    exit 0

    # Only the selected steps' entries. No line begins with `stdin:`.

### file: <phase folder>/ — gate attempt files — normative

before:

    checks-attempt-01.log
    check-attempt-01.diagnostics.json  # wait — see below


after:

    checks-attempt-01.log
    checks-attempt-01.diagnostics.json  # next gate-diagnostics shape, written when a diagnostics step fails on findings
    gate-attribution.json               # next gate-attribution shape: result "pass" | "fail"

    # No .pending.json is ever written. Phase folders and records of earlier releases keep their files as written; nothing reads, moves or deletes them.

### file: checks-attempt-NN.diagnostics.json — `gate-diagnostics` next shape — normative

before:

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.19.0.json",
      "diagnostics": [
        { "rule": "wire-invoice-cli", "class": "completion", "scopes": ["cli"],
          "location": { "file": "src/cli/index.ts", "line": 12 }, "message": "…", "repair": "…" }
      ]
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json",
      "diagnostics": [
        { "rule": "wire-invoice-cli", "class": "completion",
          "location": { "file": "src/cli/index.ts", "line": 12 }, "message": "…", "repair": "…" }
      ]
    }

    # Normative: an invariant and a completion share one field set, {rule, class, location: {file, line?}, message, repair}. The release number is illustrative: it is the release that ships this change.

### file: gate-attribution.json — `gate-attribution` next shape — normative

before:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.19.0.json",
      "phase": "phase-02",
      "steps": [
        { "command": "pnpm test", "surface": "local", "result": "pass" },
        { "command": "node ./audit.mjs", "surface": "structural", "result": "pending" }
      ]
    }
    # result: "pass" | "fail" | "pending"

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.20.0.json",
      "phase": "phase-02",
      "steps": [
        { "command": "pnpm test", "surface": "local", "result": "pass" },
        { "command": "node ./audit.mjs", "surface": "structural", "result": "fail" }
      ]
    }
    # result: "pass" | "fail". No other value. The release number is illustrative.

### api: fix prompt sent to the agent — normative

before:

    ## Diagnostics

    - no-cycles at src/a.ts:3 — …
      repair guide: …

    Full output: …/checks-attempt-01.log

    ## Pending (optional — not required to pass this gate)

    These completion diagnostics name scopes a later phase is planned to close.
    You may address them now if it is cheap; the gate does not require it.

    - wire-invoice-cli at src/cli/index.ts:12 — … (scopes still open: cli)
      repair guide: …

    ## Required action
    …

after:

    ## Diagnostics

    - wire-invoice-cli at src/cli/index.ts:12 — the invoice command is not registered
      repair guide: register invoiceCommand in src/cli/index.ts
    - no-cycles at src/a.ts:3 — …
      repair guide: …

    Full output: …/checks-attempt-01.log

    ## Required action
    …

    # Normative: the findings appear in the provider's order and render exactly as failing findings render today, with no class tag and no legend. No prompt, whether a diagnostics failure or a log failure, has a pending or optional section. Every other line is unchanged.

### cli: phax run / phax resume — output on a green gate — normative

before:

    [phax] phase "phase-02" gate: green — 1 completion diagnostic(s) pending (scopes still open: cli)

after:

    (no pending line: a green gate prints what it prints today for a gate with no findings)

### package: @lbdremy/phax-schemas — gate formats, history and exports — normative

before:

    snapshots/gate-diagnostics/  pre-schema.schema.json, 0.17.0.schema.json   # completion carries scopes
    snapshots/gate-attribution/  pre-schema.schema.json, 0.17.0.schema.json   # result pass | fail | pending
    snapshots/gate-pending/      pre-schema.schema.json, 0.17.0.schema.json
    src/schemas/history/gate-diagnostics/pre-schema.ts     (pinned)
    src/schemas/history/gate-attribution/pre-schema.ts     (pinned)
    src/schemas/history/gate-pending/pre-schema.ts         (pinned)
    history.lock.json: 15 entries
    CURRENT_SHAPES: "gate-attribution": "0.17.0", "gate-diagnostics": "0.17.0", "gate-pending": "0.17.0"
    exports: parseGatePending, toLatestGatePending, LatestGatePending, GatePendingShape, …; parseDocument knows gate-pending
    json/gate-pending.schema.json
    README §Persisted formats: | Gate pending | `gate-pending` | `<record>/checks-attempt-NN.pending.json` | `parseGatePending` | `json/gate-pending.schema.json` |

after:

    snapshots/gate-diagnostics/  pre-schema.schema.json, 0.17.0.schema.json (byte-identical), next.schema.json   # no scopes
    snapshots/gate-attribution/  pre-schema.schema.json, 0.17.0.schema.json (byte-identical), next.schema.json   # result pass | fail
    (no snapshots/gate-pending/)
    src/schemas/history/gate-diagnostics/pre-schema.ts     (unchanged)
    src/schemas/history/gate-diagnostics/0.17.0.ts         (new frozen module: the format's 0.17.0 entry in `releases`)
    src/schemas/history/gate-attribution/pre-schema.ts     (unchanged)
    src/schemas/history/gate-attribution/0.17.0.ts         (new frozen module: the format's 0.17.0 entry in `releases`)
    (no src/schemas/history/gate-pending/)
    history.lock.json: 16 entries. gate-pending's entry is removed and the two 0.17.0 modules are added; every other entry is byte-identical.
    CURRENT_SHAPES: "gate-attribution": "next", "gate-diagnostics": "next"; no gate-pending key
    no gate-pending parser, upgrade function, type, format id or json/gate-pending.schema.json; no README row

    # The release cut renames both next snapshots to the release that ships this change.

### api: docs.phax.run — /schemas/index.json and the served gate schemas — normative

before:

    {
      "releases": ["0.17.0", "0.18.0", "0.19.0"],
      "paths": [
        …
        "/schemas/gate-attribution/0.19.0.json",
        "/schemas/gate-diagnostics/0.19.0.json",
        "/schemas/gate-pending/0.17.0.json",
        "/schemas/gate-pending/0.18.0.json",
        "/schemas/gate-pending/0.19.0.json",
        …
      ]
    }

after:

    {
      "releases": ["0.17.0", "0.18.0", "0.19.0", "0.20.0"],
      "paths": [
        …
        "/schemas/gate-attribution/0.20.0.json",   # the next shape, now released
        "/schemas/gate-diagnostics/0.20.0.json",   # the next shape, now released
        "/schemas/gate-pending/0.17.0.json",       # kept, byte for byte
        "/schemas/gate-pending/0.18.0.json",       # kept, byte for byte
        "/schemas/gate-pending/0.19.0.json",       # kept, byte for byte
        …
      ]
    }

    # No /schemas/gate-pending/0.20.0.json. Every earlier gate-attribution and gate-diagnostics path keeps serving its 0.17.0 snapshot. The deploy guard is unchanged and passes.
    # Binding per §9 q-served (the author's open question). The release number is illustrative.

### file: README.md §Extend phax and §Persisted formats — normative

before:

    ## Extend phax

    Three hooks let your own tools inform a run. …

    ### Diagnostics gate steps
    … An `invariant` finding fails the step. A `completion` finding names the `scopes` it belongs to, and fails the step only once all of them are closed according to your scope provider; until then it is pending, shown to the agent as optional work. …
    ### Scope provider
    ### Plan auditor

    ## Persisted formats
    … | Gate pending | `gate-pending` | … |

after:

    ## Extend phax

    Two hooks let your own tools inform a run. …

    ### Diagnostics gate steps
    … An `invariant` finding (something forbidden is present) and a `completion` finding (something required is missing) both fail the step. phax never decides when a finding is due: report only what is. The failing findings, not the raw log, are what the agent is asked to fix.
    ### Plan auditor

    ## Persisted formats
    (no gate-pending row)

    # Normative: the hook count, the subsections, both classes failing, no Scope provider section and no gate-pending row. Indicative: the wording. There is no "removed" section and no upgrade note.

### file: examples/hello-world/ — normative

before:

    phax.json      "scopes", "planAuditor", diagnostics step node ./audit.mjs
    scopes.mjs
    audit-plan.mjs
    audit.mjs
    plan.md

after:

    phax.json      "planAuditor", diagnostics step node ./audit.mjs (unchanged)
    audit-plan.mjs
    audit.mjs      (unchanged: emits invariants only)
    plan.md
    (scopes.mjs deleted)

### file: docs/blog/announcing-phax-1.0.md — indicative

before:

    … phax can tell an auditor *when* a finding is fair: a "this wiring is missing" diagnostic against a file a later phase is planned to add is reported as pending work, not as a failure, until the phase that owns it has landed. Invariants fail immediately; completion findings fail exactly once the plan says they should.

    phax has **two providers** you can plug into `phax.json` …
    - **`scopes`** — *during the gate*: …
    - **`planAuditor`** — *before the run*: …
    … offered at two points where an outside tool can use it.

after:

    … Invariants and completion findings both fail the step: the auditor reports a missing piece only once it is due, and phax fails the phase on whatever it reports.

    phax has **one provider** you can plug into `phax.json` …
    - **`planAuditor`** — *before the run*: …
    … offered at one point where an outside tool can use it.

    # Normative: no scopes bullet, no pending completion findings, and the count equals the bullets. Indicative: the wording.

### file: docs/ideas/coverage-provider.md and docs/ideas/change-gates-from-the-harness.md — indicative

before:

    coverage-provider.md: providers (gate diagnostics, `scopes`, `orient`)   # orient goes with drop-orient
    change-gates-from-the-harness.md: … `scopes` closure instead of a naming convention.

after:

    coverage-provider.md: providers (gate diagnostics, the plan auditor)
    change-gates-from-the-harness.md: reworded without the scope provider (e.g. "the plan's file ownership instead of a naming convention")

## 7. Non-goals

- The gate request, its `input` key and its request file (spec `gate-request`). No requirement, surface or example here names them.
- The brief (spec `brief-provider`, re-briefed from the abandoned `brief-replaces-orient`) and orient's retirement (spec `drop-orient`).
- The coordination note's later items: a diagnostic `id` and oscillation detection, accepted debt, ranges, a structured repair and a `decision` class.
- Any notion in phax of what is due: no closure, impact, schedule or replacement for scopes. The provider decides.
- Any shim, migration, dedicated refusal or message, deprecation, alias, README upgrade note or "removed" section for the removal. Restating or testing the ordinary unknown-key refusal (exit 2), or the ordinary tolerance of extra keys on decode, for any leftover of the scope machinery is excluded too.
- Reading, converting, explaining, rewriting or deleting earlier-release gate files (`.pending.json`, a diagnostics file whose completions carry `scopes`, a `pending` attribution result) beyond the frozen decoders the history convention requires.
- Removing or changing the shared provider runner, which the plan auditor still uses, or the plan projection the plan auditor receives.
- Changing hello-world's `audit.mjs` or its diagnostics step.
- Editing other specs (`oracle-phases`, `gate-request`), authoring briefs, spikes or archived artifacts. §10 lists the wording `oracle-phases`' own revision must change.
- Changing anything else in the gate, the fix loop, `phax resume`, `phax reset-phase` or the run records.
- Redeploying docs.phax.run outside a release.

## 8. Acceptance criteria

### A completion finding fails a non-terminal phase

Given a three-phase run whose diagnostics step `node ./audit.mjs` prints `{ "diagnostics": [{ "rule": "wire-invoice-cli", "class": "completion", "location": { "file": "src/cli/index.ts", "line": 12 }, "message": "the invoice command is not registered", "repair": "register invoiceCommand in src/cli/index.ts" }] }` and exits 0 at phase-02, when phase-02's gate runs, then the step fails. `gate-attribution.json` records it as `"fail"`. `checks-attempt-01.diagnostics.json` holds that finding under a `$schema` naming `gate-diagnostics` at the running release and decodes as the next shape. The fix loop opens with that finding. (refs §5.1, §5.7, §5.6)

### Terminal and non-terminal phases judge alike

Given the same completion finding printed at phase-02 and at the terminal phase-03, when each phase's gate runs, then both fail the step with attribution `"fail"`, the same diagnostics file shape and the same fix-prompt shape. (refs §5.2, §5.1)

### The other verdict rules are unchanged

Given three diagnostics steps that print, in turn, `{ "diagnostics": [] }` with exit 0, `{ "diagnostics": [] }` with exit 1, and `not json` with exit 0, when each runs in a gate, then the first passes. The second and third fail as provider errors with the raw log, as before the change. The third's provider error states the expected document `{"diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]}` verbatim. (refs §5.3, §5.9)

### Steps, firing, the fix loop and attribution are unchanged

Given a profile of `pnpm test` (log), then `node ./audit.mjs` (diagnostics), then `pnpm build` with `"firing": "terminal"`, and `maxFixAttempts: 1`, when phase-02's audit reports an invariant on attempt 01 and none on attempt 02, and phase-03 runs, then the steps run in profile order and stop at the first failure. Attempt 02 runs after one fix turn, and `pnpm build` runs only in phase-03. Each `gate-attribution.json` lists exactly the steps that ran, with their surfaces. (refs §5.4)

### Only the selected steps run and are logged

Given a non-terminal phase whose profile is `pnpm test` (log) then `node ./audit.mjs` (diagnostics) printing one completion finding, under a fake shell that records every process phax starts, when the gate attempt runs, then the processes started during the attempt are exactly `pnpm test` and `node ./audit.mjs`. The attempt log's `$` lines are exactly those two commands, and no line of the log begins with `stdin:`. (refs §5.5)

### No pending file and no pending result

Given a three-phase run whose diagnostics step reports completion findings on some attempts and none on others, when the run completes, then no phase folder holds a file ending in `.pending.json`. Every `gate-attribution.json` step result is `"pass"` or `"fail"`, and every file validates against the `gate-attribution` next JSON Schema. (refs §5.8, §5.6)

### The fix prompt lists both classes alike, with no pending section

Given a diagnostics step that fails with a completion finding followed by an invariant finding, and, separately, a log step that fails after a diagnostics step passed, when each fix prompt is built, then the first lists both findings in that order. Its `## Diagnostics` section equals what the current release renders for those two findings as failing findings, with no class tag and no legend. Neither prompt has a section titled or describing pending or optional findings. (refs §5.10, §5.11)

### A green gate announces nothing pending

Given a phase whose diagnostics step prints `{ "diagnostics": [] }` and exits 0, and the current release's output for the same passing gate captured as a golden, when `phax run` gates it, then phax's output for that gate equals the golden and has no line counting pending findings. (refs §5.12)

### The local schemas list exactly the contract

Given a project whose `phax.json` holds arbitrary content, and the repository after the change, when `phax schema upgrade` runs in the project, then `phax.schema.json` has exactly the top-level properties `$schema, version, name, state, agent, commands, fileReconciliation, security, publish, planAuditor, review, authoring, gateProfiles, workspaces, records`, and `phax.user.schema.json` exactly `state, agent, commands, fileReconciliation, security, publish, planAuditor, review, authoring, gateProfiles, workspaces`. The gate step's `output` description contains none of `scope`, `closed` or `pending`. `phax.json` is byte-for-byte unchanged, and the repository's committed `phax.schema.json` and `phax.user.schema.json` equal the generated ones. (refs §5.13, §5.14)

### Every remaining key keeps its precedence

Given `planAuditor` declared with a different command in `phax.json`, `~/.phax/config.json` and `phax.local.json`, when the configuration loads with all three layers, then with `phax.local.json` cleared, then with both user layers cleared, then it resolves from `phax.local.json`, then from `~/.phax/config.json`, then from `phax.json`, as the current release does. (refs §5.13)

### The two gate formats get their next shapes

Given the schemas package after the change, and a `checks-attempt-01.diagnostics.json` and a `gate-attribution.json` written by the new build, when `pnpm exec tsx scripts/schemas-check.ts` runs, and each file is passed to `parseGateDiagnostics` or `parseGateAttribution` and to `parseDocument`, then the check passes with `packages/schemas/snapshots/gate-diagnostics/next.schema.json` and `packages/schemas/snapshots/gate-attribution/next.schema.json` recorded, and `CURRENT_SHAPES` names `next` for both formats. Both files parse as shape `next`. In the `gate-diagnostics` next JSON Schema, an invariant and a completion each have exactly the properties `rule, class, location, message, repair`, and the `gate-attribution` next JSON Schema's `result` enum is exactly `["pass", "fail"]`. (refs §5.15, §5.16)

### The gate formats' history is kept and the lock changes by three entries

Given the repository before and after the change, when they are compared and `pnpm exec tsx scripts/schemas-check.ts` runs, then `src/schemas/history/gate-diagnostics/pre-schema.ts`, `src/schemas/history/gate-attribution/pre-schema.ts` and the `pre-schema` and `0.17.0` snapshots of both formats are byte-identical. `src/schemas/history/gate-diagnostics/0.17.0.ts` and `src/schemas/history/gate-attribution/0.17.0.ts` exist, and each is its format's `0.17.0` entry in `releases`. `packages/schemas/history.lock.json` differs by exactly the removal of `src/schemas/history/gate-pending/pre-schema.ts` and the addition of those two modules. The check passes. (refs §5.18, §5.19)

### `gate-pending` is gone from the package

Given the schemas package, its build and the README after the change, when they are inspected, then `FORMAT_IDS` has no `gate-pending`. The package exports no `parseGatePending`, `toLatestGatePending`, `LatestGatePending` or `GatePendingShape`. There is no `json/gate-pending.schema.json` in the built package, no `packages/schemas/snapshots/gate-pending/` and no `src/schemas/history/gate-pending/`. README §Persisted formats has no `gate-pending` row. (refs §5.17)

### Served `gate-pending` URLs stay up

Given the `/schemas/index.json` docs.phax.run serves before the change, which lists `/schemas/gate-pending/<R>.json` for every ledger release R, and the bytes served at those paths, when the site is built for the release that ships this change and the deploy guard runs against that index, then the guard passes. Every listed `gate-pending` path is in the build with identical bytes and is listed in the new index. The build serves no `/schemas/gate-pending/<new release>.json`. (refs §5.20)

### The hello-world example has no scope provider

Given `examples/hello-world/` after the change, when `phax validate` runs there and the example-provider integration test runs, then validate exits 0. `phax.json` declares `planAuditor` and the unchanged gate profile with the diagnostics step `node ./audit.mjs`, and nothing else among the hooks. The directory's `.mjs` files are exactly `audit-plan.mjs` and `audit.mjs`, and `audit.mjs` is byte-identical. The test passes against those two scripts. (refs §5.21)

### Docs describe both classes failing and count what they list

Given the repository after the change, when README §Extend phax and §Persisted formats and `docs/blog/announcing-phax-1.0.md` are read, and `phax.usage.kdl` and `docs/cli/reference.md` are regenerated with the project's scripts, then README says "Two hooks" and has exactly the subsections Diagnostics gate steps and Plan auditor. §Diagnostics gate steps states that an invariant and a completion finding both fail the step. §Persisted formats has no `gate-pending` row. The announcement draft counts one provider, lists exactly `planAuditor`, and describes no pending completion finding. The regenerated usage spec and reference equal the committed ones. (refs §5.22, §5.23)

### The live tree is swept

Given the repository after the change, when `git grep -n -E '[Ss]copes?[ -]provider|scopesProvider|[Ss]cope closure|ScopeClosure|scopes still open|openScopes|Scopes(Config|Request|Response|ProviderError)|queryClosedScopes|makeScopesRequest|scopes\.mjs|"scopes"|`scopes`|gate-pending|[Gg]atePending|\.pending\.json|missing-provider|PendingStep|PendingDiagnostic|pendingPathFor|scheduleDiagnostics' -- . ':!docs/specs/' ':!docs/plans/' ':!docs/briefs/' ':!docs/spikes/' ':!NEXT_STEPS.md' ':!packages/schemas/snapshots/gate-diagnostics/'` runs, also excluding the frozen copy of the served `gate-pending` schemas kept by r-served, then it prints nothing and exits 1. (refs §5.24, §5.22)

## 9. Open questions for implementation planning

### Q1 — Who decides when a completion finding is due: phax, through scope closure, or the diagnostics provider? (Decided by the author on 2026-10-05; not reopened.)

- Keep scheduling in phax: scopes on completion findings, a `scopes` provider, closure and pending — abandons: One judge per decision. phax keeps closure and pending state it cannot judge, plus a second provider, a second format and a step result that is neither pass nor fail, and all of it freezes with 1.0.
- The diagnostics provider decides what is due and reports only that; phax judges what is reported — abandons: phax's own view of the plan in the verdict. A provider that cannot tell what is due fails the step on work a later phase is planned to do.

Recommendation: The diagnostics provider decides what is due and reports only that; phax judges what is reported — Decided by the author on 2026-10-05 (steme-corpus `02-product/phax-steme-coordination.md`, change 9). The provider already knows what it checks, and steme's audit reports only what is due. Until `gate-request` lands, a provider decides from git alone. No provider is in use today, so nobody is left without the plan in the meantime.

### Q2 — Once phax stops scheduling, what happens to the two finding classes? (Decided by the author on 2026-10-05; not reopened.)

- Both classes stay in the document and both fail the step — abandons: Any difference in behavior between the classes: `class` only describes the failure.
- Merge them into one class and drop `class` — abandons: The kind of failure: whether something required is missing or something forbidden is present. The provider knows it, and a reader of the record wants it.
- Keep completion findings non-failing (advisory) — abandons: Teeth. A missing requirement would never stop a phase, and phax would keep a non-failing verdict state, which is the pending state under another name.

Recommendation: Both classes stay in the document and both fail the step — Decided by the author on 2026-10-05. A completion finding fails the step exactly as an invariant does. Both classes stay because they say which kind of failure it is, and neither carries `scopes`.

### Q3 — Is the scope machinery dropped hard, or is its removal eased? This folds in the 2026-10-05 questions about a config that still declares `scopes` and a finding that still carries it. (Decided by the author on 2026-10-06; not reopened.)

- Hard drop: no shim, migration, dedicated refusal or message, deprecation, README upgrade note or "removed" section, and no reading of earlier-release gate files. A leftover key meets whatever phax does today with any unknown key — abandons: A guided path for a project or provider still written against scopes: it gets the generic answer, with no word on what happened.
- A dedicated refusal that names the removal in every config layer, plus a README upgrade note — abandons: The no-shims rule. It adds a message, tests and a paragraph that exist only for a key nobody configures, and each would have to be removed later.
- `phax schema upgrade` rewrites `phax.json` and the user layers to drop the key — abandons: `phax schema upgrade` never touching `phax.json`. It would also add config-rewriting machinery (key order, formatting, three layers, a home-directory file) to the CLI contract just before the 1.0 freeze, for one key with no user.
- A deprecation release: accept `scopes`, ignore it and warn — abandons: The no-shims rule for persisted config, plus a release in which a configured provider silently does nothing.

Recommendation: Hard drop: no shim, migration, dedicated refusal or message, deprecation, README upgrade note or "removed" section, and no reading of earlier-release gate files. A leftover key meets whatever phax does today with any unknown key — Decided by the author on 2026-10-06. phax, steme-lab, phax-cockpit and louloupapers were checked on 2026-10-05: none configures `scopes`, ships a scope provider or reads the diagnostics output, and hello-world is phax's own example. After the change, scopes, closure and pending appear nowhere in phax's contracts, code paths, tests or docs, except where history is kept on purpose. No requirement or criterion names a leftover `scopes`, in a config layer or on a finding. Once dropped, it is an unknown key like any other. `phax schema upgrade` regenerates the two local schemas and never reads or writes `phax.json`.

### Q4 — Does this spec depend on `gate-request`? (Decided by the author on 2026-10-06; not reopened.)

- Removals first: land after `drop-orient` and before `gate-request` and the brief, independent of both — abandons: A release in which the provider gets the plan's facts the moment scopes go. Between this change and `gate-request`, a provider sees only git.
- Ship with and after `gate-request`, as approved on 2026-10-05 — abandons: The green field. `gate-request` would be designed beside the scope machinery it makes redundant, with criteria that hold only between the two changes, and this spec's example and docs would name a request it does not own.

Recommendation: Removals first: land after `drop-orient` and before `gate-request` and the brief, independent of both — Decided by the author on 2026-10-06 (NEXT_STEPS §Before steme's audit): the removals come first so that the new features are built on a green field. No requirement, surface or example here names the gate request, its `input` key or its request file. The hello-world example has no `orient` hook either, since `drop-orient` lands first.

### Q5 — Does the fix prompt distinguish the two classes, and how? (Decided by the author on 2026-10-05; not reopened.)

- Tag each finding with its class, in the provider's order, with one legend line — abandons: Today's fix-prompt text for failing findings: every diagnostics fix prompt changes shape.
- Group findings under a "missing" heading and a "forbidden" heading — abandons: The provider's order, which may encode priority, and compactness: a single-class failure gets a lone heading.
- No distinction: list them as failing findings render today — abandons: Telling "add what is missing" from "remove what is forbidden" at a glance. The agent has to read each message.

Recommendation: No distinction: list them as failing findings render today — Decided by the author on 2026-10-05. The message and the repair already say what to do, so the fix prompt lists failing findings in the provider's order, both classes alike, with no class tag and no legend.

### Q6 — How do `gate-diagnostics` and `gate-attribution` change? (Decided by the author on 2026-10-05; not reopened.)

- Each gets a next shape: `gate-diagnostics` without `scopes`, and `gate-attribution` with `result` `pass|fail` — abandons: An unchanged current shape. These are the first gate formats to change since `$schema`, so the history convention needs frozen `0.17.0` decoders and the site serves a new schema for each from the shipping release.
- Keep the current shapes, with `scopes` optional and `pending` admitted but never written — abandons: Explicit per-variant enums. The current shape would admit a key and a value that no phax writes, which is the permissive superset the conventions forbid.

Recommendation: Each gets a next shape: `gate-diagnostics` without `scopes`, and `gate-attribution` with `result` `pass|fail` — Decided by the author on 2026-10-05. Both next shapes describe only what phax writes.

### Q7 — Does `gate-pending` stay in the schemas package for files already written? (Decided by the author on 2026-10-05 as old Q3; not reopened.)

- Keep `parseGatePending`, the format id, its snapshots and its JSON Schema, though phax writes none — abandons: A clean package: a format no release writes stays exported, documented and tested for good.
- Remove the format from the package entirely: parser, format id, snapshots, JSON Schema and README row — abandons: Reading a `.pending.json` written by 0.17.0–0.19.x, which the package README's "every file written from 0.17.0 on stays readable" covers. No such file was written outside phax's tests.

Recommendation: Remove the format from the package entirely: parser, format id, snapshots, JSON Schema and README row — Decided by the author on 2026-10-05. No diagnostics output was in use before this change, so no record holds a pending file worth reading. The format leaves the package, and its pre-schema module and lock entry go with it.

### Q8 — Is anything specified for reading earlier-release gate files: a `.pending.json`, a diagnostics file whose completion findings carry `scopes`, or a `pending` attribution result? (Decided by the author on 2026-10-05 as old Q5 and old §7; not reopened.)

- Specify each case: the package's unknown marker for a `pending` result, scoped findings upgraded, and pending files explained by `phax records explain` — abandons: The hard drop: reading rules, tests and docs for files nobody has written outside tests.
- Upgrade a `pending` result to `fail` — abandons: Truth in the latest value: it would claim a failure that never happened.
- Nothing: no earlier-release gate file is read in any special way. The frozen decoders the history convention requires stay, and nothing else is added — abandons: Any specified reading of those files. Should one exist, what the package or phax makes of it is unspecified and untested.

Recommendation: Nothing: no earlier-release gate file is read in any special way. The frozen decoders the history convention requires stay, and nothing else is added — Decided by the author on 2026-10-05. No diagnostics output was in use before this change. The convention still requires the frozen pre-schema and `0.17.0` modules of `gate-diagnostics` and `gate-attribution` (r-history), and only those are kept. Nothing more is specified.

### Q9 — The deploy guard refuses a build that stops serving a `$schema` URL docs.phax.run lists, and the live index lists `/schemas/gate-pending/<R>.json` for every release since 0.17.0. Removing `gate-pending` from the package removes those files from the site build, so the first release that ships this change would be refused. How do the guard and the hard drop meet? (Decided by the author on 2026-10-06; not reopened.)

- Keep serving, and keep listing in the index, the already-served `gate-pending` URLs byte for byte as kept history, from a frozen copy outside the schemas package. Serve none for later releases, and leave the guard unchanged — abandons: A literal "gate-pending leaves entirely": a frozen copy of its JSON Schemas stays in the repo and on docs.phax.run for good, and the site build learns that a format can be retired.
- Drop the URLs: the release that ships this change lets the guard accept losing exactly the `gate-pending` paths — abandons: The guard's unconditional rule and README §Persisted formats' promise that each URL "stays up for good". Three published URLs start answering 404, and the guard gains an exception mechanism that the next removal will reuse.

Recommendation: Keep serving, and keep listing in the index, the already-served `gate-pending` URLs byte for byte as kept history, from a frozen copy outside the schemas package. Serve none for later releases, and leave the guard unchanged — Decided by the author on 2026-10-06, as recommended. No file in use references these URLs, so either option loses little in practice. The tie goes to the promise already published. The brief names the served `$schema` URLs among the history kept on purpose, so keeping them matches the hard drop as the author framed it: the package, phax and the docs forget `gate-pending`, while the site keeps what it has already published. The guard and the README promise stay unconditional, and the cost is a frozen copy of three files. r-served and ac-served are written to this recommendation. If the author picks o-guard-exception instead, r-served becomes "serves no `gate-pending` URL" and the plan carries a one-release guard exception.

## 10. Implementation-planning note

Settled:

- Verdict: any finding of either class fails a diagnostics step, on every phase. The empty-list and provider-error rules are unchanged. Steps, profile order, `surface`, `firing`, `output`, the stop at the first failing step, the fix loop and attribution are unchanged.
- Removed from the code, as verified against it: src/domain/gate/scheduleDiagnostics.ts; src/app/scopes.ts; src/schemas/scopes.ts; src/schemas/gatePending.ts; `pendingPathFor` (src/domain/gate/diagnosticsPath.ts); `ScopesProviderError` and `PendingStep` (src/domain/errors.ts); the `pending` fields of `GatePassed`/`GateFailed` (src/domain/events.ts) and their plumbing in src/app/eventAdapter.ts and src/app/fixLoop.ts. In src/app/gates.ts: the closure block, the scope query and its log lines, the `missing-provider` branch, `result: "pending"` and `writePendingDoc`. In src/app/executePlan.ts: the green-gate pending line and the `scopesProvider` and request inputs. In src/domain/gate/fixPrompt.ts: `renderPendingSection`. Also `ScopesRequest` and `makeScopesRequest` (src/domain/plan/projection.ts), `ScopesConfigSchema` and `scopes` in both config schemas, src/domain/config/mergeLayers.ts and src/app/loadConfig.ts, and the scope sentence of `GATE_OUTPUT_DESCRIPTION` and `"scopes"?` in `DIAGNOSTICS_EXPECTED_SHAPE`.
- Kept: src/app/providerQuery.ts, `projectPhases` and `makePlanAuditRequest`, which the plan auditor uses. Whatever else uses `isTerminal` (terminal-firing step selection) also stays.
- Scope-only tests are deleted: tests/unit/scheduleDiagnostics.test.ts, tests/integration/scopesScheduling.test.ts, tests/integration/scopes.test.ts, tests/unit/schemas/scopes.test.ts, tests/unit/schemas/scopesConfig.test.ts and tests/unit/schemas/gatePending.test.ts. Mixed tests lose their scope and pending cases or switch fixture names: gates, fixLoop, fixPrompt, diagnosticsPath, eventAdapter, mergeLayers, planProjection, config JSON Schema, user overlay, planAuditorConfig, exampleProviders, persistedProducer, architecturalGuards, telemetry adapterFailures, tests/type/schemasPackage.ts, and the tests/unit/schemasPackage suite (frozenHistory uses `gate-pending` as a renderer fixture id).
- Schemas package, as the history convention requires: `gate-diagnostics` and `gate-attribution` get `next.schema.json`. Their `pre-schema` and `0.17.0` snapshots and pre-schema modules stay byte for byte. The snapshot gate's "released but no decoder reads it" rule means each format gets a frozen `src/schemas/history/<id>/0.17.0.ts`, listed in its `releases` and pinned by `--write`. `gate-pending` leaves `FORMAT_IDS` together with its definition, exports, snapshots, JSON Schema, pre-schema module and lock entry. The lock loses only that entry, which keeps its "entry ↔ module" check green, and every other entry is untouched.
- These are the only code paths and frozen modules kept solely to read earlier-release gate files: the two pre-schema modules (pinned) and the two new `0.17.0` modules (required by the snapshot gate). phax's own `readGateAttributionFile` keeps its pre-schema path for records written before 0.17.0.
- The release cut renames the two `next` snapshots, appends the release to the ledger, and the site then serves the next shapes at that release. `FIRST_SUPPORTED_RELEASE` stays 0.17.0.
- Generated files are regenerated with the project's scripts, never edited by hand: `phax.schema.json` and `phax.user.schema.json` (`phax schema upgrade`), the generated schemas index and lock (`pnpm exec tsx scripts/schemas-check.ts --write`), and `phax.usage.kdl` and `docs/cli/reference.md`, which carry no scope text today and must gain none.

Left open:

- How the served `gate-pending` schemas are kept (per q-served): where the frozen copy of the three served files lives (outside `packages/schemas/snapshots/`, so the snapshot gate does not read it as a format), and how the site build serves it and keeps listing it in `/schemas/index.json`. The ac-sweep exclusion follows that location.
- How `toLatestGateDiagnostics` and `toLatestGateAttribution` type a value read by an older shape whose finding carries `scopes` or whose step result is `pending`. Constraint: the upgrade never invents a fact (no `pending` becomes `fail`), and no requirement, test or doc names those cases (q-earlier-files).
- How ac-sweep is enforced without a committed test that itself holds the vocabulary. Recommended, as in drop-orient: a gate command in the plan's final phase (the plan is archived as kept history), plus review.
- How the removals are split into phases. Suggested: gate code and tests first, then config and the generated schemas, then the schemas package and site, then docs, the example and the sweep, keeping each phase green under `pnpm check:full` (knip included).

Constraints:

- Lands after `drop-orient` and before `gate-request` and the brief. Its surface starts from drop-orient's after-state: hello-world with `scopes`, `planAuditor` and the diagnostics step, README "Three hooks", and two providers in the announcement draft.
- phax gains no notion of what is due. Nothing computed from the plan, the phase's position or git enters the verdict.
- No requirement, criterion, test or doc names a leftover `scopes` key in a config layer or on a finding. Nothing restates the ordinary unknown-key refusal (exit 2) or the ordinary tolerance of extra keys on decode.
- No shims and no compatibility code. Earlier-release gate files are read only through the frozen decoders the history convention requires.
- This spec removes CLI and config surface on purpose before the 1.0 freeze: one config key, one provider contract, one step result, one phase-folder file and one persisted format. Nothing is added.
- `gate-request` (Draft, docs/specs/2610060951-gate-request.md) already describes the gate as this spec leaves it, so its wording needs no change.
- `oracle-phases` (Approved, not built) is not changed here. Wording its own revision must sweep: §1's bullet "`scopes` returns which completion scopes are closed…"; the ground lines on src/app/gates.ts ("A scopes-provider failure fails the gate"), src/schemas/gateDiagnostics.ts (`scopes?` in the shape), src/schemas/gateAttribution.ts (`pass|fail|pending`), src/schemas/phaxConfig.ts (the provider blocks list), the plan projection "sent to `scopes` and `planAuditor`" and README §Scope provider; §5's "its pass, fail or pending result" for the oracle step; the two config examples declaring `scopes`; the non-goal "deriving oracles from `scopes`"; and the `oracles` key notes "mirroring `scopes` and `planAuditor`" and "like `scopes`". After this spec those notes read as mirroring `planAuditor` alone, and its plan reads the diagnostics shape at build time, with no `scopes`.
- NEXT_STEPS stays the author's queue: the `drop-gate-scopes` and `oracle-phases` wording items are ticked under the file's own rule.

## 11. Docs page

Page: README §Extend phax › Diagnostics gate steps (with §Scope provider removed and the `gate-pending` row removed from §Persisted formats)

Reader: The author of a diagnostics provider, such as steme's audit, who needs to know how phax judges findings now: both classes fail, and the provider alone decides what is due.

Example: Declare `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics" }` in a gate profile. In audit.mjs, report an invariant whenever something forbidden is present. Report a completion such as `{ "rule": "wire-invoice-cli", "class": "completion", "location": { "file": "src/cli/index.ts" }, "message": "the invoice command is not registered", "repair": "register it" }` only once it is due, judged from what the provider can read itself (for example, once `src/cli/index.ts` exists in the worktree). Every reported finding fails the step, and the fix prompt lists it.
