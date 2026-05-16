# e2e-minimal — two-phase fixture plan

> Minimal plan for phax end-to-end tests. Two quick phases against a simple
> TypeScript stub. Uses haiku + low effort so runs are cheap.

---

## Context

A tiny TypeScript project used as a fixture for phax E2E tests. Phase 01 adds
an `add` function; phase 02 documents it in the README.

---

## phase-01 — Add add function {#phase-01-add-function}

**Recommended model:** claude-haiku-4-5-20251001
**Recommended effort:** low

### Objective

Add `export function add(a: number, b: number): number { return a + b; }` to
`src/index.ts`, replacing the existing `export {};` stub.

### Detailed instructions

- Open `src/index.ts`.
- Replace the entire file content with:
  ```typescript
  export function add(a: number, b: number): number {
    return a + b;
  }
  ```
- Do not create any other files.

### Included scope

- `src/index.ts` only.

### Excluded scope

- README (phase-02).
- Any test files.

### Validation expectations

Running `node --version` exits 0 (gate always passes for this fixture).

### Commit subject

`feat(phase-01): add add function`

### Commit body

Add a simple `add` function that sums two numbers.

### Expected handoff content

Phase 01 added `export function add(a, b)` to `src/index.ts`. The file
compiles and the gate passed. Phase 02 should document this function in
README.md.

---

## phase-02 — Document add function {#phase-02-document-add-function}

**Recommended model:** claude-haiku-4-5-20251001
**Recommended effort:** low

### Objective

Update `README.md` to document the `add` function with a brief description and
usage snippet.

### Detailed instructions

- Open `README.md`.
- Append a "## Usage" section with a code snippet showing how to import and
  call `add`.
- Keep the existing content; only append — do not remove any lines.

### Included scope

- `README.md` only.

### Excluded scope

- `src/` (phase-01 is complete).

### Validation expectations

Running `node --version` exits 0 (gate always passes for this fixture).

### Commit subject

`docs(phase-02): document add function`

### Commit body

Add a Usage section to README documenting the add function with an example.

### Expected handoff content

Phase 02 appended a Usage section to README.md. Both phases are complete; the
run is ready for review.
