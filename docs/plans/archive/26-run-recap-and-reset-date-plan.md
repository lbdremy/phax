# Plan 26 — End-of-run recap and rate-limit reset-date fix

This plan covers two user-facing console improvements to `phax run` (and the
matching paths in `phax resume`):

1. **Reset-date bug.** When a provider usage/rate limit is hit, the reset time is
   extracted with a permissive regex that captures arbitrary trailing words
   (e.g. the literal word `date` from a phrase like "reset date"), so the console
   prints `Limit resets at date.`. The unparseable value also silently disables
   the auto-resume command (`secondsUntil` returns `undefined`). Fix: normalize
   the captured value to an ISO-8601 instant at the schema boundary — keeping it
   only when it parses as a real date or a Unix epoch — and surface `undefined`
   otherwise.

2. **End-of-run recap.** A successful run currently prints only the `review_open`
   "what's next" block (on stderr), with no run summary and a thin set of next
   steps. Enrich the recap so it always shows, on stdout, a one-line summary plus
   the genuinely useful follow-ups: view the PR (URL when already published, else
   `publish-pr`), open the review worktree in the editor (`open`), open a shell
   (`shell`), resume the interactive agent session on the final phase (`enter`),
   and archive (`archive`). Also give `Ctrl+C` a voice: the interrupt handler is
   currently silent.

The work is ordered inside-out: schema boundary → pure domain rendering →
application return value → CLI surface.

## Required commands

- (none)

## phase-01 — Normalize the rate-limit reset time at the schema boundary {#phase-01-reset-date}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make `classifyRateLimit` only ever return a `resetAt` that is a valid ISO-8601
instant, so the console never prints a non-date fragment and the auto-resume
command can compute a real sleep duration. Today `extractResetAt` in
`src/schemas/claudeOutput.ts` captures `([^\n".]+)` after a `reset`/`try again`
keyword and returns the raw fragment verbatim; a message like
`...limit reached, reset date...` yields the literal string `date`.

### Detailed instructions

- Add a `normalizeResetAt(raw: string): string | undefined` helper in
  `src/schemas/claudeOutput.ts` that:
  - Trims the candidate and rejects it when empty.
  - Returns the ISO-8601 string (`new Date(...).toISOString()`) when
    `Date.parse(raw)` yields a finite timestamp (covers explicit timestamps and
    RFC/locale dates the providers may emit).
  - Recognizes a bare Unix epoch: a run of 10 digits (seconds) or 13 digits
    (milliseconds) — convert to ISO. This covers Claude Code's
    `...usage limit reached|<epoch>` result format, which the current keyword
    regexes never match.
  - Returns `undefined` for anything that does not parse (so a captured word like
    `date`, `soon`, `later`, `3pm` without a date context is dropped, not shown).
- Extend `RESET_PATTERNS` (or add a dedicated epoch scan over the haystack) so the
  `|<epoch>` form is captured as a reset candidate, then run every candidate
  through `normalizeResetAt`. The first candidate that normalizes to a valid ISO
  instant wins; otherwise `resetAt` is `undefined`.
- Have `extractResetAt` return the normalized value (or `undefined`). Do not
  change the `RateLimitClassification` shape beyond keeping `resetAt?: string`
  meaning "ISO-8601 or absent".
- Keep `classifyRateLimit`'s existing contract: still returns `undefined` when the
  signal is ambiguous; only the `resetAt` field's value semantics tighten.

### Planned files to create

- (none)

### Planned files to edit

