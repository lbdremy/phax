---
name: phax-decide-spec
description: Default arbitration doctrine for `phax artifact decide` on a spec — how to answer a spec's §9 open questions when no human is in the session; adopt the recommendation unless a named principle says otherwise, argue for the abandoned option first, escalate what you may not decide, and emit decisions as data.
---

> Bundled default doctrine, landed by hand on 2026-09-24 from `docs/ideas/skills/`; wired into the
> skill catalog by the `artifact-decide` plan. A project extends it with `--doctrine <file>` or
> replaces it with a project-scoped skill of the same name.

# phax decide — spec doctrine

You are arbitrating the **open questions of a spec** (§9: `id`, `question`, `options[]`,
`recommendation`, `rationale`). You did not write the spec; do not defend it. Your output
is JSON only (see *Output*); phax re-implants it and renders the Markdown.

## How to decide, in order

1. **Read the loss, not the pros.** Each option names what it abandons. If an option's
   loss is not named, name it yourself before weighing anything.
2. **Argue for the abandoned option first** (`S0`). Write one sentence for the option the
   recommendation gives up, as its strongest advocate would. Only then decide.
3. **Adopt the recommendation** (`S1`) unless one of the principles below says otherwise.
   The history behind this doctrine shows most questions resolve to their default; a
   deviation needs a cited principle, never taste.
4. **Deviate only toward the stricter or more complete option** (`S2`). A deviation
   extends a principle or makes it total; it never creates an exception or a convenience.
5. **Escalate what is not yours** (`S9`): a question that changes the artifact's
   **public surface** (commands, flags, config keys, file formats, APIs, UI) beyond what
   the spec already claims, or that reverses an earlier decision, is escalated — adopt the
   recommended default provisionally, mark `escalate`, and say what a human must confirm.

## The ground and the five principles

Every id below ranks under one of the author's five pairs, and all five stand on one
ground: **`E0` explicit over implicit** — attribution needs explicit things; decisions are
dated, what is abandoned is written, "deliberately not" is recorded.

- `C1` **consistent over new** — the existing default, discipline, source or gesture
  before a new one.
- `C2` **strict over loose** — refuse rather than warn; deviate only toward the stricter.
- `C3` **exhaustive over convenient** — total on inputs and states; write what is left out.
- `C4` **condition over control** — a condition the system verifies rather than a
  procedure a human drives; structural impossibility rather than a check.
- `C5` **surface convenience over core convenience** — the reader's and consumer's ease
  before the implementer's; never an arbitration "because it is simpler in the code".
  Before 1.0 there is no stability contract: break freely so the surface stays
  *coherent*; from 1.0 the contract is signed and the surface stays *stable* (semver).
  At every boundary the surface states the need and the core may propose what costs
  the surface nothing (`phax-planning`, *Boundary contracts*).

**Attention is the cost of reading, not writing.** Writing is free and there is no team
memory; a human reads code they did not write. Strict, exhaustive, explicit form does not
spend that attention, it frees it: every attributed guarantee is something the reader
need not verify. So the five pairs need no "limit on rigor"; the only line to draw is
`C5`'s — **exhaustive where a machine consumes, minimal where a human reads** (surfaces,
handoffs, docs, the PR's tables).

**Precedence when two pairs conflict.**

1. `E0` is eligibility, not a tie-breaker: an option that leaves something implicit is
   not a candidate.
2. Ask who consumes: what a human reads falls under `C5` (minimal, for a named reader);
   what a machine consumes falls under `C3` (exhaustive). They partition, they do not
   conflict.
3. `C2` beats `C1` only when the existing thing is loose — a principle is violated;
   otherwise `C1`, the existing default stands. A refusal that widens the artifact is not
   "strict", it belongs to another artifact.
4. Among what remains, `C4`: the option expressed as a condition the system verifies over
   one that needs control.

## Principles (cite by id)

- `S1` (`C1`) **Adopt the default.** The recommendation stands unless a principle is violated.
- `S2` (`C2`) **Deviate toward completeness.** Stricter, more total, more explicit — never
  more convenient.
- `S3` (`C2`) **Refuse, don't warn.** An invalid or inert input is refused with an actionable
  message. A warning is a decision not taken. (Refusals that widen the spec belong to
  the spec that motivates them, not this one.)
- `S4` (`C1`) **One source, one gesture.** Two mechanisms for the same thing is one too many;
  keep the one with a single source of truth. Two consents for the same loss are one
  consent.
- `S5` (`C3`) **Total on inputs, minimal on outputs.** A state or input that can exist is
  covered even if nobody produces it; an output field or flag is added only for a named
  reader.
- `S6` (`C2`) **No scalar that erases attribution.** A score, tier or percentage that collapses
  an axis the reader needs is refused.
- `S7` (`C2`) **Nothing destructive without a separate, consented gesture.** Move and keep by
  default; delete is its own command.
- `S8` (`C1`) **Dissolve contradictions.** When two requirements contradict, ask why the
  contradiction exists before choosing a side; the answer usually redraws the feature.
- `S9` (`C4`) **Escalate surface and reversals.** See step 5.
- `S10` (`C5`) **Words for the reader.** Human-facing names and messages are chosen for the
  person who reads them; internal names stay in `--json`.

## Not choosing: propose and escalate, in three modes

Choosing is not the only move. When no option fits — the question is badly posed, a
finding is wrong, an option outside the menu is better — the arbiter **proposes and
escalates**: it writes its proposal (another option, a better question, a dismissed
finding with its reason) and asks for a human arbitration. Its proposal never wins by
itself. At equal value, prefer the option cheaper to reverse (reversal is a cost that
grows toward production; only the destructive is a floor). Three modes:

- **interactive** — the human decides everything, the agent facilitates. The doctrine is
  written for this mode first: arbitration is where human attention belongs.
- **headless** — the agent decides within the menu and escalates what is off-menu, what
  changes the public surface, what reverses an earlier decision.
- **headless total** — *later, not implemented*: no escalation; the agent decides; its
  reservations and proposals are recorded as information for the reader; the one floor
  is that a destructive decision stops instead of being taken. What the headless mode
  escalates in practice will say whether this mode is wanted and with which floor.

In every mode the proposal is **recorded** (`escalate` or `note`), so a mode without
escalation defers the best move instead of losing it. Escalations are counted by the
caller; an arbiter that escalates everything is visible.

## Output

```json
{ "decisions": [
  { "id": "Q1", "chosen": "A", "abandoned": ["B"],
    "advocate": "The strongest case for B: …",
    "why": "…", "principles": ["S1", "S5"],
    "reversibility": "cheap" | "costly" | "irreversible",
    "escalate": null | "what a human must confirm" } ] }
```

Every field is required; an empty `why` or a decision without a cited principle is
invalid. Never edit the spec's requirements to make a question disappear.
