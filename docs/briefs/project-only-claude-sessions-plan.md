Write the phax plan "Project-only Claude sessions" for the approved spec `docs/specs/2611041159-project-only-claude-sessions.md`. It is the spec's only plan, so it carries `completes-spec: true`.

Read the spec in full, sidecar included. These are settled; do not reopen them:
- the four operator decisions of 2026-11-04 in §9b: q-sources `project`, q-auth `refuse-named`, q-opt-out `no-opt-out`, q-record `record-manifest`;
- everything §10 lists as settled, and its constraints.

Release context. 0.33.0 is released (tag v0.33.0) and installed; 0.34.0 is the open release (package.json 0.34.0). `src/schemas/release.ts` stamps `phase-record-manifest` at 0.33.0, with frozen history under `src/schemas/history/phase-record-manifest/` and snapshots under `packages/schemas/snapshots/phase-record-manifest/`. The new required field lands in a new manifest shape stamped 0.34.0; 0.33.0 is frozen the way earlier manifest versions were (follow the last cut's path: history file, snapshot, `packages/schemas/history.lock.json`, `scripts/schemas-check.ts`, the frozen-history test). Runs on this repository use the installed phax, so nothing this plan changes is read by the run that implements it — except that the run's own records are written by 0.33.0 at the old shape, which must keep reading.

What already exists (read it before planning):
- `src/infra/providers/claudeCode.ts`: `spawnClaude` (spawns `claude` with no `env` override), `buildArgs` (headless agent sessions: read-only / secure / unsafe, resume), `buildCompletionArgs` (sealed completions), `buildProbeArgs` (the usage probe, which must keep the user's settings).
- `src/domain/session/claudePermissionFlags.ts`: the permission flag set, shared by headless sessions and the interactive stop commands (§10 constraint: the project-only switches reach every headless launch and none of the interactive ones).
- `src/infra/providers/claudeSkillEditSettings.ts`: the inline `--settings` object (skill-edit grants, protected-path deny rules).
- `src/infra/session.ts`: interactive launches; decide's interactive session and its headless handback.
- The failure classification of a Claude session (failure kinds, the readers that tell network, rate-limit and usage-limit failures apart): the new authentication failure is its own kind.
- `src/schemas/runRecord.ts` and the record writers (`src/app/recordPlumbing.ts`): where `record.json` is built.
- `docs/security.md`: what phax loads and confines per provider.
- The e2e tier (`pnpm test:e2e:real`, `vitest.e2e.config.ts`, `tests/e2e/`): real-session criteria (`init` event, skill grant, protected path) run there against an installed Claude Code; argv and environment criteria run against a recording stub in the unit or integration tier.

Probe facts to build on (Claude Code 2.1.318, OAuth): `--setting-sources project,local` dropped user skills, plugins, hooks and `~/.claude/rules` (75 → 35 skills); adding `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` dropped auto-memory; first-turn context 35.5k → 21.4k; OAuth kept working. `--setting-sources project` gave the same result in the phax repository. Whether `~/.claude/CLAUDE.md` stays out was not probed (the operator has none): the real-session criterion must cover it and report.

Settle in Technical arbitrations, with the dominant loss of each:
- where the project-only switches are added so every headless launch gets them and no interactive one does (a launch-kind parameter, a separate builder, or the spawn's environment), and how a test proves the split for every launch kind the spec lists;
- how the environment is extended (inherited plus one variable), never replaced;
- the authentication failure: how phax recognises it from the session's output, its kind, its message (the spec's §6 wording is indicative), and that it is never retried as a network or limit failure;
- the record field's exact name and values, and how Codex and Vibe records say `loaded`;
- which e2e cases need a real Claude Code, and how they stay deliberate (not run by the gate).

Shape. Every in-scope §8 criterion has its own named test. Schema cut first (freeze 0.33.0, add the field at 0.34.0), then the launch switches and the record field, then the authentication failure, then the e2e cases, docs last (`docs/security.md`, the §11 page).
