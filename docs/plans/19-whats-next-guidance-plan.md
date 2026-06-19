# Plan: "What's next" guidance at run/resume terminal points

## Context and motivation

phax follows a Unix-silent philosophy: without `--verbose`, the progress/event
stream is suppressed. That is correct for *progress noise*, but it currently also
suppresses the most useful thing at the end of a run — **what to do next**. Today
the only end-of-run output is a single line pointing at `resume-instructions.md`,
printed on **stdout** (which pollutes pipes), and several of the terminal states
print nothing actionable at all.

This plan adds a small, structured **"what's next"** block, modeled on git's
`hint:` advice: it is emitted at every terminal decision point of `phax run` and
`phax resume`, on **stderr** (keeping stdout clean and pipe-able), regardless of
`--verbose`. It is derived from a single pure domain function so the terminal
block and the persisted `resume-instructions.md` never diverge.

The terminal scenarios and their guidance:

| Scenario (CLI error / end state)         | What's next                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `RateLimitError` / `UsageLimitError`     | a copy-paste, platform-aware wait-then-resume command computed from `resetAt` (`caffeinate` on macOS, `systemd-inhibit` on Linux, plain `sleep` elsewhere); fallback `enter-phase` |
| `GateAttemptsExhaustedError`             | `enter-phase` to fix the gate → exit → `phax resume --yes` (gate re-runs first); fallback `reset-phase` |
| `PhaseHadNoChangesError`                 | `phax resume --yes` to continue with the next phase; or `enter-phase` to inspect             |
| `review_open` (success terminal of both) | `phax open` (review worktree) / `phax publish-pr` / `phax archive`                           |

### Design decisions (confirmed with the requester)

- The auto-resume flag is `--yes` (there is no `-s` flag on `resume`).
- The wait-then-resume command is **platform-aware**: `caffeinate -i` on macOS,
  `systemd-inhibit --what=idle:sleep` on Linux, and a plain `sleep` (no keep-awake
  wrapper) on anything else. The platform is injected into the domain (read from
  `process.platform` at the CLI/app edge) so the domain stays pure.
- The block is emitted on **stderr** (via `OutputPort.warn`), matching git's
  `hint:`/progress convention. We reuse `warn` rather than adding an
  `OutputPort.hint` method to avoid churning the many inline `OutputPort` fakes
  in tests; the existing stdout pointer line is **moved** from `out.log` to
  `out.warn`.
- We keep `resume-instructions.md` (durable, long form) **and** echo the
  condensed block to the terminal; both are derived from the same domain source.

## Required commands

- (none)

## Architecture notes

- `src/domain/whatsNext.ts` is pure (no I/O); time enters as an injected `Date`
  argument so the function stays deterministic and unit-testable.
- The CLI (`run.ts`, `resume.ts`) is the only place that instantiates `new Date()`
  and calls `OutputPort.warn`; it crosses no new boundary beyond the existing
  `domain → cli` consumption and the `OutputPort`.
- `GateAttemptsExhaustedError` is enriched with `phaseId` so the CLI can render a
  precise `phax enter-phase <name> <phase>` command (no disk read needed at the
  terminal point).

---

## phase-01 — Pure "what's next" domain module {#phase-01-whats-next-domain}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Add a pure domain module that maps a terminal scenario to a structured list of
next-step suggestions and renders it to a terminal string. No I/O; time is an
injected argument. This is the single source of truth that both the CLI block and
(in phase-04) `resume-instructions.md` consume.

### Detailed instructions

