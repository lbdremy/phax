---
status: Approved
date: 2026-11-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-24
  baseline: 937fe5e
---
# Format stability promise: the rules by which persisted shapes change

## 1. Context

phax registers 46 persisted formats. Every document of one of them carries a `$schema` stamp, `https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json`, which names the format and the release that last changed its shape, not the build that wrote it. At each release cut, every changed format's `next` snapshot is renamed to the release, so each shape a release wrote stays frozen as a snapshot. The cut then regenerates `CURRENT_SHAPES` and `FIRST_SUPPORTED_RELEASE`, which is 0.17.0 today.

Two kinds of reader read these documents:
- `@lbdremy/phax-schemas` reads every shape at or below its own release down to the floor. It lifts older shapes to the current one in memory through its `toLatest*` functions, and a fact an older shape never recorded reads as `{ "kind": "unknown" }`. It refuses a newer stamp: `code-review 0.40.0 is newer than @lbdremy/phax-schemas 0.39.0 — upgrade the package`.
- The phax binary refuses a newer stamp too: `<format> <release> is newer than this phax (<running>) — upgrade phax to read it`. It reads older `$schema` shapes for only some formats (phax-plan, the spec and plan documents, the approval records, run and phase status, the registry, the reviews, several record manifests). It reads the reports providers and gate steps print (`gate-report`, `brief-report`, `architecture-report`) and the provider answers only at their current shape. The 2026-10-08 rule says that from 1.0 an older answer is read through its frozen shape and lifted, and that the guard tests holding each answer reader to one shape must then fail and name that rule.

Configuration (`phax.json`, `phax.local.json`, the provider and model-routing files) carries no release stamp. `phax.json`'s `$schema` points at the local editor schema, beside `version: 1`.

`docs/upgrading.md` lists, release by release, every time a reader refused an older or newer document and what to do:
- 0.38.0 asked for a one-time `phax artifact migrate-documents` before approve, reopen, decide and revise would run again, and refused to resume a run started by 0.37.0;
- 0.41.0 refused the old provider and model-routing files until they were rewritten;
- 0.38.0, 0.40.0 and 0.43.0 each told package consumers that an older `@lbdremy/phax-schemas` refuses the new shapes.

The 1.0 item in `NEXT_STEPS.md` was written at 0.14.0, before stamps existed. It asked to freeze `version: 1` and the formats, with a migration for whatever moved. The operator dropped that idea on 2026-11-19.

Ground read:

- `docs/briefs/format-stability-promise.md` — The brief: the operator's 2026-11-19 reframing, the gaps stamps leave, what to decide.
- `docs/release.md` — The opened version, the cut (snapshots renamed from `next`, `CURRENT_SHAPES`, `FIRST_SUPPORTED_RELEASE`), the stamp rule, and the cut's refusals and warnings, among them the warning only when `docs/upgrading.md` has no entry for the version.
- `packages/schemas/src/shapes.ts` — `defineFormat`: the package refuses a stamp newer than itself (`… — upgrade the package`), refuses a stamp below `FIRST_SUPPORTED_RELEASE` as a development build, reads every release-named shape at or below the stamp, and keeps `RETIRED_FORMATS`. `UNKNOWN` marks a fact an older shape never recorded.
- `packages/schemas/src/generated/index.ts` — `FIRST_SUPPORTED_RELEASE` is 0.17.0 today.
- `src/schemas/schemaUrl.ts` — The 46 registered formats (`FORMAT_IDS`) and the ones born with `$schema`.
- `src/schemas/persisted.ts` — phax refuses a stamp newer than itself (`<format> <release> is newer than this phax (<running>) — upgrade phax to read it`), reads older `$schema` shapes for only some formats (otherwise only its current decoder), and reads provider reports (`gate-report`, `brief-report`, `architecture-report`) only at their current shape.
- `docs/upgrading.md` — Release-by-release steps: 0.38.0's one-time `phax artifact migrate-documents` and its refusal to resume runs started by 0.37.0, 0.41.0's refused provider and model-routing configuration, the repeated `An @lbdremy/phax-schemas before X refuses them, so upgrade the package`.
- `README.md` — Its paragraph "A file stays readable as phax evolves" about the package's `toLatest*` lifts.
- `docs/property-tests.md` — The `reads every frozen shape` and `registers a frozen shape for every module of its history` properties.
- `NEXT_STEPS.md` — Road to 1.0.0: the stability promise as reframed on 2026-11-19, the provider answers rule decided 2026-10-08, and the CLI contract freeze kept as a separate item.
- `docs/briefs/archive/auto-migrate.md` — Abandoned 2026-10-19 as too complex: a migration catalogue, automatic migrations at use, a version record. Not to be built again.
- `docs/briefs/archive/upgrade-hints.md` — Abandoned with auto-migrate: hint lines naming pending migration commands. Not to be built again.
- `phax.json` — Configuration carries `$schema: ./phax.schema.json` (the local editor schema) and `version: 1`, not a release stamp.

