---
status: Approved
source-spec: docs/specs/2610171254-planning-skill-defaults.md
completes-spec: true
approved:
  date: 2026-10-20
  baseline: 760888e
---
# Architecture provider

The second and last plan of the approved spec `planning-skill-defaults` (`docs/specs/2610171254-planning-skill-defaults.md`), so its run completes the spec. Plan 1 (`docs/plans/archive/2610190951-planning-skill-defaults-plan.md`) shipped §5.1–§5.16 and the per-phase `modelReason`. This plan does not touch any of that: the model policy, the generated policy block, the plan-document shape, the doctrine and the example architecture all stay as they are. This plan ships §5.17–§5.30. It adds the `architecture` config key, the `phax architecture [path]...` command, and the two schema-born formats `architecture-request` and `architecture-report`. It allows the command inside a phase worktree, adds the statements in the headless plan authoring prompt, and grants the headless planner `phax architecture` when a provider is configured. It also adds the skill's architecture paragraph, the §11 docs page, and the NEXT_STEPS tick. The spec's six arbitrations are settled and not reopened. Q3: pull, the prompt says whether a provider is configured, and the session may run the command when one is. Q4: with no provider both `phax architecture` and `phax brief` exit 1; `phax architecture` prints one stdout line meant for the agent, and `phax brief` keeps its message. Q5: `phax architecture` writes no file, inside a phase worktree or outside one. Q6: the report is `{ $schema, body }`, a Markdown body printed as is. The command follows its sibling `phax brief`. Config comes from the main checkout's layers. The request goes on the provider's stdin, with no shell and a fixed time limit. The answer is read by its own `$schema`, and every failure is one line. None of the brief's record machinery is copied. Work runs core to surface in two phases. Phase-01 adds the config key, the formats, the pure request and path logic, the use case, the command and its phase-guard entry, so every new export has a caller. Phase-02 adds the authoring prompt statements and the session's grant, the skill text, the docs page and NEXT_STEPS. Phase-02 edits two `.claude/skills/` files, so the plan must be run with `phax run --allow-skill-edits`. Tests never read `~/.phax` and never spawn a real model. They use temporary repositories, temporary state roots and made-up node provider scripts (`acme-guard`, `acme-billing`, `src/core/billing/totals.ts`). They assert `$schema` URLs by format id and the release pattern, never by the running version. Gates cannot check a provider's behaviour inside a real Claude or Codex authoring sandbox. The phases check that the grant reaches the session's options, and the docs page states the limits a provider runs under.

## Required commands

- (none)

No new command. Every command the phases run is already allowed by `security.agentCommands` or the `standard` gate profile in phax.json: the pnpm scripts, `pnpm exec tsx scripts/schemas-check.ts --write`, a `pnpm exec tsx` one-liner to regenerate `phax.schema.json` and `phax.user.schema.json`, `pnpm gen:usage-spec`, `pnpm gen:model-catalog` and `pnpm docs:cli`. Phase-02 declares `.claude/skills/phax-planning/SKILL.md` and `.claude/skills/phax-cli/SKILL.md`, so run the plan with `phax run --allow-skill-edits`.

## Technical arbitrations

