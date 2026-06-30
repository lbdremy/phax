# Scoped approval hook for declared Claude-Code protected-path edits

> Plan for letting a phax agent edit a **Claude-Code protected path** (e.g.
> `.claude/skills/**`) when — and only when — the phase's planned-file lists
> declare it and the operator has opted in via `phax.json`. phax generates a
> narrow `PreToolUse` approval hook scoped to exactly those declared paths and
> passes it to `claude` via `--settings`, keeping the rest of the secure jail
> (Bash allow-list, filesystem bounds) intact. Feed this file to
> `phax extract-plan` to produce `phax-plan.json`.

---

## Context

In secure mode the Claude Code provider runs headless with
`--permission-mode acceptEdits` (see `buildSecureClaudeFlags` in
`src/infra/providers/claudeCode.ts`). `acceptEdits` auto-approves edits *within*
the writable dirs (the worktree `cwd` plus `--add-dir` paths) — but Claude Code
maintains a hardcoded set of **protected paths** (`.git`, `.claude` except
`.claude/worktrees`, `.vscode`, `.idea`, …) that are **never** auto-approved in
any mode except `bypassPermissions`. Writes there prompt for confirmation, and a
headless `--print` session has no approver, so the edit is effectively **denied**.

This bit phax when a plan asked the agent to edit
`.claude/skills/phax-planning/SKILL.md` (a protected path): the edit silently
failed and was left as a manual follow-up. Two facts make this hard to work
around:

- Settings-level allow rules do **not** pre-approve protected-path writes — the
  protected-path safety check runs *before* Claude Code evaluates `permissions.allow`,
  so an `Edit(.claude/**)` entry has no effect.
- The only overrides are `--permission-mode bypassPermissions` (which drops the
  **entire** jail — Bash allow-list and filesystem bounds included — and is
  therefore unacceptable for a secure run) or a `PreToolUse` **hook** that
  returns an explicit `allow` decision.

