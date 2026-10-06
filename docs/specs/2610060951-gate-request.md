---
status: Approved
date: 2026-10-06
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-10-06
  baseline: 145c984
---
# Gate request — a gate step reads the phase's base, terminal-ness and plan projection on stdin

## 1. Context

This spec lands after `drop-orient` and `drop-gate-scopes`, and describes the gate as those two leave it.

A gate step in `phax.json` is `{command, surface, firing, output?}`, in `gateProfiles` and `workspaces[].gateProfiles`. Unknown keys are refused. phax splits the command on spaces and runs it without a shell, in the phase's worktree, after the agent's turn and before the phase commit. At that point the phase's work is uncommitted in the working tree. Steps run in profile order, and the attempt stops at the first failing step. A step's stdin is not connected, so a read gets end of file at once.

An `output: "diagnostics"` step prints `{"diagnostics": [...]}`. Every finding it reports, `invariant` or `completion`, fails the step. phax schedules nothing: the provider alone decides what is due, and today it can decide only from git. Beside each `checks-attempt-NN.log`, phax writes the failing document as `checks-attempt-NN.diagnostics.json`, plus `gate-attribution.json` for the phase. Every file in the phase folder goes into the phase's record on `phax/records/v1`. `phax records explain --gates` prints only the `checks-attempt-NN.log` files.

The other remaining extension point, the plan auditor, follows the shared contract: a command, a JSON document on stdin, a JSON document on stdout. It receives the plan projection `{phases: [{id, files}]}`, where files are create ∪ edit, deduplicated, with optional files excluded. Nothing else of the plan leaves phax. README §Extend phax says every hook reads a JSON request on stdin, but a gate step reads nothing.

Each phase works on its own branch `<run.branch>--<phase-id>`. phax creates it, only if it does not exist yet, from the preceding phase's branch, or from the run branch for the first phase. A resume reuses the branch. `phax reset-phase` deletes it, and the re-run creates it again. Under the Approved, not yet built, headless-review spec, `run --append` branches the first appended phase from the previously final phase's branch, review commits included. The phase status names the phase's branch, but phax records no starting commit. The Approved, not built, oracle-phases spec gives its own provider a `base` with the same meaning: the commit the phase's branch started from.

The first consumer is steme's audit (`steme audit`, roadmap-1.0 item 0.13, not built). The phax–steme coordination note (changes 8 and 9) asks phax to send the phase's base and the plan. Its rule is "the past from git, the future from the plan": incremental in the phases, full at the end.

Ground read:

- `docs/briefs/gate-request.md` — The brief and the author's decisions of 2026-10-04/05/06: stdin is the channel; only declaring steps receive the request; the indicative shape; the per-attempt copy; additive to the gate as drop-gate-scopes leaves it; the hello-world diagnostics step declares the input; steme's audit is the first consumer.
- `docs/specs/archive/2610051439-gate-request.md` — The abandoned predecessor (approved 2026-10-05, abandoned 2026-10-06). Its §9 Q1–Q6 are carried over here as decided. Only its scope-related requirements and criteria are dropped. It left open how phax knows `base`, which this spec decides in Q7.
- `docs/briefs/drop-gate-scopes.md` — The gate as this spec finds it. There is no `scopes` provider, closure, pending state, `pending` step result or `gate-pending`. Every finding fails the step, and the provider alone decides what is due, from git only until this request exists. No `.pending.json` beside the attempt log. Not yet written as a spec under docs/specs/, so read from its brief.
- `docs/briefs/drop-orient.md` — There is no `orient` hook, so the extension points left are the gate steps and the plan auditor. Not yet written as a spec under docs/specs/, so read from its brief.
- `docs/briefs/brief-provider.md` — The later brief spec reuses the gate request's facts, plus `files`, for its own request. So the field names fixed here are the ones it inherits. It is out of scope here.
- `README.md` — §Extend phax: every hook is a command split on spaces, run without a shell, JSON request on stdin, JSON answer on stdout. The plan auditor receives `{phases: [{id, files}]}` and nothing else leaves phax. §Persisted formats: one `$schema` URL per format and release, the format table and the package parsers. §Exit codes: 1 is a generic refusal and 2 is plan or config validation.
- `src/app/gates.ts` — Steps run in profile order and stop at the first failure. Every step is run as `shell.run({ command, cwd })`, so nothing reaches its stdin. The attempt log is `$ <cmd>`, then stdout, stderr and `exit N`. The `stdin: <json>` line belongs to the scope query, which goes with drop-gate-scopes. `.diagnostics.json` and `gate-attribution.json` are written beside the log.
- `src/infra/shell.ts` — Without `stdin`, the child's stdin is `ignore`, so a read gets end of file at once. With `stdin`, phax writes it, ends the stream, and swallows EPIPE when the child exits before draining it.
- `src/domain/gate/selectSteps.ts` — `firing: terminal` steps run only when the gated phase is the final one. executePlan passes `isFinal = i === plan.phases.length - 1`, which is also what the gate is told about terminal-ness.
- `src/domain/gate/diagnosticsPath.ts` — The naming rule for attempt files: strip `.log` and append the suffix (`checks-attempt-01.diagnostics.json`).
- `src/schemas/phaxConfig.ts` — A gate step is `{command, surface, firing, output?: log|diagnostics (default log)}`, in `gateProfiles` and `workspaces[].gateProfiles`. Unknown keys are rejected.
- `src/domain/plan/projection.ts` — Each phase's `files` are its planned files to create and to edit, deduplicated in plan order, with optional files excluded. The plan auditor's request uses this projection.
- `src/app/executePlan.ts` — Phase-01 branches from the run branch, and phase-N from phase-(N-1)'s branch. On resume, the source branch is re-derived from the name of the preceding phase. The phase status records `branchName` but no starting commit.
- `src/app/worktree.ts` — `preparePhaseBranch` creates the phase branch from `fromBranch` only when it does not already exist. `prepareRunBranch` creates the run branch from the current branch.
- `src/cli/commands/records.ts` — `phax records explain --gates` prints only the artifacts matching `checks-attempt-NN.log`, each under a `--- <name> ---` header.
- `packages/schemas` — The format snapshots (`snapshots/<format id>/<release>.schema.json`), `history.lock.json`, `releases.json` and `json/<format id>.schema.json`. The current release is 0.19.0.
- `docs/specs/archive/2609241238-schemas-package.md` — How a persisted format gets its `$schema` URL `https://docs.phax.run/schemas/<format id>/<release>.json`, its parser and its JSON Schema. An unreleased shape is recorded as a `next` snapshot, which the snapshot gate enforces.
- `docs/specs/2609281159-oracle-phases.md` — Approved, not built. Its provider request carries `base`, the commit the oracle phase's branch started from: the previous phase's commit, or the run-start commit for phase-01. In `discharged` mode it also carries `oracleCommit`.
- `examples/hello-world/` — `phax.json` has the diagnostics step `node ./audit.mjs` in profile `standard`. `audit.mjs` walks every `.ts` file under `src/` and reads nothing on stdin.
- `NEXT_STEPS.md` — §Before steme's audit (reordered 2026-10-06): drop-orient, then drop-gate-scopes, then gate-request, then the brief. §Road to 1.0.0: the CLI and config contract is about to freeze. This spec adds a key and breaks nothing.

## 2. Problem

A gate step receives nothing. phax runs it and reads its output, and that is all. Since `drop-gate-scopes`, the provider alone decides what is due, but that decision needs facts the provider cannot get:

- Where the phase started. Only phax knows which commit the phase branched from. HEAD moves when the agent commits, and the source branch can move afterwards.
- Whether this is the last phase, where the audit should run in full.
- Which files later phases still plan, so the provider does not demand now what a later phase will do.

Without these facts, a provider audits the whole tree on every phase. It then either fails phases for work the plan schedules later, or lets that work through everywhere.

The gate is also the only extension point that does not take its inputs as a JSON document on stdin. Flags in the command string or environment variables would invent a second channel, and they could not carry a commit that only phax knows. Connecting stdin for every step does not work either. A gate also runs tests and linters, and a command that finds a non-terminal stdin may wait on it or change its behaviour.

steme's audit is about to build its gate projection against whatever contract exists, so the contract must exist first.

## 3. Product goal

A gate step can declare that it reads a gate request on stdin. The request is a JSON document that names the gated phase, the commit the phase started from, whether it is the terminal phase, and the plan's projection. With it, a provider audits what the phase changed (from git, base to working tree) and decides by itself what is due (from the plan). phax saves the exact request beside each attempt, so the verdict can be replayed and explained from the record. A step that does not declare the request runs exactly as today.

> phax sends the facts of the phase on stdin, never a judgement: where it started, whether it is last, and what the plan says; the provider decides what is due.

## 4. Terminology

- **Gate request** — The JSON document phax writes on a declaring step's stdin and saves beside the attempt. Its keys are `$schema`, `phase`, `base`, `terminal` and `phases`. It is the persisted format `gate-request`.
- **Declaring step** — A gate step whose `input` is `"gate-request"`. Every other step is non-declaring and has no `input` key.
- **Gated phase** — The phase whose gate attempt is running.
- **Base** — The commit the gated phase's branch was created from, as its full object name. For the run's first phase it is the run-start commit. For any other phase it is the tip of the preceding phase's branch at the moment the gated phase's branch was created. It is never the phase branch's current HEAD. It has the same meaning as oracle-phases' base commit.
- **Run-start commit** — The tip of the run branch when the first phase's branch is created from it.
- **Terminal phase** — The run's final phase, whose gate also runs `firing: "terminal"` steps. With `run --append`, the last appended phase is the terminal phase.
- **Plan projection** — The ordered list `[{id, files}]` of the run's phases, the same projection the plan auditor receives. Each `files` holds that phase's planned files to create and to edit, deduplicated, with optional files excluded.
- **Attempt** — One run of the gated phase's selected steps, numbered NN, with its log `checks-attempt-NN.log`. The fix loop and a resume both add attempts to the same phase.

