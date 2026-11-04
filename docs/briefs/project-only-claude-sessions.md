Write the phax spec "Project-only Claude sessions". Every headless Claude Code session phax launches loads the harness the project committed, and nothing the person running phax installed for themselves: no user-level skills, plugins, hooks, rules or settings, no auto-memory.

**Why.** The harness phax gives an agent is meant to be reusable across people: two maintainers running the same plan on the same commit should hand the agent the same feed-forward. Today each headless session also loads whatever the operator installed globally, which costs tokens on every turn, is invisible in the records (a record's `sourceSha` recovers the repository, not `~/.claude`), and makes a run's behaviour depend on who launched it. Analysis and numbers: `docs/ideas/harness-from-records.md`, `spikes/harness-data/`.

**Measured on phax's records (2026-11-04, 465 sessions):**
- Phase sessions load a median 64 skills (max 77, up from 32 over three months); the repository supplies 16. The rest are user and plugin skills (video tooling, Cloudflare, office documents…) no phase uses.
- Every session (465/465) loaded the operator's auto-memory index (`~/.claude/projects/<repo>/memory/MEMORY.md`, ~7 KB of personal project notes).
- Context at a phase's first turn: median ~50k tokens (30k–87k), re-read from cache on every turn.

**Probes, Claude Code 2.1.318, OAuth (Max subscription), `claude -p … --output-format stream-json --verbose --max-turns 1` in this repository, `init` event read:**

| Launch | Skills | Non-builtin plugins | MCP servers | Auto-memory | User rules (`~/.claude/rules`) | First-turn context |
| --- | ---: | --- | ---: | --- | --- | ---: |
| today's flags | 75 | cloudflare | 7 | loaded | loaded | 35.5k |
| `--setting-sources project,local` | 35 | none | 2 | loaded | not loaded | 25.1k |
| `--setting-sources project` | 35 | none | 2 | loaded | not loaded | 25.1k |
| `--setting-sources project,local` + env `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | 35 | none | 2 | none | not loaded | 21.4k |

- User hooks stop firing too (a user `SessionEnd` hook ran only in the first row).
- OAuth authentication kept working in every row.
- What remains: the repository's 16 skills, 19 skills bundled with Claude Code (`debug`, `simplify`, `loop`, `claude-api`…), the builtin `cc-plugin-*` plugins, and the account's claude.ai connectors as MCP servers (`--strict-mcp-config` without `--mcp-config` drops those; phase sessions already show none).
- `--bare` goes further but makes Anthropic auth strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`: no OAuth, so unusable on a subscription.

**Settled (do not reopen):**
1. **Scope: headless sessions only** — phase sessions, fix attempts, handoff generation, authoring, decide, review, compliance review, structured completions. Interactive sessions a person drives (`enter`, interactive review, the TUI part of stops) keep the person's own setup: it is their session.
2. **The mechanism is the provider's own switches**, passed per invocation: Claude Code's `--setting-sources` and the `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` environment variable on the spawned process. phax never edits, moves or reads the user's `~/.claude`.
3. **phax's inline `--settings`** (the secure-mode skill-edit grant and protected-path deny rules) keeps applying; the spec's acceptance must prove it under the new setting sources.
4. **Claude Code only** in this spec. Codex and Mistral Vibe equivalents are named as follow-ups, not designed here.

**What exists (read it first):**
- `src/infra/providers/claudeCode.ts`: `spawnClaude` (spawns `claude` with no `env` override), `buildArgs` (headless agent sessions, read-only / secure / unsafe), `buildCompletionArgs` (sealed completions), `buildProbeArgs` (the usage probe; its doc comment says the user's settings must still load there because they can hold the authentication, `apiKeyHelper`, the verdict must see).
- `src/infra/providers/claudeSkillEditSettings.ts`: the inline `--settings` object.
- `src/infra/session.ts`: interactive session launch.
- `docs/security.md`: what phax loads and what it confines per provider.

**Out of scope:**
- the harness manifest per record (which feed-forward a session received): a separate spec, which this one makes smaller;
- the skills bundled with Claude Code (no switch found short of `--disable-slash-commands`, which drops the repository's skills too);
- Codex (`CODEX_HOME`, profiles) and Vibe isolation;
- changing what the repository itself ships (`CLAUDE.md`, `.claude/skills`, `.claude/rules`).

**Open questions for §9 (each with a recommendation):**
1. **`project` or `project,local`?** `.claude/settings.local.json` is personal (gitignored) and absent from phase worktrees anyway, but present where authoring runs. Recommendation: `project` only — only committed configuration is portable.
2. **Authentication carried by user settings.** A user whose Claude auth lives in user settings (`apiKeyHelper`, `env`) would lose it. Recommendation: keep loading user settings for the probe (as today) and decide whether headless sessions need a fallback (refuse with a named cause, or an opt-out) — the person must never get a silent auth failure.
3. **Opt-out.** Should `phax.json` (or `phax.user.json`) let an operator keep user-level config for headless sessions? Recommendation: no opt-out in the first slice unless question 2 needs one.
4. **Recording it.** Should the phase record state the setting sources used? Recommendation: yes, one field on an existing manifest, required, so a record says which harness layer was in play.