- Create `src/domain/whatsNext.ts` exporting:
  - `interface NextStep { readonly title: string; readonly detail?: readonly string[]; readonly command?: string }`
  - `interface WhatsNext { readonly headline: string; readonly steps: readonly NextStep[] }`
  - `type KeepAwakePlatform = "darwin" | "linux" | "other"` — the injected
    platform used to pick the keep-awake wrapper.
  - A discriminated union `WhatsNextScenario` with `kind` in
    `"limit" | "gates_exhausted" | "phase_no_changes" | "review_open"`. Carry the
    fields each scenario needs and no more: `shortName` everywhere; `resetAt?`,
    `phaseId?` and `platform: KeepAwakePlatform` for `limit`; `phaseId?` for
    `gates_exhausted`; `phaseId` (required) for `phase_no_changes`; `review_open`
    carries only `shortName`.
  - `secondsUntil(resetAt: string, now: Date): number | undefined` — parse the
    ISO string with `Date.parse`; return `undefined` when unparseable or when the
    reset is in the past/now; otherwise `Math.ceil((reset - now) / 1000)`.
  - `const RESUME_BUFFER_SECONDS = 60` and
    `resumeWhenClearCommand(shortName: string, resetAt: string | undefined, now: Date, platform: KeepAwakePlatform): string | undefined`
    — returns `undefined` when `resetAt` is absent or `secondsUntil` is
    `undefined`; otherwise builds the inner payload
    `` `sleep ${secs + RESUME_BUFFER_SECONDS}; phax resume ${shortName} --yes --verbose` ``
    and wraps it per platform:
    - `darwin`: `` `caffeinate -i sh -c '<payload>'` ``
    - `linux`: `` `systemd-inhibit --what=idle:sleep --why="phax: waiting for limit reset" sh -c '<payload>'` ``
    - `other`: `` `sh -c '<payload>'` `` (no keep-awake wrapper).
  - `buildWhatsNext(scenario: WhatsNextScenario, now: Date): WhatsNext` — a total
    `switch` over `kind` (exhaustive; no `default`). Per scenario:
    - `limit`: headline notes the provider-limit pause. First step is the timed
      `resumeWhenClearCommand` (using `scenario.platform`) when available ("Wait
      for the limit to clear, then resume automatically", detail
      `Limit resets at <resetAt>.`); otherwise
      a plain `phax resume <name> --yes --verbose` step whose detail states the
      reset time if known, else "Reset time was not reported — retry later." When
      `phaseId` is present, append an "Or inspect the in-flight phase
      interactively" step with `phax enter-phase <name> <phase>`.
    - `gates_exhausted`: headline notes gates failed after all fix attempts. Steps:
      "Fix the gate in the phase worktree" (`phax enter-phase <name> <phase>`,
      using `<phase-id>` placeholder when `phaseId` is absent), "Resume — the gate
      is re-run first; if it passes the phase commits" (`phax resume <name> --yes`),
      "If the session was lost, reset the phase instead" (`phax reset-phase <name> <phase>`).
    - `phase_no_changes`: headline notes the phase produced no changes. Steps:
      `phax resume <name> --yes` (continue with next phase), `phax enter-phase
      <name> <phase>` (inspect).
    - `review_open`: headline notes the run reached review. Steps: `phax open
      <name>`, `phax publish-pr <name>`, `phax archive <name>`.
  - `renderWhatsNext(wn: WhatsNext): string` — deterministic multi-line string:
    a leading blank line, the headline, a blank line, a `Next steps:` label, then
    each step as `  • <title>`, any `detail` lines indented under it, and the
    `command` (when present) on its own indented line with no shell prefix so it
    is copy-paste clean.
- Keep all strings ASCII-safe and stable; tests assert exact substrings.

### Planned files to create

- `src/domain/whatsNext.ts`
- `tests/unit/whatsNext.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: this module exposes `WhatsNextScenario` (consumer-constructed input),
`buildWhatsNext`, and `renderWhatsNext`. Consumers (phase-03 CLI, phase-04
`resumeInstructions`) construct a scenario and render it. The stable shape is the
`WhatsNext`/`NextStep` data; the rendered string format is consumed only by the
CLI. Time is injected as `Date`, never read inside the module.

### Test strategy

Unit tests (domain layer), written before implementation for the pure logic:

- `secondsUntil`: future ISO → positive ceil; past/now → `undefined`; garbage →
  `undefined`.
- `resumeWhenClearCommand`: absent `resetAt` → `undefined`; future `resetAt`
  with `platform: "darwin"` → command containing `caffeinate -i`, the buffered
  `sleep`, and `phax resume <name> --yes --verbose`; `platform: "linux"` →
  `systemd-inhibit --what=idle:sleep`; `platform: "other"` → bare `sh -c` with no
  keep-awake wrapper.
- `buildWhatsNext`: one assertion per `kind` covering presence/absence of
  `resetAt`/`phaseId` and (for `limit`) each `platform`, asserting headline and
  the expected command strings.
- `renderWhatsNext`: includes the headline, the `Next steps:` label, bullet
  titles, and commands.

### Implementation order

Types (incl. `KeepAwakePlatform`) → `secondsUntil` → `resumeWhenClearCommand` →
`buildWhatsNext` → `renderWhatsNext`. Write the unit tests first.

### Excluded scope

- CLI wiring (phase-03) and `resume-instructions.md` reuse (phase-04).
- Detecting the platform — the module receives `KeepAwakePlatform` as input; the
  `process.platform` read happens at the CLI/app edge (phases 03/04).
- Reading run state from disk — the module takes everything as arguments.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact path `src/domain/whatsNext.ts` and the exported signatures:
  `NextStep`, `WhatsNext`, `WhatsNextScenario`, `KeepAwakePlatform`,
  `secondsUntil`, `RESUME_BUFFER_SECONDS`, `resumeWhenClearCommand`,
  `buildWhatsNext`, `renderWhatsNext`.
- The exact command string format produced for the `limit` scenario per platform
  (`darwin`/`linux`/`other`), so phase-03 and phase-04 can rely on it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(domain): add pure what's-next guidance builder

### Commit body

Add src/domain/whatsNext.ts: a pure mapping from a terminal run/resume scenario
(limit, gates_exhausted, phase_no_changes, review_open) to a structured list of
next-step suggestions, plus a deterministic terminal renderer and a
platform-aware wait-then-resume command computed from the limit reset time
(caffeinate on macOS, systemd-inhibit on Linux, plain sleep elsewhere). Time and
platform are injected so the module stays pure and unit-testable. Covered by unit
tests for each scenario, platform, and the time math.

---

## phase-02 — Carry phaseId on gate-exhaustion error {#phase-02-gate-error-phaseid}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Enrich `GateAttemptsExhaustedError` with the failing phase id so the CLI can
render a precise `phax enter-phase <name> <phase>` command at the terminal point
without reading run state from disk.

### Detailed instructions

- In `src/domain/errors.ts`, add a required `phaseId: string` field to
  `GateAttemptsExhaustedError` (new fields are required, not optional — repo
  convention).
- In `src/app/fixLoop.ts`, where `GateAttemptsExhaustedError` is constructed (the
  `fixesUsed >= maxFixAttempts` branch, ~line 240), pass `phaseId` using the
  `phaseId` already in scope at that site (the same value used for the
  `FixAttemptsExhausted` event just above it). Cast to plain `string` if needed.
- Do not change control flow; this is purely additive context on the error.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/errors.ts`
- `src/app/fixLoop.ts`

