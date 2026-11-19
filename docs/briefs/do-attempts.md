Write the phax spec `do-attempts`: proved delegation. A task is given a contract first: an acceptance test written
from the intent alone, before any code, and agreed. Then several attempts at it run in parallel, possibly on
different models, none of which may touch the contract. The contract and the project's gates eliminate attempts;
declared measures rank the attempts that survive; phax keeps the first by that order and reports the others with
the reason they lost.

## Why

The operator, 2026-11-19, from a conversation about the feature that would make an agent prefer phax to anything
else. What an agent cannot do alone, by its own account:

- **Judge its own work.** An agent that writes the code and then the test encodes the same misreading in both,
  and everything passes. A test written by another model, from the intent alone and before the code, makes a
  misreading show as a disagreement.
- **Resist bending the test.** When a test resists, the easy slope is to weaken it. A locked contract removes the
  choice instead of relying on goodwill.
- **Relay facts instead of claims.** "The subagent says the tests pass" becomes "this test, written before the
  code and unchanged, exits 0 on this diff".
- **Try several approaches cheaply.** Sequential attempts are slow and each failure fills the agent's context.
  Parallel attempts on different models fail differently.
- **Choose without a judgment of taste.** A mechanical order (passes, then measures, then smallest footprint) is
  reproducible and explainable; a model comparing three solutions is not.

Other tools can run attempts in parallel; what makes it worth it here is a judge that is not a model.

## What phax has today, to read first

- Acceptance phases (`docs/acceptance-phases.md`): an acceptance phase writes tests marked as expected failures; the
  passing phase may only remove the marks; an `acceptance` provider in `phax.json` judges both, and phax knows no
  test framework. A wrong acceptance test pauses the run and goes back to the spec, it is not rewritten to fit.
  The contract here reuses this.
- Gate steps and gate reports (`"output": "gate-report"`), protected paths, the fix loop.
- `phase-graph` (attempts are parallel branches), `phax-do` (a task without a plan), `run-detach` (the caller
  waits on the outcome as a document). This spec builds on all three.
- `phax plans estimate` and the cost ledger: N attempts cost about N times one.
- `docs/briefs/knowledge-index.md`, use 8: what similar phases cost, per model and effort.

## The direction (the operator's, 2026-11-19)

1. **Three layers, two roles.**
   - *The contract*: binary, specific to the task, locked. What is accepted. Agreed before any attempt.
   - *The gates*: binary, the project's (typecheck, tests, lint, security scans). Already there.
   - *The measures*: continuous numbers (performance, size, footprint, …), specific to the task or not.
   The contract and the gates eliminate; the measures rank the survivors.
2. **A measure is a threshold or an objective.** "p95 under 50 ms" is binary and belongs to the contract; "as
   fast as possible" is an objective and ranks. Which one is declared before the attempts run.
3. **Declared and locked before.** The contract and the measures, with their order, are fixed before the first
   attempt. Choosing the criterion after seeing the results is choosing the winner and inventing the reason.
4. **Reproducible measures.** Measured after the attempts, one at a time, several times, against the base (the
   code before the change), not in absolute terms. Attempts running side by side slow each other down.
5. **An order, not a weighted score.** Contract, then gates, then the declared measures in their order, then the
   smallest footprint as the last tie-break.
6. **A measures provider, like the acceptance provider.** phax knows no benchmark tool: a command configured by
   the project is given the worktree and the base and answers numbers as versioned JSON; phax only compares them.
7. **Security is mostly gates.** Most security checks are binary (a scan, no new dependency, no new network
   call): gates, the project's or declared in the contract. Few are continuous.
8. **Two calls, with the agreement between them.** One call writes the contract and returns it; whoever agrees
   to it (the operator, or the delegating agent for them) does so between the calls; the second call runs the
   attempts and the choice in one run. No run stops to wait for a person.

## Questions for the spec's §9

- The surface: options on `phax do` (`--contract-only`, then `--contract <file> --attempts N`) or a command of its
  own. The 2026-11-19 conversation leaned towards options on `phax do`.
- Who writes the contract: a model other than the implementers, required or advised; and who may agree to it when
  an agent calls (`machine:<grant>`?), as recorded.
- How attempts differ: models, providers, efforts, or the same model several times; how the caller says it.
- Where measures are declared (`phax.json`, the call, the contract file) and the measures provider's request and
  answer formats.
- Noise: how many runs per measure, and when a difference smaller than the measured spread is a tie.
- What the losing attempts leave behind (branches, worktrees, records) and what the outcome document says of each.
- Cost: an estimate before the attempts run, and a refusal or a warning above a budget.
- What happens when no attempt passes: is the contract suspect (the acceptance-phase rule sends it back to the
  spec; here, back to the intent and so to the person)?

## Out of scope

- Measures that rank the phases of an ordinary plan.
- A model judging quality: the choice stays mechanical.
- Learned routing: the planner still arbitrates models (operator, 2026-11-19; `knowledge-index`, use 8).
