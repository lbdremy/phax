# Manual runbook — Run-jail provider sandbox validation

> Companion to `docs/plans/04-run-jail-plan.md`. This runbook is **executed by a
> human against the real installed CLIs** (`claude`, `codex`, `vibe`), not via
> the phax CLI and not as a phax phase. Phases 05–07 of the main plan deliver the
> pure, unit-tested arg-builders; this runbook confirms that the flags those
> builders emit are (a) accepted by the installed CLI and (b) actually enforce
> the boundary. Record findings inline and feed any flag corrections back into
> the corresponding adapter.

## Why this is separate

The secure-mode flag surface for each provider can only be confirmed against the
version of the CLI a user actually has installed. Unit tests pin the **shape** of
the arg vector; only a live run proves the sandbox denies what it should. This
mirrors how `03b-provider-e2e-validation.md` validated the phase-03/04 adapter
rewrites.

## Preconditions

- Phases 01–07 of `04-run-jail-plan.md` merged (domain, capabilities, routing
  fallback, port plumbing, and all three adapter secure branches).
- `claude`, `codex`, `vibe` installed and authenticated on PATH.
- A throwaway worktree dir and a throwaway `~/.phax`-style state dir.
- Sensitive decoy paths to probe denial against: `~/.ssh/id_test`,
  `~/.aws/credentials`, a file in `$HOME` outside the worktree.

## What "enforced" means (acceptance per provider)

For each provider, in **secure** mode, confirm:

1. **Accepts the vector** — the process starts (no clap/usage error) with the
   secure flags the adapter emits for a trivial prompt (e.g. "print ok").
2. **Filesystem jail** — the agent can read/write inside the worktree and the
   allowed `~/.phax` path, and is **denied** reads/writes to the decoy sensitive
   paths above.
3. **Network allowlist** (Claude/Codex) — a request to the provider API domain
   succeeds; a request to a non-allowlisted domain (e.g. `example.com`) is
   blocked.
4. **MCP** — with MCP `disabled`, no MCP server/tool is available to the agent.
5. **Fail-closed** — when the sandbox cannot be requested (simulate by passing a
   deliberately unsupported sandbox option), the adapter raises
   `SecurityEnforcementError` and the run does **not** proceed unrestricted.
6. **Unsafe parity** — `--security unsafe` reproduces today's behavior (the
   pre-jail vector) and prints the warning.

## Per-provider checks

### Claude Code (phase-05) — validated 2026-06-05 against `claude` 2.1.162

- [x] Secure vector accepted — `result: ok`, `is_error: false`, exit 0. All
      adapter flags (`--add-dir`, `--disallowed-tools`, `--strict-mcp-config`,
      `--effort`) are real `claude` flags.
- [x] Worktree + `~/.phax` read/write allowed; `~/.ssh`, `~/.aws`,
      `$HOME`-outside denied. **Required an adapter fix** (see notes): under the
      original `--permission-mode default`, in-worktree _writes_ also auto-denied
      in headless `--print` mode. After switching to `acceptEdits`: worktree
      write SUCCESS, `~/.phax` (`--add-dir`) write SUCCESS, all three decoy
      reads + a decoy write all DENIED (confirmed via `permission_denials` and
      filesystem inspection — no `~/.ssh/evil.txt` created).
- [~] Network **not** domain-allowlisted — Claude CLI has no `--allowed-domains`
  flag. Observed: WebFetch is DENIED for _all_ domains (incl.
  `api.anthropic.com`) because `acceptEdits` does not auto-approve WebFetch.
  Egress is blocked incidentally by (a) `--disallowed-tools Bash` and (b)
  WebFetch/WebSearch requiring permission — **not** by a domain policy. The
  model's own API traffic flows out-of-band (parent process).
  `security.json` `allowDomains` is descriptive, not enforced.
- [x] MCP disabled → no MCP tools. With `--strict-mcp-config` and no
      `--mcp-config`, `init.mcp_servers == []`. (Without the flag, a user-level
      "claude.ai Google Drive" MCP server leaked in — confirms the flag is
      load-bearing.)
- [x] Unsandboxed bash disallowed — `Bash` absent from `init.tools`.
- [x] Fail-closed path raises `SecurityEnforcementError` — verified directly
      against `buildArgs` (secure + empty `allowWrite`).
- [x] Unsafe parity — `--security unsafe` emits `--permission-mode
bypassPermissions` (byte-identical to pre-jail vector) and `run.ts` prints
      the boxed unsafe warning.
