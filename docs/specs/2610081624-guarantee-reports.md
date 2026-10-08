---
status: Draft
date: 2026-10-08
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Guarantee reports: one answer for the gate and the brief, with legs, repairs by kind, accepted debt and judgement

## 1. Context

Today a gate step that declares `"output": "diagnostics"` prints a `gate-diagnostics` document: `{$schema, diagnostics: [{rule, class: invariant|completion, location: {file, line?}, message, repair}]}`.
- Every finding fails the step, whatever the exit code. An empty list passes on exit 0.
- On a failing attempt only, phax writes the decoded findings, re-stamped, as `checks-attempt-NN.diagnostics.json`.
- The fix prompt lists each finding as `rule at file:line — message`, then `repair guide: <repair>`.
- A step that declares `"input": "gate-request"` reads `{$schema, phase, base, terminal, phases}` on stdin.

A brief provider answers a `brief-answer`: guarantees `{id, statement, places}`, where each place is `{location, state: met|missing|forbidden|accepted, due?, what?, repair?}`.
- The pushed brief shows one line per guarantee: its non-met places, with state, location and due.
- `phax brief` prints every place, with `what` and `repair`.
- Each brief call is saved as a `brief-record` (`brief-NN.json`), which holds the answer as printed.
- `phax records explain --gates` prints each attempt's log and request. `--briefs` prints the brief records as stored.

The review handoff (`review-handoff.md`, which is also the PR body after a header) carries the run summary, the reconciliation, the attention points and the compliance review. Nothing from a gate or brief answer reaches it. In secure mode the agent is granted `security.agentCommands`, the gate commands and, when a brief provider is configured, `phax brief` (security.json sources `config | gate | brief`).

steme is the first provider. Its guarantee model was restructured (the author, 2026-10-08):
- packs define guarantees, a standard places them, and a unit manifest binds them;
- each guarantee is made of legs, obligations and prohibitions, each with its own check;
- a ledger keys one state per (instance, guarantee, leg);
- repairs are rendered as blueprints (laid by `steme lay`, then edits) and as skills, each with a one-line description;
- accepted debt is keyed exactly as the ledger keys a leg, with who accepted it, when and why;
- some legs are left to judgement, with an owner;
- a preflight can refuse to run, and repairs can be stale.
In steme, the gate and the brief are two views of one ledger.

The brief names the steme corpus as ground: the surface document, its example outputs and decisions 27–30. This authoring session could not read them. The model below is designed from the brief's account of steme, and its mapping must be checked against those outputs before approval (§10).

Ground read:

- `docs/briefs/guarantee-reports.md` — The brief: steme's restructured model (packs, standard, unit manifest, legs, ledger, repairs as blueprints and skills, accepted debt, judgement, preflight, stale repairs), what the spec must design, out of scope, constraints, and the §9 questions to cover.
- `/Volumes/Work/steme/steme-corpus/docs/corpus/02-product/steme-surface.md` — Named by the brief as authoritative, along with its example outputs under steme-surface/target/out/, the rendered repairs under steme-surface/target/code/apps/sandbox/.steme/repairs/ and decisions 27–30. This authoring session could not read any of them because permission was denied. The model below is designed from the brief's account of steme and must be checked against those files before approval (§10).
- `NEXT_STEPS.md` — The steme section: guarantee-reports is step 2, after open-next-release and before the decision class. The coordination note's asks (a stable identity, accepted debt in the document, a structured repair, an end line) belong to this spec. The provider-answer decision: before 1.0, an answer in an older shape is refused by name.
- `docs/specs/2610081603-open-next-release.md` — Approved. Stamps name the format's shape. A new or changed format is stamped with the opened version (0.21.0 after the 0.20.0 release). The answer readers accept a stamp from the format's current stamp up to the running version.
- `README.md` — Extend phax (Diagnostics gate steps, Gate request, Brief provider, Plan auditor), Persisted formats, Exit codes (4 = gate failure after the fix loop), and resume after a gate pause.
- `src/schemas/gateDiagnostics.ts` — gate-diagnostics: {$schema, diagnostics: [{class: invariant|completion, rule, location: {file, line?}, message, repair}]}. Unknown keys are ignored.
- `src/schemas/brief.ts` — brief-answer: guarantees [{id, statement, places: [{location, state: met|missing|forbidden|accepted, due, what, repair}]}]. Also brief-request (phase and outside variants) and brief-record, whose outcome.answer is kept as printed.
- `src/schemas/persisted.ts` — readGateDiagnosticsAnswer and readBriefAnswer read an answer by its own $schema and refuse a missing, newer or unknown stamp by name.
- `src/schemas/phaxConfig.ts` — A gate step's output is "log" (the default) or "diagnostics".
- `src/app/gates.ts` — Steps run fail-fast. A diagnostics step's verdict comes from its document: any finding fails it, and an empty list with a non-zero exit is a provider error. On a failing attempt only, phax writes checks-attempt-NN.diagnostics.json from the decoded findings, re-stamped. Gate attribution records each step as pass or fail.
- `src/app/fixLoop.ts` — Same-session fix loop. Each failed attempt builds a fix prompt, and when the attempts are spent the run pauses. resume runs the gate again first.
- `src/domain/gate/fixPrompt.ts` — Each finding is rendered as `rule at file:line — message` plus `repair guide: <repair>`. With no findings, the raw log is shown instead.
- `src/domain/brief/render.ts` — Compact pushed form: one line per guarantee with its non-met places' state, location and due, never `what` or `repair`, capped at 50 guarantees. The whole form (`phax brief`) prints every place with what and repair.
- `src/app/reviewHandoff.ts` — The review handoff's sections: run summary, source spec, unplanned, missing, attention points, unexplained deviations, compliance review, phase details. No gate or brief content.
- `src/domain/publish/body.ts` — The PR body is a header followed by the review handoff, truncated at 60000 bytes.
- `src/app/recordsExplain.ts` — --gates prints each attempt's .log and .request.json, and --briefs prints brief-NN.json, both as stored bytes. Neither decodes. The .diagnostics.json is never printed, because its content is already in the log.
- `src/domain/security/agentCommands.ts` — The frozen agent command set: config, then gate, then brief (`phax brief`) sources. Nothing is granted at run time.
- `src/schemas/history/gate-diagnostics/0.17.0.ts` — The frozen history of gate-diagnostics, which the schemas package lists as a release.
- `docs/specs/archive/2610061345-drop-gate-scopes.md` — Precedent for a hard drop: gate-pending left the package with no shim, and its served URLs stayed up byte for byte from a frozen copy outside the snapshots.
- `docs/specs/archive/2610061346-brief-provider.md` — The brief's moments (pushed once per fresh phase start, pulled with `phax brief`), the 50-guarantee cap, the 60 s limit, recording, and the `phax brief` grant. All of these stay.
- `examples/hello-world/audit.mjs` — Prints gate-diagnostics with an HW_NO_IO invariant per node: import found in the changed .ts files under src/.
- `examples/hello-world/brief.mjs` — Prints brief-answer with one hw-no-io guarantee, one place per briefed .ts file under src/.

## 2. Problem

Both formats were designed before steme's model, and both flatten it:
- A diagnostic's `rule` is one string, where steme has a guarantee and a leg.
- Its `message` joins the statement, the instance and the finding into one text.
- A location is a file and a single line. A second file the leg involves is named only in prose.
- A repair is a string, where steme renders a blueprint to lay or a skill to load.
- The brief decodes accepted debt and the gate drops it, so the agent is never told to leave it alone.
- The guarantee's other legs are never shown, so the agent fixes one leg without seeing the others.
- In the brief, two legs at one place are told apart only by their text.
- What steme leaves to a person's judgement can only become a finding the agent is asked to fix.

