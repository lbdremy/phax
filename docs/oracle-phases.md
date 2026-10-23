# Oracle phases

An oracle phase writes the tests that a later phase has to satisfy. phax judges the two apart: when the oracle phase finishes, a provider you configure checks that the tests are marked as expected failures; when the next phase finishes, the provider checks that the only thing that changed in them is the removal of those marks. A test the code cannot pass unchanged is not rewritten to fit: the run pauses and the disagreement goes back to the spec. This page is for the repository owner who configures an `oracles` provider, and for the planner who writes an oracle-first plan.

phax itself knows no test framework, no marker and no test-file convention. The provider does.

## Configure a provider

Add an `oracles` key to `phax.json`, `phax.local.json` or `~/.phax/config.json`; the highest of the three layers that declares it wins:

```json
{
  "oracles": { "command": "node tools/vitest-oracles.mjs" }
}
```

`command` is split on spaces and run without a shell, in the phase worktree, with a fixed 120-second limit. The block holds `command` and nothing else. Without it, `phax plans lint` reports an error on the `oracles` check for every oracle phase, and `phax run` and `phax resume` refuse the plan with exit 11 ("Oracle preflight failed"). Neither spawns the provider.

The agent is never granted the provider. It runs only from phax, at the gate, so the agent learns a verdict from the fix prompt.

## The request

At the gate of an oracle phase and of the phase that discharges it, after every configured step passed, phax writes one JSON document to the provider's stdin and saves it as `checks-attempt-NN.oracle-request.json` beside the attempt's log. For the oracle phase (`authored`):

```json
{
  "$schema": "https://docs.phax.run/schemas/oracle-request/<release>.json",
  "verdict": "authored",
  "phase": "phase-02",
  "oraclePhase": "phase-02",
  "base": "3f2a91c…",
  "files": ["tests/refunds.test.ts"]
}
```

For the discharging phase (`discharged`) the document adds `oracleCommit`, the commit the oracle phase recorded:

```json
{
  "$schema": "https://docs.phax.run/schemas/oracle-request/<release>.json",
  "verdict": "discharged",
  "phase": "phase-03",
  "oraclePhase": "phase-02",
  "base": "3f2a91c…",
  "oracleCommit": "8be04d7…",
  "files": ["tests/refunds.test.ts"]
}
```

`base` is the oracle phase's base commit on both variants. Commits are full object names, and `files` holds the oracle files in declaration order. The provider reads the working tree, which is the phase's own, before the commit.

## The answer

The provider prints a `gate-report` on stdout, and phax judges it like any report step. The report is saved as `checks-attempt-NN.report-SS.json`, SS being the oracle step's position: the number of configured steps the attempt fires, plus one.

- **Pass.** Exit 0 with `"outcome": "checked"` and no finding.
- **Findings.** Any finding fails the step and goes to the fix prompt:

  ```json
  {
    "$schema": "https://docs.phax.run/schemas/gate-report/<release>.json",
    "outcome": "checked",
    "findings": [
      {
        "id": "oracle-changed:tests/refunds.test.ts:caps a refund at the invoice total",
        "rule": "After the oracle phase, only the expected-failure markers may change in an oracle file",
        "location": { "file": "tests/refunds.test.ts", "lines": [42, 42] },
        "message": "expect(refund.amount).toBe(120) became toBe(100) since the oracle commit",
        "related": [],
        "guide": null
      }
    ],
    "review": []
  }
  ```

- **Refusal.** `"outcome": "refused"` with a `reason` and a `remedy` stops the phase with no fix attempt and exits 4. `phax resume` runs the gate again. The next steps of a refused oracle step also name the `--skip-oracle` correction below.
- **Provider error.** A provider that cannot be spawned, runs past 120 seconds, or prints something that is not a `gate-report` with a `$schema` fails the step as a broken step.

phax records the step under the `oracle` surface in the phase's `gate-attribution.json`. A `phax.json` gate step cannot claim that surface.

## An example provider

[`examples/vitest-oracles/`](../examples/vitest-oracles/) is a Vitest provider that phax's own repository declares as `node examples/vitest-oracles/main.mjs`. It lives in the repository only: no package ships it, so copy it and adapt it to your runner.

- **`authored`.** Every test the oracle files add or modify since `base` must carry `.fails` and must run: a `skip`, `todo`, `only`, `skipIf` or `runIf` on the test or an enclosing `describe`, or a test with no function, is a finding, since such a test passes both verdicts and never judges the code. A deleted test and an unchanged test are never findings, and an oracle file that does not parse is one finding.
- **`discharged`.** No `.fails` is left in the oracle files, and each file's syntax tree, with its markers removed, equals its tree at `oracleCommit`. Removing the markers is the only change allowed; the finding for any other change names the first test that differs.

It compares syntax trees, not text, so reformatting, re-indenting, trailing commas, quote style and comments never change its answer. A request it cannot read is refused with a reason and a remedy.

## Write an oracle-first plan

Declare an oracle phase only when a provider is configured. In `plan.md`, phase-02 of an `acme-billing` plan carries two header lines after the model, effort and Assignment reason lines:

```markdown
## phase-02 — Refund oracles  {#phase-02-refund-oracles}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Oracle phase:** yes
**Oracle files:** tests/refunds.test.ts
```

`yes` means the next phase in plan order; `**Oracle phase:** discharged by phase-04` names it. The oracle files are a subset of the phase's planned files, so the phase may also plan a stub, such as `src/refunds/index.ts`, that is not an oracle. No phase in between plans an oracle file, an interactive phase may sit in between and takes no role, and one phase discharges one oracle phase. `phax plans lint` checks all of it.

