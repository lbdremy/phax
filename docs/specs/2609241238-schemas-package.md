---
status: Draft
date: 2026-09-24
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
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

## 2. Problem

Today a tool that wants to read what phax wrote has two options, and both are wrong. The first is to write its own parser from phax's source. That creates a second decoder that drifts silently the first time phax bumps a format (the phase record manifest is already at version 2 and gained verifiedSurfaces in 0.10), and it will accept and reject documents differently from phax. The second is to depend on phax's source tree. That pulls in the CLI, the adapters and every internal schema, and says nothing about which formats are safe to depend on. Neither option gives the cockpit typed reads or gives the docs pipeline a JSON Schema per format. Neither tells a consumer which formats are experimental: the README table names three, but nothing in code carries that marking to where a consumer imports. There is also a risk on the other side. Publishing every schema in src/schemas as public API would freeze internal formats that the 1.0 promise never covered.

## 3. Product goal

Publish phax's persisted-format decoders as a small, standalone, typed npm package, released at the same version as phax. The package ships the schemas phax actually uses, not a copy. A third-party reader then gets the same accept or reject verdict phax would give on any document, a TypeScript type for the decoded value, and a JSON Schema for its docs. The import path itself tells the reader whether the format it depends on is stable or experimental.

> The package is phax's own decoder, published: it accepts exactly what phax accepts, and exports exactly the formats phax promises (stable) or admits to (experimental), with nothing internal.

## 4. Terminology

- **Persisted format** — A JSON document that phax writes and that a third party can read later. It is identified by where it lives and by its version literal, for example run-status.json with version 1.
- **Stable format** — A persisted format inside phax's 'version: 1' stability promise. Any change to its shape bumps its version literal.
- **Experimental format** — A persisted format that may change between releases without a version bump. The README lists every such format.
- **Schemas package** — The npm package @lbdremy/phax-schemas described by this spec.
- **Entry** — An import path of the schemas package. The root entry (@lbdremy/phax-schemas) carries the stable formats. The experimental entry (@lbdremy/phax-schemas/experimental) carries the experimental ones.
- **Parse function** — A schemas-package function that takes an already-JSON-parsed value of unknown type and returns a Parsed result. The result is either the typed value or a failure with a path and a message.
- **Parity** — A parse function has parity when it gives the same accept or reject verdict as phax's own decoder for that format on every document, including how it treats unknown keys.
- **Record manifest** — A record.json on phax/records/v1. There are two kinds: a phase record (version 2, keyed <runId>/<phaseId>) and an authoring record (kind "authoring", version 1, keyed authoring/<authoringId>).
- **Lockstep version** — The schemas package's version always equals the version of the phax release whose tag produced it.

## 5. Functional requirements

### 5.1 Standalone package

The system shall publish its persisted-format schemas as a standalone npm package, @lbdremy/phax-schemas, that installs and imports without the phax CLI, its binaries or its source tree.

### 5.2 Runtime dependencies

The schemas package shall declare effect as its only runtime dependency.

### 5.3 No side effects

The schemas package shall contain no code that reads files, spawns processes, opens network connections or references a node: or Deno built-in.

### 5.4 Stable formats on the root entry

The schemas package's root entry shall export a schema, a TypeScript type and a parse function for exactly these stable formats: run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals and phase record manifest.

### 5.5 Experimental formats on the experimental entry

The schemas package's experimental entry shall export a schema, a TypeScript type and a parse function for exactly these experimental formats: spec document, plan document, authoring record manifest and the record-manifest union of phase and authoring records.

### 5.6 One stability classification

The schemas package's stable or experimental marking of each format shall equal that format's stability in the README persisted-formats table.

### 5.7 Nothing internal

The schemas package shall export no internal schema and no module of phax's app, ports, infra or cli layers. Internal schemas are provider output streams, config layers (phax.json and the user overlay), gate, reconciliation and session documents, the extraction cache, and orient and plan-audit responses.

### 5.8 Same verdict as phax

WHEN a schemas-package parse function is given a document THE schemas package SHALL accept it if and only if phax's own decoder for that format accepts it, applying the same excess-property handling.

### 5.9 Failures are values

IF a document fails to parse THEN the parse function SHALL return a failure carrying the path and message of the first violation, without throwing.

### 5.10 Types match phax

The schemas package shall ship TypeScript declarations whose type for each exported format is the type phax decodes that format to.

### 5.11 JSON Schema per format

The schemas package shall ship one draft-07 JSON Schema file per exported format, generated at build time from the same schema that format's parse function uses.