- Notes / corrections fed back to `src/infra/providers/claudeCode.ts`:
  - **FIX APPLIED:** `buildSecureClaudeFlags` now emits `--permission-mode
acceptEdits` instead of `default`. `default` is unusable headless — the
    agent could not write to its own worktree. `acceptEdits` auto-approves edits
    within working dirs (cwd + `--add-dir`) while still denying outside. Unit
    test updated (`claudeCode.test.ts`).
  - Open item (unchanged): no native network domain allowlist; revisit if a
    settings-file mechanism or external sandbox lands.

### Codex CLI (phase-06) — validated 2026-06-05 against `codex` 0.136.0

- [x] Secure `codex exec` vector accepted — **only after an adapter fix** (see
      notes). The original vector with `-a never` was **rejected outright**:
      `error: unexpected argument '-a' found` — `codex exec` has no
      `-a`/`--ask-for-approval` flag, so secure runs never started. After
      replacing it with `-c approval_policy="never"`, the vector starts cleanly
      (`--sandbox workspace-write`, not `danger-full-access`).
- [x] Writable roots limited to worktree + `~/.phax`; decoy paths denied.
      Live probe: write inside workspace → exit 0 SUCCESS; write to a `$HOME`
      path outside roots → `operation not permitted`, no file created.
- [~] Network is **binary**, not domain-governed. `provider-only` →
  `network_access=false`: live `curl https://example.com` failed with
  `Could not resolve host` (DNS blocked) ✅. `dev-allowlist`/`open` →
  `network_access=true` (fully open — codex has no domain allowlist; the
  resolved domains are descriptive only in `security.json`). "`api.openai.com`
  allowed; others blocked" is **not** achievable at domain granularity.
- [ ] MCP **not enforced** by a flag — codex configures MCP via
      `[mcp_servers.*]` in `~/.codex/config.toml`; there is no exec-time
      single-flag disable. Policy is recorded in `security.json` only. Open item.
- [x] Approval mode does not silently escape the sandbox — with
      `approval_policy="never"`, the out-of-root write (B above) was blocked and
      **not** re-run unsandboxed (file never created), which is the exact
      non-escalation `-a never` was intended to provide.
- [x] Fail-closed path raises `SecurityEnforcementError` (secure + empty
      `allowWrite`) — covered by `codexCli.test.ts`; pure `buildCodexArgs` logic.
- Notes / corrections fed back to `src/infra/providers/codexCli.ts`:
  - **FIX APPLIED:** `buildCodexSecurityFlags` now emits `-c
approval_policy="never"` instead of `-a never`. `-a` does not exist on
    `codex exec` and made clap reject the entire secure vector. Comment + unit
    test updated.
  - Open item (unchanged): no exec-time MCP disable flag; no network domain
    allowlist (binary on/off only).

### Mistral Vibe (phase-07) — partial — validated 2026-06-05 against `vibe` 2.13.0

- [x] Secure vector accepted (`--workdir <worktree>`, `--add-dir <state>`,
      `--agent auto-approve`, no `--trust`). All flags are real `vibe` flags;
      `--add-dir` is documented as having "same semantics as `--trust`" (grants
      write trust to that dir). The agent ran and wrote `vibe-inside.txt` in the
      worktree successfully.
- [~] **Filesystem confinement is weak — the shell tool is unconfined.** The
  `--workdir`/`--add-dir` trust scope governs Vibe's _native_ file tools
  only. With `--agent auto-approve`, the agent's **shell/command tool runs
  with full host access**: live probe wrote `$HOME/phax-vibe-outside.txt`
  (outside the workdir), read the `$HOME` decoy, and the only boundary is
  whatever the agent chooses. **This is the documented leak**: a determined
  or auto-approving agent escapes the jail via `sh -c`. Matches phase-02's
  `partial` filesystem-jail marking.
- [ ] MCP — not separately exercised; Vibe exposes no stable per-invocation MCP
      disable flag (consistent with the adapter emitting none). Policy recorded
      in `security.json` only.
- [x] Partial-secured surfaced via routing fallback — strict secure profile
      skips Vibe (verified in Cross-cutting below); `VIBE_PARTIAL_SECURED_MESSAGE`
      is the canonical text.
- [x] Network **not** enforced and **not** falsely reported: live `curl
https://example.com` from inside the agent **succeeded** (exit 0). The
      capability map marks Vibe `networkAllowlist: "unsupported"`, so the
      posture honestly reports no network enforcement (not a false positive).
- Notes / observed limitations fed back to `src/infra/providers/mistralVibe.ts`:
  - **No adapter fix needed.** The flag vector is correct and accepted; the FS
    leak and open network are fundamental to Vibe (no OS sandbox; non-interactive
    operation requires an auto-approving agent, which also auto-approves shell).
    This is precisely why Vibe is `partial` and is skipped by strict callers.
  - Test-only note: a manual `vibe -p … > log` **hangs** if stdin is left open
    (it waits on the TTY). Not a product bug — `spawnVibe` already sets
    `stdio: ["ignore", …]`, so real phax runs give Vibe `/dev/null` on stdin.
    Reproduce probes with `vibe … < /dev/null`.

