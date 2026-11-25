Write the phax spec `secure-mode-sandbox`, after its spike: in `secure` mode, phax runs every gate step, and every
shell command an agent starts, under an OS sandbox (Anthropic's sandbox-runtime, `srt`), so that they can write only
the phase worktree, a temporary directory, the package caches and phax's state, never the repository's `.git` or the
rest of the disk, and read none of the agents' credentials.

## Why

The operator, 2026-11-24 (deciding `security-high-fixes`' q-git-pointer) and 2026-11-25. Gate steps run agent-written
code (the tests) with the user's rights, and on Claude Code and Vibe an allowed command, once started, runs unconfined
(`docs/security.md`, "Shell command execution"; Codex already runs its commands in its own OS sandbox). Either can
write the repository's common `.git/config` (a clean filter, `diff.external`, `core.sshCommand`, `core.fsmonitor`)
that phax's own git calls then read, or any file outside the worktree. `docs/security.md` names this residual
("Residual: config planted by gate code") and says an OS sandbox keeping `.git` read-only closes it; `chmod` and
`chflags` stop nothing a process of the same user can undo.

The choice of `srt` over a VM (operator, 2026-11-25), after a survey of the candidates:

- **A VM (smol machines, Apple `container`, Docker Sandboxes, microsandbox) is postponed with the `isolated` mode.**
  The deciding loss: the coding agents' paid plans. An agent CLI in a VM signs in with API keys, not the operator's
  Claude Max (OAuth in the macOS Keychain, which phax must never read) or other subscriptions. A VM boundary for
  gates alone does not fit either: the worktree's `node_modules` is macOS-native (oxlint, tsgo, esbuild, deno) and
  cannot run in a Linux guest.
- **`srt` is the same bet as Claude Code's own sandbox, on purpose.** It is what Claude Code's native Bash sandbox
  runs: `sandbox-exec` (Seatbelt) on macOS, bubblewrap on Linux, a domain allowlist through a proxy. It does not make
  a stronger boundary than the provider's; it extends one to what has none today (gate steps, Claude Code's and
  Vibe's allowed commands), with native binaries unchanged and a few milliseconds per command. The accepted loss: same
  kernel as the host, Seatbelt is unsupported by Apple (Codex, Cursor, gemini-cli and Claude Code rely on it anyway),
  and `srt` is a "Beta Research Preview" whose configuration may change.
- **Our own SBPL profile and bubblewrap command line** (what Codex does) stays the fallback if `srt` fails the spike:
  full control, but a profile to maintain with each macOS release.

## What phax has today, to read first

- `docs/security.md`: "Shell command execution" (the per-provider shell model), "Protected paths" and what the check
  does not resist, "Residual: config planted by gate code", "What phax does not take from the worktree".
- Where gate steps run: `src/app/gates.ts` (step execution), `src/app/fixLoop.ts`, the shell port and its adapter
  (`src/ports/`, `src/infra/`), phase setup commands.
- How each provider's session is confined: the security policy (`src/domain/security/`), the Claude Code adapter's
  `--allowedTools` and settings, Vibe's `VIBE_TOOLS`, Codex's `workspace-write` and network profile.
- The worktree git hardening of `security-high-fixes` (#265): `-c` settings and the gitdir pointer check in
  `src/infra/git.ts`, and the two residuals it names (an unrooted git layer under `phax enter-phase` on another
  project's run, and `config.repoRoot` taken from the current directory), which `NEXT_STEPS.md` keeps with this item.
- `srt`: https://github.com/anthropic-experimental/sandbox-runtime (CLI `srt --settings <file> <cmd>`, library
  `SandboxManager`); its settings (`allowWrite`, `denyWrite` taking precedence, `denyRead`, the network allowlist), its
  built-in protected paths (`.git/hooks`, `.git/config`), its Linux requirements (bubblewrap, socat, ripgrep; on
  Ubuntu 24.04 the `kernel.apparmor_restrict_unprivileged_userns` restriction).

## The spike first

A spike, run on the operator's machine and on a CI runner: the agent writes the harness and the findings skeleton,
the operator runs it (as `docs/plans/archive/` spike plans did). It answers:

1. **What a gate needs to write.** This repository's whole `standard` profile (`pnpm test`, lint, knip, the Deno smoke
   steps) under `srt` with writes allowed to the worktree, a temporary directory, the pnpm store, the Deno cache and
   phax's state only: what fails, and why. The time against the same gate unsandboxed.
2. **What it must not reach.** A write to the main checkout's `.git/config`, `.git/worktrees/<name>`, `$HOME` and
   another worktree is refused; a read of `~/.claude`, `~/.codex`, `~/.vibe`, `~/.ssh` and the Keychain (through the
   `security` tool and the Security framework) is refused once denied.
3. **Node under Seatbelt.** Node and the native binaries start and run under the profile `srt` generates, on the
   operator's macOS version (a forum report has Node aborting under a `(deny default)` profile on macOS 26.6).
4. **The agents' allowed commands.** Whether Claude Code's native sandbox (`sandbox` settings) confines its Bash
   commands in a headless `claude -p` session as phax starts it, so phax only turns it on and configures it; whether
   Vibe's commands can be confined by running the `vibe` process under `srt` (its own writes and its API endpoint
   allowed); Codex unchanged. What Claude Code's docs say (code.claude.com/docs/en/sandboxing.md, 2026-11-25): the
   sandbox is off by default (`sandbox.enabled`); it confines Bash commands and the processes they start, not the
   file tools, hooks or MCP servers; `allowUnsandboxedCommands` defaults to `true`, letting the agent retry a
   blocked command unsandboxed (strict needs `false`); when the sandbox cannot start it runs commands unsandboxed
   unless `failIfUnavailable` is set; its behaviour under `claude -p` is not documented, so the spike observes it.
5. **Linux CI.** The same gate under `srt` on a GitHub Actions ubuntu runner, with what the AppArmor restriction needs.
6. **Network.** Which hosts a gate step needs (none for this repository's gate once `node_modules` is installed;
   the npm registry for setup), and whether a gate under a deny-all network passes.

## The direction (the operator's, 2026-11-25)

1. **`secure` mode gains the OS sandbox; no new mode.** What runs under it is the user's code and the agents'
   commands; the agent CLI itself keeps its own process and its sign-in.
2. **Writes are an allowlist.** The worktree, a temporary directory, the package caches, phax's state; never the
   main checkout's `.git`, which sits outside the worktree and so is refused by the allowlist itself.
3. **The agents' credentials are unreadable** from a gate step or an allowed command.
4. **Gate steps run under the sandbox whatever the provider.** phax runs them itself, after the agent's session, so
   no provider's sandbox covers them: with Codex too, `pnpm test` runs today with the user's rights (operator,
   2026-11-25). Only the agent's own commands differ: Codex keeps its own sandbox for them (Seatbelt, or
   bubblewrap and seccomp, `.git` read-only), and phax does not stack another on it.
5. **A host that cannot sandbox is refused, not silently run unconfined.** Whether the refusal can be waived, and how
   it is recorded, is a question for the spec.

## Questions for the spec's §9 (after the spike)

- How phax ships `srt`: a dependency of phax, a binary it expects on the PATH, or a bundled copy; and where it lives so
  that a sandboxed command cannot rewrite it (not in a worktree's `node_modules`).
- Where the sandbox policy comes from: phax's defaults plus `phax.json` (extra writable paths, network hosts), and
  whether a project may loosen phax's defaults.
- The network default for gate steps: deny all, or the hosts `phax.json` lists.
- Phase setup commands (`pnpm install`): under the sandbox with the registry allowed, or outside it.
- What `security.json` and the records say about the sandbox a step or a command ran under.
- The refusal on a host without a sandbox (bubblewrap missing, user namespaces restricted), and whether `unsafe` stays
  the only way past it.
- What the two git residuals of #265 become once gate code cannot write `.git`.

## Out of scope

- The `isolated` mode and any VM (smol machines and the others): postponed, see `NEXT_STEPS.md`.
- Sandboxing the agent CLI processes themselves (their sign-in, their own files), beyond what question 4 finds for
  Vibe.
- Resource limits (CPU, memory).