- Time limit (spec §10, left open): a fixed 60 s, `ARCHITECTURE_TIMEOUT_MS = 60_000` in `src/app/architectureProvider.ts`. It has the same value as `BRIEF_TIMEOUT_MS` but is its own constant, and it is not a config key. The use case takes an optional `timeoutMs` for tests only, as `queryBrief` does. Loss accepted: two equal constants that can drift apart. Reusing the brief's constant would tie two providers whose limits may need to differ.
- The headless planner's grant (spec §10, left open). It is the narrow command `phax architecture`, computed by a pure `authoringAgentCommands({ kind, architectureProvider })` in `src/domain/security/agentCommands.ts`. The function returns `["phax architecture"]` only for a plan with a configured provider, and `[]` otherwise. `authorArtifact` passes the grant as `AgentRunOptions.agentCommands`, which the Claude adapter turns into `--allowedTools Bash(phax architecture:*)`. Today the authoring session passes no agent commands, so Claude denies Bash. `authorArtifact` also appends the grant to the `agentCommands` of the review policy it already builds. With no `architecture` key, the options are exactly as before, with no `agentCommands` key and the policy's `["git"]`. `resolveReviewSecurityPolicy` itself is unchanged, so review and decide sessions keep their policy. Loss accepted: the grant lives in the authoring use case rather than in the shared policy resolver, so a future session kind that needs it must ask for it again.
- The session's read jail (spec §10, left open): no change. The session can already read the repository root, which holds `phax.json` and `phax.local.json`. No adapter limits what a granted command's process reads: Claude's permission rules gate the tool call, not the process, and Codex `workspace-write` reads everywhere. So `phax architecture` reads `~/.phax/config.json` and spawns the provider as `phax brief` does from a phase. The write scope (only `.phax-context/` among the writable roots) and the provider-only network stay as they are. The docs page states them as limits the provider must live with. Loss accepted: on Claude Code a granted Bash call is not sandboxed, so nothing beyond its own code holds the provider's process. On Codex, a provider that writes outside the writable roots or reaches the network fails, as one line, and the planner falls back to the code.
- Wording (spec §10, left open), as phase-01 and phase-02 write it. With no provider, `phax architecture` prints on stdout: `No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.` Failures go on stderr, one line each: `✗ architecture provider exited with code 3: <stderr>`, `✗ architecture provider timed out after 60000ms: <command>`, `✗ architecture provider returned invalid JSON: …`, `✗ architecture provider: <the report reader's reason, naming the architecture-report URL>`, `✗ phax architecture: ../elsewhere is outside the working tree` and `✗ phax architecture: <cwd> is not inside a git working tree`. The prompt's configured line is `- An architecture provider is configured: before cutting phases, run \`phax architecture\` (or \`phax architecture <path>...\` for the parts the plan touches) and plan against its answer.` The prompt's no-provider line is `- No architecture provider is configured: do not run \`phax architecture\`; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).` The skill's paragraph follows spec §6. Loss accepted: the provider's stderr is folded onto one line, so a multi-line diagnostic loses its line breaks.
- Path resolution (spec §10, left open). `resolveBriefPaths` moves unchanged from `src/domain/brief/pull.ts` to a neutral `src/domain/treePaths.ts` as `resolveTreePaths`, and both commands use it. It resolves against the cwd, makes the path relative to the root with POSIX separators, drops duplicates keeping the first, never checks existence, and refuses a path outside the tree or the tree itself. Loss accepted: `phax architecture .` is refused as the working tree itself instead of meaning the whole repository. Asking with no path is the only way to ask for the whole repository, so `files` never has two spellings for one request.
- Order of the command's checks. The command first finds the git working tree (exit 1), then loads the main checkout's config (exit 2 on an error). Next it checks for a provider: with none it prints the no-provider line and exits 1. Then it resolves the paths, refusing one outside the tree (exit 1), and only then runs the provider. This matches `phax brief`. Loss accepted: with no provider configured, a path outside the tree goes unreported.
- Reading the report. The answer is read through `src/schemas/persisted.ts`'s existing report reader (`readReport`, with `ReportFormatId` widened to `architecture-report`). So a report without `$schema`, one in another format, or one stamped older or newer than this phax is refused by name, as a brief report is, and the refusal names the URL phax reads. phax writes the request and never reads it back, so the request has no reader in `persisted.ts`. The schemas package parses both formats. Loss accepted: a provider must restamp its report whenever a release changes the shape.
- Two phases rather than one or three. The command lands with its formats, config and phase-guard entry, because the phase guard's test refuses a registered command left unclassified and knip refuses an export with no caller. The prompt, the grant and the docs come second, as a smaller and mostly textual phase. Loss accepted: phase-01 is broad, touching config, formats, the schemas package and the CLI, which the detailed instructions offset.

---

## phase-01 — phax architecture and its two formats {#phase-01-architecture-command}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

A repository can declare `"architecture": { "command": "…" }` in `phax.json`, `phax.local.json` or `~/.phax/config.json`. `phax architecture [path]...` sends the provider a `$schema`-stamped architecture request and prints the Markdown body of the architecture report it answers. With no path, `files` is null. With paths, `files` holds them relative to the working-tree root, deduplicated and never checked for existence. With no provider, the command prints one stdout line telling the agent to read the code and its documentation, and exits 1. A failed provider, an unreadable answer or a path outside the tree is one line and exit 1. The command runs inside a phase worktree, reads the main checkout's config, and writes no file. `architecture-request` and `architecture-report` are published with every phax format.

### Detailed instructions

