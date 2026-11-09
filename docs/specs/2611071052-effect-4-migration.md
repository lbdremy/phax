---
status: Approved
date: 2026-11-07
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-11-09
  baseline: e35a876
---
# Effect 4 migration

## 1. Context

phax and its schemas package, @lbdremy/phax-schemas, run on Effect 3 (effect ^3.14.0). The package is built from phax's own schema sources, published at phax's version, and exports Effect 3 Schema values beside its parse functions. phax also lists @effect/platform and @effect/platform-node as dependencies, which nothing in src imports, plus a pnpm packageExtensions block that exists only for them.

Effect 4.0 shipped on 2026-10-06; the current release is effect@4.1.2. Effect 3.x gets fixes until at least September 2029. Effect publishes a migration reference in Effect-TS/effect under migration/: MIGRATION.md, 13 topic guides (cause, equality, error-handling, fiber-keep-alive, fiberref, forking, generators, layer-memoization, runtime, schema, scope, services, yieldable), and v3-to-v4.md, generated from the API diff (about 17,000 lines). v3-to-v4.md has an Import Map, the No Counterpart Imports and Removed Modules sections, and an API Reference with one line per v3 symbol, written as `Old.symbol` -> `New.symbol`: rationale, with removals written as -> none. A script can read it as data. The official agent skill effect-v3-to-v4 (Effect-TS/skills) migrates package.json first, type-checks, then resolves each error by searching the reference, escalating to a topic guide and then to the v4 source. It forbids a compatibility layer, any or as used to silence an error, and invented API. It also clones two Effect repositories over the network and hands per-file work to sub-agents. There is no official v4 codemod: @effect/codemod stops at 3.0.4. A codemod.com registry entry with no named publisher rewrites to the beta-era ServiceMap.Service, which is Context.Service in the 4.1 reference.

On 2026-10-07 a spike with nothing committed measured 1,502 type errors in 224 src files and 2,910 in 443 test files. Most come from about ten mechanical root causes: the Either module is gone (Effect.either, Schema.decodeUnknownEither becomes decodeUnknownExit), Context.Tag becomes Context.Service on the ports, Schema filters become .check(...), Schema.optionalWith changes, Effect.catchAll and Effect.orElse become Effect.catch, and ParseResult becomes SchemaIssue.

Several parts of phax depend on Effect's exact output. First, every refusal line, which formatError renders from ParseResult.ArrayFormatter issues. Some of its formatters match message texts to build their lines. Second, the JSON Schema snapshots under packages/schemas/snapshots/: a generated schema that differs from the latest released snapshot forces a `next` snapshot and moves the format's stamp. Third, the 63 frozen decoders under src/schemas/history/, whose bytes are locked in packages/schemas/history.lock.json. Phase sessions reach only their provider's network.

Ground read:

- `docs/briefs/effect-4-migration.md` — The operator's brief: why now, the spike's numbers, what Effect 4 provides, the five settled directions, the constraints and what is out of scope.
- `package.json` — effect ^3.14.0, @effect/platform ^0.96.0 and @effect/platform-node ^0.106.0 as dependencies; a pnpm packageExtensions block that exists only for @effect/platform-node(-shared); typescript ^7.0.2 (native compiler) and oxc-parser 0.128.0 already pinned.
- `packages/schemas/package.json` — @lbdremy/phax-schemas 0.36.0, published at phax's version, depends only on effect ^3.14.0.
- `packages/schemas/src/index.ts` — The package exports Effect Schema values (RegistrySchema, PhaxPlanSchema, SpecDocumentSchema and the rest) beside its parse functions.
- `src/schemas/formatError.ts` — Every refusal line is built on ParseResult.ArrayFormatter, and several formatters match the message texts `is missing`, `is unexpected` and `Expected X, actual Y` to shape their lines.
- `packages/schemas/build/snapshots.ts` — A released snapshot never changes; a generated JSON Schema that differs from the latest released snapshot (parsed JSON, annotations aside) must be recorded as `next`, which moves the format's stamp at release.
- `scripts/schemas-check.ts` — Holds packages/schemas/history.lock.json to the bytes of every frozen module under src/schemas/history/, and every format's snapshots to what its current decoder renders.
- `src/schemas/history/` — 63 frozen decoders, one per released shape phax still reads.
- `src/ports/` — Eleven ports declared with Context.Tag: fs, git, shell, github, editor, lock, terminal, prompt, session, backend, systemTelemetry.
- `phax.json` — One gate profile, `standard`, whose steps fire `every-phase` or `terminal`; `pnpm exec tsx` and `pnpm add` are allowed agent commands.
- `NEXT_STEPS.md` — Section 8 puts the migration before the CLI contract freeze and the persisted-format promise.
- `docs/specs/archive/2611031738-command-contracts.md` — The command library was ported into phax on Effect 3; its move to Effect 4 and its replacement by the published package were left to a later spec.

