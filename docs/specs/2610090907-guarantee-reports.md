---
status: Draft
date: 2026-10-09
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Guarantee reports: a gate report and a brief report over shared definitions, carrying only what someone acts on

## 1. Context

A gate step that declares `"output": "diagnostics"` prints a `gate-diagnostics` document: `{$schema, diagnostics: [{rule, class: invariant|completion, location: {file, line?}, message, repair}]}`. Any finding fails the step, whatever the exit code. An empty list passes on exit 0 and is a provider error on a non-zero exit. On a failing attempt, phax writes the decoded findings, re-stamped, as `checks-attempt-NN.diagnostics.json`. The fix prompt lists each finding as `rule at file:line — message`, then `repair guide: <repair>`. Gate attribution records each step as `pass` or `fail`. Steps run fail-fast.

A brief provider answers a `brief-answer`: guarantees `{id, statement, places}`, where each place is `{location, state: met|missing|forbidden|accepted, due?, what?, repair?}`. The pushed brief gives one line per guarantee with its non-met places, 50 guarantees at most. `phax brief` prints every place with `what` and `repair`. Each call is kept, answer as printed, in a `brief-NN.json` record.

The review handoff is also the PR body, after a header, cut from the end at 60000 bytes. It carries nothing from a gate step or a brief answer.

The gate request and the brief request keep their shapes:
- gate request: `{$schema, phase, base, terminal, phases}`;
- brief request: the same facts plus `files`, or `files` alone outside a phase.

open-next-release (Approved) makes a stamp name a format's shape. A new format is born at the opened version (0.21.0 after the 0.20.0 release), and an older shape is refused by name.

