# PHAX Spec — Deno Runtime and Distribution

## Status

**Implemented** — all phases (01–06) are complete as of the `phax/deno-runtime-2` branch.

### Acceptance criteria status

| # | Criterion | Status |
|---|-----------|--------|
| 1–9 | Core CLI, Deno build/compile, FS/network/env/subprocess posture | ✅ Implemented |
| 10 | Validate configured commands before execution | ✅ Satisfied by Deno's permission denial — no bespoke validator needed |
| 11 | Record launched commands in logs/traces | ✅ Satisfied by existing run telemetry |
| 12 | Do not imply Deno permissions sandbox provider CLIs | ✅ Documented in README and this spec |
| 13–17 | GitHub Releases, npm wrapper, CI/release workflows, checksums, version match | ✅ Implemented |
| 18–19 | `phax run/resume --start-after` | ❌ Out of scope — not implemented |
| 20 | README documents `caffeinate -ims` | ✅ Documented |

This document specifies the updated Deno runtime direction for PHAX.

It replaces the earlier Deno runtime spec.

This is a functional specification.

---

# 1. Goal

PHAX should be implemented and distributed as a single CLI application.

Deno is considered as the runtime and build foundation because it provides:

- native TypeScript execution;
- explicit runtime permissions;
- filesystem permission control;
- network denial by default when configured;
- restricted subprocess execution by executable name;
- single-binary compilation through `deno compile`;
- practical cross-platform distribution;
- a straightforward path to GitHub Releases and npm wrapper distribution.

The goal is not to split PHAX into separate products or runtime zones.

The goal is to package the PHAX user interface, orchestration logic, artifact generation, and provider invocation in one CLI.

---

# 2. Product shape

PHAX is a CLI.

The CLI is the user interface.

Therefore, PHAX should be packaged as one coherent command-line application.

There should be no product-level split between:

```txt
PHAX core
PHAX CLI
PHAX UI
```

For users, there is only:

```txt
phax
```

The implementation may have internal modules, but the product is one CLI.

---

# 3. Deno permission posture

PHAX writes many local files by design.

Therefore, PHAX needs filesystem access.

PHAX does not need direct network access.

Network access is only needed by subprocesses launched by PHAX, such as:

```txt
claude
codex
vibe
git
package managers
test commands
setup commands
gate commands
```

The PHAX process itself should run with:

```txt
filesystem access:
  allowed

network access:
  denied

environment access:
  denied by default

subprocess access:
  restricted to known executables
```

---

# 4. Filesystem access

PHAX should be allowed to read and write files.

This is necessary because PHAX manages:

```txt
run state
registry state
locks
worktrees
phase artifacts
logs
traces
file reconciliations
review handoffs
extract reports
final reports
archive artifacts
```

The recommended product stance is:

```txt
PHAX needs broad enough filesystem access to operate correctly.
```

A narrower filesystem policy may be introduced later if it remains practical, but this spec does not require narrow per-directory filesystem permissions.

The current functional requirement is simply:

```txt
PHAX must be able to read and write the files it manages.
```

---

# 5. Network access

PHAX itself should not require network access.

The default Deno permission posture should deny network access for the PHAX process.

This means PHAX should not directly:

```txt
call provider APIs
fetch remote resources
download dependencies
query the internet
open network listeners
```

Provider communication should happen through provider CLIs launched as subprocesses.

Examples:

```txt
claude
codex
vibe
```

Those subprocesses are responsible for their own provider communication and their own security model.

PHAX should not pretend that Deno network denial applies to those subprocesses after they are launched.

---

# 6. Environment variables

PHAX should not rely on environment variables for its own configuration.

Configuration should be passed through files.

Primary configuration sources should include:

```txt
project PHAX config
global PHAX config
run metadata
provider routing config
plan artifacts
phase artifacts
```

Therefore, PHAX should not need broad environment access.

Default product rule:

```txt
PHAX should use config files, not environment variables, for its own behavior.
```

Exception:

```txt
Platform-level execution may still expose environment variables to provider CLIs, shells, or user commands, depending on how subprocesses are launched.
```

But PHAX itself should not read environment variables as its normal configuration path.

