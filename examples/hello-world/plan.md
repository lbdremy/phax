# Hello World — three-phase example plan

> This is an example `plan.md` for a tiny 3-phase run. Feed it to
> `phax extract-plan` to produce `phax-plan.json`, then run it with
> `phax run --plan phax-plan.json --dry-run` to verify the plan.

---

## Required commands

- (none)

---

## Context

A minimal TypeScript project that adds a `greet` function, tests it, and
documents it.

---

## phase-01 — Add greet function {#phase-01-greet-function}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Create `src/greet.ts` with a single exported `greet(name: string): string`
function that returns `"Hello, <name>!"`.

### Detailed instructions

- Create `src/greet.ts`.
- Export `greet(name: string): string`.
- No side effects, no I/O.

### Planned files to create

- src/greet.ts

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Excluded scope

- Tests (phase-02).
- Documentation (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/greet.ts` and the `greet` function signature.

### Commit subject

feat(phase-01): add greet function

### Commit body

Add a simple `greet` function that formats a greeting string given a name.

---

## phase-02 — Test greet {#phase-02-test-greet}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add a Vitest unit test for the `greet` function.

### Detailed instructions

- Create `tests/greet.test.ts`.
- Cover the happy path and an empty-string name.

### Planned files to create

- tests/greet.test.ts

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Excluded scope

- Documentation (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `pnpm test` passes.

### Commit subject

test(phase-02): cover greet with vitest

### Commit body

Add unit tests for the `greet` function covering the happy path and edge cases.

---

## phase-03 — Document greet {#phase-03-document-greet}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Add a `README.md` that documents the `greet` function with an install and
usage example.

### Detailed instructions

- Create `README.md` at the repo root.
- Show install and a usage snippet.

### Planned files to create

- README.md

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Excluded scope

- Any code changes.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `README.md` renders without broken Markdown syntax.

### Commit subject

docs(phase-03): document greet function in README

### Commit body

Add a README with install instructions and a usage example for the `greet` function.
