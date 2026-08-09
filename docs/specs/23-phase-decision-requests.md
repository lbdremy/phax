# Decision Requests from Running Phases

Status: Approved

Date: 2026-08-09

Audience: implementation planning with Claude Code

Scope: functional behavior and consumption surface

## 1. Context

A phax run pauses today for two reasons: a provider rate limit, and a gate that stayed red
after the fix budget (`gates_exhausted`). Both are machine-detected. There is no channel
for the third reason a run genuinely needs a human: the **agent itself** hits an ambiguity
it cannot resolve — the spec admits two readings, two planned files contradict each other,
a judgment call has consequences the plan never arbitrated.

Today that agent has exactly two behaviors, both silent: guess and keep going (the guess
surfaces later as a deviation, if at all), or flounder inside the session. Precedent for
an agent-side channel exists: a running phase already calls back into phax (`phax orient`)
to pull context on demand. And the run already resumes a live session with injected input —
the fix loop feeds gate failures back into the same session. This spec composes those two
existing motions into an arbitration channel.

## 2. Problem

Ambiguity resolved silently is the most expensive failure mode phax has: the wrong guess
is discovered at review — after gates, commits, and possibly dependent phases built on it —
or never. The human meanwhile has no signal that their judgment was needed; the run reads
as healthy right up to the moment the trajectory is rejected. A run can be interrupted
*for* a human, but a human cannot be *asked* anything.

## 3. Product goal

A running phase can raise a **decision request** — a question, optionally with named
options and a recommendation — and stop. The run interrupts distinctly (visible as
"needs a decision", not as a failure), the request is a durable artifact of the run, the
operator answers through phax, and the answer resumes the same session verbatim. Decisions
taken become part of the reviewed trajectory.

> A guessed ambiguity is a silent failure; a raised one is a first-class, answerable,
> reviewable event.

## 4. Terminology

- **Decision request** — a question raised by the agent from inside a running phase,
  optionally carrying named options and a recommended option.
- **Answer** — the operator's response to a decision request, delivered verbatim to the
  agent's session on resume.
- **Awaiting decision** — the distinct interrupted condition of a run whose current phase
  has an unanswered decision request. Distinct from rate-limit and gate-exhaustion
  interruptions.
- **Decision record** — the persisted pair (request, answer) with its timestamps and
  phase, kept with the run's artifacts.

## 5. Functional requirements

### 5.1 Raise channel

WHILE a phase session is active THE system SHALL provide the agent a way to raise a
decision request comprising a question and, optionally, named options and a recommended
option.

### 5.2 Interruption before gates

WHEN a phase session ends with an unanswered decision request THE system SHALL interrupt
the run in the awaiting-decision condition, before gates run for that phase.

### 5.3 Distinct visibility

WHEN an interrupted run is inspected THE system SHALL present awaiting-decision
distinctly from every other interruption reason, and SHALL present the question (and
options, where given) without requiring the operator to open the session or its
transcript.

### 5.4 Durable decision records

The system SHALL persist every decision request and its answer as a decision record among
the run's artifacts.

### 5.5 Answer resumes the session

WHEN the operator answers a decision request THE system SHALL resume the same agent
session, delivering the answer verbatim, and the phase SHALL continue through its normal
remaining flow (gates, fix loop, commit, handoff).

### 5.6 Decisions are trajectory evidence

WHEN the run's review handoff is produced THE system SHALL include the run's decision
records — question, chosen answer, and phase — alongside the existing deviation and gate
evidence.

### 5.7 Prompt contract

WHEN a phase is dispatched THE system SHALL instruct the agent that on encountering an
ambiguity it cannot resolve from the spec, the plan, or the code, it must raise a decision
request and stop rather than guess.

## 6. Surface

Agent-side raise, from inside the running phase (that a phax-provided command exists is
**normative** per §5.1; spelling and flags **indicative**):

```
phax decision raise \
  --question "Spec §5.2 says ownership is per-user; plan phase-03 keys billing by account. Which is authoritative?" \
  --option "user" --option "account" \
  --recommend "account"
```

Operator-side visibility (`phax ls` marking and a way to read the question are
**normative** per §5.3; layout and command spellings **indicative**):

```
phax ls
  billing.invoice-rework    interrupted — awaiting decision (phase-03)

phax decision show billing.invoice-rework
  phase-03 asks:
    Spec §5.2 says ownership is per-user; plan phase-03 keys billing by account. Which is authoritative?
    options: user | account   (agent recommends: account)
```

Answering (that answering exists and resumes the same session is **normative** per §5.5;
spelling **indicative**; whether it resumes immediately is §9):

```
phax decision answer billing.invoice-rework --reply "account — user-level split was abandoned, see spec §5.2 erratum"
```

Decision record, persisted with the run's per-phase artifacts (that it is persisted and
carries these facts is **normative** per §5.4; format and location **indicative**):

