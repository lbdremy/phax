# Vitest oracles provider

An [oracles provider](../../docs/oracle-phases.md) for [Vitest](https://vitest.dev). It reads an `oracle-request` on stdin and prints a `gate-report` on stdout, and it is the whole of phax's knowledge of Vitest: phax itself knows no test framework.

It lives in the phax repository only and ships in no package. Copy this folder into your repository and run it with plain `node`, no `tsx` and no build step.

## Use it

phax's own `phax.json` declares it as a path relative to the gated worktree, where phax runs it:

```json
{ "oracles": { "command": "node examples/vitest-oracles/main.mjs" } }
```

The only dependency is [`oxc-parser`](https://www.npmjs.com/package/oxc-parser), pinned as a devDependency (`pnpm add -D -E oxc-parser`). It installs a prebuilt binary, with no native build and no install script.

Try it by hand, in a Git repository, with a request on stdin:

```sh
echo '{"$schema":"https://docs.phax.run/schemas/oracle-request/0.21.0.json","verdict":"authored","phase":"phase-01","oraclePhase":"phase-01","base":"<full commit hash>","files":["tests/refunds.test.ts"]}' \
  | node examples/vitest-oracles/main.mjs
```

The output is one `gate-report` JSON line. The exit code is 0 only for a checked report with no finding, and 1 otherwise. An unexpected exception crashes with no report, and phax then fails the step as broken.

## What it answers

An oracle phase writes tests before the code, and a later phase writes the code that makes them pass. The oracles are judged apart from the code: the first phase may only add failing tests marked as expected to fail, and the second may only remove those markers.

- **`authored`**, at the oracle phase. Every test now in an oracle file that is new since `base` or modified since `base` must carry the marker. Each test that does not is one finding, `oracle-unmarked:<file>:<test>`.
  - A deleted test, a marked test and an unchanged test are never findings.
  - Changes outside tests (imports, helpers, hooks) are not judged. An unmarked test they break turns the configured `pnpm test` step red first.
  - A file absent at `base` counts all its tests as new. A file absent now has no test and no finding.
  - A file that does not parse in the working tree is one finding, `oracle-unparsable:<file>`, not a refusal, so the fix loop can repair it. A file that does not parse at `base` counts as absent.
- **`discharged`**, at the discharging phase. Two kinds of finding, per oracle file:
  - One `oracle-marker-left:<file>:<test>` per marker left in the working tree.
  - One `oracle-changed:<file>` when the file, with its markers removed, no longer equals the file at `oracleCommit`, also with its markers removed. Both sides are stripped, so a marker left behind is reported once, as a marker. The finding names the first test that differs, was added or was deleted, or says the change lies outside any test. A file present at `oracleCommit` and absent now, or the reverse, is a changed finding. A file absent at both is no finding.
  - A file that does not parse in the working tree is an `oracle-unparsable` finding. A file that does not parse at `oracleCommit` is a refusal, because the discharge's fix loop cannot repair a committed oracle.

Findings follow the request's file order, then source order, and every id is unique within a report.

## The rules

**Test identity.** A test is a call whose callee chain, through member accesses and calls (`test.fails.each(table)`), is rooted at the identifier `test` or `it`. A block is one rooted at `describe` or `suite`. A test's identity is the titles of its enclosing blocks and its own title joined by `>`. A title is the value of a string literal, or of a template literal without substitutions; any other title expression is identified by its normalized syntax tree serialized to text. Two tests with the same identity in one file get ` #2`, ` #3`… by source order. Renaming a test or a block is a deletion plus an addition.

**Tables.** A `test.each` or `test.for` test is one test identified by its title template (`adds %i`), and its table is part of its tree, so changing a row modifies the test. `describe.each` blocks and nested `describe` blocks only contribute their titles to the identity.

**Marker.** A non-computed `fails` member in a test's callee chain: `test.fails`, `it.fails`, `test.concurrent.fails`, `test.fails.each(…)`. Only those positions are markers. A `.fails` elsewhere, such as `result.fails` in an assertion, is ordinary code.

**Normalization.** A file is parsed with `oxc-parser` (`parseSync`, `preserveParens: false`) to ESTree. The tree is normalized by dropping `start`, `end`, `range`, `loc` and `raw`, and then serialized. Equality is equality of the serializations, and a marker is stripped by replacing the `fails` member with its object. Parentheses and comments are not part of the tree, so whitespace, line breaks, trailing commas, quote style, numeric separators, parentheses and comments never change a verdict. A reworded comment inside an oracle therefore never reaches the reviewer through this provider.

## Refusals

A request it cannot read is a `refused` report with a one-line reason naming the defect and a one-line remedy:

- stdin that is not JSON, or not a JSON object;
- a missing `$schema`, or one that does not name the `oracle-request` format (any `X.Y.Z` release is accepted, the exact key check catches a reshaped format);
- a `verdict` other than `authored` or `discharged`;
- keys other than exactly its variant's: `$schema`, `verdict`, `phase`, `oraclePhase`, `base`, `files`, plus `oracleCommit` for `discharged`;
- a malformed phase id or commit;
- an empty `files`, or a file path that is absolute, has a `..` segment or does not end in `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` or `.cjs`;
- a `base` or `oracleCommit` that is not a commit of the repository in the current directory;
- an oracle file that does not parse at `oracleCommit`. Its remedy is to correct the oracle in the phase's worktree and run `phax resume <run> --skip-oracle`.

## Adapt it to another runner

- **Parser.** Replace `oxc-parser` in `syntax.mjs` with a parser for your language. Keep `parse`, `testsOf` and `strippedProgram`: the verdicts in `verdicts.mjs` use nothing else.
- **Roots.** Change the test and block roots in `syntax.mjs` (`TEST_ROOTS`, `BLOCK_ROOTS`). Tests created through `test.extend` fixtures or helper wrappers are not recognized until you add their roots.
- **Marker.** Change `MARKER`, or the detection in `calleeChain`, when your runner marks an expected failure differently. pytest's `xfail(strict=True)` is a decorator, not a member of a callee chain, so for Python the marker is a decorator to find and strip on a function definition.
- **File types.** Change the extensions `request.mjs` accepts.

Modules: `main.mjs` (stdin, wiring, printing), `request.mjs` (reading the request), `git.mjs` (files at a commit, with `git cat-file` through argument arrays, never a shell), `syntax.mjs` (parsing, test collection, marker stripping, normalized trees) and `verdicts.mjs` (the two verdicts). phax's own tests for it are `tests/integration/vitestOraclesExample.test.ts`; copy them with it if you want them.

## Limits

- **The judged phase can edit its judge.** The provider runs from the gated phase's worktree, so a phase agent can edit this folder, or the worktree's `node_modules/oxc-parser`, and change the verdict on its own oracle. phax's reconciliation flags an edit to this folder as an unplanned file the agent must explain; nothing flags `node_modules`, which Git ignores. Every other configured gate step already runs code the phase can edit (`package.json` scripts, `vitest.config.ts`, the test files themselves), so this adds no reach a phase lacks today. Only the reviewer stands between such an edit and a green oracle step.
- **A stronger guarantee.** To judge with the main checkout's copy, which the phase agent's write scope does not reach, point your own `phax.local.json` at its absolute path:

  ```json
  { "oracles": { "command": "node /path/to/your/main/checkout/examples/vitest-oracles/main.mjs" } }
  ```

  That path is per operator, a plan that changes the example is then judged by the main checkout's old copy, and a fresh clone runs the editable worktree copy until the override is written.

- **A changed table row cannot be told apart from a changed body.** Both are a modification.
- **A reworded comment is invisible**, since comments are not part of the tree.
- **No typecheck.** The folder is plain `.mjs`, which the repository's `tsconfig` does not cover; its tests run in `pnpm test` and are typechecked by `pnpm test:type`.
