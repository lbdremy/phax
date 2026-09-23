---
status: Completed
source-spec: docs/specs/2609231215-claude-skill-edit-grant.md
approved:
  date: 2026-09-23
  baseline: 3528ff8
---

# Claude skill edit grant

> Let a secure-mode Claude Code phase edit exactly the `.claude/skills/**` files
> its planned-file lists declare, once the run was started with
> `--allow-skill-edits`, and nothing else under `.claude/`. Without the flag, a
> plan that declares skill files is refused at preflight. The grant is an inline
> `--settings` `PermissionRequest` hook, one rule per declared file.
> This plan replaces the stale `claude-protected-path-approval-hook` plan (PR #62).
> Check it with `phax plans lint`, then run it with `phax run --plan <this file>`.

## Context

In secure mode the Claude Code provider runs headless with
`--permission-mode acceptEdits` (`buildSecureClaudeFlags` in
`src/infra/providers/claudeCode.ts`). Claude Code never auto-approves writes to
its **protected paths**, and `.claude/` is one of them. In a `--print` session no
one can approve the prompt, so the edit is denied. Plans that edit
`.claude/skills/<name>/SKILL.md` have failed twice this way, and the edit was
left as a manual follow-up.

Probed on Claude Code 2.1.280 (headless, `acceptEdits`, `--disallowed-tools Bash`):

- A `permissions.allow` rule such as `Edit(.claude/**)` has no effect. Claude
  runs the protected-path check before it reads allow rules (documented).
- A `PreToolUse` hook that returns `permissionDecision: "allow"` **runs but does
  not unblock the write**, and the edit is still denied. PR #62 depends on this
  mechanism, so it would not have fixed the problem.
- A **`PermissionRequest`** hook that returns
  `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
  **does** unblock the write.
- A hook handler's `if` field (permission-rule syntax) scopes it to one file:
  with `"if": "Edit(//abs/.claude/skills/foo/SKILL.md)"` the edit to `foo` went
  through and the edit to `bar` in the same session was denied.
- `if` matches by **tool name**: an `Edit(...)` rule does not match a `Write`
  call (creating a new file). Each file needs one handler per edit tool
  (`Edit`, `Write`, `MultiEdit`), each with a rule for that tool.
- `--settings` accepts an **inline JSON string**, so no settings file is needed.

The hook command is a static `echo` of the allow JSON. The `if` rule does the
filtering, so phax needs no hook subcommand, no stdin payload schema, and no
file write.

## Technical arbitrations

- **Scope: `.claude/skills/**` only, hard-coded.** Other protected paths
  (`.claude/settings.json`, `.git`, `.husky`, …) keep today's behavior. We give
  up a general protected-path grant, which no plan has needed so far.
- **The plan names the files; the `--allow-skill-edits` run flag gives the
  consent.** This was decided in the spec. We give up having to pass nothing:
  the flag must be typed on every run that touches skills.
- **Consent persists as an optional `allowSkillEdits` field in `status.json`,
  where absent means no consent.** This follows the `planRepoRelPath`
  precedent. It is a knowing exception to "new fields are required": a
  required field would break decoding of every existing run's `status.json`
  (`phax ls`, `phax resume`), and there is no run-state migration.
- **Both new in-process options are optional, and absent means nothing is
  granted.** These are `executePlan`'s `allowSkillEdits?` and
  `AgentRunOptions.skillEditGrants?`, following the existing `securityMode?`
  and `agentCommands?` idiom. `pnpm test:type` now typechecks the whole test
  suite in every phase. Required fields would force edits to about 21 test
  files that call `executePlan`, plus the new `authorArtifact.ts` call site, all
  outside the planned lists. We give up compile-time pressure on each caller to
  decide; the preflight and the integration tests cover that risk. The
  no-shim rule targets persisted schemas: `security.json`'s `skillEditGrants`
  stays required.
- **Four phases.** Consent (CLI, run state, preflight) is separate from the
  adapter wiring. We give up one extra phase of wall-clock time.
- **The real-provider e2e test runs by hand** (`test:e2e:real`), not in the
  gate. We give up automatic detection when Claude Code changes behavior; the
  test must be run deliberately.
- **Exact files, not prefixes.** A grant covers each declared path, not its
  directory. We give up letting an agent add a file it did not declare, such as
  `references/x.md` next to a declared `SKILL.md`. Declare every file instead.
- **Claude-only.** Codex and Vibe sandbox at the worktree level and do not block
  `.claude/`. The grant set is still recorded in `security.json` for every
  provider.

## Spec traceability

Implements the `claude-skill-edit-grant` spec.

- **phase-01** covers:
  - §5.2.2 (non-concrete declarations dropped)
  - §5.3 (other protected paths not granted)
- **phase-02** covers:
  - §5.4.1 (no config)
  - §5.4.2 (refusing preflight)
  - §5.4.3 (consent persisted for resume)
  - §5.4.4 (consent without skill files is harmless)
  - the dry-run preview
- **phase-03** covers:
  - §5.1 (grant for the whole phase session, fix loop included)
  - §5.2.1 (undeclared sibling denied)
  - §5.5 (argv unchanged)
  - §5.6 (`skillEditGrants` in `security.json`)
  - §5.7 (Claude secure only)
  - the real-provider e2e test required by spec §10
- **phase-04** documents the behavior.

## Required commands

- (none)

## Bootstrapping note

`.claude/skills/phax-planning/SKILL.md` is itself a protected path. The phax
binary running this plan predates the feature, so phase-04 documents it only in
`docs/security.md`. Once this merges, a one-phase follow-up run adds the
planning-skill note and uses the new grant to do it.

---

## phase-01 — Skill edit grant resolution and hook settings {#phase-01-grant-core}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Add the pure core: pick out a phase's declared `.claude/skills/**` files, and
build the Claude settings object that grants edits to exactly those files.

### Detailed instructions

- Create `src/domain/security/skillEditGrants.ts` exporting
  `resolveSkillEditGrants(plannedPaths: readonly string[]): readonly string[]`.
  - Input: the union of a phase's `plannedFilesToCreate`, `plannedFilesToEdit`,
    and `optionalFilesToEdit` (repo-relative paths).
  - Normalize each path to repo-relative POSIX: strip a leading `./` and
    collapse redundant `/` and `.` segments. Reject (drop) any path that is
    absolute or contains a `..` segment.
  - Keep only paths under `.claude/skills/` (the path itself must name a file
    below that directory, not the directory itself).
  - Drop any path containing a permission-rule metacharacter (`*`, `?`, `[`,
    `]`, `(`, `)`, `{`, `}`), because it cannot become an exact rule.
  - Return the result de-duplicated, in input order. Pure: no I/O, no
    `node:path` platform dependence (use POSIX string logic).
- Create `src/infra/providers/claudeSkillEditSettings.ts` exporting
  `buildSkillEditGrantSettings(worktreeRoot: string, grants: readonly string[]): object | undefined`.
  - Return `undefined` when `grants` is empty.
  - Otherwise return
    `{ hooks: { PermissionRequest: [{ matcher: "Edit|Write|MultiEdit", hooks: [...] }] } }`.
    For every grant × tool in `["Edit", "Write", "MultiEdit"]`, add one handler
    `{ type: "command", if: "<Tool>(/<abs>)", command: "echo '<allow-json>'" }`.
    Here `<abs>` is `worktreeRoot` joined with the grant as an absolute POSIX
    path, so the rule has the `//abs/path` form. `<allow-json>` is
    `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`.
  - Put a short comment above the builder recording the probe facts from this
    plan's Context: `PreToolUse` allow does not bypass protected paths, and
    `if` matches by tool name.

### Planned files to create

- `src/domain/security/skillEditGrants.ts`
- `src/infra/providers/claudeSkillEditSettings.ts`
- `tests/unit/security/skillEditGrants.test.ts`
- `tests/unit/providers/claudeSkillEditSettings.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `resolveSkillEditGrants` in the domain and
`buildSkillEditGrantSettings` in infra. Consumers: the phase-02 preflight and
dry-run call the resolver; in phase-03, `executePlan` calls the resolver and
the Claude adapter calls the builder. The contract
between them is a list of repo-relative POSIX grant paths.

### Test strategy

Write the unit tests before the implementation.

- Resolver: `.claude/skills/foo/SKILL.md` is kept.
  `./.claude/skills//foo/./SKILL.md` normalizes to the same path and is
  de-duplicated. `.claude/settings.json`, `.claude/skills` (the directory),
  `src/x.ts`, `../.claude/skills/x.md`, `/abs/.claude/skills/x.md`, and
  `.claude/skills/*/SKILL.md` are all dropped. Input order is preserved.
- Builder: empty grants returns `undefined`. Two grants produce 6 handlers, each
  with the exact `if` string (`Edit(//wt/.claude/skills/foo/SKILL.md)`, …) and
  the exact echo command. The output round-trips through `JSON.stringify`.

### Implementation order

Resolver and its tests first, then the builder and its tests.

### Excluded scope

- Consent flag and preflight (phase-02).
- Wiring into `AgentRunOptions`, `executePlan`, `security.json`, or `buildArgs`
  (phase-03).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Both exported signatures and module paths.
- The normalization and drop rules as implemented.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(security): resolve skill edit grants and build Claude hook settings

### Commit body

Add a pure resolver that selects a phase's declared .claude/skills/** files
(normalized, exact, no traversal or glob metacharacters). Add a builder that
turns them into a Claude settings object with one PermissionRequest handler per
file and edit tool. Each handler is scoped by an absolute `if` rule and echoes
an allow decision. A PreToolUse allow does not bypass Claude's protected-path
check; a PermissionRequest allow does.

---

## phase-02 — Skill edit consent flag, preflight, and resume {#phase-02-consent}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Add `phax run --allow-skill-edits`, persist it in the run so `phax resume`
inherits it, and refuse at preflight any run whose plan declares skill files
without consent. The dry-run shows the same information before a run starts.

### Detailed instructions

- Add a pure preflight check to `src/domain/security/skillEditGrants.ts`:
  `checkSkillEditConsent({ phases, allowSkillEdits })`. It returns the list of
  `{ phaseId, files }` that need consent: every phase with a non-empty
  `resolveSkillEditGrants` result, or `[]` when `allowSkillEdits` is true.
- Add `SkillEditConsentError` to `src/domain/errors.ts`, a tagged error
  carrying `message` and `phases: readonly { phaseId: string; files: readonly string[] }[]`.
  Map it to exit code 11 in `exitCodeForError` in
  `src/cli/commands/runLayers.ts`, next to `SecurityPreflightError`.
- `src/cli/program.ts`: register `--allow-skill-edits` on `run`, with help
  text "Allow phases to edit the .claude/skills files the plan declares". Carry
  it through `src/cli/commands/run.ts` into `executePlan` as
  `allowSkillEdits`.
- `src/schemas/status.ts`: add
  `allowSkillEdits: Schema.optionalWith(Schema.Boolean, { exact: true })` to
  `RunStatusSchema`, with a comment explaining why it is optional (the
  `planRepoRelPath` precedent: existing `status.json` files must still decode,
  and absent means no consent).
- `src/app/runFolder.ts`: write `allowSkillEdits: true` into the initial run
  status only when consent was given. Follow how `planRepoRelPath` is written.
- `src/cli/commands/resume.ts`: pass
  `allowSkillEdits: runStatus.allowSkillEdits === true` to `executePlan`. Add no
  new flag.
- `src/app/executePlan.ts`: add `readonly allowSkillEdits?: boolean | undefined`
  to the options, documented next to `securityMode` (absent means no consent).
  Do not make it required: see Technical arbitrations. Existing tests that
  call `executePlan` must compile unchanged. Run `checkSkillEditConsent` in the preflight block, right after
  `checkRequiredCommands` and before any branch or worktree work. On a
  non-empty result, fail with `SkillEditConsentError`. Its message follows spec
  §6: a first line naming `--allow-skill-edits`, one line per phase listing its
  files, and a re-run hint. The check runs on resume too, so an old run without
  recorded consent is refused rather than failing silently.
- `src/app/dryRun.ts`: add `allowSkillEdits` to the inputs, per-phase
  `skillEditGrants` to `DryRunPhase`, and a report-level `skillEditConsentMissing`
  boolean. `formatDryRunReport` prints the grants per phase and a warning line
  naming `--allow-skill-edits` when consent is missing. Pass the flag through
  from `run.ts`.
- Regenerate the CLI surface with `pnpm gen:usage-spec` and `pnpm docs:cli`.
  Do not hand-edit `phax.usage.kdl` or `docs/cli/*`.

### Planned files to create

- `tests/integration/skillEditConsent.test.ts`

### Planned files to edit

- `src/domain/security/skillEditGrants.ts`
- `src/domain/errors.ts`
- `src/cli/program.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/runLayers.ts`
- `src/cli/commands/resume.ts`
- `src/schemas/status.ts`
- `src/app/runFolder.ts`
- `src/app/executePlan.ts`
- `src/app/dryRun.ts`
- `tests/unit/security/skillEditGrants.test.ts`
- `tests/unit/dryRun.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`

### Optional files that may be edited

- `docs/cli/inventory.md`
- `tests/integration/cliProgram.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/integration/resume.test.ts`

### Boundary contracts

- CLI → app: `executePlan` receives the optional `allowSkillEdits` (absent
  means false). `run.ts`
  gets it from the flag, and `resume.ts` gets it from `status.json`.
- Run state: optional `allowSkillEdits` in `status.json`; absent means false.
- Consumer in phase-03: `executePlan` has `allowSkillEdits` in scope when it
  builds `agentOptions`.

### Test strategy

Write these tests before the implementation.

- Unit, `checkSkillEditConsent`: no consent and a phase declaring
  `.claude/skills/foo/SKILL.md` returns that phase and file. Consent returns
  `[]`. No skill files returns `[]` with or without consent.
- Integration, `tests/integration/skillEditConsent.test.ts` (fake ports):
  - No consent plus a declared skill file fails with `SkillEditConsentError`.
    The message contains `--allow-skill-edits`, the phase id, and the file. The
    backend is never called and no worktree is created (spec AC "Missing
    consent refuses the run").
  - With consent, the run proceeds.
  - A resumed run whose `status.json` has `allowSkillEdits: true` proceeds
    without the flag (spec AC "Resume keeps consent").
  - A `status.json` without the field decodes, and resume is refused when a
    remaining phase declares a skill file.
- Unit, dry-run: the report lists the per-phase grants and flags missing
  consent.

### Implementation order

Domain check and error first, then the schema field, then run-folder writing,
then the `executePlan` option and preflight, then the CLI flag and resume
plumbing, then the dry-run, then regenerating the usage spec and CLI docs.

### Excluded scope

- Passing grants to any backend or writing `security.json` (phase-03).
- A flag on `phax resume`.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The `executePlan` option name, the `status.json` field, and the error class
  with its exit code.
- The exact refusal message.
- The regeneration commands run.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): require --allow-skill-edits for plans that edit skill files

### Commit body

Add a phax run --allow-skill-edits flag. A plan whose phases declare
.claude/skills files is refused at preflight (exit 11) without it, and the
refusal names the phases and files. Consent is recorded in the run status, so
phax resume inherits it, and an absent field means no consent, so existing runs
still decode. The dry-run previews per-phase grants and missing consent.

---

## phase-03 — Wire skill edit grants into secure Claude runs {#phase-03-grant-wiring}

**Recommended model:** claude-opus-5-5
**Recommended effort:** medium

Compute each phase's grants, carry them to the Claude adapter, pass them as
inline `--settings`, and record them in `security.json`.

### Detailed instructions

- `src/ports/backend.ts`: add
  `readonly skillEditGrants?: readonly string[] | undefined` to
  `AgentRunOptions`, documented like `agentCommands`: repo-relative, consumed
  by the Claude provider in secure mode, recorded in `security.json` for every
  provider, and absent means nothing is granted.
  - Do not touch non-phase callers. `reviewCompliance.ts` and headless
    authoring (`src/app/authorArtifact.ts`) run with a no-write review policy
    and must never carry a grant; leaving the field absent is the contract.
  - The Claude adapter reads `options.skillEditGrants ?? []`.
- `src/app/executePlan.ts`: at both `agentOptions` construction sites (the
  fresh phase near `agentCommands: frozenResult...`, and resume near
  `resumeFrozenResult`), set `skillEditGrants` as follows:
  - `resolveSkillEditGrants([...phase.plannedFilesToCreate, ...phase.plannedFilesToEdit, ...phase.optionalFilesToEdit])`
    when `allowSkillEdits` is true;
  - `[]` otherwise. The phase-02 preflight guarantees a phase with skill files
    never runs without consent, so this is only defense in depth.

  The fix loop (`fixLoop.ts`) and handoff generation (`handoffGeneration.ts`)
  spread `agentOptions`, so they inherit the grant. Confirm this, and do not
  edit them unless the typechecker requires it.
- `src/schemas/securityPosture.ts`: add a required
  `skillEditGrants: Schema.Array(Schema.NonEmptyString)`, and write it in the
  `security.json` posture object in `executePlan.ts`.
- `src/infra/providers/claudeCode.ts`: pass `options.skillEditGrants` and
  `options.cwd` into `buildSecureClaudeFlags`. When
  `buildSkillEditGrantSettings` returns an object, append
  `--settings <JSON.stringify(settings)>`. With no grants the argv must be
  byte-identical to today. Unsafe mode and the review/no-write flag branches
  ignore grants.
- Add a real-provider e2e test `tests/e2e/claudeSkillEditGrant.test.ts`,
  skip-gated like `tests/e2e/realFlow.test.ts` (it runs only when the real
  Claude CLI is opted in, via `pnpm test:e2e:real`).
  - Setup: a temp git repo containing `.claude/skills/foo/SKILL.md` and
    `.claude/skills/bar/SKILL.md`.
  - Spawn `claude` with the argv `buildArgs` produces for a secure policy with
    `skillEditGrants: [".claude/skills/foo/SKILL.md", ".claude/skills/new/SKILL.md"]`
    and a cheap model (`claude-haiku-4-5-20251001`).
  - Prompt it to edit `foo`, edit `bar`, and create `new`.
  - Assert that `foo` changed, `new` exists, and `bar` is unchanged.

### Planned files to create

- `tests/integration/skillEditGrants.test.ts`
- `tests/e2e/claudeSkillEditGrant.test.ts`

### Planned files to edit

- `src/ports/backend.ts`
- `src/app/executePlan.ts`
- `src/schemas/securityPosture.ts`
- `src/infra/providers/claudeCode.ts`
- `tests/unit/providers/claudeCode.test.ts`

### Optional files that may be edited

- `src/app/fixLoop.ts`
- `src/app/handoffGeneration.ts`
- `src/app/finalReport.ts`
- `tests/unit/security/posture.test.ts`
- `tests/integration/executePlan.test.ts`
- `tests/unit/providers/codexCli.test.ts`
- `tests/unit/providers/mistralVibe.test.ts`
- `tests/unit/providerDispatcher.test.ts`
- `src/infra/fakes/backend.ts`

### Boundary contracts

Consumer: `executePlan` needs `resolveSkillEditGrants` from phase-01 and
`allowSkillEdits` from phase-02. Producer: the `Backend` port carries
`skillEditGrants` to every adapter. Only the Claude adapter acts on it, by
calling `buildSkillEditGrantSettings` from phase-01. The `security.json`
posture gains the same repo-relative list.

### Test strategy

Write these tests before the implementation.

- `tests/unit/providers/claudeCode.test.ts`:
  - secure mode with grants appends exactly one `--settings`, whose JSON
    parses to the phase-01 shape;
  - secure mode with `[]` produces the same argv as before, with no
    `--settings`;
  - unsafe mode with grants has no `--settings`;
  - options with `skillEditGrants` absent, which is how review and headless
    authoring call it, produce no `--settings`.
- `tests/integration/skillEditGrants.test.ts` (fake `Backend`, run with
  consent):
  - A phase declaring `.claude/skills/foo/SKILL.md` and `src/x.ts` passes
    `skillEditGrants: [".claude/skills/foo/SKILL.md"]` to `runAgent`, and the
    phase `security.json` records the same list.
  - A phase declaring no skill files passes `[]`.
  - When a gate fails, the fix-loop `resumeAgentSession` call carries the same
    `skillEditGrants` (spec AC "Grant holds through the fix loop").
  - A phase routed to Codex records the grant in `security.json` and passes it
    unchanged to the fake backend (spec AC "Audit on every provider").
- The e2e test is described above. Author it and run it once by hand if the
  environment allows; otherwise, record in the handoff that it was not run.

### Implementation order

Port field, then call sites (typechecker-driven), then the posture schema, then
the `executePlan` wiring, then the adapter flag, then the e2e test.

### Excluded scope

- Any `phax.json` field, or lint rule for non-skill protected paths.
- Codex and Vibe adapter behavior (they only receive the field).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The exact `--settings` argv shape, and confirmation that argv is unchanged
  with no grants.
- The `security.json` field name.
- Whether the e2e test was run, and its result.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(claude): grant declared skill-file edits via inline PermissionRequest hook

### Commit body

Compute each consented phase's skill edit grants from its planned-file lists,
carry them on AgentRunOptions, and record them in security.json. In secure mode
the Claude adapter passes them as an inline --settings PermissionRequest hook
scoped to exactly those files, so a phase can edit the .claude/skills files it
declares. The rest of the jail is unchanged, and the argv is unchanged when
nothing is granted. Includes a real-provider e2e test that guards the Claude
Code behavior.

---

## phase-04 — Document skill edit grants {#phase-04-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Document for plan authors and operators how a run gets permission to edit
skill files.

### Detailed instructions

- Add a subsection to `docs/security.md` under "Provider-Specific Behavior"
  that covers:
  - Claude Code protects `.claude/`, so in secure mode it denies skill edits by
    default.
  - Listing a `.claude/skills/...` file in a phase's planned-file sections,
    plus starting the run with `phax run --allow-skill-edits`, grants that
    phase (including its fix loop and handoff) permission to edit or create
    exactly that file.
  - Without the flag, the run is refused at preflight (exit 11).
    `phax resume` inherits the consent.
  - The mechanism is an inline `--settings` `PermissionRequest` hook, and the
    grant is recorded in `security.json` as `skillEditGrants`.
  - What is out of scope: other `.claude/` paths, undeclared sibling files,
    and glob paths.
  - Why a `PreToolUse` allow or `permissions.allow` would not work.
- Mention the flag in the `README.md` `phax run` usage section, if one lists
  run flags.
- Do not edit `.claude/skills/**`; see the bootstrapping note.

### Planned files to create

- (none)

### Planned files to edit

- `docs/security.md`

### Optional files that may be edited

- `README.md`

### Test strategy

Docs only; the format check in the gate covers it.

### Implementation order

`docs/security.md`, then `README.md` if needed.

### Excluded scope

- The `phax-planning` skill update (a follow-up run after merge, itself run
  with `--allow-skill-edits`).

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- The section heading added, and a reminder that the `phax-planning` skill
  follow-up is still pending.

### Commit subject

docs(security): document skill edit grants and --allow-skill-edits

### Commit body

Explain how declaring a .claude/skills file in a phase, plus running with
--allow-skill-edits, grants a scoped edit through an inline PermissionRequest
hook. Cover the preflight refusal without the flag, consent inheritance on
resume, what the grant does not cover, and why PreToolUse allow and settings
allow rules are not enough.
