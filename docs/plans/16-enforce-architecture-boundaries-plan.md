# Plan — Enforce the architecture boundaries that slipped this run

The agent-binding run (plan 11) introduced two layer-boundary violations that the
gate did not catch, because `tests/unit/architecturalGuards.test.ts` only
enforces a subset of the `CLAUDE.md` non-negotiables (domain purity, the
provider-spawn literal boundary, single status-writer). The two that slipped:

1. **`infra → app`** — `src/infra/providers/sessionWriter.ts` imports
   `patchAgentBindingSession` from `src/app/agentBinding.ts`, inverting the
   dependency arrow (`app → ports ← infra`).
2. **`cli → infra` business logic** — `enter` / `enter-phase` / `session-info`
   import `getSessionAdapter` / `spawnInteractive` from
   `src/infra/sessionAdapters/`, driving infra logic + `spawnSync` directly
   instead of going through a port. Every *other* `cli → infra` import in the repo
   is layer composition (`NodeFileSystemLayer`, `makeSystemTelemetryLayer`, …).

This plan adds guard tests so these two classes of violation — and the related
"all I/O goes through a port" non-negotiable — fail the gate mechanically. It
follows the existing guard's established pattern: a documented-exception allowlist
seeded from the current tree, each with a "kept honest" check that fails the build
if the listed file stops violating the rule (forcing the allowlist entry to be
removed). That lets this plan land independently of the fixes.

## Relationship to plan 15

Plan 15 (`15-agent-binding-hardening-plan.md`) *fixes* both violations (phase-01
moves the adapters to `domain/` and adds a `SessionPort`; phase-02 removes the
`infra → app` edge). The allowlists here are seeded so that **whichever plan
merges first, the other stays green**: when plan 15 removes a violation, the
kept-honest check fails until the corresponding allowlist entry is deleted. The
guards are the durable backstop; plan 15 is the cleanup.

## Required commands

- (none)

No new tool or CLI is introduced. The guards are plain Vitest assertions run by
the existing `pnpm audit:architecture` / `pnpm test` steps of the `full` gate.

## Constraints and verification notes

- All guards live in `tests/unit/architecturalGuards.test.ts` and reuse its
  existing `listTsFiles` helper and repo-relative path normalisation.
- Allowlists must be seeded from the **current** tree (verified counts below) so
  the suite is green on merge:
  - `infra → app`: exactly one file — `src/infra/providers/sessionWriter.ts`.
  - `cli → infra` non-layer: three files — `src/cli/commands/enter.ts`,
    `enterPhase.ts`, `sessionInfo.ts` (all importing `src/infra/sessionAdapters/`).
  - `domain/` direct Node I/O: none (already clean — strict, zero exceptions).
  - `cli/` direct Node I/O: `resume.ts`, `run.ts`, `sessionInfo.ts`, `shell.ts`,
    `interruptHandler.ts`.
  - `app/` direct Node I/O: 8 files — explicitly **out of scope** (see phase-02).
- Each allowlist gets a "kept honest" test mirroring the existing
  `DOCUMENTED_METADATA_WRITERS` pattern: assert every listed path still actually
  contains the thing it is excused for, so stale entries fail.

---

## phase-01 — Guard layer import direction (cli/infra/app) {#phase-01-import-direction-guards}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add two guard tests that catch the exact violations this run introduced: an
`infra → app` import and a `cli → infra` import of non-layer business logic.

### Detailed instructions

- In `tests/unit/architecturalGuards.test.ts`, add a guard **"infra must not
  import from app"**:
  - Scan every `src/infra/**/*.ts`; flag any import whose specifier resolves into
    `src/app/` (match `from "../../app/` / `from "../app/` style paths).
  - Documented exceptions: `INFRA_APP_ALLOWLIST = new Set(["src/infra/providers/sessionWriter.ts"])`.
  - Add a "kept honest" test asserting each allowlisted file still imports from
    `app/`, so the entry must be removed once plan 15 phase-02 lands.
- Add a guard **"cli may import only layer composition from infra"**:
  - Scan every `src/cli/**/*.ts`; for each import from `src/infra/**`, require that
    **every** imported binding is either a layer symbol (identifier contains
    `Layer`, e.g. `NodeFileSystemLayer`, `makeSystemTelemetryLayer`) or a
    type-only import (`import type …`). Flag any import that pulls a non-layer
    value binding (e.g. `getSessionAdapter`, `spawnInteractive`).
  - Documented exceptions: `CLI_INFRA_LOGIC_ALLOWLIST = new Set(["src/cli/commands/enter.ts",
    "src/cli/commands/enterPhase.ts", "src/cli/commands/sessionInfo.ts"])`.
  - Add a "kept honest" test asserting each allowlisted file still imports from
    `src/infra/sessionAdapters/`, so the entries must be removed once plan 15
    phase-01 moves that dispatch into `src/domain/session/`.
  - Verify against the current tree that the only non-exception `cli → infra`
    imports are layer symbols / type imports (confirmed: `*Layer`,
    `makeSystemTelemetryLayer`, `type TelemetryFactoryInput`), so the guard is
    green after seeding.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

