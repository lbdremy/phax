# Security audit report — 2026-11-23

- **Commit audited:** `e5c39afa` (main, phax v0.43.0)
- **Auditor:** Mistral Vibe, model `mistral-large-4-0`, reasoning effort `high`
- **Scope:** everything shipped — `src/` (cli/app/domain/ports/infra/schemas, ~580 files),
  the npm launcher (`npm/`), `packages/schemas`, the GitHub workflows (`.github/workflows/`),
  and the audit tooling (`scripts/security/`).

## Method

Read the full source of every layer, focusing on the side-effect edges (`src/infra/`) and the
confinement logic (`src/domain/security/`, `src/domain/session/`, `src/infra/providers/`).
Ran the repo's own audit (`pnpm audit:security` → **0 high, 0 medium, 4 low**), `pnpm audit
--prod` → **clean**, plus manual sweeps for secrets in tracked files and git history,
`eval` / `new Function` / `node:vm`, `shell: true`, plain-HTTP URLs, and interpolated `exec`
strings.

Caveat: gitleaks/semgrep were not installed locally, so the repo audit used its fallback
scanners; the real-provider e2e suite was not run, so provider-behavior claims (Claude prefix
matching, `acceptEdits` scoping) rest on the repo's own runbook comments, not independent
verification.

## Findings

### High

**H1 — A cloned repo's `phax.json` controls security-critical settings, with no trust gate and no operator veto for the dangerous ones.**

The project config layer (`PhaxConfigSchema.security`, `src/schemas/phaxConfig.ts:303`) feeds
the resolved policy directly, and `mergeConfigLayers` (`src/domain/config/mergeLayers.ts:93-123`)
makes the situation asymmetric:

- `security.profile` can be set to `"unsafe"` by the **project** file → the agent runs with
  `--permission-mode bypassPermissions` / `--dangerously-bypass-approvals-and-sandbox`
  (`src/domain/session/claudePermissionFlags.ts`, `src/domain/session/codexFlags.ts`). A warning
  box prints, but the run proceeds. Only a CLI flag or a user overlay can pin it back.
- `filesystem.allowWrite` / `allowRead` from the project are **unioned** (additive-only — an
  operator overlay cannot remove them) and `~`-expanded (`src/app/loadConfig.ts:544-556`), so
  `"allowWrite": ["~"]` grants the agent the entire home directory as `--add-dir` /
  `writable_roots` in *secure* mode.
- `mcp.allow` entries are only checked for existence (`src/app/runPreflight.ts:103-128`), so a
  repo can point `--mcp-config` at a repo-local MCP config whose servers spawn arbitrary commands.
- `security.agentCommands` from the project becomes `Bash(<cmd>:*)` allowlist rules; per
  `docs/security.md` itself, on Claude/Vibe an allowlisted shell command runs **unsandboxed with
  the user's rights**.
- Independently, gate / setup / cleanup / acceptance / brief commands from the project
  `phax.json` are executed by the **phax parent process itself** as the user
  (`src/app/gates.ts:340`, `src/app/setup.ts:47`) — tokenized without a shell, but arbitrary argv.
  So `phax run` in an untrusted clone is arbitrary code execution even before the agent starts.

Net: "never run phax in a repo you don't trust" is currently a hard requirement, enforced only
by a warning. Recommendation: treat project-layer security keys as untrusted — require per-repo
operator confirmation, restrict project `allowWrite` to paths inside the repo, forbid the project
from lowering the profile, load MCP configs only from operator-owned paths, and consider running
gate commands under the same sandbox as the agent.

### Medium

**M1 — npm launcher runs the cached binary without re-verifying it** (`npm/bin/phax`).
The SHA-256 sidecar is checked only on first download; afterwards
`~/.phax/bin/<version>/<name>` is executed as-is. Any write to that path is persistent code
execution under the user. Also: the download temp file is the predictable `dest + ".tmp"`
(symlink race on shared hosts), redirects are followed without a host allowlist (mitigated
implicitly — `https.get` rejects `http://`), and the checksum compare is non-constant-time.
Fix: re-hash the cached binary each run (cheap), create the temp with `O_EXCL`.

**M2 — Agent processes inherit the full environment, secrets included, in secure mode.**
Claude spawns with `projectOnlyEnvironment(process.env)` (`src/infra/providers/claudeCode.ts`),
Codex with no `env` option at all (full inherit), Vibe strips only `VIBE_ACTIVE_MODEL`
(`src/infra/providers/mistralVibe.ts:164`). Combined with H1's note that an allowlisted shell
command runs with user rights, the agent can read `ANTHROPIC_API_KEY`, `GH_TOKEN`, etc. from
`process.env`. Recommend scrubbing credential-shaped env vars from the agent's environment in
secure mode, or documenting the exposure explicitly.

