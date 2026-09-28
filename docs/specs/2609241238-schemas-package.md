---
status: Approved
date: 2026-09-24
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-28
  baseline: 5eddcac
---
# Schemas package: phax's persisted formats as a typed npm package

## 1. Context

phax writes its state as JSON documents that other tools can read later. The run registry lives at ~/.phax/registry.json. Each run directory holds run-status.json, a status.json per phase, phax-plan.json and, after a review, compliance-review.json. The repo holds the plan and spec approval files (docs/plans/approvals.json, docs/specs/approvals.json). The phax/records/v1 branch holds record manifests: <runId>/<phaseId>/record.json for a phase and authoring/<authoringId>/record.json for a headless authoring session. Since 0.16.0, headless authoring also writes a JSON sidecar beside each spec and plan it authors. phax decodes every one of these with an Effect Schema in src/schemas. That directory also holds many purely internal schemas: provider output streams, config layers, gate diagnostics and attribution, reconciliation, session bindings, the extraction cache, and orient and plan-audit responses. Four schemas are already rendered to JSON Schema: phax.json through phax schema upgrade, phax-plan, and the spec and plan documents through phax artifact schema spec|plan. phax builds with tsc to dist/ with declarations. src/ uses node: built-ins and npm dependencies and no Deno API; Deno only compiles the four release binaries. The npm package, @lbdremy/phax, is a launcher for those binaries. It is version-matched to the tag, staged with npm stage publish --provenance and approved by hand. The tsc output itself is published nowhere. The README names three experimental formats outside the 'version: 1' promise. NEXT_STEPS lists the persisted-format promise as a 1.0 blocker that is still to be written. The first consumer is the steme roadmap-1.0 experiment: a read-only cockpit that reads records with phax's types, and a docs pipeline that renders each format's JSON Schema as a reference page.

Ground read:

- `NEXT_STEPS.md` — 'Spec candidates' → 'Three additive specs…' item 3 (schemas-package: persisted-format schemas published alone, freezing nothing beyond the 1.0 promise, typed parsing for a read-only records consumer); 'Road to 1.0.0' → the persisted-format stability promise (phax.json, run status files, approvals.json, phax/records/v1) is a 1.0 blocker not yet written; 'Library readiness' → the app/ports library API waits for 1.0.
- `src/schemas/` — 42 Effect Schema modules. The persisted formats a third party reads are registry.ts, status.ts (run and phase status), phaxPlan.ts, complianceReview.ts, approvalRecord.ts, specApprovalRecord.ts, runRecord.ts (phase record manifest, version 2), authoringRecord.ts (authoring record plus the record-manifest union), specDocument.ts and planDocument.ts. The rest are internal: provider output streams, config layers, gate and reconciliation documents, session bindings, the extraction cache, orient, plan-audit, scopes, telemetry events.
- `src/schemas/status.ts, src/schemas/runRecord.ts, src/domain/branded.ts` — The schema modules reach outside src/schemas in two places: status.ts imports BranchNameSchema from domain/branded.ts, which is pure and uses only effect, and runRecord.ts imports SurfaceSchema from phaxConfig.ts. vibeOutput.ts imports node:fs, so it must stay out of any published closure.
- `src/schemas/*.ts decode options` — Most decoders reject excess properties (onExcessProperty: error), but registry.ts and status.ts use the default and ignore them. Parity has to follow each format's own setting.
- `src/app/recordPlumbing.ts` — The records branch is phax/records/v1. A manifest is record.json, keyed <runId>/<phaseId> for a phase or authoring/<authoringId> for an authoring session, beside an optional output.jsonl.
- `package.json, tsconfig.json, tsconfig.build.json` — The root package is 'phax', built with tsc -p tsconfig.build.json to dist/ with declarations. src/ is ESM and uses node: built-ins and npm dependencies only. Its only runtime dependency relevant to schemas is effect ^3.14.0.
- `npm/package.json, scripts/prepare-npm.ts` — The package published to npm, @lbdremy/phax, is only a launcher: bin/phax plus a binary resolver. The release workflow sets its version to match the tag. The tsc output is published nowhere.
- `deno.json, docs/release.md` — Deno is used only to smoke-test and cross-compile the four release binaries.
- `.github/workflows/release.yml, scripts/release.sh` — On a tag, the workflow runs the gate, builds the binaries, version-matches npm/package.json and runs npm stage publish --provenance for one package; a maintainer approves the staged package by hand. release.sh bumps package.json and npm/package.json in one release commit.
- `README.md §Experimental formats` — Three formats sit outside the 'version: 1 stability promise that covers phax.json and the run formats': spec document, plan document and authoring record.
- `docs/specs/2609241219-headless-review.md` — Draft. It introduces code-review.json, pass.json and the review-plan document, all shipped experimental.
- `/Volumes/Work/steme/steme-corpus/docs/doctrine/01-vision/roadmap-1.0.toml` — Not readable in this session (permission denied). The consumer's need is taken from the brief (item 0.9): a read-only cockpit reads records with these types and never with a hand-written parser, and a docs pipeline renders JSON Schemas as reference pages.
- `~/.phax/records/phax (clone of the phax-records destination)` — Walked 2026-09-28 across every commit of phax/records/v1 (each commit carries its own tree): 6 phase records at version 1 and 51 at version 2; 8 authoring records at version 1, of which 2 lack sourceSha — an experimental format changed shape without a version bump. docs/specs/approvals.json and docs/plans/approvals.json: version 1 with one record shape across all 84 commits that touched them.

## 2. Problem

Today a tool that wants to read what phax wrote has two options, and both are wrong. The first is to write its own parser from phax's source. That creates a second decoder that drifts silently the first time phax bumps a format (the phase record manifest is already at version 2 and gained verifiedSurfaces in 0.10), and it will accept and reject documents differently from phax. The second is to depend on phax's source tree. That pulls in the CLI, the adapters and every internal schema, and says nothing about which formats are safe to depend on. Neither option gives the cockpit typed reads or gives the docs pipeline a JSON Schema per format. Neither can read the history: a document an older phax wrote is rejected, or read by a guess. There is also a risk on the other side. Publishing every schema in src/schemas as public API would freeze internal formats that the 1.0 promise never covered.

