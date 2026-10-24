# Estimating a plan

Before you start a run on a Claude Max subscription, two questions matter: what will it cost, and will it stop halfway because a window ran out? `phax plans estimate` answers both from what this machine already knows. No model reads the plan.

```bash
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

Runs made before phax kept ledgers have none. `phax plans estimate` first writes one for every kept run that has none, from the Claude streams the run kept, exactly as `phax cost backfill` does, and says on stderr how many it wrote. A run locked by a live `phax run` is skipped and counted among the kept runs still without a ledger. `phax cost backfill` stays available to do the same by hand.

The estimate is a regression fitted on this repository's own kept runs: each historical phase is sized by the bytes of the files it planned to edit, the bytes of its optional files and the number of files it planned to create, at its effort. Recent runs weigh more; a run's weight halves every 30 days. Every reachable ledger, from every repository and from pruned runs, still feeds the window capacity and the burn rate.

## The 60-phase minimum

An estimate needs at least 60 sized phases from this repository. Below that the verdict is `thin-history`, the report says how many phases it has, and no table is printed. The windows are still read and shown. A new repository gets its first estimate once it has run enough phases of its own.

## Reading the table

Each row is a phase, priced at the model routing actually picks for it on this machine. P10, P50 and P90 are in **API-list dollars**: what the same tokens would cost at Claude's list prices. That is not what your subscription bills; it is the yardstick the windows are measured in.

P50 is the middle outcome; one phase in ten costs less than P10, and one in ten more than P90. The `run-level` row is the compliance review, when it is enabled and routed to Claude Code. The `run` row is the whole run's range. It is not the sum of the phase rows: phases rarely all land at P90 together.

## Interactive phases

A phase the plan declares interactive (`**Mode:** interactive`) has no agent building it: phax runs a read-only first turn and, when you resume, a read-only closing turn. The estimate sizes those turns alone, and your time at the stop is not in it. A hold (`phax run --hold`) belongs to a run, not to the plan, so the estimate never sizes one and does not mention it.

An interactive phase is sized from past interactive phases of this repository that have at least one first-turn or closing-turn entry in their ledger and whose turns cost at least the minimum a headless sample needs. That keeps out codex and mistral-vibe phases, which cost nothing in a ledger that covers Claude Code only, and a first turn that started no session. It needs at least 3 such samples. Each sample's tokens are repriced at the phase's own model, weighted by recency (half-life 30 days), and read at P10, P50 and P90.

- **Its own row.** The phase appears in the table at its place in the plan, and `--json` carries `mode: "interactive"` on it. A line below the table says so.
- **The run range.** The run's P10, P50 and P90 add the interactive phases' figures, quantile by quantile, to the fitted range of the headless phases and the run level. Adding quantiles treats the turns as fully correlated, which widens the range a little.
- **The scenarios.** Each interactive phase spends its own P50 or P90 at its place in the plan. The headless phases share what is left of the run's figure, and the run level stays on the last phase.
- **Few samples.** With 3 samples, P10 and P90 are the minimum and the maximum, unless one sample is much older than the others and weighs less. Past that, the quantiles interpolate between samples.
- **Not estimated.** A phase with fewer than 3 samples is named in the `Not estimated:` line as `too few past interactive phases`; one on another provider is `other-provider`; one on a model with no list price is `no-list-price`.
- **The fit leaves turn costs out.** The regression behind the headless rows is trained on `phase`, `fix` and `handoff` entries only, so neither a closing turn nor a turn-only phase distorts it. Below the 60-phase minimum no phase is listed, interactive ones included.

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
| `thin-history` | Fewer than 60 sized phases from this repository. | Keep running plans until the history grows. |
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
- `1` — a plan the deterministic parser cannot read (run `phax plans lint` for every finding);
- `2` — an invalid `phax.json`, `model-routing.json` or `providers.json`;
- `10` — a corrupt run registry;
- `12` — a plan under `docs/plans/` that fails artifact validation.
