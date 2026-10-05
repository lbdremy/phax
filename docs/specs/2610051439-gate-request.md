---
status: Draft
date: 2026-10-05
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Gate request — a gate step reads the phase's base, terminal-ness and plan projection on stdin

## 1. Context

A gate step in `phax.json` is `{command, surface, firing, output?}`. phax splits the command on spaces and runs it without a shell, in the phase's worktree, after the agent's turn and before the phase commit. The phase's work is uncommitted in the working tree at that point. A step's stdin is not connected, so a read gets end of file at once.

An `output: "diagnostics"` step prints a JSON document, and phax reads its verdict from that document. An `invariant` finding fails the step. A `completion` finding names scopes and stays pending until the `scopes` provider says every one of them is closed. The terminal phase closes every scope without asking.

Once per attempt, before the steps, phax sends the scope provider `{phase, phases}` on stdin and logs it as `stdin: <json>` in the attempt log. Beside `checks-attempt-NN.log`, phax writes `checks-attempt-NN.diagnostics.json` (failing document), `checks-attempt-NN.pending.json` (pending findings) and `gate-attribution.json`. Every file in the phase folder goes into the phase's record on `phax/records/v1`. `phax records explain --gates` prints the attempt logs.

The other extension points (`orient`, `scopes`, `planAuditor`) share one contract: a command, a JSON document on stdin, a JSON document on stdout. The plan auditor and the scope provider receive the same projection of the plan, every phase with its planned files: `{id, files}`, with files = create ∪ edit, deduplicated, optional files excluded. Nothing else of the plan leaves phax.

Each phase works on its own branch `<run.branch>--<phase-id>`. phax creates it from the preceding phase's branch, or from the run branch for the first phase. A resume reuses it. `reset-phase` deletes it, and the re-run creates it again. Under the Approved headless-review spec, `run --append` branches the first appended phase from the previously final phase's branch, review commits included. phax records no starting commit for a phase today. The Approved oracle-phases spec (not built) gives its own provider a `base` with the same meaning: the commit the phase's branch started from.

The coordination note between phax and steme (rows 8 and 9) asks phax to send the phase's base and the plan, so steme's audit can judge the change incrementally and decide what is due. Per the brief, the rule is "the past from git, the future from the plan": incremental in the phases, full at the end.

Ground read:

- `docs/briefs/gate-request.md` — The brief and the author's decisions of 2026-10-04/05: stdin is the channel, only declaring steps receive the request, the indicative shape, the per-attempt copy, additive to scopes, steme's audit is the first consumer.
- `docs/briefs/drop-gate-scopes.md` — The next spec, which depends on this one: it retires `scopes`, the pending state and `gate-pending` once the provider decides what is due from the request. Both should ship in one release.
- `README.md` — §Extend phax: every hook is a command split on spaces, run without a shell, JSON request on stdin, JSON answer on stdout. Diagnostics steps, the scope provider's `{phase, phases}` request, the plan auditor's `{phases: [{id, files}]}` (nothing else leaves phax). §Persisted formats: `$schema` URL per format and release, the format table, `@lbdremy/phax-schemas` parsers.
- `src/app/gates.ts` — Steps run in profile order and stop at the first failure. Every step is run as `shell.run({ command, cwd })`, so nothing reaches its stdin. The scope query runs once per attempt before the steps and logs `$ <cmd>` plus `stdin: <json>`. Beside the attempt log, `.diagnostics.json` and `.pending.json` are written, plus `gate-attribution.json`.
- `src/infra/shell.ts` — Without `stdin`, the child's stdin is `ignore`, so a read hits end of file at once. With `stdin`, phax writes it, ends the stream, and swallows EPIPE when the child exits before draining it.
- `src/domain/gate/selectSteps.ts` — `firing: terminal` steps run only when the gated phase is the final one. `isFinal` is `i === plan.phases.length - 1` in executePlan.
- `src/domain/gate/diagnosticsPath.ts` — Naming rule for attempt files: strip `.log`, append the suffix (`checks-attempt-01.diagnostics.json`, `.pending.json`).
- `src/schemas/phaxConfig.ts` — Gate step = `{command, surface: local|structural|product, firing: every-phase|terminal, output?: log|diagnostics (default log)}`, in `gateProfiles` and `workspaces[].gateProfiles`. Unknown keys are rejected.
- `src/schemas/scopes.ts` — The scope provider's response `{closed: [...]}`. Its request is `ScopesRequest {phase, phases}` from src/domain/plan/projection.ts.
- `src/domain/plan/projection.ts` — `projectPhases`: each phase's `files` are its planned files to create and to edit, deduplicated in plan order, with optional files excluded. The scopes provider and the plan auditor share it.
- `src/app/executePlan.ts` — Each phase gets the branch `<run.branch>--<phase-id>`, created from the preceding phase's branch, or from the run branch for the first phase. A resume reuses the existing branch and worktree. No starting commit is recorded today.
- `src/app/worktree.ts` — `preparePhaseBranch` creates the phase branch from `fromBranch` only when it does not exist. `prepareRunBranch` creates the run branch from the current branch.
- `src/app/resetPhase.ts` — `reset-phase` archives the phase folder, removes the worktree and deletes the phase branch. It is refused when a later phase is committed, so the re-run branches again from the preceding phase's tip.
- `src/app/commit.ts` — The phase commit is made after the gate passes, so the phase's work is uncommitted in the worktree while the gate runs.
- `src/app/writeRecord.ts` — The phase record takes every file in the phase folder (output.jsonl only when transcripts are kept), so a new attempt file rides the record without a change to the manifest.
- `src/cli/commands/records.ts` — `phax records explain --gates` prints only the `checks-attempt-NN.log` artifacts, each under a `--- <name> ---` header.
- `docs/specs/archive/2609241238-schemas-package.md` — A persisted format: `$schema` `https://docs.phax.run/schemas/<format id>/<release>.json`, a parser and JSON Schema in the package, and an unreleased shape recorded as `<format id>/next.schema.json`, which the snapshot gate enforces and release.sh renames.
- `docs/specs/2609281159-oracle-phases.md` — Approved, not built. The oracle provider's own request carries `base`, defined as the commit the oracle phase's branch started from: the previous phase's commit, or the run-start commit for phase-01.
- `docs/specs/2609250823-headless-review.md` — Approved. `--append` branches the first appended phase from the previously final phase's branch, including commits made during review, and makes the last appended phase the kept-open final phase.
- `examples/hello-world/phax.json` — A diagnostics step `node ./audit.mjs` in gate profile `standard`, next to the `scopes`, `orient` and `planAuditor` hooks.
- `NEXT_STEPS.md` — §Road to 1.0.0 (rechecked 2026-10-05 at v0.18.0): the CLI and config contract is about to freeze. This spec adds a key and breaks nothing.

## 2. Problem

A diagnostics gate step receives nothing. phax runs it and reads its document, and that is all. A provider that wants to audit only what this phase changed cannot learn where the phase started. One that wants to know what later phases still plan cannot see the plan. One that wants to audit in full at the end cannot tell that this is the last phase. Its only option is to audit the whole tree every time and leave to phax's scope machinery the job of deciding which findings are due.

The one plan-aware input that exists sits elsewhere. It is the `scopes` provider, queried before the gate, and phax uses its answer to schedule completion findings itself. A provider that has the plan could make that decision on its own.

The gate is also the only extension point that does not take its inputs as a JSON document on stdin. Workarounds such as flags in the command string or environment variables would invent a second channel. They also could not carry a commit that phax alone knows.

steme's audit (`steme audit`, roadmap-1.0 item 0.13) is about to build its gate projection. It needs the base, the terminal flag and the plan projection, and the contract must exist before it is built against.

## 3. Product goal

A gate step can declare that it reads a gate request on stdin. The request is a JSON document naming the gated phase, the commit the phase started from, whether it is the terminal phase, and the plan's projection. With it, a provider audits what the phase changed (from git, base to working tree) and decides by itself what is due (from the plan). phax saves the exact request beside each attempt, so the verdict can be replayed and explained from the record. A step that does not declare the request runs exactly as today, and the scope machinery is untouched until the next spec retires it.

> phax sends the facts of the phase on stdin, never a judgement: where it started, whether it is last, and what the plan says; the provider decides what is due.

## 4. Terminology