## 2. Problem

Stamps let shapes keep changing, because a reader always knows which shape it holds. But no rule says what an upgrade may stop reading, so a 1.0 user cannot foresee:
- **Newer documents, older readers.** Two people or two machines on different releases share `phax/records/v1`, and the older one stops reading the newer one's records. Nothing written tells them this is expected, or that upgrading is the whole remedy. A consumer of the package must upgrade in step with phax, and learns it only from a refusal.
- **The floor can move, and nothing says when.** `FIRST_SUPPORTED_RELEASE` exists, but no rule says when it moves. A minor upgrade could stop reading records already on an append-only branch, which no migration can rewrite.
- **One-time steps can come back.** Nothing stops a minor release from asking for a one-time `migrate-documents`-like step again, blocking approve or decide until someone runs it.
- **phax reads fewer shapes than the package.** The package reads every frozen shape. phax reads older shapes for only some formats, and answers and reports at the current shape only. Whether an older document reads depends on which reader you hold.
- **Nothing checks that a shape change is documented.** A release can change a format's shape without its upgrading entry naming the format: the cut only warns when the entry is missing.
- **Configuration has no promise and no stamp.** It is the file every user edits, yet 0.41.0 refused the old provider files outright.

What 1.0 would be lying about, without this spec, is not a format that changed but a change the user could not foresee.

## 3. Product goal

From 1.0.0, phax promises the rules by which its persisted documents change, not that their shapes are frozen:
1. every document is stamped;
2. phax and `@lbdremy/phax-schemas` read every shape from a declared floor up to their own release;
3. the floor, and any one-time step, move only at a breaking release;
4. within a breaking line a shape change only adds: removing or renaming a field, a variant or a format waits for a breaking release;
5. every shape change ships with its snapshot and an upgrading entry naming the format;
6. whatever a reader cannot read is refused by name, with its remedy.

The promise is written on one docs page that users read, and tests and the release cut hold phax to it, so a rule cannot be broken without a red check.

> A shape may change at any release; what a reader stops reading changes only at a major, and is always refused by name with its remedy.

## 4. Terminology

- **Registered format** — A persisted document format listed in phax's format registry, whose documents carry a `$schema` stamp `https://docs.phax.run/schemas/<format-id>/<X.Y.Z>.json`. The 46 formats of today, retired ones included.
- **Shape** — One version of a registered format's structure. It is named by the release that introduced it (or `pre-schema` for a document written before stamps existed), and frozen as a snapshot when a release is cut.
- **Reader** — The phax binary or the `@lbdremy/phax-schemas` package, each at one release.
- **Floor** — The oldest shape a reader reads. Today it is 0.17.0, plus the `pre-schema` shape of each format written before stamps (`FIRST_SUPPORTED_RELEASE`). A document stamped below the floor is refused.
- **Breaking release** — A major release (X.0.0) from 1.0.0 on. Before 1.0.0, any minor release, following semver's 0.x rule. Every other release is non-breaking.
- **Stability class** — Exactly one per registered format: `durable` (phax writes it and reads it back across releases: records, approval records, spec and plan sidecars, a run's status, registry, ledgers and reviews), `published` (phax writes it for another program and never reads it back: the stamped `--json` answers such as `run-list`, `artifact-status` and `finding-list`, and the requests phax writes on a provider's stdin), or `answer` (another program writes it for phax to read: provider answers, the reports a gate step or a provider prints, decide verdicts).
- **Lift** — Reading a document through the frozen schema of its own shape, then converting it in memory to the current shape. A fact the older shape never recorded reads as `{ "kind": "unknown" }` and is never invented. A lift is total when it succeeds on every document valid in its shape.
- **One-time step** — A command a person must run once after an upgrade before some other command works again, such as 0.38.0's `phax artifact migrate-documents`.
- **Non-blocking document upgrade** — A command that rewrites the repository's `durable` documents (spec and plan sidecars, approval records) to the current shape, filling what it can compute from what each document holds and writing `{ "kind": "unknown" }` for the rest. It never rewrites the records on `phax/records/v1`, and no command refuses to run, warns or asks for it when it has not been run. Unlike a one-time step, nothing waits for it.
- **In-flight run** — A run that has started and has not finished. Its status files describe the run while it is still being driven.

## 5. Functional requirements

### 5.1 Every format has one stability class

The system shall give every registered format exactly one stability class: `durable`, `published` or `answer`.

### 5.2 Every document is stamped

The system shall stamp every document it writes of a registered format with a `$schema` naming the format and the release of its current shape.

### 5.3 A shape change ships with its snapshot and its upgrading entry

IF a release is cut in which a registered format's shape changed, and either the shape has no snapshot or the release's `docs/upgrading.md` entry does not name the format THEN the release cut SHALL refuse before writing anything, naming the format and what is missing.

### 5.4 Both readers read every durable shape since the floor

phax and `@lbdremy/phax-schemas` shall each read every document of a `durable` format stamped at any shape from the floor up to their own release, lifted to the current shape.

