Write the phax plan "Vitest oracles example" for the approved spec `docs/specs/2610201518-oracle-phases.md`. It is the third and last plan of that spec, so it carries `completes-spec: true`.

Read the spec in full, especially:
- §5.41–§5.48;
- §6 "file: the example Vitest provider (repository tooling) and phax's own phax.json", and the request and answer surfaces;
- the §8 criteria "The example stays outside the CLI", "phax's own config declares the example", "The example judges authored oracles", "The example finds a marker left at discharge", "The example refuses any other change at discharge", "Reformatting never changes the example's answer" and "The example refuses a request it cannot read";
- §9b q-example-ships (`repo-only`);
- §10's settled points on the example's semantics.

Already landed (plans 1 and 2), do not redo: the whole phax side.
- The `oracles` block, the `oracle-request` format (`src/schemas/`, and the `@lbdremy/phax-schemas` package's `parseOracleRequest`), and the `gate-report` answer it judges.
- The oracle step in the gate loop and `phax resume --skip-oracle`.

The example only reads a request on stdin and prints a gate report on stdout.

In scope:
- **The example provider, repository tooling outside `src/`:**
  - it lives in the folder `examples/` already holds (`examples/hello-world`), for instance `examples/vitest-oracles/`;
  - no phax command runs it, and no module under `src/` imports it;
  - it has a README saying what it answers, why, and how to adapt it to another runner;
  - its own tests run in phax's `pnpm test`.
- **The semantics of §5.44–§5.48 and §10:**
  - **authored:** every test added or modified since `base` in the oracle files carries `.fails` (`test.fails`, `it.fails`); a deleted test is allowed;
  - **discharged:** no `.fails` is left, and each oracle file's syntax tree at `oracleCommit`, with every `.fails` member access removed, equals its tree now;
  - it compares syntax trees, never lines;
  - an oracle file with a syntax error is a finding, not a refusal;
  - a request it cannot read is a `refused` report with a reason and a remedy.
- **The parser.** It must install with no native build. web-tree-sitter with the TypeScript grammar as WebAssembly is the suggestion. Pin exact versions as devDependencies, and say in Technical arbitrations why each is safe to add. Raise it as an open question only if no WASM grammar package fits.
- **Reading files at a commit.** The provider runs from the gated worktree, as gate steps do (§5.23), and reads earlier file versions with git. Use argument arrays, never a shell string.
- **phax's own `phax.json` declares the example** as its `oracles` provider. Check that `phax validate` and `phax plans lint` accept the result. Check that every command the example runs is allowed where it must be. The oracles command is run by phax at the gate, never by an agent, so it needs no `security.agentCommands` entry; confirm this against the code.
- **Docs:**
  - the example's README;
  - README §Oracle provider and `docs/oracle-phases.md`, which point at the example;
  - `NEXT_STEPS.md`: oracle-phases complete.

Settle in Technical arbitrations, as the spec's §10 leaves them to planning:
- how a test is identified across two trees: its `describe` path and title;
- how `test.each` tables and nested `describe` blocks are treated;
- whether a comment change counts as a change;
- what the example answers for an oracle file missing at a commit;
- the file names and the command.

Raise these as open questions, framing each option by what it abandons:
- **The judge can be edited by the judged.** The example lives in the repository, and the provider runs in the gated phase's worktree. A phase agent could therefore edit the example's code, or its lockfile entries, and change the verdict on its own oracle. Today the file reconciliation only reports such an edit. Options include:
  - accept it, and document it as an example's limit;
  - have the command run the main checkout's copy, not the worktree's;
  - make an edit under the example's folder a lint or gate error for any phase that does not plan it;
  - something better you find in the code.
- **Any new dependency or tooling choice that widens what runs at the gate.**

Constraints:
- **Spec boundaries:** no test-framework knowledge goes into `src/` (§5.41), and nothing under `src/` changes unless the plan shows the spec requires it.
- **Fixtures** are made up (`tests/refunds.test.ts`, `tests/prune.test.ts`, `acme-billing`). The example's tests build their own temporary git repositories, and never read `~/.phax`.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`. Check how knip, the architecture audit and the typecheck treat a new folder under `examples/`, and keep them green.
- **Models:** follow the phax-planning skill's model policy, with `assignmentReason`.
- **Lint:** the plan must pass `phax plans lint`.

Phase shape: one phase if the gates allow it; otherwise two, the example first and then the declaration and docs, with every commit green.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
