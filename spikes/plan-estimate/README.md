# Plan cost and subscription-fit spike

Standalone harness for the question `phax plans estimate` would answer: **what will this
plan cost on Claude, and will it fit the current Max subscription windows, or should the
run wait for a reset?** Python 3, standard library only; reads `~/.phax`, writes nothing.

```sh
# a plan before extraction (or its phax-plan.json)
python3 spikes/plan-estimate/phax_estimate.py docs/plans/<plan>.md

# backtest a plan that already ran: its run is left out of the history, actual cost is shown
python3 spikes/plan-estimate/phax_estimate.py docs/plans/<plan>.md --exclude-run phax.<short-name>

# no live probe (reuses the last rate_limit_event phax recorded; stale by design)
python3 spikes/plan-estimate/phax_estimate.py docs/plans/<plan>.md --no-probe

# machine-readable
python3 spikes/plan-estimate/phax_estimate.py docs/plans/<plan>.md --json
```

The default run makes **one tiny `claude -p` call** (Haiku, about $0.02 API-equivalent)
to read the current five-hour and seven-day utilisation.

## What it relies on

- **Cost history.** Every `claude -p` stream phax keeps (`phase-NN/output.jsonl`,
  `fix-attempt-NN.jsonl`, `handoff-generation.jsonl`, `compliance-review.session.jsonl`)
  ends with a `result` event whose `modelUsage[*].costUSD` is the API list price
  (`costBasis: "list"`; checked to the cent against the token counts).
- **Resumed sessions are cumulative.** From Claude Code 2.1.280 (2.1.267 was not), a
  `--resume` invocation reports `total_cost_usd` and `modelUsage` for the whole session,
  while `usage` stays per invocation. Summing naively over-counts by about 29 %; the
  script takes the delta against the previous invocation of the same session.
- **Estimation.** `log(token volume at a reference price) ~ effort + planned-file sizes`
  (bytes of `plannedFilesToEdit` / `optionalFilesToEdit` at the commit the run started
  from, count of files to create), weighted towards recent runs (half-life 30 days), then
  repriced at each phase's own model. Ranges come from resampled residuals.
- **Subscription windows.** Each stream carries `rate_limit_event`s with
  `unifiedWindows.five_hour` / `seven_day` utilisation and `resetsAt`. Interleaved with
  assistant messages of known cost, they calibrate API dollars per 1 % of each window.
- **Verdict.** Phases are played forward at the observed agent burn rate ($/agent-hour);
  a window that would run out pauses the run until its reset (what phax does today:
  `rate_limited`, then a manual `phax resume`).

## Findings so far (2026-10-16, Max 5x)

- Backtest error, run level, recent runs: median ×1.20 with file sizes (×1.32 with
  model + effort only); phase level stays around ×1.5. Bias within ±10 %.
- `artifact-decide` left out of the history: P50 $26.94 (P10–P90 $19–39), actual $29.57.
- Five-hour window ≈ $35–50 API-equivalent; it was ≈ $18 the week of 31 August, before
  Anthropic doubled the five-hour limits — the calibration must stay continuous.
- Seven-day window ≈ $350–575, noisier (1 % granularity).
- A run on Opus 5.5 burns ≈ $25–27 per agent hour, so the five-hour window, not the
  weekly one, is usually what stops a run.

## Not covered

- Interactive use outside phax draws on the same windows; the probe sees it, the forward
  play does not.
- Plan extraction, the plan auditor (`backend.complete()` keeps no stream) and the
  interactive code review (only its session id is kept) are missing from the history.
- Gate time is not in the burn rate (agent time only), so pauses are predicted slightly early.
- Per-model quota weighting is assumed proportional to API price; Sonnet data is too thin
  to confirm it.