### 5.5 The package reads every published shape since the floor

`@lbdremy/phax-schemas` shall read every document of a `published` format stamped at any shape from the floor up to its own release.

### 5.6 From 1.0, phax reads every answer shape since the floor

WHILE phax's release is 1.0.0 or later THE system SHALL read every document of an `answer` format stamped at any shape from the floor up to its own release, lifted to the current shape.

### 5.7 Every lift is total

Each lift from a shape at or above the floor shall succeed on every document valid in that shape, giving `{ "kind": "unknown" }` for a fact the shape never recorded.

### 5.8 Within a breaking line a shape only adds

WHILE two releases share a breaking line THE system SHALL give every field the newer shape gains, for a document in the older shape, a value the lift computes from what the document holds or the explicit `{ "kind": "unknown" }`, never an invented value and never an optional field.

### 5.9 Removing or renaming waits for a breaking release

IF a non-breaking release's new shape drops or renames a field, a variant or a format of the previous shape THEN the release cut SHALL refuse before writing anything, naming the format and the field, variant or format removed.

### 5.10 No one-time step between breaking releases

WHEN a command that rewrites a `durable` document meets it in an older shape at or above the floor THE system SHALL carry out the command without asking for a one-time step.

### 5.11 A non-blocking document upgrade may ship at any release

WHERE a release, breaking or not, ships a non-blocking document upgrade THE system SHALL name it in that release's `docs/upgrading.md` entry, and every other command SHALL give the same answer whether or not it was run.

### 5.12 The floor moves only at a breaking release

IF a non-breaking release would raise the floor, stop reading a shape at or above it, or retire a format whose shapes are at or above it THEN the release cut SHALL refuse before writing anything, naming the format and the shape.

### 5.13 The 1.0 floor is today's floor

The floor of phax 1.0.0 and `@lbdremy/phax-schemas` 1.0.0 shall be 0.17.0, together with the `pre-schema` shape of every format written before stamps.

### 5.14 A newer document is refused by name

IF a reader meets a document stamped at a release newer than its own THEN it SHALL refuse the document, naming its format, the stamp's release, the reader's release, and the remedy to upgrade that reader to the stamp's release or later.

### 5.15 A document below the floor is refused by name

IF a reader meets a document stamped below its floor THEN it SHALL refuse the document, naming its format, the stamp's release, the floor, and the last release line that reads it.

### 5.16 Mixed releases on one records branch

WHEN a command reading the records of `phax/records/v1` meets records stamped newer than phax THE system SHALL refuse the command, naming how many records are newer and the newest release they need.

### 5.17 A run is finished by the shapes that started it

IF `phax resume` is given a run whose in-flight files are stamped in a shape older than the running release's current shape THEN the system SHALL refuse with exit 12, naming the release that started the run and the two remedies: finish it with that release, or archive it with `phax archive <run> --force` and run its plan again.

### 5.18 Configuration accepted within a major stays accepted

WHILE the running release and an earlier release share a breaking line THE system SHALL accept every configuration file the earlier release accepted, except for a value taken from the providers' model catalog (a model id, an effort), which is not a configuration key.

### 5.19 A configuration key dropped at a major is refused by name

IF a configuration file holds a key that a breaking release stopped accepting THEN the system SHALL refuse it, naming the key and what to write instead.

### 5.20 A retired model is refused at any release

WHEN a configuration file names a model or an effort that the running release's catalog no longer lists THE system SHALL refuse it, naming the model and the model to write instead, at any release.

### 5.21 The promise is written where users read

The system shall publish the promise as a docs page that states its rules and lists every registered format with its stability class, linked from the README, from `docs/upgrading.md` and from the docs site's navigation.

## 6. Surface

### file: docs/format-stability.md — indicative

Summary: Anyone adopting phax 1.0 or reading its files with `@lbdremy/phax-schemas` can read, on one page, what an upgrade may change in those files, what it never stops reading, and what to do when a reader refuses one.

    # Format stability

    From phax 1.0.0, a file or record phax writes may change shape at any
    release. These rules say how:

    1. Every document carries a `$schema` stamp: its format, and the release
       that last changed its shape.
    2. phax and @lbdremy/phax-schemas read every shape from the floor
       (today 0.17.0) up to their own release.
    3. The floor moves, and a step that commands wait for can be asked for,
       only at a major.
    4. Within a major a shape only adds: a field an older document lacks reads
       as computed from it or `unknown`. Removing or renaming waits for a major.
    5. A shape change ships with its snapshot and a docs/upgrading.md entry
       naming the format.
    6. A document a reader cannot read is refused by name, with the remedy.
       On a shared phax/records/v1, every reader must be as new as the newest writer.

    A document upgrade nothing waits for may ship in any release: it rewrites
    spec and plan sidecars and approval records to the current shape, never
    phax/records/v1, and every command answers the same whether you ran it or not.

    A model or effort a provider retired can stop being accepted in a minor
    release, refused by name with the model to write instead.

    | Format                | Class     | Read by                           |
    | --------------------- | --------- | --------------------------------- |
    | phase-record-manifest | durable   | phax and the package              |
    | run-list              | published | the package                       |
    | gate-report           | answer    | phax (every shape from 1.0.0)     |
    | …                     |           |                                   |