## 2. Problem

Every command added on Effect 3 makes the migration larger. The schemas package exports Effect 3 Schema values and depends on effect ^3.14, so moving after 1.0 would mean a breaking major of the package and of every consumer that composes its schemas. NEXT_STEPS section 8 therefore puts the migration before the CLI contract freeze and the persisted-format promise.

The work cannot be done well either by hand or by an agent alone. There are about 4,400 type errors. Most of them are renames that an agent would apply inconsistently and at high cost, file by file. The rest are changes where behaviour can slip silently: a refusal message worded differently, a JSON Schema whose text changes and so bumps the stamp of every format, a frozen decoder that starts to accept what it refused. Nothing available today does the mechanical part correctly. The registry codemod writes names that 4.1 does not have, and the official skill needs network access that phase sessions lack, plus sub-agents that a plan cannot review. A plan whose phases may change anything also leaves a reviewer unable to tell what each phase was allowed to touch.

## 3. Product goal

phax and @lbdremy/phax-schemas run on a single Effect 4.x version, and no consumer sees a difference: every command's text and --json answer, every exit code, every refusal line, every persisted format and its stamp, and every record reader behave as they did on Effect 3. phax's own deterministic codemod does the mechanical rewrites and measures them by type-error counts. Plan phases then do the rest, each following one named project skill that states what it may change, with the Effect reference read at a pinned tag and without network access. Any behaviour the migration cannot keep is named in this spec, together with what replaces it.

> The migration changes how phax is written, never what phax does: a difference a consumer can observe is either named here or a defect.

## 4. Terminology

- **codemod** — phax's own deterministic source rewriter for this migration, committed in the repository. It applies a fixed table of rules to src, tests, scripts and packages/schemas, and reports what it did and what it left.
- **rule** — One codemod rewrite that addresses one root cause measured in this repository. Each rule names the line of the reference that gives its v4 target.
- **reference** — Effect's migration material at the pinned tag: MIGRATION.md, the 13 topic guides and v3-to-v4.md.
- **v3 symbol** — An Effect 3 import or member that the reference maps to a different v4 symbol, or to none.
- **lookup skill** — The project skill, derived from the official effect-v3-to-v4 skill, that says how to resolve one error: search the reference, then the topic guide, then the installed v4 source. It never clones or fetches anything.
- **topic skill** — A project skill for one area of the migration (services, schema, error handling and so on). It states which files and symbols a phase following it may change, and how.
- **frozen decoder** — A module under src/schemas/history/ that reads one released shape of a persisted format, and whose bytes are locked in packages/schemas/history.lock.json.
- **refusal line** — The text phax prints, or the package returns, when a decode refuses input, in the form `<path>: <message>` or a formatter's own variant of it.
- **behaviour corpus** — Inputs for every format, frozen decoder and config layer (accepted and refused), captured on Effect 3 together with their decoded values or refusal lines before the migration changes any source, and replayed after it.
- **error ratchet** — A gate that fails a phase when the type-error count of src or of the test suite is higher at the end of the phase than at its start.

## 5. Functional requirements

### 5.1 One Effect 4 version

phax and @lbdremy/phax-schemas shall each depend on the same single 4.x version of effect and on no other Effect package, with the @effect/platform and @effect/platform-node dependencies and their packageExtensions entries removed.

### 5.2 Codemod runs pinned code only

The codemod shall run only code pinned in devDependencies and the reference committed or staged at the pinned tag, and shall fetch nothing over the network at run time.

### 5.3 Codemod is deterministic and idempotent

WHEN the codemod runs on a tree it has already rewritten THE codemod SHALL change no file.

### 5.4 Codemod applies only its rule table

The codemod shall rewrite only occurrences matched by a rule in its table, and every rule shall name the reference line that gives its v4 target.

### 5.5 Codemod rewrites only Effect's symbols

IF an identifier a rule matches does not resolve to the effect package THEN the codemod SHALL leave it unchanged.

### 5.6 Codemod reports what it left

WHEN the codemod finishes THE codemod SHALL list every v3 symbol still present, by file and line, with the reference line it maps to and the topic skill that owns it.

### 5.7 Codemod effect is measured and recorded

WHEN the codemod finishes THE codemod SHALL print the type-error counts of src and of the test suite before and after its rewrites, and the commit that applies it SHALL carry those four numbers and the rewrite count of each rule in its body.

### 5.8 Reference readable without network

The reference at the pinned tag shall be readable by every phase session of the migration without network access.

### 5.9 Skills state what they may change

The repository shall carry one lookup skill and one topic skill per migration area, and each topic skill shall state the files and v3 symbols a phase following it may change.

### 5.10 Each phase names one skill

