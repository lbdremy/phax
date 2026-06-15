# Install Planning Skill for Agent CLIs

## Status

Functional specification.

This document defines a minimal skill installation feature for PHAX.

The goal is to let users install the PHAX planning skill into the expected local skill directory for their agent CLI.

---

# 1. Goal

PHAX ships with a planning skill.

Users should be able to install that skill with a PHAX command.

The command should copy the bundled PHAX planning skill to the correct location for the selected agent target.

The initial supported targets are:

```txt
claude
codex
agent
```

The supported scopes are:

```txt
project
user
```

No other skills are exposed in this iteration.

No generic `all` target is required.

---

# 2. Non-goal

This feature does not install every internal PHAX skill.

For now, PHAX exposes only:

```txt
phax-planning
```

Other PHAX guidance used internally by the CLI should remain internal.

This feature also does not depend on TanStack Intent.

PHAX should copy its bundled planning skill directly.

---

# 3. User command

PHAX should expose a command to install the planning skill.

Recommended command:

```bash
phax skills install --target claude --scope project
```

Supported targets:

```txt
claude
codex
agent
```

Supported scopes:

```txt
project
user
```

Examples:

```bash
phax skills install --target claude --scope project
phax skills install --target claude --scope user
phax skills install --target codex --scope project
phax skills install --target codex --scope user
phax skills install --target agent --scope project
phax skills install --target agent --scope user
```

PHAX should not provide a `--target all` mode in this iteration.

---

# 4. Installed skill

The installed skill is:

```txt
phax-planning
```

It should contain the PHAX planning instructions needed by agents when producing a PHAX implementation plan.

The skill should help the agent:

```txt
understand PHAX planning expectations
produce phase-oriented plans
include model and effort recommendations
include commit metadata
identify required security configuration changes
avoid producing plans that cannot be executed by PHAX
```

---

# 5. Target behavior

## 5.1 Claude target

When the target is:

```txt
claude
```

PHAX should install the planning skill in the Claude Code skill location for the selected scope.

For project scope, this should be the project-local Claude skills location.

For user scope, this should be the user-level Claude skills location.

The exact path should follow Claude Code’s current skill discovery conventions.

## 5.2 Codex target

When the target is:

```txt
codex
```

PHAX should install the planning skill in the Codex skill location for the selected scope.

For project scope, this is expected to be the project-local `.agents/skills` location.

For user scope, this is expected to be the user-level `.agents/skills` location.

The purpose of keeping a separate `codex` target is to support Codex-specific behavior if it diverges from the generic Agent Skills path later.

## 5.3 Agent target

When the target is:

```txt
agent
```

PHAX should install the planning skill using the generic Agent Skills convention.

This should use the `.agents/skills` style location for the selected scope.

This target is intended for agents that follow the common Agent Skills convention without needing a provider-specific target.

---

# 6. Scope behavior

## 6.1 Project scope

Project scope installs the skill into the current project.

Use this when the user wants the PHAX planning skill available only for this repository.

Expected behavior:

```txt
install into the current project’s agent skill directory
create missing directories if needed
do not affect the user’s global agent configuration
```

## 6.2 User scope

User scope installs the skill into the user-level skill directory.

Use this when the user wants the PHAX planning skill available across projects.

Expected behavior:

```txt
install into the selected target’s user-level skill directory
create missing directories if needed
do not modify the current project
```

---

# 7. Idempotency

Skill installation should be idempotent.

Running the same command multiple times should not duplicate the skill.

If the skill already exists and matches the bundled PHAX version, PHAX should report that it is already installed.

If the skill exists but differs from the bundled PHAX version, PHAX should update it or report that it will be replaced.

The behavior should be explicit.

---

# 8. Existing files

PHAX should not overwrite unrelated user files.

The command should only manage the PHAX planning skill directory.

If a conflicting directory exists, PHAX should report the conflict clearly.

PHAX should avoid modifying general instruction files such as:

```txt
AGENTS.md
CLAUDE.md
.cursorrules
.github/copilot-instructions.md
```

This feature installs the skill itself, not broad agent guidance files.

---

# 9. Diagnostics

After installation, PHAX should print:

```txt
target
scope
installed skill name
destination path
whether the skill was created, updated, or already present
```

Example output:

```txt
Installed PHAX planning skill.

Target: claude
Scope: project
Skill: phax-planning
Destination: .claude/skills/phax-planning
```

If installation fails, PHAX should explain why.

---

# 10. Minimal validation

PHAX should validate that the bundled planning skill exists before copying it.

PHAX should also validate that the copied skill contains the required skill file.

If validation fails, PHAX should stop with a clear error.

---

# 11. Release packaging

The PHAX package or binary distribution must include the planning skill files.

A release should not be considered valid if the planning skill is missing.

The release pipeline should verify that the bundled planning skill is present.

---

# 12. Out of scope

This feature does not include:

```txt
installing multiple PHAX skills
a --target all option
TanStack Intent integration
plugin packaging
Claude plugin manifests
Codex plugin manifests
skill registry support
skill discovery across npm packages
automatic modification of AGENTS.md or CLAUDE.md
uninstall command
update command separate from install
remote skill downloads
third-party skills
```

These can be considered later.

---

# 13. Acceptance criteria

This feature is complete when:

1. PHAX ships with one exposed skill: `phax-planning`.
2. PHAX provides a command to install the planning skill.
3. The command supports `--target claude`.
4. The command supports `--target codex`.
5. The command supports `--target agent`.
6. The command supports `--scope project`.
7. The command supports `--scope user`.
8. The command does not provide a `--target all` mode.
9. Project scope installs into the current project’s skill location for the selected target.
10. User scope installs into the user-level skill location for the selected target.
11. Installation is idempotent.
12. PHAX reports the destination path after installation.
13. PHAX does not modify unrelated agent instruction files.
14. PHAX does not require the project to install PHAX into `node_modules`.
15. The PHAX release includes the planning skill files.
16. The release pipeline fails if the planning skill is missing.

---

# 14. Product summary

PHAX should provide a minimal native skill installation command.

The first version installs only the PHAX planning skill.

The command is explicit:

```txt
target:
  claude | codex | agent

scope:
  project | user
```

The core rule is:

```txt
PHAX owns the installation of its planning skill.

It should copy the bundled skill to the selected agent’s native skill location without relying on node_modules or a separate skill installer.
```