### file: docs/upgrading.md — normative

Summary: Each release entry names, in backticks, every format whose shape the release changed, so a reader of the upgrade notes knows which files and records moved.

before:

    ### 0.43.0

    - **`gate-attribution.json` and `checks-attempt-NN.attribution.json` move to a new shape**, stamped 0.43.0, with a required `time` on the attempt, on every step and on a non-null `protectedPaths` …
    - **An `@lbdremy/phax-schemas` before 0.43.0 cannot read the new attributions**, so upgrade the package.

after:

    ### 1.3.0

    - **`gate-attribution` moves to a 1.3.0 shape** (`gate-attribution.json`, `checks-attempt-NN.attribution.json`), with a required `time` on every step. Older shapes still read, with their times `unknown`.
    - **An `@lbdremy/phax-schemas` before 1.3.0 cannot read it**, so upgrade the package.

### cli: scripts/release.sh — indicative

Summary: A maintainer cutting a release is stopped before anything is written when a changed format has no upgrading entry naming it, when a non-major release would stop reading a shape at or above the floor, or when a non-major release drops or renames a field.

    $ scripts/release.sh 1.3.0
    ✗ 1.3.0 changes the shape of gate-attribution, but the ### 1.3.0 entry of docs/upgrading.md does not name `gate-attribution`

    $ scripts/release.sh 1.4.0
    ✗ 1.4.0 is not a major release, yet it stops reading phase-status 1.0.0 — the floor moves only at a major

    $ scripts/release.sh 1.4.0
    ✗ 1.4.0 is not a major release, yet its phase-status shape drops the field `stop` of 1.3.0 — a field is removed or renamed only at a major

### cli: refusal of a document newer than phax — indicative

Summary: A person on an older phax who meets a newer document or record sees which one, which release wrote its shape, and which release to upgrade to, and on a shared records branch one line covering every newer record.

before:

    run-status 1.4.0 is newer than this phax (1.3.0) — upgrade phax to read it

after:

    run-status 1.4.0 is newer than this phax (1.3.0) — upgrade phax to 1.4.0 or later to read it

    $ phax records list
    ✗ 3 records on phax/records/v1 are newer than this phax (1.3.0), the newest at 1.4.0 — upgrade phax to 1.4.0 or later
    $? = 1

### package: @lbdremy/phax-schemas — indicative

Summary: A program reading phax files with the package gets every shape from the floor up, lifted to the current one, and a refusal naming the release to upgrade to, or the release line that still reads a document below the floor.

before:

    parsePhaseStatus(doc)
    // { ok: false, path: "$schema", message: "phase-status 1.4.0 is newer than @lbdremy/phax-schemas 1.3.0 — upgrade the package" }
    // { ok: false, path: "$schema", message: "https://docs.phax.run/schemas/phase-status/0.16.0.json was written by a development build of phax before 0.17.0, the first supported release — not supported" }

after:

    parsePhaseStatus(doc)
    // { ok: false, path: "$schema", message: "phase-status 1.4.0 is newer than @lbdremy/phax-schemas 1.3.0 — upgrade the package to 1.4.0 or later" }
    // after a 2.0.0 that raised the floor:
    // { ok: false, path: "$schema", message: "phase-status 1.4.0 is below the floor of @lbdremy/phax-schemas 2.0.0 (2.0.0) — read it with @lbdremy/phax-schemas 1.x" }

### cli: phax resume — indicative

Summary: A person resuming a run that an older release started, across a shape change, is told which release started it and how to finish or replace it, instead of meeting a decoding error.

    $ phax resume auth-flow
    ✗ run auth-flow was started by phax 1.2.0, and its phase-status is a 1.2.0 shape; phax 1.3.0 resumes only runs in its own shapes
      finish it with phax 1.2.0, or archive it (phax archive auth-flow --force) and run its plan again
    $? = 12

### config: phax.json and phax.local.json — indicative

Summary: A configuration file accepted by one 1.x release is accepted by every later 1.x release; a key is renamed or removed only at a major, and a model a provider retired is refused at any release, each by name with what to write instead.

before:

    // 0.41.0: the old model-routing keys are refused within a minor upgrade
    { "phax-mistral-medium-3.5-off": { … }, "phax-mistral-medium-3.5-high": { … } }

after:

    // phax.json accepted by phax 1.0.0
    { "$schema": "./phax.schema.json", "version": 1, "name": "app", … }
    // phax 1.7.0: accepted as is
    // phax 2.0.0, if it renames a key: refused, naming the key and what to write instead
    // any release, once a provider retired a model it names:
    ✗ model "acme-large-2" is no longer in the catalog — write "acme-large-3" instead

## 7. Non-goals

