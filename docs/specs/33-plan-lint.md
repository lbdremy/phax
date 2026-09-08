---
status: Draft
date: 2026-09-08
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Plan Lint

## 1. Context

A plan is a Markdown document (`plan.md`, usually `docs/plans/NN-<slug>-plan.md`) that
`phax run` turns into its structured form at run start: a deterministic parse of the
Markdown structure first, a model call as a fallback when that parse fails, with the result
cached by content hash. The same extraction is exposed as a standalone command:

    phax extract-plan --plan-md plan.md --out phax-plan.json

It writes `phax-plan.json` and an `extract-report.md` next to it, refuses to overwrite
without `--force`, and may call the model. The README lists it as a step of the canonical
flow ("Extract the plan"); the blog post calls it "a debugging aid"; the vocabulary review
flags "extract" as underselling what it does. In practice the command is what an agent runs
to check that a plan it just wrote is well-formed.

Three other places already know something about a plan before it runs:

- `phax validate --plan <phax-plan.json>` decodes an already-extracted plan against its
  schema.
- `phax run --plan <plan> --dry-run` lists, among other things, the plan's required commands
  not covered by the effective allowed set.
- The run-start preflight rejects a plan that names a model id or effort absent from the
  catalog, or a required command absent from the frozen set. It runs **after** the run folder
  and the registry entry exist.

Each phase declares the files it will create, edit, and may touch. After a phase commits,
phax reconciles those declarations against the actual diff. Nothing reads them before the
run.

## 2. Problem

There is no way to ask "is this plan fit to run?" without side effects and without a model
call. `extract-plan` writes two files, may spend a model call, and hides the reason the
deterministic parse failed behind the fallback's success. It answers only "does the
structure extract?" and says nothing about the plan's relationship to the repository.

Two classes of mistakes are knowable from the plan and the working tree alone, and phax
reports neither before the run:

- A phase lists a file to edit that does not exist and that no earlier phase creates, or a
  file to create that already exists. The executing agent discovers it mid-phase, and the
  end-of-phase reconciliation flags the deviation after the fact.
- A phase names a model id or effort the catalog no longer lists, or the plan declares a
  command the configuration does not grant. The run-start preflight catches both, but only
  after allocating the run: the folder and the registry entry exist, the run stays in
  `created`, and the next attempt gets a `-2` slug. On 2026-09-08 seven of the ten `-2`
  pairs in the local registry had a first attempt containing nothing but the snapshotted
  plan and status files, created less than three minutes before the second.

The agents that write plans need a lint, not a compiler: a report of everything wrong with
the plan that phax can establish mechanically, and nothing else.

## 3. Product goal

One read-only command reports every mechanical defect of a plan that phax can establish
before a run: the structural fields the deterministic extraction requires, the coherence of
the planned file lists with the repository and with each other, and the run-start preflight
conditions. It replaces `extract-plan`, which is removed.

> A plan's mechanical fitness is knowable without a run and without a model call; phax
> reports all of it in one place and never guesses.

## 4. Terminology

- **Plan** — the Markdown document the operator or an agent authored, at any path.
- **Ground** — the working tree of the repository the plan is linted from, at its root.
- **Structural check** — the deterministic extraction, reported as findings instead of
  failing.
- **File-plan check** — the coherence of each phase's planned-file lists with the ground and
  with earlier phases.
- **Known-existing set** — while walking the phases in order: every file present in the
  ground, plus every file an earlier phase lists to create.
- **Run-readiness check** — the conditions the run-start preflight enforces: required
  commands covered, model id and effort listed in the catalog.
- **Finding** — one reported defect, with a severity (`error` or `warning`), the check it
  comes from, the phase it concerns when it concerns one, and a message.

## 5. Functional requirements

### 5.1 Read-only, model-free

WHEN the lint command is invoked THE system SHALL produce its findings without writing any
file, registry entry, or cache entry, and without invoking a model.

### 5.2 Structural check

