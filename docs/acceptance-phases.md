# Acceptance phases

An acceptance phase writes the tests that a later phase has to pass. phax judges the two apart: when the acceptance phase finishes, a provider you configure checks that the tests are marked as expected failures; when the next phase, the passing phase, finishes, the provider checks that the only thing that changed in them is the removal of those marks. A test the code cannot pass unchanged is not rewritten to fit: the run pauses and the disagreement goes back to the spec. This page is for the repository owner who configures an `acceptance` provider, and for the planner who writes an acceptance-first plan.

phax itself knows no test framework, no marker and no test-file convention. The provider does.

## Configure a provider

Add an `acceptance` key to `phax.json`, `phax.local.json` or `~/.phax/config.json`; the highest of the three layers that declares it wins:

```json
{
  "acceptance": { "command": "node scripts/acceptance-verdicts.mjs" }
}
```

`command` is split on spaces and run without a shell, in the phase worktree, with a fixed 120-second limit. The block holds `command` and nothing else. Without it, `phax plans lint` reports an error on the `acceptance` check for every acceptance phase, and `phax run` and `phax resume` refuse the plan with exit 11 ("Acceptance preflight failed"). Neither spawns the provider.

The agent is never granted the provider. It runs only from phax, at the gate, so the agent learns a verdict from the fix prompt.

## The request

At the gate of an acceptance phase and of the phase that passes it, after every configured step passed, phax writes one JSON document to the provider's stdin and saves it as `checks-attempt-NN.acceptance-request.json` beside the attempt's log. For the acceptance phase (`authored`):

```json
{
  "$schema": "https://docs.phax.run/schemas/acceptance-request/<release>.json",
  "verdict": "authored",
  "phase": "phase-02",
  "acceptancePhase": "phase-02",
  "base": "3f2a91c…",
  "files": ["tests/refunds.test.ts"]
}
```

For the passing phase (`passed`) the document adds `acceptanceCommit`, the commit the acceptance phase recorded:

```json
{
  "$schema": "https://docs.phax.run/schemas/acceptance-request/<release>.json",
  "verdict": "passed",
  "phase": "phase-03",
  "acceptancePhase": "phase-02",
  "base": "3f2a91c…",
  "acceptanceCommit": "8be04d7…",
  "files": ["tests/refunds.test.ts"]
}
```

`base` is the acceptance phase's base commit on both variants. Commits are full object names, and `files` holds the acceptance test files in declaration order. The provider reads the working tree, which is the phase's own, before the commit.

## The answer

The provider prints a `gate-report` on stdout, and phax judges it like any report step. The report is saved as `checks-attempt-NN.report-SS.json`, SS being the acceptance step's position: the number of configured steps the attempt fires, plus one.

- **Pass.** Exit 0 with `"outcome": "checked"` and no finding.
- **Findings.** Any finding fails the step and goes to the fix prompt:

  ```json
  {
    "$schema": "https://docs.phax.run/schemas/gate-report/<release>.json",
    "outcome": "checked",
    "findings": [
      {
        "id": "acceptance-changed:tests/refunds.test.ts:caps a refund at the invoice total",
        "rule": "After the acceptance phase, only the expected-failure markers may change in an acceptance test file",
        "location": { "file": "tests/refunds.test.ts", "lines": [42, 42] },
        "message": "expect(refund.amount).toBe(120) became toBe(100) since the acceptance commit",
        "related": [],
        "guide": null
      }
    ],
    "review": []
  }
  ```

- **Refusal.** `"outcome": "refused"` with a `reason` and a `remedy` stops the phase with no fix attempt and exits 4. `phax resume` runs the gate again. The next steps of a refused acceptance step also name the `--skip-acceptance` correction below.
- **Provider error.** A provider that cannot be spawned, runs past 120 seconds, or prints something that is not a `gate-report` with a `$schema` fails the step as a broken step.

phax records the step under the `acceptance` surface in the phase's `gate-attribution.json`. A `phax.json` gate step cannot claim that surface.