## 3. Product goal

Publish phax's persisted-format decoders as a small, standalone, typed npm package, released at the same version as phax. The package ships the schemas phax actually uses, not a copy. A third-party reader then gets the same accept or reject verdict phax would give on any document, a TypeScript type for the decoded value, and a JSON Schema for its docs. Every document phax has ever written stays readable, whatever release wrote it; a format is not stable or experimental, it has shapes.

> The package is phax's own decoder, published: it accepts exactly what phax accepts, exports every format phax persists and nothing internal, and reads every shape phax has ever written.

## 4. Terminology

- **Persisted format** — A JSON document that phax writes and that a third party can read later. It is identified by its `$schema`: the format id and the phax release that wrote it. A legacy document, written before `$schema`, is identified by where it lives and by its `version` literal, for example run-status.json with version 1.
- **Schemas package** — The npm package @lbdremy/phax-schemas described by this spec.
- **Entry** — The package's import path, `@lbdremy/phax-schemas`, which carries every persisted format, plus the `json/` directory of JSON Schemas. There is no second entry.
- **Parse function** — A schemas-package function that takes an already-JSON-parsed value of unknown type and returns a Parsed result. The result is either the typed value or a failure with a path and a message.
- **Parity** — A parse function has parity when it gives the same accept or reject verdict as phax's own decoder for that format on every document, including how it treats unknown keys. Parity holds for the version phax currently writes; older versions are read by historical decoders phax no longer carries.
- **Record manifest** — A record.json on phax/records/v1. There are two kinds: a phase record (version 2, keyed <runId>/<phaseId>) and an authoring record (kind "authoring", version 1, keyed authoring/<authoringId>).
- **Lockstep version** — The schemas package's version always equals the version of the phax release whose tag produced it.
- **Format id** — The stable name of a persisted format, independent of any file name or location: registry, run-status, phase-status, phax-plan, compliance-review, plan-approvals, spec-approvals, phase-record, spec-document, plan-document, authoring-record, code-review.
- **Schema URL** — The `$schema` value phax writes as the first key of every document: `https://docs.phax.run/schemas/<format id>/<release>.json`. It names the format and the release that wrote the document, and it is the only version marker a new document carries.
- **Historical decoder** — The decoder of a shape phax no longer writes. It lives in the package, one module per shape, and is never modified after the release that froze it.
- **Snapshot** — The committed JSON Schema of one shape, stored as `<format id>/<shape release>.schema.json` (or `<format id>/v<n>.schema.json` for a legacy shape). A shape not yet released is `<format id>/next.schema.json`, renamed to the release version by `release.sh`. The latest snapshot of a format must equal the schema generated from phax's decoder.
- **History corpus** — Real documents extracted from git history (the records branch, the approvals ledgers, the spec and plan sidecars) by a committed script, one directory per format and shape, committed in the repo.
- **Shape** — One JSON shape of a format. A shape is named by the release that first wrote it (its shape release); a legacy shape by its `version` literal (`v1`, `v2`). A document written by release X has the latest shape released at or before X.
- **Legacy document** — A document written before `$schema` existed. It carries a `version` literal and is identified by where it lives and by that literal.
- **Release version** — The version in phax's root `package.json`. phax writes it in `$schema`; a development build therefore names the last cut release, and its documents are not meant to be read before a release names their shape.

## 5. Functional requirements

### 5.1 Standalone package

The system shall publish its persisted-format schemas as a standalone npm package, @lbdremy/phax-schemas, that installs and imports without the phax CLI, its binaries or its source tree.

### 5.2 Runtime dependencies

The schemas package shall declare effect as its only runtime dependency.

### 5.3 No side effects

The schemas package shall contain no code that reads files, spawns processes, opens network connections or references a node: or Deno built-in.

### 5.4 Every persisted format on one entry

The schemas package's entry shall export a schema, a TypeScript type and a parse function for exactly these formats: run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals, phase record, spec document, plan document, authoring record, and the record-manifest union of phase and authoring records.

### 5.5 Nothing internal

The schemas package shall export no internal schema and no module of phax's app, ports, infra or cli layers. Internal schemas are provider output streams, config layers (phax.json and the user overlay), gate, reconciliation and session documents, the extraction cache, and orient and plan-audit responses.

### 5.6 Same verdict as phax

WHEN a schemas-package parse function is given a document of the shape phax currently writes THE schemas package SHALL accept it if and only if phax's own decoder for that format accepts it.

### 5.7 Failures are values

IF a document fails to parse THEN the parse function SHALL return a failure carrying the path and message of the first violation, without throwing.

### 5.8 Every version ever written is readable

WHEN a parse function is given a document of any shape phax has ever written THE schemas package SHALL decode it with that shape's decoder — the latest shape released at or before the release its `$schema` names, or, for a legacy document, the shape its `version` literal names — and return its exact shape with the shape's id.

### 5.9 A document is identified by itself

WHEN `parseDocument` is given a document carrying `$schema` THE schemas package SHALL identify its format from `$schema` alone, whatever the file's name or location, and return the format id, the shape id and the parsed value.

### 5.10 A newer version is named, not guessed

IF a document's `$schema` names a release newer than the package, or a format id the package does not know, THEN the parse function SHALL return a failure naming the URL and the package version, and stating that the package must be upgraded.

### 5.11 Upgrading to the latest shape

The schemas package shall export, for each format, a pure function that upgrades a decoded document of any version to the latest shape, marking every fact the older version did not carry as `{ kind: "unknown" }` and never inventing a value.

### 5.12 Legacy shapes under one version

WHERE a legacy document's `version` literal covers several shapes found in the history corpus THE historical decoder of that literal SHALL accept each of those shapes.

### 5.13 Every document names its format and release