- The CLI contract (command names, flags, exit codes, printed text, and the `--json` answers that carry no stamp): its freeze is the separate 1.0 item.
- Freezing any shape, or `phax.json`'s `version: 1`. Shapes keep changing between releases.
- Forward compatibility: an older reader reading the fields it knows of a newer document.
- Resuming an in-flight run across a shape change.
- Automatic migrations, install hooks, upgrade hint lines, a migration catalogue or a last-seen version record, as in the abandoned `auto-migrate` and `upgrade-hints` briefs.
- Any network call at read time, such as fetching a schema from docs.phax.run.
- Optional fields, permissive enums or ignored keys inside a shape as a compatibility device: new fields stay required and enums explicit per variant.
- Rewriting or migrating records already on `phax/records/v1`.
- Deciding where a future 2.0.0 puts its floor.

## 8. Acceptance criteria

### Every format has a class on the page

Given phax's format registry and `docs/format-stability.md`, when the format-stability test runs, then every registered format, retired ones included, has exactly one class among `durable`, `published` and `answer`, and appears in the page's table with that class. A format added without a class, or missing from the table, fails the test naming the format. (refs §5.1, §5.21)

### Every writer stamps

Given each writer of a registered format, when it writes a document, then the document carries `$schema` naming that format and the release of its current shape. A registered format written without a stamp fails a test naming the format. (refs §5.2)

### A shape change without its upgrading entry stops the cut

Given an opened version 1.3.0 whose `gate-attribution` shape differs from its last released shape, and a `### 1.3.0` entry of `docs/upgrading.md` that does not name `gate-attribution`, when `scripts/release.sh 1.3.0` cuts, then it refuses before writing anything, naming `gate-attribution` and the `### 1.3.0` entry. The same cut, with the entry naming `gate-attribution`, goes ahead. (refs §5.3)

### A shape change without its snapshot stops the cut

Given an opened version in which a registered format's current shape has no snapshot, when the release is cut, then it refuses before writing anything, naming the format. (refs §5.3)

### phax reads every durable shape since the floor

Given a generated document of each `durable` format in every shape from the floor (`pre-schema` included where the format has one) to the current one, when phax reads it, then it reads as the current shape, a fact the older shape never recorded being `{ "kind": "unknown" }`, and the file is not rewritten. (refs §5.4)

### The package reads every durable shape since the floor

Given the same generated `durable` documents, when `@lbdremy/phax-schemas` parses each and lifts it with the format's `toLatest*`, then each parses as its own shape and lifts to the current one. (refs §5.4)

### The package reads every published shape since the floor

Given a generated document of each `published` format, among them `run-list`, `artifact-status` and `finding-list`, in every shape from the floor to the current one, when `@lbdremy/phax-schemas` parses it, then it parses as its own shape. (refs §5.5)

### From 1.0, an older answer is read and lifted

Given phax at release 1.0.0 or later, and a `gate-report` printed by a gate step in an older shape at or above the floor, when the gate step runs, then phax reads the report and lifts it to the current shape. Before 1.0.0 the guard tests still hold each answer reader to one shape, and at an opened 1.0.0 they fail, naming the 2026-10-08 provider answers rule, until each answer reader reads every shape since the floor. (refs §5.6)

### Every lift is total

Given generated documents valid in each frozen shape at or above the floor, for every registered format with an older shape, when each is lifted to the current shape, then none is refused, and each fact the older shape never recorded reads `{ "kind": "unknown" }`. (refs §5.7)

### A non-major release that drops or renames a field stops the cut

Given an opened version 1.4.0 whose new `phase-status` shape drops the field `stop` of the 1.3.0 shape, or renames it, when `scripts/release.sh 1.4.0` cuts, then it refuses before writing anything, naming `phase-status` and `stop`. The same change at an opened 2.0.0 goes ahead, and a 1.4.0 shape that only adds a required field, which the lift fills from what a 1.3.0 document holds or with `{ "kind": "unknown" }`, goes ahead too. (refs §5.8, §5.9)

### An older sidecar needs no one-time step

Given a repository whose plan sidecar is stamped in an older `plan-document` shape at or above the floor, when `phax artifact approve`, `phax artifact reopen`, `phax artifact decide` or `phax artifact revise` runs on it, then the command completes without naming `phax artifact migrate-documents` or any other one-time step. (refs §5.10)

### A non-blocking document upgrade changes no other answer

Given a non-breaking release that ships a non-blocking document upgrade named in its `docs/upgrading.md` entry, and a repository whose spec and plan sidecars and approval records are in older shapes at or above the floor, when `phax artifact status`, `phax plans lint` and `phax records list` run before the upgrade and again after it, then each gives the same answer both times, and none refuses, warns or names the upgrade before it was run. The upgrade rewrites the sidecars and approval records to the current shape, with `{ "kind": "unknown" }` where it cannot compute a value, and `phax/records/v1` is unchanged. (refs §5.11)

### A non-major release cannot move the floor

