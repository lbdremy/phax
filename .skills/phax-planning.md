# phax planning skill

Use this skill when you are asked to write or review a `plan.md` that will be
fed to `phax extract-plan`.

## What phax expects

`phax extract-plan` passes your `plan.md` to Claude Code with the
`phax-plan.json` JSON Schema and asks it to return only structured JSON. The
extraction succeeds when every required field is present and unambiguous. It
fails loudly when required data is missing — it never guesses.

## Per-phase field set

Each phase section must contain all of the following. Fields marked **extracted**
are pulled by `phax extract-plan` into `phax-plan.json`; the rest are
informational for the executing agent.

| Field                    | Location in section                                   | Extracted? |
| ------------------------ | ----------------------------------------------------- | ---------- |
| `id`                     | Derived from the heading number (`phase-01` → `"1"`)  | yes        |
| `title`                  | Section heading after the dash                        | yes        |
| `model`                  | `**Recommended model:** <model-id>` line              | yes        |
| `effort`                 | `**Recommended effort:** low\|medium\|high` line      | yes        |
| `planMarkdownAnchor`     | `{#phase-NN-<slug>}` in the heading line              | yes        |
| `commit.subject`         | `### Commit subject` subsection                       | yes        |
| `commit.body`            | `### Commit body` subsection                          | yes        |
| Objective                | Opening paragraph of the phase section                | no         |
| Detailed instructions    | Bullet list of what to implement                      | no         |
| Included scope           | Explicit list of what is in scope                     | no         |
| Excluded scope           | Explicit list of what is out of scope                 | no         |
| Expected handoff content | What the executing agent must document in the handoff | no         |

## Heading format

```
## phase-NN — <Title>  {#phase-NN-<slug>}
```

- `NN` is zero-padded to two digits.
- `<slug>` uses only lowercase letters and hyphens.
- The anchor must be on the same line as the heading.

## Model IDs

Use exact model IDs — the extractor validates them:

- `claude-sonnet-4-6` — default for most phases
- `claude-opus-4-7` — reserve for deep reasoning (architecture audit, etc.)
- `claude-haiku-4-5-20251001` — reserve for trivial tasks

## Effort values

`low` | `medium` | `high` — nothing else.

## Planning constraints

- **Sequential only.** Phases execute one at a time; phax has no parallel
  execution mode.
- **No invented repo commands.** Gates come from `phax.json`, not from
  `plan.md`. Never invent `pnpm` scripts or CLI commands that do not already
  exist in the project.
- **Small, committable phases.** Each phase must produce a single coherent
  commit. If the diff would be hard to review, split the phase.
- **Gate-verifiable outcomes.** Every phase must have an outcome the configured
  gates can verify mechanically (type-check, tests, lint, build, etc.).
- **Handoff-complete.** The handoff the executing agent writes must be enough
  for the next phase to proceed without re-reading earlier phases.

## What makes a good phase boundary

- One clear outcome per phase (a file, a feature, a set of tests).
- Gates from `phax.json` must be able to verify the outcome mechanically.
- Phases that share state (e.g., a port defined in phase N used in phase N+1)
  must name the exact module path in the handoff expectations.

## Anti-patterns to avoid

- Phases with no mechanical verification step (gates must be able to pass/fail).
- Vague commit subjects — the subject is used in the git log; keep it precise.
- Scope creep — "and also clean up X" in a phase that has a different primary
  objective splits reviewer attention and risks the gate failing on unrelated work.
- Skipping the `{#phase-NN-<slug>}` anchor — `phax extract-plan` uses it as the
  `planMarkdownAnchor` field and will error without it.
- Parallel or overlapping phase scope — each phase must be independently
  committable; assume the previous phase is done and merged.

## Example well-formed section header

```markdown
## phase-03 — Run folder model and atomic writes {#phase-03-run-folder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low
```
