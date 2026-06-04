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

### Claude Code (phase-05)

- [ ] Secure vector accepted (sandbox enabled, no `bypassPermissions`).
- [ ] Worktree + `~/.phax` read/write allowed; `~/.ssh`, `~/.aws`, `$HOME`-outside
      denied.
- [ ] Network limited to `api.anthropic.com`; other domains blocked.
- [ ] MCP disabled → no MCP tools.
- [ ] Unsandboxed bash disallowed.
- [ ] Fail-closed path raises `SecurityEnforcementError`.
- Notes / corrections fed back to `src/infra/providers/claudeCode.ts`:

### Codex CLI (phase-06)

- [ ] Secure `codex exec` vector accepted (sandbox not `danger-full-access`).
- [ ] Writable roots limited to worktree + `~/.phax`; decoy paths denied.
- [ ] Network governed per policy (`api.openai.com` allowed; others blocked).
- [ ] MCP disabled/allowlisted as configured.
- [ ] Approval mode does not silently escape the sandbox.
- [ ] Fail-closed path raises `SecurityEnforcementError`.
- Notes / corrections fed back to `src/infra/providers/codexCli.ts`:

### Mistral Vibe (phase-07) — partial

- [ ] Secure vector accepted (`--workdir` worktree, scoped `--add-dir`,
      restricted tools/agent, no blanket `--trust` where scopable).
- [ ] Filesystem confinement as strong as Vibe allows; document what leaks.
- [ ] MCP allowlisting works.
- [ ] Partial-secured message surfaces (status + report); strict callers skip
      Vibe via the routing fallback.
- [ ] Confirm network is **not** falsely reported as enforced.
- Notes / observed limitations fed back to `src/infra/providers/mistralVibe.ts`:

## Cross-cutting

- [ ] `phax security status` matches observed capabilities.
- [ ] `final-report.md` Security section and `<phase>/security.json` reflect the
      applied posture, downgrades, and any provider skipped for security.
- [ ] Provider fallback: with priority `mistral-vibe, codex-cli, claude-code` and
      a strict secure profile, Vibe is skipped and the skip is recorded.

## Outcome

Record the validated flag sets and any adapter corrections here; once all boxes
are checked the run-jail feature is live-verified end to end.