Given an opened version 1.4.0 that raises the floor, or drops the frozen shape `phase-status` 1.0.0, or retires a format with shapes at or above the floor, when `scripts/release.sh 1.4.0` cuts, then it refuses before writing anything, naming the format and the shape. The same change at an opened 2.0.0 goes ahead. (refs §5.12)

### 1.0.0 reads what 0.x wrote

Given a phase record manifest stamped 0.17.0 and a `registry` with no `$schema`, when phax 1.0.0 and `@lbdremy/phax-schemas` 1.0.0 read them, then both read them, and both report the floor as 0.17.0. (refs §5.13)

### A newer document is refused with its remedy

Given phax and `@lbdremy/phax-schemas` at 1.3.0, and a `run-status` stamped 1.4.0, when each reads it, then each refuses it, naming `run-status`, `1.4.0`, `1.3.0` and the reader to upgrade to 1.4.0 or later: phax names phax, and the package names `@lbdremy/phax-schemas`, at `$schema`. (refs §5.14)

### A document below the floor is refused with its remedy

Given a reader whose floor is set to 2.0.0, and a `phase-status` stamped 1.4.0, when it reads the document, then it refuses it, naming `phase-status`, `1.4.0`, the floor `2.0.0` and the 1.x release line as the one that reads it. (refs §5.15)

### An older phax on a shared records branch

Given `phax/records/v1` holding records at shapes phax 1.3.0 reads and three records stamped 1.4.0, when phax 1.3.0 runs `phax records list`, then it exits non-zero, lists nothing, and names the three newer records and 1.4.0 as the release to upgrade to. (refs §5.16)

### A run started before a shape change is not resumed

Given an in-flight run whose `phase-status` is stamped in an older shape than the running release's current one, when `phax resume <run>` runs, then it exits 12, naming the release that started the run and both remedies (finish it with that release, or `phax archive <run> --force` and run its plan again). `phax ls` still lists the run. (refs §5.17, §5.4)

### A 1.x configuration stays accepted through 1.x

Given the configuration files accepted by the configuration cases at 1.0.0 (`phax.json`, `phax.local.json` and the provider and model-routing files), when a later 1.x release reads each, then each is accepted, unless it names a model or an effort that release's catalog no longer lists. A non-breaking release that would refuse one for any other reason fails a test naming the file and the key. (refs §5.18)

### A key dropped at a major is refused by name

Given a breaking release that renamed a configuration key, and a `phax.json` holding the old key, when phax reads the file, then it refuses it, naming the old key and the key to write instead. (refs §5.19)

### A retired model is refused in a minor release

Given a non-breaking release whose catalog no longer lists the made-up model `acme-large-2` and lists `acme-large-3` in its place, and a `phax.json` that the previous release accepted naming `acme-large-2`, when phax reads the file, then it refuses it, naming `acme-large-2` and `acme-large-3` as the model to write instead. (refs §5.20, §5.18)

### The promise is linked where users read

Given the built docs site and the repository, when the README, `docs/upgrading.md` and the site's navigation are read, then each links to the format-stability page, and the page states the six rules, the difference between a step commands wait for and a non-blocking document upgrade, and that a model a provider retired can stop being accepted in a minor release, and lists every registered format with its class. (refs §5.21)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-floor-at-one — At 1.0.0, where does the floor sit?

- keep-0-17 — Keep today's floor, 0.17.0 plus the `pre-schema` shapes, through every 1.x release — abandons: Every 0.x frozen decoder and lift is carried for the whole 1.x line.
- raise-to-1 — Raise the floor to 1.0.0 at the 1.0 cut — abandons: Every 0.x record on `phax/records/v1` and every 0.x approval record becomes unreadable by 1.x, and an append-only records branch cannot be migrated.

Recommendation: keep-0-17 — Records are append-only history that no step can rewrite, so raising the floor at 1.0 would strand them for good. Carrying the 0.x lifts costs code that already exists and is already tested by `reads every frozen shape`. R-floor-one is written to this recommendation.

Decision: keep-0-17 — by operator (Rémy Loubradou), 2026-11-24
Why: Records are append-only history that no step can rewrite, so raising the floor at 1.0 would strand them for good. Carrying the 0.x lifts costs code that already exists and is already tested by `reads every frozen shape`. R-floor-one is written to this recommendation. Advocate: Raising the floor to 1.0.0 lets the project delete every 0.x frozen decoder and lift at once, so 1.x starts with a small, fully tested reader surface instead of carrying pre-release history for the whole line. Principles: S1, S5. Reversibility: costly. Revised: none.

### q-floor-moves — After 1.0, when may the floor move?

- major-only — Only at a major release — abandons: A lift, once written, is kept for a whole major line, and after a major raises the floor, older records need a reader of the previous line.
- window — A window: every shape of the last N minor releases — abandons: A minor upgrade can strand records older than the window, which brings one-time migration steps back.
- never — Never — abandons: Frozen decoders and lifts grow without bound, and a shape that cannot be lifted totally can never be retired.