Each phase of a migration plan shall name exactly one topic skill it follows, or the codemod, as the source of what it may change.

### 5.11 No compatibility layer, no silencing

IF a change adds a compatibility module, an `any` type or an `as` assertion that stands in for a type the migration broke, or a reference to an API absent from both the reference and the installed v4 source THEN the migration SHALL refuse that change before merge. `as const` and the brand casts that build test fixtures are not silencing.

### 5.12 No v3 symbol left

When the migration is complete, the codemod's report shall list no v3 symbol, and the type-error counts of src and of the test suite shall be zero.

### 5.13 Commands behave as before

Every command shall print the same text, give the same --json answer and exit with the same code as on Effect 3 for the same input and state.

### 5.14 Test expectations do not move

The migration shall change no expected value in any test (text, JSON, exit code, decoded value or refusal line).

### 5.15 Refusal lines are phax's own

WHEN a decode refuses an input THE system SHALL render the refusal line from phax's own refusal model (a path, a kind, an expected label and the actual value), which one adapter builds from the installed Effect's issues, with the line the behaviour corpus holds, including the `is missing`, `is unexpected` and `Expected X, actual Y` messages; a whole type SHALL be named by its kind (`an object`, `an array`, `a tuple`, `one of …`), never by Effect's description of it, and no formatter in src or packages/schemas SHALL match on Effect's message text.

### 5.16 Frozen decoders keep their behaviour

Each frozen decoder shall accept and refuse the same inputs as on Effect 3, with the same decoded value or the same refusal line, as replayed from the behaviour corpus.

### 5.17 History lock refreshed once, named

WHEN the migration rewrites a frozen decoder's bytes THE migration SHALL refresh packages/schemas/history.lock.json in the same commit, whose body names the refresh as the Effect 4 migration's.

### 5.18 No persisted format bump

The migration shall record no `next` snapshot, move no format stamp and add no frozen decoder.

### 5.19 JSON Schemas accept the same documents

The schemas check shall compare each format's JSON Schema generated on Effect 4 with its latest released snapshot by the behaviour-corpus documents each accepts and refuses, not by text; the released snapshots and the JSON Schemas the package ships shall stay byte-identical to 0.36.0's, and the corpus shall exercise every field of every format.

### 5.20 Package exports Effect 4 schemas under the same names

@lbdremy/phax-schemas shall export Effect 4 Schema values under the export names it has at 0.36.0, and its parse functions shall return the same results for the same inputs.

### 5.21 Consumers are told

WHEN the release carrying the migration is cut THE release SHALL carry a docs/upgrading.md entry and a package README note saying that the package's Schema values are Effect 4 values and which effect version a consumer composing them needs.

### 5.22 Every phase ends no worse

WHILE the migration is partial THE gates of each phase after the one that installs Effect 4 and applies the codemod SHALL hold the type-error counts of src and of the test suite at or below the counts the previous phase recorded, and SHALL fail when a test that passed at the phase's base fails, is skipped or no longer exists; the phase that installs Effect 4 and applies the codemod records the first counts and the first set of passing tests, and the last phase SHALL run the full standard profile.

### 5.23 Project guidance speaks Effect 4

WHEN the migration is complete THE project guidance (CLAUDE.md and the project skills) SHALL name Effect 4 and show no v3 symbol except as a cited before in a migration skill.

## 6. Surface

### config: package.json dependencies — normative

Summary: phax installs one Effect 4 version and no platform packages.

before:

    "dependencies": {
      "@effect/platform": "^0.96.0",
      "@effect/platform-node": "^0.106.0",
      "effect": "^3.14.0",
      ...
    },
    "pnpm": { "packageExtensions": { "@effect/platform-node": {...}, "@effect/platform-node-shared": {...} } }

after:

    "dependencies": {
      "effect": "^4.1.2",
      ...
    }

### package: @lbdremy/phax-schemas — normative

Summary: Consumers get the same exports and parse functions, with Schema values that compose with Effect 4.

before:

    "dependencies": { "effect": "^3.14.0" }

    import { RegistrySchema, parseRegistry } from "@lbdremy/phax-schemas";
    // RegistrySchema: an Effect 3 Schema

after:

    "dependencies": { "effect": "^4.1.2" }

    import { RegistrySchema, parseRegistry } from "@lbdremy/phax-schemas";
    // RegistrySchema: an Effect 4 Schema; parseRegistry(raw) returns the same { ok, shape, value } or { ok: false, error }

### cli: refusal lines — normative

Summary: Refusals read exactly as they did before the migration.

before:

    $schema: is missing; version: is unexpected
    acceptanceCriteria[2].refs[0]: is missing
      gate step "pnpm test": output must be "log" or "gate-report"

after:

    $schema: is missing; version: is unexpected
    acceptanceCriteria[2].refs[0]: is missing
      gate step "pnpm test": output must be "log" or "gate-report"