### Optional files that may be edited

- `tests/unit/fixLoop.test.ts`

### Boundary contracts

Producer: `app/fixLoop` constructs the error with `phaseId`. Consumer: phase-03
CLI reads `err.phaseId` to build the `gates_exhausted` scenario. The stable
contract is the new required field on the domain error class.

### Test strategy

If a unit test exercises the gate-exhaustion path, update it to assert
`error.phaseId` equals the failing phase. Otherwise no new test is required;
the `full` gate's type-check confirms every construction site supplies the new
required field.

### Implementation order

Add the field to the error class first (so the compiler flags the construction
site), then update the `fixLoop` construction.

### Excluded scope

- Any CLI rendering (phase-03).
- Adding `phaseId` to other error classes.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that `GateAttemptsExhaustedError` now carries a required
  `phaseId: string`, and that the only construction site in `src/app/fixLoop.ts`
  supplies it.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(domain): carry phaseId on GateAttemptsExhaustedError

### Commit body

Add a required phaseId field to GateAttemptsExhaustedError and populate it at the
single construction site in fixLoop, so the CLI can render a precise
`phax enter-phase` command when gates are exhausted without reading run state.

---

## phase-03 — Emit the what's-next block in run/resume {#phase-03-cli-wiring}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Wire the domain builder into `phax run` and `phax resume`: render the condensed
what's-next block on stderr at every terminal point, regardless of `--verbose`,
and move the existing stdout pointer line to stderr.

### Detailed instructions

- In `src/cli/commands/run.ts`:
  - In the `RateLimitError | UsageLimitError` branch, after the existing
    `out.warn(... paused ...)`, build a `limit` scenario from `shortName`,
    `err.resetAt`, `err.phaseId`, and a `platform` derived from `process.platform`
    (`"darwin"`/`"linux"` map through; anything else → `"other"`); call
    `out.warn(renderWhatsNext(buildWhatsNext(scenario, new Date())))`, then keep
    a final `out.warn` pointing at `resume-instructions.md` (moved off stdout).
    Map `process.platform` to `KeepAwakePlatform` with a tiny local helper so
    both `run.ts` and `resume.ts` share the mapping (define it once, e.g. in
    `runLayers.ts`, and import it).
  - Add explicit branches for `GateAttemptsExhaustedError` (→ `gates_exhausted`
    scenario using `err.phaseId`) and `PhaseHadNoChangesError` (→
    `phase_no_changes` scenario using `err.phaseId`), each rendering its block on
    stderr plus the `resume-instructions.md` pointer.
  - In the success path (`review_open`), replace the current single `out.log`
    line with a `review_open` scenario rendered via `out.warn`. Keep stdout clean.
- In `src/cli/commands/resume.ts`, apply the same treatment to its
  `RateLimitError | UsageLimitError`, `PhaseHadNoChangesError`, the (currently
  unhandled) `GateAttemptsExhaustedError`, and the `review_open` success path.
- Import `buildWhatsNext`/`renderWhatsNext` from `src/domain/whatsNext.js`.
  `new Date()` is created here at the edge (CLI), never in domain/app.