phax shall write `$schema: "https://docs.phax.run/schemas/<format id>/<release version>.json"` as the first key of every persisted format it writes, taking the release version from its root `package.json`, and shall write no `version` literal in those formats.

### 5.14 Historical decoders are frozen

The schemas package shall hold one decoder module per shape phax no longer writes, and a historical decoder shall not change once released. phax shall read a file it wrote in an older shape (its registry, a run's status) through those decoders and the format's `toLatest`, and shall refuse, naming the file and the fact, when a fact it needs comes back unknown.

### 5.15 A shape change is recorded as the next shape

IF the JSON Schema generated for a format differs from that format's latest released snapshot and `<format id>/next.schema.json` does not equal it THEN phax's gate SHALL fail, naming the format and `<format id>/next.schema.json` as the snapshot to record.

### 5.16 The release names the next shapes

WHEN `release.sh` cuts version X THE release script SHALL rename every `<format id>/next.schema.json` to `<format id>/X.schema.json` in the release commit.

### 5.17 The history corpus is parsed at every release

IF any document of the committed history corpus fails to parse with the package THEN the release gate SHALL fail, naming the document and its first violation.

### 5.18 The corpus is extracted by a committed script

The repository shall hold a committed script that walks git history — every commit of the records branch, and every commit touching the approvals ledgers or a spec or plan sidecar — and writes the distinct documents it finds, per format and shape, into the history corpus.

### 5.19 Types match phax

The schemas package shall ship TypeScript declarations whose type for each exported format is the type phax decodes that format to.

### 5.20 JSON Schema per format

The schemas package shall ship one draft-07 JSON Schema file per exported format, generated at build time from the same schema that format's parse function uses.

### 5.21 No silent JSON Schema gap

IF an exported format's JSON Schema cannot be generated THEN the schemas package build SHALL fail naming that format.

### 5.22 Lockstep version

The schemas package shall be published at the same version as the phax release whose tag produced it.

### 5.23 Released with phax

WHEN a release tag is pushed THE release workflow SHALL stage-publish the schemas package beside @lbdremy/phax.

### 5.24 All or nothing

IF the schemas package build fails, or its packed tarball cannot be installed into an empty Node project and parse a phax-written document there, THEN the release workflow SHALL stage-publish neither package.

### 5.25 One release commit

WHEN the release script bumps phax's version THE release script SHALL bump the schemas package manifest in the same release commit.

### 5.26 Code-review document when it ships

WHERE a phax release carries the code-review document THE schemas package of that release SHALL export it like every other format.

## 6. Surface

### package: @lbdremy/phax-schemas — normative

    npm install @lbdremy/phax-schemas

    # entries (normative)
    @lbdremy/phax-schemas                             every persisted format
    @lbdremy/phax-schemas/json/<format>.schema.json   one JSON Schema per format (its latest shape)

### package: @lbdremy/phax-schemas exports — normative

    # format set normative; function, schema and type spellings indicative
    format                 parse function          schema, type                                  document it reads
    run registry           parseRegistry           RegistrySchema, Registry                      ~/.phax/registry.json
    run status             parseRunStatus          RunStatusSchema, RunStatus                    <run-dir>/run-status.json
    phase status           parsePhaseStatus        PhaseStatusSchema, PhaseStatus                <run-dir>/<phase-id>/status.json
    phax-plan              parsePhaxPlan           PhaxPlanSchema, PhaxPlan                      <run-dir>/phax-plan.json
    compliance review      parseComplianceReview   ComplianceReviewSchema, ComplianceReview      <run-dir>/compliance-review.json
    plan approvals         parsePlanApprovals      PlanApprovalsSchema, PlanApprovals            docs/plans/approvals.json
    spec approvals         parseSpecApprovals      SpecApprovalsSchema, SpecApprovals            docs/specs/approvals.json
    phase record manifest  parsePhaseRecord        PhaseRecordSchema, PhaseRecord                phax/records/v1:<runId>/<phaseId>/record.json
    spec document          parseSpecDocument       SpecDocumentSchema, SpecDocument              JSON sidecar beside a headless-authored spec
    plan document          parsePlanDocument       PlanDocumentSchema, PlanDocument              JSON sidecar beside a headless-authored plan
    authoring record       parseAuthoringRecord    AuthoringRecordSchema, AuthoringRecord        phax/records/v1:authoring/<authoringId>/record.json
    record manifest        parseRecordManifest     RecordManifestSchema, RecordManifest          any record.json on phax/records/v1
    any document           parseDocument           —                                             any file carrying `$schema`
    # added from the release that ships review-as-plan:
    code-review document   parseCodeReview         CodeReviewSchema, CodeReview                  <run-dir>/review/pass-NN/code-review.json

    # shared by every parse function
    type Parsed<T>

### package: Parsed result — normative

    // shape normative; the name Parsed and the message wording indicative
    type Parsed<T> =
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: { readonly path: string; readonly message: string } };

    parseRunStatus(input: unknown): Parsed<RunStatus>

    // run-status.json with "state": "paused"
    { ok: false, error: { path: "state", message: "Expected \"created\" | \"running\" | …, actual \"paused\"" } }

### package: reading history — normative

before:

    const r = parsePhaseRecord(raw)
    // only version 2 is accepted; a version-1 record from the history is rejected

after:

    import { parseDocument, parsePhaseRecord, toLatestPhaseRecord } from "@lbdremy/phax-schemas";

    const any = parseDocument(raw);            // identified by `$schema` alone, whatever the file's name
    // { ok: true, format: "phase-record", shape: "0.17.0", value: PhaseRecord_0_17 }

    const r = parsePhaseRecord(raw);           // PhaseRecordV1 | PhaseRecordV2 | PhaseRecord_0_17, with its shape id
    const latest = toLatestPhaseRecord(r.value);
    // from a legacy v1 record: verifiedSurfaces: { kind: "unknown" }

    parseDocument({ "$schema": "https://docs.phax.run/schemas/phase-record/0.19.0.json", … });
    // { ok: false, error: { path: ["$schema"], message: "phase-record written by phax 0.19.0 is newer than @lbdremy/phax-schemas 0.17.0 — upgrade the package" } }

    # normative: identification by `$schema` alone, every historical shape parses, toLatest never invents a value, the newer-release failure

