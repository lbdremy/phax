# Idea: the code review as a plan — `review-code --headless` and `run --append`

> Status: **brainstorm**. Captured 2026-09-22 from the steme roadmap-1.0 conductor
> design, revised the same day — not a spec, not a plan. Nothing below is committed.
> Additive to the CLI; `run --append` is a new run transition and deserves a small spec
> of its own. Related: [`autopilot.md`](./autopilot.md) (the loop that needs it),
> [`change-gates-from-the-harness.md`](./change-gates-from-the-harness.md) (the
> oracle-separation lint this makes applicable), `review-compliance` (the shape to copy).

## Why

`review-code` opens an interactive, pre-prompted session for a developer to take over.
A loop has no developer. Two first ideas were wrong in instructive ways:

- *Print the prompt and hand it to a headless agent* — takes the review **out** of phax:
  no run directory, no records, no resumable session, findings as free text.
- *Resume the review session with "fix everything above `info`"* — keeps the session but
  lets changes **into the run without passing through phases**: no gate of their own, no
  handoff, no reconciliation, and a session free to edit the test that judges it. The
  `review_open` state accepts manual fixes as ordinary commits; a loop should not use
  that door.

The correction that comes out of a review should go through the same machinery as the
implementation: phases, gates, records, compliance. So the review produces a **plan**.

## Shape

- **`phax review-code <run> --headless`** — runs the same review in the run's worktree,
  with the same session record, without a terminal, and writes two artifacts under the
  run directory:

  - `code-review.json`, on the model of `complianceReview`:

    ```json
    { "version": 1,
      "findings": [
        { "severity": "bug" | "deviation" | "concern" | "info",
          "file": "src/…", "line": 42,
          "message": "…", "suggestion": "…" }
      ] }
    ```

    `deviation` is a departure from the spec or plan; `concern` a risk, a missing test,
    a security point; `info` style. A malformed or missing document is a provider error.

  - `review-plan.json` **and** its rendering `review-plan.md`: a plan covering every
    finding of severity `deviation` or above (`info` goes to a handoff note), declaring
    the run's source spec as its source and `code-review.json` as its ground, and passing
    `plans lint` — including, once it exists, the oracle-separation lint: a fix phase may
    not touch a file and its oracle together.

  **The agent emits JSON only**, validated against the schemas (`code-review.json`, and
  the plan directly in the `phax-plan.json` shape the extractor would have produced).
  phax materialises the artifacts deterministically: renders `review-plan.md` from the
  JSON (a rendering, never a prose the agent wrote), commits both under the run
  directory, writes them into the records, and **seeds the content-addressed extraction
  cache with the plan JSON** — so `run --append` never re-extracts the plan through a
  model. Zero model calls between the review and the run.

- **`phax run --append <run> review-plan.md`** — executes that plan **as a continuation
  of the same run**: phases numbered after the existing ones, each worktree branched from
  the last phase's branch, same run id, same records lineage, `review-handoff.md` and the
  global file reconciliation regenerated over the whole range, one PR. This is a new run
  transition (`review_open` → `running` with appended phases), which is why it is a small
  spec rather than a flag. Approval of the appended plan follows whatever policy approves
  plans (a loop's machine approval is recorded as such).

One call is one pass; the caller bounds the passes (the steme conductor: two). **Both
reviews run again after every append**, in this order: compliance over the whole run
(original plan *and* review plan, since the handoff and reconciliation now cover the
appended phases), then the headless code review with the compliance verdict in its brief,
then a new plan only if non-`info` findings remain — compliance `deviation` findings
included, they share the severity schema. A `divergent` compliance verdict emits no plan:
the run drifted from its plan, and fixing code would chase the wrong target; the caller
decides (the steme conductor blocks the item and escalates).

## Configuration: symmetric with compliance

`phax.json` already has `review.compliance.enabled` (with `model`, `effort`) and
`review.code` with only `model` and `effort`. Two optional keys complete the symmetry,
kept apart because they answer different questions:

```jsonc
"review": {
  "compliance": { "enabled": true },
  "code": {
    "enabled": true,        // run the headless review at the end of the run;
                            // the run stays review_open with its two artifacts
    "append": true,         // approve and run review-plan.md without intervention…
    "maxPasses": 2,         // …at most this many times (re-review after each)
    "model": "…", "effort": "high"
  }
}
```

Defaults: `enabled: false`, `append: false`. A hand-driven run with `enabled` alone gets
the findings and the plan and keeps the decision; a loop sets both. Optional keys, so
the `version: 1` stability promise for `phax.json` is untouched. The interactive
`review-code` is unaffected by either.

## Same PR, not a stacked one

Considered and set aside: opening a second PR based on the first (stacked). What it would
buy — an isolated, attributable diff for the correction — phax already gives per phase
(`records explain`, one commit per phase). What it would cost: two merges in order, two CI
runs, a review split in two, and a loop that must reason about PR order. GitHub's stacking
support is thin. It becomes worth revisiting when a team must approve the correction
separately from the implementation, i.e. with the multi-human decision queue.

## Notes

- Mirrors `review-compliance`, which is already non-mutating and structured.
- The interactive command is unchanged; `--headless` is a second entry point over the
  same session. `--append` lives on `run`.
- In a trajectory UI, appended phases show after the original ones with their origin
  (`from review`) — the timeline tells "what the review changed" without a second PR.
- Open: how a decision request raised inside an appended phase is attributed; whether
  `info` findings accumulate across passes. (Decided above: no plan on a `divergent`
  compliance verdict.)