---

# 7. Subprocess execution

PHAX must launch subprocesses.

This is required for:

```txt
provider CLIs
git commands
setup commands
gate commands
resume commands
archive-related commands
package manager commands
test/lint/typecheck commands
```

Deno supports restricting subprocess permission to specific executable names.

PHAX should use that capability.

The allowed subprocess list should be explicit.

Examples of possible allowed executables:

```txt
git
claude
codex
vibe
node
npm
pnpm
bun
deno
mise
```

The exact list should be configurable.

PHAX should not run arbitrary commands unless the command’s executable is allowed.

---

# 8. Subprocess security limitation

Deno can restrict which executable PHAX is allowed to spawn.

Deno does not sandbox the spawned subprocess itself.

Once PHAX launches an external command, that subprocess runs with its own permissions and its own provider or OS-level restrictions.

Therefore:

```txt
Deno protects PHAX from launching arbitrary executables.
Deno does not automatically protect the host from what an allowed executable does.
```

Security for agent subprocesses must still come from:

```txt
provider-native jail
provider permission profile
tool restrictions
MCP restrictions
future external sandboxing
```

This spec only covers the Deno runtime direction for the PHAX CLI itself.

---

# 9. Command allowlist model

PHAX should maintain a command allowlist.

The allowlist should answer:

```txt
Which executable names may PHAX launch?
```

It should not be confused with full command authorization.

For example:

```txt
git
```

may be allowed as an executable, but PHAX should still control which Git operations it performs through its own command construction rules.

The command allowlist should be used as a runtime safety boundary.

PHAX should also validate command definitions before execution.

Product rules:

```txt
PHAX should only launch commands declared by PHAX itself or by trusted PHAX configuration.

PHAX should never concatenate untrusted user input into shell strings.

PHAX should prefer structured command invocation over shell string execution.

PHAX should record launched commands in logs/traces.

PHAX should fail if a configured command requires an executable that is not allowed.
```

---

# 10. Configuration model

PHAX configuration should be file-based.

The runtime should not require environment variables for ordinary operation.

Configuration may include:

```txt
provider routing
provider executable names
allowed subprocesses
gate commands
setup commands
cleanup commands
workspace settings
archive settings
security mode
```

PHAX should validate configuration before use.

If configuration references an executable that is not allowed, PHAX should fail before running the phase.

---

# 11. Deno compiled binary

PHAX should be distributable as a compiled binary.

Deno’s compilation model allows runtime permissions to be specified at compile time.

The PHAX compiled binary should therefore be produced with the intended permission posture:

```txt
allow filesystem access
deny PHAX network access
deny PHAX environment access by default
allow only known subprocess executable names
```

The exact build command is an implementation detail.

The product requirement is:

```txt
The distributed PHAX binary should preserve the intended Deno permission posture.
```

---

# 12. Distribution strategy

PHAX should be distributed through:

```txt
GitHub Releases
npm wrapper
```

## 12.1 GitHub Releases

GitHub Releases should contain compiled binaries.

Target platforms should include at least:

```txt
macOS Apple Silicon
macOS Intel
Linux x64
Linux ARM64
```

Windows can be supported later if desired.

Each release should include:

```txt
compiled binaries
checksums
release notes
version number
```

## 12.2 npm wrapper

PHAX should also provide an npm package.

The npm package should act as a wrapper that installs or invokes the correct PHAX binary for the user’s platform.

The npm wrapper exists for developer ergonomics.

It should make installation easy for JavaScript/TypeScript users.

Example user experience:

```bash
npm install -g phax
```

or:

```bash
npx phax
```

The npm package should not be the source of truth for the runtime implementation.

The source of truth is the compiled PHAX binary.

---

# 13. Release automation

PHAX should have a GitHub Actions release pipeline.

The release pipeline should run automatically on Git tags.

The intended flow is:

```txt
developer creates Git tag
developer pushes Git tag
GitHub Actions builds release artifacts
GitHub Actions creates or updates GitHub Release
GitHub Actions uploads compiled binaries and checksums
GitHub Actions publishes or prepares npm wrapper package
```