Recommendation: major-only — A major is the one release a user already expects to read notes for, and the refusal below the floor names the release line that still reads the document, so no document is lost: it needs the older reader. A window would make an ordinary minor upgrade strand records. R-floor-moves and R-below are written to this recommendation.

Decision: major-only — by operator (Rémy Loubradou), 2026-11-24
Why: A major is the one release a user already expects to read notes for, and the refusal below the floor names the release line that still reads the document, so no document is lost: it needs the older reader. A window would make an ordinary minor upgrade strand records. R-floor-moves and R-below are written to this recommendation. Advocate: A window of the last N minors bounds the code carried for old shapes continuously, without waiting for a major, so the reader surface never grows past what a recent upgrader needs. Principles: S1, S3. Reversibility: costly. Revised: none.

### q-newer — What does a reader do with a document stamped newer than itself?

- refuse — Refuse it by name with the remedy to upgrade, as today — abandons: An older reader gets nothing out of a newer document, not even the fields it knows, so people sharing a records branch must upgrade in step.
- read-known — Read the fields it knows and ignore the rest — abandons: Strict decoding: unknown keys pass, and phax's next write of the document silently drops the fields the newer shape added.

Recommendation: refuse — Reading only known fields would make every decoder permissive, against the no-shim rule, and turns a visible refusal into silent data loss on the next write. A stamp names the release that last changed the shape, so an older reader is refused only across a real shape change, and upgrading is always a complete remedy. R-newer is written to this recommendation.

Decision: refuse — by operator (Rémy Loubradou), 2026-11-24
Why: Reading only known fields would make every decoder permissive, against the no-shim rule, and turns a visible refusal into silent data loss on the next write. A stamp names the release that last changed the shape, so an older reader is refused only across a real shape change, and upgrading is always a complete remedy. R-newer is written to this recommendation. Advocate: Reading the known fields keeps an older teammate or script useful on a shared records branch instead of locking them out until they upgrade. Principles: S1, S3. Reversibility: costly. Revised: none.

### q-mixed — When a command reading many records meets some stamped newer than phax, what does it do?

- refuse-command — Refuse the whole command, naming how many records are newer and the release they need — abandons: An older teammate cannot list or explain anything on the branch until they upgrade.
- skip-and-name — Show what it reads and name each record it skipped — abandons: A complete answer: a person or script acts on a history missing its newest records (finding fates, decisions, revisions) after reading past a warning.

Recommendation: refuse-command — The remedy is single and cheap (upgrade), and the docs state that every reader of a shared branch must be as new as its newest writer. A partial history that looks complete is worse than a refusal, especially for `--json` consumers who do not read stderr. R-mixed is written to this recommendation.

Decision: refuse-command — by operator (Rémy Loubradou), 2026-11-24
Why: The remedy is single and cheap (upgrade), and the docs state that every reader of a shared branch must be as new as its newest writer. A partial history that looks complete is worse than a refusal, especially for `--json` consumers who do not read stderr. R-mixed is written to this recommendation. Advocate: Showing what can be read and naming each skipped record lets an older teammate keep working with most of the history instead of being blocked entirely. Principles: S3, S1. Reversibility: cheap. Revised: none.

### q-one-time-step — After 1.0, may a one-time step like `phax artifact migrate-documents` come back?

- breaking-only — Only at a breaking release, announced in its upgrading entry — abandons: A change whose lift needs a person's answer (like 0.38.0's canonical plan paths) must wait for a major, or ship reading the missing fact as unknown.
- never — Never again — abandons: A change that only a person editing files can make cannot ship at all, not even at a major.
- any-with-note — At any release, as long as its upgrading entry names the step — abandons: Foreseeability: a minor upgrade can again stop approve or decide until a step runs, the case this spec exists to rule out.

Recommendation: breaking-only — Total lifts plus R-no-step remove every reason for a step within a major, and a major is where users already expect to act. `never` would forbid changes the project may genuinely need. R-no-step and R-lift are written to this recommendation.

