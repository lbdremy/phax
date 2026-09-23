---
status: Approved
date: 2026-09-23
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
approved:
  date: 2026-09-23
  baseline: 84be31d
---

# Claude skill edit grant

## 1. Context

In secure mode, phax runs the Claude Code agent headless (`--print`) with the
`acceptEdits` permission mode. Edits inside the phase worktree are
auto-approved, except on Claude Code's **protected paths**. Claude Code never
auto-approves writes there, and `.claude/` (except `.claude/worktrees`) is one
of them. A headless session has no one to answer the prompt, so the write is
denied.

This repo keeps its agent skills under `.claude/skills/<name>/` (for example
`.claude/skills/phax-planning/SKILL.md`), and so do repos that install phax
skills. Plans regularly need to update them.

A phase already declares the files it will touch, in three planned-file lists:
`Planned files to create`, `Planned files to edit`, and
`Optional files that may be edited`. phax reconciles these lists against the
phase commit.

A headless probe on Claude Code 2.1.280 established the following:

- `permissions.allow` rules (e.g. `Edit(.claude/**)`) do not lift the
  protected-path check.
- A `PreToolUse` hook returning `allow` runs but does not lift it either.
- A `PermissionRequest` hook returning `allow` does lift it.
- Such a hook can be scoped to one file per edit tool.

## 2. Problem

Twice now, a phase whose job included updating a skill file ended green except
for that file. The agent's edit was silently denied, and the change had to be
redone by hand after the run. The plan declared the file and a human approved
the plan, yet phax gave the agent no way to write it.

