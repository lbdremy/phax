---
status: Approved
date: 2026-10-09
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-09
  baseline: a12a641
---
# Gate and brief reports: two provider-neutral formats over shared definitions, carrying only what someone acts on

## 1. Context

A gate step that declares `"output": "diagnostics"` prints a `gate-diagnostics` document: `{$schema, diagnostics: [{rule, class: invariant|completion, location: {file, line?}, message, repair}]}`. phax reads the step's verdict from it:
- any finding fails the step, whatever the exit code;
- an empty list passes on exit 0;
- anything else fails the step with the raw log.

phax writes a failing document, re-stamped, as `checks-attempt-NN.diagnostics.json`. The fix prompt lists each finding as `rule at file:line — message`, followed by a `repair guide:` line. Gate attribution records each step that ran as `pass` or `fail`, and steps run fail-fast. When fix attempts run out:
- the phase pauses in `gates_exhausted`;
- the run exits 4;
- resume instructions are written;
- `phax resume` runs the gate first.

A brief provider answers with a `brief-answer`: guarantees `{id, statement, places}`, where each place is `{location, state: met|missing|forbidden|accepted, due?, what?, repair?}`. The `brief` block in phax.json holds only `command`. The pushed brief puts one compact line per guarantee into the phase's first prompt, 50 at most. `phax brief` prints every place with its `what` and `repair`. Every call is kept in a `brief-NN.json` record, with the answer as printed. Both answer readers ignore keys they do not name.

The review handoff carries nothing from a gate step or a brief. It is also the PR body, after a header, cut from its end at 60000 bytes.

The gate request `{$schema, phase, base, terminal, phases}` keeps its shape. So does the brief request: the same facts plus `files`, or `files` alone outside a phase.

open-next-release has landed: a stamp names a format's shape, and a new format is born at the opened version, 0.21.0. Served schema URLs stay up for good. gate-pending, dropped by drop-gate-scopes, is still served from frozen copies under `site/retired-schemas/gate-pending/`.

steme is the first provider. A previous replacement of these formats (`2610090907-guarantee-reports`, now abandoned) mirrored steme's internal model. Shown typical answers on 2026-10-09, the author found it too tied to steme and asked for something much simpler.

Ground read:

- `docs/specs/archive/2610090907-guarantee-reports.md` — The replaced spec, abandoned. Reused where they agree with the 2026-10-09 decisions: the refusal's run output, saving each readable report as printed, `records explain --gates`, the served-URL handling, placing the review section before Phase details, and the fix-loop acceptance criteria. Not reused: its vocabulary (guarantee, leg, place, blueprint, skill, judgement), its nesting, the leg kinds, the repair kinds and the identity triple.
- `README.md` — Extend phax: "Diagnostics gate steps" (the verdict comes from the document; empty or non-JSON output is a missing document), "Gate request" (`input`, the saved request, replay), "Brief provider" (pushed and pulled moments, the 50-guarantee cap, the 60 s limit, records, the `phax brief` grant and exit codes). Persisted formats: the gate-diagnostics and brief-answer rows.
- `src/schemas/gateDiagnostics.ts` — gate-diagnostics: {$schema, diagnostics: [{class: invariant|completion, rule, location: {file, line?}, message, repair}]}. Unknown keys are ignored.
- `src/schemas/brief.ts` — brief-answer: guarantees [{id, statement, places: [{location, state: met|missing|forbidden|accepted, due, what, repair}]}], with unknown keys ignored. The brief request has a phase variant and an outside variant and refuses excess keys. A brief-record's outcome is answered {answer as printed} or failed {reason}.
- `src/schemas/release.ts` — PHAX_RELEASE is 0.21.0, the opened version. gate-diagnostics, brief-answer, gate-attribution, gate-request, brief-request and brief-record are stamped 0.20.0.
- `src/schemas/phaxConfig.ts` — `brief` is {command} only. A gate step's `output` is "log" (the default) or "diagnostics", and its `input` is an optional "gate-request".
- `src/schemas/persisted.ts` — Read through grep. readBriefAnswer and its gate counterpart read an answer by its own $schema, refuse a newer stamp, an older one or another format by name with the URL phax reads, and rely on the LAST_RELEASE_WITHOUT_BRIEF_ANSWER constant.
- `src/schemas/gateAttribution.ts` — A step result is {command, surface, result: pass|fail}. Unknown keys are ignored.
- `src/app/gates.ts` — Steps run fail-fast. Each attempt rewrites gate-attribution.json for the steps that ran, the first failure included. A failing diagnostics step writes the decoded document as .diagnostics.json.
- `src/domain/gate/fixPrompt.ts` — With findings, each is rendered as `rule at file:line — message` plus `repair guide: …`. Without findings, the raw-log prompt is used. The heading and the Required action lines are reused here.
- `src/domain/brief/render.ts` — The pushed section has a heading, an intro, one compact line per guarantee (BRIEF_PUSH_CAP 50), an overflow line and three instructions; the first instruction names guarantees. The unavailable line is `The brief is unavailable at phase start (<reason>)`. The whole form and the `No brief for …` line come from here too.
- `src/domain/reducer.ts` — Read through grep, with src/app/resumeInstructions.ts and src/app/executePlan.ts. On exhaustion, the phase becomes `gates_exhausted`, the run becomes interrupted with stoppedReason `gates_exhausted` and lastError `Gate failed: <command>`, and resume instructions are written. On resume, a `gates_exhausted` phase re-enters at the gate.
- `src/app/reviewHandoff.ts` — Read through grep, with src/domain/publish/body.ts and src/app/recordsExplain.ts. The handoff ends with `## Phase details`. The PR body is cut from its end at 60000 bytes. `--gates` prints each checks-attempt-NN.log, then its .request.json. `--briefs` prints brief-NN.json as stored.
- `examples/hello-world/` — audit.mjs prints gate-diagnostics, with HW_NO_IO per node: import in the changed .ts files under src/ (all of them on the terminal phase). brief.mjs prints brief-answer with one hw-no-io guarantee. phax.json declares `"output": "diagnostics"` and `"input": "gate-request"`, `brief: {command}`, and agentCommands ["node"]. plan.md plans src/greet.ts, a pure exported `greet`.
- `site/retired-schemas/gate-pending/` — The retired-schema precedent: frozen 0.17.0, 0.18.0 and 0.19.0 copies of a dropped format, still served.
- `NEXT_STEPS.md` — The steme section: guarantee-reports is step 2, after open-next-release (shipped) and before the `decision` class. The entry on the served schemas' `$schema` description is left untouched by this spec.

## 2. Problem