Example tag patterns:

```txt
v0.1.0
v0.2.0
v1.0.0
```

Functional requirements:

```txt
Release builds should be triggered by Git tags.

Release artifacts should be reproducible.

Release artifacts should include checksums.

The npm wrapper version should match the Git tag version.

The release workflow should fail if build, tests, or packaging fail.
```

---

# 14. GitHub Actions expectations

The CI/CD setup should include at least two workflows.

## 14.1 Continuous integration workflow

Triggered on normal development events.

Purpose:

```txt
typecheck
test
lint
validate package
```

## 14.2 Release workflow

Triggered on Git tags.

Purpose:

```txt
build binaries
generate checksums
create GitHub Release
upload artifacts
publish npm wrapper or prepare npm package
```

The release workflow should only publish from trusted tag events.

---

# 15. Delayed execution option

PHAX should support delayed execution through `startAfter`.

The option should exist on:

```txt
phax run
phax resume
```

It should not be attached to review-specific commands.

The user-facing flag should be:

```txt
--start-after <duration>
```

Accepted duration examples:

```txt
5h
5H
300m
300M
18000s
18000S
```

The value should be case-insensitive.

Examples:

```bash
phax run my-run --start-after 5h
phax resume my-run --start-after 300m
```

Behavior:

```txt
PHAX prints an immediate scheduling confirmation.
PHAX remains in the foreground.
The user can cancel with Ctrl-C.
After the delay, PHAX starts the normal run/resume flow.
```

This is not a background scheduler.

PHAX should not claim that it will continue after the terminal is closed.

---

# 16. macOS sleep prevention documentation

The README should document that delayed or long-running PHAX commands may require macOS sleep prevention.

Recommended usage:

```bash
caffeinate -ims phax run my-run --start-after 5h
```

or:

```bash
caffeinate -ims phax resume my-run --start-after 5h
```

Purpose:

```txt
prevent the Mac from sleeping while PHAX waits and then executes
```

This should be documented as an operational recommendation for macOS users.

---

# 17. Out of scope

The following topics are out of scope for this Deno runtime spec:

```txt
OXC integration
AST parsing strategy
smolvm integration
external sandbox design
microVM security model
provider-native jail details
MCP bridging
network allowlisting for subprocesses
environment reconstruction inside VMs
```

These topics may belong to other PHAX specs.

They should not be included in this Deno runtime/distribution spec.

---

# 18. Acceptance criteria

This direction is complete when:

1. PHAX is treated as one packaged CLI, not split into separate product surfaces.
2. PHAX can be built with Deno.
3. PHAX can be compiled into release binaries.
4. PHAX has filesystem access sufficient to manage its run artifacts.
5. PHAX does not require direct network access.
6. PHAX does not rely on environment variables for its own configuration.
7. PHAX uses file-based configuration.
8. PHAX can launch required subprocesses.
9. PHAX restricts subprocess execution to an explicit executable allowlist where Deno supports it.
10. PHAX validates configured commands before execution.
11. PHAX records launched commands in logs/traces.
12. PHAX does not imply that Deno permissions sandbox provider CLIs.
13. GitHub Releases contain compiled binaries.
14. The npm wrapper installs or invokes the correct platform binary.
15. A GitHub Actions release workflow runs on Git tags.
16. Release artifacts include checksums.
17. The npm wrapper version matches the Git tag.
18. `phax run --start-after` is supported.
19. `phax resume --start-after` is supported.
20. README documents `caffeinate -ims` for macOS delayed/long-running executions.

---

# 19. Product summary

PHAX should use Deno as a practical, modern TypeScript runtime and packaging foundation.

The desired runtime posture is:

```txt
filesystem access:
  yes

network access for PHAX:
  no

environment access for PHAX:
  no by default

subprocess execution:
  yes, but executable allowlisted
```

The distribution posture is:

```txt
GitHub Releases for binaries
npm wrapper for developer ergonomics
release automation on Git tags
```

The core rule is:

```txt
PHAX is one CLI.
PHAX should have the local permissions it actually needs.
PHAX should not have direct network access.
PHAX should launch only known subprocess executables.
```
