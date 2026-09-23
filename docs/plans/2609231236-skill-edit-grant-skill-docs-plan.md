---
status: Approved
source-spec: null
approved:
  date: 2026-09-23
  baseline: b59a0fc
---

# Skill edit grant skill docs

> Follow-up to the `claude-skill-edit-grant` plan. It documents skill edit
> grants in the two shipped skills that plan authors and CLI operators read. It
> is also the first real end-to-end use of the feature: the phase edits files
> under `.claude/skills/`, so it only succeeds when the grant works.
> Run it **after** `claude-skill-edit-grant` is merged, with the new binary:
>
> ```
> phax run --plan docs/plans/2609231236-skill-edit-grant-skill-docs-plan.md --allow-skill-edits
> ```

## Context

The `claude-skill-edit-grant` plan shipped the following behavior, documented in
`docs/security.md`:

- A phase that lists `.claude/skills/...` files in its planned-file sections
  may create or edit exactly those files, provided the run was started with
  `phax run --allow-skill-edits`.
- Without the flag, `phax run` refuses at preflight with exit 11, naming the
  phases, the files, and the flag.
- `phax resume` inherits the consent recorded at run start.
- The grant is recorded per phase as `skillEditGrants` in `security.json`.
- Out of scope: other `.claude/` paths, undeclared sibling files, and glob
  paths.

The bootstrapping note of that plan deferred the skill updates, because the
binary that built the feature could not yet write `.claude/skills/`.

### How to verify the feature with this run

1. Run it **without** `--allow-skill-edits` first. Expect exit 11 and a message
   naming phase-01, both skill files, and the flag. No branch or worktree
   should be created.
2. Run it **with** the flag. Expect the phase to go green, both skill files to
   appear in the phase commit, and no reconciliation deviation.
3. Check `~/.phax/runs/<run>/phase-01/security.json`. Expect `skillEditGrants`
   to list both files.

## Required commands

- (none)

---

## phase-01 — Document skill edit grants in the shipped skills {#phase-01-skill-docs}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Teach plan authors (`phax-planning`) and CLI operators (`phax-cli`) how a
phase gets permission to edit skill files.

### Detailed instructions

- Read `docs/security.md` first; it is the source of truth for the wording.
- Edit `.claude/skills/phax-planning/SKILL.md`. In the
  "Planned files and end-of-phase reconciliation" section, after the bullet
  list, add a short paragraph (or a `###` subsection titled "Editing skill
  files") that says:
  - Claude Code protects `.claude/`, so a secure phase can write a
    `.claude/skills/...` file only when that exact file is listed in the
    phase's planned-file sections.
  - Declare every skill file the phase writes, including new files such as
    `references/*.md`. Undeclared siblings, glob paths, and other `.claude/`
    paths stay denied.
  - A plan that declares skill files must be run with
    `phax run --allow-skill-edits`, or the preflight refuses it.
- Edit `.claude/skills/phax-cli/SKILL.md`. After the
  "Canonical end-to-end flow" paragraph, add one short paragraph saying that
  plans touching `.claude/skills/` files need `--allow-skill-edits` on
  `phax run`, that `resume` inherits it, and that the grant is recorded in the
  phase's `security.json` (`skillEditGrants`). Refer to `--usage` for the flag
  contract, in keeping with the skill's style.
- Keep both additions short and consistent with the surrounding style. Do not
  touch the generated model-catalog block.

### Planned files to create

- (none)

### Planned files to edit

- `.claude/skills/phax-planning/SKILL.md`
- `.claude/skills/phax-cli/SKILL.md`

### Optional files that may be edited

- (none)

### Test strategy

Docs only. The gate's format check covers the Markdown. The run itself is the
end-to-end test of the grant: a denied write leaves a planned file untouched,
and reconciliation reports it.

### Implementation order

`phax-planning` first, then `phax-cli`.

### Excluded scope

- Any code change.
- `phax-spec` and the other project skills.

### Verification

- The project's configured `standard` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that both skill files were written in-session (no permission
  denial), and the headings or paragraphs added.
- Any deviation from the planned file lists, with the reason. A denied write is
  a feature bug; report it verbatim.

### Commit subject

docs(skills): document skill edit grants and --allow-skill-edits

### Commit body

Tell plan authors (phax-planning) that a phase can write a .claude/skills file
only by declaring that exact file, and only when the run is started with
--allow-skill-edits. Tell operators (phax-cli) that the flag is required, that
resume inherits it, and that the grant is recorded in security.json. This is
the first run to exercise the skill edit grant end to end.
