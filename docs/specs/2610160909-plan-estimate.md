---
status: Draft
date: 2026-10-16
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Plan estimate — what a plan will cost, and whether it fits the subscription now

## 1. Context

The `cost-ledger` spec gives every run a ledger: one entry per Claude invocation (phase turn, fix attempt, handoff, compliance review) with its own API-list cost, tokens per model, agent duration and the rate-limit samples its stream reported — window (`five-hour`, `seven-day`), utilization, reset instant, and the run's cumulative cost at that point. Kept runs are backfilled.

A plan names, per phase, a model, an effort and its planned files (`### Planned files to create`, `### Planned files to edit`, `### Optional files that may be edited`). `phax plans lint` reads it with the deterministic parser, never the extraction model, and validates a plan under `docs/plans/` like any artifact (exit 12).

When a run exhausts a subscription window, phax pauses it as `rate_limited` and waits for a manual `phax resume`. A one-message `claude -p` call returns a `rate_limit_event` with the current utilization and reset instant of both windows.

The spike `spikes/plan-estimate/` (README and `phax_estimate.py`, standard library only) established on 533 historical phases: a run's cost is predictable within a median factor ×1.20–1.35 (phase level ×1.5) from each phase's model, effort and the byte size of its planned files, provided the prediction is made on token volume and then priced at the phase's model; on a Max 5x subscription one five-hour window holds ≈ $35–50 of API-list cost and a seven-day window ≈ $350–575; that capacity doubled in early September with no phax change; an Opus run burns ≈ $25–27 per agent hour, so the five-hour window is what usually stops a run. The routing catalog carries no prices.

## 2. Problem

Before `phax run`, the operator cannot tell what a plan will cost or whether it fits the windows left on their subscription. A run that does not fit stops mid-phase as `rate_limited` and breaks the autonomy runs are built for: someone has to notice and `phax resume` after the reset. Guessing in advance means converting a plan into dollars and dollars into window percentages by hand, with a capacity that changes without notice.

## 3. Product goal

Before a run, phax answers from this machine's own history: how much will this plan cost, phase by phase, with a range — and does it fit the subscription windows left right now, or when should it start instead.

> An estimate is a calibrated range read from this machine's own history, never a constant phax was told.

## 4. Terminology

- **API-list cost**, **cost ledger**, **rate-limit sample**, **window** — as in the `cost-ledger` spec.
- **Window rate** — API-list dollars per 1 % of a window, calibrated from rate-limit samples.
- **Estimate** — per phase and per run, the P10, P50 and P90 of API-list cost.
- **Burn rate** — API-list dollars per hour of agent time, from recent ledger entries.
- **Verdict** — `fits` (fits at P90), `risky` (fits at P50, not at P90), `wait` (does not fit at P50) or `no-subscription`.

## 5. Functional requirements

### 5.1 Plan estimate

WHEN `phax plans estimate <plan>` runs THE system SHALL report each phase's estimate and the run's estimate, each as P10, P50 and P90 of API-list cost.

### 5.2 Plan read without a model

The system shall read the plan with the deterministic parser `phax plans lint` uses, without any model invocation.

### 5.3 Estimate from history

The system shall derive each estimate from the cost ledgers on this machine, from the phase's effort and the size of its planned files in the working tree, weighting recent runs above older ones.

### 5.4 Priced at the phase's model

The system shall price each phase's predicted token volume at its own model's catalog list prices.

### 5.5 Run-level invocations

The system shall include in the run estimate the recent median API-list cost of the run-level invocations (compliance review) the project's configuration enables.

### 5.6 Phases on other providers

IF a phase is routed to a provider other than Claude Code THEN the system SHALL list it as not estimated and exclude it from the run estimate and the verdict.

### 5.7 Thin history

IF fewer than 60 historical phases are available THEN the system SHALL report no estimate and name the history size it found.

### 5.8 Current windows

WHEN `phax plans estimate` runs without `--no-probe` THE system SHALL read the current utilization and reset instant of both windows with one minimal Claude invocation.

### 5.9 Last observed windows

WHERE `--no-probe` is given THE system SHALL use the most recent rate-limit sample in the ledgers, state its age, and treat a window whose reset instant has passed as empty.

### 5.10 Window calibration

The system shall calibrate each window rate from the rate-limit samples of the last 28 days and report it as a full-window dollar capacity.

### 5.11 Verdict

WHEN an estimate and both windows are available THE system SHALL play the phases forward at the burn rate, at P50 and at P90, and report the verdict with, for each pause it predicts, the phase, the window and the instant it resets.