steme, the first provider, restructured its guarantee model:
- A guarantee is made of legs (obligations and prohibitions), applied at places (steme's instances), and keyed in steme's ledger by (place, guarantee, leg).
- Repairs are rendered into the unit as files, each with a one-line description: a blueprint document (BLUEPRINT.md), or a skill directory (SKILL.md), one per place and sharing a name.
- Accepted debt is steme's own baseline input.
- A preflight can refuse to run.
- What is left to a person's judgement has an owner.

Each fix attempt resumes the agent session as a new process: `claude --resume`, `codex exec resume` or `vibe --resume`. Vibe is skipped in secure mode.

Ground read:

- `docs/briefs/guarantee-reports.md` — The brief. It holds the author's arbitration of 2026-10-08/09, which is not reopened here: two formats over shared definitions; only open legs travel; accepted debt and repair freshness are never sent; repairs are blueprint and skill files; the gate report lists what fails now, with no due; a refusal stops the phase without a fix attempt; judgement goes to the review only; the fix prompt, pushed brief and pulled brief are as decided; reports are saved as printed; and the out-of-scope list.
- `docs/specs/archive/2610081624-guarantee-reports.md` — The abandoned first draft. Its fix prompt layout, refusal output, gate-attribution `refused`, `Left to judgement` section, saved report file and served-URL handling are reused here where they agree with the arbitration. Dropped from it: one shared format, per-leg states, `due` in the gate, accepted debt, stale repairs, the note kind, the lay command, other legs in the fix prompt, and fixed/new marks.
- `README.md` — Extend phax: Diagnostics gate steps (verdict from the document), Gate request (`input`, saved request, replay), Brief provider (pushed and pulled moments, 50-guarantee cap, 60 s limit, records, `phax brief` grant and exit codes), Persisted formats rows for gate-diagnostics and brief-answer, and exit code 4.
- `src/schemas/gateDiagnostics.ts` — gate-diagnostics: {$schema, diagnostics: [{class: invariant|completion, rule, location: {file, line?}, message, repair}]}. Unknown keys are ignored.
- `src/schemas/brief.ts` — brief-answer: guarantees [{id, statement, places: [{location, state: met|missing|forbidden|accepted, due, what, repair}]}]. The brief request has phase and outside variants and refuses excess keys. A brief-record's outcome is answered {answer as printed} or failed {reason}.
- `src/schemas/persisted.ts` — readGateDiagnosticsAnswer and readBriefAnswer read an answer by its own $schema, refuse a newer or unknown stamp by name, and rely on the constants LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE and LAST_RELEASE_WITHOUT_BRIEF_ANSWER.
- `src/app/gates.ts` — Steps run fail-fast. A diagnostics step fails on any finding whatever its exit code. An empty list passes on exit 0 and is a provider error on a non-zero exit. A missing or unreadable document is a provider error, with DIAGNOSTICS_EXPECTED_SHAPE as the hint. On a failing attempt the re-stamped findings are written as .diagnostics.json. Attribution results are pass and fail.
- `src/app/fixLoop.ts` — The same-session fix loop. Each failed attempt dispatches GateFailed, which carries the diagnostics. When attempts run out it ends with GateAttemptsExhaustedError (exit 4). Otherwise it builds the fix prompt from the attempt's log and resumes the agent session.
- `src/domain/gate/fixPrompt.ts` — Each finding is rendered as `rule at file:line — message` with `repair guide: <repair>`. With no findings the raw log is shown instead. The heading and the Required action lines are reused here.
- `src/domain/brief/render.ts` — The pushed section is a heading, an intro, one compact line per guarantee, BRIEF_PUSH_CAP 50 and three closing instructions. The unavailable line is `The brief is unavailable at phase start (<reason>)`. The whole form prints every place with what and repair.
- `src/app/reviewHandoff.ts` — Handoff sections in order: run summary, source spec, global unplanned, missing, attention points, unexplained deviations, plan compliance review, phase details. Nothing comes from a gate or brief answer.
- `src/domain/publish/body.ts` — The PR body is a header followed by the review handoff, cut from the end at 60000 bytes. A section placed before Phase details survives truncation first.
- `src/app/recordsExplain.ts` — --gates prints each checks-attempt-NN.log followed by its .request.json. --briefs prints brief-NN.json as stored. Neither decodes anything.
- `src/schemas/gateAttribution.ts` — A step result is {command, surface, result: pass|fail}.
- `src/infra/providers/claudeCode.ts` — A fix attempt is a new `claude --print … --resume <id>` process. Secure mode adds --add-dir, --allowedTools, an inline --settings and --strict-mcp-config.
- `src/infra/providers/codexCli.ts` — A fix attempt is a new `codex exec resume <id> --json -c …` process.
- `src/infra/providers/mistralVibe.ts` — A fix attempt is a new `vibe … --resume <id>` process. Vibe is skipped in secure mode.
- `https://code.claude.com/docs/en/plugins-reference` — Read 2026-10-09 through a research agent, together with the skills and cli-reference pages. `--plugin-dir <path>` loads a plugin for the session only, can be repeated and writes nothing. A directory with SKILL.md at its root loads as a single skill. Plugin skills are namespaced `plugin:skill`. Skills load at process start. Codex's and Vibe's skill docs could not be read in this session, so no mechanism of theirs is verified.
- `examples/hello-world/` — audit.mjs prints gate-diagnostics with HW_NO_IO per node: import in the changed .ts files under src/ (all of them on the terminal phase). brief.mjs prints brief-answer with one hw-no-io guarantee. phax.json declares the step with "output": "diagnostics" and "input": "gate-request", and agentCommands ["node"]. plan.md plans src/greet.ts, a pure `greet`.
- `docs/specs/2610081603-open-next-release.md` — Approved, not yet landed. A stamp names the format's shape. A new format is stamped with the opened version (0.21.0 after 0.20.0). An answer is read from its format's current stamp up to the running version, and an older shape is refused by name with the URL phax reads. A test holds the hello-world stamps to their formats' current stamps.
- `docs/specs/archive/2610061345-drop-gate-scopes.md` — Precedent for a hard drop. gate-pending left the schemas package with no shim, and its served URLs stayed up byte for byte from a frozen copy outside the snapshots. The deploy guard is unchanged.
- `NEXT_STEPS.md` — The steme section: guarantee-reports is step 2, after open-next-release and before the `decision` class. The coordination note's asks (stable identity, structured repair, end line) are this spec's to design. Before 1.0, older answer shapes are refused by name.

## 2. Problem

Both formats flatten steme's model, and both send things nobody acts on.
- A diagnostic's `rule` is one string, where steme has a guarantee and a leg. Its `message` merges the statement, the instance and the finding. Nothing identifies a finding across attempts.
- A location is a file and a single line. Any other file the leg involves appears only in prose.
- A repair is a string, where steme has a document to read or a skill to load.
- The brief answer carries met places and accepted debt, which the agent cannot act on. The pushed brief mixes places due later with places due now.
- Something steme leaves to a person can only become a finding the agent is told to fix, or be dropped. It never reaches the reviewer.
- A provider that declines to run can only print an empty document or exit non-zero. That reads as a pass or as a broken script, and either way it spends a fix attempt on something the agent cannot change.
- The gate and the brief state the same facts in two unrelated shapes, so a provider keeps two serializers that can drift apart.

## 3. Product goal

A gate step answers with a gate report, and a brief provider answers with a brief report. The two formats share one set of definitions: guarantee, leg, place, location, finding and repair. Each format carries only what its reader acts on:
- The gate report lists the open legs that fail now, with their findings and repairs, and the judgements left to a person.
- The brief report lists each guarantee's legs, and the open legs at the requested paths with their due and repair.

phax routes each fact to whoever acts on it:
- the failing legs and their repairs go to the fix attempt, with skills loaded as skills where the provider can load them;
- the legs due this phase go to the pushed brief;
- the whole brief goes to `phax brief`;
- judgement goes to the reviewer through the review handoff;
- a refusal goes to the operator, without spending a fix attempt.

Today's two formats are removed with no shim and no leftover name.

> The agent gets only what it can act on; anything else is too much information — and a provider sends only what someone acts on.

## 4. Terminology

- **gate report** — The document a report step prints in answer to the gate request. Its format is `gate-report`. It holds what fails the step now and the judgements left to a person. Its outcome is `audited` or `refused`.
- **brief report** — The document a brief provider prints in answer to the brief request. Its format is `brief-report`. It holds each guarantee over the requested paths with all its legs, and the open legs there with their due and repair. Its outcome is `audited` or `refused`.
- **report step** — A gate step that declares `"output": "gate-report"`.
- **guarantee** — An expectation of the project's standard, with an `id` and a `statement`.
- **leg** — One checkable part of a guarantee, with an `id`, a `kind` and a `statement`. An `obligation` requires something to be there. A `prohibition` forbids something from being there.
- **place** — Where a guarantee applies (steme's instance), with a provider-chosen `id` and a `location`.
- **identity** — The triple (place id, guarantee id, leg id), compared by equality. It is steme's ledger key. phax uses it to refuse a malformed report and to mark a leg `still failing` across attempts.
- **location** — A working-tree-relative `file` plus a `range` `{start, end}` of 1-based inclusive lines, or `range: null` for the whole file.
- **finding** — What a leg's check found: `what` (in the provider's words), its `location`, and `related`, the other locations the leg involves, each with a `why`.
- **open leg** — A leg that is not satisfied at a place: an obligation missing there, or a prohibition violated there. Only open legs travel. Legs that are met, clear, accepted as debt or not examined are never sent.
- **due** — In a brief report only, the provider's word on when an open leg must be closed: `this-phase`, `later`, or null when the request carried no phase facts. phax never computes or checks it. A gate report has no due, because it lists only what is due now.
- **repair** — A file that tells how to close an open leg, with a one-line `description`. A `blueprint` carries the `path` of its document (a BLUEPRINT.md), which the agent reads and follows. A `skill` carries its `name` and the `path` of the directory that holds its SKILL.md.
- **judgement** — Something a guarantee leaves to a person: `what` is to be judged, its `owner`, and the places it concerns. Only the gate report carries it, and it only ever reaches the reviewer.
- **refused report** — A report with outcome `refused`: the provider declined to run (steme's preflight). It carries a `reason` and a `remedy` for the operator.
- **readable report** — A report that phax decoded under its own `$schema`, whether audited or refused. Anything else a provider prints is unreadable.
- **broken step** — A report step that printed no readable gate report, or printed an audited report with no open leg but exited non-zero. It fails the step, and the fix attempt gets the raw log, as for a log step.
- **loaded name** — The name the agent uses to invoke a skill phax loaded into its session. phax chooses it so that two skills with the same `name` stay distinct.

## 5. Functional requirements

### 5.1 Each answer has its own format

phax shall read a report step's stdout only as a `gate-report` document and a brief provider's stdout only as a `brief-report` document, each under its own `$schema` and by the stamp rules of open-next-release.

### 5.2 Another format is refused by name

IF a report step or a brief provider prints a document whose `$schema` names any format other than the one it answers in, `gate-diagnostics` and `brief-answer` included, THEN phax shall refuse it by name, naming the `$schema` URL of the format it reads at that format's current stamp.

### 5.3 The step output value

IF a gate step declares an `output` other than `"log"` or `"gate-report"`, `"diagnostics"` included, THEN config validation shall refuse it with exit 2, naming the step and the two allowed values.

### 5.4 Shared definitions

Both formats shall state each shared fact with the same keys: a guarantee as `id` and `statement`; a leg as `id`, `kind` (`obligation` or `prohibition`) and `statement`; a place as `id` and `location`; a location as a working-tree-relative `file` and a `range` of 1-based inclusive lines `{start, end}` or null; and a finding as `what`, `location` and `related`, each related entry a `location` and a `why`.

### 5.5 Two repair kinds

A repair shall be exactly one of two kinds, each with a one-line `description`: a `blueprint`, carrying the `path` of its document, or a `skill`, carrying its `name` and the `path` of the directory that holds its SKILL.md. An open leg with no repair shall carry `repair: null`.

### 5.6 A place lists only its open legs

In both formats a place shall list at least one open leg and nothing else. Each open leg shall name a leg its guarantee declares and carry at least one finding and its repair.

### 5.7 Identities are well formed

IF a report has any of the following: two guarantees with one id; two legs or two places of one guarantee with one id; a place that lists one leg twice; or an open leg naming a leg its guarantee does not declare, THEN phax shall refuse it as malformed, naming the offending guarantee, place or identity.

### 5.8 Ranges are ordered

IF a location's range starts below line 1 or ends before it starts THEN phax shall refuse the report as malformed, naming the location's file.

### 5.9 Only named keys travel

IF a report carries, at any level, a key its format does not name THEN phax shall refuse it as malformed, naming the key's path.

### 5.10 Two outcomes

Each report shall be exactly one of two outcomes: `audited`, carrying its guarantees, or `refused`, carrying a `reason` and a `remedy` for the operator.

### 5.11 What a gate report carries

For each guarantee, an audited gate report shall carry the legs it lists open, its places with their open legs, and its judgements. Each judgement is a `what`, an `owner` and the non-empty list of places it concerns. A gate report shall carry no `due`.

### 5.12 A gate report carries nothing that does not fail or need judgement

IF a guarantee in an audited gate report declares a leg that none of its places lists open, or carries neither a place nor a judgement, THEN phax shall refuse the report as malformed, naming the guarantee.

### 5.13 What a brief report carries

For each guarantee, an audited brief report shall carry every leg of the guarantee (at least one) and the places over the requested paths with their open legs. Each open leg carries a `due` of `this-phase` or `later`, or null when the request carried no phase facts. A brief report shall carry no judgement.

### 5.14 A listed leg fails the step

WHEN a report step prints an audited gate report listing at least one open leg THE system SHALL fail the step, whatever its exit code.

### 5.15 An empty list passes

WHEN a report step exits 0 and prints an audited gate report listing no open leg THE system SHALL pass the step, whatever judgements the report carries.

### 5.16 An empty list with a non-zero exit is broken

IF a report step prints an audited gate report listing no open leg and exits non-zero THEN phax shall fail the step as a broken step.

### 5.17 An unreadable report is broken

IF a report step prints no readable gate report THEN phax shall fail the step as a broken step and give the fix attempt the raw log, as it does for a log step.

### 5.18 Report steps stay fail-fast

phax shall run a gate profile's steps fail-fast, report steps included: no step runs after a step that failed or refused.

### 5.19 A refusal stops the phase

WHEN a report step prints a refused gate report THE system SHALL stop the phase with a gate failure, without a fix attempt. It SHALL exit 4, naming the step, the reason and the remedy.

### 5.20 A refusal spends nothing

WHEN a refusal stops the phase THE system SHALL count no fix attempt for it, so `phax resume` runs the gate again with as many fix attempts left as the phase had before the refusal.

### 5.21 A refusal is attributed as such

phax shall record a step that printed a refused gate report with the gate-attribution result `refused`, distinct from `pass` and `fail`.

### 5.22 The fix prompt shows each failing leg

WHEN a step fails on an audited gate report THE fix prompt SHALL show each open leg under its guarantee's statement and its place. For each it SHALL give the leg's kind and statement, every finding with its location and related locations, and its repair.

### 5.23 The fix prompt shows nothing else

The fix prompt shall show no leg the gate report does not list open and no judgement. From earlier attempts it shall show only the `still failing` mark.

### 5.24 Still failing, by identity

WHEN the phase's previous gate attempt failed on the same step with an audited gate report THE fix prompt SHALL mark `still failing` each open leg whose identity that report also listed.

### 5.25 A blueprint is a document to follow

The fix prompt shall show a blueprint repair as its description and an instruction to read the document at its path and follow it.

### 5.26 A skill is loaded as a skill

WHERE the agent's provider can load skills THE system SHALL load each skill repair in the failing step's report into the fix attempt's session through that provider's own skill mechanism. The fix prompt SHALL give the skill's loaded name and description, without pasting its content.

### 5.27 Without skill loading, the path is named

WHERE the agent's provider cannot load skills THE fix prompt SHALL give each skill repair's name, its description and the path of its SKILL.md, with an instruction to read it and follow it.

### 5.28 A skill path without SKILL.md

IF a skill repair's path holds no SKILL.md THEN phax shall load nothing from it. The fix prompt shall give the repair's description and say that no SKILL.md exists at that path, and the run output shall warn once per attempt, naming the step and the path.

### 5.29 Same-named skills stay apart

WHEN two skill repairs for one fix attempt share a `name` but not a `path` THE system SHALL load both, each under a loaded name no other skill in the session has, and SHALL load a repeated path only once.

### 5.30 Loading a skill writes nothing into the worktree

phax shall write no file into the phase's worktree in order to load a skill, and nothing it uses to load one shall enter the phase's commit.

### 5.31 A report grants nothing

phax shall grant the agent no command because a report or a repair names it. A tool a repair calls for runs only if `security.agentCommands` or the gate commands already allow it.

### 5.32 The pushed brief lists what is due this phase

WHEN a phase starts fresh and the brief provider prints an audited brief report THE pushed brief SHALL list only the open legs due `this-phase`, in the provider's order, at most 50 lines. Each line SHALL give the leg, its place's location and its repair's description.

### 5.33 Nothing due this phase

WHEN the pushed brief report lists no open leg due `this-phase` THE pushed brief SHALL say, in one line, that nothing in this phase's planned files is due in this phase.

### 5.34 `phax brief` prints the whole brief

WHEN `phax brief` gets an audited brief report THE system SHALL print, for each guarantee, its statement and every leg with its kind and statement. It SHALL then print each open leg at the requested paths with its place, due, findings and repair, including the repair's path and, for a skill, its name.

### 5.35 A refused brief is a failed brief

WHEN a brief provider prints a refused brief report THE system SHALL treat the brief as failed. The pushed brief's unavailable line SHALL give the reason, and the run-output warning and `phax brief` SHALL give both the reason and the remedy, with `phax brief` exiting 1.

### 5.36 Judgement reaches the reviewer

WHEN phax generates the review handoff THE system SHALL gather into one `Left to judgement` section every judgement in the gate reports of each phase's last gate attempt. The section SHALL be grouped by owner, listing each guarantee once per owner with the phases that reported it.

### 5.37 Where the section sits

The `Left to judgement` section shall appear only when at least one judgement was gathered. It shall come before `## Phase details`, so a truncated PR body keeps it.

### 5.38 Gate reports are saved as printed

WHEN a report step prints a readable gate report THE system SHALL save it beside the attempt's log exactly as printed, whatever the step's verdict.

### 5.39 Brief reports are recorded as printed

WHEN a brief provider prints a readable brief report THE system SHALL keep it in that call's brief record exactly as printed, including a refused one.

### 5.40 `records explain --gates` prints the reports

WHEN `phax records explain --gates` runs THE system SHALL print, for each attempt, its log, its gate request and then each gate report saved for that attempt, all as stored.

### 5.41 The schemas package

@lbdremy/phax-schemas shall read `gate-report` and `brief-report`. It shall have no `gate-diagnostics` or `brief-answer` format: no format id, parser, type, frozen module, snapshot or JSON Schema.

### 5.42 Served URLs stay up

The docs site shall keep serving every `gate-diagnostics` and `brief-answer` schema URL it serves before this change, byte for byte and listed in its index. It shall serve neither format for any later release.

### 5.43 The hello-world example

The hello-world `audit.mjs` shall print a gate report, and `brief.mjs` a brief report, over one guarantee that has an obligation and a prohibition. Their repairs shall be one blueprint file and one skill file that ship in the example.

### 5.44 The README describes the reports

The README shall describe the gate report under "Gate report steps" (replacing "Diagnostics gate steps"), the report step under "Gate request" and the brief report under "Brief provider". It shall list both formats under "Persisted formats" and name neither `gate-diagnostics` nor `brief-answer`.

## 6. Surface

### api: gate report, printed by a report step on stdout — normative

before:

    gate-diagnostics, printed by a "diagnostics" step:

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json",
      "diagnostics": [
        { "rule": "HW_NO_IO", "class": "invariant", "location": { "file": "src/greet.ts", "line": 1 },
          "message": "greet must not perform I/O", "repair": "plan.md#phase-01-greet-function" }
      ]
    }

after:

    Normative: the keys, the outcome values, the leg kinds and the repair kinds. The content is made up. Every key shown is required. `range` and `repair` may be null; `related` and `judgements` may be empty. No other key is read (§9 Q2).

    {
      "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json",
      "outcome": "audited",
      "guarantees": [
        {
          "id": "hw-pure-module",
          "statement": "a module under src/ exports its function and performs no I/O",
          "legs": [
            { "id": "exports-function", "kind": "obligation",  "statement": "it exports its function" },
            { "id": "no-node-import",   "kind": "prohibition", "statement": "it imports no node: module" }
          ],
          "places": [
            {
              "id": "greet",
              "location": { "file": "src/greet.ts", "range": null },
              "open": [
                {
                  "leg": "no-node-import",
                  "findings": [
                    {
                      "what": "imports node:fs",
                      "location": { "file": "src/greet.ts", "range": { "start": 1, "end": 1 } },
                      "related": [
                        { "location": { "file": "src/cli.ts", "range": { "start": 3, "end": 5 } },
                          "why": "the caller, where the read belongs" }
                      ]
                    }
                  ],
                  "repair": { "kind": "skill", "description": "move I/O out of the module and into its caller",
                              "name": "no-io", "path": "repairs/no-io" }
                }
              ]
            },
            {
              "id": "farewell",
              "location": { "file": "src/farewell.ts", "range": null },
              "open": [
                {
                  "leg": "exports-function",
                  "findings": [
                    { "what": "no exported function",
                      "location": { "file": "src/farewell.ts", "range": null }, "related": [] }
                  ],
                  "repair": { "kind": "blueprint", "description": "lay out a pure module",
                              "path": "repairs/pure-module/BLUEPRINT.md" }
                }
              ]
            }
          ],
          "judgements": [
            {
              "what": "whether 'Hello, <name>!' is the greeting the product wants",
              "owner": "hw-maintainers",
              "places": [ { "id": "greet", "location": { "file": "src/greet.ts", "range": null } } ]
            }
          ]
        }
      ]
    }

    This report fails the step on two identities: (greet, hw-pure-module, no-node-import) and (farewell, hw-pure-module, exports-function). The judgement fails nothing.

    `legs` lists exactly the legs that some place lists open. greet's exports-function is met, so it does not appear at greet.

    A passing report is { "$schema": …, "outcome": "audited", "guarantees": [] }, or one whose guarantees carry judgements only.

    There is no due, no state, no met or accepted leg, no freshness field and no tool command.

### api: brief report, printed by a brief provider on stdout — normative

before:

    brief-answer:

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

    The same definitions as the gate report. In place of judgements, every open leg carries a `due`, and `legs` lists every leg of the guarantee, whether or not it is open, because it says what a file there must and must not do, even a file not written yet. `places` may be empty. `due` is "this-phase" | "later" | null (null when the request carried no phase facts).

    {
      "$schema": "https://docs.phax.run/schemas/brief-report/0.21.0.json",
      "outcome": "audited",
      "guarantees": [
        {
          "id": "hw-pure-module",
          "statement": "a module under src/ exports its function and performs no I/O",
          "legs": [
            { "id": "exports-function", "kind": "obligation",  "statement": "it exports its function" },
            { "id": "no-node-import",   "kind": "prohibition", "statement": "it imports no node: module" }
          ],
          "places": [
            {
              "id": "greet",
              "location": { "file": "src/greet.ts", "range": null },
              "open": [
                { "leg": "no-node-import", "due": "this-phase",
                  "findings": [ { "what": "imports node:fs",
                                  "location": { "file": "src/greet.ts", "range": { "start": 1, "end": 1 } }, "related": [] } ],
                  "repair": { "kind": "skill", "description": "move I/O out of the module and into its caller",
                              "name": "no-io", "path": "repairs/no-io" } }
              ]
            },
            {
              "id": "farewell",
              "location": { "file": "src/farewell.ts", "range": null },
              "open": [
                { "leg": "exports-function", "due": "later",
                  "findings": [ { "what": "the file does not exist yet",
                                  "location": { "file": "src/farewell.ts", "range": null }, "related": [] } ],
                  "repair": { "kind": "blueprint", "description": "lay out a pure module",
                              "path": "repairs/pure-module/BLUEPRINT.md" } }
              ]
            }
          ]
        }
      ]
    }

    Nothing to report: { "$schema": …, "outcome": "audited", "guarantees": [] }. The provider's order is its rank.

### api: refused report, either format — normative

    The provider declined to run, for example because steme's preflight failed:

    {
      "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json",
      "outcome": "refused",
      "reason": "the standard needs pack hw-core 2, and 1 is installed",
      "remedy": "steme pack install hw-core@2"
    }

    A brief provider prints the same keys under "https://docs.phax.run/schemas/brief-report/0.21.0.json" (§9 Q1). The exit code does not matter for a refused report.

### config: gate step output in phax.json — normative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "diagnostics", "input": "gate-request" }

    output: "log" (default) | "diagnostics"

after:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "gate-report", "input": "gate-request" }

    output: "log" (default) | "gate-report". `input` is unchanged, and a report step does not have to declare it.

    "output": "diagnostics" → ✗ gate step "node ./audit.mjs": output must be "log" or "gate-report"   $? = 2