### 5.12 JSON Schema carries stability

Each JSON Schema file in the schemas package shall declare its format's stability as stable or experimental.

### 5.13 No silent JSON Schema gap

IF an exported format's JSON Schema cannot be generated THEN the schemas package build SHALL fail naming that format.

### 5.14 Lockstep version

The schemas package shall be published at the same version as the phax release whose tag produced it.

### 5.15 Released with phax

WHEN a release tag is pushed THE release workflow SHALL stage-publish the schemas package beside @lbdremy/phax.

### 5.16 All or nothing

IF the schemas package build fails, or its packed tarball cannot be installed into an empty Node project and parse a phax-written document there, THEN the release workflow SHALL stage-publish neither package.

### 5.17 One release commit

WHEN the release script bumps phax's version THE release script SHALL bump the schemas package manifest in the same release commit.

### 5.18 Code-review document when it ships

WHERE a phax release carries the code-review document THE schemas package of that release SHALL export it from the experimental entry.

## 6. Surface

### package: @lbdremy/phax-schemas — normative

    npm install @lbdremy/phax-schemas

    # entries (normative)
    @lbdremy/phax-schemas                             stable formats
    @lbdremy/phax-schemas/experimental                experimental formats
    @lbdremy/phax-schemas/json/<format>.schema.json   one JSON Schema per exported format

### package: @lbdremy/phax-schemas root entry exports — normative

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

    # shared by every parse function
    type Parsed<T>

### package: @lbdremy/phax-schemas/experimental exports — normative

    # format set normative; spellings indicative
    format                    parse function          document it reads
    spec document             parseSpecDocument       JSON sidecar beside a headless-authored spec
    plan document             parsePlanDocument       JSON sidecar beside a headless-authored plan
    authoring record manifest parseAuthoringRecord    phax/records/v1:authoring/<authoringId>/record.json
    record manifest (either)  parseRecordManifest     any record.json on phax/records/v1
    # added from the release that ships review-as-plan:
    code-review document      parseCodeReview         <run-dir>/review/pass-NN/code-review.json

### package: Parsed result — normative

    // shape normative; the name Parsed and the message wording indicative
    type Parsed<T> =
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: { readonly path: string; readonly message: string } };

    parseRunStatus(input: unknown): Parsed<RunStatus>

    // run-status.json with "state": "paused"
    { ok: false, error: { path: "state", message: "Expected \"created\" | \"running\" | …, actual \"paused\"" } }

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
    // import { parseRecordManifest } from "@lbdremy/phax-schemas/experimental";

    $ node read-record.mjs <runId>/phase-01
    <runId> phase-01 committed claude-code
    $ echo $?
    0

### file: json/<format>.schema.json — indicative

    # one file per exported format and a stability declaration in each are normative;
    # file names and the keyword spelling are indicative
    node_modules/@lbdremy/phax-schemas/json/run-status.schema.json
    {
      "$schema": "http://json-schema.org/draft-07/schema#",
      "title": "phax run status",
      "x-phax-stability": "stable",
      "type": "object",
      "required": ["version", "namespace", "shortName", "runId", "state", "createdAt", "updatedAt", "phasesCount"],
      …
    }

    node_modules/@lbdremy/phax-schemas/json/spec-document.schema.json
    { "$schema": "…draft-07…", "title": "phax spec document (experimental)", "x-phax-stability": "experimental", … }

