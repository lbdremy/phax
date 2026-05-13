# phax planning skill

Use this skill when you are asked to write or review a `plan.md` that will be
fed to `phax extract-plan`.

## What phax expects

`phax extract-plan` passes your `plan.md` to Claude Code with the
`phax-plan.json` JSON Schema and asks it to return only structured JSON. The
extraction succeeds when every required field is present and unambiguous. It
fails loudly when required data is missing — it never guesses.

## Required fields per phase

Each phase section must contain (verbatim text, suitable for extraction):

| Field                | Location in section                                 |
| -------------------- | --------------------------------------------------- |
| `id`                 | Derived from the heading number (`phase-01` → id 1) |
| `title`              | Section heading after the dash                      |
| `model`              | `**Recommended model:** <model-id>` line            |
| `effort`             | `**Recommended effort:** low\|medium\|high` line    |
| `planMarkdownAnchor` | `{#phase-NN-<slug>}` in the heading                 |
| `commit.subject`     | `### Commit subject` subsection                     |
| `commit.body`        | `### Commit body` subsection                        |

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

## What makes a good phase boundary

- One clear outcome per phase (a file, a feature, a set of tests).
- Gates from `phax.json` must be able to verify the outcome mechanically.
- The handoff that the executing agent writes must be enough for the next phase
  to proceed without re-reading earlier phases.
- Phases that share state (e.g., a port defined in phase N used in phase N+1)
  must name the exact module path in the handoff expectations.

## Anti-patterns to avoid

- Phases with no mechanical verification step (gates must be able to pass/fail).
- Vague commit subjects — the subject is used in the git log; keep it precise.
- Scope creep — "and also clean up X" in a phase that has a different primary
  objective splits reviewer attention and risks the gate failing on unrelated work.
- Skipping the `{#phase-NN-<slug>}` anchor — `phax extract-plan` uses it as the
  `planMarkdownAnchor` field and will error without it.

## Example well-formed section header

```markdown
## phase-03 — Run folder model and atomic writes {#phase-03-run-folder}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low
```
