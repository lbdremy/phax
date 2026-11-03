Write the first phax plan of the spec `command-contracts` (`docs/specs/2611031738-command-contracts.md`, approved 2026-11-03). Later plans move the remaining command families, so this run does not complete the spec (`completes-spec: false`). Title it "Command runner and mod answers".

**Scope.** The port, and the four commands the brief `claude-code-mod` reads, on it:
- the command library ported to Effect 3 into phax's own source: the contract and its Commander runner, keeping the library's export names and its split into a contract and a runner (§10), with its conformance suite ported as phax tests;
- the gains §10 settles, each written as the library would carry it: groups holding groups, completers on an argument written as `complete` nodes, verdict codes (from the Rust twin), a text stdin document, progress notes written while `run` runs, a declared error's text form for a person, the program naming its usage flag (`--usage`, `--usage-format`), program-wide options (`--verbose`, `--trace`). Port every gain here, even one no command of this plan uses yet, so later plans only move commands;
- the program's `refused` (64) and `defect` (70) codes (§9b q-program-codes), documented in `phax --usage` and the exit-codes reference;
- `phax artifact status`, `phax plans overview`, `phax plans lint` and `phax ls` on the runner, each with its output contract and its `render` (today's text), and the formats `artifact-status`, `plan-overview` and `plan-lint` born at 0.34.0, and `run-list` gaining `pullRequest` (its 0.30.0 shape frozen first, a `next` snapshot at 0.34.0);
- `vendor/command-library/` deleted in the phase that finishes the port.

It covers the criteria those requirements own: at least "A misdeclared program runs nothing", "A command's --json-schema", "The contracts catalogue", "plans lint answers and exits 1", "artifact status --json", "plans overview --json versioned", "The run list's pull request", "Versioned documents unchanged" for the four commands, and every criterion the conformance suite proves on the port alone (refused, defect, a document from a file or stdin, a terminal refused at once, a bad document refused before run, written files). List in the plan's overview which criteria it covers and which wait for later plans.

**Settle in Technical arbitrations, each with its dominant loss:**
- **How a migrated command and an unmigrated one live in one program** until the last plan: the runner owns the whole program from this plan on, with a temporary way to mount a command still written for Commander, or the existing Commander program mounts the runner's commands, or another way. The bridge is internal (not a persisted shape) and the last plan removes it; say what `--json`, `--json-schema`, the catalogue, `refused` and `defect` do on an unmigrated command meanwhile, and that the spec's "every command" criteria hold only once the last plan ships.
- **A group with migrated and unmigrated commands**: `artifact` and `plans` keep commands this plan does not move (`artifact new`, `decide`, `approve`…, `plans estimate`, `overlap`…). Say whether this plan moves whole groups or single commands inside a bridged group.
- **`phax.usage.kdl` during the transition**: the parity gate keeps passing on every commit, and what a command declares there does not change (§5.21, §5.22). Say how the file is written while part of the program is still Commander (the library's usage spec for the migrated part, today's walk for the rest, or another way), and that the last plan makes it the generator's output alone.
- **Where the port lives** (`src/cli/…` or its own folder), how it respects `pnpm audit:architecture` (a runner that touches the process is an edge), and where its tests and the conformance cases go.
- **What Effect 3 changes from the Effect 4 source**, named per module, so a later swap to the published package reads as an import change.
- **The order of the remaining families** and how many later plans, written in the overview as the expected split. The operator writes each later plan's brief from it.

**What exists (read it first):**
- The spec: §5, §6, §8, §9b and §10 in full.
- `vendor/command-library/` and its README: the library's source at its 2026-11-03 revision, Effect 4. Port from it; do not import it.
- `src/cli/program.ts`, `src/cli/main.ts`, `src/cli/introspect.ts`, `src/cli/cliDocs.ts`, `src/cli/cliCompleters.ts`, `scripts/generate-usage-spec.ts`, `phax.usage.kdl` and its tests (`tests/integration/usageParity.test.ts`, `usageSpecDrift`, `usageSpecCompleters`, `usageSpecExamples`, `usageSpecLint`, `usageOutput`, `docsCliDrift`, `tests/unit/generateUsageSpec.test.ts`).
- `src/cli/commands/artifact.ts` (`artifact status`), `plans.ts` (`plans lint`), `plansOverview.ts`, `ls.ts` (`--complete` keeps printing `short-name:state` lines), and their tests.
- How a format is born and how one gets a frozen shape and a `next` snapshot: `src/schemas/release.ts`, `src/schemas/schemaUrl.ts` (`FORMAT_IDS`), `packages/schemas/` (snapshots, history, `history.lock.json`, `releases.json`), `scripts/schemas-check.ts`.
- The exit codes: each command's `run…` function returning its code, `src/cli/program.ts` (Commander's refusals and the `Unexpected error` path, both exit 1), and the exit-codes reference page (`site/pages.ts`, route `/reference/exit-codes`).

**Constraints:**
- **No back-compat shims, and no optional field in a persisted shape.** `pullRequest` is required (null when none). The unversioned objects of `plans overview` and `plans lint` are replaced, not kept beside the documents. A document versioned today stays byte for byte.
- **Text and codes unchanged.** Without `--json`, each moved command prints today's text and its error sentences, and keeps its documented codes; their existing tests keep passing as they are, except where `--json` now answers a versioned document.
- **This repository during the run.** The run is driven by the installed phax 0.33.0; nothing this plan changes is read by it. The phase guard keeps refusing inside a phase worktree with exit 1, before any command runs.
- **Isolation.** Tests never read `~/.phax`, a real `~/.claude`, `~/.codex` or `~/.vibe`, the global git config, or the real `gh`. Use `tests/helpers/isolateGit.ts`, temporary directories, the fake provider backends and `makeFakeGitHub()`. The runner is proved through its `Io` data, without a process.
- **Registries.** Respect `pnpm audit:architecture`, knip, and every exhaustive format registry the schemas package tests hold, including the closure allowlist in `tests/unit/architecturalGuards.test.ts` and the README's persisted-formats table; list them as planned edits. `pnpm docs:cli` rewrites the README's generated block; list it too.
- **Gates.** The `standard` profile verifies every phase, and `phax.json` allows every command a phase runs.
- **Models.** Follow the phax-planning skill's model policy. The port and the bridge are Opus work; say why any phase needs more.
- **`### Test strategy`.** Use the line format with the spec's criterion ids. Port the conformance suite as tests; its cases are stable contracts written before the runner.
- **Lint and skills.** The plan must pass `phax plans lint` with the installed phax. No skill changes, so the run needs no `--allow-skill-edits`.

**Docs:** `docs/upgrading.md` gets a 0.34.0 entry: `plans overview --json` and `plans lint --json` now answer versioned documents (`$schema` first), `ls --json` gains `pullRequest`, and an unknown command or option now exits 64 and a crash 70. The docs page `reference/json-output` (§11) waits for the last plan.

**Phase shape:** as few phases as the gates allow, with every commit green. The port and its conformance suite first, the bridge next, then the four commands with their formats.

**Output:** your final message is the plan document JSON and nothing else: no sentence before or after it, and no code fence.