- **Gate request** — The JSON document phax writes on a declaring step's stdin and saves beside the attempt: `$schema`, `phase`, `base`, `terminal`, `phases`. It is the persisted format `gate-request`.
- **Declaring step** — A gate step whose `input` is `"gate-request"`. Every other step is non-declaring, `input` absent or `"none"`.
- **Gated phase** — The phase whose gate attempt is running.
- **Base** — The commit the gated phase's branch was created from, as its full object name. This is the run-start commit for the run's first phase, and otherwise the tip of the preceding phase's branch when the gated phase's branch was created. It has the same meaning as oracle-phases' "base commit", applied to the gated phase. It is not the phase branch's current HEAD.
- **Run-start commit** — The tip of the run branch when the first phase's branch is created from it.
- **Terminal phase** — The run's final phase, whose gate also runs `firing: "terminal"` steps. With `run --append`, the last appended phase is the terminal phase.
- **Plan projection** — The ordered list `[{id, files}]` of the run's phases. Each `files` holds that phase's planned files to create and to edit, deduplicated, with optional files excluded. The scope provider and the plan auditor already receive this projection.
- **Attempt** — One run of the gated phase's selected steps, numbered NN, with its log `checks-attempt-NN.log`. The fix loop and a resume add attempts to the same phase.

## 5. Functional requirements

### 5.1 A declaring step receives the gate request

WHERE a gate step declares `"input": "gate-request"` THE system SHALL write the gated phase's gate request to that step's stdin each time the step runs.

### 5.2 A non-declaring step runs as today

The system SHALL run a gate step whose `input` is absent or `"none"` exactly as before this change: its stdin is not connected and reads as end of file at once, and the attempt log has no `stdin:` line for it.

### 5.3 Any step kind, any gate profile

The system SHALL accept `input` on a gate step of either `output` kind (`"log"` or `"diagnostics"`) and in every gate profile, `gateProfiles` and `workspaces[].gateProfiles` alike.

### 5.4 Unknown input values are refused

IF a gate step's `input` is anything other than `"none"` or `"gate-request"` THEN every command that loads the configuration SHALL refuse it in the config validation family (exit 2), naming the step's path and the allowed values.

### 5.5 The local config schema describes the key

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` that describes the gate step's `input` key, its two values and its `"none"` default, and SHALL leave `phax.json` unchanged.

### 5.6 Exactly five keys

The system SHALL send a gate request holding exactly the keys `$schema`, `phase`, `base`, `terminal` and `phases`, and no other key: no touched files, no diff, no closure, no impact and no verdict hint.

### 5.7 Base is where the phase started

The system SHALL set `base` to the full object name of the commit the gated phase's branch was created from: the run-start commit for the run's first phase, otherwise the tip of the preceding phase's branch at that moment.

### 5.8 One request per phase branch

WHILE a phase's branch exists THE system SHALL send byte-identical gate requests for that phase to every declaring step, on every fix-loop attempt and after every resume, whatever commits are made on the phase's branch meanwhile.

### 5.9 Base after a reset

WHEN a phase whose branch `phax reset-phase` deleted is re-run THE system SHALL take that phase's `base` from the branch created for the re-run.

### 5.10 Base of an appended phase

WHEN `phax run --append` creates the branch of the first appended phase THE system SHALL set that phase's `base` to the tip of the previously final phase's branch, including commits made during review.

### 5.11 Terminal is the firing condition

The system SHALL set `terminal` to `true` exactly when the gated phase is the run's terminal phase, which is the condition under which `firing: "terminal"` steps run, and to `false` otherwise.

### 5.12 The plan projection, in execution order

The system SHALL list in `phases` every phase of the run in execution order, the gated phase included, each as `{ "id", "files" }` with the plan projection's files, so that a single-phase run sends one entry.

### 5.13 Write then close

WHEN a declaring step starts THE system SHALL write the whole gate request to its stdin and then close its stdin.

### 5.14 An unread request is harmless

IF a declaring step exits without reading all of its stdin THEN the system SHALL judge the step by its output and exit code alone, raising no error and waiting on nothing because of the unread request.

### 5.15 Declaring changes no verdict rule

The system SHALL judge a declaring step by the unchanged verdict rules of its `output` kind, including the scheduling of completion diagnostics.

### 5.16 The scope machinery is untouched

The system SHALL keep the `scopes` provider query, its `{phase, phases}` request, the pending state and the `gate-pending` record unchanged, whether or not any step declares the input.

### 5.17 The attempt log names the request

WHEN a declaring step runs THE system SHALL write, on the line directly after the step's `$ <command>` line in the attempt log, a `stdin:` line naming the attempt's request file.

### 5.18 The request is saved beside the attempt

WHEN the first declaring step of a gate attempt is about to start THE system SHALL save the gate request beside the attempt log as `checks-attempt-NN.request.json`, holding the exact bytes written to the step's stdin.

### 5.19 No request file without a declaring step

The system SHALL write no request file for an attempt in which no declaring step runs.

### 5.20 The persisted format `gate-request`

The system SHALL define the saved request as the persisted format `gate-request`, with `$schema` `https://docs.phax.run/schemas/gate-request/<release>.json`, readable by `parseGateRequest` and `parseDocument` from `@lbdremy/phax-schemas`, and with its JSON Schema shipped as `json/gate-request.schema.json`.