### file: `$schema` in every persisted format — normative

before:

    { "version": 2, "runId": "…", "phaseId": "phase-02", "outcome": "committed", … }

after:

    { "$schema": "https://docs.phax.run/schemas/phase-record/0.17.0.json", "runId": "…", "phaseId": "phase-02", "outcome": "committed", … }

    # every persisted format: `$schema` first, no `version`; the URL serves that release's JSON Schema of the format

### file: snapshots, historical decoders and history corpus — indicative

    packages/schemas/
      src/history/phase-record/v1.ts            legacy shape, frozen; phax never imports it
      src/history/phase-record/v2.ts            legacy shape, frozen
      src/history/authoring-record/v1.ts        legacy, frozen; accepts both shapes (with and without sourceSha)
      snapshots/phase-record/v1.schema.json     one committed JSON Schema per shape
      snapshots/phase-record/v2.schema.json
      snapshots/phase-record/next.schema.json   unreleased shape; release.sh renames it to the version it cuts
      corpus/phase-record/v1/*.json             extracted from git history by scripts/extract-history-corpus.ts
      corpus/phase-record/v2/*.json

    $ pnpm schemas:check
    ✗ phase-record: the generated schema differs from the latest released snapshot and from snapshots/phase-record/next.schema.json — record next.schema.json
    $? = 1

### package: Node consumer, end to end — indicative

    // read-record.mjs: Node 20+, phax not installed, only @lbdremy/phax-schemas
    import { execFileSync } from "node:child_process";
    import { parsePhaseRecord } from "@lbdremy/phax-schemas";

    const key = process.argv[2]; // "<runId>/phase-01"
    const raw = execFileSync("git", ["show", `phax/records/v1:${key}/record.json`], { encoding: "utf8" });

    const parsed = parsePhaseRecord(JSON.parse(raw));
    if (!parsed.ok) {
      console.error(`record.json: ${parsed.error.path}: ${parsed.error.message}`);
      process.exit(1);
    }
    const { runId, phaseId, outcome, usage } = parsed.value; // typed PhaseRecord
    console.log(runId, phaseId, outcome, usage.available ? usage.usage.provider : "no usage");

    // walking the whole branch also meets authoring records:
    // import { parseRecordManifest } from "@lbdremy/phax-schemas";

    $ node read-record.mjs <runId>/phase-01
    <runId> phase-01 committed claude-code
    $ echo $?
    0

### file: json/<format>.schema.json — indicative

    # one file per exported format, describing its latest shape, is normative;
    # file names and the keyword spelling are indicative
    node_modules/@lbdremy/phax-schemas/json/run-status.schema.json
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "phax run status",
      "type": "object",
      "required": ["version", "namespace", "shortName", "runId", "state", "createdAt", "updatedAt", "phasesCount"],
      …
    }

    node_modules/@lbdremy/phax-schemas/json/spec-document.schema.json

### file: @lbdremy/phax-schemas package.json — indicative

    # name, lockstep version and the single effect dependency normative; the rest indicative
    {
      "name": "@lbdremy/phax-schemas",
      "version": "0.17.0",
      "type": "module",
      "exports": {
        ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
        "./json/*": "./json/*"
      },
      "files": ["dist", "json"],
      "dependencies": { "effect": "^3.14.0" },
      "engines": { "node": ">=20" },
      "license": "Apache-2.0"
    }

### file: README.md persisted-formats table — indicative

before:

    ## Experimental formats

    These formats are outside the `version: 1` stability promise that covers `phax.json` and the run formats: …

    | Format           | Where it lives                                       | Contract                        |
    | Spec document    | the `.json` sidecar beside a headless-authored spec  | `phax artifact schema spec`     |
    | Plan document    | the `.json` sidecar beside a headless-authored plan  | `phax artifact schema plan`     |
    | Authoring record | `authoring/<YYMMDDHHMM>-<slug>` on `phax/records/v1` | `phax records explain <commit>` |

after:

    ## Persisted formats

    # one row per exported format is normative; wording and columns indicative
    Every document phax writes starts with `$schema` (format and release); every shape it has ever written stays readable.
    | Format                | Where it lives                                    | Read it with            |
    | Run registry          | `~/.phax/registry.json`                           | `parseRegistry`         |
    | Run status            | `<run-dir>/run-status.json`                       | `parseRunStatus`        |
    | Phase status          | `<run-dir>/<phase-id>/status.json`                | `parsePhaseStatus`      |
    | phax-plan             | `<run-dir>/phax-plan.json`                        | `parsePhaxPlan`         |
    | Compliance review     | `<run-dir>/compliance-review.json`                | `parseComplianceReview` |
    | Plan approvals        | `docs/plans/approvals.json`                       | `parsePlanApprovals`    |
    | Spec approvals        | `docs/specs/approvals.json`                       | `parseSpecApprovals`    |
    | Phase record          | `<runId>/<phaseId>/record.json` on `phax/records/v1` | `parsePhaseRecord`   |
    | Spec document         | `.json` sidecar beside a headless-authored spec   | `parseSpecDocument`     |
    | Plan document         | `.json` sidecar beside a headless-authored plan   | `parsePlanDocument`     |
    | Authoring record      | `authoring/<id>/record.json` on `phax/records/v1` | `parseAuthoringRecord`  |
    (all from `@lbdremy/phax-schemas`; any of them: `parseDocument`)

### cli: scripts/release.sh — indicative

before:

    $ scripts/release.sh 0.16.0
    bumping to 0.16.0
    regenerating usage spec and CLI docs
    committing
    tagging
    pushing
    done: v0.16.0 tagged and pushed
    approve the staged npm package at: https://www.npmjs.com/package/@lbdremy/phax

after:

    $ scripts/release.sh 0.17.0
    bumping to 0.17.0            # package.json, npm/package.json and the schemas package manifest
    renaming snapshots/*/next.schema.json → 0.17.0.schema.json
    regenerating usage spec and CLI docs
    committing
    tagging
    pushing
    done: v0.17.0 tagged and pushed
    approve the staged npm packages at:
      https://www.npmjs.com/package/@lbdremy/phax
      https://www.npmjs.com/package/@lbdremy/phax-schemas