## An example provider

[`examples/vitest-acceptance/`](../examples/vitest-acceptance/) is a Vitest provider that phax's own repository declares as `node examples/vitest-acceptance/main.mjs`. It lives in the repository only: no package ships it, so copy it and adapt it to your runner.

- **`authored`.** Every test the acceptance test files add or modify since `base` must carry `.fails` and must run: a `skip`, `todo`, `only`, `skipIf` or `runIf` on the test or an enclosing `describe`, or a test with no function, is a finding, since such a test passes both verdicts and never judges the code. A deleted test and an unchanged test are never findings, and an acceptance test file that does not parse is one finding.
- **`passed`.** No `.fails` is left in the acceptance test files, and each file's syntax tree, with its markers removed, equals its tree at `acceptanceCommit`. Removing the markers is the only change allowed; the finding for any other change names the first test that differs.

It compares syntax trees, not text, so reformatting, re-indenting, trailing commas, quote style and comments never change its answer. A request it cannot read is refused with a reason and a remedy.

## Write an acceptance-first plan

Declare an acceptance phase only when a provider is configured. In `plan.md`, phase-03 of a `publish` plan carries two header lines after the model, effort and Assignment reason lines:

```markdown
## phase-03 — Acceptance tests for publish {#phase-03-publish-tests}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-04
**Acceptance test files:** `tests/e2e/publish.test.ts`
```

`**Acceptance phase:** yes` means the next phase in plan order; `passed by phase-04` names it. The acceptance test files are a subset of the phase's planned files, so the phase may also plan a stub, such as `src/publish/index.ts`, that is not an acceptance test file. No phase in between plans an acceptance test file, an interactive phase may sit in between and takes no role, and one phase passes one acceptance phase. Each acceptance test file is listed once: a repeated path is an error on the `acceptance` check of `phax plans lint`, and `phax run` and `phax resume` refuse the plan with exit 11. `phax plans lint` checks all of it.

A test written in an acceptance phase carries the loop `acceptance` on its line in the phase's `### Test strategy`, and a criterion of the source spec:

```markdown
- publishing refuses a red gate — medium · example · the refusal naming the gate · acceptance · AC-1
```

phase-03 adds its tests with the framework's expected-failure marker, so the test command stays green:

```ts
test.fails("publishing refuses a red gate", () => {
  expect(publish(redRun)).toEqual({ refused: "gate" });
});
```

Each phase's prompt tells the agent its role in a fixed wording that names no framework: the acceptance phase marks every test it adds or modifies and may delete tests; the passing phase may only remove the markers and makes the code satisfy the tests as written.

phase-04 removes `.fails` and writes the refusal. Its gate sends `passed`, with phase-03's commit as `acceptanceCommit`. Had phase-04 changed the expected value in a test, the provider's finding above would drive the fix loop. The passing phase may leave an acceptance test file untouched, for example when phase-03 only deleted tests, so reconciliation counts the acceptance test files as optional edits of the passing phase.

## When an acceptance test cannot pass

An acceptance test that the code cannot satisfy unchanged is a spec question, not a bug to work around. The fix loop runs out on the failing acceptance step, the run pauses at the passing phase with exit 4, resumable at that phase, and the agent has been told to say so in its handoff. Send the disagreement back to the spec.

A committed acceptance phase is not reset: `phax reset-phase` refuses an acceptance phase while its passing phase is in any state other than `pending`, and the state machine never resets a committed phase. When the acceptance test itself is wrong, correct it in the stopped phase and close the step with `phax resume <run> --skip-acceptance`. That resume runs the phase's configured gate with the usual fix loop, runs no acceptance step, and records the step as `skipped`. To review the acceptance tests before they are passed instead, see [Reviewing acceptance tests before they are passed](#reviewing-acceptance-tests-before-they-are-passed).

For example, phase-04 of the `publish` run exhausts its fix loop on the acceptance step and the run pauses with exit 4. The person decides the acceptance test is wrong, edits it in the stopped phase's worktree, and resumes:

```bash
phax enter-phase publish phase-04
phax resume publish --yes --skip-acceptance
```

phase-04's configured steps run and must pass. Its acceptance step is recorded in `gate-attribution.json` as

```json
{ "command": "node scripts/acceptance-verdicts.mjs", "surface": "acceptance", "result": "skipped" }
```

and `acceptance` is then not among phase-04's verified surfaces, nor the run's: the PR body does not claim an acceptance test that was not passed. The handoff's `## Acceptance pairs` table shows `skipped` in that side's cell.

- `--skip-acceptance` applies only to the phase the resume restarts at, in this invocation. It never reaches a later phase, and it is not persisted.
- At a phase that is neither an acceptance phase nor a passing phase, the resume is refused with exit 1 and nothing changes, with or without `--yes`.
- It is an operator's choice. No agent prompt names it.

An acceptance phase that produced no changes is skipped and notes no commit, so there is nothing to pass. phax refuses its passing phase before the agent runs, with exit 11, and the run fails; the message names a different recovery: archive the run and run a corrected plan. `--skip-acceptance` does not apply: there is no commit to judge.

## Reviewing acceptance tests before they are passed

A person can read the acceptance tests before the code is written against them. Two ways stop the run between the acceptance phase and its passing phase: `phax run --hold acceptance`, which holds the plan's acceptance phases after they commit, and a phase the plan declares `**Mode:** interactive` between the two. See [Interactive phases](../README.md#interactive-phases) for the stop itself; this section covers what changes inside a pair.

- **The `authored` re-run.** When the person's corrections at a stop change an acceptance test file of the pair the stop sits in, `phax resume` runs the acceptance provider's `authored` verdict again as the last step of the closing gate, after every configured step passed. The request is the usual `acceptance-request`, with `phase` naming the stopped phase, `acceptancePhase` the acceptance phase, and `files` the pair's acceptance test files. A finding goes to the person like any red gate (exit 4). Corrections that touch the acceptance test files of two pairs are refused, because one gate attempt carries one request, as is a gate step that writes an acceptance test file the corrections did not change.
- **`acceptanceCommit`.** The passing phase judges the latest commit of the pair that passed `authored`: the review commit of the last stop in the pair whose close ran the step, or the acceptance phase's own commit when none did. The request's `acceptanceCommit` names it.
- **A held passing phase.** Holding the passing phase stops it after it passed its own `passed` verdict. Its close runs the configured steps only, with no acceptance step. For each acceptance test file its corrections changed, it warns that the pass was judged before the stop and that the acceptance provider does not see the change, and records the files in the close's trace. It refuses nothing.
- **Reset.** `phax reset-phase` refuses a phase whose closed stop ran the `authored` step once the pair's passing phase has started, as it does the acceptance phase itself, because the passing phase judges that commit.
- **`--skip-acceptance`.** `phax resume --skip-acceptance` on a run awaiting review at a stop in a pair exits 1: a close's `authored` step is never skipped. At a stop in no pair it exits 1 too, because that phase has no acceptance step. When the acceptance provider is broken, undo the correction to the acceptance test file, or `phax reset-phase` the stop.

For example, `phax run --hold acceptance` on the `publish` run stops after phase-03. The person tightens `tests/e2e/publish.test.ts`, then `phax resume publish` gates the worktree, runs `authored` on the change, leaves one review commit with a `Held-Phase: phase-03` trailer, and starts phase-04. Its `passed` request names that review commit as `acceptanceCommit`.

## What you see afterwards

- The review handoff lists every pair under `## Acceptance pairs`, with the last acceptance-step result of each side.
- `phax records explain <sha>` prints the phase's acceptance role, its counterpart and that result; `--gates` lists the saved acceptance request after the attempt's request. Records written by 0.32.0 and before list a `.oracle-request.json` there.
- `phax --usage` and the [CLI reference](cli/reference.md) describe the step contract.
