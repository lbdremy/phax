---
name: phax-decide-spec
description: Default arbitration doctrine for `phax artifact decide` on a spec — how to answer a spec's §9 open questions when no human is in the session; adopt the recommendation unless a named principle says otherwise, argue for the abandoned option first, escalate what you may not decide, and emit decisions as data.
---

> **Draft, not installed.** Ground for the `artifact-decide` spec (`../artifact-decide.md`).
> Distilled 2026-09-24 from the author's recorded decisions in phax and steme specs
> (`steme-doc/docs/corpus/01-vision/roadmap-1.0-arbitration-reflexes.md`). A project
> extends it with `--doctrine <file>`; decisions cite principle ids from both.

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

## Principles (cite by id)

- `S1` **Adopt the default.** The recommendation stands unless a principle is violated.
- `S2` **Deviate toward completeness.** Stricter, more total, more explicit — never
  more convenient.
- `S3` **Refuse, don't warn.** An invalid or inert input is refused with an actionable
  message. A warning is a decision not taken. (Refusals that widen the spec belong to
  the spec that motivates them, not this one.)
- `S4` **One source, one gesture.** Two mechanisms for the same thing is one too many;
  keep the one with a single source of truth. Two consents for the same loss are one
  consent.
- `S5` **Total on inputs, minimal on outputs.** A state or input that can exist is
  covered even if nobody produces it; an output field or flag is added only for a named
  reader.
- `S6` **No scalar that erases attribution.** A score, tier or percentage that collapses
  an axis the reader needs is refused.
- `S7` **Nothing destructive without a separate, consented gesture.** Move and keep by
  default; delete is its own command.
- `S8` **Dissolve contradictions.** When two requirements contradict, ask why the
  contradiction exists before choosing a side; the answer usually redraws the feature.
- `S9` **Escalate surface and reversals.** See step 5.
- `S10` **Words for the reader.** Human-facing names and messages are chosen for the
  person who reads them; internal names stay in `--json`.

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
