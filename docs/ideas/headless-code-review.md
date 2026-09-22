# Idea: headless code review — `review-code --headless` and `--apply`

> Status: **brainstorm**. Captured 2026-09-22 from the steme roadmap-1.0 conductor
> design — not a spec, not a plan. Nothing below is committed. Two additive flags on an
> existing command; the CLI contract freeze for 1.0 (`NEXT_STEPS.md`) is not touched.
> Related: [`autopilot.md`](./autopilot.md) (the loop that needs it), `review-compliance`
> (the shape to copy).

## Why

`review-code` opens an interactive, pre-prompted session for a developer to take over.
A loop has no developer. The first idea was to print the prompt and hand it to a
headless `claude -p`; that takes the review *out* of phax — no run directory, no
records, no resumable session, and findings as free text. Better to keep the session
phax's and make its output data.

## Shape

- **`phax review-code <run> --headless`** — runs the same review in the run's worktree,
  with the same session record, without a terminal, and writes
  `code-review.json` under the run directory. The session stays resumable, exactly as the
  interactive one is. Schema on the model of `complianceReview`:

  ```json
  { "version": 1,
    "findings": [
      { "severity": "bug" | "deviation" | "concern" | "info",
        "file": "src/…", "line": 42,
        "message": "…", "suggestion": "…" }
    ] }
  ```

  `deviation` is a departure from the spec or plan; `concern` is a risk, a missing
  test, a security point; `info` is style. A malformed or missing document is a
  provider error, as for compliance.

- **`phax review-code <run> --apply --min-severity <s>`** — resumes that session with
  one instruction: fix every finding of severity ≥ `s`, nothing else. Then re-runs the
  gate profile on the final worktree and commits (the run is `review_open`, where
  manual fixes already land). One call is one pass; the caller bounds the passes and
  re-runs `--headless` after each to observe.

## Notes

- Mirrors `review-compliance`, which is already non-mutating and structured.
- The interactive command is unchanged; `--headless` and `--apply` are the two new
  entry points over the same session.
- Open: whether `--apply` should refuse when compliance is `divergent` (the fix would
  be chasing the wrong target), and whether `info` findings get written to a handoff
  note instead of being dropped.
