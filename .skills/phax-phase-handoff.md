# phax phase handoff skill

Use this skill when phax asks you to write `phase-handoff.md` after your gates
have passed. This happens in a resumed Claude session — the same session that
ran the phase — via a short prompt referencing this file.

## Purpose

`phase-handoff.md` is the only context the next phase gets about your work
beyond the git diff. Write it for a reader who is smart but has not seen your
session. Be specific, not comprehensive.

## Required sections

`phase-handoff.md` must contain all four of these headings, in order:

```markdown
## What was delivered

## Key decisions and why

## Exact locations (file paths and exported names)

## What the next phase needs to know
```

phax validates that all four headings are present. A missing heading
transitions the phase to `handoff_failed` and stops the run.

## What to write in each section

### What was delivered

One sentence per significant artifact: what exists now that did not before.
Name files and exported symbols. Do not summarise the phase objective — the
reader already has `plan.md`.

### Key decisions and why

List only the decisions a future reader would find surprising or that constrain
the next phase. Include the reason. Omit decisions the code makes obvious.

### Exact locations (file paths and exported names)

A flat list:

```
src/ports/fs.ts          — FileSystem port (ReadFileSystem, WriteFileSystem)
src/infra/fs.ts          — NodeFileSystem layer
src/app/runFolder.ts     — createRunFolder(shortName, …): Effect<RunPath, …>
```

Every symbol the next phase imports should appear here.

### What the next phase needs to know

Facts that are not derivable from reading the code: invariants, known gaps,
ordering constraints, things that are deliberately not implemented yet, and any
workarounds that look odd but are intentional.

## Tone and length

- Short sentences. No padding.
- Bullet lists over paragraphs.
- Total length: 150–400 words. Longer is not better.
- Never say "I implemented X" — just state what exists.

## Anti-patterns

- Summarising the phase objective (already in `plan.md`).
- Repeating what the commit message says.
- Writing "the code is self-explanatory" — if it were, this file wouldn't exist.
- Omitting a required section heading — this causes `handoff_failed`.