phase-02 adds its tests with the framework's expected-failure marker, so the test command stays green:

```ts
test.fails("caps a refund at the invoice total", () => {
  expect(refund(invoice, 500).amount).toBe(120);
});
```

Each phase's prompt tells the agent its role in a fixed wording that names no framework: the oracle phase marks every test it adds or modifies and may delete tests; the discharging phase may only remove the markers and makes the code satisfy the tests as written.

phase-03 removes `.fails` and writes the refund cap. Its gate sends `discharged`, with phase-02's commit as `oracleCommit`. Had phase-03 changed `toBe(120)` to `toBe(100)`, the provider's finding above would drive the fix loop. The discharge may leave an oracle file untouched, for example when phase-02 only deleted tests, so reconciliation counts the oracle files as optional edits of the discharging phase.

## When an oracle cannot pass

An oracle that the code cannot satisfy unchanged is a spec question, not a bug to work around. The fix loop runs out on the failing oracle step, the run pauses at the discharging phase with exit 4, resumable at that phase, and the agent has been told to say so in its handoff. Send the disagreement back to the spec.

A committed oracle phase is not reset: `phax reset-phase` refuses an oracle phase while its discharging phase is in any state other than `pending`, and the state machine never resets a committed phase. When the oracle itself is wrong, correct it in the stopped phase and close the step with `phax resume <run> --skip-oracle`. That resume runs the phase's configured gate with the usual fix loop, runs no oracle step, and records the step as `skipped`. To review the oracles before their discharge instead, see [Reviewing oracles before the discharge](#reviewing-oracles-before-the-discharge).

For example, phase-03 of the `refunds` run exhausts its fix loop on the oracle step and the run pauses with exit 4. The person decides the oracle is wrong, edits it in the stopped phase's worktree, and resumes:

```bash
phax enter-phase refunds phase-03
phax resume refunds --yes --skip-oracle
```

phase-03's configured steps run and must pass. Its oracle step is recorded in `gate-attribution.json` as

```json
{ "command": "node tools/vitest-oracles.mjs", "surface": "oracle", "result": "skipped" }
```

and `oracle` is then not among phase-03's verified surfaces, nor the run's: the PR body does not claim an oracle that was not discharged. The handoff's `## Oracle pairs` table shows `skipped` in that side's cell.

- `--skip-oracle` applies only to the phase the resume restarts at, in this invocation. It never reaches a later phase, and it is not persisted.
- At a phase that is neither an oracle phase nor a discharging phase, the resume is refused with exit 1 and nothing changes, with or without `--yes`.
- It is an operator's choice. No agent prompt names it.

An oracle phase that produced no changes is skipped and notes no commit, so there is nothing to discharge. phax refuses its discharging phase before the agent runs, with exit 11, and the run fails; the message names a different recovery: archive the run and run a corrected plan. `--skip-oracle` does not apply: there is no commit to discharge.

## Reviewing oracles before the discharge

A person can read the oracles before the code is written against them. Two ways stop the run between the oracle phase and its discharge: `phax run --hold oracle`, which holds the plan's oracle phases after they commit, and a phase the plan declares `**Mode:** interactive` between the two. See [Interactive phases](../README.md#interactive-phases) for the stop itself; this section covers what changes inside a pair.

- **The `authored` re-run.** When the person's corrections at a stop change an oracle file of the pair the stop sits in, `phax resume` runs the oracles provider's `authored` verdict again as the last step of the closing gate, after every configured step passed. The request is the usual `oracle-request`, with `phase` naming the stopped phase, `oraclePhase` the oracle phase, and `files` the pair's oracle files. A finding goes to the person like any red gate (exit 4). Corrections that touch the oracle files of two pairs are refused, because one gate attempt carries one request, as is a gate step that writes an oracle file the corrections did not change.
- **`oracleCommit`.** The discharge judges the latest commit of the pair that passed `authored`: the review commit of the last stop in the pair whose close ran the step, or the oracle phase's own commit when none did. The request's `oracleCommit` names it.
- **A held discharge.** Holding the discharging phase stops it after it passed its own `discharged` verdict. Its close runs the configured steps only, with no oracle step. For each oracle file its corrections changed, it warns that the discharge was judged before the stop and that the oracles provider does not see the change, and records the files in the close's trace. It refuses nothing.
- **Reset.** `phax reset-phase` refuses a phase whose closed stop ran the `authored` step once the pair's discharge has started, as it does the oracle phase itself, because the discharge judges that commit.
- **`--skip-oracle`.** `phax resume --skip-oracle` on a run awaiting review at a stop in a pair exits 1: a close's `authored` step is never skipped. At a stop in no pair it exits 1 too, because that phase has no oracle step. When the oracles provider is broken, undo the correction to the oracle file, or `phax reset-phase` the stop.

For example, `phax run --hold oracle` on the `refunds` run stops after phase-02. The person tightens `tests/refunds.test.ts`, then `phax resume refunds` gates the worktree, runs `authored` on the change, leaves one review commit with a `Held-Phase: phase-02` trailer, and starts phase-03. Its `discharged` request names that review commit as `oracleCommit`.

## What you see afterwards

- The review handoff lists every pair under `## Oracle pairs`, with the last oracle-step result of each side.
- `phax records explain <sha>` prints the phase's oracle role, its counterpart and that result; `--gates` lists the saved oracle request after the attempt's request.
- `phax --usage` and the [CLI reference](cli/reference.md) describe the step contract.