## 5. Functional requirements

### 5.1 A declaring step receives the gate request

WHERE a gate step declares `"input": "gate-request"` THE system SHALL write the gated phase's gate request to that step's stdin each time the step runs.

### 5.2 A non-declaring step runs as today

The system SHALL run a gate step that has no `input` key exactly as before this change: its stdin is not connected and reads as end of file at once, and the attempt log has no `stdin:` line for it.

### 5.3 Any step kind, any gate profile

The system SHALL accept `input` on a gate step of either `output` kind (`"log"` or `"diagnostics"`), in `gateProfiles` and in `workspaces[].gateProfiles` alike.

### 5.4 Unknown input values are refused

IF a gate step's `input` is anything other than `"gate-request"` THEN every command that loads the configuration SHALL refuse it in the config validation family (exit 2), naming the step's path and the allowed value.

### 5.5 The local config schema describes the key

WHEN `phax schema upgrade` runs THE system SHALL write a `phax.schema.json` describing the gate step's `input` key, its single value `"gate-request"`, and that an absent key means the step has no input, and SHALL leave `phax.json` unchanged.

### 5.6 Exactly five keys

The system SHALL send a gate request holding exactly the keys `$schema`, `phase`, `base`, `terminal` and `phases`, and no other key: no touched files, no diff, no closure, no impact and no verdict hint.

### 5.7 Base is where the phase started

The system SHALL set `base` to the full object name of the commit the gated phase's branch was created from. For the run's first phase this is the run-start commit. For any other phase it is the tip of the preceding phase's branch at the moment the gated phase's branch was created.

### 5.8 Base does not move with the branches

WHILE a phase's branch exists THE system SHALL keep that phase's `base` the commit the branch was created from, whatever commits are made meanwhile on the phase's branch, and whether the branch it was created from is later moved or deleted.

### 5.9 Base after a reset

WHEN a phase whose branch `phax reset-phase` deleted is re-run THE system SHALL take that phase's `base` from the branch created for the re-run.

### 5.10 Base of an appended phase

WHEN `phax run --append` creates the branch of the first appended phase THE system SHALL set that phase's `base` to the tip of the previously final phase's branch, including commits made during review.

### 5.11 A phase without a known base is not gated with a request

IF phax is about to resume a phase whose branch was created by a release earlier than this change, and a declaring step is among the steps that phase's gate runs, THEN the system SHALL refuse before running anything of the phase, exiting 1 with a message that names `phax reset-phase <run> <phase>`.

### 5.12 Terminal is the firing condition

The system SHALL set `terminal` to `true` exactly when the gated phase is the run's terminal phase, which is the condition under which `firing: "terminal"` steps run, and to `false` otherwise.

### 5.13 The plan projection, in execution order

The system SHALL list in `phases` every phase of the run in execution order, the gated phase included, each as `{ "id", "files" }` with the plan projection's files, so that a single-phase run sends a single entry and an appended run lists the original plan's phases followed by each appended plan's.

### 5.14 One request per phase

The system SHALL send the same gate request to every declaring step of every attempt of a phase, across fix-loop attempts and resumes alike, and SHALL let only `$schema` differ between attempts run by different phax releases.

### 5.15 Write then close

WHEN a declaring step starts THE system SHALL write the whole gate request to its stdin and then close its stdin.

### 5.16 An unread request is harmless

IF a declaring step exits without reading all of its stdin THEN the system SHALL judge the step by its output and exit code alone, raising no error and waiting on nothing because of the unread request.

### 5.17 Declaring changes no verdict rule

The system SHALL judge a declaring step by the unchanged verdict rules of its `output` kind.

### 5.18 The attempt log names the request

WHEN a declaring step runs THE system SHALL write, on the line directly after the step's `$ <command>` line in the attempt log, a `stdin:` line naming the attempt's request file.

### 5.19 The request is saved beside the attempt

WHEN the first declaring step of a gate attempt is about to start THE system SHALL save the gate request beside the attempt log as `checks-attempt-NN.request.json`, holding the exact bytes written to the step's stdin.

### 5.20 No request file without a declaring step

The system SHALL write no request file for an attempt in which no declaring step runs, including an attempt that stops at a failing step placed before the first declaring step.

### 5.21 The persisted format `gate-request`