Nothing identifies a finding across attempts, so the fix loop cannot say what was fixed, what still fails and what is new.

A provider that refuses to run, or whose repairs are stale, can only print an empty document or exit non-zero. Either way it looks like a passing audit or a broken script.

The gate and the brief also answer in two shapes for facts steme states once, so the two can drift until they disagree about a state.

## 3. Product goal

A gate step and a brief provider answer one format. For each guarantee it states the guarantee's legs and each leg's state at each place, with findings, line ranges, related files, repairs by kind, accepted debt and what is left to judgement, keyed by a stable identity. phax routes each fact to where it is acted on:
- The fix prompt gets the failing legs, each guarantee's other legs, the repairs, and the debt to leave alone. Skill repairs are loaded as skills.
- The pushed brief gets the open legs and their repairs' descriptions.
- The human gets the judgement at review.
- The record gets the whole report.

A provider that refuses to run is told apart from a failing audit and from a broken step. Stale repairs never reach the agent as instructions. Today's two formats are removed with no shim and no leftover name.

> The provider states each fact once, and phax routes it to whoever acts on it without judging any of it.

## 4. Terminology

- **guarantee report** — The one document, format `guarantee-report`, that a report step prints on a gate request and a brief provider prints on a brief request. Its outcome is `audited` or `refused`.
- **report step** — A gate step that declares `"output": "guarantee-report"`. It must also declare `"input": "gate-request"`.
- **guarantee** — An expectation of the project's standard, with an `id`, a `statement`, the legs it is made of and the places it applies to.
- **leg** — One checkable part of a guarantee, with an `id`, a `kind` and a `statement`. An `obligation` requires something to be there. A `prohibition` forbids something from being there.
- **place** — Where a guarantee applies (steme's instance), with a provider-chosen `id` and an anchor `location`. A place states exactly one state for each leg of its guarantee.
- **leg state** — A leg's state at one place. An obligation is `met`, `missing` or `judgement`. A prohibition is `clear`, `forbidden` or `judgement`.
- **open leg** — A leg whose state is `missing` or `forbidden`. It carries `due`, its findings, a repair or null, and accepted debt or null.
- **due** — The provider's word on when an open leg must be closed: `this-phase`, `later`, or null when the request carried no phase facts. phax never computes or checks it.
- **failing leg** — An open leg that is due `this-phase` and carries no accepted debt. A failing leg is the only thing that fails a report step.
- **finding** — What a leg's check found: `what` (the provider's words), its `location`, and the `related` locations the leg also involves, each with `why`.
- **location** — A working-tree-relative `file`, and a `range` of 1-based inclusive lines `{start, end}`, or null when the finding concerns the whole file.
- **repair** — How to close an open leg. It is one of three kinds, and each kind has a one-line `description`. A `blueprint` carries the `lay` command and the `edits` that follow it. A `skill` carries its `name` and the `path` of the directory holding its SKILL.md. A `note` carries `steps`.
- **accepted debt** — `debt: {by, on, why}` on an open leg: who accepted the violation, the date, and why. It is keyed by the leg's identity. An open leg with debt never fails a step and must be left alone.
- **judgement** — A leg state meaning the leg is left to a person, with its `owner` and the `question` put to them. It never fails a step, and it never reaches the agent.
- **identity** — The triple (place id, guarantee id, leg id), unique within a report. phax relies on it to refuse a malformed report, to carry findings across fix attempts, and to merge judgement at review.
- **refused report** — A report with outcome `refused`: the provider declined to audit (for example, its preflight failed). It carries a `reason` and a `remedy` for the operator.
- **stale repairs** — An audited report whose `repairs` are `{state: "stale", remedy}`: its findings stand, but the provider says its repairs no longer match its standard.
- **broken step** — A report step that gave no readable report (no output, invalid JSON, a refused `$schema`, a malformed report), or that gave an audited report with no failing leg but exited non-zero, or one that has an open leg with a null `due`.

## 5. Functional requirements

### 5.1 One format for both answers

phax shall read both a report step's stdout and a brief provider's stdout as one format, `guarantee-report`, and accept each only under that format's own `$schema`.

### 5.2 Today's formats are refused by name

IF a report step or a brief provider prints a document whose `$schema` names `gate-diagnostics` or `brief-answer` THEN phax shall refuse it as another format, naming the `guarantee-report` URL of its current stamp.

### 5.3 The step output value

IF a gate step declares an `output` other than `"log"` or `"guarantee-report"`, `"diagnostics"` included, THEN config validation shall refuse it, naming the step and the two allowed values.

### 5.4 A report step reads the gate request

IF a gate step declares `"output": "guarantee-report"` without `"input": "gate-request"` THEN config validation shall refuse it, naming the step.

### 5.5 Two outcomes

A guarantee report shall be exactly one of two outcomes. An `audited` report carries its repairs' freshness and its guarantees. A `refused` report carries a reason and a remedy.

### 5.6 Guarantees, legs and places

Each guarantee in an audited report shall carry an id, a statement, its legs and its places. Each leg has an id, a kind (`obligation` or `prohibition`) and a statement. Each place has an id, a location and one state per leg.

### 5.7 Identities are unique and places complete

IF any of the following holds, THEN phax shall refuse the report as malformed and name the offending identity: two guarantees share an id; two places of one guarantee share an id; a place omits a leg its guarantee declares; a place names a leg its guarantee does not declare; or a place lists one leg twice.

### 5.8 A state belongs to its leg's kind

IF a leg's state at a place is not one its kind allows (an obligation: `met`, `missing`, `judgement`; a prohibition: `clear`, `forbidden`, `judgement`) THEN phax shall refuse the report as malformed, naming the identity.

### 5.9 What an open leg and a judgement carry

An open leg shall carry `due` (`this-phase`, `later` or null), at least one finding, a repair or null, and accepted debt or null. A `judgement` leg shall carry its owner and the question left to them.

### 5.10 Findings carry ranges and related files

A finding shall carry what was found, its location (a working-tree-relative file, with a line range whose end is not before its start, or null), and the related locations the leg involves, each with why.

### 5.11 Repairs by kind

A repair shall be one of three kinds, each with a one-line description: a `blueprint` carries its lay command and its edits in order; a `skill` carries its name and the working-tree-relative directory holding its SKILL.md; a `note` carries its steps in order.

### 5.12 A failing leg fails the step

WHEN a report step prints an audited report holding at least one failing leg (an open leg due `this-phase` with no accepted debt) THE system SHALL fail the step, whatever its exit code.

### 5.13 What travels beside the verdict

WHEN a report step exits 0 and prints an audited report holding no failing leg THE system SHALL pass the step, whatever open legs due later, legs with accepted debt and legs left to judgement the report holds.

### 5.14 A non-zero exit with nothing failing is broken

IF a report step prints an audited report holding no failing leg and exits non-zero THEN phax shall fail the step as a broken step.

### 5.15 The gate needs a due

IF a report step's audited report holds an open leg whose `due` is null THEN phax shall fail the step as a broken step, naming the identity.

### 5.16 A refusal stops the phase without a fix attempt