Today's formats make providers do needless work and send facts nobody acts on:
- The two formats state the same facts in unrelated shapes, so a provider keeps two serializers that drift apart.
- A location is one file and one line. Any other file involved survives only in prose.
- A repair is a free string, so nothing tells the agent there is a file to read.
- Nothing identifies a finding across attempts, so neither the agent nor phax can tell what was already reported.
- The brief answer carries met places and accepted debt, which nobody acts on. Its states (`missing`, `forbidden`, `accepted`) are one provider's model leaking into phax.
- A provider that wants a person to look at something can only turn it into a finding the agent is told to fix, or drop it.
- A provider that declines to run can only print an empty document, which reads as a pass, or exit non-zero, which reads as a broken step and spends a fix attempt on something the agent cannot change.

The abandoned replacement fixed these by importing steme's vocabulary into phax's formats: guarantee, leg, place, blueprint, skill and judgement. Every other provider would have had to learn steme's model to answer phax.

## 3. Product goal

A gate step answers with a `gate-report`, and a brief provider answers with a `brief-report`. These are two small formats over three shared definitions (location, guide and finding), in a provider-neutral vocabulary. Each format carries only what someone acts on:
- the gate report gives what fails now and the notes a person should review, or a refusal;
- the brief report gives the rules over the requested paths, and the findings there with their due.

phax routes each fact to whoever acts on it, and judges none of them:
- findings and their guides go to the agent;
- review notes go to the reviewer;
- a refusal and its remedy go to the operator.

`gate-diagnostics` and `brief-answer` are removed with no shim and no leftover name.

> The agent gets only what it can act on; anything else is too much information — and a provider sends only what someone acts on.

## 4. Terminology

- **report step** — A gate step that declares `"output": "gate-report"`.
- **gate report** — The `gate-report` document a report step prints on stdout in answer to the gate request. Its outcome is `checked` (findings and review notes) or `refused` (reason and remedy).
- **brief report** — The `brief-report` document a brief provider prints on stdout in answer to the brief request. It holds the rules over the requested paths and the findings there. It has no outcome key: a provider that declines to run exits non-zero instead.
- **rule** — An expectation of the project in plain words, whose "must" or "must not" lives in the wording, for example `a module under src/ imports no node: module`. A rule has no kind and no id. A finding's `rule` states the expectation it breaks. A brief report's `rules` lists the expectations that apply to the requested paths.
- **location** — `{file, lines}`. `file` is a path relative to the working tree. `lines` is `[start, end]` (1-based, inclusive), or null for the whole file.
- **guide** — `{summary, read}`. `summary` is one line on how to fix or comply. `read` is the path, relative to the working tree, of a file the agent reads and follows. phax never reads, checks, pastes or loads that file. What kind of file it is belongs to the provider.
- **finding** — `{id, rule, location, message, related, guide}`: one case that someone must close. `message` is what was found. `related` lists the other locations involved, each `{file, lines, why}`. `guide` is a guide or null. In a brief report a finding also carries `due`.
- **finding id** — A string the provider chooses, stable across runs of the same check (steme can put its ledger key in it). It is unique within a report, and phax only compares it by equality.
- **due** — In a brief report only, the provider's word on when a finding must be closed: `this-phase`, `later`, or null when the request carried no phase facts. phax never computes or checks it.
- **review note** — `{owner, note}` in a checked gate report: something the provider wants a person to look at. It never fails a step and only ever reaches the reviewer.
- **refusal** — A gate report with outcome `refused`: the provider declined to run, as steme's preflight can. It carries a `reason` and a `remedy` for the operator.
- **readable report** — A report that phax decoded under its own format's current `$schema`, with exactly that format's keys, unique finding ids and ordered lines. Anything else a provider prints is unreadable.
- **broken step** — A report step that printed no readable gate report, or printed a checked one with no finding and exited non-zero. It fails the step, and its fix attempt gets the raw log, as a log step's does.
- **still failing** — The fix prompt's mark on a finding whose id the same step's checked gate report also listed in the phase's previous gate attempt.

## 5. Functional requirements

### 5.1 Each answer has its own format

phax shall read a report step's stdout only as a `gate-report` document, and a brief provider's stdout only as a `brief-report` document, each under its own `$schema` and by the stamp rules of open-next-release.

### 5.2 Another format is refused by name

IF a report step or a brief provider prints a document whose `$schema` names any other format, including `gate-diagnostics`, `brief-answer` and the other new format, THEN phax shall refuse it by name, giving the `$schema` URL of the format it reads, at that format's current stamp.

### 5.3 The step output value

IF a gate step declares an `output` other than `"log"` or `"gate-report"`, including `"diagnostics"`, THEN config validation shall refuse it with exit 2, naming the step and the two allowed values.

### 5.4 Shared location

Both formats shall write a location as `file`, a path relative to the working tree, and `lines`, which is either `[start, end]` in 1-based inclusive line numbers or null for the whole file.

### 5.5 Shared guide

Both formats shall write a guide as `summary`, one line on how to fix or comply, and `read`, the path, relative to the working tree, of a file the agent reads and follows.

### 5.6 Shared finding

Both formats shall write a finding as `id`, `rule`, `location`, `message`, `related` and `guide`. `related` is a possibly empty list of `{file, lines, why}` entries, and `guide` is a guide or null.

### 5.7 Finding ids are unique

IF two findings of one report share an `id` THEN phax shall refuse the report as malformed, naming the id.

### 5.8 Lines are ordered

IF a `lines` pair in a report starts below line 1 or ends before it starts THEN phax shall refuse the report as malformed, naming the file the pair belongs to.

### 5.9 Only named keys travel

IF a report carries, at any level, a key its format does not name, or lacks a key its format names, THEN phax shall refuse it as malformed, naming the key's path.

### 5.10 phax judges nothing in the content

phax shall check only a report's structure: its keys, its value types, the uniqueness of finding ids and the order of lines. It shall never check whether a finding is true, a due is right, or a named file exists.

### 5.11 Two gate outcomes

A gate report shall have exactly one of two outcomes: `checked`, carrying `findings` and `review` (a possibly empty list of `{owner, note}` review notes), or `refused`, carrying `reason` and `remedy`.

### 5.12 What a brief report carries

A brief report shall carry no outcome key. It shall carry only `rules`, each `{rule, files, guide}` with at least one file, and `findings`, each a finding plus `due`: `this-phase`, `later`, or null when the request carried no phase facts.

### 5.13 A finding fails the step

WHEN a report step prints a checked gate report that lists at least one finding THE system SHALL fail the step, whatever its exit code.

### 5.14 An empty list passes

WHEN a report step exits 0 and prints a checked gate report with no finding THE system SHALL pass the step, whatever review notes the report carries.

### 5.15 An empty list with a non-zero exit is broken

IF a report step prints a checked gate report with no finding and exits non-zero THEN phax shall fail the step as a broken step.

### 5.16 An unreadable report is broken

IF a report step prints no readable gate report THEN phax shall fail the step as a broken step.

### 5.17 A broken step's fix attempt gets the raw log

WHEN a broken step fails the gate THE system SHALL give the fix attempt the raw-log prompt, as it does for a failed log step.

### 5.18 Report steps stay fail-fast