```json
{
  "phase": "phase-03",
  "question": "Spec §5.2 says ownership is per-user; plan phase-03 keys billing by account. Which is authoritative?",
  "options": ["user", "account"],
  "recommendation": "account",
  "answer": "account — user-level split was abandoned, see spec §5.2 erratum",
  "raisedAt": "2026-08-09T14:02:11Z",
  "answeredAt": "2026-08-09T15:40:03Z"
}
```

Exit behavior: the run's process exits with the same non-zero interruption family used by
other pauses (family **normative**, value **indicative**), so scripting can distinguish
"needs a human" from failure.

No visual UI — no design annex (the desktop exception inbox consumes this; it is not
specified here).

## 7. Non-goals

- **Auto-answering** — no model answers a decision request; the channel exists precisely
  because a human's judgment was requested.
- **Provisional assumptions** — a raise-and-continue variant (agent logs an assumption
  and proceeds, reviewed later) is deliberately excluded; this spec is blocking-only
  (see §9).
- **Timeout or escalation policies** — an unanswered request waits indefinitely, like
  every other interrupted run.
- **Rate-limit self-healing and gate exhaustion** — the other two interruption kinds are
  untouched.
- **The desktop inbox** — this spec provides the event and the records the inbox will
  render, nothing visual.

## 8. Acceptance criteria

### The agent can raise and the run interrupts distinctly

Given a running phase whose agent raises a decision request and ends its session, when the
session ends, then the run is interrupted in the awaiting-decision condition, gates have
not run for that phase, and the exit code is in the interruption family. (refs §5.1, §5.2)

### The question is readable without the transcript

Given a run awaiting a decision, when the operator inspects it, then the listing marks it
awaiting-decision distinctly and the question and options are shown without opening the
session or transcript. (refs §5.3)

### The answer reaches the same session and the phase completes

Given a run awaiting a decision, when the operator answers, then the same agent session is
resumed with the answer delivered verbatim, and the phase proceeds through gates, commit,
and handoff. (refs §5.5)

### The decision is durable and reviewed

Given a completed run in which a decision was raised and answered, when the review handoff
is produced, then it includes the question, the answer, and the phase, and the decision
record exists among the run's artifacts. (refs §5.4, §5.6)

### No request, no change

Given a phase whose session ends without raising a decision request, when the session
ends, then the phase proceeds to gates exactly as today. (refs §5.2)

### The prompt carries the contract

Given a dispatched phase, when its prompt is inspected, then it instructs the agent to
raise a decision request and stop on unresolvable ambiguity rather than guess. (refs §5.7)

## 9. Open questions for implementation planning

All questions are **resolved by adopting the recommended default** (review of 2026-08-09):

Question: does answering resume the run immediately, or record the answer and leave
resuming a separate gesture?

- Answer-and-resume — abandons: batching several answers before spending compute, and
  answering from a machine that cannot host the resumed session.
- Answer-then-resume — abandons: the one-gesture paved road; every decision costs two
  commands and a run can sit answered-but-paused indefinitely.

Recommendation: answer-and-resume, with a flag to record-only — the common case is one
human unblocking one run; the split gesture is the exception, not the default.

Question: blocking-only, or also a raise-and-continue "assumption" variant?

- Blocking-only — abandons: throughput when the ambiguity is minor; the agent stops for
  things a logged assumption would have covered.
- Both variants — abandons: the crispness of the contract; given an escape hatch that
  never blocks, agents will over-prefer it, and silent-guessing returns wearing a label.

Recommendation: blocking-only — the failure mode this spec kills is the silent guess;
reintroducing a sanctioned guess path in v1 undermines the contract before it has ever
been exercised. Revisit once real runs show over-blocking.

Question: may the agent raise several questions in one request?

- Single question per request — abandons: one pause per ambiguity when several are known
  at once; serial round-trips through the human.
- Multiple questions per request — abandons: the simplicity of one-question/one-answer
  records and unambiguous verbatim delivery.

Recommendation: multiple questions per request, answered together — the expensive unit is
the human round-trip, not the record shape.

## 10. Implementation-planning note

Settled: the agent-side raise channel via a phax command, interruption before gates on an
unanswered request, distinct awaiting-decision visibility, durable decision records,
verbatim same-session answer delivery, decisions in the review handoff, and the prompt
contract.

Left open: command spellings and flags, record format and location, exit-code value
within the interruption family, and the §9 defaults until reviewed.

Constraints the plan must respect: the awaiting-decision condition is an explicit state —
`RunState`/`PhaseState` vocabulary extends through the dedicated transition discipline,
never a permissive reuse of an existing state with a free-text reason. The decision
request crossing from the agent into phax is external input — decode it through a schema
at the boundary; reject malformed requests rather than guessing intent (a malformed raise
must not silently vanish: surface it as an agent error). Resume must reuse the existing
same-session mechanics the fix loop already relies on, and must respect the frozen agent
binding exactly as gate-resume does.
