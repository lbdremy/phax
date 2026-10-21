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

## Write an oracle-first plan

Declare an oracle phase only when a provider is configured. In `plan.md`, phase-02 of an `acme-billing` plan carries two header lines after the model, effort and Assignment reason lines:

```markdown
## phase-02 — Refund oracles  {#phase-02-refund-oracles}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Oracle phase:** yes
**Oracle files:** tests/refunds.test.ts
```

`yes` means the next phase in plan order; `**Oracle phase:** discharged by phase-04` names it. The oracle files are a subset of the phase's planned files, so the phase may also plan a stub, such as `src/refunds/index.ts`, that is not an oracle. No phase in between plans an oracle file, no interactive phase sits in between or takes a role, and one phase discharges one oracle phase. `phax plans lint` checks all of it.

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

A committed oracle phase is not reset: `phax reset-phase` refuses an oracle phase while its discharging phase is in any state other than `pending`, and the state machine never resets a committed phase. When the oracle itself is wrong, correct it in the stopped phase and close the step with `phax resume <run> --skip-oracle`. That resume runs the phase's configured gate with the usual fix loop, runs no oracle step, and records the step as `skipped`. `--hold oracle`, coming with interactive phases, will let a person review the oracles before their discharge.

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

An oracle phase that produced no changes is skipped and notes no commit, so there is nothing to discharge. phax refuses its discharging phase before the agent runs, with exit 11, and the run fails; the message names the same recovery: archive the run and run a corrected plan. `--skip-oracle` does not apply: there is no commit to discharge.

## What you see afterwards

- The review handoff lists every pair under `## Oracle pairs`, with the last oracle-step result of each side.
- `phax records explain <sha>` prints the phase's oracle role, its counterpart and that result; `--gates` lists the saved oracle request after the attempt's request.
- `phax --usage` and the [CLI reference](cli/reference.md) describe the step contract.