### cli: pnpm codemod:effect4 — indicative

Summary: A maintainer can apply the mechanical Effect 4 rewrites in one command and read what they fixed and what they left.

    $ pnpm codemod:effect4
    rule                    files  rewrites  reference
    either-to-result           61       418  v3-to-v4.md:<line>
    schema-decode-either       48       203  v3-to-v4.md:<line>
    context-tag                11        11  v3-to-v4.md:<line>
    schema-filters             37       156  v3-to-v4.md:<line>
    ...
    type errors   before  after
      src           1502    <n>
      tests         2910    <n>
    left to phases (<n>):
      schema  src/schemas/formatError.ts:4  ParseResult.ArrayFormatter -> <target>  v3-to-v4.md:<line>
      ...

    $ pnpm codemod:effect4 --check
    0 files would change

### file: vendored reference — indicative

Summary: Phase sessions and the codemod read Effect's migration reference at the pinned tag from the repository.

    vendor/effect-migration/effect@4.1.2/
      SOURCE            # repository, tag, commit, licence
      MIGRATION.md
      v3-to-v4.md
      migration/cause.md ... migration/yieldable.md   (13 guides)

### file: migration skills — indicative

Summary: A plan reader sees which skill each phase follows and what that skill lets it change.

    .claude/skills/effect4-lookup/SKILL.md     # resolve one error: reference, then guide, then node_modules/effect source
    .claude/skills/effect4-services/SKILL.md   # Context.Tag ports and layers; may change src/ports, src/infra layers, their tests
    .claude/skills/effect4-schema/SKILL.md     # Schema, formatError, JSON Schema generator, frozen decoders, packages/schemas
    .claude/skills/effect4-errors/SKILL.md     # Result, Exit, Cause, catch; may change error handling in app and infra

    Plan phase instructions, first line:
    - Follows skill: effect4-schema (with effect4-lookup for every symbol).

### config: phax.json gate profile effect-migration — indicative

Summary: A migration run can stay green in each phase while type errors are worked down, and runs the full gate at its end.

before:

    "gateProfiles": { "standard": [ ... ] }

after:

    "gateProfiles": {
      "standard": [ ... ],
      "effect-migration": [
        { "command": "pnpm format", "surface": "local", "firing": "every-phase" },
        { "command": "pnpm codemod:effect4 --ratchet", "surface": "local", "firing": "every-phase" },
        { "command": "pnpm lint", "surface": "local", "firing": "every-phase" },
        { "command": "pnpm check:full", "surface": "local", "firing": "terminal" },
        { "command": "pnpm build", "surface": "product", "firing": "terminal" }
      ]
    }

### file: docs/upgrading.md — indicative

Summary: Upgraders learn that phax now runs on Effect 4 and what that means for code composing the package's schemas.

before:

    ### 0.35.0
    ...

after:

    ### 0.37.0

    phax runs on Effect 4. Commands, files and refusals are unchanged.

    - @lbdremy/phax-schemas: its exported Schema values (RegistrySchema, PhaxPlanSchema, ...) are Effect 4 schemas. Code that composes them needs effect ^4.1.2; code that only calls the parse functions changes nothing.
    - The published JSON Schemas are unchanged; phax checks the ones Effect 4 generates against them by the documents they accept.

## 7. Non-goals

- Using Effect 4 features the migration does not need: the CLI module, the HTTP client, the new runtime options.
- The CLI contract freeze and the persisted-format stability promise (NEXT_STEPS section 8), which come after.
- Upgrading dependencies other than Effect's, except where Effect 4 requires it.
- Replacing phax's port of the command library with its published package: the port is migrated in place.
- A general-purpose Effect 3 to 4 codemod: the rules cover the root causes measured in this repository only.
- Any change to a persisted format, a command, a flag, an exit code or a message.
- A compatibility module (v3-compat or similar) in src, tests or packages/schemas, even temporarily.

## 8. Acceptance criteria

### One Effect version, no platform packages

Given the migrated tree, when pnpm list --depth Infinity runs and both package.json files are read, then exactly one effect 4.x version is installed, both package.json files name it, and no @effect/platform, @effect/platform-node or packageExtensions entry for them remains. (refs §5.1)

### Codemod runs offline from pinned code

Given a fresh install with the network disabled, when `pnpm codemod:effect4` runs on the Effect 3 tree, then it completes, and every package it loads is listed in devDependencies at a pinned version. (refs §5.2)

### Second run changes nothing

Given a tree the codemod has just rewritten, when `pnpm codemod:effect4 --check` runs, then it reports 0 files would change and git status is clean. (refs §5.3)

### Every rewrite traces to a rule and a reference line