Decision: breaking-only — by operator (Rémy Loubradou), 2026-11-24
Why: Only a blocking step (one that commands refuse to run without, as 0.38.0's migrate-documents) waits for a major. A non-blocking step may ship at any release, named in its upgrading entry: every command works without it, reading what it would fill as computed or unknown, and it only rewrites repository documents (spec and plan sidecars, approval records) to the current shape, never the records on phax/records/v1. Advocate: Allowing a named step at any release lets a change that only a person can complete ship in a minor, instead of waiting for the next major. Principles: S1, S3. Reversibility: costly. Revised: none.

### q-config — What does the promise say about configuration, which carries no release stamp?

- config-breaking-only — Stay unstamped; within a major a configuration accepted by an earlier release stays accepted, and a key is renamed or removed only at a major, refused by name — abandons: A minor release can never rename or tighten a configuration key: 0.41.0's model id rename would have waited for 2.0.
- config-stamped — Stamp configuration with a release `$schema` and read its older shapes like a durable format — abandons: `phax.json`'s `$schema` pointing at the local editor schema, and every `phax.json` needs an edit at 1.0.
- config-out — Leave configuration out of the promise — abandons: Any promise about the file every user edits, which an upgrade may then refuse without warning.

Recommendation: config-breaking-only — Configuration is written by people, and their editors validate it against the local `phax.schema.json`. Stamping it would trade that for a release URL and impose a step at 1.0. Accepting a whole major's configurations gives users the same foreseeability without a new key, and the configuration cases already pin what each release accepts. R-config-accept and R-config-refuse are written to this recommendation.

Decision: config-breaking-only — by operator (Rémy Loubradou), 2026-11-24
Why: Values taken from the providers' model catalog (a model id, an effort) are not configuration keys: when a provider retires a model, any release may stop accepting it, refused by name with the model to write instead. Advocate: Stamping configuration with a release `$schema` would let minor releases rename or tighten keys safely, reading older configuration through its frozen shape like every other persisted format. Principles: S1, S10. Reversibility: costly. Revised: none.

## 10. Implementation-planning note

Settled:

- Shapes are not frozen. The promise is the rules of change, from 1.0.0. Before 1.0.0 every minor release counts as breaking, so today's behaviour already keeps the rules, and the checks can land now.
- There are three stability classes (`durable`, `published`, `answer`), and every registered format has exactly one.
- Provider answers and the reports a gate step or a provider prints are `answer` formats under the 2026-10-08 rule: read and lifted from 1.0.0, with the existing guard tests failing at an opened 1.0.0 and naming the rule, never deleted.
- An in-flight run is finished by the shapes that started it, and resume across a shape change is refused with its remedies. Reading the run's files afterwards (`phax ls`, `phax records explain`) is covered as `durable`.
- A refusal names the format, both releases and the remedy, and the docs page states the same remedy once.
- Within a breaking line a shape only adds; removing or renaming a field, a variant or a format waits for a breaking release.
- A blocking one-time step comes only at a breaking release; a non-blocking document upgrade may ship at any release, and nothing waits for it.
- Values from the providers' model catalog (a model id, an effort) are not configuration keys: a retired one may be refused at any release, by name, with the model to write instead.

Left open:

- The class of each of the 46 registered formats, retired ones and the old approval ledgers included, proposed by the plan and shown on the docs page.
- Which `durable` formats phax itself reads today only at their current shape, so the plan can inventory the frozen decoders and lifts phax must add to match the package.
- How the cut tells which formats changed shape in the release (its renamed `next` snapshots are the natural source), and how it matches them against the upgrading entry.
- How the below-floor refusal knows the release line that still reads a document, for example from the floor's history in the release ledger.
- Whether the configuration cases of the behaviour corpus are the fixture that pins what each release accepts.
- How the cut tells a dropped or renamed field, variant or format from an added one, for example by comparing the new snapshot with the previous one.
- Whether `phax artifact migrate-documents` becomes the non-blocking document upgrade, or another command takes that role.

Constraints:

- No back-compat shims inside a shape: new fields stay required and enums explicit per variant. Older shapes are read through their own frozen schema and lifted.
- No network call at read time, and no migration machinery, catalogue, install hook or hint line (the abandoned `auto-migrate` and `upgrade-hints`).
- The release cut's new refusals happen before it writes anything, like its existing ones, and CI's rehearsal of the cut on every push and pull request runs them.
- A read never rewrites a document. Records on `phax/records/v1` are never rewritten.
- Layers as in AGENTS.md: deciding a document's shape, class and refusal is pure; reading files goes through ports.
- Fixtures are generated or made up, and tests never read `~/.phax`.

## 11. Docs page

Page: docs/format-stability.md — Format stability: what an upgrade may change in the files and records phax writes, linked from the README, docs/upgrading.md and the docs site's navigation.

Reader: Someone adopting phax 1.0, or reading phax's files and records with `@lbdremy/phax-schemas`, who wants to know before upgrading what the upgrade may stop reading and what to do when a reader refuses a document.

Example: Two teammates share `phax/records/v1`, one on phax 1.3.0 and one on 1.4.0, which changed `phase-record-manifest`. The page shows why 1.4.0 reads every record, why 1.3.0's `phax records list` refuses and names 1.4.0, why a script on `@lbdremy/phax-schemas` 1.3.0 is refused the same way, and that upgrading each reader to 1.4.0 is the whole remedy. Nothing needs migrating.

## 12. Decision log

- 2026-11-24 q-floor-at-one decided keep-0-17 — operator (Rémy Loubradou)
- 2026-11-24 q-floor-moves decided major-only — operator (Rémy Loubradou)
- 2026-11-24 q-newer decided refuse — operator (Rémy Loubradou)
- 2026-11-24 q-mixed decided refuse-command — operator (Rémy Loubradou)
- 2026-11-24 q-one-time-step decided breaking-only — operator (Rémy Loubradou)
- 2026-11-24 q-config decided config-breaking-only — operator (Rémy Loubradou)