WHEN a report step prints a refused report THE system SHALL stop the phase with a gate failure, send no fix attempt and leave the fix-attempt budget unspent, naming the step, the reason and the remedy.

### 5.17 A refusal is recorded as such

phax shall record a step that printed a refused report with the gate-attribution result `refused`, distinct from `pass` and `fail`.

### 5.18 Stale repairs change no verdict

WHILE an audited report declares its repairs stale THE system SHALL read the report's verdict exactly as it would with current repairs.

### 5.19 Stale repairs never reach the agent

WHILE an audited report declares its repairs stale THE system SHALL leave its repairs out of the fix prompt and the pushed brief, load none of its skills, and show the remedy in their place.

### 5.20 Stale repairs are warned about

WHEN phax reads stale repairs in a gate attempt or a pushed brief THE system SHALL print one run-output warning naming the step or brief provider and the remedy.

### 5.21 The fix prompt shows each failing leg whole

WHEN a step fails on an audited report THE fix prompt SHALL show each failing leg under its guarantee's statement and its place, with the leg's kind and statement, every finding with its location and related locations, and its repair by kind.

### 5.22 The guarantee's other legs at the place

At each place with a failing leg, the fix prompt shall show every other leg of that guarantee with its state, one line each, leaving out legs left to judgement.

### 5.23 A blueprint is shown as a sequence

The fix prompt shall show a blueprint repair as its lay command, to run first, followed by its edits in order.

### 5.24 A skill is loaded, not pasted

WHERE the agent's provider can load a skill into its session THE system SHALL make each current skill repair of the failing legs available as a skill in the fix attempt's session, and the fix prompt SHALL name the skill and its description without pasting its content.

### 5.25 Without skill support, the path is named

WHERE the agent's provider cannot load a skill THE fix prompt SHALL name the skill, its description, and its SKILL.md path for the agent to read.

### 5.26 Accepted debt is left alone

The fix prompt shall list every open leg with accepted debt in the failing step's report, giving its identity, who accepted it, when and why, under an instruction to leave it as it is.

### 5.27 Findings carried across attempts

WHEN a fix attempt follows an attempt in which the same step failed on an audited report THE fix prompt SHALL mark each failing leg as `new` or `still failing`, and SHALL list as fixed every failing leg of the previous attempt that no longer fails, matching legs by identity alone.

### 5.28 Judgement never reaches the agent

phax shall never put a leg left to judgement into a fix prompt or a pushed brief.

### 5.29 The compact pushed brief

The pushed brief's compact form shall show each guarantee's id and statement, then one line per open leg at each place. Each line gives the leg id; its state, written `accepted` when it carries debt; its first finding's location; its due; and, for an open leg without debt, its repair's description.

### 5.30 `phax brief` prints the whole report

WHEN `phax brief` gets an audited report THE system SHALL print the whole report: each guarantee's statement and legs, then every place with every leg's state, findings, related locations, due, repair in full, accepted debt, and judgement owner and question.

### 5.31 A refused brief

WHEN a brief provider prints a refused report THE system SHALL treat the brief as failed, giving the refusal's reason and remedy, and SHALL record the report as printed.

### 5.32 Judgement goes to the review

WHEN phax generates the review handoff THE system SHALL gather every leg left to judgement in the reports of each phase's last gate attempt into a `Left to judgement` section, grouped by owner, with one entry per identity naming the phases that reported it.

### 5.33 Every readable report is saved

WHEN a report step prints a report phax reads THE system SHALL save it beside the attempt's log, exactly as printed, whatever the step's verdict.

### 5.34 `records explain --gates` prints the reports

WHEN `phax records explain --gates` runs THE system SHALL print each attempt's log, its gate request, then each saved report, all as stored.

### 5.35 Past records are printed as stored

WHEN `phax records explain` prints a phase record written before this change THE system SHALL print its saved gate and brief files as stored, without decoding any earlier answer.

### 5.36 The schemas package

@lbdremy/phax-schemas shall read `guarantee-report`, and shall have no `gate-diagnostics` or `brief-answer` format.

### 5.37 Served URLs stay up

The docs site shall keep serving every `gate-diagnostics` and `brief-answer` schema URL it serves before this change, byte for byte and listed in its index, and shall serve neither format for any later release.

### 5.38 A report grants nothing

phax shall grant no command named in a report. A blueprint's lay command runs in a phase only as far as `security.agentCommands` allows it.

### 5.39 The hello-world example

The hello-world `audit.mjs` and `brief.mjs` shall print guarantee reports over one guarantee that has an obligation and a prohibition, with a blueprint repair and a skill repair between them.

### 5.40 The docs describe the reports

README §Extend phax shall describe the guarantee report, the report step, the brief provider's answer, the fix prompt's use of them, the review section and the lay-command grant. §Persisted formats shall list `guarantee-report` and neither `gate-diagnostics` nor `brief-answer`.

## 6. Surface

### api: guarantee report on a report step's or brief provider's stdout — normative

before:

    gate-diagnostics, printed by a "diagnostics" step:

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json",
      "diagnostics": [
        { "rule": "HW_NO_IO", "class": "invariant", "location": { "file": "src/greet.ts", "line": 1 },
          "message": "greet must not perform I/O", "repair": "plan.md#phase-01-greet-function" }
      ]
    }

    brief-answer, printed by a brief provider:

    {
      "$schema": "https://docs.phax.run/schemas/brief-answer/0.20.0.json",
      "guarantees": [
        { "id": "hw-no-io", "statement": "nothing under src/ imports a node: module",
          "places": [
            { "location": { "file": "src/greet.ts", "line": 1 }, "state": "forbidden", "due": "this-phase",
              "what": "imports node:fs", "repair": "remove the import; greet is pure" },
            { "location": { "file": "src/cli.ts" }, "state": "met" }
          ] }
      ]
    }