Given the codemod's fixture tests, one input and expected output per rule, when the tests run, then each rule's output matches its fixture, each rule names a line that exists in the vendored v3-to-v4.md, and a fixture with an Effect symbol no rule covers is left byte-identical. (refs §5.4)

### Local namesakes untouched

Given a fixture declaring its own Either type and a catchAll function not imported from effect, when the codemod runs on it, then the fixture is unchanged. (refs §5.5)

### Leftovers listed by owner

Given a fixture containing ParseResult.ArrayFormatter, which no rule rewrites, when the codemod runs, then the report lists it by file and line under the schema topic skill, with its reference line. (refs §5.6)

### Counts printed and committed

Given the codemod run on the Effect 3 tree with effect 4 installed, when it finishes and its commit is created, then it prints before and after type-error counts for src and tests, and the commit body carries those four numbers and one rewrite count per rule. (refs §5.7)

### Phase sessions read the reference without network

Given a migration phase session that reaches only its provider's network, when it follows the lookup skill to resolve a symbol, then it reads the matching v3-to-v4.md line and topic guide at the pinned tag from local files, and the reference's recorded source names that tag. (refs §5.8)

### Skills exist and bound their phases

Given the migration skills, when a reviewer reads each topic skill, then each names the files and v3 symbols it may change, and the lookup skill names no clone, fetch or sub-agent. (refs §5.9)

### Each phase names its skill

Given each migration plan, when phax plans lint runs and a reviewer reads each phase, then lint passes and every phase names exactly one topic skill or the codemod. (refs §5.10)

### No casts, any or compatibility module added

Given the migration's full diff against its base, when it is searched for added `any` types, `as` assertions other than `as const` and fixture brand casts, and modules named or acting as v3 compatibility, then none is found, and pnpm audit:architecture passes. (refs §5.11)

### Nothing of v3 left

Given the tree after the last migration phase, when `pnpm codemod:effect4 --check`, pnpm typecheck and pnpm test:type run, then the report lists no v3 symbol, and both type checks report zero errors. (refs §5.12)

### Commands answer as before

Given the integration and e2e suites, with their expected outputs as on the migration's base, when pnpm check:full runs on the migrated tree, then every test passes. (refs §5.13)

### No expectation edited

Given the migration's diff of tests/, when changed lines holding expected text, JSON, exit codes, decoded values or refusal lines are listed, then none is found. (refs §5.14)

### Refusal lines replay exactly

Given the behaviour corpus's refused inputs for config layers, spec and plan documents, provider answers and every persisted format, with one refused case per constrained leaf of each format's latest snapshot and of each frozen decoder's shape, when they are decoded on the migrated tree, then each refusal line equals the one the corpus holds, including `$schema: is missing; version: is unexpected` and `acceptanceCriteria[2].refs[0]: is missing`, and no formatter in src or packages/schemas reads Effect's message text. (refs §5.15)

### Frozen decoders replay exactly

Given the behaviour corpus's inputs for every frozen decoder, when they are decoded on the migrated tree, then each accepted input yields a value deep-equal to the captured one and each refused input yields the captured refusal line. (refs §5.16)

### History lock refreshed in the rewrite's commit

Given the commit that rewrites frozen decoders, when it is inspected and the schemas check runs, then it also updates packages/schemas/history.lock.json, its body names the Effect 4 migration, and the schemas check passes. (refs §5.17)

### No stamp moves

Given the migrated tree, when the schemas check runs and packages/schemas/snapshots/ and src/schemas/history/ are compared with the base, then no next.schema.json exists, src/schemas/release.ts stamps are unchanged, and no frozen decoder file is added. (refs §5.18)

### JSON Schemas accept the same documents

Given each format's latest released snapshot and its JSON Schema generated on Effect 4, when ajv validates every behaviour-corpus document against both, then both give the same verdict for every document, every field of every format is exercised by at least one document, and the released snapshots and the package's shipped JSON Schemas are byte-identical to 0.36.0's. (refs §5.19)

### Package exports and parse results unchanged

Given the built package, when its export names are listed and its parse functions run on the behaviour corpus, then the export names equal 0.36.0's, every exported Schema is an Effect 4 Schema, and every parse result equals the captured one. (refs §5.20)

### Consumers are told

Given the release that ships the migration, when docs/upgrading.md and packages/schemas/README.md are read, then both say the Schema values are Effect 4 values and name the effect version a composing consumer needs. (refs §5.21)

### Each phase ends no worse, the last one full

Given a migration run, when each phase's gates run, then the phase that installs Effect 4 and applies the codemod records the first counts and the first set of passing tests, no later phase passes with a count higher than the previous phase recorded or with a recorded test no longer passing, and the last phase passes the full standard profile. (refs §5.22)

### Guidance names Effect 4

Given the migrated tree, when CLAUDE.md and .claude/skills/ are searched for Effect 3 and v3 symbols, then CLAUDE.md names Effect 4, and v3 symbols appear only as cited befores in the migration skills. (refs §5.23)