A `PreToolUse` hook is the surgical option: it runs before each tool call,
receives the tool name and input as JSON on stdin, and may emit
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`
to approve that single call without weakening any other permission. This plan
has phax generate such a hook, scoped to exactly the protected paths a phase
declares, so the agent gains the *narrowest possible* additional grant and the
rest of the secure jail is untouched.

### Trust model (deliberate)

phax already separates **powers** (granted only by the operator's `phax.json`)
from **plan assertions** (the plan declares what a run needs; phax fails fast if
`phax.json` has not blessed it — see `checkRequiredCommands`). This feature keeps
that split:

- The operator opts in by listing protected path-prefixes in a new
  `security.filesystem.allowWriteProtected` array in `phax.json` (e.g.
  `[".claude/skills/"]`). Empty/absent ⇒ feature off, behavior unchanged.
- A phase then *declares* the specific protected files it will touch in its
  normal planned-file lists (`plannedFilesToCreate` / `plannedFilesToEdit` /
  `optionalFilesToEdit`).
- phax grants hook approval only for declared paths that fall under an
  opted-in prefix. A declared protected path **not** covered by config is a
  preflight failure (consistent with `checkRequiredCommands`), so a plan can
  never widen its own protected-write surface.

### Provider scope

Protected paths are a Claude Code concept. The codex and mistral-vibe adapters
sandbox the filesystem at the worktree level and do not specially block
`.claude/**`, so they need no hook. This plan changes only the Claude Code
adapter; the shared domain/app layers compute `approvedProtectedPaths` for every
provider but only the Claude adapter consumes it. The computed set is recorded
in `security.json` for all providers (audit parity).

### Bootstrapping note

This plan's own phase-05 documents the feature in the `phax-planning` skill.
`.claude/skills/...` is itself a protected path, so the running (pre-feature)
phax cannot edit it during this run — phase-05 edits the non-protected
`.agents/skills/...` mirror plus `docs/`, and records the `.claude` mirror as a
follow-up once the feature is merged and `phax.json` is configured. The feature
becomes usable for *later* runs (including the re-run of
`docs/plans/40-deterministic-plan-extraction-plan.md`), not for this one.

## Required commands

- (none)

This plan adds TypeScript, tests, and docs only; it introduces no new shell
command the agent must invoke during the build. (The generated hook command is
run by `claude` at agent runtime in *future* runs, not by the building agent.)

---

## phase-01 — Protected-path domain logic {#phase-01-protected-domain}

**Recommended model:** claude-opus-4-8
**Recommended effort:** medium

Add the pure, security-critical core: detect which paths are Claude-Code
protected, resolve a phase's declared protected paths against the operator's
opt-in prefixes, and decide a single `PreToolUse` approval at runtime. No I/O.

### Detailed instructions

- Create `src/domain/security/protectedPaths.ts` exporting:
  - `CLAUDE_PROTECTED_PREFIXES: readonly string[]` — the repo-relative
    directory prefixes Claude Code protects that are relevant to phax grants.
    Start with `[".claude/"]` and exclude `.claude/worktrees/`. (Document that
    `.git/`, `.vscode/`, `.idea/` are also protected by Claude but are out of
    scope for phax grants; this constant governs only what phax will offer to
    approve.)
  - `isProtectedPath(repoRelativePosixPath: string): boolean` — true when the
    path is under a protected prefix and not under `.claude/worktrees/`.
  - `resolveProtectedApprovals(input: { plannedPaths: readonly string[]; allowWriteProtected: readonly string[]; worktreeRoot: string }): { approved: readonly string[]; uncovered: readonly string[] }`
    — pure. Normalize each planned path to a repo-relative POSIX path; keep only
    protected ones; partition into `approved` (covered by a configured
    `allowWriteProtected` prefix) and `uncovered` (protected but not opted in).
    `approved` entries are returned as **absolute** paths (joined with
    `worktreeRoot`) because the runtime hook compares against the absolute
    `file_path` Claude passes. De-duplicate; keep input order stable.
  - `decideProtectedPathApproval(input: { approvedAbsolutePaths: readonly string[]; toolName: string; filePath: string | undefined }): "allow" | "defer"`
    — the runtime decision. Return `"allow"` only when `toolName` is one of
    `Edit | Write | MultiEdit` and `filePath`, resolved to an absolute path,
    exactly matches a member of `approvedAbsolutePaths`. Otherwise `"defer"`
    (the hook then emits nothing and Claude's normal protected-path handling
    applies). Path comparison must be exact on normalized absolute POSIX paths —
    no prefix/glob widening at decision time (the widening already happened, and
    was bounded, in `resolveProtectedApprovals`).
- Keep prefix matching dependency-free: a path is "covered" by a configured
  prefix when, after normalization, it equals the prefix (sans trailing slash)
  or starts with the prefix including the trailing `/`. Do not pull in a glob
  library.
- Pure module: no `FileSystem`, no `Backend`, no `node:fs`, no `process`. All
  inputs are passed in.

### Planned files to create

- `src/domain/security/protectedPaths.ts`
- `tests/unit/protectedPaths.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/domain/security/protectedPaths.ts`. Consumers: the app layer
(phase-03) calls `resolveProtectedApprovals` to compute per-phase approvals and
surface `uncovered` to preflight; the CLI hook command (phase-04) calls
`decideProtectedPathApproval` per tool call. The stable contract is these three
exported signatures.

### Test strategy

Domain logic → unit tests, written before implementation. Cover:

- `isProtectedPath`: `.claude/skills/x.md` ⇒ true; `.claude/worktrees/x` ⇒
  false; `src/x.ts` ⇒ true→false (not protected); a `./`-prefixed and a
  redundant-segment path normalize correctly.
- `resolveProtectedApprovals`: a mix of protected + non-protected planned paths
  with `allowWriteProtected: [".claude/skills/"]` ⇒ only the covered
  `.claude/skills/**` paths appear in `approved` (absolute), a protected path
  outside the prefix appears in `uncovered`, non-protected paths appear in
  neither; empty `allowWriteProtected` ⇒ every protected path is `uncovered` and
  `approved` is empty.
- `decideProtectedPathApproval`: exact absolute match on `Edit`/`Write`/
  `MultiEdit` ⇒ `"allow"`; a non-matching path, a non-edit tool name, and a
  missing `filePath` ⇒ `"defer"`.

### Implementation order

Constants and `isProtectedPath` first, then `resolveProtectedApprovals`, then
`decideProtectedPathApproval`.

### Excluded scope

- The `phax.json` schema field (phase-02).
- Any port/app/infra wiring (phases 03–04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact signatures of `isProtectedPath`, `resolveProtectedApprovals`, and
  `decideProtectedPathApproval`, and the module path.
- The decided normalization rules (repo-relative POSIX in, absolute out for
  `approved`) so phase-03/04 pass matching inputs.
- The `Edit | Write | MultiEdit` tool-name set the runtime decision keys on.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): add protected-path approval domain logic

### Commit body

Add src/domain/security/protectedPaths.ts: a pure module that detects
Claude-Code protected paths, resolves a phase's declared protected paths against
operator-configured allowWriteProtected prefixes (returning approved absolute
paths and uncovered violations), and decides a single PreToolUse approval at
runtime. No I/O. Covered by unit tests for detection, resolution, and the
runtime decision.

---

## phase-02 — Config field and security policy {#phase-02-config-policy}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Surface the operator opt-in: add `security.filesystem.allowWriteProtected` to
the phax.json security schema and carry it through the resolved config into the
secure `SecurityPolicy`.

### Detailed instructions

- Edit `src/schemas/securityConfig.ts`:
  - Add `allowWriteProtected: Schema.optional(Schema.Array(Schema.NonEmptyString))`
    to `FilesystemConfigSchema`.
  - Add `allowWriteProtected: readonly string[]` to
    `ResolvedSecurityConfig.filesystem`.
  - Default it to `[]` in `resolveSecurityConfig`.
- Edit `src/domain/security/types.ts`: add
  `allowWriteProtected: readonly string[]` to `SecurityPolicy.filesystem`.
- Edit `src/domain/security/resolvePolicy.ts`: populate
  `filesystem.allowWriteProtected` from `config.filesystem.allowWriteProtected`
  in the secure/isolated branch, and as `[]` in the `unsafe` branch (unsafe mode
  already drops the jail; the hook is a secure-mode concept). Keep the existing
  comment style.
- Edit `phax.schema.json`: add the `allowWriteProtected` property under
  `security.filesystem` (array of strings) mirroring the Effect schema. If the
  repo regenerates this file from the schema, regenerate it instead of
  hand-editing and note the command used in the handoff.
- Do not change `phax.json` itself here — wiring the project's own opt-in is the
  operator's call and not part of this feature's code.

### Planned files to create

- `tests/unit/resolvePolicyProtected.test.ts`

### Planned files to edit

- `src/schemas/securityConfig.ts`
- `src/domain/security/types.ts`
- `src/domain/security/resolvePolicy.ts`
- `phax.schema.json`

### Optional files that may be edited

- `tests/unit/securityConfig.test.ts`

### Boundary contracts

Producer: the resolved `SecurityPolicy.filesystem.allowWriteProtected` from
`resolvePolicy.ts`. Consumer (phase-03): `executePlan` reads it to compute
per-phase approvals. The stable shape is the `readonly string[]` of opted-in
path-prefixes.

### Test strategy

Domain + schema → unit tests, written before implementation:

- `resolveSecurityConfig` defaults `allowWriteProtected` to `[]` when absent and
  passes a provided array through.
- `resolveSecurityPolicy` carries the prefixes into the secure policy and yields
  `[]` for unsafe mode.
- A `phax.json`-shaped object with `security.filesystem.allowWriteProtected`
  decodes through `SecurityConfigSchema` without error.

### Implementation order

Schema field first, then `ResolvedSecurityConfig` + default, then the
`SecurityPolicy` type, then `resolvePolicy`, then `phax.schema.json`.

### Excluded scope

- The domain logic (phase-01, consumed but not modified).
- Port/app/infra wiring (phases 03–04).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The final field name and location (`security.filesystem.allowWriteProtected`)
  and its default (`[]`).
- Confirmation that `SecurityPolicy.filesystem` now carries
  `allowWriteProtected` and how unsafe mode sets it.
- Whether `phax.schema.json` was hand-edited or regenerated (and the command).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): add allowWriteProtected to security config and policy

### Commit body

Add an optional security.filesystem.allowWriteProtected string array to the
phax.json security schema, thread it through ResolvedSecurityConfig (default
[]) into the secure SecurityPolicy, and mirror it in phax.schema.json. This is
the operator opt-in that scopes which protected path-prefixes a run may be
granted to edit. Covered by config-resolution and policy-resolution unit tests.

---

## phase-03 — Per-phase approvals, port, and preflight {#phase-03-app-wiring}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Compute each phase's `approvedProtectedPaths` from its planned files and the
policy, pass them to the backend through the port, fail preflight on uncovered
protected declarations, and record the approvals in `security.json`.

### Detailed instructions

- Edit `src/ports/backend.ts`: add
  `readonly approvedProtectedPaths?: readonly string[] | undefined` to
  `AgentRunOptions`, documented like the existing `agentCommands` field
  (computed before spawn; consumed by the claude provider; recorded in
  `security.json` regardless of provider).
- Edit `src/app/executePlan.ts`:
  - For each phase, build the union of `plannedFilesToCreate`,
    `plannedFilesToEdit`, and `optionalFilesToEdit`, and call
    `resolveProtectedApprovals({ plannedPaths, allowWriteProtected: policy.filesystem.allowWriteProtected, worktreeRoot })`.
  - Pass `approvedProtectedPaths: <approved>` into the `runAgent` /
    `resumeAgentSession` options alongside `agentCommands` (the existing call
    sites near the `agentCommands:` assignments).
  - Add a preflight check: if a phase has `uncovered` protected paths, fail the
    run *before spawning that phase's agent* with a `SecurityPreflightError`
    naming the phase id and the uncovered paths, and pointing at
    `security.filesystem.allowWriteProtected`. Mirror the placement and error
    style of the existing `checkRequiredCommands` preflight.
  - Record the resolved `approvedProtectedPaths` in the per-phase
    `security.json` next to the frozen agent commands (extend the record shape;
    if it is schema-validated, update that schema too).

### Planned files to create

- `tests/integration/protectedPathApprovals.test.ts`

### Planned files to edit

- `src/ports/backend.ts`
- `src/app/executePlan.ts`

### Optional files that may be edited

- `src/app/dryRun.ts`
- `src/app/finalReport.ts`

### Boundary contracts

Consumer: `executePlan` needs `resolveProtectedApprovals` (phase-01) and
`policy.filesystem.allowWriteProtected` (phase-02). Producer: the `Backend` port
now carries `approvedProtectedPaths` to adapters. The contract is the optional
`readonly string[]` on `AgentRunOptions`; existing callers that omit it are
unaffected (absent ⇒ no protected grant).

### Test strategy

Application command with a fake `Backend` → integration tests, written before
implementation:

- A phase declaring a `.claude/skills/**` file, with
  `allowWriteProtected: [".claude/skills/"]`, passes that file (absolute) in
  `approvedProtectedPaths` to `runAgent`.
- The same phase with empty `allowWriteProtected` fails preflight with a
  `SecurityPreflightError` naming the phase and the uncovered path; the backend
  is never called.
- A phase declaring only non-protected files passes `approvedProtectedPaths` as
  empty (or omitted) and never trips preflight.

### Implementation order

Port field first, then the `resolveProtectedApprovals` call + option wiring at
the existing `runAgent` sites, then the preflight failure, then the
`security.json` record.

### Excluded scope

- Building the actual hook / `--settings` file (phase-04) — this phase only
  computes and transports `approvedProtectedPaths`.
- Docs (phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact `AgentRunOptions` field name and that absent ⇒ no grant.
- Where in `executePlan` approvals are computed and where preflight rejects
  uncovered paths, plus the `SecurityPreflightError` message shape.
- The `security.json` field added for approved protected paths.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(app): compute and transport per-phase protected-path approvals

### Commit body

Compute each phase's approvedProtectedPaths from its planned files and the
resolved allowWriteProtected prefixes, pass them through a new optional
AgentRunOptions field to the backend, fail preflight when a phase declares a
protected path the operator has not opted into, and record approvals in
security.json. Covered by integration tests for the granted, uncovered, and
non-protected cases.

---

## phase-04 — Claude approval hook and `--settings` wiring {#phase-04-claude-hook}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** high

Generate the `PreToolUse` approval hook from `approvedProtectedPaths`, wire it
into the Claude invocation via `--settings`, and add the thin CLI command the
hook invokes.

### Detailed instructions

- Add a schema for the hook payload Claude passes on stdin. Create
  `src/schemas/claudeHookPayload.ts` decoding the subset phax needs:
  `tool_name: string` and `tool_input: { file_path?: string }` (tolerate and
  ignore other fields). This is external input crossing the boundary, so it must
  be decoded through a schema before reaching the domain decision.
- Add the thin CLI hook command. Create
  `src/cli/commands/approveProtectedPath.ts`: read JSON from stdin, decode it
  through `claudeHookPayload`, call
  `decideProtectedPathApproval({ approvedAbsolutePaths, toolName, filePath })`
  where `approvedAbsolutePaths` come from an argument/env passed by the generated
  settings, and on `"allow"` print the Claude approval JSON
  (`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`);
  on `"defer"` print nothing and exit 0. Contains no business logic — it only
  decodes, delegates to the domain decision, and renders. Register it as a
  hidden subcommand in `src/cli/main.ts`.
- Add the settings builder. Create
  `src/infra/providers/protectedPathHookSettings.ts` exporting a pure function
  that, given `approvedAbsolutePaths` and the command phax should invoke for the
  hook, returns the Claude settings object: a `hooks.PreToolUse` entry with
  matcher `"Edit|Write|MultiEdit"` whose command runs the phax hook subcommand
  with the approved paths. Decide and document how the approved paths reach the
  command (CLI args vs. an env var the settings set) so they survive shell
  quoting; prefer a single JSON-encoded env var to avoid arg-quoting pitfalls.
- Edit `src/infra/providers/claudeCode.ts`:
  - Thread `approvedProtectedPaths` from `AgentRunOptions` into
    `buildSecureClaudeFlags` (or alongside it).
  - When non-empty: build the settings object, write it to a file under the
    phase folder (reuse the existing `node:fs` usage in this adapter — e.g.
    `<phaseFolderPath>/claude-protected-approval.settings.json`), and append
    `--settings <path>` to the secure flags. When empty: change nothing (no
    `--settings`, behavior identical to today).
  - Keep this Claude-only; do not touch the codex or vibe adapters.

### Planned files to create

- `src/schemas/claudeHookPayload.ts`
- `src/cli/commands/approveProtectedPath.ts`
- `src/infra/providers/protectedPathHookSettings.ts`
- `tests/integration/claudeProtectedPathHook.test.ts`

### Planned files to edit

- `src/cli/main.ts`
- `src/infra/providers/claudeCode.ts`

### Optional files that may be edited

- `tests/unit/claudeArgs.test.ts`

### Boundary contracts

Consumer: `claudeCode.ts` needs `approvedProtectedPaths` (phase-03 port field)
and `decideProtectedPathApproval` (phase-01). Producer: the generated settings
file + hidden hook subcommand form the runtime contract with `claude` —
`PreToolUse` payload in, approval JSON out. The settings builder is pure and
unit-testable; only the file write and `--settings` append are I/O in the
adapter.

### Test strategy

Adapter + CLI → integration tests, plus a pure unit test for the settings
builder, written before implementation:

- `protectedPathHookSettings` produces a `hooks.PreToolUse` entry with the
  `Edit|Write|MultiEdit` matcher and the approved paths reachable by the
  command.
- `buildArgs` / `buildSecureClaudeFlags` appends `--settings <path>` exactly
  when `approvedProtectedPaths` is non-empty, and omits it otherwise.
- The hook command, fed a `PreToolUse` payload for an approved path, prints the
  `permissionDecision: "allow"` JSON; fed a non-approved path or a non-edit
  tool, prints nothing.

### Implementation order

Payload schema first, then the domain-backed CLI command, then the pure settings
builder + its test, then the adapter write + `--settings` append.

### Excluded scope

- Codex/vibe adapters (no protected-path concept).
- Docs (phase-05).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The settings file path/name written per phase and the exact `hooks.PreToolUse`
  shape.
- How approved paths are passed to the hook command (args vs. env) and why.
- The hidden subcommand name registered in `main.ts`.
- Confirmation that an empty approval set leaves the invocation byte-identical to
  today (no `--settings`).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(claude): grant declared protected-path edits via a scoped PreToolUse hook

### Commit body

Generate a PreToolUse approval hook scoped to a phase's approvedProtectedPaths
and pass it to claude via --settings, so the agent can edit declared
.claude/** files while the rest of the secure jail stays intact. Adds a
stdin-payload schema, a thin hidden CLI hook command backed by the phase-01
domain decision, and a pure settings builder; the adapter writes the settings
file and appends --settings only when approvals exist. Claude-only; codex/vibe
unchanged. Covered by settings-builder, arg, and hook-decision tests.

---

## phase-05 — Documentation {#phase-05-docs}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Document the feature for plan authors and operators: how declaring a protected
path in a phase, plus the `phax.json` opt-in, grants a scoped edit, and the
security reasoning behind it.

### Detailed instructions

- Edit `.agents/skills/phax-planning/SKILL.md` (the non-protected mirror): in
  the planned-files / required-configuration guidance, document that listing a
  `.claude/**` file in a phase's planned-file sections grants the agent scoped
  permission to edit it **iff** a matching prefix is present in
  `security.filesystem.allowWriteProtected` in `phax.json`; otherwise the
  preflight fails. Extend the `## Required PHAX security configuration changes`
  guidance to mention `allowWriteProtected` for protected-path edits.
- Create `docs/security/protected-path-edits.md`: explain Claude Code's protected
  paths, why `acceptEdits` cannot reach them headless, the generated
  `PreToolUse` hook approach, the operator opt-in, and the trust model (plan
  declares, `phax.json` grants).
- Do **not** rely on editing `.claude/skills/phax-planning/SKILL.md` in this
  phase — it is a protected path and this run pre-dates the feature. Record in
  the handoff that the `.claude` mirror must be synced from `.agents` as a manual
  follow-up (or by a later run once `phax.json` opts `.claude/skills/` in). It is
  listed as optional so reconciliation does not flag it if the agent cannot
  touch it.

### Planned files to create

- `docs/security/protected-path-edits.md`

### Planned files to edit

- `.agents/skills/phax-planning/SKILL.md`

### Optional files that may be edited

- `.claude/skills/phax-planning/SKILL.md`

### Boundary contracts

Omit — this phase crosses no architectural boundary.

### Test strategy

Docs only — no tests. The `full` gate still runs (format/lint over Markdown
where configured); gates passing trivially here is acceptable since the value is
human-readable guidance.

### Implementation order

Write the security doc first, then the skill guidance referencing it.

### Excluded scope

- Any code change (phases 01–04).
- Editing the protected `.claude/skills/...` mirror (manual follow-up).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact skill wording added about protected-path grants and the
  `allowWriteProtected` opt-in.
- The path of the new security doc.
- An explicit note that `.claude/skills/phax-planning/SKILL.md` still needs a
  manual sync from the `.agents` mirror, and why.
- Any deviation from the planned file lists, with the reason.

### Commit subject

docs(security): document scoped protected-path edit grants

### Commit body

Document the protected-path approval feature: how declaring a .claude/** file in
a phase plus a security.filesystem.allowWriteProtected opt-in in phax.json grants
a scoped edit, why Claude Code's protected paths block headless acceptEdits, and
the plan-declares/config-grants trust model. Updates the .agents phax-planning
skill mirror and adds docs/security/protected-path-edits.md; the .claude mirror
is a noted manual follow-up.