THE system SHALL run the deterministic extraction on the plan and report each field it
cannot extract as an `error` finding naming the phase (when the field is per-phase) and the
missing or malformed element.

### 5.3 No model fallback

IF the deterministic extraction fails THEN the system SHALL report the failure as findings
and SHALL NOT fall back to model extraction.

### 5.4 Files to edit must be reachable

WHEN a phase lists a file to edit THE system SHALL report an `error` finding unless the file
belongs to the known-existing set at that phase.

### 5.5 Files to create must be new

WHEN a phase lists a file to create THE system SHALL report an `error` finding if the file
belongs to the known-existing set at that phase, naming whether it exists in the ground or
which earlier phase creates it.

### 5.6 A phase cannot both create and edit a file

IF a phase lists the same path both to create and to edit THEN the system SHALL report an
`error` finding naming the phase and the path.

### 5.7 Optional files are not checked

THE system SHALL NOT report findings about a phase's optional files.

### 5.8 Required commands are covered

WHEN the plan declares required commands THE system SHALL report an `error` finding for each
command not covered by the effective allowed set, under the same coverage rule as the
run-start preflight.

### 5.9 Models are in the catalog

WHEN a phase names a model id and effort THE system SHALL report an `error` finding if the
catalog does not list that pair, under the same rule as the run-start preflight.

### 5.10 Exit code follows errors

IF at least one finding has severity `error` THEN the system SHALL exit non-zero; otherwise
THE system SHALL exit zero, whatever the number of `warning` findings.

### 5.11 Machine-readable output

WHERE the JSON flag is given THE system SHALL emit the findings as a single JSON document on
stdout instead of the rendered report.

### 5.12 `extract-plan` is removed

THE system SHALL NOT expose an `extract-plan` command; `phax --usage` SHALL NOT list it.

## 6. Surface

Command (normative, decided in §9 Q1):

    phax plans lint <plan>
    phax plans lint <plan> --json

Rendered report (finding fields and severities normative; wording and layout indicative):

    $ phax plans lint docs/plans/60-foo-plan.md
    docs/plans/60-foo-plan.md: 3 error(s), 1 warning(s)

    error    structure  phase-02  missing "### Planned files to edit" section
    error    files      phase-03  edit src/app/foo.ts: does not exist and no earlier phase creates it
    error    models     phase-04  claude-sonnet-4-5 / high is not in the model catalog
    warning  files      phase-01  create tests/unit/foo.test.ts: also listed under optional files
    $? = 1

    $ phax plans lint docs/plans/61-bar-plan.md
    docs/plans/61-bar-plan.md: no findings
    $? = 0

JSON output (field names indicative; the set {severity, check, phase, message} and the
severity values `error` | `warning` normative; `phase` is null for a plan-level finding):

    {
      "plan": "docs/plans/60-foo-plan.md",
      "findings": [
        { "severity": "error", "check": "structure", "phase": "phase-02",
          "message": "missing \"### Planned files to edit\" section" },
        { "severity": "error", "check": "commands", "phase": null,
          "message": "required command \"deno\" is not covered by security.agentCommands or the gate profile" }
      ]
    }

Check identifiers (normative as a closed set): `structure`, `files`, `commands`, `models`.

`phax --usage`, before → after (help wording indicative; removal of `extract-plan` and
presence of `plans lint` normative per §5.12 and §5.1):

    cmd "extract-plan" {
        help "Extract phax-plan.json from a plan.md by calling Claude Code headlessly"
        flag "--plan-md" { … }  flag "--out" { … }  flag "--force" { … }
        flag "--model" { … }    flag "--effort" { … }  flag "--refresh" { … }
    }
    cmd "plans" {
        cmd "status" { … }
        cmd "overlap" { … }
    }
                                        ▼
    cmd "plans" {
        cmd "status" { … }
        cmd "overlap" { … }
        cmd "lint" {
            help "Report a plan's structural, file-plan and run-readiness defects without running it"
            arg "<plan>" { help "Path to the plan.md" }
            flag "--json" { help "Emit the findings as JSON" }
        }
    }

