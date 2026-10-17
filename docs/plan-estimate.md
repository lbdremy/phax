# Estimating a plan

Before you start a run on a Claude Max subscription, two questions matter: what will it cost, and will it stop halfway because a window ran out? `phax plans estimate` answers both from what this machine already knows. No model reads the plan.

```bash
phax cost backfill
phax plans estimate docs/plans/2610201000-greet-plan.md
phax plans estimate docs/plans/2610201000-greet-plan.md --no-probe --json | jq .verdict
```

A report looks like this (every number here is made up):

```
History: 410 phases, sized by planned-file bytes, recent runs weighted (half-life 30d)

phase      model              effort    P10    P50    P90
phase-01   claude-opus-5-5    high     4.50   7.83  15.14
phase-02   claude-opus-5-5    high     4.23   7.12  14.02
phase-03   claude-opus-5-5    high     4.53   7.80  15.24
phase-04   claude-sonnet-5-5  medium   0.67   1.10   2.13
run-level  compliance review           0.54   0.54   0.54
run        API-list $                 19.38  26.94  39.47
Not estimated: plan extraction, plan auditor, interactive code review.

Subscription (probe):
  five-hour  15% used, resets Fri 16 Oct 14:50   ≈ $37/window, $31 left
  seven-day  29% used, resets Sun 18 Oct 17:00   ≈ $534/window, $379 left

P50: fits — agent time ends ≈ 12:04
P90: five-hour exhausted in phase-03 ≈ 12:22, resumes 14:50
Verdict: risky — fits at P50, a pause is possible at P90
```

## Where the history comes from

Every run keeps a cost ledger, `cost-ledger.json` in its run folder: one entry per Claude invocation, with its own API-list cost, its tokens per model, how long the agent worked, when it ended, and the subscription-window samples Claude Code reported. `phax prune` keeps a copy of each pruned run's ledger under `~/.phax/cost-ledgers/`.

Runs made before phax kept ledgers have none. `phax cost backfill` writes one for every kept run that still has its Claude streams, so run it first. The report counts the kept runs still without a ledger and suggests the backfill when there are any.

The estimate is a regression fitted on this repository's own kept runs: each historical phase is sized by the bytes of the files it planned to edit, the bytes of its optional files and the number of files it planned to create, at its effort. Recent runs weigh more; a run's weight halves every 30 days. Every reachable ledger, from every repository and from pruned runs, still feeds the window capacity and the burn rate.

## The 60-phase minimum

An estimate needs at least 60 sized phases from this repository. Below that the verdict is `thin-history`, the report says how many phases it has, and no table is printed. The windows are still read and shown. A new repository gets its first estimate once it has run enough phases of its own.

## Reading the table

Each row is a phase, priced at the model routing actually picks for it on this machine. P10, P50 and P90 are in **API-list dollars**: what the same tokens would cost at Claude's list prices. That is not what your subscription bills; it is the yardstick the windows are measured in.

P50 is the middle outcome; one phase in ten costs less than P10, and one in ten more than P90. The `run-level` row is the compliance review, when it is enabled and routed to Claude Code. The `run` row is the whole run's range. It is not the sum of the phase rows: phases rarely all land at P90 together.

## How the windows are read

By default, phax sends Claude Code one minimal probe: the fixed prompt `Reply with: ok`, on the cheapest Claude model, at low effort, from a temporary directory. The probe never sees the plan. It spends one small request, and Claude Code reports both windows, five-hour and seven-day, in its rate-limit event.

phax never reads Claude Code's credentials, its Keychain item or its OAuth usage endpoint. Claude Code authenticates the probe itself. If it is signed in with an API key rather than a subscription, there are no windows, and the verdict is `no-subscription`.

### `--no-probe`

`--no-probe` spends no request: phax uses the last rate-limit sample in your cost ledgers instead. The report says how old it is, `Subscription (last sample, 42 min old — usage since then is not counted)`. Whatever you used since that sample, in a run or interactively, is not in the numbers, so an old sample flatters the windows.

## Window capacity

Claude Code reports a window as a percentage used, not in dollars. phax converts it: over the ledgers of the last 28 days, it compares how much API-list cost each Claude Code invocation ran while the window's percentage rose, giving `≈ $37/window` in the example. `$31 left` is that capacity times what remains of the window.

The capacity is recalibrated on every estimate, so it follows your plan tier. A window with no usable samples in the last 28 days is shown as `not calibrated`. Interactive use during a run makes the percentage rise faster than the run's cost alone explains, so the capacity errs low and the forecast leans towards predicting a pause.

The forecast plays both the P50 and the P90 run forward from now, at your recent burn rate (API-list dollars per agent hour over the last 30 days), and notes when a window would run out and when it resets.

## Verdicts

| Verdict | Meaning | What to do |
| --- | --- | --- |
| `fits` | No pause, even at P90. | Start the run. |
| `risky` | Fits at P50; at P90 a window may run out. | Start now and accept a possible pause, or start after the named reset. |
| `wait` | A window runs out even at P50. | Start after the reset the P50 line names. |
| `thin-history` | Fewer than 60 sized phases from this repository. | Run `phax cost backfill`; otherwise keep running plans until the history grows. |
| `no-subscription` | Claude Code uses an API key: no windows to fit. | Read the estimate; there is no window to wait for. |
| `windows-unavailable` | The windows could not be read; the reason is given. | Retry, or use `--no-probe` to read the last sample. |
| `uncalibrated` | A window's capacity or the burn rate had no recent samples. | Read the estimate; the verdict returns once recent runs have ledgers. |

The verdict is a report, not a gate: `phax run` does not read it.

## What is not estimated

- plan extraction, the plan auditor and the interactive code review (`phax review-code`), whose streams are not in the ledgers;
- phases routed to OpenAI Codex or Mistral Vibe, and their quotas;
- a phase on a Claude model with no list price (one you added to providers.json);
- the compliance review, when it is routed to another provider or the history holds none.

A phase left out is named in the `Not estimated:` line with its reason, and left out of the run total and the verdict.

## Exit codes

- `0` — a report, whatever the verdict;
- `1` — a configuration error, or a plan the deterministic parser cannot read (run `phax plans lint` for every finding);
- `12` — a plan under `docs/plans/` that fails artifact validation.