## 9. Open questions

None.

## 9b. Arbitrated questions

### q-ast — Which AST library does the codemod use?

- ts-morph — ts-morph, type-aware: it resolves an identifier to the effect package before rewriting it — abandons: Using the repository's own compiler: ts-morph bundles a TypeScript 5.x compiler beside the native TypeScript 7 the repository builds with, and it is a heavy new devDependency.
- oxc-parser — oxc-parser, already pinned, rewriting by source spans and resolving origin through import bindings — abandons: Type knowledge: a symbol re-exported through a local module, or reached through an alias, is resolved only as far as its import line goes, so the report catches it instead of a rule.
- jscodeshift — jscodeshift, the library @effect/codemod used, syntax only — abandons: Both type knowledge and the existing pin: a new dependency, with a Babel or TypeScript parser that lags TypeScript 7 syntax.
- registry-fork — A fork of the codemod.com effect-v3-to-v4 codemod, fixed to the 4.1 names — abandons: Provenance and scope: unattributed code, written for rules this repository did not measure, with every target name to re-check.

Recommendation: ts-morph — codemod-origin needs certainty that a renamed Either or catchAll comes from effect. ts-morph gives that across phax's own re-exports, and the bundled 5.x compiler is enough to resolve imports. The cost of the dependency is paid once, and it leaves with the codemod if q-keep removes it.

Decision: ts-morph — by operator (Rémy Loubradou), 2026-11-07
Why: codemod-origin needs certainty that a renamed Either or catchAll comes from effect. ts-morph gives that across phax's own re-exports, and the bundled 5.x compiler is enough to resolve imports. The cost of the dependency is paid once, and it leaves with the codemod if q-keep removes it. Advocate: The strongest case for oxc-parser: it is already pinned in devDependencies and parses with the same native toolchain as the repository, so the codemod adds no dependency and no second TypeScript compiler, and the few aliased or re-exported symbols it cannot resolve are exactly what the report exists to catch. Principles: S1, C4. Reversibility: cheap. Revised: none.

### q-reference — Where does the reference live for phase sessions?

- vendored — Vendored in the repository at the pinned tag, with a SOURCE file naming the tag, commit and licence — abandons: A lean repository: about 1.6 MB of Effect's text in git history for good, and paths that format, lint and knip must ignore.
- state-root — Fetched outside the run into phax's state root by a setup step, and read from there — abandons: Reproducibility from the tree: the codemod and the reviewer depend on a file outside the repository that a session's sandbox may not reach and a reviewer cannot diff.

Recommendation: vendored — The codemod reads v3-to-v4.md as data, and its output must be reproducible from the commit alone. Phase worktrees reliably see only the repository. A one-time size cost is the acceptable loss, and q-keep can remove the vendored copy with the codemod.

Decision: vendored — by operator (Rémy Loubradou), 2026-11-07
Why: The codemod reads v3-to-v4.md as data, and its output must be reproducible from the commit alone. Phase worktrees reliably see only the repository. A one-time size cost is the acceptable loss, and q-keep can remove the vendored copy with the codemod. Advocate: The strongest case for state-root: the reference is someone else's 1.6 MB of text, and keeping it out of the repository leaves git history, formatters, linters and knip untouched, while a setup step can still fetch it at the pinned tag. Principles: S1, C4. Reversibility: costly. Revised: none.

### q-skills — Are the migration skills the official skill vendored and adapted, or phax's own skills that cite it?

- vendor-adapt — Vendor the official effect-v3-to-v4 skill and adapt it — abandons: A skill that matches how phases work: most of the vendored text (clones, sub-agents, disable-model-invocation) would be rewritten, so the adaptation keeps upstream's name over different behaviour.
- own-cite — phax's own lookup and topic skills, which quote the official skill's discipline and cite its source and version — abandons: Upstream improvements: changes to the official skill after the pinned version reach phax only if someone copies them.

Recommendation: own-cite — Three of the official skill's mechanisms (network clones, sub-agents, manual-only invocation) contradict the settled direction. Its discipline is the part worth keeping, and quoting it keeps that. The migration is a one-time event, so drift from upstream does not matter.

Decision: own-cite — by operator (Rémy Loubradou), 2026-11-07
Why: Three of the official skill's mechanisms (network clones, sub-agents, manual-only invocation) contradict the settled direction. Its discipline is the part worth keeping, and quoting it keeps that. The migration is a one-time event, so drift from upstream does not matter. Advocate: The strongest case for vendor-adapt: a vendored copy keeps the official skill's wording and structure as a visible baseline, so a reviewer can diff phax's adaptations against upstream and see exactly what was changed and why. Principles: S1, S4. Reversibility: cheap. Revised: none.