- `src/schemas/claudeOutput.ts`
- `tests/unit/claudeOutput.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `src/schemas/claudeOutput.ts` decoding provider stderr/JSONL at the
boundary. Consumers: `src/infra/providers/claudeCode.ts` (and the codex/vibe
adapters) build `RateLimitError.resetAt` from this value; `src/domain/whatsNext.ts`
consumes it both for display (`Limit resets at ${resetAt}`) and for the
auto-resume `secondsUntil(resetAt, now)` computation. Stable shape: `resetAt` is
either a valid ISO-8601 string or `undefined` — never a free-text fragment.

### Test strategy

Unit tests (schema/boundary layer), written before implementation:

- A message containing `reset date` (no real date) → `resetAt` is `undefined`.
- `...usage limit reached|1719765600` (epoch seconds) → `resetAt` equals the
  expected ISO instant.
- A 13-digit epoch (ms) → expected ISO instant.
- An explicit ISO/RFC timestamp in the message → passes through normalized.
- A genuinely ambiguous message → `classifyRateLimit` still returns `undefined`.
- Preserve existing kind-detection (`usage_limit` vs `rate_limit`) assertions.

### Implementation order

Write the failing unit cases first, then add `normalizeResetAt`, then wire it into
`extractResetAt`/the epoch scan.

### Excluded scope

- Human-friendly date formatting for display (the recap renders the ISO string as
  decided; locale formatting is out of scope).
- Any change to `RateLimitError`/`UsageLimitError` domain error shapes.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The `normalizeResetAt` signature and the exact normalization rules (Date.parse,
  10/13-digit epoch, undefined fallback).
- Confirmation that `resetAt` is now always ISO-8601-or-undefined, which
  downstream `secondsUntil` relies on.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(rate-limit): normalize reset time to ISO or drop it

### Commit body

Reset-time extraction captured arbitrary trailing words (e.g. "date") and
rendered them verbatim, and the unparseable value silently disabled auto-resume.
Normalize every candidate to an ISO-8601 instant — accepting real dates and Unix
epochs (including Claude Code's `|<epoch>` form) and dropping anything else — so
the console never shows a non-date and secondsUntil can compute a real delay.
Covered by unit tests at the schema boundary.

## phase-02 — Enrich the review-open recap in whatsNext {#phase-02-review-recap}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Make the `review_open` "what's next" block a complete end-of-run recap: a summary
headline plus the useful follow-up commands. This phase only changes the pure
domain builder/renderer and its tests; CLI wiring is phase-04.

### Detailed instructions

- In `src/domain/whatsNext.ts`, extend the `review_open` variant of
  `WhatsNextScenario` with optional fields:
  - `prUrl?: string | undefined` — present when the run already published a PR.
  - `phaseCount?: number | undefined` — number of committed phases, for the
    headline.
  - Keep `shortName` required. All new fields are optional so callers that lack
    them (e.g. `resume`) still render the richer step list.
- Rebuild the `review_open` branch in `buildWhatsNext` so the steps are, in order:
  1. PR step — when `prUrl` is defined: title "View the pull request" with the URL
     as `detail` (no command); otherwise title "Publish a pull request" with
     command `phax publish-pr <shortName>`.
  2. "Open the review worktree in your editor" → `phax open <shortName>`.
  3. "Open a shell in the review worktree" → `phax shell <shortName>`.
  4. "Resume the agent session on the final phase" → `phax enter <shortName>`.
  5. "Archive the run" → `phax archive <shortName>`.
- Set the headline to include `phaseCount` when present, e.g.
  `The run reached review — N phase(s) complete.`; fall back to the current
  wording when `phaseCount` is absent.
- Do not change `renderWhatsNext`'s format contract (it already renders
  `detail` lines and `command` lines); rely on it as-is.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/whatsNext.ts`
- `tests/unit/whatsNext.test.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `buildWhatsNext` (pure). Consumers: `src/cli/commands/run.ts` and
`src/cli/commands/resume.ts` construct the `review_open` scenario. Stable shape:
the scenario gains optional `prUrl` and `phaseCount`; existing callers passing
only `{ kind: "review_open", shortName }` keep compiling and get the richer steps.

### Test strategy

Unit tests (domain layer), written before implementation:

- `review_open` with `prUrl` → steps include a "View the pull request" entry
  whose detail carries the URL and no `publish-pr` command.
- `review_open` without `prUrl` → steps include the `phax publish-pr` command.
- Steps always include `phax open`, `phax shell`, `phax enter`, and
  `phax archive` for `<shortName>`.
- Headline reflects `phaseCount` when provided; falls back otherwise.

### Implementation order

Update the scenario type and tests first, then rebuild the `review_open` branch.

### Excluded scope

- CLI wiring and reading the PR URL / phase count (phase-03 and phase-04).
- Changes to the `limit`, `gates_exhausted`, and `phase_no_changes` scenarios.

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The updated `review_open` scenario fields (`prUrl?`, `phaseCount?`) and the
  exact ordered step titles/commands, so phase-04 can populate them.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(whats-next): richer end-of-run review recap

### Commit body

Expand the review_open what's-next block into a complete recap: a phase-count
headline plus follow-ups for viewing the PR (URL when published, else
publish-pr), opening the editor, opening a shell, resuming the agent session, and
archiving. New scenario fields are optional so resume keeps compiling. Pure
domain change covered by unit tests.

## phase-03 — Surface the published PR URL from executePlan {#phase-03-pr-url-return}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** low

Carry the auto-publish PR URL out of `executePlan` so the CLI recap can show it.
Today the `publishRun` result is discarded (`Effect.catchAll(() => Effect.void)`)
and the URL lives only in `publication.json` / `final-report.md`.

### Detailed instructions

- In `src/app/executePlan.ts`, capture the `publishRun(...)` result into an outer
  `let publishedPrUrl: string | undefined` instead of voiding it: keep publication
  failures non-fatal by recovering to `undefined`
  (`Effect.catchAll(() => Effect.succeed(undefined))`), and read `prUrl` off the
  `PublicationResult` when the result kind is `published`.
- Add `prUrl?: string` to the object `executePlan` returns alongside
  `committedPhases`, `finalPhaseId`, and `finalWorktreePath`. The field is absent
  when publish is disabled, fails, or returns no URL.
- Do not change publish behavior, ordering, or the `review_open` transition; this
  is a pure return-value addition. Confirm `resume.ts`, the other caller, still
  compiles (the new field is optional).

### Planned files to create

- (none)

### Planned files to edit

- `src/app/executePlan.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