### internal: release workflow on tag v0.17.0 — indicative

before:

    gate → build binaries → version-match npm/package.json → npm stage publish @lbdremy/phax → GitHub release

after:

    gate → build binaries → build schemas package (JS, declarations, JSON Schemas) → install its packed tarball into an empty Node project and parse a phax-written record → version-match both manifests to the tag → npm stage publish @lbdremy/phax → npm stage publish @lbdremy/phax-schemas → GitHub release
    # every step that can fail runs before the first stage publish

## 7. Non-goals

- The app and ports library API: exported use cases, adapter sets and a composition root. That work waits for 1.0 and the library-readiness item.
- Exporting the phax.json or user-overlay config schemas. phax builds its effective config by merging layers, so decoding one file alone does not give the config phax would run with, and phax schema upgrade already delivers the JSON Schema for editors.
- Writing the 1.0 stability contract itself (a frozen version plus a migration command, or a re-run-init policy). That stays with the Road to 1.0 item. This spec makes every shape readable; what 1.0 promises about changing shapes is that item's to say.
- Any change to a persisted format's shape other than adding `$schema` and dropping `version`, or to the CLI. For the shape it writes, the package republishes what phax already enforces.
- Reading helpers: nothing walks the records branch, finds run directories or reads files. The consumer reads the bytes and hands the package a JSON value.
- Rewriting documents on disk. The package reads every version and upgrades in memory; phax, the writer, writes only the latest version and keeps its no-shims rule.
- A CommonJS build, a JSR or Deno-native publish, or JSON Schemas hosted at a URL. The docs pipeline reads the files from the installed package.
- Parsing spec and plan Markdown frontmatter.
- Exporting the internal formats listed in §5 (provider output streams, gate, reconciliation and session documents, extraction cache, orient, plan-audit, publication, security posture, telemetry events).

## 8. Acceptance criteria

### A Node consumer parses a phase record end to end

Given an empty Node 20 project with no phax installed, in a repo whose phax/records/v1 branch holds a phase record.json written by phax, when the packed @lbdremy/phax-schemas tarball is installed and the §6 consumer script runs with that record's <runId>/<phaseId> key, then it prints the record's runId, phaseId and outcome and exits 0, and the project's node_modules holds only @lbdremy/phax-schemas, effect and effect's own dependencies. (refs §5.1, §5.2)

### The package does no I/O

Given the packed @lbdremy/phax-schemas tarball, when every JavaScript file it contains is scanned for imports and globals, then none imports a node: built-in, fs, child_process or net, and none references Deno. (refs §5.3)

### The entry exports every persisted format

Given the installed package, when the exports of @lbdremy/phax-schemas are listed, then there is a schema, a type and a parse function for run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals, phase record, spec document, plan document, authoring record and the record-manifest union; the package has no other entry; none exists for an internal format. (refs §5.4)

### Nothing internal leaks

Given the packed @lbdremy/phax-schemas tarball, when its file list and the exports of every entry are inspected, then no export decodes a provider output stream, phax.json, the user overlay, a gate, reconciliation or session document, the extraction cache, or an orient or plan-audit response, and no file compiled from phax's app, ports, infra or cli layers is present. (refs §5.5)

### Same verdict as phax on every document

Given a corpus of accepted and rejected documents for every exported format, including a phase record.json with one unknown key and a registry.json with one unknown key, when each document is parsed by the package's parse function and by phax's own decoder, then the two verdicts agree on every document: the record with the unknown key is rejected by both, and the registry with the unknown key is accepted by both. (refs §5.6)

### A bad document is a value, not an exception

Given a run-status.json whose state is "paused", when parseRunStatus is called on its parsed JSON, then it returns ok: false with error.path "state" and a non-empty error.message, and no exception escapes. (refs §5.7)

### Package types are phax's types

Given phax's type-test suite and the package's declarations, when a value of each exported package type is assigned to phax's internal type for that format, and the reverse, then both assignments typecheck for every exported format. (refs §5.19)

### Every exported format has a usable JSON Schema

Given the installed package and one phax-written document per exported format, when each json/<format>.schema.json is loaded into a standard draft-07 validator and the matching document is validated, then there is exactly one schema file per exported format and every phax-written document validates. (refs §5.20)

### A format without a JSON Schema fails the build

Given an exported format whose schema carries a refinement that has no JSON Schema rendering, when the schemas package build runs, then it exits non-zero naming that format, and the build output has no schema file for that format. (refs §5.21)

### Both packages are staged at the tag's version

Given a signed tag v0.17.0 on a commit whose release gate is green, when the release workflow runs, then @lbdremy/phax@0.17.0 and @lbdremy/phax-schemas@0.17.0 are both staged on npm. (refs §5.22, §5.23)

### A broken package publishes nothing

Given a release commit whose schemas-package tarball fails to install into an empty Node project or fails to parse the smoke document, when the release workflow runs on its tag, then the workflow fails before any npm stage publish step runs, and neither package is staged. (refs §5.24)

### One commit bumps all manifests

Given a clean main at 0.16.0, when scripts/release.sh 0.17.0 runs, then the release commit sets version 0.17.0 in package.json, npm/package.json and the schemas package manifest, and the script's last lines name both staged packages. (refs §5.25)

### The code-review document joins like any format

Given a phax release that carries the code-review document, when the exports of @lbdremy/phax-schemas and its json/ directory are listed, then there is a code-review parse function and a code-review JSON Schema, on the same entry as every other format. (refs §5.26)