after:

    One format, printed by a report step (on a gate request) and by a brief provider (on a brief request). Keys, outcome, kinds, states, due values and repair kinds are normative; the made-up content is not. Every key shown is required (null where shown); unknown keys are ignored.

    {
      "$schema": "https://docs.phax.run/schemas/guarantee-report/0.21.0.json",
      "outcome": "audited",
      "repairs": { "state": "current" },
      "guarantees": [
        {
          "id": "hw-pure-module",
          "statement": "a library module under src/ exports its function and performs no I/O",
          "legs": [
            { "id": "exports-function", "kind": "obligation",  "statement": "it exports its function" },
            { "id": "no-node-import",   "kind": "prohibition", "statement": "it imports no node: module" },
            { "id": "plain-wording",    "kind": "obligation",  "statement": "its output reads as plain, friendly English" }
          ],
          "places": [
            {
              "id": "greet",
              "location": { "file": "src/greet.ts", "range": null },
              "states": [
                { "leg": "exports-function", "state": "met" },
                {
                  "leg": "no-node-import", "state": "forbidden", "due": "this-phase",
                  "findings": [
                    { "what": "imports node:fs",
                      "location": { "file": "src/greet.ts", "range": { "start": 1, "end": 1 } },
                      "related": [ { "location": { "file": "src/cli.ts", "range": { "start": 3, "end": 5 } },
                                     "why": "the caller, where the read belongs" } ] }
                  ],
                  "repair": { "kind": "skill", "description": "move I/O out of the module and into the CLI",
                              "name": "pure-greet", "path": "repairs/pure-greet" },
                  "debt": null
                },
                { "leg": "plain-wording", "state": "judgement", "owner": "hw-maintainers",
                  "question": "Is 'Hello, World!' the greeting we want?" }
              ]
            },
            {
              "id": "legacy",
              "location": { "file": "src/legacy.ts", "range": null },
              "states": [
                {
                  "leg": "exports-function", "state": "missing", "due": "later",
                  "findings": [ { "what": "no exported function", "location": { "file": "src/legacy.ts", "range": null }, "related": [] } ],
                  "repair": { "kind": "blueprint", "description": "lay the module skeleton, then move the code in",
                              "lay": "node ./lay.mjs library-module src/legacy.ts",
                              "edits": ["move the legacy greeting into the laid function", "delete the old default export"] },
                  "debt": null
                },
                {
                  "leg": "no-node-import", "state": "forbidden", "due": "this-phase",
                  "findings": [ { "what": "imports node:os",
                                  "location": { "file": "src/legacy.ts", "range": { "start": 2, "end": 2 } }, "related": [] } ],
                  "repair": { "kind": "note", "description": "take the hostname as a parameter",
                              "steps": ["add a hostname parameter", "drop the node:os import"] },
                  "debt": { "by": "hw-maintainers", "on": "2026-10-01", "why": "the legacy greeting goes with the v2 CLI" }
                },
                { "leg": "plain-wording", "state": "met" }
              ]
            }
          ]
        }
      ]
    }

    At the gate, this report fails the step on one failing leg: hw-pure-module · greet · no-node-import. Three legs travel beside it without failing: legacy · exports-function is due later, legacy · no-node-import carries debt, and greet · plain-wording is left to judgement.
    A prohibition's states are clear | forbidden | judgement; an obligation's are met | missing | judgement. due is this-phase | later | null. repair is null or one of blueprint | skill | note. debt is null or {by, on, why}.

### api: refused report and stale repairs — normative

    The provider declined to audit:

    {
      "$schema": "https://docs.phax.run/schemas/guarantee-report/0.21.0.json",
      "outcome": "refused",
      "reason": "the standard needs pack hw-core 2, and 1 is installed",
      "remedy": "node ./lay.mjs --install hw-core@2"
    }

    Audited, with repairs the provider says are stale (the findings stand):

      "repairs": { "state": "stale", "remedy": "node ./lay.mjs --render" }

### config: gate step output in phax.json — normative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "diagnostics", "input": "gate-request" }

    output: "log" (default) | "diagnostics"

after:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "guarantee-report", "input": "gate-request" }

    output: "log" (default) | "guarantee-report". "guarantee-report" requires "input": "gate-request".

    "output": "diagnostics" → ✗ gate step "node ./audit.mjs": output must be "log" or "guarantee-report"   $? = 2

### internal: fix prompt after a report step fails — indicative

before:

    ## Diagnostics

    - HW_NO_IO at src/greet.ts:1 — greet must not perform I/O
      repair guide: plan.md#phase-01-greet-function

    Full output: …/checks-attempt-01.log

after:

    # Gate checks failed — fix required

    Gate run (attempt 2) failed.

    **Failed step:** `node ./audit.mjs` (1 failing leg)
    Since attempt 1: 1 fixed, 1 still failing, 0 new.

    ## Failing legs

    ### hw-pure-module — a library module under src/ exports its function and performs no I/O

    At greet (src/greet.ts):
    - ✗ no-node-import · prohibition · still failing — it imports no node: module
      - src/greet.ts:1 — imports node:fs
        - involves src/cli.ts:3-5 — the caller, where the read belongs
      - repair: skill `pure-greet`, loaded in this session — move I/O out of the module and into the CLI
    - ✓ exports-function · obligation — met

    Fixed since attempt 1: hw-pure-module · greet · exports-function

    ## Leave these as they are (accepted debt)

    - hw-pure-module · legacy · no-node-import — accepted by hw-maintainers on 2026-10-01: the legacy greeting goes with the v2 CLI

    Full output: …/checks-attempt-02.log

    ## Required action
    (as today)

    A blueprint repair renders as:
      - repair: blueprint — lay the module skeleton, then move the code in
        1. run `node ./lay.mjs library-module src/legacy.ts`
        2. move the legacy greeting into the laid function
        3. delete the old default export
    A skill on a provider that cannot load skills:
      - repair: skill `pure-greet` — move I/O out of the module and into the CLI; read repairs/pure-greet/SKILL.md
    With stale repairs, every repair line becomes:
      - repair: withheld — the provider's repairs are stale (remedy for the operator: node ./lay.mjs --render)
    No `plain-wording` line ever appears: judgement goes to the review.

### internal: compact pushed brief in the phase's first prompt — indicative

before:

    - hw-no-io — nothing under src/ imports a node: module · forbidden src/greet.ts:1 (this phase)

after:

    - hw-pure-module — a library module under src/ exports its function and performs no I/O
      · no-node-import forbidden src/greet.ts:1 (this phase) — move I/O out of the module and into the CLI
      · exports-function missing src/legacy.ts (later) — lay the module skeleton, then move the code in
      · no-node-import accepted src/legacy.ts:2

    The 50-guarantee cap, the heading, the intro and the three instructions are unchanged. A refused brief renders as the existing unavailable line: `The brief is unavailable at phase start (refused: the standard needs pack hw-core 2, and 1 is installed — remedy: node ./lay.mjs --install hw-core@2).`

### cli: phax brief [path…] — indicative

before:

    hw-no-io — nothing under src/ imports a node: module
      forbidden  src/greet.ts:1   due this phase
        what:    imports node:fs
        repair:  remove the import; greet is pure
      met        src/cli.ts

after:

    $ phax brief src/greet.ts src/legacy.ts
    hw-pure-module — a library module under src/ exports its function and performs no I/O
      legs   exports-function  obligation   it exports its function
             no-node-import    prohibition  it imports no node: module
             plain-wording     obligation   its output reads as plain, friendly English
      greet  src/greet.ts
        met        exports-function
        forbidden  no-node-import     due this phase
          found:   src/greet.ts:1 — imports node:fs
                   involves src/cli.ts:3-5 — the caller, where the read belongs
          repair:  skill pure-greet — move I/O out of the module and into the CLI (repairs/pure-greet/SKILL.md)
        judgement  plain-wording      owner hw-maintainers — Is 'Hello, World!' the greeting we want?
      legacy  src/legacy.ts
        missing    exports-function   due later
          found:   src/legacy.ts — no exported function
          repair:  blueprint — lay the module skeleton, then move the code in
                   1. node ./lay.mjs library-module src/legacy.ts
                   2. move the legacy greeting into the laid function
                   3. delete the old default export
        forbidden  no-node-import     due this phase   accepted by hw-maintainers on 2026-10-01 — the legacy greeting goes with the v2 CLI
          found:   src/legacy.ts:2 — imports node:os
          repair:  note — take the hostname as a parameter
                   1. add a hostname parameter
                   2. drop the node:os import
        met        plain-wording
    $? = 0

    Repairs are marked `(stale)` when the report says so. A refused report prints `✗ brief refused: <reason> — remedy: <remedy>` and exits 1. The exit codes are otherwise unchanged.

### file: review-handoff.md and the PR body — Left to judgement — indicative

before:

    (no section; nothing from a gate or brief answer reaches the review)

after:

    ## Left to judgement

    Legs the standard leaves to a person. They were never sent to the agent.

    ### hw-maintainers

    - hw-pure-module · greet · plain-wording (phase-01, phase-03) — its output reads as plain, friendly English
      Is 'Hello, World!' the greeting we want?

    When there is nothing: `_Nothing was left to judgement._` The section is normative and its placement in the handoff is indicative. The PR body carries it because it carries the handoff.