### 5.21 The request travels in the record

WHEN a phase's record is written to `phax/records/v1` THE system SHALL include every request file of that phase's attempts.

### 5.22 `records explain` shows the request

WHEN `phax records explain <commit> --gates` prints an attempt's log THE system SHALL print that attempt's request file after it, under its file name.

## 6. Surface

### config: gate step `input` in phax.json — normative

before:

    "gateProfiles": {
      "standard": [
        { "command": "pnpm test", "surface": "local", "firing": "every-phase" },
        {
          "command": "node ./audit.mjs",
          "surface": "structural",
          "firing": "every-phase",
          "output": "diagnostics"
        }
      ]
    }

after:

    "gateProfiles": {
      "standard": [
        { "command": "pnpm test", "surface": "local", "firing": "every-phase" },
        {
          "command": "node ./audit.mjs",
          "surface": "structural",
          "firing": "every-phase",
          "output": "diagnostics",
          "input": "gate-request"
        }
      ]
    }

    # "input": "none" (default; same as absent) | "gate-request"
    # Accepted with "output": "log" or "diagnostics", in gateProfiles and workspaces[].gateProfiles.
    # `pnpm test` above is unchanged: stdin not connected, as today.

### config: phax.schema.json written by `phax schema upgrade` — indicative

before:

    gate step properties: command, surface, firing, output

after:

    $ phax schema upgrade          # phax.json is not modified

    gate step properties: command, surface, firing, output, input
    "input": {
      "enum": ["none", "gate-request"],
      "default": "none",
      "description": "\"none\" (default): the step's stdin is not connected. \"gate-request\": phax writes the gate request {$schema, phase, base, terminal, phases} on the step's stdin and saves it as checks-attempt-NN.request.json."
    }

    # Normative: the key, its two values, its default. Indicative: the description wording.

### api: gate request on a declaring step's stdin — normative

before:

    $ node ./audit.mjs        # cwd: the phase worktree; stdin not connected (immediate end of file)

after:

    $ node ./audit.mjs        # cwd: ~/.phax/worktrees/<run>/phase-02, uncommitted phase work in place
    stdin, then end of file:
    {
      "$schema": "https://docs.phax.run/schemas/gate-request/0.19.0.json",
      "phase": "phase-02",
      "base": "3f2a91c0d6e84b1f9a7c2e5d8b0a4f6c1e3d7b92",
      "terminal": false,
      "phases": [
        { "id": "phase-01", "files": ["src/core/billing/port.ts"] },
        { "id": "phase-02", "files": ["src/core/billing/invoice.ts"] },
        { "id": "phase-03", "files": ["src/cli/invoice.ts", "tests/invoice.test.ts"] }
      ]
    }

    # Single-phase run:
    { "$schema": "…/gate-request/0.19.0.json", "phase": "phase-01", "base": "<run-start commit>",
      "terminal": true, "phases": [{ "id": "phase-01", "files": ["src/greet.ts"] }] }

    # The past: git, from `base` to the working tree. The future: the entries after `phase`.
    # Normative: the five keys, their types and meanings. The values above are illustrative.

### file: <phase folder>/checks-attempt-NN.request.json — normative

before:

    checks-attempt-01.log
    check-attempt files today: .log, .diagnostics.json (failing document), .pending.json (pending findings)
    gate-attribution.json

after:

    checks-attempt-01.log
    checks-attempt-01.request.json       # new: the exact bytes written on stdin; only when a declaring step ran
    checks-attempt-01.diagnostics.json
    checks-attempt-01.pending.json
    gate-attribution.json

    # Replay, in the same worktree state:
    $ node ./audit.mjs < checks-attempt-01.request.json

### file: attempt log `checks-attempt-NN.log` — normative

before:

    $ node ./audit.mjs
    {"diagnostics":[]}
    exit 0