- Codifies the `CLAUDE.md` rule `cli → app → domain ← ports ← infra`: infra never
  depends on app; the CLI reaches infra only as the composition root (layers),
  never for behavior.

### Test strategy

- Page/CLI-layer architectural invariants expressed as unit tests over the source
  tree (the established pattern in this file). Seed allowlists from the verified
  current counts; the suite must be green at the end of the phase.

### Implementation order

infra→app guard (+ allowlist + kept-honest) → cli→infra guard (+ allowlist +
kept-honest) → run `pnpm audit:architecture` to confirm green.

### Excluded scope

- Direct Node I/O guards (phase-02).
- Actually removing the violations — that is plan 15's job; this phase only
  guards and documents them.

### Verification

- The project's configured `full` gate profile in `phax.json`
  (`pnpm audit:architecture` runs this test file; `pnpm test` runs it again).

### Expected handoff content

- The two new guard names, the allowlist constant names and their seeded members,
  and confirmation the kept-honest checks pass.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(arch): guard infra→app and cli→infra import direction

### Commit body

Add architectural guard tests that fail on an infra→app import or a cli→infra
import of non-layer business logic — the two boundaries the agent-binding run
crossed. Known violations are captured in documented allowlists with kept-honest
checks so they must be cleared when plan 15 removes them.

---

## phase-02 — Guard the all-I/O-through-a-port rule {#phase-02-io-through-ports-guard}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Codify the non-negotiable that domain and CLI code must not perform direct
filesystem / process I/O — it belongs behind a port (or, for the composition
root, a layer). `domain/` is already clean, so it is enforced strictly; `cli/`
gets a documented allowlist that signals intent to shrink.

### Detailed instructions

- In `tests/unit/architecturalGuards.test.ts`, add a guard **"no direct Node I/O
  outside ports/infra"** matching imports of `node:fs`, `node:fs/promises`,
  `node:child_process`, and `node:os`:
  - `src/domain/**`: **zero** tolerance — no exceptions (verified clean today).
  - `src/cli/**`: documented allowlist `CLI_DIRECT_IO_ALLOWLIST = new Set([
    "src/cli/commands/resume.ts", "src/cli/commands/run.ts",
    "src/cli/commands/sessionInfo.ts", "src/cli/commands/shell.ts",
    "src/cli/interruptHandler.ts"])`, each with a kept-honest check.
  - Do **not** scan `src/app/**` in this guard. Add a code comment stating this is
    a deliberate, scoped exclusion: 8 `app/` files use `node:fs` directly today
    (`agentBinding`, `executePlan`, `loadConfig`, `loadPlan`, `resolveRunInfo`,
    `resume`, `finalReport`, `initProject`); routing those through the
    `FileSystem` port is a separate, larger refactor, not a guard to add against
    the current tree.
- Keep `src/infra/**` and `src/ports/**` unscanned — infra is where I/O is
  allowed, and ports declare it.

### Planned files to create

- (none)

### Planned files to edit

- `tests/unit/architecturalGuards.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

- Codifies `CLAUDE.md`: "All I/O goes through a port; never call fs/shell/git
  directly in app/, domain/, or cli/." This phase enforces it for `domain/`
  (strict) and `cli/` (allowlisted), and explicitly defers `app/`.

### Test strategy

- Source-tree architectural unit tests, same pattern as phase-01. Seed the `cli/`
  allowlist from the verified five files; assert `domain/` is clean with no
  allowlist.

### Implementation order

domain strict guard → cli guard + allowlist + kept-honest → confirm green.

### Excluded scope

- `app/` direct-I/O enforcement (deliberately deferred — too widely used today to
  guard without a large refactor).
- "Decode external input through a schema" and "transition RunState/PhaseState
  only via `src/domain/state.ts`": not cleanly checkable as a static import/path
  rule, and not among the boundaries this run crossed; the existing single
  status-writer guard already centralises status encoding. Out of scope here.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The guard name, the matched `node:*` module list, the `domain/` strict result
  (no exceptions), the seeded `cli/` allowlist, and the rationale comment for
  excluding `app/`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

test(arch): guard against direct Node I/O in domain and cli

### Commit body

Add an architectural guard forbidding direct node:fs/child_process/os imports in
domain (strict) and cli (documented allowlist), codifying the all-I/O-through-a-
port rule. app/ is deliberately excluded as a larger separate refactor, noted in
the guard.