### file: a phase folder's gate attempt files — indicative

before:

    checks-attempt-01.log
    checks-attempt-01.request.json
    checks-attempt-01.diagnostics.json   (failing diagnostics step only; decoded findings, re-stamped by phax)
    brief-00.json, brief-01.json        (outcome.answer: the brief-answer as printed)

after:

    checks-attempt-01.log               (unchanged; still holds each step's stdout)
    checks-attempt-01.request.json
    checks-attempt-01.report-02.json    (the report printed by the profile's 2nd step, as printed; one per report step that printed a readable report, pass, fail or refused)
    brief-00.json, brief-01.json        (brief-record unchanged in shape; outcome.answer: the guarantee report as printed, a refused one included)

    That each readable report is saved as printed is normative. The file name is indicative.

### file: gate-attribution step result — normative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "result": "fail" }   result: "pass" | "fail"

after:

    { "command": "node ./audit.mjs", "surface": "structural", "result": "refused" }   result: "pass" | "fail" | "refused"

### cli: run output on a refused report and on stale repairs — indicative

before:

    ✗ Gate command failed: node ./audit.mjs (0 diagnostic(s))   — then a fix attempt on the raw log

after:

    ✗ phase-01 gate: `node ./audit.mjs` refused to run: the standard needs pack hw-core 2, and 1 is installed
      remedy: node ./lay.mjs --install hw-core@2
      No fix attempt was made. Fix the cause, then: phax resume my-project.greet
    $? = 4

    ⚠ phase-01 gate: `node ./audit.mjs` reports stale repairs; the agent gets none of them. remedy: node ./lay.mjs --render

### cli: phax records explain <commit> --gates — indicative

before:

    --- checks-attempt-01.log ---
    …
    --- checks-attempt-01.request.json ---
    { … }

after:

    --- checks-attempt-01.log ---
    …
    --- checks-attempt-01.request.json ---
    { … }
    --- checks-attempt-01.report-02.json ---
    { "$schema": "https://docs.phax.run/schemas/guarantee-report/0.21.0.json", "outcome": "audited", … }

    A record written before this change prints its log, its request and any checks-attempt-NN.diagnostics.json, all as stored. `--briefs` prints brief-NN.json as stored, as it does today.

### config: security.agentCommands grants a lay command — normative

before:

    "security": { "agentCommands": ["pnpm"] }
    security.json sources: config | gate | brief

after:

    "security": { "agentCommands": ["pnpm", "node ./lay.mjs"] }
    security.json sources: config | gate | brief (unchanged; a report adds no source and no command)

### package: @lbdremy/phax-schemas formats — normative

before:

    gate-diagnostics (parseGateDiagnostics, json/gate-diagnostics.schema.json)
    brief-answer (parseBriefAnswer, json/brief-answer.schema.json)
    brief-record (parseBriefRecord)

after:

    guarantee-report (parseGuaranteeReport, json/guarantee-report.schema.json)
    brief-record (parseBriefRecord; its answer is kept as printed)
    no gate-diagnostics and no brief-answer: no format id, parser, type, snapshot or JSON Schema
    docs.phax.run keeps /schemas/gate-diagnostics/<R>.json and /schemas/brief-answer/<R>.json for every R it serves today, byte for byte, from a frozen copy, and serves neither for any later release

### file: README §Persisted formats rows — normative

before:

    | Gate diagnostics | `gate-diagnostics` | `<record>/checks-attempt-NN.diagnostics.json` | `parseGateDiagnostics` | `json/gate-diagnostics.schema.json` |
    | Brief answer | `brief-answer` | the brief provider's stdout, `outcome.answer` in a brief record | `parseBriefAnswer` | `json/brief-answer.schema.json` |

after:

    | Guarantee report | `guarantee-report` | a report step's and a brief provider's stdout, `<record>/checks-attempt-NN.report-SS.json`, `outcome.answer` in a brief record | `parseGuaranteeReport` | `json/guarantee-report.schema.json` |

### file: examples/hello-world/ — indicative

before:

    audit.mjs   prints gate-diagnostics (HW_NO_IO, invariant)
    brief.mjs   prints brief-answer (hw-no-io)
    phax.json   step "output": "diagnostics"

after:

    audit.mjs   prints a guarantee report on the gate request
    brief.mjs   prints a guarantee report on the brief request, over the same guarantee and legs
    lay.mjs     the blueprint's lay command
    repairs/pure-greet/SKILL.md   the skill repair
    phax.json   step "output": "guarantee-report"; security.agentCommands gains "node ./lay.mjs"

## 7. Non-goals

- A leg only its owner may decide, stopping the phase instead of sending a fix attempt. The `decision` class is a separate spec, joining the parked `phase-decision-requests`. This spec names the owner of a judgement and never stops on it.
- Escalating or stopping on a finding that keeps coming back. The identity makes this possible later; this spec only marks findings new, still failing or fixed.
- The architecture brief at plan authoring (spec → places, chains, order).
- Posting steme's check run to the pull request.
- steme's own conformity fixes.
- Changing the gate request or the brief request. Both keep their shape and stamp.
- Any shim for the old formats: no alias for `"output": "diagnostics"`, no reading of a `gate-diagnostics` or `brief-answer` answer, and no upgrade note.
- Reading past records through frozen shapes, or keeping `gate-diagnostics` or `brief-answer` in the schemas package.
- Columns in a range, or any location unit other than whole lines.
- Loading a pushed brief's skills at phase start. The pushed form names repairs by description, and `phax brief` prints their paths.
- phax running a lay command, applying a blueprint's edits, or copying a skill into the phase's commit.
- Granting a command because a report names it.
- Checking a report's content: whether a finding is true, a due is right, debt is valid, or a file exists. The decode checks are structural only.
- A severity or a rank beyond the provider's order.
- The plan auditor's answer, which has its own spec.

## 8. Acceptance criteria

### The gate and the brief speak one format

Given the hello-world example, when `audit.mjs` runs on a saved gate request and `brief.mjs` on a saved brief request, then both print a document stamped `guarantee-report` that `parseGuaranteeReport` reads, over the same guarantee `hw-pure-module` with the legs `exports-function` (obligation) and `no-node-import` (prohibition), and between them they carry a `blueprint` repair and a `skill` repair. (refs §5.1, §5.39)

### An old-format answer is refused by name

Given a report step that prints a `gate-diagnostics/0.20.0` document and a brief provider that prints a `brief-answer/0.20.0` one, when the gate runs and the phase's brief is pushed, then the step fails as a broken step, and the brief is unavailable. Both refusals name `https://docs.phax.run/schemas/guarantee-report/<current stamp>.json`. (refs §5.2)

### `"output": "diagnostics"` is refused

Given a phax.json gate step with `"output": "diagnostics"`, when `phax run` loads the config, then it exits 2, naming the step and the allowed values `"log"` and `"guarantee-report"`. (refs §5.3)

### A report step must read the gate request

Given a phax.json gate step with `"output": "guarantee-report"` and no `input`, when `phax run` loads the config, then it exits 2, naming the step and `"input": "gate-request"`. (refs §5.4)

### A malformed report is a broken step

Given five reports from a report step: one whose place `greet` omits `exports-function`; one whose prohibition `no-node-import` is `missing`; one with two places named `greet`; one whose outcome is `skipped`; and one with a guarantee that has no `legs`, when the gate reads each, then each fails the step as a broken step, the first three naming the identity (`hw-pure-module · greet · exports-function`, `hw-pure-module · greet · no-node-import`, `hw-pure-module · greet`). (refs §5.7, §5.8, §5.5, §5.6)

### Open legs, findings and judgements carry their facts

Given four reports: one with a `forbidden` leg whose `findings` is empty; one with a finding whose range is `{start: 3, end: 1}`; one with a `judgement` leg that has no `owner`; and the §6 example, when the gate reads each, then the first three fail the step as broken steps. The §6 example is read, keeping both of greet's findings fields: the location and the related `src/cli.ts:3-5` with its why. (refs §5.9, §5.10)

### Only the three repair kinds are read

Given a report whose repair is `{kind: "patch"}`, a second with a `blueprint` that has no `lay`, and a third with a `skill` that has no `description`, when the gate reads each, then each fails the step as a broken step. A report with a `note` repair carrying `description` and `steps` is read. (refs §5.11)

### A failing leg fails the step, whatever the exit code

Given the §6 audited example, printed once with exit 0 and once with exit 1, when the gate runs, then the step fails both times, and the fix prompt names one failing leg, `hw-pure-module · greet · no-node-import`. (refs §5.12)

### Debt, later and judgement legs pass

Given the §6 example with greet's `no-node-import` changed to `clear`, so that its open legs are legacy's `exports-function` (due later) and legacy's `no-node-import` (with debt), plus greet's `plain-wording` (judgement), when the step exits 0, then the step passes, and its report is saved. (refs §5.13, §5.33)

### Nothing failing with a non-zero exit is broken

Given the passing report of ac-beside, when the step exits 1, then the step fails as a broken step, and the fix prompt shows the raw log, as today. (refs §5.14)

### A gate report needs a due

Given a report step whose report has an open leg with `"due": null`, when the gate reads it, then the step fails as a broken step, naming the leg's identity. (refs §5.15)

### A refusal stops the phase without a fix attempt

Given a run with `agent.maxFixAttempts` 3, whose report step prints the §6 refused report, when the phase's gate runs, then no fix prompt is sent. The run exits 4, printing the step, the reason and the remedy. The attempt's gate attribution records the step as `refused`. `phax resume` runs the gate again first, with all 3 fix attempts still available. (refs §5.16, §5.17)

### Stale repairs keep the verdict and stay away from the agent

Given the §6 audited example with `"repairs": {"state": "stale", "remedy": "node ./lay.mjs --render"}`, printed by the report step and by the brief provider, when the gate runs and the phase's brief is pushed, then the step fails on the same failing leg as with current repairs. The fix prompt and the pushed brief show no repair, show `node ./lay.mjs --render` in their place, and load no skill. One run-output warning names the step and the remedy, and one names the brief provider. (refs §5.18, §5.19, §5.20)

### The fix prompt shows a failing leg with its guarantee

Given a failing report whose failing leg is greet's `exports-function`, with the §6 blueprint repair, while greet's `no-node-import` is `clear` and its `plain-wording` is `judgement`, when the fix prompt is built, then it shows the guarantee's statement; the place `greet`; the leg's kind and statement; its findings; the line `run node ./lay.mjs library-module src/legacy.ts` before the two edits in order; and one line for `no-node-import` as `clear`. It shows no line for `plain-wording`. (refs §5.21, §5.22, §5.23, §5.28)

### A skill is loaded, not pasted

Given a phase on a provider whose adapter can load skills, and the §6 failing report with `repairs/pure-greet/SKILL.md` in the worktree, when the fix attempt runs, then the session has the skill `pure-greet` available as a skill. The fix prompt names `pure-greet` and its description, and contains no line of SKILL.md. The phase's commit contains no file the loading added. (refs §5.24)

### Without skill support, the skill's path is named

Given the same report on a provider whose adapter cannot load skills, when the fix attempt runs, then the fix prompt names `pure-greet`, its description and `repairs/pure-greet/SKILL.md`, and contains no line of SKILL.md. (refs §5.25)

### Accepted debt is left alone

Given the §6 failing report, when the fix prompt is built, then under the instruction to leave them as they are, it lists `hw-pure-module · legacy · no-node-import` with `hw-maintainers`, `2026-10-01` and the why, and it lists that leg nowhere else. (refs §5.26)

### Fixed, still failing and new, by identity

Given attempt 1, where the step failed on greet's `exports-function` and greet's `no-node-import` (src/greet.ts:1), and attempt 2, where the same step fails on greet's `no-node-import`, now at src/greet.ts:4, and on a new place `farewell`'s `no-node-import`, when the fix prompt after attempt 2 is built, then greet's `no-node-import` is marked `still failing` and farewell's `no-node-import` is marked `new`. greet's `exports-function` is listed as fixed, and the summary reads 1 fixed, 1 still failing, 1 new. (refs §5.27)

### The compact pushed brief shows legs and repair descriptions

Given a brief provider answering the §6 audited example, when a phase starts fresh, then the `## Brief for this phase` section shows `hw-pure-module` and its statement, then three lines: `no-node-import forbidden src/greet.ts:1 (this phase)` with the skill's description, `exports-function missing src/legacy.ts (later)` with the blueprint's description, and `no-node-import accepted src/legacy.ts:2` with no repair. No line names `plain-wording`. (refs §5.29, §5.28)

### `phax brief` prints the whole report

Given the same provider, when `phax brief src/greet.ts src/legacy.ts` runs, then it exits 0. It prints the three legs with their kinds; every state at greet and at legacy; both findings and the related `src/cli.ts:3-5`; the blueprint's lay command and edits; the skill's name and path; the note's steps; the debt's by, on and why; and `plain-wording`'s owner and question. (refs §5.30)

### A refused brief is a failed brief, recorded whole

Given a brief provider that prints the §6 refused report, when a phase starts fresh, and then `phax brief` runs, then the first prompt's brief section says the brief is unavailable, giving the reason and the remedy. `phax brief` prints both and exits 1. `brief-00.json` and `brief-01.json` hold the refused report as printed. (refs §5.31)

### Judgement reaches the review, once per identity

Given a run whose phase-01 and phase-03 last gate attempts both report greet's `plain-wording` as `judgement` owned by `hw-maintainers`, when the review handoff is generated and `phax publish-pr` builds the PR body, then both contain a `Left to judgement` section with a `hw-maintainers` group holding one entry for `hw-pure-module · greet · plain-wording`, naming phase-01 and phase-03, with its question. (refs §5.32)

### Every readable report is saved as printed

Given a gate profile whose second step is a report step that prints the §6 example with an extra key `"x-steme": 1`, when attempt 1 runs, then the phase folder holds the attempt's report file, byte-identical to what the step printed and extra key included, and no `.diagnostics.json` is written. (refs §5.33)

### `records explain --gates` prints the reports

Given the phase record of a run made after this change, with two attempts, when `phax records explain <commit> --gates` runs, then for each attempt it prints the log, the request, then the saved report, all as stored. (refs §5.34)

### Past records print as stored

Given a phase record on `phax/records/v1` written by phax 0.20.0, with `checks-attempt-01.diagnostics.json` and a `brief-00.json` whose answer is a `brief-answer/0.20.0`, when `phax records explain <commit> --gates --briefs` runs, then it exits 0 and prints the log, the request, the `.diagnostics.json` and `brief-00.json` byte for byte, with no refusal. (refs §5.35)

### The package reads the new format only

Given the schemas package built after the change, when its formats and exports are inspected, then it exports `parseGuaranteeReport` and `json/guarantee-report.schema.json`, and has no `gate-diagnostics` or `brief-answer` format id, parser, type, snapshot or JSON Schema. (refs §5.36)

### Served URLs stay up

Given the `/schemas/index.json` docs.phax.run serves before the change, when the site is built for the release that ships this change and the deploy guard runs, then every listed `gate-diagnostics` and `brief-answer` path is in the build with identical bytes and is still listed. No path for either format is served at the new release. (refs §5.37)

### A report grants nothing

Given a secure-mode run whose `security.agentCommands` lacks `node ./lay.mjs`, and a failing report whose blueprint lays with `node ./lay.mjs library-module src/legacy.ts`, when the fix attempt runs, then the phase's security.json lists no `node ./lay.mjs` entry and no new source. With `node ./lay.mjs` added to `security.agentCommands`, it is listed with source `config`. (refs §5.38)

### The README describes the reports

Given the README after the change, when §Extend phax and §Persisted formats are read, then they describe the guarantee report with the §6 example; the report step's `"output": "guarantee-report"`; the verdict rule; refused and stale; the fix prompt; `Left to judgement`; and granting the lay command through `security.agentCommands`. They list the `guarantee-report` row and no `gate-diagnostics` or `brief-answer` row. (refs §5.40)

## 9. Open questions for implementation planning

### Q1 — Do the gate and the brief answer one format to two requests, or two formats over one vocabulary?

- One format, `guarantee-report`, answered to both requests — abandons: A shape fitted to each moment. The schema cannot require what only the gate needs: a non-null `due` is checked by phax at the gate, not by the format. The brief also carries a refusal and a repairs freshness that it reads only to show them.
- Two formats (a gate report and a brief report) sharing the definitions of guarantee, leg, place and repair — abandons: steme's one-ledger rule in the contract itself. Two shapes can drift apart release by release, and a provider keeps two serializers and two stamps for answers that state the same facts.

Recommendation: One format, `guarantee-report`, answered to both requests — The brief's premise is that the gate and the brief are two views of one ledger and never disagree. One format makes that structural. The gate's only extra need, a due on every open leg, is one refusal phax applies at the gate. The format does not need to be split for it.

### Q2 — What form does a leg's identity take, the one phax relies on across attempts and at review?

- The triple (place id, guarantee id, leg id), each chosen by the provider and compared by equality — abandons: Keying below the leg. Two findings of one leg at one place share one identity, so fixing one of two imports reads as still failing.
- One opaque `key` string per leg state, chosen by the provider — abandons: Structure phax can read. The fix prompt, the review grouping and the refusals need the guarantee, the place and the leg anyway, so the key would repeat them and could disagree with them.
- An identity phax derives from location and text — abandons: Stability. A line moved by an unrelated edit makes the same finding both fixed and new, and phax would be judging content.

Recommendation: The triple (place id, guarantee id, leg id), each chosen by the provider and compared by equality — It is exactly how steme's ledger and its accepted debt key a leg, so phax adds no second key. A leg is the unit that is fixed, accepted or judged; findings are its evidence. Escalation, later, can count on the same triple.

### Q3 — Which repair kinds does the format carry, and what does phax do with each?

- `blueprint` (lay command, then edits), `skill` (loaded as a skill), `note` (steps), each with a one-line description — abandons: Pressure toward structured repairs. A provider can answer with a note where a blueprint or a skill would serve the agent better.
- `blueprint` and `skill` only — abandons: Any repair at all from a provider without rendered repairs, such as a linter, a script or the hello-world audit. It must answer `repair: null`.

Recommendation: `blueprint` (lay command, then edits), `skill` (loaded as a skill), `note` (steps), each with a one-line description — phax stays a harness any provider can serve. A note is the honest form for a provider that renders nothing. The kind is explicit, so phax still shows a blueprint as a sequence and loads a skill as a skill.

### Q4 — How does a skill repair reach the agent?

- Through the provider's own skill mechanism, loaded into the fix attempt's session, with the SKILL.md path named for a provider that has none — abandons: A prompt that is the same for every provider. Each adapter gains a way to load a skill into a resumed session, and a provider without one gets the weaker fallback.
- Name the skill and its SKILL.md path in the prompt, for every provider — abandons: The skill as a skill. The agent reads a file instead of invoking a skill its harness knows, so the harness never resolves the skill's description-led loading or its bundled scripts and references.
- Paste SKILL.md into the prompt — abandons: The skill's bundled files and a bounded prompt. Every attempt repeats the full text, and the skill's references and scripts are cut off.

Recommendation: Through the provider's own skill mechanism, loaded into the fix attempt's session, with the SKILL.md path named for a provider that has none — The brief asks for the skill loaded as a skill, and steme renders skills in the Agent Skills form that Claude Code and Codex read natively. The fallback keeps phax provider-neutral without pasting. How each adapter loads a skill into a resumed session is the planner's question (§10).

### Q5 — How much of a failing leg's guarantee does the fix prompt show?

- Every other leg of the guarantee at each place with a failing leg, one line each, judgement legs left out — abandons: The guarantee's state at other places. A leg open but not due at another place is not shown, so the agent may break a place it does not see.
- Only the failing legs — abandons: What the brief asks for. The agent fixes one leg blind to the legs beside it, and can trade a prohibition for an obligation, for example removing the import by dropping the export.
- Every leg at every place of the guarantee — abandons: A bounded prompt. A guarantee over many modules floods the fix prompt with met legs far from the change.

Recommendation: Every other leg of the guarantee at each place with a failing leg, one line each, judgement legs left out — The legs beside a failing leg at the same place are the ones a fix can break. Places elsewhere are one `phax brief` away, and the gate catches any that come due.

### Q6 — Where does what is left to judgement go at review?

- One `Left to judgement` section in the review handoff, grouped by owner, so it reaches the PR body — abandons: The phase context of each entry. An entry names the phases that reported it, but sits apart from each phase's handoff and reconciliation.
- Under each phase in Phase details — abandons: One place per owner. A leg reported by three phases appears three times, an owner reads every phase to find theirs, and phase details are cut first when the PR body is truncated.
- Recorded only, shown by `records explain` — abandons: The reviewer seeing it at all, when judgement is the one thing the brief says must reach the human at `review_open`.

Recommendation: One `Left to judgement` section in the review handoff, grouped by owner, so it reaches the PR body — Judgement is addressed to an owner, not to a phase. Grouping by owner and merging by identity gives each owner one list. It also sits before Phase details, so a truncated PR body keeps it.

### Q7 — What happens when a report step's provider refuses to run?

- Stop the phase with a gate failure and no fix attempt, leaving the budget unspent; resume runs the gate again — abandons: A refusal the agent could clear itself, such as a stale lockfile or a render it could run. Clearing it now costs the operator a resume.
- Fail the step like a broken step, into the fix loop with the reason — abandons: Fix attempts and the code itself. The agent spends attempts on what it cannot change, and may edit code to quiet the provider.

Recommendation: Stop the phase with a gate failure and no fix attempt, leaving the budget unspent; resume runs the gate again — A refusal says the audit did not happen, so there is nothing for the agent to fix. The remedy is for the operator, and the pause after exhausted attempts already shows the way: exit 4, fix the cause, `phax resume`.

### Q8 — What happens when an audited report says its repairs are stale?

- The verdict stands; stale repairs are withheld from the agent, with the remedy shown and one warning printed — abandons: Advice that may still be right. A stale repair that would have helped is held back until the operator re-renders.
- The verdict stands; stale repairs are shown, marked stale — abandons: Protection from outdated instructions. The agent is told to follow a blueprint or a skill that the provider itself says no longer matches its standard.
- Stale repairs make the report a refusal — abandons: The verdict. A valid audit is thrown away and the phase stops over advice.

Recommendation: The verdict stands; stale repairs are withheld from the agent, with the remedy shown and one warning printed — The findings come from current checks, so the verdict is sound. Only the advice is outdated. The agent still sees every failing leg and finding, and the operator gets the remedy once. `phax brief` and the records keep the stale repairs, marked, for a human.

### Q9 — Who computes the verdict of a report step: phax from the provider's facts, or the provider as a separate field?

- phax fails the step on any open leg due `this-phase` with no debt; all three facts are the provider's — abandons: A provider failing a step for a reason outside that rule. It must express such a reason as an open leg due this phase.
- Each open leg (or the report) carries a provider-set verdict flag that phax obeys — abandons: One source of truth per fact. A flag can contradict the leg's own due and debt, for example an accepted leg flagged failing, and phax cannot tell which to believe without judging.

Recommendation: phax fails the step on any open leg due `this-phase` with no debt; all three facts are the provider's — The provider still owns the verdict, because it states the due and the debt. phax applies one fixed rule to facts it never computes, and the brief and the gate read the same facts the same way.

### Q10 — How is a blueprint's lay command (`steme lay`, or a provider's equivalent) granted to the agent?

- The operator lists it in `security.agentCommands` — abandons: Blueprints that work out of the box. Until the operator grants the lay command, the fix prompt names a command the sandbox refuses.
- The report step declares its lay command in phax.json and phax grants it the way it grants `phax brief` — abandons: One way to grant a command. It adds a second, step-scoped grant beside agentCommands, a new security.json source, and another config key before the freeze.
- phax grants each lay command a report names — abandons: The frozen allowlist. A provider's stdout would decide what the sandboxed agent may run.

Recommendation: The operator lists it in `security.agentCommands` — `phax brief` is phax's own command and can be granted on the operator's behalf. A lay command is the provider's, and only the operator can vouch for it. The existing allowlist already does that, and the README and the example show the one line to add.

### Q11 — How does `records explain` treat the `.diagnostics.json` and `brief-NN.json` that past runs saved?

- Print them as stored. `gate-diagnostics` and `brief-answer` leave the package, and their URLs stay served from a frozen copy — abandons: Typed reading of old runs' diagnostics and brief answers from code. A consumer of @lbdremy/phax-schemas has to parse them itself.
- Keep both formats in the package as frozen shapes and decode them in `records explain` — abandons: The hard drop. Two retired formats keep a parser, types, snapshots and lock entries for good, before 1.0, for files no consumer reads (checked 2026-10-05).

Recommendation: Print them as stored. `gate-diagnostics` and `brief-answer` leave the package, and their URLs stay served from a frozen copy — `records explain` already prints these files as stored bytes and decodes nothing, so this only extends that to the old diagnostics file. The gate-pending precedent already shows how served URLs outlive a format.

## 10. Implementation-planning note

Settled:

- Green field. `gate-diagnostics`, `brief-answer`, `"output": "diagnostics"`, the `.diagnostics.json` write, both answer readers and their release constants all go, with no shim and no leftover name. History is kept only in `records explain`, which prints old files as stored, and in the frozen copy of the served URLs.
- `guarantee-report` is a new format, born at the opened version (0.21.0 once `open-next-release` has landed). It is read only under its own `$schema`, and an older shape is refused by name, per open-next-release.
- The gate request and the brief request are unchanged in shape and stamp. `brief-record` keeps its shape, and its answered outcome holds the report as printed, a refused report included.
- Unchanged from brief-provider: the pushed brief's moments, the 50-guarantee cap, the 60 s limit, brief recording and `phax brief`'s exit codes.
- Every key the format names is required, with null where shown. Unknown keys are ignored at every level, as answers are today, and the saved copy keeps them because it is the bytes as printed.
- Report steps stay fail-fast. Steps without a report keep today's raw-log fix prompt.
- The §9 recommendations are drafted as defaults. They are not decided until the author arbitrates them.

Left open:

- The steme corpus (the surface document, the example outputs under target/out/, the rendered repairs index, decisions 27–30) could not be read while authoring this spec. Before approval, check the mapping against them: leg kinds and states, steme's place and instance ids, the debt fields, the preflight output that maps to `refused`, whether staleness is unit-wide or per repair, and the skill directory layout.
- How each provider adapter (Claude Code, Codex, Mistral Vibe) makes a skill available in a resumed fix-attempt session, and which adapters declare that they can. Also what phax does when a skill's path holds no SKILL.md (for example, falling back to naming the path, with a warning).
- The report file's name, the fix prompt's and handoff's wording, and where the `Left to judgement` section sits.
- Whether the gate-attribution `refused` result gives that format its own next shape, and whether the brief-record JSON Schema's wording about `answer` changes its snapshot.
- Whether hello-world's audit.mjs and brief.mjs share one module that computes the report.
- How the phase's stop on a refusal is expressed in the run and phase state (the existing gate-failure pause, or a distinct reason), while keeping exit 4 and `phax resume` running the gate first.

Constraints:

- phax judges nothing in a report. Its decode checks are structural: ids, completeness of places, kind and state agreement, range order, and a due at the gate. They never cover truth, due-ness, debt validity or whether a file exists.
- No back-compat shims, and explicit per-variant enums: leg kinds, per-kind states, the outcome, the repair kinds and the gate-attribution result.
- A brief informs and never blocks. The gate's verdict comes only from the provider's stated facts.
- No command is granted from a report's content. No file phax adds to load a skill may enter the phase's commit.
- Served schema URLs are never withdrawn. Copy the gate-pending precedent: a frozen copy kept outside `packages/schemas/snapshots/`, with the deploy guard unchanged.
- Docs to update: README §Extend phax (rename "Diagnostics gate steps"), Gate request, Brief provider and §Persisted formats; the `phax-cli` and `phax-planning` skills where they quote diagnostics; NEXT_STEPS.md's steme section; and the `oracle-phases` spec's diagnostics wording.
- Tests to update: tests/integration/exampleProviders.test.ts, the fix prompt, brief render, review handoff and records explain tests, the schemas package suite, and the site schemas and deploy-guard tests.

## 11. Docs page

Page: README §Extend phax (rendered on docs.phax.run): "Guarantee report steps" (replacing "Diagnostics gate steps"), "Gate request", "Brief provider", plus the `guarantee-report` row in §Persisted formats

Reader: The author of a gate step or brief provider (steme first) deciding what to print, plus the operator wiring it into phax.json and granting its lay command

Example: The hello-world `audit.mjs` prints a `guarantee-report` for `hw-pure-module` in which greet's `no-node-import` is `forbidden`, due this phase, with the skill `pure-greet`. The step fails. The agent's fix prompt shows the leg, its finding at src/greet.ts:1, the met `exports-function` beside it and the accepted debt at legacy, and the agent's session has `pure-greet` loaded. `plain-wording` shows up only under `Left to judgement` in the review handoff.