phax shall run a gate profile's steps fail-fast, report steps included, so that no step runs after a step that failed or refused.

### 5.19 A refusal stops the phase without a fix attempt

WHEN a report step prints a refused gate report THE system SHALL stop the phase with a gate failure, without making or counting a fix attempt.

### 5.20 A refusal exits 4 and names its remedy

WHEN a refusal stops the phase THE system SHALL exit 4, naming the step, the reason and the remedy.

### 5.21 A refusal reuses the gate-failure pause

WHEN a refusal stops the phase THE system SHALL pause it in the phase state and with the stop reason used when gate attempts run out, with its last error and resume instructions saying that the step refused and giving the remedy.

### 5.22 Resume runs the gate again

WHEN `phax resume` runs on a phase stopped by a refusal THE system SHALL run the gate again before any fix attempt, with the phase's full fix-attempt budget.

### 5.23 A refusal is attributed as such

phax shall record a step that printed a refused gate report with the gate-attribution result `refused`, alongside `pass` and `fail`.

### 5.24 The fix prompt shows each finding

WHEN a step fails on a checked gate report THE fix prompt SHALL show each of the report's findings in the report's order, with its rule, its location, its message, each related location with its why, and its guide.

### 5.25 A guide is a file to read and follow

The fix prompt shall show a guide as its summary and an instruction to read the file at `read` and follow it, without phax reading, checking or pasting that file.

### 5.26 The fix prompt shows nothing else

The fix prompt shall show nothing else from a gate report: no finding id, no review note, and nothing from earlier attempts but the `still failing` mark.

### 5.27 Still failing, by id

WHEN the same step's checked gate report in the phase's previous gate attempt listed a finding with the same `id` THE fix prompt SHALL mark that finding `still failing`.

### 5.28 A report grants nothing

phax shall grant the agent no command because a report or a guide names it, so that a tool a guide calls for runs only if `security.agentCommands` or the gate commands allow it.

### 5.29 brief.push is required and explicit

IF a `brief` block declares no `push`, or a value other than `"findings"` or `"findings-and-rules"`, THEN config validation shall refuse it with exit 2, naming `brief.push` and the two allowed values.

### 5.30 Pushing findings

WHERE `brief.push` is `"findings"` THE pushed brief SHALL list only the brief report's findings due `this-phase`, in the provider's order, one compact line each giving the location, rule, message and guide.

### 5.31 Pushing findings and rules

WHERE `brief.push` is `"findings-and-rules"` THE pushed brief SHALL list the findings due `this-phase` as `"findings"` does, followed by each rule in the provider's order, one compact line each giving its files and guide.

### 5.32 The pushed brief stops at 50 lines

The pushed brief shall list at most 50 item lines, findings first, followed, when items remain, by one line saying how many were not shown and that `phax brief` prints them.

### 5.33 Nothing to push

WHEN the pushed brief has no item to list THE pushed brief SHALL say so in one line.

### 5.34 `phax brief` prints the whole report

WHEN `phax brief` gets a readable brief report THE system SHALL print each rule with its files and guide, then each finding with its location, rule, message, related locations, due and guide, and exit 0.

### 5.35 A declining or unreadable brief is a failed brief

IF a brief provider exits non-zero or prints no readable brief report THEN phax shall treat the brief as it treats any failed brief: the pushed brief's unavailable line and `phax brief` give the reason, `phax brief` exits 1, and the phase continues.

### 5.36 Review notes reach the reviewer

WHEN phax generates the review handoff THE system SHALL gather the review notes of every report step in each phase's last gate attempt into one `## Review notes` section, grouped by owner.

### 5.37 A shared note is listed once

The `## Review notes` section shall list once a note that several phases reported with the same owner and text, naming those phases.

### 5.38 Where the section sits

The `## Review notes` section shall appear only when at least one note was gathered, and before `## Phase details`, so that a truncated PR body keeps it.

### 5.39 No review note reaches the agent

No prompt phax sends an agent and no brief phax prints shall carry a review note.

### 5.40 Gate reports are saved as printed

WHEN a report step prints a readable gate report THE system SHALL save it beside the attempt's log, byte for byte as printed, whatever the step's verdict.

### 5.41 Brief reports are recorded as printed

WHEN a brief provider prints a readable brief report THE system SHALL keep it in that call's brief record as printed, with every key and its order kept, never re-shaped or re-stamped.

### 5.42 `records explain --gates` prints the reports

WHEN `phax records explain --gates` runs THE system SHALL print, for each attempt, its log, its gate request and then each gate report saved for that attempt, all as stored.

### 5.43 The schemas package

@lbdremy/phax-schemas shall read `gate-report` and `brief-report` with identical location, guide and finding definitions, and shall have no `gate-diagnostics` or `brief-answer` format: no format id, parser, type, frozen module, snapshot or JSON Schema.

### 5.44 Served URLs stay up

The docs site shall keep serving every `gate-diagnostics` and `brief-answer` schema URL it served before this change, byte for byte and listed in its index, and shall serve neither format for any later release.

### 5.45 A provider-neutral vocabulary

None of the following shall name guarantee, leg, obligation, prohibition, place, instance, blueprint, skill, judgement, debt or baseline: the two formats' keys, values and JSON Schema descriptions; the fix prompt, pushed brief and `phax brief` output that phax renders from them; and the README's description of them.

### 5.46 The hello-world example

The hello-world `audit.mjs` shall print a gate report, and `brief.mjs` a brief report, over the two rules `a module under src/ exports its function` and `a module under src/ imports no node: module`, with at least one guide file shipped in the example.

### 5.47 The README describes the reports

The README shall describe the gate report under "Gate report steps" (replacing "Diagnostics gate steps"), and the report step, the brief report and `brief.push` under "Gate request" and "Brief provider". It shall list both formats under "Persisted formats" and shall name neither `gate-diagnostics` nor `brief-answer`.

## 6. Surface

### api: gate report (checked), printed by a report step on stdout — normative

before:

    gate-diagnostics, printed by a step with "output": "diagnostics":

    {
      "$schema": "https://docs.phax.run/schemas/gate-diagnostics/0.20.0.json",
      "diagnostics": [
        { "rule": "HW_NO_IO", "class": "invariant", "location": { "file": "src/greet.ts", "line": 1 },
          "message": "greet must not perform I/O", "repair": "plan.md#phase-01-greet-function" }
      ]
    }