### q-keep — Does the codemod stay in the repository after the migration?

- remove-at-end — The last migration plan removes the codemod, its devDependency and the vendored reference — abandons: Re-running the migration from the tree: the script and reference survive only in git history and in the commit bodies that record their numbers.
- keep — Keep the codemod, its devDependency and the vendored reference — abandons: A clean dependency graph: a script that can no longer do anything useful on this repository, a pinned AST library and 1.6 MB of reference text, all kept up to date by knip and the gates.

Recommendation: remove-at-end — Once no v3 symbol is left, the codemod has nothing to rewrite. Its value is the record it left behind (the commit bodies and the report), and git keeps the script for anyone who wants to reproduce it.

Decision: remove-at-end — by operator (Rémy Loubradou), 2026-11-07
Why: Once no v3 symbol is left, the codemod has nothing to rewrite. Its value is the record it left behind (the commit bodies and the report), and git keeps the script for anyone who wants to reproduce it. Advocate: The strongest case for keep: with the codemod and reference in the tree, anyone can re-run the migration on a branch that still holds Effect 3 code, such as a long-lived fork or a late-merged pull request, without digging through history. Principles: S1, S5. Reversibility: cheap. Revised: none.

### q-releases — Does the migration ship in one release or several?

- one-release — One release moves phax and @lbdremy/phax-schemas together — abandons: A smaller first step: the whole migration, around 4,400 type errors, must land before anything ships.
- phax-first — phax ships on Effect 4 first, and the package follows in a later release — abandons: The one-version rule and the shared sources: the package is built from phax's schema files, so shipping it on Effect 3 would mean two Effect versions, or two copies of the schemas, in one tree.

Recommendation: one-release — The package and phax share their schema sources and their version number, so a split is impossible without the dual install the settled direction forbids. A large release is the acceptable loss.

Decision: one-release — by operator (Rémy Loubradou), 2026-11-07
Why: The package and phax share their schema sources and their version number, so a split is impossible without the dual install the settled direction forbids. A large release is the acceptable loss. Advocate: The strongest case for phax-first: shipping phax alone gets a smaller release out sooner and lets the Effect 4 runtime be proven in the field before package consumers are asked to move. Principles: S1, S4. Reversibility: costly. Revised: none.

### q-green — How does a run stay green when a type error in src breaks every test at once?

- ratchet — A migration gate profile: an error ratchet and lint every phase; check:full and build only at the terminal phase — abandons: Per-phase test evidence: intermediate phases are judged by falling error counts and their own skill's scope, and the test suite proves behaviour only at the end.
- single-phase — One phase does dependencies, codemod and every topic, under the standard profile — abandons: Reviewability and the skill-per-phase rule: one session and one diff covering every topic, with no way to read what each part was allowed to change.
- dual-install — Install Effect 4 under an alias beside Effect 3 and migrate file by file under the standard profile — abandons: The one-version and no-compatibility rules: two Effects in one tree during the migration, with values crossing between them.

Recommendation: ratchet — Only the ratchet keeps both settled rules, phases that follow skills and no compatibility layer. The behaviour corpus and the untouched test expectations make the terminal check:full a full proof, so late test evidence is the acceptable loss.

Decision: ratchet — by operator (Rémy Loubradou), 2026-11-07
Why: Only the ratchet keeps both settled rules, phases that follow skills and no compatibility layer. The behaviour corpus and the untouched test expectations make the terminal check:full a full proof, so late test evidence is the acceptable loss. Advocate: The strongest case for dual-install: running both Effect versions side by side keeps the full test suite green after every file, so each phase carries real behavioural evidence instead of a falling error count. Principles: S1, C4. Reversibility: cheap. Revised: none.

### q-snapshots — Effect 4's generator changes the text of every JSON Schema. How is that kept from moving every format's stamp?

- rerecord-latest — Re-record each format's latest released snapshot from Effect 4 once, proven equivalent by the ajv corpus check, and name it in docs/upgrading.md — abandons: The rule that a released snapshot never changes: for one release, json/ files and snapshots differ in text from what 0.36.0 shipped.
- normalize — phax's generator translates Effect 4's output back to the text of the latest released snapshots — abandons: Living on Effect 4's generator: phax keeps a permanent translator back to Effect 3's output, close to the compatibility layer the settled direction forbids.
- equivalence — Keep every released snapshot as it is, and have the schemas check compare the Effect 4 generator's output with the latest released snapshot by the behaviour-corpus documents each accepts and refuses, not by text — abandons: Detection to the character: a real format change that the corpus does not exercise would pass the check, so the corpus must exercise every field.

Recommendation: equivalence — Consumers rely on which documents a schema accepts and on published URLs that never change; equivalence keeps both, needs no translator back to Effect 3 and moves no stamp. Bumping every format was weighed and set aside: an older phax refuses a file stamped newer than itself, so every file written after the migration would become unreadable to it, for 41 formats whose documents did not change.