after:

    $ node ./audit.mjs
    stdin: checks-attempt-01.request.json
    {"diagnostics":[]}
    exit 0

    # Normative: a `stdin:` line directly after the `$` line, naming the request file. Indicative: anything else on that line.
    # The scope query keeps its own `stdin: {json}` line, which carries inline JSON, not a file name.

### package: @lbdremy/phax-schemas — format `gate-request` — normative

before:

    README §Persisted formats has no gate request row; the package exports no gate request parser.

after:

    | Gate request | `gate-request` | `<record>/checks-attempt-NN.request.json` | `parseGateRequest` | `json/gate-request.schema.json` |

    import { parseGateRequest } from "@lbdremy/phax-schemas";
    const parsed = parseGateRequest(JSON.parse(raw));
    // parsed.ok === true → parsed.value: { phase, base, terminal, phases }
    // parseDocument(JSON.parse(raw)) identifies it by its `$schema` as `gate-request`.

### cli: phax records explain <commit> --gates — indicative

before:

    $ phax records explain 9c1e2f4 --gates
    phase-02 · claude-code (claude-sonnet-5, medium)
    …
    --- checks-attempt-01.log ---
    $ node ./audit.mjs
    {"diagnostics":[]}
    exit 0

after:

    $ phax records explain 9c1e2f4 --gates
    phase-02 · claude-code (claude-sonnet-5, medium)
    …
    --- checks-attempt-01.log ---
    $ node ./audit.mjs
    stdin: checks-attempt-01.request.json
    {"diagnostics":[]}
    exit 0
    --- checks-attempt-01.request.json ---
    {
      "$schema": "https://docs.phax.run/schemas/gate-request/0.19.0.json",
      "phase": "phase-02",
      …
    }

    # Normative: the request is printed after its attempt's log, under its file name.

### cli: config refusal of an unknown `input` — indicative

    $ phax validate
    ✗ phax.json: gateProfiles.standard[1].input: expected "none" or "gate-request", got "stdin"
    $? = 2

    # Normative: exit 2, the step's path and the allowed values. Indicative: the wording.

## 7. Non-goals

- Removing the `scopes` provider, the pending state, `gate-pending` or the `scopes` field of completion diagnostics. That is the next spec, `drop-gate-scopes`, which depends on this one.
- A diagnostic `id`, accepted debt, ranges, structured repair and a decision class. These are later specs from the same coordination note.
- Sending touched files, a diff, scope closure, impact or any judgement phax computes. The provider reads the past from git.
- Flags or environment variables as a channel for any of these inputs. How a person runs the provider by hand, with its own flags, is the provider's business.
- Plan content beyond `id` and planned `files` (titles, objectives, prompts, models, optional files), the run id, or the attempt number.
- Sending the gate request to the `scopes`, `orient` or `planAuditor` hooks, or to the oracle step of the oracle-phases spec. That spec, and its own request, are not changed.
- Writing a request for gate runs outside a phase. Review-time manual commits run no gate.
- Printing diagnostics or pending documents in `records explain --gates`. Only the request is added there.
- Rewriting records written before this change. Their attempts have no request file.

## 8. Acceptance criteria

### A declaring step receives the phase's request

Given a three-phase run whose gate profile has the step `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics", "input": "gate-request" }`, where `audit.mjs` saves its stdin and prints `{ "diagnostics": [] }`, when phase-02's gate runs, then the saved stdin is a JSON object with exactly the keys `$schema`, `phase`, `base`, `terminal`, `phases`. `$schema` starts with `https://docs.phax.run/schemas/gate-request/`, `phase` is `phase-02`, `base` is the full sha of phase-01's commit, and `terminal` is `false`. `phases` lists phase-01, phase-02 and phase-03 in that order, each `files` equal to its planned create ∪ edit files with optional files excluded. (refs §5.1, §5.6, §5.7, §5.11, §5.12)

### A step without the declaration sees nothing

Given a gate step with no `input` key, `node ./count-stdin.mjs`, that prints how many bytes it read from stdin before end of file, and no declaring step in the profile, when the gate runs, then the step reads 0 bytes and does not block. The attempt log has no `stdin:` line for it, and no `checks-attempt-NN.request.json` exists for the attempt. (refs §5.2, §5.19)

### A log step in a workspace profile may declare it

Given a workspace gate profile with an `"output": "log"` step declaring `"input": "gate-request"`, whose command copies its stdin to a file and exits 0, when the phase's gate runs, then `phax validate` accepted the configuration. The copied file holds the gate request, and the step's result in `gate-attribution.json` is `pass`. The same step exiting 1 is `fail`, exactly as without the declaration. (refs §5.3, §5.15)