### internal: fix prompt after a report step fails — indicative

before:

    ## Diagnostics

    - HW_NO_IO at src/greet.ts:1 — greet must not perform I/O
      repair guide: plan.md#phase-01-greet-function

    Full output: …/checks-attempt-01.log

after:

    # Gate checks failed — fix required

    Gate run (attempt 2) failed.

    **Failed step:** `node ./audit.mjs` (2 failing legs)

    ## Failing legs

    ### hw-pure-module — a module under src/ exports its function and performs no I/O

    At greet (src/greet.ts):
    - no-node-import · prohibition · still failing — it imports no node: module
      - src/greet.ts:4 — imports node:fs
        - also involves src/cli.ts:3-5 — the caller, where the read belongs
      - repair: skill `greet:no-io`, loaded in this session — move I/O out of the module and into its caller

    At farewell (src/farewell.ts):
    - exports-function · obligation — it exports its function
      - src/farewell.ts — no exported function
      - repair: blueprint — lay out a pure module. Read repairs/pure-module/BLUEPRINT.md and follow it.

    Full output: …/checks-attempt-02.log

    ## Required action

    Use each leg's repair, then fix every leg under **Failing legs**.
    (the remaining Required action lines as today)

    The `still failing` mark is normative; the rest of the layout is indicative.

    Variants of the repair line:
    - A skill on a provider that cannot load skills: `- repair: skill no-io — move I/O out of the module and into its caller. Read repairs/no-io/SKILL.md and follow it.`
    - A skill whose path holds no SKILL.md: `- repair: skill no-io — move I/O out of the module and into its caller. Not loaded: repairs/no-io/SKILL.md does not exist.`
    - A leg with `repair: null` gets no repair line.

    The prompt never shows a judgement, a leg that is not open, or a fixed or new count. A broken step's fix prompt is today's raw-log prompt.

