Write the phax plan "Small fixes, wave 2": seven small fixes from `NEXT_STEPS.md`, each a change in a file of its own,
in one run. There is no spec: each fix is described below with the place it lives and its expected behaviour. One
phase per fix, or two fixes in one phase where they share a file; no phase depends on another's code.

Declare `standard` under `## Gate profile`. The run edits two project skills, so the phase that edits them declares
each `SKILL.md` it touches and the Overview says the run is started with `--allow-skill-edits`.

## The fixes

1. **`phax resume` hints print `--yes`, and restore commands use literal pathspecs** (`src/app/resumeInstructions.ts`).
   - The awaiting-review, hold-point and stop-record sections of `resume-instructions.md`, and the reducer's trace
     details, print `phax resume <run>`, which only previews. Every hint that tells the operator to resume prints
     `phax resume <run> --yes`, as the network and handoff sections already do. Find the reducer's trace details
     from where they are written; do not change what a preview prints.
   - SEC-30 (`docs/security/reports/2026-11-23-opus-high-5.5-security-report.md`): the printed restore command is
     `git checkout <c> -- '<path>'`. A protected path named `:(exclude)…` turns the pasted command into a whole-tree
     checkout that discards the phase's work. Print `git --literal-pathspecs checkout <c> -- '<path>'`.
2. **`phax open` claims an `$EDITOR` fallback it does not have.** Its help in `src/cli/definitions/sessions.ts` says
   it falls back to `EDITOR`; `src/infra/editor.ts` reads no environment variable. Settle in Technical arbitrations
   whether the help is corrected or the adapter gains the fallback (an adapter change reads `EDITOR` through the
   environment the adapter already receives, never `process.env` outside `src/infra/`). Regenerate the CLI contract
   if the help changes.
3. **`phax-decide-review` names a command that does not exist.** `.claude/skills/phax-decide-review/SKILL.md`'s
   description says `phax review-plan` follows it; no such command is in `phax.usage.kdl`. Find what loads the skill
   today (`src/domain/skills/catalog.ts`, `PHAX_DECIDE_REVIEW_SKILL`, and its callers) and make the skill's
   description and body say that, not a command that does not exist. Do not add the command.
4. **Teach the reserved test-line words.** `.claude/skills/phax-spec/SKILL.md`'s acceptance-criteria rules gain one
   line: a criterion id cannot be the loop words `acceptance` or `in-phase`, nor the retired `oracle`; today only the
   schemas refuse them. Check the words against the schema that refuses them before writing the line.
5. **Codex never ends a session on network loss** (`src/infra/providers/codexCli.ts`). Codex 0.165, its API
   unreachable, emits `Reconnecting... N/5`, then `Reconnecting... waiting for network` every ~50 s without end and
   no `turn.failed` (seen 2026-10-28 in the real e2e of `provider-failures`): a Codex phase hangs with nothing on the
   terminal. A watchdog in the Codex adapter ends the process after N consecutive network `error` events and reports
   the `network` failure phax already maps to exit 14 for the other providers. Settle N and what counts as a network
   event in Technical arbitrations; the loss accepted is a session Codex would have recovered after a short outage.
   Test it with a fake Codex stream, never the real CLI.
6. **`phax agent setup providers --write` re-enables every installed provider** (`src/app/providerSetup.ts`). On
   2026-10-28 it turned Codex on for an operator who wanted only Claude Code and Vibe, and wrote every catalog model
   into `providers.json`. A provider the person disabled stays disabled, and settle in Technical arbitrations whether
   `--write` also stops writing models the person did not have. Tests write `providers.json` only under a temporary
   phax home, never `~/.phax`.
7. **Refusal labels of identifier-like leaves** (`src/schemas/`). Since the Effect 4 migration (#198), a refusal on a
   leaf such as `decisionId` prints the leaf's regular expression instead of a label. Restore an identifier
   annotation on those leaves so the refusal names what was expected. Find every such leaf; the behaviour corpus
   records refusals, so a refusal that changes text is a corpus case that changes: list each in the handoff, and
   change no other recorded expectation.

## Lessons from the runs on this repository

- **knip runs at every phase's gate**, default and `--production --strict`, against `knip-baseline.json`
  (protected). An export that only a later phase uses fails the gate: export it where it is first used.
- **`pnpm lint` is type-aware, against `lint-baseline.json` (protected).** Fix a lint error in the code; never add a
  disable directive. **Both baselines only shrink, and their prune is the operator's**: a phase that removes debt
  fails its gate until the operator prunes. Say in the handoff which debt a phase removes.
- **Protected, untouched**: `knip.json`, both baselines, `.oxlintrc.json`, `.oxfmtrc.json`, the tsconfigs,
  `vitest.config.ts`, the workflows, `tests/unit/architecturalGuards*.test.ts`.
- **Tests never read `~/.phax`, a real provider home, the global git config or the network.** A test that spawns a
  child goes through `tests/helpers/boundedSpawn.ts`.
- **Regenerated files**: a CLI help change regenerates `phax.usage.kdl` and `docs/cli/reference.md`
  (`pnpm gen:usage-spec`, `pnpm docs:cli`, which also rewrites the README's generated block). Plan them in the
  phase that changes the source.
- **A refusal text in the behaviour corpus** changes only with the change that causes it, and the handoff lists each
  case.

Every required command must equal an entry of `security.agentCommands` or a gate command exactly; an entry with a
space in it covers only itself. `pnpm exec tsx`, `pnpm test:unit`, `pnpm test:integration`, `pnpm gen:usage-spec`,
`pnpm docs:cli`, `git log`, `git grep`, `git mv`, `node` are `agentCommands`; `pnpm test` is a gate command.

Models: `claude-opus-5-5` at medium for the Codex watchdog, the provider setup and the refusal labels;
`claude-sonnet-5-5` for the hints, the help text and the two skill edits.