### An unknown input value is refused

Given a `phax.json` whose `gateProfiles.standard[1]` has `"input": "stdin"`, when `phax validate` runs, then it exits 2 with a message naming `gateProfiles.standard[1].input` and the allowed values `none` and `gate-request`. (refs §5.4)

### `phax schema upgrade` describes the key

Given a project whose `phax.schema.json` predates this change, when `phax schema upgrade` runs, then the gate step schema in `phax.schema.json` has an `input` property with the enum `none`, `gate-request` and the default `none`, and `phax.json` is byte-for-byte unchanged. (refs §5.5)

### A single-phase run

Given a one-phase plan whose gate has a declaring step, when phase-01's gate runs, then the request has `terminal` `true`, a `phases` array with the single entry for phase-01, and `base` equal to the run branch's tip when phase-01's branch was created. (refs §5.7, §5.11, §5.12)

### Every fix-loop attempt gets the same request

Given phase-02 with a declaring step that fails on attempts 01 and 02 and passes on 03, with a commit made on the phase-02 branch between attempts 01 and 02, when the three attempts run, then `checks-attempt-01.request.json`, `-02` and `-03` are byte-identical, each equals what the step read on its stdin in that attempt, and `base` is phase-01's commit, not the phase branch's HEAD. (refs §5.8, §5.18)

### A resume keeps the request

Given a run stopped with phase-02's gate exhausted, after attempts 01 and 02 with a declaring step, when `phax resume <run>` runs the gate again, then the new attempt's request file is byte-identical to `checks-attempt-01.request.json`. (refs §5.8)

### A reset phase takes its base from the new branch

Given a run failed at phase-02's gate, when `phax reset-phase <run> phase-02` then `phax resume <run> --yes` run, and phase-02's gate runs again, then the re-run's request names as `base` the tip of `<run.branch>--phase-01` at the time the new phase-02 branch was created. (refs §5.9)

### Appended phases

Given a run in `review_open` whose final phase-03 branch carries a commit made during review, and a review plan with phase-04 and phase-05, under a gate with a declaring step, when `phax run <run> --append --plan <review-plan.md>` gates phase-04 and then phase-05, then phase-04's `base` is the review commit at the tip of phase-03's branch. `terminal` is `false` for phase-04 and `true` for phase-05. Both requests list phase-01 through phase-05 in execution order. (refs §5.10, §5.11, §5.12)

### A step that ignores stdin neither hangs nor errs

Given a declaring step `node ./ignore-stdin.mjs` that exits 0 at once without reading, on a plan whose projection serializes to more than 128 KiB, when the gate runs, then the step's result is `pass`, the attempt completes with no error, and no step waits on the unread request. (refs §5.14, §5.13)

### A step reading to end of file terminates

Given a declaring step that reads stdin until end of file and writes it to a file, when the gate runs, then the step terminates, and its file is byte-identical to the attempt's `checks-attempt-NN.request.json`. (refs §5.13, §5.18)

### The attempt log marks a declaring step

Given a profile with `pnpm test` (no `input`) followed by `node ./audit.mjs` declaring `"input": "gate-request"`, when attempt 01 runs, then in `checks-attempt-01.log` the line after `$ node ./audit.mjs` is `stdin: checks-attempt-01.request.json`, and the line after `$ pnpm test` is not a `stdin:` line. (refs §5.17)

### The saved request replays

Given a recorded attempt with `checks-attempt-01.request.json`, and a declaring step that echoes its stdin to stdout, when `node ./echo.mjs < checks-attempt-01.request.json` runs, then its output is byte-identical to what the step printed during the gate. (refs §5.18, §5.20)

### The format is published

Given a `checks-attempt-01.request.json` written by phax, when it is passed to `parseGateRequest` and to `parseDocument` from `@lbdremy/phax-schemas`, then both succeed, `parseDocument` identifies `gate-request`, and the package ships `json/gate-request.schema.json`. README §Persisted formats has the `gate-request` row, and the snapshot gate passes with `gate-request/next.schema.json` recorded. (refs §5.20)

### The record carries and shows the request

Given a committed phase whose attempts 01 and 02 each ran a declaring step, with records enabled, when `phax records explain <record commit> --gates` runs, then the record holds both request files. The output prints `--- checks-attempt-01.request.json ---` and its content after the attempt-01 log, and likewise for attempt 02. (refs §5.21, §5.22)