after:

    Normative: every key, its nesting, and the outcome value. The content is made up. Every key shown is required. `lines` and `guide` may be null, and `findings`, `related` and `review` may be empty. A key not shown is refused, at any level.

    {
      "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json",
      "outcome": "checked",
      "findings": [
        {
          "id": "no-node-import src/greet.ts node:fs",
          "rule": "a module under src/ imports no node: module",
          "location": { "file": "src/greet.ts", "lines": [1, 1] },
          "message": "imports node:fs",
          "related": [
            { "file": "src/cli.ts", "lines": [3, 5], "why": "the caller, where the read belongs" }
          ],
          "guide": { "summary": "keep I/O in the module's caller", "read": "guides/no-node-import.md" }
        },
        {
          "id": "exports-function src/farewell.ts",
          "rule": "a module under src/ exports its function",
          "location": { "file": "src/farewell.ts", "lines": null },
          "message": "no exported function",
          "related": [],
          "guide": null
        }
      ],
      "review": [
        { "owner": "hw-maintainers", "note": "whether 'Hello, <name>!' is the greeting the product wants" }
      ]
    }

    This report fails the step on its two findings, whatever the exit code. The review note fails nothing and never reaches the agent.

    A passing report is { "$schema": …, "outcome": "checked", "findings": [], "review": [] } on exit 0, with or without review notes.

    `id` belongs to the provider, stays stable across runs of the same check, and is compared by equality only. `lines` is [start, end], 1-based and inclusive, or null for the whole file. `read` is a file, relative to the working tree, that the agent reads. phax never opens it. A report carries no due, kind, severity, state or command.

### api: refused gate report — normative

before:

    None. A provider that declines to run can print an empty document, which reads as a pass, or exit non-zero, which reads as a broken step and spends a fix attempt.

after:

    {
      "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json",
      "outcome": "refused",
      "reason": "the checks need hw-rules 2, and 1 is installed",
      "remedy": "pnpm add -D hw-rules@2"
    }

    A refused report carries exactly these keys, and its exit code does not matter. A brief report has no refused form: a brief provider that declines to run exits non-zero, with its reason on stderr.

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

    Normative: every key, its nesting, and the due values. Location, guide and finding are the same as in the gate report. A finding adds `due`: "this-phase" | "later" | null (null when the request carried no phase facts). `files` is non-empty. There is no outcome key and no review note.

    {
      "$schema": "https://docs.phax.run/schemas/brief-report/0.21.0.json",
      "rules": [
        { "rule": "a module under src/ exports its function",
          "files": ["src/greet.ts", "src/farewell.ts"], "guide": null },
        { "rule": "a module under src/ imports no node: module",
          "files": ["src/greet.ts", "src/farewell.ts"],
          "guide": { "summary": "keep I/O in the module's caller", "read": "guides/no-node-import.md" } }
      ],
      "findings": [
        {
          "id": "no-node-import src/greet.ts node:fs",
          "rule": "a module under src/ imports no node: module",
          "location": { "file": "src/greet.ts", "lines": [1, 1] },
          "message": "imports node:fs",
          "related": [],
          "guide": { "summary": "keep I/O in the module's caller", "read": "guides/no-node-import.md" },
          "due": "this-phase"
        },
        {
          "id": "exports-function src/farewell.ts",
          "rule": "a module under src/ exports its function",
          "location": { "file": "src/farewell.ts", "lines": null },
          "message": "no exported function",
          "related": [],
          "guide": null,
          "due": "later"
        }
      ]
    }

    `rules` says what a file at the requested paths must and must not do, even a file not written yet. A report with nothing to report is { "$schema": …, "rules": [], "findings": [] }. The order of each list is the provider's rank.

### config: gate step output in phax.json — normative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "diagnostics", "input": "gate-request" }

    output: "log" (default) | "diagnostics"

after:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "gate-report", "input": "gate-request" }

    output: "log" (default) | "gate-report". `input` is unchanged, and a report step does not have to declare it.

    "output": "diagnostics" →
    ✗ gate step "node ./audit.mjs": output must be "log" or "gate-report"
    $? = 2   (the exit code, the step and the allowed values are normative; the wording is indicative)

### config: brief.push in phax.json — normative

before:

    { "brief": { "command": "node ./brief.mjs" } }

after:

    { "brief": { "command": "node ./brief.mjs", "push": "findings" } }

    push: "findings" | "findings-and-rules". It is required, with no default, in every layer that declares `brief` (phax.json, phax.local.json, ~/.phax/config.json).
      "findings"            the pushed brief lists the findings due in this phase
      "findings-and-rules"  it also lists the rules over the phase's planned files, with their files and guides

    A missing `push` or another value →
    ✗ phax.json: brief.push must be "findings" or "findings-and-rules"
    $? = 2   (the key, the values and the exit code are normative; the wording is indicative)

### internal: fix prompt after a report step fails — indicative

before:

    ## Diagnostics

    - HW_NO_IO at src/greet.ts:1 — greet must not perform I/O
      repair guide: plan.md#phase-01-greet-function

    Full output: …/checks-attempt-01.log

after:

    # Gate checks failed — fix required

    Gate run (attempt 2) failed.

    **Failed step:** `node ./audit.mjs` (2 findings)

    ## Findings

    - src/greet.ts:1 · still failing
      rule: a module under src/ imports no node: module
      found: imports node:fs
      also involves src/cli.ts:3-5 — the caller, where the read belongs
      guide: keep I/O in the module's caller. Read guides/no-node-import.md and follow it.
    - src/farewell.ts
      rule: a module under src/ exports its function
      found: no exported function

    Full output: …/checks-attempt-02.log

    ## Required action

    Read the file each guide names before changing code, then fix every finding under **Findings**.
    (the remaining Required action lines, as today)

    Normative: the `still failing` mark, and each finding's rule, location, message, related locations with their why, and guide with its `read` path. The layout and wording are indicative. A location renders as file, file:N or file:N-M. A finding whose guide is null gets no guide line. The prompt never shows a finding id, a review note, a refusal, or a count from earlier attempts. A broken step's fix prompt is today's raw-log prompt.

### internal: pushed brief in the phase's first prompt — indicative

before:

    ## Brief for this phase

    What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.

    - hw-no-io — nothing under src/ imports a node: module · forbidden src/greet.ts:1 (this phase)

    (three instructions)

after:

    With "push": "findings":

    ## Brief for this phase

    What fails in this phase's planned files and is due in this phase, in the provider's order. It informs; the gate decides.

    - src/greet.ts:1 — a module under src/ imports no node: module — imports node:fs · guide: keep I/O in the module's caller (read guides/no-node-import.md)

    (the three instructions. The first now reads: run `phax brief <path> [<path>…]` to see the rules over it, what fails there and how to fix it.)

    With "push": "findings-and-rules", the rules follow the findings:

    - rule: a module under src/ exports its function — src/greet.ts, src/farewell.ts
    - rule: a module under src/ imports no node: module — src/greet.ts, src/farewell.ts · guide: keep I/O in the module's caller (read guides/no-node-import.md)

    Nothing to list: `Nothing in this phase's planned files is due in this phase.` ("findings") or `The brief lists nothing for this phase's planned files.` ("findings-and-rules").
    More than 50 item lines: `- …and 12 more not shown. `phax brief` prints the phase's brief whole.`
    A failed brief: today's unavailable line, giving the provider's stderr or the reason for the refusal.

    Normative: one line per item; findings due this-phase first, then rules (with findings-and-rules only); at most 50 item lines; one line when nothing is listed. The wording is indicative.