README canonical flow, before → after (normative that the "Extract the plan" step is
replaced by a lint step; prose indicative):

    ## Write a plan   →   ## Extract the plan   →   ## Run
                                        ▼
    ## Write a plan   →   ## Lint the plan      →   ## Run

## 7. Non-goals

- **No structured plan on disk.** The lint writes nothing; `phax run` keeps snapshotting
  `phax-plan.json` into the run folder, and `phax validate --plan` keeps decoding one at
  any path. An operator who wants the file reads it from the run folder.
- **No change to `phax run` extraction.** The run still extracts inline, with the cache and
  the model fallback. This spec adds no refusal to `run`; a plan that fails the lint can
  still be run, and the existing preflight and reconciliation behave as today.
- **No check of optional files** (§5.7), and no check of file *contents*, line references,
  or the decisions a plan records: that is `adjust-plan`'s job after a landed run.
- **No ground other than the working tree.** The lint does not read git history or a
  baseline commit; staleness against a recorded approval is `plans status`.
- **No external auditor content.** The advisory channel of spec 19 (an external plan
  auditor fed the plan projection) hooks into this command as its "plan finalization"
  point; its registration, projection and findings are specified there, not here.
- **No fix for run allocation before preflight.** The `-2` slug problem is a consequence
  the lint mitigates; the ordering of allocation and preflight in `phax run` is a separate
  follow-up.
- **No warnings taxonomy beyond what the checks produce.** A `warning` is reserved for
  a defect that does not prevent the run (the one shown in §6 is the only one this spec
  requires).

## 8. Acceptance criteria

### Lint leaves no trace

Given any plan, when `phax plans lint <plan>` runs, then no file is written under the
repository, the state root, or the extraction cache, and no model backend is invoked.
(refs §5.1)

### Structural defects are findings, not failures

Given a plan whose phase-02 lacks its "Planned files to edit" section, when `phax plans lint
<plan>` runs, then the report contains an `error` finding with check `structure` and phase
`phase-02` naming that section, and the command does not call the model. (refs §5.2, §5.3)

### Edit of a missing file is an error

Given a plan whose phase-03 lists `src/app/foo.ts` to edit, the file absent from the ground
and created by no earlier phase, when the lint runs, then an `error` finding with check
`files` and phase `phase-03` names the path. (refs §5.4)

### Edit of a file created earlier is clean

Given a plan whose phase-01 lists `src/app/foo.ts` to create and phase-02 lists it to edit,
the file absent from the ground, when the lint runs, then no `files` finding concerns
phase-02. (refs §5.4)

### Create of an existing file is an error

Given a plan whose phase-01 lists `README.md` to create, the file present in the ground,
when the lint runs, then an `error` finding with check `files` and phase `phase-01` names
the path and says it exists. (refs §5.5)

### Create of a file an earlier phase creates is an error

Given a plan whose phase-01 and phase-03 both list `src/app/foo.ts` to create, when the
lint runs, then an `error` finding with check `files` and phase `phase-03` names the path
and phase-01. (refs §5.5)

### Create and edit in one phase is an error

Given a plan whose phase-02 lists `src/app/foo.ts` both to create and to edit, when the lint
runs, then an `error` finding with check `files` and phase `phase-02` names the path.
(refs §5.6)

### Optional files never produce findings

Given a plan whose phase-01 lists under optional files one path that exists and one that
does not, when the lint runs, then no finding concerns either path. (refs §5.7)

### Uncovered required command is an error

Given a plan declaring the required command `deno` and a configuration granting neither
`deno` nor any gate command starting with it, when the lint runs, then an `error` finding
with check `commands` and phase `null` names `deno`. (refs §5.8)

### Unknown model is an error

Given a plan whose phase-04 names a model id absent from the catalog, when the lint runs,
then an `error` finding with check `models` and phase `phase-04` names the id and effort.
(refs §5.9)

### Exit code reflects errors only