### file: @lbdremy/phax-schemas package.json — indicative

    # name, lockstep version and the single effect dependency normative; the rest indicative
    {
      "name": "@lbdremy/phax-schemas",
      "version": "0.17.0",
      "type": "module",
      "exports": {
        ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
        "./experimental": { "types": "./dist/experimental.d.ts", "default": "./dist/experimental.js" },
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

    # one row per exported format with its stability is normative; wording and columns indicative
    | Format                | Where it lives                                  | Stability    | Read it with                          |
    | Run registry          | `~/.phax/registry.json`                         | stable       | `@lbdremy/phax-schemas`               |
    | Run status            | `<run-dir>/run-status.json`                     | stable       | `@lbdremy/phax-schemas`               |
    | Phase status          | `<run-dir>/<phase-id>/status.json`              | stable       | `@lbdremy/phax-schemas`               |
    | phax-plan             | `<run-dir>/phax-plan.json`                      | stable       | `@lbdremy/phax-schemas`               |
    | Compliance review     | `<run-dir>/compliance-review.json`              | stable       | `@lbdremy/phax-schemas`               |
    | Plan approvals        | `docs/plans/approvals.json`                     | stable       | `@lbdremy/phax-schemas`               |
    | Spec approvals        | `docs/specs/approvals.json`                     | stable       | `@lbdremy/phax-schemas`               |
    | Phase record          | `<runId>/<phaseId>/record.json` on `phax/records/v1` | stable  | `@lbdremy/phax-schemas`               |
    | Spec document         | `.json` sidecar beside a headless-authored spec | experimental | `@lbdremy/phax-schemas/experimental`  |
    | Plan document         | `.json` sidecar beside a headless-authored plan | experimental | `@lbdremy/phax-schemas/experimental`  |
    | Authoring record      | `authoring/<id>/record.json` on `phax/records/v1` | experimental | `@lbdremy/phax-schemas/experimental` |

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
- Writing the 1.0 stability contract itself (a frozen version plus a migration command, or a re-run-init policy). That stays with the Road to 1.0 item. This spec only classifies each exported format as stable or experimental today.
- Any change to a persisted format's shape, to phax's own decoding, or to the CLI. The package republishes what phax already enforces.
- Reading helpers: nothing walks the records branch, finds run directories or reads files. The consumer reads the bytes and hands the package a JSON value.
- Migrating older documents. Under the no-shims policy, a document phax no longer accepts (for example a version-1 phase record) is rejected by the package too.
- A CommonJS build, a JSR or Deno-native publish, or JSON Schemas hosted at a URL. The docs pipeline reads the files from the installed package.
- Parsing spec and plan Markdown frontmatter.
- Exporting the internal formats listed in §5 (provider output streams, gate, reconciliation and session documents, extraction cache, orient, plan-audit, publication, security posture, telemetry events).

## 8. Acceptance criteria

### A Node consumer parses a phase record end to end

Given an empty Node 20 project with no phax installed, in a repo whose phax/records/v1 branch holds a phase record.json written by phax, when the packed @lbdremy/phax-schemas tarball is installed and the §6 consumer script runs with that record's <runId>/<phaseId> key, then it prints the record's runId, phaseId and outcome and exits 0, and the project's node_modules holds only @lbdremy/phax-schemas, effect and effect's own dependencies. (refs §5.1, §5.2)

### The package does no I/O

Given the packed @lbdremy/phax-schemas tarball, when every JavaScript file it contains is scanned for imports and globals, then none imports a node: built-in, fs, child_process or net, and none references Deno. (refs §5.3)

### The root entry exports exactly the stable formats

Given the installed package, when the exports of @lbdremy/phax-schemas are listed, then there is a schema, a type and a parse function for run registry, run status, phase status, phax-plan, compliance review, plan approvals, spec approvals and phase record manifest, and none for any other format. (refs §5.4)

### The experimental entry exports exactly the experimental formats

Given the installed package, from a release that does not carry the code-review document, when the exports of @lbdremy/phax-schemas/experimental are listed, then there is a schema, a type and a parse function for spec document, plan document, authoring record manifest and the record-manifest union, and none for any stable format. (refs §5.5)

### One classification everywhere

Given the README persisted-formats table and the installed package, when each exported format's entry and its JSON Schema stability declaration are compared with its README row, then every exported format has exactly one README row, formats marked stable are on the root entry and declare stable, and formats marked experimental are on the experimental entry and declare experimental. (refs §5.6, §5.12)

### Nothing internal leaks

Given the packed @lbdremy/phax-schemas tarball, when its file list and the exports of every entry are inspected, then no export decodes a provider output stream, phax.json, the user overlay, a gate, reconciliation or session document, the extraction cache, or an orient or plan-audit response, and no file compiled from phax's app, ports, infra or cli layers is present. (refs §5.7)

### Same verdict as phax on every document

Given a corpus of accepted and rejected documents for every exported format, including a phase record.json with one unknown key and a registry.json with one unknown key, when each document is parsed by the package's parse function and by phax's own decoder, then the two verdicts agree on every document: the record with the unknown key is rejected by both, and the registry with the unknown key is accepted by both. (refs §5.8)

### A bad document is a value, not an exception

Given a run-status.json whose state is "paused", when parseRunStatus is called on its parsed JSON, then it returns ok: false with error.path "state" and a non-empty error.message, and no exception escapes. (refs §5.9)

### Package types are phax's types

Given phax's type-test suite and the package's declarations, when a value of each exported package type is assigned to phax's internal type for that format, and the reverse, then both assignments typecheck for every exported format. (refs §5.10)

### Every exported format has a usable JSON Schema

Given the installed package and one phax-written document per exported format, when each json/<format>.schema.json is loaded into a standard draft-07 validator and the matching document is validated, then there is exactly one schema file per exported format and every phax-written document validates. (refs §5.11)

### Stability is readable from the JSON Schema

Given the installed package, when json/spec-document.schema.json and json/run-status.schema.json are read, then the first declares its format experimental and the second declares it stable. (refs §5.12)

### A format without a JSON Schema fails the build

Given an exported format whose schema carries a refinement that has no JSON Schema rendering, when the schemas package build runs, then it exits non-zero naming that format, and the build output has no schema file for that format. (refs §5.13)

### Both packages are staged at the tag's version

Given a signed tag v0.17.0 on a commit whose release gate is green, when the release workflow runs, then @lbdremy/phax@0.17.0 and @lbdremy/phax-schemas@0.17.0 are both staged on npm. (refs §5.14, §5.15)

### A broken package publishes nothing

Given a release commit whose schemas-package tarball fails to install into an empty Node project or fails to parse the smoke document, when the release workflow runs on its tag, then the workflow fails before any npm stage publish step runs, and neither package is staged. (refs §5.16)

### One commit bumps all manifests

Given a clean main at 0.16.0, when scripts/release.sh 0.17.0 runs, then the release commit sets version 0.17.0 in package.json, npm/package.json and the schemas package manifest, and the script's last lines name both staged packages. (refs §5.17)

### The code-review document joins as experimental

Given a phax release that carries the code-review document, when the exports of @lbdremy/phax-schemas/experimental and the package's json/ directory are listed, then there is a code-review parse function and a code-review JSON Schema that declares experimental, and the root entry exports no code-review parser. (refs §5.18)

## 9. Open questions for implementation planning

### Q1 — Should the schemas ship as their own package or as a subpath of the existing @lbdremy/phax package?

- A separate package, @lbdremy/phax-schemas — abandons: single-package releases: every release stages, approves and version-matches a second npm package.
- A subpath, @lbdremy/phax/schemas — abandons: a lightweight dependency: every schema consumer installs the CLI launcher and its platform-binary resolution, and every CLI user installs effect.

Recommendation: A separate package, @lbdremy/phax-schemas — The launcher and the library have disjoint audiences and dependencies. A second staged publish is one more step in a workflow that is already automated and approved by hand, which is a cost worth paying to keep the consumer's install small.

### Q2 — How should the package depend on effect?

- A regular dependency on effect, with the same range as phax — abandons: a guaranteed single copy: a consumer pinned to an incompatible Effect version gets a second copy, and Schema values from the two copies do not compose.
- A peer dependency on effect — abandons: a one-line install: a consumer that does not use Effect must add effect itself and match the range.
- Bundle effect into the package — abandons: interoperability: the exported Schema values belong to a private copy of Effect, so an Effect consumer cannot compose them.

Recommendation: A regular dependency on effect, with the same range as phax — The first consumer is not assumed to use Effect. With a regular dependency, npm install @lbdremy/phax-schemas is the whole install, and package managers dedupe within ^3 for consumers that do use Effect.

### Q3 — What should a parse call return?

- A plain Parsed result ({ ok, value } or { ok, error: { path, message } }), with the Effect schemas also exported — abandons: a single API: each format has both a parse wrapper and its schema, and they must stay in step.
- Effect's Either<T, ParseError>, the decodeX functions phax uses internally — abandons: use without Effect: a non-Effect consumer must learn Either and how to format a ParseError before reading one field.
- Return the value or throw — abandons: failures as values: a consumer walking many records has to wrap each call in try/catch to keep going.

Recommendation: A plain Parsed result ({ ok, value } or { ok, error: { path, message } }), with the Effect schemas also exported — The wrapper is generated from the same schema, so it can drift in spelling but not in verdict. Effect consumers still get the schemas directly, and non-Effect consumers get a result they can read without learning Effect.

### Q4 — Should parse functions reject unknown keys the way phax does?

- Parity: each format keeps phax's own excess-property setting — abandons: forward compatibility: an older package rejects a record that a newer phax wrote with a new key, so the reader has to upgrade to match the writer.
- Lenient: every parse function ignores unknown keys — abandons: the package's central claim: it would accept documents phax itself rejects, and a mistyped or foreign key would go unnoticed.

Recommendation: Parity: each format keeps phax's own excess-property setting — The package exists to be phax's decoder rather than a second one. Lockstep versioning makes the upgrade path explicit: a reader pins the package to the phax version that writes its files.

### Q5 — How should the package mark a format as experimental?

- A separate experimental entry (@lbdremy/phax-schemas/experimental) — abandons: a stable import path across graduation: when a format becomes stable, its import line moves and every consumer must edit it.
- A JSDoc @experimental tag on root-entry exports — abandons: visibility at the point of use: nothing in the import line or at compile time shows that a consumer depends on an experimental format.

Recommendation: A separate experimental entry (@lbdremy/phax-schemas/experimental) — The import line is where a consumer takes on the dependency, so it is the right place to acknowledge the risk. A graduation that forces an edit is a feature, because the consumer sees the format change status.

### Q6 — While the 1.0 promise is still unwritten, should records, approvals and the compliance review be marked stable?

- Stable: registry, run and phase status, phax-plan, compliance review, both approvals files and the phase record manifest — abandons: freedom to reshape the record manifest, the approvals files or the compliance review before 1.0 without bumping their version literal.
- Experimental until the 1.0 promise is written — abandons: a stable footing for the first consumer: the cockpit would be built on formats phax says may change without notice.

Recommendation: Stable: registry, run and phase status, phax-plan, compliance review, both approvals files and the phase record manifest — The promise draft in NEXT_STEPS already names approvals.json and phax/records/v1, and the README's 'run formats' covers the files in the run directory. The cockpit exists to read records. Stable already means only that a shape change bumps the version literal, and phax has done this before (the record manifest went from 1 to 2).

### Q7 — How should the package be versioned?

- Lockstep: always the phax release version — abandons: meaningful version numbers: the package publishes new versions with no schema change, so a version bump does not signal a format change.
- Independent semver that moves only when a format changes — abandons: the mapping from writer to reader: a consumer can no longer tell which package version reads the files a given phax release wrote.

Recommendation: Lockstep: always the phax release version — The question a reader asks is which package reads what phax X.Y.Z wrote, and lockstep answers it with no lookup table. Extra releases with no change cost nothing to consume.

## 10. Implementation-planning note

Settled:

- Package name @lbdremy/phax-schemas, with a root entry for stable formats, an experimental entry and a json/ directory.
- The exact format sets in §5 and their stable or experimental classification, mirrored by a single README persisted-formats table.
- The Parsed result shape; Effect schemas and types are exported too.
- Parity with phax's own decoders, including per-format excess-property handling.
- effect is a regular dependency with the same range as phax.
- The version is lockstep with phax, bumped by release.sh and published by the release workflow as a staged publish beside @lbdremy/phax.
- One draft-07 JSON Schema per exported format ships inside the package, each declaring its stability.
- ESM only.

Left open:

- Where the package manifest and its entry modules live in the repo, and how its build is driven (a second tsc project over the same sources, or equivalent).
- Spellings of parse functions, schema and type aliases, JSON Schema file names and the stability keyword.
- How the parity corpus is shared between phax's tests and the package's tests.
- Whether the tarball install smoke also runs in pnpm check:full or only in the release workflow.
- The README section title and its anchor, and how the headless-authoring section's link to 'Experimental formats' is updated.

Constraints:

- Build from the same src/schemas modules phax imports, with no copied schema. A change to a format must change the package in the same commit.
- The entry closure reaches phaxConfig.ts (through runRecord's SurfaceSchema) and domain/branded.ts (through status's BranchNameSchema). Both must stay free of I/O, and vibeOutput.ts (node:fs) must be unreachable from any entry. An architectural guard should enforce this closure.
- No persisted format changes shape, phax's own decoding is unchanged, and the CLI does not change. The no-shims policy holds.
- In the release workflow, every step that can fail runs before the first npm stage publish. The hand-approval step now covers two packages.
- knip must treat the package entries as public entry points, so it does not flag their exports as unused.
- This spec does not decide the 1.0 migration policy. It only records today's stable or experimental split, which the Road to 1.0 promise will adopt or revise.
- The code-review document joins the experimental entry in the release that ships the headless-review spec. The package must not export it before then.

## 11. Docs page

Page: README.md §"Read phax files from code" (a section beside the persisted-formats table)

Reader: Someone writing a tool, such as a dashboard, a cockpit or a docs pipeline, that reads phax's registry, run files, approvals or records and wants phax's own types and verdicts instead of a hand-written parser.

Example: npm install @lbdremy/phax-schemas, then the §6 read-record.mjs script: git show phax/records/v1:<runId>/phase-01/record.json, parsePhaseRecord(JSON.parse(raw)), branch on parsed.ok, then read parsed.value.outcome. It ends with a pointer to json/<format>.schema.json for docs tooling and a note that /experimental formats may change between releases.