**M3 — Native protected-path enforcement relies on provider rule semantics; the git commit-check is the real backstop (documented, but worth hardening).**
Claude deny rules enumerate only `Edit(/…)` (`src/domain/security/protectedPaths.ts`), and the
Bash allowlist assumes compound commands (`git log && rm …`) do not match a `Bash(git log:*)`
prefix — the code comments assert this; it is provider behavior phax cannot control.
`protectedEnforcement` still reports `"enforced"` in `security.json` when all globs are native.
The git-level observation (`observeWorktree` in `src/infra/git.ts`, with
`GIT_NO_REPLACE_OBJECTS`, symlink/nested-repo detection) is solid and is the actual guarantee.
Codex and unsafe modes are commit-check-only, meaning a protected file can be modified mid-phase
and is only caught at commit. Suggest recording this assumption in `security.json` rather than
`"enforced"`.

### Low

- **L1 — Architecture boundary violations:** `node:child_process` is used directly in
  `src/cli/definitions/shared.ts` (`execSync`, static string), `src/cli/definitions/completions.ts`,
  `src/cli/commands/usage.ts` (`spawnSync("usage", …)`), and `src/app/loadConfig.ts`
  (`execFileSync`). Not injectable (argv arrays / static strings), but they breach the AGENTS.md
  "all I/O through a port" rule — the repo's own scanner flags exactly these 4 as low. Route them
  through the Shell/Git ports.
- **L2 — Lock weaknesses** (`src/infra/lock.ts`): `renew`/`release` don't verify ownership (any
  local process knowing the key can release it), stale-lock cleanup is a rm+recreate TOCTOU
  (EEXIST handled), and PID reuse can mark a dead run's lock "active" for up to 30 min. The lock
  key is charset-validated (`parseRunRef`, `^[a-z][a-z0-9-]*$`), so no path traversal — verified.
- **L3 — Git stdin protocols vs. hostile path bytes** (`src/infra/git.ts`): `update-index
  --index-info` and `update-ref --stdin` embed paths/refs unquoted; a `\n` in a record path could
  inject index entries or ref updates into the records branch. Currently unreachable (record
  paths derive from validated run keys and regex-filtered artifact names; `hash-object
  --stdin-paths` is properly quoted via `stdinPathLine`, and `blobSizes` refuses `\n`).
  Hardening: reject control chars in record paths at the schema.
- **L4 — `PHAX_VIBE_SPAWN_TIMEOUT_MS=garbage` → `Number()` is `NaN`, and `setTimeout(fn, NaN)`
  fires immediately** (`src/infra/providers/mistralVibe.ts:252`), instantly SIGTERM-ing every Vibe
  turn. Robustness bug, self-inflicted only.
- **L5 — Docs drift:** `docs/security.md` says secure mode defaults to "worktree and state root",
  but `src/domain/security/resolvePolicy.ts` deliberately excludes the state root; the
  `src/domain/session/codexFlags.ts` comment also mentions `~/.phax` in `writable_roots`. Doc-only.

### Informational / verified clean

- No `shell: true`, no `eval` / `new Function` / `node:vm`, no interpolated `exec()` strings;
  every subprocess uses argv arrays (`spawn` / `execFile`), git calls use `--` /
  `--end-of-options` where positionally safe, and branch names are validated against leading `-`
  (`BranchNameSchema` in `src/domain/branded.ts`).
- No path traversal: run keys/namespaces charset-validated; plan paths canonicalized (no `..`,
  backslash, absolute) via `PlanPath` (`src/schemas/planPath.ts`); worktree deletion refuses
  paths escaping the worktree (`deleteFromWorktree` in `src/infra/git.ts`); atomic writes via
  temp+rename with mode set before content (`src/infra/fs.ts`); locks via `wx`.
- No secrets in tracked files or git history (pattern scan; `.gitleaks.toml` present for CI);
  telemetry is local JSONL only (`src/schemas/telemetryConfig.ts` has just `enabled: boolean`) —
  no egress; records redact session ids (`[session id withheld]`, `src/app/recordPlumbing.ts`).
- Release workflow (`release.yml`) is tag-triggered only, all actions SHA-pinned,
  least-privilege permissions, no `pull_request_target` anywhere, npm publish with
  `--provenance`, Sigstore attestation of binaries; CI runs the security audit daily.
  `pnpm audit --prod`: no known vulnerabilities.
- Prompt-injection surfaces (plan text, agent-written handoffs/briefs injected into later prompts)
  are inherent to the design and mitigated by schema-decoding plus phax-set `$schema` stamps on
  structured outputs (`src/domain/session/structuredCalls.ts`) and by git-state reconciliation
  ("facts, not claims").

## Bottom line

The execution hygiene is genuinely good — no shell injection, disciplined git argv, validated
identifiers, and a real git-level protected-path check. The one finding that matters is **H1**:
phax's own threat model treats the driven repo as untrusted, yet the repo's `phax.json` can
downgrade the agent sandbox to `unsafe`, add arbitrary writable roots (including `~`, which
operators cannot veto), allowlist arbitrary agent shell commands, point MCP at repo-defined
servers, and have its gate commands executed unsandboxed by phax itself. Until project-layer
security keys require explicit operator trust, the effective guidance is "phax is only as safe as
the repo you point it at" — worth stating in `SECURITY.md`'s scope, or better, gating those keys.
M1 (launcher cache) and M2 (env secrets in secure mode) are the next two to fix.