### A mixed history parses

Given the history corpus's phase records at versions 1 and 2, when each is given to parsePhaseRecord, then every call returns ok; the value's `version` is 1 or 2 and its type is the exact shape of that version. (refs §5.8, §5.17)

### A newer document is named

Given a phase record whose `$schema` names release 0.19.0, and a document whose `$schema` names an unknown format id, when each is given to parseDocument, then each returns a failure naming the URL and the package version and saying to upgrade the package, without throwing. (refs §5.10)

### Upgrading marks the unknown

Given a version-1 phase record from the corpus, when it is parsed and upgraded to the latest shape, then the result has the latest shape; `verifiedSurfaces` is `{ kind: "unknown" }`; every field the version-1 record carried keeps its value. (refs §5.11)

### Both legacy authoring shapes parse

Given the two authoring records at version 1 from the corpus, one with `sourceSha` and one without, when each is parsed, then both return ok. (refs §5.12)

### Every written document names its format and release

Given a phax built at 0.17.0, when a run, an approval and a headless authoring session each write their documents, then every document phax wrote starts with `$schema` set to `https://docs.phax.run/schemas/<its format id>/0.17.0.json` and carries no `version` key. (refs §5.13)

### phax imports only the current decoder

Given the built package and phax's source, when their imports are inspected, then phax's src/ imports no historical decoder module, and each historical module is byte-identical to its first released copy. (refs §5.14)

### A shape change must be recorded at its release

Given a change that adds a key to the phase record decoder, with no `phase-record/next.schema.json` yet, when phax's gate runs, then it fails naming the phase record and `phase-record/next.schema.json`; once that snapshot is written, it passes. (refs §5.15)

### The corpus is extracted and parsed

Given a repository with records and approvals history, when the corpus script runs, then the release gate, then the corpus holds one directory per format and shape with the distinct documents found, and the release gate parses every one; a document that fails stops the release naming it. (refs §5.18, §5.17)

### A renamed file is still identified

Given a phase record written by phax 0.17.0, copied to `exports/a.json`, and an approvals ledger copied to `exports/b.json`, when each is given to parseDocument, then the first returns format `phase-record`, shape `0.17.0`; the second `plan-approvals`; no path is consulted. (refs §5.9)

### The release names the next shapes

Given `phase-record/next.schema.json` and `registry/next.schema.json` committed, when scripts/release.sh 0.17.0 runs, then the release commit renames them to `phase-record/0.17.0.schema.json` and `registry/0.17.0.schema.json`, and no `next` snapshot remains. (refs §5.16)

### phax reads its own older files through the package

Given a `~/.phax/registry.json` written by phax 0.16.0 (legacy `version: 1`), and a phax at 0.17.0, when `phax ls` runs, then any command that writes the registry, then the runs are listed, read through the package's legacy decoder and `toLatest`; the rewritten registry starts with `$schema` naming `registry/0.17.0.json`; no phax module decodes the legacy shape itself. (refs §5.14, §5.13)

## 9. Open questions for implementation planning

### Q1 — Should the schemas ship as their own package or as a subpath of the existing @lbdremy/phax package?

- A separate package, @lbdremy/phax-schemas — abandons: single-package releases: every release stages, approves and version-matches a second npm package.
- A subpath, @lbdremy/phax/schemas — abandons: a lightweight dependency: every schema consumer installs the CLI launcher and its platform-binary resolution, and every CLI user installs effect.

Recommendation: A separate package, @lbdremy/phax-schemas — Decided by the author on 2026-09-28, as recommended. The launcher and the library have disjoint audiences and dependencies. A second staged publish is one more step in a workflow that is already automated and approved by hand, which is a cost worth paying to keep the consumer's install small.

### Q2 — How should the package depend on effect?

- A regular dependency on effect, with the same range as phax — abandons: a guaranteed single copy: a consumer pinned to an incompatible Effect version gets a second copy, and Schema values from the two copies do not compose.
- A peer dependency on effect — abandons: a one-line install: a consumer that does not use Effect must add effect itself and match the range.
- Bundle effect into the package — abandons: interoperability: the exported Schema values belong to a private copy of Effect, so an Effect consumer cannot compose them.

Recommendation: A regular dependency on effect, with the same range as phax — Decided by the author on 2026-09-28, as recommended. The first consumer is not assumed to use Effect. With a regular dependency, npm install @lbdremy/phax-schemas is the whole install, and package managers dedupe within ^3 for consumers that do use Effect.

### Q3 — What should a parse call return?

- A plain Parsed result ({ ok, value } or { ok, error: { path, message } }), with the Effect schemas also exported — abandons: a single API: each format has both a parse wrapper and its schema, and they must stay in step.
- Effect's Either<T, ParseError>, the decodeX functions phax uses internally — abandons: use without Effect: a non-Effect consumer must learn Either and how to format a ParseError before reading one field.
- Return the value or throw — abandons: failures as values: a consumer walking many records has to wrap each call in try/catch to keep going.

Recommendation: A plain Parsed result ({ ok, value } or { ok, error: { path, message } }), with the Effect schemas also exported — Decided by the author on 2026-09-28, as recommended. The wrapper is generated from the same schema, so it can drift in spelling but not in verdict. Effect consumers still get the schemas directly, and non-Effect consumers get a result they can read without learning Effect.

### Q4 — Should parse functions reject unknown keys the way phax does?

- Parity: each format keeps phax's own excess-property setting — abandons: forward compatibility: an older package rejects a record that a newer phax wrote with a new key, so the reader has to upgrade to match the writer.
- Lenient: every parse function ignores unknown keys — abandons: the package's central claim: it would accept documents phax itself rejects, and a mistyped or foreign key would go unnoticed.

Recommendation: Parity: each format keeps phax's own excess-property setting — Decided by the author on 2026-09-28, as recommended. The package exists to be phax's decoder rather than a second one. Lockstep versioning makes the upgrade path explicit: a reader pins the package to the phax version that writes its files.