- Do not add an `OutputPort.hint` method — reuse `warn` (stderr). Keep the
  command files thin: build the scenario, render, call `out.warn`; no business
  logic.

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/runLayers.ts`

### Optional files that may be edited

- `tests/unit/runArgv.test.ts`
- `tests/unit/resumeArgv.test.ts`

### Boundary contracts

Consumer: the CLI commands construct a `WhatsNextScenario` from the caught error
or success state and render via `renderWhatsNext`, emitting through
`OutputPort.warn` (stderr). Producer is `src/domain/whatsNext.ts` (phase-01). No
new port is introduced.

### Test strategy

CLI smoke/unit at the command layer. The argv tests stub `warn` as a no-op and
assert only parsing, so they need no change for behavior; if a test is added,
assert that a captured `warn` output contains the expected command for a given
injected error. The substance of the rendered content is already covered by the
phase-01 domain tests, so a heavy CLI test is not required.

### Implementation order

`run.ts` branches first (it has the most terminal points), then mirror in
`resume.ts`, then the success paths.

### Excluded scope

- `resume-instructions.md` reuse of the shared builder (phase-04).
- Changing exit codes (`exitCodeForError` is unchanged).
- Adding an `OutputPort.hint` method.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The list of terminal points now emitting the block in each command, and
  confirmation that all of them write to stderr (`out.warn`) and that no
  what's-next text remains on stdout (`out.log`).
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(cli): print what's-next guidance on stderr at run/resume exits

### Commit body

Render the structured what's-next block at every terminal point of phax run and
phax resume (rate/usage limit, gate exhaustion, no-changes, review_open),
emitting on stderr regardless of --verbose so stdout stays pipe-clean. Move the
existing resume-instructions.md pointer off stdout and add the previously missing
gate-exhaustion and no-changes guidance.

---

## phase-04 — Derive resume-instructions.md from the shared builder {#phase-04-md-reuse}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `resume-instructions.md` consume the same `buildWhatsNext` source for its
command list, so the durable file and the terminal block never drift apart.

### Detailed instructions

- In `src/app/resumeInstructions.ts`, keep the long-form prose intros and the
  "Why it stopped" context blocks, but generate the actionable command sections
  from `buildWhatsNext` (phase-01) instead of hand-written command literals:
  - For the rate/usage-limit variant, construct a `limit` scenario from the
    input (`shortName`, `resetAt`, `phaseId`, `platform`) and render its steps
    into the markdown (e.g. each `NextStep` becomes a `## <title>` + fenced
    `command`).
  - For the gate-exhaustion variant, construct a `gates_exhausted` scenario and
    render its steps the same way.
  - Pass time (`now: Date`) and `platform: KeepAwakePlatform` as injected
    arguments threaded from the caller so the function stays pure/testable; read
    `process.platform` only at the app edge (the dispatcher that calls
    `writeResumeInstructions`), reusing the same mapping helper from phase-03.
- Preserve the existing `resume-instructions.md` section headings closely enough
  that any existing references remain valid; the goal is single-sourcing the
  commands, not a rewrite of the prose.
- Add a unit test for the markdown builder asserting the limit variant contains
  the platform-appropriate wait-then-resume command (e.g. `caffeinate` for
  `darwin`) and the gate variant contains the enter-phase/resume commands.

### Planned files to create

- `tests/unit/resumeInstructions.test.ts`

### Planned files to edit

- `src/app/resumeInstructions.ts`

### Optional files that may be edited

- `src/app/effectRunner.ts`
- `src/app/executePlan.ts`

### Boundary contracts

Consumer: `app/resumeInstructions` constructs a `WhatsNextScenario` and renders
its steps into markdown. Producer is `src/domain/whatsNext.ts`. `now: Date` and
`platform: KeepAwakePlatform` are threaded from the dispatcher that calls
`writeResumeInstructions`; both are produced at the app edge (the `Date` from the
clock, the platform from `process.platform`).

### Test strategy

Unit test (application layer with the in-scope pure builder): assert the rendered
markdown for both variants contains the expected commands sourced from
`buildWhatsNext`. Write it before refactoring so the command strings are pinned.

### Implementation order

Add the test pinning current+expected command strings, then refactor the builder
to source commands from `buildWhatsNext`, then thread `now` if required.

### Excluded scope

- Changing the prose/intro wording beyond what single-sourcing requires.
- Any CLI changes (phase-03).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Confirmation that both `resume-instructions.md` variants now source their
  command lists from `buildWhatsNext`, and how `now` is threaded if a call-site
  changed.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(app): source resume-instructions commands from what's-next builder

### Commit body

Generate the actionable command sections of resume-instructions.md from the
shared buildWhatsNext source so the durable file and the terminal block stay in
lockstep. Keep the long-form prose and "why it stopped" context. Covered by a new
unit test pinning the commands for both the limit and gate-exhaustion variants.
