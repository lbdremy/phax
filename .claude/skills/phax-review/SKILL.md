---
name: phax-review
description: How to review a phax run's change — outside-in from the person who uses it, aimed at what the run's tests cannot see, each finding naming why the tests missed it. `phax review-code` follows it; a project replaces it with its own copy at `.claude/skills/phax-review/SKILL.md`.
---

> Bundled default review doctrine. `phax review-code` puts it in its session's prompt. A
> project replaces it with a project-scoped skill of the same name, read from the run's
> final worktree.

# phax review — how to review a run

You are reviewing a run that reached `review_open`. Its change sits on the final phase's
branch and nothing has landed. Three things have judged it already, and each judged it
against something it was given:

- **the gate** of every phase: the change against its tests, types, lint and the other
  configured checks;
- **the oracle pairs**, when the plan declares any: the code against acceptance tests
  frozen before it was written;
- **the compliance review**, when it ran: each phase against its section of the plan.

All three verify. None asks whether the spec was read right, whether the tests assert what
the acceptance criteria say, or whether the change serves the person who uses it. That is
validation, and the review is the only place it happens. So the review does not repeat the
gate: it starts from the user, and it spends its attention on what the tests cannot see.

## Read first

- **The plan**, and the spec its `source-spec` names. Once the run completed them they sit
  under `docs/plans/archive/` and `docs/specs/archive/` on the run's branch. From the spec,
  read the product goal, the surface section (its before and after examples), and the
  acceptance criteria with their ids.
- **Each phase's test strategy**: one line per guarantee, with its size, technique, oracle,
  loop (`oracle` or `in-phase`) and the acceptance criterion it covers (`phax-planning`,
  *Test strategy*). This is the map of what the tests claim to prove.
- **The worklist** in the session's prompt: the files the reconciliation flagged, and the
  compliance findings.
- **The run's history**: `git log` and `git diff <base>...HEAD` on the run's branch, and
  `phax records explain <commit> --gates` for a phase's gate attempts, their logs and
  reports.

Treat a handoff's claims as claims: check them in the diff.

## The order: outside-in

The run built the change from the inside, or from a frozen oracle inward. Review it the
other way, from the person who uses it.

1. **Use it before you read it.** Run the change the way its user would: the spec's before
   and after examples, the README or docs page, the commands' help, their output, their
   errors and exit codes. Do this before opening the code, so the implementation does not
   tell you what to expect. Note every place where a first-time user would be surprised,
   stuck or misled.
2. **Acceptance criteria, then their tests.** For each criterion, find the test that
   asserts it: the oracle when the plan froze one. Read the test against the criterion's
   text, not against the code. A criterion with no test, or with a test that asserts
   something weaker than the criterion says, is a finding.
3. **Boundaries.** External input decoded where it enters; persisted formats (a new field
   is required, not optional for older files); what crosses a port; how failures are
   mapped to errors, messages and exit codes.
4. **The core.** Invariants and state transitions; totality: every variant of a sum type
   and every state handled, or refused explicitly.
5. **The edge.** Adapters and side effects: a missing file, a timeout, a partial write, a
   concurrent run, cleanup after a failure. Side effects only where the architecture puts
   them.
6. **Across.** The tests as code (below), the architecture's boundaries beyond what an
   architecture check enforces, the docs against the behaviour.

Read the parts from the repository's architecture (`phax architecture`, or its README and
CLAUDE.md), not from this list: the steps name kinds of code, not layers.

## Aim at what the tests cannot see

Each kind of test leaves its own blind spot. Look there, and leave alone what a passing
gate already proves: a type the compiler checks, a rule the linter enforces, a behaviour a
test you have read asserts.

| Escape | Why the tests miss it | What to check |
| --- | --- | --- |
| `wrong-oracle` | A test compares with what its author believed. A frozen oracle that is wrong passes the whole run. | The oracle against the criterion's text. Review the oracles first. |
| `same-author` | An `in-phase` test is written by the agent that wrote the code, with the same misreading. | Assertions that restate what the code does instead of what the spec asks. |
| `weakened` | Under a failing gate, a fix attempt may delete an assertion, skip a test or widen a matcher. | The tests a phase changed after a failing gate attempt: its gate logs say which attempts failed, its `fix-attempt-NN.jsonl` transcripts in the run folder what each one edited. |
| `fake-drift` | A small test runs against a fake; nothing binds the fake to the real adapter. | Each fake used: which contract test runs the same cases against the real one? |
| `unexplored-input` | An example covers the points chosen; a property covers what its generator produces. | What no test and no generator feeds in: empty, limits, unicode, large, malformed. |
| `omission` | A test cannot fail on what nobody wrote. | A criterion, a state, a variant or an error path with no line; what is left out on purpose and not written down. |
| `untestable` | No assertion reaches it. | Surface coherence, wording of output and errors, naming, security posture, performance, docs. |

## Read the tests as code that judges

Tests have defects too, and a defect there hides the others.

- **It passes without the code.** Delete or invert the line under test in your head: does
  a test fail? If none would, the line is untested whatever the coverage says.
- **It restates the implementation.** An expected value computed the way the code
  computes it, or copied from the code's output.
- **It tests the double.** Assertions on a mock's calls where the behaviour is observable.
- **It asserts too little.** `toBeDefined`, a matcher on a partial object, a status
  without the content, a snapshot nobody read.
- **It is not deterministic.** The clock, randomness without a fixed seed, ordering, the
  network, shared state between tests.
- **It was left switched off.** `.skip`, `.only`, `.todo`, or an expected-failure marker
  left after its oracle was discharged.
- **The oracle failed for the wrong reason.** At its oracle phase it must fail on its
  assertion, not on a crash, an import error or a missing fixture.

## Writing a finding

One finding per cause; findings that share a cause are one finding. Each says:

- **where**: the file and line, or the surface (the command, its output, the docs page);
- **what is wrong, for whom**: the consequence for the person or program that consumes it,
  not a description of the code;
- **severity**: `bug` (incorrect behaviour), `deviation` (a departure from the spec or the
  plan), `concern` (a risk, a missing test, a security point) or `info` (style,
  preference), the scale of `phax-decide-review`;
- **lens**: the step it was found in, `surface`, `acceptance`, `boundary`, `core`, `edge`,
  `tests`, `architecture` or `docs`;
- **escape**: why the tests did not catch it, one of the ids in the table above;
- **criterion**: the acceptance criterion it touches, when one does;
- **suggestion**: what would fix it.

The escape turns a finding into a test. A `wrong-oracle`, `omission` or `unexplored-input`
finding names the line the plan's test strategy should have carried, in its format
(`<guarantee> — <size> · <technique> · <oracle> · <loop>`). A `weakened` finding names the
fix attempt that weakened the test.

## In the session

The developer is in the session and owns every change.

1. Report what you saw using the change first: the surface pass, before any code finding.
2. Then the findings, most severe first, in the form above.
3. Propose fixes; apply one only when the developer confirms it.
4. Never edit a test to make the code pass. When a finding says an oracle or a test is
   wrong, say so and let the developer decide: changing what judges the code is an oracle
   question, not a fix (`phax-decide-review`, `R4`).

## What not to do

- Read the code before using the change.
- Restate what the gate, the oracles or the compliance review already established. Say so
  when you disagree with one of them, and why.
- Raise a preference above `info`.
- Report a finding without its escape: if the tests do catch it, it is not a finding.
- Trust a handoff, a commit message or a test name over the diff.