### internal: pushed brief in the phase's first prompt — indicative

before:

    ## Brief for this phase

    What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.

    - hw-no-io — nothing under src/ imports a node: module · forbidden src/greet.ts:1 (this phase)

    (three instructions)

after:

    ## Brief for this phase

    What the project's standard still requires of this phase's planned files, due in this phase, in the provider's order. It informs; the gate decides.

    - hw-pure-module · no-node-import (must not) at src/greet.ts — it imports no node: module · repair: move I/O out of the module and into its caller

    (three instructions, unchanged)

    The heading is unchanged. farewell's exports-function is due later, so it is not listed here; `phax brief` shows it.

    When nothing is due: `Nothing in this phase's planned files is due in this phase.`
    Over 50 lines: `- …and 10 more not shown. \`phax brief\` prints the phase's brief whole.`
    Refused: `The brief is unavailable at phase start (refused: the standard needs pack hw-core 2, and 1 is installed). \`phax brief\` may still answer.` The remedy is for the operator and does not go to the agent.

### cli: phax brief [path…] — indicative

before:

    hw-no-io — nothing under src/ imports a node: module
      forbidden  src/greet.ts:1   due this phase
        what:    imports node:fs
        repair:  remove the import; greet is pure
      met        src/cli.ts

after:

    $ phax brief src/greet.ts src/farewell.ts
    hw-pure-module — a module under src/ exports its function and performs no I/O
      must      exports-function   it exports its function
      must not  no-node-import     it imports no node: module
      greet  src/greet.ts
        no-node-import     due this phase
          found:   src/greet.ts:1 — imports node:fs
          repair:  skill no-io — move I/O out of the module and into its caller (repairs/no-io/SKILL.md)
      farewell  src/farewell.ts
        exports-function   due later
          found:   src/farewell.ts — the file does not exist yet
          repair:  blueprint — lay out a pure module (repairs/pure-module/BLUEPRINT.md)
    $? = 0

    Refused:
    ✗ brief refused: the standard needs pack hw-core 2, and 1 is installed — remedy: steme pack install hw-core@2
    $? = 1

    The exit codes are otherwise unchanged: 0 for any audited report, `[]` included; 1 otherwise.

