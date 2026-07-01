# Protected-path edit grants

## What are Claude Code protected paths?

Claude Code maintains a hardcoded set of **protected paths** that are never
auto-approved for writes, even in `acceptEdits` permission mode. The relevant
prefixes for phax are:

- `.claude/` (except `.claude/worktrees/`)

Other protected prefixes (`.git/`, `.vscode/`, `.idea/`) are enforced by Claude
Code but are out of scope for phax grants.

## Why headless runs cannot reach them

phax runs Claude Code headless with `--permission-mode acceptEdits`, which
auto-approves edits inside the writable directories (the worktree root plus any
`--add-dir` paths). Protected paths are checked **before** that permission
evaluation, so an `Edit(.claude/**)` entry in `permissions.allow` has no effect —
the write is silently denied.

The only full overrides are:

- `--permission-mode bypassPermissions` — drops the entire jail (Bash allow-list
  and filesystem bounds), unacceptable for secure runs.
- A `PreToolUse` **hook** that returns an explicit `allow` decision for a single
  tool call.

## The PreToolUse hook approach

phax generates a narrow `PreToolUse` hook scoped to exactly the protected paths
a phase declares and passes it to `claude` via `--settings`. The hook:

1. Receives the tool name and input as JSON on stdin from Claude Code.
2. Calls the domain decision (`decideProtectedPathApproval`).
3. Emits `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`
   for an approved path; emits nothing (exits 0) otherwise.

The rest of the secure jail — Bash allow-list, filesystem bounds — is untouched.

## Trust model: plan declares, config grants

The operator opts in at the `phax.json` level; a plan then declares what it
needs. phax enforces that a declared protected path must be covered by an
opted-in prefix — a plan cannot widen its own protected-write surface.

### Operator opt-in (`phax.json`)

Add protected path-prefixes to `security.filesystem.allowWriteProtected`:

```json
{
  "security": {
    "filesystem": {
      "allowWriteProtected": [".claude/skills/"]
    }
  }
}
```

An absent or empty array means the feature is off and behavior is unchanged.

### Phase declaration (`plan.md`)

List the specific protected files in the phase's planned-file sections:

```markdown
### Planned files to edit

- .claude/skills/phax-planning/SKILL.md
```

### Preflight enforcement

Before spawning the phase agent, phax resolves each declared protected path
against the opted-in prefixes:

- **Covered** (declared path falls under an `allowWriteProtected` prefix) →
  path is added to `approvedProtectedPaths`; the hook will approve it at
  runtime.
- **Uncovered** (protected but not opted into by config) → preflight fails with
  a `SecurityPreflightError` naming the phase and the offending path.

Non-protected paths are never checked here.

## Required PHAX security configuration changes

When a plan phase needs to edit a `.claude/**` file, add the covering prefix to
`phax.json` before running. Without it the preflight will fail before any agent
spawns.

Example: to allow editing `.claude/skills/phax-planning/SKILL.md`, add:

```json
"security": {
  "filesystem": {
    "allowWriteProtected": [".claude/skills/"]
  }
}
```

## Provider scope

Protected paths are a Claude Code concept. The codex and mistral-vibe adapters
sandbox the filesystem at the worktree level and do not block `.claude/**`, so
they need no hook. The `approvedProtectedPaths` field is computed and recorded in
`security.json` for all providers (audit parity), but only the Claude Code
adapter consumes it to generate a hook.
