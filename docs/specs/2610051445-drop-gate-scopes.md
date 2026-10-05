---
status: Approved
date: 2026-10-05
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-05
  baseline: 46cb189
---
# Drop gate scopes — completion findings fail the step like invariants; the scope provider, the pending state and `gate-pending` are retired

## 1. Context

A gate step with `"output": "diagnostics"` prints `{ "diagnostics": [...] }`. Each finding is an `invariant` (something forbidden is present) or a `completion` (something required is missing). An invariant fails the step. A completion must carry `scopes`, a non-empty list of names, and phax decides when it is due.

Once per gate attempt, before the steps, phax resolves scope closure. On the terminal phase every scope is closed without asking. Otherwise, when the profile has a diagnostics step, phax sends the configured `scopes` provider `{phase, phases}` on stdin, logs `$ <cmd>`, `stdin: <json>` and the answer in the attempt log, and reads `{"closed": [...]}`. With no provider configured, any completion finding fails the step as a configuration error (`missing-provider`).

A completion whose scopes are all closed fails the step. One with any scope still open is pending. If a step returns only pending findings, its result in `gate-attribution.json` is `pending`, which does not verify its surface. The pending findings are saved as `checks-attempt-NN.pending.json` (format `gate-pending`), listed in the fix prompt under "Pending (optional — not required to pass this gate)", and announced on a green gate as `N completion diagnostic(s) pending (scopes still open: …)`.

The `scopes` key exists in `phax.json`, `phax.local.json` and `~/.phax/config.json`, and all three reject unknown keys. `phax schema upgrade` regenerates `phax.schema.json` and `phax.user.schema.json` and never touches `phax.json`.

Persisted formats carry `$schema` `https://docs.phax.run/schemas/<format>/<release>.json`. `@lbdremy/phax-schemas` reads every release's files by the shape that release wrote, and every format's current shape is still `0.17.0`. The gate-request spec, which this one depends on and ships with, lets a step declare `"input": "gate-request"` and receive `{$schema, phase, base, terminal, phases}` on stdin. It deliberately leaves the scope machinery untouched until this spec.

The only known scope provider is phax's own `examples/hello-world/scopes.mjs`, whose audit never emits a completion. The first real diagnostics provider will be steme's audit (`steme audit`, roadmap-1.0 item 0.13, not built). It reports only what is due and never emits a scope.

Ground read:

- `docs/briefs/drop-gate-scopes.md` — The author's decisions of 2026-10-05. A completion finding fails the step like an invariant, and both classes stay. Retired: the `scopes` key and its provider contract, closure resolution, pending diagnostics and their section in the fix prompt, the `missing-provider` failure, and the `gate-pending` format. There is a new `gate-diagnostics` version, the spec depends on gate-request, and there are no shims but a clear way out.
- `docs/specs/2610051439-gate-request.md` — The spec this one depends on (Draft). A step declaring `"input": "gate-request"` receives `{$schema, phase, base, terminal, phases}` on stdin, saved as `checks-attempt-NN.request.json`. Its §5.15/§5.16 keep scope scheduling unchanged "until the next spec retires it". Both specs should ship in one release.
- `docs/briefs/gate-request.md` — Additive by design: the scopes provider, the pending state and `gate-pending` stay until `drop-gate-scopes`. A provider can read the request and still emit scoped completions in the meantime.
- `README.md` — §Extend phax opens with "Four hooks". §Diagnostics gate steps: "A `completion` finding names the `scopes` it belongs to, and fails the step only once all of them are closed according to your scope provider; until then it is pending, shown to the agent as optional work." §Scope provider: the `{phase, phases}` request, the `{closed: [...]}` answer, and a completion with no provider failing the gate. §Persisted formats has the row `gate-pending` → `<record>/checks-attempt-NN.pending.json` → `parseGatePending`.
- `src/app/gates.ts` — Once per attempt, before the steps, the closure is resolved: `all` on the terminal phase, otherwise a query to the scope provider when a diagnostics step is present (logged as `$ <cmd>`, `stdin: <json>`, answer), or `unavailable` without a provider. `scheduleDiagnostics` splits the findings into failing and pending. `missing-provider` is a configuration-error failure. A step with only pending findings records `result: "pending"`. `writePendingDoc` writes `.pending.json`. `DIAGNOSTICS_EXPECTED_SHAPE` names `"scopes"?`.
- `src/domain/gate/scheduleDiagnostics.ts` — `ScopeClosure` = all | closed | unavailable. An invariant always fails. A completion fails when every scope it names is closed and is pending otherwise. With `unavailable`, any completion yields `missing-provider`.
- `src/domain/gate/fixPrompt.ts` — A failing finding renders as `- <rule> at <file:line> — <message>` plus `repair guide:`, with no class shown. A `## Pending (optional — not required to pass this gate)` section lists pending findings with `(scopes still open: …)`.
- `src/schemas/gateDiagnostics.ts` — A completion is `{class: "completion", scopes: NonEmptyArray, rule, location, message, repair}` and an invariant is the same without `scopes`. Unknown keys are ignored on decode, so an invariant carrying `scopes` passes silently today. The file shape is `$schema` plus the stdout document.
- `src/schemas/gatePending.ts` — `{closed: [...], steps: [{command, pending: [{diagnostic, openScopes}]}]}` with `$schema` `gate-pending`.
- `src/schemas/gateAttribution.ts` — A step result is `"pass" | "fail" | "pending"`. `verifiedSurfaces` counts only `pass`, so a pending step leaves its surface unverified.
- `src/schemas/scopes.ts` — The scope provider's answer `{closed: [...]}`. The request is `ScopesRequest {phase, phases}`.
- `src/schemas/phaxConfig.ts` — `scopes: {command}` sits at the top level of the project schema and of the user overlay. Its description names closure and pending. The gate step's `output` description ends with "A completion diagnostic names one or more scopes and is pending…". Both config schemas use `onExcessProperty: "error"`.
- `src/app/loadConfig.ts` — Three layers carry `scopes`: `phax.json`, `phax.local.json` and `~/.phax/config.json`, merged in mergeLayers.
- `src/app/initProject.ts` — `phax schema upgrade` rewrites `phax.schema.json` and `phax.user.schema.json` only. It neither reads nor validates nor writes `phax.json`.
- `src/schemas/persisted.ts` — phax reads a `$schema` document with its current decoder only. `readGateAttributionFile` feeds the record's and the final report's verified surfaces, and an undecodable attribution degrades to no verified surface. phax never reads `.diagnostics.json` or `.pending.json` itself.
- `packages/schemas/src/shapes.ts` — `defineFormat` resolves a `$schema` document to the latest release-named shape at or below its release, or to `next` for the package's own release. `releases` holds the frozen shapes earlier releases introduced. The `Unknown` marker stands for a fact an older shape never recorded.
- `packages/schemas/src/generated/index.ts` — PACKAGE_VERSION 0.18.0. Every format's current shape is still `0.17.0`, so this is the first format change since `$schema` was introduced, for `gate-diagnostics` and `gate-attribution`.
- `examples/hello-world/` — `phax.json` declares `"scopes": {"command": "node ./scopes.mjs"}`. `scopes.mjs` computes closed scopes from the projection. `audit.mjs` emits only invariants (`HW_NO_IO`), so the example never produces a completion.
- `docs/specs/2609281159-oracle-phases.md` — Approved, not built. Its oracle answers in the diagnostics shape, quoted with `scopes?`. Its `oracles: {command}` key mirrors `scopes` and `planAuditor` and appears in the user overlay "like `scopes`". It lists "deriving oracles from `scopes`" as a non-goal.
- `docs/blog/announcing-phax-1.0.md` — The 1.0 announcement draft describes completion findings as pending work until the owning phase lands (lines ~88–95) and the `scopes` hook (line ~415).
- `phax.usage.kdl` — No mention of scopes, completion or pending findings. The `--usage` contract carries no scope text today.
- `NEXT_STEPS.md` — §Road to 1.0.0 (rechecked 2026-10-05 at v0.18.0) lists a CLI contract freeze and a persisted-format stability promise before 1.0. The no-shims rule holds for 0.x.

## 2. Problem

The decision "is this finding due yet?" is split across two commands and two formats. The diagnostics step says what is wrong. A second provider, queried before the gate in a different request/answer shape, says which scopes are closed. phax then joins the two answers and keeps state it cannot judge: closure, pending findings, a `pending` step result and a `gate-pending` record.

A provider that wants to say "not due yet" must express it in phax's vocabulary of scopes. That means inventing scope names, tagging every completion with them, and shipping a second command that recomputes closure from the plan.

Once the gate request gives the diagnostics step the phase's base, whether it is terminal, and the plan's projection, that step can decide what is due by itself. The scope machinery then becomes a second, redundant judge of the same question. It also costs the agent clarity, because the fix prompt mixes required work with "optional" pending work. And it costs readers clarity, because a step can be neither passed nor failed.

The CLI and config contract is about to freeze for 1.0. A key, a format and a step result kept now would have to be carried, or broken, after the freeze.

## 3. Product goal