### cli: run output on a refusal, a missing SKILL.md and an old-format answer — indicative

before:

    ✗ Gate command failed: node ./audit.mjs (0 diagnostic(s))   — then a fix attempt on the raw log

after:

    ✗ phase-01 gate: `node ./audit.mjs` refused to run: the standard needs pack hw-core 2, and 1 is installed
      remedy: steme pack install hw-core@2
      No fix attempt was made. Fix the cause, then: phax resume my-project.greet
    $? = 4   (exit code normative)

    ⚠ phase-01 gate: skill `no-io` names repairs/no-io, which holds no SKILL.md; it was not loaded

    ⚠ phase-01 brief unavailable: refused: the standard needs pack hw-core 2, and 1 is installed — remedy: steme pack install hw-core@2

    ✗ Gate step "node ./audit.mjs": gate-diagnostics is not read by this phax — it reads https://docs.phax.run/schemas/gate-report/0.21.0.json

### file: review-handoff.md and the PR body — Left to judgement — indicative

before:

    (no section; nothing from a gate step or brief answer reaches the review)

after:

    ## Left to judgement

    What the project's standard leaves to a person. None of it was sent to the agent.

    ### hw-maintainers

    - **hw-pure-module** — a module under src/ exports its function and performs no I/O (phase-01, phase-03)
      - whether 'Hello, <name>!' is the greeting the product wants — greet (src/greet.ts)

    Normative: the heading `## Left to judgement`; one group per owner; each guarantee once per owner, naming its phases; placement before `## Phase details`; no section when nothing was gathered. The wording and entry layout are indicative. The PR body carries the section because it carries the handoff.

### file: a phase folder's gate attempt and brief files — indicative

before:

    checks-attempt-01.log
    checks-attempt-01.request.json
    checks-attempt-01.diagnostics.json   (failing diagnostics step only; decoded findings, re-stamped by phax)
    brief-00.json, brief-01.json        (outcome.answer: the brief-answer as printed)