### Scope scheduling is unchanged

Given a non-terminal phase with a registered `scopes` provider and a declaring diagnostics step that returns one `completion` finding whose scope the provider reports open, when the gate runs, then the scope provider is queried with `{phase, phases}` as before and logged with its own `stdin:` line. The finding is pending, `checks-attempt-01.pending.json` is written, and the step's result is `pending`. (refs §5.16, §5.15)

## 9. Open questions for implementation planning

### Q1 — What is the declaration's name and shape?

- `"input": "none" | "gate-request"`, default `"none"` — abandons: Brevity. The key has one real value today, and `"none"` exists only to spell the default.
- `"input": "gate-request"` only, absence meaning none — abandons: An explicit spelling of the default, which `output: "log"` has. A profile cannot say "no input" deliberately.
- `"request": true` — abandons: Room for a second kind of input without a new key, and the symmetry with `output`. A boolean names the feature, not what arrives on stdin.

Recommendation: `"input": "none" | "gate-request"`, default `"none"` — `input` mirrors `output`: one key per direction, each an explicit per-variant enum with a named default. A later input kind becomes a new value, not a new key, just before the config contract freezes. The cost is one value that does nothing more than the default.

### Q2 — May `output: "log"` steps declare the input, or diagnostics steps only?

- Any step kind — abandons: A guarantee that the request only reaches steps whose verdict phax reads structurally. Later changes to the request must also consider log consumers phax cannot observe.
- Diagnostics steps only — abandons: Base-aware log steps (tests or linters limited to what changed since `base`). These would be pushed back to flags or environment variables, the channel the author ruled out.

Recommendation: Any step kind — The request is input, independent of how the verdict is read. The declaration is opt-in, so a test or lint command that does not want stdin is never touched. Limiting it to diagnostics would recreate, for log steps, the problem this spec fixes.

### Q3 — Does the request also carry the files the phase touched?

- No: the provider reads git from `base` to the working tree — abandons: Providers that cannot run git in the worktree. Every gate step already runs there, so the loss is theoretical.
- Yes, a `touched` list computed by phax — abandons: Git as the single account of the past. phax would keep a second list in step with git's view of untracked files, renames and deletions, and a disagreement would make the provider's view diverge from the diff.

Recommendation: No: the provider reads git from `base` to the working tree — This was decided with the author: "the past from git, the future from the plan". `base` is the one fact git cannot supply, which commit the phase started from. Everything after it is in the worktree the step runs in.

### Q4 — Does each `phases` entry carry anything beyond `id` and `files`?

- `id` and `files` only — abandons: Titles and objectives a provider could quote in its messages, and an explicit per-phase status.
- Add `title` — abandons: The rule, shared with the plan auditor and the scope provider, that only planned files leave phax. Every plan field sent becomes a contract to freeze.
- Add a status (`committed` / `gated` / `planned`) — abandons: Derivability. Status already follows from each entry's position relative to `phase`, and a stored state could go stale across a resume or reset.

Recommendation: `id` and `files` only — This is the same projection the scope provider and the plan auditor already receive, so a provider handles one shape. The first consumer needs only the files later phases still plan, and order relative to `phase` already gives past, present and future.

### Q5 — What is the saved request's file name?

- `checks-attempt-NN.request.json` — abandons: Self-description outside the gate context: `.request` does not say whose request it is.
- `checks-attempt-NN.gate-request.json` — abandons: The one-word suffix pattern that `.diagnostics.json` and `.pending.json` share beside the same log.
- One `gate-request.json` per phase — abandons: Per-attempt locality. Replaying attempt NN means trusting that the request never changed, and the `stdin:` line could not name a file belonging to the attempt.

Recommendation: `checks-attempt-NN.request.json` — It sits beside `checks-attempt-NN.log`, whose `checks-` prefix already places it in the gate, and the format id `gate-request` carries the full name in `$schema`. One file per attempt keeps `<command> < file` exact for the attempt it names, at the cost of identical copies.

### Q6 — For an appended phase, which phases does `phases` list?

- Every phase of the run in execution order: the original plan's phases, then each appended plan's, through the gated phase's plan — abandons: "The plan" meaning one plan document. The projection mixes phases from several plans.
- Only the phases of the plan that planned the gated phase — abandons: One rule for every phase. A provider would see the run's earlier phases vanish from the projection exactly when the run is appended to.