The system SHALL define the saved request as the persisted format `gate-request`, with `$schema` `https://docs.phax.run/schemas/gate-request/<release>.json`, readable by `parseGateRequest` and by `parseDocument` from `@lbdremy/phax-schemas`, and with its JSON Schema shipped as `json/gate-request.schema.json`.

### 5.22 The request travels in the record

WHEN a phase's record is written to `phax/records/v1` THE system SHALL include every request file of that phase's attempts.

### 5.23 `records explain` shows the request

WHEN `phax records explain <commit> --gates` prints an attempt's log THE system SHALL print that attempt's request file directly after it, under its file name.

### 5.24 The hello-world audit reads the request

The system SHALL ship the hello-world example with its diagnostics step `node ./audit.mjs` declaring `"input": "gate-request"`, and with `audit.mjs` taking from the request on stdin which files it audits.

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

    # "input": "gate-request" is the only value; no "input" key means no input.
    # Accepted with "output": "log" or "diagnostics", in gateProfiles and workspaces[].gateProfiles.
    # `pnpm test` above is unchanged: stdin not connected, as today.

### config: phax.schema.json written by `phax schema upgrade` — indicative

before:

    gate step properties: command, surface, firing, output

after:

    $ phax schema upgrade          # phax.json is not modified

    gate step properties: command, surface, firing, output, input
    "input": {
      "const": "gate-request",
      "description": "Absent: the step's stdin is not connected. \"gate-request\": phax writes the gate request {$schema, phase, base, terminal, phases} on the step's stdin and saves it as checks-attempt-NN.request.json."
    }

    # Normative: the key, its one value, and that absence means no input. Indicative: the description wording.

### api: gate request on a declaring step's stdin — normative

before:

    $ node ./audit.mjs        # cwd: the phase worktree; stdin not connected (immediate end of file)

