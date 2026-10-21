---
status: Approved
source-spec: docs/specs/2610201518-oracle-phases.md
completes-spec: true
approved:
  date: 2026-10-21
  baseline: 273050a
---
# Vitest oracles example

The third and last plan of oracle-phases. Plans 1 and 2 landed the whole phax side: the `oracles` block, the `oracle-request` format (src/schemas/oracleRequest.ts and the schemas package's `parseOracleRequest`), the oracle step in the gate loop (src/app/gates.ts, src/app/executePlan.ts), and `phax resume <run> --skip-oracle`. This plan adds the example Vitest oracles provider as repository tooling under `examples/vitest-oracles/` (§5.42, §5.44–§5.48), declares it as phax's own `oracles` provider in phax.json (§5.43), points README §Oracle provider and docs/oracle-phases.md at it, and marks the spec complete in NEXT_STEPS.md. Nothing under `src/` changes: the example only reads an `oracle-request` on stdin and prints a `gate-report` on stdout, and phax keeps no test-framework knowledge (§5.41).

Ground facts the phase relies on:
- vitest.config.ts collects only `tests/unit/**` and `tests/integration/**`, so the example's tests live in `tests/integration/`, beside the hello-world example's `exampleProviders.test.ts`.
- knip.json's `project` covers src, tests, packages/schemas and site only, so a dependency imported only from `examples/` would be reported unused. The example's entry and files join knip's `entry` and `project`.
- tsconfig.json and tsconfig.test.json do not include `examples/`, and `.mjs` files are not typechecked; the hello-world example is `.mjs` run by `node`, and so is this one.
- The architecture audit (tests/unit/architecturalGuards.test.ts) scans `src/` only.
- oxlint and oxfmt cover `examples/` already (hello-world).
- phax.schema.json and phax.user.schema.json already describe `oracles` (plan 1), so declaring it needs no `phax schema upgrade`.
- tests/unit/exampleStamps.test.ts keeps every `$schema` literal of an example at its format's current stamp; gate-report's is 0.21.0 today.

## Required commands

- `pnpm add`
- `node`

Both are already in `security.agentCommands` (`pnpm add` to pin the parser as a devDependency, `node` to try the example by hand), so no PHAX security configuration change is needed. The oracles command itself needs no entry: phax runs it only at the gate, and src/app/executePlan.ts (`oracleStepFor`) states it is in no grant, frozen command set or prompt list.

## Technical arbitrations

- Folder, files and command: `examples/vitest-oracles/` holds README.md and five ES modules run by plain `node`, like examples/hello-world: main.mjs (stdin, wiring, printing), request.mjs (reading the request), git.mjs (files at a commit), syntax.mjs (parsing, test collection, marker stripping, normalized trees) and verdicts.mjs (the two verdicts). phax.json declares `"oracles": { "command": "node examples/vitest-oracles/main.mjs" }`, a path relative to the gated worktree, where phax runs it. Loss accepted: no typecheck of the example (tsconfig does not include `.mjs`), in exchange for an example another repository copies and runs with node alone, no tsx.
- The example's tests live in tests/integration/vitestOraclesExample.test.ts, not in the example's folder. Loss accepted: copying the folder leaves its tests behind; in exchange the tests are typechecked by `pnpm test:type`, collected by `pnpm test`, and need no change to vitest.config.ts or the tsconfigs.
- Test identity: a test is a call whose callee chain (through member accesses and calls, e.g. `test.fails.each(table)`) is rooted at the identifier `test` or `it`; a block is one rooted at `describe` or `suite`. A test's identity is the titles of its enclosing blocks and its own title joined by ` > `. A title is the value of a string literal or a template literal without substitutions; any other title expression is identified by its normalized syntax tree serialized to text. Two tests with the same identity in one file get ` #2`, ` #3`… by source order. Renaming a test or a block is a deletion plus an addition. Loss accepted: tests created through `test.extend` fixtures or helper wrappers are not recognized; the README says to adapt the roots.
- `test.each`/`test.for` tables and `describe.each` blocks: a table test is one test identified by its title template (e.g. `adds %i`); its table is part of its tree, so changing a row modifies the test. Nested `describe` blocks only contribute their titles to the identity. Loss accepted: a changed row cannot be told apart from a changed body; both are a modification.
- Marker: a non-computed `fails` member in a test's callee chain (`test.fails`, `it.fails`, `test.concurrent.fails`, `test.fails.each(…)`). Only those positions are markers, stripped or counted; a `.fails` property elsewhere (e.g. `result.fails` in an assertion) is ordinary code. This is the precise reading of §5.46's 'every `.fails` member access removed'.
- Syntax-tree comparison: a file is parsed to ESTree, then normalized by dropping position and source-spelling keys (`start`, `end`, `range`, `loc`, `raw`) and parentheses, then serialized; equality is equality of the serializations. Comments are not part of the tree, so a comment change is not a change. Whitespace, line breaks, trailing commas, quote style and numeric separators never change a verdict. Loss accepted: a reworded comment inside an oracle never reaches the reviewer through the provider.
- Authored verdict per oracle file: every test now in the working tree that is new since `base` (its identity is absent at base) or modified (its marker-stripped tree differs from base's) must carry a marker; each that does not is one finding naming the test. Deleted tests, marked tests and unchanged tests are never findings. Changes outside tests (imports, helpers, hooks) are not judged; an unmarked test they break turns the configured `pnpm test` step red first. A file absent at base counts all its tests as new; a file absent now has no test and no finding; a working-tree file that does not parse is one finding (not a refusal), so the fix loop can repair it.
- Discharged verdict per oracle file: one finding per marker left in the working tree, naming its test; and one finding when the marker-stripped normalized tree now differs from the marker-stripped tree at `oracleCommit` (both sides stripped, so a left marker is reported once, as a marker). That finding names the first test whose tree differs, was deleted or was added, or says the change lies outside any test. A file present at `oracleCommit` and absent now, or the reverse, is a changed finding; absent at both is no finding. A working-tree file that does not parse is a finding. A file at `oracleCommit` that does not parse is a refusal whose remedy is correcting the oracle in the phase's worktree and `phax resume <run> --skip-oracle`, because the discharge's fix loop cannot repair a committed oracle.
- Requests the example cannot read are `refused` gate reports with a one-line reason naming the defect and a one-line remedy: stdin that is not JSON; a missing `$schema` or one that does not name the `oracle-request` format (any X.Y.Z release is accepted, since the exact key check catches a reshaped format); a `verdict` other than `authored` or `discharged`; keys other than exactly its variant's; a malformed phase id or commit; a file path that is absolute, contains a `..` segment or does not end in .ts, .tsx, .mts, .cts, .js, .jsx, .mjs or .cjs; a `base` or `oracleCommit` that is not a commit of the repository in the current directory. Output is one gate-report JSON line; exit 0 only for a checked report with no finding, exit 1 otherwise.
- Files at a commit are read with `git cat-file -e <sha>:<path>` (existence) and `git cat-file blob <sha>:<path>` (content) through `execFileSync` with argument arrays and the gated worktree as cwd, never a shell string; working-tree files are read from disk under cwd.
- phax's own config: phax.json gains the `oracles` block and nothing else. With no oracle phase in a plan, nothing changes for that plan (§5.40); the headless plan-authoring prompt will now tell planners an oracles provider is configured, which is the point of §5.43.

## Arbitrated questions

### q-judge-editable — The provider runs from the gated phase's worktree, so a phase agent can edit the example's code (examples/vitest-oracles/) or the worktree's node_modules/oxc-parser and change the verdict on its own oracle. How does phax's own repository live with that?

- accept-document — Accept it: phax.json runs the worktree's copy, and the example's README documents the limit and a phax.local.json recipe pointing at the main checkout's copy — abandons: A verdict the judged phase cannot bend on phax's own runs: an agent can rewrite examples/vitest-oracles/ so its unmarked or altered oracle passes (reconciliation flags that as an unplanned edit it must explain), or patch node_modules/oxc-parser in its worktree (git-ignored, flagged by nothing); only the reviewer stands between such an edit and a green oracle step.
- main-checkout-local — phax.json keeps the relative command (§5.43), and each operator overrides it in phax.local.json with the absolute path of the main checkout's main.mjs, which the phase agent's write scope does not reach — abandons: The committed declaration being the one that runs, and judging with the branch's own example: every machine runs a per-operator path, a plan that changes the example is judged by the main checkout's old copy, and a fresh clone silently runs the editable worktree copy until someone writes the override.
- protected-folder — A new phax rule: an edit under a configured folder (here the example's) that the phase does not plan fails lint or the gate — abandons: This plan's spec boundary: it adds a protected-paths feature to src/ that the spec does not ask for (§7 rules out file-system enforcement around oracles, and nothing under src/ is meant to change), and it still misses node_modules, which no plan lists and git ignores.

Recommendation: accept-document — Every configured gate step already runs code the phase can edit (package.json scripts, vitest.config.ts, .oxlintrc.json, the test files themselves), so the example adds no reach a phase lacks today, and the oracles command stays out of every grant, so what the agent can run is unchanged. Reconciliation already makes an edit to the example a deviation the agent must explain. The README recipe gives an operator who wants the stronger guarantee the main-checkout override without making it the default. This is a security-relevant loss, so it is the operator's call.

Decision: accept-document — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: Every configured gate step already runs code the phase can edit (package.json scripts, vitest.config.ts, .oxlintrc.json, the test files themselves), so the example adds no reach a phase lacks today, and the oracles command stays out of every grant, so what the agent can run is unchanged. Reconciliation already makes an edit to the example a deviation the agent must explain. The README recipe gives an operator who wants the stronger guarantee the main-checkout override without making it the default. This is a security-relevant loss, so it is the operator's call. Advocate: Running the main checkout's copy, or protecting the example's folder, would give a verdict the judged phase cannot bend on phax's own runs. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-01.

### q-parser — Which parser does the example use to build the syntax trees it compares? The spec suggests web-tree-sitter with a WebAssembly TypeScript grammar; the lockfile already holds another TypeScript parser.

- oxc-parser — oxc-parser pinned exactly (-E) as a devDependency at the version pnpm-lock.yaml already resolves for knip (0.128.0 today): ESTree output, TypeScript and JSX, prebuilt per-platform binaries plus a wasm32-wasi fallback, no install script — abandons: A parser that is WebAssembly on every platform, as the spec suggests: on common platforms it loads a prebuilt native .node binary (the same binary `pnpm knip` already loads at every phase's gate), and only a platform without a prebuilt binary falls back to the WASI build.
- web-tree-sitter — web-tree-sitter plus a WebAssembly TypeScript grammar package, both pinned exactly as devDependencies — abandons: Adding no new code to what runs at the gate: two packages from publishers new to the lockfile run at phax's oracle gates, the grammar's .wasm has to match web-tree-sitter's ABI across every upgrade, and tree-sitter's concrete syntax tree keeps punctuation and comments as nodes, so formatting-blindness has to be stripped in by hand.

Recommendation: oxc-parser — It widens nothing: the package and its binaries are already in the lockfile and already run at every gate through knip, so pinning it only adds a direct symlink. It meets the spec's real constraint, installing without a native build: no node-gyp, no install script, nothing added to pnpm-workspace.yaml's onlyBuiltDependencies. Its ESTree drops comments, whitespace and trailing commas by construction. The phase below is written for this option. Choosing web-tree-sitter changes only phase-01's dependency step and syntax.mjs, not the verdict semantics.

Decision: oxc-parser — by operator (Rémy Loubradou), 2026-10-21
Why: Decided by the operator on 2026-10-21, as recommended: It widens nothing: the package and its binaries are already in the lockfile and already run at every gate through knip, so pinning it only adds a direct symlink. It meets the spec's real constraint, installing without a native build: no node-gyp, no install script, nothing added to pnpm-workspace.yaml's onlyBuiltDependencies. Its ESTree drops comments, whitespace and trailing commas by construction. The phase below is written for this option. Choosing web-tree-sitter changes only phase-01's dependency step and syntax.mjs, not the verdict semantics. Advocate: web-tree-sitter keeps the parser WebAssembly on every platform, as the spec suggested, with no native binary loaded at the oracle gate. Principles: none. Reversibility: cheap. Revised: none. Phase: phase-01.

## Decision log

- 2026-10-21 q-judge-editable decided accept-document — operator (Rémy Loubradou)
- 2026-10-21 q-parser decided oxc-parser — operator (Rémy Loubradou)

---

## phase-01 — The Vitest oracles example and phax's own declaration {#phase-01-vitest-oracles-example}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The phase designs what no code in the repository shows yet: a syntax-tree comparison over a parser phax has never called, with test identity, marker stripping and formatting-blind equality whose edge cases decide verdicts. The policy's stronger option applies, and high effort on the default model suits one well-specified phase whose design choices are already fixed in Technical arbitrations.

phax's own repository gets a working oracles provider: `examples/vitest-oracles/` reads an `oracle-request` on stdin and answers a `gate-report` that judges authored and discharged oracles by their syntax trees, phax.json declares it, and the docs point provider authors at it, so phax's own plans can be oracle-first.

### Detailed instructions

- Read the plan preamble's Technical arbitrations first: they fix the folder, the command, test identity, markers, the normalization, both verdicts, the refusals and how files are read at a commit. Implement them as written.
- Pin the parser: read the oxc-parser version pnpm-lock.yaml resolves for knip (0.128.0 at planning time) and run `pnpm add -D -E --prefer-offline oxc-parser@<that version>`. package.json gains the exact devDependency and pnpm-lock.yaml an importer entry, with no new package entry. Check node_modules/oxc-parser/src-js/index.d.ts for `parseSync(filename, sourceText, options)`, its `errors` array and the option that drops parentheses (`preserveParens: false`), and use what the installed version declares.
- examples/vitest-oracles/request.mjs: export one function that takes the raw stdin text and returns either `{ request }` or `{ refused: { reason, remedy } }`, covering every refusal in the arbitrations except the commit-existence check (git.mjs). The `$schema` must match `^https://docs\.phax\.run/schemas/oracle-request/\d+\.\d+\.\d+\.json$`. `authored` keys are exactly $schema, verdict, phase, oraclePhase, base, files; `discharged` adds oracleCommit. Phase ids match `^phase-\d{2}$`, commits are 40 or 64 lowercase hex characters, and files is a non-empty array of non-empty strings.
- examples/vitest-oracles/git.mjs: `commitExists(cwd, sha)` (`git cat-file -e <sha>^{commit}`), `fileAt(cwd, sha, path)` returning the blob text or null when absent (`git cat-file -e` then `git cat-file blob`), and `fileNow(cwd, path)` reading the working tree, or null. Use `execFileSync('git', [...], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })`, never a shell string.
- examples/vitest-oracles/syntax.mjs: `parse(path, text)` returning `{ program }` or `{ error: { message, line } }`; `testsOf(program, text)` returning each test's identity, marked flag, marker positions (line numbers), start and end lines, and its marker-stripped normalized serialization; `strippedProgram(program)` returning the whole file's marker-stripped normalized serialization. The normalizer is one recursive function dropping `start`, `end`, `range`, `loc` and `raw`, applied to both sides of every comparison. Marker stripping replaces each `fails` member in a test's callee chain by its object, on a copy.
- examples/vitest-oracles/verdicts.mjs: `authoredFindings(cwd, request)` and `dischargedFindings(cwd, request)`, each returning `{ findings }` or `{ refused }` per the arbitrations. A finding has exactly `{ id, rule, location: { file, lines }, message, related: [], guide: null }`, with `lines` `[start, end]` or null. Ids are `oracle-unmarked:<file>:<identity>`, `oracle-marker-left:<file>:<identity>`, `oracle-changed:<file>` and `oracle-unparsable:<file>`, unique within a report. Rules are one sentence each, for example 'In the oracle phase, every test added or modified in an oracle file carries the runner's expected-failure marker' and 'After the oracle phase, only the expected-failure markers may change in an oracle file'. Findings follow the request's file order, then source order.
- examples/vitest-oracles/main.mjs: read stdin to its end (`for await` over process.stdin, as examples/hello-world/brief.mjs does), decode with request.mjs, refuse an absent commit through git.mjs, dispatch on `verdict`, and print one line `JSON.stringify(report) + "\n"`, whose `$schema` literal is `https://docs.phax.run/schemas/gate-report/0.21.0.json` (gate-report's current stamp). A checked report always carries `review: []`. Set `process.exitCode` to 0 only for a checked report with no finding, 1 otherwise. Let an unexpected exception crash with no report: phax then fails the step as broken.
- examples/vitest-oracles/README.md: what the provider answers for each verdict and why (oracles written before the code and judged apart from it; marker removal is the only change allowed at discharge), the exact identity, marker and normalization rules, the refusals, the command phax.json uses, and how to adapt it to another runner (replace the parser, the test and block roots, the marker; pytest's `xfail(strict=True)` is a decorator rather than a member). Add a 'Limits' section that states the q-judge-editable outcome: the provider runs the worktree's copy, so a phase can edit it; reconciliation flags such an edit. Give the phax.local.json override for an operator who wants the main checkout's copy to judge.
- phax.json: add `"oracles": { "command": "node examples/vitest-oracles/main.mjs" }` as a top-level key after `commands` and before `gateProfiles`. Change nothing else. Add no `security.agentCommands` entry: the oracles command is in no grant.
- knip.json: add `examples/vitest-oracles/main.mjs` to `entry` and `examples/vitest-oracles/**/*.mjs` to `project`, so knip sees the oxc-parser import and checks the example's exports. Export nothing a sibling module does not import.
- tests/unit/exampleStamps.test.ts: add `examples/vitest-oracles/main.mjs` to FILES, so its gate-report literal follows the current stamp.
- tests/integration/vitestOraclesExample.test.ts: spawn `process.execPath` on the absolute path of examples/vitest-oracles/main.mjs with `spawnSync` (input = the request, cwd = a temporary git repository built per test with mkdtempSync, `git init -q` and commits made with `-c user.name=t -c user.email=t@example.com`). Build every request with `serializeOracleRequest` from src/app/gates.ts, so the example reads exactly the bytes phax writes. Read every answer through `parseGateReport` (packages/schemas/src/index.js) and `readGateReport` (src/schemas/persisted.js), and assert `$schema` equals `currentSchemaUrl('gate-report')`. Never read ~/.phax. Fixtures are made up: tests/prune.test.ts, tests/refunds.test.ts in an acme-billing-like repository.
- In README.md §Oracle provider, add one or two sentences after the paragraph on the request and answer: the phax repository carries a Vitest example in examples/vitest-oracles/ that compares syntax trees, declared in phax's own phax.json as `node examples/vitest-oracles/main.mjs`, shipped in no package, to copy and adapt (link the directory). If README's providers paragraph that names examples/hello-world/ lists examples, add this one there too.
- In docs/oracle-phases.md, add a short '## An example provider' section after '## The answer': what the example answers for each verdict, that it compares syntax trees so reformatting never changes its answer, and the link `../examples/vitest-oracles/` (a relative directory link, which the site build turns into a GitHub URL). Keep every other section as plans 1 and 2 left it.
- NEXT_STEPS.md: mark the `oracle-phases` entry `[x]`. Record that plan 3 landed: the example provider (built on the parser q-parser chose, not tree-sitter unless decided so) and phax's own `oracles` declaration. Record that the spec is complete.

### Planned files to create

- `examples/vitest-oracles/README.md`
- `examples/vitest-oracles/main.mjs`
- `examples/vitest-oracles/request.mjs`
- `examples/vitest-oracles/git.mjs`
- `examples/vitest-oracles/syntax.mjs`
- `examples/vitest-oracles/verdicts.mjs`
- `tests/integration/vitestOraclesExample.test.ts`

### Planned files to edit

- `package.json`
- `pnpm-lock.yaml`
- `knip.json`
- `phax.json`
- `tests/unit/exampleStamps.test.ts`
- `README.md`
- `docs/oracle-phases.md`
- `NEXT_STEPS.md`

### Optional files that may be edited

- `tests/integration/exampleProviders.test.ts`
- `tests/unit/releaseCut.test.ts`

### Boundary contracts

Consumer: the example provider, which reads phax's oracle request. Producer: phax's oracle step (src/app/gates.ts `serializeOracleRequest`). Shape: oracle-request, `{ $schema, verdict: authored, phase, oraclePhase, base, files }` or the `discharged` variant adding `oracleCommit`, every key required and no other. The example must read exactly the bytes phax writes, so the tests build requests with phax's own serializer. Consumer: phax's report judging (`readGateReport`). Producer: the example. Shape: gate-report, a checked `{ $schema, outcome, findings, review }` on exit 0 with no finding, or any exit with findings, or a refused `{ $schema, outcome, reason, remedy }`. Nothing under src/ imports the example, and the example imports nothing from src/: it is tied to phax only by these two documents.

### Test strategy

Integration tests in tests/integration/vitestOraclesExample.test.ts, written before the example's modules, each spawning the example as phax does. Each maps to a §8 criterion:
- Authored judging (§5.44): base holds tests/prune.test.ts with `keeps the newest run` and `drops archived runs`. The working tree adds `test.fails('refunds a partial capture', …)` and `it('caps a refund at the invoice total', …)`, modifies `keeps the newest run` without `.fails`, and deletes `drops archived runs`. Exactly two findings, naming `caps a refund at the invoice total` and `keeps the newest run`, exit 1.
- Authored, all marked: a new file absent at base whose tests are all marked gives a checked report with no finding, exit 0.
- Identity: in nested `describe` blocks, a `test.each` row changed without a marker is one finding whose id carries `outer > inner > <title template>`. A test of the same title in another block is not confused with it.
- Reformat and comments (§5.47): in authored, base and working tree differ only by the re-indentation and a comment of one unchanged test, giving no finding. In discharged, removing both markers plus re-indenting, moving line breaks, adding trailing commas and switching quote style gives no finding.
- Unparsable: an unparsable oracle file in the working tree is one `oracle-unparsable` finding, not a refusal.
- Discharge markers (§5.45): an oracle commit's tests/refunds.test.ts holds two `test.fails` tests. Removing one marker gives exactly one finding, naming the remaining one. Removing both gives no finding and exit 0.
- Discharge changes (§5.46), each giving a finding naming tests/refunds.test.ts:
  - both markers removed plus `toBe(120)` → `toBe(100)`;
  - plus a deleted test;
  - `test.fails` → `test.skip`;
  - the oracle file deleted.
- Refusals (§5.48): no `$schema`, `verdict: approved`, stdin that is not JSON, and a `base` that is not a commit of the repository. Each gives a refused gate report carrying `$schema`, a reason naming the defect, and a remedy.
- Stability: the same request twice prints identical stdout.
- phax's own config (§5.43): `decodePhaxConfig` on the repository's phax.json succeeds with `oracles.command` `node examples/vitest-oracles/main.mjs`. That command, split on whitespace, is spawned with cwd the repository root on an `authored` request whose base is `git rev-parse HEAD` and whose file is one this phase leaves untouched (tests/integration/exampleProviders.test.ts). It prints a checked gate report carrying `$schema` with no finding.
- Outside the CLI (§5.42): no file under src/ names `examples/vitest-oracles` or imports from an `examples/` path. Neither package.json's nor npm/package.json's `files` holds an `examples` entry. phax.usage.kdl does not mention vitest-oracles.

tests/unit/exampleStamps.test.ts then also guards main.mjs's gate-report stamp.

### Implementation order

1. Pin oxc-parser and check its declared API in node_modules.
2. Write tests/integration/vitestOraclesExample.test.ts with its temporary-repository helpers (red).
3. request.mjs and git.mjs, then main.mjs with the refusal path, until the refusal tests pass.
4. syntax.mjs (parse, normalize, test collection, marker stripping).
5. verdicts.mjs, authored then discharged, until every verdict test passes.
6. knip.json and tests/unit/exampleStamps.test.ts.
7. phax.json's `oracles` block and the own-config test.
8. The example's README, README.md, docs/oracle-phases.md and NEXT_STEPS.md, then the full standard gate.

### Excluded scope

- Any change under src/ or packages/schemas/: the oracle step, the request and report formats, the `oracles` block and `--skip-oracle` landed in plans 1 and 2.
- A protected-paths rule or any enforcement around the example's folder (q-judge-editable).
- Providers for other runners (pytest, Jest), and shipping the example in either npm package (q-example-ships: repo-only).
- Recognizing `test.extend` fixtures or custom test wrappers.
- Changes to tsconfig.json, tsconfig.test.json, vitest.config.ts or .oxlintrc.json.
- The run-cost table and the release notes in NEXT_STEPS.md, which the operator fills after the run.

### Verification

The `standard` gate profile in phax.json, including its terminal steps, since this is the run's last phase: pnpm format, typecheck, test:type, lint, format:check, test, knip, audit:architecture, gen:model-catalog --check, then build, site:build, deno:smoke and deno:smoke-binary.

### Expected handoff content

- The oxc-parser version pinned and the parse options used, or the parser q-parser chose instead.
- The exact oracles command in phax.json.
- The module layout of examples/vitest-oracles/ with each module's exported functions.
- The identity, marker and normalization rules as implemented, with any point where the installed parser's tree forced a refinement of the Technical arbitrations, for example how it represents `test.each` or template titles.
- Each refusal reason the example emits.
- That knip, the architecture audit and the typecheck stayed green with the new folder, and what knip.json needed.
- Confirmation that nothing under src/ changed.
- Any deviation from the planned file lists, with the reason. A touched optional file is not a deviation.
- For the operator, after merge, in the main checkout: run `phax validate` and `phax plans lint` on any plan to see the declaration accepted.

### Commit subject

`feat(examples): add the Vitest oracles provider and declare it in phax.json`

### Commit body

Add examples/vitest-oracles/, repository tooling outside src/ that reads an oracle-request on stdin and answers a gate-report. For an authored verdict, every test added or modified since base in the oracle files must carry `.fails`; deleted tests are allowed. For a discharged verdict, no marker may be left, and each oracle file's marker-stripped syntax tree must equal its tree at the oracle commit. Trees are parsed with oxc-parser and compared without positions, spellings, comments or parentheses, so reformatting never changes a verdict. A request it cannot read is refused with a reason and a remedy.

phax.json declares it as phax's own oracles provider, so phax's own plans can be oracle-first. knip follows the example's imports. The example's tests run in pnpm test against temporary git repositories, using phax's own request serializer. README, docs/oracle-phases.md and NEXT_STEPS.md point at it. The oracle-phases spec is complete.