The previous attempt (PR #62, now closed) generalized to every protected path
behind a new `phax.json` opt-in. It relied on the `PreToolUse` mechanism, which
does not work. The real need is narrower: skill files, named one by one in an
approved plan.

## 3. Product goal

A Claude Code phase in secure mode can create or edit exactly the skill files
its plan declares, once the operator has explicitly allowed skill edits for the
run. Every other protected path, and every undeclared file, stays exactly as
locked as it is today. A run that needs skill edits but lacks consent refuses
to start; it never runs to a silent partial result.

> A phase may write a skill file if and only if it names that file and the run
> was started with skill edits allowed.

## 4. Terminology

- **Skill file**: a file whose repo-relative path lies strictly below
  `.claude/skills/`.
- **Declared file**: a path listed in any of a phase's three planned-file lists.
- **Skill edit grant**: the set of declared skill files a phase may write.
- **Skill edit consent**: the operator's explicit, per-run permission to grant
  skill edits, given when the run starts and kept for the life of the run.
- **Phase session**: the agent's initial run for a phase, plus its same-session
  fix-loop turns and its handoff-generation turn.

## 5. Functional requirements

### 5.1 Granting declared skill files

WHILE a phase runs on the Claude Code provider in secure mode with skill edit
consent, THE system SHALL allow the agent to create or edit every declared
skill file of that phase, for the whole phase session.

### 5.2 Exactness

5.2.1 IF the agent writes a skill file that the phase did not declare, THEN the
system SHALL leave that write subject to Claude Code's default protected-path
handling (denied headless).

5.2.2 IF a declared path is not a concrete skill file (it lies outside
`.claude/skills/`, is the directory itself, contains a `..` segment, is
absolute, or contains a glob metacharacter), THEN the system SHALL exclude it
from the grant.

### 5.3 No widening beyond skills

THE system SHALL NOT change how any protected path outside `.claude/skills/` is
handled.

### 5.4 Grant source and consent

5.4.1 THE system SHALL derive the grant only from the phase's declared files,
with no `phax.json` configuration.

5.4.2 IF a run is started without skill edit consent while any of its phases
declares a skill file, THEN the preflight SHALL refuse the run before any
branch, worktree, or agent work begins. The refusal SHALL name the phases, the
skill files, and the consent flag.

5.4.3 WHEN a run is started with skill edit consent, THE system SHALL record
the consent in the run so that resuming the run keeps it without asking again.

5.4.4 WHEN a run is started with skill edit consent and no phase declares a
skill file, THE system SHALL run normally and grant nothing.

### 5.5 Unchanged invocation when nothing is granted

WHEN a phase declares no skill files, THE system SHALL invoke the agent exactly
as it does today.

### 5.6 Audit

THE system SHALL record each phase's skill edit grant in that phase's
`security.json`, for every provider, as an empty list when nothing is granted.

### 5.7 Provider scope

WHERE the provider is not Claude Code, or the mode is unsafe, THE system SHALL
NOT alter the agent invocation because of the grant.

## 6. Surface

New `phax run` flag (normative name, boolean, default off):

    phax run --plan docs/plans/<stamp>-<slug>-plan.md --allow-skill-edits

Refusal when consent is missing (exit code 11, the existing security-preflight
code, is normative; wording is indicative):

    Security preflight failed: the plan edits skill files, which requires --allow-skill-edits.
      phase-02: .claude/skills/phax-planning/SKILL.md
    Re-run with --allow-skill-edits to grant exactly these files.
    $? = 11

`phax resume <run>` takes no new flag. It inherits the consent recorded at
`phax run` (normative).

A plan phase declares skill files as it declares any file (normative: no new
plan syntax).

    ### Planned files to edit

    - `.claude/skills/phax-planning/SKILL.md`

    ### Planned files to create

    - `.claude/skills/phax-spec/references/ears.md`

`security.json` for that phase gains one field. The field name is normative;
the values are repo-relative paths. It is required, so there is no
back-compat shim.

    {
      "mode": "secure",
      "provider": "claude-code",
      …
      "agentCommands": [ … ],
      "skillEditGrants": [
        ".claude/skills/phax-planning/SKILL.md",
        ".claude/skills/phax-spec/references/ears.md"
      ],
      "providerSkippedForSecurity": []
    }

`phax.json`: no change (normative).

## 7. Non-goals

- Granting writes to any other protected path (`.claude/settings.json`,
  `.claude/agents/`, `.git/`, `.husky/`, `.npmrc`, …).
- Prefix or directory grants, or letting the agent add undeclared files next to
  a declared one.
- A `phax.json` opt-in. Consent is per run, through the flag.
- Per-file or per-phase consent. The flag grants every skill file the plan
  declares.
- Revoking or granting consent on `phax resume`.
- A preflight or lint error for declared protected paths that fall outside the
  grant.
- Changes to the Codex or Mistral Vibe providers, which do not block `.claude/`.
- Unsafe mode, which already bypasses permissions.

## 8. Acceptance criteria

### Declared skill file is edited

Given a run started with `--allow-skill-edits` and a secure Claude Code phase
that declares `.claude/skills/foo/SKILL.md` in
`Planned files to edit`, when the agent edits that file, then the edit lands in
the phase worktree. (refs §5.1)

### Declared new skill file is created

Given a run started with `--allow-skill-edits` and a secure Claude Code phase
that declares `.claude/skills/new/SKILL.md` in
`Planned files to create`, when the agent creates that file, then it exists in
the phase worktree. (refs §5.1)

### Grant holds through the fix loop

Given the same run and a phase that declares `.claude/skills/foo/SKILL.md` and
whose gate fails,
when the agent edits that file during a fix-loop turn, then the edit lands.
(refs §5.1)

### Undeclared sibling stays denied

Given the same phase, and `.claude/skills/bar/SKILL.md` not declared, when the
agent edits `bar` in the same session, then `bar` is unchanged. (refs §5.2.1)

### Non-concrete declarations are not granted

Given a phase declaring `.claude/skills/*/SKILL.md`,
`../.claude/skills/x.md`, and `.claude/skills`, when the phase starts, then its
`security.json` `skillEditGrants` is `[]`. (refs §5.2.2)

### Other protected paths unchanged

Given a phase declaring `.claude/settings.json`, when the phase starts, then
`skillEditGrants` is `[]` and the agent invocation is identical to that of a
phase declaring no protected path. (refs §5.3, §5.5)

### Missing consent refuses the run

Given a plan whose phase-02 declares `.claude/skills/foo/SKILL.md`, when
`phax run` runs without `--allow-skill-edits`, then it exits 11, names
phase-02, the file, and `--allow-skill-edits`, and no branch or worktree is
created. (refs §5.4.2)

### Consent applies without config

Given a `phax.json` with no new key, when `phax run --allow-skill-edits` runs
a plan declaring a skill file, then the grant applies. (refs §5.4.1)

### Resume keeps consent

Given a run started with `--allow-skill-edits` and interrupted before a phase
that declares a skill file, when `phax resume` runs without any flag, then that
phase is granted its skill file. (refs §5.4.3)

### Consent without skill files is harmless

Given a plan declaring no skill file, when `phax run --allow-skill-edits` runs,
then the run proceeds, and every `security.json` has `skillEditGrants: []`.
(refs §5.4.4)

### Invocation unchanged without skill files

Given a phase declaring only `src/**` files, when the Claude Code agent is
invoked, then its argv is byte-identical to the argv before this change.
(refs §5.5)

### Audit on every provider

Given a run started with `--allow-skill-edits` and a phase declaring
`.claude/skills/foo/SKILL.md` that runs on Codex, when
the phase starts, then `security.json` `skillEditGrants` is
`[".claude/skills/foo/SKILL.md"]` and the Codex invocation is unchanged.
(refs §5.6, §5.7)

## 9. Open questions for implementation planning

All questions below are resolved by the operator.

Question: who authorizes the grant?

- Plan declaration only — abandons: explicit operator consent at execution
  time.
- Plan declaration plus a `phax.json` prefix opt-in — abandons: zero-config
  use. Every repo must configure the key first, which is the friction that
  produced the two failures.
- Plan declaration plus a `phax run --allow-skill-edits` flag, with a
  refusing preflight — abandons: typing the flag on each run that touches
  skills.

Decision (operator): the run flag. It is deliberate and zero-config, and it
fails fast instead of failing silently mid-run. The consent is recorded in the
run, so `phax resume` inherits it.

Question: exact files or skill directories?

- Exact files — abandons: the agent cannot add an unplanned helper file inside
  a declared skill.
- Directory of each declared file — abandons: exactness. The agent may write
  files no human reviewed in the plan.

Decision (operator): exact files. Reconciliation already asks authors to declare
every write.

## 10. Implementation-planning note

Settled:

- skill-only scope;
- grant equals the declared skill files;
- `--allow-skill-edits` consent with a refusing preflight, persisted for resume;
- no `phax.json` key;
- an audit field on every provider;
- an unchanged argv when nothing is granted.

Constraints for the plan:

- The mechanism must be one Claude Code has been shown to honor headless: a
  `PermissionRequest` hook. `PreToolUse` allow and `permissions.allow` do not
  work.
- The plan must include a deliberately-run, real-provider e2e test that guards
  the "declared edited / sibling denied / new file created" triple, so a Claude
  Code behavior change is caught.

The `phax-planning` skill lives under `.claude/skills/`, so the binary that
builds this feature cannot update it. The skill note is a follow-up run after
merge.