- Add `src/schemas/architecture.ts` with a header comment in the style of `src/schemas/brief.ts`. Export `ArchitectureRequestFileSchema = Schema.Struct({ $schema: schemaUrlField("architecture-request"), files: Schema.NullOr(Schema.NonEmptyArray(Schema.NonEmptyString)) })`. Annotate `files`: "Null for the whole repository. Otherwise working-tree-root-relative paths, deduplicated, in the order given, never checked for existence." Also export `ArchitectureReportFileSchema = Schema.Struct({ $schema: schemaUrlField("architecture-report"), body: Schema.NonEmptyString })`, with `body` annotated "Markdown for the agent to read. phax prints it as is and never parses it." Export `decodeArchitectureRequestFile` and `decodeArchitectureReportFile`, both `Schema.decodeUnknownEither(..., { onExcessProperty: "error" })`, and the types `ArchitectureRequestFile`, `ArchitectureRequest` (without `$schema`) and `ArchitectureReportFile`. `files` has exactly two forms, null or a non-empty list, and no other key is admitted. Export nothing that has no caller, or knip fails.
- Register the formats. In `src/schemas/schemaUrl.ts`, append `"architecture-request"` and `"architecture-report"` to `FORMAT_IDS` after `"cost-ledger"` and to `SCHEMA_BORN_FORMAT_IDS`. Extend both doc comments to name the architecture request and report of spec planning-skill-defaults, born with `$schema`.
- In `src/schemas/persisted.ts`, widen `ReportFormatId` to `"gate-report" | "brief-report" | "architecture-report"`. Add `readArchitectureReport(input, bounds = { current: CURRENT_STAMPS["architecture-report"], running: PHAX_RELEASE })`, which calls `readReport("architecture-report", decodeArchitectureReportFile, input, bounds)`. Update the module header and the `ReportError` / `readReport` comments that list the report formats. Add no reader for the request: phax writes it and never reads it back.
- In the schemas package, add `packages/schemas/src/formats/architecture.ts`, modelled on the brief report block of `packages/schemas/src/formats/reports.ts`. Use `defineFormat` for `architectureRequestFormat` (label `architecture request`) and `architectureReportFormat` (label `architecture report`), both with `preSchema: null`, `releases: []` and the current shape from `CURRENT_SHAPES[...]`. Export `parseArchitectureRequest`, `parseArchitectureReport`, `toLatestArchitectureRequest`, `toLatestArchitectureReport`, the `*Shapes`/`*Shape` types and the `Latest*` types. Export them from `packages/schemas/src/index.ts` exactly as index.ts exports the brief report (its parse function, toLatest function, shape types and file schema alias), and add both ids to the format map type and to the formats object there. In `packages/schemas/build/jsonSchemas.ts`, add both to `FORMAT_DEFINITIONS` and to `EXCESS` with `"error"`.
- Run `pnpm exec tsx scripts/schemas-check.ts --write`. It creates `packages/schemas/snapshots/architecture-request/next.schema.json` and `packages/schemas/snapshots/architecture-report/next.schema.json`, and regenerates `packages/schemas/src/generated/index.ts` and `src/schemas/release.ts`, stamping both formats at the open 0.26.0. Never hand-edit those generated files or `packages/schemas/history.lock.json`.
- In the README's persisted-formats table, add two rows after `Brief report`: `| Architecture request | architecture-request | the architecture provider's stdin, never saved | parseArchitectureRequest | json/architecture-request.schema.json |` and `| Architecture report | architecture-report | the architecture provider's stdout, never saved | parseArchitectureReport | json/architecture-report.schema.json |`. Use code spans as the other rows do, and keep the table aligned as oxfmt formats it.
- Config. In `src/schemas/phaxConfig.ts`, add `ArchitectureConfigSchema = Schema.Struct({ command: Schema.NonEmptyString.annotations({ description }) })` beside `PlanAuditorConfigSchema`. The description says the command is split on whitespace with no shell, and that phax writes an architecture request `{"$schema": "https://docs.phax.run/schemas/architecture-request/<release>.json", "files"}` on its stdin. It reads an architecture report `{"$schema": "https://docs.phax.run/schemas/architecture-report/<release>.json", "body"}` on stdout, and a provider that declines exits non-zero. Point to `phax --usage`, cmd architecture, for the full contract. Export the type `ArchitectureConfig`. Add `architecture: Schema.optional(ArchitectureConfigSchema).annotations({ description: "The architecture provider: a command that answers, for the whole repository or for some paths, the repository's architecture as Markdown. Serves `phax architecture`." })` next to `planAuditor` in both the project schema and the user overlay schema. Add `readonly architecture?: ArchitectureConfig` to the resolved config interface. `command` is required, and no other key is admitted.
- In `src/domain/config/mergeLayers.ts`, merge it as `planAuditor` is: `const architectureCommand = localUser?.architecture?.command ?? globalUser?.architecture?.command ?? project.architecture?.command`, then spread `{ architecture: { command: architectureCommand } }` when it is defined. In `src/app/loadConfig.ts`, pass `architecture` through beside `planAuditor`. Regenerate `phax.schema.json` and `phax.user.schema.json` with a `pnpm exec tsx -e` one-liner that writes `JSON.stringify(getPhaxConfigJsonSchema(), null, 2) + "\n"` and the same for `getPhaxUserOverlayJsonSchema()`. Never hand-edit them, and check `pnpm format:check` is clean. Add `"architecture"` to both property lists in `tests/unit/phaxConfigJsonSchema.test.ts`.
- Paths. Move `resolveBriefPaths` from `src/domain/brief/pull.ts` into a new `src/domain/treePaths.ts` as `resolveTreePaths`, with the same signature, behaviour and refusal messages (`<arg> is outside the working tree`, `<arg> is the working tree itself`). Generalise its doc comment to the paths a provider command was given. Remove it from pull.ts (keep pull.ts's other exports), update `src/app/pullBrief.ts` to import `resolveTreePaths`, and update the import in `tests/unit/briefPull.test.ts`. `phax brief`'s behaviour and messages do not change.
- Add the pure `src/domain/architecture/request.ts`. Export `architectureRequest(files: readonly [string, ...string[]] | null): ArchitectureRequest`, which returns `{ files }`. Export `NO_ARCHITECTURE_PROVIDER`, the stdout line: `No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.`
- Add `src/app/architectureProvider.ts`. Export `ARCHITECTURE_TIMEOUT_MS = 60_000`, with a comment saying it is fixed and not a config key, like the brief's. Export the type `PullArchitectureResult = { kind: "refused"; message } | { kind: "answered"; body } | { kind: "failed"; reason }` and the function `pullArchitecture({ command, root, cwd, paths, timeoutMs? }): Effect<PullArchitectureResult, never, Shell>`. With no path, `files` is null. Otherwise call `resolveTreePaths({ cwd, root, paths })`, and turn a Left into `refused` with its message. Stamp the request with `withSchemaUrl("architecture-request", architectureRequest(files))`. Call `runProviderQuery("architecture provider", command, root, request, (raw) => Either.right(raw), (f) => f, { timeoutMs: timeoutMs ?? ARCHITECTURE_TIMEOUT_MS })`. On a Left, the reason is the failure's message, plus `: <stderr trimmed>` when stderr is present, as `briefProvider.ts`'s `failureReason` does. On a Right, read the answer with `readArchitectureReport`. Turn a Left into `failed` with `architecture provider: ${describeReportError(error)}`, and a Right into `answered` with the report's `body`. Pass every reason through `onOneLine` from `src/domain/reportText.ts`. The use case needs only the Shell port: it reads and writes no file (spec Q5) and never fails.
- Add `src/cli/commands/architecture.ts`, a thin command in the style of `src/cli/commands/brief.ts`. Export `runArchitecture(paths, out, cwd = process.cwd()): Promise<number>`. Its steps: `locateWorkingTree(cwd)`, which when undefined prints `out.error("✗ phax architecture: <cwd> is not inside a git working tree")` and returns 1. Then `loadConfig(tree.mainRoot)`, which on a Left calls `reportConfigError` and returns 2. When `architecture` is undefined, print `out.log(NO_ARCHITECTURE_PROVIDER)` and return 1, with nothing on stderr. Otherwise run `pullArchitecture({ command, root: tree.root, cwd, paths })` with `NodeShellLayer`: `refused` prints `out.error("✗ phax architecture: " + message)` and returns 1, `failed` prints `out.error("✗ " + reason)` and returns 1, and `answered` prints `out.log(body)` and returns 0. The file holds no other logic.
- In `src/cli/program.ts`, register `architecture` beside `brief`: `.command("architecture")`, a description ("Ask the configured architecture provider for the repository's architecture; with paths, for the parts that hold them"), `.argument("[path...]", "Paths to ask about, existing or not, relative to the current directory")`, and an action calling `runArchitecture(paths, consoleOutput)` then `process.exit`. In `src/cli/cliDocs.ts`, add an `architecture` entry after `brief`. Its long help covers: the config key in the three layers, read from the main checkout; the provider run from the working tree's root with no shell, one request on stdin and a fixed 60-second limit; and the request `{ $schema, files }`, with files null with no path or the root-relative paths, deduplicated, in order, never checked. It covers the report `{ $schema, body }`, every other key refused, the body printed as is, and a declining provider exiting non-zero. It covers the exits: 0 on a readable report; 1 with the one stdout line when no provider is configured; 1 on a failed, timed-out or unreadable provider, a path outside the tree, or no git working tree; and 2 on an invalid config. It ends with side effects: runs the provider and writes no file, inside a phase worktree or outside one. Examples: `phax architecture` and `phax architecture src/core/billing/totals.ts`.
- In `src/domain/security/phaseGuard.ts`, add `architecture: "allowed"` right after `brief`. Update the classification comment to name `phax architecture` beside `phax brief`, and change the refusal's closing parenthesis to `(inside, only phax brief, phax architecture and read-only commands run)`.
- Run `pnpm gen:usage-spec`, then `pnpm docs:cli`. Never hand-edit `phax.usage.kdl`, `docs/cli/reference.md` or the generated CLI section of the README.
- Every fixture is made up and written in the test files: the provider scripts (`acme-guard`-style node scripts in a temp dir, invoked as `node <script>`), the body `# Architecture — acme-billing`, and paths such as `src/core/billing/totals.ts`. Tests never read `~/.phax`: point the user config layer at a temporary home or state root, as `tests/integration/briefCommand.test.ts` does. Assert `$schema` URLs with a pattern on the format id and `X.Y.Z`, never with the running version.

### Planned files to create

- `src/schemas/architecture.ts`
- `src/domain/treePaths.ts`
- `src/domain/architecture/request.ts`
- `src/app/architectureProvider.ts`
- `src/cli/commands/architecture.ts`
- `packages/schemas/src/formats/architecture.ts`
- `packages/schemas/snapshots/architecture-request/next.schema.json`
- `packages/schemas/snapshots/architecture-report/next.schema.json`
- `tests/unit/schemas/architecture.test.ts`
- `tests/unit/architecture/request.test.ts`
- `tests/unit/schemasPackage/architectureFormats.test.ts`
- `tests/integration/architectureProvider.test.ts`
- `tests/integration/architectureCommand.test.ts`

### Planned files to edit

- `src/schemas/schemaUrl.ts`
- `src/schemas/release.ts`
- `src/schemas/persisted.ts`
- `src/schemas/phaxConfig.ts`
- `src/domain/config/mergeLayers.ts`
- `src/app/loadConfig.ts`
- `src/domain/brief/pull.ts`
- `src/app/pullBrief.ts`
- `src/domain/security/phaseGuard.ts`
- `src/cli/program.ts`
- `src/cli/cliDocs.ts`
- `packages/schemas/src/index.ts`
- `packages/schemas/src/generated/index.ts`
- `packages/schemas/build/jsonSchemas.ts`
- `phax.schema.json`
- `phax.user.schema.json`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`
- `tests/unit/phaxConfigJsonSchema.test.ts`
- `tests/unit/briefPull.test.ts`

### Optional files that may be edited

- `packages/schemas/history.lock.json`
- `tests/unit/schemaUrl.test.ts`
- `tests/unit/architecturalGuards.test.ts`
- `tests/unit/readmePersistedFormats.test.ts`
- `tests/unit/schemasPackage/documents.ts`
- `tests/unit/schemasPackage/documents.test.ts`
- `tests/unit/schemasPackage/parity.test.ts`
- `tests/unit/schemasPackage/jsonSchemas.test.ts`
- `tests/unit/schemasPackage/currentShapes.test.ts`
- `tests/unit/schemasPackage/snapshots.test.ts`
- `tests/unit/schemasPackage/exports.test.ts`
- `tests/unit/site/schemas.test.ts`
- `tests/type/schemasPackage.ts`
- `tests/integration/persistedProducer.test.ts`
- `tests/unit/mergeLayers.test.ts`
- `tests/integration/loadConfigLayers.test.ts`
- `tests/unit/phaxUserOverlaySchema.test.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `tests/integration/phaseGuard.test.ts`

### Boundary contracts

Consumers are the agent or person running `phax architecture`, and in phase-02 the headless planner. The producer is the configured architecture provider. phax sends the `architecture-request` `{ $schema, files }` on the provider's stdin and reads the `architecture-report` `{ $schema, body }` from its stdout, both decoded at the boundary by `src/schemas/architecture.ts` and `readArchitectureReport` in `src/schemas/persisted.ts`. The domain (`src/domain/architecture/request.ts`, `src/domain/treePaths.ts`) builds the request and resolves paths, with no I/O. The app (`pullArchitecture`) owns the Shell call and the one-line failures, and never touches FileSystem. The CLI (`runArchitecture`) maps the result to stdout or stderr and an exit code. Config flows through the existing loader: `ArchitectureConfig` is the stable shape `{ command }`, merged highest layer wins. The schemas package exposes both formats as parse-only consumers.

### Test strategy

Write the unit tests before the implementation. `tests/unit/schemas/architecture.test.ts` covers the request and the report. The request decodes with `files: null` and with a list. It refuses an empty list, a missing `$schema`, a `$schema` naming another format, and an extra key such as `phase`. The report decodes `{ $schema, body }` and refuses an extra key, an empty body and a missing `$schema`. `tests/unit/architecture/request.test.ts` checks `architectureRequest` for null and a list. It checks that `NO_ARCHITECTURE_PROVIDER` is one line naming the code and its documentation, README and CLAUDE.md, and "not a failure of the repository". `tests/unit/briefPull.test.ts` keeps its path cases, now against `resolveTreePaths`.

`tests/integration/architectureProvider.test.ts` runs `pullArchitecture` with the real `NodeShellLayer` and made-up node provider scripts in a temp repository. The scripts save their stdin to a file outside the repository and print a report. With no path, the provider receives `$schema` matching the architecture-request URL pattern and `files: null`, and the result is the body. From cwd `src`, `core/billing/totals.ts core/billing/totals.ts http/missing.ts` sends `["src/core/billing/totals.ts", "src/http/missing.ts"]`. `../elsewhere` is refused naming it, and the capture file is never created. A provider exiting 3 with stderr fails naming `architecture provider` and the code. `{"body": "x"}` fails naming `architecture provider` and an architecture-report URL. A sleeping provider with a small `timeoutMs` fails naming the time limit. Every reason has no newline.

`tests/integration/architectureCommand.test.ts` calls `runArchitecture` against temp repositories with a capturing OutputPort and a temporary user config layer, never `~/.phax`. With no `architecture` key in any layer, stdout is exactly one line with that text, stderr is empty and the exit is 1. A provider in `phax.json` prints the body with exit 0. A provider only in `phax.local.json` is used. An invalid `architecture` (no `command`, or an extra key) exits 2. In a phase worktree (a linked worktree whose root holds `.phax-context/`) of a repository whose `phax.local.json` declares a fake provider: `phaseGuardRefusal("architecture")` is undefined, `runArchitecture(["src/core"], …, worktreeCwd)` prints the body with exit 0, and the file listings and `git status --porcelain` of the worktree and of the main checkout are unchanged. The existing `briefCommand` test keeps `phax brief`'s no-provider exit 1 green. `tests/unit/schemasPackage/architectureFormats.test.ts` checks three things: `parseArchitectureRequest` and `parseArchitectureReport` read valid documents, the report parser refuses a third key, and both formats have a `next.schema.json` snapshot. The phase-guard unit test passes because `architecture` is classified.

### Implementation order

1. The format schemas, their registration in schemaUrl.ts and persisted.ts, the schemas-package format module and maps, then `schemas-check --write` and the README rows, test first.
2. The config key in phaxConfig.ts, mergeLayers.ts and loadConfig.ts, the regenerated root JSON Schemas and the property-list test.
3. The move of `resolveBriefPaths` to `src/domain/treePaths.ts`, then `src/domain/architecture/request.ts`, test first.
4. `pullArchitecture` and its integration test.
5. The CLI command, program.ts registration, cliDocs entry and phase-guard entry, then the command integration test.
6. `pnpm gen:usage-spec`, then `pnpm docs:cli`.

### Excluded scope

- The headless plan authoring prompt statements and the authoring session's grant (phase-02).
- The phax-planning and phax-cli skill text, the docs page, the README Extend phax subsection and NEXT_STEPS (phase-02).
- Any record of an architecture call (spec Q5): no file is written, no record format is added, and nothing appears in `records explain`.
- Any change to `phax brief`'s behaviour, messages or exit codes beyond importing the moved path resolver.
- Pushing the architecture into any prompt, or any structure in the report beyond `body` (spec §7).
- An example architecture provider under `examples/`.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Name these exports with their exact module paths and signatures: `ArchitectureRequestFileSchema`, `ArchitectureReportFileSchema`, their decoders and types (`src/schemas/architecture.ts`); `readArchitectureReport` (`src/schemas/persisted.ts`); `ArchitectureConfig` and the `architecture` key (`src/schemas/phaxConfig.ts`); `resolveTreePaths` (`src/domain/treePaths.ts`); `architectureRequest` and `NO_ARCHITECTURE_PROVIDER` (`src/domain/architecture/request.ts`); `ARCHITECTURE_TIMEOUT_MS`, `pullArchitecture` and `PullArchitectureResult` (`src/app/architectureProvider.ts`); `runArchitecture` (`src/cli/commands/architecture.ts`); and `parseArchitectureRequest` / `parseArchitectureReport` (schemas package). Report the stamp that schemas-check wrote for both formats, which phase-02's docs page must use in its examples. Quote the exact failure lines the command prints, and say whether the provider's stderr was multi-line in any test. Explain every deviation phax flags against the planned file lists, including each optional test file touched and why.

### Commit subject

`feat(architecture): add phax architecture and the architecture provider formats`

### Commit body

phax architecture [path]... asks the provider declared as "architecture": { "command" } in phax.json, phax.local.json or ~/.phax/config.json for the repository's architecture, and prints the Markdown body it answers. With no path the request's files is null, for the whole repository. With paths, it carries them relative to the working-tree root, deduplicated, in the order given and never checked for existence. A path outside the tree is refused before the provider runs.

The provider runs from the working tree's root with no shell, the stamped architecture-request on stdin and a fixed 60-second limit. Its answer is read as an architecture-report by its own $schema. A non-zero exit, a timeout, invalid JSON or a refused report is one line and exit 1. With no provider configured, the command prints one stdout line telling the agent to read the architecture from the code and its documentation, which is not a failure of the repository, and exits 1, as phax brief does. A config error exits 2.

The command reads the main checkout's config, so it serves a phase worktree too. The phase guard allows it, and it writes no file anywhere. The two formats are born with $schema, every key required and unknown keys refused, and the schemas package publishes them. The working-tree path resolver phax brief used moves to a shared domain module.

---

## phase-02 — The planner reads the repository's architecture {#phase-02-planner-reads-architecture}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The headless plan authoring prompt says whether an architecture provider is configured. When one is, it tells the planner to run `phax architecture` before cutting phases, and the session is granted exactly that command. When none is, it tells the planner to read the code and its documentation instead, and the session's commands are the same as before. Spec prompts are unchanged. The phax-planning skill tells every planner to run `phax architecture` and to treat its no-provider exit 1 as "read the code and docs, and carry on". A docs page explains the provider to repository owners and provider authors. NEXT_STEPS marks the spec done.

### Detailed instructions

- In `src/domain/authoring/prompt.ts`, add `readonly architectureProvider: boolean | null` to `AuthoringPromptInput`, documented as whether an architecture provider is configured, for a plan, and null for a spec. In `buildAuthoringPrompt`, for a plan, add exactly one bullet after the `You are authoring …` line and its blank line, before `- Return ONLY a JSON object …`. When true it reads `- An architecture provider is configured: before cutting phases, run \`phax architecture\` (or \`phax architecture <path>...\` for the parts the plan touches) and plan against its answer.` When false it reads `- No architecture provider is configured: do not run \`phax architecture\`; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).` For a spec (null), the prompt is byte-for-byte what it is today.
- In `src/domain/security/agentCommands.ts`, export `ARCHITECTURE_AGENT_COMMAND = "phax architecture"` and the pure `authoringAgentCommands(input: { readonly kind: ArtifactKind; readonly architectureProvider: boolean }): readonly string[]`. It returns `[ARCHITECTURE_AGENT_COMMAND]` for a plan with a provider, and `[]` otherwise.
- In `src/app/authorArtifact.ts`, add `readonly architectureProvider: boolean` to `AuthorArtifactInput`, documented as whether `architecture` is declared in a config layer, read by the caller. Pass `architectureProvider: input.kind === "plan" ? input.architectureProvider : null` to `buildAuthoringPrompt`. In `runAuthoringSession`, compute `const granted = authoringAgentCommands({ kind: input.kind, architectureProvider: input.architectureProvider })` and keep the policy from `resolveReviewSecurityPolicy(...)`. Build `options` with `security: granted.length === 0 ? policy : { ...policy, agentCommands: [...policy.agentCommands, ...granted] }` and spread `...(granted.length > 0 ? { agentCommands: granted } : {})`. The retry already reuses `options`, so the grant carries into it. Do not edit `src/domain/security/resolveReviewPolicy.ts`: review and decide sessions keep their policy.
- In `src/cli/commands/artifact.ts`, pass `architectureProvider: config.architecture !== undefined` to `authorArtifact`. Add the required field to every other `AuthorArtifactInput` a test builds, so `pnpm test:type` stays green.
- In `.claude/skills/phax-planning/SKILL.md`, replace the body of `### The repository's architecture` with spec §6's text, kept as one paragraph or two. Read it before cutting phases. Run `phax architecture`, or `phax architecture <path>...` for the parts the plan touches: with an architecture provider configured, it prints the repository's architecture. Without one, it exits 1 with one line saying so. That exit means: read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead, and carry on. It is not a failure of the repository. Either way, plan against it: its parts, the direction of their dependencies, and the boundaries its own checks enforce. In `## Planning constraints`, change the "No phax lifecycle commands in a phase" bullet to say phax refuses every command except `phax brief`, `phax architecture` and the read-only ones. Touch neither generated block (`phase-model-policy`, `model-catalog`), and run `pnpm gen:model-catalog --check` to confirm they are unchanged.
- In `tests/unit/skills.test.ts`, replace `expect(content).not.toContain("phax architecture")` in the "reads the repository's architecture …" case with assertions on `### The repository's architecture`. The section contains `` `phax architecture` ``, `exits 1`, `README`, `CLAUDE.md`, `carry on` and `not a failure of the repository`. Rename the case to say it reads the architecture from `phax architecture`, or from the code and its documentation.
- In `.claude/skills/phax-cli/SKILL.md`, add `- \`phax architecture [path…]\`;` after `phax brief` in the phase-guard list. In `## Gate steps, briefs and records`, add `*Architecture provider*` to the list of README sections. Add a bullet after `brief`: **`architecture`** (`command`, required): a provider that answers `phax architecture [path…]` with the repository's architecture as a Markdown body. With none configured, the command exits 1 with one line telling the agent to read the code and its documentation. It writes nothing, and a headless plan session is granted it when one is configured.
- Add `docs/architecture-provider.md`, titled `# Architecture provider`, written for a repository owner and for a provider author, per spec §11. Declare `"architecture": { "command": "acme-guard architecture" }` in phax.json (or phax.local.json, or ~/.phax/config.json, the highest layer winning). Show `phax architecture` and `phax architecture src/core` printing a made-up `# Architecture — acme-billing` body. Show the request on stdin in both forms, with `files: null` and with root-relative paths, and the minimal report `{ $schema, body }`, every other key refused. Use the `$schema` stamp phase-01 wrote. Say the provider runs from the working tree's root with no shell and a fixed 60-second limit, and that a provider declining to answer exits non-zero. Show removing the key and the one stdout line with exit 1, telling the agent to read the code and its documentation and carry on. Show a failure line. Cover phase worktrees: allowed there, config from the main checkout, no record written. Cover headless plan authoring: the prompt says whether a provider is configured, and the session is granted only `phax architecture`. State the limits it runs under there: it may write only `.phax-context/`, the network is provider-only, and it must not count on writing a cache or reaching the network. Every example is made up.
- Route the page. In `site/pages.ts`, add a `files` entry `{ route: "/guide/architecture-provider", title: "Architecture provider", source: "docs/architecture-provider.md", description }` after `/guide/plan-estimate`. Give it a one-sentence description as long as its neighbours'. In `site/build/sources.ts`, add `"docs/architecture-provider.md"` to `SOURCE_FILES`.
- In the README's `## Extend phax`, change the opening sentence to four hooks, adding an architecture provider that answers with the repository's architecture for planners. Add a short `### Architecture provider` subsection between `### Brief provider` and `### Plan auditor`: the config JSON, two or three sentences (what `phax architecture` prints, its no-provider exit 1 line, that it writes nothing), and a link to `docs/architecture-provider.md`. Do not copy paragraphs from the docs page word for word.
- In `NEXT_STEPS.md`, tick `planning-skill-defaults` under `### In flight`: `- [x]`, saying plan 2 (`phax architecture`) landed and the spec is complete. If the In flight section is then empty of open items, keep the ticked line until the next prune, as the file's header says.

### Planned files to create

- `docs/architecture-provider.md`

### Planned files to edit

- `src/domain/authoring/prompt.ts`
- `src/domain/security/agentCommands.ts`
- `src/app/authorArtifact.ts`
- `src/cli/commands/artifact.ts`
- `tests/unit/authoringPrompt.test.ts`
- `tests/integration/authorArtifact.test.ts`
- `tests/unit/skills.test.ts`
- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`
- `site/pages.ts`
- `site/build/sources.ts`
- `README.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `tests/integration/authorArtifactRetry.test.ts`
- `tests/integration/writeAuthoringRecord.test.ts`
- `tests/integration/decideHandAuthored.test.ts`
- `tests/e2e/headlessAuthoring.test.ts`
- `tests/unit/security/agentCommands.test.ts`
- `src/cli/cliDocs.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `tests/unit/site/pages.test.ts`

### Boundary contracts

The CLI (`src/cli/commands/artifact.ts`) is the only reader of the config here. It hands `authorArtifact` one fact, `architectureProvider: boolean`. The domain turns that fact into two outputs, both pure: the prompt bullet (`buildAuthoringPrompt`) and the grant (`authoringAgentCommands`). The app puts the grant on the session's `AgentRunOptions.agentCommands` and on its policy's `agentCommands`. The provider adapters consume it unchanged, and Claude Code maps it to `Bash(phax architecture:*)`. With no provider, the options are exactly today's. The headless planner consumes `phax architecture` from phase-01 as an ordinary pull: one line and exit 1 when none is configured, which the prompt already rules out by telling it not to run the command.

### Test strategy

Write the prompt and grant tests before the implementation. `tests/unit/authoringPrompt.test.ts` covers three prompts. A plan prompt with `architectureProvider: true` contains the configured bullet before `- Return ONLY`. With `false` it contains the no-provider bullet and does not ask the planner to run the command. A spec prompt with `null` equals its current text, with no architecture line. If a unit test file for agent commands exists, add `authoringAgentCommands` cases there: plan with a provider, plan without one, spec with a provider. Otherwise cover it through the integration test.

`tests/integration/authorArtifact.test.ts` uses its fake backend capturing `AgentRunOptions` and a secure security profile. With `architectureProvider: true` on a plan, `options.agentCommands` is `["phax architecture"]`, `options.security.agentCommands` contains `phax architecture` after `git`, and the session's `prompt.md` contains the configured statement. With `false`, `options` has no `agentCommands`, `options.security.agentCommands` is `["git"]`, and `prompt.md` contains the no-provider statement. A spec session with `true` gets no grant and no statement. The retry case keeps the grant on its resume. `tests/unit/skills.test.ts` asserts the new architecture paragraph, and the existing doctrine, example-architecture and comprehensive-instructions cases stay green. The terminal gates (`pnpm site:build`) check the new page is routed and listed.

### Implementation order

1. `buildAuthoringPrompt`'s statements and `authoringAgentCommands`, test first.
2. `authorArtifact`'s input, prompt call and session options, then `artifact.ts`, then the integration test and the other input builders.
3. The phax-planning skill paragraph and constraint, and its test, then the phax-cli skill.
4. The docs page, its route and source entry, then the README subsection.
5. NEXT_STEPS.

### Excluded scope

- Any change to `phax architecture` itself, its formats or its messages (phase-01).
- Spec authoring prompts and the phax-spec skill (spec §7).
- Changing `resolveReviewSecurityPolicy`, the review or decide sessions' policy, or the authoring session's write scope or network profile.
- Pushing the architecture into the authoring prompt or a phase's prompt (spec §7, Q3).
- Changing `authoring.plan`, the planner's own model, or the model policy and generated blocks plan 1 shipped.
- Bringing the brief into plan authoring (`phase-model-assignment` and NEXT_STEPS items).

### Verification

The `standard` gate profile in phax.json. The run needs `phax run --allow-skill-edits`, because this phase declares two `.claude/skills/` files.

### Expected handoff content

Give the exact signature of `authoringAgentCommands` and of `ARCHITECTURE_AGENT_COMMAND` (`src/domain/security/agentCommands.ts`). Give the new `architectureProvider` fields on `AuthoringPromptInput` and `AuthorArtifactInput`, and quote the two prompt bullets as written. Say how the grant appears in the captured `AgentRunOptions` with and without a provider, and confirm the spec prompt is unchanged. Quote the skill's new `### The repository's architecture` paragraph. Give the docs page's route and the stamp it shows. Explain every deviation phax flags against the planned file lists, including each optional test file touched and why.

### Commit subject

`feat(authoring): point the plan planner at phax architecture`

### Commit body

A headless plan authoring prompt now states whether an architecture provider is configured. With one, it tells the planner to run phax architecture, with no path or with the paths the plan touches, before cutting phases, and the session is granted exactly that command. With none, it tells the planner to read the architecture from the code and its documentation, and the session's commands are the same as before. Spec prompts are unchanged, and review and decide sessions keep their policy.

The phax-planning skill tells every planner to read the repository's architecture with phax architecture, and to treat its no-provider exit 1 as "read the code and its documentation, and carry on", not a failure. The phax-cli skill lists the command and its config key. A new docs page, Architecture provider, shows repository owners and provider authors the config key, the request and report, the no-provider answer and the limits a provider runs under in a headless planning session. NEXT_STEPS marks planning-skill-defaults complete.