after:

    checks-attempt-01.log               (unchanged; it still holds each step's stdout)
    checks-attempt-01.request.json
    checks-attempt-01.report-04.json    (the gate report printed by the profile's 4th step, byte for byte; one per report step that printed a readable report, whether it passed, failed or refused)
    brief-00.json, brief-01.json        (brief-record shape unchanged; outcome.answer: the brief report as printed, a refused one included)

    No .diagnostics.json is written. Saving each readable report as printed is normative; the file name is indicative.

### file: gate-attribution step result — normative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "result": "fail" }   result: "pass" | "fail"

after:

    { "command": "node ./audit.mjs", "surface": "structural", "result": "refused" }   result: "pass" | "fail" | "refused"

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
    --- checks-attempt-01.report-04.json ---
    { "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json", "outcome": "audited", … }

    `--briefs` prints brief-NN.json as stored, as today. Files written before this change get no special handling.

### package: @lbdremy/phax-schemas formats — normative

before:

    gate-diagnostics (parseGateDiagnostics, json/gate-diagnostics.schema.json, frozen pre-schema and 0.17.0 modules)
    brief-answer (parseBriefAnswer, json/brief-answer.schema.json)

after:

    gate-report (parseGateReport, json/gate-report.schema.json)
    brief-report (parseBriefReport, json/brief-report.schema.json)
    gate-diagnostics and brief-answer are gone: no format id, parser, type, frozen module, history.lock entry, snapshot or JSON Schema.
    docs.phax.run keeps serving /schemas/gate-diagnostics/<R>.json and /schemas/brief-answer/<R>.json for every R it serves today, byte for byte, from a frozen copy. It serves neither format for any later release.

### file: README §Persisted formats rows — normative

before:

    | Gate diagnostics | `gate-diagnostics` | `<record>/checks-attempt-NN.diagnostics.json` | `parseGateDiagnostics` | `json/gate-diagnostics.schema.json` |
    | Brief answer | `brief-answer` | the brief provider's stdout, `outcome.answer` in a brief record | `parseBriefAnswer` | `json/brief-answer.schema.json` |

after:

    | Gate report | `gate-report` | a report step's stdout, `<record>/checks-attempt-NN.report-SS.json` | `parseGateReport` | `json/gate-report.schema.json` |
    | Brief report | `brief-report` | the brief provider's stdout, `outcome.answer` in a brief record | `parseBriefReport` | `json/brief-report.schema.json` |

### file: examples/hello-world/ — indicative

before:

    audit.mjs   prints gate-diagnostics (HW_NO_IO, invariant)
    brief.mjs   prints brief-answer (hw-no-io)
    phax.json   step "output": "diagnostics"

after:

    audit.mjs                         prints a gate report over hw-pure-module (exports-function, obligation; no-node-import, prohibition) for the changed .ts files under src/, or all of them on the terminal phase
    brief.mjs                         prints a brief report over the same guarantee and legs for the briefed .ts files under src/, existing or not
    repairs/pure-module/BLUEPRINT.md  the blueprint repair of exports-function
    repairs/no-io/SKILL.md            the skill repair of no-node-import (name: no-io)
    phax.json                         step "output": "gate-report", "input": "gate-request"
    Both scripts print their format's current stamp, which open-next-release's example-stamp test holds.

## 7. Non-goals

- A `decision` class that stops the phase for the owner. It is its own spec, joining `phase-decision-requests`. A judgement here never stops anything.
- Escalating or stopping on a leg that keeps failing. The identity makes it possible later; this spec only marks `still failing`.
- Marking legs as fixed or new, counting them, or showing anything else from earlier attempts.
- The architecture brief at plan authoring.
- Posting steme's check run to the pull request.
- steme's own conformity fixes.
- The plan auditor's answer.
- Any change to the gate request or the brief request.
- Any shim: no alias for `"output": "diagnostics"`, no reading of a `gate-diagnostics` or `brief-answer` answer, no upgrade note, and no special handling of past runs' `.diagnostics.json` or `brief-NN.json`.
- Accepted debt, met, clear or unexamined legs, leg states and repair freshness, in either format. Stale repairs are the provider's business.
- A third repair kind, inline steps, or carrying a blueprint's tool command (`steme lay`). A gate without repair files prints a log.
- phax reading, checking or pasting a blueprint document or a SKILL.md, or checking whether a finding is true, a due is right or a file exists. The one exception: phax checks that a SKILL.md exists, because it must load it.
- Loading skills at phase start or in the pushed brief. Skills are loaded only into fix attempts.
- Judgement in any agent prompt, in the pushed brief or in `phax brief`.
- Columns in a range, or any location unit other than whole lines.
- Severity or rank beyond the provider's order.

## 8. Acceptance criteria

### The hello-world providers answer both formats

Given the hello-world example in a worktree where `src/greet.ts` imports `node:fs` on line 1, a saved gate request whose phase changed `src/greet.ts`, and a brief request `{"files": ["src/greet.ts", "src/farewell.ts"]}`, when `audit.mjs` and `brief.mjs` run on them, then audit.mjs prints a `gate-report` document that `parseGateReport` reads. It has the open leg (greet, hw-pure-module, no-node-import) with the skill repair `repairs/no-io`. brief.mjs prints a `brief-report` document that `parseBriefReport` reads. It declares `exports-function` (obligation) and `no-node-import` (prohibition), lists greet's `no-node-import` and farewell's `exports-function` with `due` null, and gives the blueprint `repairs/pure-module/BLUEPRINT.md`. Both repair files exist in the example. (refs §5.1, §5.43, §5.4, §5.5, §5.13)

### Another format is refused by name

Given a report step that prints a `gate-diagnostics/0.20.0` document, a brief provider that prints a `brief-answer/0.20.0` document, and a second brief provider that prints a `gate-report/0.21.0` document, when the gate runs and each phase's brief is pushed, then the step fails as a broken step, and the failure names `https://docs.phax.run/schemas/gate-report/0.21.0.json`. Both briefs are unavailable, and each refusal names `https://docs.phax.run/schemas/brief-report/0.21.0.json`. (refs §5.2, §5.17)

### Only `log` and `gate-report` are outputs

Given one phax.json gate step with `"output": "diagnostics"`, and another with `"output": "gate-report"` and no `input`, when `phax run` loads each config, then the first exits 2, naming the step and the allowed values `"log"` and `"gate-report"`. The second loads. (refs §5.3)

### Malformed identities and ranges are broken steps

Given six gate reports, each otherwise like the §6 example: one with two places `greet` under hw-pure-module; one whose open leg names `exports-gretting`; one whose greet lists `no-node-import` twice; one with the range `{"start": 3, "end": 1}`; one that also declares a leg `pure-wording` that no place lists open; and one with a guarantee that has no place and no judgement, when the gate reads each, then each fails the step as a broken step. The first three name `hw-pure-module · greet`, `hw-pure-module · greet · exports-gretting` and `hw-pure-module · greet · no-node-import`. The fourth names `src/greet.ts`. The last two name their guarantee. (refs §5.7, §5.8, §5.12)

### Repairs, findings and open lists have their shape

Given five gate reports, each otherwise like the §6 example: a repair `{"kind": "steps", "description": "…"}`; a skill repair with no `description`; a blueprint with no `path`; an open leg with `"findings": []`; and a place with `"open": []`, when the gate reads each, then each fails the step as a broken step. The §6 example with farewell's repair set to `null` is read, and its step fails on both open legs. (refs §5.5, §5.6, §5.4)

### Keys outside the format are refused

Given a gate report with `"due": "this-phase"` on an open leg, a gate report with `"debt": {…}` on a place, and a brief report with a `judgements` key on a guarantee, when the gate reads the first two and the phase's brief is pushed with the third, then both steps fail as broken steps, naming `guarantees[0].places[0].open[0].due` and `guarantees[0].places[0].debt`. The brief is unavailable, naming `guarantees[0].judgements`. (refs §5.9, §5.11, §5.13)

### Two outcomes only

Given a gate report with `"outcome": "skipped"`, and a refused gate report with no `remedy`, when the gate reads each, then each fails the step as a broken step, with no fix attempt withheld. (refs §5.10)

### A listed leg fails the step, whatever the exit code

Given a report step that prints the §6 gate report, once with exit 0 and once with exit 1, when the gate runs, then the step fails both times, and both fix prompts list the two open legs and nothing else from the report. (refs §5.14)

### Judgement alone passes, and is saved

Given a report step that prints the §6 gate report with `legs` and `places` emptied, keeping its judgement, and exits 0, when attempt 1 runs, then the step passes. The phase folder holds the report beside `checks-attempt-01.log`, byte-identical to what the step printed. (refs §5.15, §5.38)

### An empty list with a non-zero exit is broken

Given a report step that prints `{"$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json", "outcome": "audited", "guarantees": []}` and exits 1, when the gate runs, then the step fails as a broken step, and the fix prompt is the raw-log prompt with the step's log. (refs §5.16, §5.17)

### No readable report is broken

Given a report step that prints nothing and exits 0, and another that prints `not json`, when the gate runs each, then each fails as a broken step, each fix prompt is the raw-log prompt, and no report file is saved for that attempt. (refs §5.17)

### No step runs after a failure or a refusal

Given a profile whose first step is a report step and whose second is `pnpm test`, and a first step that prints the §6 gate report on one run and the §6 refused report on another, when the gate runs, then `pnpm test` runs on neither run, and the attempt log holds no `$ pnpm test` line. (refs §5.18)

### A refusal stops the phase without a fix attempt

Given a run with `agent.maxFixAttempts` 3 whose report step prints the §6 refused gate report, when the phase's gate runs, and then the operator runs `phax resume` after the step stops refusing, then no fix prompt is sent. The run exits 4, printing the step, `the standard needs pack hw-core 2, and 1 is installed` and `steme pack install hw-core@2`. gate-attribution records the step's result as `refused`. On resume, the gate runs first, and up to 3 fix attempts are still available. (refs §5.19, §5.20, §5.21)

### The fix prompt shows each failing leg and nothing else

Given the §6 gate report, when the fix prompt is built, then under `hw-pure-module` and its statement, it shows the place greet (src/greet.ts) with `no-node-import`, `prohibition`, `it imports no node: module`, the finding `src/greet.ts:1 — imports node:fs`, the related `src/cli.ts:3-5` with its why, and the skill repair. It shows farewell's `exports-function` with its finding and blueprint. It shows no greet line for `exports-function`, no judgement text and no `still failing` mark. (refs §5.22, §5.23)

### Still failing, by identity alone

Given attempt 1, where the report step failed listing (greet, hw-pure-module, no-node-import) at src/greet.ts:1 and (greet, hw-pure-module, exports-function), and attempt 2, where the same step fails listing (greet, hw-pure-module, no-node-import), now at src/greet.ts:4, and (farewell, hw-pure-module, no-node-import), when the fix prompt after attempt 2 is built, then greet's `no-node-import` is marked `still failing` and farewell's is not marked. The prompt names greet's `exports-function` nowhere and gives no fixed or new count. When attempt 1 instead failed on `pnpm test`, no leg is marked. (refs §5.24, §5.23)

### A blueprint is read and followed

Given the §6 gate report and `repairs/pure-module/BLUEPRINT.md` in the worktree, when the fix prompt is built, then farewell's repair line gives `lay out a pure module` and tells the agent to read `repairs/pure-module/BLUEPRINT.md` and follow it. No line of BLUEPRINT.md appears in the prompt. (refs §5.25)

### A skill is loaded, not pasted

Given a phase on Claude Code, the §6 gate report, and `repairs/no-io/SKILL.md` in the worktree, when the fix attempt runs, then the resumed session lists the skill under the loaded name the prompt gives, with the description `move I/O out of the module and into its caller`. The prompt contains no line of SKILL.md. After the attempt, `git status` in the worktree shows no file phax added, and the phase's commit contains none. (refs §5.26, §5.30)

### Without skill loading, the SKILL.md path is named

Given the same report on a provider declared unable to load skills (Codex, per §9 Q3), when the fix attempt runs, then the fix prompt gives `no-io`, its description and `repairs/no-io/SKILL.md`, with an instruction to read it and follow it. It contains no line of SKILL.md. (refs §5.27)

### A skill path with no SKILL.md

Given the §6 gate report with greet's skill path changed to `repairs/gone`, where no SKILL.md exists, on Claude Code, when the fix attempt runs, then no skill is loaded from it. The fix prompt gives the description and says `repairs/gone/SKILL.md` does not exist. The run output shows one warning naming `node ./audit.mjs` and `repairs/gone`. (refs §5.28)

### Same-named skills are both loaded

Given on Claude Code, a gate report whose places greet and farewell each list `no-node-import` with a skill named `no-io`, at `repairs/greet/no-io` and `repairs/farewell/no-io`, plus a third open leg repeating `repairs/greet/no-io`, when the fix attempt runs, then the session has exactly two loaded skills from the report, under two different loaded names. The fix prompt gives each place's skill by its own loaded name. (refs §5.29)

### A report grants nothing

Given a secure-mode run with `"security": {"agentCommands": ["node"]}`, and a failing report whose blueprint document tells the agent to run `steme lay pure-module src/farewell.ts`, when the fix attempt runs, then the phase's security.json lists exactly the entries and sources it lists without the report, with no `steme` entry. Once `steme` is added to `security.agentCommands`, it is listed with source `config`. (refs §5.31)

### The pushed brief lists only what is due this phase

Given a brief provider that answers the §6 brief report on the phase's request, when the phase starts fresh, then `## Brief for this phase` holds one line, for hw-pure-module's `no-node-import` at `src/greet.ts`, with its statement and `move I/O out of the module and into its caller`. No line names farewell or `exports-function`, and no line names a judgement. (refs §5.32)

### The pushed brief stops at 50 lines

Given a brief report with 60 open legs due `this-phase` and 5 due `later`, when the phase starts fresh, then the section lists the first 50 due legs in the provider's order, followed by one line saying 10 more are not shown and pointing to `phax brief`. (refs §5.32)

### Nothing due this phase

Given a brief report whose only open leg is farewell's `exports-function`, due `later`, when the phase starts fresh, then the section's body is the one line saying nothing in this phase's planned files is due in this phase, followed by the three instructions. (refs §5.33)

### `phax brief` prints legs and every open leg

Given the same provider inside the phase, when `phax brief src/greet.ts src/farewell.ts` runs, then it exits 0. It prints the statement; both legs with their kinds and statements; greet's `no-node-import` due this phase with its finding, `no-io` and `repairs/no-io/SKILL.md`; and farewell's `exports-function` due later with `repairs/pure-module/BLUEPRINT.md`. (refs §5.34, §5.13)

### A refused brief fails the brief, recorded whole

Given a brief provider that prints the §6 refused report under the `brief-report` `$schema`, when a phase starts fresh, and then the agent runs `phax brief src/greet.ts`, then the first prompt's unavailable line gives the reason and not the remedy. The run-output warning gives both. `phax brief` prints both and exits 1. `brief-00.json` and `brief-01.json` each hold the refused report as printed. The phase continues. (refs §5.35, §5.39)

### Judgement reaches the review, grouped by owner

Given a run whose phase-01 and phase-03 last gate attempts both report a hw-pure-module judgement owned by `hw-maintainers`, and whose phase-02 last attempt reports one owned by `docs-team`, when the review handoff is generated and `phax publish-pr` builds the PR body, then both contain one `## Left to judgement` section before `## Phase details`, with a `hw-maintainers` group listing hw-pure-module once, naming phase-01 and phase-03, and a `docs-team` group. A run with no judgement has no such section. (refs §5.36, §5.37)

### Only the last gate attempt counts

Given a phase whose attempt 1 report carried a judgement and whose last attempt's reports carry none, when the review handoff is generated, then the judgement does not appear in it. (refs §5.36)

### Every readable gate report is saved as printed

Given a profile whose 4th step is a report step that prints the §6 gate report, pretty-printed with a trailing newline, in attempt 1, and the §6 refused report in attempt 2, when both attempts run, then the phase folder holds attempt 1's and attempt 2's reports beside their logs, each byte-identical to what the step printed. No `.diagnostics.json` is written. (refs §5.38)

### `records explain --gates` prints the reports

Given the phase record of a run made after this change, with two attempts that each saved a report, when `phax records explain <commit> --gates` runs, then for each attempt it prints the log, the request and then the saved report, all as stored. (refs §5.40)

### The package reads the new formats only

Given the schemas package built after the change, when its formats, exports, snapshots and history.lock.json are inspected, then it exports `parseGateReport`, `parseBriefReport`, `json/gate-report.schema.json` and `json/brief-report.schema.json`. It has no `gate-diagnostics` or `brief-answer` format id, parser, type, frozen module, lock entry, snapshot or JSON Schema. (refs §5.41)

### Served URLs stay up

Given the `/schemas/index.json` that docs.phax.run serves before the change, when the site is built for the release that ships this change and the deploy guard runs, then every listed `gate-diagnostics` and `brief-answer` path is in the build with identical bytes and still listed, and neither format has a path for the new release. (refs §5.42)

### The README describes the reports

Given the README after the change, when §Extend phax and §Persisted formats are read, then they describe the gate report with the §6 example, `"output": "gate-report"`, the verdict rule, the refusal, the repair kinds and skill loading, the brief report, the pushed and pulled briefs, `Left to judgement`, and granting a repair's tool through `security.agentCommands`. They list the `gate-report` and `brief-report` rows, and neither `gate-diagnostics` nor `brief-answer` appears anywhere in the README. (refs §5.44)

## 9. Open questions for implementation planning

### Q1 — Does the brief report have the gate report's `refused` outcome, for a brief provider whose preflight declines to run? The arbitration defines the refusal for the gate only.

- Yes: the brief report has the same `refused` outcome, `{reason, remedy}`. phax treats it as a failed brief and gives the remedy to the operator, never to the agent. — abandons: A brief format with a single outcome. phax reads, renders and records one more variant on a path that already has a failure branch, and the agent sees the same 'unavailable' line it would see for a crashed provider.
- No: a brief provider that declines exits non-zero with a message, and phax shows that like any other failed brief. — abandons: The remedy as a fact. steme states one preflight refusal in two ways, structured to the gate and as stderr to the brief, and the operator gets a bare stderr line, or nothing, where the gate names the fix.

Recommendation: Yes: the brief report has the same `refused` outcome, `{reason, remedy}`. phax treats it as a failed brief and gives the remedy to the operator, never to the agent. — steme's preflight is one fact, and the shared definitions exist so that a provider states each fact the same way in both formats. It costs one variant on an existing failure path. The governing rule still holds: the agent gets only the reason line, which tells it not to rely on the brief, and the remedy goes only to the operator, who can act on it.

### Q2 — Does phax refuse a report that carries a key its format does not name, or ignore it as answers are read today?

- Refuse: an unknown key, at any level, makes the report malformed. That is a broken step at the gate and a failed brief. — abandons: Room for provider-private keys. A provider that adds its own annotation, such as an `x-steme` key, a met leg or a debt record, breaks the step or the brief until it removes the key.
- Ignore: unknown keys are dropped when read and kept in the saved copy, as today. — abandons: The format's promise that whatever travels gets acted on. Met legs, accepted debt or a freshness field could keep traveling unread, and the saved report, kept as printed, would show them to a reader as if phax had used them.

Recommendation: Refuse: an unknown key, at any level, makes the report malformed. That is a broken step at the gate and a failed brief. — The governing rule shapes the formats themselves: a provider sends only what someone acts on, and a strict decode is how phax holds that rule without judging content. The requests phax sends are already strict. Answers are versioned, so a new key arrives with a new stamp, and strictness costs no forward compatibility that the stamp does not already cost. It also makes the old habits (debt, met legs, freshness) fail loudly instead of passing silently.

### Q3 — Which agent providers load a skill repair into a resumed fix-attempt session at ship, and how? Claude Code's per-invocation plugin directory is documented. This authoring session could not verify a mechanism for Codex or Mistral Vibe.

- Claude Code loads skills through its per-invocation plugin directory. Codex and Mistral Vibe are declared unable and get the SKILL.md path, until a probe shows a per-invocation mechanism that writes nothing into the worktree or the user's home. — abandons: Native skill loading on two of three providers at ship. Their agents read SKILL.md as a file, without the harness resolving the skill's bundled references and scripts.
- Codex and Vibe load a skill by copying it into their project skills directory in the worktree (`.agents/skills/`, `.vibe/skills/`) for the attempt, and the copy is removed before the commit. — abandons: A worktree phax never writes into during an attempt. The agent sees phax's copy and can edit it, a crash leaves it behind to leak into the commit, and the no-changes and file-reconciliation checks must learn to ignore it.
- Codex and Vibe load a skill by pointing the provider's home (`CODEX_HOME`, Vibe's config home) at a per-attempt directory that holds the skill. — abandons: The operator's provider setup for that attempt. Auth, model configuration and the operator's own skills move, or must be copied, for each provider on every fix attempt.

Recommendation: Claude Code loads skills through its per-invocation plugin directory. Codex and Mistral Vibe are declared unable and get the SKILL.md path, until a probe shows a per-invocation mechanism that writes nothing into the worktree or the user's home. — Reading the SKILL.md path is already the decided behavior for a provider that cannot load skills, so the fallback is a supported path, not a gap. It breaks none of this spec's constraints. Claude Code's mechanism writes nothing and namespaces plugin skills, which also keeps same-named skills apart. Declaring the capability per adapter lets Codex or Vibe switch on later, behind a probe, with no change to either format. Vibe is skipped in secure mode anyway.

## 10. Implementation-planning note

Settled:

- Green field. These go with no shim and no leftover name: `gate-diagnostics`, `brief-answer`, `"output": "diagnostics"`, the `.diagnostics.json` write and its path helper, both answer readers with LAST_SAVED_FILE_ONLY_DIAGNOSTICS_RELEASE and LAST_RELEASE_WITHOUT_BRIEF_ANSWER, DIAGNOSTICS_EXPECTED_SHAPE, the `diagnostics` field of the GateFailed event, and the frozen gate-diagnostics history modules with their history.lock entries.
- Two new formats, `gate-report` and `brief-report`, are born at the opened version (0.21.0 once open-next-release has landed). Each is read only under its own `$schema`, by open-next-release's stamp rules.
- The gate request and the brief request keep their shapes and stamps. The brief-record keeps its shape, and its answered outcome holds the brief report as printed, a refused one included.
- Unchanged from brief-provider: the pushed and pulled moments, the 60 s limit, brief recording, `phax brief`'s exit codes, the phase guard and the `phax brief` grant.
- The pushed brief's cap now counts lines (open legs due this phase) and stays at 50.
- A report step does not have to declare `"input": "gate-request"`. What is due now is the provider's business.
- `still failing` compares against the phase's immediately previous gate attempt, and only when that attempt failed on the same step with an audited gate report.
- Claude Code loads a skill per invocation with `--plugin-dir`, per its documentation read on 2026-10-09: the flag can be repeated and is session-only, a directory with SKILL.md at its root loads as a single skill, and plugin skills are namespaced `plugin:skill`. Each resumed fix attempt is a new process, so the skill is loaded at its start.
- The §9 recommendations are defaults until the author arbitrates them.

Left open:

- The saved report's file name, and the wording of the fix prompt, the pushed brief, `phax brief`, the `Left to judgement` section and the run-output lines.
- The loaded-name scheme that keeps same-named skills distinct (for example `<place id>:<name>`), and what happens when place ids collide as well.
- Whether Codex and Mistral Vibe have a per-invocation skill mechanism that writes nothing into the worktree or home. Probe each before declaring it capable (§9 Q3).
- How the stop on a refusal shows in run and phase state (the existing gate-failure pause or a distinct reason), keeping exit 4, an unspent budget and `phax resume` running the gate first.
- Whether gate-attribution (new `refused` result) and brief-record (answer description) get `next` snapshots.
- Whether hello-world's audit.mjs and brief.mjs share one module that computes the guarantee.

Constraints:

- phax judges nothing in a report. Its decode checks are structural only: keys, ids, references between legs and open legs, range order, and the two shape rules of the gate report. The one file phax looks for is a SKILL.md, because it must load it.
- No back-compat shims. Explicit per-variant enums: outcome (`audited` | `refused`), leg kind, repair kind, due and gate-attribution result.
- A brief informs and never blocks. The gate's verdict is the provider's list.
- No command is granted from a report or a repair. Loading a skill writes nothing into the worktree, and nothing used to load one enters the phase's commit.
- Served schema URLs are never withdrawn. Follow the gate-pending precedent: a frozen copy kept outside `packages/schemas/snapshots/`, with the deploy guard unchanged.
- Docs to update: the README's Extend phax intro, "Gate report steps" (renamed from "Diagnostics gate steps"), "Gate request", "Brief provider" and §Persisted formats; the `phax-cli` and `phax-planning` skills where they mention diagnostics; NEXT_STEPS.md's steme section; and the `oracle-phases` spec's diagnostics wording.
- Tests to update: tests/integration/exampleProviders.test.ts, the gate, fix-loop and fix-prompt tests, brief render and pull, review handoff and publish body, records explain, the schemas package suite, the example-stamp test, and the site's schemas and deploy-guard tests.

## 11. Docs page

Page: README §Extend phax (rendered on docs.phax.run): "Gate report steps" (replacing "Diagnostics gate steps"), "Gate request" and "Brief provider", plus the `gate-report` and `brief-report` rows in §Persisted formats

Reader: The author of a gate step or brief provider (steme first), deciding what to print, and the operator who wires it into phax.json and grants any tool its repairs call for through `security.agentCommands`

Example: The hello-world audit.mjs prints a gate report in which greet's `no-node-import` is open, with the skill `no-io`. The step fails. On Claude Code the fix attempt's session has the skill loaded, and the fix prompt shows the leg, its finding at src/greet.ts:1 and the skill's description. brief.mjs answers `phax brief src/farewell.ts` for a file not yet written: it gives the guarantee's two legs, what the file must and must not do, and farewell's open `exports-function` with the blueprint `repairs/pure-module/BLUEPRINT.md`.