### Q5 — How should the package mark a format as experimental?

- A separate experimental entry (@lbdremy/phax-schemas/experimental) — abandons: a stable import path across graduation: when a format becomes stable, its import line moves and every consumer must edit it.
- A JSDoc @experimental tag on root-entry exports — abandons: visibility at the point of use: nothing in the import line or at compile time shows that a consumer depends on an experimental format.

Recommendation: A separate experimental entry (@lbdremy/phax-schemas/experimental) — Superseded on 2026-09-28 by q-no-experimental: with every shape readable through `$schema`, no format is marked stable or experimental. Decided by the author on 2026-09-28, as recommended. The import line is where a consumer takes on the dependency, so it is the right place to acknowledge the risk. A graduation that forces an edit is a feature, because the consumer sees the format change status.

### Q6 — While the 1.0 promise is still unwritten, should records, approvals and the compliance review be marked stable?

- Stable: registry, run and phase status, phax-plan, compliance review, both approvals files and the phase record manifest — abandons: freedom to reshape the record manifest, the approvals files or the compliance review before 1.0 without bumping their version literal.
- Experimental until the 1.0 promise is written — abandons: a stable footing for the first consumer: the cockpit would be built on formats phax says may change without notice.

Recommendation: Stable: registry, run and phase status, phax-plan, compliance review, both approvals files and the phase record manifest — Superseded on 2026-09-28 by q-no-experimental: with every shape readable through `$schema`, no format is marked stable or experimental. Decided by the author on 2026-09-28, as recommended. The promise draft in NEXT_STEPS already names approvals.json and phax/records/v1, and the README's 'run formats' covers the files in the run directory. The cockpit exists to read records. Stable already means only that a shape change bumps the version literal, and phax has done this before (the record manifest went from 1 to 2).

### Q7 — How should the package be versioned?

- Lockstep: always the phax release version — abandons: meaningful version numbers: the package publishes new versions with no schema change, so a version bump does not signal a format change.
- Independent semver that moves only when a format changes — abandons: the mapping from writer to reader: a consumer can no longer tell which package version reads the files a given phax release wrote.

Recommendation: Lockstep: always the phax release version — Decided by the author on 2026-09-28, as recommended. The question a reader asks is which package reads what phax X.Y.Z wrote, and lockstep answers it with no lookup table. Extra releases with no change cost nothing to consume.

### Q8 — Does the package read only the version phax writes, or every version phax has ever written?

- Every version ever written, each with its frozen decoder — abandons: a package that is only phax's current decoder: it carries historical decoders phax no longer runs
- Only the version phax writes, like phax itself — abandons: reading history: the cockpit could not read the 6 version-1 phase records already on the records branch

Recommendation: Every version ever written, each with its frozen decoder — Decided by the author on 2026-09-28. Git keeps every document phax ever wrote, and the first consumer reads that history, so every version stays readable. phax, the writer, keeps its no-shims rule.

### Q9 — What does a parse function return on a history that mixes versions?

- The exact shape of the document's version, plus a pure toLatest that marks missing facts `unknown` — abandons: a single shape at the call site: the consumer upgrades explicitly
- The exact shape only — abandons: a shared upgrade path: each consumer writes its own
- Always the latest shape — abandons: the original shape, and honesty about absent facts, which must be given a value

Recommendation: The exact shape of the document's version, plus a pure toLatest that marks missing facts `unknown` — Decided by the author on 2026-09-28, as recommended.

### Q10 — How does a document say which format it is and which phax release produced it?

- A required `producedBy` field in every persisted format — abandons: unchanged formats: each format bumps its version once to add the field
- A `Phax-Version` trailer on phax's commits — abandons: provenance for files never committed (run directory, registry), and a lookup of the commit for every document
- Both — abandons: a single place: the trailer duplicates the field
- One `$schema` URL per document, `https://docs.phax.run/schemas/<format id>/<release>.json`: format id and producing release together — abandons: a version marker independent of phax releases, and a URL host that must stay stable

Recommendation: One `$schema` URL per document, `https://docs.phax.run/schemas/<format id>/<release>.json`: format id and producing release together — Decided by the author on 2026-09-28, after a second look: a file name or location does not identify a format (renames, several files of one format, one schema for a set of files), so every document carries its format id, and the producing release goes in the same identifier. The `$schema` URL is the convention phax.json already follows, and editors and validators can resolve it once docs.phax.run serves the schemas.

### Q11 — Must experimental formats bump their version on every shape change too?

- Yes: experimental means no promise that a shape lasts, not no version — abandons: changing an experimental shape freely under the same version
- Only stable formats bump — abandons: a readable history for experimental formats

Recommendation: Yes: experimental means no promise that a shape lasts, not no version — Superseded on 2026-09-28 by q-format-version: with the release in `$schema`, every shape change of every format, experimental included, is recorded by the snapshot gate at the release that makes it; no manual bump remains. The authoring record shows the cost of the old way: two shapes under version 1.

### Q12 — How is it guaranteed that no shape change escapes a bump and that the whole history stays readable?

- Committed JSON Schema snapshots per version checked by the gate, and a history corpus parsed at every release — abandons: a lighter gate: two more checks and a committed corpus
- The history corpus only — abandons: catching a forgotten bump before the release
- A written rule checked in review — abandons: a mechanical guarantee — the rule that let the authoring record drift

Recommendation: Committed JSON Schema snapshots per version checked by the gate, and a history corpus parsed at every release — Decided by the author on 2026-09-28, as recommended.

### Q13 — Where do the decoders of versions phax no longer writes live?

- Frozen in the package, one module per version; phax imports only the current one — abandons: one home for every decoder: history lives beside the package, not in src/schemas
- In phax, which keeps every decoder — abandons: a CLI free of dead code, and the no-shims pressure on the writer

Recommendation: Frozen in the package, one module per version; phax imports only the current one — Decided by the author on 2026-09-28, as recommended. Refined on 2026-09-28 (q-own-legacy): phax itself reads a file it wrote in an older shape through these decoders and `toLatest`.

