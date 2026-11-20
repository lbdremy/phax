Write the phax plan "Partial commands on gate steps" for the approved spec `docs/specs/2611041417-gate-step-partial-commands.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the five operator decisions of 2026-11-04 in §9b: q-placeholder `named-placeholder`, q-compound `pipes-only`, q-vibe `check-and-record`, q-empty-diff `docs-only`, q-own-profile `follow-up`;
- everything §10 lists as settled, and its constraints.

**Prerequisite, merged before this plan runs:** `docs/plans/2611041421-phase-prompt-names-the-gate-plan.md` (Approved) adds the phase prompt's `## Gate` section, rendered by a pure `renderGateSection(steps)` in `src/domain/gate/gateSection.ts`, fed by one per-phase selection `selectGateSteps(gateSteps, isFinal)` computed in `executePlan` and passed to both `buildPhasePrompt` (option `gateSteps: readonly GateStep[]`) and the gate. Read that plan's Technical arbitrations: this plan extends that section and that selection, it does not build a second one. If the code on `main` differs from that plan when you read it, plan against the code and say so.

Release context. 0.33.0 is released (tag v0.33.0) and installed; 0.34.0 is the open release (package.json 0.34.0). Runs on this repository use the installed phax, so this repository's `phax.json` does not gain `partial` in this run (q-own-profile `follow-up`).

What already exists (read it before planning):
- `src/schemas/phaxConfig.ts`: `GateStepSchema` (`command`, `surface`, `firing`, `output` with a default, `input` exact-optional), `GateProfilesSchema`, the project, workspace and user-overlay schemas that carry gate profiles; `phax.schema.json` and `phax.user.schema.json` are generated from it (find the generator script; never hand-edit them).
- `src/domain/session/claudePermissionFlags.ts`: agent commands become `Bash(<prefix>:*)` rules; `computeFrozenAgentCommands` and the agent-command sources (gate, brief, …) with their precedence; how gate commands enter the frozen set at phase start and on resume.
- `security.json` (the per-phase security record) and its `source` values for agent commands; its schema stamp in `src/schemas/release.ts`.
- `src/infra/providers/mistralVibe.ts` (`VIBE_TOOLS` prefix allowlist) and Codex's sandbox, for how the same frozen set reaches each provider.
- The config refusal path and its exit code (`phax validate` and config load), for the refusal messages.
- `docs/security.md` ("Shell command execution"), README's gate profiles section ("Gate report steps", "Gate request").
- The e2e tier (`pnpm test:e2e:real`, `tests/e2e/`), including the existing real-CLI Vibe security tests, for the deliberate Claude Code and Vibe pipe checks.

Probe fact to build on (Claude Code 2.1.318, headless, `--permission-mode acceptEdits --allowedTools …`): `wc -l $(ls *.txt)` is denied even with `Bash(wc:*)`, `Bash(ls:*)` or the exact string allowed ("A nested command in this command can't be checked before it runs"); `ls *.txt | xargs wc -l` runs with `Bash(ls:*)` and `Bash(xargs wc:*)`.

Settle in Technical arbitrations, with the dominant loss of each:
- the parser of a partial command: placeholder recognition, segment split on `|`, the refused constructs, and where a segment's allowed prefix ends — a pure domain function with a table test of every refusal and every accepted form;
- where the segment prefixes join the frozen agent commands (the §10 "partial" source and its precedence), on both the phase-start and resume paths;
- whether `security.json`'s stamp changes for the new `source` literal, following the repository's schema versioning rules (no back-compat shim);
- the exact prompt lines under a step and their indentation, within the prerequisite's section;
- whether segment prefixes count toward a plan's `requiredCommands` coverage (§10 default: they do not).

Shape. Every in-scope §8 criterion has its own named test; every refusal has its own case. Schema and parser first, then the frozen-command wiring, then the prompt lines, then the e2e checks (Claude Code and Vibe, deliberate, not in `check:full`), with the Vibe result recorded in `docs/security.md`; docs last (README gate profiles section, `docs/security.md`, the §11 example with its two traps).