### 5.12 No subscription

IF the probe reports no subscription window THEN the system SHALL report the estimate alone with the verdict `no-subscription`.

### 5.13 Report, not gate

The system shall exit `phax plans estimate` with 0 whatever the verdict, and with 12 for a plan that fails artifact validation, as `phax plans lint` does.

## 6. Surface

New command (command and flags normative; layout, column widths and wording indicative):

```
$ phax plans estimate docs/plans/2610150921-artifact-decide-plan.md
History: 410 phases, sized by planned-file bytes, recent runs weighted (half-life 30d)

phase      model              effort      P10      P50      P90
phase-01   claude-opus-5-5    high       4.50     7.83    15.14
phase-02   claude-opus-5-5    high       4.23     7.12    14.02
phase-03   claude-opus-5-5    high       4.53     7.80    15.24
phase-04   claude-sonnet-5-5  medium     0.67     1.10     2.13
run-level  compliance review              0.54     0.54     0.54
run        API-list $                    19.38    26.94    39.47
Not estimated: plan extraction, plan auditor, interactive code review.

Subscription (probe):
  five-hour  15% used, resets Fri 16 Oct 14:50   ≈ $37/window, $31 left
  seven-day  29% used, resets Sun 18 Oct 17:00   ≈ $534/window, $379 left

P50: fits — agent time ends ≈ 12:04
P90: five-hour exhausted in phase-03 ≈ 12:22, resumes 14:50
Verdict: risky — fits at P50, a pause is possible at P90
$? = 0
```

Flags (normative): `--json`, `--no-probe`. `--json` (field names and `verdict` values normative):

```json
{
  "phases": [{ "id": "phase-01", "provider": "claude-code", "model": "claude-opus-5-5", "effort": "high",
               "estimate": { "p10": 4.50, "p50": 7.83, "p90": 15.14 } }],
  "run": { "p10": 19.38, "p50": 26.94, "p90": 39.47, "runLevel": 0.54 },
  "notEstimated": ["plan-extraction", "plan-auditor", "interactive-code-review"],
  "windows": {
    "source": "probe",
    "fiveHour": { "utilization": 15, "resetsAt": "2026-10-16T12:50:00Z", "capacityUsd": 37 },
    "sevenDay": { "utilization": 29, "resetsAt": "2026-10-18T15:00:00Z", "capacityUsd": 534 }
  },
  "verdict": "risky",
  "scenarios": {
    "p50": { "pauses": [] },
    "p90": { "pauses": [{ "phase": "phase-03", "window": "five-hour", "at": "2026-10-16T10:22:00Z",
                          "resumesAt": "2026-10-16T12:50:00Z" }] }
  }
}
```

`verdict` is one of `fits`, `risky`, `wait`, `no-subscription`; `windows.source` is `probe` or `last-sample`.

Routing catalog, a model entry before → after (field spelling indicative; presence normative per §5.4; required on every Claude entry):

```json
{ "id": "claude-opus-5-5", "efforts": ["low", "medium", "high", "xhigh", "max", "ultracode"], "status": "active" }
```
```json
{ "id": "claude-opus-5-5", "efforts": ["low", "medium", "high", "xhigh", "max", "ultracode"], "status": "active",
  "price": { "inputPerMTok": 4, "outputPerMTok": 20, "cacheReadPerMTok": 0.2, "cacheWrite1hPerMTok": 8 } }
```

## 7. Non-goals

- Recording costs — the `cost-ledger` spec.
- Gating `phax run` on the verdict, or showing the estimate at run start; wiring it into the run is a later spec.
- Scheduling or delaying a run until a window resets.
- Estimating plan extraction, the plan auditor and the interactive code review.
- Estimating Codex or Mistral Vibe phases, and their own quotas.
- Converting API-list cost to what the operator pays (subscription, usage credits).
- Sharing history across machines.

## 8. Acceptance criteria

### A plan gets ranges

Given 400 historical phases, when `phax plans estimate <plan>` runs on a four-phase plan, then each phase and the run report P10 ≤ P50 ≤ P90. (refs §5.1)

### No model reads the plan

Given an Approved plan.md that was never extracted, when `phax plans estimate <plan>` runs, then the estimate is reported and no model invocation reads the plan. (refs §5.2)

### Bigger planned files cost more

Given two phases identical but for the byte size of their planned files to edit, when estimated, then the phase with the larger files has the larger P50. (refs §5.3)

### Recent runs weigh more