### Q14 — With `$schema`, does each format keep its own `version` literal?

- No: the release in `$schema` is the only version of a new document; the package maps releases to shapes — abandons: a per-format counter a human reads at a glance; legacy documents keep theirs
- Keep `version` and bump it on every shape change, beside `$schema` — abandons: a single source: two version markers that can disagree, and a bump to remember

Recommendation: No: the release in `$schema` is the only version of a new document; the package maps releases to shapes — Decided by the author on 2026-09-28, as recommended.

### Q15 — Once every document names its shape and every shape stays readable, is there still a stable / experimental split?

- No: one entry, every format; a format has shapes, not a stability class — abandons: a marking at the import that says 'this may change': every format now may change, and every change stays readable
- Keep a separate experimental entry — abandons: one entry and one `parseDocument`; a split that no longer protects the reader from anything

Recommendation: No: one entry, every format; a format has shapes, not a stability class — Decided by the author on 2026-09-28: experimental meant a shape could change unannounced; once a document can always be parsed, the distinction is moot.

### Q16 — Which release does `$schema` name, and how is an unreleased shape named?

- The root `package.json` version; an unreleased shape is the `next` snapshot, renamed by `release.sh` — abandons: a development build naming its own shape: it writes the last cut release, and its documents are not read before a release
- A committed constant naming the upcoming release — abandons: a single version source: a third place a release must bump

Recommendation: The root `package.json` version; an unreleased shape is the `next` snapshot, renamed by `release.sh` — Decided by the author on 2026-09-28: a schema is consumed only after it is published, so the release that cuts it names it.

### Q17 — How does phax read a file it wrote in an older shape (its registry, a run's status)?

- Through the package's historical decoders and `toLatest`, refusing when a needed fact is unknown — abandons: a CLI that imports only its current decoders
- A one-step lift of the previous `version` inside phax — abandons: a single read path: a second one beside the package
- Refuse and name a migration command — abandons: an upgrade with no gesture

Recommendation: Through the package's historical decoders and `toLatest`, refusing when a needed fact is unknown — Decided by the author on 2026-09-28, as recommended.

## 10. Implementation-planning note

Settled:

- The Parsed result shape; Effect schemas and types are exported too.
- Parity with phax's own decoders, including per-format excess-property handling.
- effect is a regular dependency with the same range as phax.
- The version is lockstep with phax, bumped by release.sh and published by the release workflow as a staged publish beside @lbdremy/phax.
- ESM only.
- Reading history (2026-09-28): every format version ever written parses with its frozen decoder and returns its exact shape; toLatest upgrades in memory and marks absent facts unknown; a newer version fails naming the package to upgrade.
- The history corpus is extracted from git by a committed script and parsed at every release.
- Identification (2026-09-28): every document phax writes starts with `$schema: https://docs.phax.run/schemas/<format id>/<release>.json` and carries no `version`; `parseDocument` identifies a document by it alone; shapes are named by their release, legacy shapes by their literal; a shape change is recorded as a snapshot at its release by the gate. The authoring record's two legacy version-1 shapes are both accepted.
- Package name @lbdremy/phax-schemas: one entry carrying every persisted format (§5 list) and a json/ directory with one draft-07 JSON Schema per format, describing its latest shape; no stable/experimental split (q-no-experimental).
- `$schema` names the root package.json version; unreleased shapes are `next` snapshots renamed by release.sh (q-release-name). phax reads its own older files through the package (q-own-legacy).

Left open:

- Where the package manifest and its entry modules live in the repo, and how its build is driven (a second tsc project over the same sources, or equivalent).
- Spellings of parse functions, schema and type aliases and JSON Schema file names.
- How the parity corpus is shared between phax's tests and the package's tests.
- Whether the tarball install smoke also runs in pnpm check:full or only in the release workflow.
- The exact URL path under docs.phax.run and the spelling of the unknown marker.
- Where the corpus script finds the records history when records live in another repository (the phax-records destination): a path argument, or the records configuration.

Constraints:

- Build from the same src/schemas modules phax imports, with no copied schema. A change to a format must change the package in the same commit.
- The entry closure reaches phaxConfig.ts (through runRecord's SurfaceSchema) and domain/branded.ts (through status's BranchNameSchema). Both must stay free of I/O, and vibeOutput.ts (node:fs) must be unreachable from any entry. An architectural guard should enforce this closure.
- No persisted format changes shape, phax's own decoding is unchanged, and the CLI does not change. The no-shims policy holds.
- In the release workflow, every step that can fail runs before the first npm stage publish. The hand-approval step now covers two packages.
- knip must treat the package entries as public entry points, so it does not flag their exports as unused.
- With approvals files versioned, artifact-decide's unattributed approvals need no rewrite of history: phax migrates the live ledger, and the package reads older ledger versions as they are.
- Several Approved specs change formats this package exports (oracle-phases, artifact-decide, headless-review). Whatever lands in one release forms one shape at that release: its snapshot is rewritten until the release is cut, never after.
- The `$schema` URLs must resolve: the docs.phax.run release pipeline (NEXT_STEPS) serves every release's schema of every format at `/schemas/<format id>/<release>.json`, and never removes one.
- The code-review document joins the package in the release that ships the headless-review spec, not before.

## 11. Docs page

Page: README.md §"Read phax files from code" (a section beside the persisted-formats table)

Reader: Someone writing a tool, such as a dashboard, a cockpit or a docs pipeline, that reads phax's registry, run files, approvals or records and wants phax's own types and verdicts instead of a hand-written parser.

Example: npm install @lbdremy/phax-schemas, then the §6 read-record.mjs script: git show phax/records/v1:<runId>/phase-01/record.json, parsePhaseRecord(JSON.parse(raw)), branch on parsed.ok, then read parsed.value.outcome. It ends with a pointer to json/<format>.schema.json for docs tooling and a note that every document stays readable: an older shape parses, a newer release asks to upgrade the package.