The diagnostics provider decides what is due, and phax judges only what the step reports. A completion finding fails the step exactly as an invariant does. The two classes stay in the document, where they say which kind of failure it is: something required is missing, or something forbidden is present. The `scopes` provider, closure resolution, the pending state, the `missing-provider` failure and the `gate-pending` record are retired. `scopes` simply leaves the contracts: a config that still declares it meets the ordinary unknown-key refusal, a finding that still carries it is read like any finding, and `gate-pending` leaves the schemas package. Nothing reads earlier-release gate files back, since no diagnostics output was in use before this change. Nothing else about the gate changes.

> Every finding a diagnostics step reports is due: phax fails the step on it and keeps no schedule of its own.

## 4. Terminology

- **Finding** — One entry of a diagnostics document's `diagnostics` array: `{rule, class, location: {file, line?}, message, repair}`.
- **Completion finding** — A finding with `class: "completion"`: something the change requires is missing.
- **Invariant finding** — A finding with `class: "invariant"`: something the change forbids is present.
- **Due** — Ready to be judged now. After this spec, "due" is decided only by the diagnostics provider, from the gate request and git. phax treats every reported finding as due.
- **Scope (retired)** — A name a completion finding carried so that phax could defer it until the `scopes` provider reported the scope closed. It is no longer part of any phax contract.
- **Pending (retired)** — The state of a completion finding whose scopes were not all closed. It did not fail the step and was shown to the agent as optional. It no longer exists in the verdict, the fix prompt, the run output, `gate-attribution.json` or the phase folder.

## 5. Functional requirements

### 5.1 Any finding fails the step

The system shall fail a diagnostics step whose document holds at least one finding, of either class, whatever the step's exit code.

### 5.2 One rule for every phase

The system shall apply the same verdict rule to a diagnostics step on the terminal phase and on every other phase.

### 5.3 The other verdict rules stay

The system shall keep every other verdict rule of a diagnostics step unchanged: an empty list with exit 0 passes, and a missing or undecodable document, or an empty list with a non-zero exit, is a provider error that fails the step.

### 5.4 The rest of the gate stays

The system shall keep gate steps, their profile order, `surface`, `firing`, `output`, `input`, the stop at the first failing step and the fix loop exactly as they are.

### 5.5 No scheduling in the gate

The system shall run no command other than the profile's selected steps during a gate attempt, and shall keep no closure and no pending finding.

### 5.6 No scope query in the attempt log

WHEN a gate attempt runs THE system SHALL write to the attempt log only the selected steps' entries, with no scope query, scope request or scope answer.

### 5.7 Attribution is pass or fail

The system shall record every step that ran in `gate-attribution.json` with a `result` of `"pass"` or `"fail"` only.

### 5.8 No pending file

The system shall write no `checks-attempt-NN.pending.json` file.

### 5.9 The new diagnostics file

WHEN a diagnostics step fails on its findings THE system SHALL save its document as `checks-attempt-NN.diagnostics.json` in the new `gate-diagnostics` shape, in which no finding carries `scopes`.

### 5.10 Extra keys stay ignored, `scopes` included

The system shall keep ignoring every key a finding carries beyond the contract, a leftover `scopes` included, and judge that finding like any other.

### 5.11 The fix prompt lists findings alike

WHEN the fix prompt lists failing findings THE system SHALL list them in the provider's order, both classes alike, as it lists failing findings today, with no class tag and no legend.

### 5.12 No pending section

The system shall build fix prompts with no pending or optional-work section.

### 5.13 No pending announcement

WHEN a phase's gate passes THE system SHALL print no count of pending completion findings and no open scopes.

### 5.14 `scopes` leaves the configuration contract

The system shall have no `scopes` key in the configuration contract of `phax.json`, `phax.local.json` and `~/.phax/config.json`; a layer that still declares it meets the refusal every unknown key meets today (exit 2), with no message of its own and no migration.