## Cross-cutting

- [x] `phax security status` runs — **after a CLI fix** (see below). It now
      prints the capability table: claude/codex `strong` FS + Secure Default ✓,
      `mistral-vibe` `partial` FS + Secure Default ✗. FS + Secure-Default rows
      match observed behavior.
  - **CLI BUG FOUND + FIXED:** `registerSecurityCommand` called both
    `program.command("security")` and `program.command("security status")`.
    Commander parses the latter as a command _named_ `security` (bare `status`
    arg), colliding with the parent → it threw at registration and **crashed
    every `phax` invocation**, not just `security`. No integration test
    exercises `main.ts` wiring, so it shipped. Fixed to a real parent + nested
    `status` subcommand (`src/cli/commands/security.ts`).
  - **DISCREPANCY (decision needed):** the table reports `Network Allowlist:
supported` for claude-code and codex-cli, but live validation shows **neither
    enforces a domain allowlist** — Claude has no network flag; Codex network is
    binary on/off. `PROVIDER_SECURITY_CAPABILITIES.network*` over-claims. This is
    left unflipped pending a design call because it changes `satisfiesStrict`
    for `dev-allowlist`/`open` profiles (see Outcome).
- [~] `final-report.md` Security section and `<phase>/security.json` — schema +
  writer + report rendering are unit-verified (`posture.test.ts`, 20 tests;
  `finalReport` rendering). Not re-confirmed against a fresh live run here
  (the `run-jail` phases predate the artifact and produced none). A single
  live `phax run --security secure` would close this end to end.
- [x] Provider fallback: priority `mistral-vibe, codex-cli, claude-code` + strict
      secure → Vibe skipped, skip recorded. Covered by
      `tests/unit/routing/securityFallback.test.ts` (exact priority order) and
      corroborated live by `security status` (Vibe Secure Default = ✗, so the
      `executePlan` filter built from `evaluateProviderSecurity().satisfiesStrict`
      denies it and routing falls to codex-cli).

## Outcome

Validated 2026-06-05 against `claude` 2.1.162, `codex` 0.136.0, `vibe` 2.13.0.
Unit suite green after fixes (643 tests), typecheck + lint clean.

### Validated secure flag sets (corrected)

- **Claude:** `--print --output-format stream-json --verbose --permission-mode
acceptEdits --add-dir <each writable outside cwd> --disallowed-tools Bash
--strict-mcp-config [--mcp-config <file>…] --model <m> --effort <e>`
- **Codex:** `exec -C <cwd> --json --skip-git-repo-check --sandbox
workspace-write -c approval_policy="never" -c
sandbox_workspace_write.writable_roots=[…] -c
sandbox_workspace_write.network_access=<bool> -m <m> -c
model_reasoning_effort="…"`
- **Vibe:** `-p <prompt> --agent <agent> --output streaming --workdir <cwd>
[--add-dir <path>…]` (partial: shell tool unconfined, network open).

### Corrections fed back (committed in this validation pass)

1. `claudeCode.ts` — secure `--permission-mode default` → **`acceptEdits`**
   (`default` blocked the agent's own in-worktree writes under headless `-p`).
2. `codexCli.ts` — secure **`-a never` → `-c approval_policy="never"`**
   (`codex exec` has no `-a` flag; the old vector was rejected by clap, so
   secure runs never started).
3. `security.ts` — fixed the `security`/`security status` command double
   registration that crashed the entire `phax` CLI at startup.

### Open decision (NOT yet changed)

- **Network-allowlist capability over-claims.** `PROVIDER_SECURITY_CAPABILITIES`
  marks claude-code and codex-cli `networkAllowlist: "supported"`, but neither
  enforces a _domain_ allowlist (Claude: no flag; Codex: binary on/off). Options:
  (a) set both to `"unsupported"` — honest, and makes a `dev-allowlist`/`open`
  secure profile correctly skip them via `satisfiesStrict`; under the default
  `provider-only` profile they still pass (network effectively off). (b) Keep as
  is and document that "supported" means "can enforce provider-only (no-network)
  posture," not arbitrary domain allowlists. Recommend (a). Deferred to the user.

### Not live-verified here

- Fresh `phax run --security secure` end-to-end (`security.json` artifact +
  final-report Security section). Schema/writer/render are unit-tested; one real
  run would close the loop. The `run-jail` phases predate the artifact.