Given history whose phases cost twice as much in the last 30 days as before, when estimated, then the P50 is closer to the recent cost than to the older one. (refs §5.3)

### Each phase is priced at its own model

Given two phases identical but routed to `claude-opus-5-5` and `claude-sonnet-5-5`, when estimated, then their P50s differ in the ratio of those models' catalog prices for the history's token mix. (refs §5.4)

### Run-level cost is included

Given a project with the compliance review enabled, when estimated, then `run.runLevel` equals the recent median compliance-review cost and is included in the run estimate. (refs §5.5)

### Other providers are listed, not estimated

Given a plan whose phase-02 is routed to `codex-cli`, when estimated, then phase-02 is listed as not estimated and the run estimate and verdict omit it. (refs §5.6)

### Thin history refuses to guess

Given 12 historical phases, when estimated, then no estimate is printed, the output names the 12 phases found, and `$?` is 0. (refs §5.7)

### The probe reads both windows

Given a subscription at 15 % of the five-hour window and 29 % of the seven-day window, when estimated without `--no-probe`, then `windows.source` is `probe` and both utilizations and reset instants are reported. (refs §5.8)

### `--no-probe` states its age

Given a last rate-limit sample 90 minutes old whose five-hour reset has passed, when estimated with `--no-probe`, then `windows.source` is `last-sample`, its age is stated and the five-hour utilization is 0. (refs §5.9)

### Capacity is calibrated, not configured

Given ledgers whose samples in the last 28 days show $40 of API-list cost per 100 % of the five-hour window, and older samples showing $18, when estimated, then `windows.fiveHour.capacityUsd` is 40. (refs §5.10)

### Verdicts

Given $31 left in the five-hour window, when a plan estimates P50 $27 and P90 $39, then `verdict` is `risky` and the P90 scenario names the phase, `five-hour` and the reset instant; when P90 is under $31, `verdict` is `fits`; when P50 is over $31, `verdict` is `wait`. (refs §5.11)

### No subscription

Given API-key authentication, whose probe reports no window, when estimated, then the estimate is reported and `verdict` is `no-subscription`. (refs §5.12)

### Exit codes

Given a `wait` verdict, when estimated, then `$?` is 0; given a plan under `docs/plans/` with an off-grammar name, then `$?` is 12. (refs §5.13)

## 9. Open questions for implementation planning

### Q1 — Where list prices come from

- A — the routing catalog carries each Claude model's list prices — abandons: prices maintained by phax; a stale catalog misprices until refreshed.
- B — only the costs Claude Code reported in the ledgers — abandons: estimating a model with no history, the case of every newly released model.

Recommendation: A — the catalog is already refreshed with each model release (`pnpm gen:model-catalog`); B cannot price the model a plan most often picks first.

### Q2 — Reading the windows by default

- A — probe by default, `--no-probe` to opt out — abandons: a free, offline report; each estimate spends one minimal request (≈ $0.02 API-list) against the window it measures.
- B — last recorded sample by default, `--probe` to opt in — abandons: knowing the windows now; interactive use since the last run is invisible, and the verdict errs on the side that pauses runs.

Recommendation: A — a verdict on stale windows is the failure this command exists to prevent.

### Q3 — Exit code on a `wait` verdict

- A — always 0, verdict in the output and `--json` — abandons: gating a script on the exit code alone.
- B — non-zero on `wait` — abandons: the rule that a report exits 0 (`plans status`), for a probabilistic answer.

Recommendation: A — gating `phax run` is a later spec (§7); until then `--json` serves scripts.

## 10. Implementation-planning note

Settled: the estimate is a range from this machine's cost ledgers, predicted on token volume and priced per model from the catalog; window capacity is recalibrated from ledger samples on every call; the verdict is a report. Depends on the `cost-ledger` spec: its ledgers and backfill must land first. The spike in `spikes/plan-estimate/` is the reference behavior and its backtest the yardstick: on recent runs the run-level median error must stay within ×1.35 against held-out runs. Left open: the regression's exact features and weighting, the burn-rate window, the probe model. Constraints: catalog prices are required on every Claude entry, with no optional fallback; the plan is read by the deterministic parser, never the extraction model; the probe goes through the provider port like every invocation.

## 11. Docs page

Page: docs/plan-estimate.md

Reader: An operator on a Claude Max subscription deciding whether to start a run now or after the next window reset, and what it will cost.

Example:
```
phax cost backfill
phax plans estimate docs/plans/2610150921-artifact-decide-plan.md
phax plans estimate docs/plans/2610150921-artifact-decide-plan.md --no-probe --json | jq .verdict
```