Producer: `executePlan` (application). Consumers: `src/cli/commands/run.ts` and
`src/cli/commands/resume.ts`. Stable shape: the success result gains an optional
`prUrl: string`; absence means "no published PR URL available".

### Test strategy

Application layer. If an existing `executePlan` integration test with fake ports
covers the success path, extend it to assert `prUrl` is threaded when publish is
configured to return a URL; otherwise rely on the `full` gate's type-check and the
phase-04 CLI test. Do not invent a new harness solely for this field.

### Implementation order

Capture the publish result, then widen the return type.

### Excluded scope

- Rendering the URL (phase-04).
- Reading `publication.json` from the CLI (the value comes through the return).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- The exact widened return shape of `executePlan`
  (`{ committedPhases, finalPhaseId, finalWorktreePath, prUrl? }`).
- How `prUrl` is derived from `PublicationResult` and that publish failure stays
  non-fatal.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): return published PR URL from executePlan

### Commit body

Capture the auto-publish result instead of discarding it and add an optional
prUrl to executePlan's success value, keeping publish failures non-fatal. This
lets the CLI recap link the PR directly. No behavior change to publishing or the
review_open transition.

## phase-04 — Wire the recap into run/resume and announce interrupts {#phase-04-cli-recap}

**Recommended model:** claude-sonnet-4-6
**Recommended effort:** medium

Surface the enriched recap on a successful run/resume and give `Ctrl+C` a console
message. This is the user-visible payoff of the previous phases.

### Detailed instructions

- In `src/cli/commands/run.ts`, on the success path (currently the single
  `out.warn(renderWhatsNext(buildWhatsNext({ kind: "review_open", shortName }, ...)))`
  at the end):
  - Read `prUrl` and the committed-phase count from the `executePlan` result
    (`result.right`).
  - Print a one-line run summary on **stdout** via `out.log` (e.g.
    `Run "<qualName>" reached review — <N> phase(s) complete.`).
  - Render the enriched `review_open` recap passing `prUrl` and `phaseCount`.
  - Print a pointer to `final-report.md` in the run folder (mirror the existing
    `See ... for details.` style used by the pause branches).
  - Keep returning exit code `0`.
- In `src/cli/commands/resume.ts`, update both `review_open` render sites
  (the early `refusal.reason === "review_open"` branch and the terminal success
  branch) to use the enriched scenario. Pass `phaseCount` where available; `prUrl`
  may be omitted there (optional field) unless it is readily available from the
  resume result.
- In `src/cli/interruptHandler.ts`, after writing the interrupted state and before
  `process.exit(130)`, write a concise message to stderr synchronously (e.g.
  `process.stderr.write(...)`) telling the user the run was interrupted, the state
  was saved, and how to resume (`phax resume <shortName>`). Use the
  `activeRunContext` for the name; keep it best-effort and never throw inside the
  handler (the file is already a sanctioned synchronous-bypass module).

### Planned files to create

- (none)

### Planned files to edit

- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/interruptHandler.ts`
- `tests/unit/cli/run.test.ts`

### Optional files that may be edited

- `tests/unit/cli/resume.test.ts`

### Boundary contracts

Consumer: CLI command layer rendering via `OutputPort` and the enriched
`buildWhatsNext` scenario from phase-02, fed by the `executePlan` return from
phase-03. No new ports. The interrupt handler keeps its sanctioned direct-write
bypass; it gains a synchronous stderr write only.

### Test strategy

CLI unit tests with a fake `OutputPort`:

- On a successful run, the captured output includes the summary line on stdout,
  the `phax open` / `phax shell` / `phax enter` / `phax archive` steps, and the
  `final-report.md` pointer.
- When `prUrl` is present, the recap shows the URL; when absent, it shows
  `phax publish-pr`.
- Keep the existing run-command assertions green.
- Interrupt-handler messaging is hard to unit-test through signals; assert the
  message-building helper if one is extracted, otherwise cover via the run test's
  output expectations. Do not spawn real signals in unit tests.

### Implementation order

Wire `run.ts` first (primary path), then mirror in `resume.ts`, then add the
interrupt message.

### Excluded scope

- Changing exit codes or the pause/failure branches' wording.
- Reworking the `final-report.md` contents (only linking to it).

### Verification

- The project's configured `full` gate profile in `phax.json`.

### Expected handoff content

- Where the summary line, recap, and report pointer are printed and on which
  stream (stdout vs stderr).
- The interrupt message text and that it is written synchronously before exit.
- Any deviation from the planned file lists, with the reason.

### Commit subject

feat(run): show end-of-run recap and announce interrupts

### Commit body

On a successful run/resume, print a stdout summary, the enriched review recap
(PR link or publish-pr, open, shell, enter, archive), and a pointer to
final-report.md. Give Ctrl+C a voice: the interrupt handler now tells the user
the state was saved and how to resume. Covered by CLI output tests.