### cli: phax brief [path…] — indicative

before:

    hw-no-io — nothing under src/ imports a node: module
      forbidden  src/greet.ts:1   due this phase
        what:    imports node:fs
        repair:  remove the import; greet is pure
      met        src/cli.ts

after:

    $ phax brief src/greet.ts src/farewell.ts
    Rules
      a module under src/ exports its function
        files:  src/greet.ts, src/farewell.ts
      a module under src/ imports no node: module
        files:  src/greet.ts, src/farewell.ts
        guide:  keep I/O in the module's caller (read guides/no-node-import.md)
    Findings
      src/greet.ts:1   due this phase
        rule:   a module under src/ imports no node: module
        found:  imports node:fs
        guide:  keep I/O in the module's caller (read guides/no-node-import.md)
      src/farewell.ts   due later
        rule:   a module under src/ exports its function
        found:  no exported function
    $? = 0

    Related locations print under their finding as `also involves <file:lines> — <why>`. A null due prints nothing. An empty report prints today's `No brief for …` line and exits 0.

    A provider that declines to run exits non-zero:
    ✗ brief failed: the provider exited 2: the checks need hw-rules 2, and 1 is installed
    $? = 1

    The exit codes are normative and unchanged. The layout is indicative.

### cli: run output on a refusal and on an old-format answer — indicative

before:

    ✗ Gate command failed: node ./audit.mjs (0 diagnostic(s))   — followed by a fix attempt on the raw log

after:

    ✗ phase-01 gate: `node ./audit.mjs` refused to run: the checks need hw-rules 2, and 1 is installed
      remedy: pnpm add -D hw-rules@2
      No fix attempt was made. Fix the cause, then: phax resume hello-world.greet
    $? = 4   (the exit code is normative, and the step, reason and remedy must appear; the wording is indicative)

    lastError in run-status.json: Gate step refused: node ./audit.mjs — the checks need hw-rules 2, and 1 is installed
    resume-instructions.md names the step, the reason and the remedy, then `phax resume hello-world.greet`. The phase state is `gates_exhausted` and the stopped reason is `gates_exhausted`, as on exhaustion.

    ✗ Gate step "node ./audit.mjs": gate-diagnostics is not read by this phax — it reads https://docs.phax.run/schemas/gate-report/0.21.0.json

### file: review-handoff.md and the PR body — Review notes — normative

before:

    (no section: nothing from a gate step reaches the review)

after:

    ## Review notes

    Notes the gate steps left for a person. None was sent to the agent.

    ### hw-maintainers

    - whether 'Hello, <name>!' is the greeting the product wants (phase-01, phase-03)

    ### docs-team

    - the README example still greets 'World' (phase-02)

    …

    ## Phase details

    Normative:
    - the heading `## Review notes`;
    - one group per owner;
    - a note with the same owner and text listed once, naming every phase that reported it;
    - placement before `## Phase details`;
    - no section when no note was gathered;
    - notes taken from each phase's last gate attempt only.

    The intro wording and the entry layout are indicative. The PR body carries the section because it carries the handoff.

### file: a phase folder's gate attempt and brief files — indicative

before:

    checks-attempt-01.log
    checks-attempt-01.request.json
    checks-attempt-01.diagnostics.json   (failing diagnostics step only; the decoded findings, re-stamped by phax)
    brief-00.json, brief-01.json         (outcome.answer: the brief-answer as printed)