Decision: equivalence — by operator (Rémy Loubradou), 2026-11-07
Why: The text change is the 2026-10-07 spike's finding, not yet measured on 4.1: the first migration phase diffs the Effect 4 generator's output (draft-07 target) against the released snapshots, parsed and annotations aside, and records what differs. Advocate: The strongest case for rerecord-latest: comparing by text keeps the schemas check exact to the character, so any real format change is caught without depending on how complete the behaviour corpus is, and the one-time re-record is named openly in docs/upgrading.md. Principles: S1, C3. Reversibility: costly. Revised: none.

## 10. Implementation-planning note

Settled:

- Hybrid: the codemod does the mechanical rewrites, and no phase hand-applies a rename a codemod rule covers.
- The codemod is phax's own, under scripts/, written against an AST library, limited to the measured root causes and judged by type-error counts before and after.
- Starting rule table, from the spike, each rule to be cross-checked against v3-to-v4.md and the registry codemod's rule list: effect/Either to the Import Map's target; Effect.either; Schema.decodeUnknownEither, decodeEither, encodeUnknownEither and encodeEither to Schema.decodeUnknownResult and encodeUnknownResult, not to the reference's Exit counterparts, since the same pass turns every Either consumer into a Result consumer (operator, 2026-11-08); Either.getOrThrow to Result.getOrThrow (operator, 2026-11-09); Context.Tag service classes to Context.Service; piped Schema filters to .check(...); Schema.optionalWith; Effect.catchAll and Effect.orElse to Effect.catch; ParseResult imports and types that have a SchemaIssue counterpart.
- Left to topic phases: formatError's formatters, the JSON Schema generator and snapshots, frozen decoder behaviour, layers and runtime wiring, and anything the codemod reports.
- Phases follow skills, not sub-agents. The lookup discipline (reference, then guide, then installed source; no compatibility layer; no any or as to silence an error; no invented API) holds in every phase.
- Order as the spec sees it: capture the behaviour corpus on Effect 3, give refusals phax's own model on Effect 3, then dependencies, then the codemod, then the topics with their tests, the schema topic first, since modules build schemas when they load and no test runs until it is done (operator, 2026-11-09), then the package and JSON Schemas, then docs and guidance last.
- phax owns its refusal format (operator, 2026-11-08): a phax-owned refusal value, one adapter from Effect's issues and one renderer that reads only that value, shared by @lbdremy/phax-schemas. It lands on Effect 3, before Effect 4 is installed, so the schema phase ports one adapter and moves no message.
- The test contract is protected (operator, 2026-11-09): from the second groundwork plan's merge to the migration's end, phax.json's protectedPaths hold the snapshot files, the released JSON Schema snapshots, the CLI contract fixtures and the happy-path tests with no Effect code. Test files that use Effect stay editable, and tests-unchanged holds them at review.
- Baseline: the spike measured 1,502 src errors and 2,910 test errors; the codemod's report replaces these with the real counts.

Left open:

- The final rule table and each rule's reference line.
- How the topics are split into phases, and whether there is one plan or several.
- The exact pinned tag: the brief cites effect@4.1.0 for migration/, and the current release is 4.1.2. The dependency and the reference must name the same tag, after confirming the files exist there.
- How the behaviour corpus is stored and replayed (fixtures and test layout).

Constraints:

- No persisted format bump: a format changes version only if its JSON changes.
- phax knows no project: skills, codemod output and docs use phax's words.
- No back-compat shims and no v3-compat module, in src or in tests.
- The codemod runs no code fetched at run time; its dependencies are pinned in devDependencies.
- Phase sessions have no network beyond their provider's: nothing in a phase may clone, fetch or npx.
- The vendored reference, if kept per q-reference, is excluded from oxfmt, oxlint and knip and stays byte-identical to the tag.
- Every Effect API is checked against the installed version, not against training data.

## 11. Docs page

None — The migration changes no command, config key or file a reader uses. What a consumer needs (the package's Schema values are now Effect 4 values) goes in docs/upgrading.md and the package README, both covered by consumers-told.

## 12. Decision log

- 2026-11-07 q-ast decided ts-morph — operator (Rémy Loubradou)
- 2026-11-07 q-reference decided vendored — operator (Rémy Loubradou)
- 2026-11-07 q-skills decided own-cite — operator (Rémy Loubradou)
- 2026-11-07 q-keep decided remove-at-end — operator (Rémy Loubradou)
- 2026-11-07 q-releases decided one-release — operator (Rémy Loubradou)
- 2026-11-07 q-green decided ratchet — operator (Rémy Loubradou)
- 2026-11-07 q-snapshots decided equivalence — operator (Rémy Loubradou)