Given a plan with one `warning` finding and no `error` finding, when the lint runs, then it
exits 0; given a plan with one `error` finding, when the lint runs, then it exits non-zero.
(refs §5.10)

### JSON output carries the same findings

Given a plan with findings, when `phax plans lint <plan> --json` runs, then stdout is one
JSON document whose `findings` array carries, for each finding, `severity`, `check`,
`phase`, and `message`, and nothing is printed as a rendered report. (refs §5.11)

### extract-plan is gone

Given the installed binary, when `phax extract-plan --plan-md plan.md --out out.json` runs,
then it fails as an unknown command, and `phax --usage` does not mention `extract-plan`.
(refs §5.12)

## 9. Open questions for implementation planning

All four questions were put to the operator on 2026-09-08 and decided as recorded below;
nothing remains open for the planner.

### Q1. Where does the command live, and what is its verb?

- Option A, `phax plans lint <plan>` — abandons: a top-level verb agents might guess
  first; the `plans` group is a reporting namespace, and this is a report on one plan.
- Option B, `phax plans check <plan>` — abandons: a clean separation from the gate
  vocabulary, where "checks" already names the per-attempt gate artifacts
  (`checks-attempt-NN.*`).
- Option C, top-level `phax lint-plan <plan>` — abandons: the existing grouping;
  `plans status` and `plans overlap` are the two other read-only plan reports, and a third
  belongs with them.

Recommendation: Option A. "Lint" says exactly what it is, a report with severities on a
document, and the group is the one that already holds plan reports.

Decision (2026-09-08): Option A. The verb `lint` in §6 is now normative.

### Q2. Is the file-plan ground the working tree or `HEAD`?

- Option A, the working tree — abandons: reproducibility against a commit; an uncommitted
  file counts as existing.
- Option B, `HEAD` — abandons: the plan-authoring loop, where the agent that just wrote a
  scaffold file and the plan naming it has not committed yet.

Recommendation: Option A. The lint is run from the checkout the run will branch from, and
the authoring loop is the primary use.

Decision (2026-09-08): Option A.

### Q3. Do errors set the exit code, or is the lint a pure report like `plans status`?

- Option A, non-zero on errors — abandons: uniformity with `plans status`, which exits 0
  whether or not plans are stale.
- Option B, always exit 0 — abandons: the one signal an agent or a script reads without
  parsing output.

Recommendation: Option A. `plans status` is a periodic survey; a lint is asked about one
document and its answer is a verdict.

Decision (2026-09-08): Option A.

### Q4. Do the run-readiness checks belong here, or only structure and files?

- Option A, include `commands` and `models` — abandons: a strict "plan versus repository"
  scope; the lint now also reads the configuration and the catalog.
- Option B, structure and files only — abandons: catching, before the run is allocated,
  the two preflight failures that produced most of the orphan `created` runs.

Recommendation: Option A. Both checks already exist as pure functions used by the run
preflight; reusing them costs nothing and the orphan-run problem is the concrete pain.

Decision (2026-09-08): Option A.

## 10. Implementation-planning note

Settled: one read-only, model-free command; findings with a closed severity set and a closed
check set; the sequence-aware file-plan rule over the known-existing set; the exit code
follows `error` findings; `extract-plan` is removed rather than kept as an alias.

Deliberately open: the rendered layout and wording, and the JSON field spellings marked
indicative in §6.

Constraints the plan must respect: the structural check is the existing deterministic
parser reported as findings, not a second parser; the run-readiness checks are the same
functions the run-start preflight calls, so lint and run cannot disagree; the file-plan
walk reads the same planned-file lists that end-of-phase reconciliation reads. Removing
`extract-plan` sweeps its every mention: the README flow, the `phax-planning`, `phax-cli`
and `phax-spec` skills, `docs/cli/`, the usage spec, the e2e test, and the run's "run
`phax extract-plan`" hint on a cache miss. Spec 19's handoff fires inside this command;
that spec's "no new command" line is revised to name it. The acceptance criteria become one
test each; the file-plan criteria are domain unit tests over an in-memory ground.