### 5.15 The local schemas drop `scopes`

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` and a `phax.user.schema.json` with no `scopes` property and no scope or pending wording in the gate step's `output` description, and SHALL leave `phax.json` unchanged.

### 5.16 `gate-diagnostics` gets a new version

The system shall publish the new `gate-diagnostics` shape as that format's next version in `@lbdremy/phax-schemas`.

### 5.17 `gate-attribution` gets a new version

The system shall publish the `gate-attribution` shape without `"pending"` as that format's next version.

### 5.18 `gate-pending` is removed

The system shall remove `gate-pending` from `@lbdremy/phax-schemas` and from README §Persisted formats: its parser, its format id, its JSON Schema and its snapshots.

### 5.19 The example has no scope provider

The system's hello-world example shall declare no `scopes` key, ship no scope provider, and have its diagnostics step declare `"input": "gate-request"`.

### 5.20 The docs describe no scopes

The system's README, generated config schemas, `phax --usage` and 1.0 announcement draft shall describe diagnostics steps without scopes, a scope provider or pending completion findings, and README §Persisted formats shall have no `gate-pending` row.

## 6. Surface

### config: phax.json / phax.local.json / ~/.phax/config.json — `scopes` removed — normative

before:

    {
      "orient": { "command": "node ./orient.mjs" },
      "scopes": { "command": "node ./scopes.mjs" },
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": {
        "standard": [
          { "command": "node ./audit.mjs", "surface": "structural",
            "firing": "every-phase", "output": "diagnostics" }
        ]
      }
    }

after:

    {
      "orient": { "command": "node ./orient.mjs" },
      "planAuditor": { "command": "node ./audit-plan.mjs" },
      "gateProfiles": {
        "standard": [
          { "command": "node ./audit.mjs", "surface": "structural",
            "firing": "every-phase", "output": "diagnostics",
            "input": "gate-request" }
        ]
      }
    }

    # `scopes` is no longer a key in any of the three layers. `input` comes from the gate-request spec.

### cli: a config that still declares `scopes` — indicative

before:

    $ phax validate
    ✓ phax.json is valid

after:

    $ phax validate
    ✗ phax.json: is unexpected  at: scopes
    $? = 2

    # The refusal every unknown key meets today, nothing of its own: no dedicated message, no migration. Normative: exit 2. Indicative: the wording, which is the existing unknown-key message.

### cli: phax schema upgrade — indicative

before:

    $ phax schema upgrade
    phax.schema.json: top-level properties include "scopes" ("The scopes provider command… A completion diagnostic fails the step only when every scope it names is closed, otherwise it is pending…")
    gate step "output" description ends: "A completion diagnostic names one or more scopes and is pending — not failing — until every scope it names is closed by the \"scopes\" provider."

after:

    $ phax schema upgrade          # phax.json is not read, validated or modified
    phax.schema.json, phax.user.schema.json: no "scopes" property
    gate step "output" description: '"diagnostics" expects {"diagnostics": [{"rule", "class": "invariant"|"completion", "location": {"file", "line"?}, "message", "repair"}]} on stdout. … Any finding, of either class, fails the step.'

    # Normative: no `scopes` property; phax.json untouched. Indicative: the description wording.

### api: diagnostics document printed by a gate step — normative

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
    # completion: pending while "cli" is open, failing once closed

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
    # Both fail the step. The provider reports a completion only when it is due.

### file: attempt log `checks-attempt-NN.log` — normative

before:

    $ node ./scopes.mjs
    stdin: {"phase":"phase-02","phases":[{"id":"phase-01","files":[…]},…]}
    {"closed":["core"]}

    $ node ./audit.mjs
    stdin: checks-attempt-01.request.json
    {"diagnostics":[…]}
    exit 0

after:

    $ node ./audit.mjs
    stdin: checks-attempt-01.request.json
    {"diagnostics":[…]}
    exit 0

    # Only the selected steps' entries. The `stdin:` line naming the request file comes from the gate-request spec.

### file: <phase folder> attempt files — normative

before:

    checks-attempt-01.log
    checks-attempt-01.request.json
    checks-attempt-01.diagnostics.json
    checks-attempt-01.pending.json      # pending findings
    gate-attribution.json

after:

    checks-attempt-01.log
    checks-attempt-01.request.json
    checks-attempt-01.diagnostics.json  # new gate-diagnostics shape: no `scopes`
    gate-attribution.json               # result: "pass" | "fail"

    # No .pending.json is ever written.

### file: checks-attempt-NN.diagnostics.json — new `gate-diagnostics` version — normative

before:

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.18.0.json",
      "diagnostics": [
        { "rule": "wire-invoice-cli", "class": "completion", "scopes": ["cli"],
          "location": { "file": "src/cli/index.ts", "line": 12 }, "message": "…", "repair": "…" }
      ]
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.19.0.json",
      "diagnostics": [
        { "rule": "wire-invoice-cli", "class": "completion",
          "location": { "file": "src/cli/index.ts", "line": 12 }, "message": "…", "repair": "…" }
      ]
    }

    # Normative: completion and invariant share one field set; no `scopes`. The release number is illustrative (the release that ships gate-request and this spec).

### file: gate-attribution.json — new `gate-attribution` version — normative

before:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.18.0.json",
      "phase": "phase-02",
      "steps": [
        { "command": "pnpm test", "surface": "local", "result": "pass" },
        { "command": "node ./audit.mjs", "surface": "structural", "result": "pending" }
      ]
    }

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-attribution/0.19.0.json",
      "phase": "phase-02",
      "steps": [
        { "command": "pnpm test", "surface": "local", "result": "pass" },
        { "command": "node ./audit.mjs", "surface": "structural", "result": "fail" }
      ]
    }

    # result: "pass" | "fail". No other value.

### api: fix prompt sent to the agent — indicative

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

after:

    ## Diagnostics

    - wire-invoice-cli at src/cli/index.ts:12 — the invoice command is not registered
      repair guide: register invoiceCommand in src/cli/index.ts
    - no-cycles at src/a.ts:3 — …
      repair guide: …

    Full output: …/checks-attempt-01.log

    ## Required action
    …

    # Normative: findings in the provider's order, both classes alike and as failing findings render today, no class tag, no legend, no pending section. Indicative: the wording.

### cli: phax run / phax resume output on a green gate — indicative

before:

    [phax] phase "phase-02" gate: green — 1 completion diagnostic(s) pending (scopes still open: cli)

after:

    (no pending line; a green gate reads as on any phase without findings)

### package: @lbdremy/phax-schemas — gate formats — normative

before:

    snapshots/gate-diagnostics/0.17.0.schema.json   # completion carries scopes
    snapshots/gate-attribution/0.17.0.schema.json   # result pass | fail | pending
    snapshots/gate-pending/0.17.0.schema.json

    | Gate pending | `gate-pending` | `<record>/checks-attempt-NN.pending.json` | `parseGatePending` | `json/gate-pending.schema.json` |

after:

    snapshots/gate-diagnostics/next.schema.json     # new: no scopes; renamed by the release
    snapshots/gate-attribution/next.schema.json     # new: result pass | fail
    (gate-pending removed: parseGatePending, the format id, json/gate-pending.schema.json, its snapshots, the README row)

    # Normative: the two next shapes; gate-pending gone from the package. Earlier-release gate files are not read back: no diagnostics output was in use before this change.

### file: README.md §Extend phax — indicative

before:

    Four hooks let your own tools inform a run. …
    ### Diagnostics gate steps
    … A `completion` finding names the `scopes` it belongs to, and fails the step only once all of them are closed according to your scope provider; until then it is pending, shown to the agent as optional work. …
    ### Scope provider
    { "scopes": { "command": "node ./scopes.mjs" } }
    …

after:

    Three hooks let your own tools inform a run. …
    ### Diagnostics gate steps
    … An `invariant` finding (something forbidden is present) and a `completion` finding (something required is missing) both fail the step. phax never decides when a finding is due: report only what is. A step that declares "input": "gate-request" receives the phase's base, whether it is the last phase, and what later phases plan (see Gate request).
    (§Scope provider removed)

### file: examples/hello-world/ — indicative

before:

    phax.json  "scopes": { "command": "node ./scopes.mjs" }
    scopes.mjs
    audit.mjs  # ignores stdin, emits invariants

after:

    phax.json  no "scopes"; the audit step declares "input": "gate-request"
    (scopes.mjs deleted)
    audit.mjs  # reads the gate request, emits invariants (and a completion only when it is due)

## 7. Non-goals

- A diagnostic `id`, oscillation detection, accepted debt, ranges, structured repair and a decision class. These are later specs from the same coordination note.
- Any notion in phax of what is due: no closure, no impact, no schedule and no replacement for scopes. The provider decides, from the gate request and git.
- Changing the gate request itself, the `input` key or the request file. They belong to gate-request.
- Rewriting `phax.json` (or any config layer) automatically, or refusing `scopes` with a message of its own: no `phax schema upgrade` migration, no `--fix`, no dedicated refusal.
- Rewriting, re-stamping or deleting earlier-release files in run folders or on `phax/records/v1`.
- Printing `.pending.json` or `.diagnostics.json` files in `phax records explain`.
- Reading earlier-release gate files (`.pending.json`, scoped `.diagnostics.json`, a `pending` attribution result): no diagnostics output was in use before this change, so nothing reads, converts or explains them specially.
- Changing the oracle-phases spec's text. Its relation is stated in §10.
- Changing steme's audit, which reports only what is due and never emits a scope.

## 8. Acceptance criteria

### A completion finding fails a non-terminal phase

Given a three-phase run with no `scopes` key in any config layer, whose diagnostics step `node ./audit.mjs` prints one completion finding `{ "rule": "wire-invoice-cli", "class": "completion", "location": { "file": "src/cli/index.ts", "line": 12 }, "message": "…", "repair": "…" }` and exits 0 at phase-02, when phase-02's gate runs, then the step fails. `gate-attribution.json` records it as `fail`. `checks-attempt-01.diagnostics.json` holds the finding with no `scopes` and a `$schema` naming `gate-diagnostics` at the running release. The fix loop opens with that finding. (refs §5.1, §5.9, §5.7)

### Terminal and non-terminal judge alike

Given the same completion finding printed at phase-02 and at the terminal phase-03, when each gate runs, then both fail the step with the same attribution `fail`, the same diagnostics file shape and the same fix prompt shape. (refs §5.2, §5.1)

### The other verdict rules are unchanged

Given three diagnostics steps that print, in turn, `{ "diagnostics": [] }` with exit 0, `{ "diagnostics": [] }` with exit 1, and `not json` with exit 0, when each runs in a gate, then the first passes and the second and third fail as provider errors with the raw log, exactly as before the change. (refs §5.3)

### Steps, firing and the fix loop are unchanged

Given a profile `pnpm test` (log), then `node ./audit.mjs` (diagnostics), then `pnpm build` with `firing: "terminal"`, and `maxFixAttempts: 1`, when phase-02's audit reports a finding on attempt 01 and none on attempt 02, and phase-03 runs, then steps run in profile order and stop at the first failure. Attempt 02 runs after one fix turn. `pnpm build` runs only in phase-03. (refs §5.4)

### No scope query and no pending state

Given a non-terminal phase whose profile has a diagnostics step that prints one completion finding, when the gate attempt runs, then the attempt log's `$` lines are exactly the selected steps' commands. It has no `stdin: {` line with inline JSON. No command other than the profile's steps was spawned. (refs §5.5, §5.6)

### No pending file, no pending result

Given a run whose diagnostics step reports completions on some attempts and passes on others, when the run completes, then no phase folder holds a `checks-attempt-NN.pending.json`, and every `gate-attribution.json` step result is `pass` or `fail`, each validating against the `gate-attribution` next schema. (refs §5.8, §5.7)

### The fix prompt lists both classes alike, with no pending section

Given a diagnostics step that fails with one completion finding followed by one invariant finding, when the fix prompt is built, then it lists both in that order, rendered alike as failing findings render today, with no class tag and no legend. It has no section titled or describing pending or optional findings. (refs §5.11, §5.12)

### A green gate announces nothing pending

Given a phase whose diagnostics step prints `{ "diagnostics": [] }` and exits 0, when `phax run` gates it, then phax's output for that gate contains neither `pending` nor `scopes still open`. (refs §5.13)

### A leftover `scopes` on a finding is ignored

Given a diagnostics step that prints `{ "diagnostics": [{ "rule": "wire-invoice-cli", "class": "completion", "scopes": ["cli"], "location": { "file": "src/cli/index.ts" }, "message": "…", "repair": "…" }] }`, and a second run where an `invariant` finding carries `"scopes": []`, when each gate runs, then the step fails in both runs on that finding as a normal finding, not as a provider error. `gate-attribution.json` records `fail`, and the fix prompt lists the finding. (refs §5.10, §5.1)

### Other extra keys are still ignored

Given a diagnostics step whose single invariant finding also carries `"id": "HW-1"`, when the gate runs, then the step fails on that finding as a normal finding (not a provider error), and the fix prompt lists it. (refs §5.10)

### A config with `scopes` meets the ordinary unknown-key refusal

Given in turn, `phax.json`, `phax.local.json` and `~/.phax/config.json` each declaring `"scopes": { "command": "node ./scopes.mjs" }`, the other layers clean, when `phax validate` runs, and `phax run --plan <plan>` runs, then both exit 2 before any run or worktree is created, with the message every unknown key gets today; there is no message specific to `scopes`. (refs §5.14)

### `phax schema upgrade` drops `scopes` and leaves phax.json alone

Given a project whose `phax.json` still declares `scopes` and whose `phax.schema.json` predates the change, when `phax schema upgrade` runs, then it succeeds. `phax.schema.json` and `phax.user.schema.json` have no `scopes` property, and neither contains `scopes` or `pending` in the gate step `output` description. `phax.json` is byte-for-byte unchanged. (refs §5.15)

### The two gate formats get their next shapes

Given the schemas package after the change, and a `checks-attempt-01.diagnostics.json` and a `gate-attribution.json` written by the new release, when the snapshot gate runs, and each file is passed to its parser and to `parseDocument`, then the snapshot gate passes with `gate-diagnostics/next.schema.json` and `gate-attribution/next.schema.json` recorded, and both files parse as the new shapes. (refs §5.16, §5.17)

### `gate-pending` is gone from the package

Given the schemas package and the README after the change, when they are inspected, then the package exports no `parseGatePending`, `parseDocument` knows no `gate-pending` format, there is no `json/gate-pending.schema.json` and no `gate-pending` snapshot, and README §Persisted formats has no `gate-pending` row. (refs §5.18)

### The hello-world example has no scope provider

Given the repository after the change, when `examples/hello-world/` is inspected and `phax validate` runs there, then `phax.json` has no `scopes` key and its diagnostics step declares `"input": "gate-request"`. `scopes.mjs` does not exist. `phax validate` exits 0. The example-provider integration test passes with `audit.mjs` reading the request from stdin. (refs §5.19)

### No doc describes scopes or pending findings

Given the repository after the change, when `README.md`, `docs/blog/announcing-phax-1.0.md`, `phax.schema.json`, `phax.user.schema.json` and `phax.usage.kdl` are searched, then none contains a `scopes` key, a "Scope provider" section or a pending completion finding. README §Persisted formats has no `gate-pending` row. README §Diagnostics gate steps says both classes fail the step. (refs §5.20)

## 9. Open questions for implementation planning

### Q1 — A config that still declares `scopes`: refuse it with an actionable message, or rewrite it with `phax schema upgrade`? (Decided by the author on 2026-10-05; not reopened.)

- Refuse in every layer (exit 2), with a message naming the file, the key, its retirement and the gate request — abandons: A one-command migration. Each user deletes one line by hand, in up to three files, after a refused command.
- `phax schema upgrade` removes `scopes` from `phax.json` (and the user layers) — abandons: `phax schema upgrade` never touching `phax.json`, which the gate-request spec pins. It also adds a config-rewriting machinery (key order, formatting, three layers, a home-directory file) to the CLI contract just before the 1.0 freeze, for a single key with one known user.
- Drop the key: no dedicated refusal, no migration — abandons: A message that tells a user what replaced `scopes`. Nobody uses it, so nobody needs the message; a leftover key meets the refusal every unknown key meets.

Recommendation: Drop the key: no dedicated refusal, no migration — Decided by the author on 2026-10-05: nobody uses `scopes`, so it simply leaves the contract. No message of its own and no migration; a leftover key meets the ordinary unknown-key refusal.

### Q2 — A diagnostics document whose finding still carries `scopes`: refuse, ignore, or warn? (Decided by the author on 2026-10-05; not reopened.)

- Fail the step as a provider error naming `diagnostics[i].scopes` — abandons: The finding itself in the fix prompt. The agent sees a provider error and the raw log instead of a repairable finding, until the provider is updated.
- Drop `scopes` silently and judge the finding like any other — abandons: The provider author's only signal that their "not due yet" no longer works. Findings meant for later phases fail now, and the agent is pushed to do later phases' work, with nothing in the log saying why.
- Judge the finding and log a warning line — abandons: The same verdict as ignore, so later phases' work still fails now. The only notice is a log line nobody reads during a headless run.
- Drop the key from the format: a leftover `scopes` is ignored like any extra key — abandons: A loud signal to a provider still written against scopes. No such provider exists.

Recommendation: Drop the key from the format: a leftover `scopes` is ignored like any extra key — Decided by the author on 2026-10-05: nobody uses it. `scopes` leaves the format, and a leftover one is an extra key like any other.

### Q3 — `gate-pending` for records already written: keep its parser, or drop it? (Decided by the author on 2026-10-05; not reopened.)

- Keep `parseGatePending`, the format id, its snapshots and JSON Schema; phax writes none — abandons: A clean package surface. A format no release writes stays exported, documented and tested forever.
- Remove the parser, the format id and the README row — abandons: Readability of every record written up to 0.18.x, and the promise that a `$schema` URL stays up for good. `parseDocument` would call those files an unknown format and tell users to upgrade a package that can no longer read them.

Recommendation: Remove the parser, the format id and the README row — Decided by the author on 2026-10-05: no diagnostics output was in use before this change, so no record holds a pending file worth reading; the format leaves the package.

### Q4 — Does the fix prompt distinguish the two classes, and how? (Decided by the author on 2026-10-05; not reopened.)

- Tag each finding with its class, in the provider's order, with one legend line — abandons: Today's exact fix-prompt text for invariant-only failures: every diagnostics fix prompt changes shape.
- Group findings under a "missing" heading and a "forbidden" heading — abandons: The provider's ordering, which may encode priority, and compactness. A single-class failure carries a lone heading.
- No distinction, as today for failing findings — abandons: The reason the two classes survive at all: the agent can no longer tell "add what is missing" from "remove what is forbidden" except by reading each message.

Recommendation: No distinction, as today for failing findings — Decided by the author on 2026-10-05: the message and the repair already say what to do; the fix prompt stays as it renders failing findings today.

### Q5 — How does an earlier-release `gate-attribution.json` step with `"result": "pending"` read after the change? (Decided by the author on 2026-10-05; not reopened.)

- Read as written by its release's shape; the latest upgrade gives the package's unknown marker for that step's result; phax counts it unverified — abandons: `LatestGateAttribution` being exactly phax's in-memory value. One field of the latest value can carry a history-only marker.
- Keep `"pending"` in the current `gate-attribution` enum, never written — abandons: The explicit per-variant enum. The current shape would admit a value no phax writes, which is the permissive superset the conventions forbid.
- Upgrade a `pending` step to `"fail"` — abandons: Truth in the latest value. It would claim a failure that never happened and break "a fail is the last step that ran".
- Nothing: no earlier-release attribution needs reading — abandons: Any specified reading of an old `pending` result.

Recommendation: Nothing: no earlier-release attribution needs reading — Decided by the author on 2026-10-05: no diagnostics output was in use before this change, so no record carries a `pending` result worth reading. `pending` leaves the enum and nothing more is specified.

## 10. Implementation-planning note

Settled:

- Verdict: any finding of either class fails a diagnostics step on every phase. The empty-list and provider-error rules are unchanged. Steps, order, `surface`, `firing`, `output`, `input`, the stop at the first failure and the fix loop are unchanged.
- Retired with no replacement: the `scopes` key and provider contract in all three config layers, closure resolution, the scope query and its log lines, pending findings, the `pending` step result, the fix prompt's pending section, the green-with-pending run line, the `missing-provider` failure and the writing of `gate-pending`.
- `scopes` leaves the configuration contract: a layer that still declares it meets the ordinary unknown-key refusal (exit 2), no dedicated message, no migration. `phax schema upgrade` regenerates the two local schemas without `scopes` and never touches `phax.json`.
- A finding carrying `scopes` is judged like any finding: the key is ignored, as every extra key is.
- The fix prompt lists failing findings in the provider's order, both classes alike, as today: no class tag, no legend.
- `gate-diagnostics` and `gate-attribution` each get a next shape: no `scopes`, and `result: pass|fail`. `gate-pending` is removed from the package and the README. Earlier-release gate files are not read back: no diagnostics output was in use before this change.
- Docs: README (§Extend phax intro and hook count, §Diagnostics gate steps, §Scope provider removed, §Persisted formats row), the 1.0 announcement draft, the generated config schemas and the hello-world example (no `scopes`, `scopes.mjs` deleted, `audit.mjs` declares `"input": "gate-request"`). `phax.usage.kdl` carries no scope text today and must not gain any.

Left open:

- The steme-corpus coordination note (`02-product/phax-steme-coordination.md`, row 9 and §"The past from git, the future from the plan") could not be read from this authoring session. It is reflected as the brief summarizes it, and the planner should cross-check it.
- Whether hello-world's `audit.mjs` also demonstrates a completion finding emitted only when due (for example on `terminal: true`), or stays invariant-only and only reads `base`.
- The exact wording of the README and schema descriptions (indicative in §6).
- How removing `gate-pending` and moving the two gate formats to new shapes sit with the package's history convention, history lock and snapshot gate, and with the `$schema` URLs served by the docs site, given that no earlier-release gate file needs to be read.

Constraints:

- Depends on gate-request and lands after it, ideally in the same release, so that no release has a scoped gate without a request, or a request without the reason for it. gate-request's §5.15/§5.16 and its "Scope scheduling is unchanged" criterion hold only between the two changes. If one plan builds both, those criteria are superseded by this spec's.
- phax gains no notion of what is due. Nothing computed from the plan, the base or git enters the verdict.
- No shims and no compatibility: retired keys and formats are simply gone; nothing reads, rewrites or converts earlier-release gate files, since no diagnostics output was in use before this change.
- This is the first format change since `$schema` was introduced (all current shapes are `0.17.0`). The snapshot gate must record `next` for `gate-diagnostics` and `gate-attribution`, `gate-pending` is removed, and `release.sh` renames the two.
- Relation to oracle-phases (Approved, not built; its text is not changed). Its oracle answers in the diagnostics shape, which after this spec has no `scopes`, so the plan that builds it reads the shape at build time and a `scopes` there is ignored like any extra key. Its `oracles: {command}` key still mirrors `orient` and `planAuditor`, which keep that shape, and it sits in the user overlay like them. Its non-goal "deriving oracles from `scopes`" has nothing left to derive from.
- This removes CLI/config surface on purpose before the 1.0 contract freeze. Nothing else in the gate's surface changes.

## 11. Docs page

Page: README §Extend phax › Diagnostics gate steps (with the §Scope provider section removed and the `gate-pending` row removed from §Persisted formats)

Reader: The author of a diagnostics gate-step provider, such as steme's audit, who used to tag completions with scopes, or who needs to know how phax judges findings now: both classes fail, and the provider decides what is due.

Example: Declare `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics", "input": "gate-request" }` and no `scopes` key. In audit.mjs, read the gate request. Report an invariant whenever something forbidden is present. Report a completion such as `{ "rule": "wire-invoice-cli", "class": "completion", "location": { "file": "src/cli/index.ts" }, "message": "the invoice command is not registered", "repair": "register it" }` only when no later entry of `request.phases` still plans `src/cli/index.ts`, or when `request.terminal` is true. Each reported finding fails the step, and the fix prompt lists it.