after:

    checks-attempt-01.log               (unchanged; it still holds each step's stdout)
    checks-attempt-01.request.json
    checks-attempt-01.report-04.json    (the gate report printed by the profile's 4th step, byte for byte: one file per report step that printed a readable report, whether it passed, failed or refused)
    brief-00.json, brief-01.json        (brief-record keys unchanged; outcome.answer: the brief report as printed)

    No .diagnostics.json is written. Saving each readable report as printed is normative. The file name is indicative.

### file: gate-attribution step result — normative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "result": "fail" }   result: "pass" | "fail"

after:

    { "command": "node ./audit.mjs", "surface": "structural", "result": "refused" }   result: "pass" | "fail" | "refused"

    The format's stamp moves to the opened version: https://docs.phax.run/schemas/gate-attribution/0.21.0.json. A broken step is `fail`.

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
    { "$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json", "outcome": "checked", … }

    `--briefs` prints brief-NN.json as stored, as today. Records written before this change get no special handling.

### package: @lbdremy/phax-schemas formats — normative

before:

    gate-diagnostics  parseGateDiagnostics, json/gate-diagnostics.schema.json, frozen history modules
    brief-answer      parseBriefAnswer, json/brief-answer.schema.json

after:

    gate-report   parseGateReport, json/gate-report.schema.json
    brief-report  parseBriefReport, json/brief-report.schema.json

    Both JSON Schemas define location, guide and finding identically; the brief report's finding only adds `due`. Every object in both schemas refuses keys it does not name (additionalProperties: false).

    gate-diagnostics and brief-answer are gone: no format id, parser, type, frozen module, history.lock entry, snapshot or JSON Schema.

    docs.phax.run keeps serving /schemas/gate-diagnostics/<R>.json and /schemas/brief-answer/<R>.json for every R it serves today, byte for byte and listed in /schemas/index.json, from frozen copies under site/retired-schemas/gate-diagnostics/ and site/retired-schemas/brief-answer/. It serves neither format for any later release.

### file: README §Persisted formats rows — normative

before:

    | Gate diagnostics | `gate-diagnostics` | `<record>/checks-attempt-NN.diagnostics.json` | `parseGateDiagnostics` | `json/gate-diagnostics.schema.json` |
    | Brief answer | `brief-answer` | the brief provider's stdout, `outcome.answer` in a brief record | `parseBriefAnswer` | `json/brief-answer.schema.json` |

after:

    | Gate report  | `gate-report`  | a report step's stdout, `<record>/checks-attempt-NN.report-SS.json` | `parseGateReport`  | `json/gate-report.schema.json`  |
    | Brief report | `brief-report` | the brief provider's stdout, `outcome.answer` in a brief record     | `parseBriefReport` | `json/brief-report.schema.json` |

    "Diagnostics gate steps" becomes "Gate report steps". "Gate request" and "Brief provider" describe the report step, the brief report and `brief.push`. No README text names gate-diagnostics or brief-answer.

### file: examples/hello-world/ — indicative

before:

    audit.mjs   prints gate-diagnostics (HW_NO_IO, invariant)
    brief.mjs   prints brief-answer (hw-no-io)
    phax.json   step "output": "diagnostics"; brief { "command": "node ./brief.mjs" }

after:

    audit.mjs                 prints a gate report over the changed .ts files under src/ (all of them on the terminal phase): one finding per file and imported node: module (rule "a module under src/ imports no node: module", guide guides/no-node-import.md), and one per file that exports no function (rule "a module under src/ exports its function", guide null); review []
    brief.mjs                 prints a brief report for the briefed .ts files under src/, existing or not: both rules over them, and the same findings with their due
    guides/no-node-import.md  the guide file both scripts name
    phax.json                 step "output": "gate-report", "input": "gate-request"; brief { "command": "node ./brief.mjs", "push": "findings-and-rules" }

    Finding ids are stable across runs (for example "no-node-import src/greet.ts node:fs"), and a file that imports one module twice yields one finding. Both scripts print their format's current stamp, which the example-stamp test holds.

## 7. Non-goals

- A `decision` class that stops the phase for an owner. It gets its own spec, joining `phase-decision-requests`. A review note here never stops anything.
- Escalating or stopping on a finding that keeps coming back. This spec only marks it `still failing`.
- Marking findings as fixed or new, counting them, or showing anything else from earlier attempts.
- The architecture brief at plan authoring.
- Posting steme's check run to the pull request.
- steme's own conformity fixes, and its mapping of its model into these formats.
- The plan auditor's answer.
- Severity or rank beyond the provider's order.
- Columns in a location, or any location unit other than whole lines.
- Any change to the gate request or the brief request.
- Any shim: no alias for `"output": "diagnostics"`, no reading of a `gate-diagnostics` or `brief-answer` answer, no upgrade note, no default for `brief.push`, and no special handling of past runs' `.diagnostics.json` or `brief-NN.json`.
- Accepted debt, or met or unexamined expectations, in either format. Accepted debt is the provider's own input, and the PR diff shows changes to it.
- phax reading, checking, pasting or loading a guide's file, or knowing what kind of file it is.
- A refused outcome for the brief report.
- A new phase state or stop reason for a refusal.
- A `brief.push` value that pushes nothing.
- Rewording the served schemas' `$schema` description (the NEXT_STEPS entry).

## 8. Acceptance criteria

### The hello-world providers answer both formats

Given the hello-world example in a worktree where `src/greet.ts` exports `greet` and imports `node:fs` on line 1, a saved gate request whose phase changed `src/greet.ts`, and a brief request `{"files": ["src/greet.ts", "src/farewell.ts"]}` with no phase facts, when `audit.mjs` and `brief.mjs` run on them, then audit.mjs prints a `gate-report` document that `parseGateReport` reads. Its outcome is `checked`, it has one finding for `src/greet.ts` with rule `a module under src/ imports no node: module`, lines `[1, 1]` and guide read `guides/no-node-import.md`, and its `review` is empty. brief.mjs prints a `brief-report` document that `parseBriefReport` reads. Its `rules` hold both rules, each with the files `src/greet.ts` and `src/farewell.ts`, and its `findings` hold the same `src/greet.ts` finding with `due` null. `guides/no-node-import.md` exists in the example. (refs §5.1, §5.46, §5.4, §5.5, §5.6, §5.12)

### Another format is refused by name

Given two report steps, one printing a `gate-diagnostics/0.20.0` document and one printing a `brief-report/0.21.0` document, and two brief providers, one printing a `brief-answer/0.20.0` document and one printing a `gate-report/0.21.0` document, when each gate step runs and each phase's brief is pushed, then both steps fail as broken steps, and each failure names `https://docs.phax.run/schemas/gate-report/0.21.0.json`. Both briefs are unavailable, each with a reason that names `https://docs.phax.run/schemas/brief-report/0.21.0.json`, and both phases continue. (refs §5.2, §5.16, §5.35)

### Only `log` and `gate-report` are outputs

Given one phax.json gate step with `"output": "diagnostics"`, and another with `"output": "gate-report"` and no `input`, when `phax run` loads each config, then the first exits 2, naming the step and the allowed values `"log"` and `"gate-report"`. The second loads. (refs §5.3)

### Duplicate ids and disordered lines make a report malformed

Given three gate reports, each otherwise like the §6 checked example: one whose two findings share the id `no-node-import src/greet.ts node:fs`, one whose first location has `"lines": [3, 1]`, and one whose related entry has `"lines": [0, 2]`; and a brief report whose two findings share one id, when the gate reads each gate report, and the phase's brief is pushed with the brief report, then each gate report fails its step as a broken step: the first names the shared id, the second names `src/greet.ts`, and the third names `src/cli.ts`. The brief is unavailable, naming the shared id. (refs §5.7, §5.8, §5.16, §5.35)

### Keys outside the format are refused

Given three gate reports, each otherwise like the §6 checked example: one whose first finding also carries `"due": "this-phase"`, one with an extra top-level `"debt": []`, and one whose first guide also carries `"kind": "skill"`; and a §6 brief report with an extra top-level `"review": []`, when the gate reads each gate report, and the phase's brief is pushed with the brief report, then each step fails as a broken step, naming `findings[0].due`, `debt` and `findings[0].guide.kind` respectively. The brief is unavailable, naming `review`. (refs §5.9, §5.12, §5.35)

### Two gate outcomes, and no outcome in the brief

Given five gate reports: one with `"outcome": "skipped"`, a refused report with no `remedy`, a refused report that also carries `"findings": []`, and a checked report with no `review` key; and a brief report that carries `"outcome": "checked"`, when the gate reads each gate report, and the phase's brief is pushed with the brief report, then every gate report fails its step as a broken step, and the brief is unavailable. (refs §5.11, §5.12, §5.9)

### phax judges nothing in the content

Given a checked gate report like the §6 example whose first location file is `src/nowhere.ts` and whose guide reads `guides/missing.md`, neither of which exists; and, outside a phase, a brief provider whose only finding carries `"due": "this-phase"`, when the gate reads the report, and `phax brief src/nowhere.ts` runs in the user's checkout, then the step fails on the report's findings, not as a broken step, and the fix prompt names `src/nowhere.ts` and `guides/missing.md`. `phax brief` prints the finding as due this phase and exits 0. (refs §5.10)

### A finding fails the step, whatever the exit code

Given a report step that prints the §6 checked gate report, once with exit 0 and once with exit 1, when the gate runs, then the step fails both times, and both fix prompts list the report's two findings. (refs §5.13, §5.24)

### An empty list passes, and is saved

Given a report step that exits 0 and prints the §6 checked gate report with `findings` emptied and its review note kept, when attempt 1 runs, then the step passes, and the phase folder holds the report beside `checks-attempt-01.log`, byte-identical to what the step printed. (refs §5.14, §5.40)

### An empty list with a non-zero exit is broken

Given a report step that prints `{"$schema": "https://docs.phax.run/schemas/gate-report/0.21.0.json", "outcome": "checked", "findings": [], "review": []}` and exits 1, when the gate runs, then the step fails as a broken step, and the fix prompt is the raw-log prompt with the step's log. gate-attribution records `fail`, and the report is saved beside the attempt's log. (refs §5.15, §5.17, §5.40)

### No readable report is broken

Given a report step that prints nothing and exits 0, and another that prints `not json`, when the gate runs each, then each fails as a broken step with the raw-log fix prompt and spends one fix attempt, and no report file is saved for that attempt. (refs §5.16, §5.17)

### No step runs after a failure or a refusal

Given a profile whose first step is a report step and whose second is `pnpm test`, where the first step prints the §6 checked report on one run and the §6 refused report on another, when the gate runs, then `pnpm test` runs on neither run, and the attempt log holds no `$ pnpm test` line. (refs §5.18)

### A refusal stops the phase without a fix attempt

Given a run with `agent.maxFixAttempts` 3 whose report step prints the §6 refused gate report, when the phase's gate runs, then no fix prompt is sent. The run exits 4, printing `node ./audit.mjs`, `the checks need hw-rules 2, and 1 is installed` and `pnpm add -D hw-rules@2`. The phase's gate-attribution.json records the step with the result `refused`. (refs §5.19, §5.20, §5.23)

### A refusal pauses like exhaustion, and resume runs the gate

Given the run stopped by that refusal, and a report step that no longer refuses but fails on a finding, when the run's status is read, and then `phax resume` runs, then the phase is `gates_exhausted` with the stopped reason `gates_exhausted`, and both lastError and resume-instructions.md name the refusal, with resume-instructions.md also giving `pnpm add -D hw-rules@2`. On resume, the gate runs before any agent turn, and up to 3 fix attempts follow its failure. (refs §5.21, §5.22)

### The fix prompt shows each finding and nothing else

Given the §6 checked gate report failing its step on attempt 1, with `guides/no-node-import.md` present in the worktree, when the fix prompt is built, then it shows, in this order:
- `src/greet.ts:1` with its rule, `imports node:fs`, `src/cli.ts:3-5` with `the caller, where the read belongs`, `keep I/O in the module's caller`, and an instruction to read `guides/no-node-import.md` and follow it;
- `src/farewell.ts` with its rule and `no exported function`, and no guide line.

The prompt contains no finding id, no text from the review note, no line of `guides/no-node-import.md` and no `still failing` mark. The phase's first prompt carried no review note either. (refs §5.24, §5.25, §5.26, §5.39)

### Still failing, by id alone

Given attempt 1, where the report step failed listing the ids `no-node-import src/greet.ts node:fs` (at line 1) and `exports-function src/greet.ts`; and attempt 2, where the same step fails listing `no-node-import src/greet.ts node:fs`, now at line 4, and `exports-function src/farewell.ts`, when the fix prompt after attempt 2 is built, then the `src/greet.ts:4` finding is marked `still failing`, and the `src/farewell.ts` finding is not. `exports-function src/greet.ts` appears nowhere, and no fixed or new count is shown. When attempt 1 instead failed on a `pnpm test` step that ran before the report step, no finding is marked. (refs §5.27, §5.26)

### A report grants nothing

Given a secure-mode run with `"security": {"agentCommands": ["node"]}`, and a failing report whose guide file tells the agent to run `hw-rules fix src/greet.ts`, when the fix attempt runs, then the phase's security.json lists exactly what it would list without the report, with no `hw-rules` entry. Once `hw-rules` is added to `security.agentCommands`, it is listed with the source `config`. (refs §5.28)

### `brief.push` is required and explicit

Given three phax.json files: one whose `brief` is `{"command": "node ./brief.mjs"}`, one whose `brief.push` is `"rules"`, and one with `"push": "findings"`, when `phax run` loads each config, then the first two exit 2, naming `brief.push` and the values `"findings"` and `"findings-and-rules"`. The third loads. (refs §5.29)

### Pushing findings lists only what is due this phase

Given `"push": "findings"` and a brief provider that answers the §6 brief report to the phase's request, when the phase starts fresh, then `## Brief for this phase` lists one item line: `src/greet.ts:1` with its rule, `imports node:fs`, `keep I/O in the module's caller` and `guides/no-node-import.md`. No line names `src/farewell.ts`, and no line is a rule. (refs §5.30)

### Pushing findings and rules

Given `"push": "findings-and-rules"` and the same provider, when the phase starts fresh, then the section lists the `src/greet.ts:1` finding line, then one line per rule in the report's order, each with its files and the second with `guides/no-node-import.md`. No line gives the `src/farewell.ts` finding's message. (refs §5.31)

### The pushed brief stops at 50 lines

Given `"push": "findings-and-rules"` and a brief report with 45 findings due `this-phase`, 5 due `later`, and 10 rules, when the phase starts fresh, then the section lists the 45 due findings in the provider's order, then the first 5 rules, then one line saying 5 more are not shown and pointing to `phax brief`. (refs §5.32)

### Nothing to push

Given two setups: `"push": "findings"` with a brief report whose only finding is due `later`, and `"push": "findings-and-rules"` with a brief report that has no rules and no findings, when the phase starts fresh, then in each setup, the section's body is one line saying nothing is listed, followed by the three instructions. (refs §5.33)

### `phax brief` prints the whole report

Given a provider inside the phase that answers the §6 brief report, when `phax brief src/greet.ts src/farewell.ts` runs, then it exits 0. It prints both rules with their files, the second with `guides/no-node-import.md`. It then prints the `src/greet.ts:1` finding, due this phase, with its rule, message and guide, and the `src/farewell.ts` finding, due later, with its rule and message. (refs §5.34)

### A declining brief provider is a failed brief

Given a brief provider that writes `the checks need hw-rules 2, and 1 is installed` to stderr and exits 2, when a phase starts fresh, and then the agent runs `phax brief src/greet.ts`, then the first prompt's unavailable line gives the provider's stderr, `phax brief` prints it and exits 1, and the phase continues. (refs §5.35)

### Brief reports are recorded as printed

Given a brief provider that prints the §6 brief report with its keys in a different order, when a phase starts fresh, and then the agent runs `phax brief src/farewell.ts`, then the answered outcomes of `brief-00.json` and `brief-01.json` each hold the report as printed: the same keys in the same order, never re-stamped. (refs §5.41)

### Review notes reach the review, grouped by owner

Given a run in which the last gate attempts of phase-01 and phase-03 both report the note `whether 'Hello, <name>!' is the greeting the product wants` owned by `hw-maintainers`, and the last attempt of phase-02 reports a note owned by `docs-team`, when the review handoff is generated and `phax publish-pr` builds the PR body, then both contain one `## Review notes` section before `## Phase details`. It has a `hw-maintainers` group listing the note once, naming phase-01 and phase-03, and a `docs-team` group. A run with no review note has no such section. (refs §5.36, §5.37, §5.38)

### Only the last gate attempt counts

Given a phase whose attempt 1 report carried a review note, and whose last attempt's reports carry none, when the review handoff is generated, then the note does not appear in it. (refs §5.36)

### Every readable gate report is saved as printed

Given a profile whose 4th step is a report step that prints the §6 checked report, pretty-printed with a trailing newline, in attempt 1, and the §6 refused report in attempt 2, when both attempts run, then the phase folder holds the reports of attempts 1 and 2 beside their logs, each byte-identical to what the step printed, and holds no `.diagnostics.json`. (refs §5.40)

### `records explain --gates` prints the reports

Given the phase record of a run made after this change, with two attempts that each saved a report, when `phax records explain <commit> --gates` runs, then for each attempt it prints the log, the request and then the saved report, all as stored. (refs §5.42)

### The package reads the new formats only

Given the schemas package built after the change, when its formats, exports, snapshots and history.lock.json are inspected, then it exports `parseGateReport`, `parseBriefReport`, `json/gate-report.schema.json` and `json/brief-report.schema.json`. The location, guide and finding definitions of the two JSON Schemas are identical, except for the brief finding's `due`. No `gate-diagnostics` or `brief-answer` format id, parser, type, frozen module, lock entry, snapshot or JSON Schema remains. (refs §5.43, §5.4, §5.5, §5.6)

### Served URLs stay up

Given the `/schemas/index.json` that docs.phax.run serves before the change, when the site is built for the release that ships this change, and the deploy guard runs, then every `gate-diagnostics` and `brief-answer` path in that index is in the build with identical bytes and is still listed, and neither format has a path for the new release. (refs §5.44)

### The formats speak a provider-neutral vocabulary

Given the built `gate-report` and `brief-report` JSON Schemas; the fix prompt, pushed brief and `phax brief` output rendered from the §6 examples; and the README's Gate report steps, Gate request and Brief provider sections, when they are searched, case-insensitively and including plural forms, for guarantee, leg, obligation, prohibition, place, instance, blueprint, skill, judgement, debt and baseline as whole words, then no match is found. (refs §5.45)

### The README describes the reports

Given the README after the change, when §Extend phax and §Persisted formats are read, then "Gate report steps" describes the gate report with the §6 checked and refused examples, `"output": "gate-report"`, the verdict rules and the refusal. "Brief provider" describes the brief report, `brief.push` and both of its values. §Persisted formats lists the `gate-report` and `brief-report` rows. Neither `gate-diagnostics` nor `brief-answer` appears anywhere in the README. (refs §5.47)

## 9. Open questions for implementation planning

None.

## 10. Implementation-planning note

Settled:

- This is green field. The following go with no shim and no leftover name: `gate-diagnostics`, `brief-answer`, `"output": "diagnostics"`, the `.diagnostics.json` write, both answer readers with their LAST_* release constants, the diagnostics expected-shape hint, the diagnostics carried by the gate-failed event, and the frozen gate-diagnostics history modules with their history.lock entries.
- `gate-report` and `brief-report` are born at the opened version, 0.21.0. Each is read only under its own `$schema`, by open-next-release's stamp rules.
- Keys: the gate report is `{$schema, outcome: "checked", findings, review}` or `{$schema, outcome: "refused", reason, remedy}`. The brief report is `{$schema, rules: [{rule, files, guide}], findings: [finding + due]}`. A finding is `{id, rule, location: {file, lines}, message, related: [{file, lines, why}], guide: {summary, read} | null}`. All strings are non-empty.
- gate-attribution gains `refused`, so its stamp moves to 0.21.0. The brief-record keeps its keys, and its answered outcome holds the brief report as printed.
- The gate request and the brief request keep their shapes and stamps. These are unchanged from brief-provider: the pushed and pulled moments, the 60 s limit, brief recording, `phax brief`'s exit codes, the phase guard, the `phax brief` grant, and one pushed brief per phase.
- `brief.push` is required, with no default, in every layer that declares `brief`. This follows the explicit-enum and no-shim doctrine: an existing config fails with exit 2, naming the key, instead of silently getting a mode it never chose.
- The pushed brief lists findings whose due is `this-phase` only; a finding due `later` or null is not pushed. Findings come first, then rules (with `findings-and-rules` only), up to 50 item lines, then one overflow line.
- `still failing` compares ids only against the same step's checked report in the phase's immediately previous gate attempt.
- A refusal reuses the gate-failure pause: no new phase state or stop reason, and only the message, lastError and resume instructions differ. Loss accepted: in state, a refusal looks like exhaustion, and resume grants a full budget.
- A report step does not have to declare `"input": "gate-request"`.
- Hello-world sends `review: []` and uses `"push": "findings-and-rules"`. Its finding ids are stable across runs.

Left open:

- The saved report's file name.
- The wording of the fix prompt, the pushed brief, `phax brief`, the Review notes intro, the run output and the resume instructions.
- Whether brief-record gets a new snapshot because the description of its answer changes wording while its keys do not, given the NEXT_STEPS entry on description-only changes.
- Whether the schemas package exports location, guide and finding as named types, beyond defining them identically in both JSON Schemas.
- Whether hello-world's audit.mjs and brief.mjs share one module that computes the findings.

Constraints:

- phax judges nothing in a report. Its decode checks are structural only: keys at every level, value types, unique finding ids, and line order.
- No back-compat shims. The enums are explicit, per variant: the gate report's outcome (`checked` | `refused`), `due` (`this-phase` | `later` | null), `brief.push` (`findings` | `findings-and-rules`) and the gate-attribution result (`pass` | `fail` | `refused`).
- A brief informs and never blocks. The gate's verdict is the provider's list.
- No command is granted from a report or a guide, and phax never reads, checks, pastes or loads a guide's file.
- Every `$schema` names its format.
- Served schema URLs are never withdrawn. Follow the gate-pending precedent: frozen copies under `site/retired-schemas/`, with the deploy guard unchanged.
- Docs to update: the README's Extend phax intro, "Gate report steps" (renamed from "Diagnostics gate steps"), "Gate request", "Brief provider" and §Persisted formats; the `phax --usage` contract text for gate steps and `phax brief`; the phax.json config descriptions for `output` and `brief`; the `phax-cli` and `phax-planning` skills where they mention diagnostics; and NEXT_STEPS.md's steme section.
- Tests to update: the example-providers integration test; the gate, fix-loop and fix-prompt tests; brief render and pull; the review handoff and publish body; records explain; the schemas package suite; the example-stamp test; and the site's schemas and deploy-guard tests.

## 11. Docs page

Page: README §Extend phax (rendered on docs.phax.run): "Gate report steps" (replacing "Diagnostics gate steps"), "Gate request" and "Brief provider", plus the `gate-report` and `brief-report` rows in §Persisted formats

Reader: Two readers: the author of a gate step or brief provider (steme first), deciding what to print; and the operator who wires it into phax.json, picks `brief.push`, and grants any tool a guide calls for through `security.agentCommands`

Example: The hello-world audit.mjs prints a gate report with one finding at src/greet.ts:1 whose guide is guides/no-node-import.md. The step fails, and the fix prompt shows the rule, the location, the message and the instruction to read the guide and follow it. brief.mjs answers `phax brief src/greet.ts src/farewell.ts` with the two rules over both files (farewell is not yet written) and the greet finding with its due.