Recommendation: Every phase of the run in execution order: the original plan's phases, then each appended plan's, through the gated phase's plan — The future, the part the provider needs from the plan, is the same under both options. Keeping the past phases makes the request of an appended phase the same kind of document as any other: every phase of the run, the gated one included. `base` and git already scope the change.

## 10. Implementation-planning note

Settled:

- Declaration: `"input": "none" | "gate-request"` on a gate step, default `"none"`, accepted with either `output` kind in `gateProfiles` and `workspaces[].gateProfiles`. An unknown value is a config error (exit 2).
- The request has exactly `$schema`, `phase`, `base`, `terminal` and `phases`. `base` is the full object name of the commit the gated phase's branch was created from. `terminal` is the `firing: "terminal"` condition. `phases` is the run's phases in execution order as `{id, files}` (the existing projection).
- The same bytes go to every declaring step of every attempt while the phase branch exists. They are written to stdin and then stdin is closed. An unread request is harmless.
- The saved copy is `checks-attempt-NN.request.json`, holding the exact stdin bytes, written before the first declaring step of the attempt and only if one runs. Its format id is `gate-request`, it is parsed by `parseGateRequest`, its schema is `json/gate-request.schema.json` with a `gate-request/next.schema.json` snapshot, and it has a README §Persisted formats row.
- The attempt log gets a `stdin: <request file>` line after the declaring step's `$` line. The request rides the phase record, and `phax records explain --gates` prints it after its attempt's log.
- Scope scheduling, the scope query, pending findings and `gate-pending` are unchanged. A provider may read the request and still emit scoped completions.

Left open:

- How phax knows `base`: recorded when the phase branch is created, or derived from the branch topology at gate time. Either way it must stay stable across attempts, resumes and commits inside the phase, and must not be the phase branch's HEAD. A phase whose branch was created by an older phax and resumed under this one needs a defined answer. Under the no-shims rule, refusing with an actionable message is acceptable.
- The JSON formatting of the bytes (indentation, trailing newline). The only constraint is that stdin and the file are identical.
- Whether `examples/hello-world/audit.mjs` declares the input to show it. Recommended: yes, reading `base` and ignoring the rest, coordinated with `drop-gate-scopes`, which rewrites the same example.
- Where the README documents it: a "Gate request" subsection under §Extend phax next to Diagnostics gate steps is recommended.
- The coordination note in steme-corpus (`02-product/phax-steme-coordination.md`) could not be read from this authoring session. Rows 8 and 9 are reflected as the brief summarizes them, and the planner should cross-check §"The gate request" there.

Constraints:

- Additive. A step without the declaration is spawned exactly as today, with stdin not connected. Nothing about `output`, `firing`, `surface`, the fix loop or attribution changes.
- phax computes no closure, impact, touched-file list or verdict for the request. Flags and environment variables are not a channel for it.
- Relation to oracle-phases (Approved, not built): its `base` has the same meaning, the commit a phase's branch started from. For an oracle phase's own gate the two coincide. In `discharged` mode the oracle request's `base` is the oracle phase's, not the gated phase's. The oracle step is not a configured gate step and never receives the gate request. That spec is not changed, but both should use one way of obtaining a phase's base.
- `--append` comes from the headless-review spec. If this ships first, r-base-append and the appended-phase rule for `phases` bind the plan that builds `--append`.
- `drop-gate-scopes` depends on this spec and should ship in the same release, so no release has a request without the scopes retirement, or the retirement without a request.
- Nothing else of the plan leaves phax: the projection is the one the plan auditor and the scope provider already receive.
- Persisted-format rules hold: `$schema` names the writing release, all fields are required, and an unreleased shape is recorded as a `next` snapshot by the schemas gate.

## 11. Docs page

Page: README §Extend phax › Gate request (with the `gate-request` row in §Persisted formats and the `input` key in the gate step reference)

Reader: The author of a gate-step provider, such as steme's audit, who wants to judge only what the current phase changed and to know which files later phases still plan, without phax deciding what is due.

Example: Declare the step `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics", "input": "gate-request" }`. In audit.mjs, read stdin to the end and `JSON.parse` it. Run `git diff --name-only <request.base>` plus the untracked files to get what the phase changed. Take `request.phases` after `request.phase` as what is still planned. When `request.terminal` is true, audit everything. Print `{ "diagnostics": [...] }`. To replay a recorded verdict: `node ./audit.mjs < checks-attempt-01.request.json`.