after:

    $ node ./audit.mjs        # cwd: ~/.phax/worktrees/<run>/phase-02, uncommitted phase work in place
    stdin, then end of file:
    {
      "$schema": "https://docs.phax.run/schemas/gate-request/0.20.0.json",
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
    { "$schema": "…/gate-request/0.20.0.json", "phase": "phase-01", "base": "<run-start commit>",
      "terminal": true, "phases": [{ "id": "phase-01", "files": ["src/greet.ts"] }] }

    # The past: git, from `base` to the working tree. The future: the entries after `phase`.
    # Normative: the five keys, their types and meanings. The values above are illustrative.

### file: <phase folder>/checks-attempt-NN.request.json — normative

before:

    checks-attempt-01.log
    checks-attempt-01.diagnostics.json     # failing document, when a diagnostics step failed
    gate-attribution.json

after:

    checks-attempt-01.log
    checks-attempt-01.request.json         # new: the exact bytes written on stdin; only when a declaring step ran
    checks-attempt-01.diagnostics.json
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
    # A non-declaring step's `$` line is never followed by a `stdin:` line.

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
    phase-02 · claude-code (claude-sonnet-5-5, medium)
    …
    --- checks-attempt-01.log ---
    $ node ./audit.mjs
    {"diagnostics":[]}
    exit 0

after:

    $ phax records explain 9c1e2f4 --gates
    phase-02 · claude-code (claude-sonnet-5-5, medium)
    …
    --- checks-attempt-01.log ---
    $ node ./audit.mjs
    stdin: checks-attempt-01.request.json
    {"diagnostics":[]}
    exit 0
    --- checks-attempt-01.request.json ---
    {
      "$schema": "https://docs.phax.run/schemas/gate-request/0.20.0.json",
      "phase": "phase-02",
      …
    }

    # Normative: the request is printed directly after its attempt's log, under its file name.

### cli: config refusal of an unknown `input` — indicative

    $ phax validate
    ✗ phax.json: gateProfiles.standard[1].input: expected "gate-request", got "stdin"
    $? = 2

    # Normative: exit 2, the step's path and the allowed value. Indicative: the wording.

### cli: resume refusal for a phase whose base is unknown — indicative

    $ phax resume my-project.greet
    ✗ phase-02 cannot resume: gate step "node ./audit.mjs" reads the gate request, and phase-02's branch
      was created by an earlier phax release, so the commit it started from is unknown.
      Run `phax reset-phase my-project.greet phase-02`, then `phax resume my-project.greet`.
    $? = 1

    # Normative: exit 1, refused before anything of the phase runs, the message names `phax reset-phase <run> <phase>`. Indicative: the wording.

### file: examples/hello-world (phax.json, audit.mjs) — indicative

before:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics" }

    // audit.mjs: walks every .ts under src/, reads nothing on stdin

after:

    { "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase",
      "output": "diagnostics", "input": "gate-request" }

    // audit.mjs:
    const request = JSON.parse(readFileSync(0, "utf8"));
    // terminal → every .ts under src/
    // otherwise → the .ts files under src/ changed since request.base
    //             (git diff --name-only <base>, plus untracked files)

    # Normative: the step declares the input and audit.mjs reads the request from stdin. Indicative: how it uses it.

## 7. Non-goals

- Sending touched files, a diff, scope closure, impact, or any judgement phax computes. The provider reads the past from git, and phax gains no notion of what is due.
- Flags or environment variables as a channel for any of these inputs. How a person runs the provider by hand, with its own flags, is the provider's business.
- Plan content beyond `id` and planned `files` (titles, objectives, prompts, models, optional files), the run id, or the attempt number.
- Connecting stdin, or an explicit `"none"` value, for steps that do not declare the input.
- The brief: pushing facts to the agent at phase start, or `phax brief` (spec `brief-provider`, which defines its own request).
- Sending the gate request to the plan auditor, or to the oracle step of the oracle-phases spec. That spec, and its own request, are not changed.
- A diagnostic `id` and oscillation, accepted debt, ranges, structured repair, and a decision class. These are later specs from the same coordination note.
- Writing a request for gate runs outside a phase. Review-time manual commits run no gate.
- Printing diagnostics documents or `gate-attribution.json` in `records explain --gates`. Only the request is added there.
- Rewriting records written before this change. Their attempts have no request file.

## 8. Acceptance criteria

### A declaring step receives the phase's request

Given a three-phase run whose gate profile has the step `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics", "input": "gate-request" }`, where `audit.mjs` saves its stdin and prints `{ "diagnostics": [] }`, when phase-02's gate runs, then the saved stdin is a JSON object with exactly the keys `$schema`, `phase`, `base`, `terminal` and `phases`. `$schema` starts with `https://docs.phax.run/schemas/gate-request/`, `phase` is `phase-02`, `base` is the full sha of phase-01's commit, and `terminal` is `false`. `phases` lists phase-01, phase-02 and phase-03 in that order, each with `files` equal to its planned create ∪ edit files, optional files excluded. (refs §5.1, §5.6, §5.7, §5.12, §5.13)

### A step without the declaration sees nothing

Given a gate step with no `input` key, `node ./count-stdin.mjs`, that prints how many bytes it read from stdin before end of file, and no declaring step in the profile, when the gate runs, then the step reads 0 bytes and does not block, the attempt log has no `stdin:` line, and no `checks-attempt-NN.request.json` exists for the attempt. (refs §5.2, §5.20)

### No request when the attempt stops before the declaring step

Given a profile with `pnpm test` (no `input`), which exits 1, followed by a declaring step, when attempt 01 runs, then the attempt stops at `pnpm test`, no `checks-attempt-01.request.json` exists, and `checks-attempt-01.log` has no `stdin:` line. (refs §5.20)

### A log step in a workspace profile may declare it

Given a workspace gate profile with an `"output": "log"` step declaring `"input": "gate-request"`, whose command copies its stdin to a file and exits 0, when the phase's gate runs, then `phax validate` accepts the configuration, the copied file holds the gate request, and the step's result in `gate-attribution.json` is `pass`. The same step exiting 1 is `fail`, and a declaring diagnostics step reporting one finding fails the step, exactly as without the declaration. (refs §5.3, §5.17)

### An unknown input value is refused

Given a `phax.json` whose `gateProfiles.standard[1]` has `"input": "stdin"`, when `phax validate` runs, then it exits 2 with a message naming `gateProfiles.standard[1].input` and the allowed value `gate-request`. (refs §5.4)

### `phax schema upgrade` describes the key

Given a project whose `phax.schema.json` predates this change, when `phax schema upgrade` runs, then the gate step schema in `phax.schema.json` has an `input` property whose only value is `gate-request`, with no default, and `phax.json` is byte-for-byte unchanged. (refs §5.5)

### A single-phase run

Given a one-phase plan whose gate has a declaring step, when phase-01's gate runs, then the request has `terminal` `true`, a `phases` array holding only the entry for phase-01, and `base` equal to the run branch's tip at the time phase-01's branch was created. (refs §5.7, §5.12, §5.13)

### Every fix-loop attempt gets the same request

Given phase-02 with a declaring step that fails on attempts 01 and 02 and passes on 03, with a commit made on the phase-02 branch between attempts 01 and 02, when the three attempts run, then `checks-attempt-01.request.json`, `-02` and `-03` are byte-identical, each equals what the step read on its stdin in that attempt, and `base` is phase-01's commit, not the phase-02 branch's HEAD. (refs §5.14, §5.8, §5.19)

### Base survives a moved source branch

Given phase-02 with a declaring step that fails on attempt 01, after which `<run.branch>--phase-01` is moved to a different commit, when attempt 02 runs, then its request's `base` is still the commit `<run.branch>--phase-01` pointed to when the phase-02 branch was created, and the request is byte-identical to attempt 01's. (refs §5.8, §5.14)

### A resume keeps the request

Given a run stopped with phase-02's gate exhausted after attempts 01 and 02 with a declaring step, when `phax resume <run>` runs the gate again, then the new attempt's request file is byte-identical to `checks-attempt-01.request.json`. (refs §5.14)

### A reset phase takes its base from the new branch

Given a run that failed at phase-02's gate, when `phax reset-phase <run> phase-02` and then `phax resume <run> --yes` run, and phase-02's gate runs again, then the re-run's request names as `base` the tip of `<run.branch>--phase-01` at the time the new phase-02 branch was created. (refs §5.9)

### Appended phases

Given a run in `review_open` whose final phase-03 branch carries a commit made during review, a review plan with phase-04 and phase-05, and a gate with a declaring step, when `phax run <run> --append --plan <review-plan.md>` gates phase-04 and then phase-05, then phase-04's `base` is the review commit at the tip of phase-03's branch. `terminal` is `false` for phase-04 and `true` for phase-05, and both requests list phase-01 through phase-05 in execution order. (refs §5.10, §5.12, §5.13)

### A phase without a known base is refused on resume

Given a run whose phase-02 branch was created by phax 0.19.0 and which stopped before phase-02's gate passed, with a `phax.json` whose gate profile now has a declaring step, when `phax resume <run>` runs under this release, then it exits 1 before any agent turn or gate step of phase-02 runs, with a message naming `phax reset-phase <run> phase-02`. The same run with no declaring step in the profile resumes as before. (refs §5.11)

### A step that ignores stdin neither hangs nor errs

Given a declaring step `node ./ignore-stdin.mjs` that exits 0 at once without reading, on a plan whose projection serializes to more than 128 KiB, when the gate runs, then the step's result is `pass`, the attempt completes with no error, and no step waits on the unread request. (refs §5.16, §5.15)

### A step reading to end of file terminates

Given a declaring step that reads stdin until end of file and writes it to a file, when the gate runs, then the step terminates, and its file is byte-identical to the attempt's `checks-attempt-NN.request.json`. (refs §5.15, §5.19)

### The attempt log marks a declaring step

Given a profile with `pnpm test` (no `input`), which passes, followed by `node ./audit.mjs` declaring `"input": "gate-request"`, when attempt 01 runs, then in `checks-attempt-01.log` the line after `$ node ./audit.mjs` is `stdin: checks-attempt-01.request.json`, and the line after `$ pnpm test` is not a `stdin:` line. (refs §5.18)

### The saved request replays

Given a recorded attempt with `checks-attempt-01.request.json`, whose declaring step echoes its stdin to stdout, when `node ./echo.mjs < checks-attempt-01.request.json` runs, then its output is byte-identical to what the step printed during the gate. (refs §5.19, §5.21)

### The format is published

Given a `checks-attempt-01.request.json` written by phax, when it is passed to `parseGateRequest` and to `parseDocument` from `@lbdremy/phax-schemas`, then both succeed, `parseDocument` identifies `gate-request`, and the package ships `json/gate-request.schema.json`. README §Persisted formats has the `gate-request` row, and the snapshot gate passes with `gate-request/next.schema.json` recorded. (refs §5.21)

### The record carries and shows the request

Given a committed phase whose attempts 01 and 02 each ran a declaring step, with records enabled, when `phax records explain <record commit> --gates` runs, then the record holds both request files. The output prints `--- checks-attempt-01.request.json ---` and its content directly after the attempt-01 log, and likewise for attempt 02. (refs §5.22, §5.23)

### The hello-world audit reads the request

Given the hello-world example, with a request whose `terminal` is `false` and whose `base` is a commit before a file under `src/` that imports `node:fs` was added, when `node ./audit.mjs < request.json` runs in the example's directory, then the example's `phax.json` step `node ./audit.mjs` has `"input": "gate-request"`, and the output is a diagnostics document naming that file. With `base` set to a commit that already contains the file and nothing changed since, the document is `{ "diagnostics": [] }`. (refs §5.24)

## 9. Open questions for implementation planning

### Q1 — What is the declaration's name and shape? (Decided by the author on 2026-10-05; not reopened.)

- `"input": "none" | "gate-request"`, default `"none"` — abandons: Brevity. The key has one real value today, and `"none"` exists only to spell the default.
- `"input": "gate-request"` only, absence meaning none — abandons: An explicit spelling of the default, which `output: "log"` has. A profile cannot say "no input" deliberately.
- `"request": true` — abandons: Room for a second kind of input without a new key, and the symmetry with `output`. A boolean names the feature, not what arrives on stdin.

Recommendation: `"input": "gate-request"` only, absence meaning none — Decided by the author on 2026-10-05. One real value, one spelling: a step reads the request or it has no `input` key. A later input kind becomes a new value of the same key, so the room the enum kept is not lost; only the explicit `"none"` is.

### Q2 — May `output: "log"` steps declare the input, or diagnostics steps only? (Decided by the author on 2026-10-05; not reopened.)

- Any step kind — abandons: A guarantee that the request only reaches steps whose verdict phax reads structurally. Later changes to the request must also consider log consumers phax cannot observe.
- Diagnostics steps only — abandons: Base-aware log steps (tests or linters limited to what changed since `base`). These would be pushed back to flags or environment variables, the channel the author ruled out.

Recommendation: Any step kind — Decided by the author on 2026-10-05, as recommended. The request is input, independent of how the verdict is read. The declaration is opt-in, so a test or lint command that does not want stdin is never touched. Limiting it to diagnostics would recreate, for log steps, the problem this spec fixes.

### Q3 — Does the request also carry the files the phase touched? (Decided by the author on 2026-10-05; not reopened.)

- No: the provider reads git from `base` to the working tree — abandons: Providers that cannot run git in the worktree. Every gate step already runs there, so the loss is theoretical.
- Yes, a `touched` list computed by phax — abandons: Git as the single account of the past. phax would keep a second list in step with git's view of untracked files, renames and deletions, and a disagreement would make the provider's view diverge from the diff.

Recommendation: No: the provider reads git from `base` to the working tree — Decided by the author on 2026-10-05, as recommended. This was decided with the author: "the past from git, the future from the plan". `base` is the one fact git cannot supply, which commit the phase started from. Everything after it is in the worktree the step runs in.

### Q4 — Does each `phases` entry carry anything beyond `id` and `files`? (Decided by the author on 2026-10-05; not reopened.)

- `id` and `files` only — abandons: Titles and objectives a provider could quote in its messages, and an explicit per-phase status.
- Add `title` — abandons: The rule, shared with the plan auditor, that only planned files leave phax. Every plan field sent becomes a contract to freeze.
- Add a status (`committed` / `gated` / `planned`) — abandons: Derivability. Status already follows from each entry's position relative to `phase`, and a stored state could go stale across a resume or reset.

Recommendation: `id` and `files` only — Decided by the author on 2026-10-05, as recommended. This is the same projection the plan auditor already receives, so a provider handles one shape. The first consumer needs only the files later phases still plan, and order relative to `phase` already gives past, present and future.

### Q5 — What is the saved request's file name? (Decided by the author on 2026-10-05; not reopened.)

- `checks-attempt-NN.request.json` — abandons: Self-description outside the gate context: `.request` does not say whose request it is.
- `checks-attempt-NN.gate-request.json` — abandons: The one-word suffix pattern that `.diagnostics.json` follows beside the same log.
- One `gate-request.json` per phase — abandons: Per-attempt locality. Replaying attempt NN means trusting that the request never changed, and the `stdin:` line could not name a file belonging to the attempt.

Recommendation: `checks-attempt-NN.request.json` — Decided by the author on 2026-10-05, as recommended. It sits beside `checks-attempt-NN.log`, whose `checks-` prefix already places it in the gate, and the format id `gate-request` carries the full name in `$schema`. One file per attempt keeps `<command> < file` exact for the attempt it names, at the cost of identical copies.

### Q6 — For an appended phase, which phases does `phases` list? (Decided by the author on 2026-10-05; not reopened.)

- Every phase of the run in execution order: the original plan's phases, then each appended plan's, through the gated phase's plan — abandons: "The plan" meaning one plan document. The projection mixes phases from several plans.
- Only the phases of the plan that planned the gated phase — abandons: One rule for every phase. A provider would see the run's earlier phases vanish from the projection exactly when the run is appended to.

Recommendation: Every phase of the run in execution order: the original plan's phases, then each appended plan's, through the gated phase's plan — Decided by the author on 2026-10-05, as recommended. The future, the part the provider needs from the plan, is the same under both options. Keeping the past phases makes the request of an appended phase the same kind of document as any other: every phase of the run, the gated one included. `base` and git already scope the change.

### Q7 — Where does a phase's `base` come from once its branch exists: on a later fix-loop attempt, on a resume, or after the branch it was created from has moved? (Decided by the author on 2026-10-06; not reopened.)

- phax notes the base when it creates the phase branch and reads it back on every attempt, resume included — abandons: Phases whose branch an earlier release created. They have no noted base, so one that meets a declaring step on resume must be reset first (refused with a message naming `phax reset-phase`). The noted base also becomes persisted phase state.
- phax recomputes it at each gate from git, as the fork point between the phase branch and the branch it was created from — abandons: Base as a fact rather than an inference. Once the source branch moves, is rewritten or is deleted after the phase branched, the fork point silently becomes a different commit, or none. The provider is then handed a wrong past with nothing to tell it so.

Recommendation: phax notes the base when it creates the phase branch and reads it back on every attempt, resume included — Decided by the author on 2026-10-06, as recommended. A wrong base is the one failure the provider cannot detect: it would audit the wrong change and report a confident verdict. The refusal costs only phases already in flight when this lands that also gain a declaring step mid-run. None can exist before this release, since `input` is new, and the no-shims rule already prefers an actionable refusal to a fallback. oracle-phases needs the same fact for its own `base`, so one noted base serves both.

## 10. Implementation-planning note

Settled:

- Declaration: `"input": "gate-request"` on a gate step. It is the only value, and no key means no input. It is accepted with either `output` kind, in `gateProfiles` and `workspaces[].gateProfiles`. An unknown value is a config error (exit 2).
- The request has exactly `$schema`, `phase`, `base`, `terminal` and `phases`. `base` is the full object name of the commit the gated phase's branch was created from. It is noted when the branch is created (Q7) and never re-derived. `terminal` is the `firing: "terminal"` condition. `phases` is every phase of the run in execution order as `{id, files}`, using the plan auditor's projection.
- Every declaring step of every attempt of a phase receives the same request, written to stdin and then closed. Only `$schema` may differ across releases. An unread request is harmless.
- The saved copy is `checks-attempt-NN.request.json`, holding the exact stdin bytes. It is written before the first declaring step of the attempt, and only if one runs. Its format id is `gate-request`, it is parsed by `parseGateRequest`, its schema is `json/gate-request.schema.json` with a `gate-request/next.schema.json` snapshot, and it has a README §Persisted formats row.
- The attempt log gets a `stdin: <request file>` line after the declaring step's `$` line. The request rides the phase record, and `phax records explain --gates` prints it directly after its attempt's log.
- A resumed phase whose branch predates this change, and whose gate would run a declaring step, is refused (exit 1) with a message naming `phax reset-phase`. There is no fallback derivation.
- The hello-world diagnostics step declares the input, and `audit.mjs` reads the request.

Left open:

- Where the noted base is kept. If it lands in a published format (for example `phase-status`), that format gets a `next` shape with the field required, per the no-shims rule. The plan must say what an earlier-release phase folder then looks like to `phax status`, `phax prune` and the records code.
- The JSON formatting of the bytes (indentation, trailing newline). The only constraint is that stdin and the saved file are identical.
- README placement. Recommended: a "Gate request" subsection under §Extend phax, next to Diagnostics gate steps, with the hook intro made true for gate steps that declare the input.
- The phax–steme coordination note (`02-product/phax-steme-coordination.md`, §"The gate request") could not be read from this authoring session. Rows 8 and 9 are reflected as the brief summarizes them, so the planner should cross-check them.

Constraints:

- Lands after `drop-orient` and `drop-gate-scopes`, against the gate they leave. It needs nothing from either beyond their removals.
- Additive. A step without the declaration is spawned exactly as today, with stdin not connected. Nothing about `output`, `firing`, `surface`, the stop at the first failing step, the fix loop or attribution changes.
- phax computes no closure, impact, touched-file list or verdict for the request. Flags and environment variables are not a channel for it.
- Nothing else of the plan leaves phax: the projection is the one the plan auditor already receives.
- Relation to oracle-phases (Approved, not built): its `base` has the same meaning, the commit a phase's branch started from. For an oracle phase's own gate the two coincide. In `discharged` mode the oracle request's `base` is the oracle phase's base, not the gated phase's. The oracle step is not a configured gate step and never receives the gate request. That spec is not changed, but both must read the same noted base.
- `--append` comes from the headless-review spec (Approved, not built). Whichever ships second must honour `r-base-append` and the whole-run rule for `phases`.
- `brief-provider` reuses this request's facts for its own request, so the five key names and meanings fixed here are inherited there.
- Persisted-format rules hold: `$schema` names the writing release, every field is required, and an unreleased shape is recorded as a `next` snapshot by the schemas gate.
- CLI and config freeze (NEXT_STEPS §Road to 1.0.0): this adds a key and a file and breaks nothing.

## 11. Docs page

Page: README §Extend phax › Gate request (with the `gate-request` row in §Persisted formats and the `input` key in the gate step reference)

Reader: The author of a gate-step provider, such as steme's audit, who wants to judge only what the current phase changed and to know which files later phases still plan, without phax deciding what is due.

Example: Declare the step `{ "command": "node ./audit.mjs", "surface": "structural", "firing": "every-phase", "output": "diagnostics", "input": "gate-request" }`. In audit.mjs, read stdin to the end and `JSON.parse` it. Run `git diff --name-only <request.base>`, plus the untracked files, to get what the phase changed. Take the entries of `request.phases` after `request.phase` as what is still planned. When `request.terminal` is true, audit everything. Print `{ "diagnostics": [...] }`. To replay a recorded verdict: `node ./audit.mjs < checks-attempt-01.request.json`.
